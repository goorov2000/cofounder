import { useId, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { Button } from './components';

/** Messages and full conversations use the same clipboard fallback. */
export function useMessageTransfer(text: string, kind: 'assistant' | 'user' | 'dialogue') {
  const id = useId();
  const user = kind === 'user';
  const dialogue = kind === 'dialogue';
  const [open, setOpen] = useState<'share' | 'copy' | null>(null);
  const [copiedText, setCopiedText] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');
  const copied = copiedText !== '' && copiedText === text;
  const copyLabel = dialogue ? 'Скопировать диалог' : user ? 'Скопировать сообщение' : 'Скопировать ответ';
  const copiedLabel = dialogue ? 'Диалог скопирован' : user ? 'Сообщение скопировано' : 'Ответ скопирован';
  const shareLabel = dialogue ? 'Поделиться диалогом' : user ? 'Поделиться сообщением' : 'Поделиться ответом';
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text); setError(''); setAnnouncement(`${copiedLabel}.`);
    } catch {
      setError('Не удалось скопировать автоматически. Выделите текст и скопируйте его вручную.');
      setOpen('copy');
    }
  }
  async function share() {
    if (navigator.share) {
      try { await navigator.share({ title: dialogue ? 'Диалог · CoFounder' : user ? 'Сообщение · CoFounder' : 'Ответ AI · CoFounder', text }); return; }
      catch (failure) { if (failure instanceof DOMException && failure.name === 'AbortError') return; }
    }
    setError(''); setOpen('share');
  }
  const dialog = <Modal open={open !== null} title={open === 'share' ? shareLabel : copyLabel} onClose={() => setOpen(null)}>
    <p>{open === 'share' ? `Скопируйте ${dialogue ? 'диалог' : user ? 'сообщение' : 'ответ'} и отправьте его в нужный чат.` : error}</p>
    <label className="sr-only" htmlFor={id}>{dialogue ? 'Текст диалога' : user ? 'Текст сообщения' : 'Текст ответа'}</label>
    <textarea className="ds-textarea ds-answer-share" id={id} readOnly rows={8} value={text} onFocus={event => event.target.select()} />
    <Button onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Скопировано' : 'Скопировать текст'}</Button>
  </Modal>;
  return { copied, copyLabel, copiedLabel, shareLabel, copy, share, announcement, dialog };
}
