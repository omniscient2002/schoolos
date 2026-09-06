/* ============================================================
   Transport — live route board. Route cards with capacity and
   next stops, Bus 14 (Route 7) standing out with its linked
   incident, a deterministic SVG map with animated buses, and
   the delay simulator that trips guardian + leniency workflows.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import * as seed from '../data/dataset';
import { transportService } from '../services';
import {
  PageHead, Section, Card, Stat, Badge, Button, useToast, Progress,
  Empty, ErrorState, Skeleton, SkeletonCard,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtTime } from '../lib/format';
import { makeRng } from '../lib/rng';
import type { BusRoute } from '../types/domain';

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

/* ---------- deterministic map geometry ---------- */
interface Pt { x: number; y: number }

function routePaths(): { routeId: string; name: string; pts: Pt[]; bus: Pt; isRoute7: boolean }[] {
  const rng = makeRng(4242);
  const W = 760, H = 360, PAD = 60;
  return seed.busRoutes.map((r, i) => {
    const baseX = PAD + (i % 5) * ((W - PAD * 2) / 4);
    const baseY = 52 + Math.floor(i / 5) * 150;
    const pts: Pt[] = [{ x: baseX, y: baseY }];
    for (let s = 1; s <= 5; s++) {
      pts.push({
        x: Math.min(W - PAD, Math.max(PAD, baseX + s * 34 + rng.int(-16, 16))),
        y: Math.min(H - PAD, Math.max(PAD, baseY + rng.int(-52, 52) + s * 6)),
      });
    }
    return {
      routeId: r.id,
      name: r.name,
      pts,
      bus: pts[2] ? { x: pts[2].x, y: pts[2].y } : pts[0],
      isRoute7: r.id === 'route_7',
    };
  });
}

const ROUTE_PATHS = routePaths();

const CAMPUS_PIN: Record<string, Pt> = {
  north: { x: 700, y: 78 },
  city: { x: 700, y: 240 },
  east: { x: 700, y: 150 },
};

/* ---------- status visuals ---------- */
function routeStatus(r: BusRoute) {
  if (r.status === 'delayed') return { tone: 'warning' as const, label: `Delayed +${r.delayMins ?? 0} min` };
  if (r.status === 'maintenance') return { tone: 'danger' as const, label: 'In maintenance' };
  return { tone: 'success' as const, label: 'On time' };
}

/* scoped style — route 7 card stands out (Card has no style prop);
   unit 9: the delayed traffic-light composes over the r7 tint (same
   warning token; later + higher specificity beats the 1.5px all-side rule) */
const MAP_STYLE = `
.route-card-r7 { border-color: var(--warning) !important; border-width: 1.5px !important; }
.route-card-r7.route-delayed { border-left-width: 3px !important; }
`;

