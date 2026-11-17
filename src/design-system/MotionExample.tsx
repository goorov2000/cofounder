import { useState } from 'react';
import { createProject } from '../../shared/domain';
import { Button, Card } from './components';
import { ProjectPanel } from './ProjectPanel';
import { useMedia } from '../hooks/useMedia';

export function MotionExample() {
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const [project, setProject] = useState(createProject);
  const started = Boolean(project.modules.idea.messages.length);
  return <Card title="От маршрута к проработке" description="До первого сообщения открыт маршрут. Начало разговора переключает панель; последующие ответы сохраняют выбранный раздел.">
    <div className="ds-motion-example">
      <div className="ds-example-stack">
        <p role="status">{reduced ? 'Движение отключено настройкой устройства.' : 'Движение включено.'}</p>
        <p>Отклик — 140 мс. Раскрытие — 280 мс. Перенос заголовка — 420 мс.</p>
        <div className="ds-example-row"><Button onClick={() => setProject(p => ({ ...p, modules: { ...p.modules, idea: { ...p.modules.idea, messages: [...p.modules.idea.messages, { id: crypto.randomUUID(), role: 'user', content: 'Давайте проработаем идею.', createdAt: new Date().toISOString() }] } } }))}>{started ? 'Добавить ответ в пример' : 'Отправить первое сообщение в пример'}</Button><Button disabled={!started} onClick={() => setProject(createProject())}>Вернуть первый экран</Button></div>
        <p>Раскройте маршрут или контекст вручную и добавьте ещё один ответ: выбранный раздел останется открытым.</p>
      </div>
      <ProjectPanel project={project} onModuleChange={activeModule => setProject(p => ({ ...p, activeModule }))} onCalculator={() => {}} />
    </div>
  </Card>;
}
