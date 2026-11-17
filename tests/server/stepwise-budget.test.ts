import { expect, it } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type OpenAI from 'openai';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { BudgetLedger, type OperationEvent, type Reservation } from '../../server/ledger.js';
import { OpenAIProvider, estimateMaxCost } from '../../server/provider.js';
import type { ChatRequest } from '../../shared/types.js';

const origin = 'http://localhost:3000';
const input: ChatRequest = { requestId: 'stepwise-request', projectId: 'stepwise-project', moduleId: 'idea', intent: 'message', message: 'Помоги развить идею', context: { name: 'Test', description: '', facts: [], artifacts: [], history: [] } };
const reply = { message: 'Разберём последний случай согласования смены: где возникла трудность?', choices: [], artifactDraft: null, proposedFacts: [], memoryOperations: [], externalClaims: [] };
const response = (value: unknown) => ({ status: 'completed', error: null, output: [], output_text: JSON.stringify(value), usage: { input_tokens: 100, output_tokens: 100 } }) as unknown as OpenAI.Responses.Response;
const config = (budget = 15) => loadConfig({ OPENAI_API_KEY: 'test-placeholder', OPENAI_MODEL: 'gpt-6.1-sol', AI_EVALUATOR_MODEL: 'gpt-6.1-sol', AI_BUDGET_USD: String(budget), DATA_DIR: '/unused-test-directory', APP_ORIGIN: origin });

it('finishes and caches a Sol turn with accumulated spend when a full-chain hold would reject it', async () => {
  const cfg = config(), ledger = new BudgetLedger(':memory:', cfg);
  const spent = 4.642941473;
  ledger.reserve('previous-owner', 'previous-request', 'previous-hash', spent);
  ledger.complete({ session: 'previous-owner', requestId: 'previous-request' }, spent, { requestId: 'previous-request', model: cfg.model, reply });
  const body = { ...input, context: { ...input.context, history: Array.from({ length: 32 }, (_, i) => ({ role: i % 2 ? 'assistant' as const : 'user' as const, content: 'Обсуждаем ситуацию с продавцом маркетплейса. '.repeat(34) })) } };
  expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(128 * 1024);
  expect(estimateMaxCost(body, cfg)).toBeGreaterThan(cfg.budgetUsd - spent);
  let calls = 0;
  const provider = new OpenAIProvider(cfg, { transport: async () => response(++calls === 1 ? { action: 'answer', query: '' } : reply) });
  const app = createApp({ config: cfg, ledger, provider });
  try {
    const agent = request.agent(app); await agent.get('/api/status');
    const first = await agent.post('/api/chat').set('Origin', origin).send(body);
    expect(first.status).toBe(200);
    expect(first.body.reply.message).toBe(reply.message);
    const cached = await agent.post('/api/chat').set('Origin', origin).send(body);
    expect(cached.body).toEqual(first.body);
    expect(calls).toBe(4); // plan + generation + malformed judgment + its one bounded repair; cache adds no calls.
  } finally { ledger.close(); }
});

it('rejects a later unaffordable step before transport and caches the already-paid outcome', async () => {
  const cfg = config(0.1), ledger = new BudgetLedger(':memory:', cfg);
  let calls = 0;
  const provider = new OpenAIProvider(cfg, { transport: async () => { calls++; return response({ action: 'answer', query: '' }); } });
  const app = createApp({ config: cfg, ledger, provider });
  try {
    const agent = request.agent(app); await agent.get('/api/status');
    const failed = await agent.post('/api/chat').set('Origin', origin).send(input);
    expect(failed.status).toBe(402);
    expect(failed.body.error).toMatchObject({ code: 'BUDGET_EXHAUSTED', retryable: false });
    expect(failed.body.error.message).toContain('доступно $');
    expect(failed.body.error.message).toContain('требуется резерв $');
    const cached = await agent.post('/api/chat').set('Origin', origin).send(input);
    expect(cached.body).toEqual(failed.body);
    expect(calls).toBe(1);
  } finally { ledger.close(); }
});

