/* ============================================================
   DEMO seed services — the offline sample plane. NOT the API boundary.
   ------------------------------------------------------------
   FEX-2: this module performs no HTTP. It returns illustrative fixtures
   built from the server-owned seed dataset so demo/offline screens have
   something coherent to render. It lives under demo/ (not services/) so
   it can never be mistaken for a transport, and every live screen that
   uses it must label the result as sample data. Real doors live in
   services/liveApi.ts and the per-surface wrappers beside it.
   ============================================================ */
import * as seed from '../data/dataset';
import type { Person, WorkflowDef } from '../types/domain';

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
  async attendance(studentId: string) { return ok(seed.studentAttendanceRate(studentId)); }};

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
  }};

/* ---------- Attendance ---------- */
export const attendanceService = {
  async today(sectionId: string) {
    const t = seed.TERM_DAYS[seed.TERM_DAYS.length - 1];
    return ok(seed.attendance.filter(a => a.sectionId === sectionId && a.date.getTime() === t.getTime()));
  },
  async mark(sectionId: string, entries: { studentId: string; status: 'present' | 'absent' | 'late' }[]) {
    return ok({ sectionId, marked: entries.length, event: 'attendance.marked', workflowTriggered: 'wf_1' });
  },
  async syncPending() { return ok({ synced: true }); }};

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
  }};

/* ---------- Transport ---------- */
export const transportService = {
  async routes(campus: string) {
    let items = seed.busRoutes;
    if (campus !== 'all') items = items.filter(r => r.campus === campus);
    return ok(items);
  },
  async simulateBreakdown(routeId = 'route_7') { return ok({ routeId, incident: 'inc_transport_new' }); }};

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
      steps, enabled: false, runsThisMonth: 0, source: 'nl', posture: 'AUTO'};
    return ok(def);
  }};
type WorkflowStepType = WorkflowDef['steps'][number];

/* ---------- Memory ---------- */
export const memoryService = {
  async searchDecisions(q: string) {
    const query = q.toLowerCase();
    return ok(seed.decisions.filter(d => !query || `${d.title} ${d.context} ${d.policy}`.toLowerCase().includes(query)));
  },
  async everything() { return ok({ decisions: seed.decisions, meetings: seed.meetings, docs: seed.memoryDocs }); }};

/* ---------- Action Center ---------- */
export const actionService = {
  async list() { return ok(seed.actionItems); }};

/* ============================================================
   Maintenance & Facilities Operations
   ============================================================ */
import type { WorkOrderRecord, WOCategory, WOStatus, AssetRecord, CampusId, MaintPriority } from '../types/domain';
import {
  assets as mAssets, workOrders as mWOs, technicians as mTechs, maintPlans, inspections,
  inventory as mInventory, vendors as mVendors, recommendTechnicians, replacementView,
  maintAnalytics, openWorkOrders, slaState, SLA_POLICY} from '../data/dataset';

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
      plans: maintPlans});
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
        resolveBy: new Date(now.getTime() + SLA_POLICY[severity].resolveMins * 60000)},
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
          `Priority rule applied: ${severity} → respond ${SLA_POLICY[severity].responseMins} min · resolve ${SLA_POLICY[severity].resolveMins / 60}h`]},
      priorityFactors: [
        { factor: safety ? 'Safety risk' : 'Learning impact', weight: safety ? 40 : affected >= 30 ? 28 : 10, note: safety ? 'Safety-relevant phrase in report' : affected >= 30 ? 'Reported during teaching hours' : 'Single-room impact' },
        { factor: 'Asset criticality', weight: asset?.criticality === 'high' ? 22 : asset ? 10 : 4, note: asset ? `${asset.id} is ${asset.criticality}-criticality` : 'No registered asset linked' },
        { factor: 'Recurrence', weight: asset && asset.failures.length >= 3 ? 14 : 4, note: asset && asset.failures.length >= 3 ? `${asset.failures.length} prior failures on this asset` : 'No recurrence signal' }],
      timeline: [
        { on: now, actor: input.reporter, note: `Reported via ${input.source}${input.photoAttached ? ' · photo attached' : ''}: “${text}”`, kind: 'note' },
        { on: now, actor: 'SchoolOS', note: `Understood: ${category} · ${asset ? asset.id : 'no asset match'} · priority ${severity.toUpperCase()} · needs ${'“' + (category === 'AV' ? 'AV systems' : 'skilled technician') + '”'}`, kind: 'ai' }]};
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
      photos: [...(wo.photos ?? []), { stage: 'after' as const, note: 'After-photo captured at completion', on: new Date() }]});
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
  }};

function woSpendOf(wo: WorkOrderRecord) { return (wo.partsUsed ?? []).reduce((a, p) => a + p.cost, 0) + Math.round(((wo.labourMins ?? 0) * 2)); }

