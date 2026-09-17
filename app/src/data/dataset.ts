/* ============================================================
   The dataset — the demo domain, fetched from the server.
   The server owns the deterministic data (esbuild bundles of the
   original generators, see server/src/generated/). This module:
   1. fetches GET /dataset once,
   2. revives ISO date strings into Date instances (keyed by name),
   3. re-ports the helper functions the UI relies on, operating
      over the fetched data (pure functions of the dataset).
   Every former `data/dataset` / `data/dataset` / `data/dataset`
   / `data/dataset` import maps to this module.
   ============================================================ */
import { apiDataset, getToken } from '../services/liveApi';
import type {
  Person, GuardianLink, FeeObligation, Payment, AttendanceRecord, Section, TimeSlot, Lead,
  BusRoute, SchoolCase, ActionRecord, DecisionRecord, MeetingNote, MemoryDoc, PolicyRule,
  WorkflowDef, WorkflowRun, Obligation, CalendarEvent, HealthIssue, Notification, AuditEntry,
  Insight, VisitorEntry, GatePass, DeskIntent, Scenario, Campus, ChatMsg,
  AssetRecord, ReceptionCall, FrontDeskSettings, DocRecord, IncidentRecord, CampusId, WOCategory,
  WorkOrderRecord, TechnicianRecord, MaintPlan, InspectionRecord, InventoryItem, VendorRecord,
  MaintPriority,
} from '../types/domain';

type AnyRec = Record<string, unknown>;


const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/* T304 (D-5): the /dataset payload — especially the empty-world variant, where
   the server blanks every seed-derived key — may OMIT any key. Every binding
   below is therefore coerced through these helpers: a missing or mistyped key
   yields an empty structure, never undefined, and no code in this module (or
   in state/store.tsx) may `!`-assert a dataset-derived value. */
function arr<T>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }
function rec<T extends object>(v: unknown, fallback: T): T {
  return (v != null && typeof v === 'object' && !Array.isArray(v)) ? (v as T) : fallback;
}
function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

function revive(value: unknown, key: string | null, depth = 0): unknown {
  /* ISO-UTC strings become Dates anywhere they appear — including bare string arrays. */
  if (typeof value === 'string' && ISO_RE.test(value)) return new Date(value);
  if (value == null || typeof value !== 'object' || depth > 12) return value;
  if (Array.isArray(value)) return value.map(v => revive(v, key, depth + 1));
  const out: AnyRec = {};
  for (const [k, v] of Object.entries(value)) out[k] = revive(v, k, depth + 1);
  return out;
}

/* Dataset state — populated by ensureDataset() after authentication.
   Exports are live `let` bindings: screens re-read them at render time,
   which only happens once AuthGate has both a /me-validated session AND
   a hydrated dataset. */
let data: AnyRec = {};
let hydrated = false;
let loading: Promise<void> | null = null;

export function datasetReady(): boolean { return hydrated; }

