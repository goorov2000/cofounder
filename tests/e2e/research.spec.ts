import { test, expect } from '@playwright/test';

for (const colorScheme of ['light','dark'] as const) for(const width of [1280,390]) {
 test(`read failures stay in sources while research progress and drafts persist at ${width}px ${colorScheme}`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:width===1280?720:844});await page.emulateMedia({colorScheme});
  await page.route('**/api/status',route=>route.fulfill({json:{configured:true,reason:'',model:'mock-only',searchEnabled:true}}));
  await page.addInitScript(()=>{
   const original=window.fetch.bind(window);
   window.fetch=async(url,options)=>{
    if(url!=='/api/chat')return original(url,options);
    const request=JSON.parse(options!.body as string); const encoder=new TextEncoder();
    return new Response(new ReadableStream({start(controller){
     (window as any).research={request,emit(event:object){controller.enqueue(encoder.encode(`data: ${JSON.stringify({requestId:request.requestId,...event})}\n\n`));}};
    }}),{headers:{'Content-Type':'text/event-stream'}});
   };
  });
  await page.goto('/design-system');await expect(page.getByRole('heading',{level:1,name:'Ваше пространство. Ваши цвета.'})).toBeVisible();await page.goto('/');
  const input=page.getByRole('textbox',{name:'Сообщение',exact:true});await input.fill('Найди альтернативы и тарифы');await input.press('Enter');await expect(input).toHaveValue('');
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).research))).toBe(true);
  await page.evaluate(()=>(window as any).research.emit({type:'progress',progress:{phase:'reading',message:'Читаю источники: 1 из 2…'}}));
  await expect(page.getByRole('status').filter({hasText:'Читаю источники: 1 из 2…'})).toBeVisible();
  await input.fill('Следующий вопрос');
  await page.evaluate(()=>{const stream=(window as any).research;stream.emit({type:'text.delta',delta:'Одну страницу удалось прочитать.'});});
  await expect(page.getByRole('status').filter({hasText:'Читаю источники: 1 из 2…'})).toBeVisible();
  await expect(page.locator('.is-streaming')).toContainText('Одну страницу');
  await page.evaluate(()=>(window as any).research.emit({type:'progress',progress:{phase:'searching',message:'Проверка источников 2: уточняю оставшийся вопрос…'}}));
  await expect(page.getByRole('status').filter({hasText:'Проверка источников 2'})).toBeVisible();
  await expect(page.locator('.ds-thinking')).toContainText('Прошло');
  await expect(page.locator('.is-streaming')).toContainText('Одну страницу');
  await page.evaluate(()=>{const stream=(window as any).research;stream.emit({type:'complete',response:{requestId:stream.request.requestId,model:'mock-only',reply:{message:'Одну страницу удалось прочитать.',choices:[],artifactDraft:null,proposedFacts:[],research:{status:'partial',limitations:['Вторая страница недоступна.']},externalSources:[{id:'page1',version:1,projectId:stream.request.projectId,moduleId:stream.request.moduleId,generation:stream.request.coreContext.generation,requestId:stream.request.requestId,operationId:'read-1',url:'https://example.org/prices',title:'Тариф команды',retrievedAt:'2026-11-15T12:00:00Z',publishedAt:null,effectiveAt:null,retrieval:'read',contentHash:'hash',quotes:[{id:'q1',text:'12 USD за пользователя в месяц при годовой оплате.',start:0,end:55}],limitations:[]}],memoryPatch:{schemaVersion:1,projectId:stream.request.projectId,moduleId:stream.request.moduleId,generation:stream.request.coreContext.generation,requestId:stream.request.requestId,baseMemoryVersion:stream.request.coreContext.revision,baseContextVersion:stream.request.coreContext.contextVersion,sourceMessage:stream.request.coreContext.sourceMessage,operations:[]}}}});});
  await expect(page.locator('.workspace-message.assistant')).toHaveCount(1);await expect(input).toHaveValue('Следующий вопрос');
  await expect(page.getByText('Исследование не завершено',{exact:true})).not.toBeVisible();
  await expect(page.getByText('Вторая страница недоступна.',{exact:true})).not.toBeVisible();
  await page.screenshot({path:testInfo.outputPath('chat-without-read-errors.png'),fullPage:true});
  await page.getByRole('button',{name:'Ещё действия с ответом',exact:true}).click();await page.getByRole('menuitem',{name:'Посмотреть источники',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Источники ответа'}).getByText('Вторая страница недоступна.',{exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Тариф команды'})).toHaveAttribute('href','https://example.org/prices');
  await expect(page.getByText('12 USD за пользователя в месяц при годовой оплате.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`/tmp/t04-research-${width}-${colorScheme}.png`});await page.keyboard.press('Escape');await page.reload();await expect(input).toHaveValue('Следующий вопрос');
  await expect(page.getByText('Исследование не завершено',{exact:true})).not.toBeVisible();
  await expect(page.getByText('Вторая страница недоступна.',{exact:true})).not.toBeVisible();
  // The existing JSON transfer carries the new evidence and remaps ownership in the copy.
  if(await page.getByRole('button',{name:'Открыть меню',exact:true}).isVisible())await page.getByRole('button',{name:'Открыть меню',exact:true}).click();
  await page.getByRole('button',{name:'Проекты',exact:true}).click();
  const downloadWait=page.waitForEvent('download');await page.getByRole('button',{name:'Экспорт всех проектов JSON',exact:true}).click();
  const download=await downloadWait;const stream=await download.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));const raw=Buffer.concat(chunks);
  const exported=JSON.parse(raw.toString());expect(exported.projects[0].core.evidence[0].quotes[0].text).toContain('годовой оплате');
  await page.getByLabel('Импорт JSON',{exact:true}).setInputFiles({name:'research-copy.json',mimeType:'application/json',buffer:raw});
  await expect(page.locator('.project-list button')).toHaveCount(2);
  const projects=await page.evaluate(()=>JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects);
  expect(projects[1].id).not.toBe(projects[0].id);expect(projects[1].core.evidence[0].projectId).toBe(projects[1].id);
  expect(projects[1].modules.idea.draft).toBe('Следующий вопрос');

 });
}

