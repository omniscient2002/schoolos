/* ============================================================
   Assets — the asset registry. Every maintained thing on the
   campus, scoped to the active campus, sorted worst-health
   first. Answers: what do we own, where is it, how healthy is
   it, when is it next due for service, and how do I report on
   it from the floor (QR tag).
   ============================================================ */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { maintenanceService } from '../services';
import { apiAssets } from '../services/liveApi';
import { DEMO_MODE } from '../lib/demoMode';
import { friendly } from '../lib/friendlyErrors';
import {
  PageHead, Section, Card, Stat, Badge, DataTable, Button, Empty, ErrorState, SkeletonCard, Drawer, useToast,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { AssetTag, HealthRing, StatusDot, assetStatusLabel, QRPattern } from '../components/Maint';
import { fmtDateShort } from '../lib/format';
import type { AssetRecord, AssetStatus, CampusId } from '../types/domain';

/* ---------- standard async hook (APP-SPEC pattern, local copy) ---------- */
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

/* ---------- filter chip (pill toggle, matches tabs-pill language) ---------- */
function Chip({ active, onClick, children, danger }: { active: boolean; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        alignItems: 'center', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
        padding: '5px 12px', fontSize: 12.5, fontWeight: active ? 620 : 500,
        border: `1px solid ${active ? (danger ? 'var(--danger)' : 'var(--accent)') : 'var(--border)'}`,
        background: active ? (danger ? 'var(--danger-weak)' : 'var(--accent-weak)') : 'var(--surface)',
        color: active ? (danger ? 'var(--danger-text)' : 'var(--accent-text)') : 'var(--text-2)',
      }}
    >
      {children}
    </button>
  );
}

/* next preventive service = last service + interval (mirrors the SLA-style helpers in data/dataset) */
function nextServiceDue(a: AssetRecord): Date | null {
  if (!a.lastService || !a.serviceIntervalDays) return null;
  return new Date(a.lastService.getTime() + a.serviceIntervalDays * 86400000);
}

export default function Assets() {
  return DEMO_MODE ? <DemoAssets /> : <LiveAssets />;
}

/* ============================================================
   LIVE assets — GET /assets (server registry). Criticality,
   service history and failure timelines are not exposed by the
   door yet; those cells show what the server actually returns.
   ============================================================ */
interface LiveAsset {
  id: string; code: string; name: string; category: string;
  building: string | null; room: string | null;
  status: string; health: number; installedOn: string | null;
}

