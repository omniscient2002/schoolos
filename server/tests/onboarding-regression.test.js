// ONBOARDING REGRESSION — every defect found by driving a real school through the UI
// (docs/ONBOARDING-RUN-LOG.md) and fixed in docs/ONBOARDING-FIXES.md.
//
// Each test below failed against the code as it stood before the fix. They are grouped by
// the finding id so a future regression points straight at the run step that caught it.
//
//   C-1  CORS allowed only GET/HEAD/POST, so every PUT/PATCH/DELETE door was unreachable
//        from a browser — including PUT /school/classes, the first thing a school does.
//   C-2  the Add-ons board was driven by a stale CLIENT copy of the server's plugin registry,
//        so 12 plugins could never be enabled and server-enabled ones looked OFF.
//   F-1  nothing in the SPA called /class-assignments, and that ownership is exactly what
//        gates POST /attendance/mark — so no teacher could ever mark a register.
//   F-2  the library members door did ORDER BY s.grade::int on a FREE TEXT column, so any
//        school with named grades got a 500 and an empty borrower picker.
//   F-3  reset-password returned only `temporaryPassword` while the client read `tempPassword`:
//        the mint modal rendered an EMPTY one-time password — an unrecoverable lockout.
//   F-6  the members picker listed withdrawn pupils, which the issue door then refused with a
//        409 that named nothing about which row was wrong.
//   F-12 fee-plan grade scope was hard-coded 1..10 instead of the school's own classes, so a
//        school with named grades could select no grade and generation matched nobody.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app, sql, owner, principal, teacher, librarian, tenantA, teacherId, studentId, studentUuid;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const req = (method, url, token, payload) => app.inject({ method, url, payload, headers: H(token) });

// The Classes screen asks for FREE TEXT grades ("e.g. 6, LKG, Nursery"). Every defect below
// only appears once a school actually uses one — which is why they all survived a test suite
// written against a seed whose grades happened to be bare digits.
const NAMED_GRADES = [{ grade: 'Grade 1', sections: ['A', 'B'] }, { grade: 'Grade 2', sections: ['A'] }];

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try { return await c.query(text, params); } finally { await c.end(); }
  };
  owner = (await loginAs(app, 'owner@meridian.edu')).token;
  principal = (await loginAs(app, 'principal@meridian.edu')).token;
  teacher = (await loginAs(app, 'teacher@meridian.edu')).token;
  tenantA = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  // NB: this must be the SAME account as `teacher` above. An independent `LIMIT 1` over
  // role='teacher' can return a different account, and then F-1 assigns the register to one
  // teacher and marks it as another — which the guard correctly refuses with a 403 that
  // looks exactly like the product bug this file exists to catch.
  teacherId = (await sql(`SELECT id FROM app.users WHERE tenant_id=$1 AND email='teacher@meridian.edu'`,
    [tenantA])).rows[0].id;

  // the seed ships no librarian; create one through the door with a known password, the
  // way rbac-plugin-edge does, so this test does not depend on a seeded fixture
  const LIB_EMAIL = 'onboarding.regression.librarian@meridian.edu';
  const made = await req('POST', '/plugins/people.admin/users', owner,
    { name: 'Regression Librarian', email: LIB_EMAIL, role: 'librarian', password: 'reg-lib-pass-1' });
  assert.ok([200, 409].includes(made.statusCode), `creating the librarian failed: ${made.body}`);

  // the library doors are lifecycle-gated and `library` is not born enabled
  await sql(`UPDATE app.plugins SET status='enabled' WHERE tenant_id=$1 AND plugin_id='library'`, [tenantA]);
  librarian = (await loginAs(app, LIB_EMAIL, 'reg-lib-pass-1')).token;

  // give this school NAMED grades, and one pupil in Grade 1-A
  const put = await req('PUT', '/school/classes', owner, { classes: NAMED_GRADES });
  assert.equal(put.statusCode, 200, `classes PUT failed: ${put.body}`);
  const enr = await req('POST', '/students', owner, {
    name: 'Regression Pupil', grade: 'Grade 1', section: 'A',
    guardianName: 'Regression Guardian', guardianPhone: '+91 90000 00001',
  });
  assert.equal(enr.statusCode, 200, `enrol failed: ${enr.body}`);
  studentUuid = enr.json().student.id;
  // one pupil whose grade is a bare digit, one whose grade carries no number at all - these
  // two are what exercise the ORDER BY's tie-break and its NULLS LAST branch.
  await sql(
    `INSERT INTO app.students (tenant_id, admission_no, name, grade, section)
     VALUES ($1,'REG-LEGACY-1','Legacy Digit Grade','1','A')`, [tenantA]);
  await sql(
    `INSERT INTO app.students (tenant_id, admission_no, name, grade, section)
     VALUES ($1,'REG-LEGACY-2','Non Numeric Grade','LKG','A')`, [tenantA]);
  studentId = (await sql(
    `SELECT id FROM app.students WHERE tenant_id=$1 AND name='Legacy Digit Grade'`, [tenantA])).rows[0].id;
});

