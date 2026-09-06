/* ============================================================
   Flow — the reusable visual grammar of the operating loop.
   EventTimeline · ActionChain · LoopClosed · StepRail
   Used by Migration, Action Center, Parent loop, WO detail,
   Cases, Audit, Memory — one grammar everywhere.
   ============================================================ */
import type { ReactNode } from 'react';
import { Icon } from './Icon';

/* ---------- EventTimeline: a timestamped chain of what happened ---------- */
export interface TimelineEntry {
  time: Date | string;
  label: string;
  detail?: string;
  kind?: 'detect' | 'understand' | 'act' | 'verify' | 'close' | 'note' | 'ai' | 'guard';
  ref?: { label: string; to?: string };
}

const KIND_META: Record<NonNullable<TimelineEntry['kind']>, { color: string; icon: keyof typeof Icon }> = {
  detect: { color: 'var(--warning)', icon: 'Attention' },
  understand: { color: 'var(--ai)', icon: 'Sparkle' },
  act: { color: 'var(--accent)', icon: 'Send' },
  verify: { color: 'var(--info, var(--accent))', icon: 'Check' },
  close: { color: 'var(--success)', icon: 'Check' },
  note: { color: 'var(--text-3)', icon: 'Message' },
  ai: { color: 'var(--ai)', icon: 'Sparkle' },
  guard: { color: 'var(--ai)', icon: 'Shield' },
};

