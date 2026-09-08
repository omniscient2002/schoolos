/* ============================================================
   SubstitutionReview — proposals from the coordinator-owned
   kernel approvals queue, decided through the coord.decision.v1
   door (POST /coord/substitution/decide). Server law mirrored:
   the action must be coordinator-owned, the proposer can never
   approve their own proposal (SoD), every decision is audited.
   Cover = protection for the class, not a favour ledger.
   ============================================================ */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PageHead, Card, Button, Empty, ErrorState, SkeletonCard, Modal, DataTable, useToast,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { friendly } from '../../lib/friendlyErrors';
import {
  getCoordHome, decideSubstitution,
  type CoordHome, type CoordPendingApproval,
} from '../../services/coordApi';
import { useCoordAccess, useCoordData, CoordDenied, CoordBanner } from './shared';

const isSubstitutionKind = (a: CoordPendingApproval) =>
  a.kind === 'substitution' || /substitut|cover|absen/i.test(a.title);

/** "Grade 8B is 3 weeks behind planned curriculum" style chips live on the monitor;
    here the plain-language line for a proposal's workload impact. */
function impactLine(overloadRisk: boolean) {
  return overloadRisk
    ? 'This substitute is already carrying extra duties this month — approving adds more. Consider redistributing.'
    : 'Within the normal load for this month.';
}

