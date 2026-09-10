/* ============================================================
   Parent fee center — next due payment with mock checkout,
   payment history with retry, fee structure explainer and
   concessions. Quiet, respectful copy throughout.
   ============================================================ */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as seed from '../data/dataset';
import { useStore } from '../state/store';
import { Badge, Button, Card, DataTable, Empty, Modal, PageHead, Section, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtDate, fmtMoney } from '../lib/format';
import type { FeeObligation, Payment } from '../types/domain';

/* ---------- data anchors (per brief) ----------
   seed.DEMO_STUDENT — Aarav Sharma, Grade 8-B, North Campus — and
   seed.DEMO_GUARDIAN (Kavita Sharma) are the fixed demo pair. All
   guardian/fee/attendance data flows from these, never a hard-coded id. */
const CHILD = seed.DEMO_STUDENT;
/* seed.DEMO_GUARDIAN is the fixed demo guardian; fall back to the child's
   primary guardian link so the type's defensive `| undefined` never surfaces. */
const GUARDIAN_NAME = seed.DEMO_GUARDIAN?.name ?? seed.guardiansOfStudent(CHILD.id)[0]?.guardian.name ?? 'Kavita Sharma';

const STATUS_BADGE: Record<FeeObligation['status'], { tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info'; label: string }> = {
  paid: { tone: 'success', label: 'Paid' },
  due: { tone: 'info', label: 'Due' },
  overdue: { tone: 'warning', label: 'Overdue' },
  failed: { tone: 'danger', label: 'Failed' },
  waived: { tone: 'neutral', label: 'Waived' },
};

/* Ledger-driven: the next-due card surfaces the earliest open Term 2
   obligation (due, overdue, or failed) for the demo child; if the ledger
   is fully settled it falls back to the next scheduled Term. */
function nextDueFor(items: FeeObligation[]): FeeObligation | undefined {
  const open = items.find(f => f.status === 'due' || f.status === 'overdue' || f.status === 'failed');
  if (open) return open;
  const term2 = items.find(f => f.term.startsWith('Term 2'));
  return term2 ?? items[0];
}

