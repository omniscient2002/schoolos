// Master Action Plan 4.5 — safety-audit checklist (NCPCR-mapped) + police
// verification tracker with duty-roster blocking.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;
let owner, coordinator, teacher, counselor, parent;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  coordinator = await loginAs(app, 'coordinator@meridian.edu');
  teacher = await loginAs(app, 'teacher@meridian.edu');
  parent = await loginAs(app, 'parent@meridian.edu');
  try { counselor = await loginAs(app, 'counselor@meridian.edu'); } catch { counselor = null; }
  // the roster door lives behind the hr.leave lifecycle gate — switch the module on
  await app.inject({ method: 'POST', url: '/plugins/hr.leave/enable', headers: H(owner.token), payload: {} });
});

after(async () => { await app?.close(); });

// ── checklist ─────────────────────────────────────────────────────────────
test('safety: checklist is born seeded and idempotent; attest flips with audit', async () => {
  const first = await app.inject({ method: 'GET', url: '/safety/checklist', headers: H(owner.token) });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().checks.length, 12, 'the NCPCR wall ships with the school');
  assert.equal(first.json().score.total, 12);
  assert.equal(first.json().score.done, 0);
  const again = await app.inject({ method: 'GET', url: '/safety/checklist', headers: H(owner.token) });
  assert.equal(again.json().checks.length, 12, 're-reads seed nothing twice');
  const item = first.json().checks[0];
  const bad = await app.inject({ method: 'POST', url: `/safety/checks/${item.id}/attest`, headers: H(owner.token), payload: { done: 'yes' } });
  assert.equal(bad.statusCode, 400, bad.body);
  const attest = await app.inject({ method: 'POST', url: `/safety/checks/${item.id}/attest`, headers: H(owner.token),
    payload: { done: true, evidence: 'Committee list displayed at the gate, photo on file.' } });
  assert.equal(attest.statusCode, 200, attest.body);
  assert.equal(attest.json().check.status, 'done');
  assert.equal(attest.json().score.done, 1);
  const reopen = await app.inject({ method: 'POST', url: `/safety/checks/${item.id}/attest`, headers: H(owner.token), payload: { done: false } });
  assert.equal(reopen.json().check.status, 'open', 'attestations are history, not deletions — reopening is allowed');
  const ghost = await app.inject({ method: 'POST', url: '/safety/checks/00000000-0000-0000-0000-000000000000/attest', headers: H(owner.token), payload: { done: true } });
  assert.equal(ghost.statusCode, 404, ghost.body);
  const coordNo = await app.inject({ method: 'POST', url: `/safety/checks/${item.id}/attest`, headers: H(coordinator.token), payload: { done: true } });
  assert.equal(coordNo.statusCode, 403, 'coordinators read the wall; only the office attests');
  const parentNo = await app.inject({ method: 'GET', url: '/safety/checklist', headers: H(parent.token) });
  assert.equal(parentNo.statusCode, 403, 'the audit wall is the staff desk, not the family portal');
});

// ── verification ledger ───────────────────────────────────────────────────
test('verifications: record with expiry math; junk refused; non-staff refused', async () => {
  const who = (await pool.query(`SELECT id FROM app.users WHERE role='teacher' AND active LIMIT 1`)).rows[0];
  const badDate = await app.inject({ method: 'POST', url: '/staff-verifications', headers: H(owner.token), payload: { userId: who.id, verifiedOn: 'yesterday' } });
  assert.equal(badDate.statusCode, 400, badDate.body);
  const badYears = await app.inject({ method: 'POST', url: '/staff-verifications', headers: H(owner.token), payload: { userId: who.id, verifiedOn: '2026-01-15', validYears: 99 } });
  assert.equal(badYears.statusCode, 400, badYears.body);
  const ok = await app.inject({ method: 'POST', url: '/staff-verifications', headers: H(owner.token),
    payload: { userId: who.id, verifiedOn: '2026-01-15', validYears: 3, note: 'District police clearance' } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().verification.expires_on, '2029-01-15', '3-year validity is date arithmetic, not a guess');
  const ledger = await app.inject({ method: 'GET', url: '/staff-verifications', headers: H(coordinator.token) });
  assert.equal(ledger.statusCode, 200, ledger.body);
  const row = ledger.json().staff.find((s) => s.userId === who.id);
  assert.ok(row, 'recorded staff appear on the ledger');
  assert.equal(row.state, 'valid');
  const pupil = (await pool.query(`SELECT id FROM app.students WHERE status='active' LIMIT 1`)).rows[0];
  const prov = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.token),
    payload: { name: 'Safety Pupil Portal', email: 'safety.pupil@meridian.edu', role: 'student', password: 'Safety-Pupil-1', studentId: pupil.id } });
  assert.equal(prov.statusCode, 200, prov.body);
  const portalUser = prov.json().user.id;
  const pupilNo = await app.inject({ method: 'POST', url: '/staff-verifications', headers: H(owner.token),
    payload: { userId: portalUser, verifiedOn: '2026-01-15' } });
  assert.equal(pupilNo.statusCode, 404, 'pupil portal accounts are never verified here');
  const teacherNo = await app.inject({ method: 'POST', url: '/staff-verifications', headers: H(teacher.token),
    payload: { userId: who.id, verifiedOn: '2026-01-15' } });
  assert.equal(teacherNo.statusCode, 403, 'recording is the owner/principal/IT admin desk');
});

// ── roster blocking ───────────────────────────────────────────────────────
test('roster: expired verification blocks; missing only warns; re-verify unblocks', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const who = (await pool.query(`SELECT id, name FROM app.users WHERE role='teacher' AND active LIMIT 1`)).rows[0];
  // expire them: verified 5 years ago with 1-year validity
  const rec = await app.inject({ method: 'POST', url: '/staff-verifications', headers: H(owner.token),
    payload: { userId: who.id, verifiedOn: '2020-06-01', validYears: 1 } });
  assert.equal(rec.statusCode, 200, rec.body);
  const roster = await app.inject({ method: 'GET', url: `/plugins/hr.leave/roster/${day}`, headers: H(coordinator.token) });
  assert.equal(roster.statusCode, 200, roster.body);
  const blocked = roster.json().blocked.find((b) => b.staffId === who.id);
  assert.ok(blocked, 'expired staff are named in blocked, not silently dropped');
  assert.match(blocked.reason, /re-verify/, 'the block names the remedy');
  const stillListed = [...roster.json().absent, ...roster.json().onDuty].find((r) => r.staffId === who.id);
  assert.ok(stillListed, 'blocked staff stay visible on the roster with their state');
  assert.equal(stillListed.verification, 'expired');
  // everyone else without a record warns, never blocks
  for (const b of roster.json().blocked) assert.notEqual(b.state, 'missing', 'missing warns; only expired blocks');
  // re-verify → unblocked
  const fresh = await app.inject({ method: 'POST', url: '/staff-verifications', headers: H(owner.token),
    payload: { userId: who.id, verifiedOn: day, validYears: 3 } });
  assert.equal(fresh.statusCode, 200, fresh.body);
  const again = await app.inject({ method: 'GET', url: `/plugins/hr.leave/roster/${day}`, headers: H(coordinator.token) });
  assert.ok(!again.json().blocked.find((b) => b.staffId === who.id), 're-verified staff leave the blocked list');
});
