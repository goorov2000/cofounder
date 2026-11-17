import { test, expect } from '@playwright/test';
import supertest from 'supertest';
import type OpenAI from 'openai';
import { createProject } from '../../shared/domain';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { OpenAIProvider, type ResponseTransport } from '../../server/provider';
import { BudgetLedger } from '../../server/ledger';
import { PALETTES } from '../../src/design-system/palettes';

for (const colorScheme of ['light', 'dark'] as const) for (const width of [1280, 390]) test(`calculation fills from conversation, protects manual inputs and survives reload ${width} ${colorScheme}`, async ({ page }, testInfo) => {
  const project = createProject(); project.activeModule = 'market'; project.unlockedStages = ['idea', 'audience', 'competitors', 'market'];
  let answers = 0; const calls: string[] = [];
  const transport: ResponseTransport = async params => {
    const name = params.text?.format?.type === 'json_schema' ? params.text.format.name : 'search'; calls.push(name);
    const quote = answers > 0 ? 'Уточнённый сценарий: 10000 потенциальных покупателей, 2000 доступных, 40 достижимых. Расходы покупателя 9000 ₽ за год.' : 'Предлагаю сценарий: 10000 потенциальных покупателей, 2000 доступных, 60 достижимых. Расходы покупателя 8000 ₽ за год.';
    const values = { totalBuyers: '10000', reachableBuyers: '2000', targetBuyers: answers > 0 ? '40' : '60', price: answers > 0 ? '9000' : '8000', period: 'год', pricePeriod: 'год', currency: '₽' };
    const candidate = { message: quote, choices: [], artifactDraft: null, proposedFacts: [], memoryOperations: [], externalClaims: [], calculationScenario: { entries: Object.entries(values).map(([field, value]) => ({ field, value, quote, role: 'assistant' })) } };
    if (name === 'cofounder_reply') answers++;
    return { status: 'completed', error: null, output: [], output_text: JSON.stringify(name === 'cofounder_action' ? { action: 'answer', query: '' } : candidate), usage: { input_tokens: 100, output_tokens: 100 } } as unknown as OpenAI.Responses.Response;
  };
  const config = loadConfig({ OPENAI_API_KEY: 'synthetic-placeholder', OPENAI_MODEL: 'gpt-6.1-sol', AI_BUDGET_USD: '64', APP_ORIGIN: 'http://127.0.0.1:3088' });
  const ledger = new BudgetLedger(':memory:', config), agent = supertest.agent(createApp({ config, ledger, provider: new OpenAIProvider(config, { transport }) }));
  try {
    await page.route('**/api/status', async route => { const r = await agent.get('/api/status'); await route.fulfill({ status: r.status, json: r.body }); });
    await page.route('**/api/chat', async route => { const r = await agent.post('/api/chat').set('Origin', config.origin).send(route.request().postDataJSON()); await route.fulfill({ status: r.status, json: r.body }); });
    await page.addInitScript(project => { if (!localStorage.getItem('cofounder.workspace.v1')) localStorage.setItem('cofounder.workspace.v1', JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] })); }, project);
    await page.setViewportSize({ width, height: width < 900 ? 844 : 720 }); await page.emulateMedia({ colorScheme }); await page.goto('/');
    async function openCalculator() {
      if (width < 900) await page.getByRole('button', { name: 'Открыть панель проекта', exact: true }).click();
      await page.getByRole('button', { name: /^Расчёт/ }).click();
      return page.getByRole('dialog', { name: 'Расчёт · Рынок', exact: true });
    }
    const initial = await openCalculator(); await expect(initial.getByText('Начните с обсуждения рынка', { exact: true })).toBeVisible();
    await expect(initial.getByRole('region', { name: 'TAM', exact: true })).toContainText('Нужны вводные'); expect(calls).toHaveLength(0);
    await initial.getByRole('button', { name: 'Закрыть', exact: true }).click();
    const composer = page.getByRole('textbox', { name: 'Сообщение', exact: true }); await composer.fill('Предложи рабочий сценарий рынка.'); await composer.press('Enter');
    await expect(page.getByText(/Предлагаю сценарий: 10000/).first()).toBeVisible();
    let dialog = await openCalculator();
    await expect(dialog.getByLabel('Расходы одного покупателя', { exact: true })).toHaveValue('8000');
    await expect(dialog.getByRole('region', { name: 'TAM', exact: true }).locator('.ds-calc-number')).toHaveText(/80\s000\s000\s*₽/);
    await expect(dialog.getByText('Из диалога · гипотеза', { exact: true })).toHaveCount(4);
    await dialog.screenshot({ path: testInfo.outputPath('calculation-overview.png') });
    const price = dialog.locator('.ds-calc-input').filter({ has: page.getByLabel('Расходы одного покупателя', { exact: true }) });
    await price.locator('summary').click(); await expect(price.getByLabel('Основание: расходы одного покупателя')).toHaveValue(/Гипотеза наставника: «Предлагаю сценарий/);
    await dialog.screenshot({ path: testInfo.outputPath('calculation-from-discussion.png') });
    await dialog.getByLabel('Расходы одного покупателя', { exact: true }).fill('-5'); await expect(dialog.getByText('Введите число от нуля. Например: 1250,5.', { exact: true })).toBeVisible();
    await dialog.getByLabel('Расходы одного покупателя', { exact: true }).fill('8500'); await expect(price.getByLabel('Основание: расходы одного покупателя')).toHaveValue('');
    await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
    await composer.fill('Уточни сценарий.'); await composer.press('Enter'); await expect(page.getByText(/Уточнённый сценарий: 10000/).first()).toBeVisible();
    await page.reload(); dialog = await openCalculator();
    await expect(dialog.getByLabel('Расходы одного покупателя', { exact: true })).toHaveValue('8500'); await expect(dialog.getByLabel('Достижимые покупатели', { exact: true })).toHaveValue('40');
    await expect(dialog.getByRole('region', { name: 'SOM', exact: true }).locator('.ds-calc-number')).toHaveText(/340\s000\s*₽/);
    expect(calls).toEqual(['cofounder_action', 'cofounder_reply', 'cofounder_action', 'cofounder_reply']);
    const overflow = await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1); expect(overflow).toBe(false);
  } finally { ledger.close(); }
});

test('calculation library fits all palettes and themes and preserves keyboard editing', async ({ page }, testInfo) => {
  await page.route('**/api/**', route => route.abort()); await page.goto('/design-system');
  await page.getByRole('button', { name: 'Показать сценарий из диалога', exact: true }).click();
  const workbench = page.locator('.ds-calculation-workbench');
  for (const theme of ['light', 'dark']) for (const [index, palette] of PALETTES.entries()) {
    const width = index % 2 ? 390 : 1440;
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.evaluate(({ theme, palette }) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.palette = palette; }, { theme, palette: palette.id });
    await workbench.scrollIntoViewIfNeeded(); await expect(workbench.getByLabel('Расходы одного покупателя', { exact: true })).toHaveValue('8000');
    expect(await workbench.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await workbench.screenshot({ path: testInfo.outputPath(`calculation-${theme}-${palette.id}-${width}.png`) });
  }
  const source = workbench.locator('.ds-calc-source').first(); await source.locator('summary').focus(); await page.keyboard.press('Enter'); await expect(source.getByRole('textbox')).toBeVisible();
  await page.keyboard.press('Tab'); await expect(source.getByRole('textbox')).toBeFocused();
});
