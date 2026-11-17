import {readFileSync}from'node:fs';
import {expect,it}from'vitest';
import {contradictoryUnknownCurrency,OpenAIProvider}from'../../server/provider.js';
import {loadConfig}from'../../server/config.js';
import type {AssistantReply,ChatRequest,ExternalEvidence}from'../../shared/types.js';
const fixture=JSON.parse(readFileSync('tests/server/fixtures/ui03-currency-unknown.json','utf8')) as {raw:AssistantReply;evidence:ExternalEvidence[]};
const reply=()=>({...structuredClone(fixture.raw),externalSources:structuredClone(fixture.evidence)});
it('detects the actual UI03 per-attribute contradiction while preserving unknown unit and period',()=>{
 expect(contradictoryUnknownCurrency(reply())).toEqual({path:['message'],rule:'contradictory_unknown_currency'});
 const fixed=reply();fixed.message='Plansmen показывает цены в ₽; периодичность и единица цены в этих цитатах не установлены.';
 expect(contradictoryUnknownCurrency(fixed)).toBeUndefined();
 fixed.artifactDraft={title:'Тарифы',body:fixture.raw.message};expect(contradictoryUnknownCurrency(fixed)?.path).toEqual(['artifactDraft','body']);
});
it('does not infer currency for a different provider, mixed plan, ISO code, jurisdiction or own scenario',()=>{
 for(const message of ['В карточках Yuma валюта не указана в цитатах.','В карточке плана «Особый» Plansmen валюта неизвестна.','Plansmen: в цитатах ISO-код валюты не указан, знак ₽ сохранён.','Plansmen: в цитатах юрисдикция валюты не установлена.','Наша гипотеза для Plansmen: валюта тарифа неизвестна.','В цитатах валюта не указана.','Plansmen указал ₽, а для Yuma валюта тарифа неизвестна.','Plansmen: для Yuma валюта тарифов неизвестна.','Plansmen: в карточке плана Enterprise валюта неизвестна.','Plansmen: валюта остальных тарифов в цитатах неизвестна.','Plansmen и Yuma: валюта тарифов в цитатах неизвестна.']){
  const r=reply();r.message=message;r.artifactDraft=null;expect(contradictoryUnknownCurrency(r),message).toBeUndefined();
 }
 const mixed=reply();mixed.externalClaims!.find(c=>c.price)!.price!.currency='unknown';expect(contradictoryUnknownCurrency(mixed)).toBeUndefined();
 const other=reply();other.message='Plansmen и Quick Resto: валюта тарифов не указана в цитатах.';expect(contradictoryUnknownCurrency(other)).toBeUndefined();
});
it('uses the existing single repair with all actual claims preserved and both validations traced',async()=>{
 const request:ChatRequest={requestId:'currency-recovery',projectId:fixture.evidence[0].projectId,moduleId:'audience',intent:'message',message:'Сравни тарифы',context:{name:'Test',description:'',facts:[],artifacts:[],history:[]}};
 const fixed=reply();fixed.message='Plansmen показывает цены в ₽; периодичность и единица цены в этих цитатах не установлены.';
 const inputs:unknown[]=[],events:unknown[]=[];let resets=0;
 const provider=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'}),{transport:async params=>{
  inputs.push(params.input);const raw=structuredClone(inputs.length===2?fixture.raw:fixed) as AssistantReply&{memoryOperations:unknown[]};
  const sources=[...new Map(fixture.evidence.map(s=>[JSON.stringify([s.id,s.version]),s])).values()];
  raw.externalClaims=raw.externalClaims!.map(c=>({...c,evidenceId:`source_${sources.findIndex(s=>s.id===c.evidenceId&&s.version===c.version)+1}`}));
  return {status:'completed',error:null,output:[],output_text:JSON.stringify(inputs.length===1?{action:'answer',query:''}:raw),usage:{input_tokens:100,output_tokens:100}} as never;
 }});
 const result=await provider.complete(request,new AbortController().signal,undefined,{trustedEvidence:fixture.evidence,onTextReset:()=>resets++,onOperation:e=>events.push(e)});
 expect(inputs).toHaveLength(3);expect(resets).toBe(1);expect(JSON.parse(String(inputs[2])).validationIssue).toEqual({path:['message'],rule:'contradictory_unknown_currency'});
 expect(result.reply.externalClaims).toEqual(fixture.raw.externalClaims);
 expect(events).toContainEqual(expect.objectContaining({id:'generate',state:'completed',metadata:expect.objectContaining({validation:'failed',validationIssue:{path:['message'],rule:'contradictory_unknown_currency'}})}));
 expect(events).toContainEqual(expect.objectContaining({id:'generate-repair',state:'completed',metadata:expect.objectContaining({validation:'passed'})}));
});
