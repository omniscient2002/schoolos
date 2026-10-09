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

/* OPP-SEC-1: step-up re-auth. A critical door (plugin disable, role grant, DSR erasure) answers 403
 * `stepUpRequired`; we ask for the password once, exchange it for a 5-minute token, and retry the
 * original request with `x-step-up-token`. The token is cached in memory for its window. */
let stepUpToken: string | null = null;
let stepUpExpiresAt = 0;
async function obtainStepUpToken(): Promise<string | null> {
  if (stepUpToken && Date.now() < stepUpExpiresAt) return stepUpToken;
  if (typeof window === 'undefined') return null;
  const password = window.prompt('Confirm your password to continue — this is a high-risk action.');
  if (!password) return null;
  const res = await fetch(`${BASE}/me/step-up`, {
    method: 'POST',
    ...(SAME_ORIGIN ? { credentials: 'same-origin' as RequestCredentials } : {}),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  stepUpToken = (body as { stepUpToken?: string }).stepUpToken ?? null;
  stepUpExpiresAt = Date.now() + Math.max(0, ((body as { expiresIn?: number }).expiresIn ?? 300) - 10) * 1000;
  return stepUpToken;
}

/* F-26: every request gets a deadline. A hung request used to hang the screen
   forever (no AbortController anywhere except Login+renew). Default 30s;
   callers that move bytes (exports, uploads) pass a larger `timeoutMs`.
   An existing caller signal is honoured too (AbortSignal.any). */
export const DEFAULT_TIMEOUT_MS = 30000;
async function call<T>(path: string, opts: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const method = (opts.method ?? 'GET').toUpperCase();
  const csrf = csrfToken();
  const timeoutMs = typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;
  /* P2-1: `content-type` is NOT a CORS-safelisted request header, so sending it on a bodyless
     request turns every GET into a PREFLIGHTED one — an extra round trip per read, on every screen
     load, for every user. Measured over a real onboarding run: 641 of 2,254 calls (28%) were
     preflights. The header is only meaningful when there is a body to describe, so it is sent only
     then. This is the single hottest function in the app; the behaviour is pinned by a test. */
  const hasBody = opts.body != null && opts.body !== '';
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...opts,
      signal,
    /* L5-3.2: same-origin deployments authenticate via the HttpOnly cookie and
       receive Set-Cookie (login / logout Max-Age=0) — same-origin needs no CORS
       cooperation. Cross-origin dev keeps the pure bearer flow. */
    ...(SAME_ORIGIN ? { credentials: 'same-origin' as RequestCredentials } : {}),
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method) ? { 'x-csrf-token': csrf } : {}),
      ...(opts.headers ?? {}),
    },
    });
  } catch (e) {
    // AbortSignal.timeout rejects with TimeoutError; a caller-owned abort keeps
    // its own reason. Only the deadline maps to the friendly timeout copy
    // (friendlyErrors.ts already rewrites 'timeout'). Name-checked, not
    // instanceof: DOMException realms differ between jsdom/node and browsers.
    if ((e as { name?: unknown } | null)?.name === 'TimeoutError') {
      const err = new Error(`timeout after ${timeoutMs}ms — the server took too long to answer`) as Error & { code?: string; status?: number };
      err.code = 'TIMEOUT';
      throw err;
    }
    throw e;
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) {
    // session expired or revoked — clear and let the AuthGate take over
    localStorage.removeItem('schoolos.session');
    setToken(null);
    redirectToLoginWithReturn();
    throw new Error('session expired');
  }
  if (res.status === 403 && (body as { stepUpRequired?: boolean }).stepUpRequired) {
    const existing = (opts.headers as Record<string, string> | undefined)?.['x-step-up-token'];
    if (!existing) {
      const stepToken = await obtainStepUpToken();
      if (stepToken) {
        return call<T>(path, { ...opts, headers: { ...(opts.headers ?? {}), 'x-step-up-token': stepToken } });
      }
    }
  }
  if (!res.ok) {
    const message = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    const requestId = res.headers.get('x-request-id');
    /* UX-08: carry the server's stable error `code` on the Error so screens can
       show a plain-language explanation instead of the raw server string. */
    const err = new Error(requestId ? `${message} (request ${requestId})` : message) as Error & { code?: string; status?: number; payload?: unknown };
    const code = (body as { code?: unknown }).code;
    if (typeof code === 'string') err.code = code;
    err.status = res.status;
    /* A door that answers a REFUSAL with structured detail (the import mapper's
       per-field `errors[]`, a validation list) would otherwise reach the screen as
       "HTTP 400" and nothing else. The body rides along; `message` still wins for
       every screen that only ever shows the string. */
    err.payload = body;
    throw err;
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

/* I5: `apiGoogleDemo`, `DEMO_ACCOUNTS` and `DEMO_PASSWORD` were dead exports with no consumers —
   removed. The demo SSO door still exists server-side (gated by AUTH_DEV_SSO) but no shipped screen
   calls it (the Google tab is disabled and says so). */

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
/* Generic PUT/DELETE escape hatches (library v2 services) — same brain, one token source. */
export const apiPut = <T,>(path: string, body?: unknown) =>
  call<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) });
