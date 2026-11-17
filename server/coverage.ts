import { TOPIC_CRITERIA, upgradeTopicCoverage, hasMarketCalculationEvidence } from '../shared/coverage.js';
import type { AssistantReply, ChatRequest, ExternalEvidence, TopicCoverage } from '../shared/types.js';

/** Literal support is checked here; semantic sufficiency remains a model assessment. */
export function groundCoverage(coverage: TopicCoverage, request: ChatRequest, reply: AssistantReply, evidence: ExternalEvidence[]): TopicCoverage | undefined {
  if (coverage.moduleId !== request.moduleId) return undefined;
  coverage = upgradeTopicCoverage(coverage);
  const normalized = (text: string) => text.toLocaleLowerCase('ru').replace(/\s+/g, ' ').trim();
  const latest = new Map<string, NonNullable<ChatRequest['coreContext']>['sourceMessages'][number]>();
  for (const source of request.coreContext?.sourceMessages ?? []) {
    const key = `${source.moduleId}:${source.generation}:${source.messageId}`;
    if ((latest.get(key)?.revision ?? 0) <= source.revision) latest.set(key, source);
  }
  const user = [request.message, request.context.description,
    ...(request.coreContext ? [...latest.values()].filter(source => source.role === 'user').map(source => source.content) : request.context.history.filter(message => message.role === 'user').map(message => message.content)),
    ...(request.coreContext ? [] : (request.context.memories ?? []).filter(memory => !memory.needsRefresh).flatMap(memory => memory.content.facts.map(fact => fact.evidence))),
  ].map(normalized);
  const assistant = [reply.message, reply.artifactDraft?.body ?? '', request.context.currentDraft?.body ?? '',
    ...request.context.artifacts.map(artifact => artifact.body),
    ...request.context.history.filter(message => message.role === 'assistant').map(message => message.content),
    ...[...latest.values()].filter(source => source.role === 'assistant').map(source => source.content),
  ].map(normalized);
  const supported=(support: TopicCoverage['items'][number]['support'])=>Boolean(support&&(support.role==='user'?user:assistant).some(text=>text.includes(normalized(support.quote))));
  const previous=request.context.memories?.find(memory=>memory.moduleId===request.moduleId&&!memory.needsRefresh)?.content.coverage;
  const items = coverage.items.map(item => {
    const criterion = TOPIC_CRITERIA[request.moduleId].find(criterion => criterion.id === item.id)!;
    if (item.status==='covered'&&item.support&&!supported(item.support)) {
      // The judge still considers the criterion covered, but paraphrased its
      // quote. Reuse only an existing literal support that remains in context;
      // never override an explicit missing/partial verdict or a changed choice.
      const prior=previous?.moduleId===request.moduleId?previous.items.find(value=>value.id===item.id&&value.status==='covered'):undefined;
      if(prior&&supported(prior.support))item={...item,support:prior.support};
    }
    if (item.support && !supported(item.support)) {
      return { ...item, status: 'missing' as const, support: null, note: 'Пока недостаточно сведений для этого пункта.' };
    }
    if (item.status === 'covered' && criterion.needsUserChoice && item.support?.role !== 'user') {
      return { ...item, status: 'partial' as const, note: 'Вариант предложен; нужно решение пользователя.' };
    }
    if (item.status === 'covered' && criterion.needsResearch && !evidence.some(source => source.retrieval === 'read')) {
      return { ...item, status: 'partial' as const, note: 'Для завершения нужны прочитанные источники.' };
    }
    if(request.moduleId==='market'&&item.id==='calculation'&&item.status==='covered'&&!hasMarketCalculationEvidence(item.calculationEvidence,[...user,...assistant])) {
      return {...item,status:'partial' as const,note:'Нужны численные результаты и подстановка входов для TAM, SAM и SOM; формул или одного SOM недостаточно.'};
    }
    return item;
  });
  const eligible = (id: string | null) => TOPIC_CRITERIA[request.moduleId].find(criterion => criterion.id === id)?.dependsOn?.every(dependency => items.some(item => item.id === dependency && item.status !== 'missing')) ?? true;
  const nextCriterionId = items.some(item => item.id === coverage.nextCriterionId && item.status !== 'covered') && eligible(coverage.nextCriterionId)
    ? coverage.nextCriterionId : items.find(item => item.status !== 'covered' && eligible(item.id))?.id ?? null;
  return { ...coverage, items, nextCriterionId };
}

