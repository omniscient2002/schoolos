/* Doubts — P10 · questions routed to the teacher (PRD-1). Deterministic routing
   (subject → most-frequent teacher); answer, then optionally promote to a class FAQ. */
import { useState } from 'react';
import { Badge, Button, Card, Empty, PageHead, Section, SkeletonCard, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { fmtRelative } from '../../lib/format';
import { statusLabel, roleLabel } from '../../lib/labels';
import { useStore } from '../../state/store';
import { answerDoubt, listDoubts, promoteDoubtFaq, type SupportDoubt } from '../../services/teacherApi';
import { AsyncGate, DeniedState, useAsync, useTeacherAccess } from './teacherKit';

const STATUS_TONE: Record<string, 'warning' | 'info' | 'success'> = {
  routed: 'warning', answered: 'info', promoted: 'success',
};

export default function Doubts() {
  const toast = useToast();
  const { session } = useStore();
  const allowed = useTeacherAccess('/teacher/homework');
  const list = useAsync(() => listDoubts(), []);
  const [answering, setAnswering] = useState<SupportDoubt | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!answering || !text.trim()) return;
    setSaving(true);
    try {
      await answerDoubt(answering.doubtId, text.trim());
      toast({ title: 'Answer sent', sub: 'The student sees it in their questions.', tone: 'success' });
      setAnswering(null); setText('');
      list.retry();
    } catch (e) {
      toast({ title: 'Could not answer', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setSaving(false); }
  };

  const promote = async (d: SupportDoubt) => {
    try {
      await promoteDoubtFaq(d.doubtId);
      toast({ title: 'Added to the class FAQ', sub: 'Future students get the answer without asking.', tone: 'success' });
      list.retry();
    } catch (e) {
      toast({ title: 'Could not promote', sub: String(e).replace('Error: ', ''), tone: 'error' });
    }
  };

  if (!allowed) return <DeniedState role={roleLabel(session.roleId)} />;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <PageHead title="Doubts" sub="Questions students asked that were routed to you. Answer once, and share the good ones as class FAQs." />
      <Section title="Routed to me" sub="Newest first.">
        <AsyncGate state={list} skeleton={<SkeletonCard lines={5} />}
          empty={<Empty icon={<Icon.Message size={22} />} title="No questions waiting" sub="When a student asks something in your subject, it appears here." />}>
          {({ doubts }) => doubts.length === 0
            ? <Empty icon={<Icon.Message size={22} />} title="No questions waiting" sub="When a student asks in your subject, it appears here." />
            : (
              <div className="u-col" style={{ gap: 10 }}>
                {doubts.map(d => (
                  <Card key={d.doubtId} pad>
                    <div className="u-between u-wrap" style={{ gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="u-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Badge tone={STATUS_TONE[d.status] ?? 'neutral'} dot>{statusLabel(d.status)}</Badge>
                          <span className="u-small u-muted">{d.subject}{d.topic ? ` · ${d.topic}` : ''}</span>
                          <span className="u-xs u-faint">{d.askedByName} · {fmtRelative(d.createdAt)}</span>
                        </div>
                        <div style={{ fontWeight: 570, marginTop: 4 }}>{d.question}</div>
                        {d.answer && <div className="u-small u-muted" style={{ marginTop: 4 }}>Your answer: {d.answer}</div>}
                      </div>
                      <span className="u-flex" style={{ gap: 8, flexShrink: 0 }}>
                        {d.status === 'routed' && (
                          <Button size="sm" variant="primary" icon={<Icon.Message size={13} />} onClick={() => { setAnswering(d); setText(''); }}>Answer</Button>
                        )}
                        {d.status === 'answered' && (
                          <Button size="sm" variant="secondary" icon={<Icon.Check size={13} />} onClick={() => promote(d)}>Add to FAQ</Button>
                        )}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
        </AsyncGate>
      </Section>

      {answering && (
        <Card pad style={{ marginTop: 14, borderColor: 'var(--accent-weak-2)' }}>
          <div className="field"><label htmlFor="db-ans">Your answer to “{answering.question}”</label>
            <textarea id="db-ans" className="textarea" rows={3} value={text} onChange={e => setText(e.target.value)} /></div>
          <div className="u-flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setAnswering(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} disabled={!text.trim()} onClick={submit}>Send answer</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
