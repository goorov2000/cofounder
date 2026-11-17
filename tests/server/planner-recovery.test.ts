import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import type OpenAI from 'openai';
import {OpenAIProvider,estimateMaxCost,hasUnfulfilledPromise,usageCost} from '../../server/provider.js';
import {loadConfig} from '../../server/config.js';
import {MODEL_OUTPUT_BYTES} from '../../shared/transportLimits.js';
import {buildPrompt} from '../../server/prompt.js';
import type {ChatRequest} from '../../shared/types.js';
import {BudgetLedger,hash,type OperationEvent} from '../../server/ledger.js';
import {extractPage} from '../../server/publicReader.js';
const fixtures=JSON.parse(readFileSync('tests/server/fixtures/malformed-plans.json','utf8')) as Array<{outputText:string;output:OpenAI.Responses.Response['output'];usage:OpenAI.Responses.Response['usage']}>;
const d14=JSON.parse(readFileSync('tests/server/fixtures/d14-promise.json','utf8'));
const request:ChatRequest={requestId:'planner-recovery',projectId:'planner-project',moduleId:'audience',intent:'message',message:'Найди тарифы для кафе России',context:{name:'Test',description:'',facts:[],artifacts:[],history:[]}};
const config=loadConfig({OPENAI_API_KEY:'test-placeholder',AI_WEB_SEARCH:'false'});
const response=(value:unknown)=>({status:'completed',error:null,output:[],output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:50}} as unknown as OpenAI.Responses.Response);
const good={message:'Проверяем сегменты по ситуации и доступности теста. Спрос неизвестен.',choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[]};
for(const [index,fixture]of fixtures.entries())it(`repairs historical malformed planner ${index+1} as one new decision, preserving raw structure and paid accounting`,async()=>{
 const operations:OperationEvent[]=[],sent:OpenAI.Responses.ResponseCreateParamsNonStreaming[]=[];
 const provider=new OpenAIProvider(config,{transport:async params=>{sent.push(params);if(sent.length===1)return {...response(null),output_text:fixture.outputText,output:fixture.output,usage:fixture.usage};if(sent.length===2)return response({action:'research',query:'публичные тарифы графиков смен Россия'});return response(good);}});
 const result=await provider.complete(request,new AbortController().signal,undefined,{onOperation:e=>operations.push(e)});
 expect(sent).toHaveLength(3);expect(sent[1].text).toEqual(sent[0].text);expect(sent[1].max_output_tokens).toBe(1024);
 const repair=JSON.parse(String(sent[1].input));expect(repair.originalInput.message).toBe(request.message);expect(repair.rejectedOutput).toBe(fixture.outputText);expect(repair.validationIssue).toEqual({path:[],rule:'invalid_plan_json'});
 expect(fixture.output.filter(x=>x.type==='message')).toHaveLength(2);
 const terminal=operations.filter(x=>x.state==='completed');expect(terminal.map(x=>x.id)).toEqual(['plan','plan-repair','generate']);
 expect(terminal[0].metadata).toMatchObject({validation:'failed',validationIssue:{rule:'invalid_plan_json'}});expect(terminal[1].metadata).toMatchObject({validation:'passed',previousValidation:'failed'});
 expect(result.usage.inputTokens).toBe(fixture.usage!.input_tokens+200);expect(result.costUsd).toBeCloseTo(terminal.reduce((n,x)=>n+(x.chargedUsd??0),0),12);expect(result.costUsd).toBeLessThan(estimateMaxCost(request,config));
});
it('records both invalid plans and fails closed before search or generation',async()=>{
 const events:OperationEvent[]=[];let calls=0;
 const provider=new OpenAIProvider(config,{transport:async()=>{calls++;return {...response(null),output_text:fixtures[0].outputText} as unknown as OpenAI.Responses.Response;}});
 await expect(provider.complete(request,new AbortController().signal,undefined,{onOperation:e=>events.push(e)})).rejects.toMatchObject({code:'INVALID_RESPONSE'});
 expect(calls).toBe(2);expect(events.filter(x=>x.state==='completed')).toEqual([expect.objectContaining({id:'plan',metadata:expect.objectContaining({validation:'failed'})}),expect.objectContaining({id:'plan-repair',metadata:expect.objectContaining({validation:'failed'})})]);
});
it('allows one correction of known incomplete plans and never retries unknown transport or usage',async()=>{
 for(const failure of ['incomplete','network','usage']){let calls=0;const events:OperationEvent[]=[];const provider=new OpenAIProvider(config,{transport:async()=>{calls++;if(failure==='network')throw new Error('disconnect');return {...response(null),status:failure==='incomplete'?'incomplete':'completed',usage:failure==='usage'?null:response(null).usage,output_text:fixtures[0].outputText} as unknown as OpenAI.Responses.Response;}});
 await expect(provider.complete(request,new AbortController().signal,undefined,{onOperation:e=>events.push(e)})).rejects.toBeDefined();expect(calls).toBe(failure==='incomplete'?2:1);expect(events.some(x=>x.id==='plan-repair')).toBe(failure==='incomplete');}
});
it('reserves JSON escaping of a full rejected planner before starting any child',()=>{
 expect(estimateMaxCost(request,config)).toBeGreaterThan(usageCost({inputTokens:6*MODEL_OUTPUT_BYTES,outputTokens:1024},config));
});
it('catches exact D14 dangling segments/roles promise but accepts a real comparison table or draft',()=>{
 expect(hasUnfulfilledPromise(d14)).toBe(true);
 expect(hasUnfulfilledPromise({...d14,message:d14.message+'\n| Сегмент | Роль |\n|---|---|\n| Кафе | Управляющий — гипотеза |'})).toBe(false);
 expect(hasUnfulfilledPromise({...d14,artifactDraft:{title:'Сегменты',body:'Кафе с ручным графиком; первый тест доступности. Роли неизвестны.'}})).toBe(false);
});
it('requires one explicit next gap after a tired-user draft while preserving known decisions',()=>{
 const prompt=buildPrompt({...request,message:'Устал, сделай сам'});expect(prompt.instructions).toContain('ОДИН главный неизвестный');expect(prompt.instructions).toContain('Сохраняй принятые срок, канал и географию');
});

