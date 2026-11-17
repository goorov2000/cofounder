import { z } from 'zod';
import type { MarketCalculationEvidence, ModuleId, Project, TopicCoverage } from './types.js';

export interface TopicCriterion {
  id: string; label: string; sufficient: string; methods: string[];
  needsUserChoice?: boolean; needsResearch?: boolean;
  dependsOn?: string[];
}
const criterion = (id: string, label: string, sufficient: string, methods: string[], extra: Partial<TopicCriterion> = {}): TopicCriterion => ({ id, label, sufficient, methods, ...extra });

/** Stable subject criteria, always available; headings and message counts do not imply coverage. */
export const TOPIC_CRITERIA: Record<ModuleId, TopicCriterion[]> = {
  idea: [
    criterion('situation', 'Кому и в какой ситуации', 'Назван участник и конкретная ситуация, в которой возникает задача.', ['M01']),
    criterion('problem', 'Проблема и последствия', 'Понятно, что мешает человеку и к чему это приводит. Замер потерь не обязателен.', ['M01']),
    criterion('alternative', 'Как решают сейчас', 'Описан нынешний способ или обходной путь, даже если это таблица или ручная работа.', ['M01']),
    criterion('solution', 'Как поможет решение', 'Понятно, кто что делает и какой результат получает, и как это устраняет описанную боль. Одних слов «удобный сервис» или «единое место» недостаточно; рабочая гипотеза процесса допустима.', ['M02'], { dependsOn: ['problem'] }),
    criterion('scope', 'Границы решения', 'Пользователь выбрал направление и существенные границы. Одна рекомендация бота ещё не выбор.', ['M02'], { needsUserChoice: true, dependsOn: ['solution'] }),
    criterion('value', 'Ожидаемая польза', 'Понятно, какой результат станет удобнее и за счёт чего; гипотеза пользы отделена от измеренного эффекта.', ['M03'], { dependsOn: ['problem'] }),
    criterion('validation', 'Что и как проверить', 'Выделено главное неизвестное и доступный способ проверки. Проводить проверку до завершения идеи не обязательно.', ['M03', 'M25'], { dependsOn: ['solution'] }),
  ],
  audience: [
    criterion('segments', 'Подходящие сегменты', 'Сравнены различимые сегменты по задаче и доступности; нет вымышленной демографии.', ['M04']),
    criterion('selection', 'Первый сегмент', 'Пользователь выбрал первый сегмент; понятны признаки отбора и исключения.', ['M04'], { needsUserChoice: true }),
    criterion('roles', 'Пользователь и покупатель', 'Различены использование, инициирование, согласование и оплата; неизвестные полномочия явно оставлены неизвестными.', ['M05']),
    criterion('need', 'Задача сегмента', 'Сегмент связан с конкретной ситуацией, болью и нынешней альтернативой.', ['M06']),
    criterion('price_segment', 'Ценовой сегмент и готовность платить', 'Обсуждены ценовой уровень, бюджет или ориентир расходов на нынешнюю альтернативу, за что клиент готов доплачивать и ограничения покупки. Пользователь выбрал рабочее ценовое позиционирование либо согласовал явную гипотезу с проверкой. Точная цена и доказанная готовность платить пока не обязательны; неизвестные суммы и гипотезы нельзя выдавать за факты. Одного названия «премиум» или описания плательщика недостаточно.', ['M04', 'M05', 'M06'], { needsUserChoice: true, dependsOn: ['selection'] }),
    criterion('access', 'Как проверить на людях', 'Есть путь к респондентам и предмет проверки либо конкретно обозначен недоступный доступ и способ его получить.', ['M07']),
  ],
  competitors: [
    criterion('alternatives', 'Способы решить задачу', 'Рассмотрены релевантные прямые, косвенные и ручные альтернативы, неприменимость категории объяснена.', ['M09']),
    criterion('comparison', 'Сравнение по одной задаче', 'Варианты сопоставлены по одинаковым важным критериям; таблица содержит результат.', ['M10']),
    criterion('sources', 'Источники и условия', 'Существенные сведения опираются на реально прочитанные источники с датами; у цен есть условия или явное неизвестное.', ['M11'], { needsResearch: true }),
    criterion('difference', 'Возможное отличие', 'Вывод следует из сравнения; собственное отличие и ближайшая проверка обозначены как гипотезы.', ['M10']),
  ],
  market: [
    criterion('boundaries', 'Границы рынка', 'Указаны покупатель, продукт, география, единица и период.', ['M12']),
    criterion('inputs', 'Вводные и основания', 'Для значений или диапазонов указано происхождение; допущения и неизвестное отделены от наблюдений.', ['M15']),
    criterion('calculation', 'Расчёт TAM / SAM / SOM', 'Для всех трёх уровней TAM, SAM и SOM выполнен воспроизводимый численный расчёт или расчёт диапазона: подставлены входные значения, показаны формулы и численные результаты с единицами и периодом. Сценарные допущения подписаны и отделены от измеренного рынка. Определения, формулы с неизвестными входами и пример чувствительности только SOM означают partial. Одно упоминание TAM/SAM/SOM не закрывает расчёт. Неизвестное не заменено нулём.', ['M12', 'M13', 'M14'], { dependsOn: ['boundaries', 'inputs'] }),
    criterion('reach', 'Достижимость и ограничения', 'Фильтры SAM и механизм достижения SOM связаны с возможностями проекта; нет произвольного процента рынка.', ['M14']),
  ],
  business: [
    criterion('exchange', 'Кто и за что платит', 'Различены плательщик, пользователь и предмет обмена; назначения без данных отмечены как гипотезы.', ['M16']),
    criterion('revenue', 'Как возникает доход', 'Указаны единица, частота, условия оплаты и статус цены.', ['M16', 'M17']),
    criterion('channel', 'Путь к покупке', 'Выбран первый канал и описаны привлечение, оплата и выполнение обещания.', ['M18'], { needsUserChoice: true }),
    criterion('test', 'Проверка покупки', 'Названо ключевое допущение о покупке и способ проверить его с доступными ресурсами.', ['M19']),
  ],
  economics: [
    criterion('unit', 'Единица и период', 'Определены единица, валюта и единый период сценария.', ['M20']),
    criterion('inputs', 'Доходы и затраты', 'Различены доходы, переменные и постоянные затраты, привлечение и удержание; пробелы явно указаны.', ['M20', 'M21']),
    criterion('model', 'Формулы и ограничения', 'Вычисления воспроизводимы; без затрат нет вывода о прибыли, без удержания нет выдуманного LTV.', ['M22']),
    criterion('sensitivity', 'Что меняет результат', 'Показаны важные допущения, сценарии и ближайшее необходимое измерение.', ['M23']),
  ],
  team: [
    criterion('people', 'Кто уже участвует', 'Названы реальные участники или явно указано, что основатель один; будущие роли не считаются людьми.', ['M24']),
    criterion('work', 'Работы и ответственность', 'Необходимые работы распределены по ответственности.', ['M24']),
    criterion('capacity', 'Время и компетенции', 'Учтены доступный ресурс, умения и существенные ограничения.', ['M24']),
    criterion('help', 'Какая помощь понадобится', 'Пробелы связаны с будущими ролями и условием их привлечения.', ['M24']),
  ],
  roadmap: [
    criterion('goal', 'Цель и главный риск', 'Пользователь определил ближайший результат и существенные ограничения.', ['M25'], { needsUserChoice: true }),
    criterion('steps', 'Ближайшие действия', 'Есть 3–5 конкретных действий с ожидаемыми результатами и свидетельствами завершения.', ['M26']),
    criterion('dependencies', 'Последовательность', 'Понятны зависимости и необходимые данные; прежние решения сохранены.', ['M27']),
    criterion('resources', 'Сроки и ответственные', 'Указаны ответственные, сроки или диапазоны и связь с доступным ресурсом.', ['M27']),
    criterion('review', 'Когда менять план', 'Определены контрольные точки и основания для пересмотра.', ['M27']),
  ],
  mvp: [
    criterion('test', 'Проверяемая ценность', 'Понятно, какую гипотезу и на ком проверяет минимальная версия.', ['M28']),
    criterion('scenario', 'Роли и основной процесс', 'Описаны роли, действия, права, результаты и существенные исключения.', ['M28']),
    criterion('scope', 'Обязательное и отложенное', 'Пользователь согласовал минимальный объём; существенные ограничения сохранены.', ['M28'], { needsUserChoice: true }),
    criterion('dependencies', 'Данные и зависимости', 'Определены необходимые данные, интеграции, ошибки, сроки и зависимости; для услуги не навязываются экраны.', ['M28']),
    criterion('acceptance', 'Как принять результат', 'Есть проверяемые сценарии приёмки и способ наблюдать полезность. Создание самого MVP не объявлено выполненным.', ['M29']),
  ],
  basics: [
    criterion('question', 'Что нужно понять', 'Ясен исходный вопрос пользователя.', []),
    criterion('explanation', 'Понятное объяснение', 'Понятие объяснено простыми словами без подмены ответом на другой вопрос.', []),
    criterion('application', 'Применение к проекту', 'Разобран конкретный пример и его влияние на решение.', []),
  ],
  trends: [
    criterion('area', 'Область поиска', 'Пользователь выбрал область или явно поручил подобрать направления.', ['M01'], { needsUserChoice: true }),
    criterion('sources', 'Актуальные основания', 'Утверждения об изменениях подкреплены реально прочитанными источниками с датами.', ['M01'], { needsResearch: true }),
    criterion('opportunity', 'Люди и возможная задача', 'Показана связь изменения с группой людей и возможной болью.', ['M01']),
    criterion('test', 'Способ проверки', 'Возможность сформулирована как проверяемая гипотеза, хайп не объявлен спросом.', ['M25']),
  ],
  ai: [
    criterion('task', 'Задача и обычная альтернатива', 'Понятна задача и способ решить её без AI.', []),
    criterion('usefulness', 'Нужен ли AI', 'Обоснованы польза AI или отказ от него; технология не навязана.', []),
    criterion('limits', 'Данные и ограничения', 'Для AI-варианта описаны данные и ошибки; при отказе от AI объяснена неприменимость.', []),
    criterion('test', 'Как проверить пользу', 'Описано сравнение результата с обычным способом.', []),
  ],
  interview: [
    criterion('hypothesis', 'Что проверяем', 'Сформулированы гипотеза и критерии подходящего респондента.', ['M07']),
    criterion('questions', 'Вопросы и запись ответов', 'Подготовлены нейтральные вопросы о поведении и формат заметок.', ['M07']),
    criterion('interpretation', 'Как делать выводы', 'Для подготовки заданы критерии анализа; для разбора выводы привязаны к реальным заметкам и противоречиям. Проведённое интервью не требуется для готовности сценария.', ['M08']),
  ],
  legal: [
    criterion('context', 'Условия проекта', 'Уточнены существенные обстоятельства, юрисдикция и работа с данными при применимости.', []),
    criterion('questions', 'Вопросы для проверки', 'Собраны конкретные правовые вопросы текущего проекта.', []),
    criterion('sources', 'Официальные основания', 'Обзор опирается на прочитанные официальные источники; непрочитанные сведения не считаются проверенными.', [], { needsResearch: true }),
    criterion('limits', 'Границы обзора', 'Неизвестные и необходимые уточнения названы; обзор не объявлен правовым заключением.', []),
  ],
};

