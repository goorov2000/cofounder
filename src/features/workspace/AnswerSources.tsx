import { useId, useRef } from 'react';
import type { Message } from '../../../shared/types';
import { MODULES } from '../../../shared/modules';
import { isHttpUrl, PROVENANCE_LABELS } from '../../../shared/validation';
import { Markdown } from '../../components/ui/Markdown';

export function AnswerSources({ message }: { message: Message }) {
  const sourcePrefix = useId();
  const historyCards = useRef(new Map<string, HTMLDetailsElement>());
  const request = message.request;
  const facts = request?.context.facts ?? [];
  const links = [...facts.map(fact => ({ ...fact, fromModel: false })), ...(message.reply?.proposedFacts ?? []).map(fact => ({ ...fact, fromModel: true }))]
    .filter(fact => fact.sourceUrl && isHttpUrl(fact.sourceUrl));
  const evidence = message.reply?.externalSources ?? [];
  const research = message.reply?.research;
  const history = (message.reply?.historySources ?? []).map(item => ({ ...item,
    anchor: `${sourcePrefix}-history-${encodeURIComponent(JSON.stringify([item.source.projectId, item.source.moduleId, item.source.generation, item.source.messageId, item.source.revision]))}`,
    label: `Реплика ${item.source.role === 'user' ? 'пользователя' : 'AI'} · ${MODULES[item.source.moduleId].shortTitle} · ${item.source.createdAt} · версия ${item.source.revision}`,
  }));
  return <div className="workspace-answer-sources">
    {!!history.length && <section aria-label="Исходные реплики">
      <h3>Исходные реплики</h3>
      <p>Совпадения цитат этого ответа с историей. Сохранённая реплика показывает, что было сказано тогда.</p>
      {history.some((item, index) => history.some((other, otherIndex) => otherIndex !== index && item.quotes.some(quote => other.quotes.includes(quote)))) && <p>Одна цитата встречается в нескольких репликах. Нельзя однозначно выбрать одну; ниже показаны все совпадающие источники.</p>}
      {history.map(item => <p key={item.anchor}><a href={`#${item.anchor}`} onClick={event => {
        const card = historyCards.current.get(item.anchor);
        if (!card) return;
        event.preventDefault();
        card.open = true;
        const original = card.querySelector<HTMLElement>('[data-history-original]');
        original?.focus({ preventScroll: true });
        original?.scrollIntoView?.({ block: 'nearest' });
      }}>Открыть исходную реплику: {item.label}</a></p>)}
      {history.map(item => <details key={item.anchor} ref={element => {
        if (element) historyCards.current.set(item.anchor, element);
        else historyCards.current.delete(item.anchor);
      }}>
        <summary>{item.label}</summary>
        {item.quotes.map(quote => <blockquote key={quote}>{quote}</blockquote>)}
        <p><strong>Полная исходная реплика</strong></p>
        <p id={item.anchor} data-history-original tabIndex={-1} aria-label="Полная исходная реплика" className="workspace-source-original">{item.source.content}</p>
      </details>)}
    </section>}
    {research && research.status !== 'not_needed' ? <section>
      <h3>{research.status === 'completed' ? 'Внешнее исследование' : 'Исследование не завершено'}</h3>
      <p>Ниже результаты получения страниц сервером. Прочитанная страница не означает, что сведения проверены пользователем.</p>
      {research.limitations.map((text, index) => <p key={index}>{text}</p>)}
    </section> : <p>Веб-поиск не использовался. Материалы ниже были переданы AI для ответа; это не независимая проверка информации.</p>}
    {!!evidence.length && <section><h3>Внешние страницы</h3>{evidence.map(source => <details key={`${source.id}:${source.version}`} open>
      <summary>{isHttpUrl(source.url) ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a> : source.title}</summary>
      <p>{source.retrieval === 'read' ? 'Страница прочитана' : source.retrieval === 'search_snippet' ? 'Только поисковый фрагмент; страница не прочитана' : 'Страница недоступна'} · версия {source.version}</p>
      <p>Получено: {source.retrievedAt}. Опубликовано: {source.publishedAt ?? 'дата неизвестна'}. Действует с: {source.effectiveAt ?? 'дата неизвестна'}.</p>
      {source.quotes.map(quote => <blockquote key={quote.id}>{quote.text}</blockquote>)}
      {message.reply?.externalClaims?.filter(claim => claim.evidenceId === source.id && claim.version === source.version).map((claim, index) => <div key={index}>
        <p>{claim.text}</p>
        {claim.price && <p>Цена: {claim.price.amount} {claim.price.currency} / {claim.price.unit} / {claim.price.period}. Оплата: {claim.price.paymentTerms}.</p>}
      </div>)}
      {source.limitations.map((text, index) => <p key={index}>{text}</p>)}
    </details>)}</section>}
    {!!request?.coreContext?.entries.length && <details><summary>Решения и точные основания</summary>{request.coreContext.entries.map(entry => {
      const current = request.coreContext!.currentEntryRefs.some(ref => ref.id === entry.id && ref.version === entry.version);
      return <div key={`${entry.id}:${entry.version}`}><p>{entry.text} · версия {entry.version}{current ? '' : ' · прежняя версия'} · {entry.epistemic === 'hypothesis' ? 'гипотеза' : entry.epistemic === 'unknown' ? 'неизвестно' : 'сведения с указанным основанием'}{entry.acceptance === 'rejected' ? ' · отклонено' : entry.acceptance === 'proposed' ? ' · предложение' : ''}</p>
        {entry.sources.map((source, index) => source.type === 'message' ? <div key={index}><p>Реплика {request.coreContext?.sourceMessages.find(item => item.messageId === source.messageId && item.revision === source.revision)?.role === 'assistant' ? 'AI' : 'пользователя'} · {MODULES[source.moduleId].shortTitle} · версия {source.revision}</p><blockquote>{source.quote}</blockquote></div> : source.type === 'legacy' ? <div key={index}><p>Унаследованное основание: {source.label}</p><blockquote>{source.quote}</blockquote></div> : <p key={index}>Внешний источник · версия {source.version} · фрагмент {source.quoteId}</p>)}
      </div>;
    })}</details>}

    {!request && <p>Для этого старого ответа снимок исходных материалов не сохранился.</p>}
    {!!message.reply?.knowledgeSources?.length && <section><h3>Из базы знаний</h3><p>Внутренние методические заметки CoFounder, подобранные к запросу. Это рекомендации по работе над проектом, не проверенные сведения о рынке.</p>{message.reply.knowledgeSources.map(source => <details key={source.id}><summary>{source.title}</summary><p>Версия {source.version}</p><Markdown>{source.body}</Markdown></details>)}</section>}
    {!!message.reply?.memory?.facts.length && <details><summary>На чём основан контекст разговора</summary>{message.reply.memory.facts.map((fact, index) => <div key={index}><p>{fact.text}</p><blockquote>{fact.evidence}</blockquote></div>)}</details>}
    {!!links.length && <section><h3>Ссылки в материалах</h3>{links.map((fact, index) => <p key={index}><a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer">{fact.key}</a> · {fact.fromModel ? 'Ссылка предложена AI; проверьте её.' : PROVENANCE_LABELS[fact.provenance]}{fact.checkedAt ? ` · ${fact.checkedAt}` : ''}<br />{fact.note}</p>)}</section>}
    {request && <>
      <details><summary>Запрос пользователя</summary><Markdown>{request.message}</Markdown></details>
      {!!request.context.history.length && <details><summary>Предыдущие сообщения · {request.context.history.length}</summary>{request.context.history.map((item, index) => <div key={index}><strong>{item.role === 'user' ? 'Вы' : 'AI'}</strong><Markdown>{item.content}</Markdown></div>)}</details>}
      {!!request.context.description && <details><summary>Описание проекта</summary><Markdown>{request.context.description}</Markdown></details>}
      {request.context.memories?.map(memory => <details key={memory.moduleId}><summary>Контекст чата · {MODULES[memory.moduleId].shortTitle}{memory.needsRefresh ? ' · требует обновления' : ''}</summary>
        {memory.content.facts.map((fact, i) => <p key={i}>{fact.text}<br /><small>Со слов пользователя: «{fact.evidence}»</small></p>)}
        {!!memory.content.hypotheses.length && <p>Предположения: {memory.content.hypotheses.join('; ')}</p>}
        {!!memory.content.openQuestions.length && <p>Осталось уточнить: {memory.content.openQuestions.join('; ')}</p>}
      </details>)}
      {!!facts.length && <details><summary>Общие решения и расчёты · {facts.length}</summary>{facts.map((fact, index) => <p key={index}><strong>{fact.key}: </strong>{fact.value}<br />{PROVENANCE_LABELS[fact.provenance]} · {fact.note || 'Основание не указано'}</p>)}</details>}
      {request.context.artifacts.map(artifact => <details key={artifact.moduleId}><summary>{MODULES[artifact.moduleId].shortTitle}: {artifact.title}{artifact.stale ? ' · требует пересмотра' : ''}</summary><Markdown>{artifact.body}</Markdown></details>)}
    </>}
  </div>;
}
