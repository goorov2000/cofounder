import { expect, it } from 'vitest';
import { createProject } from '../../shared/domain';
import { parseWorkspace } from '../../shared/validation';

it('migrates legacy facts without inventing message sources or acceptance', () => {
  const project = createProject();
  delete (project as { core?: unknown }).core;
  project.facts.price = { key: 'price', value: '5000 ₽/точка/месяц', provenance: 'hypothesis', note: 'Учебная цена' };
  project.modules.idea.messages = [{ id: 'old-user', role: 'user', content: 'Есть идея', createdAt: project.createdAt }];
  project.modules.idea.draft = 'Не терять черновик';
  const migrated = parseWorkspace(JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] })).projects[0];
  expect(migrated).toHaveProperty('core.entries', [expect.objectContaining({
    key: 'price', origin: 'legacy', epistemic: 'hypothesis', acceptance: 'unresolved',
    sources: [{ type: 'legacy', label: 'Унаследованное решение: price (hypothesis)', quote: '5000 ₽/точка/месяц' }],
  })]);
  expect(migrated).toHaveProperty('core.sourceMessages.0.messageId', 'old-user');
  expect(migrated.modules.idea.draft).toBe('Не терять черновик');
});

import { archiveMessage, buildCoreContext, ensureCore, getCurrentEntries } from '../../shared/coreMemory';
import { applyAnswer } from '../../src/features/workspace/answerRequests';
import type { AtomicValue, ChatRequest, MemoryPatch, Project } from '../../shared/types';

function pending(project: Project, text: string, id = 'source-001') {
  const message = { id, role: 'user' as const, content: text, createdAt: project.createdAt, revision: 1, requestId: `request-${id}`, status: 'pending' as const };
  const archived = archiveMessage(project, 'idea', message);
  archived.modules.idea.messages.push(message);
  const coreContext = buildCoreContext(archived, 'idea', id);
  const request: ChatRequest = { contractVersion: 2, coreContext, requestId: message.requestId, projectId: project.id, moduleId: 'idea', intent: 'message', message: text, context: { name: project.name, description: '', facts: [], artifacts: [], history: [] } };
  return { project: archived, request };
}
function value(request: ChatRequest, key = 'price'): AtomicValue {
  return { key, kind: 'decision', text: request.message, origin: 'user', epistemic: 'hypothesis', acceptance: 'accepted', scope: { subject: 'our_project', entityId: null, area: 'project', stageId: null, scenario: null }, dependsOn: [],
    sources: [{ type: 'message', projectId: request.projectId, moduleId: request.moduleId, generation: request.coreContext!.generation, ...request.coreContext!.sourceMessage, quote: request.message }] };
}
function patch(request: ChatRequest): MemoryPatch {
  const core = request.coreContext!;
  return { schemaVersion: 1, projectId: request.projectId, moduleId: request.moduleId, generation: core.generation, requestId: request.requestId, baseMemoryVersion: core.revision, baseContextVersion: core.contextVersion, sourceMessage: core.sourceMessage, operations: [{ op: 'create', localId: 'price', value: value(request) }] };
}
const answer = { message: 'Принята гипотеза, требующая проверки.', choices: [], artifactDraft: null, proposedFacts: [] };
it('applies the complete reply and versioned hypothesis once through the actual answer seam', () => {
  const { project, request } = pending(ensureCore(createProject()), 'Принимаем гипотезу: 5000 ₽/точка/месяц');
  const reply = { ...answer, memoryPatch: patch(request) };
  const next = applyAnswer(project, request, reply);
  expect(getCurrentEntries(next.core!)).toEqual([expect.objectContaining({ text: request.message, version: 1, acceptance: 'accepted', epistemic: 'hypothesis' })]);
  expect(next.modules.idea.messages.at(-1)?.content).toBe(answer.message);
  expect(applyAnswer(next, request, reply)).toBe(next);
  expect(project.core!.entries).toHaveLength(0);
});

