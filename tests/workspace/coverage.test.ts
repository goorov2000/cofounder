import { expect, test } from 'vitest';
import { applyAnswer } from '../../src/features/workspace/answerRequests';
import { createProject, restartChat, saveArtifact } from '../../shared/domain';
import { coverageBasis, currentCoverage, currentReview, savedCoverage, isTopicComplete, TOPIC_CRITERIA, topicCoverageSchema } from '../../shared/coverage';
import { PROCESS_CHECK_IDS } from '../../shared/review';
import { collectMemories } from '../../shared/memory';
import { parseWorkspace, serializeWorkspace } from '../../shared/validation';
import type { AssistantReply, ChatRequest } from '../../shared/types';

function answered() {
  let project = createProject();
  const request: ChatRequest = { requestId: 'coverage-request', projectId: project.id, moduleId: 'idea', intent: 'message', message: 'Знакомый составляет расписание.', context: { name: 'Проект', description: '', facts: [], artifacts: [], history: [] } };
  project.modules.idea.messages.push({ id: 'question', role: 'user', content: request.message, createdAt: '2026-11-16T10:00:00Z', requestId: request.requestId });
  const reply: AssistantReply = { message: 'Разберём сбор пожеланий.', choices: [], artifactDraft: null, proposedFacts: [], memory: { facts: [], hypotheses: [], openQuestions: [], coverage: { rubricVersion: 1, moduleId: 'idea', items: TOPIC_CRITERIA.idea.map(item => ({ id: item.id, status: 'missing', note: 'Не обсуждали.', support: null })), nextCriterionId: 'situation' } } };
  project = applyAnswer(project, request, reply);
  return { project, request, reply };
}

test('coverage survives storage and reaches future prompts without leaking the local freshness stamp', () => {
  const { project } = answered();
  expect(currentCoverage(project, 'idea')).toEqual(project.modules.idea.memory!.content.coverage);
  const restored = parseWorkspace(serializeWorkspace({ version: 1, activeProjectId: project.id, projects: [project] })).projects[0];
  expect(currentCoverage(restored, 'idea')).toEqual(currentCoverage(project, 'idea'));
  expect(collectMemories(restored)[0].content.coverage).toEqual(currentCoverage(project, 'idea'));
  expect(collectMemories(restored)[0]).not.toHaveProperty('coverageBasis');
});

test('edits and changed prerequisites invalidate coverage; old saved materials cannot manufacture progress', () => {
  const { project } = answered();
  const edited = structuredClone(project);
  edited.modules.idea.messages[0].content = 'Нет, речь о переносах уроков.';
  edited.modules.idea.messages[0].revision = 2;
  expect(currentCoverage(edited, 'idea')).toBeUndefined();
  expect(collectMemories(edited)[0].content.coverage).toBeUndefined();
  const changed = saveArtifact(project, 'audience', { title: 'Другой сегмент', body: 'Репетиторы' });
  expect(currentCoverage(changed, 'idea')).toBeUndefined();
  const old = saveArtifact(createProject(), 'idea', { title: 'Идея', body: 'Есть все заголовки' });
  expect(currentCoverage(old, 'idea')).toBeUndefined();
  expect(currentCoverage(restartChat(project, 'idea'), 'idea')).toBeUndefined();
});

test('later topics retain earlier saved assessments through navigation and reload without making them fresh', () => {
  const { project } = answered();
  const previous = structuredClone(project.modules.idea.memory!);
  project.modules.audience.messages.push({ id: 'audience-choice', role: 'user', content: 'Начнём с управляющих ресторанами.', createdAt: '2026-11-17T10:00:00Z' });
  project.core!.revision++;
  project.activeModule = 'audience';
  const restored = parseWorkspace(serializeWorkspace({ version: 1, activeProjectId: project.id, projects: [project] })).projects[0];
  restored.activeModule = 'idea';
  expect(restored.modules.idea.memory).toEqual(previous);
  expect(savedCoverage(restored, 'idea')).toEqual(previous.content.coverage);
  expect(currentCoverage(restored, 'idea')).toBeUndefined();
  expect(isTopicComplete(restored, 'idea')).toBe(false);
  expect(collectMemories(restored).find(memory => memory.moduleId === 'idea')!.content.coverage).toBeUndefined();
  restored.modules.idea.memory!.needsRefresh = true;
  expect(savedCoverage(restored, 'idea')).toEqual(previous.content.coverage);
  expect(savedCoverage(restartChat(restored, 'idea'), 'idea')).toBeUndefined();
});

