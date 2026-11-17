import { expect, test } from 'vitest';
import { buildPrompt } from '../../server/prompt.js';
import type { AtomicEntry, ChatRequest, ResearchBundle } from '../../shared/types.js';
const scope = { subject: 'our_project', entityId: null, area: 'project', stageId: null, scenario: null } as const;
const old: AtomicEntry = { id: 'price', version: 1, previousVersion: null, createdAt: '2026-11-15T08:00:00Z', requestId: 'previous', kind: 'decision', key: 'price', scope, text: '5000 рублей за точку в месяц', origin: 'user', epistemic: 'hypothesis', acceptance: 'accepted', sources: [{ type: 'message', projectId: 'p', moduleId: 'business', generation: 0, messageId: 'first', revision: 1, quote: 'Примем 5000 рублей за точку в месяц.' }], dependsOn: [] };
const current: AtomicEntry = { ...old, version: 2, previousVersion: 1, text: '3500 рублей за точку в месяц', sources: [{ type: 'message', projectId: 'p', moduleId: 'business', generation: 0, messageId: 'second', revision: 1, quote: 'Исправляю цену: 3500 рублей за точку в месяц.' }] };
const request: ChatRequest = { requestId: 'current', projectId: 'p', moduleId: 'idea', contractVersion: 2, intent: 'message', message: 'Какая была первая цена?', context: { name: 'Проект', description: '', facts: [{ key: 'price', value: '5000', provenance: 'user', note: 'Старое поле' }], artifacts: [], history: [] }, coreContext: { schemaVersion: 1, projectId: 'p', moduleId: 'idea', generation: 0, revision: 2, contextVersion: 2, sourceMessage: { messageId: 'now', revision: 1 }, entries: [old, current], currentEntryRefs: [{ id: 'price', version: 2 }], sourceMessages: [
  { projectId: 'p', moduleId: 'business', generation: 0, messageId: 'first', revision: 1, role: 'user', content: 'Примем 5000 рублей за точку в месяц.', createdAt: '2026-11-15T08:00:00Z' },
  { projectId: 'p', moduleId: 'business', generation: 0, messageId: 'second', revision: 1, role: 'user', content: 'Исправляю цену: 3500 рублей за точку в месяц.', createdAt: '2026-11-15T09:00:00Z' },
  { projectId: 'p', moduleId: 'idea', generation: 0, messageId: 'now', revision: 1, role: 'user', content: 'Какая была первая цена?', createdAt: '2026-11-15T10:00:00Z' },
], evidence: [] } };

test('the prompt separates current and historical versions while retaining exact source revisions', () => {
  const prompt = buildPrompt(request);
  const input = JSON.parse(prompt.input);
  expect(input.coreContext.currentEntries).toEqual([current]);
  expect(input.coreContext.historicalEntries).toEqual([old]);
  expect(input.coreContext.sourceMessages).toEqual(request.coreContext!.sourceMessages);
  expect(input.coreContext.currentEntryRefs).toEqual([{ id: 'price', version: 2 }]);
  expect(input.context).toEqual(request.context);
});

test('tool evidence and permanent methodology reach generation independently of the user message', () => {
  const research: ResearchBundle = { status: 'partial', limitations: ['У второго источника не удалось открыть тариф.'], evidence: [{ id: 'evidence-a', version: 1, projectId: 'p', moduleId: 'idea', generation: 0, requestId: 'current', operationId: 'read-1', url: 'https://example.org/prices', title: 'Тариф', retrievedAt: '2026-11-15T10:00:00Z', publishedAt: null, effectiveAt: null, retrieval: 'read', contentHash: 'hash', quotes: [{ id: 'quote-a', text: '1200 RUB за объект в месяц при оплате за год.', start: 0, end: 48 }], limitations: [] }] };
  const prompt = buildPrompt({ ...request, message: 'Спасибо!' }, research);
  const input = JSON.parse(prompt.input);
  expect(input.research).toEqual(research);
  expect(input.knowledge.map((item: { id: string }) => item.id)).toEqual(['M30']);
  expect(prompt.instructions).toContain('Не завершать каждую реплику обязательным вопросом');
  expect(prompt.instructions).toContain('memoryOperations');
  expect(prompt.instructions).toContain('externalClaims');
  expect(prompt.instructions).not.toContain('инструменты и доступ в интернет отсутствуют');
  const offline = buildPrompt(request);
  expect(JSON.parse(offline.input).research.status).toBe('not_needed');
  expect(offline.instructions).toContain('не выполнялся');
  const failed = buildPrompt(request, { status: 'failed', evidence: [], limitations: ['Сеть недоступна'] });
  expect(failed.instructions).toContain('не удалось');
  expect(JSON.parse(failed.input).research.limitations).toEqual(['Сеть недоступна']);
});
