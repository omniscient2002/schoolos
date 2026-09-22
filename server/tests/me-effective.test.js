// Effective access — the server tells a caller which surfaces they may render (PERFECT-100 §6.2 item 14).
//
// THE DEFECT (RBAC-6 / FE-2): the client invented its own permission model — a 12-branch nav switch with
// no `default` (so an unknown role became the broadest), a 43-entry `staffOnly` prefix list, and a command
// palette that exposed 21 staff destinations to every signed-in user. Any server-side role change needed a
// frontend release, and the two layers drifted. `GET /me/effective` now answers the question the client
// actually has, from the SAME registry and mask the doors enforce.
//
// WHAT THIS PINS:
//   1. DRIFT: every surface→door target in `SURFACE_DOOR` is a door that actually exists in the running
//      registry. A typo would otherwise silently hide (or reveal) a screen; here it fails loudly.
//   2. The answer follows the REGISTRY, not a hardcoded list: a teacher loses `/roles`/`/it` and keeps
//      `/people`; an owner keeps `/roles`/`/it`.
//   3. A custom mask moves surfaces both ways — an ALLOW adds `/library` for a teacher-based librarian, a
//      DENY removes `/people` — so the client renders exactly what the doors will allow.
//   4. `scope.classes` is a teacher's own form-classes (PRD-2), empty for others.
//   5. Unauthenticated is refused.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, loginAs } from './helpers.js';
import { SURFACE_DOOR, SAMPLE_SURFACES } from '../src/effective-access.js';
import { scanRoutes } from '../scripts/permission-matrix.js';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let app;
let pool;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json', 'x-step-up-password': 'schoolos-demo' });
const brief = (r) => `HTTP ${r.statusCode} ${String(r.body ?? '').slice(0, 200)}`;
const eff = (token) => app.inject({ method: 'GET', url: '/me/effective', headers: H(token) });
const SHELVER = 'shelver.effective@meridian.edu';

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  const owner = await loginAs(app, 'owner@meridian.edu');
  // The seed REGISTERS people.admin; a school enables it. Enabling through the owner's real door keeps
  // this honest about the flow, and a fresh teacher account is the only way to test a teacher-based mask
  // (the seed ships one teacher, already used by other assertions).
  const on = await app.inject({ method: 'POST', url: '/plugins/people.admin/enable', headers: H(owner.token), payload: { class: 'B', version: '1.0.0' } });
  assert.equal(on.statusCode, 200, `could not enable people.admin: ${brief(on)}`);
  const created = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.token), payload: {
    email: SHELVER, name: 'Shelly Effective', role: 'teacher', password: 'schoolos-demo' } });
  assert.ok([200, 201].includes(created.statusCode), `could not create ${SHELVER}: ${brief(created)}`);
});

after(async () => { await app?.close(); });

