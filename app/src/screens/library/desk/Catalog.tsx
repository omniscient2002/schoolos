/* Catalog — search every title, see availability, open a title, add copies or retire it. */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Badge, DataTable, ErrorState, Empty, Modal, useToast } from '../../../components/ui';
import { DeskIcon as Icon } from './shared';
import { friendly } from '../../../lib/friendlyErrors';
import { libraryDeskBooks, libraryAddCopies, libraryRetireBook, libraryBookCoverUrl, type LibraryBook } from '../../../services/adminApi';

export default function Catalog() {
  const nav = useNavigate();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [books, setBooks] = useState<LibraryBook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [copiesFor, setCopiesFor] = useState<LibraryBook | null>(null);
  const [copies, setCopies] = useState('1');

  useEffect(() => {
    let dead = false; setError(null);
    libraryDeskBooks(search || undefined).then((r) => { if (!dead) setBooks(r.books ?? []); }).catch((e) => { if (!dead) setError(friendly(e)); });
    return () => { dead = true; };
  }, [search, tick]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, tone: 'success' }); setTick((t) => t + 1); }
    catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };

  if (error) return <ErrorState title="Could not load the catalog" sub={error.replace('Error: ', '')} onRetry={() => setTick((t) => t + 1)} />;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <Card
        headAs="h2" head="Catalog"
        actions={<Button variant="primary" onClick={() => nav('/library/desk/catalog/new')}><Icon name="Plus" size={15} /> Add a book</Button>}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, author, ISBN or reference number…" aria-label="Search catalog" style={{ marginBottom: 10 }} />
        {books === null ? <Empty title="Loading…" /> : books.length === 0 ? (
          <Empty title="No titles match" sub="Try a different word, or add the book to the catalog." />
        ) : (
          <DataTable
            columns={[
              { key: 'title', label: 'Title', render: (b: LibraryBook) => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {b.coverFileId ? <img src={libraryBookCoverUrl(b.id)} alt="" width={24} height={32} style={{ objectFit: 'cover', borderRadius: 4 }} /> : null}
                  <span><b>{b.title}</b><span className="u-xs u-muted" style={{ display: 'block' }}>{b.author || '—'}{b.category ? ` · ${b.category}` : ''}</span></span>
                </span>
              ) },
              { key: 'code', label: 'Reference', render: (b: LibraryBook) => <code>{b.code}</code> },
              { key: 'avail', label: 'Available', render: (b: LibraryBook) => <Badge tone={b.available > 0 ? 'success' : 'warning'}>{b.available} of {b.copiesTotal}</Badge> },
              { key: 'shelf', label: 'Shelf', render: (b: LibraryBook) => b.shelfLocation || '—' },
              { key: 'act', label: '', render: (b: LibraryBook) => (
                <>
                  <Button variant="ghost" onClick={() => nav(`/library/desk/catalog/${b.id}`)}>Open</Button>
                  <Button variant="ghost" onClick={() => { setCopiesFor(b); setCopies('1'); }}>Add copies</Button>
                  <Button variant="ghost" onClick={() => run(() => libraryRetireBook(b.id), 'Title retired')}>Retire</Button>
                </>
              ) },
            ]}
            rows={books} rowKey={(b: LibraryBook) => b.id}
          />
        )}
      </Card>

      <Modal open={!!copiesFor} onClose={() => setCopiesFor(null)} title={`Add copies — ${copiesFor?.title ?? ''}`}
        sub="Each copy gets its own accession/barcode number from the school's identifier scheme."
        footer={<><Button onClick={() => setCopiesFor(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => { if (copiesFor) run(() => libraryAddCopies(copiesFor.id, Math.max(1, Number(copies) || 1)), 'Copies added').then(() => setCopiesFor(null)); }}>Add copies</Button></>}>
        <label style={{ fontSize: 13 }}>How many copies?
          <input type="number" min={1} value={copies} onChange={(e) => setCopies(e.target.value)} aria-label="Copies" />
        </label>
      </Modal>
    </div>
  );
}
