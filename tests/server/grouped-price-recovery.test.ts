import {readFileSync}from'node:fs';
import {expect,it}from'vitest';
import type OpenAI from'openai';
import {OpenAIProvider}from'../../server/provider.js';
import {loadConfig}from'../../server/config.js';
import type {ChatRequest,ExternalEvidence}from'../../shared/types.js';
import type{OperationEvent}from'../../server/ledger.js';
type Raw={message:string;artifactDraft:{title:string;body:string}|null;externalClaims:Array<{text:string;evidenceId:string;version:number;quoteId:string;price:null|{amount:string;currency:string;unit:string;period:string;paymentTerms:string}}>};
const fixture=JSON.parse(readFileSync('tests/server/fixtures/grouped-price-own-price-02.json','utf8')) as {request:ChatRequest;raw:Raw;evidence:ExternalEvidence[]};
const corrected='В прочитанных материалах обнаружены два разных тарифа: 5000 RUB за пользователя в месяц при предоплате за 12 месяцев и 7000 RUB за пользователя в месяц при помесячной оплате. Наша цена 5000 рублей за точку в месяц остаётся отдельной гипотезой.';
const config=loadConfig({OPENAI_API_KEY:'test-placeholder'});
const response=(value:unknown)=>({status:'completed',error:null,output:[],output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:100}} as unknown as OpenAI.Responses.Response);
async function run(first:Raw,second:Raw,evidence=fixture.evidence){
 let calls=0;const events:OperationEvent[]=[],inputs:unknown[]=[];const before=JSON.stringify(fixture.request);
 const provider=new OpenAIProvider(config,{transport:async params=>{calls++;inputs.push(params.input);if(calls===1)return response({action:'answer',query:''});const modelReply=structuredClone(calls===2?first:second);const identities=[...new Map(evidence.map(source=>[JSON.stringify([source.id,source.version]),source])).values()];modelReply.externalClaims=modelReply.externalClaims.map(claim=>({...claim,evidenceId:`source_${identities.findIndex(source=>source.id===claim.evidenceId&&source.version===claim.version)+1}`}));return response(modelReply);}});
 const result=await provider.complete(fixture.request,new AbortController().signal,undefined,{trustedEvidence:evidence,onOperation:event=>events.push(event)});
 expect(JSON.stringify(fixture.request)).toBe(before);return {calls,events,inputs,result};
}
it('repairs the exact historical 5000/5000 group into supported 5000/7000 while preserving all claims and own price',async()=>{
 const fixed={...fixture.raw,message:corrected};const r=await run(fixture.raw,fixed);
 expect(r.calls).toBe(3);expect(r.result.reply.message).toBe(corrected);expect(r.result.reply.externalClaims).toEqual(fixture.raw.externalClaims);
 expect(JSON.parse(String(r.inputs[2])).validationIssue).toEqual({path:['message'],rule:'unsupported_grouped_price'});
 expect(r.events).toContainEqual(expect.objectContaining({id:'generate',state:'completed',metadata:expect.objectContaining({validation:'failed',validationIssue:{path:['message'],rule:'unsupported_grouped_price'}})}));
 expect(r.events).toContainEqual(expect.objectContaining({id:'generate-repair',state:'completed',metadata:expect.objectContaining({validation:'passed'})}));
 expect(fixture.request.coreContext!.entries.find(e=>e.key==='price')?.text).toContain('5000 рублей за точку в месяц');
});
it('checks the user-visible draft body independently of a correct message',async()=>{
 const first={...fixture.raw,message:corrected,artifactDraft:{title:'Сравнение',body:fixture.raw.message}};
 const fixed={...first,artifactDraft:{title:'Сравнение',body:corrected}};const r=await run(first,fixed);
 expect(r.calls).toBe(3);expect(JSON.parse(String(r.inputs[2])).validationIssue).toEqual({path:['artifactDraft','body'],rule:'unsupported_grouped_price'});
 expect(r.result.reply.externalClaims).toEqual(fixture.raw.externalClaims);
});
it('allows two actual equal amounts from distinct supported quotes, including equivalent numeric spelling',async()=>{
 for(const formattedAmount of ['5000','5 000 RUB']) {
 const same=structuredClone(fixture.raw),evidence=structuredClone(fixture.evidence);const claim=same.externalClaims.find(c=>c.price?.amount==='7000')!;claim.price!.amount='5000';claim.text=claim.text.replaceAll('7000','5000');
 const source=evidence.find(s=>s.id===claim.evidenceId)!;source.quotes=source.quotes.map(q=>({...q,text:q.text.replaceAll('7000','5000')}));
 same.message='В прочитанных материалах обнаружены два тарифа по 5 000 RUB за пользователя в месяц, но с разными условиями оплаты.';
 claim.price!.amount=formattedAmount;
 const r=await run(same,same,evidence);expect(r.calls).toBe(2);expect(r.result.reply.externalClaims).toEqual(same.externalClaims);
 }
});
it('allows an actual different-price comparison and does not reassign our nonsource hypothesis to external tariffs',async()=>{
 for(const message of [corrected,'Наша гипотеза — два тарифа по 5000 рублей за точку в месяц. Это наш сценарий, не вывод из внешних опубликованных тарифов.','Наша опубликованная гипотеза — два тарифа по 5000 рублей за точку в месяц, а не два подтверждённых внешних тарифа.']){
  const raw={...fixture.raw,message};const r=await run(raw,raw);expect(r.calls).toBe(2);expect(r.result.reply.externalClaims).toEqual(fixture.raw.externalClaims);
 }
});
it('does not count duplicate references to the same evidence/quote as two supported tariffs',async()=>{
 const duplicated={...fixture.raw,externalClaims:[fixture.raw.externalClaims[0],fixture.raw.externalClaims[0]]};const fixed={...duplicated,message:'В прочитанных материалах подтверждён один тариф 5000 RUB за пользователя в месяц с предоплатой за 12 месяцев; два одинаковых references не являются двумя тарифами.'};
 const r=await run(duplicated,fixed);expect(r.calls).toBe(3);expect(JSON.parse(String(r.inputs[2])).validationIssue.rule).toBe('unsupported_grouped_price');
});

