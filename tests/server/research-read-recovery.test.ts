import { expect, test, vi } from 'vitest';
import type OpenAI from 'openai';
import { OpenAIProvider, type ResponseTransport } from '../../server/provider';
import { loadConfig } from '../../server/config';
import { extractPage, PageReadError } from '../../server/publicReader';
import { collectResearch } from '../../server/researchCollector';
import type { OperationEvent } from '../../server/ledger';
import { TOPIC_CRITERIA } from '../../shared/coverage';
import { PROCESS_CHECK_IDS } from '../../shared/review';
import { createProject } from '../../shared/domain';
import { makeRequest } from '../acceptance/fixtures';

const message='Численность покупателей узкого сегмента неизвестна; найденный материал не отделяет пошив от ремонта.';
const initialQuery='Россия индивидуальный пошив одежды численность покупателей';
function replay(options:{alternativeUnreadable?:boolean;searchFailure?:boolean}={}){
  const inputs:Array<{name:string;params:OpenAI.Responses.ResponseCreateParamsNonStreaming}>=[],events:OperationEvent[]=[];
  let searches=0;
  const transport:ResponseTransport=async params=>{
    const name=params.text?.format?.type==='json_schema'?params.text.format.name:'search';
    inputs.push({name,params});let value:unknown,output:unknown[]=[];
    if(name==='cofounder_action')value={action:'research',query:initialQuery};
    else if(name==='search'){
      if(options.searchFailure)throw Error('private uncertain network details');
      searches++;
      const sources=searches===1?Array.from({length:6},(_,i)=>({url:`https://statistics.example/region-${i}.pdf`,title:'Официальная статистика'})):[{url:'https://research.example/market',title:'Публикация автора исследования'}];
      output=[{type:'web_search_call',action:{type:'search',sources}}];value='';
    }else if(name==='cofounder_research_check'){
      // Reproduce the real premature Luna readiness after six failed reads.
      value={ready:true,criteria:TOPIC_CRITERIA.market.map(item=>({id:item.id,status:item.id==='inputs'?'unknown':'supported'})),focus:null,query:'',note:'Можно показать формулы с неизвестными входами.'};
    }else if(name==='cofounder_evaluation')value={
      coverage:{rubricVersion:1,moduleId:'market',items:TOPIC_CRITERIA.market.map(item=>({id:item.id,status:'partial',note:'Численность сегмента неизвестна.',support:null})),nextCriterionId:'inputs'},
      process:{status:'passed',note:'Выполнена доступная проверка.',checks:PROCESS_CHECK_IDS.map(id=>({id,status:'passed',reason:'Контролируемое воспроизведение.'}))},
      result:{status:'in_progress',note:'Данные не дают точной численности.'},nextAction:'Уточнить сценарий расчёта.',nextStep:'ask_user',
    };
    else value={message,choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[]};
    return {status:'completed',error:null,output,output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:100}} as OpenAI.Responses.Response;
  };
  const reader=vi.fn(async(url:string)=>{
    if(url.includes('region-0'))throw Object.assign(new Error('private TLS details'),{code:'SELF_SIGNED_CERT_IN_CHAIN'});
    if(url.includes('region-1'))throw Object.assign(new Error('private timeout details',{cause:new DOMException('timeout','TimeoutError')}),{name:'AbortError',code:'ABORT_ERR'});
    if(url.endsWith('.pdf')||options.alternativeUnreadable)throw new PageReadError('PAGE_UNSUPPORTED_TYPE');
    return extractPage('<p>Исследование рынка услуг: пошив и ремонт учтены совместно. Отдельная численность покупателей не опубликована в этой таблице.</p>',url);
  });
  const config=loadConfig({OPENAI_API_KEY:'synthetic-placeholder',OPENAI_MODEL:'gpt-6.1-sol',AI_EVALUATOR_MODEL:'gpt-6.1-sol',AI_BUDGET_USD:'64'});
  const provider=new OpenAIProvider(config,{transport,reader});
  const request=makeRequest(createProject(),'market','Помоги найти основания для размера рынка.').request;
  return {inputs,events,reader,run:()=>provider.complete(request,new AbortController().signal,undefined,{onOperation:e=>events.push(e)})};
}