import { restartChat, saveArtifact } from '../../shared/domain';
import { applyMemoryPatch } from '../../shared/coreMemory';
it('records artifact dependencies, preserves scopes and drops only the restarted conversation lineage', () => {
  const setup = pending(createProject(), 'Гипотеза цены 5000 рублей', 'price-first');
  let project = applyAnswer(setup.project, setup.request, { ...answer, memoryPatch: patch(setup.request) });
  const price = getCurrentEntries(project.core!)[0];
  project = saveArtifact(project, 'market', { title: 'Расчёт рынка', body: 'Цена 5000 рублей' });
  expect(project.modules.market.artifact?.basedOn?.atoms).toContainEqual({ id: price.id, version: 1 });
  const second = pending(project, 'Меняем нашу цену на 3500 рублей', 'price-second');
  const update = patch(second.request);
  update.operations = [{ op: 'revise', id: price.id, expectedVersion: 1, value: value(second.request) }];
  project = applyMemoryPatch(second.project, update);
  expect(getCurrentEntries(project.core!)[0]).toMatchObject({ id: price.id, version: 2 });
  expect(project.core!.entries).toHaveLength(2);
  expect(project.modules.market.artifact).toMatchObject({ body: 'Цена 5000 рублей', stale: true });
  project = restartChat(project, 'idea');
  expect(project.modules.idea.generation).toBe(1);
  expect(getCurrentEntries(project.core!)).toHaveLength(0);
  expect(project.core!.sourceMessages).toHaveLength(0);
});

it('rejects an otherwise valid patch envelope for a different conversation before any reply or memory is committed', () => {
  const setup = pending(createProject(), 'Выбираем цену 5000', 'source-envelope');
  const other = archiveMessage(setup.project, 'audience', { id: 'other-source', role: 'user', content: setup.request.message, createdAt: setup.project.createdAt });
  setup.request.coreContext = buildCoreContext(other, 'idea', 'source-envelope');
  const forged = patch(setup.request); forged.moduleId = 'audience'; forged.sourceMessage = { messageId: 'other-source', revision: 1 };
  forged.operations[0].value.sources = [{ type: 'message', projectId: other.id, moduleId: 'audience', generation: 0, messageId: 'other-source', revision: 1, quote: setup.request.message }];
  // Reuse the same source id across modules to exercise full envelope identity.
  other.core!.sourceMessages.find(item => item.moduleId === 'audience')!.messageId = 'source-envelope';
  forged.sourceMessage.messageId = 'source-envelope';
  const source = forged.operations[0].value.sources[0]; if (source.type === 'message') source.messageId = 'source-envelope';
  expect(() => applyAnswer(other, setup.request, { ...answer, memoryPatch: forged })).toThrow(/изменились|проект|памят/i);
  expect(other.core!.entries).toHaveLength(0);
  expect(other.modules.idea.messages).toHaveLength(1);
});

it('archives a successful edit revision without replacing a later accepted decision or silently retaining old derived memory', () => {
  let first = pending(createProject(), 'Начальная цена 5000', 'edit-original');
  let project = applyAnswer(first.project, first.request, { ...answer, memoryPatch: patch(first.request) });
  const oldAnswer = project.modules.idea.messages.at(-1)!;
  const second = pending(project, 'Теперь принимаем 3500', 'edit-newer');
  const correction = patch(second.request);
  const price = getCurrentEntries(project.core!)[0];
  correction.operations = [{ op: 'revise', id: price.id, expectedVersion: 1, value: value(second.request) }];
  project = applyAnswer(second.project, second.request, { ...answer, memoryPatch: correction });
  const request: ChatRequest = { ...first.request, requestId: 'edit-request-fresh', message: 'Изначально обсуждали 4000', coreContext: buildCoreContext(project, 'idea', 'edit-original') };
  request.coreContext!.sourceMessage.revision = 2;
  request.coreContext!.sourceMessages = [...request.coreContext!.sourceMessages, { ...request.coreContext!.sourceMessages[0], revision: 2, content: request.message }];
  const update = patch(request); update.operations = [];
  const next = applyAnswer(project, request, { ...answer, memoryPatch: update }, oldAnswer.id, 'edit-original');
  expect(next.core!.sourceMessages.filter(source => source.messageId === 'edit-original').map(source => [source.revision, source.content])).toEqual([[1, 'Начальная цена 5000'], [2, 'Изначально обсуждали 4000']]);
  expect(getCurrentEntries(next.core!)[0]).toMatchObject({ text: 'Теперь принимаем 3500', acceptance: 'accepted', version: 2 });
  expect(next.modules.idea.messages[0].revision).toBe(2);
});

