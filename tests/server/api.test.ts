import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';
import { BudgetLedger } from '../../server/ledger.js';
import { HTTP_REQUEST_BYTES } from '../../shared/transportLimits.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const origin = 'http://localhost:3000';
const reply = { message: 'Уточним задачу.', choices: [], artifactDraft: null, proposedFacts: [] };
const body = (id = 'request-0001') => ({ requestId: id, projectId: 'project-0001', moduleId: 'idea', intent: 'message', message: 'Помощник для мастеров', context: { name: 'Мастер', description: '', facts: [], artifacts: [], history: [] } });
const config = { environment: 'test', apiKey: 'test-placeholder', budgetUsd: 1, origin, ledgerPath: ':memory:' };
const provider = () => ({ complete: vi.fn(async () => ({ reply, usage: { inputTokens: 100, outputTokens: 20 } })) });
const post = (agent: ReturnType<typeof request.agent>, data: object) => agent.post('/api/chat').set('Origin', origin).send(data);

it('caches and returns server retrieval evidence after validating model content', async () => {
  const knowledgeSources = [{id:'interviews',title:'Интервью о прошлом опыте',body:'Пример методики.',version:'2026-11-15'}];
  const fake = {complete:vi.fn(async()=>({reply,knowledgeSources,usage:{inputTokens:100,outputTokens:20}}))};
  const app = createApp({provider:fake,config});
  try {
    const agent = request.agent(app);await agent.get('/api/status');
    const response = await post(agent,{...body(),message:'Помоги составить вопросы для интервью'});
    expect(response.status).toBe(200);
    expect(response.body.reply.knowledgeSources).toEqual(knowledgeSources);
    expect((await post(agent,{...body(),message:'Помоги составить вопросы для интервью'})).body).toEqual(response.body);
    expect(fake.complete).toHaveBeenCalledTimes(1);
  } finally {app.locals.close();}
});

