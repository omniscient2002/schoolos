/* ============================================================
   WorkOrders — the maintenance board (/maintenance/work-orders).
   One live surface over domain.workOrders: header stats, filter
   row, and two view modes — a dense List and a stage Board.
   Emergency/critical jobs carry the shared `.wo-card prio-*`
   border so they read first in every view.
   ============================================================ */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import * as m from '../data/dataset';
import { PageHead, Section, Card, Stat, Badge, Button, Empty, Avatar, Tabs } from '../components/ui';
import { Icon } from '../components/Icon';
import { PriorityBadge, WOStatusChip, woStatusLabel, SLAIndicator, AssetTag } from '../components/Maint';
import type { CampusId, MaintPriority, WOCategory, WOStatus, WorkOrderRecord } from '../types/domain';

const PRIO_RANK: Record<string, number> = { emergency: 0, critical: 1, high: 2, medium: 3, low: 4 };
const OPEN_STATES: WOStatus[] = ['reported', 'assigned', 'accepted', 'en-route', 'on-site', 'repairing', 'verification'];
const STAGE_OPTIONS: WOStatus[] = ['reported', 'assigned', 'accepted', 'en-route', 'on-site', 'repairing', 'verification', 'resolved', 'closed', 'cancelled'];
const CATEGORIES: WOCategory[] = ['HVAC', 'AV', 'Electrical', 'Plumbing', 'Civil', 'Safety', 'Lab', 'Cleanliness'];
const PRIORITIES: MaintPriority[] = ['emergency', 'critical', 'high', 'medium', 'low'];

const BOARD_COLS: { id: string; label: string; statuses: WOStatus[] }[] = [
  { id: 'reported', label: 'Reported', statuses: ['reported'] },
  { id: 'assigned', label: 'Assigned', statuses: ['assigned', 'accepted'] },
  { id: 'onsite', label: 'On site', statuses: ['en-route', 'on-site'] },
  { id: 'repairing', label: 'Repairing', statuses: ['repairing'] },
  { id: 'verification', label: 'Verification', statuses: ['verification'] },
];

const UNASSIGNED = '__unassigned__';

