import { expect, test } from 'vitest';
import { createProject } from '../../shared/domain';
import { validateMemoryValue } from '../../shared/coreValidation';
import { validateReply } from '../../server/validation';
import { buildPrompt } from '../../server/prompt';
import { applyAnswer } from '../../src/features/workspace/answerRequests';
import { makeRequest } from '../acceptance/fixtures';
import type { MemoryPatch, AtomicValue } from '../../shared/types';

const scenario='Предложена чувствительность SAM при 30/60/90 подходящих точках. Это условные значения, не оценка фактической численности.';
function seed(){
 const s=makeRequest(createProject(),'market','Число подходящих кофеен не знаю.');
 const c=s.request.coreContext!;
 const patch:MemoryPatch={schemaVersion:1,projectId:s.request.projectId,moduleId:'market',generation:c.generation,requestId:s.request.requestId,baseMemoryVersion:c.revision,baseContextVersion:c.contextVersion,sourceMessage:c.sourceMessage,operations:[]};
 return {...s,core:c,patch};
}
test('assistant proposal cannot cite the user unknown as proof of new scenario numbers',()=>{
 const s=seed();
 const value:AtomicValue={kind:'decision',key:'local_market_sensitivity',scope:{subject:'our_project',entityId:null,area:'scenario',stageId:'market',scenario:'Чувствительность SAM'},text:scenario,origin:'assistant',epistemic:'hypothesis',acceptance:'proposed',sources:[{type:'message',projectId:s.request.projectId,moduleId:'market',generation:s.core.generation,...s.core.sourceMessage,quote:s.request.message}],dependsOn:[]};
 expect(()=>validateMemoryValue(value,s.core,s.patch,[])).toThrow(expect.objectContaining({validationRule:'ungrounded_memory_quantity'}));
});
test('new numerical proposal remains visible and durable in hypotheses without false atomic sources',()=>{
 const s=seed();
 const reply=validateReply({message:scenario,choices:[],artifactDraft:null,proposedFacts:[],externalClaims:[],memoryPatch:s.patch,memory:{facts:[],hypotheses:[scenario],openQuestions:['Какова реальная численность сегмента?']}},s.request,[]);
 const saved=applyAnswer(s.project,s.request,reply);
 expect(saved.modules.market.messages.at(-1)?.content).toBe(scenario);
 expect(saved.modules.market.memory?.content.hypotheses).toEqual([scenario]);
 expect(saved.core!.entries).toHaveLength(0);
 expect(saved.core!.sourceMessages.some(m=>m.role==='assistant'&&m.content===scenario)).toBe(true);
 expect(buildPrompt(s.request).instructions).toContain('Пока в sourceMessages нет буквального основания этих чисел');
});
