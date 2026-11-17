import { expect, test } from 'vitest';
import type OpenAI from 'openai';
import supertest from 'supertest';
import { createApp } from '../../server/app';
import { loadConfig, configurationReason, searchConfigurationReason } from '../../server/config';
import { OpenAIProvider, estimateMaxCost, estimateInitialCost, usageCost } from '../../server/provider';
import { BudgetLedger, hash, type OperationEvent } from '../../server/ledger';
import { evaluationInput, acceptEvaluation } from '../../server/evaluator';
import { SKILL_CATALOGUE, loadTopicSkill, stageSkillId } from '../../server/skills';
import { TOPIC_CRITERIA } from '../../shared/coverage';
import { PROCESS_CHECK_IDS } from '../../shared/review';
import type { AssistantReply, ChatRequest, TopicCoverage } from '../../shared/types';

const request: ChatRequest = { requestId: 'judge-request-01', projectId: 'judge-project-01', moduleId: 'idea', intent: 'message',
  message: 'Управляющий вручную собирает пожелания сотрудников по выходным.',
  context: { name: 'Test', description: '', facts: [], artifacts: [], history: [] } };
const config = loadConfig({ OPENAI_API_KEY: 'synthetic-placeholder', AI_BUDGET_USD: '15', OPENAI_MODEL: 'gpt-6.1-sol', AI_EVALUATOR_MODEL: 'gpt-6.1-sol' });
const candidate: AssistantReply = { message: 'Можно начать со сбора пожеланий. Сотрудник указывает выходные, управляющий видит ответы. Выберем только сбор?', choices: [], artifactDraft: null, proposedFacts: [], memory: { facts: [], hypotheses: [], openQuestions: [] } };
function coverage(): TopicCoverage {
  return { rubricVersion: 1, moduleId: 'idea', items: TOPIC_CRITERIA.idea.map(item => ({ id: item.id, status: 'missing', note: 'Ещё не обсуждено.', support: null })), nextCriterionId: 'situation' };
}
function evaluation() {
  return { coverage: coverage(), process: { status: 'passed', note: 'Предложена гипотеза и понятный выбор.',
    checks: PROCESS_CHECK_IDS.map(id => ({ id, status: 'passed', reason: 'Помощь соответствует доступным вводным.' })) },
    result: { status: 'in_progress', note: 'Нужно выбрать границы решения.' }, nextAction: 'Помочь выбрать границы решения.' };
}
const response = (value: unknown, output: unknown[] = []) => ({ status: 'completed', error: null, output, output_text: JSON.stringify(value), usage: { input_tokens: 100, output_tokens: 100 } }) as unknown as OpenAI.Responses.Response;

test('all topic packages contain full canonical criteria, methods and distinct workflows; arbitrary paths cannot be loaded', () => {
  expect(SKILL_CATALOGUE).toHaveLength(14);
  for (const entry of SKILL_CATALOGUE) {
    const skill = loadTopicSkill(entry.id);
    expect(skill.criteria).toEqual(TOPIC_CRITERIA[skill.moduleId as keyof typeof TOPIC_CRITERIA]);
    for (const method of new Set(skill.criteria.flatMap(item => item.methods))) expect(skill.methods.some(item => item.id === method)).toBe(true);
    expect(skill.methods.every(item => item.body.length > 500)).toBe(true);
  }
  expect(() => loadTopicSkill('../../.env')).toThrow();
  expect(new Set(SKILL_CATALOGUE.map(skill => loadTopicSkill(skill.id).instructions)).size).toBe(14);
});

