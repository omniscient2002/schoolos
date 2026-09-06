/* ============================================================
   Student home — "My Day" for Aarav Sharma (8-B). A calm,
   warm vertical rhythm: today, due soon, growth, school life.
   No feeds, no streaks, no red alerts.
   ============================================================ */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import * as seed from '../data/dataset';
import { useStore } from '../state/store';
import { Avatar, Badge, Button, Card, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtDate, fmtDateShort, fmtTime, weekday } from '../lib/format';

/* ---------- data anchors (per brief) ----------
   seed.DEMO_STUDENT — Aarav Sharma, Grade 8-B, North Campus — and
   seed.DEMO_GUARDIAN (Kavita Sharma) are the fixed demo pair. All
   guardian/fee/attendance data flows from these, never a hard-coded id. */
const ME = seed.DEMO_STUDENT;

const SUBJECT_COLOR: Record<string, string> = {
  Mathematics: 'var(--accent)',
  Science: 'var(--info)',
  English: 'var(--ai)',
  'Social Studies': 'var(--warning)',
};

export default function StudentHome() {
  const toast = useToast();
  const { session } = useStore();

  /* ---- attendance ----
     Today's seed may record Aarav absent during the Bus 14 week; the
     leniency policy (Attendance §1.4) marks delayed-route riders present
     until 09:30 — that is what the student sees. */
  const todayKey = seed.TERM_DAYS[seed.TERM_DAYS.length - 1].getTime();
  const att = seed.attendance.find(a => a.studentId === ME.id && a.date.getTime() === todayKey);
  const attLabel = !att || att.status === 'present'
    ? 'Marked present'
    : att.status === 'late'
      ? 'Marked present (arrived late)'
      : att.status === 'excused'
        ? 'Excused today'
        : 'Marked present under transport leniency';

  /* ---- periods ---- */
  const section = seed.sectionOfStudent(ME);
  const dow = new Date().getDay();
  const periods = useMemo(() =>
    seed.timetable
      .filter(t => t.sectionId === (section?.id ?? '') && t.day === (dow === 0 ? 6 : dow) && t.period <= 3)
      .sort((a, b) => a.period - b.period),
  [section?.id, dow]);

  /* ---- getting home ----
     seed.DEMO_STUDENT holds no busRoute, so the bus card shows the
     "Day scholar" chip instead (the route branch stays for riders). */
  const route = ME.busRoute ? seed.busRoutes.find(r => r.name === ME.busRoute) : undefined;

  /* ---- school life ---- */
  const nextEvent =
    seed.calendarEvents
      .filter(e => (e.campus === ME.campus || e.campus === 'all') && (e.type === 'event' || e.type === 'trip') && e.on.getTime() > Date.now())
      .sort((a, b) => a.on.getTime() - b.on.getTime())[0];


  const firstName = ME.name.split(' ')[0];

  return (
    <div style={{ maxWidth: 780, margin: '0 auto' }}>
      {/* ---------- greeting ---------- */}
      <div className="u-flex" style={{ gap: 14, marginBottom: 22 }}>
        <Avatar name={ME.name} size="lg" />
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>Hi {firstName}</h1>
          <div className="u-muted">{weekday(new Date())}, {fmtDate(new Date())} · Grade {ME.grade}-{ME.section}</div>
        </div>
      </div>

      <div className="u-col" style={{ gap: 16 }}>
        {/* ---------- today ---------- */}
        <Card headAs="h2" head="Today">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: 12 }}>
              <div className="u-upper" style={{ marginBottom: 6 }}>Attendance</div>
              <Badge tone="success" dot>{attLabel}</Badge>
              <div className="u-small u-muted" style={{ marginTop: 8 }}>
                {att && att.status === 'absent'
                  ? 'Bus 14 was delayed this morning, so attendance leniency applies until 09:30.'
                  : 'Your attendance is steady — nothing to worry about.'}
              </div>
            </div>

            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: 12 }}>
              <div className="u-upper" style={{ marginBottom: 6 }}>First periods</div>
              {periods.length === 0
                ? <div className="u-small u-muted">Timetable arrives here by 7:30.</div>
                : (
                  <div className="u-col" style={{ gap: 5 }}>
                    {periods.map(p => (
                      <div key={p.id} className="u-flex u-small" style={{ gap: 8 }}>
                        <span className="u-faint tnum" style={{ width: 42 }}>{p.start}</span>
                        <span className="u-truncate" style={{ fontWeight: 550 }}>{p.subject}</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>

            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: 12 }}>
              <div className="u-upper" style={{ marginBottom: 6 }}>Bus home</div>
              {route ? (
                <>
                  <Badge tone={route.status === 'on-time' ? 'success' : 'warning'} dot>
                    {route.status === 'on-time' ? 'On time' : `Delayed ${route.delayMins ?? 13} min`}
                  </Badge>
                  <div className="u-small u-muted" style={{ marginTop: 8 }}>
                    {route.status === 'delayed'
                      ? 'Bus 14 is running about 13 minutes late today — your evening pickup is unaffected.'
                      : `Bus 14 leaves at the usual time · ${route.stops[0]?.name ?? 'Sector 12'}`}
                  </div>
                </>
              ) : (
                <>
                  <Badge tone="neutral" dot>Day scholar</Badge>
                  <div className="u-small u-muted" style={{ marginTop: 8 }}>
                    You go home with your family — no school bus seat this year.
                  </div>
                </>
              )}
            </div>
          </div>
        </Card>

        {/* ---------- due soon ---------- */}
        <Card
          head="Due soon"
          actions={<Link to="/student/learning" className="u-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, minHeight: 32, padding: '0 4px' }}>Open learning <Icon.ArrowRight size={12} /></Link>}
        >
          <div className="u-col" style={{ gap: 10 }}>
            <DueCard subject="Mathematics" color={SUBJECT_COLOR.Mathematics} title="Equivalent fractions — practice set 3" due="Due Friday" />
            <DueCard subject="English" color={SUBJECT_COLOR.English} title="Monsoon poem — final draft" due="Due next Wednesday" />
          </div>
        </Card>

        {/* ---------- growth ---------- */}
        <Card headAs="h2" head="Your growth">
          <div className="u-between" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 590 }}>Equivalent fractions — getting there.</div>
              <div className="u-small u-muted">4 practice problems are ready. Ten minutes today and you&apos;ll have it.</div>
            </div>
            <Button variant="primary" icon={<Icon.Play size={13} />} onClick={() => toast({ title: 'Practice set opened', sub: 'Four gentle problems — take your time.', tone: 'success' })}>
              Start
            </Button>
          </div>
        </Card>

        {/* ---------- school life ---------- */}
        <Card headAs="h2" head="School life">
          <div className="u-col" style={{ gap: 10 }}>
            {nextEvent && (
              <div className="u-flex" style={{ gap: 10, padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
                <Icon.Sparkle size={16} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontWeight: 570 }}>{nextEvent.title}</div>
                  <div className="u-small u-muted">{fmtDateShort(nextEvent.on)} · {fmtTime(nextEvent.on)}{nextEvent.location ? ` · ${nextEvent.location}` : ''}</div>
                </div>
              </div>
            )}
            <div className="u-flex" style={{ gap: 10, padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
              <Icon.Users size={16} style={{ color: 'var(--info)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 570 }}>Heritage club — Thursday, 3:30 pm</div>
                <div className="u-small u-muted">Planning the old-town walk. New members can just show up.</div>
              </div>
            </div>
          </div>
        </Card>

        {/* ---------- help ---------- */}
        <Card headAs="h2" head="Need help?" style={{ marginBottom: 8 }}>
          <div className="u-small u-muted" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <span className="u-flex" style={{ gap: 8 }}>
              <Icon.Heart size={15} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 2 }} />
              <span>School counsellor — Ms. Leela Menon, Room 12. Drop in any lunch break, or ask your class teacher.</span>
            </span>
            <span className="u-flex" style={{ gap: 8 }}>
              <Icon.Phone size={15} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 2 }} />
              <span>Front office — +91 80 4711 2200, 07:30–17:00 on school days.</span>
            </span>
          </div>
          {session.roleId === 'student' && (
            <div className="u-xs u-faint" style={{ marginTop: 12 }}>Everything on this page is about you only — your teachers choose what appears here.</div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ---------- small pieces ---------- */
function DueCard({ subject, color, title, due }: { subject: string; color: string; title: string; due: string }) {
  return (
    <div className="u-flex" style={{ gap: 10, padding: '11px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
      <span className="u-xs" style={{ padding: '2px 9px', borderRadius: 999, background: `color-mix(in srgb, ${color} 12%, transparent)`, color, fontWeight: 600, flexShrink: 0 }}>{subject}</span>
      <span style={{ flex: 1, minWidth: 0, fontWeight: 550 }} className="u-truncate">{title}</span>
      <span className="u-small u-faint" style={{ flexShrink: 0 }}>{due}</span>
    </div>
  );
}
