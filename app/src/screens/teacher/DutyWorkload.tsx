/* ============================================================
   DutyWorkload — P8 · my duties + my workload.

   Contract (§4, frozen):
     GET /duty/roster?window=   (today | week | month)
     GET /workload/mine
   FRAMING LAW (P8): workload exists for fairness and burnout
   prevention — NEVER a performance ranking. The screen says so,
   in plain words: "This is for your protection, not your
   rating." No leaderboards, no teacher comparisons, no scores.
   ============================================================ */
import { useState } from 'react';
import {
  Badge, Button, Card, Empty, PageHead, Progress, Section, SkeletonCard, Stat, Tabs, useToast,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { fmtDate, fmtRelative, weekday } from '../../lib/format';
import { roleLabel } from '../../lib/labels';
import { useStore } from '../../state/store';
import {
  listDutyRoster, myWorkload,
  type DutyAssignment,
} from '../../services/teacherApi';
import { AsyncGate, DeniedState, useAsync, useTeacherAccess } from './teacherKit';

const WINDOWS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
] as const;

const DUTY_META: Record<DutyAssignment['kind'], { label: string; icon: keyof typeof Icon; tone: 'info' | 'accent' | 'warning' | 'ai' | 'neutral' }> = {
  invigilation: { label: 'Exam invigilation', icon: 'Clipboard', tone: 'info' },
  corridor: { label: 'Corridor duty', icon: 'Users', tone: 'neutral' },
  assembly: { label: 'Assembly duty', icon: 'Sunrise', tone: 'accent' },
  lunch: { label: 'Lunch duty', icon: 'Users', tone: 'neutral' },
  event: { label: 'Event duty', icon: 'Star', tone: 'ai' },
  substitution: { label: 'Substitution (extra class)', icon: 'Book', tone: 'warning' },
};

