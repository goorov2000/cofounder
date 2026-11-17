import {expect,it} from 'vitest';
import {attachHistorySources} from '../../server/historySources';
import {validateReply} from '../../server/validation';
import {createProject} from '../../shared/domain';
import {archiveMessage,buildCoreContext,importProjectCopy} from '../../shared/coreMemory';
import type {AssistantReply,ChatRequest} from '../../shared/types';
function setup(){
 let project=createProject();
 const source={id:'history-original',revision:2,role:'user' as const,content:'Мы выбрали подписку. Полный исходный текст <script>alert(1)</script>.',createdAt:project.createdAt};
 project=archiveMessage(project,'business',source);
 const current={id:'history-current',revision:1,role:'user' as const,content:'Напомни решение',createdAt:project.createdAt};
 project=archiveMessage(project,'idea',current);
 const request:ChatRequest={contractVersion:2,requestId:'history-request',projectId:project.id,moduleId:'idea',intent:'message',message:current.content,coreContext:buildCoreContext(project,'idea',current.id),context:{name:'Тест',description:'',facts:[],artifacts:[],history:[]}};
 const reply:AssistantReply={message:'Ранее вы сказали: «Мы выбрали подписку».',choices:[],artifactDraft:null,proposedFacts:[]};
 return {project,request,reply};
}
it('derives full immutable historical original, overwrites model field and survives source mutation',()=>{
 const {request,reply}=setup();reply.historySources=[{source:request.coreContext!.sourceMessages[1],quotes:['forged']}];
 const enriched=attachHistorySources(request,reply);expect(validateReply(enriched,request).historySources).toEqual(enriched.historySources);
 expect(enriched.historySources![0].source).toEqual(request.coreContext!.sourceMessages[0]);
 request.coreContext!.sourceMessages[0].content='изменено';expect(enriched.historySources![0].source.content).toContain('<script>');
});
it('uses literal quoted visible text only, excludes current question and fails closed for word substrings',()=>{
 const {request,reply}=setup();
 for(const message of ['Мы выбрали подписку','«подпис»','«Напомни решение»','«Мы предпочли подписку»'])expect(attachHistorySources(request,{...reply,message}).historySources).toBeUndefined();
 expect(attachHistorySources(request,{...reply,message:'Готово',artifactDraft:{title:'Итог',body:'«Мы выбрали подписку»'}}).historySources).toHaveLength(1);
});
it('discloses every exact collision; rejects forged snapshot, revision, quote and omitted ambiguous original',()=>{
 const {request,reply}=setup();const original=request.coreContext!.sourceMessages[0];request.coreContext!.sourceMessages.push({...original,messageId:'other-original',revision:1});
 const enriched=attachHistorySources(request,reply);expect(enriched.historySources).toHaveLength(2);
 for(const mutate of [(r:AssistantReply)=>r.historySources!.pop(),(r:AssistantReply)=>r.historySources![0].source.projectId='foreign',(r:AssistantReply)=>r.historySources![0].source.revision++,(r:AssistantReply)=>r.historySources![0].quotes[0]='придумано',(r:AssistantReply)=>r.historySources![0].source.content+=' forged']){
  const forged=structuredClone(enriched);mutate(forged);expect(()=>validateReply(forged,request)).toThrow();
 }
});
it('checks final byte limit after enrichment without truncating original snapshots',()=>{
 const {request,reply}=setup();const original=request.coreContext!.sourceMessages[0];original.content+='я'.repeat(280000);
 for(let index=0;index<3;index++)request.coreContext!.sourceMessages.push({...original,messageId:`large-history-${index}`});
 const enriched=attachHistorySources(request,reply);expect(enriched.historySources![0].source.content).toBe(original.content);
 expect(()=>validateReply(enriched,request)).toThrowError(expect.objectContaining({validationIssue:{path:[],rule:'reply_byte_limit'}}));
});
it('import remaps archived reply provenance but preserves immutable request; later reset leaves original inspectable',()=>{
 const {project,request,reply}=setup();const enriched=attachHistorySources(request,reply);
 project.modules.idea.messages.push({id:'answer-history',role:'assistant',content:reply.message,createdAt:project.createdAt,reply:enriched,request});
 const copy=importProjectCopy(project,'copied-project');copy.core!.sourceMessages=[];
 const answer=copy.modules.idea.messages.find(m=>m.id==='answer-history')!;
 expect(answer.reply!.historySources![0].source.projectId).toBe(copy.id);
 expect(answer.reply!.historySources![0].source.content).toContain('Полный исходный текст');
 expect(answer.request).toEqual(request);expect(answer.request!.projectId).toBe(project.id);
});

it('leaves malformed visible fields to normal schema diagnostics without inventing metadata or throwing during enrichment',()=>{
 const {request,reply}=setup();
 for(const message of [undefined,null,123,{text:'«Мы выбрали подписку»'}]){
  const malformed={...reply,message} as unknown as AssistantReply;
  expect(()=>attachHistorySources(request,malformed)).not.toThrow();
  const enriched=attachHistorySources(request,malformed);
  expect(enriched.historySources).toBeUndefined();
  expect(enriched.message).toBe(message);
  expect(()=>validateReply(enriched,request)).toThrowError(expect.objectContaining({validationIssue:{path:['message'],rule:'schema_invalid_type'}}));
 }
});
