import {readFileSync}from'node:fs';
import {createHash}from'node:crypto';
import {expect,it}from'vitest';
import {extractPage}from'../../server/publicReader.js';
import {pageEvidence}from'../../server/research.js';
import {OpenAIProvider,estimateMaxCost}from'../../server/provider.js';
import {loadConfig}from'../../server/config.js';
import type {ChatRequest}from'../../shared/types.js';
const fixture=JSON.parse(readFileSync('tests/server/fixtures/provenance-pages.json','utf8')) as {pages:Array<{url:string;fullNormalizedText:string;prefixHash:string;originalUiPrefixHash:string}>};
const request:ChatRequest={requestId:'provenance-request',projectId:'provenance-project',moduleId:'competitors',intent:'message',message:'Сравни источники',context:{name:'Test',description:'',facts:[],artifacts:[],history:[]}};
const html=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
it.each(fixture.pages)('retains exact actual disclosure without replacing the bounded price catalogue: $url',row=>{
 const page=extractPage(html(row.fullNormalizedText),row.url),full=row.fullNormalizedText;
 expect(page.text).toBe(full.slice(0,12000));expect(createHash('sha256').update(page.text).digest('hex')).toBe(row.originalUiPrefixHash);
 expect(page.contentHash).toBe(createHash('sha256').update(full).digest('hex'));expect(page.normalizedLength).toBe(full.length);
 const excerpts=page.provenanceExcerpts!;expect(excerpts).toHaveLength(1);const excerpt=excerpts[0];
 expect(excerpt.text).toBe(full.slice(excerpt.start,excerpt.end));expect(excerpt.text.length).toBeLessThanOrEqual(500);
 if(full.length>12000){expect(excerpt.start).toBeGreaterThan(12000);expect(excerpt.text).toContain('не является средством массовой информации и официальным сайтом');}
 else{expect(excerpt.start).toBeLessThan(12000);expect(excerpt.text).toContain('Мы — официальный дилер');}
 const evidence=pageEvidence(request,page,0);expect(evidence.quotes).toHaveLength(5);expect(evidence.quotes).toContainEqual(expect.objectContaining(excerpt));
 for(const q of evidence.quotes){expect(q.text).toBe(full.slice(q.start!,q.end!));expect(q.text.length).toBeLessThanOrEqual(500);}
 expect(evidence.quotes.filter(q=>q.text!==excerpt.text).some(q=>/[₽]|руб/u.test(q.text))).toBe(true);
 expect(evidence.limitations.join(' ')).toContain('одна отведена заявлению');
});
it('prefers explicit negated official status over a generic partner agreement and never invents classification',()=>{
 const page=extractPage(html('Партнерское соглашение.\n'+ 'x'.repeat(13000)+'\nThis is not the official website. We are an authorized reseller.'),'https://example.org');
 expect(page.provenanceExcerpts![0].text).toContain('not the official website');
 const ordinary=extractPage('Official tariffs: 150 RUB monthly. Partner tools available.','https://official.example.org');
 expect(ordinary.provenanceExcerpts).toEqual([]);expect(pageEvidence(request,ordinary,0).limitations).not.toContain(expect.stringContaining('принадлежности'));
});
it('rejects corrupt excerpt offsets and changed text inside the bounded prefix',()=>{
 const page=extractPage('Мы — официальный дилер.\n150 RUB в месяц.','https://example.org');
 for(const bad of [{...page.provenanceExcerpts![0],start:-1},{...page.provenanceExcerpts![0],text:'invented'},{...page.provenanceExcerpts![0],end:99999}])expect(()=>pageEvidence(request,{...page,provenanceExcerpts:[bad]},0)).toThrow('INVALID_PROVENANCE_EXCERPT');
});
it('deduplicates an exact disclosure already selected as a price excerpt and remains within five by 500',()=>{
 const page=extractPage('Мы — официальный дилер. Тариф 150 RUB в месяц.','https://example.org');
 const evidence=pageEvidence(request,page,0);expect(evidence.quotes).toHaveLength(1);expect(evidence.quotes[0].text).toBe(page.text);
});
it('hashes a changed footer as a changed snapshot even when the first 12000 characters stay identical',()=>{
 const prefix='x'.repeat(13000),a=extractPage(prefix+'\nМы — официальный дилер.','https://example.org'),b=extractPage(prefix+'\nМы — официальный дилер новой компании.','https://example.org');
 expect(a.text).toBe(b.text);expect(a.contentHash).not.toBe(b.contentHash);
});

it('passes both actual disclosure snapshots to generation through the bounded server-read pipeline',async()=>{
 let calls=0,generationInput='';const events:unknown[]=[];const config=loadConfig({OPENAI_API_KEY:'test-placeholder',AI_BUDGET_USD:'15'});
 const provider=new OpenAIProvider(config,{reader:async url=>{const row=fixture.pages.find(p=>p.url===url)!;return extractPage(html(row.fullNormalizedText),url);},transport:async params=>{
  calls++;let value:unknown={message:'Прочитаны заявления страниц о дилерстве и посредничестве; принадлежность самому оператору не подтверждена.',choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[]},output:unknown[]=[];
  if(calls===1)value={action:'research',query:'официальные тарифы'};
  else if(calls===2){value={};output=[{type:'web_search_call',action:{type:'search',sources:fixture.pages.map(p=>({url:p.url,title:'Тарифы'}))}}];}
  else generationInput=String(params.input);
  return {status:'completed',error:null,output,output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:100}} as never;
 }});
 const result=await provider.complete(request,new AbortController().signal,undefined,{onOperation:e=>events.push(e)});
 expect(calls).toBe(3);const input=JSON.parse(generationInput);
 expect(input.research.evidence).toHaveLength(2);
 expect(input.research.evidence[0].quotes.some((q:{text:string})=>q.text.includes('не является средством массовой информации и официальным сайтом'))).toBe(true);
 expect(input.research.evidence[1].quotes.some((q:{text:string})=>q.text.includes('Мы — официальный дилер'))).toBe(true);
 for(const source of input.research.evidence){expect(source.quotes.length).toBeLessThanOrEqual(5);for(const q of source.quotes)expect(q.text.length).toBeLessThanOrEqual(500);}
 expect(input.research.evidence[0].limitations.join(' ')).toContain('дополнительно прочитан один точный фрагмент');
 expect(result.costUsd!).toBeLessThan(estimateMaxCost(request,config));expect(events.filter(e=>(e as {kind:string;state:string}).kind==='read'&&(e as {state:string}).state==='completed')).toHaveLength(2);
});
