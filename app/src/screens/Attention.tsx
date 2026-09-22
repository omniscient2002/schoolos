/* ============================================================
   Attention — the ranked attention feed.
   Merges open Action Center items ("recommended") with derived
   signals computed live from seed records (unmarked registers,
   delayed routes, failed fees, expiring documents). Every card
   carries why-it-matters, evidence, and a decision path.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import * as seed from '../data/dataset';
import { apiActions, apiDecideAction } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import {PageHead, Card, Badge, Button, Empty, Tabs, Drawer, Skeleton, SkeletonCard, useToast, ClickThrough, SampleNote} from '../components/ui';
import { EvidenceChain, SuggestedActions } from '../components/Ai';
import { Slot } from '../plugins/Slot';
import type { WorkOrderRecord } from '../types/domain';
import { assets as seedAssetsMaint } from '../data/dataset';
import { Icon } from '../components/Icon';
import { fmtTime, fmtDateShort } from '../lib/format';

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

/* ---------- helpers ---------- */
type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'ai' | 'accent' | 'outline';
const PRIORITY_ORDER: Record<string, number> = { critical: 0, urgent: 0, high: 1, normal: 2, low: 3 };

interface Signal {
  id: string;
  kind: 'approval' | 'incident' | 'case' | 'recommendation' | 'exception';
  title: string;
  detail: string;
  why: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  chips: string[];
  evidence: { label: string; detail?: string }[];
  suggested: { id: string; label: string; type: string; detail?: string; posture?: 'AUTO' | 'APPROVAL' | 'HUMAN-ONLY' }[];
  policyRef: string;
  to: string;
  due?: string;
  aiInvolved: boolean;
  derived: boolean;
}


