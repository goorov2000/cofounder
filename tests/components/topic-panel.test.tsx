import { expect, test } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ProjectPanel } from '../../src/design-system/ProjectPanel';
import { createProject } from '../../shared/domain';
import { coverageBasis, currentCoverage, TOPIC_CRITERIA } from '../../shared/coverage';

test('the panel separates known context and criteria and counts coverage rather than messages or saved results', () => {
  const project = createProject();
  project.modules.idea.memory = { updatedAt: '2026-11-16T10:00:00Z', content: {
    facts: [{ text: 'Ответственный собирает пожелания вручную.', evidence: 'собирает пожелания вручную' }],
    hypotheses: ['Скрытое предположение.'], openQuestions: ['Старый вопрос.'],
    coverage: { rubricVersion: 1, moduleId: 'idea', items: TOPIC_CRITERIA.idea.map((criterion, index) => ({ id: criterion.id, status: index < 3 ? 'covered' : 'partial', note: 'Пояснение критерия.', support: { role: 'user', quote: 'собирает пожелания вручную' } })), nextCriterionId: 'scope' },
  } };
  project.modules.idea.memory.coverageBasis = coverageBasis(project, 'idea');
  render(<ProjectPanel project={project} onModuleChange={() => {}} onCalculator={() => {}} />);
  const context = screen.getByRole('button', { name: 'Контекст проекта' });
  const coverage = screen.getByRole('button', { name: 'Проработка темы' });
  expect(context).toHaveAttribute('aria-expanded', 'false');
  expect(coverage).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('progressbar', { name: 'Проработка темы' })).toBeVisible();
  fireEvent.click(context);
  expect(context).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('Ответственный собирает пожелания вручную.')).toBeVisible();
  fireEvent.click(coverage);
  expect(context).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('Ответственный собирает пожелания вручную.').closest('.ds-disclosure')).toHaveAttribute('aria-hidden', 'true');
  const progress = screen.getByRole('progressbar', { name: 'Проработка темы' });
  expect(progress).toHaveAttribute('aria-valuenow', '3');
  expect(progress).toHaveAttribute('aria-valuemax', '7');
  expect(screen.queryByText('Скрытое предположение.')).toBeNull();
  expect(screen.queryByText('Старый вопрос.')).toBeNull();
  const section = screen.getByRole('region', { name: 'Проработка темы' });
  expect(within(section).getByText('Сейчас: границы решения')).toBeVisible();
  fireEvent.click(within(section).getByText('Границы решения'));
  expect(within(section).getAllByText('Пояснение критерия.').some(element => element.closest('details')?.open)).toBe(true);
  fireEvent.click(context);
  expect(coverage).toHaveAttribute('aria-expanded', 'false');
  expect(progress).toBeVisible();
  expect(screen.getByText('Ответственный собирает пожелания вручную.')).toBeVisible();
  fireEvent.click(context);
  expect(context).toHaveAttribute('aria-expanded', 'false');
});

test('a topic with no saved assessment has an explicit unassessed state', () => {
  const project = createProject();
  project.modules.idea.artifact = { title: 'Старый итог', body: 'Все разделы заполнены', revision: 1, savedAt: '2026-11-16T10:00:00Z', stale: false };
  render(<ProjectPanel project={project} onModuleChange={() => {}} onCalculator={() => {}} />);
  if (screen.getByRole('button', { name: 'Проработка темы' }).getAttribute('aria-expanded') === 'false') fireEvent.click(screen.getByRole('button', { name: 'Проработка темы' }));
  expect(screen.getByText('Ещё не оценено')).toBeVisible();
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  expect(screen.getAllByText('Не оценено')).toHaveLength(7);
});

