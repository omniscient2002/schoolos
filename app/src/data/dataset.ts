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

/* ---------- load once, at module evaluation (top-level await) ---------- */
const raw = (await apiDataset()) as AnyRec;
const data = revive(raw, null) as AnyRec;

/* ---------- named exports — same names the mock modules had ---------- */
export const SCHOOL = data.SCHOOL as { name: string; short: string; established: number; board: string };
export const campuses = data.campuses as Campus[];
export const TERM_DAYS = data.TERM_DAYS as Date[];
export const students = data.students as Person[]; // typed
export const teachers = data.teachers as Person[];
export const staff = data.staff as Person[];
export const guardians = data.guardians as Person[];
export const guardianLinks = data.guardianLinks as Link[];
export const guardianIdByStudent = new Map<string, string[]>(Object.entries((data.guardianIdByStudent as unknown as Record<string, string[]>) ?? {}));
export const sections = data.sections as Section[];
export const timetable = data.timetable as TimeSlot[];

export const busRoutes = data.busRoutes as BusRoute[];
export const attendance = data.attendance as AttendanceRecord[];
export const feeObligations = data.feeObligations as FeeObligation[];
export const payments = data.payments as Payment[];
export const FEE_STORY = data.FEE_STORY as { clusterRoute: string; dipPct: number; failedCount: number };
export const leads = data.leads as Lead[];
export const documents = data.documents as DocRecord[];
export const incidents = data.incidents as IncidentRecord[];
export const cases = data.cases as SchoolCase[];
export const actionItems = data.actionItems as ActionRecord[];
export const decisions = data.decisions as DecisionRecord[];
export const meetings = data.meetings as MeetingNote[];
export const memoryDocs = data.memoryDocs as MemoryDoc[];
export const policies = data.policies as PolicyRule[];
export const workflows = data.workflows as WorkflowDef[];
export const workflowRuns = data.workflowRuns as WorkflowRun[];
export const obligations = data.obligations as Obligation[];
export const calendarEvents = data.calendarEvents as CalendarEvent[];
export const healthIssues = data.healthIssues as HealthIssue[];
export const notifications = data.notifications as Notification[];
export const auditEntries = data.auditEntries as AuditEntry[];
export const insights = data.insights as Insight[];
export interface AiUsageShape {
  days: { label: string; cost: number; requests: number }[];
  byFeature: { label: string; cost: number; requests: number }[];
  latency: { p50: number; p95: number };
  failureRate: number;
  monthSpend: number;
  budget: number;
}
export const aiUsage = data.aiUsage as unknown as AiUsageShape;
export interface ModelRow { name: string; provider: string; region: string; usedFor: string; posture: string; cost: string; latency?: string; status?: string; }
export const models = data.models as ModelRow[];
export const guardianChat = data.guardianChat as ChatMsg[];
export const DEMO_STUDENT = data.DEMO_STUDENT as Person;
export const DEMO_GUARDIAN = data.DEMO_GUARDIAN as Person;
export const DEMO_SECTION_ID = data.DEMO_SECTION_ID as string;

/* maintenance collections (former data/dataset) */
export const SLA_POLICY = data.SLA_POLICY as Record<string, { responseMins: number; resolveMins: number }>;
export const assets = data.assets as AssetRecord[];
export const workOrders = data.workOrders as WorkOrderRecord[];
export const technicians = data.technicians as TechnicianRecord[];
export const maintPlans = data.maintPlans as MaintPlan[];
export const inspections = data.inspections as InspectionRecord[];
export const inventory = data.inventory as InventoryItem[];
export const vendors = data.vendors as VendorRecord[];

/* reception (former data/dataset) */
export const deskSettings = data.deskSettings as FrontDeskSettings;
export const deskIntents = data.deskIntents as DeskIntent[];
export const calls = data.calls as ReceptionCall[];
export const visitors = data.visitors as VisitorEntry[];
export const gatePasses = data.gatePasses as GatePass[];

/* scenarios (former data/dataset) */
export const SCENARIOS = data.SCENARIOS as Scenario[];

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
