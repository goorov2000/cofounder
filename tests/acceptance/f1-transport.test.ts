import { afterEach, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { BudgetLedger } from '../../server/ledger';
import { OpenAIProvider, type ResponseTransport } from '../../server/provider';
import { extractPage } from '../../server/publicReader';
import { createProject } from '../../shared/domain';
import { applyAnswer } from '../../src/features/workspace/answerRequests';
import { assertRequestFits, sendChat } from '../../src/lib/api';
import { projectToMarkdown } from '../../shared/exports';
import { makeRequest } from './fixtures';
const response=(value:unknown,output:unknown[]=[])=>({status:'completed',output,output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:30}}) as OpenAI.Responses.Response;
afterEach(()=>vi.unstubAllGlobals());
it('F03 carries real six-page provider envelopes and valid >80k model JSON over HTTP JSON/SSE, applies and sends the next turn; overflow preserves export',async()=>{
 const realFetch=globalThis.fetch;
 for(const largeModel of [false,true])for(const streaming of [false,true]){
  let first=true;
  const payload={message:'Я'.repeat(1000),choices:[],proposedFacts:largeModel?Array.from({length:20},(_,i)=>({key:`field-${i}`,value:'Д'.repeat(1000),note:'О'.repeat(1000),provenance:'hypothesis'})):[],artifactDraft:{title:'Сравнение',body:'Б'.repeat(23000)},memoryOperations:[],externalClaims:[]};
  expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(largeModel?80_000:46_000);
  const transport=vi.fn<ResponseTransport>(async(params,_signal,onText)=>{
   if(params.text?.format?.type==='json_schema'&&params.text.format.name==='cofounder_action')return response({action:first?'research':'answer',query:first?'тарифы':''});
   if(params.tools)return response('Sources',[{type:'web_search_call',action:{sources:Array.from({length:6},(_,i)=>({url:`https://vendor.example/${i}`,title:'Тарифы'}))}}]);
   const value=first?payload:{...payload,message:'Продолжаем',artifactDraft:null,proposedFacts:[]};first=false;onText?.(value.message);return response(value);
  });
  const reader=vi.fn(async(url:string)=>extractPage(Array.from({length:5},(_,i)=>`<p>Тариф ${i}: ${'Я'.repeat(480)} цена ${i+1} рублей в месяц.</p>`).join(''),url));
  const config={...loadConfig({OPENAI_API_KEY:'test-placeholder',AI_BUDGET_USD:'5'}),origin:'http://localhost:3010'};
  const ledger=new BudgetLedger(':memory:',config), app=createApp({ledger,config,provider:new OpenAIProvider(config,{transport,reader})});
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address() as {port:number};let cookie='';
  vi.stubGlobal('fetch',async(url:string|URL|Request,init?:RequestInit)=>{const result=await realFetch(`http://127.0.0.1:${address.port}${String(url)}`,{...init,headers:{...init?.headers,Origin:config.origin,Cookie:cookie}});cookie=result.headers.get('set-cookie')?.split(';')[0]??cookie;return result;});
  try{
   const seed=makeRequest(createProject(),'idea','Найди тарифы'), chunks:string[]=[];
   const result=await sendChat(seed.request,undefined,streaming?delta=>chunks.push(delta):undefined);
   expect(Buffer.byteLength(JSON.stringify(result.reply))).toBeGreaterThan(80_000);
   expect(reader).toHaveBeenCalledTimes(6);expect(transport).toHaveBeenCalledTimes(3);
   expect(result.reply.externalSources).toHaveLength(6);
   for(const page of result.reply.externalSources!)expect(page.quotes).toHaveLength(5);
   if(streaming)expect(chunks.join('')).toBe(payload.message);
   const saved=applyAnswer(seed.project,seed.request,result.reply);expect(saved.core!.evidence).toEqual(result.reply.externalSources);
   const next=makeRequest(saved,'idea','Продолжим');expect(()=>assertRequestFits(next.request)).not.toThrow();
   const follow=await sendChat(next.request,undefined,streaming?()=>{}:undefined);expect(follow.reply.message).toBe('Продолжаем');
   expect(applyAnswer(next.project,next.request,follow.reply).core!.evidence).toEqual(saved.core!.evidence);
   const full=structuredClone(next.request);for(let index=0;index<6;index++)full.coreContext!.sourceMessages.push({...full.coreContext!.sourceMessages[0],messageId:`long-archive-${index}`,content:'Я'.repeat(100_000)});
   expect(()=>assertRequestFits(full)).toThrow(expect.objectContaining({code:'CONTEXT_LIMIT'}));
   expect(saved.core!.evidence).toHaveLength(6);expect(projectToMarkdown(saved)).toContain(result.reply.externalSources![5].quotes[4].text);
   expect(transport).toHaveBeenCalledTimes(5);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));ledger.close();vi.unstubAllGlobals();}
 }
},20000);
