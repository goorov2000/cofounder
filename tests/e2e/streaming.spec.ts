import { test, expect, type Page } from '@playwright/test';
import { createProject, saveArtifact } from '../../shared/domain';
import { expandRoute } from './project-panel';

// A controllable browser transport exercises the real client decoder/UI without
// a live API key. Real HTTP flushing and ledger replay are covered server-side.
async function setup(page: Page) {
  await page.route('**/api/status', route => route.fulfill({ json: { configured: true, reason: '', model: 'mock-only', searchEnabled: false } }));
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    (window as any).chatStreams = [];
    window.fetch = async (url, options) => {
      if (url !== '/api/chat') return original(url, options);
      const request = JSON.parse(options!.body as string);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({ start(controller) {
        const entry = {
          request,
          emit(event: object) { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ requestId: request.requestId, ...event })}\n\n`)); },
          close() { controller.close(); },
        };
        (window as any).chatStreams.push(entry);
        options?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
        entry.emit({ type: 'start' });
      } });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'AI подключён' })).toBeAttached();
}
async function delta(page: Page, text: string) {
  await page.evaluate(delta => (window as any).chatStreams.at(-1).emit({ type: 'text.delta', delta }), text);
}
async function complete(page: Page, message: string) {
  await page.evaluate(message => {
    const stream = (window as any).chatStreams.at(-1);
    stream.emit({ type: 'complete', response: { requestId: stream.request.requestId, model: 'mock-only', reply: {
      message, choices: [{ id: 'work', label: 'Работа', description: 'Начнём с профессионального опыта' }], artifactDraft: null, proposedFacts: [],
    } } });
    stream.close();
  }, message);
}

for (const colorScheme of ['light', 'dark'] as const) for (const width of [1280, 390]) {
  test(`a starter clears immediately and streams before completion at ${width}px ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 844 });
    await page.emulateMedia({ colorScheme });
    await setup(page);
    const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
    await page.getByRole('button', { name: 'Найти идею', exact: true }).click();
    await expect(input).toHaveValue('');
    await expect(page.locator('.workspace-message.user')).toContainText('Помоги найти идею. Пока не знаю, с чего начать.');
    await expect(page.locator('.ds-thinking')).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).chatStreams.length)).toBe(1);
    await delta(page, 'В какой сфере ');
    await expect(page.locator('.is-streaming .markdown')).toHaveText('В какой сфере');
    await expect(page.locator('.ds-thinking')).toHaveCount(0);
    await expect(page.locator('.workspace-choices')).toHaveCount(0);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0].modules.idea);
    expect(stored.messages.filter((m: any) => m.role === 'assistant')).toHaveLength(0);
    await page.screenshot({ path: `/tmp/cofounder-stream-${width}-${colorScheme}.png` });
    // A new draft can even repeat the sent text: completion must preserve it.
    const newDraft = 'Помоги найти идею. Пока не знаю, с чего начать.';
    await input.fill(newDraft);
    await input.press('Enter');
    expect(await page.evaluate(() => (window as any).chatStreams.length)).toBe(1);
    await delta(page, 'вы работали?');
    await expect(page.locator('.is-streaming .markdown')).toHaveText('В какой сфере вы работали?');
    await expect(page.locator('.workspace-composer')).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await complete(page, 'В какой сфере вы работали?');
    await expect(page.locator('.is-streaming')).toHaveCount(0);
    await expect(page.locator('.workspace-message.assistant')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Работа Начнём/ })).toBeVisible();
    await expect(input).toHaveValue(newDraft);
    await page.reload();
    await expect(input).toHaveValue(newDraft);
    await expect(page.locator('.workspace-message.assistant')).toContainText('В какой сфере вы работали?');
  });
}

test('an interrupted stream discards its preview and retries the same request without duplicating the user message', async ({ page }) => {
  await setup(page);
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill('Идея мастерской');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await delta(page, 'Незавершённый ответ');
  await expect(page.locator('.is-streaming')).toContainText('Незавершённый ответ');
  await input.fill('Следующий вопрос');
  await page.evaluate(() => (window as any).chatStreams.at(-1).close());
  await expect(page.locator('.is-streaming')).toHaveCount(0);
  await expect(page.locator('.workspace-message.assistant')).toHaveCount(0);
  const interrupted = await page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0].modules.idea.messages.at(-1));
  expect(interrupted).toMatchObject({role:'user',status:'failed',requestError:'NETWORK_ERROR'});
  // Retrying first refreshes the session via /status. A click alone does not
  // mean POST /chat has been dispatched; deliberately hold that dependency.
  let releaseStatus:()=>void=()=>{};
  const statusGate=new Promise<void>(resolve=>{releaseStatus=resolve;});
  await page.route('**/api/status',async route=>{await statusGate;await route.fulfill({json:{configured:true,reason:'',model:'mock-only',searchEnabled:false}});});
  const statusRequest=page.waitForRequest('**/api/status');
  await page.getByRole('button', { name: 'Повторить тот же запрос', exact: true }).click();
  await statusRequest;
  expect(await page.evaluate(()=>(window as any).chatStreams.length)).toBe(1);
  releaseStatus();
  await expect.poll(()=>page.evaluate(()=>(window as any).chatStreams.length)).toBe(2);
  const requests = await page.evaluate(() => (window as any).chatStreams.map((s: any) => s.request));
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[1].requestId).toBe(interrupted.requestId);
  await complete(page, 'Восстановленный ответ');
  await expect(page.locator('.workspace-message.user')).toHaveCount(1);
  await expect(input).toHaveValue('Следующий вопрос');
});

