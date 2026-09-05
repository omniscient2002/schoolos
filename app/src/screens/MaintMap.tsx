/* ============================================================
   Facilities map — the "where is the trouble" screen.
   A deterministic schematic floorplan per campus: tagged assets
   as status dots inside their building, active work orders as
   pulsing rings on the building they belong to, and technicians
   on shift along the bottom. Building rects are laid out with
   the seeded RNG (makeRng(9101)) so the plan is identical on
   every load; asset dot positions hash the asset id.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { maintenanceService } from '../services';
import * as m from '../data/dataset';
import * as seed from '../data/dataset';
import { PageHead, Card, Stat, Badge, Button, Empty, ErrorState, SkeletonCard, useToast, Drawer, Tabs, KeyValue } from '../components/ui';
import { AssetMini, AssetTag, HealthRing, StatusDot } from '../components/Maint';
import { Icon } from '../components/Icon';
import { fmtDateShort, fmtRelative } from '../lib/format';
import { makeRng } from '../lib/rng';
import type { AssetRecord, AssetStatus, CampusId, WorkOrderRecord } from '../types/domain';

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

/* ---------- deterministic floorplan geometry ---------- */
const MAP_W = 880, MAP_H = 462;

const BUILDINGS: Record<CampusId, string[]> = {
  north: ['Block A', 'Block B', 'Admin', 'Utility yard', 'Transport bay'],
  city: ['Academic block', 'Dining block', 'Admin', 'Utility yard', 'Sports hall'],
  east: ['Library block', 'Academic block', 'Admin', 'Utility yard', 'Workshop'],
};

interface Rect { name: string; x: number; y: number; w: number; h: number }

function buildLayouts(): Record<CampusId, Rect[]> {
  const rng = makeRng(9101);
  const out = {} as Record<CampusId, Rect[]>;
  (Object.keys(BUILDINGS) as CampusId[]).forEach(campus => {
    const names = BUILDINGS[campus];
    const rects: Rect[] = [];
    const w1 = (MAP_W - 72 - 48) / 3;
    names.slice(0, 3).forEach((name, i) => {
      rects.push({ name, x: 36 + i * (w1 + 24) + rng.int(-8, 8), y: 34 + rng.int(-6, 6), w: w1 + rng.int(-14, 14), h: 150 + rng.int(-10, 10) });
    });
    const w2 = (MAP_W - 72 - 24) / 2;
    names.slice(3).forEach((name, i) => {
      rects.push({ name, x: 36 + i * (w2 + 24) + rng.int(-8, 8), y: 238 + rng.int(-6, 6), w: w2 + rng.int(-14, 14), h: 158 + rng.int(-10, 10) });
    });
    out[campus] = rects;
  });
  return out;
}
const LAYOUTS = buildLayouts();

/* deterministic per-asset position: FNV-1a hash of the id → fraction of the building box */
function hashPoint(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  h >>>= 0;
  return { fx: (h % 10007) / 10007, fy: ((h >>> 9) % 10009) / 10009 };
}

function placeAssets(assets: AssetRecord[], rects: Rect[]) {
  const placed: { asset: AssetRecord; x: number; y: number }[] = [];
  for (const a of assets) {
    const r = rects.find(x => x.name === a.building) ?? rects[0];
    const { fx, fy } = hashPoint(a.id);
    let x = r.x + 20 + fx * Math.max(20, r.w - 40);
    let y = r.y + 46 + fy * Math.max(16, r.h - 78);   /* keep label strip and WO-ring lane clear */
    for (let tries = 0; tries < 8; tries++) {
      if (!placed.some(p => Math.abs(p.x - x) < 16 && Math.abs(p.y - y) < 16)) break;
      x = r.x + 20 + ((x - r.x + 19) % Math.max(20, r.w - 40));
      y = y + 12 > r.y + r.h - 40 ? r.y + 46 : y + 12;
    }
    placed.push({ asset: a, x, y });
  }
  return placed;
}

