import {test,expect,type Page} from '@playwright/test';
import {createProject} from '../../shared/domain';
import {archiveMessage} from '../../shared/coreMemory';
import type {ChatRequest,MemoryPatch,Workspace} from '../../shared/types';

async function workspace(page:Page):Promise<Workspace>{return page.evaluate(()=>JSON.parse(localStorage.getItem('cofounder.workspace.v1')!));}
async function selectProject(page:Page,name:string){await page.getByRole('button',{name:'Проекты',exact:true}).click();await page.getByRole('dialog',{name:'Проекты в этом браузере',exact:true}).getByRole('button',{name:new RegExp(name)}).click();}

test('late restaurant reply applies only to its original project while bicycle project stays unchanged',async({page},testInfo)=>{
 let a=createProject();a.name='Ресторан A';a.description='Графики смен кафе Берёза.';
 const original={id:'restaurant-original',revision:1,role:'user' as const,content:'Кафе Берёза использует ручной график смен.',createdAt:a.createdAt};
 a=archiveMessage(a,'idea',original);a.modules.idea.messages.push(original);
 let b=createProject();b.name='Веломастерская B';b.description='Ремонт велосипедов и диагностика.';
 const bicycle={id:'bicycle-original',revision:1,role:'user' as const,content:'Ремонт велосипеда включает диагностику. Монтаж и детали оплачиваются отдельно.',createdAt:b.createdAt};
 b=archiveMessage(b,'idea',bicycle);b.modules.idea.messages.push(bicycle);b.modules.idea.draft='Мой вопрос о велосипеде';
 b.modules.idea.memory={updatedAt:b.createdAt,content:{facts:[{text:bicycle.content,evidence:bicycle.content}],hypotheses:[],openQuestions:[]}};
 await page.addInitScript(seed=>{if(!localStorage.getItem('cofounder.workspace.v1'))localStorage.setItem('cofounder.workspace.v1',JSON.stringify(seed));},{version:1,activeProjectId:a.id,projects:[a,b]});
 await page.route('**/api/status',route=>route.fulfill({json:{configured:true,model:'mock-only',reason:'',searchEnabled:false}}));
 let release!:()=>void,settled!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;}),finished=new Promise<void>(resolve=>{settled=resolve;});
 const sent:ChatRequest[]=[];
 await page.route('**/api/chat',async route=>{
  const request=route.request().postDataJSON() as ChatRequest;sent.push(request);await held;
  const core=request.coreContext!;
  const patch:MemoryPatch={schemaVersion:1,requestId:request.requestId,projectId:request.projectId,moduleId:request.moduleId,generation:core.generation,baseMemoryVersion:core.revision,baseContextVersion:core.contextVersion,sourceMessage:core.sourceMessage,operations:[{op:'create',localId:'restaurant-price',value:{kind:'decision',key:'price',text:request.message,origin:'user',epistemic:'hypothesis',acceptance:'accepted',scope:{subject:'our_project',entityId:null,area:'project',stageId:null,scenario:null},sources:[{type:'message',projectId:request.projectId,moduleId:request.moduleId,generation:core.generation,...core.sourceMessage,quote:request.message}],dependsOn:[]}}]};
  const source=core.sourceMessages.find(s=>s.messageId===original.id)!;
  await route.fulfill({json:{requestId:request.requestId,model:'mock-only',reply:{message:'Ранее вы указали: «Кафе Берёза». Гипотеза цены ресторана сохранена.',choices:[],artifactDraft:null,proposedFacts:[],memoryPatch:patch,memory:{facts:[{text:request.message,evidence:request.message}],hypotheses:[],openQuestions:[]},historySources:[{source,quotes:['Кафе Берёза']}]}}});settled();
 });
 await page.setViewportSize({width:1280,height:800});await page.goto('/');
 const input=page.getByRole('textbox',{name:'Сообщение',exact:true});await input.fill('Принимаем гипотезу цены ресторана: 5000 рублей за точку в месяц.');await input.press('Enter');
 await expect.poll(()=>sent.length).toBe(1);expect(sent[0].projectId).toBe(a.id);
 expect(JSON.stringify(sent[0])).not.toContain(bicycle.content);
 await selectProject(page,b.name);await expect(input).toHaveValue('Мой вопрос о велосипеде');
 const before=(await workspace(page)).projects.find(p=>p.id===b.id)!;
 release();await finished;
 await expect.poll(async()=>{const w=await workspace(page);return w.projects.find(p=>p.id===a.id)!.modules.idea.messages.some(m=>m.role==='assistant'&&m.requestId===sent[0].requestId);}).toBe(true);
 const after=await workspace(page);expect(after.activeProjectId).toBe(b.id);expect(after.projects.find(p=>p.id===b.id)).toEqual(before);
 await expect(page.getByText('Гипотеза цены ресторана сохранена.',{exact:false})).toHaveCount(0);await expect(input).toHaveValue('Мой вопрос о велосипеде');
 await testInfo.attach('b-active-after-late-a',{body:await page.screenshot(),contentType:'image/png'});
 await selectProject(page,a.name);await expect(page.locator('.workspace-message.assistant').last()).toContainText('Гипотеза цены ресторана сохранена');
 const saved=(await workspace(page)).projects.find(p=>p.id===a.id)!;const price=saved.core!.entries.find(e=>e.key==='price')!;
 expect(price.text).toBe(sent[0].message);expect(price.sources).toEqual([{type:'message',projectId:a.id,moduleId:'idea',generation:sent[0].coreContext!.generation,...sent[0].coreContext!.sourceMessage,quote:sent[0].message}]);
 expect(saved.modules.idea.memory!.content.facts).toEqual([{text:sent[0].message,evidence:sent[0].message}]);
 const answer=saved.modules.idea.messages.find(m=>m.role==='assistant'&&m.requestId===sent[0].requestId)!;
 expect(answer.reply!.historySources![0].source.projectId).toBe(a.id);expect(answer.reply!.historySources![0].source.content).toBe(original.content);
 expect(JSON.stringify(answer.reply)).not.toContain(bicycle.content);
 await page.getByRole('button',{name:'Ещё действия с ответом',exact:true}).last().click();await page.getByRole('menuitem',{name:'Посмотреть источники',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Источники ответа',exact:true});await expect(dialog).toContainText(original.content);await expect(dialog).not.toContainText(bicycle.content);
 await testInfo.attach('a-own-sources',{body:await page.screenshot(),contentType:'image/png'});
 await testInfo.attach('project-flight-state',{body:JSON.stringify({request:sent[0],restaurantId:a.id,bicycleId:b.id,bicycleBefore:before,bicycleAfter:after.projects.find(p=>p.id===b.id),restaurantAfter:saved},null,2),contentType:'application/json'});
 await page.keyboard.press('Escape');
 await page.reload();await expect(page.locator('.workspace-message.assistant').last()).toContainText('Гипотеза цены ресторана сохранена');
 expect((await workspace(page)).projects.find(p=>p.id===b.id)).toEqual(before);expect(sent).toHaveLength(1);
});
