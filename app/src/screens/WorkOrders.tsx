/* ============================================================
   WorkOrders — the maintenance board (/maintenance/work-orders).
   L4-2.2: the live build reads the real door (GET /work-orders)
   and transitions run POST /work-orders/:id/status (server state
   machine). The door does not expose assignment, reporter,
   building/room or resolved_at — those columns are absent here,
   never invented.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiWorkOrderStatus, apiWorkOrders } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { PageHead, Section, Card, Stat, Badge, Button, Empty, Tabs, SkeletonCard, ErrorState } from '../components/ui';
import { Icon } from '../components/Icon';
import { PriorityBadge, WOStatusChip, woStatusLabel } from '../components/Maint';
import { statusLabel } from '../lib/labels';
import { useRoleOrGrant } from '../lib/access';
import { useToast } from '../components/ui';
import type { MaintPriority, WOStatus } from '../types/domain';

const PRIO_RANK: Record<string, number> = { emergency: 0, critical: 1, high: 2, medium: 3, low: 4 };
/* G-4 · the ONE state machine, mirroring the server's WO_FLOW and its single extra edge
   (reported → cancelled). The board offers the next step the door actually permits, so moving a job
   forward never needs a detour through the detail route — which is what the run had to do. */
const WO_NEXT: Record<string, string> = {
  reported: 'assigned', assigned: 'accepted', accepted: 'en-route', 'en-route': 'on-site',
  'on-site': 'repairing', repairing: 'verification', verification: 'resolved', resolved: 'closed',
};
const OPEN_STATES: string[] = ['reported', 'assigned', 'accepted', 'en-route', 'on-site', 'repairing', 'verification'];
const STAGE_OPTIONS: string[] = ['reported', 'assigned', 'accepted', 'en-route', 'on-site', 'repairing', 'verification', 'resolved', 'closed', 'cancelled'];
const PRIORITIES: string[] = ['emergency', 'critical', 'high', 'medium', 'low'];

const BOARD_COLS: { id: string; label: string; statuses: string[] }[] = [
  { id: 'reported', label: 'Reported', statuses: ['reported'] },
  { id: 'assigned', label: 'Assigned', statuses: ['assigned', 'accepted'] },
  { id: 'onsite', label: 'On site', statuses: ['en-route', 'on-site'] },
  { id: 'repairing', label: 'Repairing', statuses: ['repairing'] },
  { id: 'verification', label: 'Verification', statuses: ['verification'] },
];

/* server row → the fields this board actually has */
export interface WoRow {
  id: string;
  code: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  slaDue: Date | null;
  breached: boolean;
  cost: number | null;
  createdAt: Date;
  assetCode: string | null;
  assetName: string | null;
}
export const mapWo = (r: Record<string, unknown>): WoRow => ({
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
});

const ageOf = (d: Date) => {
  const mins = Math.max(1, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
};

/* SLA display straight from server truth: breach flag + time left */
function SlaChip({ row }: { row: WoRow }) {
  if (!OPEN_STATES.includes(row.status)) return null;
  if (!row.slaDue) return <Badge tone="outline">No deadline</Badge>;
  if (row.breached) return <Badge tone="danger" dot>Past deadline</Badge>;
  const minsLeft = Math.round((row.slaDue.getTime() - Date.now()) / 60000);
  const tone = minsLeft <= 60 ? 'danger' : minsLeft <= 240 ? 'warning' : 'info';
  return <Badge tone={tone} dot>{minsLeft <= 0 ? 'Due now' : minsLeft < 60 ? `${minsLeft}m left` : `${Math.round(minsLeft / 60)}h left`}</Badge>;
}

function WORow({ wo }: { wo: WoRow }) {
  return (
    <Link to={`/maintenance/work-orders/${wo.id}`} className={`wo-card prio-${wo.priority} u-col`} style={{ gap: 6 }}>
      <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="u-mono" style={{ fontSize: 11.5, fontWeight: 640, color: 'var(--text-3)' }}>{wo.code}</span>
        <PriorityBadge p={wo.priority as MaintPriority} size="sm" />
        <WOStatusChip s={wo.status as WOStatus} />
        <SlaChip row={wo} />
        <span className="u-mono u-small u-muted" style={{ marginLeft: 'auto' }} title={`Created ${wo.createdAt.toLocaleString()}`}>{ageOf(wo.createdAt)}</span>
      </div>
      <span style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>{wo.title}</span>
      <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
        {wo.assetCode ? <Badge tone="accent">{wo.assetName ?? wo.assetCode}</Badge> : <Badge tone="outline">{wo.category}</Badge>}
        <span className="u-small u-muted" style={{ marginLeft: 'auto' }}>
          {wo.cost != null ? <span className="tnum">₹{wo.cost.toLocaleString('en-IN')}</span> : null}
        </span>
      </div>
    </Link>
  );
}

function WOBoardCard({ wo, onAdvance, busy }: { wo: WoRow; onAdvance?: (wo: WoRow, to: string) => void; busy?: boolean }) {
  const next = WO_NEXT[wo.status];
  return (
    <div className={`wo-card prio-${wo.priority} u-col`} style={{ gap: 6 }}>
      <Link to={`/maintenance/work-orders/${wo.id}`} className="u-col" style={{ gap: 6, textDecoration: 'none', color: 'inherit' }}>
        <div className="u-inline" style={{ gap: 6 }}>
          <span className="u-mono u-small u-muted">{wo.code}</span>
          <span style={{ marginLeft: 'auto' }}><PriorityBadge p={wo.priority as MaintPriority} size="sm" /></span>
        </div>
        <span className="u-small" style={{ fontWeight: 600, lineHeight: 1.4 }}>{wo.title}</span>
        <div className="u-inline" style={{ gap: 6, flexWrap: 'wrap' }}>
          {wo.assetCode ? <Badge tone="accent">{wo.assetName ?? wo.assetCode}</Badge> : <Badge tone="outline">{wo.category}</Badge>}
        </div>
        <div className="u-inline u-small u-muted" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="u-mono">{ageOf(wo.createdAt)}</span>
        </div>
        <SlaChip row={wo} />
      </Link>
      {onAdvance && next && (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAdvance(wo, next)}
          title={`Move to ${woStatusLabel(next as WOStatus)}`}>
          {busy ? 'Moving…' : `Advance to ${woStatusLabel(next as WOStatus)}`}
        </Button>
      )}
    </div>
  );
}

