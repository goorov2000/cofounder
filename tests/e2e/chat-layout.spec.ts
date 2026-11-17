import { test, expect } from '@playwright/test';
import { expandRoute } from './project-panel';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.request().url().endsWith('/status')
    ? route.fulfill({ json: { configured: true, reason: '', model: 'mock-only', searchEnabled: false } })
    : route.abort());
});

test('Enter sends, Shift+Enter adds a line, and internal results do not interrupt the chat', async ({ page }) => {
  const requests: { message: string; intent: string }[] = [];
  await page.route('**/api/chat', async route => {
    const request = route.request().postDataJSON(); requests.push(request);
    await route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: {
      message: 'Уточним идею.', choices: [], proposedFacts: [],
      artifactDraft: { title: 'Идея', body: 'Предварительная гипотеза для проверки.' },
    } } });
  });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeDisabled();
  await input.fill('Идея мастерской'); await input.press('Shift+Enter');
  await expect(input).toHaveValue('Идея мастерской\n'); expect(requests).toHaveLength(0);
  await input.press('Enter');
  await expect(page.getByText('Уточним идею.', { exact: true })).toBeVisible();
  await expect(input).toHaveValue(''); expect(requests).toHaveLength(1);
  await input.fill('Черновик следующего вопроса');
  await page.getByRole('button', { name: 'Как работать', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открыть материал этапа' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('Черновик следующего вопроса');
  await expect(page.getByText('Предварительная гипотеза для проверки.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Итог этапа · Идея' })).toHaveCount(0);
  expect(requests).toHaveLength(1);
});

