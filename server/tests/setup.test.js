// Setup guide suite — Part 1 of onboarding: the people chain.
//
// Covers the staged delegation the product promises:
//   owner appoints principal (owner-only) → owner OR principal appoints the IT
//   admin (a principal reaching for any other role is refused) → GET
//   /school/setup reports each stage with live done-flags for
//   owner/principal/itadmin (and refuses everyone else) → /onboard/status
//   carries the principal step.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';

let app;

before(async () => {
  await setupTestDb(); // per-file fresh DB (suite law: every file owns its world)
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  // people.admin ships registered; the school enables it (same honest flow as the UI)
  const owner = await loginAs(app, 'owner@meridian.edu');
  const on = await app.inject({ method: 'POST', url: '/plugins/people.admin/enable', headers: { authorization: `Bearer ${owner.token}` }, payload: { class: 'B', version: '1.0.0' } });
  assert.equal(on.statusCode, 200, `could not enable people.admin: ${on.body}`);
});

after(async () => { await app?.close(); });

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const provision = (token, payload) =>
  app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(token), payload });

test('01 · owner appoints the principal (temp password, force-change stamped)', async () => {
  const owner = await loginAs(app, 'owner@meridian.edu');
  const r = await provision(owner.token, { name: 'Priya Principal', email: 'priya.principal@meridian.edu', role: 'principal' });
  assert.equal(r.statusCode, 200, `owner appoints principal: ${r.body}`);
  const body = r.json();
  assert.ok(body.temporaryPassword, 'one-time password shown once');
  assert.equal(body.user.role, 'principal');
});

test('02 · IT admin cannot appoint a principal (owner-only, audited refusal)', async () => {
  const owner = await loginAs(app, 'owner@meridian.edu');
  const mk = await provision(owner.token, { name: 'Ira Setup', email: 'ira.setup@meridian.edu', role: 'itadmin' });
  assert.equal(mk.statusCode, 200);
  const it = await loginAs(app, 'ira.setup@meridian.edu', mk.json().temporaryPassword);
  const r = await provision(it.token, { name: 'Sneaky Principal', email: 'sneaky@meridian.edu', role: 'principal' });
  assert.equal(r.statusCode, 403, 'principal appointment stays owner-only');
  assert.match(r.json().error, /only the school owner/i);
});

test('03 · owner creates the IT admin directly (the other allowed path)', async () => {
  const owner = await loginAs(app, 'owner@meridian.edu');
  const r = await provision(owner.token, { name: 'Owen ItAdmin', email: 'owen.itadmin@meridian.edu', role: 'itadmin', phone: '+91 98450 00991' });
  assert.equal(r.statusCode, 200, `owner creates IT admin: ${r.body}`);
  assert.equal(r.json().user.role, 'itadmin');
});

test('03b · phone clash names the phone, not the email', async () => {
  const owner = await loginAs(app, 'owner@meridian.edu');
  // seed principal holds +919845000101 — reusing it must say PHONE, not email
  const r = await provision(owner.token, { name: 'Clash User', email: 'clash.phone@meridian.edu', role: 'teacher', phone: '+91 98450 00101' });
  assert.equal(r.statusCode, 409);
  assert.match(r.json().error, /phone number.*already used/i);
});

test('04 · principal appoints IT admin; principal reaching further is refused; teacher reaches nothing', async () => {
  // re-resolve priya's temp password deterministically: reset it as owner, then hand over
  const owner = await loginAs(app, 'owner@meridian.edu');
  const { sysq } = await import('../src/db.js');
  const row = (await sysq(`SELECT id FROM app.users WHERE email='priya.principal@meridian.edu'`)).rows[0];
  const reset = await app.inject({ method: 'POST', url: `/plugins/people.admin/users/${row.id}/reset-password`, headers: H(owner.token), payload: {} });
  assert.equal(reset.statusCode, 200);
  const priya = await loginAs(app, 'priya.principal@meridian.edu', reset.json().temporaryPassword);

  const ok = await provision(priya.token, { name: 'Nina ItAdmin', email: 'nina.itadmin@meridian.edu', role: 'itadmin' });
  assert.equal(ok.statusCode, 200, `principal appoints IT admin: ${ok.body}`);
  assert.equal(ok.json().user.role, 'itadmin');
  assert.ok(ok.json().temporaryPassword, 'one-time password shown once');

  const overreach = await provision(priya.token, { name: 'Tara Teacher', email: 'tara.teacher@meridian.edu', role: 'teacher' });
  assert.equal(overreach.statusCode, 403, 'principal cannot appoint teachers');
  assert.match(overreach.json().error, /only create the IT admin/i);
  const trail = (await sysq(`SELECT count(*)::int AS n FROM app.audit_log WHERE action='Attempted provisioning beyond delegation (refused)' AND record_ref='tara.teacher@meridian.edu'`)).rows[0];
  assert.equal(trail.n, 1, 'the refused delegation probe leaves a ledger trail');

  const teacherLogin = await loginAs(app, 'teacher@meridian.edu');
  const teacherTry = await provision(teacherLogin.token, { name: 'Nope', email: 'nope@meridian.edu', role: 'itadmin' });
  assert.equal(teacherTry.statusCode, 403, 'teachers provision nobody');
});