after(async () => { await app?.close(); });

// ─────────────────────────────────────────────────────────── C-1 · CORS methods

test('C-1 · the preflight allows every method the router actually registers', async () => {
  // The defect: a browser preflights PUT and the server answered "GET,HEAD,POST", so the
  // request never left the browser. Assert against the live server's own preflight handler.
  for (const method of ['PUT', 'PATCH', 'DELETE', 'POST', 'GET', 'OPTIONS']) {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/school/classes',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': method,
        'access-control-request-headers': 'content-type,authorization',
      },
    });
    const allow = String(res.headers['access-control-allow-methods'] ?? '');
    assert.ok(allow.includes(method),
      `preflight for ${method} does not allow it; Access-Control-Allow-Methods = "${allow}"`);
  }
});

test('C-1 · the headers the API reads are not narrowed by the CORS config', async () => {
  // Pin the trap: an explicit `allowedHeaders` list looks like a fix and silently breaks
  // `idempotency-key` (POST /fees/payments), `x-api-key` and the webhook signature. The
  // default reflects what the browser asks for; this asserts that still holds.
  const res = await app.inject({
    method: 'OPTIONS',
    url: '/fees/payments',
    headers: {
      origin: 'http://localhost:5173',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,idempotency-key,authorization',
    },
  });
  const allow = String(res.headers['access-control-allow-headers'] ?? '').toLowerCase();
  assert.ok(allow.includes('idempotency-key'), `idempotency-key not allowed; got "${allow}"`);
});

// ─────────────────────────────────────────────────────────── C-2 · the plugin registry

test('C-2 · the server registry is the list of record — no client-side subset', async () => {
  const res = await req('GET', '/plugins', owner);
  assert.equal(res.statusCode, 200);
  const rows = res.json().plugins ?? [];
  assert.ok(rows.length >= 29, `expected the full catalog, got ${rows.length}`);

  // the 12 that the stale client registry omitted must all be present and enableable
  const MUST_EXIST = [
    'teacher.classroom', 'exams.assessment', 'student.world', 'parent.assistant',
    'coord.view', 'teacher.copilot', 'teacher.support', 'health.clinic',
    'hr.leave', 'family.view', 'accounting.tally', 'pack.cbse', 'pack.dpdp',
  ];
  const byId = new Map(rows.map((r) => [r.plugin_id, r]));
  for (const id of MUST_EXIST) {
    assert.ok(byId.has(id), `plugin ${id} is missing from GET /plugins`);
    assert.notEqual(byId.get(id).status, 'disabled-permanently', `${id} is not enableable`);
  }
});

// ─────────────────────────────────────────────────────────── F-1 · register ownership

