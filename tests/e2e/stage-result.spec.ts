import { test, expect, type Page } from '@playwright/test';
import { TOPIC_CRITERIA } from '../../shared/coverage';
import { PROCESS_CHECK_IDS } from '../../shared/review';
import { expandRoute } from './project-panel';
import type { ChatRequest } from '../../shared/types';

const draft = { title: 'Пожелания к графику', body: 'Управляющий ресторана собирает пожелания сотрудников. Сотрудники сами отмечают выходные; управляющий проверяет и утверждает. Без автоматического назначения смен. Эффект ещё не измеряли.' };

async function mock(page: Page, mode: 'complete' | 'partial' | 'remarks' | 'unavailable' = 'complete', withDraft = true) {
  const requests: ChatRequest[] = [];
  await page.route('**/api/**', route => {
    if (route.request().url().endsWith('/status')) return route.fulfill({ json: { configured: true, reason: '', model: 'mock-only', searchEnabled: false } });
    if (!route.request().url().endsWith('/chat')) return route.abort();
    const request = route.request().postDataJSON() as ChatRequest; requests.push(request);
    const criteria = TOPIC_CRITERIA[request.moduleId];
    return route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: {
      message: 'Вводные учтены.', choices: [{ id: 'more', label: 'Уточнить процесс', description: 'Обсудить дополнительные детали.' }],
      artifactDraft: withDraft ? draft : null, proposedFacts: [], memory: { facts: [{text:'Управляющий согласует пожелания.',evidence:request.message.slice(0,200)}], hypotheses: [], openQuestions: [],
        coverage: { rubricVersion: 1, moduleId: request.moduleId, nextCriterionId: mode === 'partial' ? criteria[0].id : null,
          items: criteria.map((criterion, index) => ({ id: criterion.id, status: mode === 'partial' && index === 0 ? 'partial' : 'covered', note: 'Синтетическое состояние интерфейса.', support: { role: 'user', quote: request.message.slice(0,200) } })) },
        review: { version: 1, status: mode === 'unavailable' ? 'unavailable' : 'completed', model: 'mock-only', subjectHash: 'a'.repeat(64), assessedAt: '2026-11-16T10:00:00Z',
          process: mode === 'unavailable' ? null : { status: 'passed', note: 'Учтён выбор пользователя.', checks: PROCESS_CHECK_IDS.map(id => ({ id, status: 'passed', reason: 'Проверка интерфейса.' })) },
          result: mode === 'unavailable' ? null : { status: mode === 'remarks' ? 'needs_work' : mode === 'partial' ? 'in_progress' : 'ready', note: mode === 'remarks' ? 'В тексте изменён выбранный объём решения.' : 'Рабочий контекст достаточен.' },
          nextAction: null, errorCode: mode === 'unavailable' ? 'EVALUATION_FAILED' : null },
      },
    } } });
  });
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Подключение AI', exact: true })).toHaveText(/^AI подключён/);
  return requests;
}
async function send(page: Page, text = 'Сотрудники сами отмечают выходные, управляющий согласует.') {
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill(text); await input.press('Enter');
  await expect(page.getByText('Вводные учтены.', { exact: true }).last()).toBeVisible();
}

for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 1280, 390]) test(`full coverage offers a short optional transition without a card at ${width}px ${colorScheme}`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 1440 ? 900 : width === 1280 ? 720 : 844 });
  await page.emulateMedia({ colorScheme });
  const requests = await mock(page); await send(page);
  const completion = page.locator('.ds-topic-completion');
  await expect(completion).toContainText('В целом я всё понял');
  await expect(completion).toContainText('теперь доступна');
  await expect(completion).toHaveCSS('font-size', '14px');
  await expect(page.getByRole('region', { name: 'Итог этапа · Идея' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Сохранить итог|^Сохранить и продолжить|^Уточнить процесс/ })).toHaveCount(0);
  await expect(page.getByText(draft.body, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0]);
  expect((await stored()).modules.idea.artifact).toBeNull();
  expect((await stored()).modules.idea.proposal.artifactDraft.body).toBe(draft.body);
  await page.reload(); await expect(completion).toBeVisible(); expect(requests).toHaveLength(1);
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill('Мой неотправленный вопрос');
  await completion.getByRole('button').focus();
  await page.screenshot({ path: `/tmp/cofounder-topic-completion/${width}-${colorScheme}.png` });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Целевая аудитория', exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: 'Начать этап', exact: true }).click();
  await expect(page.locator('.ds-topic-completion')).toBeVisible();
  expect(requests[1].context.artifacts).toContainEqual({ moduleId:'idea', ...draft, stale:false, provenance:'assistant_proposal' });
  await expandRoute(page);
  await expect(page.getByText('Пройдено 2 из 9',{exact:false})).toBeVisible();
  await expect(page.getByRole('button', { name: 'Конкуренты', exact: true })).toHaveAttribute('aria-disabled', 'false');
  await expect(page.getByRole('button', { name: 'Рынок', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('button', { name: 'Идея', exact: true }).click();
  await expect(input).toHaveValue('Мой неотправленный вопрос');
  await expandRoute(page); await page.getByRole('button', { name: 'Аудитория', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Целевая аудитория', exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
});

for (const mode of ['partial', 'remarks', 'unavailable'] as const) test(`${mode} does not unlock future topics or show a result card`, async ({ page }) => {
  await mock(page, mode); await send(page);
  await expect(page.locator('.ds-topic-completion')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Уточнить процесс/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить итог', exact: true })).toHaveCount(0);
  await expandRoute(page);
  await expect(page.getByRole('button', { name: 'Аудитория', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('button', { name: 'Аудитория', exact: true }).click({ force: true });
  await expect(page.getByRole('heading', { name: 'Идея проекта', exact: true })).toBeVisible();
});

test('full coverage needs no draft; an additional user message stays in the same topic', async ({ page }) => {
  const requests = await mock(page, 'complete', false); await send(page);
  await expect(page.locator('.ds-topic-completion')).toBeVisible();
  await send(page, 'Есть ещё важное условие: без автоматического назначения смен.');
  expect(requests).toHaveLength(2);
  expect(requests[1].moduleId).toBe('idea');
  await expect(page.getByRole('heading', { name: 'Идея проекта', exact: true })).toBeVisible();
  await expect(page.locator('.ds-topic-completion')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Подготовить итог|^Сохранить/ })).toHaveCount(0);
});

test('locked topics cannot be opened by a text navigation command before 100 percent', async ({ page }) => {
  const requests = await mock(page);
  const input = page.getByRole('textbox', {name:'Сообщение',exact:true});
  await input.fill('Открой целевую аудиторию'); await input.press('Enter');
  await expect(page.getByRole('alert', { name: 'Не удалось завершить действие' })).toContainText('Сначала проработайте: Идея');
  expect(requests).toHaveLength(0);
  await expect(page.getByRole('heading', { name: 'Идея проекта', exact: true })).toBeVisible();
});


test('an explicit presentation uses internal context without bringing a card back to the chat', async ({page}) => {
  const requests=await mock(page);await send(page);
  await page.getByRole('button',{name:'Презентация',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Презентация и MVP',exact:true})).toBeVisible();
  await expect(page.locator('.material-paper').getByText(draft.body,{exact:true})).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.getByRole('button',{name:'Мастерская',exact:true}).click();
  await expect(page.locator('.ds-topic-completion')).toBeVisible();
  await expect(page.getByRole('region',{name:'Итог этапа · Идея'})).toHaveCount(0);
});
