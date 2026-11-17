import { expect, test, vi } from 'vitest';
import type OpenAI from 'openai';
import { createResponseTransport, type StreamTrace } from '../../server/responseTransport';
import { loadConfig } from '../../server/config';
import { MODEL_OUTPUT_BYTES } from '../../shared/transportLimits';

const config=loadConfig({OPENAI_API_KEY:'synthetic-placeholder',OPENAI_MODEL:'gpt-6.1-sol'});
const params={model:config.model,input:'Synthetic request',max_output_tokens:16384};
function rig(chunks:string[],terminal=true){
 const json=chunks.join('');const trace:StreamTrace[]=[];
 const result={id:'resp-synthetic',status:'completed',error:null,output:[{type:'message',content:[{type:'output_text',text:json}]}],usage:{input_tokens:100,output_tokens:50}};
 const create=vi.fn(async()=> (async function*(){
  yield {type:'response.created',response:{id:result.id}};
  for(const delta of chunks)yield {type:'response.output_text.delta',delta};
  if(terminal)yield {type:'response.completed',response:result};
 })());
 const send=createResponseTransport(config,t=>trace.push(t),{create} as unknown as Pick<OpenAI['responses'],'create'>);
 return {send,create,trace,json};
}

test('a long brief drains through final usage and exposes its full safe message',async()=>{
 const message='Описание сценария. '.repeat(800),json=JSON.stringify({message,choices:[]});
 const run=rig([json.slice(0,7000),json.slice(7000)]);let preview='';
 const result=await run.send(params,new AbortController().signal,d=>{preview+=d;});
 expect(preview).toBe(message);expect(result.output_text).toBe(json);expect(result.usage?.output_tokens).toBe(50);
 expect(run.trace[0]).toMatchObject({responseId:'resp-synthetic',terminal:true,previewStopped:false});
});

test.each(['\\u0000unsafe','\\xinvalid'])('unsafe preview %s freezes while terminal usage is still collected',async ending=>{
 const run=rig(['{"message":"safe',ending+'"}']);let preview='';
 const result=await run.send(params,new AbortController().signal,d=>{preview+=d;});
 expect(preview).toBe('safe');expect(result.usage?.input_tokens).toBe(100);
 expect(run.create).toHaveBeenCalledTimes(1);
 expect(run.trace[0]).toMatchObject({terminal:true,previewStopped:true,eventTypes:{'response.completed':1}});
});

test('a genuinely missing terminal event preserves response identity and partial output without retry',async()=>{
 const run=rig(['{"message":"partial'],false);
 await expect(run.send(params,new AbortController().signal,()=>{})).rejects.toMatchObject({code:'PROVIDER_NETWORK'});
 expect(run.create).toHaveBeenCalledTimes(1);
 expect(run.trace[0]).toMatchObject({responseId:'resp-synthetic',terminal:false,partialOutput:run.json,partialTruncated:false});
});

test('wire-byte overflow is still bounded and is not accepted as a complete response',async()=>{
 const run=rig(['{"message":"'+'я'.repeat(MODEL_OUTPUT_BYTES)]);
 await expect(run.send(params,new AbortController().signal,()=>{})).rejects.toMatchObject({code:'INVALID_RESPONSE'});
 expect(run.trace[0]).toMatchObject({terminal:false,partialTruncated:true});
 expect(Buffer.byteLength(run.trace[0].partialOutput!)).toBeLessThanOrEqual(MODEL_OUTPUT_BYTES+3);
});

test('message completion callback fires once before remaining JSON and usage finish',async()=>{
 const run=rig(['{"message":"Ответ','", "choices":','[]}']);const done=vi.fn();
 await run.send(params,new AbortController().signal,()=>{},done);
 expect(done).toHaveBeenCalledTimes(1);
});

test('structured output above the former 256 KiB ceiling drains to final usage',async()=>{
 const json=JSON.stringify({message:'Сравнение готово.',padding:'я'.repeat(180000)});
 const run=rig([json.slice(0,160000),json.slice(160000)]);let preview='';
 const result=await run.send({...params,max_output_tokens:128000},new AbortController().signal,d=>{preview+=d;});
 expect(Buffer.byteLength(json)).toBeGreaterThan(256*1024);
 expect(result.output_text).toBe(json);expect(result.usage?.output_tokens).toBe(50);
 expect(preview).toBe('Сравнение готово.');expect(run.trace[0].terminal).toBe(true);
});
