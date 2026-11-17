import { expect, test } from 'vitest';
import { streamingMessageState } from '../../server/streamingMessage';
import { validateReply } from '../../server/validation';
import { responseJsonSchema, generationOutputLimit } from '../../server/provider';
import { loadConfig } from '../../server/config';
import { createProject } from '../../shared/domain';
import { parseWorkspace, serializeWorkspace } from '../../shared/validation';
import type { ChatRequest } from '../../shared/types';

const message='Подробный сценарий и проверяемые условия приёмки.\n'.repeat(260).trimEnd();
const request:ChatRequest={requestId:'long-brief-request',projectId:'long-brief-project',moduleId:'mvp',intent:'message',message:'Собери подробный бриф для разработчика.',context:{name:'Учебный проект',description:'',facts:[],artifacts:[],history:[]}};

test('a detailed brief longer than 10000 characters streams, validates and survives JSON export',()=>{
 expect(message.length).toBeGreaterThan(10000);
 const raw=JSON.stringify({message,choices:[],artifactDraft:null,proposedFacts:[]});
 const end=raw.indexOf(',"choices"');
 expect(streamingMessageState(raw.slice(0,end))).toEqual({text:message,complete:true});
 const reply=validateReply(JSON.parse(raw),request,[]);
 const p=createProject();p.modules.mvp.messages.push({id:'long-brief-answer',role:'assistant',content:reply.message,reply,createdAt:p.createdAt});
 const restored=parseWorkspace(serializeWorkspace({version:1,activeProjectId:p.id,projects:[p]}));
 expect(restored.projects[0].modules.mvp.messages[0].content).toBe(message);
});

test('model schema, server validation and streaming enforce one finite message ceiling',()=>{
 const limit=(responseJsonSchema.properties.message as {maxLength:number}).maxLength;
 expect(limit).toBe(64000);
 expect(()=>streamingMessageState(JSON.stringify({message:'я'.repeat(limit+1)}))).toThrow();
 expect(()=>validateReply({message:'я'.repeat(limit+1),choices:[],artifactDraft:null,proposedFacts:[]},request,[])).toThrow();
 expect(()=>streamingMessageState('{"message":"\u0000"')).toThrow();
});

test('MVP can produce the final brief through the normal composer while explicit lower token limits remain binding',()=>{
 const config=loadConfig({});
 expect(generationOutputLimit(request,config)).toBe(16384);
 expect(generationOutputLimit({...request,moduleId:'idea'},config)).toBe(6144);
 expect(generationOutputLimit(request,{...config,maxOutputTokens:4096})).toBe(4096);
});