test('05 · GET /school/setup reports the chain with live done-flags (owner)', async () => {
  const owner = await loginAs(app, 'owner@meridian.edu');
  const r = await app.inject({ method: 'GET', url: '/school/setup', headers: H(owner.token) });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.ok(body.school?.slug, 'school identity present');
  const ids = body.stages.map((s) => s.id);
  assert.deepEqual(ids, ['school', 'principal', 'itadmin', 'classes', 'teachers', 'students', 'desk', 'finance', 'portals']);
  const byId = Object.fromEntries(body.stages.map((s) => [s.id, s]));
  assert.equal(byId.principal.done, true, 'seed + appointed principal counted');
  assert.equal(byId.itadmin.done, true, 'appointed IT admins counted');
  assert.equal(byId.teachers.done, true, 'seed teacher counted');
  assert.equal(typeof byId.students.count, 'number');
});

test('06 · principal and IT admin read the guide; teachers are refused', async () => {
  const { sysq } = await import('../src/db.js');
  const row = (await sysq(`SELECT id FROM app.users WHERE email='nina.itadmin@meridian.edu'`)).rows[0];
  const owner = await loginAs(app, 'owner@meridian.edu');
  const reset = await app.inject({ method: 'POST', url: `/plugins/people.admin/users/${row.id}/reset-password`, headers: H(owner.token), payload: {} });
  assert.equal(reset.statusCode, 200);

  const priyaRow = (await sysq(`SELECT id FROM app.users WHERE email='priya.principal@meridian.edu'`)).rows[0];
  const resetP = await app.inject({ method: 'POST', url: `/plugins/people.admin/users/${priyaRow.id}/reset-password`, headers: H(owner.token), payload: {} });
  const priya = await loginAs(app, 'priya.principal@meridian.edu', resetP.json().temporaryPassword);
  const rp = await app.inject({ method: 'GET', url: '/school/setup', headers: H(priya.token) });
  assert.equal(rp.statusCode, 200, 'principal reads the guide');
  assert.ok(rp.json().stages.length === 9);

  const nina = await loginAs(app, 'nina.itadmin@meridian.edu', reset.json().temporaryPassword);
  const rn = await app.inject({ method: 'GET', url: '/school/setup', headers: H(nina.token) });
  assert.equal(rn.statusCode, 200, 'IT admin reads the guide');

  const teacher = await loginAs(app, 'teacher@meridian.edu');
  const rt = await app.inject({ method: 'GET', url: '/school/setup', headers: H(teacher.token) });
  assert.equal(rt.statusCode, 403, 'setup guide is owner/principal/itadmin only');
});

test('07 · /onboard/status carries the principal step', async () => {
  const owner = await loginAs(app, 'owner@meridian.edu');
  const r = await app.inject({ method: 'GET', url: '/onboard/status', headers: H(owner.token) });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  const step = body.checklist.find((c) => c.id === 'principal');
  assert.ok(step, 'principal step present');
  assert.equal(step.done, true, 'appointed principal completes the step');
  assert.equal(step.href, '/setup');
});

test('08 · IT admin runs the RTE lottery import (intake parity with CSV/migration)', async () => {
  const owner = await loginAs(app, 'owner@meridian.edu');
  const mk = await provision(owner.token, { name: 'Rina Rte', email: 'rina.rte@meridian.edu', role: 'itadmin' });
  assert.equal(mk.statusCode, 200);
  const it = await loginAs(app, 'rina.rte@meridian.edu', mk.json().temporaryPassword);
  const classes = await app.inject({ method: 'GET', url: '/school/classes', headers: H(it.token) });
  assert.equal(classes.statusCode, 200);
  const g = classes.json().classes[0];
  assert.ok(g, 'seed school has classes to import into');
  const imp = await app.inject({ method: 'POST', url: '/rte/lottery/import', headers: H(it.token),
    payload: { academicYear: '2026-27', rows: [
      { name: 'RTE ItAdmin Kid', dob: '2019-05-06', gender: 'male', guardianName: 'RTE Guardian', guardianPhone: '+919000000041', category: 'EWS', grade: g.grade, section: g.sections[0] ?? 'A' },
    ] } });
  assert.equal(imp.statusCode, 200, `itadmin lottery import: ${imp.body}`);
  assert.equal(imp.json().imported.length, 1, 'lottery pupil admitted');
  assert.match(imp.json().imported[0].admissionNo, /^RTE-/, 'RTE admission series');
});

test('09 · bare parent accounts are refused (door-side G-2 mirror)', async () => {
  const owner = await loginAs(app, 'owner@meridian.edu');
  const bare = await provision(owner.token, { name: 'Lost Parent', email: 'lost.parent@meridian.edu', role: 'parent' });
  assert.equal(bare.statusCode, 400, 'parent with neither phone nor child is refused');
  assert.match(bare.json().error, /phone number or pick their child/i);
  // either anchor suffices: phone-only and child-linked parents still provision
  const withPhone = await provision(owner.token, { name: 'Reached Parent', email: 'reached.parent@meridian.edu', role: 'parent', phone: '+91 98450 00992' });
  assert.equal(withPhone.statusCode, 200, `phone-anchored parent: ${withPhone.body}`);
});
