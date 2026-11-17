/** Fixed forensic replay of the two UI02 research failures, through the ordinary UI and ledger. */
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import dotenv from 'dotenv';
import {chromium} from '@playwright/test';
import {createApp} from '../server/app';
import {loadConfig} from '../server/config';
import {ServiceError} from '../server/errors';
import {createRecordedProvider} from './recorded-provider';

const option=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const main=path.resolve(option('--main')??'.'),out=path.resolve(option('--out')??'.repair/2026-11-15/forensic-ui02');
const ids=['A-search-from-audience','A-competitors-unknown'];
const original=readFileSync(path.join(main,'.repair/2026-11-15/ui-final-02/browser.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
const cases=ids.map(id=>{const row=original.find(row=>row.id===id);if(!row)throw new Error('Missing fixed UI failure');const project=row.before.projects.find((p:any)=>p.id===row.before.activeProjectId);if(project.core?.evidence.length)throw new Error('Historical read requires an actual preparation, not forensic seed trust');return row;});
dotenv.config({path:path.join(main,'.env'),quiet:true});
const origin='http://localhost:3066',config={...loadConfig(),origin,production:true};
const plan={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),ids,maxHttpChains:2,maxPaidChildren:10,upperAdditionalUsd:1.5,model:config.model,ledger:config.ledgerPath,baselineSource:main,policy:'one independent replay per fixed failure, original pre-turn UI state, no trusted read seeds; normal ledger/provider'};
if(!process.argv.includes('--live')){console.log(JSON.stringify(plan));process.exit(0);}
if(config.ledgerPath!==path.join(main,'.data/ai-ledger.sqlite')||config.model!=='gpt-6-luna'||config.budgetUsd!==15)throw new Error('Original authorized model, ledger and cap required');
if(existsSync(path.join(out,'execution.json')))throw new Error('Never overwrite a started replay');
mkdirSync(out,{recursive:true});const log=(name:string,value:unknown)=>appendFileSync(path.join(out,`${name}.jsonl`),JSON.stringify(value)+'\n',{mode:0o600});
const db=new DatabaseSync(config.ledgerPath,{readOnly:true});
const totals=()=>db.prepare("SELECT COUNT(*) requests,COALESCE(SUM(charged),0)/1e9 chargedUsd,COALESCE(SUM(CASE WHEN state='pending' THEN reserved ELSE 0 END),0)/1e9 pendingUsd FROM requests").get() as {chargedUsd:number;pendingUsd:number};
const before=totals();writeFileSync(path.join(out,'execution.json'),JSON.stringify({...plan,before},null,2),{mode:0o600});
const app=createApp({config,provider:createRecordedProvider(config,log),admit(request,bound){const current=totals();if(current.chargedUsd-before.chargedUsd+current.pendingUsd+bound>plan.upperAdditionalUsd)throw new ServiceError('EVALUATION_LIMIT','Fixed forensic phase exhausted before payment',409,false,true);log('admission',{requestId:request.requestId,bound,totals:current});}});
const server=app.listen(3066,'127.0.0.1');await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??'/home/grisha/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'});
try{
 for(const row of cases){
  const context=await browser.newContext(),page=await context.newPage();
  try{
   await page.goto(origin);await page.getByRole('textbox',{name:'Сообщение',exact:true}).waitFor();
   await page.evaluate(workspace=>localStorage.setItem('cofounder.workspace.v1',JSON.stringify(workspace)),row.before);await page.reload();
   const input=page.getByRole('textbox',{name:'Сообщение',exact:true});await input.fill(row.input);
   const waiting=page.waitForResponse(r=>r.url().endsWith('/api/chat'),{timeout:160000});await input.press('Enter');
   const response=await waiting,request=response.request().postDataJSON();
   await page.waitForFunction(requestId=>{const w=JSON.parse(localStorage.getItem('cofounder.workspace.v1')??'null');return w?.projects.some((p:any)=>Object.values(p.modules).some((m:any)=>m.messages.some((x:any)=>x.requestId===requestId&&(x.role==='assistant'||x.status==='failed'))));},request.requestId,{timeout:160000});
   log('results',{id:row.id,originalRequestId:row.requestId,request,httpStatus:response.status(),alerts:await page.getByRole('alert').allTextContents(),after:await page.evaluate(()=>JSON.parse(localStorage.getItem('cofounder.workspace.v1')??'null'))});
  }catch(error){log('results',{id:row.id,status:'runner_failed',error:String(error)});process.exitCode=1;}
  finally{await context.close();}
 }
}finally{writeFileSync(path.join(out,'summary.json'),JSON.stringify({plan,before,after:totals(),semanticStatus:'requires independent review'},null,2),{mode:0o600});await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));app.locals.close();db.close();}