export const apiDelete = <T,>(path: string) => call<T>(path, { method: 'DELETE' });
export const apiPatch = <T,>(path: string, body?: unknown) =>
  call<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });

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
export interface FeeInstallmentPart { amount_cents?: number; due_on?: string }
export interface FeePlan {
  id: string;
  name: string;
  category?: string;
  grades: string[];
  terms: FeePlanTerm[];
  fee_head_id?: string | null;
  fee_head_name?: string | null;
  installments?: FeeInstallmentPart[] | null;
  academic_year_id?: string | null;
  created_at?: string;
  created_by?: string;
  obligations_generated?: number;
  last_generated_at?: string | null;
}
export const apiFeePlans = () => call<{ feePlans: FeePlan[] }>('/fee-plans');
export const apiCreateFeePlan = (body: { name: string; category?: string; grades: string[]; terms: FeePlanTerm[]; feeHeadId?: string; installments?: FeeInstallmentPart[]; hikePct?: number; consultationMeetingId?: string }) =>
  call<{ feePlan: FeePlan }>('/fee-plans', { method: 'POST', body: JSON.stringify(body) });
export const apiGenerateFeePlan = (id: string) =>
  call<{ inserted: number; skipped: number; students: number; installmentsCreated?: number; autoConcessions?: number; billingRunId?: string }>(`/fee-plans/${id}/generate`, { method: 'POST', body: '{}' });

/* ---- fee heads (FEE-DAT-1b) ---- */
export interface FeeHead {
  id: string; name: string; category: string | null; is_refundable: boolean;
  tax_code: string | null; gl_ledger_name: string | null; active: boolean; obligations?: number;
}
export const apiFeeHeads = () => call<{ feeHeads: FeeHead[] }>('/fees/heads');
export const apiCreateFeeHead = (body: { name: string; category?: string; isRefundable?: boolean; taxCode?: string; glLedgerName?: string }) =>
  call<{ feeHead: FeeHead }>('/fees/heads', { method: 'POST', body: JSON.stringify(body) });

/* ---- installments (FEE-DAT-5b) ---- */
export interface LiveInstallment {
  id: string; obligation_id: string; seq: number; due_on: string | null; amount_cents: number;
  status: string; payment_id: string | null; obligation_label?: string | null; term?: string | null;
  student_id?: string; student_name?: string; grade?: string; section?: string;
}
export const apiInstallments = (q: { obligationId?: string; studentId?: string; status?: string } = {}) => {
  const p = new URLSearchParams();
  if (q.obligationId) p.set('obligationId', q.obligationId);
  if (q.studentId) p.set('studentId', q.studentId);
  if (q.status) p.set('status', q.status);
  const qs = p.toString();
  return call<{ installments: LiveInstallment[] }>(`/fees/installments${qs ? `?${qs}` : ''}`);
};