it('rejects usage outside the reserved payload bound without releasing unknown spend or retrying', async () => {
  const cfg = config(), ledger = new BudgetLedger(':memory:', cfg), events: OperationEvent[] = [];
  const admitted = ledger.reserve('owner', input.requestId, 'body', 0.1, 'ip', true);
  if (admitted.kind !== 'reserved') throw Error('Expected admission');
  let calls = 0;
  const provider = new OpenAIProvider(cfg, { transport: async () => {
    calls++;
    return { ...response({ action: 'answer', query: '' }), usage: { input_tokens: 250_000, output_tokens: 100 } } as OpenAI.Responses.Response;
  } });
  try {
    await expect(provider.complete(input, new AbortController().signal, undefined, { onOperation: event => { events.push(event); ledger.recordOperation(admitted.reservation, event); } })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(calls).toBe(1);
    expect(events.at(-1)).toMatchObject({ state: 'unknown', errorCode: 'INVALID_USAGE', chargedUsd: events[0].reservedUsd });
    const stored=ledger.readOperations(admitted.reservation)[0];
    expect(stored.state).toBe('unknown');
    expect(Number(stored.chargedUsd)).toBeGreaterThanOrEqual(events[0].reservedUsd!);
    expect(Number(stored.chargedUsd)-events[0].reservedUsd!).toBeLessThanOrEqual(1e-9); // Storage rounds up to integral nano-USD.
  } finally { ledger.close(); }
});

it('keeps a completed answer when only the judge cannot acquire its reservation', async () => {
  const cfg = config(), events: OperationEvent[] = [];
  let calls = 0;
  const provider = new OpenAIProvider(cfg, { transport: async () => response(++calls === 1 ? { action: 'answer', query: '' } : reply) });
  const result = await provider.complete(input, new AbortController().signal, undefined, { onOperation: event => events.push(event) });
  const judge = events.find(event => event.id === 'evaluate' && event.state === 'started')!;
  // Leave enough for the actual judge request alone, but not alongside a
  // concurrent reservation. Other owners share this same installation ceiling.
  const ledger = new BudgetLedger(':memory:', cfg);
  let reservation: Reservation | undefined;
  calls = 0;
  try {
    const admitted = ledger.reserve('owner', input.requestId, 'body', 0.1, 'ip', true);
    if (admitted.kind !== 'reserved') throw Error('Expected admission');
    reservation = admitted.reservation;
    const next = await provider.complete(input, new AbortController().signal, undefined, { onOperation: event => {
      if (event.id === 'evaluate' && event.state === 'started') ledger.reserve('other', 'concurrent-request', 'other-body', cfg.budgetUsd - result.costUsd! - judge.reservedUsd! / 2);
      ledger.recordOperation(reservation!, event);
    } });
    expect(next.reply.message).toBe(reply.message);
    expect(next.reply.memory?.review).toMatchObject({ status: 'unavailable', errorCode: 'BUDGET_EXHAUSTED' });
    expect(calls).toBe(2);
    expect(ledger.readOperations(reservation).some(event => event.kind === 'evaluate')).toBe(false);
  } finally { ledger.close(); }
});

it('releases only known unused reserves atomically across connections, preserving crash and replay accounting', () => {
  let now = 1000;
  const directory = mkdtempSync(path.join(tmpdir(), 'cofounder-stepwise-')), filename = path.join(directory, 'ledger.sqlite');
  const options = { budgetUsd: 1, maxConcurrent: 10, sessionConcurrent: 10, now: () => now, timeoutMs: 10 };
  const first = new BudgetLedger(filename, options), second = new BudgetLedger(filename, options);
  const start = (id: string, reservedUsd: number): OperationEvent => ({ id, kind: 'generate', inputHash: id, state: 'started', reservedUsd });
  let a: Reservation, b: Reservation;
  try {
    const reserveA = first.reserve('a', 'request-a', 'hash-a', 0.7, 'ip-a', true);
    if (reserveA.kind !== 'reserved') throw Error('Expected admission'); a = reserveA.reservation;
    first.recordOperation(a, start('plan', 0.7));
    first.recordOperation(a, { ...start('plan', 0.7), state: 'completed', chargedUsd: 0.1 });
    const reserveB = second.reserve('b', 'request-b', 'hash-b', 0.6, 'ip-b', true);
    if (reserveB.kind !== 'reserved') throw Error('Expected admission'); b = reserveB.reservation;
    second.recordOperation(b, start('unknown-step', 0.6));
    expect(() => first.recordOperation(a, start('answer', 0.300000001))).toThrow(expect.objectContaining({ code: 'BUDGET_EXHAUSTED' }));
    expect(first.readOperations(a)).toHaveLength(1);
    first.recordOperation(a, start('answer', 0.3));
    first.recordOperation(a, { ...start('answer', 0.3), state: 'completed', chargedUsd: 0.02 });
    first.complete(a, 0.12, { requestId: a.requestId, model: 'test', reply });
  } finally { first.close(); second.close(); }
  now += 6000;
  const restarted = new BudgetLedger(filename, options);
  try {
    expect(restarted.readOperations(b!)).toMatchObject([{ state: 'unknown', chargedUsd: 0.6 }]);
    expect(() => restarted.reserve('c', 'request-c', 'hash-c', 0.280000001)).toThrow(expect.objectContaining({ code: 'BUDGET_EXHAUSTED' }));
    expect(restarted.reserve('c', 'request-c', 'hash-c', 0.28).kind).toBe('reserved');
    expect(restarted.reserve('a', 'request-a', 'hash-a', 0.7).kind).toBe('cached');
    expect(() => restarted.reserve('b', 'request-b', 'hash-b', 0.6)).toThrow(expect.objectContaining({ code: 'OUTCOME_UNKNOWN' }));
  } finally { restarted.close(); rmSync(directory, { recursive: true, force: true }); }
});
