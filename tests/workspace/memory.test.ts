import { expect, it } from 'vitest';
import { createProject, saveArtifact } from '../../shared/domain';
import { collectMemories } from '../../shared/memory';
import { parseWorkspace, serializeWorkspace } from '../../shared/validation';
import { applyAnswer } from '../../src/features/workspace/answerRequests';
import type { AssistantReply, ChatRequest, Project } from '../../shared/types';

const reply: AssistantReply = {message:'Учту.',choices:[],artifactDraft:null,proposedFacts:[],memory:{facts:[{text:'Пицца для офисов.',evidence:'Пицца для офисов'}],hypotheses:[],openQuestions:['Кто принимает решение?']}};
const request = (projectId: string, requestId = 'request-memory'): ChatRequest => ({requestId, projectId, moduleId:'idea',intent:'message',message:'Пицца для офисов',context:{name:'Пицца',description:'',facts:[],artifacts:[],history:[]}});
function pending(project: Project, request: ChatRequest, id = request.requestId) {
  project.modules.idea.messages.push({ id, role: 'user', content: request.message, createdAt: new Date().toISOString(), request, requestId: request.requestId, status: 'pending' });
}

it('persists automatic memory, keeps final artifacts, and supplies it to another stage', () => {
  const before = saveArtifact(createProject(), 'idea', {title:'Идея',body:'Сохранённый итог'});
  pending(before, request(before.id));
  const updated = applyAnswer(before, request(before.id), reply);
  expect(updated.modules.idea.artifact).toEqual(before.modules.idea.artifact);
  expect(updated.modules.idea.memory?.content).toEqual(reply.memory);
  const restored = parseWorkspace(serializeWorkspace({version:1,activeProjectId:updated.id,projects:[updated]})).projects[0];
  restored.activeModule = 'audience';
  expect(collectMemories(restored)[0]).toMatchObject({moduleId:'idea',content:reply.memory});
  expect(applyAnswer(updated, request(before.id), reply)).toBe(updated);
});

it('does not replace newer memory when editing or regenerating earlier answers', () => {
  let project = createProject();
  const oldRequest = request(project.id);
  pending(project, oldRequest, 'user-old');
  project = applyAnswer(project, oldRequest, reply);
  const oldAnswer = project.modules.idea.messages[1];
  pending(project, request(project.id, 'request-newer'));
  project = applyAnswer(project, request(project.id, 'request-newer'), {...reply,memory:{facts:[],hypotheses:[],openQuestions:['Последний вопрос']}});
  const current = project.modules.idea.memory;
  const regenerated = applyAnswer(project, request(project.id,'request-regen'), reply, oldAnswer.id);
  expect(regenerated.modules.idea.memory).toEqual(current);
  const edited = applyAnswer(project, request(project.id,'request-edit'), reply, oldAnswer.id, 'user-old');
  expect(edited.modules.idea.memory).toEqual({...current,needsRefresh:true});
  pending(edited, request(project.id, 'request-refresh'));
  const refreshed = applyAnswer(edited, request(project.id,'request-refresh'), reply);
  expect(refreshed.modules.idea.memory?.needsRefresh).toBeUndefined();
});

it('accepts existing backups without memory and limits aggregate memory with active stage first', () => {
  const project = createProject();
  const restored = parseWorkspace(serializeWorkspace({version:1,activeProjectId:project.id,projects:[project]}));
  expect(restored.projects[0].modules.idea.memory).toBeUndefined();
  for (const state of Object.values(project.modules)) state.memory = { updatedAt:'2026-11-15T09:00:00Z',content:{facts:Array.from({length:6},()=>({text:'я'.repeat(200),evidence:'а'.repeat(240)})),hypotheses:[],openQuestions:[]} };
  project.activeModule='mvp';
  const collected = collectMemories(project);
  expect(collected[0].moduleId).toBe('mvp');
  expect(collected.length).toBeLessThan(14);
  expect(collected.reduce((sum,item)=>sum+JSON.stringify(item).length,0)).toBeLessThanOrEqual(14_000);
});
