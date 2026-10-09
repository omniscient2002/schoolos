/* Mastery map — P5 · what each child knows now, evidence-linked and decaying (A3).
   "Needs support" describes this month's work, never the child. Labels fade without
   fresh evidence. Doors: GET /mastery/class/:grade, GET /mastery/student/:id. */
import { useMemo, useState } from 'react';
import { Badge, Card, Empty, PageHead, SkeletonCard, Tabs } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { roleLabel, classLabel } from '../../lib/labels';
import {
  getMasteryClassLive, getMasteryStudentLive,
  type MasteryCell, type MasteryMapRow,
} from '../../services/teacherApi';
import { AsyncGate, DeniedState, useAsync, useTeacherAccess } from './teacherKit';
import { useStore } from '../../state/store';

const SUBJECTS = ['Mathematics', 'Science'];
const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  secure: 'success', developing: 'warning', needs_support: 'danger',
};
const WORD: Record<string, string> = { secure: 'Secure', developing: 'Developing', needs_support: 'Needs support' };

function ClassView({ grade, subject }: { grade: string; subject: string }) {
  const state = useAsync(() => getMasteryClassLive(grade, subject), [grade, subject]);
  return (
    <AsyncGate state={state} skeleton={<SkeletonCard lines={6} />}
      empty={<Empty icon={<Icon.Grid size={22} />} title="No topic-understanding data yet" sub="Labels appear as tests, homework and observations are recorded." />}>
      {({ cells, students }) => {
        const byStudent = new Map<string, MasteryCell[]>();
        for (const c of cells) {
          if (!byStudent.has(c.studentId)) byStudent.set(c.studentId, []);
          byStudent.get(c.studentId)!.push(c);
        }
        return (
          <>
            <div className="u-small u-muted" style={{ marginBottom: 10 }}>
              {students} student{students === 1 ? '' : 's'} with evidence · {cells.length} labelled cell{cells.length === 1 ? '' : 's'} · sorted by name, never by score
            </div>
            {byStudent.size === 0 ? <Empty icon={<Icon.Grid size={22} />} title="No labelled cells yet" sub="Once evidence is recorded, topic understanding appears here." /> : (
              <div className="u-col" style={{ gap: 10 }}>
                {[...byStudent.entries()].map(([id, cs]) => (
                  <Card key={id} pad>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>{cs[0].studentName}{cs[0].section ? ` · ${cs[0].section}` : ''}</div>
                    <div className="u-flex u-wrap" style={{ gap: 8 }}>
                      {cs.map(c => (
                        <span key={c.topicId} className="u-flex" style={{ gap: 6, alignItems: 'center', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: '5px 9px' }}>
                          <Badge tone={TONE[c.level ?? 'neutral'] ?? 'neutral'} dot>{WORD[c.level ?? ''] ?? '—'}</Badge>
                          <span className="u-small">{c.topic}</span>
                          {c.decayed && <span className="u-xs u-faint">needs fresh evidence</span>}
                        </span>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        );
      }}
    </AsyncGate>
  );
}

function StudentView({ grade, subject }: { grade: string; subject: string }) {
  const cls = useAsync(() => getMasteryClassLive(grade, subject), [grade, subject]);
  const [studentId, setStudentId] = useState('');
  const ids = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cls.data?.cells ?? []) m.set(c.studentId, c.studentName);
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [cls.data]);
  const activeId = studentId || ids[0]?.id || '';
  const state = useAsync(
    () => (activeId ? getMasteryStudentLive(activeId, subject) : Promise.resolve(null)),
    [activeId, subject],
  );

  if (cls.loading) return <SkeletonCard lines={5} />;
  if (ids.length === 0) return <Empty icon={<Icon.Users size={22} />} title="No students with evidence" sub="Choose a class with recorded evidence." />;

  return (
    <>
      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="mm-student">Student</label>
        <select id="mm-student" className="input" value={activeId} onChange={e => setStudentId(e.target.value)}>
          {ids.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {state.loading ? <SkeletonCard lines={5} /> : !state.data ? <Empty icon={<Icon.Grid size={22} />} title="No topic-understanding data yet" sub="Labels appear as evidence is recorded." /> : (
        <div className="grid grid-2">
          {(state.data.map as MasteryMapRow[]).map(t => (
            <Card key={t.nodeId} pad>
              <div className="u-between" style={{ gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 620 }}>{t.topic}</div>
                  {t.unit && <div className="u-xs u-faint">{t.unit}</div>}
                </div>
                <Badge tone={TONE[t.level ?? 'neutral'] ?? 'neutral'} dot>{t.levelLabel ?? WORD[t.level ?? ''] ?? '—'}</Badge>
              </div>
              <div className="u-small u-muted" style={{ marginTop: 8 }}>
                {t.freshEvidenceCount} fresh · {t.expiredEvidenceCount} expired · evidence confidence {t.confidence ?? '—'}
                {t.decayed && ' · label decayed'}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export default function MasteryMap() {
  const { session } = useStore();
  const allowed = useTeacherAccess('/teacher/mastery');
  const [view, setView] = useState('class');
  const [subject, setSubject] = useState('Mathematics');
  const [grade, setGrade] = useState('8');
  if (!allowed) return <DeniedState role={roleLabel(session.roleId)} />;
  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <PageHead title="Topic understanding map" sub="Every label rests on evidence and expires without fresh work. “Needs support” describes this month's work, not the child."
        actions={<Badge tone="outline" dot>{subject} · {classLabel(grade)}</Badge>} />
      <div className="u-flex u-wrap" style={{ gap: 10, marginBottom: 12 }}>
        <select className="input" style={{ width: 'auto' }} value={subject} onChange={e => setSubject(e.target.value)} aria-label="Subject">
          {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" style={{ width: 'auto' }} value={grade} onChange={e => setGrade(e.target.value)} aria-label="Class">
          {['6', '7', '8', '9', '10'].map(g => <option key={g} value={g}>Class {g}</option>)}
        </select>
      </div>
      <Tabs active={view} onChange={setView} tabs={[{ id: 'class', label: 'Whole class' }, { id: 'student', label: 'One student' }]} />
      <div style={{ marginTop: 16 }}>
        {view === 'class' ? <ClassView grade={grade} subject={subject} /> : <StudentView grade={grade} subject={subject} />}
      </div>
    </div>
  );
}
