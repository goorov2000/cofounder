import { test, expect, type Page } from '@playwright/test';
import { createDemoProject, createProject } from '../../shared/domain';
import type { Project } from '../../shared/types';
import { expandRoute } from './project-panel';

async function seed(page: Page, projects: Project[]) {
  await page.addInitScript(raw => {
    if (!localStorage.getItem('cofounder.workspace.v1')) localStorage.setItem('cofounder.workspace.v1', raw);
  }, JSON.stringify({ version: 1, activeProjectId: projects[0].id, projects }));
  await page.route('**/api/**', route => route.request().url().endsWith('/status')
    ? route.fulfill({ json: { configured: true, reason: '', model: 'mock-only', searchEnabled: false } }) : route.abort());
  await page.goto('/');
}

async function menu(page: Page) {
  const toggle = page.getByRole('button', { name: 'Открыть меню', exact: true });
  if (await toggle.isVisible()) await toggle.click();
  return page.getByRole('navigation', { name: 'Основная навигация', exact: true });
}

async function navigate(page: Page, name: string, keyboard = false) {
  const item = (await menu(page)).getByRole('button', { name, exact: true });
  if (keyboard) { await item.focus(); await item.press('Enter'); } else await item.click();
  await expect(page.getByRole('dialog', { name: 'Навигация', exact: true })).toBeHidden();
}

for (const colorScheme of ['light', 'dark'] as const) for (const width of [1280, 390]) {
  test(`return from locked MVP preserves the conversation at ${width} ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 844 });
    await page.emulateMedia({ colorScheme });
    const project = createProject();
    project.modules.idea.draft = 'Неотправленная идея';
    project.modules.idea.messages = [{ id: 'idea-history', role: 'assistant', content: 'Обсуждали пиццу для мероприятий.', createdAt: new Date().toISOString() }];
    await seed(page, [project]);
    await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('Неотправленная идея');
    for (let repeat = 0; repeat < 2; repeat++) {
      await navigate(page, 'MVP');
      await expect(page.getByRole('heading', { name: 'Описание MVP', exact: true })).toBeVisible();
      await expect(page.getByRole('alert').filter({ hasText: 'Для этого этапа сохраните:' })).toBeVisible();
      await navigate(page, 'Мастерская', true);
      await expect(page.getByRole('heading', { name: 'Идея проекта', exact: true })).toBeVisible({ timeout: 2000 });
      await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeEnabled();
      await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('Неотправленная идея');
      await expect(page.getByText('Обсуждали пиццу для мероприятий.', { exact: true })).toBeVisible();
    }
    await expect((await menu(page)).getByRole('button', { name: 'Мастерская', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation').getByRole('button', { name: 'MVP', exact: true })).not.toHaveAttribute('aria-current');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const entry of ['menu', 'route']) test(`return from available MVP restores the previous stage via ${entry}`, async ({ page }) => {
  const project = createDemoProject();
  project.activeModule = 'audience';
  project.modules.audience.draft = 'Вопрос об аудитории';
  project.modules.mvp.draft = 'Вопрос о прототипе';
  await seed(page, [project]);
  if (entry === 'menu') await navigate(page, 'MVP');
  else { await expandRoute(page); await page.locator('.stage-list').getByRole('button', { name: 'MVP', exact: true }).click(); }
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('Вопрос о прототипе');
  await navigate(page, 'Презентация');
  await expect(page.getByRole('heading', { name: 'Презентация и MVP', exact: true })).toBeVisible();
  await navigate(page, 'Мастерская');
  await expect(page.getByRole('heading', { name: 'Целевая аудитория', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('Вопрос об аудитории');
  await navigate(page, 'MVP');
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('Вопрос о прототипе');
});

test('a project already saved in MVP can return to idea after reload', async ({ page }) => {
  const project = createProject();
  project.activeModule = 'mvp';
  project.modules.idea.draft = 'Черновик до перехода';
  await seed(page, [project]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Описание MVP', exact: true })).toBeVisible();
  await navigate(page, 'Мастерская');
  await expect(page.getByRole('heading', { name: 'Идея проекта', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('Черновик до перехода');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0].activeModule)).toBe('idea');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Идея проекта', exact: true })).toBeVisible();
});

test('each project returns to its own previous stage', async ({ page }) => {
  const first = createDemoProject(); first.name = 'Первый проект'; first.activeModule = 'audience';
  const second = createDemoProject(); second.name = 'Второй проект'; second.activeModule = 'team';
  await seed(page, [first, second]);
  await navigate(page, 'MVP');
  await page.getByRole('button', { name: 'Проекты', exact: true }).click();
  await page.getByRole('button', { name: /Второй проект/ }).click();
  await expect(page.getByRole('heading', { name: 'Команда и роли', exact: true })).toBeVisible();
  await navigate(page, 'MVP');
  await navigate(page, 'Мастерская');
  await expect(page.getByRole('heading', { name: 'Команда и роли', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Проекты', exact: true }).click();
  await page.getByRole('button', { name: /Первый проект/ }).click();
  await expect(page.getByRole('heading', { name: 'Описание MVP', exact: true })).toBeVisible();
  await navigate(page, 'Мастерская');
  await expect(page.getByRole('heading', { name: 'Целевая аудитория', exact: true })).toBeVisible();
});
