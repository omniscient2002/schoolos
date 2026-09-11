/* ============================================================
   Fees — the school's money desk.
   T402: the ledger reads the real door (GET /fees/obligations) and
   payment actions run the real rails — POST /fees/payments
   (initiate) plus POST /fees/payments/:id/confirm (manual
   settlement, finance/owner only). Nothing flips state in RAM; a
   success toast only appears after 2xx from the server, and it
   quotes the receipt the server issued. Roles without payment
   authority see the ledger read-only with a plain-language reason.
   The demo build (VITE_DEMO_MODE) keeps the demo blob behaviour,
   clearly separated below.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FeePlans from './finance/FeePlans';
import { useStore } from '../state/store';
import * as seed from '../data/dataset';
import { apiFeeObligations, apiGet, apiPost, apiVoidObligation } from '../services/liveApi';
import { DEMO_MODE } from '../lib/demoMode';
import { friendly } from '../lib/friendlyErrors';
import {
  PageHead, Section, Card, Stat, Badge, DataTable, Tabs, Button, useToast,
  Drawer, Empty, ErrorState, Skeleton, SkeletonCard, KeyValue, Progress, Modal,
} from '../components/ui';
import { EvidenceChain, AiTraceCard } from '../components/Ai';
import { LineChart, BarChart, SegmentedBar, Donut } from '../components/Chart';
import { Icon } from '../components/Icon';
import { fmtMoney, fmtMoneyShort, fmtPct, fmtDate, fmtDateShort } from '../lib/format';
import type { CampusId, FeeObligation, Payment, FeeStatus } from '../types/domain';

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

/* ---------- shared helpers (demo branch) ---------- */
const TREND = [88, 87, 89, 90, 91, 88, 86, 85, 84, 83, 85, 84, 83, 82.3];

const FEE_TRACE = {
  trigger: 'Detected collection dip > 2pts vs 4-week average (weekly fee review)',
  policy: 'Read-only analysis · Fees §4.3 retry posture · no automated collection actions',
  dataUsed: ['fees records (14 days)', 'gateway settlement file', 'transport incident timeline', 'route roster'],
  reasoningRole: 'Investigator (read-only)',
  action: 'None — analysis only; retry actions below stay with Finance',
  approvalStatus: 'Not required (read-only)',
  verification: 'Trend and clusters recomputed from obligations and payments; figures match ledger diff',
  model: 'Frontier (reasoning) · ap-south-1',
  latencyMs: 860,
  tokens: 1310,
  cost: '₹0.11',
};

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

/* Unified row shape across the live and demo data planes */
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

