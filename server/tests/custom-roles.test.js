// L3-4.2 — custom roles kernel. Pins (all SCHEMA-CONDITIONAL per the blocks.md DDL
// handoff to L1): with app.roles + users.role_key absent → every /roles* door answers
// 503 (honest refusal, never a silent no-op); with the store present → CRUD + mask
// validation (dead patterns refused against the live route registry) + assignment rules
// (no self-assign, no owner overlay) + enforcement resolution order (deny beats base
// role; allow grants a door the base role lacks; users without role_key are untouched).
// Style: tests/wave-b.test.js · WRITE-ONLY in-lane (D-10).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;
let owner, principal, teacher;
let present = false; // schema present? (L1's migration may or may not be merged yet)
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const HD = (t) => ({ authorization: `Bearer ${t}` }); // DELETE: no body, no content-type

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  principal = await loginAs(app, 'principal@meridian.edu');
  teacher = await loginAs(app, 'teacher@meridian.edu');
  const probe = await pool.query(`SELECT to_regclass('app.roles') IS NOT NULL AS ok,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='app' AND table_name='users' AND column_name='role_key') AS col`);
  present = !!(probe.rows[0]?.ok && probe.rows[0]?.col);
  if (present) {
    // door needs the plugin-style enable? /roles is a KERNEL door — no plugin gate.
    // sanity: register at least the fixture routes exist (matrix registry is source-side).
  }
});

after(async () => { await app?.close(); });