/* local async hook */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => { if (live) setState({ data: d, loading: false, error: null }); })
      .catch(e => { if (live) setState({ data: null, loading: false, error: String(e) }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

/* ================= live board (real door) ================= */
function LiveBoard() {
  const navigate = useNavigate();
  const toast = useToast();
  /* G-4: the transition door's own gate — technician, facilities, coordinator, principal, owner. */
  const canTransition = useRoleOrGrant(['technician', 'facilities', 'coordinator', 'principal', 'owner'], ['POST /work-orders/:id/status']);
  const [moving, setMoving] = useState<string | null>(null);
  const [view, setView] = useState('list');
  const [status, setStatus] = useState('all');
  const [priority, setPriority] = useState('all');
  const [q, setQ] = useState('');

  const wos = useAsync(async () => {
    const res = await apiWorkOrders();
    return (res.workOrders ?? []).map(mapWo);
  }, []);

  const rows = wos.data ?? [];
  const open = useMemo(() => rows.filter(w => OPEN_STATES.includes(w.status)), [rows]);
  const emergencies = open.filter(w => w.priority === 'emergency' || w.priority === 'critical').length;
  const slaRisk = open.filter(w => w.breached || (w.slaDue && w.slaDue.getTime() - Date.now() < 4 * 3600_000)).length;
  const resolvedCount = rows.filter(w => ['resolved', 'closed'].includes(w.status)).length;

  const filtersActive = q.trim() !== '' || status !== 'all' || priority !== 'all';
  const clearFilters = () => { setQ(''); setStatus('all'); setPriority('all'); };

  /* G-4 · the board row advances the job itself. The server enforces the same state machine (WO_FLOW
     plus reported → cancelled), so a step it refuses is refused here too — the toast shows the server's
     own wording rather than a client-side guess at what is allowed. */
  const advance = async (wo: WoRow, to: string) => {
    setMoving(wo.id);
    try {
      await apiWorkOrderStatus(wo.id, to);
      toast({ title: `${wo.code} → ${woStatusLabel(to as WOStatus)}`, sub: 'Recorded on the job with your name.', tone: 'success' });
      wos.retry();
    } catch (e) {
      toast({ title: 'Could not move the job', sub: friendly(e), tone: 'error' });
    } finally { setMoving(null); }
  };

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows
      .filter(w => {
        if (status === 'open' && !OPEN_STATES.includes(w.status)) return false;
        if (status !== 'all' && status !== 'open' && w.status !== status) return false;
        if (priority !== 'all' && w.priority !== priority) return false;
        if (query) {
          const hay = `${w.code} ${w.title} ${w.description} ${w.assetCode ?? ''} ${w.assetName ?? ''} ${w.category}`.toLowerCase();
          if (!hay.includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) =>
        (OPEN_STATES.includes(a.status) ? 0 : 1) - (OPEN_STATES.includes(b.status) ? 0 : 1) ||
        (PRIO_RANK[a.priority] ?? 9) - (PRIO_RANK[b.priority] ?? 9) ||
        (a.slaDue?.getTime() ?? Infinity) - (b.slaDue?.getTime() ?? Infinity));
  }, [rows, status, priority, q]);

  return (
    <div>
      <PageHead
        title="Work-order board"
        sub={`${open.length} open · ${emergencies} emergency/critical · ${slaRisk} at deadline risk — straight from the school records`}
        actions={
          <div className="u-inline" style={{ gap: 8 }}>
            <Button variant="secondary" icon={<Icon.User size={14} />} onClick={() => navigate('/maintenance/technician')}>Technician view</Button>
            <Button variant="primary" icon={<Icon.Zap size={14} />} onClick={() => navigate('/maintenance/report')}>Report issue</Button>
          </div>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 'var(--s-5)' }}>
        <Stat label="Open jobs" value={open.length} sub={`${rows.length} in total`} onClick={() => { setView('list'); setStatus('open'); }} />
        <Stat label="Emergency / critical" value={emergencies} sub="safety and hygiene rules auto-escalate" />
        <Stat label="Deadline soon" value={slaRisk} sub="breached or closing within 4 hours" />
        <Stat label="Resolved + closed" value={resolvedCount} sub="completed jobs in the school records" />
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="searchbox" style={{ flex: '1 1 210px', maxWidth: 320 }}>
            <Icon.Search size={14} />
            <input className="input" placeholder="Search code, title, asset, category…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search jobs" />
          </div>
          <select className="input" value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status" style={{ maxWidth: 172 }}>
            <option value="all">All statuses</option>
            <option value="open">Open jobs</option>
            {STAGE_OPTIONS.map(s => <option key={s} value={s}>{woStatusLabel(s as WOStatus)}</option>)}
          </select>
          <select className="input" value={priority} onChange={e => setPriority(e.target.value)} aria-label="Filter by priority" style={{ maxWidth: 140 }}>
            <option value="all">All priorities</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{statusLabel(p)}</option>)}
          </select>
          {filtersActive && (
            <Button size="sm" variant="ghost" icon={<Icon.Filter size={13} />} onClick={clearFilters}>Clear filters</Button>
          )}
        </div>
      </Card>

      <Tabs pill tabs={[{ id: 'list', label: 'List' }, { id: 'board', label: 'Board' }]} active={view} onChange={setView} />

      {wos.loading ? (
        <div className="u-col" style={{ gap: 10, marginTop: 16 }}>
          <SkeletonCard lines={2} /><SkeletonCard lines={2} /><SkeletonCard lines={2} />
        </div>
      ) : wos.error ? (
        <div style={{ marginTop: 16 }}>
          <ErrorState title="Could not load the work-order board" sub={friendly(wos.error)} onRetry={wos.retry} />
        </div>
      ) : view === 'list' ? (
        <Section
          title="Work orders"
          sub={`${filtered.length} of ${rows.length} on the record · ranked by priority, then deadline · click a row to open`}
          style={{ marginTop: 'var(--s-4)' }}
        >
          <div className="u-col" style={{ gap: 8 }}>
            {filtered.map(wo => <WORow key={wo.id} wo={wo} />)}
            {filtered.length === 0 && (
              <Empty
                icon={<Icon.Search size={22} />}
                title="No jobs match these filters"
                sub="Try widening the status or priority filter — or clear everything and start again."
                action={<Button variant="secondary" icon={<Icon.Filter size={14} />} onClick={clearFilters}>Clear filters</Button>}
              />
            )}
          </div>
        </Section>
      ) : (
        <Section
          title="Flow board"
          sub={canTransition
            ? `${filtered.length} active job${filtered.length === 1 ? '' : 's'} across the lifecycle · each card advances the job one step`
            : `${filtered.length} active job${filtered.length === 1 ? '' : 's'} across the lifecycle · moving a job along is the technician's or office's call`}
          style={{ marginTop: 'var(--s-4)' }}
        >
          <div
            style={{
              display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(236px, 1fr)',
              gap: 12, overflowX: 'auto', alignItems: 'start', paddingBottom: 8,
            }}
          >
            {BOARD_COLS.map(col => {
              const items = filtered.filter(w => col.statuses.includes(w.status));
              return (
                <div key={col.id} className="u-col" style={{ gap: 8, minWidth: 0 }}>
                  <div className="u-inline" style={{ gap: 7 }}>
                    <span style={{ fontWeight: 620, fontSize: 'var(--text-sm)' }}>{col.label}</span>
                    <Badge tone={items.length ? 'info' : 'neutral'}>{items.length}</Badge>
                  </div>
                  {items.map(wo => (
                    <WOBoardCard key={wo.id} wo={wo}
                      onAdvance={canTransition ? advance : undefined}
                      busy={moving === wo.id} />
                  ))}
                  {items.length === 0 && (
                    <div className="u-small u-muted" style={{ border: '1px dashed var(--border)', borderRadius: 'var(--r-md)', padding: '16px 10px', textAlign: 'center' }}>
                      Nothing here
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="u-small u-muted" style={{ margin: '8px 0 0' }}>
            Resolved and closed work is archived from the board — switch to List view and filter by status to see it.
          </p>
        </Section>
      )}
    </div>
  );
}


export default function WorkOrders() {
  return <LiveBoard />;
}
