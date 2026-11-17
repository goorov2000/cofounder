import { expect, it } from 'vitest';
import { applyMemoryPatch, archiveMessage, buildCoreContext, getCurrentEntries } from '../../shared/coreMemory';
import { createProject, restartChat } from '../../shared/domain';
import { calculateEconomics, calculateMarket } from '../../shared/calculations';
import type { AtomicValue, MemoryPatch, ModuleId, Project } from '../../shared/types';

function turn(project: Project, moduleId: ModuleId, messageId: string, text: string) {
  const next = archiveMessage(project, moduleId, { id: messageId, role: 'user', content: text, createdAt: project.createdAt });
  const context = buildCoreContext(next, moduleId, messageId);
  const patch: MemoryPatch = { schemaVersion: 1, projectId: project.id, moduleId, generation: context.generation, requestId: `request-${messageId}`, baseMemoryVersion: context.revision, baseContextVersion: context.contextVersion, sourceMessage: context.sourceMessage, operations: [] };
  const value: AtomicValue = { kind: 'decision', key: 'price', scope: { subject: 'our_project', entityId: null, area: 'project', stageId: null, scenario: null }, text, origin: 'user', epistemic: 'hypothesis', acceptance: 'accepted', sources: [{ type: 'message', projectId: project.id, moduleId, generation: context.generation, ...context.sourceMessage, quote: text }], dependsOn: [] };
  return { project: next, patch, value };
}

it('rejects a promotion that would leave two accepted prices in one scope without partially committing its other operation', () => {
  const first = turn(createProject(), 'idea', 'price-initial', 'Цена 5000');
  first.patch.operations = [{ op: 'create', localId: 'initial', value: first.value }];
  const proposed = turn(applyMemoryPatch(first.project, first.patch), 'idea', 'price-option', 'Вариант цены 7000');
  proposed.patch.operations = [{ op: 'create', localId: 'option', value: { ...proposed.value, acceptance: 'proposed' } }];
  const project = applyMemoryPatch(proposed.project, proposed.patch);
  const option = getCurrentEntries(project.core!).find(entry => entry.acceptance === 'proposed')!;
  const promotion = turn(project, 'idea', 'price-acceptance', 'Принимаю цену 7000');
  promotion.patch.operations = [
    { op: 'create', localId: 'independent', value: { ...promotion.value, key: 'acknowledgement' } },
    { op: 'revise', id: option.id, expectedVersion: option.version, value: promotion.value },
  ];
  const before = structuredClone(promotion.project);
  expect(() => applyMemoryPatch(promotion.project, promotion.patch)).toThrow(/принят|решени|конфликт/i);
  expect(promotion.project).toEqual(before);
  expect(getCurrentEntries(promotion.project.core!).filter(entry => entry.key === 'price' && entry.acceptance === 'accepted')).toHaveLength(1);
});

it('preserves an independently sourced current decision and its exact history when an older source conversation is reset', () => {
  const first = turn(createProject(), 'idea', 'old-idea-price', 'Цена 5000');
  first.patch.operations = [{ op: 'create', localId: 'price', value: first.value }];
  const initial = applyMemoryPatch(first.project, first.patch);
  const previous = getCurrentEntries(initial.core!)[0];
  const confirmation = turn(initial, 'audience', 'independent-confirmation', 'Независимо подтверждаю нашу цену 3500');
  confirmation.patch.operations = [{ op: 'revise', id: previous.id, expectedVersion: previous.version, value: confirmation.value }];
  const confirmed = applyMemoryPatch(confirmation.project, confirmation.patch);
  const next = restartChat(confirmed, 'idea');
  expect(getCurrentEntries(next.core!)).toEqual([expect.objectContaining({ id: previous.id, version: 2, acceptance: 'accepted', text: confirmation.value.text })]);
  expect(next.core!.entries).toEqual(confirmed.core!.entries);
  expect(next.core!.sourceMessages).toEqual(confirmed.core!.sourceMessages);
  const fresh = turn(next, 'idea', 'fresh-reset-question', 'Начинаем новый разговор');
  const freshContext = buildCoreContext(fresh.project, 'idea', 'fresh-reset-question');
  expect(freshContext.currentEntryRefs).not.toContainEqual({ id: previous.id, version: 2 });
  expect(freshContext.sourceMessages.some(source => source.messageId === 'old-idea-price')).toBe(false);
});

it.each(['mvp', 'legal', 'basics'] as const)('marks legacy price-dependent calculations and saved text stale when the project price is corrected from %s', moduleId => {
  const first = turn(createProject(), 'idea', 'price-for-calculation', 'Наша цена 5000 рублей в месяц');
  first.patch.operations = [{ op: 'create', localId: 'price', value: first.value }];
  const project = applyMemoryPatch(first.project, first.patch);
  const price = getCurrentEntries(project.core!)[0];
  project.calculations.market = calculateMarket({ totalBuyers: 100, reachableBuyers: 50, targetBuyers: 10, price: 5000, period: 'месяц' });
  project.calculations.economics = calculateEconomics({ customers: 10, price: 5000, period: 'месяц' });
  for (const id of ['market', 'economics'] as const) project.modules[id].artifact = { title: id, body: 'Сохранённый расчёт по цене 5000 рублей в месяц', revision: 1, savedAt: project.createdAt, stale: false };
  const previousCalculations = structuredClone(project.calculations);
  const correction = turn(project, moduleId, `price-correction-${moduleId}`, 'Меняем нашу цену на 3500 рублей в месяц');
  correction.patch.operations = [{ op: 'revise', id: price.id, expectedVersion: price.version, value: correction.value }];
  const next = applyMemoryPatch(correction.project, correction.patch);
  for (const id of ['market', 'economics'] as const) {
    expect(next.calculations[id]).toEqual({ ...previousCalculations[id] as object, stale: true, staleReason: expect.stringMatching(/вводн|цен|решени/i) });
    expect(next.modules[id].artifact).toMatchObject({ body: 'Сохранённый расчёт по цене 5000 рублей в месяц', stale: true, staleReason: expect.any(String) });
  }
  expect(project.calculations).toEqual(previousCalculations);
});
