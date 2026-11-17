import type { ChatRequest, KnowledgeSource, ModuleId } from '../shared/types.js';
import runtime from './knowledge/runtime.json' with { type: 'json' };
import { TOPIC_CRITERIA } from '../shared/coverage.js';

export const METHOD_SOURCES = runtime.sources;
export const PERMANENT_PROTOCOL = runtime.protocol;
export const PROTOCOL_VERSION = runtime.protocolVersion;
const stageAliases: Record<string, ModuleId[]> = {
  business_model: ['business'], brief: ['mvp'], validation: ['interview'], dialogue: [], cross_stage: [],
};
function methodBody(card: typeof runtime.cards[number]): string {
  return [
    `Определение: ${card.definition}`, `Когда применять: ${card.trigger}`, `Вводные: ${card.inputs_from_project.join('; ')}`,
    `Действия:\n${card.bot_steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}`,
    `Если данных нет: ${card.branches_for_missing_data}`, `Результат: ${card.expected_output}`,
    `Критерии результата: ${card.result_rubric.join('; ')}`, `Проверки процесса: ${card.process_checks.join('; ')}`,
    `Учебный пример — НЕ данные текущего проекта: ${card.worked_example}`, `Контрпример: ${card.counterexample}`,
    `Применимость: ${card.applicability}`, `Остановка: ${card.stop_conditions}`,
    `Статус: ${card.status}; проверка ${card.reviewed_at}: ${card.review_scope}`,
  ].join('\n');
}
export const KNOWLEDGE = runtime.cards.map(card => ({
  id: card.id, methodId: card.id, title: card.title, version: card.version, body: methodBody(card),
  sourceRefs: card.source_ids, applicability: [card.stage, card.applicability],
  status: card.status as 'editorial_draft_not_behaviorally_validated',
  modules: stageAliases[card.stage] ?? [card.stage as ModuleId],
}));

