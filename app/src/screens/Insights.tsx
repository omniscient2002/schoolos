/* ============================================================
   Insights — question-driven analytics home.
   Three seed-computed stats (collection, attendance health,
   workload) and a grid of question cards from seed.insights.
   "Open full analysis" expands the full chart, clusters and
   actions in a drawer.
   Role-aware: the viewer's own domain sorts and highlights first.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import * as seed from '../data/dataset';
import { apiFeesSummary, apiBiAttendance } from '../services/liveApi';
import { roleLabel, statusLabel } from '../lib/labels';
import {PageHead, Card, Stat, Badge, Button, Empty, Skeleton, SkeletonCard, Drawer, useToast, ClickThrough, SampleNote} from '../components/ui';
import { LineChart, BarChart, Sparkline } from '../components/Chart';
import { Icon } from '../components/Icon';
import type { Insight } from '../types/domain';

/* ---------- local async pattern (per APP-SPEC) ---------- */
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

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'ai' | 'accent' | 'outline';

const confTone = (c: Insight['confidence']): BadgeTone => (c === 'high' ? 'success' : 'warning');

function isCategorical(ins: Insight) {
  return ins.chart.labels.length <= 8; // route / teacher comparisons vs time series
}

/* ---------- question card ---------- */
function InsightCard({ ins, highlighted, onOpen }: { ins: Insight; highlighted: boolean; onOpen: () => void }) {
  return (
    <Card
      pad
      onClick={onOpen}
      className="card-click"
    >
      <div className="u-col" style={{ gap: 10, border: highlighted ? '1px solid var(--accent-weak-2)' : undefined, margin: highlighted ? -12 : undefined, padding: highlighted ? 12 : undefined, borderRadius: highlighted ? 'var(--r-lg)' : undefined }}>
        <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {highlighted && <Badge tone="accent" dot>For your role</Badge>}
          <Badge tone={confTone(ins.confidence)}>{statusLabel(ins.confidence)} confidence</Badge>
          <Badge tone="outline">{roleLabel(ins.ownerRole)}</Badge>
        </div>
        <div style={{ fontWeight: 620, fontSize: 'var(--text-lg)', lineHeight: 1.35 }}>{ins.question}</div>
        <div className="u-flex" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span className="u-small u-muted">{ins.metric}</span>
          <span className="u-small" style={{ fontWeight: 640, color: ins.dir === 'down' ? 'var(--danger)' : ins.dir === 'up' ? 'var(--warning)' : 'var(--text-2)' }}>
            {ins.dir === 'down' ? '▼' : ins.dir === 'up' ? '▲' : '•'} {ins.delta}
          </span>
        </div>
        {isCategorical(ins) ? (
          <BarChart
            horizontal
            data={ins.chart.labels.map((l, i) => ({ label: l, value: ins.chart.values[i] }))}
            format={v => String(Math.round(v * 10) / 10)}
          />
        ) : (
          <Sparkline points={ins.chart.values} color={ins.dir === 'down' ? 'var(--danger)' : 'var(--accent)'} height={44} width={260} />
        )}
        <div className="u-small u-muted u-clamp2" style={{ lineHeight: 1.55 }}>{ins.explanation}</div>
        <ClickThrough>
          <Button size="sm" variant="secondary" iconRight={<Icon.ArrowUpRight size={13} />} onClick={onOpen}>Open full analysis</Button>
        </ClickThrough>
      </div>
    </Card>
  );
}