export async function ensureDataset(): Promise<void> {
  if (hydrated) return;
  if (loading) return loading;
  loading = (async () => {
    // The endpoint requires auth. FEX-3: the bearer is in memory, so wait for THIS session's token (set by
    // login or by the /auth/renew exchange) rather than for a persisted localStorage value.
    for (let i = 0; i < 200 && !getToken(); i++) {
      await new Promise(r => setTimeout(r, 250));
    }
    const raw = (await apiDataset()) as AnyRec;
    data = revive(raw, null) as AnyRec;
    hydrated = true;
    /* T304 (D-5): every binding coerced — a key the server removed or blanked
       leaves the export at its empty default instead of poisoning it with
       undefined. */
    campuses = arr<Campus>(data.campuses);
    TERM_DAYS = arr<Date>(data.TERM_DAYS);
    students = arr<Person>(data.students);
    teachers = arr<Person>(data.teachers);
    staff = arr<Person>(data.staff);
    guardians = arr<Person>(data.guardians);
    guardianLinks = arr<Link>(data.guardianLinks);
    sections = arr<Section>(data.sections);
    timetable = arr<TimeSlot>(data.timetable);
    busRoutes = arr<BusRoute>(data.busRoutes);
    attendance = arr<AttendanceRecord>(data.attendance);
    feeObligations = arr<FeeObligation>(data.feeObligations);
    payments = arr<Payment>(data.payments);
    leads = arr<Lead>(data.leads);
    documents = arr<DocRecord>(data.documents);
    incidents = arr<IncidentRecord>(data.incidents);
    cases = arr<SchoolCase>(data.cases);
    actionItems = arr<ActionRecord>(data.actionItems);
    decisions = arr<DecisionRecord>(data.decisions);
    meetings = arr<MeetingNote>(data.meetings);
    memoryDocs = arr<MemoryDoc>(data.memoryDocs);
    policies = arr<PolicyRule>(data.policies);
    workflows = arr<WorkflowDef>(data.workflows);
    workflowRuns = arr<WorkflowRun>(data.workflowRuns);
    obligations = arr<Obligation>(data.obligations);
    calendarEvents = arr<CalendarEvent>(data.calendarEvents);
    healthIssues = arr<HealthIssue>(data.healthIssues);
    notifications = arr<Notification>(data.notifications);
    auditEntries = arr<AuditEntry>(data.auditEntries);
    insights = arr<Insight>(data.insights);
    aiUsage = rec<AiUsageShape>(data.aiUsage, { days: [], byFeature: [], latency: { p50: 0, p95: 0 }, failureRate: 0, monthSpend: 0, budget: 0 });
    models = arr<ModelRow>(data.models);
    guardianChat = arr<ChatMsg>(data.guardianChat);
    DEMO_STUDENT = rec<Person>(data.DEMO_STUDENT, {} as Person);
    DEMO_GUARDIAN = rec<Person>(data.DEMO_GUARDIAN, {} as Person);
    DEMO_SECTION_ID = str(data.DEMO_SECTION_ID);
    assets = arr<AssetRecord>(data.assets);
    workOrders = arr<WorkOrderRecord>(data.workOrders);
    technicians = arr<TechnicianRecord>(data.technicians);
    maintPlans = arr<MaintPlan>(data.maintPlans);
    inspections = arr<InspectionRecord>(data.inspections);
    inventory = arr<InventoryItem>(data.inventory);
    vendors = arr<VendorRecord>(data.vendors);
    deskSettings = rec<FrontDeskSettings>(data.deskSettings, {} as FrontDeskSettings);
    deskIntents = arr<DeskIntent>(data.deskIntents);
    calls = arr<ReceptionCall>(data.calls);
    visitors = arr<VisitorEntry>(data.visitors);
    gatePasses = arr<GatePass>(data.gatePasses);
    SCENARIOS = arr<Scenario>(data.SCENARIOS);
    SCHOOL = rec(data.SCHOOL, { name: '', short: '', established: 0, board: '' });
    FEE_STORY = rec(data.FEE_STORY, { clusterRoute: '', dipPct: 0, failedCount: 0 });
    /* T302 (D-4): rebind the SLA policy after hydration — server-provided
       keys override the code-level DEFAULT_SLA; any key the server blanked
       (empty world) falls back to the default. SLA_POLICY is therefore never
       undefined and always covers every MaintPriority, in both worlds. */
    SLA_POLICY = { ...DEFAULT_SLA, ...rec<Partial<Record<MaintPriority, SlaRule>>>(data.SLA_POLICY, {}) };
    for (const [k, v] of Object.entries((data.guardianIdByStudent as unknown as Record<string, string[]>) ?? {})) guardianIdByStudent.set(k, v);
  })().catch((err: unknown) => {
    loading = null; // a failed load must be retryable — never cache the rejection
    hydrated = false;
    throw err;
  });
  return loading;
}

/* ---------- named exports — same names the mock modules had ---------- */
export let SCHOOL: { name: string; short: string; established: number; board: string } = {} as never;
export let campuses: Campus[] = [] as never;
export let TERM_DAYS: Date[] = [] as never;
export let students: Person[] = [] as never; // typed
export let teachers: Person[] = [] as never;
export let staff: Person[] = [] as never;
export let guardians: Person[] = [] as never;
export let guardianLinks: Link[] = [] as never;
export const guardianIdByStudent = new Map<string, string[]>(); // filled by ensureDataset
export let sections: Section[] = [] as never;
export let timetable: TimeSlot[] = [] as never;

