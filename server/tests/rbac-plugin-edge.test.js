/* RBAC plugin-edge — custom-role masks still bite on plugin doors, and the library desk is the librarian's.
 *
 * library v2 (docs/LIBRARY-DESIGN.md) changed the access model: the library desk is the built-in `librarian`
 * role, not a teacher-based custom preset, and owner/principal see only the aggregate ops dashboard. This
 * suite pins the NEW contract while preserving the two mask behaviours it existed for:
 *   · an ALLOW can lift a plugin door's role refusal (a teacher granted `GET /plugins/library/desk/overview`);
 *   · a DENY always wins, on a role-gated door and on an ungated one (`/dataset`).
 * The built-in librarian account is the end-to-end "separate librarian" acceptance the owner asked for.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';

let app, pool, owner;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json', 'x-step-up-password': 'schoolos-demo' });
const brief = (r) => `HTTP ${r.statusCode} ${String(r.body ?? '').slice(0, 160)}`;
const LIB_EMAIL = 'librarian.accept@meridian.edu';

const allowLift = async (key, doors, email) => {
  const uid = (await pool.query(`SELECT id FROM app.users WHERE email=$1`, [email])).rows[0].id;
  const made = await app.inject({ method: 'POST', url: '/roles', headers: H(owner.token), payload: {
    key, label: key, base_role: 'teacher', permissions: { allow: doors, deny: [] } } });
  assert.ok([200, 201].includes(made.statusCode), brief(made));
  const bound = await app.inject({ method: 'POST', url: `/roles/${key}/assign`, headers: H(owner.token), payload: { userIds: [uid] } });
  assert.equal(bound.statusCode, 200, brief(bound));
};

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  for (const id of ['library', 'people.admin']) {
    const r = await app.inject({ method: 'POST', url: `/plugins/${id}/enable`, headers: H(owner.token), payload: {} });
    assert.equal(r.statusCode, 200, `could not enable ${id}: ${brief(r)}`);
  }
});

after(async () => { await app?.close(); });

describe('RBAC plugin-edge · the librarian role and mask semantics', () => {
  test('the roles store and the library plugin are present — this suite is not conditional', async () => {
    const ready = await pool.query(`SELECT to_regclass('app.roles') IS NOT NULL AS roles_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='app' AND table_name='users' AND column_name='role_key') AS key_ok`);
    assert.ok(ready.rows[0].roles_ok && ready.rows[0].key_ok, 'app.roles + users.role_key must exist');
    const lib = await pool.query(`SELECT status FROM app.plugins WHERE plugin_id='library' LIMIT 1`);
    assert.equal(lib.rows[0]?.status, 'enabled', 'the library plugin must be enabled for these doors to exist');
  });

  test('a separate librarian account runs the desk and is refused finance', async () => {
    const created = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.token), payload: {
      email: LIB_EMAIL, name: 'Meera Librarian', role: 'librarian', password: 'library-pass-1' } });
    assert.equal(created.statusCode, 200, brief(created));

    const librarian = await loginAs(app, LIB_EMAIL, 'library-pass-1');
    const plainTeacher = await loginAs(app, 'teacher@meridian.edu');

    const refused = await app.inject({ method: 'GET', url: '/plugins/library/desk/overview', headers: H(plainTeacher.token) });
    assert.equal(refused.statusCode, 403, 'a plain teacher is NOT a librarian — the refusal is the baseline');

    const desk = await app.inject({ method: 'GET', url: '/plugins/library/desk/overview', headers: H(librarian.token) });
    assert.equal(desk.statusCode, 200, `the librarian reaches the desk: ${brief(desk)}`);

    const added = await app.inject({ method: 'POST', url: '/plugins/library/books', headers: H(librarian.token),
      payload: { title: 'The Library Book', author: 'Susan Orlean', copies: 2 } });
    assert.equal(added.statusCode, 200, `the librarian can add books: ${brief(added)}`);

    const fees = await app.inject({ method: 'GET', url: '/fees/obligations', headers: H(librarian.token) });
    assert.equal(fees.statusCode, 403, `the librarian must not read finance: ${brief(fees)}`);
    const feesWrite = await app.inject({ method: 'POST', url: '/fees/payments', headers: H(librarian.token), payload: {} });
    assert.equal(feesWrite.statusCode, 403, 'nor record payments');
  });

  test('an ALLOW can lift a plugin door\'s role refusal', async () => {
    // teacher ∉ librarian, so the desk is refused; an owner-authored allow names the desk door and lifts it.
    await allowLift('deskhelper', ['GET /plugins/library/desk/overview'], 'teacher@meridian.edu');
    const t = await loginAs(app, 'teacher@meridian.edu');
    const desk = await app.inject({ method: 'GET', url: '/plugins/library/desk/overview', headers: H(t.token) });
    assert.equal(desk.statusCode, 200, `the mask ALLOW must lift the plugin gate: ${brief(desk)}`);

    const uid = (await pool.query(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0].id;
    await app.inject({ method: 'POST', url: '/roles/deskhelper/unassign', headers: H(owner.token), payload: { userIds: [uid] } });
  });

  test('/me carries the caller\'s OWN binding and mask — and nobody else\'s', async () => {
    await allowLift('shelver', ['GET /plugins/library/catalog'], 'coordinator@meridian.edu');
    const bound = await loginAs(app, 'coordinator@meridian.edu');
    const mine = await app.inject({ method: 'GET', url: '/me', headers: H(bound.token) });
    assert.equal(mine.statusCode, 200, brief(mine));
    assert.equal(mine.json().role_key, 'shelver', '/me must name the custom role binding');
    assert.ok(mine.json().custom?.allow.includes('GET /plugins/library/catalog'), brief(mine));

    const plain = await loginAs(app, 'principal@meridian.edu');
    const theirs = await app.inject({ method: 'GET', url: '/me', headers: H(plain.token) });
    assert.equal(theirs.json().role_key, null, 'a user without a custom role gets no binding');
    assert.equal(theirs.json().custom, null, 'and no mask');
  });

  test('a DENY on a plugin door is honoured', async () => {
    // facilities reaches the borrower catalog without any mask; a deny naming it must refuse.
    const uid = (await pool.query(`SELECT id FROM app.users WHERE email='facilities@meridian.edu'`)).rows[0].id;
    const base = await loginAs(app, 'facilities@meridian.edu');
    const before = await app.inject({ method: 'GET', url: '/plugins/library/catalog', headers: H(base.token) });
    assert.equal(before.statusCode, 200, `baseline: facilities reaches the catalog (${brief(before)})`);

    const made = await app.inject({ method: 'POST', url: '/roles', headers: H(owner.token), payload: {
      key: 'noshelf', label: 'No shelf', base_role: 'facilities', permissions: { allow: [], deny: ['GET /plugins/library/catalog'] } } });
    assert.ok([200, 201].includes(made.statusCode), brief(made));
    const bound = await app.inject({ method: 'POST', url: '/roles/noshelf/assign', headers: H(owner.token), payload: { userIds: [uid] } });
    assert.equal(bound.statusCode, 200, brief(bound));

    const t = await loginAs(app, 'facilities@meridian.edu');
    const denied = await app.inject({ method: 'GET', url: '/plugins/library/catalog', headers: H(t.token) });
    assert.equal(denied.statusCode, 403, `the deny must reach the plugin door: ${brief(denied)}`);
    assert.match(denied.json().error, /custom role/i);

    await app.inject({ method: 'POST', url: '/roles/noshelf/unassign', headers: H(owner.token), payload: { userIds: [uid] } });
    const back = await app.inject({ method: 'GET', url: '/plugins/library/catalog', headers: H((await loginAs(app, 'facilities@meridian.edu')).token) });
    assert.equal(back.statusCode, 200, 'unassigning restores the base role exactly');
  });

  test('a DENY is honoured on a door with NO role gate of its own — enforcement rides authenticate', async () => {
    const plain = await loginAs(app, 'teacher@meridian.edu');
    const before = await app.inject({ method: 'GET', url: '/dataset', headers: H(plain.token) });
    assert.equal(before.statusCode, 200, `baseline: a teacher reads /dataset (${before.statusCode})`);

    const uid = (await pool.query(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0].id;
    const made = await app.inject({ method: 'POST', url: '/roles', headers: H(owner.token), payload: {
      key: 'noscore', label: 'No dataset read', base_role: 'teacher', permissions: { allow: [], deny: ['GET /dataset'] } } });
    assert.ok([200, 201].includes(made.statusCode), brief(made));
    const bound = await app.inject({ method: 'POST', url: '/roles/noscore/assign', headers: H(owner.token), payload: { userIds: [uid] } });
    assert.equal(bound.json().assigned, 1, 'the deny must actually be bound');

    const t = await loginAs(app, 'teacher@meridian.edu');
    const denied = await app.inject({ method: 'GET', url: '/dataset', headers: H(t.token) });
    assert.equal(denied.statusCode, 403, `a deny on an ungated door must be enforced: ${brief(denied)}`);
    assert.match(denied.json().error, /custom role/i);

    await app.inject({ method: 'POST', url: '/roles/noscore/unassign', headers: H(owner.token), payload: { userIds: [uid] } });
    const back = await app.inject({ method: 'GET', url: '/dataset', headers: H((await loginAs(app, 'teacher@meridian.edu')).token) });
    assert.equal(back.statusCode, 200, 'unassigning must restore the base role exactly');
  });
});
