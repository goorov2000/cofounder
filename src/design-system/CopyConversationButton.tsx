import { Check, Copy } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { useMessageTransfer } from './useMessageTransfer';

export function CopyConversationButton({ text, disabled = false }: { text: string; disabled?: boolean }) {
  const transfer = useMessageTransfer(text, 'dialogue');
  return <>
    <IconButton disabled={disabled} label={transfer.copied ? transfer.copiedLabel : transfer.copyLabel} onClick={() => void transfer.copy()}>
      {transfer.copied ? <Check size={20} /> : <Copy size={20} />}
    </IconButton>
    <span className="sr-only" role="status">{transfer.announcement}</span>
    {transfer.dialog}
  </>;
}
