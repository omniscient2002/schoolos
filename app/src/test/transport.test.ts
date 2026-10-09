/* The API transport's own contract — asserted, not assumed (P2-1).
 *
 * THE BUG. `call()` set `content-type: application/json` on EVERY request. A
 * content-type is not a CORS-safelisted request header, so even a bodyless GET became a
 * preflighted request: an extra round trip before the real one, on every screen load, for
 * every user. Measured across a real onboarding run, 641 of 2,254 API calls (28%) were
 * preflights. It is invisible in a functional test (the preflight is cached per endpoint and
 * never appears in a response log) and real in production, where the first load of every screen
 * pays it.
 *
 * The fix sends the header only when there is a body to describe. This test stubs `fetch` and
 * checks the headers actually go out, so the header cannot creep back in by accident — and so
 * the second half of the contract (auth + CSRF on writes) is pinned in the same place.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const LIVE_BASE = 'http://127.0.0.1:8080';

type Seen = { url: string; init: RequestInit; headers: Record<string, string> };

function stubFetch(): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    seen.push({ url, init, headers: (init.headers ?? {}) as Record<string, string> });
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve({ ok: true }),
    });
  });
  return seen;
}

beforeEach(() => {
  document.cookie = 'schoolos_csrf=csrf-value-1';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function transport() {
  const mod = await import('../services/liveApi');
  mod.setToken('test-bearer');
  return mod;
}

describe('P2-1 · a read is not preflighted by its own headers', () => {
  it('a GET sends no content-type, so no preflight', async () => {
    const seen = stubFetch();
    const api = await transport();
    await api.apiStudents({ limit: '10' });

    expect(seen).toHaveLength(1);
    const h = seen[0].headers;
    expect(h['content-type'], 'a bodyless GET must not declare a body type — that is what forces the preflight')
      .toBeUndefined();
    /* the headers that DO belong on a read */
    expect(h.authorization).toBe('Bearer test-bearer');
  });

  it('a write with a body still declares its content type and carries the CSRF token', async () => {
    const seen = stubFetch();
    const api = await transport();
    await api.apiMarkAttendance('2026-09-29', []);

    const h = seen[0].headers;
    expect(h['content-type']).toBe('application/json');
    expect(h['x-csrf-token']).toBe('csrf-value-1');
  });

  it('a GET does not carry the CSRF header (nothing to protect, and it is a mutation token)', async () => {
    const seen = stubFetch();
    const api = await transport();
    await api.apiStudents();
    expect(seen[0].headers['x-csrf-token']).toBeUndefined();
  });

  it('an explicitly passed header still wins', async () => {
    const seen = stubFetch();
    const api = await transport();
    await api.apiRequest('/plugins/ops.bi/overview', { headers: { 'x-step-up-token': 'step-1' } });
    expect(seen[0].headers['x-step-up-token']).toBe('step-1');
    expect(seen[0].url.startsWith(LIVE_BASE)).toBe(true);
  });
});

describe('the one-time password is read under ONE name (P2-11)', () => {
  it('adminResetPassword throws rather than handing back an empty secret', async () => {
    /* The failure this prevents: the server minted a password, the client read a name the door
       did not answer, and the office saw an EMPTY box for a credential that had just been
       replaced — an unrecoverable lockout. Silence is the one acceptable answer. */
    vi.stubGlobal('fetch', () => Promise.resolve({
      ok: true, status: 200, headers: new Headers(), json: () => Promise.resolve({ ok: true }),
    }));
    const { adminResetPassword } = await import('../services/adminApi');
    await expect(adminResetPassword('user-1')).rejects.toThrow(/did not return a one-time password/);
  });

  it('adminResetPassword returns the server\'s one name', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({
      ok: true, status: 200, headers: new Headers(),
      json: () => Promise.resolve({ ok: true, temporaryPassword: 'rain-lotus-3f9a' }),
    }));
    const { adminResetPassword } = await import('../services/adminApi');
    const r = await adminResetPassword('user-1');
    expect(r.temporaryPassword).toBe('rain-lotus-3f9a');
  });
});