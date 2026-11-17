import { expect, it } from 'vitest';
import { collectArtifacts, collectCurrentDraft } from '../../shared/chatContext';
import { createProject, restartChat } from '../../shared/domain';
import { createRegenerationRequest } from '../../src/features/workspace/answerRequests';
import type { AssistantReply, ChatRequest, Message } from '../../shared/types';

const proposal = (body: string): AssistantReply => ({ message: 'Материал подготовлен отдельно.', artifactDraft: { title: 'Учебный проект мастерской', body }, choices: [], proposedFacts: [] });
const request = (projectId: string, draft: ChatRequest['context']['currentDraft']): ChatRequest => ({ requestId: 'draft-context-01', projectId, moduleId: 'idea', intent: 'message', message: 'Покажи предыдущий текст полностью.', context: { name: 'Мастерская', description: '', facts: [], artifacts: [], history: [], currentDraft: draft } });

it('keeps the complete unsaved result available without creating saved artifacts or borrowing another stage or project', () => {
  const project = createProject();
  const body = 'Содержимое карточки\n' + 'Подробности проверки\n'.repeat(600) + 'Не потерять: оборудование оплачивается отдельно.';
  project.modules.idea.proposal = proposal(body);
  project.modules.audience.proposal = proposal('Другой этап');
  const facts = structuredClone(project.facts);
  const current = collectCurrentDraft(project, 'idea')!;
  expect(current.body).toBe(body);
  expect(current.body.length).toBeGreaterThan(8000);
  expect(current).not.toBe(project.modules.idea.proposal.artifactDraft);
  expect(collectCurrentDraft(project, 'audience')?.body).toBe('Другой этап');
  expect(collectCurrentDraft(createProject(), 'idea')).toBeUndefined();
  expect(collectArtifacts(project)).toEqual([{moduleId:'audience',title:'Учебный проект мастерской',body:'Другой этап',stale:false,provenance:'assistant_proposal'}]);
  expect(project.facts).toEqual(facts);
  project.modules.idea.proposal.artifactDraft!.body = 'Позднейшая версия';
  expect(current.body).toBe(body);
});

it('does not recover a discarded proposal after reset, while another stage keeps its local draft', () => {
  let project = createProject();
  project.modules.idea.proposal = proposal('Старая версия идеи');
  project.modules.audience.proposal = proposal('Локальная аудитория');
  project = restartChat(project, 'idea');
  expect(collectCurrentDraft(project, 'idea')).toBeUndefined();
  expect(collectCurrentDraft(project, 'audience')?.body).toBe('Локальная аудитория');
});

it('regenerates from the immutable original draft snapshot and does not add a future proposal to a legacy question', () => {
  const project = createProject();
  project.modules.idea.proposal = proposal('Первоначальная несохранённая карточка');
  const old = request(project.id, collectCurrentDraft(project, 'idea'));
  const createdAt = new Date().toISOString();
  const answer: Message = { id: 'answer-old', role: 'assistant', content: 'Старый ответ', createdAt, request: old };
  project.modules.idea.proposal = proposal('Будущая версия, недоступная старому запросу');
  const replay = createRegenerationRequest(project, 'idea', answer)!;
  expect(replay.context).toEqual(old.context);
  expect(replay.context.currentDraft?.body).toBe('Первоначальная несохранённая карточка');
  expect(replay.requestId).not.toBe(old.requestId);
  const legacy = { ...answer, request: undefined };
  project.modules.idea.messages = [{ id: 'question-old', role: 'user', content: 'Прежний вопрос', createdAt }, legacy];
  const rebuilt = createRegenerationRequest(project, 'idea', legacy)!;
  expect(rebuilt.context.currentDraft).toBeUndefined();
  expect(JSON.stringify(rebuilt)).not.toContain('Будущая версия');
});
