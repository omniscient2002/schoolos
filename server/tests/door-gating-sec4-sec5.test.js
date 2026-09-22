// SEC-4 and SEC-5 — the last two unguarded doors from PERFECT-100 §7 item 5.
//
// SEC-4 is worth reading before changing anything here, because the fix is NOT the one the
// audit register recommends. The register says to gate `POST /cases` on STAFF_CASE_ROLES and
// force origin 'staff'. That would break a deliberate, tested product behaviour: this door
// is how a parent files a complaint, and tests/cases-privacy.test.js asserts a 200 carrying
// origin 'parent'. The door therefore stays open to families, and what is pinned below is
// the REAL defect — that the caller used to control four fields which are staff decisions:
// origin (misattribution in the audit spine), owner (assign a case to any staff member),
// priority (self-declared 'critical' at the top of the board) and slaHours (an SLA long
// enough that the case never escalates). Each is now derived from the caller's role.
//
// SEC-5: `/fees/obligations` returned up to 500 obligations for the WHOLE school to any
// non-parent role, student accounts included. Note the honest limitation: "student → own
// obligations only" is not implementable, because no link from a user account to a student
// record exists anywhere in the schema (app.users has no student_id; the only linkage tables
// are guardian links). So non-staff are refused rather than scoped — a missing feature beats
// a silent whole-school disclosure.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
});
after(async () => { await app?.close(); });

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const post = async (token, payload) => app.inject({ method: 'POST', url: '/cases', headers: H(token), payload });
const caseCount = async (title) => (await pool.query(
  `SELECT count(*)::int AS n FROM app.cases WHERE title=$1`, [title])).rows[0].n;

describe('SEC-4: a family can report, but cannot forge staff-case fields', () => {
  test('a parent CAN still file a complaint, and it is recorded as parent-originated', async () => {
    const p = await loginAs(app, 'parent@meridian.edu');
    const title = `sec4 parent report ${Date.now()}`;
    const r = await post(p.token, { kind: 'complaint', priority: 'high', slaHours: 24, title, detail: 'gate incident' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().case.origin, 'parent', 'origin must be derived from the role, not the body');
    assert.equal(await caseCount(title), 1);
  });

  test('a parent CANNOT misattribute the source: a supplied origin is ignored', async () => {
    const p = await loginAs(app, 'parent@meridian.edu');
    const r = await post(p.token, {
      kind: 'complaint', title: `sec4 forged origin ${Date.now()}`, detail: 'x',
      origin: 'system',            // the injection: claim the platform raised it
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().case.origin, 'parent', 'a caller-supplied origin must never be trusted');
  });

  test('a parent CANNOT assign the case to a staff member by name', async () => {
    const p = await loginAs(app, 'parent@meridian.edu');
    const r = await post(p.token, {
      kind: 'complaint', title: `sec4 forged owner ${Date.now()}`, detail: 'x',
      owner: 'Principal',          // the injection: route it to a named person
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().case.owner, 'Coordinator', 'owner is a staff triage decision');
  });

  test('a parent CANNOT self-declare critical severity — and no case is created', async () => {
    const p = await loginAs(app, 'parent@meridian.edu');
    const title = `sec4 fake critical ${Date.now()}`;
    const r = await post(p.token, { kind: 'complaint', title, detail: 'x', priority: 'critical' });
    assert.equal(r.statusCode, 403, 'critical is a triage decision, not a self-declaration');
    assert.equal(await caseCount(title), 0, 'the refused case must not exist — a rejected write must not be half-applied');
  });

  test('a parent CANNOT set an SLA long enough to never escalate', async () => {
    const p = await loginAs(app, 'parent@meridian.edu');
    const r = await post(p.token, { kind: 'complaint', title: `sec4 sla ${Date.now()}`, detail: 'x', slaHours: 5000 });
    assert.equal(r.statusCode, 400);
  });

  test('an invalid priority is a usable 400, not a raw constraint 500', async () => {
    const p = await loginAs(app, 'parent@meridian.edu');
    const r = await post(p.token, { kind: 'complaint', title: `sec4 bad prio ${Date.now()}`, detail: 'x', priority: 'URGENT' });
    assert.equal(r.statusCode, 400, 'the DB CHECK used to reject this as a 500');
  });

  test('staff KEEP the full vocabulary: critical, a chosen owner, and a long SLA', async () => {
    const c = await loginAs(app, 'principal@meridian.edu');
    const title = `sec4 staff case ${Date.now()}`;
    const r = await post(c.token, { kind: 'safeguarding', title, detail: 'x', priority: 'critical', owner: 'Vice Principal', slaHours: 1000 });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().case.priority, 'critical', 'staff triage must remain able to escalate severity');
    assert.equal(r.json().case.owner, 'Vice Principal', 'staff may assign an owner');
    assert.equal(r.json().case.origin, 'staff');
  });
});

describe('SEC-5: the whole-school fee ledger is staff-only', () => {
  test('a STUDENT is scoped to their own dues, never the whole school (FEE-PRD-9)', async () => {
    // The leak that mattered was a student receiving EVERY family's dues. A student is now structurally
    // scoped through app.student_accounts: with no link the view is honestly empty; with one it is only
    // their own student_id. The assertion is scoping, not a blanket 403.
    const s = await loginAs(app, 'student@meridian.edu');
    const r = await app.inject({ method: 'GET', url: '/fees/obligations', headers: H(s.token) });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().scoped, 'self');
    const own = r.json().obligations;
    assert.ok(own.every((o) => o.student_id === own[0]?.student_id), 'every row belongs to one student — no whole-school fan-out');
    const finance = await loginAs(app, 'finance@meridian.edu');
    const all = await app.inject({ method: 'GET', url: '/fees/obligations?status=open', headers: H(finance.token) });
    assert.ok(own.length < (all.json().obligations?.length ?? 0) || own.length === 0,
      'a student sees strictly less than the school ledger');
  });

  test('a TEACHER is also refused — financial data about children is not their mandate', async () => {
    const t = await loginAs(app, 'teacher@meridian.edu');
    const r = await app.inject({ method: 'GET', url: '/fees/obligations', headers: H(t.token) });
    assert.equal(r.statusCode, 403);
  });

  test('the gate is NOT vacuous: finance still reads the whole ledger', async () => {
    const f = await loginAs(app, 'finance@meridian.edu');
    const r = await app.inject({ method: 'GET', url: '/fees/obligations?status=open', headers: H(f.token) });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(r.json().obligations.length > 0, 'finance must still see the ledger — else the fix broke the product');
  });

  test('a parent is still scoped to their own children, not refused', async () => {
    const p = await loginAs(app, 'parent@meridian.edu');
    const r = await app.inject({ method: 'GET', url: '/fees/obligations', headers: H(p.token) });
    assert.equal(r.statusCode, 200, 'the parent branch is structurally scoped and must keep working');
    assert.equal(r.json().scoped, 'own_children');
  });
});
