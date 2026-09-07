/* ============================================================
   parentApi.ts — ParentOS typed doors (PU-1 UI lane).

   Every wrapper speaks the FROZEN v0 contracts from
   docs/PARENTOS-PLAN.md ("Frozen API contracts"). The server
   doors land via lanes PS-1/PS-2; until then every call fails
   honestly and the screens show their error/empty states —
   the UI never fakes parent data.

   Token + error semantics mirror services/liveApi.ts `call()`
   exactly (same origin, same Bearer header, same 401 session
   reset) — liveApi's `call` is module-private, so this file
   re-implements the identical contract on LIVE_BASE rather
   than widening that file's exports.
   ============================================================ */
import { LIVE_BASE, setToken } from './liveApi';

async function call<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('schoolos_token');
  const res = await fetch(`${LIVE_BASE}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) {
    // session expired or revoked — clear and let the AuthGate take over
    localStorage.removeItem('schoolos.session');
    setToken(null);
    window.location.href = '/login';
    throw new Error('session expired');
  }
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

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
export interface ParentExamUpcoming { id: string; title: string; subject?: string | null; date: string; syllabus?: string | null }
export interface ParentExamResult { id: string; title: string; subject?: string | null; published_at?: string | null; score?: string | null }
export interface ParentExamsData { child_id: string; upcoming: ParentExamUpcoming[]; published: ParentExamResult[]; explain?: string | null }

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

/* GET /parent/explain?topic=… → explain-layer text (PS-2) for any complex metric */
export interface ParentExplain { topic: string; text: string; sources?: string[] }

/* ---------- doors ---------- */

export const getParentHome = () => call<ParentHomeData>('/parent/home');

export const getBrief = (when: BriefWhen) => call<ParentBrief>(`/parent/brief?when=${encodeURIComponent(when)}`);

export const getExplain = (topic: string) => call<ParentExplain>(`/parent/explain?topic=${encodeURIComponent(topic)}`);

export const getTimeline = (childId: string) => call<ParentTimelineData>(`/parent/child/${encodeURIComponent(childId)}/timeline`);

export const getAssignments = (childId: string) => call<ParentAssignmentsData>(`/parent/child/${encodeURIComponent(childId)}/assignments`);

export const getAttendance = (childId: string) => call<ParentAttendanceData>(`/parent/child/${encodeURIComponent(childId)}/attendance`);

export const getExams = (childId: string) => call<ParentExamsData>(`/parent/child/${encodeURIComponent(childId)}/exams`);

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

export const askCopilot = (question: string, childId?: string) =>
  call<CopilotAnswer>('/parent/copilot/ask', { method: 'POST', body: JSON.stringify({ question, ...(childId ? { child_id: childId } : {}) }) });

export const draftCopilotNote = (payload: { topic?: string; child_id?: string } = {}) =>
  call<CopilotDraft>('/parent/copilot/draft', { method: 'POST', body: JSON.stringify(payload) });

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
