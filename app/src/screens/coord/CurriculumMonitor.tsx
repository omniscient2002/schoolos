/* ============================================================
   CurriculumMonitor — per class×subject coverage from
   GET /coord/curriculum-monitor: covered vs expected progress
   bars, plain-language weeks-behind chips ("Grade 8B is 3 weeks
   behind planned curriculum"), revision-need flags, and a print
   button for the monitoring sheet. Pace is a fraction of the
   term — a planning aid, never a judgement on a teacher.
   ============================================================ */
import { useMemo, useState } from 'react';
import {
  PageHead, Card, Badge, Button, Empty, ErrorState, SkeletonCard, Progress, Tabs,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { friendly } from '../../lib/friendlyErrors';
import { getCurriculumMonitor, type CoordCurriculumMonitor as MonitorData, type CoordCurriculumRow } from '../../services/coordApi';
import { useCoordAccess, useCoordData, CoordDenied, BackToCommandCenter, CoordBanner } from './shared';

const fmtClass = (g: string | null) => (g ? `Grade ${g}` : 'Class —');

const printSheet = () => window.print();

/* monitoring-sheet row — duplicated in the print region (plain table prints cleanly) */
function MonitorRow({ r }: { r: CoordCurriculumRow }) {
  const behind = r.weeks_behind > 0;
  const pct = Math.min(100, Math.max(0, r.covered_pct));
  return (
    <Card pad>
      <div className="u-between" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 620 }}>{fmtClass(r.class_grade)} · {r.subject}</div>
        <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
          {behind && (
            <Badge tone={r.revision_needed ? 'warning' : 'info'} dot>
              {fmtClass(r.class_grade)} is {r.weeks_behind} week{r.weeks_behind === 1 ? '' : 's'} behind planned curriculum
            </Badge>
          )}
          {r.revision_needed && <Badge tone="outline">revision suggested</Badge>}
          {!behind && <Badge tone="success">on pace</Badge>}
        </div>
      </div>
      <div className="u-flex" style={{ gap: 10, alignItems: 'center', marginTop: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Progress value={pct} tone={behind ? 'warn' : undefined} />
        </div>
        <span className="u-small tnum" style={{ flexShrink: 0, color: 'var(--text-2)' }}>
          {r.covered_pct}% covered · {r.expected_pct}% expected
        </span>
      </div>
      <div className="u-xs u-faint" style={{ marginTop: 6 }}>
        {r.topics} topic{r.topics === 1 ? '' : 's'} tracked · expected pace is the share of the term elapsed (IST academic calendar)
      </div>
    </Card>
  );
}

export default function CurriculumMonitor() {
  const { allowed } = useCoordAccess();
  const { data, loading, error, retry } = useCoordData<MonitorData>(getCurriculumMonitor);
  const [tab, setTab] = useState('needs-attention');

  const rows = useMemo(() => data?.monitor ?? [], [data]);
  const behind = useMemo(() => rows.filter(r => r.weeks_behind > 0), [rows]);
  const revision = useMemo(() => rows.filter(r => r.revision_needed), [rows]);
  const visible = tab === 'needs-attention' ? behind : rows;

  if (!allowed) return <CoordDenied what="The curriculum monitor" />;

  return (
    <div>
      <PageHead
        back={{ to: '/coord/home', label: 'Command Center' }}
        title="Curriculum monitor"
        sub="Planned vs actual coverage for every class × subject, against the term pace. Weeks-behind is a planning signal — it tells you where support is needed, not who to blame."
        actions={<Button variant="secondary" size="sm" icon={<Icon.Document size={13} />} onClick={printSheet}>Print monitoring sheet</Button>}
      />

      <CoordBanner
        icon={<Icon.Compass size={14} />}
        strong="Pace is a fraction of the term — never a rank."
        faint="Expected coverage is simply the share of term days elapsed. A class showing weeks behind means it needs time, resources or support planned in — coverage is shaped by holidays, assemblies and real classrooms."
      />

      {/* print-only monitoring sheet (screen UI hides it; the printed page shows only this) */}
      <div className="coord-print-sheet" aria-hidden="true">
        <h1 style={{ fontSize: 18, margin: '0 0 2px' }}>Curriculum monitoring sheet</h1>
        <div style={{ fontSize: 11, color: '#555', marginBottom: 12 }}>
          {data?.pace ? `Term pace: ${data.pace.expected_pct}% of ${data.pace.days_total} days elapsed · ${data.pace.term_weeks} term weeks` : 'Term pace pending'} · printed {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr>{['Class', 'Subject', 'Topics', 'Covered %', 'Expected %', 'Weeks behind', 'Revision'].map(h => (
              <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #999', padding: '4px 6px' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.class_grade}-${r.subject}`}>
                <td style={{ borderBottom: '1px solid #ddd', padding: '4px 6px' }}>{fmtClass(r.class_grade)}</td>
                <td style={{ borderBottom: '1px solid #ddd', padding: '4px 6px' }}>{r.subject}</td>
                <td style={{ borderBottom: '1px solid #ddd', padding: '4px 6px' }}>{r.topics}</td>
                <td style={{ borderBottom: '1px solid #ddd', padding: '4px 6px' }}>{r.covered_pct}%</td>
                <td style={{ borderBottom: '1px solid #ddd', padding: '4px 6px' }}>{r.expected_pct}%</td>
                <td style={{ borderBottom: '1px solid #ddd', padding: '4px 6px' }}>{r.weeks_behind}</td>
                <td style={{ borderBottom: '1px solid #ddd', padding: '4px 6px' }}>{r.revision_needed ? 'yes' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: 10, color: '#555', marginTop: 10 }}>
          Fairness note: pace is a fraction of the term, never a teacher rating. Weeks behind = (expected − covered)/100 × term weeks.
        </div>
      </div>

      {/* screen UI */}
      <div className="coord-screen-only">
        {loading && <SkeletonCard lines={8} />}
        {!loading && error && <ErrorState title="Could not load curriculum coverage" sub={friendly(error)} onRetry={retry} />}

        {!loading && !error && data && (
          !data.available || rows.length === 0 ? (
            <Card pad>
              <Empty
                icon={<Icon.Learning size={22} />}
                title="Curriculum data isn't built yet"
                sub={data.note ?? 'The monitor fills in once the curriculum tree and topic check-offs exist for your school.'}
              />
            </Card>
          ) : (
            <>
              {data.pace && (
                <div className="u-flex" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                  <Badge tone="info">{data.pace.expected_pct}% of the term elapsed</Badge>
                  <Badge tone="outline">{data.pace.term_weeks} term weeks</Badge>
                  <Badge tone={behind.length ? 'warning' : 'success'}>{behind.length} class×subject behind pace</Badge>
                  {revision.length > 0 && <Badge tone="outline">{revision.length} need revision time</Badge>}
                </div>
              )}

              <Tabs
                tabs={[
                  { id: 'needs-attention', label: 'Needs attention', count: behind.length },
                  { id: 'all', label: 'All class×subject', count: rows.length },
                ]}
                active={tab} onChange={setTab}
              />
              <div style={{ height: 14 }} />

              {visible.length === 0 ? (
                <Card pad>
                  <Empty
                    icon={<Icon.Check size={22} />}
                    title={tab === 'needs-attention' ? 'Everything is at or ahead of pace' : 'No coverage data yet'}
                    sub={tab === 'needs-attention'
                      ? 'No class is behind the planned curriculum right now. The all-classes tab shows the full picture.'
                      : 'Check-offs appear as teachers mark topics covered.'}
                    action={tab === 'needs-attention' ? <Button variant="secondary" size="sm" onClick={() => setTab('all')}>Show all classes</Button> : undefined}
                  />
                </Card>
              ) : (
                <div className="grid grid-2">
                  {visible.map(r => <MonitorRow key={`${r.class_grade}-${r.subject}`} r={r} />)}
                </div>
              )}

              <div className="u-xs u-faint" style={{ marginTop: 14, lineHeight: 1.6 }}>
                {data.note}
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}
