/* LibraryHome — the borrower catalog (students + all non-parent staff).
   Search the catalog, reserve a title, see your loans/fines, and suggest a book the library does not have.
   Server truth: GET /plugins/library/catalog, /loans/mine, /reservations/mine, /fines/mine, /acquisitions*.
   Render-only gates; every door re-decides server-side. */
import { useEffect, useState } from 'react';
import { PageHead, Card, Badge, Button, useToast, Empty, ErrorState, SkeletonCard, DataTable } from '../../components/ui';
import { friendly } from '../../lib/friendlyErrors';
import { fmtDate } from '../../lib/format';
import { pluginLabel, statusLabel, humanize } from '../../lib/labels';
import {
  libraryCatalog, libraryReserve, libraryMyLoans, libraryRenewRequest, libraryMyFines,
  libraryMyReservations, libraryCancelReservation, libraryMyRequests, libraryRequestBook,
  libraryBookCoverUrl,
  type LibraryBook, type LibraryLoan, type LibraryFine, type LibraryReservation, type LibraryAcq,
} from '../../services/adminApi';

const inr = (cents: number) => `₹${(cents / 100).toFixed(2)}`;
const dueTone = (l: LibraryLoan) => (l.status === 'issued' && l.overdue ? 'danger' : l.status === 'issued' ? 'info' : 'success');

