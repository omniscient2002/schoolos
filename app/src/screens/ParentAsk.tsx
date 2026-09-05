/* ============================================================
   Parent Ask — a calm question-and-answer surface for parents.
   Answers are built from the child's actual records with small
   source chips. No admin AI panel, no traces — just warmth.
   ============================================================ */
import { useMemo, useState } from 'react';
import * as seed from '../data/dataset';
import { Avatar, Badge, Card, PageHead, Skeleton, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtDate, fmtDateShort, fmtMoney, fmtTime } from '../lib/format';

/* ---------- data anchors (per brief) ----------
   seed.DEMO_STUDENT — Aarav Sharma, Grade 8-B, North Campus — and
   seed.DEMO_GUARDIAN (Kavita Sharma) are the fixed demo pair. All
   guardian/fee/attendance data flows from these, never a hard-coded id. */
const CHILD = seed.DEMO_STUDENT;

interface Answer {
  text: string;
  lines?: string[];
  sources: string[];
}

const SUGGESTED = [
  'Is the bus on time today?',
  "What are Aarav's upcoming tests?",
  'When is the next PTM?',
  'Explain the Term 2 fee line items',
];

export default function ParentAsk() {
  const toast = useToast();
  const [thinking, setThinking] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [input, setInput] = useState('');

  /* child may or may not hold a route seat — the demo pair is a day scholar */
  const route = CHILD.busRoute ? seed.busRoutes.find(r => r.name === CHILD.busRoute) : undefined;
  const ptm = seed.calendarEvents.find(e => e.type === 'ptm' && (e.campus === CHILD.campus || e.campus === 'all'));
  const tests = [
    { subject: 'Mathematics', title: 'Unit Test — Chapter 4 (equivalent fractions)', on: fmtDateShort(new Date(Date.now() + 3 * 86400000)) },
    { subject: 'Science', title: 'Chapter quiz — photosynthesis', on: fmtDateShort(new Date(Date.now() + 9 * 86400000)) },
  ];

  const feeSummary = useMemo(() => seed.studentFeeSummary(CHILD.id), []);
  const feeLines = feeSummary.items
    .filter(f => f.status !== 'paid')
    .map(f => `${f.term}: ${fmtMoney(f.amount)} — ${f.status === 'failed' ? `payment failed (${f.failureReason}), retry without late fee for 5 days (Fees §4.3)` : `due ${fmtDate(f.dueDate)}`}`);

  const answerFor = (q: string): Answer => {
    const lower = q.toLowerCase();
    if (/bus|late|transport|pickup/.test(lower)) {
      if (!route) {
        return {
          text: "Aarav doesn't ride the school bus this year — he is a day scholar, so drop-off and pickup are with family. If you would like a route seat, the transport office can check availability.",
          sources: ['Transport office'],
        };
      }
      return {
        text: route.status === 'delayed'
          ? `Bus 14 (Route 7) is running about ${route.delayMins ?? 13} minutes late this morning. Aarav's class has attendance leniency until 09:30, so he is not marked late.`
          : 'Bus 14 (Route 7) is on time this morning — expected pickup within the usual window.',
        lines: [`Driver: ${route.driver} · ${route.students} students on the route`, 'You will get a WhatsApp message if the delay crosses 10 minutes.'],
        sources: ['Transport GPS', 'Transport office'],
      };
    }
    if (/test|exam|assessment|homework/.test(lower)) {
      return {
        text: 'Two assessments are coming up. Homework for today is the equivalent fractions practice set (Mathematics) — due Friday.',
        lines: tests.map(t => `${t.title} — ${t.on} (${t.subject})`),
        sources: ['Academic calendar', 'Class teacher notes'],
      };
    }
    if (/ptm|meeting|parent.*teacher/.test(lower)) {
      return {
        text: ptm
          ? `The next Parent-Teacher Meeting is on ${fmtDate(ptm.on)} at ${fmtTime(ptm.on)}, ${ptm.location ?? 'Main Hall'}, North Campus. You will get a slot link on WhatsApp a day before.`
          : 'The next PTM has not been scheduled yet — the school announces it on WhatsApp first.',
        sources: ['Academic calendar'],
      };
    }
    if (/fee|payment|rupee|cost|term 2/.test(lower)) {
      return {
        text: `Term 2 for Aarav (Grade 8) is ${fmtMoney(feeSummary.items.find(f => f.status === 'due')?.amount ?? 55500)}: tuition ₹51,000 plus activity and labs ₹4,500. Nothing is hidden — every line is on the fee page.`,
        lines: feeLines.length ? feeLines : ['Term 2 is already paid — thank you.'],
        sources: ['Fee ledger'],
      };
    }
    return {
      text: "I can answer questions about the bus, upcoming tests, the next PTM, and fee line items from Aarav's records. For anything personal — health, feelings, staff matters — the school office replies to you on WhatsApp, and a person always reads it.",
      sources: ['School office'],
    };
  };

  const ask = (q: string) => {
    if (!q.trim() || thinking) return;
    setAsked(q.trim());
    setAnswer(null);
    setThinking(true);
    setInput('');
    setTimeout(() => {
      setAnswer(answerFor(q));
      setThinking(false);
    }, 900);
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <PageHead
        title="Ask the school"
        sub="Answers drawn only from Aarav's records — with the sources shown underneath."
        actions={<Avatar name="Aarav Sharma" size="md" />}
      />

      <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {SUGGESTED.map(q => (
          <button key={q} className="u-xs" onClick={() => ask(q)} style={{
            padding: '6px 12px', borderRadius: 999, border: '1px solid var(--border-strong)', cursor: 'pointer',
            background: 'var(--surface)', color: 'var(--text-2)',
          }}>{q}</button>
        ))}
      </div>

      <Card pad>
        <div className="u-flex" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ height: 38 }}
            placeholder="Ask about the bus, tests, PTM or fees…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') ask(input); }}
            aria-label="Your question"
          />
          <button className="btn btn-primary" style={{ height: 38 }} onClick={() => ask(input)} disabled={!input.trim() || thinking}>
            <Icon.Send size={15} /> Ask
          </button>
        </div>

        <div style={{ marginTop: 18 }}>
          {thinking && (
            <div className="u-col" style={{ gap: 10 }} aria-live="polite">
              <Skeleton w="34%" h={13} />
              <Skeleton w="92%" h={12} />
              <Skeleton w="78%" h={12} />
              <Skeleton w="60%" h={12} />
            </div>
          )}

          {!thinking && !answer && (
            <div className="u-col u-small u-muted" style={{ gap: 8 }}>
              <span className="u-flex" style={{ gap: 8 }}><Icon.Sparkle size={14} style={{ color: 'var(--ai-text)' }} /> Start with a suggested question above, or type your own.</span>
              <span>Answers come from the attendance register, transport GPS, the academic calendar and the fee ledger — the same records the school sees.</span>
            </div>
          )}

          {!thinking && answer && (
            <div className="u-col" style={{ gap: 12 }} aria-live="polite">
              <div className="u-xs u-faint">You asked: “{asked}”</div>
              <p style={{ fontSize: 'var(--text-lg)', lineHeight: 1.6, margin: 0 }}>{answer.text}</p>
              {answer.lines && answer.lines.length > 0 && (
                <div className="u-col" style={{ gap: 6 }}>
                  {answer.lines.map((l, i) => (
                    <div key={i} className="u-flex u-small" style={{ gap: 8 }}>
                      <span style={{ width: 5, height: 5, borderRadius: 3, background: 'var(--accent)', flexShrink: 0, marginTop: 7 }} />
                      <span style={{ color: 'var(--text-2)' }}>{l}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="u-xs u-faint">Sources:</span>
                {answer.sources.map(s => <Badge key={s} tone="outline">{s}</Badge>)}
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => toast({ title: 'Noted — the school office will follow up on WhatsApp', tone: 'info' })}>
                  Talk to a person instead
                </button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <div className="card" style={{ marginTop: 16, padding: 'var(--s-5)', background: 'var(--ai-weak)', borderColor: 'var(--ai-weak-2)' }}>
        <div className="u-flex" style={{ gap: 10, alignItems: 'flex-start' }}>
          <Icon.Shield size={16} style={{ color: 'var(--ai-text)', flexShrink: 0, marginTop: 2 }} />
          <div className="u-small" style={{ lineHeight: 1.65 }}>
            Ask uses only your child&apos;s records. Sensitive topics route to a human — the school office responds on WhatsApp,
            usually within the hour during school days.
          </div>
        </div>
      </div>
    </div>
  );
}
