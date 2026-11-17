import { test, expect } from '@playwright/test';
import type { ChatRequest, MemoryPatch } from '../../shared/types';

test('normal chat commits an injected valid atomic patch, keeps a new draft and restores exact sources after reload', async ({ page }) => {
  let request: ChatRequest | undefined;
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/status', route => route.fulfill({ json: { configured: true, reason: '', model: 'mock-only', searchEnabled: false } }));
  await page.route('**/api/chat', async route => {
    request = route.request().postDataJSON() as ChatRequest;
    await waiting;
    const context = request.coreContext;
    const memoryPatch: MemoryPatch | undefined = context ? { schemaVersion: 1, requestId: request.requestId, projectId: request.projectId, moduleId: request.moduleId, generation: context.generation, baseMemoryVersion: context.revision, baseContextVersion: context.contextVersion, sourceMessage: context.sourceMessage, operations: [{ op: 'create', localId: 'price', value: { kind: 'decision', key: 'price', text: request.message, origin: 'user', epistemic: 'hypothesis', acceptance: 'accepted', scope: { subject: 'our_project', entityId: null, area: 'project', stageId: null, scenario: null }, sources: [{ type: 'message', projectId: request.projectId, moduleId: request.moduleId, generation: context.generation, ...context.sourceMessage, quote: request.message }], dependsOn: [] } }] } : undefined;
    await route.fulfill({ json: { requestId: request.requestId, model: 'mock-only', reply: { message: 'Гипотеза сохранена для дальнейшей проверки.', choices: [], artifactDraft: null, proposedFacts: [], memoryPatch } } });
  });
  await page.goto('/design-system');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'AI подключён' })).toBeAttached();
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill('Принимаем гипотезу цены 5000 рублей в месяц');
  await input.press('Enter');
  await expect.poll(() => request?.message).toContain('5000');
  await expect(input).toHaveValue('');
  await input.fill('Следующее условие');
  finish();
  await expect(page.locator('.workspace-message.assistant').last()).toContainText('Гипотеза сохранена');
  expect(request?.contractVersion).toBe(2);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0].core?.entries.length)).toBe(1);
  await expect(input).toHaveValue('Следующее условие');
  await page.reload();
  const core = await page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0].core);
  expect(core.entries[0]).toMatchObject({ acceptance: 'accepted', epistemic: 'hypothesis' });
  expect(core.sourceMessages[0]).toMatchObject({ role: 'user', revision: 1, content: request!.message });
  await expect(input).toHaveValue('Следующее условие');
});
