import { test, expect, type Page } from '@playwright/test';
import { createProject, saveArtifact, updateFacts } from '../../shared/domain';
import { expandRoute, expandCoverage, openProjectPanel } from './project-panel';

async function seed(page: Page, longHistory = true) {
  let project = saveArtifact(createProject(), 'idea', { title: 'Мастерская заказов', body: 'Материал для презентации: приём заказов небольшой мастерской.' });
  project = updateFacts(project, [{ key: 'Клиенты', value: 'Небольшие мастерские', provenance: 'hypothesis', note: 'Нужно проверить на интервью' }]);
  project.modules.idea.draft = 'Мой неотправленный вопрос';
  if (longHistory) project.modules.idea.messages = [{ id: 'long-answer', role: 'assistant', createdAt: new Date().toISOString(), content: '# Рабочая переписка\n\n' + Array.from({ length: 60 }, (_, i) => `Абзац ${i}. Обсуждаем приём заказов, гипотезы и следующие проверки.\n\n`).join('') }];
  await page.addInitScript(raw => { if (!localStorage.getItem('cofounder.workspace.v1')) localStorage.setItem('cofounder.workspace.v1', raw); }, JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] }));
  await page.route('**/api/**', route => route.request().url().endsWith('/status')
    ? route.fulfill({ json: { configured: true, reason: '', model: 'mock-only', searchEnabled: false } }) : route.abort());
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('Мой неотправленный вопрос');
}

test('a short reply stays visible when the route switches to coverage', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await seed(page, false);
  await page.route('**/api/chat', route => route.fulfill({ json: { requestId: route.request().postDataJSON().requestId, model: 'mock-only', reply: {
    message: 'Уточним, кто будет принимать заказы.', choices: [], artifactDraft: null, proposedFacts: [],
  } } }));
  await expandRoute(page);
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).press('Enter');
  await expect(page.getByText('Уточним, кто будет принимать заказы.', { exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.workspace-message.user')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.workspace-composer')).toBeInViewport({ ratio: 1 });
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill(Array.from({ length: 12 }, (_, i) => `Строка ${i}`).join('\n'));
  await expect.poll(async () => {
    const message = await page.locator('.workspace-message.assistant').boundingBox();
    const composer = await page.locator('.workspace-compose-area').boundingBox();
    return message!.y + message!.height <= composer!.y;
  }).toBe(true);
  await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeInViewport({ ratio: 1 });
});

test('resizing a populated composer across breakpoints does not trigger a ResizeObserver error', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).layoutErrors = [];
    // Vite consumes these window errors, so pageerror alone does not catch them.
    window.addEventListener('error', event => (window as any).layoutErrors.push(event.message), true);
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await seed(page, false);
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  const draft = 'Строка с текстом для проверки переноса';
  await input.fill(draft);
  for (const width of [1024, 900, 899, 768, 390, 320, 1440]) {
    await page.setViewportSize({ width, height: 600 });
    await expect(input).toHaveValue(draft);
    await expect.poll(() => input.evaluate(e => e.scrollHeight <= e.clientHeight)).toBe(true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('.workspace-composer')).toBeInViewport({ ratio: 1 });
  }
  expect(await page.evaluate(() => (window as any).layoutErrors)).toEqual([]);
});

