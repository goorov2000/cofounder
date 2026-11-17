import {expect,it} from 'vitest';
import fixtures from './fixtures/grounding/targeted-03.json';
import {validateReply,ReplyValidationError} from '../../server/validation';
import type {AssistantReply,ChatRequest,ExternalEvidence,MemoryPatch} from '../../shared/types';
function replay(fixture:typeof fixtures[number]){
 const request=fixture.request as unknown as ChatRequest;
 const raw=structuredClone(fixture.raw??fixture.reply) as Record<string,unknown>;
 delete raw.knowledgeSources;
 if(fixture.raw){
  const operations=raw.memoryOperations;delete raw.memoryOperations;
  raw.proposedFacts=(raw.proposedFacts as Record<string,unknown>[]).map(f=>Object.fromEntries(Object.entries(f).filter(([k,v])=>!(['sourceUrl','checkedAt'].includes(k)&&v===null))));
  const c=request.coreContext!;
  raw.memoryPatch={schemaVersion:1,projectId:request.projectId,moduleId:request.moduleId,generation:c.generation,requestId:request.requestId,baseMemoryVersion:c.revision,baseContextVersion:c.contextVersion,sourceMessage:c.sourceMessage,operations};
  raw.externalSources=fixture.evidence;
 }
 return {request,raw:raw as unknown as AssistantReply,evidence:(fixture.evidence??[]) as ExternalEvidence[]};
}
for(const fixture of fixtures.filter(f=>f.id.startsWith('D13')))it(`accepts unchanged ${fixture.id} exact read-date metadata in claim and atom`,()=>{
 const {request,raw,evidence}=replay(fixture),before=JSON.stringify(raw);
 expect(validateReply(raw,request,evidence).memoryPatch!.operations).toEqual(raw.memoryPatch!.operations);
 expect(JSON.stringify(raw)).toBe(before);
});
it('rejects the exact competitor_average_ticket_evidence residual and repairs only its external scope',()=>{
 const {request,raw}=replay(fixtures.find(f=>f.id==='C03-own-price')!);
 let error:unknown;try{validateReply(raw,request);}catch(e){error=e;}
 expect((error as ReplyValidationError).validationIssue).toMatchObject({path:['memoryPatch','operations',0,'value','scope','subject'],rule:'competitor_metric_requires_external_entity'});
 const value=raw.memoryPatch!.operations[0].value;
 value.scope={...value.scope,subject:'external_entity',entityId:'unidentified-competitor-group'};
 expect(validateReply(raw,request).memoryPatch!.operations[0].value).toMatchObject({epistemic:'unknown',acceptance:'unresolved',text:value.text});
 // The explicit Russian phrase also works with a non-semantic key.
 value.key='benchmark';value.scope={...value.scope,subject:'our_project',entityId:null};
 expect(()=>validateReply(raw,request)).toThrow();
});
it('does not exempt a wrong read date, an effective date, another price, or uncited source metadata',()=>{
 const {request,raw,evidence}=replay(fixtures.find(f=>f.id==='D13-prepare')!);
 const original=structuredClone(raw);
 for(const wrong of ['2026-11-14','2026-01-11']){
  const changed=structuredClone(original);
  changed.memoryPatch!.operations[0].value.text=changed.memoryPatch!.operations[0].value.text.replace('прочитано 2026-11-15',`прочитано ${wrong}`);
  expect(()=>validateReply(changed,request,evidence)).toThrow();
 }
 const changed=structuredClone(original);
 changed.externalClaims![0].text=changed.externalClaims![0].text.replace('прочитана 2026-11-15','прочитана 2026-01-11');
 expect(()=>validateReply(changed,request,evidence)).toThrow();
 const value=raw.memoryPatch!.operations[0].value;
 value.text+=' Действует с 2026-11-15.';expect(()=>validateReply(raw,request,evidence)).toThrow();
 value.text=original.memoryPatch!.operations[0].value.text+' Цена 7777 RUB.';expect(()=>validateReply(raw,request,evidence)).toThrow();
 value.text=original.memoryPatch!.operations[0].value.text.replace('прочитано 2026-11-15','прочитано 2026-11-14');
 evidence[1].retrievedAt='2026-11-14T12:00:00Z';
 expect(()=>validateReply(raw,request,evidence)).toThrow();
 value.text=original.memoryPatch!.operations[0].value.text;evidence[0].projectId='other-project';
 expect(()=>validateReply(raw,request,evidence)).toThrow();
});
