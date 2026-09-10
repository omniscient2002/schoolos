/* ============================================================
   Learning — assignments, assessments, mastery, timetable.
   Demo teaching datasets are generated locally with a fixed
   seed (3131) so every load is identical; the timetable and
   sections come from the shared seed.
   ============================================================ */
import { Fragment, useEffect, useMemo, useState } from 'react';
import * as seed from '../data/dataset';
import { makeRng } from '../lib/rng';
import { useStore } from '../state/store';
import {
  Badge, Button, Card, DataTable, Drawer, Empty, ErrorState, KeyValue, Modal, PageHead, Progress, SkeletonCard, Stat, Tabs, useToast,
} from '../components/ui';
import { BarChart, Sparkline } from '../components/Chart';
import { Icon } from '../components/Icon';
import { clamp, fmtDate, fmtDateShort } from '../lib/format';
import type { Assignment, Assessment, MasterySkill, TimeSlot } from '../types/domain';

/* ---------- local deterministic datasets (seed 3131 per contract) ---------- */
const lrng = makeRng(3131);

const ASSIGNMENT_TITLES = [
  'Unit Test 2 — Fractions',
  'Worksheet: Tenses',
  'Lab Report — Acids & Bases',
  'Project: Local Governance',
  'Reading Log — Week 6',
  'Practice Sheet — Linear Equations',
  'Map Work — Rivers of India',
  'Essay: My Neighbourhood',
];
const TITLE_SUBJECT: Record<string, string> = {
  'Unit Test 2 — Fractions': 'Mathematics',
  'Worksheet: Tenses': 'English',
  'Lab Report — Acids & Bases': 'Science',
  'Project: Local Governance': 'Social Studies',
  'Reading Log — Week 6': 'English',
  'Practice Sheet — Linear Equations': 'Mathematics',
  'Map Work — Rivers of India': 'Social Studies',
  'Essay: My Neighbourhood': 'English',
};

const ASSESSMENT_DEFS: { title: string; subject: string }[] = [
  { title: 'Unit Test 2 — Fractions', subject: 'Mathematics' },
  { title: 'Cycle Test — Tenses', subject: 'English' },
  { title: 'Lab Assessment — Acids & Bases', subject: 'Science' },
  { title: 'Map Quiz — Rivers of India', subject: 'Social Studies' },
  { title: 'Unit Test 2 — Linear Equations', subject: 'Mathematics' },
  { title: 'Reading Fluency Check', subject: 'English' },
  { title: 'Chapter Test — Photosynthesis', subject: 'Science' },
  { title: 'Objective Quiz — Data Handling', subject: 'Mathematics' },
];

const SKILL_DEFS: { skill: string; subject: string; grade: number }[] = [
  { skill: 'Fractions — equivalence', subject: 'Mathematics', grade: 8 },
  { skill: 'Fractions — operations', subject: 'Mathematics', grade: 7 },
  { skill: 'Linear equations', subject: 'Mathematics', grade: 9 },
  { skill: 'Data handling', subject: 'Mathematics', grade: 6 },
  { skill: 'Tenses', subject: 'English', grade: 8 },
  { skill: 'Reading comprehension', subject: 'English', grade: 7 },
  { skill: 'Acids & bases', subject: 'Science', grade: 9 },
  { skill: 'Photosynthesis', subject: 'Science', grade: 7 },
  { skill: 'Map skills', subject: 'Social Studies', grade: 8 },
  { skill: 'Public administration', subject: 'Social Studies', grade: 10 },
];

type MasteryRow = MasterySkill & { sectionId: string };

function buildAssignments(): Assignment[] {
  const out: Assignment[] = [];
  for (let i = 0; i < 24; i++) {
    const title = ASSIGNMENT_TITLES[i % ASSIGNMENT_TITLES.length];
    const section = lrng.pick(seed.sections);
    const dueOffset = i < 5 ? lrng.int(-5, -1) : lrng.int(0, 9);
    const dueOn = lrng.date(dueOffset, 17, 0);
    const assignedOn = lrng.date(dueOffset - lrng.int(4, 10), 9, 30);
    const total = Math.max(10, seed.studentsOfSection(section.id).length);
    const submissions = Math.min(total, Math.round(total * lrng.float(0.35, 1)));
    out.push({
      id: `asg_${i + 1}`,
      title,
      subject: TITLE_SUBJECT[title] ?? 'General',
      sectionId: section.id,
      assignedOn,
      dueOn,
      status: dueOffset <= -3 ? 'closed' : 'published',
      submissions,
      strength: lrng.int(52, 96),
      teacherId: section.classTeacherId,
    });
  }
  return out.sort((a, b) => a.dueOn.getTime() - b.dueOn.getTime());
}

