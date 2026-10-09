/* ============================================================
   Parent fee center — the family fee surface (FEE-PRD-1).
   Live: reads the guardian-scoped kernel doors
     GET /fees/obligations   (own children only)
     GET /payments           (own children only)
     GET /fees/receipts      (own children only)
   and starts payment attempts through the real rails
     POST /fees/payments  ·  POST /plugins/payments.upi/links
     POST /plugins/payments.razorpay/orders
   Settlement is a STAFF act (the school confirms on receipt); this
   screen never claims a payment is settled. Every figure is from the
   server; the empty/error states say so plainly.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import {
  PageHead, Card, Section, Stat, Badge, Button, Empty, ErrorState, Skeleton, SkeletonCard,
  DataTable, Modal, useToast, KeyValue,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtMoney, fmtMoneyShort, fmtDate } from '../lib/format';
import { friendly } from '../lib/friendlyErrors';
import { humanize, statusLabel, gradeLabel, classAndSection } from '../lib/labels';
import {
  getMyFees, getMyPayments, getMyReceipts, getMyReceipt, getMyInstallments, downloadReceiptPdf,
  createUpiLink, createRazorpayOrder,
  type ParentFeeObligation, type ParentPayment, type ParentReceipt, type ParentInstallment,
} from '../services/parentApi';

function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((d) => live && setState({ data: d, loading: false, error: null }))
      .catch((e) => live && setState({ data: null, loading: false, error: String(e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick((t) => t + 1) };
}

const statusBadge = (s: ParentFeeObligation['status']) =>
  s === 'paid' ? <Badge tone="success" dot>Paid</Badge>
    : s === 'partial' ? <Badge tone="info" dot>Part paid</Badge>
      : s === 'void' ? <Badge tone="outline">Void</Badge>
        : <Badge tone="warning" dot>Open</Badge>;

const due = (o: ParentFeeObligation) => Math.max(0, (o.net_amount_cents ?? o.amount_cents) - o.paid_cents);

function PaySheet({ obligation, onClose, onDone }: { obligation: ParentFeeObligation; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<{ kind: 'upi' | 'razorpay'; value: string; paymentId: string } | null>(null);
  const amount = due(obligation);

  const payUpi = async () => {
    setBusy('upi');
    try {
      const r = await createUpiLink(obligation.id);
      setLink({ kind: 'upi', value: r.link, paymentId: r.paymentId });
      toast({ title: 'UPI payment started', sub: 'Scan or open the link to pay. The school confirms your payment once it is received.', tone: 'success' });
      onDone();
    } catch (e) {
      toast({ title: 'Could not start the UPI payment', sub: friendly(e), tone: 'error' });
    } finally { setBusy(null); }
  };

  const payRazorpay = async () => {
    setBusy('razorpay');
    try {
      const r = await createRazorpayOrder(obligation.id);
      setLink({ kind: 'razorpay', value: r.orderId, paymentId: r.paymentId });
      toast({ title: 'Gateway order created', sub: 'Complete the payment in the gateway. The school confirms it once received.', tone: 'success' });
      onDone();
    } catch (e) {
      toast({ title: 'Could not start the gateway payment', sub: friendly(e), tone: 'error' });
    } finally { setBusy(null); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Pay this fee"
      sub={`${obligation.term} · ${obligation.label} · outstanding ${fmtMoney(amount)}`}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className="u-col" style={{ gap: 14 }}>
        {link ? (
          <div className="u-col" style={{ gap: 10 }}>
            <p className="u-small u-muted" style={{ margin: 0 }}>
              Your payment attempt is open. Settlement is recorded by the school once the money is received —
              this page will show the receipt after it is confirmed.
            </p>
            <KeyValue items={[
              { k: 'Method', v: link.kind === 'upi' ? 'UPI' : 'Razorpay' },
              { k: link.kind === 'upi' ? 'UPI link' : 'Gateway order', v: <span className="mono u-small" style={{ wordBreak: 'break-all' }}>{link.value}</span> },
              { k: 'Reference', v: <span className="mono u-small">{link.paymentId}</span> },
            ]} />
            {link.kind === 'upi' && (
              <a className="btn btn-primary" href={link.value} style={{ textAlign: 'center' }}>Open UPI app</a>
            )}
          </div>
        ) : (
          <>
            <p className="u-small u-muted" style={{ margin: 0 }}>
              Pay online now, or at the school office. Online payments are confirmed by the school on receipt.
            </p>
            <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button variant="primary" icon={<Icon.CreditCard size={14} />} loading={busy === 'upi'} onClick={payUpi}>Pay by UPI</Button>
              <Button variant="secondary" icon={<Icon.CreditCard size={14} />} loading={busy === 'razorpay'} onClick={payRazorpay}>Pay by card / netbanking</Button>
            </div>
            <p className="u-xs u-faint" style={{ margin: 0 }}>
              Prefer to pay at the school? Visit the office — the fee desk will record the payment and issue your receipt.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

function ReceiptModal({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast();
  const r = useAsync(() => getMyReceipt(id), [id]);
  const [downloading, setDownloading] = useState(false);
  const receipt = r.data?.receipt as (ParentReceipt & Record<string, unknown>) | undefined;
  const download = async () => {
    if (!receipt) return;
    setDownloading(true);
    try {
      await downloadReceiptPdf(receipt.id, `${receipt.receipt_no}.pdf`);
    } catch (e) {
      toast({ title: 'Could not download the receipt', sub: friendly(e), tone: 'error' });
    } finally { setDownloading(false); }
  };
  return (
    <Modal open onClose={onClose} title="Receipt" sub={receipt?.receipt_no}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {receipt?.pdf_file_id && (
            <Button variant="primary" icon={<Icon.Document size={14} />} loading={downloading} onClick={download}>Download PDF</Button>
          )}
        </>
      }>
      {r.loading ? <Skeleton h={80} /> : r.error ? <ErrorState title="Could not load the receipt" sub={friendly(r.error)} onRetry={r.retry} /> : (
        <KeyValue cols={1} items={[
          { k: 'Receipt no', v: <span className="mono">{receipt?.receipt_no}</span> },
          { k: 'Student', v: `${receipt?.student_name ?? ''}${receipt?.admission_no ? ` · ${receipt.admission_no}` : ''}` },
          { k: 'Towards', v: `${receipt?.term ?? ''} ${receipt?.obligation_label ?? ''}` },
          { k: 'Amount', v: <b>{fmtMoney(Number(receipt?.amount_cents ?? 0) / 100)}</b> },
          { k: 'Method', v: humanize(receipt?.method ?? '—') },
          { k: 'Issued', v: fmtDate(String(receipt?.issued_at ?? '')) },
          { k: 'PDF', v: receipt?.pdf_file_id ? 'Available to download' : 'Not available' },
          ...(receipt?.voided_at ? [{ k: 'Status', v: <Badge tone="danger" dot>Voided (refunded)</Badge> }] : []),
        ]} />
      )}
    </Modal>
  );
}

export default function ParentFees() {
  const [payFor, setPayFor] = useState<ParentFeeObligation | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  const fees = useAsync(() => getMyFees(), []);
  const payments = useAsync(() => getMyPayments(), []);
  const receipts = useAsync(() => getMyReceipts(), []);
  const installments = useAsync(() => getMyInstallments(), []);

  const refresh = () => { fees.retry(); payments.retry(); receipts.retry(); installments.retry(); };

  const rows = fees.data?.obligations ?? [];
  const outstanding = rows.filter((o) => o.status !== 'paid' && o.status !== 'void').reduce((a, o) => a + due(o), 0);
  const paidTotal = rows.reduce((a, o) => a + o.paid_cents, 0);

  const byChild = useMemo(() => {
    const m = new Map<string, { name: string; grade: string; items: ParentFeeObligation[] }>();
    for (const o of rows) {
      const k = o.student_id;
      const cur = m.get(k) ?? { name: o.student_name ?? 'Student', grade: o.grade ? gradeLabel(classAndSection(o.grade, o.section)) : '', items: [] };
      cur.items.push(o);
      m.set(k, cur);
    }
    return [...m.entries()];
  }, [rows]);

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      <PageHead
        title="Fees"
        sub="Your family's live fee records — dues, payments and receipts."
        actions={<Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={refresh}>Refresh</Button>}
      />

      {fees.loading ? (
        <div className="grid grid-3" style={{ marginBottom: 20 }}><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : fees.error ? (
        <Card pad><ErrorState title="Could not load your fees" sub={friendly(fees.error)} onRetry={fees.retry} /></Card>
      ) : rows.length === 0 ? (
        <Card pad>
          <Empty
            icon={<Icon.Wallet size={24} />}
            title="No fee records yet"
            sub="When the school raises a fee for your child it will appear here, with the option to pay online or at the office."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-3" style={{ marginBottom: 20 }}>
            <Stat label="Outstanding" value={fmtMoneyShort(outstanding)} sub="Across your children" />
            <Stat label="Paid to date" value={fmtMoneyShort(paidTotal)} sub="All settled amounts" />
            <Stat label="Receipts" value={receipts.data?.receipts?.length ?? 0} sub="Available to view" />
          </div>

          {byChild.map(([childId, child]) => (
            <Section key={childId} title={child.name} sub={child.grade || undefined} style={{ marginBottom: 20 }}>
              <div className="u-col" style={{ gap: 10 }}>
                {child.items.map((o) => (
                  <Card key={o.id} pad>
                    <div className="u-between" style={{ gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontWeight: 580 }}>{o.term} · {o.label}</div>
                        <div className="u-small u-muted" style={{ marginTop: 2 }}>
                          {o.due_on ? `Due ${fmtDate(o.due_on)}` : 'No due date on record'}
                          {o.concession_cents ? ' · discount or waiver applied' : ''}
                        </div>
                      </div>
                      <div className="u-flex" style={{ gap: 12, alignItems: 'center' }}>
                        <div className="u-col" style={{ alignItems: 'flex-end' }}>
                          <span className="tnum">{fmtMoney(o.net_amount_cents ?? o.amount_cents)}</span>
                          {o.paid_cents > 0 && o.status !== 'paid' && <span className="u-xs u-faint">Paid {fmtMoney(o.paid_cents)}</span>}
                        </div>
                        {statusBadge(o.status)}
                        {o.status !== 'paid' && o.status !== 'void' && (
                          <Button size="sm" variant="primary" icon={<Icon.Money size={12} />} onClick={() => setPayFor(o)}>Pay {fmtMoneyShort(due(o))}</Button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </Section>
          ))}
        </>
      )}

      {(installments.data?.installments?.length ?? 0) > 0 && (
        <Section title="Installment schedule" sub="Fees split into parts — each part is settled as it is paid." style={{ marginBottom: 20 }}>
          <Card>
            <DataTable
              rows={installments.data?.installments ?? []}
              rowKey={(i: ParentInstallment) => i.id}
              empty={<Empty title="No installment schedules" />}
              columns={[
                { key: 'child', label: 'Student', render: (i: ParentInstallment) => i.student_name ?? '—' },
                { key: 'towards', label: 'Towards', render: (i: ParentInstallment) => <span className="u-small u-muted">{i.term} {i.obligation_label}</span> },
                { key: 'seq', label: '#', align: 'right', render: (i: ParentInstallment) => <span className="tnum">{i.seq}</span> },
                { key: 'due', label: 'Due', render: (i: ParentInstallment) => <span className="u-small">{i.due_on ? fmtDate(i.due_on) : '—'}</span> },
                { key: 'amount', label: 'Amount', align: 'right', render: (i: ParentInstallment) => <span className="tnum">{fmtMoney(i.amount_cents / 100)}</span> },
                { key: 'status', label: 'Status', align: 'right', render: (i: ParentInstallment) => i.status === 'paid' ? <Badge tone="success" dot>Paid</Badge> : i.status === 'overdue' ? <Badge tone="warning" dot>Overdue</Badge> : <Badge tone="info" dot>Pending</Badge> },
              ]}
            />
          </Card>
        </Section>
      )}

      <Section title="Receipts" sub="Every confirmed payment issues a receipt you can open here." style={{ marginBottom: 20 }}>
        <Card>
          {receipts.loading ? <div style={{ padding: 'var(--s-5)' }}><Skeleton h={12} /></div>
            : receipts.error ? <div className="card-body"><ErrorState title="Could not load receipts" sub={friendly(receipts.error)} onRetry={receipts.retry} /></div>
              : (
                <DataTable
                  rows={receipts.data?.receipts ?? []}
                  rowKey={(r: ParentReceipt) => r.id}
                  empty={<Empty icon={<Icon.Document size={22} />} title="No receipts yet" sub="A receipt appears here after the school confirms a payment." />}
                  columns={[
                    { key: 'no', label: 'Receipt', render: (r: ParentReceipt) => <span className="mono u-small">{r.receipt_no}</span> },
                    { key: 'student', label: 'Student', render: (r: ParentReceipt) => r.student_name ?? '—' },
                    { key: 'towards', label: 'Towards', render: (r: ParentReceipt) => <span className="u-small u-muted">{r.term} {r.obligation_label}</span> },
                    { key: 'amount', label: 'Amount', align: 'right', render: (r: ParentReceipt) => <span className="tnum">{fmtMoney(r.amount_cents / 100)}</span> },
                    { key: 'date', label: 'Issued', render: (r: ParentReceipt) => <span className="u-small">{fmtDate(r.issued_at)}</span> },
                    { key: 'status', label: 'Status', align: 'right', render: (r: ParentReceipt) => r.voided_at ? <Badge tone="danger" dot>Voided</Badge> : <Badge tone="success" dot>Valid</Badge> },
                    { key: 'open', label: '', align: 'right', render: (r: ParentReceipt) => <Button size="sm" variant="ghost" onClick={() => setReceiptId(r.id)}>View</Button> },
                  ]}
                />
              )}
        </Card>
      </Section>

      <Section title="Payment history" sub="Your attempts and their current status.">
        <Card>
          {payments.loading ? <div style={{ padding: 'var(--s-5)' }}><Skeleton h={12} /></div>
            : payments.error ? <div className="card-body"><ErrorState title="Could not load payments" sub={friendly(payments.error)} onRetry={payments.retry} /></div>
              : (
                <DataTable
                  rows={payments.data?.payments ?? []}
                  rowKey={(p: ParentPayment) => p.id}
                  empty={<Empty icon={<Icon.CreditCard size={22} />} title="No payments yet" />}
                  columns={[
                    { key: 'date', label: 'Date', render: (p: ParentPayment) => <span className="u-small">{fmtDate(p.created_at)}</span> },
                    { key: 'student', label: 'Student', render: (p: ParentPayment) => p.student_name ?? '—' },
                    { key: 'amount', label: 'Amount', align: 'right', render: (p: ParentPayment) => <span className="tnum">{fmtMoney(p.amount_cents / 100)}</span> },
                    { key: 'method', label: 'Method', render: (p: ParentPayment) => <Badge tone="outline">{humanize(p.method)}</Badge> },
                    { key: 'status', label: 'Status', align: 'right', render: (p: ParentPayment) => p.status === 'confirmed' ? <Badge tone="success" dot>Confirmed</Badge> : p.status === 'initiated' ? <Badge tone="warning" dot>Awaiting school</Badge> : p.status === 'refunded' ? <Badge tone="danger" dot>Refunded</Badge> : <Badge tone="outline">{statusLabel(p.status)}</Badge> },
                  ]}
                />
              )}
        </Card>
      </Section>

      {payFor && <PaySheet obligation={payFor} onClose={() => setPayFor(null)} onDone={refresh} />}
      {receiptId && <ReceiptModal id={receiptId} onClose={() => setReceiptId(null)} />}
    </div>
  );
}
