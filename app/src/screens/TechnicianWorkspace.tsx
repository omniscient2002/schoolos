/* ============================================================
   TechnicianWorkspace — job sheet for the signed-in technician
   (/maintenance/technician). Jobs are read from the server door
   and advanced with the server's own state machine; named
   assignment and parts consumption are not exposed by the doors
   yet, so the screen says so rather than inventing them.
   ============================================================ */
import { useEffect, useState } from 'react';
import type { MaintPriority, WOStatus } from '../types/domain';
import { useStore } from '../state/store';
import { apiWorkOrders, apiWorkOrderStatus } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { PageHead, Badge, Button, Empty, useToast, SkeletonCard, ErrorState } from '../components/ui';
import { Icon } from '../components/Icon';
import { PriorityBadge, WOStatusChip, woStatusLabel } from '../components/Maint';
import { fmtRelative } from '../lib/format';



function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(st => ({ ...st, loading: true, error: null }));
    fn().then(d => { if (live) setState({ data: d, loading: false, error: null }); })
      .catch(e => { if (live) setState({ data: null, loading: false, error: String(e) }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

export default function TechnicianWorkspace() {
  return <LiveWorkspace />;
}

/* ============================================================
   LIVE workspace — server truth via GET /work-orders; advancing
   runs POST /work-orders/:id/status. Named technician assignment
   and parts consumption are not exposed by the doors yet — the
   screen says so instead of pretending.
   ============================================================ */
const LIVE_FLOW = ['reported', 'assigned', 'accepted', 'en-route', 'on-site', 'repairing', 'verification', 'resolved', 'closed'];

interface LiveWo {
  id: string; code: string; title: string; description: string; category: string; priority: string;
  status: string; slaDue: Date | null; breached: boolean; createdAt: Date;
  assetCode: string | null; assetName: string | null;
}

function LiveWorkspace() {
  const { session } = useStore();
  const toast = useToast();
  const isTech = session.roleId === 'technician';
  const [tab, setTab] = useState<'queue' | 'active' | 'verify' | 'done'>('active');
  const [busy, setBusy] = useState<string | null>(null);
  const [costRupees, setCostRupees] = useState('');

  const wos = useAsync(async () => {
    const res = await apiWorkOrders();
    return (res.workOrders ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      code: String(r.code ?? r.id),
      title: String(r.title ?? ''),
      description: String(r.description ?? ''),
      category: String(r.category ?? ''),
      priority: String(r.priority ?? 'medium'),
      status: String(r.status ?? 'reported'),
      slaDue: r.sla_due_at ? new Date(String(r.sla_due_at)) : null,
      breached: !!r.sla_breached,
      createdAt: new Date(String(r.created_at ?? Date.now())),
      assetCode: (r.asset_code as string) ?? null,
      assetName: (r.asset_name as string) ?? null,
    }));
  }, []);

  const rows: LiveWo[] = wos.data ?? [];
  const queue = rows.filter((w: LiveWo) => w.status === 'reported');
  const active = rows.filter((w: LiveWo) => ['assigned', 'accepted', 'en-route', 'on-site', 'repairing'].includes(w.status));
  const verify = rows.filter((w: LiveWo) => w.status === 'verification');
  const done = rows.filter((w: LiveWo) => ['resolved', 'closed'].includes(w.status));
  const shown = tab === 'queue' ? queue : tab === 'active' ? active : tab === 'verify' ? verify : done;

  const transition = async (wo: (typeof rows)[number], to: string, costCents?: number) => {
    setBusy(`${wo.id}:${to}`);
    try {
      await apiWorkOrderStatus(wo.id, to, costCents);
      toast({ title: `${wo.code} → ${woStatusLabel(to as WOStatus)}`, sub: 'Recorded — the board and this queue reflect it immediately.', tone: 'success' });
      setCostRupees('');
      wos.retry();
    } catch (e) {
      toast({ title: 'Transition refused', sub: friendly(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const tabs = [
    { id: 'active' as const, label: isTech ? 'My active jobs' : 'Active jobs', count: active.length },
    { id: 'queue' as const, label: 'Reported', count: queue.length },
    { id: 'verify' as const, label: 'Awaiting verification', count: verify.length },
    { id: 'done' as const, label: 'Done', count: done.length },
  ];

  return (
    <div>
      <PageHead
        title={isTech ? 'Your shift' : 'Technician workspace'}
        sub={`${active.length} active · ${queue.length} reported · ${verify.length} awaiting verification — from the school records. Named assignment is not available here yet; jobs advance through the flow steps.`}
        actions={<Button variant="secondary" icon={<Icon.Grid size={14} />} onClick={() => { window.location.hash = ''; }}>Refresh</Button>}
      />

      <div className="tabs" style={{ marginBottom: 14 }}>
        {tabs.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            <span className="u-faint" style={{ marginLeft: 5 }}>{t.count}</span>
          </button>
        ))}
      </div>

      {wos.loading ? (
        <div className="u-col" style={{ gap: 10 }}><SkeletonCard lines={2} /><SkeletonCard lines={2} /></div>
      ) : wos.error ? (
        <ErrorState title="Could not load your queue" sub={friendly(wos.error)} onRetry={wos.retry} />
      ) : shown.length === 0 ? (
        <Empty
          icon={<Icon.Check size={22} />}
          title={tab === 'active' ? 'Nothing in progress' : tab === 'queue' ? 'No reported jobs waiting' : tab === 'verify' ? 'Nothing awaiting verification' : 'Nothing completed yet'}
          sub="Jobs appear here as the school records change — nothing is stored on this device."
        />
      ) : (
        <div className="u-col" style={{ gap: 10 }}>
          {shown.map(wo => {
            const flowIdx = LIVE_FLOW.indexOf(wo.status);
            const next = flowIdx >= 0 && flowIdx < LIVE_FLOW.length - 1 ? LIVE_FLOW[flowIdx + 1] : null;
            const isVerify = next === 'resolved';
            const dueMins = wo.slaDue ? Math.round((wo.slaDue.getTime() - Date.now()) / 60000) : null;
            return (
              <div key={wo.id} className={`wo-card prio-${wo.priority} u-col`} style={{ gap: 10 }}>
                <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span className="u-mono u-small u-muted">{wo.code}</span>
                  <PriorityBadge p={wo.priority as MaintPriority} size="sm" />
                  <WOStatusChip s={wo.status as WOStatus} />
                  {wo.breached
                    ? <Badge tone="danger" dot>Past deadline</Badge>
                    : dueMins != null ? <Badge tone={dueMins <= 240 ? 'warning' : 'info'}>{dueMins >= 0 ? `${Math.round(dueMins / 60)}h left` : 'Due now'}</Badge> : null}
                </div>
                <span style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>{wo.title}</span>
                <span className="u-small u-muted">{wo.description || 'No description recorded.'}</span>
                <span className="u-inline u-small u-muted" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <Badge tone="outline">{wo.category}</Badge>
                  {wo.assetCode && <Badge tone="accent">{wo.assetName ?? wo.assetCode}</Badge>}
                  <span>reported {fmtRelative(wo.createdAt)}</span>
                </span>
                {wo.status !== 'closed' && wo.status !== 'cancelled' && (
                  <div className="u-col" style={{ gap: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                    {isVerify && (
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label htmlFor={`cost-${wo.id}`}>Final cost in ₹ (optional)</label>
                        <input id={`cost-${wo.id}`} className="input" inputMode="decimal" value={costRupees} onChange={e => setCostRupees(e.target.value)} placeholder="e.g. 1250" />
                      </div>
                    )}
                    <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                      {next && next !== 'resolved' && (
                        <Button size="sm" variant="primary" loading={busy === `${wo.id}:${next}`} disabled={!!busy}
                          onClick={() => transition(wo, next)}>
                          Advance → {woStatusLabel(next as WOStatus)}
                        </Button>
                      )}
                      {isVerify && (
                        <Button size="sm" variant="primary" loading={busy === `${wo.id}:resolved`} disabled={!!busy}
                          onClick={() => transition(wo, 'resolved', costRupees.trim() ? Math.round(Number.parseFloat(costRupees) * 100) : undefined)}>
                          Mark resolved
                        </Button>
                      )}
                      {next === 'closed' && (
                        <Button size="sm" variant="primary" loading={busy === `${wo.id}:closed`} disabled={!!busy}
                          onClick={() => transition(wo, 'closed')}>
                          Close job
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

