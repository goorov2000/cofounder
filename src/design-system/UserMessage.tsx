import { useId, useRef, useState } from 'react';
import { Check, Copy, Pencil, Share, Square, Volume2 } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { Markdown } from '../components/ui/Markdown';
import { Modal } from '../components/ui/Modal';
import { Button } from './components';
import { useMessageTransfer } from './useMessageTransfer';

interface UserMessageProps {
  text: string;
  onRead(text: string): void;
  speaking?: boolean;
  voiceError?: string;
  onEdit(text: string): string | undefined;
  editDisabled?: boolean;
  pendingEdit?: string;
  status?: string;
  className?: string;
}

export function UserMessage({ text, onRead, speaking, voiceError, onEdit, editDisabled, pendingEdit, status, className = '' }: UserMessageProps) {
  const id = useId();
  const body = useRef<HTMLDivElement>(null);
  const transfer = useMessageTransfer(text, 'user');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const [error, setError] = useState('');
  return <article className={`ds-user-message ${className}`}>
    <p className="sr-only">Вы{status ? ` · ${status}` : ''}</p>
    <div className="ds-user-bubble" ref={body}><Markdown>{text}</Markdown></div>
    <div className="ds-user-actions ds-answer-toolbar" role="group" aria-label="Действия с сообщением пользователя">
      <IconButton className="ds-button ds-answer-action" label={transfer.copied ? transfer.copiedLabel : transfer.copyLabel} onClick={() => void transfer.copy()}>{transfer.copied ? <Check size={17} /> : <Copy size={17} />}</IconButton>
      <IconButton className="ds-button ds-answer-action" label={transfer.shareLabel} onClick={() => void transfer.share()}><Share size={17} /></IconButton>
      <IconButton className="ds-button ds-answer-action" label={speaking ? 'Остановить озвучивание' : 'Озвучить сообщение'} aria-pressed={!!speaking} onClick={() => onRead(body.current?.innerText || text)}>{speaking ? <Square size={15} /> : <Volume2 size={18} />}</IconButton>
      <IconButton className="ds-button ds-answer-action" label="Редактировать сообщение" disabled={editDisabled} onClick={() => { setValue(pendingEdit ?? text); setError(''); setEditing(true); }}><Pencil size={17} /></IconButton>
    </div>
    <span className="sr-only" role="status">{transfer.announcement}</span>
    {voiceError && <p className="ds-answer-error" role="alert">{voiceError}</p>}
    {transfer.dialog}
    <Modal open={editing} title="Редактировать сообщение" onClose={() => setEditing(false)}>
      <form onSubmit={event => {
        event.preventDefault();
        if (!value.trim() || editDisabled) return;
        const failure = onEdit(value.trim());
        if (failure) setError(failure); else setEditing(false);
      }}>
        <label className="sr-only" htmlFor={id}>Текст правки</label>
        <textarea className="ds-textarea ds-message-edit" id={id} rows={6} maxLength={8000} value={value} onChange={event => { setValue(event.target.value); setError(''); }} />
        <p className="ds-edit-hint">AI ответит на исправленное сообщение заново. Последующая переписка и ваш черновик сохранятся.</p>
        {error && <p className="ds-answer-error" role="alert">{error}</p>}
        <div className="ds-edit-actions"><Button onClick={() => setEditing(false)}>Отмена</Button><Button type="submit" variant="primary" disabled={editDisabled || !value.trim() || value.trim() === text.trim()}>Отправить правку</Button></div>
      </form>
    </Modal>
  </article>;
}
