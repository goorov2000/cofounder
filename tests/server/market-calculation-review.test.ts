import { expect, test } from 'vitest';
import { acceptEvaluation } from '../../server/evaluator';
import { TOPIC_CRITERIA, coverageBasis, savedCoverage, isTopicComplete } from '../../shared/coverage';
import { createProject } from '../../shared/domain';
import { PROCESS_CHECK_IDS } from '../../shared/review';
import { serializeWorkspace, parseWorkspace } from '../../shared/validation';
import type { AssistantReply, ChatRequest, MarketCalculationEvidence, TopicCoverage } from '../../shared/types';

const request:ChatRequest={requestId:'market-review-test',projectId:'market-project',moduleId:'market',intent:'message',message:'Начнём оценивать рынок.',context:{name:'Индивидуальная одежда',description:'',facts:[],artifacts:[],history:[]}};
const frame='TAM — число покупателей × заказов в год × стоимость заказа. SAM — обслуживаемая часть TAM. SOM — минимум из спроса и мощности за первые 12 месяцев. Численность и чек пока неизвестны.';
const proof:MarketCalculationEvidence={
  tam:{quote:'TAM: 1000 × 2 × 10000 = 20 000 000 ₽/год.',formula:'1000 × 2 × 10000',result:'20 000 000 ₽/год'},
  sam:{quote:'SAM: 200 × 2 × 10000 = 4 000 000 ₽/год.',formula:'200 × 2 × 10000',result:'4 000 000 ₽/год'},
  som:{quote:'SOM: 20 × 10000 = 200 000 ₽ за первый год.',formula:'20 × 10000',result:'200 000 ₽ за первый год'},
};
const numeric='Рабочий условный сценарий, не измеренный рынок. Все численные входы — допущения для проверки.\n'+Object.values(proof).map(level=>level.quote).join('\n');
const reply=(message:string):AssistantReply=>({message,choices:[],artifactDraft:null,proposedFacts:[]});
function verdict(quote:string,marketCalculation:MarketCalculationEvidence|null=null,status:'covered'|'partial'='covered') {
  return {coverage:{rubricVersion:1 as const,moduleId:'market' as const,items:TOPIC_CRITERIA.market.map(item=>({id:item.id,status:item.id==='calculation'?status:'partial' as const,note:'Оценка текущего материала.',support:item.id==='calculation'&&status==='covered'?{role:'assistant' as const,quote}:null})),nextCriterionId:'boundaries'},
    process:{status:'passed',note:'Сценарий проверен.',checks:PROCESS_CHECK_IDS.map(id=>({id,status:'passed',reason:'Контролируемая оценка.'}))},result:{status:'in_progress',note:'Тема ещё прорабатывается.'},nextAction:null,nextStep:null,marketCalculation};
}
function assessed(message:string,proof:MarketCalculationEvidence|null=null,source=request,status:'covered'|'partial'='covered'){
  const quote=message===frame?'TAM — число покупателей × заказов в год × стоимость заказа.':message.split('\n').at(-1)!;
  return acceptEvaluation(JSON.stringify(verdict(quote,proof,status)),source,reply(message),[],'review-input','mock-model');
}
const calculation=(coverage:TopicCoverage)=>coverage.items.find(item=>item.id==='calculation')!;

test('definitions and unknown-input formulas stay partial even when the judge mistakenly marks them covered',()=>{
  expect(calculation(assessed(frame).coverage).status).toBe('partial');
});

test('SOM sensitivity alone cannot close the calculation for all three market levels',()=>{
  const som='SOM при 100 обращениях и конверсии 5%: 100 × 0,05 = 5 заказов за год. TAM и SAM неизвестны.';
  expect(calculation(assessed(som).coverage).status).toBe('partial');
});

test('all three numerical scenario results can close calculation without pretending they are measured demand',()=>{
  const result=assessed(numeric,proof);
  expect(calculation(result.coverage)).toMatchObject({status:'covered',calculationEvidence:proof});
});

test('a directly sourced numeric level is allowed alongside calculated levels',()=>{
  const direct={...proof,tam:{quote:'TAM = 1000 покупателей в год по выбранному источнику.',formula:'TAM = 1000',result:'1000 покупателей в год'}};
  const message='Подстановка численных входов текущего сценария.\n'+Object.values(direct).map(level=>level.quote).join('\n');
  expect(calculation(assessed(message,direct).coverage).status).toBe('covered');
});

test('fabricated calculation quotes do not close the criterion',()=>{
  const message=frame+'\nВоспроизводимые формулы предложены.';
  expect(calculation(assessed(message,proof).coverage).status).toBe('partial');
});

test('a valid prior calculation can remain covered without repeating it in every answer; explicit downgrades remain allowed',()=>{
  const prior={...request,context:{...request.context,history:[{role:'assistant' as const,content:numeric}]}};
  const reviewed=acceptEvaluation(JSON.stringify(verdict(proof.som.quote,proof)),prior,reply('Уточняем ограничения производства.'),[],'review-input','mock-model');
  expect(calculation(reviewed.coverage).status).toBe('covered');
  expect(calculation(assessed('Цена изменилась; расчёт надо пересчитать.',proof,prior,'partial').coverage).status).toBe('partial');
});

test('saved premature green statuses are corrected for display and completion without deleting history or opening a new paid request',()=>{
  const project=createProject();project.activeModule='market';project.unlockedStages=['idea','audience','competitors','market'];
  project.modules.market.messages=[{id:'old-answer',role:'assistant',content:frame,createdAt:project.createdAt}];
  const coverage:TopicCoverage={rubricVersion:1,moduleId:'market',nextCriterionId:null,items:TOPIC_CRITERIA.market.map(item=>({id:item.id,status:'covered',note:'Обсуждали.',support:{role:'assistant',quote:'TAM — число покупателей × заказов в год × стоимость заказа.'}}))};
  project.modules.market.memory={content:{facts:[],hypotheses:[],openQuestions:[],coverage},updatedAt:project.updatedAt};
  project.modules.market.memory.coverageBasis=coverageBasis(project,'market');
  const restored=parseWorkspace(serializeWorkspace({version:1,activeProjectId:project.id,projects:[project]})).projects[0];
  expect(calculation(savedCoverage(restored,'market')!).status).toBe('partial');
  expect(isTopicComplete(restored,'market')).toBe(false);
  expect(restored.modules.market.messages[0].content).toBe(frame);
  expect(restored.modules.market.memory!.content.coverage!.items.find(item=>item.id==='calculation')!.status).toBe('covered');
});