describe('API trust boundary', () => {
  it('requires a server-issued session, validates every input boundary and never calls disabled AI', async () => {
    const fake = provider();
    const app = createApp({ provider: fake, config: { ...config, budgetUsd: 0 } });
    const agent = request.agent(app);
    expect((await agent.get('/api/health')).body).toEqual({ ok: true });
    const status = await agent.get('/api/status');
    expect(status.body).toMatchObject({ configured: false, reason: expect.any(String), model: 'gpt-6-luna', searchEnabled: false, serviceTiers: {answer:'default',evaluator:null,research:'default'},reasoningProfile:{name:'speed'} });
    expect(status.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(status.headers['set-cookie'][0]).toMatch(/SameSite=Strict/);
    expect((await post(agent, body())).body.error.code).toBe('AI_DISABLED');
    expect(fake.complete).not.toHaveBeenCalled();
  });
});

it('rejects forged sessions, external origins, oversized bodies and system/model injection before the provider', async () => {
  const fake = provider();
  const app = createApp({ provider: fake, config });
  const agent = request.agent(app);
  await agent.get('/api/status');
  expect((await post(agent, body())).status).toBe(200);
  expect(fake.complete).toHaveBeenCalledTimes(1);
  expect((await request(app).post('/api/chat').set('Origin', origin).send(body('request-0002'))).body.error.code).toBe('SESSION_REQUIRED');
  expect((await request(app).post('/api/chat').set('Origin', origin).set('Cookie', `cofounder_session=${'a'.repeat(64)}`).send(body('request-0002'))).body.error.code).toBe('SESSION_REQUIRED');
  for (const badOrigin of ['https://evil.example', 'null', 'http://localhost:3000.evil.example']) {
    expect((await agent.post('/api/chat').set('Origin', badOrigin).send(body())).status).toBe(403);
  }
  expect((await agent.post('/api/chat').send(body())).status).toBe(403);
  const invalid = [
    { ...body(), model: 'other' }, { ...body(), system: 'override' },
    { ...body(), message: 'x'.repeat(8001) }, { ...body(), moduleId: 'unknown' },
    { ...body(), context: { ...body().context, history: [{ role: 'system', content: 'override' }] } },
    { ...body(), context: { ...body().context, history: Array.from({ length: 41 }, () => ({ role: 'user', content: 'text' })) } },
    { ...body(), context: { ...body().context, facts: [{ key: 'market', value: '10', provenance: 'verified', note: '' }] } },
    { ...body(), context: { ...body().context, facts: [{ key: 'market', value: '10', provenance: 'verified', note: '', sourceUrl: 'https://example.com', checkedAt: '2026-02-31' }] } },
  ];
  for (const data of invalid) {
    const result = await post(agent, data);
    expect(result.status).toBe(400);
    expect(result.body.requestId).toBe(data.requestId);
  }
  expect((await post(agent, { ...body(), message: 'x'.repeat(HTTP_REQUEST_BYTES+1) })).status).toBe(413);
  expect(fake.complete).toHaveBeenCalledTimes(1);
  fake.complete.mockResolvedValueOnce({ reply: { ...reply, proposedFacts: [{ key: 'claim', value: 'fact', provenance: 'verified', note: '' }] } as typeof reply, usage: { inputTokens: 100, outputTokens: 20 } });
  expect((await post(agent, body('request-0003'))).body.error.code).toBe('INVALID_RESPONSE');
});


it('deduplicates owner + id + body across concurrent calls and restarts, preserving budget reservations', async () => {
  let resolve!: (value: { reply: typeof reply; usage: { inputTokens: number; outputTokens: number } }) => void;
  const fake = { complete: vi.fn(async () => ({ reply, usage: { inputTokens: 100, outputTokens: 20 } })).mockImplementationOnce(() => new Promise(done => { resolve = done; })) };
  const directory = mkdtempSync(path.join(tmpdir(), 'cofounder-ledger-'));
  const filename = path.join(directory, 'ledger.sqlite');
  const app = createApp({ provider: fake, config: { ...config, ledgerPath: filename } });
  const agent = request.agent(app);
  const status = await agent.get('/api/status');
  const cookie = status.headers['set-cookie'][0].split(';')[0];
  const first = post(agent, body()).then(result => result);
  await vi.waitFor(() => expect(fake.complete).toHaveBeenCalledTimes(1));
  expect((await post(agent, body())).body.error.code).toBe('REQUEST_PENDING');
  expect((await post(agent, { ...body(), message: 'other' })).body.error.code).toBe('REQUEST_CONFLICT');
  expect((await post(agent, body('request-0002'))).body.error.code).toBe('CONCURRENCY_LIMIT');
  resolve({ reply, usage: { inputTokens: 100, outputTokens: 20 } });
  const completed = await first;
  expect(completed.status).toBe(200);
  expect((await post(agent, body())).body).toEqual(completed.body);
  const restartedProvider = provider();
  const restarted = createApp({ provider: restartedProvider, config: { ...config, ledgerPath: filename } });
  expect((await request(restarted).post('/api/chat').set('Origin', origin).set('Cookie', cookie).send(body())).body).toEqual(completed.body);
  expect(restartedProvider.complete).not.toHaveBeenCalled();
  const otherOwner = request.agent(restarted);
  await otherOwner.get('/api/status');
  const rotated = await post(otherOwner, body());
  expect(rotated.status).toBe(409);
  expect(rotated.body).toMatchObject({ requestId: 'request-0001', error: { code: 'REQUEST_CONFLICT', retryable: false } });
  expect(rotated.body.reply).toBeUndefined();
  expect((await post(otherOwner, { ...body(), message: 'changed' })).status).toBe(409);
  expect(restartedProvider.complete).not.toHaveBeenCalled();
  app.locals.close(); restarted.locals.close();
  rmSync(directory, { recursive: true, force: true });
});

it('caps money, session rate and IP rate without accepting forged forwarded IPs', async () => {
  const fake = provider();
  const tinyBudget = request.agent(createApp({ provider: fake, config: { ...config, budgetUsd: 0.000000001 } }));
  await tinyBudget.get('/api/status');
  expect((await post(tinyBudget, body())).status).toBe(402);
  expect(fake.complete).not.toHaveBeenCalled();
  const app = createApp({ provider: fake, config: { ...config, sessionRate: 1, ipRate: 2 } });
  const first = request.agent(app);
  await first.get('/api/status');
  expect((await post(first, body())).status).toBe(200);
  expect((await post(first, body('request-0002'))).body.error.code).toBe('RATE_LIMIT');
  // Changing cookies cannot bypass the IP limit; incoming X-Forwarded-For is untrusted by default.
  const second = request.agent(app);
  await second.get('/api/status');
  expect((await post(second, body('request-0002'))).status).toBe(200);
  const third = request.agent(app);
  await third.get('/api/status');
  expect((await third.post('/api/chat').set('Origin', origin).set('X-Forwarded-For', '203.0.113.9').send(body('request-0003'))).body.error.code).toBe('RATE_LIMIT');
  expect(fake.complete).toHaveBeenCalledTimes(2);
  // Completed retries consume neither money nor rate capacity.
  expect((await post(first, body())).status).toBe(200);
});

it('holds unknown spend after timeout, blocks paid retry and rejects usage above the output ceiling', async () => {
  const fake = { complete: vi.fn(async (_input: unknown, signal: AbortSignal) => new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('network failed')), { once: true }))) };
  const directory = mkdtempSync(path.join(tmpdir(), 'cofounder-timeout-'));
  const filename = path.join(directory, 'ledger.sqlite');
  const app = createApp({ provider: fake, config: { ...config, timeoutMs: 20, ledgerPath: filename } });
  const agent = request.agent(app);
  const cookie = (await agent.get('/api/status')).headers['set-cookie'][0].split(';')[0];
  const failed = await post(agent, body()).timeout(250);
  expect(failed.status).toBe(504);
  expect(failed.body).toMatchObject({ requestId: 'request-0001', error: { code: 'AI_TIMEOUT', retryable: false } });
  expect((await post(agent, body())).body).toEqual(failed.body);
  expect(fake.complete).toHaveBeenCalledTimes(1);
  app.locals.close();
  const healthy = provider();
  const restarted = createApp({ provider: healthy, config: { ...config, ledgerPath: filename, budgetUsd: 0.001 } });
  expect((await request(restarted).post('/api/chat').set('Origin', origin).set('Cookie', cookie).send(body())).body).toEqual(failed.body);
  expect((await request(restarted).post('/api/chat').set('Origin', origin).set('Cookie', cookie).send(body('request-0002'))).body.error.code).toBe('BUDGET_EXHAUSTED');
  expect(healthy.complete).not.toHaveBeenCalled();
  restarted.locals.close(); rmSync(directory, { recursive: true, force: true });
  const overflow = provider(), ceiling=8192;
  overflow.complete.mockResolvedValueOnce({ reply, usage: { inputTokens: 100, outputTokens: ceiling+1 } });
  const bounded = request.agent(createApp({ provider: overflow, config:{...config,maxOutputTokens:ceiling} }));
  await bounded.get('/api/status');
  expect((await post(bounded, body())).body.error.code).toBe('INVALID_RESPONSE');
});