it('admits and charges the five-child chain through the normal ledger without another reservation',async()=>{
 const liveConfig=loadConfig({OPENAI_API_KEY:'test-placeholder',AI_BUDGET_USD:'15'}),ledger=new BudgetLedger(':memory:',liveConfig);
 try {
  const session=ledger.session(ledger.createSession())!,bodyHash=hash(JSON.stringify(request)),admission=ledger.reserve(session,request.requestId,bodyHash,estimateMaxCost(request,liveConfig));
  if(admission.kind!=='reserved')throw new Error('Expected new reservation');
  let calls=0;const provider=new OpenAIProvider(liveConfig,{reader:async url=>extractPage('<p>Тариф неизвестен.</p>',url),transport:async()=>{
   calls++;
   if(calls===1)return {...response(null),output_text:fixtures[0].outputText};
   if(calls===2)return response({action:'research',query:'сервисы графиков смен Россия'});
   if(calls===3)return {...response('Search'),output:[{type:'web_search_call',action:{type:'search',sources:[{url:'https://vendor.example/pricing',title:'Тарифы'}]}}]} as unknown as OpenAI.Responses.Response;
   return response(calls===4?{...good,message:d14.message}:good);
  }});
  const result=await provider.complete(request,new AbortController().signal,undefined,{onOperation:e=>ledger.recordOperation(admission.reservation,e)});
  const children=ledger.readOperations(admission.reservation),paid=children.filter(c=>c.kind!=='read');
  expect(calls).toBe(5);expect(paid.map(c=>c.id)).toEqual(['plan','plan-repair','search','generate','generate-repair']);expect(paid.every(c=>c.state==='completed')).toBe(true);
  expect(result.costUsd).toBeCloseTo(paid.reduce((n,c)=>n+Number(c.chargedUsd),0),8);
  ledger.complete(admission.reservation,result.costUsd!,{requestId:request.requestId,reply:result.reply,model:liveConfig.model});
  expect(ledger.reserve(session,request.requestId,bodyHash,estimateMaxCost(request,liveConfig))).toMatchObject({kind:'cached',status:200});
 }finally{ledger.close();}
});

it('a capped cheap plan can recover once on Sol before searching or composing',async()=>{
 const sent:OpenAI.Responses.ResponseCreateParamsNonStreaming[]=[];
 const p=new OpenAIProvider(config,{transport:async params=>{sent.push(params);if(sent.length===1)return {...response(null),status:'incomplete',output_text:''} as unknown as OpenAI.Responses.Response;return response(sent.length===2?{action:'answer',query:''}:good);}});
 expect((await p.complete(request,new AbortController().signal)).reply.message).toBe(good.message);
 expect(sent).toHaveLength(3);expect(sent[0].model).toBe('gpt-6-luna');expect(sent[1].model).toBe('gpt-6.1-sol');expect(sent[1].tools).toBeUndefined();
});
