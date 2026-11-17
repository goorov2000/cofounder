import { calculationScenarioSchema } from '../shared/calculationScenario.js';
import { ASSISTANT_TEXT_CHARS } from '../shared/transportLimits.js';
import { groundedPriceUnitBasis } from './priceUnitBasis.js';
import { isDeepStrictEqual } from 'node:util';
import { deriveHistorySources } from './historySources.js';
import { VALIDATED_REPLY_BYTES } from '../shared/transportLimits.js';
import { z } from 'zod';
import { STAGE_IDS, TOOL_IDS } from '../shared/modules.js';
import type { AssistantReply, ChatRequest, ExternalEvidence } from '../shared/types.js';
import { invalidResponse, ServiceError } from './errors.js';
import { chatMemorySchema } from '../shared/memory.js';
import { groundCoverage } from './coverage.js';
import { coreContextSchema, coreReplyShape, validCoreRequest, validatePatchEnvelope, validateMemoryValue, groundedQuantities, CoreMemoryError, validateAcceptedScopes, stripGroundedReadDates, stripLabelledReadTitles, stripGroundedReadEntityNames } from '../shared/coreValidation.js';
const bounded = (max: number) => z.string().max(max);
const id = z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/);
const moduleId = z.enum([...STAGE_IDS, ...TOOL_IDS] as [string, ...string[]]);
const url = bounded(2048).refine(value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } });
const date = bounded(40).refine(value => /^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10));
const factShape = { key: z.string().min(1).max(100), value: bounded(2000), note: bounded(2000), sourceUrl: url.optional(), checkedAt: date.optional() };
const fact = z.strictObject({ ...factShape, provenance: z.enum(['user', 'hypothesis', 'calculation', 'unknown', 'verified']) }).refine(value => value.provenance !== 'verified' || Boolean(value.sourceUrl && value.checkedAt));
export const requestSchema = z.strictObject({
  contractVersion: z.literal(2).optional(), coreContext: coreContextSchema.optional(),
  requestId: id, projectId: id, moduleId, intent: z.enum(['message', 'draft', 'start']), message: bounded(8000),
  context: z.strictObject({
    name: bounded(160), description: bounded(6000), facts: z.array(fact).max(100),
    currentDraft: z.strictObject({title:z.string().max(200),body:z.string().max(ASSISTANT_TEXT_CHARS)}).optional(),
    artifacts: z.array(z.strictObject({ moduleId, title: bounded(200), body: bounded(ASSISTANT_TEXT_CHARS), stale: z.boolean(), provenance: z.literal('assistant_proposal').optional() })).max(14),
    history: z.array(z.strictObject({ role: z.enum(['user', 'assistant']), content: bounded(8000) })).max(40),
    memories: z.array(z.strictObject({ moduleId, content: chatMemorySchema, updatedAt: date, needsRefresh: z.boolean().optional() })).max(14).optional(),
  }),
}).refine(value => value.intent !== 'message' || value.message.trim().length > 0).refine(value => validCoreRequest(value as ChatRequest));
const proposedFact = z.strictObject({ ...factShape, provenance: z.enum(['user', 'hypothesis', 'calculation', 'unknown']) });
export const replySchema = z.strictObject({
  calculationScenario: calculationScenarioSchema.nullable().optional(),
  ...coreReplyShape,
  message: z.string().trim().min(1).max(ASSISTANT_TEXT_CHARS),
  choices: z.array(z.strictObject({ id: z.string().min(1).max(80), label: z.string().min(1).max(160), description: bounded(500), recommended: z.boolean().optional() })).max(4)
    .refine(choices => choices.filter(choice => choice.recommended).length <= 1, 'Рекомендуется не более одного варианта.'),
  artifactDraft: z.strictObject({ title: z.string().min(1).max(200), body: z.string().min(1).max(ASSISTANT_TEXT_CHARS) }).nullable(),
  proposedFacts: z.array(proposedFact).max(30),
  memory: chatMemorySchema.optional(),
}).refine(value => new Set(value.choices.map(choice => choice.id)).size === value.choices.length);
export interface SafeValidationIssue { path: (string | number)[]; rule: string }
export class ReplyValidationError extends ServiceError {
  readonly validationIssue: SafeValidationIssue & { relatedIssues?: SafeValidationIssue[] };
  constructor(path: (string | number)[], rule: string) {
    const error = invalidResponse();
    super(error.code, error.message, error.status, error.retryable, error.knownUnspent);
    this.validationIssue = { path, rule };
  }
}
function reject(path: (string | number)[], rule: string): never { throw new ReplyValidationError(path, rule); }

