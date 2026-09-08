/* ============================================================
   MasteryMap — P5 mastery & growth (A3 decay).

   Two views:
   · One student — topics with 🟢 Strong / 🟡 Developing /
     🔴 Needs support, each with confidence, a trend arrow, a
     decay note ("based on work from 3 weeks ago") and a
     click-through to the evidence behind it.
   · Whole class — students × topics grid for the same class;
     every cell opens the same evidence drawer. Sorted by name,
     never by score (no rankings on children, ever).

   Doors (frozen §4):
     GET /mastery/student/:id?subject=
     GET /mastery/class/:grade?subject=
   Plain language: "Needs support", never "failing". Every
   label is evidence-stamped and expires — nothing permanent
   is ever pinned on a child.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Avatar, Badge, Button, Card, DataTable, Drawer, Empty, Tabs, useToast,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useAsync } from './teacherKit';
import {
  A3Evidence, ClassPicker, DecayNote, EvidenceDrawer, EvidenceList, FilterRow,
  InsightsFixtureTag, InsightsPageHead, InsightsRoleGate, InsightsSkeleton, MasteryChip,
} from './InsightsShared';
import {
  MASTERY_LABEL, MASTERY_STYLE, TREND_INFO,
  getMasteryClass, getMasteryStudent, rosterFor,
  type MasteryStudent, type MasteryTopic,
} from '../../services/teacherFixtures';

const CLASSES = ['8-B', '8-A', '7-A'];
const SUBJECT = 'Maths';

/* ---------- one-student view ---------- */

