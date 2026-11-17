export type MotionKind = 'feedback' | 'enter' | 'exit' | 'layout' | 'journey';

export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** CSS tokens are the source of timings for both CSS and Web Animations. */
export function motionTiming(element: Element, kind: MotionKind) {
  const tokens = getComputedStyle(element.ownerDocument.documentElement);
  const value = tokens.getPropertyValue(`--ds-motion-${kind}`).trim();
  const duration = prefersReducedMotion() ? 0 : (Number.parseFloat(value) || 0) * (value.endsWith('ms') ? 1 : 1000);
  const easing = tokens.getPropertyValue(kind === 'journey' ? '--ds-motion-ease-journey' : '--ds-motion-ease').trim() || 'linear';
  return { duration, easing };
}

export function animateMotion(element: Element, keyframes: Keyframe[], kind: MotionKind, options: Omit<KeyframeAnimationOptions, 'duration' | 'easing'> = {}) {
  const timing = motionTiming(element, kind);
  if (!element.animate || !timing.duration) return null;
  const animation = element.animate(keyframes, { ...options, ...timing });
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const cancel = () => { if (media?.matches) animation.cancel(); };
  const detach = () => media?.removeEventListener('change', cancel);
  media?.addEventListener('change', cancel);
  animation.addEventListener('finish', detach, { once: true });
  animation.addEventListener('cancel', detach, { once: true });
  return animation;
}
