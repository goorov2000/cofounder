import { expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';

const config={...loadConfig({OPENAI_API_KEY:'synthetic-placeholder',AI_BUDGET_USD:'15'}),ledgerPath:':memory:'};
const reply={message:'Продолжаем работу.',choices:[],artifactDraft:null,proposedFacts:[]};
const result={reply,usage:{inputTokens:100,outputTokens:20}};
const body=(id:string)=>({requestId:id,projectId:'demo-project',moduleId:'idea',intent:'message',message:'Уточним идею',context:{name:'Демонстрация',description:'',facts:[],artifacts:[],history:[]}});

it('allows rapid local messages and reconnects without public session or IP rate gates',async()=>{
 const provider={complete:vi.fn(async()=>result)},app=createApp({config,provider});
 try {
  const agent=request.agent(app);await agent.get('/api/status');
  for(let index=0;index<40;index++)expect((await agent.post('/api/chat').set('Origin',config.origin).send(body(`demo-request-${index}`))).status).toBe(200);
  for(let index=0;index<20;index++)expect((await request(app).get('/api/status')).status).toBe(200);
  expect(provider.complete).toHaveBeenCalledTimes(40);
  expect((await agent.post('/api/chat').set('Origin',config.origin).send(body('demo-request-0'))).status).toBe(200);
  expect(provider.complete).toHaveBeenCalledTimes(40);
 } finally {app.locals.close();}
});

it('removes the global visitor queue while retaining turn ordering within each chat session',async()=>{
 const finish:Array<()=>void>=[];
 const provider={complete:vi.fn(()=>new Promise<typeof result>(resolve=>finish.push(()=>resolve(result)) ))};
 const app=createApp({config,provider}),agents=Array.from({length:4},()=>request.agent(app));
 const pending:PromiseLike<request.Response>[]=[];
 try {
  for(const agent of agents)await agent.get('/api/status');
  for(const [index,agent] of agents.entries())pending.push(agent.post('/api/chat').set('Origin',config.origin).send(body(`parallel-${index}`)).then(response=>response));
  await vi.waitFor(()=>expect(provider.complete).toHaveBeenCalledTimes(4));
  const extra=await agents[0].post('/api/chat').set('Origin',config.origin).send(body('same-session-pending'));
  expect(extra.status).toBe(429);expect(extra.body.error.code).toBe('CONCURRENCY_LIMIT');
 } finally {
  finish.forEach(resolve=>resolve());
  const responses=await Promise.all(pending);
  app.locals.close();
  expect(responses.map(response=>response.status)).toEqual([200,200,200,200]);
 }
});
