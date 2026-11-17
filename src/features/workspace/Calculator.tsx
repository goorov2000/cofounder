import { CalculationWorkbench } from '../../design-system/CalculationWorkbench';
import type { StoredCalculation } from '../../../shared/calculationScenario';
import { useWorkspace } from '../../state';

export function Calculator({ moduleId, onDiscuss }: { moduleId: 'market' | 'economics'; onDiscuss?: () => void }) {
  const { project, setProject } = useWorkspace();
  return <CalculationWorkbench moduleId={moduleId} stored={project.calculations[moduleId] as StoredCalculation | undefined} onDiscuss={onDiscuss} onChange={report => setProject(p => ({ ...p,
    modules: Object.fromEntries(Object.entries(p.modules).map(([id, state]) => [id, state.artifact ? { ...state, artifact: { ...state.artifact, stale: true, staleReason: 'Изменены входные данные числового сценария. Сверьте расчёт и выводы.' } } : state])) as typeof p.modules,
    calculations: { ...p.calculations, [moduleId]: report },
  }))} />;
}
