import { expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProjectPanel } from '../../src/design-system/ProjectPanel';
import { createProject, restartChat } from '../../shared/domain';
import { coverageBasis, currentCoverage, currentReview, TOPIC_CRITERIA } from '../../shared/coverage';
import { collectMemories } from '../../shared/memory';
import { parseWorkspace, serializeWorkspace } from '../../shared/validation';
import { applyAnswer } from '../../src/features/workspace/answerRequests';
import { PROCESS_CHECK_IDS } from '../../shared/review';
import type { AssistantReply, ChatRequest } from '../../shared/types';
function sample(unavailable = false) {
  let project = createProject();
  const request: ChatRequest = { requestId: 'review-request-01', projectId: project.id, moduleId: 'idea', intent: 'message', message: 'Пожелания собирают вручную.', context: { name: 'Test', description: '', facts: [], artifacts: [], history: [] } };
  project.modules.idea.messages.push({ id: 'user-review-01', role: 'user', content: request.message, requestId: request.requestId, createdAt: '2026-11-16T10:00:00Z' });
  const review = { version: 1 as const, status: unavailable ? 'unavailable' as const : 'completed' as const, model: 'gpt-6.1-sol', subjectHash: 'a'.repeat(64), assessedAt: '2026-11-16T10:00:00Z',
    process: unavailable ? null : { status: 'needs_work' as const, note: 'Повторён уже сделанный выбор.', checks: PROCESS_CHECK_IDS.map(id => ({ id, status: id === 'questions' ? 'failed' as const : 'passed' as const, reason: id === 'questions' ? 'Сбор пожеланий уже выбран.' : 'Замечаний нет.' })) },
    result: unavailable ? null : { status: 'in_progress' as const, note: 'Механизм требует уточнения.' }, nextAction: unavailable ? null : 'Описать действия сотрудника и управляющего.', errorCode: unavailable ? 'PROVIDER_NETWORK' : null };
  const reply: AssistantReply = { message: 'Разберём процесс.', choices: [], artifactDraft: null, proposedFacts: [], memory: { facts: [], hypotheses: [], openQuestions: [], review,
    ...(unavailable ? {} : { coverage: { rubricVersion: 1 as const, moduleId: 'idea' as const, items: TOPIC_CRITERIA.idea.map(item => ({ id: item.id, status: 'missing' as const, note: 'Не обсуждалось.', support: null })), nextCriterionId: 'situation' } }) } };
  project = applyAnswer(project, request, reply);
  return project;
}
test('review, coverage and next action survive JSON reload and reach the next turn; edits/reset invalidate both', () => {
  const project = sample();
  const restored = parseWorkspace(serializeWorkspace({ version: 1, activeProjectId: project.id, projects: [project] })).projects[0];
  expect(currentReview(restored, 'idea')).toEqual(currentReview(project, 'idea'));
  expect(collectMemories(restored)[0].content.review?.nextAction).toContain('Описать действия');
  const edited = structuredClone(restored); edited.modules.idea.messages[0].content = 'Другая проблема.';
  expect(currentReview(edited, 'idea')).toBeUndefined(); expect(currentCoverage(edited, 'idea')).toBeUndefined();
  expect(collectMemories(edited)[0].content.review).toBeUndefined();
  expect(currentReview(restartChat(restored, 'idea'), 'idea')).toBeUndefined();
});
test('the panel shows separate help/result concerns and exposes concrete failures on demand', () => {
  render(<ProjectPanel project={sample()} onModuleChange={() => {}} onCalculator={() => {}} />);
  if (screen.getByRole('button', { name: 'Проработка темы' }).getAttribute('aria-expanded') === 'false') fireEvent.click(screen.getByRole('button', { name: 'Проработка темы' }));
  fireEvent.click(screen.getByText('Независимая проверка · есть замечания'));
  expect(screen.getByText('Качество помощи:')).toBeVisible();
  expect(screen.getByText('Результат:')).toBeVisible();
  expect(screen.getByText('Сбор пожеланий уже выбран.')).toBeVisible();
});
test('a failed evaluation remains visibly unassessed through reload; unavailable status also expires on edits', () => {
  const project = sample(true);
  expect(currentReview(project, 'idea')?.status).toBe('unavailable');
  expect(project.modules.idea.memory!.coverageBasis).toBe(coverageBasis(project, 'idea'));
  render(<ProjectPanel project={project} onModuleChange={() => {}} onCalculator={() => {}} />);
  if (screen.getByRole('button', { name: 'Проработка темы' }).getAttribute('aria-expanded') === 'false') fireEvent.click(screen.getByRole('button', { name: 'Проработка темы' }));
  expect(screen.getByRole('status')).toHaveTextContent('Независимая проверка сейчас недоступна');
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  const edited = structuredClone(project); edited.description = 'Новые вводные';
  expect(currentReview(edited, 'idea')).toBeUndefined();
});
