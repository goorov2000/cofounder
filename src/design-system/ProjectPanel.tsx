import { useId, useLayoutEffect, useState } from 'react';
import { Calculator, CheckCircle2, ChevronDown, Circle, CircleDot } from 'lucide-react';
import type { ModuleId, Project, TopicCoverage } from '../../shared/types';
import { MODULES, STAGE_IDS } from '../../shared/modules';
import { currentCoverage, currentReview, savedCoverage, isTopicComplete, wasTopicCompleted, TOPIC_CRITERIA } from '../../shared/coverage';
import { RoutePanel } from '../components/layout/RoutePanel';
import { InfoHint } from './InfoHint';
import { Disclosure } from './Disclosure';
import './project-panel.css';

export interface ProjectPanelProps {
  project: Project;
  onModuleChange: (module: ModuleId) => void;
  onCalculator: () => void;
  coverageUpdate?: { reviewing: boolean; previous?: TopicCoverage };
}

export function ProjectPanel({ project, onModuleChange, onCalculator, coverageUpdate }: ProjectPanelProps) {
  const panelId = useId();
  const routeId = `${panelId}-route`;
  const coverageId = `${panelId}-coverage`;
  const contextId = `${panelId}-context`;
  const started = Boolean(project.modules[project.activeModule].messages.length);
  const [expanded, setExpanded] = useState<'route' | 'coverage' | 'context' | null>(started ? 'coverage' : 'route');
  // Only the start/reset or a different conversation changes the default.
  // Further replies and coverage updates preserve the user's manual selection.
  useLayoutEffect(() => setExpanded(started ? 'coverage' : 'route'), [project.id, project.activeModule, started]);
  const toggle = (section: 'route' | 'coverage' | 'context') => setExpanded(current => current === section ? null : section);
  const current = project.modules[project.activeModule];
  const memory = current.memory?.content;
  // Keep the last assessment visible when later conversations change its basis.
  // Only currentCoverage can establish readiness or supply fresh prompt context.
  const freshCoverage = currentCoverage(project, project.activeModule);
  const coverage = freshCoverage ?? coverageUpdate?.previous ?? savedCoverage(project, project.activeModule);
  const previousCoverage = Boolean(coverage && !freshCoverage);
  const review = coverageUpdate ? undefined : currentReview(project, project.activeModule);
  const criteria = TOPIC_CRITERIA[project.activeModule];
  const covered = coverage?.items.filter(item => item.status === 'covered').length ?? 0;
  const next = criteria.find(criterion => criterion.id === coverage?.nextCriterionId);
  const stage = STAGE_IDS.findIndex(id => id === project.activeModule);
  const completed = new Set(STAGE_IDS.filter(id => wasTopicCompleted(project, id)));

  return <div className="ds-project-panel">
    <section className="ds-project-route" data-expanded={expanded === 'route'} aria-labelledby={`${routeId}-heading`}>
      <div className="ds-project-accordion-heading">
        <h3><button id={`${routeId}-heading`} type="button" className="ds-button ds-project-accordion-toggle" aria-expanded={expanded === 'route'} aria-controls={routeId} onClick={() => toggle('route')}>Маршрут проекта<ChevronDown size={16} aria-hidden="true" /></button></h3>
        <InfoHint label="О маршруте проекта">Девять тем от идеи до MVP. Следующая тема открывается после полной проработки предыдущей. Между уже открытыми темами можно переключаться в любой момент. Полоса показывает пройденные темы. Уточнения могут изменить текущую оценку проработки; доступ сохраняется.</InfoHint>
      </div>
      <div className="ds-project-route-overview">
        <span className="ds-project-current"><strong>{MODULES[project.activeModule].shortTitle}</strong><span>{stage >= 0 ? `Этап ${stage + 1} из ${STAGE_IDS.length}` : 'Инструмент'}</span></span>
        <span className="ds-project-progress" aria-hidden="true">{STAGE_IDS.map(id => <span key={id} className={completed.has(id) ? 'is-saved' : project.activeModule === id ? 'is-current' : ''} />)}</span>
        <span className="ds-project-progress-label">Пройдено {completed.size} из {STAGE_IDS.length}<span>Маршрут</span></span>
      </div>
      <Disclosure id={routeId} open={expanded === 'route'}><RoutePanel project={project} onModuleChange={onModuleChange} compact /></Disclosure>
    </section>
    <section className="ds-project-section ds-project-coverage" aria-labelledby={`${coverageId}-heading`}>
      <div className="ds-project-accordion-heading">
        <h3><button id={`${coverageId}-heading`} type="button" className="ds-button ds-project-accordion-toggle" aria-expanded={expanded === 'coverage'} aria-controls={coverageId} onClick={() => toggle('coverage')}>Проработка темы<ChevronDown size={16} aria-hidden="true" /></button></h3>
        <InfoHint label="О проработке темы">Проработка текущей темы обновляется с ответом помощника. После изменения вводных прежняя оценка остаётся видна с пометкой до следующего ответа. Прогресс показывает обсуждённые критерии, а не подтверждённый спрос. Уточнения можно написать в чат.</InfoHint>
        {coverage && <span className="ds-project-coverage-count">{covered} из {criteria.length}</span>}
      </div>
      <div className="ds-project-progress ds-coverage-progress" role="progressbar" aria-label="Проработка темы" aria-busy={Boolean(coverageUpdate)} aria-valuemin={0} aria-valuemax={criteria.length} aria-valuenow={coverage ? covered : undefined} aria-valuetext={coverageUpdate ? coverage ? `Предыдущая оценка: ${covered} из ${criteria.length}. Обновляется` : 'Полнота темы оценивается' : previousCoverage ? `Предыдущая оценка: ${covered} из ${criteria.length}. Обновится со следующим ответом` : coverage ? `Обсуждено ${covered} из ${criteria.length} критериев` : 'Покрытие ещё не оценено'}>
        {criteria.map(criterion => <span key={criterion.id} className={coverage?.items.find(item => item.id === criterion.id)?.status === 'covered' ? 'is-saved' : criterion.id === next?.id ? 'is-current' : ''} />)}
      </div>
      {coverageUpdate && <p className="ds-coverage-notice" role="status">{coverageUpdate.reviewing ? 'Проверяю полноту темы…' : 'Проработка обновится после проверки ответа.'}{coverage ? ' Показана предыдущая оценка.' : ''}</p>}
      <Disclosure id={coverageId} open={expanded === 'coverage'} className="ds-project-memory ds-topic-coverage">
        {!coverage && !coverageUpdate && <p className="ds-coverage-notice">Ещё не оценено</p>}
        {previousCoverage && !coverageUpdate && <p className="ds-coverage-notice" role="status">Показана предыдущая оценка. Новые вводные учтём со следующим ответом.</p>}
        {next && !coverageUpdate && <p className="ds-coverage-next">{previousCoverage ? 'По предыдущей оценке осталось' : 'Сейчас'}: {next.label.toLocaleLowerCase('ru')}</p>}
        {!coverageUpdate && isTopicComplete(project, project.activeModule) && <p className="ds-coverage-next">Тема проработана. Можно перейти дальше или продолжить обсуждение.</p>}
        {review?.status === 'unavailable' && <p className="ds-coverage-notice" role="status">Ответ сохранён. Независимая проверка сейчас недоступна; полнота темы не оценена.</p>}
        {review?.status === 'completed' && <details className="ds-coverage-review">
          <summary>Независимая проверка · {review.result?.status === 'ready' ? 'итог готов' : review.process?.status === 'needs_work' || review.result?.status === 'needs_work' ? 'есть замечания' : coverage && covered === criteria.length ? 'основное обсуждено' : 'обсуждение продолжается'}</summary>
          <p><strong>Качество помощи:</strong> {review.process?.note}</p>
          {review.process?.checks.filter(check => check.status === 'failed').map(check => <p key={check.id}>{check.reason}</p>)}
          <p><strong>Результат:</strong> {review.result?.note}</p>
          {review.nextAction && <p><strong>Следующий шаг:</strong> {review.nextAction}</p>}
        </details>}
        <ul className="ds-coverage-list">{criteria.map(criterion => {
          const item = coverage?.items.find(item => item.id === criterion.id);
          const status = item?.status;
          const Icon = status === 'covered' ? CheckCircle2 : status === 'partial' ? CircleDot : Circle;
          const label = status === 'covered' ? 'Обсуждено' : status === 'partial' ? 'Частично' : status === 'missing' ? 'Впереди' : 'Не оценено';
          return <li key={criterion.id} className={criterion.id === next?.id ? 'is-next' : ''}>
            <details><summary><Icon size={15} aria-hidden="true" className={status === 'covered' ? 'is-covered' : ''} /><span>{criterion.label}</span><small>{label}</small></summary>
              <p>{item?.note ?? criterion.sufficient}</p>
              {item && <p className="ds-coverage-requirement">{criterion.sufficient}</p>}
            </details>
          </li>;
        })}</ul>
      </Disclosure>
    </section>
    <section className="ds-project-section ds-project-context" aria-labelledby={`${contextId}-heading`}>
      <div className="ds-project-accordion-heading">
        <h3><button id={`${contextId}-heading`} type="button" className="ds-button ds-project-accordion-toggle" aria-expanded={expanded === 'context'} aria-controls={contextId} onClick={() => toggle('context')}>Контекст проекта<ChevronDown size={16} aria-hidden="true" /></button></h3>
        <InfoHint label="О контексте проекта">Важные вводные и ваши решения обновляются с ответом помощника. Уточнения можно написать в чат.</InfoHint>
      </div>
      <Disclosure id={contextId} open={expanded === 'context'} className="ds-project-memory" label={`Контекст чата · ${MODULES[project.activeModule].shortTitle}`}>
        {current.memory?.needsRefresh && <p className="ds-project-memory-notice">Разговор изменён. Обновим контекст со следующим ответом.</p>}
        {memory?.facts.length ? <ul>{memory.facts.map((fact, i) => <li key={i}>{fact.text}</li>)}</ul>
          : <p className="ds-project-memory-empty">Здесь появятся важные вводные и ваши решения из разговора.</p>}
      </Disclosure>
    </section>
    {(project.activeModule === 'market' || project.activeModule === 'economics') && <div className="ds-project-section">
      <button type="button" className="ds-button ds-project-link" onClick={onCalculator}>
        <Calculator size={18} aria-hidden="true" /><span><strong>Расчёт</strong><small>{project.activeModule === 'market' ? 'Объём рынка и допущения' : 'Выручка, затраты и прибыль'}</small></span>
      </button>
    </div>}
  </div>;
}
