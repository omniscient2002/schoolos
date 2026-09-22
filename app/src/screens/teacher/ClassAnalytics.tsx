/* Class analytics — P7/P11 · questions about a class, never rankings of children.
   Door: GET /analytics/class/:grade?subject=. Aggregates only. */
import { useState } from 'react';
import { Badge, Card, Empty, PageHead, Progress, Section, SkeletonCard, Stat } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { getClassAnalyticsLive } from '../../services/teacherApi';
import { AsyncGate, DeniedState, useAsync, useTeacherAccess } from './teacherKit';
import { useStore } from '../../state/store';

const SUBJECTS = ['Mathematics', 'Science'];

export default function ClassAnalytics() {
  const { session } = useStore();
  const allowed = useTeacherAccess('/teacher/homework');
  const [subject, setSubject] = useState('Mathematics');
  const [grade, setGrade] = useState('8');
  const state = useAsync(() => getClassAnalyticsLive(grade, subject), [grade, subject]);

  if (!allowed) return <DeniedState role={session.roleId} />;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <PageHead
        title="Class analytics"
        sub="How a class is doing as a group — where to reteach, who to support, what to celebrate. Never a ranking of children."
        actions={<Badge tone="outline" dot>{subject} · Class {grade}</Badge>}
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
        empty={<Empty icon={<Icon.Insights size={22} />} title="No analytics for this class" sub="Choose a class with recorded evidence." />}>
        {d => (
          <div className="u-col" style={{ gap: 16 }}>
            <div className="grid grid-4">
              <Stat label="Students" value={String(d.students)} sub="Active in this class" />
              <Stat label="Homework completion" value={d.homework.completion_pct != null ? `${d.homework.completion_pct}%` : '—'} sub={`${d.homework.turned_in} of ${d.homework.assigned} turned in`} />
              <Stat label="Attendance (30d)" value={d.attendance.pct != null ? `${d.attendance.pct}%` : '—'} sub="Approved leave excluded" />
              <Stat label="Needs support" value={String(d.mastery.needs_support)} sub="From current evidence" />
            </div>
            <Section title="Mastery spread" sub="Counts, not names.">
              <Card pad>
                <div className="u-col" style={{ gap: 12 }}>
                  {([['strong', 'Secure', 'success'], ['developing', 'Developing', 'warning'], ['needs_support', 'Needs support', 'danger'], ['unlabelled', 'No evidence yet', 'neutral']] as const).map(([key, label, tone]) => {
                    const n = d.mastery[key];
                    const pct = d.students ? Math.round((n / d.students) * 100) : 0;
                    return (
                      <div key={key}>
                        <div className="u-between u-small" style={{ marginBottom: 4 }}>
                          <Badge tone={tone} dot>{label}</Badge>
                          <span className="u-muted tnum">{n} ({pct}%)</span>
                        </div>
                        <Progress value={pct} tone={tone === 'danger' ? 'warn' : undefined} />
                      </div>
                    );
                  })}
                </div>
                <p className="u-xs u-faint" style={{ marginTop: 12, lineHeight: 1.6 }}>{d.note}</p>
              </Card>
            </Section>
          </div>
        )}
      </AsyncGate>
    </div>
  );
}