it('preserves more than six requirements and both recipients after forty-five turns and an actual short summary refresh', () => {
  const setup = pending(createProject(), 'Уведомлять директора и администратора; без SMS; email; отчёт ежедневно; оплата помесячно; Россия; пилот Самара', 'requirements-first');
  const memory = patch(setup.request);
  memory.operations = ['директора', 'администратора', 'без SMS', 'email', 'ежедневно', 'помесячно', 'Россия', 'Самара'].map((text, index) => ({ op: 'create' as const, localId: `requirement-${index}`, value: { ...value(setup.request, `requirement-${index}`), kind: 'requirement', text } }));
  let project = applyAnswer(setup.project, setup.request, { ...answer, memoryPatch: memory });
  for (let index = 0; index < 45; index++) {
    const turn = { id: `later-${index}`, role: 'user' as const, content: `Дополнение ${index}`, createdAt: project.createdAt };
    project = archiveMessage(project, 'idea', turn); project.modules.idea.messages.push(turn);
  }
  const registryBefore = structuredClone(getCurrentEntries(project.core!));
  const refreshed = pending(project, 'Обнови краткое резюме поздних дополнений', 'summary-refresh-after-45');
  const emptyPatch = patch(refreshed.request); emptyPatch.operations = [];
  const shortSummary = { facts: [], hypotheses: [], openQuestions: ['Какая следующая деталь требует проверки?'] };
  project = applyAnswer(refreshed.project, refreshed.request, { ...answer, memory: shortSummary, memoryPatch: emptyPatch });
  expect(project.modules.idea.memory?.content).toEqual(shortSummary);
  expect(project.modules.idea.memory?.needsRefresh).not.toBe(true);
  expect(getCurrentEntries(project.core!)).toEqual(registryBefore);
  expect(project.modules.idea.messages).toHaveLength(49);
  const context = buildCoreContext(project, 'idea', 'summary-refresh-after-45');
  expect(context.entries).toHaveLength(8);
  expect(context.currentEntryRefs).toHaveLength(8);
  expect(context.entries.map(entry => entry.text)).toEqual(expect.arrayContaining(['директора', 'администратора']));
  expect(context.sourceMessages.find(source => source.messageId === 'requirements-first')?.content).toBe(setup.request.message);
});

it('rejects patches all-or-nothing for bad quotes, role, foreign ownership, revisions, duplicate operations and stale bases', () => {
  const setup = pending(createProject(), 'Принимаем 5000 рублей', 'invalid-source');
  const before = JSON.stringify(setup.project);
  const cases: MemoryPatch[] = [];
  for (const edit of [
    (p: MemoryPatch) => { p.baseMemoryVersion++; },
    (p: MemoryPatch) => { p.operations.push(structuredClone(p.operations[0])); },
    (p: MemoryPatch) => { const source = p.operations[0].value.sources[0]; if (source.type === 'message') source.quote = 'Никто этого не говорил'; },
    (p: MemoryPatch) => { const source = p.operations[0].value.sources[0]; if (source.type === 'message') source.projectId = 'another-project'; },
    (p: MemoryPatch) => { const source = p.operations[0].value.sources[0]; if (source.type === 'message') source.revision = 99; },
    (p: MemoryPatch) => { p.operations[0].value.epistemic = 'observed'; },
  ]) { const update = patch(setup.request); edit(update); cases.push(update); }
  for (const update of cases) { expect(() => applyMemoryPatch(setup.project, update)).toThrow(); expect(JSON.stringify(setup.project)).toBe(before); }
  const assistantProject = structuredClone(setup.project);
  assistantProject.core!.sourceMessages[0].role = 'assistant';
  expect(() => applyMemoryPatch(assistantProject, patch(setup.request))).toThrow();
});

