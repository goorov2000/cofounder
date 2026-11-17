import { afterEach, expect, it, vi } from 'vitest';
import { ApiRequestError, assertRequestFits, sendChat } from '../../src/lib/api';
import type { ChatRequest } from '../../shared/types';
import { HTTP_REQUEST_BYTES } from '../../shared/transportLimits';

const makeRequest = (): ChatRequest => ({ requestId: 'preflight-request', projectId: 'preflight-project', moduleId: 'idea', intent: 'message', message: 'Уточнить концепцию', context: { name: 'Учебная мастерская', description: '', facts: [], artifacts: [], history: [] } });
afterEach(() => vi.unstubAllGlobals());

it('distinguishes a small invalid field from a request that exceeds the byte limit, without sending or exposing project contents', async () => {
  const request = makeRequest();
  request.context.description = 'PRIVATE_DESCRIPTION_'.repeat(400);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  try { await sendChat(request); throw new Error('Expected preflight rejection'); }
  catch (error) {
    expect(error).toBeInstanceOf(ApiRequestError);
    const failure = error as ApiRequestError;
    expect(failure.code).toBe('INVALID_REQUEST_CONTEXT');
    expect(failure.message).toContain('а не ограничение длины');
    expect(failure.diagnostics!.bytes).toBeLessThan(failure.diagnostics!.limitBytes);
    expect(failure.diagnostics!.issues).toContainEqual({ path: ['context', 'description'], code: 'too_big' });
    const diagnostic = JSON.stringify(failure.diagnostics);
    for (const privateText of [request.context.description, 'PRIVATE_DESCRIPTION_', request.projectId, request.requestId, request.message]) expect(diagnostic).not.toContain(privateText);
  }
  expect(fetch).not.toHaveBeenCalled();
});

it('reports the measured byte limit and preserves all oversized input instead of trimming it', () => {
  const request = makeRequest();
  request.context.history = Array.from({ length: 40 }, () => ({ role: 'assistant' as const, content: 'Я'.repeat(8000) }));
  request.context.artifacts = Array.from({ length: 10 }, () => ({ moduleId: 'idea', title: 'Черновик', body: 'Я'.repeat(24000), stale: false }));
  const before = structuredClone(request);
  try { assertRequestFits(request); throw new Error('Expected oversized request'); }
  catch (error) {
    const failure = error as ApiRequestError;
    expect(failure.code).toBe('CONTEXT_LIMIT');
    expect(failure.diagnostics!.bytes).toBe(new TextEncoder().encode(JSON.stringify(request)).byteLength);
    expect(failure.diagnostics!.sections.history).toBeGreaterThan(128 * 1024);
    expect(failure.diagnostics!.issues).toEqual([]);
    expect(failure.message).toContain(`${HTTP_REQUEST_BYTES / 1024} КБ`);
  }
  expect(request).toEqual(before);
});
