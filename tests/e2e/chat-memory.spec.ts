import { test, expect, type Page } from '@playwright/test';
import { createProject, saveArtifact } from '../../shared/domain';
import type { ChatMemory, ChatRequest } from '../../shared/types';
import { expandRoute, expandContext, expandCoverage } from './project-panel';

const memory: ChatMemory = {
  facts: [{text:'Пицца для небольших офисов в Самаре.',evidence:'Хочу доставлять пиццу в небольшие офисы Самары'}, {text:'На запуск есть 50 тысяч рублей.',evidence:'Бюджет 50 тысяч рублей'}],
  hypotheses: ['Заказ к обеду по предварительной записи.'],
  openQuestions: ['Кто собирает и оплачивает общий заказ?'],
};
async function seed(page: Page, withMemory = true) {
  const project = saveArtifact(createProject(), 'idea', {title:'Пицца в офис',body:'Сохранённый итог идеи'});
  if (withMemory) project.modules.idea.memory={content:memory,updatedAt:'2026-11-15T10:00:00Z'};
  project.modules.idea.messages=[{id:'user-start',role:'user',content:'Хочу доставлять пиццу в небольшие офисы Самары. Бюджет 50 тысяч рублей.',createdAt:'2026-11-15T10:00:00Z'}, {id:'assistant-start',role:'assistant',content:'Начнём с одного офисного заказа: как его собирают сейчас и кто оплачивает? Это поможет уточнить покупателя.',createdAt:'2026-11-15T10:00:01Z'}];
  await page.addInitScript(project=>{if(!localStorage.getItem('cofounder.workspace.v1'))localStorage.setItem('cofounder.workspace.v1',JSON.stringify({version:1,activeProjectId:project.id,projects:[project]}));},project);
  await page.route('**/api/**',route=>route.request().url().endsWith('/status')?route.fulfill({json:{configured:true,reason:'',model:'mock-only',searchEnabled:false}}):route.abort());
  await page.goto('/');
  await expect(page.locator('.workspace-message.assistant')).toBeVisible();
}

for(const colorScheme of ['light','dark'] as const) for(const width of [1440,1280,390]) {
  test(`readable memory and route share the panel at ${width}px ${colorScheme}`,async({page})=>{
    await page.setViewportSize({width,height:width===1280?720:900});
    await page.emulateMedia({colorScheme});
    await seed(page);
    await expandContext(page);
    const panel=page.locator('.ds-project-panel');
    await expect(panel.getByText(memory.facts[0].text,{exact:true})).toBeVisible();
    await expect(panel.getByRole('button',{name:/Презентация/})).toHaveCount(0);
    expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`.repair/2026-11-16-panel-progress/memory-${width}-${colorScheme}.png`});
    await expandRoute(page);
    await panel.getByRole('button',{name:'Идея',exact:true}).scrollIntoViewIfNeeded();
    await expect(panel.getByRole('button',{name:'Идея',exact:true})).toBeInViewport({ratio:1});
    await expect(panel.getByRole('button', { name: 'Контекст проекта', exact: true })).toHaveAttribute('aria-expanded','false');
    await expandContext(page);
    await expect(panel.locator('.ds-project-route')).toHaveAttribute('data-expanded', 'false');
    await expect(panel.getByRole('button',{name:/^Итог этапа|^Уточнить в чате/})).toHaveCount(0);
    await expect(panel.locator('.ds-project-context .ds-project-memory')).toBeInViewport({ratio:1});
    await page.screenshot({path:`.repair/2026-11-16-panel-progress/memory-${width}-${colorScheme}-expanded.png`});
    if(width<900)await page.keyboard.press('Escape');
    await page.getByRole('textbox',{name:'Сообщение',exact:true}).fill('Уточнение: заказ оплачивает компания');
    await expect(page.getByRole('textbox',{name:'Сообщение',exact:true})).toHaveValue('Уточнение: заказ оплачивает компания');
  });
}

