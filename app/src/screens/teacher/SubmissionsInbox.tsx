/* ============================================================
   SubmissionsInbox — P6 · the Gmail-style review desk.

   Contract (§4, frozen):
     GET  /plugins/teacher.classroom/submissions?homework=&state=
     POST /plugins/teacher.classroom/submissions/:id/review
          {status, grade?, feedback?}
   Tabs All | Pending | Reviewed | Late | Missing. Bulk review,
   per-item review drawer (grade / feedback / request
   resubmission), filters by class + student + homework.
   Empty states teach: nothing pending means the auto-reminder
   machinery already did the chasing.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Avatar, Badge, Button, Card, DataTable, Drawer, Empty, PageHead, Section, Stat, Tabs, useToast,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import { friendly } from '../../lib/friendlyErrors';
import { useStore } from '../../state/store';
import {
  listHomework, listSubmissions, reviewSubmission,
  type TeacherSubmission,
} from '../../services/teacherFixtures';
import { AsyncGate, DeniedState, TEACHER_STAFF_ROLES, useAsync } from './teacherKit';

/* class filter options — the live door owns the real roster */
const MY_CLASSES = ['8-B', '8-A', '7-A'];

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'submitted', label: 'Pending' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'late', label: 'Late' },
  { id: 'missing', label: 'Missing' },
] as const;

const STATE_BADGE: Record<TeacherSubmission['status'], { label: string; tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral' }> = {
  submitted: { label: 'Waiting for you', tone: 'info' },
  late: { label: 'Late', tone: 'warning' },
  reviewed: { label: 'Reviewed', tone: 'success' },
  graded: { label: 'Graded', tone: 'success' },
  resubmit_requested: { label: 'Resubmit asked', tone: 'warning' },
  missing: { label: 'Missing', tone: 'danger' },
};

const CONTENT_ICON: Record<TeacherSubmission['content_type'], keyof typeof Icon> = {
  text: 'Message', image: 'Eye', pdf: 'Document', link: 'ExternalLink',
};

