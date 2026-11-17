import { test, expect, type Page } from '@playwright/test';
import { createProject, saveArtifact } from '../../shared/domain';
import type { ChatRequest, ModuleId, Project } from '../../shared/types';
import { expandRoute } from './project-panel';

const oldText = 'Старая идея: доставка пиццы в офисы';
function projectWithChat() {
  let project = saveArtifact(createProject(), 'idea', { title: 'Пицца', body: oldText });
  project = saveArtifact(project, 'audience', { title: 'Офисы', body: 'Сотрудники небольших офисов' });
  for (const id of ['idea', 'audience'] as const) {
    project.modules[id].artifact!.savedAt = '2026-01-01T00:00:00Z';
    project.modules[id].messages = [{ id: `${id}-user`, role: 'user', content: oldText, createdAt: '2026-01-01T00:00:00Z' }];
    project.modules[id].memory = { updatedAt: '2026-01-01T00:00:00Z', content: { facts: [{ text: oldText, evidence: oldText }], hypotheses: [], openQuestions: [] } };
  }
  project.modules.idea.draft = 'Неотправленная задумка';
  return project;
}
async function seed(page: Page, project = projectWithChat()) {
  const other = createProject(); other.name = 'Другой проект';
  await page.addInitScript(workspace => { if (!localStorage.getItem('cofounder.workspace.v1')) localStorage.setItem('cofounder.workspace.v1', JSON.stringify(workspace)); }, { version: 1, activeProjectId: project.id, projects: [project, other] });
  await page.route('**/api/status', route => route.fulfill({ json: { configured: true, model: 'mock-only', reason: '', searchEnabled: false } }));
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Подключение AI', exact: true })).toHaveText(/^AI подключён/);
  return { project, other };
}
async function stored(page: Page): Promise<Project> {
  return page.evaluate(() => { const data = JSON.parse(localStorage.getItem('cofounder.workspace.v1')!); return data.projects.find((project: Project) => project.id === data.activeProjectId); });
}

