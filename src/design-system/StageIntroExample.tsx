import { useState } from 'react';
import { MODULES } from '../../shared/modules';
import { Button } from './components';
import { StageIntro } from './StageIntro';
import { useStageTitleTransition } from './useStageTitleTransition';

export function StageIntroExample() {
  const [started, setStarted] = useState(false);
  const { introTitle, headerTitle, captureTitle } = useStageTitleTransition('library-audience', started);
  const stage = MODULES.audience;
  return <div className="ds-stage-preview">
    <div className="ds-stage-preview-header">
      {started && <h3 className="ds-stage-title" ref={headerTitle}>{stage.title}</h3>}
      <Button size="sm" variant="ghost" onClick={() => setStarted(false)} disabled={!started}>Повторить пример</Button>
    </div>
    <div className="ds-stage-preview-body">{started
      ? <p>Здесь начинается разговор о целевой аудитории.</p>
      : <StageIntro title={stage.title} description={stage.welcome} titleRef={introTitle} actions={<Button onClick={() => { captureTitle(); setStarted(true); }}>Начать этап</Button>} />}
    </div>
  </div>;
}
