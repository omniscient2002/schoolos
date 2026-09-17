/* ============================================================
   SchoolOS · "The Living Register" — motion primitives.
   The React half of the character layer (styles/character.css
   is the CSS half). Everything here is OPTIONAL sugar: each
   component degrades to its static form under
   prefers-reduced-motion and when IntersectionObserver is
   missing, so screens can adopt them one at a time.
   ============================================================ */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/* One reduced-motion read per tab; listeners keep it honest. */
function useReducedMotion(): boolean {
  const [rm, setRm] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setRm(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return rm;
}

/* ============ Reveal ============
   Fades-and-settles its children the first time they scroll into
   view — the register line being written as you reach it. */
export function Reveal({ children, delay = 0, as: Tag = 'div', className = '', style }: {
  children: ReactNode; delay?: number; as?: 'div' | 'section' | 'li'; className?: string; style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const rm = useReducedMotion();
  useEffect(() => {
    if (seen || rm) { setSeen(true); return; }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver(
      (es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, rm]);
  return (
    <Tag
      ref={ref as never}
      className={`reveal ${seen ? 'reveal-in' : ''} ${className}`}
      style={{ ...(delay ? { '--reveal-delay': `${delay}ms` } : {}), ...style } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

/* ============ Roll ============
   A roll-call container: children arrive one after another
   (pure CSS stagger via .roll; this wrapper only guarantees the
   class + a key so re-mounts replay the call). */
export function Roll({ children, className = '', style, keyId }: {
  children: ReactNode; className?: string; style?: CSSProperties; keyId?: string;
}) {
  return (
    <div key={keyId} className={`roll ${className}`} style={style}>
      {children}
    </div>
  );
}

/* ============ Ticker / useCountUp ============
   Numbers land like a stamp, then count up — data that arrives,
   not data that's just there. */
export function useCountUp(target: number, { duration = 700, enabled = true }: { duration?: number; enabled?: boolean } = {}): number {
  const [v, setV] = useState(enabled ? 0 : target);
  const rm = useReducedMotion();
  useEffect(() => {
    if (!enabled || rm || typeof requestAnimationFrame !== 'function') { setV(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3); /* easeOutCubic */
      setV(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, enabled, rm]);
  return v;
}

export function Ticker({ value, duration, format, style }: {
  value: number; duration?: number; format?: (n: number) => string; style?: CSSProperties;
}) {
  const shown = useCountUp(value, { duration });
  const out = format ? format(shown) : shown.toLocaleString('en-IN'); /* Indian digit grouping by default */
  return <span style={style}>{out}</span>;
}

/* ============ PulseDot ============
   The heartbeat. A live indicator that rings twice, like the
   front-desk bell. `tone` maps to semantic status tokens. */
export function PulseDot({ tone = 'success', size = 8, label, style }: {
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'ai' | 'accent'; size?: number; label?: string; style?: CSSProperties;
}) {
  const color = {
    success: 'var(--status-success)', warning: 'var(--status-warning)', danger: 'var(--status-critical)',
    info: 'var(--status-info)', ai: 'var(--status-ai)', accent: 'var(--accent)',
  }[tone];
  return (
    <span className="pulse-dot" style={{ width: size, height: size, '--pd': color, ...style } as CSSProperties} role="img" aria-label={label ?? 'live'}>
      <i />
    </span>
  );
}

/* ============ AiOrb ============
   The receptionist's presence — a breathing iris orb. `think`
   quickens the breath while work is happening. Decorative by
   default; pass a label to make it meaningful to AT. */
export function AiOrb({ size = 'md', think, label, style }: { size?: 'sm' | 'md'; think?: boolean; label?: string; style?: CSSProperties }) {
  return <span className={`ai-orb ${size === 'sm' ? 'sm' : ''} ${think ? 'think' : ''}`} style={style} role="img" aria-label={label ?? 'SchoolOS assistant'} />;
}
