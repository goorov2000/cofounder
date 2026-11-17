import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BudgetLedger } from '../../server/ledger.js';
import { ServiceError } from '../../server/errors.js';
const response = { requestId: 'request-0001', model: 'test', reply: { message: 'Result', choices: [], artifactDraft: null, proposedFacts: [] } };

it('keeps atomic money totals across database connections, crashes, unknown outcomes and cache expiration', () => {
  let now = 1000;
  const directory = mkdtempSync(path.join(tmpdir(), 'cofounder-money-'));
  const filename = path.join(directory, 'ledger.sqlite');
  const options = { budgetUsd: 1, maxConcurrent: 10, sessionConcurrent: 10, now: () => now, responseTtlMs: 100, timeoutMs: 10 };
  const first = new BudgetLedger(filename, options);
  const second = new BudgetLedger(filename, options);
  try {
    expect(first.reserve('owner-one', 'request-0001', 'body-one', 0.7).kind).toBe('reserved');
    expect(() => second.reserve('owner-two', 'request-0002', 'body-two', 0.4)).toThrow(expect.objectContaining({ code: 'BUDGET_EXHAUSTED' }));
    expect(second.reserve('owner-two', 'request-0002', 'body-two', 0.3).kind).toBe('reserved');
    first.complete({ session: 'owner-one', requestId: 'request-0001' }, 0.1, response);
    second.fail({ session: 'owner-two', requestId: 'request-0002' }, false, new ServiceError('AI_TIMEOUT', 'Timeout', 504));
    // 0.1 definite + 0.3 potentially spent leaves exactly 0.6, not 0.9.
    expect(() => first.reserve('owner-three', 'request-0003', 'body-three', 0.600000001)).toThrow(expect.objectContaining({ code: 'BUDGET_EXHAUSTED' }));
    expect(first.reserve('owner-three', 'request-0003', 'body-three', 0.6).kind).toBe('reserved');
    expect(first.reserve('owner-one', 'request-0001', 'body-one', 0.7)).toMatchObject({ kind: 'cached', body: response });
  } finally { first.close(); second.close(); }
  now += 6000;
  const restarted = new BudgetLedger(filename, options);
  try {
    expect(() => restarted.reserve('owner-three', 'request-0003', 'body-three', 0.6)).toThrow(expect.objectContaining({ code: 'OUTCOME_UNKNOWN' }));
    expect(() => restarted.reserve('owner-four', 'request-0004', 'body-four', 0.000000001)).toThrow(expect.objectContaining({ code: 'BUDGET_EXHAUSTED' }));
    expect(() => restarted.reserve('owner-one', 'request-0001', 'body-one', 0.7)).toThrow(expect.objectContaining({ code: 'REPLAY_EXPIRED' }));
    expect(() => restarted.reserve('owner-one', 'request-0001', 'changed', 0.7)).toThrow(expect.objectContaining({ code: 'REQUEST_CONFLICT' }));
  } finally { restarted.close(); rmSync(directory, { recursive: true, force: true }); }
});

it('bounds response cache while retaining tombstones, and permits explicit retries only after unbilled rejections', () => {
  const ledger = new BudgetLedger(':memory:', { budgetUsd: 1, maxCachedResponses: 1 });
  try {
    ledger.reserve('owner-one', 'request-0001', 'body-one', 1);
    ledger.fail({ session: 'owner-one', requestId: 'request-0001' }, true, new ServiceError('PROVIDER_RATE_LIMIT', 'Wait', 429, true, true));
    expect(ledger.reserve('owner-one', 'request-0001', 'body-one', 1).kind).toBe('reserved');
    ledger.complete({ session: 'owner-one', requestId: 'request-0001' }, 0.1, response);
    ledger.reserve('owner-one', 'request-0002', 'body-two', 0.9);
    ledger.complete({ session: 'owner-one', requestId: 'request-0002' }, 0.1, { ...response, requestId: 'request-0002' });
    expect(() => ledger.reserve('owner-one', 'request-0001', 'body-one', 1)).toThrow(expect.objectContaining({ code: 'REPLAY_EXPIRED' }));
  } finally { ledger.close(); }
});
