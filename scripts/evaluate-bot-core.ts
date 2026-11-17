/** Explicit evaluation runner. Never imported by the product or the default test suite. */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { chromium, type Page } from 'playwright';
import { createServer } from 'vite';
import { createApp } from '../server/app';
import { ServiceError } from '../server/errors';
import { loadConfig } from '../server/config';
import { OpenAIProvider, type Provider, type ResponseTransport } from '../server/provider';
import { createPublicReader, type ReadPage } from '../server/publicReader';
import { streamingMessage } from '../server/streamingMessage';
import { replySchema as serverReplySchema, requestSchema } from '../server/validation';
import { memoryOperationsSchema } from '../shared/coreValidation';
import { applyAnswer } from '../src/features/workspace/answerRequests';
import { assertRequestFits } from '../src/lib/api';
import { parseNavigation } from '../shared/domain';
import type { ChatRequest, ChatResponse, ExternalEvidence, Project } from '../shared/types';
import { conflictAcceptance, acceptanceFollowup, FIXTURE_VERSION, sourceCases, fixture, makeRequest, controlledPages, pagesForCase, tariffPreparationReady, d13PreparationReady, d13ReadSeed, d13Followup, d13StateSnapshot, injections, restaurantSeed, bicycleSeed } from '../tests/acceptance/fixtures';

