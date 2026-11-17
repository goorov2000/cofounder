import { expect, test } from 'vitest';
import { createProject, getAccess, getUnlockedStages, restartChat } from '../../shared/domain';
import { currentCoverage, wasTopicCompleted, TOPIC_CRITERIA } from '../../shared/coverage';
import { parseWorkspace, serializeWorkspace } from '../../shared/validation';
import { collectArtifacts, collectCurrentDraft } from '../../shared/chatContext';
import { applyAnswer } from '../../src/features/workspace/answerRequests';
import type { AssistantReply, ChatRequest, Project, StageId } from '../../shared/types';

function answer(project: Project, moduleId: StageId, complete: boolean) {
  const request: ChatRequest = { requestId: crypto.randomUUID(), projectId: project.id, moduleId, intent: 'message', message: 'Выбранный сценарий проекта.', context: { name: project.name, description: '', facts: [], artifacts: [], history: [] } };
  const pending = { ...project, unlockedStages: getUnlockedStages(project), modules: { ...project.modules, [moduleId]: { ...project.modules[moduleId], messages: [...project.modules[moduleId].messages, { id: crypto.randomUUID(), role: 'user' as const, requestId: request.requestId, content: request.message, createdAt: new Date().toISOString() }] } } };
  const reply: AssistantReply = { message: 'В целом понял тему.', choices: [], artifactDraft: null, proposedFacts: [], memory: { facts: [], hypotheses: [], openQuestions: [], coverage: { rubricVersion: 1, moduleId, nextCriterionId: complete ? null : TOPIC_CRITERIA[moduleId][0].id, items: TOPIC_CRITERIA[moduleId].map((criterion, index) => ({ id: criterion.id, status: complete || index > 0 ? 'covered' : 'partial', note: 'Синтетическая проверка перехода.', support: { role: 'user', quote: request.message } })) } } };
  return applyAnswer(pending, request, reply);
}

test('only complete coverage unlocks the next topic, without a card; access survives reload, edits and restarting an earlier chat', () => {
  const fresh = createProject();
  expect(getAccess(fresh, 'audience').allowed).toBe(false);
  expect(getAccess(answer(fresh, 'idea', false), 'audience').allowed).toBe(false);
  let project = answer(fresh, 'idea', true);
  expect(project.modules.idea.artifact).toBeNull();
  expect(project.modules.idea.proposal?.artifactDraft).toBeNull();
  expect(getAccess(project, 'audience').allowed).toBe(true);
  expect(getAccess(project, 'competitors').allowed).toBe(false);
  expect(getAccess(project, 'team').allowed).toBe(false);
  project = parseWorkspace(serializeWorkspace({ version: 1, activeProjectId: project.id, projects: [project] })).projects[0];
  project = { ...project, activeModule: 'audience', description: 'Новое существенное уточнение.' };
  expect(currentCoverage(project, 'idea')).toBeUndefined();
  expect(getAccess(project, 'idea').allowed).toBe(true);
  expect(getAccess(project, 'audience').allowed).toBe(true);
  project = answer(project, 'audience', true);
  expect(getAccess(project, 'competitors').allowed).toBe(true);
  expect(wasTopicCompleted(project,'idea')).toBe(true);
  expect(wasTopicCompleted(project,'audience')).toBe(true);
  expect(project.modules.idea.completedAt).toBeTruthy();
  expect(getAccess(project, 'market').allowed).toBe(false);
  const restarted = restartChat(project, 'idea');
  expect(getAccess(restarted, 'audience').allowed).toBe(true);
  expect(getAccess(restarted, 'competitors').allowed).toBe(true);
  expect(getAccess(restarted, 'market').allowed).toBe(false);
});

test('internal result survives a later answer without a draft and reaches other topics with proposal provenance', () => {
  let project = answer(createProject(), 'idea', true);
  const body = 'Важное условие: оборудование оплачивается отдельно.';
  project.modules.idea.proposal!.artifactDraft = { title: 'Рабочая идея', body };
  project = answer(project, 'idea', true);
  expect(collectCurrentDraft(project, 'idea')?.body).toBe(body);
  expect(collectArtifacts(project, 'audience')).toContainEqual({ moduleId: 'idea', title: 'Рабочая идея', body, stale: false, provenance: 'assistant_proposal' });
  expect(project.facts).toEqual({});
  const reset = restartChat(project, 'idea');
  expect(collectArtifacts(reset, 'audience')).toEqual([]);
});


test('a legacy completed topic retains access when the next answer updates its coverage', () => {
  const legacy = answer(createProject(), 'idea', true);
  delete legacy.unlockedStages;
  const next = answer(legacy, 'idea', false);
  expect(getAccess(next, 'audience').allowed).toBe(true);
  expect(getAccess(next, 'competitors').allowed).toBe(false);
});
