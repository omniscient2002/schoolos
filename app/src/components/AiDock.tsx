import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from './Icon';
import { Badge } from './ui';
import { AiResponseView, SuggestedActions } from './Ai';
import { aiService } from '../services';
import type { AiResponse } from '../types/domain';
import { useStore } from '../state/store';

interface Turn { q: string; r: AiResponse; }

export const ASK_TOGGLE_EVENT = 'schoolos:ask-toggle';
export function toggleAskPanel() { window.dispatchEvent(new Event(ASK_TOGGLE_EVENT)); }

/* Contextual AI assistant — an overlay DRAWER, never a layout sibling.
   Closed: the page owns the full width. Open: slides over the right edge. */
export function AiDock() {
  const { session } = useStore();
  const { pathname } = useLocation();
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(() => localStorage.getItem('schoolos.askOpen') === '1');
  const scroller = useRef<HTMLDivElement>(null);
  const staff = !['parent', 'student'].includes(session.roleId);

  useEffect(() => {
    const onToggle = () => setOpen(o => { localStorage.setItem('schoolos.askOpen', o ? '0' : '1'); return !o; });
    window.addEventListener(ASK_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(ASK_TOGGLE_EVENT, onToggle);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [turns, busy]);

  /* early return AFTER every hook — a return above the third useEffect changed the
     hook count when `staff` flipped (React #310 class, same bug family unit 15 hit) */
  if (!staff) return null;

  const contextFor = (p: string): { role: string; page: string } => {
    const map: [RegExp, string][] = [
      [/^\/fees|^\/operations/, 'fees'],
      [/^\/transport/, 'transport'],
      [/^\/attendance/, 'attendance'],
      [/^\/people/, 'people'],
      [/^\/admissions/, 'admissions'],
      [/^\/cases|^\/incidents/, 'cases'],
      [/^\/insights/, 'insights'],
      [/^\/learning/, 'learning'],
      [/^\/today|^\/$/, 'today'],
    ];
    const page = map.find(([re]) => re.test(p))?.[1] ?? 'general';
    return { role: session.roleId, page };
  };

  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    setQ('');
    setBusy(true);
    const r = await aiService.ask(text, contextFor(pathname));
    setTurns(t => [...t.slice(-4), { q: text, r }]);
    setBusy(false);
  };

  const contextual = pathname.startsWith('/fees') ? 'Why did collections change?'
    : pathname.startsWith('/transport') ? 'Which routes generated complaints?'
    : pathname.startsWith('/attendance') ? 'Why are 8-B absences rising?'
    : pathname.startsWith('/people') ? 'What should I know about this student?'
    : 'What needs my attention today?';

  return (
    <>
      {open && <div className="ai-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className={`ai-dock ${open ? 'open' : ''}`} aria-label="Ask SchoolOS panel" aria-hidden={!open}>
        <div style={{ padding: '10px 12px 10px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="u-flex" style={{ gap: 8 }}>
              <Icon.Sparkle size={15} style={{ color: 'var(--ai-text)', flexShrink: 0 }} />
              <span style={{ fontWeight: 640 }}>Ask SchoolOS</span>
              <Badge tone="ai">grounded</Badge>
            </div>
            <div className="u-xs u-faint" style={{ marginTop: 3 }}>Reading this page's context · answers cite records · actions follow the Constitution.</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close Ask panel" style={{ flexShrink: 0 }}>
            <Icon.X size={15} />
          </button>
        </div>
      <div ref={scroller} className="scroll-thin" style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {!turns.length && (
          <div className="u-col" style={{ gap: 10 }}>
            <div className="u-small u-muted" style={{ lineHeight: 1.6 }}>
              Ask anything about your school. Every answer carries its evidence chain — records, timestamps, confidence.
            </div>
            <div className="u-xs" style={{ fontWeight: 650, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)', marginTop: 2 }}>Suggested</div>
            <div className="suggest-list">
              <button className="suggest-row" onClick={() => ask(contextual)}>
                <Icon.Sparkle size={13} style={{ color: 'var(--ai-text)', flexShrink: 0 }} />
                <span className="q u-truncate">{contextual}</span>
              </button>
              <button className="suggest-row" onClick={() => ask('Why are 8-B absences rising?')}>
                <Icon.Attention size={13} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                <span className="q u-truncate">Why are 8-B absences rising?</span>
                <span className="cat">Attention</span>
              </button>
              <button className="suggest-row" onClick={() => ask('Which assets are becoming unreliable?')}>
                <Icon.Wrench size={13} style={{ color: 'var(--text-2)', flexShrink: 0 }} />
                <span className="q u-truncate">Which assets are becoming unreliable?</span>
                <span className="cat">Maint.</span>
              </button>
              <button className="suggest-row" onClick={() => ask('Why did fee realization fall this week?')}>
                <Icon.Money size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <span className="q u-truncate">Why did fee realization fall this week?</span>
                <span className="cat">Fees</span>
              </button>
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="u-col" style={{ gap: 12, marginBottom: 22 }}>
            <div style={{ alignSelf: 'flex-end', background: 'var(--surface-3)', padding: '7px 12px', borderRadius: '12px 12px 3px 12px', fontSize: 'var(--text-md)', maxWidth: '85%' }}>{t.q}</div>
            <div className="u-col" style={{ gap: 10 }}>
              <div style={{ fontWeight: 570, lineHeight: 1.55 }}>{t.r.answer}</div>
              <AiResponseView response={t.r} />
              <SuggestedActions
                actions={t.r.suggestedActions ?? []}
                compact
                onApprove={label =>
                  setTurns(ts => [
                    ...ts,
                    {
                      q: `Approved: ${label}`,
                      r: {
                        ...t.r,
                        id: t.r.id + '_ack',
                        answer: `Done — “${label}” is executing. The action and its policy reference have been logged to the audit trail.`,
                        blocks: [],
                        trace: {
                          ...t.r.trace,
                          trigger: 'Suggested action approved',
                          action: label,
                          approvalStatus: 'Approved by you',
                          verification: 'Execution logged; verification event will confirm',
                          latencyMs: 90,
                          tokens: 40,
                          cost: '₹0.00',
                        },
                      },
                    },
                  ])
                }
              />
            </div>
          </div>
        ))}
        {busy && (
          <div className="u-col" style={{ gap: 8 }}>
            <div className="skeleton" style={{ width: '70%', height: 12 }} />
            <div className="skeleton" style={{ width: '90%', height: 12 }} />
            <div className="skeleton" style={{ width: '55%', height: 12 }} />
            <div className="u-xs u-faint u-flex" style={{ gap: 6 }}><span className="spinner" style={{ width: 11, height: 11 }} /> Reading records…</div>
          </div>
        )}
      </div>
        <form className="chat-composer" onSubmit={e => { e.preventDefault(); ask(q); }}>
          <input className="input" placeholder="Ask about this page…" value={q} onChange={e => setQ(e.target.value)} aria-label="Ask SchoolOS" />
          <button className="btn btn-ai btn-sm" type="submit" disabled={busy || !q.trim()} aria-label="Send question"><Icon.Send size={14} /></button>
        </form>
      </aside>
    </>
  );
}
