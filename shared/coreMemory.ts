import type { AtomicEntry, AtomicValue, CoreContext, CoreMemory, Message, ModuleId, Project } from './types.js';
import { allowsChatContext } from './chatContext.js';
import { validateCoreOwnership, invalidMemory, validateAcceptedScopes } from './coreValidation.js';

export function getCurrentEntries(core: CoreMemory): AtomicEntry[] {
  const latest = new Map<string, AtomicEntry>();
  for (const entry of core.entries) if ((latest.get(entry.id)?.version ?? 0) < entry.version) latest.set(entry.id, entry);
  return [...latest.values()];
}
export function ensureCore(project: Project): Project {
  if (project.core) { validateCoreOwnership(project.core, project.id); return project; }
  const core: CoreMemory = { schemaVersion: 1, revision: 0, contextVersion: 0, entries: [], sourceMessages: [], evidence: [], appliedRequestIds: [] };
  for (const [index, fact] of Object.values(project.facts).entries()) {
    if (!fact.value.trim()) continue; // Empty legacy fields remain in facts; do not invent an atomic assertion.
    core.entries.push({
    id: `legacy-${index + 1}`, version: 1, previousVersion: null, createdAt: project.createdAt, requestId: null,
    kind: fact.provenance === 'unknown' ? 'unknown' : 'decision', key: fact.key, text: fact.value,
    scope: { subject: 'our_project', entityId: null, area: 'project', stageId: null, scenario: null },
    origin: 'legacy', epistemic: fact.provenance === 'hypothesis' ? 'hypothesis' : fact.provenance === 'unknown' ? 'unknown' : 'reported', acceptance: 'unresolved',
    sources: [{ type: 'legacy', label: `Унаследованное решение: ${fact.key} (${fact.provenance})`, quote: fact.value }], dependsOn: [],
    });
  }
  for (const [id, state] of Object.entries(project.modules)) for (const message of state.messages) core.sourceMessages.push({
    projectId: project.id, moduleId: id as ModuleId, generation: state.generation ?? 0,
    messageId: message.id, revision: message.revision ?? 1, role: message.role, content: message.content, createdAt: message.createdAt,
  });
  return { ...project, core };
}
export function archiveMessage(project: Project, moduleId: ModuleId, message: Message): Project {
  const next = ensureCore(project), core = next.core!;
  const record = { projectId: project.id, moduleId, generation: project.modules[moduleId].generation ?? 0, messageId: message.id, revision: message.revision ?? 1, role: message.role, content: message.content, createdAt: message.createdAt };
  const previous = core.sourceMessages.find(item => item.moduleId === moduleId && item.generation === record.generation && item.messageId === record.messageId && item.revision === record.revision);
  if (previous) {
    if (previous.content !== record.content || previous.role !== record.role) invalidMemory('Новая редакция сообщения должна получить новую версию.');
    return next;
  }
  return { ...next, core: { ...core, contextVersion: core.contextVersion + 1, sourceMessages: [...core.sourceMessages, record] } };
}
export function buildCoreContext(project: Project, moduleId: ModuleId, messageId: string): CoreContext {
  const next = ensureCore(project), core = next.core!, generation = next.modules[moduleId].generation ?? 0;
  const source = core.sourceMessages.filter(item => item.moduleId === moduleId && item.generation === generation && item.messageId === messageId).sort((a, b) => b.revision - a.revision)[0];
  if (!source || source.role !== 'user') invalidMemory('Исходное сообщение не сохранено в архиве.');
  const allowedMessage = (item: typeof source) => item.generation === (next.modules[item.moduleId].generation ?? 0) && allowsChatContext(next, item.moduleId, item.createdAt, moduleId);
  const allowedEvidence = (item: ExternalEvidence) => item.generation === (next.modules[item.moduleId].generation ?? 0) && allowsChatContext(next, item.moduleId, item.retrievedAt, moduleId);
  const current = getCurrentEntries(core).filter(entry => entry.sources.some(ref => {
    if (ref.type === 'legacy') return true;
    if (ref.type === 'external') return core.evidence.some(item => item.id === ref.evidenceId && item.version === ref.version && allowedEvidence(item));
    return core.sourceMessages.some(item => item.moduleId === ref.moduleId && item.generation === ref.generation && item.messageId === ref.messageId && item.revision === ref.revision && allowedMessage(item));
  }));
  const ids = new Set(current.map(entry => entry.id));
  const entries = core.entries.filter(entry => ids.has(entry.id));
  const references = entries.flatMap(entry => entry.sources);
  return structuredClone({ schemaVersion: 1, projectId: next.id, moduleId, generation, revision: core.revision, contextVersion: core.contextVersion, sourceMessage: { messageId, revision: source.revision },
    currentEntryRefs: current.map(({ id, version }) => ({ id, version })), entries,
    sourceMessages: core.sourceMessages.filter(item => allowedMessage(item) || references.some(ref => ref.type === 'message' && ref.moduleId === item.moduleId && ref.generation === item.generation && ref.messageId === item.messageId && ref.revision === item.revision)),
    evidence: core.evidence.filter(item => allowedEvidence(item) || references.some(ref => ref.type === 'external' && ref.evidenceId === item.id && ref.version === item.version)),
  });
}

