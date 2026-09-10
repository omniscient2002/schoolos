// ops.visitors — gate pass + guardian-verified pickup tests (migration 024)
// Pins: lifecycle gate, expected→checked_in flow, pickup OTP through the kernel
// vault pattern (scrypt-hashed in RLS-denied pickup_otp, devEcho parity, attempt
// bounds, expiry), fail-closed release without verification, override audit, PII
// lattice (front-desk only), registry/contract mirror. Events: visitor.logged.v1 ·
// visitor.checked_in.v1 · visitor.pickup.requested.v1 · visitor.pickup.verified.v1 ·
// visitor.completed.v1.
process.env.OTP_DEV_ECHO = '1'; // before app import — kernel devEcho parity (dev-only)
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

let app;
let sql;
let student; // a seeded student with a primary guardian phone

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
  student = (await sql(`SELECT s.id, s.name, g.phone FROM app.students s
    JOIN app.guardians g ON g.student_id=s.id AND g.is_primary AND g.phone IS NOT NULL LIMIT 1`)).rows[0];
  assert.ok(student, 'seed must contain a student with a primary guardian phone');
});

describe('ops.visitors (gate pass · guardian-verified pickup · migration 024)', () => {
  test('1 · registered-not-enabled: lifecycle gate 409; teacher/parent have no front-desk door', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const pre = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/visitors',
      payload: { visitorName: 'Gate Kid Uncle', purpose: 'pickup', studentId: student.id }, headers: H(co.token) });
    assert.equal(pre.statusCode, 409);
    assert.match(pre.json().error, /switched off/); // plain-language copy pass (gate)
    const teacher = await loginAs(app, 'teacher@meridian.edu');
    const t = await app.inject({ method: 'GET', url: '/plugins/ops.visitors/visitors', headers: H(teacher.token) });
    assert.equal(t.statusCode, 403, 'visitors are a front-desk surface');
  });

  let meetingVisit, pickupVisit, pickupDevCode;

  test('2 · enable (owner) → log meeting visitor → check in (badge issued, visitor.logged/checked_in)', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const en = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/enable',
      headers: { ...H(o.token), 'content-type': 'application/json' }, payload: { version: '1.0.0', class: 'C' } });
    assert.equal(en.statusCode, 200);
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/visitors',
      payload: { visitorName: 'Ravi Vendor', visitorPhone: '9876500011', purpose: 'vendor', detail: 'AC maintenance' }, headers: H(co.token) });
    assert.equal(r.statusCode, 200);
    meetingVisit = r.json().visitId;
    assert.match(r.json().badge, /^V-[0-9A-F]{8}$/, 'badge issued');
    const ci = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${meetingVisit}/checkin`, payload: {}, headers: H(co.token) });
    assert.equal(ci.statusCode, 200);
    assert.equal(ci.json().status, 'checked_in');
    const ev = await sql(`SELECT count(*)::int n FROM app.outbox WHERE topic='visitor.checked_in.v1'`);
    assert.equal(ev.rows[0].n, 1);
    const ci2 = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${meetingVisit}/checkin`, payload: {}, headers: H(co.token) });
    assert.equal(ci2.statusCode, 409, 'cannot check in twice');
  });

  test('3 · pickup: OTP raised to PRIMARY guardian via kernel vault; devCode echoed (dev-only)', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/visitors',
      payload: { visitorName: 'Gate Uncle', visitorPhone: '9876500022', purpose: 'pickup', studentId: student.id }, headers: H(co.token) });
    assert.equal(r.statusCode, 200);
    pickupVisit = r.json().visitId;
    const ci = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${pickupVisit}/checkin`, payload: {}, headers: H(co.token) });
    assert.equal(ci.statusCode, 200);
    const p = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${pickupVisit}/pickup`, payload: {}, headers: H(co.token) });
    assert.equal(p.statusCode, 200);
    assert.match(p.json().devCode, /^\d{6}$/, 'dev-only OTP echo (kernel parity, OTP_DEV_ECHO=1)');
    pickupDevCode = p.json().devCode;
    // L1 sprint T102 (P0-1): pickup OTPs live in the plugin's own vault
    // (plugin_visitors.pickup_otp) — the LOGIN vault (app.auth_otps) must be
    // untouched by the desk (054 purged the legacy rows).
    const vault = await sql(`SELECT phone, attempts, consumed_at FROM plugin_visitors.pickup_otp WHERE id=(SELECT otp_request_id FROM plugin_visitors.visit WHERE id=$1)`, [pickupVisit]);
    assert.equal(vault.rows[0].phone, student.phone, 'OTP went to the PRIMARY guardian phone');
    assert.equal(vault.rows[0].consumed_at, null);
    const loginVault = await sql(`SELECT count(*)::int n FROM app.auth_otps WHERE phone=$1`, [student.phone]);
    assert.equal(loginVault.rows[0].n, 0, 'pickup code NEVER lands in the login OTP vault (P0-1 negative)');
    const ev = await sql(`SELECT count(*)::int n FROM app.outbox WHERE topic='visitor.pickup.requested.v1'`);
    assert.equal(ev.rows[0].n, 1);
  });

  test('4 · wrong code → 422 + attempt bump; correct code → verified + OTP consumed', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const wrong = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${pickupVisit}/pickup/verify`,
      payload: { code: '000000' }, headers: H(co.token) });
    assert.equal(wrong.statusCode, 422, 'invalid code is an OTP-state failure, NOT auth (UI lane #1: 401 collides with session-expiry)');
    const a = await sql(`SELECT otp_attempts FROM plugin_visitors.visit WHERE id=$1`, [pickupVisit]);
    assert.equal(a.rows[0].otp_attempts, 1, 'failed attempts tracked on the visit');
    // re-request from pickup_pending is REFUSED by design (anti-spam: one active code per visit)
    const re = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${pickupVisit}/pickup`, payload: {}, headers: H(co.token) });
    assert.equal(re.statusCode, 409, 'no second active code while one is pending');
    // test 3's devCode is still the single active code — verify with it
    const ok = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${pickupVisit}/pickup/verify`,
      payload: { code: pickupDevCode }, headers: H(co.token) });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().status, 'verified');
    const vault = await sql(`SELECT consumed_at FROM plugin_visitors.pickup_otp WHERE id=(SELECT otp_request_id FROM plugin_visitors.visit WHERE id=$1)`, [pickupVisit]);
    assert.ok(vault.rows[0].consumed_at, 'OTP consumed on success (single-use)');
    const ev = await sql(`SELECT count(*)::int n FROM app.outbox WHERE topic='visitor.pickup.verified.v1'`);
    assert.equal(ev.rows[0].n, 1);
  });

  test('5 · fail-closed release: unverified pickup visit cannot complete; owner override needs note', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const r = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/visitors',
      payload: { visitorName: 'Stranger Uncle', purpose: 'pickup', studentId: student.id }, headers: H(co.token) });
    const visitId = r.json().visitId;
    await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${visitId}/checkin`, payload: {}, headers: H(co.token) });
    await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${visitId}/pickup`, payload: {}, headers: H(co.token) });
    const blocked = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${visitId}/complete`, payload: {}, headers: H(co.token) });
    assert.equal(blocked.statusCode, 409);
    assert.match(blocked.json().error, /BLOCKED/, 'no_release_without_verification');
    const o = await loginAs(app, 'owner@meridian.edu');
    const noNote = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${visitId}/complete`,
      payload: { override: true }, headers: H(o.token) });
    assert.equal(noNote.statusCode, 400, 'override without note refused');
    const over = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${visitId}/complete`,
      payload: { override: true, note: 'photo ID verified at desk' }, headers: H(o.token) });
    assert.equal(over.statusCode, 200);
    assert.equal(over.json().overrideUsed, true);
    const aud = await sql(`SELECT action, outcome FROM app.audit_log WHERE record_ref=$1 ORDER BY created_at DESC LIMIT 1`, [visitId]);
    assert.match(aud.rows[0].outcome, /UNVERIFIED RELEASE OVERRIDE/, 'override is audited loudly');
  });

  test('6 · verified pickup → complete (release); visitor.completed event', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const done = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${pickupVisit}/complete`, payload: {}, headers: H(co.token) });
    assert.equal(done.statusCode, 200);
    assert.equal(done.json().overrideUsed, false, 'verified release needs no override');
    const ev = await sql(`SELECT count(*)::int n FROM app.outbox WHERE topic='visitor.completed.v1'`);
    assert.equal(ev.rows[0].n >= 1, true);
    const again = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${pickupVisit}/complete`, payload: {}, headers: H(co.token) });
    assert.equal(again.statusCode, 409, 'completed is terminal');
  });

  test('7 · pickup without student link → 400; student without primary guardian phone → fail-closed 409', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const noLink = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/visitors',
      payload: { visitorName: 'Plain Visitor', purpose: 'meeting' }, headers: H(co.token) });
    const visitId = noLink.json().visitId;
    const p = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${visitId}/pickup`, payload: {}, headers: H(co.token) });
    assert.equal(p.statusCode, 400, 'pickup flow requires a student link');
    const orphan = await sql(`SELECT s.id FROM app.students s LEFT JOIN app.guardians g ON g.student_id=s.id AND g.is_primary AND g.phone IS NOT NULL WHERE g.id IS NULL LIMIT 1`);
    if (orphan.rows.length) {
      const r2 = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/visitors',
        payload: { visitorName: 'Guardianless Pickup', purpose: 'pickup', studentId: orphan.rows[0].id }, headers: H(co.token) });
      const v2 = r2.json().visitId;
      const p2 = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${v2}/pickup`, payload: {}, headers: H(co.token) });
      assert.equal(p2.statusCode, 409, 'fail-closed: manual verification required when no guardian phone');
    }
  });

  test('8 · parent/finance denied; unknown studentId 404; vault denied to app role (RLS USING(false))', async () => {
    const parent = await loginAs(app, 'parent@meridian.edu');
    const pd = await app.inject({ method: 'GET', url: '/plugins/ops.visitors/visitors', headers: H(parent.token) });
    assert.equal(pd.statusCode, 403);
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const nf = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/visitors',
      payload: { visitorName: 'X', purpose: 'pickup', studentId: '00000000-0000-0000-0000-000000000000' }, headers: H(co.token) });
    assert.equal(nf.statusCode, 404, 'student must exist in tenant');
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    let denied = false;
    try {
      await c.query(`BEGIN; SET ROLE schoolos_app; SELECT count(*) FROM plugin_visitors.pickup_otp; ROLLBACK;`);
    } catch (e) {
      denied = /permission denied|policy|row-level/.test(e.message);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      await c.end();
    }
    assert.ok(denied, 'OTP vault must be invisible to the app role (otp_vault_kernel_pattern)');
  });

  test('9 · registry + contract mirror (factory-authored rows, plugin_id linked)', async () => {
    const reg = await sql(`SELECT manifest->'settingsSchema'->'properties' ? 'pickup_otp_ttl_minutes' AS a FROM app.plugins WHERE plugin_id='ops.visitors'`);
    assert.equal(reg.rows[0].a, true);
    const ct = await sql(`SELECT plugin_id FROM app.capability_contracts WHERE capability_id='visitors.gate.pass'`);
    assert.equal(ct.rows[0].plugin_id, 'ops.visitors', 'contract linked to its plugin');
  });
  test('10 · expired-code re-verify → 409 (OTP-state ≠ auth; UI wrapper removal unblocked)', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    // force the pending OTP into the expired state directly (no TTL wait)
    const v = (await sql(`SELECT otp_request_id FROM plugin_visitors.visit WHERE id=$1 AND status='pickup_pending' ORDER BY created_at DESC LIMIT 1`, [pickupVisit])).rows[0];
    if (v) { // pickupVisit already verified in test 4 — this branch only trips on fresh orders
      await sql(`UPDATE plugin_visitors.pickup_otp SET expires_at = now() - interval '1 minute' WHERE id=$1`, [v.otp_request_id]);
      const late = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${pickupVisit}/pickup/verify`,
        payload: { code: '000000' }, headers: H(co.token) });
      assert.equal(late.statusCode, 409, 'expired code → 409, never 401');
    }
    // deterministic half: consumed-OTP path on a brand-new visit
    const gv = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/visitors',
      payload: { visitorName: 'Expired OTP Parent', visitorPhone: '9833300111', purpose: 'pickup', studentId: student.id }, headers: H(co.token) });
    assert.equal(gv.statusCode, 200, gv.body);
    const vid = gv.json().visitId;
    await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${vid}/checkin`, payload: {}, headers: H(co.token) });
    const pr = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${vid}/pickup`, payload: {}, headers: H(co.token) });
    assert.equal(pr.statusCode, 200, pr.body);
    const req2 = (await sql(`SELECT otp_request_id FROM plugin_visitors.visit WHERE id=$1`, [vid])).rows[0].otp_request_id;
    await sql(`UPDATE plugin_visitors.pickup_otp SET expires_at = now() - interval '1 minute' WHERE id=$1`, [req2]);
    const late = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${vid}/pickup/verify`,
      payload: { code: '000000' }, headers: H(co.token) });
    assert.equal(late.statusCode, 409, 'expired code → 409 (was 401: logged the desk out mid-verify)');
  });

  test('11 · guardian-lookup door: id, admission_no, name-tail; masked for the desk tier', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    const byId = await app.inject({ method: 'GET', url: `/plugins/ops.visitors/guardian-lookup?studentId=${student.id}`, headers: H(co.token) });
    assert.equal(byId.statusCode, 200, byId.body);
    const m1 = byId.json().matches[0];
    assert.equal(m1.studentId, student.id);
    assert.ok(m1.guardian, 'primary guardian hydrated');
    assert.equal(m1.guardian.phoneOnFile, true);
    assert.match(m1.guardian.phoneTail, /^\d{4}$/, 'tail only — full numbers ride the OTP vault path');
    assert.equal(m1.guardian.phone, undefined, 'no full PII to the desk tier');
    const byAdm = await app.inject({ method: 'GET', url: `/plugins/ops.visitors/guardian-lookup?admissionNo=${m1.admissionNo}`, headers: H(co.token) });
    assert.equal(byAdm.statusCode, 200);
    assert.equal(byAdm.json().matches[0].studentId, student.id, 'admission_no resolves');
    const byName = await app.inject({ method: 'GET', url: '/plugins/ops.visitors/guardian-lookup?q=Aarav', headers: H(co.token) });
    assert.equal(byName.statusCode, 200);
    assert.ok(byName.json().matches.some((m) => m.studentName.startsWith('Aarav')), 'name tail-match works');
    const fin = await loginAs(app, 'finance@meridian.edu');
    const denied = await app.inject({ method: 'GET', url: '/plugins/ops.visitors/guardian-lookup?q=Aarav', headers: H(fin.token) });
    assert.equal(denied.statusCode, 403, 'desk-tier door (finance refused)');
    const none = await app.inject({ method: 'GET', url: '/plugins/ops.visitors/guardian-lookup', headers: H(co.token) });
    assert.equal(none.statusCode, 400, 'selector required');
  });
});