function StudentView({ classGrade, studentId, onPickStudent }: {
  classGrade: string; studentId: string; onPickStudent: (id: string) => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [openTopic, setOpenTopic] = useState<MasteryTopic | null>(null);
  const roster = useMemo(() => rosterFor(classGrade), [classGrade]);
  const state = useAsync(() => getMasteryStudent(studentId), [studentId]);
  const data = state.data?.data ?? null;
  const source = state.data?.source ?? 'fixture';

  const counts = useMemo(() => {
    const t = data?.topics ?? [];
    return {
      strong: t.filter(x => x.level === 'strong').length,
      developing: t.filter(x => x.level === 'developing').length,
      needs_support: t.filter(x => x.level === 'needs_support').length,
    };
  }, [data]);

  return (
    <>
      <FilterRow>
        <ClassPicker label="Class" value={classGrade} options={CLASSES} onChange={() => { /* handled by parent via effect on roster */ }} />
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="mm-student">Student</label>
          <select
            id="mm-student" className="input" style={{ width: 'auto', minWidth: 200 }}
            value={studentId} onChange={e => onPickStudent(e.target.value)}
          >
            {roster.length === 0 && <option value={studentId}>No students listed</option>}
            {roster.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div style={{ alignSelf: 'flex-end' }}>
          <InsightsFixtureTag source={source} />
        </div>
        <div style={{ alignSelf: 'flex-end' }}>
          <Button
            variant="secondary" size="sm" icon={<Icon.Heart size={13} />}
            onClick={() => {
              if (!data) { toast({ title: 'One moment', sub: 'The mastery map is still loading.', tone: 'info' }); return; }
              const weakest = [...data.topics].sort((a, b) => a.confidence - b.confidence)[0];
              navigate('/teacher/interventions', { state: { studentId: data.studentId, studentName: data.name, topic: weakest?.topic ?? 'Fractions' } });
            }}
          >
            Plan support
          </Button>
        </div>
      </FilterRow>

      {state.loading ? <InsightsSkeleton />
        : state.error ? <Empty icon={<Icon.Alert size={20} />} title="The mastery map did not load" sub={state.error} action={<Button variant="secondary" onClick={state.retry}>Try again</Button>} />
        : !data || data.topics.length === 0 ? (
          <Empty icon={<Icon.Grid size={20} />} title="No mastery data yet" sub="Labels appear as homework, tests and observations are recorded for this student." />
        ) : (
          <>
            <Card pad style={{ marginBottom: 14 }}>
              <div className="u-flex" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <Avatar name={data.name} size="lg" />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 640, fontSize: 'var(--text-lg)' }}>{data.name}</div>
                  <div className="u-small u-muted">{data.classGrade} · {SUBJECT}</div>
                </div>
                <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
                  <Badge tone="success" dot>{counts.strong} strong</Badge>
                  <Badge tone="warning" dot>{counts.developing} developing</Badge>
                  <Badge tone="danger" dot>{counts.needs_support} need support</Badge>
                </div>
              </div>
              <p className="u-xs u-faint" style={{ margin: '10px 0 0', lineHeight: 1.6 }}>
                Every label comes from real work — tests, homework and class observations — and expires after 4 weeks without fresh
                evidence. “Needs support” describes <em>this month's work</em>, not the child.
              </p>
            </Card>

            <div className="grid grid-2">
              {data.topics.map(topic => (
                <Card key={topic.nodeId} pad>
                  <div className="u-between" style={{ gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 620 }}>{topic.topic}</div>
                      <div className="u-xs u-faint">{topic.unit}</div>
                    </div>
                    <MasteryChip topic={topic} onOpen={() => setOpenTopic(topic)} />
                  </div>
                  <div className="u-flex u-xs" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    <span className="u-flex" style={{ gap: 4, alignItems: 'center' }}>
                      <span style={{ color: TREND_INFO[topic.trend].color }} aria-hidden="true">{TREND_INFO[topic.trend].glyph}</span>
                      {TREND_INFO[topic.trend].label}
                    </span>
                    <span className="u-faint" aria-hidden="true">·</span>
                    <span>{topic.confidence}% sure</span>
                    <span className="u-faint" aria-hidden="true">·</span>
                    <span>{topic.evidence.length} piece{topic.evidence.length === 1 ? '' : 's'} of evidence</span>
                  </div>
                  <DecayNote topic={topic} />
                  <div style={{ marginTop: 10 }}>
                    <Button variant="secondary" size="sm" iconRight={<Icon.ArrowUpRight size={12} />} onClick={() => setOpenTopic(topic)}>
                      Show the evidence
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

      <EvidenceDrawer topic={openTopic} onClose={() => setOpenTopic(null)} />
    </>
  );
}

/* ---------- whole-class view ---------- */

const LEVEL_ORDER: Record<string, number> = { strong: 0, developing: 1, needs_support: 2 };

function ClassView({ classGrade }: { classGrade: string }) {
  const [open, setOpen] = useState<{ student: MasteryStudent; topic: MasteryTopic } | null>(null);
  const state = useAsync(() => getMasteryClass(classGrade), [classGrade]);
  const rows = state.data?.data ?? [];
  const topicCols = rows[0]?.topics ?? [];

  const counts = useMemo(() => {
    const all = rows.flatMap(r => r.topics);
    return {
      strong: all.filter(t => t.level === 'strong').length,
      developing: all.filter(t => t.level === 'developing').length,
      needs_support: all.filter(t => t.level === 'needs_support').length,
    };
  }, [rows]);

  if (state.loading) return <InsightsSkeleton rows={3} />;
  if (state.error) return <Empty icon={<Icon.Alert size={20} />} title="The class map did not load" sub={state.error} action={<Button variant="secondary" onClick={state.retry}>Try again</Button>} />;
  if (!rows.length) return <Empty icon={<Icon.Users size={20} />} title="No students in this class yet" sub="Choose one of your classes, or wait for the roster to sync." />;

  return (
    <>
      <div className="u-flex u-small u-muted" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <Badge tone="success" dot>{counts.strong} strong</Badge>
        <Badge tone="warning" dot>{counts.developing} developing</Badge>
        <Badge tone="danger" dot>{counts.needs_support} need support</Badge>
        <span className="u-xs u-faint">Tap any square to see the work behind it · names, never ranks</span>
      </div>
      <DataTable
        caption={`Class mastery grid — ${rows.length} students across ${topicCols.length} topics`}
        rowKey={r => r.studentId}
        rows={rows}
        columns={[
          {
            key: 'name', label: 'Student', sortable: true, width: 190,
            render: r => <span className="u-flex" style={{ gap: 8, alignItems: 'center' }}><Avatar name={r.name} size="sm" />{r.name}</span>,
          },
          ...topicCols.map((t, i) => ({
            key: `t_${i}`, label: t.topic, sortable: true,
            sortValue: (r: MasteryStudent) => LEVEL_ORDER[r.topics[i]?.level ?? 'developing'],
            render: (r: MasteryStudent) => {
              const topic = r.topics[i];
              if (!topic) return <span className="u-faint">—</span>;
              const s = MASTERY_STYLE[topic.level];
              return (
                <button
                  key={topic.nodeId}
                  className="iconbtn" style={{ fontSize: 13, cursor: 'pointer' }}
                  onClick={() => setOpen({ student: r, topic })}
                  aria-label={`${r.name} — ${topic.topic}: ${MASTERY_LABEL[topic.level]}, ${topic.confidence}% sure. Show evidence.`}
                  title={`${r.name} — ${topic.topic}: ${MASTERY_LABEL[topic.level]} (${topic.confidence}% sure)`}
                >
                  <span aria-hidden="true">{s.dot}</span>
                </button>
              );
            },
          })),
          {
            key: 'trend', label: 'Trend', sortable: true, width: 120,
            sortValue: (r: MasteryStudent) => r.topics.filter(t => t.trend === 'improving').length,
            render: (r: MasteryStudent) => {
              const up = r.topics.filter(t => t.trend === 'improving').length;
              const down = r.topics.filter(t => t.trend === 'dipping').length;
              if (up && !down) return <span className="u-xs" style={{ color: 'var(--success)' }}>▲ {up} up</span>;
              if (down && !up) return <span className="u-xs" style={{ color: 'var(--danger)' }}>▼ {down} down</span>;
              if (up && down) return <span className="u-xs u-muted">▲ {up} · ▼ {down}</span>;
              return <span className="u-xs u-faint">steady</span>;
            },
          },
        ]}
      />
      <p className="u-xs u-faint" style={{ marginTop: 10, lineHeight: 1.6 }}>
        Sorted by name on purpose. Every dot rests on evidence at most 4 weeks old — older labels drop back to “developing” until fresh
        work arrives. No child is compared against another.
      </p>
      <Drawer
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? `${open.student.name} — ${open.topic.topic}` : ''}
        sub={open ? `${MASTERY_LABEL[open.topic.level]} · ${open.topic.confidence}% sure · ${TREND_INFO[open.topic.trend].label}` : undefined}
      >
        {open && (
          <div className="u-col" style={{ gap: 12 }}>
            {open.topic.evidence[0] && <A3Evidence ev={open.topic.evidence[0]} />}
            <EvidenceList topic={open.topic} />
          </div>
        )}
      </Drawer>
    </>
  );
}

/* ---------- screen ---------- */

export default function MasteryMap() {
  const [view, setView] = useState('student');
  const [classGrade] = useState('8-B'); /* single-class demo — picker is fixed per plan */
  const roster = useMemo(() => rosterFor(classGrade), [classGrade]);
  const [studentId, setStudentId] = useState(roster[0]?.id ?? 'stu_1');

  /* switching class must keep the picker on a real student of that class */
  useEffect(() => {
    if (!roster.some(r => r.id === studentId)) setStudentId(roster[0]?.id ?? 'stu_1');
  }, [roster, studentId]);

  const student = roster.find(r => r.id === studentId) ?? roster[0];

  return (
    <InsightsRoleGate>
      <InsightsPageHead
        title="Mastery map"
        sub="What each child knows right now, with the work behind every label. Labels fade after 4 weeks without fresh evidence."
        actions={<Badge tone="outline" dot>Maths · {classGrade}</Badge>}
      />
      <Tabs
        active={view}
        onChange={setView}
        tabs={[
          { id: 'student', label: 'One student' },
          { id: 'class', label: 'Whole class' },
        ]}
      />
      <div style={{ marginTop: 16 }}>
        {view === 'student'
          ? <StudentView classGrade={classGrade} studentId={student?.id ?? 'stu_1'} onPickStudent={setStudentId} />
          : <ClassView classGrade={classGrade} />}
      </div>
    </InsightsRoleGate>
  );
}