test('the judge sees actual context and answer, without author scores or previous judge verdicts', () => {
  const own = { ...request, context: { ...request.context, memories: [{ moduleId: 'idea' as const, updatedAt: '2026-11-16T10:00:00Z',
    content: { facts: [], hypotheses: [], openQuestions: [], coverage: { ...coverage(), items: coverage().items.map(item => ({ ...item, note: 'AUTHOR_SCORE_MARKER' })) } } }] } };
  const input = evaluationInput(own, { ...candidate, diagnostics: { elapsedMs: 99999 }, memory: own.context.memories[0].content }, [], [loadTopicSkill(stageSkillId('idea'))]);
  const value = JSON.parse(input);
  expect(input).not.toContain('AUTHOR_SCORE_MARKER');
  expect(value.candidate).not.toHaveProperty('diagnostics');
  expect(value.candidate).not.toHaveProperty('memory');
  expect(value.context.memories[0].content).not.toHaveProperty('coverage');
  expect(value.message).toBe(request.message);
});

test('the independent verdict replaces author coverage and cannot accept a proposed choice or fabricated support', () => {
  const value = evaluation();
  const choice = value.coverage.items.find(item => item.id === 'scope')!;
  Object.assign(choice, { status: 'covered', support: { role: 'assistant', quote: 'Выберем только сбор?' } });
  Object.assign(value.coverage.items[0], { status: 'covered', support: { role: 'user', quote: 'Выдуманная цитата' } });
  value.coverage.nextCriterionId = 'problem';
  value.result.status = 'ready';
  const checked = acceptEvaluation(JSON.stringify(value), request, candidate, [], 'subject', config.model);
  expect(checked.coverage.items[0].status).toBe('missing');
  expect(checked.coverage.items.find(item => item.id === 'scope')!.status).toBe('partial');
  expect(checked.review.result!.status).toBe('in_progress');
  expect(checked.review.subjectHash).toBe(hash('subject'));
});

test('a failed process check overrides a contradictory passed summary; an incomplete stage alone does not fail good help', () => {
  const value = evaluation();
  value.process.checks[1].status = 'failed'; value.result.status = 'ready';
  const checked = acceptEvaluation(JSON.stringify(value), request, candidate, [], 'subject', config.model);
  expect(checked.review.process!.status).toBe('needs_work');
  expect(checked.review.result!.status).toBe('needs_work');
  expect(acceptEvaluation(JSON.stringify(evaluation()), request, candidate, [], 'subject', config.model).review.process!.status).toBe('passed');
  const duplicated = evaluation(); duplicated.process.checks[1] = duplicated.process.checks[0];
  expect(() => acceptEvaluation(JSON.stringify(duplicated), request, candidate, [], 'subject', config.model)).toThrow();
});

test('the model can invoke an additional skill once; full tool output reaches generation and the separate judge', async () => {
  const sent: OpenAI.Responses.ResponseCreateParamsNonStreaming[] = [], events: OperationEvent[] = [];
  const provider = new OpenAIProvider(config, { transport: async params => {
    sent.push(params);
    if (sent.length === 1) return { ...response(null), output_text: '', output: [{ type: 'function_call', name: 'load_topic_skill', call_id: 'call-interview', arguments: JSON.stringify({ skillIds: ['topic-interview'] }) }] } as never;
    if (sent.length === 2) return response({ action: 'answer', query: '' });
    if (sent.length === 3) return response(candidate);
    return response(evaluation());
  } });
  const ledger = new BudgetLedger(':memory:', config);
  try {
    const owner = ledger.session(ledger.createSession())!;
    const admitted = ledger.reserve(owner, request.requestId, hash(JSON.stringify(request)), estimateInitialCost(request, config), 'test', true);
    if (admitted.kind !== 'reserved') throw new Error('Expected reservation');
    const result = await provider.complete(request, new AbortController().signal, undefined, { onOperation: event => { events.push(event); ledger.recordOperation(admitted.reservation, event); } });
    expect(sent).toHaveLength(4);
    expect((sent[1].input as Array<{ type: string }>).some(item => item.type === 'function_call_output')).toBe(true);
    expect(JSON.parse(String(sent[2].input)).topicSkills.map((skill: { id: string }) => skill.id)).toEqual(['topic-idea', 'topic-interview']);
    expect(JSON.parse(String(sent[3].input)).candidate).not.toHaveProperty('memory');
    expect(JSON.parse(String(sent[3].input)).researchRuntime).toMatchObject({ searchAvailable: true, action: 'answer',
      operations: expect.arrayContaining([expect.objectContaining({id:'generate',kind:'generate',state:'completed'})]) });
    expect(result.reply.memory!.review!.status).toBe('completed');
    expect(result.reply.memory!.coverage).toEqual(evaluation().coverage);
    expect(events.filter(event => event.kind === 'evaluate')).toHaveLength(2);
    expect(events.filter(event => event.kind === 'skill')).toHaveLength(2);
    expect(result.usage).toEqual({ inputTokens: 400, outputTokens: 400 });
    const cheap=loadConfig({OPENAI_API_KEY:'test-placeholder',OPENAI_MODEL:'gpt-6-luna'});
    expect(result.costUsd).toBeCloseTo(2 * usageCost({ inputTokens: 100, outputTokens: 100 }, cheap)+2 * usageCost({ inputTokens: 100, outputTokens: 100 }, config), 10);
    ledger.complete(admitted.reservation, result.costUsd!, { requestId: request.requestId, model: config.model, reply: result.reply });
    expect(ledger.reserve(owner, request.requestId, hash(JSON.stringify(request)), estimateMaxCost(request, config)).kind).toBe('cached');
  } finally { ledger.close(); }
});

