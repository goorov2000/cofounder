import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

export interface ModalProps { open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string }
export function Modal({ open, onClose, title, children, className = '' }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      trigger?.focus();
    };
  }, [open]);
  if (!open) return null;
  return <dialog ref={dialogRef} className={`modal ${className}`} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-surface">
      <header className="modal-heading"><h2 id={titleId}>{title}</h2><IconButton label="Закрыть" onClick={onClose}><X size={20} /></IconButton></header>
      <div className="modal-body">{children}</div>
    </div>
  </dialog>;
}
