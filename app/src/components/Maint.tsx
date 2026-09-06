/* ============================================================
   Maintenance component kit — shared across all maintenance
   surfaces and the operating screens (Today / Attention / Ask).
   One visual language: reuses tokens, Badge, Card, Progress.
   ============================================================ */
import type { CSSProperties, ReactNode } from 'react';
import type { AssetRecord, MaintPriority, WorkOrderRecord, WOStatus } from '../types/domain';
import { WO_FLOW } from '../lib/woFlow';
import { Badge } from './ui';
import { Icon } from './Icon';
import { fmtTime } from '../lib/format';

/* ---------- Priority ---------- */
const PRIO_META: Record<MaintPriority, { label: string; tone: 'danger' | 'warning' | 'info' | 'neutral'; dot: string }> = {
  emergency: { label: 'Emergency', tone: 'danger', dot: 'var(--chart-red-deep)' },
  critical: { label: 'Critical', tone: 'danger', dot: 'var(--chart-red)' },
  high: { label: 'High', tone: 'warning', dot: 'var(--chart-amber)' },
  medium: { label: 'Medium', tone: 'info', dot: 'var(--chart-blue)' },
  low: { label: 'Low', tone: 'neutral', dot: 'var(--chart-slate)' },
};
export function PriorityBadge({ p, size }: { p: MaintPriority; size?: 'sm' }) {
  const m = PRIO_META[p];
  return (
    <span className={`u-inline ${size === 'sm' ? 'u-small' : ''}`} style={{ alignItems: 'center', gap: 5 }}>
      <span style={{ width: 7, height: 7, borderRadius: 9, background: m.dot, boxShadow: p === 'emergency' ? '0 0 0 3px color-mix(in srgb, var(--chart-red-deep) 18%, transparent)' : undefined }} />
      <span style={{ fontWeight: 600, fontSize: size === 'sm' ? 11 : 12, color: p === 'emergency' || p === 'critical' ? 'var(--danger-text)' : 'var(--text-2)' }}>{m.label}</span>
    </span>
  );
}

/* ---------- Work-order status ---------- */
const STATUS_META: Record<WOStatus, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'ai'; icon: keyof typeof Icon }> = {
  reported: { label: 'Reported', tone: 'neutral', icon: 'Flag' },
  assigned: { label: 'Assigned', tone: 'info', icon: 'User' },
  accepted: { label: 'Accepted', tone: 'info', icon: 'Check' },
  'en-route': { label: 'En route', tone: 'accent', icon: 'ArrowRight' },
  'on-site': { label: 'On site', tone: 'accent', icon: 'Compass' },
  repairing: { label: 'Repairing', tone: 'warning', icon: 'Wrench' },
  verification: { label: 'Awaiting verification', tone: 'ai', icon: 'Eye' },
  resolved: { label: 'Resolved', tone: 'success', icon: 'Check' },
  closed: { label: 'Closed', tone: 'success', icon: 'Check' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'Trash' },
};
export function WOStatusChip({ s }: { s: WOStatus }) {
  const m = STATUS_META[s];
  const I = Icon[m.icon] as typeof Icon.Flag;
  return <Badge tone={m.tone}>{<I size={11} />} {m.label}</Badge>;
}
export const woStatusLabel = (s: WOStatus) => STATUS_META[s].label;

/* ---------- SLA indicator ---------- */
export function SLAIndicator({ sla, breach, tone, size = 'md' }: { sla: { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' }; breach?: boolean; tone?: never; size?: 'sm' | 'md' }) {
  void tone;
  const icon = sla.tone === 'danger' ? <Icon.Alert size={12} /> : sla.tone === 'warning' ? <Icon.Clock size={12} /> : <Icon.Check size={12} />;
  return (
    <span
      className={`u-inline u-mono ${size === 'sm' ? 'u-small' : ''}`}
      style={{
        alignItems: 'center', gap: 5, fontSize: size === 'sm' ? 11 : 12, fontWeight: 560,
        color: sla.tone === 'danger' ? 'var(--danger-text)' : sla.tone === 'warning' ? 'var(--warning-text, var(--text-2))' : 'var(--text-3)',
        background: sla.tone === 'danger' ? 'color-mix(in srgb, var(--danger) 8%, transparent)' : sla.tone === 'warning' ? 'color-mix(in srgb, var(--chart-amber) 8%, transparent)' : 'var(--surface-3)',
        padding: '3px 8px', borderRadius: 999, border: `1px solid ${sla.tone === 'danger' ? 'color-mix(in srgb, var(--danger) 22%, transparent)' : 'var(--border)'}`,
        whiteSpace: 'nowrap',
      }}
    >
      {icon} {breach ? 'SLA ' : ''}{sla.label}
    </span>
  );
}

/* ---------- Asset health ring ---------- */
export function HealthRing({ score, size = 40 }: { score: number; size?: number }) {
  const r = size / 2 - 3.5;
  const c = 2 * Math.PI * r;
  const col = score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--chart-blue)' : score >= 40 ? 'var(--chart-amber)' : 'var(--chart-red)';
  return (
    <span style={{ position: 'relative', width: size, height: size, display: 'inline-grid', placeItems: 'center', flexShrink: 0 }} role="img" aria-label={`Health ${score} of 100`}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-subtle)" strokeWidth={4} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={4} strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} />
      </svg>
      <span className="u-mono" style={{ position: 'absolute', fontSize: size > 44 ? 13 : 11, fontWeight: 640, color: col }}>{score}</span>
    </span>
  );
}