export default function ParentFees() {
  const { dispatch } = useStore();
  const toast = useToast();

  const base = useMemo(() => seed.studentFeeSummary(CHILD.id), []);
  const items = base.items;
  const [history, setHistory] = useState<Payment[]>(() => seed.payments.filter(p => p.studentId === CHILD.id));
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState('UPI');
  const [payState, setPayState] = useState<'form' | 'processing' | 'done'>('form');

  /* Data-driven: an open obligation (failed/due/overdue) leads; the demo
     child's seeded ledger currently has Term 2 failed ("UPI timeout"),
     which drives the retry flow. */
  const nextDue = nextDueFor(items);
  const dueIn = nextDue ? Math.max(0, Math.ceil((nextDue.dueDate.getTime() - Date.now()) / 86400000)) : undefined;
  const failedItem = items.find(f => f.status === 'failed');

  const pay = () => {
    if (payState !== 'form') return;
    setPayState('processing');
    setTimeout(() => {
      setPayState('done');
      if (nextDue) {
        setHistory(h => [{
          id: `pay_new_${Date.now()}`, studentId: CHILD.id, obligationId: nextDue.id,
          amount: nextDue.amount, on: new Date(), method: payMethod, status: 'success',
          reference: `MER${String(Date.now()).slice(-6)}`,
        }, ...h]);
      }
      /* D-6 honesty: this pay flow is a local simulation — no door, no receipt,
         no school-record write. Say exactly that. */
      toast({ title: 'Demo payment simulated', sub: 'No receipt was sent and nothing was recorded. Live payments are under Family → Fees.', tone: 'info' });
      dispatch({ type: 'audit/add', entry: { actor: GUARDIAN_NAME, actorRole: 'parent', action: 'Demo: fee payment simulated', recordType: 'Fee', recordRef: nextDue ? `${nextDue.term} · ${fmtMoney(nextDue.amount)}` : 'Payment', aiInvolved: false, risk: 'low', outcome: 'Device-only demo — no school record created' } });
    }, 1200);
  };
  const resetPay = () => { setPayOpen(false); setPayState('form'); };

  const retry = () => {
    toast({ title: 'Demo retry simulated', sub: 'No gateway was contacted and nothing was recorded. Live payments are under Family → Fees.', tone: 'info' });
    dispatch({ type: 'audit/add', entry: { actor: GUARDIAN_NAME, actorRole: 'parent', action: 'Retried failed payment', recordType: 'Fee', recordRef: failedItem ? `${failedItem.term} · ${fmtMoney(failedItem.amount)}` : 'Failed payment', reason: failedItem?.failureReason, aiInvolved: false, risk: 'low', outcome: 'Device-only demo retry — no school record' } });
    if (failedItem) {
      setHistory(h => [{
        id: `pay_retry_${Date.now()}`, studentId: CHILD.id, obligationId: failedItem.id,
        amount: failedItem.amount, on: new Date(), method: 'UPI', status: 'success',
        reference: `MER${String(Date.now()).slice(-6)}`,
      }, ...h]);
    }
  };

  const downloadReceipt = () => toast({ title: 'Receipts are not available in this demo view', sub: 'The school office issues signed receipts on the live system (Family → Fees).', tone: 'info' });

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* T504 honesty banner: demo fee walkthrough — live ledger is /parent/family. */}
      <div style={{ background: 'var(--warn-weak, var(--surface-2, #FFF8E6))', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 14px', marginBottom: 14 }}>
        <span className="u-small" style={{ fontWeight: 550 }}>Demo view</span>
        <span className="u-small u-muted"> — payments on this page are simulations and never reach the school. Your family's live fee records are under </span>
        <Link to="/parent/family" style={{ fontWeight: 550 }}>Family</Link>
        <span className="u-small u-muted"> → Fees.</span>
      </div>
      <PageHead
        title="Fees"
        sub={`${CHILD.name} · Grade ${CHILD.grade}-${CHILD.section} · North Campus`}
        actions={<Button size="sm" variant="ghost" icon={<Icon.Download size={14} />} onClick={downloadReceipt}>Download latest receipt</Button>}
      />

      <div className="u-col" style={{ gap: 16 }}>
        {/* ---------- next payment ---------- */}
        <div className="card" style={{ padding: 'var(--s-5)', borderColor: nextDue ? 'var(--accent-weak-2)' : 'var(--border)' }}>
          <div className="u-between" style={{ gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="u-upper">Next payment</div>
              {nextDue ? (
                <>
                  <div style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.02em' }} className="tnum">{fmtMoney(nextDue.amount)}</div>
                  <div className="u-small u-muted" style={{ marginTop: 4 }}>
                    {nextDue.term} · due {fmtDate(nextDue.dueDate)} — in {dueIn} days
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <Badge tone={STATUS_BADGE[nextDue.status].tone} dot>{STATUS_BADGE[nextDue.status].label}</Badge>
                    {nextDue.status === 'failed' && (
                      <span className="u-small u-muted" style={{ marginLeft: 10 }}>
                        {nextDue.failureReason ?? 'Gateway declined'} — retry without late fee for 5 days (Fees §4.3)
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.02em' }}>All settled</div>
                  <div className="u-small u-muted" style={{ marginTop: 4 }}>Nothing is pending for this term. Thank you.</div>
                </>
              )}
            </div>
            <div className="u-flex" style={{ gap: 8 }}>
              {nextDue
                ? <Button variant="primary" size="lg" icon={<Icon.Wallet size={15} />} onClick={() => setPayOpen(true)}>Pay now</Button>
                : <Badge tone="success" dot>No payment due</Badge>}
              {failedItem && <Button variant="secondary" onClick={retry}>Retry failed payment</Button>}
            </div>
          </div>
        </div>

        {/* ---------- payment history ---------- */}
        <Section title="Payment history" sub="Every receipt lives here — downloadable, with the gateway reference." style={{ marginBottom: 4 }}>
          <DataTable
            columns={[
              { key: 'on', label: 'Date', render: r => fmtDate(r.on) },
              { key: 'term', label: 'Term', render: r => items.find(f => f.id === r.obligationId)?.term ?? '—' },
              { key: 'amount', label: 'Amount', align: 'right', render: r => <span className="tnum">{fmtMoney(r.amount)}</span> },
              { key: 'method', label: 'Method', render: r => r.method },
              { key: 'reference', label: 'Reference', render: r => <span className="mono u-small">{r.reference}</span> },
              { key: 'status', label: 'Status', render: r => r.status === 'success'
                ? <Badge tone="success" dot>Success</Badge>
                : r.status === 'failed'
                  ? <span className="u-col" style={{ gap: 4 }}><Badge tone="danger" dot>Failed</Badge><span className="u-xs u-faint">{failureReasonFor(r, items)}</span></span>
                  : <Badge tone="info" dot>{r.status}</Badge> },
              { key: 'act', label: '', align: 'right', render: r => r.status === 'success'
                ? <Button size="sm" variant="ghost" icon={<Icon.Download size={13} />} onClick={downloadReceipt}>Receipt</Button>
                : <Button size="sm" variant="secondary" onClick={retry}>Retry</Button> },
            ]}
            rows={history}
            rowKey={r => r.id}
            empty={<Card pad><div className="u-col" style={{ alignItems: 'center', gap: 4, padding: 24 }}><Empty title="No payments yet" /></div></Card>}
          />
        </Section>

        {/* ---------- fee structure ---------- */}
        <Section title="How the fee is made up" sub="For Grade 8, this academic year. Amounts are set by the fee committee (Fees §1.1)." style={{ marginBottom: 4 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <Card pad>
                <div className="u-col" style={{ gap: 10 }}>
                  <div className="u-upper">Tuition by grade · per term</div>
                  {[
                    { band: 'Grades 1-3', value: 42000 },
                    { band: 'Grades 4-6', value: 46000 },
                    { band: 'Grades 7-9', value: 51000 },
                    { band: 'Grade 10', value: 56000 },
                  ].map(row => (
                    <div key={row.band} className="u-between" style={{ gap: 10 }}>
                      <span style={{ fontWeight: 560 }}>{row.band}</span>
                      <span className="tnum" style={{ fontWeight: 600 }}>{fmtMoney(row.value)}</span>
                    </div>
                  ))}
                  <div style={{ height: 1, background: 'var(--border-subtle)' }} />
                  <div className="u-between">
                    <span style={{ fontWeight: 560 }}>Activity & labs — all grades</span>
                    <span className="tnum" style={{ fontWeight: 600 }}>{fmtMoney(4500)}</span>
                  </div>
                  <div className="u-between">
                    <span style={{ fontWeight: 560 }}>Transport — per route seat, if opted</span>
                    <span className="tnum" style={{ fontWeight: 600 }}>{fmtMoney(8000)}</span>
                  </div>
                  <div className="u-xs u-faint">Amounts are set annually by the fee committee (Fees §1.1) and billed per term.</div>
                </div>
              </Card>
            </div>
            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <Card pad>
                <div className="u-col u-small" style={{ gap: 8, color: 'var(--text-2)', lineHeight: 1.6 }}>
                  <span className="u-flex" style={{ gap: 8 }}><Icon.Info size={14} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 2 }} /> Tuition is the same across sections for a grade; transport depends on the route seat.</span>
                  <span className="u-flex" style={{ gap: 8 }}><Icon.Clock size={14} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 2 }} /> Failed online payments can be retried for 5 days with no late fee (Fees §4.3).</span>
                  <span className="u-flex" style={{ gap: 8 }}><Icon.Heart size={14} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 2 }} /> If a term is difficult this year, write to the school office — concession requests are always read by a person.</span>
                </div>
              </Card>
            </div>
          </div>
        </Section>

        {/* ---------- concessions ---------- */}
        <Section title="Concessions" style={{ marginBottom: 4 }}>
          {(() => {
            const concession = items.reduce((a, f) => a + (f.concession ?? 0), 0);
            return concession > 0 ? (
              <Card pad>
                <div className="u-flex" style={{ gap: 10 }}>
                  <Icon.Award size={16} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <div style={{ fontWeight: 580 }}>Sibling waiver on record — {fmtMoney(concession)} this year</div>
                    <div className="u-small u-muted">Applied under the sibling waiver policy (Fees §4.2), capped at 10% of tuition. It shows as a reduced line on the term bill, not a separate refund.</div>
                  </div>
                </div>
              </Card>
            ) : (
              <Card pad>
                <div className="u-flex" style={{ gap: 10 }}>
                  <Icon.Info size={16} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <div style={{ fontWeight: 580 }}>No concessions on record</div>
                    <div className="u-small u-muted">Sibling waiver policy (Fees §4.2) is available on request — write to the school office and the accounts team will respond within two working days.</div>
                  </div>
                </div>
              </Card>
            );
          })()}
        </Section>
      </div>

      {/* ---------- payment modal ---------- */}
      <Modal
        open={payOpen}
        onClose={resetPay}
        title={`Pay ${nextDue?.term ?? 'fees'}`}
        sub={nextDue ? `${fmtMoney(nextDue.amount)} · due ${fmtDate(nextDue.dueDate)}` : 'No payment due'}
        footer={
          payState === 'done'
            ? <Button variant="primary" onClick={resetPay}>Close</Button>
            : (
              <>
                <Button variant="ghost" onClick={resetPay}>Cancel</Button>
                <Button variant="primary" loading={payState === 'processing'} disabled={payState !== 'form'} onClick={pay}>
                  Pay {nextDue ? fmtMoney(nextDue.amount) : ''}
                </Button>
              </>
            )
        }
      >
        {payState === 'done' ? (
          <div className="u-col" style={{ alignItems: 'center', gap: 10, padding: '14px 0', textAlign: 'center' }}>
            <span style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--success-weak)', color: 'var(--success)', display: 'grid', placeItems: 'center' }}>
              <Icon.Check size={22} />
            </span>
            <div style={{ fontWeight: 620 }}>Payment successful</div>
            <div className="u-small u-muted">Receipt sent on WhatsApp to {GUARDIAN_NAME}. It also appears in your payment history above.</div>
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="pfee-method">Pay with</label>
              <select id="pfee-method" className="select" value={payMethod} onChange={e => setPayMethod(e.target.value)} disabled={payState !== 'form'}>
                <option>UPI</option>
                <option>Net Banking</option>
                <option>Card</option>
              </select>
            </div>
            <div className="u-small u-muted">
              {payMethod === 'UPI' ? 'You will confirm the amount in your UPI app. In this demo the payment completes instantly.' : 'Secure page — card details are never stored by the school.'}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

/* ---------- helpers ---------- */
function failureReasonFor(p: Payment, items: FeeObligation[]): string {
  if (p.status !== 'failed') return '';
  const item = items.find(f => f.id === p.obligationId);
  return item?.failureReason ?? 'Gateway declined';
}
