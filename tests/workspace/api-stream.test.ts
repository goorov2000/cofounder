import { afterEach, expect, it, vi } from 'vitest';
import { sendChat } from '../../src/lib/api';
import type { ChatRequest } from '../../shared/types';
import { ASSISTANT_TEXT_CHARS } from '../../shared/transportLimits';

const request: ChatRequest = { requestId: 'stream-api-001', projectId: 'project-api-001', moduleId: 'idea', intent: 'message', message: 'Привет', context: { name: 'Тест', description: '', facts: [], artifacts: [], history: [] } };
const response = { requestId: request.requestId, model: 'mock', reply: { message: 'Привет 💡', choices: [], artifactDraft: null, proposedFacts: [] } };
const frame = (event: object) => `data: ${JSON.stringify({ requestId: request.requestId, ...event })}\r\n\r\n`;
function mockStream(text: string) {
  const bytes = new TextEncoder().encode(text);
  let index = 0;
  const stream = new ReadableStream({ pull(controller) {
    // Arbitrary byte boundaries include split Cyrillic, emoji and CRLF separators.
    if (index < bytes.length) controller.enqueue(bytes.slice(index, ++index));
    else controller.close();
  } });
  return vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ configured: true, reason: '', model: 'mock', searchEnabled: false })).mockResolvedValueOnce(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })));
}
afterEach(() => vi.unstubAllGlobals());

it.each([12000,ASSISTANT_TEXT_CHARS])('delivers a %i-character brief through actual client SSE decoding before accepting completion',async length=>{
 const message='я'.repeat(length),complete={...response,reply:{...response.reply,message}};
 const wire=frame({type:'start'})+frame({type:'text.delta',delta:message.slice(0,7000)})+frame({type:'text.delta',delta:message.slice(7000)})+frame({type:'complete',response:complete});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({configured:true,reason:'',model:'mock',searchEnabled:false})).mockResolvedValueOnce(new Response(wire,{headers:{'Content-Type':'text/event-stream'}})));
 let preview='';
 await expect(sendChat(request,undefined,delta=>{preview+=delta;})).resolves.toEqual(complete);
 expect(preview).toBe(message);
});

it('retains a finite client preview limit above the old brief boundary',async()=>{
 const wire=frame({type:'text.delta',delta:'я'.repeat(ASSISTANT_TEXT_CHARS+1)});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({configured:true,reason:'',model:'mock',searchEnabled:false})).mockResolvedValueOnce(new Response(wire,{headers:{'Content-Type':'text/event-stream'}})));
 await expect(sendChat(request,undefined,()=>{})).rejects.toMatchObject({code:'INVALID_RESPONSE'});
});

it('decodes fragmented SSE and UTF-8, ignores heartbeats and waits for the validated completion envelope', async () => {
  mockStream(': heartbeat\r\n\r\n' + frame({ type: 'start' }) + frame({ type: 'text.delta', delta: 'Привет ' }) + frame({ type: 'text.delta', delta: '💡' }) + frame({ type: 'complete', response }));
  const pieces: string[] = [];
  expect(await sendChat(request, undefined, delta => pieces.push(delta))).toEqual(response);
  expect(pieces).toEqual(['Привет ', '💡']);
});

it('does not mistake EOF or an explicit error after partial text for a complete answer', async () => {
  mockStream(frame({ type: 'text.delta', delta: 'Привет' }));
  const onText = vi.fn();
  await expect(sendChat(request, undefined, onText)).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
  expect(onText).toHaveBeenCalledWith('Привет');
  mockStream(frame({ type: 'error', error: { code: 'AI_TIMEOUT', message: 'Время вышло', retryable: false } }));
  await expect(sendChat(request, undefined, onText)).rejects.toMatchObject({ code: 'AI_TIMEOUT', retryable: false });
});

it('replaces an unvalidated preview when the same paid chain repairs its answer', async () => {
  const partial = 'Непроверенное предложение';
  mockStream(frame({ type: 'text.delta', delta: partial }) + frame({ type: 'text.reset' }) +
    frame({ type: 'progress', progress: { phase: 'composing', message: 'Проверяю основания…' } }) +
    frame({ type: 'text.delta', delta: response.reply.message }) + frame({ type: 'complete', response }));
  let visible = '';
  const resets = vi.fn(() => { visible = ''; });
  await expect(sendChat(request, undefined, delta => { visible += delta; }, undefined, resets)).resolves.toEqual(response);
  expect(resets).toHaveBeenCalledTimes(1);
  expect(visible).toBe(response.reply.message);
  expect(visible).not.toContain(partial);
});

it('rejects a different request ID and malformed terminal replies', async () => {
  for (const text of [frame({ type: 'text.delta', requestId: 'another-request', delta: 'Чужой ответ' }), frame({ type: 'complete', response: { ...response, reply: null } }), 'data: broken\n\n']) {
    mockStream(text);
    await expect(sendChat(request, undefined, vi.fn())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  }
});

it('accepts bounded documented progress and search-enabled status while preserving completed reply validation', async () => {
  mockStream(frame({ type: 'progress', progress: { phase: 'reading', message: 'Читаю источники…' } }) + frame({ type: 'complete', response }));
  await expect(sendChat(request, undefined, vi.fn())).resolves.toEqual(response);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ configured: true, reason: '', model: 'mock', searchEnabled: true })).mockResolvedValueOnce(Response.json(response)));
  await expect(sendChat(request)).resolves.toEqual(response);
});

it('reports finalization and independent review after visible text without committing before complete', async () => {
  mockStream(frame({ type: 'text.delta', delta: response.reply.message }) +
    frame({ type: 'progress', progress: { phase: 'finalizing', message: 'Подготавливаю варианты…' } }) +
    frame({ type: 'progress', progress: { phase: 'reviewing', message: 'Проверяю полноту темы…' } }) +
    frame({ type: 'complete', response }));
  const phases: string[] = [];
  await expect(sendChat(request, undefined, () => {}, progress => phases.push(progress.phase))).resolves.toEqual(response);
  expect(phases).toEqual(['finalizing', 'reviewing']);
  mockStream(frame({ type: 'text.delta', delta: response.reply.message }) +
    frame({ type: 'progress', progress: { phase: 'reviewing', message: 'Проверяю полноту темы…' } }));
  await expect(sendChat(request, undefined, () => {})).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
});

it('stops an oversized UTF-8 request before any network operation without truncating saved conditions', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const large: ChatRequest = { ...request, context: { ...request.context, artifacts: Array.from({length:14},()=>({ moduleId: 'idea', title: 'Обязательные условия', body: 'Я'.repeat(24000), stale: false })),history:Array.from({length:40},()=>({role:'user',content:'Я'.repeat(8000)})) } };
  await expect(sendChat(large)).rejects.toMatchObject({ code: 'CONTEXT_LIMIT', retryable: false });
  expect(fetch).not.toHaveBeenCalled();
  expect(large.context.artifacts.map(item => item.body.length)).toEqual(Array(14).fill(24000));
});