import type { ExternalEvidence, MemoryPatch, VersionRef } from './types.js';
import { externalEvidenceSchema, memoryPatchSchema, memoryConflict, validateMemoryValue } from './coreValidation.js';
import { MODULES } from './modules.js';

export function invalidateCoreDependencies(project: Project, changed: VersionRef[], reason: string, sourceModule: ModuleId): Project {
  // Legacy materials lack precise atom references. A project-wide input can
  // affect their calculations regardless of which conversation corrected it.
  const projectWideChange = changed.some(ref => project.core?.entries.some(entry => entry.id === ref.id && entry.version === ref.version && entry.scope.subject === 'our_project' && entry.scope.area === 'project'));
  const affected = new Set<ModuleId>(projectWideChange ? Object.keys(MODULES) as ModuleId[] : [sourceModule]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of Object.keys(MODULES) as ModuleId[]) if (!affected.has(id) && MODULES[id].dependencies.some(dependency => affected.has(dependency))) { affected.add(id); grew = true; }
  }
  const modules = { ...project.modules };
  for (const id of Object.keys(modules) as ModuleId[]) {
    const state = modules[id], artifact = state.artifact;
    if (artifact && (artifact.basedOn ? artifact.basedOn.atoms.some(ref => changed.some(item => item.id === ref.id && item.version === ref.version)) : affected.has(id))) {
      modules[id] = { ...state, artifact: { ...artifact, stale: true, staleReason: artifact.basedOn ? reason : `${reason} У старого материала нет точных зависимостей; требуется сверка связанных вводных.`, assessment: undefined } };
    }
  }
  const calculations = { ...project.calculations };
  for (const id of ['market', 'economics'] as const) {
    const report = calculations[id] as { basedOn?: { atoms: VersionRef[] } } | undefined;
    if (report && (report.basedOn ? report.basedOn.atoms.some(ref => changed.some(item => item.id === ref.id && item.version === ref.version)) : affected.has(id))) calculations[id] = { ...report, stale: true, staleReason: report.basedOn ? reason : `${reason} У старого расчёта нет точных зависимостей; требуется сверка исходных значений.` };
  }
  return { ...project, modules, calculations };
}
// Citation-only revisions retain their audit trail without changing the
// decision on which a saved material depends. Every listed field is semantic.
function sameMemoryMeaning(a: AtomicValue, b: AtomicValue): boolean {
  const semantic = (v: AtomicValue) => [v.kind, v.key,
    [v.scope.subject, v.scope.entityId, v.scope.area, v.scope.stageId, v.scope.scenario],
    v.text, v.origin, v.epistemic, v.acceptance, v.dependsOn.map(ref => [ref.id, ref.version])];
  return JSON.stringify(semantic(a)) === JSON.stringify(semantic(b));
}
export function applyMemoryPatch(project: Project, patch: MemoryPatch, evidence: ExternalEvidence[] = [], recoveredSourceRefs: VersionRef[] = []): Project {
  if (!memoryPatchSchema.safeParse(patch).success) invalidMemory('Ответ содержит неверную структуру памяти. Прежняя работа сохранена.');
  const next = ensureCore(project), core = next.core!;
  if (patch.projectId !== next.id || patch.generation !== (next.modules[patch.moduleId].generation ?? 0)) memoryConflict();
  if (core.appliedRequestIds.includes(patch.requestId)) return project;
  if (patch.baseMemoryVersion !== core.revision || patch.baseContextVersion !== core.contextVersion) memoryConflict();
  const origin = core.sourceMessages.find(item => item.moduleId === patch.moduleId && item.generation === patch.generation && item.messageId === patch.sourceMessage.messageId && item.revision === patch.sourceMessage.revision);
  if (!origin || origin.role !== 'user' || core.sourceMessages.some(item => item.moduleId === patch.moduleId && item.generation === patch.generation && item.messageId === origin.messageId && item.revision > origin.revision)) memoryConflict();
  const allEvidence = [...core.evidence];
  // These refs come from the validated server envelope, never the model. They
  // acknowledge same-stage reads completed before a failed response was sent.
  for(const ref of recoveredSourceRefs)if(!evidence.some(item=>item.id===ref.id&&item.version===ref.version&&item.retrieval==='read'&&item.projectId===next.id&&item.moduleId===patch.moduleId&&item.generation===patch.generation))invalidMemory('Неверное основание восстановления источника.');
  for (const item of evidence) {
    const parsed=externalEvidenceSchema.safeParse(item);
    if (!parsed.success || item.projectId !== next.id) invalidMemory('Источник относится к другому запросу или поколению чата.');
    const old = allEvidence.find(existing => existing.id === item.id && existing.version === item.version);
    // An echoed historical source must already exist unchanged in this project.
    // Only newly obtained evidence belongs to the current request/generation.
    if (old) {
      if (JSON.stringify(externalEvidenceSchema.parse(old)) !== JSON.stringify(parsed.data)) invalidMemory('Содержимое прежней версии источника изменено.');
    } else {
      const recovered=recoveredSourceRefs.some(ref=>ref.id===item.id&&ref.version===item.version);
      if(item.moduleId !== patch.moduleId || item.generation !== patch.generation || (item.requestId !== patch.requestId&&!recovered)) invalidMemory('Источник относится к другому запросу или поколению чата.');
      allEvidence.push(item);
    }
  }
  let meaningfulChanges = false;
  const current = getCurrentEntries(core), keys = new Set<string>(), changes: AtomicEntry[] = [], changed: VersionRef[] = [];
  for (const operation of patch.operations) {
    const key = operation.op === 'create' ? `create:${operation.localId}` : `revise:${operation.id}`;
    if (keys.has(key)) invalidMemory('Повторная операция в одном патче.');
    keys.add(key);
    const previous = operation.op === 'revise' ? current.find(entry => entry.id === operation.id) : undefined;
    if (operation.op === 'revise' && (!previous || previous.version !== operation.expectedVersion)) memoryConflict();
    validateMemoryValue(operation.value, core, patch, allEvidence, previous);
    for (const source of operation.value.sources) if (source.type === 'message' && source.generation !== (next.modules[source.moduleId].generation ?? 0)) invalidMemory('Источник относится к перезапущенному чату.');
    // A later accepted correction is never rewritten by regenerating an older turn.
    const sourceOrder = (moduleId: ModuleId, generation: number, messageId: string) => core.sourceMessages.findIndex(item => item.moduleId === moduleId && item.generation === generation && item.messageId === messageId);
    if (previous?.acceptance === 'accepted' && previous.sources.some(source => source.type === 'message' && source.messageId !== origin.messageId && sourceOrder(source.moduleId, source.generation, source.messageId) > sourceOrder(patch.moduleId, patch.generation, origin.messageId))) memoryConflict();
    const entry: AtomicEntry = { ...structuredClone(operation.value), id: previous?.id ?? crypto.randomUUID(), version: (previous?.version ?? 0) + 1, previousVersion: previous?.version ?? null, createdAt: new Date().toISOString(), requestId: patch.requestId };
    changes.push(entry);
    const meaningful = !previous || !sameMemoryMeaning(previous, operation.value);
    meaningfulChanges ||= meaningful;
    // A material can still reference v2 after citation-only v3/v4. A later
    // actual change must invalidate every historical dependency on this atom.
    if (previous && meaningful) changed.push(...core.entries.filter(item => item.id === previous.id).map(item => ({id:item.id, version:item.version})));
  }
  // Validate the resulting state, not an operation's intermediate ordering:
  // a proposal promotion must not coexist with another accepted same-scope value.
  validateAcceptedScopes(getCurrentEntries({ ...core, entries: [...core.entries, ...changes] }));
  let result: Project = { ...next, core: { ...core, revision: core.revision + 1, contextVersion: core.contextVersion + (changes.length ? 1 : 0), entries: [...core.entries, ...changes], evidence: allEvidence, appliedRequestIds: [...core.appliedRequestIds, patch.requestId] } };
  if (meaningfulChanges) result = invalidateCoreDependencies(result, changed, 'Изменены версии вводных проекта. Сверьте итог и расчёт с текущими решениями.', patch.moduleId);
  if (changes.some(entry => entry.previousVersion === null && entry.acceptance === 'accepted')) {
    const modules = { ...result.modules };
    for (const id of Object.keys(modules) as ModuleId[]) {
      const state = modules[id], artifact = state.artifact;
      const relevant = changes.some(entry => entry.acceptance === 'accepted' && entry.previousVersion === null && (entry.scope.area === 'project' || entry.scope.stageId === id || id === patch.moduleId));
      if (artifact && relevant) modules[id] = { ...state, artifact: { ...artifact, stale: true, staleReason: 'Добавлено существенное условие, которого ещё не было в сохранённом результате.', assessment: undefined } };
    }
    result = { ...result, modules };
  }
  return result;
}