for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 1280, 1024]) {
  test(`one outer scrollbar serves chat and project panel at ${width}px ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : width === 1280 ? 720 : 600 });
    await page.emulateMedia({ colorScheme });
    await seed(page);
    await expect(page.getByRole('button', { name: 'Проработка темы', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expandRoute(page);
    const history = page.locator('.workspace-history');
    const panel = page.locator('#project-panel');
    await expect(panel.locator('.ds-project-route')).toHaveAttribute('data-expanded', 'true');
    await expect(panel.getByRole('button', { name: 'Проработка темы', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.workspace-heading').getByRole('button', { name: 'Итог', exact: true })).toHaveCount(0);
    expect(await history.evaluate(e => e.contains(document.querySelector('#project-panel')))).toBe(true);
    const boxes = await page.evaluate(() => {
      const history = document.querySelector('.workspace-history')!.getBoundingClientRect();
      const panel = document.querySelector('#project-panel')!.getBoundingClientRect();
      const body = document.querySelector('.app-body')!.getBoundingClientRect();
      return { scrollRight: history.right, panelRight: panel.right, bodyRight: body.right, scrollBottom: history.bottom, bodyBottom: body.bottom, viewportBottom: innerHeight };
    });
    expect(boxes.scrollRight).toBe(boxes.bodyRight);
    expect(boxes.scrollBottom).toBe(boxes.bodyBottom);
    expect(boxes.bodyBottom).toBeLessThanOrEqual(boxes.viewportBottom);
    expect(boxes.scrollRight).toBeGreaterThanOrEqual(boxes.panelRight);
    expect(await panel.evaluate(e => [e, ...e.querySelectorAll('*')].filter(node => {
      const style = getComputedStyle(node);
      return ['auto', 'scroll'].includes(style.overflowY) && node.scrollHeight > node.clientHeight;
    }).length)).toBe(0);
    await history.evaluate(e => { e.scrollTop = 160; e.dispatchEvent(new Event('scroll')); });
    await panel.getByRole('button', { name: 'Проработка темы', exact: true }).hover();
    await page.mouse.wheel(0, 250);
    await expect.poll(() => history.evaluate(e => e.scrollTop)).toBeGreaterThan(160);
    const readingPosition = await history.evaluate(e => e.scrollTop);
    await expandRoute(page);
    await expect(panel.getByRole('button', { name: 'Проработка темы', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(panel.getByRole('button', { name: 'MVP', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await history.evaluate(e => e.scrollTop)).toBe(readingPosition);
    await expandCoverage(page);
    await expect(panel.locator('.ds-project-route')).toHaveAttribute('data-expanded', 'false');
    expect(await history.evaluate(e => e.scrollTop)).toBe(readingPosition);
    await panel.getByRole('button', { name: 'Проработка темы', exact: true }).press('Space');
    await expect(panel.locator('details[open]')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Проработка темы', exact: true })).toHaveAttribute('aria-expanded', 'false');
    expect(await history.evaluate(e => e.scrollTop)).toBe(readingPosition);
    await expect(page.getByRole('region', { name: 'Итог этапа · Идея' })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expandRoute(page);
    await expect(panel.getByRole('button', { name: 'MVP', exact: true })).toBeAttached();
    await expect(panel.getByRole('button', { name: 'Проработка темы', exact: true })).toHaveAttribute('aria-expanded', 'false');
    // The complete route remains reachable with only one section expanded.
    await history.evaluate(e => { e.scrollTop = e.scrollHeight; });
    await expect(panel.getByRole('button', { name: 'MVP', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(panel.getByRole('button', { name: /^Презентация/ })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /^Решения проекта|^План доработки/ })).toHaveCount(0);
    const expanded = await panel.locator('.workspace-project-sticky').boundingBox();
    expect(expanded!.y + expanded!.height).toBeLessThanOrEqual(boxes.bodyBottom);
    await expect(page.locator('.workspace-composer')).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `.repair/2026-11-16-panel-progress/expanded-${width}-${colorScheme}.png` });
    await expandCoverage(page);
    await expect(panel.locator('.ds-project-route')).toHaveAttribute('data-expanded', 'false');
    await expect(panel.locator('.ds-topic-coverage')).toBeInViewport({ ratio: 1 });
    await expect(panel.getByRole('button', { name: /^Итог этапа|^Уточнить в чате/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Скрыть панель проекта' }).click();
    await expect(panel).toHaveCount(0);
    await page.getByRole('button', { name: 'Показать панель проекта' }).click();
    await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('Мой неотправленный вопрос');
    await history.evaluate(e => { e.scrollTop = 160; });
    await page.screenshot({ path: `.repair/2026-11-16-panel-progress/chat-${width}-${colorScheme}.png` });
  });
}

for (const colorScheme of ['light', 'dark'] as const) for (const width of [768, 390, 320]) {
  test(`compact project panel and materials are reachable by keyboard at ${width}px ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme });
    await seed(page, false);
    const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => input.evaluate(e => e.scrollHeight <= e.clientHeight)).toBe(true);
    await expect(page.locator('#project-panel')).toHaveCount(0);
    await page.getByRole('button', { name: 'Открыть панель проекта' }).focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Панель проекта', exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('.ds-project-route')).toHaveAttribute('data-expanded', 'true');
    await expect(drawer.getByRole('button', { name: 'Проработка темы', exact: true })).toHaveAttribute('aria-expanded', 'false');
    const routeSummary = drawer.getByRole('button', { name: 'Маршрут проекта', exact: true });
    const coverageSummary = drawer.getByRole('button', { name: 'Проработка темы', exact: true });
    await routeSummary.press('Enter');
    await expect(drawer.locator('.ds-project-route')).toHaveAttribute('data-expanded', 'false');
    await routeSummary.press('Space');
    await expect(drawer.locator('.ds-project-route')).toHaveAttribute('data-expanded', 'true');
    await coverageSummary.press('Space');
    await expect(drawer.locator('.ds-project-route')).toHaveAttribute('data-expanded', 'false');
    await expect(drawer.getByRole('button', { name: 'Проработка темы', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(coverageSummary).toBeFocused();
    const contextSummary = drawer.getByRole('button', { name: 'Контекст проекта', exact: true });
    const positions = await Promise.all([routeSummary, coverageSummary, contextSummary].map(locator => locator.boundingBox()));
    expect(positions[0]!.y).toBeLessThan(positions[1]!.y);
    expect(positions[1]!.y).toBeLessThan(positions[2]!.y);
    await contextSummary.press('Enter');
    await expect(coverageSummary).toHaveAttribute('aria-expanded', 'false');
    await expect(contextSummary).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer.locator('.ds-topic-coverage')).toBeHidden();
    await expect(drawer.locator('.ds-project-context .ds-project-memory')).toBeVisible();
    await routeSummary.press('Space');
    await expect(contextSummary).toHaveAttribute('aria-expanded', 'false');
    await expect(coverageSummary).toHaveAttribute('aria-expanded', 'false');
    await expect(drawer.locator('.ds-project-route')).toHaveAttribute('data-expanded', 'true');
    await routeSummary.press('Enter');
    await expect(drawer.locator('details[open]')).toHaveCount(0);
    await page.screenshot({ path: `.repair/2026-11-16-panel-progress/drawer-${width}-${colorScheme}.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'Итог этапа · Идея' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Сохранить итог', exact: true })).toHaveCount(0);
    await expect(input).toHaveValue('Мой неотправленный вопрос');
    await openProjectPanel(page);
    await expect(page.getByRole('button', { name: /^Решения проекта|^План доработки/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expandRoute(page);
    await page.getByRole('button', { name: 'Аудитория', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Целевая аудитория', exact: true })).toBeVisible();
    await expandRoute(page);
    await page.getByRole('button', { name: 'Идея', exact: true }).click();
    await expect(input).toHaveValue('Мой неотправленный вопрос');
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => input.evaluate(e => e.scrollHeight <= e.clientHeight)).toBe(true);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1')!));
    expect(stored.projects[0].modules.idea.artifact.body).toBe('Материал для презентации: приём заказов небольшой мастерской.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
