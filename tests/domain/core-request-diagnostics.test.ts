import {expect,it} from 'vitest';
import {createProject} from '../../shared/domain';
import {archiveMessage,buildCoreContext} from '../../shared/coreMemory';
import {diagnoseCoreRequest,validCoreRequest,validateCoreOwnership} from '../../shared/coreValidation';
import type {ChatRequest} from '../../shared/types';
type Input=Pick<ChatRequest,'projectId'|'moduleId'|'message'|'contractVersion'|'coreContext'>;
function request():Input {
 const p=archiveMessage(createProject(),'idea',{id:'private-source-identifier',role:'user',content:'private furniture draft',createdAt:'2026-11-15T00:00:00.000Z'});
 return {projectId:p.id,moduleId:'idea',message:'private furniture draft',contractVersion:2,coreContext:buildCoreContext(p,'idea','private-source-identifier')};
}
// Frozen pre-diagnostic predicate: prove the refactor preserves every original branch.
function prior(r:Input):boolean {
 const c=r.coreContext;if(!c)return r.contractVersion===undefined;
 if(r.contractVersion!==2||c.projectId!==r.projectId||c.moduleId!==r.moduleId)return false;
 try{validateCoreOwnership(c,r.projectId);}catch{return false;}
 const source=c.sourceMessages.find(s=>s.moduleId===r.moduleId&&s.generation===c.generation&&s.messageId===c.sourceMessage.messageId&&s.revision===c.sourceMessage.revision);
 if(!source||source.role!=='user'||source.content!==r.message||c.sourceMessages.some(s=>s.moduleId===source.moduleId&&s.generation===source.generation&&s.messageId===source.messageId&&s.revision>source.revision))return false;
 const latest=new Map<string,number>();for(const e of c.entries)latest.set(e.id,Math.max(latest.get(e.id)??0,e.version));
 return c.currentEntryRefs.length===latest.size&&new Set(c.currentEntryRefs.map(e=>e.id)).size===latest.size&&c.currentEntryRefs.every(e=>latest.get(e.id)===e.version);
}
it('preserves legacy acceptance and every core guard while returning safe field diagnostics',()=>{
 const cases:Array<{change:(r:Input)=>void;rule?:string;path?:string[]}>= [
  {change:()=>{}},
  {change:r=>{delete r.coreContext;delete r.contractVersion;}},
  {change:r=>{delete r.coreContext;},rule:'missing_core_context',path:['coreContext']},
  {change:r=>{delete r.contractVersion;},rule:'invalid_contract_version',path:['contractVersion']},
  {change:r=>{r.projectId='private-other-project';},rule:'core_scope_mismatch',path:['coreContext']},
  {change:r=>{r.moduleId='audience';},rule:'core_scope_mismatch',path:['coreContext']},
  {change:r=>{r.coreContext!.sourceMessages[0].projectId='private-foreign-source';},rule:'invalid_core_ownership',path:['coreContext']},
  {change:r=>{r.coreContext!.sourceMessages.push({...r.coreContext!.sourceMessages[0]});},rule:'invalid_core_ownership',path:['coreContext']},
  {change:r=>{r.coreContext!.sourceMessages=[];},rule:'current_source_missing',path:['coreContext','sourceMessage']},
  {change:r=>{r.coreContext!.sourceMessages[0].role='assistant';},rule:'current_source_not_user',path:['coreContext','sourceMessage']},
  {change:r=>{r.message='private changed message';},rule:'current_source_text_mismatch',path:['coreContext','sourceMessage']},
  {change:r=>{const c=r.coreContext!;c.sourceMessages.push({...c.sourceMessages[0],revision:c.sourceMessage.revision+1});},rule:'current_source_superseded',path:['coreContext','sourceMessage']},
  {change:r=>{r.coreContext!.currentEntryRefs=[{id:'private-entry',version:9}];},rule:'current_entry_refs_mismatch',path:['coreContext','currentEntryRefs']},
 ];
 for(const c of cases){const r=request();c.change(r);const snapshot=structuredClone(r),issue=diagnoseCoreRequest(r);expect(validCoreRequest(r)).toBe(prior(r));expect(validCoreRequest(r)).toBe(c.rule===undefined);expect(issue).toEqual(c.rule?{rule:c.rule,path:c.path}:undefined);expect(r).toEqual(snapshot);expect(JSON.stringify(issue)??'').not.toMatch(/private-|furniture|draft/);}
});