export function resetCoreConversation(project: Project, moduleId: ModuleId): Project {
  const next = ensureCore(project), core = next.core!, generation = project.modules[moduleId].generation ?? 0;
  const hasResetSource = (entry: AtomicEntry) => entry.sources.some(source => source.type === 'message' && source.moduleId === moduleId && source.generation === generation || source.type === 'external' && core.evidence.some(item => item.id === source.evidenceId && item.version === source.version && item.moduleId === moduleId && item.generation === generation));
  const current = getCurrentEntries(core);
  // A historical source cannot revoke a later, independently sourced decision.
  // Dependency propagation likewise follows only the current version's bases.
  const removed = new Set(current.filter(hasResetSource).map(entry => entry.id));
  let grew = true;
  while (grew) { grew = false; for (const entry of current) if (!removed.has(entry.id) && entry.dependsOn.some(ref => removed.has(ref.id))) { removed.add(entry.id); grew = true; } }
  const changed = core.entries.filter(entry => hasResetSource(entry) || removed.has(entry.id)).map(({ id, version }) => ({ id, version }));
  const result = invalidateCoreDependencies(next, changed, 'Исходный чат начат заново. Основания этого материала больше не действуют.', moduleId);
  const entries = core.entries.filter(entry => !removed.has(entry.id));
  // Exact sources retained by a surviving history remain inspectable. The
  // context builder excludes their reset generation unless that history needs it.
  const retainedSources = entries.flatMap(entry => entry.sources);
  return { ...result, core: { ...core, revision: core.revision + 1, contextVersion: core.contextVersion + 1,
    entries,
    sourceMessages: core.sourceMessages.filter(source => source.moduleId !== moduleId || source.generation !== generation || retainedSources.some(ref => ref.type === 'message' && ref.moduleId === source.moduleId && ref.generation === source.generation && ref.messageId === source.messageId && ref.revision === source.revision)),
    evidence: core.evidence.filter(source => source.moduleId !== moduleId || source.generation !== generation || retainedSources.some(ref => ref.type === 'external' && ref.evidenceId === source.id && ref.version === source.version)),
  } };
}
export function coreDependencies(project: Project) {
  const core = ensureCore(project).core!;
  if (!core.entries.length) return undefined;
  return { memoryVersion: core.revision, atoms: getCurrentEntries(core).map(({ id, version }) => ({ id, version })), evidence: core.evidence.map(({ id, version }) => ({ id, version })) };
}

