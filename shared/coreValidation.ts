import { z } from 'zod';
import { STAGE_IDS, TOOL_IDS } from './modules.js';
import type { AtomicEntry, AtomicValue, CoreContext, CoreMemory, ExternalEvidence, MemoryPatch } from './types.js';

const id = z.string().min(1).max(200).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
const text = z.string().min(1).max(500_000);
const date = z.string().max(40).refine(value => Number.isFinite(Date.parse(value)));
const version = z.number().int().positive();
const counter = z.number().int().nonnegative();
export const coreModuleIdSchema = z.enum([...STAGE_IDS, ...TOOL_IDS]);
const conversationShape = { projectId: id, moduleId: coreModuleIdSchema, generation: counter };
export const versionRefSchema = z.strictObject({ id, version });
const sourceMessageSchema = z.strictObject({ messageId: id, revision: version });
export const messageRevisionSchema = z.strictObject({ ...conversationShape, messageId: id, revision: version, role: z.enum(['user', 'assistant']), content: z.string().max(500_000), createdAt: date });
export const memoryScopeSchema = z.strictObject({
  subject: z.enum(['our_project', 'external_entity']), entityId: id.nullable(), area: z.enum(['project', 'stage', 'scenario']), stageId: coreModuleIdSchema.nullable(), scenario: z.string().min(1).max(200).nullable(),
});
export const sourceRefSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('message'), ...conversationShape, messageId: id, revision: version, quote: text }),
  z.strictObject({ type: z.literal('external'), evidenceId: id, version, quoteId: id }),
  z.strictObject({ type: z.literal('legacy'), label: z.string().min(1).max(500), quote: text }),
]);
const valueShape = {
  kind: z.enum(['decision', 'requirement', 'constraint', 'unknown', 'rejected_option']), key: z.string().min(1).max(200), scope: memoryScopeSchema, text,
  origin: z.enum(['user', 'assistant', 'external', 'calculation', 'legacy']), epistemic: z.enum(['reported', 'hypothesis', 'observed', 'calculated', 'unknown']),
  acceptance: z.enum(['proposed', 'accepted', 'rejected', 'unresolved']), sources: z.array(sourceRefSchema).min(1), dependsOn: z.array(versionRefSchema),
};
export const atomicValueSchema = z.union([
  z.strictObject({ ...valueShape, kind: z.literal('unknown'), epistemic: z.literal('unknown') }),
  z.strictObject({ ...valueShape, kind: z.enum(['decision', 'requirement', 'constraint', 'rejected_option']) }),
]);
export const atomicEntrySchema = z.strictObject({ ...valueShape, id, version, previousVersion: version.nullable(), createdAt: date, requestId: id.nullable() });
export const memoryOperationsSchema = z.array(z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('create'), localId: id, value: atomicValueSchema }),
  z.strictObject({ op: z.literal('revise'), id, expectedVersion: version, value: atomicValueSchema }),
])).max(100);
// All object fields are required, nullable where appropriate, for OpenAI strict JSON.
export const memoryOperationsJsonSchema = z.toJSONSchema(memoryOperationsSchema);
export const memoryPatchSchema = z.strictObject({ ...conversationShape, schemaVersion: z.literal(1), requestId: id, baseMemoryVersion: counter, baseContextVersion: counter, sourceMessage: sourceMessageSchema, operations: memoryOperationsSchema });
export const externalEvidenceSchema = z.strictObject({
  ...conversationShape, id, version, requestId: id, operationId: id, url: z.url().max(4000).refine(value => ['http:', 'https:'].includes(new URL(value).protocol)), title: z.string().max(500), retrievedAt: date,
  publishedAt: date.nullable(), effectiveAt: date.nullable(), retrieval: z.enum(['read', 'search_snippet', 'unavailable']), contentHash: z.string().min(1).max(200),
  quotes: z.array(z.strictObject({ id, text: z.string().min(1).max(12000), start: counter.nullable(), end: counter.nullable() })).max(30), limitations: z.array(z.string().max(2000)).max(30),
});
export const externalClaimSchema = z.strictObject({ text: z.string().min(1).max(5000), evidenceId: id, version, quoteId: id, price: z.strictObject({ amount: z.string().max(100), currency: z.string().max(100), unit: z.string().max(200), period: z.string().max(200), paymentTerms: z.string().max(1000) }).nullable() });
export const researchProgressSchema = z.strictObject({ phase: z.enum(['planning', 'searching', 'reading', 'composing', 'finalizing', 'reviewing']), message: z.string().min(1).max(300) });
export const researchSchema = z.strictObject({ status: z.enum(['not_needed', 'completed', 'partial', 'failed']), limitations: z.array(z.string().max(2000)).max(30) });
export const diagnosticsSchema = z.strictObject({
  action: z.enum(['answer', 'research']).optional(), methods: z.array(z.strictObject({ id, version: z.string().max(100), reason: z.string().max(1000).optional() })).max(30).optional(),
  coreVersions: z.strictObject({ revision: counter, contextVersion: counter }).optional(),
  // Up to three bounded cycles, each with reads and the allowed repairs/skills.
  operations: z.array(z.strictObject({ id, kind: z.enum(['plan', 'search', 'read', 'generate', 'skill', 'evaluate']), state: z.enum(['started', 'completed', 'failed', 'unknown']), inputHash: z.string().max(200).optional(), errorCode: z.string().max(100).optional() })).max(4096).optional(),
  skills: z.array(z.strictObject({ id, version: z.string().max(100) })).max(3).optional(),
  elapsedMs: z.number().nonnegative().optional(), costUsd: z.number().nonnegative().nullable().optional(),
});
export const historySourcesSchema = z.array(z.strictObject({ source: messageRevisionSchema, quotes: z.array(z.string().min(1).max(24000)).min(1).max(100) })).max(100);
// Six is the limit for NEW pages per research, not for a reply that also cites
// historical reads. The complete server-owned envelope has a separate byte cap.
export const coreReplyShape = { historySources: historySourcesSchema.optional(), memoryPatch: memoryPatchSchema.optional(), externalSources: z.array(externalEvidenceSchema).optional(), recoveredSourceRefs: z.array(versionRefSchema).optional(), externalClaims: z.array(externalClaimSchema).max(100).optional(), research: researchSchema.optional(), diagnostics: diagnosticsSchema.optional() };
export const basedOnSchema = z.strictObject({ memoryVersion: counter, atoms: z.array(versionRefSchema), evidence: z.array(versionRefSchema) });
export const coreMemorySchema = z.strictObject({ schemaVersion: z.literal(1), revision: counter, contextVersion: counter, entries: z.array(atomicEntrySchema), sourceMessages: z.array(messageRevisionSchema), evidence: z.array(externalEvidenceSchema), appliedRequestIds: z.array(id) });
export const coreContextSchema = z.strictObject({ ...conversationShape, schemaVersion: z.literal(1), revision: counter, contextVersion: counter, currentEntryRefs: z.array(versionRefSchema), sourceMessage: sourceMessageSchema, entries: z.array(atomicEntrySchema), sourceMessages: z.array(messageRevisionSchema), evidence: z.array(externalEvidenceSchema) });
export class CoreMemoryError extends Error {
  readonly name = 'CoreMemoryError';
  constructor(public readonly code: 'MEMORY_CONFLICT' | 'INVALID_MEMORY' | 'CONTEXT_LIMIT', message: string, public readonly validationPath: (string | number)[] = [], public readonly validationRule = 'invalid_memory_value') { super(message); }
}
export function invalidMemory(message: string, path: (string | number)[] = [], rule = 'invalid_memory_value'): never { throw new CoreMemoryError('INVALID_MEMORY', message, path, rule); }
export function memoryConflict(): never { throw new CoreMemoryError('MEMORY_CONFLICT', 'Вводные изменились во время ответа. Прежняя работа сохранена; отправьте новое сообщение с актуальным контекстом.'); }

