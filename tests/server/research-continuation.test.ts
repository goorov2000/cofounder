import { expect, test, vi } from 'vitest';
import supertest from 'supertest';
import type OpenAI from 'openai';
import { OpenAIProvider, type ResponseTransport } from '../../server/provider';
import { createApp } from '../../server/app';
import { BudgetLedger } from '../../server/ledger';
import { ServiceError } from '../../server/errors';
import { loadConfig } from '../../server/config';
import { createPublicReader, extractPage, pageReadFailure } from '../../server/publicReader';
import { pageEvidence } from '../../server/research';
import { continuationAction, researchAvailabilityIssue } from '../../server/researchRuntime';
import { evaluationInput } from '../../server/evaluator';
import { groundCoverage } from '../../server/coverage';
import { TOPIC_CRITERIA } from '../../shared/coverage';
import { createProject } from '../../shared/domain';
import { ensureCore } from '../../shared/coreMemory';
import { makeRequest } from '../acceptance/fixtures';
import { applyAnswer } from '../../src/features/workspace/answerRequests';
import type { AssistantReply, ChatRequest, TopicCoverage } from '../../shared/types';

const config=loadConfig({OPENAI_API_KEY:'synthetic-placeholder',AI_BUDGET_USD:'15',APP_ORIGIN:'http://localhost:3000'});
const response=(value:unknown,output:unknown[]=[])=>({status:'completed',error:null,output,output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:20}}) as OpenAI.Responses.Response;
const baseReply={message:'Есть прочитанные основания для сравнения.',choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[]};
const sources=Array.from({length:6},(_,i)=>({url:`https://vendor-${i}.example/features`,title:`Сервис ${i}`}));
const page='<p>Поддерживаются внешние формы и напоминания исполнителю.</p>';
function request(message='Найди альтернативы',id='continuation-request-01'):ChatRequest {
  return {contractVersion:2,requestId:id,projectId:'continuation-project',moduleId:'competitors',intent:'message',message,
    context:{name:'Синтетический проект',description:'',facts:[],artifacts:[],history:[]},
    coreContext:{schemaVersion:1,projectId:'continuation-project',moduleId:'competitors',generation:0,revision:0,contextVersion:0,
      currentEntryRefs:[],entries:[],evidence:[],sourceMessage:{messageId:id,revision:1},
      sourceMessages:[{projectId:'continuation-project',moduleId:'competitors',generation:0,messageId:id,revision:1,role:'user',content:message,createdAt:'2026-11-16T10:00:00Z'}]}};
}
const claim=(source:{id:string;version:number;quotes:{id:string}[]})=>({text:'Поддерживаются внешние формы',evidenceId:source.id,version:source.version,quoteId:source.quotes[0].id,price:null});
function coverage(moduleId:TopicCoverage['moduleId']='competitors'):TopicCoverage {
  return {rubricVersion:1,moduleId,items:TOPIC_CRITERIA[moduleId].map(c=>({id:c.id,status:'partial',note:'Нужно продолжить проверку.',support:null})),nextCriterionId:TOPIC_CRITERIA[moduleId][0].id};
}

test('six new pages and a cited historical read survive generation without a paid repair',async()=>{
  const initial=makeRequest(ensureCore(createProject()),'competitors','Найди альтернативы');
  const req=initial.request,old=pageEvidence({...req,requestId:'previous-research'},extractPage(page,'https://old.example/features'),0);
  req.coreContext!.evidence=[old];
  initial.project.core!.evidence=[old];
  const transport=vi.fn<ResponseTransport>(async params=>{
    if(params.text?.format?.type==='json_schema'&&params.text.format.name==='cofounder_action')return response({action:'research',query:'публичные сервисы напоминаний'});
    if(params.tools?.some(tool=>tool.type==='web_search'))return response('',[{type:'web_search_call',action:{type:'search',sources}}]);
    const input=JSON.parse(String(params.input));
    expect(input.coreContext.evidence[0].id).toBe('source_7');
    return response({...baseReply,externalClaims:[claim(input.coreContext.evidence[0])]});
  });
  const provider=new OpenAIProvider(config,{transport,reader:async url=>extractPage(page,url)});
  const result=await provider.complete(req,new AbortController().signal,undefined,{trustedEvidence:[old]});
  expect(result.reply.externalSources).toHaveLength(7);
  expect(result.reply.externalSources).toContainEqual(old);
  expect(result.reply.externalClaims![0].evidenceId).toBe(old.id);
  expect(applyAnswer(initial.project,req,result.reply).core!.evidence).toHaveLength(7);
  expect(transport).toHaveBeenCalledTimes(3);
});