function LiveAssets() {
  const navigate = useNavigate();

  const registry = useAsync(async () => {
    const res = await apiAssets();
    return (res.assets ?? []).map((r: Record<string, unknown>): LiveAsset => ({
      id: String(r.id),
      code: String(r.code ?? ''),
      name: String(r.name ?? ''),
      category: String(r.category ?? ''),
      building: (r.building as string) ?? null,
      room: (r.room as string) ?? null,
      status: String(r.status ?? 'operational'),
      health: Number(r.health_score ?? 100),
      installedOn: (r.installed_on as string) ?? null,
    }));
  }, []);

  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [lowHealth, setLowHealth] = useState(false);
  const [query, setQuery] = useState('');

  const all = useMemo(() => registry.data ?? [], [registry.data]);
  const categories = useMemo(() => Array.from(new Set(all.map(a => a.category))).sort(), [all]);
  const statuses = useMemo(
    () => (['operational', 'watch', 'degraded', 'down', 'maintenance', 'retired'] as AssetStatus[]).filter(st => all.some(a => a.status === st)),
    [all],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter(a =>
        (category === 'all' || a.category === category) &&
        (status === 'all' || a.status === status) &&
        (!lowHealth || a.health < 60) &&
        (!q || `${a.name} ${a.code} ${a.room ?? ''} ${a.building ?? ''}`.toLowerCase().includes(q)))
      .sort((a, b) => a.health - b.health || a.code.localeCompare(b.code));
  }, [all, category, status, lowHealth, query]);

  const stats = useMemo(() => {
    const downOrDegraded = all.filter(a => a.status === 'down' || a.status === 'degraded').length;
    const watch = all.filter(a => a.status === 'watch').length;
    const avg = all.length ? Math.round(all.reduce((sum, a) => sum + a.health, 0) / all.length) : 0;
    return { total: all.length, downOrDegraded, watch, avg };
  }, [all]);

  return (
    <div>
      <PageHead
        title="Assets"
        sub="Asset registry — straight from the server (GET /assets). Criticality and service schedules are not exposed by the door yet."
        actions={
          <Button variant="secondary" icon={<Icon.Zap size={14} />} onClick={() => navigate('/maintenance/report')}>Report issue</Button>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <Stat label="Assets" value={stats.total} sub={`${categories.length} categories`} />
        <Stat label="Down / degraded" value={stats.downOrDegraded} sub="Need action now" />
        <Stat label="On watch" value={stats.watch} sub="Trending unreliable — not failing yet" />
        <Stat label="Avg health" value={`${stats.avg}/100`} sub="Across the registry" />
      </div>

      <div className="u-col" style={{ gap: 10, marginBottom: 16 }}>
        <div className="u-inline" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="u-small u-muted" style={{ marginRight: 2 }}>Category</span>
          <Chip active={category === 'all'} onClick={() => setCategory('all')}>All</Chip>
          {categories.map(c => <Chip key={c} active={category === c} onClick={() => setCategory(c)}>{c}</Chip>)}
        </div>
        <div className="u-inline" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="u-small u-muted" style={{ marginRight: 2 }}>Status</span>
          <Chip active={status === 'all'} onClick={() => setStatus('all')}>All</Chip>
          {statuses.map(st => <Chip key={st} active={status === st} onClick={() => setStatus(st)}>{assetStatusLabel(st)}</Chip>)}
          <Chip active={lowHealth} danger onClick={() => setLowHealth(v => !v)}>Health &lt; 60</Chip>
          {(category !== 'all' || status !== 'all' || lowHealth || query) && (
            <Button variant="ghost" size="sm" icon={<Icon.X size={12} />} onClick={() => { setCategory('all'); setStatus('all'); setLowHealth(false); setQuery(''); }}>
              Clear
            </Button>
          )}
        </div>
        <div className="u-inline" style={{ gap: 8 }}>
          <label htmlFor="asset-search-live" className="u-small u-muted"><Icon.Search size={13} /></label>
          <input
            id="asset-search-live"
            className="input"
            placeholder="Search by name, code or room…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ maxWidth: 300 }}
          />
        </div>
      </div>

      <Section
        title="Registry"
        sub={`${filtered.length} of ${all.length} assets shown · sorted by health, lowest first.`}
        actions={<Button size="sm" variant="ghost" icon={<Icon.Refresh size={13} />} onClick={registry.retry}>Reload</Button>}
      >
        <Card>
          {registry.loading ? (
            <div className="u-col" style={{ gap: 10, padding: 'var(--s-5)' }}><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
          ) : registry.error ? (
            <div className="card-body"><ErrorState title="Could not load assets" sub={friendly(registry.error)} onRetry={registry.retry} /></div>
          ) : (
            <DataTable<LiveAsset>
              rows={filtered}
              rowKey={a => a.id}
              onRowClick={a => navigate(`/maintenance/assets/${a.id}`)}
              empty={<Empty icon={<Icon.Grid size={22} />} title="No assets match" sub="Adjust the filters or search to see the registry." />}
              columns={[
                { key: 'code', label: 'Code', width: 120, render: a => <span className="u-mono u-small">{a.code}</span> },
                { key: 'name', label: 'Name', render: a => <span style={{ fontWeight: 570 }}>{a.name}</span> },
                { key: 'loc', label: 'Location', render: a => <span className="u-small u-muted">{a.building ?? '—'}{a.room ? ` · ${a.room}` : ''}</span> },
                { key: 'category', label: 'Category', render: a => <Badge tone="outline">{a.category}</Badge> },
                { key: 'status', label: 'Status', render: a => <StatusDot status={a.status as AssetStatus} /> },
                { key: 'health', label: 'Health', align: 'right', width: 72, render: a => <HealthRing score={a.health} size={34} /> },
                { key: 'installed', label: 'Installed', render: a => <span className="u-small u-muted">{a.installedOn ?? '—'}</span> },
              ]}
            />
          )}
        </Card>
      </Section>
    </div>
  );
}

/* ============================================================
   DEMO assets — mock service over fixture data (demo world only)
   ============================================================ */
