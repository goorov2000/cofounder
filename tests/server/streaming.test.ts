import { expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';
import { ServiceError } from '../../server/errors.js';
import type { Provider, ProviderResult } from '../../server/provider.js';
import type { ChatRequest } from '../../shared/types.js';

const origin = 'http://localhost:3000';
const reply = { message: 'Первый фрагмент, продолжение.', choices: [], artifactDraft: null, proposedFacts: [] };
const input: ChatRequest = { requestId: 'stream-test-001', projectId: 'project-stream-1', moduleId: 'idea', intent: 'message', message: 'Привет', context: { name: 'Тест', description: '', facts: [], artifacts: [], history: [] } };
async function serve(provider: Provider, run: (post: (id?: string) => Promise<Response>) => Promise<void>) {
  const app = createApp({ provider, config: { apiKey: 'test-placeholder', budgetUsd: 1, origin, ledgerPath: ':memory:' } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const status = await fetch(`${base}/api/status`);
  const cookie = status.headers.get('set-cookie')!.split(';')[0];
  try {
    await run((id = input.requestId) => fetch(`${base}/api/chat`, { method: 'POST', headers: { Origin: origin, Cookie: cookie, Accept: 'text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, requestId: id }) }));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); app.locals.close(); }
}

it('flushes a real HTTP preview before completion and reuses the paid result on retry', async () => {
  let finish!: (result: ProviderResult) => void;
  const complete = vi.fn<Provider['complete']>(async (_request, _signal, onText) => {
    onText?.('Первый фрагмент');
    return new Promise(resolve => { finish = resolve; });
  });
  await serve({ complete }, async post => {
    const response = await post();
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('Первый фрагмент')) text += decoder.decode((await reader.read()).value);
    expect(text).toContain('text.delta');
    expect(text).not.toContain('"complete"');
    expect((await (await post()).json()).error.code).toBe('REQUEST_PENDING');
    finish({ reply, usage: { inputTokens: 10, outputTokens: 20 } });
    while (true) { const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value); }
    const events = text.split('\n\n').filter(frame => frame.startsWith('data:')).map(frame => JSON.parse(frame.slice(6)));
    expect(events.at(-1)).toMatchObject({ type: 'complete', requestId: input.requestId, response: { reply } });
    const cached = await post();
    expect(cached.headers.get('content-type')).toContain('application/json');
    expect(await cached.json()).toEqual(events.at(-1).response);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

it('reports a midstream provider failure as an error event and blocks a duplicate paid call', async () => {
  const complete = vi.fn<Provider['complete']>(async (_request, _signal, onText) => {
    onText?.('Незавершённая мысль');
    throw new ServiceError('PROVIDER_NETWORK', 'Связь с AI прервана.');
  });
  await serve({ complete }, async post => {
    const text = await (await post()).text();
    expect(text).toContain('Незавершённая мысль');
    expect(text).toContain('"type":"error"');
    expect(text).not.toContain('"type":"complete"');
    const repeated = await (await post()).json();
    expect(repeated.error.code).toBe('PROVIDER_NETWORK');
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

it('keeps the first preview during repairs and research, then delivers only the validated replacement', async () => {
  const complete = vi.fn<Provider['complete']>(async (_request, _signal, onText, execution) => {
    onText?.('Первоначальное сравнение');
    for (const candidate of ['Исправленный черновик', 'Дополнительная проверка', 'Последнее уточнение']) {
      execution?.onTextReset?.();
      execution?.onProgress?.({ phase: 'composing', message: 'Уточняю сравнение по источникам…' });
      onText?.(candidate);
    }
    return { reply, usage: { inputTokens: 10, outputTokens: 20 } };
  });
  await serve({ complete }, async post => {
    const text = await (await post()).text();
    const events = text.split('\n\n').filter(frame => frame.startsWith('data:')).map(frame => JSON.parse(frame.slice(6)));
    expect(events.filter(event => event.type === 'text.delta').map(event => event.delta)).toEqual(['Первоначальное сравнение']);
    expect(events.some(event => event.type === 'text.reset')).toBe(false);
    expect(events.filter(event => event.type === 'progress')).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ type: 'complete', response: { reply } });
    expect((await (await post()).json()).reply).toEqual(reply);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

it('aborts the provider on client disconnect without allowing another paid request', async () => {
  let signal: AbortSignal | undefined;
  const complete = vi.fn<Provider['complete']>(async (_request, activeSignal, onText) => {
    signal = activeSignal;
    onText?.('Часть ответа');
    return new Promise((_resolve, reject) => activeSignal.addEventListener('abort', () => reject(activeSignal.reason), { once: true }));
  });
  await serve({ complete }, async post => {
    const response = await post();
    await response.body!.cancel();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect((await (await post()).json()).error.code).toBe('REQUEST_ABORTED');
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
