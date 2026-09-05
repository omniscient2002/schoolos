/* ============================================================
   Service layer — the future API boundary.
   UI → services.* → mock repositories (today) | REST (later).
   Every call is async so the swap needs no UI changes.
   ============================================================ */
import * as seed from '../data/dataset';
import type { AiResponse, AiTrace, Person, WorkflowDef } from '../types/domain';

const LATENCY = () => 120 + Math.random() * 260;

async function ok<T>(value: T, opts?: { failRate?: number }): Promise<T> {
  await new Promise(r => setTimeout(r, LATENCY()));
  if (opts?.failRate && Math.random() < opts.failRate) throw new Error('Request failed (simulated)');
  return value;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/* ---------- People / directory ---------- */
export const peopleService = {
  async search(query: string, filters?: { campus?: string; type?: string; grade?: string }): Promise<Person[]> {
    const q = query.trim().toLowerCase();
    let pool: Person[] = [...seed.students, ...seed.teachers, ...seed.staff, ...seed.guardians];
    if (filters?.campus && filters.campus !== 'all') pool = pool.filter(p => p.campus === filters.campus);
    if (filters?.type && filters.type !== 'all') pool = pool.filter(p => p.type === filters.type);
    if (filters?.grade && filters.grade !== 'all') pool = pool.filter(p => p.type === 'student' && String(p.grade) === filters.grade);
    if (!q) return ok(pool.slice(0, 60));
    const words = q.split(/\s+/);
    const scored = pool.map(p => {
      const hay = `${p.name} ${p.email} ${p.rollNo ?? ''} ${p.role ?? ''} ${p.type}`.toLowerCase();
      const score = words.reduce((a, w) => a + (hay.includes(w) ? 1 : 0), 0);
      return { p, score };
    }).filter(x => x.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return ok(scored.slice(0, 60).map(x => x.p));
  },
  async student(id: string) { return ok(seed.students.find(s => s.id === id)); },
  async teacher(id: string) { return ok(seed.teachers.find(t => t.id === id)); },
  async guardiansOf(studentId: string) { return ok(seed.guardiansOfStudent(studentId)); },
  async feeSummary(studentId: string) { return ok(seed.studentFeeSummary(studentId)); },
  async attendance(studentId: string) { return ok(seed.studentAttendanceRate(studentId)); },
};

/* ---------- Fees ---------- */
export const feeService = {
  async obligations(campus: string) {
    let items = seed.feeObligations;
    if (campus !== 'all') {
      const ids = new Set(seed.students.filter(s => s.campus === campus).map(s => s.id));
      items = items.filter(f => ids.has(f.studentId));
    }
    return ok(items);
  },
  async payments(campus: string) {
    let items = seed.payments;
    if (campus !== 'all') {
      const ids = new Set(seed.students.filter(s => s.campus === campus).map(s => s.id));
      items = items.filter(p => ids.has(p.studentId));
    }
    return ok(items.slice(0, 400));
  },
  async simulatePayments(count = 5) { return ok({ created: count }); },
  async recordRetry(obligationId: string) {
    const f = seed.feeObligations.find(x => x.id === obligationId);
    if (f) { f.status = 'paid'; f.paidAmount = f.amount; f.paidOn = new Date(); f.method = 'UPI'; }
    return ok({ obligationId, status: 'paid' });
  },
};

/* ---------- Attendance ---------- */
export const attendanceService = {
  async today(sectionId: string) {
    const t = seed.TERM_DAYS[seed.TERM_DAYS.length - 1];
    return ok(seed.attendance.filter(a => a.sectionId === sectionId && a.date.getTime() === t.getTime()));
  },
  async mark(sectionId: string, entries: { studentId: string; status: 'present' | 'absent' | 'late' }[]) {
    return ok({ sectionId, marked: entries.length, event: 'attendance.marked', workflowTriggered: 'wf_1' });
  },
  async syncPending() { return ok({ synced: true }); },
};

/* ---------- Admissions ---------- */
export const admissionsService = {
  async leads(campus: string) {
    let items = seed.leads;
    if (campus !== 'all') items = items.filter(l => l.campus === campus);
    return ok(items);
  },
  async moveLead(leadId: string, stage: string) {
    const l = seed.leads.find(x => x.id === leadId);
    if (l) l.stage = stage as typeof l.stage;
    return ok({ leadId, stage });
  },
};

/* ---------- Transport ---------- */
export const transportService = {
  async routes(campus: string) {
    let items = seed.busRoutes;
    if (campus !== 'all') items = items.filter(r => r.campus === campus);
    return ok(items);
  },
  async simulateBreakdown(routeId = 'route_7') { return ok({ routeId, incident: 'inc_transport_new' }); },
};

/* ---------- AI ---------- */
const TRACE_BASE = {
  model: 'Frontier (reasoning) · ap-south-1',
  latencyMs: 820,
  tokens: 1240,
  cost: '₹0.11',
};

function trace(over: Partial<AiTrace>): AiTrace {
  return {
    trigger: 'User question in Ask panel',
    policy: 'Access follows your role permissions · Constitution v2026.1',
    dataUsed: ['attendance records', 'transport events', 'communication log'],
    reasoningRole: 'Investigator (read-only)',
    action: 'None — read-only analysis',
    approvalStatus: 'Not required (read-only)',
    verification: 'Numbers recomputed from records; every claim links to source',
    ...TRACE_BASE, ...over,
  };
}

export const aiService = {
  async ask(question: string, ctx?: { role?: string; page?: string; record?: string }): Promise<AiResponse> {
    void ctx;
    const q = question.toLowerCase();

    /* Maintenance & facilities branches (domain-specific, routed first) */
    const m = maintenanceAsk(question, 'all');
    if (m.handled && m.response) return ok(m.response);

    /* Absence / 8-B investigation */
    if (/absen|8-b|8b|attendance/.test(q)) {
      return ok({
        id: `ai_${Date.now()}`,
        answer: 'Grade 8-B presence is 23% today against a 93% ten-day average. This is not an illness pattern — it tracks the Bus 14 disruption almost exactly.',
        blocks: [
          { type: 'text', text: '15 of the 20 absentees are Route 7 (Bus 14) riders; the others include one reported fever. The dip begins at the same timestamp as the transport incident (07:42) — the class is effectively present-but-delayed.' },
          { type: 'chain', title: 'Evidence chain', steps: [
            { label: 'Attendance register 8-B', detail: '23% present (6 of 26) · 10-day average 94%', source: 'Attendance · today 08:40', refType: 'attendance' },
            { label: 'Transport deviation', detail: 'Bus 14 stationary 14 min past expected window · coolant leak confirmed 07:51', source: 'GPS monitor · incident inc_1', refType: 'transport' },
            { label: 'Route roster overlap', detail: '15 of 20 absent students ride Route 7 (38 students on route)', source: 'Transport roster', refType: 'transport' },
            { label: 'Parent messages', detail: '2 WhatsApp complaints about Bus 14 this morning (K. Sharma, R. Verma)', source: 'Communication log', refType: 'message' },
          ] },
          { type: 'note', text: 'Attendance leniency per Attendance §1.4 already applies to delayed routes until 09:30 — registers will self-correct as students arrive.' },
        ],
        suggestedActions: [
          { id: 'a1', label: 'Send reassurance message to 8-B parents', type: 'message', audience: 'Grade 8-B guardians', audienceCount: 24, channel: 'WhatsApp', posture: 'APPROVAL', draft: 'Dear Parents, we are aware Bus 14 is delayed today due to a mechanical issue near Sector 12. A spare bus has been arranged and students are being picked up. Attendance is being marked leniently until 9:30 and we will update you here. — Meridian Academy' },
          { id: 'a2', label: 'Keep transport incident open for review', type: 'investigate', detail: 'Links this attendance dip to inc_1 for the weekly review.' },
        ],
        trace: trace({ trigger: 'Principal question: absence anomaly', dataUsed: ['attendance records (8-B, 30 days)', 'transport GPS events (Route 7)', 'guardian message log (today)'], reasoningRole: 'Investigator (read-only) → Proposer (drafts only)' }),
      });
    }

    /* Fees */
    if (/fee|payment|collect|revenue/.test(q)) {
      return ok({
        id: `ai_${Date.now()}`,
        answer: 'Collection is 82.3% this week vs the 88% four-week average — a 4.7-point dip, fully explained by two identified clusters.',
        blocks: [
          { type: 'chain', title: 'Evidence chain', steps: [
            { label: 'Collection trend', detail: '14-day series: 88 → 82.3%', source: 'Fee ledger · recomputed', refType: 'fees' },
            { label: 'Failed payment cluster', detail: '47 failures · 41 on Route 7 households · avg ticket ₹57,457', source: 'Gateway + ledger diff', refType: 'fees' },
            { label: 'Gateway timeouts', detail: '23 successful UPI transactions missing ledger entries (11:00–11:40 yesterday)', source: 'Reconciliation worker', refType: 'case' },
          ] },
          { type: 'text', text: 'Reading: disruption-linked, not affordability-linked. Route 7 families had an abnormal week (Bus 14 breakdown). The 23 timeout transactions are administrative, not payment failures.' },
          { type: 'draft', title: 'Payment assistance message', audience: 'Guardians with failed Term-2 payments', channel: 'WhatsApp', language: 'English + Hindi template', body: 'Dear Parents, some Term 2 online payments did not go through this week (we noticed the Bus 14 disruption may have affected routines). You can safely retry via the link below, or reply here and our accounts team will call you. No late fee will apply for retries by Friday. — Meridian Accounts' },
        ],
        suggestedActions: [
          { id: 'f1', label: 'Send payment assistance message', type: 'message', audience: 'Guardians with failed payments', audienceCount: 41, channel: 'WhatsApp', posture: 'APPROVAL' },
          { id: 'f2', label: 'Retry failed UPI mandates', type: 'workflow', workflow: 'wf_4', posture: 'AUTO' },
        ],
        trace: trace({ trigger: 'Finance/Principal question: fee realization', dataUsed: ['fee ledger (14 days)', 'gateway settlement file', 'transport incident timeline'], reasoningRole: 'Investigator (read-only) → Proposer (draft only)' }),
      });
    }

    /* Student-specific */
    if (/aarav|this student|should i know/.test(q)) {
      return ok({
        id: `ai_${Date.now()}`,
        answer: 'Aarav Sharma (8-B) is having a strong term academically, with one operational watch item: transport reliability this week.',
        blocks: [
          { type: 'text', text: 'Attendance 96.7% this term (above class average). Mathematics mastery is “secure” on 7 of 9 skills; fractions (equivalent) is “developing” after Unit Test 1. No behavioural or wellbeing flags. Fee status: Term 2 payment failed during the gateway disruption — retry is one tap on the Fees screen. Guardian contacts verified.' },
          { type: 'chain', title: 'Watch item', steps: [
            { label: 'Bus 14 delays', detail: '3 mornings this week · arrivals 10–22 min late', source: 'Transport · Route 7', refType: 'transport' },
            { label: 'Late marks', detail: '2 late arrivals logged (Mon, Wed) — marked present under leniency policy', source: 'Attendance register', refType: 'attendance' },
          ] },
          { type: 'note', text: 'Nothing here requires action today. The transport watch item resolves with the Bus 14 repair (scheduled Saturday).' },
        ],
        suggestedActions: [{ id: 's1', label: 'Share mastery snapshot with guardian', type: 'message', audience: 'Kavita Sharma', channel: 'WhatsApp', posture: 'APPROVAL' }],
        trace: trace({ trigger: 'Student 360 briefing request', dataUsed: ['attendance (30d)', 'assessment scores (term)', 'fee ledger', 'transport log'], reasoningRole: 'Summarizer (read-only)' }),
      });
    }

    /* Routes/complaints */
    if (/route|bus|complain/.test(q)) {
      return ok({
        id: `ai_${Date.now()}`,
        answer: 'Route 7 generates the majority of transport complaints — 7 of 11 in 30 days, all involving Bus 14.',
        blocks: [
          { type: 'list', title: 'Complaints by route (30 days)', items: [ { label: 'Route 7 — Sector 12', detail: '7 cases · Bus 14' }, { label: 'Route 4 — Green Park', detail: '2 cases · pickup timing' }, { label: 'Route 2 — Sector 9', detail: '1 case' }, { label: 'Route 9 — Market', detail: '1 case' } ] },
          { type: 'text', text: 'Since the pre-route inspection decision (dec_4), Route 7 has had zero complaints in two school days. The repair + inspection combo appears to be working.' },
        ],
        suggestedActions: [{ id: 'r1', label: 'Review the transport decision on its due date', type: 'task', detail: 'Decision dec_4 review is scheduled in 27 days.' }],
        trace: trace({ trigger: 'Transport question', dataUsed: ['case records (30 days)', 'route roster', 'incident log'], reasoningRole: 'Investigator (read-only)' }),
      });
    }

    /* Default */
    return ok({
      id: `ai_${Date.now()}`,
      answer: 'Here is what I can see for your role and campus scope. Ask about attendance, fees, transport, a student, or anything on this page.',
      blocks: [
        { type: 'list', title: 'Live signals right now', items: [
          { label: '8-B attendance 23% today', detail: 'Linked to Bus 14 disruption', ref: '/attendance' },
          { label: 'Collection 82.3% this week', detail: 'Route 7 cluster + gateway timeouts', ref: '/fees' },
          { label: '3 items in your approval queue', detail: 'Concession · substitute · bulk message', ref: '/action-center' },
        ] },
      ],
      suggestedActions: [{ id: 'd1', label: 'Open Action Center', type: 'investigate', ref: undefined } as never].slice(0, 0),
      trace: trace({}),
    });
  },

  async draftStudentBriefing(studentId: string, _viewer: string): Promise<AiResponse> {
    void _viewer; void studentId;
    return ok({
      id: `ai_${Date.now()}`,
      answer: 'Strong term overall; one transport-linked watch item. No academic or wellbeing concerns.',
      blocks: [
        { type: 'text', text: 'Attendance 96.7% (above class average). Mathematics “secure” on 7/9 skills; equivalent-fractions “developing”. Term 2 payment failed in the gateway disruption — retry pending. Guardians verified. Bus 14 caused 2 late arrivals this week — logged under the leniency policy.' },
      ],
      suggestedActions: [],
      trace: trace({ trigger: 'Student 360 — “What should I know?”', dataUsed: ['attendance', 'assessments', 'fees', 'transport log'], reasoningRole: 'Summarizer (read-only)' }),
    });
  },
};

/* ---------- Workflows ---------- */
export const workflowService = {
  async list() { return ok(seed.workflows); },
  async runs() { return ok(seed.workflowRuns); },
  async toggle(id: string, enabled: boolean) {
    const w = seed.workflows.find(x => x.id === id); if (w) w.enabled = enabled;
    return ok({ id, enabled });
  },
  async compileFromNaturalLanguage(text: string): Promise<WorkflowDef> {
    const lower = text.toLowerCase();
    const steps: WorkflowStepType[] = [];
    const name = text.length > 58 ? text.slice(0, 55) + '…' : text;
    steps.push({ id: 'c1', type: 'condition', label: 'Guardian verified & policy allows AUTO', detail: 'Constitution guardrails applied automatically' });
    if (/teacher/.test(lower)) steps.push({ id: 'n1', type: 'notify', label: 'Notify class teacher', detail: 'Task includes pattern + contacts' });
    if (/parent|guardian/.test(lower)) steps.push({ id: 'n2', type: 'notify', label: 'Notify guardian', detail: 'Template per Communication policy' });
    if (/task|follow/.test(lower)) steps.push({ id: 't1', type: 'task', label: 'Create follow-up task', detail: 'Owner: class teacher · SLA 48h' });
    if (steps.length === 1) steps.push({ id: 'n0', type: 'notify', label: 'Notify owner', detail: 'Default: record owner' });
    steps.push({ id: 'a1', type: 'approval', label: 'First 3 runs: observe-only', detail: 'Shadow mode before AUTO' });
    const def: WorkflowDef = {
      id: `wf_nl_${Date.now()}`, name, description: `Compiled from: “${text}”`,
      trigger: { event: 'attendance.pattern.detected', label: '3 absences within 2 weeks', condition: 'Not pre-approved leave' },
      steps, enabled: false, runsThisMonth: 0, source: 'nl', posture: 'AUTO',
    };
    return ok(def);
  },
};
type WorkflowStepType = WorkflowDef['steps'][number];

/* ---------- Memory ---------- */
export const memoryService = {
  async searchDecisions(q: string) {
    const query = q.toLowerCase();
    return ok(seed.decisions.filter(d => !query || `${d.title} ${d.context} ${d.policy}`.toLowerCase().includes(query)));
  },
  async everything() { return ok({ decisions: seed.decisions, meetings: seed.meetings, docs: seed.memoryDocs }); },
};

/* ---------- Action Center ---------- */
export const actionService = {
  async list() { return ok(seed.actionItems); },
};

/* ============================================================
   Maintenance & Facilities Operations
   ============================================================ */
import type { WorkOrderRecord, WOCategory, WOStatus, AssetRecord, CampusId, MaintPriority } from '../types/domain';
import {
  assets as mAssets, workOrders as mWOs, technicians as mTechs, maintPlans, inspections,
  inventory as mInventory, vendors as mVendors, recommendTechnicians, replacementView,
  maintAnalytics, openWorkOrders, slaState, SLA_POLICY,
} from '../data/dataset';

/* mutable runtime copies — mock "persistence" */
const woStore: WorkOrderRecord[] = [...mWOs];
const assetStore: AssetRecord[] = mAssets.map(a => ({ ...a }));
const inventoryStore = mInventory.map(i => ({ ...i, pendingRequests: i.pendingRequests ? [...i.pendingRequests] : [] }));
let woCounter = 1046;

const pushEvent = (label: string, severity: 'info' | 'warn' | 'critical', type: string, ref?: string) => {
  try { window.dispatchEvent(new CustomEvent('schoolos:live-event', { detail: { label, severity, type, ref } })); } catch { /* noop */ }
};

const INSIGHT_CACHE: { question: string; answer: string }[] = [];

export const maintenanceService = {
  async overview(campus: CampusId | 'all') {
    return ok({
      analytics: maintAnalytics(campus),
      open: openWorkOrders(campus),
      slaRisk: openWorkOrders(campus).map(w => ({ wo: w, sla: slaState(w) })).filter(x => x.sla.tone === 'danger' || x.sla.tone === 'warning'),
      assets: assetStore,
      plans: maintPlans,
    });
  },
  async workOrders(campus: CampusId | 'all') { return ok(woStore.filter(w => campus === 'all' || w.campus === campus)); },
  async workOrder(id: string) { return ok(woStore.find(w => w.id === id) ?? null); },
  async technicians(campus: CampusId | 'all') { return ok(mTechs.filter(t => campus === 'all' || t.campus === campus)); },
  async recommend(category: WOCategory, campus: CampusId) { return ok(recommendTechnicians(category, campus)); },
  async assets(campus: CampusId | 'all') { return ok(assetStore.filter(a => campus === 'all' || a.campus === campus)); },
  async asset(id: string) { return ok(assetStore.find(a => a.id === id) ?? null); },
  async replacement(id: string) { const a = assetStore.find(x => x.id === id); return ok(a ? replacementView(a) : null); },
  async plans() { return ok(maintPlans); },
  async inspections() { return ok(inspections); },
  async inventory() { return ok(inventoryStore); },
  async vendors() { return ok(mVendors); },

  /* "Tell us what happened." → AI understanding → work order */
  async createFromReport(input: { text: string; source: WorkOrderRecord['source']; reporter: string; reporterRole: WorkOrderRecord['reportedRole']; campus: CampusId; assetId?: string; photoAttached?: boolean }): Promise<{ data: WorkOrderRecord | null; error?: string }> {
    await sleep(900);
    const text = input.text.trim();
    if (text.length < 4) return { data: null, error: 'Tell us a little more — where is it and what happened?' };
    const q = text.toLowerCase();

    /* deterministic extraction over the asset register */
    const words = q.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
    const stop = new Set(['the','a','an','is','are','in','on','not','and','to','of','it','its','room','lab','science']);
    let best: { asset: AssetRecord; hits: number } | null = null;
    for (const a of assetStore) {
      const hay = `${a.name} ${a.room} ${a.building} ${a.id} ${a.manufacturer} ${a.model} ${a.category}`.toLowerCase();
      const hits = words.filter(w => w.length > 2 && !stop.has(w) && hay.includes(w)).length;
      if (hits > 0 && (!best || hits > best.hits)) best = { asset: a, hits };
    }
    let roomMention: string | undefined;
    const roomM = text.match(/\b(?:room|lab)\s*(\d{3}|[a-z0-9-]{1,4})\b/i);
    if (roomM) roomMention = roomM[1];
    const asset = (input.assetId ? assetStore.find(a => a.id === input.assetId) : undefined) ?? best?.asset;

    const safety = /spark|smoke|fire|shock|leak.*electric|gas|entrap|trapped|short circuit/.test(q);
    const category: WOCategory =
      /ac|cooling|hvac|air ?condition|warm/.test(q) ? 'HVAC' :
      /projector|screen|audio|speaker|mic|av |tv|display/.test(q) ? 'AV' :
      /light|tube|fan|switch|socket|power|electric|choke/.test(q) ? 'Electrical' :
      /leak|tap|toilet|washroom|water|drain|pipe|cooler/.test(q) ? 'Plumbing' :
      /lift|elevator|fire|extinguisher|alarm/.test(q) ? 'Safety' :
      /desk|chair|door|window|wall|ceiling|paint/.test(q) ? 'Civil' : 'Cleanliness';

    const affected = /class|period|students|exam/.test(q) ? 30 : safety ? 40 : 5;
    const severity: MaintPriority = safety ? 'emergency'
      : asset?.category === 'Water' && category === 'Plumbing' ? 'critical'
      : /class|period|exam|not turning|no power|dead/.test(q) ? 'high'
      : /flicker|slow|noisy|minor|cosmetic/.test(q) ? 'low' : 'medium';
    const now = new Date();
    const wo: WorkOrderRecord = {
      id: `WO-${woCounter++}`, title: text.length > 70 ? text.slice(0, 67) + '…' : text,
      description: text, source: input.source, category,
      assetId: asset?.id, campus: asset?.campus ?? input.campus,
      building: asset?.building ?? '—', room: asset?.room ?? roomMention,
      priority: severity, status: 'reported',
      reportedBy: input.reporter, reportedRole: input.reporterRole, reportedOn: now,
      sla: {
        responseMins: SLA_POLICY[severity].responseMins, resolveMins: SLA_POLICY[severity].resolveMins,
        responseBy: new Date(now.getTime() + SLA_POLICY[severity].responseMins * 60000),
        resolveBy: new Date(now.getTime() + SLA_POLICY[severity].resolveMins * 60000),
      },
      aiUnderstanding: {
        category,
        assetMatch: asset ? { assetId: asset.id, confidence: best && best.asset === asset ? Math.min(0.97, 0.6 + best.hits * 0.12) : 0.75 } : undefined,
        severity, safetyRelevant: safety,
        urgency: safety ? 'immediate' : affected >= 30 ? 'today' : 'this-week',
        affectedPeople: affected,
        suggestedSkill: category === 'AV' ? 'AV systems' : category === 'HVAC' ? 'HVAC level-3' : category === 'Plumbing' ? 'Plumbing level-2' : category === 'Safety' ? 'Fire & safety systems' : 'Electrical safety',
        confidence: asset ? 0.92 : 0.68,
        reasoning: [
          asset ? `Asset register match: ${asset.id} (${asset.name})${best && best.asset === asset ? ' · ' + Math.round(Math.min(0.97, 0.6 + best.hits * 0.12) * 100) + '%' : ''}` : 'No exact asset match — routed by location text',
          `Category from language: ${category}${safety ? ' · safety-relevant phrase detected' : ''}`,
          affected >= 30 ? 'During teaching hours → learning impact counted' : 'Low occupancy impact estimated',
          `Priority rule applied: ${severity} → respond ${SLA_POLICY[severity].responseMins} min · resolve ${SLA_POLICY[severity].resolveMins / 60}h`,
        ],
      },
      priorityFactors: [
        { factor: safety ? 'Safety risk' : 'Learning impact', weight: safety ? 40 : affected >= 30 ? 28 : 10, note: safety ? 'Safety-relevant phrase in report' : affected >= 30 ? 'Reported during teaching hours' : 'Single-room impact' },
        { factor: 'Asset criticality', weight: asset?.criticality === 'high' ? 22 : asset ? 10 : 4, note: asset ? `${asset.id} is ${asset.criticality}-criticality` : 'No registered asset linked' },
        { factor: 'Recurrence', weight: asset && asset.failures.length >= 3 ? 14 : 4, note: asset && asset.failures.length >= 3 ? `${asset.failures.length} prior failures on this asset` : 'No recurrence signal' },
      ],
      timeline: [
        { on: now, actor: input.reporter, note: `Reported via ${input.source}${input.photoAttached ? ' · photo attached' : ''}: “${text}”`, kind: 'note' },
        { on: now, actor: 'SchoolOS', note: `Understood: ${category} · ${asset ? asset.id : 'no asset match'} · priority ${severity.toUpperCase()} · needs ${'“' + (category === 'AV' ? 'AV systems' : 'skilled technician') + '”'}`, kind: 'ai' },
      ],
    };
    woStore.unshift(wo);
    INSIGHT_CACHE.unshift({ question: `New ${severity} report — ${wo.title}`, answer: `Reported by ${input.reporter}. ${asset ? `Linked to ${asset.id}.` : ''} Priority ${severity} per SLA policy.` });
    pushEvent(`New maintenance report — ${wo.id} · ${category}`, severity === 'emergency' ? 'critical' : severity === 'critical' ? 'warn' : 'info', 'maintenance', wo.id);
    return { data: wo };
  },

  /* work-order state machine — the deterministic core */
  async advance(id: string, to: WOStatus, actor: string, note?: string, extra?: Partial<WorkOrderRecord>) {
    await sleep(420);
    const wo = woStore.find(w => w.id === id);
    if (!wo) return { data: null, error: 'Work order not found' };
    wo.status = to;
    const now = new Date();
    if (to === 'assigned' && !wo.assignedOn) { wo.assignedOn = now; }
    if (to === 'accepted' && !wo.acceptedOn) { wo.acceptedOn = now; if (!wo.respondedOn) wo.respondedOn = now; }
    if (to === 'en-route') pushEvent(`${wo.assignedTo ?? 'Technician'} en route — ${wo.id}`, 'info', 'maintenance', wo.id);
    if (to === 'on-site' && !wo.startedOn) { wo.startedOn = now; pushEvent(`${wo.assignedTo ?? 'Technician'} on site — ${wo.id}`, 'info', 'maintenance', wo.id); }
    if (to === 'repairing' && !wo.startedOn) wo.startedOn = now;
    if (to === 'verification' && !wo.completedOn) {
      wo.completedOn = now;
      wo.slaBreached = now.getTime() > wo.sla.resolveBy.getTime();
      pushEvent(`Repair complete, awaiting verification — ${wo.id}${wo.slaBreached ? ' · SLA breached' : ' · within SLA'}`, wo.slaBreached ? 'warn' : 'info', 'maintenance', wo.id);
    }
    if (to === 'resolved') {
      pushEvent(`Verified & resolved — ${wo.id}`, 'info', 'maintenance', wo.id);
      if (wo.assetId) {
        const a = assetStore.find(x => x.id === wo.assetId);
        if (a) {
          a.status = 'operational';
          a.failures = a.failures.filter(f => f.workOrderId !== wo.id);
          if (!a.failures.some(f => f.workOrderId === wo.id) && wo.resolution) {
            a.failures.push({ on: wo.reportedOn, summary: wo.resolution.summary, cost: woSpendOf(wo), workOrderId: wo.id });
          }
          a.repairSpendYTD += woSpendOf(wo);
          a.health = Math.min(100, a.health + 6);
        }
      }
    }
    wo.timeline.push({ on: now, actor, note: note ?? `Status → ${to}`, kind: to === 'repairing' ? 'status' : 'status' });
    Object.assign(wo, extra ?? {});
    return { data: wo };
  },

  async assign(id: string, techName: string, actor: string) {
    const wo = woStore.find(w => w.id === id);
    if (!wo) return { data: null, error: 'Work order not found' };
    return this.advance(id, 'assigned', actor, `Assigned to ${techName} — skill match + availability`, { assignedTo: techName });
  },

  async complete(id: string, actor: string, payload: { resolution: string; rootCause: string; parts?: { inventoryId: string; name: string; qty: number; cost: number }[]; labourMins?: number; preventiveNote?: string }) {
    const wo = woStore.find(w => w.id === id);
    if (!wo) return { data: null, error: 'Work order not found' };
    const res = await this.advance(id, 'verification', actor, `Completed: ${payload.resolution}`, {
      partsUsed: payload.parts, labourMins: payload.labourMins,
      resolution: { summary: payload.resolution, rootCause: payload.rootCause, preventiveNote: payload.preventiveNote },
      photos: [...(wo.photos ?? []), { stage: 'after' as const, note: 'After-photo captured at completion', on: new Date() }],
    });
    if (res.data) {
      (payload.parts ?? []).forEach(p => {
        const inv = inventoryStore.find(i => i.id === p.inventoryId);
        if (inv) { inv.stock = Math.max(0, inv.stock - p.qty); inv.consumed30d += p.qty; }
      });
    }
    return res;
  },

  async addVoiceNote(id: string, transcript: string, actor: string) {
    await sleep(700);
    const wo = woStore.find(w => w.id === id);
    if (!wo) return { data: null, error: 'Work order not found' };
    wo.voiceNotes = [...(wo.voiceNotes ?? []), { transcript, on: new Date(), parsed: true }];
    wo.timeline.push({ on: new Date(), actor, note: `Voice note parsed: “${transcript}”`, kind: 'voice' });
    return { data: wo };
  },

  async rate(id: string, stars: number, note?: string) {
    await sleep(300);
    const wo = woStore.find(w => w.id === id);
    if (!wo) return { data: null, error: 'Work order not found' };
    wo.reporterRating = stars;
    if (note) wo.verificationNote = note;
    wo.status = 'closed';
    wo.timeline.push({ on: new Date(), actor: wo.reportedBy, note: `Reporter confirmed fix · ${stars}★${note ? ` · “${note}”` : ''}`, kind: 'status' });
    return { data: wo };
  },
};

function woSpendOf(wo: WorkOrderRecord) { return (wo.partsUsed ?? []).reduce((a, p) => a + p.cost, 0) + Math.round(((wo.labourMins ?? 0) * 2)); }

/* Ask-SchoolOS maintenance branches — exported for aiService routing */
export function maintenanceAsk(q: string, campus: CampusId | 'all'): { handled: boolean; response?: AiResponse } {
  const t = q.toLowerCase();
  const scope = campus === 'all' ? 'across all campuses' : campus === 'north' ? 'North campus' : campus === 'city' ? 'City campus' : 'East campus';
  const open = openWorkOrders(campus);
  const analytics = maintAnalytics(campus);

  if (/maintenance|work order|repair|fix|technician|asset|broken|facilit/.test(t)) {
    if (/which assets?.*(unreliab|failing|worris|risk)|reliab/.test(t) || /unreliable/.test(t)) {
      const risky = assetStore.filter(a => campus === 'all' || a.campus === campus).sort((a, b) => a.health - b.health).slice(0, 3);
      return { handled: true, response: {
        id: `ai_${Date.now()}`,
        answer: `${risky.length} assets are trending unreliable ${scope}. The clearest case is ${risky[0]?.id} (${risky[0]?.name}) — health ${risky[0]?.health}/100.`,
        blocks: [
          { type: 'text', text: risky.map(a => `${a.id} · health ${a.health} · ${a.failures.length} failure${a.failures.length === 1 ? '' : 's'} · ₹${a.repairSpendYTD.toLocaleString('en-IN')} spent this year`).join('. ') + '.' },
          { type: 'chain', title: 'Evidence chain', steps: risky.slice(0, 2).flatMap(a => [
            { label: `${a.id} failure history`, detail: a.failures.map(f => f.summary).slice(0, 2).join(' · ') || 'no failures logged', source: 'Asset register', refType: 'maintenance' },
            { label: `${a.id} health factors`, detail: a.healthFactors.map(f => f.note).join(' · '), source: 'Health model · deterministic factors', refType: 'maintenance' },
          ]) },
          { type: 'note', text: 'Health scores are computed from logged failures, spend, age and preventive adherence — not a predictive model. Replacement evaluation is shown on each asset page when spend crosses 20% of replacement cost.' },
        ],
        suggestedActions: [
          { id: 'm1', label: `Open ${risky[0]?.id ?? 'asset'} history`, type: 'investigate', detail: 'Review failure pattern and last two repairs', posture: 'HUMAN-ONLY' },
          { id: 'm2', label: 'Review preventive plan for this asset', type: 'workflow', detail: 'Tighten interval if pattern repeats', posture: 'APPROVAL' },
        ],
        trace: { ...traceBase('maintenance'), trigger: 'Question: unreliable assets', dataUsed: ['asset register', 'work-order history', 'preventive plan adherence'], model: 'Fast (classification) · ap-south-1' },
      } };
    }
    if (/keep failing|why.*fail|repeat/.test(t) && /ac|air|hvac|lab|cooling|science/.test(t)) {
      const a = assetStore.find(x => x.id === 'NOR-AC-04')!;
      return { handled: true, response: {
        id: `ai_${Date.now()}`,
        answer: `NOR-AC-04 has had 4 cooling-related failures in 63 days; 3 needed component intervention. Repair spend is ₹${a.repairSpendYTD.toLocaleString('en-IN')} this year — 25% of replacement cost.`,
        blocks: [
          { type: 'text', text: 'Pattern: capacitor (day 0) → filter blockage (day 22) → gas loss (day 39) → breaker trips (day 59). Escalating component depth on an 8-year-old unit is the classic end-of-life curve. The current repair (WO-1042) is a gas top-up — a third refrigerant intervention on the same unit.' },
          { type: 'chain', title: 'Evidence chain', steps: a.failures.map(f => ({ label: f.summary.split('—')[0].trim(), detail: `${f.summary} · ₹${f.cost.toLocaleString('en-IN')} · ${f.workOrderId ?? 'no WO link'}`, source: `Asset register · ${f.on.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, refType: 'maintenance' })) },
          { type: 'note', text: 'Recommendation (human decision): schedule a full inspection with the vendor and open a replacement evaluation. The evaluation is rule-based — spend ratio, failure count, age — not a predictive model.' },
        ],
        suggestedActions: [
          { id: 'm1', label: 'Open AC-04 replacement evaluation', type: 'investigate', posture: 'HUMAN-ONLY' },
          { id: 'm2', label: 'Tighten preventive interval to 60 days', type: 'workflow', detail: 'Currently quarterly; corrosion + age suggest tighter cycles', posture: 'APPROVAL' },
        ],
        trace: { ...traceBase('maintenance'), trigger: 'Question: repeat failure investigation', dataUsed: ['asset failure history', 'work-order ledger', 'preventive plan adherence'] },
      } };
    }
    if (/cost|spend|budget|increase/.test(t)) {
      const byB = analytics.byBuilding[0];
      return { handled: true, response: {
        id: `ai_${Date.now()}`,
        answer: `Maintenance spend ${scope} is ₹${analytics.spend.toLocaleString('en-IN')} across open and recent work orders. The largest concentration is ${byB?.building ?? '—'} (₹${(byB?.spend ?? 0).toLocaleString('en-IN')}).`,
        blocks: [
          { type: 'text', text: `Breakdown: ${analytics.byBuilding.slice(0, 3).map(b => `${b.building} ₹${b.spend.toLocaleString('en-IN')}`).join(' · ')}. Repeat repairs on NOR-AC-04 account for ₹18,400 — 4 visits in 63 days.` },
          { type: 'chain', title: 'Evidence chain', steps: [
            { label: 'Parts + labour by work order', detail: analytics.byBuilding.slice(0, 3).map(b => `${b.building}: ₹${b.spend.toLocaleString('en-IN')}`).join(' · '), source: 'Work orders WO-0986…WO-1045', refType: 'maintenance' },
            { label: 'Repeat-failure concentration', detail: 'NOR-AC-04: 4 failures · ₹18,400 YTD · 25% of replacement cost', source: 'Asset register', refType: 'maintenance' },
          ] },
          { type: 'note', text: 'The recurring AC repairs, not new incidents, are driving the increase. A replacement evaluation is already flagged on the asset page.' },
        ],
        suggestedActions: [{ id: 'm1', label: 'Open AC-04 replacement evaluation', type: 'investigate', posture: 'HUMAN-ONLY' }],
        trace: { ...traceBase('maintenance'), trigger: 'Question: maintenance cost increase', dataUsed: ['work-order ledger', 'asset repair history'] },
      } };
    }
    if (/sla|breach|late|about to/.test(t)) {
      const atRisk = open.map(w => ({ w, s: slaState(w) })).filter(x => x.s.tone === 'danger');
      return { handled: true, response: {
        id: `ai_${Date.now()}`,
        answer: atRisk.length ? `${atRisk.length} open job${atRisk.length === 1 ? '' : 's'} ${scope} are at or past SLA. The most urgent: ${atRisk[0].w.id} — ${atRisk[0].s.label}.` : `No SLA risk right now ${scope}. All open jobs are inside their response and resolution windows.`,
        blocks: [
          { type: 'text', text: atRisk.map(x => `${x.w.id} · ${x.w.title} · ${x.s.label}`).join('. ') || 'Closest to the line: WO-1045 (projector, High) — 21h of resolution window left.' },
          { type: 'chain', title: 'Evidence chain', steps: atRisk.slice(0, 2).map(x => ({ label: x.w.id, detail: `${x.w.title} · priority ${x.w.priority.toUpperCase()} · reported ${fmtRel(x.w.reportedOn)}`, source: 'SLA engine · deterministic policy', refType: 'maintenance' })) },
        ],
        suggestedActions: [{ id: 'm1', label: 'Open Maintenance board', type: 'investigate', detail: 'Reassign or escalate at-risk jobs', posture: 'HUMAN-ONLY' }],
        trace: { ...traceBase('maintenance'), trigger: 'Question: SLA risk', dataUsed: ['open work orders', 'SLA policy table'] },
      } };
    }
    /* default maintenance overview answer */
    const worst = open.find(w => w.priority === 'emergency' || w.priority === 'critical') ?? open[0];
    return { handled: true, response: {
      id: `ai_${Date.now()}`,
      answer: worst
        ? `${open.length} open maintenance jobs ${scope}. What needs you first: ${worst.id} — ${worst.title} (${worst.priority.toUpperCase()}).`
        : `No open maintenance jobs ${scope} — everything reported is resolved and verified.`,
      blocks: [
        { type: 'text', text: open.slice(0, 4).map(w => `${w.id} · ${w.title} · ${w.status.replace('-', ' ')} · ${w.priority.toUpperCase()}`).join('. ') },
        { type: 'chain', title: 'Evidence chain', steps: open.slice(0, 3).map(w => ({ label: w.id, detail: `${w.title} · ${w.building}${w.room ? ' · ' + w.room : ''}`, source: `Reported by ${w.reportedBy} · ${fmtRel(w.reportedOn)}`, refType: 'maintenance' })) },
        { type: 'note', text: `SLA compliance is ${analytics.slaPct}% this cycle; ${analytics.pmOverdue} preventive plan${analytics.pmOverdue === 1 ? ' is' : 's are'} overdue.` },
      ],
      suggestedActions: [
        { id: 'm1', label: 'Open Maintenance board', type: 'investigate', posture: 'HUMAN-ONLY' },
        { id: 'm2', label: 'Report an issue', type: 'task', detail: 'Fast report flow — describe it in one line', posture: 'AUTO' },
      ],
      trace: { ...traceBase('maintenance'), trigger: 'Question: maintenance overview', dataUsed: ['open work orders', 'SLA engine', 'preventive plans'] },
    } };
  }
  return { handled: false };
}

function fmtRel(d: Date) {
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}
function traceBase(kind: string) {
  return {
    policy: 'Read-only analysis; recommendations never auto-execute · Constitution v2026.1',
    reasoningRole: 'Investigator (read-only)',
    action: 'None — read-only analysis',
    approvalStatus: 'Not required (read-only)',
    verification: 'Figures recomputed from work-order and asset records',
    model: 'Fast (classification) · ap-south-1',
    latencyMs: 640, tokens: 880, cost: '₹0.06',
    dataUsed: [`${kind} records`],
  };
}
