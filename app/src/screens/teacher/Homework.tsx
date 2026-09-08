/* ============================================================
   Homework — P6 · the 20-second assignment.

   Teacher-side only (the student submit view belongs to the
   student surface, not this lane). Contract (§4, frozen):
     POST /plugins/teacher.classroom/homework
       {class_grade, subject, title, detail?, attachment?, due_at}
     GET  /plugins/teacher.classroom/homework?mine=1[&class=]
   20-second law: class/subject prefilled from context, four
   fields visible, one Enter to publish. Student submissions
   auto-publish to the class + the guardian digest at 17:00 —
   the teacher never chases.
   ============================================================ */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Avatar, Badge, Button, Card, DataTable, Drawer, Empty, PageHead, Section, Stat, useToast,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { fmtDate, fmtDateTime, fmtRelative } from '../../lib/format';
import { friendly } from '../../lib/friendlyErrors';
import { useStore } from '../../state/store';
import {
  createHomework, isFlowDoorLive, listHomework, listSubmissions, teacherContext,
  type NewHomework, type TeacherHomework, type TeacherSubmission,
} from '../../services/teacherFixtures';
import { AsyncGate, dueState, FixtureTag, onEnter, TEACHER_STAFF_ROLES, useAsync, DeniedState } from './teacherKit';

/* one-tap due presets — plain words, no calendar gymnastics */
const DUE_PRESETS: { id: string; label: string; days: number; hour: number }[] = [
  { id: 'tomorrow', label: 'Tomorrow', days: 1, hour: 17 },
  { id: 'day2', label: 'In 2 days', days: 2, hour: 17 },
  { id: 'day3', label: 'In 3 days', days: 3, hour: 17 },
  { id: 'nextweek', label: 'Next Monday', days: 0, hour: 17 }, /* resolved below */
];

function nextMonday(): Date {
  const d = new Date();
  d.setDate(d.getDate() + (8 - d.getDay()) % 7 || 7);
  d.setHours(17, 0, 0, 0);
  return d;
}
function presetDate(p: (typeof DUE_PRESETS)[number]): Date {
  if (p.id === 'nextweek') return nextMonday();
  const d = new Date();
  d.setDate(d.getDate() + p.days);
  d.setHours(p.hour, 0, 0, 0);
  return d;
}

const SUB_STATE_LABEL: Record<TeacherSubmission['status'], { label: string; tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral' }> = {
  submitted: { label: 'Waiting for you', tone: 'info' },
  late: { label: 'Late', tone: 'warning' },
  reviewed: { label: 'Reviewed', tone: 'success' },
  graded: { label: 'Graded', tone: 'success' },
  resubmit_requested: { label: 'Resubmit asked', tone: 'warning' },
  missing: { label: 'Not turned in', tone: 'danger' },
};

