/* ============================================================
   StudentHome2 — "My Day" over the LIVE student doors (SU-1).
   The §90 sketch, in plain language: today, what needs attention,
   your own progress, quick access, tomorrow's bag, and paper.

   Rules it obeys: school-computer first (wide, keyboard-complete,
   printable), session-isolation UX on student role, NO push
   notifications, NO streaks, NO engagement loops, facts never
   ranks, no red alerts.

   Doors consumed (may be mid-build → calm empty/error states):
   GET /student/home · GET /student/session · GET /student/print/mine
   POST /student/print (via PrintButton) · POST /student/tasks/:id/toggle
   ============================================================ */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../App';
import { useStore } from '../../state/store';
import { Avatar, Badge, Button, Card, Empty, ErrorState, Modal, Skeleton, SkeletonCard, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PrintButton } from '../../components/student/PrintButton';
import { SessionSafety } from '../../components/student/SessionSafety';
import {
  getSession, getMyPrints, getStudentHome, toggleTask, PRINT_KIND_LABEL, submitWellbeing,
  WELLBEING_CATEGORY_LABEL, STUDENT_DEFAULT_IDLE_MINUTES,
  type StudentAttentionItem, type StudentHomeData, type StudentPrintJob, type StudentSessionData,
  type StudentWellbeingCategory,
} from '../../services/studentApi';
import { friendly } from '../../lib/friendlyErrors';
import { fmtDate, weekday } from '../../lib/format';

/* ---------- print sheet: chrome disappears, the day prints ---------- */
const PRINT_CSS = `
@media print {
  .topbar, .sidebar, .mobile-tabbar, .toast-stack, .ai-dock, .ai-scrim, .skip-link,
  [data-print="hide"] { display: none !important; }
  html, body { background: #fff !important; }
  body * { color: #111 !important; text-shadow: none !important; box-shadow: none !important; }
  .card, .empty { border-color: #bbb !important; background: #fff !important; break-inside: avoid; }
  .badge { border: 1px solid #999 !important; }
  .print-only { display: block !important; }
  @page { margin: 14mm; }
}
.print-only { display: none; }
`;

/* ticked-off state for checklist rows lives in sessionStorage (dies with
   the tab) — shared-computer hygiene: nothing about a student outlives
   their tab. Server-backed rows win unless locally overridden. */
