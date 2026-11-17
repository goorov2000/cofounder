import { expect, it } from 'vitest';
import { createProject } from '../../shared/domain';
import { getCurrentEntries } from '../../shared/coreMemory';
import { validateReply } from '../../server/validation';
import { applyAnswer } from '../../src/features/workspace/answerRequests';
import { makeRequest } from '../acceptance/fixtures';
import type { AssistantReply, AtomicValue } from '../../shared/types';

it('F01 accepts equivalent numbers through validateReply/applyAnswer while refusing different quantities and source/status promotion', () => {
 for (const [quote, text] of [['Цена 5к рублей за точку в месяц', 'Цена 5 000 рублей за точку в месяц'], ['Вариант 10000 рублей', 'Вариант 10 000 рублей'], ['Цена 3,5 тыс. рублей', 'Цена 3500 рублей'], ['Цена 1\u00a0000\u202f000 рублей', 'Цена 1000000 рублей']]) {
  const {project, request}=makeRequest(createProject(),'idea',quote),core=request.coreContext!;
  const value:AtomicValue={kind:'decision',key:'price',scope:{subject:'our_project',entityId:null,area:'project',stageId:null,scenario:null},text,origin:'user',epistemic:'hypothesis',acceptance:'accepted',sources:[{type:'message',projectId:project.id,moduleId:'idea',generation:0,...core.sourceMessage,quote}],dependsOn:[]};
  const reply:AssistantReply={message:'Сохранил гипотезу.',choices:[],proposedFacts:[],artifactDraft:null,memoryPatch:{schemaVersion:1,projectId:project.id,moduleId:'idea',generation:0,requestId:request.requestId,baseMemoryVersion:core.revision,baseContextVersion:core.contextVersion,sourceMessage:core.sourceMessage,operations:[{op:'create',localId:'price',value}]}};
  const saved=applyAnswer(project,request,validateReply(reply,request));
  expect(getCurrentEntries(saved.core!)[0]).toMatchObject({text,epistemic:'hypothesis',acceptance:'accepted'});
  for(const change of [{text:'Цена 6000 рублей'}, {text:text.replace('рублей','USD')}, {epistemic:'observed'}, {origin:'external'}] as Partial<AtomicValue>[]) {
   const bad=structuredClone(reply);Object.assign(bad.memoryPatch!.operations[0].value,change);
   expect(()=>validateReply(bad,request)).toThrow();expect(()=>applyAnswer(project,request,bad)).toThrow();
  }
  if(quote.includes('точку'))for(const text of ['Цена 5000 рублей за пользователя в месяц','Цена 5000 рублей за точку в год']){
   const bad=structuredClone(reply);bad.memoryPatch!.operations[0].value.text=text;expect(()=>validateReply(bad,request)).toThrow();
  }
  const assistant=structuredClone(request);assistant.coreContext!.sourceMessages[0].role='assistant';
  expect(()=>validateReply(reply,assistant)).toThrow();
  expect(project.core?.entries??[]).toHaveLength(0);
 }
});
