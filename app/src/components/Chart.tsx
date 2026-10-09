/* Dependency-free chart kit. Deterministic, animated, calm. */

interface AxisProps { min?: number; max?: number; }

function niceScale(min: number, max: number, ticks = 4): { min: number; max: number; ticks: number[] } {
  if (min === max) { max = min + 1; }
  const range = max - min;
  const step0 = range / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(6));
  return { min: lo, max: hi, ticks: out };
}

export interface LineSeries { name: string; color: string; points: number[]; dashed?: boolean; }

export function LineChart({ series, labels, height = 180, yFormat = (v: number) => String(Math.round(v)), showGrid = true, area = false, min, max }: {
  series: LineSeries[]; labels?: string[]; height?: number;
  yFormat?: (v: number) => string; showGrid?: boolean; area?: boolean;
} & AxisProps) {
  const W = 600, H = height, PL = 44, PR = 10, PT = 12, PB = 22;
  const all = series.flatMap(s => s.points);
  const scale = niceScale(min ?? Math.min(...all), max ?? Math.max(...all));
  const xw = (W - PL - PR) / Math.max(1, (series[0]?.points.length ?? 1) - 1);
  const y = (v: number) => PT + (1 - (v - scale.min) / (scale.max - scale.min)) * (H - PT - PB);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="line chart" className="chart-svg">
      {showGrid && scale.ticks.map(t => (
        <g key={t}>
          <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke="var(--border-subtle)" strokeWidth="1" />
          <text x={PL - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-3)">{yFormat(t)}</text>
        </g>
      ))}
      {series.map((s, si) => {
        const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(PL + i * xw).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
        return (
          <g key={s.name}>
            {/* CHART-1: the area fill appends `L… L… Z` to the line's `d`. When the series has no
                points, `d` is the empty string, so the path became " L-502,168 L60,168 Z" — it
                starts with lineto instead of moveto, which SVG forbids. Chrome dropped the whole
                path and logged `<path> attribute d: Expected moveto path command ('M' or 'm')`,
                twice per empty chart. The negative x is the tell: `points.length - 1` is -1, so the
                first corner lands left of the origin. An empty chart should draw no area at all. */}
            {area && si === 0 && s.points.length > 0 && (
              <path d={`${d} L${PL + (s.points.length - 1) * xw},${H - PB} L${PL},${H - PB} Z`} fill={s.color} opacity="0.08" />
            )}
            <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '5 4' : undefined}
              strokeLinecap="round" strokeLinejoin="round" style={{ strokeDasharray: s.dashed ? '5 4' : '1200', animation: 'drawLine 900ms var(--ease-out)' }} />
            {s.points.length <= 14 && s.points.map((p, i) => (
              <circle key={i} cx={PL + i * xw} cy={y(p)} r={2.6} fill="var(--surface)" stroke={s.color} strokeWidth="1.6" />
            ))}
          </g>
        );
      })}
      {labels && labels.map((l, i) => {
        const n = series[0]?.points.length ?? 0;
        const step = Math.ceil(n / Math.min(8, n));
        if (i % step !== 0 && i !== n - 1) return null;
        return <text key={i} x={PL + i * xw} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text-3)">{l}</text>;
      })}
    </svg>
  );
}

export function BarChart({ data, height = 180, color = 'var(--accent)', format = (v: number) => String(Math.round(v)), horizontal = false, highlightMax = true }: {
  data: { label: string; value: number; color?: string }[]; height?: number; color?: string;
  format?: (v: number) => string; horizontal?: boolean; highlightMax?: boolean;
}) {
  const max = Math.max(...data.map(d => d.value), 1);
  const maxLabel = data.reduce((a, b) => (b.value > a.value ? b : a), data[0]);
  if (horizontal) {
    return (
      <div className="u-col" style={{ gap: 10 }}>
        {data.map(d => (
          <div key={d.label} className="u-col" style={{ gap: 4 }}>
            <div className="u-between u-xs" style={{ gap: 8 }}>
              <span className="u-truncate" style={{ fontWeight: d === maxLabel && highlightMax ? 600 : 400 }}>{d.label}</span>
              <span className="mono u-faint">{format(d.value)}</span>
            </div>
            <div className="progress" style={{ height: 7 }}>
              <div style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? color, transition: 'width var(--t-slow) var(--ease-out)' }} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  const W = 600, H = height, PB = 24, PT = 8;
  const bw = (W - 8) / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="bar chart" className="chart-svg">
      {data.map((d, i) => {
        const h = ((d.value / max) * (H - PB - PT));
        const isMax = highlightMax && d === maxLabel;
        return (
          <g key={d.label}>
            <rect x={4 + i * bw + bw * 0.18} y={H - PB - h} width={bw * 0.64} height={Math.max(2, h)} rx={4}
              fill={d.color ?? color} opacity={isMax ? 1 : 0.82} style={{ transformOrigin: `50% ${H - PB}px`, animation: `popIn 500ms var(--ease-out) ${i * 30}ms backwards` }} />
            <text x={4 + i * bw + bw / 2} y={H - 7} textAnchor="middle" fontSize="10" fill="var(--text-3)">
              {d.label.length > 9 ? d.label.slice(0, 8) + '…' : d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Sparkline({ points, color = 'var(--accent)', height = 30, width = 90, fill = true }: {
  points: number[]; color?: string; height?: number; width?: number; fill?: boolean;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const xw = width / (points.length - 1);
  const y = (v: number) => 2 + (1 - (v - min) / range) * (height - 4);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * xw).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      {fill && <path d={`${d} L${width},${height} L0,${height} Z`} style={{ fill: color }} opacity="0.09" />}
      <path d={d} fill="none" style={{ stroke: color }} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Donut({ segments, size = 120, thickness = 14, centerLabel, centerSub }: {
  segments: { label: string; value: number; color: string }[]; size?: number; thickness?: number;
  centerLabel?: string; centerSub?: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'var(--surface-3)' }} strokeWidth={thickness} />
          {segments.map(s => {
            const len = (s.value / total) * c;
            const el = (
              <circle key={s.label} cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: s.color, transition: 'stroke-dasharray var(--t-slow) var(--ease-out)' }} strokeWidth={thickness}
                strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} strokeLinecap="butt" />
            );
            offset += len;
            return el;
          })}
        </svg>
        {centerLabel && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 17, fontWeight: 650, letterSpacing: '-0.02em' }}>{centerLabel}</span>
            {centerSub && <span className="u-xs u-faint">{centerSub}</span>}
          </div>
        )}
      </div>
      <div className="u-col" style={{ gap: 6, minWidth: 0 }}>
        {segments.map(s => (
          <div key={s.label} className="u-flex u-xs" style={{ gap: 7 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span className="u-truncate">{s.label}</span>
            <span className="mono u-faint" style={{ marginLeft: 'auto' }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Heatmap({ weeks, data, colorFor }: { weeks: number; data: number[]; colorFor: (v: number) => string }) {
  const cell = 13, gap = 3;
  const rows = 7;
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={weeks * (cell + gap)} height={rows * (cell + gap)} role="img" aria-label="activity heatmap">
        {data.slice(0, weeks * rows).map((v, i) => {
          const col = Math.floor(i / rows), row = i % rows;
          return <rect key={i} x={col * (cell + gap)} y={row * (cell + gap)} width={cell} height={cell} rx={3}
            fill={colorFor(v)} style={{ animation: `fadeIn 400ms var(--ease) ${col * 8}ms backwards` }} />;
        })}
      </svg>
    </div>
  );
}

/* convenience re-export (canonical impl lives in components/ui) */
export { SegmentedBar } from './ui';
