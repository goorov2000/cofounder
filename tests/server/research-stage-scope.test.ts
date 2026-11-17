import { afterEach, expect, test, vi } from 'vitest';
import type OpenAI from 'openai';
import { loadConfig } from '../../server/config';
import { OpenAIProvider, type ResponseTransport } from '../../server/provider';
import { extractPage } from '../../server/publicReader';
import { createProject, saveArtifact } from '../../shared/domain';
import { researchCheckInput } from '../../server/researchCollector';
import { TOPIC_CRITERIA } from '../../shared/coverage';
import { PROCESS_CHECK_IDS } from '../../shared/review';
import { makeRequest } from '../acceptance/fixtures';
import type { ModuleId } from '../../shared/types';

afterEach(()=>vi.useRealTimers());
async function capture(moduleId:ModuleId){
 const inputs:OpenAI.Responses.ResponseCreateParamsNonStreaming[]=[];
 const message='Подготовлен условный сценарий; численность покупателей и готовность платить неизвестны.';
 const transport:ResponseTransport=async params=>{
  inputs.push(params);
  const format=params.text?.format,name=format?.type==='json_schema'?format.name:'search';
  let value:unknown,output:unknown[]=[];
  if(name==='cofounder_action')value={action:'research',query:'число кофеен в Самаре первичный источник'};
  else if(name==='search'){value='';output=[{type:'web_search_call',action:{type:'search',sources:[{url:'https://source.example/market',title:'Публичный источник'}]}}];}
  else if(name==='cofounder_research_check')value={ready:true,criteria:TOPIC_CRITERIA[moduleId].map(item=>({id:item.id,status:'unknown'})),focus:null,query:'',note:'Пробелы можно честно отразить.'};
  else if(name==='cofounder_evaluation')value={coverage:{rubricVersion:1,moduleId,items:TOPIC_CRITERIA[moduleId].map(item=>({id:item.id,status:'partial',note:'Условный сценарий.',support:null})),nextCriterionId:TOPIC_CRITERIA[moduleId][0].id},process:{status:'passed',note:'Сведения проверены.',checks:PROCESS_CHECK_IDS.map(id=>({id,status:'passed',reason:'Контролируемая проверка.'}))},result:{status:'in_progress',note:'Ожидает решения пользователя.'},nextAction:'Уточните допущение.',nextStep:'ask_user'};
  else value={message,choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[]};
  return {status:'completed',error:null,output,output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:100}} as OpenAI.Responses.Response;
 };
 const config=loadConfig({OPENAI_API_KEY:'synthetic-placeholder',OPENAI_MODEL:'gpt-6.1-sol',AI_EVALUATOR_MODEL:'gpt-6.1-sol',AI_BUDGET_USD:'64'});
 const provider=new OpenAIProvider(config,{transport,reader:async url=>extractPage('<p>Публичные данные для условного расчёта.</p>',url)});
 await provider.complete(makeRequest(createProject(),moduleId,'Помоги найти данные для текущего этапа.').request,new AbortController().signal);
 return inputs;
}

test('market research checks source gaps and capacity rather than competitor workflows',async()=>{
 const inputs=await capture('market');
 const checks=inputs.filter(p=>p.text?.format?.type==='json_schema'&&p.text.format.name==='cofounder_research_check');
 expect(checks).toHaveLength(1);
 expect(checks[0].instructions).toContain('SOM');
 expect(checks[0].instructions).not.toContain('запрос статуса исполнителю');
 expect(checks[0].instructions).not.toContain('цену Slack');
 expect(checks[0].instructions).toContain('возможностями основателя');
});

test('competitor research retains targeted mechanism and price checks',async()=>{
 const inputs=await capture('competitors');
 const check=inputs.find(p=>p.text?.format?.type==='json_schema'&&p.text.format.name==='cofounder_research_check')!;
 expect(check.instructions).toContain('запрос статуса исполнителю');
 expect(check.instructions).toContain('официальных тарифов');
});

test('every paid role receives the actual server date including web search and evaluator',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-16T17:00:00.000Z'));
 const inputs=await capture('market');
 expect(inputs).toHaveLength(5);
 for(const input of inputs)expect(input.instructions).toContain('2026-11-16');
});

test('source sufficiency receives prior-stage materials and memory without promoting their provenance',()=>{
 const p=saveArtifact(createProject(),'idea',{title:'СменаЛайт — условная идея',body:'Бариста предлагает обмен, коллега принимает, управляющий утверждает. Это гипотеза.'});
 const r=makeRequest(p,'market','Оцени рынок для описанного продукта.').request;
 r.context.memories=[{moduleId:'audience',updatedAt:'2026-11-16T10:00:00Z',content:{facts:[{text:'Покупатель — владелец кофейни.',evidence:'Покупатель — владелец кофейни.'}],hypotheses:['Цена 1500 ₽ не проверена.'],openQuestions:['Будут ли платить?']}}];
 const input=JSON.parse(researchCheckInput(r,[],[]));
 expect(input.project.artifacts).toEqual(r.context.artifacts);
 expect(input.project.memories).toEqual(r.context.memories);
 expect(input.project.artifacts[0].body).toContain('Это гипотеза.');
 expect(input.project.memories[0].content.hypotheses).toEqual(['Цена 1500 ₽ не проверена.']);
 expect(input.sources).toEqual([]);
});
