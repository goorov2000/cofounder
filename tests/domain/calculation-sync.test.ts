import { expect, it } from 'vitest';
import { createProject, restartChat, saveArtifact } from '../../shared/domain';
import { applyAnswer } from '../../src/features/workspace/answerRequests';
import { coverageBasis, TOPIC_CRITERIA } from '../../shared/coverage';
import { parseWorkspace, serializeWorkspace } from '../../shared/validation';
import { calculationReport, groundCalculationScenario, syncCalculation, type CalculationScenario, type StoredCalculation } from '../../shared/calculationScenario';
import type { AssistantReply, ChatRequest } from '../../shared/types';

const text = 'Сценарий: 10 000 потенциальных покупателей, 2000 доступных и 60 достижимых. Расходы покупателя 8000 ₽ за год.';
const scenario: CalculationScenario = { entries: Object.entries({ totalBuyers: '10000', reachableBuyers: '2000', targetBuyers: '60', price: '8000', period: 'год', pricePeriod: 'год', currency: '₽' }).map(([field, value]) => ({ field: field as CalculationScenario['entries'][number]['field'], value, role: 'assistant', quote: text })) };
function fixture() {
  const project = createProject();
  const request: ChatRequest = { requestId: 'calculation-request', projectId: project.id, moduleId: 'market', intent: 'message', message: 'Предложи сценарий.', context: { name: '', description: '', facts: [], artifacts: [], history: [] } };
  const reply: AssistantReply = { message: text, choices: [], artifactDraft: null, proposedFacts: [], calculationScenario: scenario };
  return { project, request, reply };
}
it('fills the calculation from grounded discussion and preserves AI assumptions through export/reload', () => {
  const { project, request, reply } = fixture();
  const next = syncCalculation(project, request, reply), report = next.calculations.market as StoredCalculation;
  expect(report.results.tam.value).toBe(80000000); expect(report.results.sam.value).toBe(16000000); expect(report.results.som.value).toBe(480000);
  expect(report.inputs.price.provenance).toBe('hypothesis'); expect(report.inputs.price.source).toContain(text);
  expect(report.fieldOrigins?.price).toBe('conversation'); expect(project.calculations).toEqual({});
  expect(parseWorkspace(serializeWorkspace({ version: 1, activeProjectId: next.id, projects: [next] })).projects[0].calculations.market).toEqual(report);
});
it('keeps exact user attribution, decimal zero, partial inputs and unknown results', () => {
  const { project, request, reply } = fixture(); request.message = 'На тест выделяю 0 ₽. Цена за месяц 12,5 ₽.';
  reply.calculationScenario = { entries: [{ field: 'price', value: '12.5', role: 'user', quote: request.message }, { field: 'targetBuyers', value: '0', role: 'user', quote: request.message }] };
  const report = syncCalculation(project, request, reply).calculations.market as StoredCalculation;
  expect(report.inputs.price.value).toBe(12.5); expect(report.inputs.targetBuyers.value).toBe(0);
  expect(report.inputs.price.provenance).toBe('user'); expect(report.inputs.totalBuyers.value).toBeNull(); expect(report.results.tam.value).toBeNull();
});
it('drops fabricated quotations, wrong authors, other module fields, negative and altered numbers without failing the reply', () => {
  const { request } = fixture(); request.message = 'Цена -5, не 50000. Бюджет не обсуждали.';
  const entries: CalculationScenario['entries'] = [
    { field: 'price', value: '5', quote: request.message, role: 'user' },
    { field: 'totalBuyers', value: '1000', quote: text, role: 'assistant' },
    { field: 'targetBuyers', value: '60', quote: text, role: 'user' },
    { field: 'fixedCost', value: '8000', quote: text, role: 'assistant' },
    { field: 'period', value: 'месяц', quote: text, role: 'assistant' },
  ];
  expect(groundCalculationScenario({ entries }, request, text)).toBeNull();
  expect(groundCalculationScenario(scenario, { ...request, moduleId: 'idea' }, text)).toBeNull();
});
it('updates conversation values but leaves manual values and legacy scenarios intact', () => {
  const { project, request, reply } = fixture(); const first = syncCalculation(project, request, reply);
  const stored = first.calculations.market as StoredCalculation;
  stored.inputs.targetBuyers.raw = '25'; stored.fieldOrigins!.targetBuyers = 'manual';
  const changedText = text.replace('60 достижимых', '40 достижимых');
  const changedReply = { ...reply, message: changedText, calculationScenario: { entries: scenario.entries.map(entry => ({ ...entry, value: entry.field === 'targetBuyers' ? '40' : entry.value, quote: changedText })) } };
  const updated = syncCalculation(first, request, changedReply).calculations.market as StoredCalculation;
  expect(updated.inputs.targetBuyers.value).toBe(25); expect(updated.results.som.value).toBe(200000);
  const legacy = { ...project, calculations: { market: calculationReport('market', { totalBuyers: '300', price: '20', period: 'месяц', pricePeriod: 'месяц', currency: '$' }, {}) } };
  const preserved = syncCalculation(legacy, request, reply).calculations.market as StoredCalculation;
  expect(preserved.inputs.totalBuyers.value).toBe(300); expect(preserved.inputs.price.value).toBe(20); expect(preserved.period).toBe('месяц'); expect(preserved.currency).toBe('$');
});
it('does not silently equate the price period with the calculation period', () => {
  const { project, request, reply } = fixture(); reply.calculationScenario = { entries: scenario.entries.filter(entry => entry.field !== 'pricePeriod') };
  const report = syncCalculation(project, request, reply).calculations.market as StoredCalculation;
  expect(report.inputs.price.value).toBe(8000); expect(report.results.tam.value).toBeNull();
  expect(report.inputs.price.unit).toContain('период не указан');
  expect(report.results.tam.reason).toContain('период');
});
it('applies numbers only with the latest valid answer, and a late reply cannot restore a restarted calculation', () => {
  const { project, request, reply } = fixture();
  project.modules.market.messages.push({ id: 'question', role: 'user', content: request.message, createdAt: project.createdAt, requestId: request.requestId });
  const answered = applyAnswer(project, request, reply);
  expect((answered.calculations.market as StoredCalculation).results.som.value).toBe(480000);
  expect(applyAnswer(answered, request, reply)).toBe(answered);
  const restarted = restartChat(answered, 'market');
  expect(restarted.calculations.market).toBeUndefined();
  expect(applyAnswer(restarted, request, reply)).toBe(restarted);
});
it('marks a saved material stale when automatic inputs change and preserves material contents', () => {
  const { project, request, reply } = fixture();
  const saved = saveArtifact(project, 'market', { title: 'Рынок', body: 'Прежний числовой сценарий' });
  const result = syncCalculation(saved, request, reply);
  expect(result.modules.market.artifact).toMatchObject({ body: 'Прежний числовой сценарий', stale: true });
  expect(saved.modules.market.artifact?.stale).toBe(false);
});
it('binds the fresh coverage to the context after automatic numbers invalidate old materials', () => {
  const { project, request, reply } = fixture();
  const saved = saveArtifact(project, 'idea', { title: 'Идея', body: 'Старые расчётные вводные' });
  saved.modules.market.messages.push({ id: 'question', role: 'user', content: request.message, createdAt: saved.createdAt, requestId: request.requestId });
  reply.memory = { facts: [], hypotheses: [], openQuestions: [], coverage: { rubricVersion: 1, moduleId: 'market', nextCriterionId: 'boundaries', items: TOPIC_CRITERIA.market.map(item => ({ id: item.id, status: 'partial', note: 'Есть сценарий, обсуждение продолжается.', support: null })) } };
  const result = applyAnswer(saved, request, reply);
  expect(result.modules.idea.artifact?.stale).toBe(true);
  expect(result.modules.market.memory?.coverageBasis).toBe(coverageBasis(result, 'market'));
});
it('retains stale state when only some inputs are refreshed, and fills economics without treating revenue as profit', () => {
  const { project, request, reply } = fixture(); const old = syncCalculation(project, request, reply);
  (old.calculations.market as StoredCalculation).stale = true;
  expect((syncCalculation(old, request, reply).calculations.market as StoredCalculation).stale).toBe(true);
  const source = 'Клиентов 10. Доход от клиента 500 ₽ за месяц. Постоянные затраты 1000.';
  const next = syncCalculation(project, { ...request, moduleId: 'economics' }, { ...reply, message: source, calculationScenario: { entries: Object.entries({ customers: '10', price: '500', fixedCost: '1000', period: 'месяц', pricePeriod: 'месяц' }).map(([field, value]) => ({ field: field as CalculationScenario['entries'][number]['field'], value, role: 'assistant', quote: source })) } });
  const report = next.calculations.economics as StoredCalculation;
  expect(report.results.revenue.value).toBe(5000); expect(report.results.profit.value).toBeNull(); expect(report.results.cac.value).toBeNull();
});
