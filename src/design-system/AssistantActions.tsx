import { useId, useRef, useState, type ReactNode } from 'react';
import { BookOpen, Check, Copy, MoreHorizontal, RefreshCw, Share, Square, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { Modal } from '../components/ui/Modal';
import { useMessageTransfer } from './useMessageTransfer';

interface AssistantActionsProps {
  text: string;
  feedback?: 'up' | 'down';
  onFeedback(value: 'up' | 'down' | undefined): void;
  onRegenerate(): void;
  regenerateDisabled?: boolean;
  onRead(text: string): void;
  speaking?: boolean;
  voiceError?: string;
  sources: ReactNode;
}

export function AssistantActions({ text, feedback, onFeedback, onRegenerate, regenerateDisabled, onRead, speaking, voiceError, sources }: AssistantActionsProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const transfer = useMessageTransfer(text, 'assistant');
  const [announcement, setAnnouncement] = useState('');
  const closeMenu = () => { menu.current?.hidePopover(); trigger.current?.focus(); };
  function openMenu() {
    if (menuOpen) { closeMenu(); return; }
    const element = menu.current;
    const button = trigger.current;
    if (!element || !button) return;
    const rect = button.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 288))}px`;
    element.showPopover();
    const height = element.getBoundingClientRect().height;
    element.style.top = `${rect.top > height + 16 ? rect.top - height - 8 : Math.min(rect.bottom + 8, window.innerHeight - height - 8)}px`;
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
  return <div className="ds-assistant-actions" ref={root}>
    <div className="ds-answer-toolbar" role="group" aria-label="Действия с ответом AI">
      <IconButton className="ds-button ds-answer-action" label={transfer.copied ? transfer.copiedLabel : transfer.copyLabel} onClick={() => void transfer.copy()}>{transfer.copied ? <Check size={17} /> : <Copy size={17} />}</IconButton>
      <IconButton className="ds-button ds-answer-action" label="Хороший ответ" aria-pressed={feedback === 'up'} onClick={() => { onFeedback(feedback === 'up' ? undefined : 'up'); setAnnouncement(feedback === 'up' ? 'Оценка снята.' : 'Оценка сохранена в этом проекте.'); }}><ThumbsUp size={17} /></IconButton>
      <IconButton className="ds-button ds-answer-action" label="Плохой ответ" aria-pressed={feedback === 'down'} onClick={() => { onFeedback(feedback === 'down' ? undefined : 'down'); setAnnouncement(feedback === 'down' ? 'Оценка снята.' : 'Оценка сохранена в этом проекте.'); }}><ThumbsDown size={17} /></IconButton>
      <IconButton className="ds-button ds-answer-action" label={speaking ? 'Остановить озвучивание' : 'Озвучить ответ'} aria-pressed={!!speaking} onClick={() => onRead(root.current?.closest('article')?.querySelector<HTMLElement>('.markdown')?.innerText || text)}>{speaking ? <Square size={15} /> : <Volume2 size={18} />}</IconButton>
      <IconButton className="ds-button ds-answer-action" label="Поделиться ответом" onClick={() => void transfer.share()}><Share size={17} /></IconButton>
      <button ref={trigger} type="button" className="icon-button ds-button ds-answer-action" title="Ещё действия с ответом" aria-label="Ещё действия с ответом" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={id} onClick={openMenu}><MoreHorizontal size={19} /></button>
    </div>
    <span className="sr-only" role="status">{announcement}</span>
    <span className="sr-only" role="status">{transfer.announcement}</span>
    {voiceError && <p className="ds-answer-error" role="alert">{voiceError}</p>}
    <div id={id} ref={menu} popover="auto" role="menu" aria-label="Ещё действия с ответом" className="ds-answer-menu"
      onToggle={event => setMenuOpen(event.newState === 'open')}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
        if (event.key === 'Tab') menu.current?.hidePopover();
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const buttons = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}>
      <button type="button" className="ds-button" role="menuitem" disabled={regenerateDisabled} onClick={() => { closeMenu(); onRegenerate(); }}><RefreshCw size={17} />Сгенерировать ответ заново</button>
      <button type="button" className="ds-button" role="menuitem" onClick={() => { closeMenu(); setSourcesOpen(true); }}><BookOpen size={17} />Посмотреть источники</button>
    </div>
    <Modal open={sourcesOpen} title="Источники ответа" onClose={() => setSourcesOpen(false)}>{sources}</Modal>
    {transfer.dialog}
  </div>;
}
