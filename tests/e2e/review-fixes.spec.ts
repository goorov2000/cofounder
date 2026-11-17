import { test, expect } from '@playwright/test';

for (const width of [1440, 1280, 390]) test(`material screens can be scrolled to their final controls at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 720 });
  await page.route('**/api/status', route => route.fulfill({ json: { configured: false, reason: 'Изолированный тест без ключа', model: 'mock-only', searchEnabled: false } }));
  await page.goto('/');
  if (width < 640) await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await page.getByRole('button', { name: 'Проекты', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть подготовленный пример', exact: true }).click();
  await expect.poll(()=>page.evaluate(()=>{const workspace=JSON.parse(localStorage.getItem('cofounder.workspace.v1')!);return workspace.projects.find((project:{id:string})=>project.id===workspace.activeProjectId).name;})).toBe('StaffPlanner — вымышленный пример');
  await expect(page.locator('.workspace-welcome')).toContainText('StaffPlanner — вымышленный пример');
  for (const name of ['Презентация', 'Инструменты', 'Свой стартап']) {
    const menu = page.getByRole('button', { name: 'Открыть меню', exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('button', { name, exact: true }).click();
    await expect.soft(page.locator('.materials-screen > h1'), `${name}: navigation starts at the page heading`).toBeInViewport({ ratio: 1, timeout: 1500 });
    const finalControl = name === 'Презентация' ? page.getByText('Перейти к исходным материалам', { exact: true }) : name === 'Инструменты' ? page.locator('.tool-list button').last() : page.getByRole('button', { name: 'Скачать JSON', exact: true });
    const bounds = await page.locator('main').boundingBox();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.wheel(0, -100_000);
    await page.waitForTimeout(100);
    await page.mouse.wheel(0, 100_000);
    await expect.soft(finalControl, `${name}: last control must be reached by an ordinary wheel scroll`).toBeInViewport({ ratio: 1, timeout: 1500 });
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
