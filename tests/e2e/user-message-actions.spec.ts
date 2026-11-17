import { test, expect, type Page } from '@playwright/test';
import type { ChatRequest } from '../../shared/types';

const requests: ChatRequest[] = [];
test.beforeEach(async ({ page }) => {
  requests.length = 0;
  await page.addInitScript(() => {
    const state = window as any;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { state.copied = text; } } });
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    class Utterance { text: string; lang = ''; constructor(text: string) { this.text = text; } }
    state.SpeechSynthesisUtterance = Utterance;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak: (utterance: unknown) => { state.spoken = utterance; }, cancel: () => {}, getVoices: () => [] } });
  });
  await page.route('**/api/**', route => route.request().url().endsWith('/status') ? route.fulfill({ json: { configured: true, model: 'mock-only', reason: '', searchEnabled: false } }) : route.abort());
  await page.route('**/api/chat', route => {
    const request = route.request().postDataJSON(); requests.push(request);
    return route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: { message: `Ответ на: ${request.message}`, choices: [], artifactDraft: null, proposedFacts: [] } } });
  });
});
async function send(page: Page, text = 'Хочу помочь мастерским принимать заказы') {
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.locator('.workspace-message.assistant').last()).toContainText(`Ответ на: ${text}`);
}
async function openEditor(page: Page, index = 0) {
  const message = page.locator('.workspace-message.user').nth(index);
  await message.hover();
  await message.getByRole('button', { name: 'Редактировать сообщение', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Редактировать сообщение', exact: true })).toBeVisible();
}

for (const theme of ['light', 'dark'] as const) test(`user controls appear on hover and keyboard focus without moving history in ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: theme });
  await page.goto('/'); await send(page);
  const message = page.locator('.workspace-message.user');
  const controls = message.getByRole('group', { name: 'Действия с сообщением пользователя', exact: true });
  await page.mouse.move(0, 0);
  await expect(controls).toHaveCSS('opacity', '0');
  await expect(page.getByRole('group', { name: 'Действия с ответом AI', exact: true })).toHaveCSS('opacity', '1');
  const before = await page.locator('.workspace-message.assistant').boundingBox();
  const composer = await page.locator('.workspace-composer').boundingBox();
  await message.locator('.ds-user-bubble').hover();
  await expect(controls).toHaveCSS('opacity', '1');
  await controls.getByRole('button', { name: 'Скопировать сообщение', exact: true }).hover();
  await expect(controls).toHaveCSS('opacity', '1');
  expect(await page.locator('.workspace-message.assistant').boundingBox()).toEqual(before);
  expect(await page.locator('.workspace-composer').boundingBox()).toEqual(composer);
  await page.screenshot({ path: `docs/design-system/evidence/user-actions/${theme}-hover-1280.png` });
  await page.mouse.move(0, 0);
  await expect(controls).toHaveCSS('opacity', '0');
  await page.getByRole('button', { name: 'Скрыть панель проекта', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(controls.getByRole('button', { name: 'Скопировать сообщение', exact: true })).toBeFocused();
  await expect(controls).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).copied)).toBe('Хочу помочь мастерским принимать заказы');
});

test('user copy, share and reading use only their message; canceling edit leaves draft and history intact', async ({ page }) => {
  await page.goto('/'); await send(page);
  const message = page.locator('.workspace-message.user');
  const draft = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await draft.fill('Неотправленный черновик');
  await message.hover();
  await message.getByRole('button', { name: 'Поделиться сообщением', exact: true }).click();
  const share = page.getByRole('dialog', { name: 'Поделиться сообщением', exact: true });
  await expect(share.getByRole('textbox', { name: 'Текст сообщения', exact: true })).toHaveValue('Хочу помочь мастерским принимать заказы');
  await share.getByRole('button', { name: 'Скопировать текст', exact: true }).click();
  expect(await page.evaluate(() => (window as any).copied)).not.toContain('Ответ на:');
  await page.keyboard.press('Escape');
  await message.getByRole('button', { name: 'Озвучить сообщение', exact: true }).click();
  expect(await page.evaluate(() => (window as any).spoken.text)).toBe('Хочу помочь мастерским принимать заказы');
  await message.getByRole('button', { name: 'Остановить озвучивание', exact: true }).click();
  await openEditor(page);
  await page.getByRole('textbox', { name: 'Текст правки', exact: true }).fill('Новая формулировка');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(draft).toHaveValue('Неотправленный черновик');
  await expect(message).toContainText('Хочу помочь мастерским принимать заказы');
  expect(requests).toHaveLength(1);
});

test('editing replaces the selected user/AI pair, preserves later conversation and survives reload', async ({ page }) => {
  await page.goto('/'); await send(page, 'Первый вопрос'); await send(page, 'Второй вопрос');
  const original = requests[0];
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Черновик следующего вопроса');
  await openEditor(page);
  await page.getByRole('textbox', { name: 'Текст правки', exact: true }).fill('Исправленный первый вопрос');
  await page.getByRole('button', { name: 'Отправить правку', exact: true }).click();
  await expect(page.locator('.workspace-message.user').first()).toContainText('Исправленный первый вопрос');
  await expect(page.locator('.workspace-message.assistant').first()).toContainText('Ответ на: Исправленный первый вопрос');
  expect(requests[2].context).toEqual(original.context);
  expect(requests[2].requestId).not.toBe(original.requestId);
  await expect(page.locator('.workspace-message.user').last()).toContainText('Второй вопрос');
  await expect(page.locator('.workspace-message.assistant').last()).toContainText('Ответ на: Второй вопрос');
  await expect(page.locator('.workspace-message')).toHaveCount(4);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('Черновик следующего вопроса');
  await expect(page.locator('.workspace-message.user').first()).toContainText('Исправленный первый вопрос');
  await expect(page.locator('.workspace-message')).toHaveCount(4);
});

test('failed edit retains original pair and retries the exact edited request after reload', async ({ page }) => {
  await page.goto('/'); await send(page, 'Исходный вопрос');
  await page.route('**/api/chat', route => { requests.push(route.request().postDataJSON()); return route.abort('failed'); });
  await openEditor(page);
  await page.getByRole('textbox', { name: 'Текст правки', exact: true }).fill('Правка после сбоя');
  await page.getByRole('button', { name: 'Отправить правку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить тот же запрос', exact: true })).toBeVisible();
  await expect(page.locator('.workspace-message.user')).toContainText('Исходный вопрос');
  await expect(page.locator('.workspace-message.assistant')).toContainText('Ответ на: Исходный вопрос');
  const failed = requests[1];
  await page.reload();
  await openEditor(page);
  await expect(page.getByRole('textbox', { name: 'Текст правки', exact: true })).toHaveValue('Правка после сбоя');
  await page.keyboard.press('Escape');
  await page.route('**/api/chat', route => {
    const request = route.request().postDataJSON(); requests.push(request);
    return route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: { message: 'Ответ на правку восстановлен', choices: [], artifactDraft: null, proposedFacts: [] } } });
  });
  await page.getByRole('button', { name: 'Повторить тот же запрос', exact: true }).click();
  await expect(page.locator('.workspace-message.user')).toContainText('Правка после сбоя');
  await expect(page.locator('.workspace-message.assistant')).toContainText('Ответ на правку восстановлен');
  expect(requests[2]).toEqual(failed);
  await expect(page.locator('.workspace-message')).toHaveCount(2);
});

test.describe('touch screens', () => {
  test.use({ hasTouch: true, isMobile: true });
  for (const theme of ['light', 'dark'] as const) test(`actions remain usable without hover in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/'); await send(page, 'Тест');
    const message = page.locator('.workspace-message.user');
    await expect(message.locator('.ds-user-actions')).toHaveCSS('opacity', '1');
    await expect(message.getByRole('button', { name: 'Редактировать сообщение', exact: true })).toBeInViewport();
    await message.getByRole('button', { name: 'Скопировать сообщение', exact: true }).tap();
    expect(await page.evaluate(() => (window as any).copied)).toBe('Тест');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `docs/design-system/evidence/user-actions/${theme}-touch-390.png` });
  });
});

test('an uncertain edit cannot create another generation or overwrite the preserved pair', async ({ page }) => {
  await page.goto('/'); await send(page, 'Вопрос до правки');
  await page.route('**/api/chat', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 504, json: { error: { code: 'AI_TIMEOUT', message: 'Результат неизвестен', retryable: false } } });
  });
  await openEditor(page);
  await page.getByRole('textbox', { name: 'Текст правки', exact: true }).fill('Исправленный вопрос');
  await page.getByRole('button', { name: 'Отправить правку', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Повторная оплата не запускается' })).toBeVisible();
  await page.reload(); await openEditor(page);
  await page.getByRole('button', { name: 'Отправить правку', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Повторная оплата не запускается');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Ещё действия с ответом', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Сгенерировать ответ заново', exact: true }).click();
  await expect(page.locator('.workspace-message.user')).toContainText('Вопрос до правки');
  await expect(page.locator('.workspace-message.assistant')).toContainText('Ответ на: Вопрос до правки');
  expect(requests).toHaveLength(2);
});
