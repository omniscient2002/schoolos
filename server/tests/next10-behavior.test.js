// Behavioural coverage for the "next 10 hardening" batch.
//
// The companion `next10-hardening.test.js` only GREPS source strings — it cannot tell a working fix from a
// deleted route or an inverted condition. This file exercises the actual runtime behaviour of each fix so
// reverting one makes a test fail for the right reason. Every fixture is asserted, never silently skipped.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestDb } from './helpers.js';

let app, pool, sql, tenantId, dispatcher;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  const db = await import('../src/db.js');
  pool = db.pool;
  sql = (t, p = []) => pool.query(t, p);
  tenantId = (await sql(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  dispatcher = await import('../scripts/comms-dispatcher.js');
});
after(async () => { if (app) await app.close(); });

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const user = async (email) => (await sql(`SELECT id, tenant_id, name, role, email FROM app.users WHERE email=$1`, [email])).rows[0];
// Mint sessions directly: `/auth/login` is rate-limited to 20/min, and the lockout suite deliberately
// burns part of that budget. A forged-but-valid jti keeps the rest of the file off the limiter.
const tokenFor = async (email) => {
  const u = await user(email);
  return app.jwt.sign({ sub: u.id, role: u.role, tenant: u.tenant_id, name: u.name, email: u.email, jti: randomUUID() });
};

// ── 097 · durable per-account lockout ────────────────────────────────────────────────────────────
describe('097 · password-spray lockout is durable and cannot be bypassed', () => {
  const EMAIL = 'technician@meridian.edu';
  const throttleRow = () => sql(`SELECT failed_attempts, locked_until FROM auth.login_throttles WHERE user_id=(SELECT id FROM app.users WHERE email=$1)`, [EMAIL]);
  const attempt = (password) => app.inject({ method: 'POST', url: '/auth/login', payload: { email: EMAIL, password }, headers: { 'content-type': 'application/json' } });

  test('the fifth wrong password locks the account, and the lock is enforced from the DB', async () => {
    await sql(`DELETE FROM auth.login_throttles WHERE user_id=(SELECT id FROM app.users WHERE email=$1)`, [EMAIL]);
    // AUTH-4 added a SECOND, identifier-keyed lock (scope 'login') so an unknown email throttles the same
    // as a real account. Clear both so this test states its own premise.
    await sql(`DELETE FROM auth.request_throttles WHERE scope='login'`);
    let last;
    for (let i = 1; i <= 5; i++) {
      last = await attempt(`wrong-${i}`);
      if (i < 5) assert.equal(last.statusCode, 401, `attempt ${i} must be a plain 401, got ${last.statusCode}`);
    }
    assert.equal(last.statusCode, 429, `THE REGRESSION GATE: the 5th failure locks (got ${last.statusCode}: ${last.body})`);
    const row = (await throttleRow()).rows[0];
    assert.ok(row, 'the throttle row must be persisted in the kernel DB');
    assert.ok(row.locked_until, 'the lock timestamp must be persisted (shared across API replicas)');
    // A lock is a lock: a VALID password presented while locked must still be refused.
    const correct = await attempt('schoolos-demo');
    assert.equal(correct.statusCode, 429, 'a valid password must not clear an active lock');
  });

  test('an expired lock resets, and a successful sign-in clears the failure window', async () => {
    await sql(`UPDATE auth.login_throttles SET locked_until = now() - interval '1 minute' WHERE user_id=(SELECT id FROM app.users WHERE email=$1)`, [EMAIL]);
    await sql(`UPDATE auth.request_throttles SET locked_until = now() - interval '1 minute' WHERE scope='login'`);
    const ok = await attempt('schoolos-demo');
    assert.equal(ok.statusCode, 200, `an expired lock must admit a valid sign-in: ${ok.body}`);
    const rows = (await throttleRow()).rows;
    assert.equal(rows.length, 0, 'a successful sign-in clears the throttle row');
  });
});

