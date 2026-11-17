import { expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import http from 'supertest';
import { loadConfig, serviceTierForModel, configurationReason } from '../../server/config.js';
import { OpenAIProvider, usageCost, type ResponseTransport } from '../../server/provider.js';
import { createApp } from '../../server/app.js';
import { BudgetLedger } from '../../server/ledger.js';
import { TOPIC_CRITERIA } from '../../shared/coverage.js';
import { PROCESS_CHECK_IDS } from '../../shared/review.js';
import type { ChatRequest } from '../../shared/types.js';

const config=(model='gpt-6.1-terra',tier='fast')=>loadConfig({OPENAI_API_KEY:'synthetic-placeholder',OPENAI_MODEL:model,
  AI_EVALUATOR_MODEL:model,AI_SERVICE_TIER:tier,AI_REASONING_PROFILE:'quality',AI_BUDGET_USD:'64.333638508'});
const reply={message:'Уточним условия работы с исполнителями.',choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[]};
const evaluation={
  coverage:{rubricVersion:1,moduleId:'idea',items:TOPIC_CRITERIA.idea.map(item=>({id:item.id,status:'missing',note:'Нужно уточнить вводные.',support:null})),nextCriterionId:'situation'},
  process:{status:'passed',note:'Предложен следующий шаг.',checks:PROCESS_CHECK_IDS.map(id=>({id,status:'passed',reason:'Помощь соответствует доступным вводным.'}))},
  result:{status:'in_progress',note:'Нужно уточнить вводные.'},nextAction:'Уточнить рабочую ситуацию.',
};
const response=(value:unknown)=>({status:'completed',error:null,output:[],output_text:JSON.stringify(value),service_tier:'fast',
  usage:{input_tokens:100,output_tokens:100}}) as unknown as OpenAI.Responses.Response;

it('prices Terra Fast at one sixth of Sol Ultrafast with cache, reasoning and long-context charges preserved',()=>{
  const terra=config(),sol=config('gpt-6.1-sol','ultrafast');
  expect(configurationReason(terra)).toBe('');
  expect(serviceTierForModel('gpt-6.1-terra','ultrafast')).toBe('fast');
  for(const inputTokens of [100000,300000]) {
    const usage={inputTokens,outputTokens:128000,cachedInputTokens:50000,reasoningTokens:10000};
    expect(usageCost(usage,terra)*6).toBeCloseTo(usageCost(usage,sol),12);
  }
  expect(usageCost({inputTokens:300000,outputTokens:1000,cachedInputTokens:200000},terra)).toBeCloseTo(0.455,12);
});

it.each(['gpt-6.1-sol','gpt-6.1-terra'])('preserves accumulated spend and high output caps when admitting %s with $14.136 left',async model=>{
  const cfg=config(model,model==='gpt-6.1-sol'?'ultrafast':'fast'),ledger=new BudgetLedger(':memory:',cfg);
  const spent=50.197631114;
  ledger.reserve('previous-owner','previous-request','previous-hash',spent);
  ledger.complete({session:'previous-owner',requestId:'previous-request'},spent,{requestId:'previous-request',model:cfg.model,reply});
  const input:ChatRequest={requestId:'terra-budget-turn',projectId:'terra-budget-project',moduleId:'idea',intent:'message',
    message:'Есть контакты, но пока без договорённостей',context:{name:'Тест',description:'',facts:[],artifacts:[],
      history:Array.from({length:32},(_,i)=>({role:i%2?'assistant' as const:'user' as const,content:'Обсуждаем индивидуальные заказы одежды и условия работы с производством. '.repeat(48)}))}};
  const transport=vi.fn<ResponseTransport>(async params=>{
    const name=params.text?.format?.type==='json_schema'?params.text.format.name:'';
    if(name==='cofounder_action')return response({action:'answer',query:''});
    if(name==='cofounder_reply')return response(reply);
    if(name==='cofounder_evaluation')return response(evaluation);
    throw Error(`Unexpected request: ${name}`);
  });
  const app=createApp({config:cfg,ledger,provider:new OpenAIProvider(cfg,{transport})});
  try {
    const client=http.agent(app),status=await client.get('/api/status');
    expect(status.body).toMatchObject({configured:true,model,serviceTiers:{answer:cfg.serviceTier,evaluator:cfg.serviceTier,research:'fast'},
      reasoningProfile:{name:'quality',outputLimits:{answer:128000,brief:128000,evaluator:32768}}});
    const result=await client.post('/api/chat').set('Origin',cfg.origin).send(input);
    if(model==='gpt-6.1-sol') {
      expect(result.status,result.text).toBe(402);
      expect(result.body.error.code).toBe('BUDGET_EXHAUSTED');
      expect(transport).toHaveBeenCalledTimes(1);
    } else {
      expect(result.status,result.text).toBe(200);
      expect(result.body.reply.memory.review.status).toBe('completed');
      expect(transport).toHaveBeenCalledTimes(3);
      expect(transport.mock.calls[1][0]).toMatchObject({model:'gpt-6.1-terra',service_tier:'fast',max_output_tokens:128000});
      expect(transport.mock.calls[2][0]).toMatchObject({model:'gpt-6.1-terra',service_tier:'fast',max_output_tokens:32768});
    }
    const cached=await client.post('/api/chat').set('Origin',cfg.origin).send(input);
    expect(cached.body).toEqual(result.body);
    expect(transport).toHaveBeenCalledTimes(model==='gpt-6.1-sol'?1:3);
  } finally {ledger.close();}
});
