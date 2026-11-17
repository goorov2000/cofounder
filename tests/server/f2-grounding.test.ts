import { expect, it } from 'vitest';
import { atomicValueSchema } from '../../shared/coreValidation';
import { responseJsonSchema } from '../../server/provider';
import { validateReply } from '../../server/validation';
import type { ChatRequest, ExternalClaim, ExternalEvidence } from '../../shared/types';
const request:ChatRequest={requestId:'f2-request',projectId:'f2-project',moduleId:'idea',intent:'message',message:'Сравни тарифы',context:{name:'Тест',description:'',history:[],facts:[],artifacts:[]}};
function check(text:string,claim:Partial<ExternalClaim>={}) {
 const source:ExternalEvidence={projectId:request.projectId,moduleId:'idea',generation:0,id:'source',version:1,requestId:request.requestId,operationId:'read',url:'https://fixture.example/pricing',title:'Годовой тариф',retrievedAt:'2026-11-15T00:00:00Z',publishedAt:null,effectiveAt:null,retrieval:'read',contentHash:'fixture',quotes:[{id:'q1',text,start:null,end:null}],limitations:[]};
 const external:ExternalClaim={text:'Тариф 5000',evidenceId:'source',version:1,quoteId:'q1',price:{amount:'5000',currency:'RUB',unit:'пользователь',period:'месяц',paymentTerms:'unknown'},...claim};
 return ()=>validateReply({message:'Результат',choices:[],artifactDraft:null,proposedFacts:[],externalSources:[source],externalClaims:[external]},request,[source]);
}
it('F2 publishes a generation schema that forbids incompatible unknown epistemics',()=>{
 const value={kind:'unknown',key:'demand',scope:{subject:'our_project',entityId:null,area:'project',stageId:null,scenario:null},text:'Спрос неизвестен',origin:'user',epistemic:'reported',acceptance:'unresolved',sources:[{type:'message',projectId:'p',moduleId:'idea',generation:0,messageId:'m',revision:1,quote:'Спрос неизвестен'}],dependsOn:[]};
 expect(atomicValueSchema.safeParse(value).success).toBe(false);
 expect(atomicValueSchema.safeParse({...value,epistemic:'unknown'}).success).toBe(true);
 expect(JSON.stringify(responseJsonSchema)).not.toContain('oneOf');
});
it('F2 accepts inflection and currency/period aliases with the same denominator',()=>{
 expect(check('Тариф 5000 рублей за пользователя в месяц.')()).toBeDefined();
 expect(check('Тариф 5000 RUB за пользователя в месяц.')()).toBeDefined();
});
it('F2 grounds equivalent magnitude spellings without inventing a currency',()=>{
 expect(check('Цена 5к',{text:'Цена 5 тыс.',price:{amount:'5 тыс.',currency:'unknown',unit:'unknown',period:'unknown',paymentTerms:'unknown'}})()).toBeDefined();
 expect(check('Цена 5к',{text:'Цена 5 тыс. ₽',price:null})).toThrow();
});
it('F2 rejects different amounts, currency, period, denominator and unquoted payment conditions',()=>{
 const quote='Тариф 5000 RUB за пользователя в месяц.';
 for(const patch of [{amount:'7000'},{currency:'EUR'},{unit:'компания'},{period:'год'},{paymentTerms:'предоплата за 12 месяцев'}])expect(check(quote,{price:{amount:'5000',currency:'RUB',unit:'пользователь',period:'месяц',paymentTerms:'unknown',...patch}})).toThrow();
 expect(check('План Старт 2990 RUB в месяц.',{text:'Старт 2990, Бизнес 4490 и Сеть 7990',price:null})).toThrow();
});
it('F2 permits separately quoted payment clauses but rejects an added condition',()=>{
 const quote='Тариф 5000 RUB за пользователя в месяц. Условия: предоплата за 12 месяцев. Действует с 2026-11-01.';
 const price={amount:'5000',currency:'RUB',unit:'пользователь',period:'месяц',paymentTerms:'предоплата за 12 месяцев; действует с 2026-11-01'};
 expect(check(quote,{price})()).toBeDefined();
 expect(check(quote,{price:{...price,paymentTerms:'предоплата за 12 месяцев; возврат без условий'}})).toThrow();
});
it('F2 grounds a labelled retrieval date only in trusted retrieval metadata',()=>{
 const quote='Тариф 5000 RUB за пользователя в месяц.';
 expect(check(quote,{text:'Тариф 5000 RUB. Прочитано 2026-11-15.'})()).toBeDefined();
 expect(check(quote,{text:'Тариф 5000 RUB. Прочитано 2026-11-16.'})).toThrow();
 expect(check(quote,{text:'Тариф действует с 2026-11-15.'})).toThrow();
 expect(check(quote,{text:'Цена 2026 RUB. Прочитано 2026-11-15.'})).toThrow();
});

