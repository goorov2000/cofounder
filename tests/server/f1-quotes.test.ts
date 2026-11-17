import { expect, it } from 'vitest';
import { pageEvidence } from '../../server/research';
import { extractPage } from '../../server/publicReader';
import type { ChatRequest } from '../../shared/types';
const request:ChatRequest={requestId:'quote-f1-request',projectId:'quote-f1-project',moduleId:'idea',intent:'message',message:'Сравни тарифы',context:{name:'Тест',description:'',history:[],facts:[],artifacts:[]}};
it('F04 selects exact late price and billing conditions before numeric navigation without overlapping quotes',()=>{
 const navigation=Array.from({length:8},(_,i)=>`<p>Новости ${2010+i}. ${'Раздел сайта и навигация. '.repeat(25)}</p>`).join('');
 const tariff='Тариф 3500 RUB за точку в месяц. Предоплата за 12 месяцев. Действует с 2026-11-01.';
 const page=extractPage(navigation+`<p>${tariff}</p>`,'https://vendor.example/pricing');expect(page.text.indexOf(tariff)).toBeGreaterThan(5000);
 const evidence=pageEvidence(request,page,0);expect(evidence.quotes.some(quote=>quote.text.includes(tariff))).toBe(true);
 expect(evidence.quotes.length).toBeLessThanOrEqual(5);expect(evidence.contentHash).toBe(page.contentHash);expect(evidence.retrieval).toBe('read');
 for(const quote of evidence.quotes){expect(quote.text.length).toBeLessThanOrEqual(500);expect(page.text.slice(quote.start!,quote.end!)).toBe(quote.text);}
 const sorted=[...evidence.quotes].sort((a,b)=>a.start!-b.start!);for(let i=1;i<sorted.length;i++)expect(sorted[i].start!).toBeGreaterThanOrEqual(sorted[i-1].end!);
});
