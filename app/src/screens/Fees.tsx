/* ============================================================
   Fees — the school's money desk.
   T402: the ledger reads the real door (GET /fees/obligations) and
   payment actions run the real rails — POST /fees/payments
   (initiate) plus POST /fees/payments/:id/confirm (manual
   settlement, finance/owner only). Nothing flips state in RAM; a
   success toast only appears after 2xx from the server, and it
   quotes the receipt the server issued. Roles without payment
   authority see the ledger read-only with a plain-language reason.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FeePlans from './finance/FeePlans';
import {
  apiFeeObligations, apiGet, apiVoidObligation,
  apiPayments, apiRefundPayment, apiMarkMatched, apiReconcile, apiRunDunning, type LivePayment,
  apiConcessions, apiCreateConcession, apiDecideConcession, type LiveConcession,
  apiInstallments, type LiveInstallment, apiFeeDelivery, type LiveFeeMessage,
  apiFeeSettings, apiSaveFeeSettings, apiRunLateFees, apiObligationInvoice,
} from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { useLightRole, useRoleOrGrant } from '../lib/access';
import { RecordPaymentModal } from '../components/RecordPaymentModal';
import {
  PageHead, Section, Card, Stat, Badge, DataTable, Tabs, Button, useToast,
  Drawer, Empty, ErrorState, Skeleton, SkeletonCard, KeyValue, Progress, Modal} from '../components/ui';
import { BarChart, Donut } from '../components/Chart';
import { Icon } from '../components/Icon';
import { fmtMoney, fmtMoneyShort, fmtPct, fmtDate, fmtDateShort } from '../lib/format';
import type { FeeStatus } from '../types/domain';

/* ---------- standard async hook (APP-SPEC pattern, local copy) ---------- */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => live && setState({ data: d, loading: false, error: null }))
      .catch(e => live && setState({ data: null, loading: false, error: String(e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

/* Real server statuses are open | partial | paid | void (001_init). */
type RowStatus = FeeStatus | 'open' | 'partial' | 'void';

function statusBadge(s: RowStatus) {
  switch (s) {
    case 'paid': return <Badge tone="success" dot>Paid</Badge>;
    case 'partial': return <Badge tone="info" dot>Part paid</Badge>;
    case 'open': return <Badge tone="warning" dot>Open</Badge>;
    case 'void': return <Badge tone="outline">Void</Badge>;
    case 'due': return <Badge tone="info" dot>Due</Badge>;
    case 'overdue': return <Badge tone="warning" dot>Overdue</Badge>;
    case 'failed': return <Badge tone="danger" dot>Failed</Badge>;
    case 'waived': return <Badge tone="outline">Waived</Badge>;
  }
}

/* Unified row shape across the live data plane */
interface FeeRow {
  id: string;
  studentId: string;
  studentName: string;
  gradeSection: string;
  term: string;
  category: string;
  amount: number;      /* rupees */
  paidAmount: number;  /* rupees */
  dueDate: Date | null;
  status: RowStatus;
  failureReason?: string;
  method?: string;
}

/* ---------- student drawer (live: real per-student obligations) ---------- */
function StudentFeeDrawerLive({ studentId, onClose, canPay, onRecord }: {
  studentId: string | null; onClose: () => void; canPay: boolean; onRecord: (row: FeeRow) => void;
}) {
  const list = useAsync(async (): Promise<FeeRow[]> => {
    if (!studentId) return [];
    const res = await apiGet<{ obligations: Record<string, unknown>[] }>(`/fees/obligations?studentId=${studentId}`);
    return (res.obligations ?? []).map(mapRealObligation);
  }, [studentId]);
  if (!studentId) return null;
  const rows = list.data ?? [];
  const outstanding = rows.filter(r => r.status !== 'paid' && r.status !== 'void').reduce((a, r) => a + (r.amount - r.paidAmount), 0);
  const paidTotal = rows.reduce((a, r) => a + r.paidAmount, 0);
  return (
    <Drawer open onClose={onClose} title={rows[0]?.studentName ?? 'Student'} sub={rows[0]?.gradeSection}>
      {list.loading ? (
        <div className="u-col" style={{ gap: 10 }}><Skeleton h={12} /><Skeleton h={12} /><Skeleton h={12} /></div>
      ) : list.error ? (
        <ErrorState title="Could not load this student's fees" sub={friendly(list.error)} onRetry={list.retry} />
      ) : rows.length === 0 ? (
        <Empty title="No fee records for this student" sub="Obligations appear here once the school creates them." />
      ) : (
        <div className="u-col" style={{ gap: 18 }}>
          <div className="grid grid-3">
            <Stat label="Outstanding" value={fmtMoneyShort(outstanding)} sub="Open + part-paid" />
            <Stat label="Paid to date" value={fmtMoneyShort(paidTotal)} sub="All settled amounts" />
            <Stat label="Line items" value={rows.length} sub="This student's ledger" />
          </div>
          <div className="u-col" style={{ gap: 8 }}>
            {rows.map(it => (
              <div key={it.id} className="u-between" style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
                <div>
                  <div style={{ fontWeight: 580 }}>{it.term} · {it.category}</div>
                  <div className="u-small u-muted" style={{ marginTop: 2 }}>
                    {it.dueDate ? `Due ${fmtDate(it.dueDate)}` : 'No due date on record'}
                  </div>
                </div>
                <div className="u-col" style={{ alignItems: 'flex-end', gap: 6 }}>
                  <span className="tnum">{fmtMoney(it.amount)}</span>
                  {statusBadge(it.status)}
                  {canPay && it.status !== 'paid' && it.status !== 'void' && (
                    <Button size="sm" variant="secondary" onClick={() => onRecord(it)}>Record payment</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <KeyValue items={[{ k: 'Data source', v: 'School ledger (live)' }]} />
        </div>
      )}
    </Drawer>
  );
}

/* ---------- live row mapper ---------- */
const mapRealObligation = (o: Record<string, unknown>): FeeRow => ({
  id: String(o.id),
  studentId: String(o.student_id),
  studentName: String(o.student_name ?? 'Student'),
  gradeSection: o.grade != null ? `Grade ${o.grade}-${o.section ?? '—'}` : '',
  term: String(o.term ?? ''),
  category: String(o.label ?? ''),
  amount: Number(o.amount_cents ?? 0) / 100,
  paidAmount: Number(o.paid_cents ?? 0) / 100,
  dueDate: o.due_on ? new Date(String(o.due_on)) : null,
  status: (o.status ?? 'open') as RowStatus});

/* ============================================================ */

type TabId = 'ledger' | 'payments' | 'installments' | 'delivery' | 'concessions' | 'byclass' | 'plans';

export default function Fees() {
  const navigate = useNavigate();
  const toast = useToast();
  const lightRole = useLightRole();
  /* FEE-RBAC-4: a parent/student deep-linking /fees must not land on the staff desk. The surface maps to a
     parent-allowed door, so the server Guard admits it; this screen redirects the light role to its own view. */
  useEffect(() => { if (lightRole) navigate('/parent/fees', { replace: true }); }, [lightRole, navigate]);

  const [tab, setTab] = useState<TabId>('ledger');
  const [statusFilter, setStatusFilter] = useState<'all' | RowStatus>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);      /* live drawer */
  const [payRow, setPayRow] = useState<FeeRow | null>(null);              /* record-payment modal */
  const [voidRow, setVoidRow] = useState<FeeRow | null>(null);            /* void confirm (owner) */
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [refundRow, setRefundRow] = useState<LivePayment | null>(null);   /* refund (maker-checker) */
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [opsBusy, setOpsBusy] = useState<string | null>(null);
  const [opsNote, setOpsNote] = useState<string | null>(null);
  const [conOpen, setConOpen] = useState(false);
  const [conForm, setConForm] = useState({ studentId: '', kind: 'concession', amountRupees: '', reason: '' });
  const [conBusy, setConBusy] = useState<string | null>(null);

  /* FEE-RBAC-2: payment authority mirrors the DOORS — a built-in role in the door's set, OR the caller's
     own custom-role mask explicitly ALLOWing that door. A teacher-based fee role now operates the desk
     instead of seeing titles with disabled controls. */
  const canInitiate = useRoleOrGrant(['finance', 'finance_head', 'finance_clerk', 'owner', 'principal'], ['POST /fees/payments']);
  const canConfirm = useRoleOrGrant(['finance', 'finance_head', 'finance_clerk', 'owner'], ['POST /fees/payments/:id/confirm']);
  const canRefund = useRoleOrGrant(['finance', 'finance_head', 'finance_clerk', 'owner'], ['POST /payments/:id/refund']);
  const canOperate = useRoleOrGrant(['finance', 'finance_head', 'finance_clerk', 'owner'], ['POST /payments/reconcile', 'POST /fees/dunning/run']);
  /* OPP-PRD-4/PRD-18: the principal owns fee-health and the dunning ladder; reconciliation stays finance. */
  const canReconcile = useRoleOrGrant(['finance', 'finance_head', 'finance_clerk', 'owner'], ['POST /payments/reconcile']);
  const canDun = useRoleOrGrant(['finance', 'finance_head', 'finance_clerk', 'owner', 'principal'], ['POST /fees/dunning/run']);
  const canVoid = useRoleOrGrant(['owner'], ['POST /fees/obligations/:id/void']);
  /* A6/D12: per-tenant fee policy is now writable (GET/PUT /fees/settings) — owner / finance head. */
  const canManagePolicy = useRoleOrGrant(['owner', 'finance_head'], ['PUT /fees/settings']);
  const [policy, setPolicy] = useState<{ refund: string; prefix: string } | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  useEffect(() => {
    if (!canManagePolicy) return;
    apiFeeSettings().then(r => setPolicy({
      refund: String(Math.round(Number(r.settings.refund_approval_threshold_cents ?? 500000) / 100)),
      prefix: String(r.settings.receipt_prefix ?? 'RCP'),
    })).catch(() => setPolicy(null));
  }, [canManagePolicy]);
  const savePolicy = () => {
    if (!policy) return;
    setPolicyBusy(true);
    apiSaveFeeSettings({ refund_approval_threshold_cents: Math.round(Number(policy.refund) * 100), receipt_prefix: policy.prefix })
      .then(() => toast({ title: 'Fee policy saved', tone: 'success' }))
      .catch(e => toast({ title: 'Could not save fee policy', sub: friendly(e), tone: 'error' }))
      .finally(() => setPolicyBusy(false));
  };
  const runLateFees = () => {
    setPolicyBusy(true);
    apiRunLateFees()
      .then(r => toast({ title: 'Late fees applied', sub: `${r.updated} obligation(s) updated`, tone: 'success' }))
      .catch(e => toast({ title: 'Could not run late fees', sub: friendly(e), tone: 'error' }))
      .finally(() => setPolicyBusy(false));
  };
  const openInvoice = (id: string) => {
    apiObligationInvoice(id)
      .then(r => toast({ title: 'Invoice generated', sub: `${r.invoice.filename} · sha256 ${r.invoice.sha256.slice(0, 12)}…`, tone: 'success' }))
      .catch(e => toast({ title: 'Could not generate the invoice', sub: friendly(e), tone: 'error' }));
  };

  const obligations = useAsync<FeeRow[]>(async () => {
    const res = await apiFeeObligations();
    return (res.obligations ?? []).map(mapRealObligation);
  }, []);

  const payments = useAsync<LivePayment[]>(async () => {
    const res = await apiPayments();
    return res.payments ?? [];
  }, []);

  const concessions = useAsync<LiveConcession[]>(async () => {
    const res = await apiConcessions();
    return res.concessions ?? [];
  }, []);

  const installments = useAsync<LiveInstallment[]>(async () => {
    const res = await apiInstallments();
    return res.installments ?? [];
  }, []);

  const delivery = useAsync<LiveFeeMessage[]>(async () => {
    const res = await apiFeeDelivery();
    return res.messages ?? [];
  }, []);

  const refreshAll = () => { obligations.retry(); payments.retry(); concessions.retry(); installments.retry(); delivery.retry(); };

  const createConcession = async () => {
    const cents = Math.round(Number(conForm.amountRupees.replace(/,/g, '')) * 100);
    if (!/^[0-9a-f-]{36}$/i.test(conForm.studentId.trim()) || !Number.isFinite(cents) || cents <= 0) {
      toast({ title: 'Check the form', sub: 'A student id (uuid) and a positive amount are required.', tone: 'error' });
      return;
    }
    setConBusy('create');
    try {
      await apiCreateConcession({ studentId: conForm.studentId.trim(), kind: conForm.kind, amountCents: cents, reason: conForm.reason.trim() || undefined });
      toast({ title: 'Concession requested', sub: 'A second authorized person must approve it before it applies.', tone: 'success' });
      setConOpen(false);
      setConForm({ studentId: '', kind: 'concession', amountRupees: '', reason: '' });
      concessions.retry();
    } catch (e) { toast({ title: 'Could not request the concession', sub: friendly(e), tone: 'error' }); }
    finally { setConBusy(null); }
  };

  const decideConcession = async (c: LiveConcession, decision: 'approve' | 'reject') => {
    setConBusy(c.id);
    try {
      await apiDecideConcession(c.id, decision);
      toast({ title: decision === 'approve' ? 'Concession approved' : 'Concession rejected', sub: `${c.student_name ?? ''} · ${c.kind}`, tone: 'success' });
      refreshAll();
    } catch (e) { toast({ title: 'Could not record the decision', sub: friendly(e), tone: 'error' }); }
    finally { setConBusy(null); }
  };

  /* Void an obligation — owner authority, server-audited (L1-2.2 door). */
  const voidObligation = async () => {
    if (!voidRow) return;
    setVoiding(true);
    try {
      await apiVoidObligation(voidRow.id, voidReason.trim() || 'Voided from the Fees ledger by the owner');
      toast({ title: 'Obligation voided', sub: `${voidRow.studentName} · ${voidRow.term} ${voidRow.category} — the ledger row is marked void and stays visible for audit.`, tone: 'success' });
      setVoidRow(null);
      setVoidReason('');
      refreshAll();
    } catch (e) {
      toast({ title: 'Could not void the obligation', sub: friendly(e), tone: 'error' });
    } finally {
      setVoiding(false);
    }
  };

  /* Refund a confirmed payment — server enforces maker-checker above the threshold. */
  const refundPayment = async () => {
    if (!refundRow) return;
    setRefunding(true);
    try {
      const r = await apiRefundPayment(refundRow.id, { reason: refundReason.trim() || undefined });
      toast({ title: `Refunded ${fmtMoney(r.refundedCents / 100)}`, sub: `Payment is now ${r.payment.status}. The obligation and receipt were updated.`, tone: 'success' });
      setRefundRow(null);
      setRefundReason('');
      refreshAll();
    } catch (e) {
      toast({ title: 'Could not refund the payment', sub: friendly(e), tone: 'error' });
    } finally { setRefunding(false); }
  };

  /* FEE-SEC-5: clear a disputed reconciliation flag after a human review. Resolves the owned Action card. */
  const markMatched = async (p: LivePayment) => {
    setOpsBusy(`match:${p.id}`);
    try {
      await apiMarkMatched(p.id, 'reviewed at the desk — marked matched');
      toast({ title: 'Payment marked matched', sub: 'The reconciliation discrepancy and its action card are cleared.', tone: 'success' });
      refreshAll();
    } catch (e) { toast({ title: 'Could not clear the discrepancy', sub: friendly(e), tone: 'error' }); }
    finally { setOpsBusy(null); }
  };

  const runReconcile = async () => {
    setOpsBusy('reconcile'); setOpsNote(null);
    try {
      const r = await apiReconcile();
      setOpsNote(`Reconciliation: ${r.total} discrepancy(ies) — ghost ${r.discrepancies.ghostLocalConfirmed.length}, missing ${r.discrepancies.missingLocalConfirmation.length}, orphan ${r.discrepancies.orphanNoRailLog.length}, amount-mismatch ${r.discrepancies.amountMismatch.length}.`);
      toast({ title: r.total === 0 ? 'Reconciliation clean' : `${r.total} discrepancy(ies) found`, sub: 'Findings are on the ledger and raise events for follow-up.', tone: r.total === 0 ? 'success' : 'info' });
      refreshAll();
    } catch (e) { toast({ title: 'Reconciliation failed', sub: friendly(e), tone: 'error' }); }
    finally { setOpsBusy(null); }
  };

  const runDunning = async () => {
    setOpsBusy('dunning'); setOpsNote(null);
    try {
      const r = await apiRunDunning();
      setOpsNote(r.note ?? `Dunning: ${r.queued} queued (overdue ${r.overdueQueued}, before-due ${r.beforeDueQueued}), ${r.escalated} escalated, ${r.skippedNoContact} skipped without contact.`);
      toast({ title: r.queued || r.escalated ? `Dunning: ${r.queued} queued` : 'Dunning: nothing to send', sub: r.note ?? `${r.escalated} escalation(s) raised.`, tone: 'success' });
    } catch (e) { toast({ title: 'Dunning run failed', sub: friendly(e), tone: 'error' }); }
    finally { setOpsBusy(null); }
  };

  const stats = useMemo(() => {
    const items = obligations.data ?? [];
    const billed = items.reduce((a, f) => a + f.amount, 0);
    const paid = items.reduce((a, f) => a + f.paidAmount, 0);
    const collectedPct = billed ? Math.round((paid / billed) * 1000) / 10 : 0;
    const outstanding = items.filter(f => f.status !== 'paid' && f.status !== 'void').reduce((a, f) => a + (f.amount - f.paidAmount), 0);
    const now = Date.now();
    const overdueAmt = items.filter(f => f.dueDate && f.dueDate.getTime() < now && f.status !== 'paid' && f.status !== 'void').reduce((a, f) => a + (f.amount - f.paidAmount), 0);
    const openCount = items.filter(f => f.status === 'open' || f.status === 'partial').length;
    const failedCount = items.filter(f => f.status === 'failed').length;
    const term2Due = items.filter(f => f.term.startsWith('Term 2') && (f.status === 'due' || f.status === 'overdue')).reduce((a, f) => a + (f.amount - f.paidAmount), 0);
    return { billed, collectedPct, outstanding, overdueAmt, openCount, failedCount, term2Due };
  }, [obligations.data]);

  const filtered = useMemo(() => {
    const items = obligations.data ?? [];
    return statusFilter === 'all' ? items : items.filter(f => f.status === statusFilter);
  }, [obligations.data, statusFilter]);

  const lastPayments = useMemo(
    () => (payments.data ?? []).slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 100),
    [payments.data]);

  /* ---- by-class collection % — computed from the rows actually displayed ---- */
  const byClass = useMemo(() => {
    const billed = new Map<number, number>();
    const paid = new Map<number, number>();
    (obligations.data ?? []).forEach(f => {
      const m = /Grade (\d+)/.exec(f.gradeSection);
      const g = m ? Number(m[1]) : 0;
      billed.set(g, (billed.get(g) ?? 0) + f.amount);
      paid.set(g, (paid.get(g) ?? 0) + f.paidAmount);
    });
    return [...billed.keys()].sort((a, b) => a - b)
      .map(g => ({ grade: g, pct: billed.get(g) ? Math.round(((paid.get(g) ?? 0) / (billed.get(g) ?? 1)) * 1000) / 10 : 0 }))
      .map(({ grade, pct }) => ({ label: grade ? `Grade ${grade}` : 'Ungraded', value: pct, color: pct < 80 ? 'var(--warning)' : 'var(--accent)' }));
  }, [obligations.data]);

  const belowAvgClasses = byClass.filter(c => c.value < 80);

  const payDisabledReason = canConfirm ? undefined
    : canInitiate ? 'Payments are recorded by finance or the owner — you can initiate, but settlement confirmation needs finance.'
      : 'Your role can view the ledger; recording payments is done by finance or the owner.';

  return (
    <div>
      <PageHead
        title="Fee Intelligence"
        sub="Money received and outstanding — computed from the school's own ledger."
        actions={
          <>
            <Badge tone="outline">Live ledger</Badge>
            <Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={refreshAll}>Refresh</Button>
          </>
        }
      />

      {/* ---- Stats ---- */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <Stat label="Outstanding" value={fmtMoneyShort(stats.outstanding)} sub={`${stats.openCount} open obligations`} />
        <Stat label="Collected" value={fmtPct(stats.collectedPct, 1)} sub="Share of billed amount collected" />
        <Stat label="Past due date" value={fmtMoneyShort(stats.overdueAmt)} sub="Unpaid and past the due date" />
        <Stat label="Ledger rows" value={(obligations.data ?? []).length} sub="Fee obligations on record" />
      </div>

      {/* ---- Tabs ---- */}
      <Tabs
        tabs={[
          { id: 'ledger', label: 'Obligations ledger' },
          { id: 'payments', label: 'Payments', count: lastPayments.length },
          { id: 'installments', label: 'Installments', count: (installments.data ?? []).length },
          { id: 'delivery', label: 'Delivery', count: (delivery.data ?? []).length },
          { id: 'concessions', label: 'Concessions', count: (concessions.data ?? []).filter(c => c.status === 'requested').length },
          { id: 'byclass', label: 'By class' },
          { id: 'plans', label: 'Fee plans' }]}
        active={tab}
        onChange={t => setTab(t as TabId)}
        panelId="fees-tab"
      />

      {/* ---- Ledger ---- */}
      {tab === 'ledger' && (
        <Section role="tabpanel" id="fees-tab-panel-ledger" aria-labelledby="fees-tab-tab-ledger"
          title="Obligations ledger"
          sub={`${filtered.length} obligations from the school ledger. Row click opens the student's fee summary.`}
          actions={
            <div className="u-flex" style={{ gap: 8 }}>
              <label className="u-small u-muted" htmlFor="fee-status-filter">Status</label>
              <select
                id="fee-status-filter"
                className="input"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as 'all' | RowStatus)}
                style={{ maxWidth: 160 }}
              >
                <option value="all">All statuses</option>
                <option value="open">Open</option>
                <option value="partial">Part paid</option>
                <option value="paid">Paid</option>
                <option value="void">Void</option>
              </select>
            </div>
          }
        >
          <Card>
            {obligations.loading ? (
              <div className="u-col" style={{ gap: 10, padding: 'var(--s-5)' }}><Skeleton h={12} /><Skeleton h={12} /><Skeleton h={12} /><Skeleton h={12} /></div>
            ) : obligations.error ? (
              <div className="card-body"><ErrorState title="Could not load the ledger" sub={friendly(obligations.error)} onRetry={obligations.retry} /></div>
            ) : (
              <DataTable
                caption="Fee obligations ledger — amount, status and action per student"
                rows={filtered.slice(0, 60)}
                rowKey={f => f.id}
                onRowClick={f => setSelectedId(f.id)}
                empty={<Empty icon={<Icon.Money size={22} />} title="No fee records yet" sub="Obligations appear here once the school records them. Fee plans are created during setup."
                    action={canOperate
                      ? <Button variant="secondary" onClick={() => navigate('/rails')}>Open the Rails console</Button>
                      : undefined} />}
                columns={[
                  {
                    key: 'student', label: 'Student', sortable: true, sortValue: f => (f as FeeRow).studentName, render: f => {
                      const r = f as FeeRow;
                      return (
                        <div>
                          <div style={{ fontWeight: 570 }}>{r.studentName}</div>
                          <div className="u-xs u-faint">{r.gradeSection}</div>
                        </div>
                      );
                    }},
                  { key: 'term', label: 'Term', render: f => <span className="u-small">{(f as FeeRow).term.replace(' 2026-27', '')}</span> },
                  { key: 'category', label: 'Category', render: f => <span className="u-small u-muted">{(f as FeeRow).category}</span> },
                  { key: 'amount', label: 'Amount', align: 'right', sortable: true, sortValue: f => (f as FeeRow).amount, render: f => <span className="tnum">{fmtMoney((f as FeeRow).amount)}</span> },
                  { key: 'paid', label: 'Paid', align: 'right', render: f => <span className="tnum u-muted">{(f as FeeRow).paidAmount ? fmtMoney((f as FeeRow).paidAmount) : '—'}</span> },
                  { key: 'dueDate', label: 'Due date', sortable: true, sortValue: f => (f as FeeRow).dueDate?.getTime() ?? 0, render: f => <span className="u-small">{(f as FeeRow).dueDate ? fmtDateShort((f as FeeRow).dueDate as Date) : '—'}</span> },
                  { key: 'status', label: 'Status', align: 'right', render: f => statusBadge((f as FeeRow).status) },
                  {
                    key: 'action', label: '', align: 'right' as const, render: (f: FeeRow) => {
                      const payable = f.status !== 'paid' && f.status !== 'void';
                      if (!payable) return null;
                      return (
                        <span className="u-flex" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          {canConfirm
                            ? <Button size="sm" variant="secondary" icon={<Icon.Money size={12} />} onClick={e => { e.stopPropagation(); setPayRow(f); }}>Record payment</Button>
                            : <Button size="sm" variant="secondary" disabled title={payDisabledReason} icon={<Icon.Money size={12} />} onClick={e => e.stopPropagation()}>Record payment</Button>}
                          {canVoid && (
                            <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setVoidRow(f); setVoidReason(''); }} title="Void this obligation (owner, audited)">Void</Button>
                          )}
                          {canConfirm && (
                            <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); openInvoice(f.id); }} title="Generate / open the invoice document">Invoice</Button>
                          )}
                        </span>
                      );
                    }},
                ]}
              />
            )}
          </Card>
        </Section>
      )}

      {/* ---- Payments ---- */}
      {tab === 'payments' && (
        <Section role="tabpanel" id="fees-tab-panel-payments" aria-labelledby="fees-tab-tab-payments" title="Payments" sub="Every payment attempt, newest first — with its settlement provenance and refund action.">
          <Card>
            {payments.loading ? (
              <div className="grid grid-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
            ) : payments.error ? (
              <div className="card-body"><ErrorState title="Could not load payments" sub={friendly(payments.error)} onRetry={payments.retry} /></div>
            ) : (
              <DataTable
                rows={lastPayments}
                rowKey={(p: LivePayment) => p.id}
                empty={<Empty icon={<Icon.CreditCard size={22} />} title="No payments recorded" sub="Payments appear here as soon as a parent or the desk starts one." />}
                columns={[
                  { key: 'date', label: 'Date', render: (p: LivePayment) => <span className="u-small">{fmtDate(p.created_at)}</span> },
                  { key: 'student', label: 'Student', render: (p: LivePayment) => <div><div>{p.student_name ?? '—'}</div><div className="u-xs u-faint">{p.term} {p.obligation_label}</div></div> },
                  { key: 'amount', label: 'Amount', align: 'right', render: (p: LivePayment) => <span className="tnum">{fmtMoney(p.amount_cents / 100)}</span> },
                  { key: 'method', label: 'Method', render: (p: LivePayment) => <Badge tone="outline">{p.method}</Badge> },
                  { key: 'ref', label: 'Reference', render: (p: LivePayment) => <span className="mono u-xs">{p.receipt_no ?? p.gateway_ref ?? '—'}</span> },
                  {
                    key: 'provenance', label: 'Provenance', render: (p: LivePayment) => p.status !== 'confirmed' && p.status !== 'refunded' ? <span className="u-faint">—</span>
                      : p.settled_via === 'gateway' ? <Badge tone="success" dot>Gateway-verified</Badge>
                        : <Badge tone="warning" dot>Manual</Badge>},
                  {
                    key: 'status', label: 'Status', align: 'right', render: (p: LivePayment) => {
                      if (p.status === 'confirmed') return <Badge tone="success" dot>Confirmed</Badge>;
                      if (p.status === 'initiated') return <Badge tone="warning" dot>In progress</Badge>;
                      if (p.status === 'refunded') return <Badge tone="danger" dot>Refunded</Badge>;
                      if (p.status === 'failed') return <Badge tone="danger" dot>Failed</Badge>;
                      return <Badge tone="outline">{p.status}</Badge>;
                    }},
                  {
                    key: 'action', label: '', align: 'right' as const, render: (p: LivePayment) => (
                      <span className="u-flex" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        {p.reconciliation_status === 'disputed' && canOperate && (
                          <Button size="sm" variant="secondary" loading={opsBusy === `match:${p.id}`} onClick={() => markMatched(p)}>Mark matched</Button>
                        )}
                        {p.status === 'confirmed' && canRefund && (
                          <Button size="sm" variant="ghost" onClick={() => { setRefundRow(p); setRefundReason(''); }}>Refund</Button>
                        )}
                      </span>)},
                ]}
              />
            )}
          </Card>

          {(canReconcile || canDun) && (
            <Card pad style={{ marginTop: 12 }}>
              <div className="u-between" style={{ gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 580 }}>Money operations</div>
                  <div className="u-small u-muted">Reconcile the ledger against the gateway, or run the dunning sweep.</div>
                </div>
                <div className="u-flex" style={{ gap: 8 }}>
                  {canReconcile && <Button variant="secondary" icon={<Icon.Refresh size={13} />} loading={opsBusy === 'reconcile'} onClick={runReconcile}>Run reconciliation</Button>}
                  {canDun && <Button variant="secondary" icon={<Icon.Send size={13} />} loading={opsBusy === 'dunning'} onClick={runDunning}>Run dunning</Button>}
                </div>
              </div>
              {opsNote && <p className="u-small u-muted" style={{ marginTop: 10, marginBottom: 0 }}>{opsNote}</p>}
            </Card>
          )}

          {canManagePolicy && policy && (
            <Card pad style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 580 }}>Fee policy</div>
              <div className="u-small u-muted" style={{ marginBottom: 10 }}>Per-tenant settings saved to the fee ledger; every save is audited.</div>
              <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
                <label className="u-small">Refund approval threshold (₹)
                  <input className="input" type="number" min={0} value={policy.refund} onChange={e => setPolicy(p => p && ({ ...p, refund: e.target.value }))} style={{ width: 180 }} />
                </label>
                <label className="u-small">Receipt prefix
                  <input className="input" value={policy.prefix} onChange={e => setPolicy(p => p && ({ ...p, prefix: e.target.value }))} style={{ width: 120 }} />
                </label>
                <Button variant="secondary" icon={<Icon.Send size={13} />} loading={policyBusy} onClick={runLateFees}>Run late fees</Button>
                <Button variant="primary" loading={policyBusy} onClick={savePolicy}>Save policy</Button>
              </div>
            </Card>
          )}
        </Section>
      )}

      {/* ---- Installments (FEE-PRD-6b) ---- */}
      {tab === 'installments' && (
        <Section role="tabpanel" id="fees-tab-panel-installments" aria-labelledby="fees-tab-tab-installments"
          title="Installments" sub="Scheduled parts of an obligation. A plan with an installment schedule creates these rows at generation, and settlement marks them paid in order.">
          <Card>
            {installments.loading ? (
              <div className="u-col" style={{ gap: 10, padding: 'var(--s-5)' }}><Skeleton h={12} /><Skeleton h={12} /><Skeleton h={12} /></div>
            ) : installments.error ? (
              <div className="card-body"><ErrorState title="Could not load installments" sub={friendly(installments.error)} onRetry={installments.retry} /></div>
            ) : (
              <DataTable
                rows={installments.data ?? []}
                rowKey={(i: LiveInstallment) => i.id}
                empty={<Empty icon={<Icon.Calendar size={22} />} title="No installment schedules" sub="Create a fee plan with an installment schedule, then generate its obligations." />}
                columns={[
                  { key: 'student', label: 'Student', render: (i: LiveInstallment) => <div><div>{i.student_name ?? '—'}</div><div className="u-xs u-faint">{i.grade ? `Grade ${i.grade}-${i.section ?? '—'}` : ''}</div></div> },
                  { key: 'towards', label: 'Towards', render: (i: LiveInstallment) => <span className="u-small u-muted">{i.term} {i.obligation_label}</span> },
                  { key: 'seq', label: '#', align: 'right', render: (i: LiveInstallment) => <span className="tnum">{i.seq}</span> },
                  { key: 'due', label: 'Due', render: (i: LiveInstallment) => <span className="u-small">{i.due_on ? fmtDate(i.due_on) : '—'}</span> },
                  { key: 'amount', label: 'Amount', align: 'right', render: (i: LiveInstallment) => <span className="tnum">{fmtMoney(i.amount_cents / 100)}</span> },
                  { key: 'status', label: 'Status', align: 'right', render: (i: LiveInstallment) => i.status === 'paid' ? <Badge tone="success" dot>Paid</Badge> : i.status === 'overdue' ? <Badge tone="warning" dot>Overdue</Badge> : i.status === 'waived' ? <Badge tone="outline">Waived</Badge> : <Badge tone="info" dot>Pending</Badge> },
                ]}
              />
            )}
          </Card>
        </Section>
      )}

      {/* ---- Delivery (FEE-DEL-6) ---- */}
      {tab === 'delivery' && (
        <Section role="tabpanel" id="fees-tab-panel-delivery" aria-labelledby="fees-tab-tab-delivery"
          title="Fee message delivery" sub="Every fee reminder, receipt and escalation with its honest carrier state — 'delivered' is only claimed with a provider receipt.">
          <Card>
            {delivery.loading ? (
              <div className="u-col" style={{ gap: 10, padding: 'var(--s-5)' }}><Skeleton h={12} /><Skeleton h={12} /><Skeleton h={12} /></div>
            ) : delivery.error ? (
              <div className="card-body"><ErrorState title="Could not load fee delivery" sub={friendly(delivery.error)} onRetry={delivery.retry} /></div>
            ) : (
              <DataTable
                rows={delivery.data ?? []}
                rowKey={(m: LiveFeeMessage) => m.id}
                empty={<Empty icon={<Icon.Send size={22} />} title="No fee messages yet" sub="Reminders and receipts appear here once dunning runs or a payment is confirmed." />}
                columns={[
                  { key: 'date', label: 'Queued', render: (m: LiveFeeMessage) => <span className="u-small">{fmtDate(m.created_at)}</span> },
                  { key: 'template', label: 'Message', render: (m: LiveFeeMessage) => <Badge tone="outline">{m.template}</Badge> },
                  { key: 'channel', label: 'Channel', render: (m: LiveFeeMessage) => <span className="u-small">{m.channel}</span> },
                  { key: 'provider', label: 'Provider', render: (m: LiveFeeMessage) => <span className="u-small u-muted">{m.provider ?? '—'}</span> },
                  { key: 'attempts', label: 'Tries', align: 'right', render: (m: LiveFeeMessage) => <span className="tnum">{m.attempts ?? 0}</span> },
                  { key: 'status', label: 'Status', align: 'right', render: (m: LiveFeeMessage) => m.status === 'delivered' ? <Badge tone="success" dot>Delivered</Badge> : m.status === 'sent' ? <Badge tone="info" dot>Sent</Badge> : m.status === 'failed' ? <Badge tone="danger" dot>Failed</Badge> : <Badge tone="warning" dot>Queued</Badge> },
                  { key: 'error', label: 'Last error', render: (m: LiveFeeMessage) => <span className="u-xs u-faint">{m.last_error ?? '—'}</span> },
                ]}
              />
            )}
          </Card>
        </Section>
      )}

      {/* ---- Concessions ---- */}
      {tab === 'concessions' && (
        <Section role="tabpanel" id="fees-tab-panel-concessions" aria-labelledby="fees-tab-tab-concessions"
          title="Concessions & waivers"
          sub="Reductions on an obligation. A request must be approved by a second authorized person before it applies."
          actions={canInitiate ? <Button variant="primary" icon={<Icon.Plus size={14} />} onClick={() => setConOpen(true)}>Request concession</Button> : undefined}
        >
          <Card>
            {concessions.loading ? <div style={{ padding: 'var(--s-5)' }}><Skeleton h={12} /></div>
              : concessions.error ? <div className="card-body"><ErrorState title="Could not load concessions" sub={friendly(concessions.error)} onRetry={concessions.retry} /></div>
                : (
                  <DataTable
                    rows={concessions.data ?? []}
                    rowKey={(c: LiveConcession) => c.id}
                    empty={<Empty icon={<Icon.Scale size={22} />} title="No concessions" sub="Request one to reduce a student's fee with an audit trail." />}
                    columns={[
                      { key: 'student', label: 'Student', render: (c: LiveConcession) => <div><div>{c.student_name ?? '—'}</div><div className="u-xs u-faint">{c.grade ? `Grade ${c.grade}-${c.section ?? '—'}` : ''}</div></div> },
                      { key: 'kind', label: 'Kind', render: (c: LiveConcession) => <Badge tone="outline">{c.kind}</Badge> },
                      { key: 'towards', label: 'Towards', render: (c: LiveConcession) => <span className="u-small u-muted">{c.obligation_label ?? 'Student-level'}</span> },
                      { key: 'amount', label: 'Amount', align: 'right', render: (c: LiveConcession) => <span className="tnum">{c.amount_cents != null ? fmtMoney(c.amount_cents / 100) : c.percent != null ? `${c.percent}%` : '—'}</span> },
                      { key: 'status', label: 'Status', align: 'right', render: (c: LiveConcession) => c.status === 'approved' || c.status === 'active' ? <Badge tone="success" dot>{c.status}</Badge> : c.status === 'rejected' ? <Badge tone="danger" dot>Rejected</Badge> : <Badge tone="warning" dot>Requested</Badge> },
                      { key: 'action', label: '', align: 'right' as const, render: (c: LiveConcession) => c.status === 'requested' && canConfirm
                        ? <span className="u-flex" style={{ gap: 6, justifyContent: 'flex-end' }}>
                            <Button size="sm" variant="secondary" loading={conBusy === c.id} onClick={() => decideConcession(c, 'approve')}>Approve</Button>
                            <Button size="sm" variant="ghost" loading={conBusy === c.id} onClick={() => decideConcession(c, 'reject')}>Reject</Button>
                          </span>
                        : null },
                    ]}
                  />
                )}
          </Card>
        </Section>
      )}

      {/* ---- Fee plans ---- */}
      {tab === 'plans' && (
        <Section role="tabpanel" id="fees-tab-panel-plans" aria-labelledby="fees-tab-tab-plans">
          <FeePlans />
        </Section>
      )}

      {tab === 'byclass' && (
        <Section role="tabpanel" id="fees-tab-panel-byclass" aria-labelledby="fees-tab-tab-byclass"
          title="Collection by class"
          sub="Percentage of billed amount collected, computed from the ledger across every student. Below 80% is highlighted for follow-up."
        >
          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            <Card pad>
              <BarChart
                data={byClass}
                format={v => `${v}%`}
                highlightMax={false}
                height={200}
              />
            </Card>
            <Card pad>
              <div className="u-col" style={{ gap: 12 }}>
                <div className="u-upper">Watchlist</div>
                {(() => {
                  const top = byClass.reduce((a, b) => (b.value > a.value ? b : a), byClass[0]);
                  return top && top.value >= 90 ? (
                    <div className="collect-moment" role="status">
                      <Icon.Check size={13} style={{ flexShrink: 0 }} />
                      <span><strong>{top.label}</strong> crossed {Math.floor(top.value)}% collected — the term is landing.</span>
                    </div>
                  ) : null;
                })()}
                {belowAvgClasses.length === 0 ? (
                  <Empty icon={<Icon.Check size={20} />} title="No class below 80%" sub="Every grade is collecting above the follow-up threshold." />
                ) : (
                  <div className="u-col" style={{ gap: 10 }}>
                    {belowAvgClasses.map(c => (
                      <div key={c.label} className="u-between" style={{ gap: 10, padding: '10px 12px', border: '1px solid var(--warning-weak-2)', borderRadius: 'var(--r-md)', background: 'var(--warning-weak)' }}>
                        <span style={{ fontWeight: 580 }}>{c.label}</span>
                        <span className="u-flex" style={{ gap: 10 }}>
                          <span className="tnum" style={{ width: 120 }}><Progress value={c.value} tone="warn" /></span>
                          <span className="tnum mono" style={{ width: 52, textAlign: 'right' }}>{fmtPct(c.value, 1)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="u-small u-muted">
                  Classes under 80% usually track transport disruption or pending concessions — follow up before adding late fees.
                </div>
                <Donut
                  size={116}
                  thickness={13}
                  centerLabel={fmtPct(stats.collectedPct, 1)}
                  centerSub="collected"
                  segments={[
                    { label: 'Collected', value: stats.collectedPct, color: 'var(--accent)' },
                    { label: 'Outstanding', value: Math.max(0, 100 - stats.collectedPct), color: 'var(--warning-weak-2)' }]}
                />
              </div>
            </Card>
          </div>
        </Section>
      )}

      <StudentFeeDrawerLive studentId={selectedId} onClose={() => setSelectedId(null)} canPay={canConfirm} onRecord={setPayRow} />

      <RecordPaymentModal
        row={payRow}
        onClose={() => setPayRow(null)}
        onDone={refreshAll}
      />

      {/* void confirm — owner only */}
      <Modal
        open={!!voidRow}
        onClose={() => !voiding && setVoidRow(null)}
        title="Void this obligation?"
        sub={voidRow ? `${voidRow.studentName} · ${voidRow.term} ${voidRow.category} · ${fmtMoney(voidRow.amount - voidRow.paidAmount)} outstanding` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setVoidRow(null)} disabled={voiding}>Cancel</Button>
            <Button variant="danger" loading={voiding} onClick={voidObligation}>Void permanently</Button>
          </>
        }
      >
        <p className="u-small u-muted" style={{ marginTop: 0, lineHeight: 1.65 }}>
          Voiding marks the ledger row void server-side — it is never deleted and the action is audited with your name.
          Any payments already recorded on the obligation stay in the ledger; only the outstanding amount stops being collectible.
        </p>
        <div className="field">
          <label htmlFor="void-reason">Reason (recommended)</label>
          <input id="void-reason" className="input" value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="e.g. duplicate entry · corrected after reconciliation" />
        </div>
      </Modal>

      {/* refund confirm — maker-checker enforced server-side above the threshold */}
      <Modal
        open={!!refundRow}
        onClose={() => !refunding && setRefundRow(null)}
        title="Refund this payment?"
        sub={refundRow ? `${refundRow.student_name ?? ''} · ${fmtMoney(refundRow.amount_cents / 100)} · ${refundRow.method} · receipt ${refundRow.receipt_no ?? '—'}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRefundRow(null)} disabled={refunding}>Cancel</Button>
            <Button variant="danger" loading={refunding} onClick={refundPayment}>Refund</Button>
          </>
        }
      >
        <p className="u-small u-muted" style={{ marginTop: 0, lineHeight: 1.65 }}>
          The full remaining amount is returned and the obligation is recomputed. A refund at or above the approval
          threshold needs a checker — a maker cannot approve their own reversal. The receipt is voided, and the
          reversal is audited with your name.
        </p>
        <div className="field">
          <label htmlFor="refund-reason">Reason {refundRow && refundRow.amount_cents >= 500000 ? '(required above ₹5,000)' : '(recommended)'}</label>
          <input id="refund-reason" className="input" value={refundReason} onChange={e => setRefundReason(e.target.value)} placeholder="e.g. duplicate payment · admission cancelled" />
        </div>
      </Modal>

      {/* concession request */}
      <Modal
        open={conOpen}
        onClose={() => !conBusy && setConOpen(false)}
        title="Request a concession"
        sub="A second authorized person approves it before the obligation is reduced."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConOpen(false)} disabled={!!conBusy}>Cancel</Button>
            <Button variant="primary" loading={conBusy === 'create'} onClick={createConcession}>Request</Button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="con-student">Student id (uuid)</label>
          <input id="con-student" className="input" value={conForm.studentId} onChange={e => setConForm(f => ({ ...f, studentId: e.target.value }))} placeholder="00000000-0000-0000-0000-000000000000" />
        </div>
        <div className="field">
          <label htmlFor="con-kind">Kind</label>
          <select id="con-kind" className="input" value={conForm.kind} onChange={e => setConForm(f => ({ ...f, kind: e.target.value }))}>
            <option value="concession">Concession</option>
            <option value="scholarship">Scholarship</option>
            <option value="sibling">Sibling discount</option>
            <option value="staff">Staff ward</option>
            <option value="waiver">Waiver</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="con-amount">Amount (₹)</label>
          <input id="con-amount" className="input" inputMode="decimal" value={conForm.amountRupees} onChange={e => setConForm(f => ({ ...f, amountRupees: e.target.value }))} placeholder="e.g. 5000" />
        </div>
        <div className="field">
          <label htmlFor="con-reason">Reason</label>
          <input id="con-reason" className="input" value={conForm.reason} onChange={e => setConForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. sibling of a current student" />
        </div>
      </Modal>
    </div>
  );
}