function buildAssessments(): Assessment[] {
  return ASSESSMENT_DEFS.map((def, i) => {
    const grade = lrng.pick([6, 7, 8, 9, 10]);
    const total = lrng.pick([26, 52, 74, 78]);
    const avg = lrng.int(52, 86);
    return {
      id: `asm_${i + 1}`,
      title: def.title,
      subject: def.subject,
      grade,
      on: lrng.date(lrng.int(-12, 2), 10, 30),
      avgScore: avg,
      topScore: Math.min(99, avg + lrng.int(6, 16)),
      submitted: total - lrng.int(0, 6),
      total,
    };
  });
}

function buildMastery(): MasteryRow[] {
  return SKILL_DEFS.map((def, i) => {
    const pct = lrng.int(38, 92);
    const level: MasterySkill['level'] = pct >= 75 ? 'secure' : pct >= 50 ? 'developing' : 'beginning';
    const start = clamp(pct - lrng.int(6, 18), 15, 95);
    const trend = Array.from({ length: 6 }, (_, k) => Math.round(start + ((pct - start) * k) / 5 + (k === 5 ? 0 : lrng.float(-4, 4))));
    const section = lrng.pick(seed.sections.filter(s => s.grade === def.grade)) ?? seed.sections[i % seed.sections.length];
    return { skill: def.skill, subject: def.subject, level, pct, trend, sectionId: section.id };
  });
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const campusShort = (id: string) => seed.campuses.find(c => c.id === id)?.shortName ?? id;
const sectionLabel = (sectionId: string) => {
  const s = seed.sections.find(x => x.id === sectionId);
  return s ? `${s.grade}-${s.name} · ${campusShort(s.campus)}` : sectionId;
};

const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
function dueBucket(due: Date): 'overdue' | 'due-soon' | 'upcoming' {
  const d = new Date(due); d.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - todayStart.getTime()) / 86400000);
  return diff < 0 ? 'overdue' : diff <= 2 ? 'due-soon' : 'upcoming';
}
function DueBadge({ a }: { a: Assignment }) {
  if (a.status === 'closed') return <Badge tone="neutral">Closed</Badge>;
  const b = dueBucket(a.dueOn);
  if (b === 'overdue') return <Badge tone="danger" dot>Overdue</Badge>;
  if (b === 'due-soon') return <Badge tone="warning" dot>Due soon</Badge>;
  return <Badge tone="outline">Assigned</Badge>;
}

const isoInDays = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

interface LoadData { a: Assignment[]; s: Assessment[]; m: MasteryRow[] }

