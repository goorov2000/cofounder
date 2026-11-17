/** Explicit paid validation only; never imported by application/tests. No SDK or env secrets. */
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ChatRequest, ChatResponse, Fact, StageId } from '../shared/types.js';

if (!process.argv.includes('--run-paid')) {
  console.info('No requests sent. Explicit run: npx tsx scripts/live-check.ts --run-paid');
  process.exit(0);
}
const followupFile = process.argv.find(value => value.startsWith('--r21-from='))?.slice('--r21-from='.length);
if (followupFile && !/^run-[a-f0-9-]+\.json$/.test(followupFile)) throw new Error('Invalid evidence filename.');
const origin = process.env.LIVE_ORIGIN || 'http://localhost:3110';
if (!/^http:\/\/localhost:3110$/.test(origin)) throw new Error('Validation only targets the dedicated local API on3110.');
const evidence = path.resolve('.autopilot/2026-11-14-cofounder--wip/evidence/t07');
mkdirSync(evidence, { recursive: true });
const ledgerPath = path.resolve(process.env.DATA_DIR || '.data', 'ai-ledger.sqlite');
function totals() {
  const db = new DatabaseSync(ledgerPath, { readOnly: true });
  try {
    return db.prepare(`SELECT COUNT(*) requests, SUM(state='completed') completed,
      COALESCE(SUM(charged),0)/1000000000.0 chargedUsd,
      COALESCE(SUM(CASE WHEN state='pending' THEN reserved ELSE 0 END),0)/1000000000.0 pendingReservedUsd,
      COALESCE(SUM(reserved),0)/1000000000.0 historicalReservedUsd FROM requests`).get();
  } finally { db.close(); }
}
const before = totals();
const statusResponse = await fetch(`${origin}/api/status`, { headers: { Origin: origin } });
const status = await statusResponse.json() as {configured:boolean;model:string};
if (!status.configured) throw new Error('AI is not configured; no paid request sent.');
const cookie = statusResponse.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error('Session unavailable; no paid request sent.');
const stages: StageId[] = ['idea','audience','competitors','market','business','economics','team','roadmap','mvp'];
const runId = randomUUID();
const results: {moduleId:StageId; project:string; requestId:string; httpStatus:number; response:unknown; elapsedMs:number}[] = [];
const fact = (key:string,value:string):Fact => ({key,value,provenance:'user',note:'Синтетическое решение тестового основателя, не реальный проект.'});
const projects = [
  {id:`live_a_${runId}`,name:'Синтетический тест: Тихая мастерская', description:'Сервис учёта сроков ремонта для независимых мастеров музыкальных инструментов в Казани.', facts:[fact('channel','SEO — выбранный канал, платную рекламу не принимаю.'),fact('team','Один основатель (solo founder), сотрудников нет.'),fact('deadline','MVP за 6 недель.'),fact('payer','Платит мастер, клиент только смотрит статус.'),fact('price','Условная гипотеза: 900 рублей в месяц за мастера.')], artifacts:[] as ChatRequest['context']['artifacts'], history:[] as ChatRequest['context']['history']},
  {id:`live_b_${runId}`,name:'Синтетический тест: Семенной круг', description:'Обмен семенами между жителями одного многоквартирного дома, без доставки и продажи.', facts:[fact('location','Один дом в Перми; бесплатный обмен; покупателя пока нет.')],artifacts:[] as ChatRequest['context']['artifacts'],history:[] as ChatRequest['context']['history']},
];
async function ask(project:typeof projects[number],moduleId:StageId,intent:ChatRequest['intent'],message:string) {
  const request:ChatRequest = {requestId:`live_${randomUUID()}`,projectId:project.id,moduleId,intent,message,context:{name:project.name,description:project.description,facts:project.facts,artifacts:project.artifacts,history:project.history.slice(-8)}};
  const start=Date.now();
  const response=await fetch(`${origin}/api/chat`,{method:'POST',headers:{Origin:origin,Cookie:cookie!,'Content-Type':'application/json'},body:JSON.stringify(request)});
  const body=await response.json();
  results.push({moduleId,project:project.name,requestId:request.requestId,httpStatus:response.status,response:body,elapsedMs:Date.now()-start});
  writeFileSync(path.join(evidence,`run-${runId}.json`),JSON.stringify({runId,model:status.model,before,after:totals(),results},null,2),{mode:0o600});
  console.info(`${results.length}/${followupFile ? 1 : 12} ${moduleId}: HTTP ${response.status}`);
  if (!response.ok) throw new Error(`Stopped on API error: ${body.error?.code || response.status}; no automatic retry.`);
  const output=body as ChatResponse;
  if (output.model!==status.model || !output.reply?.message || (intent==='draft'&&!output.reply.artifactDraft)) throw new Error('Stopped on response contract mismatch.');
  project.history.push({role:'user',content:message},{role:'assistant',content:output.reply.message});
  if (output.reply.artifactDraft) project.artifacts.push({moduleId,...output.reply.artifactDraft,stale:false});
}
let failed=false;
try {
  if (followupFile) {
    const prior = JSON.parse(readFileSync(path.join(evidence,followupFile),'utf8')) as {results: typeof results};
    if (prior.results.length !== 12 || prior.results.some(result=>result.httpStatus!==200)) throw new Error('R21 requires a completed main run.');
    for (const result of prior.results.filter(result=>result.project===projects[0].name)) {
      const draft=(result.response as ChatResponse).reply.artifactDraft;
      if (draft) projects[0].artifacts.push({moduleId:result.moduleId,...draft,stale:true});
    }
    projects[0].facts = projects[0].facts.map(value=>value.key==='price' ? {...value,value:'Новая согласованная условная гипотеза: 1200 рублей в месяц за мастера; прежние 900 отменены.'} : value);
    await ask(projects[0],'economics','draft','Цена изменена: теперь 1200 рублей в месяц за мастера. Все прежние итоги явно устарели и переданы stale=true. Подготовь обновлённую экономику, не используй 900 как действующую цену; сохрани SEO, solo founder, роли и 6 недель. Расходы и удержание неизвестны.');
  } else {
  await ask(projects[0],'idea','message','Не знаю, как сформулировать ценность. Предложи один понятный пример как гипотезу и возможность пропустить.');
  for (const stage of stages) await ask(projects[0],stage,'draft','Подготовь полный итог текущего этапа. Сохрани принятые SEO, solo founder, роли и 6 недель. Исследований и интервью нет; не придумывай источники. Численность рынка, расходы и удержание неизвестны. Все новые предположения пометь гипотезами.');
  await ask(projects[1],'idea','draft','Сформулируй идею бесплатного обмена семенами в одном доме. Это другая синтетическая идея. Исследований нет.');
  await ask(projects[1],'audience','draft','Не знаю, кто будет пользоваться. Предложи гипотезу сегмента, способ проверки и возможность отказаться. Не переноси решения первого проекта.');
  }
} catch (error) { failed=true; console.error(error instanceof Error ? error.message : 'Validation stopped.'); }
finally { console.info(JSON.stringify({runId,model:status.model,requests:results.length,before,after:totals(),failed})); }
if (failed) process.exitCode=1;