function deriveSignals(workOrders: WorkOrderRecord[] = []): Signal[] {
  const out: Signal[] = [];

  /* attendance: sections with unconfirmed absences / anomaly registers today */
    const flaggedSections = seed.sections
    .map(s => ({ s, a: seed.sectionAttendanceToday(s.id) }))
    .filter(x => x.a.total > 0 && (x.a.pct < 85 || x.a.absent >= 3))
    .sort((x, y) => x.a.pct - y.a.pct);
  if (flaggedSections.length) {
    out.push({
      id: 'sig-att',
      kind: 'exception',
      title: flaggedSections.length === 1
        ? `Attendance register — ${flaggedSections[0].s.grade}-${flaggedSections[0].s.name} at ${flaggedSections[0].a.pct}%`
        : `${flaggedSections.length} registers below 85% presence today`,
      detail: flaggedSections
        .slice(0, 3)
        .map(x => `${x.s.grade}-${x.s.name}: ${x.a.absent} absent of ${x.a.total}${x.a.unmarked ? ` · ${x.a.unmarked} unconfirmed` : ''}`)
        .join(' · '),
      why: 'Sudden same-day clusters usually track transport or an event, not illness. Registers left unconfirmed distort today\'s absence notifications.',
      priority: 'critical',
      chips: ['Attendance register · 08:40 · high', 'Route roster overlap · medium'],
      evidence: [
        { label: 'Presence by section (today)', detail: flaggedSections.map(x => `${x.s.grade}-${x.s.name} ${x.a.pct}%`).join(' · ') },
      ],
      suggested: [
        { id: 's1', label: 'Open attendance follow-up', type: 'investigate', detail: 'Call list with reasons and guardian status', posture: 'APPROVAL' },
        { id: 's2', label: 'Assign to class teachers', type: 'task', detail: 'Task with student list, due before lunch' },
      ],
      policyRef: 'Attendance §1.1 — guardian notification within 15 minutes',
      to: '/attention',
      due: 'before 12:00',
      aiInvolved: true,
      derived: true,
    });
  }

  /* transport: delayed routes */
  const delayed = seed.busRoutes.filter(r => r.status === 'delayed');
  if (delayed.length) {
    out.push({
      id: 'sig-bus',
      kind: 'incident',
      title: delayed.map(r => `${r.name.split('—')[0].trim()} delayed +${r.delayMins ?? 0} min`).join(' · '),
      detail: `${delayed.reduce((a, r) => a + r.students, 0)} students on affected routes. Guardian delay notifications already sent (Transport §3.1); arrivals logged late under leniency until 09:30.`,
      why: 'Delays cascade into attendance anomalies and complaints within the hour — confirming the cause stops three follow-up threads from opening.',
      priority: 'high',
      chips: ['GPS monitor · 07:42 · high', 'Driver radio · 07:51 · high'],
      evidence: [
        { label: 'Guardian notifications', detail: `${delayed.reduce((a, r) => a + r.students, 0)} queued on delay detection, delivered` },
      ],
      suggested: [
        { id: 'b1', label: 'Confirm repair status with workshop', type: 'task', detail: 'Quote received; repair scheduled Saturday', posture: 'AUTO' },
        { id: 'b2', label: 'Reply to waiting guardians', type: 'message', detail: 'Draft ready — honest status + Monday plan', posture: 'APPROVAL' },
      ],
      policyRef: 'Transport §3.1 — delay notification within 15 minutes',
      to: '/transport',
      due: 'before first route 07:10 tomorrow',
      aiInvolved: true,
      derived: true,
    });
  }

  /* fees: failed payment cluster */
  const failed = seed.feeObligations.filter(f => f.status === 'failed');
  if (failed.length) {
    /* Empty-world law: narrate the REAL ledger — no demo cluster copy. */
    out.push({
      id: 'sig-fee',
      kind: 'exception',
      title: `${failed.length} failed payment${failed.length === 1 ? '' : 's'} need attention`,
      detail: 'Failed payments await retry or guardian assistance.',
      why: 'A single combined message historically recovers ~60% within 48h — but bulk messaging requires your approval (Communication §2.1).',
      priority: 'high',
      chips: ['Fees records · sample', 'Gateway settlement · sample'],
      evidence: [
        { label: 'Failed ledger rows', detail: `${failed.length} obligation${failed.length === 1 ? '' : 's'} in 'failed' state` },
      ],
      suggested: [
        { id: 'f1', label: 'Approve payment-assistance message (41 guardians)', type: 'message', detail: 'Draft ready · WhatsApp · English + Hindi', posture: 'APPROVAL' },
        { id: 'f2', label: 'Retry failed UPI mandates', type: 'workflow', detail: 'Batch retry via gateway wf_4', posture: 'AUTO' },
      ],
      policyRef: 'Communication §2.1 — bulk parent messaging requires approval',
      to: '/action-center',
      due: 'retry window closes Friday',
      aiInvolved: true,
      derived: true,
    });
  }

  /* documents: expiring / expired */
  const expiring = seed.documents.filter(d => d.status === 'expiring');
  const expired = seed.documents.filter(d => d.status === 'expired');
  if (expiring.length || expired.length) {
    out.push({
      id: 'sig-doc',
      kind: 'exception',
      title: `${expired.length} expired and ${expiring.length} expiring documents on record`,
      detail: `Mostly medical forms past validity; school compliance certificates (fire safety, bus fitness) inside their 30-day window. Renewal tasks are auto-created per wf_5.`,
      why: 'Expired compliance documents are an inspection exposure; student medical forms block excursion and sports eligibility.',
      priority: 'normal',
      chips: ['Document register · 06:30 · high', 'Renewal workflow wf_5 · active'],
      evidence: [
        { label: 'Expired sample', detail: expired.slice(0, 3).map(d => `${d.title} — ${d.ownerName}`).join(' · ') || 'None' },
        { label: 'School certificates', detail: 'Fire Safety · Building OC · Bus Fitness · Lab license — all expiring' },
      ],
      suggested: [
        { id: 'd1', label: 'Send renewal tasks to class teachers', type: 'task', detail: 'Bulk — one task per affected student', posture: 'AUTO' },
        { id: 'd2', label: 'Open compliance checklist', type: 'investigate', detail: 'Vendor quotes and validity table', posture: 'HUMAN-ONLY' },
      ],
      policyRef: 'Documents §2.3 — renewal window opens at 30 days',
      to: '/documents',
      aiInvolved: false,
      derived: true,
    });
  }

  /* maintenance: open work orders — SLA pressure first */
  const openWOs = workOrders.filter(w => !['resolved', 'closed', 'cancelled'].includes(w.status));
  const rank: Record<string, number> = { emergency: 0, critical: 1, high: 2, medium: 3, low: 4 };
  openWOs
    .sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) || a.sla.resolveBy.getTime() - b.sla.resolveBy.getTime())
    .slice(0, 3)
    .forEach(wo => {
      const urgent = wo.priority === 'emergency' || wo.priority === 'critical';
      out.push({
        id: `maint-${wo.id}`,
        kind: 'incident',
        title: wo.title,
        detail: `${wo.building}${wo.room ? ' · ' + wo.room : ''}${wo.assetId ? ' · ' + wo.assetId : ''} · reported by ${wo.reportedBy} · status ${wo.status.replace('-', ' ')}.`,
        why: urgent
          ? 'Safety or core-function impact with a fixed deadline. The facilities desk owns it; leadership is kept informed automatically.'
          : 'Learning or comfort impact inside teaching hours. Ranked against every other open signal on urgency, impact, and deadline.',
        priority: urgent ? 'critical' : wo.priority === 'high' ? 'high' : 'normal',
        chips: [`${wo.id} · SLA ${new Date(wo.sla.resolveBy).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`, wo.assetId ? `Asset ${wo.assetId}` : 'No registered asset', `Category ${wo.category}`],
        evidence: [
          { label: 'Report intake', detail: `${wo.source} · ${wo.reportedBy} · ${new Date(wo.reportedOn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` },
          ...(wo.aiUnderstanding ? [{ label: 'AI understanding', detail: `${wo.aiUnderstanding.category} · ${wo.aiUnderstanding.assetMatch ? 'asset ' + wo.aiUnderstanding.assetMatch.assetId + ' (' + Math.round(wo.aiUnderstanding.assetMatch.confidence * 100) + '%)' : 'no asset match'} · confidence ${Math.round(wo.aiUnderstanding.confidence * 100)}%` }] : []),
          { label: 'Response promise', detail: `reply within ${wo.sla.responseMins}m · fix within ${Math.round(wo.sla.resolveMins / 60)}h (school rule, Facilities §1.2)` },
          ...(wo.assetId ? [{ label: 'Asset history', detail: (() => { const a = seedAssetsMaint.find(x => x.id === wo.assetId); return a ? `${a.failures.length} prior failure${a.failures.length === 1 ? '' : 's'} · ₹${a.repairSpendYTD.toLocaleString('en-IN')} YTD · health ${a.health}` : 'asset record'; })() }] : []),
        ],
        suggested: [
          { id: 'open', label: 'Open work order', type: 'investigate' },
          ...(wo.assignedTo ? [] : [{ id: 'assign', label: 'Assign technician', type: 'workflow' as const, detail: 'Ranked by skill match, availability, first-time fix rate' }]),
        ],
        policyRef: 'Facilities §1.2 (intake + priority) · deadlines are set by the book',
        to: `/maintenance/work-orders/${wo.id}`,
        due: wo.sla.resolveBy.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        aiInvolved: !!wo.aiUnderstanding,
        derived: true,
      });
    });

  return out;
}

