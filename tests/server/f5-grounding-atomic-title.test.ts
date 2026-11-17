import {expect,it} from 'vitest';
import cases from './fixtures/grounding/targeted-02-d13.json';
import {validateReply,ReplyValidationError} from '../../server/validation';
import {validateMemoryValue} from '../../shared/coreValidation';
import type {ChatRequest,ExternalEvidence,MemoryPatch} from '../../shared/types';
function replay(fixture:typeof cases[number]) {
 const request=fixture.request as unknown as ChatRequest;
 const raw=structuredClone(fixture.raw) as Record<string,unknown>;
 const operations=raw.memoryOperations;delete raw.memoryOperations;
 raw.proposedFacts=(raw.proposedFacts as Record<string,unknown>[]).map(fact=>Object.fromEntries(Object.entries(fact).filter(([key,value])=>!(['sourceUrl','checkedAt'].includes(key)&&value===null))));
 const core=request.coreContext!;
 const patch:MemoryPatch={schemaVersion:1,projectId:request.projectId,moduleId:request.moduleId,generation:core.generation,requestId:request.requestId,baseMemoryVersion:core.revision,baseContextVersion:core.contextVersion,sourceMessage:core.sourceMessage,operations:operations as MemoryPatch['operations']};
 raw.memoryPatch=patch;raw.externalSources=fixture.evidence;
 return {request,raw,patch,value:patch.operations[0].value,evidence:fixture.evidence as ExternalEvidence[]};
}
for(const fixture of cases) it(`validates complete unchanged D13 ${fixture.generation} without confusing an exact title with its period`,()=>{
 const {request,raw,value,evidence}=replay(fixture);
 const before=JSON.stringify(raw);
 if(fixture.generation==='first'){
  // Independent lexical limitation: the negative comparability sentence also
  // mentions 'за точку', which is not the source's 'за пользователя'.
  expect(()=>validateMemoryValue(value,request.coreContext!,raw.memoryPatch as MemoryPatch,evidence)).toThrow();
  let error:unknown;try{validateReply(raw,request,evidence);}catch(caught){error=caught;}
  expect((error as ReplyValidationError).validationIssue).toMatchObject({path:['memoryPatch','operations',0,'value','text'],rule:'ungrounded_memory_quantity'});
  expect(JSON.stringify(raw)).toBe(before);
  return;
 }
 expect(()=>validateMemoryValue(value,request.coreContext!,raw.memoryPatch as MemoryPatch,evidence)).not.toThrow();
 expect(validateReply(raw,request,evidence).memoryPatch!.operations[0].value.text).toBe(value.text);
 expect(JSON.stringify(raw)).toBe(before);
});
it('only exempts labelled exact titles of the actually cited same-project read',()=>{
 const {request,value,patch,evidence}=replay(cases[0]);
 const run=()=>validateMemoryValue(value,request.coreContext!,patch,evidence);
 const original=value.text;
 value.text=original.replace('На прочитанной странице «Годовой тариф»','Источник «Годовой тариф»');expect(run).not.toThrow();
 value.text=original.replace('Годовой тариф','Другой годовой тариф');expect(run).toThrow();
 value.text=original+' Годовая оплата.';expect(run).toThrow();
 value.text=original.replace('5000','7000');expect(run).toThrow();
 value.text=original.replace('RUB','EUR');expect(run).toThrow();
 value.text=original.replace('за пользователя','за точку');expect(run).toThrow();
 value.text=original.replace('в месяц','в год');expect(run).toThrow();
 value.text=original;
 evidence[1].title='Годовой тариф 2027';
 value.text=original.replace('Годовой тариф','Годовой тариф 2027');expect(run).toThrow();
 value.text=original;
 evidence[0].projectId='other-project';expect(run).toThrow();
 evidence[0].projectId=request.projectId;evidence[0].retrieval='search_snippet';expect(run).toThrow();
});