// ── 098 · fee-payment idempotency ────────────────────────────────────────────────────────────────
describe('098 · payment initiation honours a caller Idempotency-Key', () => {
  test('a replayed key returns the ORIGINAL payment and creates no duplicate row', async () => {
    const parent = await user('parent@meridian.edu');
    const token = await tokenFor('parent@meridian.edu');
    const mine = (await sql(`SELECT student_id FROM family.child_link WHERE user_id=$1`, [parent.id])).rows.map((r) => r.student_id);
    assert.ok(mine.length, 'fixture: the demo parent must have a linked child');
    const ob = (await sql(`SELECT id FROM app.fee_obligations WHERE student_id = ANY($1::uuid[]) AND status <> 'void' AND paid_cents < amount_cents LIMIT 1`, [mine])).rows[0];
    assert.ok(ob, 'fixture: the demo child must carry an open obligation');

    const key = `idem-${randomUUID()}`;
    const r1 = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: ob.id }, headers: { ...H(token), 'idempotency-key': key } });
    assert.equal(r1.statusCode, 200, r1.body);
    const r2 = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: ob.id }, headers: { ...H(token), 'idempotency-key': key } });
    assert.equal(r2.statusCode, 200, r2.body);
    assert.equal(r2.json().already, true, 'the replay must be marked already');
    assert.equal(r2.json().payment.id, r1.json().payment.id, 'the replay must return page 1\'s payment, not a new one');
    assert.equal((await sql(`SELECT count(*)::int n FROM app.payments WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantId, key])).rows[0].n, 1, 'exactly one payment row may exist for the key');

    const bad = await app.inject({ method: 'POST', url: '/fees/payments', payload: { obligationId: ob.id }, headers: { ...H(token), 'idempotency-key': 'has spaces' } });
    assert.equal(bad.statusCode, 400, 'a malformed key is refused up front');
  });
});

// ── 100 · complaint idempotency + SEC-4 role-derived fields ───────────────────────────────────────
describe('100 · case creation is idempotent and never trusts caller-authored provenance', () => {
  test('a replayed key returns the same case; origin/owner are derived from the role', async () => {
    const token = await tokenFor('parent@meridian.edu');
    const key = `case-${randomUUID()}`;
    const payload = { kind: 'safety', title: 'Idempotency probe', detail: 'x', origin: 'staff', owner: 'Someone Else', priority: 'high' };

    const r1 = await app.inject({ method: 'POST', url: '/cases', payload, headers: { ...H(token), 'idempotency-key': key } });
    assert.equal(r1.statusCode, 200, r1.body);
    const c1 = r1.json().case;
    assert.equal(c1.origin, 'parent', 'a family report is labelled parent, whatever the body said');
    assert.equal(c1.owner, 'Coordinator', 'a family cannot assign its own case to a named staff member');

    const r2 = await app.inject({ method: 'POST', url: '/cases', payload, headers: { ...H(token), 'idempotency-key': key } });
    assert.equal(r2.statusCode, 200, r2.body);
    assert.equal(r2.json().already, true);
    assert.equal(r2.json().case.id, c1.id, 'the replay must return the original case');
    assert.equal((await sql(`SELECT count(*)::int n FROM app.cases WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantId, key])).rows[0].n, 1);

    const bad = await app.inject({ method: 'POST', url: '/cases', payload, headers: { ...H(token), 'idempotency-key': 'a/b' } });
    assert.equal(bad.statusCode, 400, 'a malformed key is refused up front');
  });
});