test('chat gets the available height, route is embedded and multiline input grows within a limit', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await expect(input).toBeVisible();
  const measurements = await page.evaluate(() => {
    const height = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().height;
    return { history: height('.workspace-history'), composer: height('.workspace-composer'),
      routeEmbedded: document.querySelector('.workspace-history')!.contains(document.querySelector('#project-panel')) };
  });
  expect(measurements.history).toBeGreaterThan(500);
  expect(measurements.composer).toBeLessThan(115);
  expect(measurements.routeEmbedded).toBe(true);
  await expect(page.locator('.stage-status').filter({ hasText: 'Сначала' })).toHaveCount(0);
  await expandRoute(page);
  await page.getByRole('button', { name: 'Аудитория', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Идея проекта', exact: true })).toBeVisible();
  await input.fill(Array.from({ length: 30 }, (_, index) => `Строка ${index}`).join('\n'));
  expect((await input.boundingBox())!.height).toBeLessThanOrEqual(160);
  await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeInViewport({ ratio: 1 });
  await input.fill('Коротко');
  expect((await input.boundingBox())!.height).toBeLessThan(40);
  await page.getByRole('button', { name: 'Скрыть панель проекта' }).click();
  await expect(input).toHaveValue('Коротко');
  await page.getByRole('button', { name: 'Показать панель проекта' }).click();
  await expect(input).toHaveValue('Коротко');
});

for (const colorScheme of ['dark', 'light'] as const) for (const width of [1280, 390]) test(`typing and dictation keep the chat steady while saving is delayed at ${width}px ${colorScheme}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 720 });
  await page.emulateMedia({ colorScheme });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window as any;
    state.resizeObservers = 0;
    const NativeObserver = ResizeObserver;
    window.ResizeObserver = class extends NativeObserver {
      constructor(callback: ResizeObserverCallback) { super(callback); state.resizeObservers++; }
    };
    class Recognition {
      lang = ''; interimResults = false; continuous = false;
      onresult: any; onerror: any; onend: any;
      start() { state.testRecognition = this; }
      stop() { this.onend?.(); }
      abort() {}
    }
    state.SpeechRecognition = Recognition;
  });
  await page.route('**/api/chat', route => {
    const request = route.request().postDataJSON();
    return route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: {
      message: '# История для проверки ввода\n\n' + Array.from({ length: 35 }, (_, index) => `Параграф ${index}: сохраняем место чтения.\n\n`).join(''),
      choices: [], artifactDraft: null, proposedFacts: [],
    } } });
  });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill('Начать проверку');
  await input.press('Enter');
  await expect(page.getByRole('heading', { name: 'История для проверки ввода', exact: true })).toBeAttached();
  await expect(input).toHaveValue('');
  // Hold the real browser lock: autosaves must queue without inserting a warning
  // into the page while either keyboard or interim speech results update the draft.
  await page.evaluate(() => new Promise<void>(resolve => {
    const state = window as any;
    state.saveLock = navigator.locks.request('cofounder.workspace.v1', { mode: 'exclusive' }, () => new Promise<void>(release => {
      state.releaseSaveLock = release;
      resolve();
    }));
  }));
  await expect(page.getByRole('alert')).toHaveCount(0);
  const history = page.locator('.workspace-history');
  await history.evaluate(element => { element.scrollTop = 120; element.dispatchEvent(new Event('scroll')); });
  await input.focus();
  const baseline = await page.evaluate(() => {
    const state = window as any;
    const input = document.querySelector('.workspace-composer textarea:not([aria-hidden])')!;
    state.typingFrames = [];
    state.heightMutations = [];
    const observer = new MutationObserver(records => state.heightMutations.push(...records.map(record => record.oldValue)));
    observer.observe(input, { attributes: true, attributeFilter: ['style'], attributeOldValue: true });
    state.recordTyping = true;
    const sample = () => {
      const composer = document.querySelector('.workspace-composer')!.getBoundingClientRect();
      const history = document.querySelector('.workspace-history')!;
      const historyBox = history.getBoundingClientRect();
      state.typingFrames.push({ y: composer.y, height: composer.height, scroll: history.scrollTop,
        historyY: historyBox.y, historyHeight: historyBox.height, alerts: document.querySelectorAll('[role="alert"]').length });
      if (state.recordTyping) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    return { observers: state.resizeObservers, scroll: document.querySelector('.workspace-history')!.scrollTop,
      historyY: document.querySelector('.workspace-history')!.getBoundingClientRect().y,
      historyHeight: document.querySelector('.workspace-history')!.getBoundingClientRect().height,
      height: document.querySelector('.workspace-composer')!.getBoundingClientRect().height };
  });
  await input.pressSequentially('Привет', { delay: 30 });
  await expect(page.locator('.ds-composer-voice')).toHaveCount(0);
  await expect(input).toBeFocused();
  await page.getByRole('button', { name: 'Надиктовать', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Остановить диктовку', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const transcript of ['т', 'те', 'текст']) {
    await page.evaluate(transcript => (window as any).testRecognition.onresult({ results: [[{ transcript }]] }), transcript);
    await expect(input).toHaveValue(`Привет ${transcript}`);
  }
  await page.getByRole('button', { name: 'Остановить диктовку', exact: true }).click();
  await expect(page.locator('.ds-composer-voice')).toHaveCount(0);
  await input.fill('');
  await input.pressSequentially('Вручную', { delay: 30 });
  await expect(input).toHaveValue('Вручную');
  await expect(input).toBeFocused();
  await test.info().attach('delayed-save', { body: await page.screenshot({ caret: 'initial' }), contentType: 'image/png' });
  await page.evaluate(async () => {
    const state = window as any;
    state.releaseSaveLock();
    await state.saveLock;
    // Wait behind all queued writes, including the last draft.
    await navigator.locks.request('cofounder.workspace.v1', { mode: 'exclusive' }, () => {});
    await new Promise(requestAnimationFrame);
  });
  const sampled = await page.evaluate(() => {
    const state = window as any; state.recordTyping = false;
    return { frames: state.typingFrames as { y: number; height: number; scroll: number; historyY: number; historyHeight: number; alerts: number }[],
      mutations: state.heightMutations as (string | null)[], observers: state.resizeObservers };
  });
  await test.info().attach('typing-measurements', { body: JSON.stringify({ baseline, sampled }), contentType: 'application/json' });
  expect(sampled.frames.length).toBeGreaterThan(10);
  expect(sampled.observers).toBe(baseline.observers);
  expect(sampled.mutations).toEqual([]);
  for (const frame of sampled.frames) {
    expect(frame.alerts).toBe(0);
    expect(frame.historyY).toBe(baseline.historyY);
    expect(frame.historyHeight).toBe(baseline.historyHeight);
    expect(frame.height).toBe(baseline.height);
    expect(frame.scroll).toBe(baseline.scroll);
  }
  expect(new Set(sampled.frames.map(frame => frame.y)).size).toBe(1);
  await page.reload();
  await expect(input).toHaveValue('Вручную');
  expect(errors).toEqual([]);
});
