/* ============================================================
   Clinic — the infirmary log (health.clinic).

   Another add-on a school could switch on and get nothing for: `health.clinic`
   has been on the server since wave 3, with five live doors, and no screen
   anywhere in the SPA. This is that screen.

   Two things shape it, and both come from the doors rather than from taste:

   · THE READ IS NURSE-LANE PII. `GET /plugins/health.clinic/visits` is gated to
     owner/principal/IT-admin/coordinator — deliberately NOT a teacher, finance or
     parent read, because a clinic log is health data under DPDP. So the screen asks
     that question first and shows an honest refusal rather than firing a door that
     would 403.

   · A VISIT RAISES A NOTICE, IT DOES NOT SEND ONE. Logging a "sent home" or
     "hospital referral" visit raises a principal-owned approval action; the
     guardian message is only ever sent through that approval (Comms §1.2). The log
     below therefore reports the action id and links to the Approvals board, and the
     copy never implies a message went out.

   The visit record is append-first: a mistake is corrected by appending a
   correction, never by rewriting what the infirmary wrote at the time.
   ============================================================ */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, DataTable, Empty, ErrorState, Modal, PageHead, Section, Stat, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useRoleOrGrant } from '../lib/access';
import { friendly } from '../lib/friendlyErrors';
import { apiClinicVisits, apiCorrectClinicVisit, apiIssueSickPass, apiLogClinicVisit, type ClinicVisit } from '../services/liveApi';

const ACTIONS: { value: string; label: string; tone: 'success' | 'info' | 'warning' | 'danger'; notifies: boolean }[] = [
  { value: 'rest', label: 'Rest — back to class', tone: 'success', notifies: false },
  { value: 'first_aid', label: 'First aid — stayed at school', tone: 'info', notifies: false },
  { value: 'sent_home', label: 'Sent home', tone: 'warning', notifies: true },
  { value: 'hospital_referral', label: 'Hospital referral', tone: 'danger', notifies: true },
];
const actionMeta = (a: string) => ACTIONS.find(x => x.value === a) ?? { value: a, label: a, tone: 'info' as const, notifies: false };

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

interface StudentRow { id: string; name: string; grade?: string; section?: string }

