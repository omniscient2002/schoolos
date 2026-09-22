/* Curriculum progress — P3 · coverage check-off (A1: teachers tick, they never author).
   Doors: GET /curriculum/tree?subject=&grade=, POST /curriculum/progress. */
import { useState } from 'react';
import { Badge, Button, Card, Empty, PageHead, Progress, Section, SkeletonCard, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { getCurriculumTreeLive, saveCoverage, type CurriculumTopicLive } from '../../services/teacherApi';
import { AsyncGate, DeniedState, useAsync, useTeacherAccess } from './teacherKit';
import { useStore } from '../../state/store';

const SUBJECTS = ['Mathematics', 'Science'];

function TopicRow({ t, grade, onSaved }: { t: CurriculumTopicLive; grade: string; onSaved: () => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const set = async (pct: number) => {
    setSaving(true);
    try {
      await saveCoverage(t.topicId, grade, pct);
      toast({ title: pct >= 100 ? 'Marked covered' : `Coverage set to ${pct}%`, tone: 'success' });
      onSaved();
    } catch (e) {
      toast({ title: 'Could not save coverage', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setSaving(false); }
  };
  return (
    <div className="u-col" style={{ gap: 6, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <div className="u-between u-wrap" style={{ gap: 8 }}>
        <span className="u-small" style={{ fontWeight: 550 }}>{t.topic}</span>
        <span className="u-flex" style={{ gap: 6 }}>
          <Button size="sm" variant={t.covered ? 'ghost' : 'secondary'} disabled={saving} onClick={() => set(t.covered ? 50 : 100)}>
            {t.covered ? 'Reopen (50%)' : 'Mark covered'}
          </Button>
        </span>
      </div>
      <div className="u-flex" style={{ gap: 10, alignItems: 'center' }}>
        <div style={{ flex: 1 }}><Progress value={t.coveredPct} tone={t.coveredPct >= 100 ? undefined : t.coveredPct > 0 ? 'warn' : undefined} /></div>
        <span className="u-xs u-muted tnum" style={{ width: 34, textAlign: 'right' }}>{t.coveredPct}%</span>
      </div>
    </div>
  );
}

export default function CurriculumProgress() {
  const { session } = useStore();
  const allowed = useTeacherAccess('/teacher/curriculum');
  const [subject, setSubject] = useState('Mathematics');
  const [grade, setGrade] = useState('8');
  const state = useAsync(() => getCurriculumTreeLive(grade, subject), [grade, subject]);
  const units = state.data?.units ?? [];
  const allTopics = units.flatMap(u => u.topics);
  const covered = allTopics.filter(t => t.covered).length;

  if (!allowed) return <DeniedState role={session.roleId} />;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <PageHead
        title="Curriculum"
        sub="The school's plan, topic by topic. Tick coverage as you teach — the tree itself is authored by the office, never here."
        actions={<Badge tone="outline" dot>{covered}/{allTopics.length} topics covered</Badge>}
      />
      <div className="u-flex u-wrap" style={{ gap: 10, marginBottom: 14 }}>
        <select className="input" style={{ width: 'auto' }} value={subject} onChange={e => setSubject(e.target.value)} aria-label="Subject">
          {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" style={{ width: 'auto' }} value={grade} onChange={e => setGrade(e.target.value)} aria-label="Class">
          {['6', '7', '8', '9', '10'].map(g => <option key={g} value={g}>Class {g}</option>)}
        </select>
      </div>
      <AsyncGate state={state} skeleton={<SkeletonCard lines={6} />}
        empty={<Empty icon={<Icon.Learning size={22} />} title="No curriculum for this class yet" sub="The office imports the curriculum; it will appear here once seeded." />}>
        {({ units: us }) => us.length === 0
          ? <Empty icon={<Icon.Learning size={22} />} title="No curriculum for this class yet" sub="The office imports the curriculum." />
          : (
            <div className="u-col" style={{ gap: 14 }}>
              {us.map(u => {
                const total = u.topics.length;
                const done = u.topics.filter(t => t.covered).length;
                return (
                  <Section key={u.unitId} title={u.unit} sub={`${done}/${total} topics covered`}>
                    <Card pad>
                      {u.topics.map(t => <TopicRow key={t.topicId} t={t} grade={grade} onSaved={() => state.retry()} />)}
                    </Card>
                  </Section>
                );
              })}
            </div>
          )}
      </AsyncGate>
    </div>
  );
}
