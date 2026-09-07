/* ============================================================
   FamilyHome — the Family Command Center (PU-1).
   One calm screen: which child, how is today, what needs you,
   how was the week. Replaces ParentHome as the parent landing
   surface (route /parent/family). Server truth: the /parent/*
   frozen doors from docs/PARENTOS-PLAN.md — when a door is not
   live yet the section says so instead of inventing data.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Card, Empty } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { DeniedEmpty, ParentError, ParentLoading } from '../../components/parent/states';
import { friendly } from '../../lib/friendlyErrors';
import { fmtDate, fmtDateShort, weekday } from '../../lib/format';
import {
  getParentHome, getBrief, getAttendance, getAssignments, getExams, getConsents,
  parentFirstName, isDeniedError,
  type ParentHomeData, type ParentBrief, type ParentConsentsData,
  type ParentAttendanceData, type ParentAssignmentsData, type ParentExamsData,
  type ParentAttentionItem, type ParentHomeAction, type AttendanceStatus,
} from '../../services/parentApi';

/* ---------- plain-language status words (never raw enums) ---------- */
const ATT_WORD: Record<AttendanceStatus, string> = {
  present: 'Present', absent: 'Absent', late: 'Arrived late', excused: 'Excused — leave approved',
};
const ATT_TONE: Record<AttendanceStatus, 'success' | 'danger' | 'warning' | 'info'> = {
  present: 'success', absent: 'danger', late: 'warning', excused: 'info',
};
const ATT_DOT: Record<AttendanceStatus, string> = {
  present: 'var(--success)', absent: 'var(--danger)', late: 'var(--warning)', excused: 'var(--info)',
};

/* Greeting part by IST hour (India-first product — the parent's wall clock
   is IST regardless of the device timezone). */
function istHour(): number {
  const now = new Date();
  return new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000).getHours();
}

/* Deep-link a tier/action row into the flow that resolves it. */
function targetOf(ref: string, kind?: string): string | null {
  const s = `${kind ?? ''} ${ref}`.toLowerCase();
  if (s.includes('consent')) return '/parent/consents';
  if (s.includes('homework') || s.includes('assignment')) return '/parent/assignments';
  if (s.includes('payment') || s.includes('fee')) return '/parent/fees';
  if (s.includes('leave') || s.includes('request') || s.includes('form') || s.includes('ptm')) return '/parent/requests';
  return null;
}

interface ChildDetail {
  attendance: ParentAttendanceData | null;
  assignments: ParentAssignmentsData | null;
  exams: ParentExamsData | null;
}