describe('GET /me/effective · drift + shape', () => {
  test('every SURFACE_DOOR target is a real door the codebase registers (a typo fails here, not silently in the UI)', async () => {
    // Validate against the SAME static scanner that generates docs/PERMISSION-MATRIX.md, NOT the live
    // registry. A live union of staff-reachable doors cannot work for surfaces whose doors belong to a
    // disabled plugin (`GET /parent/home`, `GET /student/home`, …): those doors do not exist until the
    // school enables the plugin, so the mapping is correct while the live check fails. The scanner reads
    // every `app.<verb>()` declaration in app.js, routes.js and each plugin index.js, so a typo is still
    // caught — while a plugin that is merely switched off is not mistaken for one.
    const dir = (p) => join(SERVER_ROOT, p);
    const files = [dir('src/app.js'), dir('src/routes.js'),
      ...readdirSync(dir('src/plugins'), { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('_') && existsSync(dir(`src/plugins/${e.name}/index.js`)))
        .map((e) => dir(`src/plugins/${e.name}/index.js`))];
    const doors = new Set(scanRoutes(files).map((r) => `${r.method} ${r.path}`));
    assert.ok(doors.size > 200, `the route scanner found only ${doors.size} doors — the fixture is wrong, not SURFACE_DOOR`);
    for (const [surface, door] of Object.entries(SURFACE_DOOR)) {
      assert.ok(doors.has(door), `SURFACE_DOOR['${surface}'] = '${door}' is not a door this codebase registers — fix the map`);
    }
  });

  test('every renderable app route is named in SURFACE_DOOR (FEX-5 fail-closed coverage)', () => {
    // FEX-5 made the client fail CLOSED on an unnamed surface. That is only safe if the server names
    // every route the guarded app tree renders — otherwise a real screen would silently disappear. The
    // public/redirect routes below are deliberately outside the guarded tree (`/onboard` renders before
    // AuthGate; the others redirect or catch-all).
    const appSrc = readFileSync(join(SERVER_ROOT, '..', 'app', 'src', 'App.tsx'), 'utf8');
    // Only ABSOLUTE top-level paths are checked. Relative child routes (e.g. the library
    // desk's `path="issue"`) render inside their parent section and inherit its surface:
    // `canSurface` resolves them by longest-prefix, so the parent's SURFACE_DOOR entry is
    // the fail-closed decision. Treating a bare `issue` as a top-level route was a false
    // positive introduced when the desk became a sectioned workspace.
    const routes = [...appSrc.matchAll(/path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p.startsWith('/'));
    const PUBLIC_OR_REDIRECT = new Set(['/', '/login', '*', '/onboard']);
    const missing = [...new Set(routes)].filter((p) => !PUBLIC_OR_REDIRECT.has(p) && !(p in SURFACE_DOOR) && !(p in SAMPLE_SURFACES));
    assert.deepEqual(missing, [],
      `App.tsx renders ${missing.join(', ')} but SURFACE_DOOR/SAMPLE_SURFACES has no entry — fail-closed would hide them`);
  });

  test('unauthenticated is refused', async () => {
    const r = await app.inject({ method: 'GET', url: '/me/effective' });
    assert.equal(r.statusCode, 401);
  });
});

describe('GET /me/effective · follows the registry per role', () => {
  test('a teacher can reach /people but not /roles or /it', async () => {
    const t = (await loginAs(app, 'teacher@meridian.edu')).token;
    const r = await eff(t);
    assert.equal(r.statusCode, 200, brief(r));
    const { capabilities, nav, role, role_key } = r.json();
    assert.equal(role, 'teacher');
    assert.equal(role_key, null, 'a plain teacher carries no custom role');
    assert.equal(capabilities['/people'], true, 'GET /students admits a teacher');
    assert.equal(capabilities['/roles'], false, 'GET /roles is owner/itadmin only');
    assert.equal(capabilities['/it'], false, 'GET /metrics is owner/itadmin only');
    // FEX-5: these admin surfaces used to proxy the `me` door GET /plugins, so every role was told it
    // could render them. Each now maps to a door whose real gate is owner/itadmin.
    assert.equal(capabilities['/group'], false, 'the group console is not a teacher surface (was GET /plugins)');
    assert.equal(capabilities['/rails'], false, 'rails configuration is not a teacher surface (was GET /plugins)');
    assert.equal(capabilities['/plugins/settings'], false, 'plugin settings is not a teacher surface (was GET /plugins)');
    // OPP-FE-2: Settings is the personal + school-profile surface every signed-in user is linked to from
    // the account menu, so it maps to the authenticated `GET /me` floor; its tabs gate their own content.
    assert.equal(capabilities['/settings'], true, 'settings is a signed-in surface (was GET /metrics)');
    assert.ok(nav.includes('/people') && !nav.includes('/roles'), 'nav is the true subset of capabilities');
  });

  test('an owner reaches the admin surfaces', async () => {
    const t = (await loginAs(app, 'owner@meridian.edu')).token;
    const { capabilities } = (await eff(t)).json();
    assert.equal(capabilities['/roles'], true);
    assert.equal(capabilities['/it'], true);
    assert.equal(capabilities['/audit'], true);
    // FEX-5: the admin surfaces an owner genuinely reaches through their real doors
    assert.equal(capabilities['/group'], true);
    assert.equal(capabilities['/settings'], true);
    assert.equal(capabilities['/rails'], true);
    assert.equal(capabilities['/plugins/settings'], true);
  });

  /* OPP-RBAC: the principal is a school-running authority. These surfaces are within that remit; the
     doors were widened with this campaign (app.js /ai/calls, /ai/eval, /workflow-rules). */
  test('a principal reaches the school-running oversight surfaces but not owner-only admin', async () => {
    const t = (await loginAs(app, 'principal@meridian.edu')).token;
    const { capabilities } = (await eff(t)).json();
    assert.equal(capabilities['/ai-usage'], true, 'principal oversees AI use (was owner/itadmin)');
    assert.equal(capabilities['/ai-governance'], true, 'principal oversees AI governance');
    assert.equal(capabilities['/automation'], true, 'principal runs workflow automation');
    assert.equal(capabilities['/group'], true, 'principal reaches the group console');
    assert.equal(capabilities['/settings'], true, 'principal reaches settings');
    assert.equal(capabilities['/plugins/settings'], true, 'principal may configure modules');
    assert.equal(capabilities['/roles'], false, 'custom-role administration stays owner/itadmin');
    assert.equal(capabilities['/it'], false, 'platform metrics stay owner/itadmin');
  });
});

describe('GET /me/effective · custom-role masks move surfaces', () => {
  test('an ALLOW grants a teacher-based role the library surface; a DENY removes /people', async () => {
    const owner = await loginAs(app, 'owner@meridian.edu');
    const made = await app.inject({ method: 'POST', url: '/roles', headers: H(owner.token), payload: {
      key: 'shelver', label: 'Shelver', base_role: 'teacher',
      permissions: { allow: ['GET /plugins/library/catalog', 'POST /plugins/library/books'], deny: ['GET /students'] } } });
    assert.ok([200, 201].includes(made.statusCode), brief(made));

    const shelver = (await pool.query(`SELECT id FROM app.users WHERE email=$1`, [SHELVER])).rows[0].id;
    const assigned = await app.inject({ method: 'POST', url: '/roles/shelver/assign', headers: H(owner.token), payload: { userIds: [shelver] } });
    assert.equal(assigned.statusCode, 200, brief(assigned));

    const t = (await loginAs(app, SHELVER)).token;
    const { role_key, capabilities } = (await eff(t)).json();
    assert.equal(role_key, 'shelver', '/me/effective names the caller\'s own custom role');
    assert.equal(capabilities['/library'], true, 'the mask ALLOW lifts the library surface onto a teacher');
    assert.equal(capabilities['/people'], false, 'the mask DENY removes /people (deny wins)');
  });

  test('a DENY beats an ALLOW on the same door, exactly like the gate', async () => {
    const owner = await loginAs(app, 'owner@meridian.edu');
    const made = await app.inject({ method: 'POST', url: '/roles', headers: H(owner.token), payload: {
      key: 'nosh', label: 'No Shelf', base_role: 'teacher',
      permissions: { allow: ['GET /plugins/library/catalog'], deny: ['GET /plugins/library/catalog'] } } });
    assert.ok([200, 201].includes(made.statusCode), brief(made));
    const shelver = (await pool.query(`SELECT id FROM app.users WHERE email=$1`, [SHELVER])).rows[0].id;
    await app.inject({ method: 'POST', url: '/roles/nosh/assign', headers: H(owner.token), payload: { userIds: [shelver] } });
    const t = (await loginAs(app, SHELVER)).token;
    const { capabilities } = (await eff(t)).json();
    assert.equal(capabilities['/library'], false, 'deny wins over allow — the screen must not offer what the door refuses');
  });
});

describe('GET /me/effective · scope', () => {
  test('a teacher sees the classes they own; another role sees none', async () => {
    const owner = await loginAs(app, 'owner@meridian.edu');
    const teacher = (await pool.query(`SELECT id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0];
    const assigned = await app.inject({ method: 'POST', url: '/class-assignments', headers: H(owner.token), payload: { teacherId: teacher.id, grade: '11', section: 'Z' } });
    assert.ok([200, 201].includes(assigned.statusCode), brief(assigned));

    const t = (await loginAs(app, 'teacher@meridian.edu')).token;
    const { scope } = (await eff(t)).json();
    assert.ok(scope.classes.some((c) => c.grade === '11' && c.section === 'Z'),
      `the assigned class must appear in scope.classes, got ${JSON.stringify(scope.classes)}`);

    const admin = (await loginAs(app, 'itadmin@meridian.edu')).token;
    const adminScope = (await eff(admin)).json().scope;
    assert.deepEqual(adminScope.classes, [], 'a non-teacher owns no form-classes');
  });
});
