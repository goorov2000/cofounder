import { expect, test } from 'vitest';
import { TOPIC_CRITERIA, topicCoverageSchema } from '../../shared/coverage';
import { MODULES } from '../../shared/modules';
import { validateReply } from '../../server/validation';
import { buildPrompt } from '../../server/prompt';
import { retrieveKnowledge } from '../../server/knowledge';
import type { AssistantReply, ChatRequest, TopicCoverage } from '../../shared/types';

const request: ChatRequest = { requestId: 'coverage-request', projectId: 'coverage-project', moduleId: 'idea', intent: 'message', message: 'Друг в ресторане собирает пожелания сотрудников по выходным вручную.', context: { name: 'Проект', description: '', facts: [], artifacts: [], history: [] } };
function coverage(moduleId: TopicCoverage['moduleId'] = 'idea'): TopicCoverage {
  return { rubricVersion: 1, moduleId, items: TOPIC_CRITERIA[moduleId].map(item => ({ id: item.id, status: 'missing', note: 'Пока не обсуждали.', support: null })), nextCriterionId: TOPIC_CRITERIA[moduleId][0].id };
}
function reply(value: TopicCoverage): AssistantReply {
  return { message: 'Предлагаю начать со сбора пожеланий.', choices: [], artifactDraft: null, proposedFacts: [], memory: { facts: [], hypotheses: [], openQuestions: [], coverage: value } };
}

test('all stages and tools have complete, unique, versioned coverage contracts', () => {
  expect(Object.keys(TOPIC_CRITERIA).sort()).toEqual(Object.keys(MODULES).sort());
  for (const id of Object.keys(MODULES) as TopicCoverage['moduleId'][]) {
    expect(topicCoverageSchema.safeParse(coverage(id)).success).toBe(true);
    const duplicate = coverage(id); duplicate.items[1] = duplicate.items[0];
    expect(topicCoverageSchema.safeParse(duplicate).success).toBe(false);
    const missing = coverage(id); missing.items.pop();
    expect(topicCoverageSchema.safeParse(missing).success).toBe(false);
  }
});

test('coverage is grounded without making a useful answer fail or accepting an assistant suggestion as user choice', () => {
  const value = coverage();
  value.items[0] = { ...value.items[0], status: 'covered', support: { role: 'user', quote: 'Друг в ресторане' } };
  value.items[1] = { ...value.items[1], status: 'covered', support: { role: 'user', quote: 'Теряет двадцать часов в неделю.' } };
  value.items.find(item => item.id === 'scope')!.status = 'covered';
  value.items.find(item => item.id === 'scope')!.support = { role: 'assistant', quote: 'Предлагаю начать со сбора пожеланий.' };
  value.nextCriterionId = null;
  const result = validateReply(reply(value), request);
  expect(result.message).toBe(reply(value).message);
  expect(result.memory!.coverage!.items[0].status).toBe('covered');
  expect(result.memory!.coverage!.items[1]).toMatchObject({ status: 'missing', support: null });
  expect(result.memory!.coverage!.items.find(item => item.id === 'scope')!.status).toBe('partial');
  expect(result.memory!.coverage!.nextCriterionId).toBe('problem');
});

test('a factual user choice can close scope; another stage cannot populate the active progress', () => {
  const value = coverage();
  value.items.find(item => item.id === 'scope')!.status = 'covered';
  value.items.find(item => item.id === 'scope')!.support = { role: 'user', quote: 'Начнём только со сбора пожеланий' };
  const result = validateReply(reply(value), { ...request, message: 'Начнём только со сбора пожеланий' });
  expect(result.memory!.coverage!.items.find(item => item.id === 'scope')!.status).toBe('covered');
  expect(validateReply(reply(coverage('audience')), request).memory!.coverage).toBeUndefined();
});

test('research coverage cannot become complete from an unperformed search', () => {
  const value = coverage('competitors');
  const item = value.items.find(item => item.id === 'sources')!;
  item.status = 'covered'; item.support = { role: 'assistant', quote: 'Предлагаю начать со сбора пожеланий.' };
  const result = validateReply(reply(value), { ...request, moduleId: 'competitors' });
  expect(result.memory!.coverage!.items.find(item => item.id === 'sources')!.status).toBe('partial');
});

test('audience price positioning requires a user choice rather than an assistant recommendation', () => {
  const value = coverage('audience');
  const item = value.items.find(item => item.id === 'price_segment')!;
  item.status = 'covered'; item.support = { role: 'assistant', quote: 'Предлагаю начать со сбора пожеланий.' };
  const result = validateReply(reply(value), { ...request, moduleId: 'audience' });
  expect(result.memory!.coverage!.items.find(item => item.id === 'price_segment')!.status).toBe('partial');
  item.support = { role: 'user', quote: 'Начнём со среднего ценового сегмента как гипотезы' };
  const chosen = validateReply(reply(value), { ...request, moduleId: 'audience', message: 'Начнём со среднего ценового сегмента как гипотезы' });
  expect(chosen.memory!.coverage!.items.find(item => item.id === 'price_segment')!.status).toBe('covered');
});

test('a proposed gap cannot skip missing prerequisites at the beginning of idea discovery', () => {
  const value = coverage(); value.nextCriterionId = 'scope';
  const result = validateReply(reply(value), request);
  expect(result.memory!.coverage!.nextCriterionId).toBe('situation');
});

test('the unresolved criterion selects relevant methodology even when the next reply has no task keywords', () => {
  const value = coverage('business'); value.nextCriterionId = 'channel';
  const result = retrieveKnowledge({ ...request, moduleId: 'business', message: 'Не знаю', context: { ...request.context, memories: [{ moduleId: 'business', content: { facts: [], hypotheses: [], openQuestions: [], coverage: value }, updatedAt: '2026-11-16T10:00:00Z' }] } });
  expect(result[0]).toMatchObject({ id: 'M18', selectionReason: expect.arrayContaining(['coverage:channel']) });
});

test('the next action cannot point at a completed criterion, and every generation receives the full rubric', () => {
  const value = coverage();
  value.items[0] = { ...value.items[0], status: 'covered', support: { role: 'user', quote: 'Друг в ресторане' } };
  expect(topicCoverageSchema.safeParse(value).success).toBe(false);
  for (const id of Object.keys(MODULES) as TopicCoverage['moduleId'][]) {
    const input = JSON.parse(buildPrompt({ ...request, moduleId: id, message: 'Спасибо!' }).input);
    expect(input.contextCoverage.criteria).toEqual(TOPIC_CRITERIA[id]);
  }
});