test('a new HTTP continuation recovers the failed batch, exposes it to the client and never repeats search, reads or cached payment',async()=>{
  let failGeneration=true;
  const generationInputs:any[]=[];
  const transport=vi.fn<ResponseTransport>(async params=>{
    const input=JSON.parse(String(params.input).startsWith('{')?String(params.input):'{}');
    if(params.text?.format?.type==='json_schema'&&params.text.format.name==='cofounder_action')return response(input.researchRuntime.recoveredSourceCount?{action:'answer',query:''}:{action:'research',query:'публичные сервисы напоминаний'});
    if(params.tools?.some(tool=>tool.type==='web_search'))return response('',[{type:'web_search_call',action:{type:'search',sources}}]);
    if(failGeneration)return response({...baseReply,externalClaims:[{...claim({id:'source_missing',version:1,quotes:[{id:'quote-1'}]})}]});
    generationInputs.push(input);
    return response({...baseReply,externalClaims:[claim(input.coreContext.evidence[0])]});
  });
  const reader=vi.fn(async(url:string)=>extractPage(page,url));
  const provider=new OpenAIProvider(config,{transport,reader}),ledger=new BudgetLedger(':memory:',config),app=createApp({config,provider,ledger});
  try {
    const agent=supertest.agent(app);await agent.get('/api/status');
    const initial=makeRequest(ensureCore(createProject()),'competitors','Найди альтернативы');
    const first=initial.request;
    const failed=await agent.post('/api/chat').set('Origin',config.origin).send(first);
    expect(failed.status,failed.text).toBe(502);
    expect(reader).toHaveBeenCalledTimes(6);
    const callsAfterFailure=transport.mock.calls.length;
    failGeneration=false;
    const continued=makeRequest(initial.project,'competitors','Продолжай');
    const next=continued.request;
    const result=await agent.post('/api/chat').set('Origin',config.origin).send(next);
    expect(result.status,result.text).toBe(200);
    expect(result.body.reply.externalSources).toHaveLength(6);
    expect(result.body.reply.externalSources.every((source:any)=>source.requestId===first.requestId)).toBe(true);
    expect(result.body.reply.recoveredSourceRefs).toHaveLength(6);
    expect(result.body.reply.diagnostics.action).toBe('answer');
    expect(()=>applyAnswer(continued.project,next,{...result.body.reply,recoveredSourceRefs:undefined})).toThrow();
    expect(()=>applyAnswer(continued.project,next,{...result.body.reply,externalSources:result.body.reply.externalSources.map((source:any)=>({...source,generation:source.generation+1}))})).toThrow();
    const saved=applyAnswer(continued.project,next,result.body.reply);
    expect(saved.core!.evidence).toHaveLength(6);
    expect(generationInputs[0].researchRuntime).toMatchObject({searchAvailable:true,recoveredSourceCount:6,action:'answer'});
    expect(generationInputs[0].coreContext.evidence).toHaveLength(6);
    expect(reader).toHaveBeenCalledTimes(6);
    expect(transport).toHaveBeenCalledTimes(callsAfterFailure+2);
    const replay=await agent.post('/api/chat').set('Origin',config.origin).send(next);
    expect(replay.body).toEqual(result.body);
    expect(transport).toHaveBeenCalledTimes(callsAfterFailure+2);
    const retry=await agent.post('/api/chat').set('Origin',config.origin).send(first);
    expect(retry.body).toEqual(failed.body);
    expect(transport).toHaveBeenCalledTimes(callsAfterFailure+2);
    // Once delivered sources are in the client's context, recovery must not trap
    // every future continuation in an answer-only loop.
    const third=makeRequest(saved,'competitors','Продолжай');
    third.request.context.memories=[{moduleId:'competitors',updatedAt:'2026-11-16T10:00:00Z',content:{facts:[],hypotheses:[],openQuestions:[],coverage:coverage()}}];
    const further=await agent.post('/api/chat').set('Origin',config.origin).send(third.request);
    expect(further.status,further.text).toBe(200);
    expect(further.body.reply.diagnostics.action).toBe('research');
    expect(generationInputs.at(-1).researchRuntime.recoveredSourceCount).toBe(0);
    expect(reader).toHaveBeenCalledTimes(12);
  } finally {ledger.close();}
});

