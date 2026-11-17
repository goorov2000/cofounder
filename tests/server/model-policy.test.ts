import { expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import http from 'supertest';
import { loadConfig } from '../../server/config.js';
import { generationOutputLimit, modelRequestPolicy } from '../../server/modelPolicy.js';
import { OpenAIProvider, type ResponseTransport } from '../../server/provider.js';
import { createApp } from '../../server/app.js';
import { BudgetLedger } from '../../server/ledger.js';
import { TOPIC_CRITERIA } from '../../shared/coverage.js';
import { PROCESS_CHECK_IDS } from '../../shared/review.js';
import type { ChatRequest } from '../../shared/types.js';

const input:ChatRequest={requestId:'quality-request-01',projectId:'quality-project-01',moduleId:'idea',intent:'message',
  message:'Помоги уточнить идею.',context:{name:'Тест',description:'',facts:[],artifacts:[],history:[]}};
const config=()=>loadConfig({OPENAI_API_KEY:'synthetic-placeholder',OPENAI_MODEL:'gpt-6.1-sol',AI_EVALUATOR_MODEL:'gpt-6.1-sol',AI_SERVICE_TIER:'ultrafast',AI_REASONING_PROFILE:'quality',AI_BUDGET_USD:'64.333638508'});
const reply={message:'Уточним рабочую ситуацию управляющего и решаемую задачу.',choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[]};
const evaluation={
  coverage:{rubricVersion:1,moduleId:'idea',items:TOPIC_CRITERIA.idea.map(item=>({id:item.id,status:'missing',note:'Нужно уточнить вводные.',support:null})),nextCriterionId:'situation'},
  process:{status:'passed',note:'Предложен следующий шаг.',checks:PROCESS_CHECK_IDS.map(id=>({id,status:'passed',reason:'Помощь соответствует доступным вводным.'}))},
  result:{status:'in_progress',note:'Нужно уточнить вводные.'},nextAction:'Уточнить рабочую ситуацию.',
};
const response=(value:unknown,outputTokens=100)=>({status:'completed',error:null,output:[],output_text:JSON.stringify(value),
  usage:{input_tokens:100,output_tokens:outputTokens,output_tokens_details:{reasoning_tokens:outputTokens-100}}}) as unknown as OpenAI.Responses.Response;

it('keeps explicit smaller generation and evaluation caps while providing room for the quality profile',()=>{
  const cfg=config();
  expect(generationOutputLimit(input,cfg)).toBe(128000);
  expect(generationOutputLimit({...input,intent:'draft'},cfg)).toBe(128000);
  expect(generationOutputLimit({...input,moduleId:'mvp'},cfg)).toBe(128000);
  expect(cfg.evaluator?.maxOutputTokens).toBe(32768);
  const small=loadConfig({AI_REASONING_PROFILE:'quality',AI_MAX_OUTPUT_TOKENS:'4096',AI_EVALUATOR_MODEL:'gpt-6.1-sol',AI_EVALUATOR_MAX_OUTPUT_TOKENS:'1024'});
  for(const request of [input,{...input,intent:'draft' as const},{...input,moduleId:'mvp' as const}])expect(generationOutputLimit(request,small)).toBe(4096);
  expect(small.evaluator?.maxOutputTokens).toBe(1024);
  const capped=loadConfig({AI_REASONING_PROFILE:'quality',AI_MAX_OUTPUT_TOKENS:'999999',AI_EVALUATOR_MODEL:'gpt-6.1-sol',AI_EVALUATOR_MAX_OUTPUT_TOKENS:'999999'});
  expect(capped.maxOutputTokens).toBe(128000);expect(capped.evaluator?.maxOutputTokens).toBe(128000);
  expect(()=>loadConfig({AI_REASONING_PROFILE:'typo'})).toThrow('AI_REASONING_PROFILE');
});

it('uses high effort and verbosity for an explicit MVP brief, while ordinary MVP discussion stays medium',async()=>{
  const request={...input,moduleId:'mvp' as const,intent:'draft' as const,message:'Собери бриф для разработчика.'};
  const cfg={...config(),evaluator:undefined},sent:OpenAI.Responses.ResponseCreateParamsNonStreaming[]=[];
  const provider=new OpenAIProvider(cfg,{transport:async params=>{sent.push(params);return response(sent.length===1?{action:'answer',query:''}:reply,sent.length===1?100:20000);}});
  const result=await provider.complete(request,new AbortController().signal,()=>{});
  expect(result.usage.outputTokens).toBe(20100);
  expect(sent[0]).toMatchObject({model:'gpt-6-luna',service_tier:'fast',reasoning:{effort:'low',mode:'standard'},max_output_tokens:16384});
  expect(sent[1]).toMatchObject({model:'gpt-6.1-sol',service_tier:'ultrafast',reasoning:{effort:'high',mode:'standard'},max_output_tokens:128000,
    text:{verbosity:'high',format:{type:'json_schema',strict:true}}});
  expect(modelRequestPolicy({...input,moduleId:'mvp',message:'С чего начнём?'},cfg,'generate',cfg.model)).toMatchObject({effort:'medium',verbosity:'medium'});
});

it('accepts larger reasoning usage through HTTP, charges it once and caches the completed evaluated reply',async()=>{
  const cfg=config(),ledger=new BudgetLedger(':memory:',cfg);
  const transport=vi.fn<ResponseTransport>(async params=>{
    const name=params.text?.format?.type==='json_schema'?params.text.format.name:'';
    if(name==='cofounder_action')return response({action:'answer',query:''},10000);
    if(name==='cofounder_reply')return response(reply,50000);
    if(name==='cofounder_evaluation')return response(evaluation,20000);
    throw Error(`Unexpected request: ${name}`);
  });
  const app=createApp({config:cfg,ledger,provider:new OpenAIProvider(cfg,{transport})});
  try {
    const client=http.agent(app),status=await client.get('/api/status');
    expect(status.body.reasoningProfile).toMatchObject({name:'quality',reasoningMode:'standard',
      effort:{plan:'low',check:'medium',answer:'medium',evaluator:'medium',brief:'high',search:'none'},
      verbosity:{answer:'medium',brief:'high'},outputLimits:{plan:16384,check:32768,answer:128000,draft:128000,brief:128000,evaluator:32768}});
    expect(status.body.runtimeLimits).toEqual({callTimeoutMs:900000,evaluatorTimeoutMs:900000,taskTimeoutMs:3600000});
    const token=status.headers['set-cookie'][0].match(/cofounder_session=([a-f0-9]{64})/)![1],owner=ledger.session(token)!;
    const first=await client.post('/api/chat').set('Origin',cfg.origin).send(input);
    expect(first.status,first.text).toBe(200);
    expect(first.body.reply.memory.review.status).toBe('completed');
    expect(first.body.reply.diagnostics.costUsd).toBeCloseTo(4.21242,12);
    const operations=ledger.readOperations({session:owner,requestId:input.requestId}).filter(item=>item.kind!=='skill');
    expect(operations).toHaveLength(3);
    expect(operations.map(item=>JSON.parse(String(item.metadata)).reasoningEffort)).toEqual(['low','medium','medium']);
    expect(operations.map(item=>JSON.parse(String(item.metadata)).maxOutputTokens)).toEqual([16384,128000,32768]);
    expect(operations.map(item=>JSON.parse(String(item.metadata)).usage.reasoningTokens)).toEqual([9900,49900,19900]);
    expect(operations.reduce((sum,item)=>sum+Number(item.chargedUsd),0)).toBeCloseTo(4.21242,9);
    const cached=await client.post('/api/chat').set('Origin',cfg.origin).send(input);
    expect(cached.body).toEqual(first.body);expect(transport).toHaveBeenCalledTimes(3);
  } finally {ledger.close();}
});