const ASSET_DOT: Record<AssetStatus, string> = {
  operational: 'var(--accent)', watch: '#175CD3', degraded: '#DC6803', down: '#D92D20', maintenance: '#5D53B8', retired: '#98A2B3',
};
const ASSET_LEGEND: { status: AssetStatus; label: string }[] = [
  { status: 'operational', label: 'Operational' },
  { status: 'watch', label: 'Watch' },
  { status: 'degraded', label: 'Degraded' },
  { status: 'down', label: 'Down' },
  { status: 'maintenance', label: 'In maintenance' },
];

const isOpen = (w: WorkOrderRecord) => !['resolved', 'closed', 'cancelled'].includes(w.status);
const ringColor = (wos: WorkOrderRecord[]) =>
  wos.some(w => w.priority === 'emergency' || w.priority === 'critical') ? 'var(--danger)' : '#DC6803';

/* ============================================================ */

export default function MaintMap() {
  const navigate = useNavigate();
  const { session, setActiveCampus, domain } = useStore();
  const toast = useToast();
  const campus = session.activeCampus;
  const scoped = session.campusScope !== 'all';
  const [sel, setSel] = useState<{ kind: 'asset'; id: string } | { kind: 'building'; name: string } | null>(null);

  const { data, loading, error, retry } = useAsync(() => maintenanceService.assets(campus), [campus]);
  const assets = data ?? [];
  const rects = LAYOUTS[campus];

  const campusWOs = domain.workOrders.filter(w => w.campus === campus);
  const openWOs = campusWOs.filter(isOpen);

  const openByBuilding = new Map<string, WorkOrderRecord[]>();
  openWOs.forEach(w => openByBuilding.set(w.building, [...(openByBuilding.get(w.building) ?? []), w]));

  const assetsByBuilding = new Map<string, AssetRecord[]>();
  assets.forEach(a => assetsByBuilding.set(a.building, [...(assetsByBuilding.get(a.building) ?? []), a]));

  const dots = useMemo(() => placeAssets(assets, rects), [assets, rects]);

  const hotspots = rects
    .map(r => ({ name: r.name, open: (openByBuilding.get(r.name) ?? []).length }))
    .filter(h => h.open > 0)
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));

  const selAsset = sel?.kind === 'asset' ? assets.find(a => a.id === sel.id) ?? m.assetById(sel.id) ?? null : null;
  const selBuildingName = sel?.kind === 'building' ? sel.name : (sel?.kind === 'asset' ? selAsset?.building : undefined);
  const selBuilding = selBuildingName ? rects.find(r => r.name === selBuildingName) : undefined;
  const buildingWOs = selBuildingName ? openByBuilding.get(selBuildingName) ?? [] : [];
  const buildingAssets = selBuildingName ? assetsByBuilding.get(selBuildingName) ?? [] : [];
  const lastWO = selAsset
    ? domain.workOrders.filter(w => w.assetId === selAsset.id).sort((a, b) => b.reportedOn.getTime() - a.reportedOn.getTime())[0]
    : undefined;
  const lastFailure = selAsset && selAsset.failures.length ? selAsset.failures[selAsset.failures.length - 1] : undefined;
  const techs = m.technicians.filter(t => t.campus === campus);

  const openAsset = (id: string) => { setSel({ kind: 'asset', id }); };

  const pickCampus = (id: string) => {
    if (scoped && session.campusScope !== id) {
      toast({ title: 'Campus locked', sub: `Your role is scoped to ${seed.campuses.find(c => c.id === session.campusScope)?.name} — the map opens read-only.`, tone: 'info' });
      return;
    }
    setSel(null);
    setActiveCampus(id as CampusId);
  };

  return (
    <div>
      <PageHead
        title="Facilities map"
        sub={`${openWOs.length} active work order${openWOs.length === 1 ? '' : 's'} · ${assets.length} tagged assets · dots show live asset status on ${seed.campuses.find(c => c.id === campus)?.name}`}
        actions={
          <Button variant="secondary" icon={<Icon.Zap size={14} />} onClick={() => navigate('/maintenance/report')}>Report issue</Button>
        }
      />

      {/* campus selector */}
      <div className="u-flex" style={{ gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <Tabs
          tabs={seed.campuses.map(c => ({ id: c.id, label: c.name }))}
          active={campus}
          onChange={pickCampus}
        />
        {scoped && (
          <span className="u-xs u-faint" style={{ alignSelf: 'center' }}>
            Read-only · your access is scoped to one campus — switching is disabled by policy
          </span>
        )}
      </div>

      {loading && <div className="grid grid-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>}
      {error && <ErrorState onRetry={retry} sub={error} />}

      {data && (
        <>
          {/* hotspot strip — where is the trouble */}
          <div className="u-inline" style={{ gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <span className="u-upper" style={{ marginRight: 2 }}>Hotspots</span>
            {hotspots.length === 0 && <Badge tone="success" dot>All clear — no open jobs on this campus</Badge>}
            {hotspots.map(h => {
              const n = h.open;
              return (
                <button key={h.name} onClick={() => setSel({ kind: 'building', name: h.name })}
                  className="u-inline u-small"
                  style={{
                    gap: 7, cursor: 'pointer', padding: '4px 10px', borderRadius: 999,
                    border: `1px solid ${n >= 2 ? 'color-mix(in srgb, var(--danger) 30%, transparent)' : 'var(--border)'}`,
                    background: n >= 2 ? 'color-mix(in srgb, var(--danger) 6%, var(--surface))' : 'var(--surface)',
                    color: 'var(--text-2)', fontWeight: 560,
                  }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: n >= 2 ? 'var(--danger)' : '#DC6803' }} />
                  {h.name} · {n} open job{n === 1 ? '' : 's'}
                </button>
              );
            })}
          </div>

          {/* stats */}
          <div className="grid grid-4" style={{ marginBottom: 'var(--s-5)' }}>
            <Stat label="Active work orders" value={openWOs.length} sub={`${hotspots.length} building${hotspots.length === 1 ? '' : 's'} affected`} />
            <Stat label="Tagged assets" value={assets.length} sub={`${assets.filter(a => a.status === 'down' || a.status === 'degraded').length} degraded or down`} />
            <Stat label="Worst building" value={hotspots[0]?.name ?? '—'} sub={hotspots[0] ? `${hotspots[0].open} open job${hotspots[0].open === 1 ? '' : 's'}` : 'nothing open'} onClick={() => hotspots[0] && setSel({ kind: 'building', name: hotspots[0].name })} />
            <Stat label="Technicians on shift" value={techs.length} sub={`${techs.reduce((a, t) => a + t.currentJobs, 0)} jobs in progress`} />
          </div>

          {/* floorplan */}
          <div style={{ position: 'relative', background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
            <style>{`.mm-b { cursor: pointer; } .mm-b:hover rect { fill: var(--surface-3); } .mm-b.sel rect { fill: var(--accent-weak); }`}</style>
            <div style={{ overflowX: 'auto' }}>
              <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ width: '100%', minWidth: 640, height: 'auto', display: 'block' }} role="img" aria-label={`Schematic floorplan of ${seed.campuses.find(c => c.id === campus)?.name} with asset status and active work orders`}>
                {/* graticule */}
                {Array.from({ length: 8 }, (_, i) => (
                  <line key={`v${i}`} x1={(i + 1) * (MAP_W / 9)} y1={0} x2={(i + 1) * (MAP_W / 9)} y2={MAP_H} stroke="var(--border-subtle)" strokeWidth="1" />
                ))}
                {Array.from({ length: 4 }, (_, i) => (
                  <line key={`h${i}`} x1={0} y1={(i + 1) * (MAP_H / 5)} x2={MAP_W} y2={(i + 1) * (MAP_H / 5)} stroke="var(--border-subtle)" strokeWidth="1" />
                ))}

                {/* walkways between the two rows */}
                <line x1={40} y1={218} x2={MAP_W - 40} y2={218} stroke="var(--border)" strokeWidth="1.4" strokeDasharray="1 5" strokeLinecap="round" />
                <line x1={MAP_W / 2} y1={190} x2={MAP_W / 2} y2={236} stroke="var(--border)" strokeWidth="1.4" strokeDasharray="1 5" strokeLinecap="round" />

                {/* buildings */}
                {rects.map(r => {
                  const open = (openByBuilding.get(r.name) ?? []).length;
                  const isSel = selBuildingName === r.name;
                  const stroke = open >= 2 ? 'var(--danger)' : open === 1 ? '#DC6803' : 'var(--border-strong)';
                  const bAssets = assetsByBuilding.get(r.name) ?? [];
                  return (
                    <g key={r.name} className={`mm-b ${isSel ? 'sel' : ''}`} onClick={() => setSel({ kind: 'building', name: r.name })}>
                      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={12}
                        fill={isSel ? 'var(--accent-weak)' : 'var(--surface)'}
                        stroke={isSel ? 'var(--accent)' : stroke}
                        strokeWidth={isSel ? 1.8 : open > 0 ? 1.5 : 1.2} />
                      <text x={r.x + 14} y={r.y + 24} fontSize="12.5" fontWeight="640" fill="var(--text-2)" style={{ fontFamily: 'var(--font-sans)' }}>{r.name}</text>
                      <text x={r.x + 14} y={r.y + 38} fontSize="9.5" fill="var(--text-3)" style={{ fontFamily: 'var(--font-sans)' }}>
                        {bAssets.length} asset{bAssets.length === 1 ? '' : 's'}{open > 0 ? ` · ${open} open job${open === 1 ? '' : 's'}` : ''}
                      </text>
                      {open > 0 && (
                        <text x={r.x + r.w - 12} y={r.y + 24} fontSize="10.5" fontWeight="650" textAnchor="end" fill={open >= 2 ? 'var(--danger)' : '#DC6803'} style={{ fontFamily: 'var(--font-sans)' }}>
                          {open} open
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* active work orders → pulsing rings on their building */}
                {rects.flatMap(r => {
                  const wos = openByBuilding.get(r.name) ?? [];
                  const color = ringColor(wos);
                  return wos.map((w, i) => {
                    const cx = r.x + r.w / 2 + (i - (wos.length - 1) / 2) * 22;
                    const cy = r.y + r.h - 16;
                    return (
                      <g key={w.id} onClick={e => { e.stopPropagation(); navigate(`/maintenance/work-orders/${w.id}`); }} style={{ cursor: 'pointer' }}>
                        <title>{`${w.id} · ${w.title} — ${w.status}`}</title>
                        <circle cx={cx} cy={cy} r={7} fill="none" stroke={color} strokeWidth={2} opacity={0.75} style={{ animation: 'pulse 2.2s ease-in-out infinite' }}>
                          <animate attributeName="r" values="7;13;7" dur="2.2s" repeatCount="indefinite" />
                        </circle>
                        <circle cx={cx} cy={cy} r={3.1} fill={color} />
                      </g>
                    );
                  });
                })}

                {/* asset dots (topmost — clickable) */}
                {dots.map(({ asset, x, y }) => {
                  const color = ASSET_DOT[asset.status];
                  const isSel = sel?.kind === 'asset' && sel.id === asset.id;
                  return (
                    <g key={asset.id} onClick={e => { e.stopPropagation(); openAsset(asset.id); }} style={{ cursor: 'pointer' }}>
                      <title>{`${asset.id} · ${asset.name} · ${asset.status}`}</title>
                      {(asset.status === 'down' || asset.status === 'degraded') && (
                        <circle cx={x} cy={y} r={11} fill={color} opacity={0.16} />
                      )}
                      <circle cx={x} cy={y} r={isSel ? 7 : 5.6} fill={color} stroke="var(--surface)" strokeWidth={isSel ? 2.2 : 1.4} />
                    </g>
                  );
                })}

                {/* compass hint */}
                <text x={MAP_W - 18} y={MAP_H - 12} fontSize="9.5" fill="var(--text-3)" textAnchor="end" style={{ fontFamily: 'var(--font-sans)' }}>schematic · not to scale</text>
              </svg>
            </div>

            {/* legend */}
            <div className="u-flex u-xs u-muted" style={{ gap: 14, padding: '8px 12px', borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
              {ASSET_LEGEND.map(l => (
                <span key={l.status} className="u-flex" style={{ gap: 5 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: ASSET_DOT[l.status] }} /> {l.label}
                </span>
              ))}
              <span className="u-flex" style={{ gap: 5 }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', border: '1.6px solid var(--danger)', background: 'transparent' }} /> Active work order (pulsing)
              </span>
              <span style={{ marginLeft: 'auto' }} className="u-faint">Click a dot for the asset · a building for its rooms · a ring for the job</span>
            </div>
          </div>

          {/* technicians on shift */}
          <Card head="On shift" sub="Technicians for this campus, with their last known position" style={{ marginTop: 'var(--s-5)' }}>
            <div className="u-flex" style={{ gap: 10, padding: 'var(--s-4) var(--s-5)', flexWrap: 'wrap' }}>
              {techs.length === 0 && <span className="u-small u-muted">No technicians rostered for this campus in the demo data.</span>}
              {techs.map(t => (
                <span key={t.id} className="u-inline" style={{ gap: 9, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 999, padding: '5px 12px 5px 6px', background: 'var(--surface)' }}>
                  <span className="avatar sm" style={{ background: `linear-gradient(0deg, ${'var(--accent-weak)'}, var(--accent-weak))` }}>
                    {t.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
                  </span>
                  <span className="u-col" style={{ gap: 0 }}>
                    <span className="u-small" style={{ fontWeight: 600, lineHeight: 1.25 }}>{t.name}</span>
                    <span className="u-xs u-faint" style={{ lineHeight: 1.3 }}>{t.lastSeen.split(' · ')[0]} · shift {t.shift}</span>
                  </span>
                  <Badge tone={t.currentJobs === 0 ? 'success' : t.currentJobs <= 1 ? 'info' : 'neutral'}>{t.currentJobs === 0 ? 'Free' : `${t.currentJobs} job${t.currentJobs === 1 ? '' : 's'}`}</Badge>
                </span>
              ))}
            </div>
          </Card>

          <div style={{ height: 24 }} />
          <div className="u-small u-muted">
            The map answers one question — where is the trouble: red-ringed buildings hold the urgent jobs, amber rings the routine ones, and dot colour is the live asset status.
            Building rectangles are laid out deterministically (seeded RNG) and asset dots hash the asset id, so the plan is stable between loads. Positions are schematic, not survey data.
          </div>
        </>
      )}

      {/* side panel — building or asset */}
      <Drawer
        open={!!sel}
        onClose={() => setSel(null)}
        title={sel?.kind === 'asset' ? selAsset?.name ?? sel.id : sel?.name ?? ''}
        sub={sel?.kind === 'asset'
          ? selAsset ? `${selAsset.id} · ${selAsset.category} · health ${selAsset.health}` : sel.id
          : sel ? `${seed.campuses.find(c => c.id === campus)?.name} · ${buildingAssets.length} asset${buildingAssets.length === 1 ? '' : 's'} · ${buildingWOs.length} open job${buildingWOs.length === 1 ? '' : 's'}` : undefined}
        footer={selAsset && (
          <>
            <Button variant="secondary" iconRight={<Icon.ArrowUpRight size={13} />} onClick={() => navigate(`/maintenance/report?asset=${selAsset.id}`)}>Report problem</Button>
            <Button variant="primary" iconRight={<Icon.ArrowUpRight size={13} />} onClick={() => navigate(`/maintenance/assets/${selAsset.id}`)}>Open asset</Button>
          </>
        )}
      >
        {sel?.kind === 'asset' && selAsset && (
          <div className="u-col" style={{ gap: 18 }}>
            <AssetMini asset={selAsset} onClick={() => navigate(`/maintenance/assets/${selAsset.id}`)} />
            <KeyValue
              items={[
                { k: 'Health', v: <span className="u-inline" style={{ gap: 8 }}><HealthRing score={selAsset.health} size={34} /><StatusDot status={selAsset.status} /></span> },
                { k: 'Location', v: `${selAsset.building}${selAsset.room ? ` · ${selAsset.room}` : ''} (floor ${selAsset.floor})` },
                { k: 'Failures logged', v: `${selAsset.failures.length}${lastFailure ? ` · last ${fmtDateShort(lastFailure.on)}` : ''}` },
                { k: 'Repair spend YTD', v: `₹${selAsset.repairSpendYTD.toLocaleString('en-IN')}` },
                { k: 'Model', v: `${selAsset.manufacturer} ${selAsset.model}` },
                { k: 'Last service', v: selAsset.lastService ? fmtDateShort(selAsset.lastService) : '—' },
              ]}
            />
            {lastWO && (
              <div className="u-col" style={{ gap: 6 }}>
                <span className="u-upper">Last work order</span>
                <Link to={`/maintenance/work-orders/${lastWO.id}`} className="u-inline u-small" style={{ gap: 8, color: 'var(--accent-text)' }}>
                  <span className="u-mono">{lastWO.id}</span> {lastWO.title} · {fmtRelative(lastWO.reportedOn)} →
                </Link>
              </div>
            )}
            {selAsset.failures.length > 0 && (
              <div className="u-col" style={{ gap: 8 }}>
                <span className="u-upper">Failure history</span>
                {[...selAsset.failures].reverse().slice(0, 4).map((f, i) => (
                  <div key={i} className="u-col" style={{ gap: 1 }}>
                    <span className="u-small" style={{ fontWeight: 550 }}>{f.summary}</span>
                    <span className="u-xs u-faint">
                      {fmtDateShort(f.on)} · ₹{f.cost.toLocaleString('en-IN')}{f.workOrderId && <> · <Link className="u-mono" to={`/maintenance/work-orders/${f.workOrderId}`}>{f.workOrderId}</Link></>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {sel?.kind === 'building' && selBuilding && (
          <div className="u-col" style={{ gap: 18 }}>
            <div className="u-col" style={{ gap: 8 }}>
              <span className="u-upper">Active work orders here</span>
              {buildingWOs.length === 0 && <span className="u-small u-muted">Nothing open in this building right now.</span>}
              {buildingWOs.map(w => (
                <Link key={w.id} to={`/maintenance/work-orders/${w.id}`} className="u-col" style={{ gap: 3, border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '10px 12px', color: 'inherit', textDecoration: 'none' }}>
                  <span className="u-inline" style={{ gap: 8 }}>
                    <span className="u-mono u-small u-muted">{w.id}</span>
                    <Badge tone={w.priority === 'emergency' || w.priority === 'critical' ? 'danger' : 'warning'}>{w.priority}</Badge>
                  </span>
                  <span className="u-small" style={{ fontWeight: 560 }}>{w.title}</span>
                </Link>
              ))}
            </div>

            <div className="u-col" style={{ gap: 12 }}>
              <span className="u-upper">Rooms & assets</span>
              {buildingAssets.length === 0 && (
                <Empty icon={<Icon.Building size={20} />} title="No tagged assets" sub="This building has no registered assets in the demo register." />
              )}
              {[...new Set(buildingAssets.map(a => a.room))].map(room => {
                const roomAssets = buildingAssets.filter(a => a.room === room);
                const roomWOs = roomAssets.reduce((acc, a) => acc + openWOs.filter(w => w.assetId === a.id).length, 0);
                return (
                  <div key={room} className="u-col" style={{ gap: 7 }}>
                    <span className="u-inline" style={{ gap: 8 }}>
                      <span className="u-small" style={{ fontWeight: 620 }}>{room}</span>
                      {roomWOs > 0 && <Badge tone="warning">{roomWOs} open job{roomWOs === 1 ? '' : 's'}</Badge>}
                    </span>
                    {roomAssets.map(a => {
                      const n = openWOs.filter(w => w.assetId === a.id).length;
                      return (
                        <div key={a.id} className="u-inline" style={{ gap: 9, justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => openAsset(a.id)}>
                          <span className="u-inline" style={{ gap: 8, minWidth: 0 }}>
                            <AssetTag id={a.id} />
                            <span className="u-small u-truncate">{a.name}</span>
                          </span>
                          <span className="u-inline" style={{ gap: 8, flexShrink: 0 }}>
                            {n > 0 && <span className="u-mono u-xs" style={{ color: 'var(--danger)' }}>{n} WO</span>}
                            <StatusDot status={a.status} />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
