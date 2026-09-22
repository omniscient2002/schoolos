/* Members — every borrower (students + staff) with what they have out and what they owe. Filters by type,
   class and section, or search by name / admission number / email. */
import { useEffect, useState } from 'react';
import { Card, Button, Badge, DataTable, ErrorState, Empty } from '../../../components/ui';
import { friendly } from '../../../lib/friendlyErrors';
import { libraryMembers, type LibraryBorrower } from '../../../services/adminApi';
import { inr } from './shared';

const useDebounced = (v: string, ms = 220) => {
  const [x, setX] = useState(v);
  useEffect(() => { const t = setTimeout(() => setX(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return x;
};

export default function Members() {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | 'student' | 'staff'>('all');
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const dq = useDebounced(q);
  const [rows, setRows] = useState<LibraryBorrower[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false; setError(null); setRows(null);
    libraryMembers({ search: dq || undefined, type, grade: grade || undefined, section: section || undefined, limit: 300 })
      .then((r) => { if (!dead) setRows(r.borrowers ?? []); })
      .catch((e) => { if (!dead) setError(friendly(e)); });
    return () => { dead = true; };
  }, [dq, type, grade, section]);

  if (error) return <ErrorState title="Could not load members" sub={error.replace('Error: ', '')} />;

  return (
    <Card headAs="h2" head="Members" sub="Students and staff, with what they have out and owe">
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {(['all', 'student', 'staff'] as const).map((t) => (
          <Button key={t} variant={type === t ? 'primary' : 'secondary'} onClick={() => setType(t)}>{t === 'all' ? 'Everyone' : t === 'student' ? 'Students' : 'Staff'}</Button>
        ))}
      </div>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 2fr', marginBottom: 10 }}>
        <input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="Class / grade" aria-label="Grade" disabled={type === 'staff'} />
        <input value={section} onChange={(e) => setSection(e.target.value)} placeholder="Section" aria-label="Section" disabled={type === 'staff'} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, admission no or email…" aria-label="Search members" />
      </div>
      {rows === null ? <Empty title="Loading…" /> : rows.length === 0 ? (
        <Empty title="No members match" sub="Try another class/section, or clear the filters." />
      ) : (
        <DataTable
          columns={[
            { key: 'name', label: 'Member', render: (m: LibraryBorrower) => <span><b>{m.name}</b><span className="u-xs u-muted" style={{ display: 'block' }}>{m.type === 'student' ? `${m.grade}-${m.section}` : m.role}</span></span> },
            { key: 'id', label: 'ID', render: (m: LibraryBorrower) => <code>{m.identifier}</code> },
            { key: 'type', label: 'Type', render: (m: LibraryBorrower) => <Badge tone={m.type === 'student' ? 'info' : 'neutral'}>{m.type}</Badge> },
            { key: 'out', label: 'Out', render: (m: LibraryBorrower) => m.openLoans },
            { key: 'dues', label: 'Dues', render: (m: LibraryBorrower) => (m.duesCents ? <Badge tone="warning">{inr(m.duesCents)}</Badge> : '—') },
          ]}
          rows={rows} rowKey={(m: LibraryBorrower) => `${m.type}:${m.id}`}
        />
      )}
    </Card>
  );
}
