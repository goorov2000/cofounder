import { test, expect } from '@playwright/test';
import { createProject } from '../../shared/domain';

const sample = `## Как это влияет на достижимые продажи

В прежнем условном сценарии первого года: 3 месяца подготовки, затем 9 месяцев работы по 2 заказа в месяц. **Предел исполнения — 18 заказов.** Проверим чувствительность к продажам:

| При 100 подходящих обращениях | Оплаченные заказы | Выполненные заказы с учётом предела 18 |
| :--- | ---: | ---: |
| Конверсия 5% | 5 | 5 |
| Конверсия 10% | 10 | 10 |
| Конверсия 20% | 20 | 18 |

**Все числа — допущения, не прогноз.** Таблица предполагает, что обращения поступают после готовности производства.

## Сравнение способов проверки

| Канал | Условия размещения | Аудитория | Обращения | Выполнимые запросы | Оплаченные заказы | Затраты | Основание |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| Тематические сообщества | Размещения после согласования с администраторами сообщества | Уже заказывающие одежду по собственным эскизам | Неизвестно | Неизвестно | Неизвестно | Неизвестно | Публичное исследование или проверка гипотезы ещё не проведены |

После таблицы обсуждение продолжается.`;

for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 1280, 390]) test(`Markdown tables align with their frame and scroll locally ${width} ${colorScheme}`, async ({ page }, testInfo) => {
  const project = createProject(); project.activeModule = 'market'; project.unlockedStages = ['idea', 'audience', 'competitors', 'market'];
  project.modules.market.messages = [{ id: 'table-answer', role: 'assistant', content: sample, createdAt: project.createdAt }];
  project.modules.market.draft = 'Черновик остаётся на месте';
  await page.route('**/api/**', route => route.request().url().endsWith('/status') ? route.fulfill({ json: { configured: false, reason: 'Проверка оформления без API', model: '', searchEnabled: false } }) : route.abort());
  await page.addInitScript(project => { if (!localStorage.getItem('cofounder.workspace.v1')) localStorage.setItem('cofounder.workspace.v1', JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] })); }, project);
  await page.setViewportSize({ width, height: width === 390 ? 844 : width === 1280 ? 720 : 900 }); await page.emulateMedia({ colorScheme }); await page.goto('/');
  const wrappers = page.getByRole('region', { name: 'Таблица в сообщении', exact: true }); await expect(wrappers).toHaveCount(2);
  await wrappers.first().scrollIntoViewIfNeeded();
  const metrics = await wrappers.first().evaluate(wrapper => {
    const table = wrapper.querySelector('table')!, row = table.querySelector('tr')!, header = table.querySelectorAll('th')[2];
    return { display: getComputedStyle(table).display, wrapper: wrapper.clientWidth, table: table.getBoundingClientRect().width, row: row.getBoundingClientRect().width,
      lastCellRight: header.getBoundingClientRect().right, tableRight: table.getBoundingClientRect().right, align: getComputedStyle(table.querySelectorAll('td')[1]).textAlign };
  });
  expect(metrics.display).toBe('table'); expect(Math.abs(metrics.table - metrics.row)).toBeLessThan(2);
  expect(Math.abs(metrics.lastCellRight - metrics.tableRight)).toBeLessThan(2);
  expect(metrics.table).toBeGreaterThanOrEqual(metrics.wrapper - 2);
  if (width >= 1280) expect(metrics.table).toBeLessThanOrEqual(metrics.wrapper + 2);
  expect(metrics.align).toBe('right');
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('Черновик остаётся на месте');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('tables-in-chat.png'), fullPage: true });
  if (width === 390) {
    const wide = wrappers.nth(1); await wide.scrollIntoViewIfNeeded();
    expect(await wide.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await wide.focus(); await page.keyboard.press('ArrowRight');
    await expect.poll(() => wide.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Продолжаю писать, таблица не сбрасывается');
    expect(await wide.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await expect(page.getByText('После таблицы обсуждение продолжается.', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('wide-table-scroll.png'), fullPage: true });
  }
});
