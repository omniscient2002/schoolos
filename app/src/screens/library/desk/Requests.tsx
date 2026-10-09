/* Purchase requests — borrower suggestions sorted by demand. Approve, order (with vendor/budget/cost), add
   to the catalog, or reject with a reason. */
import { useEffect, useState } from 'react';
import { Card, Button, Badge, DataTable, ErrorState, Empty, Modal, useToast } from '../../../components/ui';
import { friendly } from '../../../lib/friendlyErrors';
import { statusLabel } from '../../../lib/labels';
import { libraryAcquisitions, libraryDecideAcq, type LibraryAcq } from '../../../services/adminApi';
import { fmtDate, inr } from './shared';

export default function Requests() {
  const toast = useToast();
  const [status, setStatus] = useState('requested');
  const [rows, setRows] = useState<LibraryAcq[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [order, setOrder] = useState<{ req: LibraryAcq; decision: 'ordered' | 'added' } | null>(null);
  const [form, setForm] = useState({ vendor: '', budgetCode: '', cost: '' });
  const [reject, setReject] = useState<{ req: LibraryAcq; note: string } | null>(null);

  useEffect(() => {
    let dead = false; setError(null);
    libraryAcquisitions(status || undefined).then((r) => { if (!dead) setRows(r.requests ?? []); }).catch((e) => { if (!dead) setError(friendly(e)); });
    return () => { dead = true; };
  }, [status, tick]);

  const decide = async (req: LibraryAcq, decision: 'approve' | 'reject' | 'ordered' | 'added', extra: Record<string, unknown> = {}) => {
    try { await libraryDecideAcq(req.id, decision, extra.note as string | undefined); setTick((t) => t + 1); return true; }
    catch (e) { toast({ title: friendly(e), tone: 'error' }); return false; }
  };

  if (error) return <ErrorState title="Could not load requests" sub={error.replace('Error: ', '')} onRetry={() => setTick((t) => t + 1)} />;

  return (
    <Card headAs="h2" head="Purchase requests" sub="Sorted by demand — approve, order, or add to the catalog"
      actions={<select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Request status" style={{ width: 170 }}>
        {['requested', 'approved', 'ordered', 'added', 'rejected', ''].map((s) => <option key={s || 'all'} value={s}>{s ? statusLabel(s) : 'All'}</option>)}
      </select>}>
      {rows === null ? <Empty title="Loading…" /> : rows.length === 0 ? (
        <Empty title="No requests" sub="Borrower suggestions appear here." />
      ) : (
        <DataTable
          columns={[
            { key: 'title', label: 'Requested', render: (r: LibraryAcq) => <span><b>{r.title}</b>{r.author ? <span className="u-xs u-muted" style={{ display: 'block' }}>{r.author}</span> : null}</span> },
            { key: 'votes', label: 'Votes', render: (r: LibraryAcq) => r.vote_count },
            { key: 'when', label: 'Asked', render: (r: LibraryAcq) => fmtDate(r.created_at) },
            { key: 'vendor', label: 'Vendor', render: (r: LibraryAcq & { vendor?: string; cost_cents?: number }) => r.vendor ? `${r.vendor}${r.cost_cents ? ` · ${inr(r.cost_cents)}` : ''}` : '—' },
            { key: 'status', label: 'Status', render: (r: LibraryAcq) => <Badge tone={r.status === 'added' ? 'success' : r.status === 'rejected' ? 'danger' : 'info'}>{statusLabel(r.status)}</Badge> },
            { key: 'act', label: '', render: (r: LibraryAcq) => (
              <>
                <Button variant="ghost" onClick={async () => { if (await decide(r, 'approve')) toast({ title: 'Approved', tone: 'success' }); }}>Approve</Button>
                <Button variant="ghost" onClick={() => { setOrder({ req: r, decision: 'ordered' }); setForm({ vendor: '', budgetCode: '', cost: '' }); }}>Order</Button>
                <Button variant="ghost" onClick={() => { setOrder({ req: r, decision: 'added' }); setForm({ vendor: '', budgetCode: '', cost: '' }); }}>Added</Button>
                <Button variant="ghost" onClick={() => setReject({ req: r, note: '' })}>Reject</Button>
              </>
            ) },
          ]}
          rows={rows} rowKey={(r: LibraryAcq) => r.id}
        />
      )}

      <Modal open={!!order} onClose={() => setOrder(null)} title={order?.decision === 'ordered' ? 'Mark as ordered' : 'Add to the catalog'}
        sub="Record the vendor, budget line and cost so procurement reconciles."
        footer={<><Button onClick={() => setOrder(null)}>Cancel</Button>
          <Button variant="primary" onClick={async () => {
            if (!order) return;
            try {
              const { apiPost } = await import('../../../services/liveApi');
              await apiPost(`/plugins/library/acquisitions/${order.req.id}/decide`, {
                decision: order.decision,
                vendor: form.vendor || undefined, budgetCode: form.budgetCode || undefined,
                costCents: form.cost ? Math.round(Number(form.cost) * 100) : undefined,
              });
              toast({ title: order.decision === 'ordered' ? 'Marked ordered' : 'Added to the catalog', tone: 'success' });
              setOrder(null); setTick((t) => t + 1);
            } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
          }}>Save</Button></>}>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
          <label style={{ fontSize: 13 }}>Vendor<input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="Oxford Bookstore" aria-label="Vendor" /></label>
          <label style={{ fontSize: 13 }}>Budget code<input value={form.budgetCode} onChange={(e) => setForm({ ...form, budgetCode: e.target.value })} placeholder="LIB-2026" aria-label="Budget code" /></label>
          <label style={{ fontSize: 13 }}>Cost (₹)<input type="number" min={0} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} aria-label="Cost" /></label>
        </div>
      </Modal>

      <Modal open={!!reject} onClose={() => setReject(null)} title="Reject the request" sub="Tell the borrower why — the reason is shown to them."
        footer={<><Button onClick={() => setReject(null)}>Cancel</Button>
          <Button variant="primary" disabled={!reject?.note.trim()} onClick={async () => { if (reject && await decide(reject.req, 'reject', { note: reject.note })) { toast({ title: 'Rejected', tone: 'success' }); setReject(null); } }}>Reject</Button></>}>
        <label style={{ fontSize: 13 }}>Reason
          <textarea value={reject?.note ?? ''} onChange={(e) => setReject(reject ? { ...reject, note: e.target.value } : reject)} rows={3} aria-label="Rejection reason" />
        </label>
      </Modal>
    </Card>
  );
}