it('keeps variants and pilot scopes separate from accepted price, nationwide scope and another company tariff', () => {
  const setup = pending(createProject(), 'Цена 5000; Россия; пилот Самара; чужой тариф 7000; а если 10000, просто вариант', 'scope-source');
  const update = patch(setup.request);
  const base = value(setup.request);
  // Conditional text cannot itself accept decisions; seed existing decisions from their exact declarative clauses.
  const withQuote = (text: string, key: string): AtomicValue => ({ ...base, text, key, sources: [{ ...base.sources[0] as Extract<typeof base.sources[0], { type: 'message' }>, quote: text }] });
  update.operations = [
    { op: 'create', localId: 'price', value: withQuote('Цена 5000', 'price') },
    { op: 'create', localId: 'country', value: withQuote('Россия', 'geography') },
    { op: 'create', localId: 'pilot', value: { ...withQuote('пилот Самара', 'geography'), scope: { ...base.scope, area: 'scenario', scenario: 'pilot' } } },
    { op: 'create', localId: 'external', value: { ...withQuote('чужой тариф 7000', 'price'), scope: { ...base.scope, subject: 'external_entity', entityId: 'another-company' } } },
    { op: 'create', localId: 'variant', value: { ...withQuote('а если 10000, просто вариант', 'price'), acceptance: 'proposed', scope: { ...base.scope, area: 'scenario', scenario: 'alternative' } } },
  ];
  const project = applyMemoryPatch(setup.project, update), entries = getCurrentEntries(project.core!);
  expect(entries.filter(entry => entry.acceptance === 'accepted' && entry.key === 'price' && entry.scope.subject === 'our_project')).toHaveLength(1);
  expect(entries.filter(entry => entry.key === 'geography').map(entry => entry.text)).toEqual(['Россия', 'пилот Самара']);
  expect(entries.find(entry => entry.text.includes('10000'))?.acceptance).toBe('proposed');
  expect(entries.find(entry => entry.scope.subject === 'external_entity')?.text).toBe('чужой тариф 7000');
});

it('keeps legacy request parsing hash-stable and validates new core requests on both boundaries', async () => {
  const { requestSchema: client } = await import('../../shared/validation');
  const { requestSchema: server, validateReply } = await import('../../server/validation');
  const setup = pending(createProject(), 'Цена 5000', 'schema-source');
  const legacy = { ...setup.request }; delete legacy.coreContext; delete legacy.contractVersion;
  expect(JSON.stringify(server.parse(legacy))).toBe(JSON.stringify(legacy));
  expect(client.safeParse(setup.request).success).toBe(true);
  expect(server.safeParse(setup.request).success).toBe(true);
  expect(validateReply({ ...answer, memoryPatch: patch(setup.request) }, setup.request).memoryPatch).toEqual(patch(setup.request));
  const foreign = structuredClone(setup.request); foreign.coreContext!.sourceMessages[0].projectId = 'other-project';
  expect(client.safeParse(foreign).success).toBe(false);
  expect(server.safeParse(foreign).success).toBe(false);
});

it('keeps other conversations stored after reset but excludes their old source context from the new idea', () => {
  let project = archiveMessage(createProject(), 'audience', { id: 'old-audience', role: 'user', content: 'Старая ресторанная задумка', createdAt: '2026-01-01T00:00:00Z' });
  project = restartChat(project, 'idea');
  project = archiveMessage(project, 'idea', { id: 'fresh-idea', role: 'user', content: 'Теперь ремонт велосипедов', createdAt: new Date().toISOString() });
  expect(project.core!.sourceMessages.some(source => source.messageId === 'old-audience')).toBe(true);
  expect(buildCoreContext(project, 'idea', 'fresh-idea').sourceMessages.some(source => source.messageId === 'old-audience')).toBe(false);
});
