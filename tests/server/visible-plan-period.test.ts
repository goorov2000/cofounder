import{expect,it}from'vitest';
import fixture from'./fixtures/price-components/target12-visible-period.json';
import{unsupportedVisiblePlanPeriod}from'../../server/visiblePlanPeriod';
import{OpenAIProvider}from'../../server/provider';
import{loadConfig}from'../../server/config';
import type{AssistantReply,ChatRequest,ExternalEvidence}from'../../shared/types';
const actual=fixture.reply as unknown as AssistantReply;
const corrected=(text:string)=>text.replace('«Бизнес»: 1 500 ₽ с /мес на странице.','«Бизнес»: 1 500 ₽; период оплаты в достаточной цитате не установлен.').replace('«Бизнес»:** 1 500 ₽ с указанием /мес.','«Бизнес»:** 1 500 ₽; период оплаты в достаточной цитате не установлен.');
it('detects both exact actual false Business monthly statements and accepts an explicit unknown without changing other plans',()=>{
 expect(unsupportedVisiblePlanPeriod(actual)).toEqual({path:['artifactDraft','body'],rule:'unsupported_visible_plan_period'});
 const fixed={...actual,artifactDraft:{...actual.artifactDraft!,body:corrected(actual.artifactDraft!.body)}};
 expect(fixed.artifactDraft.body).not.toContain('с указанием /мес');expect(unsupportedVisiblePlanPeriod(fixed)).toBeUndefined();
 expect(fixed.externalClaims).toEqual(actual.externalClaims);
});
it('binds only the same plan, numeric amount, currency and directly attached asserted period',()=>{
 const value=(message:string)=>({...actual,message,artifactDraft:null});
 for(const text of ['«Бизнес»:1500₽/мес; единица неизвестна.','«Бизнес»:1500₽/мес; наша цена пока гипотеза.','«Бизнес»:1500₽ в месяц.','«Профессиональный»:1500₽/мес; «Бизнес»:1500₽/мес.'])expect(unsupportedVisiblePlanPeriod(value(text)),text).toBeDefined();
 for(const text of ['«Бизнес»:1500₽; период неизвестен.','«Профессиональный»:1500₽/мес; «Бизнес»:1500₽, период неизвестен.','«Бизнес»:1500₽, не утверждаю месячную оплату.','Наша гипотеза — тариф «Бизнес»:1500₽/мес.','«Бизнес»:1500USD/мес.','«Бизнес»:1900₽/мес.','«Бизнес»:1500₽; наша цена2900₽ в месяц.','«Бизнес»:1500₽/мес не подтверждён.'])expect(unsupportedVisiblePlanPeriod(value(text)),text).toBeUndefined();
 const business=actual.externalClaims!.find(c=>c.price&&c.text.includes('«Бизнес»'))!;
 const ambiguous={...value('«Бизнес»:1500₽/мес.'),externalClaims:[business,{...business,evidenceId:'another-provider',price:{...business.price!,period:'/мес'}}]};expect(unsupportedVisiblePlanPeriod(ambiguous)).toBeUndefined();
});
it('checks the message independently from the draft and keeps explicitly supported periods unchanged',()=>{
 expect(unsupportedVisiblePlanPeriod({...actual,message:'«Бизнес»:1500₽ с указанием /мес.',artifactDraft:null})?.path).toEqual(['message']);
 const known={...actual,message:'«Бизнес»:1500₽/мес.',artifactDraft:null,externalClaims:actual.externalClaims!.map(c=>c.price&&c.text.includes('«Бизнес»')?{...c,price:{...c.price,period:'/мес'}}:c)};
 expect(unsupportedVisiblePlanPeriod(known)).toBeUndefined();
});
it('repairs the exact actual raw once, preserving all seven claims, prices, canonical citations and charged outcomes',async()=>{
 let calls=0,resets=0;const events:any[]=[],inputs:unknown[]=[];
 const evidence=actual.externalSources! as ExternalEvidence[];const raw=fixture.raw;
 const provider=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'}),{transport:async params=>{
  calls++;inputs.push(params.input);const output=calls===1?{action:'answer',query:''}:calls===2?raw:{...raw,artifactDraft:{...raw.artifactDraft,body:corrected(raw.artifactDraft.body)}};
  return{status:'completed',error:null,output:[],output_text:JSON.stringify(output),usage:{input_tokens:100,output_tokens:100}}as never;
 }});
 const result=await provider.complete(fixture.request as unknown as ChatRequest,new AbortController().signal,undefined,{trustedEvidence:evidence,onTextReset:()=>resets++,onOperation:e=>events.push(e)});
 expect(calls).toBe(3);expect(resets).toBe(1);expect(JSON.parse(String(inputs[2])).validationIssue).toEqual({path:['artifactDraft','body'],rule:'unsupported_visible_plan_period'});
 expect(result.reply.externalClaims).toEqual(actual.externalClaims);expect(result.reply.externalClaims).toHaveLength(7);expect(result.reply.artifactDraft!.body).toContain('«Профессиональный»:** 1 500 ₽/мес');
 expect(events.filter(e=>e.kind==='generate'&&e.state==='completed').map(e=>e.metadata.validation)).toEqual(['failed','passed']);expect(result.usage).toEqual({inputTokens:300,outputTokens:300});
 expect(result.reply.artifactDraft!.body).toContain('https://plan-smen.ru/pricing/');
});

it('does not treat code or a verified exact historical user quotation as a new external period assertion',()=>{
 const source={projectId:'period-project',moduleId:'idea' as const,generation:0,messageId:'historical-quote',revision:1,role:'user' as const,content:'Бизнес:1500₽/мес',createdAt:'2026-11-15T00:00:00.000Z'};
 const reply={...actual,message:'Вы раньше писали: “Бизнес:1500₽/мес”, но это была гипотеза, период не подтверждён.',artifactDraft:null,historySources:[{source,quotes:[source.content]}]};
 expect(unsupportedVisiblePlanPeriod(reply)).toBeUndefined();
 expect(unsupportedVisiblePlanPeriod({...reply,historySources:[]})).toBeDefined();
 for(const message of ['```text\nБизнес:1500₽/мес\n```','Пример кода: `Бизнес:1500₽/мес`'])expect(unsupportedVisiblePlanPeriod({...actual,message,artifactDraft:null})).toBeUndefined();
 const onlyName={...reply,message:'«Бизнес»:1500₽/мес.',historySources:[{source:{...source,content:'Бизнес'},quotes:['Бизнес']}]};
 expect(unsupportedVisiblePlanPeriod(onlyName)).toBeDefined();
});

it('treats only a question mark attached directly to this period as an unasserted supplier question',()=>{
 for(const message of ['Вопрос поставщику: тариф «Бизнес»:1500₽/мес? Период ещё не подтверждён.','Вопрос поставщику: тариф «Бизнес»:**1500₽/мес**? Период ещё не подтверждён.']){
  expect(unsupportedVisiblePlanPeriod({...actual,message,artifactDraft:null})).toBeUndefined();
  expect(unsupportedVisiblePlanPeriod({...actual,message:'Сравнение.',artifactDraft:{title:'Вопрос',body:message}})).toBeUndefined();
 }
 for(const message of ['Вопрос поставщику: тариф «Бизнес»:1500₽/мес. Период ещё не подтверждён.','«Бизнес»:1500₽/мес. Какова единица?','«Бизнес»:1500₽/мес; наша цена пока гипотеза. Что дальше?'])expect(unsupportedVisiblePlanPeriod({...actual,message,artifactDraft:null})).toBeDefined();
});
