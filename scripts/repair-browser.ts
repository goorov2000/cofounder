/** Two fixed checker-supplied UI routes; uses the production API and original installation ledger. */
import {mkdirSync,writeFileSync,appendFileSync,existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import dotenv from 'dotenv';
import {chromium} from '@playwright/test';
import {createApp} from '../server/app';
import {loadConfig} from '../server/config';
import type {Workspace,Project} from '../shared/types';
import {createRecordedProvider} from './recorded-provider';

dotenv.config({quiet:true});
const arg=process.argv.indexOf('--out');
const out=path.resolve(arg<0?'.repair/2026-11-15/ui-final-01':process.argv[arg+1]);
const live=process.argv.includes('--live');
const base='http://localhost:3065';
const config={...loadConfig(),origin:base,production:true};
const routes={
 A:{seed:'Один основатель делает сервис согласования замен смен для небольших кафе в Казани. Вводные от двух управляющих: заявки на замену сейчас в Telegram, решения теряются; интервью не проводились. Пилот — одно кафе. Наша гипотеза цены 3900 рублей за точку в месяц. Покупатель пока неизвестен. MVP ориентир 3 недели, канал — личные знакомства.',
 correction:'Исправление: наша цена теперь 2900 рублей за точку в месяц, остаётся гипотезой. Пилот займёт 6 недель; ориентир MVP 3 недели сохраняем. Отказываюсь от сетевых ресторанов, выбираем небольшие кафе с 15–30 сотрудниками. Не называй управляющих подтверждёнными покупателями.'},
 B:{seed:'Я один мастер, предлагаю выездную настройку домашних Wi-Fi роутеров в одном районе Твери. Без приложения и без AI. Гипотеза цены 900 рублей за выезд, работа отдельно. Цель проверки — 3 заявки за выходные через районный чат. Заказов и интервью ещё нет.',
 correction:'Исправление: выезд теперь 700 рублей, диагностика включена; монтаж и оборудование оплачиваются отдельно. Цена остаётся гипотезой. Отказываюсь от офисов, первый сегмент — семьи с удалённой работой в одном районе Твери. Без приложения и без AI.'},
};
const plan={base,routes,maxHttpChains:13,phaseCapUsd:4,installationCapUsd:15,model:config.model,ledger:config.ledgerPath,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),promptHash:createHash('sha256').update(readFileSync('server/prompt.ts')).digest('hex'),corpusHash:createHash('sha256').update(readFileSync('server/knowledge/manifest.json')).digest('hex'),createdAt:new Date().toISOString()};
if(!live){console.log(JSON.stringify(plan,null,2));process.exit(0);}
if(config.budgetUsd!==15||config.model!=='gpt-6-luna'||config.ledgerPath!==path.resolve('.data/ai-ledger.sqlite'))throw new Error('Authorized model/cap/original ledger required');
if(existsSync(path.join(out,'execution.json')))throw new Error('Never overwrite a started run; use a new explicit directory');
mkdirSync(out,{recursive:true});
const log=(name:string,value:unknown)=>appendFileSync(path.join(out,`${name}.jsonl`),JSON.stringify(value)+'\n',{mode:0o600});
const db=new DatabaseSync(config.ledgerPath,{readOnly:true});
const totals=()=>db.prepare("SELECT COUNT(*) requests,COALESCE(SUM(charged),0)/1e9 chargedUsd,COALESCE(SUM(CASE WHEN state='pending' THEN reserved ELSE 0 END),0)/1e9 pendingUsd FROM requests").get() as {chargedUsd:number;pendingUsd:number};
const before=totals();writeFileSync(path.join(out,'execution.json'),JSON.stringify({...plan,before},null,2),{mode:0o600});
const app=createApp({config,provider:createRecordedProvider(config,log),admit(request,bound){const current=totals();log('admission',{requestId:request.requestId,bound,totals:current});if(current.chargedUsd-before.chargedUsd+current.pendingUsd+bound>4)throw new Error('UI phase admission exhausted');}});
const server=app.listen(3065,'127.0.0.1');await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??'/home/grisha/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'});
const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});const page=await context.newPage();page.setDefaultTimeout(12000);
const workspace=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('cofounder.workspace.v1')??'null')) as Promise<Workspace>;
const current=async()=>{const w=await workspace();return w.projects.find(p=>p.id===w.activeProjectId)!;};
let failures=0,requests=0;
async function ask(id:string,text:string){
 const before=await workspace(),input=page.getByRole('textbox',{name:'Сообщение',exact:true});
 await input.fill(text);const responseWait=page.waitForResponse(r=>r.url().endsWith('/api/chat'),{timeout:160000});await input.press('Enter');
 const earlyCleared=await input.inputValue()==='';await input.fill(`Следующая мысль ${id}`);
 const response=await responseWait,request=response.request().postDataJSON();requests++;
 let terminal=true;try{await page.waitForFunction((requestId:string)=>{const w=JSON.parse(localStorage.getItem('cofounder.workspace.v1')??'null');return w?.projects.some((p:any)=>Object.values(p.modules).some((m:any)=>m.messages.some((x:any)=>x.requestId===requestId&&(x.role==='assistant'||x.status==='failed'))));},request.requestId,{timeout:160000});}catch{terminal=false;}
 await page.waitForFunction(()=>!document.querySelector('button[aria-label="Прервать ожидание"]'),undefined,{timeout:15000}).catch(()=>{});
 const after=await workspace(),project=await current(),state=project.modules[project.activeModule];
 const answer=state.messages.find(m=>m.role==='assistant'&&m.requestId===request.requestId);
 const delivered=!!answer&&terminal,draftPreserved=await input.inputValue()===`Следующая мысль ${id}`;
 log('browser',{id,input:text,requestId:request.requestId,request,httpStatus:response.status(),earlyCleared,draftPreserved,terminal,delivered,alerts:await page.getByRole('alert').allTextContents(),before,after});
 writeFileSync(path.join(out,`${id}-reply.json`),JSON.stringify(answer?.reply??null,null,2),{mode:0o600});
 await page.screenshot({path:path.join(out,`${id}.png`),fullPage:true});await input.fill('');
 if(!delivered||!earlyCleared||!draftPreserved)failures++;
 console.log(JSON.stringify({id,delivered,httpStatus:response.status(),earlyCleared,draftPreserved}));
 return answer;
}
async function save(id:string,expectedRequestId:string|undefined){
 try{
  const project=await current(),state=project.modules[project.activeModule];
  if(!expectedRequestId||!state.proposal?.artifactDraft)throw new Error('Latest accepted answer has no draft; stale draft must not substitute');
  const latest=state.messages.findLast(m=>m.role==='assistant');if(latest?.requestId!==expectedRequestId||latest.reply?.artifactDraft?.body!==state.proposal.artifactDraft.body)throw new Error('Proposal is not the latest delivered draft');
  const expectedBody=state.proposal.artifactDraft.body;
  await page.getByRole('button',{name:'Посмотреть результат этапа',exact:true}).click();
  await page.getByRole('button',{name:'Проверить и исправить предложение',exact:true}).click();
  await page.getByRole('button',{name:'Сохранить итог',exact:true}).click();await page.keyboard.press('Escape');
  const after=await current(),artifact=after.modules[after.activeModule].artifact;
  if(artifact?.body!==expectedBody)throw new Error('Saved body differs from explicitly reviewed latest draft');
  log('saves',{id,status:'saved',expectedRequestId,artifact,state:await workspace()});
 }catch(error){failures++;log('saves',{id,status:'failed',error:String(error),state:await workspace()});await page.keyboard.press('Escape');}
}
async function stage(moduleId:string){const route=page.locator('.ds-project-route');if(await route.getAttribute('open')===null)await route.locator('summary').click();await page.locator(`[data-module=${moduleId}]`).click();}
async function sources(id:string){
 try{
  await page.getByRole('button',{name:'Ещё действия с ответом',exact:true}).last().click();await page.getByRole('menuitem',{name:'Посмотреть источники',exact:true}).click();
  const dialog=page.getByRole('dialog');const sourceLinks=dialog.locator('.workspace-answer-sources > section').filter({has:page.getByRole('heading',{name:'Внешние страницы',exact:true})}).getByRole('link');
  const links=await sourceLinks.evaluateAll(es=>es.map(e=>({url:(e as HTMLAnchorElement).href,text:e.textContent}))),opened=[];
  for(let index=0;index<Math.min(links.length,3);index++){
   const popupWait=page.waitForEvent('popup',{timeout:15000});await sourceLinks.nth(index).click();const popup=await popupWait;
   await popup.waitForLoadState('domcontentloaded',{timeout:25000}).catch(()=>{});
   opened.push({...links[index],openedUrl:popup.url(),text:(await popup.locator('body').innerText({timeout:10000}).catch(()=>'' )).slice(0,30000)});await popup.close();
  }
  log('source-ui',{id,links,opened,dialog:await dialog.innerText()});await page.screenshot({path:path.join(out,`${id}-sources.png`),fullPage:true});await page.keyboard.press('Escape');
 }catch(error){failures++;log('source-ui',{id,status:'failed',error:String(error)});await page.keyboard.press('Escape');}
}
try{
 await page.goto(base);await page.getByRole('textbox',{name:'Сообщение',exact:true}).waitFor();
 for(const name of ['A','B'] as const){
  if(name==='B'){await page.getByRole('button',{name:'Проекты',exact:true}).click();await page.getByRole('button',{name:'Новый проект',exact:true}).click();}
  const seed=routes[name];
  for(const moduleId of ['idea','audience','competitors'] as const){
   try{if(moduleId!=='idea')await stage(moduleId);}catch(error){failures++;log('blocked',{name,moduleId,error:String(error)});continue;}
   const task=moduleId==='idea'?seed.seed+' Не знаю, как описать проблему и ценность. Сам подготовь полезный сохраняемый черновик идеи из этих вводных.':moduleId==='audience'?'Аудиторию не знаю. Сам сравни конкретные сегменты по критериям, рекомендуй первый, укажи гипотезы пользователя и покупателя, предложи проверку. Подготовь сохраняемый черновик аудитории.':'Конкурентов не знаю. Сам найди и прочитай официальные первичные страницы хотя бы двух действующих альтернатив для нашего проекта и географии. Сравни задачу, предложение, тарифы с валютой/единицей/периодом/условиями или явное неизвестное. Подготовь сохраняемый черновик конкурентов, гипотезу отличия и ближайший шаг.';
   await ask(`${name}-${moduleId}-unknown`,task);
   const final=await ask(`${name}-${moduleId}-correction-refusal`,seed.correction+' Учти исправление и отказ. Подготовь актуальный сохраняемый черновик текущего этапа без выдуманных интервью и результатов. Чужие тарифы не меняй нашей ценой.');
   await save(`${name}-${moduleId}`,final?.requestId);
   if(moduleId==='audience'&&name==='A'){
    await ask('A-search-from-audience','Остаёмся на этапе аудитории. Сам найди и прочитай минимум две официальные альтернативы согласованию замен смен для кафе в Казани. Сравни по существенным критериям, действующим тарифам с точными условиями или явным неизвестным.');
    log('stage-after-research',{moduleId:(await current()).activeModule});await sources('A-audience');
   }
   if(moduleId==='competitors')await sources(`${name}-competitors`);
  }
  const beforeReload=await current();await page.reload();await page.getByRole('textbox',{name:'Сообщение',exact:true}).waitFor();const afterReload=await current();
  log('reload',{name,equal:JSON.stringify(beforeReload)===JSON.stringify(afterReload),before:beforeReload,after:afterReload});
 }
 const beforeExport=await workspace();await page.getByRole('button',{name:'Проекты',exact:true}).click();
 const downloadWait=page.waitForEvent('download');await page.getByRole('button',{name:'Экспорт всех проектов JSON',exact:true}).click();const download=await downloadWait;
 const backup=path.join(out,'ui-backup.json');await download.saveAs(backup);
 await page.getByRole('dialog').locator('input[type=file]').setInputFiles(backup);
 await page.waitForFunction(expected=>JSON.parse(localStorage.getItem('cofounder.workspace.v1')??'null')?.projects.length===expected,beforeExport.projects.length*2);
 const afterImport=await workspace();log('export-import',{before:beforeExport,after:afterImport,backup});await page.keyboard.press('Escape');
 writeFileSync(path.join(out,'workspace.json'),JSON.stringify(await workspace(),null,2),{mode:0o600});
 for(const theme of ['light','dark']){await page.evaluate(theme=>{localStorage.setItem('cofounder.theme.v1',theme);document.documentElement.dataset.theme=theme;},theme);await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,`mobile-${theme}.png`),fullPage:true});}
}finally{
 const after=totals();writeFileSync(path.join(out,'summary.json'),JSON.stringify({plan,before,after,chargedDeltaUsd:after.chargedUsd-before.chargedUsd,requests,failures,semanticStatus:'requires independent review'},null,2),{mode:0o600});
 console.log(JSON.stringify({out,requests,failures,chargedDeltaUsd:after.chargedUsd-before.chargedUsd}));await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));app.locals.close();db.close();
}
process.exitCode=failures?1:0;
