import { test, expect, type Page } from '@playwright/test';
import { createProject } from '../../shared/domain';
import type { ChatRequest, Project } from '../../shared/types';

function example() {
  const project = createProject();
  project.modules.idea.messages = [{ id: 'question', role: 'assistant', content: 'Кому вы хотите предложить пиццу?', createdAt: new Date().toISOString(), choices: [{ id: 'events', label: 'Мероприятия', description: 'Пицца для гостей праздника.' }] }];
  return project;
}
async function seed(page: Page, project: Project = example()) {
  await page.addInitScript(project => { if (!localStorage.getItem('cofounder.workspace.v1')) localStorage.setItem('cofounder.workspace.v1', JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] })); }, project);
  await page.route('**/api/**', route => route.request().url().endsWith('/status')
    ? route.fulfill({ json: { configured: true, reason: '', model: 'mock-only', searchEnabled: false } }) : route.abort());
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
}
const reply = (request: ChatRequest, message = 'Начнём с одного мероприятия.') => ({ requestId: request.requestId, model: 'mock-only', reply: { message, choices: [], artifactDraft: null, proposedFacts: [] } });
const retryButton = (page: Page) => page.getByRole('button', { name: 'Повторить тот же запрос', exact: true });

for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 1280, 390]) {
  test(`waiting is distinct from recovery and disclaimer is below input at ${width}px ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 });
    await page.emulateMedia({ colorScheme });
    await seed(page);
    await page.clock.install();
    const requests: ChatRequest[] = [];
    let release!: () => void;
    await page.route('**/api/chat', async route => {
      const request = route.request().postDataJSON(); requests.push(request);
      await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ json: reply(request, Array.from({ length: 20 }, (_, i) => `Абзац ${i + 1}. Уточним число гостей и бюджет мероприятия.`).join('\n\n')) });
    });
    await page.getByRole('button', { name: /^Мероприятия Пицца/ }).click();
    await expect.poll(() => requests.length).toBe(1);
    const thinking = page.locator('.ds-thinking');
    await expect(thinking).toBeInViewport({ ratio: 1 });
    await expect(thinking.locator('.ds-thinking-label')).toHaveText('Думаю…');
    await expect(retryButton(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Прервать ожидание' })).toBeEnabled();
    const history = page.locator('.workspace-history');
    const position = await history.evaluate(e => e.scrollTop);
    await page.clock.fastForward(5100);
    await expect(thinking.locator('.ds-thinking-label')).toHaveText('Собираю мысли…');
    expect(await history.evaluate(e => e.scrollTop)).toBe(position);
    await expect(thinking.locator('.sr-only')).toHaveText('Помощник готовит ответ');
    release();
    await expect(thinking).toHaveCount(0);
    await expect(retryButton(page)).toHaveCount(0);
    const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
    await expect(input).toHaveValue('');
    await input.fill(Array.from({ length: 12 }, (_, i) => `Строка ${i}`).join('\n'));
    await expect.poll(async () => {
      const paragraph = await page.locator('.workspace-message.assistant').last().locator('p').last().boundingBox();
      const composer = await page.locator('.workspace-composer').boundingBox();
      return paragraph!.y + paragraph!.height <= composer!.y;
    }).toBe(true);
    const composer = await page.locator('.workspace-composer').boundingBox();
    const disclaimer = page.locator('.ds-ai-disclaimer');
    await expect(disclaimer).toBeInViewport({ ratio: 1 });
    expect((await disclaimer.boundingBox())!.y).toBeGreaterThanOrEqual(composer!.y + composer!.height + 7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('network recovery is available after failure, hidden during retry, and reuses the original request', async ({ page }) => {
  await seed(page);
  const requests: ChatRequest[] = [];
  let release!: () => void;
  await page.route('**/api/chat', async route => {
    const request = route.request().postDataJSON(); requests.push(request);
    if (requests.length === 1) return route.abort();
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: reply(request) });
  });
  await page.getByRole('button', { name: /^Мероприятия Пицца/ }).click();
  await expect(retryButton(page)).toBeEnabled();
  await expect(page.locator('.ds-thinking')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Связь прервана');
  await retryButton(page).click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(retryButton(page)).toHaveCount(0);
  await expect(page.locator('.ds-thinking')).toBeVisible();
  expect(requests[1]).toEqual(requests[0]);
  release();
  await expect(page.getByText('Начнём с одного мероприятия.', { exact: true })).toBeVisible();
  await expect(page.locator('.workspace-message.user')).toHaveCount(1);
  await expect(retryButton(page)).toHaveCount(0);
});

test('a pending request restored from storage remains recoverable', async ({ page }) => {
  const project = example();
  const request: ChatRequest = { requestId: 'restored-pending', projectId: project.id, moduleId: 'idea', intent: 'message', message: 'Мероприятия', context: { name: project.name, description: project.description, facts: [], artifacts: [], history: [] } };
  project.modules.idea.messages.push({ id: 'pending', role: 'user', content: request.message, createdAt: new Date().toISOString(), status: 'pending', request, requestId: request.requestId });
  project.modules.idea.draft = request.message;
  await seed(page, project);
  await expect(page.locator('.ds-thinking')).toHaveCount(0);
  await expect(retryButton(page)).toBeEnabled();
  const requests: ChatRequest[] = [];
  await page.route('**/api/chat', route => { requests.push(route.request().postDataJSON()); return route.fulfill({ json: reply(request) }); });
  await retryButton(page).click();
  await expect(page.getByText('Начнём с одного мероприятия.', { exact: true })).toBeVisible();
  expect(requests).toEqual([request]);
  await expect(page.locator('.workspace-message.user')).toHaveCount(1);
});

test('reduced motion stays still and cancellation ends waiting without an automatic retry', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seed(page);
  await page.clock.install();
  let count = 0;
  let release!: () => void;
  await page.route('**/api/chat', async route => { count++; await new Promise<void>(resolve => { release = resolve; }); await route.abort(); });
  await page.getByRole('button', { name: /^Мероприятия Пицца/ }).click();
  await expect.poll(() => count).toBe(1);
  await expect(page.locator('.ds-thinking-dots i').first()).toHaveCSS('animation-name', 'none');
  await page.clock.fastForward(16000);
  await expect(page.locator('.ds-thinking-label')).toHaveText('Думаю…');
  await page.getByRole('button', { name: 'Прервать ожидание' }).click();
  await expect(page.locator('.ds-thinking')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Ожидание отменено');
  await expect(retryButton(page)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('');
  await expect(page.locator('.workspace-message.user').last()).toContainText('Мероприятия');
  expect(count).toBe(1);
  release();
});