for (const colorScheme of ['light', 'dark'] as const) for (const width of [1920, 1440, 1280, 768, 390, 375, 320]) {
  test(`restart is local, durable and accessible at ${width}px ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : width < 640 ? 844 : 900 });
    await page.emulateMedia({ colorScheme });
    let requests = 0;
    await page.route('**/api/chat', route => { requests++; return route.abort(); });
    const { project, other } = await seed(page);
    const restart = page.getByRole('button', { name: 'Начать чат заново', exact: true });
    await expect(restart).toBeInViewport({ ratio: 1 });
    if (width < 640) { const box = await restart.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44); }
    await restart.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Начать чат заново?', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('«Идея»');
    await expect(dialog.getByRole('button', { name: 'Начать заново', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (width === 1280 || width === 390) await page.screenshot({ path: `/tmp/cofounder-restart-confirm-${width}-${colorScheme}.png` });
    await page.keyboard.press('Escape');
    await expect(restart).toBeFocused();
    expect(await stored(page)).toEqual(project);
    await restart.click();
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    expect(await stored(page)).toEqual(project);
    await restart.click();
    await dialog.getByRole('button', { name: 'Начать заново', exact: true }).click();
    await expect(page.locator('.workspace-welcome').getByRole('heading', { name: 'Идея проекта', exact: true })).toBeVisible();
    await expect(restart).toBeDisabled();
    await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('');
    await expect.poll(async () => (await stored(page)).modules.idea.messages.length).toBe(0);
    const reset = await stored(page);
    expect(reset.id).toBe(project.id);
    expect(reset.modules.idea.memory).toBeUndefined();
    expect(reset.modules.idea.artifact).toBeNull();
    expect(reset.modules.audience.messages).toEqual(project.modules.audience.messages);
    expect(reset.modules.audience.artifact).toMatchObject({ body: project.modules.audience.artifact!.body, stale: true });
    expect(await page.evaluate(id => JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects.find((project: Project) => project.id === id), other.id)).toEqual(other);
    expect(requests).toBe(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Найти идею', exact: true })).toBeVisible();
    expect((await stored(page)).modules.idea.resetAt).toBe(reset.modules.idea.resetAt);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1280 || width === 390) await page.screenshot({ path: `/tmp/cofounder-restart-after-${width}-${colorScheme}.png` });
  });
}

for (const moduleId of ['idea', 'audience', 'legal'] as ModuleId[]) {
  test(`new ${moduleId} conversation uses fresh context and keeps its prerequisites`, async ({ page }) => {
    let project = projectWithChat();
    if (moduleId === 'legal') project = saveArtifact(project, 'business', { title: 'Оплата', body: 'Платит компания' });
    project.activeModule = moduleId;
    project.modules[moduleId].draft = 'Старый черновик';
    const sent: ChatRequest[] = [];
    await page.route('**/api/chat', route => {
      const request = route.request().postDataJSON() as ChatRequest; sent.push(request);
      return route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: { message: 'Начнём с новой задумки.', choices: [], artifactDraft: null, proposedFacts: [] } } });
    });
    await seed(page, project);
    await page.getByRole('button', { name: 'Начать чат заново', exact: true }).click();
    await page.getByRole('button', { name: 'Начать заново', exact: true }).click();
    if (moduleId === 'idea') await page.getByRole('button', { name: 'Найти идею', exact: true }).click();
    else await page.getByRole('button', { name: 'Начать этап', exact: true }).click();
    await expect(page.getByText('Начнём с новой задумки.', { exact: true })).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(sent[0].context.history).toEqual([]);
    expect(sent[0].context.artifacts.some(item => item.moduleId === moduleId)).toBe(false);
    expect(sent[0].context.memories?.some(item => item.moduleId === moduleId)).toBe(false);
    if (moduleId === 'idea') { expect(sent[0].context.artifacts).toEqual([]); expect(sent[0].context.memories).toEqual([]); }
    else expect(sent[0].context.artifacts.map(item => item.moduleId)).toContain('idea');
  });
}

test('restarting while waiting cancels the old request and a new dialogue completes independently', async ({ page }) => {
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const sent: ChatRequest[] = [];
  await page.route('**/api/chat', async route => {
    const request = route.request().postDataJSON() as ChatRequest; sent.push(request);
    const first = sent.length === 1;
    if (first) await held;
    await route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: { message: first ? 'Опоздавший старый ответ' : 'Ответ на новую идею', choices: [], artifactDraft: null, proposedFacts: [] } } }).catch(() => {});
  });
  await seed(page, createProject());
  await page.getByRole('button', { name: 'Найти идею', exact: true }).click();
  await expect(page.locator('.ds-thinking')).toBeVisible();
  await page.getByRole('button', { name: 'Начать чат заново', exact: true }).click();
  await page.getByRole('button', { name: 'Начать заново', exact: true }).click();
  await expect(page.locator('.ds-thinking')).toHaveCount(0);
  await page.getByRole('button', { name: 'Есть идея', exact: true }).click();
  await expect(page.getByText('Ответ на новую идею', { exact: true })).toBeVisible();
  release();
  await expect(page.getByText('Опоздавший старый ответ', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Повторить тот же запрос', exact: true })).toHaveCount(0);
  expect(sent).toHaveLength(2);
  expect(sent[0].requestId).not.toBe(sent[1].requestId);
  expect(sent[1].context.history).toEqual([]);
  await page.reload();
  await expect(page.getByText('Ответ на новую идею', { exact: true })).toBeVisible();
  await expect(page.locator('.workspace-message')).toHaveCount(2);
});

test('failed requests are cleared only in the selected chat', async ({ page }) => {
  await page.route('**/api/chat', route => route.abort());
  await seed(page);
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill('Неудавшийся запрос'); await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Повторить тот же запрос', exact: true })).toBeVisible();
  await expandRoute(page);
  await page.locator('.stage-list').getByRole('button', { name: 'Аудитория', exact: true }).click();
  await page.getByRole('button', { name: 'Начать чат заново', exact: true }).click();
  await page.getByRole('button', { name: 'Начать заново', exact: true }).click();
  expect((await stored(page)).modules.idea.messages.at(-1)?.status).toBe('failed');
  await expandRoute(page);
  await page.locator('.stage-list').getByRole('button', { name: 'Идея', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить тот же запрос', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Начать чат заново', exact: true }).click();
  await page.getByRole('button', { name: 'Начать заново', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить тот же запрос', exact: true })).toHaveCount(0);
});
