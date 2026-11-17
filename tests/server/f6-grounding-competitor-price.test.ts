import {expect,it} from 'vitest';
import fixture from './fixtures/grounding/targeted-02-own-price.json';
import {validateReply,ReplyValidationError} from '../../server/validation';
import {applyMemoryPatch,getCurrentEntries} from '../../shared/coreMemory';
import type {AssistantReply,ChatRequest,Project} from '../../shared/types';
const request=fixture.request as unknown as ChatRequest;
function raw(){
 const reply=structuredClone(fixture.response.reply) as AssistantReply & {knowledgeSources?:unknown};
 // HTTP decoration is attached by the app after validateReply, never by the model.
 delete reply.knowledgeSources;
 return reply;
}
it('rejects the unchanged accepted targeted02 own-price iteration3 with the explicit competitor price rule',()=>{
 const reply=raw();const project=structuredClone(fixture.stateBefore) as Project;
 const before=JSON.stringify(project);
 let error:unknown;try{validateReply(reply,request);}catch(caught){error=caught;}
 expect(error).toBeInstanceOf(ReplyValidationError);
 expect((error as ReplyValidationError).validationIssue).toEqual({path:['memoryPatch','operations',0,'value','scope','subject'],rule:'competitor_metric_requires_external_entity'});
 expect(()=>applyMemoryPatch(project,reply.memoryPatch!)).toThrow();
 expect(JSON.stringify(project)).toBe(before);
});
for(const key of ['competitor_average_price','competitors_average_price','competitor_avg_price','competitor_avg_check']) it(`keeps explicit ${key} external without inventing a unit or changing our price`,()=>{
 const reply=raw();const atom=reply.memoryPatch!.operations[0].value;
 atom.key=key;
 expect(()=>validateReply(reply,request)).toThrow();
 atom.scope={...atom.scope,subject:'external_entity',entityId:'unidentified-competitor-group'};
 const validated=validateReply(reply,request);
 expect(validated.memoryPatch!.operations[0].value).toMatchObject({kind:'unknown',epistemic:'unknown',acceptance:'unresolved',text:atom.text});
 const project=structuredClone(fixture.stateBefore) as Project;
 const ownPrice=(p:Project)=>getCurrentEntries(p.core!).filter(entry=>entry.key==='price'&&entry.scope.subject==='our_project');
 const before=ownPrice(project);
 expect(before).toHaveLength(1);
 const next=applyMemoryPatch(project,validated.memoryPatch!);
 expect(ownPrice(next)).toEqual(before);
 expect(getCurrentEntries(next.core!).find(entry=>entry.key===key&&entry.scope.subject==='external_entity')).toMatchObject({kind:'unknown',epistemic:'unknown',acceptance:'unresolved'});
});
