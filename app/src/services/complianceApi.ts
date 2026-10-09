/* ============================================================
   complianceApi — MPD · RTE · payroll-lite · billing client.
   One function per server door; every screen below calls these,
   never fetch() directly. Shapes mirror the kernel doors 1:1.

   Errors are display-mapped at the call site with friendly()
   (see app/src/lib/friendlyErrors.ts) and announced via toast —
   this module stays a pure transport, like adminApi.
   ============================================================ */
import { apiGet, apiPost, apiPut } from './liveApi';

/* ---------- MPD (mandatory public disclosure) ---------- */

export type MpdStatus = 'ok' | 'missing' | 'expiring';

export interface MpdChecklistItem {
  id: string;
  label: string;
  status: MpdStatus;
  detail?: string;
  href?: string;
}

export interface MpdDoc {
  id: string;
  name: string;
  kind: string;
  expires_on?: string | null;
  status?: string;
}

export interface MpdOverview {
  checklist: MpdChecklistItem[];
  docs: MpdDoc[];
  disclosure: { url: string; updatedAt: string };
}

export async function mpdOverview(): Promise<MpdOverview> {
  return apiGet('/compliance/mpd');
}

export async function mpdAddDoc(input: {
  name: string; kind: string; expires_on?: string;
}): Promise<{ doc: MpdDoc }> {
  return apiPost('/compliance/mpd/docs', input);
}

export async function mpdRetireDoc(id: string): Promise<{ ok: boolean }> {
  return apiPost(`/compliance/mpd/docs/${encodeURIComponent(id)}/retire`, {});
}

/* ---------- RTE (Right to Education quota) ---------- */

export interface RteSeats { total: number; reserved: number; filled: number }

export interface RteMoney { claimed_cents: number; received_cents: number; pending_cents: number }

export interface RteOverview {
  quotaPct: number;
  entryGrades: string[];
  seats: RteSeats;
  reimbursements: RteMoney;
  recent: Array<Record<string, unknown>>;
}

export async function rteOverview(): Promise<RteOverview> {
  return apiGet('/rte/overview');
}

export interface RteLotteryRow {
  name: string; dob: string; gender: string;
  guardianName: string; guardianPhone: string; category: string; grade: string;
}

export interface RteImportReport {
  imported: { admissionNo: string; name: string }[];
  failed: { row: number; error: string }[];
}

export async function rteImportLottery(academicYear: string, rows: RteLotteryRow[]): Promise<RteImportReport> {
  return apiPost('/rte/lottery/import', { academicYear, rows });
}

export async function rteRecordReimbursement(input: {
  academicYear: string; amountCents: number; claimRef: string; status: 'claimed' | 'received';
}): Promise<{ reimbursement: Record<string, unknown> }> {
  return apiPost('/rte/reimbursements', input);
}

/* ---------- payroll-lite ---------- */

export interface PayrollStaff {
  id: string; name: string; role: string; monthlyCents: number; bankLast4?: string | null;
}

export interface PayrollRun {
  id: string; month: string; status: string; totalCents: number; payslips?: number;
}

export interface PayrollOverview {
  month: string; staff: PayrollStaff[]; runs: PayrollRun[];
}

export async function payrollOverview(): Promise<PayrollOverview> {
  return apiGet('/payroll/overview');
}

export async function payrollSaveStructure(
  id: string,
  input: { monthlyCents?: number; bankAcct?: string; pan?: string },
): Promise<{ structure: Record<string, unknown> }> {
  return apiPut(`/payroll/staff/${encodeURIComponent(id)}`, input);
}

export interface PayrollRunResult {
  run: PayrollRun; payslips: unknown[]; skipped: { name: string; reason: string }[];
}

export async function payrollStartRun(month: string): Promise<PayrollRunResult> {
  return apiPost('/payroll/runs', { month });
}

export async function payrollDisburse(
  id: string,
  input: { mode: string; ref: string },
): Promise<{ run: PayrollRun }> {
  return apiPost(`/payroll/runs/${encodeURIComponent(id)}/disburse`, input);
}

/* ---------- billing (school's own plan) ---------- */

export interface BillingUsage { key: string; label: string; count: number; limit: number | null }

export interface BillingState {
  plan: string; usage: BillingUsage[]; upgrade: { note: string };
}

