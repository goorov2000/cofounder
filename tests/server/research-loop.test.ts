import { expect, test, vi } from 'vitest';
import supertest from 'supertest';
import type OpenAI from 'openai';
import { OpenAIProvider, type ResponseTransport } from '../../server/provider';
import { createApp } from '../../server/app';
import { BudgetLedger, type OperationEvent } from '../../server/ledger';
import { ServiceError } from '../../server/errors';
import { loadConfig } from '../../server/config';
import { extractPage } from '../../server/publicReader';
import { pageEvidence } from '../../server/research';
import { RESEARCH_TASK_TIMEOUT_MS, researchTaskTimeout } from '../../server/researchLoop';
import { TOPIC_CRITERIA } from '../../shared/coverage';
import { PROCESS_CHECK_IDS } from '../../shared/review';
import { ensureCore } from '../../shared/coreMemory';
import { createProject } from '../../shared/domain';
import { makeRequest } from '../acceptance/fixtures';
import { applyAnswer } from '../../src/features/workspace/answerRequests';

const config=loadConfig({OPENAI_API_KEY:'synthetic-placeholder',OPENAI_MODEL:'gpt-6.1-sol',AI_EVALUATOR_MODEL:'gpt-6.1-sol',AI_BUDGET_USD:'15'});
const literal='Сервис запрашивает статус, получает ответ исполнителя и сообщает заказчику, в том числе об отсутствии ответа.';
const reply=(message=literal)=>({message,choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[]});
function verdict(done=false,nextStep:'research'|'ask_user'|'complete'|'blocked'|null=done?'complete':'research') {
 return {coverage:{rubricVersion:1,moduleId:'competitors',items:TOPIC_CRITERIA.competitors.map(item=>({id:item.id,status:done?'covered':'partial',note:done?'Проверено по источнику.':'Нужно проверить полный цикл.',support:done?{role:'assistant',quote:literal}:null})),nextCriterionId:done?null:'alternatives'},
  process:{status:done?'passed':'needs_work',note:done?'Проверка выполнена.':'Доступное исследование нужно продолжить.',checks:PROCESS_CHECK_IDS.map(id=>({id,status:!done&&id==='help'?'failed':'passed',reason:'Контролируемая проверка.'}))},
  result:{status:done?'ready':'in_progress',note:done?'Рабочий результат достаточен.':'Остался проверяемый пробел.'},nextAction:done?null:'Проверь полный цикл уведомлений у выбранного сервиса по официальной документации.',nextStep};
}

function adapter(options:{batches?:number;stalled?:boolean;repeatedFocus?:boolean;duplicateQuery?:boolean;sameUrl?:boolean;badCheck?:boolean;badCheckOnce?:boolean;failSearch?:number;badGeneration?:boolean;badJudge?:boolean;unfinished?:boolean}={}){
 let searches=0,checks=0,generations=0,judges=0;
 const inputs:Array<{name:string;params:any}>=[],reader=vi.fn(async(url:string)=>extractPage(`<p>${literal}</p>`,url));
 const transport=vi.fn<ResponseTransport>(async params=>{
  const format=params.text?.format,name=format?.type==='json_schema'?format.name:'search';inputs.push({name,params});
  let value:unknown,output:unknown[]=[];
  if(name==='cofounder_action')value={action:'research',query:'публичные альтернативы статуса дизайнера'};
  else if(name==='search'){
   searches++;if(options.failSearch===searches)throw Error('Controlled uncertain network');
   output=[{type:'web_search_call',action:{type:'search',sources:[{url:`https://vendor.example/page-${options.sameUrl||options.stalled?1:searches}`,title:'Официальная документация'}]}}];value='';
  }else if(name==='cofounder_research_check'){
   checks++;const ready=!options.stalled&&checks>=(options.batches ?? 2),focus=TOPIC_CRITERIA.competitors[options.stalled||options.repeatedFocus?1:Math.min(checks-1,3)].id;
   value=options.badCheck||options.badCheckOnce&&checks===1?{broken:true}:{ready,criteria:TOPIC_CRITERIA.competitors.map(item=>({id:item.id,status:!ready&&item.id===focus?'missing':'supported'})),focus:ready?null:focus,query:ready?'':options.duplicateQuery?'публичные альтернативы статуса дизайнера':`официальная документация проверка ${checks}`,note:'Проверить получение статуса.'};
  }else if(name==='cofounder_evaluation'){
   judges++;value=options.badJudge&&judges===1?{broken:true}:verdict(!options.unfinished);
  }else {generations++;value=options.badGeneration&&generations===1?{broken:true}:reply();}
  return {status:'completed',error:null,output,output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:100}} as OpenAI.Responses.Response;
 });
 return {provider:new OpenAIProvider(config,{transport,reader}),reader,transport,inputs};
}
const seed=()=>makeRequest(ensureCore(createProject()),'competitors','Найди и сравни альтернативы');

