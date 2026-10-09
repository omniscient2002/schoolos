/* ============================================================
   parentApi.ts — ParentOS typed doors (PU-1 UI lane).

   Every wrapper speaks the FROZEN v0 contracts from
   docs/PARENTOS-PLAN.md ("Frozen API contracts"). The server
   doors land via lanes PS-1/PS-2; until then every call fails
   honestly and the screens show their error/empty states —
   the UI never fakes parent data.

   I4: parent calls now ride the ONE transport (`liveApi.apiRequest`) — the same bearer,
   same 401 session reset, same CSRF echo and same same-origin credentials as every other
   screen. The hand-rolled copy this replaces missed the CSRF echo entirely, so any parent
   write could be refused once same-origin CSRF enforcement was on.
   ============================================================ */
import { LIVE_BASE, authHeaders, apiRequest } from './liveApi';

const call = <T,>(path: string, opts: RequestInit = {}): Promise<T> => apiRequest<T>(path, opts);

/* ---------- frozen shapes (docs/PARENTOS-PLAN.md) ---------- */

/* GET /parent/home → {children:[{child_id,name,class,attendance_today,
   attention:[{tier,ref,title,due}]}], actions:[{kind,ref,title,due}],
   brief:{morning,evening,week}} */
export type AttentionTier = 'urgent' | 'action' | 'upcoming';
export interface ParentAttentionItem { tier: AttentionTier; ref: string; title: string; due: string | null }
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export interface ParentChildHome {
  child_id: string;
  name: string;
  class: string;
  attendance_today: AttendanceStatus | null;
  attention: ParentAttentionItem[];
}
export type HomeActionKind = 'consent' | 'ptm' | 'form' | 'payment';
export interface ParentHomeAction { kind: HomeActionKind; ref: string; title: string; due: string | null }
export interface ParentHomeData {
  children: ParentChildHome[];
  actions: ParentHomeAction[];
  brief: { morning?: string | null; evening?: string | null; week?: string | null };
}

/* GET /parent/brief?when=morning|evening|week → deterministic
   plain-language aggregation. Numbers are optional so PS-2 can
   refine the payload; the UI composes its sentences from whatever
   arrives and falls back to the server's own headline. */
export type BriefWhen = 'morning' | 'evening' | 'week';
export interface ParentBrief {
  when: BriefWhen;
  headline?: string | null;
  attendance_pct?: number | null;
  assignments_done?: number | null;
  assignments_total?: number | null;
  reports_published?: number | null;
}

/* GET /parent/child/:id/timeline → chronological evidence-only events */
export interface ParentTimelineEvent { id?: string; at: string; kind: string; title: string; detail?: string | null; ref?: string | null }
export interface ParentTimelineData { child_id: string; events: ParentTimelineEvent[] }

/* GET /parent/child/:id/assignments → upcoming|submitted|reviewed|overdue|missing (+explain) */
export interface ParentAssignment { id: string; title: string; subject?: string | null; due?: string | null; status?: string | null }
export interface ParentAssignmentsData {
  child_id: string;
  upcoming: ParentAssignment[];
  submitted: ParentAssignment[];
  reviewed: ParentAssignment[];
  overdue: ParentAssignment[];
  missing: ParentAssignment[];
  explain?: string | null;
}

/* GET /parent/child/:id/attendance → today, month %, history, approved-leave-aware */
export interface ParentAttendanceToday { status: AttendanceStatus | null; marked_at?: string | null; classes_today?: number | null }
export interface ParentAttendanceData {
  child_id: string;
  today: ParentAttendanceToday | null;
  month_pct?: number | null;
  history?: { date: string; status: string }[];
  explain?: string | null;
}

/* GET /parent/child/:id/exams → upcoming (date/syllabus) + published results + explain */
/* GET /parent/child/:id/exams → upcoming (date/syllabus) + published results + explain
   The wire sends `name`/`exam`, not `title`, and does NOT always include a
   date — the previous type claimed otherwise, so every exam rendered a blank
   name and the literal string "Invalid Date" in the date column. `date` is
   therefore optional here, and fmtDateShort renders an em-dash when absent. */