export async function billingGet(): Promise<BillingState> {
  return apiGet('/billing');
}

/* Throws 503 with operator guidance when the payment gateway is
   unconfigured — the screen handles that honestly instead of faking
   an order (see Billing.tsx). */
export async function billingCheckout(plan: string): Promise<{ order: { id: string; amount_cents: number } }> {
  return apiPost('/billing/checkout', { plan });
}

/* ---------- batch 2: infra, meetings, health, CPD, 360, acks, templates, PINs ---------- */

export interface SchoolInfra {
  classrooms: number; labs: number; toilets_boys: number; toilets_girls: number;
  drinking_water: boolean; playground: boolean; boundary_wall: boolean; library_volumes: number;
}
export const infraGet = (): Promise<{ infra: SchoolInfra | null; ptr: number | null }> =>
  apiGet('/school/infra');
export const infraSave = (b: Partial<Record<string, number | boolean>>): Promise<{ infra: SchoolInfra }> =>
  apiPut('/school/infra', b);

export interface Mtg { id: string; kind: string; held_on: string; minutes: string; attendees: string[]; created_at: string }
export const meetingsList = (kind?: string): Promise<{ meetings: Mtg[] }> =>
  apiGet(kind ? `/meetings?kind=${encodeURIComponent(kind)}` : '/meetings');
export const meetingsAdd = (b: { kind: string; heldOn: string; minutes: string; attendees: string[] }): Promise<{ meeting: Mtg }> =>
  apiPost('/meetings', b);

export interface HealthCheck { id: string; kind: string; detail: string; checked_on: string; student_name?: string }
export const healthList = (): Promise<{ checks: HealthCheck[]; scoped?: string }> =>
  apiGet('/health-checks');
export const healthAdd = (b: { studentId: string; kind: string; detail: string; checkedOn: string }): Promise<{ check: HealthCheck }> =>
  apiPost('/health-checks', b);

export interface MealRow { served_on: string; menu: string; veg_count: number; total_count: number }
export const mealsList = (): Promise<{ meals: MealRow[] }> => apiGet('/meals');
export const mealsLog = (b: { servedOn: string; menu: string; vegCount: number; totalCount: number }): Promise<{ meal: MealRow }> =>
  apiPost('/meals', b);

export interface Training { id: string; title: string; hours: number; provider?: string | null; completed_on?: string | null; staff_name?: string }
export const trainingsList = (): Promise<{ trainings: Training[]; scoped: string; ownHours: number | null }> =>
  apiGet('/staff-trainings');
export const trainingsAdd = (b: { userId: string; title: string; hours: number; provider?: string; completedOn?: string }): Promise<{ training: Training }> =>
  apiPost('/staff-trainings', b);

export interface Student360 {
  student: Record<string, unknown>;
  attendance: { marks: number; pct: number | null };
  fees: { outstanding_cents: number | null; open_dues: number | null; withheld?: string };
  transport: { bus_route: unknown };
  guardians: { name: string; phone: string; relation: string }[];
  concessions: { kind: string; percent: unknown; status: string; reason: string }[];
  library: { open: number; fine_open: number } | null;
  exams: { marks: number; scored: number; max: number } | null;
  health: { kind: string; detail: string; checked_on: string }[];
  homework: { pending: number } | null;
}
export const student360 = (id: string): Promise<Student360> =>
  apiGet(`/students/${encodeURIComponent(id)}/360`);
export const studentIdentity = (id: string, apaarId: string): Promise<{ ok: boolean }> =>
  apiPost(`/students/${encodeURIComponent(id)}/identity`, { apaarId });

export interface Notice { id: string; title: string; body: string; audience_kind: string; created_at: string; acked: boolean }
export const noticesList = (): Promise<{ notices: Notice[] }> => apiGet('/notices');
export const noticeAck = (id: string): Promise<{ acked: boolean }> =>
  apiPost(`/announcements/${encodeURIComponent(id)}/ack`, {});
export const noticeAcks = (id: string): Promise<{ announcement: { id: string; title: string }; ackCount: number; acks: { name: string; role: string; signed_at: string }[] }> =>
  apiGet(`/announcements/${encodeURIComponent(id)}/acks`);

