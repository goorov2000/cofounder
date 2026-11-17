import { afterEach, expect, it, vi } from 'vitest';
import { sendChat } from '../../src/lib/api';
import type { ChatRequest } from '../../shared/types';
const request:ChatRequest={requestId:'large-transport-1',projectId:'project-transport',moduleId:'idea',intent:'message',message:'Помоги',context:{name:'Тест',description:'',facts:[],artifacts:[],history:[]}};
afterEach(()=>vi.unstubAllGlobals());
it('accepts a bounded full research envelope with six method cards and six read pages over the former 100k frame limit',async()=>{
 const response={requestId:request.requestId,model:'mock',reply:{message:'Готово',choices:[],proposedFacts:[],artifactDraft:null,knowledgeSources:Array.from({length:6},(_,i)=>({id:`method${i}`,title:'Метод',body:'Я'.repeat(12000),version:'1'})),externalSources:Array.from({length:6},(_,i)=>({id:`page${i}`,version:1,projectId:request.projectId,moduleId:'idea',generation:0,requestId:request.requestId,operationId:`read${i}`,url:`https://example.org/${i}`,title:'Страница',retrievedAt:'2026-11-15T00:00:00Z',publishedAt:null,effectiveAt:null,retrieval:'read',contentHash:'hash',quotes:[{id:'q',text:'Я'.repeat(12000),start:0,end:12000}],limitations:[]}))}};
 for(const streaming of [false,true]){
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({configured:true,reason:'',model:'mock',searchEnabled:true})).mockResolvedValueOnce(streaming?new Response(`data: ${JSON.stringify({type:'complete',requestId:request.requestId,response})}\n\n`,{headers:{'Content-Type':'text/event-stream'}}):Response.json(response)));
  await expect(sendChat(request,undefined,streaming?vi.fn():undefined)).resolves.toEqual(response);
 }
});
