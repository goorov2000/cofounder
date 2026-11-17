import {expect,it} from 'vitest';
import {createRecordedProvider} from '../../scripts/recorded-provider';
import {loadConfig} from '../../server/config';
import type {ChatRequest} from '../../shared/types';
import type {ResponseTransport} from '../../server/provider';

const config=loadConfig({OPENAI_API_KEY:'synthetic-test-placeholder'});
const request:ChatRequest={requestId:'recorded-request',projectId:'recorded-project',moduleId:'idea',intent:'message',message:'Помоги проверить идею',context:{name:'Test',description:'',facts:[],artifacts:[],history:[]}};
const good={message:'Начните с последнего конкретного случая: кто столкнулся с задачей и как решил её сейчас? Спрос пока неизвестен.',choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[]};
const response=(value:unknown)=>({status:'completed',error:null,output_text:JSON.stringify(value),output:[{type:'reasoning',summary:[{type:'summary_text',text:'private-reasoning-sentinel'}]},{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:100,output_tokens:50}} as never);

it('records both rejected and repaired raw output without reasoning and forwards paid operation events',async()=>{
 const rows:Array<{name:string;value:any}>=[],operations:unknown[]=[],deltas:string[]=[];
 let calls=0;
 const provider=createRecordedProvider(config,(name,value)=>rows.push({name,value}),async(_params,_signal,onText)=>{
  calls++;if(calls===1)return response({action:'answer',query:''});
  const value=calls===2?{...good,message:'Число 5\u000000'}:good;onText?.(value.message);return response(value);
 });
 const result=await provider.complete(request,new AbortController().signal,text=>deltas.push(text),{onOperation:event=>operations.push(event)});
 expect(result.reply.message).toBe(good.message);expect(result.usage).toEqual({inputTokens:300,outputTokens:150});
 const raw=rows.filter(row=>row.name==='model-output');expect(raw).toHaveLength(3);
 expect(raw[1].value.outputText).toContain('\\u0000');expect(raw[2].value.outputText).toContain(good.message);
 expect(JSON.stringify(rows)).not.toContain('private-reasoning-sentinel');
 expect(raw.every(row=>row.value.requestId===request.requestId)).toBe(true);
 expect(rows.filter(row=>row.name==='operations').map(row=>row.value.event)).toEqual(operations);
 expect(operations).toContainEqual(expect.objectContaining({id:'generate',state:'completed',metadata:expect.objectContaining({validation:'failed'})}));
 expect(operations).toContainEqual(expect.objectContaining({id:'generate-repair',state:'completed',metadata:expect.objectContaining({validation:'passed'})}));
 expect(deltas).toEqual(['Число 5\u000000',good.message]);
});

it('keeps concurrent request identities separate while preserving the normal transport parameters',async()=>{
 const rows:Array<{name:string;value:any}>=[],sent:Parameters<ResponseTransport>[0][]=[];
 const provider=createRecordedProvider(config,(name,value)=>rows.push({name,value}),async params=>{
  sent.push(params);await new Promise(resolve=>setTimeout(resolve,1));
  return response(params.text?.format?.type==='json_schema'&&params.text.format.name==='cofounder_action'?{action:'answer',query:''}:good);
 });
 await Promise.all([provider.complete(request,new AbortController().signal),provider.complete({...request,requestId:'second-request',projectId:'second-project'},new AbortController().signal)]);
 const raw=rows.filter(row=>row.name==='model-output');expect(raw).toHaveLength(4);
 expect(raw.filter(row=>row.value.requestId===request.requestId)).toHaveLength(2);
 expect(raw.filter(row=>row.value.requestId==='second-request')).toHaveLength(2);
 expect(raw.every(row=>row.value.projectId===(row.value.requestId===request.requestId?'recorded-project':'second-project'))).toBe(true);
 expect(sent.every(params=>params.store===false&&params.model===config.model)).toBe(true);
});
