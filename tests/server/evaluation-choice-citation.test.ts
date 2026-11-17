import { expect, test } from 'vitest';
import type OpenAI from 'openai';
import { acceptEvaluation } from '../../server/evaluator';
import { OpenAIProvider, type ResponseTransport } from '../../server/provider';
import { loadConfig } from '../../server/config';
import { createProject } from '../../shared/domain';
import { TOPIC_CRITERIA } from '../../shared/coverage';
import { PROCESS_CHECK_IDS } from '../../shared/review';
import { makeRequest } from '../acceptance/fixtures';
import type { AssistantReply } from '../../shared/types';

const choice='Продажи начну лично через знакомого управляющего к владельцу.';
const message='Вы лично → знакомый управляющий → владелец → пилот → добровольная оплата → доступ на оплаченный период.';
const candidate:AssistantReply={message,choices:[],artifactDraft:null,proposedFacts:[]};
function verdict(userQuote=false){return {coverage:{rubricVersion:1,moduleId:'business',items:TOPIC_CRITERIA.business.map(c=>({id:c.id,status:'covered',note:'Разобрано по существу.',support:c.needsUserChoice&&userQuote?{role:'user',quote:choice}:{role:'assistant',quote:message}})),nextCriterionId:null},process:{status:'passed',note:'Поручение выполнено.',checks:PROCESS_CHECK_IDS.map(id=>({id,status:'passed',reason:'Контролируемая проверка.'}))},result:{status:'ready',note:'Рабочий результат готов.'},nextAction:null,nextStep:'complete'};}
const config=loadConfig({OPENAI_API_KEY:'synthetic-placeholder',OPENAI_MODEL:'gpt-6.1-sol',AI_EVALUATOR_MODEL:'gpt-6.1-sol',AI_BUDGET_USD:'64'});

test('live covered user choice needs the literal user quote and enters bounded repair instead of false partial',()=>{
 const {request}=makeRequest(createProject(),'business',choice);
 expect(()=>acceptEvaluation(JSON.stringify(verdict()),request,candidate,[],'subject',config.model)).toThrow(expect.objectContaining({validationIssue:{path:['coverage','items',2,'support','role'],rule:'evaluation_user_choice_support'}}));
 const accepted=acceptEvaluation(JSON.stringify(verdict(true)),request,candidate,[],'subject',config.model);
 expect(accepted.coverage.items.find(c=>c.id==='channel')).toMatchObject({status:'covered',support:{role:'user',quote:choice}});
 expect(accepted.review.result?.status).toBe('ready');
});

test('a live paraphrased or damaged quote also enters repair instead of silently losing an explicit choice',()=>{
 const {request}=makeRequest(createProject(),'business',choice),wrong=verdict(true);
 wrong.coverage.items.find(c=>c.id==='channel')!.support.quote=choice.replace('через знакомого','череззнакомого');
 expect(()=>acceptEvaluation(JSON.stringify(wrong),request,candidate,[],'subject',config.model)).toThrow(expect.objectContaining({validationIssue:{path:['coverage','items',2,'support'],rule:'evaluation_support_grounding'}}));
});

test.each(['role','quote'])('repairing only evaluator %s preserves the answer and does not generate it again',async failure=>{
 const calls:OpenAI.Responses.ResponseCreateParamsNonStreaming[]=[];let judges=0;
 const transport:ResponseTransport=async params=>{
  calls.push(params);const f=params.text?.format,name=f?.type==='json_schema'?f.name:'';
  const value=name==='cofounder_action'?{action:'answer',query:''}:name==='cofounder_evaluation'?verdict(++judges>1||failure==='quote'):{...candidate,memoryOperations:[],externalClaims:[]};
  if(name==='cofounder_evaluation'&&judges===1&&failure==='quote')(value as ReturnType<typeof verdict>).coverage.items.find(c=>c.id==='channel')!.support.quote=choice.replace('через знакомого','череззнакомого');
  return {status:'completed',error:null,output:[],output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:100}} as unknown as OpenAI.Responses.Response;
 };
 const {request}=makeRequest(createProject(),'business',choice);
 const result=await new OpenAIProvider(config,{transport}).complete(request,new AbortController().signal);
 const role=(p:OpenAI.Responses.ResponseCreateParamsNonStreaming)=>p.text?.format?.type==='json_schema'?p.text.format.name:'';
 expect(calls.map(role)).toEqual(['cofounder_action','cofounder_reply','cofounder_evaluation','cofounder_evaluation']);
 expect(result.reply.message).toBe(message);
 expect(result.reply.memory?.coverage?.items.find(c=>c.id==='channel')?.status).toBe('covered');
 const repair=JSON.parse(String(calls.at(-1)!.input));
 expect(repair.validationIssue.rule).toBe(failure==='role'?'evaluation_user_choice_support':'evaluation_support_grounding');
});
