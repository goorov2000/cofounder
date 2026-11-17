import { test, expect, type Page } from '@playwright/test';
import { createProject } from '../../shared/domain';
import type { ChatRequest } from '../../shared/types';

const initialAnswer = 'Начните с интервью с владельцами мастерских.\n\n**Уточните:** как они принимают заказы?';
const requests: ChatRequest[] = [];

test.beforeEach(async ({ page }) => {
  requests.length = 0;
  await page.addInitScript(() => {
    const state = window as any;
    state.copied = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { state.copied = text; } } });
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    class Utterance { text: string; lang = ''; onend: any; onerror: any; constructor(text: string) { this.text = text; } }
    state.SpeechSynthesisUtterance = Utterance;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speak: (utterance: unknown) => { state.spoken = utterance; }, cancel: () => { state.canceled = (state.canceled || 0) + 1; }, getVoices: () => [],
    } });
  });
  await page.route('**/api/**', route => route.request().url().endsWith('/status')
    ? route.fulfill({ json: { configured: true, reason: '', model: 'mock-only', searchEnabled: false } }) : route.abort());
  await page.route('**/api/chat', route => {
    const request = route.request().postDataJSON(); requests.push(request);
    return route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: { message: initialAnswer, choices: [], proposedFacts: [], artifactDraft: null } } });
  });
});
async function send(page: Page, text = 'Хочу помочь мастерским') {
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.locator('.workspace-message.assistant').last()).toContainText('Начните с интервью');
}
async function regenerate(page: Page, index = 0) {
  await page.locator('.workspace-message.assistant').nth(index).getByRole('button', { name: 'Ещё действия с ответом', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Сгенерировать ответ заново', exact: true }).click();
}

test('answer actions copy, persist ratings, read aloud, share text and show the original sources', async ({ page }) => {
  const project = createProject();
  project.facts['Аудитория'] = { key: 'Аудитория', value: 'Мастерские Самары', provenance: 'user', note: 'Выбрано пользователем', sourceUrl: 'https://example.org/research' };
  await page.addInitScript(project => {
    if (!localStorage.getItem('cofounder.workspace.v1')) localStorage.setItem('cofounder.workspace.v1', JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] }));
  }, project);
  await page.goto('/'); await send(page);
  const answer = page.locator('.workspace-message.assistant');
  await expect(answer.getByRole('group', { name: 'Действия с ответом AI' }).getByRole('button')).toHaveCount(6);
  await answer.getByRole('button', { name: 'Скопировать ответ', exact: true }).click();
  expect(await page.evaluate(() => (window as any).copied)).toBe(initialAnswer);
  await answer.getByRole('button', { name: 'Хороший ответ', exact: true }).click();
  await expect(answer.getByRole('button', { name: 'Хороший ответ', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(answer.getByRole('button', { name: 'Хороший ответ', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await answer.getByRole('button', { name: 'Плохой ответ', exact: true }).click();
  await expect(answer.getByRole('button', { name: 'Хороший ответ', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await answer.getByRole('button', { name: 'Плохой ответ', exact: true }).click();
  await expect(answer.getByRole('button', { name: 'Плохой ответ', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await answer.getByRole('button', { name: 'Озвучить ответ', exact: true }).click();
  expect(await page.evaluate(() => (window as any).spoken.text)).toContain('Уточните:');
  expect(await page.evaluate(() => (window as any).spoken.text)).not.toContain('**');
  await answer.getByRole('button', { name: 'Остановить озвучивание', exact: true }).click();
  expect(await page.evaluate(() => (window as any).canceled)).toBeGreaterThan(0);
  await answer.getByRole('button', { name: 'Поделиться ответом', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Поделиться ответом', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Текст ответа', exact: true })).toHaveValue(initialAnswer);
  await page.getByRole('button', { name: 'Скопировать текст', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('cofounder.workspace.v1')!);
    data.projects[0].facts['Аудитория'].value = 'Другая аудитория';
    localStorage.setItem('cofounder.workspace.v1', JSON.stringify(data));
  });
  await page.reload();
  await answer.getByRole('button', { name: 'Ещё действия с ответом', exact: true }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(2);
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Посмотреть источники', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  const sources = page.getByRole('dialog', { name: 'Источники ответа', exact: true });
  await expect(sources).toContainText('Веб-поиск не использовался');
  await sources.getByText('Общие решения и расчёты · 1', { exact: true }).click();
  await expect(sources).toContainText('Мастерские Самары');
  await expect(sources).not.toContainText('Другая аудитория');
  await expect(sources.getByRole('link', { name: 'Аудитория', exact: true })).toHaveAttribute('href', 'https://example.org/research');
  await page.keyboard.press('Escape');
  await expect(answer.getByRole('button', { name: 'Ещё действия с ответом', exact: true })).toBeFocused();
  expect(requests).toHaveLength(1);
});

test('regeneration replaces the selected answer with original context and preserves later messages, draft and latest proposal', async ({ page }) => {
  await page.goto('/'); await send(page, 'Первый вопрос'); await send(page, 'Второй вопрос');
  const original = requests[0];
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill('Первый вопрос'); // Same text must still survive regeneration.
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/chat', async route => {
    const request = route.request().postDataJSON(); requests.push(request); await gate;
    await route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: { message: 'Новый ответ на первый вопрос.', choices: [], proposedFacts: [], artifactDraft: { title: 'Новый черновик', body: 'Только предложение' } } } });
  });
  await regenerate(page);
  await expect(page.locator('.workspace-message.assistant').first()).toContainText('обновляем ответ');
  await expect(page.locator('.workspace-message.assistant').first()).toContainText('Начните с интервью');
  expect(requests[2].requestId).not.toBe(original.requestId);
  expect(requests[2].context).toEqual(original.context);
  expect(requests[2].message).toBe('Первый вопрос');
  release();
  await expect(page.locator('.workspace-message.assistant').first()).toContainText('Новый ответ на первый вопрос.');
  await expect(page.locator('.workspace-message.assistant').last()).toContainText('Начните с интервью');
  await expect(page.locator('.workspace-message.user')).toHaveCount(2);
  await expect(page.locator('.workspace-message.assistant')).toHaveCount(2);
  await expect(input).toHaveValue('Первый вопрос');
  await page.reload();
  await expect(input).toHaveValue('Первый вопрос');
  await expect(page.locator('.workspace-message.assistant').first()).toContainText('Новый ответ на первый вопрос.');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0].modules.idea);
  expect(saved.proposal.artifactDraft).toBeNull(); // Editing an older answer cannot overwrite the latest proposal.
});

test('failed regeneration keeps old answer and recovers the same request after reload', async ({ page }) => {
  await page.goto('/'); await send(page);
  await page.route('**/api/chat', route => { requests.push(route.request().postDataJSON()); return route.abort('failed'); });
  await regenerate(page);
  await expect(page.getByRole('button', { name: 'Повторить тот же запрос', exact: true })).toBeVisible();
  const failed = requests[1];
  await expect(page.locator('.workspace-message.assistant')).toContainText('Начните с интервью');
  await page.reload();
  await page.route('**/api/chat', route => {
    const request = route.request().postDataJSON(); requests.push(request);
    return route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: { message: 'Ответ восстановлен', choices: [], proposedFacts: [], artifactDraft: null } } });
  });
  await page.getByRole('button', { name: 'Повторить тот же запрос', exact: true }).click();
  await expect(page.locator('.workspace-message.assistant')).toContainText('Ответ восстановлен');
  expect(requests[2]).toEqual(failed);
  await expect(page.locator('.workspace-message.assistant')).toHaveCount(1);
  await expect(page.locator('.workspace-message.user')).toHaveCount(1);
});