export function validateCoreOwnership(core: CoreMemory | CoreContext, projectId: string): void {
  if (core.sourceMessages.some(source => source.projectId !== projectId) || core.evidence.some(source => source.projectId !== projectId) || core.entries.some(entry => entry.sources.some(source => source.type === 'message' && source.projectId !== projectId))) invalidMemory('Источник относится к другому проекту.');
  const unique = (items: string[]) => new Set(items).size === items.length;
  if (!unique(core.entries.map(entry => `${entry.id}:${entry.version}`)) || !unique(core.sourceMessages.map(source => `${source.moduleId}:${source.generation}:${source.messageId}:${source.revision}`)) || !unique(core.evidence.map(source => `${source.id}:${source.version}`))) invalidMemory('Повтор версии источника или решения.');
}
export function validateAcceptedScopes(values: AtomicValue[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (value.acceptance !== 'accepted') continue;
    const scope = value.scope;
    const key = JSON.stringify([value.key, scope.subject, scope.entityId, scope.area, scope.stageId, scope.scenario]);
    if (seen.has(key)) invalidMemory('Конфликт принятых решений в одной области. Укажите, какое решение заменяется.', ['scope']);
    seen.add(key);
  }
}
export function validateMemoryValue(value: AtomicValue, core: CoreMemory | CoreContext, patch: MemoryPatch, evidence: ExternalEvidence[], previous?: AtomicEntry): void {
  const scope = value.scope;
  if ((scope.subject === 'external_entity') !== (scope.entityId !== null) || (scope.area === 'stage' && !scope.stageId) || (scope.area === 'project' && (scope.stageId || scope.scenario)) || (scope.area === 'scenario' && !scope.scenario)) invalidMemory('Область решения неоднозначна.', ['scope']);
  // Explicit competitor price metrics describe an external entity even when
  // reported by the user and still unknown. This finite role guard does not
  // infer arbitrary subjects or promote the evidence status.
  const competitorMetric = /(?:competitors?[_ -](?:(?:average|avg)[_ -](?:check|price|ticket)|price|tariff)|(?:средн[^.]*чек|цен[аы]|тариф)[^.]*конкурент|конкурент[^.]*?(?:средн[^.]*чек|цен[аы]|тариф))/iu;
  const metricText = value.text.replace(/не\s+(?:(?:фактический|подтверждённый|подтвержденный)\s+)?средний\s+чек\s+конкурентов/giu, '');
  const explicitRussianMetric = /средний\s+чек\s+конкурентов/iu.test(metricText);
  if (scope.subject === 'our_project' && (competitorMetric.test(value.key) || explicitRussianMetric || /у конкурентов\s+(?:средн[^.]*чек|цен[аы]|тариф)/iu.test(value.text))) invalidMemory('Показатель конкурента требует области external_entity.', ['scope', 'subject'], 'competitor_metric_requires_external_entity');
  if (previous && (previous.key !== value.key || JSON.stringify(previous.scope) !== JSON.stringify(value.scope))) invalidMemory('Нельзя менять область или ключ существующего решения. Создайте отдельный вариант.', ['scope']);
  if (previous?.acceptance === 'accepted' && value.acceptance === 'proposed') invalidMemory('Предложение не заменяет принятое решение.', ['acceptance']);
  let userSource = false, readSource = false;
  const quotes: string[] = [];
  const readTitles = new Set<string>();
  const readDates = new Set<string>();
  for (const [sourceIndex, source] of value.sources.entries()) {
    if (source.type === 'legacy') invalidMemory('Модель не создаёт унаследованные источники.', ['sources']);
    if (source.type === 'message') {
      if (source.projectId !== patch.projectId) invalidMemory('Источник из другого проекта.', ['sources']);
      const matches = core.sourceMessages.filter(item => item.projectId === source.projectId && item.moduleId === source.moduleId && item.generation === source.generation && item.messageId === source.messageId);
      const exact = matches.find(item => item.revision === source.revision);
      if (!exact || matches.some(item => item.revision > source.revision) || !exact.content.includes(source.quote)) invalidMemory('Цитата или версия сообщения не совпадает с сохранённым источником.', ['sources', sourceIndex, 'quote']);
      userSource ||= exact.role === 'user';
      quotes.push(source.quote);
    } else {
      const item = evidence.find(item => item.id === source.evidenceId && item.version === source.version && item.projectId === patch.projectId);
      const quote = item?.quotes.find(quote => quote.id === source.quoteId);
      if (!item || !quote || item.retrieval !== 'read') invalidMemory('Внешнее основание требует прочитанного источника и точного фрагмента.', ['sources', sourceIndex]);
      readSource = true;
      readTitles.add(item.title);
      readDates.add(item.retrievedAt.slice(0, 10));
      quotes.push(quote.text);
    }
  }
  if (value.origin === 'legacy' || (value.origin === 'user' && !userSource) || (value.origin === 'external' && !readSource)) invalidMemory('Происхождение не соответствует роли источника.', ['origin']);
  if (value.acceptance === 'accepted' && !userSource) invalidMemory('Принятие требует слов пользователя. Предложение AI остаётся предложением.', ['acceptance']);
  if (value.epistemic === 'observed' && !readSource) invalidMemory('Цитата пользователя или AI не является внешней проверкой.', ['epistemic']);
  if (value.epistemic === 'calculated' && (value.origin !== 'calculation' || !value.dependsOn.length)) invalidMemory('Расчёту нужны версии исходных данных.', ['dependsOn']);
  if (value.kind === 'unknown' && value.epistemic !== 'unknown') invalidMemory('Неизвестное не становится установленным фактом.', ['epistemic']);
  if (value.kind === 'rejected_option' && value.acceptance !== 'rejected') invalidMemory('Отклонённый вариант должен сохранить свой статус.', ['acceptance']);
  if (value.acceptance === 'accepted' && quotes.some(quote => /(?:а если|просто вариант|допустим,? что)/iu.test(quote))) invalidMemory('Условный вариант не заменяет принятое решение. Нужна явная реплика выбора.', ['acceptance']);
  // Conservative numerical guard only. Quote inclusion is NOT semantic validation:
  // roles, negation and real-world truth still require the separate C03/C04 evals.
  const titleText = stripLabelledReadTitles(value.text, readTitles);
  const contentText = readSource ? stripGroundedReadDates(titleText, readDates) : titleText;
  if (contentText === null) invalidMemory('Дата получения не совпадает с прочитанным источником.', ['text'], 'read_date_mismatch');
  if (value.epistemic !== 'calculated' && !groundedQuantities(contentText, quotes.join(' '))) invalidMemory('Число, валюта или единица отсутствует в процитированном основании.', ['text'], 'ungrounded_memory_quantity');
  for (const ref of value.dependsOn) if (!core.entries.some(entry => entry.id === ref.id && entry.version === ref.version)) invalidMemory('Не найдена версия основания решения.', ['dependsOn']);
}

