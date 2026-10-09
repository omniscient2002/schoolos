/* ============================================================
   Copilot — P4 · the teaching copilot (deterministic v0).

   Doors (frozen §4):
     POST /copilot/ask   {question}          → {answer, sources[], suggested_action?, budget}
     POST /copilot/draft {kind, params}       → {draft, label:'ai_draft', budget}
   AI recommends, the teacher decides: every answer is a
   deterministic retrieval over authorised data with its
   sources shown; every draft is labelled ai_draft and is
   edited here — nothing is sent from this screen.
   ============================================================ */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, PageHead, Section, Stat, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import {
  askTeacherCopilot, draftTeacherCopilot,
  type CopilotAskResult, type CopilotDraftResult,
} from '../../services/teacherApi';
import { DeniedState, useTeacherAccess } from './teacherKit';
import { useStore } from '../../state/store';
import { humanize, roleLabel } from '../../lib/labels';

const DRAFT_KINDS: { id: string; label: string; hint: string }[] = [
  { id: 'lesson', label: 'Lesson plan', hint: 'A 40-minute plan for a topic.' },
  { id: 'worksheet', label: 'Worksheet', hint: 'Practice problems for the class.' },
  { id: 'questions', label: 'Question set', hint: 'Recall / apply / reason questions.' },
  { id: 'feedback', label: 'Student feedback', hint: 'Strengths, next step, encouragement.' },
  { id: 'message', label: 'Parent message', hint: 'A professional note to a guardian.' },
];

const SUGGESTIONS = [
  'What do I teach today?',
  'How is class 8 doing in Mathematics?',
  'Who needs support in class 8 Mathematics?',
  'How much homework is waiting for review?',
  'Where are we in the curriculum?',
];

