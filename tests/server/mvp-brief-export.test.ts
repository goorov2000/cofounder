import { expect, test } from 'vitest';
import { loadConfig } from '../../server/config';
import { OpenAIProvider, requestsMvpBrief } from '../../server/provider';
import { createProject } from '../../shared/domain';
import { collectCurrentDraft } from '../../shared/chatContext';
import { mvpToMarkdown } from '../../shared/exports';
import { parseWorkspace, serializeWorkspace } from '../../shared/validation';
import { applyAnswer } from '../../src/features/workspace/answerRequests';
import { makeRequest } from '../acceptance/fixtures';

test('brief snapshots require an explicit document request, rather than an ordinary question about a brief',()=>{
 const r={moduleId:'mvp' as const,intent:'message' as const,message:'Что ещё уточнить в брифе?'};
 expect(requestsMvpBrief(r)).toBe(false);
 expect(requestsMvpBrief({...r,message:'Обнови бриф для разработчика.'})).toBe(true);
 expect(requestsMvpBrief({...r,moduleId:'idea',message:'Подготовь бриф.'})).toBe(false);
});

test('explicit developer brief is visible once and automatically available to export and follow-up without a manual card',async()=>{
 const message='## Сценарии\n'+('Сотрудник предлагает обмен; коллега соглашается; управляющий утверждает.\n'.repeat(170)).trimEnd();
 const seed=makeRequest(createProject(),'mvp','Собери подробный бриф для внешнего разработчика.');
 let calls=0;
 const provider=new OpenAIProvider(loadConfig({OPENAI_API_KEY:'synthetic-placeholder',OPENAI_MODEL:'gpt-6.1-sol'}),{transport:async()=>({status:'completed',error:null,output:[],output_text:JSON.stringify(++calls===1?{action:'answer',query:''}:{message,choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[]}),usage:{input_tokens:100,output_tokens:100}}) as never});
 const result=await provider.complete(seed.request,new AbortController().signal);
 expect(result.reply.message).toBe(message);
 expect(result.reply.artifactDraft?.body).toBe(message);
 expect(calls).toBe(2);
 const saved=applyAnswer(seed.project,seed.request,result.reply);
 expect(saved.modules.mvp.artifact).toBeNull();
 expect(collectCurrentDraft(saved,'mvp')?.body).toBe(message);
 expect(mvpToMarkdown(saved)).toContain(message);
 const restored=parseWorkspace(serializeWorkspace({version:1,activeProjectId:saved.id,projects:[saved]})).projects[0];
 expect(collectCurrentDraft(restored,'mvp')?.body).toBe(message);
 expect(mvpToMarkdown(restored)).toContain(message);
});
