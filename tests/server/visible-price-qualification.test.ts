import{readFileSync}from'node:fs';
import{expect,it}from'vitest';
import{OpenAIProvider,missingVisiblePriceQualification}from'../../server/provider';
import{loadConfig}from'../../server/config';
import{validateReply}from'../../server/validation';
import type{AssistantReply,ChatRequest}from'../../shared/types';
const fixture=JSON.parse(readFileSync('tests/server/fixtures/price-components/android-visible-omission.json','utf8'))as{request:ChatRequest;raw:Record<string,unknown>;reply:AssistantReply};
const correct=(message:string)=>message.replace('Опция геометок — 150 ₽ в месяц за сотрудника.','Опция геометок — 150 ₽ в месяц за сотрудника, только Android.');
it('detects the exact actual visible omission and accepts its explicit price-linked platform, including artifact body',()=>{
 const {knowledgeSources:_serverKnowledge,...serverReply}=fixture.reply;
 expect(validateReply(serverReply,fixture.request,fixture.reply.externalSources).externalClaims).toHaveLength(7);
 expect(missingVisiblePriceQualification(fixture.reply)).toEqual({path:['message'],rule:'missing_visible_price_qualification'});
 expect(missingVisiblePriceQualification({...fixture.reply,message:correct(fixture.reply.message)})).toBeUndefined();
 expect(missingVisiblePriceQualification({...fixture.reply,message:'Сравнение подготовлено.',artifactDraft:{title:'Сравнение',body:fixture.reply.message}})).toEqual({path:['artifactDraft','body'],rule:'missing_visible_price_qualification'});
});
it('does not use an unrelated own Android hypothesis as external qualification, or require it for an own-only scenario',()=>{
 expect(missingVisiblePriceQualification({...fixture.reply,message:fixture.reply.message+'\nНаша гипотеза — приложение только для Android.'})).toBeDefined();
 expect(missingVisiblePriceQualification({...fixture.reply,message:'Наша гипотеза — опция по150 ₽ за сотрудника, только Android.'})).toBeUndefined();
 const claim=fixture.reply.externalClaims!.find(c=>c.price?.amount==='150')!;
 const dual={...fixture.reply,message:'| Базовая подписка |150 ₽ за сотрудника |\n| Дополнительная опция |150 ₽ за сотрудника, только Android |',externalClaims:[claim]};
 expect(missingVisiblePriceQualification(dual)).toBeUndefined();
 expect(missingVisiblePriceQualification({...dual,externalClaims:[{...claim,text:claim.text.replace('; только Android.','.') }]})).toBeUndefined();
});
it('repairs the actual output once with all claims and canonical references preserved, charging and tracing both outcomes',async()=>{
 let calls=0;const events:any[]=[],resets:number[]=[];const response=(v:unknown)=>({status:'completed',error:null,output:[],output_text:JSON.stringify(v),usage:{input_tokens:100,output_tokens:50}}as never);
 const provider=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'}),{transport:async(params,_signal,onText)=>{
  calls++;if(calls===1)return response({action:'answer',query:''});
  if(calls===3)expect(JSON.parse(String(params.input)).validationIssue).toEqual({path:['message'],rule:'missing_visible_price_qualification'});
  const raw={...fixture.raw,message:calls===2?fixture.reply.message:correct(fixture.reply.message)};onText?.(String(raw.message));return response(raw);
 }});
 const result=await provider.complete(fixture.request,new AbortController().signal,()=>{}, {trustedEvidence:fixture.reply.externalSources,onTextReset:()=>resets.push(1),onOperation:e=>events.push(e)});
 expect(calls).toBe(3);expect(resets).toHaveLength(1);expect(result.reply.externalClaims).toEqual(fixture.reply.externalClaims);expect(result.reply.message).toContain('только Android');
 expect(events.filter(e=>e.kind==='generate'&&e.state==='completed').map(e=>e.metadata.validation)).toEqual(['failed','passed']);expect(result.usage).toEqual({inputTokens:300,outputTokens:150});
});

it('keeps currencies and ambiguous same-price components isolated without guessing source identity',()=>{
 const claim=fixture.reply.externalClaims!.find(c=>c.price?.amount==='150')!,source=fixture.reply.externalSources!.find(s=>s.id===claim.evidenceId)!;
 const usdText='Другая опция150USD за сотрудника в месяц.',usdSource={...source,id:'usd-source',quotes:[{id:'quote-1',text:usdText,start:0,end:usdText.length}]};
 const usdClaim={...claim,evidenceId:usdSource.id,quoteId:'quote-1',text:usdText,price:{...claim.price!,currency:'USD'}};
 const fixed={...fixture.reply,message:'Опция150RUB за сотрудника — только Android.\nДругая опция150USD за сотрудника.',externalSources:[source,usdSource],externalClaims:[claim,usdClaim]};
 expect(missingVisiblePriceQualification(fixed)).toBeUndefined();
 expect(missingVisiblePriceQualification({...fixed,message:'Опция150RUB за сотрудника.\nДругая опция150USD за сотрудника — только Android.'})).toBeDefined();
 const otherText='Дополнительная опция для iOS 150RUB за сотрудника в месяц.',other={...source,id:'another-source',quotes:[{id:'quote-1',text:otherText,start:0,end:otherText.length}]};
 const competing={...claim,evidenceId:other.id,quoteId:'quote-1',text:'Дополнительная опция для iOS 150RUB за сотрудника в месяц.'};
 expect(missingVisiblePriceQualification({...fixed,message:'Опция150RUB за сотрудника.',externalSources:[source,other],externalClaims:[claim,competing]})).toBeUndefined();
});
