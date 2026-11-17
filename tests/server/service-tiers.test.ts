import { expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import http from 'supertest';
import { loadConfig, configurationReason, type ServiceTier } from '../../server/config.js';
import { OpenAIProvider, estimateInitialCost, usageCost, type ResponseTransport } from '../../server/provider.js';
import { createApp } from '../../server/app.js';
import { BudgetLedger, type OperationEvent } from '../../server/ledger.js';
import { extractPage } from '../../server/publicReader.js';
import { TOPIC_CRITERIA } from '../../shared/coverage.js';
import { PROCESS_CHECK_IDS } from '../../shared/review.js';
import type { ChatRequest } from '../../shared/types.js';

const request: ChatRequest = { requestId:'tier-request-01',projectId:'tier-project-01',moduleId:'idea',intent:'message',
  message:'Помоги исследовать идею расписания смен.',context:{name:'Тест',description:'',facts:[],artifacts:[],history:[]} };
const reply={message:'Начнём с рабочей ситуации управляющего и уточним, где возникает трудность.',choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[]};
const config=(tier:ServiceTier='ultrafast',profile:'speed'|'quality'='speed',model='gpt-6.1-sol')=>loadConfig({OPENAI_API_KEY:'synthetic-placeholder',OPENAI_MODEL:model,AI_EVALUATOR_MODEL:model,AI_SERVICE_TIER:tier,AI_REASONING_PROFILE:profile,AI_BUDGET_USD:'64.333638508',AI_TIMEOUT_MS:'4999'});
const response=(value:unknown,tier:OpenAI.Responses.ServiceTier,output:unknown[]=[])=>({status:'completed',error:null,output,output_text:JSON.stringify(value),service_tier:tier,
  usage:{input_tokens:100,output_tokens:100,input_tokens_details:{cached_tokens:80}}}) as OpenAI.Responses.Response;

it.each([
  ['default',0.00148,0.000078],['fast',0.00296,0.000156],['ultrafast',0.00888,0.000156],
] as const)('prices %s input, cache and output without multiplying hosted search fees', (tier,sol,luna)=>{
  const usage={inputTokens:1000,outputTokens:100,cachedInputTokens:800};
  expect(usageCost(usage,config(tier),1)).toBeCloseTo(sol+0.01,12);
  expect(usageCost(usage,{...config(tier),model:'gpt-6-luna',inputPricePerMillion:0.1,outputPricePerMillion:0.5},1)).toBeCloseTo(luna+0.01,12);
});

it('retains long-context pricing and treats explicit env prices as Standard base rates',()=>{
  const cfg=loadConfig({OPENAI_MODEL:'gpt-6.1-sol',AI_SERVICE_TIER:'ultrafast',AI_INPUT_USD_PER_MILLION:'2',AI_OUTPUT_USD_PER_MILLION:'10'});
  expect(usageCost({inputTokens:300000,outputTokens:1000,cachedInputTokens:200000},cfg)).toBeCloseTo(2.73,12);
  expect(loadConfig({}).serviceTier).toBe('default');
  expect(()=>loadConfig({AI_SERVICE_TIER:'typo'})).toThrow('AI_SERVICE_TIER');
  expect(configurationReason({...config(),model:'unknown-model'})).toContain('подтверждённым тарифом');
});

it.each([
  {model:'gpt-6.1-sol',tier:'ultrafast',profile:'speed'},
  {model:'gpt-6.1-sol',tier:'ultrafast',profile:'quality'},
  {model:'gpt-6.1-terra',tier:'fast',profile:'quality'},
] as const)('routes every paid phase and repair through $model $tier with $profile',async({model,tier:configuredTier,profile})=>{
  const attempts=new Map<string,number>(),sent:OpenAI.Responses.ResponseCreateParamsNonStreaming[]=[],events:OperationEvent[]=[];
  const transport:ResponseTransport=async params=>{
    sent.push(params);
    const name=params.text?.format?.type==='json_schema'?params.text.format.name:'search';
    const attempt=(attempts.get(name)??0)+1;attempts.set(name,attempt);
    const tier=params.service_tier==='fast'?'priority':params.service_tier!;
    if(name==='cofounder_action') {
      if(attempt===1)return {...response(null,tier),output_text:'',output:[{type:'function_call',name:'load_topic_skill',call_id:'call-extra',arguments:JSON.stringify({skillIds:['topic-interview']})}]} as OpenAI.Responses.Response;
      return response(attempt===2?{}:{action:'research',query:'сервисы расписания смен Россия'},tier);
    }
    if(name==='search')return response('',tier,[{type:'web_search_call',action:{type:'search',sources:[{url:'https://vendor.example/features',title:'Возможности'}]}}]);
    if(name==='cofounder_research_check')return response(attempt===1?{}:{ready:true,criteria:TOPIC_CRITERIA.idea.map(item=>({id:item.id,status:'unknown'})),focus:null,query:'',note:'Можно подготовить результат с явными неизвестными.'},tier);
    if(name==='cofounder_reply')return response(attempt===1?{}:reply,tier);
    if(name==='cofounder_evaluation')return response(attempt===1?{}:{
      coverage:{rubricVersion:1,moduleId:'idea',items:TOPIC_CRITERIA.idea.map(item=>({id:item.id,status:'missing',note:'Нужно уточнить вводные.',support:null})),nextCriterionId:'situation'},
      process:{status:'passed',note:'Предложен следующий шаг.',checks:PROCESS_CHECK_IDS.map(id=>({id,status:'passed',reason:'Помощь соответствует доступным вводным.'}))},
      result:{status:'in_progress',note:'Нужно уточнить вводные.'},nextAction:'Уточнить рабочую ситуацию.',
    },tier);
    throw Error(`Unexpected request: ${name}`);
  };
  const provider=new OpenAIProvider(config(configuredTier,profile,model),{transport,reader:async url=>extractPage('<p>Сервис помогает управляющему составлять расписание рабочих смен.</p>',url)});
  const result=await provider.complete(request,new AbortController().signal,()=>{}, {onOperation:event=>events.push(event)});
  expect(result.reply.memory?.review?.status).toBe('completed');
  expect(sent).toHaveLength(10);
  for(const params of sent){expect(params.model).toBe(params.model==='gpt-6-luna'?'gpt-6-luna':model);expect(params.service_tier).toBe(params.model==='gpt-6-luna'?'fast':configuredTier);}
  expect(sent.map(params=>params.reasoning?.effort)).toEqual(profile==='quality'?
    ['low','low','medium','none','medium','medium','medium','medium','medium','medium']:
    ['none','none','low','none','none','low','low','low','low','low']);
  expect(sent.every(params=>params.reasoning?.mode==='standard')).toBe(true);
  expect(sent.map(params=>params.max_output_tokens)).toEqual(profile==='quality'?
    [16384,16384,16384,16384,32768,32768,128000,128000,32768,32768]:
    [1024,1024,1024,2048,1536,1536,6144,6144,4096,4096]);
  expect(sent[6].text?.verbosity).toBe(profile==='quality'?'medium':undefined);
  expect(sent[6].text?.format).toMatchObject({type:'json_schema',strict:true,name:'cofounder_reply'});
  expect(events.filter(e=>e.state==='started'&&e.reservedUsd!>0).map(e=>e.id)).toEqual([
    'plan','skill-plan','plan-repair','search','research-1:check','research-1:check-repair','generate','generate-repair','evaluate','evaluate-repair',
  ]);
  const paidEvents=events.filter(e=>e.state==='completed'&&e.kind!=='read'&&e.kind!=='skill');
  expect(paidEvents).toHaveLength(10);
  expect(paidEvents.every(e=>e.metadata?.billedServiceTier===(e.kind==='search'||e.id==='plan'||e.id==='skill-plan'||e.id==='research-1:check'?'fast':configuredTier))).toBe(true);
  expect(result.costUsd).toBeCloseTo(model==='gpt-6.1-terra'?0.0167104:0.0481504,12);
});

it('charges the returned Standard tier when OpenAI downgrades a Fast request, retaining the requested mode',async()=>{
  const events:OperationEvent[]=[];let calls=0;
  const cfg={...config(),evaluator:undefined};
  const provider=new OpenAIProvider(cfg,{transport:async()=>response(++calls===1?{action:'answer',query:''}:reply,'default')});
  const result=await provider.complete(request,new AbortController().signal,undefined,{onOperation:event=>events.push(event)});
  expect(result.costUsd).toBeCloseTo(0.0011008,12);
  expect(events.find(e=>e.id==='generate'&&e.state==='started')?.metadata?.requestedServiceTier).toBe('ultrafast');
  expect(events.find(e=>e.id==='generate'&&e.state==='completed')?.metadata).toMatchObject({actualServiceTier:'default',billedServiceTier:'default'});
});

it('publishes the active modes and rejects an unaffordable premium reservation before any API transport',async()=>{
  const cfg={...config(),budgetUsd:estimateInitialCost(request,config('default'))*1.5};
  const transport=vi.fn<ResponseTransport>(),ledger=new BudgetLedger(':memory:',cfg);
  const app=createApp({config:cfg,ledger,provider:new OpenAIProvider(cfg,{transport})});
  try {
    const client=http.agent(app),status=await client.get('/api/status');
    expect(status.body.serviceTiers).toEqual({answer:'ultrafast',evaluator:'ultrafast',research:'fast'});
    const result=await client.post('/api/chat').set('Origin',cfg.origin).send(request);
    expect(result.status).toBe(402);expect(result.body.error.code).toBe('BUDGET_EXHAUSTED');
    expect(transport).not.toHaveBeenCalled();
  } finally {ledger.close();}
});