// F05 exercises the actual Calculator modal, persisted state and responsive warning.
for(const colorScheme of ['light','dark'] as const) for(const width of [1280,390]) test(`F05 stale calculation warning preserves values in ${colorScheme} at ${width}px`,async({page})=>{
 const {createProject,saveArtifact}=await import('../../shared/domain');
 const {calculateMarket,calculateEconomics}=await import('../../shared/calculations');
 let project=createProject();for(const moduleId of ['idea','audience','competitors','market','business'] as const)project=saveArtifact(project,moduleId,{title:moduleId,body:'Условный сохранённый итог'});
 const reason='Изменена гипотеза цены с 5000 на 3500. Проверьте исходные данные.';
 project.calculations.market={...calculateMarket({totalBuyers:100,reachableBuyers:50,targetBuyers:10,price:5000,period:'месяц'}),stale:true,staleReason:reason};
 project.calculations.economics={...calculateEconomics({customers:10,price:5000,period:'месяц'}),stale:true,staleReason:reason};project.activeModule='market';
 await page.setViewportSize({width,height:844});await page.emulateMedia({colorScheme});
 await page.route('**/api/status',r=>r.fulfill({json:{configured:false,reason:'Проверка без ключа',model:'mock-only',searchEnabled:false}}));
 await page.addInitScript(p=>localStorage.setItem('cofounder.workspace.v1',JSON.stringify({version:1,activeProjectId:p.id,projects:[p]})),project);
 await page.goto('/');
 if(width<900)await page.getByRole('button',{name:'Открыть панель проекта',exact:true}).click();
 await page.getByRole('button',{name:/^Расчёт/}).click();
 const dialog=page.getByRole('dialog',{name:/Расчёт/});await expect(dialog.getByRole('status')).toContainText(reason);await expect(dialog.getByLabel('Расходы одного покупателя',{exact:true})).toHaveValue('5000');
 expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 await page.screenshot({path:`.autopilot/2026-11-15-bot-core--wip/evidence/f1-calculator-${width}-${colorScheme}.png`,fullPage:true});
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0]);expect(stored.calculations).toEqual(project.calculations);
});