export default function Clinic() {
  const toast = useToast();
  const navigate = useNavigate();
  /* NURSE = ['owner','principal','itadmin','coordinator'] — the read AND the log door share it. */
  const canUse = useRoleOrGrant(['owner', 'principal', 'itadmin', 'coordinator'], ['GET /plugins/health.clinic/visits']);

  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passing, setPassing] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  /* Health checks (RBSK/vaccination) + the midday-meal log ride the same authority as the
     infirmary log — office eyes only — but live in their own tables with their own rhythms. */
  const [checks, setChecks] = useState<{ id: string; kind: string; detail: string; checked_on: string; student_name?: string }[] | null>(null);
  const [meals, setMeals] = useState<{ served_on: string; menu: string; veg_count: number; total_count: number }[] | null>(null);
  const [checkOpen, setCheckOpen] = useState(false);
  const [mealOpen, setMealOpen] = useState(false);
  const [checkForm, setCheckForm] = useState({ studentId: '', kind: 'general', detail: '', checkedOn: '' });
  const [mealForm, setMealForm] = useState({ servedOn: '', menu: '', vegCount: '', totalCount: '' });
  /* The infirmary log is APPEND-FIRST: what was written at the time is never rewritten, so a
     mistake is fixed by appending a correction. That is the door's contract, and a screen offering
     an "edit" button would be offering to break it. */
  const [correcting, setCorrecting] = useState<ClinicVisit | null>(null);
  const [correction, setCorrection] = useState('');
  const [form, setForm] = useState({ studentId: '', complaint: '', temperatureC: '', action: 'rest', notes: '' });

  const visits = useAsync(() => apiClinicVisits(), []);

  const refreshExtras = () => {
    import('../services/complianceApi').then(({ healthList, mealsList }) => {
      healthList().then(r => setChecks(r.checks)).catch(() => setChecks([]));
      mealsList().then(r => setMeals(r.meals)).catch(() => setMeals([]));
    }).catch(() => { setChecks([]); setMeals([]); });
  };
  useEffect(() => { if (canUse) refreshExtras(); }, [canUse]);

  useEffect(() => {
    if (!canUse) return;
    let dead = false;
    /* The roster door is a staff surface (the school office is who runs a clinic);
       the picker's failure degrades to typing an id, and the visit door re-validates it. */
    import('../services/liveApi').then(({ apiStudents }) => apiStudents({ limit: '200' }))
      .then(r => { if (!dead) setStudents((r.students ?? []).map((s: Record<string, unknown>) => ({ id: String(s.id), name: String(s.name), grade: s.grade == null ? undefined : String(s.grade), section: s.section == null ? undefined : String(s.section) }))); })
      .catch(() => { /* picker degrades */ });
    return () => { dead = true; };
  }, [canUse]);

  const log = async () => {
    if (!form.studentId) { toast({ title: 'Pick a pupil', tone: 'info' }); return; }
    if (!form.complaint.trim()) { toast({ title: 'Describe what is wrong', tone: 'info' }); return; }
    setBusy(true);
    try {
      const temp = form.temperatureC.trim() === '' ? undefined : Number(form.temperatureC);
      const r = await apiLogClinicVisit({
        studentId: form.studentId, complaint: form.complaint.trim(), action: form.action,
        ...(temp != null && Number.isFinite(temp) ? { temperatureC: temp } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      });
      const notifies = actionMeta(r.action).notifies;
      toast({
        title: 'Visit logged',
        sub: notifies
          ? `A guardian notice needs approval — it is waiting in Approvals (action ${r.noticeActionId}). Nothing has been sent yet.`
          : 'No guardian notice is raised for this outcome.',
        tone: 'success',
      });
      setForm(f => ({ ...f, complaint: '', temperatureC: '', notes: '' }));
      setLogOpen(false);
      visits.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const saveCorrection = async () => {
    if (!correcting) return;
    if (correction.trim().length < 4) { toast({ title: 'Describe the correction', tone: 'info' }); return; }
    setBusy(true);
    try {
      await apiCorrectClinicVisit(correcting.visitId, { correction: correction.trim() });
      toast({
        title: 'Correction appended',
        sub: 'The original entry stands — the infirmary record shows both, in order.',
        tone: 'success',
      });
      setCorrecting(null); setCorrection('');
      visits.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const saveCheck = async () => {
    if (!checkForm.studentId) { toast({ title: 'Pick a pupil', tone: 'info' }); return; }
    if (!checkForm.detail.trim()) { toast({ title: 'Record the finding', tone: 'info' }); return; }
    if (!checkForm.checkedOn) { toast({ title: 'Pick the checkup date', tone: 'info' }); return; }
    setBusy(true);
    try {
      const { healthAdd } = await import('../services/complianceApi');
      await healthAdd({ studentId: checkForm.studentId, kind: checkForm.kind, detail: checkForm.detail.trim(), checkedOn: checkForm.checkedOn });
      toast({ title: 'Checkup recorded', tone: 'success' });
      setCheckForm({ studentId: '', kind: 'general', detail: '', checkedOn: '' });
      setCheckOpen(false);
      refreshExtras();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const saveMeal = async () => {
    if (!mealForm.servedOn || !mealForm.menu.trim()) { toast({ title: 'Date and menu are needed', tone: 'info' }); return; }
    const veg = Number(mealForm.vegCount), total = Number(mealForm.totalCount);
    if (!Number.isInteger(veg) || !Number.isInteger(total) || veg < 0 || total < 0 || veg > total) {
      toast({ title: 'Counts must be whole numbers, served within total', tone: 'info' }); return;
    }
    setBusy(true);
    try {
      const { mealsLog } = await import('../services/complianceApi');
      await mealsLog({ servedOn: mealForm.servedOn, menu: mealForm.menu.trim(), vegCount: veg, totalCount: total });
      toast({ title: 'Meal serving logged', sub: 'Same date corrects the row — it never duplicates.', tone: 'success' });
      setMealForm({ servedOn: '', menu: '', vegCount: '', totalCount: '' });
      setMealOpen(false);
      refreshExtras();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const issuePass = async (v: ClinicVisit) => {
    if (!window.confirm(`Issue a sick pass for ${v.studentName}? The pass releases them from class for a fixed window.`)) return;
    setPassing(v.visitId);
    try {
      const r = await apiIssueSickPass(v.visitId);
      toast({ title: `Sick pass issued — ${v.studentName}`, sub: `Valid until ${new Date(r.validUntil).toLocaleString()}.`, tone: 'success' });
      visits.retry();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setPassing(null); }
  };

  if (!canUse) {
    return (
      <Card>
        <Empty icon={<Icon.Shield size={24} />} title="The clinic log is not for your role"
          sub="Health records are nurse-lane PII under DPDP — the school office and coordinators only. A teacher who needs a pupil's clinic history asks the office." />
      </Card>
    );
  }

  const rows = visits.data?.visits ?? [];
  const today = rows.filter(v => new Date(v.visitedAt).toDateString() === new Date().toDateString());
  const sentHome = rows.filter(v => v.action === 'sent_home' || v.action === 'hospital_referral').length;

  return (
    <div>
      <PageHead
        title="Clinic"
        sub="The infirmary log. A visit is a record of what happened; a guardian notice is raised for approval, never sent from here."
        actions={
          <div className="u-inline" style={{ gap: 8 }}>
            <Button variant="secondary" icon={<Icon.Refresh size={14} />} onClick={visits.retry}>Refresh</Button>
            <Button variant="primary" icon={<Icon.Plus size={14} />} onClick={() => setLogOpen(true)}>Log a visit</Button>
          </div>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Visits logged" value={visits.loading ? '—' : rows.length} sub="From the infirmary log" />
        <Stat label="Today" value={visits.loading ? '—' : today.length} sub="Visits in the last day" />
        <Stat label="Sent home / referred" value={sentHome} sub="Each raised a notice for approval" />
        <Stat label="Office authority" value="Yours" sub="Clinic authority: owner, principal, IT admin, coordinator" />
      </div>

      <Section title="Infirmary log" sub="Newest first. Corrections are appended — what the infirmary wrote at the time is never rewritten.">
        {visits.loading ? <Card pad><div className="u-small u-muted">Reading the log…</div></Card>
          : visits.error ? <ErrorState title="Could not read the infirmary log" sub={friendly(visits.error)} onRetry={visits.retry} />
            : rows.length === 0 ? (
              <Card pad>
                <Empty title="No visits logged"
                  sub="Log the first visit and the add-on starts doing its job — the record, the event and (where it applies) the notice approval." />
              </Card>
            ) : (
              <Card pad={false}>
                <DataTable<ClinicVisit>
                  columns={[
                    { key: 'when', label: 'When', width: 150, render: v => <span className="u-small">{new Date(v.visitedAt).toLocaleString()}</span> },
                    { key: 'who', label: 'Pupil', render: v => <span style={{ fontWeight: 570 }}>{v.studentName}</span> },
                    { key: 'complaint', label: 'Complaint', render: v => <span className="u-small">{v.complaint}</span> },
                    { key: 'temp', label: 'Temp', width: 80, render: v => v.temperatureC != null ? <span className="tnum u-small">{v.temperatureC}°C</span> : <span className="u-faint">—</span> },
                    { key: 'action', label: 'Outcome', width: 180, render: v => {
                      const m = actionMeta(v.action);
                      return (
                        <span className="u-inline" style={{ gap: 6 }}>
                          <Badge tone={m.tone}>{m.label}</Badge>
                          {m.notifies && <span className="u-xs u-faint">notice raised</span>}
                        </span>
                      );
                    }},
                    {
                      key: 'act', label: '', width: 190, render: v => (
                        <span className="u-inline" style={{ gap: 6 }}>
                          <Button size="sm" variant="secondary" disabled={passing === v.visitId} onClick={() => { void issuePass(v); }}>
                            {passing === v.visitId ? '…' : 'Sick pass'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setCorrecting(v); setCorrection(''); }}>Correct</Button>
                        </span>
                      ),
                    },
                  ]}
                  rows={rows}
                  rowKey={v => v.visitId}
                />
              </Card>
            )}
      </Section>

      <div className="u-xs u-faint" style={{ marginTop: 14 }}>
        Guardian notices raised by the clinic wait for approval in{' '}
        <button onClick={() => navigate('/action-center')} style={{ background: 'none', border: 0, padding: 0, color: 'var(--accent-text)', cursor: 'pointer' }}>Approvals</button>
        {' '}— a visit never sends a message on its own.
      </div>

      <Section title="Checkups (RBSK · vaccination)" sub="Findings per pupil — the screening record behind referrals and parent conversations.">
        <div style={{ marginBottom: 12 }}>
          <Button variant="secondary" icon={<Icon.Plus size={14} />} onClick={() => setCheckOpen(true)}>Record a checkup</Button>
        </div>
        {checks == null ? <Card pad><div className="u-small u-muted">Reading checkups…</div></Card>
          : checks.length === 0 ? (
            <Card pad><Empty title="No checkups on record" sub="Record RBSK screenings and vaccinations here — findings, not placeholders." /></Card>
          ) : (
            <Card pad={false}>
              <DataTable<{ id: string; kind: string; detail: string; checked_on: string; student_name?: string }>
                columns={[
                  { key: 'when', label: 'Date', width: 130, render: r => <span className="u-small">{new Date(r.checked_on).toLocaleDateString()}</span> },
                  { key: 'who', label: 'Pupil', render: r => <span style={{ fontWeight: 570 }}>{r.student_name ?? '—'}</span> },
                  { key: 'kind', label: 'Kind', width: 130, render: r => <Badge tone="outline">{r.kind}</Badge> },
                  { key: 'detail', label: 'Finding', render: r => <span className="u-small">{r.detail}</span> },
                ]}
                rows={checks}
                rowKey={r => r.id}
              />
            </Card>
          )}
      </Section>

      <Section title="Midday meals" sub="What was served, and to how many. Logging the same date again corrects the row.">
        <div style={{ marginBottom: 12 }}>
          <Button variant="secondary" icon={<Icon.Plus size={14} />} onClick={() => setMealOpen(true)}>Log a serving</Button>
        </div>
        {meals == null ? <Card pad><div className="u-small u-muted">Reading the meal log…</div></Card>
          : meals.length === 0 ? (
            <Card pad><Empty title="No servings logged" sub="Log each day's menu and counts — the PM-POSHAN record." /></Card>
          ) : (
            <Card pad={false}>
              <DataTable<{ served_on: string; menu: string; veg_count: number; total_count: number }>
                columns={[
                  { key: 'date', label: 'Date', width: 140, render: r => <span className="u-small">{new Date(r.served_on).toLocaleDateString()}</span> },
                  { key: 'menu', label: 'Menu', render: r => <span className="u-small">{r.menu}</span> },
                  { key: 'count', label: 'Served', width: 130, render: r => <span className="tnum u-small">{r.total_count} <span className="u-faint">({r.veg_count} veg)</span></span> },
                ]}
                rows={meals}
                rowKey={r => r.served_on}
              />
            </Card>
          )}
      </Section>

      <Modal
        open={correcting != null}
        onClose={() => setCorrecting(null)}
        title="Append a correction"
        sub={correcting ? `${correcting.studentName} · ${new Date(correcting.visitedAt).toLocaleString()}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCorrecting(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" disabled={busy || correction.trim().length < 4} onClick={saveCorrection}>
              {busy ? 'Appending…' : 'Append the correction'}
            </Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 10 }}>
          {correcting?.complaint && (
            <div className="u-small u-muted">
              As logged: “{correcting.complaint}”
            </div>
          )}
          <label className="u-xs" htmlFor="cv-correction">What was wrong about it</label>
          <textarea id="cv-correction" className="input" rows={3} value={correction}
            onChange={e => setCorrection(e.target.value)} placeholder="e.g. logged as 39.2°C — the thermometer was faulty; the child was sent home" />
          <div className="u-xs u-faint">
            The original row is never rewritten. The correction is appended, so the log shows what the
            infirmary recorded at the time and what was later established.
          </div>
        </div>
      </Modal>

      <Modal
        open={checkOpen}
        onClose={() => setCheckOpen(false)}
        title="Record a checkup"
        sub="RBSK screenings and vaccinations, per pupil."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCheckOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" disabled={busy || !checkForm.studentId || !checkForm.detail.trim() || !checkForm.checkedOn} onClick={saveCheck}>
              {busy ? 'Recording…' : 'Record it'}
            </Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 12 }}>
          <div>
            <label className="u-xs" htmlFor="hc-student">Pupil</label>
            <select id="hc-student" className="input" style={{ width: '100%', marginTop: 5 }} value={checkForm.studentId} onChange={e => setCheckForm(f => ({ ...f, studentId: e.target.value }))}>
              <option value="">Choose…</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.name}{s.grade ? ` · ${s.grade}${s.section ? ` ${s.section}` : ''}` : ''}</option>)}
            </select>
          </div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div>
              <label className="u-xs" htmlFor="hc-kind">Kind</label>
              <select id="hc-kind" className="input" style={{ width: '100%', marginTop: 5 }} value={checkForm.kind} onChange={e => setCheckForm(f => ({ ...f, kind: e.target.value }))}>
                <option value="general">General</option>
                <option value="RBSK">RBSK screening</option>
                <option value="vaccination">Vaccination</option>
              </select>
            </div>
            <div>
              <label className="u-xs" htmlFor="hc-date">Date</label>
              <input id="hc-date" className="input" type="date" style={{ width: '100%', marginTop: 5 }} value={checkForm.checkedOn}
                onChange={e => setCheckForm(f => ({ ...f, checkedOn: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="u-xs" htmlFor="hc-detail">Finding</label>
            <textarea id="hc-detail" className="input" rows={2} style={{ width: '100%', marginTop: 5 }} value={checkForm.detail}
              onChange={e => setCheckForm(f => ({ ...f, detail: e.target.value }))} placeholder="e.g. Vision 6/6 both eyes, BMI normal" />
          </div>
        </div>
      </Modal>

      <Modal
        open={mealOpen}
        onClose={() => setMealOpen(false)}
        title="Log a meal serving"
        sub="One row per date — logging again corrects it."
        footer={
          <>
            <Button variant="ghost" onClick={() => setMealOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" disabled={busy || !mealForm.servedOn || !mealForm.menu.trim()} onClick={saveMeal}>
              {busy ? 'Logging…' : 'Log it'}
            </Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 12 }}>
          <div>
            <label className="u-xs" htmlFor="meal-date">Served on</label>
            <input id="meal-date" className="input" type="date" style={{ width: '100%', marginTop: 5 }} value={mealForm.servedOn}
              onChange={e => setMealForm(f => ({ ...f, servedOn: e.target.value }))} />
          </div>
          <div>
            <label className="u-xs" htmlFor="meal-menu">Menu</label>
            <input id="meal-menu" className="input" style={{ width: '100%', marginTop: 5 }} value={mealForm.menu}
              onChange={e => setMealForm(f => ({ ...f, menu: e.target.value }))} placeholder="e.g. Dal-rice + veg + banana" />
          </div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div>
              <label className="u-xs" htmlFor="meal-veg">Veg served</label>
              <input id="meal-veg" className="input" type="number" min={0} style={{ width: '100%', marginTop: 5 }} value={mealForm.vegCount}
                onChange={e => setMealForm(f => ({ ...f, vegCount: e.target.value }))} />
            </div>
            <div>
              <label className="u-xs" htmlFor="meal-total">Total served</label>
              <input id="meal-total" className="input" type="number" min={0} style={{ width: '100%', marginTop: 5 }} value={mealForm.totalCount}
                onChange={e => setMealForm(f => ({ ...f, totalCount: e.target.value }))} />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title="Log a clinic visit"
        sub="Appended to the infirmary log with your name. Sending a pupil home or referring them to hospital raises a guardian notice for approval."
        footer={
          <>
            <Button variant="ghost" onClick={() => setLogOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" disabled={busy || !form.studentId || !form.complaint.trim()} onClick={log}>
              {busy ? 'Logging…' : 'Log visit'}
            </Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 12 }}>
          <div>
            <label className="u-xs" htmlFor="cv-student">Pupil</label>
            <select id="cv-student" className="input" style={{ width: '100%', marginTop: 5 }} value={form.studentId} onChange={e => setForm(f => ({ ...f, studentId: e.target.value }))}>
              <option value="">Choose…</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.name}{s.grade ? ` · ${s.grade}${s.section ? ` ${s.section}` : ''}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="u-xs" htmlFor="cv-complaint">What is wrong</label>
            <input id="cv-complaint" className="input" style={{ width: '100%', marginTop: 5 }} value={form.complaint}
              onChange={e => setForm(f => ({ ...f, complaint: e.target.value }))} placeholder="e.g. fever and stomach pain since morning" />
          </div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div>
              <label className="u-xs" htmlFor="cv-temp">Temperature °C (optional)</label>
              <input id="cv-temp" className="input" type="number" step="0.1" min={30} max={45} style={{ width: '100%', marginTop: 5 }}
                value={form.temperatureC} onChange={e => setForm(f => ({ ...f, temperatureC: e.target.value }))} placeholder="e.g. 38.4" />
            </div>
            <div>
              <label className="u-xs" htmlFor="cv-action">Outcome</label>
              <select id="cv-action" className="input" style={{ width: '100%', marginTop: 5 }} value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))}>
                {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="u-xs" htmlFor="cv-notes">Notes (optional)</label>
            <textarea id="cv-notes" className="input" rows={2} style={{ width: '100%', marginTop: 5 }} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="u-xs u-faint">
            {actionMeta(form.action).notifies
              ? 'This outcome raises a guardian notice for approval — the family is not told anything until it is approved.'
              : 'This outcome does not raise a guardian notice.'}
          </div>
        </div>
      </Modal>
    </div>
  );
}
