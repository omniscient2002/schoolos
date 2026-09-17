// RBAC-1 + RBAC-3 / PRD-3 · custom-role masks on PLUGIN doors, and the librarian account the owner asked for.
//
// THE DEFECT (RBAC-1): mask enforcement lived entirely inside `registerRoutes`, so only the kernel's
// `require()`/`me` doors honoured it. Every plugin door is gated by a different gate (`src/app.js`
// `requireRole`, handed to `loadPlugins`) which checked `roles.includes(req.user.role)` and nothing else.
// Both directions were wrong, and the second one is why the librarian account "cannot be made to work":
//   • a matched DENY was silently ignored on plugin doors — the owner sets a restriction, is told it is
//     saved, and the plugin door still answers 200;
//   • a matched ALLOW could not lift a plugin door's role refusal. `library`'s STAFF is
//     ['owner','principal','coordinator','facilities'] — a TEACHER-based role is not in it — so the shipped
//     "Librarian" preset (base_role teacher + explicit library allow-list, `app/src/screens/RolesAdmin.tsx`
//     LIBRARIAN_START, the D-43 acceptance quick start) got 403 `role teacher not permitted` on every
//     library door. The preset existed, the mask was stored, and the feature did not work.
//
// WHAT IS PINNED HERE:
//   1. The librarian preset works end-to-end on a REAL separate account: created through the people.admin
//      door with the teacher base, assigned the custom role, and then able to use the library (catalog,
//      issue) while finance doors refuse it — the D-43 acceptance criterion, in both directions.
//   2. A DENY is honoured on a plugin door (the restrictive half, previously ignored).
//   3. A DENY is honoured on a door that carries NO role gate of its own (`/dataset`, gated by
//      `authenticate` alone), because enforcement now rides `authenticate` too.
//   4. A user with no custom role is untouched, and the refusal is one clean 403 (not a double-send).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;
let owner;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
// bodies here can be megabytes (/dataset); a failed assertion must stay readable
const brief = (r) => `HTTP ${r.statusCode} ${String(r.body ?? '').slice(0, 160)}`;
const LIBRARIAN_EMAIL = 'librarian.accept@meridian.edu';
// copied verbatim from RolesAdmin.tsx LIBRARIAN_START so the test fails if the shipped preset drifts
const LIBRARIAN_ALLOW = [
  'GET /plugins/library/books',
  'POST /plugins/library/books',
  'POST /plugins/library/loans',
  'POST /plugins/library/loans/*',
  'GET /plugins/library/loans',
  'GET /plugins/library/overdue',
];

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  // The seed REGISTERS these plugins; a school enables the ones it pays for. Enabling through the door the
  // owner actually uses (rather than flipping a column) keeps this suite honest about the real flow.
  for (const id of ['library', 'people.admin']) {
    const r = await app.inject({ method: 'POST', url: `/plugins/${id}/enable`, headers: H(owner.token), payload: { class: 'A', version: '1.0.0' } });
    assert.equal(r.statusCode, 200, `could not enable ${id}: ${brief(r)}`);
  }
});

after(async () => { await app?.close(); });

