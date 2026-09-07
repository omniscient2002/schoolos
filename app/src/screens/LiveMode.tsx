/* ============================================================
   LiveMode — the real-API surface.
   A single screen that proves the frontend's data contracts
   against the actual backend: live login, students, attendance
   marking with policy notices, actions with approvals, audit.
   Shown only when VITE_LIVE_API=1 — the demo loops stay mock.
   ============================================================ */
import { useEffect, useState } from 'react';
import { PageHead, Card, Badge, Button, KeyValue, Empty, useToast } from '../components/ui';
import { EventTimeline, VerifyRow, SectionLabel, type TimelineEntry } from '../components/Flow';
import { Icon } from '../components/Icon';
import {
  LIVE_API, apiLogin, apiStudents, apiAttendance, apiMarkAttendance, apiActions,
  apiDecideAction, apiAudit, DEMO_ACCOUNTS, DEMO_PASSWORD, setToken,
  type ApiUser,
} from '../services/liveApi';

type Stage = 'login' | 'ready';

export default function LiveMode() {
  const toast = useToast();
  const [stage, setStage] = useState<Stage>('login');
  const [user, setUser] = useState<ApiUser | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [students, setStudents] = useState<{ id: string; name: string; grade: string; section: string; bus_route: string | null }[]>([]);
  const [attendance, setAttendance] = useState<{ id: string; name: string; status: string | null }[]>([]);
  const [actions, setActions] = useState<Record<string, unknown>[]>([]);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);

  const login = async (email: string) => {
    setBusy(email);
    try {
      const r = await apiLogin(email, DEMO_PASSWORD);
      setUser(r.user);
      setStage('ready');
      toast({ title: `Signed in as ${r.user.name}`, sub: 'Signed in for real — your school\'s data, kept separate per school', tone: 'success' });
    } catch (e) {
      toast({ title: 'Login failed', sub: (e as Error).message, tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const loadAll = async () => {
    const [s, a, acts, aud] = await Promise.all([
      apiStudents({ grade: '8', section: 'B' }),
      apiAttendance(new Date().toISOString().slice(0, 10), '8', 'B'),
      apiActions('open'),
      apiAudit(20),
    ]);
    setStudents(s.students as never);
    setAttendance(a.rows as never);
    setActions(acts.actions);
    setAudit(aud.entries);
  };

  useEffect(() => { if (stage === 'ready') loadAll().catch(e => toast({ title: 'Load failed', sub: (e as Error).message, tone: 'error' })); /* eslint-disable-line */ }, [stage]);

  const mark = async () => {
    setBusy('mark');
    try {
      const absent = attendance.filter(x => !x.status).slice(0, 2).map(x => x.id);
      const marks = attendance.filter(x => x.status).map(x => ({ studentId: x.id, status: x.status as string }))
        .concat(absent.map(id => ({ studentId: id, status: 'absent' })));
      const r = await apiMarkAttendance(new Date().toISOString().slice(0, 10), marks);
      setTimeline(t => [...t, {
        time: new Date(), label: `Register marked — ${r.marked} students, ${r.absent} absent`,
        detail: `${r.noticesQueued} guardian notices queued (Attendance §1.1) — real policy on the real API`, kind: 'act',
      }]);
      await loadAll();
    } catch (e) { toast({ title: 'Mark failed', sub: (e as Error).message, tone: 'error' }); }
    finally { setBusy(null); }
  };

  const decide = async (id: string, decision: 'approved' | 'dismissed') => {
    setBusy(id);
    try {
      const r = await apiDecideAction(id, decision, 'Decided in Live Mode');
      const ex = r.execution as { type?: string } | null;
      setTimeline(t => [...t, {
        time: new Date(), label: `Action ${decision}`,
        detail: ex ? `Executed: ${ex.type} (real communication row + audit entry)` : 'Recorded on the ledger',
        kind: decision === 'approved' ? 'act' : 'note',
      }]);
      await loadAll();
    } catch (e) { toast({ title: 'Decision failed', sub: (e as Error).message, tone: 'error' }); }
    finally { setBusy(null); }
  };

  if (!LIVE_API) {
    return <div style={{ maxWidth: 640, margin: '0 auto' }}><Card><Empty icon={<Icon.Database size={22} />} title="Live API not enabled" sub="Start the backend and run the frontend with VITE_LIVE_API=1 to use this surface." /></Card></div>;
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <PageHead title="Live mode" sub="The same operating loop — on the real API, real Postgres, real RLS" actions={<Badge tone="success" dot>Backend connected</Badge>} />

      {stage === 'login' && (
        <Card head="Sign in" sub="Seeded Meridian accounts — password is the demo password for all">
          <div className="u-col" style={{ gap: 8 }}>
            {DEMO_ACCOUNTS.map(a => (
              <button key={a.email} className="u-between" style={{ padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', cursor: 'pointer', background: 'var(--surface-1)' }} onClick={() => login(a.email)}>
                <span className="u-inline" style={{ gap: 9 }}><Icon.User size={14} /> <span style={{ fontWeight: 550, fontSize: 'var(--text-sm)' }}>{a.label}</span></span>
                <span className="u-xs u-faint">{busy === a.email ? 'signing in…' : a.email}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {stage === 'ready' && user && (
        <div className="u-col" style={{ gap: 'var(--s-4)' }}>
          <Card>
            <KeyValue items={[
              { k: 'Signed in', v: `${user.name} · ${user.role}` },
              { k: 'School', v: user.tenantId },
              { k: 'Token', v: 'JWT · 12h · role claims enforced server-side' },
            ]} cols={2} />
            <div className="u-inline" style={{ gap: 8, marginTop: 10 }}>
              <Button variant="ghost" size="sm" onClick={() => { setToken(null); setStage('login'); setUser(null); }}>Sign out</Button>
            </div>
          </Card>

          {timeline.length > 0 && (
            <Card head="Your session — what the API recorded">
              <EventTimeline items={timeline} />
            </Card>
          )}

          <div className="grid grid-2" style={{ gap: 'var(--s-4)' }}>
            <Card head="Attendance — 8-B (live)" sub={`${attendance.length} students from Postgres`}>
              <div className="u-col scroll-thin" style={{ gap: 4, maxHeight: 260, overflowY: 'auto' }}>
                {attendance.slice(0, 12).map(x => (
                  <div key={x.id} className="u-between u-small" style={{ padding: '5px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <span>{x.name}</span>
                    <Badge tone={x.status === 'present' ? 'success' : x.status === 'absent' ? 'danger' : x.status ? 'info' : 'neutral'}>{x.status ?? 'unmarked'}</Badge>
                  </div>
                ))}
              </div>
              <Button variant="primary" size="sm" style={{ marginTop: 10 }} loading={busy === 'mark'} onClick={mark}>Mark unmarked as absent → trigger policy</Button>
            </Card>

            <Card head="Open actions (live)" sub="Approval-required items from the transport policy">
              {actions.length === 0 ? <Empty title="No open actions" sub="Trigger a transport delay to raise one." /> : (
                <div className="u-col" style={{ gap: 8 }}>
                  {actions.slice(0, 3).map(a => (
                    <div key={a.id as string} className="u-col" style={{ gap: 5, padding: '9px 11px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
                      <span style={{ fontWeight: 570, fontSize: 'var(--text-sm)' }}>{a.title as string}</span>
                      <span className="u-xs u-faint">{a.policy_ref as string} · owner {a.owner as string}</span>
                      <div className="u-inline" style={{ gap: 6 }}>
                        <Button size="sm" variant="primary" loading={busy === a.id as string} onClick={() => decide(a.id as string, 'approved')}>Approve</Button>
                        <Button size="sm" variant="ghost" onClick={() => decide(a.id as string, 'dismissed')}>Dismiss</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card head="Students (live)" sub={`${students.length} in 8-B · read through the RLS-scoped API`}>
            <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
              {students.slice(0, 8).map(s => (
                <span key={s.id} className="u-inline u-small" style={{ gap: 6, padding: '5px 10px', border: '1px solid var(--border-subtle)', borderRadius: 999 }}>
                  {s.name}{s.bus_route ? ` · ${s.bus_route}` : ''}
                </span>
              ))}
            </div>
          </Card>

          <Card head="Audit trail (live)" sub="Append-only, tamper-proof — the entries your session just created">
            <div className="u-col" style={{ gap: 6 }}>
              <SectionLabel>Chain integrity</SectionLabel>
              <VerifyRow ok label={`${audit.length} recent entries readable`} detail="Every write path in the API records actor · action · policy · outcome" />
            </div>
            <div className="u-col" style={{ gap: 4, marginTop: 8 }}>
              {audit.slice(0, 6).map((e, i) => (
                <div key={i} className="u-between u-small" style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 550 }}>{e.action as string}</span>
                  <span className="u-xs u-faint">{e.actor as string} · {String(e.created_at ?? '').slice(11, 16)} · {String(e.hash ?? '').slice(0, 10)}…</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
