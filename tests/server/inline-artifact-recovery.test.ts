import{expect,it}from'vitest';
import{OpenAIProvider}from'../../server/provider';
import{loadConfig}from'../../server/config';
import type{ChatRequest,ExternalEvidence}from'../../shared/types';
// Synthetic furniture case only. No actual user conversation is stored here.
const message='Один мастер ремонтирует деревянные стулья в Туле. Не вижу карточку, покажи её прямо в чате.';
const request:ChatRequest={requestId:'furniture-inline-request',projectId:'furniture-project',moduleId:'idea',intent:'message',message,context:{name:'Ремонт стульев',description:'',facts:[],artifacts:[],history:[]},coreContext:{schemaVersion:1,projectId:'furniture-project',moduleId:'idea',generation:0,revision:0,contextVersion:1,sourceMessage:{messageId:'furniture-message',revision:1},currentEntryRefs:[],entries:[],evidence:[],sourceMessages:[{projectId:'furniture-project',moduleId:'idea',generation:0,messageId:'furniture-message',revision:1,role:'user',content:message,createdAt:'2026-11-15T00:00:00.000Z'}]}};
const body='## Идея\nОдин мастер ремонтирует деревянные стулья в Туле.\n\n## Проблема и альтернатива\nГипотеза: владелец выбирает между ремонтом и заменой стула; фактические случаи не исследованы.\n\n## Следующий шаг\nУзнать о последнем сломанном стуле и реальном решении владельца.';
const evidence:ExternalEvidence={projectId:request.projectId,moduleId:'idea',generation:0,id:'furniture-controlled-source',version:1,requestId:'previous-controlled-read',operationId:'read-1',url:'https://controlled.example/chair',title:'Контрольный тариф ремонта',retrievedAt:'2026-11-15T00:00:00.000Z',publishedAt:null,effectiveAt:null,retrieval:'read',contentHash:'a'.repeat(64),quotes:[{id:'quote-1',text:'Ремонт стула:2000RUB.',start:0,end:22}],limitations:[]};
const raw={message:'Карточка ниже — вот она.',choices:[],artifactDraft:{title:'Идея ремонта стульев',body},proposedFacts:[],externalClaims:[{text:'Источник указывает ремонт стула:2000RUB.',evidenceId:'source_1',version:1,quoteId:'quote-1',price:{amount:'2000',currency:'RUB',unit:'unknown',period:'unknown',paymentTerms:'unknown'}}],memoryOperations:[{op:'create',localId:'service',value:{key:'service',kind:'requirement',scope:{subject:'our_project',entityId:null,area:'project',stageId:null,scenario:null},text:'Один мастер ремонтирует деревянные стулья в Туле.',origin:'user',epistemic:'reported',acceptance:'accepted',sources:[{type:'message',projectId:request.projectId,moduleId:'idea',generation:0,messageId:'furniture-message',revision:1,quote:'Один мастер ремонтирует деревянные стулья в Туле.'}],dependsOn:[]}}]};
const response=(value:unknown)=>({status:'completed',error:null,output:[],output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:100}}as never);
it('repairs a synthetic promise into actual in-chat material once while preserving artifact, claim and operation',async()=>{
 let calls=0,resets=0;const events:any[]=[],inputs:unknown[]=[];
 const provider=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'}),{transport:async(params,_signal,onText)=>{calls++;inputs.push(params.input);const output=calls===1?{action:'answer',query:''}:calls===2?raw:{...raw,message:body};if(calls>1)onText?.((output as typeof raw).message);return response(output);}});
 const result=await provider.complete(request,new AbortController().signal,()=>{}, {trustedEvidence:[evidence],onTextReset:()=>resets++,onOperation:e=>events.push(e)});
 expect(calls).toBe(3);expect(resets).toBe(1);expect(JSON.parse(String(inputs[2])).validationIssue).toEqual({path:['message'],rule:'missing_promised_inline_content'});
 expect(result.reply.message).toBe(body);expect(result.reply.artifactDraft).toEqual(raw.artifactDraft);expect(result.reply.externalClaims).toEqual([{...raw.externalClaims[0],evidenceId:evidence.id}]);expect(result.reply.memoryPatch!.operations).toEqual(raw.memoryOperations);
 expect(events.filter(e=>e.kind==='generate'&&e.state==='completed').map(e=>e.metadata.validation)).toEqual(['failed','passed']);expect(result.usage).toEqual({inputTokens:300,outputTokens:300});
});
it('fails closed when the only repair again promises inline material, without applying or leaking the rejected result',async()=>{
 let calls=0;const events:any[]=[];const before=JSON.stringify(request);
 const provider=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'}),{transport:async()=>response(++calls===1?{action:'answer',query:''}:raw)});
 await expect(provider.complete(request,new AbortController().signal,undefined,{trustedEvidence:[evidence],onOperation:e=>events.push(e)})).rejects.toMatchObject({code:'INVALID_RESPONSE',status:502});
 expect(calls).toBe(3);expect(events.filter(e=>e.kind==='generate'&&e.state==='completed').map(e=>e.metadata.validation)).toEqual(['failed','failed']);expect(JSON.stringify(request)).toBe(before);
});