const ageOf = (d: Date) => {
  const mins = Math.max(1, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
};

/* ---------- one list row (click-through to the detail page) ---------- */
function WORow({ wo }: { wo: WorkOrderRecord }) {
  const sla = m.slaState(wo);
  const active = OPEN_STATES.includes(wo.status);
  return (
    <Link to={`/maintenance/work-orders/${wo.id}`} className={`wo-card prio-${wo.priority} u-col`} style={{ gap: 6 }}>
      <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="u-mono" style={{ fontSize: 11.5, fontWeight: 640, color: 'var(--text-3)' }}>{wo.id}</span>
        <PriorityBadge p={wo.priority} size="sm" />
        <WOStatusChip s={wo.status} />
        {active && <SLAIndicator sla={sla} breach size="sm" />}
        <span className="u-mono u-small u-muted" style={{ marginLeft: 'auto' }} title={`Reported ${wo.reportedOn.toLocaleString()}`}>{ageOf(wo.reportedOn)}</span>
      </div>
      <span style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>{wo.title}</span>
      <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
        {wo.assetId ? <AssetTag id={wo.assetId} /> : <Badge tone="outline">{wo.category}</Badge>}
        <span className="u-small u-muted">{wo.building}{wo.room ? ` · ${wo.room}` : ''}</span>
        <span className="u-inline u-small" style={{ gap: 6, marginLeft: 'auto' }}>
          {wo.assignedTo
            ? <><Avatar name={wo.assignedTo} size="sm" /> {wo.assignedTo}</>
            : <Badge tone="warning" dot>Unassigned</Badge>}
        </span>
      </div>
    </Link>
  );
}

/* ---------- one board card (emergency/critical get the red prio border) ---------- */
function WOBoardCard({ wo }: { wo: WorkOrderRecord }) {
  const sla = m.slaState(wo);
  const active = OPEN_STATES.includes(wo.status);
  return (
    <Link to={`/maintenance/work-orders/${wo.id}`} className={`wo-card prio-${wo.priority} u-col`} style={{ gap: 6 }}>
      <div className="u-inline" style={{ gap: 6 }}>
        <span className="u-mono u-small u-muted">{wo.id}</span>
        <span style={{ marginLeft: 'auto' }}><PriorityBadge p={wo.priority} size="sm" /></span>
      </div>
      <span className="u-small" style={{ fontWeight: 600, lineHeight: 1.4 }}>{wo.title}</span>
      <div className="u-inline" style={{ gap: 6, flexWrap: 'wrap' }}>
        {wo.assetId ? <AssetTag id={wo.assetId} /> : <Badge tone="outline">{wo.category}</Badge>}
      </div>
      <div className="u-inline u-small u-muted" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span>{wo.assignedTo ?? 'Unassigned'}</span>
        <span>·</span>
        <span className="u-mono">{ageOf(wo.reportedOn)}</span>
      </div>
      {active && <SLAIndicator sla={sla} breach size="sm" />}
    </Link>
  );
}

export default function WorkOrders() {
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

  /* live source — domain.workOrders, scoped to the active campus */
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
          if (tech === UNASSIGNED && w.assignedTo) return false;
          if (tech !== UNASSIGNED && w.assignedTo !== tech) return false;
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

  return (
    <div>
      <PageHead
        title="Work-order board"
        sub={`${open.length} open · ${emergencies} emergency/critical · ${slaRisk} at SLA risk — ${(scope as CampusId | 'all') === 'all' ? 'all campuses' : scope + ' campus'}`}
        actions={
          <div className="u-inline" style={{ gap: 8 }}>
            <Button variant="secondary" icon={<Icon.User size={14} />} onClick={() => navigate('/maintenance/technician')}>Technician view</Button>
            <Button variant="primary" icon={<Icon.Zap size={14} />} onClick={() => navigate('/maintenance/report')}>Report issue</Button>
          </div>
        }
      />

      {/* ---- header stats ---- */}
      <div className="grid grid-4" style={{ marginBottom: 'var(--s-5)' }}>
        <Stat label="Open jobs" value={open.length} sub={`${campusWos.length} total in scope`} onClick={() => { setView('list'); setStatus('open'); }} />
        <Stat label="Emergency / critical" value={emergencies} sub="safety and hygiene rules auto-escalate" />
        <Stat label="Deadline soon" value={slaRisk} sub="response or resolution window closing" />
        <Stat label="Avg resolution" value={resolvedWos.length ? `${avgHrs.toFixed(1)}h` : '—'} sub="reported → completed, resolved jobs" />
      </div>

      {/* ---- filters ---- */}
      <Card style={{ marginBottom: 16 }}>
        <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="searchbox" style={{ flex: '1 1 210px', maxWidth: 320 }}>
            <Icon.Search size={14} />
            <input className="input" placeholder="Search id, title, asset, room, reporter…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search work orders" />
          </div>
          <select className="input" value={status} onChange={e => setStatus(e.target.value as 'all' | 'open' | WOStatus)} aria-label="Filter by status" style={{ maxWidth: 172 }}>
            <option value="all">All statuses</option>
            <option value="open">Open jobs</option>
            {STAGE_OPTIONS.map(s => <option key={s} value={s}>{woStatusLabel(s)}</option>)}
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
            <option value={UNASSIGNED}>Unassigned</option>
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

      {/* ---- view modes ---- */}
      <Tabs
        pill
        tabs={[{ id: 'list', label: 'List' }, { id: 'board', label: 'Board' }]}
        active={view}
        onChange={setView}
      />

      {view === 'list' && (
        <Section
          title="Work orders"
          sub={`${filtered.length} of ${campusWos.length} in scope · ranked by priority, then SLA deadline · click a row to open`}
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
      )}

      {view === 'board' && (
        <Section
          title="Flow board"
          sub={`${filtered.length} active job${filtered.length === 1 ? '' : 's'} across the lifecycle · scroll sideways on mobile · click a card to open`}
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
