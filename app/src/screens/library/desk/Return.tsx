/* Return a book: search the books that are out, then mark returned (fine is computed server-side) or renew. */
import { useEffect, useMemo, useState } from 'react';
import { Card, Button, Badge, DataTable, ErrorState, Empty, useToast, KeyValue } from '../../../components/ui';
import { DeskIcon as Icon } from './shared';
import { friendly } from '../../../lib/friendlyErrors';
import { libraryLoans, libraryReturn, libraryRenew, type LibraryLoan } from '../../../services/adminApi';
import { fmtDate, inr, todayISO } from './shared';

export default function Return() {
  const toast = useToast();
  const [loans, setLoans] = useState<LibraryLoan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tick, setTick] = useState(0);
  const [receipt, setReceipt] = useState<{ book: string; fineCents: number; daysOverdue: number; damaged: boolean } | null>(null);

  useEffect(() => {
    let dead = false; setError(null);
    libraryLoans('open').then((r) => { if (!dead) setLoans(r.loans ?? []); }).catch((e) => { if (!dead) setError(friendly(e)); });
    return () => { dead = true; };
  }, [tick]);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = loans ?? [];
    return s ? list.filter((l) => [l.bookTitle, l.bookCode, l.borrowerName, l.studentName].some((x) => (x ?? '').toLowerCase().includes(s))) : list;
  }, [loans, search]);

  const ret = async (l: LibraryLoan, condition: 'ok' | 'damaged') => {
    try {
      const r = await libraryReturn(l.id, condition);
      setReceipt({ book: l.bookTitle, fineCents: r.fineCents, daysOverdue: r.daysOverdue, damaged: condition === 'damaged' });
      toast({ title: 'Book returned', sub: r.fineCents ? `Fine ${inr(r.fineCents)}` : 'No fine', tone: 'success' });
      setTick((t) => t + 1);
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };

  if (error) return <ErrorState title="Could not load open loans" sub={error.replace('Error: ', '')} onRetry={() => setTick((t) => t + 1)} />;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      {receipt && (
        <Card headAs="h2" head="Returned">
          <KeyValue cols={2} items={[
            { k: 'Book', v: receipt.book },
            { k: 'Days late', v: receipt.daysOverdue },
            { k: 'Fine', v: receipt.fineCents ? inr(receipt.fineCents) : 'None' },
            { k: 'Condition', v: receipt.damaged ? 'Damaged' : 'Good' },
          ]} />
          <div style={{ marginTop: 12 }}><Button onClick={() => setReceipt(null)}>Return another</Button></div>
        </Card>
      )}

      <Card headAs="h2" head="Books out" sub="Search by title, reference or borrower; return or renew in one tap">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search books that are out…" aria-label="Search open loans" style={{ marginBottom: 10 }} />
        {loans === null ? <Empty title="Loading…" /> : rows.length === 0 ? (
          <Empty title={loans.length ? 'No match' : 'Nothing is out'} sub={loans.length ? 'Try a different search.' : 'All copies are on the shelf.'} />
        ) : (
          <DataTable
            columns={[
              { key: 'book', label: 'Book', render: (l: LibraryLoan) => <span><b>{l.bookTitle}</b><span className="u-xs u-muted" style={{ display: 'block' }}><code>{l.bookCode}</code></span></span> },
              { key: 'who', label: 'Borrower', render: (l: LibraryLoan) => `${l.borrowerName ?? l.studentName ?? '—'}${l.borrowerType ? ` · ${l.borrowerType}` : ''}` },
              { key: 'due', label: 'Due', render: (l: LibraryLoan) => (
                <span>
                  {fmtDate(l.dueOn)}
                  {l.dueOn < todayISO() ? <Badge tone="danger" >overdue</Badge> : null}
                </span>
              ) },
              { key: 'act', label: '', render: (l: LibraryLoan) => (
                <>
                  <Button variant="ghost" onClick={() => ret(l, 'ok')}><Icon name="Check" size={14} /> Return</Button>
                  <Button variant="ghost" onClick={() => ret(l, 'damaged')}>Return damaged</Button>
                  <Button variant="ghost" onClick={async () => { try { const r = await libraryRenew(l.id); toast({ title: 'Renewed', sub: `New due ${fmtDate(r.dueOn)}`, tone: 'success' }); setTick((t) => t + 1); } catch (e) { toast({ title: friendly(e), tone: 'error' }); } }}>Renew</Button>
                </>
              ) },
            ]}
            rows={rows} rowKey={(l: LibraryLoan) => l.id}
          />
        )}
      </Card>
    </div>
  );
}