// Only labelled retrieval dates are metadata. A mismatched labelled date is
// rejected even if its individual digits also occur in a tariff/effective date.
export function stripGroundedReadDates(text: string, dates: Set<string>): string | null {
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const exact = new Set(dates);
  for (const date of dates) {
    const [year, month, day] = date.split('-');
    const russian = `${Number(day)} ${months[Number(month)-1]} ${year}`;
    exact.add(russian); exact.add(`${russian} года`);
    exact.add(`${day} ${months[Number(month)-1]} ${year}`); exact.add(`${day} ${months[Number(month)-1]} ${year} года`);
    exact.add(`${day}.${month}.${year}`);
  }
  let mismatch = false;
  const content = text.replace(/(?<![\p{L}\d])(?:прочитан[ао]?|проверен[ао]?|дата получения):?\s*(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4}|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4}(?:\s+года)?)/giu,
    (whole, date: string) => { if (exact.has(date.toLowerCase().replace(/\s+/gu,' '))) return ''; mismatch = true; return whole; });
  return mismatch ? null : content;
}

// A page title is server metadata, not its tariff's billing period. Exempt
// only the exact title of a validated, actually cited read in the same project;
// arbitrary titles and any surrounding quantities/conditions remain checked.
export function stripLabelledReadTitles(text: string, titles: Set<string>): string {
  return text.replace(/(?<![\p{L}\d])(?:на прочитанной странице с названием|в полученной странице с заголовком|на (?:прочитанной )?странице|страница|источник):?\s*«([^»]+)»/giu,
    (whole, title: string) => titles.has(title) ? '' : whole);
}