export default function LibraryHome() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [books, setBooks] = useState<LibraryBook[] | null>(null);
  const [loans, setLoans] = useState<LibraryLoan[]>([]);
  const [fines, setFines] = useState<LibraryFine[]>([]);
  const [holds, setHolds] = useState<LibraryReservation[]>([]);
  const [requests, setRequests] = useState<LibraryAcq[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [req, setReq] = useState({ title: '', author: '' });

  useEffect(() => {
    let dead = false;
    setLoading(true); setError(null);
    Promise.all([
      libraryCatalog(search).then((r) => { if (!dead) setBooks(r.books); }),
      libraryMyLoans().then((r) => { if (!dead) setLoans(r.loans ?? []); }).catch(() => {}),
      libraryMyFines().then((r) => { if (!dead) setFines(r.fines ?? []); }).catch(() => {}),
      libraryMyReservations().then((r) => { if (!dead) setHolds(r.reservations ?? []); }).catch(() => {}),
      libraryMyRequests().then((r) => { if (!dead) setRequests(r.requests ?? []); }).catch(() => {}),
    ]).then(() => { if (!dead) setLoading(false); })
      .catch((e) => { if (!dead) { setError(friendly(e)); setLoading(false); } });
    return () => { dead = true; };
  }, [tick, search]);

  const reserve = async (b: LibraryBook) => {
    const queued = b.available < 1;
    try {
      await libraryReserve(b.id);
      toast({
        title: queued ? `Joined the queue for "${b.title}"` : `Reserved "${b.title}"`,
        sub: queued ? 'The librarian will let you know when a copy is free.' : 'Collect it at the library when it is ready.',
        tone: 'success',
      });
      setTick(t => t + 1);
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };
  const renew = async (l: LibraryLoan) => {
    try { const r = await libraryRenewRequest(l.id); toast({ title: 'Renewed', sub: `New due date ${r.dueOn}`, tone: 'success' }); setTick(t => t + 1); }
    catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };
  const cancelHold = async (h: LibraryReservation) => {
    try { await libraryCancelReservation(h.id); toast({ title: 'Reservation cancelled', tone: 'success' }); setTick(t => t + 1); }
    catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };
  const requestBook = async () => {
    if (req.title.trim().length < 2) { toast({ title: 'Give the book a title', tone: 'info' }); return; }
    try {
      const r = await libraryRequestBook({ title: req.title.trim(), author: req.author.trim() || undefined });
      toast({ title: r.voted ? 'Added your vote for this book' : 'Request sent to the library', tone: 'success' });
      setReq({ title: '', author: '' }); setTick(t => t + 1);
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <PageHead title="Library" sub="Search the catalog, reserve a book, and see what you have out" actions={<Badge tone="accent" dot>{pluginLabel('library')}</Badge>} />
      {loading && <SkeletonCard />}
      {error && <ErrorState title="Could not load" sub={error.replace('Error: ', '')} onRetry={() => setTick(t => t + 1)} />}
      {!loading && !error && (
        <>
          <Card headAs="h2" head="Catalog" sub="Reserve a title — the librarian issues it when a copy is free">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by title, author, ISBN or code…" aria-label="Search catalog" style={{ marginBottom: 10 }} />
            {books && books.length ? (
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
                {books.map((b) => (
                  <div key={b.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-lg)', padding: 12, display: 'grid', gap: 6 }}>
                    {b.coverFileId ? <img src={libraryBookCoverUrl(b.id)} alt="" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8 }} /> : null}
                    <div style={{ fontWeight: 700 }}>{b.title}</div>
                    <div className="u-xs u-muted">{b.author || '—'}{b.category ? ` · ${b.category}` : ''}</div>
                    <div className="u-between">
                      <Badge tone={b.available > 0 ? 'success' : 'warning'}>{b.available} of {b.copiesTotal} available</Badge>
                      <Button variant="secondary" onClick={() => reserve(b)}>{b.available > 0 ? 'Reserve' : 'Join queue'}</Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No books match" sub="Can't find it? Request it below and the librarian will consider buying it." />
            )}
          </Card>

          <Card headAs="h2" head="My books" sub="Return these at the library counter; you can renew if nobody is waiting">
            {loans.length ? (
              <DataTable
                columns={[
                  { key: 'book', label: 'Book', render: (l: LibraryLoan) => `${l.bookTitle} (${l.bookCode})` },
                  { key: 'due', label: 'Due', render: (l: LibraryLoan) => fmtDate(l.dueOn) },
                  { key: 'status', label: 'Status', render: (l: LibraryLoan) => <Badge tone={dueTone(l)}>{l.status === 'issued' ? (l.overdue ? 'Overdue' : 'With you') : 'Returned'}</Badge> },
                  { key: 'fine', label: 'Fine', render: (l: LibraryLoan) => (l.fineCents ? inr(l.fineCents) : '—') },
                  { key: 'act', label: '', render: (l: LibraryLoan) => (l.status === 'issued' ? <Button variant="ghost" onClick={() => renew(l)}>Renew</Button> : null) },
                ]}
                rows={loans} rowKey={(l: LibraryLoan) => l.id}
              />
            ) : <Empty title="No books borrowed yet" sub="Reserve one from the catalog above." />}
          </Card>

          <Card headAs="h2" head="My reservations">
            {holds.length ? (
              <DataTable
                columns={[
                  { key: 'book', label: 'Book', render: (h: LibraryReservation) => h.title ?? '—' },
                  { key: 'status', label: 'Status', render: (h: LibraryReservation) => <Badge tone={h.status === 'ready' ? 'success' : 'info'}>{h.status === 'ready' ? 'Ready to collect' : 'In queue'}</Badge> },
                  { key: 'act', label: '', render: (h: LibraryReservation) => <Button variant="ghost" onClick={() => cancelHold(h)}>Cancel</Button> },
                ]}
                rows={holds} rowKey={(h: LibraryReservation) => h.id}
              />
            ) : <Empty title="No reservations" sub="Reserve a title from the catalog." />}
          </Card>

          {fines.length > 0 && (
            <Card headAs="h2" head="My fines" sub="Pay at the library counter">
              <DataTable
                columns={[
                  { key: 'cause', label: 'Reason', render: (f: LibraryFine) => humanize(f.cause) },
                  { key: 'amount', label: 'Amount', render: (f: LibraryFine) => inr(f.amount_cents) },
                  { key: 'status', label: 'Status', render: (f: LibraryFine) => <Badge tone={f.status === 'outstanding' ? 'warning' : 'success'}>{statusLabel(f.status)}</Badge> },
                ]}
                rows={fines} rowKey={(f: LibraryFine) => f.id}
              />
            </Card>
          )}

          <Card headAs="h2" head="Request a book" sub="Not in the catalog? Suggest it — popular requests rise to the top">
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '2fr 1fr auto' }}>
              <input value={req.title} onChange={(e) => setReq({ ...req, title: e.target.value })} placeholder="Book title" aria-label="Book title" />
              <input value={req.author} onChange={(e) => setReq({ ...req, author: e.target.value })} placeholder="Author (optional)" aria-label="Author" />
              <Button onClick={requestBook}>Request</Button>
            </div>
            {requests.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <DataTable
                  columns={[
                    { key: 'title', label: 'Requested', render: (r: LibraryAcq) => r.title },
                    { key: 'votes', label: 'Demand', render: (r: LibraryAcq) => `${r.vote_count} ${r.vote_count === 1 ? 'vote' : 'votes'}` },
                    { key: 'status', label: 'Status', render: (r: LibraryAcq) => <Badge tone={r.status === 'added' ? 'success' : r.status === 'rejected' ? 'danger' : 'info'}>{statusLabel(r.status)}</Badge> },
                  ]}
                  rows={requests} rowKey={(r: LibraryAcq) => r.id}
                />
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