test('F-1 · a teacher can be given a register, and only then can they mark it', async () => {
  const assign = await req('POST', '/class-assignments', principal,
    { teacherId, grade: 'Grade 1', section: 'A' });
  assert.equal(assign.statusCode, 200, `assignment failed: ${assign.body}`);
  assert.ok(assign.json().assignmentId, 'no assignmentId returned — the client needs it to render the row');

  const listed = await req('GET', '/class-assignments', principal);
  assert.equal(listed.statusCode, 200);
  assert.ok(listed.json().assignments.some((a) => a.grade === 'Grade 1' && a.section === 'A'),
    'the assignment is not listed back');

  // the whole point: attendance marking is now permitted for the owner of the register
  const mark = await req('POST', '/attendance/mark', teacher, {
    date: new Date().toISOString().slice(0, 10),
    marks: [{ studentId: studentUuid, status: 'present' }],
  });
  assert.equal(mark.statusCode, 200, `teacher could not mark the register they own: ${mark.body}`);
});

// ─────────────────────────────────────────────────────────── F-2 · free-text grades

test('F-2 · the library members door survives a school whose grades are named', async () => {
  // This returned 500 "invalid input syntax for type integer: Grade 1" because the query
  // cast a text column to int purely for ordering.
  const res = await req('GET', '/plugins/library/members?limit=50', librarian);
  assert.equal(res.statusCode, 200, `members door failed for named grades: ${res.body}`);
  const borrowers = res.json().borrowers ?? res.json().students ?? [];
  assert.ok(borrowers.length > 0, 'borrower list is empty — nothing can be issued');
  assert.ok(borrowers.some((b) => b.grade === 'Grade 1'),
    `named grade missing from the picker: ${JSON.stringify(borrowers.map((b) => b.grade))}`);
});

test('F-2 · grades sort by the number they carry, and a label with no number sorts last', async () => {
  // Assert the ORDER BY's actual contract rather than a page's contents: the seeded table
  // is large and grows, so "is LKG at index N" is a test of table size, not of sorting.
  const res = await req('GET', '/plugins/library/members?limit=300', librarian);
  assert.equal(res.statusCode, 200, 'the members door 500s on named grades');
  const rows = res.json().borrowers ?? [];
  const students = rows.filter((r) => r.type === 'student');

  // the integer the label carries, and null when it carries none
  const key = (g) => { const d = String(g ?? '').replace(/\D/g, ''); return d === '' ? null : Number(d); };
  const keys = students.map((s) => key(s.grade));
  for (let i = 1; i < keys.length; i++) {
    const prev = keys[i - 1], cur = keys[i];
    assert.ok(prev === null || cur !== null || prev === cur,
      `a grade with no number must sort after every grade that has one (index ${i})`);
    if (prev !== null && cur !== null) {
      assert.ok(prev <= cur, `grades out of order at index ${i}: ${prev} then ${cur}`);
    }
  }

  // and a grade carrying no number is still a real, borrowable row - not dropped by the cast
  const lkg = await req('GET', '/plugins/library/members?limit=50&grade=LKG', librarian);
  assert.equal(lkg.statusCode, 200, `the grade filter 500s on a digit-less grade: ${lkg.body}`);
  assert.ok((lkg.json().borrowers ?? []).some((b) => b.name === 'Non Numeric Grade'),
    'a pupil whose grade carries no number is unreachable from the picker');
});

// ─────────────────────────────────────────────────────────── F-3 · the reset door

