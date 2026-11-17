import { beforeEach, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../../server/provider.js';
import { loadConfig } from '../../server/config.js';
import type { ChatRequest } from '../../shared/types.js';
import { MODULES } from '../../shared/modules.js';
import { retrieveKnowledge } from '../../server/knowledge.js';
const sdk = vi.hoisted(() => ({ create: vi.fn(), plan: vi.fn(), options: vi.fn() }));
vi.mock('openai', () => ({ default: class { responses = { create: (...args: unknown[]) => (args[0] as {text?:{format?:{name?:string}}}).text?.format?.name === 'cofounder_action' ? sdk.plan(...args) : sdk.create(...args) }; constructor(options: unknown) { sdk.options(options); } } }));
const input: ChatRequest = { requestId: 'request-0001', projectId: 'project-0001', moduleId: 'idea', intent: 'draft', message: 'Не знаю', context: { name: 'Test', description: '', facts: [], artifacts: [], history: [] } };
const result = { message: 'Без веб-поиска. Выберите задачу.', choices: [{ id: 'skip', label: 'Пропустить', description: '' }], artifactDraft: { title: 'Идея', body: '## Проблема\nНеизвестно.' }, proposedFacts: [] };
const completed = () => ({ status: 'completed', error: null, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }], output_text: JSON.stringify(result), usage: { input_tokens: 100, output_tokens: 40, output_tokens_details: { reasoning_tokens: 30 } } });
beforeEach(() => { sdk.create.mockReset(); sdk.options.mockReset(); sdk.plan.mockReset(); sdk.plan.mockResolvedValue({...completed(),output_text:JSON.stringify({action:'answer',query:''}),usage:{input_tokens:10,output_tokens:5}}); });

it('returns the exact retrieved passages as server metadata separate from model JSON', async () => {
  const request = {...input,message:'Какие вопросы задать на интервью?'};
  sdk.create.mockResolvedValue(completed());
  const response = await new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'})).complete(request,new AbortController().signal);
  expect(response.knowledgeSources).toEqual(retrieveKnowledge(request));
  expect(response.knowledgeSources?.some(source => source.id === 'M07')).toBe(true);
  expect(JSON.parse(sdk.create.mock.calls[0][0].input).knowledge).toEqual(response.knowledgeSources);
  expect(response.reply.knowledgeSources).toBeUndefined();
});

it('streams only decoded message text before completion and still validates the final structured reply', async () => {
  const message = 'Начнём с "опыта".\nПуть C:\\work, идея 💡';
  const output = { ...result, message };
  const raw = JSON.stringify(output).replace('💡', '\\ud83d\\udca1');
  const deltas: string[] = [];
  let streamedBeforeCompletion = '';
  sdk.create.mockImplementationOnce(async () => (async function* () {
    // Split every escape, quote and surrogate pair across provider events.
    for (const delta of raw) yield { type: 'response.output_text.delta', delta };
    streamedBeforeCompletion = deltas.join('');
    yield { type: 'response.completed', response: { ...completed(), output: [{ type: 'message', content: [{ type: 'output_text', text: raw }] }] } };
  })());
  const response = await new OpenAIProvider(loadConfig({ OPENAI_API_KEY: 'test-placeholder' })).complete(input, new AbortController().signal, delta => deltas.push(delta));
  expect(streamedBeforeCompletion).toBe(message);
  expect(response.reply.message).toBe(message);
  expect(deltas.join('')).not.toContain('artifactDraft');
  expect(sdk.create.mock.calls[0][0].stream).toBe(true);
});

it('rejects incomplete, invalid and disconnected streams after previewing without returning a final reply', async () => {
  const adapter = new OpenAIProvider(loadConfig({ OPENAI_API_KEY: 'test-placeholder' }));
  for (const [terminal, code] of [
    [{ type: 'response.incomplete', response: { ...completed(), status: 'incomplete' } }, 'AI_INCOMPLETE'],
    [{ type: 'response.completed', response: { ...completed(), output: [{ type: 'message', content: [{ type: 'output_text', text: '{"message":"partial"}' }] }] } }, 'INVALID_RESPONSE'],
    [null, 'PROVIDER_NETWORK'],
  ] as const) {
    sdk.create.mockImplementation(async () => (async function* () {
      yield { type: 'response.output_text.delta', delta: '{"message":"partial' };
      if (terminal) yield terminal;
    })());
    const onText = vi.fn();
    await expect(adapter.complete(input, new AbortController().signal, onText)).rejects.toMatchObject({ code, knownUnspent: false });
    expect(onText).toHaveBeenCalledWith('partial');
  }
});

it('uses server-only strict Responses with all module sections, low reasoning, no storage/search/retries', async () => {
  sdk.create.mockResolvedValue(completed());
  const adapter = new OpenAIProvider(loadConfig({ OPENAI_API_KEY: 'test-placeholder' }));
  const signal = new AbortController().signal;
  for (const moduleId of Object.keys(MODULES) as Array<keyof typeof MODULES>) {
    const response = await adapter.complete({ ...input, moduleId }, signal);
    expect(response).toMatchObject({ reply: result, usage: { inputTokens: 110, outputTokens: 45 } });
    const [sent, options] = sdk.create.mock.calls.at(-1)!;
    expect(sent).toMatchObject({ model: 'gpt-6-luna', store: false, stream: false, reasoning: { effort: 'low' }, max_output_tokens: 16384, service_tier: 'default', text: { format: { type: 'json_schema', strict: true } } });
    expect(sent.tools).toBeUndefined();
    expect(options.signal.aborted).toBe(false);
    for (const section of MODULES[moduleId].sections) expect(sent.instructions).toContain(section);
    expect(sent.instructions).toMatch(/поиск|интернет/i);
    expect(sent.instructions).toMatch(/устарев|stale/i);
    if (moduleId === 'interview') {
      expect(sent.instructions).toMatch(/интервью/i);
    }
    expect(JSON.parse(sent.input).message).toBe('Не знаю');
  }
  expect(sdk.options).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, logLevel: 'off', baseURL: 'https://api.openai.com/v1', timeout: 900000 }));
});

