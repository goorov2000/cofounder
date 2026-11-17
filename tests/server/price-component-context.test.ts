import {readFileSync}from'node:fs';
import{expect,it,vi}from'vitest';
import type OpenAI from'openai';
import{OpenAIProvider,type ResponseTransport}from'../../server/provider.js';
import{loadConfig}from'../../server/config.js';
import{extractPage,type ReadPage}from'../../server/publicReader.js';
import{pageEvidence}from'../../server/research.js';
import type{ChatRequest,ExternalEvidence}from'../../shared/types.js';
const request:ChatRequest={requestId:'component-case',projectId:'component-project',moduleId:'competitors',intent:'message',message:'Найди официальный тариф: отдели базовую подписку от опций, сохрани единицу, период и существенные условия.',context:{name:'Графики смен',description:'',facts:[],artifacts:[],history:[]}};
const response=(value:unknown,output:unknown[]=[])=>({status:'completed',error:null,output,output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:40}})as OpenAI.Responses.Response;
const actual=JSON.parse(readFileSync('tests/server/fixtures/price-components/geotabel-read.json','utf8')).page as ReadPage;
const dual=extractPage('<title>Controlled distinct components</title><p>Базовая подписка: 150 ₽ за сотрудника в месяц.</p><p>Дополнительная опция для Android: 150 ₽ за сотрудника в месяц.</p>','https://controlled.example/components');
function run(page:ReadPage,make:(s:ExternalEvidence)=>unknown){
 const reader=vi.fn(async()=>structuredClone(page));const transport=vi.fn<ResponseTransport>(async params=>{
  if(params.text?.format?.type==='json_schema'&&params.text.format.name==='cofounder_action')return response({action:'research',query:'официальные тарифы графиков смен'});
  if(params.tools)return response('',[{type:'web_search_call',action:{type:'search',sources:[{url:page.url,title:page.title}]}}]);
  const input=JSON.parse(String(params.input));return response(make(input.research.evidence[0]));
 });
 return{reader,transport,promise:new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder',AI_BUDGET_USD:'5'}),{reader,transport}).complete(request,new AbortController().signal)};
}
it('keeps the actual primary read context reproducible and permits a qualified Android option through a real server-read chain',async()=>{
 const evidence=pageEvidence(request,actual,0);
 expect(evidence.quotes[0].text).toContain('Геометки во время смены опция, только Android');
 expect(evidence.quotes[0].text).toContain('150 ₽ в месяц за сотрудника');
 for(const quote of evidence.quotes){expect(actual.text.slice(quote.start!,quote.end!)).toBe(quote.text);expect(quote.text.length).toBeLessThanOrEqual(500);}
 expect(evidence.quotes.some(q=>q.text.includes('Опция для Android: 150 ₽ в месяц за сотрудника'))).toBe(true);
 expect(actual.text.slice(5800,6200)).toContain('Геометки во время смены опция, только Android');
 const chain=run(actual,s=>({message:'150 ₽ в месяц за сотрудника — дополнительная опция для Android, не базовая подписка. На странице также указано 2 900 ₽ в месяц; состав базового пакета из этих цитат неизвестен.',choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[{text:'Опция для Android: 150 ₽ в месяц за сотрудника',evidenceId:s.id,version:s.version,quoteId:s.quotes.find(q=>q.text.includes('Опция для Android: 150 ₽ в месяц за сотрудника'))!.id,price:{amount:'150',currency:'₽',unit:'сотрудника',period:'месяц',paymentTerms:'unknown'}}]}));
 const result=await chain.promise;expect(chain.reader).toHaveBeenCalledTimes(1);expect(chain.transport).toHaveBeenCalledTimes(3);expect(result.reply.externalClaims?.[0]).toMatchObject({evidenceId:result.evidence![0].id,quoteId:expect.any(String)});expect(result.reply.message).toContain('дополнительная опция для Android');
});
it('allows an independently evidenced base and Android add-on with identical amounts, without inferring one component from the other',async()=>{
 const chain=run(dual,s=>({message:'Базовая подписка — 150 ₽ за сотрудника в месяц. Отдельная дополнительная опция для Android — ещё 150 ₽ за сотрудника в месяц.',choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:s.quotes.map(q=>({text:q.text,evidenceId:s.id,version:s.version,quoteId:q.id,price:{amount:'150',currency:'₽',unit:'сотрудника',period:'месяц',paymentTerms:'unknown'}}))}));
 const result=await chain.promise;expect(chain.reader).toHaveBeenCalledTimes(1);expect(chain.transport).toHaveBeenCalledTimes(3);expect(result.reply.externalClaims).toHaveLength(2);expect(new Set(result.reply.externalClaims!.map(c=>c.quoteId)).size).toBe(2);expect(result.reply.externalClaims!.every(c=>c.evidenceId===result.evidence![0].id)).toBe(true);
});
