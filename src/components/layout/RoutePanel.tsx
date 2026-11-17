import { BriefcaseBusiness, Check, Coins, Lightbulb, LockKeyhole, Rocket, RotateCcw, Route, Swords, TrendingUp, UserRoundCheck, UsersRound, type LucideIcon } from 'lucide-react';
import type { ModuleId, Project, StageId } from '../../../shared/types';
import { wasTopicCompleted } from '../../../shared/coverage';
import { getUnlockedStages } from '../../../shared/domain';
import { MODULES, STAGE_IDS } from '../../../shared/modules';

const STAGE_ICONS: Record<StageId, LucideIcon> = {
  idea: Lightbulb,
  audience: UsersRound,
  competitors: Swords,
  market: TrendingUp,
  business: BriefcaseBusiness,
  economics: Coins,
  team: UserRoundCheck,
  roadmap: Route,
  mvp: Rocket,
};

export interface RoutePanelProps { project: Project; onModuleChange: (module: ModuleId) => void; compact?: boolean }
export function RoutePanel({ project, onModuleChange, compact = false }: RoutePanelProps) {
  const unlocked = new Set(getUnlockedStages(project));
  return <div className={`route-content${compact ? ' is-compact' : ''}`}>
    {!compact && <div className="route-heading"><h2>Маршрут проекта</h2><p className="route-project-name">{project.name}</p></div>}
    <ol className="stage-list">
      {STAGE_IDS.map(id => {
        const module = MODULES[id];
        const StageIcon = STAGE_ICONS[id];
        const artifact = project.modules[id].artifact;
        const complete = wasTopicCompleted(project, id);
        const allowed = unlocked.has(id);
        const current = project.activeModule === id;
        const status = complete ? 'Тема проработана' : artifact?.stale ? 'Контекст изменился' : current ? 'Вы здесь' : allowed ? 'Можно обсудить' : 'Пока недоступно';
        return <li key={id} className={`stage${current ? ' is-current' : ''}${!allowed ? ' is-locked' : ''}${artifact?.stale ? ' is-stale' : ''}`}>
          <button type="button" data-module={id} aria-label={module.shortTitle} aria-current={current ? 'step' : undefined} aria-disabled={!allowed} aria-describedby={`stage-status-${id}`} onClick={() => { if (allowed) onModuleChange(id); }}>
            <span className="stage-node" aria-hidden="true"><StageIcon size={20} strokeWidth={1.8} /></span>
            <span className="stage-copy">
              <span className="stage-title">
                {module.shortTitle}
                {complete ? <Check size={14} className="stage-result-icon" aria-label="Тема проработана" />
                  : artifact?.stale && <RotateCcw size={14} className="stage-result-icon" aria-label="Контекст изменился" />}
                {!allowed && <LockKeyhole size={12} aria-label="Пока недоступно" />}
              </span>
              {status && <span className="stage-status" id={`stage-status-${id}`}>{status}</span>}
            </span>
          </button>
        </li>;
      })}
    </ol>
  </div>;
}
