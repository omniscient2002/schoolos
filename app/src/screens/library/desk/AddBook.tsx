/* Add a book to the catalog. The librarian can let the school's scheme mint the reference number, or
   assign their own (e.g. an accession/register number). Copies are created with the title and each gets
   its own copy code / barcode from the configured scheme. */
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Badge, useToast, Section, KeyValue, DataTable, ErrorState } from '../../../components/ui';
import { DeskIcon as Icon } from './shared';
import { friendly } from '../../../lib/friendlyErrors';
import { humanize } from '../../../lib/labels';
import { libraryAddBook, libraryBulkBooks } from '../../../services/adminApi';
import { guessMapping, normalizeHeader, parseCsv } from '../../migration/importMapping';

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
                {['book', 'reference', 'magazine', 'journal', 'other'].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
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

      <BulkCatalogLoad onDone={() => nav('/library/desk/catalog')} />
    </div>
  );
}

/* ============================================================
   BulkCatalogLoad — a school arriving from another system has
   hundreds of titles, and the single-add door cannot carry them:
   the plugin's event budget refuses the write spine after ~60
   events. `POST /plugins/library/books/bulk` is the door built for
   it (one transaction, one summary event, ≤500 titles).

   It shipped with no caller, so the librarian had the capability and
   no way to reach it. This is that way: a spreadsheet in, a preview of
   exactly what will be created, and the batch outcome in the
   server's own numbers.

   The door is all-or-nothing — one bad row rejects the whole batch and
   writes nothing — so the error list is shown per row rather than
   summarised, because "3 of 200 failed" would be a lie: all 200 are
   still waiting.
   ============================================================ */

/** Catalogue columns a spreadsheet may carry, and the server's own field names. Anything else in
 *  the file is ignored rather than guessed at. */
const BULK_FIELDS = ['title', 'author', 'publisher', 'edition', 'pubYear', 'language', 'isbn13',
  'isbn10', 'subject', 'category', 'deweyCode', 'shelfLocation', 'price', 'acquiredOn', 'vendor',
  'billRef', 'bookType', 'description', 'code', 'copies'] as const;

