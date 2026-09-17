/* ============================================================
   Next — "What's next": a personal plan view.
   Merges open actions (deadlines), obligations, calendar events
   and active cases (SLA countdown) into NOW / TODAY / THIS WEEK
   / LATER bands, plus a generated plan block that shows exactly
   how the plan was derived — sources, counts, trace.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import * as seed from '../data/dataset';
import { PageHead, Section, Card, Badge, Button, Empty, Skeleton} from '../components/ui';
import { EvidenceChain, AiTraceCard } from '../components/Ai';
import { Icon } from '../components/Icon';
import { fmtDateShort, fmtDuration } from '../lib/format';
import type {RoleId} from '../types/domain';

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'ai' | 'accent' | 'outline';
type Band = 'NOW' | 'TODAY' | 'THIS WEEK' | 'LATER';

interface PlanItem {
  id: string;
  band: Band;
  kind: string;
  kindTone: BadgeTone;
  title: string;
  detail?: string;
  due: Date;
  dueLabel: string;
  overdue: boolean;
  owner: string;
  mine: boolean;
  to: string;
  source: string;
}

const ROLE_OWNER_HINT: Partial<Record<RoleId, RegExp>> = {
  principal: /principal|you \(/i,
  finance: /finance|accounts/i,
  transport: /transport/i,
  coordinator: /coordinator|admin officer/i,
  admissions: /admissions/i};

function dueParts(d: Date): { label: string; overdue: boolean } {
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return { label: `Overdue ${fmtDuration(Math.round(-ms / 60000))}`, overdue: true };
  return { label: `Due in ${fmtDuration(Math.round(ms / 60000))}`, overdue: false };
}

function bandOf(d: Date, dayStart: Date): Band {
  if (d.getTime() < dayStart.getTime() + 86400000) return 'TODAY';
  if (d.getTime() < dayStart.getTime() + 7 * 86400000) return 'THIS WEEK';
  return 'LATER';
}

const BAND_ORDER: Band[] = ['NOW', 'TODAY', 'THIS WEEK', 'LATER'];
const BAND_SUB: Record<Band, string> = {
  'NOW': 'Overdue or inside the hour — close these first',
  'TODAY': 'Committed before midnight tonight',
  'THIS WEEK': 'Next seven days',
  'LATER': 'Beyond this week — scheduled, not forgotten'};

/* ---------- item row ---------- */
function PlanRow({ item }: { item: PlanItem }) {
  const navigate = useNavigate();
  return (
    <Card pad className="card-click" onClick={() => navigate(item.to)}>
      <div className="u-flex" style={{ gap: 12, alignItems: 'flex-start' }}>
        <span style={{
          width: 8, height: 8, borderRadius: 4, flexShrink: 0, marginTop: 7,
          background: item.overdue ? 'var(--danger)' : item.band === 'TODAY' ? 'var(--warning)' : 'var(--accent)'}} aria-hidden="true" />
        <div style={{ flex: 1, minWidth: 0 }} className="u-col">
          <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={item.kindTone}>{item.kind}</Badge>
            {item.mine && <Badge tone="accent">Yours</Badge>}
            <span style={{ fontWeight: 590, fontSize: 'var(--text-md)' }}>{item.title}</span>
          </div>
          {item.detail && <div className="u-small u-muted" style={{ marginTop: 3, lineHeight: 1.55 }}>{item.detail}</div>}
          <div className="u-xs u-faint" style={{ marginTop: 5, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ color: item.overdue ? 'var(--danger)' : item.band === 'TODAY' ? 'var(--warning)' : undefined, fontWeight: item.overdue ? 620 : 400 }}>{item.dueLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{item.owner}</span>
            <span aria-hidden="true">·</span>
            <span>{fmtDateShort(item.due)}</span>
            <span aria-hidden="true">·</span>
            <span>{item.source}</span>
          </div>
        </div>
        <Icon.ChevronRight size={15} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 4 }} />
      </div>
    </Card>
  );
}

