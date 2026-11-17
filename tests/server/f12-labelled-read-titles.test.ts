import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import fixture from './fixtures/grounding/full03-labelled-titles.json';
import {createEvidenceAliases} from '../../server/evidenceAliases';
import {validateReply} from '../../server/validation';
import type {AssistantReply,ChatRequest,ExternalEvidence} from '../../shared/types';
function decoded(index:number){const f=fixture.attempts[index],request=f.request as ChatRequest,sources=f.catalogue as ExternalEvidence[];expect(createHash('sha256').update(f.outputText).digest('hex')).toBe(f.sha256);const codec=createEvidenceAliases(sources);expect(codec.metadata.sourceAliases).toEqual(f.metadata.sourceAliases);const value=codec.resolveReply(JSON.parse(f.outputText));const operations=value.memoryOperations;delete value.memoryOperations;const core=request.coreContext!;if(Array.isArray(operations)&&operations.length)value.memoryPatch={schemaVersion:1,projectId:request.projectId,moduleId:request.moduleId,generation:core.generation,requestId:request.requestId,baseMemoryVersion:core.revision,baseContextVersion:core.contextVersion,sourceMessage:core.sourceMessage,operations};return {request,sources,value:value as unknown as AssistantReply};}
for(const index of [0,1])it(`accepts unchanged full03 raw ${fixture.attempts[index].id} with exact finite title descriptor`,()=>{const {request,sources,value}=decoded(index);const result=validateReply(value,request,sources);expect(result.message).toBe(value.message);expect(result.externalClaims).toEqual(value.externalClaims);expect(result.memoryPatch?.operations).toEqual(value.memoryPatch?.operations);});
it('does not exempt another title, other source, or annual/year assertions outside the exact title',()=>{
 for(const index of [0,1])for(const mutate of [(text:string)=>text.replace('Годовой тариф','Годовой другой тариф'),(text:string)=>text+' Годовая оплата.',(text:string)=>text+' Действует с 2027 года.',(text:string)=>text+' Цена 12000 RUB.']){
  const {request,sources,value}=decoded(index);if(index===0)value.memoryPatch!.operations[0].value.text=mutate(value.memoryPatch!.operations[0].value.text);else value.externalClaims![0].text=mutate(value.externalClaims![0].text);expect(()=>validateReply(value,request,sources)).toThrow();
 }
 for(const index of [0,1]){const {request,sources,value}=decoded(index);expect(()=>validateReply(value,request,sources.map(s=>({...s,title:'Другой тариф'})))).toThrow();expect(()=>validateReply(value,request,sources.map(s=>({...s,projectId:'foreign'})))).toThrow();}
});
