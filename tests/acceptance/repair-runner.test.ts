import { describe, it, expect } from 'vitest';
import { applyAnswer } from '../../src/features/workspace/answerRequests';
import { getCurrentEntries } from '../../shared/coreMemory';
import { assertRequestFits } from '../../src/lib/api';
import { conflictAcceptance, controlledPages, pagesForCase, acceptanceFollowup, k01CheckerEpisode, buildSeed, d13PreparationReady, d13ReadSeed, d13Followup, d13StateSnapshot, fixture, makeRequest, sourceCases } from './fixtures';
describe('D13 external preparation acceptance',()=>{
 it('accepts honest unknown from the actual read while preserving dependencies',()=>{
  const seed=buildSeed('D13');const prepared=structuredClone(seed);
  const entry=prepared.core!.entries.find(e=>e.key==='competitor_price')!;
  entry.epistemic='unknown';const evidence=prepared.core!.evidence.find(e=>e.id==='d13-controlled-read')!;
  evidence.requestId='actual-preparation';
  expect(d13PreparationReady(prepared,seed,'actual-preparation')).toBe(true);
  expect(d13PreparationReady(prepared,seed,'another-read')).toBe(false);
  evidence.retrieval='search_snippet';
  expect(d13PreparationReady(prepared,seed,'actual-preparation')).toBe(false);
 });
 it('rejects stale dependent assessment or mutated calculation',()=>{
  const seed=buildSeed('D13');const prepared=structuredClone(seed);
  const request=prepared.core!.evidence.find(e=>e.id==='d13-controlled-read')!.requestId;
  prepared.modules.market.artifact!.stale=true;
  expect(d13PreparationReady(prepared,seed,request)).toBe(false);
  prepared.modules.market.artifact!.stale=false;delete prepared.modules.market.artifact!.assessment;
  expect(d13PreparationReady(prepared,seed,request)).toBe(false);
 });
});

describe('D13 chronological live harness and immutable request branches',()=>{
 it('keeps the future correction out of the actual-read setup and adds it only after preparation',()=>{
  const correction=sourceCases.find(row=>row.source.id==='D13')!.source.input;
  const seed=d13ReadSeed(),before=JSON.stringify(seed);
  expect(seed.core!.evidence).toHaveLength(0);
  expect(seed.core!.entries.some(entry=>entry.key==='competitor_price')).toBe(false);
  expect(seed.calculations.market).toBeDefined();
  expect(seed.modules.market.artifact!.assessment).toBeDefined();
  const lead=makeRequest(seed,'competitors','Прочитай тариф отдельно от нашей цены.');
  expect(JSON.stringify(seed)).toBe(before);
  expect(JSON.stringify(lead.request)).not.toContain(correction);
  expect(lead.request.coreContext!.sourceMessages.some(source=>source.content===correction)).toBe(false);
  expect(lead.project.modules.business.messages.some(message=>message.content===correction)).toBe(false);
  expect(lead.request.coreContext!.entries.find(entry=>entry.key==='price')!.text).toContain('5000');
  // Here the runner waits for actual HTTP read+apply; only the subsequent
  // request may reveal the future user correction, never preparation history.
  const prepared=lead.project,preparedBytes=JSON.stringify(prepared);
  const follow=makeRequest(prepared,'business',correction);
  expect(JSON.stringify(prepared)).toBe(preparedBytes);
  expect(follow.request.message).toBe(correction);
  expect(follow.project.modules.business.messages.filter(message=>message.content===correction)).toHaveLength(1);
  expect(follow.request.coreContext!.sourceMessages.filter(source=>source.content===correction)).toHaveLength(1);
  expect(follow.request.coreContext!.entries.find(entry=>entry.key==='price')!.text).toContain('5000');
  expect(JSON.stringify(lead.request)).not.toContain(correction);
 });
 it('does not contaminate sibling requests or a logged applied state with unsent inspection turns',()=>{
  const project=buildSeed('D06'),before=JSON.stringify(project);
  const first=makeRequest(project,'business','Первый независимый вопрос');
  const sibling=makeRequest(project,'business','Второй независимый вопрос');
  expect(JSON.stringify(project)).toBe(before);
  expect(first.project.modules.business.messages.some(message=>message.content===sibling.request.message)).toBe(false);
  expect(sibling.request.coreContext!.sourceMessages.some(source=>source.content===first.request.message)).toBe(false);
  expect(sibling.request.context.history.some(message=>message.content===first.request.message)).toBe(false);
  const firstBytes=JSON.stringify(first.project);
  makeRequest(first.project,'business','Что из наших решений действует сейчас?');
  expect(JSON.stringify(first.project)).toBe(firstBytes);
 });
});

