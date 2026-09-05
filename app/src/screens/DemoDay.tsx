/* ============================================================
   Demo: Run My Day (Golden Loop 2).
   Simulate a school morning → watch the event spine → read the
   briefing → ask why → approve → watch one action propagate
   through the operating system → loop closed.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../state/store';
import { PageHead, Card, Badge, Button, Empty } from '../components/ui';
import { Icon } from '../components/Icon';
import { EventTimeline, ActionChain, LoopClosed, SectionLabel, type ChainStep, type TimelineEntry } from '../components/Flow';
import { AiTraceCard, SuggestedActions } from '../components/Ai';
import { useScriptedDay, type DayMode } from '../demo/loops';

const MODES: { id: DayMode; label: string; sub: string }[] = [
  { id: 'normal', label: 'Normal day', sub: 'Registers, receipts, a repair verified' },
  { id: 'busy', label: 'Busy day', sub: 'Admissions rush, reminders, two reports' },
  { id: 'disruption', label: 'Disruption day', sub: 'Bus 14 + 8-B + Route 7 — the big one' },
  { id: 'exam', label: 'Exam day', sub: 'Quiet profile, logistics only' },
];

export default function DemoDay() {
  const { domain, dispatch, actorName, session } = useStore();
  const [mode, setMode] = useState<DayMode | null>(null);
  const { lines, done } = useScriptedDay(mode);
  const [askOpen, setAskOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState('Your ward\u2019s bus (Bus 14, Route 7) is running approximately 13 minutes late today due to a deviation near Sector 12. Expected arrival: 09:05. — Meridian Transport Desk');
  const [approval, setApproval] = useState<'idle' | 'queued' | 'sent' | 'delivered' | 'closed'>('idle');
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);

  /* the approval cascade — one tap, many surfaces */
  const approve = () => {
    setApproval('queued');
    const seq: [number, () => void][] = [
      [700, () => { setApproval('sent'); dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'comms', label: '09:03 · Parent notice SENT — 38 Route 7 guardians (template TRANSPORT_DELAY, approved by principal)', severity: 'info' } }); }],
      [1500, () => { setApproval('delivered'); dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'comms', label: '09:04 · Delivery verified — 38/38 WhatsApp receipts · 3 replies routed to the case', severity: 'info' } }); }],
      [2400, () => {
        dispatch({ type: 'audit/add', entry: {
          actor: actorName, actorRole: session.roleId, action: 'Approved parent communication (Bus 14 delay)', recordType: 'Communication',
          recordRef: '38 guardians · Route 7 · template TRANSPORT_DELAY', reason: 'Transport §3.1 — delay > 10 min triggers guardian notice; approval before send',
          policyRef: 'Transport §3.1 · Communication §1.2', aiInvolved: true, risk: 'low',
          outcome: 'Sent 09:03 · delivered 38/38 · replies clustered into case (Transport desk)',
        } });
        setApproval('closed');
      }],
    ];
    seq.forEach(([ms, fn]) => timers.current.push(window.setTimeout(fn, ms)));
  };

  /* the action chain reflects live approval state */
  const chain: ChainStep[] = useMemo(() => ([
    { id: 'trigger', label: 'Trigger', detail: 'Bus 14 GPS deviation', state: mode === 'disruption' ? 'done' : 'pending' },
    { id: 'policy', label: 'Policy', detail: 'Transport §3.1', state: mode === 'disruption' ? 'done' : 'pending' },
    { id: 'evidence', label: 'Evidence', detail: 'GPS + roster + attendance', state: mode === 'disruption' ? 'done' : 'pending' },
    { id: 'proposal', label: 'Proposal', detail: 'Notice drafted', state: mode === 'disruption' ? 'done' : 'pending' },
    { id: 'approval', label: 'Approval', detail: approval === 'idle' ? 'waiting for you' : `by ${actorName}`, state: approval === 'idle' ? (mode === 'disruption' ? 'running' : 'pending') : 'done' },
    { id: 'execution', label: 'Execution', state: approval === 'sent' || approval === 'delivered' || approval === 'closed' ? 'done' : approval === 'queued' ? 'running' : 'pending' },
    { id: 'verification', label: 'Verification', detail: 'receipts', state: approval === 'delivered' || approval === 'closed' ? 'done' : 'pending' },
    { id: 'audit', label: 'Audit', state: approval === 'closed' ? 'done' : 'pending' },
  ]), [mode, approval, actorName]);

  /* briefing items — every number sourced */
  const briefing: TimelineEntry[] = mode === 'disruption' ? [
    { time: '08:31', label: 'Bus 14 delayed — Route 7', detail: '+13 min vs schedule · 38 students on board list · GPS deviation at Sector 12', kind: 'detect', ref: { label: 'View transport record', to: '/transport' } },
    { time: '08:37', label: 'Grade 8-B attendance 23% vs 6% baseline', detail: '15 of 20 absentees are Bus 14 riders — deviation flagged while registers are still open', kind: 'detect', ref: { label: 'View attendance', to: '/attendance' } },
    { time: '08:42', label: 'Parent complaints classified', detail: '4 inbound on Route 7 → deduplicated into ONE case (not four tasks)', kind: 'understand', ref: { label: 'View case', to: '/cases' } },
    { time: '08:49', label: 'Payment failures clustering', detail: '3 new UPI timeouts, all Route 7 households — consistent with the disruption pattern', kind: 'understand', ref: { label: 'View fees', to: '/fees' } },
    { time: '09:05', label: 'Maintenance SLA closing', detail: 'WO-1042 (AC-04, 4th failure) — resolution window closes 11:21, escalation armed', kind: 'detect', ref: { label: 'View work order', to: '/maintenance/work-orders/WO-1042' } },
  ] : [];

  const openActions = domain.actions.filter((a: import('../types/domain').ActionRecord) => a.status === 'open');

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <PageHead
        title="Run my day"
        sub="One school morning on SchoolOS — events, briefing, one approval, and every surface updates"
        actions={<Link to="/demo" className="btn btn-ghost">Demo launcher</Link>}
      />

      {/* simulate school day */}
      <Card head="Simulate school day" sub="Pick the morning — the event spine, briefing and queues react live">
        <div className="grid grid-4" style={{ gap: 10 }}>
          {MODES.map(m => (
            <button key={m.id} onClick={() => { setMode(m.id); setApproval('idle'); setAskOpen(false); }}
              className="u-col" style={{
                gap: 3, padding: '12px 14px', borderRadius: 'var(--r-md)', textAlign: 'left', cursor: 'pointer',
                border: mode === m.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: mode === m.id ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'var(--surface-1)',
              }}>
              <span style={{ fontWeight: 620, fontSize: 'var(--text-sm)' }}>{m.label}</span>
              <span className="u-xs u-faint">{m.sub}</span>
            </button>
          ))}
        </div>
        {mode && (
          <div className="u-col" style={{ gap: 6, marginTop: 12 }}>
            {lines.map((l, i) => (
              <div key={i} className="u-inline u-small" style={{ gap: 8, animation: 'fadeIn .3s' }}>
                <Icon.Check size={13} style={{ color: 'var(--success)' }} /> {l}
              </div>
            ))}
            {done && <span className="u-small" style={{ color: 'var(--accent-text)', fontWeight: 560 }}>Morning sequence complete — the briefing below is now live.</span>}
          </div>
        )}
      </Card>

      {mode === 'disruption' && (
        <>
          {/* event spine */}
          <Card head="The event spine — one morning, one graph" sub="These are not separate dashboards; they are one causal chain" style={{ marginTop: 'var(--s-4)' }}>
            <EventTimeline items={briefing} />
            <div className="u-xs u-faint" style={{ marginTop: 12 }}>
              Correlation rule: Transport §3.1 delay {'>'} 10 min → roster cross-reference → attendance deviation → comms classification → Attention. Deterministic, auditable, and re-rankable in the Control Plane.
            </div>
          </Card>

          {/* briefing */}
          <div className="maint-grid" style={{ marginTop: 'var(--s-4)' }}>
            <Card head="Good morning — needs you" sub={`Ranked for ${'the principal'} · every number opens its record`}>
              <div className="u-col" style={{ gap: 10 }}>
                {[
                  { t: 'Bus 14 +13 min — 38 students affected', src: 'GPS feed', to: '/transport', link: 'View transport', p: 'high' as const },
                  { t: 'Grade 8-B attendance 23% (vs 6% baseline)', src: 'live registers', to: '/attendance', link: 'View attendance', p: 'high' as const },
                  { t: 'Maintenance SLA — 1h 42m remaining on WO-1042', src: 'SLA engine', to: '/maintenance/work-orders/WO-1042', link: 'View work order', p: 'critical' as const },
                ].map(b => (
                  <div key={b.t} className="u-col" style={{ gap: 3, padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
                    <div className="u-between" style={{ gap: 8 }}>
                      <span style={{ fontWeight: 590, fontSize: 'var(--text-sm)' }}>{b.t}</span>
                      <Badge tone={b.p === 'critical' ? 'danger' : 'warning'}>{b.p}</Badge>
                    </div>
                    <div className="u-between">
                      <span className="u-xs u-faint u-mono">SOURCE: {b.src}</span>
                      <Link to={b.to} className="u-xs" style={{ color: 'var(--accent-text)', fontWeight: 560 }}>{b.link} →</Link>
                    </div>
                  </div>
                ))}
                <div className="u-inline" style={{ gap: 8 }}>
                  <Button variant="secondary" size="sm" icon={<Icon.Ask size={13} />} onClick={() => setAskOpen(o => !o)}>Ask why</Button>
                  <Link to="/attention" className="btn btn-ghost btn-sm">Open Attention</Link>
                </div>
              </div>
            </Card>

            {/* tomorrow / forward view — deterministic contract */}
            <Card head="Tomorrow — forward view" sub="DUE · AT RISK · LIKELY · PREDICTED">
              <div className="u-col" style={{ gap: 8 }}>
                {[
                  { c: 'DUE', t: 'Fire-safety certificate renewal', d: 'expires in 21 days · obligation obl_3', tone: 'warning' as const },
                  { c: 'AT RISK', t: 'Term 2 collection 82.3% vs 88% avg', d: 'threshold: −2pts WoW · route 7 cluster', tone: 'warning' as const },
                  { c: 'LIKELY', t: 'AC-04 replacement decision', d: '3rd failure pattern · spend ratio 25% (rule-based)', tone: 'info' as const },
                ].map(x => (
                  <div key={x.t} className="u-inline" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <Badge tone={x.tone}>{x.c}</Badge>
                    <div className="u-col" style={{ gap: 1 }}>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 550 }}>{x.t}</span>
                      <span className="u-xs u-faint">{x.d}</span>
                    </div>
                  </div>
                ))}
                <div className="u-col" style={{ gap: 3, padding: '9px 12px', border: '1px dashed var(--border)', borderRadius: 'var(--r-md)' }}>
                  <span className="u-inline u-small" style={{ gap: 7, color: 'var(--text-3)' }}>
                    <Icon.Sparkle size={13} /> PREDICTED — not yet supported — by design.
                  </span>
                  <span className="u-xs u-faint">A forecast appears here only after a model passes 8 weeks of live backtesting with published precision. Until then, silence is the feature.</span>
                </div>
              </div>
            </Card>
          </div>

          {/* ask why */}
          {askOpen && (
            <Card head="Ask: “Why are Grade 8-B absences unusually high?”" sub="The causal chain — every step sourced and openable" style={{ marginTop: 'var(--s-4)' }}>
              <EventTimeline items={[
                { time: '08:37', label: 'Attendance records — 8-B', detail: '23% present vs 93% 10-day average · 20 absentees', kind: 'detect', ref: { label: 'Open attendance', to: '/attendance' } },
                { time: '08:31', label: 'Bus 14 route deviation', detail: 'GPS: Sector 12 bridge block · +13 min · route 7', kind: 'detect', ref: { label: 'Open transport', to: '/transport' } },
                { time: '08:37', label: '15 of 20 absentees are Bus 14 riders', detail: 'roster cross-reference — deterministic join', kind: 'understand' },
                { time: '08:42', label: 'Parent complaints begin', detail: '4 inbound on route 7 · classified transport · deduped to 1 case', kind: 'act', ref: { label: 'Open case', to: '/cases' } },
                { time: 'now', label: 'Current unresolved issue', detail: 'Cluster case open · owner: Transport desk · SLA 24h', kind: 'close', ref: { label: 'Open case', to: '/cases' } },
              ]} />
              <div className="divider" />
              <SectionLabel>What should I do?</SectionLabel>
              <SuggestedActions
                actions={[
                  { id: 'notify', label: 'Notify affected parents (38, Route 7)', type: 'message', detail: 'Transport §3.1 · template TRANSPORT_DELAY · APPROVAL REQUIRED' },
                  { id: 'incident', label: 'Open transport incident + assign follow-up', type: 'workflow', detail: 'owner: Transport desk · SLA 24h' },
                  { id: 'review', label: 'Review affected attendance entries', type: 'task', detail: 'leniency rule applies to Bus 14 riders (Attendance §1.4)' },
                ]}
                onApprove={() => {}}
                compact
              />
              <AiTraceCard trace={{
                trigger: 'Principal question — attendance anomaly',
                policy: 'Read-only investigation · Constitution §2 (no auto-execution)',
                dataUsed: ['attendance registers', 'transport GPS', 'route rosters', 'comm_log', 'cases'],
                reasoningRole: 'Investigator (deterministic correlation)',
                action: 'Evidence chain + proposed actions only',
                approvalStatus: 'APPROVAL REQUIRED for any send',
                verification: 'Every claim linked to ≥2 records',
                model: 'Fast (routing) · deterministic correlation engine',
                latencyMs: 240, tokens: 310, cost: '₹0.02',
              }} />
            </Card>
          )}

          {/* approval → action → propagation */}
          <Card head="Approve the parent communication" sub="One tap. Watch it propagate through the operating system." style={{ marginTop: 'var(--s-4)' }}>
            {approval === 'idle' ? (
              <div className="u-col" style={{ gap: 12 }}>
                <div className="u-small u-muted" style={{ lineHeight: 1.65 }}>
                  Proposal: send the delay notice to 38 Route 7 guardians via WhatsApp (template TRANSPORT_DELAY).
                  Posture: <b>APPROVAL REQUIRED</b> — Transport §3.1. Draft ready, audience resolved from migrated rosters.
                </div>
                {editOpen && (
                  <div className="u-col" style={{ gap: 6 }}>
                    <span className="u-upper u-xs" style={{ fontWeight: 660, color: 'var(--text-3)', letterSpacing: '0.06em' }}>Draft — template TRANSPORT_DELAY (edit before approving)</span>
                    <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--surface-1)', color: 'var(--text-1)', font: 'inherit', resize: 'vertical' }} />
                    <span className="u-xs u-faint">Edits are yours — the audit entry records the approved text, not the template.</span>
                  </div>
                )}
                <div className="u-inline" style={{ gap: 8 }}>
                  <Button variant="primary" icon={<Icon.Check size={14} />} onClick={approve}>Approve & send</Button>
                  <Button variant="ghost" onClick={() => setEditOpen(o => !o)}>{editOpen ? 'Close editor' : 'Edit draft'}</Button>
                  <Button variant="ghost" onClick={() => toastDismiss(dispatch)}>Dismiss</Button>
                </div>
              </div>
            ) : (
              <div className="u-col" style={{ gap: 12 }}>
                <ActionChain steps={chain} />
                <EventTimeline items={[
                  true && { time: '09:03', label: 'Approval recorded', detail: `${actorName} · ${session.roleId} · reason + policy on the ledger entry`, kind: 'act' as const },
                  (approval === 'sent' || approval === 'delivered' || approval === 'closed') && { time: '09:03', label: 'Message queued → sent', detail: 'Communication orchestrator: dedup ✓ · quiet-hours ✓ · template ✓', kind: 'act' as const },
                  (approval === 'delivered' || approval === 'closed') && { time: '09:04', label: 'Message delivered — 38/38', detail: 'WhatsApp receipts · 3 replies auto-routed to the case', kind: 'verify' as const },
                  approval === 'closed' && { time: '09:05', label: 'All surfaces updated', detail: 'Briefing · Action Center · Transport · Case · Audit · Memory — one action, one truth', kind: 'close' as const },
                ].filter(Boolean) as TimelineEntry[]} />
                {approval === 'closed' && (
                  <div className="u-col" style={{ gap: 10 }}>
                    <LoopClosed at="09:05" summary="Detected 08:31 → verified & closed 09:05 · 34 minutes, zero phone calls." />
                    <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <Link to="/audit" className="btn btn-secondary btn-sm">See it in the audit ledger</Link>
                      <Link to="/cases" className="btn btn-ghost btn-sm">Open the case</Link>
                      <Link to="/demo/parent" className="btn btn-primary btn-sm">Next loop — resolve a parent issue</Link>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      {!mode && (
        <Card style={{ marginTop: 'var(--s-4)' }}>
          <Empty icon={<Icon.Play size={22} />} title="Pick a morning above" sub="For the strongest demonstration, choose Disruption day — Bus 14 breaks down and the whole system responds." />
        </Card>
      )}

      {/* your actions — the school operating queue */}
      <Card head="Your actions" sub={`${openActions.length} open · this is a school operating queue, not a project board`} style={{ marginTop: 'var(--s-4)' }}>
        {openActions.length === 0 ? <Empty icon={<Icon.Check size={20} />} title="Queue clear" /> : (
          <div className="u-col" style={{ gap: 8 }}>
            {openActions.slice(0, 4).map(a => (
              <div key={a.id} className="u-col" style={{ gap: 3, padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
                <div className="u-between" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 580, fontSize: 'var(--text-sm)' }}>{a.title}</span>
                  <Badge tone={a.priority === 'critical' ? 'danger' : a.priority === 'high' ? 'warning' : 'neutral'}>{a.priority}</Badge>
                </div>
                <span className="u-small u-muted">{a.why}</span>
                <span className="u-xs u-faint">owner: {a.owner} · {a.deadline ? `due ${a.deadline.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'no hard deadline'}{a.policyRef ? ` · ${a.policyRef}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function toastDismiss(dispatch: ReturnType<typeof useStore>['dispatch']) {
  dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'demo', label: 'Proposal dismissed — decision recorded in the ledger with the reason', severity: 'info' } });
}
