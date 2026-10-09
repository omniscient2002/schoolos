/* ============================================================
   Maintenance — the operations overview.
   Answers in one screen: what's broken, what's at risk, who is
   on it, what's due this week, and where the money goes.
   Every AI statement is a summary of the records below it.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiWorkOrders, apiEvents } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import {PageHead, Stat, Badge, Button, Empty, ErrorState, SkeletonCard, Tabs, Section} from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtRelative } from '../lib/format';
import { statusLabel } from '../lib/labels';

function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => live && setState({ data: d, loading: false, error: null }))
      .catch(e => live && setState({ data: null, loading: false, error: String(e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}


const PRIO_RANK: Record<string, number> = { emergency: 0, critical: 1, high: 2, medium: 3, low: 4 };


export default function Maintenance() {
  return <LiveOverview />;
}

/* ============================================================
   LIVE overview — GET /work-orders + GET /events. The analytics
   block (spend forecasts, PM coverage, risky assets) has no
   door yet; the live hub shows only what the doors return.
   ============================================================ */
function LiveOverview() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('now');

  const wosQ = useAsync(async () => {
    const res = await apiWorkOrders();
    return (res.workOrders ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      code: String(r.code ?? ''),
      title: String(r.title ?? ''),
      category: String(r.category ?? ''),
      priority: String(r.priority ?? 'medium'),
      status: String(r.status ?? 'reported'),
      slaDue: r.sla_due_at ? new Date(String(r.sla_due_at)) : null,
      breached: !!r.sla_breached,
      cost: r.cost_cents != null ? Number(r.cost_cents) / 100 : null,
      createdAt: new Date(String(r.created_at ?? Date.now()))}));
  }, []);
  const eventsQ = useAsync(async () => {
    const res = await apiEvents();
    return (res.events ?? []).filter((e: { type?: string }) => e.type === 'maintenance').slice(0, 6);
  }, []);

  const wos = wosQ.data ?? [];
  const open = wos.filter(w => !['resolved', 'closed', 'cancelled'].includes(w.status));
  const emergency = open.filter(w => w.priority === 'emergency' || w.priority === 'critical').length;
  const needNow = [...open].sort((x, y) =>
    (PRIO_RANK[x.priority] ?? 9) - (PRIO_RANK[y.priority] ?? 9) ||
    (x.slaDue?.getTime() ?? Infinity) - (y.slaDue?.getTime() ?? Infinity)).slice(0, 4);
  const spend = wos.reduce((acc, w) => acc + (w.cost ?? 0), 0);

  return (
    <div>
      <PageHead
        title="Maintenance"
        sub={`${open.length} open jobs${emergency ? ` · ${emergency} need immediate action` : ''} — from the school records`}
        actions={
          <div className="u-inline" style={{ gap: 8 }}>
            <Button variant="secondary" icon={<Icon.Compass size={14} />} onClick={() => navigate('/maintenance/map')}>Facilities map</Button>
            <Button variant="primary" icon={<Icon.Zap size={14} />} onClick={() => navigate('/maintenance/report')}>Report issue</Button>
          </div>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 'var(--s-5)' }}>
        <Stat label="Open jobs" value={open.length} sub={`${wos.length} in total`} />
        <Stat label="Need immediate action" value={emergency} sub="emergency / critical priority" />
        <Stat label="Past deadline" value={open.filter(w => w.breached).length} sub="deadlines already missed" />
        <Stat label="Recorded spend" value={spend ? `₹${Math.round(spend).toLocaleString('en-IN')}` : '—'} sub="costs entered at resolution" />
      </div>

      <Tabs
        tabs={[{ id: 'now', label: 'Needs attention' }, { id: 'events', label: 'Live events', count: (eventsQ.data ?? []).length }]}
        active={tab}
        onChange={setTab}
      />

      {wosQ.loading ? (
        <div className="u-col" style={{ gap: 10, marginTop: 16 }}><SkeletonCard lines={3} /><SkeletonCard lines={3} /></div>
      ) : wosQ.error ? (
        <div style={{ marginTop: 16 }}><ErrorState title="Could not load maintenance" sub={friendly(wosQ.error)} onRetry={wosQ.retry} /></div>
      ) : tab === 'now' ? (
        <Section title="Needs attention" sub="Priority-ranked · open the board for the full flow" style={{ marginTop: 16 }}>
          <div className="u-col" style={{ gap: 10 }}>
            {needNow.map(w => (
              <Link key={w.id} to={`/maintenance/work-orders/${w.id}`} className={`wo-card prio-${w.priority} u-col`} style={{ gap: 6 }}>
                <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span className="u-mono u-small u-muted">{w.code}</span>
                  <Badge tone="outline">{statusLabel(w.priority)}</Badge>
                  <Badge tone="info">{statusLabel(w.status)}</Badge>
                  {w.breached && <Badge tone="danger" dot>Past deadline</Badge>}
                </div>
                <span style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>{w.title}</span>
              </Link>
            ))}
            {needNow.length === 0 && <Empty icon={<Icon.Check size={20} />} title="Nothing needs attention" sub="No open jobs in the school records." />}
          </div>
        </Section>
      ) : (
        <Section title="Live events" sub="Live maintenance events only" style={{ marginTop: 16 }}>
          <div className="u-col" style={{ gap: 8 }}>
            {eventsQ.loading && <SkeletonCard lines={2} />}
            {eventsQ.error && <ErrorState title="Could not load events" sub={friendly(eventsQ.error)} onRetry={eventsQ.retry} />}
            {(eventsQ.data ?? []).length === 0 && !eventsQ.loading && !eventsQ.error && (
              <Empty icon={<Icon.Offline size={20} />} title="No maintenance events yet" sub="Events appear here as work moves." />
            )}
            {(eventsQ.data ?? []).map((e: { label?: string; created_at?: string }, i: number) => (
              <div key={i} className="u-small" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 6 }}>
                {e.label ?? 'Event'}{e.created_at ? ` · ${fmtRelative(new Date(e.created_at))}` : ''}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

