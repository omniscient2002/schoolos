/* ============================================================
   Action Center — the unified inbox of everything awaiting a
   decision. Tabs by kind, posture badges, evidence chips that
   open an evidence-chain drawer, AI trace where involved,
   approve/dismiss with toast + audit (via the store reducer),
   and a resolution progress bar.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import * as seed from '../data/dataset';
import { PageHead, Card, Badge, Button, Empty, Tabs, Drawer, Skeleton, SkeletonCard, useToast, Progress } from '../components/ui';
import { EvidenceChain, AiTraceCard, SuggestedActions } from '../components/Ai';
import { Icon } from '../components/Icon';
import {  fmtTime } from '../lib/format';
import type { ActionRecord, AiTrace } from '../types/domain';

/* ---------- local async pattern (per APP-SPEC) ---------- */
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

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'ai' | 'accent' | 'outline';
const PRIORITY_ORDER: Record<string, number> = { critical: 0, urgent: 0, high: 1, normal: 2, low: 3 };
const TAB_KINDS: Record<string, ActionRecord['kind'][]> = {
  approvals: ['approval'],
  recommendations: ['recommendation'],
  incidents: ['incident'],
  cases: ['case'],
  exceptions: ['exception'],
};

function countdown(d?: Date): { label: string; tone: BadgeTone } | undefined {
  if (!d) return undefined;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return { label: 'Overdue', tone: 'danger' };
  const h = ms / 3600000;
  if (h < 1) return { label: `${Math.max(1, Math.round(ms / 60000))}m left`, tone: 'danger' };
  if (h < 24) return { label: `${Math.round(h)}h left`, tone: h <= 6 ? 'danger' : 'warning' };
  return { label: `${Math.round(h / 24)}d left`, tone: 'outline' };
}

function mkTrace(a: ActionRecord): AiTrace {
  return {
    trigger: `${a.aiInvolved ? 'AI monitoring rule fired' : 'Rule-based monitor fired'} — ${a.on.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${fmtTime(a.on)}`,
    policy: a.policyRef ?? 'Constitution v2026.1 — posture applied to every suggested action',
    dataUsed: a.evidence.map(e => e.label),
    reasoningRole: a.aiInvolved ? 'Investigator → Proposer (drafts only)' : 'Deterministic rule (no model)',
    action: a.actions[0]?.label ?? 'Investigate and report back',
    approvalStatus: 'Awaiting your decision',
    verification: 'Evidence figures recomputed from source records before ranking',
    model: a.aiInvolved ? 'Frontier (reasoning) · ap-south-1' : '— (rule-based, no model)',
    latencyMs: a.aiInvolved ? 780 : 12,
    tokens: a.aiInvolved ? 1020 : 0,
    cost: a.aiInvolved ? '₹0.09' : '₹0.00',
  };
}

