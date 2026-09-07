/* ============================================================
   Ask — the full-page conversational surface.
   Same logic as the docked AI panel, full width: turns kept in
   local state, answers via aiService.ask, every response carries
   its evidence chain and trace. Right rail: suggested questions,
   capability boundary (can / cannot), and grounding notes.
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { aiService } from '../services';
import { PageHead, Card, Badge, Button, Skeleton, useToast } from '../components/ui';
import { AiResponseView, SuggestedActions } from '../components/Ai';
import { Icon } from '../components/Icon';
import type { AiResponse } from '../types/domain';

interface Turn { q: string; r: AiResponse; }

const FOLLOW_UPS = [
  'Show me the attendance trend',
  'Draft the parent message',
  'Which routes generate complaints?',
  'What needs my approval today?',
];

export default function Ask() {
  const { session, dispatch, actorName } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const isLight = session.roleId === 'parent' || session.roleId === 'student';

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  const ask = async (text: string) => {
    const text2 = text.trim();
    if (!text2 || busy) return;
    setQ('');
    setBusy(true);
    try {
      const r = await aiService.ask(text2, { role: session.roleId, page: 'ask' });
      setTurns(t => [...t, { q: text2, r }]);
    } catch {
      toast({ title: 'Ask is unavailable right now.', sub: 'The reasoning service did not respond. Nothing was sent.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const approveAction = (turn: Turn, label: string) => {
    setTurns(ts => [
      ...ts,
      {
        q: `Approved: ${label}`,
        r: {
          ...turn.r,
          id: `${turn.r.id}_ack`,
          answer: `Done — “${label}” is executing. The action, its policy reference and your approval have been written to the audit trail.`,
          blocks: [],
          suggestedActions: [],
          trace: {
            ...turn.r.trace,
            trigger: 'Suggested action approved in Ask',
            action: label,
            approvalStatus: 'Approved by you',
            verification: 'Execution logged; verification event will confirm delivery',
            latencyMs: 90,
            tokens: 40,
            cost: '₹0.00',
          },
        },
      },
    ]);
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName,
        actorRole: session.roleId,
        action: `Approved from Ask — ${label}`,
        recordType: 'Approval',
        recordRef: 'Ask conversation',
        reason: 'Approved suggested action in conversation',
        aiInvolved: true,
        risk: 'low',
        outcome: 'Executing · verification pending',
      },
    });
    toast({ title: 'Approved — executing.', sub: 'Audit entry recorded.', tone: 'success' });
  };

  const suggested: string[] = isLight
    ? ['What is my attendance this term?', 'When is the next exam?', 'What should I know about my fees?']
    : session.roleId === 'finance'
      ? ['Why did fee realization fall this week?', 'How many payments are pending settlement import?', 'What needs my approval today?']
      : session.roleId === 'teacher'
        ? ['Show me the attendance trend for my class', 'Draft the parent message', 'What needs my approval today?']
        : session.roleId === 'facilities' || session.roleId === 'technician'
          ? ['What maintenance problems need my attention?', 'Which assets are becoming unreliable?', 'Which maintenance jobs are running out of time?', 'Why does the science lab AC keep failing?']
          : ['Why are 8-B absences rising?', 'What maintenance problems need my attention?', 'Which assets are becoming unreliable?', 'Why did maintenance costs increase this month?'];

  const examples = [
    { icon: 'Users' as const, tone: 'var(--warning)', title: 'Why are 8-B absences rising?', sub: 'Investigates registers, transport GPS and message logs with evidence.' },
    { icon: 'Wrench' as const, tone: 'var(--ai-text)', title: 'Which assets are becoming unreliable?', sub: 'Reads failure history, repair spend and preventive adherence per asset.' },
    { icon: 'Money' as const, tone: 'var(--accent)', title: 'Why did maintenance costs increase this month?', sub: 'Traces spend to repeat repairs — not new incidents.' },
    { icon: 'Bus' as const, tone: 'var(--info)', title: 'Which maintenance jobs are running out of time?', sub: 'Checks every open work order against its response promise.' },
  ];

  return (
    <>
      <PageHead
        title="Ask"
        sub={isLight
          ? 'Ask about your classes, attendance or fees. Every answer shows the records behind it.'
          : 'Ask anything about your school. Every answer cites its records; every action follows the Constitution.'}
        actions={turns.length > 0 && (
          <Button variant="ghost" size="sm" icon={<Icon.Trash size={13} />} onClick={() => { setTurns([]); toast({ title: 'Conversation cleared.', sub: 'The AI memory keeps the decisions; this thread starts fresh.', tone: 'info' }); }}>
            Clear conversation
          </Button>
        )}
      />

      <div className="ask-layout">
        {/* ---------- conversation ---------- */}
        <Card pad={false}>
          <div ref={scroller} style={{ minHeight: 380, maxHeight: '62vh', overflowY: 'auto', padding: 20 }}>
            {turns.length === 0 && !busy && (
              <div className="u-col" style={{ gap: 14 }}>
                <div className="u-flex" style={{ gap: 8 }}>
                  <span className="ai-chip"><Icon.Sparkle size={12} /> SchoolOS AI</span>
                  <Badge tone="ai">grounded</Badge>
                  <Badge tone="success" dot>read-only until you approve</Badge>
                </div>
                <p className="u-small u-muted" style={{ margin: 0, lineHeight: 1.65, maxWidth: 560 }}>
                  {isLight
                    ? 'Ask in English or Hindi. Answers about other students are shielded by privacy policy — you see your own records only.'
                    : 'I investigate before I answer: records are read under your role permissions, numbers are recomputed, and every claim links to its source. Nothing is sent or changed without your approval.'}
                </p>
                <div className="suggest-list" style={{ marginTop: 4 }}>
                  {examples.map(ex => (
                    <button
                      key={ex.title}
                      className="suggest-row"
                      title={ex.sub}
                      onClick={() => ask(ex.title)}
                    >
                      {(() => { const Ic = Icon[ex.icon]; return <Ic size={14} style={{ color: ex.tone, flexShrink: 0 }} />; })()}
                      <span className="q u-truncate">{ex.title}</span>
                      <Icon.ChevronRight size={13} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, i) => (
              <div key={i} className="u-col" style={{ gap: 14, marginBottom: i < turns.length - 1 ? 26 : 0 }}>
                <div style={{ alignSelf: 'flex-end', background: 'var(--surface-3)', padding: '8px 13px', borderRadius: '12px 12px 3px 12px', fontSize: 'var(--text-md)', maxWidth: '80%' }}>
                  {t.q}
                </div>
                <div className="u-col ask-answer-reveal" style={{ gap: 12, maxWidth: 760 }}>
                  <div style={{ fontWeight: 580, lineHeight: 1.6 }}>{t.r.answer}</div>
                  <AiResponseView response={t.r} onAction={(label) => approveAction(t, label.replace(/^Draft approved: /, ''))} />
                  <SuggestedActions actions={t.r.suggestedActions ?? []} compact onApprove={label => approveAction(t, label)} />
                  {(() => {
                    const srcs = Array.from(new Set(t.r.blocks.flatMap(b => b.type === 'chain' ? b.steps.map(st => st.source) : []))).slice(0, 5);
                    return srcs.length > 0 && (
                      <div className="cite-slip">
                        <span className="cs-k">Sources</span>
                        {srcs.map((src, i) => <span key={i} className="cs-src">{src}</span>)}
                      </div>
                    );
                  })()}
                  <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                    <span className="u-xs u-faint" style={{ alignSelf: 'center' }}>Follow up:</span>
                    {FOLLOW_UPS.map(f => (
                      <button
                        key={f}
                        className="u-xs"
                        style={{ padding: '4px 10px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--text-2)' }}
                        onClick={() => ask(f)}
                        disabled={busy}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            {busy && (
              <div className="u-col" style={{ gap: 8, maxWidth: 620 }}>
                <Skeleton w="70%" h={12} />
                <Skeleton w="90%" h={12} />
                <Skeleton w="55%" h={12} />
                <div className="u-xs u-faint u-flex" style={{ gap: 6 }}>
                  <span className="spinner" style={{ width: 11, height: 11 }} /> Reading records and recomputing figures…
                </div>
              </div>
            )}
          </div>

          {/* composer */}
          <form
            className="u-flex"
            style={{ gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-2)' }}
            onSubmit={e => { e.preventDefault(); ask(q); }}
          >
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder={isLight ? 'Ask about your classes, attendance or fees…' : 'Ask about attendance, fees, transport, a student, or this page…'}
              value={q}
              onChange={e => setQ(e.target.value)}
              aria-label="Ask SchoolOS a question"
              disabled={busy}
            />
            <Button
              type="button"
              variant="ghost"
              aria-label="Voice question (coming to mobile)"
              icon={<Icon.Mic size={14} />}
              onClick={() => toast({ title: 'Voice ask arrives with the mobile build.', sub: 'The API and policy path are identical — the composer stays as the audit surface for now.', tone: 'info' })}
            />
            <Button type="submit" variant="ai" disabled={busy || !q.trim()} iconRight={<Icon.Send size={14} />}>Ask</Button>
          </form>
        </Card>

        {/* ---------- right rail ---------- */}
        <div className="u-col" style={{ gap: 16 }}>
          <Card head={<span className="u-flex" style={{ gap: 7 }}><Icon.Sparkle size={14} style={{ color: 'var(--ai-text)' }} /> Suggested questions</span>} pad>
            <div className="u-col" style={{ gap: 8 }}>
              {suggested.map(s => (
                <button key={s} className="card card-pad card-click u-small" style={{ textAlign: 'left' }} onClick={() => ask(s)} disabled={busy}>
                  <span className="u-flex" style={{ gap: 8 }}><Icon.Ask size={13} style={{ color: 'var(--text-3)', flexShrink: 0 }} /> {s}</span>
                </button>
              ))}
            </div>
          </Card>

          <Card head={<span className="u-flex" style={{ gap: 7 }}><Icon.Shield size={14} /> What SchoolOS can and cannot do</span>} pad>
            <div className="u-col" style={{ gap: 10 }}>
              <div>
                <div className="u-xs" style={{ fontWeight: 650, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--success)', marginBottom: 6 }}>Can</div>
                <div className="u-col u-small u-muted" style={{ gap: 5, lineHeight: 1.55 }}>
                  <span className="u-flex" style={{ gap: 7 }}><Icon.Check size={13} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} /> Investigate — read records you can access and show the evidence chain</span>
                  <span className="u-flex" style={{ gap: 7 }}><Icon.Check size={13} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} /> Draft — messages, replies and plans, always editable before sending</span>
                  <span className="u-flex" style={{ gap: 7 }}><Icon.Check size={13} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} /> Propose — route actions through AUTO / APPROVAL / HUMAN-ONLY postures</span>
                </div>
              </div>
              <div>
                <div className="u-xs" style={{ fontWeight: 650, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--danger)', marginBottom: 6 }}>Cannot</div>
                <div className="u-col u-small u-muted" style={{ gap: 5, lineHeight: 1.55 }}>
                  <span className="u-flex" style={{ gap: 7 }}><Icon.X size={13} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} /> Decide child-safety matters — Safeguarding is HUMAN-ONLY (Safeguarding §2.0)</span>
                  <span className="u-flex" style={{ gap: 7 }}><Icon.X size={13} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} /> Send bulk messages without approval — Communication §2.1</span>
                  <span className="u-flex" style={{ gap: 7 }}><Icon.X size={13} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} /> Alter exam eligibility — no fee status ever blocks a child (Fees §4.5)</span>
                </div>
              </div>
            </div>
          </Card>

          <Card head={<span className="u-flex" style={{ gap: 7 }}><Icon.Lock size={14} /> How answers stay honest</span>} pad>
            <div className="u-col u-small u-muted" style={{ gap: 8, lineHeight: 1.6 }}>
              <span>Access follows your role — {actorName.split(' ').slice(0, 2).join(' ')} ({session.roleId}). Every AI read is logged.</span>
              <span>Figures are recomputed from records, not quoted from memory. Confidence reflects the verification pass.</span>
              <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={() => navigate('/constitution')}>
                Read the Constitution <Icon.ArrowRight size={12} />
              </button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
