import { test, expect, type Page } from '@playwright/test';
import { createProject } from '../../shared/domain';
import type { ChatRequest, Choice } from '../../shared/types';

const choices: Choice[] = [
  { id: 'self', label: 'Я сам(а)', description: 'Идея выросла из моей личной потребности.' },
  { id: 'buyers', label: 'Потенциальные покупатели', description: 'Я хочу предложить пиццу другим людям.', recommended: true },
  { id: 'companies', label: 'Компании или мероприятия', description: 'Пицца нужна командам, гостям или участникам событий.' },
  { id: 'unknown', label: 'Пока не знаю', description: 'Можно разобрать пример ситуации или пропустить вопрос.' },
];

async function seed(page: Page, options = choices) {
  const project = createProject();
  project.modules.idea.messages = [{ id: 'question', role: 'assistant', createdAt: new Date().toISOString(),
    content: options.length ? 'Кому и в какой ситуации нужна пицца в вашем замысле?' : 'Расскажите, в какой ситуации у вас появилась эта идея.', choices: options }];
  await page.addInitScript(raw => {
    if (!localStorage.getItem('cofounder.workspace.v1')) localStorage.setItem('cofounder.workspace.v1', raw);
  }, JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] }));
  await page.route('**/api/**', route => route.request().url().endsWith('/status')
    ? route.fulfill({ json: { configured: true, reason: '', model: 'mock-only', searchEnabled: false } }) : route.abort());
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
}

for (const colorScheme of ['light', 'dark'] as const) for (const width of [1920, 1440, 1280, 768, 390, 320]) {
  test(`answer choices form one vertical list at ${width}px in ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 });
    await page.emulateMedia({ colorScheme });
    await seed(page);
    const group = page.getByRole('group', { name: 'Варианты ответа', exact: true });
    const buttons = group.getByRole('button');
    await expect(buttons).toHaveCount(4);
    await expect(group.getByText('Рекомендую', { exact: true })).toHaveCount(1);
    await expect(buttons.nth(1)).toContainText('Рекомендую');
    expect((await group.boundingBox())!.width).toBe((await page.locator('.workspace-message.assistant').boundingBox())!.width);
    await expect(page.getByRole('button', { name: 'Свой вариант', exact: true })).toHaveCount(0);
    const rows = await buttons.evaluateAll(elements => elements.map(element => {
      const button = element.getBoundingClientRect();
      const title = element.querySelector('strong')!.getBoundingClientRect();
      const description = element.querySelector('small')!.getBoundingClientRect();
      return { x: button.x, y: button.y, width: button.width, height: button.height, titleBottom: title.bottom, descriptionTop: description.top, descriptionHeight: description.height };
    }));
    rows.forEach((row, i) => {
      expect(row.width).toBe(rows[0].width);
      expect(row.x).toBe(rows[0].x);
      expect(row.height).toBeGreaterThanOrEqual(48);
      expect(row.descriptionTop).toBeGreaterThan(row.titleBottom);
      if (width >= 900) expect(row.descriptionHeight).toBe(18);
      if (i) expect(row.y).toBeGreaterThanOrEqual(rows[i - 1].y + rows[i - 1].height);
    });
    expect(await group.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await test.info().attach('answer-choices', { body: await page.screenshot(), contentType: 'image/png' });
  });
}

test('keyboard choice sends once; the next open question accepts free text without extra controls', async ({ page }) => {
  await seed(page);
  const requests: ChatRequest[] = [];
  let release!: () => void;
  await page.route('**/api/chat', async route => {
    const request = route.request().postDataJSON() as ChatRequest;
    requests.push(request);
    if (requests.length === 1) await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: {
      message: requests.length === 1 ? 'Какой личный опыт привёл вас к этой идее?' : 'Учтём ваш опыт.',
      choices: [], artifactDraft: null, proposedFacts: [],
    } } });
  });
  const first = page.getByRole('button', { name: 'Я сам(а) Идея выросла из моей личной потребности.', exact: true });
  await first.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /^Потенциальные покупатели/ })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await expect(input).toBeFocused();
  await expect.poll(() => requests.length).toBe(1);
  await page.keyboard.press('Enter');
  expect(requests).toHaveLength(1);
  await expect(page.getByRole('group', { name: 'Варианты ответа' })).toHaveCount(0);
  release();
  await expect(page.getByText('Какой личный опыт привёл вас к этой идее?', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('');
  await input.fill('Мне негде заказать пиццу вечером рядом с домом.');
  await input.press('Enter');
  await expect(page.getByText('Учтём ваш опыт.', { exact: true })).toBeVisible();
  expect(requests.map(request => request.message)).toEqual(['Я сам(а)', 'Мне негде заказать пиццу вечером рядом с домом.']);
  await page.reload();
  await expect(page.getByRole('group', { name: 'Варианты ответа' })).toHaveCount(0);
});

test('choosing the recommended option sends only its label and consumes it after reload', async ({ page }) => {
  await seed(page);
  const requests: ChatRequest[] = [];
  await page.route('**/api/chat', async route => {
    const request = route.request().postDataJSON() as ChatRequest;
    requests.push(request);
    await route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: {
      message: 'Проверим потребности покупателей.', choices: [], artifactDraft: null, proposedFacts: [],
    } } });
  });
  const recommended = page.getByRole('group', { name: 'Варианты ответа' }).getByRole('button').nth(1);
  await expect(recommended).toContainText('Рекомендую');
  await recommended.press('Enter');
  await expect(page.getByText('Проверим потребности покупателей.', { exact: true })).toBeVisible();
  expect(requests.map(request => request.message)).toEqual(['Потенциальные покупатели']);
  await page.reload();
  await expect(page.getByRole('group', { name: 'Варианты ответа' })).toHaveCount(0);
  await expect(page.getByText('Потенциальные покупатели', { exact: true })).toBeVisible();
});

test('a written answer bypasses the options and consumes only the current question', async ({ page }) => {
  await seed(page);
  const requests: ChatRequest[] = [];
  await page.route('**/api/chat', async route => {
    const request = route.request().postDataJSON() as ChatRequest;
    requests.push(request);
    await route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: {
      message: 'Как будете доставлять заказы?', choices: [{ id: 'pickup', label: 'Самовывоз', description: '' }],
      artifactDraft: null, proposedFacts: [],
    } } });
  });
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill('Хочу готовить для соседей по выходным.');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Самовывоз', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Варианты ответа' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Я сам/ })).toHaveCount(0);
  expect(requests.map(request => request.message)).toEqual(['Хочу готовить для соседей по выходным.']);
});
