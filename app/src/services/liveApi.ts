/* ============================================================
   Live API client — connects the frontend to the real SchoolOS
   backend (Fastify + Postgres). Enabled with VITE_LIVE_API=1.
   The mock service layer remains the default so the demo loops
   always work; this module proves the same shapes over the wire.
   ============================================================ */
import type { LiveEvent } from '../types/domain';

/* Single brain: the app always runs against the backend. */
export const LIVE_API = true;
const BASE = (import.meta.env.VITE_API_BASE as string) ?? 'http://127.0.0.1:8080';
/* unit 14: exported for the kernel plugin resync, which must hit the same origin
   as every other door (relative '/plugins' only works when the API serves the
   app — split-origin serving silently no-oped enablement; see backlog ledger). */
export const LIVE_BASE = BASE;

export interface ApiUser {
  id: string; name: string; role: string; email: string; tenantId: string;
  school?: { name: string | null; slug: string | null };
  /* RBAC-3/RBAC-6: the caller's own custom-role binding and mask (see app/src/lib/grants.ts). Display
     hint only — the server re-decides every door. */
  role_key?: string | null;
  custom?: { allow: string[]; deny: string[] } | null;
}

/* FEX-3: the session bearer lives in MEMORY ONLY. Persisting it to localStorage made any XSS a full,
 * durable account takeover. Production is same-origin: the HttpOnly `schoolos_session` cookie is the
 * durable credential (see `call()` below), and a cold open exchanges it for a fresh in-memory bearer via
 * POST /auth/renew. Any legacy token a previous build wrote is cleared once, here. */
let token: string | null = null;
try { if (typeof localStorage !== 'undefined') localStorage.removeItem('schoolos_token'); } catch { /* storage blocked */ }

/* P0 fix 4: every 401 session-reset carries the user back to the login
   screen WITH the screen they were on, so a mid-task session expiry
   returns them where they were after signing in again (Login honors the
   `return` query param; default /today). Shared by all four fetch
   wrappers (liveApi, coordApi, parentApi, studentApi). */
export function redirectToLoginWithReturn(): void {
  const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.href = `/login?return=${encodeURIComponent(here || '/')}`;
}

export function setToken(t: string | null) {
  token = t;
}

/** The in-memory session bearer, for the small modules that share this brain but build their own fetch
 *  (FEX-3). Empty when the session rides the HttpOnly cookie only (same-origin, before /auth/renew). */
export function getToken(): string | null {
  return token;
}

/** `Authorization` header for this session, or an empty object. Use with `credentials:'same-origin'` so the
 *  HttpOnly cookie covers a cold open before the in-memory bearer is renewed. */
export function authHeaders(): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

/* Same-origin detection for the cookie-session flow (L5-3.2): the HttpOnly
   schoolos_session cookie + JS-readable schoolos_csrf cookie only ride along
   when the API is served from THIS origin (production serves the app itself).
   Dev split-origin keeps the bearer flow — the server's CORS is registered
   with credentials:false, so cross-origin credentialed requests would be
   blocked outright. L2 owns flipping that (blocks.md). */
const SAME_ORIGIN = (() => {
  try { return new URL(BASE, window.location.origin).origin === window.location.origin; } catch { return false; }
})();

/* Double-submit CSRF (L2-3.1 server contract): cookie-authed MUTATIONS must
   echo the schoolos_csrf cookie value in X-CSRF-Token. Bearer-authed requests
   are exempt server-side, but attaching the header whenever the cookie is
   readable is harmless and keeps one code path. */
function csrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === 'schoolos_csrf') return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