it('distinguishes refusal, incomplete, malformed/empty/oversized output, untrusted facts, 429 and network failures without raw details', async () => {
  const adapter = new OpenAIProvider(loadConfig({ OPENAI_API_KEY: 'test-placeholder' }));
  const signal = new AbortController().signal;
  for (const [value, code] of [
    [{ ...completed(), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'AI_INCOMPLETE'],
    [{ ...completed(), output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'raw provider text' }] }] }, 'AI_REFUSAL'],
    [{ ...completed(), output_text: '' }, 'INVALID_RESPONSE'],
    [{ ...completed(), output_text: 'broken json' }, 'INVALID_RESPONSE'],
    [{ ...completed(), output_text: 'x'.repeat(80_001) }, 'INVALID_RESPONSE'],
    [{ ...completed(), usage: null }, 'INVALID_RESPONSE'],
    [{ ...completed(), output_text: JSON.stringify({ ...result, proposedFacts: [{ key: 'x', value: 'x', note: '', provenance: 'verified', sourceUrl: 'https://example.com', checkedAt: '2026-11-14' }] }) }, 'INVALID_RESPONSE'],
    [{ ...completed(), output_text: JSON.stringify({ ...result, message: 'Изучил https://invented.example/report' }) }, 'INVALID_RESPONSE'],
  ]) {
    sdk.create.mockResolvedValue(value);
    await expect(adapter.complete(input, signal)).rejects.toMatchObject({ code, retryable: false });
  }
  sdk.create.mockReset();
  for (const [error, code, knownUnspent] of [
    [{ status: 429, message: 'raw provider detail' }, 'PROVIDER_RATE_LIMIT', true],
    [{ status: 401, message: 'raw provider detail' }, 'PROVIDER_AUTH', true],
    [{ status: 404, message: 'raw provider detail' }, 'MODEL_UNAVAILABLE', true],
    [new Error('raw provider detail'), 'PROVIDER_NETWORK', false],
  ] as const) {
    sdk.create.mockRejectedValueOnce(error);
    const caught = await adapter.complete(input, signal).catch(error => error);
    expect(caught).toMatchObject({ code, knownUnspent });
    expect(caught.message).not.toContain('raw provider detail');
  }
  expect(sdk.create).toHaveBeenCalledTimes(4);
});

it('sends the OpenAI-supported union schema while keeping local discriminated validation strict', async()=>{
  sdk.create.mockResolvedValue(completed());
  await new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'})).complete(input,new AbortController().signal);
  const schema=sdk.create.mock.calls[0][0].text.format.schema;
  expect(schema.properties.choices.items.required).toContain('recommended');
  expect(schema.properties.choices.items.properties.recommended).toEqual({type:'boolean'});
  const serialized=JSON.stringify(schema);
  // OpenAI's real text.format.schema boundary rejects oneOf, including nested source unions.
  expect(serialized).not.toContain('"oneOf"');
  expect(schema.properties.memoryOperations.items.anyOf).toHaveLength(2);
  expect(schema.properties.memoryOperations.items.anyOf.map((branch:{properties:{op:{const:string}}})=>branch.properties.op.const)).toEqual(['create','revise']);
});

it('passes the model recommendation through generation without selecting the first option', async () => {
  const choices = [
    { id: 'first', label: 'Посмотреть примеры', description: 'Выбрать знакомую область', recommended: false },
    { id: 'second', label: 'Проверить боль', description: 'Есть знакомые для интервью', recommended: true },
  ];
  sdk.create.mockResolvedValue({ ...completed(), output_text: JSON.stringify({ ...result, choices }) });
  const response = await new OpenAIProvider(loadConfig({ OPENAI_API_KEY: 'test-placeholder' })).complete(input, new AbortController().signal);
  expect(response.reply.choices).toEqual(choices);
});

it('F02 discards unused answer query, advertises the research bound and repairs overlong research once and rejects a repeated invalid plan', async()=>{
 const adapter=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'}));
 sdk.plan.mockResolvedValueOnce({...completed(),output_text:JSON.stringify({action:'answer',query:'a'.repeat(1015)})});sdk.create.mockResolvedValue(completed());
 await expect(adapter.complete(input,new AbortController().signal)).resolves.toMatchObject({reply:result});
 expect(sdk.create).toHaveBeenCalledTimes(1);
 expect(sdk.plan.mock.calls[0][0].text.format.schema.properties.query.maxLength).toBe(400);
 sdk.plan.mockResolvedValue({...completed(),output_text:JSON.stringify({action:'research',query:'a'.repeat(401)})});
 await expect(adapter.complete(input,new AbortController().signal)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
 expect(sdk.plan).toHaveBeenCalledTimes(3);expect(sdk.create).toHaveBeenCalledTimes(1);
});
