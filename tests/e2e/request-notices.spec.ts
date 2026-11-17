import { test, expect } from '@playwright/test';
import { createProject } from '../../shared/domain';

for (const theme of ['light', 'dark'] as const) for (const width of [375, 768, 1280, 1920]) {
  test(`small invalid context has a readable inline explanation at ${width}px ${theme}`, async ({ page }, testInfo) => {
    const project = createProject();
    // Valid persisted data can exceed a narrower API field bound without being
    // anywhere near the total request size limit.
    project.description = 'SYNTHETIC_PRIVATE_DESCRIPTION_'.repeat(230);
    project.modules.idea.messages = [{ id: 'synthetic-choice-answer', role: 'assistant', content: 'Можем уточнить учебную концепцию.', createdAt: project.createdAt, choices: [{ id: 'concept', label: 'Уточнить концепцию', description: 'Сформулировать, какой результат нужен человеку.' }] }];
    const calls: string[] = [];
    await page.route('**/api/**', route => {
      calls.push(route.request().url());
      return route.request().url().endsWith('/status') ? route.fulfill({ json: { configured: true, model: 'mock-only', reason: 'Zero API preflight check', searchEnabled: false } }) : route.abort();
    });
    await page.addInitScript(({ project, theme }) => {
      localStorage.setItem('cofounder.workspace.v1', JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] }));
      localStorage.setItem('cofounder.theme.v1', theme);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as any).__noticeCopied = text; } } });
    }, { project, theme });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1')!));
    await page.getByRole('button', { name: /Уточнить концепцию/ }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('внутренняя ошибка');
    await expect(alert).toContainText('а не ограничение длины');
    await expect(alert).not.toContainText('Контекст превышает');
    await expect(alert).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await alert.evaluate(element => !!element.closest('.workspace-thread'))).toBe(true);
    const bounds = await alert.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(752);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await alert.getByRole('button', { name: 'Скопировать сведения об ошибке', exact: true }).click();
    await expect(alert).toContainText('Сведения скопированы');
    const diagnosticText = await page.evaluate(() => (window as any).__noticeCopied as string);
    const diagnostic = JSON.parse(diagnosticText);
    expect(diagnostic.code).toBe('INVALID_REQUEST_CONTEXT');
    expect(diagnostic.bytes).toBeLessThan(diagnostic.limitBytes);
    expect(diagnostic.issues).toContainEqual({ path: ['context', 'description'], code: 'too_big' });
    expect(diagnosticText).not.toContain('SYNTHETIC_PRIVATE_DESCRIPTION_');
    expect(calls.filter(url => !url.endsWith('/status'))).toEqual([]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1')!))).toEqual(before);
    await page.screenshot({ path: testInfo.outputPath(`request-error-${theme}-${width}.png`) });
    await alert.getByRole('button', { name: 'Скрыть уведомление', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}
