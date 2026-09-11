/* ============================================================
   Action Center — the unified inbox of everything awaiting a
   decision. T403: the queue is loaded from GET /actions and every
   approve/dismiss goes through POST /actions/:id/decide — the
   decide-into-reducer path is gone. Optimistic UI reconciles on
   the server response; a 403 (not the owning authority) or any
   other failure surfaces a friendly error and the item stays open.
   Success toasts only claim what the server's response says.
   The demo build keeps the session-queue behaviour, labelled.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { apiActions, apiDecideAction } from '../services/liveApi';
import { DEMO_MODE } from '../lib/demoMode';
import { friendly } from '../lib/friendlyErrors';
import { PageHead, Card, Badge, Button, Empty, Tabs, Drawer, Skeleton, SkeletonCard, useToast, Progress, KeyValue, ClickThrough } from '../components/ui';
import { EvidenceChain } from '../components/Ai';
import { Icon } from '../components/Icon';
import { fmtTime } from '../lib/format';

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
const TAB_KINDS: Record<string, QueueItem['kind'][]> = {
  approvals: ['approval'],
  recommendations: ['recommendation', 'reminder'],
  incidents: ['incident'],
  cases: ['case'],
  exceptions: ['exception'],
};

/* Server row (app.actions) → queue item. The server enum also carries
   'reminder'; it rides with recommendations so the tabs stay honest. */
interface QueueItem {
  id: string;
  code: string;
  kind: 'approval' | 'recommendation' | 'incident' | 'case' | 'exception' | 'reminder';
  priority: 'critical' | 'high' | 'normal' | 'low';
  title: string;
  detail: string;
  why: string;
  owner: string;
  ownerRole: string;
  status: 'open' | 'approved' | 'dismissed' | 'resolved' | 'completed' | 'expired';
  on: Date;
  deadline: Date | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  policyRef: string | null;
  aiInvolved: boolean;
  payload: Record<string, unknown>;
}

const mapServerAction = (r: Record<string, unknown>): QueueItem => ({
  id: String(r.id),
  code: String(r.code ?? ''),
  kind: (r.kind ?? 'approval') as QueueItem['kind'],
  priority: (r.priority ?? 'normal') as QueueItem['priority'],
  title: String(r.title ?? 'Untitled item'),
  detail: String(r.detail ?? ''),
  why: String(r.why ?? ''),
  owner: String(r.owner ?? r.owner_role ?? 'Staff'),
  ownerRole: String(r.owner_role ?? ''),
  status: (r.status ?? 'open') as QueueItem['status'],
  on: new Date(String(r.created_at ?? Date.now())),
  deadline: r.deadline ? new Date(String(r.deadline)) : null,
  decidedAt: r.decided_at ? new Date(String(r.decided_at)) : null,
  decisionNote: (r.decision_note as string) ?? null,
  policyRef: (r.policy_ref as string) ?? null,
  aiInvolved: Boolean(r.ai_involved),
  payload: (r.payload && typeof r.payload === 'object' ? r.payload : {}) as Record<string, unknown>,
});

function countdown(d?: Date | null): { label: string; tone: BadgeTone } | undefined {
  if (!d) return undefined;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return { label: 'Overdue', tone: 'danger' };
  const h = ms / 3600000;
  if (h < 1) return { label: `${Math.max(1, Math.round(ms / 60000))}m left`, tone: 'danger' };
  if (h < 24) return { label: `${Math.round(h)}h left`, tone: h <= 6 ? 'danger' : 'warning' };
  return { label: `${Math.round(h / 24)}d left`, tone: 'outline' };
}

