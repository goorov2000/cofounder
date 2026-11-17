import {test,expect} from '@playwright/test';
import {writeFileSync,mkdirSync} from 'node:fs';
test('the same user request keeps researching after review and commits only its final streamed answer',async({page})=>{
 await page.route('**/api/**',route=>route.request().url().endsWith('/status')?route.fulfill({json:{configured:true,model:'mock-only',searchEnabled:true,reason:''}}):route.abort());
 await page.addInitScript(()=>{
  const original=window.fetch.bind(window);
  window.fetch=async(url,options)=>{
   if(url!=='/api/chat')return original(url,options);
   const request=JSON.parse(options!.body as string),encoder=new TextEncoder();
   return new Response(new ReadableStream({start(controller){(window as any).activeResearch={request,emit(event:object){controller.enqueue(encoder.encode(`data: ${JSON.stringify({requestId:request.requestId,...event})}\n\n`));}};}}),{headers:{'Content-Type':'text/event-stream'}});
  };
 });
 await page.goto('/');const input=page.getByRole('textbox',{name:'Сообщение',exact:true});
 await input.fill('Продолжай проверять конкурентов.');await input.press('Enter');
 await expect.poll(()=>page.evaluate(()=>Boolean((window as any).activeResearch))).toBe(true);
 await page.evaluate(()=>{const s=(window as any).activeResearch;s.emit({type:'text.delta',delta:'Следующим стоит проверить полный цикл.'});s.emit({type:'progress',progress:{phase:'reviewing',message:'Проверяю результат…'}});});
 await expect(page.locator('.is-streaming')).toContainText('Следующим стоит проверить');
 await input.fill('Мой следующий вопрос');
 await page.evaluate(()=>{const s=(window as any).activeResearch;s.emit({type:'text.reset'});s.emit({type:'progress',progress:{phase:'searching',message:'Продолжаю исследование: проверяю полный цикл…'}});});
 await expect(page.getByRole('status').filter({hasText:'Продолжаю исследование:'})).toBeVisible();
 await expect(page.getByText('Следующим стоит проверить полный цикл.',{exact:true})).toHaveCount(0);
 const pending=await page.evaluate(()=>JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0]);
 expect(pending.modules.idea.messages.filter((message:any)=>message.role==='assistant')).toHaveLength(0);
 await page.evaluate(()=>{
  const s=(window as any).activeResearch,r=s.request,c=r.coreContext;
  const source={id:'autonomous-second-read',version:2,projectId:r.projectId,moduleId:r.moduleId,generation:c.generation,requestId:r.requestId,operationId:'research-2:read-1',url:'https://example.org/checked-cycle',title:'Проверенный цикл',retrievedAt:'2026-11-16T10:00:00Z',publishedAt:null,effectiveAt:null,retrieval:'read',contentHash:'synthetic-cycle',quotes:[{id:'q1',text:'Запрос, ответ и доставка статуса.',start:0,end:32}],limitations:[]};
  s.emit({type:'complete',response:{requestId:r.requestId,model:'mock-only',reply:{message:'Сам проверил следующую часть исследования и сопоставил результаты.',choices:[],artifactDraft:null,proposedFacts:[],externalSources:[source],memoryPatch:{schemaVersion:1,projectId:r.projectId,moduleId:r.moduleId,generation:c.generation,requestId:r.requestId,baseMemoryVersion:c.revision,baseContextVersion:c.contextVersion,sourceMessage:c.sourceMessage,operations:[]}}}});
 });
 await expect(page.locator('.workspace-message.assistant')).toHaveCount(1);
 await expect(page.locator('.workspace-message.assistant')).toContainText('Сам проверил следующую часть');
 await expect(input).toHaveValue('Мой следующий вопрос');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0]);
 expect(saved.modules.idea.messages.filter((message:any)=>message.role==='user')).toHaveLength(1);
 expect(saved.core.appliedRequestIds).toHaveLength(1);
 expect(saved.core.evidence[0].operationId).toBe('research-2:read-1');
});
test('reads from a failed answer survive a new reply, reload and the next request with their original provenance',async({page})=>{
 const requests:any[]=[];
 await page.route('**/api/**',async route=>{
  if(route.request().url().endsWith('/status'))return route.fulfill({json:{configured:true,model:'mock-only',searchEnabled:true,reason:''}});
  if(!route.request().url().endsWith('/chat'))return route.abort();
  const r=route.request().postDataJSON();requests.push(r);
  if(requests.length===1)return route.fulfill({status:502,json:{requestId:r.requestId,error:{code:'INVALID_RESPONSE',message:'Контролируемый сбой после чтения.',retryable:false}}});
  const original=requests[0],c=r.coreContext,quote='Сервис отправляет напоминания исполнителю.';
  const source={id:'recovered-browser-source',version:1,projectId:r.projectId,moduleId:r.moduleId,generation:c.generation,requestId:original.requestId,operationId:'read-1',url:'https://example.org/recovered-features',title:'Сохранённая страница',retrievedAt:'2026-11-16T09:30:00Z',publishedAt:null,effectiveAt:null,retrieval:'read',contentHash:'synthetic-recovered-browser',quotes:[{id:'quote-1',text:quote,start:0,end:quote.length}],limitations:[]};
  return route.fulfill({json:{requestId:r.requestId,model:'mock-only',reply:{message:'Использую уже прочитанную страницу без повторного поиска.',choices:[],artifactDraft:null,proposedFacts:[],externalSources:[source],recoveredSourceRefs:[{id:source.id,version:1}],memoryPatch:{schemaVersion:1,requestId:r.requestId,projectId:r.projectId,moduleId:r.moduleId,generation:c.generation,baseMemoryVersion:c.revision,baseContextVersion:c.contextVersion,sourceMessage:c.sourceMessage,operations:[]}}}});
 });
 await page.goto('/');
 const input=page.getByRole('textbox',{name:'Сообщение',exact:true});
 await input.fill('Найди альтернативы с напоминаниями.');await input.press('Enter');
 await expect(page.getByText('Контролируемый сбой после чтения.',{exact:true})).toBeVisible();
 await input.fill('Продолжай');await input.press('Enter');
 await expect(page.locator('.workspace-message.assistant').last()).toContainText('без повторного поиска');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0]);
 expect(saved.core.evidence).toHaveLength(1);
 expect(saved.core.evidence[0]).toMatchObject({requestId:requests[0].requestId,retrievedAt:'2026-11-16T09:30:00Z'});
 await page.reload();
 await expect(page.locator('.workspace-message.assistant').last()).toContainText('без повторного поиска');
 await input.fill('Покажи сохранённый источник.');await input.press('Enter');
 await expect.poll(()=>requests.length).toBe(3);
 expect(requests[2].coreContext.evidence[0]).toEqual(saved.core.evidence[0]);
});
test('C13 failed research completes a separate restored research request in the same project',async({page},testInfo)=>{
 const requests:any[]=[];const calls:string[]=[];
 await page.route('**/api/**',async route=>{calls.push(route.request().url());if(route.request().url().endsWith('/status'))return route.fulfill({json:{configured:true,model:'mock-only',reason:'Controlled zero-API recovery acceptance',searchEnabled:true}});return route.abort();});
 await page.addInitScript(()=>{const original=window.fetch.bind(window);(window as any).controlled=[];window.fetch=async(url,options)=>{if(url!=='/api/chat')return original(url,options);const request=JSON.parse(options!.body as string);const encoder=new TextEncoder();return new Response(new ReadableStream({start(controller){(window as any).controlled.push({request,emit(event:object){controller.enqueue(encoder.encode(`data: ${JSON.stringify({requestId:request.requestId,...event})}\n\n`));}});}}),{headers:{'Content-Type':'text/event-stream'}});};});
 await page.goto('/design-system');await expect(page.getByRole('heading',{level:1,name:'Ваше пространство. Ваши цвета.'})).toBeVisible();await page.goto('/');const input=page.getByRole('textbox',{name:'Сообщение',exact:true});
 await input.fill('Найди опубликованные тарифы сервисов графиков смен.');await input.press('Enter');await expect(input).toHaveValue('');await expect.poll(()=>page.evaluate(()=>(window as any).controlled.length)).toBe(1);
 await page.evaluate(()=>{const s=(window as any).controlled[0];s.emit({type:'progress',progress:{phase:'searching',message:'Ищу источники…'}});s.emit({type:'complete',response:{requestId:s.request.requestId,model:'mock-only',reply:{message:'Поиск недоступен: SEARCH_FAILED. Подтверждённых тарифов нет. После восстановления отправьте новый запрос.',choices:[],artifactDraft:null,proposedFacts:[],externalSources:[],research:{status:'failed',limitations:['SEARCH_FAILED: controlled search unavailable']}}}});});
 await expect(page.locator('.workspace-message.assistant')).toHaveCount(1);await expect(page.locator('.workspace-message.assistant')).toContainText('SEARCH_FAILED');const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0]);expect(before.core.entries).toHaveLength(0);expect(before.core.evidence).toHaveLength(0);
 const next='Снова найди опубликованные тарифы. Не приравнивай публичный тариф к фактическим оплатам.';await input.fill(next);await input.press('Enter');await expect(input).toHaveValue('');await expect.poll(()=>page.evaluate(()=>(window as any).controlled.length)).toBe(2);await input.fill('Новый черновик после восстановленного запроса');
 const sent=await page.evaluate(()=>(window as any).controlled.map((s:any)=>s.request));requests.push(...sent);expect(sent[1].projectId).toBe(sent[0].projectId);expect(sent[1].requestId).not.toBe(sent[0].requestId);expect(sent[1].message).toBe(next);
 await page.evaluate(()=>{const s=(window as any).controlled[1],r=s.request,c=r.coreContext;const quote='12 USD за пользователя в месяц при годовой оплате.';const evidence={id:'controlled-restored-page',version:1,projectId:r.projectId,moduleId:r.moduleId,generation:c.generation,requestId:r.requestId,operationId:'read-restored',url:'https://example.org/restored-pricing',title:'Контролируемая страница после восстановления',retrievedAt:'2026-11-15T15:00:00Z',publishedAt:null,effectiveAt:null,retrieval:'read',contentHash:'controlled-recovery-fixture',quotes:[{id:'q1',text:quote,start:0,end:quote.length}],limitations:[]};const memoryPatch={schemaVersion:1,requestId:r.requestId,projectId:r.projectId,moduleId:r.moduleId,generation:c.generation,baseMemoryVersion:c.revision,baseContextVersion:c.contextVersion,sourceMessage:c.sourceMessage,operations:[{op:'create',localId:'recovery-constraint',value:{kind:'constraint',key:'public_offer_not_actual_payments',text:'Не приравнивай публичный тариф к фактическим оплатам.',origin:'user',epistemic:'reported',acceptance:'accepted',scope:{subject:'our_project',entityId:null,area:'project',stageId:null,scenario:null},sources:[{type:'message',projectId:r.projectId,moduleId:r.moduleId,generation:c.generation,...c.sourceMessage,quote:'Не приравнивай публичный тариф к фактическим оплатам.'}],dependsOn:[]}}]};s.emit({type:'progress',progress:{phase:'reading',message:'Путь восстановлен, читаю первичную страницу…'}});s.emit({type:'complete',response:{requestId:r.requestId,model:'mock-only',reply:{message:'Контролируемое исследование завершено:12 USD за пользователя в месяц при годовой оплате. Это публичный тариф, не фактические оплаты.',choices:[],artifactDraft:{title:'Завершённое восстановленное исследование',body:'12 USD за пользователя в месяц при годовой оплате. Источник: https://example.org/restored-pricing ; проверено15.11.2026. Спрос неизвестен.'},proposedFacts:[],externalSources:[evidence],research:{status:'completed',limitations:[]},memoryPatch}}});});
 await expect(page.locator('.workspace-message.assistant')).toHaveCount(2);await expect(page.locator('.workspace-message.assistant').last()).toContainText('исследование завершено');await expect(input).toHaveValue('Новый черновик после восстановленного запроса');const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0]);expect(after.id).toBe(before.id);expect(after.core.entries).toHaveLength(1);expect(after.core.entries[0]).toMatchObject({key:'public_offer_not_actual_payments',origin:'user',acceptance:'accepted'});expect(after.core.evidence).toHaveLength(1);expect(after.core.evidence[0].requestId).toBe(sent[1].requestId);expect(after.modules.idea.messages.filter((m:any)=>m.role==='assistant')[0].content).toContain('SEARCH_FAILED');expect(after.modules.idea.messages.filter((m:any)=>m.role==='assistant')[1].content).toContain('исследование завершено');expect(calls.filter(u=>!u.endsWith('/status'))).toHaveLength(0);
 await page.getByRole('button',{name:'Ещё действия с ответом',exact:true}).last().click();await page.getByRole('menuitem',{name:'Посмотреть источники',exact:true}).click();const sources=page.getByRole('dialog',{name:'Источники ответа',exact:true});await expect(sources.getByRole('link',{name:'Контролируемая страница после восстановления',exact:true})).toHaveAttribute('href','https://example.org/restored-pricing');await expect(sources.getByText('12 USD за пользователя в месяц при годовой оплате.',{exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(input).toHaveValue('Новый черновик после восстановленного запроса');
 const out=testInfo.outputPath('C13-recovery');mkdirSync(out,{recursive:true});writeFileSync(out+'/probe.json',JSON.stringify({status:'pass',evidenceMode:'controlled browser integration, no actual search/model; final live C09 normalpath separate supplemental',requests:requests.map(r=>({requestId:r.requestId,projectId:r.projectId,message:r.message})),before,after,apiCalls:calls,paidCalls:0},null,2));await page.screenshot({path:out+'/recovered.png'});
});