export interface AutoTemplate { key: string; name: string; topic: string; blurb: string; action: Record<string, unknown> }
export const automationTemplates = (): Promise<{ templates: AutoTemplate[] }> =>
  apiGet('/automation/templates');

export const feePinSet = (userId: string, pin: string): Promise<{ ok: boolean }> =>
  apiPost('/fees/pins', { userId, pin });

/* ---------- batch 3: NEP pack ---------- */

export interface NepProfile {
  stages: { grade: string; sections: string[]; stage: string }[];
  r3: { language: string; academic_year: string } | null;
  recentActivities: { kind: string; title: string; held_on: string | null }[];
  fln: { skill: string; level: string; n: number }[];
}
export const nepProfile = (): Promise<NepProfile> => apiGet('/nep/profile');
export const nepSetR3 = (language: string, academicYear: string): Promise<{ ok: boolean }> =>
  apiPost('/nep/r3', { language, academicYear });
export interface NepActivity { id: string; kind: string; title: string; detail?: string | null; held_on?: string | null; grades: string[] }
export const nepActivities = (kind?: string): Promise<{ activities: NepActivity[] }> =>
  apiGet(kind ? `/nep/activities?kind=${encodeURIComponent(kind)}` : '/nep/activities');
export const nepAddActivity = (b: { kind: string; title: string; detail?: string; heldOn?: string; grades?: string[] }): Promise<{ activity: NepActivity }> =>
  apiPost('/nep/activities', b);
export const nepSaveHpc = (b: { studentId: string; term: string; strengths?: string; interests?: string; goals?: string; teacherRemark?: string }): Promise<{ ok: boolean }> =>
  apiPost('/nep/hpc', b);
export interface NepHpc {
  student: Record<string, unknown>; stage: string;
  inputs: { term: string; strengths?: string | null; interests?: string | null; goals?: string | null; teacher_remark?: string | null } | { term: string; strengths?: string | null; interests?: string | null; goals?: string | null; teacher_remark?: string | null }[] | null;
  aggregates: { attendancePct: number | null; examAvg: number | null; homeworkPending: number };
}
export const nepHpc = (studentId: string, term?: string): Promise<NepHpc> =>
  apiGet(`/nep/hpc/${encodeURIComponent(studentId)}${term ? `?term=${encodeURIComponent(term)}` : ''}`);
export const nepSaveFln = (b: { studentId: string; skill: string; level: string }): Promise<{ ok: boolean }> =>
  apiPost('/nep/fln', b);
export const nepFlnBoard = (opts?: { studentId?: string; grade?: string }): Promise<{ skills: { skill: string; level: string; n?: number; student_name?: string }[]; scoped?: string }> => {
  const q = opts?.studentId ? `?studentId=${encodeURIComponent(opts.studentId)}` : opts?.grade ? `?grade=${encodeURIComponent(opts.grade)}` : '';
  return apiGet(`/nep/fln${q}`);
};

/* ---------- batch 3: transport compliance ---------- */

export interface BusRun { id: string; ran_on: string; route?: { code: string; name: string } }
export const transportStartRun = (routeId: string): Promise<{ run: BusRun }> =>
  apiPost('/transport/runs', { routeId });
export const transportBoard = (runId: string, studentId: string, direction: 'board' | 'deboard'): Promise<{ boarding: { at: string }; student_name: string }> =>
  apiPost(`/transport/runs/${encodeURIComponent(runId)}/board`, { studentId, direction });
export interface BoardingList { run: BusRun; boardings: { student_id: string; name: string; grade: string; section: string; direction: string; at: string }[]; riders: number; completeness: number | null }
export const transportBoardings = (runId: string): Promise<BoardingList> =>
  apiGet(`/transport/runs/${encodeURIComponent(runId)}/board`);
export interface Attendant { id: string; name: string; route_id?: string | null; police_verified_on?: string | null; staff_name?: string | null; staff_role?: string | null }
export const attendantsList = (): Promise<{ attendants: Attendant[] }> => apiGet('/transport/attendants');
export const attendantsAdd = (b: { userId?: string; name?: string; routeId?: string }): Promise<{ attendant: Attendant }> =>
  apiPost('/transport/attendants', b);
export const attendantsVerify = (id: string, policeVerifiedOn: string): Promise<{ ok: boolean }> =>
  apiPut(`/transport/attendants/${encodeURIComponent(id)}/verify`, { policeVerifiedOn });
