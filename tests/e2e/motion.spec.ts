import { test, expect } from '@playwright/test';
import { createProject } from '../../shared/domain';
import { STAGE_IDS } from '../../shared/modules';
import { expandRoute, openProjectPanel } from './project-panel';

for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 390, 320]) {
  test(`route becomes coverage once, with working manual controls at ${width}px ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
    const project = createProject(); project.unlockedStages = [...STAGE_IDS];
    await page.addInitScript(project => { if (!localStorage.getItem('cofounder.workspace.v1')) localStorage.setItem('cofounder.workspace.v1', JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] })); }, project);
    await page.route('**/api/**', route => route.request().url().endsWith('/status')
      ? route.fulfill({ json: { configured: true, reason: '', model: 'mock-only', searchEnabled: false } })
      : route.fulfill({ json: { requestId: route.request().postDataJSON().requestId, model: 'mock-only', reply: { message: 'Продолжаем проработку.', choices: [], artifactDraft: null, proposedFacts: [] } } }));
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Подключение AI', exact: true })).toHaveText(/^AI подключён/);
    const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
    const route = page.getByRole('button', { name: 'Маршрут проекта', exact: true });
    const coverage = page.getByRole('button', { name: 'Проработка темы', exact: true });
    await openProjectPanel(page);
    await expect(route).toHaveAttribute('aria-expanded', 'true');
    if (width < 900) await page.keyboard.press('Escape');
    await input.fill('Первое сообщение об идее');
    if (width >= 900) {
      await expect(route).toHaveAttribute('aria-expanded', 'true');
      await page.evaluate(() => document.documentElement.style.setProperty('--ds-motion-layout', '1000ms'));
    }
    await input.press('Enter');
    await openProjectPanel(page);
    await expect(coverage).toHaveAttribute('aria-expanded', 'true');
    await expect(route).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.ds-project-route .ds-disclosure')).toHaveAttribute('inert');
    if (width >= 900) {
      const durations = await page.locator('.ds-project-coverage .ds-disclosure').evaluate(el => el.getAnimations().map(animation => animation.effect!.getTiming().duration));
      expect(durations).toContain(1000);
    }
    await expect(page.locator('.ds-project-route .ds-disclosure')).toBeHidden();
    await expect(page.locator('.ds-topic-coverage')).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `.repair/2026-11-16-motion/coverage-${width}-${colorScheme}.png` });
    if (width < 900) await page.keyboard.press('Escape');
    await expect(page.getByText('Продолжаем проработку.', { exact: true })).toBeVisible();
    await expandRoute(page);
    if (width < 900) await page.keyboard.press('Escape');
    // On desktop this manual selection must survive a further answer.
    await input.fill('Следующее уточнение'); await input.press('Enter');
    await expect(page.getByText('Продолжаем проработку.', { exact: true })).toHaveCount(2);
    if (width >= 900) await expect(route).toHaveAttribute('aria-expanded', 'true');
    await page.reload();
    await openProjectPanel(page);
    await expect(coverage).toHaveAttribute('aria-expanded', 'true');
    await expandRoute(page);
    await page.getByRole('button', { name: 'Аудитория', exact: true }).click();
    await openProjectPanel(page);
    await expect(route).toHaveAttribute('aria-expanded', 'true');
    await expect(coverage).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('shared motion honours reduced motion and can cancel an in-flight title', async ({ page }) => {
  await page.goto('/design-system#motion');
  const sample = page.locator('#motion');
  await sample.getByRole('button', { name: 'Отправить первое сообщение в пример', exact: true }).click();
  await expect(sample.getByRole('button', { name: 'Проработка темы', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await sample.getByRole('button', { name: 'Маршрут проекта', exact: true }).press('Enter');
  await sample.getByRole('button', { name: 'Добавить ответ в пример', exact: true }).click();
  await expect(sample.getByRole('button', { name: 'Маршрут проекта', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await sample.getByRole('button', { name: 'Вернуть первый экран', exact: true }).click();
  await sample.getByRole('button', { name: 'Отправить первое сообщение в пример', exact: true }).click();
  await expect(sample.getByText('Движение отключено настройкой устройства.', { exact: true })).toBeVisible();
  expect(await sample.locator('.ds-project-coverage .ds-disclosure').evaluate(el => el.getAnimations().length)).toBe(0);
  const intro = page.locator('.ds-stage-preview');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => document.documentElement.style.setProperty('--ds-motion-journey', '3000ms'));
  await intro.getByRole('button', { name: 'Начать этап', exact: true }).click();
  await expect(page.locator('.ds-stage-title-flight')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.ds-stage-title-flight')).toHaveCount(0);
  await expect(intro.locator('h3')).toBeVisible();
});
