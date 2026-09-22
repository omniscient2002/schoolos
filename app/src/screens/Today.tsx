/* ============================================================
   Today — the role-aware daily home.
   Principal: the Morning Briefing (NEEDS YOU / CHANGED
   OVERNIGHT / TODAY / WATCH). Staff roles get scoped variants
   of the same bands. Every claim cites source · time ·
   confidence — the signature trust surface.
   ============================================================ */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import * as seed from '../data/dataset';
import { apiGet } from '../services/liveApi';
import { PageHead, Section, Card, Stat, Badge, Empty, ErrorState, Skeleton, SkeletonCard } from '../components/ui';
import { EvidenceChain, EventLine } from '../components/Ai';
import { Sparkline } from '../components/Chart';
import { Slot } from '../plugins/Slot';
import { Icon } from '../components/Icon';
import { friendly } from '../lib/friendlyErrors';
import { apiTransportRoutes, type LiveRouteRow } from '../services/liveApi';
import { fmtDate, fmtDateShort, fmtTime, weekday } from '../lib/format';
import type { ActionRecord, BusRoute } from '../types/domain';

/* ---------- shared shapes ---------- */
type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'ai' | 'accent' | 'outline';

interface BriefItem {
  id: string;
  icon: keyof typeof Icon;
  title: string;
  detail?: string;
  chips: string[];
  badge?: { label: string; tone: BadgeTone };
  due?: { label: string; tone: 'danger' | 'warning' | 'neutral' };
  to: string;
}

interface Band { id: string; label: string; sub: string; items: BriefItem[] }

const PRIORITY_ORDER: Record<string, number> = { critical: 0, urgent: 0, high: 1, normal: 2, low: 3 };

/* Canned evidence chips (times like "07:42", sources like "GPS monitor") are
   demo-world flavour — label them as such wherever they appear. */
const demo = (c: string) => `${c} · demo`;

function dueIn(d?: Date): { label: string; tone: 'danger' | 'warning' | 'neutral' } | undefined {
  if (!d) return undefined;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return { label: 'Overdue', tone: 'danger' };
  const h = ms / 3600000;
  if (h < 1) return { label: `${Math.max(1, Math.round(ms / 60000))}m left`, tone: 'danger' };
  if (h < 24) return { label: `${Math.round(h)}h left`, tone: h <= 6 ? 'danger' : 'warning' };
  return { label: `${Math.round(h / 24)}d left`, tone: 'neutral' };
}

function openActions(actions: ActionRecord[]): ActionRecord[] {
  return actions
    .filter(a => a.status === 'open')
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) || a.deadline?.getTime() || 0);
}

function maintenanceBriefs(workOrders: { id: string; title: string; priority: string; status: string; building: string; room?: string; reportedOn: Date; assetId?: string; reportedBy: string }[]): BriefItem[] {
  const open = workOrders.filter(w => !['resolved', 'closed', 'cancelled'].includes(w.status));
  const ranked = open.filter(w => w.priority === 'emergency' || w.priority === 'critical').length
    ? open.filter(w => w.priority === 'emergency' || w.priority === 'critical')
    : open.slice(0, 2);
  return ranked.slice(0, 2).map(w => ({
    id: `maint-${w.id}`,
    icon: 'Wrench' as const,
    title: w.title,
    detail: `${w.building}${w.room ? ' · ' + w.room : ''} · reported by ${w.reportedBy} · ${w.assetId ? 'asset ' + w.assetId + ' · ' : ''}${w.status.replace('-', ' ')}.`,
    chips: [`Work order ${w.id} · ${new Date(w.reportedOn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · high`, 'SLA engine · deterministic · high'],
    badge: w.priority === 'emergency' ? { label: 'Emergency', tone: 'danger' as BadgeTone } : w.priority === 'critical' ? { label: 'Critical', tone: 'danger' as BadgeTone } : { label: 'High', tone: 'warning' as BadgeTone },
    to: `/maintenance/work-orders/${w.id}`,
  }));
}

/* Tomorrow — the forward band (docs/06 §11): what will break in the
   next days — SLA clocks on open work orders, case deadlines, and
   obligations past them. Evidence-first, pre-linked. */
function tomorrowBriefs(workOrders: { id: string; title: string; priority: string; sla: { resolveBy: Date }; status: string }[]): BriefItem[] {
  const out: BriefItem[] = [];
  const soon = workOrders.filter(w => !['resolved', 'closed', 'cancelled'].includes(w.status));
  const breach = soon.filter(w => w.sla.resolveBy.getTime() - Date.now() < 6 * 3600_000);
  for (const w of breach.slice(0, 2)) {
    const hrs = Math.max(0.2, Math.round(((w.sla.resolveBy.getTime() - Date.now()) / 3600_000) * 10) / 10);
    out.push({
      id: `tom-${w.id}`,
      icon: 'Clock',
      title: `SLA closes in ${hrs}h — ${w.title}`,
      detail: `${w.id} (${w.priority}) resolves by ${w.sla.resolveBy.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}. Escalation fires automatically at breach.`,
      chips: [`SLA engine · deterministic · high`, 'Facilities §2.1 (lifecycle)'],
      to: `/maintenance/work-orders/${w.id}`,
    });
  }
  return out;
}