export const faresGet = (): Promise<{ fares: { academic_year: string; per_km_cents: number }[] }> => apiGet('/transport/fares');
export const faresSet = (academicYear: string, perKmCents: number): Promise<{ ok: boolean }> =>
  apiPut('/transport/fares', { academicYear, perKmCents });
export const faresQuote = (km: number): Promise<{ amountCents: number; perKmCents: number; academicYear: string }> =>
  apiPost('/transport/fares/quote', { km });
export interface Inspection { id: string; route_id?: string | null; title: string; detail?: string | null; inspected_on: string }
export const inspectionsList = (): Promise<{ inspections: Inspection[] }> => apiGet('/transport/inspections');
export const inspectionsAdd = (b: { routeId?: string; title: string; detail?: string; inspectedOn: string }): Promise<{ inspection: Inspection }> =>
  apiPost('/transport/inspections', b);
export const complianceReport = (quarter: string): Promise<{ quarter: string; runs: number; boardings: number; attendants: { total: number; verified: number }; inspections: number; note: string }> =>
  apiGet(`/transport/compliance-report?quarter=${encodeURIComponent(quarter)}`);

/* ---------- batch 3: staff QR, breach log ---------- */

export const staffQr = (): Promise<{ token: string; day: string }> => apiGet('/staff-attendance/qr');
export const staffScan = (token: string): Promise<{ marked: boolean; already: boolean; day: string }> =>
  apiPost('/staff-attendance/scan', { token });
export const staffMark = (userId: string, day: string): Promise<{ marked: boolean }> =>
  apiPost('/staff-attendance/mark', { userId, day });

export interface Breach { id: string; title: string; detail?: string; found_on: string; contained_on?: string | null; notified_on?: string | null; status: string }
export const breachList = (): Promise<{ breaches: Breach[] }> => apiGet('/dpdp/breaches');
export const breachReport = (b: { title: string; detail: string; foundOn: string }): Promise<{ breach: Breach }> =>
  apiPost('/dpdp/breaches', b);
export const breachContain = (id: string, b: { containedOn?: string; notifiedOn?: string }): Promise<{ ok: boolean; status: string }> =>
  apiPost(`/dpdp/breaches/${encodeURIComponent(id)}/contain`, b);

/* ---------- batch 3: emergency broadcast ---------- */

export const emergencyBroadcast = (b: { title: string; body: string; audienceKind?: string; audienceRef?: string; channel?: string }): Promise<{ announcement: { id: string; status: string } }> =>
  apiPost('/announcements/emergency', b);
export const unackedList = (id: string): Promise<{ announcement: { id: string; title: string }; ackedCount: number; unacked: { id: string; name: string; role: string; phone: string }[] }> =>
  apiGet(`/announcements/${encodeURIComponent(id)}/unacked`);

/* ---------- 4.5: safety audit (NCPCR-mapped) + staff verification ---------- */

export interface SafetyCheck { id: string; code: string; title: string; detail: string; status: 'open' | 'done'; evidence?: string | null; checked_on?: string | null }
export interface SafetyScore { total: number; done: number; pct: number | null }
export const safetyChecklist = (): Promise<{ checks: SafetyCheck[]; score: SafetyScore }> =>
  apiGet('/safety/checklist');
export const safetyAttest = (id: string, done: boolean, evidence?: string): Promise<{ check: SafetyCheck; score: SafetyScore }> =>
  apiPost(`/safety/checks/${encodeURIComponent(id)}/attest`, { done, ...(evidence?.trim() ? { evidence: evidence.trim() } : {}) });

export type VerificationState = 'valid' | 'expiring' | 'expired' | 'missing';
export interface StaffVerification { userId: string; name: string; role: string; state: VerificationState; verifiedOn: string | null; expiresOn: string | null; note: string | null }
export const verificationsList = (): Promise<{ day: string; staff: StaffVerification[] }> =>
  apiGet('/staff-verifications');
export const verificationsRecord = (b: { userId: string; verifiedOn: string; validYears?: number; note?: string }): Promise<{ verification: { user_id: string; verified_on: string; expires_on: string } }> =>
  apiPost('/staff-verifications', b);