/* ---------- item card ---------- */
function ActionCard({ a, busy, onOpen, onApprove, onDismiss }: {
  a: QueueItem;
  busy: boolean;
  onOpen: () => void;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const due = countdown(a.deadline);
  const prioTone: BadgeTone = a.priority === 'critical' ? 'danger' : a.priority === 'high' ? 'warning' : 'neutral';
  const kindLabel: Record<QueueItem['kind'], string> = { approval: 'Approval', incident: 'Incident', case: 'Case', recommendation: 'Recommendation', exception: 'Exception', reminder: 'Reminder' };
  return (
    <Card pad className="card-click" onClick={onOpen}>
      <div className="u-col" style={{ gap: 8 }}>
        <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge tone={prioTone} dot>{a.priority === 'critical' ? 'Critical' : a.priority === 'high' ? 'High' : a.priority === 'normal' ? 'Normal' : 'Low'}</Badge>
          <Badge tone="outline">{kindLabel[a.kind]}</Badge>
          {a.aiInvolved && <Badge tone="ai">Rule-surfaced</Badge>}
          {!a.payload?.proposed_by && (
            <Badge tone="warning" dot>Owner must approve</Badge>
          )}
          {due && <span className="u-xs u-flex" style={{ gap: 4, color: due.tone === 'danger' ? 'var(--danger)' : due.tone === 'warning' ? 'var(--warning)' : 'var(--text-3)' }}><Icon.Clock size={12} /> {due.label}</span>}
          <span className="u-xs u-faint" style={{ marginLeft: 'auto' }}>Owner: {a.owner}{a.ownerRole ? ` (${a.ownerRole})` : ''} · raised {fmtTime(a.on)}</span>
        </div>
        <div style={{ fontWeight: 620, fontSize: 'var(--text-lg)', lineHeight: 1.35 }}>{a.title}</div>
        {a.detail && <div className="u-small u-muted" style={{ lineHeight: 1.6 }}>{a.detail}</div>}
        {a.why && (
          <div className="u-small" style={{ color: 'var(--text-2)', lineHeight: 1.55 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-3)', letterSpacing: '.04em', fontSize: 'var(--text-xs)', textTransform: 'uppercase', marginRight: 6 }}>Why it matters</span>
            {a.why}
          </div>
        )}
        <ClickThrough className="u-flex" style={{ gap: 8, marginTop: 4 }}>
          <Button size="sm" variant="primary" icon={<Icon.Check size={13} />} loading={busy} onClick={onApprove}>Approve</Button>
          <Button size="sm" variant="ghost" icon={<Icon.X size={13} />} disabled={busy} onClick={onDismiss}>Dismiss</Button>
          <span className="u-xs u-faint" style={{ alignSelf: 'center' }}>Deciding writes to the school's audit trail</span>
        </ClickThrough>
      </div>
    </Card>
  );
}

/* ---------- evidence drawer ---------- */
function EvidenceDrawer({ a, busy, onClose, onApprove, onDismiss }: {
  a: QueueItem | null;
  busy: boolean;
  onClose: () => void;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  if (!a) return null;
  const due = countdown(a.deadline);
  const payloadEntries = Object.entries(a.payload ?? {}).filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object');
  const needsOwner = !a.payload?.proposed_by;
  return (
    <Drawer
      open={!!a}
      onClose={onClose}
      title={a.title}
      sub={`${a.kind} · priority ${a.priority}${due ? ` · ${due.label}` : ''} · owner ${a.owner}${a.ownerRole ? ` (${a.ownerRole})` : ''}`}
      footer={
        <div className="u-flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" icon={<Icon.X size={13} />} disabled={busy} onClick={onDismiss}>Dismiss</Button>
          <Button variant="primary" icon={<Icon.Check size={13} />} loading={busy} onClick={onApprove}>Approve</Button>
        </div>
      }
    >
      <div className="u-col" style={{ gap: 14 }}>
        {a.detail && <p className="u-small" style={{ margin: 0, lineHeight: 1.65 }}>{a.detail}</p>}
        {a.why && (
          <div className="u-small" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-3)', letterSpacing: '.04em', fontSize: 'var(--text-xs)', textTransform: 'uppercase', marginRight: 6 }}>Why it matters</span>
            {a.why}
          </div>
        )}
        {needsOwner && (
          <div className="u-small" style={{ color: 'var(--warning-text, var(--text-2))', lineHeight: 1.6, border: '1px solid var(--warning)', borderRadius: 'var(--r-sm)', padding: '8px 10px', background: 'var(--warning-weak, transparent)' }}>
            <b>Owner must approve.</b> This item was raised without a named proposer (segregation-of-duties default), so the owning desk's approval is refused by the server — the school owner's approval still works.
          </div>
        )}
        {payloadEntries.length > 0 && (
          <div>
            <div className="u-upper" style={{ marginBottom: 8 }}>Details from the record</div>
            <KeyValue items={payloadEntries.map(([k, v]) => ({ k, v: String(v) }))} />
          </div>
        )}
        <EvidenceChain
          title="What happens when you decide"
          steps={[
            { label: 'Your decision is recorded', detail: `Status → ${'approved' === a.status ? 'approved' : 'approved/dismissed'} with your name, role and note`, source: 'School records', refType: 'record' },
            { label: 'Audit entry written', detail: a.policyRef ? `Policy reference ${a.policyRef}` : 'Actor, role, decision and outcome are written to the audit trail', source: 'Audit trail · append-only' },
            { label: 'Linked execution runs where defined', detail: 'Message and task items execute on approval; other items record the decision for the owning desk to act on', source: 'Action spine' },
          ]}
        />
        <div className="u-xs u-faint" style={{ lineHeight: 1.6 }}>
          {a.aiInvolved
            ? 'This item was raised by a deterministic rule monitor (no language model involved).'
            : 'Policy'}{a.policyRef ? ` — ${a.policyRef}` : ''}. Only the owning authority can decide an item; if that's another desk, the server will say so.
        </div>
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
  const [confirmDismiss, setConfirmDismiss] = useState<QueueItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [override, setOverride] = useState<QueueItem[] | null>(null); /* optimistic reconcile layer */

  /* server queue (live build) */
  const queue = useAsync<QueueItem[]>(async () => {
    if (DEMO_MODE) return []; /* demo build uses the session store below */
    const res = await apiActions();
    return (res.actions ?? []).map(mapServerAction);
  }, []);

  /* demo build: session queue from the store (S3 re-syncs it after hydration) */
  const demoItems: QueueItem[] = useMemo(() => (DEMO_MODE ? domain.actions.map(a => ({
    id: a.id, code: a.id, kind: a.kind, priority: a.priority as QueueItem['priority'], title: a.title,
    detail: a.detail, why: a.why ?? '', owner: a.owner, ownerRole: '', status: a.status as QueueItem['status'],
    on: a.on, deadline: a.deadline ?? null, decidedAt: null, decisionNote: null,
    policyRef: a.policyRef ?? null, aiInvolved: a.aiInvolved, payload: {},
  })) : []), [domain.actions]);

  const items: QueueItem[] = override ?? (DEMO_MODE ? demoItems : queue.data ?? []);

  const { loading, error, retry } = DEMO_MODE
    ? { loading: false, error: null as string | null, retry: () => {} }
    : queue;

  const refresh = () => { setOverride(null); retry(); };

  const open = useMemo(
    () => items
      .filter(a => a.status === 'open')
      .sort((x, y) => (PRIORITY_ORDER[x.priority] ?? 9) - (PRIORITY_ORDER[y.priority] ?? 9) || (x.deadline?.getTime() ?? Infinity) - (y.deadline?.getTime() ?? Infinity)),
    [items],
  );

  const decided = useMemo(() => items.filter(a => a.status !== 'open'), [items]);
  const total = items.length;
  const resolvedPct = total ? Math.round(((decided.length) / total) * 100) : 0;

  const tabList = [
    { id: 'approvals', label: 'Needs approval', count: open.filter(a => TAB_KINDS.approvals.includes(a.kind)).length },
    { id: 'recommendations', label: 'Recommendations', count: open.filter(a => TAB_KINDS.recommendations.includes(a.kind)).length },
    { id: 'incidents', label: 'Incidents', count: open.filter(a => TAB_KINDS.incidents.includes(a.kind)).length },
    { id: 'cases', label: 'Cases', count: open.filter(a => TAB_KINDS.cases.includes(a.kind)).length },
    { id: 'exceptions', label: 'Exceptions', count: open.filter(a => TAB_KINDS.exceptions.includes(a.kind)).length },
    { id: 'all', label: 'All open', count: open.length },
  ];

  const visible = tab === 'all' ? open : open.filter(a => TAB_KINDS[tab]?.includes(a.kind));
  const openSig = open.find(a => a.id === openId) ?? open.find(a => a.id === confirmDismiss?.id) ?? confirmDismiss;

  /* decide: real door first; the local copy updates only to mirror the
     server's answer (optimistic flip reconciled by the response). */
  const decide = async (a: QueueItem, decision: 'approved' | 'dismissed', note?: string) => {
    setBusyId(a.id);
    if (DEMO_MODE) {
      /* demo session queue — copy says exactly what happened */
      dispatch({ type: 'action/decide', id: a.id, decision, actor: actorName, role: session.roleId, note });
      setConfirmDismiss(null);
      setOpenId(null);
      setBusyId(null);
      toast({
        title: decision === 'approved' ? 'Approved (demo)' : 'Dismissed (demo)',
        sub: 'Demo world — this decision is kept for this session and is not connected to school records.',
        tone: 'info',
      });
      return;
    }
    try {
      const res = await apiDecideAction(a.id, decision, note);
      /* reconcile with the server's truth */
      setOverride(prev => (prev ?? items).map(x => x.id === a.id ? { ...x, status: decision, decidedAt: new Date() } : x));
      setConfirmDismiss(null);
      setOpenId(null);
      const exec = res.execution as { type?: string } | null | undefined;
      toast({
        title: decision === 'approved' ? 'Approved' : 'Dismissed',
        sub: exec?.type === 'communication'
          ? 'Recorded, and the linked message was queued by the server.'
          : exec?.type === 'notification'
            ? 'Recorded, and the linked task was broadcast to staff.'
            : 'Recorded in the school\'s decision log. The owning desk acts on it from here.',
        tone: 'success',
      });
      refresh();
    } catch (e) {
      toast({ title: decision === 'approved' ? 'Could not approve' : 'Could not dismiss', sub: friendly(e), tone: 'error' });
      setOverride(null); /* snap back to server truth */
    } finally {
      setBusyId(null);
    }
  };

  const approve = (a: QueueItem) => decide(a, 'approved');
  const doDismiss = (a: QueueItem) => decide(a, 'dismissed', 'Dismissed with confirmation from Action Center');

  return (
    <>
      <PageHead
        title="Action Center"
        sub={`Everything awaiting a decision — approvals, recommendations, incidents, cases and exceptions in one queue. Signed in as ${actorName}.`}
        actions={
          <>
            {DEMO_MODE && <Badge tone="outline">Demo data</Badge>}
            <Button variant="secondary" size="sm" icon={<Icon.Refresh size={13} />} onClick={refresh}>Refresh queue</Button>
          </>
        }
      />

      {/* resolution progress */}
      <div className="card card-pad u-col" style={{ gap: 8, marginBottom: 16 }}>
        <div className="u-between u-small">
          <span style={{ fontWeight: 600 }}>Resolution progress</span>
          <span className="u-muted tnum">{decided.length} of {total} items decided · {resolvedPct}%</span>
        </div>
        <Progress value={resolvedPct} tone={resolvedPct >= 60 ? undefined : 'warn'} />
        <div className="u-xs u-faint">
          {items.filter(a => a.status === 'approved').length} approved · {items.filter(a => a.status === 'dismissed').length} dismissed · every decision is written to the school's audit trail
        </div>
      </div>

      {error ? (
        <Card pad><Empty icon={<Icon.Alert size={22} />} title="Queue could not load" sub={friendly(error)} action={<Button variant="secondary" onClick={refresh}>Try again</Button>} /></Card>
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
                  ? 'Every item has been approved or dismissed. New items land here the moment a rule or a desk raises them.'
                  : 'Nothing open in this category right now. Switch to “All open” to see the rest of the queue.'}
                action={tab !== 'all' && open.length > 0 ? <Button variant="secondary" size="sm" onClick={() => setTab('all')}>Show all open ({open.length})</Button> : undefined}
              />
            </Card>
          ) : (
            <div className="u-col" style={{ gap: 12 }}>
              {(() => {
                const isHigh = (x: QueueItem) => x.priority === 'critical' || x.priority === 'high';
                const isToday = (x: QueueItem) => !!x.deadline && x.deadline.toDateString() === new Date().toDateString();
                const taken = new Set<QueueItem>();
                const bands: { label: string; items: QueueItem[] }[] = [];
                const push = (label: string, test: (x: QueueItem) => boolean) => {
                  const its = visible.filter(x => !taken.has(x) && test(x));
                  its.forEach(x => taken.add(x));
                  if (its.length) bands.push({ label, items: its });
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
                      <ActionCard key={a.id} a={a} busy={busyId === a.id} onOpen={() => setOpenId(a.id)} onApprove={() => approve(a)} onDismiss={() => setConfirmDismiss(a)} />
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

      <EvidenceDrawer a={openSig && openSig.status === 'open' ? openSig : null} busy={!!openSig && busyId === openSig.id} onClose={() => { setOpenId(null); }} onApprove={() => openSig && approve(openSig)} onDismiss={() => openSig && setConfirmDismiss(openSig)} />

      {/* dismiss confirmation */}
      <Drawer
        open={!!confirmDismiss}
        onClose={() => setConfirmDismiss(null)}
        title="Dismiss this item?"
        sub={confirmDismiss?.title}
        footer={
          <div className="u-flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setConfirmDismiss(null)}>Keep it</Button>
            <Button variant="danger" icon={<Icon.X size={13} />} loading={!!confirmDismiss && busyId === confirmDismiss.id} onClick={() => confirmDismiss && doDismiss(confirmDismiss)}>Dismiss permanently</Button>
          </div>
        }
      >
        <p className="u-small u-muted" style={{ marginTop: 0, lineHeight: 1.65 }}>
          Dismissing closes “{confirmDismiss?.title}” with your name on the school's audit trail.
          The owning desk can re-raise it if the underlying pattern reappears.
        </p>
        <EvidenceChain
          title="What you are closing"
          steps={[
            { label: 'Item leaves the open queue', detail: 'Status changes to dismissed, recorded on the server', source: 'School records' },
            { label: 'Audit entry recorded', detail: `Actor ${actorName} · role ${session.roleId} · outcome “closed without action”`, source: 'Audit trail · cannot be edited' },
            { label: 'Underlying records untouched', detail: 'Attendance, fee and transport records are never modified by a dismissal', source: 'Constitution v2026.1' },
          ]}
        />
      </Drawer>
    </>
  );
}
