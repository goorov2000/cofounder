import { test, expect } from '@playwright/test';
import { PALETTES, PALETTE_KEY } from '../../src/design-system/palettes';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.request().url().endsWith('/status')
    ? route.fulfill({ json: { configured: false, reason: 'Проверка логотипа', model: 'mock-only', searchEnabled: false } })
    : route.abort());
});

for (const palette of PALETTES) for (const theme of ['light', 'dark'] as const) {
  test(`brand ${palette.id} ${theme}: original artwork and a readable 16/32px favicon`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(({ paletteKey, id, mode }) => {
      localStorage.setItem(paletteKey, id);
      localStorage.setItem('cofounder.theme.v1', mode);
    }, { paletteKey: PALETTE_KEY, id: palette.id, mode: theme });
    await page.goto('/');
    const brand = page.locator('.brand-mark .ds-brand-symbol');
    await expect(brand).toBeVisible();
    await expect(brand.locator('image')).toHaveAttribute('href', '/brand/cofounder-original.png');
    await expect(page.locator('.brand-mark .lucide-sprout')).toHaveCount(0);
    const colors = await page.locator('.brand-mark').evaluate(element => {
      const style = getComputedStyle(element);
      return { light: style.getPropertyValue('--ds-favicon-light').trim(), dark: style.getPropertyValue('--ds-favicon-dark').trim(), background: style.backgroundColor };
    });
    expect(colors.background).toBe('rgba(0, 0, 0, 0)');
    await expect.poll(() => page.locator('#app-favicon').evaluate((element, colors) => {
      const href = element.getAttribute('href') ?? '';
      if (!href.startsWith('data:image/svg+xml,')) return false;
      const svg = decodeURIComponent(href.slice(href.indexOf(',') + 1));
      return svg.includes(`--brand-color:${colors.light};`) && svg.includes(`--brand-color:${colors.dark};`);
    }, colors)).toBe(true);
    const pixels = await page.evaluate(async ({ colors, mode }) => {
      const img = new Image(); img.src = document.querySelector<HTMLLinkElement>('#app-favicon')!.href; await img.decode();
      const color = (mode === 'dark' ? colors.dark : colors.light).slice(1).match(/../g)!.map(value => parseInt(value, 16));
      return [16, 32].map(size => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0, size, size);
        const pixels = ctx.getImageData(0, 0, size, size).data;
        let coverage = 0, opaque = 0, correctColor = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          coverage += pixels[i + 3] / 255;
          if (pixels[i + 3] < 128) continue;
          opaque++;
          if (color.every((value, channel) => Math.abs(value - pixels[i + channel]) < 20)) correctColor++;
        }
        return { size, coverage, opaque, correctColor, cornerAlpha: pixels[3] };
      });
    }, { colors, mode: theme });
    for (const result of pixels) {
      expect(result.coverage).toBeGreaterThan(result.size ** 2 * .25);
      expect(result.coverage).toBeLessThan(result.size ** 2 * .6);
      expect(result.correctColor).toBeGreaterThan(result.opaque * .95);
      expect(result.cornerAlpha).toBeLessThan(10);
    }
    await page.screenshot({ path: testInfo.outputPath('workspace.png') });
    await page.getByRole('button', { name: 'Свернуть меню', exact: true }).click();
    await expect(brand).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('collapsed.png') });
  });
}

for (const mode of ['light', 'dark'] as const) {
  test(`brand mobile ${mode}: navigation, gallery and the draft remain usable`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.emulateMedia({ colorScheme: mode });
    await page.goto('/');
    const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
    await input.fill('Черновик с новым логотипом');
    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    await expect(page.locator('.mobile-navigation .ds-brand-symbol')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('mobile-menu.png') });
    await page.keyboard.press('Escape');
    await expect(input).toHaveValue('Черновик с новым логотипом');
    await page.goto('/design-system');
    await expect(page.locator('.ds-library-brand .ds-brand-symbol')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('gallery.png') });
  });
}

test('brand transparent favicon follows the palette with both browser color variants', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Выбрать цветовую палитру', exact: true }).click();
  await page.getByRole('radio', { name: 'Ирис', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.locator('#app-favicon').evaluate(element => {
    const svg = decodeURIComponent(element.getAttribute('href')!);
    return svg.includes('--brand-color:#6742a6;') && svg.includes('--brand-color:#cfb3ff;') && svg.includes('prefers-color-scheme:dark');
  })).toBe(true);
  const href = await page.locator('#app-favicon').getAttribute('href');
  await page.getByRole('button', { name: 'Включить тёмную тему', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('#app-favicon').getAttribute('href') === href).toBe(true);
});

test('brand static favicon embeds the supplied artwork and remains available before React', async ({ page, request }) => {
  const response = await request.get('/favicon.svg?v=cofounder-20261116');
  expect(response.ok()).toBe(true);
  const source = await response.text();
  expect(source.includes('data:image/png;base64,')).toBe(true);
  expect(source.includes('mask-type:alpha')).toBe(true);
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, route => route.abort());
  await page.goto('/');
  await expect(page.locator('#app-favicon')).toHaveAttribute('href', '/favicon.svg?v=cofounder-20261116');
  await expect(page.locator('#root')).toBeEmpty();
});