function BulkCatalogLoad({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ inserted: number; copies: number } | null>(null);
  const [rowErrors, setRowErrors] = useState<{ row: number; error: string }[]>([]);

  const parsed = useMemo(() => parseCsv(text), [text]);

  /* Guess once per file, from the header. The server re-validates every row either way; this only
     saves the librarian from matching forty columns by hand. */
  const onText = (next: string) => {
    setText(next);
    setDone(null);
    setRowErrors([]);
    if (next.trim()) setMapping(guessMapping(parseCsv(next).columns, [...BULK_FIELDS]));
    else setMapping({});
  };

  const onFile = async (file: File) => {
    onText(await file.text());
    if (fileRef.current) fileRef.current.value = '';
  };

  const remap = (field: string, column: string) => {
    setDone(null); setRowErrors([]);
    setMapping(prev => {
      const next: Record<string, string> = {};
      for (const [src, tgt] of Object.entries(prev)) if (tgt && tgt !== field) next[src] = tgt;
      if (column) next[column] = field;
      return next;
    });
  };

  const rows = useMemo(() => {
    const byTarget = new Map<string, string>();
    for (const [src, tgt] of Object.entries(mapping)) if (tgt) byTarget.set(tgt, src);
    return parsed.rows.map((row, i) => {
      const book: Record<string, unknown> = {};
      for (const [field, src] of byTarget) {
        const raw = String(row[src] ?? '').trim();
        if (!raw) continue;
        if (field === 'copies') {
          const n = Number(raw);
          // a nonsense copy count is dropped rather than sent: the server would reject the batch anyway
          if (Number.isInteger(n) && n >= 1) book.copies = n;
          continue;
        }
        if (field === 'price') {
          const rupees = Number(raw);
          if (Number.isFinite(rupees)) book.priceCents = Math.round(rupees * 100);
          continue;
        }
        if (field === 'pubYear') {
          const y = Number(raw);
          if (Number.isInteger(y)) book.pubYear = y;
          continue;
        }
        book[field] = raw;
      }
      return { rowNo: i + 1, title: String(book.title ?? '—'), author: String(book.author ?? '—'), copies: Number(book.copies ?? 1), ref: String(book.code ?? ''), book };
    });
  }, [parsed.rows, mapping]);

  const missingTitles = rows.filter(r => r.book.title === undefined).length;

  const submit = async () => {
    setBusy(true); setRowErrors([]); setDone(null);
    try {
      const r = await libraryBulkBooks(rows.map(r => r.book));
      setDone({ inserted: r.inserted, copies: r.copies });
      toast({ title: `${r.inserted} title(s) added`, sub: `${r.copies} copies created from your identifier scheme — one summary event, so the load did not hit the plugin event budget.`, tone: 'success' });
    } catch (e) {
      const payload = (e as { payload?: { errors?: { row?: number; error?: string }[] } }).payload;
      const errs = Array.isArray(payload?.errors) ? payload.errors : [];
      if (errs.length) {
        setRowErrors(errs.map(x => ({ row: Number(x.row ?? 0) + 1, error: String(x.error ?? 'invalid row') })));
        toast({ title: `Nothing was imported — ${errs.length} row(s) need fixing`, sub: 'The door takes the batch or none of it, so every row below must be corrected before trying again.', tone: 'error' });
      } else {
        toast({ title: 'The catalog load was refused', sub: friendly(e), tone: 'error' });
      }
    } finally { setBusy(false); }
  };

  return (
    <Card headAs="h2" head="Load a catalog in bulk" sub="For a school arriving from another system. Up to 500 titles per batch, all or nothing.">
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            ref={fileRef} type="file" accept=".csv,text/csv" onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
            aria-label="CSV file of catalogue rows" style={{ display: 'block' }}
          />
        </div>
        <label style={{ fontSize: 13 }}>Or paste the rows — first line is the column names
          <textarea
            rows={4} value={text} onChange={e => onText(e.target.value)} style={{ width: '100%', marginTop: 5 }}
            placeholder={'Title,Author,Copies,Shelf\nThe Palace of Illusions,Meera Iyer,3,F-DIV-01'}
            aria-label="Catalogue rows"
          />
        </label>

        {parsed.columns.length > 0 && (
          <>
            <div className="u-small u-muted">
              Read <b>{parsed.rows.length}</b> row(s) across <b>{parsed.columns.length}</b> column(s)
              {parsed.rows.length > 500 && ' — over the 500-title limit, so split the file into batches'}
              {parsed.skipped > 0 && ` — ${parsed.skipped} line(s) did not have one value per column`}.
            </div>

            <div style={{ display: 'grid', gap: 6 }}>
              <span className="u-small" style={{ fontWeight: 600 }}>Match the columns to catalogue fields</span>
              <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                {BULK_FIELDS.map(field => (
                  <label key={field} className="u-xs" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ minWidth: 96, color: 'var(--text-2)' }}>{field}</span>
                    <select
                      value={Object.entries(mapping).find(([, t]) => t === field)?.[0] ?? ''}
                      onChange={e => remap(field, e.target.value)}
                      aria-label={`Column for ${field}`}
                      style={{ flex: 1 }}
                    >
                      <option value="">—</option>
                      {parsed.columns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <div className="u-xs u-faint">
                Unmatched columns are ignored. Nothing is inferred from a header word — the guess only pre-fills the
                picker, and the server validates every row you send.
              </div>
            </div>

            {missingTitles > 0 && (
              <ErrorState
                title={`${missingTitles} row(s) have no title`}
                sub="A title is the one field the catalogue cannot do without. Match the column that carries it, or remove the row."
              />
            )}

            {rows.length > 0 && missingTitles === 0 && (
              <DataTable
                rows={rows.slice(0, 10)}
                rowKey={r => String(r.rowNo)}
                columns={[
                  { key: 'rowNo', label: 'Row' },
                  { key: 'title', label: 'Title' },
                  { key: 'author', label: 'Author' },
                  { key: 'copies', label: 'Copies', align: 'right' },
                  { key: 'ref', label: 'Own reference' },
                ]}
                caption={rows.length > 10 ? `The first 10 of ${rows.length} rows` : `${rows.length} rows ready to load`}
              />
            )}

            {rowErrors.length > 0 && (
              <div style={{ display: 'grid', gap: 4 }}>
                <span className="u-small" style={{ fontWeight: 600, color: 'var(--danger-text)' }}>
                  Nothing was imported. Fix these rows and try again:
                </span>
                {rowErrors.map((e, i) => (
                  <div key={i} className="u-small" style={{ color: 'var(--danger-text)' }}>Row {e.row}: {e.error}</div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button
                variant="primary" loading={busy}
                disabled={busy || !rows.length || missingTitles > 0 || rows.length > 500}
                onClick={submit}
              >
                <Icon name="Check" size={15} /> Load {rows.length} title(s)
              </Button>
              {done && <Button variant="ghost" onClick={onDone}>Open the catalog</Button>}
            </div>
            {done && (
              <div className="u-small" style={{ color: 'var(--success-text, var(--accent-text))' }}>
                Added <b>{done.inserted}</b> title(s) and created <b>{done.copies}</b> copies. Every copy carries its own
                code from this school&apos;s identifier scheme.
              </div>
            )}
          </>
        )}
        {parsed.columns.length > 0 && <div className="u-xs u-faint">Header names like “{normalizeHeader(parsed.columns[0])}” are matched loosely; nothing is sent that you have not matched above.</div>}
      </div>
    </Card>
  );
}
