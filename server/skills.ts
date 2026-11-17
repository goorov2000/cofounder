import { z } from 'zod';
import runtime from './skills/runtime.json' with { type: 'json' };
import { TOPIC_CRITERIA } from '../shared/coverage.js';
import type { KnowledgeSource, ModuleId } from '../shared/types.js';
import { KNOWLEDGE } from './knowledge.js';

export const SKILL_CATALOGUE = runtime.skills.map(({ instructions: _instructions, ...skill }) => skill);
export const MAX_LOADED_SKILLS = 3;
export function loadTopicSkill(id: string) {
  const skill = runtime.skills.find(item => item.id === id);
  if (!skill) throw new Error('Unknown topic skill.');
  const moduleId = skill.moduleId as ModuleId;
  const methods = new Set(TOPIC_CRITERIA[moduleId].flatMap(criterion => criterion.methods));
  methods.add('M29'); methods.add('M30');
  return {
    ...skill, criteria: TOPIC_CRITERIA[moduleId],
    methods: KNOWLEDGE.filter(method => methods.has(method.id)).map(({ modules: _modules, ...method }) => method),
  };
}
export function stageSkillId(moduleId: ModuleId): string {
  return SKILL_CATALOGUE.find(skill => skill.moduleId === moduleId)!.id;
}
export type LoadedTopicSkill = ReturnType<typeof loadTopicSkill>;
// Count the three largest complete packages, including JSON escaping, before admission.
export const SKILL_INPUT_BYTES = SKILL_CATALOGUE.map(skill => Buffer.byteLength(JSON.stringify(loadTopicSkill(skill.id))))
  .sort((a, b) => b - a).slice(0, MAX_LOADED_SKILLS).reduce((sum, bytes) => sum + bytes, 0) + 4096;
export function skillMethods(skills: LoadedTopicSkill[]): KnowledgeSource[] {
  return [...new Map(skills.flatMap(skill => skill.methods).map(method => [method.id, method])).values()];
}
export const loadSkillArguments = z.strictObject({ skillIds: z.array(z.enum(SKILL_CATALOGUE.map(skill => skill.id) as [string, ...string[]])).min(1).max(2) })
  .refine(value => new Set(value.skillIds).size === value.skillIds.length);
export const LOAD_SKILL_TOOL = {
  type: 'function' as const, name: 'load_topic_skill',
  description: 'Загрузить полную методику дополнительной темы: порядок помощи, ветки, критерии и контрпримеры. Текущая тема уже загружена. Используй при смежной задаче, например интервью или экономика внутри идеи. Возвращает инструкции, а не выполняет поиск или интервью.',
  strict: true,
  parameters: { type: 'object', additionalProperties: false, properties: {
    skillIds: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string', enum: SKILL_CATALOGUE.map(skill => skill.id) } },
  }, required: ['skillIds'] },
};
