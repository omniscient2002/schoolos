/* ============================================================
   Golden Loops — the scripted demo engine.
   Three loops share ONE store: every step dispatches real
   actions (events, audit, chat, cases, actions) so every
   surface updates coherently. Numbers come from the seed.
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { TimelineEntry } from '../components/Flow';
import type { LiveEvent } from '../types/domain';

export type DayMode = 'normal' | 'busy' | 'disruption' | 'exam';

interface ScriptStep {
  afterMs: number;
  do: (ctx: LoopCtx) => void;
}

export interface LoopCtx {
  dispatch: ReturnType<typeof useStore>['dispatch'];
  say: (line: string) => void;               // progress line for the runner UI
  tick: (id: string, label: string, state: 'running' | 'done') => void;
}

/* ---------- shared helpers ---------- */
const ev = (label: string, type = 'demo', severity: LiveEvent['severity'] = 'info'): Omit<LiveEvent, 'id' | 'on'> => ({
  type, label, severity,
});
const audited = (label: string) => label;
const EID = () => `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

/* ============================================================
   GOLDEN LOOP 1 — FIRST DAY (after cutover).
   Migration verified → first attendance → policy → parent
   notification → delivery → audit → SCHOOL IS LIVE.
   ============================================================ */
export function firstDayScript(ctx: LoopCtx): TimelineEntry[] {
  const d = ctx.dispatch;
  const timeline: TimelineEntry[] = [];
  const step = (time: string, label: string, detail: string, kind: TimelineEntry['kind'], e?: { label: string; severity: LiveEvent['severity']; type?: string }) => {
    timeline.push({ time, label, detail, kind });
    if (e) d({ type: 'event/add', e: { id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, on: new Date(), ...ev(e.label, e.type ?? 'demo', e.severity) } });
    d({ type: 'audit/add', entry: {
      actor: 'Priya Iyer', actorRole: 'teacher', action: label, recordType: 'Attendance',
      recordRef: '8-B · 23 present · 2 absent (Bus 14)', reason: 'First register on SchoolOS — migrated roster',
      policyRef: 'Attendance §1.1', aiInvolved: true, risk: 'low',
      outcome: audited('Register complete in 40 seconds · 2 absences auto-notified (pending)'),
    } });
  };
  step('08:41', 'Teacher opens the register — 8-B', 'Migrated roster, 25 students, no setup. Attendance marked in 40 seconds.', 'note', { label: 'First register opened on SchoolOS — 8-B (migrated roster)', severity: 'info' });
  d({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'attendance', label: 'attendance.marked — 8-B · 23 present, 1 late, 2 absent (Route 7 households)', severity: 'info' } });
  ctx.say('Register marked · attendance.marked emitted');
  step('08:42', 'attendance.marked → policy evaluation', 'Attendance §1.1: guardian-informed absences auto-notify; unexplained absences alert the class teacher by 09:30.', 'guard', { label: 'Policy evaluated — Attendance §1.1 · 2 absences qualify for guardian notice', severity: 'info' });
  step('08:42', 'Guardian notifications queued', '2 WhatsApp messages to Route 7 households — audience resolved from migrated guardian links.', 'act', { label: '2 guardian notifications queued (WhatsApp)', severity: 'info' });
  step('08:43', 'Message delivered ✓', 'Both guardians received the absence notice. Delivery receipts recorded.', 'verify', { label: 'Delivery verified — 2/2 WhatsApp receipts', severity: 'info' });
  step('08:43', 'Audit entry written', 'Who: Priya Iyer · What: register marked · Policy: Attendance §1.1 · Outcome: notices delivered.', 'close');
  return timeline;
}

/* ============================================================
   GOLDEN LOOP 2 — DISRUPTION DAY.
   08:31 Bus 14 delay → 08:37 attendance anomaly → 08:42 parent
   complaints → 08:49 payment-failure cluster → 09:05 maintenance
   SLA breach risk. Every step hits the spine.
   ============================================================ */
export const disruptionScript: ScriptStep[] = [
  { afterMs: 0, do: ({ dispatch, say }) => {
    dispatch({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'transport', label: '08:31 · Bus 14 delayed — Route 7 deviation near Sector 12 (+13 min, GPS)', severity: 'warn' } });
    say('Bus 14 delay detected (GPS)');
  } },
  { afterMs: 2200, do: ({ dispatch, say }) => {
    dispatch({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'attendance', label: '08:37 · Attendance deviation building — 15 Bus 14 riders absent in 8-B (early registers)', severity: 'warn' } });
    say('Attendance deviation detected → 8-B riders');
  } },
  { afterMs: 4300, do: ({ dispatch, say }) => {
    dispatch({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'comms', label: '08:42 · Parent complaints classified — 4 inbound on Route 7, intent: transport', severity: 'warn' } });
    dispatch({ type: 'case/add', c: {
      id: `case_rt7_${Date.now()}`, kind: 'transport', title: 'Route 7 parents — Bus 14 delay complaints (cluster)', openedOn: new Date(), openedBy: 'Communication orchestrator',
      owner: 'Transport desk', priority: 'high', slaHours: 24, status: 'open',
      messages: [{ on: new Date(), from: 'system', text: 'Cluster opened automatically — 4 related inbound messages deduplicated into one case.', internal: true }],
      linkedRecords: [{ label: 'Bus 14 GPS', ref: 'Route 7' }, { label: 'Attendance 8-B', ref: '8-B' }],
      origin: 'system', campus: 'north',
    } });
    say('Parent complaints classified → one case, not four');
  } },
  { afterMs: 6500, do: ({ dispatch, say }) => {
    dispatch({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'fees', label: '08:49 · Payment-failure cluster forming — Route 7 households (3 new UPI timeouts this morning)', severity: 'warn' } });
    say('Fee failure cluster forming (Route 7)');
  } },
  { afterMs: 8600, do: ({ dispatch, say }) => {
    dispatch({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'maintenance', label: '09:05 · Maintenance SLA closing — WO-1042 AC-04 repair due 11:21, 47% window remaining', severity: 'critical' } });
    say('Maintenance SLA risk surfaced');
  } },
  { afterMs: 10500, do: ({ dispatch, say }) => {
    dispatch({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'demo', label: 'Attention re-ranked — 5 signals, 1 approval required (Transport §3.1 parent notice)', severity: 'info' } });
    dispatch({ type: 'audit/add', entry: {
      actor: 'SchoolOS', actorRole: 'coordinator', action: 'Disruption cluster correlated', recordType: 'Attention',
      recordRef: 'Bus 14 → 8-B attendance → Route 7 complaints → fee cluster', reason: 'Event spine correlation (deterministic)',
      policyRef: 'Attention §1.1 (ranking)', aiInvolved: true, risk: 'low',
      outcome: 'Ranked #1 with evidence chain; parent-notice proposal drafted (APPROVAL REQUIRED)',
    } });
    say('Attention re-ranked · proposal drafted — check your briefing');
  } },
];

/* normal/busy/exam days: lighter sequences */
export const normalDayScript: ScriptStep[] = [
  { afterMs: 0, do: ({ dispatch }) => dispatch({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'attendance', label: '08:41 · Registers marked across 30 sections — 96.2% present', severity: 'info' } }) },
  { afterMs: 2400, do: ({ dispatch }) => dispatch({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'fees', label: '09:12 · 4 fee payments reconciled — receipts sent on WhatsApp', severity: 'info' } }) },
  { afterMs: 4800, do: ({ dispatch }) => dispatch({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'maintenance', label: '09:40 · WO-1046 CCTV repair verified — camera back online, health +4', severity: 'info' } }) },
];
export const busyDayScript: ScriptStep[] = [
  { afterMs: 0, do: ({ dispatch }) => dispatch({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'admissions', label: '08:20 · 6 admission enquiries in the first hour — desk answered all, 2 campus visits booked', severity: 'info' } }) },
  { afterMs: 2600, do: ({ dispatch }) => dispatch({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'fees', label: '09:05 · Fee reminder batch sent — 41 households, deduped by orchestrator', severity: 'info' } }) },
  { afterMs: 5200, do: ({ dispatch }) => dispatch({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'maintenance', label: '09:30 · 2 new maintenance reports — Block C projector lamp, staff-room window', severity: 'warn' } }) },
  { afterMs: 7600, do: ({ dispatch }) => dispatch({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'comms', label: '09:44 · Grade 6 excursion approvals — 18 of 22 received', severity: 'info' } }) },
];
export const examDayScript: ScriptStep[] = [
  { afterMs: 0, do: ({ dispatch }) => dispatch({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'demo', label: 'Exam Mode ON — non-essential notifications suppressed; logistics surfaces prioritized', severity: 'info' } }) },
  { afterMs: 2400, do: ({ dispatch }) => dispatch({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'attendance', label: '08:30 · Exam halls set — invigilation duty confirmed for 14 staff', severity: 'info' } }) },
  { afterMs: 4800, do: ({ dispatch }) => dispatch({ type: 'event/add', e: { id: EID(), on: new Date(), type: 'comms', label: '09:00 · Exam-day logistics notice delivered to all guardians (§3.2 quiet profile)', severity: 'info' } }) },
];

export const dayScriptFor = (m: DayMode): ScriptStep[] =>
  m === 'disruption' ? disruptionScript : m === 'normal' ? normalDayScript : m === 'busy' ? busyDayScript : examDayScript;

/* ============================================================
   GOLDEN LOOP 3 — PARENT / FEE / COMMS.
   Verification → deterministic answer → Pay now → lifecycle →
   receipt → reconcile → RESOLVED. All seeded values.
   ============================================================ */
export const PARENT_FEE = {
  guardian: 'Guardian of Aarav Sharma (8-B)',
  feeLabel: 'Term 2 installment — September',
  amount: 18500,
  attempt: 'UPI · Oct 12, 19:04 · timeout at bank',
  obligationRef: 'FEE-2026-0821',
};

export interface ParentStage {
  id: string;
  from: 'parent' | 'school' | 'system';
  text: string;
  meta?: string;
}

export function parentFeeStages(): ParentStage[] {
  return [
    { id: 'in', from: 'parent', text: 'Hi, I was told Aarav\u2019s fee payment failed. Can you tell me what happened?', meta: 'received · WhatsApp · 10:02' },
    { id: 'verify', from: 'system', text: 'Verification before disclosure — guardian ✓ · child relationship ✓ · fee-record permission ✓', meta: 'policy: Fees §5.1 + DPDP minimization' },
    { id: 'answer', from: 'school', text: `Your ${PARENT_FEE.feeLabel} of ₹18,500 is currently marked unpaid because the previous payment attempt did not settle (${PARENT_FEE.attempt}). No late fee applies for retries by Friday (Fees §4.2).`, meta: 'sources: fee obligation FEE-2026-0821 · payment attempt record — deterministic, not generated' },
    { id: 'choice', from: 'system', text: '[Pay now]  [View statement]  [Talk to school]', meta: 'actions proposed · posture: payer = guardian' },
  ];
}

export function paymentLifecycleSteps(ctx: LoopCtx): TimelineEntry[] {
  const d = ctx.dispatch;
  const t: TimelineEntry[] = [];
  const add = (time: string, label: string, detail: string, kind: TimelineEntry['kind'], eventLabel?: string) => {
    t.push({ time, label, detail, kind });
    if (eventLabel) d({ type: 'event/add', e: { id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, on: new Date(), ...ev(eventLabel, 'fees') } });
  };
  add('10:04', 'Payment initiated', 'Razorpay order created for ₹18,500 — link sent to the same WhatsApp thread.', 'act', 'payment.initiated — ₹18,500 (Aarav Sharma, Term 2 installment)');
  add('10:06', 'Payment confirmed', 'UPI collect succeeded — bank reference captured, gateway webhook verified (signature + idempotency).', 'act', 'payment.confirmed — ₹18,500');
  add('10:06', 'Receipt generated', 'Receipt RCP-1187 issued against FEE-2026-0821; PDF stored, pointer on the obligation.', 'act');
  add('10:07', 'Ledger updated', 'Obligation balance ₹18,500 → ₹0. Ledger line written; no manual entry.', 'act');
  add('10:07', 'WhatsApp receipt sent', 'Template FEE_RECEIPT delivered to the guardian — delivery receipt ✓', 'verify', 'receipt delivered (WhatsApp)');
  add('10:08', 'Reconciliation verified', 'Settlement projection matches bank credit to the rupee — zero difference.', 'close', 'reconciliation verified — difference ₹0');
  d({ type: 'audit/add', entry: {
    actor: 'Guardian (self-serve)', actorRole: 'parent', action: 'Fee payment completed via chat', recordType: 'Payment',
    recordRef: `₹18,500 — ${PARENT_FEE.obligationRef}`, reason: 'Parent resolved from WhatsApp — no calls, no office visit',
    policyRef: 'Fees §4.2, §5.1', aiInvolved: true, risk: 'low',
    outcome: 'Receipt RCP-1187 issued · ledger reconciled · delivery verified',
  } });
  return t;
}

/* ---------- follow traces: one entity across the whole system ---------- */
export interface FollowChain {
  title: string;
  subtitle: string;
  steps: { stage: string; label: string; detail: string; at?: string; ref?: string }[];
}

export const followChains: Record<string, FollowChain> = {
  person: {
    title: 'Aarav Sharma — 8-B · Bus 14 rider',
    subtitle: 'One child, one record, every surface',
    steps: [
      { stage: 'SOURCE', label: 'Migrated from legacy master sheet', detail: 'row 214 — source stamped, never overwritten', at: 'Migration, day 2' },
      { stage: 'RECORD', label: 'person → enrollment 8-B → guardian link (mother)', detail: 'compact record; relationships first-class' },
      { stage: 'TRANSPORT', label: 'Bus 14 · Route 7 · stop 12', detail: 'permit capacity enforced on import' },
      { stage: 'ATTENDANCE', label: 'Absence cluster Oct 14 — reason: route delay', detail: 'linked to transport, not marked unexcused' },
      { stage: 'FEE', label: 'Term 2 installment ₹18,500 — reconciled Oct 14', detail: 'self-served from WhatsApp; receipt RCP-1187' },
      { stage: 'COMMUNICATION', label: '2 messages · both delivered · 1 reply', detail: 'comm_log — dedup + receipts' },
      { stage: 'AUDIT', label: '7 entries — every touch has actor + policy', detail: 'support, principal and auditor see scope-filtered views' },
      { stage: 'MEMORY', label: 'Bus 14 pre-route inspection decision cites this cluster', detail: 'expected-vs-actual tracked since' },
    ],
  },
  money: {
    title: '₹18,500 — Term 2 installment (Aarav Sharma)',
    subtitle: 'Follow the money: obligation → payment → receipt → reconciliation',
    steps: [
      { stage: 'OBLIGATION', label: 'FEE-2026-0821 · Term 2 installment', detail: 'migrated from Tally export — source stamped' },
      { stage: 'ATTEMPT', label: 'UPI Oct 12 · timeout at bank', detail: 'gateway webhook, signature verified; not a "failed payment" — unsettled' },
      { stage: 'COMMS', label: 'Parent asked on WhatsApp · verification passed · deterministic answer', detail: 'no AI fabrication — fee record quoted' },
      { stage: 'PAYMENT', label: 'Payment link → UPI collect → confirmed', detail: '₹18,500 · bank reference captured' },
      { stage: 'RECEIPT', label: 'RCP-1187 generated + sent', detail: 'delivery receipt on WhatsApp' },
      { stage: 'RECONCILIATION', label: 'Settlement vs bank credit — difference ₹0', detail: 'continuous reconciliation (Fees §5.1)' },
      { stage: 'OUTCOME', label: 'Obligation closed · attention item cleared', detail: 'the original problem disappears from every queue' },
    ],
  },
  event: {
    title: 'Bus 14 delay — Oct 14, 08:31',
    subtitle: 'Follow the event: one delay, five surfaces, zero phone calls',
    steps: [
      { stage: 'SOURCE', label: 'GPS deviation — Route 7 near Sector 12', detail: '+13 min vs schedule', at: '08:31' },
      { stage: 'RECORD', label: 'Route 7 roster → 38 riders → 15 in 8-B', detail: 'relationships resolved automatically' },
      { stage: 'POLICY', label: 'Transport §3.1 — delay > 10 min triggers guardian notice', detail: 'deterministic rule' },
      { stage: 'AI', label: 'Classification + dedup — 4 complaints → 1 case', detail: 'intent: transport · sentiment: frustrated' },
      { stage: 'ACTION', label: 'Parent notice drafted — APPROVAL REQUIRED', detail: 'principal approved 09:03' },
      { stage: 'VERIFICATION', label: '38 guardians · 38 delivered · 3 replies', detail: 'receipts on comm_log' },
      { stage: 'AUDIT', label: 'Every step: actor, policy, outcome', detail: 'inspection-ready' },
      { stage: 'MEMORY', label: 'Pre-route inspection decision cites this event', detail: 'expected: 0 route delays/term — actual: tracking' },
    ],
  },
  problem: {
    title: 'WO-1042 — AC-04 trips breaker (4th failure)',
    subtitle: 'Follow the problem: detection → ownership → resolution → learning',
    steps: [
      { stage: 'DETECT', label: 'Report: "AC in room 204 trips after a few minutes"', detail: 'one line, via app' },
      { stage: 'EVIDENCE', label: 'Asset NOR-AC-04 matched · 3 prior failures in 60 days', detail: 'spend ₹11,200 before this job' },
      { stage: 'OWNER', label: 'Sunita Yadav — HVAC, first-time-fix 91%', detail: 'recommended, human assigned' },
      { stage: 'ESCALATION', label: 'SLA closing · parts hold flagged', detail: 'R32 refrigerant stock 0 → purchase request raised' },
      { stage: 'ACTION', label: 'Repair + parts + labour recorded by voice', detail: 'transcript beside parsed fields' },
      { stage: 'COMMUNICATION', label: 'Reporter + facilities desk notified on verify', detail: 'no chase calls' },
      { stage: 'RESOLUTION', label: 'Fixed · verified · cost logged (₹7,200)', detail: 'spend YTD ₹18,400' },
      { stage: 'REVIEW', label: 'Replacement evaluation triggered — rule-based', detail: 'spend ratio > 20% · decision recorded in Memory' },
    ],
  },
};

/* ---------- the 15-minute guided path ---------- */
export const GUIDED_PATH = [
  { id: 'loop1', label: 'Migrate my school', minutes: '0–4', to: '/migration', blurb: 'Connect sources → verify → activate → first day' },
  { id: 'loop2', label: 'Run my day', minutes: '4–10', to: '/demo/day', blurb: 'Disruption day → briefing → ask why → approve → loop closed' },
  { id: 'loop3', label: 'Resolve a parent issue', minutes: '10–14', to: '/demo/parent', blurb: 'Verify → answer → pay → case → resolution → audit' },
  { id: 'summary', label: 'School running', minutes: '14–15', to: '/demo/summary', blurb: 'The numbers, the ledger, the memory' },
] as const;

/* ---------- the runner hook: drives scripts with progress + cancel ---------- */
export function useScriptedDay(mode: DayMode | null) {
  const { dispatch } = useStore();
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    timers.current.forEach(t => window.clearTimeout(t));
    setLines([]); setDone(false);
    if (!mode) return;
    const ctx: LoopCtx = { dispatch, say: l => setLines(ls => [...ls, l]), tick: () => {} };
    for (const s of dayScriptFor(mode)) {
      timers.current.push(window.setTimeout(() => s.do(ctx), s.afterMs));
    }
    timers.current.push(window.setTimeout(() => setDone(true), dayScriptFor(mode).reduce((a, s) => Math.max(a, s.afterMs), 0) + 800));
    return () => timers.current.forEach(t => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  return { lines, done };
}
