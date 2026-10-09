/* ============================================================
   AI presentation components — evidence chains, traces,
   approvals, drafts. The signature SchoolOS UX surface.
   ============================================================ */
import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Badge, Button } from './ui';
import type { AiBlock, AiResponse, AiTrace } from '../types/domain';
import { fmtRelative } from '../lib/format';
import { humanize } from '../lib/labels';

/* ---------- AI surface header ---------- */
export function AiHeader({ label = 'SchoolOS AI', confidence }: { label?: string; confidence?: 'high' | 'medium' }) {
  return (
    <div className="u-flex" style={{ gap: 8 }}>
      <span className="ai-chip"><Icon.Sparkle size={12} /> {label}</span>
      {confidence && <Badge tone={confidence === 'high' ? 'success' : 'warning'} dot>{confidence} confidence</Badge>}
    </div>
  );
}

/* ---------- Evidence chain ---------- */
export function EvidenceChain({ title, steps }: { title: string; steps: { label: string; detail: string; source: string; refType?: string }[] }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden', background: 'var(--surface)' }}>
      <div className="u-xs" style={{ padding: '8px 12px', fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-2)' }}>{title}</div>
      <div className="u-col">
        {steps.map((s, i) => (
          <div key={i} style={{ padding: '10px 12px', borderBottom: i < steps.length - 1 ? '1px solid var(--border-subtle)' : undefined }}>
            <div className="u-flex" style={{ gap: 8 }}>
              <span style={{ width: 18, height: 18, borderRadius: 6, background: 'var(--accent-weak)', color: 'var(--accent-text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 650, flexShrink: 0 }}>{i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 590, fontSize: 'var(--text-md)' }}>{s.label}</div>
                <div className="u-small u-muted">{s.detail}</div>
                <div className="u-xs u-faint" style={{ marginTop: 1 }}>From · {s.source}</div>
              </div>
            </div>
            {i < steps.length - 1 && <div style={{ marginLeft: 8, paddingLeft: 0, height: 8, borderLeft: '1.5px dashed var(--border-strong)', marginTop: 2 }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- AI Trace (signature) ---------- */
export function AiTraceCard({ trace, defaultOpen = false, compact }: { trace: AiTrace; defaultOpen?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const rows: { k: string; v: ReactNode }[] = [
    { k: 'Started by', v: trace.trigger },
    { k: 'Rule followed', v: trace.policy },
    { k: 'Records used', v: trace.dataUsed.join(' · ') },
    { k: 'Who decided', v: trace.reasoningRole },
    { k: 'Action taken', v: trace.action },
    { k: 'Approval', v: trace.approvalStatus },
    { k: 'How it was checked', v: trace.verification },
    /* Honesty (D-23): the fabricated model/latency/token/cost row was removed —
       no model exists in this product (deterministic templates server-side, canned
       strings client-side). Never present invented inference stats as fact. */
  ].filter(r => r.v);
  return (
    <div style={{ border: '1px solid var(--ai-weak-2)', borderRadius: 'var(--r-lg)', background: 'var(--ai-weak)', overflow: 'hidden' }}>
      <button className="u-between ai-trace-toggle" style={{ width: '100%', padding: compact ? '7px 12px' : '10px 14px' }} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="u-flex" style={{ gap: 8 }}>
          <Icon.Eye size={14} style={{ color: 'var(--ai-text)' }} />
          <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--ai-text)' }}>Why did SchoolOS do this?</span>
          <Badge tone="ai">Trace</Badge>
        </span>
        <Icon.ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--t-fast) var(--ease)', color: 'var(--ai-text)' }} />
      </button>
      {open && (
        <div style={{ padding: '4px 14px 12px', animation: 'slideUp var(--t-fast) var(--ease-out)' }}>
          {rows.map(r => (
            <div key={r.k} className="u-flex" style={{ gap: 12, padding: '5px 0', alignItems: 'flex-start' }}>
              <span className="u-xs" style={{ width: 92, flexShrink: 0, fontWeight: 640, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ai-text)', opacity: .75, paddingTop: 2 }}>{r.k}</span>
              <span className="u-small" style={{ minWidth: 0 }}>{r.v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- AI response renderer ---------- */
export function AiResponseView({ response, onAction }: { response: AiResponse; onAction?: (label: string) => void }) {
  return (
    <div className="u-col" style={{ gap: 14 }}>
      {response.blocks.map((b, i) => <AiBlockView key={i} block={b} onAction={onAction} />)}
      <AiTraceCard trace={response.trace} />
    </div>
  );
}

function AiBlockView({ block, onAction }: { block: AiBlock; onAction?: (label: string) => void }) {
  if (block.type === 'text') return <p style={{ fontSize: 'var(--text-md)', lineHeight: 1.65 }}>{block.text}</p>;
  if (block.type === 'note') return (
    <div className="u-flex" style={{ gap: 8, padding: '9px 12px', background: 'var(--info-weak)', borderRadius: 'var(--r-md)', fontSize: 'var(--text-sm)' }}>
      <Icon.Info size={14} style={{ color: 'var(--info)', flexShrink: 0, marginTop: 1 }} />
      <span>{block.text}</span>
    </div>
  );
  if (block.type === 'chain') return <EvidenceChain title={block.title} steps={block.steps} />;
  if (block.type === 'list') return (
    <div>
      <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>{block.title}</div>
      <div className="u-col" style={{ gap: 6 }}>
        {block.items.map((it, i) => (
          <div key={i} className="u-flex" style={{ gap: 10, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 570 }}>{it.label}</div>
              {it.detail && <div className="u-small u-muted">{it.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
  if (block.type === 'draft') return (
    <div style={{ border: '1px solid var(--ai-weak-2)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
      <div className="u-between" style={{ padding: '8px 12px', background: 'var(--ai-weak)' }}>
        <span className="u-flex" style={{ gap: 7 }}><Icon.Edit size={13} style={{ color: 'var(--ai-text)' }} /><span style={{ fontWeight: 620, fontSize: 'var(--text-sm)', color: 'var(--ai-text)' }}>{block.title}</span></span>
        <Badge tone="ai">AI draft · editable</Badge>
      </div>
      <div style={{ padding: 12 }}>
        <div className="u-xs u-faint" style={{ marginBottom: 6 }}>To: {block.audience} · via {block.channel}{block.language ? ` · ${block.language}` : ''}</div>
        <textarea className="textarea" defaultValue={block.body} rows={5} style={{ fontSize: 'var(--text-md)' }} aria-label="Editable draft" />
        <div className="u-flex" style={{ gap: 8, marginTop: 10 }}>
          <Button variant="primary" size="sm" icon={<Icon.Check size={13} />} onClick={() => onAction?.(`Draft approved: ${block.title}`)}>Approve & send</Button>
          <Button variant="ghost" size="sm" onClick={() => onAction?.('Draft saved for later')}>Save for later</Button>
        </div>
      </div>
    </div>
  );
  return null;
}

/* ---------- Suggested actions ---------- */
export function SuggestedActions({ actions, onApprove, compact }: { actions: { id: string; label: string; type: string; detail?: string; posture?: string }[]; onApprove?: (label: string) => void; compact?: boolean }) {
  if (!actions.length) return null;
  return (
    <div className="u-col" style={{ gap: 8 }}>
      <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Suggested actions</div>
      {actions.map(a => (
        <div key={a.id} className="u-between" style={{ gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface)' }}>
          <div style={{ minWidth: 0 }}>
            <div className="u-flex" style={{ gap: 7 }}>
              <span style={{ fontWeight: 570, fontSize: 'var(--text-md)' }}>{a.label}</span>
              {a.posture && <Badge tone={a.posture === 'APPROVAL' ? 'warning' : a.posture === 'HUMAN-ONLY' ? 'danger' : 'success'}>{a.posture === 'APPROVAL' ? 'Needs approval' : a.posture === 'HUMAN-ONLY' ? 'A person must do this' : 'Runs automatically'}</Badge>}
            </div>
            {a.detail && !compact && <div className="u-small u-muted" style={{ marginTop: 1 }}>{a.detail}</div>}
          </div>
          <Button size="sm" variant={a.posture === 'APPROVAL' ? 'ai' : 'secondary'} icon={<Icon.ArrowRight size={13} />} onClick={() => onApprove?.(a.label)}>
            {a.posture === 'APPROVAL' ? 'Approve' : 'Run'}
          </Button>
        </div>
      ))}
    </div>
  );
}

/* ---------- Event log line ---------- */
export function EventLine({ e }: { e: { on: Date; type: string; label: string; severity: string } }) {
  const color = e.severity === 'critical' ? 'var(--danger)' : e.severity === 'warn' ? 'var(--warning)' : 'var(--accent)';
  return (
    <div className="event-row">
      <span className="event-dot" style={{ background: color }} aria-hidden="true" />
      <div className="u-col" style={{ gap: 1, minWidth: 0, flex: 1 }}>
        <span className="event-label">{e.label}</span>
        <span className="event-meta">{fmtRelative(e.on)} · {humanize(e.type)}</span>
      </div>
    </div>
  );
}
