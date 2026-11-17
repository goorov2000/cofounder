import {expect,it} from 'vitest';
import {OpenAIProvider,estimateMaxCost,hasUnfulfilledPromise,usageCost} from '../../server/provider.js';
import {MODEL_OUTPUT_BYTES} from '../../shared/transportLimits.js';
import {loadConfig} from '../../server/config.js';
import type {ChatRequest} from '../../shared/types.js';
const request:ChatRequest={requestId:'request-recovery',projectId:'project-recovery',moduleId:'audience',intent:'message',message:'Все рестораны России',context:{name:'Test',description:'',facts:[],artifacts:[],history:[]}};
const good={message:'Сегменты — гипотезы:\n- Одиночные кафе: доступен владелец, проверяем ручной график.\n- Небольшие сети: больше смен, сложнее доступ.\nПервый тест — интервью о последнем составлении графика.',choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[]};
const config=loadConfig({OPENAI_API_KEY:'test-placeholder'});
const response=(value:unknown)=>({status:'completed',error:null,output:[],output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:50}} as never);
it('repairs a dangling promise once, resets preview and accounts both paid generations',async()=>{
 const operations:unknown[]=[],calls:unknown[]=[],deltas:string[]=[],resets:number[]=[];
 const provider=new OpenAIProvider(config,{transport:async(params,_signal,onText)=>{calls.push(params);if(calls.length===1)return response({action:'answer',query:''});const value=calls.length===2?{...good,message:'Ниже сравнение — гипотезы.'}:good;onText?.(value.message);return response(value);}});
 const result=await provider.complete(request,new AbortController().signal,d=>deltas.push(d),{onTextReset:()=>resets.push(deltas.length),onOperation:e=>operations.push(e)});
 expect(result.reply.message).toBe(good.message);expect(calls).toHaveLength(3);expect(resets).toEqual([1]);expect(result.usage).toEqual({inputTokens:300,outputTokens:150});
 expect(operations).toContainEqual(expect.objectContaining({id:'generate',state:'completed',metadata:expect.objectContaining({validation:'failed'})}));
 expect(operations).toContainEqual(expect.objectContaining({id:'generate-repair',state:'completed',metadata:expect.objectContaining({previousValidation:'failed',validation:'passed'})}));
 expect(result.costUsd).toBeLessThan(estimateMaxCost(request,config));
 const repair=calls[2] as {input:string};expect(JSON.parse(repair.input).validationIssue.rule).toBe('unfulfilled_result_promise');
});
it('rejects a second invalid response without a third attempt or leaking rejected raw',async()=>{
 let count=0;const resets:unknown[]=[];
 const provider=new OpenAIProvider(config,{transport:async()=>response(++count===1?{action:'answer',query:''}:{...good,message:'Цена 5\u000000 рублей'})});
 await expect(provider.complete(request,new AbortController().signal,undefined,{onTextReset:()=>resets.push(1)})).rejects.toMatchObject({code:'INVALID_RESPONSE',status:502});
 expect(count).toBe(3);expect(resets).toHaveLength(2);
});
it('does not mistake an actual comparison or a question for an empty promise',()=>{
 expect(hasUnfulfilledPromise(good)).toBe(false);expect(hasUnfulfilledPromise({...good,message:'Как сейчас составляете график?'})).toBe(false);
 expect(hasUnfulfilledPromise({...good,message:'Ниже сравнение — гипотезы.'})).toBe(true);
});
it('reserves the full JSON escape expansion of a malformed output before repairing it',async()=>{
 let count=0,repairInputBytes=0,repairReserve=0;
 const provider=new OpenAIProvider(config,{transport:async params=>{
  count++;if(count===1)return response({action:'answer',query:''});
  if(count===2)return {...response(good) as object,output_text:'\u0000'.repeat(MODEL_OUTPUT_BYTES)} as never;
  repairInputBytes=Buffer.byteLength(String(params.input),'utf8');return response(good);
 }});
 await provider.complete(request,new AbortController().signal,undefined,{onOperation:event=>{if(event.id==='generate-repair'&&event.state==='started')repairReserve=event.reservedUsd!;}});
 expect(repairInputBytes).toBeGreaterThanOrEqual(6*MODEL_OUTPUT_BYTES);
 expect(repairReserve).toBeGreaterThan(usageCost({inputTokens:repairInputBytes,outputTokens:config.maxOutputTokens},config));
});
it('repairs a compound historical tariff claim into separately grounded claims without losing sources',async()=>{
 const evidence={projectId:request.projectId,moduleId:request.moduleId,generation:0,id:'web-repair-source',version:1,requestId:'historical-read',operationId:'read-1',url:'https://vendor.example/pricing',title:'Plans',retrievedAt:'2026-11-15T00:00:00.000Z',publishedAt:null,effectiveAt:null,retrieval:'read' as const,contentHash:'a'.repeat(64),quotes:[{id:'quote-one',text:'Basic 1000 RUB per month',start:0,end:25},{id:'quote-two',text:'Pro 2000 RUB per month',start:26,end:49}],limitations:[]};
 const first={text:'Basic 1000 RUB; Pro 2000 RUB',evidenceId:evidence.id,version:1,quoteId:'quote-one',price:null};
 const claims=[{...first,text:'Basic 1000 RUB'},{...first,text:'Pro 2000 RUB',quoteId:'quote-two'}];
 let count=0;const operations:unknown[]=[];
 const provider=new OpenAIProvider(config,{transport:async params=>{count++;if(count===1)return response({action:'answer',query:''});if(count===3){const input=JSON.parse(String(params.input));expect(input.rejectedOutput).toContain('2000');expect(input.validationIssue.path).toEqual(['externalClaims',0,'text']);expect(input.validationIssue.relatedIssues).toContainEqual({path:['artifactDraft','body'],rule:'unprovided_url'});expect(params.instructions).toContain('не восстанавливай путь');}return response({...good,artifactDraft:{title:'Сравнение тарифов',body:count===2?'https://invented.example/price':evidence.url},externalClaims:(count===2?[first]:claims).map(claim=>({...claim,evidenceId:'source_1'}))});}});
 const result=await provider.complete(request,new AbortController().signal,undefined,{trustedEvidence:[evidence],onOperation:event=>operations.push(event)});
 expect(result.reply.externalClaims).toEqual(claims);expect(result.reply.externalSources).toEqual([evidence]);
 expect(operations).toContainEqual(expect.objectContaining({id:'generate',state:'completed',metadata:expect.objectContaining({validation:'failed'})}));
 expect(operations).toContainEqual(expect.objectContaining({id:'generate-repair',state:'completed',metadata:expect.objectContaining({validation:'passed'})}));
});
