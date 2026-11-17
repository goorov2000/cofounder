import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import fixture from './fixtures/grounding/targeted-09-c10-bare-title.json';
import {createEvidenceAliases} from '../../server/evidenceAliases';
import {validateReply} from '../../server/validation';
import {validateMemoryValue} from '../../shared/coreValidation';
import type {AssistantReply,AtomicValue,ChatRequest,ExternalEvidence,MemoryPatch} from '../../shared/types';
const request=fixture.request as ChatRequest,sources=fixture.sources as ExternalEvidence[];
function decoded(index:number){const raw=fixture.attempts[index];expect(createHash('sha256').update(raw.outputText).digest('hex')).toBe(raw.sha256);const codec=createEvidenceAliases(sources);expect(codec.metadata.sourceAliases).toEqual(raw.metadata.sourceAliases);const value=codec.resolveReply(JSON.parse(raw.outputText));delete value.memoryOperations;return value as unknown as AssistantReply;}
for(const index of [0,1])it(`accepts unchanged actual C10 generation${index+1} including both conflicting claims`,()=>{const raw=decoded(index);const result=validateReply(raw,request,sources);expect(result.externalClaims).toEqual(raw.externalClaims);expect(result.externalClaims).toHaveLength(2);expect(result.message).toBe(raw.message);});
it('retains guards outside the exact labelled title and for another title/source',()=>{
 for(const label of ['Страница «Годовой другой тариф»','Страница «Годовой тариф»; годовая оплата','Годовой тариф']){const raw=decoded(0);raw.externalClaims![0].text=raw.externalClaims![0].text.replace('Страница «Годовой тариф»',label);expect(()=>validateReply(raw,request,sources)).toThrow();}
 const other=sources.map(s=>({...s,title:'Другая страница'}));expect(()=>validateReply(decoded(0),request,other)).toThrow();
});
it('applies the same exact-owned-title rule to an atomic observation without changing its text',()=>{
 const raw=decoded(0);const claim=raw.externalClaims![0];const value:AtomicValue={kind:'decision',key:'tariff',scope:{subject:'external_entity',entityId:'tariff-page',area:'project',stageId:null,scenario:null},text:claim.text,origin:'external',epistemic:'observed',acceptance:'proposed',sources:[{type:'external',evidenceId:claim.evidenceId,version:claim.version,quoteId:claim.quoteId}],dependsOn:[]};
 const patch={projectId:request.projectId} as MemoryPatch;const core=request.coreContext!;
 expect(()=>validateMemoryValue(value,core,patch,sources)).not.toThrow();
 for(const text of [value.text+' Годовая оплата.',value.text.replace('Годовой тариф','Годовой другой тариф')])expect(()=>validateMemoryValue({...value,text},core,patch,sources)).toThrow();
 expect(()=>validateMemoryValue(value,core,patch,sources.map(s=>({...s,title:'Другая страница'})))).toThrow();
 expect(()=>validateMemoryValue(value,core,patch,sources.map(s=>({...s,projectId:'foreign'})))).toThrow();
});