export default function FamilyHome() {
  const navigate = useNavigate();

  const [home, setHome] = useState<ParentHomeData | null>(null);
  const [brief, setBrief] = useState<ParentBrief | null>(null);
  const [briefFailed, setBriefFailed] = useState(false);
  const [consents, setConsents] = useState<ParentConsentsData | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [reload, setReload] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChildDetail | null>(null);
  const [detailErr, setDetailErr] = useState<unknown>(null);

  const retry = useCallback(() => { setErr(null); setReload(n => n + 1); }, []);

  /* --- family-level load: home, week brief, consents --- */
  useEffect(() => {
    let dead = false;
    setErr(null);
    Promise.all([
      getParentHome(),
      getBrief('week').catch(e => { if (!isDeniedError(e)) setBriefFailed(true); return null; }),
      getConsents().catch(() => null), // today-card shows "—" when this door is quiet
    ]).then(([h, b, c]) => {
      if (dead) return;
      setHome(h); setBrief(b); setConsents(c);
      setSelectedId(cur => cur ?? h.children[0]?.child_id ?? null);
    }).catch(e => { if (!dead) setErr(e); });
    return () => { dead = true; };
  }, [reload]);

  /* --- per-child detail (today panel) --- */
  useEffect(() => {
    if (!selectedId) return;
    let dead = false;
    setDetailErr(null);
    setDetail(null);
    Promise.all([
      getAttendance(selectedId).catch(() => null),
      getAssignments(selectedId).catch(() => null),
      getExams(selectedId).catch(() => null),
    ]).then(([attendance, assignments, exams]) => {
      if (dead) return;
      setDetail({ attendance, assignments, exams });
      if (!attendance && !assignments && !exams) setDetailErr(new Error('no child doors answered'));
    }).catch(e => { if (!dead) setDetailErr(e); });
    return () => { dead = true; };
  }, [selectedId]);

  /* ---------- states ---------- */
  if (err) return <ParentError err={err} onRetry={retry} />; // covers denied via DeniedEmpty
  if (!home) return <ParentLoading cards={4} />;
  if (home.children.length === 0) {
    return <DeniedEmpty sub="No children are linked to your account yet. The school office links children after admission verification." />;
  }

  const multi = home.children.length > 1;
  const child = home.children.find(c => c.child_id === selectedId) ?? home.children[0];
  const pendingConsents = (consents?.consents ?? []).filter(c => c.status === 'pending' && (!child || !c.child_id || c.child_id === child.child_id)).length;
  const attention: (ParentAttentionItem & { childName?: string })[] =
    home.children.flatMap(c => c.attention.map(a => ({ ...a, childName: multi ? c.name.split(' ')[0] : undefined })));

  const hour = istHour();
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const firstName = parentFirstName();
  const now = new Date();

  const hw = detail?.assignments?.upcoming ?? [];
  const exams = detail?.exams?.upcoming ?? [];
  const attToday = detail?.attendance?.today?.status ?? child.attendance_today ?? null;

  /* family-wide tiered list: each child's attention rows + the home actions,
     urgent first, then action, then upcoming */
  const attentionRows = [
    ...attention.map(a => ({ tier: a.tier, title: a.title, due: a.due, ref: a.ref, childName: a.childName })),
    ...home.actions.map((a: ParentHomeAction) => ({
      tier: a.kind === 'payment' || a.kind === 'consent' ? ('action' as const) : ('upcoming' as const),
      title: a.title, due: a.due, ref: a.ref, childName: undefined,
    })),
  ].sort((x, y) => tierRank(x.tier) - tierRank(y.tier));

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'grid', gap: 16 }}>
      {/* ---------- greeting ---------- */}
      <header>
        <h1 style={{ fontSize: 'var(--text-2xl)', margin: 0 }}>
          Good {part}{firstName ? `, ${firstName}` : ''}
        </h1>
        <div className="u-muted u-small" style={{ marginTop: 4 }}>{weekday(now)}, {fmtDate(now)}</div>
      </header>

      {/* ---------- child switcher ---------- */}
      {multi && (
        <div role="group" aria-label="Choose a child" className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
          {home.children.map(c => {
            const active = c.child_id === child.child_id;
            const count = c.attention.filter(a => a.tier === 'urgent' || a.tier === 'action').length;
            return (
              <button key={c.child_id} onClick={() => setSelectedId(c.child_id)} aria-pressed={active}
                className="u-flex" style={{
                  gap: 8, minHeight: 44, padding: '8px 14px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
                  background: active ? 'var(--accent-weak)' : 'var(--surface)', color: 'var(--text-1)',
                  fontWeight: active ? 620 : 480,
                }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: c.attendance_today ? ATT_DOT[c.attendance_today] : 'var(--border-strong)', flexShrink: 0 }} aria-hidden="true" />
                <span>{c.name.split(' ')[0]}</span>
                <span className="u-faint u-small">{c.class}</span>
                {count > 0 && <Badge tone={c.attention.some(a => a.tier === 'urgent') ? 'danger' : 'warning'}>{count}</Badge>}
              </button>
            );
          })}
        </div>
      )}

      {/* ---------- TODAY ---------- */}
      <Card headAs="h2" head={<>Today {multi && <span className="u-xs u-faint" style={{ marginLeft: 8 }}>{child.name} · {child.class}</span>}</>}>
        {detailErr ? (
          <div className="u-small u-muted">Today&apos;s class details could not load just now. {friendly((detailErr as Error).message)}</div>
        ) : !detail ? (
          <ParentLoading cards={1} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: 12 }}>
              <div className="u-upper" style={{ marginBottom: 6 }}>Attendance</div>
              {attToday
                ? <Badge tone={ATT_TONE[attToday]} dot>{ATT_WORD[attToday]}</Badge>
                : <Badge tone="outline">Not marked yet</Badge>}
              <div className="u-small u-muted" style={{ marginTop: 8 }}>
                {detail.attendance?.today?.classes_today != null
                  ? `${detail.attendance.today.classes_today} class${detail.attendance.today.classes_today === 1 ? '' : 'es'} today.`
                  : 'The register updates here by 9:00 each morning.'}
              </div>
            </div>
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: 12 }}>
              <div className="u-upper" style={{ marginBottom: 6 }}>Homework due</div>
              {hw.length === 0 ? (
                <div className="u-small u-muted">No homework due right now.</div>
              ) : (
                <div className="u-col" style={{ gap: 5 }}>
                  {hw.slice(0, 3).map(a => (
                    <div key={a.id} className="u-flex u-small" style={{ gap: 8 }}>
                      <span className="u-truncate" style={{ fontWeight: 550 }}>{a.title}</span>
                      <span className="u-faint" style={{ flexShrink: 0, marginLeft: 'auto' }}>{a.due ? fmtDateShort(a.due) : 'due soon'}</span>
                    </div>
                  ))}
                  {hw.length > 3 && <Link to="/parent/assignments" className="u-xs" style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center' }}>+{hw.length - 3} more — see all</Link>}
                </div>
              )}
            </div>
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: 12 }}>
              <div className="u-upper" style={{ marginBottom: 6 }}>Upcoming exams</div>
              {exams.length === 0 ? (
                <div className="u-small u-muted">No exams scheduled.</div>
              ) : (
                <div className="u-col" style={{ gap: 5 }}>
                  {exams.slice(0, 3).map(e => (
                    <div key={e.id} className="u-flex u-small" style={{ gap: 8 }}>
                      <span className="u-truncate" style={{ fontWeight: 550 }}>{e.title}</span>
                      <span className="u-faint" style={{ flexShrink: 0, marginLeft: 'auto' }}>{fmtDateShort(e.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: 12 }}>
              <div className="u-upper" style={{ marginBottom: 6 }}>Forms &amp; consents</div>
              {consents === null ? (
                <div className="u-small u-muted">Consent list is quiet right now.</div>
              ) : pendingConsents === 0 ? (
                <div className="u-small u-muted">Nothing waiting for your signature.</div>
              ) : (
                <>
                  <div style={{ fontWeight: 620 }}>{pendingConsents} waiting</div>
                  <Link to="/parent/consents" className="u-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44, marginTop: 2 }}>Review now <Icon.ChevronRight size={12} /></Link>
                </>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ---------- NEEDS YOUR ATTENTION ---------- */}
      <Card headAs="h2" head="Needs your attention">
        {attention.length === 0 && home.actions.length === 0 ? (
          <Empty
            titleAs="h3"
            icon={<Icon.Check size={22} style={{ color: 'var(--success)' }} />}
            title="All caught up — enjoy the day"
            sub="Nothing needs your signature or reply right now. Anything from school will appear here."
          />
        ) : (
          <div className="u-col" style={{ gap: 8 }}>
            {attentionRows.map((row, i) => {
                const to = targetOf(row.ref);
                const inner = (
                  <>
                    <span aria-hidden="true" style={{ flexShrink: 0 }}>{row.tier === 'urgent' ? '🔴' : row.tier === 'action' ? '🟠' : '🔵'}</span>
                    <span className="sr-only">{row.tier === 'urgent' ? 'Urgent. ' : row.tier === 'action' ? 'Action needed. ' : 'Upcoming. '}</span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="u-small" style={{ display: 'block', fontWeight: row.tier === 'urgent' ? 640 : 550 }}>
                        {row.childName ? `${row.childName}: ` : ''}{row.title}
                      </span>
                      {row.due && <span className="u-xs u-faint">By {fmtDateShort(row.due)}</span>}
                    </span>
                    {to && <Icon.ChevronRight size={13} style={{ color: 'var(--text-3)', flexShrink: 0 }} />}
                  </>
                );
                return to ? (
                  <Link key={`${row.ref}-${i}`} to={to} className="u-flex" style={{ gap: 10, padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', textDecoration: 'none', color: 'inherit', minHeight: 48, alignItems: 'center' }}>
                    {inner}
                  </Link>
                ) : (
                  <div key={`${row.ref}-${i}`} className="u-flex" style={{ gap: 10, padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', minHeight: 48, alignItems: 'center' }}>
                    {inner}
                  </div>
                );
              })}
          </div>
        )}
      </Card>

      {/* ---------- THIS WEEK ---------- */}
      <Card headAs="h2" head="This week">
        {brief ? (
          <div className="u-col u-small" style={{ gap: 7 }}>
            <span className="u-flex" style={{ gap: 8 }}><Icon.Check size={14} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} />
              {brief.attendance_pct != null
                ? <>Attendance was <b>{brief.attendance_pct}%</b> this week.</>
                : <>{brief.headline ?? 'The weekly summary will appear here.'}</>}
            </span>
            {brief.assignments_done != null && brief.assignments_total != null && (
              <span className="u-flex" style={{ gap: 8 }}><Icon.Learning size={14} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 2 }} />
                Homework: <b>{brief.assignments_done} of {brief.assignments_total}</b>&nbsp;turned in.
              </span>
            )}
            {brief.reports_published != null && (
              <span className="u-flex" style={{ gap: 8 }}><Icon.Document size={14} style={{ color: 'var(--info)', flexShrink: 0, marginTop: 2 }} />
                {brief.reports_published === 0
                  ? 'No new report cards this week.'
                  : <><b>{brief.reports_published}</b>&nbsp;new report card{brief.reports_published === 1 ? '' : 's'} published.</>}
              </span>
            )}
          </div>
        ) : (
          <div className="u-small u-muted">
            {briefFailed ? 'The weekly summary is resting — it will be back shortly.' : 'The weekly summary appears here each Monday.'}
          </div>
        )}
      </Card>

      {/* ---------- copilot entry ---------- */}
      <Card pad className="card-click" onClick={() => navigate('/parent/copilot')} style={{ background: 'var(--ai-weak)', borderColor: 'var(--ai-weak-2)' }}>
        <div className="u-flex" style={{ gap: 12, alignItems: 'center' }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--ai-weak-2)', color: 'var(--ai-text)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon.Sparkle size={19} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 620 }}>Ask the family assistant</div>
            <div className="u-small u-muted">“What homework is due?” · “When is the next exam?” · “Which forms are pending?”</div>
          </div>
          <Icon.ChevronRight size={15} style={{ color: 'var(--text-3)', marginLeft: 'auto', flexShrink: 0 }} />
        </div>
      </Card>
    </div>
  );
}

function tierRank(t: string): number {
  return t === 'urgent' ? 0 : t === 'action' ? 1 : 2;
}
