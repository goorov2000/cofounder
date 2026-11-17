import { test, expect } from '@playwright/test';
import { createProject } from '../../shared/domain';
import { TOPIC_CRITERIA, coverageBasis } from '../../shared/coverage';
import { expandCoverage, expandRoute } from './project-panel';

test('old audience progress exposes the price gap after reload and retains the conversation and open route', async ({ page }) => {
  const project = createProject();
  project.activeModule = 'audience';
  project.unlockedStages = ['idea', 'audience', 'competitors'];
  const state = project.modules.audience;
  const time = '2026-11-17T10:00:00Z';
  state.completedAt = time;
  state.messages = [{ id: 'audience-user', role: 'user', content: 'Начнём с людей, которые уже заказывали одежду под свой стиль.', createdAt: time }];
  state.memory = { updatedAt: time, content: { facts: [], hypotheses: [], openQuestions: [], coverage: {
    rubricVersion: 1, moduleId: 'audience', nextCriterionId: null,
    items: TOPIC_CRITERIA.audience.filter(item => item.id !== 'price_segment').map(item => ({ id: item.id, status: 'covered', note: 'Обсуждали ранее.', support: { role: 'user', quote: state.messages[0].content } })),
  } } };
  state.memory.coverageBasis = coverageBasis(project, 'audience');
  let chatCalls = 0;
  await page.route('**/api/**', route => {
    if (route.request().url().endsWith('/status')) return route.fulfill({ json: { configured: true, model: 'mock-only', reason: '', searchEnabled: false } });
    chatCalls++; return route.abort();
  });
  await page.addInitScript(project => {
    if (!localStorage.getItem('cofounder.workspace.v1')) localStorage.setItem('cofounder.workspace.v1', JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] }));
  }, project);
  await page.goto('/');
  for (let pass = 0; pass < 2; pass++) {
    await expandCoverage(page);
    const progress = page.getByRole('progressbar', { name: 'Проработка темы' });
    await expect(progress).toHaveAttribute('aria-valuenow', '5');
    await expect(progress).toHaveAttribute('aria-valuemax', '6');
    await expect(page.getByText('Сейчас: ценовой сегмент и готовность платить', { exact: true })).toBeVisible();
    await expect(page.locator('.workspace-message.user')).toContainText(state.messages[0].content);
    await expect(page.locator('.ds-topic-completion')).toHaveCount(0);
    await expandRoute(page);
    await expect(page.getByRole('button', { name: 'Конкуренты', exact: true })).toHaveAttribute('aria-disabled', 'false');
    if (!pass) await page.reload();
  }
  expect(chatCalls).toBe(0);
  await expandCoverage(page);
  await page.screenshot({ path: '.repair/2026-11-17-high-limits-audience/audience-5-of-6.png' });
});