/* ---------- Asset tag (QR-ish identity chip) ---------- */
export function AssetTag({ id, onClick }: { id: string; onClick?: () => void }) {
  return (
    <button
      className="u-inline u-mono"
      onClick={onClick}
      style={{
        alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--text-2)',
        background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 6,
        padding: '2px 7px', cursor: onClick ? 'pointer' : 'default', letterSpacing: '0.02em',
      }}
      title={`Asset ${id}`}
    >
      <Icon.Grid size={11} style={{ color: 'var(--text-3)' }} /> {id}
    </button>
  );
}

/* Deterministic QR-style tag (decorative demo — labelled as such) */
export function QRPattern({ seedText, size = 92 }: { seedText: string; size?: number }) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) { h ^= seedText.charCodeAt(i); h = Math.imul(h, 16777619); }
  const rng = (n: number) => { h = Math.imul(h ^ (h >>> 15), 2246822519) + n | 0; return ((h >>> 8) % 97) / 97; };
  const n = 11; const cell = size / (n + 2);
  const cells: ReactNode[] = [];
  const finder = (x: number, y: number) => (
    <g key={`f${x}${y}`}>
      <rect x={x * cell} y={y * cell} width={cell * 3} height={cell * 3} fill="none" stroke="currentColor" strokeWidth={cell * 0.55} />
    </g>
  );
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const inFinder = (x < 4 && y < 4) || (x > n - 5 && y < 4) || (x < 4 && y > n - 5);
    if (!inFinder && rng(y * n + x) > 0.52) cells.push(<rect key={`${x}-${y}`} x={(x + 1.5) * cell} y={(y + 1.5) * cell} width={cell * 0.92} height={cell * 0.92} fill="currentColor" rx={1} />);
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ color: 'var(--text-2)' }} aria-label={`Asset QR tag ${seedText} (demo pattern)`}>
      {cells}
      {finder(1, 1)}{finder(n - 3.5, 1)}{finder(1, n - 3.5)}
    </svg>
  );
}

