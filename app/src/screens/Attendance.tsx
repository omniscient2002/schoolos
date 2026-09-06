/* ============================================================
   Attendance — the mark sheet + 30-day register.
   Teacher-owned marking; SchoolOS handles notifications,
   leniency and the follow-up workflow (wf_1).
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as seed from '../data/dataset';
import { attendanceService, peopleService } from '../services';
import { useStore } from '../state/store';
import {
  Avatar, Badge, Button, Card, DataTable, Empty, ErrorState, PageHead, Section, Skeleton, Stat, Tabs, useToast,
} from '../components/ui';
import { LineChart } from '../components/Chart';
import { Icon } from '../components/Icon';
import { fmtDate, fmtDateShort, fmtMoneyShort, fmtRelative, weekday } from '../lib/format';
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

interface RosterRow {
  person: Person;
  rate: number;
  prefill: Mark | null;
  note?: string;
  feeLabel: string;
  feeTone: 'success' | 'warning' | 'danger' | 'info';
}

interface RegisterData {
  rows: RosterRow[];
  markedToday: boolean;
  lastMarkAt: Date | null;
  markedBy: string;
}

export default function Attendance() {
  const navigate = useNavigate();
  const { session, actorName, dispatch } = useStore();
  const toast = useToast();

  const isTeacher = session.roleId === 'teacher';
  const today = seed.TERM_DAYS[seed.TERM_DAYS.length - 1];

  /* ---- section picker: campus-scoped, role-aware default ---- */
  const sections = useMemo(() => {
    /* session.activeCampus is a CampusId; campusScope==='all' roles still get a
       concrete campus here — use the campus filter, not a synthetic 'all'. */
    const campus: string = session.activeCampus;
    const list = seed.sections.filter(s => s.campus === campus);
    return [...list].sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name) || a.campus.localeCompare(b.campus));
  }, [session.activeCampus]);

  const initialSectionId = () => {
    if (isTeacher) {
      const me = seed.teachers.find(t => t.name === actorName);
      const cls = me?.classes?.[0];
      if (cls) {
        const [g, s] = cls.split('-');
        const found = sections.find(x => String(x.grade) === g && x.name === s);
        if (found) return found.id;
      }
    }
    return sections.some(x => x.id === 'north-g8-b') ? 'north-g8-b' : sections[0]?.id ?? 'north-g8-b';
  };
  const [sectionId, setSectionId] = useState(initialSectionId);
  const [tab, setTab] = useState<'mark' | 'history'>('mark');

  /* if the campus switcher makes the current section invisible, fall back */
  useEffect(() => {
    if (!sections.some(s => s.id === sectionId) && sections[0]) setSectionId(sections[0].id);
  }, [sections, sectionId]);

  const section = seed.sections.find(s => s.id === sectionId);
  const sectionLabel = section ? `Grade ${section.grade}-${section.name}` : sectionId;
  const classTeacher = section ? seed.findPerson(section.classTeacherId) : undefined;
  const isAnomaly = sectionId === 'north-g8-b';

  /* ---- async register load (seed access behind a Promise) ---- */
  const register = useAsync<RegisterData>(async () => {
    const roster = seed.studentsOfSection(sectionId);
    const todayRecs = seed.attendance.filter(a => a.sectionId === sectionId && a.date.getTime() === today.getTime());
    const rows = await Promise.all(roster.map(async st => {
      const [att, fees] = await Promise.all([peopleService.attendance(st.id), peopleService.feeSummary(st.id)]);
      const rec = todayRecs.find(r => r.studentId === st.id);
      return {
        person: st,
        rate: att.rate,
        prefill: rec ? (rec.status as Mark) : null,
        note: rec?.note,
        feeLabel: fees.hasFailed ? 'fee failed' : fees.overdue > 0 ? `${fmtMoneyShort(fees.overdue)} overdue` : fees.due > 0 ? `${fmtMoneyShort(fees.due)} due` : 'fees clear',
        feeTone: fees.hasFailed ? 'danger' as const : fees.overdue > 0 ? 'warning' as const : fees.due > 0 ? 'info' as const : 'success' as const,
      } satisfies RosterRow;
    }));
    const markedBy = todayRecs[0]
      ? seed.findPerson(todayRecs[0].markedBy)?.name ?? classTeacher?.name ?? 'Class teacher'
      : classTeacher?.name ?? 'Class teacher';
    return { rows, markedToday: todayRecs.length > 0, lastMarkAt: todayRecs[0]?.date ?? null, markedBy };
  }, [sectionId]);

  const rows = useMemo(() => register.data?.rows ?? [], [register.data]);
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
      await attendanceService.mark(sectionId, entries);
      setSubmitted(true);
      const absentCount = summary.absent;
      dispatch({
        type: 'event/add',
        e: {
          id: `ev_${Date.now()}`, on: new Date(), type: 'attendance',
          label: `Register submitted — ${sectionLabel} · ${absentCount} absent`,
          severity: absentCount > 4 ? 'warn' : 'info',
        },
      });
      dispatch({
        type: 'audit/add',
        entry: {
          actor: actorName, actorRole: session.roleId, action: 'Submitted attendance register',
          recordType: 'Attendance', recordRef: `${sectionLabel} · ${rows.length} students`,
          reason: 'First-period mark', policyRef: 'Attendance §1.1', aiInvolved: false, risk: 'low',
          outcome: `Register submitted · ${absentCount} guardians queued for notification (workflow wf_1)`,
        },
      });
      toast({
        title: 'Register submitted',
        sub: absentCount
          ? `${absentCount} ${absentCount === 1 ? 'guardian' : 'guardians'} will be notified (Attendance §1.1)${summary.excused ? ` · ${summary.excused} excused, no notification` : ''}`
          : 'Full attendance — no notifications needed',
        tone: 'success',
      });
    } catch {
      toast({ title: 'Could not submit', sub: 'The register is kept on this device — retry when you are back online.', tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  /* ---- 30-day history for this section ---- */
  const history = useMemo(() => {
    const total = rows.length;
    return seed.TERM_DAYS.map(d => {
      const t = d.getTime();
      const recs = seed.attendance.filter(a => a.sectionId === sectionId && a.date.getTime() === t);
      const absent = recs.filter(r => r.status === 'absent').length;
      const late = recs.filter(r => r.status === 'late').length;
      const names = recs.filter(r => r.status === 'absent').map(r => seed.findPerson(r.studentId)?.name ?? 'Unknown');
      return {
        date: d,
        absent,
        late,
        pct: total ? Math.round(((total - absent) / total) * 100) : 0,
        names,
        markedBy: recs[0] ? seed.findPerson(recs[0].markedBy)?.name ?? '—' : '—',
      };
    });
  }, [sectionId, rows.length]);

  const historyDesc = useMemo(() => [...history].reverse(), [history]);
  const chartLabels = history.map(h => fmtDateShort(h.date).replace(/\s\S+$/, ''));

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
          ? 'Mark the register in seconds. Guardians are notified automatically for absences.'
          : 'First-period registers across your scope. Marking is teacher-owned; SchoolOS handles the follow-ups.'}
        actions={
          <Badge tone={register.data?.markedToday ? 'success' : 'warning'} dot>
            {register.data?.markedToday
              ? `Marked today · ${register.data.lastMarkAt ? fmtRelative(register.data.lastMarkAt) : 'just now'}`
              : 'Not marked today'}
          </Badge>
        }
      />

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
                {`Grade ${s.grade}-${s.name} · ${campusShort(s.campus)} · ${seed.studentsOfSection(s.id).length} students`}
              </option>
            ))}
          </select>
        </label>
        <span className="u-small u-faint">
          Room {section?.room ?? '—'} · Class teacher {classTeacher?.name ?? '—'}
        </span>
      </div>

      {/* ---- Bus 14 anomaly banner (8-B only) ---- */}
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
        tabs={[{ id: 'mark', label: 'Today — mark' }, { id: 'history', label: 'History — 30 days' }]}
      />

      {/* ================= Today — mark ================= */}
      {tab === 'mark' && (
        rows.length === 0 ? (
          <div role="tabpanel" id="att-tab-panel-mark" aria-labelledby="att-tab-tab-mark" style={{ marginTop: 16 }}>
            <Empty
              icon={<Icon.People size={26} />}
              title="No students in this section"
              sub={`${sectionLabel} has no enrolled students. Choose another section from the picker above.`}
              action={<Button variant="secondary" onClick={() => navigate('/people')}>Open Directory</Button>}
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
                </div>
                <div className="u-flex" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="u-xs u-faint">{weekday(today)}, {fmtDate(today)} · marked by {register.data?.markedBy}</span>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={saving}
                    disabled={submitted && !dirty}
                    icon={<Icon.Clipboard size={13} />}
                    onClick={submit}
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

              <div className="scroll-thin" style={{ maxHeight: 540, overflowY: 'auto' }}>
                {rows.map((r, i) => {
                  const m = markOf(r.person.id);
                  const busAffected = r.person.busRoute === 'Route 7 — Sector 12';
                  return (
                    <div key={r.person.id} className="u-between u-wrap" style={{ padding: '9px 16px', borderBottom: '1px solid var(--border-subtle)', gap: 8 }}>
                      <div className="u-flex" style={{ gap: 10, minWidth: 220 }}>
                        <span className="u-faint mono u-xs" style={{ width: 20, textAlign: 'right', flexShrink: 0 }}>{r.person.rollNo ?? i + 1}</span>
                        <Avatar name={r.person.name} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <div className="u-truncate" style={{ fontWeight: 540 }}>{r.person.name}</div>
                          <div className="u-xs u-faint u-truncate">
                            <span className="tnum">{r.rate}%</span> term · <span style={{ color: r.feeTone === 'success' ? undefined : r.feeTone === 'danger' ? 'var(--danger)' : r.feeTone === 'warning' ? 'var(--warning)' : undefined }}>{r.feeLabel}</span>
                            {busAffected && <span style={{ color: 'var(--warning)', fontWeight: 600 }}> · Bus 14 rider</span>}
                            {r.note ? ` · note: ${r.note}` : ''}
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
                <span className="u-xs u-faint">Submit → guardians of absentees notified automatically · workflow wf_1</span>
              </div>
            </Card>
          </div>
        )
      )}

      {/* ================= History — 30 days ================= */}
      {tab === 'history' && (
        <Section role="tabpanel" id="att-tab-panel-history" aria-labelledby="att-tab-tab-history"
          title="30-day register history"
          sub={`${sectionLabel} · ${campusShort(section?.campus ?? 'north')} · Sundays off · anomalies flagged below 80%`}
        >
          <Card>
            <div style={{ padding: '16px 20px 8px' }}>
              <LineChart
                series={[{ name: 'Presence %', color: 'var(--accent)', points: history.map(h => h.pct) }]}
                labels={chartLabels}
                yFormat={v => `${Math.round(v)}%`}
                min={0}
                max={100}
                height={170}
                area
              />
              {isAnomaly && (
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
                  { key: 'flag', label: '', render: h => h.pct < 80 ? <Badge tone="danger">Anomaly</Badge> : null },
                ]}
              />
            </div>
          </Card>
        </Section>
      )}
    </>
  );
}
