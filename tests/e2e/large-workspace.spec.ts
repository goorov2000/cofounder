import { test, expect, type Page } from '@playwright/test';
import { largePendingWorkspace } from '../fixtures/large-workspace';
import { decodeStoredWorkspace, COMPRESSED_WORKSPACE_PREFIX } from '../../src/state/workspaceStorage';

const answer = 'Пример принял. Какой бюджет ты готов выделить на первый тест?';
async function prepare(page: Page) {
  const seed = largePendingWorkspace(), raw = JSON.stringify(seed.workspace), requests: unknown[] = [];
  expect(Buffer.byteLength(raw)).toBeLessThan(4_000_000);
  await page.route('**/api/status', route => route.fulfill({json:{configured:true,reason:'',model:'mock-only',searchEnabled:false}}));
  await page.route('**/api/chat', async route => {
    const payload = route.request().postDataJSON(); requests.push(payload);
    expect(payload).toEqual(seed.pending);
    await route.fulfill({json:{requestId:payload.requestId,model:'mock-only',reply:{message:answer,choices:[],artifactDraft:{title:'Полный материал',body:'Полный сохранённый материал. '.repeat(2100)},proposedFacts:[]}}});
  });
  await page.addInitScript(raw => {
    const key = 'cofounder.workspace.v1';
    if (localStorage.getItem(key) === null) localStorage.setItem(key, raw);
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key,value) {
      if (key==='cofounder.workspace.v1' && (window as any).rejectWorkspaceWrites) throw new DOMException('full','QuotaExceededError');
      return setItem.call(this,key,value);
    };
  }, raw);
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Повторить тот же запрос',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('cofounder.workspace.v1')?.startsWith('cofounder-gzip-v1:'))).toBe(true);
  expect(requests).toHaveLength(0);
  return { requests, seed };
}

for(const colorScheme of ['light','dark'] as const) for(const width of [1280,390]) test(`completed paid reply survives workspace growth above 4 MB at ${width}px ${colorScheme}`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:width===1280?720:844});await page.emulateMedia({colorScheme});
  const {requests,seed} = await prepare(page);
  await page.getByRole('button',{name:'Повторить тот же запрос',exact:true}).click();
  await expect(page.getByText(answer,{exact:true})).toBeVisible();
  await expect(page.locator('.storage-warning')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Повторить тот же запрос',exact:true})).toHaveCount(0);
  const stored = await page.evaluate(()=>localStorage.getItem('cofounder.workspace.v1')!);
  expect(stored.startsWith(COMPRESSED_WORKSPACE_PREFIX)).toBe(true);
  const decoded = decodeStoredWorkspace(stored);
  expect(Buffer.byteLength(decoded)).toBeGreaterThan(4_000_000);
  const project = JSON.parse(decoded).projects[0], last = project.modules.idea.messages.at(-1);
  expect(last.request).toEqual(seed.pending);expect(last.content).toBe(answer);
  expect(project.modules.idea.messages.at(-2).status).toBe('sent');
  await page.reload();await expect(page.getByText(answer,{exact:true})).toBeVisible();
  await expect(page.locator('.storage-warning')).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('large-workspace-answer.png'),fullPage:true});
});

test('a real storage write failure retains the completed answer and shows only one warning',async({page})=>{
  const {requests} = await prepare(page);
  await page.evaluate(()=>(window as any).rejectWorkspaceWrites=true);
  await page.getByRole('button',{name:'Повторить тот же запрос',exact:true}).click();
  await expect(page.getByText(answer,{exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(page.getByRole('alert')).toContainText('Текущая работа остаётся');
  await expect(page.getByRole('button',{name:'Повторить тот же запрос',exact:true})).toHaveCount(0);
  const downloadWait=page.waitForEvent('download');
  await page.getByRole('button',{name:'Скачать текущую работу',exact:true}).click();
  const download=await downloadWait, stream=await download.createReadStream(),chunks:Buffer[]=[];
  for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  const exported=JSON.parse(Buffer.concat(chunks).toString());
  expect(exported.projects[0].modules.idea.messages.at(-1).content).toBe(answer);
  expect(requests).toHaveLength(1);
});