/* ---------- card ---------- */
function AttentionCard({ sig, onApprove, onDismiss, onAck: _onAck, onOpen }: {
  sig: Signal;
  onApprove: () => void;
  onDismiss: () => void;
  onAck?: () => void;
  onOpen: () => void;
}) {
  const navigate = useNavigate();
  const kindLabel: Record<Signal['kind'], string> = { approval: 'Approval', incident: 'Incident', case: 'Case', recommendation: 'Recommendation', exception: 'Exception' };
  const prioTone: BadgeTone = sig.priority === 'critical' ? 'danger' : sig.priority === 'high' ? 'warning' : 'neutral';
  return (
    <Card pad className={`card-click sev-card sev-${sig.priority}`} onClick={onOpen}>
      <div className="u-col" style={{ gap: 8 }}>
        <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge tone={prioTone} dot>{sig.priority === 'critical' ? 'Critical' : sig.priority === 'high' ? 'High priority' : sig.priority === 'normal' ? 'Normal' : 'Low'}</Badge>
          <Badge tone="outline">{kindLabel[sig.kind]}</Badge>
          {sig.aiInvolved && <Badge tone="ai">AI-surfaced</Badge>}
          {sig.derived && <Badge tone="info">Derived signal</Badge>}
          {sig.due && <span className="u-xs u-faint u-flex" style={{ gap: 4 }}><Icon.Clock size={12} /> {sig.due}</span>}
          <span className="u-xs u-faint" style={{ marginLeft: 'auto' }}><Icon.ChevronRight size={14} /></span>
        </div>
        <div style={{ fontWeight: 620, fontSize: 'var(--text-lg)', lineHeight: 1.35 }}>{sig.title}</div>
        <div className="u-small u-muted" style={{ lineHeight: 1.6 }}>{sig.detail}</div>
        <div className="u-small" style={{ color: 'var(--text-2)', lineHeight: 1.55 }}>
          <span style={{ fontWeight: 600, color: 'var(--text-3)', letterSpacing: '.04em', fontSize: 'var(--text-xs)', textTransform: 'uppercase', marginRight: 6 }}>Why it matters</span>
          {sig.why}
        </div>
        <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
          {sig.evidence.map((e, i) => (
            <span key={i} className="u-xs" style={{ padding: '3px 9px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)' }}>
              {e.label}
            </span>
          ))}
        </div>
        <ClickThrough className="u-flex" style={{ gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
          <Button size="sm" variant="primary" icon={<Icon.Check size={13} />} onClick={onApprove}>Approve</Button>
          <Button size="sm" variant="ghost" icon={<Icon.X size={13} />} onClick={onDismiss}>Dismiss</Button>
          <Button size="sm" variant="secondary" icon={<Icon.Eye size={13} />} onClick={onOpen}>Evidence &amp; detail</Button>
          {!sig.derived && (
            <Button size="sm" variant="secondary" iconRight={<Icon.ArrowRight size={13} />} onClick={() => navigate(sig.to)}>Open record</Button>
          )}
        </ClickThrough>
      </div>
    </Card>
  );
}

/* ---------- detail drawer ---------- */
function DetailDrawer({ sig, onClose, onApprove, onDismiss }: {
  sig: Signal | null;
  onClose: () => void;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  if (!sig) return null;
  return (
    <Drawer
      open={!!sig}
      onClose={onClose}
      title={sig.title}
      sub={`${sig.derived ? 'Derived signal' : 'Action Center item'} · priority ${sig.priority}${sig.due ? ` · ${sig.due}` : ''}`}
      footer={
        <div className="u-flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" icon={<Icon.X size={13} />} onClick={onDismiss}>Dismiss</Button>
          <Button variant="primary" icon={<Icon.Check size={13} />} onClick={onApprove}>Approve recommendation</Button>
        </div>
      }
    >
      <div className="u-col" style={{ gap: 14 }}>
        <p className="u-small" style={{ lineHeight: 1.65, marginTop: 0 }}>{sig.detail}</p>
        <EvidenceChain
          title="Evidence chain"
          steps={sig.evidence.map((e, i) => ({
            label: e.label,
            detail: e.detail ?? '',
            source: sig.chips[i] ?? 'SchoolOS records · recomputed',
            refType: 'record',
          }))}
        />
        <SuggestedActions
          actions={sig.suggested}
          onApprove={() => onApprove()}
        />
        <div className="u-xs u-faint" style={{ lineHeight: 1.6 }}>
          Policy reference — {sig.policyRef}. Approving records your decision with your name and role; where the item defines a linked message or task, the server executes it. Only the owning authority can decide an item — the server will say so if it belongs to another desk.
        </div>
      </div>
    </Drawer>
  );
}

/* ---------- main ---------- */
export default function Attention() {
  const { session, domain, dispatch, actorName } = useStore();
  const toast = useToast();
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDismiss, setConfirmDismiss] = useState<Signal | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /* optimistic reconcile layer over the server queue (mirrors ActionCenter) */
  const [decidedOnServer, setDecidedOnServer] = useState<Set<string>>(new Set());

  /* the decision queue is the server's (GET /actions), the same
     source ActionCenter decides against — ids line up with the decide door. */
  const serverActions = useAsync(async () => {
    const res = await apiActions();
    return (res.actions ?? []) as Record<string, unknown>[];
  }, []);

  const { data, loading, error, retry } = useAsync(async () => {
    await new Promise(r => setTimeout(r, 380)); // local ranking pass
    return { signals: deriveSignals(domain.workOrders), rankedAt: new Date() };
  }, [session.roleId, domain.workOrders.length]);

  const refresh = () => { setDecidedOnServer(new Set()); serverActions.retry(); };

  const items: Signal[] = useMemo(() => {
    const actionSignals: Signal[] = (serverActions.data ?? [])
      .filter(r => r.status === 'open' && !decidedOnServer.has(String(r.id)))
      .map(r => ({
        id: String(r.id),
        kind: (r.kind ?? 'approval') as Signal['kind'],
        title: String(r.title ?? 'Untitled item'),
        detail: String(r.detail ?? ''),
        why: String(r.why ?? ''),
        priority: (r.priority === 'urgent' ? 'critical' : r.priority ?? 'normal') as Signal['priority'],
        chips: [`${r.owner_role ?? 'Staff'} desk · ${fmtTime(new Date(String(r.created_at ?? Date.now())))}`],
        evidence: [] as { label: string; detail?: string }[],
        suggested: [] as { id: string; label: string; type: 'investigate' | 'workflow' | 'message' | 'review'; detail?: string; posture?: 'AUTO' | 'APPROVAL' | 'HUMAN-ONLY' }[],
        policyRef: (r.policy_ref as string) ?? 'Constitution v2026.1 — posture applies to all suggested actions',
        to: '/action-center',
        due: r.deadline ? `due ${fmtDateShort(new Date(String(r.deadline)))}` : undefined,
        aiInvolved: !!r.ai_involved,
        derived: false,
      }));
    const signals = data?.signals ?? [];
    return [...actionSignals, ...signals].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
  }, [domain.actions, serverActions.data, decidedOnServer, data]);

  const kindCounts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    items.forEach(i => { c[i.kind] = (c[i.kind] ?? 0) + 1; });
    return c;
  }, [items]);

  const filtered = items.filter(i =>
    (priorityFilter === 'all' || i.priority === priorityFilter) &&
    (kindFilter === 'all' || i.kind === kindFilter),
  );

  const openSig = items.find(i => i.id === openId) ?? null;
  const resolvedCount = (serverActions.data ?? []).filter(a => a.status === 'approved' || a.status === 'dismissed').length;
  const totalForResolution = (serverActions.data ?? []).length;

  /* decide: the real door where the server queue backs the item.
     Success claims only 2xx truth. */
  const decide = async (sig: Signal, decision: 'approved' | 'dismissed') => {
    setBusyId(sig.id);
    try {
      const res = await apiDecideAction(sig.id, decision);
      setDecidedOnServer(prev => new Set(prev).add(sig.id));
      setOpenId(null);
      setConfirmDismiss(null);
      const exec = res.execution as { type?: string } | null | undefined;
      toast(decision === 'approved'
        ? { title: 'Approved', sub: exec?.type === 'communication' ? 'Recorded — the linked message was queued by the server.' : exec?.type === 'notification' ? 'Recorded — the linked task was broadcast to staff.' : 'Recorded with your name and role. The owning desk acts on it from here.', tone: 'success' }
        : { title: 'Dismissed', sub: 'Recorded on the server and removed from the open feed.', tone: 'info' });
      refresh();
    } catch (e) {
      toast({ title: decision === 'approved' ? 'Could not approve' : 'Could not dismiss', sub: friendly(e), tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const ack = (sig: Signal) => {
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName,
        actorRole: session.roleId,
        action: `Acknowledged signal — ${sig.title}`,
        recordType: 'Signal',
        recordRef: sig.id,
        reason: 'Reviewed from Attention feed',
        policyRef: sig.policyRef,
        aiInvolved: sig.aiInvolved,
        risk: sig.priority === 'critical' ? 'high' : sig.priority === 'high' ? 'medium' : 'low',
        outcome: 'Acknowledged · no action yet',
      },
    });
    toast({ title: 'Acknowledged.', sub: 'Noted in your session activity (this is not the school ledger); the signal stays visible until someone decides.', tone: 'info' });
  };

  return (
    <>
      <PageHead
        title="Needs your attention"
        sub={`${items.length} ranked item${items.length === 1 ? '' : 's'} — recommended actions merged with signals derived from today's records. Ranked at ${data ? fmtTime(data.rankedAt) : '…'}.`}
        actions={<Button variant="secondary" size="sm" icon={<Icon.Refresh size={13} />} onClick={retry}>Re-rank</Button>}
      />

      <SampleNote>Recommended actions come from the live action queue; the derived signals (unmarked registers, delays, expiries) are illustrative in this build and are not read from your school&rsquo;s records.</SampleNote>

      <div style={{ marginBottom: 14 }}><Slot name="attention" /></div>

      {error ? (
        <Card pad><Empty icon={<Icon.Alert size={22} />} title="Signals could not be ranked" sub="The record systems did not respond in time." action={<Button variant="secondary" onClick={retry}>Try again</Button>} /></Card>
      ) : (
        <>
          <div className="u-flex" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
            <Tabs
              pill
              tabs={[
                { id: 'all', label: 'All', count: items.length },
                { id: 'critical', label: 'Critical', count: items.filter(i => i.priority === 'critical').length },
                { id: 'high', label: 'High', count: items.filter(i => i.priority === 'high').length },
                { id: 'normal', label: 'Normal', count: items.filter(i => i.priority === 'normal').length },
              ]}
              active={priorityFilter}
              onChange={setPriorityFilter}
            />
            <span style={{ width: 1, height: 22, background: 'var(--border)' }} aria-hidden="true" />
            <Tabs
              tabs={[
                { id: 'all', label: 'All kinds' },
                { id: 'approval', label: 'Approvals', count: kindCounts['approval'] ?? 0 },
                { id: 'recommendation', label: 'Recommendations', count: kindCounts['recommendation'] ?? 0 },
                { id: 'incident', label: 'Incidents', count: kindCounts['incident'] ?? 0 },
                { id: 'case', label: 'Cases', count: kindCounts['case'] ?? 0 },
                { id: 'exception', label: 'Exceptions', count: kindCounts['exception'] ?? 0 },
              ]}
              active={kindFilter}
              onChange={setKindFilter}
            />
            <span className="u-xs u-faint" style={{ marginLeft: 'auto' }}>
              {resolvedCount} of {totalForResolution} items decided
            </span>
          </div>

          {loading || serverActions.loading ? (
            <div className="u-col" style={{ gap: 10 }}>
              <Skeleton w={220} h={12} />
              <SkeletonCard lines={3} />
              <SkeletonCard lines={3} />
              <SkeletonCard lines={3} />
            </div>
          ) : filtered.length === 0 ? (
            <Card pad>
              <Empty
                icon={items.length === 0 ? <span className="clear-check"><Icon.Check size={22} /></span> : <Icon.Check size={22} />}
                title={items.length === 0 ? 'All clear — nothing needs a human right now' : 'Nothing matches these filters'}
                sub={items.length === 0
                  ? 'The decision queue is clear and no derived signals are open. New items appear here as records change.'
                  : 'Adjust the priority or kind filters to see the rest of the feed.'}
              />
            </Card>
          ) : (
            <div className="u-col" style={{ gap: 12 }}>
              {filtered.map(sig => (
                <AttentionCard
                  key={sig.id}
                  sig={sig}
                  onOpen={() => setOpenId(sig.id)}
                  onApprove={() => sig.derived ? ack(sig) : decide(sig, 'approved')}
                  onDismiss={() => sig.derived ? ack(sig) : setConfirmDismiss(sig)}
                  onAck={() => ack(sig)}
                />
              ))}
            </div>
          )}

          <DetailDrawer
            sig={openSig}
            onClose={() => setOpenId(null)}
            onApprove={() => openSig && (openSig.derived ? (ack(openSig), setOpenId(null)) : decide(openSig, 'approved'))}
            onDismiss={() => openSig && (openSig.derived ? (ack(openSig), setOpenId(null)) : setConfirmDismiss(openSig))}
          />

          {/* dismiss confirmation */}
          <Drawer
            open={!!confirmDismiss}
            onClose={() => setConfirmDismiss(null)}
            title="Dismiss this item?"
            sub={confirmDismiss?.title}
            footer={
              <div className="u-flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
                <Button variant="ghost" onClick={() => setConfirmDismiss(null)}>Keep it</Button>
                <Button variant="danger" icon={<Icon.X size={13} />} loading={!!confirmDismiss && busyId === confirmDismiss.id} onClick={() => confirmDismiss && decide(confirmDismiss, 'dismissed')}>Dismiss permanently</Button>
              </div>
            }
          >
            <p className="u-small u-muted" style={{ marginTop: 0, lineHeight: 1.65 }}>
              Dismissing closes “{confirmDismiss?.title}” with your name on the record. The owning desk can re-raise it if the underlying pattern reappears.
            </p>
          </Drawer>
        </>
      )}
    </>
  );
}