import type { ChatRequest } from './types.js';
export type CoreRequestIssue = {
  rule: 'missing_core_context' | 'invalid_contract_version' | 'core_scope_mismatch' | 'invalid_core_ownership' | 'current_source_missing' | 'current_source_not_user' | 'current_source_text_mismatch' | 'current_source_superseded' | 'current_entry_refs_mismatch';
  path: string[];
};
type CoreRequestInput = Pick<ChatRequest, 'projectId' | 'moduleId' | 'message' | 'contractVersion' | 'coreContext'>;
// Safe structural diagnostics only: never include source text, identifiers or scope values.
export function diagnoseCoreRequest(request: CoreRequestInput): CoreRequestIssue | undefined {
  const context = request.coreContext;
  if (!context) return request.contractVersion === undefined ? undefined : { rule: 'missing_core_context', path: ['coreContext'] };
  if (request.contractVersion !== 2) return { rule: 'invalid_contract_version', path: ['contractVersion'] };
  if (context.projectId !== request.projectId || context.moduleId !== request.moduleId) return { rule: 'core_scope_mismatch', path: ['coreContext'] };
  try { validateCoreOwnership(context, request.projectId); } catch { return { rule: 'invalid_core_ownership', path: ['coreContext'] }; }
  const source = context.sourceMessages.find(item => item.moduleId === request.moduleId && item.generation === context.generation && item.messageId === context.sourceMessage.messageId && item.revision === context.sourceMessage.revision);
  if (!source) return { rule: 'current_source_missing', path: ['coreContext', 'sourceMessage'] };
  if (source.role !== 'user') return { rule: 'current_source_not_user', path: ['coreContext', 'sourceMessage'] };
  if (source.content !== request.message) return { rule: 'current_source_text_mismatch', path: ['coreContext', 'sourceMessage'] };
  if (context.sourceMessages.some(item => item.moduleId === source.moduleId && item.generation === source.generation && item.messageId === source.messageId && item.revision > source.revision)) return { rule: 'current_source_superseded', path: ['coreContext', 'sourceMessage'] };
  const latest = new Map<string, number>();
  for (const entry of context.entries) latest.set(entry.id, Math.max(latest.get(entry.id) ?? 0, entry.version));
  if (!(context.currentEntryRefs.length === latest.size && new Set(context.currentEntryRefs.map(ref => ref.id)).size === latest.size && context.currentEntryRefs.every(ref => latest.get(ref.id) === ref.version))) return { rule: 'current_entry_refs_mismatch', path: ['coreContext', 'currentEntryRefs'] };
  return undefined;
}
export function validCoreRequest(request: CoreRequestInput): boolean {
  return diagnoseCoreRequest(request) === undefined;
}
export function validatePatchEnvelope(patch: MemoryPatch, request: ChatRequest): void {
  const context = request.coreContext;
  if (!context || patch.requestId !== request.requestId || patch.projectId !== request.projectId || patch.moduleId !== request.moduleId || patch.generation !== context.generation || patch.baseMemoryVersion !== context.revision || patch.baseContextVersion !== context.contextVersion || patch.sourceMessage.messageId !== context.sourceMessage.messageId || patch.sourceMessage.revision !== context.sourceMessage.revision) memoryConflict();
}