it('fails closed after the same unsupported group survives the only repair, with a specific safe explanation',async()=>{
 await expect(run(fixture.raw,fixture.raw)).rejects.toMatchObject({code:'INVALID_RESPONSE',status:502,message:expect.stringContaining('Обобщение внешних цен не подтверждено')});
});

it('allows two distinct supported tariffs in one sufficient read quote without counting an exact duplicate twice',async()=>{
 const source=structuredClone(fixture.evidence.find(s=>s.id===fixture.raw.externalClaims[0].evidenceId)!);
 source.quotes=[{id:'quote-shared-plans',text:'Basic: 5000 RUB в месяц. Pro: 5000 RUB в месяц.',start:0,end:47}];
 const claim=(plan:string)=>({text:`${plan}: 5000 RUB в месяц.`,evidenceId:source.id,version:source.version,quoteId:'quote-shared-plans',price:{amount:'5000',currency:'RUB',unit:'unknown',period:'в месяц',paymentTerms:'unknown'}});
 const basic=claim('Basic'),pro=claim('Pro');
 const raw={...fixture.raw,message:'Обнаружены два тарифа по 5000 RUB в месяц: Basic и Pro.',externalClaims:[basic,pro]};
 const valid=await run(raw,raw,[source]);expect(valid.calls).toBe(2);expect(valid.result.reply.externalClaims).toEqual([basic,pro]);
 const duplicate={...raw,message:'Обнаружены два тарифа по 5000 RUB в месяц: Basic и Basic.',externalClaims:[basic,structuredClone(basic)]};
 const correction={...duplicate,message:'Обнаружен тариф Basic: 5000 RUB в месяц; повтор того же утверждения не означает второй тариф.'};
 const repaired=await run(duplicate,correction,[source]);expect(repaired.calls).toBe(3);expect(JSON.parse(String(repaired.inputs[2])).validationIssue.rule).toBe('unsupported_grouped_price');
});

