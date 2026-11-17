import { createProject } from '../../shared/domain';
import type { ChatRequest, Message, Workspace } from '../../shared/types';

/** Twelve exact history snapshots reproduce growth from ordinary saved requests. */
export function largePendingWorkspace(): { workspace: Workspace; pending: ChatRequest } {
  const project = createProject();
  const history = Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `${index}: ` + 'Контекст обсуждённого проекта. '.repeat(170).slice(0, 4396) }));
  const request = (index: number): ChatRequest => ({ requestId: `large-request-${index}`, projectId: project.id, moduleId: 'idea', intent: 'message', message: index === 11 ? 'Готовая футболка 2500, нанесение принта 1500, суммы примерные.' : `Вопрос ${index}`, context: { name: project.name, description: '', facts: [], artifacts: [], history } });
  const messages: Message[] = [];
  for (let index = 0; index < 11; index++) {
    const snapshot = request(index);
    messages.push({ id: `user-${index}`, role: 'user', content: snapshot.message, createdAt: project.createdAt, status: 'sent', requestId: snapshot.requestId });
    messages.push({ id: `assistant-${index}`, role: 'assistant', content: `Обсудили вводные ${index}.`, createdAt: project.createdAt, status: 'sent', requestId: snapshot.requestId, request: snapshot });
  }
  const pending = request(11);
  messages.push({ id: 'pending-user', role: 'user', content: pending.message, createdAt: project.createdAt, status: 'pending', requestId: pending.requestId, request: pending });
  project.modules.idea.messages = messages;
  return { workspace: { version: 1, activeProjectId: project.id, projects: [project] }, pending };
}
