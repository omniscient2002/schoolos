/* ============================================================
   Mistakes — StudentOS learn lane (SU-2, PRD-6).

   The mistake notebook: one note per slip, with the fix and the
   lesson so the same mistake is less likely next time. Own rows
   only; adding and deleting are the student's own actions.

   Doors: GET/POST /student/mistakes · DELETE /student/mistakes/:id.
   ============================================================ */
import { useEffect, useState } from 'react';
import { PageHead, Card, Button, Empty, ErrorState, SkeletonCard, Modal, useToast } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { friendly } from '../../../lib/friendlyErrors';
import { getMistakes, addMistake, deleteMistake, type StudentMistake } from '../../../services/studentApi';

export default function Mistakes() {
  const toast = useToast();
  const [mistakes, setMistakes] = useState<StudentMistake[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [whatWrong, setWhatWrong] = useState('');
  const [correction, setCorrection] = useState('');
  const [lesson, setLesson] = useState('');
  const [saving, setSaving] = useState(false);

  const [confirming, setConfirming] = useState<StudentMistake | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getMistakes()
      .then(d => { if (alive) setMistakes(d.mistakes); })
      .catch(e => { if (alive) setError(friendly(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tick]);

  const canAdd = subject.trim() && topic.trim() && whatWrong.trim();

  const add = async () => {
    if (!canAdd) return;
    setSaving(true);
    try {
      await addMistake({
        subject: subject.trim(),
        topic: topic.trim(),
        whatWrong: whatWrong.trim(),
        correction: correction.trim() || undefined,
        lesson: lesson.trim() || undefined,
      });
      setSubject(''); setTopic(''); setWhatWrong(''); setCorrection(''); setLesson('');
      toast({ title: 'Saved to your mistake notebook', tone: 'success' });
      setTick(t => t + 1);
    } catch (e) {
      toast({ title: 'Could not save', sub: friendly(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirming) return;
    setDeleting(true);
    try {
      await deleteMistake(confirming.id);
      setConfirming(null);
      toast({ title: 'Removed', tone: 'success' });
      setTick(t => t + 1);
    } catch (e) {
      toast({ title: 'Could not remove', sub: friendly(e), tone: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  const rows = mistakes ?? [];

  return (
    <div>
      <PageHead
        title="Mistake notebook"
        sub="Write down what went wrong and how you fixed it. Looking back here before a test helps."
      />

      <Card headAs="h2" head="Add a mistake" sub="Only the first three lines are needed.">
        <div className="grid grid-2" style={{ gap: '0 16px' }}>
          <div className="field">
            <label htmlFor="mk-subject">Subject</label>
            <input id="mk-subject" className="input" value={subject} placeholder="e.g. Maths" onChange={e => setSubject(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="mk-topic">Topic</label>
            <input id="mk-topic" className="input" value={topic} placeholder="e.g. Fractions" onChange={e => setTopic(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="mk-wrong">What went wrong</label>
          <textarea id="mk-wrong" className="textarea" rows={2} value={whatWrong} placeholder="e.g. I added the denominators." onChange={e => setWhatWrong(e.target.value)} />
        </div>
        <div className="grid grid-2" style={{ gap: '0 16px' }}>
          <div className="field">
            <label htmlFor="mk-fix">The correction (optional)</label>
            <input id="mk-fix" className="input" value={correction} placeholder="e.g. Find a common denominator first." onChange={e => setCorrection(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="mk-lesson">What I learned (optional)</label>
            <input id="mk-lesson" className="input" value={lesson} placeholder="e.g. Check the denominator before adding." onChange={e => setLesson(e.target.value)} />
          </div>
        </div>
        <div className="u-flex" style={{ justifyContent: 'flex-end' }}>
          <Button variant="primary" icon={<Icon.Plus size={14} />} loading={saving} disabled={!canAdd} onClick={add}>Save mistake</Button>
        </div>
      </Card>

      <div style={{ marginTop: 18 }}>
        {loading && <SkeletonCard lines={5} />}

        {!loading && error && (
          <ErrorState title="Your notebook did not load" sub={error} onRetry={() => setTick(t => t + 1)} />
        )}

        {!loading && !error && rows.length === 0 && (
          <Empty
            icon={<Icon.Book size={22} />}
            title="Your mistake notebook is empty"
            sub="Add the first one above. Mistakes are how you find what to practise next."
          />
        )}

        {!loading && !error && rows.length > 0 && (
          <div className="u-col" style={{ gap: 10 }}>
            {rows.map(m => (
              <Card key={m.id} pad>
                <div className="u-between u-wrap" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="u-small u-muted">{m.subject}{m.topic && m.topic !== '—' ? ` · ${m.topic}` : ''}</div>
                    <div style={{ fontWeight: 560, marginTop: 3 }}>{m.whatWrong || 'No description written'}</div>
                    {m.correction && <div className="u-small" style={{ marginTop: 5 }}><span className="u-muted">Fix: </span>{m.correction}</div>}
                    {m.lesson && <div className="u-small" style={{ marginTop: 3 }}><span className="u-muted">Learned: </span>{m.lesson}</div>}
                  </div>
                  <Button variant="ghost" size="sm" icon={<Icon.Trash size={13} />} aria-label={`Delete mistake — ${m.topic || m.subject}`} onClick={() => setConfirming(m)}>Delete</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title="Delete this note?"
        sub={confirming ? `${confirming.subject}${confirming.topic && confirming.topic !== '—' ? ` · ${confirming.topic}` : ''}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>Keep it</Button>
            <Button variant="danger" loading={deleting} onClick={remove}>Delete</Button>
          </>
        }
      >
        <p className="u-small" style={{ margin: 0 }}>This removes the note from your mistake notebook. It cannot be brought back.</p>
      </Modal>
    </div>
  );
}
