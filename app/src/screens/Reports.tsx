/* ============================================================
   Reports — Wave-4 BI surfaces (L4-4.2, door-backed).
   All three reports read the ops.bi read-model doors (L3-4.3):
     GET /plugins/ops.bi/attendance  · /fees/aging  · /funnel
   Every chart is labelled with its door. The doors cache reads
   (cacheSeconds) — the label says so. Empty states are honest:
   a new school with no data sees "no data yet", not zeroes
   dressed up as insight.
   ============================================================ */
import { useEffect, useState } from 'react';
import { apiBiAttendance, apiBiAging, apiBiFunnel } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { PageHead, Card, Badge, Button, Empty, Stat, SkeletonCard, ErrorState, DataTable, Tabs } from '../components/ui';
import { BarChart, Donut } from '../components/Chart';
import { Icon } from '../components/Icon';
import { fmtMoney } from '../lib/format';

/* local async hook */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => { if (live) setState({ data: d, loading: false, error: null }); })
      .catch(e => { if (live) setState({ data: null, loading: false, error: String(e) }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

/* ---------- attendance by class (GET /plugins/ops.bi/attendance) ---------- */
interface BiClass { grade: string; section: string; marks: number; present: number; late: number; absent: number; leave: number; pct: number | null }
interface BiAttendance { window: { days: number; tz: string }; byClass: BiClass[]; belowThreshold: { studentId: string; name: string; pct: number | null }[]; capped: boolean; cacheSeconds: number }

function AttendanceByClass() {
  const [days, setDays] = useState(30);
  const att = useAsync<BiAttendance>(async () => {
    const res = await apiBiAttendance(days);
    return res as unknown as BiAttendance;
  }, [days]);

  const byClass = (att.data?.byClass ?? []).map(c => ({
    cls: `${c.grade}-${c.section}`,
    pct: Math.round(Number(c.pct ?? 0)),
    marks: c.marks,
    attended: c.present + c.late,
  })).sort((a, b) => a.cls.localeCompare(b.cls, undefined, { numeric: true }));
  const avg = byClass.length ? Math.round(byClass.reduce((a, b) => a + b.pct, 0) / byClass.length) : null;

  return (
    <Card pad>
      <div className="u-between u-wrap" style={{ gap: 10, marginBottom: 10 }}>
        <div className="u-col" style={{ gap: 2 }}>
          <span style={{ fontWeight: 620 }}>Attendance by class</span>
          <span className="u-xs u-faint">Source: GET /plugins/ops.bi/attendance ({att.data?.window?.days ?? days}-day window, {att.data?.window?.tz ?? 'Asia/Kolkata'} · present + late count as attended · cached {att.data?.cacheSeconds ?? '—'}s on the server)</span>
        </div>
        <div className="u-flex" style={{ gap: 8 }}>
          <select className="select" value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Window" style={{ width: 150 }}>
            {[7, 30, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <Button size="sm" variant="ghost" icon={<Icon.Refresh size={12} />} onClick={att.retry}>Reload</Button>
        </div>
      </div>
      {att.loading ? <SkeletonCard lines={3} />
        : att.error ? <ErrorState title="Could not load attendance" sub={friendly(att.error)} onRetry={att.retry} />
        : byClass.length === 0 ? (
          <Empty icon={<Icon.Calendar size={22} />} title={`No register data in the last ${days} days`} sub="Either no register has been submitted in this window or the school has no attendance rows yet — no chart is invented." />
        ) : (
          <div className="u-col" style={{ gap: 12 }}>
            <Stat label="School-wide attendance" value={avg != null ? `${avg}%` : '—'} sub={`${byClass.length} classes reporting · ${att.data && att.data.belowThreshold.length > 0 ? `${att.data.belowThreshold.length} student(s) below 75%` : 'no students below threshold'}`} />
            <BarChart
              data={byClass.map(c => ({ label: c.cls, value: c.pct }))}
              height={170}
            />
            <DataTable
              rows={byClass}
              rowKey={c => c.cls}
              columns={[
                { key: 'cls', label: 'Class' },
                { key: 'attended', label: 'Attended', render: c => `${c.attended} of ${c.marks}` },
                { key: 'pct', label: 'Attendance', align: 'right' as const, render: c => <Badge tone={c.pct >= 90 ? 'success' : c.pct >= 75 ? 'info' : 'warning'}>{c.pct}%</Badge> },
              ]}
            />
          </div>
        )}
    </Card>
  );
}

/* ---------- fee ageing (GET /plugins/ops.bi/fees/aging) ---------- */
interface AgingBucket { term: string; not_due: number; d1_7: number; d8_30: number; d31_90: number; d90p: number; c1_7: string; c8_30: string; c31_90: string; c90p: string }
interface AgingDebtor { id: string; name: string; admission_no: string; grade: string; section: string; term: string; label: string; amount_cents: string | number; paid_cents: string | number; outstanding_cents: string | number; days_over: number }
interface BiAging { buckets: AgingBucket[]; oldestFirst: AgingDebtor[]; capped: boolean; rowCap: number; cacheSeconds: number }

function FeeAgeing() {
  const aging = useAsync<BiAging>(async () => {
    const res = await apiBiAging();
    return res as unknown as BiAging;
  }, []);

  const buckets = aging.data?.buckets ?? [];
  const cents = (b: AgingBucket) => Number(b.c1_7) + Number(b.c8_30) + Number(b.c31_90) + Number(b.c90p);
  const totalOverdue = buckets.reduce((a, b) => a + cents(b), 0);
  const worst = (aging.data?.oldestFirst ?? []).slice(0, 8);

  return (
    <Card pad>
      <div className="u-col" style={{ gap: 2, marginBottom: 10 }}>
        <span style={{ fontWeight: 620 }}>Fee ageing — overdue by bucket and term</span>
        <span className="u-xs u-faint">Source: GET /plugins/ops.bi/fees/aging · overdue = past due_on with unpaid balance and not void · cached {aging.data?.cacheSeconds ?? '—'}s on the server</span>
      </div>
      {aging.loading ? <SkeletonCard lines={3} />
        : aging.error ? <ErrorState title="Could not load the ageing report" sub={friendly(aging.error)} onRetry={aging.retry} />
        : buckets.length === 0 || totalOverdue === 0 ? (
          <Empty icon={<Icon.Money size={22} />} title="Nothing overdue" sub="Either the ledger has no obligations yet or every obligation is paid or not yet due — the report shows the door's own answer, never a guess." />
        ) : (
          <div className="u-col" style={{ gap: 12 }}>
            <div className="grid grid-3">
              <Stat label="Overdue (all terms)" value={fmtMoney(totalOverdue)} sub={`${buckets.length} term(s) with overdue rows`} />
              <Stat label="1–30 days" value={fmtMoney(buckets.reduce((a, b) => a + Number(b.c1_7) + Number(b.c8_30), 0))} sub="Fresh overdue" />
              <Stat label="90+ days" value={fmtMoney(buckets.reduce((a, b) => a + Number(b.c90p), 0))} sub="Escalation territory" />
            </div>
            {buckets.map(b => (
              <div key={b.term} className="u-col" style={{ gap: 6 }}>
                <div className="u-between u-small">
                  <span style={{ fontWeight: 620 }}>Term {b.term}</span>
                  <span className="u-faint">not yet due: {b.not_due} obligation(s)</span>
                </div>
                <Donut
                  size={130}
                  thickness={15}
                  centerLabel={fmtMoney(cents(b))}
                  centerSub="overdue"
                  segments={[
                    { label: '1–7 days', value: Number(b.c1_7), color: 'var(--warning)' },
                    { label: '8–30 days', value: Number(b.c8_30), color: '#d97706' },
                    { label: '31–90 days', value: Number(b.c31_90), color: 'var(--danger)' },
                    { label: '90+ days', value: Number(b.c90p), color: '#7f1d1d' },
                  ].filter(s => s.value > 0)}
                />
              </div>
            ))}
            {worst.length > 0 && (
              <>
                <span className="u-xs u-faint">Oldest debtors first — the door's own ordering{aging.data?.capped ? ` (capped at ${aging.data.rowCap} rows)` : ''}:</span>
                <DataTable
                  rows={worst}
                  rowKey={d => d.id}
                  columns={[
                    { key: 'name', label: 'Student', render: d => <span>{d.name} <span className="u-xs u-faint">{d.admission_no} · {d.grade}-{d.section}</span></span> },
                    { key: 'label', label: 'Obligation', render: d => `${d.label} · term ${d.term}` },
                    { key: 'days_over', label: 'Days over', align: 'right' as const, render: d => <Badge tone={d.days_over > 90 ? 'danger' : d.days_over > 30 ? 'warning' : 'info'}>{d.days_over}</Badge> },
                    { key: 'outstanding_cents', label: 'Outstanding', align: 'right' as const, render: d => fmtMoney(Number(d.outstanding_cents)) },
                  ]}
                />
              </>
            )}
          </div>
        )}
    </Card>
  );
}

/* ---------- admissions funnel (GET /plugins/ops.bi/funnel) ---------- */
interface BiFunnel {
  totalLeads: number;
  byStage: { stage: string; leads: number; sharePct: number }[];
  enrolledPct: number;
  dropped: number;
  avgDaysInStage: Record<string, number>;
  cacheSeconds: number;
}

function FunnelConversion() {
  const funnel = useAsync<BiFunnel>(async () => {
    const res = await apiBiFunnel();
    return res as unknown as BiFunnel;
  }, []);

  const stages = funnel.data?.byStage ?? [];
  const total = funnel.data?.totalLeads ?? 0;

  return (
    <Card pad>
      <div className="u-col" style={{ gap: 2, marginBottom: 10 }}>
        <span style={{ fontWeight: 620 }}>Admissions funnel</span>
        <span className="u-xs u-faint">Source: GET /plugins/ops.bi/funnel · the door's own stage counts, shares and average days-in-stage · cached {funnel.data?.cacheSeconds ?? '—'}s on the server</span>
      </div>
      {funnel.loading ? <SkeletonCard lines={3} />
        : funnel.error ? <ErrorState title="Could not load the funnel" sub={friendly(funnel.error)} onRetry={funnel.retry} />
        : stages.length === 0 ? (
          <Empty icon={<Icon.Graduation size={22} />} title="No leads in the funnel yet" sub="The admissions plugin reports zero leads — the report fills as enquiries arrive." />
        ) : (
          <div className="u-col" style={{ gap: 12 }}>
            <div className="grid grid-3">
              <Stat label="Total leads" value={String(total)} sub="All time" />
              <Stat label="Enrolled" value={`${funnel.data?.enrolledPct ?? 0}%`} sub="End-to-end conversion" />
              <Stat label="Dropped" value={String(funnel.data?.dropped ?? 0)} sub="Lost at any stage" />
            </div>
            <div className="u-col" style={{ gap: 8 }}>
              {stages.map(s => (
                <div key={s.stage} className="u-col" style={{ gap: 3 }}>
                  <div className="u-between u-xs">
                    <span style={{ textTransform: 'capitalize' }}>{s.stage.replace(/_/g, ' ')}</span>
                    <span className="u-faint">
                      {s.leads} lead(s) · {s.sharePct}% of entry
                      {funnel.data?.avgDaysInStage?.[s.stage] != null ? ` · ${funnel.data.avgDaysInStage[s.stage]}d avg in stage` : ''}
                    </span>
                  </div>
                  <div className="bar-track" style={{ height: 10, borderRadius: 999, background: 'var(--border-weak, var(--border))', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, s.sharePct)}%`, height: '100%', background: 'var(--accent)', borderRadius: 999 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
    </Card>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('attendance');

  return (
    <div className="u-col" style={{ gap: 14 }}>
      <PageHead
        title="Reports"
        sub="Every figure comes from the ops.bi read-model doors (L3-4.3) — the door's own aggregations, not client-side estimates."
      />
      <Tabs
        tabs={[
          { id: 'attendance', label: 'Attendance by class' },
          { id: 'fees', label: 'Fee ageing' },
          { id: 'funnel', label: 'Admissions funnel' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'attendance' && <AttendanceByClass />}
      {tab === 'fees' && <FeeAgeing />}
      {tab === 'funnel' && <FunnelConversion />}
    </div>
  );
}
