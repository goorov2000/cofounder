import { expect, it, vi } from 'vitest';
import supertest from 'supertest';
import type OpenAI from 'openai';
import type { ChatRequest, ExternalEvidence } from '../../shared/types';
import { groundedQuantities } from '../../shared/coreValidation';
import { validateReply } from '../../server/validation';
import { groundedPriceUnitBasis } from '../../server/priceUnitBasis';
import { createApp } from '../../server/app';
import { OpenAIProvider, type ResponseTransport } from '../../server/provider';
import { loadConfig } from '../../server/config';
import { extractPage } from '../../server/publicReader';
import { TOPIC_CRITERIA } from '../../shared/coverage';
import { PROCESS_CHECK_IDS } from '../../shared/review';
import { ensureCore } from '../../shared/coreMemory';
import { createProject } from '../../shared/domain';
import { makeRequest } from '../acceptance/fixtures';
import { applyAnswer } from '../../src/features/workspace/answerRequests';

// Exact public read excerpts from the failed request, not a reconstruction of
// its unavailable model output. Claims below are controlled regression inputs.
const quotes = [
  'ith 5 users\n\nWork with task, list, board, Gantt and table view\n\nOrganize work by client\n\nConnect your chat tools\n\nUS & EU data hosting\n\nSee all features Basics\n\nFor small teams needing to deliver projects and track time more reliably\n\n9.99\nuser/month billed yearly',
  'lio health\n\nUse custom fields to capture project data\n\nUse custom items to track different work types\n\n5,000 Automations\n\nSee all features Accelerate\nRecommended\nFor growing teams needing to automate work, manage projects & capacity\n\n24.99\nuser/month billed yearly',
];
const request: ChatRequest = { requestId: 'english-rate-request', projectId: 'english-rate-project', moduleId: 'competitors', intent: 'message', message: 'Сравни тарифы по прочитанным условиям.', context: { name: 'Проверка', description: '', facts: [], artifacts: [], history: [] } };
const source: ExternalEvidence = { projectId: request.projectId, moduleId: 'competitors', generation: 0, id: 'english-rate-read', version: 1, requestId: request.requestId, operationId: 'read-1', url: 'https://www.teamwork.com/pricing/', title: 'Agentic PSA Pricing & Plans – Start Free | Teamwork.com', retrievedAt: '2026-11-16T12:29:00Z', publishedAt: null, effectiveAt: null, retrieval: 'read', contentHash: 'controlled-exact-public-excerpts', quotes: quotes.map((text, i) => ({ id: `q${i + 1}`, text, start: null, end: null })), limitations: [] };
const claims = (evidence = source, currency = 'unknown') => ['9.99', '24.99'].map((amount, i) => ({ text: `Тариф «${i ? 'Accelerate' : 'Basics'}»: ${amount} за пользователя в месяц при годовой оплате.`, evidenceId: evidence.id, version: evidence.version, quoteId: evidence.quotes.find(q => q.text.includes(amount))!.id, price: { amount, currency, unit: 'user', period: 'month', paymentTerms: 'billed yearly' } }));
const reply = { message: 'Basics — 9.99, Accelerate — 24.99 за пользователя в месяц при годовой оплате. Валюта в цитатах не указана. Как сейчас согласуется перенос срока?', choices: [], artifactDraft: null, proposedFacts: [], externalClaims: claims(), externalSources: [source] };

it('accepts both exact read rates, translated claims and unknown currency without losing terms or claims', () => {
  const result = validateReply(reply, request, [source]);
  expect(result).toEqual(reply);
  for (const [i, amount] of ['9.99', '24.99'].entries()) {
    expect(groundedQuantities(claims()[i].text, quotes[i])).toBe(true);
    expect(groundedPriceUnitBasis({ amount, currency: 'unknown', unit: 'user' }, quotes[i])).toBe(true);
  }
});

it('recognizes only explicit noun/time rates, keeping allowance, other amount, ambiguous price and currency guards', () => {
  const price = { amount: '9.99', currency: 'unknown', unit: 'user' };
  for (const quote of ['9.99 user/month billed yearly', '9.99\nusers / month', '9.99\nпользователя/месяц']) expect(groundedPriceUnitBasis(price, quote), quote).toBe(true);
  expect(groundedPriceUnitBasis({ ...price, currency: 'USD' }, '9.99 USD user/month')).toBe(true);
  for (const quote of ['9.99\n5 users/month', '9.99\nUp to 5 users/month', '9.99 users', '9.99 users/monthIdentifier', '9.99 users/monthlyUsage', '9.99\n20.99 users/month', '9.99 users/month; 9.99 covers up to 5 users']) expect(groundedPriceUnitBasis(price, quote), quote).toBe(false);
  expect(groundedPriceUnitBasis({ ...price, currency: 'USD' }, '9.99 user/month')).toBe(false);
  expect(groundedPriceUnitBasis({ ...price, unit: 'employee' }, '9.99 user/month')).toBe(false);
  for (const amount of ['99.9', '10']) expect(groundedPriceUnitBasis({ ...price, amount }, '9.99 user/month')).toBe(false);
  const wrong = structuredClone(reply); wrong.externalClaims[0].price.currency = 'USD';
  expect(() => validateReply(wrong, request, [source])).toThrow();
  expect(() => validateReply(reply, request, [{ ...source, projectId: 'foreign-project' }])).toThrow();
});

