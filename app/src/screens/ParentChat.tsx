/* ============================================================
   Parent chat — the WhatsApp-style thread with the school.
   Bubbles with status ticks, day separators, template labels,
   quick replies, a voice-note flow and a school autoreply.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as seed from '../data/dataset';
import { useStore } from '../state/store';
import { Avatar, Badge, Button, Card, Empty, PageHead, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtDate, fmtTime } from '../lib/format';

/* ---------- data anchors (per brief) ----------
   seed.DEMO_STUDENT — Aarav Sharma, Grade 8-B, North Campus — and
   seed.DEMO_GUARDIAN (Kavita Sharma) are the fixed demo pair. All
   guardian/fee/attendance data flows from these, never a hard-coded id. */
const CHILD = seed.DEMO_STUDENT;

const QUICK_REPLIES = [
  "What's today's homework?",
  'Bus is late?',
  'Need fee receipt',
  'Meeting request',
];
const AUTOREPLY = 'Thanks for writing in — class teacher Priya Iyer has been notified. For urgent matters call the front office.';

/* ---------- status label (honest) ----------
   T504: this thread is device-only — WhatsApp-style delivered/read ticks
   fabricated delivery facts. Show the truth instead. */
function Ticks({ status }: { status: 'sending' | 'sent' | 'delivered' | 'read' }) {
  if (status === 'sending') return <span className="u-xs u-faint" aria-label="Sending">···</span>;
  return <span className="u-xs u-faint" aria-label="Sent on this device only">sent (device only)</span>;
}

export default function ParentChat() {
  const { domain, dispatch } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);

  const chat = domain.chat;

  /* group by day for separators */
  const groups = useMemo(() => {
    const out: { label: string; msgs: typeof chat }[] = [];
    chat.forEach(m => {
      const label = dayLabel(m.on);
      const last = out[out.length - 1];
      if (last && last.label === label) last.msgs.push(m);
      else out.push({ label, msgs: [m] });
    });
    return out;
  }, [chat]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  const push = (text: string) => {
    const t = text.trim();
    if (!t) return;
    dispatch({ type: 'chat/add', msg: { id: `pcm_${Date.now()}`, from: 'guardian', text: t, on: new Date(), status: 'sent' } });
    setTimeout(() => {
      dispatch({ type: 'chat/add', msg: { id: `scm_${Date.now()}`, from: 'school', text: AUTOREPLY, on: new Date(), status: 'read' } });
    }, 1400);
  };

  const send = () => { push(draft); setDraft(''); };

  const voiceNote = () => {
    toast({ title: 'Voice transcription draft ready', sub: 'Transcription is simulated in this demo.', tone: 'info' });
    dispatch({ type: 'chat/add', msg: { id: `pcm_${Date.now()}`, from: 'guardian', text: "(voice note · 0:07) — transcribed: 'Will Aarav's bus be on time today?'", on: new Date(), status: 'sent' } });
  };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <PageHead
        title="Chat with school"
        sub="Demo preview — messages stay on this device and do not reach the school. Family → Requests is the live channel to the office."
        actions={<Badge tone="outline" dot>Demo — not connected</Badge>}
      />

      <Card pad={false}>
        {/* ---------- thread header ---------- */}
        <div className="u-between" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div className="u-flex" style={{ gap: 10, minWidth: 0 }}>
            <Avatar name="Meridian Academy" square />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 620 }}>Meridian Academy · School office</div>
              <div className="u-xs u-faint">About {CHILD.name.split(' ')[0]} (Grade {CHILD.grade}-{CHILD.section}) · replies in ~12 min median</div>
            </div>
          </div>
          <Badge tone="outline">Chat recorded in school records</Badge>
        </div>

        {/* ---------- thread ---------- */}
        <div ref={threadRef} style={{ maxHeight: '52vh', minHeight: 320, overflowY: 'auto', background: 'var(--surface-2)' }}>
          {chat.length === 0 ? (
            <div style={{ padding: 40 }}>
              <Empty icon={<Icon.Message size={24} />} title="No messages yet" sub="Say hello — the school office reads this thread during working hours (07:30–17:00)." />
            </div>
          ) : (
            <div className="chat-thread">
              {groups.map(g => (
                <div key={g.label} className="u-col" style={{ gap: 6 }}>
                  <span className="chat-day">{g.label}</span>
                  {g.msgs.map(m => (
                    <div key={m.id} className={`chat-msg ${m.from}`}>
                      {m.template && m.from === 'school' && <div className="u-xs u-faint" style={{ marginBottom: 2 }}>School</div>}
                      <div>{m.text}</div>
                      <div className="meta">
                        {fmtTime(m.on)}
                        {'  '}
                        {m.from === 'guardian' && m.status && <Ticks status={m.status} />}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---------- quick replies ---------- */}
        <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap', padding: '10px 14px 0' }}>
          {QUICK_REPLIES.map(q => (
            <button key={q} className="u-xs" onClick={() => push(q)} style={{
              padding: '4px 11px', borderRadius: 999, border: '1px solid var(--border-strong)', cursor: 'pointer',
              background: 'var(--surface)', color: 'var(--text-2)',
            }}>{q}</button>
          ))}
        </div>

        {/* ---------- composer ---------- */}
        <div className="chat-composer" style={{ marginTop: 10 }}>
          <button className="iconbtn" aria-label="Record voice note" title="Voice note" onClick={voiceNote}>
            <Icon.Mic size={17} />
          </button>
          <input
            className="input"
            placeholder="Write to the school office…"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            aria-label="Message to the school office"
          />
          <Button variant="primary" icon={<Icon.Send size={14} />} onClick={send} disabled={!draft.trim()}>Send</Button>
        </div>
      </Card>

      <div className="u-xs u-faint" style={{ marginTop: 10, textAlign: 'center' }}>
        Messages are part of the school record — visible in the audit trail (Audit → Communication).
      </div>
    </div>
  );
}

/* ---------- day separator label ---------- */
function dayLabel(d: Date): string {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = new Date(d);
  const day = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const diffDays = Math.round((startToday - day) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return fmtDate(t);
}
