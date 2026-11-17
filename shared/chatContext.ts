import { MODULES } from './modules.js';
import type { ChatRequest, ModuleId, Project } from './types.js';

// A restarted chat keeps its prerequisites, but must not recover the discarded
// idea from older downstream or unrelated conversations. Their local work stays.
export function allowsChatContext(project: Project, source: ModuleId, updatedAt?: string, target = project.activeModule): boolean {
  const resetAt = project.modules[target].resetAt;
  if (!resetAt || source === target) return true;
  const ancestors = new Set<ModuleId>();
  const visit = (id: ModuleId) => {
    for (const dependency of MODULES[id].dependencies) {
      if (ancestors.has(dependency)) continue;
      ancestors.add(dependency);
      visit(dependency);
    }
  };
  visit(target);
  return ancestors.has(source) || Boolean(updatedAt && Date.parse(updatedAt) > Date.parse(resetAt));
}

export function collectArtifacts(project: Project, target = project.activeModule): ChatRequest['context']['artifacts'] {
  return Object.entries(project.modules).flatMap<ChatRequest['context']['artifacts'][number]>(([id, state]) => {
    const moduleId = id as ModuleId;
    const artifact = state.artifact;
    const draft = state.proposal?.artifactDraft;
    const draftMessage = state.messages.findLast(message => message.role === 'assistant' && message.reply?.artifactDraft?.body === draft?.body);
    const draftAt = draftMessage?.createdAt ?? state.memory?.updatedAt;
    if (moduleId !== target && draft && (!artifact || Boolean(draftAt && draftAt > artifact.savedAt))) {
      return allowsChatContext(project, moduleId, draftAt, target)
        ? [{ moduleId, title: draft.title, body: draft.body, stale: Boolean(state.memory?.needsRefresh), provenance: 'assistant_proposal' as const }]
        : [];
    }
    return artifact && allowsChatContext(project, moduleId, artifact.savedAt, target)
      ? [{ moduleId, title: artifact.title, body: artifact.body, stale: artifact.stale }]
      : [];
  });
}

// A proposed result is assistant material, separate from saved artifacts and
// accepted memory. Preserve its full text for follow-up discussion, without
// borrowing another stage's proposal or mutating a stored request snapshot.
export function collectCurrentDraft(project: Project, target = project.activeModule): ChatRequest['context']['currentDraft'] {
  const draft = project.modules[target].proposal?.artifactDraft;
  return draft ? { title: draft.title, body: draft.body } : undefined;
}

// Legacy values are retained in storage; a versioned accepted decision with the
// same project-wide key supersedes their use as an active prompt input.
export function collectProjectFacts(project: Project): ChatRequest['context']['facts'] {
  const latest = new Map<string, import('./types.js').AtomicEntry>();
  for (const entry of project.core?.entries ?? []) if ((latest.get(entry.id)?.version ?? 0) < entry.version) latest.set(entry.id, entry);
  const replaced = new Set([...latest.values()].filter(entry => entry.acceptance === 'accepted' && entry.scope.subject === 'our_project' && entry.scope.area === 'project').map(entry => entry.key));
  return Object.values(project.facts).filter(fact => !replaced.has(fact.key));
}