describe('RBAC-1 · custom-role masks are enforced on plugin doors', () => {
  test('the roles store and the library plugin are present — this suite is not conditional', async () => {
    const ready = await pool.query(`SELECT to_regclass('app.roles') IS NOT NULL AS roles_ok,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='app' AND table_name='users' AND column_name='role_key') AS key_ok`);
    assert.ok(ready.rows[0].roles_ok && ready.rows[0].key_ok,
      'app.roles + users.role_key must exist: a conditional skip here would hide the whole feature (TST-5)');
    const lib = await pool.query(`SELECT status FROM app.plugins WHERE plugin_id='library' LIMIT 1`);
    assert.equal(lib.rows[0]?.status, 'enabled', 'the library plugin must be enabled for these doors to exist');
  });

  test('D-43: a separate librarian account reaches the library and is refused on finance', async () => {
    // 1) the owner creates the role exactly as the shipped preset describes it
    const made = await app.inject({ method: 'POST', url: '/roles', headers: H(owner.token), payload: {
      key: 'librarian', label: 'Librarian', base_role: 'teacher', permissions: { allow: LIBRARIAN_ALLOW, deny: [] } } });
    assert.ok([200, 201].includes(made.statusCode), brief(made));

    // 2) a REAL separate account, not the principal's login
    const created = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.token), payload: {
      email: LIBRARIAN_EMAIL, name: 'Meera Librarian', role: 'teacher', password: 'schoolos-demo' } });
    assert.ok([200, 201].includes(created.statusCode), brief(created));
    const librarianId = (await pool.query(`SELECT id FROM app.users WHERE email=$1`, [LIBRARIAN_EMAIL])).rows[0].id;

    // 3) assign it — the librarian is a teacher-based role, per the preset
    const assigned = await app.inject({ method: 'POST', url: '/roles/librarian/assign', headers: H(owner.token), payload: { userIds: [librarianId] } });
    assert.equal(assigned.statusCode, 200, brief(assigned));
    assert.equal(assigned.json().assigned, 1);

    const librarian = await loginAs(app, LIBRARIAN_EMAIL);
    const plainTeacher = await loginAs(app, 'teacher@meridian.edu');

    // THE ALLOW MUST LIFT THE PLUGIN DOOR'S ROLE REFUSAL. teacher ∉ library STAFF, so without the fix every
    // one of these is 403 `role teacher not permitted` — that is the "librarian cannot be made to work" bug.
    const refusedForPlain = await app.inject({ method: 'GET', url: '/plugins/library/books', headers: H(plainTeacher.token) });
    assert.equal(refusedForPlain.statusCode, 403, 'a plain teacher is NOT a library role — the refusal is the baseline');
    assert.match(refusedForPlain.json().error, /not permitted/);

    const books = await app.inject({ method: 'GET', url: '/plugins/library/books', headers: H(librarian.token) });
    assert.equal(books.statusCode, 200, `the librarian mask must grant the catalog: ${brief(books)}`);
    assert.ok(Array.isArray(books.json().books), 'and the door answered rather than the gate');

    const added = await app.inject({ method: 'POST', url: '/plugins/library/books', headers: H(librarian.token),
      payload: { title: 'The Library Book', author: 'Susan Orlean', copies_total: 2 } });
    assert.ok([200, 201].includes(added.statusCode), `the librarian can add books: ${brief(added)}`);
    const loans = await app.inject({ method: 'GET', url: '/plugins/library/loans', headers: H(librarian.token) });
    assert.equal(loans.statusCode, 200, brief(loans));

    // …AND FINANCE MUST REFUSE IT (the other half of the D-43 criterion: the mask is not a promotion)
    const fees = await app.inject({ method: 'GET', url: '/fees/obligations', headers: H(librarian.token) });
    assert.equal(fees.statusCode, 403, `the librarian must not read finance: ${brief(fees)}`);
    const feesWrite = await app.inject({ method: 'POST', url: '/fees/payments', headers: H(librarian.token), payload: {} });
    assert.equal(feesWrite.statusCode, 403, 'nor record payments');

    // the account is visible as a distinct member of the role (not "the principal's login")
    const roster = await app.inject({ method: 'GET', url: '/roles', headers: H(owner.token) });
    const row = roster.json().roles.find((r) => r.key === 'librarian');
    assert.equal(row?.members, 1, 'one member: the librarian account, not the principal');
  });

  test('a mask grant is honoured even where the door re-checks the role inside the handler', async () => {
    // RBAC-1's second half: a `require()` gate can only lift a refusal it makes itself. Doors that check
    // the built-in role INSIDE the handler refused a mask-granted custom role, and `routes.js` said so in a
    // comment ("KNOWN LIMITATION (tracked as RBAC-1, Phase 2): a custom role granted an explicit
    // `GET /fees/obligations` mask is refused here rather than honoured"). This is that exact case.
    const uid = (await pool.query(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0].id;
    const before = await loginAs(app, 'teacher@meridian.edu');
    const denied = await app.inject({ method: 'GET', url: '/fees/obligations', headers: H(before.token) });
    assert.equal(denied.statusCode, 403, `baseline: a teacher has no fee mandate (${brief(denied)})`);
    // The door is now gated by `roleGatedMe(FEE_LEDGER_ROLES...)`, so a teacher is refused at the GATE with
    // the generic role message rather than inside the handler. The mask grant below is what the test is
    // actually about, and `roleGatedMe` honours it the same way the old in-handler `canReach` did.
    assert.match(denied.json().error, /doesn't allow this action|fee ledger is for school staff/);

    const made = await app.inject({ method: 'POST', url: '/roles', headers: H(owner.token), payload: {
      key: 'feesviewer', label: 'Fees viewer', base_role: 'teacher', permissions: { allow: ['GET /fees/obligations'], deny: [] } } });
    assert.ok([200, 201].includes(made.statusCode), brief(made));
    const bound = await app.inject({ method: 'POST', url: '/roles/feesviewer/assign', headers: H(owner.token), payload: { userIds: [uid] } });
    assert.equal(bound.json().assigned, 1, brief(bound));

    const t = await loginAs(app, 'teacher@meridian.edu');
    const granted = await app.inject({ method: 'GET', url: '/fees/obligations', headers: H(t.token) });
    assert.equal(granted.statusCode, 200, `the mask grant must lift an in-handler role check too: ${brief(granted)}`);
    assert.ok(Array.isArray(granted.json().obligations), 'and the door answered with data, not a refusal');

    // …and a door the mask does NOT name is still refused. (Not GET /cases: STAFF_CASE_ROLES includes
    // teacher, so a teacher-based role passes that one on its own — asserting a 403 there would have been
    // a false expectation, which is why the control door is one teachers genuinely cannot reach.)
    const other = await app.inject({ method: 'POST', url: '/fees/payments', headers: H(t.token), payload: {} });
    assert.equal(other.statusCode, 403, `no grant for this door — it must stay refused: ${brief(other)}`);

    // scope checks must NOT be lifted by a grant: a mask cannot make someone a parent of a child
    const scoped = await app.inject({ method: 'GET', url: '/fees/obligations?studentId=00000000-0000-0000-0000-000000000000', headers: H(t.token) });
    assert.notEqual(scoped.json().scoped, 'own_children', 'the parent-scoping branch is about WHOSE rows these are, not permission');

    const cleared = await app.inject({ method: 'POST', url: '/roles/feesviewer/unassign', headers: H(owner.token), payload: { userIds: [uid] } });
    assert.equal(cleared.statusCode, 200, brief(cleared));
    const back = await app.inject({ method: 'GET', url: '/fees/obligations', headers: H((await loginAs(app, 'teacher@meridian.edu')).token) });
    assert.equal(back.statusCode, 403, 'unassigning restores the built-in refusal exactly');
  });

  test('/me carries the caller\'s OWN binding and mask — and nobody else\'s', async () => {
    // RBAC-3: the client needs its own mask to decide what to RENDER. It is a display hint (the server
    // re-decides every door), and it is scoped to the caller: a user with no custom role gets null, and the
    // mask returned is theirs, not a tenant-wide list.
    const librarian = await loginAs(app, LIBRARIAN_EMAIL);
    const mine = await app.inject({ method: 'GET', url: '/me', headers: H(librarian.token) });
    assert.equal(mine.statusCode, 200, brief(mine));
    const body = mine.json();
    assert.equal(body.role, 'teacher', 'the built-in base role is unchanged — the mask is additive information');
    assert.equal(body.role_key, 'librarian', '/me must name the custom role binding');
    assert.ok(Array.isArray(body.custom?.allow), 'and carry its allow list');
    assert.ok(body.custom.allow.includes('GET /plugins/library/books'), brief(mine));
    assert.deepEqual(body.custom.deny, []);

    const plain = await loginAs(app, 'principal@meridian.edu');
    const theirs = await app.inject({ method: 'GET', url: '/me', headers: H(plain.token) });
    assert.equal(theirs.statusCode, 200);
    assert.equal(theirs.json().role_key, null, 'a user without a custom role gets no binding');
    assert.equal(theirs.json().custom, null, 'and no mask');
  });

  test('a DENY on a plugin door is honoured (it used to be silently ignored)', async () => {
    // The base role must ALREADY reach this door, or the 403 proves only that the role gate works and the
    // test would pass with masks entirely ignored. `facilities` is in library's STAFF; `teacher` is not.
    const facilities = (await pool.query(`SELECT id FROM app.users WHERE email='facilities@meridian.edu'`)).rows[0];
    const baseline = await loginAs(app, 'facilities@meridian.edu');
    const allowedForFacilities = await app.inject({ method: 'GET', url: '/plugins/library/loans', headers: H(baseline.token) });
    assert.equal(allowedForFacilities.statusCode, 200,
      `baseline: facilities reaches the loans door WITHOUT any custom role (${brief(allowedForFacilities)})`);
    const teacher = facilities; // the deny is assigned to the same account, now carrying the custom role
    // the deny targets a plugin door the base role would otherwise reach via an allow grant
    const patched = await app.inject({ method: 'PATCH', url: '/roles/librarian', headers: H(owner.token), payload: {
      permissions: { allow: LIBRARIAN_ALLOW, deny: ['GET /plugins/library/loans'] } } });
    assert.equal(patched.statusCode, 200, brief(patched));
    const assigned = await app.inject({ method: 'POST', url: '/roles/librarian/assign', headers: H(owner.token), payload: { userIds: [teacher.id] } });
    assert.equal(assigned.statusCode, 200, brief(assigned));
    assert.equal(assigned.json().assigned, 1, 'the deny must actually be bound to an account');

    const t = await loginAs(app, 'facilities@meridian.edu');
    const denied = await app.inject({ method: 'GET', url: '/plugins/library/loans', headers: H(t.token) });
    assert.equal(denied.statusCode, 403, `the deny must reach the plugin door: ${brief(denied)}`);
    assert.match(denied.json().error, /custom role/i, 'and say why — one clean refusal, not a 500 from a double send');
    // everything else in the allow list still works
    const stillOk = await app.inject({ method: 'GET', url: '/plugins/library/books', headers: H(t.token) });
    assert.equal(stillOk.statusCode, 200, brief(stillOk));

    // CLEANUP as the test found it: remove the deny and unassign, then prove the door reopened — an
    // unassignment or a mask edit that did NOT take effect would otherwise leak into the suites after this.
    const restore = await app.inject({ method: 'PATCH', url: '/roles/librarian', headers: H(owner.token), payload: {
      permissions: { allow: LIBRARIAN_ALLOW, deny: [] } } });
    assert.equal(restore.statusCode, 200, brief(restore));
    const reopened = await app.inject({ method: 'GET', url: '/plugins/library/loans', headers: H((await loginAs(app, 'facilities@meridian.edu')).token) });
    assert.equal(reopened.statusCode, 200, `removing the deny must reopen the plugin door: ${brief(reopened)}`);
    const off = await app.inject({ method: 'POST', url: '/roles/librarian/unassign', headers: H(owner.token), payload: { userIds: [teacher.id] } });
    assert.equal(off.statusCode, 200, brief(off));
  });

  test('a DENY is honoured on a door with NO role gate of its own — enforcement rides authenticate', async () => {
    // /dataset is gated by `authenticate` alone: there is no `require()` to apply a mask, so before this fix
    // a deny naming it was unenforceable. A teacher passes it; the same teacher with a denying role does not.
    const plain = await loginAs(app, 'teacher@meridian.edu');
    const before = await app.inject({ method: 'GET', url: '/dataset', headers: H(plain.token) });
    assert.equal(before.statusCode, 200, `baseline: a teacher reads /dataset (${before.statusCode})`);

    const uid = (await pool.query(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0].id;
    const made = await app.inject({ method: 'POST', url: '/roles', headers: H(owner.token), payload: {
      key: 'noscore', label: 'No dataset read', base_role: 'teacher', permissions: { allow: [], deny: ['GET /dataset'] } } });
    assert.ok([200, 201].includes(made.statusCode), `role creation is the premise of this test: ${brief(made)}`);
    const bound = await app.inject({ method: 'POST', url: '/roles/noscore/assign', headers: H(owner.token), payload: { userIds: [uid] } });
    assert.equal(bound.statusCode, 200, brief(bound));
    assert.equal(bound.json().assigned, 1, 'the deny must actually be bound, or the 403 below proves nothing');

    const t = await loginAs(app, 'teacher@meridian.edu');
    const denied = await app.inject({ method: 'GET', url: '/dataset', headers: H(t.token) });
    assert.equal(denied.statusCode, 403, `a deny on an ungated door must still be enforced: ${brief(denied)}`);
    assert.match(denied.json().error, /custom role/i);

    // a user WITHOUT a role_key is untouched — enforcement must not become a blanket behaviour change
    const other = await loginAs(app, 'principal@meridian.edu');
    const unaffected = await app.inject({ method: 'GET', url: '/dataset', headers: H(other.token) });
    assert.equal(unaffected.statusCode, 200, brief(unaffected));

    // cleanup: unassign so this role cannot leak into another suite's expectations
    const cleared = await app.inject({ method: 'POST', url: '/roles/noscore/unassign', headers: H(owner.token), payload: { userIds: [uid] } });
    assert.equal(cleared.statusCode, 200, brief(cleared));
    const back = await app.inject({ method: 'GET', url: '/dataset', headers: H((await loginAs(app, 'teacher@meridian.edu')).token) });
    assert.equal(back.statusCode, 200, 'unassigning must restore the base role exactly');
  });
});
