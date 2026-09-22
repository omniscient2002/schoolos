/* Interventions — P10 · support plans with an append-only lifecycle (PRD-1).
   identified → planned → in progress → reassessed → improved | continue | escalate. */
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, Modal, PageHead, Section, SkeletonCard, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useStore } from '../../state/store';
import {
  createPlan, listInterventions, listMyStudents, movePlan,
  type RosterStudent, type ServerIntervention,
} from '../../services/teacherApi';
import { AsyncGate, DeniedState, useAsync, useTeacherAccess } from './teacherKit';

const NEXT: Record<string, string[]> = {
  identified: ['planned'], planned: ['in_progress'], in_progress: ['reassessed'],
  reassessed: ['improved', 'continue', 'escalate'],
};
const LABEL: Record<string, string> = {
  identified: 'Identified', planned: 'Planned', in_progress: 'In progress',
  reassessed: 'Reassessed', improved: 'Improved', continue: 'Continue', escalate: 'Escalate',
};
const TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  identified: 'warning', planned: 'info', in_progress: 'info', reassessed: 'neutral',
  improved: 'success', continue: 'info', escalate: 'danger',
};

export default function Interventions() {
  const toast = useToast();
  const { session } = useStore();
  const allowed = useTeacherAccess('/teacher/homework');

  const list = useAsync(() => listInterventions(), []);
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState('');
  const [objective, setObjective] = useState('');
  const [activity, setActivity] = useState('');
  const [targetEnd, setTargetEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState<ServerIntervention | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => { listMyStudents().then(d => setStudents(d.students)).catch(() => setStudents([])); }, []);

  const create = async () => {
    if (!studentId || !objective.trim() || !activity.trim()) {
      toast({ title: 'Pick a student and describe the objective and activity', tone: 'info' });
      return;
    }
    setSaving(true);
    try {
      await createPlan({ studentId, objective: objective.trim(), activity: activity.trim(), targetEnd: targetEnd || undefined });
      toast({ title: 'Support plan created', sub: 'It starts at Identified.', tone: 'success' });
      setOpen(false); setStudentId(''); setObjective(''); setActivity(''); setTargetEnd('');
      list.retry();
    } catch (e) {
      toast({ title: 'Could not create the plan', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setSaving(false); }
  };

  const move = async (to: string) => {
    if (!moving) return;
    setSaving(true);
    try {
      await movePlan(moving.planId, to, note.trim() || undefined);
      toast({ title: `Moved to ${LABEL[to] ?? to}`, tone: 'success' });
      setMoving(null); setNote('');
      list.retry();
    } catch (e) {
      toast({ title: 'Could not move the plan', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setSaving(false); }
  };

  if (!allowed) return <DeniedState role={session.roleId} />;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <PageHead
        title="Interventions"
        sub="A short, tracked plan of support for one student. Every step is recorded, never rewritten."
        actions={<Button variant="primary" icon={<Icon.Plus size={14} />} onClick={() => setOpen(true)}>New plan</Button>}
      />

      <Section title="Plans" sub="Newest first.">
        <AsyncGate state={list} skeleton={<SkeletonCard lines={5} />}
          empty={<Empty icon={<Icon.Heart size={22} />} title="No support plans yet" sub="Create one when the evidence shows a student would benefit from focused support." action={<Button variant="secondary" onClick={() => setOpen(true)}>New plan</Button>} />}>
          {({ plans }) => plans.length === 0
            ? <Empty icon={<Icon.Heart size={22} />} title="No support plans yet" sub="Create one when the evidence shows a student would benefit." />
            : (
              <div className="u-col" style={{ gap: 10 }}>
                {plans.map(p => (
                  <Card key={p.planId} pad>
                    <div className="u-between u-wrap" style={{ gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="u-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Badge tone={TONE[p.status] ?? 'neutral'} dot>{LABEL[p.status] ?? p.status}</Badge>
                          <span style={{ fontWeight: 600 }}>{p.studentName}</span>
                        </div>
                        <div className="u-small" style={{ marginTop: 4 }}>{p.objective}</div>
                        <div className="u-small u-muted">{p.activity}{p.targetEnd ? ` · target ${p.targetEnd}` : ''}</div>
                      </div>
                      {(NEXT[p.status]?.length ?? 0) > 0 && (
                        <Button size="sm" variant="secondary" onClick={() => { setMoving(p); setNote(''); }}>Move forward</Button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
        </AsyncGate>
      </Section>

      <Modal open={open} onClose={() => setOpen(false)} title="New support plan"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={saving} onClick={create}>Create plan</Button></>}>
        <div className="u-col" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="iv-student">Student</label>
            <select id="iv-student" className="input" value={studentId} onChange={e => setStudentId(e.target.value)}>
              <option value="">Pick a student</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.name} · {s.grade}{s.section ? `-${s.section}` : ''}</option>)}
            </select></div>
          <div className="field"><label htmlFor="iv-obj">Objective — what should improve?</label>
            <input id="iv-obj" className="input" value={objective} onChange={e => setObjective(e.target.value)} /></div>
          <div className="field"><label htmlFor="iv-act">Activity — what support will happen?</label>
            <textarea id="iv-act" className="textarea" rows={3} value={activity} onChange={e => setActivity(e.target.value)} /></div>
          <div className="field"><label htmlFor="iv-end">Target end (optional)</label>
            <input id="iv-end" className="input" type="date" value={targetEnd} onChange={e => setTargetEnd(e.target.value)} /></div>
        </div>
      </Modal>

      <Modal open={moving !== null} onClose={() => setMoving(null)} title={moving ? `Move plan — ${moving.studentName}` : ''}
        footer={<><Button variant="ghost" onClick={() => setMoving(null)}>Cancel</Button>
          {moving && (NEXT[moving.status] ?? []).map(to => (
            <Button key={to} variant={to === 'escalate' ? 'secondary' : 'primary'} loading={saving} onClick={() => move(to)}>{LABEL[to] ?? to}</Button>
          ))}</>}>
        <div className="field"><label htmlFor="iv-note">Note (optional)</label>
          <textarea id="iv-note" className="textarea" rows={3} value={note} onChange={e => setNote(e.target.value)} /></div>
      </Modal>
    </div>
  );
}