const calculationLevelSchema = z.strictObject({ quote: z.string().trim().min(1).max(1600), formula: z.string().trim().min(1).max(500), result: z.string().trim().min(1).max(200) });
export const marketCalculationEvidenceSchema = z.strictObject({ tam: calculationLevelSchema, sam: calculationLevelSchema, som: calculationLevelSchema });
const normalizedCalculationText = (text: string) => text.toLocaleLowerCase('ru').replace(/\s+/g, ' ').trim();
export function hasMarketCalculationEvidence(value: MarketCalculationEvidence | undefined, sources?: string[]): boolean {
  if (!marketCalculationEvidenceSchema.safeParse(value).success) return false;
  const normalizedSources = sources?.map(normalizedCalculationText);
  return (['tam','sam','som'] as const).every(level => {
    const item=value![level], quote=normalizedCalculationText(item.quote), formula=normalizedCalculationText(item.formula), result=normalizedCalculationText(item.result);
    const label={tam:'(?:tam|там)',sam:'(?:sam|сам)',som:'(?:som|сом)'}[level];
    return new RegExp(`(?:^|[^\\p{L}])${label}(?=$|[^\\p{L}])`,'u').test(quote)
      && quote.includes(formula) && quote.includes(result) && /\d/.test(result) && !/неизвест|unknown|не\s+(?:установлен|рассчитан)|\?/.test(result)
      && (/\d[\s\S]*(?:[×*·+÷/=xх]|\bmin\b|минимум)[\s\S]*\d/.test(formula)
        || /(?:tam|sam|som|там|сам|сом)\s*[:=]\s*\d/.test(formula))
      && (!normalizedSources || normalizedSources.some(source=>source.includes(quote)));
  });
}

