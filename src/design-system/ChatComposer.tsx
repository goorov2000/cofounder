import { useCallback, useId, useLayoutEffect, useRef, type RefObject } from 'react';
import { ArrowUp, Mic, Square } from 'lucide-react';
import { Button } from './components';
import { IconButton } from '../components/ui/IconButton';

interface ChatComposerProps {
  value: string;
  onChange(value: string): void;
  onSend(): void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  busy?: boolean;
  onCancel?(): void;
  onDictate?(): void;
  listening?: boolean;
  voiceSupported?: boolean;
  voiceStatus?: string;
  label?: string;
  placeholder?: string;
  sendLabel?: string;
  className?: string;
}

export function ChatComposer({ value, onChange, onSend, inputRef, disabled, busy, onCancel, onDictate, listening,
  voiceSupported = true, voiceStatus, label = 'Сообщение', placeholder = 'Напишите сообщение…', sendLabel = 'Отправить', className = '' }: ChatComposerProps) {
  const id = useId();
  const localRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLTextAreaElement>(null);
  const field = inputRef ?? localRef;
  const canSend = !disabled && !busy && !!value.trim();
  const resize = useCallback(() => {
    const element = field.current;
    const measure = measureRef.current;
    if (!element || !measure) return;
    // Measure outside the flow: collapsing the focused input moves the browser's scroll position.
    measure.style.width = `${element.getBoundingClientRect().width}px`;
    const border = element.offsetHeight - element.clientHeight;
    const height = `${Math.max(24, Math.min(measure.scrollHeight + border, 160))}px`;
    if (element.style.height !== height) element.style.height = height;
  }, [field]);
  useLayoutEffect(resize, [value, resize]);
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    let active = true;
    // A restored draft may wrap differently once the local font has loaded,
    // even though the field's width has not changed.
    void document.fonts?.ready.then(() => { if (active) resize(); });
    if (typeof ResizeObserver === 'undefined') return () => { active = false; };
    let width: number | undefined;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width;
      if (width === undefined || Math.abs(next - width) > 0.5) {
        width = next;
        // Changing the textarea height also resizes the observed compose area.
        // Defer width-driven writes so its ancestor can be measured next frame.
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(resize);
      }
    });
    observer.observe(element);
    return () => { active = false; observer.disconnect(); cancelAnimationFrame(frame); };
  }, [field, resize]);
  const voiceLabel = listening ? 'Остановить диктовку' : voiceSupported ? 'Надиктовать' : 'Диктовка недоступна';
  return <form className={`ds-chat-composer ${className}`} onSubmit={event => { event.preventDefault(); if (canSend) onSend(); }}>
    <label className="sr-only" htmlFor={id}>{label}</label>
    <textarea id={id} ref={field} rows={1} maxLength={8000} value={value} placeholder={placeholder}
      aria-describedby={voiceStatus ? `${id}-voice` : undefined}
      onChange={event => onChange(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          if (canSend) onSend();
        }
      }} />
    <textarea className="ds-composer-measure" ref={measureRef} rows={1} value={value} readOnly aria-hidden="true" tabIndex={-1} />
    <div className="ds-composer-actions">
      {onDictate && <IconButton label={voiceLabel} aria-pressed={!!listening} className={`ds-composer-mic${listening ? ' is-listening' : ''}`} onClick={onDictate}><Mic size={21} aria-hidden="true" /></IconButton>}
      {busy && onCancel
        ? <Button className="ds-composer-send" variant="primary" aria-label="Прервать ожидание" title="Прервать ожидание" onClick={event => {
          // Cancellation can replace this node with the submit button before the click finishes.
          event.preventDefault();
          onCancel();
        }}><Square size={16} fill="currentColor" aria-hidden="true" /></Button>
        : <Button className="ds-composer-send" variant="primary" type="submit" disabled={!canSend} aria-label={sendLabel} title={sendLabel}><ArrowUp size={23} aria-hidden="true" /></Button>}
    </div>
    {voiceStatus && <p className={listening ? 'sr-only' : 'ds-composer-voice'} role="status" id={`${id}-voice`}>{voiceStatus}</p>}
  </form>;
}