test('memory is automatic, correctable in chat, durable and carried across stages; sources show retrieved notes',async({page})=>{
  const requests: ChatRequest[]=[];
  await seed(page,false);
  await page.route('**/api/chat',route=>{
    const request=route.request().postDataJSON() as ChatRequest;requests.push(request);
    return route.fulfill({json:{requestId:request.requestId,model:'mock-only',reply:{message:'Контекст обновлён.',choices:[],artifactDraft:null,proposedFacts:[],memory,
      knowledgeSources:[{id:'interviews',title:'Интервью о прошлом опыте',body:'Спросите о последнем реальном заказе.',version:'2026-11-15'}]}}});
  });
  const input=page.getByRole('textbox',{name:'Сообщение',exact:true});
  await input.fill('Запомни эти вводные');await input.press('Enter');
  await expect(page.locator('.ds-project-context .ds-project-memory')).toContainText(memory.facts[0].text);
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('cofounder.workspace.v1')!).projects[0].modules.idea.memory?.content.facts.length)).toBe(2);
  await page.reload();
  await expect(page.locator('.ds-project-context .ds-project-memory')).toContainText(memory.facts[0].text);
  await input.fill('Мой неотправленный вопрос');
  await expandContext(page);
  await expect(page.getByRole('button',{name:'Уточнить в чате'})).toHaveCount(0);
  await expect(input).toHaveValue('Мой неотправленный вопрос');
  const answer=page.locator('.workspace-message.assistant').last();
  await answer.getByRole('button',{name:'Ещё действия с ответом'}).click();
  await page.getByRole('menuitem',{name:'Посмотреть источники'}).click();
  await page.getByText('Интервью о прошлом опыте',{exact:true}).click();
  await expect(page.getByText('Спросите о последнем реальном заказе.',{exact:true})).toBeVisible();
  await page.screenshot({path:'.repair/2026-11-16-panel-progress/memory-sources.png'});
  await page.keyboard.press('Escape');
  await expandRoute(page);await page.getByRole('button',{name:'Аудитория',exact:true}).click();
  await input.fill('Кого опросить сначала?');await input.press('Enter');
  await expect.poll(()=>requests.length).toBe(2);
  expect(requests[1].moduleId).toBe('audience');
  expect(requests[1].context.memories?.[0]).toMatchObject({moduleId:'idea',content:memory});
  expect(requests[1].context.history).toEqual([]);
});

for (const colorScheme of ['light', 'dark'] as const) for (const [width, height] of [[1280, 720], [1024, 600], [390, 844], [320, 720]]) {
  test(`topic criteria and a nonmodal hint remain usable at ${width}x${height} ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme });
    await seed(page);
    await expandCoverage(page);
    const panel = page.locator('.ds-project-panel');
    const toggle = panel.getByRole('button', { name: 'Проработка темы', exact: true });
    const info = panel.getByRole('button', { name: 'О проработке темы', exact: true });
    const hint = panel.locator('.ds-project-coverage .ds-info-hint-content');
    const dialogs = await page.getByRole('dialog').count();
    // The criteria extend the former short memory. Small screens use the
    // existing outer scroll; the coverage header and progress remain reachable.
    await expect(toggle).toBeInViewport({ ratio: 1 });
    await expect(panel.getByRole('heading', { name: 'Проработка темы' })).toBeInViewport({ ratio: 1 });
    await expect(panel.getByRole('progressbar', { name: 'Проработка темы' })).toBeInViewport({ ratio: 1 });
    await expect(panel.getByRole('button', { name: /^Итог этапа|^Уточнить в чате/ })).toHaveCount(0);
    const panelBox = await panel.boundingBox();
    if (width >= 900) expect(panelBox!.width).toBe(width > 1100 ? 320 : 280);
    const history = page.locator('.workspace-history');
    const readingPosition = await history.evaluate(e => e.scrollTop);
    await info.hover();
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Уточнения можно написать в чат');
    await expect(hint).toBeInViewport({ ratio: 1 });
    expect(await panel.boundingBox()).toEqual(panelBox);
    expect(await history.evaluate(e => e.scrollTop)).toBe(readingPosition);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(dialogs);
    await hint.hover();
    await expect(hint).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(hint).toBeHidden();
    await info.focus();
    await expect(hint).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(hint).toBeHidden();
    await expect(info).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(dialogs);
    await info.click();
    await expect(hint).toBeVisible();
    // The chevron is part of the same toggle; the neighboring info button is independent.
    const heading = panel.locator('.ds-project-coverage .ds-project-accordion-heading');
    const headingBox = await heading.boundingBox();
    await heading.click({ position: { x: headingBox!.width - 8, y: headingBox!.height / 2 } });
    await expect(hint).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel.locator('.ds-topic-coverage')).toBeHidden();
    await expect(panel.getByRole('progressbar', { name: 'Проработка темы' })).toBeVisible();
    await expect(panel.locator('.ds-project-route')).toHaveAttribute('data-expanded', 'false');
    const routeInfo = panel.getByRole('button', { name: 'О маршруте проекта', exact: true });
    const routeHint = panel.locator('.ds-project-route .ds-info-hint-content');
    await routeInfo.hover();
    await expect(routeHint).toBeVisible();
    await expect(routeHint).toContainText('Девять тем от идеи до MVP');
    await expect(routeHint).toBeInViewport({ ratio: 1 });
    await routeInfo.press('Enter');
    await expect(panel.locator('.ds-project-route')).toHaveAttribute('data-expanded', 'false');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Escape');
    await expect(routeHint).toBeHidden();
    await expect(routeInfo).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(dialogs);
  });
}

test('the coverage hint opens by touch without toggling the list or creating another dialog', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await seed(page);
  await expandCoverage(page);
  const info = page.getByRole('button', { name: 'О проработке темы', exact: true });
  expect((await info.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await info.tap();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Проработка темы', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('heading', { name: 'Панель проекта', exact: true }).tap();
  await expect(page.locator('.ds-project-coverage .ds-info-hint-content')).toBeHidden();
  await page.getByRole('button', { name: 'О маршруте проекта', exact: true }).tap();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await expect(page.locator('.ds-project-route')).toHaveAttribute('data-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Проработка темы', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await context.close();
});
