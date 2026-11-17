import { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import './info-hint.css';

export function InfoHint({ label, children }: { label: string; children: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const cancelHide = () => clearTimeout(hideTimer.current);
  const hide = () => { cancelHide(); tip.current?.hidePopover(); };
  function show() {
    cancelHide();
    if (!trigger.current || !tip.current) return;
    const box = trigger.current.getBoundingClientRect();
    tip.current.showPopover();
    const { width, height } = tip.current.getBoundingClientRect();
    tip.current.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`;
    tip.current.style.top = `${Math.max(8, box.bottom + height + 16 <= window.innerHeight ? box.bottom + 8 : box.top - height - 8)}px`;
  }
  function scheduleHide() {
    cancelHide();
    if (document.activeElement !== trigger.current) hideTimer.current = setTimeout(hide, 120);
  }
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  useEffect(() => {
    if (!open) return;
    const close = () => tip.current?.hidePopover();
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [open]);
  return <div className="ds-info-hint" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); hide(); }
  }}>
    <button ref={trigger} type="button" className="ds-button ds-info-hint-trigger" aria-label={label} aria-describedby={id}
      onPointerEnter={event => { if (event.pointerType === 'mouse') show(); }} onPointerLeave={scheduleHide}
      onFocus={show} onBlur={hide} onClick={show}><Info size={14} aria-hidden="true" /></button>
    <div ref={tip} id={id} popover="auto" role="tooltip" className="ds-info-hint-content"
      onToggle={event => setOpen(event.newState === 'open')} onPointerEnter={cancelHide} onPointerLeave={scheduleHide}>{children}</div>
  </div>;
}