// ── event/audit envelope bound ─────────────────────────────────────────────────────────────────────
describe('audit/event envelope is bounded before it reaches PostgreSQL', () => {
  test('an oversized or malformed event is refused; a bounded one is accepted', async () => {
    const { emitEvent } = await import('../src/audit.js');
    const { withUser } = await import('../src/db.js');

    await assert.rejects(
      withUser(tenantId, 'system', (c) => emitEvent(c, tenantId, { type: 'probe', label: 'too big' }, 'probe.topic', { blob: 'x'.repeat(65 * 1024) })),
      /64KiB/, 'THE REGRESSION GATE: a 65KiB payload must not be stored');
    await assert.rejects(
      withUser(tenantId, 'system', (c) => emitEvent(c, tenantId, { type: 'not a valid type!', label: 'bad' })),
      /event type is invalid/);
    await assert.rejects(
      withUser(tenantId, 'system', (c) => emitEvent(c, tenantId, { type: 'probe', label: 'x'.repeat(501) })),
      /label exceeds 500/);

    const id = await withUser(tenantId, 'system', async (c) => (await emitEvent(c, tenantId, { type: 'probe', label: 'ok' }, 'probe.topic', { n: 1 })).id);
    assert.ok(id, 'a bounded payload is accepted and persisted');
  });
});

