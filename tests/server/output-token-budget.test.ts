import {expect,it} from 'vitest';
import {loadConfig} from '../../server/config.js';
import {estimateMaxCost,generationOutputLimit,OpenAIProvider,usageCost} from '../../server/provider.js';
import {BudgetLedger} from '../../server/ledger.js';
import type {ChatRequest} from '../../shared/types.js';
const request:ChatRequest={requestId:'output-budget',projectId:'output-project',moduleId:'idea',intent:'message',message:'Подготовь результат',context:{name:'Test',description:'',facts:[],artifacts:[],history:[]}};
const good={message:'Проверим последний случай согласования смены на одном кафе.',choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[]};
it('keeps room for a complete structured answer while preserving explicit lower limits and a finite hard cap',()=>{
 expect(loadConfig({}).maxOutputTokens).toBe(16384);
 expect(loadConfig({AI_MAX_OUTPUT_TOKENS:'4096'}).maxOutputTokens).toBe(4096);
 expect(loadConfig({AI_MAX_OUTPUT_TOKENS:'999999'}).maxOutputTokens).toBe(128000);
});
it('limits ordinary replies while preserving room for full drafts and explicit lower settings',()=>{
 const config=loadConfig({});
 expect(generationOutputLimit(request,config)).toBe(6144);
 expect(generationOutputLimit({...request,intent:'draft'},config)).toBe(16384);
 const existing={...request,context:{...request.context,currentDraft:{title:'Полный текст',body:'Разделы, которые нужно сохранить'}}};
 expect(generationOutputLimit(existing,config)).toBe(16384);
 expect(generationOutputLimit(existing,{...config,maxOutputTokens:4096})).toBe(4096);
 expect(generationOutputLimit(request,{...config,maxOutputTokens:4096})).toBe(4096);
});
it('charges cached input at the documented model rate and retains reasoning/cache usage for inspection',async()=>{
 const cfg=loadConfig({OPENAI_API_KEY:'test-placeholder',OPENAI_MODEL:'gpt-6.1-sol'}),events:any[]=[];let calls=0;
 const p=new OpenAIProvider(cfg,{transport:async()=>({status:'completed',error:null,output:[],output_text:JSON.stringify(++calls===1?{action:'answer',query:''}:good),usage:{input_tokens:100,output_tokens:100,input_tokens_details:{cached_tokens:80},output_tokens_details:{reasoning_tokens:20}}}) as never});
 const result=await p.complete(request,new AbortController().signal,undefined,{onOperation:e=>events.push(e)});
 const cheap=loadConfig({OPENAI_API_KEY:'test-placeholder'});
 expect(result.costUsd).toBeCloseTo(usageCost({inputTokens:100,outputTokens:100,cachedInputTokens:80},cfg)+usageCost({inputTokens:100,outputTokens:100,cachedInputTokens:80},cheap),12);
 expect(result.costUsd!).toBeLessThan(usageCost({inputTokens:100,outputTokens:100},cfg)+usageCost({inputTokens:100,outputTokens:100},cheap));
 expect(events.find(e=>e.id==='generate'&&e.state==='completed').usage).toMatchObject({cachedInputTokens:80,reasoningTokens:20});
});
it('rejects impossible cache accounting before accepting output or starting another paid step',async()=>{
 let calls=0;
 const p=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'}),{transport:async()=>{calls++;return {status:'completed',error:null,output:[],output_text:JSON.stringify({action:'answer',query:''}),usage:{input_tokens:100,output_tokens:10,input_tokens_details:{cached_tokens:101}}} as never;}});
 await expect(p.complete(request,new AbortController().signal)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
 expect(calls).toBe(1);
});
it('reserves both generation output ceilings before admission and preserves session concurrency',()=>{
 const config=loadConfig({OPENAI_API_KEY:'test-placeholder'}),small={...config,maxOutputTokens:4096};
 const upper=estimateMaxCost(request,config),lower=estimateMaxCost(request,small);
 // The possible repair uses the long-context output rate; the ordinary turn remains short.
 expect(upper-lower).toBeCloseTo((1+1.5)*(generationOutputLimit(request,config)-generationOutputLimit(request,small))*config.outputPricePerMillion/1e6,10);
 const insufficient=new BudgetLedger(':memory:',{budgetUsd:lower});
 try {expect(()=>insufficient.reserve('owner','too-large','hash',upper)).toThrow(expect.objectContaining({code:'BUDGET_EXHAUSTED'}));}finally{insufficient.close();}
 const ledger=new BudgetLedger(':memory:',{budgetUsd:upper*3});
 try {ledger.reserve('owner',request.requestId,'hash',upper);expect(()=>ledger.reserve('owner','another','hash2',upper)).toThrow(expect.objectContaining({code:'CONCURRENCY_LIMIT'}));}finally{ledger.close();}
});
it('accounts a known 8192-token generation at its configured boundary without retrying incomplete output',async()=>{
 for(const incomplete of [false,true]){
  let calls=0;const events:unknown[]=[];const provider=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder',AI_MAX_OUTPUT_TOKENS:'8192'}),{transport:async params=>{
   calls++;const planning=calls===1;expect(params.max_output_tokens).toBe(planning?1024:8192);
   return {status:!planning&&incomplete?'incomplete':'completed',error:null,output:[],output_text:JSON.stringify(planning?{action:'answer',query:''}:{...good,artifactDraft:{title:'Идея',body:good.message}}),usage:{input_tokens:100,output_tokens:planning?10:8192}} as never;
  }});
  const result=provider.complete({...request,intent:'draft'},new AbortController().signal,undefined,{onOperation:e=>events.push(e)});
  if(incomplete)await expect(result).rejects.toMatchObject({code:'AI_INCOMPLETE'});else expect((await result).usage.outputTokens).toBe(8202);
  expect(calls).toBe(2);expect(events).toContainEqual(expect.objectContaining({id:'generate',state:'completed',usage:{inputTokens:100,outputTokens:8192}}));
 }
});

it('keeps known usage and a specific reason at the full 128000-token limit without an automatic paid retry',async()=>{
 let calls=0;const events:any[]=[];
 const provider=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder',AI_REASONING_PROFILE:'quality'}),{transport:async params=>{
  const planning=++calls===1;
  return {status:planning?'completed':'incomplete',incomplete_details:planning?null:{reason:'max_output_tokens'},error:null,output:[],
   output_text:planning?JSON.stringify({action:'answer',query:''}):'{"message":"partial',usage:{input_tokens:100,output_tokens:planning?10:128000}} as never;
 }});
 await expect(provider.complete(request,new AbortController().signal,undefined,{onOperation:e=>events.push(e)})).rejects.toMatchObject({code:'AI_INCOMPLETE',message:expect.stringContaining('предела длины')});
 expect(calls).toBe(2);
 expect(events).toContainEqual(expect.objectContaining({id:'generate',state:'started',metadata:expect.objectContaining({maxOutputTokens:128000})}));
 expect(events).toContainEqual(expect.objectContaining({id:'generate',state:'completed',usage:{inputTokens:100,outputTokens:128000},metadata:expect.objectContaining({incompleteReason:'max_output_tokens'})}));
});