export default function Copilot() {
  const toast = useToast();
  const navigate = useNavigate();
  const { session } = useStore();
  const allowed = useTeacherAccess('/teacher/copilot');

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<CopilotAskResult | null>(null);

  const [kind, setKind] = useState('lesson');
  const [subject, setSubject] = useState('Mathematics');
  const [grade, setGrade] = useState('8');
  const [focus, setFocus] = useState('');
  const [studentName, setStudentName] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<CopilotDraftResult | null>(null);
  const [draftText, setDraftText] = useState('');

  const ask = async (q?: string) => {
    const questionText = (q ?? question).trim();
    if (!questionText) return;
    setAsking(true);
    setQuestion(questionText);
    try {
      setAnswer(await askTeacherCopilot(questionText));
    } catch (e) {
      toast({ title: 'The teaching assistant did not answer', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setAsking(false); }
  };

  const generate = async () => {
    setDrafting(true);
    try {
      const params: Record<string, unknown> = { subject, classGrade: grade, focus: focus.trim() || undefined };
      if (kind === 'feedback' || kind === 'message') params.studentName = studentName.trim() || undefined;
      const r = await draftTeacherCopilot(kind, params);
      setDraft(r);
      setDraftText(r.draft);
    } catch (e) {
      toast({ title: 'The draft did not generate', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setDrafting(false); }
  };

  if (!allowed) return <DeniedState role={roleLabel(session.roleId)} />;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <PageHead
        title="Teaching assistant"
        sub="Ask about your own classes, or draft a lesson, worksheet or message. Answers cite their sources; drafts are templates you edit — nothing is sent for you."
        actions={<Badge tone="outline" dot>No AI model — answers from your records</Badge>}
      />

      <Section title="Ask" sub="Answers are built only from your authorised school data.">
        <Card pad>
          <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input
              className="input" style={{ flex: 1, minWidth: 240 }}
              placeholder="e.g. who needs support in class 8 Mathematics?"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ask(); } }}
              aria-label="Ask the teaching assistant"
            />
            <Button variant="ai" icon={<Icon.Sparkle size={14} />} loading={asking} onClick={() => ask()} disabled={!question.trim()}>
              Ask
            </Button>
          </div>
          <div className="u-flex u-wrap" style={{ gap: 6, marginTop: 10 }}>
            {SUGGESTIONS.map(s => (
              <button key={s} className="tab" onClick={() => ask(s)} style={{ fontSize: 'var(--text-sm)' }}>{s}</button>
            ))}
          </div>

          {answer && (
            <div style={{ marginTop: 14 }}>
              <div className="u-flex" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <Badge tone="info">Answer</Badge>
                {answer.sources.length > 0 && (
                  <span className="u-xs u-faint">from {answer.sources.map(s => humanize(s.kind)).join(', ')}</span>
                )}
                <span className="u-xs u-faint" style={{ marginLeft: 'auto' }}>
                  Budget {answer.budget.used}/{answer.budget.cap} today
                </span>
              </div>
              <p className="u-small" style={{ lineHeight: 1.7, margin: 0 }}>{answer.answer}</p>
              {answer.suggested_action && (
                <Button
                  variant="secondary" size="sm" icon={<Icon.ArrowRight size={13} />}
                  style={{ marginTop: 10 }}
                  onClick={() => navigate(answer.suggested_action!.to)}
                >
                  {answer.suggested_action.label}
                </Button>
              )}
            </div>
          )}
        </Card>
      </Section>

      <Section title="Draft" sub="A draft template — review and edit it before you use it.">
        <Card pad>
          <div className="u-flex u-wrap" style={{ gap: 6, marginBottom: 12 }}>
            {DRAFT_KINDS.map(k => (
              <button key={k.id} className={`tab ${kind === k.id ? 'active' : ''}`} aria-pressed={kind === k.id}
                title={k.hint} onClick={() => setKind(k.id)}>{k.label}</button>
            ))}
          </div>

          <div className="grid grid-3" style={{ gap: '0 14px' }}>
            <div className="field">
              <label htmlFor="cp-subject">Subject</label>
              <input id="cp-subject" className="input" value={subject} onChange={e => setSubject(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="cp-grade">Class</label>
              <input id="cp-grade" className="input" value={grade} onChange={e => setGrade(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="cp-focus">Focus / topic (optional)</label>
              <input id="cp-focus" className="input" value={focus} onChange={e => setFocus(e.target.value)} />
            </div>
          </div>

          {(kind === 'feedback' || kind === 'message') && (
            <div className="field">
              <label htmlFor="cp-student">{kind === 'message' ? 'Parent of (student)' : 'Student'}</label>
              <input id="cp-student" className="input" value={studentName} onChange={e => setStudentName(e.target.value)} />
            </div>
          )}

          <div className="u-between u-wrap" style={{ gap: 10 }}>
            <span className="u-small u-muted">
              Drafts never leave this screen — copy or adapt what is useful, then send through your normal channel.
            </span>
            <Button variant="primary" icon={<Icon.Sparkle size={14} />} loading={drafting} onClick={generate}>
              Generate draft
            </Button>
          </div>

          {draft && (
            <div style={{ marginTop: 14 }}>
              <div className="u-flex" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <Badge tone="warning">{draft.label === 'ai_draft' ? 'AI draft' : humanize(draft.label)}</Badge>
                <span className="u-small" style={{ fontWeight: 600 }}>{draft.title}</span>
                <span className="u-xs u-faint" style={{ marginLeft: 'auto' }}>
                  Budget {draft.budget.used}/{draft.budget.cap} today
                </span>
              </div>
              <textarea
                className="textarea" rows={12} value={draftText}
                onChange={e => setDraftText(e.target.value)}
                aria-label="Editable draft"
              />
            </div>
          )}
        </Card>
      </Section>

      <div className="grid grid-3">
        <Stat label="Assistant mode" value="Lookup only" sub="No AI model — answers come from your records" />
        <Stat label="Sources" value="Shown" sub="Every answer cites where it came from" />
        <Stat label="Budget" value="Daily cap" sub="Ask + draft share one allowance" />
      </div>
    </div>
  );
}