const stop = new Set(['котор', 'какой', 'такой', 'этот', 'хочу', 'нужн', 'можно', 'давай', 'меня', 'тогда', 'пока', 'чтобы', 'пожал', 'помог', 'расск', 'для', 'как', 'что', 'это', 'или', 'при', 'где', 'нет', 'еще', 'уже', 'все', 'мне', 'наш', 'моя', 'этой', 'так', 'есть', 'него', 'они', 'оно', 'она', 'сам']);
function terms(text: string): Set<string> {
  return new Set((text.toLocaleLowerCase('ru').replaceAll('ё', 'е').match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(word => word.length >= 3).map(word => word.slice(0, 5)).filter(word => !stop.has(word)));
}
const taskRules: { pattern: RegExp; methods: string[]; reason: string; weight: number }[] = [
  { pattern: /найти иде|поиск[^.?!]{0,15}иде|иде[йи][^.?!]{0,15}нет|нет[^.?!]{0,15}иде|от боли|от рынка|от спроса|с чего начать|тренд|хайп/iu, methods: ['M01'], reason: 'task:idea-discovery', weight: 90 },
  { pattern: /тариф|цен[^.?!]{0,35}конкур|стоимост[^.?!]{0,35}альтернатив/iu, methods: ['M11', 'M09', 'M10'], reason: 'task:public-prices', weight: 120 },
  { pattern: /конкурент|альтернатив|сравни[^.?!]{0,35}(?:сервис|продукт)/iu, methods: ['M09', 'M10'], reason: 'task:alternatives', weight: 95 },
  { pattern: /полномочи|согласу|плательщ|кто платит|покупател|пользоват[^.?!]{0,25}плат/iu, methods: ['M05'], reason: 'task:buying-roles', weight: 100 },
  { pattern: /интервью|custdev|респондент/iu, methods: ['M07'], reason: 'task:interview', weight: 110 },
  { pattern: /(?:разбери|проанализируй|противореч)[^.?!]{0,50}(?:заметк|интервью|отзыв)|(?:заметки|цитаты) (?:из|после) интервью/iu, methods: ['M08'], reason: 'task:evidence-analysis', weight: 125 },
  { pattern: /(?:исправ|вместо|условн|допущен|сценари|придум)[^.?!]{0,60}(?:цен|числ|\d)|(?:цен|числ)[^.?!]{0,40}(?:исправ|условн|допущен)/iu, methods: ['M15'], reason: 'task:number-provenance', weight: 115 },
  { pattern: /провер[^.?!]{0,35}(?:гипотез|спрос|цен|канал)|эксперимент|сам[^.?!]{0,20}рискован/iu, methods: ['M25', 'M26'], reason: 'task:validation', weight: 85 },
  { pattern: /бизнес.модел|модел[^.?!]{0,20}(?:доход|выруч)|монетизац/iu, methods: ['M16'], reason: 'task:business-model', weight: 105 },
  { pattern: /бриф|(?:описан|требован)[^.?!]{0,25}(?:mvp|разработ)|(?:mvp)[^.?!]{0,25}(?:описан|разработ)/iu, methods: ['M28'], reason: 'task:product-description', weight: 105 },
  { pattern: /(?:прибыл|выручк|затрат|расход|маржа)/iu, methods: ['M20'], reason: 'task:economics', weight: 75 },
  { pattern: /\btam\b|\bsam\b|\bsom\b|размер рынка|объем рынка/iu, methods: ['M12', 'M13', 'M14'], reason: 'task:market-sizing', weight: 80 },
];
const index = KNOWLEDGE.map(note => ({ note, words: terms(note.body), title: terms(note.title) }));

export function retrieveKnowledge(request: ChatRequest): KnowledgeSource[] {
  const shortContinuation = /^(?:не знаю|не уверен|сделай сам|помоги|да|нет)[.!?\s]*$/iu.test(request.message.trim());
  const taskText = shortContinuation ? `${request.context.history.slice(-2).map(item => item.content).join(' ')} ${request.message}` : request.message;
  const query = terms(taskText);
  const tasks = taskRules.filter(rule => rule.pattern.test(taskText));
  const coverage = request.context.memories?.find(memory => memory.moduleId === request.moduleId && !memory.needsRefresh)?.content.coverage;
  const gapMethods = coverage?.moduleId === request.moduleId ? TOPIC_CRITERIA[request.moduleId].find(criterion => criterion.id === coverage.nextCriterionId)?.methods ?? [] : [];
  const needsStage = request.intent !== 'message' || shortContinuation;
  const ranked = index.filter(({ note }) => note.id !== 'M30').map(({ note, words, title }) => {
    const reasons: string[] = [];
    let score = 0;
    if (gapMethods.includes(note.id)) { score += 80; reasons.push(`coverage:${coverage!.nextCriterionId}`); }
    for (const task of tasks) {
      const position = task.methods.indexOf(note.id);
      if (position >= 0) { score = Math.max(score, task.weight - position * 25); reasons.push(task.reason); }
    }
    const hits = [...query].filter(term => words.has(term) || title.has(term));
    const lexical = hits.reduce((total, term) => total + (title.has(term) ? 4 : 1), 0);
    if (lexical >= 3) { score += Math.min(lexical, 25); reasons.push('lexical'); }
    if (note.modules.includes(request.moduleId) && (score || needsStage)) { score += 12; reasons.push(`stage:${request.moduleId}`); }
    if (request.intent === 'draft' && note.id === 'M29') { score += 10; reasons.push('task:review-draft'); }
    return { note, score, reasons };
  }).filter(item => item.score >= (tasks.length ? 50 : 3)).sort((a, b) => b.score - a.score || a.note.id.localeCompare(b.note.id)).slice(0, 5);
  const selected = ranked.map(({ note: { modules: _modules, ...source }, reasons }) => ({ ...source, selectionReason: reasons }));
  const { modules: _modules, ...permanent } = KNOWLEDGE.find(note => note.id === 'M30')!;
  return [...selected, { ...permanent, selectionReason: ['permanent:mentor-action'] }];
}
