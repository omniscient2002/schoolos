/* ============================================================
   Timetable — build the school day from the app (M3/M4, SPEC-TIMETABLE-WRITE-DOORS.md).

   Two jobs on one screen:
   1. Periods — the shape of the day (labels, times, breaks). Create, edit, retire.
   2. Slots — what each class-section does in each period. Create, edit, retire, with
      clash prevention (a class, teacher or room cannot be in two places at once).

   Doors (ops.timetable): GET/POST/PATCH /periods, /periods/:id/retire, /periods/seed-default,
   GET/POST/PATCH /slots, /slots/:id/retire, GET /grid, GET /first-period-teacher.
   Retirement is a status update — the app never deletes a period or slot. The server enforces
   every role; this screen only mirrors it.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { PageHead, Card, Badge, Button, Empty, ErrorState, SkeletonCard, Modal, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { friendly } from '../lib/friendlyErrors';
import { apiRequest } from '../services/liveApi';
import { apiSchoolClasses, apiSchoolSubjects, type SchoolClass, type SchoolSubject } from '../services/onboardingApi';
import { useRoleOrGrant } from '../lib/access';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Period { id: string; seq: string; label: string; start_time: string; end_time: string; is_break: boolean; sort_idx: number }
interface Slot { id: string; period_id: string; day_of_week: string; subject: string; teacher_name: string; teacher_id: string | null; room: string | null; grade: string | null; section: string | null }

const PERIOD_BASE = '/plugins/ops.timetable';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function Timetable() {
  const toast = useToast();
  const canWrite = useRoleOrGrant(['owner', 'principal', 'coordinator'], [`POST ${PERIOD_BASE}/periods`, `POST ${PERIOD_BASE}/slots`]);
  const canRetire = useRoleOrGrant(['owner', 'principal'], [`POST ${PERIOD_BASE}/periods/:id/retire`, `POST ${PERIOD_BASE}/slots/:id/retire`]);
  const canRead = useRoleOrGrant(['owner', 'principal', 'coordinator', 'teacher', 'itadmin', 'finance', 'admissions', 'transport', 'facilities', 'technician'], [`GET ${PERIOD_BASE}/grid`]);

  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<SchoolSubject[]>([]);
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  const [periodForm, setPeriodForm] = useState<null | { id?: string; seq: string; label: string; start_time: string; end_time: string; is_break: boolean }>(null);
  const [slotForm, setSlotForm] = useState<null | { id?: string; period_id: string; day_of_week: string; subject: string; teacher_name: string; room: string; grade: string; section: string; force: boolean }>(null);

  useEffect(() => {
    if (!canRead) return;
    let dead = false;
    setLoading(true); setError(null);
    const q = grade ? `?grade=${encodeURIComponent(grade)}${section ? `&section=${encodeURIComponent(section)}` : ''}` : '';
    Promise.all([
      apiRequest<{ periods: Period[] }>(`${PERIOD_BASE}/periods`),
      apiRequest<{ slots: Slot[] }>(`${PERIOD_BASE}/grid${q}`),
      apiSchoolClasses().catch(() => ({ classes: [] as SchoolClass[] })),
      apiSchoolSubjects().catch(() => ({ subjects: [] as SchoolSubject[] })),
    ]).then(([p, g, c, s]) => {
      if (dead) return;
      setPeriods(p.periods ?? []);
      setSlots(g.slots ?? []);
      setClasses(c.classes ?? []);
      setSubjects(s.subjects ?? []);
      setLoading(false);
    }).catch(e => { if (!dead) { setError(friendly(e)); setLoading(false); } });
    return () => { dead = true; };
  }, [tick, grade, section, canRead]);

  const reload = () => setTick(t => t + 1);

  const savePeriod = async () => {
    if (!periodForm) return;
    if (!periodForm.seq.trim() || !periodForm.label.trim()) { toast({ title: 'A code and a label are required', tone: 'info' }); return; }
    if (!HHMM.test(periodForm.start_time) || !HHMM.test(periodForm.end_time)) { toast({ title: 'Times must be HH:MM (24-hour)', tone: 'info' }); return; }
    setBusy(true);
    try {
      const { id, ...body } = periodForm;
      if (id) await apiRequest(`/plugins/ops.timetable/periods/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await apiRequest('/plugins/ops.timetable/periods', { method: 'POST', body: JSON.stringify(body) });
      toast({ title: id ? 'Period updated' : 'Period added', tone: 'success' });
      setPeriodForm(null); reload();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const retirePeriod = async (id: string, label: string) => {
    setBusy(true);
    try {
      await apiRequest(`${PERIOD_BASE}/periods/${id}/retire`, { method: 'POST', body: '{}' });
      toast({ title: `Retired ${label}`, sub: 'Its slots left the grid too. Nothing was deleted.', tone: 'success' });
      reload();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const seedDefault = async () => {
    setBusy(true);
    try {
      const r = await apiRequest<{ created: number }>(`${PERIOD_BASE}/periods/seed-default`, { method: 'POST', body: '{}' });
      toast({ title: r.created ? `${r.created} periods added` : 'Nothing to add', sub: r.created ? 'The standard Indian school day is ready to edit.' : 'This school already has periods.', tone: r.created ? 'success' : 'info' });
      reload();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const openNewSlot = (periodId: string, day: string) => {
    setSlotForm({ period_id: periodId, day_of_week: day, subject: '', teacher_name: '', room: '', grade, section, force: false });
  };

  const saveSlot = async () => {
    if (!slotForm) return;
    if (!slotForm.subject.trim() || !slotForm.teacher_name.trim()) { toast({ title: 'A subject and a teacher are required', tone: 'info' }); return; }
    setBusy(true);
    const body = {
      period_id: slotForm.period_id, day_of_week: slotForm.day_of_week, subject: slotForm.subject.trim(),
      teacher_name: slotForm.teacher_name.trim(), room: slotForm.room.trim() || null,
      grade: slotForm.grade || null, section: slotForm.section || null, force: slotForm.force,
    };
    try {
      if (slotForm.id) await apiRequest(`/plugins/ops.timetable/slots/${slotForm.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await apiRequest('/plugins/ops.timetable/slots', { method: 'POST', body: JSON.stringify(body) });
      toast({ title: slotForm.id ? 'Slot updated' : 'Slot added', tone: 'success' });
      setSlotForm(null); reload();
    } catch (e) {
      const msg = friendly(e);
      // A 409 is a clash — surface the server's reason and let the operator force it.
      if (/already/i.test(msg)) {
        toast({ title: 'That would double-book someone', sub: `${msg} Use "Place anyway" to override.`, tone: 'info' });
        setSlotForm(f => (f ? { ...f, force: true } : f));
      } else toast({ title: msg, tone: 'error' });
    } finally { setBusy(false); }
  };

  const retireSlot = async (id: string) => {
    setBusy(true);
    try {
      await apiRequest(`${PERIOD_BASE}/slots/${id}/retire`, { method: 'POST', body: '{}' });
      toast({ title: 'Slot retired', tone: 'success' });
      setSlotForm(null); reload();
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const slotAt = useMemo(() => {
    const map = new Map<string, Slot>();
    for (const s of slots ?? []) map.set(`${s.period_id}|${s.day_of_week}`, s);
    return map;
  }, [slots]);

  const classOptions = classes.filter(c => c.grade);

  if (!canRead) {
    return (
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <PageHead title="Timetable" sub="Build the school day: periods and what each class does in them." />
        <Empty icon={<Icon.Lock size={22} />} title="Not available on this account"
          sub="The timetable is a staff surface. Ask the school office if you need to see it." />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <PageHead
        title="Timetable"
        sub="The shape of the school day and what each class-section does in every period. Retiring keeps the record — nothing is deleted."
        actions={canWrite ? <Button onClick={() => setPeriodForm({ seq: '', label: '', start_time: '08:00', end_time: '08:45', is_break: false })}>Add period</Button> : undefined}
      />

      {loading ? <SkeletonCard lines={6} /> : error ? (
        <ErrorState title="Could not load the timetable" sub={error.replace('Error: ', '')} onRetry={reload} />
      ) : (
        <>
          <Card headAs="h2" head="Periods" sub="The sequence of the day. Breaks are part of the shape too."
            actions={canWrite && !periods?.length ? <Button variant="ghost" onClick={seedDefault} disabled={busy}>Start from the standard day</Button> : undefined}>
            {!periods?.length ? (
              <Empty title="No periods yet" sub="Add the first period, or start from a standard Indian school day and edit it." />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Code</th><th>Label</th><th>Time</th><th /></tr></thead>
                  <tbody>
                    {periods.map(p => (
                      <tr key={p.id}>
                        <td><Badge tone={p.is_break ? 'neutral' : 'info'}>{p.seq}</Badge></td>
                        <td>{p.label}{p.is_break ? <span className="u-faint u-xs"> · break</span> : null}</td>
                        <td className="u-small">{p.start_time}–{p.end_time}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {canWrite && <Button variant="ghost" size="sm" onClick={() => setPeriodForm({ id: p.id, seq: p.seq, label: p.label, start_time: p.start_time, end_time: p.end_time, is_break: p.is_break })} disabled={busy}>Edit</Button>}
                          {canRetire && <Button variant="ghost" size="sm" onClick={() => retirePeriod(p.id, p.label)} disabled={busy}>Retire</Button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card headAs="h2" head="Weekly grid" sub="Pick a class-section to see and edit its week; school-wide slots show for every class."
            actions={classOptions.length ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select aria-label="Class" value={grade} onChange={e => { setGrade(e.target.value); setSection(''); }}>
                  <option value="">School-wide</option>
                  {classOptions.map(c => <option key={c.grade} value={c.grade}>Class {c.grade}</option>)}
                </select>
                <select aria-label="Section" value={section} onChange={e => setSection(e.target.value)} disabled={!grade || !(classOptions.find(c => c.grade === grade)?.sections.length)}>
                  <option value="">{grade && !(classOptions.find(c => c.grade === grade)?.sections.length) ? 'No sections' : 'All sections'}</option>
                  {(classOptions.find(c => c.grade === grade)?.sections ?? []).map(s => <option key={s} value={s}>Section {s}</option>)}
                </select>
              </div>
            ) : undefined}>
            {!periods?.length ? (
              <Empty title="Add periods first" sub="The grid is laid out from the periods above." />
            ) : (
              <div className="table-wrap">
                <table className="data" style={{ minWidth: 760 }}>
                  <thead>
                    <tr><th>Period</th>{DAYS.map(d => <th key={d}>{d.slice(0, 3)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {periods.map(p => (
                      <tr key={p.id}>
                        <td className="u-small"><strong>{p.label}</strong><div className="u-faint u-xs">{p.start_time}–{p.end_time}</div></td>
                        {DAYS.map(d => {
                          if (p.is_break) return <td key={d} className="u-faint u-xs">—</td>;
                          const s = slotAt.get(`${p.id}|${d}`);
                          if (!s) {
                            return (
                              <td key={d}>
                                {canWrite ? (
                                  <button type="button" className="u-faint u-xs" style={{ border: '1px dashed var(--line)', background: 'transparent', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }}
                                    onClick={() => openNewSlot(p.id, d)}>+ add</button>
                                ) : <span className="u-faint u-xs">—</span>}
                              </td>
                            );
                          }
                          return (
                            <td key={d}>
                              <button type="button" onClick={() => canWrite && setSlotForm({ id: s.id, period_id: s.period_id, day_of_week: s.day_of_week, subject: s.subject, teacher_name: s.teacher_name, room: s.room ?? '', grade: s.grade ?? '', section: s.section ?? '', force: false })}
                                style={{ textAlign: 'left', border: 0, background: 'transparent', cursor: canWrite ? 'pointer' : 'default', padding: 0 }}>
                                <div className="u-small" style={{ fontWeight: 600 }}>{s.subject}</div>
                                <div className="u-faint u-xs">{s.teacher_name}{s.room ? ` · ${s.room}` : ''}</div>
                                {s.grade ? <div className="u-faint u-xs">{s.grade}-{s.section ?? ''}</div> : null}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <Modal open={periodForm != null} onClose={() => setPeriodForm(null)} title={periodForm?.id ? 'Edit period' : 'Add a period'} sub="A short code, a label people recognise, and its times."
        footer={<div className="u-flex" style={{ gap: 8 }}><Button variant="ghost" onClick={() => setPeriodForm(null)}>Cancel</Button><Button onClick={savePeriod} disabled={busy}>{busy ? 'Saving…' : (periodForm?.id ? 'Save changes' : 'Add period')}</Button></div>}>
        {periodForm && (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 2fr' }}>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">Code</span>
              <input value={periodForm.seq} maxLength={8} placeholder="1 / B / L" onChange={e => setPeriodForm({ ...periodForm, seq: e.target.value })} /></label>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">Label</span>
              <input value={periodForm.label} maxLength={60} placeholder="Period 1" onChange={e => setPeriodForm({ ...periodForm, label: e.target.value })} /></label>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">Starts</span>
              <input value={periodForm.start_time} placeholder="08:00" onChange={e => setPeriodForm({ ...periodForm, start_time: e.target.value })} /></label>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">Ends</span>
              <input value={periodForm.end_time} placeholder="08:45" onChange={e => setPeriodForm({ ...periodForm, end_time: e.target.value })} /></label>
            <label className="u-flex u-small" style={{ gap: 8, gridColumn: '1 / -1' }}>
              <input type="checkbox" checked={periodForm.is_break} onChange={e => setPeriodForm({ ...periodForm, is_break: e.target.checked })} /> This is a break
            </label>
          </div>
        )}
      </Modal>

      <Modal open={slotForm != null} onClose={() => setSlotForm(null)} title={slotForm?.id ? 'Edit slot' : 'Add a slot'}
        sub="Who teaches what, where. The server refuses a clash unless you choose to place it anyway."
        footer={<div className="u-flex" style={{ gap: 8, justifyContent: 'space-between', width: '100%' }}>
          <div>{slotForm?.id && canRetire && <Button variant="danger" onClick={() => slotForm && retireSlot(slotForm.id!)} disabled={busy}>Retire slot</Button>}</div>
          <div className="u-flex" style={{ gap: 8 }}><Button variant="ghost" onClick={() => setSlotForm(null)}>Cancel</Button>
            <Button onClick={saveSlot} disabled={busy}>{busy ? 'Saving…' : (slotForm?.force ? 'Place anyway' : 'Save slot')}</Button></div>
        </div>}>
        {slotForm && (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">Day</span>
              <select value={slotForm.day_of_week} onChange={e => setSlotForm({ ...slotForm, day_of_week: e.target.value })}>{DAYS.map(d => <option key={d}>{d}</option>)}</select></label>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">Period</span>
              <select value={slotForm.period_id} onChange={e => setSlotForm({ ...slotForm, period_id: e.target.value })}>{(periods ?? []).filter(p => !p.is_break).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">Subject</span>
              <input list="timetable-subjects" value={slotForm.subject} maxLength={60} onChange={e => setSlotForm({ ...slotForm, subject: e.target.value })} /></label>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">Teacher</span>
              <input value={slotForm.teacher_name} maxLength={80} onChange={e => setSlotForm({ ...slotForm, teacher_name: e.target.value })} /></label>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">Room (optional)</span>
              <input value={slotForm.room} maxLength={40} onChange={e => setSlotForm({ ...slotForm, room: e.target.value })} /></label>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">Class (optional)</span>
              <select value={slotForm.grade} onChange={e => setSlotForm({ ...slotForm, grade: e.target.value, section: '' })}>
                <option value="">School-wide</option>
                {classOptions.map(c => <option key={c.grade} value={c.grade}>Class {c.grade}</option>)}
              </select></label>
            <label style={{ display: 'grid', gap: 4 }}><span className="u-small">Section (optional)</span>
              <select value={slotForm.section} onChange={e => setSlotForm({ ...slotForm, section: e.target.value })} disabled={!slotForm.grade}>
                <option value="">—</option>
                {(classOptions.find(c => c.grade === slotForm.grade)?.sections ?? []).map(s => <option key={s} value={s}>Section {s}</option>)}
              </select></label>
            {slotForm.force && <div className="u-small" style={{ gridColumn: '1 / -1', color: 'var(--warning)' }}>The server flagged a clash. Saving now will place it anyway and record the override.</div>}
          </div>
        )}
      </Modal>
      <datalist id="timetable-subjects">
        {subjects.map(s => <option key={s.id} value={s.name} />)}
      </datalist>
    </div>
  );
}
