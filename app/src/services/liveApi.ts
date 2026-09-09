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

export interface ApiUser { id: string; name: string; role: string; email: string; tenantId: string; school?: { name: string | null; slug: string | null } }

let token: string | null = localStorage.getItem('schoolos_token');

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
  if (t) localStorage.setItem('schoolos_token', t);
  else localStorage.removeItem('schoolos_token');
}

async function call<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
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
    redirectToLoginWithReturn();
    throw new Error('session expired');
  }
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

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
export const apiWorkOrders = () => call<{ workOrders: Record<string, unknown>[]; slaPolicy: Record<string, { responseMins: number; resolveHours: number }> }>('/work-orders');
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
  const token = localStorage.getItem('schoolos_token');
  const res = await fetch(`${LIVE_BASE}/plugins/ops.visitors/visitors/${id}/pickup/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
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