function DemoAssets() {
  const navigate = useNavigate();
  const { session } = useStore();
  const toast = useToast();
  const scope = session.activeCampus as CampusId | 'all';

  const registry = useAsync(() => maintenanceService.assets(scope), [scope]);

  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState<AssetStatus | 'all'>('all');
  const [lowHealth, setLowHealth] = useState(false);
  const [query, setQuery] = useState('');
  const [qrAsset, setQrAsset] = useState<AssetRecord | null>(null);

  const all = useMemo(() => registry.data ?? [], [registry.data]);

  const categories = useMemo(() => Array.from(new Set(all.map(a => a.category))).sort(), [all]);
  const statuses = useMemo(
    () => (['operational', 'watch', 'degraded', 'down', 'maintenance', 'retired'] as AssetStatus[]).filter(s => all.some(a => a.status === s)),
    [all],
  );

  /* worst health first — the registry leads with what needs eyes */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter(a =>
        (category === 'all' || a.category === category) &&
        (status === 'all' || a.status === status) &&
        (!lowHealth || a.health < 60) &&
        (!q || `${a.name} ${a.id} ${a.room} ${a.building}`.toLowerCase().includes(q)))
      .sort((a, b) => a.health - b.health || a.id.localeCompare(b.id));
  }, [all, category, status, lowHealth, query]);

  const stats = useMemo(() => {
    const downOrDegraded = all.filter(a => a.status === 'down' || a.status === 'degraded').length;
    const watch = all.filter(a => a.status === 'watch').length;
    const avg = all.length ? Math.round(all.reduce((s, a) => s + a.health, 0) / all.length) : 0;
    return { total: all.length, downOrDegraded, watch, avg };
  }, [all]);

  const scopeLabel = `${scope} campus`;

  return (
    <div>
      <PageHead
        title="Assets"
        sub={`Asset registry · health, service due dates and QR reporting — ${scopeLabel}.`}
        actions={
          <Button variant="secondary" icon={<Icon.Zap size={14} />} onClick={() => navigate('/maintenance/report')}>Report issue</Button>
        }
      />

      {/* ---- Stats ---- */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <Stat label="Assets in scope" value={stats.total} sub={`${categories.length} categories · ${scopeLabel}`} />
        <Stat label="Down / degraded" value={stats.downOrDegraded} sub="Need action now" />
        <Stat label="On watch" value={stats.watch} sub="Trending unreliable — not failing yet" />
        <Stat label="Avg health" value={`${stats.avg}/100`} sub="Across the registry" />
      </div>

      {/* ---- Filters ---- */}
      <div className="u-col" style={{ gap: 10, marginBottom: 16 }}>
        <div className="u-inline" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="u-small u-muted" style={{ marginRight: 2 }}>Category</span>
          <Chip active={category === 'all'} onClick={() => setCategory('all')}>All</Chip>
          {categories.map(c => <Chip key={c} active={category === c} onClick={() => setCategory(c)}>{c}</Chip>)}
        </div>
        <div className="u-inline" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="u-small u-muted" style={{ marginRight: 2 }}>Status</span>
          <Chip active={status === 'all'} onClick={() => setStatus('all')}>All</Chip>
          {statuses.map(s => <Chip key={s} active={status === s} onClick={() => setStatus(s)}>{assetStatusLabel(s)}</Chip>)}
          <Chip active={lowHealth} danger onClick={() => setLowHealth(v => !v)}>Health &lt; 60</Chip>
          {(category !== 'all' || status !== 'all' || lowHealth || query) && (
            <Button variant="ghost" size="sm" icon={<Icon.X size={12} />} onClick={() => { setCategory('all'); setStatus('all'); setLowHealth(false); setQuery(''); }}>
              Clear
            </Button>
          )}
        </div>
        <div className="u-inline" style={{ gap: 8 }}>
          <label htmlFor="asset-search" className="u-small u-muted"><Icon.Search size={13} /></label>
          <input
            id="asset-search"
            className="input"
            placeholder="Search by name, tag or room…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ maxWidth: 300 }}
          />
        </div>
      </div>

      {/* ---- Registry table ---- */}
      <Section
        title="Registry"
        sub={`${filtered.length} of ${all.length} assets shown · sorted by health, lowest first.`}
        actions={<Button size="sm" variant="ghost" icon={<Icon.Refresh size={13} />} onClick={registry.retry}>Reload</Button>}
      >
        <Card>
          {registry.loading ? (
            <div className="u-col" style={{ gap: 10, padding: 'var(--s-5)' }}><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
          ) : registry.error ? (
            <div className="card-body"><ErrorState title="Could not load assets" sub={registry.error} onRetry={registry.retry} /></div>
          ) : (
            <DataTable
              rows={filtered}
              rowKey={a => a.id}
              onRowClick={a => navigate(`/maintenance/assets/${a.id}`)}
              empty={<Empty icon={<Icon.Grid size={22} />} title="No assets match" sub="Adjust the filters or search to see the registry." />}
              columns={[
                { key: 'id', label: 'Asset', width: 132, render: a => <AssetTag id={a.id} /> },
                { key: 'name', label: 'Name', render: a => <span style={{ fontWeight: 570 }}>{a.name}</span> },
                { key: 'loc', label: 'Location', render: a => <span className="u-small u-muted">{a.building} · {a.room}</span> },
                { key: 'category', label: 'Category', render: a => <Badge tone="outline">{a.category}</Badge> },
                {
                  key: 'criticality', label: 'Criticality', render: a => (
                    <span className="u-small" style={{ fontWeight: a.criticality === 'high' ? 620 : 480, color: a.criticality === 'high' ? 'var(--danger-text)' : 'var(--text-2)' }}>
                      {a.criticality}
                    </span>
                  ),
                },
                { key: 'status', label: 'Status', render: a => <StatusDot status={a.status} /> },
                { key: 'health', label: 'Health', align: 'right', width: 72, render: a => <HealthRing score={a.health} size={34} /> },
                {
                  key: 'service', label: 'Next service', render: a => {
                    const ns = nextServiceDue(a);
                    if (!ns) return <span className="u-small u-faint">—</span>;
                    const overdue = ns.getTime() < Date.now();
                    return (
                      <span className="u-mono u-small" style={{ color: overdue ? 'var(--danger-text)' : 'var(--text-2)', fontWeight: overdue ? 620 : 480 }}>
                        {fmtDateShort(ns)}{overdue ? ' · overdue' : ''}
                      </span>
                    );
                  },
                },
                {
                  key: 'qr', label: 'QR', align: 'right', width: 52, render: a => (
                    <button
                      className="iconbtn"
                      aria-label={`Show QR tag for ${a.id}`}
                      title="Show asset QR tag"
                      onClick={e => { e.stopPropagation(); setQrAsset(a); }}
                    >
                      <Icon.Grid size={14} />
                    </button>
                  ),
                },
              ]}
            />
          )}
        </Card>
      </Section>

      <p className="u-small u-muted" style={{ marginTop: 14, display: 'flex', gap: 7, alignItems: 'center' }}>
        <Icon.Info size={13} />
        Health is computed from logged failures, repair spend, age and preventive adherence. Tap a row for the full asset record.
      </p>

      {/* ---- QR drawer ---- */}
      <Drawer
        open={!!qrAsset}
        onClose={() => setQrAsset(null)}
        title={qrAsset ? `Asset QR — ${qrAsset.id}` : ''}
        sub={qrAsset?.name}
        footer={qrAsset && (
          <Link to={`/maintenance/report?asset=${qrAsset.id}`} className="btn btn-primary" style={{ textDecoration: 'none' }}>
            <Icon.Zap size={14} /> Report a problem
          </Link>
        )}
      >
        {qrAsset && (
          <div className="u-col" style={{ gap: 14, alignItems: 'center' }}>
            <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--surface)' }}>
              <QRPattern seedText={qrAsset.id} size={120} />
            </div>
            <p className="u-small" style={{ margin: 0, textAlign: 'center', lineHeight: 1.6 }}>
              <b>Scan to report — opens the flow pre-identified.</b>
              <br />
              <span className="u-muted">
                The tag carries the asset, room and service history, so the reporter only describes what is wrong. Post it at eye level on the asset.
              </span>
            </p>
            <Button
              variant="ghost"
              size="sm"
              icon={<Icon.Copy size={12} />}
              onClick={() => toast({ title: 'Tag reference copied', sub: `${qrAsset.id} — print sheet is generated by the facilities desk (demo).`, tone: 'info' })}
            >
              Copy tag reference
            </Button>
          </div>
        )}
      </Drawer>
    </div>
  );
}
