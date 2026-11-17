import { z } from 'zod';
import { calculateEconomics, calculateMarket, parseNonNegative, type CalculationReport } from './calculations.js';
import type { AssistantReply, ChatRequest, Project } from './types.js';

export const calculationFields = {
  market: ['totalBuyers', 'reachableBuyers', 'targetBuyers', 'price'],
  economics: ['customers', 'price', 'variableCostPerCustomer', 'fixedCost', 'acquisitionCost', 'newCustomers'],
} as const;
const field = z.enum(['totalBuyers', 'reachableBuyers', 'targetBuyers', 'price', 'customers', 'variableCostPerCustomer', 'fixedCost', 'acquisitionCost', 'newCustomers', 'period', 'pricePeriod', 'currency']);
export const calculationScenarioSchema = z.strictObject({
  entries: z.array(z.strictObject({ field, value: z.string().min(1).max(100), role: z.enum(['user', 'assistant']), quote: z.string().min(4).max(1200) })).max(12),
});
export type CalculationScenario = z.infer<typeof calculationScenarioSchema>;
export type StoredCalculation = CalculationReport & { pricePeriod?: string; fieldOrigins?: Record<string, 'manual' | 'conversation'>; stale?: boolean; staleReason?: string };
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();

// Optional convenience data must never invalidate an otherwise useful answer.
// A literal quotation grounds every imported value; unsupported entries stay unknown.
export function groundCalculationScenario(scenario: CalculationScenario | null | undefined, request: ChatRequest, message: string): CalculationScenario | null {
  if (!scenario || !(request.moduleId in calculationFields)) return null;
  const moduleId = request.moduleId as keyof typeof calculationFields;
  const allowed = new Set<string>([...calculationFields[moduleId], 'period', 'pricePeriod', 'currency']);
  const messages = [{ role: 'user', content: request.message }, { role: 'assistant', content: message }, ...request.context.history, ...(request.coreContext?.sourceMessages ?? [])];
  const seen = new Set<string>();
  const entries = scenario.entries.filter(entry => {
    if (!allowed.has(entry.field) || seen.has(entry.field)) return false;
    const quote = normalize(entry.quote);
    if (!messages.some(source => source.role === entry.role && normalize(source.content).includes(quote))) return false;
    if (['period', 'pricePeriod', 'currency'].includes(entry.field)) {
      if (!quote.toLocaleLowerCase('ru').includes(normalize(entry.value).toLocaleLowerCase('ru'))) return false;
    } else {
      const number = parseNonNegative(entry.value);
      // Compare complete numeric tokens, including spaced thousands and decimals.
      if (number === null || ![...quote.matchAll(/[+-]?\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?/g)].some(match => Number(match[0].replace(/\s/g, '').replace(',', '.')) === number)) return false;
    }
    seen.add(entry.field); return true;
  });
  return entries.length ? { entries } : null;
}

export function calculationReport(moduleId: 'market' | 'economics', values: Record<string, string>, sources: Record<string, string>, provenance?: Record<string, 'user' | 'hypothesis' | 'unknown'>): CalculationReport {
  const input = { ...values, period: values.period ?? '', pricePeriod: values.pricePeriod ?? '', currency: values.currency ?? '₽', sources, provenance };
  return moduleId === 'market'
    ? calculateMarket({ ...input, totalBuyers: values.totalBuyers, reachableBuyers: values.reachableBuyers, targetBuyers: values.targetBuyers, price: values.price })
    : calculateEconomics({ ...input, customers: values.customers, price: values.price });
}

export function syncCalculation(project: Project, request: ChatRequest, reply: AssistantReply): Project {
  const scenario = groundCalculationScenario(reply.calculationScenario, request, reply.message);
  if (!scenario) return project;
  const moduleId = request.moduleId as 'market' | 'economics';
  const stored = project.calculations[moduleId] as StoredCalculation | undefined;
  const values: Record<string, string> = { period: stored?.period ?? '', pricePeriod: stored?.pricePeriod ?? stored?.period ?? '', currency: stored?.currency ?? '₽' };
  const sources: Record<string, string> = {}, provenance: Record<string, 'user' | 'hypothesis' | 'unknown'> = {};
  const fieldOrigins = { ...stored?.fieldOrigins };
  for (const [key, input] of Object.entries(stored?.inputs ?? {})) {
    values[key] = String(input.raw ?? ''); sources[key] = input.source; provenance[key] = input.provenance;
    if (input.raw !== null && input.raw !== undefined && String(input.raw).trim() && !fieldOrigins[key]) fieldOrigins[key] = 'manual';
  }
  for (const key of ['period', 'pricePeriod', 'currency']) if (stored && !stored.fieldOrigins && values[key]) fieldOrigins[key] = 'manual';
  let changed = false;
  for (const entry of scenario.entries) {
    if (fieldOrigins[entry.field] === 'manual') continue;
    values[entry.field] = entry.value;
    sources[entry.field] = `${entry.role === 'user' ? 'Со слов пользователя' : 'Гипотеза наставника'}: «${entry.quote}»`;
    provenance[entry.field] = entry.role === 'user' ? 'user' : 'hypothesis';
    fieldOrigins[entry.field] = 'conversation'; changed = true;
  }
  if (!changed) return project;
  const report = { ...calculationReport(moduleId, values, sources, provenance), pricePeriod: values.pricePeriod, fieldOrigins,
    ...(stored?.stale ? { stale: true, staleReason: stored.staleReason } : {}) };
  const numericChange = !stored || (['period', 'pricePeriod', 'currency'].some(key => stored[key as 'period' | 'pricePeriod' | 'currency'] !== report[key as 'period' | 'pricePeriod' | 'currency'])
    || calculationFields[moduleId].some(key => stored.inputs[key]?.value !== report.inputs[key]?.value));
  const modules = numericChange ? Object.fromEntries(Object.entries(project.modules).map(([id, state]) => [id, state.artifact
    ? { ...state, artifact: { ...state.artifact, stale: true, staleReason: 'Обновлены числа расчётного сценария из обсуждения. Сверьте расчёт и выводы.' } } : state])) as Project['modules'] : project.modules;
  return { ...project, modules, calculations: { ...project.calculations, [moduleId]: report } };
}