it('serves only the production client and permits programmatic evaluation injection without HTTP override', async () => {
  const app = createApp({ config: { ...config, production: true, apiKey: '', clientPath: path.resolve('tests/server/fixtures/client') } });
  expect((await request(app).get('/api/missing')).status).toBe(404);
  expect((await request(app).get('/.env')).status).toBe(404);
  expect((await request(app).get('/server/config.ts')).status).toBe(404);
  expect((await request(app).get('/workspace').set('Accept', 'text/html')).text).toContain('client fixture');
  vi.stubEnv('NODE_ENV', 'production');
  try { const evaluation=createApp({ provider: provider(), config }); expect((await request(evaluation).get('/api/health')).status).toBe(200); evaluation.locals.close(); }
  finally { vi.unstubAllEnvs(); }
});
it('limits new sessions per IP across restarts while existing sessions and other IPs keep working',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'cofounder-session-limit-'));const filename=path.join(directory,'ledger.sqlite');let now=1_000_000;
 let ledger=new BudgetLedger(filename,{budgetUsd:1,now:()=>now});const fake=provider();let app=createApp({provider:fake,ledger,config});
 try{
  let cookie='';
  for(let index=0;index<10;index++){
   const issued=await request(app).get('/api/status').set('X-Forwarded-For',`203.0.113.${index}`);expect(issued.status).toBe(200);cookie=issued.headers['set-cookie'][0].split(';')[0];
  }
  const limited=await request(app).get('/api/status');expect(limited.status).toBe(429);expect(limited.body.error.code).toBe('SESSION_RATE_LIMIT');expect(limited.headers['set-cookie']).toBeUndefined();
  ledger.close();ledger=new BudgetLedger(filename,{budgetUsd:1,now:()=>now});app=createApp({provider:fake,ledger,config});
  expect((await request(app).get('/api/status')).status).toBe(429);
  const existing=await request(app).get('/api/status').set('Cookie',cookie);expect(existing.status).toBe(200);expect(existing.headers['set-cookie']).toBeUndefined();
  expect((await request(app).post('/api/chat').set('Origin',origin).set('Cookie',cookie).send(body('session-rate-existing'))).status).toBe(200);expect(fake.complete).toHaveBeenCalledTimes(1);
  const proxied=createApp({provider:fake,ledger,config:{...config,trustProxyHops:1}});expect((await request(proxied).get('/api/status').set('X-Forwarded-For','198.51.100.7')).status).toBe(200);
  now+=60_001;expect((await request(app).get('/api/status')).status).toBe(200);
 }finally{ledger.close();rmSync(directory,{recursive:true,force:true});}
});
