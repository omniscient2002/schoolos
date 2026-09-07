/* ============================================================
   Fees — Fee Intelligence. The WHAT CHANGED? surface: a 4.7pt
   collection dip with a full evidence chain (trend, clusters,
   reading) and trace. Below: the live ledger, payments, failed
   payments with retry, and collection by class.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import * as seed from '../data/dataset';
import { feeService } from '../services';
import {
  PageHead, Section, Card, Stat, Badge, DataTable, Tabs, Button, useToast,
  Drawer, Empty, ErrorState, Skeleton, SkeletonCard, KeyValue, Progress,
} from '../components/ui';
import { EvidenceChain, AiTraceCard } from '../components/Ai';
import { LineChart, BarChart, SegmentedBar, Donut } from '../components/Chart';
import { Icon } from '../components/Icon';
import { fmtMoney, fmtMoneyShort, fmtPct, fmtDate, fmtDateShort } from '../lib/format';
import type { FeeObligation, Payment, FeeStatus } from '../types/domain';

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

/* ---------- shared helpers ---------- */
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

function statusBadge(s: FeeStatus) {
  switch (s) {
    case 'paid': return <Badge tone="success" dot>Paid</Badge>;
    case 'due': return <Badge tone="info" dot>Due</Badge>;
    case 'overdue': return <Badge tone="warning" dot>Overdue</Badge>;
    case 'failed': return <Badge tone="danger" dot>Failed</Badge>;
    case 'waived': return <Badge tone="outline">Waived</Badge>;
  }
}

/* ---------- student drawer ---------- */
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

/* ============================================================ */

type TabId = 'ledger' | 'payments' | 'failed' | 'byclass';