test('pending updates label the last valid assessment and never publish it as a fresh completed topic', () => {
  const project = createProject();
  const previous = { rubricVersion: 1 as const, moduleId: 'idea' as const, items: TOPIC_CRITERIA.idea.map(criterion => ({ id: criterion.id, status: 'covered' as const, note: 'Обсуждалось в прошлом ответе.', support: { role: 'user' as const, quote: 'собирает пожелания вручную' } })), nextCriterionId: null };
  project.modules.idea.memory = { updatedAt: '2026-11-16T10:00:00Z', content: { facts: [], hypotheses: [], openQuestions: [], coverage: previous }, coverageBasis: coverageBasis(project, 'idea') };
  project.modules.idea.messages.push({ id: 'pending', role: 'user', content: 'Меняем направление.', status: 'pending', createdAt: '2026-11-16T10:01:00Z' });
  expect(currentCoverage(project, 'idea')).toBeUndefined();
  const props = { project, onModuleChange: () => {}, onCalculator: () => {} };
  const { rerender } = render(<ProjectPanel {...props} coverageUpdate={{ reviewing: false, previous }} />);
  const bar = screen.getByRole('progressbar');
  expect(bar).toHaveAttribute('aria-busy', 'true');
  expect(bar).toHaveAttribute('aria-valuenow', '7');
  expect(bar).toHaveAttribute('aria-valuetext', 'Предыдущая оценка: 7 из 7. Обновляется');
  expect(screen.getByRole('status')).toHaveTextContent('Показана предыдущая оценка.');
  if (screen.getByRole('button', { name: 'Проработка темы' }).getAttribute('aria-expanded') === 'false') fireEvent.click(screen.getByRole('button', { name: 'Проработка темы' }));
  expect(screen.queryByText('Ещё не оценено')).toBeNull();
  expect(screen.queryByText('Прогресс обновится со следующим ответом.')).toBeNull();
  expect(screen.queryByText('Тема проработана. Можно обсудить итог.')).toBeNull();
  rerender(<ProjectPanel {...props} coverageUpdate={{ reviewing: true, previous }} />);
  expect(screen.getByRole('status')).toHaveTextContent('Проверяю полноту темы…');
  rerender(<ProjectPanel {...props} coverageUpdate={{ reviewing: true }} />);
  expect(bar).toHaveAttribute('aria-valuenow', '7');
  rerender(<ProjectPanel {...props} />);
  expect(bar).toHaveAttribute('aria-busy', 'false');
  expect(bar).toHaveAttribute('aria-valuenow', '7');
  expect(bar).toHaveAttribute('aria-valuetext', 'Предыдущая оценка: 7 из 7. Обновится со следующим ответом');
  expect(screen.getByRole('status')).toHaveTextContent('Показана предыдущая оценка. Новые вводные учтём со следующим ответом.');
  expect(screen.queryByText('Ещё не оценено')).toBeNull();
  expect(screen.queryByText('Тема проработана. Можно перейти дальше или продолжить обсуждение.')).toBeNull();
  project.modules.idea.memory!.coverageBasis = coverageBasis(project, 'idea');
  rerender(<ProjectPanel {...props} />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(bar).toHaveAttribute('aria-valuetext', 'Обсуждено 7 из 7 критериев');
});

test('returning after competitors shows historical audience criteria and its new price gap', () => {
  const project = createProject();
  project.activeModule = 'audience';
  project.unlockedStages = ['idea', 'audience', 'competitors', 'market'];
  project.modules.audience.messages = [{ id: 'chosen-segment', role: 'user', content: 'Уже заказывающие и переделывающие', createdAt: '2026-11-17T10:00:00Z' }];
  project.modules.audience.memory = { updatedAt: '2026-11-17T10:00:00Z', content: { facts: [], hypotheses: [], openQuestions: [], coverage: {
    rubricVersion: 1, moduleId: 'audience', nextCriterionId: null, items: TOPIC_CRITERIA.audience.filter(criterion => criterion.id !== 'price_segment').map(criterion => ({ id: criterion.id, status: 'covered', note: 'Сохранённое пояснение.', support: { role: 'user', quote: 'Уже заказывающие и переделывающие' } })),
  } } };
  project.modules.audience.memory.coverageBasis = coverageBasis(project, 'audience');
  project.modules.competitors.messages.push({ id: 'competitor-question', role: 'user', content: 'Сравним с ателье.', createdAt: '2026-11-17T11:00:00Z' });
  expect(currentCoverage(project, 'audience')).toBeUndefined();
  render(<ProjectPanel project={project} onModuleChange={() => {}} onCalculator={() => {}} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '6');
  expect(screen.getByRole('status')).toHaveTextContent('Показана предыдущая оценка.');
  expect(screen.getByText('По предыдущей оценке осталось: ценовой сегмент и готовность платить')).toBeVisible();
  expect(screen.getAllByText('Обсуждено')).toHaveLength(5);
  expect(screen.getByText('Впереди')).toBeVisible();
  expect(screen.queryByText('Ещё не оценено')).toBeNull();
  expect(screen.queryByText('Не оценено')).toBeNull();
});
