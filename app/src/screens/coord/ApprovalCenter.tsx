/* ============================================================
   ApprovalCenter — the coordinator's kernel approvals queue
   (from GET /coord/home → pending_approvals: every open kernel
   action owned by the coordinator role).

   Decide contract (frozen doors):
   · substitution-kind actions → POST /coord/substitution/decide
     (decision 'approved' | 'rejected', kernel-audited, SoD enforced)
   · everything else → POST /actions/:id/decide (routes.js kernel
     decide: decision 'approved' | 'dismissed', audit + execution)

   Every decision carries an optional note and is recorded — the
   banner says so in plain language. Non-coordinator-owned kernel
   work stays in the shared Action Center (linked, not duplicated).
   ============================================================ */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PageHead, Card, Badge, Button, Empty, ErrorState, SkeletonCard, Tabs, Modal, useToast,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { friendly } from '../../lib/friendlyErrors';
import { humanize } from '../../lib/labels';
import {
  getCoordHome, decideSubstitution, decideGenericAction,
  type CoordHome, type CoordPendingApproval,
} from '../../services/coordApi';
import { useCoordAccess, useCoordData, CoordDenied, CoordBanner } from './shared';

const isSubstitutionKind = (a: CoordPendingApproval) =>
  a.kind === 'substitution' || /substitut|cover|absen/i.test(a.title);

const ageLabel = (h: number) => (h >= 48 ? `${Math.round(h / 24)}d waiting` : h >= 24 ? `${Math.round(h)}h waiting` : `${h}h waiting`);

