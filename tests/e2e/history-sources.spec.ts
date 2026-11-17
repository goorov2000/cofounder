import { test, expect } from '@playwright/test';
import { createProject } from '../../shared/domain';
import type { MessageRevision } from '../../shared/types';

for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 1280, 390]) {
  test(`historical source links open the full original at ${width}px ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 844 });
    await page.emulateMedia({ colorScheme });
    const project = createProject();
    const sources: MessageRevision[] = [
      { projectId: project.id, moduleId: 'audience', generation: 0, messageId: 'archived-one', revision: 1, role: 'user', createdAt: '2026-11-01T10:00:00Z', content: 'Первым пользователем будет бухгалтер. Это пока гипотеза.' },
      { projectId: project.id, moduleId: 'audience', generation: 0, messageId: 'archived-two', revision: 2, role: 'user', createdAt: '2026-11-02T10:00:00Z', content: `Историческое уточнение до цитаты.\n${'Сохранённый контекст. '.repeat(120)}\nОтчёт нужен директору в Telegram.\nПосле цитаты: доставка по расписанию ещё не согласована. <img src=x onerror=alert(1)>` },
    ];
    project.modules.idea.messages = [{ id: 'answer', role: 'assistant', createdAt: '2026-11-15T12:00:00Z', content: 'Вы уточнили: «Отчёт нужен директору в Telegram.»', reply: { message: 'Вы уточнили: «Отчёт нужен директору в Telegram.»', choices: [], proposedFacts: [], artifactDraft: null, historySources: sources.map((source, i) => ({ source, quotes: [i ? 'Отчёт нужен директору в Telegram.' : 'Первым пользователем будет бухгалтер.'] })) } }];
    await page.addInitScript(project => localStorage.setItem('cofounder.workspace.v1', JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] })), project);
    await page.route('**/api/**', route => route.request().url().endsWith('/status') ? route.fulfill({ json: { configured: false, reason: 'UI test', model: 'mock-only', searchEnabled: false } }) : route.abort());
    await page.goto('/');
    const draft = page.getByRole('textbox', { name: 'Сообщение', exact: true });
    await draft.fill('Мой неотправленный вопрос');
    const trigger = page.getByRole('button', { name: 'Ещё действия с ответом', exact: true });
    await trigger.click(); await page.getByRole('menuitem', { name: 'Посмотреть источники' }).click();
    const modal = page.getByRole('dialog', { name: 'Источники ответа', exact: true });
    const links = modal.getByRole('link', { name: /Открыть исходную реплику/ });
    await expect(links).toHaveCount(2);
    const href = await links.nth(1).getAttribute('href');
    expect(href).toBeTruthy();
    await links.nth(1).focus(); await page.keyboard.press('Enter');
    const original = modal.locator('[data-history-original]').nth(1);
    await expect(original).toHaveAttribute('id', href!.slice(1));
    await expect(original).toBeFocused();
    await expect(original.locator('..')).toHaveAttribute('open', '');
    await expect(modal.locator('[data-history-original]').first().locator('..')).not.toHaveAttribute('open', '');
    await expect(original).toContainText('Историческое уточнение до цитаты.');
    await expect(original).toContainText('После цитаты: доставка по расписанию ещё не согласована.');
    await expect(original.locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await modal.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    expect(await page.evaluate(() => location.hash)).toBe('');
    await page.screenshot({ path: `.repair/2026-11-15/history-source-ui/${width}-${colorScheme}.png` });
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    await expect(draft).toHaveValue('Мой неотправленный вопрос');
    const active = await page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0].activeModule);
    expect(active).toBe('idea');
  });
}
