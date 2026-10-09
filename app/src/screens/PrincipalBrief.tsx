/* ============================================================
   PrincipalBrief — OPP-PRD-2. The generated daily brief: what
   needs the principal today, computed from the live tables by the
   day worker and read from GET /brief/principal. No fabricated
   numbers: an absent brief says so.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiPrincipalBrief } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { PageHead, Card, Badge, Empty, ErrorState, Section, Stat, SkeletonCard } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtMoney } from '../lib/format';
import { roleLabel } from '../lib/labels';

interface Brief {
  absentees?: number;
  fee_dues?: { count: number; outstanding_cents: number };
  overnight_incidents?: number;
  deadlines_today?: number;
  open_actions_by_role?: Record<string, number>;
  ai_calls_stopped_on_budget?: number;
  generated_at?: string;
}

export default function PrincipalBrief() {
  const [state, setState] = useState<{ brief: Brief | null; date: string | null; loading: boolean; error: string | null }>({ brief: null, date: null, loading: true, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    apiPrincipalBrief()
      .then(r => { if (live) setState({ brief: r.brief as Brief | null, date: r.brief_date, loading: false, error: null }); })
      .catch(e => { if (live) setState({ brief: null, date: null, loading: false, error: String(e) }); });
    return () => { live = false; };
  }, [tick]);

  const b = state.brief;

  return (
    <>
      <PageHead
        title="Morning brief"
        sub={state.date ? `Generated for ${state.date} automatically each morning (07:00 IST).` : 'Generated automatically each morning.'}
        actions={<button className="btn btn-ghost btn-sm" onClick={() => setTick(t => t + 1)}><Icon.Refresh size={13} /> Reload</button>}
      />
      {state.loading ? <SkeletonCard lines={4} />
        : state.error ? <ErrorState title="Could not load the brief" sub={friendly(state.error)} onRetry={() => setTick(t => t + 1)} />
        : !b ? (
          <Empty icon={<Icon.Clipboard size={24} />} title="No brief has been generated yet"
            sub="The day worker writes one brief per school day. Until it runs, there is nothing to show — no numbers are invented here." />
        ) : (
          <>
            <div className="grid grid-4" style={{ marginBottom: 20 }}>
              <Stat label="Absent today" value={b.absentees ?? 0} sub="Marked absent in today's register" />
              <Stat label="Overdue fees" value={b.fee_dues?.count ?? 0} sub={b.fee_dues ? `${fmtMoney(Math.round(b.fee_dues.outstanding_cents / 100))} outstanding` : 'No dues data'} />
              <Stat label="New cases overnight" value={b.overnight_incidents ?? 0} sub="Opened in the last day" />
              <Stat label="Deadlines today" value={b.deadlines_today ?? 0} sub="Decisions due today" />
            </div>

            <Section title="Open decisions by desk" sub="Where the school's open actions are waiting." style={{ marginBottom: 4 }}>
              <Card pad>
                {(b.open_actions_by_role && Object.keys(b.open_actions_by_role).length) ? (
                  <div className="grid grid-4">
                    {Object.entries(b.open_actions_by_role).map(([role, n]) => (
                      <Stat key={role} label={roleLabel(role)} value={n} sub="open decision(s)" />
                    ))}
                  </div>
                ) : <Empty icon={<Icon.Clipboard size={20} />} title="No open actions" sub="Every desk is clear." />}
              </Card>
            </Section>

            <div className="u-flex u-gap-3 u-wrap" style={{ marginTop: 14 }}>
              <Link className="btn btn-secondary btn-sm" to="/action-center"><Icon.Clipboard size={13} /> Open the decision queue</Link>
              {!!b.ai_calls_stopped_on_budget && <Badge tone="warning" dot>{b.ai_calls_stopped_on_budget} AI request(s) paused after reaching yesterday&rsquo;s limit</Badge>}
            </div>
          </>
        )}
    </>
  );
}
