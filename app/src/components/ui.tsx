import { cloneElement, createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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
export function Card({ children, className = '', pad, head, sub, actions, onClick, style, headAs = 'h3' }: {
  children?: ReactNode; className?: string; pad?: boolean;
  head?: ReactNode; sub?: ReactNode; actions?: ReactNode; onClick?: () => void; style?: CSSProperties; headAs?: 'h2' | 'h3' | 'h4';
}) {
  const HeadTag = headAs;
  return (
    <div className={`card ${onClick ? 'card-click' : ''} ${className}`} style={style} onClick={onClick} role={onClick ? 'button' : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      tabIndex={onClick ? 0 : undefined}>
      {head && <div className="card-head"><div><HeadTag>{head}</HeadTag>{sub && <div className="u-small u-muted" style={{ marginTop: 2 }}>{sub}</div>}</div>{actions}</div>}
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
    <div className={`card stat ${onClick ? 'card-click' : ''}`} style={style} role={onClick ? 'button' : undefined} onClick={onClick} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}>
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
export function Empty({ icon, title, sub, action, titleAs = 'h3', style }: { icon?: ReactNode; title: string; sub?: string; action?: ReactNode; titleAs?: 'h1' | 'h2' | 'h3'; style?: CSSProperties }) {
  const Tag = titleAs;
  return (
    <div className="empty" style={style}>
      {icon}
      <Tag>{title}</Tag>
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
export function Dropdown({ trigger, children, align = 'right', width, label }: {
  trigger: (open: boolean) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: 'left' | 'right'; width?: number;
  /* unit 10: popover-menu pattern — WAI-ARIA APG menu-button semantics.
     The trigger must be a single <button>; we clone it to attach the toggle,
     aria-expanded and aria-haspopup so state lands on the real button. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        /* focus returns to the trigger on Esc (APG menu-button) */
        requestAnimationFrame(() => triggerRef.current?.focus());
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const idx = items.indexOf(document.activeElement as HTMLElement);
      let next = e.key === 'ArrowDown' ? idx + 1 : e.key === 'ArrowUp' ? idx - 1 : e.key === 'Home' ? 0 : items.length - 1;
      if (idx === -1) next = e.key === 'ArrowUp' ? items.length - 1 : 0;
      else if (next < 0) next = items.length - 1;
      else if (next >= items.length) next = 0;
      items[next].focus();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="dropdown" ref={ref}>
      {(() => {
        const el = trigger(open);
        if (el && typeof el === 'object' && 'props' in el) {
          try {
            return cloneElement(el as React.ReactElement<Record<string, unknown>>, {
              onClick: () => setOpen(o => !o),
              'aria-expanded': open,
              'aria-haspopup': 'menu',
              ref: (n: HTMLElement | null) => { triggerRef.current = n; },
            });
          } catch { /* non-cloneable trigger — fall through to wrapper */ }
        }
        return (
          /* non-cloneable trigger fallback — carries the menu-button semantics itself */
          <div role="button" tabIndex={-1} onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }} aria-expanded={open}>{el}</div>
        );
      })()}
      {open && (
        <div className="dropdown-menu" role="menu" aria-label={label} style={{ ...(align === 'left' ? { left: 0 } : { right: 0 }), ...(width ? { width, minWidth: width } : {}) }}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

/* ============ Dialog focus (APG, unit 16 C1) ============
   Shared by Modal/Drawer: focus moves to the first focusable when the dialog
   opens, Tab is trapped while open, Escape and scrim clicks dismiss, and focus
   returns to the trigger on close (parity with the Dropdown primitive). */
export function useDialogFocus<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  /* keep the latest closer without re-running the effect (callers pass inline
     arrows; a re-run would yank focus back to the first field mid-typing) */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const root = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    const target = root?.querySelector<HTMLElement>('[data-autofocus]')
      ?? root?.querySelector<HTMLElement>('input, textarea, select')
      ?? root?.querySelector<HTMLElement>('a[href], button, [tabindex]:not([tabindex="-1"])')
      ?? root;
    target?.focus();
    const onDoc = (e: MouseEvent) => { if (root && e.target instanceof Node && !root.contains(e.target)) closeRef.current(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeRef.current(); return; }
      if (e.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(el => el.getClientRects().length > 0);
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (idx <= 0 ? items.length - 1 : idx - 1) : (idx === -1 || idx === items.length - 1 ? 0 : idx + 1);
      e.preventDefault();
      items[next].focus();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      requestAnimationFrame(() => prev?.focus?.());
    };
  }, [open]);
  return ref;
}

/* ============ ClickThrough island ============
   unit 16: a click-through island inside a clickable card — mouse clicks here
   must not reach the parent row; the children (native buttons/links) own
   keyboard interaction. */
export function ClickThrough({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div role="group" className={className} style={style} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} /* eslint-disable-line jsx-a11y/no-noninteractive-element-interactions -- island idiom: grouping container, children own keyboard */ >
      {children}
    </div>
  );
}

/* ============ Modal ============ */
export function Modal({ open, onClose, title, sub, children, footer, size }: {
  open: boolean; onClose: () => void; title: string; sub?: string; children: ReactNode; footer?: ReactNode; size?: 'lg';
}) {
  /* unit 16 (C1): APG dialog focus — initial focus, Tab trap, Esc + scrim
     dismiss, focus restored to the trigger on close */
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose);
  if (!open) return null;
  return (
    <div className="modal-overlay">
      <div ref={dialogRef} tabIndex={-1} className={`modal ${size === 'lg' ? 'modal-lg' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
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
  /* unit 16 (C1): APG dialog focus, same contract as Modal */
  const dialogRef = useDialogFocus<HTMLElement>(open, onClose);
  if (!open) return null;
  return (
    <>
      <div className="drawer-overlay" />
      <aside ref={dialogRef} tabIndex={-1} className="drawer" role="dialog" aria-modal="true">
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
export function Tabs({ tabs, active, onChange, pill, panelId }: {
  tabs: { id: string; label: ReactNode; count?: number }[]; active: string; onChange: (id: string) => void; pill?: boolean;
  /* unit 8: pass panelId when THIS component owns the panels — each tab gets
     id=`${panelId}-tab-${id}` + aria-controls=`${panelId}-panel-${id}`;
     consumers render <div role="tabpanel" id aria-labelledby>. */
  panelId?: string;
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
      id={panelId ? `${panelId}-tab-${t.id}` : `tab-${t.id}`}
      aria-controls={panelId ? `${panelId}-panel-${t.id}` : undefined}
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
/* DataTable — the one data-grid class (unit 7 keyboard rows, unit 8 captions,
   unit 10 em-dash empty cells, unit 11 client-side sort).

   SORT API (unit 11, product sign-off granted):
   Give a column `sortable: true` and (when the rendered value isn't the sort
   key) an optional `sortValue: (row) => string | number`. Clicking (or
   Enter/Space on) the header button cycles that column: asc → desc → none.
   Sorting is IN-MEMORY and DETERMINISTIC — the rows prop order is never
   mutated (this is display order, not data policy); ties break on rowKey.
   aria-sort="ascending|descending|none" lands on the th; the indicator icon
   is aria-hidden (aria-sort carries the state). No server round-trip. */
export function DataTable<T>({ columns, rows, rowKey, onRowClick, empty, caption }: {
  columns: { key: string; label: ReactNode; render?: (row: T) => ReactNode; width?: number | string; align?: 'left' | 'right'; sortable?: boolean; sortValue?: (row: T) => string | number }[];
  rows: T[]; rowKey: (row: T) => string; onRowClick?: (row: T) => void; empty?: ReactNode; caption?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const cycleSort = (key: string) => setSort(cur => (cur?.key !== key ? { key, dir: 'asc' } : cur.dir === 'asc' ? { key, dir: 'desc' } : null));
  /* deterministic in-memory ordering: accessor → number/string compare, ties on rowKey */
  const sorted = sort
    ? [...rows].sort((a, b) => {
        const col = columns.find(c => c.key === sort.key);
        const acc = col?.sortValue ?? ((r: T) => (r as Record<string, unknown>)[sort.key] as string | number);
        const av = acc(a), bv = acc(b);
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true, sensitivity: 'base' });
        return (sort.dir === 'asc' ? cmp : -cmp) || String(rowKey(a)).localeCompare(String(rowKey(b)));
      })
    : rows;
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div className="table-wrap">
      <table className="data">
        {/* unit 8: every table carries an sr-only caption for column context */}
        <caption className="sr-only">{caption ?? `Data table — ${rows.length} row${rows.length === 1 ? '' : 's'}`}</caption>
        <thead><tr>{columns.map(c => {
          const dir = sort?.key === c.key ? sort.dir : null;
          return (
            <th key={c.key} scope="col" aria-sort={c.sortable ? (dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none') : undefined} style={{ width: c.width, textAlign: c.align }}>
              {c.sortable ? (
                <button
                  className="sort-btn"
                  onClick={() => cycleSort(c.key)}
                  title={dir === 'asc' ? 'Sorted ascending — activate for descending' : dir === 'desc' ? 'Sorted descending — activate to clear' : 'Sort ascending'}
                >
                  {c.label}
                  <span className="sort-ind" aria-hidden="true">{dir === 'asc' ? <Icon.ArrowUp size={11} /> : dir === 'desc' ? <Icon.ArrowDown size={11} /> : <Icon.ArrowUp size={11} style={{ opacity: .32 }} />}</span>
                </button>
              ) : c.label}
            </th>
          );
        })}</tr></thead>
        <tbody>
          {sorted.map(row => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'row-click' : ''}
              onClick={() => onRowClick?.(row)}
              /* keyboard parity for click-only rows (unit 7 batch 1) */
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row); } } : undefined}
            >
              {columns.map(c => {
                /* unit 10: empty cells render an em-dash — one decision, every table */
                const v = c.render ? c.render(row) : (row as Record<string, unknown>)[c.key] as ReactNode;
                return <td key={c.key} style={{ textAlign: c.align }}>{v === undefined || v === null || v === '' ? <span className="u-faint">—</span> : v}</td>;
              })}
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
        {back && <div style={{ marginBottom: 6 }}><Link to={back.to} className="u-small u-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 32, padding: '0 4px' }}><Icon.ChevronLeft size={13} /> {back.label}</Link></div>}
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
export function Section({ title, sub, actions, children, style, ...rest }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; style?: CSSProperties } & Omit<React.HTMLAttributes<HTMLElement>, 'style' | 'title'>) {
  return (
    <section className="section" style={style} {...rest}>
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