test('F-3 · reset-password returns the one-time secret under the ONE name the client reads', async () => {
  const u = (await sql(
    `SELECT id FROM app.users WHERE tenant_id=$1 AND role='teacher' LIMIT 1`, [tenantA])).rows[0];
  const res = await req('POST', `/plugins/people.admin/users/${u.id}/reset-password`, owner, {});
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  /* F-3 was a NAME MISMATCH: the door minted a secret the office could not see, leaving an
     unrecoverable lockout. The fix added a second alias; P2-11 removed it again, so the wire now
     has exactly one spelling and this test pins that — including the ABSENCE of the old alias,
     because "both names" is how the two sides silently drifted apart in the first place. */
  assert.ok(body.temporaryPassword, 'reset-password did not return `temporaryPassword` — the SPA renders an EMPTY one-time password');
  assert.equal(body.tempPassword, undefined, 'the alias is gone: one door, one name (P2-11)');
  assert.ok(String(body.temporaryPassword).length >= 8, 'the one-time password is implausibly short');
  // and the create door answers the same single name
  const created = await req('POST', '/plugins/people.admin/users', owner,
    { name: 'F3 Probe', email: 'f3.probe@meridian.edu', role: 'teacher' });
  assert.equal(created.statusCode, 200, created.body);
  const cb = created.json();
  assert.ok(cb.temporaryPassword, 'the create door must answer the same single name as reset');
  assert.equal(cb.tempPassword, undefined, 'the create door still carries the alias (P2-11)');
  assert.ok(cb.note, 'the once-only warning travels with the secret');
});

// ─────────────────────────────────────────────────────────── F-6 · withdrawn pupils

test('F-6 · the borrower picker never offers a pupil who cannot borrow', async () => {
  await req('POST', `/plugins/people.admin/students/${studentId}/withdraw`, owner,
    { reason: 'regression probe', effective_date: '2026-01-01' });

  const res = await req('GET', '/plugins/library/members?limit=50', librarian);
  assert.equal(res.statusCode, 200);
  const names = (res.json().students ?? []).map((s) => s.name);
  assert.ok(!names.includes('Legacy Digit Grade'),
    'a withdrawn pupil is still offered as a borrower — the issue door will refuse them with a 409');
  assert.ok(names.includes('Regression Pupil'), 'an active pupil disappeared from the picker');
});

// A regression suite that only passes the first time it is run is not a regression suite.
// F-6 below withdraws a pupil, so put them back afterwards and drop the fixtures.
test.after(async () => {
  // withdraw() sets status='transferred' and records the reason in the audit log only —
  // there is no reason column to clear.
  await sql(`UPDATE app.students SET status='active', bus_route=NULL WHERE tenant_id=$1
             AND name IN ('Regression Pupil','Legacy Digit Grade','Non Numeric Grade')`, [tenantA]);
  // children before parents: loan.copy_id is ON DELETE RESTRICT, so the loan issued above
  // has to go before its copy, and the copy before its book.
  await sql(`DELETE FROM library.fine WHERE tenant_id=$1 AND borrower_student_id=$2`, [tenantA, studentUuid]);
  await sql(`DELETE FROM library.loan WHERE tenant_id=$1 AND student_id=$2`, [tenantA, studentUuid]);
  await sql(`DELETE FROM library.copy WHERE tenant_id=$1 AND copy_code='REG-COPY-1'`, [tenantA]);
  await sql(`DELETE FROM library.book WHERE tenant_id=$1 AND code='REG-BOOK-1'`, [tenantA]);
  await sql(`DELETE FROM app.students WHERE tenant_id=$1 AND admission_no IN ('REG-LEGACY-1','REG-LEGACY-2')`,
    [tenantA]);
  /* No tenant cleanup needed for the C-3 signup: setupTestDb() DROPs and re-CREATEs the whole
     database at the start of every run, so nothing survives to collide with a second sign-up.
     Deleting the tenant by hand was a false problem with a long tail (tenants -> events ->
     outbox -> …) and was itself the thing failing. */
});

test('F-6 · issuing to an active pupil in a NAMED grade works end to end', async () => {
  const book = (await sql(
    `INSERT INTO library.book (tenant_id, code, title, book_type, status, copies_total)
     VALUES ($1,'REG-BOOK-1','Regression Title','book','available',1) RETURNING id`, [tenantA])).rows[0];
  await sql(
    `INSERT INTO library.copy (tenant_id, book_id, copy_code, status, condition)
     VALUES ($1,$2,'REG-COPY-1','available','ok')`, [tenantA, book.id]);

  const res = await req('POST', '/plugins/library/loans', librarian, { bookId: book.id, studentId: studentUuid });
  assert.equal(res.statusCode, 200, `issuing in a named grade failed: ${res.body}`);
  assert.ok(res.json().loanId, 'no loanId returned');
});

