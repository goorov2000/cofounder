import {it,expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../../server/app';
import type {Provider} from '../../server/provider';
const origin='http://localhost:3000';
it('accounts both bounded repairs in one HTTP chain and never pays again on replay',async()=>{
 let calls=0;
 const provider:Provider={async complete(_request,_signal,onText,execution){
  calls++;
  const steps=[['plan','plan',1024],['plan-repair','plan',1024],['search','search',2048],['generate','generate',1024],['generate-repair','generate',1024]] as const;
  for(const [id,kind,outputTokens] of steps){
   execution?.onOperation?.({id,kind,inputHash:id,state:'started',reservedUsd:0.001});
   execution?.onOperation?.({id,kind,inputHash:id,state:'completed',chargedUsd:0.0001,usage:{inputTokens:10,outputTokens}});
   if(id==='generate'){onText?.('Непроверенный текст');execution?.onTextReset?.();}
  }
  onText?.('Проверенный результат');
  return {reply:{message:'Проверенный результат',choices:[],artifactDraft:null,proposedFacts:[]},usage:{inputTokens:50,outputTokens:6144},costUsd:0.0005};
 }};
 const app=createApp({provider,config:{apiKey:'test-placeholder',budgetUsd:1,maxOutputTokens:1024,origin,ledgerPath:':memory:'}});
 try{
  const agent=request.agent(app);await agent.get('/api/status');
  const input={requestId:'full-repairs-chain',projectId:'full-repairs-project',moduleId:'idea',intent:'message',message:'Помоги с идеей',context:{name:'Синтетический проект',description:'',facts:[],artifacts:[],history:[]}};
  const result=await agent.post('/api/chat').set('Origin',origin).set('Accept','text/event-stream').send(input);
  const events=result.text.split('\n\n').filter(frame=>frame.startsWith('data:')).map(frame=>JSON.parse(frame.slice(6)));
  expect(events.map(event=>event.type)).toEqual(['start','text.delta','complete']);
  expect(events[1].delta).toBe('Непроверенный текст');
  expect(events.at(-1).response.reply.message).toBe('Проверенный результат');
  const replay=await agent.post('/api/chat').set('Origin',origin).send(input);
  expect(replay.status).toBe(200);expect(replay.body).toEqual(events.at(-1).response);expect(calls).toBe(1);
 }finally{app.locals.close();}
});
