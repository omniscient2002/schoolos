import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { avatarHue, initials } from '../lib/format';

/* ============ Button ============ */
export function Button({ variant = 'secondary', size, icon, iconRight, loading, children, className = '', ...rest }: {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost' | 'ai';
  size?: 'sm' | 'lg'; icon?: ReactNode; iconRight?: ReactNode; loading?: boolean;
  children?: ReactNode; className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} /> : icon}
      {children}
      {iconRight}
    </button>
  );
}

/* ============ Badge ============ */
export function Badge({ tone = 'neutral', dot, children, className = '' }: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'ai' | 'accent' | 'outline';
  dot?: boolean; children: ReactNode; className?: string;
}) {
  const cls = { neutral: '', success: 'badge-success', warning: 'badge-warning', danger: 'badge-danger', info: 'badge-info', ai: 'badge-ai', accent: 'badge-accent', outline: 'badge-outline' }[tone];
  return <span className={`badge ${cls} ${className}`}>{dot && <span className="dot" />}{children}</span>;
}

/* ============ Avatar ============ */
export function Avatar({ name, size = 'md', square }: { name: string; size?: 'sm' | 'md' | 'lg'; square?: boolean }) {
  const cls = size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : '';
  return <span className={`avatar ${cls} ${square ? 'square' : ''}`} style={{ background: avatarHue(name) }} aria-hidden="true">{initials(name)}</span>;
}

/* ============ Card ============ */
export function Card({ children, className = '', pad, head, sub, actions, onClick, style }: {
  children?: ReactNode; className?: string; pad?: boolean;
  head?: ReactNode; sub?: ReactNode; actions?: ReactNode; onClick?: () => void; style?: CSSProperties;
}) {
  return (
    <div className={`card ${onClick ? 'card-click' : ''} ${className}`} style={style} onClick={onClick} role={onClick ? 'button' : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      tabIndex={onClick ? 0 : undefined}>
      {head && <div className="card-head"><div><h3>{head}</h3>{sub && <div className="u-small u-muted" style={{ marginTop: 2 }}>{sub}</div>}</div>{actions}</div>}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </div>
  );
}

/* ============ Stat ============ */
export function Stat({ label, value, delta, sub, spark, onClick, style }: {
  label: string; value: ReactNode; delta?: { value: string; dir: 'up' | 'down' | 'flat' };
  sub?: ReactNode; spark?: ReactNode; onClick?: () => void; style?: CSSProperties;
}) {
  return (
    <div className={`card stat ${onClick ? 'card-click' : ''}`} style={style} onClick={onClick} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onClick(); } } : undefined}>
      <div className="label">{label}</div>
      <div className="stat-value-row">
        <div className="value">{value}</div>
        {delta && <span className={`delta ${delta.dir}`}>{delta.dir === 'up' ? '▲' : delta.dir === 'down' ? '▼' : ''} {delta.value}</span>}
        {spark && !delta && <span className="stat-spark">{spark}</span>}
      </div>
      {spark && delta && <div className="stat-spark-row">{spark}</div>}
      {sub && <div className="u-small u-muted sub">{sub}</div>}
    </div>
  );
}