test('an unavailable judge preserves the answer; only a completed invalid judgment gets one bounded repair', async () => {
  for (const failure of ['network', 'schema', 'invalid_quote', 'untrusted_url']) {
    let calls = 0;
    const provider = new OpenAIProvider(config, { transport: async () => {
      calls++;
      if (calls === 1) return response({ action: 'answer', query: '' });
      if (calls === 2) return response({ ...candidate, memory: { ...candidate.memory, coverage: coverage() } });
      if (failure === 'network') throw new Error('secret provider detail');
      const value = evaluation();
      if (failure === 'schema') return response({ coverage: coverage() });
      if (failure === 'invalid_quote') { value.coverage.items[0].status = 'covered'; value.coverage.items[0].support = null; }
      if (failure === 'untrusted_url') value.result.note = 'См. https://invented.example/secret';
      return response(value);
    } });
    const result = await provider.complete(request, new AbortController().signal);
    expect(calls).toBe(failure==='network'?3:4);
    expect(result.reply.message).toBe(candidate.message);
    expect(result.reply.memory!.coverage).toBeUndefined();
    expect(result.reply.memory!.review).toMatchObject({ status: 'unavailable', process: null, result: null });
    expect(JSON.stringify(result.reply)).not.toContain('secret provider detail');
  }
});

test('the normal HTTP boundary includes reviewer output allowance, charges all calls and caches the reviewed envelope', async () => {
  let calls = 0;
  const provider = new OpenAIProvider(config, { transport: async params => {
    calls++;
    return response(params.text?.format?.type === 'json_schema' && params.text.format.name === 'cofounder_action'
      ? { action: 'answer', query: '' } : calls === 2 ? candidate : evaluation());
  } });
  const ledger = new BudgetLedger(':memory:', config), app = createApp({ config, provider, ledger });
  try {
    const agent = supertest.agent(app); await agent.get('/api/status');
    const first = await agent.post('/api/chat').set('Origin', config.origin).send(request);
    expect(first.status).toBe(200);
    expect(first.body.reply.memory.review.status).toBe('completed');
    const again = await agent.post('/api/chat').set('Origin', config.origin).send(request);
    expect(again.status).toBe(200); expect(again.body).toEqual(first.body); expect(calls).toBe(3);
  } finally { ledger.close(); }
});