// ── 099 · dispatcher claims are leases ────────────────────────────────────────────────────────────
describe('099 · comms dispatcher claims are leases, not long transactions', () => {
  const queue = async ({ claimedAt = null, claimedBy = null } = {}) => (await sql(
    `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, dedup_key, attempts, claimed_at, claimed_by)
     VALUES ($1,'guardian',$2::jsonb,'sms','LEASE',$3,'queued',$4,0,$5,$6) RETURNING id`,
    [tenantId, JSON.stringify(['+919845000301']), 'lease probe', `lease_${randomUUID()}`, claimedAt, claimedBy])).rows[0];

  before(async () => {
    await sql(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, settings)
               VALUES ($1,'rails.sms','1.0.0','B','enabled','{"provider":"logger"}'::jsonb)
               ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET status='enabled', settings='{"provider":"logger"}'::jsonb`, [tenantId]);
  });

  test('a live lease is not stolen; a stale lease is reclaimed and released on delivery', async () => {
    const fresh = await queue({ claimedAt: new Date(), claimedBy: 'live-worker' });
    const stale = await queue();
    await sql(`UPDATE app.communications SET claimed_at = now() - interval '11 minutes', claimed_by='dead-worker' WHERE id=$1`, [stale.id]);

    await dispatcher.tick();

    const f = (await sql(`SELECT status, attempts, claimed_by FROM app.communications WHERE id=$1`, [fresh.id])).rows[0];
    assert.equal(f.status, 'queued', 'THE REGRESSION GATE: a lease held by a live worker must not be processed');
    assert.equal(f.claimed_by, 'live-worker');
    assert.equal(f.attempts, 0);

    const s = (await sql(`SELECT status, attempts, claimed_at, claimed_by FROM app.communications WHERE id=$1`, [stale.id])).rows[0];
    assert.equal(s.attempts, 1, 'the expired lease is reclaimed and processed exactly once');
    assert.equal(s.claimed_at, null, 'the claim is released after processing');
    assert.equal(s.claimed_by, null, 'the claim owner is cleared after processing');
    assert.equal(s.status, 'sent', `the sandbox logger carrier delivers in the test runtime: ${JSON.stringify(s)}`);
  });

  test('two concurrent ticks never deliver the same queued row twice', async () => {
    const rows = [await queue(), await queue(), await queue()];
    await Promise.all([dispatcher.tick(), dispatcher.tick()]);
    const got = (await sql(`SELECT id, status, attempts FROM app.communications WHERE id = ANY($1::uuid[])`, [rows.map((r) => r.id)])).rows;
    assert.equal(got.length, 3);
    for (const r of got) {
      assert.equal(r.attempts, 1, `row ${r.id} must be delivered exactly once (got attempts=${r.attempts})`);
      assert.equal(r.status, 'sent');
    }
  });
});

// ── routes.js hardening ───────────────────────────────────────────────────────────────────────────
describe('route hardening: register cap, pagination, refund ledger guard', () => {
  test('an attendance register is capped at 300 rows (413 before any DB work)', async () => {
    const token = await tokenFor('principal@meridian.edu');
    const marks = Array.from({ length: 301 }, () => ({ studentId: randomUUID(), status: 'present' }));
    const r = await app.inject({ method: 'POST', url: '/attendance/mark', payload: { marks }, headers: H(token) });
    assert.equal(r.statusCode, 413, `THE REGRESSION GATE: 301 rows must be refused (got ${r.statusCode}: ${r.body})`);
    // 300 rows pass the cap and reach later validation: proves the cap is 300, not "any large number".
    const atCap = await app.inject({ method: 'POST', url: '/attendance/mark', payload: { marks: marks.slice(1).map((m) => ({ ...m, status: 'bogus' })) }, headers: H(token) });
    assert.equal(atCap.statusCode, 400, '300 rows clear the cap and fail later payload validation');
  });

  test('pagination reports hasMore honestly and offset advances page by page', async () => {
    const token = await tokenFor('owner@meridian.edu');
    for (let i = 0; i < 2; i++) {
      await app.inject({ method: 'POST', url: '/cases', payload: { kind: 'ops', title: `page probe ${i}` }, headers: { ...H(token), 'idempotency-key': `page-${randomUUID()}` } });
    }
    const p1 = await app.inject({ method: 'GET', url: '/cases?limit=1', headers: H(token) });
    assert.equal(p1.statusCode, 200, p1.body);
    assert.equal(p1.json().cases.length, 1);
    assert.equal(p1.json().hasMore, true, 'a full page drawn from a larger set must report hasMore');

    const p2 = await app.inject({ method: 'GET', url: '/cases?limit=1&offset=1', headers: H(token) });
    assert.equal(p2.json().cases.length, 1);
    assert.notEqual(p2.json().cases[0].id, p1.json().cases[0].id, 'offset must advance, not repeat page 1');

    const end = await app.inject({ method: 'GET', url: '/cases?limit=1&offset=100000', headers: H(token) });
    assert.equal(end.json().cases.length, 0);
    assert.equal(end.json().hasMore, false, 'past the end hasMore is false');
  });

  test('a refund refuses to floor an inconsistent obligation ledger (409)', async () => {
    const fin = await tokenFor('finance@meridian.edu');
    const ob = (await sql(`SELECT id, student_id FROM app.fee_obligations o WHERE o.status <> 'void' LIMIT 1`)).rows[0];
    assert.ok(ob, 'fixture: the seed must contain a fee obligation');
    const amount = 100000;
    const p = (await sql(
      `INSERT INTO app.payments (tenant_id, student_id, obligation_id, amount_cents, method, status, gateway_ref, confirmed_at)
       VALUES ($1,$2,$3,$4,'cash','confirmed','MANUAL-PROBE',now()) RETURNING id`,
      [tenantId, ob.student_id, ob.id, amount])).rows[0];

    // Corrupt the ledger: the obligation now understates what this payment added.
    await sql(`UPDATE app.fee_obligations SET paid_cents=$2, status='open' WHERE id=$1`, [ob.id, amount - 1]);
    const refused = await app.inject({ method: 'POST', url: `/payments/${p.id}/refund`, payload: { reason: 'probe' }, headers: H(fin) });
    assert.equal(refused.statusCode, 409, `THE REGRESSION GATE: releasing money on an inconsistent ledger must be refused (got ${refused.statusCode}: ${refused.body})`);
    assert.match(refused.json().error, /ledger is inconsistent/);
    assert.equal((await sql(`SELECT status FROM app.payments WHERE id=$1`, [p.id])).rows[0].status, 'confirmed', 'the refused refund must not move money');

    // Repair the ledger: the same refund now proceeds.
    await sql(`UPDATE app.fee_obligations SET paid_cents=$2 WHERE id=$1`, [ob.id, amount]);
    const ok = await app.inject({ method: 'POST', url: `/payments/${p.id}/refund`, payload: { reason: 'probe' }, headers: H(fin) });
    assert.equal(ok.statusCode, 200, ok.body);
  });
});
