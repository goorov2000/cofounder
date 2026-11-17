import{expect,it}from'vitest';
import actual from'./fixtures/price-components/target13-non-numeric-free.json';
import{OpenAIProvider}from'../../server/provider';
import{loadConfig}from'../../server/config';
import type{ChatRequest,ExternalEvidence}from'../../shared/types';
const request:ChatRequest={requestId:'free-word-request',projectId:'free-word-project',moduleId:'competitors',intent:'message',message:'Покажи условия бесплатного доступа',context:{name:'Test',description:'',facts:[],artifacts:[],history:[]}};
const evidence:ExternalEvidence={projectId:request.projectId,moduleId:'competitors',generation:0,id:'free-word-source',version:1,requestId:'earlier-read',operationId:'read-1',url:'https://controlled.example/free',title:'Условия доступа',retrievedAt:'2026-11-15T00:00:00.000Z',publishedAt:null,effectiveAt:null,retrieval:'read',contentHash:'a'.repeat(64),quotes:[{id:'quote-1',text:'14 дней БЕСПЛАТНО. Банковская карта не нужна.',start:0,end:44}],limitations:[]};
const claim={text:'На странице указаны 14 дней БЕСПЛАТНО; банковская карта не нужна.',evidenceId:'source_1',version:1,quoteId:'quote-1',price:{amount:'БЕСПЛАТНО',currency:'unknown',unit:'unknown',period:'14 дней',paymentTerms:'Банковская карта не нужна.'}};
const bad={message:'Бесплатный пробный доступ — 14 дней; банковская карта не нужна.',choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[claim]};
const response=(value:unknown)=>({status:'completed',error:null,output:[],output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:100}}as never);
it('repairs nonnumeric FREE into the same non-price claim without inventing zero or dropping trial conditions',async()=>{
 let calls=0;const events:any[]=[],inputs:unknown[]=[];
 const fixed={...bad,externalClaims:[{...claim,price:null}]};
 const provider=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'}),{transport:async params=>{calls++;inputs.push(params.input);return response(calls===1?{action:'answer',query:''}:calls===2?bad:fixed);}});
 const result=await provider.complete(request,new AbortController().signal,undefined,{trustedEvidence:[evidence],onOperation:e=>events.push(e)});
 expect(calls).toBe(3);expect(JSON.parse(String(inputs[2])).validationIssue).toEqual({path:['externalClaims',0,'price','amount'],rule:'non_numeric_price_amount'});
 expect(result.reply.externalClaims).toEqual([{...claim,evidenceId:evidence.id,price:null}]);expect(result.reply.message).toBe(bad.message);expect(result.usage).toEqual({inputTokens:300,outputTokens:300});
 expect(events.filter(e=>e.kind==='generate'&&e.state==='completed').map(e=>e.metadata.validation)).toEqual(['failed','passed']);expect(JSON.parse(String(inputs[2])).rejectedOutput).toContain('БЕСПЛАТНО');
});

for(const [index,attempt]of actual.attempts.entries())it(`repairs actual B13 attempt ${index+1} without dropping any claim or manufacturing a numeric free price`,async()=>{
 const first=JSON.parse(attempt.outputText);const fixed=structuredClone(first);let changed=0;for(const claim of fixed.externalClaims)if(claim.price?.amount==='БЕСПЛАТНО'){claim.price=null;changed++;}
 expect(changed).toBeGreaterThan(0);let calls=0;const inputs:unknown[]=[],events:any[]=[];
 const provider=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'test-placeholder'}),{transport:async params=>{calls++;inputs.push(params.input);return response(calls===1?{action:'answer',query:''}:calls===2?first:fixed);}});
 const result=await provider.complete(actual.request as unknown as ChatRequest,new AbortController().signal,undefined,{trustedEvidence:actual.catalogue as ExternalEvidence[],onOperation:e=>events.push(e)});
 expect(calls).toBe(3);expect(JSON.parse(String(inputs[2])).validationIssue.rule).toBe('non_numeric_price_amount');
 expect(result.reply.externalClaims).toHaveLength(first.externalClaims.length);
 for(let i=0;i<first.externalClaims.length;i++){const previous=first.externalClaims[i],resolved=actual.sourceAliases.find(s=>s.alias===previous.evidenceId)!;expect(result.reply.externalClaims![i]).toEqual({...previous,evidenceId:resolved.id,price:previous.price?.amount==='БЕСПЛАТНО'?null:previous.price});}
 expect(events.filter(e=>e.kind==='generate'&&e.state==='completed').map(e=>e.metadata.validation)).toEqual(['failed','passed']);
});