export default function SubmissionsInbox() {
  const toast = useToast();
  const { session } = useStore();

  const [tab, setTab] = useState<string>('all');
  const [cls, setCls] = useState('all');
  const [student, setStudent] = useState('all');
  const [homeworkId, setHomeworkId] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  /* drawer form */
  const [grade, setGrade] = useState('');
  const [feedback, setFeedback] = useState('');
  const [decide, setDecide] = useState<'reviewed' | 'graded' | 'resubmit_requested'>('reviewed');
  const [saving, setSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [, setBulkDone] = useState(0); /* write-only tick — the completion toast reports the count */

  const hw = useAsync(() => listHomework(), []);
  const subs = useAsync(
    () => listSubmissions({ state: tab === 'all' ? undefined : tab, homework: homeworkId === 'all' ? undefined : homeworkId }),
    [tab, homeworkId],
  );

  /* refetch homework counts alongside submissions so the stat row stays true */
  useEffect(() => { if (subs.data) hw.retry(); }, [subs.data?.submissions.length, tab]); // eslint-disable-line react-hooks/exhaustive-deps -- counts refresh after review actions

  const all = useMemo(() => subs.data?.submissions ?? [], [subs.data]);
  const filtered = useMemo(() => all.filter(s =>
    (cls === 'all' || s.class_grade === cls) &&
    (student === 'all' || s.student_id === student)), [all, cls, student]);

  const students = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of all) seen.set(s.student_id, s.student_name);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);

  const counts = useMemo(() => {
    const c = { pending: 0, late: 0, missing: 0, reviewed: 0 };
    for (const s of all) {
      if (s.status === 'submitted') c.pending++;
      else if (s.status === 'reviewed') c.reviewed++;
      else if (s.status === 'late') c.late++;
      else if (s.status === 'missing') c.missing++;
    }
    return c;
  }, [all]);

  const selRows = filtered.filter(s => selected.has(s.id));
  const selReviewable = selRows.filter(s => s.status === 'submitted' || s.status === 'late');
  const open = openId ? all.find(s => s.id === openId) ?? null : null;

  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const markReviewed = async (rows: TeacherSubmission[]) => {
    setBulkSaving(true);
    setBulkDone(0);
    let ok = 0;
    let failed: TeacherSubmission | null = null;
    let failErr = '';
    /* sequential on purpose — one review POST at a time, with live progress,
       so a mid-run failure leaves the rest untouched and re-runnable */
    for (let i = 0; i < rows.length; i++) {
      try {
        await reviewSubmission(rows[i].id, { status: 'reviewed' });
        ok++;
      } catch (e) {
        failed = rows[i];
        failErr = friendly(e);
        break;
      } finally {
        setBulkDone(i + 1);
      }
    }
    setBulkSaving(false);
    if (ok === rows.length) {
      toast({
        title: `${rows.length} submission${rows.length === 1 ? '' : 's'} marked reviewed`,
        sub: 'Students and guardians see the status in their evening digest.',
        tone: 'success',
      });
      setSelected(new Set());
    } else if (failed) {
      toast({
        title: `Saved ${ok} of ${rows.length}`,
        sub: `${failed.student_name}'s review did not save — ${failErr}. Try that one again from its row.`,
        tone: 'error',
      });
    }
    subs.retry();
  };

  const openDrawer = (s: TeacherSubmission) => {
    setOpenId(s.id);
    setGrade(s.grade != null ? String(s.grade) : '');
    setFeedback(s.feedback ?? '');
    setDecide('reviewed');
  };

  const saveReview = async () => {
    if (!open) return;
    setSaving(true);
    try {
      /* D-7 grading contract (teacher.classroom:168): a grade can only be
         recorded when status='graded' — the drawer used to send
         status:'reviewed' with the grade attached, so every graded review
         400'd and the grade never persisted. Any recorded grade ⇒ 'graded'. */
      const hasGrade = grade.trim() !== '';
      const body: { status: string; grade?: number; feedback?: string } = {
        status: hasGrade ? 'graded' : decide,
        feedback: feedback.trim() || undefined,
        grade: hasGrade ? Number(grade) : undefined,
      };
      await reviewSubmission(open.id, body);
      toast({
        title: hasGrade ? 'Grade saved' : decide === 'reviewed' ? 'Review saved' : 'Resubmission requested',
        sub: decide === 'resubmit_requested' && !hasGrade
          ? `${open.student_name} was asked to send the work again. A reminder goes out with the 17:00 digest.`
          : `${open.student_name} — the student sees your ${hasGrade ? 'grade and note' : 'note'} in the app tonight.`,
        tone: 'success',
      });
      setOpenId(null);
      subs.retry();
    } catch (e) {
      toast({ title: 'Review did not save', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setSaving(false); }
  };

  if (!TEACHER_STAFF_ROLES.includes(session.roleId)) return <DeniedState role={session.roleId} />;

  return (
    <div>
      <PageHead
        title="Submissions inbox"        sub="Every turned-in homework in one desk. Mark reviewed, add a note, or ask for the work again — reminders to students are automatic."
      />

      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <Stat label="Waiting for you" value={String(counts.pending + counts.late)} sub={`${counts.late} came in late`} />
        <Stat label="Reviewed" value={String(counts.reviewed)} sub="Students were notified" />
        <Stat label="Missing" value={String(counts.missing)} sub="Auto-reminder rides the 17:00 digest" />
        <Stat label="Homework open" value={String(hw.data?.homework.filter(h => h.status === 'open').length ?? 0)} sub="Accepting submissions" />
      </div>

      {/* ---- filters ---- */}
      <Card pad style={{ marginBottom: 14 }}>
        <div className="u-flex u-wrap" style={{ gap: 12 }}>
          <div className="field" style={{ marginBottom: 0, minWidth: 170 }}>
            <label htmlFor="f-class">Class</label>
            <select id="f-class" className="select" value={cls} onChange={e => { setCls(e.target.value); setStudent('all'); }}>
              <option value="all">All my classes</option>
              {MY_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 190 }}>
            <label htmlFor="f-student">Student</label>
            <select id="f-student" className="select" value={student} onChange={e => setStudent(e.target.value)}>
              <option value="all">All students</option>
              {students.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 220 }}>
            <label htmlFor="f-hw">Homework</label>
            <select id="f-hw" className="select" value={homeworkId} onChange={e => setHomeworkId(e.target.value)}>
              <option value="all">All homework</option>
              {(hw.data?.homework ?? []).map(h => <option key={h.id} value={h.id}>{h.title} · {h.class_grade}</option>)}
            </select>
          </div>
          {(cls !== 'all' || student !== 'all' || homeworkId !== 'all') && (
            <div style={{ alignSelf: 'flex-end' }}>
              <Button variant="ghost" size="sm" icon={<Icon.Refresh size={13} />} onClick={() => { setCls('all'); setStudent('all'); setHomeworkId('all'); }}>
                Clear filters
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* ---- bulk bar (appears when rows are selected) ---- */}
      {selected.size > 0 && (
        <Card pad style={{ marginBottom: 14, borderColor: 'var(--accent-weak-2)', background: 'var(--accent-weak)' }}>
          <div className="u-between u-wrap" style={{ gap: 10 }}>
            <span className="u-small" style={{ fontWeight: 600 }}>
              {selected.size} selected{selReviewable.length !== selected.size ? ` — ${selected.size - selReviewable.length} already reviewed or missing` : ''}
            </span>
            <div className="u-flex" style={{ gap: 8 }}>
              <Button
                variant="primary" size="sm" loading={bulkSaving}
                disabled={selReviewable.length === 0}
                icon={<Icon.Check size={14} />}
                onClick={() => markReviewed(selReviewable)}
              >
                Mark {selReviewable.length} reviewed
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
          </div>
        </Card>
      )}

      {/* ---- tabs + table ---- */}
      <Tabs
        tabs={TABS.map(t => ({ id: t.id, label: t.label, count: t.id === 'all' ? all.length : all.filter(s => s.status === t.id || (t.id === 'submitted' && s.status === 'resubmit_requested')).length }))}
        active={tab}
        onChange={id => { setTab(id); setSelected(new Set()); }}
        panelId="subs-inbox"
      />
      <div role="tabpanel" id="subs-inbox-panel-all" aria-labelledby="subs-inbox-tab-all">
        <AsyncGate
          state={subs}
          empty={
            tab === 'all' ? (
              <Empty
                icon={<Icon.Clipboard size={22} />}
                title="No submissions yet"
                sub="Assign homework first — turned-in work lands here the moment a student sends it."
                action={<Link to="/teacher/homework" className="btn btn-secondary btn-sm" style={{ minHeight: 40 }}>Assign homework</Link>}
              />
            ) : tab === 'submitted' ? (
              <Empty
                icon={<Icon.Check size={22} />}
                title="Nothing to review — homework was auto-reminded"
                sub="Every student who should have submitted has submitted, or has a reminder queued in the evening digest. Nothing here needs chasing."
              />
            ) : tab === 'reviewed' ? (
              <Empty icon={<Icon.Check size={22} />} title="Nothing reviewed yet" sub="Reviews you complete move here, with your grade and note attached." />
            ) : tab === 'late' ? (
              <Empty icon={<Icon.Clock size={22} />} title="No late work" sub="Everything came in before the deadline. The late view fills itself when something doesn't." />
            ) : (
              <Empty
                icon={<Icon.Users size={22} />}
                title="No one is missing work"
                sub="Students who haven't submitted appear here until they do — reminders go to them and their guardians automatically at 17:00. You never send the chase-up."
              />
            )
          }
        >
          {({ submissions: rows }) => (
            <DataTable<TeacherSubmission>
              caption={`Submissions — ${rows.length} row${rows.length === 1 ? '' : 's'}, ${TABS.find(t => t.id === tab)?.label ?? ''} view`}
              rows={rows}
              rowKey={s => s.id}
              onRowClick={openDrawer}
              columns={[
                {
                  key: 'pick', label: '', width: 34,
                  render: s => (
                    <span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${s.student_name} — ${s.homework_title}`}
                        checked={selected.has(s.id)}
                        onChange={() => toggle(s.id)}
                      />
                    </span>
                  ),
                },
                {
                  key: 'student', label: 'Student', sortable: true, sortValue: s => s.student_name,
                  render: s => (
                    <div className="u-flex" style={{ gap: 9, minWidth: 0 }}>
                      <Avatar name={s.student_name} size="sm" />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 570 }}>{s.student_name}</div>
                        <div className="u-xs u-faint">{s.class_grade}</div>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'homework_title', label: 'Homework', sortable: true,
                  render: s => <span className="u-small">{s.homework_title}</span>,
                },
                {
                  key: 'content_type', label: 'Work',
                  render: s => {
                    const Ic = Icon[CONTENT_ICON[s.content_type]];
                    return (
                      <span className="u-flex u-small u-muted" style={{ gap: 5 }}>
                        <Ic size={13} />
                        {s.content_type === 'link' ? 'Link' : s.content_type === 'pdf' ? 'PDF' : s.content_type === 'image' ? 'Photo' : 'Typed'}
                      </span>
                    );
                  },
                },
                {
                  key: 'submitted_at', label: 'Turned in', sortable: true, sortValue: s => s.submitted_at ? new Date(s.submitted_at).getTime() : 0,
                  render: s => s.submitted_at ? <span className="u-small u-muted">{fmtRelative(s.submitted_at)}</span> : <span className="u-faint u-small">Not yet</span>,
                },
                {
                  key: 'status', label: 'Status', sortable: true,
                  render: s => <Badge tone={STATE_BADGE[s.status].tone} dot={s.status !== 'reviewed'}>{STATE_BADGE[s.status].label}</Badge>,
                },
                {
                  key: 'open', label: '', align: 'right',
                  render: () => <span className="u-small" style={{ color: 'var(--accent)', fontWeight: 600 }}>Review <Icon.ChevronRight size={12} style={{ display: 'inline' }} /></span>,
                },
              ]}
            />
          )}
        </AsyncGate>
      </div>

      {/* ---- review drawer ---- */}
      <Drawer
        open={!!open}
        onClose={() => setOpenId(null)}
        title={open ? `Review — ${open.student_name}` : ''}
        sub={open ? `${open.homework_title} · ${open.class_grade} · ${open.submitted_at ? `turned in ${fmtDateTime(open.submitted_at)}` : 'not turned in'}` : ''}
        footer={
          open && (
            <div className="u-between u-wrap" style={{ gap: 10, width: '100%' }}>
              <span className="u-xs u-faint">Saved reviews reach the student and guardian digest tonight.</span>
              <div className="u-flex" style={{ gap: 8 }}>
                <Button variant="ghost" onClick={() => setOpenId(null)}>Cancel</Button>
                <Button variant="primary" loading={saving} onClick={saveReview}>
                  {decide === 'reviewed' ? 'Save review' : 'Ask for resubmission'}
                </Button>
              </div>
            </div>
          )
        }
      >
        {open && (
          <div className="u-col" style={{ gap: 14 }}>
            {/* what the student sent */}
            <Card pad>
              <div className="u-between" style={{ marginBottom: 6 }}>
                <span className="u-xs" style={{ fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)' }}>What was sent</span>
                <Badge tone={STATE_BADGE[open.status].tone}>{STATE_BADGE[open.status].label}</Badge>
              </div>
              {open.status === 'missing' ? (
                <Empty
                  icon={<Icon.Clock size={18} />}
                  title="Nothing received yet"
                  sub="The reminder queue already covers this student — the digest at 17:00 nudges again."
                />
              ) : open.content_type === 'text' ? (
                <div className="u-small" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{open.content_ref}</div>
              ) : (
                <div className="u-flex u-small u-muted" style={{ gap: 7 }}>
                  <Icon.File size={15} />
                  {open.content_type === 'link' ? 'Submitted a link:' : 'Submitted a file:'} {open.content_ref}
                </div>
              )}
            </Card>

            {open.status !== 'missing' && (
              <>
                {/* decision */}
                <div className="field">
                  <label>Decision</label>
                  <div className="u-flex u-wrap" style={{ gap: 8 }}>
                    <button className={`tab ${decide === 'reviewed' ? 'active' : ''}`} aria-pressed={decide === 'reviewed'} onClick={() => setDecide('reviewed')}>
                      Reviewed — accept
                    </button>
                    <button className={`tab ${decide === 'resubmit_requested' ? 'active' : ''}`} aria-pressed={decide === 'resubmit_requested'} onClick={() => setDecide('resubmit_requested')}>
                      Ask to redo
                    </button>
                  </div>
                  <span className="hint">
                    {decide === 'reviewed'
                      ? 'Accepts this submission and records your grade and note.'
                      : 'The student is asked to send the work again — worded kindly, no blame.'}
                  </span>
                </div>

                {decide === 'reviewed' && (
                  <div className="field">
                    <label htmlFor="rv-grade">Grade (marks out of 15, optional)</label>
                    <input
                      id="rv-grade"
                      className="input"
                      type="number"
                      min={0}
                      max={100}
                      placeholder="e.g. 12"
                      value={grade}
                      onChange={e => setGrade(e.target.value)}
                      data-autofocus
                    />
                  </div>
                )}

                <div className="field">
                  <label htmlFor="rv-feedback">Note to the student (optional)</label>
                  <textarea
                    id="rv-feedback"
                    className="textarea"
                    rows={3}
                    placeholder={decide === 'reviewed'
                      ? 'One thing done well, one thing to improve.'
                      : 'Say kindly what needs redoing — e.g. "Q4–Q6 have flipped signs, redo those three."'}
                    value={feedback}
                    onChange={e => setFeedback(e.target.value)}
                  />
                </div>

                {open.feedback && (
                  <div className="u-small u-muted">
                    Previous note: “{open.feedback}”{open.reviewed_at ? ` · ${fmtRelative(open.reviewed_at)}` : ''}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Drawer>

      <Section title="How the inbox works" sub="So nothing needs chasing">
        <Card pad>
          <div className="u-col u-small u-muted" style={{ gap: 6 }}>
            <span><strong style={{ color: 'var(--text)' }}>Pending</strong> — submitted on time, waiting for your review.</span>
            <span><strong style={{ color: 'var(--text)' }}>Late</strong> — came in after the deadline; still your decision to accept.</span>
            <span><strong style={{ color: 'var(--text)' }}>Missing</strong> — the student hasn't sent anything. Reminders to the student and guardian run automatically with the 17:00 digest; you never send the chase-up.</span>
            <span>Bulk select marks many reviewed at once — use it for the easy ones, and the drawer for work that needs a note.</span>
          </div>
        </Card>
      </Section>
    </div>
  );
}
