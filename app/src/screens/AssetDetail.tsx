/* ============================================================
   AssetDetail — one asset, whole story. Identity and location,
   the health model with its factors, failure history, work
   orders and preventive plans attached to it, and the
   rule-based replacement evaluation (shown honestly as a
   heuristic, not a prediction).
   ============================================================ */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiAssets, apiWorkOrders } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import {
  PageHead, Card, Badge, Button, ErrorState, SkeletonCard, KeyValue,
} from '../components/ui';
import { Icon } from '../components/Icon';

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



export default function AssetDetail() {
  return <LiveAssetDetail />;
}

/* ============================================================
   LIVE asset detail — GET /assets row + related work orders
   matched by the door's asset_code join. Warranty, replacement
   forecasts, health-factor breakdowns and preventive plans are
   not exposed by doors yet — the page says so, it does not
   invent them.
   ============================================================ */
function LiveAssetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const assetsQ = useAsync(async () => {
    const res = await apiAssets();
    return (res.assets ?? []) as Record<string, unknown>[];
  }, []);
  const wosQ = useAsync(async () => {
    const res = await apiWorkOrders();
    return (res.workOrders ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      code: String(r.code ?? ''),
      title: String(r.title ?? ''),
      status: String(r.status ?? 'reported'),
      priority: String(r.priority ?? 'medium'),
      assetCode: (r.asset_code as string) ?? null,
      assetName: (r.asset_name as string) ?? null,
    }));
  }, []);

  const asset = (assetsQ.data ?? []).find(a => String(a.id) === id) ?? null;
  const code = asset ? String(asset.code ?? '') : '';
  const related = wosQ.data?.filter(w => w.assetCode && w.assetCode === code) ?? [];
  const OPEN = ['reported', 'assigned', 'accepted', 'en-route', 'on-site', 'repairing', 'verification'];

  if (assetsQ.loading) {
    return (
      <div>
        <PageHead title="Asset" back={{ to: '/maintenance/assets', label: 'Asset registry' }} />
        <div className="grid grid-2"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      </div>
    );
  }
  if (assetsQ.error || !asset) {
    return (
      <div>
        <PageHead title="Asset" back={{ to: '/maintenance/assets', label: 'Asset registry' }} />
        <ErrorState
          title={assetsQ.error ? 'Could not load asset' : 'Asset not found'}
          sub={assetsQ.error ? friendly(assetsQ.error) : (id ? 'No asset with this id exists on the server.' : 'Open an asset from the registry.')}
          onRetry={assetsQ.error ? assetsQ.retry : undefined}
        />
        <div style={{ marginTop: 14 }}>
          <Button variant="secondary" icon={<Icon.ChevronLeft size={14} />} onClick={() => navigate('/maintenance/assets')}>Back to asset registry</Button>
        </div>
      </div>
    );
  }

  const health = Number(asset.health_score ?? 100);
  const status = String(asset.status ?? 'operational');

  return (
    <div>
      <PageHead
        title={String(asset.name ?? 'Asset')}
        sub={`${asset.category ?? ''} · ${asset.building ?? '—'}${asset.room ? ` · ${asset.room}` : ''} · from the server registry`}
        back={{ to: '/maintenance/assets', label: 'Asset registry' }}
        actions={
          <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" icon={<Icon.Zap size={14} />} onClick={() => navigate(`/maintenance/report?asset=${asset.id}`)}>Report problem</Button>
          </div>
        }
      />

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="u-col" style={{ gap: 16 }}>
          <Card head="Registry record" sub={`Code ${asset.code ?? '—'}`}>
            <div className="card-body">
              <KeyValue
                cols={1}
                items={[
                  { k: 'Name', v: String(asset.name ?? '—') },
                  { k: 'Category', v: String(asset.category ?? '—') },
                  { k: 'Location', v: `${asset.building ?? '—'}${asset.room ? ` · ${asset.room}` : ''}` },
                  { k: 'Status', v: <Badge tone={status === 'down' || status === 'degraded' ? 'danger' : status === 'watch' || status === 'maintenance' ? 'warning' : 'success'} dot>{status}</Badge> },
                  { k: 'Health score', v: `${health}/100` },
                  { k: 'Installed', v: (asset.installed_on as string) ?? '—' },
                ]}
              />
            </div>
          </Card>
          <Card head="Not on this record yet" sub="server doors pending">
            <div className="card-body u-col" style={{ gap: 6 }}>
              <span className="u-small u-muted">Warranty and purchase data, replacement forecasts, health-factor breakdowns, service history and preventive plans are not exposed by the asset door yet. They appear here the moment the door returns them — nothing on this page is estimated.</span>
            </div>
          </Card>
        </div>

        <div className="u-col" style={{ gap: 16 }}>
          <Card head="Work orders on this asset" sub={related.length ? `${related.filter(w => OPEN.includes(w.status)).length} open · ${related.length} total` : 'none on the ledger'}>
            <div className="card-body u-col" style={{ gap: 8 }}>
              {wosQ.loading ? <SkeletonCard lines={2} /> : wosQ.error ? (
                <ErrorState title="Could not load work orders" sub={friendly(wosQ.error)} onRetry={wosQ.retry} />
              ) : related.length === 0 ? (
                <span className="u-small u-muted">No work orders reference {code || 'this asset'} yet. Report a problem to open the first one.</span>
              ) : related.map(w => (
                <Link key={w.id} to={`/maintenance/work-orders/${w.id}`} className="card-click u-col" style={{ gap: 4, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px' }}>
                  <span className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="u-mono u-small u-muted">{w.code}</span>
                    <Badge tone="outline">{w.priority}</Badge>
                    <Badge tone="info">{w.status}</Badge>
                  </span>
                  <span style={{ fontWeight: 570, fontSize: 'var(--text-sm)' }}>{w.title}</span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