export let busRoutes: BusRoute[] = [] as never;
export let attendance: AttendanceRecord[] = [] as never;
export let feeObligations: FeeObligation[] = [] as never;
export let payments: Payment[] = [] as never;
export let FEE_STORY: { clusterRoute: string; dipPct: number; failedCount: number } = {} as never;
export let leads: Lead[] = [] as never;
export let documents: DocRecord[] = [] as never;
export let incidents: IncidentRecord[] = [] as never;
export let cases: SchoolCase[] = [] as never;
export let actionItems: ActionRecord[] = [] as never;
export let decisions: DecisionRecord[] = [] as never;
export let meetings: MeetingNote[] = [] as never;
export let memoryDocs: MemoryDoc[] = [] as never;
export let policies: PolicyRule[] = [] as never;
export let workflows: WorkflowDef[] = [] as never;
export let workflowRuns: WorkflowRun[] = [] as never;
export let obligations: Obligation[] = [] as never;
export let calendarEvents: CalendarEvent[] = [] as never;
export let healthIssues: HealthIssue[] = [] as never;
export let notifications: Notification[] = [] as never;
export let auditEntries: AuditEntry[] = [] as never;
export let insights: Insight[] = [] as never;
export interface AiUsageShape {
  days: { label: string; cost: number; requests: number }[];
  byFeature: { label: string; cost: number; requests: number }[];
  latency: { p50: number; p95: number };
  failureRate: number;
  monthSpend: number;
  budget: number;
}
export let aiUsage: AiUsageShape = {
  days: [], byFeature: [], latency: { p50: 0, p95: 0 }, failureRate: 0, monthSpend: 0, budget: 0,
} as never;
export interface ModelRow { name: string; provider: string; region: string; usedFor: string; posture: string; cost: string; latency?: string; status?: string; }
export let models: ModelRow[] = [] as never;
export let guardianChat: ChatMsg[] = [] as never;
export let DEMO_STUDENT: Person = {} as never;
export let DEMO_GUARDIAN: Person = {} as never;
export let DEMO_SECTION_ID: string = {} as never;

/* maintenance collections (former data/dataset) */
/* T302 (§9.2): SLA_POLICY used to be `export const … = data.SLA_POLICY` —
   evaluated at module-eval against an empty `data`, so it was undefined
   forever and every ReportIssue submit threw inside its own promise
   (services/index.ts:372) and hung the spinner permanently. It is now a
   `let` seeded from the code-level DEFAULT_SLA (D-4) and rebound after
   hydration in ensureDataset(). Consumers resolving `SLA_POLICY[priority]`
   at call time — the only legal pattern — always get a total table. */
export interface SlaRule { responseMins: number; resolveMins: number; }
export const DEFAULT_SLA: Record<MaintPriority, SlaRule> = {
  emergency: { responseMins: 10, resolveMins: 240 },
  critical: { responseMins: 30, resolveMins: 480 },
  high: { responseMins: 60, resolveMins: 1440 },
  medium: { responseMins: 240, resolveMins: 4320 },
  low: { responseMins: 480, resolveMins: 10080 },
};
export let SLA_POLICY: Record<MaintPriority, SlaRule> = DEFAULT_SLA;
export let assets: AssetRecord[] = [] as never;
export let workOrders: WorkOrderRecord[] = [] as never;
export let technicians: TechnicianRecord[] = [] as never;
export let maintPlans: MaintPlan[] = [] as never;
export let inspections: InspectionRecord[] = [] as never;
export let inventory: InventoryItem[] = [] as never;
export let vendors: VendorRecord[] = [] as never;

/* reception (former data/dataset) */
export let deskSettings: FrontDeskSettings = {} as never;
export let deskIntents: DeskIntent[] = [] as never;
export let calls: ReceptionCall[] = [] as never;
export let visitors: VisitorEntry[] = [] as never;
export let gatePasses: GatePass[] = [] as never;

/* scenarios (former data/dataset) */
export let SCENARIOS: Scenario[] = [] as never;

/* ---------- helpers over the dataset (ported 1:1 from the former mock) ---------- */
type Link = GuardianLink & Record<string, unknown>;

