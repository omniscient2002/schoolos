/* ============================================================
   HR — staff leave and today's duty roster (hr.leave).

   This screen used to render a SAMPLE leave world: request cards with
   approve/reject buttons, a substitution action and audit rows that existed only
   in the session. It said so, and it was honest — but the product has had the
   `hr.leave` add-on the whole time, with four live doors, and a school that
   switched it on got nothing.

   So the screen is now that add-on, in the shape the add-on actually has. The
   important thing to notice is the difference in MODEL:

     · An absence here is a FACT, not a request. Marking leave publishes
       `staff.leave.marked.v1`, which is what the timetable's absence feed
       consumes; cancelling it withdraws the fact. There is no approve/reject
       step, because "who is away on the 14th" is not a negotiation — and a
       screen that offers an approval button for a decision the server does not
       model is the P2-10 defect in a different costume.
     · The duty roster is absent × on-duty for a chosen date, straight from the
       server, and it is the thing a coordinator actually needs before a
       timetable is set.

   Everything the screen shows is the school's record; nothing here is demo data.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Badge, Button, Card, DataTable, Empty, ErrorState, Modal, PageHead, Section, Stat, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useRoleOrGrant } from '../lib/access';
import { friendly } from '../lib/friendlyErrors';
import { statusLabel } from '../lib/labels';
import { apiCancelLeave, apiDutyRoster, apiMarkLeave, apiLeaves, type LiveLeaveRow } from '../services/liveApi';

/* The vocabulary is the door's: anything else is a 400, so the picker offers
   exactly these and the label is the one the door knows. */
const LEAVE_KINDS: { value: string; label: string }[] = [
  { value: 'sick', label: 'Sick' },
  { value: 'casual', label: 'Casual' },
  { value: 'duty', label: 'On duty (posted elsewhere)' },
  { value: 'comp', label: 'Compensatory off' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'training', label: 'Training' },
];
const kindLabel = (k: string) => LEAVE_KINDS.find(x => x.value === k)?.label ?? statusLabel(k);

