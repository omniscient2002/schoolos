/* ============================================================
   StudyTasks — StudentOS learn lane (SU-2, PRD-6).

   A plain checklist: your own tasks plus the ones the school
   derives from homework. Own tasks save through the toggle door.
   Homework-derived rows are the teacher's to mark — ticking one
   here is only a local reminder for the day, and the screen says
   so rather than pretending it saved.

   Doors: GET/POST /student/tasks · POST /student/print
   {kind:'checklist'}.
   ============================================================ */
import { useEffect, useState } from 'react';
import { PageHead, Card, Button, Badge, Empty, ErrorState, SkeletonCard, Progress, useToast } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { PrintButton } from '../../../components/student/PrintButton';
import { friendly } from '../../../lib/friendlyErrors';
import { fmtDate } from '../../../lib/format';
import { getTasks, addTask, toggleTask, type StudentTask } from '../../../services/studentApi';

function dateLabel(v: string | null): string | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? v : fmtDate(v);
}

export default function StudyTasks() {
  const toast = useToast();
  const [tasks, setTasks] = useState<StudentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getTasks()
      .then(d => { if (alive) setTasks(d.tasks); })
      .catch(e => { if (alive) setError(friendly(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tick]);

  const isDone = (t: StudentTask) => overrides[t.id] ?? t.done;

  const toggle = async (task: StudentTask, next: boolean) => {
    if (task.source === 'homework') {
      setOverrides(o => ({ ...o, [task.id]: next }));
      return;
    }
    const prev = tasks;
    setTasks(ts => ts.map(t => (t.id === task.id ? { ...t, done: next } : t)));
    setBusyId(task.id);
    try {
      await toggleTask(task.id, next);
    } catch (e) {
      setTasks(prev);
      toast({ title: 'That did not save', sub: friendly(e), tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const add = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await addTask({ title: title.trim(), dueDate: dueDate || undefined });
      setTitle('');
      setDueDate('');
      toast({ title: 'Task added', tone: 'success' });
      setTick(t => t + 1);
    } catch (e) {
      toast({ title: 'Could not add the task', sub: friendly(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const homework = tasks.filter(t => t.source === 'homework');
  const doneCount = tasks.filter(isDone).length;

  return (
    <div>
      <PageHead
        title="Study tasks"
        sub="A checklist for your own work. Tick things off as you go — nothing here nags you."
      />

      <Card headAs="h2" head="Add a task" sub="Give it a title and, if you like, a due date.">
        <div className="grid grid-2" style={{ gap: '0 16px' }}>
          <div className="field">
            <label htmlFor="st-title">Task</label>
            <input id="st-title" className="input" value={title} placeholder="e.g. Revise chapter 4" onChange={e => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="st-due">Due date (optional)</label>
            <input id="st-due" className="input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
        </div>
        <div className="u-flex" style={{ justifyContent: 'flex-end' }}>
          <Button variant="primary" icon={<Icon.Plus size={14} />} loading={saving} disabled={!title.trim()} onClick={add}>Add task</Button>
        </div>
      </Card>

      <div style={{ marginTop: 18 }}>
        {loading && <SkeletonCard lines={5} />}

        {!loading && error && (
          <ErrorState title="Your tasks did not load" sub={error} onRetry={() => setTick(t => t + 1)} />
        )}

        {!loading && !error && tasks.length === 0 && (
          <Empty
            icon={<Icon.Clipboard size={22} />}
            title="No study tasks yet"
            sub="Add one above, or wait for homework — it appears here automatically."
          />
        )}

        {!loading && !error && tasks.length > 0 && (
          <div className="u-col" style={{ gap: 16 }}>
            <Card headAs="h2" head="Checklist" sub={`${doneCount} of ${tasks.length} done`}>
              <Progress value={tasks.length ? (doneCount / tasks.length) * 100 : 0} />
              <div className="u-col" style={{ gap: 4, marginTop: 12 }}>
                {tasks.map(t => (
                  <TaskRow key={t.id} task={t} done={isDone(t)} busy={busyId === t.id} onToggle={next => void toggle(t, next)} />
                ))}
              </div>
              <div className="u-between u-wrap" style={{ gap: 10, marginTop: 14 }}>
                <span className="u-small u-muted">Print a paper checklist to take with you.</span>
                <PrintButton
                  kind="checklist"
                  label="Print checklist"
                  payload={{
                    title: 'My study checklist',
                    items: tasks.map(t => `${isDone(t) ? '[x]' : '[ ]'} ${t.title}${t.dueDate ? ` — due ${dateLabel(t.dueDate)}` : ''}`),
                  }}
                />
              </div>
            </Card>

            {homework.length > 0 && (
              <div className="u-small u-faint">
                Tasks marked “From homework” are the teacher&apos;s to mark received. Ticking one here is only a reminder for you — it does not change your school record.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, done, busy, onToggle }: {
  task: StudentTask;
  done: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
}) {
  const due = dateLabel(task.dueDate);
  return (
    <label
      className="checkbox"
      style={{ width: '100%', alignItems: 'flex-start', gap: 10, padding: '9px 10px', borderRadius: 'var(--r-md)', background: done ? 'var(--surface-2)' : 'transparent', opacity: busy ? 0.6 : 1 }}
    >
      <input
        type="checkbox"
        checked={done}
        disabled={busy}
        onChange={e => onToggle(e.target.checked)}
        aria-label={`${task.title}${due ? ` — due ${due}` : ''}`}
      />
      <span className="box" aria-hidden="true" style={{ marginTop: 3 }}><Icon.Check size={11} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 550, textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--text-3)' : 'var(--text)' }}>
          {task.title}
        </span>
        {due && <span className="u-small u-muted" style={{ display: 'block', marginTop: 1 }}>Due {due}</span>}
      </span>
      {task.source === 'homework' && <Badge tone="outline">From homework</Badge>}
    </label>
  );
}