export const peopleAll = (): Person[] => [...students, ...teachers, ...staff, ...guardians];
export function findPerson(id: string): Person | undefined { return peopleAll().find(p => p.id === id); }
export function studentsOfSection(sectionId: string): Person[] {
  const sec = (data.sections as AnyRec[] ?? []).find(s => s.id === sectionId) as AnyRec | undefined;
  if (!sec) return [];
  return (data.students as Person[] ?? []).filter(st => st.campus === sec.campus && st.grade === sec.grade && st.section === sec.name);
}
export function sectionOfStudent(st: Person): Section | undefined {
  return sections.find(s => s.campus === st.campus && s.grade === st.grade && s.name === st.section);
}
export function guardiansOfStudent(studentId: string) {
  /* T304 (D-5): the old `.find(...)!` cast undefined rows into the result —
     a consumer reading `row.guardian.name` then crashed. Rows without a
     resolvable guardian are dropped instead. */
  return ((data.guardianLinks as Link[] ?? []))
    .filter(l => l.studentId === studentId)
    .map(l => ({ link: l, guardian: (data.guardians as Person[] ?? []).find(g => g.id === l.guardianId) }))
    .filter((r): r is { link: Link; guardian: Person } => r.guardian !== undefined);
}
export function attendanceMarkedToday(): AttendanceRecord[] {
  /* T304 (§11): TERM_DAYS is empty in the blanked/empty world — the old
     `TERM_DAYS[-1].getTime()` threw on every fresh tenant. */
  const t = TERM_DAYS[TERM_DAYS.length - 1];
  if (!t) return [];
  return attendance.filter(a => a.date.getTime() === t.getTime());
}
export function healthScore(issues: HealthIssue[]) {
  const penalty = issues.filter(i => i.status === 'open').reduce((a, i) => a + (i.severity === 'high' ? 2.4 : i.severity === 'medium' ? 1.1 : 0.4), 0);
  return Math.max(60, Math.round(100 - penalty));
}
export function studentFeeSummary(studentId: string): { items: FeeObligation[]; due: number; overdue: number; paid: number; hasFailed: boolean } {
  const items = feeObligations.filter(f => f.studentId === studentId);
  const due = items.filter(f => f.status === 'due' || f.status === 'overdue').reduce((a, f) => a + (f.amount - f.paidAmount), 0);
  const overdue = items.filter(f => f.status === 'overdue').reduce((a, f) => a + (f.amount - f.paidAmount), 0);
  const paid = items.filter(f => f.status === 'paid').reduce((a, f) => a + f.paidAmount, 0);
  return { items, due, overdue, paid, hasFailed: items.some(f => f.status === 'failed') };
}
export function studentAttendanceRate(studentId: string, lastN = 30) {
  const days = TERM_DAYS.slice(-lastN);
  const recs = attendance.filter(a => a.studentId === studentId && days.some(d => d.getTime() === a.date.getTime()));
  /* T304 (§9.5): zero records used to compute a fabricated "100.0%" (the
     formula treats unmarked days as present). With no records the kernel now
     reports rate 0 + hasData:false — screens must render "no records yet"
     rather than a percentage when hasData is false. */
  const hasData = recs.length > 0;
  const absent = recs.filter(r => r.status === 'absent').length;
  const late = recs.filter(r => r.status === 'late').length;
  const excused = recs.filter(r => r.status === 'excused').length;
  const rate = hasData ? Math.round(((lastN - absent - late) / lastN) * 1000) / 10 : 0;
  return {
    rate, absent, late, excused, hasData,
    series: hasData ? days.map(d => { const r = recs.find(x => x.date.getTime() === d.getTime()); return r ? (r.status === 'present' ? 1 : 0) : 1; }) : [],
  };
}
export function sectionAttendanceToday(sectionId: string) {
  /* T304 (§11): empty TERM_DAYS (fresh tenant) → honest zeros, not a throw
     on `TERM_DAYS[-1].getTime()`. */
  const t = TERM_DAYS[TERM_DAYS.length - 1];
  if (!t) return { total: 0, absent: 0, late: 0, pct: 0, unmarked: 0 };
  const sec = sections.find(x => x.id === sectionId);
  const recs = attendance.filter(a => a.sectionId === sectionId && a.date.getTime() === t.getTime());
  const total = sec ? students.filter(s => s.campus === sec.campus && s.grade === sec.grade && s.section === sec.name).length : 0;
  const absent = recs.filter(r => r.status === 'absent').length;
  const late = recs.filter(r => r.status === 'late').length;
  return { total, absent, late, pct: total ? Math.round(((total - absent) / total) * 100) : 0, unmarked: Math.max(0, total - recs.length) };
}