export interface ParentExamUpcoming { id: string; name: string; term?: string | null; class_grade?: string | null; date?: string | null }
export interface ParentExamResult { exam: string; term?: string | null; total_pct?: string | number | null; grade?: string | null; published_at?: string | null }
export interface ParentExamsData { child_id: string; upcoming: ParentExamUpcoming[]; published: ParentExamResult[]; explain?: string | null }

/* GET /parent/child/:id/academics → PUBLISHED report cards only, with the moderation overlay
   applied (U-15). No child_id in the payload — the door is already scoped to one child. */
export interface ParentAcademicsReport {
  exam: string;
  term?: string | null;
  pct?: string | number | null;
  grade?: string | null;
  publishedAt?: string | null;
  explain?: string | null;
}
export interface ParentAcademicsData { reports: ParentAcademicsReport[] }

/* GET/POST /parent/consents · POST /:id/decide {granted|declined} (immutable once set) */
export type ConsentKind = 'trip' | 'photo' | 'medical' | 'activity' | 'transport';
export type ConsentStatus = 'pending' | 'granted' | 'declined';
export interface ParentConsent {
  id: string;
  child_id: string;
  child_name?: string | null;
  kind: ConsentKind | string;
  title: string;
  detail?: string | null;
  detail_ref?: string | null;
  due_at?: string | null;
  status: ConsentStatus;
  decided_by?: string | null;
  decided_at?: string | null;
}
export interface ParentConsentsData { consents: ParentConsent[] }

/* GET/POST /parent/requests → unified request center + status timeline
   (family.request: submitted→received→assigned→in_progress→waiting_parent→resolved→closed) */
export type RequestCategory = 'certificate' | 'document' | 'transport' | 'activity' | 'profile_correction' | 'reevaluation' | 'other';
export type RequestStatus = 'submitted' | 'received' | 'assigned' | 'in_progress' | 'waiting_parent' | 'resolved' | 'closed';
export interface FamilyRequestEvent { status: RequestStatus | string; at: string; note?: string | null }
export interface FamilyRequest {
  id: string;
  category: RequestCategory | string;
  title: string;
  detail?: string | null;
  child_id?: string | null;
  child_name?: string | null;
  status: RequestStatus | string;
  owner_role?: string | null;
  sla_at?: string | null;
  created_at: string;
  events?: FamilyRequestEvent[];
}
export interface ParentRequestsData { requests: FamilyRequest[] }
export interface CreateRequestPayload { category: RequestCategory; title: string; detail?: string; child_id?: string }

/* POST /parent/leave-request {child_id, kind, dates, reason, doc_ref?} */
export interface LeaveRequestPayload { child_id: string; kind: string; dates: string[]; reason: string; doc_ref?: string }

/* POST /parent/report-discrepancy {record_ref, what_wrong} → case-style flow */
export interface DiscrepancyPayload { record_ref: string; what_wrong: string }

/* POST /parent/copilot/ask|draft → deterministic v0, budget-capped, sources shown */
export interface CopilotAnswer { answer: string; sources: string[]; budget_left?: number | null; empty?: boolean; empty_reason?: string | null }
export interface CopilotDraft { draft: string; sources?: string[] }

/* GET /parent/explain/:topic → explain-layer text (PS-2) for any complex metric */
export interface ParentExplain { topic: string; meaning: string; why: string; what_you_can_do: string; deterministic?: boolean }

/* ---------- doors ---------- */

export const getParentHome = () => call<ParentHomeData>('/parent/home');

export const getBrief = (when: BriefWhen) => call<ParentBrief>(`/parent/brief?when=${encodeURIComponent(when)}`);

export const getExplain = (topic: string) => call<ParentExplain>(`/parent/explain/${encodeURIComponent(topic)}`);

export const getTimeline = (childId: string) => call<ParentTimelineData>(`/parent/child/${encodeURIComponent(childId)}/timeline`);

export const getAssignments = (childId: string) => call<ParentAssignmentsData>(`/parent/child/${encodeURIComponent(childId)}/assignments`);

