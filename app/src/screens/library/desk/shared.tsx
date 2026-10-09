/* Shared desk building blocks: currency/date formatting, KPI tiles, and the two search pickers the
   issue desk needs. A school has hundreds of borrowers and thousands of copies, so neither is a plain
   <select> — each picker searches and narrows (type / class / section / id) and shows the identifier. */
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Empty, Skeleton } from '../../../components/ui';
import { Icon as IconSet, type IconName } from '../../../components/Icon';
import { roleLabel, humanize } from '../../../lib/labels';
import { fmtDate as sharedFmtDate } from '../../../lib/format';
import { libraryDeskBooks, libraryMembers, type LibraryBook, type LibraryBorrower } from '../../../services/adminApi';

/** The icon set is a map of components, not a single component — this renders one by name. */
export function DeskIcon({ name, size = 16 }: { name: IconName; size?: number }) {
  const C = IconSet[name];
  return <C size={size} />;
}

export const inr = (c: number) => `₹${((c ?? 0) / 100).toFixed(2)}`;
/* Delegates to the shared guarded formatter so a malformed date can never
   render the literal string "Invalid Date" here either. */
export const fmtDate = (d?: string | null) => (d ? sharedFmtDate(d) : '—');
export const todayISO = () => new Date().toISOString().slice(0, 10);

export function Kpi({ label, value, sub, tone, onClick }: { label: string; value: React.ReactNode; sub?: string; tone?: 'accent' | 'warn' | 'danger' | 'success'; onClick?: () => void }) {
  const color = tone === 'danger' ? 'var(--danger-text)' : tone === 'warn' ? 'var(--warning-text)' : tone === 'success' ? 'var(--success-text)' : undefined;
  return (
    <div onClick={onClick} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-lg)', padding: '12px 14px', background: 'var(--surface-1)', cursor: onClick ? 'pointer' : 'default' }}>
      <div className="u-xs u-muted">{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1.15 }}>{value}</div>
      {sub ? <div className="u-xs u-muted" style={{ marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

const useDebounced = <T,>(value: T, ms = 220) => {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
};

/* ── borrower search ────────────────────────────────────────────────────────── */
export function BorrowerPicker({ onPick, placeholder = 'Search name, admission no or email…' }: { onPick: (b: LibraryBorrower) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | 'student' | 'staff'>('all');
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const dq = useDebounced(q);
  const [rows, setRows] = useState<LibraryBorrower[] | null>(null);

  useEffect(() => {
    let dead = false; setRows(null);
    libraryMembers({ search: dq || undefined, type, grade: grade || undefined, section: section || undefined, limit: 25 })
      .then((r) => { if (!dead) setRows(r.borrowers ?? []); })
      .catch(() => { if (!dead) setRows([]); });
    return () => { dead = true; };
  }, [dq, type, grade, section]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {(['all', 'student', 'staff'] as const).map((t) => (
          <Button key={t} variant={type === t ? 'primary' : 'secondary'} onClick={() => setType(t)}>
            {t === 'all' ? 'Everyone' : t === 'student' ? 'Students' : 'Staff'}
          </Button>
        ))}
      </div>
      {type !== 'staff' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="Class / grade (e.g. 6)" aria-label="Grade" />
          <input value={section} onChange={(e) => setSection(e.target.value)} placeholder="Section (e.g. A)" aria-label="Section" />
        </div>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search borrowers" style={{ marginBottom: 8 }} />
      {rows === null ? <Skeleton h={40} /> : rows.length === 0 ? (
        <Empty title="No borrower matches" sub="Try another class/section, or clear the filters." />
      ) : (
        <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
          {rows.map((b) => (
            <button key={`${b.type}:${b.id}`} type="button" onClick={() => onPick(b)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', textAlign: 'left', padding: '8px 10px', border: 0, borderBottom: '1px solid var(--border-subtle)', background: 'transparent', cursor: 'pointer' }}>
              <span>
                <span style={{ fontWeight: 600 }}>{b.name}</span>
                <span className="u-xs u-muted" style={{ marginLeft: 8 }}>{b.type === 'student' ? `${b.grade}-${b.section}` : roleLabel(b.role)}</span>
                <span className="u-xs u-muted" style={{ display: 'block' }}>{b.identifier}</span>
              </span>
              <span style={{ textAlign: 'right' }}>
                <Badge tone={b.type === 'student' ? 'info' : 'neutral'}>{humanize(b.type)}</Badge>
                <span className="u-xs u-muted" style={{ display: 'block', marginTop: 2 }}>
                  {b.openLoans} out{b.duesCents ? ` · ${inr(b.duesCents)} due` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── book search ────────────────────────────────────────────────────────────── */
export function BookPicker({ onPick, placeholder = 'Search title, author, ISBN or reference…' }: { onPick: (b: LibraryBook) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [rows, setRows] = useState<LibraryBook[] | null>(null);
  useEffect(() => {
    let dead = false; setRows(null);
    libraryDeskBooks(dq || undefined).then((r) => { if (!dead) setRows(r.books ?? []); }).catch(() => { if (!dead) setRows([]); });
    return () => { dead = true; };
  }, [dq]);
  const shown = useMemo(() => (rows ?? []).slice(0, 40), [rows]);
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search books" style={{ marginBottom: 8 }} />
      {rows === null ? <Skeleton h={40} /> : shown.length === 0 ? (
        <Empty title="No title matches" sub="Search a different word, or add the book to the catalog." />
      ) : (
        <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
          {shown.map((b) => (
            <button key={b.id} type="button" onClick={() => onPick(b)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', textAlign: 'left', padding: '8px 10px', border: 0, borderBottom: '1px solid var(--border-subtle)', background: 'transparent', cursor: 'pointer' }}>
              <span>
                <span style={{ fontWeight: 600 }}>{b.title}</span>
                <span className="u-xs u-muted" style={{ display: 'block' }}>{b.author || '—'} · <code>{b.code}</code></span>
              </span>
              <Badge tone={b.available > 0 ? 'success' : 'warning'}>{b.available} of {b.copiesTotal}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