async function call<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const method = (opts.method ?? 'GET').toUpperCase();
  const csrf = csrfToken();
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    /* L5-3.2: same-origin deployments authenticate via the HttpOnly cookie and
       receive Set-Cookie (login / logout Max-Age=0) — same-origin needs no CORS
       cooperation. Cross-origin dev keeps the pure bearer flow. */
    ...(SAME_ORIGIN ? { credentials: 'same-origin' as RequestCredentials } : {}),
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method) ? { 'x-csrf-token': csrf } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) {
    // session expired or revoked — clear and let the AuthGate take over
    localStorage.removeItem('schoolos.session');
    setToken(null);
    redirectToLoginWithReturn();
    throw new Error('session expired');
  }
  if (!res.ok) {
    const message = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    const requestId = res.headers.get('x-request-id');
    throw new Error(requestId ? `${message} (request ${requestId})` : message);
  }
  return body as T;
}

/* FEX-6/7/8: the ONE transport — the same 401 session-reset, CSRF echo and bearer handling as every other
 * door. Screens that used to hand-roll their own fetch (and silently skipped the session-reset path) call
 * this instead of re-implementing the contract. */
export const apiRequest = call;

/* ---- auth ---- */
export async function apiLogin(email: string, password: string) {
  const r = await call<{ token: string; user: ApiUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  setToken(r.token);
  return r;
}
export const apiLogout = () => setToken(null);

/* ---- full authentication (008): phone OTP · Google SSO · logout ---- */
export const apiRequestOtp = (phone: string) =>
  call<{ sent: boolean; expiresInSeconds: number; devEcho?: boolean; devCode?: string }>('/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone }) });

export const apiVerifyOtp = (phone: string, code: string) =>
  call<{ token: string; user: ApiUser }>('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ phone, code }) });

export const apiGoogleDemo = (email: string) =>
  call<{ token: string; user: ApiUser }>('/auth/google/demo', { method: 'POST', body: JSON.stringify({ email }) });

export const apiLogoutAudit = () => call<{ ok: boolean }>('/auth/logout', { method: 'POST' });

/* The demo domain dataset — server-owned (server/src/generated). */
export const apiDataset = () => call<Record<string, unknown>>('/dataset');
export const apiMe = () => call<ApiUser>('/me');

/* Effective access (PERFECT-100 §6.2 item 14 · RBAC-6 · FE-2): the server's answer to "which
   surfaces may I render?", computed from the route registry + the caller's custom mask. A RENDER hint
   only — every door re-decides on the server. See app/src/lib/effective.ts. */
export interface EffectiveAccessDto {
  role: string;
  base_role?: string;
  role_key?: string | null;
  custom?: { allow: string[]; deny: string[] } | null;
  scope?: { classes?: Array<{ grade: string; section: string }> };
  capabilities?: Record<string, boolean>;
  nav?: string[];
  doors?: string[];
}
export const apiMeEffective = () => call<EffectiveAccessDto>('/me/effective');
/* Generic GET escape hatch for small service modules (capabilitiesApi) that
   share the single fetch brain instead of spawning another wrapper. */
export const apiGet = <T,>(path: string) => call<T>(path);
/* Generic POST escape hatch (adminApi + rails screens) — same brain, one token
   source, one 401 return-to-login path for the whole app. */
export const apiPost = <T,>(path: string, body?: unknown) =>
  call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

/* ---- read APIs (shape-compatible with the mock service layer) ---- */
export const apiStudents = (params: Record<string, string> = {}) =>
  call<{ students: Record<string, unknown>[] }>(`/students?${new URLSearchParams(params)}`);
export const apiAttendance = (date: string, grade?: string, section?: string) =>
  call<{ date: string; rows: { id: string; name: string; grade: string; section: string; status: string | null }[] }>(
    `/attendance?date=${date}${grade ? `&grade=${grade}` : ''}${section ? `&section=${section}` : ''}`);
export const apiMarkAttendance = (date: string, marks: { studentId: string; status: string }[]) =>
  call<{ ok: boolean; marked: number; absent: number; noticesQueued: number }>('/attendance/mark', { method: 'POST', body: JSON.stringify({ date, marks }) });
export const apiFeeObligations = (status?: string) =>
  call<{ obligations: Record<string, unknown>[] }>(`/fees/obligations${status ? `?status=${status}` : ''}`);

/* ---- fee plans (L4-2.1 against L1-2.2 doors — canon shapes) ----
   Door contract: grades are grade-name STRINGS (students.grade domain), terms
   are {term, label, amount_cents, due_on?}; list key is feePlans, create key is
   feePlan. Idempotency is server-side: (tenant, student, term, label) unique —
   regeneration skips what exists; no client idempotency-key header exists. */
export interface FeePlanTerm { term: string; label: string; amount_cents: number; due_on?: string }
export interface FeePlan {
  id: string;
  name: string;
  category?: string;
  grades: string[];
  terms: FeePlanTerm[];
  academic_year_id?: string | null;
  created_at?: string;
  created_by?: string;
  obligations_generated?: number;
  last_generated_at?: string | null;
}
export const apiFeePlans = () => call<{ feePlans: FeePlan[] }>('/fee-plans');
export const apiCreateFeePlan = (body: { name: string; category?: string; grades: string[]; terms: FeePlanTerm[] }) =>
  call<{ feePlan: FeePlan }>('/fee-plans', { method: 'POST', body: JSON.stringify(body) });
export const apiGenerateFeePlan = (id: string) =>
  call<{ inserted: number; skipped: number; students: number }>(`/fee-plans/${id}/generate`, { method: 'POST', body: '{}' });
export const apiVoidObligation = (id: string, reason: string) =>
  call<{ obligation: Record<string, unknown> }>(`/fees/obligations/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });

/* ---- Wave-5 kernel doors (L1-5.1 ranking service, L1-5.2 collection summary) ---- */
export interface AdmissionFollowup {
  leadId: string; studentName: string; classApplied: string; source: string;
  stage: string; daysInStage: number; stageWeight: number; score: number; stuck: boolean;
  guardianName: string | null; guardianPhone: string | null;
}
export const apiAdmissionFollowups = () =>
  call<{ ruleVersion: string; rule: string; masked: boolean; queue: AdmissionFollowup[] }>('/admissions/followups');
export interface FeeSummaryTerm {
  term: string; obligations: number; billed_cents: string | number; collected_cents: string | number;
  outstanding_cents: string | number; voided: number; fully_paid: number;
}
export const apiFeesSummary = (academicYearId?: string) =>
  call<{ terms: FeeSummaryTerm[]; totals: Record<string, number>; collectionPct: number | null; academicYearId: string | null; note: string }>(
    `/reports/fees/summary${academicYearId ? `?academicYearId=${academicYearId}` : ''}`);

/* ---- exams.assessment plugin doors (L4-3.1) ---- */
export interface ExamSummary {
  id: string; name: string; term?: string; classGrade?: string;
  status?: string; weightage?: Record<string, number>; digest?: string | null; publishedAt?: string | null;
}
export const apiExams = () => call<{ exams: ExamSummary[] }>('/plugins/exams.assessment/exams');
export interface BulkMarkRow { studentId: string; marks: number; maxMarks?: number; component?: string }
export interface BulkMarkFailure { row: number; studentId?: string; error: string }
export const apiExamBulkMarks = (examId: string, rows: BulkMarkRow[]) =>
  call<{ ok: boolean; saved: number; failedRows: BulkMarkFailure[] }>(`/plugins/exams.assessment/exams/${examId}/marks/bulk`, { method: 'POST', body: JSON.stringify({ rows }) });
export const apiExamPublish = (examId: string) =>
  call<{ ok: boolean; actionId: string; status: string }>(`/plugins/exams.assessment/exams/${examId}/publish`, { method: 'POST', body: '{}' });
export const apiExamPublishExecute = (examId: string) =>
  call<{ ok: boolean; status: string; reports: number; digest: string }>(`/plugins/exams.assessment/exams/${examId}/publish/execute`, { method: 'POST', body: '{}' });
export const apiBoardPolicy = () => call<Record<string, unknown>>('/plugins/exams.assessment/board-policy');

/* ---- people.admin student lifecycle doors (L4-3.2) ---- */
export const apiUpdateStudent = (id: string, patch: { name?: string; guardian_name?: string; guardian_phone?: string; bus_route?: string }) =>
  call<{ ok: boolean; student: Record<string, unknown> }>(`/plugins/people.admin/students/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const apiWithdrawStudent = (id: string, body: { reason: string; effective_date?: string; last_school?: string }) =>
  call<{ ok: boolean; student: Record<string, unknown>; effectiveDate: string; note: string }>(`/plugins/people.admin/students/${id}/withdraw`, { method: 'POST', body: JSON.stringify(body) });
export const apiPromoteStudent = (id: string, body: { to_grade?: string; to_section?: string }) =>
  call<{ ok: boolean; student: Record<string, unknown>; from: { grade: string; section: string }; to: { grade: string; section: string } }>(`/plugins/people.admin/students/${id}/promote`, { method: 'POST', body: JSON.stringify(body) });

export const apiMigrationCreateSource = (body: { name: string; kind: string }) =>
  call<{ source: Record<string, unknown> }>('/migration/sources', { method: 'POST', body: JSON.stringify(body) });
export const apiMigrationStage = (id: string, to: 'analyzed' | 'mapped' | 'health-check' | 'shadow') =>
  call<{ source: Record<string, unknown> }>(`/migration/sources/${id}/stage`, { method: 'POST', body: JSON.stringify({ to }) });
export interface MigrationRow { rowNo: number; data: Record<string, unknown> }
export const apiMigrationStageRows = (id: string, rows: MigrationRow[]) =>
  call<{ staged: number; total: number }>(`/migration/sources/${id}/stage-rows`, { method: 'POST', body: JSON.stringify({ rows }) });
export const apiMigrationValidate = (id: string) =>
  call<{ clean: number; errors: number; first: { rowNo: number; error: string }[] }>(`/migration/sources/${id}/validate`, { method: 'POST', body: '{}' });
export const apiMigrationCommit = (id: string) =>
  call<{ created: number; skipped: number; imported: number; status: string }>(`/migration/sources/${id}/commit`, { method: 'POST', body: '{}' });
export interface TrustReceipt { totalRows: number; imported: number; flagged: number; skipped: number; feeTotalCents: string; feePaidCents: string; differenceCents: string; rollbackDays: number }

/* ---- ops.bi read-model doors (L3-4.3) — L4-4.2 swap ---- */
export const apiBiAttendance = (days: number, grade?: string) =>
  call<Record<string, unknown>>(`/plugins/ops.bi/attendance?days=${days}${grade ? `&grade=${encodeURIComponent(grade)}` : ''}`);
export const apiBiAging = () => call<Record<string, unknown>>('/plugins/ops.bi/fees/aging');
export const apiBiFunnel = () => call<Record<string, unknown>>('/plugins/ops.bi/funnel');

/* ---- transport routes door (L4-5.1 door-back) ---- */
export interface LiveRouteRow { id: string; code: string; name: string; vehicle: string | null; capacity: number | null; riders: number | null }
export const apiTransportRoutes = () => call<{ routes: LiveRouteRow[] }>('/transport/routes');

export const apiWorkOrders = () => call<{ workOrders: Record<string, unknown>[]; slaPolicy: Record<string, { responseMins: number; resolveHours: number }> }>('/work-orders');
export const apiCreateWorkOrder = (body: { title: string; description?: string; category: string; priority: string; assetId?: string }) =>
  call<{ workOrder: Record<string, unknown> }>('/work-orders', { method: 'POST', body: JSON.stringify(body) });
export const apiAssets = () => call<{ assets: Record<string, unknown>[] }>('/assets');
export const apiWorkOrderStatus = (id: string, to: string, costCents?: number) =>
  call<{ workOrder: Record<string, unknown> }>(`/work-orders/${id}/status`, { method: 'POST', body: JSON.stringify({ to, ...(costCents != null ? { costCents } : {}) }) });
export const apiCases = (status?: string) => call<{ cases: Record<string, unknown>[] }>(`/cases${status ? `?status=${status}` : ''}`);
export const apiCreateCase = (body: { kind: string; title: string; detail?: string; priority?: string; origin?: string }) =>
  call<{ case: Record<string, unknown> }>('/cases', { method: 'POST', body: JSON.stringify(body) });
export const apiCase = (id: string) => call<{ case: Record<string, unknown> }>(`/cases/${id}`);
export const apiMyCases = (status?: string) => call<{ cases: Record<string, unknown>[] }>(`/my-cases${status ? `?status=${status}` : ''}`);
export const apiActions = (status?: string) => call<{ actions: Record<string, unknown>[] }>(`/actions${status ? `?status=${status}` : ''}`);
export const apiDecideAction = (id: string, decision: 'approved' | 'dismissed', note?: string) =>
  call<{ ok: boolean; execution: unknown }>(`/actions/${id}/decide`, { method: 'POST', body: JSON.stringify({ decision, note }) });
export const apiEvents = (since?: string) => call<{ events: (LiveEvent & { created_at: string })[] }>(`/events${since ? `?since=${encodeURIComponent(since)}` : ''}`);
export const apiAudit = (limit = 100) => call<{ entries: Record<string, unknown>[] }>(`/audit?limit=${limit}`);
export const apiRoutes = () => call<{ routes: Record<string, unknown>[] }>('/transport/routes');
export const apiTransportEvent = (routeCode: string, delayMins: number, note?: string) =>
  call<{ event: Record<string, unknown>; riders: number; action: Record<string, unknown> | null }>('/transport/events', { method: 'POST', body: JSON.stringify({ routeCode, kind: 'gps_delay', delayMins, note }) });
export const apiMemory = () => call<{ entries: Record<string, unknown>[] }>('/memory');
export const apiMigrationSources = () => call<{ sources: Record<string, unknown>[] }>('/migration/sources');
export const apiMigrationActivate = () => call<{ trustReceipt: Record<string, unknown> }>('/migration/activate', { method: 'POST', body: '{}' });

/* ---- canonical demo credentials (seeded tenant) ---- */
export const DEMO_ACCOUNTS = [
  { email: 'principal@meridian.edu', label: 'Principal — Dr. Meera Krishnan' },
  { email: 'teacher@meridian.edu', label: 'Teacher — Priya Iyer' },
  { email: 'finance@meridian.edu', label: 'Finance — Ms. Rao' },
  { email: 'transport@meridian.edu', label: 'Transport desk' },
  { email: 'facilities@meridian.edu', label: 'Facilities desk' },
  { email: 'technician@meridian.edu', label: 'Technician — Arif Shaikh' },
  { email: 'parent@meridian.edu', label: 'Parent — Kavita Sharma' },
  { email: 'owner@meridian.edu', label: 'Owner' },
  { email: 'itadmin@meridian.edu', label: 'IT Admin — Sam Dsouza' },
];
export const DEMO_PASSWORD = 'schoolos-demo';

/* ---- plugins (server truth for enable/disable) ---- */
export const apiEnablePlugin = (id: string, version: string, pclass: string, permissions: string[]) =>
  call<{ plugin: Record<string, unknown> }>(`/plugins/${id}/enable`, { method: 'POST', body: JSON.stringify({ version, class: pclass, permissions }) });
export const apiDisablePlugin = (id: string) =>
  call<{ plugin: Record<string, unknown> }>(`/plugins/${id}/disable`, { method: 'POST', body: '{}' });

/* ---- admissions.funnel (wave-2 #1; server truth for PII masking + lattice) ---- */
export interface ApiFunnelLead {
  id: string; studentName: string; classApplied: string; source: string; stage: string;
  admissionYear: string | null; createdAt: string; updatedAt: string;
  guardianName: string | null; guardianPhone: string | null; /* masked shape for non-office roles */
}
export const apiFunnelLeads = () => call<{ masked: boolean; leads: ApiFunnelLead[] }>(`/plugins/admissions.funnel/leads`);
export const apiFunnelMoveStage = (id: string, to: string) =>
  call<{ ok: boolean; from: string; to: string; actionId: string | null }>(`/plugins/admissions.funnel/leads/${id}/stage`, { method: 'POST', body: JSON.stringify({ to }) });
export const apiFunnelHistory = (id: string) =>
  call<{ history: { from_stage: string | null; to_stage: string; actor: string; at: string }[] }>(`/plugins/admissions.funnel/leads/${id}/history`);
export const apiFunnelSummary = () => call<{ byStage: Record<string, number>; total: number }>(`/plugins/admissions.funnel/summary`);

/* ---- ops.visitors (wave-2 #2; gate pass — DESK-gated doors, fail-closed release) ---- */
export interface ApiVisitorVisit {
  id: string; visitorName: string; visitorPhone: string | null; purpose: string; detail: string | null;
  status: string; badge: string; studentName: string | null; verified: boolean; createdAt: string; updatedAt: string;
}
export const apiVisitorsList = (status?: string) =>
  call<{ visits: ApiVisitorVisit[] }>(`/plugins/ops.visitors/visitors${status ? `?status=${encodeURIComponent(status)}` : ''}`);
export const apiVisitorLog = (body: { visitorName: string; visitorPhone?: string; purpose: string; detail?: string; studentId?: string }) =>
  call<{ ok: boolean; visitId: string; badge: string; status: string }>(`/plugins/ops.visitors/visitors`, { method: 'POST', body: JSON.stringify(body) });
export const apiVisitorCheckin = (id: string) =>
  call<{ ok: boolean; status: string }>(`/plugins/ops.visitors/visitors/${id}/checkin`, { method: 'POST', body: '{}' });
export const apiVisitorPickup = (id: string) =>
  call<{ ok: boolean; status: string; ttlMinutes: number; devCode?: string }>(`/plugins/ops.visitors/visitors/${id}/pickup`, { method: 'POST', body: '{}' });
/* verify door returns 401 for invalid/expired/consumed OTP — that is a DOOR error,
   not session expiry. The global call() redirects any 401 to /login (auth convention),
   which would log the desk out on a wrong guardian code. This wrapper performs the
   same request without the 401 redirect — additive only; token handling untouched. */
export const apiVisitorVerify = async (id: string, code: string) => {
  const csrf = csrfToken();
  const res = await fetch(`${LIVE_BASE}/plugins/ops.visitors/visitors/${id}/pickup/verify`, {
    method: 'POST',
    ...(SAME_ORIGIN ? { credentials: 'same-origin' as RequestCredentials } : {}),
    headers: { 'content-type': 'application/json', ...authHeaders(), ...(csrf ? { 'x-csrf-token': csrf } : {}) },
    body: JSON.stringify({ code }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as { ok: boolean; status: string };
};
export const apiVisitorComplete = (id: string, override: boolean, note?: string) =>
  call<{ ok: boolean; status: string; overrideUsed?: boolean }>(`/plugins/ops.visitors/visitors/${id}/complete`, { method: 'POST', body: JSON.stringify(override ? { override: true, note } : {}) });
export const apiVisitorDeny = (id: string, note?: string) =>
  call<{ ok: boolean; status: string }>(`/plugins/ops.visitors/visitors/${id}/deny`, { method: 'POST', body: JSON.stringify(note ? { note } : {}) });
