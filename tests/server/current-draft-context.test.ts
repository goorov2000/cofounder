import { ASSISTANT_TEXT_CHARS } from '../../shared/transportLimits';
import {expect,it,vi} from 'vitest';
import http from 'supertest';
import {requestSchema as serverSchema,validateReply} from '../../server/validation';
import {requestSchema as sharedSchema,parseWorkspace,serializeWorkspace} from '../../shared/validation';
import {assertRequestFits} from '../../src/lib/api';
import {createApp} from '../../server/app';
import {createProject} from '../../shared/domain';
import {archiveMessage,buildCoreContext} from '../../shared/coreMemory';
import {HTTP_REQUEST_BYTES} from '../../shared/transportLimits';
import type {ChatRequest,MemoryPatch,Workspace} from '../../shared/types';
const request=():ChatRequest=>({requestId:'request-draft-context',projectId:'project-draft-context',moduleId:'idea',intent:'message',message:'Покажи текущий черновик.',context:{name:'Учебная мастерская',description:'',facts:[],artifacts:[],history:[],currentDraft:{title:'Карточка учебной мастерской',body:'\nПродукт: столы на заказ.\nКлиент: неизвестен.\nПроблема: не проверена.\n'}}});
it('preserves the full optional draft and exact whitespace through both strict request schemas',()=>{
 const r=request();for(const schema of [serverSchema,sharedSchema])expect(schema.parse(r).context.currentDraft).toEqual(r.context.currentDraft);expect(()=>assertRequestFits(r)).not.toThrow();
 const old=structuredClone(r);delete old.context.currentDraft;for(const schema of [serverSchema,sharedSchema])expect(schema.parse(old).context.currentDraft).toBeUndefined();
 const max=request();max.context.currentDraft={title:'Т'.repeat(200),body:'Я'.repeat(ASSISTANT_TEXT_CHARS)};for(const schema of [serverSchema,sharedSchema])expect(schema.parse(max).context.currentDraft?.body).toHaveLength(ASSISTANT_TEXT_CHARS);expect(()=>assertRequestFits(max)).not.toThrow();
 for(const currentDraft of [{title:'Т'.repeat(201),body:'Текст'},{title:'Карточка',body:'Я'.repeat(ASSISTANT_TEXT_CHARS+1)},{title:'Карточка',body:'Текст',verified:true},null,{title:'Карточка',body:123}])for(const schema of [serverSchema,sharedSchema])expect(schema.safeParse({...r,context:{...r.context,currentDraft}}).success).toBe(false);
});
it('sends a complete draft to the mock provider and keeps idempotent snapshots exact',async()=>{
 const r=request(),draft={title:'Карточка',body:'Начало\n'+'Я'.repeat(23980)+'\nКонец'};r.context.currentDraft=draft;
 const fake={complete:vi.fn(async(_request:ChatRequest)=>({reply:{message:'Продукт: столы на заказ. Клиент неизвестен.',choices:[],artifactDraft:null,proposedFacts:[]},usage:{inputTokens:100,outputTokens:20}}))};
 const origin='http://localhost:3000',app=createApp({provider:fake,config:{environment:'test',apiKey:'offline-placeholder',budgetUsd:1,origin,ledgerPath:':memory:'}}),agent=http.agent(app);
 try{await agent.get('/api/status');const send=(value:ChatRequest)=>agent.post('/api/chat').set('Origin',origin).send(value);
  expect((await send(r)).status).toBe(200);expect(fake.complete.mock.calls[0]![0].context.currentDraft).toEqual(draft);expect((await send(r)).status).toBe(200);expect(fake.complete).toHaveBeenCalledTimes(1);
  const changed=structuredClone(r);changed.context.currentDraft!.body=changed.context.currentDraft!.body.replace('Начало','Другое');expect((await send(changed)).status).toBe(409);expect(fake.complete).toHaveBeenCalledTimes(1);expect(r.context.currentDraft).toEqual(draft);
 }finally{app.locals.close();}
});
it('rejects whole request byte overflow without dropping or trimming a schema-valid draft',async()=>{
 const r=request();r.context.currentDraft={title:'Карточка',body:'Я'.repeat(ASSISTANT_TEXT_CHARS)};r.context.history=Array.from({length:40},()=>({role:'assistant' as const,content:'Я'.repeat(8000)}));r.context.artifacts=Array.from({length:10},()=>({moduleId:'idea',title:'Черновик',body:'Я'.repeat(ASSISTANT_TEXT_CHARS),stale:false}));expect(serverSchema.safeParse(r).success).toBe(true);expect(sharedSchema.safeParse(r).success).toBe(true);expect(Buffer.byteLength(JSON.stringify(r),'utf8')).toBeGreaterThan(HTTP_REQUEST_BYTES);const before=structuredClone(r);expect(()=>assertRequestFits(r)).toThrow(expect.objectContaining({code:'CONTEXT_LIMIT'}));expect(r).toEqual(before);
 const fake={complete:vi.fn()},origin='http://localhost:3000',app=createApp({provider:fake,config:{environment:'test',apiKey:'offline-placeholder',budgetUsd:1,origin,ledgerPath:':memory:'}}),agent=http.agent(app);
 try{await agent.get('/api/status');expect((await agent.post('/api/chat').set('Origin',origin).send(r)).status).toBe(413);expect(fake.complete).not.toHaveBeenCalled();expect(r).toEqual(before);}finally{app.locals.close();}
});
it('round trips currentDraft in stored request snapshots without turning it into a saved artifact or fact',()=>{
 const p=createProject(),r=request();r.projectId=p.id;p.modules.idea.messages.push({id:'snapshot-draft-message',role:'user',content:r.message,createdAt:p.createdAt,request:r,status:'sent'});const workspace:Workspace={version:1,activeProjectId:p.id,projects:[p]},restored=parseWorkspace(serializeWorkspace(workspace));expect(restored.projects[0].modules.idea.messages[0].request?.context.currentDraft).toEqual(r.context.currentDraft);expect(restored.projects[0].modules.idea.artifact).toBe(p.modules.idea.artifact);expect(restored.projects[0].facts).toEqual(p.facts);
 const old=structuredClone(workspace);delete old.projects[0].modules.idea.messages[0].request!.context.currentDraft;expect(parseWorkspace(serializeWorkspace(old)).projects[0].modules.idea.messages[0].request!.context.currentDraft).toBeUndefined();
});
it('does not admit draft text as a user source, read evidence or remembered fact',()=>{
 const text='Покажи текущий черновик.',p=archiveMessage(createProject(),'idea',{id:'draft-user-message',role:'user',content:text,createdAt:'2026-11-15T00:00:00.000Z'}),core=buildCoreContext(p,'idea','draft-user-message'),r:ChatRequest={...request(),projectId:p.id,contractVersion:2,coreContext:core};const draft='Цена 9999 рублей подтверждена.';r.context.currentDraft={title:'Недоверенное предложение',body:draft};
 const reply={message:'Текст остаётся предложением, подтверждённая цена неизвестна.',choices:[],artifactDraft:null,proposedFacts:[]};
 const patch:MemoryPatch={schemaVersion:1,projectId:p.id,moduleId:'idea',generation:core.generation,requestId:r.requestId,baseMemoryVersion:core.revision,baseContextVersion:core.contextVersion,sourceMessage:core.sourceMessage,operations:[{op:'create',localId:'untrusted-draft-price',value:{kind:'decision',key:'price',scope:{subject:'our_project',entityId:null,area:'project',stageId:null,scenario:null},text:draft,origin:'user',epistemic:'reported',acceptance:'accepted',dependsOn:[],sources:[{type:'message',projectId:p.id,moduleId:'idea',generation:core.generation,...core.sourceMessage,quote:draft}]}}]};
 expect(()=>validateReply({...reply,memoryPatch:patch},r)).toThrow(expect.objectContaining({validationIssue:expect.objectContaining({path:['memoryPatch','operations',0,'value','sources',0,'quote']})}));expect(()=>validateReply({...reply,externalClaims:[{text:draft,evidenceId:'draft-evidence',version:1,quoteId:'quote-1',price:null}]},r)).toThrow(expect.objectContaining({validationIssue:{path:['externalClaims',0,'quoteId'],rule:'missing_read_quote'}}));
 expect(validateReply({...reply,memory:{facts:[{text:draft,evidence:draft}],hypotheses:[],openQuestions:[]}},r).memory?.facts).toEqual([]);expect(p.core?.entries).toHaveLength(0);expect(r.context.currentDraft.body).toBe(draft);
});
