/* F-26 · every request gets a deadline (plus the error contract).
 *
 * THE BUG. The shared transport had no AbortController anywhere except Login+renew,
 * so a hung request hung the screen forever. Non-2xx responses also reached screens
 * as bare `HTTP <code>` strings. The transport now applies AbortSignal.timeout
 * (default 30s, overridable per call) and carries the server's stable `code`,
 * `status` and `payload` on the thrown Error.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function transport() {
  const mod = await import('../services/liveApi');
  mod.setToken('test-bearer');
  return mod;
}

/* A stub that behaves like a real fetch toward aborts: when the passed signal
   fires, reject with the signal's own reason (a deadline produces TimeoutError). */
function stubHungFetch() {
  vi.stubGlobal('fetch', (_url: string, init: RequestInit = {}) =>
    new Promise((_resolve, reject) => {
      if (init.signal?.aborted) return reject((init.signal as AbortSignal).reason);
      init.signal?.addEventListener('abort', () => reject((init.signal as AbortSignal).reason), { once: true });
    }),
  );
}

describe('F-26 · request deadlines', () => {
  it('a hung request rejects with a TIMEOUT error, not a hang', async () => {
    stubHungFetch();
    const api = await transport();
    await expect(api.apiRequest('/students', { timeoutMs: 50 } as RequestInit)).rejects.toMatchObject({ code: 'TIMEOUT' });
  }, 10000);

  it('a custom timeoutMs is honored for slow doors', async () => {
    stubHungFetch();
    const api = await transport();
    const start = Date.now();
    await expect(api.apiRequest('/reports/board-pack', { timeoutMs: 100 } as RequestInit)).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(Date.now() - start).toBeLessThan(5000);
  }, 10000);
});

describe('F-26 · error contract (code, status, payload ride the Error)', () => {
  it('a 403 with a stable code carries code + status, not just "HTTP 403"', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({
      ok: false,
      status: 403,
      headers: new Headers(),
      json: () => Promise.resolve({ error: 'forbidden-word', code: 'FORBIDDEN' }),
    }));
    const api = await transport();
    const err = await api.apiRequest('/audit').catch((e) => e) as Error & { code?: string; status?: number; payload?: unknown };
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.status).toBe(403);
    expect(err.payload).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a 429 keeps its status for retry copy', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({
      ok: false,
      status: 429,
      headers: new Headers(),
      json: () => Promise.resolve({ error: 'slow down', code: 'RATE_LIMITED' }),
    }));
    const api = await transport();
    const err = await api.apiRequest('/auth/login').catch((e) => e) as Error & { code?: string; status?: number };
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.status).toBe(429);
  });
});
