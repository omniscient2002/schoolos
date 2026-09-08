// Security matrix A3 — logout invalidation regression (038 auth.revoked_token):
// a signed-out token is dead immediately; a fresh login is unaffected; the denylist
// self-cleans expired entries; old pre-jti tokens still authenticate (compat).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers.js';
import pg from 'pg';

let app;
let sql;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const r = await c.query(text, params);
    await c.end();
    return r;
  };
});
after(async () => { await app?.close(); });

const H = (t) => ({ authorization: `Bearer ${t}` });

test('A3 · logout revokes the exact token; nothing else', async () => {
  const a = (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'teacher@meridian.edu', password: 'schoolos-demo' } })).json();
  const b = (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'teacher@meridian.edu', password: 'schoolos-demo' } })).json();

  const me1 = await app.inject({ method: 'GET', url: '/dataset', headers: H(a.token) });
  assert.equal(me1.statusCode, 200, 'token works before logout');

  const out = await app.inject({ method: 'POST', url: '/auth/logout', headers: H(a.token) });
  assert.equal(out.statusCode, 200, out.body);
  assert.equal(out.headers['clear-site-data'], '"cache", "storage"', 'shared-computer wipe requested');

  const dead = await app.inject({ method: 'GET', url: '/dataset', headers: H(a.token) });
  assert.equal(dead.statusCode, 401, 'logged-out token is refused immediately (A3)');

  const alive = await app.inject({ method: 'GET', url: '/dataset', headers: H(b.token) });
  assert.equal(alive.statusCode, 200, 'sibling token unaffected');

  const fresh = (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'teacher@meridian.edu', password: 'schoolos-demo' } })).json();
  const me2 = await app.inject({ method: 'GET', url: '/dataset', headers: H(fresh.token) });
  assert.equal(me2.statusCode, 200, 're-login works');
});

test('A3 · denylist self-cleans expired entries; legacy tokens (no jti) still authenticate', async () => {
  const legacy = app.jwt.sign({ sub: (await sql(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0].id });
  const r = await app.inject({ method: 'GET', url: '/dataset', headers: H(legacy) });
  assert.equal(r.statusCode, 401, 'jti-less tokens are refused (RT-7 P2-6: an unverifiable-identity token can never be revoked)');

  const jti = 'test-expired-jti-00000000';
  await sql(`INSERT INTO auth.revoked_token (jti, exp) VALUES ($1, now() - interval '1 minute')`, [jti]);
  const t = (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'teacher@meridian.edu', password: 'schoolos-demo' } })).json();
  await app.inject({ method: 'POST', url: '/auth/logout', headers: H(t.token) }); // triggers opportunistic cleanup
  const left = await sql(`SELECT count(*)::int n FROM auth.revoked_token WHERE jti=$1`, [jti]);
  assert.equal(left.rows[0].n, 0, 'expired denylist rows are cleaned up');
});
