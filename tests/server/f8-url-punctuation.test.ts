import {expect,it} from 'vitest';
import {validateReply} from '../../server/validation';
import type {ChatRequest,ExternalEvidence} from '../../shared/types';
const request:ChatRequest={requestId:'punct-request',projectId:'punct-project',moduleId:'idea',intent:'message',message:'Сравни',context:{name:'Тест',description:'',history:[],facts:[],artifacts:[]}};
const url='https://vendor.example/pricing/';
const source:ExternalEvidence={projectId:request.projectId,moduleId:'idea',generation:0,id:'source',version:1,requestId:request.requestId,operationId:'read',url,title:'Тариф',retrievedAt:'2026-11-15T00:00:00Z',publishedAt:null,effectiveAt:null,retrieval:'read',contentHash:'fixture',quotes:[{id:'q',text:'Тариф 5000 RUB в месяц',start:null,end:null}],limitations:[]};
const reply=(message:string)=>({message,choices:[],artifactDraft:null,proposedFacts:[],externalSources:[source]});
it('accepts exact URLs inside matched inline code delimiters in request and reply, never changing paths or explicit destinations',()=>{
 for(const marker of ['`','``']) {
  const message=`Источник ${marker}${url}${marker}`;
  expect(validateReply(reply(message),request,[source]).message).toBe(message);
  expect(validateReply(reply(message+'.'),request,[source]).message).toBe(message+'.');
  const user={...request,message};
  expect(validateReply({message:url,choices:[],artifactDraft:null,proposedFacts:[]},user).message).toBe(url);
  expect(()=>validateReply(reply(`${marker}${url}wrong${marker}`),request,[source])).toThrow();
 }
 expect(()=>validateReply(reply(`[Тариф](${url}\u0060)`),request,[source])).toThrow();
});
it('accepts conventional trailing prose punctuation only for an exactly provided URL, without changing text',()=>{
 for(const punctuation of ['.',',',';',':','!','?']){
  const value=reply(`Источник: ${url}${punctuation}`);
  expect(validateReply(value,request,[source]).message).toBe(value.message);
  const draft={...value,artifactDraft:{title:'Сравнение',body:value.message}};
  expect(validateReply(draft,request,[source]).artifactDraft!.body).toBe(value.message);
 }
 expect(validateReply(reply(`[Тариф](${url}).`),request,[source]).message).toBe(`[Тариф](${url}).`);
});
it('does not fix invented URLs, changed paths/queries, explicit Markdown destinations or structured sourceUrl',()=>{
 for(const bad of ['https://unknown.example/pricing/.',url+'extra.',url+'?amount=7000.',url+'.evil.'])expect(()=>validateReply(reply(bad),request,[source])).toThrow();
 for(const explicit of [`[Тариф](${url}.)`,`<${url}.>`])expect(()=>validateReply(reply(explicit),request,[source])).toThrow();
 const value={...reply('Готово'),proposedFacts:[{key:'price',value:'неизвестно',note:'',provenance:'unknown',sourceUrl:url+'.'}]};
 expect(()=>validateReply(value,request,[source])).toThrow();
});
it('preserves exact provided URLs that themselves end with punctuation',()=>{
 const special={...source,url:'https://vendor.example/file.'};
 expect(validateReply({...reply(`Источник: ${special.url}`),externalSources:[special]},request,[special]).message).toBe(`Источник: ${special.url}`);
});

it('recognizes the same user-supplied plain prose URL with punctuation in message/history without pretending it was read',()=>{
 const value={message:`Источник: ${url}`,choices:[],artifactDraft:null,proposedFacts:[]};
 const current={...request,message:`Источник ${url}.`};
 expect(validateReply(value,current).message).toBe(value.message);
 const historical={...request,context:{...request.context,history:[{role:'user' as const,content:`Ссылка ${url}, используй её.`}]}};
 expect(validateReply(value,historical).message).toBe(value.message);
 expect(validateReply(value,current).externalSources).toBeUndefined();
 const structured={...request,context:{...request.context,facts:[{key:'source',value:'неизвестно',note:'',provenance:'user' as const,sourceUrl:url+'.'}]}};
 expect(()=>validateReply(value,structured)).toThrow();
});

it('accepts an exact URL quoted by a trusted real result without pretending the linked target was read',()=>{
 const legal='https://vendor.example/legal/';
 const read={...source,quotes:[{id:'q',text:`Тариф 5000 RUB в месяц. Условия: ${legal}`,start:null,end:null}]};
 const value={...reply(`В прочитанном фрагменте есть ссылка: ${legal}.`),externalSources:[read]};
 expect(validateReply(value,request,[read]).message).toBe(value.message);
 const fabricated={...value,externalClaims:[{text:'Цена 5000 RUB',evidenceId:'legal-page',version:1,quoteId:'q',price:null}]};
 expect(()=>validateReply(fabricated,request,[read])).toThrow();
 expect(()=>validateReply({...value,message:'https://vendor.example/unknown/'},request,[read])).toThrow();
 const forged={...read,quotes:[{...read.quotes[0],text:'Подменённый результат https://vendor.example/unknown/'}]};
 expect(()=>validateReply({...value,externalSources:[forged]},request,[read])).toThrow();
});
