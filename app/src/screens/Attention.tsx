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
import { PageHead, Card, Badge, Button, Empty, Tabs, Drawer, Skeleton, SkeletonCard, useToast } from '../components/ui';
import { EvidenceChain, AiTraceCard, SuggestedActions } from '../components/Ai';
import { Slot } from '../plugins/Slot';
import type { AiTrace, WorkOrderRecord } from '../types/domain';
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

function mkTrace(over: Partial<AiTrace>): AiTrace {
  return {
    trigger: 'Ranked attention feed — anomaly detection',
    policy: 'Read-only assembly; actions approval-gated · Constitution v2026.1',
    dataUsed: ['attendance records', 'transport GPS', 'fee ledger', 'document register'],
    reasoningRole: 'Investigator (read-only)',
    action: 'Ranked and proposed — awaiting human decision',
    approvalStatus: 'Pending your approval',
    verification: 'Every figure recomputed from source records',
    model: 'Frontier (reasoning) · ap-south-1',
    latencyMs: 740,
    tokens: 980,
    cost: '₹0.08',
    ...over,
  };
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
        { label: 'Bus 14 route roster', detail: '38 riders; 15 of 20 absent 8-B students ride Route 7' },
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
        { label: 'Route 7 — Bus 14', detail: 'Coolant leak repaired Tuesday; pre-route inspection active (dec_4)' },
        { label: 'Guardian notifications', detail: `${delayed.reduce((a, r) => a + r.students, 0)} queued 07:57, delivered` },
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
    out.push({
      id: 'sig-fee',
      kind: 'exception',
      title: `${seed.FEE_STORY.failedCount} failed Term-2 payments cluster on Route 7 households`,
      detail: '41 of 47 failures belong to Route 7 families. Collection sits at 82.3% vs the 88% four-week average; 23 further gateway successes await settlement-file import.',
      why: 'A single combined message (bus + payment) historically recovers ~60% within 48h — but bulk messaging requires your approval (Communication §2.1).',
      priority: 'high',
      chips: ['Fee ledger · 10:12 · high', 'Gateway settlement diff · medium'],
      evidence: [
        { label: 'Collection trend (14 days)', detail: '88 → 82.3% · dip begins with the Bus 14 breakdown' },
        { label: 'Failure cluster', detail: '47 failures · 41 share Route 7 · avg ticket ₹57,457' },
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
          ? 'Safety or core-function impact with a hard SLA window. The facilities desk owns it; leadership visibility is automatic.'
          : 'Learning or comfort impact inside teaching hours. Ranked against every other open signal on urgency, impact, and deadline.',
        priority: urgent ? 'critical' : wo.priority === 'high' ? 'high' : 'normal',
        chips: [`${wo.id} · SLA ${new Date(wo.sla.resolveBy).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`, wo.assetId ? `Asset ${wo.assetId}` : 'No registered asset', `Category ${wo.category}`],
        evidence: [
          { label: 'Report intake', detail: `${wo.source} · ${wo.reportedBy} · ${new Date(wo.reportedOn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` },
          ...(wo.aiUnderstanding ? [{ label: 'AI understanding', detail: `${wo.aiUnderstanding.category} · ${wo.aiUnderstanding.assetMatch ? 'asset ' + wo.aiUnderstanding.assetMatch.assetId + ' (' + Math.round(wo.aiUnderstanding.assetMatch.confidence * 100) + '%)' : 'no asset match'} · confidence ${Math.round(wo.aiUnderstanding.confidence * 100)}%` }] : []),
          { label: 'SLA policy', detail: `respond ${wo.sla.responseMins}m · resolve ${Math.round(wo.sla.resolveMins / 60)}h (deterministic, Facilities §1.2)` },
          ...(wo.assetId ? [{ label: 'Asset history', detail: (() => { const a = seedAssetsMaint.find(x => x.id === wo.assetId); return a ? `${a.failures.length} prior failure${a.failures.length === 1 ? '' : 's'} · ₹${a.repairSpendYTD.toLocaleString('en-IN')} YTD · health ${a.health}` : 'asset record'; })() }] : []),
        ],
        suggested: [
          { id: 'open', label: 'Open work order', type: 'investigate' },
          ...(wo.assignedTo ? [] : [{ id: 'assign', label: 'Assign technician', type: 'workflow' as const, detail: 'Ranked by skill match, availability, first-time fix rate' }]),
        ],
        policyRef: 'Facilities §1.2 (intake + priority) · SLA engine deterministic',
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
        <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap', marginTop: 2 }} onClick={e => e.stopPropagation()}>
          <Button size="sm" variant="primary" icon={<Icon.Check size={13} />} onClick={onApprove}>Approve</Button>
          <Button size="sm" variant="ghost" icon={<Icon.X size={13} />} onClick={onDismiss}>Dismiss</Button>
          <Button size="sm" variant="secondary" icon={<Icon.Eye size={13} />} onClick={onOpen}>Evidence &amp; detail</Button>
          {!sig.derived && (
            <Button size="sm" variant="secondary" iconRight={<Icon.ArrowRight size={13} />} onClick={() => navigate(sig.to)}>Open record</Button>
          )}
        </div>
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
          Policy reference — {sig.policyRef}. Approving executes the first suggested action and writes an immutable audit entry with your name and role.
        </div>
        {sig.aiInvolved && (
          <AiTraceCard
            trace={mkTrace({
              trigger: 'Ranked attention feed — this item',
              dataUsed: sig.chips.map(c => c.split('·')[0].trim()),
              action: sig.suggested[0]?.label ?? 'Investigate',
            })}
            defaultOpen
          />
        )}
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

  const { data, loading, error, retry } = useAsync(async () => {
    await new Promise(r => setTimeout(r, 380)); // simulated ranking pass
    return { signals: deriveSignals(domain.workOrders), rankedAt: new Date() };
  }, [session.roleId, domain.workOrders.length]);

  const signals = data?.signals ?? [];

  const items: Signal[] = useMemo(() => {
    const actionSignals: Signal[] = domain.actions
      .filter(a => a.status === 'open')
      .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9))
      .map(a => ({
        id: a.id,
        kind: a.kind,
        title: a.title,
        detail: a.detail,
        why: a.why,
        priority: a.priority === 'urgent' ? 'critical' : a.priority,
        chips: [
          ...a.evidence.slice(0, 2).map(e => e.label),
          `${a.aiInvolved ? 'SchoolOS AI' : 'Rule-based'} · ${fmtTime(a.on)} · ${a.aiInvolved ? 'medium' : 'high'} confidence`,
        ],
        evidence: a.evidence.map(e => ({ label: e.label, detail: e.detail as string | undefined })),
        suggested: a.actions.map((x, i) => ({ id: `${a.id}_${i}`, label: x.label, type: x.type, detail: x.detail, posture: x.posture })),
        policyRef: a.evidence.find(e => e.label.startsWith('Policy'))?.detail?.replace(/[“”]/g, '') ?? 'Constitution v2026.1 — posture applies to all suggested actions',
        to: '/action-center',
        due: a.deadline ? `due ${fmtDateShort(a.deadline)}` : undefined,
        aiInvolved: a.aiInvolved,
        derived: false,
      }));
    return [...actionSignals, ...signals].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
  }, [domain.actions, signals]);

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
  const resolvedCount = domain.actions.filter(a => a.status === 'approved' || a.status === 'dismissed').length;

  const decide = (id: string, decision: 'approved' | 'dismissed') => {
    dispatch({ type: 'action/decide', id, decision, actor: actorName, role: session.roleId });
    setOpenId(null);
    toast(decision === 'approved'
      ? { title: 'Approved — executing.', sub: 'Audit entry recorded with your name and role.', tone: 'success' }
      : { title: 'Dismissed.', sub: 'Removed from the open feed; audit entry recorded.', tone: 'info' });
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
    toast({ title: 'Acknowledged.', sub: 'Logged to the audit ledger; the signal stays visible until decided.', tone: 'info' });
  };

  return (
    <>
      <PageHead
        title="Attention"
        sub={`${items.length} ranked item${items.length === 1 ? '' : 's'} — recommended actions merged with signals derived from today's records. Ranked at ${data ? fmtTime(data.rankedAt) : '…'}.`}
        actions={<Button variant="secondary" size="sm" icon={<Icon.Refresh size={13} />} onClick={retry}>Re-rank</Button>}
      />

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
              {resolvedCount} of {domain.actions.length} seeded items decided
            </span>
          </div>

          {loading ? (
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
                title={items.length === 0 ? 'All clear — nothing needs escalation' : 'Nothing matches these filters'}
                sub={items.length === 0
                  ? 'Every recommendation is decided and every derived signal is acknowledged. New signals appear here as records change.'
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
                  onApprove={() => sig.derived ? ack(sig) : decide(sig.id, 'approved')}
                  onDismiss={() => sig.derived ? ack(sig) : decide(sig.id, 'dismissed')}
                  onAck={() => ack(sig)}
                />
              ))}
            </div>
          )}

          <DetailDrawer
            sig={openSig}
            onClose={() => setOpenId(null)}
            onApprove={() => openSig && (openSig.derived ? (ack(openSig), setOpenId(null)) : decide(openSig.id, 'approved'))}
            onDismiss={() => openSig && (openSig.derived ? (ack(openSig), setOpenId(null)) : decide(openSig.id, 'dismissed'))}
          />
        </>
      )}
    </>
  );
}
