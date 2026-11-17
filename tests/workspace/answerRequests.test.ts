import { expect, it } from 'vitest';
import { applyAnswer, createRegenerationRequest } from '../../src/features/workspace/answerRequests';
import { createProject, restartChat, saveArtifact } from '../../shared/domain';
import { parseWorkspace, serializeWorkspace } from '../../shared/validation';
import type { ChatRequest, AssistantReply } from '../../shared/types';

const reply: AssistantReply = { message: 'Первый ответ', choices: [], proposedFacts: [], artifactDraft: null };
it('preserves a new draft even when it repeats the message currently being answered', () => {
  const project = createProject();
  const request: ChatRequest = { requestId: 'current-request', projectId: project.id, moduleId: 'idea', intent: 'message', message: 'Повторяемый текст', context: { name: project.name, description: '', facts: [], artifacts: [], history: [] } };
  project.modules.idea.messages = [{ id: 'question', role: 'user', content: request.message, createdAt: new Date().toISOString(), requestId: request.requestId, status: 'pending' }];
  project.modules.idea.draft = request.message;
  expect(applyAnswer(project, request, reply).modules.idea.draft).toBe(request.message);
});
it('ignores a late response after restarting its conversation', () => {
  const project = createProject();
  const request: ChatRequest = { requestId: 'old-flight', projectId: project.id, moduleId: 'idea', intent: 'message', message: 'Старая идея', context: { name: project.name, description: '', facts: [], artifacts: [], history: [] } };
  project.modules.idea.messages = [{ id: 'old-question', role: 'user', content: request.message, createdAt: new Date().toISOString(), requestId: request.requestId, request, status: 'pending' }];
  const reset = restartChat(project, 'idea');
  expect(applyAnswer(reset, request, reply)).toBe(reset);
  reset.modules.idea.messages = [{ id: 'new-question', role: 'user', content: 'Новая идея', createdAt: new Date().toISOString(), requestId: 'new-flight', status: 'pending' }];
  expect(applyAnswer(reset, request, reply)).toBe(reset);
  expect(reset.modules.idea.messages).toHaveLength(1);
  expect(reset.modules.idea.memory).toBeUndefined();
});
it('stores an exact source snapshot and regenerates with a fresh ID while retaining saved work and an identical draft', () => {
  let project = saveArtifact(createProject(), 'idea', { title: 'Сохранено', body: 'Решение пользователя' });
  const request: ChatRequest = { requestId: 'request-1', projectId: project.id, moduleId: 'idea', intent: 'message', message: 'Вопрос', context: { name: project.name, description: '', facts: [], artifacts: [], history: [] } };
  project.modules.idea.messages = [{ id: 'question', role: 'user', content: 'Вопрос', createdAt: new Date().toISOString(), request, requestId: request.requestId, status: 'pending' }];
  project = applyAnswer(project, request, reply);
  project.modules.idea.draft = 'Вопрос';
  const message = project.modules.idea.messages[1]; message.feedback = 'up';
  project.description = 'Изменено после ответа';
  const regenerated = createRegenerationRequest(project, 'idea', message)!;
  expect(regenerated.requestId).not.toBe(request.requestId);
  expect(regenerated.context).toEqual(request.context);
  message.regenerationRequest = regenerated; message.status = 'failed'; message.requestError = 'NETWORK_ERROR';
  const restored = parseWorkspace(serializeWorkspace({ version: 1, activeProjectId: project.id, projects: [project] })).projects[0];
  expect(restored.modules.idea.messages[1].regenerationRequest).toEqual(regenerated);
  const updated = applyAnswer(restored, regenerated, { ...reply, message: 'Другой ответ', artifactDraft: { title: 'Предложение', body: 'Новый текст' } }, message.id);
  expect(updated.modules.idea.messages).toHaveLength(2);
  expect(updated.modules.idea.messages[1].id).toBe(message.id);
  expect(updated.modules.idea.messages[1].feedback).toBeUndefined();
  expect(updated.modules.idea.messages[1].regenerationRequest).toBeUndefined();
  expect(updated.modules.idea.artifact).toEqual(project.modules.idea.artifact);
  expect(updated.modules.idea.draft).toBe('Вопрос');
  expect(applyAnswer(updated, regenerated, reply, message.id)).toBe(updated);
});

it('legacy regeneration reconstructs only the earlier question and never includes future answers', () => {
  const project = createProject(); const createdAt = new Date().toISOString();
  project.modules.idea.messages = [
    { id: 'u0', role: 'user', content: 'Контекст до вопроса', createdAt },
    { id: 'a0', role: 'assistant', content: 'Уточнение', createdAt },
    { id: 'u1', role: 'user', content: 'Исходный вопрос', createdAt },
    { id: 'a1', role: 'assistant', content: 'Выбранный ответ', createdAt },
    { id: 'u2', role: 'user', content: 'Позднейший вопрос', createdAt },
  ];
  const request = createRegenerationRequest(project, 'idea', project.modules.idea.messages[3])!;
  expect(request.message).toBe('Исходный вопрос');
  expect(request.context.history.map(message => message.content)).toEqual(['Контекст до вопроса', 'Уточнение']);
});

it('applies an edited question and its answer together without changing later turns, saved artifacts or draft', () => {
  let project = saveArtifact(createProject(), 'idea', { title: 'Итог', body: 'Проверенный пользователем текст' });
  const date = new Date().toISOString();
  const request: ChatRequest = { requestId: 'edit-1', projectId: project.id, moduleId: 'idea', intent: 'message', message: 'Исправленный вопрос', context: { name: project.name, description: '', facts: [], artifacts: [], history: [] } };
  project.modules.idea.draft = 'Исправленный вопрос';
  project.modules.idea.messages = [
    { id: 'user1', role: 'user', content: 'Первый вопрос', createdAt: date, status: 'failed', request, requestId: request.requestId, replacesAnswerId: 'answer1', requestError: 'NETWORK_ERROR' },
    { id: 'answer1', role: 'assistant', content: 'Первый ответ', createdAt: date, choiceConsumed: true },
    { id: 'user2', role: 'user', content: 'Второй вопрос', createdAt: date },
    { id: 'answer2', role: 'assistant', content: 'Второй ответ', createdAt: date },
  ];
  project.modules.idea.proposal = reply;
  const saved = parseWorkspace(serializeWorkspace({ version: 1, activeProjectId: project.id, projects: [project] })).projects[0];
  const updated = applyAnswer(saved, request, { ...reply, message: 'Исправленный ответ' }, 'answer1', 'user1');
  expect(updated.modules.idea.messages.map(message => message.content)).toEqual(['Исправленный вопрос', 'Исправленный ответ', 'Второй вопрос', 'Второй ответ']);
  expect(updated.modules.idea.messages[0].request).toBeUndefined();
  expect(updated.modules.idea.messages[0].replacesAnswerId).toBeUndefined();
  expect(updated.modules.idea.messages[1].request?.message).toBe('Исправленный вопрос');
  expect(updated.modules.idea.artifact).toEqual(saved.modules.idea.artifact);
  expect(updated.modules.idea.draft).toBe('Исправленный вопрос');
  expect(updated.modules.idea.proposal).toEqual(reply);
  expect(applyAnswer(updated, request, reply, 'answer1', 'user1')).toBe(updated);
});