export default function ApprovalCenter() {
  const toast = useToast();
  const navigate = useNavigate();
  const { allowed } = useCoordAccess();
  const { data, loading, error, retry } = useCoordData<CoordHome>(getCoordHome);
  const [tab, setTab] = useState('all');
  const [decideFor, setDecideFor] = useState<{ a: CoordPendingApproval; decision: 'approved' | 'rejected' } | null>(null);
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const all = useMemo(() => data?.pending_approvals ?? [], [data]);
  const subs = useMemo(() => all.filter(isSubstitutionKind), [all]);
  const other = useMemo(() => all.filter(a => !isSubstitutionKind(a)), [all]);
  const visible = tab === 'substitutions' ? subs : tab === 'other' ? other : all;

  const decide = async () => {
    if (!decideFor) return;
    setBusyId(decideFor.a.action_id);
    try {
      if (isSubstitutionKind(decideFor.a)) {
        await decideSubstitution(decideFor.a.action_id, decideFor.decision, note.trim() || undefined);
      } else {
        /* kernel decide door speaks 'approved' | 'dismissed' (routes.js) */
        await decideGenericAction(decideFor.a.action_id, decideFor.decision === 'approved' ? 'approved' : 'dismissed', note.trim() || undefined);
      }
      toast({
        title: decideFor.decision === 'approved' ? 'Approved — recorded' : 'Rejected — recorded',
        sub: 'The decision, your note and the policy applied are written to the audit trail.',
        tone: decideFor.decision === 'approved' ? 'success' : 'info',
      });
      setDecideFor(null); setNote('');
      retry();
    } catch (e) {
      toast({ title: 'Decision not recorded', sub: friendly(e), tone: 'error' });
    } finally { setBusyId(null); }
  };

  if (!allowed) return <CoordDenied what="The approval center" />;

  return (
    <div>
      <PageHead
        back={{ to: '/coord/home', label: 'Command Center' }}
        title="Approval Center"
        sub="Coordination decisions owned by the coordinator role — substitution cover and coordination decisions in one queue, each decided with a note and an audit entry."
        actions={<Button variant="secondary" size="sm" icon={<Icon.Refresh size={13} />} onClick={retry}>Refresh</Button>}
      />

      <CoordBanner
        icon={<Icon.Check size={14} />}
        strong="Every decision is recorded."
        faint="Approve or reject writes an immutable audit entry with your name, note and policy. The teacher who proposed an action can never approve their own — the server enforces that separation."
      />

      {loading && <SkeletonCard lines={8} />}
      {!loading && error && <ErrorState title="Could not load the approvals queue" sub={friendly(error)} onRetry={retry} />}

      {!loading && !error && data && (
        all.length === 0 ? (
          <Card pad>
            <Empty
              icon={<Icon.Check size={22} />}
              title="Nothing is waiting on you"
              sub="Coordination decisions owned by the coordinator land here the moment they are raised — substitutions, routing requests and coordination approvals."
            />
          </Card>
        ) : (
          <>
            <Tabs
              tabs={[
                { id: 'all', label: 'All pending', count: all.length },
                { id: 'substitutions', label: 'Substitutions', count: subs.length },
                { id: 'other', label: 'Other decisions', count: other.length },
              ]}
              active={tab} onChange={setTab}
            />
            <div style={{ height: 14 }} />

            {visible.length === 0 ? (
              <Card pad>
                <Empty icon={<Icon.Check size={22} />} title="Nothing in this queue" sub="Switch tabs to see the rest of the pending decisions." />
              </Card>
            ) : (
              <div className="u-col" style={{ gap: 12 }}>
                {visible.map(a => {
                  const isSub = isSubstitutionKind(a);
                  return (
                    <Card key={a.action_id} pad>
                      <div className="u-col" style={{ gap: 8 }}>
                        <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <Badge tone="outline">{isSub ? 'Substitution' : a.kind ? humanize(a.kind) : 'Decision'}</Badge>
                          {a.age_hours >= 48 && <Badge tone="warning" dot>{ageLabel(a.age_hours)}</Badge>}
                          <span className="u-xs u-faint" style={{ marginLeft: 'auto' }}>{a.code} · waiting {ageLabel(a.age_hours)}</span>
                        </div>
                        <div style={{ fontWeight: 620, fontSize: 'var(--text-lg)', lineHeight: 1.35 }}>{a.title}</div>
                        <div className="u-xs u-faint" style={{ lineHeight: 1.55 }}>
                          {isSub
                            ? 'Decided through the substitution process — the substitute is assigned on approval and the school is notified.'
                            : 'Decided through the approvals process — any follow-up attached to the action runs on approval.'}
                        </div>
                        <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                          <Button size="sm" variant="primary" icon={<Icon.Check size={12} />} disabled={busyId === a.action_id}
                            onClick={() => { setDecideFor({ a, decision: 'approved' }); setNote(''); }}>Approve</Button>
                          <Button size="sm" variant="ghost" icon={<Icon.X size={12} />} disabled={busyId === a.action_id}
                            onClick={() => { setDecideFor({ a, decision: 'rejected' }); setNote(''); }}>Reject…</Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}

            <div className="u-small u-muted" style={{ marginTop: 18, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Icon.Info size={13} />
              <span>
                Decisions owned by other roles live in the shared{' '}
                <button className="u-small" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', color: 'var(--accent-text)' }} onClick={() => navigate('/action-center')}>
                  Action Center
                </button>.
              </span>
            </div>
          </>
        )
      )}

      <Modal
        open={!!decideFor} onClose={() => setDecideFor(null)}
        title={decideFor?.decision === 'approved' ? 'Approve this action?' : 'Reject this action?'}
        sub={decideFor?.a.title}
      >
        {decideFor && (
          <>
            <div className="u-small u-muted" style={{ lineHeight: 1.6, marginBottom: 12 }}>
              {isSubstitutionKind(decideFor.a)
                ? decideFor.decision === 'approved'
                  ? 'On approval the proposed substitute is assigned and the class is covered.'
                  : 'A rejection closes the proposal — the period stays open for another cover plan.'
                : decideFor.decision === 'approved'
                  ? 'On approval any execution attached to this action runs immediately.'
                  : 'A dismissal closes the action without executing anything.'}
            </div>
            <label className="u-small u-muted" htmlFor="appr-note">Note (recommended)</label>
            <textarea
              id="appr-note" className="input" rows={3} maxLength={500} style={{ resize: 'vertical', marginTop: 4 }}
              value={note} onChange={e => setNote(e.target.value)}
              placeholder="Why this decision — it is stored with the audit entry"
            />
            <div className="u-xs u-faint" style={{ marginTop: 6 }}>{note.length}/500 · recorded with your name and the policy applied</div>
          </>
        )}
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setDecideFor(null)}>Cancel</Button>
          <Button
            variant={decideFor?.decision === 'approved' ? 'primary' : 'danger'}
            loading={!!decideFor && busyId === decideFor.a.action_id}
            onClick={decide}
          >
            {decideFor?.decision === 'approved' ? 'Approve' : 'Reject'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
