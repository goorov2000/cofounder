import { test, expect } from '@playwright/test';
import { openCompletionExample } from './project-panel';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.request().url().endsWith('/status')
    ? route.fulfill({ json: { configured: false, reason: 'Проверка интерфейса', model: 'mock-only', searchEnabled: false } })
    : route.abort());
});

test('theme follows the system until a direct toggle, then persists and preserves the draft', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill('Черновик должен остаться после смены темы');
  await page.getByRole('button', { name: 'Включить тёмную тему', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Включить светлую тему', exact: true })).toBeFocused();
  await expect(input).toHaveValue('Черновик должен остаться после смены темы');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(input).toHaveValue('Черновик должен остаться после смены темы');
  const other = await context.newPage();
  await other.goto('/design-system');
  await other.getByRole('button', { name: 'Включить светлую тему', exact: true }).click();
  await expect(other.getByRole('dialog')).toHaveCount(0);
  await expect(other.getByText('Как в системе', { exact: true })).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await other.close();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Включить тёмную тему', exact: true }).press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Включить светлую тему', exact: true }).press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(input).toHaveValue('Черновик должен остаться после смены темы');
});

test('theme can change when storage is blocked', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
  });
  await page.goto('/design-system');
  await page.getByRole('button', { name: 'Включить тёмную тему', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Включить светлую тему', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('gallery examples expose usable forms, filters, dialog and message choices', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/design-system');
  await page.getByRole('textbox', { name: 'Название проекта' }).fill('');
  await page.getByRole('button', { name: 'Сохранить название' }).click();
  await expect(page.getByRole('textbox', { name: 'Название проекта' })).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('textbox', { name: 'Название проекта' }).fill('Новая мастерская');
  await page.getByRole('button', { name: 'Сохранить название' }).click();
  await expect(page.getByText('Сохранено в примере')).toBeVisible();
  await page.getByRole('button', { name: 'Частным мастерам', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Частным мастерам', exact: false })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('textbox', { name: 'Свой вариант', exact: true }).fill('Мастерским ремонта');
  await page.getByRole('button', { name: 'Добавить сообщение в пример' }).click();
  await expect(page.locator('.ds-example-user-message').last()).toContainText('Мастерским ремонта');
  await openCompletionExample(page);
  await expect(page.locator('.ds-topic-completion')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Фильтр материалов' }).selectOption('saved');
  await expect(page.locator('.ds-table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Создать проект', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

for (const width of [1440, 1280, 390, 320]) for (const theme of ['light', 'dark'] as const) {
  test(`${theme} layout remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 900 ? 900 : 844 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/design-system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1440 || width === 390) await page.screenshot({ path: `docs/design-system/evidence/library-${theme}-${width}.png`, fullPage: true });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('.workspace-tabs')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const composer = page.locator('.workspace-composer');
    await expect(composer).toBeVisible();
    await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Проверка черновика');
    await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: /^Включить .+ тему$/ })).toBeInViewport({ ratio: 1 });
    if (width < 640) await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    await page.getByRole('button', { name: 'Проекты', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(45, 45, 45)' : 'rgb(255, 255, 255)');
    await page.keyboard.press('Escape');
    if (width === 1440 || width === 390) await page.screenshot({ path: `docs/design-system/evidence/workspace-${theme}-${width}.png` });
  });
}

test('short laptop keeps composer actions visible in dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Подготовить итог', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Как работать', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Подготовить итог', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeInViewport({ ratio: 1 });
});

test('text and button tokens retain contrast in both themes', async ({ page }) => {
  await page.goto('/design-system');
  for (const [theme, label] of [['light', 'Светлая'], ['dark', 'Тёмная']]) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: /^Включить .+ тему$/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const failures = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const rgb = (name: string) => style.getPropertyValue(`--ds-${name}`).trim().replace('#', '').match(/../g)!.map(value => parseInt(value, 16) / 255);
      const luminance = (name: string) => rgb(name).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
      const pairs: string[][] = [];
      for (const foreground of ['text', 'text-secondary', 'accent']) for (const background of ['surface', 'surface-muted', 'canvas', 'surface-raised']) pairs.push([foreground, background]);
      for (const background of ['action', 'action-hover', 'action-active']) pairs.push(['on-action', background]);
      for (const status of ['success', 'warning', 'danger', 'info']) { pairs.push([status, `${status}-bg`]); pairs.push([status, 'surface']); }
      return pairs.map(([fg, bg]) => ({ fg, bg, ratio: (Math.max(luminance(fg), luminance(bg)) + .05) / (Math.min(luminance(fg), luminance(bg)) + .05) })).filter(pair => pair.ratio < 4.5);
    });
    expect(failures, `${label} theme contrast`).toEqual([]);
  }
});