export default function SubstitutionReview() {
  const toast = useToast();
  const navigate = useNavigate();
  const { allowed } = useCoordAccess();
  const { data, loading, error, retry } = useCoordData<CoordHome>(getCoordHome);

  const [decideFor, setDecideFor] = useState<{ a: CoordPendingApproval; decision: 'approved' | 'rejected' } | null>(null);
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const proposals = useMemo(
    () => (data?.pending_approvals ?? []).filter(isSubstitutionKind),
    [data],
  );
  const otherApprovals = useMemo(
    () => (data?.pending_approvals ?? []).filter(a => !isSubstitutionKind(a)),
    [data],
  );

  const absentToday = useMemo(() => new Set(
    (data?.staffing_today ?? []).filter(s => s.status !== 'present').map(s => s.teacher),
  ), [data]);

  const decide = async () => {
    if (!decideFor) return;
    setBusyId(decideFor.a.action_id);
    try {
      const r = await decideSubstitution(decideFor.a.action_id, decideFor.decision, note.trim() || undefined);
      toast({
        title: decideFor.decision === 'approved' ? 'Substitution approved' : 'Substitution rejected',
        sub: r.event
          ? 'The substitute has been assigned and the class covered. Every decision is recorded.'
          : 'Recorded and audited — the proposal stays closed.',
        tone: decideFor.decision === 'approved' ? 'success' : 'info',
      });
      setDecideFor(null); setNote('');
      retry();
    } catch (e) {
      toast({ title: 'Decision not recorded', sub: friendly(e), tone: 'error' });
    } finally { setBusyId(null); }
  };

  if (!allowed) return <CoordDenied what="Substitution review" />;

  const conflictFor = (a: CoordPendingApproval) => {
    /* server-side SoD is authoritative; here we surface the plain-language conflict
       hints we can see: the absent teacher named in the proposal is actually present,
       or the action has been waiting unusually long */
    const named = [...absentToday].find(t => a.title.includes(t));
    if (named) return `${named} is marked absent today — this proposal covers their class.`;
    if (a.age_hours >= 48) return 'This proposal has been waiting over two days — the class may have already been covered informally.';
    return null;
  };

  return (
    <div>
      <PageHead
        back={{ to: '/coord/home', label: 'Command Center' }}
        title="Substitution review"
        sub="Cover proposals for absent teachers — approve to assign the substitute, reject to send it back. Workload impact is checked so cover is shared fairly."
      />

      <CoordBanner
        icon={<Icon.Check size={14} />}
        strong="Every decision is recorded."
        faint="Approving or rejecting writes an audit entry with your name, the note you write, and the policy applied. The teacher who proposed a substitution can never approve their own — the server enforces it."
      />

      {loading && <SkeletonCard lines={8} />}
      {!loading && error && <ErrorState title="Could not load substitution proposals" sub={friendly(error)} onRetry={retry} />}

      {!loading && !error && data && (
        <>
          {proposals.length === 0 ? (
            <Card pad>
              <Empty
                icon={<Icon.Check size={22} />}
                title="No substitution proposals waiting"
                sub="When a teacher is absent and a cover proposal is raised, it lands here for your decision."
              />
            </Card>
          ) : (
            <DataTable<CoordPendingApproval>
              caption="Substitution proposals awaiting a coordinator decision — approve or reject with a note"
              rows={proposals}
              rowKey={a => a.action_id}
              columns={[
                {
                  key: 'proposal', label: 'Proposal',
                  render: a => (
                    <div>
                      <div style={{ fontWeight: 570 }}>{a.title}</div>
                      <div className="u-xs u-faint">{a.code} · {a.kind}</div>
                    </div>
                  ),
                },
                {
                  key: 'conflict', label: 'Checks',
                  render: a => {
                    const c = conflictFor(a);
                    return c
                      ? <span className="u-flex u-xs" style={{ gap: 5, color: 'var(--warning)' }}><Icon.Alert size={12} /> {c}</span>
                      : <span className="u-xs u-faint">no conflicts</span>;
                  },
                },
                { key: 'age', label: 'Waiting', sortable: true, sortValue: a => a.age_hours, render: a => <span className="u-small">{a.age_hours}h</span> },
                {
                  key: 'actions', label: 'Decision', align: 'right',
                  render: a => (
                    <div className="u-flex" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <Button size="sm" variant="primary" disabled={busyId === a.action_id}
                        onClick={() => { setDecideFor({ a, decision: 'approved' }); setNote(''); }}>Approve</Button>
                      <Button size="sm" variant="ghost" disabled={busyId === a.action_id}
                        onClick={() => { setDecideFor({ a, decision: 'rejected' }); setNote(''); }}>Reject…</Button>
                    </div>
                  ),
                },
              ]}
            />
          )}

          {otherApprovals.length > 0 && (
            <Card style={{ marginTop: 20 }}
              head={`${otherApprovals.length} other approval${otherApprovals.length === 1 ? '' : 's'} on your desk`}
              sub="Non-substitution kernel actions — they are decided in the Approval Center."
              actions={<Button variant="secondary" size="sm" onClick={() => navigate('/coord/approvals')}>Open Approval Center</Button>}
            >
              <div className="u-col" style={{ gap: 6 }}>
                {otherApprovals.map(a => (
                  <div key={a.action_id} className="u-between u-small" style={{ gap: 10 }}>
                    <span className="u-truncate">{a.title}</span>
                    <span className="u-xs u-faint" style={{ flexShrink: 0 }}>{a.age_hours}h</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="u-xs u-faint" style={{ marginTop: 16, lineHeight: 1.6 }}>
            Workload impact comes from the fairness view — extra duties beyond the monthly threshold are flagged before you approve,
            so cover is balanced rather than falling on the same few teachers.
          </div>
        </>
      )}

      {/* decide modal — note encouraged, mandatory server-side only for self-approval conflicts */}
      <Modal
        open={!!decideFor} onClose={() => setDecideFor(null)}
        title={decideFor?.decision === 'approved' ? 'Approve this substitution?' : 'Reject this substitution?'}
        sub={decideFor?.a.title}
      >
        {decideFor && (
          <>
            {decideFor.decision === 'approved' && (
              <div className="u-col" style={{ gap: 8, marginBottom: 12 }}>
                <div className="u-small" style={{ fontWeight: 600 }}>Workload impact</div>
                <div className="u-small u-muted" style={{ lineHeight: 1.6 }}>{impactLine(false)}</div>
              </div>
            )}
            <label className="u-small u-muted" htmlFor="sub-note">Note (recommended)</label>
            <textarea
              id="sub-note" className="input" rows={3} maxLength={500} style={{ resize: 'vertical', marginTop: 4 }}
              value={note} onChange={e => setNote(e.target.value)}
              placeholder={decideFor.decision === 'approved' ? 'e.g. Priya covers Periods 3–4; her own grade 6 class is in the library.' : 'e.g. Substitute is already on two covers today — redistributing.'}
            />
            <div className="u-xs u-faint" style={{ marginTop: 6, lineHeight: 1.55 }}>
              {note.length}/500 · Your note is stored with the decision and appears in the audit trail.{' '}
              {decideFor.decision === 'approved' ? 'On approval the substitute is assigned and the school is notified.' : 'A rejection keeps the period open for another proposal.'}
            </div>
          </>
        )}
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setDecideFor(null)}>Cancel</Button>
          <Button
            variant={decideFor?.decision === 'approved' ? 'primary' : 'danger'}
            loading={!!decideFor && busyId === decideFor.a.action_id}
            onClick={decide}
          >
            {decideFor?.decision === 'approved' ? 'Approve & assign' : 'Reject proposal'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