export const getAttendance = (childId: string) => call<ParentAttendanceData>(`/parent/child/${encodeURIComponent(childId)}/attendance`);

export const getExams = (childId: string) => call<ParentExamsData>(`/parent/child/${encodeURIComponent(childId)}/exams`);

export const getAcademics = (childId: string) => call<ParentAcademicsData>(`/parent/child/${encodeURIComponent(childId)}/academics`);

/* GET /parent/child/:id/transport → the child's bus route (no live position to families) */
export interface ParentTransportData {
  child_id: string;
  route: { code: string; name: string; vehicle: string | null; capacity: number | null } | null;
  route_code: string | null;
  note: string;
}
export const getTransport = (childId: string) => call<ParentTransportData>(`/parent/child/${encodeURIComponent(childId)}/transport`);

/* GET /parent/child/:id/documents → the school's shared files for this child (metadata; download via files.store) */
export interface ParentDocument { id: string; filename: string; mime: string; bytes: number; created_at: string }
export interface ParentDocumentsData { child_id: string; documents: ParentDocument[]; note: string }
export const getDocuments = (childId: string) => call<ParentDocumentsData>(`/parent/child/${encodeURIComponent(childId)}/documents`);

/* Download a child's document through files.store's access-checked door (guardian-scoped). */
export async function downloadDocument(id: string, filename: string): Promise<void> {
  const res = await fetch(`${LIVE_BASE}/plugins/files.store/${encodeURIComponent(id)}/download`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`Could not download this file (HTTP ${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export const getConsents = () => call<ParentConsentsData>('/parent/consents');

export const decideConsent = (id: string, decision: 'granted' | 'declined') =>
  call<{ ok: boolean; consent: ParentConsent }>(`/parent/consents/${encodeURIComponent(id)}/decide`, { method: 'POST', body: JSON.stringify({ decision }) });

export const getRequests = () => call<ParentRequestsData>('/parent/requests');

export const createRequest = (payload: CreateRequestPayload) =>
  call<{ ok: boolean; request: FamilyRequest }>('/parent/requests', { method: 'POST', body: JSON.stringify(payload) });

export const reportDiscrepancy = (payload: DiscrepancyPayload) =>
  call<{ ok: boolean; id: string }>('/parent/report-discrepancy', { method: 'POST', body: JSON.stringify(payload) });

export const createLeaveRequest = (payload: LeaveRequestPayload) =>
  call<{ ok: boolean; id: string }>('/parent/leave-request', { method: 'POST', body: JSON.stringify(payload) });

/* GET /ptm/slots → the school's PTM board (a parent sees no other family's
   booking detail) · POST /ptm/book {slotId, studentId} → books only a linked
   child; the server enforces family.child_link. Wire keys are camelCase. */
export interface PtmSlot {
  slotId?: string; slot_id?: string; id?: string;
  teacherId?: string; teacher_id?: string;
  teacherName?: string; teacher_name?: string;
  date?: string; slot_date?: string;
  startTime?: string; start_time?: string;
  endTime?: string; end_time?: string;
  status?: string;
  booked?: boolean;
}
export interface PtmBookResult { ok: boolean; bookingId?: string; slotId?: string; status?: string; inviteTemplate?: string }

export const getPtmSlots = () => call<{ slots: PtmSlot[] }>('/ptm/slots');

export const bookPtm = (slotId: string, studentId: string) =>
  call<PtmBookResult>('/ptm/book', { method: 'POST', body: JSON.stringify({ slotId, studentId }) });

export const askCopilot = (question: string, childId?: string) =>
  call<CopilotAnswer>('/parent/copilot/ask', { method: 'POST', body: JSON.stringify({ question, ...(childId ? { child_id: childId } : {}) }) });

export const draftCopilotNote = (payload: { topic?: string; child_id?: string } = {}) =>
  call<CopilotDraft>('/parent/copilot/draft', { method: 'POST', body: JSON.stringify(payload) });

/* ---------- fees (FEE-PRD-1 / FEE-FE-2) ---------- */
export interface ParentFeeObligation {
  id: string; student_id: string; term: string; label: string;
  amount_cents: number; paid_cents: number; net_amount_cents: number; concession_cents?: number;
  due_on: string | null; status: 'open' | 'partial' | 'paid' | 'void';
  student_name?: string; grade?: string; section?: string;
}
export interface ParentPayment {
  id: string; student_id: string; obligation_id: string | null; amount_cents: number;
  refunded_cents: number; method: string; status: string; gateway_ref: string | null;
  receipt_no: string | null; confirmed_at: string | null; created_at: string; settled_via: string | null;
  student_name?: string; obligation_label?: string | null; term?: string | null;
}
export interface ParentReceipt {
  id: string; receipt_no: string; payment_id: string; student_id: string; amount_cents: number;
  issued_at: string; voided_at: string | null; pdf_file_id?: string | null;
  student_name?: string; obligation_label?: string | null; term?: string | null;
}
export interface ParentInstallment {
  id: string; obligation_id: string; seq: number; due_on: string | null; amount_cents: number;
  status: string; payment_id: string | null; obligation_label?: string | null; term?: string | null;
  student_id?: string; student_name?: string;
}

export const getMyFees = (studentId?: string) =>
  call<{ obligations: ParentFeeObligation[]; scoped: string }>(`/fees/obligations${studentId ? `?studentId=${encodeURIComponent(studentId)}` : ''}`);

export const getMyPayments = () => call<{ payments: ParentPayment[] }>('/payments');

export const getMyReceipts = () => call<{ receipts: ParentReceipt[] }>('/fees/receipts');

/* The scheduled parts of the family's obligations (FEE-PRD-6b). Parent-scoped server-side. */
export const getMyInstallments = () => call<{ installments: ParentInstallment[] }>('/fees/installments');

export const getMyReceipt = (id: string) =>
  call<{ receipt: ParentReceipt & Record<string, unknown> }>(`/fees/receipts/${encodeURIComponent(id)}`);

/* FEE-FE-7: download the immutable receipt PDF. The bytes go through an authenticated fetch (a bare <a>
   would not carry the bearer token) and are handed to the browser as a file download. */
export async function downloadReceiptPdf(receiptId: string, filename: string): Promise<void> {
  const res = await fetch(`${LIVE_BASE}/fees/receipts/${encodeURIComponent(receiptId)}/pdf`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* Initiate a payment (parent authority). Settlement is a staff act — the parent starts the attempt. */
export const initiateFeePayment = (obligationId: string, method = 'upi') =>
  call<{ payment: ParentPayment }>('/fees/payments', { method: 'POST', body: JSON.stringify({ obligationId, method }) });

/* Gateway checkout: a UPI intent link, or a Razorpay order. Either returns a paymentId to track. */
export const createUpiLink = (obligationId: string) =>
  call<{ paymentId: string; link: string; linkId: string; amountCents: number; studentName: string; obligationLabel: string }>(
    '/plugins/payments.upi/links', { method: 'POST', body: JSON.stringify({ obligationId }) });

export const createRazorpayOrder = (obligationId: string) =>
  call<{ paymentId: string; orderId: string; amountCents: number; currency: string; keyId: string; status: string }>(
    '/plugins/payments.razorpay/orders', { method: 'POST', body: JSON.stringify({ obligationId }) });

/* ---------- small helpers ---------- */

/* The signed-in guardian's first name for the greeting. AuthGate stores
   {name, role, email} in localStorage under 'schoolos.session' — read-only
   helper, no auth logic here. */
export function parentFirstName(): string {
  try {
    const raw = localStorage.getItem('schoolos.session');
    const s = raw ? (JSON.parse(raw) as { name?: string }) : null;
    return s?.name?.trim().split(/\s+/)[0] ?? '';
  } catch {
    return '';
  }
}

/* True when a door failure is an authorization wall (not a outage) —
   screens show the calm "not available" state instead of a scary error. */
export function isDeniedError(e: unknown): boolean {
  const s = String((e as Error)?.message ?? e).toLowerCase();
  return ['forbidden', 'not authorized', 'unauthorized', 'access denied', 'not linked', 'only linked', '403'].some(n => s.includes(n));
}
