/** Fixed affected research routes. Preparations are actual reads in the same browser session. */
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import dotenv from 'dotenv';
import {chromium} from '@playwright/test';
import {createApp} from '../server/app';
import {loadConfig} from '../server/config';
import {ServiceError} from '../server/errors';
import {createRecordedProvider} from './recorded-provider';
import type {Workspace} from '../shared/types';

const option=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const out=path.resolve(option('--out')??'.repair/2026-11-15/research-chains-01');
type Row={id:string;input:string;before:Workspace};
const rows=(run:string)=>readFileSync(`.repair/2026-11-15/${run}/browser.jsonl`,'utf8').trim().split('\n').map(line=>JSON.parse(line) as Row);
const old=rows('ui-final-02'),current=rows('ui-final-03');
const find=(items:Row[],id:string)=>{const row=items.find(x=>x.id===id);if(!row)throw Error(`Missing fixed input ${id}`);return row;};
const cases=[
 {seed:find(old,'A-search-from-audience'),follow:undefined},
 {seed:find(old,'A-competitors-unknown'),follow:find(current,'A-competitors-correction-refusal')},
 {seed:find(current,'B-competitors-unknown'),follow:undefined},
];
for(const {seed}of cases){const project=seed.before.projects.find(p=>p.id===seed.before.activeProjectId);if(!project||project.core?.evidence.length)throw Error('A historical read must be prepared, never seeded as trusted');}
dotenv.config({quiet:true});const origin='http://localhost:3066',config={...loadConfig(),origin,production:true};
const plan={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),promptHash:createHash('sha256').update(readFileSync('server/prompt.ts')).digest('hex'),routes:cases.map(c=>({id:c.seed.id,input:c.seed.input,follow:c.follow&&{id:c.follow.id,input:c.follow.input}})),maxHttpChains:4,maxPaidChildren:20,upperAdditionalUsd:2,model:config.model,maxOutputTokens:config.maxOutputTokens,installationCapUsd:15,ledger:config.ledgerPath,policy:'Each fixed route once; actual server reads, normal provider and original ledger. Correction only after its delivered preparation; failures retained. No trusted evidence seeds.'};
if(!process.argv.includes('--live')){console.log(JSON.stringify(plan,null,2));process.exit(0);}
const sourcePaths=['server','shared','src','scripts','tests','package.json','package-lock.json','tsconfig.json','tsconfig.server.json','vite.config.ts'];
function assertFrozenSource(){
 if(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==plan.commit)throw Error('Source commit changed during a fixed run');
 if(execFileSync('git',['status','--porcelain','--',...sourcePaths],{encoding:'utf8'}).trim())throw Error('Commit all application and harness changes before a paid fixed run');
}
assertFrozenSource();
if(config.ledgerPath!==path.resolve('.data/ai-ledger.sqlite')||config.model!=='gpt-6-luna'||config.budgetUsd!==15)throw Error('Original authorized model, ledger and total cap required');
if(existsSync(path.join(out,'execution.json')))throw Error('Never overwrite a started run');
mkdirSync(out,{recursive:true});const log=(name:string,value:unknown)=>appendFileSync(path.join(out,`${name}.jsonl`),JSON.stringify(value)+'\n',{mode:0o600});
const db=new DatabaseSync(config.ledgerPath,{readOnly:true});
const totals=()=>db.prepare("SELECT COUNT(*) requests,COALESCE(SUM(charged),0)/1e9 chargedUsd,COALESCE(SUM(CASE WHEN state='pending' THEN reserved ELSE 0 END),0)/1e9 pendingUsd FROM requests").get() as {requests:number;chargedUsd:number;pendingUsd:number};
const before=totals();writeFileSync(path.join(out,'execution.json'),JSON.stringify({...plan,before},null,2),{mode:0o600});
const app=createApp({config,provider:createRecordedProvider(config,log),admit(request,bound){assertFrozenSource();const now=totals();if(now.chargedUsd-before.chargedUsd+now.pendingUsd+bound>plan.upperAdditionalUsd)throw new ServiceError('EVALUATION_LIMIT','Fixed affected phase exhausted before payment',409,false,true);log('admission',{requestId:request.requestId,bound,totals:now});}});
const server=app.listen(3066,'127.0.0.1');await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??'/home/grisha/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'});
let sent=0,failed=0,notRun=0;
const outcomes=cases.flatMap(({seed,follow})=>[seed,...(follow?[follow]:[])].map(row=>({id:row.id,status:'not_run' as 'not_run'|'sent'|'delivered'|'failed',requestId:null as string|null,reason:'Fixed route has not started'})));
try{
 for(const {seed,follow}of cases){
  const context=await browser.newContext(),page=await context.newPage();
  try{
   await page.goto(origin);await page.getByRole('textbox',{name:'Сообщение',exact:true}).waitFor();
   await page.evaluate(workspace=>localStorage.setItem('cofounder.workspace.v1',JSON.stringify(workspace)),seed.before);await page.reload();
   let prepared=false;
   for(const [index,row]of [seed,...(follow?[follow]:[])].entries()){
    const outcome=outcomes.find(x=>x.id===row.id)!;
    if(index>0&&!prepared){outcome.reason='Actual preparation did not deliver; no seeded read substituted';log('results',{id:row.id,status:'not_run',reason:outcome.reason});continue;}
    const input=page.getByRole('textbox',{name:'Сообщение',exact:true});await input.fill(row.input);
    const waiting=page.waitForResponse(r=>r.url().endsWith('/api/chat'),{timeout:160000});
    void waiting.catch(()=>{});
    const sending=page.waitForRequest(r=>r.url().endsWith('/api/chat'),{timeout:15000});void sending.catch(()=>{});await input.press('Enter');
    const dispatched=await sending,request=dispatched.postDataJSON() as {requestId:string};sent++;outcome.status='sent';outcome.requestId=request.requestId;outcome.reason='HTTP dispatched; terminal outcome pending';
    log('requests',{id:row.id,request});
    const response=await waiting;
    await page.waitForFunction(requestId=>{const w=JSON.parse(localStorage.getItem('cofounder.workspace.v1')??'null') as Workspace|null;return w?.projects.some(p=>Object.values(p.modules).some(m=>m.messages.some(x=>x.requestId===requestId&&(x.role==='assistant'||x.status==='failed'))));},request.requestId,{timeout:160000});
    await page.waitForFunction(()=>!document.querySelector('button[aria-label="Прервать ожидание"]'),undefined,{timeout:15000});
    const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('cofounder.workspace.v1')??'null') as Workspace);
    const project=after.projects.find(p=>p.id===after.activeProjectId)!;
    const answer=Object.values(project.modules).flatMap(m=>m.messages).find(m=>m.role==='assistant'&&m.requestId===request.requestId);
    const preparationReadIds=(answer?.reply?.externalSources??[]).filter(s=>s.retrieval==='read'&&s.requestId===request.requestId&&s.projectId===project.id).map(s=>s.id);
    prepared=!!answer&&preparationReadIds.length>0;if(!answer)failed++;outcome.status=answer?'delivered':'failed';outcome.reason=answer?'Accepted assistant reply recorded':'No accepted assistant reply';
    log('results',{id:row.id,request,httpStatus:response.status(),delivered:!!answer,preparationReadIds,reply:answer?.reply??null,alerts:await page.getByRole('alert').allTextContents(),after});
    await page.screenshot({path:path.join(out,`${row.id}.png`),fullPage:true});
    console.log(JSON.stringify({id:row.id,httpStatus:response.status(),delivered:!!answer}));
   }
  }catch(error){failed++;log('results',{id:seed.id,status:'runner_failed',error:String(error)});}
  finally{await context.close();}
 }
}finally{
 notRun=outcomes.filter(x=>x.status==='not_run').length;
 writeFileSync(path.join(out,'summary.json'),JSON.stringify({plan,before,after:totals(),sent,failed,notRun,outcomes,semanticStatus:'requires independent review'},null,2),{mode:0o600});
 await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));app.locals.close();db.close();
}
process.exitCode=failed||notRun?1:0;
