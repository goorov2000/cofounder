import { test, expect } from '@playwright/test';
import { TOPIC_CRITERIA } from '../../shared/coverage';
import type { ChatRequest, TopicCoverage } from '../../shared/types';
import { expandCoverage } from './project-panel';

for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390]) {
  test(`topic progress follows complete replies and survives reload at ${width}px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    const requests: ChatRequest[] = [];
    await page.route('**/api/**', route => {
      if (route.request().url().endsWith('/status')) return route.fulfill({ json: { configured: true, reason: '', model: 'mock-only', searchEnabled: false } });
      if (!route.request().url().endsWith('/chat')) return route.abort();
      const request = route.request().postDataJSON() as ChatRequest;
      requests.push(request);
      const selected = requests.length > 1;
      const coverage: TopicCoverage = { rubricVersion: 1, moduleId: 'idea', nextCriterionId: selected ? 'solution' : 'scope', items: TOPIC_CRITERIA.idea.map(criterion => ({ id: criterion.id, status: ['situation', 'problem', 'alternative', ...(selected ? ['scope'] : [])].includes(criterion.id) ? 'covered' : 'partial', note: criterion.id === 'scope' ? selected ? 'Выбран сбор пожеланий без распределения смен.' : 'Нужно выбрать объём помощи.' : "Нужно обсудить этот пункт.", support: { role: 'user', quote: request.message } })) };
      return route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: { message: selected ? 'Разберём, как сотрудники сообщают пожелания.' : 'Можно начать со сбора пожеланий, оставив Excel для графика.', choices: [], artifactDraft: null, proposedFacts: [], memory: {
        facts: [{ text: 'Друг составляет расписание ресторана в Excel и вручную собирает пожелания.', evidence: 'Друг составляет расписание' }], hypotheses: ['Скрытая гипотеза.'], openQuestions: ['Повторный старый вопрос.'], coverage,
      } } } });
    });
    await page.goto('/');
    const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
    await input.fill('Друг составляет расписание ресторана в Excel и вручную собирает пожелания.');
    await input.press('Enter');
    await expect(page.locator('.workspace-message.assistant').last()).toContainText('Можно начать со сбора пожеланий');
    await expandCoverage(page);
    const panel = page.locator('.ds-project-panel');
    const progress = panel.getByRole('progressbar', { name: 'Проработка темы' });
    await expect(progress).toHaveAttribute('aria-valuenow', '3');
    await expect(panel.getByText('Сейчас: границы решения')).toBeVisible();
    await expect(panel.getByText('Предположения', { exact: true })).toHaveCount(0);
    await expect(panel.getByText('Осталось уточнить', { exact: true })).toHaveCount(0);
    await expect(panel.getByText('Скрытая гипотеза.')).toHaveCount(0);
    if (width < 900) await page.keyboard.press('Escape');
    await input.fill('Выбираю только сбор пожеланий, распределение смен пока оставим в Excel.');
    await input.press('Enter');
    await expect(page.locator('.workspace-message.assistant').last()).toContainText('Разберём');
    expect(requests[1].context.memories?.find(memory => memory.moduleId === 'idea')?.content.coverage?.nextCriterionId).toBe('scope');
    await expandCoverage(page);
    await expect(progress).toHaveAttribute('aria-valuenow', '4');
    await expect(panel.getByText('Сейчас: как поможет решение')).toBeVisible();
    await page.reload();
    await expandCoverage(page);
    await expect(progress).toHaveAttribute('aria-valuenow', '4');
    await panel.getByText('Границы решения', { exact: true }).click();
    await expect(panel.getByText('Выбран сбор пожеланий без распределения смен.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `.repair/2026-11-16-panel-progress/coverage-${width}-${theme}.png` });
  });
}