test('recovery is isolated by owner, project, stage and generation, and a newer successful research supersedes it',()=>{
  const ledger=new BudgetLedger(':memory:',config),req=request();
  const seed=(id:string,failed:boolean)=>{
    const source=pageEvidence({...req,requestId:id},extractPage(page,sources[0].url),0);
    const admitted=ledger.reserve('owner',id,id,1);if(admitted.kind!=='reserved')throw Error('reservation');
    const event={id:'read-1',kind:'read' as const,inputHash:id,reservedUsd:0,metadata:{evidence:source}};
    ledger.recordOperation(admitted.reservation,{...event,state:'started'});
    ledger.recordOperation(admitted.reservation,{...event,state:'completed',chargedUsd:0});
    if(failed)ledger.fail(admitted.reservation,false,new ServiceError('INVALID_RESPONSE','Synthetic failure'));
    else ledger.complete(admitted.reservation,0,{requestId:id,model:config.model,reply:baseReply});
    return source;
  };
  try {
    const source=seed('failed-batch',true);
    expect(ledger.recoverableEvidence('owner',req.projectId,req.moduleId,0)).toEqual([source]);
    expect(ledger.recoverableEvidence('other',req.projectId,req.moduleId,0)).toEqual([]);
    expect(ledger.recoverableEvidence('owner','other-project',req.moduleId,0)).toEqual([]);
    expect(ledger.recoverableEvidence('owner',req.projectId,'idea',0)).toEqual([]);
    expect(ledger.recoverableEvidence('owner',req.projectId,req.moduleId,1)).toEqual([]);
    expect(ledger.trustedEvidence('owner',req.projectId,[{...source,title:'Подмена'}])).toEqual([]);
    seed('successful-batch',false);
    expect(ledger.recoverableEvidence('owner',req.projectId,req.moduleId,0)).toEqual([]);
  } finally {ledger.close();}
});

test('affirmative continuation forces research for an unfinished comparison; questions, negation, completed stages and explicit no-search remain conversational',async()=>{
  const req=request('Продолжай');
  req.context.memories=[{moduleId:'competitors',updatedAt:'2026-11-16T10:00:00Z',content:{facts:[],hypotheses:[],openQuestions:[],coverage:coverage()}}];
  expect(continuationAction(req,0)).toBe('research');
  expect(continuationAction({...req,message:' Да, продолжи! '},0)).toBe('research');
  for(const message of ['Не продолжай','Продолжай без поиска','А тема завершена?','Расскажи, что уже нашёл'])expect(continuationAction({...req,message},0)).toBeUndefined();
  const completed=structuredClone(req);completed.context.memories![0].content.coverage!.items.forEach(item=>{item.status='covered';});
  expect(continuationAction(completed,0)).toBeUndefined();
  const transport=vi.fn<ResponseTransport>(async params=>{
    if(params.text?.format?.type==='json_schema'&&params.text.format.name==='cofounder_action'){
      expect((params.text.format.schema as any).properties.action.enum).toEqual(['research']);
      return response({action:'research',query:'сервисы напоминаний официальные возможности'});
    }
    if(params.tools?.some(tool=>tool.type==='web_search'))return response('',[{type:'web_search_call',action:{type:'search',sources:sources.slice(0,1)}}]);
    return response(baseReply);
  });
  const result=await new OpenAIProvider(config,{transport,reader:async url=>extractPage(page,url)}).complete(req,new AbortController().signal);
  expect(result.reply.diagnostics!.action).toBe('research');
  expect(transport.mock.calls.filter(([params])=>params.tools?.some(tool=>tool.type==='web_search'))).toHaveLength(1);
});

