import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import {createApp} from '../server/app';
import {loadConfig} from '../server/config';
import {OpenAIProvider,type ResponseTransport} from '../server/provider';
import {extractPage,createPublicReader} from '../server/publicReader';
import {ServiceError} from '../server/errors';
import {createProject} from '../shared/domain';
import {ensureCore} from '../shared/coreMemory';
import {makeRequest} from '../tests/acceptance/fixtures';
import type {ExternalEvidence} from '../shared/types';

dotenv.config({quiet:true});
const sourceRequest='529e81f9-eec5-46ef-b03f-6d412e50e997';
const allCases=[{id:'luna-4096',model:'gpt-6-luna',tokens:4096},{id:'luna-6144',model:'gpt-6-luna',tokens:6144},{id:'sol-6144',model:'gpt-6.1-sol',tokens:6144}];
const filter=process.argv.find(arg=>arg.startsWith('--case='))?.slice(7);
const liveSearch=process.argv.includes('--live-search');
const cases=filter?allCases.filter(c=>c.id===filter):allCases;if(!cases.length)throw Error('Unknown benchmark case');
const origin='http://localhost:3058',base=loadConfig(),db=new DatabaseSync(base.ledgerPath,{readOnly:true});
const totals=()=>db.prepare("SELECT COALESCE(SUM(CASE WHEN state='pending' THEN reserved ELSE charged END),0)/1e9 AS usd FROM requests").get()!.usd as number;
const rows=db.prepare("SELECT metadata FROM operations WHERE request_id=? AND kind='read' AND state='completed' ORDER BY started").all(sourceRequest);
const pages=new Map<string,ExternalEvidence>();
for(const row of rows){const e=JSON.parse(String(row.metadata)).evidence as ExternalEvidence;pages.set(e.url,e);}
const selected=[...pages.values()].sort((a,b)=>{
 const rank=(url:string)=>url.includes('14007711')?0:url.includes('4153311')?1:url.includes('7241787')?2:url.includes('10496052')?3:url.includes('standuply')?4:url.includes('pricing/pro')?5:6;
 return rank(a.url)-rank(b.url);
});
if(selected.length<6)throw Error('Original source capture unavailable');
const signature=()=>createHash('sha256').update(['server/provider.ts','server/researchCollector.ts','server/prompt.ts','server/config.ts','server/evaluator.ts'].map(file=>fs.readFileSync(file)).join('\n')).digest('hex');
const frozen=signature(),before=totals(),out=path.resolve('.repair/2026-11-16-efficient',randomUUID());
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'plan.json'),JSON.stringify({cases,sourceRequest,sourceMode:liveSearch?'Actual hosted search, public HTTP reads, generation and independent judge':'Frozen exact excerpts from original server reads; hosted search is controlled and unbilled; generation, source checks and judge are live',signature:frozen,before,installationCap:base.budgetUsd,additionalCap:0.6},null,2));
console.log(JSON.stringify({artifact:out,cases,before,remaining:base.budgetUsd-before}));
if(!process.argv.includes('--execute')){db.close();process.exit(0);}
if(base.budgetUsd!==15||!base.apiKey)throw Error('Expected existing authorized installation');
const results:unknown[]=[];
for(const candidate of cases){
 const config={...loadConfig({...process.env,OPENAI_MODEL:candidate.model,AI_INPUT_USD_PER_MILLION:'',AI_OUTPUT_USD_PER_MILLION:'',AI_MAX_OUTPUT_TOKENS:String(candidate.tokens),AI_EVALUATOR_MODEL:'gpt-6.1-sol'}),origin};
 const client=new OpenAI({apiKey:config.apiKey,maxRetries:0,timeout:config.timeoutMs,logLevel:'off'});
 let batch=0,checkNumber=0;
 const transport:ResponseTransport=async (params,signal)=>{
  if(!liveSearch&&params.tools?.some(tool=>tool.type==='web_search')){
   const sources=selected.slice(batch*6,++batch*6);
   return {status:'completed',error:null,output_text:'',output:[{type:'message',content:[{type:'output_text',text:'',annotations:sources.map(e=>({type:'url_citation',url:e.url,title:e.title,start_index:0,end_index:0}))}]}],usage:{input_tokens:0,output_tokens:0}} as unknown as OpenAI.Responses.Response;
  }
  const response=await client.responses.create({...params,stream:false},{signal});
  const name=params.text?.format?.type==='json_schema'?params.text.format.name:'response';
  if(name==='cofounder_research_check')fs.writeFileSync(path.join(out,`${candidate.id}-check-${++checkNumber}.json`),JSON.stringify({status:response.status,raw:response.output_text,usage:response.usage},null,2));
  return response;
 };
 const delegate=new OpenAIProvider(config,{transport,reader:liveSearch?createPublicReader():async url=>{
  const e=pages.get(url);if(!e)throw Error('Unknown frozen page');
  const escaped=e.quotes.map(q=>q.text).join('\n').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const page=extractPage(`<title>${e.title}</title><p>${escaped}</p>`,url);
  return {...page,limitations:[...e.limitations,'Контрольный снимок цитат исходного чтения16.11.2026; повторный HTTP сайта не выполнялся.']};
 }});
 const app=createApp({config,provider:{complete(request,signal,onText,execution){return delegate.complete(request,signal,onText,{...execution,onOperation(event){
  if(signature()!==frozen)throw new ServiceError('EVALUATION_LIMIT','Sources changed during benchmark',409,false,true);
  if(event.state==='started'&&totals()-before+(event.reservedUsd ?? 0)>0.6)throw new ServiceError('EVALUATION_LIMIT','Additional benchmark cap reached',409,false,true);
  execution?.onOperation?.(event);
 }});}}});
 const server=app.listen(3058,'127.0.0.1');await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 const started=Date.now(),spent=totals();
 try{
  const status=await fetch(origin+'/api/status'),cookie=status.headers.get('set-cookie')!.split(';')[0];
  const project=ensureCore(createProject());project.name='Проверка конкурентов: маркетолог и внешний дизайнер';
  project.description='Сервис запрашивает у внешнего дизайнера статус и сроки и доставляет маркетологу результат, новую дату либо явное отсутствие ответа. Формат бизнеса пока не выбран.';
  const seed=makeRequest(project,'competitors','Найди и сравни прямые, косвенные и ручные альтернативы по одной задаче: к контрольному времени маркетолог получает результат, предложенную новую дату либо статус не получен, без своего напоминания. Сохрани фокус на статусах и сроках, не на правках. Нужны таблица одинаковых критериев, ссылки, даты и существенные условия тарифов, осторожная гипотеза отличия и ближайшая проверка. Неизвестные свойства честно оставь неизвестными; полного доказательства уникальности сейчас не требуется.');
  const response=await fetch(origin+'/api/chat',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(seed.request)});
  const body=await response.json(),elapsedMs=Date.now()-started;
  const operations=db.prepare('SELECT operation_id,kind,state,metadata,charged FROM operations WHERE request_id=? ORDER BY started').all(seed.request.requestId);
  const result={id:candidate.id,model:candidate.model,tokens:candidate.tokens,status:response.status,elapsedMs,costUsd:totals()-spent,requestId:seed.request.requestId,review:body.reply?.memory?.review,coverage:body.reply?.memory?.coverage,error:body.error,generations:operations.filter(o=>o.kind==='generate').length,searches:operations.filter(o=>o.kind==='search').length,usage:operations.filter(o=>o.kind!=='read').map(o=>({id:o.operation_id,kind:o.kind,state:o.state,model:JSON.parse(String(o.metadata)).model,usage:JSON.parse(String(o.metadata)).usage,costUsd:Number(o.charged)/1e9}))};
  fs.writeFileSync(path.join(out,candidate.id+'.json'),JSON.stringify({result,body},null,2));results.push(result);
  console.log(JSON.stringify({id:result.id,status:result.status,elapsedSec:Math.round(elapsedMs/1000),costUsd:result.costUsd,generations:result.generations,searches:result.searches,review:result.review?.result,coverage:result.coverage?.items.map((i:any)=>[i.id,i.status]),error:result.error}));
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));app.locals.close();}
}
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({before,after:totals(),results},null,2));db.close();
