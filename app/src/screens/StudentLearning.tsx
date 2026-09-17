/* ============================================================
   Student learning — Practice / Assignments / Progress tabs.
   Tiny MCQ practice with gentle feedback, an assignment drawer
   with mark-as-done, and per-subject progress with a teacher
   note. Calm aesthetic throughout.
   ============================================================ */
import { useState } from 'react';
import { Badge, Button, Card, Drawer, Modal, PageHead, Progress, SampleNote, Tabs, useToast } from '../components/ui';
import { Icon } from '../components/Icon';

interface Skill { id: string; skill: string; subject: string; color: string; problems: number }
interface Assignment { id: string; title: string; subject: string; color: string; due: string; instructions: string }
interface Question { q: string; options: string[]; answer: number }

const SKILLS: Skill[] = [
  { id: 'frac', skill: 'Equivalent fractions', subject: 'Mathematics', color: 'var(--accent)', problems: 4 },
  { id: 'lin', skill: 'Linear equations', subject: 'Mathematics', color: 'var(--accent)', problems: 6 },
  { id: 'tense', skill: 'Tenses', subject: 'English', color: 'var(--ai)', problems: 5 },
  { id: 'map', skill: 'Map skills', subject: 'Social Studies', color: 'var(--warning)', problems: 3 },
];

const ASSIGNMENTS: Assignment[] = [
  { id: 'as1', title: 'Equivalent fractions — practice set 3', subject: 'Mathematics', color: 'var(--accent)', due: 'Due Friday', instructions: 'Page 42, questions 1–8. Show one step of working for each. The point is the method, not speed.' },
  { id: 'as2', title: 'Monsoon poem — final draft', subject: 'English', color: 'var(--ai)', due: 'Due next Wednesday', instructions: 'Take the feedback from class and finish the final draft. Read it aloud once before you submit — your ear catches what your eye misses.' },
];

const PROGRESS = [
  { subject: 'Mathematics', pct: 78 },
  { subject: 'Science', pct: 71 },
  { subject: 'English', pct: 84 },
  { subject: 'Social Studies', pct: 66 },
];

const QUESTIONS: Record<string, Question> = {
  frac: { q: 'Which fraction is equivalent to 2/3?', options: ['4/6', '3/4', '2/4', '6/8'], answer: 0 },
  lin: { q: 'Solve for x:  2x + 3 = 11', options: ['x = 3', 'x = 4', 'x = 7', 'x = 8'], answer: 1 },
  tense: { q: 'Choose the correct sentence.', options: ['She go to school yesterday.', 'She went to school yesterday.', 'She gone to school yesterday.', 'She going to school yesterday.'], answer: 1 },
  map: { q: 'Which line divides the Earth into Northern and Southern hemispheres?', options: ['Tropic of Cancer', 'Prime Meridian', 'Equator', 'Arctic Circle'], answer: 2 },
};