/* ============ Empty / Error / Loading ============ */
export function Empty({ icon, title, sub, action }: { icon?: ReactNode; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {sub && <p>{sub}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', sub, onRetry }: { title?: string; sub?: string; onRetry?: () => void }) {
  return (
    <div className="error-state">
      <h3>{title}</h3>
      {sub && <p className="u-small">{sub}</p>}
      {onRetry && <div style={{ marginTop: 12 }}><Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={onRetry}>Try again</Button></div>}
    </div>
  );
}

export function Skeleton({ w = '100%', h = 14, r = 6, style }: { w?: number | string; h?: number | string; r?: number; style?: CSSProperties }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card card-pad u-col" style={{ gap: 10 }}>
      <Skeleton w="40%" h={12} />
      {Array.from({ length: lines }).map((_, i) => <Skeleton key={i} w={i === lines - 1 ? '65%' : '100%'} h={11} />)}
    </div>
  );
}

/* ============ Dropdown (click-outside aware) ============ */
export function Dropdown({ trigger, children, align = 'right', width }: {
  trigger: (open: boolean) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: 'left' | 'right'; width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="dropdown" ref={ref}>
      <div onClick={() => setOpen(o => !o)} aria-expanded={open}>{trigger(open)}</div>
      {open && (
        <div className="dropdown-menu" style={{ ...(align === 'left' ? { left: 0 } : { right: 0 }), ...(width ? { width, minWidth: width } : {}) }}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

/* ============ Modal ============ */
export function Modal({ open, onClose, title, sub, children, footer, size }: {
  open: boolean; onClose: () => void; title: string; sub?: string; children: ReactNode; footer?: ReactNode; size?: 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${size === 'lg' ? 'modal-lg' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div><h2>{title}</h2>{sub && <div className="u-small u-muted" style={{ marginTop: 3 }}>{sub}</div>}</div>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><Icon.X size={17} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ============ Drawer ============ */
export function Drawer({ open, onClose, title, sub, children, footer }: {
  open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="drawer-overlay" onMouseDown={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 640, fontSize: 'var(--text-lg)' }}>{title}</div>
            {sub && <div className="u-small u-muted" style={{ marginTop: 2 }}>{sub}</div>}
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Close panel"><Icon.X size={17} /></button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </>
  );
}

/* ============ Tabs ============ */
export function Tabs({ tabs, active, onChange, pill }: {
  tabs: { id: string; label: ReactNode; count?: number }[]; active: string; onChange: (id: string) => void; pill?: boolean;
}) {
  /* WAI-ARIA tabs: arrow keys move selection, Home/End jump (unit 7 batch 1).
     roving tabindex: the active tab is the only tab stop. */
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const ids = tabs.map(t => t.id);
    const i = ids.indexOf(active);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (i + 1) % ids.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(ids[next]);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[role="tab"][data-tab-id="${ids[next]}"]`)?.focus());
  };
  const renderTab = (t: { id: string; label: ReactNode; count?: number }) => (
    <button
      key={t.id}
      role="tab"
      data-tab-id={t.id}
      id={`tab-${t.id}`}
      aria-selected={active === t.id}
      tabIndex={active === t.id ? 0 : -1}
      className={`tab ${active === t.id ? 'active' : ''}`}
      onKeyDown={onTabKeyDown}
      onClick={() => onChange(t.id)}
    >
      {t.label}{t.count !== undefined && <span className="u-faint" style={{ marginLeft: 5 }}>{t.count}</span>}
    </button>
  );
  if (pill) {
    return (
      <div className="tabs-pill" role="tablist">
        {tabs.map(renderTab)}
      </div>
    );
  }
  return (
    <div className="tabs" role="tablist">
      {tabs.map(renderTab)}
    </div>
  );
}

/* ============ Table ============ */
export function DataTable<T>({ columns, rows, rowKey, onRowClick, empty }: {
  columns: { key: string; label: ReactNode; render?: (row: T) => ReactNode; width?: number | string; align?: 'left' | 'right' }[];
  rows: T[]; rowKey: (row: T) => string; onRowClick?: (row: T) => void; empty?: ReactNode;
}) {
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr>{columns.map(c => (
          <th key={c.key} scope="col" style={{ width: c.width, textAlign: c.align }}>{c.label}</th>
        ))}</tr></thead>
        <tbody>
          {rows.map(row => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'row-click' : ''}
              onClick={() => onRowClick?.(row)}
              /* keyboard parity for click-only rows (unit 7 batch 1) */
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row); } } : undefined}
            >
              {columns.map(c => (
                <td key={c.key} style={{ textAlign: c.align }}>{c.render ? c.render(row) : (row as Record<string, unknown>)[c.key] as ReactNode}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============ Page header ============ */
export function PageHead({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {back && <div style={{ marginBottom: 6 }}><Link to={back.to} className="u-small u-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon.ChevronLeft size={13} /> {back.label}</Link></div>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  );
}

/* ============ Toast ============ */
type Toast = { id: number; title: string; sub?: string; tone: 'info' | 'success' | 'error' };
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(1);
  const push = (t: Omit<Toast, 'id'>) => {
    const id = idRef.current++;
    setToasts(ts => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 4200);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* errors announce assertively (role=alert has implicit aria-live=assertive);
          success/info stay polite via the stack-level region (ARIA 4.3) */}
      <div className="toast-stack" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.tone}`} {...(t.tone === 'error' ? { role: 'alert' as const } : {})}>
            <span style={{ marginTop: 1 }}>
              {t.tone === 'success' ? <Icon.Check size={15} /> : t.tone === 'error' ? <Icon.Alert size={15} /> : <Icon.Info size={15} />}
            </span>
            <div className="toast-msg"><div className="toast-title">{t.title}</div>{t.sub && <div className="toast-sub">{t.sub}</div>}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ============ Section ============ */
export function Section({ title, sub, actions, children, style }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <section className="section" style={style}>
      {(title || actions) && (
        <div className="section-title">
          <div><h2>{title}</h2>{sub && <div className="u-small u-muted" style={{ marginTop: 1 }}>{sub}</div>}</div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/* ============ Progress ============ */
export function Progress({ value, tone }: { value: number; tone?: 'warn' | 'danger' }) {
  return <div className={`progress ${tone ?? ''}`}><div style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

/* ============ Segmented bar ============ */
export function SegmentedBar({ parts, height = 8 }: { parts: { value: number; color: string; label?: string }[]; height?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="segbar" style={{ height }} role="img" aria-label={parts.map(p => p.label).filter(Boolean).join(', ')}>
      {parts.map((p, i) => <div key={i} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={p.label} />)}
    </div>
  );
}

/* ============ KeyValue ============ */
export function KeyValue({ items, cols = 2 }: { items: { k: ReactNode; v: ReactNode }[]; cols?: 1 | 2 | 3 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: '12px 20px' }}>
      {items.map((it, i) => (
        <div key={i} style={{ minWidth: 0 }}>
          <div className="u-xs" style={{ fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{it.k}</div>
          <div style={{ marginTop: 2 }}>{it.v}</div>
        </div>
      ))}
    </div>
  );
}

/* ============ Timeline ============ */
export function Timeline({ items }: { items: { time: ReactNode; title: ReactNode; body?: ReactNode; dot?: 'accent' | 'ai' | 'danger'; icon?: ReactNode }[] }) {
  return (
    <div className="timeline">
      {items.map((it, i) => (
        <div className="timeline-item" key={i}>
          <span className={`timeline-dot ${it.dot ?? ''}`} />
          <div className="t-time">{it.time}</div>
          <div style={{ fontWeight: 540 }}>{it.title}</div>
          {it.body && <div className="u-small u-muted" style={{ marginTop: 3 }}>{it.body}</div>}
        </div>
      ))}
    </div>
  );
}
