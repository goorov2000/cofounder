import{readFileSync}from'node:fs';
import{expect,it}from'vitest';
import{OpenAIProvider,hasUnfulfilledPromise}from'../../server/provider.js';
import{recoveryFailure}from'../../server/errors.js';
import{loadConfig}from'../../server/config.js';
import type{ChatRequest}from'../../shared/types.js';
const raw=JSON.parse(readFileSync('tests/server/fixtures/k02-dash-promise.json','utf8'));
const request:ChatRequest={requestId:'k02-dash-request',projectId:'k02-dash-project',moduleId:'audience',intent:'message',message:'Все рестораны России',context:{name:'Test',description:'География проекта — вся Россия. Первый пилот — одно кафе в Самаре.',facts:[],artifacts:[],history:[]}};
const result=(value:unknown)=>({status:'completed',error:null,output:[],output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:50}}as never);
const valid={...raw,message:'Ниже — сравнение гипотез, не доказанный спрос.\n| Сегмент | Ситуация | Первый тест |\n|---|---|---|\n| Независимые кафе | Ручные смены | Пилот в Самаре |\n| Небольшие сети | Несколько точек | Доступ неизвестен |\nГеография проекта — вся Россия; Самара — место пилота.'};
it('catches exact full02 K02 dash promise despite its short recommendation and repairs to an actual comparison',async()=>{
 expect(hasUnfulfilledPromise(raw)).toBe(true);let calls=0;let issue:unknown;
 const provider=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'}),{transport:async params=>{calls++;if(calls===1)return result({action:'answer',query:''});if(calls===3)issue=JSON.parse(String(params.input)).validationIssue;return result(calls===2?raw:valid);}});
 const response=await provider.complete(request,new AbortController().signal);expect(calls).toBe(3);expect(issue).toEqual({path:['message'],rule:'unfulfilled_result_promise'});expect(response.reply.message).toBe(valid.message);
});
it('allows actual useful comparison structures and a short concrete recommendation that promises no missing result',()=>{
 for(const reply of [valid,{...raw,message:'Ниже — сравнение гипотез.',artifactDraft:{title:'Сегменты',body:valid.message}},{...raw,message:'Ниже — сравнение гипотез.\n1. Кафе: ручной график, один контакт для теста.\n2. Сети: несколько точек, доступ неизвестен.'},{...raw,message:'Для первого пилота рекомендую небольшие кафе Самары: там уже есть контакт. География проекта остаётся всей Россией.'}])expect(hasUnfulfilledPromise(reply)).toBe(false);
});
it('reports a URL grounding failure accurately for a message, draft body or related issue',()=>{
 for(const issue of [{path:['message'],rule:'unprovided_url'},{path:['artifactDraft','body'],rule:'unprovided_url'},{path:['externalClaims',0,'text'],rule:'ungrounded_quantity',relatedIssues:[{path:['message'],rule:'unprovided_url'}]}]){
  const error=recoveryFailure('audience',issue);expect(error.code).toBe('INVALID_RESPONSE');expect(error.message.toLocaleLowerCase('ru')).toContain('ссылка');expect(error.message).not.toContain('полноты');expect(error.message).not.toContain('https://');
 }
});