const topicCoverageShape = z.strictObject({
  rubricVersion: z.literal(1), moduleId: z.enum(Object.keys(TOPIC_CRITERIA) as [ModuleId, ...ModuleId[]]),
  items: z.array(z.strictObject({
    id: z.string().min(1).max(40), status: z.enum(['missing', 'partial', 'covered']), note: z.string().trim().min(1).max(180),
    support: z.strictObject({ role: z.enum(['user', 'assistant']), quote: z.string().trim().min(1).max(240) }).nullable(),
    calculationEvidence: marketCalculationEvidenceSchema.optional(),
  })).max(8), nextCriterionId: z.string().max(40).nullable(),
});
export const topicCoverageSchema = topicCoverageShape.superRefine((coverage, context) => {
  const criteria = TOPIC_CRITERIA[coverage.moduleId];
  if (coverage.items.length !== criteria.length || new Set(coverage.items.map(item => item.id)).size !== criteria.length || coverage.items.some(item => !criteria.some(criterion => criterion.id === item.id))) {
    context.addIssue({ code: 'custom', message: 'Coverage must contain each stage criterion exactly once.', path: ['items'] });
  }
  if (coverage.items.some(item => item.status === 'covered' && !item.support)) context.addIssue({ code: 'custom', message: 'Covered criteria require a literal support quote.', path: ['items'] });
  if (coverage.nextCriterionId !== null && !coverage.items.some(item => item.id === coverage.nextCriterionId && item.status !== 'covered')) context.addIssue({ code: 'custom', message: 'Next criterion must be an unresolved criterion.', path: ['nextCriterionId'] });
});