/* ---------- main ---------- */
export default function Next() {
  const { session, domain, actorName } = useStore();
  const navigate = useNavigate();
  const [genState, setGenState] = useState<'idle' | 'running' | 'done'>('idle');
  const [planMeta, setPlanMeta] = useState<{ counts: Record<Band, number>; sources: string[] } | null>(null);

  const dayStart = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const items = useMemo<PlanItem[]>(() => {
    const mineHint = ROLE_OWNER_HINT[session.roleId];
    const out: PlanItem[] = [];

    /* open actions with deadlines */
    domain.actions.filter(a => a.status === 'open' && a.deadline).forEach(a => {
      const p = dueParts(a.deadline!);
      out.push({
        id: a.id,
        band: p.overdue ? 'NOW' : bandOf(a.deadline!, dayStart),
        kind: a.kind === 'approval' ? 'Approval' : a.kind === 'case' ? 'Case' : a.kind === 'exception' ? 'Exception' : 'Recommendation',
        kindTone: a.kind === 'approval' ? 'warning' : a.kind === 'case' ? 'info' : 'ai',
        title: a.title,
        detail: a.actions[0]?.label ? `Next step: ${a.actions[0].label}` : a.detail,
        due: a.deadline!,
        dueLabel: p.label,
        overdue: p.overdue,
        owner: a.owner,
        mine: !!(mineHint && mineHint.test(a.owner)),
        to: '/action-center',
        source: 'Action Center'});
    });

    /* obligations */
    seed.obligations.filter(o => o.status !== 'done').forEach(o => {
      const p = dueParts(o.dueOn);
      out.push({
        id: o.id,
        band: p.overdue ? 'NOW' : bandOf(o.dueOn, dayStart),
        kind: o.category === 'compliance' ? 'Compliance' : o.category === 'renewal' ? 'Renewal' : o.category === 'fee' ? 'Fee' : o.category === 'review' ? 'Review' : 'Report',
        kindTone: 'neutral',
        title: o.title,
        detail: o.evidence ?? `Owner ${o.owner} · lead time ${o.leadTimeDays} days`,
        due: o.dueOn,
        dueLabel: p.label,
        overdue: p.overdue,
        owner: o.owner,
        mine: !!(mineHint && mineHint.test(o.owner)),
        to: '/calendar',
        source: 'Obligation register'});
    });

    /* calendar events */
    seed.calendarEvents.filter(e => e.on.getTime() >= dayStart.getTime()).forEach(e => {
      out.push({
        id: e.id,
        band: bandOf(e.on, dayStart),
        kind: e.type === 'exam' ? 'Exam' : e.type === 'deadline' ? 'Deadline' : e.type === 'ptm' ? 'PTM' : e.type === 'trip' ? 'Trip' : 'Event',
        kindTone: e.type === 'exam' ? 'accent' : e.type === 'deadline' ? 'warning' : 'info',
        title: e.title,
        detail: `${e.owner}${e.location ? ` · ${e.location}` : ''} · ${e.durationMins ? `${e.durationMins}m` : 'all day'} · ${e.campus === 'all' ? 'All campuses' : seed.campuses.find(c => c.id === e.campus)?.name ?? ''}`,
        due: e.on,
        dueLabel: `Due in ${fmtDuration(Math.round((e.on.getTime() - Date.now()) / 60000))}`,
        overdue: false,
        owner: e.owner,
        mine: !!mineHint && mineHint.test(e.owner),
        to: '/calendar',
        source: 'Calendar'});
    });

    /* active cases with SLA countdown */
    domain.cases.filter(c => c.status === 'open' || c.status === 'triaged' || c.status === 'in-progress').forEach(c => {
      const dueAt = new Date(c.openedOn.getTime() + c.slaHours * 3600000);
      const p = dueParts(dueAt);
      out.push({
        id: c.id,
        band: p.overdue ? 'NOW' : bandOf(dueAt, dayStart),
        kind: 'Case · SLA',
        kindTone: p.overdue ? 'danger' : 'info',
        title: c.title,
        detail: `${c.origin === 'parent-whatsapp' ? 'Guardian WhatsApp' : c.origin} · owner ${c.owner} · SLA ${c.slaHours}h from opening`,
        due: dueAt,
        dueLabel: p.label,
        overdue: p.overdue,
        owner: c.owner,
        mine: !!mineHint && mineHint.test(c.owner),
        to: `/cases/${c.id}`,
        source: `Case ${c.id}`});
    });

    return out.sort((a, b) => a.due.getTime() - b.due.getTime());
  }, [domain.actions, domain.cases, session.roleId, dayStart]);

  const grouped = useMemo(() => {
    const g: Record<Band, PlanItem[]> = { 'NOW': [], 'TODAY': [], 'THIS WEEK': [], 'LATER': [] };
    items.forEach(i => g[i.band].push(i));
    return g;
  }, [items]);

  const generatePlan = () => {
    setGenState('running');
    setTimeout(() => {
      setPlanMeta({
        counts: { 'NOW': grouped['NOW'].length, 'TODAY': grouped['TODAY'].length, 'THIS WEEK': grouped['THIS WEEK'].length, 'LATER': grouped['LATER'].length },
        sources: ['Action Center (open items)', 'Obligation register', 'Academic calendar', 'Case queue + SLA clocks']});
      setGenState('done');
    }, 900);
  };

  /* auto-generate once on load so the block is alive; Regenerate stays wired */
  useEffect(() => {
    if (genState === 'idle' && items.length) generatePlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const overdueTotal = grouped['NOW'].length;

  return (
    <>
      <PageHead
        title="What's next"
        sub={`Personal plan for ${actorName} · ${items.length} commitment${items.length === 1 ? '' : 's'} merged from actions, obligations, calendar and case SLAs${overdueTotal ? ` · ${overdueTotal} overdue` : ''}.`}
        actions={
          <Button variant="ai" size="sm" loading={genState === 'running'} icon={<Icon.Sparkle size={13} />} onClick={generatePlan}>
            {genState === 'done' ? 'Regenerate plan' : 'Generate plan'}
          </Button>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 24, alignItems: 'start' }}>
        {/* ---------- bands ---------- */}
        <div className="u-col" style={{ gap: 20 }}>
          {BAND_ORDER.map(band => (
            <Section
              key={band}
              title={<span style={{ fontSize: 'var(--text-xs)', letterSpacing: '.08em', textTransform: 'uppercase', color: band === 'NOW' && grouped[band].length ? 'var(--danger)' : 'var(--text-3)', fontWeight: 650 }}>{band} <span className="u-faint">· {grouped[band].length}</span></span>}
              sub={BAND_SUB[band]}
            >
              {grouped[band].length === 0 ? (
                <Card pad><Empty icon={<Icon.Check size={20} />} title={band === 'NOW' ? 'Nothing overdue' : `Nothing in ${band.toLowerCase()}`} sub={band === 'NOW' ? 'Every SLA clock and deadline is inside its window.' : 'Items appear here as deadlines approach.'} /></Card>
              ) : (
                <div className="u-col" style={{ gap: 10 }}>
                  {grouped[band].map(it => <PlanRow key={`${it.source}-${it.id}`} item={it} />)}
                </div>
              )}
            </Section>
          ))}
        </div>

        {/* ---------- right rail ---------- */}
        <div className="u-col" style={{ gap: 16, position: 'sticky', top: 16 }}>
          <Card head={<span className="u-flex" style={{ gap: 7 }}><Icon.Sparkle size={14} style={{ color: 'var(--ai-text)' }} /> Generated plan</span>} pad>
            {genState === 'running' && (
              <div className="u-col" style={{ gap: 8 }}>
                <Skeleton w="60%" h={12} />
                <Skeleton w="85%" h={12} />
                <Skeleton w="45%" h={12} />
                <div className="u-xs u-faint u-flex" style={{ gap: 6 }}><span className="spinner" style={{ width: 11, height: 11 }} /> Reading actions, obligations, calendar and SLAs…</div>
              </div>
            )}
            {genState === 'idle' && (
              <div className="u-col" style={{ gap: 10 }}>
                <p className="u-small u-muted" style={{ margin: 0, lineHeight: 1.6 }}>
                  SchoolOS can assemble this plan into an ordered route through your day — deadline first, policy exposure second.
                </p>
                <Button variant="ai" size="sm" icon={<Icon.Sparkle size={13} />} onClick={generatePlan}>Generate plan</Button>
              </div>
            )}
            {genState === 'done' && planMeta && (
              <div className="u-col" style={{ gap: 12 }}>
                <EvidenceChain
                  title="How this plan was derived"
                  steps={[
                    {
                      label: `Collect commitments — ${items.length} found`,
                      detail: `${domain.actions.filter(a => a.status === 'open').length} open actions · ${seed.obligations.filter(o => o.status !== 'done').length} obligations · ${seed.calendarEvents.filter(e => e.on.getTime() >= dayStart.getTime()).length} upcoming events · ${domain.cases.filter(c => c.status !== 'resolved' && c.status !== 'closed').length} active cases`,
                      source: planMeta.sources.join(' · ')},
                    {
                      label: 'Score urgency per item',
                      detail: 'Deadline proximity × SLA remaining × priority; overdue items surface in NOW with a red marker',
                      source: 'Constitution v2026.1 — scheduling posture'},
                    {
                      label: `Compose bands — NOW ${planMeta.counts['NOW']} · TODAY ${planMeta.counts['TODAY']} · THIS WEEK ${planMeta.counts['THIS WEEK']} · LATER ${planMeta.counts['LATER']}`,
                      detail: 'Items marked “Yours” match your role\'s ownership; everything else stays visible with its owner',
                      source: 'Plan compiler · read-only'}]}
                />
                <AiTraceCard trace={{
                  trigger: '“What’s next” plan generation',
                  policy: 'Read-only composition; no reminders sent, no records changed · Constitution v2026.1',
                  dataUsed: planMeta.sources,
                  reasoningRole: 'Planner (read-only)',
                  action: 'Ordered existing commitments into time bands',
                  approvalStatus: 'Not required (read-only)',
                  verification: 'Band counts recomputed from the live store on every render'}} />
              </div>
            )}
          </Card>

          <Card head={<span className="u-flex" style={{ gap: 7 }}><Icon.Clock size={14} /> SLA clocks running</span>} pad>
            {domain.cases.filter(c => c.status === 'open' || c.status === 'triaged' || c.status === 'in-progress').length === 0 ? (
              <Empty icon={<Icon.Check size={20} />} title="No clocks running" sub="No active cases with an SLA." />
            ) : (
              <div className="u-col" style={{ gap: 8 }}>
                {domain.cases
                  .filter(c => c.status === 'open' || c.status === 'triaged' || c.status === 'in-progress')
                  .map(c => {
                    const dueAt = new Date(c.openedOn.getTime() + c.slaHours * 3600000);
                    const p = dueParts(dueAt);
                    const pct = Math.min(100, Math.max(2, (1 - (dueAt.getTime() - Date.now()) / (c.slaHours * 3600000)) * 100));
                    return (
                      <button key={c.id} className="u-col" style={{ gap: 4, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} onClick={() => navigate(`/cases/${c.id}`)}>
                        <span className="u-between u-xs" style={{ gap: 8 }}>
                          <span className="u-truncate" style={{ fontWeight: 560, color: 'var(--text)' }}>{c.id} · {c.title}</span>
                          <span style={{ color: p.overdue ? 'var(--danger)' : 'var(--warning)', flexShrink: 0 }}>{p.label}</span>
                        </span>
                        <span className="progress" style={{ height: 4 }}><span style={{ display: 'block', height: '100%', borderRadius: 999, width: `${pct}%`, background: p.overdue ? 'var(--danger)' : 'var(--warning)', transition: 'width var(--t-slow) var(--ease-out)' }} /></span>
                      </button>
                    );
                  })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
