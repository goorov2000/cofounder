import type { ReactNode, Ref } from 'react';
import './stage-intro.css';

export function StageIntro({ title, description, titleRef, actions, children }: {
  title: string; description: string; titleRef?: Ref<HTMLHeadingElement>; actions: ReactNode; children?: ReactNode;
}) {
  return <div className="ds-stage-intro">
    <h1 className="ds-stage-title" ref={titleRef}>{title}</h1>
    <p className="ds-stage-intro-description">{description}</p>
    <div className="ds-stage-intro-actions">{actions}</div>
    {children}
  </div>;
}
