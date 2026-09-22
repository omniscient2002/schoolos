/* ============================================================
   Homework — StudentOS learn lane (SU-2, PRD-6).

   Two honest modes, straight from the door:
   - paper: "Complete in your notebook" — the teacher marks it
     received; there is nothing to upload here.
   - digital: send it as text or a link. The door decides
     Submitted vs Late at insert; a repeat send is a 409 the
     wrapper rewrites into a plain sentence.

   Door: GET /student/homework · POST /plugins/teacher.classroom/
   homework/:id/submit (student.world / teacher.classroom).
   ============================================================ */
import { useEffect, useState } from 'react';
import { PageHead, Card, Button, Badge, Empty, ErrorState, SkeletonCard, Modal, useToast } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { friendly } from '../../../lib/friendlyErrors';
import {
  getStudentHomework, submitStudentHomework,
  type StudentHomeworkData, type StudentHomeworkItem,
} from '../../../services/studentApi';

const STATUS_LABEL: Record<string, string> = { submitted: 'Submitted', late: 'Late' };

export default function Homework() {
  const toast = useToast();
  const [data, setData] = useState<StudentHomeworkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const [active, setActive] = useState<StudentHomeworkItem | null>(null);
  const [contentType, setContentType] = useState<'text' | 'link'>('text');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [receipts, setReceipts] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getStudentHomework()
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(friendly(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tick]);

  const openSubmit = (item: StudentHomeworkItem) => {
    setActive(item);
    setContentType('text');
    setContent('');
  };

  const send = async () => {
    if (!active || !content.trim()) return;
    setSending(true);
    try {
      const r = await submitStudentHomework(active.id, { content_type: contentType, content: content.trim() });
      const label = STATUS_LABEL[r.status ?? 'submitted'] ?? 'Submitted';
      setReceipts(prev => ({ ...prev, [active.id]: label }));
      setActive(null);
      toast({ title: label === 'Late' ? 'Sent — your teacher will see it as late' : 'Sent to your teacher', sub: 'It is in your teacher\u2019s homework list now.', tone: 'success' });
    } catch (e) {
      toast({ title: 'Could not send', sub: friendly(e), tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  const digital = data?.digital ?? [];
  const paper = data?.paper ?? [];
  const total = digital.length + paper.length;

  return (
    <div>
      <PageHead
        title="Homework"
        sub="What your teachers set. Paper work stays in your notebook — digital work is sent from here."
      />

      {loading && <SkeletonCard lines={6} />}

      {!loading && error && (
        <ErrorState title="Homework did not load" sub={error} onRetry={() => setTick(t => t + 1)} />
      )}

      {!loading && !error && total === 0 && (
        <Empty
          icon={<Icon.Check size={22} />}
          title="No homework right now"
          sub="When a teacher sets work, it appears here. Paper work is marked received by your teacher."
        />
      )}

      {!loading && !error && total > 0 && (
        <div className="u-col" style={{ gap: 16 }}>
          {digital.length > 0 && (
            <Card headAs="h2" head="Send from here" sub="Digital homework — send your work as text or a link.">
              <div className="u-col" style={{ gap: 10 }}>
                {digital.map(item => (
                  <div key={item.id} className="u-flex u-wrap" style={{ gap: 10, alignItems: 'flex-start', padding: '11px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 570 }}>{item.title}</div>
                      <div className="u-small u-muted" style={{ marginTop: 2 }}>
                        {[item.subject, item.due ? `Due ${item.due}` : null].filter(Boolean).join(' · ') || 'No subject or due date given'}
                      </div>
                    </div>
                    {receipts[item.id] ? (
                      <Badge tone={receipts[item.id] === 'Late' ? 'warning' : 'success'} dot>{receipts[item.id]}</Badge>
                    ) : (
                      <Button variant="primary" size="sm" icon={<Icon.Send size={13} />} onClick={() => openSubmit(item)}>Send work</Button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {paper.length > 0 && (
            <Card headAs="h2" head="In your notebook" sub="These are done on paper.">
              <div className="u-col" style={{ gap: 10 }}>
                {paper.map(item => (
                  <div key={item.id} className="u-flex u-wrap" style={{ gap: 10, alignItems: 'flex-start', padding: '11px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
                    <span aria-hidden="true" style={{ color: 'var(--text-3)', marginTop: 1 }}><Icon.Book size={16} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 570 }}>{item.title}</div>
                      <div className="u-small u-muted" style={{ marginTop: 2 }}>
                        {[item.subject, item.due ? `Due ${item.due}` : null].filter(Boolean).join(' · ') || 'No subject or due date given'}
                      </div>
                      <div className="u-small u-muted" style={{ marginTop: 4 }}>Complete in your notebook — your teacher marks it received.</div>
                    </div>
                    <Badge tone="outline">Notebook</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="u-xs u-faint">Only your own homework is shown here.</div>
        </div>
      )}

      <Modal
        open={!!active}
        onClose={() => setActive(null)}
        title="Send your homework"
        sub={active ? active.title : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setActive(null)}>Cancel</Button>
            <Button variant="primary" loading={sending} disabled={!content.trim()} onClick={send}>Send to teacher</Button>
          </>
        }
      >
        <div className="u-col" style={{ gap: 12 }}>
          <div className="field">
            <label>How are you sending it?</label>
            <div className="u-flex" style={{ gap: 8 }}>
              <button type="button" className={`tab ${contentType === 'text' ? 'active' : ''}`} aria-pressed={contentType === 'text'} onClick={() => setContentType('text')}>Write it here</button>
              <button type="button" className={`tab ${contentType === 'link' ? 'active' : ''}`} aria-pressed={contentType === 'link'} onClick={() => setContentType('link')}>A link</button>
            </div>
          </div>
          {contentType === 'text' ? (
            <div className="field">
              <label htmlFor="hw-text">Your work</label>
              <textarea id="hw-text" className="textarea" rows={5} data-autofocus value={content} placeholder="Write your answer here." onChange={e => setContent(e.target.value)} />
            </div>
          ) : (
            <div className="field">
              <label htmlFor="hw-link">Link to your work</label>
              <input id="hw-link" className="input" type="url" data-autofocus value={content} placeholder="Paste a link your teacher can open." onChange={e => setContent(e.target.value)} />
            </div>
          )}
          <div className="u-small u-faint">You can send this once. If it is past the due date it will be marked late.</div>
        </div>
      </Modal>
    </div>
  );
}
