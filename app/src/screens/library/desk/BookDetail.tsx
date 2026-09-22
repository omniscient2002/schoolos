/* BookDetail — one title: metadata, every copy and who has it, open loans, cover, and quick edits. */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Button, Badge, DataTable, ErrorState, SkeletonCard, Section, KeyValue, useToast } from '../../../components/ui';
import { DeskIcon as Icon } from './shared';
import { friendly } from '../../../lib/friendlyErrors';
import {
  libraryDeskBook, libraryUpdateBook, libraryAddCopies, librarySetCopy, libraryBookCoverUrl, filesUploadBase64,
  type LibraryDeskBookDetail, type LibraryCopy,
} from '../../../services/adminApi';
import { fmtDate, inr } from './shared';

export default function BookDetail() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [data, setData] = useState<LibraryDeskBookDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [edit, setEdit] = useState<{ title: string; author: string; category: string; shelf: string; price: string } | null>(null);
  const [copies, setCopies] = useState('1');

  useEffect(() => {
    let dead = false; setError(null);
    libraryDeskBook(id).then((r) => { if (!dead) setData(r); }).catch((e) => { if (!dead) setError(friendly(e)); });
    return () => { dead = true; };
  }, [id, tick]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, tone: 'success' }); setTick((t) => t + 1); }
    catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };

  const uploadCover = async (file: File) => {
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
        fr.onerror = () => reject(new Error('Could not read that image'));
        fr.readAsDataURL(file);
      });
      const { file: stored } = await filesUploadBase64({ filename: file.name, mime: file.type || 'image/jpeg', dataBase64, scope: 'general', refId: id });
      await libraryUpdateBook(id, { cover_file_id: stored.id });
      toast({ title: 'Cover updated', tone: 'success' }); setTick((t) => t + 1);
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };

  if (error) return <ErrorState title="Could not load that title" sub={error.replace('Error: ', '')} onRetry={() => setTick((t) => t + 1)} />;
  if (!data) return <SkeletonCard />;
  const b = data.book;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <Card>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ width: 110 }}>
            {b.coverFileId ? <img src={libraryBookCoverUrl(b.id)} alt="" style={{ width: 110, height: 150, objectFit: 'cover', borderRadius: 8 }} />
              : <div style={{ width: 110, height: 150, borderRadius: 8, background: 'var(--surface-2)', display: 'grid', placeItems: 'center' }}><Icon name="Book" size={28} /></div>}
            <label style={{ display: 'block', marginTop: 8, fontSize: 12 }}>Cover
              <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadCover(file); }} />
            </label>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
              <div>
                <h2 style={{ margin: 0 }}>{b.title}</h2>
                <div className="u-muted" style={{ fontSize: 13 }}>{b.author || '—'}{b.publisher ? ` · ${b.publisher}` : ''}{b.pubYear ? ` · ${b.pubYear}` : ''}</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Badge tone="accent"><code>{b.code}</code></Badge>
                  <Badge tone={b.available > 0 ? 'success' : 'warning'}>{b.available} of {b.copiesTotal} available</Badge>
                  {b.holds ? <Badge tone="info">{b.holds} hold{b.holds === 1 ? '' : 's'}</Badge> : null}
                  {b.retired ? <Badge tone="danger">retired</Badge> : null}
                </div>
              </div>
              <Button onClick={() => setEdit({ title: b.title, author: b.author ?? '', category: b.category ?? '', shelf: b.shelfLocation ?? '', price: b.priceCents ? String(b.priceCents / 100) : '' })}><Icon name="Edit" size={15} /> Edit</Button>
            </div>
            <div style={{ marginTop: 12 }}>
              <KeyValue cols={2} items={[
                { k: 'Category', v: b.category || '—' },
                { k: 'Subject', v: b.subject || '—' },
                { k: 'Shelf', v: b.shelfLocation || '—' },
                { k: 'Dewey', v: b.deweyCode || '—' },
                { k: 'ISBN', v: b.isbn13 || b.isbn10 || '—' },
                { k: 'Price', v: b.priceCents ? inr(b.priceCents) : '—' },
                { k: 'Vendor', v: b.vendor || '—' },
                { k: 'Acquired', v: fmtDate(b.acquiredOn) },
              ]} />
            </div>
          </div>
        </div>
      </Card>

      {edit && (
        <Card headAs="h2" head="Edit metadata">
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <label style={{ fontSize: 13 }}>Title<input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} aria-label="Title" /></label>
            <label style={{ fontSize: 13 }}>Author<input value={edit.author} onChange={(e) => setEdit({ ...edit, author: e.target.value })} aria-label="Author" /></label>
            <label style={{ fontSize: 13 }}>Category<input value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} aria-label="Category" /></label>
            <label style={{ fontSize: 13 }}>Shelf<input value={edit.shelf} onChange={(e) => setEdit({ ...edit, shelf: e.target.value })} aria-label="Shelf" /></label>
            <label style={{ fontSize: 13 }}>Price (₹)<input value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} aria-label="Price" /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Button variant="primary" onClick={() => run(() => libraryUpdateBook(b.id, { title: edit.title, author: edit.author, category: edit.category, shelf_location: edit.shelf, price_cents: edit.price ? Math.round(Number(edit.price) * 100) : undefined }), 'Saved').then(() => setEdit(null))}>Save</Button>
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card headAs="h2" head="Copies" actions={
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <input type="number" min={1} value={copies} onChange={(e) => setCopies(e.target.value)} aria-label="Copies to add" style={{ width: 70 }} />
          <Button onClick={() => run(() => libraryAddCopies(b.id, Math.max(1, Number(copies) || 1)), 'Copies added')}><Icon name="Plus" size={14} /> Add</Button>
        </span>
      }>
        <DataTable
          columns={[
            { key: 'code', label: 'Copy', render: (k: LibraryCopy) => <code>{k.copy_code}</code> },
            { key: 'status', label: 'Status', render: (k: LibraryCopy) => <Badge tone={k.status === 'available' ? 'success' : k.status === 'issued' ? 'info' : 'warning'}>{k.status}</Badge> },
            { key: 'who', label: 'With', render: (k: LibraryCopy) => k.borrower ? `${k.borrower}${k.due_on ? ` · due ${fmtDate(k.due_on)}` : ''}` : '—' },
            { key: 'act', label: '', render: (k: LibraryCopy) => k.status === 'issued' ? null : (
              <>
                <Button variant="ghost" onClick={() => run(() => librarySetCopy(k.id, { status: 'available' }), 'Copy available')}>Available</Button>
                <Button variant="ghost" onClick={() => run(() => librarySetCopy(k.id, { status: 'damaged' }), 'Copy damaged')}>Damaged</Button>
                <Button variant="ghost" onClick={() => run(() => librarySetCopy(k.id, { status: 'lost' }), 'Copy lost')}>Lost</Button>
              </>
            ) },
          ]}
          rows={data.copies} rowKey={(k: LibraryCopy) => k.id}
        />
      </Card>

      <Card headAs="h2" head="Open loans">
        {data.openLoans.length ? (
          <DataTable
            columns={[
              { key: 'borrower', label: 'Borrower', render: (l) => `${l.borrower ?? '—'} (${l.borrower_type})` },
              { key: 'copy', label: 'Copy', render: (l) => <code>{l.copy_code}</code> },
              { key: 'due', label: 'Due', render: (l) => fmtDate(l.due_on) },
            ]}
            rows={data.openLoans} rowKey={(l) => l.id}
          />
        ) : <Section title="No copies are out">Everyone has returned this title.</Section>}
      </Card>
    </div>
  );
}