/* ---------- maintenance helpers (ported 1:1) ---------- */
const NOW = Date.now();
export const woById = (id: string): WorkOrderRecord | undefined => workOrders.find(w => w.id === id);
export const assetById = (id: string): AssetRecord | undefined => assets.find(a => a.id === id);
export const technicianByName = (n?: string): TechnicianRecord | undefined => technicians.find(t => t.name === n);
export const woSpend = (wo: WorkOrderRecord) => (wo.partsUsed ?? []).reduce((a, p) => a + p.cost, 0) + Math.round((wo.labourMins ?? 0) * 2);
export const campusWorkOrders = (campus: CampusId | 'all'): WorkOrderRecord[] => workOrders.filter(w => campus === 'all' || w.campus === campus);
export const openWorkOrders = (campus: CampusId | 'all'): WorkOrderRecord[] => campusWorkOrders(campus).filter(w => !['resolved', 'closed', 'cancelled'].includes(w.status));
export function slaState(wo: WorkOrderRecord) {
  const active = !['resolved', 'closed', 'cancelled'].includes(wo.status);
  /* T304 (D-5): a work order without an embedded SLA (blanked key) degrades
     to "no time left to compute" instead of throwing on `.getTime()`. */
  const remaining = (wo.sla?.resolveBy?.getTime() ?? NOW) - NOW;
  const responseRemaining = (wo.sla?.responseBy?.getTime() ?? NOW) - NOW;
  if (!active) return { label: 'Met', tone: 'success' as const, remaining: 0, breached: false };
  if (wo.respondedOn) {
    if (remaining <= 0) return { label: 'Breached', tone: 'danger' as const, remaining, breached: true };
    if (remaining < 60 * 60000) return { label: `${Math.round(remaining / 60000)} min left`, tone: 'danger' as const, remaining, breached: false };
    if (remaining < 4 * 3600000) return { label: `${Math.round(remaining / 3600000)}h left`, tone: 'warning' as const, remaining, breached: false };
    return { label: `${Math.round(remaining / 3600000)}h left`, tone: 'neutral' as const, remaining, breached: false };
  }
  if (responseRemaining <= 0) return { label: 'Response overdue', tone: 'danger' as const, remaining: responseRemaining, breached: true };
  return { label: `Respond in ${Math.max(1, Math.round(responseRemaining / 60000))} min`, tone: responseRemaining < 15 * 60000 ? ('warning' as const) : ('neutral' as const), remaining: responseRemaining, breached: false };
}
export function recommendTechnicians(category: WOCategory, campus: CampusId | 'all', limit = 3): { tech: TechnicianRecord; score: number; skillMatch: boolean; why: string[] }[] {
  return technicians
    .filter((t): t is TechnicianRecord => campus === 'all' || t.campus === campus)
    .map(t => {
      const skillMatch = t.skills.includes(category) || t.certifications.some(c => c.toLowerCase().includes(category.toLowerCase()));
      const score = (skillMatch ? 0.45 : 0) + t.firstTimeFixRate * 0.3 + (1 - Math.min(t.currentJobs, 4) / 4) * 0.25;
      const why: string[] = [];
      why.push(skillMatch ? `${t.skills[0]}-trained${t.certifications[0] ? ` · ${t.certifications[0]}` : ''}` : 'Nearest general skill set');
      why.push(`${t.currentJobs} active job${t.currentJobs === 1 ? '' : 's'}`);
      why.push(`${Math.round(t.firstTimeFixRate * 100)}% first-time fix on ${category.toLowerCase()} work`);
      return { tech: t, score, skillMatch, why };
    })
    .sort((a, b) => Number(b.skillMatch) - Number(a.skillMatch) || b.score - a.score)
    .slice(0, limit);
}
export function replacementView(a: AssetRecord) {
  /* T304 (D-5): blanked asset fields (never installed / zero cost) → no view,
     same contract consumers already handle for `!expectedLifeYears`. */
  if (!a.expectedLifeYears || !a.installedOn || !a.purchaseCost) return null;
  const ageYears = (NOW - a.installedOn.getTime()) / (365.25 * 86400000);
  const repairRatio = a.repairSpendYTD / a.purchaseCost;
  const failureCount = a.failures.length;
  const trigger = repairRatio > 0.2 || (ageYears > 0.75 * a.expectedLifeYears && failureCount >= 3);
  const estReplacement = Math.round(a.purchaseCost * (1 + 0.04) ** Math.min(ageYears, 10) / 1000) * 1000;
  return {
    ageYears: Number(ageYears.toFixed(1)), repairRatio, failureCount, estReplacement, trigger,
    verdict: trigger ? 'Replacement evaluation recommended' : 'Continue maintain-in-place',
    rationale: trigger
      ? `₹${a.repairSpendYTD.toLocaleString('en-IN')} repair spend this year is ${Math.round(repairRatio * 100)}% of replacement cost, with ${failureCount} failures in the last 63–90 days.`
      : 'Repair spend and failure rate remain within healthy bands for this asset class.',
  };
}
export function maintAnalytics(campus: CampusId | 'all') {
  const wos = campusWorkOrders(campus);
  const resolved = wos.filter(w => ['resolved', 'closed'].includes(w.status));
  const breached = wos.filter(w => w.slaBreached || (['resolved', 'closed'].includes(w.status) && w.completedOn && w.completedOn.getTime() > (w.sla?.resolveBy?.getTime() ?? Number.POSITIVE_INFINITY)));
  const openCount = openWorkOrders(campus).length;
  const emergency = openWorkOrders(campus).filter(w => w.priority === 'emergency' || w.priority === 'critical').length;
  const avgResolutionHrs = resolved.length
    ? resolved.reduce((a, w) => a + ((w.completedOn?.getTime() ?? NOW) - w.reportedOn.getTime()) / 3600000, 0) / resolved.length
    : 0;
  const spend = wos.reduce((a, w) => a + woSpend(w), 0);
  const byBuilding = new Map<string, number>();
  wos.forEach(w => byBuilding.set(`${w.campus} · ${w.building}`, (byBuilding.get(`${w.campus} · ${w.building}`) ?? 0) + woSpend(w) + (w.labourMins ?? 0) * 2));
  const pmTasks = maintPlans.length;
  const pmOverdue = maintPlans.filter(p => p.compliance === 'overdue').length;
  return {
    openCount, emergency, resolvedCount: resolved.length,
    slaPct: wos.length ? Math.round(((wos.length - breached.length) / wos.length) * 100) : 100,
    avgResolutionHrs, spend,
    byBuilding: [...byBuilding.entries()].map(([k, v]) => ({ building: k, spend: v })).sort((a, b) => b.spend - a.spend),
    pmTasks, pmOverdue,
    riskyAssets: (assets as AssetRecord[]).filter(a => (campus === 'all' || a.campus === campus) && (a.health < 65 || a.status === 'down')).sort((a, b) => a.health - b.health),
  };
}

