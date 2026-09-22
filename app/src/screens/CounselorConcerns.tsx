/* ============================================================
   CounselorConcerns — OPP-PRD-8. The counselor's referral queue:
   concerns routed to this desk (or the whole board for oversight),
   with the append-only outcome door that closes them. Reads
   GET /teacher/concerns (routed-to-me scope) and writes
   POST /teacher/concern/:id/outcome. Privacy-tiered: a counselor
   sees the routed board, never the safety box's reporter identity.
   ============================================================ */
import { useState } from 'react';
import { Badge, Button, Card, Empty, PageHead, Section, SkeletonCard, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtRelative } from '../lib/format';
import { useSession } from '../App';
import {
  listMyConcerns, recordConcernOutcome,
  type TeacherConcern,
} from '../services/teacherApi';
import { AsyncGate, DeniedState, useAsync, useTeacherAccess } from './teacher/teacherKit';

const STATUS_TONE: Record<string, 'info' | 'warning' | 'success' | 'neutral'> = {
  open: 'warning', routed: 'info', in_support: 'info', closed: 'success',
};
const OUTCOMES = [
  { id: 'resolved', label: 'Resolved — support given' },
  { id: 'monitoring', label: 'Monitoring — keep watching' },
  { id: 'referred_out', label: 'Referred out — external support' },
  { id: 'escalated', label: 'Escalated — needs the principal' },
];

function OutcomeForm({ concern, onDone }: { concern: TeacherConcern; onDone: () => void }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState('resolved');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!note.trim()) { toast({ title: 'Add a short outcome note', tone: 'error' }); return; }
    setBusy(true);
    try {
      await recordConcernOutcome(concern.concernId, outcome, note.trim());
      toast({ title: 'Concern closed', tone: 'success' });
      onDone();
    } catch (e) {
      toast({ title: 'Could not record the outcome', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setBusy(false); }
  };
  return (
    <div className="u-flex u-gap-2 u-wrap" style={{ alignItems: 'flex-end', marginTop: 10 }}>
      <label className="u-small">Outcome
        <select className="select" value={outcome} onChange={e => setOutcome(e.target.value)}>
          {OUTCOMES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      <label className="u-small" style={{ flex: 1, minWidth: 220 }}>What support was given
        <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. met the student, spoke to the class teacher" style={{ width: '100%' }} />
      </label>
      <Button size="sm" variant="primary" loading={busy} onClick={save}>Close concern</Button>
    </div>
  );
}

export default function CounselorConcerns() {
  const session = useSession();
  const allowed = useTeacherAccess('/teacher/concerns');
  const list = useAsync(() => listMyConcerns(), []);
  if (!allowed) return <DeniedState role={session.role} />;
  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <PageHead
        title="Referral queue"
        sub="Concerns routed to this desk. You see what was routed to you; the safety box keeps its reporter anonymous."
      />
      <Section title="Routed concerns" sub="Newest first.">
        <AsyncGate state={list} skeleton={<SkeletonCard lines={6} />}
          empty={<Empty icon={<Icon.Heart size={22} />} title="Nothing routed to you" sub="When a coordinator routes a concern to the counselor desk it appears here." />}>
          {({ concerns }) => concerns.length === 0
            ? <Empty icon={<Icon.Heart size={22} />} title="Nothing routed to you" sub="When a coordinator routes a concern to the counselor desk it appears here." />
            : (
              <div className="u-col" style={{ gap: 10 }}>
                {concerns.map(c => (
                  <Card key={c.concernId} pad>
                    <div className="u-between u-wrap" style={{ gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="u-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Badge tone={STATUS_TONE[c.status] ?? 'neutral'} dot>{c.status.replace('_', ' ')}</Badge>
                          <Badge tone="outline">{c.category}</Badge>
                          {c.studentName && <span className="u-small u-muted">{c.studentName}</span>}
                          <span className="u-xs u-faint">{fmtRelative(c.createdAt)}</span>
                        </div>
                        <p className="u-small" style={{ margin: '6px 0 0' }}>{c.detail}</p>
                        {c.outcome && <div className="u-xs u-faint" style={{ marginTop: 4 }}>Outcome: {c.outcome}{c.outcomeNote ? ` — ${c.outcomeNote}` : ''}</div>}
                      </div>
                    </div>
                    {c.status !== 'closed' && c.status !== 'open' && <OutcomeForm concern={c} onDone={() => list.retry()} />}
                  </Card>
                ))}
              </div>
            )}
        </AsyncGate>
      </Section>
    </div>
  );
}
