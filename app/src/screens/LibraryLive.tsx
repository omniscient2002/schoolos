/* ============================================================
   LibraryLive — real library plugin surface (issue → return →
   overdue), replacing the demo Library screen while the plugin
   is enabled. Server truth: library.* doors (issue/return are
   staff-only; students see their own loans via /loans/mine).
   Decoupled: if the school disables the library plugin, this
   route disappears (KernelGate) — nothing else changes.
   ============================================================ */
import { useEffect, useState } from 'react';
import {
  PageHead, Card, Badge, Button, useToast, Empty, ErrorState, SkeletonCard, DataTable,
} from '../components/ui';
import { friendly } from '../lib/friendlyErrors';
import { useSession } from '../App';
import {
  libraryBooks, libraryAddBook, libraryIssue, libraryReturn,
  libraryLoans, libraryOverdue, libraryMyLoans,
  type LibraryBook, type LibraryLoan,
} from '../services/adminApi';

const inr = (cents: number) => `₹${(cents / 100).toFixed(2)}`;

export default function LibraryLive() {
  const toast = useToast();
  const live = useSession();
  const isStaff = ['owner', 'principal', 'coordinator', 'facilities'].includes(live.role);
  const isStudent = live.role === 'student';

  const [books, setBooks] = useState<LibraryBook[] | null>(null);
  const [loans, setLoans] = useState<LibraryLoan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState('');

  /* add-book form */
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [copies, setCopies] = useState('1');
  const [adding, setAdding] = useState(false);

  /* issue form */
  const [bookId, setBookId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [dueOn, setDueOn] = useState(() => {
    const d = new Date(Date.now() + 14 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [issuing, setIssuing] = useState(false);

  const refresh = () => setTick(t => t + 1);

  useEffect(() => {
    let dead = false;
    setLoading(true); setError(null);
    const jobs: Promise<void>[] = [libraryBooks(search)
      .then(r => { if (!dead) setBooks(r.books); })];
    if (isStaff) {
      jobs.push(libraryLoans('open').then(r => { if (!dead) setLoans(r.loans); }));
    } else if (isStudent) {
      jobs.push(libraryMyLoans().then(r => { if (!dead) setLoans(r.loans); }));
    }
    Promise.all(jobs)
      .then(() => { if (!dead) setLoading(false); })
      .catch(e => { if (!dead) { setError(friendly(e)); setLoading(false); } });
    return () => { dead = true; };
  }, [tick, search, isStaff, isStudent]);

  const addBook = async () => {
    if (!title.trim() || !author.trim()) { toast({ title: 'Title and author are needed', tone: 'info' }); return; }
    setAdding(true);
    try {
      await libraryAddBook({ title: title.trim(), author: author.trim(), copiesTotal: Math.max(1, Number(copies) || 1) });
      toast({ title: `"${title.trim()}" added to the catalog`, tone: 'success' });
      setTitle(''); setAuthor(''); setCopies('1'); refresh();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setAdding(false); }
  };

  const issue = async () => {
    if (!bookId || !studentId) { toast({ title: 'Pick a book and enter the student ID', tone: 'info' }); return; }
    setIssuing(true);
    try {
      await libraryIssue({ bookId, studentId, dueOn });
      toast({ title: 'Book issued', sub: `Due back ${dueOn}`, tone: 'success' });
      setBookId(''); setStudentId(''); refresh();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setIssuing(false); }
  };

  const doReturn = async (loan: LibraryLoan) => {
    try {
      const r = await libraryReturn(loan.id);
      toast({
        title: 'Book returned',
        sub: r.fineCents > 0 ? `Late fine: ${inr(r.fineCents)}` : 'On time — no fine',
        tone: r.fineCents > 0 ? 'info' : 'success',
      });
      refresh();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <PageHead
        title="Library"
        sub={isStaff ? 'Catalog, issue, return and overdue books — fines are calculated automatically at return' : 'Your library books and when they are due back'}
        actions={<Badge tone="accent" dot>library plugin</Badge>}
      />

      {loading && <SkeletonCard />}
      {error && <ErrorState title="Could not load" sub={error?.replace('Error: ', '')} onRetry={refresh} />}

      {!loading && !error && (
        <>
          {isStaff && (
            <div style={{ display: 'grid', gap: 'var(--s-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginBottom: 'var(--s-4)' }}>
              <Card headAs="h2" head="Add a book" sub="Title, author and number of copies">
                <div style={{ display: 'grid', gap: 10 }}>
                  <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Book title" aria-label="Book title" />
                  <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Author" aria-label="Author" />
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                    Copies <input type="number" min={1} value={copies} onChange={e => setCopies(e.target.value)} style={{ width: 80 }} aria-label="Copies" />
                  </label>
                  <Button onClick={addBook} disabled={adding}>{adding ? 'Adding…' : 'Add to catalog'}</Button>
                </div>
              </Card>
              <Card headAs="h2" head="Issue a book" sub="14-day due date by default; the server refuses if no copies are left">
                <div style={{ display: 'grid', gap: 10 }}>
                  <select value={bookId} onChange={e => setBookId(e.target.value)} aria-label="Book">
                    <option value="">Choose a book…</option>
                    {(books ?? []).filter(b => b.copiesTotal - b.copiesOut > 0).map(b => (
                      <option key={b.id} value={b.id}>{b.title} ({b.copiesTotal - b.copiesOut} left)</option>
                    ))}
                  </select>
                  <input value={studentId} onChange={e => setStudentId(e.target.value)} placeholder="Student ID" aria-label="Student ID" />
                  <input type="date" value={dueOn} onChange={e => setDueOn(e.target.value)} aria-label="Due date" />
                  <Button onClick={issue} disabled={issuing}>{issuing ? 'Issuing…' : 'Issue book'}</Button>
                </div>
              </Card>
            </div>
          )}

          {isStaff && (
            <Card headAs="h2" head="Books currently out" sub="Return with one tap — late returns show the fine">
              {loans && loans.length ? (
                <DataTable
                  columns={[
                    { key: 'book', label: 'Book', render: (l: LibraryLoan) => `${l.bookTitle} (${l.bookCode})` },
                    { key: 'student', label: 'Student', render: (l: LibraryLoan) => `${l.studentName} · ${l.studentGrade}-${l.studentSection}` },
                    { key: 'issued', label: 'Issued', render: (l: LibraryLoan) => new Date(l.issuedAt).toLocaleDateString() },
                    { key: 'due', label: 'Due', render: (l: LibraryLoan) => new Date(l.dueOn).toLocaleDateString() },
                    { key: 'act', label: '', render: (l: LibraryLoan) => <Button variant="ghost" onClick={() => doReturn(l)}>Return</Button> },
                  ]}
                  rows={loans}
                  rowKey={(l: LibraryLoan) => l.id}
                />
              ) : <Empty title="No books are out" sub="Everything is on the shelf." />}
            </Card>
          )}

          {isStudent && (
            <Card headAs="h2" head="My books" sub="Return these at the library counter">
              {loans && loans.length ? (
                <DataTable
                  columns={[
                    { key: 'book', label: 'Book', render: (l: LibraryLoan) => `${l.bookTitle} (${l.bookCode})` },
                    { key: 'issued', label: 'Issued', render: (l: LibraryLoan) => new Date(l.issuedAt).toLocaleDateString() },
                    { key: 'due', label: 'Due', render: (l: LibraryLoan) => new Date(l.dueOn).toLocaleDateString() },
                    { key: 'status', label: 'Status', render: (l: LibraryLoan) => l.status === 'issued' ? <Badge tone={new Date(l.dueOn) < new Date() ? 'danger' : 'info'}>{new Date(l.dueOn) < new Date() ? 'Overdue' : 'With you'}</Badge> : <Badge tone="success">Returned</Badge> },
                  ]}
                  rows={loans}
                  rowKey={(l: LibraryLoan) => l.id}
                />
              ) : <Empty title="No books borrowed yet" sub="Ask at the library counter." />}
            </Card>
          )}

          <Card headAs="h2" head="Catalog" sub={`${books?.length ?? 0} titles`}>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by title, author or code…" aria-label="Search catalog"
              style={{ marginBottom: 10 }}
            />
            {books && books.length ? (
              <DataTable
                columns={[
                  { key: 'title', label: 'Title', render: (b: LibraryBook) => `${b.title} (${b.code})` },
                  { key: 'author', label: 'Author' },
                  { key: 'cat', label: 'Category' },
                  { key: 'avail', label: 'Available', render: (b: LibraryBook) => <Badge tone={b.copiesTotal - b.copiesOut > 0 ? 'success' : 'warning'}>{b.copiesTotal - b.copiesOut} of {b.copiesTotal}</Badge> },
                ]}
                rows={books}
                rowKey={(b: LibraryBook) => b.id}
              />
            ) : <Empty title="No books match" sub="Try another search." />}
          </Card>

          {isStaff && (
            <Card headAs="h2" head="Overdue" sub="These need a reminder — the server lists them, you decide how to chase">
              <OverdueTable onRefresh={refresh} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function OverdueTable({ onRefresh }: { onRefresh: () => void }) {
  const [loans, setLoans] = useState<LibraryLoan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    libraryOverdue()
      .then(r => { if (!dead) setLoans(r.loans); })
      .catch(e => { if (!dead) setError(friendly(e)); });
    return () => { dead = true; };
  }, []);
  if (error) return <ErrorState title="Could not load" sub={error?.replace('Error: ', '')} onRetry={onRefresh} />;
  if (!loans?.length) return <Empty title="Nothing overdue" sub="The whole library is on time." />;
  return (
    <DataTable
      columns={[
        { key: 'book', label: 'Book', render: (l: LibraryLoan) => `${l.bookTitle} (${l.bookCode})` },
        { key: 'student', label: 'Student', render: (l: LibraryLoan) => `${l.studentName} · ${l.studentGrade}-${l.studentSection}` },
        { key: 'due', label: 'Due', render: (l: LibraryLoan) => new Date(l.dueOn).toLocaleDateString() },
        { key: 'late', label: 'Days late', render: (l: LibraryLoan) => String(Math.max(0, Math.floor((Date.now() - new Date(l.dueOn).getTime()) / 86400000))) },
      ]}
      rows={loans}
      rowKey={(l: LibraryLoan) => l.id}
    />
  );
}
