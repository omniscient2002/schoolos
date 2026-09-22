/* Add a book to the catalog. The librarian can let the school's scheme mint the reference number, or
   assign their own (e.g. an accession/register number). Copies are created with the title and each gets
   its own copy code / barcode from the configured scheme. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Badge, useToast, Section, KeyValue } from '../../../components/ui';
import { DeskIcon as Icon } from './shared';
import { friendly } from '../../../lib/friendlyErrors';
import { libraryAddBook } from '../../../services/adminApi';

const EMPTY = {
  title: '', subtitle: '', author: '', category: '', subject: '', publisher: '', edition: '', pubYear: '',
  language: 'English', isbn10: '', isbn13: '', deweyCode: '', shelfLocation: '', price: '', acquiredOn: '',
  vendor: '', billRef: '', bookType: 'book', description: '',
};

export default function AddBook() {
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ ...EMPTY });
  const [copies, setCopies] = useState('1');
  const [ownRef, setOwnRef] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; code: string; title: string; copies: number } | null>(null);

  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!f.title.trim()) { toast({ title: 'Give the book a title', tone: 'info' }); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        title: f.title.trim(), subtitle: f.subtitle || undefined, author: f.author || undefined,
        category: f.category || undefined, subject: f.subject || undefined, publisher: f.publisher || undefined,
        edition: f.edition || undefined, pubYear: f.pubYear ? Number(f.pubYear) : undefined, language: f.language || undefined,
        isbn10: f.isbn10 || undefined, isbn13: f.isbn13 || undefined, deweyCode: f.deweyCode || undefined,
        shelfLocation: f.shelfLocation || undefined, acquiredOn: f.acquiredOn || undefined, vendor: f.vendor || undefined,
        billRef: f.billRef || undefined, bookType: f.bookType, description: f.description || undefined,
        priceCents: f.price ? Math.round(Number(f.price) * 100) : undefined,
        copies: Math.max(1, Number(copies) || 1),
      };
      if (ownRef && code.trim()) body.code = code.trim();
      const r = await libraryAddBook(body);
      setCreated({ id: r.bookId, code: r.book.code, title: r.book.title, copies: r.book.copies });
      toast({ title: 'Book added to the catalog', tone: 'success' });
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  if (created) {
    return (
      <Card headAs="h2" head="Added to the catalog">
        <KeyValue cols={1} items={[
          { k: 'Title', v: created.title },
          { k: 'Reference number', v: <code>{created.code}</code> },
          { k: 'Copies on the shelf', v: created.copies },
        ]} />
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Button variant="primary" onClick={() => nav(`/library/desk/catalog/${created.id}`)}>Open the title</Button>
          <Button onClick={() => { setCreated(null); setF({ ...EMPTY }); setOwnRef(false); setCode(''); setCopies('1'); }}>Add another</Button>
          <Button variant="ghost" onClick={() => nav('/library/desk/catalog')}>Back to catalog</Button>
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <Card headAs="h2" head="Add a book" sub="Copies are generated with this school's identifier scheme" actions={<Badge tone="accent" dot>librarian</Badge>}>
        <Section title="The essentials">
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '2fr 1fr' }}>
            <label style={{ fontSize: 13 }}>Title *
              <input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. The Palace of Illusions" aria-label="Title" />
            </label>
            <label style={{ fontSize: 13 }}>Copies
              <input type="number" min={1} value={copies} onChange={(e) => setCopies(e.target.value)} aria-label="Copies" />
            </label>
            <label style={{ fontSize: 13 }}>Author
              <input value={f.author} onChange={(e) => set('author', e.target.value)} placeholder="Author" aria-label="Author" />
            </label>
            <label style={{ fontSize: 13 }}>Category
              <input value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="Fiction, Science…" aria-label="Category" />
            </label>
          </div>
        </Section>

        <Section title="Reference number" sub="Every book needs an id in the catalog. Let the scheme mint one, or type your own.">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 8 }}>
            <input type="checkbox" checked={ownRef} onChange={(e) => setOwnRef(e.target.checked)} /> Assign our own reference number
          </label>
          {ownRef && (
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SAH-2026-0417 or ACC-00123" aria-label="Reference number" />
          )}
          {!ownRef && <div className="u-xs u-muted">One will be generated automatically (e.g. <code>LIB-…</code>) and shown after you save.</div>}
        </Section>

        <Section title="Publication">
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <label style={{ fontSize: 13 }}>Publisher<input value={f.publisher} onChange={(e) => set('publisher', e.target.value)} aria-label="Publisher" /></label>
            <label style={{ fontSize: 13 }}>Edition<input value={f.edition} onChange={(e) => set('edition', e.target.value)} aria-label="Edition" /></label>
            <label style={{ fontSize: 13 }}>Year<input type="number" value={f.pubYear} onChange={(e) => set('pubYear', e.target.value)} aria-label="Publication year" /></label>
            <label style={{ fontSize: 13 }}>Language<input value={f.language} onChange={(e) => set('language', e.target.value)} aria-label="Language" /></label>
            <label style={{ fontSize: 13 }}>ISBN-13<input value={f.isbn13} onChange={(e) => set('isbn13', e.target.value)} aria-label="ISBN-13" /></label>
            <label style={{ fontSize: 13 }}>ISBN-10<input value={f.isbn10} onChange={(e) => set('isbn10', e.target.value)} aria-label="ISBN-10" /></label>
          </div>
        </Section>

        <Section title="Shelf and purchase">
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <label style={{ fontSize: 13 }}>Shelf location<input value={f.shelfLocation} onChange={(e) => set('shelfLocation', e.target.value)} placeholder="F-DIV-01" aria-label="Shelf location" /></label>
            <label style={{ fontSize: 13 }}>Subject<input value={f.subject} onChange={(e) => set('subject', e.target.value)} aria-label="Subject" /></label>
            <label style={{ fontSize: 13 }}>Dewey code<input value={f.deweyCode} onChange={(e) => set('deweyCode', e.target.value)} aria-label="Dewey code" /></label>
            <label style={{ fontSize: 13 }}>Type
              <select value={f.bookType} onChange={(e) => set('bookType', e.target.value)} aria-label="Book type">
                {['book', 'reference', 'magazine', 'journal', 'other'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>Price (₹)<input type="number" min={0} value={f.price} onChange={(e) => set('price', e.target.value)} aria-label="Price" /></label>
            <label style={{ fontSize: 13 }}>Acquired on<input type="date" value={f.acquiredOn} onChange={(e) => set('acquiredOn', e.target.value)} aria-label="Acquired on" /></label>
            <label style={{ fontSize: 13 }}>Vendor<input value={f.vendor} onChange={(e) => set('vendor', e.target.value)} aria-label="Vendor" /></label>
            <label style={{ fontSize: 13 }}>Bill reference<input value={f.billRef} onChange={(e) => set('billRef', e.target.value)} aria-label="Bill reference" /></label>
          </div>
        </Section>

        <Section title="Notes">
          <textarea value={f.description} onChange={(e) => set('description', e.target.value)} rows={3} placeholder="A short description (optional)" aria-label="Description" />
        </Section>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Button variant="primary" loading={busy} onClick={submit}><Icon name="Check" size={15} /> Add to catalog</Button>
          <Button variant="ghost" onClick={() => nav('/library/desk/catalog')}>Cancel</Button>
        </div>
      </Card>
    </div>
  );
}