test('six failed reads cannot end research on premature ready before a distinct HTML search',async()=>{
  const replayed=replay(),result=await replayed.run();
  expect(replayed.inputs.map(item=>item.name)).toEqual(['cofounder_action','search','cofounder_research_check','search','cofounder_research_check','cofounder_reply','cofounder_evaluation']);
  const searches=replayed.inputs.filter(item=>item.name==='search');
  expect(searches[1].params.input).not.toBe(searches[0].params.input);
  expect(searches[1].params.input).toContain('-filetype:pdf');
  expect(searches[0].params.instructions).toContain('PDF, XLS/XLSX');
  expect(searches[1].params.instructions).toContain('https://statistics.example/region-0.pdf');
  const checks=replayed.inputs.filter(item=>item.name==='cofounder_research_check');
  const first=JSON.parse(String(checks[0].params.input));
  expect(first.reading).toMatchObject({readCount:0,unavailableCount:6});
  expect(first.sources[0].limitations[0]).toContain('TLS');
  expect(first.sources[1].limitations[0]).toContain('время чтения');
  expect(JSON.stringify(first.sources)).not.toContain('private');
  expect(replayed.events.find(event=>event.id==='read-1'&&event.state==='failed')?.errorCode).toBe('SELF_SIGNED_CERT_IN_CHAIN');
  expect(replayed.events.find(event=>event.id==='read-2'&&event.state==='failed')?.errorCode).toBe('PAGE_TIMEOUT');
  expect(replayed.reader).toHaveBeenCalledTimes(7);
  expect(result.reply.externalSources?.filter(item=>item.retrieval==='read')).toHaveLength(1);
  expect(result.reply.research?.status).toBe('partial');
  expect(result.reply.memory?.review?.status).toBe('completed');
});

test('an unsuccessful alternative attempt stays honest and does not loop or retry any URL',async()=>{
  const replayed=replay({alternativeUnreadable:true}),result=await replayed.run();
  expect(replayed.inputs.filter(item=>item.name==='search')).toHaveLength(2);
  expect(new Set(replayed.reader.mock.calls.map(([url])=>url)).size).toBe(7);
  expect(result.reply.externalSources?.every(item=>item.retrieval==='unavailable')).toBe(true);
  expect(result.reply.research?.status).toBe('failed');
  expect(replayed.inputs.filter(item=>item.name==='cofounder_reply')).toHaveLength(1);
});

test('an uncertain paid search never triggers the readable-alternatives fallback',async()=>{
  const replayed=replay({searchFailure:true}),result=await replayed.run();
  expect(replayed.inputs.filter(item=>item.name==='search')).toHaveLength(1);
  expect(replayed.inputs.filter(item=>item.name==='cofounder_research_check')).toHaveLength(0);
  expect(replayed.reader).not.toHaveBeenCalled();
  expect(result.reply.research?.status).toBe('failed');
  expect(replayed.events.find(event=>event.kind==='search'&&event.state==='unknown')?.chargedUsd).toBeGreaterThan(0);
});

test('cancellation before the alternative search prevents any further search or check',async()=>{
  const request=makeRequest(createProject(),'market','Найди источники.').request,controller=new AbortController();
  const search=vi.fn(async()=>({status:'partial' as const,evidence:[{retrieval:'unavailable'} as any],limitations:[]}));
  const check=vi.fn(async()=>JSON.stringify({ready:true,criteria:TOPIC_CRITERIA.market.map(item=>({id:item.id,status:'unknown'})),focus:null,query:'',note:'Нет данных.'}));
  await expect(collectResearch({request,initialQuery,historical:[],signal:controller.signal,search,check,
    progress:event=>{if(event.message.startsWith('Найденные страницы'))controller.abort(Error('User stopped'));},
  })).rejects.toThrow('User stopped');
  expect(search).toHaveBeenCalledTimes(1);expect(check).toHaveBeenCalledTimes(1);
});