/* ---------- reception helpers ---------- */
export function deskAnalytics() {
  const cs = calls as ReceptionCall[];
  const total = cs.length;
  const handoff = cs.filter(c => c.outcome === 'handoff').length;
  /* T304 (§9.5/§11): callsToday/answeredByAi/guardrailTriggers were hardcoded
     (49 / 47 / 1) and the rates NaN'd on an empty call list. Everything is
     computed from the tenant's own records now, with zero-guards; metrics the
     dataset does not carry (answer latency, guardrail telemetry) report 0
     rather than an invented number. */
  return {
    callsToday: total,
    answeredByAi: cs.filter(c => c.resolvedByAi).length,
    avgAnswerSec: 0,
    handoffRate: total ? Math.round((handoff / total) * 100) : 0,
    avgDurationSec: total ? Math.round(cs.reduce((a, c) => a + c.durationSec, 0) / total) : 0,
    missedCalls: cs.filter(c => c.outcome === 'voicemail').length,
    guardrailTriggers: 0,
    byIntent: (deskIntents as DeskIntent[]).map(i => ({ intent: i.label, count: i.callsToday, aiResolved: Math.round((i.callsToday * i.resolvedByAiPct) / 100) })),
  };
}
export function callById(id: string): ReceptionCall | undefined { return calls.find(c => c.id === id); }

export default data;
