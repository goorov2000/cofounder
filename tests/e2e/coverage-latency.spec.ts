import { test, expect, type Page } from '@playwright/test';
import { createProject } from '../../shared/domain';
import { applyAnswer } from '../../src/features/workspace/answerRequests';
import { TOPIC_CRITERIA } from '../../shared/coverage';
import { PROCESS_CHECK_IDS } from '../../shared/review';
import type { AssistantReply, ChatRequest } from '../../shared/types';
import { expandCoverage } from './project-panel';

function reply(complete = false): AssistantReply {
  return { message: 'Сотрудники указывают выходные, управляющий согласует расписание.', choices: [], artifactDraft: null, proposedFacts: [], memory: {
    facts: [], hypotheses: [], openQuestions: [],
    coverage: { rubricVersion: 1, moduleId: 'idea', items: TOPIC_CRITERIA.idea.map(criterion => ({ id: criterion.id, status: complete || criterion.id !== 'scope' ? 'covered' : 'partial', note: 'Обсуждение рабочего процесса.', support: { role: 'user', quote: 'Пожелания сотрудников' } })), nextCriterionId: complete ? null : 'scope' },
    review: { version: 1, status: 'completed', model: 'mock-judge', subjectHash: 'a'.repeat(64), assessedAt: '2026-11-16T10:00:00Z', process: { status: 'passed', note: 'Использованы известные вводные.', checks: PROCESS_CHECK_IDS.map(id => ({ id, status: 'passed', reason: 'Замечаний нет.' })) }, result: { status: 'in_progress', note: 'Нужно согласовать формулировку.' }, nextAction: 'Согласовать итог.', errorCode: null },
  } };
}