// Historical five-item audience assessments remain readable in saved projects,
// request snapshots and replies. They cannot count as complete under today's rubric.
const legacyAudienceCoverageSchema = topicCoverageShape.superRefine((coverage, context) => {
  const upgraded = upgradeTopicCoverage(coverage);
  if (coverage.moduleId !== 'audience' || coverage.items.length !== 5 || coverage.items.some(item => item.id === 'price_segment') || !topicCoverageSchema.safeParse(upgraded).success) {
    context.addIssue({ code: 'custom', message: 'Invalid historical audience coverage.' });
  }
});
export const storedTopicCoverageSchema = z.union([topicCoverageSchema, legacyAudienceCoverageSchema]);

export function upgradeTopicCoverage(coverage: TopicCoverage): TopicCoverage {
  if (coverage.moduleId === 'audience' && !coverage.items.some(item => item.id === 'price_segment')) return { ...coverage, items: [...coverage.items, { id: 'price_segment', status: 'missing', note: 'Ценовой сегмент ещё не обсуждён.', support: null }], nextCriterionId: coverage.nextCriterionId ?? 'price_segment' };
  if (coverage.moduleId === 'market' && coverage.items.some(item=>item.id==='calculation'&&item.status==='covered'&&!hasMarketCalculationEvidence(item.calculationEvidence))) {
    return { ...coverage, items: coverage.items.map(item=>item.id==='calculation'?{...item,status:'partial',note:'Полный численный расчёт TAM, SAM и SOM с подстановкой входов ещё не подтверждён.'}:item), nextCriterionId: coverage.nextCriterionId ?? 'calculation' };
  }
  return coverage;
}

