import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, m as motion } from 'motion/react';
import type { InvoiceStatus } from '../lib/api';
import { RANGES, type RangeKey } from '../lib/dates';

export function Wordmark({ to = '/', size }: { to?: string; size?: 'lg' }) {
  return <Link className={`wordmark ${size || ''}`} to={to} aria-label="Morgan home">mor<span>gan</span></Link>;
}

const paths: Record<string, string> = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  document: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  receivable: '<path d="M7 17 17 7M8 7h9v9"/>',
  payable: '<path d="m7 7 10 10M8 17h9V8"/>',
  transfer: '<path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4"/>',
  trend: '<path d="M3 17 9 11l4 3 8-9M15 5h6v6"/>',
  report: '<path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7"/>',
  spark: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/>',
  pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c.8-3.5 3.2-5.5 6-5.5s5.2 2 6 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c1.6.7 2.6 2.6 3 5.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14.1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1A2 2 0 1 1 7 4.3l.1.1A1.7 1.7 0 0 0 10 3.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<path d="M12 3 2.8 19h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/>',
  download: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9m-5 5 5-5 5 5M5 4h14"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  arrowRight: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  arrowLeft: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  up: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  upRight: '<path d="M7 17 17 7M8 7h9v9"/>',
  down: '<path d="M12 5v14m6-6-6 6-6-6"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
};

export function Icon({ name, size = 18, className = '' }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: paths[name] || paths.layers }} />
  );
}

const statusLabel: Record<string, string> = { draft: 'Draft', sent: 'Sent', partial: 'Partially paid', paid: 'Paid', overdue: 'Overdue', void: 'Void', unpaid: 'Unpaid' };
export function StatusBadge({ status }: { status: InvoiceStatus | 'unpaid' }) {
  return <span className={`badge ${status}`}>{statusLabel[status] || status}</span>;
}

export function Modal({ title, description, onClose, children, footer, wide }: {
  title: string; description?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    (el.querySelector<HTMLElement>('[autofocus], input, select, textarea, button:not(.modal-x)') || el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const f = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1)!.focus(); }
        else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <div><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div>
          <button className="btn ghost icon sm modal-x" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

type Toast = { id: number; message: string; tone: 'ok' | 'error' };
const ToastCtx = createContext<(message: string, tone?: 'ok' | 'error') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div key={t.id} layout className={`toast ${t.tone}`}
              initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: -24, transition: { duration: 0.16 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
              <Icon name={t.tone === 'error' ? 'alert' : 'check'} size={16} className={t.tone === 'error' ? 'neg' : 'pos'} />
              <span>{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Skeleton({ h = 16, w = '100%', style }: { h?: number | string; w?: number | string; style?: React.CSSProperties }) {
  return <div className="sk" style={{ height: h, width: w, ...style }} aria-hidden="true" />;
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ display: 'grid', gap: 14, padding: 20 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={18} w={`${90 - i * 7}%`} />)}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Icon name="alert" /> {message}</span>
      {onRetry && <button className="btn sm outline" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function RangeSelect({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  return (
    <label className="range-select">
      <span className="sr-only">Period</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value as RangeKey)}>
        {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
      </select>
    </label>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && typeof eyebrow !== 'string' && <nav className="crumb" aria-label="Breadcrumb">{eyebrow}</nav>}
        <h1>{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** Percentage change with direction-aware colouring. `goodWhenUp` false for expenses. */
export function Delta({ current, prior, goodWhenUp = true }: { current: number; prior: number; goodWhenUp?: boolean }) {
  if (!prior) return <span className="delta muted">{current ? 'No prior data' : '—'}</span>;
  const pct = ((current - prior) / Math.abs(prior)) * 100;
  const up = pct > 0;
  const good = Math.abs(pct) < 0.5 ? null : up === goodWhenUp;
  return (
    <span className={`delta ${good === null ? 'muted' : good ? 'pos' : 'neg'}`}>
      {Math.abs(pct) >= 0.05 && <Icon name={up ? 'up' : 'down'} size={13} />}{Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%
    </span>
  );
}

/** Shared-layout selection marker (Motion layoutId): glides between options so the change of selection is legible. */
export function Marker({ id, className }: { id: string; className: string }) {
  return <motion.span layoutId={id} className={className} aria-hidden="true" transition={{ type: 'spring', stiffness: 520, damping: 42 }} />;
}
