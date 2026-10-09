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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FeePlans from './finance/FeePlans';
import {
  apiFeeObligations, apiGet, apiVoidObligation,
  apiPayments, apiRefundPayment, apiMarkMatched, apiReconcile, apiRunDunning, apiReconRuns, type LivePayment, type ReconRun,
  apiConcessions, apiCreateConcession, apiDecideConcession, type LiveConcession,
  apiInstallments, type LiveInstallment, apiFeeDelivery, type LiveFeeMessage,
  apiFeeSettings, apiSaveFeeSettings, apiRunLateFees, apiObligationInvoice,
} from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { statusLabel, humanize, gradeLabel, classAndSection } from '../lib/labels';
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
        <Empty title="No fee records for this student" sub="Fee dues appear here once the school creates them." />
      ) : (
        <div className="u-col" style={{ gap: 18 }}>
          <div className="grid grid-3">
            <Stat label="Outstanding" value={fmtMoneyShort(outstanding)} sub="Open + part-paid" />
            <Stat label="Paid to date" value={fmtMoneyShort(paidTotal)} sub="All settled amounts" />
            <Stat label="Line items" value={rows.length} sub="This student's fee records" />
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
          <KeyValue items={[{ k: 'Data source', v: 'School fee records (live)' }]} />
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
  gradeSection: o.grade != null ? gradeLabel(classAndSection(o.grade, o.section)) : '',
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
  /* UX-07: the finance desk leads with the task — find a student, see the amount
     due, record the payment. A text search sits above the table for that. */
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
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
  /* P2-4 guard: the CONFIRM door admits finance, the finance head and the owner — a finance clerk may
     *initiate* a payment but not confirm its settlement. The two tiers are separate doors on purpose
     (the desk records money that has actually arrived), and the UI now says the same thing. */
  const canConfirm = useRoleOrGrant(['finance', 'finance_head', 'owner'], ['POST /fees/payments/:id/confirm']);
  const canRefund = useRoleOrGrant(['finance', 'finance_head', 'finance_clerk', 'owner'], ['POST /payments/:id/refund']);
  const canOperate = useRoleOrGrant(['finance', 'finance_head', 'finance_clerk', 'owner'], ['POST /payments/reconcile', 'POST /fees/dunning/run']);
  /* OPP-PRD-4/PRD-18: the principal owns fee-health and the dunning ladder; reconciliation stays finance. */
  const canReconcile = useRoleOrGrant(['finance', 'finance_head', 'finance_clerk', 'owner'], ['POST /payments/reconcile']);
  const canDun = useRoleOrGrant(['finance', 'finance_head', 'finance_clerk', 'owner', 'principal'], ['POST /fees/dunning/run']);
  const canVoid = useRoleOrGrant(['owner'], ['POST /fees/obligations/:id/void']);
  /* A6/D12: per-tenant fee policy is now writable (GET/PUT /fees/settings) — owner / finance head.
     Everything in the fees domain is tenant-configurable here: installments, dates, late fees,
     scholarships/discounts (catalogue via API), refunds, receipts, reminders and reconciliation. */
  const canManagePolicy = useRoleOrGrant(['owner', 'finance_head'], ['PUT /fees/settings']);
  type Policy = {
    refund: string; prefix: string; latePerDay: string; lateCap: string; lateGrace: string;
    lateEnabled: boolean; lateMode: string; refundWindow: string; refundPartial: boolean;
    minPartial: string; allowPartial: boolean; receiptReset: string; invoiceNotes: string;
    beforeDue: string; escalation: string; quietStart: string; quietEnd: string;
    maxParts: string; maxExt: string;
  };
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);

  /* Counter PINs: cash at the desk is the borrowed-phone fraud vector. Owner/finance-head enroll
     a 4–6 digit PIN per counter staff member (hash-only, like passwords); the payment modal asks
     for it on cash, and staff without an enrolled PIN work exactly as before. */
  const canPin = useRoleOrGrant(['owner', 'finance_head'], ['POST /fees/pins']);
  const [pinStaff, setPinStaff] = useState<{ id: string; name: string; role: string }[]>([]);
  const [pinForm, setPinForm] = useState({ staffId: '', pin: '' });
  useEffect(() => {
    if (!canPin) return;
    let dead = false;
    apiGet<{ staff: { id: string; name: string; role: string }[] }>('/school/staff')
      .then(r => { if (!dead) setPinStaff((r.staff ?? []).filter(s => !['parent', 'student'].includes(s.role))); })
      .catch(() => { if (!dead) setPinStaff([]); });
    return () => { dead = true; };
  }, [canPin]);
  const enrollPin = async () => {
    if (!pinForm.staffId) { toast({ title: 'Pick the counter staff member', tone: 'info' }); return; }
    if (!/^[0-9]{4,6}$/.test(pinForm.pin)) { toast({ title: 'PIN is 4–6 digits', sub: 'Tell it to them in person — it is shown nowhere after this.', tone: 'info' }); return; }
    setPolicyBusy(true);
    try {
      const { feePinSet } = await import('../services/complianceApi');
      await feePinSet(pinForm.staffId, pinForm.pin);
      toast({ title: 'Counter PIN enrolled', sub: 'Their cash collections now ask for it. Unenrolled staff work as before.', tone: 'success' });
      setPinForm({ staffId: '', pin: '' });
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setPolicyBusy(false); }
  };
  useEffect(() => {
    if (!canManagePolicy) return;
    apiFeeSettings().then(r => setPolicy({
      refund: String(Math.round(Number(r.settings.refund_approval_threshold_cents ?? 500000) / 100)),
      prefix: String(r.settings.receipt_prefix ?? 'RCP'),
      /* P2-13: the ledger stores paise, this screen collects rupees — the conversion happens HERE,
         once, rather than in every field. "Run late fees" used to be a button that could only ever
         answer 409, because the rate it needs was never collectable from anywhere in the product:
         `grep late_fee app/src` returned nothing. A school could not switch late fees on at all. */
      latePerDay: String(Math.round(Number(r.settings.late_fee_per_day_cents ?? 0) / 100)),
      lateCap: String(Math.round(Number(r.settings.late_fee_cap_cents ?? 0) / 100)),
      lateGrace: String(Math.round(Number(r.settings.late_fee_grace_days ?? 0))),
      lateEnabled: Boolean(r.settings.late_fee_enabled ?? (Number(r.settings.late_fee_per_day_cents ?? 0) > 0)),
      lateMode: String(r.settings.late_fee_mode ?? 'per_day'),
      refundWindow: String(Math.round(Number(r.settings.refund_window_days ?? 0))),
      refundPartial: Boolean(r.settings.refund_partial_allowed ?? true),
      minPartial: String(Math.round(Number(r.settings.min_partial_cents ?? 10000) / 100)),
      allowPartial: Boolean(r.settings.allow_parent_partial ?? true),
      receiptReset: String(r.settings.receipt_reset ?? 'never'),
      invoiceNotes: String(r.settings.invoice_notes ?? ''),
      beforeDue: Array.isArray(r.settings.dunning_before_due_days) ? (r.settings.dunning_before_due_days as number[]).join(',') : '',
      escalation: Array.isArray(r.settings.dunning_escalation_days) ? (r.settings.dunning_escalation_days as number[]).join(',') : '',
      quietStart: String(r.settings.dunning_quiet_start ?? '21:00'),
      quietEnd: String(r.settings.dunning_quiet_end ?? '08:00'),
      maxParts: String(Math.round(Number(r.settings.installment_max_parts ?? 12))),
      maxExt: String(Math.round(Number(r.settings.max_extension_days ?? 30))),
    })).catch(() => setPolicy(null));
  }, [canManagePolicy]);
  const rupees = (v: string) => Math.max(0, Math.round(Number(v) * 100));
  const dayList = (v: string) => v.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0 && n <= 90).slice(0, 10);
  const savePolicy = () => {
    if (!policy) return;
    setPolicyBusy(true);
    apiSaveFeeSettings({
      refund_approval_threshold_cents: rupees(policy.refund),
      receipt_prefix: policy.prefix,
      receipt_reset: policy.receiptReset,
      invoice_notes: policy.invoiceNotes.slice(0, 500),
      late_fee_enabled: policy.lateEnabled,
      late_fee_mode: policy.lateMode,
      late_fee_per_day_cents: rupees(policy.latePerDay),
      late_fee_cap_cents: rupees(policy.lateCap),
      late_fee_grace_days: Math.max(0, Math.trunc(Number(policy.lateGrace) || 0)),
      refund_window_days: Math.max(0, Math.trunc(Number(policy.refundWindow) || 0)),
      refund_partial_allowed: policy.refundPartial,
      min_partial_cents: rupees(policy.minPartial),
      allow_parent_partial: policy.allowPartial,
      dunning_before_due_days: dayList(policy.beforeDue),
      dunning_escalation_days: dayList(policy.escalation),
      dunning_quiet_start: policy.quietStart,
      dunning_quiet_end: policy.quietEnd,
      installment_max_parts: Math.min(24, Math.max(1, Math.trunc(Number(policy.maxParts) || 12))),
      max_extension_days: Math.max(0, Math.trunc(Number(policy.maxExt) || 0)),
    })
      .then(() => toast({ title: 'Fee policy saved', tone: 'success' }))
      .catch(e => toast({ title: 'Could not save fee policy', sub: friendly(e), tone: 'error' }))
      .finally(() => setPolicyBusy(false));
  };
  const runLateFees = () => {
    setPolicyBusy(true);
    apiRunLateFees()
      .then(r => toast({ title: 'Late fees applied', sub: `${r.updated} fee due(s) updated`, tone: 'success' }))
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

  /* 4.3 mismatch queue: disputes only (server-filtered, so paging never hides one),
     plus the latest sweep run for the header. The queue resolves human-side —
     nothing here settles money; settlement stays the confirm desk (A7). */
  /* F-29: the queueOnly toggle has no UI wired (setQueueOnly never called), so the
     mismatch queue stays empty by construction. Kept as a read-only flag until the
     toggle is built — do not re-add the setter without the control. */
  const [queueOnly] = useState(false);
  const queue = useAsync<LivePayment[]>(async () => {
    if (!queueOnly) return [];
    const res = await apiPayments({ recon: 'disputed' });
    return res.payments ?? [];
  }, [queueOnly]);
  const lastRun = useAsync<ReconRun[]>(async () => {
    if (!canReconcile) return [];
    const res = await apiReconRuns(1);
    return res.runs ?? [];
  }, [canReconcile]);

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
      toast({ title: 'Check the form', sub: 'A student ID and a positive amount are required.', tone: 'error' });
      return;
    }
    setConBusy('create');
    try {
      await apiCreateConcession({ studentId: conForm.studentId.trim(), kind: conForm.kind, amountCents: cents, reason: conForm.reason.trim() || undefined });
      toast({ title: 'Concession requested', sub: 'A second authorized person must approve it before it applies.', tone: 'success' });
      setConOpen(false);
      setConForm({ studentId: '', kind: 'concession', amountRupees: '', reason: '' });
      concessions.retry();
    } catch (e) { toast({ title: 'Could not request the discount or waiver', sub: friendly(e), tone: 'error' }); }
    finally { setConBusy(null); }
  };

  const decideConcession = async (c: LiveConcession, decision: 'approve' | 'reject') => {
    setConBusy(c.id);
    try {
      await apiDecideConcession(c.id, decision);
      toast({ title: decision === 'approve' ? 'Concession approved' : 'Concession rejected', sub: `${c.student_name ?? ''} · ${c.kind === 'concession' ? 'Discount or waiver' : humanize(c.kind)}`, tone: 'success' });
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
      toast({ title: 'Fee due voided', sub: `${voidRow.studentName} · ${voidRow.term} ${voidRow.category} — the fee record is marked void and stays visible for audit.`, tone: 'success' });
      setVoidRow(null);
      setVoidReason('');
      refreshAll();
    } catch (e) {
      toast({ title: 'Could not void the fee due', sub: friendly(e), tone: 'error' });
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
      toast({ title: `Refunded ${fmtMoney(r.refundedCents / 100)}`, sub: `Payment is now ${statusLabel(r.payment.status)}. The fee due and receipt were updated.`, tone: 'success' });
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
      refreshAll(); queue.retry(); lastRun.retry();
    } catch (e) { toast({ title: 'Could not clear the discrepancy', sub: friendly(e), tone: 'error' }); }
    finally { setOpsBusy(null); }
  };

  const runReconcile = async () => {
    setOpsBusy('reconcile'); setOpsNote(null);
    try {
      const r = await apiReconcile();
      setOpsNote(`Reconciliation: ${r.total} discrepancy(ies) — ghost ${r.discrepancies.ghostLocalConfirmed.length}, missing ${r.discrepancies.missingLocalConfirmation.length}, orphan ${r.discrepancies.orphanNoRailLog.length}, amount-mismatch ${r.discrepancies.amountMismatch.length}.`);
      toast({ title: r.total === 0 ? 'Reconciliation clean' : `${r.total} discrepancy(ies) found`, sub: 'Findings are on the fee records and raise events for follow-up.', tone: r.total === 0 ? 'success' : 'info' });
      refreshAll(); queue.retry(); lastRun.retry();
    } catch (e) { toast({ title: 'Reconciliation failed', sub: friendly(e), tone: 'error' }); }
    finally { setOpsBusy(null); }
  };

  const runDunning = async () => {
    setOpsBusy('dunning'); setOpsNote(null);
    try {
      const r = await apiRunDunning();
      setOpsNote(r.note ?? `Fee reminders: ${r.queued} queued (overdue ${r.overdueQueued}, before-due ${r.beforeDueQueued}), ${r.escalated} escalated, ${r.skippedNoContact} skipped without contact.`);
      toast({ title: r.queued || r.escalated ? `Fee reminders: ${r.queued} queued` : 'Fee reminders: nothing to send', sub: r.note ?? `${r.escalated} escalation(s) raised.`, tone: 'success' });
    } catch (e) { toast({ title: 'Fee reminder run failed', sub: friendly(e), tone: 'error' }); }
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
    const byStatus = statusFilter === 'all' ? items : items.filter(f => f.status === statusFilter);
    const q = query.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter(f => `${f.studentName} ${f.gradeSection} ${f.term} ${f.category}`.toLowerCase().includes(q));
  }, [obligations.data, statusFilter, query]);

  /* P2-14 / P3-10 · the page-head "Record payment" was a PRIMARY button that did nothing but focus
     the search box: there is a real record-payment action on each ledger row, and anything targeting
     this button by label — a person, or automation — hit the shortcut and recorded nothing. It now
     does the thing its label says when it can (exactly one open due), and when it cannot it SAYS so
     and takes you to the search, instead of silently doing nothing. */
  const openDues = useMemo(
    () => (obligations.data ?? []).filter(f => f.status !== 'paid' && f.status !== 'void' && f.amount - f.paidAmount > 0),
    [obligations.data]);

  const recordFromHead = () => {
    if (openDues.length === 1) { setPayRow(openDues[0]); return; }
    setTab('ledger');
    requestAnimationFrame(() => searchRef.current?.focus());
    toast({
      title: openDues.length ? `${openDues.length} fee dues are open` : 'Nothing is due',
      sub: openDues.length
        ? 'Find the student, then use Record payment on their row.'
        : 'No unpaid fee due to record against right now.',
      tone: 'info',
    });
  };

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
      .map(({ grade, pct }) => ({ label: grade ? gradeLabel(grade) : 'Ungraded', value: pct, color: pct < 80 ? 'var(--warning)' : 'var(--accent)' }));
  }, [obligations.data]);

  const belowAvgClasses = byClass.filter(c => c.value < 80);

  const payDisabledReason = canConfirm ? undefined
    : canInitiate ? 'Payments are recorded by finance or the owner — you can initiate, but settlement confirmation needs finance.'
      : 'Your role can view fee records; recording payments is done by finance or the owner.';

  return (
    <div>
      <PageHead
        title="Fees"
        sub="Find a student's fee dues and record a payment. Everything here comes from the school's own fee records."
        actions={
          <>
            <Badge tone="outline">Live fee records</Badge>
            {canConfirm && (
              <Button variant="primary" icon={<Icon.Money size={14} />} onClick={recordFromHead}>
                Record payment
              </Button>
            )}
            <Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={refreshAll}>Refresh</Button>
          </>
        }
      />

      {/* UX-07: the task starts with finding the student. Kept visually quieter
          than the primary action but above the statistics. */}
      <div className="searchbox" style={{ maxWidth: 440, marginBottom: 16 }}>
        <Icon.Search size={16} />
        <input
          ref={searchRef}
          className="input"
          value={query}
          onChange={e => { setQuery(e.target.value); setTab('ledger'); }}
          placeholder="Find a student by name or class…"
          aria-label="Find a student's fee dues"
        />
      </div>

      {/* ---- Stats ---- */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <Stat label="Outstanding" value={fmtMoneyShort(stats.outstanding)} sub={`${stats.openCount} open fee dues`} />
        <Stat label="Collected" value={fmtPct(stats.collectedPct, 1)} sub="Share of billed amount collected" />
        <Stat label="Past due date" value={fmtMoneyShort(stats.overdueAmt)} sub="Unpaid and past the due date" />
        <Stat label="Fee records" value={(obligations.data ?? []).length} sub="Fee dues on record" />
      </div>

      {/* ---- Tabs ---- */}
      <Tabs
        tabs={[
          { id: 'ledger', label: 'Fee dues' },
          { id: 'payments', label: 'Payments', count: lastPayments.length },
          { id: 'installments', label: 'Installments', count: (installments.data ?? []).length },
          { id: 'delivery', label: 'Delivery', count: (delivery.data ?? []).length },
          { id: 'concessions', label: 'Discounts & waivers', count: (concessions.data ?? []).filter(c => c.status === 'requested').length },
          { id: 'byclass', label: 'By class' },
          { id: 'plans', label: 'Fee structure' }]}
        active={tab}
        onChange={t => setTab(t as TabId)}
        panelId="fees-tab"
      />

      {/* ---- Ledger ---- */}
      {tab === 'ledger' && (
        <Section role="tabpanel" id="fees-tab-panel-ledger" aria-labelledby="fees-tab-tab-ledger"
          title="Fee dues"
          sub={`${filtered.length} fee dues from the school's fee records. Row click opens the student's fee summary.`}
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
              <div className="card-body"><ErrorState title="Could not load the fee records" sub={friendly(obligations.error)} onRetry={obligations.retry} /></div>
            ) : (
              <DataTable
                caption="Fee records — amount, status and action per student"
                rows={filtered.slice(0, 60)}
                rowKey={f => f.id}
                onRowClick={f => setSelectedId(f.id)}
                empty={<Empty icon={<Icon.Money size={22} />} title="No fee records yet" sub="Fee dues appear here once the school records them. The fee structure is set up first."
                    action={canOperate
                      ? <Button variant="secondary" onClick={() => navigate('/fees/plans')}>Set up fee structure</Button>
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
                    key: 'action', label: '', align: 'right' as const, emptyCell: 'blank' as const, render: (f: FeeRow) => {
                      const payable = f.status !== 'paid' && f.status !== 'void';
                      if (!payable) return null;
                      return (
                        <span className="u-flex" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          {canConfirm
                            ? <Button size="sm" variant="secondary" icon={<Icon.Money size={12} />} onClick={e => { e.stopPropagation(); setPayRow(f); }}>Record payment</Button>
                            : <Button size="sm" variant="secondary" disabled title={payDisabledReason} icon={<Icon.Money size={12} />} onClick={e => e.stopPropagation()}>Record payment</Button>}
                          {canVoid && (
                            <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setVoidRow(f); setVoidReason(''); }} title="Void this fee (owner, audited)">Void</Button>
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
                  { key: 'method', label: 'Method', render: (p: LivePayment) => <Badge tone="outline">{humanize(p.method)}</Badge> },
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
                      return <Badge tone="outline">{statusLabel(p.status)}</Badge>;
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
                  <div className="u-small u-muted">Reconcile the fee records against the gateway, or run the fee reminders.</div>
                </div>
                <div className="u-flex" style={{ gap: 8 }}>
                  {canReconcile && <Button variant="secondary" icon={<Icon.Refresh size={13} />} loading={opsBusy === 'reconcile'} onClick={runReconcile}>Run reconciliation</Button>}
                  {canDun && <Button variant="secondary" icon={<Icon.Send size={13} />} loading={opsBusy === 'dunning'} onClick={runDunning}>Run fee reminders</Button>}
                </div>
              </div>
              {opsNote && <p className="u-small u-muted" style={{ marginTop: 10, marginBottom: 0 }}>{opsNote}</p>}
            </Card>
          )}

          {canManagePolicy && policy && (
            <Card pad style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 580 }}>Fee policy — everything is set by your school</div>
              <div className="u-small u-muted" style={{ marginBottom: 10 }}>Installments, dates, late fees, refunds, receipts, reminders. Every save is audited. Scholarships & per-head rules live in the finance setup (discount rules API).</div>
              <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
                <label className="u-small">Refund approval threshold (₹)
                  <input className="input" type="number" min={0} value={policy.refund} onChange={e => setPolicy(p => p && ({ ...p, refund: e.target.value }))} style={{ width: 180 }} />
                </label>
                <label className="u-small">Refund window (days, 0 = none)
                  <input className="input" type="number" min={0} value={policy.refundWindow} onChange={e => setPolicy(p => p && ({ ...p, refundWindow: e.target.value }))} style={{ width: 150 }} />
                </label>
                <label className="u-small">Partial refunds
                  <select className="input" value={policy.refundPartial ? 'yes' : 'no'} onChange={e => setPolicy(p => p && ({ ...p, refundPartial: e.target.value === 'yes' }))} style={{ width: 110 }}>
                    <option value="yes">Allowed</option><option value="no">Full only</option>
                  </select>
                </label>
                <label className="u-small">Receipt prefix
                  <input className="input" value={policy.prefix} onChange={e => setPolicy(p => p && ({ ...p, prefix: e.target.value }))} style={{ width: 120 }} />
                </label>
                <label className="u-small">Receipt reset
                  <select className="input" value={policy.receiptReset} onChange={e => setPolicy(p => p && ({ ...p, receiptReset: e.target.value }))} style={{ width: 150 }}>
                    <option value="never">Never</option><option value="yearly">Yearly</option><option value="academic_year">Academic year</option>
                  </select>
                </label>
                <label className="u-small">Late fees
                  <select className="input" value={policy.lateEnabled ? 'on' : 'off'} onChange={e => setPolicy(p => p && ({ ...p, lateEnabled: e.target.value === 'on' }))} style={{ width: 110 }}>
                    <option value="off">Off</option><option value="on">On</option>
                  </select>
                </label>
                <label className="u-small">Late mode
                  <select className="input" value={policy.lateMode} onChange={e => setPolicy(p => p && ({ ...p, lateMode: e.target.value }))} style={{ width: 120 }}>
                    <option value="per_day">Per day</option><option value="fixed">Fixed</option><option value="percent">Percent</option>
                  </select>
                </label>
                {/* P2-13: the three values "Run late fees" actually reads. Late fees are OFF at 0/day,
                    which is why the button used to be permanently 409 rather than broken. */}
                <label className="u-small">Late fee (₹ per day)
                  <input className="input" type="number" min={0} value={policy.latePerDay}
                    onChange={e => setPolicy(p => p && ({ ...p, latePerDay: e.target.value }))}
                    style={{ width: 130 }} aria-label="Late fee per day" />
                </label>
                <label className="u-small">Grace (days)
                  <input className="input" type="number" min={0} value={policy.lateGrace}
                    onChange={e => setPolicy(p => p && ({ ...p, lateGrace: e.target.value }))}
                    style={{ width: 110 }} aria-label="Late fee grace days" />
                </label>
                <label className="u-small">Late fee cap (₹, 0 = none)
                  <input className="input" type="number" min={0} value={policy.lateCap}
                    onChange={e => setPolicy(p => p && ({ ...p, lateCap: e.target.value }))}
                    style={{ width: 150 }} aria-label="Late fee cap" />
                </label>
                <label className="u-small">Min partial (₹)
                  <input className="input" type="number" min={0} value={policy.minPartial} onChange={e => setPolicy(p => p && ({ ...p, minPartial: e.target.value }))} style={{ width: 130 }} />
                </label>
                <label className="u-small">Parent partials
                  <select className="input" value={policy.allowPartial ? 'yes' : 'no'} onChange={e => setPolicy(p => p && ({ ...p, allowPartial: e.target.value === 'yes' }))} style={{ width: 110 }}>
                    <option value="yes">Allowed</option><option value="no">Disabled</option>
                  </select>
                </label>
                <label className="u-small">Remind before due (days, comma list)
                  <input className="input" value={policy.beforeDue} onChange={e => setPolicy(p => p && ({ ...p, beforeDue: e.target.value }))} placeholder="7,3,1" style={{ width: 170 }} />
                </label>
                <label className="u-small">Escalate after (days)
                  <input className="input" value={policy.escalation} onChange={e => setPolicy(p => p && ({ ...p, escalation: e.target.value }))} placeholder="30" style={{ width: 130 }} />
                </label>
                <label className="u-small">Quiet start
                  <input className="input" value={policy.quietStart} onChange={e => setPolicy(p => p && ({ ...p, quietStart: e.target.value }))} placeholder="21:00" style={{ width: 100 }} />
                </label>
                <label className="u-small">Quiet end
                  <input className="input" value={policy.quietEnd} onChange={e => setPolicy(p => p && ({ ...p, quietEnd: e.target.value }))} placeholder="08:00" style={{ width: 100 }} />
                </label>
                <label className="u-small">Max installments
                  <input className="input" type="number" min={1} max={24} value={policy.maxParts} onChange={e => setPolicy(p => p && ({ ...p, maxParts: e.target.value }))} style={{ width: 120 }} />
                </label>
                <label className="u-small">Max extension (days)
                  <input className="input" type="number" min={0} value={policy.maxExt} onChange={e => setPolicy(p => p && ({ ...p, maxExt: e.target.value }))} style={{ width: 130 }} />
                </label>
                <label className="u-small">Invoice note
                  <input className="input" value={policy.invoiceNotes} onChange={e => setPolicy(p => p && ({ ...p, invoiceNotes: e.target.value }))} placeholder="Pay before due date…" style={{ width: 220 }} />
                </label>
                <Button variant="secondary" icon={<Icon.Send size={13} />} loading={policyBusy} onClick={runLateFees}>Run late fees</Button>
                <Button variant="primary" loading={policyBusy} onClick={savePolicy}>Save policy</Button>
              </div>
            </Card>
          )}

          {canPin && (
            <Card pad style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 580 }}>Counter PINs</div>
              <div className="u-small u-muted" style={{ marginBottom: 10 }}>Cash at the desk is the borrowed-phone fraud vector. Enroll a 4–6 digit PIN per counter staff member — hash-only, shown nowhere after this. Staff without a PIN work exactly as before.</div>
              <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
                <label className="u-small">Staff member
                  <select className="input" value={pinForm.staffId} onChange={e => setPinForm(f => ({ ...f, staffId: e.target.value }))} aria-label="Counter staff member" style={{ display: 'block', marginTop: 4, minWidth: 220 }}>
                    <option value="">Choose…</option>
                    {pinStaff.map(s => <option key={s.id} value={s.id}>{s.name} · {s.role}</option>)}
                  </select>
                </label>
                <label className="u-small">PIN (4–6 digits)
                  <input className="input" type="password" inputMode="numeric" maxLength={6} value={pinForm.pin} onChange={e => setPinForm(f => ({ ...f, pin: e.target.value }))} style={{ display: 'block', marginTop: 4, maxWidth: 140 }} autoComplete="off" />
                </label>
                <Button variant="secondary" loading={policyBusy} onClick={enrollPin}>Enroll PIN</Button>
              </div>
            </Card>
          )}
        </Section>
      )}

      {/* ---- Installments (FEE-PRD-6b) ---- */}
      {tab === 'installments' && (
        <Section role="tabpanel" id="fees-tab-panel-installments" aria-labelledby="fees-tab-tab-installments"
          title="Installments" sub="Scheduled parts of a fee due. A plan with an installment schedule creates these rows at generation, and settlement marks them paid in order.">
          <Card>
            {installments.loading ? (
              <div className="u-col" style={{ gap: 10, padding: 'var(--s-5)' }}><Skeleton h={12} /><Skeleton h={12} /><Skeleton h={12} /></div>
            ) : installments.error ? (
              <div className="card-body"><ErrorState title="Could not load installments" sub={friendly(installments.error)} onRetry={installments.retry} /></div>
            ) : (
              <DataTable
                rows={installments.data ?? []}
                rowKey={(i: LiveInstallment) => i.id}
                empty={<Empty icon={<Icon.Calendar size={22} />} title="No installment schedules" sub="Create a fee plan with an installment schedule, then generate its fee dues." />}
                columns={[
                  { key: 'student', label: 'Student', render: (i: LiveInstallment) => <div><div>{i.student_name ?? '—'}</div><div className="u-xs u-faint">{i.grade ? gradeLabel(classAndSection(i.grade, i.section)) : ''}</div></div> },
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
                empty={<Empty icon={<Icon.Send size={22} />} title="No fee messages yet" sub="Reminders and receipts appear here once fee reminders run or a payment is confirmed." />}
                columns={[
                  { key: 'date', label: 'Queued', render: (m: LiveFeeMessage) => <span className="u-small">{fmtDate(m.created_at)}</span> },
                  { key: 'template', label: 'Message', render: (m: LiveFeeMessage) => <Badge tone="outline">{humanize(m.template)}</Badge> },
                  { key: 'channel', label: 'Channel', render: (m: LiveFeeMessage) => <span className="u-small">{humanize(m.channel)}</span> },
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
          title="Discounts & waivers"
          sub="Reductions on a fee due. A request must be approved by a second authorized person before it applies."
          actions={canInitiate ? <Button variant="primary" icon={<Icon.Plus size={14} />} onClick={() => setConOpen(true)}>Request discount or waiver</Button> : undefined}
        >
          <Card>
            {concessions.loading ? <div style={{ padding: 'var(--s-5)' }}><Skeleton h={12} /></div>
              : concessions.error ? <div className="card-body"><ErrorState title="Could not load discounts and waivers" sub={friendly(concessions.error)} onRetry={concessions.retry} /></div>
                : (
                  <DataTable
                    rows={concessions.data ?? []}
                    rowKey={(c: LiveConcession) => c.id}
                    empty={<Empty icon={<Icon.Scale size={22} />} title="No discounts or waivers" sub="Request one to reduce a student's fee with an audit trail." />}
                    columns={[
                      { key: 'student', label: 'Student', render: (c: LiveConcession) => <div><div>{c.student_name ?? '—'}</div><div className="u-xs u-faint">{c.grade ? gradeLabel(classAndSection(c.grade, c.section)) : ''}</div></div> },
                      { key: 'kind', label: 'Kind', render: (c: LiveConcession) => <Badge tone="outline">{c.kind === 'concession' ? 'Discount or waiver' : humanize(c.kind)}</Badge> },
                      { key: 'towards', label: 'Towards', render: (c: LiveConcession) => <span className="u-small u-muted">{c.obligation_label ?? 'Student-level'}</span> },
                      { key: 'amount', label: 'Amount', align: 'right', render: (c: LiveConcession) => <span className="tnum">{c.amount_cents != null ? fmtMoney(c.amount_cents / 100) : c.percent != null ? `${c.percent}%` : '—'}</span> },
                      { key: 'status', label: 'Status', align: 'right', render: (c: LiveConcession) => c.status === 'approved' || c.status === 'active' ? <Badge tone="success" dot>{statusLabel(c.status)}</Badge> : c.status === 'rejected' ? <Badge tone="danger" dot>Rejected</Badge> : <Badge tone="warning" dot>Requested</Badge> },
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
          sub="Percentage of billed amount collected, computed from the fee records across every student. Below 80% is highlighted for follow-up."
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
                  Classes under 80% usually track transport disruption or pending discounts or waivers — follow up before adding late fees.
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
        title="Void this fee due?"
        sub={voidRow ? `${voidRow.studentName} · ${voidRow.term} ${voidRow.category} · ${fmtMoney(voidRow.amount - voidRow.paidAmount)} outstanding` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setVoidRow(null)} disabled={voiding}>Cancel</Button>
            <Button variant="danger" loading={voiding} onClick={voidObligation}>Void permanently</Button>
          </>
        }
      >
        <p className="u-small u-muted" style={{ marginTop: 0, lineHeight: 1.65 }}>
          Voiding marks the fee record void on the school's records — it is never deleted and the action is audited with your name.
          Any payments already recorded against this fee stay in the records; only the outstanding amount stops being collectible.
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
          The full remaining amount is returned and the fee due is recomputed. A refund at or above the approval
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
        title="Request a discount or waiver"
        sub="A second authorized person approves it before the fee due is reduced."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConOpen(false)} disabled={!!conBusy}>Cancel</Button>
            <Button variant="primary" loading={conBusy === 'create'} onClick={createConcession}>Request</Button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="con-student">Student ID</label>
          <input id="con-student" className="input" value={conForm.studentId} onChange={e => setConForm(f => ({ ...f, studentId: e.target.value }))} placeholder="00000000-0000-0000-0000-000000000000" />
        </div>
        <div className="field">
          <label htmlFor="con-kind">Kind</label>
          <select id="con-kind" className="input" value={conForm.kind} onChange={e => setConForm(f => ({ ...f, kind: e.target.value }))}>
            <option value="concession">Discount or waiver</option>
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
