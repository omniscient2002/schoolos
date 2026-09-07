/* ============================================================
   TeacherHome — the Teacher Command Center (plan §P1, §69 bar).

   The teacher's default landing. Zero clicks to understand the
   day (§7 acceptance script, step 1):

     NOW        current period · room · subject · time left ·
                attendance state · [Start lesson] [Take attendance]
                [End lesson] [Ask AI]
     NEXT       next 2–4 commitments (classes, PTMs, exams)
     NEEDS      actionable ranked cards only — never noise
     AT A GLANCE periods · free · duties · deadlines
     WHAT SHOULD I DO NEXT   ranked suggestions with time
                estimates — suggestions only, never auto-act
     BRIEFS     17:00 end-of-day banner (dismissible) + weekly

   Data: GET /teacher/home + /teacher/brief?when=eod|week
   (frozen §4 contracts) via teacherFixtures.ts, which probes the
   live door and falls back to a typed local fixture while the
   server lanes build. Fixture mode is never silent — the page
   carries a visible "Demo data" badge.

   Every card zone exercises the 12-state contract (§P12);
   empty/loading/error/denied are fully real, the remaining
   states render through the honest StateNotice.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { useTeacher } from '../state/teacherContext';
import { PageHead, Card, Badge, Button, Empty, Section } from '../components/ui';
import { Icon } from '../components/Icon';
import { CardStates, StateChip, StateNotice } from '../components/teacher/States';
import { friendly } from '../lib/friendlyErrors';
import { fmtDate, weekday } from '../lib/format';
import {
  getTeacherHome, getTeacherBrief, teacherDoorLive, _resetTeacherDoors,
  type TeacherHomeAggregate, type TeacherNeed, type TeacherBrief,
} from '../services/teacherFixtures';

/* ---------- async card state ---------- */
type DoorPhase<T> = { loading: boolean; data: T | null; err?: string };

