/* ============================================================
   WorkloadBoard — per-teacher AGGREGATES from GET /coord/teacher-workload.
   FAIRNESS FRAMING (pinned by the server's design invariants):
   these are rostering aids to balance duty — never a score, never
   a ranking. The default order is alphabetical; the only visual
   signal is a calm amber "carrying extra load" flag at the server's
   monthly threshold — never a red score on a person.
   ============================================================ */
import { useMemo, useState } from 'react';
import {
  PageHead, Card, Badge, Button, Empty, ErrorState, SkeletonCard, Tabs, DataTable,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { friendly } from '../../lib/friendlyErrors';
import { getTeacherWorkload, type CoordTeacherWorkload, type CoordWorkloadRow } from '../../services/coordApi';
import { useCoordAccess, useCoordData, CoordDenied, CoordBanner } from './shared';

export default function WorkloadBoard() {
  const { allowed } = useCoordAccess();
  const { data, loading, error, retry } = useCoordData<CoordTeacherWorkload>(getTeacherWorkload);
  const [tab, setTab] = useState('all');

  const rows = useMemo(() => {
    const w = data?.workload ?? [];
    /* NO ranking sort default — alphabetical by name (server already returns name ASC) */
    return tab === 'extra' ? w.filter(r => r.overload) : w;
  }, [data, tab]);

  const overloadCount = (data?.workload ?? []).filter(r => r.overload).length;

  if (!allowed) return <CoordDenied what="The workload fairness view" />;

  return (
    <div>
      <PageHead
        back={{ to: '/coord/home', label: 'Command Center' }}
        title="Teacher workload"
        sub="What each teacher is carrying this month — periods, cover, invigilation, duties and pending grading — so duty can be balanced with care."
        actions={<Button variant="secondary" size="sm" icon={<Icon.Refresh size={13} />} onClick={retry}>Refresh</Button>}
      />

      <CoordBanner
        icon={<Icon.Heart size={14} />}
        strong="Used to balance duty — never to rate teachers."
        faint="This is a fairness view: it shows aggregates so extra duties don't fall on the same few people. There are no scores, no rankings and no comparisons on purpose — the amber flag simply says 'this person is carrying extra this month; consider sharing the next one'."
      />

      {loading && <SkeletonCard lines={8} />}
      {!loading && error && <ErrorState title="Could not load the workload view" sub={friendly(error)} onRetry={retry} />}

      {!loading && !error && data && (
        <>
          {data.workload.length === 0 ? (
            <Card pad>
              <Empty
                icon={<Icon.People size={22} />}
                title="No teacher workload data yet"
                sub="Aggregates appear once the timetable and duty records exist for your school."
              />
            </Card>
          ) : (
            <>
              <div className="u-flex" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                <Tabs
                  tabs={[
                    { id: 'all', label: 'All teachers', count: data.workload.length },
                    { id: 'extra', label: 'Carrying extra load', count: overloadCount },
                  ]}
                  active={tab} onChange={setTab}
                />
                <span className="u-xs u-faint">
                  Fairness threshold: {data.threshold.extra_load_per_month}+ extra duties this month ({data.threshold.basis})
                </span>
              </div>

              {rows.length === 0 ? (
                <Card pad>
                  <Empty
                    icon={<Icon.Check size={22} />}
                    title="Nobody is over the extra-load threshold"
                    sub="Extra duties this month are within the shared limit for every teacher. Nothing to rebalance."
                  />
                </Card>
              ) : (
                <div className="grid grid-2">
                  {rows.map(r => <WorkloadCard key={r.teacher_id} r={r} />)}
                </div>
              )}

              <div style={{ marginTop: 20 }}>
                <DataTable<CoordWorkloadRow>
                  caption="Per-teacher workload aggregates — alphabetical order, fairness flags only, no ranking column"
                  rows={data.workload}
                  rowKey={r => r.teacher_id}
                  columns={[
                    { key: 'name', label: 'Teacher', sortable: true, render: r => <span style={{ fontWeight: 570 }}>{r.name}</span> },
                    { key: 'periods', label: 'Periods / week', align: 'right', render: r => <span className="tnum">{r.periods_week ?? '—'}</span> },
                    { key: 'subs', label: 'Cover this month', align: 'right', render: r => <span className="tnum">{r.substitutions_month ?? '—'}</span> },
                    { key: 'invg', label: 'Invigilation', align: 'right', render: r => <span className="tnum">{r.invigilation ?? '—'}</span> },
                    { key: 'duty', label: 'Duties', align: 'right', render: r => <span className="tnum">{r.duties ?? '—'}</span> },
                    { key: 'grading', label: 'Grading (est.)', align: 'right', render: r => <span className="tnum">{r.grading_est ?? '—'}</span> },
                    {
                      key: 'flag', label: 'Fairness flag', align: 'right',
                      render: r => r.overload
                        ? <Badge tone="warning" dot>Carrying extra</Badge>
                        : <span className="u-xs u-faint">within threshold</span>,
                    },
                  ]}
                />
              </div>

              <div className="u-xs u-faint" style={{ marginTop: 14, lineHeight: 1.6 }}>
                {data.note} A “—” means that data plane isn't built yet for your school; the view fills in as records land.
                This page is read-only by design: the coordinator balances duty when allocating, it is never a teacher rating.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function WorkloadCard({ r }: { r: CoordWorkloadRow }) {
  const metrics = [
    { label: 'Periods / week', value: r.periods_week },
    { label: 'Cover this month', value: r.substitutions_month },
    { label: 'Invigilation', value: r.invigilation },
    { label: 'Duties', value: r.duties },
    { label: 'Grading (est.)', value: r.grading_est },
  ];
  return (
    <Card pad>
      <div className="u-between" style={{ gap: 10, marginBottom: 10 }}>
        <div style={{ fontWeight: 620 }}>{r.name}</div>
        {r.overload
          ? <Badge tone="warning" dot>Carrying extra load — consider sharing the next duty</Badge>
          : <span className="u-xs u-faint">within threshold</span>}
      </div>
      {/* 5-up at 1440, wraps gracefully at 768 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))', gap: 8 }}>
        {metrics.map(m => (
          <div key={m.label} style={{ minWidth: 0 }}>
            <div className="u-xs" style={{ fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{m.label}</div>
            <div className="tnum" style={{ fontSize: 'var(--text-lg)', fontWeight: 620 }}>{m.value ?? '—'}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