/** A freshness fingerprint, not an authenticity or semantic proof. Includes edits and new constraints. */
export function coverageBasis(project: Project, moduleId: ModuleId): string {
  const latest = new Map<string, { revision: number; content: string }>();
  for (const message of project.core?.sourceMessages ?? []) {
    if (message.role !== 'user' || message.generation !== (project.modules[message.moduleId].generation ?? 0)) continue;
    const key = `${message.moduleId}:${message.generation}:${message.messageId}`;
    if ((latest.get(key)?.revision ?? 0) <= message.revision) latest.set(key, { revision: message.revision, content: message.content });
  }
  // Legacy conversations may not yet have been archived.
  for (const [id, state] of Object.entries(project.modules)) for (const message of state.messages) if (message.role === 'user') {
    const key = `${id}:${state.generation ?? 0}:${message.id}`;
    if ((latest.get(key)?.revision ?? 0) <= (message.revision ?? 1)) latest.set(key, { revision: message.revision ?? 1, content: message.content });
  }
  const body = JSON.stringify([project.id, moduleId, project.modules[moduleId].generation ?? 0, project.core?.revision ?? 0,
    project.name, project.description, Object.entries(project.facts).sort(([a], [b]) => a.localeCompare(b)),
    [...latest].sort(([a], [b]) => a.localeCompare(b)),
    Object.entries(project.modules).filter(([id]) => id !== moduleId).map(([id, state]) => [id, state.artifact?.revision ?? null, state.artifact?.body ?? null, state.artifact?.stale ?? null]),
  ]);
  let hash = 2166136261;
  for (let index = 0; index < body.length; index++) hash = Math.imul(hash ^ body.charCodeAt(index), 16777619);
  return `coverage-v1-${(hash >>> 0).toString(16)}`;
}

/** Last saved assessment for display only. It does not establish current readiness. */
export function savedCoverage(project: Project, moduleId: ModuleId): TopicCoverage | undefined {
  const coverage = project.modules[moduleId].memory?.content.coverage;
  if (!coverage || coverage.moduleId !== moduleId) return undefined;
  let upgraded = upgradeTopicCoverage(coverage);
  if (moduleId==='market') {
    const state=project.modules.market, sources=[...state.messages.map(message=>message.content),state.artifact?.body??'',state.proposal?.artifactDraft?.body??'',...(project.core?.sourceMessages.filter(message=>message.moduleId==='market'&&message.generation===(state.generation??0)).map(message=>message.content)??[])];
    upgraded={...upgraded,items:upgraded.items.map(item=>item.id==='calculation'&&item.status==='covered'&&!hasMarketCalculationEvidence(item.calculationEvidence,sources)?{...item,status:'partial',note:'Численный расчёт всех трёх уровней пока не подтверждён материалами этапа.'}:item)};
    if(upgraded.nextCriterionId===null&&upgraded.items.some(item=>item.id==='calculation'&&item.status==='partial'))upgraded.nextCriterionId='calculation';
  }
  return topicCoverageSchema.safeParse(upgraded).success ? upgraded : undefined;
}

export function currentCoverage(project: Project, moduleId: ModuleId): TopicCoverage | undefined {
  const memory = project.modules[moduleId].memory;
  if (!memory || memory.needsRefresh || memory.coverageBasis !== coverageBasis(project, moduleId)) return undefined;
  return savedCoverage(project, moduleId);
}

export function currentReview(project: Project, moduleId: ModuleId) {
  const memory = project.modules[moduleId].memory;
  if (!memory || memory.needsRefresh || memory.coverageBasis !== coverageBasis(project, moduleId)) return undefined;
  if (memory.content.coverage && !topicCoverageSchema.safeParse(memory.content.coverage).success) return undefined;
  return memory.content.review;
}

export function isTopicComplete(project: Project, moduleId: ModuleId): boolean {
  const coverage = currentCoverage(project, moduleId);
  const review = currentReview(project, moduleId);
  return Boolean(coverage?.items.length && coverage.items.every(item => item.status === 'covered')
    && review?.status !== 'unavailable' && review?.process?.status !== 'needs_work' && review?.result?.status !== 'needs_work');
}

/** A route milestone survives new context; the topic's live coverage can still change. */
export function wasTopicCompleted(project: Project, moduleId: ModuleId): boolean {
  return Boolean(project.modules[moduleId].completedAt) || isTopicComplete(project, moduleId);
}
