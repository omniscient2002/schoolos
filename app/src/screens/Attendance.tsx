/* ============================================================
   Attendance — the mark sheet + register history.
   T401: the submit path hits the real door (POST /attendance/mark)
   via apiMarkAttendance — success toasts only on 2xx and carry the
   SERVER's counts; failures surface friendly errors (never a
   "kept on this device" lie). The register reads server rows
   (GET /attendance) so submitted marks survive a reload.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as seed from '../data/dataset';
import { apiAttendance, apiGet, apiMarkAttendance, apiPost } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { useStore } from '../state/store';
import {
  Avatar, Badge, Button, Card, DataTable, Empty, ErrorState, PageHead, SampleNote, Section, Skeleton, Stat, Tabs, useToast,
} from '../components/ui';
import { LineChart } from '../components/Chart';
import { Icon } from '../components/Icon';
import { fmtDate, fmtDateShort, fmtRelative, weekday } from '../lib/format';
import type { Person } from '../types/domain';

/* Local async hook (duplicated per screen per APP-SPEC §async pattern) */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => { if (live) setState({ data: d, loading: false, error: null }); })
      .catch(e => { if (live) setState({ data: null, loading: false, error: String(e) }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

type Mark = 'present' | 'absent' | 'late' | 'excused';
const MARKS: Mark[] = ['present', 'absent', 'late', 'excused'];
const cap = (m: Mark) => m[0].toUpperCase() + m.slice(1);

const campusShort = (id: string) => seed.campuses.find(c => c.id === id)?.shortName ?? id;

/* The school day runs on IST — compute it once and pass the SAME date to
   the read and the write so an evening register can never land on the
   wrong day (server-side toISOString defaults are UTC). */
const istToday = (): Date => {
  const iso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
  return new Date(`${iso}T00:00:00`);
};
const isoDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Server row shape from GET /attendance */
interface ServerRow { id: string; admission_no: string | null; name: string; grade: string; section: string; status: string | null; note?: string | null }

interface RosterRow {
  person: Person;
  prefill: Mark | null;
  note?: string;
}

/* GRADE-1: `grade` is a free-text string everywhere on the server. The school
   authors it on the Classes screen ("e.g. 6, LKG, Nursery"), and the value comes
   back from GET /attendance as text. This screen used to coerce it with
   Number(), which turns every real grade name into NaN — the picker rendered
   "Grade NaN-A" and the register for the chosen section came back empty, so a
   school could not mark attendance at all. Kept as text; ordering uses a
   numeric-aware comparator that falls back to natural order. */
interface SectionOpt { id: string; grade: string; name: string; campus: string; count: number }

/** "Grade 2" / "2" / "II" ordering: numeric when the grade carries a number, else natural. */
function gradeOrder(g: string): number {
  const m = /(\d+)/.exec(g);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

interface RegisterData {
  /** all students for the day (server rows or demo blob) — sliced client-side by section */
  allRows: RosterRow[];
  serverMode: boolean;
  sections: SectionOpt[];
  markedToday: boolean;
  lastMarkAt: Date | null;
  markedBy: string | null;
}

interface HistoryRow { date: Date; absent: number; late: number; pct: number; names: string[]; markedBy: string; live: boolean; error?: boolean }

const markFromStatus = (s: string | null | undefined): Mark | null =>
  s === 'present' || s === 'absent' || s === 'late' ? s as Mark : s === 'leave' ? 'excused' : null;

export default function Attendance() {
  const navigate = useNavigate();
  const { session, actorName, dispatch } = useStore();
  const toast = useToast();

  const isTeacher = session.roleId === 'teacher';
  const today = istToday();
  const todayISO = isoDay(today);

  const [sectionId, setSectionId] = useState('');
  const [tab, setTab] = useState<'mark' | 'history'>('mark');

  /* Day codes: 12-char single-day tokens per pupil (print the sheet, pupils show slips or read
     their code from the student portal). Marking consumes valid codes; yesterday's are dead. */
  const [qrOpen, setQrOpen] = useState(false);
  const [qrCodes, setQrCodes] = useState<{ studentId: string; name: string; code: string }[] | null>(null);
  const [qrPaste, setQrPaste] = useState('');
  const loadQr = async () => {
    if (!section) { toast({ title: 'Pick a class first', tone: 'info' }); return; }
    setQrOpen(true);
    try {
      const r = await apiGet<{ day: string; tokens: { studentId: string; name: string; code: string }[] }>(
        `/attendance/qr?grade=${encodeURIComponent(section.grade)}&section=${encodeURIComponent(section.name)}`);
      setQrCodes(r.tokens ?? []);
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); setQrCodes([]); }
  };
  const markQr = async () => {
    const codes = qrPaste.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    if (!codes.length) { toast({ title: 'Paste or type the day codes', tone: 'info' }); return; }
    try {
      const r = await apiPost<{ marked: string[]; markedCount: number; invalid: number }>('/attendance/qr-mark', { codes });
      toast({ title: r.markedCount ? `Marked present — ${r.marked.slice(0, 3).join(', ')}${r.marked.length > 3 ? ` +${r.marked.length - 3} more` : ''}` : 'No valid codes',
        sub: r.invalid ? `${r.invalid} code(s) ignored (wrong class, stale day, or typo).` : undefined,
        tone: r.markedCount ? 'success' : 'info' });
      setQrPaste('');
    } catch (e) { toast({ title: friendly(e), tone: 'error' }); }
  };

  /* ---- register load: the register IS the server response ---- */
  const register = useAsync<RegisterData>(async () => {
    /* UX-05: a failed register fetch must stay a retryable error — never an
       apparently empty live roster. Let the rejection reach useAsync so the
       error shell renders instead of a zero-student section. */
    const res = await apiAttendance(todayISO);
    const server: ServerRow[] = Array.isArray(res.rows) ? res.rows as ServerRow[] : [];

    const byKey = new Map<string, ServerRow[]>();
    for (const r of server) {
      const key = `${r.grade}|${r.section}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(r);
    }
    const sections: SectionOpt[] = [...byKey.entries()].map(([key, list]) => ({
      id: key, grade: String(list[0].grade ?? ''), name: String(list[0].section ?? ''), campus: session.activeCampus, count: list.length,
    })).sort((a, b) => gradeOrder(a.grade) - gradeOrder(b.grade) || a.name.localeCompare(b.name));
    const allRows: RosterRow[] = server.map(r => ({
      person: {
        id: r.id, name: r.name, type: 'student', campus: session.activeCampus, email: '', phone: '',
        grade: String(r.grade ?? ''), section: String(r.section ?? ''), rollNo: r.admission_no ?? undefined,
      } as Person,
      prefill: markFromStatus(r.status),
      note: r.note ?? undefined,
    }));
    const marked = allRows.filter(r => r.prefill);
    return {
      allRows, serverMode: true, sections,
      markedToday: marked.length > 0, lastMarkAt: marked.length ? today : null, markedBy: null,
    };
  }, [todayISO]);

  /* ---- section picker: derived from the loaded register ---- */
  const sections = register.data?.sections ?? [];
  useEffect(() => {
    if (register.data && !sectionId && sections.length) setSectionId(sections[0].id);
  }, [register.data, sections, sectionId]);
  /* if the loaded data no longer contains the chosen section, fall back */
  useEffect(() => {
    if (sectionId && sections.length && !sections.some(s => s.id === sectionId)) setSectionId(sections[0].id);
  }, [sections, sectionId]);

  const section = sections.find(s => s.id === sectionId);
  const sectionLabel = section ? `${section.grade} · ${section.name}` : '—';
  const serverMode = register.data?.serverMode ?? false;
  const demoSection = !serverMode ? seed.sections.find(s => s.id === sectionId) : undefined;
  const classTeacher = demoSection ? seed.findPerson(demoSection.classTeacherId) : undefined;
  /* Empty-world law: the Bus-14 anomaly banner narrates a seeded incident;
     only render when that section actually exists in the tenant. */
  const isAnomaly = sectionId === 'north-g8-b' && seed.sections.some(sec => sec.id === 'north-g8-b');

  const rows = useMemo(
    () => (register.data?.allRows ?? []).filter(r => {
      if (!sectionId) return false;
      if (serverMode) return `${r.person.grade}|${r.person.section}` === sectionId;
      const sec = seed.sectionOfStudent(r.person);
      return sec?.id === sectionId;
    }),
    [register.data, sectionId, serverMode],
  );
  const rowById = useMemo(() => new Map(rows.map(r => [r.person.id, r])), [rows]);

  /* ---- draft marking state ---- */
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [exceptMode, setExceptMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  /* fresh section → fresh draft */
  useEffect(() => {
    setMarks({}); setExceptMode(false); setSubmitted(false);
  }, [sectionId]);

  const markOf = (id: string): Mark => marks[id] ?? rowById.get(id)?.prefill ?? 'present';
  const setMark = (id: string, m: Mark) => {
    setMarks(prev => ({ ...prev, [id]: m }));
    setSubmitted(false);
  };

  const summary = useMemo(() => {
    let absent = 0, late = 0, excused = 0;
    rows.forEach(r => {
      const m = markOf(r.person.id);
      if (m === 'absent') absent++;
      else if (m === 'late') late++;
      else if (m === 'excused') excused++;
    });
    const present = rows.length - absent - late - excused;
    const pct = rows.length ? Math.round(((rows.length - absent) / rows.length) * 100) : 0;
    return { absent, late, excused, present, pct };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, marks]);

  /* ≥1 marked row must exist before the register can go anywhere */
  const hasMarks = rows.length > 0 && (Object.keys(marks).length > 0 || rows.every(r => r.prefill));
  const dirty = Object.keys(marks).length > 0;

  const markAllPresent = () => {
    const m: Record<string, Mark> = {};
    rows.forEach(r => { m[r.person.id] = 'present'; });
    setMarks(m);
    setSubmitted(false);
    toast({ title: `All ${rows.length} students marked present`, sub: 'Adjust exceptions before submitting the register.', tone: 'info' });
  };

  const toggleExcept = (id: string) => {
    const m = markOf(id);
    setMark(id, m === 'present' ? 'absent' : 'present');
  };

  const submit = async () => {
    setSaving(true);
    const markable = rows.filter(r => markOf(r.person.id) !== 'excused');
    const entries = markable.map(r => ({
      studentId: r.person.id,
      status: markOf(r.person.id) as 'present' | 'absent' | 'late',
    }));
    try {
      if (serverMode && entries.every(e => UUID_RE.test(e.studentId))) {
        const res = await apiMarkAttendance(todayISO, entries);
        setSubmitted(true);
        /* Session feeds only — the durable record is the server's (reload proves it). */
        dispatch({
          type: 'event/add',
          e: {
            id: `ev_${Date.now()}`, on: new Date(), type: 'attendance',
            label: `Register submitted — ${sectionLabel} · ${res.absent} absent`,
            severity: res.absent > 4 ? 'warn' : 'info',
          },
        });
        dispatch({
          type: 'audit/add',
          entry: {
            actor: actorName, actorRole: session.roleId, action: 'Submitted attendance register',
            recordType: 'Attendance', recordRef: `${sectionLabel} · ${res.marked} students`,
            reason: 'Register submission', policyRef: 'Attendance §1.1', aiInvolved: false, risk: 'low',
            outcome: `Server accepted ${res.marked} marks · ${res.noticesQueued} absence notices queued`,
          },
        });
        toast({
          title: `Register submitted — ${res.marked} ${res.marked === 1 ? 'student' : 'students'} saved`,
          sub: res.noticesQueued
            ? `${res.noticesQueued} absence ${res.noticesQueued === 1 ? 'notice' : 'notices'} queued to guardians (Attendance §1.1)`
            : 'Full attendance — no notifications needed',
          tone: 'success',
        });
        register.retry(); /* re-pull the door so prefill reflects what the server stored */
      } else {
        /* Demo fixture ids are not database rows — there is no honest door for
           them. Session-local only, and the copy says exactly that. */
        setSubmitted(true);
        toast({
          title: 'Register kept for this session',
          sub: 'Demo world — this register is not connected to school records and will not survive a reload.',
          tone: 'info',
        });
      }
    } catch (e) {
      toast({ title: 'Could not submit the register', sub: friendly(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  /* ---- register history: demo keeps its 30-day blob chart; the live world
          aggregates the last 7 days straight from the read door ---- */
  const historyDays = useMemo(() => {
    if (!serverMode) return seed.TERM_DAYS.map(d => ({ date: d }));
    const days: { date: Date }[] = [];
    for (let i = 0; i < 7; i++) days.push({ date: new Date(today.getTime() - i * 86400000) });
    return days.reverse();
  }, [serverMode, today.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const history = useAsync<HistoryRow[]>(async () => {
    if (!serverMode) {
      const total = rows.length;
      return seed.TERM_DAYS.map(d => {
        const t = d.getTime();
        const recs = seed.attendance.filter(a => a.sectionId === sectionId && a.date.getTime() === t);
        const absent = recs.filter(r => r.status === 'absent').length;
        const late = recs.filter(r => r.status === 'late').length;
        const names = recs.filter(r => r.status === 'absent').map(r => seed.findPerson(r.studentId)?.name ?? 'Unknown');
        return {
          date: d, absent, late,
          pct: total ? Math.round(((total - absent) / total) * 100) : 0,
          names, markedBy: recs[0] ? seed.findPerson(recs[0].markedBy)?.name ?? '—' : '—',
          live: false,
        };
      });
    }
    if (!sectionId) return [];
    const [grade, sec] = sectionId.split('|');
    const perDay = await Promise.all(historyDays.map(async ({ date }): Promise<HistoryRow> => {
      try {
        const res = await apiAttendance(isoDay(date), grade, sec);
        const list = (res.rows ?? []) as ServerRow[];
        const statuses = list.map(r => markFromStatus(r.status)).filter(Boolean) as Mark[];
        const absent = statuses.filter(s => s === 'absent').length;
        const late = statuses.filter(s => s === 'late').length;
        const names = list.filter(r => r.status === 'absent').map(r => r.name);
        return {
          date, absent, late,
          pct: list.length ? Math.round(((list.length - absent) / list.length) * 100) : 0,
          names, markedBy: '—', live: true,
        };
      } catch {
        return { date, absent: 0, late: 0, pct: 0, names: [], markedBy: '—', live: true, error: true };
      }
    }));
    return perDay;
  }, [serverMode, sectionId, todayISO, tab]);

  const historyRows = history.data ?? [];
  const historyDesc = useMemo(() => [...historyRows].reverse(), [historyRows]);
  const chartLabels = historyRows.map(h => fmtDateShort(h.date).replace(/\s\S+$/, ''));

  /* ---------- shells ---------- */
  if (register.loading) {
    return (
      <>
        <PageHead title={isTeacher ? 'My class — attendance' : 'Attendance'} sub="Loading today's register…" />
        <Card>
          <div className="u-col" style={{ gap: 14, padding: '16px 20px' }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="u-between" style={{ gap: 12 }}>
                <div className="u-flex" style={{ gap: 10 }}>
                  <Skeleton w={24} h={30} r={15} />
                  <Skeleton w={150 + (i % 3) * 30} h={14} />
                </div>
                <Skeleton w={230} h={26} r={9} />
              </div>
            ))}
          </div>
        </Card>
      </>
    );
  }
  if (register.error) {
    return (
      <>
        <PageHead title={isTeacher ? 'My class — attendance' : 'Attendance'} back={isTeacher ? undefined : { to: '/today', label: 'Today' }} />
        <ErrorState
          title="Could not load the register"
          sub="The attendance service did not respond. Nothing was changed — try again."
          onRetry={register.retry}
        />
      </>
    );
  }

  return (
    <>
      <PageHead
        title={isTeacher ? 'My class — attendance' : 'Attendance'}
        sub={isTeacher
          ? 'Mark the register in seconds. Absence notices are queued to guardians automatically.'
          : 'First-period registers across your scope. Marking is teacher-owned; SchoolOS queues the follow-ups.'}
        actions={
          <>
            {!serverMode && <Badge tone="outline">Demo data</Badge>}
            <Badge tone={register.data?.markedToday ? 'success' : 'warning'} dot>
              {register.data?.markedToday
                ? `Marked today · ${register.data.lastMarkAt ? fmtRelative(register.data.lastMarkAt) : 'just now'}`
                : 'Not marked today'}
            </Badge>
          </>
        }
      />

      {!serverMode && <SampleNote>Sample attendance — this register is the demo world in this build, not read from your school&rsquo;s records.</SampleNote>}

      {/* ---- section picker ---- */}
      <div className="u-flex u-wrap" style={{ gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <label className="u-flex u-small" style={{ gap: 7, alignItems: 'center' }}>
          <span className="u-faint">Section</span>
          <select
            className="select"
            value={sectionId}
            onChange={e => setSectionId(e.target.value)}
            aria-label="Choose section"
            style={{ width: 300 }}
          >
            {sections.map(s => (
              <option key={s.id} value={s.id}>
                {`${s.grade} · ${s.name} · ${s.count} students`}
              </option>
            ))}
          </select>
        </label>
        {!serverMode && (
          <span className="u-small u-faint">
            Room {demoSection?.room ?? '—'} · Class teacher {classTeacher?.name ?? '—'}
          </span>
        )}
      </div>

      {/* ---- Bus 14 anomaly banner (demo blob only) ---- */}
      {isAnomaly && (
        <div
          className="u-flex u-wrap"
          style={{
            gap: 10, padding: '11px 16px', marginBottom: 16,
            background: 'var(--warning-weak)', border: '1px solid var(--warning-weak-2)', borderRadius: 'var(--r-lg)',
            alignItems: 'flex-start',
          }}
        >
          <Icon.Alert size={16} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 600 }}>Anomaly detected — 23% presence vs 94% avg</div>
            <div className="u-small u-muted" style={{ marginTop: 2 }}>
              Bus 14 (Route 7) affects 5 riders. Attendance leniency until 09:30 per Attendance §1.4 — arrivals before then are marked present.
            </div>
          </div>
          <Link to="/attention" style={{ alignSelf: 'center' }}>
            <Button size="sm" variant="secondary" iconRight={<Icon.ArrowRight size={12} />}>Review evidence</Button>
          </Link>
        </div>
      )}

      {/* ---- stats ---- */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat
          label="Presence today"
          value={`${summary.pct}%`}
          delta={{ value: dirty ? 'draft' : register.data?.markedToday ? 'submitted' : 'unmarked', dir: 'flat' }}
          sub={`${rows.length} on roster`}
        />
        <Stat
          label="Absent"
          value={summary.absent}
          sub={summary.absent
            ? rows.filter(r => markOf(r.person.id) === 'absent').map(r => r.person.name.split(' ')[0]).slice(0, 4).join(', ') + (summary.absent > 4 ? '…' : '')
            : 'None marked'}
        />
        <Stat label="Late" value={summary.late} sub="Marked present under leniency until 09:30 (Attendance §1.4)" />
        <Stat
          label="Unmarked"
          value={rows.filter(r => !r.prefill && !marks[r.person.id]).length}
          sub="Defaults to present until submitted"
        />
      </div>

      <Tabs
        active={tab}
        onChange={id => setTab(id as 'mark' | 'history')}
          panelId="att-tab"
        tabs={[{ id: 'mark', label: 'Today — mark' }, { id: 'history', label: serverMode ? 'History — last 7 days' : 'History — 30 days' }]}
      />

      {/* ================= Today — mark ================= */}
      {tab === 'mark' && (
        rows.length === 0 ? (
          <div role="tabpanel" id="att-tab-panel-mark" aria-labelledby="att-tab-tab-mark" style={{ marginTop: 16 }}>
            <Empty
              icon={<Icon.People size={26} />}
              title={serverMode ? 'No students on the roster yet' : 'No students in this section'}
              sub={serverMode
                ? 'Students appear here as soon as they are admitted. Add your first students from the People console.'
                : `${sectionLabel} has no enrolled students. Choose another section from the picker above.`}
              action={serverMode
                ? <Button variant="secondary" onClick={() => navigate('/people-admin')}>Open People console</Button>
                : <Button variant="secondary" onClick={() => navigate('/people')}>Open Directory</Button>}
            />
          </div>
        ) : (
          <div role="tabpanel" id="att-tab-panel-mark" aria-labelledby="att-tab-tab-mark" style={{ marginTop: 16 }}>
            <Card>
              <div className="u-between u-wrap" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', gap: 10 }}>
                <div className="u-flex u-wrap" style={{ gap: 8 }}>
                  <Button size="sm" variant="primary" icon={<Icon.Check size={13} />} onClick={markAllPresent}>Mark all present</Button>
                  <Button
                    size="sm"
                    variant={exceptMode ? 'ai' : 'secondary'}
                    icon={<Icon.User size={13} />}
                    aria-pressed={exceptMode}
                    onClick={() => setExceptMode(e => !e)}
                  >
                    Everyone present except…
                  </Button>
                  <Button size="sm" variant={qrOpen ? 'ai' : 'secondary'} icon={<Icon.Code size={13} />} aria-pressed={qrOpen} onClick={() => { setQrOpen(o => !o); if (!qrOpen) void loadQr(); }}>
                    Day codes
                  </Button>
                </div>
                <div className="u-flex" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="u-xs u-faint">{weekday(today)}, {fmtDate(today)}{register.data?.markedBy ? ` · marked by ${register.data.markedBy}` : ''}</span>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={saving}
                    disabled={!hasMarks || (submitted && !dirty)}
                    icon={<Icon.Clipboard size={13} />}
                    onClick={submit}
                    title={!hasMarks ? 'Mark at least one student first' : undefined}
                  >
                    {submitted && !dirty ? 'Submitted' : 'Submit register'}
                  </Button>
                </div>
              </div>

              {exceptMode && (
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-2)' }}>
                  <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
                    Tap the students who are NOT present
                  </div>
                  <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {rows.map(r => {
                      const m = markOf(r.person.id);
                      const off = m !== 'present';
                      return (
                        <button
                          key={r.person.id}
                          onClick={() => toggleExcept(r.person.id)}
                          aria-pressed={off}
                          aria-label={`${r.person.name} — ${off ? 'marked not present' : 'marked present'}`}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 4px',
                            borderRadius: 999, cursor: 'pointer', fontSize: 'var(--text-sm)',
                            border: `1px solid ${off ? 'var(--danger)' : 'var(--border-strong)'}`,
                            background: off ? 'var(--danger-weak)' : 'var(--surface)',
                            color: off ? 'var(--danger)' : 'var(--text)',
                          }}
                        >
                          <Avatar name={r.person.name} size="sm" />
                          <span style={{ fontWeight: off ? 620 : 480 }}>{r.person.name.split(' ')[0]}</span>
                          {off && <Icon.X size={12} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {qrOpen && (
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-2)' }}>
                  <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
                    Day codes — {section ? `${section.grade} · ${section.name}` : ''} (single-day, print the sheet or read from the pupil portal)
                  </div>
                  {qrCodes == null ? <div className="u-small u-muted">Loading codes…</div>
                    : qrCodes.length === 0 ? <div className="u-small u-muted">No pupils on this roster.</div>
                    : (
                      <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                        {qrCodes.map(c => (
                          <span key={c.studentId} className="u-small" style={{ border: '1px solid var(--border-strong)', borderRadius: 8, padding: '3px 8px' }}>
                            {c.name.split(' ')[0]} <span className="mono" style={{ fontWeight: 700 }}>{c.code}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  <div className="u-flex" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <label className="u-small" style={{ flex: 1, minWidth: 220 }}>Scanned / typed codes
                      <input className="input mono" value={qrPaste} onChange={e => setQrPaste(e.target.value)}
                        placeholder="paste codes separated by spaces" style={{ display: 'block', marginTop: 4, width: '100%' }} />
                    </label>
                    <Button size="sm" variant="primary" onClick={markQr}>Mark present</Button>
                  </div>
                </div>
              )}

              <div className="scroll-thin" style={{ maxHeight: 540, overflowY: 'auto' }}>
                {rows.map((r, i) => {
                  const m = markOf(r.person.id);
                  const busAffected = !serverMode && r.person.busRoute === 'Route 7 — Sector 12';
                  return (
                    <div key={r.person.id} className="u-between u-wrap" style={{ padding: '9px 16px', borderBottom: '1px solid var(--border-subtle)', gap: 8 }}>
                      <div className="u-flex" style={{ gap: 10, minWidth: 220 }}>
                        <span className="u-faint mono u-xs" style={{ width: 20, textAlign: 'right', flexShrink: 0 }}>{r.person.rollNo ?? i + 1}</span>
                        <Avatar name={r.person.name} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <div className="u-truncate" style={{ fontWeight: 540 }}>{r.person.name}</div>
                          <div className="u-xs u-faint u-truncate">
                            {busAffected && <span style={{ color: 'var(--warning)', fontWeight: 600 }}>Bus 14 rider · </span>}
                            {r.note ? `note: ${r.note}` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="seg-tabs" role="group" aria-label={`Mark ${r.person.name}`}>
                        {MARKS.map(mk => (
                          <button key={mk} className={`seg-tab ${m === mk ? 'on' : ''}`} aria-pressed={m === mk} onClick={() => setMark(r.person.id, mk)}>
                            {cap(mk)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="u-between u-wrap" style={{ padding: '10px 16px', background: 'var(--surface-2)', borderRadius: '0 0 var(--r-lg) var(--r-lg)', gap: 8 }}>
                <div className="u-flex u-wrap" style={{ gap: 6 }}>
                  <Badge tone="success" dot>{summary.present} present</Badge>
                  <Badge tone="danger" dot>{summary.absent} absent</Badge>
                  <Badge tone="warning" dot>{summary.late} late</Badge>
                  <Badge tone="info" dot>{summary.excused} excused</Badge>
                </div>
                <span className="u-xs u-faint">Submit saves to school records · guardians of absentees are queued a notice (Attendance §1.1)</span>
              </div>
            </Card>
          </div>
        )
      )}

      {/* ================= History ================= */}
      {tab === 'history' && (
        <Section role="tabpanel" id="att-tab-panel-history" aria-labelledby="att-tab-tab-history"
          title={serverMode ? 'Register history — last 7 days' : '30-day register history'}
          sub={serverMode
            ? `${sectionLabel} · built from submitted registers`
            : `${sectionLabel} · ${campusShort(section?.campus ?? 'north')} · Sundays off · anomalies flagged below 80%`}
        >
          <Card>
            {history.loading ? (
              <div style={{ padding: 20 }}><Skeleton h={120} /></div>
            ) : historyRows.length === 0 ? (
              <div style={{ padding: 20 }}>
                <Empty
                  title="No register history yet"
                  sub={serverMode
                    ? 'History builds as registers are submitted. Submit today\'s register and it will appear here.'
                    : 'The demo blob has no register rows for this section.'}
                />
              </div>
            ) : (
              <>
                <div style={{ padding: '16px 20px 8px' }}>
                  <LineChart
                    series={[{ name: 'Presence %', color: 'var(--accent)', points: historyRows.map(h => h.pct) }]}
                    labels={chartLabels}
                    yFormat={v => `${Math.round(v)}%`}
                    min={0}
                    max={100}
                    height={170}
                    area
                  />
                  {!serverMode && sectionId === 'north-g8-b' && (
                    <div className="u-xs u-faint" style={{ marginTop: 4 }}>
                      The collapse over the last 5 school days tracks the Bus 14 (Route 7) breakdown — see the anomaly banner on Today.
                    </div>
                  )}
                </div>
                <div style={{ padding: '8px 20px 20px' }}>
                  <DataTable
                    rows={historyDesc}
                    rowKey={h => h.date.toISOString()}
                    columns={[
                      { key: 'date', label: 'Date', render: h => <span className="tnum">{weekday(h.date)}, {fmtDateShort(h.date)}</span> },
                      {
                        key: 'pct', label: 'Presence',
                        render: h => (
                          <span className="tnum" style={{ fontWeight: h.pct < 80 ? 650 : 480, color: h.pct < 80 ? 'var(--danger)' : undefined }}>{h.pct}%</span>
                        ),
                      },
                      {
                        key: 'counts', label: 'Absent / late',
                        render: h => <span className="tnum u-small">{h.absent} / {h.late}</span>,
                      },
                      {
                        key: 'names', label: 'Absentees',
                        render: h => h.names.length === 0
                          ? <span className="u-faint">—</span>
                          : <span className="u-small">{h.names.slice(0, 3).map(n => n.split(' ')[0]).join(', ')}{h.names.length > 3 ? ` +${h.names.length - 3}` : ''}</span>,
                      },
                      { key: 'markedBy', label: 'Marked by', render: h => <span className="u-small u-muted">{h.markedBy}</span> },
                      { key: 'flag', label: '', render: (h: HistoryRow) => h.error ? <Badge tone="warning">offline</Badge> : h.pct < 80 ? <Badge tone="danger">Anomaly</Badge> : null },
                    ]}
                  />
                </div>
              </>
            )}
          </Card>
        </Section>
      )}
    </>
  );
}