test('false tool-unavailability claims enter bounded repair; the judge receives actual server capabilities and operations',async()=>{
  const runtime={searchAvailable:true,unavailableReason:null,recoveredSourceCount:0,action:'answer' as const,operations:[{id:'plan',kind:'plan' as const,state:'completed' as const}]};
  expect(researchAvailabilityIssue('В этом ходе у меня нет инструмента веб-поиска и чтения новых страниц.',runtime)).toBeDefined();
  expect(researchAvailabilityIssue('Нового поиска не было; страница недоступна для чтения.',runtime)).toBeUndefined();
  expect(researchAvailabilityIssue('Веб-поиск отключён.',{...runtime,searchAvailable:false})).toBeUndefined();
  const input=JSON.parse(evaluationInput(request(),baseReply,[],[],runtime));
  expect(input.researchRuntime).toEqual(runtime);
  expect(input.candidate).not.toHaveProperty('diagnostics');
  let generations=0;
  const events:any[]=[];
  const transport=vi.fn<ResponseTransport>(async params=>params.text?.format?.type==='json_schema'&&params.text.format.name==='cofounder_action'?response({action:'answer',query:''})
    :response({...baseReply,message:++generations===1?'У меня нет инструмента веб-поиска.':'Нового поиска в этом ходе не было.'}));
  const result=await new OpenAIProvider(config,{transport}).complete(request('Какие результаты уже есть?'),new AbortController().signal,undefined,{onOperation:event=>events.push(event)});
  expect(result.reply.message).toBe('Нового поиска в этом ходе не было.');
  expect(transport).toHaveBeenCalledTimes(3);
  expect(events.find(event=>event.id==='generate'&&event.state==='completed').metadata.validationIssue.rule).toBe('false_search_unavailability');
});

test('a paraphrased judge quote can reuse valid prior support, but explicit downgrades and missing old text never retain coverage',()=>{
  const req={...request('Выбираю узкий вариант'),moduleId:'idea' as const,coreContext:undefined};
  const literal='Исполнитель отвечает на запрос, заказчик получает статус.';
  req.context.history=[{role:'assistant',content:literal}];
  const previous=coverage('idea');Object.assign(previous.items.find(item=>item.id==='solution')!,{status:'covered',support:{role:'assistant',quote:literal}});
  req.context.memories=[{moduleId:'idea',updatedAt:'2026-11-16T10:00:00Z',content:{facts:[],hypotheses:[],openQuestions:[],coverage:previous}}];
  const assessed=structuredClone(previous);assessed.items.find(item=>item.id==='solution')!.support={role:'assistant',quote:'Заказчик автоматически получит ответ исполнителя.'};
  const checked=groundCoverage(assessed,req,baseReply,[])!;
  expect(checked.items.find(item=>item.id==='solution')).toMatchObject({status:'covered',support:{quote:literal}});
  for(const status of ['missing','partial'] as const){
    const downgraded=structuredClone(assessed);Object.assign(downgraded.items.find(item=>item.id==='solution')!,{status,support:null});
    expect(groundCoverage(downgraded,req,baseReply,[])!.items.find(item=>item.id==='solution')!.status).toBe(status);
  }
  expect(groundCoverage(assessed,{...req,context:{...req.context,history:[]}},baseReply,[])!.items.find(item=>item.id==='solution')!.status).toBe('missing');
});

test('read errors retain safe HTTP diagnostics without storing arbitrary exception text',async()=>{
  const reader=createPublicReader({resolve:async()=>[{address:'93.184.216.34',family:4}],fetch:async()=>({status:403,headers:{},body:''})});
  let failure:unknown;try{await reader('https://vendor.example/features',new AbortController().signal);}catch(error){failure=error;}
  expect(pageReadFailure(failure)).toEqual({code:'PAGE_HTTP_STATUS',httpStatus:403,reason:'сервер ответил HTTP 403'});
  expect(JSON.stringify(pageReadFailure(new Error('private internal token')))).not.toContain('private');
  expect(pageReadFailure({code:'constructor'}).code).toBe('PAGE_UNAVAILABLE');
  const events:any[]=[];
  const provider=new OpenAIProvider(config,{reader,transport:async params=>{
    if(params.text?.format?.type==='json_schema'&&params.text.format.name==='cofounder_action')return response({action:'research',query:'публичные альтернативы'});
    if(params.tools?.some(tool=>tool.type==='web_search'))return response('',[{type:'web_search_call',action:{type:'search',sources:sources.slice(0,1)}}]);
    return response(baseReply);
  }});
  const result=await provider.complete(request(),new AbortController().signal,undefined,{onOperation:event=>events.push(event)});
  expect(result.reply.research!.limitations[0]).toContain('HTTP 403');
  expect(events.find(event=>event.kind==='read'&&event.state==='failed')).toMatchObject({errorCode:'PAGE_HTTP_STATUS',metadata:{failure:{httpStatus:403}}});
});