export default function StudentLearning() {
  const toast = useToast();

  const [tab, setTab] = useState('practice');
  const [activeSkill, setActiveSkill] = useState<Skill | null>(null);
  const [qIndex, setQIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [openAssignment, setOpenAssignment] = useState<Assignment | null>(null);
  const [finished, setFinished] = useState<Set<string>>(new Set());

  const question = activeSkill ? QUESTIONS[activeSkill.id] : null;

  const openPractice = (s: Skill) => {
    setActiveSkill(s);
    setQIndex(0);
    setPicked(null);
    setDone(false);
  };
  const next = () => {
    if (qIndex + 1 >= (activeSkill?.problems ?? 1)) {
      setDone(true);
      if (activeSkill) setFinished(f => new Set(f).add(activeSkill.id));
    } else {
      setQIndex(i => i + 1);
      setPicked(null);
    }
  };

  const markDone = () => {
    if (!openAssignment) return;
    setFinished(f => new Set(f).add(openAssignment.id));
    setOpenAssignment(null);
    /* T305 (§9.5): "done" is a tick on this device — nothing is sent to the
       school, and no register is touched. */
    toast({ title: 'Marked as done on this device', sub: 'Saved only on this device — your teacher is not notified and the school register is not updated.', tone: 'info' });
  };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <PageHead
        title="Learning"
        sub="Practice a little every day — that is all this page asks."
      />

      <Tabs
        tabs={[
          { id: 'practice', label: 'Practice', count: SKILLS.length },
          { id: 'assignments', label: 'Assignments', count: ASSIGNMENTS.length },
          { id: 'progress', label: 'Progress' },
        ]}
        active={tab}
        onChange={setTab}
        pill
      />
      <div style={{ height: 16 }} />

      {/* ---------- practice ---------- */}
      {tab === 'practice' && (
        <div className="grid grid-2">
          {SKILLS.map(s => (
            <Card key={s.id} pad>
              <div className="u-col" style={{ gap: 8 }}>
              <div className="u-between">
                <span className="u-xs" style={{ padding: '2px 9px', borderRadius: 999, background: `color-mix(in srgb, ${s.color} 12%, transparent)`, color: s.color, fontWeight: 600 }}>{s.subject}</span>
                {finished.has(s.id) && <Badge tone="success" dot>Practiced</Badge>}
              </div>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-lg)' }}>{s.skill}</div>
              <div className="u-small u-muted">{s.problems} short problems · about {s.problems * 2} minutes</div>
              <div>
                <Button size="sm" variant="secondary" icon={<Icon.Play size={12} />} onClick={() => openPractice(s)}>
                  {finished.has(s.id) ? 'Practice again' : 'Start'}
                </Button>
              </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ---------- assignments ---------- */}
      {tab === 'assignments' && (
        <div className="u-col" style={{ gap: 10 }}>
          {ASSIGNMENTS.map(a => (
            <Card key={a.id} pad onClick={() => setOpenAssignment(a)} className="u-between">
              <div className="u-flex" style={{ gap: 10, minWidth: 0 }}>
                <span className="u-xs" style={{ padding: '2px 9px', borderRadius: 999, background: `color-mix(in srgb, ${a.color} 12%, transparent)`, color: a.color, fontWeight: 600, flexShrink: 0 }}>{a.subject}</span>
                <span style={{ fontWeight: 570 }} className="u-truncate">{a.title}</span>
              </div>
              <span className="u-flex" style={{ gap: 10, flexShrink: 0 }}>
                {finished.has(a.id) ? <Badge tone="success" dot>Done</Badge> : <Badge tone="warning">{a.due}</Badge>}
                <Icon.ChevronRight size={15} style={{ color: 'var(--text-3)' }} />
              </span>
            </Card>
          ))}
        </div>
      )}

      {/* ---------- progress ---------- */}
      {tab === 'progress' && (
        <div className="u-col" style={{ gap: 16 }}>
          <Card head="This term, by subject">
            {/* Honesty: no results door is connected in this build; the per-subject numbers are illustrative. */}
            <SampleNote>Sample progress — no results door is connected in this build, so these per-subject figures are illustrative and not read from your marks.</SampleNote>
            <div className="u-col" style={{ gap: 14 }}>
              {PROGRESS.map(p => (
                <div key={p.subject}>
                  <div className="u-between u-small" style={{ marginBottom: 5 }}>
                    <span style={{ fontWeight: 570 }}>{p.subject}</span>
                    <span className="tnum u-muted">{p.pct}%</span>
                  </div>
                  <Progress value={p.pct} tone={p.pct < 70 ? 'warn' : undefined} />
                </div>
              ))}
            </div>
          </Card>
          <div className="card" style={{ padding: 'var(--s-5)', background: 'var(--accent-weak)', borderColor: 'var(--accent-weak-2)' }}>
            <div className="u-flex" style={{ gap: 10 }}>
              <Icon.Learning size={16} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 580 }}>Ms. Priya Iyer: Strong reasoning in fractions — try the challenge set this week.</div>
                <div className="u-small u-muted" style={{ marginTop: 3 }}>Teacher notes appear here when they are shared with you.</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- practice modal ---------- */}
      <Modal
        open={activeSkill !== null}
        onClose={() => setActiveSkill(null)}
        title={activeSkill?.skill ?? ''}
        sub={done ? 'All done — nicely worked.' : `Question ${qIndex + 1} of ${activeSkill?.problems ?? 1}`}
        footer={
          done
            ? <Button variant="primary" onClick={() => setActiveSkill(null)}>Back to practice</Button>
            : (
              <>
                <Button variant="ghost" onClick={() => setActiveSkill(null)}>Close</Button>
                <Button variant="primary" disabled={picked === null} onClick={next}>
                  {qIndex + 1 >= (activeSkill?.problems ?? 1) ? 'Finish' : 'Next'}
                </Button>
              </>
            )
        }
      >
        {done ? (
          <div className="u-col" style={{ alignItems: 'center', gap: 8, padding: '12px 0', textAlign: 'center' }}>
            <span style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--success-weak)', color: 'var(--success)', display: 'grid', placeItems: 'center' }}>
              <Icon.Check size={22} />
            </span>
            <div style={{ fontWeight: 620 }}>You finished {activeSkill?.skill}</div>
            <div className="u-small u-muted">Steady work counts. The next set will be a touch harder, gently.</div>
          </div>
        ) : question && (
          <div className="u-col" style={{ gap: 12 }}>
            <div style={{ fontWeight: 590, fontSize: 'var(--text-lg)' }}>{question.q}</div>
            <div className="u-col" style={{ gap: 8 }}>
              {question.options.map((opt, i) => {
                const isPicked = picked === i;
                const isAnswer = i === question.answer;
                let bg = 'var(--surface)';
                let border = 'var(--border)';
                let color = 'var(--text)';
                if (picked !== null && isAnswer) { bg = 'var(--success-weak)'; border = 'var(--success-weak-2)'; color = 'var(--success)'; }
                else if (isPicked && !isAnswer) { bg = 'var(--danger-weak)'; border = 'var(--danger-weak-2)'; color = 'var(--danger)'; }
                return (
                  <button key={i} onClick={() => setPicked(i)} disabled={picked !== null} className="u-flex u-small"
                    style={{ gap: 10, padding: '10px 12px', borderRadius: 'var(--r-md)', border: `1px solid ${border}`, background: bg, color, textAlign: 'left', cursor: picked === null ? 'pointer' : 'default' }}>
                    <span style={{ width: 20, height: 20, borderRadius: 6, border: '1px solid currentColor', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 650, flexShrink: 0 }}>
                      {'ABCD'[i]}
                    </span>
                    {opt}
                  </button>
                );
              })}
            </div>
            {picked !== null && (
              <div className="u-small" style={{ color: picked === question.answer ? 'var(--success)' : 'var(--text-2)' }}>
                {picked === question.answer
                  ? 'That\u2019s right — steady.'
                  : 'Not quite — and that\u2019s fine. The answer is highlighted; try the next one fresh.'}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ---------- assignment drawer ---------- */}
      <Drawer
        open={openAssignment !== null}
        onClose={() => setOpenAssignment(null)}
        title={openAssignment?.title ?? ''}
        sub={openAssignment ? `${openAssignment.subject} · ${openAssignment.due}` : undefined}
        footer={
          finished.has(openAssignment?.id ?? '') && openAssignment
            ? <Badge tone="success" dot>Marked as done</Badge>
            : <Button variant="primary" icon={<Icon.Check size={14} />} onClick={markDone}>Mark as done</Button>
        }
      >
        <div className="u-col" style={{ gap: 12 }}>
          <div className="u-upper">Instructions</div>
          <p className="u-small" style={{ lineHeight: 1.7, color: 'var(--text-2)', margin: 0 }}>{openAssignment?.instructions}</p>
          <div style={{ height: 1, background: 'var(--border-subtle)' }} />
          <div className="u-small u-muted">
            Marking it done ticks it on this device only — your teacher is not notified and the school register is not updated.
          </div>
        </div>
      </Drawer>
    </div>
  );
}
