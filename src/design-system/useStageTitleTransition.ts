import { useLayoutEffect, useRef } from 'react';
import { animateMotion, prefersReducedMotion } from './motion';

/** Capture only on a successful first send; navigation and draft edits never animate. */
export function useStageTitleTransition(identity: string, started: boolean) {
  const introTitle = useRef<HTMLHeadingElement>(null);
  const headerTitle = useRef<HTMLHeadingElement>(null);
  const origin = useRef<{ identity: string; rect: DOMRect; font: string; size: string; spacing: string; leading: string; color: string } | null>(null);

  function captureTitle() {
    const title = introTitle.current;
    if (!title || !title.animate || prefersReducedMotion()) return;
    const style = getComputedStyle(title);
    origin.current = { identity, rect: title.getBoundingClientRect(), font: style.font, size: style.fontSize, spacing: style.letterSpacing, leading: style.lineHeight, color: style.color };
  }

  useLayoutEffect(() => {
    const source = origin.current;
    origin.current = null;
    const target = headerTitle.current;
    if (!started || !source || source.identity !== identity || !target || !target.animate || prefersReducedMotion()) return;
    const rect = target.getBoundingClientRect();
    const style = getComputedStyle(target);
    const moving = document.createElement('div');
    moving.className = 'ds-stage-title ds-stage-title-flight';
    moving.textContent = target.textContent;
    moving.setAttribute('aria-hidden', 'true');
    Object.assign(moving.style, { font: source.font, color: source.color, textAlign: 'center' });
    document.body.append(moving);
    target.style.visibility = 'hidden';
    const animation = animateMotion(moving, [
      { left: `${source.rect.left}px`, top: `${source.rect.top}px`, width: `${source.rect.width}px`, height: `${source.rect.height}px`, fontSize: source.size, letterSpacing: source.spacing, lineHeight: source.leading },
      { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, fontSize: style.fontSize, letterSpacing: style.letterSpacing, lineHeight: style.lineHeight },
    ], 'journey', { fill: 'both' });
    const clear = () => { moving.remove(); target.style.removeProperty('visibility'); };
    if (!animation) { clear(); return; }
    const cancel = () => { animation.cancel(); clear(); };
    animation.onfinish = clear;
    animation.oncancel = clear;
    window.addEventListener('resize', cancel);
    return () => { window.removeEventListener('resize', cancel); cancel(); };
  }, [identity, started]);

  return { introTitle, headerTitle, captureTitle };
}
