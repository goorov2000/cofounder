import { calculationScenarioSchema } from './calculationScenario.js';
import { ASSISTANT_TEXT_CHARS } from './transportLimits.js';
import type { Fact, Provenance, Workspace } from './types.js';
import { z } from 'zod';
import { STAGE_IDS, TOOL_IDS } from './modules.js';
import { chatMemorySchema } from './memory.js';
import { coreReplyShape, coreMemorySchema, coreContextSchema, basedOnSchema, validCoreRequest } from './coreValidation.js';
import { ensureCore } from './coreMemory.js';

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  user: 'Со слов пользователя', hypothesis: 'Гипотеза', calculation: 'Расчёт', unknown: 'Неизвестно', verified: 'Проверено пользователем',
};
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
export function isSafeKey(value: string): boolean { return Boolean(value.trim()) && !forbiddenKeys.has(value); }
export function isHttpUrl(value: string): boolean {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && Boolean(url.hostname); } catch { return false; }
}
export function isCheckDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)) return false;
  const time = new Date(value);
  return Number.isFinite(time.getTime()) && time.toISOString().slice(0, 10) === value.slice(0, 10);
}
export function validateFact(fact: Fact, origin: 'user' | 'assistant' = 'user'): Fact {
  if (!isSafeKey(fact.key)) throw new Error('Недопустимый ключ решения.');
  if (!Object.hasOwn(PROVENANCE_LABELS, fact.provenance) || typeof fact.value !== 'string' || typeof fact.note !== 'string') throw new Error('Укажите значение и происхождение решения.');
  if (origin === 'assistant' && fact.provenance === 'verified') throw new Error('Предложение модели не может иметь статус «Проверено пользователем».');
  if (fact.sourceUrl !== undefined && !isHttpUrl(fact.sourceUrl)) throw new Error('Укажите источник с адресом http или https.');
  if (fact.checkedAt !== undefined && !isCheckDate(fact.checkedAt)) throw new Error('Укажите корректную дату проверки.');
  if (fact.provenance === 'verified') {
    if (!fact.sourceUrl) throw new Error('Для проверенного сведения укажите источник http или https.');
    if (!fact.checkedAt) throw new Error('Для проверенного сведения укажите дату проверки.');
  }
  return { ...fact };
}
export const MAX_PROJECTS = 20;
// Logical JSON/export size, separate from the compact browser storage record.
export const MAX_WORKSPACE_BYTES = 64 * 1024 * 1024;
const text = z.string().max(500_000);
const identifier = z.string().min(1).max(200).refine(isSafeKey);
const date = z.string().refine(isCheckDate);
const moduleId = z.enum([...STAGE_IDS, ...TOOL_IDS] as [typeof STAGE_IDS[number], ...Array<typeof STAGE_IDS[number] | typeof TOOL_IDS[number]>]);
const factSchema = z.strictObject({
  key: identifier, value: text, provenance: z.enum(['user', 'hypothesis', 'calculation', 'unknown', 'verified']), note: text,
  sourceUrl: z.string().max(4000).refine(isHttpUrl).optional(), checkedAt: date.optional(),
}).refine((fact) => { try { validateFact(fact); return true; } catch { return false; } }, 'Проверенному сведению нужны источник и дата.');
const choiceSchema = z.strictObject({ id: identifier, label: text, description: text, recommended: z.boolean().optional() });
export const replySchema = z.strictObject({
  calculationScenario: calculationScenarioSchema.nullable().optional(),
  ...coreReplyShape,
  message: text, choices: z.array(choiceSchema).max(50), artifactDraft: z.strictObject({ title: text, body: text }).nullable(),
  proposedFacts: z.array(factSchema.refine((fact) => fact.provenance !== 'verified', 'Модель не создаёт проверенные факты.')).max(500),
  memory: chatMemorySchema.optional(),
  knowledgeSources: z.array(z.strictObject({
    id: identifier, title: z.string().max(200), body: z.string().max(12000), version: z.string().max(40),
    methodId: identifier.optional(), sourceRefs: z.array(identifier).max(20).optional(),
    applicability: z.array(z.string().max(2000)).max(10).optional(),
    status: z.literal('editorial_draft_not_behaviorally_validated').optional(),
    selectionReason: z.array(z.string().max(200)).max(10).optional(),
  })).max(6).optional(),
});
const artifactSchema = z.strictObject({
  basedOn: basedOnSchema.optional(),
  title: text, body: text, revision: z.number().int().positive(), savedAt: date, stale: z.boolean(), staleReason: text.optional(),
  assessment: z.strictObject({ textHash: text, checks: z.array(z.strictObject({ label: text, passed: z.boolean(), reason: text })).max(2000), assessedAt: date }).optional(),
});
export const requestSchema = z.strictObject({
  contractVersion: z.literal(2).optional(), coreContext: coreContextSchema.optional(),
  requestId: identifier, projectId: identifier, moduleId, intent: z.enum(['message', 'draft', 'start']), message: z.string().min(1).max(8000),
  context: z.strictObject({
    name: z.string().max(160), description: z.string().max(6000),
    facts: z.array(factSchema.refine(f => f.key.length <= 100 && f.value.length <= 2000 && f.note.length <= 2000)).max(100),
    currentDraft: z.strictObject({title:z.string().max(200),body:z.string().max(ASSISTANT_TEXT_CHARS)}).optional(),
    artifacts: z.array(z.strictObject({moduleId, title: z.string().max(200), body: z.string().max(ASSISTANT_TEXT_CHARS), stale: z.boolean(), provenance:z.literal('assistant_proposal').optional()})).max(14),
    history: z.array(z.strictObject({role:z.enum(['user','assistant']),content:z.string().max(8000)})).max(40),
    memories: z.array(z.strictObject({ moduleId, content: chatMemorySchema, updatedAt: date, needsRefresh: z.boolean().optional() })).max(14).optional(),
  }),
}).refine(validCoreRequest, 'Исходное сообщение или версия контекста не совпадают.');
const moduleSchema = z.strictObject({
  generation: z.number().int().nonnegative().optional(),
  completedAt: date.optional(),
  messages: z.array(z.strictObject({
    revision: z.number().int().positive().optional(), id: identifier, role: z.enum(['user', 'assistant']), content: text, createdAt: date, choices: z.array(choiceSchema).max(50).optional(),
    choiceConsumed: z.boolean().optional(), requestId: identifier.optional(), request: requestSchema.optional(), requestError: z.string().max(100).optional(), status: z.enum(['pending', 'sent', 'failed']).optional(), reply: replySchema.optional(),
    feedback: z.enum(['up', 'down']).optional(), regenerationRequest: requestSchema.optional(), replacesAnswerId: identifier.optional(),
  })).max(10_000).refine((messages) => new Set(messages.map((message) => message.id)).size === messages.length),
  draft: text, proposal: replySchema.nullable(), artifact: artifactSchema.nullable(),
  resetAt: date.optional(),
  memory: z.strictObject({ content: chatMemorySchema, updatedAt: date, needsRefresh: z.boolean().optional(), coverageBasis: z.string().max(100).optional() }).optional(),
});
// Persisted scenarios are consumed directly by the calculator, export and AI context.
const calculationInputSchema = z.strictObject({
  raw: z.union([text, z.number(), z.null()]), value: z.number().nonnegative().nullable(),
  unit: text, source: text, provenance: z.enum(['user', 'hypothesis', 'unknown']),
});
const calculationValueSchema = z.strictObject({ value: z.number().nullable(), formula: text, unit: text, period: text, reason: text.optional() });
const calculationShape = { stale: z.boolean().optional(), staleReason: text.optional(), basedOn: basedOnSchema.optional(), warnings: z.array(text).max(100), period: text, currency: text, pricePeriod: text.optional(), fieldOrigins: z.record(z.string().max(100), z.enum(['manual', 'conversation'])).optional() };
const marketCalculationSchema = z.strictObject({
  ...calculationShape,
  inputs: z.strictObject({ totalBuyers: calculationInputSchema, reachableBuyers: calculationInputSchema, targetBuyers: calculationInputSchema, price: calculationInputSchema }),
  results: z.strictObject({ tam: calculationValueSchema, sam: calculationValueSchema, som: calculationValueSchema }),
});
const economicsCalculationSchema = z.strictObject({
  ...calculationShape,
  inputs: z.strictObject({ customers: calculationInputSchema, price: calculationInputSchema, variableCostPerCustomer: calculationInputSchema, fixedCost: calculationInputSchema, acquisitionCost: calculationInputSchema, newCustomers: calculationInputSchema }),
  results: z.strictObject({ revenue: calculationValueSchema, variableCost: calculationValueSchema, contribution: calculationValueSchema, profit: calculationValueSchema, cac: calculationValueSchema, ltv: calculationValueSchema }),
});
const calculationsSchema = z.object({ market: marketCalculationSchema.optional(), economics: economicsCalculationSchema.optional() }).catchall(z.json()).refine(calculations => Object.keys(calculations).every(key => identifier.safeParse(key).success));
const projectSchema = z.strictObject({
  core: coreMemorySchema.optional(),
  id: identifier, name: text, description: text, stageLabel: text, prototypeUrl: z.string().max(4000).refine((value) => value === '' || isHttpUrl(value)),
  createdAt: date, updatedAt: date, isDemo: z.boolean(), activeModule: moduleId,
  unlockedStages: z.array(z.enum(STAGE_IDS)).max(STAGE_IDS.length).refine(ids => new Set(ids).size === ids.length).optional(),
  facts: z.record(identifier, factSchema).refine((facts) => Object.entries(facts).every(([key, fact]) => key === fact.key)),
  modules: z.record(moduleId, moduleSchema), calculations: calculationsSchema,
});
const workspaceSchema = z.strictObject({
  version: z.literal(1), activeProjectId: identifier, projects: z.array(projectSchema).min(1).max(MAX_PROJECTS),
}).refine((workspace) => workspace.projects.some((project) => project.id === workspace.activeProjectId) && new Set(workspace.projects.map((project) => project.id)).size === workspace.projects.length);
function assertSafeTree(value: unknown, depth = 0): void {
  if (depth > 40) throw new Error('Слишком сложная структура резервной копии.');
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) throw new Error('Резервная копия содержит недопустимые ключи.');
      assertSafeTree(entry, depth + 1);
    }
  }
}
export function parseWorkspace(raw: string): Workspace {
  if (new TextEncoder().encode(raw).byteLength > MAX_WORKSPACE_BYTES) throw new Error('Размер резервной копии превышает 64 МиБ. Исходные данные не изменены.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Не удалось прочитать JSON. Исходные данные сохранены без изменений.'); }
  assertSafeTree(parsed);
  const result = workspaceSchema.safeParse(parsed);
  if (!result.success) throw new Error(`Формат данных не поддерживается или содержит ошибку (версия 1, не более ${MAX_PROJECTS} проектов). Исходные данные не изменены.`);
  return { ...result.data, projects: result.data.projects.map(ensureCore) };
}
export function serializeWorkspace(workspace: Workspace): string {
  // Validate the original tree as well: JSON.stringify would turn NaN into null.
  assertSafeTree(workspace);
  if (!workspaceSchema.safeParse(workspace).success) throw new Error('Изменение содержит недопустимые данные. Предыдущая работа сохранена.');
  const raw = JSON.stringify(workspace);
  parseWorkspace(raw);
  return raw;
}
