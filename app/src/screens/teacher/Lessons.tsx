/* Lessons — P3 · the lesson workspace (PRD-2 / DAT-4).
   Planned → prepared → teaching → completed → reflected. A 10–20s reflection
   closes the loop; the curriculum tree is never authored here (A1). */
import { useMemo, useState } from 'react';
import {
  Badge, Button, Card, Empty, Modal, PageHead, Section, SkeletonCard, useToast,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { fmtDate } from '../../lib/format';
import { useStore } from '../../state/store';
import {
  createLesson, listLessons, reflectLesson,
  type TeacherLesson,
} from '../../services/teacherApi';
import { AsyncGate, DeniedState, onEnter, useAsync, useTeacherAccess } from './teacherKit';

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning'> = {
  planned: 'neutral', prepared: 'info', teaching: 'info', completed: 'success', reflected: 'success',
};

function ReflectionDrawer({ lesson, onClose, onSaved }: { lesson: TeacherLesson; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [worked, setWorked] = useState(lesson.reflection?.worked ?? '');
  const [reinforce, setReinforce] = useState(lesson.reflection?.reinforce ?? '');
  const [next, setNext] = useState(lesson.reflection?.next ?? '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await reflectLesson(lesson.id, { worked, reinforce, next });
      toast({ title: 'Reflection saved', sub: 'The lesson is closed with what you learned from it.', tone: 'success' });
      onSaved(); onClose();
    } catch (e) {
      toast({ title: 'Could not save', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setSaving(false); }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Reflect — ${lesson.topic}`}
      sub="A few words now saves the next planning cycle."
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" loading={saving} onClick={save}>Save reflection</Button></>}
    >
      <div className="u-col" style={{ gap: 12 }}>
        <div className="field"><label htmlFor="rf-worked">What worked?</label>
          <textarea id="rf-worked" className="textarea" rows={2} value={worked} onChange={e => setWorked(e.target.value)} /></div>
        <div className="field"><label htmlFor="rf-reinforce">What needs reinforcing?</label>
          <textarea id="rf-reinforce" className="textarea" rows={2} value={reinforce} onChange={e => setReinforce(e.target.value)} /></div>
        <div className="field"><label htmlFor="rf-next">What is next?</label>
          <textarea id="rf-next" className="textarea" rows={2} value={next} onChange={e => setNext(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function Lessons() {
  const toast = useToast();
  const { session } = useStore();
  const allowed = useTeacherAccess('/teacher/homework');

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [classGrade, setClassGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [period, setPeriod] = useState('');
  const [objectives, setObjectives] = useState('');
  const [resources, setResources] = useState('');
  const [saving, setSaving] = useState(false);
  const [reflectOn, setReflectOn] = useState<TeacherLesson | null>(null);

  const list = useAsync(() => listLessons(date || undefined), [date]);
  const lessons = list.data?.lessons ?? [];
  const plannedCount = useMemo(() => lessons.filter(l => l.status === 'planned').length, [lessons]);

  const publish = async () => {
    if (!classGrade.trim() || !subject.trim() || !topic.trim()) {
      toast({ title: 'A lesson needs a class, a subject and a topic', tone: 'info' });
      return;
    }
    setSaving(true);
    try {
      await createLesson({
        class_grade: classGrade.trim(), subject: subject.trim(), lesson_date: date || undefined,
        period: period ? Number(period) : null, topic: topic.trim(),
        objectives: objectives.split('\n').map(s => s.trim()).filter(Boolean),
        resources: resources.split('\n').map(s => s.trim()).filter(Boolean),
      });
      toast({ title: 'Lesson planned', sub: `${subject} · ${classGrade} — ready to teach.`, tone: 'success' });
      setTopic(''); setObjectives(''); setResources('');
      list.retry();
    } catch (e) {
      toast({ title: 'Could not save the lesson', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setSaving(false); }
  };

  if (!allowed) return <DeniedState role={session.roleId} />;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <PageHead
        title="Lessons"
        sub="Plan a lesson in seconds, then reflect on it in a few words. Coverage you tick in the curriculum tree stays separate."
        actions={<Badge tone="outline" dot>{plannedCount} planned{date ? ` · ${fmtDate(date)}` : ''}</Badge>}
      />

      <Section title="Plan a lesson" sub="Class, subject and topic are enough to start.">
        <Card pad>
          <div className="grid grid-3" style={{ gap: '0 14px' }}>
            <div className="field"><label htmlFor="ls-class">Class</label>
              <input id="ls-class" className="input" value={classGrade} onChange={e => setClassGrade(e.target.value)} placeholder="8-B" /></div>
            <div className="field"><label htmlFor="ls-subject">Subject</label>
              <input id="ls-subject" className="input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Mathematics" /></div>
            <div className="field"><label htmlFor="ls-date">Date</label>
              <input id="ls-date" className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          </div>
          <div className="grid grid-2" style={{ gap: '0 14px' }}>
            <div className="field"><label htmlFor="ls-topic">Topic</label>
              <input id="ls-topic" className="input" value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={onEnter(publish)} placeholder="Equivalent fractions" /></div>
            <div className="field"><label htmlFor="ls-period">Period (optional)</label>
              <input id="ls-period" className="input" inputMode="numeric" value={period} onChange={e => setPeriod(e.target.value.replace(/[^0-9]/g, ''))} /></div>
          </div>
          <div className="grid grid-2" style={{ gap: '0 14px' }}>
            <div className="field"><label htmlFor="ls-obj">Objectives (one per line)</label>
              <textarea id="ls-obj" className="textarea" rows={3} value={objectives} onChange={e => setObjectives(e.target.value)} /></div>
            <div className="field"><label htmlFor="ls-res">Resources (one per line)</label>
              <textarea id="ls-res" className="textarea" rows={3} value={resources} onChange={e => setResources(e.target.value)} /></div>
          </div>
          <div className="u-between u-wrap" style={{ gap: 10 }}>
            <span className="u-small u-muted">You can reflect on any lesson once it has been taught.</span>
            <Button variant="primary" icon={<Icon.Check size={14} />} loading={saving} onClick={publish}>Save lesson</Button>
          </div>
        </Card>
      </Section>

      <Section
        title="Lesson plan"
        sub="Newest first."
        actions={<input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Filter by date" style={{ width: 'auto' }} />}
      >
        <AsyncGate
          state={list}
          skeleton={<SkeletonCard lines={5} />}
          empty={<Empty icon={<Icon.Book size={22} />} title="No lessons for this day" sub="Plan the first lesson above — class, subject and topic are enough." />}
        >
          {({ lessons: rows }) => rows.length === 0
            ? <Empty icon={<Icon.Book size={22} />} title="No lessons for this day" sub="Plan the first lesson above." />
            : (
              <div className="u-col" style={{ gap: 10 }}>
                {rows.map(l => (
                  <Card key={l.id} pad>
                    <div className="u-between u-wrap" style={{ gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="u-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Badge tone={STATUS_TONE[l.status] ?? 'neutral'} dot>{l.status}</Badge>
                          <span style={{ fontWeight: 620 }}>{l.topic}</span>
                        </div>
                        <div className="u-small u-muted" style={{ marginTop: 3 }}>
                          {l.subject} · {l.class_grade}{l.period != null ? ` · P${l.period}` : ''} · {fmtDate(l.lesson_date)}
                        </div>
                      </div>
                      <Button variant="secondary" size="sm" icon={<Icon.Edit size={13} />} onClick={() => setReflectOn(l)}>
                        {l.status === 'reflected' ? 'Edit reflection' : 'Reflect'}
                      </Button>
                    </div>
                    {l.objectives.length > 0 && (
                      <ul className="u-small u-muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                        {l.objectives.map((o, i) => <li key={i}>{o}</li>)}
                      </ul>
                    )}
                    {l.reflection && (l.reflection.worked || l.reflection.reinforce || l.reflection.next) && (
                      <div className="u-small" style={{ marginTop: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
                        {l.reflection.worked && <div><strong>Worked:</strong> {l.reflection.worked}</div>}
                        {l.reflection.reinforce && <div><strong>Reinforce:</strong> {l.reflection.reinforce}</div>}
                        {l.reflection.next && <div><strong>Next:</strong> {l.reflection.next}</div>}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
        </AsyncGate>
      </Section>

      {reflectOn && <ReflectionDrawer lesson={reflectOn} onClose={() => setReflectOn(null)} onSaved={() => list.retry()} />}
    </div>
  );
}
