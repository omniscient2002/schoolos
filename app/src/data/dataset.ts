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
import { apiDataset } from '../services/liveApi';
import type {
  Person, GuardianLink, FeeObligation, Payment, AttendanceRecord, Section, TimeSlot, Lead,
  BusRoute, SchoolCase, ActionRecord, DecisionRecord, MeetingNote, MemoryDoc, PolicyRule,
  WorkflowDef, WorkflowRun, Obligation, CalendarEvent, HealthIssue, Notification, AuditEntry,
  Insight, VisitorEntry, GatePass, DeskIntent, Scenario, Campus, ChatMsg,
  AssetRecord, ReceptionCall, FrontDeskSettings, DocRecord, IncidentRecord, CampusId, WOCategory,
  WorkOrderRecord, TechnicianRecord, MaintPlan, InspectionRecord, InventoryItem, VendorRecord,
} from '../types/domain';

type AnyRec = Record<string, unknown>;


const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

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
    // The endpoint requires auth; wait until the session token exists.
    for (let i = 0; i < 200 && !localStorage.getItem('schoolos_token'); i++) {
      await new Promise(r => setTimeout(r, 250));
    }
    const raw = (await apiDataset()) as AnyRec;
    data = revive(raw, null) as AnyRec;
    hydrated = true;
    campuses = data.campuses as Campus[] as never;
    TERM_DAYS = data.TERM_DAYS as Date[] as never;
    students = data.students as Person[] as never;
    teachers = data.teachers as Person[] as never;
    staff = data.staff as Person[] as never;
    guardians = data.guardians as Person[] as never;
    guardianLinks = data.guardianLinks as Link[] as never;
    sections = data.sections as Section[] as never;
    timetable = data.timetable as TimeSlot[] as never;
    busRoutes = data.busRoutes as BusRoute[] as never;
    attendance = data.attendance as AttendanceRecord[] as never;
    feeObligations = data.feeObligations as FeeObligation[] as never;
    payments = data.payments as Payment[] as never;
    leads = data.leads as Lead[] as never;
    documents = data.documents as DocRecord[] as never;
    incidents = data.incidents as IncidentRecord[] as never;
    cases = data.cases as SchoolCase[] as never;
    actionItems = data.actionItems as ActionRecord[] as never;
    decisions = data.decisions as DecisionRecord[] as never;
    meetings = data.meetings as MeetingNote[] as never;
    memoryDocs = data.memoryDocs as MemoryDoc[] as never;
    policies = data.policies as PolicyRule[] as never;
    workflows = data.workflows as WorkflowDef[] as never;
    workflowRuns = data.workflowRuns as WorkflowRun[] as never;
    obligations = data.obligations as Obligation[] as never;
    calendarEvents = data.calendarEvents as CalendarEvent[] as never;
    healthIssues = data.healthIssues as HealthIssue[] as never;
    notifications = data.notifications as Notification[] as never;
    auditEntries = data.auditEntries as AuditEntry[] as never;
    insights = data.insights as Insight[] as never;
    aiUsage = data.aiUsage as unknown as AiUsageShape as never;
    models = data.models as ModelRow[] as never;
    guardianChat = data.guardianChat as ChatMsg[] as never;
    DEMO_STUDENT = data.DEMO_STUDENT as Person as never;
    DEMO_GUARDIAN = data.DEMO_GUARDIAN as Person as never;
    DEMO_SECTION_ID = data.DEMO_SECTION_ID as string as never;
    assets = data.assets as AssetRecord[] as never;
    workOrders = data.workOrders as WorkOrderRecord[] as never;
    technicians = data.technicians as TechnicianRecord[] as never;
    maintPlans = data.maintPlans as MaintPlan[] as never;
    inspections = data.inspections as InspectionRecord[] as never;
    inventory = data.inventory as InventoryItem[] as never;
    vendors = data.vendors as VendorRecord[] as never;
    deskSettings = data.deskSettings as FrontDeskSettings as never;
    deskIntents = data.deskIntents as DeskIntent[] as never;
    calls = data.calls as ReceptionCall[] as never;
    visitors = data.visitors as VisitorEntry[] as never;
    gatePasses = data.gatePasses as GatePass[] as never;
    SCENARIOS = data.SCENARIOS as Scenario[] as never;
    SCHOOL = data.SCHOOL as { name: string; short: string; established: number; board: string };
    FEE_STORY = data.FEE_STORY as { clusterRoute: string; dipPct: number; failedCount: number };
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
export let aiUsage: AiUsageShape = {} as never;
export interface ModelRow { name: string; provider: string; region: string; usedFor: string; posture: string; cost: string; latency?: string; status?: string; }
export let models: ModelRow[] = [] as never;
export let guardianChat: ChatMsg[] = [] as never;
export let DEMO_STUDENT: Person = {} as never;
export let DEMO_GUARDIAN: Person = {} as never;
export let DEMO_SECTION_ID: string = {} as never;

/* maintenance collections (former data/dataset) */
export const SLA_POLICY = data.SLA_POLICY as Record<string, { responseMins: number; resolveMins: number }>;
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
  return ((data.guardianLinks as Link[] ?? [])).filter(l => l.studentId === studentId).map(l => ({
    link: l,
    guardian: (data.guardians as Person[] ?? []).find(g => g.id === l.guardianId)!,
  }));
}
export function attendanceMarkedToday(): AttendanceRecord[] {
  const t = TERM_DAYS[TERM_DAYS.length - 1];
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
  const absent = recs.filter(r => r.status === 'absent').length;
  const late = recs.filter(r => r.status === 'late').length;
  const excused = recs.filter(r => r.status === 'excused').length;
  const rate = Math.round(((lastN - absent - late) / lastN) * 1000) / 10;
  return { rate, absent, late, excused, series: days.map(d => { const r = recs.find(x => x.date.getTime() === d.getTime()); return r ? (r.status === 'present' ? 1 : 0) : 1; }) };
}
export function sectionAttendanceToday(sectionId: string) {
  const t = TERM_DAYS[TERM_DAYS.length - 1];
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
  const remaining = wo.sla.resolveBy.getTime() - NOW;
  const responseRemaining = wo.sla.responseBy.getTime() - NOW;
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
  if (!a.expectedLifeYears) return null;
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
  const breached = wos.filter(w => w.slaBreached || (['resolved', 'closed'].includes(w.status) && w.completedOn && w.completedOn.getTime() > w.sla.resolveBy.getTime()));
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
  return {
    callsToday: 49,
    answeredByAi: 47,
    avgAnswerSec: 3,
    handoffRate: Math.round((handoff / total) * 100),
    avgDurationSec: Math.round(cs.reduce((a, c) => a + c.durationSec, 0) / total),
    missedCalls: 0,
    guardrailTriggers: 1,
    byIntent: (deskIntents as DeskIntent[]).map(i => ({ intent: i.label, count: i.callsToday, aiResolved: Math.round((i.callsToday * i.resolvedByAiPct) / 100) })),
  };
}
export function callById(id: string): ReceptionCall | undefined { return calls.find(c => c.id === id); }

export default data;
