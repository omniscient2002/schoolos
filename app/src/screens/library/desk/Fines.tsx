/* Fines — the ledger. Collect at the counter (paid) or waive with a reason (if the school allows it). */
import { useEffect, useState } from 'react';
import { Card, Button, Badge, DataTable, ErrorState, Empty, useToast } from '../../../components/ui';
import { friendly } from '../../../lib/friendlyErrors';
import { statusLabel, humanize } from '../../../lib/labels';
import { libraryFines, librarySettleFine, type LibraryFine } from '../../../services/adminApi';
import { fmtDate, inr } from './shared';

export default function Fines() {
  const toast = useToast();
  const [status, setStatus] = useState('outstanding');
  const [rows, setRows] = useState<LibraryFine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let dead = false; setError(null);
    libraryFines(status || undefined).then((r) => { if (!dead) setRows(r.fines ?? []); }).catch((e) => { if (!dead) setError(friendly(e)); });
    return () => { dead = true; };
  }, [status, tick]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, tone: 'success' }); setTick((t) => t + 1); }
    catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };

  if (error) return <ErrorState title="Could not load fines" sub={error.replace('Error: ', '')} onRetry={() => setTick((t) => t + 1)} />;

  return (
    <Card headAs="h2" head="Fines" sub="Mark paid at the counter, or waive with a reason"
      actions={<select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Fine status" style={{ width: 160 }}>
        {['outstanding', 'paid', 'waived', ''].map((s) => <option key={s || 'all'} value={s}>{s ? statusLabel(s) : 'All'}</option>)}
      </select>}>
      {rows === null ? <Empty title="Loading…" /> : rows.length === 0 ? (
        <Empty title="No fines" sub={status === 'outstanding' ? 'Nothing to collect.' : 'Nothing here.'} />
      ) : (
        <DataTable
          columns={[
            { key: 'who', label: 'Borrower', render: (f: LibraryFine) => f.borrower_name ?? '—' },
            { key: 'book', label: 'Book', render: (f: LibraryFine) => f.book_title ?? '—' },
            { key: 'cause', label: 'Reason', render: (f: LibraryFine) => <Badge tone={f.cause === 'lost' ? 'danger' : f.cause === 'damage' ? 'warning' : 'info'}>{humanize(f.cause)}</Badge> },
            { key: 'amt', label: 'Amount', render: (f: LibraryFine) => inr(f.amount_cents) },
            { key: 'when', label: 'Assessed', render: (f: LibraryFine) => fmtDate(f.assessed_at) },
            { key: 'status', label: 'Status', render: (f: LibraryFine) => <Badge tone={f.status === 'outstanding' ? 'warning' : 'success'}>{statusLabel(f.status)}</Badge> },
            { key: 'act', label: '', render: (f: LibraryFine) => f.status === 'outstanding' ? (
              <>
                <Button variant="ghost" onClick={() => run(() => librarySettleFine(f.id, 'pay'), 'Fine marked paid')}>Paid</Button>
                <Button variant="ghost" onClick={() => run(() => librarySettleFine(f.id, 'waive', 'waived at desk'), 'Fine waived')}>Waive</Button>
              </>
            ) : null },
          ]}
          rows={rows} rowKey={(f: LibraryFine) => f.id}
        />
      )}
    </Card>
  );
}
