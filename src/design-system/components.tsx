import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, Check, Info, LoaderCircle } from 'lucide-react';

export function Button({ variant = 'secondary', size = 'md', busy = false, children, className = '', disabled, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; busy?: boolean }) {
  return <button type="button" {...props} className={`ds-button ds-button--${variant} ds-button--${size} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined}>
    {busy && <LoaderCircle className="ds-spinner" size={18} aria-hidden="true" />}{children}
  </button>;
}
export function Card({ title, description, action, children, className = '' }:
  { title?: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`ds-card ${className}`}>
    {title && <header className="ds-card-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>}{children}
  </section>;
}
export function Field({ label, hint, error, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const generated = useId(); const fieldId = id ?? generated;
  return <div className="ds-field"><label htmlFor={fieldId}>{label}</label>
    <input {...props} id={fieldId} className={`ds-input ${props.className ?? ''}`} aria-invalid={error ? true : props['aria-invalid']} aria-describedby={[props['aria-describedby'], (hint || error) && `${fieldId}-help`].filter(Boolean).join(' ') || undefined} />
    {(error || hint) && <p id={`${fieldId}-help`} className={error ? 'ds-field-error' : 'ds-field-hint'}>{error || hint}</p>}
  </div>;
}
export function Status({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'; children: ReactNode }) {
  return <span className={`ds-status ds-status--${tone}`}><span aria-hidden="true" />{children}</span>;
}
export function Alert({ tone = 'info', children }: { tone?: 'info' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  const Icon = tone === 'success' ? Check : tone === 'info' ? Info : AlertCircle;
  return <div className={`ds-alert ds-alert--${tone}`}><Icon size={20} aria-hidden="true" /><div>{children}</div></div>;
}
export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="ds-empty"><span className="ds-empty-icon" aria-hidden="true">{icon}</span><h3>{title}</h3><p>{children}</p>{action}</div>;
}
