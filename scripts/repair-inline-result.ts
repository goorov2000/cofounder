/** Fixed synthetic UI reproduction: a draft must not substitute for requested chat content. */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import dotenv from 'dotenv';
import { chromium } from '@playwright/test';
import { createApp } from '../server/app';
import { loadConfig } from '../server/config';
import { ServiceError } from '../server/errors';
import type { ChatRequest, Workspace } from '../shared/types';
import { createRecordedProvider } from './recorded-provider';

const at = process.argv.indexOf('--out');
const out = path.resolve(at < 0 ? '.repair/2026-11-15/inline-result-01' : process.argv[at + 1]);
const base = 'http://localhost:3068';
const inputs = [
  { id: 'idea', text: 'Учебный выдуманный проект: небольшая мастерская делает столы на заказ для домашних рабочих мест. Хочу помочь людям обустроить маленькую квартиру; заказов и интервью ещё нет. Помоги сформулировать идею и сам подготовь полезный черновик.' },
  { id: 'show-in-chat', text: 'Обещанного текста в чате я не вижу. Что за карточка? Покажи её целиком прямо в этом сообщении, чтобы мне не пришлось искать и открывать отдельный результат.' },
];
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const plan = { commit, base, inputs, maxHttpChains: 2, maxPaidChildren: 10, phaseCapUsd: 1, installationCapUsd: 15, semanticStatus: 'not_run', policy: 'Each input once. Real browser and normal provider through the original installation ledger. Only synthetic content; no user conversation copied.' };
if (!process.argv.includes('--live')) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }
dotenv.config({ quiet: true });
const config = { ...loadConfig(), origin: base, production: true };
if (config.budgetUsd !== 15 || config.model !== 'gpt-6-luna' || config.ledgerPath !== path.resolve('.data/ai-ledger.sqlite')) throw Error('Original authorized model, ledger and total cap required');
function frozen() {
  if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== commit || execFileSync('git', ['status', '--porcelain', '--', 'server', 'shared', 'src', 'scripts', 'tests', 'package.json', 'package-lock.json'], { encoding: 'utf8' }).trim()) throw Error('Application and harness source must stay committed and frozen');
}
frozen();
if (existsSync(path.join(out, 'execution.json'))) throw Error('Never overwrite a started fixed run');
mkdirSync(out, { recursive: true });
const log = (name: string, value: unknown) => appendFileSync(path.join(out, `${name}.jsonl`), JSON.stringify(value) + '\n', { mode: 0o600 });
const db = new DatabaseSync(config.ledgerPath, { readOnly: true });
const totals = () => db.prepare("SELECT COUNT(*) requests,COALESCE(SUM(charged),0)/1e9 chargedUsd,COALESCE(SUM(CASE WHEN state='pending' THEN reserved ELSE 0 END),0)/1e9 pendingUsd FROM requests").get() as { requests: number; chargedUsd: number; pendingUsd: number };
const before = totals();
writeFileSync(path.join(out, 'execution.json'), JSON.stringify({ ...plan, model: config.model, ledger: config.ledgerPath, before }, null, 2), { mode: 0o600 });
const app = createApp({ config, provider: createRecordedProvider(config, log), admit(_request, bound) {
  frozen(); const current = totals();
  if (current.chargedUsd - before.chargedUsd + current.pendingUsd + bound > 1) throw new ServiceError('EVALUATION_LIMIT', 'Fixed UI phase exhausted before payment', 409, false, true);
} });
const server = app.listen(3068, '127.0.0.1');
await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/home/grisha/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' });
const context = await browser.newContext(); const page = await context.newPage();
const outcomes = inputs.map(input => ({ id: input.id, requestId: null as string | null, status: 'not_run', reason: 'Fixed route has not reached this step' }));
let failures = 0;
try {
  await page.goto(base); const input = page.getByRole('textbox', { name: 'Сообщение', exact: true }); await input.waitFor();
  for (const [index, item] of inputs.entries()) {
    const outcome = outcomes[index];
    try {
      const beforeWorkspace = await page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1') ?? 'null') as Workspace);
      const beforeProject = beforeWorkspace.projects.find(p => p.id === beforeWorkspace.activeProjectId)!;
      const previousDraft = beforeProject.modules.idea.proposal?.artifactDraft ?? null;
      await input.fill(item.text);
      const sent = page.waitForRequest(r => r.url().endsWith('/api/chat'), { timeout: 15000 }); void sent.catch(() => {});
      const answered = page.waitForResponse(r => r.url().endsWith('/api/chat'), { timeout: 160000 }); void answered.catch(() => {});
      await input.press('Enter'); const request = (await sent).postDataJSON() as ChatRequest;
      outcome.requestId = request.requestId; outcome.status = 'sent'; outcome.reason = 'HTTP dispatched'; log('requests', { id: item.id, request });
      const response = await answered;
      await page.waitForFunction(requestId => {
        const workspace = JSON.parse(localStorage.getItem('cofounder.workspace.v1') ?? 'null') as Workspace | null;
        return workspace?.projects.some(p => Object.values(p.modules).some(m => m.messages.some(x => x.requestId === requestId && (x.role === 'assistant' || x.status === 'failed'))));
      }, request.requestId, { timeout: 160000 });
      const workspace = await page.evaluate(() => JSON.parse(localStorage.getItem('cofounder.workspace.v1') ?? 'null') as Workspace);
      const project = workspace.projects.find(p => p.id === workspace.activeProjectId)!;
      const answer = Object.values(project.modules).flatMap(m => m.messages).find(m => m.role === 'assistant' && m.requestId === request.requestId);
      const visibleMessages = await page.locator('.workspace-message.assistant:not(.is-streaming)').allInnerTexts();
      const copyChecks = index === 1 ? {
        previousDraftAvailable: !!previousDraft,
        fullDraftInRequest: !!previousDraft && request.context.currentDraft?.title === previousDraft.title && request.context.currentDraft?.body === previousDraft.body,
        fullDraftInMessage: !!previousDraft && !!answer?.reply?.message.includes(previousDraft.body),
        fullDraftStillAvailableToSave: !!previousDraft && answer?.reply?.artifactDraft?.body === previousDraft.body,
      } : null;
      outcome.status = answer ? 'delivered' : 'failed'; outcome.reason = answer ? 'Accepted answer and actual visible text recorded; semantic review pending' : 'No accepted assistant reply';
      if (!answer) failures++;
      if (copyChecks && Object.values(copyChecks).some(value => !value)) failures++;
      log('results', { id: item.id, request, previousDraft, copyChecks, httpStatus: response.status(), delivered: !!answer, reply: answer?.reply, visibleMessages, workspace });
      await page.screenshot({ path: path.join(out, `${item.id}.png`), fullPage: true });
      console.log(JSON.stringify({ id: item.id, httpStatus: response.status(), delivered: !!answer }));
    } catch (error) { failures++; outcome.reason = String(error); log('runner-errors', { id: item.id, error: String(error) }); }
  }
} finally {
  writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ plan, before, after: totals(), failures, outcomes, semanticStatus: 'requires independent review' }, null, 2), { mode: 0o600 });
  await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); app.locals.close(); db.close();
}
process.exitCode = failures || outcomes.some(x => x.status !== 'delivered') ? 1 : 0;