it('repairs the full03 observed wording without treating an own scenario as observed evidence',async()=>{
 const {message}=JSON.parse(readFileSync('tests/server/fixtures/full03-grouped-price-message.json','utf8')) as {message:string};
 const r=await run({...fixture.raw,message},{...fixture.raw,message:corrected});
 expect(r.calls).toBe(3);expect(JSON.parse(String(r.inputs[2])).validationIssue.rule).toBe('unsupported_grouped_price');
 expect(r.result.reply.externalClaims).toEqual(fixture.raw.externalClaims);
 for(const message of ['Нашёл вариант: наша гипотеза — два тарифа по 5000 рублей за точку в месяц.','Наша проверенная гипотеза — два тарифа по 5000 рублей за точку в месяц.'])expect((await run({...fixture.raw,message},{...fixture.raw,message})).calls).toBe(2);
});
it('does not reject a direct negation of the grouped observation',async()=>{
 for(const message of ['В проверенных материалах я не нашёл два тарифа по 5000 RUB: один 5000, другой 7000.','В прочитанных материалах не найдены два тарифа по 5000 RUB: суммы различаются.']){
  const r=await run({...fixture.raw,message},{...fixture.raw,message});expect(r.calls).toBe(2);
 }
});
it('requires both grouped prices to support an explicitly stated currency',async()=>{
 const raw=structuredClone(fixture.raw),evidence=structuredClone(fixture.evidence),claim=raw.externalClaims.find(c=>c.price?.amount==='7000')!;
 claim.price!.amount='5000';claim.price!.currency='USD';claim.text=claim.text.replaceAll('7000 RUB','5000 USD');
 const source=evidence.find(s=>s.id===claim.evidenceId)!;source.quotes=source.quotes.map(q=>({...q,text:q.text.replaceAll('7000 RUB','5000 USD')}));
 raw.message='В проверенных страницах нашёл два тарифа по 5000 RUB за пользователя в месяц.';
 const fixed={...raw,message:'В проверенных страницах нашёл разные предложения: 5000 RUB и 5000 USD за пользователя в месяц; валюты различаются.'};
 const r=await run(raw,fixed,evidence);expect(r.calls).toBe(3);expect(JSON.parse(String(r.inputs[2])).validationIssue.rule).toBe('unsupported_grouped_price');expect(r.result.reply.externalClaims).toEqual(raw.externalClaims);
});
it('preserves a bare dollar sign without inferring the USD ISO code in a grouped price',async()=>{
 const source=structuredClone(fixture.evidence.find(s=>s.id===fixture.raw.externalClaims[0].evidenceId)!);
 for(const denomination of ['$','USD']){
  const text=`Basic: 5000 ${denomination} в месяц. Pro: 5000 ${denomination} в месяц.`;
  source.quotes=[{id:'quote-currency',text,start:0,end:text.length}];
  const claim=(plan:string)=>({text:`${plan}: 5000 ${denomination} в месяц.`,evidenceId:source.id,version:source.version,quoteId:'quote-currency',price:{amount:'5000',currency:denomination,unit:'unknown',period:'в месяц',paymentTerms:'unknown'}});
  const claims=[claim('Basic'),claim('Pro')];
  const valid={...fixture.raw,message:`В проверенных материалах обнаружены два тарифа по 5000 ${denomination} в месяц: Basic и Pro.`,externalClaims:claims};
  const accepted=await run(valid,valid,[source]);expect(accepted.calls).toBe(2);expect(accepted.result.reply.externalClaims).toEqual(claims);
  if(denomination==='$'){
   const wrong={...valid,message:'В проверенных материалах обнаружены два тарифа по 5000 USD в месяц: Basic и Pro.'};
   const repaired=await run(wrong,valid,[source]);expect(repaired.calls).toBe(3);expect(JSON.parse(String(repaired.inputs[2])).validationIssue).toEqual({path:['message'],rule:'unsupported_grouped_price'});
   expect(repaired.result.reply.message).toBe(valid.message);expect(repaired.result.reply.externalClaims).toEqual(claims);
   expect(repaired.events).toContainEqual(expect.objectContaining({id:'generate',state:'completed',metadata:expect.objectContaining({validation:'failed'})}));
   expect(repaired.events).toContainEqual(expect.objectContaining({id:'generate-repair',state:'completed',metadata:expect.objectContaining({validation:'passed'})}));
  }
 }
});
