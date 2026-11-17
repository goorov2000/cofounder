import { useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { IconButton } from '../../components/ui/IconButton';
import { copyText } from '../../lib/download';
import type { RequestPreparationDiagnostics } from '../../lib/api';

export function RequestNotice({ message, diagnostics, onClose, onExport }: {
  message: string;
  diagnostics?: RequestPreparationDiagnostics;
  onClose: () => void;
  onExport?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const title = diagnostics ? 'Сообщение не отправлено' : 'Не удалось завершить действие';
  useEffect(() => { setCopied(false); setManualCopy(false); }, [message, diagnostics]);
  async function copyDiagnostics() {
    try { await copyText(JSON.stringify(diagnostics, null, 2)); setCopied(true); }
    catch { setManualCopy(true); }
  }
  return <aside className="workspace-notice" role="alert" aria-label={title}>
    <AlertCircle className="workspace-notice-icon" size={20} aria-hidden="true" />
    <div className="workspace-notice-content">
      <div className="workspace-notice-heading">
        <strong>{title}</strong>
        <IconButton label="Скрыть уведомление" onClick={onClose}><X size={18} /></IconButton>
      </div>
      <p>{message}</p>
      {(onExport || diagnostics) && <div className="workspace-notice-actions">
        {onExport && <button onClick={onExport}>Скачать копию</button>}
        {diagnostics && <button onClick={() => void copyDiagnostics()}>{copied ? 'Сведения скопированы' : 'Скопировать сведения об ошибке'}</button>}
      </div>}
      {manualCopy && <><p>Выделите и скопируйте технические сведения. Текста переписки в них нет.</p><textarea aria-label="Сведения об ошибке без переписки" readOnly value={JSON.stringify(diagnostics, null, 2)} rows={5} onFocus={event => event.currentTarget.select()} /></>}
    </div>
  </aside>;
}