it('post-correction followup asks without amount hint and carries actual3500 version plus untouched foreign/stale state',()=>{
 const setup=fixture('D13'),context=setup.request.coreContext!;
 const price=getCurrentEntries(setup.project.core!).find(entry=>entry.key==='price')!;
 const {id:ignoredId,version:ignoredVersion,previousVersion:ignoredPrevious,createdAt:ignoredCreated,requestId:ignoredRequest,...value}=price;
 const corrected=applyAnswer(setup.project,setup.request,{message:'Цена изменена.',choices:[],artifactDraft:null,proposedFacts:[],memoryPatch:{schemaVersion:1,projectId:setup.project.id,moduleId:'business',generation:context.generation,requestId:setup.request.requestId,baseMemoryVersion:context.revision,baseContextVersion:context.contextVersion,sourceMessage:context.sourceMessage,operations:[{op:'revise',id:price.id,expectedVersion:price.version,value:{...value,text:setup.request.message,sources:[{type:'message',projectId:setup.project.id,moduleId:'business',generation:context.generation,...context.sourceMessage,quote:setup.request.message}]}}]}});
 const snapshot=d13StateSnapshot(corrected),before=JSON.stringify(corrected);
 const follow=d13Followup(corrected);
 expect(follow.request.message).not.toMatch(/3500|3[ \u00a0\u202f]500/u);
 expect(follow.request.message).toContain('Какая цена');
 expect(follow.request.message).toContain('чужим');
 expect(JSON.stringify(corrected)).toBe(before);
 expect(follow.request.coreContext!.currentEntryRefs).toContainEqual({id:price.id,version:2});
 expect(follow.request.coreContext!.entries.find(entry=>entry.id===price.id&&entry.version===2)?.text).toContain('3500');
 expect(snapshot.priceVersions?.map(entry=>entry.version)).toEqual([1,2]);
 expect(snapshot.marketCalculation).toMatchObject({stale:true});
 expect(snapshot.marketArtifact).toMatchObject({stale:true});
 expect(snapshot.marketArtifact?.assessment).toBeUndefined();
 expect(snapshot.foreignEntries).toEqual(d13StateSnapshot(setup.project).foreignEntries);
 expect(()=>assertRequestFits(follow.request)).not.toThrow();
 const applied=applyAnswer(follow.project,follow.request,{message:'Наша цена3500рублей за точку в месяц; внешний тариф не менялся.',choices:[],artifactDraft:null,proposedFacts:[]});
 expect(d13StateSnapshot(applied)).toEqual(snapshot);
});