/* ---------- route card ---------- */
function RouteCard({ route, onOpenIncident }: { route: BusRoute; onOpenIncident: () => void }) {
  const isR7 = route.id === 'route_7';
  const st = routeStatus(route);
  const usage = Math.round((route.students / route.capacity) * 100);
  return (
    <Card className={`route-card${route.status === 'delayed' ? ' route-delayed' : ''}${isR7 ? ' route-card-r7' : ''}`}>
      <div className="u-col" style={{ gap: 10, padding: 'var(--s-5)' }}>
        <div className="u-between" style={{ gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div className="u-flex" style={{ gap: 7, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 630 }}>{route.name}</span>
              {isR7 && <Badge tone="warning" dot>Incident linked</Badge>}
            </div>
            <div className="u-xs u-faint" style={{ marginTop: 2 }}>
              {route.vehicle} · Driver {route.driver}
            </div>
          </div>
          <Badge tone={st.tone} dot>{st.label}</Badge>
        </div>

        <div className="u-col" style={{ gap: 4 }}>
          <div className="u-between u-xs u-muted">
            <span>{route.students} students · {route.capacity} capacity</span>
            <span className="tnum">{usage}%</span>
          </div>
          <Progress value={usage} tone={usage > 90 ? 'danger' : usage > 75 ? 'warn' : undefined} />
        </div>

        <div>
          <div className="u-upper" style={{ marginBottom: 5 }}>Next stops</div>
          {(() => {
            const stops = route.stops.slice(0, 4);
            if (stops.length === 0) return null;
            const span = Math.max(1, stops.length - 1);
            return (
              <div className="route-strip" role="img" aria-label={`Stop sequence: ${stops.map(st => `${st.name} at ${st.time}`).join(', ')}`}>
                <span className="rs-line" aria-hidden="true" />
                {stops.map((st, i) => (
                  <span key={st.name} className="rs-stop" style={{ left: `${(i / span) * 100}%` }}>
                    <span className="rs-dot" aria-hidden="true" style={route.status === 'delayed' && i === stops.length - 1 ? { borderColor: 'var(--warning)' } : undefined} />
                    <span className="rs-label">{st.name}</span>
                    <span className="rs-time mono">{st.time}</span>
                  </span>
                ))}
              </div>
            );
          })()}
        </div>

        {isR7 && (
          <div className="u-flex" style={{ gap: 8, paddingTop: 4, borderTop: '1px solid var(--border-subtle)' }}>
            <span className="u-xs u-muted" style={{ flex: 1 }}>
              Coolant leak repaired; pre-route inspection in effect (dec_4). Guardians notified per Transport §3.1.
            </span>
            <Button size="sm" variant="secondary" iconRight={<Icon.ArrowUpRight size={12} />} onClick={onOpenIncident}>
              View incident
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ---------- live map ---------- */
function LiveMap({ routes }: { routes: BusRoute[] }) {
  const shown = ROUTE_PATHS.filter(p => routes.some(r => r.id === p.routeId));
  const W = 760, H = 360;
  return (
    <div style={{ position: 'relative', background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Live map of active routes">
        {/* graticule */}
        {Array.from({ length: 8 }, (_, i) => (
          <line key={`v${i}`} x1={(i + 1) * (W / 9)} y1={0} x2={(i + 1) * (W / 9)} y2={H} stroke="var(--border-subtle)" strokeWidth="1" />
        ))}
        {Array.from({ length: 4 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={(i + 1) * (H / 5)} x2={W} y2={(i + 1) * (H / 5)} stroke="var(--border-subtle)" strokeWidth="1" />
        ))}

        {/* route polylines + buses */}
        {shown.map(p => {
          const r = routes.find(x => x.id === p.routeId)!;
          const d = p.pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x},${pt.y}`).join(' ');
          const st = routeStatus(r);
          const color = st.tone === 'warning' ? 'var(--warning)' : st.tone === 'danger' ? 'var(--danger)' : 'var(--accent)';
          return (
            <g key={p.routeId}>
              <path d={d} fill="none" stroke={color} strokeWidth={p.isRoute7 ? 2.6 : 1.5} opacity={p.isRoute7 ? 0.95 : 0.45} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={st.tone === 'danger' ? '4 4' : undefined} />
              {p.pts.slice(1).map((pt, i) => (
                <circle key={i} cx={pt.x} cy={pt.y} r={2.4} fill="var(--surface)" stroke={color} strokeWidth="1.2" opacity={p.isRoute7 ? 0.9 : 0.5} />
              ))}
              <circle cx={p.bus.x} cy={p.bus.y} r={p.isRoute7 ? 6.5 : 4.5} fill={color} opacity="0.28" style={{ animation: 'pulse 2.2s ease-in-out infinite' }}>
                <animate attributeName="r" values={`${p.isRoute7 ? 5 : 3.5};${p.isRoute7 ? 9 : 6};${p.isRoute7 ? 5 : 3.5}`} dur="2.2s" repeatCount="indefinite" />
              </circle>
              <circle cx={p.bus.x} cy={p.bus.y} r={p.isRoute7 ? 4.6 : 3.2} fill={color} stroke="#fff" strokeWidth="1.2" />
              {p.isRoute7 && (
                <text x={p.bus.x + 9} y={p.bus.y + 3.5} fontSize="10" fontWeight="640" fill="var(--warning)" style={{ fontFamily: 'var(--font-sans)' }}>Bus 14</text>
              )}
            </g>
          );
        })}

        {/* campus pin */}
        {(() => {
          const pin = CAMPUS_PIN[routes[0]?.campus ?? 'north'] ?? CAMPUS_PIN.north;
          return (
            <g>
              <rect x={pin.x - 8} y={pin.y - 8} width={16} height={16} rx={5} fill="var(--accent)" />
              <path d={`M${pin.x - 3},${pin.y + 1.5} l2.4,2.6 4.4,-5`} stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <text x={pin.x - 8} y={pin.y + 20} fontSize="10" fontWeight="620" fill="var(--text-2)" style={{ fontFamily: 'var(--font-sans)' }}>
                {seed.campuses.find(c => c.id === (routes[0]?.campus ?? 'north'))?.name ?? 'Campus'}
              </text>
            </g>
          );
        })()}
      </svg>

      {/* legend */}
      <div className="u-flex u-xs u-muted" style={{ gap: 14, padding: '8px 12px', borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        <span className="u-flex" style={{ gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--accent)' }} /> On time</span>
        <span className="u-flex" style={{ gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--warning)' }} /> Delayed</span>
        <span className="u-flex" style={{ gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--danger)' }} /> Maintenance</span>
        <span className="u-flex" style={{ gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: '50%', border: '1.4px solid var(--warning)', background: 'var(--surface)' }} /> Bus 14 (highlighted)</span>
        <span style={{ marginLeft: 'auto' }} className="u-faint">Positions are last GPS fixes · refreshed 30s</span>
      </div>
    </div>
  );
}

/* ============================================================ */

export default function Transport() {
  const navigate = useNavigate();
  const { session, domain, dispatch, actorName } = useStore();
  const toast = useToast();
  const campus = session.activeCampus;
  const isTransportRole = session.roleId === 'transport';

  const routes = useAsync(() => transportService.routes(campus), [campus]);
  const [simulating, setSimulating] = useState(false);
  const [extraDelay, setExtraDelay] = useState(0);

  const routeList = routes.data ?? [];
  const delayed = routeList.filter(r => r.status === 'delayed');
  const r7 = routeList.find(r => r.id === 'route_7');
  const r7Delay = (r7?.delayMins ?? 13) + extraDelay;

  const transportCases = useMemo(
    () => domain.cases.filter(c => c.kind === 'transport' && c.campus === campus),
    [domain.cases, campus],
  );

  const studentsOnRoutes = routeList.reduce((a, r) => a + r.students, 0);
  const atCapacity = routeList.filter(r => r.students / r.capacity > 0.9).length;

  const simulateDelay = async () => {
    setSimulating(true);
    try {
      await transportService.simulateBreakdown('route_7');
      const mins = 10 + extraDelay;
      setExtraDelay(d => d + 10);
      dispatch({
        type: 'event/add',
        e: {
          id: `ev_${Date.now()}`, on: new Date(), type: 'transport.delay.detected',
          label: `Bus 14 (Route 7) further delayed — running +${mins} min past Sector 12 bridge`,
          severity: 'warn', ref: '/transport',
        },
      });
      dispatch({
        type: 'audit/add',
        entry: {
          actor: actorName, actorRole: session.roleId, action: 'Simulated delay — Bus 14 (Route 7)',
          recordType: 'Route', recordRef: 'Route 7 — Sector 12 · Bus 14',
          reason: 'Ops drill: verify guardian ETA updates and attendance leniency',
          policyRef: 'Transport §3.1 · Attendance §1.4 (leniency for delayed routes)',
          aiInvolved: false, risk: 'low',
          outcome: `Guardian ETA notifications queued for 38 students · attendance leniency active until 09:30`,
        },
      });
      toast({
        title: 'Bus 14 delay simulated',
        sub: 'Guardians of 38 students will be notified within 15 minutes (Transport §3.1). Attendance leniency stays on until 09:30.',
        tone: 'info',
      });
    } catch {
      toast({ title: 'Drill could not start', sub: 'The transport service did not accept the drill. Try again.', tone: 'error' });
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div>
      <style>{MAP_STYLE}</style>
      <PageHead
        title="Transport"
        sub={isTransportRole
          ? 'Your live board — routes, vehicles and the families waiting on them. Guardian notifications fire automatically per Transport §3.1.'
          : 'Live route status, capacity and today\'s transport cases. Delays over 10 minutes notify guardians automatically (Transport §3.1).'}
        actions={
          <Button variant="secondary" icon={<Icon.Zap size={14} />} loading={simulating} onClick={simulateDelay}>
            Simulate Bus 14 delay
          </Button>
        }
      />

      {/* ---- Stats ---- */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <Stat label="Routes active" value={routeList.length} sub={`${delayed.length} delayed · ${routeList.filter(r => r.status === 'maintenance').length} in maintenance`} />
        <Stat label="Students riding" value={studentsOnRoutes} sub={`${atCapacity} routes above 90% capacity`} />
        <Stat label="Bus 14 delay" value={`+${r7Delay} min`} sub={r7Delay > 10 ? 'Guardians notified · leniency till 09:30' : 'Within notification threshold'} />
        <Stat label="Transport cases" value={transportCases.length} sub={`${transportCases.filter(c => c.status !== 'resolved' && c.status !== 'closed').length} open`} onClick={() => navigate('/cases')} />
      </div>

      {/* ---- Live map ---- */}
      <Section
        title="Live map"
        sub="Campus pin and route polylines. Bus dots pulse at their last GPS fix — Bus 14 is highlighted while Route 7 is delayed."
        style={{ marginBottom: 28 }}
      >
        {routes.loading ? (
          <Skeleton h={300} r={12} />
        ) : routes.error ? (
          <Card pad><ErrorState title="Could not load route positions" sub={routes.error} onRetry={routes.retry} /></Card>
        ) : (
          <LiveMap routes={routeList} />
        )}
      </Section>

      {/* ---- Route cards ---- */}
      <Section
        title="Routes"
        sub="Capacity, crew and next stops per route. Route 7 carries 38 students and is linked to incident inc_1."
      >
        {routes.loading ? (
          <div className="grid grid-3"><SkeletonCard lines={6} /><SkeletonCard lines={6} /><SkeletonCard lines={6} /></div>
        ) : routes.error ? (
          <Card pad><ErrorState title="Could not load routes" sub={routes.error} onRetry={routes.retry} /></Card>
        ) : routeList.length === 0 ? (
          <Card pad><Empty icon={<Icon.Bus size={22} />} title="No routes on this campus" sub="No transport is scoped to the active campus." /></Card>
        ) : (
          <div className="grid grid-3">
            {routeList.map(r => (
              <RouteCard key={r.id} route={{ ...r, delayMins: r.id === 'route_7' ? r7Delay : r.delayMins }} onOpenIncident={() => navigate('/incidents')} />
            ))}
          </div>
        )}
      </Section>

      {/* ---- Transport cases ---- */}
      <Section
        title="Transport cases"
        sub="Cases of kind transport from the case queue — complaints, pickup changes and incident follow-ups."
        actions={<Button size="sm" variant="secondary" iconRight={<Icon.ArrowRight size={12} />} onClick={() => navigate('/cases')}>Open case queue</Button>}
        style={{ marginTop: 8 }}
      >
        <Card>
          {transportCases.length === 0 ? (
            <Empty icon={<Icon.Clipboard size={22} />} title="No transport cases" sub="Nothing open for this campus right now." />
          ) : (
            <div className="u-col" style={{ padding: '6px 16px' }}>
              {transportCases.map(c => {
                const open = c.status !== 'resolved' && c.status !== 'closed';
                return (
                  <div key={c.id} className="u-between" style={{ gap: 12, padding: '11px 0', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }} role="button" tabIndex={0} onClick={() => navigate(`/cases/${c.id}`)} onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); navigate(`/cases/${c.id}`); } }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="u-flex" style={{ gap: 8 }}>
                        <span style={{ fontWeight: 580 }}>{c.title}</span>
                        <Badge tone={open ? (c.priority === 'high' ? 'danger' : 'warning') : 'success'} dot>{c.status}</Badge>
                      </div>
                      <div className="u-xs u-faint" style={{ marginTop: 2 }}>
                        {c.id} · opened {fmtTime(c.openedOn)} · owner {c.owner} · SLA {c.slaHours}h
                      </div>
                    </div>
                    <Icon.ChevronRight size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </Section>

      <div style={{ height: 20 }} />
      <div className="u-small u-muted">
        Data scope follows your role: transport staff see the operational view; other roles read the same live positions without
        dispatch controls. Delay notifications and attendance leniency run as workflows (wf_2, Attendance §1.4) — they are not manual steps.
      </div>
    </div>
  );
}
