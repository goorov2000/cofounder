import type{AssistantReply}from'../shared/types.js';
import{sameSingleAmount}from'../shared/coreValidation.js';
import{markdownCodeRanges}from'./citationAliases.js';
const unknown=/^(?:unknown|неизвестно|не указан|не указано|не установлено)$/iu;
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const currency=(value:string)=>/^(?:₽|руб(?:лей|ля|ль)?\.?|RUB)$/iu.test(value.trim())?'RUB':/^\$$/u.test(value.trim())?'$':/^USD$/iu.test(value.trim())?'USD':/^(?:€|EUR)$/iu.test(value.trim())?'EUR':undefined;
const label=(text:string)=>text.match(/(?:план|тариф)[а-яё]*\s+[«“"]([^»”"\n]{1,100})[»”"]/iu)?.[1];
/** Called after validateReply: historySources is server-derived.
 * Finite consistency boundary, not a general price/plan semantic parser. */
export function unsupportedVisiblePlanPeriod(reply:AssistantReply):{path:(string|number)[];rule:string}|undefined{
 const claims=(reply.externalClaims??[]).filter(c=>c.price);
 const labelled=claims.flatMap(claim=>{const name=label(claim.text);return name?[{claim,name}]:[];});
 const fields=[{text:reply.message,path:['message']as(string|number)[]},...(reply.artifactDraft?[{text:reply.artifactDraft.body,path:['artifactDraft','body']}]:[])];
 const amountPattern=/(\d[\d \u00a0\u202f]*(?:[.,]\d+)?)\s*(₽|руб(?:лей|ля|ль)?\.?|RUB|USD|EUR|[$€])(?=$|[^\p{L}])/giu;
 const periodPattern=/\/\s*(?:мес\.?|месяц|month|год|year|день|day)(?![\p{L}])|(?:в|за|per)\s+(?:месяц|год|день|month|year|day)(?![\p{L}])|помесячно|ежемесячно/giu;
 for(const {claim,name}of labelled){
  const price=claim.price!;if(!unknown.test(price.period.trim()))continue;
  const denomination=currency(price.currency);if(!denomination)continue;
  const source=reply.externalSources?.find(s=>s.id===claim.evidenceId&&s.version===claim.version&&s.retrieval==='read');
  const quote=source?.quotes.find(q=>q.id===claim.quoteId);
  const namePattern=new RegExp(`(?<![\\p{L}\\p{N}_])${escape(name)}(?![\\p{L}\\p{N}_])`,'giu');
  if(!quote||!namePattern.test(quote.text))continue;
  // A competing labelled price may refer to another source/plan version. Do not
  // guess which one the prose intended when its visible identity is insufficient.
  if(labelled.some(other=>other.claim!==claim&&other.name.toLowerCase()===name.toLowerCase()&&sameSingleAmount(other.claim.price!.amount,price.amount)&&currency(other.claim.price!.currency)===denomination&&(other.claim.evidenceId!==claim.evidenceId||other.claim.version!==claim.version||!unknown.test(other.claim.price!.period.trim()))))continue;
  for(const {text,path}of fields){
   const literalRanges=markdownCodeRanges(text);
   for(const quoted of text.matchAll(/«([^«»\n]+)»|“([^“”\n]+)”|"([^"\n]+)"/gu)){
    const content=quoted[1]??quoted[2]??quoted[3];
    if(reply.historySources?.some(history=>history.quotes.includes(content)))literalRanges.push([quoted.index!,quoted.index!+quoted[0].length]);
   }
   const positions=labelled.flatMap(item=>[...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${escape(item.name)}(?![\\p{L}\\p{N}_])`,'giu'))].map(m=>({at:m.index!,name:item.name}))).sort((a,b)=>a.at-b.at);
   for(const position of positions.filter(p=>p.name.toLowerCase()===name.toLowerCase())){
    const start=position.at+name.length,next=positions.find(p=>p.at>=start)?.at??text.length;
    const end=text.slice(start,next).search(/[;\n]/u),segment=text.slice(start,end<0?next:start+end);
    for(const amount of segment.matchAll(amountPattern)){
     if(!sameSingleAmount(amount[1],price.amount)||currency(amount[2])!==denomination)continue;
     const beforeLabel=text.slice(Math.max(0,position.at-100),position.at).split(/[;\n.!?]/u).at(-1)??'';
     const ownPrefix=beforeLabel+segment.slice(0,amount.index);
     if(/наш[а-яё]*\s+(?:гипотез|сценари|тариф|план|цен)|(?:гипотез|сценари)[^.;\n]{0,30}наш/iu.test(ownPrefix))continue;
     const tail=segment.slice(amount.index!+amount[0].length);
     for(const period of tail.matchAll(periodPattern)){
      if(!/^[\s*_:—–,()\-]*(?:с(?:\s+указанием)?\s*)?$/iu.test(tail.slice(0,period.index)))continue;
      const periodEnd=start+amount.index!+amount[0].length+period.index!+period[0].length;
      if(literalRanges.some(([a,b])=>position.at>=a&&periodEnd<=b))continue;
      const rest=segment.slice(amount.index!+amount[0].length+period.index!+period[0].length);
      // Only this directly attached question is unasserted; later questions do not exempt a rate.
      if(/^[\s*_)]*\?/u.test(rest))continue;
      if(/^\s*(?:не\s+(?:подтвержд[её]н|указан|установлен)|неизвест)/iu.test(rest))continue;
      return {path,rule:'unsupported_visible_plan_period'};
     }
    }
   }
  }
 }
}