it('F2 distinguishes the exact page title from a claimed billing period',()=>{
 const quote='Тариф 5000 RUB за пользователя в месяц.';
 expect(check(quote,{text:'На странице «Годовой тариф» тариф 5000 RUB.'})()).toBeDefined();
 expect(check(quote,{text:'Тариф 5000 RUB, годовая оплата.'})).toThrow();
});

it('F2 never interprets service names as a price denominator', async () => {
 const {groundedQuantities}=await import('../../shared/coreValidation');
 expect(groundedQuantities('Заточка ножей за €14 за штуку', 'Kitchen knives €14/pc')).toBe(true);
 expect(groundedQuantities('Цена €14 за точку', 'Kitchen knives €14/pc')).toBe(false);
 expect(groundedQuantities('Цена €14/точка', 'Kitchen knives €14/pc')).toBe(false);
});

it('F2 preserves a project price while explicitly distinguishing a competitor metric', async () => {
 const {validateMemoryValue}=await import('../../shared/coreValidation');
 const quote='Принимаем гипотезу: наша цена 5000 рублей за точку в месяц.';
 const source={type:'message' as const,projectId:'p',moduleId:'idea' as const,generation:0,messageId:'m',revision:1,quote};
 const value={kind:'decision' as const,key:'price',scope:{subject:'our_project' as const,entityId:null,area:'project' as const,stageId:null,scenario:null},text:quote+' Это не средний чек конкурентов.',origin:'user' as const,epistemic:'hypothesis' as const,acceptance:'accepted' as const,sources:[source],dependsOn:[]};
 expect(()=>validateMemoryValue(value,{entries:[],sourceMessages:[{...source,role:'user',content:quote}],evidence:[]} as never,{projectId:'p'} as never,[])).not.toThrow();
});

it('F2 rejects a mismatched explicit source title even when quantities coincide',()=>{
 expect(check('Тариф 5000 RUB за пользователя в месяц.',{text:'Точное название страницы: «Другой сервис»; тариф 5000 RUB.'})).toThrow();
});

it('F2 distinguishes short brand references from exact title metadata and grants no invented numerical title exemption',()=>{
 expect(check('Тариф 5000 RUB за пользователя в месяц.',{text:'На странице «Тарифы» тариф 5000 RUB.'})()).toBeDefined();
 expect(check('Тариф 5000 RUB за пользователя в месяц.',{text:'Заголовок страницы: «Годовой тариф»; тариф 5000 RUB.'})()).toBeDefined();
 expect(check('Тариф 5000 RUB за пользователя в месяц.',{text:'На странице «Тарифы 2027» тариф 5000 RUB.'})).toThrow();
 expect(check('Тариф 5000 RUB за пользователя в месяц.',{text:'На странице «Тарифы» тариф 7000 RUB.'})).toThrow();
 expect(check('Тариф 5000 RUB за пользователя в месяц.',{text:'На странице «Тарифы» тариф 5000 EUR.'})).toThrow();
 expect(check('Тариф 5000 RUB за пользователя в месяц.',{text:'На странице «Тарифы» тариф 5000 RUB за точку.'})).toThrow();
});

it('F2 keeps negated competitor comparisons in our own price scope', async()=>{
 const {validateMemoryValue}=await import('../../shared/coreValidation');
 const quote='Наша цена 5000 рублей за точку в месяц.';
 const source={type:'message' as const,projectId:'p',moduleId:'idea' as const,generation:0,messageId:'m',revision:1,quote};
 const value={kind:'decision' as const,key:'price',scope:{subject:'our_project' as const,entityId:null,area:'project' as const,stageId:null,scenario:null},text:quote+' Это не подтверждённый средний чек конкурентов.',origin:'user' as const,epistemic:'hypothesis' as const,acceptance:'accepted' as const,sources:[source],dependsOn:[]};
 expect(()=>validateMemoryValue(value,{entries:[],sourceMessages:[{...source,role:'user',content:quote}],evidence:[]} as never,{projectId:'p'} as never,[])).not.toThrow();
});