// Canonical decimal strings avoid both formatting differences and floating-point rounding.
function normalizedNumbers(text: string): string[] {
  const pattern = /\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?(?:\s*(?:тыс\.?|[кk])(?=$|[^\p{L}\d]))?/giu;
  return [...text.matchAll(pattern)].map(([token]) => {
    const thousand = /(?:тыс\.?|[кk])$/iu.test(token);
    const decimal = token.replace(/(?:тыс\.?|[кk])$/iu, '').replace(/\s/g, '').replace(',', '.');
    const [integer, fraction = ''] = decimal.split('.');
    let digits = BigInt(integer + fraction) * (thousand ? 1000n : 1n);
    let scale = fraction.length;
    while (scale > 0 && digits % 10n === 0n) { digits /= 10n; scale--; }
    return `${digits}:${scale}`;
  });
}
export function sameSingleAmount(left: string, right: string): boolean {
  const a = normalizedNumbers(left), b = normalizedNumbers(right);
  return a.length === 1 && b.length === 1 && a[0] === b[0];
}
export function groundedQuantities(text: string, quote: string): boolean {
  if (normalizedNumbers(text).some(number => !normalizedNumbers(quote).includes(number))) return false;
  // Known currencies and denominator units must still be present. This is a lexical
  // safety boundary, not a claim that arbitrary paraphrases/roles are understood.
  // Unicode boundaries are required for Cyrillic abbreviations: JS \b does not
  // end «мес». Whole period labels also keep «негодовой» from proving annual billing.
  const dimensions = [
    /₽|руб(?:л[ьяейю]+)?|\bRU[BR]\b/iu, /\$|доллар|\bUSD\b/iu, /€|евро|\bEUR\b/iu,
    /(?:(?:за|на)\s+|\/\s*)(?:одн[ауой]+\s+)?(?:точк|заведени)/iu,
    /(?:(?:за|на)\s+|\/\s*)(?:одного\s+)?(?:пользовател|сотрудник)|(?:\/\s*|(?<![\p{L}\p{N}_])per\s+)(?:users?|employees?)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])(?:users?|employees?)\s*\/\s*(?:months?|years?)(?![\p{L}\p{N}_])/iu,
    /(?:(?<![\p{L}\p{N}_])(?:в|за)\s+|\/\s*)(?:месяц|мес)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])помесячн[а-яё]*(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])(?:months?|monthly)(?![\p{L}\p{N}_])/iu,
    /(?:(?<![\p{L}\p{N}_])(?:в|за)\s+|\/\s*)(?:год|года)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])годов(?:ой|ая|ое|ые|ого|ому|ым|ую|ых|ыми|ом)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])(?:years?|yearly|annual|annually)(?![\p{L}\p{N}_])/iu,
    /(?:(?:в|за)\s+|\/\s*)(?:день|сутки)|ежедневн|\bday\b/iu,
    // A time-zone adjective («в часовом поясе») is not an hour denominator.
    /(?:(?:в|за)\s+|\/\s*)час(?:а|ов|ах)?(?![\p{L}\p{N}_])|\bhour\b/iu,
  ];
  return dimensions.every(pattern => !pattern.test(text) || pattern.test(quote));
}

// A narrow named-entity label may contain digits without asserting a quantity.
// Only the exact whole token in a cited read's host/title/quotes is metadata;
// this never exempts standalone numbers or surrounding price assertions.
export function stripGroundedReadEntityNames(text: string, source: ExternalEvidence): string {
  if (source.retrieval !== 'read') return text;
  const tokens = new Set([new URL(source.url).hostname.split('.').join(' '), source.title, ...source.quotes.map(quote => quote.text)]
    .flatMap(value => value.match(/[\p{L}\p{N}_-]+/gu) ?? []).map(token => token.toLowerCase()));
  return text.replace(/(?<![\p{L}\p{N}_])в описании\s+([\p{L}][\p{L}\p{N}_-]*)/giu, (whole, token: string) =>
    /\p{N}/u.test(token) && tokens.has(token.toLowerCase()) ? whole.slice(0, whole.length - token.length) : whole);
}
