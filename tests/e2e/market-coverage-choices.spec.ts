import { test, expect } from '@playwright/test';
import supertest from 'supertest';
import type OpenAI from 'openai';
import { createProject } from '../../shared/domain';
import { coverageBasis, TOPIC_CRITERIA } from '../../shared/coverage';
import type { TopicCoverage, ChatRequest } from '../../shared/types';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { OpenAIProvider, type ResponseTransport } from '../../server/provider';
import { BudgetLedger } from '../../server/ledger';
import { PROCESS_CHECK_IDS } from '../../shared/review';

const frame='TAM = число покупателей × заказы за год × стоимость заказа. SAM = обслуживаемая часть TAM. SOM = меньшее из спроса и мощности. Числа пока неизвестны.';
const question='Сколько часов в неделю ты можешь выделять на привлечение и общение с клиентами?';
const options=[
  {id:'few_hours',label:'До 5 часов в неделю',description:'Небольшой объём работы с первыми обращениями.',recommended:false},
  {id:'regular',label:'5–15 часов в неделю',description:'Регулярная работа с сообществами и обращениями.',recommended:false},
  {id:'all_time',label:'Всё доступное время',description:'Учтём привлечение и сопровождение клиентов вместе.',recommended:false},
  {id:'undecided',label:'Пока не определился',description:'Поможем выбрать посильный объём теста.',recommended:false},
];

for(const colorScheme of ['light','dark'] as const) for(const width of [1280,390]) test(`market formulas stay partial and checked questions get answer buttons at ${width}px ${colorScheme}`,async({page},testInfo)=>{
  const project=createProject();project.activeModule='market';project.unlockedStages=['idea','audience','competitors','market'];
  project.modules.market.messages=[{id:'old-market-answer',role:'assistant',content:frame,createdAt:project.createdAt}];
  const oldCoverage:TopicCoverage={rubricVersion:1,moduleId:'market',nextCriterionId:'boundaries',items:TOPIC_CRITERIA.market.map(item=>({id:item.id,status:item.id==='calculation'?'covered':'partial',note:'Сохранённая прежняя оценка.',support:item.id==='calculation'?{role:'assistant',quote:'TAM = число покупателей × заказы за год × стоимость заказа.'}:null}))};
  project.modules.market.memory={updatedAt:project.updatedAt,content:{facts:[],hypotheses:[],openQuestions:[],coverage:oldCoverage}};
  project.modules.market.memory.coverageBasis=coverageBasis(project,'market');
  const calls:string[]=[],payloads:ChatRequest[]=[];let secondAnswer=false;
  const transport:ResponseTransport=async params=>{
    const name=params.text?.format?.type==='json_schema'?params.text.format.name:'search';calls.push(name);
    const candidate={message:secondAnswer?'Учёл выбранный ресурс времени. Численный расчёт рынка ещё предстоит выполнить.':`Канал известен, теперь нужен рабочий ресурс. **${question}**`,choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[]};
    const value=name==='cofounder_action'?{action:'answer',query:''}:name==='cofounder_evaluation'?{
      coverage:oldCoverage,process:{status:'needs_work',note:'Автору нужны конкретные варианты.',checks:PROCESS_CHECK_IDS.map(id=>({id,status:id==='questions'?'failed':'passed',reason:'Контролируемая проверка.'}))},result:{status:'in_progress',note:'Расчёт ещё не завершён.'},nextAction:secondAnswer?'Подготовить численный сценарий.':question,nextStep:secondAnswer?null:'ask_user',marketCalculation:null,nextQuestion:secondAnswer?null:{question,choices:options},
    }:candidate;
    return {status:'completed',error:null,output:[],output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:100}} as unknown as OpenAI.Responses.Response;
  };
  const config=loadConfig({OPENAI_API_KEY:'synthetic-placeholder',OPENAI_MODEL:'gpt-6.1-sol',AI_EVALUATOR_MODEL:'gpt-6.1-sol',AI_BUDGET_USD:'64',APP_ORIGIN:'http://127.0.0.1:3088'}),ledger=new BudgetLedger(':memory:',config);
  const app=createApp({config,ledger,provider:new OpenAIProvider(config,{transport})}),agent=supertest.agent(app);
  try {
    await page.route('**/api/status',async route=>{const response=await agent.get('/api/status');await route.fulfill({status:response.status,json:response.body});});
    await page.route('**/api/chat',async route=>{
      const payload=route.request().postDataJSON();payloads.push(payload);secondAnswer=payloads.length>1;
      const response=await agent.post('/api/chat').set('Origin',config.origin).send(payload);
      await route.fulfill({status:response.status,json:response.body});
    });
    await page.addInitScript(project=>{if(localStorage.getItem('cofounder.workspace.v1')===null)localStorage.setItem('cofounder.workspace.v1',JSON.stringify({version:1,activeProjectId:project.id,projects:[project]}));},project);
    await page.setViewportSize({width,height:width===1280?800:844});await page.emulateMedia({colorScheme});await page.goto('/');
    if(width<900)await page.getByRole('button',{name:'Открыть панель проекта',exact:true}).click();
    const calculation=page.locator('.ds-coverage-list li').filter({hasText:'Расчёт TAM / SAM / SOM'});
    await expect(calculation).toContainText('Частично');
    expect(payloads).toHaveLength(0);
    if(width<900)await page.getByRole('dialog',{name:'Панель проекта'}).getByRole('button',{name:'Закрыть',exact:true}).click();
    const input=page.getByRole('textbox',{name:'Сообщение',exact:true});await input.fill('Продолжим проработку.');await input.press('Enter');
    await expect(page.getByRole('button',{name:/^До 5 часов в неделю/})).toBeVisible();
    await expect(page.getByRole('button',{name:/^Пока не определился/})).toBeVisible();
    expect(calls).toEqual(['cofounder_action','cofounder_reply','cofounder_evaluation']);
    await page.screenshot({path:testInfo.outputPath('market-partial-with-answer-buttons.png'),fullPage:true});
    await input.fill('Могу написать собственный ответ');await expect(input).toHaveValue('Могу написать собственный ответ');
    await page.getByRole('button',{name:/^До 5 часов в неделю/}).click();
    await expect.poll(()=>payloads.length).toBe(2);
    expect(payloads[1].message).toBe('До 5 часов в неделю');
    await expect(page.getByText('Учёл выбранный ресурс времени. Численный расчёт рынка ещё предстоит выполнить.',{exact:true})).toBeVisible();
    await expect(input).toHaveValue('Могу написать собственный ответ');
    await page.reload();
    await expect(page.getByText('Учёл выбранный ресурс времени. Численный расчёт рынка ещё предстоит выполнить.',{exact:true})).toBeVisible();
    expect(payloads).toHaveLength(2);
  } finally {ledger.close();}
});