// ─────────────────────────────────────────────────────────── F-12 · the fee-plan scope

test('F-12 · a fee plan can be scoped to the school\'s OWN grades, not a hard-coded 1..10', async () => {
  // The UI used to offer ['1'..'10']; a school with "Grade 1".."Grade 8" could select no
  // grade at all, and generation would have matched zero students.
  const plan = await req('POST', '/fee-plans', principal, {
    name: 'Regression tuition',
    grades: NAMED_GRADES.map((c) => c.grade),
    terms: [{ term: 'Term 1', label: 'Regression', amount_cents: 100000 }],
  });
  assert.equal(plan.statusCode, 200, `creating a plan for named grades failed: ${plan.body}`);
  assert.deepEqual(plan.json().feePlan.grades, ['Grade 1', 'Grade 2']);

  // and the dues it generates must actually match this school's pupils
  const gen = await req('POST', `/fee-plans/${plan.json().feePlan.id}/generate`, principal, {});
  assert.equal(gen.statusCode, 200, gen.body);
  assert.ok(gen.json().inserted > 0,
    `generation matched no students for named grades: ${JSON.stringify(gen.json())}`);
});

// ────────────────────────────────────────────────��────────── C-3 · the signup session cookie

test('C-3 · a self-signed-up owner gets the session cookies, not just a bearer', async () => {
  /* This door has always returned the same { token, user } BODY as /auth/login while skipping
     the HttpOnly `schoolos_session` + `schoolos_csrf` pair. In a same-origin deployment the
     cookie IS the durable credential — the client holds the bearer in memory only, by design
     (FEX-3) — so a fresh owner was signed out on their very first refresh and had to sign in
     again. Assert the cookies are issued AND that the one the browser keeps actually works. */
  const res = await req('POST', '/onboard/signup', null, {
    schoolName: 'Regression Signup School', ownerName: 'Reg Owner',
    ownerEmail: 'reg.owner.signup@meridian.edu', ownerPassword: 'reg-signup-pass-1',
  });
  assert.equal(res.statusCode, 200, `signup failed: ${res.body}`);
  const setCookie = String(res.headers['set-cookie'] ?? '');
  assert.match(setCookie, /schoolos_session=/,
    `signup issued no session cookie — a same-origin owner is signed out on first refresh. Got: ${setCookie || '(no set-cookie at all)'}`);
  assert.match(setCookie, /HttpOnly/i, 'schoolos_session must stay unreadable to JS');
  assert.match(setCookie, /schoolos_csrf=/, 'the double-submit CSRF cookie must ride with it');

  // and the cookie the browser would keep must authenticate a cold open
  const jar = setCookie.split(/,(?=\s*schoolos_)/).map((c) => c.split(';')[0].trim()).join('; ');
  const csrf = /schoolos_csrf=([^;]+)/.exec(setCookie)?.[1];
  assert.ok(csrf, 'could not read the CSRF cookie back out of set-cookie');
  const renew = await app.inject({ method: 'POST', url: '/auth/renew', headers: { cookie: jar, 'x-csrf-token': csrf } });
  assert.equal(renew.statusCode, 200,
    `the issued cookie does not authenticate /auth/renew — the session would not survive a reload: ${renew.body}`);
  assert.ok(renew.json().token, '/auth/renew returned no bearer for a cookie session');
  // keyed on the OWNER, not the slug: signup derives the slug from the school name, so asserting
  // a slug I did not send would be asserting my own guess rather than the behaviour.
  const made = await sql(`SELECT 1 FROM app.users WHERE email=$1 AND role='owner'`, ['reg.owner.signup@meridian.edu']);
  assert.equal(made.rows.length, 1, 'the owner account was not created — this test must not pass by accident');
});