test('cancel and restart remove a partial answer; the next chat starts without its context', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Найти идею', exact: true }).click();
  await delta(page, 'Старая задумка');
  await page.getByRole('button', { name: 'Прервать ожидание', exact: true }).click();
  await expect(page.locator('.is-streaming')).toHaveCount(0);
  await expect(page.locator('.workspace-message.assistant')).toHaveCount(0);
  await page.getByRole('button', { name: 'Начать чат заново', exact: true }).click();
  await page.getByRole('button', { name: 'Начать заново', exact: true }).click();
  await page.getByRole('button', { name: 'Есть идея', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).chatStreams.length)).toBe(2);
  await delta(page, 'Начнём заново');
  await complete(page, 'Начнём заново');
  await expect(page.locator('.workspace-message.user')).toHaveCount(1);
  await expect(page.locator('.workspace-message.assistant')).toHaveText(/Начнём заново/);
  const latest = await page.evaluate(() => (window as any).chatStreams.at(-1).request);
  expect(latest.context.history).toEqual([]);
});

test('a bounded repair replaces the preview and preserves the new draft until validated completion', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Есть идея', exact: true }).click();
  await delta(page, 'Непроверенный вариант');
  await expect(page.locator('.is-streaming')).toContainText('Непроверенный вариант');
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill('Следующая мысль');
  await page.evaluate(() => {
    const stream = (window as any).chatStreams.at(-1);
    stream.emit({ type: 'text.reset' });
    stream.emit({ type: 'progress', progress: { phase: 'composing', message: 'Проверяю основания…' } });
  });
  await expect(page.locator('.is-streaming')).toHaveCount(0);
  await expect(page.locator('.ds-thinking')).toContainText('Проверяю основания');
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0].modules.idea);
  expect(pending.messages.filter((m: any) => m.role === 'assistant')).toHaveLength(0);
  await delta(page, 'Исправленный ответ');
  await complete(page, 'Исправленный ответ');
  await expect(page.locator('.workspace-message.assistant')).toHaveText(/Исправленный ответ/);
  await expect(page.locator('.workspace-message.assistant')).not.toContainText('Непроверенный');
  await expect(input).toHaveValue('Следующая мысль');
  await page.reload();
  await expect(page.locator('.workspace-message.assistant')).toContainText('Исправленный ответ');
  await expect(input).toHaveValue('Следующая мысль');
});

test('streaming regeneration stays in place and restores the previous answer on failure', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Есть идея', exact: true }).click();
  await complete(page, 'Исходный ответ');
  await page.getByRole('button', { name: 'Ещё действия с ответом', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Сгенерировать ответ заново', exact: true }).click();
  await delta(page, 'Новая версия');
  await expect(page.locator('.workspace-message.assistant')).toHaveCount(1);
  await expect(page.locator('.is-streaming')).toContainText('Новая версия');
  await page.evaluate(() => (window as any).chatStreams.at(-1).emit({ type: 'error', error: { code: 'PROVIDER_NETWORK', message: 'Связь с AI прервана.', retryable: false } }));
  await expect(page.locator('.workspace-message.assistant')).toContainText('Исходный ответ');
  await expect(page.locator('.is-streaming')).toHaveCount(0);
});

test('a growing reply follows the bottom, respects reading position and stays in its original chat', async ({ page }) => {
  const project = saveArtifact(createProject(), 'idea', { title: 'Мастерская', body: 'Помощник для приёма заказов.' });
  project.modules.idea.messages = [{ id: 'history', role: 'assistant', createdAt: new Date().toISOString(), content: 'Ранее обсуждали:\n\n' + 'Подробности проекта.\n\n'.repeat(35) }];
  await page.addInitScript(raw => localStorage.setItem('cofounder.workspace.v1', raw), JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] }));
  await page.setViewportSize({ width: 1280, height: 720 });
  await setup(page);
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Продолжим обсуждение');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await delta(page, 'Начало ответа.\n\n' + 'Новые подробности.\n\n'.repeat(20) + 'Дошли до этой строки.');
  await expect(page.getByText('Дошли до этой строки.', { exact: true })).toBeInViewport({ ratio: 1 });
  const history = page.locator('.workspace-history');
  await history.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await delta(page, '\n\nПродолжение ответа.');
  await expect(page.getByRole('button', { name: 'К последнему сообщению', exact: true })).toBeVisible();
  expect(await history.evaluate(element => element.scrollTop)).toBe(0);
  await page.getByRole('button', { name: 'К последнему сообщению', exact: true }).click();
  await expect(page.getByText('Продолжение ответа.', { exact: true })).toBeInViewport({ ratio: 1 });
  await expandRoute(page);
  await page.locator('[data-module=audience]').click();
  await expect(page.locator('.workspace-welcome h1')).toHaveText('Целевая аудитория');
  await expect(page.locator('.is-streaming')).toHaveCount(0);
  await delta(page, ' Дополнение из прежнего чата.');
  await expect(page.locator('.is-streaming')).toHaveCount(0);
  await complete(page, 'Полный ответ для идеи');
  await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeAttached();
  await page.locator('[data-module=idea]').click();
  await expect(page.locator('.workspace-message.assistant').last()).toContainText('Полный ответ для идеи');
});