export default function Fees() {
  const { session, dispatch, actorName } = useStore();
  const toast = useToast();
  const campus = session.activeCampus;

  const [tab, setTab] = useState<TabId>('ledger');
  const [statusFilter, setStatusFilter] = useState<'all' | FeeStatus>('all');
  const [selected, setSelected] = useState<FeeObligation | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const obligations = useAsync(() => feeService.obligations(campus), [campus]);
  const payments = useAsync(() => feeService.payments(campus), [campus]);

  const stats = useMemo(() => {
    const items = obligations.data ?? [];
    const billed = items.reduce((a, f) => a + f.amount, 0);
    const paid = items.reduce((a, f) => a + f.paidAmount, 0);
    const collectedPct = billed ? Math.round((paid / billed) * 1000) / 10 : 0;
    const term2Due = items.filter(f => f.term.startsWith('Term 2') && (f.status === 'due' || f.status === 'overdue')).reduce((a, f) => a + (f.amount - f.paidAmount), 0);
    const overdueAmt = items.filter(f => f.status === 'overdue').reduce((a, f) => a + (f.amount - f.paidAmount), 0);
    const failedCount = items.filter(f => f.status === 'failed').length;
    return { billed, collectedPct, term2Due, overdueAmt, failedCount };
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

  /* ---- by-class collection % (computed from seed across seed.students, grouped by grade) ---- */
  const byClass = useMemo(() => {
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
  }, [campus]);

  const belowAvgClasses = byClass.filter(c => c.value < 80);

  /* ---- actions ---- */
  const auditRetry = (id: string, label: string) => {
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId, action: `Recorded payment retry — ${label}`,
        recordType: 'Fee obligation', recordRef: id, reason: 'Failed UPI mandate retried from Fee Intelligence',
        policyRef: 'Fees §4.3 (retry window, no late fee)', aiInvolved: false, risk: 'low',
        outcome: 'Gateway retry queued · ledger updates on settlement',
      },
    });
  };

  const retryOne = async (id: string) => {
    setRetryingId(id);
    try {
      await feeService.recordRetry(id);
      auditRetry(id, 'single mandate');
      toast({ title: 'Retry recorded', sub: 'Payment re-initiated via UPI; ledger updates on settlement.', tone: 'success' });
      setSelected(null);
      obligations.retry();
      payments.retry();
    } catch {
      toast({ title: 'Retry failed', sub: 'Gateway did not accept the retry. Try again in a few minutes.', tone: 'error' });
    } finally {
      setRetryingId(null);
    }
  };

  const retryAll = async () => {
    const ids = (obligations.data ?? []).filter(f => f.status === 'failed').map(f => f.id);
    setRetryingId('batch');
    try {
      for (const id of ids) await feeService.recordRetry(id);
      auditRetry(`${ids.length} obligations`, `batch of ${ids.length} failed mandates`);
      toast({ title: `${ids.length} retries queued`, sub: 'Retry sent to the payment gateway. Anything that fails again opens a case for the finance desk.', tone: 'success' });
      obligations.retry();
      payments.retry();
    } catch {
      toast({ title: 'Batch retry failed', sub: 'Gateway did not accept the batch. Try again in a few minutes.', tone: 'error' });
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div>
      <PageHead
        title="Fee Intelligence"
        sub="Money received, failed payments and class-level collection — with the proof behind every number."
        actions={
          <>
            {stats.failedCount > 0 && (
              <Button variant="secondary" icon={<Icon.Refresh size={14} />} loading={retryingId === 'batch'} onClick={retryAll}>
                Retry all failed ({stats.failedCount})
              </Button>
            )}
            <Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={obligations.retry}>Refresh</Button>
          </>
        }
      />

      {/* ---- Stats ---- */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <Stat label="Term 2 due" value={fmtMoneyShort(stats.term2Due)} sub="Fees due or overdue, Term 2" />
        <Stat label="Collected" value={fmtPct(stats.collectedPct, 1)} delta={{ value: `${fmtPct(stats.collectedPct - 88, 1)} vs avg`, dir: stats.collectedPct >= 88 ? 'up' : 'down' }} sub="88% is the 4-week average" />
        <Stat label="Overdue" value={fmtMoneyShort(stats.overdueAmt)} sub="Past due date, unpaid" />
        <Stat label="Failed payments" value={stats.failedCount} sub="41 of 47 on Route 7 households" onClick={() => setTab('failed')} />
      </div>

      {/* ---- WHAT CHANGED? ---- */}
      <Card pad style={{ marginBottom: 28, borderColor: 'var(--ai-weak-2)' }}>
        <div className="u-col" style={{ gap: 14 }}>
          <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="ai-chip"><Icon.Sparkle size={12} /> What changed?</span>
            <Badge tone="warning" dot>collection 82.3% vs 88% avg</Badge>
            <span className="u-xs u-faint" style={{ marginLeft: 'auto' }}>Fee review · recomputed hourly from the ledger</span>
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
      </Card>

      {/* ---- Tabs ---- */}
      <Tabs
        tabs={[
          { id: 'ledger', label: 'Obligations ledger' },
          { id: 'payments', label: 'Payments', count: lastPayments.length },
          { id: 'failed', label: 'Failed payments', count: failedPayments.length },
          { id: 'byclass', label: 'By class' },
        ]}
        active={tab}
        onChange={t => setTab(t as TabId)}
        panelId="fees-tab"
      />

      {/* ---- Ledger ---- */}
      {tab === 'ledger' && (
        <Section role="tabpanel" id="fees-tab-panel-ledger" aria-labelledby="fees-tab-tab-ledger"
          title="Obligations ledger"
          sub={`${filtered.length} obligations · ${seed.campuses.find(c => c.id === campus)?.name}. Row click opens the student fee summary.`}
          actions={
            <div className="u-flex" style={{ gap: 8 }}>
              <label className="u-small u-muted" htmlFor="fee-status-filter">Status</label>
              <select
                id="fee-status-filter"
                className="input"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as 'all' | FeeStatus)}
                style={{ maxWidth: 160 }}
              >
                <option value="all">All statuses</option>
                <option value="paid">Paid</option>
                <option value="due">Due</option>
                <option value="overdue">Overdue</option>
                <option value="failed">Failed</option>
                <option value="waived">Waived</option>
              </select>
            </div>
          }
        >
          <Card>
            {obligations.loading ? (
              <div className="u-col" style={{ gap: 10, padding: 'var(--s-5)' }}><Skeleton h={12} /><Skeleton h={12} /><Skeleton h={12} /><Skeleton h={12} /></div>
            ) : obligations.error ? (
              <div className="card-body"><ErrorState title="Could not load the ledger" sub={obligations.error} onRetry={obligations.retry} /></div>
            ) : (
              <DataTable
                caption="Fee obligations ledger — amount, status and action per student"
                rows={filtered.slice(0, 60)}
                rowKey={f => f.id}
                onRowClick={f => setSelected(f)}
                empty={<Empty icon={<Icon.Money size={22} />} title="No obligations match this filter" sub="Clear the status filter to see the full ledger." />}
                columns={[
                  {
                    key: 'student', label: 'Student', sortable: true, sortValue: f => seed.findPerson(f.studentId)?.name ?? f.studentId, render: f => {
                      const st = seed.findPerson(f.studentId);
                      return (
                        <div>
                          <div style={{ fontWeight: 570 }}>{st?.name ?? f.studentId}</div>
                          <div className="u-xs u-faint">{st ? `Grade ${st.grade}-${st.section}` : ''}</div>
                        </div>
                      );
                    },
                  },
                  { key: 'term', label: 'Term', render: f => <span className="u-small">{f.term.replace(' 2026-27', '')}</span> },
                  { key: 'category', label: 'Category', render: f => <span className="u-small u-muted">{f.category}</span> },
                  { key: 'amount', label: 'Amount', align: 'right', sortable: true, sortValue: f => f.amount, render: f => <span className="tnum">{fmtMoney(f.amount)}</span> },
                  { key: 'paid', label: 'Paid', align: 'right', render: f => <span className="tnum u-muted">{f.paidAmount ? fmtMoney(f.paidAmount) : '—'}</span> },
                  { key: 'dueDate', label: 'Due date', sortable: true, sortValue: f => f.dueDate.getTime(), render: f => <span className="u-small">{fmtDateShort(f.dueDate)}</span> },
                  { key: 'status', label: 'Status', align: 'right', render: f => statusBadge(f.status) },
                ]}
              />
            )}
          </Card>
        </Section>
      )}

      {/* ---- Payments ---- */}
      {tab === 'payments' && (
        <Section role="tabpanel" id="fees-tab-panel-payments" aria-labelledby="fees-tab-tab-payments" title="Payments" sub="Last 40 payments across the ledger — newest first.">
          <Card>
            {payments.loading ? (
              <div className="grid grid-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
            ) : payments.error ? (
              <div className="card-body"><ErrorState title="Could not load payments" sub={payments.error} onRetry={payments.retry} /></div>
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

      {/* ---- Failed ---- */}
      {tab === 'failed' && (
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
              <div className="card-body"><ErrorState title="Could not load failed payments" sub={payments.error} onRetry={payments.retry} /></div>
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
      {tab === 'byclass' && (
        <Section role="tabpanel" id="fees-tab-panel-byclass" aria-labelledby="fees-tab-tab-byclass"
          title="Collection by class"
          sub="Percentage of billed amount collected, computed from the ledger across every student on this campus. Below 80% is highlighted for follow-up."
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
                  Classes under 80% usually track transport disruption or pending concessions. The fee-review meeting (meet_2)
                  agreed: no late fee for retries by Friday, and a single assistance message per household.
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

      <StudentFeeDrawer obligation={selected} onClose={() => setSelected(null)} onRetry={retryOne} />
    </div>
  );
}