async function setup(page: Page) {
  let project = createProject();
  const request: ChatRequest = { requestId: 'previous-review-request', projectId: project.id, moduleId: 'idea', intent: 'message', message: 'Пожелания сотрудников', context: { name: 'Проект', description: '', facts: [], artifacts: [], history: [] } };
  project.modules.idea.messages.push({ id: 'previous-question', role: 'user', content: request.message, requestId: request.requestId, createdAt: '2026-11-16T10:00:00Z' });
  project = applyAnswer(project, request, reply());
  await page.addInitScript(project => {
    if (!localStorage.getItem('cofounder.workspace.v1')) localStorage.setItem('cofounder.workspace.v1', JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] }));
    const original = window.fetch.bind(window);
    (window as any).chatStreams = [];
    window.fetch = async (url, options) => {
      if (url !== '/api/chat') return original(url, options);
      const request = JSON.parse(options!.body as string), encoder = new TextEncoder();
      return new Response(new ReadableStream({ start(controller) {
        const entry = { request, emit(event: object) { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ requestId: request.requestId, ...event })}\n\n`)); }, close() { controller.close(); } };
        (window as any).chatStreams.push(entry);
        options?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
        entry.emit({ type: 'start' });
      } }), { headers: { 'Content-Type': 'text/event-stream' } });
    };
  }, project);
  await page.route('**/api/status', route => route.fulfill({ json: { configured: true, reason: '', model: 'mock-only', searchEnabled: false } }));
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'AI подключён' })).toBeAttached();
}

async function emit(page: Page, event: object) {
  await expect.poll(() => page.evaluate(() => (window as any).chatStreams.length)).toBe(1);
  await page.evaluate(event => (window as any).chatStreams[0].emit(event), event);
}

for (const theme of ['light', 'dark'] as const) for (const width of [1440, 1280, 390]) {
  test(`coverage remains labelled during the post-text wait at ${width}px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 });
    await page.emulateMedia({ colorScheme: theme });
    await setup(page);
    const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
    await expandCoverage(page);
    const panel = page.locator('.ds-project-panel'), progress = panel.getByRole('progressbar');
    await expect(progress).toHaveAttribute('aria-valuenow', '6');
    if (width < 900) await page.keyboard.press('Escape');
    await input.fill('Выбираю самостоятельный ввод выходных и ручное согласование.'); await input.press('Enter');
    await emit(page, { type: 'text.delta', delta: reply(true).message });
    await emit(page, { type: 'progress', progress: { phase: 'finalizing', message: 'Текст написан. Подготавливаю варианты ответа и контекст…' } });
    await expect(page.locator('.ds-thinking')).toContainText('Текст написан.');
    await input.fill('Сохрани этот неотправленный черновик');
    await emit(page, { type: 'progress', progress: { phase: 'reviewing', message: 'Ответ написан. Проверяю качество помощи и полноту темы…' } });
    await expect(page.locator('.ds-thinking')).toContainText('Проверяю качество помощи');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0].modules.idea);
    expect(saved.messages.filter((message: any) => message.role === 'assistant')).toHaveLength(1);
    if (width < 900) await expandCoverage(page);
    await expect(progress).toHaveAttribute('aria-valuenow', '6');
    await expect(progress).toHaveAttribute('aria-busy', 'true');
    await expect(panel.getByRole('status')).toHaveText('Проверяю полноту темы… Показана предыдущая оценка.');
    await expect(panel.getByText('Прогресс обновится со следующим ответом.')).toHaveCount(0);
    await expect(panel.getByText('Ещё не оценено')).toHaveCount(0);
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `.repair/2026-11-16-coverage-latency/reviewing-${width}-${theme}.png` });
    if (width < 900) await page.keyboard.press('Escape');
    await page.evaluate(reply => {
      const stream = (window as any).chatStreams[0];
      stream.emit({ type: 'complete', response: { requestId: stream.request.requestId, model: 'mock-only', reply } }); stream.close();
    }, reply(true));
    await expect(page.locator('.is-streaming')).toHaveCount(0);
    await expect(page.locator('.ds-thinking')).toHaveCount(0);
    await expect(input).toHaveValue('Сохрани этот неотправленный черновик');
    if (width < 900) await expandCoverage(page);
    await expect(progress).toHaveAttribute('aria-valuenow', '7');
    await expect(progress).toHaveAttribute('aria-busy', 'false');
    await expect(panel.getByRole('status')).toHaveCount(0);
    await expect(panel.locator('.ds-coverage-review summary')).toHaveText('Независимая проверка · основное обсуждено');
    await page.reload(); await expandCoverage(page);
    await expect(progress).toHaveAttribute('aria-valuenow', '7');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('an interrupted review clears the busy indicator and retains the labelled saved assessment', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await setup(page);
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill('Меняем направление.'); await input.press('Enter');
  await emit(page, { type: 'text.delta', delta: 'Незавершённый ответ' });
  await emit(page, { type: 'progress', progress: { phase: 'reviewing', message: 'Проверяю полноту темы…' } });
  await page.evaluate(() => (window as any).chatStreams[0].close());
  await expect(page.locator('.is-streaming')).toHaveCount(0);
  await expandCoverage(page);
  const panel = page.locator('.ds-project-panel');
  await expect(panel.getByRole('progressbar')).toHaveAttribute('aria-busy', 'false');
  await expect(panel.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '6');
  await expect(panel.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Предыдущая оценка: 6 из 7. Обновится со следующим ответом');
  await expect(panel.getByRole('status')).toHaveText('Показана предыдущая оценка. Новые вводные учтём со следующим ответом.');
  await expect(page.getByRole('button', { name: 'Повторить тот же запрос', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0].modules.idea);
  expect(saved.messages.filter((message: any) => message.role === 'assistant')).toHaveLength(1);
});

test('regeneration shows the latest assessment even when its historical request had no coverage', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await setup(page);
  await page.getByRole('button', { name: 'Ещё действия с ответом', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Сгенерировать ответ заново', exact: true }).click();
  await emit(page, { type: 'text.delta', delta: 'Уточнённый ответ' });
  await emit(page, { type: 'progress', progress: { phase: 'reviewing', message: 'Проверяю полноту темы…' } });
  expect(await page.evaluate(() => (window as any).chatStreams[0].request.context.memories)).toBeUndefined();
  await expandCoverage(page);
  const panel = page.locator('.ds-project-panel');
  await expect(panel.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '6');
  await expect(panel.getByRole('status')).toContainText('Показана предыдущая оценка.');
  await emit(page, { type: 'error', error: { code: 'PROVIDER_NETWORK', message: 'Связь прервана.', retryable: false } });
  await expect(page.locator('.is-streaming')).toHaveCount(0);
  await expect(page.locator('.workspace-message.assistant')).toContainText(reply().message);
  await expect(panel.getByRole('progressbar')).toHaveAttribute('aria-busy', 'false');
  await expect(panel.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '6');
});

test('the library demonstrates the pending review with a keyboard toggle and no API calls', async ({ page }) => {
  let apiCalls = 0;
  await page.route('**/api/**', route => { apiCalls++; return route.abort(); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/design-system');
  const toggle = page.getByRole('button', { name: 'Показать ожидание проверки', exact: true });
  await toggle.focus(); await page.keyboard.press('Enter');
  const panel = page.locator('#workspace-example .ds-project-panel');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('status')).toContainText('Показана предыдущая оценка.');
  await expect(panel.getByRole('progressbar')).toHaveAttribute('aria-busy', 'true');
  await panel.screenshot({ path: '.repair/2026-11-16-coverage-latency/gallery-reviewing.png' });
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(panel.getByRole('status')).toHaveCount(0);
  await expect(panel.getByRole('progressbar')).toHaveAttribute('aria-busy', 'false');
  expect(apiCalls).toBe(0);
});
