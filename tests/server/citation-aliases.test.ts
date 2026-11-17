import{expect,it}from'vitest';
import{projectCitationAliases}from'../../server/citationAliases.js';
import{createEvidenceAliases}from'../../server/evidenceAliases.js';
import{OpenAIProvider,estimateMaxCost}from'../../server/provider.js';
import{loadConfig}from'../../server/config.js';
import type{ChatRequest,ExternalEvidence}from'../../shared/types.js';
const source:ExternalEvidence={projectId:'project-citations',moduleId:'competitors',generation:0,id:'web-canonical-historical-id',version:7,requestId:'historical-request',operationId:'read-1',url:'https://plan-smen.ru/pricing/',title:'Тарифы и цены — Plansmen',retrievedAt:'2026-11-15T00:00:00.000Z',publishedAt:null,effectiveAt:null,retrieval:'read',contentHash:'a'.repeat(64),quotes:[{id:'quote-1',text:'План: 1500 ₽ в месяц.',start:0,end:22}],limitations:[]};
const request:ChatRequest={requestId:'request-citations',projectId:source.projectId,moduleId:'competitors',intent:'message',message:'Сравни тарифы',context:{name:'Test',description:'',facts:[],artifacts:[],history:[]}};
const raw=(message:string)=>({message,choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[{text:'План: 1500 ₽ в месяц.',evidenceId:'source_1',version:7,quoteId:'quote-1',price:{amount:'1500',currency:'₽',unit:'unknown',period:'в месяц',paymentTerms:'unknown'}}]});
const codec=()=>createEvidenceAliases([source]);
const response=(value:unknown)=>({status:'completed',error:null,output:[],output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:100}}as never);
it('projects only restricted Markdown destinations from an immutable exact version catalogue',()=>{
 const original=structuredClone(source),c=createEvidenceAliases([original]);original.url='https://attacker.example/';
 const value=raw('Тариф: [Plansmen](source_1). Обычный source_1 и `source_1` неизменны.');
 const result=c.resolveReply({...value,artifactDraft:{title:'source_1',body:'[Цена](source_1)'}});
 expect(result.message).toBe('Тариф: [Plansmen](<https://plan-smen.ru/pricing/>). Обычный source_1 и `source_1` неизменны.');
 expect(result.artifactDraft).toEqual({title:'source_1',body:'[Цена](<https://plan-smen.ru/pricing/>)'});
 expect(result.externalClaims).toEqual([{...value.externalClaims[0],evidenceId:source.id}]);expect(value.message).toContain('(source_1)');
 expect(()=>c.resolveReply({...value,externalClaims:[{...value.externalClaims[0],version:8}]})).toThrow(expect.objectContaining({validationIssue:expect.objectContaining({rule:'source_alias_version_mismatch'})}));
});
it('rejects unknown, malformed, nested, image and suffixed aliases while keeping code and plain text unchanged',()=>{
 for(const destination of ['source_2','source_01','SOURCE_1','source_1#x','source_1?q=1','<source_1>',' source_1','source_1 "title"','source_1/path'])expect(()=>codec().resolveReply(raw(`[Цена](${destination})`)),destination).toThrow();
 for(const text of ['[nested [label]](source_1)','![image](source_1)','[Цена](source_1'])expect(()=>codec().resolveReply(raw(text))).toThrow();
 for(const text of ['`[Цена](source_1)`','``[Цена](source_1)``','```md\n[Цена](source_1)\n```','~~~\n[Цена](source_1)\n~~~','source_1','text ](source_1)','\\[Цена](source_1)'])expect(codec().resolveReply(raw(text)).message).toBe(text);
 expect(()=>createEvidenceAliases([]).resolveReply({message:'[Чужая](source_1)'})).toThrow(expect.objectContaining({validationIssue:expect.objectContaining({rule:'unknown_citation_alias'})}));
});
it('does not infer URL equivalence or promote an unavailable page to a read quote',async()=>{
 let calls=0;const provider=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'}),{transport:async()=>response(++calls===1?{action:'answer',query:''}:raw('[Цена](https://plan-smen.ru/pricing)'))});
 await expect(provider.complete(request,new AbortController().signal,undefined,{trustedEvidence:[source]})).rejects.toMatchObject({code:'INVALID_RESPONSE'});expect(calls).toBe(3);
 const unavailable={...source,retrieval:'unavailable' as const,quotes:[]};expect(createEvidenceAliases([unavailable]).resolveReply({message:'[Недоступно](source_1)'}).message).toContain(source.url);
 let count=0;const missing=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'}),{transport:async()=>response(++count===1?{action:'answer',query:''}:raw('[Цена](source_1)'))});
 await expect(missing.complete(request,new AbortController().signal,undefined,{trustedEvidence:[unavailable]})).rejects.toMatchObject({code:'INVALID_RESPONSE'});
});
it('bounds positive expansion before joining the transformed text',()=>{
 const huge='https://example.org/'+ 'x'.repeat(1800);expect(()=>projectCitationAliases('[p](source_1)'.repeat(1000),()=>huge,['message'],512*1024)).toThrow(expect.objectContaining({validationIssue:{path:['message'],rule:'citation_expansion_limit'}}));
});
it('streams progressive prose and exact links without any clickable unresolved alias; repairs once with canonical final references',async()=>{
 let calls=0,resets=0;const previews:string[]=[],events:unknown[]=[],inputs:unknown[]=[];
 const provider=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'}),{transport:async(params,_signal,onText)=>{
  calls++;inputs.push(params.input);if(calls===1)return response({action:'answer',query:''});
  const message=calls===2?'Проверяю [Цена](source_9).':'Проверено [Цена](source_1). Дальше сравнение.';
  for(const character of message)onText?.(character);return response(raw(message));
 }});
 const result=await provider.complete(request,new AbortController().signal,d=>previews.push(d),{trustedEvidence:[source],onTextReset:()=>{resets++;previews.push('|RESET|');},onOperation:e=>events.push(e)});
 expect(calls).toBe(3);expect(resets).toBe(1);expect(result.usage).toEqual({inputTokens:300,outputTokens:300});expect(result.costUsd!).toBeLessThan(estimateMaxCost(request,loadConfig({OPENAI_API_KEY:'test-placeholder'})));expect(previews.join('')).toContain('Проверено [Цена](<https://plan-smen.ru/pricing/>). Дальше сравнение.');
 expect(previews.join('')).not.toContain('](source_');expect(previews.slice(0,3).join('')).toBe('Про');
 expect(result.reply.externalClaims?.[0]).toMatchObject({evidenceId:source.id,version:7,quoteId:'quote-1'});
 expect(JSON.parse(String(inputs[2])).rejectedOutput).toContain('source_9');expect(JSON.parse(String(inputs[2])).validationIssue.rule).toBe('unknown_citation_alias');
 expect(events).toContainEqual(expect.objectContaining({id:'generate',state:'completed',metadata:expect.objectContaining({validation:'failed'})}));expect(events).toContainEqual(expect.objectContaining({id:'generate-repair',state:'completed',metadata:expect.objectContaining({validation:'passed'})}));
});
it('preserves exact quoted user snapshots and attaches their original provenance without projecting literal links',async()=>{
 const historical='Вводные: [Моя ссылка](source_99).';
 const r=structuredClone(request);r.coreContext={schemaVersion:1,projectId:request.projectId,moduleId:'competitors',generation:0,revision:0,contextVersion:1,currentEntryRefs:[],entries:[],evidence:[],sourceMessage:{messageId:'current',revision:1},sourceMessages:[{projectId:request.projectId,moduleId:'idea',generation:0,messageId:'history',revision:1,role:'user',content:historical,createdAt:'2026-11-14T00:00:00.000Z'},{projectId:request.projectId,moduleId:'competitors',generation:0,messageId:'current',revision:1,role:'user',content:request.message,createdAt:'2026-11-15T00:00:00.000Z'}]};
 const c=createEvidenceAliases([source],r),text=`Вы писали: «${historical}». Источник: [Цена](source_1).`;
 expect(c.resolveReply(raw(text)).message).toBe(`Вы писали: «${historical}». Источник: [Цена](<${source.url}>).`);
 expect(c.resolveReply(raw(`> ${historical}\n\n[Цена](source_1)`)).message).toBe(`> ${historical}\n\n[Цена](<${source.url}>)`);
 let cumulative='';for(const char of text){cumulative+=char;const preview=c.projectPreview(cumulative);expect(preview).not.toContain('[Моя ссылка](<');}
 let calls=0;const provider=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'}),{transport:async()=>response(++calls===1?{action:'answer',query:''}:raw(text))});
 const result=await provider.complete(r,new AbortController().signal,undefined,{trustedEvidence:[source]});
 expect(calls).toBe(2);expect(result.reply.message).toContain(`«${historical}»`);expect(result.reply.historySources).toEqual([{source:r.coreContext.sourceMessages[0],quotes:[historical]}]);
 expect(()=>c.resolveReply(raw('Модель ссылается: [Моя ссылка](source_99).'))).toThrow(expect.objectContaining({validationIssue:expect.objectContaining({rule:'unknown_citation_alias'})}));
});
it('escapes only the Markdown destination wrapper, keeps server-owned quote snapshots unchanged and budgets both visible fields',()=>{
 const parentheses={...source,url:'https://example.org/tariff_(annual)'};
 const c=createEvidenceAliases([parentheses]);const value={...raw('[План](source_1)'),externalSources:[parentheses],historySources:[{source:{content:'[literal](source_1)'},quotes:['[literal](source_1)']}]};
 const projected=c.resolveReply(value);expect(projected.message).toBe('[План](<https://example.org/tariff_(annual)>)');expect(projected.externalSources).toEqual(value.externalSources);expect(projected.historySources).toEqual(value.historySources);
 const long={...source,url:'https://example.org/'+ 'x'.repeat(1800)},text='[p](source_1)'.repeat(700);
 expect(()=>createEvidenceAliases([long]).resolveReply({...raw(text),artifactDraft:{title:'Сравнение',body:text}})).toThrow(expect.objectContaining({validationIssue:{path:['artifactDraft','body'],rule:'citation_expansion_limit'}}));
});
it('repairs the observed slashless artifact citation by exact alias protocol without changing any price claim',async()=>{
 let calls=0;const inputs:unknown[]=[],events:unknown[]=[];
 const provider=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'}),{transport:async params=>{
  calls++;inputs.push(params.input);if(calls===1)return response({action:'answer',query:''});
  return response({...raw('Сравнение подготовлено.'),artifactDraft:{title:'Сравнение',body:calls===2?'[Plansmen: тариф](https://plan-smen.ru/pricing)':'[Plansmen: тариф](source_1)'}});
 }});
 const result=await provider.complete(request,new AbortController().signal,undefined,{trustedEvidence:[source],onOperation:e=>events.push(e)});
 expect(calls).toBe(3);expect(JSON.parse(String(inputs[2])).validationIssue).toEqual({path:['artifactDraft','body'],rule:'unprovided_url'});
 expect(result.reply.artifactDraft?.body).toBe('[Plansmen: тариф](<https://plan-smen.ru/pricing/>)');expect(result.reply.externalClaims).toEqual([{...raw('').externalClaims[0],evidenceId:source.id}]);
 expect(JSON.parse(String(inputs[2])).rejectedOutput).toContain('(https://plan-smen.ru/pricing)');
 expect(events.filter(e=>(e as {kind:string;state:string}).kind==='generate'&&(e as {state:string}).state==='completed')).toHaveLength(2);
});

it('keeps citation destinations tied to their exact historical version and request-local catalogue',()=>{
 const newer={...source,version:8,url:'https://example.org/new-price/'};const c=createEvidenceAliases([source,newer]);
 expect(c.resolveReply({message:'[Прежний](source_1), [новый](source_2).'}).message).toBe('[Прежний](<https://plan-smen.ru/pricing/>), [новый](<https://example.org/new-price/>).');
 expect(()=>createEvidenceAliases([newer]).resolveReply({message:'[Чужой номер](source_2)'})).toThrow(expect.objectContaining({validationIssue:expect.objectContaining({rule:'unknown_citation_alias'})}));
});
