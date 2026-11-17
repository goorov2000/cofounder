import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import fixture from './fixtures/price-components/target11-unit-basis.json';
import {groundedPriceUnitBasis} from '../../server/priceUnitBasis';
import {createEvidenceAliases} from '../../server/evidenceAliases';
import {validateReply,ReplyValidationError} from '../../server/validation';
import type {ChatRequest,ExternalEvidence} from '../../shared/types';
const price=(amount:string,unit:string,currency='RUB')=>({amount,currency,unit});
for(const [quote,amount,unit] of [
 ['900 RUB за филиал в месяц','900','филиал'],
 ['330 ₽ в день × 26 дней = 8 580 ₽','330','день'],
 ['1490 рублей за всю компанию в месяц','1490','компания'],
 ['1490 RUB в месяц за всю компанию','1490','компанию'],
 ['Сотрудников:\n−\n10\n+\nКаждый следующий — 200 RUB в месяц','200','сотрудник'],
 ['$5/user/month','5','user'],
 ['5 USD/month/user','5','user'],
 ['200 RUB за сотрудника в месяц','200','сотрудник'],
 ['За пользователя — 200 RUB в месяц','200','пользователь'],
 ['200 RUB/employee/month','200','employee'],
] as const)it(`accepts explicit amount-bound denominator: ${quote}`,()=>expect(groundedPriceUnitBasis(price(amount,unit,quote.includes('₽')?'₽':quote.includes('$')?'$':quote.includes('USD')?'USD':'RUB'),quote)).toBe(true));
for(const [quote,amount,unit] of [
 ['Точка: 1 филиал, 900 RUB / месяц','900','филиал'],
 ['Команда: до 3 филиалов, 2100 RUB / месяц','2100','филиал'],
 ['330 ₽ в день × 26 дней = 8 580 ₽','8580','день'],
 ['2100 RUB в месяц; 900 RUB за филиал в месяц','2100','филиал'],
 ['Команда: 2100 RUB/месяц, до 3 филиалов. Индивидуальный: 2100 RUB за каждый филиал в месяц.','2100','филиал'],
 ['2100 RUB. За филиал — 900 RUB','2100','филиал'],
 ['330 RUB per employee\n2100 RUB в месяц','2100','employee'],
] as const)it(`rejects allowance, other operand or ambiguous amount: ${quote}`,()=>expect(groundedPriceUnitBasis(price(amount,unit,quote.includes('₽')?'₽':quote.includes('$')?'$':quote.includes('USD')?'USD':'RUB'),quote)).toBe(false));
it('does not invent currency or rewrite an unknown denominator',()=>{
 expect(groundedPriceUnitBasis(price('200','сотрудник','unknown'),'200 за сотрудника')).toBe(true);
 expect(groundedPriceUnitBasis(price('200','сотрудник','unknown'),'200 в месяц, до 3 сотрудников')).toBe(false);
 expect(groundedPriceUnitBasis(price('3к','сотрудник'),'3000 RUB за сотрудника')).toBe(true);
 expect(groundedPriceUnitBasis(price('3','сотрудник'),'3000 RUB за сотрудника')).toBe(false);
 expect(groundedPriceUnitBasis(price('2100','филиал','RUB'),'2100 RUB в месяц; 2100 USD за филиал')).toBe(false);
 expect(groundedPriceUnitBasis(price('50','user','GBP'),'50 GBP per user')).toBe(true);
 expect(groundedPriceUnitBasis(price('50','user','£'),'£50/user')).toBe(true);
 expect(groundedPriceUnitBasis(price('50','user','GBP'),'50 EUR per user')).toBe(false);
 expect(groundedPriceUnitBasis(price('50','user','GBP'),'£50/user')).toBe(false);
 expect(groundedPriceUnitBasis(price('200','unknown','unknown'),'200 за сотрудника')).toBe(true);
});
for(const [index,raw] of fixture.rawAttempts.entries())it(`rejects unchanged exact target11 raw attempt ${index+1}, accepts only explicit test repair to unknown`,()=>{
 expect(createHash('sha256').update(fixture.rawRecords[index].outputText).digest('hex')).toBe(fixture.rawRecords[index].sha256);
 expect(JSON.parse(fixture.rawRecords[index].outputText)).toEqual(raw);
 const sources=fixture.catalogue as ExternalEvidence[];
 const request=fixture.request as ChatRequest;
 expect(createEvidenceAliases(sources).metadata.sourceAliases).toEqual(fixture.sourceAliases);
 const decoded=createEvidenceAliases(sources).resolveReply(structuredClone(raw));
 delete decoded.memoryOperations;
 // Raw provider fields are retained; only the server-owned source catalogue is attached.
 const value={...decoded,externalSources:sources};
 let error:unknown;try{validateReply(value,request,sources);}catch(e){error=e;}
 expect(error).toBeInstanceOf(ReplyValidationError);
 const issue=(error as ReplyValidationError).validationIssue;
 expect([issue,...issue.relatedIssues??[]].filter(i=>i.rule==='ungrounded_price_unit_basis').map(i=>i.path)).toEqual(raw.externalClaims.flatMap((c,i)=>c.price && !['unknown'].includes(c.price.unit)?[i]:[]).map(i=>['externalClaims',i,'price','unit']));
 const corrected=structuredClone(value) as typeof value & {externalClaims:{price:{unit:string}|null}[]};
 for(const claim of corrected.externalClaims)if(claim.price && claim.price.unit!=='unknown')claim.price.unit='unknown';
 // A separate historical period error in attempt1 is deliberately retained:
 // it must remain rejected rather than deleting a claim to manufacture HTTP200.
 if(index===0)expect(()=>validateReply(corrected,request,sources)).toThrow();
 else {const accepted=validateReply(corrected,request,sources);expect(accepted.externalClaims).toEqual(corrected.externalClaims);expect(accepted.message).toBe(decoded.message);}
});
