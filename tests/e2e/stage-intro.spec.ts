import { test, expect } from '@playwright/test';
import { createProject } from '../../shared/domain';
import { MODULES, STAGE_IDS, TOOL_IDS } from '../../shared/modules';
import type { ChatRequest } from '../../shared/types';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.request().url().endsWith('/status')
    ? route.fulfill({ json: { configured: true, reason: '', model: 'mock-only', searchEnabled: false } })
    : route.abort());
});

for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 1024, 390, 320]) {
  test(`all stage and tool introductions at ${width}px ${colorScheme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 1024 ? 600 : 844 });
    await page.emulateMedia({ colorScheme });
    let requests = 0;
    await page.route('**/api/chat', route => { requests++; return route.abort(); });
    await page.goto('/');
    for (const id of [...STAGE_IDS, ...TOOL_IDS]) {
      const project = createProject();
      project.activeModule = id;
      project.unlockedStages = [...STAGE_IDS];
      project.description = 'Тестовое описание проекта. Оно остаётся в контексте.';
      await page.evaluate(project => localStorage.setItem('cofounder.workspace.v1', JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] })), project);
      await page.reload();
      const intro = page.locator('.workspace-welcome');
      const title = intro.getByRole('heading', { name: MODULES[id].title, exact: true });
      await expect(title).toBeInViewport({ ratio: 1 });
      await expect(page.locator('.workspace-stage h1')).toHaveCount(0);
      await expect(intro.locator('.ds-stage-intro-description')).toHaveText(MODULES[id].welcome);
      await expect(intro).not.toContainText('Тестовое описание проекта');
      await expect(intro.getByRole('button', { name: 'Начать этап', exact: true })).toBeInViewport({ ratio: 1 });
      expect(await title.evaluate(el => getComputedStyle(el).textTransform)).toBe('uppercase');
      expect(await intro.locator('.ds-stage-intro-description').evaluate(el => getComputedStyle(el).fontSize)).toBe('14px');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (id === 'audience' || id === 'competitors') await page.screenshot({ path: `.repair/2026-11-16-stage-intro/${id}-${width}-${colorScheme}.png` });
    }
    expect(requests).toBe(0);
  });
}

for (const entry of ['typed', 'starter', 'reduced-motion'] as const) {
  test(`${entry}: first send relocates the title once and keeps the next draft`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: entry === 'reduced-motion' ? 'reduce' : 'no-preference' });
    await page.addInitScript(() => {
      const original = Element.prototype.animate;
      (window as any).titleFlights = [];
      Element.prototype.animate = function (keyframes, options) {
        if (this.classList.contains('ds-stage-title-flight')) (window as any).titleFlights.push({ keyframes, options });
        return original.call(this, keyframes, options);
      };
    });
    let release = () => {};
    const hold = new Promise<void>(resolve => { release = resolve; });
    const sent: ChatRequest[] = [];
    await page.route('**/api/chat', async route => {
      const request = route.request().postDataJSON() as ChatRequest;
      sent.push(request);
      await hold;
      await route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: { message: 'Начнём с конкретной задачи.', choices: [], artifactDraft: null, proposedFacts: [] } } });
    });
    await page.goto('/');
    const title = page.locator('.workspace-welcome h1');
    const origin = (await title.boundingBox())!;
    const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
    await input.fill('Хочу помочь мастерским');
    await expect(title).toBeVisible();
    expect(sent).toHaveLength(0);
    if (entry === 'starter') await page.getByRole('button', { name: 'Есть идея', exact: true }).press('Enter');
    else await input.press('Enter');
    await expect(page.locator('.workspace-welcome')).toHaveCount(0);
    const header = page.locator('.workspace-stage h1');
    await expect(header).toHaveText('Идея проекта');
    await expect(header).toBeVisible();
    const flights = await page.evaluate(() => (window as any).titleFlights);
    expect(flights).toHaveLength(entry === 'reduced-motion' ? 0 : 1);
    if (entry !== 'reduced-motion') {
      expect(Number.parseFloat(flights[0].keyframes[0].top)).toBeCloseTo(origin.y, 0);
      expect(Number.parseFloat(flights[0].keyframes[1].top)).toBeLessThan(origin.y);
      expect(Number.parseFloat(flights[0].keyframes[1].fontSize)).toBeLessThan(Number.parseFloat(flights[0].keyframes[0].fontSize));
    }
    await expect(page.locator('.ds-stage-title-flight')).toHaveCount(0);
    await input.fill('Следующий черновик');
    release();
    await expect(page.getByText('Начнём с конкретной задачи.', { exact: true })).toBeVisible();
    await expect(input).toHaveValue('Следующий черновик');
    await page.reload();
    await expect(header).toBeVisible();
    await expect(page.locator('.workspace-welcome')).toHaveCount(0);
    await expect(input).toHaveValue('Следующий черновик');
    expect(await page.evaluate(() => (window as any).titleFlights.length)).toBe(0);
    expect(sent).toHaveLength(1);
  });
}

test('library uses the same title transition without an AI request', async ({ page }) => {
  await page.goto('/design-system');
  const example = page.locator('.ds-stage-preview');
  await example.getByRole('button', { name: 'Начать этап', exact: true }).click();
  await expect(example.locator('h3')).toBeVisible();
  await example.getByRole('button', { name: 'Повторить пример', exact: true }).click();
  await expect(example.getByRole('heading', { name: 'Целевая аудитория', exact: true })).toBeVisible();
  await expect(example.locator('h3')).toHaveCount(0);
});