test('collects two source batches before one final answer and one independent judgment',async()=>{
 const run=adapter(),r=seed(),events:OperationEvent[]=[];
 const result=await run.provider.complete(r.request,new AbortController().signal,undefined,{onOperation:e=>events.push(e)});
 expect(run.inputs.map(x=>x.name)).toEqual(['cofounder_action','search','cofounder_research_check','search','cofounder_research_check','cofounder_reply','cofounder_evaluation']);
 expect(result.reply.memory!.review!.nextStep).toBe('complete');expect(result.reply.externalSources).toHaveLength(2);
 expect(events.filter(e=>e.kind==='generate'&&e.state==='started')).toHaveLength(1);
 expect(events.find(e=>e.id==='research-2:search')?.state).toBe('started');
 const saved=applyAnswer(r.project,r.request,result.reply);
 expect(saved.modules.competitors.messages.filter(m=>m.role==='user')).toHaveLength(1);
 expect(saved.modules.competitors.messages.filter(m=>m.role==='assistant')).toHaveLength(1);
 expect(saved.core!.evidence).toHaveLength(2);
});

test('four useful source checks still produce a single answer rather than four full drafts',async()=>{
 const run=adapter({batches:4}),r=seed();const result=await run.provider.complete(r.request,new AbortController().signal);
 expect(run.reader).toHaveBeenCalledTimes(4);
 expect(run.inputs.filter(x=>x.name==='cofounder_reply')).toHaveLength(1);
 expect(run.inputs.filter(x=>x.name==='cofounder_evaluation')).toHaveLength(1);
 expect(result.reply.memory!.coverage!.items.every(item=>item.status==='covered')).toBe(true);
});

test('HTTP accounts source checks and returns cached final output without another paid call',async()=>{
 const run=adapter({repeatedFocus:true,batches:4}),ledger=new BudgetLedger(':memory:',config),app=createApp({config,ledger,provider:run.provider});
 try {const agent=supertest.agent(app);await agent.get('/api/status');const r=seed();
  const first=await agent.post('/api/chat').set('Origin',config.origin).send(r.request);expect(first.status,first.text).toBe(200);
  expect(run.reader).toHaveBeenCalledTimes(4);
  expect(first.body.reply.diagnostics.operations.filter((e:any)=>e.kind==='generate')).toHaveLength(1);
  const calls=run.transport.mock.calls.length;
  expect((await agent.post('/api/chat').set('Origin',config.origin).send(r.request)).body).toEqual(first.body);
  expect(run.transport).toHaveBeenCalledTimes(calls);
 }finally{ledger.close();}
});

test('distinct useful questions under one broad criterion continue before the only final answer',async()=>{
 const run=adapter({repeatedFocus:true,batches:4}),r=seed(),events:OperationEvent[]=[];
 const result=await run.provider.complete(r.request,new AbortController().signal,undefined,{onOperation:e=>events.push(e)});
 expect(run.reader).toHaveBeenCalledTimes(4);
 expect(run.inputs.filter(x=>x.name==='cofounder_reply')).toHaveLength(1);
 expect(result.reply.memory!.review!.nextStep).toBe('complete');
 expect(result.reply.research!.limitations.join(' ')).not.toContain('Оставшийся вопрос');
 const checks=events.filter(e=>e.id.endsWith(':check')&&e.state==='completed');
 expect(checks).toHaveLength(4);
 expect(checks[1].metadata?.researchCheck).toMatchObject({ready:false,focus:'comparison'});
});

test('three searches with no new reading or criterion progress end collection without re-reading or full rewrites',async()=>{
 const run=adapter({stalled:true}),r=seed();const result=await run.provider.complete(r.request,new AbortController().signal);
 expect(run.reader).toHaveBeenCalledTimes(1);expect(result.reply.research!.status).toBe('partial');
 expect(run.inputs.filter(x=>x.name==='search')).toHaveLength(4);
 expect(result.reply.research!.limitations.join(' ')).toContain('Три последовательные проверки не добавили');
 expect(run.inputs.filter(x=>x.name==='cofounder_reply')).toHaveLength(1);
});

test('the same query is never purchased twice under one task',async()=>{
 const run=adapter({duplicateQuery:true}),r=seed();const result=await run.provider.complete(r.request,new AbortController().signal);
 expect(run.inputs.filter(x=>x.name==='search')).toHaveLength(1);
 expect(result.reply.research!.limitations.join(' ')).toContain('повторяет уже выполненный');
});

test('the same public URL is read only once while its original evidence remains in the final answer',async()=>{
 const run=adapter({sameUrl:true}),r=seed();const result=await run.provider.complete(r.request,new AbortController().signal);
 expect(run.reader).toHaveBeenCalledTimes(1);expect(result.reply.externalSources).toHaveLength(1);
 expect(result.reply.externalSources![0].operationId).toBe('read-1');
});

test('a failed later search preserves collected sources and still composes the only final answer',async()=>{
 const run=adapter({failSearch:2}),r=seed();const result=await run.provider.complete(r.request,new AbortController().signal);
 expect(run.reader).toHaveBeenCalledTimes(1);expect(result.reply.externalSources).toHaveLength(1);
 expect(result.reply.research!.status).toBe('partial');
 expect(result.reply.diagnostics!.operations!.some(e=>e.id==='research-2:search'&&e.state==='unknown')).toBe(true);
 expect(run.inputs.filter(x=>x.name==='cofounder_reply')).toHaveLength(1);
});