export function validateReply(value: unknown, request: ChatRequest, trustedEvidence: ExternalEvidence[] = []): AssistantReply {
  const controls = invalidControlPath(value);
  if (controls) reject(controls, 'invalid_control_character');
  if (Buffer.byteLength(JSON.stringify(value) || '', 'utf8') > VALIDATED_REPLY_BYTES) reject([], 'reply_byte_limit');
  const parsed = replySchema.safeParse(value);
  if (!parsed.success) reject(parsed.error.issues[0].path.filter((part): part is string | number => typeof part !== 'symbol'), `schema_${parsed.error.issues[0].code}`);
  for (const [index, source] of (parsed.data.externalSources ?? []).entries()) {
    if (source.projectId !== request.projectId || !trustedEvidence.some(item => JSON.stringify(item) === JSON.stringify(source))) reject(['externalSources', index], 'untrusted_evidence');
  }
  for (const [index, ref] of (parsed.data.recoveredSourceRefs ?? []).entries()) {
    const source=parsed.data.externalSources?.find(item=>item.id===ref.id&&item.version===ref.version);
    if(!request.coreContext || !source || source.retrieval!=='read' || source.moduleId!==request.moduleId || source.generation!==request.coreContext.generation || source.requestId===request.requestId) reject(['recoveredSourceRefs',index],'invalid_recovered_evidence');
  }
  if (parsed.data.historySources !== undefined && !isDeepStrictEqual(parsed.data.historySources, deriveHistorySources(request, parsed.data))) reject(['historySources'], 'untrusted_history_source');
  // Independent failures are bounded, contain no source values, and never
  // authorize a partially valid reply. Each claim stops at its first issue.
  const issues: SafeValidationIssue[] = [];
  const capture = (check: () => void): void => {
    try { check(); } catch (error) {
      if (!(error instanceof ReplyValidationError)) throw error;
      if (issues.length < 10) issues.push(error.validationIssue);
    }
  };
  for (const [index, claim] of (parsed.data.externalClaims ?? []).entries()) capture(() => {
    const path = ['externalClaims', index];
    const source = trustedEvidence.find(item => item.id === claim.evidenceId && item.version === claim.version && item.projectId === request.projectId && item.retrieval === 'read');
    const quote = source?.quotes.find(item => item.id === claim.quoteId)?.text;
    if (!quote || !source) reject([...path, 'quoteId'], 'missing_read_quote');
    // A labelled retrieval date is grounded by server metadata, never by the
    // page's text. It must not authorize an effective date or an extra price.
    const datedClaim = stripGroundedReadDates(claim.text, new Set([source.retrievedAt.slice(0,10)]));
    if (datedClaim === null) reject([...path, 'text'], 'read_date_mismatch');
    const contentClaim=stripLabelledReadTitles(datedClaim.replace(/(?:точное название|заголовок) страницы:?\s*«([^»]+)»/giu,(_whole,title:string)=>{
      if (title !== source.title) reject([...path, 'text'], 'source_title_mismatch');
      return '';
    }), new Set([source.title]));
    if (!groundedQuantities(stripGroundedReadEntityNames(contentClaim, source), quote)) reject([...path, 'text'], 'ungrounded_quantity');
    if (claim.price) {
      const price = claim.price;
      if (!/\d/.test(price.amount)) reject([...path, 'price', 'amount'], 'non_numeric_price_amount');
      if (!price.amount.trim() || !groundedQuantities(price.amount, quote)) reject([...path, 'price', 'amount'], 'ungrounded_amount');
      for (const field of ['currency', 'unit', 'period', 'paymentTerms'] as const) if (!groundedTerm(price[field], quote)) reject([...path, 'price', field], 'ungrounded_price_term');
      if (!groundedPriceUnitBasis(price, quote)) reject([...path, 'price', 'unit'], 'ungrounded_price_unit_basis');
    }
  });
  const memoryPatch = parsed.data.memoryPatch;
  if (memoryPatch) capture(() => {
    try {
      validatePatchEnvelope(memoryPatch, request);
      const patch = memoryPatch, context = request.coreContext!;
      const seen = new Set<string>();
      for (const [index, operation] of patch.operations.entries()) {
        const id = operation.op === 'revise' ? operation.id : operation.localId;
        if (seen.has(id)) reject(['memoryPatch', 'operations', index, operation.op === 'revise' ? 'id' : 'localId'], 'duplicate_operation'); seen.add(id);
        const previous = operation.op === 'revise' ? context.entries.find(entry => entry.id === operation.id && context.currentEntryRefs.some(ref => ref.id === entry.id && ref.version === entry.version)) : undefined;
        if (operation.op === 'revise' && (!previous || previous.version !== operation.expectedVersion)) reject(['memoryPatch', 'operations', index, 'expectedVersion'], 'stale_entry_version');
        try { validateMemoryValue(operation.value, context, patch, trustedEvidence, previous); }
        catch (error) {
          if (!(error instanceof CoreMemoryError)) throw error;
          reject(['memoryPatch', 'operations', index, 'value', ...error.validationPath], error.validationRule);
        }
      }
      const revised = new Set(patch.operations.flatMap(operation => operation.op === 'revise' ? [operation.id] : []));
      validateAcceptedScopes([
        ...context.entries.filter(entry => !revised.has(entry.id) && context.currentEntryRefs.some(ref => ref.id === entry.id && ref.version === entry.version)),
        ...patch.operations.map(operation => operation.value),
      ]);
    } catch (error) {
      if (error instanceof ReplyValidationError) throw error;
      if (!(error instanceof CoreMemoryError || error instanceof ServiceError)) throw error;
      reject(['memoryPatch'], 'invalid_patch_envelope');
    }
  });
  // The model may only repeat URLs supplied by the user. A URL is not proof of reading it.
  const prosePath = (path: (string | number)[]) => {
    const field = path.at(-1), parent = path.at(-2);
    return typeof field === 'string' && ['message','description','content','text','value','note','quote','body'].includes(field)
      || typeof field === 'number' && ['hypotheses','openQuestions'].includes(String(parent));
  };
  const urlTokens = (text: string, prose: boolean) => [...text.matchAll(/https?:\/\/[^\s<>"\\)\]]+/g)].map(match => {
    const raw = match[0], before = text.slice(0, match.index);
    const explicit = /(?:\]\(\s*|<)$/u.test(before) || /^\s{0,3}\[[^\]]+\]:\s*$/u.test(before.split('\n').at(-1)!);
    const codeDelimiter = before.match(/(`+)$/u)?.[1];
    const unpunctuated = raw.replace(/[.,;:!?]+$/u, '');
    const codeEnd = codeDelimiter && unpunctuated.endsWith(codeDelimiter) && !unpunctuated.slice(0, -codeDelimiter.length).endsWith('`');
    const literal = prose && !explicit && codeEnd ? unpunctuated.slice(0, -codeDelimiter!.length) : raw;
    return { raw, citation: prose && !explicit ? literal.replace(/[.,;:!?]+$/u, '') : raw };
  });
  const provided = new Set(trustedEvidence.map(item => item.url));
  const collectProvided = (value: unknown, path: (string | number)[] = []): void => {
    if (typeof value === 'string') for (const token of urlTokens(value, prosePath(path))) {
      provided.add(token.raw); provided.add(token.citation);
    }
    if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) collectProvided(item, [...path, Array.isArray(value) ? Number(key) : key]);
  };
  // User prose and reply prose share tokenization. Structured url/sourceUrl
  // fields retain their exact literal; none of these aliases proves a read.
  collectProvided(request);
  collectProvided(trustedEvidence);
  const checkUrls = (value: unknown, path: (string | number)[] = []): void => {
    if (typeof value === 'string' && urlTokens(value, prosePath(path)).some(token => !provided.has(token.raw) && !provided.has(token.citation))) capture(() => reject(path, 'unprovided_url'));
    if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) checkUrls(item, [...path, Array.isArray(value) ? Number(key) : key]);
  };
  checkUrls(parsed.data);
  if (issues.length) {
    const error = new ReplyValidationError(issues[0].path, issues[0].rule);
    if (issues.length > 1) error.validationIssue.relatedIssues = issues.slice(1);
    throw error;
  }
  if (parsed.data.memory) {
    // Only user utterances or earlier grounded memory support a remembered fact.
    // Unsupported extraction must not break the useful conversational answer.
    const normalize = (text: string) => text.toLocaleLowerCase('ru').replace(/\s+/g, ' ').trim();
    const evidence = [request.message, request.context.description,
      ...request.context.history.filter(item => item.role === 'user').map(item => item.content),
      ...(request.context.memories ?? []).filter(item => !item.needsRefresh).flatMap(item => item.content.facts.map(fact => fact.evidence)),
    ].map(normalize);
    parsed.data.memory.facts = parsed.data.memory.facts.filter(fact => evidence.some(text => text.includes(normalize(fact.evidence))));
    if (parsed.data.memory.coverage) {
      const coverage = groundCoverage(parsed.data.memory.coverage, request, parsed.data, trustedEvidence);
      if (coverage) parsed.data.memory.coverage = coverage;
      else delete parsed.data.memory.coverage;
    }
  }
  return parsed.data;
}

