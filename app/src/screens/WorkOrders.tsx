/* ============================================================
   WorkOrders — the maintenance board (/maintenance/work-orders).
   L4-2.2: the live build reads the real door (GET /work-orders)
   and transitions run POST /work-orders/:id/status (server state
   machine). The door does not expose assignment, reporter,
   building/room or resolved_at — those columns are absent here,
   never invented. The demo build keeps the hydrated domain store.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import * as m from '../data/dataset';
import { apiWorkOrders } from '../services/liveApi';
import { DEMO_MODE } from '../lib/demoMode';
import { friendly } from '../lib/friendlyErrors';
import { PageHead, Section, Card, Stat, Badge, Button, Empty, Tabs, SkeletonCard, ErrorState } from '../components/ui';
import { Icon } from '../components/Icon';
import { PriorityBadge, WOStatusChip, woStatusLabel, SLAIndicator } from '../components/Maint';
import type { CampusId, MaintPriority, WOCategory, WOStatus, WorkOrderRecord } from '../types/domain';

const PRIO_RANK: Record<string, number> = { emergency: 0, critical: 1, high: 2, medium: 3, low: 4 };
const OPEN_STATES: string[] = ['reported', 'assigned', 'accepted', 'en-route', 'on-site', 'repairing', 'verification'];
const STAGE_OPTIONS: string[] = ['reported', 'assigned', 'accepted', 'en-route', 'on-site', 'repairing', 'verification', 'resolved', 'closed', 'cancelled'];
const CATEGORIES: string[] = ['HVAC', 'AV', 'Electrical', 'Plumbing', 'Civil', 'Safety', 'Lab', 'Cleanliness'];
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
  if (!row.slaDue) return <Badge tone="outline">No SLA window</Badge>;
  if (row.breached) return <Badge tone="danger" dot>SLA breached</Badge>;
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

function WOBoardCard({ wo }: { wo: WoRow }) {
  return (
    <Link to={`/maintenance/work-orders/${wo.id}`} className={`wo-card prio-${wo.priority} u-col`} style={{ gap: 6 }}>
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
        sub={`${open.length} open · ${emergencies} emergency/critical · ${slaRisk} at SLA risk — straight from the maintenance ledger`}
        actions={
          <div className="u-inline" style={{ gap: 8 }}>
            <Button variant="secondary" icon={<Icon.User size={14} />} onClick={() => navigate('/maintenance/technician')}>Technician view</Button>
            <Button variant="primary" icon={<Icon.Zap size={14} />} onClick={() => navigate('/maintenance/report')}>Report issue</Button>
          </div>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 'var(--s-5)' }}>
        <Stat label="Open jobs" value={open.length} sub={`${rows.length} total on the server`} onClick={() => { setView('list'); setStatus('open'); }} />
        <Stat label="Emergency / critical" value={emergencies} sub="safety and hygiene rules auto-escalate" />
        <Stat label="Deadline soon" value={slaRisk} sub="breached or closing within 4 hours" />
        <Stat label="Resolved + closed" value={resolvedCount} sub="completed jobs on the ledger" />
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="searchbox" style={{ flex: '1 1 210px', maxWidth: 320 }}>
            <Icon.Search size={14} />
            <input className="input" placeholder="Search code, title, asset, category…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search work orders" />
          </div>
          <select className="input" value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status" style={{ maxWidth: 172 }}>
            <option value="all">All statuses</option>
            <option value="open">Open jobs</option>
            {STAGE_OPTIONS.map(s => <option key={s} value={s}>{woStatusLabel(s as WOStatus)}</option>)}
          </select>
          <select className="input" value={priority} onChange={e => setPriority(e.target.value)} aria-label="Filter by priority" style={{ maxWidth: 140 }}>
            <option value="all">All priorities</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
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
          sub={`${filtered.length} of ${rows.length} on the server · ranked by priority, then SLA deadline · click a row to open`}
          style={{ marginTop: 'var(--s-4)' }}
        >
          <div className="u-col" style={{ gap: 8 }}>
            {filtered.map(wo => <WORow key={wo.id} wo={wo} />)}
            {filtered.length === 0 && (
              <Empty
                icon={<Icon.Search size={22} />}
                title="No work orders match these filters"
                sub="Try widening the status or priority filter — or clear everything and start again."
                action={<Button variant="secondary" icon={<Icon.Filter size={14} />} onClick={clearFilters}>Clear filters</Button>}
              />
            )}
          </div>
        </Section>
      ) : (
        <Section
          title="Flow board"
          sub={`${filtered.length} active job${filtered.length === 1 ? '' : 's'} across the lifecycle · transitions advance on each job's page`}
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
                  {items.map(wo => <WOBoardCard key={wo.id} wo={wo} />)}
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

/* ================= demo board (hydrated domain store) ================= */
function DemoBoard() {
  const navigate = useNavigate();
  const { session, domain, actorName } = useStore();
  const scope = session.activeCampus;
  const isTech = session.roleId === 'technician';

  const [view, setView] = useState('list');
  const [status, setStatus] = useState<'all' | 'open' | WOStatus>('all');
  const [priority, setPriority] = useState<'all' | MaintPriority>('all');
  const [category, setCategory] = useState<'all' | WOCategory>('all');
  const [tech, setTech] = useState<string>('all');
  const [q, setQ] = useState('');
  const [mineOnly, setMineOnly] = useState(false);

  const campusWos = useMemo(
    () => domain.workOrders.filter(w => (scope as CampusId | 'all') === 'all' || w.campus === scope),
    [domain.workOrders, scope],
  );
  const open = useMemo(() => campusWos.filter(w => OPEN_STATES.includes(w.status)), [campusWos]);
  const emergencies = open.filter(w => w.priority === 'emergency' || w.priority === 'critical').length;
  const slaRisk = open.filter(w => { const s = m.slaState(w); return s.tone === 'danger' || s.tone === 'warning'; }).length;
  const resolvedWos = campusWos.filter(w => ['resolved', 'closed'].includes(w.status) && w.completedOn);
  const avgHrs = resolvedWos.length
    ? resolvedWos.reduce((a, w) => a + ((w.completedOn?.getTime() ?? w.reportedOn.getTime()) - w.reportedOn.getTime()) / 3600000, 0) / resolvedWos.length
    : 0;

  const technicians = m.technicians.filter(t => (scope as CampusId | 'all') === 'all' || t.campus === scope);

  const filtersActive = q.trim() !== '' || status !== 'all' || priority !== 'all' || category !== 'all' || tech !== 'all' || mineOnly;
  const clearFilters = () => { setQ(''); setStatus('all'); setPriority('all'); setCategory('all'); setTech('all'); setMineOnly(false); };

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return campusWos
      .filter(w => {
        if (mineOnly && w.assignedTo !== actorName) return false;
        if (status === 'open' && !OPEN_STATES.includes(w.status)) return false;
        if (status !== 'all' && status !== 'open' && w.status !== status) return false;
        if (priority !== 'all' && w.priority !== priority) return false;
        if (category !== 'all' && w.category !== category) return false;
        if (tech !== 'all') {
          if (tech === '__unassigned__' && w.assignedTo) return false;
          if (tech !== '__unassigned__' && w.assignedTo !== tech) return false;
        }
        if (query) {
          const hay = `${w.id} ${w.title} ${w.description} ${w.assetId ?? ''} ${w.building} ${w.room ?? ''} ${w.reportedBy} ${w.assignedTo ?? ''} ${w.category}`.toLowerCase();
          if (!hay.includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) =>
        (OPEN_STATES.includes(a.status) ? 0 : 1) - (OPEN_STATES.includes(b.status) ? 0 : 1) ||
        (PRIO_RANK[a.priority] ?? 9) - (PRIO_RANK[b.priority] ?? 9) ||
        a.sla.resolveBy.getTime() - b.sla.resolveBy.getTime());
  }, [campusWos, mineOnly, actorName, status, priority, category, tech, q]);

  const DemoRow = ({ wo }: { wo: WorkOrderRecord }) => {
    const sla = m.slaState(wo);
    const active = OPEN_STATES.includes(wo.status);
    return (
      <Link to={`/maintenance/work-orders/${wo.id}`} className={`wo-card prio-${wo.priority} u-col`} style={{ gap: 6 }}>
        <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="u-mono" style={{ fontSize: 11.5, fontWeight: 640, color: 'var(--text-3)' }}>{wo.id}</span>
          <PriorityBadge p={wo.priority} size="sm" />
          <WOStatusChip s={wo.status as WOStatus} />
          {active && <SLAIndicator sla={sla} breach size="sm" />}
          <span className="u-mono u-small u-muted" style={{ marginLeft: 'auto' }}>{ageOf(wo.reportedOn)}</span>
        </div>
        <span style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>{wo.title}</span>
        <div className="u-inline u-small u-muted" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Badge tone="outline">{wo.category}</Badge>
          <span>{wo.building}{wo.room ? ` · ${wo.room}` : ''}</span>
          <span style={{ marginLeft: 'auto' }}>{wo.assignedTo ?? 'Unassigned'}</span>
        </div>
      </Link>
    );
  };

  return (
    <div>
      <PageHead
        title="Work-order board"
        sub={`${open.length} open · ${emergencies} emergency/critical · ${slaRisk} at SLA risk — demo world`}
        actions={
          <div className="u-inline" style={{ gap: 8 }}>
            <Button variant="secondary" icon={<Icon.User size={14} />} onClick={() => navigate('/maintenance/technician')}>Technician view</Button>
            <Button variant="primary" icon={<Icon.Zap size={14} />} onClick={() => navigate('/maintenance/report')}>Report issue</Button>
          </div>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 'var(--s-5)' }}>
        <Stat label="Open jobs" value={open.length} sub={`${campusWos.length} total in scope`} onClick={() => { setView('list'); setStatus('open'); }} />
        <Stat label="Emergency / critical" value={emergencies} sub="safety and hygiene rules auto-escalate" />
        <Stat label="Deadline soon" value={slaRisk} sub="response or resolution window closing" />
        <Stat label="Avg resolution" value={resolvedWos.length ? `${avgHrs.toFixed(1)}h` : '—'} sub="reported → completed, resolved jobs" />
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="searchbox" style={{ flex: '1 1 210px', maxWidth: 320 }}>
            <Icon.Search size={14} />
            <input className="input" placeholder="Search id, title, asset, room, reporter…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search work orders" />
          </div>
          <select className="input" value={status} onChange={e => setStatus(e.target.value as 'all' | 'open' | WOStatus)} aria-label="Filter by status" style={{ maxWidth: 172 }}>
            <option value="all">All statuses</option>
            <option value="open">Open jobs</option>
            {STAGE_OPTIONS.map(s => <option key={s} value={s}>{woStatusLabel(s as WOStatus)}</option>)}
          </select>
          <select className="input" value={priority} onChange={e => setPriority(e.target.value as 'all' | MaintPriority)} aria-label="Filter by priority" style={{ maxWidth: 140 }}>
            <option value="all">All priorities</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
          </select>
          <select className="input" value={category} onChange={e => setCategory(e.target.value as 'all' | WOCategory)} aria-label="Filter by category" style={{ maxWidth: 148 }}>
            <option value="all">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input" value={tech} onChange={e => setTech(e.target.value)} aria-label="Filter by technician" style={{ maxWidth: 176 }}>
            <option value="all">All technicians</option>
            <option value="__unassigned__">Unassigned</option>
            {technicians.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
          {isTech && (
            <Button size="sm" variant={mineOnly ? 'primary' : 'secondary'} icon={<Icon.User size={13} />} onClick={() => setMineOnly(v => !v)}>
              My jobs
            </Button>
          )}
          {filtersActive && (
            <Button size="sm" variant="ghost" icon={<Icon.Filter size={13} />} onClick={clearFilters}>Clear filters</Button>
          )}
        </div>
      </Card>

      <Tabs pill tabs={[{ id: 'list', label: 'List' }, { id: 'board', label: 'Board' }]} active={view} onChange={setView} />

      {view === 'list' ? (
        <Section title="Work orders" sub={`${filtered.length} of ${campusWos.length} in scope · demo data`} style={{ marginTop: 'var(--s-4)' }}>
          <div className="u-col" style={{ gap: 8 }}>
            {filtered.map(wo => <DemoRow key={wo.id} wo={wo} />)}
            {filtered.length === 0 && (
              <Empty icon={<Icon.Search size={22} />} title="No work orders match these filters"
                action={<Button variant="secondary" icon={<Icon.Filter size={14} />} onClick={clearFilters}>Clear filters</Button>} />
            )}
          </div>
        </Section>
      ) : (
        <Section title="Flow board" sub={`${filtered.length} active job${filtered.length === 1 ? '' : 's'} · demo data`} style={{ marginTop: 'var(--s-4)' }}>
          <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(236px, 1fr)', gap: 12, overflowX: 'auto', alignItems: 'start', paddingBottom: 8 }}>
            {BOARD_COLS.map(col => {
              const items = filtered.filter(w => col.statuses.includes(w.status));
              return (
                <div key={col.id} className="u-col" style={{ gap: 8, minWidth: 0 }}>
                  <div className="u-inline" style={{ gap: 7 }}>
                    <span style={{ fontWeight: 620, fontSize: 'var(--text-sm)' }}>{col.label}</span>
                    <Badge tone={items.length ? 'info' : 'neutral'}>{items.length}</Badge>
                  </div>
                  {items.map(wo => <DemoRow key={wo.id} wo={wo} />)}
                  {items.length === 0 && (
                    <div className="u-small u-muted" style={{ border: '1px dashed var(--border)', borderRadius: 'var(--r-md)', padding: '16px 10px', textAlign: 'center' }}>Nothing here</div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

export default function WorkOrders() {
  return DEMO_MODE ? <DemoBoard /> : <LiveBoard />;
}
