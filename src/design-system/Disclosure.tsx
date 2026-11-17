import type { ReactNode } from 'react';
import './motion.css';

/** Natural height, reversible motion and immediately inert collapsed content. */
export function Disclosure({ open, id, className = '', children, label }: {
  open: boolean; id: string; className?: string; children: ReactNode; label?: string;
}) {
  return <div id={id} className="ds-disclosure" data-open={open} aria-hidden={!open} inert={!open} aria-label={label}>
    <div className="ds-disclosure-clip"><div className={className}>{children}</div></div>
  </div>;
}