test('saved assessment display rejects invalid criteria and an assessment from another topic', () => {
  const { project } = answered();
  project.modules.audience.memory = structuredClone(project.modules.idea.memory);
  expect(savedCoverage(project, 'audience')).toBeUndefined();
  project.modules.idea.memory!.content.coverage!.items.pop();
  expect(savedCoverage(project, 'idea')).toBeUndefined();
});

test('discarded replies and earlier edits cannot overwrite fresh coverage', () => {
  const { project, request, reply } = answered();
  const basis = project.modules.idea.memory!.coverageBasis;
  expect(basis).toBe(coverageBasis(project, 'idea'));
  expect(applyAnswer(project, request, reply)).toBe(project);
  const reset = restartChat(project, 'idea');
  expect(applyAnswer(reset, request, reply)).toBe(reset);
  expect(reset.modules.idea.memory).toBeUndefined();
});

test('saving the discussed proposal preserves coverage while a manual material edit requires review', () => {
  const { project } = answered();
  const draft = { title: 'Сбор пожеланий', body: 'Сотрудники сообщают пожелания в одном месте.' };
  project.modules.idea.proposal!.artifactDraft = draft;
  const saved = saveArtifact(project, 'idea', draft);
  expect(currentCoverage(saved, 'idea')).toEqual(currentCoverage(project, 'idea'));
  const edited = saveArtifact(saved, 'idea', { ...draft, body: 'Теперь делаем распределение смен.' });
  expect(currentCoverage(edited, 'idea')).toBeUndefined();
});

test('historical audience assessments remain readable and expose the new price gap without losing route access', () => {
  const project = createProject();
  project.activeModule = 'audience';
  const coverage = { rubricVersion: 1 as const, moduleId: 'audience' as const, nextCriterionId: null,
    items: TOPIC_CRITERIA.audience.filter(item => item.id !== 'price_segment').map(item => ({ id: item.id, status: 'covered' as const, note: 'Обсудили.', support: { role: 'user' as const, quote: 'Выбираю первый сегмент.' } })) };
  expect(topicCoverageSchema.safeParse(coverage).success).toBe(false);
  project.modules.audience.completedAt = '2026-11-17T10:00:00Z';
  project.unlockedStages = ['idea', 'audience', 'competitors'];
  project.modules.audience.memory = { content: { facts: [], hypotheses: [], openQuestions: [], coverage }, updatedAt: '2026-11-17T10:00:00Z', coverageBasis: coverageBasis(project, 'audience') };
  project.modules.audience.memory.content.review = { version: 1, status: 'completed', model: 'historical-judge', subjectHash: 'a'.repeat(64), assessedAt: '2026-11-17T10:00:00Z',
    process: { status: 'passed', note: 'Прежние пять пунктов проработаны.', checks: PROCESS_CHECK_IDS.map(id => ({ id, status: 'passed', reason: 'Проработано по прежним критериям.' })) },
    result: { status: 'ready', note: 'Прежние пять пунктов проработаны.' }, nextAction: null, errorCode: null };
  const restored = parseWorkspace(serializeWorkspace({ version: 1, activeProjectId: project.id, projects: [project] })).projects[0];
  expect(restored.modules.audience.memory!.content.coverage).toEqual(coverage);
  expect(currentCoverage(restored, 'audience')!.items).toHaveLength(6);
  expect(currentCoverage(restored, 'audience')!.items.find(item => item.id === 'price_segment')).toMatchObject({ status: 'missing', support: null });
  expect(collectMemories(restored)[0].content.coverage!.nextCriterionId).toBe('price_segment');
  expect(isTopicComplete(restored, 'audience')).toBe(false);
  expect(currentReview(restored, 'audience')).toBeUndefined();
  expect(restored.modules.audience.memory!.content.review!.result!.status).toBe('ready');
  expect(restored.unlockedStages).toContain('competitors');
  restored.modules.competitors.messages.push({ id: 'competitors-choice', role: 'user', content: 'Сравним ателье и самостоятельный пошив.', createdAt: '2026-11-17T11:00:00Z' });
  expect(currentCoverage(restored, 'audience')).toBeUndefined();
  expect(savedCoverage(restored, 'audience')!.items.filter(item => item.status === 'covered')).toHaveLength(5);
  expect(savedCoverage(restored, 'audience')!.nextCriterionId).toBe('price_segment');
  expect(collectMemories(restored)[0].content.coverage).toBeUndefined();
});