test('Sol has verified rates, research keeps its priced Luna role, and unknown reviewer rates disable unsafe configuration', () => {
  expect(configurationReason(config)).toBe('');
  expect(searchConfigurationReason(config)).toBe('');
  expect(config).toMatchObject({ inputPricePerMillion: 2, outputPricePerMillion: 10, evaluator: { model: 'gpt-6.1-sol' } });
  expect(usageCost({ inputTokens: 300000, outputTokens: 1000 }, config)).toBeCloseTo(1.215);
  expect(configurationReason(loadConfig({ OPENAI_API_KEY: 'test', AI_BUDGET_USD: '15', AI_EVALUATOR_MODEL: 'unknown' }))).toContain('AI_EVALUATOR_INPUT');
});

test('a reviewer-specific deadline preserves the completed answer and accounts its unknown cost without retry', async () => {
  // Keep headroom for synchronous prompt/validation work under a busy test
  // worker. The review margin still makes only the review deadline immediate.
  const short = { ...config, timeoutMs: 1000 };
  let calls = 0;
  const events: OperationEvent[] = [];
  const provider = new OpenAIProvider(short, { transport: async (_params, signal) => {
    calls++;
    if (calls === 1) return response({ action: 'answer', query: '' });
    if (calls === 2) return response(candidate);
    return new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  } });
  const result = await provider.complete(request, new AbortController().signal, undefined, { onOperation: event => events.push(event) });
  expect(calls).toBe(3);
  expect(result.reply.message).toBe(candidate.message);
  expect(result.reply.memory!.review).toMatchObject({ status: 'unavailable', errorCode: 'EVALUATION_TIMEOUT' });
  expect(result.reply.memory!.coverage).toBeUndefined();
  const started = events.find(event => event.kind === 'evaluate' && event.state === 'started')!;
  const finished = events.find(event => event.kind === 'evaluate' && event.state === 'unknown')!;
  expect(finished.chargedUsd).toBe(started.reservedUsd);
  expect(result.costUsd).toBeGreaterThanOrEqual(finished.chargedUsd!);
});

test('an independent judge eliminates discarded author assessment while keeping criteria as the dialogue goal', async () => {
  for (const independent of [true, false]) {
    const sent: OpenAI.Responses.ResponseCreateParamsNonStreaming[] = [];
    const progress: string[] = [];
    const provider = new OpenAIProvider({ ...config, evaluator: independent ? config.evaluator : undefined }, { transport: async (params, _signal, onText, onMessageComplete) => {
      sent.push(params);
      if (sent.length === 1) return response({ action: 'answer', query: '' });
      if (sent.length === 2) {
        onText?.(candidate.message); onMessageComplete?.();
        return response(candidate);
      }
      return response(evaluation());
    } });
    const result = await provider.complete(request, new AbortController().signal, () => {}, { onProgress: event => progress.push(event.phase) });
    const generation = sent[1];
    const format = generation.text?.format;
    if (format?.type !== 'json_schema') throw new Error('Expected structured reply schema.');
    const schema = format.schema as { properties: { memory: { properties: Record<string, unknown>; required: string[] } } };
    expect('coverage' in schema.properties.memory.properties).toBe(!independent);
    expect(schema.properties.memory.required.includes('coverage')).toBe(!independent);
    expect(JSON.parse(String(generation.input)).contextCoverage.criteria).toEqual(TOPIC_CRITERIA.idea);
    expect(generation.instructions).toContain(independent ? 'Не возвращай memory.coverage' : 'В memory.coverage верни');
    expect(progress).toContain('finalizing');
    expect(progress.includes('reviewing')).toBe(independent);
    expect(sent).toHaveLength(independent ? 3 : 2);
    if (independent) expect(result.reply.memory!.review!.status).toBe('completed');
  }
});


test('ready depends on covered content, not a visible card or a manual save', () => {
  const value = evaluation();
  value.coverage.items = value.coverage.items.map(item => ({ ...item, status: 'covered', support: { role: 'user', quote: request.message } }));
  value.coverage.nextCriterionId = null;
  value.result.status = 'ready';
  const checked = acceptEvaluation(JSON.stringify(value), request, candidate, [], 'subject', config.model);
  expect(checked.review.result!.status).toBe('ready');
  expect(candidate.artifactDraft).toBeNull();
});