/* ---------- item card ---------- */
function ActionCard({ a, onOpen, onApprove, onDismiss }: {
  a: ActionRecord;
  onOpen: () => void;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const due = countdown(a.deadline);
  const prioTone: BadgeTone = a.priority === 'critical' ? 'danger' : a.priority === 'high' ? 'warning' : 'neutral';
  const kindLabel: Record<ActionRecord['kind'], string> = { approval: 'Approval', incident: 'Incident', case: 'Case', recommendation: 'Recommendation', exception: 'Exception' };
  return (
    <Card pad className="card-click" onClick={onOpen}>
      <div className="u-col" style={{ gap: 8 }}>
        <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge tone={prioTone} dot>{a.priority === 'critical' ? 'Critical' : a.priority === 'high' ? 'High' : a.priority === 'normal' ? 'Normal' : 'Low'}</Badge>
          <Badge tone="outline">{kindLabel[a.kind]}</Badge>
          {a.aiInvolved && <Badge tone="ai">AI-surfaced</Badge>}
          {due && <span className="u-xs u-flex" style={{ gap: 4, color: due.tone === 'danger' ? 'var(--danger)' : due.tone === 'warning' ? 'var(--warning)' : 'var(--text-3)' }}><Icon.Clock size={12} /> {due.label}</span>}
          <span className="u-xs u-faint" style={{ marginLeft: 'auto' }}>Owner: {a.owner} · raised {fmtTime(a.on)}</span>
        </div>
        <div style={{ fontWeight: 620, fontSize: 'var(--text-lg)', lineHeight: 1.35 }}>{a.title}</div>
        <div className="u-small u-muted" style={{ lineHeight: 1.6 }}>{a.detail}</div>
        <div className="u-small" style={{ color: 'var(--text-2)', lineHeight: 1.55 }}>
          <span style={{ fontWeight: 600, color: 'var(--text-3)', letterSpacing: '.04em', fontSize: 'var(--text-xs)', textTransform: 'uppercase', marginRight: 6 }}>Why it matters</span>
          {a.why}
        </div>
        <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
          {a.evidence.map((e, i) => (
            <button
              key={i}
              className="u-xs"
              style={{ padding: '3px 10px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={() => onOpen()}
              aria-label={`Evidence: ${e.label}`}
            >
              <Icon.Eye size={11} /> {e.label}
            </button>
          ))}
        </div>
        <div className="u-col" style={{ gap: 6, marginTop: 2 }} onClick={e => e.stopPropagation()}>
          <div className="u-xs" style={{ fontWeight: 640, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Suggested actions</div>
          {a.actions.slice(0, 2).map((s, i) => (
            <div key={i} className="u-between" style={{ gap: 10, padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface)' }}>
              <div style={{ minWidth: 0 }}>
                <div className="u-flex" style={{ gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 570, fontSize: 'var(--text-md)' }}>{s.label}</span>
                  {s.posture && <Badge tone={s.posture === 'APPROVAL' ? 'warning' : s.posture === 'HUMAN-ONLY' ? 'danger' : 'success'}>{s.posture === 'APPROVAL' ? 'APPROVAL REQUIRED' : s.posture}</Badge>}
                </div>
                {s.detail && <div className="u-small u-muted" style={{ marginTop: 1 }}>{s.detail}</div>}
              </div>
              <Button size="sm" variant={s.posture === 'APPROVAL' ? 'ai' : 'secondary'} icon={<Icon.ArrowRight size={13} />} onClick={() => onApprove()}>
                {s.posture === 'APPROVAL' ? 'Approve' : 'Run'}
              </Button>
            </div>
          ))}
        </div>
        <div className="u-flex" style={{ gap: 8, marginTop: 4 }} onClick={e => e.stopPropagation()}>
          <Button size="sm" variant="primary" icon={<Icon.Check size={13} />} onClick={onApprove}>Approve</Button>
          <Button size="sm" variant="ghost" icon={<Icon.X size={13} />} onClick={onDismiss}>Dismiss</Button>
          {a.aiInvolved && (
            <span className="u-xs u-faint u-flex" style={{ gap: 5, alignSelf: 'center' }}>
              <Icon.Info size={12} /> “Why did SchoolOS suggest this?” opens with the item
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ---------- evidence drawer ---------- */
function EvidenceDrawer({ a, onClose, onApprove, onDismiss }: {
  a: ActionRecord | null;
  onClose: () => void;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  if (!a) return null;
  const due = countdown(a.deadline);
  return (
    <Drawer
      open={!!a}
      onClose={onClose}
      title={a.title}
      sub={`${a.kind} · priority ${a.priority}${due ? ` · ${due.label}` : ''} · owner ${a.owner}`}
      footer={
        <div className="u-flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" icon={<Icon.X size={13} />} onClick={onDismiss}>Dismiss</Button>
          <Button variant="primary" icon={<Icon.Check size={13} />} onClick={onApprove}>Approve &amp; execute</Button>
        </div>
      }
    >
      <div className="u-col" style={{ gap: 14 }}>
        <p className="u-small" style={{ margin: 0, lineHeight: 1.65 }}>{a.detail}</p>
        <div className="u-small" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>
          <span style={{ fontWeight: 600, color: 'var(--text-3)', letterSpacing: '.04em', fontSize: 'var(--text-xs)', textTransform: 'uppercase', marginRight: 6 }}>Why it matters</span>
          {a.why}
        </div>
        <EvidenceChain
          title="Evidence chain"
          steps={a.evidence.map(e => ({
            label: e.label,
            detail: e.detail ?? 'Linked record',
            source: e.ref ? `Record · ${e.ref}` : 'SchoolOS records · recomputed',
            refType: e.ref ? 'record' : undefined,
          }))}
        />
        <SuggestedActions actions={a.actions.map((s, i) => ({ id: `${a.id}_${i}`, label: s.label, type: s.type, detail: s.detail, posture: s.posture }))} onApprove={() => onApprove()} />
        <div className="u-xs u-faint" style={{ lineHeight: 1.6 }}>
          Policy — {a.policyRef ?? 'Constitution v2026.1'}. Approval executes the selected action and records an immutable audit entry (actor, role, reason, posture).
        </div>
        {a.aiInvolved && <AiTraceCard trace={mkTrace(a)} defaultOpen />}
      </div>
    </Drawer>
  );
}

/* ---------- main ---------- */
export default function ActionCenter() {
  const { session, domain, dispatch, actorName } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('approvals');
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDismiss, setConfirmDismiss] = useState<ActionRecord | null>(null);

  const { loading, error, retry } = useAsync(async () => {
    await new Promise(r => setTimeout(r, 400)); // simulated fetch of the unified queue
    return new Date();
  }, []);

  const open = useMemo(
    () => domain.actions
      .filter(a => a.status === 'open')
      .sort((x, y) => (PRIORITY_ORDER[x.priority] ?? 9) - (PRIORITY_ORDER[y.priority] ?? 9) || (x.deadline?.getTime() ?? Infinity) - (y.deadline?.getTime() ?? Infinity)),
    [domain.actions],
  );

  const decided = useMemo(() => domain.actions.filter(a => a.status !== 'open'), [domain.actions]);
  const total = domain.actions.length;
  const resolvedPct = total ? Math.round(((decided.length) / total) * 100) : 0;

  const tabList = [
    { id: 'approvals', label: 'Needs approval', count: open.filter(a => a.kind === 'approval').length },
    { id: 'recommendations', label: 'Recommendations', count: open.filter(a => a.kind === 'recommendation').length },
    { id: 'incidents', label: 'Incidents', count: open.filter(a => a.kind === 'incident').length },
    { id: 'cases', label: 'Cases', count: open.filter(a => a.kind === 'case').length },
    { id: 'exceptions', label: 'Exceptions', count: open.filter(a => a.kind === 'exception').length },
    { id: 'all', label: 'All open', count: open.length },
  ];

  const visible = tab === 'all' ? open : open.filter(a => TAB_KINDS[tab]?.includes(a.kind));
  const openSig = open.find(a => a.id === openId) ?? null;

  const approve = (a: ActionRecord) => {
    dispatch({ type: 'action/decide', id: a.id, decision: 'approved', actor: actorName, role: session.roleId });
    setOpenId(null);
    toast({ title: 'Approved — executing.', sub: 'Audit entry recorded.', tone: 'success' });
  };

  const doDismiss = (a: ActionRecord) => {
    dispatch({ type: 'action/decide', id: a.id, decision: 'dismissed', actor: actorName, role: session.roleId, note: 'Dismissed with confirmation from Action Center' });
    setConfirmDismiss(null);
    setOpenId(null);
    toast({ title: 'Dismissed.', sub: 'Removed from the queue; audit entry recorded.', tone: 'info' });
  };

  return (
    <>
      <PageHead
        title="Action Center"
        sub={`Everything awaiting a decision — approvals, recommendations, incidents, cases and exceptions in one queue. Owner view for ${actorName}.`}
        actions={<Button variant="secondary" size="sm" icon={<Icon.Refresh size={13} />} onClick={retry}>Refresh queue</Button>}
      />

      {/* resolution progress */}
      <div className="card card-pad u-col" style={{ gap: 8, marginBottom: 16 }}>
        <div className="u-between u-small">
          <span style={{ fontWeight: 600 }}>Resolution progress</span>
          <span className="u-muted tnum">{decided.length} of {total} items decided · {resolvedPct}%</span>
        </div>
        <Progress value={resolvedPct} tone={resolvedPct >= 60 ? undefined : 'warn'} />
        <div className="u-xs u-faint">
          {domain.actions.filter(a => a.status === 'approved').length} approved · {domain.actions.filter(a => a.status === 'dismissed').length} dismissed · every decision writes an immutable audit entry
        </div>
      </div>

      {error ? (
        <Card pad><Empty icon={<Icon.Alert size={22} />} title="Queue could not load" sub="The decision service did not respond." action={<Button variant="secondary" onClick={retry}>Try again</Button>} /></Card>
      ) : (
        <>
          <Tabs tabs={tabList} active={tab} onChange={setTab} />

          <div style={{ height: 14 }} />

          {loading ? (
            <div className="u-col" style={{ gap: 10 }}>
              <Skeleton w={240} h={12} />
              <SkeletonCard lines={4} />
              <SkeletonCard lines={4} />
            </div>
          ) : visible.length === 0 ? (
            <Card pad>
              <Empty
                icon={<Icon.Check size={22} />}
                title={tab === 'all' ? 'Queue is clear' : `No open ${tabList.find(t => t.id === tab)?.label.toLowerCase()}`}
                sub={tab === 'all'
                  ? 'Every item has been approved or dismissed. New items land here the moment a rule or model raises them.'
                  : 'Nothing open in this category right now. Switch to “All open” to see the rest of the queue.'}
                action={tab !== 'all' && open.length > 0 ? <Button variant="secondary" size="sm" onClick={() => setTab('all')}>Show all open ({open.length})</Button> : undefined}
              />
            </Card>
          ) : (
            <div className="u-col" style={{ gap: 12 }}>
              {(() => {
                const isHigh = (x: ActionRecord) => x.priority === 'critical' || x.priority === 'high' || x.priority === 'urgent';
                const isToday = (x: ActionRecord) => !!x.deadline && x.deadline.toDateString() === new Date().toDateString();
                const taken = new Set<ActionRecord>();
                const bands: { label: string; items: ActionRecord[] }[] = [];
                const push = (label: string, test: (x: ActionRecord) => boolean) => {
                  const items = visible.filter(x => !taken.has(x) && test(x));
                  items.forEach(x => taken.add(x));
                  if (items.length) bands.push({ label, items });
                };
                push('Waiting for approval', x => x.kind === 'approval');
                push('High priority', isHigh);
                push('Due today', isToday);
                push('Everything else', () => true);
                return bands.map(band => (
                  <div key={band.label} className="u-col" style={{ gap: 8 }}>
                    <div className="u-inline" style={{ gap: 8, alignItems: 'center' }}>
                      <span className="u-upper u-xs" style={{ fontWeight: 660, color: 'var(--text-3)', letterSpacing: '0.06em' }}>{band.label}</span>
                      <span className="u-xs u-faint">{band.items.length}</span>
                      <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
                    </div>
                    {band.items.map(a => (
                      <ActionCard key={a.id} a={a} onOpen={() => setOpenId(a.id)} onApprove={() => approve(a)} onDismiss={() => setConfirmDismiss(a)} />
                    ))}
                  </div>
                ));
              })()}
            </div>
          )}

          {/* recently decided, audit-facing */}
          {decided.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-head"><h3 className="u-flex" style={{ gap: 7 }}><Icon.Clipboard size={14} /> Recently decided</h3></div>
              <div className="card-body u-col" style={{ gap: 8 }}>
                {decided.slice(0, 4).map(a => (
                  <div key={a.id} className="u-between u-small" style={{ gap: 10 }}>
                    <span className="u-truncate">{a.title}</span>
                    <span className="u-flex" style={{ gap: 6, flexShrink: 0 }}>
                      <Badge tone={a.status === 'approved' ? 'success' : 'neutral'}>{a.status}</Badge>
                      <button className="u-xs u-faint" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => navigate('/audit')}>audit <Icon.ArrowRight size={10} /></button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <EvidenceDrawer a={openSig} onClose={() => setOpenId(null)} onApprove={() => openSig && approve(openSig)} onDismiss={() => openSig && setConfirmDismiss(openSig)} />

      {/* dismiss confirmation */}
      <Drawer
        open={!!confirmDismiss}
        onClose={() => setConfirmDismiss(null)}
        title="Dismiss this item?"
        sub={confirmDismiss?.title}
        footer={
          <div className="u-flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setConfirmDismiss(null)}>Keep it</Button>
            <Button variant="danger" icon={<Icon.X size={13} />} onClick={() => confirmDismiss && doDismiss(confirmDismiss)}>Dismiss permanently</Button>
          </div>
        }
      >
        <p className="u-small u-muted" style={{ marginTop: 0, lineHeight: 1.65 }}>
          Dismissing removes “{confirmDismiss?.title}” from every queue for your role. The reason is written to the audit ledger with your name —
          the item can be re-raised later if the underlying pattern reappears.
        </p>
        <EvidenceChain
          title="What you are closing"
          steps={[
            { label: 'Item leaves the open queue', detail: 'Status changes to dismissed for this actor and role', source: 'Action Center state' },
            { label: 'Audit entry recorded', detail: `Actor ${actorName} · role ${session.roleId} · outcome “Closed without action”`, source: 'Audit ledger · immutable' },
            { label: 'Underlying records untouched', detail: 'Attendance, fee and transport records are never modified by a dismissal', source: 'Constitution v2026.1' },
          ]}
        />
        {confirmDismiss && seed.cases.some(c => /bus 14/i.test(c.title)) && /bus 14/i.test(confirmDismiss.title) && (
          <div className="u-xs u-faint" style={{ marginTop: 10, lineHeight: 1.6 }}>
            Note: this item links to a live parent case with a 24h SLA. Dismissal does not close the case.
          </div>
        )}
      </Drawer>
    </>
  );
}
