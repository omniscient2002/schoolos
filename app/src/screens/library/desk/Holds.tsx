/* Holds — the reservation queue. Fulfil clears the hold so the desk can issue the waiting copy; cancel frees it. */
import { useEffect, useState } from 'react';
import { Card, Button, Badge, DataTable, ErrorState, Empty, useToast } from '../../../components/ui';
import { friendly } from '../../../lib/friendlyErrors';
import { statusLabel } from '../../../lib/labels';
import { libraryHolds, libraryFulfilHold, libraryCancelHold, type LibraryReservation } from '../../../services/adminApi';
import { fmtDate } from './shared';

export default function Holds() {
  const toast = useToast();
  const [rows, setRows] = useState<LibraryReservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let dead = false; setError(null);
    libraryHolds().then((r) => { if (!dead) setRows(r.reservations ?? []); }).catch((e) => { if (!dead) setError(friendly(e)); });
    return () => { dead = true; };
  }, [tick]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, tone: 'success' }); setTick((t) => t + 1); }
    catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };

  if (error) return <ErrorState title="Could not load holds" sub={error.replace('Error: ', '')} onRetry={() => setTick((t) => t + 1)} />;

  return (
    <Card headAs="h2" head="Reservations" sub="Ready holds wait for collection; fulfil to issue the copy, cancel to free the queue">
      {rows === null ? <Empty title="Loading…" /> : rows.length === 0 ? (
        <Empty title="No open holds" sub="Borrower reservations appear here." />
      ) : (
        <DataTable
          columns={[
            { key: 'book', label: 'Book', render: (h: LibraryReservation) => <span><b>{h.title ?? '—'}</b><span className="u-xs u-muted" style={{ display: 'block' }}><code>{h.book_code ?? ''}</code></span></span> },
            { key: 'who', label: 'Borrower', render: (h: LibraryReservation) => h.borrower_name ?? '—' },
            { key: 'queue', label: 'Queue', render: (h: LibraryReservation) => h.queue_no ?? '—' },
            { key: 'status', label: 'Status', render: (h: LibraryReservation) => <Badge tone={h.status === 'ready' ? 'success' : 'info'}>{statusLabel(h.status)}</Badge> },
            { key: 'expires', label: 'Collect by', render: (h: LibraryReservation) => h.status === 'ready' ? fmtDate(h.expires_at) : '—' },
            { key: 'act', label: '', render: (h: LibraryReservation) => (
              <>
                {h.status === 'ready' ? <Button variant="ghost" onClick={() => run(() => libraryFulfilHold(h.id), 'Hold cleared — issue the copy')}>Fulfil</Button> : null}
                <Button variant="ghost" onClick={() => run(() => libraryCancelHold(h.id), 'Hold cancelled')}>Cancel</Button>
              </>
            ) },
          ]}
          rows={rows} rowKey={(h: LibraryReservation) => h.id}
        />
      )}
    </Card>
  );
}