function useTeacherDoor<T>(fetcher: () => Promise<{ ok: boolean; data: T | null }>, deps: unknown[], doorKey: 'home' | 'brief') {
  const [phase, setPhase] = useState<DoorPhase<T>>({ loading: true, data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setPhase(p => ({ ...p, loading: true, err: undefined }));
    fetcher()
      .then(r => { if (live) setPhase({ loading: false, data: r.data }); })
      .catch(e => { if (live) setPhase({ loading: false, data: null, err: friendly((e as Error)?.message ?? e) }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, doorKey]);
  return { ...phase, retry: () => setTick(t => t + 1), isFixture: !teacherDoorLive[doorKey] };
}

/* ---------- greeting ---------- */
function greeting(d: Date): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/* ---------- school-day status ---------- */
function dayStatus(agg: TeacherHomeAggregate | null): string {
  if (!agg) return '';
  if (!agg.now && agg.glance.periods === 0) return 'No classes scheduled today';
  if (agg.now) return 'School day in progress';
  if (agg.glance.periods > 0) return 'Classes done for today';
  return '';
}

/* ---------- rank helper (stable, deterministic) ---------- */
const rankSort = (a: { rank: number }, b: { rank: number }) => a.rank - b.rank;

const NEED_META: Record<TeacherNeed['kind'], { label: string; icon: keyof typeof Icon; tone: 'danger' | 'warning' | 'info' }> = {
  submission: { label: 'Homework to review', icon: 'Book', tone: 'danger' },
  concern: { label: 'Concern follow-up', icon: 'Flag', tone: 'warning' },
  substitute: { label: 'Missing substitute', icon: 'Users', tone: 'warning' },
  approval: { label: 'Waiting for approval', icon: 'Clipboard', tone: 'info' },
};

function deadlineBadge(need: TeacherNeed): { label: string; tone: 'danger' | 'warning' | 'neutral' } | null {
  if (!need.deadline) return null;
  const ms = new Date(need.deadline).getTime() - Date.now();
  if (ms <= 0) return { label: 'Overdue', tone: 'danger' };
  const h = ms / 3_600_000;
  if (h < 1) return { label: `${Math.max(1, Math.round(ms / 60_000))}m left`, tone: 'danger' };
  if (h < 24) return { label: `${Math.round(h)}h left`, tone: h <= 4 ? 'danger' : 'warning' };
  return { label: `${Math.round(h / 24)}d left`, tone: 'neutral' };
}

/* ============================================================
   Sub-components
   ============================================================ */

function NeedRow({ need, divider, onOpen }: { need: TeacherNeed; divider: boolean; onOpen: (to: string, need: TeacherNeed) => void }) {
  const meta = NEED_META[need.kind];
  const Ic = Icon[meta.icon];
  const due = deadlineBadge(need);
  const open = () => onOpen(need.to, need);
  return (
    <div
      className={`attention-row ${divider ? 'divider' : ''}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      aria-label={`${need.title}. ${need.detail}`}
    >
      <span className="attention-rail" style={{ background: meta.tone === 'danger' ? 'var(--status-critical)' : meta.tone === 'warning' ? 'var(--status-warning)' : 'var(--border)' }} aria-hidden="true" />
      <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--surface-3)', display: 'grid', placeItems: 'center', flexShrink: 0, color: 'var(--text-2)' }}>
        <Ic size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }} className="u-col">
        <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap', rowGap: 4, alignItems: 'center' }}>
          <span className="att-title">{need.title}</span>
          <Badge tone={meta.tone}>{meta.label}</Badge>
          {due && <Badge tone={due.tone} dot>{due.label}</Badge>}
          {need.state && <StateChip state={need.state} />}
        </div>
        <div className="u-small u-muted att-detail">{need.detail}</div>
      </div>
      <span className="attention-open u-small" style={{ color: 'var(--accent)', fontWeight: 600, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        Open <Icon.ChevronRight size={13} />
      </span>
    </div>
  );
}

function NextRow({ c }: { c: TeacherHomeAggregate['next'][number] }) {
  const { setClassContext, openAction } = useTeacher();
  const icon: Record<string, keyof typeof Icon> = { class: 'Book', duty: 'Users', ptm: 'Users', exam: 'Award', event: 'Calendar' };
  const Ic = Icon[icon[c.kind] ?? 'Calendar'];
  const isClass = c.kind === 'class';
  const open = () => {
    const m = c.title.match(/P(\d+) (.+?) — ([\dA-Za-z-]+) · Room (.+)$/);
    setClassContext(m
      ? { period: Number(m[1]), subject: m[2], classGrade: m[3], room: m[4] }
      : { subject: c.detail });
    openAction('/teacher/attendance');
  };
  return (
    <div
      className={`attention-row ${isClass ? '' : ''}`}
      role="button"
      tabIndex={0}
      onClick={isClass ? open : undefined}
      onKeyDown={isClass ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : undefined}
      aria-label={`${c.title}${isClass ? '. Take attendance for this class.' : ''}`}
      style={isClass ? { cursor: 'pointer' } : undefined}
    >
      <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--surface-3)', display: 'grid', placeItems: 'center', flexShrink: 0, color: 'var(--text-2)' }}>
        <Ic size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="att-title">{c.title}</div>
        <div className="u-xs u-faint" style={{ marginTop: 1 }}>{c.detail} · starts {c.start}</div>
      </div>
      {isClass && <span className="u-xs" style={{ color: 'var(--accent)', fontWeight: 600, flexShrink: 0 }}>Attendance</span>}
    </div>
  );
}

/* ---------- brief banner (17:00 eod + weekly surface) ---------- */
function BriefBanner({ brief, onClose }: { brief: TeacherBrief; onClose: () => void }) {
  return (
    <Card pad className="t-brief-banner" headAs="h2" head={`Your ${brief.span} brief`}>
      <div className="u-flex" style={{ gap: 12, alignItems: 'flex-start' }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--ai-weak)', color: 'var(--ai-text)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon.Sunrise size={17} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="u-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 640 }}>Your day in plain words</span>
            <Badge tone="ai">{brief.span} brief</Badge>
            <span className="u-xs u-faint">Reads in under a minute</span>
          </div>
          <div className="t-brief-grid">
            {brief.sections.map(s => (
              <div key={s.heading}>
                <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{s.heading}</div>
                {s.lines.map((l, i) => <div key={i} className="u-small" style={{ marginTop: 3, lineHeight: 1.55 }}>{l}</div>)}
              </div>
            ))}
          </div>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="Close the brief"><Icon.X size={16} /></button>
      </div>
    </Card>
  );
}

function WeeklyBriefCard({ brief }: { brief: TeacherBrief }) {
  return (
    <Card head={<span className="u-flex" style={{ gap: 7 }}><Icon.Calendar size={14} /> Weekly brief</span>} sub="The week in plain words — pace, workload, what to watch" pad>
      <div className="u-col" style={{ gap: 10 }}>
        {brief.sections.map(s => (
          <div key={s.heading}>
            <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{s.heading}</div>
            {s.lines.map((l, i) => <div key={i} className="u-small" style={{ marginTop: 2, lineHeight: 1.55 }}>{l}</div>)}
          </div>
        ))}
      </div>
      <div className="u-xs u-faint" style={{ marginTop: 10, lineHeight: 1.5 }}>
        Assembled from your own records only. Suggestions only — nothing acts without you.
      </div>
    </Card>
  );
}

/* ============================================================
   Main
   ============================================================ */
export default function TeacherHome() {
  const { session, actorName } = useStore();
  const { setClassContext, openAction } = useTeacher();
  const [briefDismissed, setBriefDismissed] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  /* minute ticker — period-remaining + greeting stay honest */
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const home = useTeacherDoor<TeacherHomeAggregate>(() => getTeacherHome(), [session.roleId], 'home');
  const eod = useTeacherDoor<TeacherBrief>(() => getTeacherBrief('eod'), [session.roleId], 'brief');
  const week = useTeacherDoor<TeacherBrief>(() => getTeacherBrief('week'), [session.roleId], 'brief');

  const isEod = clock.getHours() >= 17;
  const showEodBanner = isEod && !briefDismissed && !!eod.data;

  const loading = home.loading;
  const agg = home.data;
  const source = home.isFixture ? 'fixture' : 'live';

  const now = clock;
  const headSub = `${weekday(now)} · ${fmtDate(now)} · ${dayStatus(agg) || 'Preparing your day'}${agg ? ` · ${agg.glance.periods} period${agg.glance.periods === 1 ? '' : 's'} today` : ''}`;

  const openNeed = (to: string, need: TeacherNeed) => {
    if (need.kind === 'submission') setClassContext({ classGrade: '8-B' });
    openAction(to, { kind: need.kind, classGrade: need.kind === 'submission' ? '8-B' : undefined });
  };

  const suggestions = useMemo(() => (agg?.suggestions ?? []).slice().sort(rankSort), [agg]);
  const needs = useMemo(() => (agg?.needsAttention ?? []).slice().sort(rankSort), [agg]);

  /* ---------- error page (whole-screen) ---------- */
  if (!home.loading && !home.data) {
    return (
      <>
        <PageHead title={<span>{greeting(now)}, {actorName.split(' ').slice(0, 2).join(' ')}</span>} sub={headSub} />
        <Card pad>
          <Empty
            icon={<Icon.Alert size={22} />}
            title="Your day could not load"
            sub={`${home.err ?? 'The school server did not answer.'} Your data is safe — nothing was lost.`}
            action={<Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={home.retry}>Try again</Button>}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHead
        title={<span>{greeting(now)}, {actorName.split(' ').slice(0, 2).join(' ')}</span>}
        sub={loading ? 'Putting your day together…' : headSub}
        actions={
          <span className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            {source === 'fixture' && <Badge tone="accent">Demo data</Badge>}
            <Badge tone={agg?.now ? 'success' : 'neutral'} dot>{agg?.now ? 'Class in session' : 'Between classes'}</Badge>
          </span>
        }
      />

      {/* 17:00 end-of-day brief banner — dismissible, §P1 */}
      {showEodBanner && eod.data && (
        <div style={{ marginBottom: 14 }}>
          <BriefBanner brief={eod.data} onClose={() => setBriefDismissed(true)} />
        </div>
      )}

      {/* ---------- NOW card ---------- */}
      <Section title="Now" sub="What is happening in your classroom this minute">
        {loading ? (
          <Card pad><span className="sr-only" role="status">Loading your current class…</span>
            <div className="u-col" style={{ gap: 8 }}><Icon.Clock size={18} style={{ color: 'var(--text-3)' }} /><div className="u-small u-muted">Reading the timetable…</div></div>
          </Card>
        ) : agg?.now ? (
          <Card pad className="t-now-card">
            <div className="t-now-top">
              <div style={{ minWidth: 0 }}>
                <div className="u-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Badge tone="accent" dot>Period {agg.now.period}</Badge>
                  <span style={{ fontWeight: 650, fontSize: 'var(--text-lg)' }}>{agg.now.subject} · {agg.now.classGrade}</span>
                  <span className="u-small u-muted">Room {agg.now.room}</span>
                </div>
                <div className="u-small u-muted" style={{ marginTop: 4 }}>
                  {agg.now.start}–{agg.now.end} · {Math.max(1, agg.now.endsInMins)} minute{agg.now.endsInMins === 1 ? '' : 's'} left
                </div>
              </div>
              <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Button variant="primary" size="sm" icon={<Icon.Play size={13} />} onClick={() => {
                  setClassContext({ classGrade: agg.now!.classGrade, subject: agg.now!.subject, room: agg.now!.room, period: agg.now!.period });
                  openAction('/teacher/copilot');
                }}>Start lesson</Button>
                <Button variant="secondary" size="sm" icon={<Icon.Clipboard size={13} />} onClick={() => {
                  setClassContext({ classGrade: agg.now!.classGrade, subject: agg.now!.subject, room: agg.now!.room, period: agg.now!.period });
                  openAction('/teacher/attendance');
                }}>Take attendance</Button>
                <Button variant="ghost" size="sm" icon={<Icon.Check size={13} />} onClick={() => setClassContext(null)}>End lesson</Button>
                <Button variant="ai" size="sm" icon={<Icon.Sparkle size={13} />} onClick={() => openAction('/teacher/copilot')}>Ask AI</Button>
              </div>
            </div>
            <div className="t-now-att">
              <span className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Attendance for this class</span>
              <span className="u-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge tone="warning" dot>Not marked yet</Badge>
                <span className="u-xs u-faint">Takes about 30 seconds · absent guardians are told automatically</span>
              </span>
              <StateNotice state="pending" label="attendance" />
            </div>
          </Card>
        ) : (
          <CardStates
            state="empty"
            title={agg && agg.glance.periods > 0 ? 'No class this minute' : 'No classes scheduled today'}
            emptySub={agg && agg.glance.periods > 0
              ? 'You are between commitments. Your next class appears here 10 minutes before it starts.'
              : 'Enjoy the break — your next teaching day will appear here in the morning.'}
          >
            <span />
          </CardStates>
        )}
      </Section>

      {/* ---------- NEXT + right column ---------- */}
      <div className="today-cols" style={{ marginTop: 4 }}>
        <div className="u-col" style={{ gap: 4 }}>
          <Section title="Next" sub="Your coming commitments — classes, duties, meetings">
            {loading ? (
              <Card pad><span className="sr-only" role="status">Loading next commitments…</span>
                <div className="u-col" style={{ gap: 8 }}>
                  <div className="skeleton" style={{ height: 12, width: '40%' }} />
                  <div className="skeleton" style={{ height: 11 }} />
                  <div className="skeleton" style={{ height: 11, width: '70%' }} />
                </div>
              </Card>
            ) : (agg?.next.length ?? 0) === 0 ? (
              <CardStates state="empty" title="Nothing else scheduled" emptySub="No classes, duties or meetings in the next stretch. The list fills from your timetable automatically.">
                <span />
              </CardStates>
            ) : (
              <Card pad={false}>
                {agg!.next.map((c) => <NextRow key={c.id} c={c} />)}
                {agg!.next.length === 0 && null}
              </Card>
            )}
          </Section>

          {/* ---------- NEEDS ATTENTION ---------- */}
          <Section
            title={
              <span className="u-flex" style={{ gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--text-xs)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-2)', fontWeight: 700 }}>Needs your attention</span>
                {!loading && needs.length > 0 && <Badge tone="danger" dot>{needs.length} item{needs.length === 1 ? '' : 's'}</Badge>}
              </span>
            }
            sub="Only what needs a decision from you — ranked, never noise"
          >
            {loading ? (
              <Card pad><span className="sr-only" role="status">Loading items that need you…</span>
                <div className="u-col" style={{ gap: 8 }}>
                  <div className="skeleton" style={{ height: 12, width: '40%' }} />
                  <div className="skeleton" style={{ height: 11 }} />
                  <div className="skeleton" style={{ height: 11, width: '60%' }} />
                </div>
              </Card>
            ) : needs.length === 0 ? (
              <CardStates state="empty" title="All clear" emptySub="Nothing needs you right now. New items appear here as homework, concerns and approvals move.">
                <span />
              </CardStates>
            ) : (
              <Card pad={false} className="needs-card">
                {needs.map((n, i) => <NeedRow key={n.id} need={n} divider={i > 0} onOpen={openNeed} />)}
              </Card>
            )}
            {home.isFixture && (
              <div className="u-xs u-faint" style={{ padding: '8px 14px', borderTop: '1px solid var(--border-subtle)' }}>
                Built from demo data while the school server door is being switched on. Live records replace this automatically.
              </div>
            )}
          </Section>

          {/* ---------- WHAT SHOULD I DO NEXT ---------- */}
          <Section title="What should I do next" sub="Suggestions with time estimates — you decide, nothing acts on its own">
            {loading ? (
              <Card pad><span className="sr-only" role="status">Loading suggestions…</span>
                <div className="u-col" style={{ gap: 8 }}>
                  <div className="skeleton" style={{ height: 12, width: '40%' }} />
                  <div className="skeleton" style={{ height: 11 }} />
                </div>
              </Card>
            ) : suggestions.length === 0 ? (
              <CardStates state="empty" title="No suggestions right now" emptySub="When homework, tests or meetings pile up, you will see the shortest useful list here.">
                <span />
              </CardStates>
            ) : (
              <div className="grid grid-2">
                {suggestions.map(s => (
                  <Card key={s.id} pad className="card-click" onClick={() => openAction(s.to)}>
                    <div className="u-flex" style={{ gap: 9, alignItems: 'flex-start' }}>
                      <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ai-weak)', color: 'var(--ai-text)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                        <Icon.Compass size={14} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, lineHeight: 1.35 }}>{s.title}</div>
                        <div className="u-xs u-muted" style={{ marginTop: 3, lineHeight: 1.5 }}>{s.reason}</div>
                        <div className="u-xs u-faint" style={{ marginTop: 5 }}><Icon.Clock size={11} style={{ verticalAlign: -1 }} /> {s.estimate} · opens {s.to.replace('/teacher/', '').replace('/', ' · ')}</div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* ---------- right rail ---------- */}
        <div className="u-col" style={{ gap: 16 }}>
          {/* TODAY AT A GLANCE */}
          <Section title="Today at a glance">
            {loading ? (
              <Card pad><div className="u-col" style={{ gap: 8 }}>
                <div className="skeleton" style={{ height: 12, width: '50%' }} />
                <div className="skeleton" style={{ height: 11 }} />
              </div></Card>
            ) : (
              <Card pad>
                <div className="t-glance-grid">
                  <div><div className="t-glance-num">{agg?.glance.periods ?? 0}</div><div className="t-glance-label">Periods</div></div>
                  <div><div className="t-glance-num">{agg?.glance.free ?? 0}</div><div className="t-glance-label">Free periods</div></div>
                  <div><div className="t-glance-num">{agg?.glance.duties ?? 0}</div><div className="t-glance-label">Duties</div></div>
                  <div><div className="t-glance-num">{agg?.glance.deadlines ?? 0}</div><div className="t-glance-label">Deadlines</div></div>
                </div>
                <div className="u-xs u-faint" style={{ marginTop: 10, lineHeight: 1.5 }}>
                  Counted from your timetable and the school calendar at {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.
                </div>
                <div style={{ marginTop: 10 }}>
                  <StateChip source={source} />
                </div>
              </Card>
            )}
          </Section>

          {/* Weekly brief surface (§P1) */}
          {week.data && <WeeklyBriefCard brief={week.data} />}

          {!week.loading && !week.data && (
            <Card pad><StateNotice state="error" /></Card>
          )}
        </div>
      </div>
    </>
  );
}

/* keep the dev tools honest about the probe reset hook (used by QA) */
export { _resetTeacherDoors };
