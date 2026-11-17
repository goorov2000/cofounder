import type { AssistantReply, ChatRequest, Message, ModuleId, Project } from '../../../shared/types';
import { collectArtifacts } from '../../../shared/chatContext';
import { applyMemoryPatch, archiveMessage, buildCoreContext, invalidateEditedSource } from '../../../shared/coreMemory';
import { memoryConflict, validatePatchEnvelope } from '../../../shared/coreValidation';
import { coverageBasis, isTopicComplete } from '../../../shared/coverage';
import { getUnlockedStages } from '../../../shared/domain';
import { syncCalculation } from '../../../shared/calculationScenario';

export function createRegenerationRequest(project: Project, moduleId: ModuleId, message: Message): ChatRequest | null {
  if (message.request) return { ...structuredClone(message.request), requestId: crypto.randomUUID(), projectId: project.id, moduleId };
  // Legacy conversations predate request snapshots. Reconstruct only history before that question.
  const messages = project.modules[moduleId].messages;
  const index = messages.findIndex(item => item.id === message.id);
  const questionIndex = messages.slice(0, index).findLastIndex(item => item.role === 'user');
  if (questionIndex < 0) return null;
  const question = messages[questionIndex];
  return {
    requestId: crypto.randomUUID(), projectId: project.id, moduleId, intent: 'message', message: question.content.slice(0, 8000),
    context: { name: project.name, description: project.description, facts: Object.values(project.facts),
      artifacts: collectArtifacts(project, moduleId),
      history: messages.slice(0, questionIndex).filter(item => item.role === 'assistant' || (item.status !== 'failed' && item.status !== 'pending')).slice(-40).map(item => ({ role: item.role, content: item.content.slice(0, 8000) })),
    },
  };
}

export function findAnswer(messages: Message[], userId: string): Message | undefined {
  const index = messages.findIndex(message => message.id === userId && message.role === 'user');
  // A later user's answer must never be attached to an unanswered message.
  const next = index >= 0 ? messages[index + 1] : undefined;
  return next?.role === 'assistant' ? next : undefined;
}

export function applyAnswer(project: Project, request: ChatRequest, reply: AssistantReply, replaceMessageId?: string, editMessageId?: string): Project {
  if (project.id !== request.projectId) memoryConflict();
  const unlockedStages = getUnlockedStages(project);
  let state = project.modules[request.moduleId];
  // A reply arriving after a restart must not recreate the deleted conversation.
  if (!replaceMessageId && !state.messages.some(message => message.role === 'user' && message.requestId === request.requestId)) return project;
  if (state.messages.some(message => message.role === 'assistant' && message.requestId === request.requestId)) return project;
  const previous = state.messages.find(message => message.id === replaceMessageId);
  if ((replaceMessageId && !previous) || (editMessageId && !state.messages.some(message => message.id === editMessageId))) return project;
  if (request.coreContext) {
    const context = request.coreContext;
    if (context.projectId !== project.id || context.moduleId !== request.moduleId || context.generation !== (state.generation ?? 0) || context.revision !== project.core?.revision || context.contextVersion !== project.core?.contextVersion) memoryConflict();
  }
  if (request.coreContext && editMessageId) {
    const original = state.messages.find(message => message.id === editMessageId)!;
    if (request.coreContext.sourceMessage.messageId !== original.id || request.coreContext.sourceMessage.revision !== (original.revision ?? 1) + 1) memoryConflict();
    const oldVersion = project.core!.contextVersion;
    project = archiveMessage(project, request.moduleId, original);
    project = archiveMessage(project, request.moduleId, { ...original, revision: request.coreContext.sourceMessage.revision, content: request.message });
    project = { ...project, core: { ...project.core!, contextVersion: oldVersion } };
  }
  if (reply.memoryPatch) {
    validatePatchEnvelope(reply.memoryPatch, request);
    project = applyMemoryPatch(project, reply.memoryPatch, reply.externalSources, reply.recoveredSourceRefs);
    state = project.modules[request.moduleId];
  }
  const answer: Message = {
    id: previous?.id ?? crypto.randomUUID(), revision: previous ? (previous.revision ?? 1) + 1 : 1, role: 'assistant', content: reply.message, createdAt: new Date().toISOString(),
    choices: reply.choices, choiceConsumed: previous?.choiceConsumed, reply, request, requestId: request.requestId, status: 'sent',
  };
  const lastAnswer = state.messages.findLast(message => message.role === 'assistant');
  const messages = replaceMessageId
    ? state.messages.map(message => message.id === replaceMessageId ? answer : message.id === editMessageId
      ? { ...message, revision: (message.revision ?? 1) + 1, content: request.message, status: 'sent' as const, requestId: request.requestId, request: undefined, requestError: undefined, replacesAnswerId: undefined }
      : message)
    : [...state.messages.map(message => message.requestId === request.requestId ? { ...message, status: 'sent' as const, request: undefined, requestError: undefined } : message), answer];
  // An older edited turn must not replace newer memory. Mark it for refresh on
  // the next regular answer; failed requests never reach this application step.
  const isLatest = !replaceMessageId || lastAnswer?.id === replaceMessageId;
  const memory = isLatest && reply.memory
    ? { content: reply.memory, updatedAt: answer.createdAt }
    : editMessageId && state.memory ? { ...state.memory, needsRefresh: true } : state.memory;
  const result = { ...project, modules: { ...project.modules, [request.moduleId]: {
    ...state, messages, memory,
    proposal: isLatest ? { ...reply, artifactDraft: reply.artifactDraft ?? state.proposal?.artifactDraft ?? null } : state.proposal,
  } } };
  let archived = request.coreContext ? archiveMessage(result, request.moduleId, answer) : result;
  if (editMessageId && request.coreContext) archived = invalidateEditedSource(archived, request.moduleId, editMessageId, request.coreContext.sourceMessage.revision);
  if (isLatest) archived = syncCalculation(archived, request, reply);
  if (isLatest && (reply.memory?.coverage || reply.memory?.review) && archived.modules[request.moduleId].memory) {
    archived.modules[request.moduleId] = { ...archived.modules[request.moduleId], memory: { ...archived.modules[request.moduleId].memory!, coverageBasis: coverageBasis(archived, request.moduleId) } };
  }
  if (isLatest && isTopicComplete(archived, request.moduleId)) {
    archived.modules[request.moduleId] = { ...archived.modules[request.moduleId], completedAt: archived.modules[request.moduleId].completedAt ?? answer.createdAt };
  }
  return { ...archived, unlockedStages: getUnlockedStages({ ...archived, unlockedStages }) };
}

// Bind fresh operations to current memory while preserving the historical
// conversational request snapshot. A proposed edit lives only in the request
// until the complete answer passes validation.
export function bindCoreRequest(project: Project, request: ChatRequest, source: Message, editedText?: string): { project: Project; request: ChatRequest } {
  const archived = archiveMessage(project, request.moduleId, source);
  const coreContext = buildCoreContext(archived, request.moduleId, source.id);
  if (editedText !== undefined) {
    coreContext.sourceMessage = { messageId: source.id, revision: (source.revision ?? 1) + 1 };
    coreContext.sourceMessages = [...coreContext.sourceMessages, { projectId: project.id, moduleId: request.moduleId, generation: coreContext.generation, messageId: source.id, revision: coreContext.sourceMessage.revision, role: 'user', content: editedText, createdAt: source.createdAt }];
  }
  return { project: archived, request: { ...request, message: editedText ?? request.message, contractVersion: 2, coreContext } };
}