test('native sharing uses answer text; denied clipboard and unavailable speech have usable fallbacks', async ({ page }) => {
  await page.goto('/'); await send(page);
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: async (data: ShareData) => { (window as any).shared = data; } }));
  await page.getByRole('button', { name: 'Поделиться ответом', exact: true }).click();
  expect(await page.evaluate(() => (window as any).shared)).toEqual({ title: 'Ответ AI · CoFounder', text: initialAnswer });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('Denied'); } } });
    Object.defineProperty(window, 'speechSynthesis', { value: undefined });
  });
  await page.getByRole('button', { name: 'Озвучить ответ', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Озвучивание недоступно');
  await page.getByRole('button', { name: 'Скопировать ответ', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Выделите текст');
  await expect(page.getByRole('textbox', { name: 'Текст ответа', exact: true })).toHaveValue(initialAnswer);
});

for (const width of [1440, 1280, 390, 320]) for (const theme of ['light', 'dark'] as const) test(`single row composer and answer actions at ${width}px in ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 1440 ? 900 : width === 390 ? 844 : 720 });
  await page.emulateMedia({ colorScheme: theme });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await send(page);
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  const text = (await input.boundingBox())!;
  const mic = (await page.getByRole('button', { name: /^(Надиктовать|Диктовка недоступна)$/ }).boundingBox())!;
  const sendButton = (await page.getByRole('button', { name: 'Отправить', exact: true }).boundingBox())!;
  expect(Math.abs(text.y + text.height / 2 - mic.y - mic.height / 2)).toBeLessThan(2);
  expect(text.x + text.width).toBeLessThan(mic.x);
  expect(mic.x).toBeLessThan(sendButton.x);
  expect((await page.locator('.workspace-composer').boundingBox())!.height).toBeLessThan(65);
  await expect(page.getByText('AI может допускать ошибки. Проверяйте важную информацию.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByText('Как вам разговор? Пригодился?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ещё действия с ответом', exact: true }).click();
  await expect(page.getByRole('menu')).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  if (width === 1440 || width === 390) await page.screenshot({ path: `docs/design-system/evidence/answer-actions/${theme}-${width}.png` });
  expect(errors).toEqual([]);
});

test('an unknown regeneration outcome never silently creates another paid request, including after reload', async ({ page }) => {
  await page.goto('/'); await send(page);
  await page.route('**/api/chat', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 504, json: { error: { code: 'AI_TIMEOUT', message: 'Результат неизвестен.', retryable: false } } });
  });
  await regenerate(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Повторная оплата не запускается' })).toBeVisible();
  await regenerate(page);
  expect(requests).toHaveLength(2);
  await page.reload();
  await regenerate(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Повторная оплата не запускается' })).toBeVisible();
  await expect(page.locator('.workspace-message.assistant')).toContainText('Начните с интервью');
  expect(requests).toHaveLength(2);
});

test('gallery has working answer controls and regeneration is local to the example', async ({ page }) => {
  await page.goto('/design-system');
  await page.getByRole('button', { name: 'Хороший ответ', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Хороший ответ', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Ещё действия с ответом', exact: true }).click();
  await page.screenshot({ path: 'docs/design-system/evidence/answer-actions/gallery-menu.png' });
  await page.getByRole('menuitem', { name: 'Сгенерировать ответ заново', exact: true }).click();
  await expect(page.getByText('Кто сейчас принимает заказы в мастерской: владелец, администратор или сами мастера?', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Хороший ответ', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(requests).toHaveLength(0);
});

test('copies the complete current dialogue with choices while preserving the draft and other chats', async ({ page }) => {
  const project = createProject();
  project.name = 'Проверка диалога';
  const longQuestion = 'Многострочный вопрос\n\n' + 'Нужен полный контекст. '.repeat(120);
  project.modules.idea.messages = [
    { id: 'question', role: 'user', content: longQuestion, createdAt: '2026-11-16T10:00:00Z' },
    { id: 'answer', role: 'assistant', content: '**Проверим спрос.**\n\n[Источник](https://example.org)', createdAt: '2026-11-16T10:01:00Z', choices: [
      { id: 'pain', label: 'От боли', description: 'Разберём знакомую задачу', recommended: true },
      { id: 'market', label: 'От рынка', description: 'Посмотрим на спрос' },
    ], choiceConsumed: true },
    { id: 'failed', role: 'user', content: 'Что дальше?', createdAt: '2026-11-16T10:02:00Z', status: 'failed', requestError: 'NETWORK_ERROR' },
  ];
  project.modules.basics.messages = [{ id: 'other', role: 'user', content: 'Чужой чат не копировать', createdAt: '2026-11-16T10:00:00Z' }];
  await page.addInitScript(project => localStorage.setItem('cofounder.workspace.v1', JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] })), project);
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill('Неотправленный черновик');
  const button = page.getByRole('button', { name: 'Скопировать диалог', exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Диалог скопирован', exact: true })).toBeFocused();
  const copied = await page.evaluate(() => (window as any).copied as string);
  expect(copied).toContain('CoFounder · Проверка диалога\nЭтап:');
  expect(copied).toContain(`Вы:\n${longQuestion}`);
  expect(copied).toContain('Помощник:\n**Проверим спрос.**\n\n[Источник](https://example.org)');
  expect(copied).toContain('1. От боли [Рекомендую] — Разберём знакомую задачу');
  expect(copied).toContain('2. От рынка — Посмотрим на спрос');
  expect(copied).toContain('Вы (ответ не получен):\nЧто дальше?\nОшибка: NETWORK_ERROR');
  expect(copied).not.toContain('Чужой чат');
  expect(copied).not.toContain('Неотправленный черновик');
  expect(copied.indexOf(longQuestion)).toBeLessThan(copied.indexOf('Проверим спрос'));
  expect(copied.indexOf('Проверим спрос')).toBeLessThan(copied.indexOf('Что дальше?'));
  await expect(input).toHaveValue('Неотправленный черновик');
  expect(requests).toHaveLength(0);
});

test('empty dialogue cannot be copied and clipboard denial offers selectable full text', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Скопировать диалог', exact: true })).toBeDisabled();
  await send(page, 'Вопрос для копирования');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied'); } } }));
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Черновик сохраняется');
  await page.getByRole('button', { name: 'Скопировать диалог', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Скопировать диалог', exact: true });
  await expect(dialog).toContainText('Выделите текст и скопируйте его вручную');
  const text = dialog.getByRole('textbox', { name: 'Текст диалога', exact: true });
  await text.focus();
  const selection = await text.evaluate(element => {
    const textarea = element as HTMLTextAreaElement;
    return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
  });
  expect(selection).toContain('Вы:\nВопрос для копирования');
  expect(selection).toContain(`Помощник:\n${initialAnswer}`);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Скопировать диалог', exact: true })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('Черновик сохраняется');
  expect(requests).toHaveLength(1);
});
