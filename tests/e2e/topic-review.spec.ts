import { test, expect } from '@playwright/test';
import { TOPIC_CRITERIA } from '../../shared/coverage';
import { PROCESS_CHECK_IDS } from '../../shared/review';
import type { ChatRequest, TopicCoverage } from '../../shared/types';
import { expandCoverage } from './project-panel';

for (const theme of ['light', 'dark'] as const) for (const width of [1440, 390]) {
  test('independent review, follow-up and unavailable state at ' + width + 'px ' + theme, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    const requests: ChatRequest[] = [];
    await page.route('**/api/**', route => {
      if (route.request().url().endsWith('/status')) return route.fulfill({ json: { configured: true, reason: '', model: 'mock-only', searchEnabled: false } });
      const request = route.request().postDataJSON() as ChatRequest; requests.push(request);
      const unavailable = requests.length === 3, first = requests.length === 1;
      const coverage: TopicCoverage = { rubricVersion: 1, moduleId: 'idea', items: TOPIC_CRITERIA.idea.map(criterion => ({ id: criterion.id, status: criterion.id === 'situation' ? 'covered' : 'missing', note: "Нужно обсудить этот пункт.", support: criterion.id === 'situation' ? { role: 'user', quote: request.message } : null })), nextCriterionId: 'problem' };
      const review = { version: 1, status: unavailable ? 'unavailable' : 'completed', model: 'mock-judge', subjectHash: 'a'.repeat(64), assessedAt: '2026-11-16T10:00:00Z',
        process: unavailable ? null : { status: first ? 'needs_work' : 'passed', note: first ? 'Повторён уже сделанный выбор.' : 'Использован выбранный объём.', checks: PROCESS_CHECK_IDS.map(id => ({ id, status: first && id === 'questions' ? 'failed' : 'passed', reason: first && id === 'questions' ? 'Не нужно снова выбирать сбор пожеланий.' : 'Замечаний нет.' })) },
        result: unavailable ? null : { status: 'in_progress', note: 'Нужно описать механизм помощи.' }, nextAction: unavailable ? null : 'Описать действия сотрудника и ответственного.', errorCode: unavailable ? 'PROVIDER_NETWORK' : null };
      return route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: { message: 'Полезный ответ номер ' + requests.length, choices: [], artifactDraft: null, proposedFacts: [], memory: { facts: [], hypotheses: [], openQuestions: [], ...(unavailable ? {} : { coverage }), review } } } });
    });
    await page.goto('/');
    const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
    await input.fill('Друг вручную собирает пожелания сотрудников ресторана.'); await input.press('Enter');
    await expect(page.locator('.workspace-message.assistant').last()).toContainText('номер 1');
    await expandCoverage(page);
    const panel = page.locator('.ds-project-panel');
    const summary = panel.locator('.ds-coverage-review summary');
    await expect(summary).toHaveText('Независимая проверка · есть замечания');
    await summary.focus(); await page.keyboard.press('Enter');
    await expect(panel.getByText('Не нужно снова выбирать сбор пожеланий.')).toBeVisible();
    await expect(panel.getByText('Качество помощи:')).toBeVisible();
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: '.repair/2026-11-16-panel-progress/review-' + width + '-' + theme + '.png' });
    if (width < 900) await page.keyboard.press('Escape');
    await input.fill('Опиши действия сотрудника и управляющего.'); await input.press('Enter');
    await expect(page.locator('.workspace-message.assistant').last()).toContainText('номер 2');
    expect(requests[1].context.memories?.[0].content.review?.nextAction).toBe('Описать действия сотрудника и ответственного.');
    await page.reload(); await expandCoverage(page);
    await expect(summary).toHaveText('Независимая проверка · обсуждение продолжается');
    if (width < 900) await page.keyboard.press('Escape');
    await input.fill('Проверка временно недоступна.'); await input.press('Enter');
    await expect(page.locator('.workspace-message.assistant').last()).toContainText('номер 3');
    await expandCoverage(page);
    await expect(panel.getByRole('status')).toContainText('полнота темы не оценена');
    await expect(panel.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    await page.reload(); await expandCoverage(page);
    await expect(panel.getByRole('status')).toContainText('Независимая проверка сейчас недоступна');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