/* ---- student own-dues (FEE-PRD-9) ---- */
export interface StudentFeeView {
  linked: boolean; studentId: string | null;
  obligations: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
  outstandingCents: number;
}
export const apiStudentFees = () => call<StudentFeeView>('/student/fees');

/* ---- fee-message delivery view (FEE-DEL-6) ---- */
export interface LiveFeeMessage {
  id: string; template: string; channel: string; status: string; provider: string | null;
  provider_ref: string | null; attempts: number; last_error: string | null;
  dedup_key: string | null; sent_at: string | null; delivered_at: string | null; created_at: string;
}
export const apiFeeDelivery = (status?: string) =>
  call<{ messages: LiveFeeMessage[] }>(`/fees/delivery${status ? `?status=${encodeURIComponent(status)}` : ''}`);
export const apiVoidObligation = (id: string, reason: string) =>
  call<{ obligation: Record<string, unknown> }>(`/fees/obligations/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });

/* ---- payments list, refund, reconciliation, dunning, receipts (FEE-API-*) ---- */
export interface LivePayment {
  id: string; student_id: string; obligation_id: string | null; amount_cents: number; refunded_cents: number;
  method: string; status: string; gateway_ref: string | null; receipt_no: string | null;
  confirmed_at: string | null; created_at: string; settled_via: string | null; reconciliation_status: string;
  gateway_fact?: 'captured' | 'recorded' | null;
  student_name?: string; grade?: string; section?: string; obligation_label?: string | null; term?: string | null;
}
export const apiPayments = (q: { status?: string; method?: string; studentId?: string; recon?: 'disputed' } = {}) => {
  const p = new URLSearchParams();
  if (q.status) p.set('status', q.status);
  if (q.method) p.set('method', q.method);
  if (q.studentId) p.set('studentId', q.studentId);
  if (q.recon) p.set('recon', q.recon);
  const qs = p.toString();
  return call<{ payments: LivePayment[]; scoped: string }>(`/payments${qs ? `?${qs}` : ''}`);
};
export interface ReconRun { id: string; ran_at: string; source: 'manual' | 'worker'; ghost: number; missing: number; orphan: number; amount_mismatch: number; actions_raised: number; total: number }
export const apiReconRuns = (limit = 5) =>
  call<{ runs: ReconRun[] }>(`/payments/recon-runs?limit=${limit}`);
export const apiRefundPayment = (id: string, body: { reason?: string; refundCents?: number } = {}) =>
  call<{ payment: { id: string; status: string; refunded_cents: number }; gateway: Record<string, unknown>; refundedCents: number }>(
    `/payments/${id}/refund`, { method: 'POST', body: JSON.stringify(body) });
export interface ReconDiscrepancy { id: string; [k: string]: unknown }
export const apiMarkMatched = (id: string, note?: string) =>
  call<{ payment: { id: string; reconciliation_status: string } }>(
    `/payments/${id}/mark-matched`, { method: 'POST', body: JSON.stringify({ note }) });
export const apiReconcile = () =>
  call<{ checked: Record<string, number>; discrepancies: { ghostLocalConfirmed: ReconDiscrepancy[]; missingLocalConfirmation: ReconDiscrepancy[]; orphanNoRailLog: ReconDiscrepancy[]; amountMismatch: ReconDiscrepancy[] }; total: number }>(
    '/payments/reconcile', { method: 'POST', body: '{}' });
export const apiRunDunning = () =>
  call<{ queued: number; overdueQueued: number; beforeDueQueued: number; escalated: number; skippedNoContact: number; note?: string }>(
    '/fees/dunning/run', { method: 'POST', body: '{}' });
export interface LiveReceipt {
  id: string; receipt_no: string; payment_id: string; student_id: string; amount_cents: number;
  issued_at: string; voided_at: string | null; student_name?: string; obligation_label?: string | null; term?: string | null;
}
export const apiReceipts = () => call<{ receipts: LiveReceipt[] }>('/fees/receipts');
export const apiReceipt = (id: string) => call<{ receipt: LiveReceipt & Record<string, unknown> }>(`/fees/receipts/${id}`);
export interface LiveConcession {
  id: string; student_id: string; obligation_id: string | null; kind: string; percent: number | null;
  amount_cents: number | null; reason: string | null; status: string; created_at: string;
  student_name?: string; grade?: string; section?: string; obligation_label?: string | null; term?: string | null;
}
export const apiCreateConcession = (body: { studentId: string; obligationId?: string; kind: string; percent?: number; amountCents?: number; reason?: string }) =>
  call<{ concession: Record<string, unknown> }>('/fees/concessions', { method: 'POST', body: JSON.stringify(body) });
export const apiConcessions = (status?: string) =>
  call<{ concessions: LiveConcession[] }>(`/fees/concessions${status ? `?status=${encodeURIComponent(status)}` : ''}`);
export const apiDecideConcession = (id: string, decision: 'approve' | 'reject') =>
  call<{ concession: LiveConcession }>(`/fees/concessions/${id}/decide`, { method: 'POST', body: JSON.stringify({ decision }) });

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

/* ---- ops.import: the column-mapping + dry-run engine (writes nothing) ----
   The kernel commit doors above are the only authority that creates records; this
   plugin answers "what would this file do?" before a single row is staged. */
export interface ImportFieldDef {
  required: boolean;
  type: 'string' | 'phone' | 'date' | 'integer' | 'boolean' | 'enum';
  maxLen?: number;
  min?: number;
  enum?: string[];
  default?: unknown;
  normalize?: 'uppercase';
  description?: string;
  examples?: string[];
}
export interface ImportSchema {
  kind: string;
  fields: Record<string, ImportFieldDef>;
  identity: string;
  notes: string[];
}
export const apiImportSchema = (kind: string) =>
  call<{ schema: ImportSchema; kinds: string[] }>(`/plugins/ops.import/schema/${encodeURIComponent(kind)}`);
export const apiImportValidateMapping = (kind: string, mapping: Record<string, string>) =>
  call<{ ok: true; schema: string[] }>('/plugins/ops.import/validate-mapping', { method: 'POST', body: JSON.stringify({ kind, mapping }) });
export interface ImportShadowReport {
  kind: string;
  totalRows: number;
  analyzed: number;
  truncated: boolean;
  validRows: number;
  errorRows: number;
  fieldErrors: number;
  topErrors: { error: string; rows: number }[];
  diff: Record<string, unknown> | null;
}
export const apiImportShadow = (kind: string, mapping: Record<string, string>, rows: Record<string, string>[]) =>
  call<ImportShadowReport & { ok: true }>('/plugins/ops.import/shadow', { method: 'POST', body: JSON.stringify({ kind, mapping, rows }) });

/* ---- ops.bi read-model doors (L3-4.3) — L4-4.2 swap ---- */
export const apiBiAttendance = (days: number, grade?: string) =>
  call<Record<string, unknown>>(`/plugins/ops.bi/attendance?days=${days}${grade ? `&grade=${encodeURIComponent(grade)}` : ''}`);
export const apiBiAging = () => call<Record<string, unknown>>('/plugins/ops.bi/fees/aging');
export const apiBiFunnel = () => call<Record<string, unknown>>('/plugins/ops.bi/funnel');
export const apiBiHomework = (grade?: string) =>
  call<Record<string, unknown>>(`/plugins/ops.bi/homework${grade ? `?grade=${encodeURIComponent(grade)}` : ''}`);

/* ---- transport routes door (L4-5.1 door-back) ---- */
export interface LiveRouteRow { id: string; code: string; name: string; vehicle: string | null; capacity: number | null; riders: number | null }
export const apiTransportRoutes = () => call<{ routes: LiveRouteRow[] }>('/transport/routes');

export const apiWorkOrders = () => call<{ workOrders: Record<string, unknown>[]; slaPolicy: Record<string, { responseMins: number; resolveHours: number }> }>('/work-orders');
export const apiCreateWorkOrder = (body: { title: string; description?: string; category: string; priority: string; assetId?: string }) =>
  call<{ workOrder: Record<string, unknown> }>('/work-orders', { method: 'POST', body: JSON.stringify(body) });
export const apiAssets = () => call<{ assets: Record<string, unknown>[] }>('/assets');

/* ── health.clinic — the infirmary log. Nurse-lane PII: the read door is deliberately NOT a teacher,
   finance or parent read, and this screen asks the same question before it calls it. ───────────────── */
export interface ClinicVisit {
  visitId: string; studentId: string; studentName: string; visitedAt: string;
  complaint: string; temperatureC?: number | null; action: string; notes?: string | null;
}
export const apiClinicVisits = () => call<{ visits: ClinicVisit[] }>('/plugins/health.clinic/visits');
export const apiLogClinicVisit = (body: { studentId: string; complaint: string; temperatureC?: number; action?: string; notes?: string }) =>
  call<{ ok: boolean; visitId: string; action: string; visitedAt: string; noticeActionId?: string | null }>(
    '/plugins/health.clinic/visits', { method: 'POST', body: JSON.stringify(body) });
export const apiIssueSickPass = (visitId: string) =>
  call<{ ok: boolean; passId: string; validUntil: string }>(`/plugins/health.clinic/visits/${visitId}/sick-pass`, { method: 'POST', body: '{}' });
export const apiCorrectClinicVisit = (visitId: string, body: { correction: string; action?: string }) =>
  call<{ ok: boolean }>(`/plugins/health.clinic/visits/${visitId}/correct`, { method: 'POST', body: JSON.stringify(body) });

/* ── the statutory / accounting exports ─────────────────────────────────────────────────────────────
   Three add-ons whose whole product IS a file a school has to file or hand to an accountant:
   UDISE (aggregate return), CBSE OASIS (per-exam result upload) and Tally (voucher XML). Each door
   is a GET/POST that streams a file; the wrappers below fetch it as a blob so the screen can offer a
   real download instead of a "copy this URL" instruction. */
export const apiUdiseColumns = () => call<Record<string, unknown>>('/plugins/ops.udise/columns');
/* Each export door streams a file, so the wrapper FETCHES it with the session bearer and hands the
   browser a real download. A plain <a href> to the same URL would 401: these are authenticated doors,
   and "download this link" is the instruction that always fails silently in production. */
async function downloadFile(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { headers: { ...authHeaders() } });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json() as { error?: string }).error ?? ''; } catch { /* not json */ }
    throw new Error(detail || `The export could not be produced (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(href);
}
export const downloadUdiseExport = (year: string, filename: string, format: 'csv' | 'json' = 'csv') =>
  downloadFile(`${LIVE_BASE}/plugins/ops.udise/export?year=${encodeURIComponent(year)}&format=${format}`, filename);
export const apiCbseRules = () => call<{ pack: string; version: string; board: string; rules: Record<string, string> }>('/plugins/pack.cbse/rules');
export const apiCbseValidateExam = (examId: string) =>
  call<{ ok?: boolean; violations?: { rule?: string; detail?: string }[]; notes?: string[]; checked?: number }>(
    `/plugins/pack.cbse/validate/exam/${examId}`);
export const downloadCbseOasis = (examId: string, filename: string) =>
  downloadFile(`${LIVE_BASE}/plugins/pack.cbse/export/oasis/${examId}`, filename);
export const apiTallyDaybook = (from?: string, to?: string) =>
  call<{ entries?: Record<string, unknown>[] }>(`/plugins/accounting.tally/daybook${from || to ? `?${from ? `from=${from}` : ''}${from && to ? '&' : ''}${to ? `to=${to}` : ''}` : ''}`);
export const apiTallyExports = () => call<{ exports: Record<string, unknown>[] }>('/plugins/accounting.tally/exports');

/* ── hr.leave — staff absence is a FACT the timetable consumes, not a request workflow.
   Marking one publishes `staff.leave.marked.v1`; cancelling it withdraws the fact. The roster read
   is the coordination desk's: who is absent on a date, who is on duty. ───────────────────────── */
export interface LiveLeaveRow {
  leaveId: string; staffId: string; staffName: string; leaveDate: string;
  kind: string; status: string; reason?: string | null;
}
export const apiLeaves = () => call<{ leaves: LiveLeaveRow[] }>('/plugins/hr.leave/leave');
export const apiMarkLeave = (body: { staffId: string; leaveDate: string; kind: string; reason?: string }) =>
  call<{ ok: boolean; leaveId: string; staffName: string }>('/plugins/hr.leave/leave', { method: 'POST', body: JSON.stringify(body) });
export const apiCancelLeave = (id: string) =>
  call<{ ok: boolean; status: string }>(`/plugins/hr.leave/leave/${id}/cancel`, { method: 'POST', body: '{}' });
export const apiDutyRoster = (date: string) => call<{
  date: string;
  absent: { leaveId: string; staffId: string; name: string; role: string; kind: string; reason?: string | null; verification?: string }[];
  onDuty: { staffId: string; name: string; role: string; verification?: string }[];
  blocked?: { staffId: string; name: string; role: string; reason: string }[];
}>(`/plugins/hr.leave/roster/${date}`);
export const apiWorkOrderStatus = (id: string, to: string, costCents?: number) =>
  call<{ workOrder: Record<string, unknown> }>(`/work-orders/${id}/status`, { method: 'POST', body: JSON.stringify({ to, ...(costCents != null ? { costCents } : {}) }) });
export const apiCases = (status?: string) => call<{ cases: Record<string, unknown>[] }>(`/cases${status ? `?status=${status}` : ''}`);
export const apiCreateCase = (body: { kind: string; title: string; detail?: string; priority?: string; origin?: string }) =>
  call<{ case: Record<string, unknown> }>('/cases', { method: 'POST', body: JSON.stringify(body) });
/** One case row (app.cases). Typed once, here, because the workspace renders every column of it
 *  and a `Record<string, unknown>` would push the whole shape into casts at the call site. */
export interface ApiCase {
  id: string;
  code: string;
  kind: string;
  title: string;
  detail: string | null;
  priority: string;
  status: string;
  owner: string | null;
  opened_by: string | null;
  origin: string;
  sla_due_at: string | null;
  linked_refs: { label?: string; ref?: string }[] | null;
  created_at: string;
  resolved_at: string | null;
}
export const apiCase = (id: string) => call<{ case: ApiCase }>(`/cases/${encodeURIComponent(id)}`);
/* The case flow is the server's, not the board's: open → triaged → in-progress → resolved → closed. */
export const apiCaseStatus = (id: string, to: string) =>
  call<{ case: ApiCase }>(`/cases/${id}/status`, { method: 'POST', body: JSON.stringify({ to }) });
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
/* ---- OPP: owner/principal oversight product (docs/OWNER-PRINCIPAL-PERFECT-100.md) ---- */
export const apiBoardPack = () => call<Record<string, unknown>>('/reports/board-pack');
export const apiBoardPackSnapshot = (kind = 'board_pack', period?: string) =>
  call<{ snapshot: Record<string, unknown> | null; content_hash: string; already?: boolean }>('/reports/board-pack/snapshot', { method: 'POST', body: JSON.stringify({ kind, period }) });
export const apiPrincipalBrief = () => call<{ brief: Record<string, unknown> | null; brief_date: string | null }>('/brief/principal');
export const apiAnnouncements = () => call<{ announcements: Record<string, unknown>[] }>('/announcements');
export const apiCreateAnnouncement = (body: Record<string, unknown>) =>
  call<{ announcement: Record<string, unknown>; recipients: number }>('/announcements', { method: 'POST', body: JSON.stringify(body) });
export const apiApproveAnnouncement = (id: string) =>
  call<{ announcement: Record<string, unknown> }>(`/announcements/${id}/approve`, { method: 'POST', body: '{}' });
export const apiCompliance = () => call<{ items: Record<string, unknown>[] }>('/compliance');
export const apiCreateCompliance = (body: Record<string, unknown>) =>
  call<{ item: Record<string, unknown> | null; already?: boolean }>('/compliance', { method: 'POST', body: JSON.stringify(body) });
export const apiFileCompliance = (id: string, evidenceRef?: string) =>
  call<{ item: Record<string, unknown> }>(`/compliance/${id}/file`, { method: 'POST', body: JSON.stringify({ evidenceRef }) });
export const apiCertificates = () => call<{ certificates: Record<string, unknown>[] }>('/certificates');
export const apiRequestCertificate = (body: Record<string, unknown>) =>
  call<{ certificate: Record<string, unknown> }>('/certificates', { method: 'POST', body: JSON.stringify(body) });
export const apiSignCertificate = (id: string) =>
  call<{ certificate: Record<string, unknown> }>(`/certificates/${id}/sign`, { method: 'POST', body: '{}' });
export const apiCertificateArtifact = (id: string) =>
  call<{ artifact: { id: string; filename: string; mime: string; sha256: string } }>(`/certificates/${encodeURIComponent(id)}/artifact`);
export const apiAnnouncementReceipts = (id: string) =>
  call<{ receipts: { status: string; n: number }[]; total: number }>(`/announcements/${encodeURIComponent(id)}/receipts`);
export const apiSnapshots = () => call<{ snapshots: Record<string, unknown>[] }>('/reports/snapshots');
export const apiSnapshot = (id: string) =>
  call<{ snapshot: Record<string, unknown>; hash_ok: boolean; recomputed_hash: string }>(`/reports/snapshots/${encodeURIComponent(id)}`);
export const apiOwnerHome = () => call<Record<string, unknown>>('/owner/home');
export const apiPrincipalHome = () => call<Record<string, unknown>>('/principal/home');
export const apiFeeSettings = () => call<{ settings: Record<string, unknown> }>('/fees/settings');
export const apiSaveFeeSettings = (body: Record<string, unknown>) =>
  call<{ settings: Record<string, unknown> }>('/fees/settings', { method: 'PUT', body: JSON.stringify(body) });
export const apiRunLateFees = (dryRun = false) =>
  call<{ updated: number; dryRun?: boolean; wouldUpdate?: number }>(`/fees/late-fees/run${dryRun ? '?dryRun=true' : ''}`, { method: 'POST', body: '{}' });
export const apiObligationInvoice = (id: string) =>
  call<{ invoice: { fileId: string; filename: string; sha256: string }; cached: boolean }>(`/fees/obligations/${encodeURIComponent(id)}/invoice`);
export const apiVoidBillingRun = (id: string, reason?: string) =>
  call<{ ok: boolean; voidedObligations: number }>(`/billing-runs/${encodeURIComponent(id)}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
export const apiMigrationSources = () => call<{ sources: Record<string, unknown>[] }>('/migration/sources');
export const apiMigrationActivate = () => call<{ trustReceipt: Record<string, unknown> }>('/migration/activate', { method: 'POST', body: '{}' });

/* ---- plugins (server truth for enable/disable) ---- */
export const apiEnablePlugin = (id: string, version: string, pclass: string, permissions: string[]) =>
  call<{ plugin: Record<string, unknown> }>(`/plugins/${id}/enable`, { method: 'POST', body: JSON.stringify({ version, class: pclass, permissions }) });
export const apiDisablePlugin = (id: string) =>
  call<{ plugin: Record<string, unknown> }>(`/plugins/${id}/disable`, { method: 'POST', body: '{}' });

/* ---- admissions.funnel (wave-2 #1; server truth for PII masking + lattice) ---- */
export interface ApiFunnelLead {
  id: string; studentName: string; classApplied: string; source: string; stage: string;
  admissionYear: string | null; documentCount?: number; createdAt: string; updatedAt: string;
  guardianName: string | null; guardianPhone: string | null; /* masked shape for non-office roles */
}
export interface ApiFunnelActivity {
  id: string; kind: string; scheduled_at: string | null; completed_at: string | null;
  outcome: string | null; notes: string | null; actor: string; created_at: string;
}
export const apiFunnelLeads = (stage?: string) =>
  call<{ masked: boolean; capped: boolean; leads: ApiFunnelLead[] }>(`/plugins/admissions.funnel/leads${stage ? `?stage=${encodeURIComponent(stage)}` : ''}`);
export const apiCreateFunnelLead = (body: { studentName: string; guardianName?: string; guardianPhone: string; classApplied: string; source?: string; admissionYear?: string }) =>
  call<{ ok: boolean; leadId: string; stage: string; admissionYear: string }>(`/plugins/admissions.funnel/leads`, { method: 'POST', body: JSON.stringify(body) });
export const apiEditFunnelLead = (id: string, patch: { studentName?: string; guardianName?: string; guardianPhone?: string; classApplied?: string; source?: string }) =>
  call<{ ok: boolean; lead: Record<string, unknown> }>(`/plugins/admissions.funnel/leads/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const apiFunnelMoveStage = (id: string, to: string) =>
  call<{ ok: boolean; from: string; to: string; actionId: string | null }>(`/plugins/admissions.funnel/leads/${id}/stage`, { method: 'POST', body: JSON.stringify({ to }) });
export const apiFunnelHistory = (id: string) =>
  call<{ history: { from_stage: string | null; to_stage: string; actor: string; at: string }[] }>(`/plugins/admissions.funnel/leads/${id}/history`);
export const apiFunnelSummary = () => call<{ byStage: Record<string, number>; total: number }>(`/plugins/admissions.funnel/summary`);
/* GET /school/staff — the school's own staff roster (owner/principal/coordinator/itadmin).
   Added for the operations hub, which was counting `seed.staff` over a live register. */
export const apiSchoolStaff = () => call<{ staff: { id: string; name: string; role: string }[] }>('/school/staff');
export const apiFunnelActivities = (id: string) =>
  call<{ activities: ApiFunnelActivity[] }>(`/plugins/admissions.funnel/leads/${id}/activities`);
export const apiLogFunnelActivity = (id: string, body: { kind: string; scheduledAt?: string; outcome?: string; notes?: string; completed?: boolean }) =>
  call<{ ok: boolean; activity: ApiFunnelActivity }>(`/plugins/admissions.funnel/leads/${id}/activities`, { method: 'POST', body: JSON.stringify(body) });
export const apiAttachFunnelDocument = (id: string, body: { fileId: string; label?: string }) =>
  call<{ ok: boolean; documents: { fileId: string; label: string }[] }>(`/plugins/admissions.funnel/leads/${id}/documents`, { method: 'POST', body: JSON.stringify(body) });
export const apiFunnelOfferLetter = (id: string) =>
  call<{ leadId: string; studentName: string; classApplied: string; admissionYear: string; letter: string }>(`/plugins/admissions.funnel/leads/${id}/offer-letter`);
export interface FunnelHealth {
  healthy: boolean; probe: string; openLeads: number; stuckOver7d: number;
  stages: Record<string, { count: number; oldestDays: number | null }>;
  orphans: { strandedEnrolled: { id: string; student_name: string; stage: string }[]; danglingActions: { id: string; code: string; lead_id: string }[] };
}
export const apiFunnelHealth = () => call<FunnelHealth>(`/plugins/admissions.funnel/health`);

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

/* ---- workflow rules (L2-5.2 step-runner — owner / principal / IT admin) ---- */
export interface WorkflowRule { id: string; name: string; topic: string; condition: { field?: string; op?: string; value?: unknown } | null; action: Record<string, unknown>; enabled: boolean; created_at: string }
export const apiWorkflowRules = () => call<{ rules: WorkflowRule[] }>('/workflow-rules');
export const apiCreateWorkflowRule = (b: { name: string; topic: string; condition?: unknown; action: { kind: 'outbox' | 'comms'; [k: string]: unknown } }) =>
  call<{ id: string }>('/workflow-rules', { method: 'POST', body: JSON.stringify(b) });
export const apiDisableWorkflowRule = (id: string) => call<{ ok: boolean }>(`/workflow-rules/${id}`, { method: 'DELETE' });