export default function DutyWorkload() {
  const toast = useToast();
  const { session, actorName } = useStore();
  const allowed = useTeacherAccess('/teacher/leave');
  const [win, setWin] = useState<'today' | 'week' | 'month'>('week');

  const roster = useAsync(() => listDutyRoster(win), [win]);
  const load = useAsync(() => myWorkload(), []);

  const duties = roster.data?.duties ?? [];
  const upcoming = duties.filter(d => new Date(`${d.date}T23:59`).getTime() >= Date.now());
  const done = duties.filter(d => new Date(`${d.date}T23:59`).getTime() < Date.now());

  const copyRoster = async () => {
    const text = duties.map(d => `${fmtDate(d.date)} ${d.time} — ${DUTY_META[d.kind].label} · ${d.place}`).join('\n');
    try {
      await navigator.clipboard.writeText(text || 'No duties in this window.');
      toast({ title: 'Duty list copied', sub: 'Paste it into notes or a message to yourself.', tone: 'success' });
    } catch {
      toast({ title: 'Copy blocked by the browser', sub: 'Select the list text manually instead.', tone: 'error' });
    }
  };

  if (!allowed) return <DeniedState role={roleLabel(session.roleId)} />;

  return (
    <div>
      <PageHead
        title="Duties & my workload"
        sub={`${weekday(new Date())} · what the roster asks of ${actorName.split(' ')[0]} this ${win === 'today' ? 'day' : win}, and how the total sits against the fair band.`}
      />

      {/* ---- MY WORKLOAD — fairness card (P8: never a ranking) ---- */}
      <AsyncGate state={load} skeleton={<SkeletonCard lines={5} />}>
        {data => {
          const wl = data.workload;
          const dutyish = wl.substitutions + wl.invigilation;
          const bandSpan = Math.max(1, wl.fair_band.max - wl.fair_band.min);
          const pos = Math.min(100, Math.max(0, ((dutyish - wl.fair_band.min) / bandSpan) * 100));
          const inBand = dutyish >= wl.fair_band.min && dutyish <= wl.fair_band.max;
          return (
            <Card pad style={{ marginBottom: 18 }}>
              <div className="u-between u-wrap" style={{ gap: 8, marginBottom: 10 }}>
                <div>
                  <h3 style={{ margin: 0 }}>My workload — {wl.week_label.toLowerCase()}</h3>
                  <span className="u-small u-muted">Everything the week asks of you, in one honest number set.</span>
                </div>
                <Badge tone={inBand ? 'success' : 'warning'} dot>
                  {inBand ? 'Inside the fair band' : 'Above the fair band — flagged for the coordinator, not against you'}
                </Badge>
              </div>

              <div className="grid grid-4" style={{ marginBottom: 12 }}>
                <Stat label="Teaching periods" value={String(wl.periods)} sub="Your timetable this week" />
                <Stat label="Substitutions" value={String(wl.substitutions)} sub="Extra classes taken for others" />
                <Stat label="Invigilation" value={String(wl.invigilation)} sub="Exam-hall sittings" />
                <Stat label="Grading estimate" value={`${Math.round(wl.grading_estimate_mins / 60)}h ${wl.grading_estimate_mins % 60}m`} sub={`+ ${wl.ptm_count} parent meeting${wl.ptm_count === 1 ? '' : 's'} · ${wl.meetings} meeting${wl.meetings === 1 ? '' : 's'}`} />
              </div>

              <div className="u-xs" style={{ fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 4 }}>
                Extra load (substitutions + invigilation) against the fair band {wl.fair_band.min}–{wl.fair_band.max}
              </div>
              <div style={{ position: 'relative' }} role="img" aria-label={`Your extra load is ${dutyish} against a fair band of ${wl.fair_band.min} to ${wl.fair_band.max}. ${inBand ? 'Inside the band.' : 'Above the band — the coordinator is asked to rebalance.'}`}>
                <Progress value={pos} tone={inBand ? undefined : 'warn'} />
                <span aria-hidden="true" style={{
                  position: 'absolute', left: '50%', top: -3, bottom: -3, width: 2, background: 'var(--border-strong)',
                }} />
              </div>

              <div className="u-small u-muted" style={{ marginTop: 10, display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                <Icon.Shield size={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--success)' }} />
                <span>
                  <strong style={{ color: 'var(--text)' }}>This is for your protection, not your rating.</strong>{' '}
                  {wl.note}
                </span>
              </div>
            </Card>
          );
        }}
      </AsyncGate>

      {/* ---- duty roster ---- */}
      <Section
        title="My duties"
        sub="Invigilation, corridor, assembly, lunch, events — and substitutions handed to you."
        actions={
          <Button variant="secondary" size="sm" icon={<Icon.Copy size={13} />} onClick={copyRoster}>
            Copy list
          </Button>
        }
      >
        <Tabs
          tabs={WINDOWS.map(x => ({ id: x.id, label: x.label }))}
          active={win}
          onChange={id => setWin(id as typeof win)}
          pill
          panelId="duty-win"
        />
        <div role="tabpanel" id="duty-win-panel-all" aria-labelledby="duty-win-tab-all">
          <AsyncGate
            state={roster}
            empty={
              <Empty
                icon={<Icon.Check size={22} />}
                title={`No duties ${win === 'today' ? 'today' : win === 'week' ? 'this week' : 'this month'}`}
                sub="Enjoy the quiet stretch — new roster entries appear here the moment they are assigned."
              />
            }
          >
            {({ duties: rows }) => (
              <div className="u-col" style={{ gap: 10 }}>
                {rows.map(d => {
                  const m = DUTY_META[d.kind];
                  const Ic = Icon[m.icon];
                  const past = new Date(`${d.date}T23:59`).getTime() < Date.now();
                  return (
                    <Card key={d.id} pad style={past ? { opacity: .72 } : undefined}>
                      <div className="u-between u-wrap" style={{ gap: 8 }}>
                        <div className="u-flex" style={{ gap: 10, minWidth: 0 }}>
                          <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--surface-3)', display: 'grid', placeItems: 'center', color: 'var(--text-2)', flexShrink: 0 }}>
                            <Ic size={15} />
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div className="u-flex u-wrap" style={{ gap: 8 }}>
                              <span style={{ fontWeight: 600 }}>{m.label}</span>
                              {d.source === 'substitution' && <Badge tone="warning">Extra — from a substitution</Badge>}
                              {past && <Badge tone="neutral">Done</Badge>}
                            </div>
                            <div className="u-small u-muted">
                              {weekday(d.date)} · {fmtDate(d.date)} · {d.period_label} ({d.time}) · {d.place}
                            </div>
                          </div>
                        </div>
                        {!past && <span className="u-small" style={{ color: 'var(--accent)', fontWeight: 600 }}>{fmtRelative(d.date)}</span>}
                      </div>
                    </Card>
                  );
                })}
                {upcoming.length > 0 && done.length > 0 && (
                  <div className="u-xs u-faint">{upcoming.length} coming · {done.length} completed in this window.</div>
                )}
              </div>
            )}
          </AsyncGate>
        </div>
      </Section>

      <Section title="How the roster treats you" sub="The rules, in plain words">
        <Card pad>
          <div className="u-col u-small u-muted" style={{ gap: 6 }}>
            <span>1. A duty slot is unique per teacher, date, kind and period, so the same duty is never assigned to you twice.</span>
            <span>2. If substitutions push your extra load above the fair band, the coordinator sees the imbalance and rebalances — you do not have to argue your case.</span>
            <span>3. Duty changes are recorded by the coordinator, so nobody is marked absent by mistake.</span>
          </div>
        </Card>
      </Section>
    </div>
  );
}
