import { expect, it } from 'vitest';
import { applyAnswer } from '../../src/features/workspace/answerRequests';
import { getCurrentEntries } from '../../shared/coreMemory';
import { controlledPages, pagesForCase, tariffPreparationReady, fixture } from './fixtures';
it('F08 keeps missing-current-price, conflicting-price and three injection catalogues distinct',()=>{
 expect(pagesForCase('D26')).toEqual([controlledPages.home,controlledPages.old]);
 expect(pagesForCase('C10-conflict')).toEqual([controlledPages.annual,controlledPages.contradictory]);
 for(const id of ['C11-1','C11-2','C11-3'])expect(pagesForCase(id)).toEqual([controlledPages.annual]);
});
it('F08 requires a read tariff with its exact conditions before K05 can proceed',()=>{
 expect(tariffPreparationReady({})).toBe(false);
 expect(tariffPreparationReady({externalSources:[{url:controlledPages.annual.url,retrieval:'search_snippet',quotes:[{text:controlledPages.annual.text}]}]})).toBe(false);
 expect(tariffPreparationReady({externalSources:[{url:controlledPages.annual.url,retrieval:'read',quotes:[{text:controlledPages.annual.text}]}]})).toBe(true);
});
it('F07 D13 starts with an actual dependent calculation and assessment',()=>{
 const p=fixture('D13').project;
 expect(p.calculations.market).toBeDefined();expect(p.modules.market.artifact?.assessment).toBeDefined();
 expect((p.calculations.market as {stale?:boolean}).stale).not.toBe(true);
});

it('F07 D13 applies the new price and invalidates real derived state while preserving external scope',()=>{
 const {project,request}=fixture('D13'),c=request.coreContext!;
 const price=getCurrentEntries(project.core!).find(e=>e.key==='price')!;
 const {id:_id,version:_version,previousVersion:_previous,createdAt:_created,requestId:_request,...priceValue}=price;
 const external=getCurrentEntries(project.core!).find(e=>e.key==='competitor_price')!;
 const next=applyAnswer(project,request,{message:'Цена изменена, расчёт нужно пересмотреть.',choices:[],artifactDraft:null,proposedFacts:[],memoryPatch:{schemaVersion:1,requestId:request.requestId,projectId:project.id,moduleId:request.moduleId,generation:c.generation,baseMemoryVersion:c.revision,baseContextVersion:c.contextVersion,sourceMessage:c.sourceMessage,operations:[{op:'revise',id:price.id,expectedVersion:price.version,value:{...priceValue,text:request.message,sources:[{type:'message',projectId:project.id,moduleId:request.moduleId,generation:c.generation,messageId:c.sourceMessage.messageId,revision:1,quote:request.message}]}}]}});
 expect(getCurrentEntries(next.core!).find(e=>e.id===price.id)).toMatchObject({version:2,text:request.message});
 expect(next.calculations.market).toMatchObject({stale:true,staleReason:expect.any(String)});
 expect(next.modules.market.artifact).toMatchObject({stale:true,staleReason:expect.any(String)});
 expect(next.modules.market.artifact?.assessment).toBeUndefined();
 expect(getCurrentEntries(next.core!).find(e=>e.id===external.id)).toEqual(external);
});

it('F2 D06 seeds the invented external benchmark, not a chosen project price',()=>{
 const p=fixture('D06').project;
 const benchmark=getCurrentEntries(p.core!).find(e=>e.key==='competitor_benchmark');
 expect(benchmark).toMatchObject({epistemic:'hypothesis',scope:{subject:'external_entity'}});
 expect(benchmark?.text).toContain('5000 RUB');
 expect(getCurrentEntries(p.core!).find(e=>e.key==='price')?.text).toContain('3500');
});
it('F2 D13 has an independent read external basis that remains unchanged after correction',()=>{
 const p=fixture('D13').project;
 const external=getCurrentEntries(p.core!).find(e=>e.key==='competitor_price')!;
 expect(external).toMatchObject({origin:'external',epistemic:'observed',acceptance:'proposed'});
 expect(external.sources[0]).toMatchObject({type:'external'});
 expect(p.core!.evidence).toContainEqual(expect.objectContaining({retrieval:'read',quotes:expect.arrayContaining([expect.objectContaining({text:expect.stringContaining('9000 RUB')})])}));
 expect(p.modules.market.artifact!.assessment).toBeDefined();
 expect(p.modules.market.artifact!.basedOn?.evidence).toEqual([]);
});
it('F2 preserves C03 own-price-to-benchmark separately from original D06 external benchmark',()=>{
 const c03=fixture('C03-own-price');
 expect(getCurrentEntries(c03.project.core!).find(e=>e.key==='price')).toMatchObject({epistemic:'hypothesis',acceptance:'accepted',scope:{subject:'our_project'}});
 expect(getCurrentEntries(c03.project.core!).find(e=>e.key==='price')!.text).toContain('5000');
 expect(getCurrentEntries(c03.project.core!).some(e=>e.key==='competitor_benchmark')).toBe(false);
 expect(c03.request.message).toBe(fixture('D06').request.message);
});

it('C05 D16 really refreshes a short summary after forty-five archived turns without losing requirements',()=>{
 const {project,request}=fixture('D16');
 const summary=project.modules.mvp.memory!;
 expect(summary.content).toEqual({facts:[],hypotheses:[],openQuestions:['Какая следующая деталь требует проверки?']});
 expect(summary.needsRefresh).not.toBe(true);
 const refresh=project.modules.mvp.messages.find(m=>m.role==='assistant'&&m.reply?.memory===summary.content)!;
 expect(refresh).toBeDefined();expect(refresh.reply?.memoryPatch?.operations).toEqual([]);
 expect(project.core!.sourceMessages.filter(m=>m.content.startsWith('Обсудили несущественную деталь номер '))).toHaveLength(45);
 const requirements=request.coreContext!.entries.filter(e=>e.key.startsWith('requirement_'));
 expect(requirements).toHaveLength(8);
 expect(requirements.map(e=>e.text)).toEqual(expect.arrayContaining(['Об обмене уведомляем заместителя.','Об обмене уведомляем директора.','Первый интерфейс — Telegram mini-app.','Порядок согласования ещё не определён.']));
 for(const entry of requirements) for(const source of entry.sources){expect(source.type).toBe('message');if(source.type==='message')expect(request.coreContext!.sourceMessages).toContainEqual(expect.objectContaining({messageId:source.messageId,revision:source.revision,content:source.quote}));}
 expect(request.context.history).toHaveLength(40);
 expect(request.context.history.some(m=>m.content==='Об обмене уведомляем директора.')).toBe(false);
});
