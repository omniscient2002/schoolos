/* ============================================================
   Student Ask — a simple helper chat. Short grounded answers
   from the student's own records, source chips underneath, and
   a gentle guard that routes personal topics to a human.
   ============================================================ */
import { useState } from 'react';
import * as seed from '../data/dataset';
import { Badge, Card, PageHead, Skeleton, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtDateShort, fmtTime } from '../lib/format';

/* ---------- data anchors (per brief) ----------
   seed.DEMO_STUDENT — Aarav Sharma, Grade 8-B, North Campus — and
   seed.DEMO_GUARDIAN (Kavita Sharma) are the fixed demo pair. All
   guardian/fee/attendance data flows from these, never a hard-coded id. */
const ME = seed.DEMO_STUDENT;

interface Answer { text: string; lines?: string[]; sources: string[] }

const CHIPS = [
  "What's my homework today?",
  'When is the maths test?',
  'Bus time today?',
];

const HOMEWORK = [
  'Mathematics — equivalent fractions, page 42 (Q1–8), due Friday',
  'English — finish your monsoon poem draft, due next Wednesday',
];

export default function StudentAsk() {
  const toast = useToast();
  const [thinking, setThinking] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [input, setInput] = useState('');

  const route = ME.busRoute ? seed.busRoutes.find(r => r.name === ME.busRoute) : undefined;
  const mathsTest = seed.calendarEvents.find(e => e.type === 'exam' && (e.campus === ME.campus || e.campus === 'all'));

  const answerFor = (q: string): Answer => {
    const lower = q.toLowerCase();
    if (/homework|home work|today.*due/.test(lower)) {
      return {
        text: 'Two things today — both doable in about 40 minutes.',
        lines: HOMEWORK,
        sources: ['Class register'],
      };
    }
    if (/test|exam|maths|math/.test(lower)) {
      return {
        text: mathsTest
          ? `Unit Test — Mathematics (Chapter 4, equivalent fractions) is on ${fmtDateShort(mathsTest.on)} at ${fmtTime(mathsTest.on)}. You have the practice set to warm up first.`
          : 'No maths test on the calendar right now — the next one will appear here the day your teacher schedules it.',
        sources: ['Academic calendar'],
      };
    }
    if (/bus|transport|home/.test(lower)) {
      if (!route) {
        return {
          text: 'You are a day scholar — no school bus this year, so home time is with your family. If you want a route seat, ask your class teacher to start it.',
          sources: ['Transport office'],
        };
      }
      return {
        text: route.status === 'delayed'
          ? `Bus 14 is running about ${route.delayMins ?? 13} minutes late this morning — leave a little later, your evening pickup is unaffected.`
          : `Bus 14 is on time today. Usual stop at ${route.stops[0]?.name ?? 'Sector 12 Stop 1'} at ${route.stops[0]?.time ?? '07:10'}.`,
        sources: ['Transport GPS'],
      };
    }
    return {
      text: 'I can check homework, tests and the bus for you. For anything else — marks, friends, feeling unwell — talk to your class teacher, Ms. Priya Iyer. She keeps things private.',
      sources: ['Class register'],
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
    }, 700);
  };

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <PageHead
        title="Ask"
        sub="A little helper for homework, tests and the bus — nothing else, on purpose."
      />

      <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {CHIPS.map(q => (
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
            placeholder="Ask me something from school…"
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
              <Skeleton w="40%" h={13} />
              <Skeleton w="86%" h={12} />
              <Skeleton w="62%" h={12} />
            </div>
          )}

          {!thinking && !answer && (
            <div className="u-small u-muted">
              Pick a chip above or type a question. Answers come from your own school records.
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
              </div>
            </div>
          )}
        </div>
      </Card>

      <div className="card" style={{ marginTop: 16, padding: 'var(--s-5)', background: 'var(--accent-weak)', borderColor: 'var(--accent-weak-2)' }}>
        <div className="u-flex" style={{ gap: 10, alignItems: 'flex-start' }}>
          <Icon.Heart size={16} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 2 }} />
          <div className="u-small" style={{ lineHeight: 1.65 }}>
            Ask answers from your school&apos;s records. For anything personal, talk to your class teacher — Ms. Priya Iyer is in
            Room 14 before first period, and the counsellor is in Room 12 every lunch break.
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => toast({ title: 'Noted — Ms. Iyer will see you tomorrow morning', tone: 'success' })}>
              Ask to meet Ms. Iyer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
