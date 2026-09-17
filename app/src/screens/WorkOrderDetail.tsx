/* ============================================================
   WorkOrderDetail — the full work-order page
   (/maintenance/work-orders/:id).
   Everything a facilities decision needs: what was understood,
   why the priority is what it is, who is on it, what the SLA
   says, what it cost, and the audit-grade timeline. Manage
   actions (assign, advance, override, verify, escalate) are
   role-gated and every one writes to the ledger.
   ============================================================ */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../state/store';
import { apiWorkOrders, apiWorkOrderStatus } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { PageHead, Card, Badge, Button, ErrorState, SkeletonCard, useToast, KeyValue } from '../components/ui';
import { Icon } from '../components/Icon';
import { PriorityBadge, WOStatusChip, woStatusLabel } from '../components/Maint';
import { fmtDateTime, fmtRelative } from '../lib/format';
import type { MaintPriority, WOStatus } from '../types/domain';

/* standard async hook (APP-SPEC pattern, local copy) */
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


export default function WorkOrderDetail() {
  return <LiveDetail />;
}

/* ============================================================
   LIVE detail — server truth only (L4-2.2).
   Reads GET /work-orders (no single-order door yet) and drives
   POST /work-orders/:id/status with the server's own state
   machine. Fields the door does not expose (assignee, timeline,
   parts, AI understanding) are stated as absent — never faked.
   ============================================================ */
const WO_FLOW = ['reported', 'assigned', 'accepted', 'en-route', 'on-site', 'repairing', 'verification', 'resolved', 'closed', 'cancelled'];

function LiveDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useStore();
  const toast = useToast();
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
      cost: r.cost_cents != null ? Number(r.cost_cents) / 100 : null,
      createdAt: new Date(String(r.created_at ?? Date.now())),
      assetCode: (r.asset_code as string) ?? null,
      assetName: (r.asset_name as string) ?? null,
      slaPolicy: res.slaPolicy?.[String(r.priority)] ?? null,
    }));
  }, []);

  const wo = (wos.data ?? []).find(w => w.id === id) ?? null;
  const canTransition = ['technician', 'facilities', 'coordinator', 'principal', 'owner'].includes(session.roleId);

  const transition = async (to: string, costCents?: number) => {
    if (!wo) return;
    setBusy(to);
    try {
      await apiWorkOrderStatus(wo.id, to, costCents);
      toast({ title: `${wo.code} → ${woStatusLabel(to as WOStatus)}`, sub: 'Recorded on the server — the work-order board reflects it immediately.', tone: 'success' });
      setCostRupees('');
      wos.retry();
    } catch (e) {
      toast({ title: 'Transition refused', sub: friendly(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (wos.loading) {
    return (
      <div className="u-col" style={{ gap: 14 }}>
        <PageHead title="Work order" back={{ to: '/maintenance/work-orders', label: 'Work-order board' }} />
        <Card pad><SkeletonCard lines={4} /></Card>
      </div>
    );
  }
  if (wos.error) {
    return (
      <>
        <PageHead title="Work order" back={{ to: '/maintenance/work-orders', label: 'Work-order board' }} />
        <ErrorState title="Could not load this work order" sub={friendly(wos.error)} onRetry={wos.retry} />
      </>
    );
  }
  if (!wo) {
    return (
      <>
        <PageHead title="Work order" back={{ to: '/maintenance/work-orders', label: 'Work-order board' }} />
        <ErrorState
          title="Work order not found"
          sub={id ? `No work order with id “${id.slice(0, 13)}…” exists on the server.` : 'Open a work order from the board.'}
        />
        <div style={{ textAlign: 'center', marginTop: 4 }}>
          <Button variant="secondary" icon={<Icon.ChevronLeft size={14} />} onClick={() => navigate('/maintenance/work-orders')}>Back to the board</Button>
        </div>
      </>
    );
  }

  const open = !['resolved', 'closed', 'cancelled'].includes(wo.status);
  const flowIdx = WO_FLOW.indexOf(wo.status);
  const next = open && flowIdx >= 0 && flowIdx < WO_FLOW.length - 1 ? WO_FLOW[flowIdx + 1] : null;
  const isResolving = next === 'resolved';
  const dueMins = wo.slaDue ? Math.round((wo.slaDue.getTime() - Date.now()) / 60000) : null;

  return (
    <div>
      <PageHead
        title={
          <span className="u-inline" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span className="u-mono" style={{ fontSize: '0.72em', color: 'var(--text-3)', fontWeight: 620 }}>{wo.code}</span>
            <span>{wo.title}</span>
          </span>
        }
        sub={`${wo.category} · created ${fmtRelative(wo.createdAt)}`}
        back={{ to: '/maintenance/work-orders', label: 'Work-order board' }}
        actions={
          <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
            <PriorityBadge p={wo.priority as MaintPriority} />
            <WOStatusChip s={wo.status as WOStatus} />
          </div>
        }
      />

      {/* ---- lifecycle (server state machine) ---- */}
      <Card style={{ marginBottom: 16 }}>
        <div className="card-body u-col" style={{ gap: 10 }}>
          <div className="u-flex u-wrap" style={{ gap: 6 }}>
            {WO_FLOW.filter(st => st !== 'cancelled').map((st, i) => {
              const done = i < flowIdx;
              const here = st === wo.status;
              return (
                <span key={st} className="u-inline" style={{ gap: 5 }}>
                  <Badge tone={here ? 'accent' : done ? 'success' : 'outline'} dot={here}>{woStatusLabel(st as WOStatus)}</Badge>
                  {i < WO_FLOW.length - 2 && <span className="u-faint u-xs">→</span>}
                </span>
              );
            })}
          </div>
          {wo.status === 'cancelled' && <Badge tone="danger" dot>Cancelled</Badge>}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 430px), 1fr))', gap: 16, alignItems: 'start' }}>
        <div className="u-col" style={{ gap: 16 }}>
          <Card>
            <div className="card-head"><h3>Reported issue</h3><span className="u-small u-faint">{fmtDateTime(wo.createdAt)}</span></div>
            <div className="card-body u-col" style={{ gap: 12 }}>
              <p style={{ margin: 0, lineHeight: 1.65 }}>{wo.description || 'No description recorded.'}</p>
              <div className="divider" />
              <KeyValue
                cols={1}
                items={[
                  { k: 'Category', v: wo.category },
                  { k: 'Asset', v: wo.assetCode ? `${wo.assetName ?? ''} (${wo.assetCode})`.trim() : 'None linked — general facilities work' },
                  { k: 'Cost recorded', v: wo.cost != null ? `₹${wo.cost.toLocaleString('en-IN')}` : '—' },
                  {
                    k: 'SLA', v: wo.slaDue
                      ? (wo.breached
                        ? <Badge tone="danger" dot>Breached{dueMins != null && dueMins < 0 ? ` ${Math.abs(dueMins)}m ago` : ''}</Badge>
                        : <span className="u-inline" style={{ gap: 8 }}><Badge tone={dueMins != null && dueMins <= 240 ? 'warning' : 'info'} dot>{dueMins != null && dueMins >= 0 ? `${Math.round(dueMins / 60)}h left` : 'Due now'}</Badge><span className="u-small u-muted">due {fmtDateTime(wo.slaDue)}</span></span>)
                      : 'No SLA window on the record',
                  },
                  ...(wo.slaPolicy ? [{ k: 'Policy for this priority', v: `respond ${wo.slaPolicy.responseMins} min · resolve ${wo.slaPolicy.resolveHours}h` }] : []),
                ]}
              />
            </div>
          </Card>

          <Card>
            <div className="card-head"><h3>On the record</h3></div>
            <div className="card-body u-col" style={{ gap: 8 }}>
              <span className="u-small u-muted">Timeline events, technician assignment and parts used are written server-side but not exposed by the work-order read door yet — they appear here the moment the door returns them.</span>
            </div>
          </Card>
        </div>

        <div className="u-col" style={{ gap: 16 }}>
          <Card>
            <div className="card-head"><h3>Advance this job</h3><span className="u-small u-faint">server state machine</span></div>
            <div className="card-body u-col" style={{ gap: 12 }}>
              {!canTransition ? (
                <span className="u-small u-muted">Transitions are done by technicians, facilities, the coordinator, the principal or the owner — your role can view this job.</span>
              ) : !open ? (
                <span className="u-small u-muted">This job is {wo.status} — no further transitions.</span>
              ) : (
                <>
                  {isResolving && (
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label htmlFor="wo-cost">Final cost in ₹ (optional)</label>
                      <input id="wo-cost" className="input" inputMode="decimal" value={costRupees} onChange={e => setCostRupees(e.target.value)} placeholder="e.g. 1250" />
                      <span className="hint">Recorded on the ledger when the job is resolved.</span>
                    </div>
                  )}
                  <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {next && next !== 'resolved' && next !== 'closed' && (
                      <Button variant="primary" icon={<Icon.ArrowRight size={14} />} loading={busy === next} disabled={!!busy}
                        onClick={() => transition(next)}>
                        {next === 'assigned' ? 'Mark assigned' : next === 'accepted' ? 'Accept' : next === 'en-route' ? 'En route' : next === 'on-site' ? 'On site' : next === 'repairing' ? 'Start repair' : 'Request verification'}
                      </Button>
                    )}
                    {isResolving && (
                      <Button variant="primary" icon={<Icon.Check size={14} />} loading={busy === 'resolved'} disabled={!!busy}
                        onClick={() => transition('resolved', costRupees.trim() ? Math.round(Number.parseFloat(costRupees) * 100) : undefined)}>
                        Mark resolved
                      </Button>
                    )}
                    {next === 'closed' && (
                      <Button variant="primary" icon={<Icon.Check size={14} />} loading={busy === 'closed'} disabled={!!busy}
                        onClick={() => transition('closed')}>
                        Close work order
                      </Button>
                    )}
                    {wo.status === 'reported' && (
                      <Button variant="ghost" icon={<Icon.X size={14} />} loading={busy === 'cancelled'} disabled={!!busy}
                        onClick={() => transition('cancelled')}>
                        Cancel
                      </Button>
                    )}
                  </div>
                  <span className="u-xs u-faint">Transitions must follow the flow (reported → … → closed); the server refuses skips with an honest error. Cancel is allowed only while reported.</span>
                </>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