const args=process.argv.slice(2);const option=(name:string,fallback:string)=>{const i=args.indexOf(`--${name}`);return i<0?fallback:args[i+1]??fallback;};
const mode=option('mode','deterministic');
if(!['deterministic','live_model','live_search','mock_tool','browser'].includes(mode))throw new Error('Unknown mode');
const chosen=option('ids','required').split(',');
const ids=chosen[0]==='required'?sourceCases.filter(row=>row.build===1).map(row=>row.source.id):chosen;
const out=path.resolve(option('out',`.autopilot/2026-11-15-bot-core--wip/evidence/t04-${mode}`));mkdirSync(out,{recursive:true});
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const log=(name:string,value:unknown)=>appendFileSync(path.join(out,`${name}.jsonl`),JSON.stringify(value)+'\n',{mode:0o600});
const meta={commit,fixtureVersion:FIXTURE_VERSION,fixtureHash:createHash('sha256').update(readFileSync('tests/acceptance/fixtures.ts')).digest('hex'),promptHash:createHash('sha256').update(readFileSync('server/prompt.ts')).digest('hex'),controlledPageLabel:args.includes('--neutral-pages')?'neutral':'explicitly_synthetic',corpusHash:createHash('sha256').update(readFileSync('server/knowledge/manifest.json')).digest('hex'),mode,createdAt:new Date().toISOString()};
const propertyRows=(id:string)=>{const row=id==='C10-conflict'?conflictAcceptance:sourceCases.find(row=>row.source.id===(id==='C03-own-price'?'D06':id));return [...(row?.expected??[]).map(property=>({kind:'expected',property,status:'not_run'})),...(row?.forbidden??[]).map(property=>({kind:'forbidden',property,status:'not_run'}))];};
if(mode==='deterministic'){
 for(const id of ids){const data=fixture(id);const parsed=requestSchema.safeParse(data.request);let limit:string|null=null;try{assertRequestFits(data.request);}catch(error){limit=error instanceof Error?error.message:'limit';}
  log('seeds',{...meta,id,build:data.row.build,status:data.row.build===2?'next_build':'not_run',setupStatus:parsed.success&&!limit?'ready':'failed',request:data.request,project:data.project,requestBytes:Buffer.byteLength(JSON.stringify(data.request)),navigation:parseNavigation(data.request.message),errors:parsed.success?[]:parsed.error.issues,limit,properties:propertyRows(id)});
  if(!parsed.success||limit)process.exitCode=1;
 }
 console.info(JSON.stringify({mode,cases:ids.length,required:29,nextBuild:17,artifact:out,semanticAcceptance:'not_run'}));
}else{
 if(mode!=='browser'&&ids.some(id=>['D13','K05','C10-conflict'].includes(id))&&(mode!=='mock_tool'||!args.includes('--neutral-pages')))throw new Error('D13/K05/C10 live evaluation requires --mode mock_tool --neutral-pages for actual same-session read setup; seeded evidence cannot substitute. Use scripts/repair-control.ts for all29.');
 if(!args.includes('--live'))throw new Error('No calls sent. Live model execution requires explicit --live, including mock_tool with a real final model.');
 dotenv.config({quiet:true});const config=loadConfig();
 if(!config.apiKey||config.budgetUsd<=0||config.budgetUsd>15||config.model!=='gpt-6-luna')throw new Error('Existing authorized gpt-6-luna setup with budget <=15 required. Nothing changed.');
 const totals=()=>{const db=new DatabaseSync(config.ledgerPath,{readOnly:true});try{return db.prepare("SELECT COUNT(*) requests, COALESCE(SUM(charged),0)/1000000000.0 chargedUsd, COALESCE(SUM(CASE WHEN state='pending' THEN reserved ELSE 0 END),0)/1000000000.0 pendingUsd FROM requests").get() as {requests:number;chargedUsd:number;pendingUsd:number};}finally{db.close();}};
 const before=totals(),maxSpend=Number(option('max-spend','0.75'));if(!Number.isFinite(maxSpend)||maxSpend<=0||maxSpend>15)throw new Error('max-spend must be >0 and <=15');
 let activeId='',activeRequest:ChatRequest|undefined;const raw=new Map<string,Record<string,unknown>>();
 const client=new OpenAI({apiKey:config.apiKey,maxRetries:0,logLevel:'off',timeout:config.timeoutMs});
 const transport:ResponseTransport=async(params,signal,onText)=>{
  const name=params.text?.format?.type==='json_schema'?params.text.format.name:params.tools?'search':'unknown';
  if(mode==='mock_tool'&&params.tools){
   if(activeId==='D08')throw Object.assign(new Error('Controlled tool unavailability'),{status:400});
   const pages=pagesForCase(activeId);
   log('tool-fixtures',{...meta,id:activeId,requestId:activeRequest?.requestId,pages,injection:activeId.startsWith('C11')?injections[Number(activeId.at(-1))-1]:activeId==='D23'?injections[0]:null});
   return {status:'completed',output_text:'Controlled source catalogue, not a live web search.',usage:{input_tokens:0,output_tokens:0,total_tokens:0},output:[{type:'message',content:[{type:'output_text',text:'Sources',annotations:pages.map(page=>({type:'url_citation',url:page.url,title:page.title,start_index:0,end_index:1}))}]}]} as unknown as OpenAI.Responses.Response;
  }
  let response:OpenAI.Responses.Response|undefined;
  if(onText){let json='',preview='';const stream=await client.responses.create({...params,stream:true},{signal});for await(const event of stream){
   if(event.type==='response.output_text.delta'){json+=event.delta;const next=streamingMessage(json);if(next.startsWith(preview)){onText(next.slice(preview.length));preview=next;}}
   else if(event.type==='response.completed'||event.type==='response.incomplete'||event.type==='response.failed')response={...event.response,output_text:event.response.output.flatMap(item=>item.type==='message'?item.content.flatMap(part=>part.type==='output_text'?[part.text]:[]):[]).join('')};
  }if(!response)throw new Error('Diagnostic stream ended without completion');}
  else response=await client.responses.create({...params,stream:false},{signal});
  log('model-output',{...meta,id:activeId,requestId:activeRequest?.requestId,step:name,status:response.status,incompleteDetails:response.incomplete_details,providerErrorCode:response.error?.code,usage:response.usage,outputText:response.output_text,output:response.output.filter(item=>item.type!=='reasoning')});
  if(name==='cofounder_reply'&&activeRequest){try{raw.set(activeRequest.requestId,JSON.parse(response.output_text));}catch{}}
  return response;
 };
 const publicReader=createPublicReader();
 const reader=async(url:string,signal:AbortSignal):Promise<ReadPage>=>{
  if(mode!=='mock_tool')return publicReader(url,signal);
  const page=Object.values(controlledPages).find(item=>item.url===url);if(!page)throw new Error('Unknown controlled URL');
  const injection=activeId.startsWith('C11')?injections[Number(activeId.at(-1))-1]:activeId==='D23'?injections[0]:'';
  const text=page.text+(injection?'\n'+injection:'');return {...page,text,contentHash:createHash('sha256').update(text).digest('hex'),limitations:args.includes('--neutral-pages')?[]:['Синтетическая страница контрольного испытания; не реальный тариф.']};
 };
 const delegate=new OpenAIProvider(config,{transport,reader});
 const provider:Provider={async complete(request,signal,onText,execution){activeRequest=request;const evidence:ExternalEvidence[]=[];const start=Date.now();
  try{return await delegate.complete(request,signal,onText,{...execution,onOperation(event){execution?.onOperation?.(event);log('operations',{...meta,id:activeId,requestId:request.requestId,event});if(event.metadata?.evidence)evidence.push(event.metadata.evidence as ExternalEvidence);}});}
  catch(error){
   const decoded=structuredClone(raw.get(request.requestId)??{});const rawBytes=Buffer.byteLength(JSON.stringify(decoded));
   if(Array.isArray(decoded.proposedFacts))decoded.proposedFacts=decoded.proposedFacts.map(item=>Object.fromEntries(Object.entries(item as object).filter(([key,value])=>!(['sourceUrl','checkedAt'].includes(key)&&value===null))));
   const operations=memoryOperationsSchema.safeParse(decoded.memoryOperations??[]);delete decoded.memoryOperations;
   if(request.coreContext)decoded.memoryPatch={schemaVersion:1,projectId:request.projectId,moduleId:request.moduleId,generation:request.coreContext.generation,requestId:request.requestId,baseMemoryVersion:request.coreContext.revision,baseContextVersion:request.coreContext.contextVersion,sourceMessage:request.coreContext.sourceMessage,operations:operations.success?operations.data:[]};
   if(evidence.length){decoded.externalSources=evidence;decoded.research={status:'partial',limitations:[]};}
   const parsed=serverReplySchema.safeParse(decoded);
   log('failures',{...meta,id:activeId,requestId:request.requestId,errorCode:(error as {code?:string}).code??'UNKNOWN',elapsedMs:Date.now()-start,rawBytes,envelopeLowerBoundBytes:Buffer.byteLength(JSON.stringify(decoded)),evidenceBytes:Buffer.byteLength(JSON.stringify(evidence)),schemaIssues:parsed.success?[]:parsed.error.issues,memoryOperationIssues:operations.success?[]:operations.error.issues,request,raw:raw.get(request.requestId),evidence});throw error;
  }
 }};
 const apiPort=Number(option('api-port','3021')),uiPort=Number(option('ui-port','3020'));const origin=`http://localhost:${mode==='browser'?uiPort:apiPort}`;
 const chainCap=Number(option('chain-cap','Infinity'));
 const admit=(request:ChatRequest,bound:number)=>{if(bound>chainCap)throw new ServiceError('EVALUATION_LIMIT','Per-chain bound exceeds fixed plan cap',409,false,true);if(totals().chargedUsd-before.chargedUsd+totals().pendingUsd+bound>maxSpend){log('stops',{...meta,id:activeId,requestId:request.requestId,status:'stopped',reason:'EVALUATION_LIMIT',beforePaidCall:true,bound,maxSpend,totals:totals()});throw new ServiceError('EVALUATION_LIMIT','Evaluation additional-spend bound reached before reservation',409,false,true);}};
 const app=createApp({provider,config:{origin},admit});const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const instance=app.listen(apiPort,'127.0.0.1',()=>resolve(instance));});
 let vite:Awaited<ReturnType<typeof createServer>>|undefined;
 try{
  if(mode==='browser'){
   vite=await createServer({configFile:false,server:{host:'127.0.0.1',port:uiPort,strictPort:true,watch:{ignored:['**/.autopilot/**']},proxy:{'/api':`http://127.0.0.1:${apiPort}`}}});await vite.listen();
   await browserRoutes(origin);
  }else{
   const status=await fetch(`${origin}/api/status`,{headers:{Origin:origin}});const cookie=status.headers.get('set-cookie')?.split(';')[0];if(!cookie)throw new Error('Session missing');
   let stopped=false;
   for(const id of ids){if(stopped){log('results',{...meta,id,status:'not_run',reason:'EVALUATION_LIMIT',properties:propertyRows(id)});continue;}const isInjection=/^C11-[123]$/.test(id);const baseId=isInjection?'D23':id==='C10-conflict'?'D26':id==='C03-own-price'?'D06':id;const count=['D06','D13','C03-own-price'].includes(id)?3:1;
    for(let iteration=1;iteration<=count;iteration++){
     activeId=id;let setup:{row:{build:number;source:{id:string;input:string}};project:Project;request:ChatRequest}|undefined=id==='D13'?undefined:fixture(['C03-own-price','C10-conflict'].includes(id)?id:baseId);const row=setup?.row??sourceCases.find(item=>item.source.id===baseId)!;if(row.build===2){log('results',{...meta,id,status:'next_build'});continue;}
     if(id==='D13'&&mode==='mock_tool'&&args.includes('--neutral-pages')){
      // Replace the deterministic read fixture with actual server read + trusted
      // operation provenance under this same HTTP session before the correction.
      const seed=d13ReadSeed();
      activeId='D13-prepare';
      const lead=makeRequest(seed,'competitors','Найди и прочитай первичные тарифы сервисов графиков смен. Сохрани один прочитанный тариф в атомарной памяти отдельно от нашей цены: external_entity,origin=external; epistemic=observed либо unknown по достаточности основания,acceptance=proposed, точный external evidenceId/version/quoteId. Нашу цену и расчёт не меняй.');
      const prep=await fetch(`${origin}/api/chat`,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(lead.request)});const prepBody=await prep.json();
      let prepared:Project|undefined;
      if(prep.ok)prepared=applyAnswer(lead.project,lead.request,(prepBody as ChatResponse).reply);
      const ready=Boolean(prepared&&d13PreparationReady(prepared,seed,lead.request.requestId));
      log('preparation',{...meta,id:activeId,iteration,request:lead.request,httpStatus:prep.status,response:prepBody,status:ready?'not_run':'failed',serverReadReady:ready,stateAfter:prepared});
      if(prepBody.error?.code==='EVALUATION_LIMIT'){log('results',{...meta,id,iteration,status:'stopped',reason:'EVALUATION_LIMIT',properties:propertyRows(id)});stopped=true;process.exitCode=1;break;}
      if(!ready){log('results',{...meta,id,iteration,status:'failed',reason:'Server read external basis preparation failed',properties:propertyRows(id)});process.exitCode=1;continue;}
      const follow=makeRequest(prepared!,'business',row.source.input);setup={row,...follow};activeId=id;
     }
     if(!setup)throw new Error('Missing actual-read preparation for correction');
     let historicalBasis:Project|undefined;
     if(id==='K05'&&mode==='mock_tool'&&args.includes('--neutral-pages')){
      activeId='K05-prepare';const lead=makeRequest(setup.project,'competitors','Найди первичные страницы тарифов сервисов графиков смен. Прочитай тарифы и сохрани точные источники и условия оплаты.');
      const prep=await fetch(`${origin}/api/chat`,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(lead.request)});const prepBody=await prep.json();
      log('preparation',{...meta,id:'K05-prepare',iteration,request:lead.request,httpStatus:prep.status,response:prepBody,status:prep.ok&&tariffPreparationReady(prepBody.reply)?'not_run':'failed',tariffRead:tariffPreparationReady(prepBody.reply)});
      if(prepBody.error?.code==='EVALUATION_LIMIT'){log('results',{...meta,id,iteration,status:'stopped',reason:'EVALUATION_LIMIT',properties:propertyRows(id)});stopped=true;process.exitCode=1;break;}
      if(!prep.ok||!tariffPreparationReady(prepBody.reply)){log('results',{...meta,id,iteration,status:'failed',reason:'Controlled reading preparation failed',properties:propertyRows(id)});process.exitCode=1;continue;}
      const prepared=applyAnswer(lead.project,lead.request,(prepBody as ChatResponse).reply);historicalBasis=prepared;const follow=makeRequest(prepared,'competitors',setup.request.message);setup.project=follow.project;setup.request=follow.request;activeId=id;
     }
     const request=setup.request; if(isInjection)request.message='Найди и сравни актуальные тарифы сервисов графиков смен.';
     // A changed input must also have an exact matching source in coreContext.
     if(isInjection){const rebound=makeRequest(setup.project,request.moduleId,request.message);setup.project=rebound.project;Object.assign(request,rebound.request);}
     const start=Date.now(),previous=totals();
     const response=await fetch(`${origin}/api/chat`,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(request)});const body=await response.json();
     if(body.error?.code==='EVALUATION_LIMIT'){log('results',{...meta,id,iteration,status:'stopped',reason:'EVALUATION_LIMIT',request,httpStatus:response.status,response:body,properties:propertyRows(id==='C10-conflict'?id:baseId)});stopped=true;process.exitCode=1;break;}
     let applied:Project|undefined,applyError:string|null=null,nextRequestBytes:number|null=null,nextContextFits:boolean|null=null;
     if(response.ok){try{applied=applyAnswer(setup.project,request,(body as ChatResponse).reply);const next=makeRequest(applied,request.moduleId,'Что из наших решений действует сейчас?');nextRequestBytes=Buffer.byteLength(JSON.stringify(next.request));try{assertRequestFits(next.request);nextContextFits=true;}catch{nextContextFits=false;}}catch(error){applyError=(error as Error).message;}}
     log('results',{...meta,id,iteration,model:config.model,modelLive:true,toolLive:mode!=='mock_tool',request,httpStatus:response.status,response:body,elapsedMs:Date.now()-start,before:previous,after:totals(),transportStatus:response.ok?'passed':'failed',status:response.ok?'not_run':'failed',reviewer:'independent review required',properties:propertyRows(id==='C10-conflict'?id:baseId),stateBefore:setup.project,stateAfter:applied,applyError,nextRequestBytes,nextContextFits});
     if(['K01','D15','D16'].includes(id)){
      activeId=`${id}-followup`;
      if(!applied){log('followups',{...meta,id:activeId,parentId:id,iteration,status:'not_run',reason:'Main answer not applied; no continuation call sent'});}
      else{
       const follow=acceptanceFollowup(id,applied),requestBytes=Buffer.byteLength(JSON.stringify(follow.request));
       let contextError:string|null=null;try{assertRequestFits(follow.request);}catch(error){contextError=(error as Error).message;}
       if(contextError){log('followups',{...meta,id:activeId,parentId:id,iteration,status:'not_run',reason:'CONTEXT_LIMIT',contextError,requestBytes,nextContextFits:false,stateBefore:follow.project});process.exitCode=1;}
       else{
        const later=await fetch(`${origin}/api/chat`,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(follow.request)});const laterBody=await later.json();
        let laterAfter:Project|undefined,laterApplyError:string|null=null;
        if(later.ok){try{laterAfter=applyAnswer(follow.project,follow.request,(laterBody as ChatResponse).reply);}catch(error){laterApplyError=(error as Error).message;}}
        log('followups',{...meta,id:activeId,parentId:id,iteration,request:follow.request,requestBytes,nextContextFits:true,httpStatus:later.status,response:laterBody,stateBefore:follow.project,stateAfter:laterAfter,applyError:laterApplyError,status:later.ok&&!laterApplyError?'not_run':'failed',properties:propertyRows(id),checkerInputProvenance:id==='K01'?'Fixed synthetic checker supplied user episode; not real user biography':undefined});
        if(!later.ok||laterApplyError)process.exitCode=1;
        if(laterBody.error?.code==='EVALUATION_LIMIT')stopped=true;
       }
      }
      activeId=id;
     }
     if(id==='D13'&&applied){
      activeId='D13-followup';
      const follow=d13Followup(applied),requestBytes=Buffer.byteLength(JSON.stringify(follow.request));
      let contextError:string|null=null;try{assertRequestFits(follow.request);}catch(error){contextError=(error as Error).message;}
      if(contextError){log('followups',{...meta,id:activeId,parentId:'D13',iteration,status:'not_run',reason:'CONTEXT_LIMIT',contextError,requestBytes,nextContextFits:false,stateBefore:follow.project});process.exitCode=1;activeId=id;continue;}
      const later=await fetch(`${origin}/api/chat`,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(follow.request)});const laterBody=await later.json();
      let laterAfter:Project|undefined,laterApplyError:string|null=null;
      if(later.ok){try{laterAfter=applyAnswer(follow.project,follow.request,(laterBody as ChatResponse).reply);}catch(error){laterApplyError=(error as Error).message;}}
      log('followups',{...meta,id:activeId,parentId:'D13',iteration,request:follow.request,requestBytes,nextContextFits:true,httpStatus:later.status,response:laterBody,stateBefore:follow.project,stateAfter:laterAfter,applyError:laterApplyError,snapshotBefore:d13StateSnapshot(applied),snapshotAfter:laterAfter?d13StateSnapshot(laterAfter):null,status:later.ok&&!laterApplyError?'not_run':'failed',properties:propertyRows('D13'),additionalProperty:'Subsequent real answer recalls current own price3500 independently of external tariff; maintains versions and stale dependencies.'});
      if(!later.ok||laterApplyError)process.exitCode=1;
      if(laterBody.error?.code==='EVALUATION_LIMIT')stopped=true;
      activeId=id;
     }else if(id==='D13')log('followups',{...meta,id:'D13-followup',parentId:'D13',iteration,status:'not_run',reason:'Correction not applied; no post-correction call sent'});
     if(id==='K05'&&mode==='mock_tool'&&args.includes('--neutral-pages')&&historicalBasis){
      activeId='K05-history';
      const follow=makeRequest(applied??historicalBasis!,'competitors','Вернись к найденному ранее тарифу: какой конкретно фрагмент мы прочитали, когда, какая единица, период и условие предоплаты? Сохрани историческое основание и отдельно неизвестную дату вступления, если она не была установлена. Не называй публичный тариф фактическим средним платежом и не сравнивай его напрямую с нашей ценой за точку.');
      const history=await fetch(`${origin}/api/chat`,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(follow.request)});const historyBody=await history.json();
      const historyAfter=history.ok?applyAnswer(follow.project,follow.request,(historyBody as ChatResponse).reply):undefined;
      log('followups',{...meta,id:activeId,parentId:'K05',iteration,request:follow.request,httpStatus:history.status,response:historyBody,stateBefore:follow.project,stateAfter:historyAfter,status:history.ok?'not_run':'failed',properties:propertyRows('K05')});
      if(!history.ok)process.exitCode=1;
      if(historyBody.error?.code==='EVALUATION_LIMIT')stopped=true;
      activeId=id;
     }
     console.info(`${id} #${iteration}: HTTP${response.status}${applyError?' apply failed':''}${nextContextFits===false?' next context blocked':''}`);
     if(!response.ok)process.exitCode=1;
     if(totals().chargedUsd-before.chargedUsd>=maxSpend){stopped=true;break;}
     await new Promise(resolve=>setTimeout(resolve,5100));
    }
   }
  }
 }finally{await vite?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));app.locals.close();const after=totals();writeFileSync(path.join(out,'summary.json'),JSON.stringify({...meta,model:config.model,before,after,chargedDeltaUsd:after.chargedUsd-before.chargedUsd,maxSpend,acceptance:'requires independent property review'},null,2),{mode:0o600});console.info(JSON.stringify({artifact:out,chargedDeltaUsd:after.chargedUsd-before.chargedUsd}));}

 async function browserRoutes(base:string){
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??'/home/grisha/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'});
  const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();page.setDefaultTimeout(10000);
  page.on('response',async response=>{if(response.url().endsWith('/api/chat')){try{log('http-browser',{...meta,id:activeId,status:response.status(),request:response.request().postDataJSON(),body:await response.text()});}catch{}}});
  const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('cofounder.workspace.v1')??'null'));
  async function ask(label:string,text:string){activeId=label;const start=Date.now();const beforeState=await state();const input=page.getByRole('textbox',{name:'Сообщение',exact:true});await input.fill(text);const responseWait=page.waitForResponse(response=>response.url().endsWith('/api/chat'),{timeout:130000});await input.press('Enter');const response=await responseWait;await input.waitFor({state:'visible'});
   await page.waitForFunction(()=>{const button=document.querySelector('button[aria-label="Прервать ожидание"]');return !button;},{},{timeout:130000});
   // Wait for the persisted completion/error rather than treating an empty spinner as success.
   await page.waitForFunction((requestId:string)=>{const raw=localStorage.getItem('cofounder.workspace.v1');if(!raw)return false;const w=JSON.parse(raw),p=w.projects.find((p:any)=>p.id===w.activeProjectId);return p.modules[p.activeModule].messages.some((m:any)=>m.requestId===requestId&&(m.role==='assistant'||m.status==='failed'));},response.request().postDataJSON().requestId,{timeout:130000});
   const afterState=await state();const p=afterState.projects.find((p:any)=>p.id===afterState.activeProjectId);const last=p.modules[p.activeModule].messages.at(-1);const success=last?.role==='assistant'&&last?.status!=='failed';
   log('browser',{...meta,id:label,input:text,elapsedMs:Date.now()-start,before:beforeState,after:afterState,transportStatus:success?'passed':'failed',status:success?'not_run':'failed',alerts:await page.getByRole('alert').allTextContents()});await page.screenshot({path:path.join(out,`${label}.png`),fullPage:true});
   if(response.status()===409&&JSON.stringify(afterState).includes('EVALUATION_LIMIT'))throw new ServiceError('EVALUATION_LIMIT','Browser evaluation stopped before spending',409,false,true);
   if(!success)throw new Error(`Browser route stopped at ${label}; no automatic retry`);
  }
  async function save(){await page.getByRole('button',{name:'Посмотреть результат этапа',exact:true}).click();await page.getByRole('button',{name:'Проверить и исправить предложение',exact:true}).click();await page.getByRole('button',{name:'Сохранить итог',exact:true}).click();await page.keyboard.press('Escape');}
  async function stage(id:string){const route=page.locator('.ds-project-route');if(await route.getAttribute('open')===null)await route.locator('summary').click();await page.locator(`[data-module=${id}]`).click();}
  try{await page.goto(base);for(const [projectName,seed] of [['restaurant',restaurantSeed],['bicycle',bicycleSeed]] as const){
    if(projectName==='bicycle'){await page.getByRole('button',{name:'Проекты',exact:true}).click();await page.getByRole('button',{name:'Новый проект',exact:true}).click();}
    try{
     await ask(`${projectName}-idea`,seed+' Подготовь сохраняемый черновик идеи, без новых выдуманных фактов.');await save();
     await stage('audience');await ask(`${projectName}-audience-unknown`,'Аудиторию не знаю. Предложи различимые сегменты, критерии и первый сегмент с основаниями; подготовь сохраняемый черновик.');
     await ask(`${projectName}-audience-rejection`,projectName==='restaurant'?'Отказываюсь от сетей: для первого пилота выбираю одно независимое кафе. Не приписывай IT-директору право финальной покупки. Обнови сохраняемый черновик аудитории.':'Отказываюсь от спортивных команд: первый сегмент — занятые владельцы обычных городских велосипедов в моём районе. Обнови сохраняемый черновик аудитории.');await save();
     await ask(`${projectName}-correction`,projectName==='restaurant'?'Меняем нашу гипотезу цены на 2900 рублей за точку в месяц; цена остаётся гипотезой.':'Меняем гипотезу стоимости выезда на 500 рублей; детали и работа по-прежнему отдельно.');
     await stage('competitors');await ask(`${projectName}-competitors`,'Сам найди действующие альтернативы и их публичные тарифы. Прочитай первичные страницы, сравни минимум две альтернативы с основаниями и условиями или явным неизвестным. Подготовь сохраняемый черновик конкурентов.');await save();
     await page.getByRole('button',{name:'Ещё действия с ответом',exact:true}).last().click();await page.getByRole('menuitem',{name:'Посмотреть источники',exact:true}).click();await page.screenshot({path:path.join(out,`${projectName}-sources.png`),fullPage:true});await page.keyboard.press('Escape');
     if(projectName==='restaurant'){await stage('audience');await ask('restaurant-search-from-audience','Мы остаёмся в аудитории. Проверь актуальные официальные страницы двух альтернатив для выбранного первого сегмента; нужны источники, тарифы с условиями либо неизвестное.');}
    }catch(error){await page.keyboard.press('Escape');if(error instanceof ServiceError&&error.code==='EVALUATION_LIMIT'){log('results',{...meta,id:activeId,status:'stopped',reason:'EVALUATION_LIMIT'});if(projectName==='restaurant')log('results',{...meta,id:'bicycle-route',status:'not_run',reason:'EVALUATION_LIMIT'});process.exitCode=1;break;}log('browser-route-failures',{...meta,project:projectName,message:(error as Error).message,state:await state()});process.exitCode=1;}
   }
   writeFileSync(path.join(out,'browser-workspace.json'),JSON.stringify(await state(),null,2),{mode:0o600});
  }finally{await context.close();await browser.close();}
 }
}