/* IST, because "today" for a school is the Indian calendar day — the same clock
   the door validates against when it refuses a past date. */
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: unknown }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => { if (live) setState({ data: d, loading: false, error: null }); })
      .catch(e => { if (live) setState({ data: null, loading: false, error: e }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

interface StaffRow { id: string; name: string; role: string }

export default function HR() {
  const toast = useToast();
  const [date, setDate] = useState(istToday());
  const [staff, setStaff] = useState<StaffRow[]>([]);
  /* Staff QR: the office shows today's code; anyone marks themselves present by scanning.
     The token is an HMAC of tenant+day — yesterday's screenshot buys nothing. */
  const [qr, setQr] = useState<{ token: string; day: string } | null>(null);
  const showQr = async () => {
    setBusy(true);
    try {
      const { staffQr } = await import('../services/complianceApi');
      setQr(await staffQr());
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };
  const markMe = async () => {
    if (!qr) { toast({ title: 'Show the code first', tone: 'info' }); return; }
    setBusy(true);
    try {
      const { staffScan } = await import('../services/complianceApi');
      const r = await staffScan(qr.token);
      toast({ title: r.already ? 'Already marked for today' : 'Marked present', sub: r.day, tone: 'success' });
      roster.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };
  const [form, setForm] = useState({ staffId: '', kind: 'sick', reason: '' });
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  /* CPD ledger: office records training hours; everyone else reads their own. Reuses the
     staff picker above (office tier), so the write can never 403 where the picker succeeded. */
  const [trainings, setTrainings] = useState<{ id: string; title: string; hours: number; provider?: string | null; completed_on?: string | null; staff_name?: string }[] | null>(null);
  const [tScope, setTScope] = useState('');
  const [tOwn, setTOwn] = useState<number | null>(null);
  const [tOpen, setTOpen] = useState(false);
  const [tForm, setTForm] = useState({ staffId: '', title: '', hours: '', provider: '', completedOn: '' });
  const refreshTrainings = () => {
    import('../services/complianceApi').then(({ trainingsList }) => trainingsList()
      .then(r => { setTrainings(r.trainings); setTScope(r.scoped); setTOwn(r.ownHours); })
      .catch(() => setTrainings([])));
  };
  useEffect(() => { refreshTrainings(); }, []);
  const recordTraining = async () => {
    if (!tForm.staffId) { toast({ title: 'Pick a staff member first', tone: 'info' }); return; }
    if (!tForm.title.trim()) { toast({ title: 'Name the training', tone: 'info' }); return; }
    const hours = Number(tForm.hours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 500) { toast({ title: 'Hours must be 0–500', tone: 'info' }); return; }
    setBusy(true);
    try {
      const { trainingsAdd } = await import('../services/complianceApi');
      await trainingsAdd({ userId: tForm.staffId, title: tForm.title.trim(), hours,
        ...(tForm.provider.trim() ? { provider: tForm.provider.trim() } : {}),
        ...(tForm.completedOn ? { completedOn: tForm.completedOn } : {}) });
      toast({ title: 'Training recorded', sub: `${hours}h credited.`, tone: 'success' });
      setTForm({ staffId: '', title: '', hours: '', provider: '', completedOn: '' });
      setTOpen(false);
      refreshTrainings();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  /* The two authority tiers this screen has, each read off the door it will call:
     marking and cancelling leave are OFFICE (owner/principal/IT admin); the roster
     is the wider coordination desk. A coordinator can see who is away and cannot
     mark someone away — and the buttons say so before anyone is refused. */
  const canMark = useRoleOrGrant(['owner', 'principal', 'itadmin'],
    ['POST /plugins/hr.leave/leave', 'POST /plugins/hr.leave/leave/:id/cancel']);
  const canRead = useRoleOrGrant(['owner', 'principal', 'itadmin', 'coordinator', 'teacher'], ['GET /plugins/hr.leave/leave']);
  /* Presence marking is the wider office tier (coordinators included): recording that someone
     IS here is not the same authority as recording leave, and the doors say so. */
  const canMarkPresence = useRoleOrGrant(['owner', 'principal', 'itadmin', 'coordinator'], ['POST /staff-attendance/mark']);
  const [presenceForm, setPresenceForm] = useState({ staffId: '', day: istToday() });
  const markPresence = async () => {
    if (!presenceForm.staffId) { toast({ title: 'Pick a staff member first', tone: 'info' }); return; }
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(presenceForm.day)) { toast({ title: 'Day must be YYYY-MM-DD', tone: 'info' }); return; }
    setBusy(true);
    try {
      const { staffMark } = await import('../services/complianceApi');
      await staffMark(presenceForm.staffId, presenceForm.day);
      toast({ title: 'Marked present', sub: `${presenceForm.day} — one row per person per day, so marking twice is a no-op.`, tone: 'success' });
      roster.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const roster = useAsync(() => apiDutyRoster(date), [date]);
  const ledger = useAsync(() => apiLeaves(), []);

  useEffect(() => {
    if (!canMark && !canMarkPresence) return;
    let dead = false;
    /* The picker is the school's own staff list. `/school/staff` is an OFFICE door, which is
       exactly the tier that may mark leave — so this fetch cannot 403 where the write can succeed. */
    import('../services/liveApi').then(({ apiGet }) => apiGet<{ staff: StaffRow[] }>('/school/staff'))
      .then(r => { if (!dead) setStaff((r.staff ?? []).filter(u => u.role !== 'student')); })
      .catch(() => { /* the picker degrades to a typed id; the door still validates */ });
    return () => { dead = true; };
  }, [canMark, canMarkPresence]);

  const marked = ledger.data?.leaves ?? [];
  const active = marked.filter(l => l.status === 'marked');
  const upcoming = active.filter(l => l.leaveDate >= istToday());

  const mark = async () => {
    if (!form.staffId) { toast({ title: 'Pick a staff member first', tone: 'info' }); return; }
    setBusy(true);
    try {
      const r = await apiMarkLeave({
        staffId: form.staffId, leaveDate: date, kind: form.kind,
        ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
      });
      toast({
        title: `Leave marked — ${r.staffName}`,
        sub: `${kindLabel(form.kind)} on ${date}. The timetable's absence feed has it now.`,
        tone: 'success',
      });
      setForm(f => ({ ...f, reason: '' }));
      ledger.retry();
      roster.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const cancel = async (l: LiveLeaveRow) => {
    if (!window.confirm(`Cancel ${l.staffName}'s ${kindLabel(l.kind).toLowerCase()} leave on ${l.leaveDate}? The absence is withdrawn from the timetable.`)) return;
    setCancelling(l.leaveId);
    try {
      await apiCancelLeave(l.leaveId);
      toast({ title: `Leave cancelled — ${l.staffName}`, sub: 'The absence fact is withdrawn.', tone: 'success' });
      ledger.retry();
      roster.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setCancelling(null); }
  };

  if (!canRead) {
    return (
      <Card>
        <Empty icon={<Icon.People size={24} />} title="Not for your role"
          sub="Staff leave is visible to the school office and the coordination desk." />
      </Card>
    );
  }

  return (
    <div>
      <PageHead
        title="HR"
        sub="Who is away, and who is on duty. An absence marked here reaches the timetable immediately — it is a fact, not a request."
        actions={
          <div className="u-inline" style={{ gap: 8 }}>
            <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Roster date" style={{ maxWidth: 170 }} />
            <Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={() => { roster.retry(); ledger.retry(); }}>Refresh</Button>
          </div>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Absent on this date" value={roster.loading ? '—' : roster.data?.absent.length}
          sub={roster.data ? `${roster.data.onDuty.length} on duty` : 'From the duty roster'} />
        <Stat label="Leave records" value={marked.length} sub={`${active.length} active · ${marked.length - active.length} cancelled`} />
        <Stat label="Upcoming" value={upcoming.length} sub="Marked for today or later" />
        <Stat label="Office authority" value={canMark ? 'Yours' : 'Not yours'}
          sub={canMark ? 'You can mark and cancel leave' : 'Marking is the owner/principal/IT admin step'} />
      </div>

      {/* ---- Mark leave ---- */}
      {canMark ? (
        <Card head="Mark leave" sub="One person, one day. The office records absence; the timetable picks it up as an absence feed."
          style={{ marginBottom: 20 }}>
          <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
            <label className="u-small">Staff member
              <select className="input" value={form.staffId} onChange={e => setForm(f => ({ ...f, staffId: e.target.value }))} aria-label="Staff member" style={{ minWidth: 200, display: 'block', marginTop: 4 }}>
                <option value="">Choose…</option>
                {staff.map(u => <option key={u.id} value={u.id}>{u.name} · {statusLabel(u.role)}</option>)}
              </select>
            </label>
            <label className="u-small">Type
              <select className="input" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))} aria-label="Leave type" style={{ minWidth: 190, display: 'block', marginTop: 4 }}>
                {LEAVE_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </label>
            <label className="u-small">Reason (optional)
              <input className="input" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="e.g. medical appointment" aria-label="Reason" style={{ minWidth: 220, display: 'block', marginTop: 4 }} />
            </label>
            <Button variant="primary" disabled={busy || !form.staffId} onClick={mark}>{busy ? 'Marking…' : `Mark ${form.staffId ? 'leave' : ''}`}</Button>
          </div>
          <div className="u-xs u-faint" style={{ marginTop: 8 }}>
            Marks it for <strong>{date}</strong>. Leave cannot be marked in the past — the door refuses it, and
            the same person cannot be marked twice for one day.
          </div>
        </Card>
      ) : null}

      {/* ---- Staff QR presence ---- */}
      <Section title="Today's presence code" sub="The office shows it; staff scan it (or tap below). One row per person per day — scanning twice is a no-op.">
        <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end' }}>
          {canMark && <Button variant="secondary" disabled={busy} onClick={showQr}>{busy ? '…' : 'Show today’s code'}</Button>}
          <Button variant="primary" disabled={busy || !qr} onClick={markMe}>{busy ? 'Marking…' : 'Mark me present'}</Button>
          {qr && <span className="u-small mono" style={{ wordBreak: 'break-all' }}>{qr.token.slice(0, 24)}… <span className="u-faint">({qr.day}, single-day)</span></span>}
        </div>
        {!canMark && <div className="u-xs u-faint" style={{ marginTop: 8 }}>The office displays the code; ask them to show it.</div>}
        {canMarkPresence && (
          <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end', marginTop: 10 }}>
            <label className="u-small">Staff member
              <select className="input" value={presenceForm.staffId} onChange={e => setPresenceForm(f => ({ ...f, staffId: e.target.value }))} aria-label="Staff member to mark present" style={{ minWidth: 200, display: 'block', marginTop: 4 }}>
                <option value="">Choose…</option>
                {staff.map(u => <option key={u.id} value={u.id}>{u.name} · {statusLabel(u.role)}</option>)}
              </select>
            </label>
            <label className="u-small">Day
              <input className="input" type="date" value={presenceForm.day} onChange={e => setPresenceForm(f => ({ ...f, day: e.target.value }))} aria-label="Presence day" style={{ display: 'block', marginTop: 4 }} />
            </label>
            <Button variant="ghost" size="sm" disabled={busy || !presenceForm.staffId} onClick={markPresence}>{busy ? 'Marking…' : 'Mark present (office)'}</Button>
          </div>
        )}
      </Section>

      {/* ---- Duty roster ---- */}
      <Section title={`Duty roster — ${date}`} sub="Absent on the left, on duty on the right. Both are the server's answer for this date.">
        {(roster.data as { blocked?: { staffId: string; name: string; role: string }[] } | null)?.blocked?.length ? (
          <Card pad style={{ marginBottom: 12, borderColor: 'var(--status-critical)' }}>
            <div style={{ fontWeight: 620, marginBottom: 6 }}>
              {(roster.data as { blocked: unknown[] }).blocked.length} off the roster — verification expired
            </div>
            <div className="u-small u-muted">
              {(roster.data as { blocked: { name: string; role: string }[] }).blocked
                .map(b => `${b.name} (${statusLabel(b.role)})`).join(' · ')} — re-verify on the Safety audit desk to bring them back.
            </div>
          </Card>
        ) : null}
        {roster.loading ? <Card pad><div className="u-small u-muted">Reading the roster…</div></Card>
          : roster.error ? <ErrorState title="Could not read the duty roster" sub={friendly(roster.error)} onRetry={roster.retry} />
            : (
              <div className="grid grid-2" style={{ gap: 16, alignItems: 'start' }}>
                <Card pad={false}>
                  <div className="card-head"><h3>Absent</h3><span className="u-small u-faint">{roster.data?.absent.length ?? 0}</span></div>
                  {(roster.data?.absent.length ?? 0) === 0 ? (
                    <div style={{ padding: 'var(--s-5)' }}>
                      <Empty title="Nobody is marked away" sub="Everyone active in the school is on duty for this date." />
                    </div>
                  ) : (
                    <DataTable
                      columns={[
                        { key: 'name', label: 'Name', render: (a: { name: string }) => <span style={{ fontWeight: 570 }}>{a.name}</span> },
                        { key: 'role', label: 'Role', render: (a: { role: string }) => <span className="u-small u-muted">{statusLabel(a.role)}</span> },
                        { key: 'kind', label: 'Type', render: (a: { kind: string }) => <Badge tone={a.kind === 'sick' ? 'warning' : 'outline'}>{kindLabel(a.kind)}</Badge> },
                        { key: 'reason', label: 'Reason', render: (a: { reason?: string | null }) => <span className="u-xs u-faint">{a.reason || '—'}</span> },
                        ...(canMark ? [{
                          key: 'act', label: '', render: (a: { leaveId: string }) => (
                            <Button size="sm" variant="ghost" disabled={cancelling === a.leaveId}
                              onClick={() => {
                                const row = (roster.data?.absent ?? []).find(x => x.leaveId === a.leaveId);
                                if (row) void cancel({
                                  leaveId: row.leaveId, staffId: row.staffId, staffName: row.name,
                                  leaveDate: date, kind: row.kind, status: 'marked', reason: row.reason ?? null,
                                });
                              }}>{cancelling === a.leaveId ? '…' : 'Cancel'}</Button>
                          ),
                        }] : []),
                      ]}
                      rows={roster.data?.absent ?? []}
                      rowKey={(a: { leaveId: string }) => a.leaveId}
                    />
                  )}
                </Card>
                <Card pad={false}>
                  <div className="card-head"><h3>On duty</h3><span className="u-small u-faint">{roster.data?.onDuty.length ?? 0}</span></div>
                  <div className="u-flex u-gap-2 u-wrap" style={{ padding: 'var(--s-5)' }}>
                    {(roster.data?.onDuty ?? []).map(d => (
                      <span key={d.staffId} className="u-small">
                        <Badge tone="success" dot>{d.name}</Badge>
                      </span>
                    ))}
                    {(roster.data?.onDuty.length ?? 0) === 0 && <span className="u-small u-muted">No active staff on the roster for this date.</span>}
                  </div>
                </Card>
              </div>
            )}
      </Section>

      {/* ---- The ledger ---- */}
      <Section title="Leave ledger" sub="Every marked absence, newest first. Cancelled rows stay on the record — absence is a fact that was true on that day.">
        {ledger.loading ? <Card pad><div className="u-small u-muted">Reading the ledger…</div></Card>
          : ledger.error ? <ErrorState title="Could not read the leave ledger" sub={friendly(ledger.error)} onRetry={ledger.retry} />
            : marked.length === 0 ? (
              <Card pad>
                <Empty title="No leave marked yet"
                  sub={canMark ? 'Use “Mark leave” above — the first absence is what puts the add-on to work.' : 'The office records absence here; nothing has been marked so far.'} />
              </Card>
            ) : (
              <Card pad={false}>
                <DataTable<LiveLeaveRow>
                  columns={[
                    { key: 'staff', label: 'Staff', render: l => <span style={{ fontWeight: 570 }}>{l.staffName}</span> },
                    { key: 'date', label: 'Date', render: l => <span className="u-small">{l.leaveDate}</span> },
                    { key: 'kind', label: 'Type', render: l => <Badge tone={l.kind === 'sick' ? 'warning' : 'outline'}>{kindLabel(l.kind)}</Badge> },
                    { key: 'reason', label: 'Reason', render: l => <span className="u-xs u-faint">{l.reason || '—'}</span> },
                    { key: 'status', label: 'Status', render: l => <Badge tone={l.status === 'marked' ? 'success' : 'neutral'} dot>{statusLabel(l.status)}</Badge> },
                    ...(canMark ? [{
                      key: 'act', label: '', render: (l: LiveLeaveRow) => (l.status === 'marked'
                        ? <Button size="sm" variant="ghost" disabled={cancelling === l.leaveId} onClick={() => { void cancel(l); }}>{cancelling === l.leaveId ? '…' : 'Cancel'}</Button>
                        : <span className="u-xs u-faint">withdrawn</span>),
                    }] : []),
                  ]}
                  rows={marked}
                  rowKey={l => l.leaveId}
                />
              </Card>
            )}
      </Section>

      {/* ---- Training (CPD) ledger ---- */}      <Section title="Training & development" sub={tScope === 'school' ? 'Every recorded hour, newest first. The office records; hours belong to the person.' : 'Your recorded training hours.'}>
        {canMark && (
          <div style={{ marginBottom: 12 }}>
            <Button variant="secondary" icon={<Icon.Plus size={14} />} onClick={() => setTOpen(true)}>Record training</Button>
          </div>
        )}
        {trainings == null ? <Card pad><div className="u-small u-muted">Reading training…</div></Card>
          : trainings.length === 0 ? (
            <Card pad>
              <Empty title={tScope === 'school' ? 'No training recorded yet' : 'No training on your record yet'}
                sub={tScope === 'school' ? 'Record NISHTHA modules, TET prep and in-house hours — the CPD evidence.' : 'The office records training here; nothing is on your record so far.'} />
            </Card>
          ) : (
            <Card pad={false}>
              <DataTable<{ id: string; title: string; hours: number; provider?: string | null; completed_on?: string | null; staff_name?: string }>
                columns={[
                  ...(tScope === 'school' ? [{ key: 'who', label: 'Staff', render: (t: { staff_name?: string }) => <span style={{ fontWeight: 570 }}>{t.staff_name ?? '—'}</span> }] : []),
                  { key: 'what', label: 'Training', render: (t: { title: string }) => <span style={{ fontWeight: 570 }}>{t.title}</span> },
                  { key: 'hours', label: 'Hours', width: 90, render: (t: { hours: number }) => <span className="tnum u-small">{t.hours}</span> },
                  { key: 'by', label: 'Provider', render: (t: { provider?: string | null }) => <span className="u-xs u-faint">{t.provider || '—'}</span> },
                  { key: 'when', label: 'Completed', width: 130, render: (t: { completed_on?: string | null }) => <span className="u-small">{t.completed_on ? new Date(t.completed_on).toLocaleDateString() : <span className="u-faint">—</span>}</span> },
                ]}
                rows={trainings}
                rowKey={t => t.id}
              />
            </Card>
          )}
        {tScope !== 'school' && tOwn != null && (
          <div className="u-small u-muted" style={{ marginTop: 8 }}>Your total: <strong>{tOwn}h</strong> on record.</div>
        )}
      </Section>

      {canMark && (
        <Modal
          open={tOpen}
          onClose={() => setTOpen(false)}
          title="Record training"
          sub="Hours belong to the person — NISHTHA, TET prep, in-house."
          footer={
            <>
              <Button variant="ghost" onClick={() => setTOpen(false)} disabled={busy}>Cancel</Button>
              <Button variant="primary" disabled={busy || !tForm.staffId || !tForm.title.trim()} onClick={recordTraining}>
                {busy ? 'Recording…' : 'Record it'}
              </Button>
            </>
          }
        >
          <div className="u-col" style={{ gap: 12 }}>
            <div>
              <label className="u-xs" htmlFor="tr-staff">Staff member</label>
              <select id="tr-staff" className="input" style={{ width: '100%', marginTop: 5 }} value={tForm.staffId} onChange={e => setTForm(f => ({ ...f, staffId: e.target.value }))}>
                <option value="">Choose…</option>
                {staff.map(u => <option key={u.id} value={u.id}>{u.name} · {statusLabel(u.role)}</option>)}
              </select>
            </div>
            <div>
              <label className="u-xs" htmlFor="tr-title">Training</label>
              <input id="tr-title" className="input" style={{ width: '100%', marginTop: 5 }} value={tForm.title}
                onChange={e => setTForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. NISHTHA FLN module 4" />
            </div>
            <div className="grid grid-2" style={{ gap: 12 }}>
              <div>
                <label className="u-xs" htmlFor="tr-hours">Hours</label>
                <input id="tr-hours" className="input" type="number" min={0} max={500} step={0.5} style={{ width: '100%', marginTop: 5 }} value={tForm.hours}
                  onChange={e => setTForm(f => ({ ...f, hours: e.target.value }))} />
              </div>
              <div>
                <label className="u-xs" htmlFor="tr-date">Completed on (optional)</label>
                <input id="tr-date" className="input" type="date" style={{ width: '100%', marginTop: 5 }} value={tForm.completedOn}
                  onChange={e => setTForm(f => ({ ...f, completedOn: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="u-xs" htmlFor="tr-by">Provider (optional)</label>
              <input id="tr-by" className="input" style={{ width: '100%', marginTop: 5 }} value={tForm.provider}
                onChange={e => setTForm(f => ({ ...f, provider: e.target.value }))} placeholder="e.g. DIKSHA" />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