it('adds the synthetic K01 episode only after the first answer, without mutating earlier history',()=>{
 const setup=fixture('K01'),initial=JSON.stringify(setup.project);
 expect(JSON.stringify(setup.request)).not.toContain(k01CheckerEpisode);
 const applied=applyAnswer(setup.project,setup.request,{message:'Вспомни конкретную смену.',choices:[],artifactDraft:null,proposedFacts:[]});
 const before=JSON.stringify(applied),follow=acceptanceFollowup('K01',applied);
 expect(JSON.stringify(setup.project)).toBe(initial);
 expect(JSON.stringify(applied)).toBe(before);
 expect(follow.request.message).toBe(k01CheckerEpisode);
 expect(follow.request.coreContext!.sourceMessages.filter(source=>source.content===k01CheckerEpisode)).toHaveLength(1);
 expect(follow.request.coreContext!.entries.some(entry=>entry.text.includes('пятничную'))).toBe(false);
 expect(follow.request.context.history.some(message=>message.content===setup.request.message)).toBe(true);
 expect(()=>assertRequestFits(follow.request)).not.toThrow();
});
it('actually switches D15 followup to market with active price separate from proposed scenario and no amount hint',()=>{
 const setup=fixture('D15'),c=setup.request.coreContext!;
 const applied=applyAnswer(setup.project,setup.request,{message:'Вариант сохранён отдельно.',choices:[],artifactDraft:null,proposedFacts:[],memoryPatch:{schemaVersion:1,projectId:setup.project.id,moduleId:setup.request.moduleId,generation:c.generation,requestId:setup.request.requestId,baseMemoryVersion:c.revision,baseContextVersion:c.contextVersion,sourceMessage:c.sourceMessage,operations:[{op:'create',localId:'price-variant',value:{key:'price',text:'Вариант10000; единица и период не указаны.',kind:'decision',scope:{subject:'our_project',entityId:null,area:'scenario',stageId:null,scenario:'вариант'},origin:'user',epistemic:'hypothesis',acceptance:'proposed',sources:[{type:'message',projectId:setup.project.id,moduleId:setup.request.moduleId,generation:c.generation,...c.sourceMessage,quote:setup.request.message}],dependsOn:[]}}]}});
 const before=JSON.stringify(applied),follow=acceptanceFollowup('D15',applied);
 expect(follow.request.moduleId).toBe('market');
 expect(follow.request.message).not.toMatch(/5000|10000|5[ \u00a0\u202f]000|10[ \u00a0\u202f]000/u);
 expect(JSON.stringify(applied)).toBe(before);
 const entries=follow.request.coreContext!.entries;
 expect(entries.some(entry=>entry.key==='price'&&entry.acceptance==='accepted'&&entry.scope.area==='project'&&entry.text.includes('5000'))).toBe(true);
 expect(entries.some(entry=>entry.key==='price'&&entry.acceptance==='proposed'&&entry.scope.area==='scenario'&&entry.text.includes('10000'))).toBe(true);
 expect(()=>assertRequestFits(follow.request)).not.toThrow();
});
it('D16 followup can request exact archived source even after visible history has been cropped',()=>{
 const setup=fixture('D16');
 const applied=applyAnswer(setup.project,setup.request,{message:'Заместитель и директор.',choices:[],artifactDraft:null,proposedFacts:[]});
 const follow=acceptanceFollowup('D16',applied);
 expect(follow.request.message).toContain('точный источник');
 expect(follow.request.message).not.toMatch(/заместител|директор/u);
 const sources=follow.request.coreContext!.sourceMessages;
 for(const text of ['Об обмене уведомляем заместителя.','Об обмене уведомляем директора.']){
  expect(sources.some(source=>source.content===text)).toBe(true);
  expect(follow.request.context.history.some(message=>message.content===text)).toBe(false);
 }
 expect(()=>assertRequestFits(follow.request)).not.toThrow();
});

it('reads a genuine same-plan same-terms C10 conflict without changing D13/own-price/K05 catalogues',()=>{
 const [first,second]=pagesForCase('C10-conflict');
 expect(first).toBe(controlledPages.annual);expect(second).toBe(controlledPages.contradictory);
 expect(first.url).not.toBe(second.url);
 expect(second.text.replace('7000','5000')).toBe(first.text);
 expect(second.publishedAt).toBe(first.publishedAt);expect(second.effectiveAt).toBe(first.effectiveAt);
 expect(second.text).toContain('предоплата за 12 месяцев');
 expect(controlledPages.conflict.text).toContain('помесячная оплата');
 for(const id of ['D13','C03-own-price','K05']){
  expect(pagesForCase(id)).toEqual([controlledPages.annual,controlledPages.old,controlledPages.home,controlledPages.conflict]);
  expect(pagesForCase(id)).not.toContain(second);
 }
 expect(pagesForCase('K05-prepare')).toEqual([first]);
 expect(pagesForCase('D26')).toEqual([controlledPages.home,controlledPages.old]);
});
it('keeps the additional C10 request neutral and read-first, with explicit additional properties and no original-index mutation',()=>{
 const original=JSON.stringify(sourceCases),setup=fixture('C10-conflict');
 expect(setup.row.source.id).toBe('C10-conflict');expect(setup.request.moduleId).toBe('competitors');
 expect(setup.request.message).toBe(conflictAcceptance.input);
 expect(setup.request.message).not.toMatch(/5000|7000/);
 expect(setup.request.coreContext!.evidence).toHaveLength(0);
 expect(setup.request.coreContext!.entries.filter(e=>e.key==='price')).toHaveLength(1);
 expect(setup.row.expected).toHaveLength(4);expect(setup.row.forbidden).toHaveLength(3);
 expect(sourceCases.some(row=>row.source.id==='C10-conflict')).toBe(false);
 expect(sourceCases).toHaveLength(46);expect(JSON.stringify(sourceCases)).toBe(original);
 expect(()=>assertRequestFits(setup.request)).not.toThrow();
});