/* ---------- full analysis drawer ---------- */
function AnalysisDrawer({ ins, onClose }: { ins: Insight | null; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  if (!ins) return null;
  return (
    <Drawer open={!!ins} onClose={onClose} title={ins.question} sub={`${ins.metric} · ${ins.delta} · ${statusLabel(ins.confidence)} confidence · owner ${roleLabel(ins.ownerRole)}`}>
      <div className="u-col" style={{ gap: 16 }}>
        {isCategorical(ins) ? (
          <BarChart
            data={ins.chart.labels.map((l, i) => ({ label: l, value: ins.chart.values[i] }))}
            height={190}
            format={v => String(Math.round(v * 10) / 10)}
          />
        ) : (
          <LineChart
            area
            labels={ins.chart.labels}
            series={[{ name: ins.metric, color: ins.dir === 'down' ? 'var(--danger)' : 'var(--accent)', points: ins.chart.values }]}
            yFormat={v => `${Math.round(v * 10) / 10}`}
            height={200}
          />
        )}

        <div>
          <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>Reading</div>
          <p className="u-small" style={{ lineHeight: 1.65, margin: 0 }}>{ins.explanation}</p>
        </div>

        {ins.clusters && ins.clusters.length > 0 && (
          <div>
            <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>Clusters</div>
            <BarChart
              horizontal
              data={ins.clusters.map((c, i) => ({ label: c.label, value: c.value, color: i === 0 ? 'var(--danger)' : i === 1 ? 'var(--warning)' : 'var(--accent)' }))}
              format={v => `${v} items`}
            />
          </div>
        )}

        <div>
          <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>Suggested next steps</div>
          <div className="u-col" style={{ gap: 8 }}>
            {ins.actions.map((a, i) => (
              <Button
                key={i}
                variant="secondary"
                iconRight={<Icon.ArrowRight size={13} />}
                onClick={() => {
                  if (a.ref) { navigate(a.ref); onClose(); }
                  else toast({ title: `${a.label} — not connected yet`, sub: 'This next step is not wired up in this build.', tone: 'info' });
                }}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="u-xs u-faint" style={{ lineHeight: 1.65, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
          Sources — {ins.chart.labels.length} data points recomputed from school records; analysis deterministic for this dataset.
          Owner {roleLabel(ins.ownerRole)} · confidence {statusLabel(ins.confidence)} (verification pass compares figures against the underlying fee records).
          Question investigations like this are also available conversationally in Ask, with per-claim citations.
        </div>
      </div>
    </Drawer>
  );
}

/* ---------- main ---------- */
export default function Insights() {
  const { session } = useStore();
  const navigate = useNavigate();
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, loading, error, retry } = useAsync(async () => {
    await new Promise(r => setTimeout(r, 400)); // simulated analysis fetch
    return seed.insights;
  }, [session.roleId]);

  /* FEE-PRD-8 / FEE-FE-1: the collection figure is a LIVE door (GET /reports/fees/summary), not the demo
     seed. When the door is unavailable the stat shows "—", never a seed number labelled "live". */
  const liveFees = useAsync(async () => {
    try { return await apiFeesSummary(); } catch { return null; }
  }, []);

  /* U-09: attendance health is a LIVE read model (GET /plugins/ops.bi/attendance), not the demo seed. */
  const liveAtt = useAsync(async () => {
    try { return await apiBiAttendance(30); } catch { return null; }
  }, []);

  const attLive = useMemo(() => {
    const rows = (liveAtt.data?.byClass as Array<{ marks?: number; present?: number; late?: number; pct?: number }> | undefined) ?? [];
    const marks = rows.reduce((a, r) => a + Number(r.marks ?? 0), 0);
    const present = rows.reduce((a, r) => a + Number(r.present ?? 0) + Number(r.late ?? 0), 0);
    const below = (liveAtt.data?.belowThreshold as unknown[] | undefined)?.length ?? 0;
    return { has: marks > 0, pct: marks ? Math.round((present / marks) * 1000) / 10 : null, below };
  }, [liveAtt.data]);

  /* P0 empty-world: TERM_DAYS / attendance / students are all empty for a
     tenant with no records yet, so each stat reports what the dataset can
     actually support — `null` (rendered as "not yet") instead of a 0 that
     would read as a measurement. */
  const stats = useMemo(() => {
    const term2 = seed.feeObligations.filter(f => f.term === 'Term 2 2026-27');
    const billed = term2.reduce((a, f) => a + f.amount, 0);
    const collected = term2.reduce((a, f) => a + f.paidAmount, 0);
    /* null = nothing billed, so there is no collection rate to report. */
    const rate = billed ? Math.round((collected / billed) * 1000) / 10 : null;
    const failed = term2.filter(f => f.status === 'failed').length;

    const totalActive = seed.students.filter(s => s.status !== 'inactive').length;
    /* Crash site (P0): `TERM_DAYS[len - 1].getTime()` threw on the blanked
       empty world — "today" has to exist before absence can be counted. */
    const lastDay = seed.TERM_DAYS[seed.TERM_DAYS.length - 1];
    const absentToday = lastDay
      ? seed.attendance.filter(a => a.date.getTime() === lastDay.getTime() && a.status === 'absent').length
      : 0;
    const presence = totalActive ? Math.round(((totalActive - absentToday) / totalActive) * 1000) / 10 : 0;
    /* No register on the last school day means no attendance health to report —
       an unmarked register is not a 100% present school. */
    const hasAttendanceToday = !!lastDay && seed.attendance.some(a => a.date.getTime() === lastDay.getTime());
    const flagged = seed.sections.filter(s => { const a = seed.sectionAttendanceToday(s.id); return a.total > 0 && a.pct < 85; }).length;

    /* Empty-world law: the demo's workload insight may not exist in a real
       school's data yet — render the card's absence, never crash. */
    const wl = seed.insights.find(i => i.id === 'ins_4') ?? null;
    return { rate, failed, presence, hasAttendanceToday, totalActive, flagged, wl };
  }, []);

  /* 0.5 demo-residue: the honesty chrome shows only while BOTH live doors fail —
     collection rate (fees summary) and attendance health (ops.bi) carry the
     page once either lane is wired. */
  const liveMissing = liveFees.data == null && liveAtt.data == null;

  const insights = useMemo(() => data ?? [], [data]);
  const ordered = useMemo(() => {
    const mine = insights.filter(i => i.ownerRole === session.roleId);
    const rest = insights.filter(i => i.ownerRole !== session.roleId);
    return [...mine, ...rest];
  }, [insights, session.roleId]);

  const openIns = insights.find(i => i.id === openId) ?? null;

  return (
    <>
      <PageHead
        title="Insights"
        sub="Questions the data answers today — each with its metric, movement, and the records behind it."
        actions={liveMissing ? <Badge tone="outline">Illustrative in this build</Badge> : undefined}
      />

      {liveMissing && <SampleNote>Sample insights — the question cards and the workload figure are illustrative in this build. The collection rate and attendance health are read live from the fee records and attendance records.</SampleNote>}

      {/* stats row */}
      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <Stat
          label="Collection rate — all fee records"
          /* No obligations to divide by → "—", not a 0% that would read as a
             collection failure the school never had. */
          value={liveFees.data?.collectionPct == null ? '—' : `${liveFees.data.collectionPct}%`}
          delta={liveFees.data?.collectionPct == null ? undefined : { value: `${liveFees.data.totals?.obligations ?? 0} fee dues`, dir: 'flat' }}
          sub={liveFees.error ? 'Fee summary is unavailable right now'
            : liveFees.data?.collectionPct == null ? 'No fee dues recorded yet'
              : 'From the live fee records'}
          onClick={() => navigate('/fees')}
        />
        <Stat
          label="Attendance health — last 30 days"
          value={attLive.has ? `${attLive.pct}%` : '—'}
          delta={!attLive.has
            ? { value: 'no registers marked yet', dir: 'flat' as const }
            : { value: attLive.below ? `${attLive.below} class${attLive.below > 1 ? 'es' : ''} below 75%` : 'all classes above the floor', dir: attLive.below ? 'down' as const : 'up' as const }}
          sub={liveAtt.error ? 'Attendance read model unavailable right now' : attLive.has ? 'From live attendance records' : 'No attendance records yet'}
          onClick={() => navigate('/attendance')}
        />
        {stats.wl && (
          <Stat
            label="Teacher workload"
            value={stats.wl.delta}
            delta={{ value: 'avg periods/week', dir: 'up' }}
            sub="Sample — no timetable-workload feature is connected in this build"
            onClick={() => navigate('/operations/hr')}
          />
        )}
      </div>

      {error ? (
        <Card pad><Empty icon={<Icon.Alert size={22} />} title="Insights could not load" sub="The analysis pipeline did not respond." action={<Button variant="secondary" onClick={retry}>Try again</Button>} /></Card>
      ) : loading ? (
        <div className="u-col" style={{ gap: 10 }}>
          <Skeleton w={200} h={12} />
          <div className="grid grid-2">
            <SkeletonCard lines={4} />
            <SkeletonCard lines={4} />
          </div>
        </div>
      ) : ordered.length === 0 ? (
        <Card pad><Empty icon={<Icon.Insights size={22} />} title="No insights yet" sub="As records accumulate, SchoolOS surfaces the questions worth asking here." /></Card>
      ) : (
        <div className="grid grid-2">
          {ordered.map(ins => (
            <InsightCard key={ins.id} ins={ins} highlighted={ins.ownerRole === session.roleId} onOpen={() => setOpenId(ins.id)} />
          ))}
        </div>
      )}

      <AnalysisDrawer ins={openIns} onClose={() => setOpenId(null)} />
    </>
  );
}