/* ---------- record-payment modal (live rails, two doors, one intent) ---------- */
function RecordPaymentModal({ row, onClose, onDone }: {
  row: FeeRow | null; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const { actorName, session } = useStore();
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  if (!row) return null;
  const due = Math.max(0, row.amount - row.paidAmount);

  const record = async () => {
    setBusy(true);
    try {
      /* Door 1 — initiate (roles: parent/finance/owner/principal). */
      const init = await apiPost<{ payment: { id: string } }>('/fees/payments', { obligationId: row.id, method: 'upi' });
      /* Door 2 — manual settlement (roles: finance/owner). The gateway
         reference is optional; the server audits a bare confirm as
         "manual reconciliation" either way — nothing here is invented. */
      const conf = await apiPost<{ payment: { receipt_no: string | null }, obligation: { status: string } }>(
        `/fees/payments/${init.payment.id}/confirm`, ref.trim() ? { gatewayRef: ref.trim() } : {});
      toast({
        title: `Payment recorded — receipt ${conf.payment.receipt_no ?? 'issued'}`,
        sub: `${fmtMoney(due)} against ${row.studentName} · ${row.term} ${row.category} · obligation now ${conf.obligation.status}.`,
        tone: 'success',
      });
      onDone();
      onClose();
    } catch (e) {
      toast({ title: 'Could not record the payment', sub: friendly(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Record a payment"
      sub={`${row.studentName} · ${row.term} ${row.category} · outstanding ${fmtMoney(due)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={record}>Record payment</Button>
        </>
      }
    >
      <div className="u-col" style={{ gap: 12 }}>
        <p className="u-small u-muted" style={{ margin: 0 }}>
          This initiates the payment and immediately records its settlement against the ledger
          (manual reconciliation). Use it when the money has actually arrived — the UPI intent,
          gateway webhook or bank statement is your proof. Every entry is audited with your name
          ({actorName}, {session.roleId}).
        </p>
        <label className="u-col u-small" style={{ gap: 6 }}>
          <span>Gateway / UPI reference <span className="u-faint">(optional — from your gateway dashboard or bank statement)</span></span>
          <input className="input" value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. UPI-4821… or RZP-…" />
        </label>
      </div>
    </Modal>
  );
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

/* ---------- demo drawer (demo build only) ---------- */
function StudentFeeDrawer({ obligation, onClose, onRetry }: {
  obligation: FeeObligation | null; onClose: () => void; onRetry: (id: string) => void;
}) {
  const { session } = useStore();
  if (!obligation) return null;
  const student = seed.findPerson(obligation.studentId);
  const summary = seed.studentFeeSummary(obligation.studentId);
  const section = student ? seed.sectionOfStudent(student) : undefined;
  return (
    <Drawer
      open={!!obligation}
      onClose={onClose}
      title={student?.name ?? obligation.studentId}
      sub={student ? `Grade ${student.grade}-${student.section} · ${section ? seed.campuses.find(c => c.id === section.campus)?.name : ''} · Admission ${student.admissionNo ?? '—'}` : undefined}
      footer={
        summary.hasFailed ? (
          <Button variant="primary" icon={<Icon.Refresh size={14} />} onClick={() => onRetry(obligation.id)}>
            Record retry — failed mandate
          </Button>
        ) : (
          <span className="u-small u-muted">No failed mandates on this student's account. Retries apply to failed online payments only (Fees §4.3).</span>
        )
      }
    >
      <div className="u-col" style={{ gap: 18 }}>
        <div className="grid grid-3">
          <Stat label="Outstanding" value={fmtMoneyShort(summary.due)} sub="Due + overdue, this term" />
          <Stat label="Overdue" value={fmtMoneyShort(summary.overdue)} sub={summary.overdue > 0 ? 'Late fee paused (retry window)' : 'Nothing overdue'} />
          <Stat label="Paid this term" value={fmtMoneyShort(summary.paid)} sub="All successful payments" />
        </div>

        <div>
          <div className="u-upper" style={{ marginBottom: 8 }}>What's owed</div>
          <div className="u-col" style={{ gap: 8 }}>
            {summary.items.map(it => (
              <div key={it.id} className="u-between" style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: it.id === obligation.id ? 'var(--accent-weak)' : 'var(--surface)' }}>
                <div>
                  <div style={{ fontWeight: 580 }}>{it.term} · {it.category}</div>
                  <div className="u-small u-muted" style={{ marginTop: 2 }}>
                    Due {fmtDate(it.dueDate)}{it.method ? ` · ${it.method}` : ''}{it.failureReason ? ` · ${it.failureReason}` : ''}
                  </div>
                </div>
                <div className="u-col" style={{ alignItems: 'flex-end', gap: 4 }}>
                  <span className="tnum">{fmtMoney(it.amount)}</span>
                  {statusBadge(it.status)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <KeyValue
          items={[
            { k: 'Bus route', v: student?.busRoute ?? 'Not on transport' },
            { k: 'Guardians', v: `${seed.guardiansOfStudent(obligation.studentId).length} linked · ${seed.guardiansOfStudent(obligation.studentId).filter(g => g.link.verified).length} verified` },
            { k: 'Attendance (30d)', v: `${seed.studentAttendanceRate(obligation.studentId).rate}%` },
            { k: 'Viewing as', v: <span className="u-small">{session.roleId}</span> },
          ]}
        />
      </div>
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
  status: (o.status ?? 'open') as RowStatus,
});

/* ============================================================ */

type TabId = 'ledger' | 'payments' | 'failed' | 'byclass' | 'plans';

export default function Fees() {
  const navigate = useNavigate();
  const { session, dispatch, actorName } = useStore();
  const toast = useToast();
  const campus = session.activeCampus as CampusId | 'all'; // demo plane filters 'all'; live plane is tenant-wide

  const [tab, setTab] = useState<TabId>('ledger');
  const [statusFilter, setStatusFilter] = useState<'all' | RowStatus>('all');
  const [selected, setSelected] = useState<FeeObligation | null>(null);   /* demo drawer */
  const [selectedId, setSelectedId] = useState<string | null>(null);      /* live drawer */
  const [payRow, setPayRow] = useState<FeeRow | null>(null);              /* record-payment modal */
  const [voidRow, setVoidRow] = useState<FeeRow | null>(null);            /* void confirm (owner) */
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  /* Payment authority mirrors the doors exactly:
     initiate → parent/finance/owner/principal; confirm → finance/owner. */
  const canInitiate = ['finance', 'owner', 'principal'].includes(session.roleId);
  const canConfirm = ['finance', 'owner'].includes(session.roleId);

  const obligations = useAsync<FeeRow[]>(async () => {
    if (DEMO_MODE) {
      /* demo plane inline (parity gate L4-5.1): no services/index mock import —
         the same seed-blob logic, local to this screen */
      let demo = seed.feeObligations;
      if (campus !== 'all') {
        const ids = new Set(seed.students.filter(s => s.campus === campus).map(s => s.id));
        demo = demo.filter(f => ids.has(f.studentId));
      }
      return demo.map(f => {
        const st = seed.findPerson(f.studentId);
        return {
          id: f.id, studentId: f.studentId,
          studentName: st?.name ?? f.studentId,
          gradeSection: st ? `Grade ${st.grade}-${st.section}` : '',
          term: f.term, category: f.category,
          amount: f.amount, paidAmount: f.paidAmount,
          dueDate: f.dueDate, status: f.status as RowStatus,
          failureReason: f.failureReason, method: f.method,
        } satisfies FeeRow;
      });
    }
    const res = await apiFeeObligations();
    return (res.obligations ?? []).map(mapRealObligation);
  }, [campus]);

  const payments = useAsync<Payment[] | null>(async () => {
    if (DEMO_MODE) {
      let items = seed.payments;
      if (campus !== 'all') {
        const ids = new Set(seed.students.filter(s => s.campus === campus).map(s => s.id));
        items = items.filter(p => ids.has(p.studentId));
      }
      return items.slice(0, 400);
    }
    /* The server has no payments-list door yet — the tab shows an honest
       empty state instead of pretending. */
    return null;
  }, [campus]);

  const refreshAll = () => { obligations.retry(); payments.retry(); };

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

  const lastPayments = useMemo(() => (payments.data ?? []).slice().sort((a, b) => b.on.getTime() - a.on.getTime()).slice(0, 40), [payments.data]);
  const failedPayments = useMemo(
    () => (payments.data ?? []).filter(p => p.status === 'failed').sort((a, b) => b.on.getTime() - a.on.getTime()),
    [payments.data],
  );

  /* ---- by-class collection % — computed from the rows actually displayed ---- */
  const byClass = useMemo(() => {
    if (!DEMO_MODE) {
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
    }
    const campusIds = new Set(seed.students.filter(s => s.campus === campus).map(s => s.id));
    const billed = new Map<number, number>();
    const paid = new Map<number, number>();
    seed.feeObligations.forEach(f => {
      if (!campusIds.has(f.studentId)) return;
      const st = seed.findPerson(f.studentId);
      const g = st?.grade ?? 0;
      billed.set(g, (billed.get(g) ?? 0) + f.amount);
      paid.set(g, (paid.get(g) ?? 0) + f.paidAmount);
    });
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      .map(g => ({ grade: g, pct: billed.get(g) ? Math.round(((paid.get(g) ?? 0) / billed.get(g)!) * 1000) / 10 : 0 }))
      .map(({ grade, pct }) => ({
        label: `Grade ${grade}`,
        value: pct,
        color: pct < 80 ? 'var(--warning)' : 'var(--accent)',
      }));
  }, [campus, obligations.data]);

  const belowAvgClasses = byClass.filter(c => c.value < 80);

  /* ---- actions ---- */
  /* Demo branch keeps the demo-blob retry; the live branch's only write is
     the record-payment modal (initiate + confirm doors). */
  const auditRetry = (id: string, label: string) => {
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId, action: `Recorded payment retry — ${label}`,
        recordType: 'Fee obligation', recordRef: id, reason: 'Failed UPI mandate retried from Fee Intelligence',
        policyRef: 'Fees §4.3 (retry window, no late fee)', aiInvolved: false, risk: 'low',
        outcome: 'Demo session entry — the demo build does not write to the school ledger',
      },
    });
  };

  /* demo-only retry: mutates the demo blob exactly as the old mock plane did —
      every path that reaches it is DEMO_MODE-gated and says so in the toast */
  const demoRecordRetry = (obligationId: string) => {
    const f = seed.feeObligations.find(x => x.id === obligationId);
    if (f) { f.status = 'paid'; f.paidAmount = f.amount; f.paidOn = new Date(); f.method = 'UPI'; }
    return { obligationId, status: 'paid' };
  };

  const retryOne = async (id: string) => {
    setRetryingId(id);
    try {
      demoRecordRetry(id);
      auditRetry(id, 'single mandate');
      toast({ title: 'Retry recorded (demo)', sub: 'Demo world — this retry is not connected to school records.', tone: 'info' });
      setSelected(null);
      refreshAll();
    } catch {
      toast({ title: 'Retry failed', sub: 'Try again in a few minutes.', tone: 'error' });
    } finally {
      setRetryingId(null);
    }
  };

  const retryAll = async () => {
    const ids = (obligations.data ?? []).filter(f => f.status === 'failed').map(f => f.id);
    setRetryingId('batch');
    try {
      for (const id of ids) demoRecordRetry(id);
      auditRetry(`${ids.length} obligations`, `batch of ${ids.length} failed mandates`);
      toast({ title: `${ids.length} retries queued (demo)`, sub: 'Demo world — batch retries are not connected to school records.', tone: 'info' });
      refreshAll();
    } catch {
      toast({ title: 'Batch retry failed', sub: 'Try again in a few minutes.', tone: 'error' });
    } finally {
      setRetryingId(null);
    }
  };

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
            {!DEMO_MODE && <Badge tone="outline">Live ledger</Badge>}
            {DEMO_MODE && stats.failedCount > 0 && (
              <Button variant="secondary" icon={<Icon.Refresh size={14} />} loading={retryingId === 'batch'} onClick={retryAll}>
                Retry all failed ({stats.failedCount})
              </Button>
            )}
            <Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={refreshAll}>Refresh</Button>
          </>
        }
      />

      {/* ---- Stats ---- */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        {DEMO_MODE ? (
          <>
            <Stat label="Term 2 due" value={fmtMoneyShort(stats.term2Due)} sub="Fees due or overdue, Term 2" />
            <Stat label="Collected" value={fmtPct(stats.collectedPct, 1)} sub="Share of billed amount collected" />
            <Stat label="Overdue" value={fmtMoneyShort(stats.overdueAmt)} sub="Past due date, unpaid" />
            <Stat label="Failed payments" value={stats.failedCount} sub={(obligations.data ?? []).length ? '41 of 47 on Route 7 households' : 'No fee records yet'} onClick={() => setTab('failed')} />
          </>
        ) : (
          <>
            <Stat label="Outstanding" value={fmtMoneyShort(stats.outstanding)} sub={`${stats.openCount} open obligations`} />
            <Stat label="Collected" value={fmtPct(stats.collectedPct, 1)} sub="Share of billed amount collected" />
            <Stat label="Past due date" value={fmtMoneyShort(stats.overdueAmt)} sub="Unpaid and past the due date" />
            <Stat label="Ledger rows" value={(obligations.data ?? []).length} sub="Fee obligations on record" />
          </>
        )}
      </div>

      {/* ---- WHAT CHANGED? (demo narrative — live build computes from the ledger) ---- */}
      {DEMO_MODE && (obligations.data ?? []).length > 0 && <Card pad style={{ marginBottom: 28, borderColor: 'var(--ai-weak-2)' }}>
        <div className="u-col" style={{ gap: 14 }}>
          <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="ai-chip"><Icon.Sparkle size={12} /> What changed?</span>
            <Badge tone="warning" dot>collection {fmtPct(stats.collectedPct, 1)} · this ledger</Badge>
            <span className="u-xs u-faint" style={{ marginLeft: 'auto' }}>Fee review · recomputed from the ledger</span>
          </div>

          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            <div className="u-col" style={{ gap: 10 }}>
              <div className="u-upper">14-day collection trend</div>
              <LineChart
                series={[{ name: 'Collection %', color: 'var(--accent)', points: TREND }]}
                labels={TREND.map((_, i) => (i % 2 === 0 ? `d-${TREND.length - 1 - i}` : ''))}
                yFormat={v => `${Math.round(v)}%`}
                area
                min={78}
                max={93}
                height={170}
              />
              <SegmentedBar
                height={10}
                parts={[
                  { value: 41, color: 'var(--danger)', label: 'Route 7 households — 41' },
                  { value: 23, color: 'var(--warning)', label: 'Gateway timeouts — 23' },
                  { value: 6, color: 'var(--border-strong)', label: 'Other — 6' },
                ]}
              />
              <div className="u-flex u-xs u-muted" style={{ gap: 14, flexWrap: 'wrap' }}>
                <span className="u-flex" style={{ gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--danger)' }} /> Route 7 households · 41</span>
                <span className="u-flex" style={{ gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--warning)' }} /> Gateway timeouts · 23</span>
                <span className="u-flex" style={{ gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--border-strong)' }} /> Other · 6</span>
              </div>
            </div>

            <div className="u-col" style={{ gap: 12 }}>
              <EvidenceChain
                title="Cluster breakdown"
                steps={[
                  { label: 'Route 7 households — 41 failures', detail: 'Avg ticket ₹57,457. Households whose week was disrupted by the Bus 14 breakdown (Route 7 — North).', source: 'Gateway + payments record', refType: 'fees' },
                  { label: 'Gateway timeouts — 23', detail: 'UPI payments from 11:00–11:40 yesterday haven\'t shown up in the payments record yet — the bank file is still importing (case_3).', source: 'Payment matching', refType: 'case' },
                  { label: 'Other — 6', detail: 'Bank declines and invalid VPAs; standard assistance workflow wf_4 already messaged these guardians.', source: 'Payment retry log', refType: 'fees' },
                ]}
              />
              <p style={{ margin: 0, fontSize: 'var(--text-md)', lineHeight: 1.65 }}>
                <strong>Reading:</strong> disruption-linked, not affordability-linked. Route 7 families had an abnormal week after the
                Bus 14 breakdown (Transport §3.1), and the 23 timeout transactions are administrative gaps, not payment failures.
                No late fee applies to retries within 5 days (Fees §4.3) — the assistance message draft in the Action Center covers
                41 households, and the settlement import recovers the remaining 23 receipts.
              </p>
              <AiTraceCard trace={FEE_TRACE} />
            </div>
          </div>
        </div>
      </Card>}

      {/* ---- Tabs ---- */}
      <Tabs
        tabs={[
          { id: 'ledger', label: 'Obligations ledger' },
          { id: 'payments', label: 'Payments', count: lastPayments.length },
          ...(DEMO_MODE ? [{ id: 'failed', label: 'Failed payments', count: failedPayments.length }] : []),
          { id: 'byclass', label: 'By class' },
          ...(!DEMO_MODE ? [{ id: 'plans', label: 'Fee plans' }] : []),
        ]}
        active={tab === 'failed' && !DEMO_MODE ? 'ledger' : tab}
        onChange={t => setTab(t as TabId)}
        panelId="fees-tab"
      />

      {/* ---- Ledger ---- */}
      {tab === 'ledger' && (
        <Section role="tabpanel" id="fees-tab-panel-ledger" aria-labelledby="fees-tab-tab-ledger"
          title="Obligations ledger"
          sub={DEMO_MODE
            ? `${filtered.length} obligations · ${seed.campuses.find(c => c.id === campus)?.name}. Row click opens the student fee summary.`
            : `${filtered.length} obligations from the school ledger. Row click opens the student's fee summary.`}
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
                {!DEMO_MODE && <option value="open">Open</option>}
                {!DEMO_MODE && <option value="partial">Part paid</option>}
                <option value="paid">Paid</option>
                {DEMO_MODE && <option value="due">Due</option>}
                {DEMO_MODE && <option value="overdue">Overdue</option>}
                {DEMO_MODE && <option value="failed">Failed</option>}
                {DEMO_MODE && <option value="waived">Waived</option>}
                {!DEMO_MODE && <option value="void">Void</option>}
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
                onRowClick={f => { if (DEMO_MODE) setSelected(f as unknown as FeeObligation); else setSelectedId(f.id); }}
                empty={DEMO_MODE
                  ? <Empty icon={<Icon.Money size={22} />} title="No obligations match this filter" sub="Clear the status filter to see the full ledger." />
                  : <Empty icon={<Icon.Money size={22} />} title="No fee records yet" sub="Obligations appear here once the school records them. Fee plans are created during setup."
                    action={['owner', 'itadmin'].includes(session.roleId)
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
                    },
                  },
                  { key: 'term', label: 'Term', render: f => <span className="u-small">{(f as FeeRow).term.replace(' 2026-27', '')}</span> },
                  { key: 'category', label: 'Category', render: f => <span className="u-small u-muted">{(f as FeeRow).category}</span> },
                  { key: 'amount', label: 'Amount', align: 'right', sortable: true, sortValue: f => (f as FeeRow).amount, render: f => <span className="tnum">{fmtMoney((f as FeeRow).amount)}</span> },
                  { key: 'paid', label: 'Paid', align: 'right', render: f => <span className="tnum u-muted">{(f as FeeRow).paidAmount ? fmtMoney((f as FeeRow).paidAmount) : '—'}</span> },
                  { key: 'dueDate', label: 'Due date', sortable: true, sortValue: f => (f as FeeRow).dueDate?.getTime() ?? 0, render: f => <span className="u-small">{(f as FeeRow).dueDate ? fmtDateShort((f as FeeRow).dueDate as Date) : '—'}</span> },
                  { key: 'status', label: 'Status', align: 'right', render: f => statusBadge((f as FeeRow).status) },
                  ...(!DEMO_MODE ? [{
                    key: 'action', label: '', align: 'right' as const, render: (f: FeeRow) => {
                      const payable = f.status !== 'paid' && f.status !== 'void';
                      if (!payable) return null;
                      return (
                        <span className="u-flex" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          {canConfirm
                            ? <Button size="sm" variant="secondary" icon={<Icon.Money size={12} />} onClick={e => { e.stopPropagation(); setPayRow(f); }}>Record payment</Button>
                            : <Button size="sm" variant="secondary" disabled title={payDisabledReason} icon={<Icon.Money size={12} />} onClick={e => e.stopPropagation()}>Record payment</Button>}
                          {session.roleId === 'owner' && (
                            <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setVoidRow(f); setVoidReason(''); }} title="Void this obligation (owner, audited)">Void</Button>
                          )}
                        </span>
                      );
                    },
                  }] : []),
                ]}
              />
            )}
          </Card>
        </Section>
      )}

      {/* ---- Payments ---- */}
      {tab === 'payments' && (
        <Section role="tabpanel" id="fees-tab-panel-payments" aria-labelledby="fees-tab-tab-payments" title="Payments" sub={DEMO_MODE ? 'Last 40 payments across the ledger — newest first.' : 'Individual payments, newest first.'}>
          <Card>
            {payments.loading ? (
              <div className="grid grid-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
            ) : payments.error ? (
              <div className="card-body"><ErrorState title="Could not load payments" sub={friendly(payments.error)} onRetry={payments.retry} /></div>
            ) : !DEMO_MODE && payments.data === null ? (
              <Empty
                icon={<Icon.CreditCard size={22} />}
                title="Payment history is not wired to this screen yet"
                sub="The school ledger above is live. The itemised payment list needs a server door that is on the backlog — receipts and settlement entries are audited as they happen."
              />
            ) : (
              <DataTable
                rows={lastPayments}
                rowKey={(p: Payment) => p.id}
                empty={<Empty icon={<Icon.CreditCard size={22} />} title="No payments recorded" />}
                columns={[
                  { key: 'on', label: 'Date', render: p => <span className="u-small">{fmtDate(p.on)}</span> },
                  {
                    key: 'student', label: 'Student', render: p => {
                      const st = seed.findPerson(p.studentId);
                      return st?.name ?? p.studentId;
                    },
                  },
                  { key: 'amount', label: 'Amount', align: 'right', render: p => <span className="tnum">{fmtMoney(p.amount)}</span> },
                  { key: 'method', label: 'Method', render: p => <Badge tone="outline">{p.method}</Badge> },
                  { key: 'reference', label: 'Reference', render: p => <span className="mono u-small">{p.reference}</span> },
                  {
                    key: 'status', label: 'Status', align: 'right', render: p => p.status === 'success'
                      ? <Badge tone="success" dot>Success</Badge>
                      : p.status === 'pending'
                        ? <Badge tone="warning" dot>Pending</Badge>
                        : <Badge tone="danger" dot>Failed</Badge>,
                  },
                ]}
              />
            )}
          </Card>
        </Section>
      )}

      {/* ---- Failed (demo build only) ---- */}
      {tab === 'failed' && DEMO_MODE && (
        <Section role="tabpanel" id="fees-tab-panel-failed" aria-labelledby="fees-tab-tab-failed"
          title="Failed payments"
          sub="Retries carry no late fee within 5 days of failure (Fees §4.3). Route 7 households are flagged in the cluster view above."
          actions={
            failedPayments.length > 0 ? (
              <Button variant="primary" size="sm" icon={<Icon.Refresh size={13} />} loading={retryingId === 'batch'} onClick={retryAll}>
                Retry all ({failedPayments.length})
              </Button>
            ) : undefined
          }
        >
          <Card>
            {payments.loading ? (
              <div className="u-col" style={{ gap: 10, padding: 'var(--s-5)' }}><Skeleton h={12} /><Skeleton h={12} /><Skeleton h={12} /></div>
            ) : payments.error ? (
              <div className="card-body"><ErrorState title="Could not load failed payments" sub={friendly(payments.error)} onRetry={payments.retry} /></div>
            ) : (
              <DataTable
                rows={failedPayments}
                rowKey={(p: Payment) => p.id}
                empty={<Empty icon={<Icon.Check size={22} />} title="No failed payments" sub="Every failed mandate has been retried or settled." />}
                columns={[
                  { key: 'on', label: 'Failed on', render: p => <span className="u-small">{fmtDate(p.on)}</span> },
                  {
                    key: 'student', label: 'Student', render: p => {
                      const st = seed.findPerson(p.studentId);
                      return (
                        <div>
                          <div style={{ fontWeight: 570 }}>{st?.name ?? p.studentId}</div>
                          <div className="u-xs u-faint">{st?.busRoute ?? 'No bus route'}</div>
                        </div>
                      );
                    },
                  },
                  { key: 'amount', label: 'Amount', align: 'right', render: p => <span className="tnum">{fmtMoney(p.amount)}</span> },
                  { key: 'method', label: 'Method', render: p => <Badge tone="outline">{p.method}</Badge> },
                  { key: 'reference', label: 'Reference', render: p => <span className="mono u-small">{p.reference}</span> },
                  {
                    key: 'action', label: '', align: 'right', render: p => {
                      const obligation = (obligations.data ?? []).find(f => f.id === p.obligationId);
                      const done = obligation?.status === 'paid';
                      return done
                        ? <Badge tone="success" dot>Settled</Badge>
                        : <Button size="sm" variant="secondary" icon={<Icon.Refresh size={12} />} loading={retryingId === p.obligationId} onClick={() => obligation && retryOne(obligation.id)}>Retry</Button>;
                    },
                  },
                ]}
              />
            )}
          </Card>
        </Section>
      )}

      {/* ---- By class ---- */}
      {tab === 'plans' && !DEMO_MODE && (
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
                  {DEMO_MODE
                    ? 'Classes under 80% usually track transport disruption or pending concessions. The fee-review meeting (meet_2) agreed: no late fee for retries by Friday, and a single assistance message per household.'
                    : 'Classes under 80% usually track transport disruption or pending concessions — follow up before adding late fees.'}
                </div>
                <Donut
                  size={116}
                  thickness={13}
                  centerLabel={fmtPct(stats.collectedPct, 1)}
                  centerSub="collected"
                  segments={[
                    { label: 'Collected', value: stats.collectedPct, color: 'var(--accent)' },
                    { label: 'Outstanding', value: Math.max(0, 100 - stats.collectedPct), color: 'var(--warning-weak-2)' },
                  ]}
                />
              </div>
            </Card>
          </div>
        </Section>
      )}

      {DEMO_MODE
        ? <StudentFeeDrawer obligation={selected} onClose={() => setSelected(null)} onRetry={retryOne} />
        : <StudentFeeDrawerLive studentId={selectedId} onClose={() => setSelectedId(null)} canPay={canConfirm} onRecord={setPayRow} />}

      {!DEMO_MODE && (
        <RecordPaymentModal
          row={payRow}
          onClose={() => setPayRow(null)}
          onDone={refreshAll}
        />
      )}

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
    </div>
  );
}