export function importProjectCopy(project: Project, id: string): Project {
  const copy = structuredClone(ensureCore(project));
  const oldId = copy.id;
  copy.id = id;
  if (id !== oldId) copy.name += ' (копия)';
  // Request snapshots are immutable financial identities, even when importing
  // into another session. Keep them for inspection; never enable their retry.
  const remapOwned = <T>(value: T): T => {
    if (Array.isArray(value)) return value.map(item => remapOwned(item)) as T;
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'projectId' && item === oldId ? id : remapOwned(item)])) as T;
    return value;
  };
  copy.core = remapOwned(copy.core);
  for (const state of Object.values(copy.modules)) {
    state.proposal = remapOwned(state.proposal);
    state.messages = state.messages.map(message => ({ ...message, reply: remapOwned(message.reply),
      ...((message.request && message.role === 'user' || message.regenerationRequest) && (message.status === 'pending' || message.status === 'failed')
        ? { status: 'failed' as const, requestError: 'IMPORTED_REQUEST' } : {}),
    }));
  }
  return copy;
}

export function invalidateEditedSource(project: Project, moduleId: ModuleId, messageId: string, revision: number): Project {
  const core = project.core!, current = getCurrentEntries(core), changed: VersionRef[] = [];
  const affected = new Set(current.filter(entry => entry.sources.some(source => source.type === 'message' && source.moduleId === moduleId && source.messageId === messageId && source.revision < revision)).map(entry => entry.id));
  let grew = true;
  while (grew) { grew = false; for (const entry of current) if (!affected.has(entry.id) && entry.dependsOn.some(ref => affected.has(ref.id))) { affected.add(entry.id); grew = true; } }
  const invalidated = current.filter(entry => affected.has(entry.id)).map(entry => {
    changed.push({ id: entry.id, version: entry.version });
    return { ...entry, version: entry.version + 1, previousVersion: entry.version, acceptance: 'unresolved' as const, createdAt: new Date().toISOString(), requestId: null };
  });
  return invalidateCoreDependencies({ ...project, core: { ...core, revision: core.revision + (invalidated.length ? 1 : 0), contextVersion: core.contextVersion + 1, entries: [...core.entries, ...invalidated] } }, changed, 'Изменена исходная реплика. Основания прежнего вывода требуют уточнения.', moduleId);
}
