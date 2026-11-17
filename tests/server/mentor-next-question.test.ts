import { expect, test } from 'vitest';
import type OpenAI from 'openai';
import { OpenAIProvider, type ResponseTransport } from '../../server/provider';
import { appendMissingUserQuestion } from '../../server/evaluator';
import { hash } from '../../server/ledger';
import { loadConfig } from '../../server/config';
import { makeRequest } from '../acceptance/fixtures';
import { createProject } from '../../shared/domain';
import { TOPIC_CRITERIA } from '../../shared/coverage';
import { PROCESS_CHECK_IDS } from '../../shared/review';
import type { AssistantReply } from '../../shared/types';

const candidate:AssistantReply = {message:'Можем продолжить здесь, если захочешь уточнить.',choices:[],artifactDraft:null,proposedFacts:[]};
const question = 'Какой бюджет ты готов выделить на первые размещения?';
test('a missing user question is supplied from the independent judgment without another generation',async()=>{
  const inputs:Array<{name:string;params:OpenAI.Responses.ResponseCreateParamsNonStreaming}>=[];
  const transport:ResponseTransport=async params=>{
    const name=params.text?.format?.type==='json_schema'?params.text.format.name:'search';inputs.push({name,params});
    const value=name==='cofounder_action'?{action:'answer',query:''}:name==='cofounder_evaluation'?{
      coverage:{rubricVersion:1,moduleId:'market',items:TOPIC_CRITERIA.market.map(item=>({id:item.id,status:'partial',note:'Остался личный выбор.',support:null})),nextCriterionId:'reach'},
      process:{status:'needs_work',note:'Не задан нужный вопрос.',checks:PROCESS_CHECK_IDS.map(id=>({id,status:id==='questions'?'failed':'passed',reason:'Нужен конкретный вопрос.'}))},
      result:{status:'in_progress',note:'Осталось ограничение пользователя.'},nextStep:'ask_user',nextAction:question,
    }:candidate;
    return {status:'completed',error:null,output:[],output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:100}} as unknown as OpenAI.Responses.Response;
  };
  const request=makeRequest(createProject(),'market','Предпочитаю тематические сообщества.').request;
  const provider=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'synthetic-placeholder',OPENAI_MODEL:'gpt-6.1-sol',AI_EVALUATOR_MODEL:'gpt-6.1-sol',AI_BUDGET_USD:'64'}),{transport});
  const result=await provider.complete(request,new AbortController().signal);
  expect(inputs.map(item=>item.name)).toEqual(['cofounder_action','cofounder_reply','cofounder_evaluation']);
  expect(result.reply.message).toBe(candidate.message+'\n\n'+question);
  expect(result.reply.memory?.review?.subjectHash).toBe(hash(String(inputs.at(-1)!.params.input)));
  expect(JSON.parse(String(inputs.at(-1)!.params.input)).candidate.message).toBe(candidate.message);
  expect(result.reply.memory?.review?.process?.status).toBe('needs_work');
});

test('existing questions and choices are not duplicated, and research is not assigned to the user',()=>{
  const review={version:1 as const,status:'completed' as const,model:'mock',subjectHash:'h',assessedAt:'2026-11-17T10:00:00Z',process:null,result:null,nextStep:'ask_user' as const,nextAction:question,errorCode:null};
  const reply={...candidate,memory:{facts:[],hypotheses:[],openQuestions:[],review}};
  expect(appendMissingUserQuestion({...reply,message:question}).message).toBe(question);
  expect(appendMissingUserQuestion({...reply,choices:[{id:'a',label:'Нулевой бюджет',description:''}]}).message).toBe(candidate.message);
  expect(appendMissingUserQuestion({...reply,memory:{...reply.memory,review:{...review,nextStep:'research'}}}).message).toBe(candidate.message);
  expect(appendMissingUserQuestion({...reply,memory:{...reply.memory,review:{...review,nextAction:'Уточнить бюджет.'}}}).message).toBe(candidate.message);
});

test('the checker supplies answer buttons for an existing open choice question without duplicating its text',()=>{
  const review={version:1 as const,status:'completed' as const,model:'mock',subjectHash:'h',assessedAt:'2026-11-17T10:00:00Z',process:null,result:null,nextStep:'ask_user' as const,nextAction:question,errorCode:null};
  const options=[{id:'none',label:'Пока без рекламного бюджета',description:'Рассмотрим способы привлечения без оплаты размещений.',recommended:false},{id:'small',label:'До 5 000 ₽ в месяц',description:'Рабочий ориентир для обсуждения первого теста.',recommended:false},{id:'undecided',label:'Пока не определился',description:'Сначала сравним подходящие способы привлечения.',recommended:false}];
  const result=appendMissingUserQuestion({...candidate,message:`Есть доступный канал. **${question}**`,memory:{facts:[],hypotheses:[],openQuestions:[],review}},{question,choices:options});
  expect(result.message).toBe(`Есть доступный канал. **${question}**`);
  expect(result.choices).toEqual(options);
  expect(result.memory?.review).toBe(review);
});
