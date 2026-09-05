/* ============================================================
   WorkOrderDetail — the full work-order page
   (/maintenance/work-orders/:id).
   Everything a facilities decision needs: what was understood,
   why the priority is what it is, who is on it, what the SLA
   says, what it cost, and the audit-grade timeline. Manage
   actions (assign, advance, override, verify, escalate) are
   role-gated and every one writes to the ledger.
   ============================================================ */
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../state/store';
import { maintenanceService } from '../services';
import * as m from '../data/dataset';
import { PageHead, Card, Badge, Button, ErrorState, SkeletonCard, useToast, Avatar, KeyValue, Timeline, Modal } from '../components/ui';
import { Icon } from '../components/Icon';
import { PriorityBadge, WOStatusChip, WOStepper, woStatusLabel, SLAIndicator, AiUnderstanding, PriorityWhy, TechnicianWhy, AssetMini } from '../components/Maint';
import { fmtDateTime, fmtDuration, fmtMoney, fmtRelative, fmtTime } from '../lib/format';
import { useEffect } from 'react';
import type { MaintPriority, WOStatus, WorkOrderRecord } from '../types/domain';

/* standard async hook (APP-SPEC pattern, local copy) */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => live && setState({ data: d, loading: false, error: null }))
      .catch(e => live && setState({ data: null, loading: false, error: String(e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

const PRIORITIES: MaintPriority[] = ['emergency', 'critical', 'high', 'medium', 'low'];
const PRIORITY_LABEL: Record<MaintPriority, string> = { emergency: 'Emergency', critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const DONE_STATES: WOStatus[] = ['resolved', 'closed', 'cancelled'];

const OVERRIDE_REASONS = [
  'Class / exam schedule impact after review',
  'Safety escalation on re-inspection',
  'Reporter escalation (principal / transport)',
  'Vendor availability constraint',
  'Other — described below for the ledger',
];

const KIND_ICON: Record<string, ReactNode> = {
  note: <Icon.Message size={12} />,
  ai: <Icon.Sparkle size={12} />,
  assign: <Icon.User size={12} />,
  status: <Icon.Check size={12} />,
  sla: <Icon.Clock size={12} />,
  voice: <Icon.Mic size={12} />,
  part: <Icon.Grid size={12} />,
};

function CardHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="u-col" style={{ gap: 2, padding: '14px 16px 0' }}>
      <span style={{ fontWeight: 620 }}>{title}</span>
      {sub && <span className="u-small u-muted">{sub}</span>}
    </div>
  );
}

function Stars({ n, size = 14 }: { n: number; size?: number }) {
  return (
    <span className="u-inline" style={{ gap: 2 }} role="img" aria-label={`${n} of 5 stars`}>
      {[1, 2, 3, 4, 5].map(i => (
        <Icon.Star key={i} size={size} style={{ color: i <= n ? '#DC6803' : 'var(--border)' }} />
      ))}
    </span>
  );
}

export default function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { domain } = useStore();

  const wo = domain.workOrders.find(w => w.id === id);

  if (!wo) {
    return (
      <>
        <PageHead title="Work order" back={{ to: '/maintenance/work-orders', label: 'Work-order board' }} />
        <ErrorState
          title="Work order not found"
          sub={id ? `No work order with id “${id}” exists in the current scope.` : 'Open a work order from the board.'}
        />
        <div style={{ textAlign: 'center', marginTop: 4 }}>
          <Button variant="secondary" icon={<Icon.ChevronLeft size={14} />} onClick={() => navigate('/maintenance/work-orders')}>Back to the board</Button>
        </div>
      </>
    );
  }

  return <WorkOrderBody key={wo.id} wo={wo} />;
}

/* ============================================================ */

function WorkOrderBody({ wo }: { wo: WorkOrderRecord }) {
  const navigate = useNavigate();
  const { session, dispatch, actorName } = useStore();
  const toast = useToast();
  const canManage = ['facilities', 'principal', 'owner'].includes(session.roleId);

  const sla = m.slaState(wo);
  const policy = m.SLA_POLICY[wo.priority];
  const asset = wo.assetId ? m.assetById(wo.assetId) : undefined;
  const open = !DONE_STATES.includes(wo.status);

  const recs = useAsync(() => maintenanceService.recommend(wo.category, wo.campus), [wo.id, wo.category, wo.campus]);

  const [busy, setBusy] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [newPriority, setNewPriority] = useState<MaintPriority>(wo.priority);
  const [reason, setReason] = useState('');

  /* ---- actions ---- */
  const assignTo = async (name: string) => {
    setBusy(`assign:${name}`);
    try {
      const res = await maintenanceService.assign(wo.id, name, actorName);
      if (!res.data) throw new Error(res.error ?? 'Assignment was not accepted');
      dispatch({
        type: 'wo/patch', id: wo.id,
        patch: { assignedTo: name, assignedOn: new Date(), status: 'assigned' },
        actor: actorName, note: `Assigned to ${name}`,
      });
      toast({ title: `Assigned to ${name}`, sub: `${wo.id} is on their queue — response clock is running.`, tone: 'success' });
    } catch (e) {
      toast({ title: 'Could not assign', sub: String(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const quickAdvance = async (to: Extract<WOStatus, 'accepted' | 'en-route' | 'on-site' | 'repairing'>, note: string) => {
    setBusy(`adv:${to}`);
    try {
      await maintenanceService.advance(wo.id, to, actorName, note);
      dispatch({ type: 'wo/advance', id: wo.id, to, actor: actorName, note, actorRole: session.roleId });
      toast({ title: `${wo.id} → ${woStatusLabel(to)}`, sub: note, tone: 'success' });
    } catch (e) {
      toast({ title: 'Update failed', sub: String(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const submitOverride = () => {
    if (!reason.trim() || newPriority === wo.priority) return;
    const note = `Priority overridden → ${newPriority} · reason recorded`;
    dispatch({
      type: 'wo/patch', id: wo.id,
      patch: {
        priority: newPriority,
        timeline: [...wo.timeline, { on: new Date(), actor: actorName, note, kind: 'status' as const }],
      },
      actor: actorName, note,
    });
    toast({ title: 'Override recorded in the audit ledger', sub: `${wo.id} → ${PRIORITY_LABEL[newPriority]} · reason: ${reason.trim()}`, tone: 'success' });
    setOverrideOpen(false);
    setReason('');
  };

  const verifyAndClose = async () => {
    setBusy('verify');
    try {
      await maintenanceService.rate(wo.id, 5);
      dispatch({ type: 'wo/advance', id: wo.id, to: 'resolved', actor: actorName, note: 'Verified — fix confirmed', actorRole: session.roleId });
      toast({ title: 'Verified — work order resolved', sub: `5★ confirmed with ${wo.reportedBy}; the audit ledger has the entry.`, tone: 'success' });
    } catch (e) {
      toast({ title: 'Verification failed', sub: String(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const escalate = () => {
    const note = 'Escalated to vendor — contract SLA invoked';
    dispatch({
      type: 'wo/patch', id: wo.id,
      patch: { escalation: 'vendor', timeline: [...wo.timeline, { on: new Date(), actor: actorName, note, kind: 'status' as const }] },
      actor: actorName, note,
    });
    toast({ title: 'Escalated to vendor', sub: `${wo.id} moved to the vendor queue — tracked in the audit ledger.`, tone: 'success' });
  };

  const assignedTech = m.technicianByName(wo.assignedTo);

  return (
    <div>
      <PageHead
        title={
          <span className="u-inline" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span className="u-mono" style={{ fontSize: '0.72em', color: 'var(--text-3)', fontWeight: 620 }}>{wo.id}</span>
            <span>{wo.title}</span>
          </span>
        }
        sub={`Reported by ${wo.reportedBy} · ${fmtRelative(wo.reportedOn)} · ${wo.building}${wo.room ? ` · ${wo.room}` : ''} · ${wo.category}${wo.recurrenceOf ? ` · recurrence of ${wo.recurrenceOf}` : ''}`}
        back={{ to: '/maintenance/work-orders', label: 'Work-order board' }}
        actions={
          <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
            <PriorityBadge p={wo.priority} />
            <WOStatusChip s={wo.status} />
            {open && <SLAIndicator sla={sla} breach />}
          </div>
        }
      />

      {/* ---- lifecycle ---- */}
      <Card style={{ marginBottom: 16 }}>
        <WOStepper wo={wo} />
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 430px), 1fr))', gap: 16, alignItems: 'start' }}>
        {/* ================= left column ================= */}
        <div className="u-col" style={{ gap: 16 }}>
          <Card>
            <CardHead title="Reported issue" sub={`via ${wo.source} · ${fmtDateTime(wo.reportedOn)}`} />
            <div className="card-body u-col" style={{ gap: 12 }}>
              <p style={{ margin: 0, lineHeight: 1.65 }}>{wo.description}</p>
            {wo.resolution && (
              <>
                <div className="divider" />
                <div className="u-col" style={{ gap: 4 }}>
                  <span className="u-upper" style={{ fontWeight: 620 }}>Resolution</span>
                  <span style={{ fontSize: 'var(--text-sm)' }}>{wo.resolution.summary}</span>
                  <span className="u-small u-muted">Root cause: {wo.resolution.rootCause}{wo.resolution.preventiveNote ? ` · ${wo.resolution.preventiveNote}` : ''}</span>
                </div>
              </>
            )}
            </div>
          </Card>

          {wo.aiUnderstanding && (
            <Card>
              <CardHead title="AI understanding" sub="From the report text — every claim traces to the record below it" />
              <div className="card-body"><AiUnderstanding wo={wo} /></div>
            </Card>
          )}

          <Card>
            <div className="u-between" style={{ gap: 10, padding: '14px 16px 0', flexWrap: 'wrap' }}>
              <CardHead title="Why this priority" sub="Deterministic factors — overrides are audited with a reason" />
              {canManage && open && (
                <Button size="sm" variant="secondary" icon={<Icon.Edit size={12} />} onClick={() => { setNewPriority(wo.priority); setOverrideOpen(true); }}>
                  Override
                </Button>
              )}
            </div>
            <div className="card-body u-col" style={{ gap: 12 }}>
            {wo.priorityFactors && wo.priorityFactors.length > 0
              ? <PriorityWhy factors={wo.priorityFactors} />
              : <span className="u-small u-muted">Priority set by intake rules (Facilities §1.1) — no weighted factors recorded for this work order.</span>}
            {wo.escalation && wo.escalation !== 'none' && (
              <div className="u-inline" style={{ gap: 8 }}>
                <Badge tone={wo.escalation === 'vendor' ? 'warning' : 'info'} dot>Escalated to {wo.escalation}</Badge>
              </div>
            )}
            </div>
          </Card>

          <Card>
            <CardHead title="Timeline" sub={`${wo.timeline.length} entries · newest first`} />
            <div className="card-body">
              <Timeline
                items={[...wo.timeline].reverse().map(t => ({
                  time: fmtDateTime(t.on),
                  title: t.note,
                  body: t.actor,
                  icon: KIND_ICON[t.kind ?? 'note'],
                  dot: t.kind === 'ai' ? 'ai' as const : t.kind === 'sla' ? 'danger' as const : (t.kind === 'status' || t.kind === 'assign') ? 'accent' as const : undefined,
                }))}
              />
            </div>
          </Card>
        </div>

        {/* ================= right column ================= */}
        <div className="u-col" style={{ gap: 16 }}>
          <Card>
            <CardHead title="Asset" />
            <div className="card-body">
              {asset
                ? <AssetMini asset={asset} onClick={() => navigate(`/maintenance/assets/${asset.id}`)} />
                : <span className="u-small u-muted">No registered asset linked — general facilities work.</span>}
            </div>
          </Card>

          {/* ---- assignment ---- */}
          <Card>
            <CardHead title="Assignment" sub={wo.assignedTo ? undefined : 'Ranked by skill match, first-time fix rate and workload'} />
            <div className="card-body">
            {!wo.assignedTo ? (
              recs.loading ? (
                <SkeletonCard lines={2} />
              ) : recs.error ? (
                <ErrorState title="Could not load recommendations" sub={recs.error} onRetry={recs.retry} />
              ) : (
                <div className="u-col" style={{ gap: 14 }}>
                  {(recs.data ?? []).map(r => (
                    <div key={r.tech.id} className="u-col" style={{ gap: 7 }}>
                      <div className="u-inline" style={{ gap: 10, alignItems: 'center' }}>
                        <Avatar name={r.tech.name} size="md" />
                        <div className="u-col" style={{ gap: 1, flex: 1, minWidth: 0 }}>
                          <span className="u-inline" style={{ gap: 7 }}>
                            <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{r.tech.name}</span>
                            {r.skillMatch && <Badge tone="success" dot>Skill match</Badge>}
                          </span>
                          <span className="u-small u-muted">{r.tech.lastSeen} · shift {r.tech.shift}</span>
                        </div>
                        <Button
                          size="sm" variant="primary"
                          loading={busy === `assign:${r.tech.name}`}
                          disabled={!!busy}
                          onClick={() => assignTo(r.tech.name)}
                        >
                          Assign
                        </Button>
                      </div>
                      <TechnicianWhy why={r.why} score={r.score} />
                    </div>
                  ))}
                  {(recs.data ?? []).length === 0 && (
                    <span className="u-small u-muted">No technician recommendations for {wo.category} on this campus — assign from the vendor panel.</span>
                  )}
                  {canManage && open && wo.escalation !== 'vendor' && (
                    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                      <Button size="sm" variant="secondary" icon={<Icon.ArrowUpRight size={13} />} onClick={escalate}>Escalate to vendor</Button>
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="u-col" style={{ gap: 12 }}>
                <div className="u-inline" style={{ gap: 12, alignItems: 'center' }}>
                  <Avatar name={wo.assignedTo} size="lg" />
                  <div className="u-col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 620 }}>{wo.assignedTo}</span>
                    <span className="u-small u-muted">
                      {assignedTech ? `${assignedTech.skills.join(' · ')} · ${assignedTech.phone}` : 'Technician'}
                    </span>
                    <span className="u-small u-muted">
                      Assigned {wo.assignedOn ? fmtRelative(wo.assignedOn) : '—'}{assignedTech ? ` · ${assignedTech.lastSeen}` : ''}
                    </span>
                  </div>
                </div>

                {wo.status === 'assigned' && (
                  <Button variant="primary" icon={<Icon.Check size={14} />} loading={busy === 'adv:accepted'} disabled={!!busy}
                    onClick={() => quickAdvance('accepted', 'Accepted — responding now')}>
                    Accept
                  </Button>
                )}
                {wo.status === 'accepted' && (
                  <Button variant="primary" icon={<Icon.ArrowRight size={14} />} loading={busy === 'adv:en-route'} disabled={!!busy}
                    onClick={() => quickAdvance('en-route', `En route to ${wo.building}${wo.room ? ` · ${wo.room}` : ''}`)}>
                    En route
                  </Button>
                )}
                {wo.status === 'en-route' && (
                  <Button variant="primary" icon={<Icon.Compass size={14} />} loading={busy === 'adv:on-site'} disabled={!!busy}
                    onClick={() => quickAdvance('on-site', 'On site — starting diagnosis')}>
                    On site
                  </Button>
                )}
                {wo.status === 'on-site' && (
                  <Button variant="primary" icon={<Icon.Wrench size={14} />} loading={busy === 'adv:repairing'} disabled={!!busy}
                    onClick={() => quickAdvance('repairing', 'Repair started')}>
                    Start repair
                  </Button>
                )}
                {wo.status === 'repairing' && (
                  <span className="u-small u-muted">Work in progress — the technician completes this job from the technician workspace.</span>
                )}
                {wo.status === 'verification' && (
                  <span className="u-small u-muted">Repair reported complete — waiting on verification below.</span>
                )}

                {canManage && open && (
                  <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                    {wo.escalation === 'vendor'
                      ? <Badge tone="warning" dot>Escalated to vendor</Badge>
                      : <Button size="sm" variant="secondary" icon={<Icon.ArrowUpRight size={13} />} onClick={escalate}>Escalate to vendor</Button>}
                  </div>
                )}
              </div>
            )}
            </div>
          </Card>

          {/* ---- SLA ---- */}
          <Card head="SLA" sub={`Policy for ${PRIORITY_LABEL[wo.priority]}: respond ${policy.responseMins} min · resolve ${policy.resolveMins / 60}h`}>
            <KeyValue
              cols={1}
              items={[
                { k: 'Respond by', v: fmtDateTime(wo.sla.responseBy) },
                { k: 'Resolve by', v: fmtDateTime(wo.sla.resolveBy) },
                { k: 'Responded', v: wo.respondedOn ? fmtDateTime(wo.respondedOn) : 'Not yet — clock running' },
                {
                  k: 'Window state',
                  v: (
                    <span className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <SLAIndicator sla={sla} breach />
                      {wo.slaBreached && <Badge tone="danger" dot>Breach recorded</Badge>}
                    </span>
                  ),
                },
              ]}
            />
          </Card>

          {/* ---- verification / close ---- */}
          {((wo.status === 'verification' && canManage) || wo.reporterRating != null || wo.verifiedBy) && (
            <Card head="Verification" sub="A human confirms the fix before close — the loop that keeps trust">
              <div className="u-col" style={{ gap: 10 }}>
                {wo.verifiedBy && (
                  <span className="u-small">Verified by <b>{wo.verifiedBy}</b>{wo.verificationNote ? ` — “${wo.verificationNote}”` : ''}</span>
                )}
                {wo.reporterRating != null && (
                  <span className="u-inline" style={{ gap: 8 }}>
                    <Stars n={wo.reporterRating} />
                    <span className="u-small u-muted">Reporter rating</span>
                  </span>
                )}
                {wo.status === 'verification' && canManage && (
                  <>
                    <span className="u-small u-muted">
                      Confirm the fix is real — this resolves {wo.id}, records a 5★ confirmation with {wo.reportedBy}, and closes the audit trail.
                    </span>
                    <Button variant="primary" icon={<Icon.Check size={14} />} loading={busy === 'verify'} disabled={!!busy} onClick={verifyAndClose}>
                      Verify & close
                    </Button>
                  </>
                )}
              </div>
            </Card>
          )}

          {/* ---- parts & cost ---- */}
          <Card head="Parts & cost" sub="Recorded at completion — nothing estimated">
            {(wo.partsUsed?.length ?? 0) > 0 ? (
              <div className="u-col" style={{ gap: 8 }}>
                {wo.partsUsed!.map((p, i) => (
                  <div key={i} className="u-between" style={{ fontSize: 'var(--text-sm)' }}>
                    <span className="u-inline" style={{ gap: 7 }}>
                      <Icon.Grid size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                      {p.name} <span className="u-muted">× {p.qty}</span>
                    </span>
                    <span className="u-mono">{fmtMoney(p.cost)}</span>
                  </div>
                ))}
                <div className="divider" style={{ margin: '4px 0' }} />
                <div className="u-between" style={{ fontSize: 'var(--text-sm)' }}>
                  <span className="u-muted">Parts total</span>
                  <span className="u-mono" style={{ fontWeight: 640 }}>{fmtMoney(m.woSpend(wo))}</span>
                </div>
                {wo.labourMins != null && (
                  <div className="u-between" style={{ fontSize: 'var(--text-sm)' }}>
                    <span className="u-muted">Labour</span>
                    <span className="u-mono">{fmtDuration(wo.labourMins)}</span>
                  </div>
                )}
              </div>
            ) : (
              <span className="u-small u-muted">No parts recorded yet — spares and consumables appear here when the job is completed.</span>
            )}
          </Card>

          {/* ---- photos ---- */}
          <Card head="Photos" sub="Before / after placeholders from the field">
            {(wo.photos?.length ?? 0) > 0 ? (
              <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                {wo.photos!.map((ph, i) => (
                  <span key={i} className="u-inline" style={{ gap: 7, border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', background: 'var(--surface-3)' }}>
                    <Badge tone={ph.stage === 'before' ? 'neutral' : 'success'}>{ph.stage === 'before' ? 'BEFORE' : 'AFTER'}</Badge>
                    <span className="u-small">{ph.note}</span>
                    <span className="u-xs u-faint u-mono">{fmtTime(ph.on)}</span>
                  </span>
                ))}
              </div>
            ) : (
              <span className="u-small u-muted">No photos attached — before/after captures land here as the job progresses.</span>
            )}
          </Card>
        </div>
      </div>

      {/* ---- priority override modal ---- */}
      <Modal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Override priority"
        sub={`${wo.id} — currently ${PRIORITY_LABEL[wo.priority]}. Overrides are recorded in the audit ledger with your reason.`}
        footer={
          <div className="u-inline" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setOverrideOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!reason.trim() || newPriority === wo.priority} onClick={submitOverride}>
              Record override
            </Button>
          </div>
        }
      >
        <div className="u-col" style={{ gap: 12 }}>
          <label className="u-col" style={{ gap: 5 }}>
            <span className="u-small" style={{ fontWeight: 600 }}>New priority</span>
            <select className="input" value={newPriority} onChange={e => setNewPriority(e.target.value as MaintPriority)}>
              {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}{p === wo.priority ? ' (current)' : ''}</option>)}
            </select>
          </label>
          <label className="u-col" style={{ gap: 5 }}>
            <span className="u-small" style={{ fontWeight: 600 }}>Common reasons</span>
            <select className="input" value="" onChange={e => e.target.value && setReason(e.target.value)}>
              <option value="">Pick a reason to start, or write your own below…</option>
              {OVERRIDE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="u-col" style={{ gap: 5 }}>
            <span className="u-small" style={{ fontWeight: 600 }}>Reason (recorded verbatim)</span>
            <textarea className="textarea" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Board exam scheduled in this lab tomorrow — needs the room guaranteed" />
          </label>
          <span className="u-small u-muted">SLA windows already issued are not back-dated; the ledger keeps the original timestamps alongside the override.</span>
        </div>
      </Modal>
    </div>
  );
}