describe('custom roles kernel (L3-4.2)', () => {
  test('without the roles store: /roles answers 503 with the migration reason (never silent)', async () => {
    const r = await app.inject({ method: 'GET', url: '/roles', headers: H(owner.token) });
    if (present) {
      // store landed (063) — the surface answers; behavior tests below cover it
      assert.equal(r.statusCode, 200, r.body);
      assert.ok(Array.isArray(r.json().builtin), 'builtin role list served');
    } else {
      assert.equal(r.statusCode, 503, r.body);
      assert.match(r.json().error, /migration/i);
      const post = await app.inject({ method: 'POST', url: '/roles', headers: H(owner.token), payload: { key: 'x', label: 'X', base_role: 'teacher' } });
      assert.equal(post.statusCode, 503);
    }
  });

  test('owner+itadmin only: principal/teacher 403 on the roles surface', async () => {
    for (const who of [principal, teacher]) {
      const r = await app.inject({ method: 'GET', url: '/roles', headers: H(who.token) });
      assert.equal(r.statusCode, 403, r.body);
    }
  });

  test('create: validates key/label/base_role/mask — dead patterns refused against the live route registry', async (t) => {
    if (!present) return t.skip('roles store not migrated yet (063) — 503 path covered above');
    const dead = await app.inject({ method: 'POST', url: '/roles', headers: H(owner.token),
      payload: { key: 'frontdesk', label: 'Front desk', base_role: 'coordinator',
        permissions: { allow: ['POST /fees/payments'], deny: ['GET /definitely-not-a-route'] } } });
    assert.equal(dead.statusCode, 400, dead.body);
    assert.match(dead.json().error, /match a real screen/);
    const badKey = await app.inject({ method: 'POST', url: '/roles', headers: H(owner.token),
      payload: { key: 'Bad Key!', label: 'X', base_role: 'teacher' } });
    assert.equal(badKey.statusCode, 400);
    const badBase = await app.inject({ method: 'POST', url: '/roles', headers: H(owner.token),
      payload: { key: 'lib2', label: 'Lib', base_role: 'emperor' } });
    assert.equal(badBase.statusCode, 400);
    const ok = await app.inject({ method: 'POST', url: '/roles', headers: H(owner.token),
      payload: { key: 'frontdesk', label: 'Front desk', base_role: 'coordinator',
        permissions: { allow: ['GET /fees'], deny: ['GET /students'] } } });
    assert.equal(ok.statusCode, 200, ok.body);
    const dup = await app.inject({ method: 'POST', url: '/roles', headers: H(owner.token),
      payload: { key: 'frontdesk', label: 'Front desk 2', base_role: 'teacher' } });
    assert.equal(dup.statusCode, 409);
  });

  test('assignment rules: no self-assign, no owner overlay, unknown user list guarded', async (t) => {
    if (!present) return t.skip('roles store not migrated yet (063)');
    const ownerId = (await pool.query(`SELECT id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].id;
    const self = await app.inject({ method: 'POST', url: '/roles/frontdesk/assign', headers: H(owner.token),
      payload: { userIds: [ownerId] } });
    assert.equal(self.statusCode, 403, self.body);
    const ok = await app.inject({ method: 'POST', url: '/roles/frontdesk/assign', headers: H(owner.token),
      payload: { userIds: [teacher.id ?? (await pool.query(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0].id] } });
    assert.equal(ok.statusCode, 200, ok.body);
    const ghost = await app.inject({ method: 'POST', url: '/roles/frontdesk/assign', headers: H(owner.token),
      payload: { userIds: ['00000000-0000-0000-0000-000000000000'] } });
    assert.equal(ghost.statusCode, 200, 'assign is idempotent on unknown ids (rowCount 0)');
    assert.equal(ghost.json().assigned, 0);
  });

  test('resolution order: deny blocks a base-role door; allow grants a door the base role lacks; no role_key → untouched', async (t) => {
    if (!present) return t.skip('roles store not migrated yet (063)');
    // frontdesk = coordinator base + allow GET /fees + deny GET /students
    const tid = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;
    const uid = (await pool.query(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0].id;
    // rebase the fixture role onto teacher so the allow-grant path is provable
    await app.inject({ method: 'PATCH', url: '/roles/frontdesk', headers: H(owner.token),
      payload: { base_role: 'teacher', permissions: { allow: ['POST /fees/payments'], deny: ['GET /students'] } } });
    await app.inject({ method: 'POST', url: '/roles/frontdesk/assign', headers: H(owner.token), payload: { userIds: [uid] } });
    // fresh login so the session picks up role_key (the JWT carries what /auth/login minted)
    const t2 = await loginAs(app, 'teacher@meridian.edu');
    // deny: teacher alone passes /students; with the mask it refuses
    const denied = await app.inject({ method: 'GET', url: '/students', headers: H(t2.token) });
    assert.equal(denied.statusCode, 403, denied.body);
    assert.match(denied.json().error, /custom role/i);
    // allow: POST /fees/payments excludes teachers (parent/finance/owner/principal);
    // the mask grants the DOOR — the role refusal must lift (a payload 400 here is
    // proof the gate passed; 403 would mean the grant failed)
    const granted = await app.inject({ method: 'POST', url: '/fees/payments', headers: H(t2.token), payload: {} });
    assert.notEqual(granted.statusCode, 403, `mask granted the door (${granted.statusCode} — handler validation, not a role refusal)`);
    assert.match(granted.json().error, /obligationId required/, 'the DOOR answered, the gate did not');
    // untouched: a user WITHOUT role_key behaves exactly as before
    const plain = await loginAs(app, 'principal@meridian.edu');
    const still = await app.inject({ method: 'GET', url: '/students', headers: H(plain.token) });
    assert.equal(still.statusCode, 200, still.body);
    // unassign → teacher again
    await app.inject({ method: 'POST', url: '/roles/frontdesk/unassign', headers: H(owner.token), payload: { userIds: [uid] } });
    const t3 = await loginAs(app, 'teacher@meridian.edu');
    const back = await app.inject({ method: 'GET', url: '/students', headers: H(t3.token) });
    assert.equal(back.statusCode, 200, back.body);
    void tid;
  });

  test('delete: members block removal; empty role deletes; audit rows exist for the lifecycle', async (t) => {
    if (!present) return t.skip('roles store not migrated yet (063)');
    const uid = (await pool.query(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0].id;
    await app.inject({ method: 'POST', url: '/roles/frontdesk/assign', headers: H(owner.token), payload: { userIds: [uid] } });
    const blocked = await app.inject({ method: 'DELETE', url: '/roles/frontdesk', headers: HD(owner.token) });
    assert.equal(blocked.statusCode, 409, blocked.body);
    await app.inject({ method: 'POST', url: '/roles/frontdesk/unassign', headers: H(owner.token), payload: { userIds: [uid] } });
    const gone = await app.inject({ method: 'DELETE', url: '/roles/frontdesk', headers: HD(owner.token) });
    assert.equal(gone.statusCode, 200, gone.body);
    assert.equal(gone.json().retired, true, 'D-35: the app role retires, never hard-DELETEs');
    const list = await app.inject({ method: 'GET', url: '/roles', headers: H(owner.token) });
    assert.ok(!list.json().roles.some((r) => r.key === 'frontdesk'), 'retired role left the live list');
    const audit = (await pool.query(`SELECT action FROM app.audit_log WHERE record_type='Role' AND action='Custom role retired' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    assert.ok(audit, 'role retirement is audited');
  });
});