test('a denied later search is not sent and does not discard earlier evidence',async()=>{
 const run=adapter(),r=seed(),events:OperationEvent[]=[];
 const result=await run.provider.complete(r.request,new AbortController().signal,undefined,{onOperation:e=>{
  if(e.id==='research-2:search'&&e.state==='started')throw new ServiceError('BUDGET_EXHAUSTED','Controlled cap',402,false,true);events.push(e);
 }});
 expect(run.inputs.filter(x=>x.name==='search')).toHaveLength(1);expect(result.reply.externalSources).toHaveLength(1);
 expect(events.some(e=>e.id==='research-2:search')).toBe(false);expect(result.reply.research!.status).toBe('partial');
});

test('an invalid source check never fabricates readiness or triggers repeated full-answer generation',async()=>{
 const run=adapter({badCheck:true}),r=seed();const result=await run.provider.complete(r.request,new AbortController().signal);
 expect(result.reply.research!.limitations.join(' ')).toContain('Предварительная проверка полноты');
 expect(run.inputs.filter(x=>x.name==='cofounder_reply')).toHaveLength(1);
});

test('a malformed cheap source check gets one stronger correction, charged at the actual Sol rate',async()=>{
 const run=adapter({badCheckOnce:true,batches:1}),r=seed(),events:OperationEvent[]=[];
 const result=await run.provider.complete(r.request,new AbortController().signal,undefined,{onOperation:e=>events.push(e)});
 const checks=run.inputs.filter(x=>x.name==='cofounder_research_check');
 expect(checks.map(x=>x.params.model)).toEqual(['gpt-6-luna','gpt-6.1-sol']);
 expect(events.find(e=>e.id==='research-1:check-repair'&&e.state==='completed')!.chargedUsd).toBeCloseTo(.0012,10);
 expect(result.reply.memory!.review!.nextStep).toBe('complete');
 expect(run.inputs.filter(x=>x.name==='cofounder_reply')).toHaveLength(1);
});

test('a completed invalid final answer gets one structural repair without another search',async()=>{
 const run=adapter({badGeneration:true}),r=seed();const result=await run.provider.complete(r.request,new AbortController().signal);
 expect(run.inputs.filter(x=>x.name==='search')).toHaveLength(2);
 expect(run.inputs.filter(x=>x.name==='cofounder_reply')).toHaveLength(2);
 expect(result.reply.diagnostics!.operations!.some(e=>e.id==='generate-repair')).toBe(true);
 expect(result.reply.memory!.review!.nextStep).toBe('complete');
});

test('a completed malformed judgment gets one repair without rewriting the answer',async()=>{
 const run=adapter({badJudge:true}),r=seed();const result=await run.provider.complete(r.request,new AbortController().signal);
 expect(run.inputs.filter(x=>x.name==='cofounder_reply')).toHaveLength(1);
 expect(run.inputs.filter(x=>x.name==='cofounder_evaluation')).toHaveLength(2);
 expect(result.reply.memory!.review!.status).toBe('completed');
});

test('a final judge can leave criteria open without pretending completion or starting another complete rewrite',async()=>{
 const run=adapter({unfinished:true}),r=seed();const result=await run.provider.complete(r.request,new AbortController().signal);
 expect(result.reply.memory!.coverage!.items.every(item=>item.status!=='covered')).toBe(true);
 expect(result.reply.research!.status).toBe('partial');expect(run.inputs.filter(x=>x.name==='cofounder_reply')).toHaveLength(1);
});

test('cancelling source collection starts no final generation',async()=>{
 const run=adapter(),r=seed(),controller=new AbortController();
 await expect(run.provider.complete(r.request,controller.signal,undefined,{onProgress:p=>{
  if(p.message.includes('Проверка источников 1: определяю'))controller.abort(new Error('User stopped'));
 }})).rejects.toThrow('User stopped');
 expect(run.inputs.filter(x=>x.name==='cofounder_reply')).toHaveLength(0);
});

test('task and ledger crash deadlines remain consistent across collection and final composition',()=>{
 expect(researchTaskTimeout(180_000,true)).toBe(RESEARCH_TASK_TIMEOUT_MS);
 expect(researchTaskTimeout(20,true)).toBe(20);let now=1000;
 const ledger=new BudgetLedger(':memory:',{...config,timeoutMs:RESEARCH_TASK_TIMEOUT_MS,now:()=>now});
 try{ledger.reserve('owner','pipeline-active','body',1);now+=180_001;expect(()=>ledger.reserve('owner','pipeline-active','body',1)).toThrow(expect.objectContaining({code:'REQUEST_PENDING'}));now+=RESEARCH_TASK_TIMEOUT_MS;expect(()=>ledger.reserve('owner','pipeline-active','body',1)).toThrow(expect.objectContaining({code:'OUTCOME_UNKNOWN'}));}finally{ledger.close();}
});