export default function Homework() {
  const toast = useToast();
  const navigate = useNavigate();
  const { session, actorName } = useStore();

  const [cls, setCls] = useState(teacherContext.classes[0]);
  const [subject, setSubject] = useState(teacherContext.subjectFor(teacherContext.classes[0]));
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [attachment, setAttachment] = useState('');
  const [duePreset, setDuePreset] = useState('tomorrow');
  const [publishing, setPublishing] = useState(false);
  const [summaryId, setSummaryId] = useState<string | null>(null);

  const list = useAsync(() => listHomework({ class: cls === 'all' ? undefined : cls }), [cls]);
  const summary = useAsync(
    () => (summaryId ? listSubmissions({ homework: summaryId }) : Promise.resolve({ submissions: [] as TeacherSubmission[] })),
    [summaryId],
  );
  const summaryHw = useMemo(() => list.data?.homework.find(h => h.id === summaryId) ?? null, [list.data, summaryId]);

  const pickClass = (c: string) => {
    setCls(c);
    if (c !== 'all') setSubject(teacherContext.subjectFor(c));
  };

  const publish = async () => {
    if (!title.trim()) { toast({ title: 'Add a title', sub: 'The title is what students see first.', tone: 'error' }); return; }
    setPublishing(true);
    try {
      const due = presetDate(DUE_PRESETS.find(p => p.id === duePreset) ?? DUE_PRESETS[0]);
      const body: NewHomework = {
        class_grade: cls, subject, title,
        detail: detail.trim() || undefined,
        attachment: attachment.trim() || undefined,
        due_at: due.toISOString(),
      };
      const r = await createHomework(body);
      toast({
        title: 'Homework published',
        sub: `${r.homework.class_grade} · due ${fmtDate(due)}. Students were notified and the guardian digest goes out at 17:00 — nothing to chase.`,
        tone: 'success',
      });
      setTitle(''); setDetail(''); setAttachment(''); setDuePreset('tomorrow');
      list.retry();
    } catch (e) {
      toast({ title: 'Could not publish', sub: friendly(e), tone: 'error' });
    } finally { setPublishing(false); }
  };

  const totals = useMemo(() => {
    const rows = list.data?.homework ?? [];
    return {
      open: rows.filter(h => h.status === 'open').length,
      waiting: rows.reduce((a, h) => a + ((h.submission_counts?.submitted ?? 0) + (h.submission_counts?.late ?? 0) - (h.submission_counts?.reviewed ?? 0)), 0),
      missing: rows.reduce((a, h) => a + (h.submission_counts?.missing ?? 0), 0),
    };
  }, [list.data]);

  if (!TEACHER_STAFF_ROLES.includes(session.roleId)) return <DeniedState role={session.roleId} />;

  return (
    <div>
      <PageHead
        title="Homework"
        sub={`Assign in about 20 seconds — ${teacherContext.classes.join(', ')} prefilled for ${actorName.split(' ')[0]}. Submissions land in your inbox automatically.`}
        actions={<FixtureTag source={isFlowDoorLive('hw') ? 'live' : 'fixture'} />}
      />

      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <Stat label="Open homework" value={String(totals.open)} sub={`${cls === 'all' ? 'All my classes' : cls}`} />
        <Stat label="Waiting for review" value={String(totals.waiting)} sub="Across the list below" />
        <Stat label="Not yet submitted" value={String(totals.missing)} sub="Auto-reminders are on" />
        <Stat label="Guardian digest" value="17:00" sub="Sent automatically every day" />
      </div>

      <Section title="Assign homework" sub="Fill the title — everything else is already set. Enter publishes.">
        <Card pad>
          {/* class / subject — prefilled from context (P1 rule) */}
          <div className="u-flex u-wrap" style={{ gap: 8, marginBottom: 14 }}>
            {['all', ...teacherContext.classes].map(c => (
              <button
                key={c}
                className={`tab ${cls === c ? 'active' : ''}`}
                aria-pressed={cls === c}
                onClick={() => pickClass(c)}
              >{c === 'all' ? 'All my classes' : c}</button>
            ))}
          </div>

          <div className="grid grid-2" style={{ gap: '0 16px' }}>
            <div className="field">
              <label htmlFor="hw-title">Title (the only required line)</label>
              <input
                id="hw-title"
                className="input"
                placeholder='e.g. "Fractions worksheet 4"'
                value={title}
                onChange={e => setTitle(e.target.value)}
                onKeyDown={onEnter(publish)}
                data-autofocus
              />
            </div>
            <div className="field">
              <label htmlFor="hw-subject">Subject</label>
              <input id="hw-subject" className="input" value={subject} onChange={e => setSubject(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="hw-detail">Instructions (optional)</label>
            <textarea
              id="hw-detail"
              className="textarea"
              rows={2}
              placeholder="Page and question numbers, or anything students should know."
              value={detail}
              onChange={e => setDetail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="hw-attach">Attachment or link (optional)</label>
            <input
              id="hw-attach"
              className="input"
              placeholder="Paste a file name or link — e.g. worksheet PDF or a quiz URL"
              value={attachment}
              onChange={e => setAttachment(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Due</label>
            <div className="u-flex u-wrap" style={{ gap: 8 }}>
              {DUE_PRESETS.map(p => (
                <button
                  key={p.id}
                  className={`tab ${duePreset === p.id ? 'active' : ''}`}
                  aria-pressed={duePreset === p.id}
                  onClick={() => setDuePreset(p.id)}
                >{p.label}</button>
              ))}
              <span className="u-small u-faint" style={{ marginLeft: 4 }}>
                → {fmtDate(presetDate(DUE_PRESETS.find(p => p.id === duePreset) ?? DUE_PRESETS[0]))}, 5 pm
              </span>
            </div>
          </div>

          <div className="u-between u-wrap" style={{ gap: 10 }}>
            <span className="u-small u-muted">
              Publishing notifies students now and guardians at 17:00. You never send reminders yourself.
            </span>
            <Button variant="primary" icon={<Icon.Send size={14} />} loading={publishing} onClick={publish} disabled={!title.trim()}>
              Publish homework
            </Button>
          </div>
        </Card>
      </Section>

      <Section title="My homework" sub="Due states at a glance. Reviews happen in the Submissions inbox.">
        <AsyncGate
          state={list}
          empty={
            <Empty
              icon={<Icon.Book size={22} />}
              title="No homework here yet"
              sub={cls === 'all' ? 'Assign the first one above — it takes about 20 seconds.' : `Nothing assigned to ${cls} yet. Assign the first one above.`}
            />
          }
        >
          {({ homework: rows }) => (
            <DataTable<TeacherHomework>
              caption={`Homework list — ${rows.length} item${rows.length === 1 ? '' : 's'}`}
              rows={rows}
              rowKey={h => h.id}
              onRowClick={h => setSummaryId(h.id)}
              columns={[
                {
                  key: 'title', label: 'Homework', sortable: true, sortValue: h => h.title,
                  render: h => (
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 570 }}>{h.title}</div>
                      <div className="u-xs u-faint">{h.detail ? h.detail.slice(0, 64) + (h.detail.length > 64 ? '…' : '') : '—'}</div>
                    </div>
                  ),
                },
                { key: 'class_grade', label: 'Class', sortable: true, render: h => <Badge tone="outline">{h.class_grade}</Badge> },
                {
                  key: 'due_at', label: 'Due', sortable: true, sortValue: h => new Date(h.due_at).getTime(),
                  render: h => {
                    const d = dueState(h.due_at, h.status === 'closed');
                    const tone = d.tone === 'danger' ? 'danger' : d.tone === 'warning' ? 'warning' : d.tone === 'success' ? 'success' : 'neutral';
                    return <Badge tone={tone} dot={d.tone !== 'neutral'}>{d.label}</Badge>;
                  },
                },
                {
                  key: 'turnin', label: 'Turned in',
                  render: h => {
                    const c = h.submission_counts;
                    if (!c) return <span className="u-faint u-small">—</span>;
                    return (
                      <span className="u-small">
                        {c.submitted + c.late} of {c.submitted + c.late + c.missing}
                        <span className="u-faint"> · {c.late} late · {c.missing} pending</span>
                      </span>
                    );
                  },
                },
                {
                  key: 'created_at', label: 'Assigned', sortable: true, sortValue: h => new Date(h.created_at).getTime(),
                  render: h => <span className="u-small u-muted">{fmtRelative(h.created_at)}</span>,
                },
              ]}
            />
          )}
        </AsyncGate>
        <div className="u-small u-muted" style={{ marginTop: 10 }}>
          Late and missing submissions surface in the inbox — reminders go out automatically, so no follow-up messages are needed.
        </div>
      </Section>
      {/* ---- tap a homework → its submissions summary ---- */}
      <Drawer
        open={!!summaryId}
        onClose={() => setSummaryId(null)}
        title={summaryHw ? `Submissions — ${summaryHw.title}` : 'Submissions'}
        sub={summaryHw ? `${summaryHw.class_grade} · due ${fmtDate(summaryHw.due_at)}` : ''}
        footer={
          <div className="u-between u-wrap" style={{ gap: 10, width: '100%' }}>
            <span className="u-xs u-faint">Full review, grades and notes live in the inbox.</span>
            <Button variant="primary" size="sm" icon={<Icon.Clipboard size={13} />} onClick={() => { setSummaryId(null); navigate('/teacher/submissions'); }}>
              Open the review desk
            </Button>
          </div>
        }
      >
        {summaryHw && (
          <div className="u-col" style={{ gap: 14 }}>
            <div className="grid grid-2" style={{ gap: 10 }}>
              <Stat label="Turned in" value={String((summaryHw.submission_counts?.submitted ?? 0) + (summaryHw.submission_counts?.late ?? 0))} sub="of the class" />
              <Stat label="Waiting for you" value={String(Math.max(0, (summaryHw.submission_counts?.submitted ?? 0) + (summaryHw.submission_counts?.late ?? 0) - (summaryHw.submission_counts?.reviewed ?? 0)))} sub="Reviews take about 20s each" />
              <Stat label="Late" value={String(summaryHw.submission_counts?.late ?? 0)} sub="Your call to accept" />
              <Stat label="Not yet in" value={String(summaryHw.submission_counts?.missing ?? 0)} sub="Reminders run automatically" />
            </div>

            <AsyncGate
              state={summary}
              empty={<Empty icon={<Icon.Check size={20} />} title="Nothing to review yet" sub="Turned-in work appears here the moment a student sends it." />}
            >
              {data => (
                <div className="u-col" style={{ gap: 8 }}>
                  {data.submissions.map(s => (
                    <Card key={s.id} pad>
                      <div className="u-between u-wrap" style={{ gap: 8 }}>
                        <div className="u-flex" style={{ gap: 9, minWidth: 0 }}>
                          <Avatar name={s.student_name} size="sm" />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 570 }}>{s.student_name}</div>
                            <div className="u-xs u-faint">
                              {s.submitted_at ? `turned in ${fmtDateTime(s.submitted_at)}` : 'nothing received yet'}
                              {s.grade != null ? ` · ${s.grade}/15` : ''}
                            </div>
                          </div>
                        </div>
                        <Badge tone={SUB_STATE_LABEL[s.status].tone} dot={s.status !== 'reviewed' && s.status !== 'graded'}>
                          {SUB_STATE_LABEL[s.status].label}
                        </Badge>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </AsyncGate>
          </div>
        )}
      </Drawer>
    </div>
  );
}
