import type { Artifact, Assessment, Fact, ModuleId, Project, ProposedArtifact, StageId } from './types.js';
import { MODULES, STAGE_IDS } from './modules.js';
import { validateFact } from './validation.js';
import { ensureCore, coreDependencies, resetCoreConversation } from './coreMemory.js';
import { isTopicComplete, wasTopicCompleted } from './coverage.js';
export { createDemoProject } from './demo.js';

const moduleIds = Object.keys(MODULES) as ModuleId[];
export function createProject(): Project {
  const now = new Date().toISOString();
  const modules = {} as Project['modules'];
  for (const id of moduleIds) modules[id] = { messages: [], draft: '', proposal: null, artifact: null };
  return ensureCore({
    id: globalThis.crypto.randomUUID(), name: 'Мой стартап', description: '', stageLabel: 'Идея', prototypeUrl: '',
    createdAt: now, updatedAt: now, isDemo: false, activeModule: 'idea', facts: {}, calculations: {},
    modules, unlockedStages: ['idea'],
  });
}
export function getUnlockedStages(project: Project): StageId[] {
  const unlocked = new Set(project.unlockedStages ?? ['idea']);
  for (const id of STAGE_IDS) {
    // Keep earlier projects' saved work and access when migrating to coverage-based progression.
    if (project.modules[id].artifact || project.modules[id].completedAt || (!project.unlockedStages && (project.modules[id].messages.length || MODULES[id].dependencies.every(dependency => project.modules[dependency].artifact)))) unlocked.add(id);
    if (unlocked.has(id) && (project.modules[id].artifact || wasTopicCompleted(project, id))) {
      const next = STAGE_IDS[STAGE_IDS.indexOf(id) + 1];
      if (next) unlocked.add(next);
    }
  }
  return STAGE_IDS.filter(id => unlocked.has(id));
}
export function getAccess(project: Project, moduleId: ModuleId): { allowed: boolean; missing: ModuleId[] } {
  const unlocked = getUnlockedStages(project);
  const index = STAGE_IDS.indexOf(moduleId as typeof STAGE_IDS[number]);
  if (index >= 0) {
    const allowed = unlocked.includes(moduleId as typeof STAGE_IDS[number]);
    return { allowed, missing: allowed ? [] : [STAGE_IDS[index - 1]] };
  }
  const missing = MODULES[moduleId].dependencies.filter(id => !project.modules[id].artifact && !isTopicComplete(project, id) && !unlocked.includes(STAGE_IDS[STAGE_IDS.indexOf(id as typeof STAGE_IDS[number]) + 1]));
  return { allowed: Boolean(project.modules[moduleId].artifact) || missing.length === 0, missing };
}
function descendants(moduleId: ModuleId): Set<ModuleId> {
  const found = new Set<ModuleId>();
  const visit = (parent: ModuleId) => {
    for (const id of moduleIds) if (!found.has(id) && MODULES[id].dependencies.includes(parent)) { found.add(id); visit(id); }
  };
  visit(moduleId);
  return found;
}
function invalidate(project: Project, affected: Iterable<ModuleId>, reason: string): Project {
  const modules = { ...project.modules };
  for (const id of affected) {
    const state = modules[id];
    if (state.artifact) modules[id] = { ...state, artifact: { ...state.artifact, stale: true, staleReason: reason, assessment: undefined } };
  }
  return { ...project, modules };
}
export function saveArtifact(project: Project, moduleId: ModuleId, draft: ProposedArtifact, facts?: Fact[]): Project {
  if (!draft.title.trim() || !draft.body.trim()) throw new Error('Введите название и текст материала.');
  const proposed = facts?.map((fact) => validateFact(fact, 'assistant')).filter((fact) => project.facts[fact.key]?.provenance !== 'verified');
  let next = proposed?.length ? updateFacts(project, proposed) : project;
  const previous = project.modules[moduleId].artifact;
  if (previous && (previous.body !== draft.body || previous.title !== draft.title)) {
    next = invalidate(next, descendants(moduleId), `Изменён материал «${MODULES[moduleId].shortTitle}». Пересмотрите зависимые решения.`);
  }
  const now = new Date().toISOString();
  const state = next.modules[moduleId];
  const proposal = state.proposal?.artifactDraft;
  const changedOutsideConversation = state.memory?.content.coverage && (proposal?.body !== draft.body || proposal?.title !== draft.title);
  return { ...next, updatedAt: now, modules: { ...next.modules, [moduleId]: {
    ...state, ...(changedOutsideConversation ? { memory: { ...state.memory!, needsRefresh: true } } : {}), artifact: { ...draft, basedOn: coreDependencies(next), revision: (previous?.revision ?? 0) + 1, savedAt: now, stale: false },
  } } };
}
export function deleteArtifact(project: Project, moduleId: ModuleId): Project {
  if (!project.modules[moduleId].artifact) return project;
  const next = invalidate(project, descendants(moduleId), `Удалён исходный материал «${MODULES[moduleId].shortTitle}». Сохранённый текст оставлен для пересмотра.`);
  return { ...next, updatedAt: new Date().toISOString(), modules: { ...next.modules, [moduleId]: { ...next.modules[moduleId], artifact: null } } };
}
export function restartChat(project: Project, moduleId: ModuleId): Project {
  project = { ...project, unlockedStages: getUnlockedStages(project) };
  project = resetCoreConversation(project, moduleId);
  const affected = descendants(moduleId);
  const next = invalidate(project, affected, `Заново начат чат «${MODULES[moduleId].shortTitle}». Пересмотрите связанные итоги.`);
  const modules = { ...next.modules };
  for (const id of affected) {
    const memory = modules[id].memory;
    if (memory) modules[id] = { ...modules[id], memory: { ...memory, needsRefresh: true } };
  }
  const now = new Date().toISOString();
  modules[moduleId] = { generation: (project.modules[moduleId].generation ?? 0) + 1, messages: [], draft: '', proposal: null, artifact: null, resetAt: now };
  const calculations = { ...project.calculations };
  delete calculations[moduleId];
  return { ...next, modules, calculations, updatedAt: now };
}
export function updateFacts(project: Project, updates: Fact[]): Project {
  const validated = updates.map((fact) => validateFact(fact));
  const facts = { ...project.facts };
  let changed = false;
  for (const fact of validated) {
    if (JSON.stringify(facts[fact.key]) !== JSON.stringify(fact)) { facts[fact.key] = fact; changed = true; }
  }
  if (!changed) return project;
  const next = invalidate(project, moduleIds, 'Изменены общие решения или их источники. Сверьте материал с актуальными вводными.');
  return { ...next, facts, updatedAt: new Date().toISOString() };
}
type FactsInput = Record<string, Fact> | Fact[];
function factList(facts: FactsInput = {}): Fact[] { return Array.isArray(facts) ? facts : Object.values(facts); }
function assessmentHash(moduleId: ModuleId, body: string, facts: FactsInput = {}): string {
  // Sorting fixed fields makes the hash independent of property insertion order.
  const entries = factList(facts).map((fact) => [fact.key, fact.value, fact.provenance, fact.note, fact.sourceUrl ?? '', fact.checkedAt ?? '']).sort((a, b) => a[0].localeCompare(b[0]));
  const text = JSON.stringify([moduleId, body, entries]);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `checklist-v1-${(hash >>> 0).toString(16)}`;
}
const normalize = (text: string) => text.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
export function assessArtifact(moduleId: ModuleId, body: string, facts: FactsInput = {}): Assessment {
  const sections = new Map<string, string>();
  let current = '';
  for (const line of body.split('\n')) {
    const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/) ?? line.match(/^\s*\*\*(.+?)\*\*:?\s*$/);
    if (heading) { current = normalize(heading[1]); sections.set(current, ''); }
    else if (current) sections.set(current, `${sections.get(current)}\n${line}`);
  }
  const checks: Assessment['checks'] = MODULES[moduleId].sections.map((section) => {
    const content = sections.get(normalize(section))?.replace(/[\s#*_|-]/g, '') ?? '';
    const passed = content.length > 0;
    return { label: `Полнота: ${section}`, passed, reason: passed ? 'Раздел заполнен; содержание не проверялось внешними источниками.' : `Добавьте раздел «${section}» и описание либо явно укажите неизвестное.` };
  });
  const entries = factList(facts);
  checks.push({ label: 'Обоснованность: происхождение решений', passed: entries.length > 0, reason: entries.length ? 'Статусы решений учитываются отдельно от полноты текста.' : 'Добавьте существенные решения и укажите, откуда они известны.' });
  for (const fact of entries) {
    let valid = true;
    try { validateFact(fact); } catch { valid = false; }
    const passed = valid && fact.provenance !== 'hypothesis' && fact.provenance !== 'unknown' && (fact.provenance !== 'calculation' || Boolean(fact.note.trim()));
    checks.push({ label: `Обоснованность: ${fact.key}`, passed, reason: !valid ? 'Уточните статус, источник и дату проверки решения.' : fact.provenance === 'hypothesis' ? `Подтвердите допущение «${fact.value}» или оставьте его явно условным.` : fact.provenance === 'unknown' ? `Уточните неизвестное «${fact.key}»; пока оно не является основанием.` : fact.provenance === 'verified' ? 'Проверено пользователем: источник и дата указаны. Система источник не проверяла.' : fact.provenance === 'calculation' ? (passed ? 'Основание расчёта записано; проверьте исходные значения.' : 'Добавьте исходные значения, формулу и основания расчёта.') : 'Со слов пользователя; независимая проверка не проводилась.' });
  }
  if (moduleId === 'market' || moduleId === 'economics') {
    const hasNumbers = /\d/.test(body);
    for (const [label, passed, reason] of [
      ['единицы и период', /(?:₽|руб|USD|EUR|доллар|клиент|покупател)/i.test(body) && /(?:месяц|год|недел|квартал|период)/i.test(body), 'Укажите валюту/единицу и единый период числового сценария.'],
      ['формулы и основания', /[=×*]/.test(body) && /(?:источник|основан|гипотез|условн|со слов|неизвест)/i.test(body), 'Добавьте воспроизводимые формулы и происхождение исходных чисел.'],
    ] as const) checks.push({ label: `Обоснованность: ${label}`, passed: hasNumbers && passed, reason: hasNumbers && passed ? 'Признаки указаны в тексте; это эвристическая проверка, а не подтверждение истинности.' : reason });
  }
  return { textHash: assessmentHash(moduleId, body, facts), checks, assessedAt: new Date().toISOString() };
}
export function isAssessmentCurrent(moduleId: ModuleId, artifact: Artifact, facts: FactsInput = {}): boolean {
  return Boolean(artifact.assessment && !artifact.stale && artifact.assessment.textHash === assessmentHash(moduleId, artifact.body, facts));
}
export interface Refinement { moduleId: ModuleId; kind: 'missing' | 'completeness' | 'evidence' | 'stale'; label: string; reason: string }
export function getRefinements(project: Project): Refinement[] {
  const result: Refinement[] = [];
  for (const moduleId of moduleIds) {
    const artifact = project.modules[moduleId].artifact;
    if (!artifact) {
      if (STAGE_IDS.includes(moduleId as typeof STAGE_IDS[number])) result.push({ moduleId, kind: 'missing', label: `Подготовить: ${MODULES[moduleId].shortTitle}`, reason: 'Сохранённого материала пока нет.' });
      continue;
    }
    if (artifact.stale) result.push({ moduleId, kind: 'stale', label: `Пересмотреть: ${MODULES[moduleId].shortTitle}`, reason: artifact.staleReason ?? 'Изменились исходные решения.' });
    if (!isAssessmentCurrent(moduleId, artifact, project.facts)) result.push({ moduleId, kind: 'completeness', label: `Проверить полноту: ${MODULES[moduleId].shortTitle}`, reason: 'Для текущего текста и решений нет актуальной оценки.' });
    else for (const check of artifact.assessment!.checks) if (!check.passed) result.push({ moduleId, kind: check.label.startsWith('Обоснованность:') ? 'evidence' : 'completeness', label: check.label, reason: check.reason });
  }
  return result;
}
export function parseNavigation(text: string): ModuleId | null {
  const command = normalize(text).replace(/[.!]$/, '');
  const targets: Record<ModuleId, [string, string]> = {
    idea: ['идее', 'идею'], audience: ['целевой аудитории', 'целевую аудиторию'], competitors: ['конкурентам', 'конкурентов'],
    market: ['рынку', 'рынок'], business: ['бизнес-модели', 'бизнес-модель'], economics: ['экономике', 'экономику'],
    team: ['команде', 'команду'], roadmap: ['дорожной карте', 'дорожную карту'], mvp: ['mvp', 'mvp'],
    basics: ['основам стартапа', 'основы стартапа'], trends: ['трендам', 'тренды'], ai: ['ai', 'ai'],
    interview: ['интервью', 'интервью'], legal: ['правовым вопросам', 'правовые вопросы'],
  };
  for (const id of moduleIds) {
    const [dative, accusative] = targets[id];
    if (command === `перейди к ${dative}` || command === `открой ${accusative}`) return id;
  }
  return null;
}