export function EventTimeline({ items, compact }: { items: TimelineEntry[]; compact?: boolean }) {
  return (
    <div role="list" aria-label="Event timeline" className="u-col" style={{ gap: 0 }}>
      {items.map((it, i) => {
        const meta = KIND_META[it.kind ?? 'note'];
        const last = i === items.length - 1;
        const time = typeof it.time === 'string' ? it.time : it.time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        return (
          <div key={i} role="listitem" className="u-inline" style={{ gap: 12, alignItems: 'stretch' }}>
            <div className="u-col" style={{ gap: 0, alignItems: 'center', width: 18, flexShrink: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: meta.color, marginTop: 5, boxShadow: '0 0 0 3px color-mix(in srgb, currentColor 12%, transparent)' }} />
              {!last && <span style={{ width: 1.5, flex: 1, background: 'var(--border)' }} />}
            </div>
            <div className="u-col" style={{ gap: 2, flex: 1, paddingBottom: last ? 0 : (compact ? 10 : 14) }}>
              <div className="u-inline" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="u-mono u-xs" style={{ color: 'var(--text-3)', width: 40, flexShrink: 0 }}>{time}</span>
                <span style={{ fontWeight: 570, fontSize: compact ? 'var(--text-sm)' : 'var(--text-md)' }}>{it.label}</span>
                {it.kind && <span className="u-xs u-faint u-upper" style={{ color: meta.color }}>{it.kind}</span>}
              </div>
              {it.detail && <div className="u-small u-muted" style={{ paddingLeft: 48, lineHeight: 1.55 }}>{it.detail}</div>}
              {it.ref && (
                <div style={{ paddingLeft: 48 }}>
                  {it.ref.to
                    ? <a href={it.ref.to} className="u-small" style={{ color: 'var(--accent-text)' }}>{it.ref.label} →</a>
                    : <span className="u-small u-muted">{it.ref.label}</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- ActionChain: the spine of one action, with live states ---------- */
export type ChainState = 'pending' | 'running' | 'done' | 'skipped';
export interface ChainStep {
  id: string;
  label: string;
  detail?: string;
  state: ChainState;
  at?: string;               // timestamp once done
  ref?: { label: string; to?: string };
}
const STEP_ORDER: ChainStep['id'][] = ['trigger', 'policy', 'evidence', 'proposal', 'approval', 'execution', 'verification', 'audit'];
const STEP_ICON: Record<string, keyof typeof Icon> = {
  trigger: 'Attention', policy: 'Shield', evidence: 'Database', proposal: 'Sparkle',
  approval: 'User', execution: 'Send', verification: 'Check', audit: 'Lock',
};

export function ActionChain({ steps }: { steps: ChainStep[] }) {
  const ordered = [...steps].sort((a, b) => STEP_ORDER.indexOf(a.id) - STEP_ORDER.indexOf(b.id));
  return (
    <div role="list" aria-label="Action chain" className="u-inline" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {ordered.map((s, i) => {
        const I = Icon[STEP_ICON[s.id] ?? 'Message'];
        const tone = s.state === 'done' ? { bg: 'color-mix(in srgb, var(--success) 12%, transparent)', fg: 'var(--success-text, var(--accent-text))' }
          : s.state === 'running' ? { bg: 'color-mix(in srgb, var(--accent) 12%, transparent)', fg: 'var(--accent-text)' }
          : s.state === 'skipped' ? { bg: 'var(--surface-3)', fg: 'var(--text-3)' }
          : { bg: 'var(--surface-2)', fg: 'var(--text-3)' };
        return (
          <span key={s.id} className="u-inline" style={{ gap: 6, alignItems: 'center' }}>
            <span
              title={`${s.label}${s.detail ? ` — ${s.detail}` : ''}${s.at ? ` · ${s.at}` : ''}`}
              className="u-inline u-small"
              style={{
                gap: 6, padding: '5px 10px', borderRadius: 999, border: '1px solid var(--border-subtle)',
                background: tone.bg, color: tone.fg, fontWeight: 550,
                animation: s.state === 'running' ? 'pulse 1.2s infinite' : undefined,
              }}
            >
              <I size={12} /> {s.label}
              {s.state === 'done' && s.at && <span className="u-mono u-xs" style={{ opacity: 0.75 }}>{s.at}</span>}
            </span>
            {i < ordered.length - 1 && <span style={{ color: 'var(--text-3)', fontSize: 11 }}>→</span>}
          </span>
        );
      })}
    </div>
  );
}

/* ---------- LoopClosed: the restrained, satisfying end state ---------- */
export function LoopClosed({ at, summary }: { at?: string; summary?: string }) {
  return (
    <div className="u-inline" style={{
      gap: 10, alignItems: 'center', padding: '12px 16px', borderRadius: 'var(--r-lg)',
      background: 'color-mix(in srgb, var(--success) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)',
    }}>
      <span style={{ width: 28, height: 28, borderRadius: 10, background: 'var(--success)', color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon.Check size={16} />
      </span>
      <div className="u-col" style={{ gap: 1 }}>
        <span style={{ fontWeight: 650, letterSpacing: '0.02em' }}>LOOP CLOSED</span>
        <span className="u-small u-muted">Detected → Understood → Acted → Verified → Closed{at ? ` · ${at}` : ''}</span>
        {summary && <span className="u-small u-muted">{summary}</span>}
      </div>
    </div>
  );
}

/* ---------- StepRail: the loop progress rail (MIGRATE → … → LIVE) ---------- */
export interface RailStep { id: string; label: string; state: ChainState; at?: string }
export function StepRail({ steps, title }: { steps: RailStep[]; title?: string }) {
  return (
    <div className="u-col" style={{ gap: 8 }}>
      {title && <span className="u-upper u-small" style={{ fontWeight: 640, color: 'var(--text-3)', letterSpacing: '0.06em' }}>{title}</span>}
      <div className="u-inline" style={{ gap: 0, flexWrap: 'wrap', alignItems: 'center' }}>
        {steps.map((s, i) => {
          const active = s.state === 'running';
          const done = s.state === 'done';
          return (
            <span key={s.id} className="u-inline" style={{ gap: 6, alignItems: 'center' }}>
              <span className="u-inline" style={{
                gap: 6, alignItems: 'center', padding: '6px 12px', borderRadius: 999,
                border: `1px solid ${done ? 'color-mix(in srgb, var(--success) 40%, transparent)' : active ? 'var(--accent)' : 'var(--border-subtle)'}`,
                background: done ? 'color-mix(in srgb, var(--success) 8%, transparent)' : active ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'var(--surface-2)',
                color: done ? 'var(--success-text, var(--accent-text))' : active ? 'var(--accent-text)' : 'var(--text-3)',
                fontWeight: 570, fontSize: 'var(--text-xs)', letterSpacing: '0.05em', textTransform: 'uppercase',
                animation: active ? 'pulse 1.4s infinite' : undefined,
              }}>
                {done && <Icon.Check size={11} />}
                {s.label}
                {s.at && <span className="u-mono" style={{ opacity: 0.7 }}>{s.at}</span>}
              </span>
              {i < steps.length - 1 && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>→</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- VerifyRow: an evidence-style verification checklist line ---------- */
export function VerifyRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="u-inline" style={{ gap: 9, alignItems: 'flex-start' }}>
      <span style={{
        width: 17, height: 17, borderRadius: 9, flexShrink: 0, marginTop: 1, display: 'grid', placeItems: 'center',
        background: ok ? 'var(--success)' : 'var(--surface-3)', color: ok ? '#fff' : 'var(--text-3)',
      }}>
        <Icon.Check size={11} />
      </span>
      <div className="u-col" style={{ gap: 0 }}>
        <span style={{ fontWeight: 550, fontSize: 'var(--text-sm)' }}>{label}</span>
        {detail && <span className="u-small u-muted">{detail}</span>}
      </div>
    </div>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="u-between" style={{ marginBottom: 8 }}>
      <span className="u-upper u-small" style={{ fontWeight: 640, color: 'var(--text-3)', letterSpacing: '0.06em' }}>{children}</span>
      {right}
    </div>
  );
}