const DONE_KEY = 'schoolos.student2.doneOverrides';
const todayKey = () => new Date().toDateString();
function readDone(): Record<string, boolean> {
  try {
    const raw = sessionStorage.getItem(DONE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as { day?: string; overrides?: Record<string, boolean> };
    return v && v.day === todayKey() && v.overrides ? v.overrides : {};
  } catch { return {}; }
}

/* quick access targets — only routes that exist for students today.
   `soon` tiles are honest: they say so instead of dead-ending. */
type Tile = { key: string; label: string; icon: keyof typeof Icon; to?: string; soon?: boolean; print?: boolean };
const TILES: Tile[] = [
  { key: 'homework', label: 'Homework', icon: 'Clipboard', to: '/student/learning' },
  { key: 'study', label: 'Study', icon: 'Book', soon: true },
  { key: 'results', label: 'Results', icon: 'Insights', soon: true },
  /* T505: Timetable tile removed — it deep-linked the demo /student route
     (demo-blob surface, crash-prone outside the demo world) and no live
     student timetable route exists; today's classes render on this home. */
  { key: 'portfolio', label: 'Portfolio', icon: 'Award', to: '/student/portfolio' },
  { key: 'help', label: 'Get help', icon: 'Heart' },
  { key: 'print', label: 'Print', icon: 'File', print: true },
];

const KIND_BADGE: Record<StudentAttentionItem['kind'], { tone: 'outline' | 'info' | 'accent'; label: string } | null> = {
  assignment: { tone: 'outline', label: 'Homework' },
  exam: { tone: 'info', label: 'Test' },
  task: { tone: 'accent', label: 'My task' },
  other: null,
};

/* My day code: this portal's 12-char register code for today. Show it (or the slip) when the
   teacher takes the register by codes — it dies at midnight, so yesterday's buys nothing. */
function DayCode() {
  const [code, setCode] = useState<{ code: string; day: string } | null>(null);
  useEffect(() => {
    let dead = false;
    import('../../services/liveApi').then(({ apiGet }) =>
      apiGet<{ code: string; day: string }>('/attendance/my-qr')
        .then(r => { if (!dead) setCode(r); })
        .catch(() => { if (!dead) setCode(null); }));
    return () => { dead = true; };
  }, []);
  if (!code) return null;
  return (
    <Card headAs="h2" head="My day code" sub="Show this when the register is taken by codes.">
      <div className="mono" style={{ fontSize: 26, fontWeight: 800, letterSpacing: 3 }}>{code.code}</div>
      <div className="u-xs u-faint" style={{ marginTop: 4 }}>Today only — a new code every day.</div>
    </Card>
  );
}

export default function StudentHome2() {
  const toast = useToast();
  const live = useSession();
  const { session: demoSession } = useStore();

  const [home, setHome] = useState<StudentHomeData | null>(null);
  const [homeErr, setHomeErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<StudentSessionData | null>(null);
  const [prints, setPrints] = useState<StudentPrintJob[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>(readDone);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpCategory, setHelpCategory] = useState<StudentWellbeingCategory>('academic_pressure');
  const [helpDetail, setHelpDetail] = useState('');
  const [helpAnon, setHelpAnon] = useState(false);
  const [helpSending, setHelpSending] = useState(false);

  const retry = () => setReloadKey(k => k + 1);

  /* main door — the whole page hangs off it */
  useEffect(() => {
    let dead = false;
    setLoading(true);
    setHomeErr(null);
    getStudentHome()
      .then(d => { if (!dead) setHome(d); })
      .catch(e => { if (!dead) setHomeErr(friendly(e)); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [reloadKey]);

  /* session door — silent if mid-build; banner still shows with the
     plan-default idle timeout (the server enforces the real one) */
  useEffect(() => {
    let dead = false;
    getSession().then(d => { if (!dead) setSession(d); }).catch(() => { /* door mid-build */ });
    return () => { dead = true; };
  }, [reloadKey]);

  /* student's own print jobs — silent if mid-build; section hides */
  const loadPrints = () => {
    getMyPrints().then(d => setPrints(d.jobs)).catch(() => setPrints(null));
  };
  useEffect(() => { loadPrints(); }, [reloadKey]);

  const persistDone = (next: Record<string, boolean>) => {
    setOverrides(next);
    try { sessionStorage.setItem(DONE_KEY, JSON.stringify({ day: todayKey(), overrides: next })); } catch { /* storage blocked */ }
  };

  const handleToggle = async (item: StudentAttentionItem, next: boolean) => {
    const prev = overrides;
    persistDone({ ...prev, [item.id]: next });
    /* server-backed tasks persist through the toggle door; the rest are
       day-notes — the school's list stays authoritative on next sign-in */
    if (item.kind === 'task' && item.taskId) {
      setBusyId(item.id);
      try {
        await toggleTask(item.taskId, next);
      } catch (e) {
        persistDone(prev); // revert — the tick must mean something
        toast({ title: 'That did not save', sub: friendly(e), tone: 'error' });
      } finally {
        setBusyId(null);
      }
    }
  };

  const isStudent = live.role === 'student' || demoSession.roleId === 'student';
  const fullName = session?.name ?? live.name ?? '';
  const firstName = fullName.split(' ')[0] || 'there';
  const classLabel = session?.classLabel;
  const dateLine = `${weekday(new Date())}, ${fmtDate(new Date())}`;

  const scrollToPrint = () => {
    const el = document.getElementById('student2-print');
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    (el as HTMLElement).focus({ preventScroll: true });
  };

  const openSoon = (label: string) => {
    toast({ title: `${label} is coming soon`, sub: 'Your teacher has paper copies at school in the meantime.', tone: 'info' });
  };

  /* PRD-7: file a wellbeing request to the counselor plane (named by default; anonymous
     stores no identity). This is the student's own private channel — never a broadcast. */
  const sendHelp = async () => {
    if (!helpDetail.trim()) return;
    setHelpSending(true);
    try {
      const r = await submitWellbeing({ category: helpCategory, detail: helpDetail, anonymous: helpAnon });
      setHelpOpen(false);
      setHelpDetail('');
      toast({ title: 'Sent to the counselor', sub: r.note || 'The counselor will follow up.', tone: 'success' });
    } catch (e) {
      toast({ title: 'Could not send', sub: friendly(e), tone: 'error' });
    } finally { setHelpSending(false); }
  };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <style>{PRINT_CSS}</style>

      {/* print-only sheet header (screen: hidden) */}
      <div className="print-only" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 650, fontSize: 16 }}>My Day — {fullName || 'Student'}</div>
        <div style={{ fontSize: 12 }}>{dateLine}{classLabel ? ` · ${classLabel}` : ''}</div>
      </div>

      {/* session safety — student role only */}
      {isStudent && (
        <SessionSafety
          idleMinutes={session?.idleTimeoutMinutes ?? STUDENT_DEFAULT_IDLE_MINUTES}
          signedInAt={session?.loggedInAt ?? null}
        />
      )}

      {/* ---------- greeting ---------- */}
      <div className="u-flex" style={{ gap: 14, marginBottom: 20 }}>
        <Avatar name={fullName || 'Student'} size="lg" />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>Hi {firstName}</h1>
          <div className="u-muted">{dateLine}{classLabel ? ` · ${classLabel}` : ''}</div>
        </div>
      </div>

      {/* ---------- states ---------- */}
      {loading && <HomeSkeleton />}

      {!loading && homeErr && (
        <ErrorState title="Your day did not load" sub={homeErr} onRetry={retry} />
      )}

      {!loading && !homeErr && home && (
        <div className="u-col" style={{ gap: 16 }}>
          {/* ---------- NEXT CLASS + TODAY strip ---------- */}
          <Card headAs="h2" head="Today" sub="Your school day at a glance">
            {home.nextClass ? (
              <div>
                <div className="u-upper u-xs u-faint">Next class</div>
                <div style={{ fontSize: 'var(--text-xl)', fontWeight: 640, marginTop: 3 }}>{home.nextClass.subject}</div>
                <div className="u-small u-muted" style={{ marginTop: 3 }}>
                  {[
                    home.nextClass.period !== null ? `Period ${home.nextClass.period}` : null,
                    home.nextClass.room ? `Room ${home.nextClass.room}` : null,
                    home.nextClass.start ? `starts ${home.nextClass.start}` : null,
                    home.nextClass.teacher ?? null,
                  ].filter(Boolean).join(' · ') || 'Details arrive with the timetable.'}
                </div>
              </div>
            ) : (
              <div className="u-small u-muted">No more classes today — check tomorrow&apos;s list below.</div>
            )}
            <div className="divider" />
            <div className="u-small tnum" style={{ color: 'var(--text-2)' }} aria-label="Today in numbers">
              {home.today.classes === 0 && home.today.assignmentsDue === 0 && home.today.upcomingTest === 0
                ? 'Nothing on the timetable today.'
                : [
                    `${home.today.classes} class${home.today.classes === 1 ? '' : 'es'}`,
                    `${home.today.assignmentsDue} assignment${home.today.assignmentsDue === 1 ? '' : 's'} due today`,
                    `${home.today.upcomingTest} test${home.today.upcomingTest === 1 ? '' : 's'} coming up`,
                  ].join(' • ')}
            </div>
          </Card>

          <DayCode />

          {/* ---------- NEEDS ATTENTION checklist ---------- */}
          <Card headAs="h2" head="Needs your attention" sub="Tick it off when it&apos;s done — nothing nags you.">
            {home.needsAttention.length === 0 ? (
              <Empty icon={<Icon.Check size={20} />} title="Nothing needs your attention today" style={{ padding: '26px 16px' }} />
            ) : (
              <div role="group" aria-label="Needs your attention — checklist" className="u-col" style={{ gap: 4 }}>
                {home.needsAttention.map(item => (
                  <AttentionRow
                    key={item.id}
                    item={item}
                    done={overrides[item.id] ?? item.done}
                    busy={busyId === item.id}
                    onToggle={next => void handleToggle(item, next)}
                  />
                ))}
              </div>
            )}
          </Card>

          {/* ---------- YOUR PROGRESS arrows ---------- */}
          <Card headAs="h2" head="Your progress" sub="Facts about your own work — never a class ranking.">
            {home.progress.length === 0 ? (
              <Empty icon={<Icon.Insights size={20} />} title="No subject updates yet" sub="Your teachers add these after each unit of work." style={{ padding: '26px 16px' }} />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                {home.progress.map(p => <ProgressRow key={p.subject} p={p} />)}
              </div>
            )}
          </Card>

          {/* ---------- QUICK ACCESS ---------- */}
          <Card headAs="h2" head="Quick access" sub="Everything about your school day, one tap away." >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', gap: 8 }} data-print="hide">
              {TILES.map(t => {
                const I = Icon[t.icon];
                const inner = (
                  <>
                    <I size={16} style={{ color: 'var(--accent-text)', flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>{t.label}</span>
                    {t.soon && <span className="badge badge-outline u-xs">soon</span>}
                  </>
                );
                return t.to ? (
                  <Link key={t.key} to={t.to} className="wo-card" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>{inner}</Link>
                ) : (
                  <button
                    key={t.key}
                    className="wo-card"
                    style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}
                    onClick={t.print ? scrollToPrint : t.key === 'help' ? () => setHelpOpen(true) : () => openSoon(t.label)}
                    aria-label={t.soon ? `${t.label} — coming soon` : t.label}
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
          </Card>

          {/* ---------- WHAT DO I NEED TOMORROW? ---------- */}
          <Card
            headAs="h2"
            head="What do I need tomorrow?"
            actions={
              <PrintButton
                kind="checklist"
                size="sm"
                label="Print checklist"
                payload={{
                  title: 'What I need tomorrow',
                  student: fullName || undefined,
                  classLabel: classLabel ?? undefined,
                  items: home.bagTomorrow.map(b => (b.note ? `${b.item} — ${b.note}` : b.item)),
                }}
              />
            }
          >
            {home.bagTomorrow.length === 0 ? (
              <Empty
                icon={<Icon.Sunrise size={20} />}
                title="Nothing extra to pack"
                sub="The usual school bag is fine — your class teacher updates this list by the evening."
                style={{ padding: '26px 16px' }}
              />
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }} className="u-col" aria-label="Things to bring tomorrow">
                {home.bagTomorrow.map((b, i) => (
                  <li key={i} className="u-flex u-small" style={{ gap: 9, padding: '7px 2px', borderBottom: i < home.bagTomorrow.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                    <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--accent)', flexShrink: 0, marginTop: 6 }} />
                    <span style={{ minWidth: 0 }}>
                      {b.item}
                      {b.note && <span className="u-muted"> — {b.note}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="u-xs u-faint" style={{ marginTop: 10 }}>Printed checklists come from the school office printer — collect from the office.</div>
          </Card>

          {/* ---------- PRINT & PAPER ---------- */}
          <div data-print="hide">
            <div id="student2-print" tabIndex={-1} style={{ outline: 'none' }}>
              <Card headAs="h2" head="Print & paper" sub="Anything you print here goes to the school office printer — collect your pages from the office.">
                <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <PrintButton kind="timetable" label="My timetable" payload={{ student: fullName || undefined, classLabel: classLabel ?? undefined }} />
                  <PrintButton kind="noticeboard" label="This week at school" payload={{}} />
                  <PrintButton kind="study_plan" label="My study plan" payload={{}} />
                </div>
                {prints && prints.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="u-upper u-xs u-faint" style={{ marginBottom: 7 }}>Recent printing</div>
                    <div className="u-col" style={{ gap: 6 }}>
                      {prints.slice(0, 3).map(j => (
                        <div key={j.id} className="u-flex u-small" style={{ gap: 8 }}>
                          <span style={{ flex: 1, minWidth: 0, fontWeight: 550 }}>{PRINT_KIND_LABEL[j.kind] ?? j.kind}</span>
                          <Badge tone={j.status === 'printed' ? 'success' : 'neutral'} dot>
                            {j.status === 'printed' ? 'Printed — collect from the office' : 'Queued at the office'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                    <Button variant="ghost" size="sm" icon={<Icon.Refresh size={12} />} onClick={loadPrints} style={{ marginTop: 6 }}>Refresh</Button>
                  </div>
                )}
              </Card>
            </div>
          </div>

          {/* ---------- quiet footer ---------- */}
          <div className="u-xs u-faint" style={{ padding: '2px 2px 6px' }} data-print="hide">
            Everything on this page is about you only — your teachers choose what appears here.
          </div>
        </div>
      )}

      {/* ---------- get help (wellbeing filing → counselor plane) ---------- */}
      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Get help"
        sub="This goes to the school counselor only. Nothing is posted anywhere else."
        footer={
          <>
            <Button variant="ghost" onClick={() => setHelpOpen(false)}>Close</Button>
            <Button variant="primary" loading={helpSending} disabled={!helpDetail.trim()} onClick={sendHelp}>Send to counselor</Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="wb-cat">What is this about?</label>
            <select id="wb-cat" className="input" value={helpCategory} onChange={e => setHelpCategory(e.target.value as StudentWellbeingCategory)}>
              {(Object.keys(WELLBEING_CATEGORY_LABEL) as StudentWellbeingCategory[]).map(k =>
                <option key={k} value={k}>{WELLBEING_CATEGORY_LABEL[k]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="wb-detail">Tell the counselor a little</label>
            <textarea id="wb-detail" className="textarea" rows={4} value={helpDetail}
              placeholder="Write what you would like help with. Only the counselor reads this."
              onChange={e => setHelpDetail(e.target.value)} />
          </div>
          <label className="checkbox" style={{ gap: 8 }}>
            <input type="checkbox" checked={helpAnon} onChange={e => setHelpAnon(e.target.checked)} />
            <span className="box" aria-hidden="true"><Icon.Check size={11} /></span>
            <span className="u-small">Send without my name (the counselor cannot follow up with me)</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}

/* ---------- small pieces ---------- */

function AttentionRow({ item, done, busy, onToggle }: {
  item: StudentAttentionItem;
  done: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
}) {
  const kind = KIND_BADGE[item.kind];
  return (
    <label
      className="checkbox"
      style={{ width: '100%', alignItems: 'flex-start', gap: 10, padding: '9px 10px', borderRadius: 'var(--r-md)', background: done ? 'var(--surface-2)' : 'transparent', opacity: busy ? 0.6 : 1 }}
    >
      <input
        type="checkbox"
        checked={done}
        disabled={busy}
        onChange={e => onToggle(e.target.checked)}
        aria-label={`${item.title}${item.dueLabel ? ` — ${item.dueLabel}` : ''}`}
      />
      <span className="box" aria-hidden="true" style={{ marginTop: 3 }}><Icon.Check size={11} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 550, textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--text-3)' : 'var(--text)' }}>
          {item.title}
        </span>
        {(item.subject || item.dueLabel) && (
          <span className="u-small u-muted" style={{ display: 'block', marginTop: 1 }}>
            {item.subject}{item.subject && item.dueLabel ? ' · ' : ''}{item.dueLabel}
          </span>
        )}
        {item.detail && !done && <span className="u-small u-muted" style={{ display: 'block' }}>{item.detail}</span>}
      </span>
      {kind && <Badge tone={kind.tone}>{kind.label}</Badge>}
    </label>
  );
}

function ProgressRow({ p }: { p: { subject: string; direction: 'up' | 'flat' | 'down'; note: string | null } }) {
  /* ↗ improving · → steady · ↘ needs a little practice — plain words,
     calm colours (no red), facts only */
  const [glyph, word, color] = p.direction === 'up'
    ? ['↗', 'Improving', 'var(--success)']
    : p.direction === 'down'
      ? ['↘', 'Needs a little practice', 'var(--warning)']
      : ['→', 'Steady', 'var(--text-2)'];
  return (
    <div className="u-flex" style={{ gap: 9, padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', alignItems: 'flex-start' }}>
      <span aria-hidden="true" style={{ color, fontWeight: 650, fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>{glyph}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 550 }}>{p.subject}</span>
        {p.note && <span className="u-xs u-faint" style={{ display: 'block', marginTop: 1 }}>{p.note}</span>}
      </span>
      <span className="u-small" style={{ color, flexShrink: 0, marginTop: 1 }}>{word}</span>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="u-col" style={{ gap: 16 }} aria-busy="true" aria-label="Loading your day">
      <div className="card card-pad u-col" style={{ gap: 9 }}>
        <Skeleton w="30%" h={16} />
        <Skeleton w="52%" h={12} />
        <div className="divider" />
        <Skeleton w="88%" h={11} />
      </div>
      <div className="grid grid-2">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
      </div>
      <SkeletonCard lines={3} />
    </div>
  );
}