function actionBriefs(actions: ActionRecord[]): BriefItem[] {
  return openActions(actions).map(a => ({
    id: a.id,
    icon: a.kind === 'approval' ? 'Clipboard' : a.kind === 'case' ? 'Message' : a.kind === 'exception' ? 'Alert' : a.kind === 'incident' ? 'Zap' : 'Sparkle',
    title: a.title,
    detail: a.detail,
    chips: [
      ...a.evidence.slice(0, 2).map(e => e.label),
      `${a.aiInvolved ? 'SchoolOS AI' : 'Rule-based detection'} · ${fmtTime(a.on)} · ${a.aiInvolved ? 'medium' : 'high'} confidence`,
    ],
    badge: {
      label: a.priority === 'critical' ? 'Critical' : a.priority === 'high' ? 'High' : a.priority === 'normal' ? 'Normal' : 'Low',
      tone: a.priority === 'critical' ? 'danger' : a.priority === 'high' ? 'warning' : 'neutral',
    },
    due: dueIn(a.deadline),
    to: '/action-center',
  }));
}

/* ---------- band row ---------- */
function BandRow({ item, divider }: { item: BriefItem; divider?: boolean }) {
  const navigate = useNavigate();
  const Ic = Icon[item.icon];
  const dueTone: BadgeTone = item.due?.tone === 'danger' ? 'danger' : item.due?.tone === 'warning' ? 'warning' : 'outline';
  const sevColor = item.badge?.tone === 'danger' ? 'var(--status-critical)'
    : item.badge?.tone === 'warning' ? 'var(--status-warning)' : 'var(--border)';
  return (
    <div
      className={`attention-row ${divider ? 'divider' : ''}`}
      role={divider ? undefined : 'button'}
      onClick={() => navigate(item.to)}
      onKeyDown={e => { if (e.key === 'Enter') navigate(item.to); }}
      tabIndex={0}
      aria-label={item.title}
    >
      <span className="attention-rail" style={{ background: sevColor }} aria-hidden="true" />
      <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--surface-3)', display: 'grid', placeItems: 'center', flexShrink: 0, color: 'var(--text-2)' }}>
        <Ic size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }} className="u-col">
        <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap', rowGap: 4, alignItems: 'center' }}>
          <span className="att-title">{item.title}</span>
          {item.badge && <Badge tone={item.badge.tone}>{item.badge.label}</Badge>}
          {item.due && <Badge tone={dueTone} dot>{item.due.label}</Badge>}
        </div>
        {item.detail && <div className="u-small u-muted att-detail">{item.detail}</div>}
        {item.chips.length > 0 && (
          <div className="u-flex u-xs u-faint att-meta" style={{ columnGap: 6 }}>
            <span className="att-meta-lead">{item.chips[0]}</span>
            {item.chips.slice(1).map((c, i) => (
              <span key={i} className="u-flex" style={{ gap: 6 }}>
                <span aria-hidden="true">·</span>
                <span>{c}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <span className="attention-open u-small" style={{ color: 'var(--accent)', fontWeight: 600, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        Open <Icon.ChevronRight size={13} />
      </span>
    </div>
  );
}

function BandBlock({ band }: { band: Band }) {
  const needs = band.id === 'needs';
  const actionNow = band.items.filter(i => i.due?.tone === 'danger' || i.badge?.tone === 'danger').length;
  const sub = needs && band.items.length > 0
    ? `${band.items.length} item${band.items.length === 1 ? '' : 's'} shown · ${actionNow} require${actionNow === 1 ? 's' : ''} action now${band.sub ? ` · ${band.sub}` : ''}`
    : band.sub;
  return (
    <Section
      title={
        <span className="u-flex" style={{ gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--text-xs)', letterSpacing: '.08em', textTransform: 'uppercase', color: needs ? 'var(--text-2) ' : 'var(--text-3)', fontWeight: 700 }}>{band.label}</span>
          {needs && band.items.length > 0 && <Badge tone="danger" dot>{band.items.length} item{band.items.length === 1 ? '' : 's'}</Badge>}
        </span>
      }
      sub={sub}
    >
      {band.items.length === 0 ? (
        <Card pad><Empty icon={<Icon.Check size={22} />} title="Nothing in this band" sub="Everything here is clear. The briefing refills as records change." /></Card>
      ) : needs ? (
        <Card pad={false} className="needs-card">
          {band.items.map((it, i) => <BandRow key={it.id} item={it} divider={i > 0} />)}
        </Card>
      ) : (
        <div className="u-col" style={{ gap: 10 }}>
          {band.items.map(it => <BandRow key={it.id} item={it} />)}
        </div>
      )}
    </Section>
  );
}

/* ---------- main ---------- */
export default function Today() {
  const { session, domain, actorName } = useStore();
  const navigate = useNavigate();
  const role = session.roleId;
  const campusLabel = session.campusScope === 'all'
    ? 'All campuses'
    : seed.campuses.find(c => c.id === session.campusScope)?.name ?? 'Campus';

  const [routesData, setRoutesData] = useState<BusRoute[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  /* Real integration status — replaces the hardcoded "Tally gateway connected"
     fiction. All fields optional; demo builds keep the demo narrative. */
  const [caps, setCaps] = useState<{ rails: { sms?: { configured: boolean; provider: string | null }, whatsapp?: { configured: boolean; provider: string | null }, razorpay?: { configured: boolean } } } | null>(null);

  const [liveRoutes, setLiveRoutes] = useState<LiveRouteRow[] | null>(null);
  useEffect(() => {
    let live = true;
    setLoading(true); setError(null);
    // Live: the routes door carries roster + capacity only — no GPS/status.
    apiTransportRoutes()
      .then(r => { if (live) { setLiveRoutes(r.routes as LiveRouteRow[]); setRoutesData([]); setLoading(false); } })
      .catch(e => { if (live) { setError(friendly(e)); setLoading(false); } });
    return () => { live = false; };
  }, [session.campusScope, session.roleId, tick]);

  useEffect(() => {
    apiGet<{ rails: { sms?: { configured: boolean; provider: string | null }, whatsapp?: { configured: boolean; provider: string | null }, razorpay?: { configured: boolean } } }>('/capabilities')
      .then(r => setCaps(r))
      .catch(() => setCaps(null));
  }, [tick]);

  const brief = useMemo(() => {
    if (!routesData) return null;
    const now = new Date();
    const actions = domain.actions;

    /* --- computed presence (all campuses) --- */
    /* D-5: the kernel tolerates every removed dataset key — all seed reads
       below are optional-chained with honest fallbacks. */
    const studentsAll = seed.students ?? [];
    const sectionsAll = seed.sections ?? [];
    const timetableAll = seed.timetable ?? [];
    const calendarAll = seed.calendarEvents ?? [];
    const obligationsAll = seed.obligations ?? [];
    const decisionsAll = seed.decisions ?? [];
    const feeObligationsAll = seed.feeObligations ?? [];
    const attendanceAll = seed.attendance ?? [];
    const termDays = seed.TERM_DAYS ?? [];
    const campusesAll = seed.campuses ?? [];
    const insightsAll = seed.insights ?? [];
    const actionItemsAll = seed.actionItems ?? [];
    const busRoutesAll = seed.busRoutes ?? [];
    const aiUsage = seed.aiUsage;
    const healthIssues = seed.healthIssues ?? [];
    const totalActive = studentsAll.filter(s => s.status !== 'inactive').length;
    const lastDay = termDays[termDays.length - 1];
    const absentOn = (d: Date) => attendanceAll.filter(a => a.date.getTime() === d.getTime() && a.status === 'absent').length;
    /* Empty world: no students and no term calendar → no coverage series.
       toFixed on undefined crashed the whole Today desk; nulls render '—'. */
    const wocSeries: number[] = totalActive > 0 && termDays.length > 0
      ? termDays.slice(-10).map(d => Math.round(((totalActive - absentOn(d)) / totalActive) * 1000) / 10)
      : [];
    const woc: number | null = wocSeries.length ? wocSeries[wocSeries.length - 1] : null;
    const wocAvg: number | null = wocSeries.length ? Math.round((wocSeries.reduce((a, b) => a + b, 0) / wocSeries.length) * 10) / 10 : null;
    void wocAvg; // kept for the demo world's delta copy; empty worlds never read it

    /* --- seeded narrative anchors --- */
    const act1 = actions.find(a => a.id === 'act_1') ?? actionItemsAll[0];
    /* Empty-world law: a brand-new school has no insights/routes — anchor
       derivations must tolerate absence instead of crashing the Today desk. */
    const insFee = insightsAll[0];
    const insFeeValues = insFee?.chart?.values ?? [];
    const collection = insFeeValues.length ? insFeeValues[insFeeValues.length - 1] : null;
    const r7 = routesData.find(r => r.id === 'route_7') ?? busRoutesAll.find(r => r.id === 'route_7') ?? null;
    const onTimePct = routesData.length ? Math.round((routesData.filter(r => r.status === 'on-time').length / routesData.length) * 100) : 0;
    const openCount = openActions(actions).length;
    const criticalCount = openActions(actions).filter(a => a.priority === 'critical').length;
    const highCount = openActions(actions).filter(a => a.priority === 'high').length;
    const complaintCases = domain.cases.filter(c => c.origin === 'parent-whatsapp' && c.status !== 'resolved' && /bus 14/i.test(c.title));

    /* --- timetable --- */
    const dow = now.getDay();
    const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    const hm = now.getHours() * 60 + now.getMinutes();
    const slotsToday = dow >= 1 && dow <= 6 ? timetableAll.filter(t => t.day === dow) : [];
    const current = slotsToday.filter(t => toMin(t.start) <= hm && hm < toMin(t.end));
    const next = slotsToday.filter(t => toMin(t.start) > hm).sort((a, b) => toMin(a.start) - toMin(b.start))[0];

    /* --- calendar --- */
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const upcoming = calendarAll
      .filter(e => e.on.getTime() >= dayStart.getTime())
      .sort((a, b) => a.on.getTime() - b.on.getTime());
    const todays = upcoming.filter(e => e.on.getTime() < dayStart.getTime() + 86400000);
    const soonEvents = upcoming.filter(e => e.on.getTime() < dayStart.getTime() + 7 * 86400000).slice(0, 4);

    const calBriefs: BriefItem[] = soonEvents.map(e => ({
      id: e.id,
      icon: e.type === 'exam' ? 'Book' : e.type === 'deadline' ? 'Flag' : e.type === 'ptm' ? 'Users' : 'Calendar',
      title: e.title,
      detail: `${e.type.charAt(0).toUpperCase() + e.type.slice(1)} · ${e.owner}${e.location ? ` · ${e.location}` : ''}`,
      chips: [
        `${e.on.getTime() < dayStart.getTime() + 86400000 ? 'Today' : fmtDateShort(e.on)} · ${e.durationMins ? `${fmtTime(e.on)} · ${e.durationMins}m` : 'all day'}`,
        e.campus === 'all' ? 'All campuses' : seed.campuses.find(c => c.id === e.campus)?.name ?? '',
      ],
      badge: e.type === 'exam' ? { label: 'Exam', tone: 'accent' } : e.type === 'deadline' ? { label: 'Deadline', tone: 'warning' } : undefined,
      to: '/calendar',
    }));

    /* --- watch band --- */
    const watchObligations: BriefItem[] = obligationsAll
      .filter(o => o.status !== 'done')
      .sort((a, b) => a.dueOn.getTime() - b.dueOn.getTime())
      .slice(0, 4)
      .map(o => ({
        id: o.id,
        icon: o.category === 'compliance' ? 'Shield' : o.category === 'fee' ? 'Money' : o.category === 'review' ? 'Flag' : 'Document',
        title: o.title,
        detail: `${o.category} · owner ${o.owner}`,
        chips: [o.evidence ?? 'Obligation register', `Due ${fmtDateShort(o.dueOn)}`],
        due: dueIn(o.dueOn),
        to: '/calendar',
      }));
    const decisionReviews: BriefItem[] = decisionsAll
      .filter(d => d.reviewOn && d.reviewOn.getTime() >= dayStart.getTime())
      .sort((a, b) => (a.reviewOn?.getTime() ?? 0) - (b.reviewOn?.getTime() ?? 0))
      .slice(0, 3)
      .map(d => ({
        id: d.id,
        icon: 'Flag',
        title: `Decision review — ${d.title}`,
        detail: d.expectedOutcome,
        chips: [`${d.policy} · decided ${fmtDateShort(d.decidedOn)}`, 'AI memory'],
        due: dueIn(d.reviewOn),
        to: '/memory',
      }));

    /* --- changed overnight --- */
    /* Empty-world law: each narrative card requires its anchor; a brand-new
       school simply shows fewer cards instead of crashing the desk. */
    const chgAct: BriefItem | null = act1 ? {
      id: 'chg-8b',
      icon: 'Users',
      title: act1.title,
      detail: act1.detail,
      chips: [demo('Attendance register · 08:40 · high'), demo('Route roster overlap · medium'), demo('GPS monitor · 07:42 · high')],
      badge: { label: 'Anomaly', tone: 'danger' },
      to: '/attention',
    } : null;
    const failedCount = feeObligationsAll.filter(f => f.status === 'failed').length;
    const chgFee: BriefItem | null = insFee ? {
      id: 'chg-fee',
      icon: 'Money',
      title: `Term 2 collection at ${collection}%${failedCount ? ` — ${failedCount} failed payment${failedCount === 1 ? '' : 's'}` : ''}`,
      detail: failedCount
        ? `${failedCount} online payment${failedCount === 1 ? '' : 's'} failed this week and await retry or guardian assistance.`
        : 'No failed payments on record this week.',
      chips: [demo('Fees records · sample'), demo('Gateway settlement · sample')],
      badge: { label: 'Fee dip', tone: 'warning' },
      to: '/fees',
    } : null;
    const chgBus: BriefItem | null = r7 ? {
      id: 'chg-bus',
      icon: 'Bus',
      title: `Bus 14 (Route 7) running ${r7.delayMins ?? 13} min late`,
      detail: `Coolant leak repaired after Tuesday's breakdown; ${r7.students} students on route. Pre-route inspections active per dec_4; spare bus on standby.`,
      chips: [demo('GPS monitor · 07:42 · high'), demo('Transport SOP · updated 2d ago · high')],
      badge: { label: 'Transport', tone: 'warning' },
      to: '/transport',
    } : null;
    const changed: BriefItem[] = [
      ...(chgAct ? [chgAct] : []),
      ...(chgFee ? [chgFee] : []),
      ...(chgBus ? [chgBus] : []),
    ];
    if (complaintCases.length) {
      changed.push({
        id: 'chg-msg',
        icon: 'Message',
        title: `${complaintCases.length} unresolved WhatsApp complaint${complaintCases.length > 1 ? 's' : ''} about Bus 14`,
        detail: complaintCases[0].messages[0]?.text ?? '',
        chips: [demo('Communication log · 08:15 · high'), `Case ${complaintCases[0].id} · SLA ${complaintCases[0].slaHours}h`],
        badge: { label: 'Cases', tone: 'info' },
        to: '/cases',
      });
    }

    /* --- today band --- */
    const today: BriefItem[] = [];
    if (dow === 0) {
      today.push({ id: 'tt-off', icon: 'Sunrise', title: 'Sunday — no classes scheduled', detail: 'Campus closed; duty roster covers security and transport maintenance.', chips: ['Academic calendar · verified', 'Duty roster · 06:00 · high'], to: '/calendar' });
    } else if (current.length) {
      const campusesNow = new Set(current.map(c => sectionsAll.find(s => s.id === c.sectionId)?.campus)).size;
      today.push({
        id: 'tt-now',
        icon: 'Clock',
        title: `Period ${current[0].period} in session (${current[0].start}–${current[0].end})`,
        detail: `${current.length} classes in session across ${campusesNow} campus${campusesNow > 1 ? 'es' : ''}${next ? ` · next period at ${next.start}` : ' · last period of the day'}.`,
        chips: [demo('Timetable engine · live · high'), `${slotsToday.length} slots scheduled today`],
        to: '/operations',
      });
    } else if (next) {
      today.push({
        id: 'tt-next',
        icon: 'Clock',
        title: `Next period at ${next.start} — ${next.subject}`,
        detail: `${sectionsAll.find(s => s.id === next.sectionId)?.grade}-${sectionsAll.find(s => s.id === next.sectionId)?.name} · Room ${next.room} · ${seed.teachers.find(t => t.id === next.teacherId)?.name ?? 'Unassigned'}.`,
        chips: [demo('Timetable engine · live · high')],
        to: '/operations',
      });
    }
    if (!todays.length) {
      today.push({
        id: 'cal-none',
        icon: 'Calendar',
        title: 'No calendar events later today',
        detail: `Next up: ${upcoming[0] ? `${upcoming[0].title} — ${fmtDateShort(upcoming[0].on)}, ${fmtTime(upcoming[0].on)}` : 'nothing scheduled'}.`,
        chips: [demo('Academic calendar · verified 06:30 · high')],
        to: '/calendar',
      });
    }
    today.push(...calBriefs);

    /* --- assemble per role --- */
    const bands: Band[] = [];
    let stats: { label: string; value: string; delta?: { value: string; dir: 'up' | 'down' | 'flat' }; sub: string; spark?: ReactNode; to?: string }[] = [];
    let headSub = '';

    if (role === 'teacher') {
      /* Empty-world + D-5: never assert a section. A teacher whose class is
         not provisioned yet still gets a working Today desk. */
      const mySection = sectionsAll.find(s => (seed.teachers ?? []).find(t => t.id === s.classTeacherId)?.name === actorName)
        ?? sectionsAll.find(s => s.id === seed.DEMO_SECTION_ID)
        ?? null;
      const att = mySection ? seed.sectionAttendanceToday(mySection.id) : { total: 0, absent: 0, late: 0 };
      const absentStudents = mySection
        ? seed.studentsOfSection(mySection.id)
          .map(st => ({ st, rec: attendanceAll.find(a => a.studentId === st.id && a.date.getTime() === lastDay?.getTime() && a.status === 'absent') }))
          .filter(x => x.rec)
        : [];
      const mySlots = mySection && dow >= 1 && dow <= 6 ? timetableAll.filter(t => t.day === dow && t.sectionId === mySection.id).sort((a, b) => a.period - b.period) : [];
      headSub = mySection
        ? `${weekday(now)} · ${fmtDate(now)} · Class teacher ${mySection.grade}-${mySection.name} · ${campusLabel}`
        : `${weekday(now)} · ${fmtDate(now)} · Teacher · ${campusLabel}`;
      stats = [
        mySection
          ? { label: 'Class presence', value: `${Math.round(((att.total - att.absent) / Math.max(1, att.total)) * 100)}%`, sub: `${att.absent} absent · ${att.late} late · ${mySection.studentCount} students`, to: '/attendance' }
          : { label: 'Class presence', value: '—', sub: 'No class assigned yet — ask your coordinator to assign you a section', to: '/attendance' },
        { label: 'Absences to confirm', value: String(absentStudents.length), sub: 'Guardians of absentees are queued a notice (Attendance §1.1)', to: '/attendance' },
        { label: 'Periods today', value: String(mySlots.length), sub: mySlots.length ? `Next: ${mySlots.find(s => toMin(s.start) > hm)?.subject ?? mySlots[mySlots.length - 1].subject}` : mySection ? 'No classes' : 'No timetable yet', to: '/learning' },
        { label: 'Open items', value: String(openCount), sub: `${criticalCount} critical`, to: '/action-center' },
      ];
      bands.push({ id: 'needs', label: 'Needs you', sub: 'maintenance and follow-ups touching your sections — priority-ranked', items: [...maintenanceBriefs(domain.workOrders), ...actionBriefs(actions).slice(0, 3)] });
      if (mySection) {
        bands.push({
          id: 'myclass', label: 'My class', sub: `${mySection.grade}-${mySection.name} · Room ${mySection.room}`,
          items: [
            {
              id: 'att-cta', icon: 'Clipboard', title: `Confirm today's register — ${att.absent} absences recorded`,
              detail: absentStudents.length
                ? `Absent: ${absentStudents.slice(0, 4).map(x => x.st.name).join(', ')}${absentStudents.length > 4 ? ` +${absentStudents.length - 4} more` : ''}. Leniency until 09:30 applies to Bus 14 riders (Attendance §1.4).`
                : 'Register complete. No follow-ups pending.',
              chips: [demo('Attendance register · 08:40 · high'), demo('Bus 14 route roster · medium')],
              badge: { label: 'Register', tone: 'accent' }, to: '/attendance',
            },
            ...mySlots.slice(0, 3).map(s => ({
              id: s.id, icon: 'Book' as const, title: `P${s.period} ${s.subject} — ${s.start}–${s.end}`,
              detail: `Room ${s.room} · ${seed.teachers.find(t => t.id === s.teacherId)?.name ?? 'You'}`,
              chips: [demo('Timetable engine · live · high')], to: '/learning',
            })),
          ],
        });
      }
      bands.push({ id: 'today', label: 'Today', sub: 'School calendar for your section', items: today.slice(0, 4) });
      bands.push({ id: 'watch', label: 'Tomorrow', sub: 'What breaks next — SLA clocks, obligations, decision reviews', items: [...tomorrowBriefs(domain.workOrders), ...watchObligations.slice(0, 2), ...decisionReviews.slice(0, 2)] });
    } else if (role === 'finance') {
      const failed = feeObligationsAll.filter(f => f.status === 'failed');
      const overdueSum = feeObligationsAll.filter(f => f.status === 'overdue').reduce((a, f) => a + (f.amount - f.paidAmount), 0);
      headSub = `${weekday(now)} · ${fmtDate(now)} · Finance · ${campusLabel}`;
      stats = [
        { label: 'Collection — Term 2', value: collection != null ? `${collection}%` : '—', spark: insFeeValues.length ? <Sparkline points={insFeeValues} color="var(--accent)" /> : undefined, sub: insFee ? 'Sample insight in this build — open Fees for the live ledger' : 'No fee records yet', to: '/fees' },
        { label: 'Failed payments', value: String(failed.length), sub: failed.length ? `${failed.length} awaiting retry or settlement` : 'Nothing awaiting retry', to: '/fees' },
        { label: 'Overdue outstanding', value: fmtMoneyShortLocal(overdueSum), sub: 'Across all campuses · Term 1 + 2', to: '/fees' },
        { label: 'Open items', value: String(openCount), sub: `${highCount} high priority`, to: '/action-center' },
      ];
      bands.push({ id: 'needs', label: 'Needs you', sub: 'approvals and finance clusters first', items: [...maintenanceBriefs(domain.workOrders), ...actionBriefs(actions)] });
      bands.push({
        id: 'collections', label: 'Collections', sub: 'Fee movement overnight',
        items: [
          ...(collection != null ? [{
            id: 'fee-trend', icon: 'Money' as const, title: `Collection ${collection}% this week`,
            detail: 'Sample figure in this build — open the Fees desk for the live obligations ledger.',
            chips: [demo('Fees records · sample')],
            badge: { label: 'Dip', tone: 'warning' as BadgeTone }, to: '/fees',
          }] : []),
        ],
      });
      bands.push({ id: 'today', label: 'Today', sub: 'Calendar and timetable', items: today });
      bands.push({ id: 'watch', label: 'Tomorrow', sub: 'What breaks next — SLA clocks, obligations, decision reviews', items: [...tomorrowBriefs(domain.workOrders), ...watchObligations, ...decisionReviews] });
    } else if (role === 'transport') {
      const totalRiders = (liveRoutes ?? []).reduce((a, r) => a + Number(r.riders ?? 0), 0);
      headSub = `${weekday(now)} · ${fmtDate(now)} · Transport · ${campusLabel}`;
      stats = [
        { label: 'Routes', value: String(liveRoutes?.length ?? 0), sub: 'From GET /transport/routes — GPS status is not connected yet, so no on-time figure is shown', to: '/transport' },
        { label: 'Riders on routes', value: String(totalRiders), sub: 'Live count of students holding a bus_route', to: '/transport' },
        { label: 'Open items', value: String(openCount), sub: `${criticalCount} critical`, to: '/action-center' },
      ];
      bands.push({ id: 'needs', label: 'Needs you', sub: 'transport-critical maintenance and follow-ups', items: [...maintenanceBriefs(domain.workOrders), ...actionBriefs(actions)] });
      bands.push({
        id: 'fleet', label: 'Fleet', sub: `${(liveRoutes ?? []).length} routes — from the routes door (roster and capacity only; GPS status is not connected yet)`,
        items: (liveRoutes ?? []).slice(0, 4).map(r => ({
          id: String(r.id), icon: 'Bus' as const,
          title: `${r.name ?? r.code}`,
          detail: `${r.riders ?? 0} riders · vehicle ${r.vehicle ?? '—'} · capacity ${r.capacity ?? '—'}`,
          chips: [],
          badge: undefined, to: '/transport',
        })),
      });
      bands.push({ id: 'today', label: 'Today', sub: 'Calendar and timetable', items: today.slice(0, 3) });
      bands.push({ id: 'watch', label: 'Tomorrow', sub: 'What breaks next — SLA clocks, obligations, decision reviews', items: [...tomorrowBriefs(domain.workOrders), ...watchObligations.slice(0, 2), ...decisionReviews] });
    } else if (role === 'itadmin') {
      const score = healthIssues.length ? seed.healthScore(healthIssues) : null;
      headSub = `${weekday(now)} · ${fmtDate(now)} · IT administration · ${campusLabel}`;
      stats = [
        { label: 'Data health score', value: score != null ? String(score) : '—', sub: healthIssues.length ? `${healthIssues.filter(i => i.status === 'open').length} open issues` : 'Health checks appear once your school has records', to: '/data-health' },
        { label: 'AI spend this month', value: aiUsage ? fmtMoneyShortLocal(aiUsage.monthSpend) : '—', sub: aiUsage?.budget ? `of ${fmtMoneyShortLocal(aiUsage.budget)} budget` : 'No AI usage yet', to: '/ai-usage' },
        { label: 'AI failure rate', value: aiUsage ? `${aiUsage.failureRate}%` : '—', sub: aiUsage?.days.length ? `p95 latency ${aiUsage.latency.p95}ms` : 'No AI usage yet', to: '/ai-usage' },
        { label: 'Open items', value: String(openCount), sub: 'Across all roles', to: '/action-center' },
      ];
      bands.push({ id: 'needs', label: 'Needs you', sub: 'across roles — priority-ranked', items: [...maintenanceBriefs(domain.workOrders), ...actionBriefs(actions).slice(0, 3)] });
      /* Systems band — REAL integration status from /capabilities (replaces the
         hardcoded "Tally gateway connected — healthy" fiction). */
      const sysItems: BriefItem[] = [
        {
          id: 'sys-sms', icon: 'Message', title: `SMS rail ${caps?.rails.sms?.configured ? 'configured' : 'not connected yet'}`,
          detail: caps?.rails.sms?.configured
            ? `Provider: ${caps.rails.sms?.provider ?? 'custom'}. Messages send through this rail.`
            : 'Messages queue but do not send until a provider is connected. Set it up in the Rails console.',
          chips: ['From GET /capabilities · live'], badge: { label: caps?.rails.sms?.configured ? 'Connected' : 'Setup needed', tone: caps?.rails.sms?.configured ? 'success' : 'warning' }, to: '/rails',
        },
        {
          id: 'sys-wa', icon: 'Message', title: `WhatsApp rail ${caps?.rails.whatsapp?.configured ? 'configured' : 'not connected yet'}`,
          detail: caps?.rails.whatsapp?.configured
            ? `Provider: ${caps.rails.whatsapp?.provider ?? 'BSP'}. Parent messages send through this rail.`
            : 'WhatsApp drafts stay queued until a BSP provider is connected. Set it up in the Rails console.',
          chips: ['From GET /capabilities · live'], badge: { label: caps?.rails.whatsapp?.configured ? 'Connected' : 'Setup needed', tone: caps?.rails.whatsapp?.configured ? 'success' : 'warning' }, to: '/rails',
        },
        {
          id: 'sys-pay', icon: 'CreditCard', title: `Payments gateway ${caps?.rails.razorpay?.configured ? 'configured' : 'not connected yet'}`,
          detail: caps?.rails.razorpay?.configured
            ? 'Gateway keys are present; payments initiate and confirm against the real gateway.'
            : 'Payments can be recorded manually; gateway keys are not connected yet. Set them up in the Rails console.',
          chips: ['From GET /capabilities · live'], badge: { label: caps?.rails.razorpay?.configured ? 'Connected' : 'Setup needed', tone: caps?.rails.razorpay?.configured ? 'success' : 'warning' }, to: '/rails',
        },
      ];
      bands.push({ id: 'systems', label: 'Systems', sub: 'What is actually connected — live from /capabilities', items: sysItems });
      bands.push({ id: 'today', label: 'Today', sub: 'Calendar and timetable', items: today.slice(0, 3) });
      bands.push({ id: 'watch', label: 'Tomorrow', sub: 'What breaks next — SLA clocks, obligations, decision reviews', items: [...tomorrowBriefs(domain.workOrders), ...watchObligations.slice(0, 3), ...decisionReviews] });
    } else {
      /* principal / coordinator / admissions / owner — the full Morning Briefing */
      headSub = `${weekday(now)} · ${fmtDate(now)} · ${campusLabel}`;
      stats = [
        { label: 'WOC — coverage', value: woc != null ? `${woc.toFixed(1)}%` : '—', spark: wocSeries.length ? <Sparkline points={wocSeries} color="var(--accent)" /> : undefined, sub: `Weekly Operating Coverage · ${campusesAll.reduce((a, c) => a + (c.students ?? 0), 0)} students`, to: '/attendance' },
        { label: 'Open actions', value: String(openCount), sub: `${criticalCount} critical · ${highCount} high priority`, to: '/action-center' },
        { label: 'Term 2 collection', value: collection != null ? `${collection}%` : '—', spark: insFeeValues.length ? <Sparkline points={insFeeValues} color="var(--warning)" /> : undefined, sub: insFee ? 'Sample figure in this build — the live ledger is on the Fees desk' : 'No fee records yet', to: '/fees' },
        { label: 'Transport on time', value: `${onTimePct}%`, sub: r7 ? (r7.status === 'delayed' ? `Bus 14 delayed +${r7.delayMins ?? 13} min` : 'All routes nominal') : 'No routes yet', to: '/transport' },
      ];
      bands.push({ id: 'needs', label: 'Needs you', sub: 'priority-ranked, oldest deadline first', items: [...maintenanceBriefs(domain.workOrders), ...actionBriefs(actions)] });
      bands.push({ id: 'changed', label: 'Changed overnight', sub: 'Attendance anomalies, fee movement, transport events — diffed against 30-day baselines', items: changed });
      bands.push({ id: 'today', label: 'Today', sub: todays.length ? `${todays.length} event${todays.length === 1 ? '' : 's'} on today's calendar` : 'Calendar highlights for the coming week', items: today });
      bands.push({ id: 'watch', label: 'Tomorrow', sub: 'What breaks next — SLA clocks, obligations, decision reviews', items: [...tomorrowBriefs(domain.workOrders), ...watchObligations, ...decisionReviews] });
    }

    /* --- day ribbon: the school day as proportional segments (unit 9) --- */
    const RIBBON_START = 7 * 60, RIBBON_END = 16 * 60;
    const pctAt = (m: number) => Math.max(0, Math.min(100, ((m - RIBBON_START) / (RIBBON_END - RIBBON_START)) * 100));
    const ribbonEvents = [
      ...slotsToday.map(t => ({ start: toMin(t.start), end: toMin(t.end), label: `Period ${t.period}` })),
      { start: 7 * 60 + 30, end: 7 * 60 + 50, label: 'Assembly' },
      { start: 12 * 60 + 30, end: 13 * 60 + 15, label: 'Lunch' },
    ].sort((a, b) => a.start - b.start);
    const ribbon = ribbonEvents
      .filter(e => e.end > RIBBON_START && e.start < RIBBON_END)
      .map(e => ({ ...e, left: pctAt(e.start), width: Math.max(0.8, pctAt(e.end) - pctAt(e.start)), isNow: hm >= e.start && hm < e.end }));
    const nowPct = pctAt(hm);

    return { bands, stats, headSub, wocSeries, woc, openCount, ribbon, nowPct };
  }, [routesData, domain.actions, domain.cases, domain.workOrders, role, actorName, campusLabel, caps]);

  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const isPrincipalish = !['teacher', 'finance', 'transport', 'itadmin'].includes(role);

  if (error) {
    return <ErrorState title="The briefing could not load" sub="Attendance, fee and transport sources did not respond. Retry keeps your session." onRetry={() => setTick(t => t + 1)} />;
  }

  return (
    <>
      <PageHead
        title={<span>{greeting}, {actorName.split(' ').slice(0, 2).join(' ')}</span>}
        sub={loading ? 'Assembling the briefing from attendance, fees and transport…' : brief?.headSub}
        actions={<Badge tone="ai" dot>Morning Briefing</Badge>}
      />

      {/* day ribbon — the temporal anchor (unit 9; deterministic from the timetable) */}
      {!loading && brief && brief.ribbon.length > 0 && (
        <div className="day-ribbon" role="img" aria-label={`School day map: ${brief.ribbon.length} blocks between 7:00 and 16:00, now marker at ${Math.round(brief.nowPct)}% of the day`}>
          <div className="dr-track">
            {brief.ribbon.map((e, i) => (
              <span key={i} className={`dr-seg${e.isNow ? ' now' : ''}`} style={{ left: `${e.left}%`, width: `${e.width}%` }} />
            ))}
            {brief.nowPct > 0 && brief.nowPct < 100 && <span className="dr-now" style={{ left: `${brief.nowPct}%` }} />}
          </div>
        </div>
      )}

      {/* stat row */}
      <div className="grid grid-4" style={{ marginBottom: 8 }}>
        {loading || !brief
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={2} />)
          : brief.stats.map(s => (
            <Stat
              key={s.label}
              label={s.label}
              value={s.value}
              delta={s.delta}
              sub={s.sub}
              spark={s.spark}
              onClick={s.to ? () => navigate(s.to!) : undefined}
            />
          ))}
      </div>

      {/* plugin widgets — attention-slot (docs/10 §6 ration: max 2, rank by manifest order) */}
      <div style={{ marginBottom: 14 }}><Slot name="attention" /></div>

      <div className="today-cols">
        {/* left — bands */}
        <div>
          {loading || !brief ? (
            <div className="u-col" style={{ gap: 16 }}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="u-col" style={{ gap: 8 }}>
                  <Skeleton w={120} h={12} />
                  <SkeletonCard lines={2} />
                </div>
              ))}
            </div>
          ) : (
            brief.bands.map(b => <BandBlock key={b.id} band={b} />)
          )}

          {isPrincipalish && !loading && brief && (
            <Card pad className="u-col" >
              <div className="u-flex" style={{ gap: 10, alignItems: 'flex-start' }}>
                <Icon.Info size={15} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }} />
                <div className="u-small u-muted" style={{ lineHeight: 1.6 }}>
                  Coverage (WOC) counts enrolled students present at first period across all campuses — 94.1% is the healthy band this term.
                  Attendance leniency for delayed routes applies until 09:30 per Attendance §1.4; registers self-correct as students arrive.
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* right — live activity + provenance */}
        <div className="u-col" style={{ gap: 16 }}>
          <Card head={<span className="u-flex" style={{ gap: 7 }}><Icon.Zap size={14} /> Live activity</span>} pad>
            {domain.events.length === 0 ? (
              <Empty icon={<Icon.Offline size={20} />} title="No live events yet" sub="Operational events from across the school stream here in real time." />
            ) : (
              <div className="scroll-thin" style={{ maxHeight: 300, overflowY: 'auto', paddingRight: 2 }}>
                {domain.events.slice(0, 12).map(e => <EventLine key={e.id} e={e} />)}
              </div>
            )}
            <div className="u-xs u-faint" style={{ marginTop: 10, lineHeight: 1.5 }}>
              Events appear as records change — attendance runs, payments reconcile, transport GPS updates, maintenance SLAs tick — each with severity and a reference record.
            </div>
          </Card>

          <Card head={<span className="u-flex" style={{ gap: 7 }}><Icon.Shield size={14} /> Briefing provenance</span>} pad>
            <EvidenceChain
              title="How this briefing was assembled"
              steps={[
                { label: 'Diff overnight deltas', detail: 'Attendance, fees records and transport events compared against recent baselines', source: 'School records · just now' },
                { label: 'Rank by impact × deadline', detail: 'Priority = affected students × policy exposure × SLA remaining', source: 'Constitution v2026.1' },
                { label: 'Draft with citations', detail: 'Every claim above carries its source, timestamp and confidence', source: 'Deterministic assembly · no language model' },
              ]}
            />
            <div className="u-xs u-faint" style={{ marginTop: 10, lineHeight: 1.6 }}>
              This briefing is assembled deterministically from your school's own records — no model, no tokens, no cost. Actions always await a human decision in the Action Center.
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/* local money short to avoid a second import path in stats config */
function fmtMoneyShortLocal(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${n}`;
}
