/* ============================================================
   ProgressStory — P5 · the story instead of the score.

   A chronological narrative per student, built only from real
   evidence: lesson → homework → assessment → support →
   improvement. Every step is one plain sentence and links to
   its source (homework inbox, assessment, observation,
   intervention log). What happened, in order, in words a
   parent could read aloud.

   Door: GET /progress/story/:studentId — PROPOSED (frozen with
   TS-3 before W2; see fixtures header).
   ============================================================ */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Empty, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { fmtDate } from '../../lib/format';
import { useAsync } from './teacherKit';
import {
  FilterRow, InsightsPageHead, InsightsRoleGate, InsightsSkeleton,
} from './InsightsShared';
import { STORY_KIND_LABEL, getProgressStory, listMyStudents, type RosterStudent, type StoryStep } from '../../services/teacherApi';

const KIND_STYLE: Record<StoryStep['kind'], { color: string; icon: React.ReactNode }> = {
  introduced: { color: 'var(--info)', icon: <Icon.Learning size={13} /> },
  homework: { color: 'var(--accent)', icon: <Icon.Book size={13} /> },
  submission: { color: 'var(--accent)', icon: <Icon.Send size={13} /> },
  assessment: { color: 'var(--ai)', icon: <Icon.Clipboard size={13} /> },
  intervention: { color: 'var(--warning)', icon: <Icon.Heart size={13} /> },
  observed: { color: 'var(--text-3)', icon: <Icon.Eye size={13} /> },
  improvement: { color: 'var(--success)', icon: <Icon.Sunrise size={13} /> },
};

function StepRow({ step, first, last }: { step: StoryStep; first: boolean; last: boolean }) {
  const k = KIND_STYLE[step.kind];
  return (
    <div className="u-flex" style={{ gap: 12 }}>
      {/* rail */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 26, flexShrink: 0 }}>
        <span style={{ width: 8, height: first ? 6 : 14, borderRadius: first ? 4 : 0, background: 'var(--border-subtle)' }} aria-hidden="true" />
        <span style={{ width: 28, height: 28, borderRadius: 9, background: `color-mix(in srgb, ${k.color} 12%, var(--surface))`, color: k.color, display: 'grid', placeItems: 'center', flexShrink: 0 }} aria-hidden="true">{k.icon}</span>
        <span style={{ width: 8, flex: 1, borderRadius: last ? 4 : 0, background: 'var(--border-subtle)' }} aria-hidden="true" />
      </div>
      <div className="u-col" style={{ gap: 3, paddingBottom: last ? 0 : 18, minWidth: 0 }}>
        <div className="u-xs u-flex" style={{ gap: 6, alignItems: 'center', color: 'var(--text-3)' }}>
          <span style={{ fontWeight: 620 }}>{STORY_KIND_LABEL[step.kind]}</span>
          <span aria-hidden="true">·</span>
          <span>{fmtDate(step.at)}</span>
        </div>
        <div className="u-small" style={{ lineHeight: 1.6, color: 'var(--text-2)' }}>{step.sentence}</div>
        <div className="u-flex u-xs" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {step.evidenceRef && <span className="u-faint">Source: {step.evidenceRef}</span>}
          {step.evidenceLink && (
            <a
              href={`#${step.evidenceLink}`} className="u-xs"
              style={{ color: 'var(--accent-text)', fontWeight: 600 }}
              onClick={e => e.preventDefault()}
            >
              {step.evidenceLink === 'homework' ? 'Open homework' : step.evidenceLink === 'assessment' ? 'Open assessment' : step.evidenceLink === 'intervention' ? 'Open support plan' : 'Open observation'}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProgressStory() {
  const navigate = useNavigate();
  const toast = useToast();
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [studentId, setStudentId] = useState('');
  useEffect(() => { listMyStudents().then(d => setRoster(d.students)).catch(() => setRoster([])); }, []);
  useEffect(() => { if (!studentId && roster[0]) setStudentId(roster[0].id); }, [roster, studentId]);
  const current = roster.find(r => r.id === studentId) ?? roster[0];
  const classGrade = current?.grade ?? '';
  const state = useAsync(() => (current?.id ? getProgressStory(current.id) : Promise.resolve(null)), [current?.id]);
  const data = state.data?.data ?? null;

  return (
    <InsightsRoleGate>
      <InsightsPageHead
        title="Progress story"
        sub="How a child got here — the sequence of work behind the labels, in plain sentences. No scores without the story."
      />

      <FilterRow>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="ps-student">Student</label>
          <select
            id="ps-student" className="input" style={{ width: 'auto', minWidth: 200 }}
            value={current?.id ?? ''} onChange={e => setStudentId(e.target.value)}
          >
            {roster.length === 0 && <option value="">No students in your classes</option>}
            {roster.map(r => <option key={r.id} value={r.id}>{r.name} · {r.grade}{r.section ? `-${r.section}` : ''}</option>)}
          </select>
        </div>
        <div>
          <Button
            variant="secondary" size="sm" icon={<Icon.Heart size={13} />}
            onClick={() => {
              if (!current) { toast({ title: 'One moment', sub: 'Still loading — try again in a second.', tone: 'info' }); return; }
              navigate('/teacher/interventions', { state: { studentId: current.id, studentName: current.name, topic: 'Fractions' } });
            }}
          >
            Plan support
          </Button>
        </div>
      </FilterRow>

      {state.loading ? <InsightsSkeleton rows={5} />
        : state.error ? <Empty icon={<Icon.Alert size={20} />} title="The story did not load" sub={state.error} action={<Button variant="secondary" onClick={state.retry}>Try again</Button>} />
        : !data || data.steps.length === 0 ? (
          <Empty
            icon={<Icon.Book size={20} />}
            title="No story yet"
            sub="Lessons, homework, tests and support notes build this timeline. It fills in as the term goes on."
          />
        ) : (
          <Card pad>
            <div className="u-flex" style={{ gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 640, fontSize: 'var(--text-lg)' }}>{data.studentName}</div>
              <Badge tone="outline">{classGrade}</Badge>
              <span className="u-xs u-faint">{data.steps.length} moments · newest last · every line has a source</span>
            </div>
            <div className="u-col">
              {data.steps.map((s, i) => (
                <StepRow key={s.id} step={s} first={i === 0} last={i === data.steps.length - 1} />
              ))}
            </div>
            <p className="u-xs u-faint" style={{ margin: '14px 0 0', lineHeight: 1.6, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
              Restricted records — clinic, safeguarding, fees — never appear here, for any student. This timeline shows learning only
              (Student support §safeguarding rules).
            </p>
          </Card>
        )}
    </InsightsRoleGate>
  );
}
