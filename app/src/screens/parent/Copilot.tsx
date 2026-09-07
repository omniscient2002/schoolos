/* ============================================================
   Copilot — the family AI assistant (PU-1).
   Deterministic v0: answers are composed from the family's own
   authorized records, every answer shows its sources, and an
   honest-empty answer says what it could not find instead of
   inventing. Budget-capped server-side; the remaining budget is
   shown subtly. Sensitive drafting ("note to the teacher")
   always ends in an editable textarea — the human sends it.
   Server truth: POST /parent/copilot/ask · POST /parent/copilot/draft.
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, PageHead, Skeleton, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ParentError } from '../../components/parent/states';
import { friendly } from '../../lib/friendlyErrors';
import { askCopilot, draftCopilotNote, type CopilotAnswer } from '../../services/parentApi';

const STARTERS = [
  'What homework does my child have?',
  'When is the next exam?',
  'What forms are pending?',
  'Summarize this week',
];

interface Turn {
  id: number;
  q: string;
  a: CopilotAnswer | null;
  failed?: string | null;
}

export default function Copilot() {
  const toast = useToast();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [pageErr, setPageErr] = useState<unknown>(null);

  /* draft flow */
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [draftSent, setDraftSent] = useState(false);

  const nextId = useRef(1);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' }); }, [turns.length, thinking]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || thinking) return;
    setInput('');
    setThinking(true);
    const id = nextId.current++;
    setTurns(t => [...t, { id, q: question, a: null }]);
    try {
      const a = await askCopilot(question);
      setTurns(t => t.map(x => x.id === id ? { ...x, a } : x));
    } catch (e) {
      setTurns(t => t.map(x => x.id === id ? { ...x, failed: friendly((e as Error).message || e) } : x));
    } finally {
      setThinking(false);
    }
  };

  const makeDraft = async () => {
    setDraftOpen(true); setDraftErr(null); setDraftSent(false);
    if (draftText) return; // keep edits if the parent reopens
    setDraftLoading(true);
    try {
      const r = await draftCopilotNote({});
      setDraftText(r.draft);
    } catch (e) {
      setDraftErr(friendly((e as Error).message || e));
    } finally {
      setDraftLoading(false);
    }
  };

  if (pageErr) return <ParentError err={pageErr} onRetry={() => setPageErr(null)} />;
  void setPageErr; // retained for symmetry with sibling screens; ask errors surface inline

  const budgetLeft = [...turns].reverse().find(t => t.a)?.a?.budget_left;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'grid', gap: 14 }}>
      <PageHead
        title="Family assistant"
        sub="Answers come only from your children's school records — every answer shows where it came from."
      />

      {/* ---------- starter chips ---------- */}
      <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Suggested questions">
        {STARTERS.map(q => (
          <button key={q} onClick={() => ask(q)} disabled={thinking} style={{
            minHeight: 44, padding: '8px 13px', borderRadius: 999, cursor: thinking ? 'wait' : 'pointer',
            border: '1px solid var(--border-strong)', background: 'var(--surface)', color: 'var(--text-2)',
            fontSize: 'var(--text-sm)',
          }}>{q}</button>
        ))}
      </div>

      {/* ---------- conversation ---------- */}
      <Card pad style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div ref={feedRef} className="u-col" style={{ gap: 16, maxHeight: 420, overflowY: 'auto' }} aria-live="polite" aria-label="Conversation">
          {turns.length === 0 && !thinking && (
            <div className="u-col u-small u-muted" style={{ gap: 8 }}>
              <span className="u-flex" style={{ gap: 8 }}>
                <Icon.Sparkle size={14} style={{ color: 'var(--ai-text)', flexShrink: 0, marginTop: 2 }} />
                Pick a question above or type your own — in any language you like.
              </span>
              <span>The assistant cannot see anything beyond your children&apos;s records, and it never guesses. When it does not know, it says so.</span>
            </div>
          )}

          {turns.map(t => (
            <div key={t.id} className="u-col" style={{ gap: 10 }}>
              <div className="u-flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
                <div className="u-small" style={{ background: 'var(--surface-3)', borderRadius: '14px 14px 4px 14px', padding: '8px 12px', maxWidth: '85%' }}>{t.q}</div>
              </div>
              {t.failed ? (
                <div className="login-error" role="alert">{t.failed}</div>
              ) : !t.a ? (
                <div className="u-col" style={{ gap: 8 }} aria-label="Thinking">
                  <Skeleton w="30%" h={12} />
                  <Skeleton w="88%" h={11} />
                  <Skeleton w="64%" h={11} />
                </div>
              ) : (
                <div className="u-col" style={{ gap: 8, background: 'var(--ai-weak)', border: '1px solid var(--ai-weak-2)', borderRadius: 'var(--r-md)', padding: 12 }}>
                  <div style={{ lineHeight: 1.6 }}>{t.a.answer}</div>
                  {t.a.empty && (
                    <div className="u-xs u-muted">
                      {t.a.empty_reason ?? 'Nothing in the school records answers this yet. The class teacher or the office can help — call or message them.'}
                    </div>
                  )}
                  {t.a.sources?.length > 0 && (
                    <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className="u-xs u-faint">Sources:</span>
                      {t.a.sources.map(s => <Badge key={s} tone="outline">{s}</Badge>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {thinking && turns.length > 0 && (
            <div className="u-col" style={{ gap: 8 }} aria-label="Thinking">
              <Skeleton w="30%" h={12} />
              <Skeleton w="88%" h={11} />
              <Skeleton w="64%" h={11} />
            </div>
          )}
        </div>

        {/* ---------- composer ---------- */}
        <form className="u-flex" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); ask(input); }}>
          <input className="input" style={{ height: 44, flex: 1 }} value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about homework, exams, forms, attendance…"
            aria-label="Ask the family assistant"
            disabled={thinking} />
          <Button variant="primary" type="submit" disabled={thinking || !input.trim()} icon={<Icon.Send size={14} />}>
            Ask
          </Button>
        </form>
        <div className="u-between u-xs u-faint">
          <button className="btn btn-ghost btn-sm" style={{ minHeight: 44 }} onClick={makeDraft} disabled={draftLoading}>
            <Icon.Edit size={13} /> Draft a note to the teacher
          </button>
          {typeof budgetLeft === 'number' && (
            <span>{budgetLeft > 0 ? `${budgetLeft} questions left today` : 'Daily question limit reached — back tomorrow'}</span>
          )}
        </div>
      </Card>

      {/* ---------- draft dialog ---------- */}
      {draftOpen && (
        <Card pad style={{ background: 'var(--ai-weak)', borderColor: 'var(--ai-weak-2)' }}>
          <h2 style={{ marginBottom: 8 }}><Icon.Edit size={15} /> Note to the teacher</h2>
          {draftLoading && (
            <div className="u-col" style={{ gap: 8 }}>
              <Skeleton w="90%" h={12} />
              <Skeleton w="72%" h={12} />
              <Skeleton w="55%" h={12} />
            </div>
          )}
          {!draftLoading && (
            <>
              <label htmlFor="copilot-draft" className="u-xs u-muted" style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
                AI draft — edit before sending
              </label>
              <textarea id="copilot-draft" className="textarea" style={{ width: '100%', minHeight: 130 }} value={draftText}
                onChange={e => setDraftText(e.target.value)} />
              {draftErr && <div className="login-error" role="alert" style={{ marginTop: 8 }}>{draftErr}</div>}
              {draftSent && <div className="login-error" role="status" style={{ marginTop: 8 }}>Copied — paste it into Messages or WhatsApp and send it yourself.</div>}
              <div className="u-flex" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <Button variant="primary" onClick={() => {
                  navigator.clipboard?.writeText(draftText).then(
                    () => { setDraftSent(true); toast({ title: 'Draft copied', sub: 'Edit anything before you send it — you are the sender.', tone: 'success' }); },
                    () => { setDraftErr('Could not copy automatically — select the text and copy it.'); },
                  );
                }} disabled={!draftText.trim()}>
                  Copy note
                </Button>
                <Button variant="ghost" onClick={() => setDraftOpen(false)}>Close</Button>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
