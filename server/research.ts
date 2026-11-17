import { createHash } from 'node:crypto';
import type { ChatRequest, ExternalEvidence, ResearchBundle } from '../shared/types.js';
import { PUBLIC_HTML_BYTES, type ReadPage } from './publicReader.js';
export const RESEARCH_LIMITS={toolCalls:3,pages:6,pageBytes:PUBLIC_HTML_BYTES,redirects:3,pageTimeoutMs:10_000,pageChars:12_000,chainTimeoutMs:180_000,planOutput:1024,searchOutput:2048} as const;
export function publicQuery(value:string):string {
  return value.replace(/https?:\/\/\S+|\b[^\s@]+@[^\s@]+\.[^\s@]+\b|\+?\d[\d ()-]{7,}\d|\b(?:sk-|Bearer\s+)\S+/gi,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,400);
}
export function searchUrls(response:unknown):Array<{url:string;title:string}> {
  const output=(response as {output?:Array<Record<string,unknown>>}).output ?? [];
  const result:Array<{url:string;title:string}>=[];
  const add=(source:unknown)=>{if(!source || typeof source!=='object')return;const s=source as Record<string,unknown>;if(typeof s.url!=='string')return;try {const u=new URL(s.url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return;u.hash='';if(!result.some(item=>item.url===u.href))result.push({url:u.href,title:typeof s.title==='string'?s.title.slice(0,500):u.hostname});}catch { /* Invalid provider metadata is not a source. */ }};
  for(const item of output) {
    if(item.type==='web_search_call') {const action=item.action as {sources?:unknown[]}|undefined;action?.sources?.forEach(add);}
    if(item.type==='message')for(const part of (item.content as Array<{annotations?:unknown[]}> ?? []))part.annotations?.forEach(annotation=>{if((annotation as {type?:string})?.type==='url_citation')add(annotation);});
  }
  return result.slice(0,RESEARCH_LIMITS.pages);
}
export function pageEvidence(request:ChatRequest,page:ReadPage,index:number,operationId=`read-${index+1}`):ExternalEvidence {
  // Rank exact excerpts before applying the bound: dates in navigation must not
  // exhaust the catalogue before a real price/billing paragraph. Never execute text.
  const candidates:Array<{text:string;start:number;end:number;score:number;lineStart?:number}>=[];
  const add=(start:number,end:number,score:number,lineStart?:number)=>{const text=page.text.slice(start,end).trim();if(!text)return;const at=page.text.indexOf(text,start);candidates.push({text,start:at,end:at+text.length,score,lineStart});};
  const patterns = [
    {pattern:/\d[\d .,\u00a0\u202f]*\s*(?:₽|руб|RUB|USD|EUR|\$|€)|(?:\$|€|₽)\s*\d/gi,score:100},
    {pattern:/предоплат|оплат[аеуы]?|billing|billed|annual|помесяч|месяц|month|за (?:точк|пользовател)/gi,score:40},
    {pattern:/тариф|цен[ауы]|price|pricing|стоимость/gi,score:20},
    {pattern:/\d/g,score:1},
  ];
  // Documentation is often about a mechanism rather than a price. Its title
  // supplies same-language terms without guessing a feature or translating the
  // user's task. Keep monetary/billing evidence above these relevance windows.
  const generic=new Set(['support','documentation','official','overview','using','adding','guide','поддержка','инструкция']);
  const hostWords=new Set(new URL(page.url).hostname.toLocaleLowerCase().split(/[^\p{L}]+/u));
  const terms=[...new Set((page.title.toLocaleLowerCase().match(/[\p{L}]{4,}/gu) ?? [])
    .filter(word=>!generic.has(word)&&!hostWords.has(word))
    .map(word=>word.replace(/(?<=[a-z])s$/u,'').slice(0,6)))].slice(0,8);
  for(const line of page.text.matchAll(/[^\n]+/g)) {
    const start=line.index!,end=start+line[0].length;
    const hits=terms.filter(term=>line[0].toLocaleLowerCase().includes(term)).length;
    if(hits){
      const at=Math.max(0,start-100);
      // No lineStart: overlapping relevance windows cannot exhaust the bound
      // with multiple versions of the same paragraph, unlike distinct prices.
      add(at,Math.min(page.text.length,at+500),10+hits);
    }
    for(const {pattern,score} of patterns) {
      for(const match of line[0].matchAll(pattern)) {
        // Keep exact nearby headings/qualifications across line breaks. Short price
        // lines remain whole, and the existing 500-character quote bound is unchanged.
        const at=line[0].length<=500?Math.max(0,start-240,end-500):Math.max(0,Math.min(start+match.index!-120,end-500));
        add(at,Math.min(end,at+500),score,start);
        // A bounded line needs one candidate per priority; longer lines can contain
        // several separate prices. Duplicate/overlapping windows are removed below.
        if(line[0].length<=500)break;
      }
    }
  }
  add(0,Math.min(500,page.text.length),0);
  if(page.text.length>500)add(500,Math.min(1000,page.text.length),0);
  const chunks:Array<{text:string;start:number;end:number;lineStart?:number}>=[];
  // Reader-owned exact self-disclosure gets one slot, including a bounded footer
  // outside the prefix. It is evidence text, never a server classification.
  const provenance=page.provenanceExcerpts?.[0];
  if(provenance){
    if(!Number.isSafeInteger(provenance.start)||!Number.isSafeInteger(provenance.end)||provenance.start<0||provenance.end-provenance.start!==provenance.text.length||!provenance.text.length||provenance.text.length>500||!Number.isSafeInteger(page.normalizedLength)||provenance.end>page.normalizedLength!||(provenance.end<=page.text.length&&page.text.slice(provenance.start,provenance.end)!==provenance.text))throw new Error('INVALID_PROVENANCE_EXCERPT');
    chunks.push({...provenance});
  }
  for(const {text,start,end,lineStart} of candidates.sort((a,b)=>b.score-a.score||a.start-b.start)) {
    if(chunks.some(q=>q.text===text||(start<q.end&&end>q.start&&(lineStart===undefined||q.lineStart===undefined||lineStart===q.lineStart))))continue;
    chunks.push({text,start,end,lineStart});if(chunks.length===5)break;
  }
  chunks.sort((a,b)=>a.start-b.start);
  const id=`web-${createHash('sha256').update(JSON.stringify([request.projectId,request.requestId,operationId,page.url])).digest('hex').slice(0,24)}`;
  return {projectId:request.projectId,moduleId:request.moduleId,generation:request.coreContext?.generation ?? 0,id,version:1,requestId:request.requestId,operationId,url:page.url,title:page.title,retrievedAt:new Date().toISOString(),publishedAt:page.publishedAt,effectiveAt:page.effectiveAt,retrieval:'read',contentHash:page.contentHash,quotes:chunks.map(({lineStart:_lineStart,...q},i)=>({id:`quote-${i+1}`,...q})),limitations:[...page.limitations,...(provenance?['Каталог ограничен пятью цитатами до 500 символов; одна отведена заявлению страницы о принадлежности или посредничестве. Часть цен и условий может отсутствовать.']:[])]};
}
export function unavailableEvidence(request:ChatRequest,source:{url:string;title:string},index:number,operationId=`read-${index+1}`):ExternalEvidence {
  return {projectId:request.projectId,moduleId:request.moduleId,generation:request.coreContext?.generation ?? 0,id:`unread-${createHash('sha256').update(JSON.stringify([request.projectId,request.requestId,operationId,source.url])).digest('hex').slice(0,24)}`,version:1,requestId:request.requestId,operationId,url:source.url,title:source.title,retrievedAt:new Date().toISOString(),publishedAt:null,effectiveAt:null,retrieval:'unavailable',contentHash:'unavailable',quotes:[],limitations:['Страница найдена, но прочитать её не удалось. Сведения и тарифы не подтверждены.']};
}
export function researchBundle(evidence:ExternalEvidence[],limitations:string[]):ResearchBundle {
  return {status:evidence.some(item=>item.retrieval==='read')?(limitations.length || evidence.some(item=>item.retrieval!=='read')?'partial':'completed'):'failed',evidence,limitations};
}
