import {expect,it} from 'vitest';
import cases from './fixtures/grounding/control-final-01.json';
import {validateReply,ReplyValidationError} from '../../server/validation';
import {CoreMemoryError,validateMemoryValue} from '../../shared/coreValidation';
import type {ChatRequest,ExternalEvidence,MemoryPatch} from '../../shared/types';
function replay(fixture:typeof cases[number]) {
 const request=fixture.request as unknown as ChatRequest;
 const raw=structuredClone(fixture.raw) as Record<string,unknown>;
 const operations=raw.memoryOperations;delete raw.memoryOperations;
 raw.proposedFacts=(raw.proposedFacts as Record<string,unknown>[]).map(fact=>Object.fromEntries(Object.entries(fact).filter(([key,value])=>!(['sourceUrl','checkedAt'].includes(key)&&value===null))));
 const core=request.coreContext!;
 raw.memoryPatch={schemaVersion:1,projectId:request.projectId,moduleId:request.moduleId,generation:core.generation,requestId:request.requestId,baseMemoryVersion:core.revision,baseContextVersion:core.contextVersion,sourceMessage:core.sourceMessage,operations};
 raw.externalSources=fixture.evidence;
 return {request,raw,evidence:fixture.evidence as ExternalEvidence[]};
}
it('K04 preserves claims and operations, distinguishing the corrected brand rule from its independent URL typo',()=>{
 const {request,raw,evidence}=replay(cases.find(item=>item.id==='K04')!);
 // This is the complete unchanged failed control output. After the false
 // title mismatch is fixed it still correctly fails an independent URL guard.
 let error:unknown;try{validateReply(raw,request,evidence);}catch(caught){error=caught;}
 expect(error).toBeInstanceOf(ReplyValidationError);
 expect((error as ReplyValidationError).validationIssue).toEqual({path:['artifactDraft','body'],rule:'unprovided_url'});
 const claims=structuredClone(raw.externalClaims), operations=structuredClone((raw.memoryPatch as MemoryPatch).operations);
 // Test-only minimal valid variant copies the exact URL of the same actual
 // read, with no mutation of the fixed raw fixture or claim/operation removal.
 const actual=evidence.find(source=>source.url.includes('/rabota_s_bek_ofisom/'))!;
 const draft=raw.artifactDraft as {title:string;body:string};
 draft.body=draft.body.replace('https://quickresto.ru/support/rabota_s_bek_offisom/personal/grafik_raboty/',actual.url);
 const reply=validateReply(raw,request,evidence);
 expect(reply.externalClaims).toEqual(claims);
 expect(reply.memoryPatch!.operations).toEqual(operations);
 expect(reply.message).toBe(raw.message);
});
it('reports the stable competitor role invariant through both validation boundaries without mutation',()=>{
 const {request,raw,evidence}=replay(cases.find(item=>item.requestId==='abef394f-bbf9-4148-81b9-dc9eea16af7d')!);
 const before=JSON.stringify({request,raw,evidence});
 let error:unknown;try{validateReply(raw,request,evidence);}catch(caught){error=caught;}
 expect(error).toBeInstanceOf(ReplyValidationError);
 expect((error as ReplyValidationError).validationIssue).toEqual({path:['memoryPatch','operations',0,'value','scope','subject'],rule:'competitor_metric_requires_external_entity'});
 const patch=raw.memoryPatch as MemoryPatch;
 try{validateMemoryValue(patch.operations[0].value,request.coreContext!,patch,evidence);throw new Error('Expected invalid scope');}
 catch(caught){expect(caught).toBeInstanceOf(CoreMemoryError);expect((caught as CoreMemoryError & {validationRule:string}).validationRule).toBe('competitor_metric_requires_external_entity');}
 expect(JSON.stringify({request,raw,evidence})).toBe(before);
});

it('reports the original K04 quote-scope and independent URL errors in the same bounded repair feedback',()=>{
 const {request,raw,evidence}=replay(cases.find(item=>item.id==='K04-first-generation')!);
 const before=JSON.stringify(raw);
 let error:unknown;try{validateReply(raw,request,evidence);}catch(caught){error=caught;}
 expect(error).toBeInstanceOf(ReplyValidationError);
 expect((error as ReplyValidationError).validationIssue).toEqual({
  path:['externalClaims',3,'text'],rule:'ungrounded_quantity',
  relatedIssues:[{path:['artifactDraft','body'],rule:'unprovided_url'}],
 });
 expect(JSON.stringify(raw)).toBe(before);
});

it('bounds independent errors to ten safe records and leaves control characters a strict initial failure',()=>{
 const {request,raw,evidence}=replay(cases.find(item=>item.id==='K04')!);
 const claim=(raw.externalClaims as Record<string,unknown>[])[0];
 raw.externalClaims=Array.from({length:20},()=>({...claim,text:'Тариф 999999 RUB'}));
 let error:unknown;try{validateReply(raw,request,evidence);}catch(caught){error=caught;}
 const diagnostic=(error as ReplyValidationError).validationIssue;
 expect(diagnostic.relatedIssues).toHaveLength(9);
 for(const issue of [diagnostic,...diagnostic.relatedIssues!]){
  expect(issue.rule).toBe('ungrounded_quantity');
  expect(issue.path.slice(0,1)).toEqual(['externalClaims']);
 }
 raw.message='invalid\u0000';
 try{validateReply(raw,request,evidence);}catch(caught){error=caught;}
 expect((error as ReplyValidationError).validationIssue).toEqual({path:['message'],rule:'invalid_control_character'});
});

it('propagates unexpected errors rather than turning them into model repair feedback',()=>{
 const {request,raw,evidence}=replay(cases.find(item=>item.id==='K04')!);
 raw.externalSources=[];
 const unexpected=new Error('unexpected tool boundary');
 const broken=new Proxy(evidence,{get(target,key){if(key==='find')return ()=>{throw unexpected;};return Reflect.get(target,key);}});
 expect(()=>validateReply(raw,request,broken)).toThrow(unexpected);
});
