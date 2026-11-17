/** Fixed control plan; dry by default. Every paid call remains behind the application ledger. */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import dotenv from 'dotenv';
import { loadConfig } from '../server/config';
import { estimateMaxCost } from '../server/provider';
import { fixture, sourceCases } from '../tests/acceptance/fixtures';
const live=process.argv.includes('--live');
const outArg=process.argv.indexOf('--out');
const out=path.resolve(outArg<0?'.repair/2026-11-15/control':process.argv[outArg+1]);
if(live&&existsSync(path.join(out,'execution.json')))throw new Error('This fixed run already started; use a new explicit output directory, never overwrite failures.');
dotenv.config({quiet:true});const config=loadConfig();
const controlled=['D08','D13','D23','D26','K05'];
const batches=[{mode:'live_model',ids:sourceCases.filter(r=>r.build===1&&!controlled.includes(r.source.id)).map(r=>r.source.id),chains:29},
 {mode:'mock_tool',ids:[...controlled,'C03-own-price','C11-1','C11-2','C11-3','C10-conflict'],chains:22}];
// 39 main +3D13preparations+3D13nextturns+K05preparation/history+K01/D15/D16nextturns=51chains including1additional C10-conflict observation.
const chains=batches.flatMap(batch=>batch.ids.flatMap(id=>Array.from({length:['D06','D13','C03-own-price'].includes(id)?3:1},(_,i)=>{
 const iteration=i+1;const main={mode:batch.mode,id,iteration,step:'main',status:'not_run'};
 return id==='D13'?[{...main,step:'actual-read-preparation'},main,{...main,step:'post-correction-followup'}]:id==='K05'?[{...main,step:'actual-read-preparation'},main,{...main,step:'historical-followup'}]:['K01','D15','D16'].includes(id)?[main,{...main,step:'semantic-followup'}]:[main];
}).flat()));
if(chains.length!==51)throw new Error('Fixed control chain count drift');
const upperUsd=4;
const estimates=batches.flatMap(batch=>batch.ids.map(id=>({id,bound:estimateMaxCost(fixture(id.startsWith('C11')?'D23':id).request,{...config,apiKey:'planning-only',budgetUsd:15})})));
const db=new DatabaseSync(config.ledgerPath,{readOnly:true});
const totals=db.prepare("SELECT COUNT(*) requests, COALESCE(SUM(charged),0)/1e9 chargedUsd, COALESCE(SUM(CASE WHEN state='pending' THEN reserved ELSE 0 END),0)/1e9 pendingUsd FROM requests").get() as {chargedUsd:number;pendingUsd:number};db.close();
const plan={version:5,observations:40,originalSourceCases:46,currentOriginalCases:29,existingMainObservations:39,additionalConflictObservations:1,maxHttpChains:51,maxPaidChildren:255,upperUsd,chains,seedEstimates:estimates,admissionPolicy:'charged delta + all pending + next actual provider maximum <=4; no promise all51 fit',batches,model:config.model,ledger:config.ledgerPath,installationCapUsd:15,totals,semanticStatus:'not_run',controlledSources:'real server reads of injected neutral pages; not live internet observations'};
mkdirSync(out,{recursive:true});writeFileSync(path.join(out,'plan.json'),JSON.stringify(plan,null,2),{mode:0o600});
console.info(JSON.stringify(plan,null,2));
if(!live)process.exit(0);
if(config.model!=='gpt-6-luna'||config.budgetUsd!==15||config.ledgerPath!==path.resolve('.data/ai-ledger.sqlite'))throw new Error('Authorized model, total cap15 and original ledger required');
if(totals.chargedUsd+totals.pendingUsd+Math.max(...estimates.map(e=>e.bound))>15)throw new Error('Next chain does not fit remaining shared budget');
writeFileSync(path.join(out,'execution.json'),JSON.stringify({startedAt:new Date().toISOString(),plan}),{mode:0o600});
let failed=false;
for(const [i,batch] of batches.entries()){
 const currentDb=new DatabaseSync(config.ledgerPath,{readOnly:true});
 const charged=Number(currentDb.prepare('SELECT COALESCE(SUM(charged),0)/1e9 value FROM requests').get()?.value);currentDb.close();
 const remaining=upperUsd-(charged-totals.chargedUsd);if(remaining<=0){failed=true;break;}
 const result=spawnSync(process.execPath,['--import','tsx','scripts/evaluate-bot-core.ts','--live','--mode',batch.mode,'--neutral-pages','--ids',batch.ids.join(','),'--max-spend',String(remaining),'--api-port',String(3071+i),'--out',path.join(out,batch.mode)],{stdio:'inherit',env:process.env});
 const readRows=(name:string)=>{const file=path.join(out,batch.mode,`${name}.jsonl`);return existsSync(file)?readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line) as Record<string,unknown>):[];};
 const observed:Array<Record<string,unknown> & {planStep:string;planId:unknown}>=[...readRows('preparation').map(row=>({...row,planStep:'actual-read-preparation',planId:String(row.id).replace('-prepare','')})),...readRows('results').map(row=>({...row,planStep:'main',planId:row.id})),...readRows('followups').map(row=>({...row,planStep:row.parentId==='D13'?'post-correction-followup':row.parentId==='K05'?'historical-followup':'semantic-followup',planId:row.parentId}))];
 const outcomes=chains.filter(chain=>chain.mode===batch.mode).map(chain=>{const row=observed.find(row=>row.planId===chain.id&&row.planStep===chain.step&&row.iteration===chain.iteration);return {...chain,executionStatus:row?.request?'sent':'not_run',observation:row??null};});
 writeFileSync(path.join(out,`${batch.mode}-outcomes.json`),JSON.stringify({exitCode:result.status,signal:result.signal,error:result.error?.message,outcomes},null,2),{mode:0o600});
 if(result.status!==0)failed=true;
}
process.exitCode=failed?1:0;