it('recognizes English billing periods and user rates with whole-word boundaries, preserving unsupported quantities', () => {
  for (const quote of ['9.99 user/month billed yearly', '9.99 per user monthly billed annually', '9.99/user/year']) expect(groundedQuantities('9.99 за пользователя при годовой оплате', quote), quote).toBe(true);
  for (const quote of ['9.99 user/month billed unyearly', '9.99 user/month annualIdentifier']) expect(groundedQuantities('9.99 при годовой оплате', quote), quote).toBe(false);
  for (const text of ['19.99 за пользователя в месяц', '9.99 USD за пользователя в месяц', '9.99 за точку в месяц']) expect(groundedQuantities(text, quotes[0]), text).toBe(false);
});

it('repairs an unsupported currency once, then reaches the independent judge and commits the full HTTP answer without retyping', async () => {
  const config = loadConfig({ OPENAI_API_KEY: 'synthetic-placeholder', AI_BUDGET_USD: '15', OPENAI_MODEL: 'gpt-6.1-sol', AI_EVALUATOR_MODEL: 'gpt-6.1-sol' });
  let generations = 0;
  const transport = vi.fn<ResponseTransport>(async (params, _signal, onText) => {
    const format = params.text?.format;
    let value: unknown, output: unknown[] = [];
    if (format?.type === 'json_schema' && format.name === 'cofounder_action') value = { action: 'research', query: 'Teamwork pricing user month' };
    else if(format?.type==='json_schema'&&format.name==='cofounder_research_check') value={ready:true,criteria:TOPIC_CRITERIA.competitors.map(c=>({id:c.id,status:'unknown'})),focus:null,query:'',note:'Достаточно для сравнения с явными неизвестными.'};
    else if (params.tools?.some(tool => tool.type === 'web_search')) { value = ''; output = [{ type: 'web_search_call', action: { type: 'search', sources: [{ url: source.url, title: source.title }] } }]; }
    else if (format?.type === 'json_schema' && format.name === 'cofounder_evaluation') value = { coverage: { rubricVersion: 1, moduleId: 'competitors', items: TOPIC_CRITERIA.competitors.map(c => ({ id: c.id, status: 'partial', note: 'Остался личный выбор.', support: null })), nextCriterionId: 'alternatives' }, process: { status: 'passed', note: 'Условия приведены без догадки о валюте.', checks: PROCESS_CHECK_IDS.map(id => ({ id, status: 'passed', reason: 'Контролируемая проверка.' })) }, result: { status: 'in_progress', note: 'Нужно уточнить текущий процесс.' }, nextAction: 'Уточни текущий процесс согласования.', nextStep: 'ask_user' };
    else {
      const input = JSON.parse(String(params.input));
      const evidence = (input.originalInput ?? input).research.evidence[0];
      generations++;
      value = { ...reply, externalSources: undefined, externalClaims: claims(evidence, generations === 1 ? 'USD' : 'unknown'), memoryOperations: [] };
      onText?.(generations === 1 ? 'Предварительное сравнение' : 'Уточнённый черновик');
    }
    return { status: 'completed', error: null, output, output_text: JSON.stringify(value), usage: { input_tokens: 100, output_tokens: 100 } } as OpenAI.Responses.Response;
  });
  const provider = new OpenAIProvider(config, { transport, reader: async url => extractPage(`<p>${quotes[0]}</p><p>${quotes[1]}</p>`, url) });
  const app = createApp({ config: { ...config, ledgerPath: ':memory:' }, provider });
  try {
    const seed = makeRequest(ensureCore(createProject()), 'competitors', request.message), agent = supertest.agent(app);
    await agent.get('/api/status');
    const result = await agent.post('/api/chat').set('Origin', config.origin).set('Accept', 'text/event-stream').send(seed.request);
    const events = result.text.split('\n\n').filter(f => f.startsWith('data:')).map(f => JSON.parse(f.slice(6)));
    const final = events.at(-1);
    expect(final, result.text).toMatchObject({ type: 'complete', response: { reply: { externalClaims: [{ price: { currency: 'unknown', unit: 'user', period: 'month' } }, { price: { currency: 'unknown', unit: 'user', period: 'month' } }], memory: { review: { status: 'completed' } } } } });
    expect(generations).toBe(2); expect(transport).toHaveBeenCalledTimes(6);
    expect(events.filter(e => e.type === 'text.delta').map(e => e.delta)).toEqual(['Предварительное сравнение']);
    expect(events.some(e => e.type === 'text.reset')).toBe(false);
    expect(applyAnswer(seed.project, seed.request, final.response.reply).modules.competitors.messages.filter(m => m.role === 'assistant')).toHaveLength(1);
    const replay = await agent.post('/api/chat').set('Origin', config.origin).send(seed.request);
    expect(replay.body).toEqual(final.response); expect(transport).toHaveBeenCalledTimes(6);
  } finally { app.locals.close(); }
});