export const COVERAGE_DIALOGUE_GUIDANCE = `Критерии contextCoverage.criteria — постоянная предметная цель текущего этапа. Покрытие темы управляет следующим полезным ходом, а не число сообщений или наличие заголовков. Перед ответом сопоставь ВСЕ критерии с актуальными вводными, исправлениями и работой, которую покажешь в этом ответе. Одна реплика может раскрыть несколько критериев. contextCoverage.previous — предыдущее состояние обсуждения, не проверенные факты; переоцени его при новых вводных. На явный вопрос/поручение сначала ответь по существу.
Выбери самый существенный пробел для ближайшего результата. Если нужны сведения, уже имеющиеся в контексте, используй их. Если нужно решение, предложи варианты и помоги рассуждением. Если нужен внешний факт — используй доступное исследование; расчёт выполни сам. Только личный существенный пробел требует вопроса. На «не знаю» меняй способ помощи: объяснение, пример, сравнение или обратимое допущение. Не возвращай уже выбранный вариант в открытые вопросы. Следующий ход должен продвигать критерий конкретной работой, а не пересказом и домашним заданием.
Когда все критерии достаточно раскрыты с учётом работы в текущем ответе, прекрати обязательные уточнения. Не выводи карточку идеи, длинный итог или отдельный документ по собственной инициативе. Сохрани существенные вводные, решения, гипотезы и неизвестное в memory/memoryOperations; при необходимости собери или обнови полный artifactDraft как внутренний контекст, без показа карточки. Верни choices=[] и коротко сообщи, что в целом понял тему и можно продолжить здесь по желанию. После независимой проверки интерфейс сообщит об открытии следующей темы и предложит переход. Не проси сохранить итог или подтвердить формулировку ещё раз. Следующая тема открывается при полном покрытии предыдущей; между уже открытыми темами можно свободно переключаться. Не объявляй тему завершённой, если остался существенный пробел. Явное новое поручение или исправление исполняй и после полного покрытия. Если пользователь сам просит итог, сравнение или другой материал, покажи содержательный результат непосредственно в message.`;

export const INDEPENDENT_COVERAGE_GUIDANCE = `${COVERAGE_DIALOGUE_GUIDANCE}
Полноту темы и качество помощи после ответа оценит отдельный проверяющий. Не возвращай memory.coverage или memory.review: авторская самооценка не используется. Сохрани предметные критерии как ориентир разговора. Учитывай зависимости критериев; предложение не становится выбором пользователя, гипотеза — подтверждённым фактом. Когда материала достаточно, сохрани рабочую формулировку во внутреннем контексте; отдельная карточка и ручное сохранение не нужны.`;

export const COVERAGE_GUIDANCE = `${COVERAGE_DIALOGUE_GUIDANCE}
В memory.coverage верни rubricVersion=1, текущий moduleId и каждый переданный criterion.id ровно один раз. missing — ещё нет существенного содержания; partial — есть направление, но не хватает конкретики/выбора/оснований; covered — достаточно по sufficient для текущего результата. note — одно короткое объяснение конкретики или пробела, без процентов, выдуманных фактов и терминов реализации. Для covered обязателен support с дословным коротким фрагментом пользовательского контекста (role=user) либо своего содержательного ответа/черновика (role=assistant). Цитата должна реально раскрывать критерий: упоминание темы не считается. Для missing support=null. Гипотеза решения может быть обсуждена, оставаясь гипотезой. Критерии needsUserChoice закрывай только по существенному выбору пользователя, не своей рекомендации; support.role для них обязательно user с точной цитатой выбора, пересказ ассистента не заменяет пользовательский источник; needsResearch — только при реальных прочитанных основаниях. Не объявляй проводившийся поиск или проверенный спрос от аккуратной формулировки.
nextCriterionId — один оставшийся существенный критерий для следующего шага или null, если все достаточно раскрыты. Учитывай dependsOn: не выбирай критерий, пока его предпосылки missing. На старте без идеи ближайшая цель — найти участника/ситуацию или боль, а не выбирать границы ещё не появившегося решения. Выбирай по влиянию на результат и зависимостям, а не механически первый пункт. Когда материала достаточно, сохрани рабочую формулировку во внутреннем контексте, при необходимости в artifactDraft. Не выводи длинный итог без просьбы; повторное принятие и ручное сохранение не нужны. Полоса в панели показывает только покрытие обсуждения; это не доказательство спроса, правильности или жизнеспособности. Не превращай разговор в опросник по всем пунктам за один раз.`;
