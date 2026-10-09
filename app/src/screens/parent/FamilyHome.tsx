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
import { Badge, Button, Card, Empty } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { apiGet, apiPost } from '../../services/liveApi';
import { DeniedEmpty, ParentError, ParentLoading } from '../../components/parent/states';
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
  if (s.includes('homework') || s.includes('assignment')) return '/parent/family';
  if (s.includes('payment') || s.includes('fee')) return '/parent/fees';
  if (s.includes('leave') || s.includes('request') || s.includes('form') || s.includes('ptm')) return '/parent/requests';
  return null;
}

/* Each per-child door keeps its own loading / data / error state so a temporary
   outage is never collapsed into "nothing due". */
type Loaded<T> =
  | { status: 'loading' }
  | { status: 'data'; data: T }
  | { status: 'error'; error: unknown };

interface ChildDetail {
  attendance: Loaded<ParentAttendanceData>;
  assignments: Loaded<ParentAssignmentsData>;
  exams: Loaded<ParentExamsData>;
}

function load<T>(p: Promise<T>): Promise<Loaded<T>> {
  return p
    .then(data => ({ status: 'data', data } as Loaded<T>))
    .catch(error => ({ status: 'error', error } as Loaded<T>));
}

/* Resolved data (null while loading or failed) — pairs with Loaded<T>. */
function dataOf<T>(s: Loaded<T> | undefined): T | null {
  return s?.status === 'data' ? s.data : null;
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
  const [detailReload, setDetailReload] = useState(0);

  /* School notices with read-and-sign receipts: the diary surface. Unsigned notices sit
     above the fold; signing is one tap and idempotent, so a double-tap never duplicates. */
  const [notices, setNotices] = useState<{ id: string; title: string; body: string; audience_kind: string; created_at: string; acked: boolean }[] | null>(null);
  const [signing, setSigning] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    apiGet<{ notices: { id: string; title: string; body: string; audience_kind: string; created_at: string; acked: boolean }[] }>('/notices')
      .then(r => { if (!dead) setNotices(r.notices); })
      .catch(() => { if (!dead) setNotices([]); });
    return () => { dead = true; };
  }, [reload]);
  const signNotice = async (id: string) => {
    setSigning(id);
    try {
      await apiPost(`/announcements/${encodeURIComponent(id)}/ack`, {});
      setNotices(ns => (ns ?? []).map(n => (n.id === id ? { ...n, acked: true } : n)));
    } catch { /* signing is best-effort sugar on top of reading; the notice stays readable */ }
    finally { setSigning(null); }
  };

  const retry = useCallback(() => { setErr(null); setReload(n => n + 1); }, []);
  const retryDetail = useCallback(() => setDetailReload(n => n + 1), []);

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
    setDetail({
      attendance: { status: 'loading' },
      assignments: { status: 'loading' },
      exams: { status: 'loading' },
    });
    Promise.all([
      load(getAttendance(selectedId)),
      load(getAssignments(selectedId)),
      load(getExams(selectedId)),
    ]).then(([attendance, assignments, exams]) => {
      if (dead) return;
      setDetail({ attendance, assignments, exams });
    });
    return () => { dead = true; };
  }, [selectedId, detailReload]);

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

  const attData = dataOf(detail?.attendance);
  const hwData = dataOf(detail?.assignments);
  const examData = dataOf(detail?.exams);
  const hw = hwData?.upcoming ?? [];
  const exams = examData?.upcoming ?? [];
  const attToday = attData?.today?.status ?? child.attendance_today ?? null;

  /* family-wide tiered list: each child's attention rows + the home actions,
     urgent first, then action, then upcoming.
     CRASH GUARD: the server aggregate (family.view /parent/home) sends
     {children, requests} — `actions` is a client-side DTO wish, never a field.
     Read it defensively; the row renders from children's attention alone. */
  const homeActions = (home as ParentHomeData & { actions?: ParentHomeAction[] }).actions ?? [];
  const attentionRows = [
    ...attention.map(a => ({ tier: a.tier, title: a.title, due: a.due, ref: a.ref, childName: a.childName })),
    ...homeActions.map((a: ParentHomeAction) => ({
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
      <Card
        headAs="h2"
        head={<>Today {multi && <span className="u-xs u-faint" style={{ marginLeft: 8 }}>{child.name} · {child.class}</span>}</>}
        actions={<Link to={`/parent/child/${child.child_id}`} className="btn btn-secondary btn-sm">Full record</Link>}
      >
        {!detail ? (
          <ParentLoading cards={1} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: 12 }}>
              <div className="u-upper" style={{ marginBottom: 6 }}>Attendance</div>
              {attToday
                ? <Badge tone={ATT_TONE[attToday]} dot>{ATT_WORD[attToday]}</Badge>
                : <Badge tone="outline">Not marked yet</Badge>}
              <div className="u-small u-muted" style={{ marginTop: 8 }}>
                {attData?.today?.classes_today != null
                  ? `${attData.today.classes_today} class${attData.today.classes_today === 1 ? '' : 'es'} today.`
                  : detail.attendance.status === 'error'
                    ? <>Today&apos;s attendance didn&apos;t load — <RetryLink onClick={retryDetail} />.</>
                    : 'The register updates here by 9:00 each morning.'}
              </div>
            </div>
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: 12 }}>
              <div className="u-upper" style={{ marginBottom: 6 }}>Homework due</div>
              {detail.assignments.status === 'loading' ? (
                <div className="u-small u-muted">Loading homework…</div>
              ) : detail.assignments.status === 'error' ? (
                isDeniedError(detail.assignments.error) ? (
                  /* Access refused: this account is not allowed to see the child's homework. */
                  <div className="u-small u-muted">Homework for this child isn&apos;t shared with your account. Ask the school office if it should be.</div>
                ) : (
                  /* A client wrapper exists, so this is a temporary failure returned by the door — never "no homework". */
                  <div className="u-small u-muted">Couldn&apos;t load homework — <RetryLink onClick={retryDetail} />.</div>
                )
              ) : hw.length === 0 ? (
                <div className="u-small u-muted">No homework due right now.</div>
              ) : (
                <div className="u-col" style={{ gap: 5 }}>
                  {hw.slice(0, 3).map(a => (
                    <div key={a.id} className="u-flex u-small" style={{ gap: 8 }}>
                      <span className="u-truncate" style={{ fontWeight: 550 }}>{a.title}</span>
                      <span className="u-faint" style={{ flexShrink: 0, marginLeft: 'auto' }}>{a.due ? fmtDateShort(a.due) : 'due soon'}</span>
                    </div>
                  ))}
                  {hw.length > 3 && <Link to="/parent/family" className="u-xs link-action">+{hw.length - 3} more — see all</Link>}
                </div>
              )}
            </div>
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: 12 }}>
              <div className="u-upper" style={{ marginBottom: 6 }}>Upcoming exams</div>
              {detail.exams.status === 'loading' ? (
                <div className="u-small u-muted">Loading exams…</div>
              ) : detail.exams.status === 'error' ? (
                isDeniedError(detail.exams.error) ? (
                  <div className="u-small u-muted">The exam schedule isn&apos;t shared with your account. Ask the school office if it should be.</div>
                ) : (
                  <div className="u-small u-muted">Couldn&apos;t load exams — <RetryLink onClick={retryDetail} />.</div>
                )
              ) : exams.length === 0 ? (
                <div className="u-small u-muted">No exams scheduled.</div>
              ) : (
                <div className="u-col" style={{ gap: 5 }}>
                  {exams.slice(0, 3).map(e => (
                    <div key={e.id} className="u-flex u-small" style={{ gap: 8 }}>
                      <span className="u-truncate" style={{ fontWeight: 550 }}>{e.name}</span>
                      {/* No date is published for every exam; fmtDateShort
                          renders an em-dash rather than "Invalid Date". */}
                      <span className="u-faint" style={{ flexShrink: 0, marginLeft: 'auto' }}>{e.date ? fmtDateShort(e.date) : 'Date not announced'}</span>
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
      <Card headAs="h2" head="Needs your attention">        {attention.length === 0 && homeActions.length === 0 ? (
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

      {/* ---------- NOTICES FROM SCHOOL ---------- */}
      <Card headAs="h2" head="Notices from school">
        {notices == null ? (
          <div className="u-small u-muted">Reading notices…</div>
        ) : notices.length === 0 ? (
          <Empty
            titleAs="h3"
            icon={<Icon.Message size={22} style={{ color: 'var(--success)' }} />}
            title="No notices right now"
            sub="School circulars and diary notes appear here. Anything needing your signature moves to the top."
          />
        ) : (
          <div className="u-col" style={{ gap: 8 }}>
            {[...notices].sort((a, b) => Number(a.acked) - Number(b.acked)).map(n => (
              <div key={n.id} className="u-flex" style={{ gap: 10, padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', alignItems: 'flex-start' }}>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="u-small" style={{ display: 'block', fontWeight: 600 }}>{n.title}</span>
                  <span className="u-small u-muted" style={{ display: 'block', marginTop: 2 }}>{n.body}</span>
                  <span className="u-xs u-faint">{new Date(n.created_at).toLocaleDateString()}</span>
                </span>
                {n.acked
                  ? <Badge tone="success">Signed ✓</Badge>
                  : <Button size="sm" variant="secondary" disabled={signing === n.id} onClick={() => { void signNotice(n.id); }}>
                      {signing === n.id ? '…' : 'Sign'}
                    </Button>}
              </div>
            ))}
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

/* Inline "try again" for a single failed per-child door (retries all three). */
function RetryLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', color: 'var(--accent-text)', textDecoration: 'underline' }}
    >
      try again
    </button>
  );
}