function invalidControlPath(value: unknown, path: (string | number)[] = []): (string | number)[] | null {
  if (typeof value === 'string') return /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value) ? path : null;
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const result = invalidControlPath(child, [...path, Array.isArray(value) ? Number(key) : key]);
      if (result) return result;
    }
  }
  return null;
}

// A finite vocabulary of equivalent spellings, not unrestricted translation or
// entailment. Unrecognized paraphrases must use source wording (or unknown).
function groundedTerm(value: string, quote: string): boolean {
  const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
  const term = normalize(value), source = normalize(quote);
  if (['unknown', 'неизвестно', 'не указано', 'не указаны', 'не указана', 'неизвестны'].includes(term)) return true;
  if (!term) return false;
  // Punctuation can join exact source clauses; every clause must independently
  // occur in this same quote. Never fill a missing clause from another quote.
  const clauses=term.split(';').map(item=>item.trim());
  if(clauses.length>1)return clauses.every(clause=>clause.length>0&&groundedTerm(clause,quote));
  if (source.includes(term)) return true;
  const groups = [
    ['₽', 'руб', 'рублей', 'рубля', 'рубль', 'rub', 'rur'],
    ['€', 'eur', 'евро', 'eur.'], ['$', 'usd', 'доллар', 'долларов'],
    ['пользователь', 'пользователя', 'пользователей', 'user', 'users'],
    ['сотрудник', 'сотрудника', 'сотрудников', 'employee', 'employees'],
    ['месяц', 'в месяц', 'мес', 'мес.', 'month', 'monthly', 'per month'],
    ['год', 'в год', 'year', 'annual', 'annually', 'per year'],
    ['компания', 'компанию', 'компании', 'company'],
  ];
  const equivalent = groups.find(group => group.includes(term));
  // Bound words so e.g. USD does not match an unrelated identifier, and a
  // monthly period cannot be grounded by a word merely containing "мес".
  return Boolean(equivalent?.some(alias => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\d])${escaped}(?![\\p{L}\\d])`, 'iu').test(source);
  }));
}
