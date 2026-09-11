/* ============================================================
   tenantSwitch — L5-4.1. Multi-school resolution helpers on
   L2-4.2's doors: GET /me/tenants (memberships for this email)
   and POST /me/switch (re-issues the session against the chosen
   tenant; the response token may carry mustChange when the target
   account still has a temporary password — the AuthGate's forced
   flow picks that up automatically).

   Local full-response helpers (same pattern as loginFull): the
   shared call() is module-private and liveApi additions are
   L4-owned this run (D-29). Same-origin requests carry cookies +
   the CSRF header, mirroring call()'s L5-3.2 behavior.
   ============================================================ */
import { LIVE_BASE } from '../../services/liveApi';

const SAME_ORIGIN = (() => {
  try { return new URL(LIVE_BASE, window.location.origin).origin === window.location.origin; } catch { return false; }
})();

function csrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === 'schoolos_csrf') return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export interface TenantMembership { tenantId: string; name: string; role: string }

/* The picker's shape: /me/tenants rows have roles; the 409 multiTenant
   body's schools list does NOT ({tenantId, name} only). */
export interface PickSchool { tenantId: string; name: string; role?: string }

export interface SwitchResult {
  ok: boolean;
  token: string;
  mustChange: boolean;
  tenant: { tenantId: string; name: string };
  user: { id: string; name: string; role: string; email: string; tenantId: string };
}

function authHeaders(method: 'GET' | 'POST'): HeadersInit {
  const t = localStorage.getItem('schoolos_token');
  const csrf = method === 'POST' ? csrfToken() : null;
  return {
    'content-type': 'application/json',
    ...(t ? { authorization: `Bearer ${t}` } : {}),
    ...(csrf ? { 'x-csrf-token': csrf } : {}),
  };
}

/** Memberships for the signed-in identity (email is the cross-tenant key). */
export async function listTenants(): Promise<TenantMembership[]> {
  const res = await fetch(`${LIVE_BASE}/me/tenants`, {
    method: 'GET',
    headers: authHeaders('GET'),
    ...(SAME_ORIGIN ? { credentials: 'same-origin' as RequestCredentials } : {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { tenants?: TenantMembership[] };
  return Array.isArray(body.tenants) ? body.tenants : [];
}

/** The tenant the CURRENT bearer token is bound to (our own just-issued
 *  token — read, never verified client-side). Null when unreadable. */
export function readTenantId(): string | null {
  try {
    const t = localStorage.getItem('schoolos_token');
    if (!t) return null;
    const part = t.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
    const payload = JSON.parse(json) as { tenant?: string };
    return typeof payload.tenant === 'string' ? payload.tenant : null;
  } catch {
    return null;
  }
}

/** Re-issue the session against the chosen tenant. The caller installs the
 *  fresh token and decides between the app (onAuthed / reload) and the
 *  forced password-change flow (mustChange). */
export async function switchTenant(tenantId: string): Promise<SwitchResult> {
  const res = await fetch(`${LIVE_BASE}/me/switch`, {
    method: 'POST',
    headers: authHeaders('POST'),
    body: JSON.stringify({ tenantId }),
    ...(SAME_ORIGIN ? { credentials: 'same-origin' as RequestCredentials } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<SwitchResult> & { error?: string };
  if (!res.ok || !body.token) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as SwitchResult;
}
