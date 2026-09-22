/* Reports — circulation, overdue, most-borrowed, dead stock, inventory and acquisitions, with a CSV export. */
import { useEffect, useState } from 'react';
import { Card, Button, DataTable, ErrorState, Empty, useToast } from '../../../components/ui';
import { friendly } from '../../../lib/friendlyErrors';
import { libraryReports, type LibraryReportKind } from '../../../services/adminApi';

const KINDS: LibraryReportKind[] = ['circulation', 'overdue', 'most-borrowed', 'dead-stock', 'inventory', 'acquisitions'];

export default function Reports() {
  const toast = useToast();
  const [kind, setKind] = useState<LibraryReportKind>('circulation');
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false; setError(null); setRows(null);
    libraryReports(kind, days).then((r) => { if (!dead) setRows(r.rows ?? []); }).catch((e) => { if (!dead) setError(friendly(e)); });
    return () => { dead = true; };
  }, [kind, days]);

  const download = () => {
    const data = rows ?? [];
    const cols = data.length ? Object.keys(data[0]) : [];
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const body = [cols.join(','), ...data.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    const blob = new Blob([body], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `library-${kind}.csv`; a.click(); URL.revokeObjectURL(a.href);
    toast({ title: `${kind} report downloaded`, tone: 'success' });
  };

  const cols = rows && rows.length ? Object.keys(rows[0]) : [];

  if (error) return <ErrorState title="Could not build the report" sub={error.replace('Error: ', '')} />;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <Card headAs="h2" head="Reports" sub="Pick a report and a period; download it as CSV">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {KINDS.map((k) => <Button key={k} variant={kind === k ? 'primary' : 'secondary'} onClick={() => setKind(k)}>{k.replace('-', ' ')}</Button>)}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[7, 30, 90, 365].map((d) => <Button key={d} variant={days === d ? 'primary' : 'secondary'} onClick={() => setDays(d)}>{d === 365 ? '1y' : `${d}d`}</Button>)}
          <Button onClick={download} disabled={!rows?.length}>Download CSV</Button>
        </div>
      </Card>

      <Card headAs="h2" head={`${kind.replace('-', ' ')} — last ${days} days`}>
        {rows === null ? <Empty title="Building…" /> : rows.length === 0 ? (
          <Empty title="Nothing in this report" sub="No rows for this period." />
        ) : (
          <DataTable
            columns={cols.map((c) => ({ key: c, label: c.replace(/_/g, ' '), render: (r: Record<string, unknown>) => String(r[c] ?? '—') }))}
            rows={rows} rowKey={(r: Record<string, unknown>) => String(rows.indexOf(r))}
          />
        )}
      </Card>
    </div>
  );
}
