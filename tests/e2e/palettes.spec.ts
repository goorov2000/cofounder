import { test, expect } from '@playwright/test';
import { PALETTES, PALETTE_KEY } from '../../src/design-system/palettes';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.request().url().endsWith('/status')
    ? route.fulfill({ json: { configured: false, reason: 'Проверка оформления', model: 'mock-only', searchEnabled: false } })
    : route.abort());
});

test('palette selection preserves the workspace, system mode, draft and other tabs', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill('Идея и черновик сохраняются при выборе оформления');
  const before = await page.locator('.workspace-composer').boundingBox();
  await page.getByRole('button', { name: 'Выбрать цветовую палитру', exact: true }).click();
  await expect(page.getByRole('radio')).toHaveCount(5);
  await expect(page.getByRole('radio', { name: 'СберБизнес', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'Ирис', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'iris');
  await page.getByRole('button', { name: 'Закрыть палитру', exact: true }).click();
  await expect(input).toHaveValue('Идея и черновик сохраняются при выборе оформления');
  expect(await page.locator('.workspace-composer').boundingBox()).toEqual(before);
  expect(await page.evaluate(() => localStorage.getItem('cofounder.theme.v1'))).toBeNull();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'iris');
  await page.getByRole('button', { name: 'Включить светлую тему', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'iris');
  await expect(input).toHaveValue('Идея и черновик сохраняются при выборе оформления');
  const other = await context.newPage();
  await other.route('**/api/**', route => route.abort());
  await other.goto('/design-system');
  await other.getByRole('button', { name: 'Выбрать цветовую палитру', exact: true }).click();
  await other.getByRole('radio', { name: 'Плазма', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'plasma');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(input).toHaveValue('Идея и черновик сохраняются при выборе оформления');
  await other.close();
});

test('palette picker supports keyboard selection, Escape and a collapsed sidebar', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Свернуть меню', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'Выбрать цветовую палитру', exact: true });
  await expect(trigger).toBeInViewport({ ratio: 1 });
  expect(await trigger.boundingBox()).toMatchObject({ width: 40, height: 40 });
  await trigger.press('Enter');
  const business = page.getByRole('radio', { name: 'СберБизнес', exact: true });
  await business.focus();
  await business.press('ArrowDown');
  await expect(page.getByRole('radio', { name: 'Плазма', exact: true })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'plasma');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('palette and light/dark remain independent with blocked storage', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
  });
  await page.goto('/design-system');
  await page.getByRole('button', { name: 'Выбрать цветовую палитру', exact: true }).click();
  await page.getByRole('radio', { name: 'Гига', exact: true }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Включить тёмную тему', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'giga');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

for (const width of [1280, 390, 320]) {
  test(`palette popover leaves the workspace usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Выбрать цветовую палитру', exact: true });
    const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
    await trigger.click();
    const panel = page.getByRole('dialog', { name: 'Цветовая палитра', exact: true });
    await expect(panel).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await page.locator(':modal').count()).toBe(0);
    expect(await panel.evaluate(element => getComputedStyle(element, '::backdrop').backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const box = (await panel.boundingBox())!;
    expect(box.width * box.height).toBeLessThan(width * 844 * .4);
    expect(box.width).toBeLessThanOrEqual(248);
    for (const name of ['Ирис', 'Плазма', 'Сбер']) {
      await page.getByRole('radio', { name, exact: true }).check();
      await expect(panel).toBeVisible();
    }
    await trigger.click();
    await expect(panel).not.toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await input.click();
    await expect(panel).not.toBeVisible();
    await expect(input).toBeFocused();
    await input.fill('Можно продолжать работу сразу');
    await trigger.click();
    await page.getByRole('button', { name: /^Включить .+ тему$/ }).click();
    await expect(panel).not.toBeVisible();
    await expect(input).toHaveValue('Можно продолжать работу сразу');
  });
}

test('palette popover stays within a short viewport and closes when focus leaves', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 480 });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Выбрать цветовую палитру', exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const panel = page.getByRole('dialog', { name: 'Цветовая палитра', exact: true });
  for (const height of [480, 360]) {
    await page.setViewportSize({ width: 1024, height });
    await expect(async () => {
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(8);
      expect(box.y).toBeGreaterThanOrEqual(8);
      expect(box.x + box.width).toBeLessThanOrEqual(1016);
      expect(box.y + box.height).toBeLessThanOrEqual(height - 8);
    }).toPass();
  }
  await page.getByRole('radio', { name: 'СберБизнес', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(panel).not.toBeVisible();
});

for (const saved of ['iris', 'unknown-theme']) {
  test(`palette boot validates stored value ${saved} before React`, async ({ page }) => {
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, value);
      localStorage.setItem('cofounder.theme.v1', 'dark');
    }, { key: PALETTE_KEY, value: saved });
    await page.route(/\/src\/main\.tsx(?:\?.*)?$/, route => route.abort());
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-palette', saved === 'iris' ? 'iris' : 'sber-business');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#root')).toBeEmpty();
  });
}

for (const palette of PALETTES) for (const theme of ['light', 'dark'] as const) {
  test(`palette ${palette.id} ${theme} retains readable tokens`, async ({ page }) => {
    await page.addInitScript(({ key, id }) => { localStorage.setItem(key, id); }, { key: PALETTE_KEY, id: palette.id });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/design-system');
    await expect(page.locator('html')).toHaveAttribute('data-palette', palette.id);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const failures = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const luminance = (name: string) => style.getPropertyValue(`--ds-${name}`).trim().slice(1).match(/../g)!
        .map(value => parseInt(value, 16) / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
      const pairs: string[][] = [];
      for (const fg of ['text', 'text-secondary', 'accent']) for (const bg of ['surface', 'surface-muted', 'canvas', 'surface-raised']) pairs.push([fg, bg]);
      pairs.push(['text', 'accent-subtle'], ['accent', 'accent-subtle']);
      for (const bg of ['action', 'action-hover', 'action-active']) pairs.push(['on-action', bg]);
      for (const status of ['success', 'warning', 'danger', 'info']) pairs.push([status, `${status}-bg`], [status, 'surface']);
      return pairs.map(([fg, bg]) => ({ fg, bg, ratio: (Math.max(luminance(fg), luminance(bg)) + .05) / (Math.min(luminance(fg), luminance(bg)) + .05) })).filter(pair => pair.ratio < 4.5);
    });
    expect(failures).toEqual([]);
    expect(await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content') === getComputedStyle(document.documentElement).getPropertyValue('--ds-canvas').trim())).toBe(true);
  });

  for (const width of [1280, 320]) {
    test(`palette ${palette.id} ${theme} at ${width}px preserves layout and previews`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 320 ? 844 : 720 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/');
      const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
      await input.fill('Черновик проекта');
      const before = await page.locator('.workspace-composer').boundingBox();
      const trigger = page.getByRole('button', { name: 'Выбрать цветовую палитру', exact: true });
      await expect(trigger).toBeInViewport({ ratio: 1 });
      await trigger.click();
      await page.getByRole('radio', { name: palette.name, exact: true }).check();
      await expect(page.locator('html')).toHaveAttribute('data-palette', palette.id);
      const colors = await page.locator('.ds-palette-preview').evaluateAll(previews => previews.map(preview => getComputedStyle(preview.querySelector('i')!).backgroundColor));
      expect(new Set(colors).size).toBe(PALETTES.length);
      await page.screenshot({ path: testInfo.outputPath('picker.png') });
      expect(await page.getByRole('dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
      const box = (await page.getByRole('dialog').boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(248);
      expect(box.x).toBeGreaterThanOrEqual(8);
      expect(box.y).toBeGreaterThanOrEqual(8);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
      expect(box.y + box.height).toBeLessThanOrEqual((width === 320 ? 844 : 720) - 8);
      await page.getByRole('button', { name: 'Закрыть палитру', exact: true }).click();
      await expect(input).toHaveValue('Черновик проекта');
      expect(await page.locator('.workspace-composer').boundingBox()).toEqual(before);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: /^Включить .+ тему$/ })).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath('workspace.png') });
    });
  }
}