export default function Learning() {
  const { session, actorName } = useStore();
  const toast = useToast();

  const me = session.roleId === 'teacher' ? seed.teachers.find(t => t.name === actorName) : undefined;
  const scope = session.campusScope;

  const [tab, setTab] = useState('assignments');
  const [load, setLoad] = useState<{ data: LoadData | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);

  /* simulated fetch over the local generator — keeps the loading/error contract */
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      if (!live) return;
      try {
        setLoad({ data: { a: buildAssignments(), s: buildAssessments(), m: buildMastery() }, loading: false, error: null });
      } catch (e) {
        setLoad({ data: null, loading: false, error: String(e) });
      }
    }, 260);
    return () => { live = false; clearTimeout(t); };
  }, [tick]);

  const refresh = () => {
    setLoad({ data: null, loading: true, error: null });
    setTick(t => t + 1);
  };

  const [extra, setExtra] = useState<Assignment[]>([]);
  const [closedIds, setClosedIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState('all');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [asgOpen, setAsgOpen] = useState<Assignment | null>(null);
  const [asmOpen, setAsmOpen] = useState<Assessment | null>(null);
  const [skillOpen, setSkillOpen] = useState<MasteryRow | null>(null);
  const [slotOpen, setSlotOpen] = useState<TimeSlot | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ title: '', sectionId: 'north-g8-b', subject: 'Mathematics', due: isoInDays(3) });

  const assignments = useMemo(() => {
    const base = [...extra, ...(load.data?.a ?? [])].filter(a => scope === 'all' || seed.sections.find(s => s.id === a.sectionId)?.campus === scope);
    return base.map(a => (closedIds.has(a.id) ? { ...a, status: 'closed' as const } : a)).sort((x, y) => x.dueOn.getTime() - y.dueOn.getTime());
  }, [extra, load.data, closedIds, scope]);

  const assessments = useMemo(() => load.data?.s ?? [], [load.data]);
  const mastery = useMemo(() => load.data?.m ?? [], [load.data]);

  const scopeSections = useMemo(
    () => seed.sections.filter(s => scope === 'all' || s.campus === scope).sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name) || a.campus.localeCompare(b.campus)),
    [scope],
  );

  const statusTabs = [
    { id: 'all', label: 'All', count: assignments.length },
    { id: 'overdue', label: 'Overdue', count: assignments.filter(a => a.status !== 'closed' && dueBucket(a.dueOn) === 'overdue').length },
    { id: 'due-soon', label: 'Due soon', count: assignments.filter(a => dueBucket(a.dueOn) === 'due-soon').length },
    { id: 'upcoming', label: 'Assigned', count: assignments.filter(a => a.status !== 'closed' && dueBucket(a.dueOn) === 'upcoming').length },
  ];

  const filteredAssignments = useMemo(() => {
    if (statusFilter === 'all') return assignments;
    if (statusFilter === 'overdue') return assignments.filter(a => a.status !== 'closed' && dueBucket(a.dueOn) === 'overdue');
    if (statusFilter === 'due-soon') return assignments.filter(a => dueBucket(a.dueOn) === 'due-soon');
    return assignments.filter(a => a.status !== 'closed' && dueBucket(a.dueOn) === 'upcoming');
  }, [assignments, statusFilter]);

  const masterySubjects = useMemo(() => [...new Set(mastery.map(m => m.subject))].sort(), [mastery]);
  const filteredMastery = useMemo(
    () => (subjectFilter === 'all' ? mastery : mastery.filter(m => m.subject === subjectFilter)),
    [mastery, subjectFilter],
  );

  const bySubject = useMemo(() => {
    const m = new Map<string, number[]>();
    assessments.forEach(a => m.set(a.subject, [...(m.get(a.subject) ?? []), a.avgScore]));
    return [...m.entries()].map(([label, arr]) => ({ label, value: Math.round(arr.reduce((x, y) => x + y, 0) / arr.length) }));
  }, [assessments]);

  const masteryAvg = mastery.length ? Math.round(mastery.reduce((a, m) => a + m.pct, 0) / mastery.length) : 0;
  const assessAvg = assessments.length ? Math.round(assessments.reduce((a, x) => a + x.avgScore, 0) / assessments.length) : 0;
  const dueSoonCount = assignments.filter(a => dueBucket(a.dueOn) === 'due-soon' && a.status !== 'closed').length;
  const sectionsTaught = me ? seed.timetable.filter(t => t.teacherId === me.id).length : scopeSections.length;

  const defaultSectionId = () => {
    if (me?.classes?.length) {
      const [g, s] = me.classes[0].split('-');
      const sec = seed.sections.find(x => x.campus === me.campus && String(x.grade) === g && x.name === s);
      if (sec) return sec.id;
    }
    return 'north-g8-b';
  };
  const [sectionId, setSectionId] = useState(defaultSectionId);
  const slots = useMemo(() => seed.timetable.filter(t => t.sectionId === sectionId), [sectionId]);
  const slotAt = (day: number, period: number) => slots.find(s => s.day === day && s.period === period);
  const teacherName = (tid: string) => seed.findPerson(tid)?.name ?? '—';
  const todayDow = new Date().getDay(); // 0 = Sunday

  const publishAssignment = () => {
    const title = newForm.title.trim();
    if (!title) return;
    const sec = seed.sections.find(s => s.id === newForm.sectionId);
    const dueParts = newForm.due.split('-').map(Number);
    const dueOn = new Date(dueParts[0] ?? 2026, (dueParts[1] ?? 1) - 1, dueParts[2] ?? 1, 17, 0);
    const total = Math.max(10, seed.studentsOfSection(newForm.sectionId).length);
    setExtra(x => [{
      id: `asg_new_${Date.now()}`,
      title,
      subject: newForm.subject,
      sectionId: newForm.sectionId,
      assignedOn: new Date(),
      dueOn,
      status: 'published',
      submissions: 0,
      strength: 0,
      teacherId: me?.id ?? sec?.classTeacherId ?? '',
    }, ...x]);
    setNewOpen(false);
    setNewForm(f => ({ ...f, title: '' }));
    /* T305 (§9.5): this list is device-local demo state — the assignment is
       not published to any student or guardian. */
    toast({ title: 'Saved on this device only', sub: `“${title}” was added to this view for ${total} students — it is not published to the parent app or school records.`, tone: 'info' });
  };

  const closeAssignment = (a: Assignment) => {
    setClosedIds(prev => new Set(prev).add(a.id));
    setAsgOpen(null);
    /* T305 (§9.5): no submission door is touched from here — closing is a
       local note on this device. */
    toast({ title: 'Closed on this device only', sub: `${a.title} marked closed in this view — submissions are not locked in school records.`, tone: 'info' });
  };

  /* ---------- loading / error shells ---------- */
  if (load.loading) {
    return (
      <>
        <PageHead title="Learning" sub="Assignments, assessments, mastery and timetable for your scope." />
        <div className="grid grid-4" style={{ marginBottom: 20 }}>
          {[0, 1, 2, 3].map(i => <SkeletonCard key={i} lines={2} />)}
        </div>
        <div className="grid grid-2">
          <SkeletonCard lines={6} />
          <SkeletonCard lines={6} />
        </div>
      </>
    );
  }
  if (load.error || !load.data) {
    return (
      <>
        <PageHead title="Learning" sub="Assignments, assessments, mastery and timetable for your scope." />
        <ErrorState title="Could not load the teaching workspace" sub="The academic datasets did not respond. Nothing was changed — try again." onRetry={refresh} />
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Learning"
        sub={me
          ? `Your sections and subjects · ${campusShort(me.campus)} Campus — assignments, assessments, mastery, timetable.`
          : `Assignments, assessments and mastery across ${scope === 'all' ? 'all campuses' : campusShort(scope)}.`}
        actions={<Button variant="primary" icon={<Icon.Plus size={14} />} onClick={() => setNewOpen(true)}>New assignment</Button>}
      />

      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <Stat label={me ? 'Periods this week' : 'Sections in scope'} value={sectionsTaught} sub={me ? 'From the weekly timetable' : `${scopeSections.length} sections · ${scope === 'all' ? '3 campuses' : campusShort(scope)}`} onClick={() => setTab('timetable')} />
        <Stat label="Avg mastery" value={`${masteryAvg}%`} sub="Across tracked skills" delta={{ value: 'secure-weighted', dir: 'flat' }} onClick={() => setTab('mastery')} />
        <Stat label="Due in 48h" value={dueSoonCount} sub={`${assignments.filter(a => a.status !== 'closed' && dueBucket(a.dueOn) === 'overdue').length} overdue assignments`} onClick={() => setTab('assignments')} />
        <Stat label="Assessment average" value={`${assessAvg}%`} sub={`${assessments.length} assessments this term`} onClick={() => setTab('assessments')} />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        panelId="learn-tab"
        tabs={[
          { id: 'assignments', label: 'Assignments', count: assignments.length },
          { id: 'assessments', label: 'Assessments', count: assessments.length },
          { id: 'mastery', label: 'Mastery', count: mastery.length },
          { id: 'timetable', label: 'Timetable' },
        ]}
      />

      {/* ---------------- Assignments ---------------- */}
      {tab === 'assignments' && (
        <div role="tabpanel" id="learn-tab-panel-assignments" aria-labelledby="learn-tab-tab-assignments" style={{ marginTop: 16 }}>
          <div className="u-between u-wrap" style={{ gap: 10, marginBottom: 12 }}>
            <Tabs pill tabs={statusTabs} active={statusFilter} onChange={setStatusFilter} />
            <span className="u-small u-faint">Due dates span the last 5 to next 9 days</span>
          </div>
          {filteredAssignments.length === 0 ? (
            <Empty
              icon={<Icon.Book size={24} />}
              title="No assignments in this view"
              sub="Nothing matches the current status filter. Published work lands here the moment a teacher assigns it."
              action={<Button variant="secondary" onClick={() => setStatusFilter('all')}>Show all assignments</Button>}
            />
          ) : (
            <Card pad={false}>
              <DataTable<Assignment>
                rows={filteredAssignments}
                rowKey={a => a.id}
                onRowClick={a => setAsgOpen(a)}
                columns={[
                  {
                    key: 'title', label: 'Assignment',
                    render: a => (
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 570 }}>{a.title}</div>
                        <div className="u-xs u-faint">{sectionLabel(a.sectionId)} · {teacherName(a.teacherId)}</div>
                      </div>
                    ),
                  },
                  { key: 'subject', label: 'Subject', render: a => a.subject },
                  {
                    key: 'due', label: 'Due',
                    render: a => (
                      <div className="u-col" style={{ gap: 4, alignItems: 'flex-start' }}>
                        <DueBadge a={a} />
                        <span className="u-xs u-faint tnum">{fmtDateShort(a.dueOn)}</span>
                      </div>
                    ),
                  },
                  {
                    key: 'subs', label: 'Submissions', width: 170,
                    render: a => {
                      const total = Math.max(10, seed.studentsOfSection(a.sectionId).length);
                      return (
                        <div className="u-col" style={{ gap: 4 }}>
                          <span className="tnum u-small">{a.submissions}/{total} turned in</span>
                          <Progress value={(a.submissions / total) * 100} tone={a.submissions / total < 0.5 ? 'warn' : undefined} />
                        </div>
                      );
                    },
                  },
                  { key: 'strength', label: 'Strength', align: 'right', render: a => a.status === 'closed' || a.submissions > 0 ? <span className="tnum">{a.strength}%</span> : <span className="u-faint">—</span> },
                ]}
              />
            </Card>
          )}
        </div>
      )}

      {/* ---------------- Assessments ---------------- */}
      {tab === 'assessments' && (
        <div role="tabpanel" id="learn-tab-panel-assessments" aria-labelledby="learn-tab-tab-assessments" className="grid grid-2" style={{ marginTop: 16, alignItems: 'start' }}>
          <Card pad={false}>
            <div className="card-head"><h3>Recent assessments</h3><span className="u-small u-faint">Term 2</span></div>
            <DataTable<Assessment>
              rows={assessments}
              rowKey={a => a.id}
              onRowClick={a => setAsmOpen(a)}
              columns={[
                {
                  key: 'title', label: 'Assessment',
                  render: a => (
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 570 }}>{a.title}</div>
                      <div className="u-xs u-faint">Grade {a.grade} · {fmtDateShort(a.on)}</div>
                    </div>
                  ),
                },
                { key: 'avg', label: 'Avg', align: 'right', render: a => <span className="tnum">{a.avgScore}%</span> },
                { key: 'top', label: 'Top', align: 'right', render: a => <span className="tnum u-muted">{a.topScore}%</span> },
                {
                  key: 'subs', label: 'Submitted',
                  render: a => <span className="tnum u-small">{a.submitted}/{a.total}</span>,
                },
              ]}
            />
          </Card>
          <Card head="Average score by subject">
            <div className="u-small u-muted" style={{ marginBottom: 10 }}>Mean of assessment averages this term</div>
            <BarChart data={bySubject} format={v => `${v}%`} height={200} />
            <div className="u-xs u-faint" style={{ marginTop: 10 }}>
              Marks are entered or approved by teachers; AI may draft feedback only (AI Governance §1.0).
            </div>
          </Card>
        </div>
      )}

      {/* ---------------- Mastery ---------------- */}
      {tab === 'mastery' && (
        <div role="tabpanel" id="learn-tab-panel-mastery" aria-labelledby="learn-tab-tab-mastery" style={{ marginTop: 16 }}>
          <div className="u-between u-wrap" style={{ gap: 10, marginBottom: 12 }}>
            <select className="select" style={{ width: 200 }} value={subjectFilter} onChange={e => setSubjectFilter(e.target.value)} aria-label="Filter mastery by subject">
              <option value="all">All subjects</option>
              {masterySubjects.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="u-small u-faint">Secure ≥ 75% · Developing 50–74% · Beginning &lt; 50%</span>
          </div>
          {filteredMastery.length === 0 ? (
            <Empty icon={<Icon.Award size={24} />} title="No skills tracked for this subject" sub="Mastery rows appear once the subject has at least one graded assessment." />
          ) : (
            <Card pad={false}>
              <DataTable<MasteryRow>
                rows={filteredMastery}
                rowKey={m => m.skill}
                onRowClick={m => setSkillOpen(m)}
                columns={[
                  {
                    key: 'skill', label: 'Skill',
                    render: m => (
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 570 }}>{m.skill}</div>
                        <div className="u-xs u-faint">{m.subject} · {sectionLabel(m.sectionId)}</div>
                      </div>
                    ),
                  },
                  {
                    key: 'level', label: 'Level',
                    render: m => m.level === 'secure' ? <Badge tone="success" dot>Secure</Badge>
                      : m.level === 'developing' ? <Badge tone="warning" dot>Developing</Badge>
                      : <Badge tone="danger" dot>Beginning</Badge>,
                  },
                  {
                    key: 'pct', label: 'Mastery', width: 190,
                    render: m => (
                      <div className="u-col" style={{ gap: 4 }}>
                        <span className="tnum u-small">{m.pct}% of cohort secure</span>
                        <Progress value={m.pct} tone={m.pct >= 75 ? undefined : m.pct >= 50 ? 'warn' : 'danger'} />
                      </div>
                    ),
                  },
                  { key: 'trend', label: 'Trend', render: m => <Sparkline points={m.trend} width={86} height={26} color={m.pct >= 75 ? 'var(--success)' : m.pct >= 50 ? 'var(--warning)' : 'var(--danger)'} /> },
                ]}
              />
            </Card>
          )}
        </div>
      )}

      {/* ---------------- Timetable ---------------- */}
      {tab === 'timetable' && (
        <div role="tabpanel" id="learn-tab-panel-timetable" aria-labelledby="learn-tab-tab-timetable" style={{ marginTop: 16 }}>
          <div className="u-between u-wrap" style={{ gap: 10, marginBottom: 12 }}>
            <select className="select" style={{ width: 240 }} value={sectionId} onChange={e => setSectionId(e.target.value)} aria-label="Choose section">
              {scopeSections.map(s => <option key={s.id} value={s.id}>Grade {s.grade}-{s.name} · {campusShort(s.campus)}</option>)}
            </select>
            <span className="u-small u-faint">6 periods × 6 days{todayDow >= 1 && todayDow <= 6 ? ` · today is ${DAY_LABELS[todayDow - 1]}` : ' · Sunday — no classes'}</span>
          </div>
          <Card pad={false}>
            <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 96 }}>Period</th>
                    {DAY_LABELS.map((d, i) => (
                      <th key={d} style={todayDow === i + 1 ? { color: 'var(--accent-text)', background: 'var(--accent-weak)' } : undefined}>{d}{todayDow === i + 1 ? ' · today' : ''}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5, 6].map(p => (
                    <Fragment key={`p${p}`}>
                      <tr>
                        <th scope="row" style={{ background: 'var(--surface-2)' }}>
                          <div style={{ fontWeight: 600 }}>P{p}</div>
                          <div className="u-xs u-faint tnum">{slotAt(1, p)?.start ?? '—'}–{slotAt(1, p)?.end ?? '—'}</div>
                        </th>
                        {DAY_LABELS.map((_, di) => {
                          const day = di + 1;
                          const slot = slotAt(day, p);
                          if (!slot) return <td key={`${day}-${p}`}><span className="u-faint u-xs">—</span></td>;
                          const isToday = todayDow === day;
                          return (
                            <td key={`${day}-${p}`} style={{ padding: 6, background: isToday ? 'var(--accent-weak)' : undefined }}>
                              <button
                                onClick={() => setSlotOpen(slot)}
                                aria-label={`${slot.subject}, period ${p}, ${DAY_LABELS[di]}, ${slot.start}`}
                                style={{
                                  width: '100%', textAlign: 'left', padding: '7px 9px', borderRadius: 8,
                                  border: '1px solid var(--border)', background: 'var(--surface)', display: 'block', cursor: 'pointer',
                                }}
                              >
                                <div className="u-truncate" style={{ fontWeight: 570, fontSize: 'var(--text-sm)' }}>{slot.subject}</div>
                                <div className="u-xs u-faint u-truncate">{teacherName(slot.teacherId).split(' ').pop()} · {slot.room}</div>
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                      {p === 3 && (
                        <tr>
                          <td colSpan={7} style={{ textAlign: 'center', padding: '5px 14px', background: 'var(--surface-2)', color: 'var(--text-3)', fontSize: 'var(--text-xs)' }}>
                            Break · 10:30 – 10:50
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ---------------- Drawers & modals ---------------- */}
      <Drawer
        open={asgOpen !== null}
        onClose={() => setAsgOpen(null)}
        title={asgOpen?.title ?? ''}
        sub={asgOpen ? `${sectionLabel(asgOpen.sectionId)} · ${asgOpen.subject}` : undefined}
        footer={
          asgOpen ? (
            <>
              <Button variant="ghost" onClick={() => { setAsgOpen(null); }}>Close</Button>
              {asgOpen.status !== 'closed' && <Button variant="danger-ghost" onClick={() => closeAssignment(asgOpen)}>Close assignment</Button>}
              <Button
                variant="secondary"
                icon={<Icon.Message size={13} />}
                onClick={() => toast({
                  title: `Reminder queued to ${Math.max(10, seed.studentsOfSection(asgOpen.sectionId).length) - asgOpen.submissions} non-submitters`,
                  sub: 'Gentle reminder template · Communication §2.1',
                  tone: 'success',
                })}
              >
                Remind non-submitters
              </Button>
              <Button
                variant="ai"
                icon={<Icon.Sparkle size={13} />}
                onClick={() => toast({ title: 'Feedback draft ready for review', sub: 'AI drafts; the teacher approves final comments (AI Governance §1.0).', tone: 'info' })}
              >
                Draft feedback
              </Button>
            </>
          ) : undefined
        }
      >
        {asgOpen && (
          <div className="u-col" style={{ gap: 14 }}>
            <KeyValue
              cols={2}
              items={[
                { k: 'Assigned on', v: fmtDate(asgOpen.assignedOn) },
                { k: 'Due', v: `${fmtDate(asgOpen.dueOn)} · 17:00` },
                { k: 'Status', v: asgOpen.status === 'closed' ? <Badge tone="neutral">Closed</Badge> : <DueBadge a={asgOpen} /> },
                { k: 'Teacher', v: teacherName(asgOpen.teacherId) },
              ]}
            />
            <div>
              <div className="u-between u-xs" style={{ marginBottom: 4 }}>
                <span className="u-upper">Submissions</span>
                <span className="tnum u-faint">{asgOpen.submissions}/{Math.max(10, seed.studentsOfSection(asgOpen.sectionId).length)}</span>
              </div>
              <Progress value={(asgOpen.submissions / Math.max(10, seed.studentsOfSection(asgOpen.sectionId).length)) * 100} />
            </div>
            <div>
              <div className="u-between u-xs" style={{ marginBottom: 4 }}>
                <span className="u-upper">Submission strength</span>
                <span className="tnum u-faint">{asgOpen.strength}%</span>
              </div>
              <Progress value={asgOpen.strength} tone={asgOpen.strength >= 70 ? undefined : 'warn'} />
            </div>
            <div className="u-small u-muted">
              Strength is the teacher's read on how much of the submitted work meets the rubric. It updates as grading progresses.
            </div>
          </div>
        )}
      </Drawer>

      <Drawer
        open={asmOpen !== null}
        onClose={() => setAsmOpen(null)}
        title={asmOpen?.title ?? ''}
        sub={asmOpen ? `Grade ${asmOpen.grade} · ${asmOpen.subject}` : undefined}
        footer={
          asmOpen ? (
            <>
              <Button variant="ghost" onClick={() => setAsmOpen(null)}>Close</Button>
              <Button
                variant="secondary"
                icon={<Icon.Clipboard size={13} />}
                onClick={() => toast({ title: 'Marks entry opened for the subject teacher', sub: 'Final marks are teacher-approved (AI Governance §1.0).', tone: 'info' })}
              >
                Enter marks
              </Button>
              <Button
                variant="secondary"
                icon={<Icon.Send size={13} />}
                onClick={() => toast({
                  title: `Result summaries queued for ${asmOpen.submitted} students`,
                  sub: 'Sent after the teacher approves the result sheet.',
                  tone: 'success',
                })}
              >
                Notify guardians
              </Button>
            </>
          ) : undefined
        }
      >
        {asmOpen && (
          <div className="u-col" style={{ gap: 14 }}>
            <KeyValue
              cols={2}
              items={[
                { k: 'Conducted on', v: fmtDate(asmOpen.on) },
                { k: 'Grade', v: `Grade ${asmOpen.grade}` },
                { k: 'Class average', v: <span className="tnum">{asmOpen.avgScore}%</span> },
                { k: 'Top score', v: <span className="tnum">{asmOpen.topScore}%</span> },
                { k: 'Submitted', v: <span className="tnum">{asmOpen.submitted} of {asmOpen.total}</span> },
                { k: 'Pending', v: <span className="tnum">{asmOpen.total - asmOpen.submitted} to follow up</span> },
              ]}
            />
            <div>
              <div className="u-upper" style={{ marginBottom: 6 }}>Cohort position</div>
              <BarChart
                horizontal
                data={[
                  { label: 'Class average', value: asmOpen.avgScore, color: 'var(--accent)' },
                  { label: 'Top score', value: asmOpen.topScore, color: 'var(--success)' },
                  { label: 'Pass mark (40)', value: 40, color: 'var(--border-strong)' },
                ]}
                format={v => `${v}%`}
              />
            </div>
          </div>
        )}
      </Drawer>

      <Drawer
        open={skillOpen !== null}
        onClose={() => setSkillOpen(null)}
        title={skillOpen?.skill ?? ''}
        sub={skillOpen ? `${skillOpen.subject} · ${sectionLabel(skillOpen.sectionId)}` : undefined}
        footer={
          skillOpen ? (
            <>
              <Button variant="ghost" onClick={() => setSkillOpen(null)}>Close</Button>
              <Button
                variant="secondary"
                onClick={() => toast({ title: 'Remedial practice set created', sub: `Assigned to ${sectionLabel(skillOpen.sectionId)} for next week.`, tone: 'success' })}
              >
                Assign practice set
              </Button>
            </>
          ) : undefined
        }
      >
        {skillOpen && (
          <div className="u-col" style={{ gap: 14 }}>
            <div className="u-flex" style={{ gap: 8 }}>
              {skillOpen.level === 'secure' ? <Badge tone="success" dot>Secure</Badge>
                : skillOpen.level === 'developing' ? <Badge tone="warning" dot>Developing</Badge>
                : <Badge tone="danger" dot>Beginning</Badge>}
              <span className="tnum u-small u-muted">{skillOpen.pct}% of the cohort secure</span>
            </div>
            <div>
              <div className="u-upper" style={{ marginBottom: 6 }}>6-week trend</div>
              <Sparkline points={skillOpen.trend} width={320} height={56} color={skillOpen.pct >= 75 ? 'var(--success)' : skillOpen.pct >= 50 ? 'var(--warning)' : 'var(--danger)'} />
            </div>
            <div className="u-small u-muted">
              Mastery is recomputed from graded work in this skill. Beginning-level skills surface in the weekly academic review.
            </div>
          </div>
        )}
      </Drawer>

      <Drawer
        open={slotOpen !== null}
        onClose={() => setSlotOpen(null)}
        title={slotOpen ? `${slotOpen.subject} · P${slotOpen.period}` : ''}
        sub={slotOpen ? `${sectionLabel(slotOpen.sectionId)} · ${slotOpen.start}–${slotOpen.end}` : undefined}
        footer={
          slotOpen ? (
            <>
              <Button variant="ghost" onClick={() => setSlotOpen(null)}>Close</Button>
              <Button
                variant="secondary"
                icon={<Icon.Refresh size={13} />}
                onClick={() => toast({ title: 'Substitution requested', sub: 'Routed to the Academic Coordinator — candidates ranked by free periods (Approvals §1.2).', tone: 'success' })}
              >
                Request substitution
              </Button>
              <Button
                variant="secondary"
                icon={<Icon.Message size={13} />}
                onClick={() => toast({ title: `Message queued to ${teacherName(slotOpen.teacherId)}`, sub: 'Staff channel.', tone: 'success' })}
              >
                Message teacher
              </Button>
            </>
          ) : undefined
        }
      >
        {slotOpen && (
          <KeyValue
            cols={1}
            items={[
              { k: 'Subject', v: slotOpen.subject },
              { k: 'Teacher', v: teacherName(slotOpen.teacherId) },
              { k: 'Time', v: <span className="tnum">{slotOpen.start}–{slotOpen.end}</span> },
              { k: 'Room', v: slotOpen.room },
              { k: 'Section', v: sectionLabel(slotOpen.sectionId) },
            ]}
          />
        )}
      </Drawer>

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New assignment"
        sub="Published immediately to the section; guardians see it in the parent app."
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button variant="primary" icon={<Icon.Check size={14} />} disabled={!newForm.title.trim()} onClick={publishAssignment}>Publish</Button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="na-title">Title</label>
          <input id="na-title" className="input" value={newForm.title} onChange={e => setNewForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Worksheet: Ratios" />
        </div>
        <div className="u-flex" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="field u-grow" style={{ minWidth: 160 }}>
            <label htmlFor="na-section">Section</label>
            <select id="na-section" className="select" value={newForm.sectionId} onChange={e => setNewForm(f => ({ ...f, sectionId: e.target.value }))}>
              {seed.sections.map(s => <option key={s.id} value={s.id}>Grade {s.grade}-{s.name} · {campusShort(s.campus)}</option>)}
            </select>
          </div>
          <div className="field u-grow" style={{ minWidth: 140 }}>
            <label htmlFor="na-subject">Subject</label>
            <select id="na-subject" className="select" value={newForm.subject} onChange={e => setNewForm(f => ({ ...f, subject: e.target.value }))}>
              {['Mathematics', 'Science', 'English', 'Social Studies', 'Hindi', 'Computer Science'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field u-grow" style={{ minWidth: 140 }}>
            <label htmlFor="na-due">Due date</label>
            <input id="na-due" type="date" className="input" value={newForm.due} onChange={e => setNewForm(f => ({ ...f, due: e.target.value }))} />
          </div>
        </div>
      </Modal>
    </>
  );
}