/* ---------- Work-order lifecycle stepper ---------- */
export function WOStepper({ wo }: { wo: WorkOrderRecord }) {
  const idx = WO_FLOW.indexOf(wo.status);
  const cancelled = wo.status === 'cancelled';
  const done = ['resolved', 'closed'].includes(wo.status);
  const stepTime = (s: WOStatus) => {
    const t: Partial<Record<WOStatus, Date | undefined>> = {
      reported: wo.reportedOn, assigned: wo.assignedOn, accepted: wo.acceptedOn,
      'on-site': wo.startedOn, verification: wo.completedOn, resolved: wo.completedOn,
    };
    return t[s];
  };
  if (cancelled) return <Badge tone="neutral">Cancelled</Badge>;
  return (
    <div className="wo-stepper" role="list" aria-label="Work order progress">
      {WO_FLOW.map((s, i) => {
        const state = done ? 'done' : i < idx ? 'done' : i === idx ? 'current' : 'todo';
        const t = stepTime(s);
        return (
          <div key={s} role="listitem" className={`wo-step ${state}`} title={woStatusLabel(s)}>
            <span className="wo-step-dot" />
            <span className="wo-step-label">{woStatusLabel(s)}</span>
            {t && state === 'done' && <span className="wo-step-time">{fmtTime(t)}</span>}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- AI understanding panel (concise, evidence-first) ---------- */
export function AiUnderstanding({ wo }: { wo: WorkOrderRecord }) {
  const u = wo.aiUnderstanding;
  if (!u) return null;
  return (
    <div className="u-col" style={{ gap: 10 }}>
      <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Badge tone="ai"><Icon.Sparkle size={11} /> Understood by SchoolOS</Badge>
        <Badge tone="outline">{u.category}</Badge>
        {u.assetMatch && <AssetTag id={u.assetMatch.assetId} />}
        <Badge tone="outline">{Math.round(u.confidence * 100)}% confidence</Badge>
        {u.safetyRelevant && <Badge tone="danger"><Icon.Alert size={11} /> Safety-relevant</Badge>}
      </div>
      <ul className="u-col" style={{ gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
        {u.reasoning.map((r, i) => (
          <li key={i} className="u-inline" style={{ gap: 8, alignItems: 'flex-start', fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}>
            <span className="u-mono" style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 1 }}>{String(i + 1).padStart(2, '0')}</span>{r}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Priority factor list (deterministic "why this priority") ---------- */
export function PriorityWhy({ factors }: { factors: NonNullable<WorkOrderRecord['priorityFactors']> }) {
  const total = factors.reduce((a, f) => a + f.weight, 0) || 1;
  return (
    <div className="u-col" style={{ gap: 8 }}>
      {factors.map(f => (
        <div key={f.factor} className="u-col" style={{ gap: 3 }}>
          <div className="u-inline" style={{ justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
            <span style={{ fontWeight: 560 }}>{f.factor}</span>
            <span className="u-mono u-small u-muted">{Math.round((f.weight / total) * 100)}%</span>
          </div>
          <div style={{ height: 4, borderRadius: 4, background: 'var(--surface-3)', overflow: 'hidden' }}>
            <div style={{ width: `${(f.weight / total) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 4 }} />
          </div>
          <span className="u-small u-muted">{f.note}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Assignment panel (recommendation + why) ---------- */
export function TechnicianWhy({ why, score }: { why: string[]; score?: number }) {
  return (
    <div className="u-col" style={{ gap: 5 }}>
      {why.map((w, i) => (
        <span key={i} className="u-inline" style={{ gap: 6, fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}>
          <Icon.Check size={12} style={{ color: 'var(--success-text, var(--accent-text))', flexShrink: 0 }} /> {w}
        </span>
      ))}
      {score !== undefined && <span className="u-small u-muted">Match score {Math.round(score * 100)}%</span>}
    </div>
  );
}

/* ---------- Asset mini-card ---------- */
export function AssetMini({ asset, onClick, style }: { asset: AssetRecord; onClick?: () => void; style?: CSSProperties }) {
  return (
    <button
      onClick={onClick}
      className="u-inline"
      style={{
        gap: 12, alignItems: 'center', width: '100%', textAlign: 'left', cursor: onClick ? 'pointer' : 'default',
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
        padding: '12px 14px', ...style,
      }}
    >
      <HealthRing score={asset.health} />
      <div className="u-col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
        <span className="u-inline" style={{ gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{asset.name}</span>
          <AssetTag id={asset.id} />
        </span>
        <span className="u-small u-muted">{asset.building}{asset.room ? ` · ${asset.room}` : ''} · {asset.category}{asset.failures.length ? ` · ${asset.failures.length} failures` : ''}</span>
      </div>
      <StatusDot status={asset.status} />
    </button>
  );
}

const ASSET_STATUS: Record<AssetRecord['status'], { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  operational: { label: 'Operational', tone: 'success' },
  watch: { label: 'Watch', tone: 'info' },
  degraded: { label: 'Degraded', tone: 'warning' },
  down: { label: 'Down', tone: 'danger' },
  maintenance: { label: 'In maintenance', tone: 'info' },
  retired: { label: 'Retired', tone: 'neutral' },
};
export function StatusDot({ status }: { status: AssetRecord['status'] }) {
  const m = ASSET_STATUS[status];
  return <Badge tone={m.tone} dot>{m.label}</Badge>;
}
export const assetStatusLabel = (s: AssetRecord['status']) => ASSET_STATUS[s].label;

/* ---------- live event bridge (services → store) ---------- */
export function useLiveEventBridge(dispatch: (a: { type: 'event/add'; e: { id: string; on: Date; type: string; label: string; severity: 'info' | 'warn' | 'critical'; ref?: string } }) => void) {
  /* mounted once in App — services push window events; store keeps feed */
  if (typeof window !== 'undefined' && !(window as unknown as { __woBridge?: boolean }).__woBridge) {
    (window as unknown as { __woBridge?: boolean }).__woBridge = true;
    window.addEventListener('schoolos:live-event', (e) => {
      const d = (e as CustomEvent<{ label: string; severity: 'info' | 'warn' | 'critical'; type: string; ref?: string }>).detail;
      dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}_${Math.round(Math.random() * 999)}`, on: new Date(), type: d.type, label: d.label, severity: d.severity, ref: d.ref } });
    });
  }
}
