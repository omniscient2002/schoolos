/* Concerns — P10 · one-tap flags with append-only history (PRD-1).
   A teacher sees the concerns they filed; a safety-category or critical flag
   raises a principal-desk escalation server-side (said plainly here). */
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Drawer, Empty, PageHead, Section, SkeletonCard, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { fmtRelative } from '../../lib/format';
import { statusLabel, roleLabel, humanize } from '../../lib/labels';
import { useStore } from '../../state/store';
import {
  concernEvents, fileConcern, listMyConcerns, listMyStudents,
  type ConcernCategory, type ConcernEvent, type ConcernUrgency, type RosterStudent, type TeacherConcern,
} from '../../services/teacherApi';
import { AsyncGate, DeniedState, useAsync, useTeacherAccess } from './teacherKit';

const CATEGORIES: { id: ConcernCategory; label: string }[] = [
  { id: 'academic', label: 'Academic' }, { id: 'attendance', label: 'Attendance' },
  { id: 'behaviour', label: 'Behaviour' }, { id: 'wellbeing', label: 'Wellbeing' },
  { id: 'safety', label: 'Safety' }, { id: 'engagement', label: 'Engagement' },
];
const URGENCIES: ConcernUrgency[] = ['low', 'normal', 'high', 'critical'];
const STATUS_TONE: Record<string, 'info' | 'warning' | 'success' | 'neutral'> = {
  open: 'warning', routed: 'info', in_support: 'info', closed: 'success',
};

function EventsDrawer({ concern, onClose }: { concern: TeacherConcern; onClose: () => void }) {
  const [events, setEvents] = useState<ConcernEvent[] | null>(null);
  useEffect(() => { concernEvents(concern.concernId).then(d => setEvents(d.events)).catch(() => setEvents([])); }, [concern.concernId]);
  return (
    <Drawer open onClose={onClose} title={concern.studentName ?? 'Concern'} sub={`${humanize(concern.category)} · ${statusLabel(concern.urgency)}`}>
      {events === null ? <SkeletonCard lines={4} /> : (
        <div className="u-col" style={{ gap: 10 }}>
          <p className="u-small" style={{ margin: 0 }}>{concern.detail}</p>
          <div className="u-col" style={{ gap: 8 }}>
            {events.map((e, i) => (
              <div key={i} className="u-small" style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
                <div style={{ fontWeight: 570 }}>{statusLabel(e.to)}</div>
                {e.note && <div className="u-muted">{e.note}</div>}
                <div className="u-xs u-faint">{fmtRelative(e.at)}</div>
              </div>
            ))}
          </div>
          <div className="u-xs u-faint">History is append-only — nothing here is rewritten.</div>
        </div>
      )}
    </Drawer>
  );
}

export default function Concerns() {
  const toast = useToast();
  const { session } = useStore();
  const allowed = useTeacherAccess('/teacher/homework');

  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [studentId, setStudentId] = useState('');
  const [category, setCategory] = useState<ConcernCategory>('academic');
  const [urgency, setUrgency] = useState<ConcernUrgency>('normal');
  const [detail, setDetail] = useState('');
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<TeacherConcern | null>(null);

  const list = useAsync(() => listMyConcerns(), []);
  useEffect(() => { listMyStudents().then(d => setStudents(d.students)).catch(() => setStudents([])); }, []);

  const submit = async () => {
    if (!detail.trim()) { toast({ title: 'Describe what you noticed', tone: 'info' }); return; }
    setSaving(true);
    try {
      const r = await fileConcern({ studentId: studentId || null, category, urgency, detail: detail.trim() });
      toast({
        title: 'Concern filed',
        sub: r.escalateActionId ? 'The principal desk has been paged for review.' : 'The support team will pick it up from the queue.',
        tone: 'success',
      });
      setDetail(''); setStudentId('');
      list.retry();
    } catch (e) {
      toast({ title: 'Could not file the concern', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setSaving(false); }
  };

  if (!allowed) return <DeniedState role={roleLabel(session.roleId)} />;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <PageHead title="Concerns" sub="Flag something you noticed in a few seconds. It routes to the right team and keeps a full history." />

      <Section title="File a concern" sub="One tap. A student is optional for a general concern.">
        <Card pad>
          <div className="grid grid-2" style={{ gap: '0 14px' }}>
            <div className="field"><label htmlFor="cc-student">Student (optional)</label>
              <select id="cc-student" className="input" value={studentId} onChange={e => setStudentId(e.target.value)}>
                <option value="">General — not about one student</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.name} · {s.grade}{s.section ? `-${s.section}` : ''}</option>)}
              </select></div>
            <div className="field"><label htmlFor="cc-cat">Category</label>
              <select id="cc-cat" className="input" value={category} onChange={e => setCategory(e.target.value as ConcernCategory)}>
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select></div>
          </div>
          <div className="field"><label>Urgency</label>
            <div className="u-flex u-wrap" style={{ gap: 6 }}>
              {URGENCIES.map(u => (
                <button key={u} className={`tab ${urgency === u ? 'active' : ''}`} aria-pressed={urgency === u} onClick={() => setUrgency(u)}>{statusLabel(u)}</button>
              ))}
            </div>
            {(category === 'safety' || urgency === 'critical') && (
              <span className="hint">A safety-category or critical concern pages the principal desk for review.</span>
            )}
          </div>
          <div className="field"><label htmlFor="cc-detail">What did you notice?</label>
            <textarea id="cc-detail" className="textarea" rows={3} value={detail} onChange={e => setDetail(e.target.value)} placeholder="Facts, not conclusions — what you saw or heard." /></div>
          <div className="u-between u-wrap" style={{ gap: 10 }}>
            <span className="u-small u-muted">The child's name appears only where the routed team needs it.</span>
            <Button variant="primary" icon={<Icon.Flag size={14} />} loading={saving} onClick={submit}>File concern</Button>
          </div>
        </Card>
      </Section>

      <Section title="My concerns" sub="What you filed, newest first.">
        <AsyncGate state={list} skeleton={<SkeletonCard lines={5} />}
          empty={<Empty icon={<Icon.Flag size={22} />} title="No concerns filed" sub="Anything you flag will be listed here with its history." />}>
          {({ concerns }) => concerns.length === 0
            ? <Empty icon={<Icon.Flag size={22} />} title="No concerns filed" sub="Anything you flag will be listed here." />
            : (
              <div className="u-col" style={{ gap: 10 }}>
                {concerns.map(c => (
                  <Card key={c.concernId} pad onClick={() => setOpen(c)} className="u-between" style={{ cursor: 'pointer' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="u-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Badge tone={STATUS_TONE[c.status] ?? 'neutral'} dot>{statusLabel(c.status)}</Badge>
                        <span style={{ fontWeight: 570 }}>{c.studentName ?? 'General concern'}</span>
                        <span className="u-small u-muted">{humanize(c.category)} · {statusLabel(c.urgency)}</span>
                      </div>
                      <div className="u-small u-muted u-truncate" style={{ marginTop: 3 }}>{c.detail}</div>
                    </div>
                    <span className="u-flex" style={{ gap: 8, alignItems: 'center', flexShrink: 0 }}>
                      <span className="u-xs u-faint">{fmtRelative(c.createdAt)}</span>
                      <Icon.ChevronRight size={15} style={{ color: 'var(--text-3)' }} />
                    </span>
                  </Card>
                ))}
              </div>
            )}
        </AsyncGate>
      </Section>

      {open && <EventsDrawer concern={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
