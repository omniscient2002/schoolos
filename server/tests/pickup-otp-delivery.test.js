// PRD-13 · the pickup OTP: minted, vaulted — and, before this, sent to nobody.
//
// THE DEFECT, verified in the code. `ops.visitors` minted the pickup code with the kernel OTP pattern
// (CSPRNG → scrypt+salt → `plugin_visitors.pickup_otp`, a table whose RLS denies the app role) and then
// handed it to no one: no rail call, no `app.communications` row, not even a queue entry. The emitted
// event nevertheless read "pickup requested — OTP sent to primary guardian" and the audit row read
// "OTP issued to primary guardian", so the front desk believed a code was on its way while the
// guardian had nothing to read out. Release is fail-closed, so the practical effect was that every
// pickup silently degraded to the photo-ID override WHILE THE RECORD CLAIMED THE IDENTITY CHECK HAD
// HAPPENED — the worst possible place in a school product for the ledger to lie.
//
// WHAT IS PINNED HERE, and why each assertion could fail:
//   1. A code really reaches a carrier (a comms row addressed to the GUARDIAN's phone exists).
//   2. The raw code never enters the ledger (SEC-0): `app.communications` is served with SELECT * to
//      six roles, so the door sends directly and records a redacted body. The code IS in the SMS body,
//      so this assertion has something to catch — it is not vacuous.
//   3. `delivered_at` is never stamped for a sandbox carrier, while `sent_at` is (PRD-13).
//   4. The event and audit name the carrier that was actually used, and a sandbox send is labelled as
//      one — instead of the old blanket claim that a guardian had been sent a code.
//   5. A failed delivery is compensated: the vault row is withdrawn, the visit returns to its previous
//      state, and the door fails loudly. A live OTP nobody holds is worse than none, because it leaves
//      `otp_request_id` dangling and makes /pickup/verify answer "No pickup code is active for this
//      visit" at a desk that was just told to expect one. This path is exercised for REAL (a rail
//      misconfiguration), not by stubbing, and it needs no NODE_ENV manipulation.
/* The file models a DEVELOPER MACHINE, and must say so before the app is imported (app/config are imported
   dynamically in before(), so these assignments win). NODE_ENV is set alongside the flag because `config.js`
   arms the OTP dev echo only when env === 'development' — deliberately, and T101 in l1-security-sprint pins
   that staging/test never arm it. CI runs the suite with NODE_ENV=test, where a code must come from a
   configured channel; without this line the pickup tests below assert against an undefined code and CI is red.
   This is the file declaring the posture it is testing, not a change to the posture. */
process.env.NODE_ENV = 'development';
process.env.OTP_DEV_ECHO = '1'; // before app import — kernel devEcho parity (dev-only)
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';
import { toE164 } from '../src/plugins/_shared/phone.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
let app;
let sql;
let tenantId;
let student;

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
  tenantId = (await sql(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  student = (await sql(`SELECT s.id, g.phone FROM app.students s
    JOIN app.guardians g ON g.student_id=s.id AND g.is_primary AND g.phone IS NOT NULL LIMIT 1`)).rows[0];
  assert.ok(student, 'seed must contain a student with a primary guardian phone');
  const o = await loginAs(app, 'owner@meridian.edu');
  const en = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/enable',
    headers: H(o.token), payload: { version: '1.0.0', class: 'C' } });
  assert.equal(en.statusCode, 200, en.body);
  // the sandbox SMS rail, exactly as the rails tests configure one
  await setRail('{"provider":"logger"}');
});

const setRail = (json) => sql(
  `INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, settings)
   VALUES ($1,'rails.sms','1.0.0','B','enabled',$2::jsonb)
   ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET settings=$2::jsonb`, [tenantId, json]);

const liveCodes = async () => Number((await sql(
  `SELECT count(*)::int n FROM plugin_visitors.pickup_otp WHERE consumed_at IS NULL`)).rows[0].n);

// log a visitor who is here to collect a student, and check them in
async function checkedInPickupVisit(name) {
  const co = await loginAs(app, 'coordinator@meridian.edu');
  const r = await app.inject({ method: 'POST', url: '/plugins/ops.visitors/visitors',
    payload: { visitorName: name, visitorPhone: '9876500099', purpose: 'pickup', studentId: student.id }, headers: H(co.token) });
  assert.equal(r.statusCode, 200, r.body);
  const id = r.json().visitId;
  const ci = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${id}/checkin`, payload: {}, headers: H(co.token) });
  assert.equal(ci.statusCode, 200, ci.body);
  return { id, co };
}

describe('PRD-13 · pickup OTP is actually delivered', () => {
  let visitId;
  let code;

  test('the code reaches a carrier, addressed to the guardian — evidence row written', async () => {
    const v = await checkedInPickupVisit('Gate Uncle');
    visitId = v.id;
    const p = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${visitId}/pickup`, payload: {}, headers: H(v.co.token) });
    assert.equal(p.statusCode, 200, p.body);
    code = p.json().devCode;
    assert.match(code, /^\d{6}$/, 'dev-only echo (OTP_DEV_ECHO=1) gives the test the live code');
    assert.equal(p.json().deliveredVia, 'logger', 'the response names the carrier that was used');

    const ev = (await sql(
      `SELECT channel, template, audience_json, body, status, provider, sent_at, delivered_at, dedup_key
         FROM app.communications WHERE template='PICKUP_OTP' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    // THE REGRESSION GATE: before the fix there was no such row on any code path, so this fails loudly.
    assert.ok(ev, 'a delivered code leaves delivery EVIDENCE — there was none before this fix');
    assert.equal(ev.channel, 'sms');
    // The stored number is `+91 9720000243` — what the school office typed, and NOT valid E.164, so the
    // rail refuses it outright. The door must normalise; asserting against the raw stored value would
    // pin the broken form, so this compares to the normalised one AND proves normalisation happened.
    assert.notEqual(student.phone, toE164(student.phone),
      'fixture sanity: the seeded phone is stored in a form the rail would refuse (spaced)');
    assert.deepEqual(ev.audience_json, [toE164(student.phone)], 'addressed to the guardian in sendable E.164 form');
    assert.equal(ev.status, 'sent', 'handed to the named (sandbox) carrier — sandbox semantics, unchanged');
    assert.equal(ev.provider, 'logger', 'and the sandbox carrier is named honestly');
    assert.equal(ev.dedup_key, `pickup:${(await sql(`SELECT otp_request_id FROM plugin_visitors.visit WHERE id=$1`, [visitId])).rows[0].otp_request_id}`,
      'dedup identity is the vault row, so a retry cannot double-send the same code');
  });

  test('the raw code never lands in the ledger (SEC-0), and delivery is not overclaimed', async () => {
    const ev = (await sql(
      `SELECT body, sent_at, delivered_at FROM app.communications WHERE template='PICKUP_OTP' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    // Non-vacuous: the same code IS in the SMS body sent to the carrier, so a door that recorded the
    // message verbatim would fail this. app.communications is readable by six roles with SELECT *.
    assert.ok(!ev.body.includes(code),
      'the live single-use code must never persist in a table six roles can read (SEC-0)');
    assert.match(ev.body, /redacted — the ledger is evidence, not the channel/);
    assert.ok(ev.sent_at, 'sent_at = handed to the named provider');
    // PRD-13: a `logger` carrier wrote a log line and nothing else. It cannot confirm delivery, and
    // `delivered` is a stronger claim than `sent` (the schema keeps them apart; the dispatcher only
    // ever sets sent_at). Stamping delivered_at here is the exact lie this round removed elsewhere.
    assert.equal(ev.delivered_at, null, 'a sandbox carrier must not be recorded as having confirmed delivery');
  });

  test('the event and the audit name the carrier, and label a sandbox send as one', async () => {
    // The human-readable claim lives in app.events.label, NOT in the outbox payload: emitEvent only
    // folds the label into the payload when the caller passes none, and this door passes one (so the
    // relay and webhook consumers see {visitId, studentRef}). Reading the label from the outbox would
    // have been an assertion that could never fail — the same vacuity trap as the SEC-0 test.
    const ev = (await sql(
      `SELECT label FROM app.events WHERE type='visitors' AND label LIKE '%pickup requested%' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    assert.ok(ev, 'the pickup request still emits its event');
    const label = String(ev.label ?? '');
    assert.match(label, /via logger/, 'the event names the carrier that was actually used');
    assert.match(label, /sandbox — no carrier configured/,
      'and says plainly that no carrier was configured, rather than implying a guardian was reached');
    assert.ok(!/OTP sent to primary guardian/.test(label),
      'the old blanket claim — a code "sent" to a guardian with no carrier in existence — must be gone');
    // the relay-facing payload contract is untouched, so downstream consumers are unaffected
    const ob = (await sql(
      `SELECT payload FROM app.outbox WHERE topic='visitor.pickup.requested.v1' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    assert.deepEqual(Object.keys(ob.payload).sort(), ['studentRef', 'visitId'],
      'the outbox payload contract is unchanged — only the human-readable claim was corrected');

    const au = (await sql(
      `SELECT outcome FROM app.audit_log WHERE action='pickup OTP raised' ORDER BY created_at DESC, ctid DESC LIMIT 1`)).rows[0];
    assert.ok(au, 'the raise is still audited');
    assert.match(au.outcome, /handed to the SMS carrier "logger"/, 'the audit states the hand-off, not just issuance');
    assert.match(au.outcome, /\[SANDBOX:/, 'and flags that nothing left the building');
  });

  test('a delivery that FAILS is compensated: vault withdrawn, visit reverted, door fails loudly', async () => {
    // A real, deterministic carrier failure with no network and no NODE_ENV games: http-generic refuses
    // to send without an https url, so the rail returns { ok: false } and the door must not pretend.
    await setRail('{"provider":"http-generic"}');
    const before = await liveCodes();
    const v = await checkedInPickupVisit('Gate Aunt');
    const p = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${v.id}/pickup`, payload: {}, headers: H(v.co.token) });

    assert.equal(p.statusCode, 503, `an undelivered code must fail loudly, got ${p.statusCode}: ${p.body}`);
    assert.match(p.json().error, /could not be sent to the guardian/);
    assert.match(p.json().error, /photo ID at the desk/, 'and points at the path that is actually left');

    const visit = (await sql(`SELECT status, otp_request_id FROM plugin_visitors.visit WHERE id=$1`, [v.id])).rows[0];
    assert.equal(visit.status, 'checked_in', 'the visit must NOT be left in pickup_pending');
    assert.equal(visit.otp_request_id, null, 'and must not point at a code that no longer exists');
    assert.equal(await liveCodes(), before,
      'the vault row is withdrawn — a live code nobody holds is worse than none');

    const ev = (await sql(
      `SELECT status, sent_at, delivered_at, last_error, provider FROM app.communications WHERE dedup_key LIKE 'pickup:%:failed' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    assert.ok(ev, 'the failed attempt is still recorded as evidence');
    assert.equal(ev.status, 'failed');
    assert.equal(ev.sent_at, null, 'nothing was sent, so nothing is timestamped as sent');
    assert.equal(ev.delivered_at, null);
    assert.match(ev.last_error, /https url/, 'the ledger carries the real provider reason, not a shrug');

    const au = (await sql(
      `SELECT outcome FROM app.audit_log WHERE action='pickup OTP delivery failed' ORDER BY created_at DESC, ctid DESC LIMIT 1`)).rows[0];
    assert.ok(au, 'a failed delivery is auditable — it explains why the desk fell back to photo ID');
    assert.match(au.outcome, /vault row withdrawn and visit returned to "checked_in"/);

    await setRail('{"provider":"logger"}'); // restore for anything that follows
  });

  test('an UNUSABLE guardian number is refused BEFORE anything is minted', async () => {
    // Found by independent review of the first version of this fix: it normalised the number AFTER the
    // vault write and the `pickup_pending` flip, and on the refusal the handler returns a reply rather
    // than throwing — so `withUser` COMMITS. That left the visit `pickup_pending` with a live
    // `otp_request_id` and an unconsumed vault row: the exact dangling state the undeliverable branch
    // exists to prevent, reached through a different door. A refusal that happens BEFORE anything is
    // written cannot leave anything behind, which is why the ordering is asserted and not just the code.
    const before = await liveCodes();
    const v = await checkedInPickupVisit('Gate Granduncle');
    await sql(`UPDATE app.guardians SET phone='123' WHERE student_id=$1 AND is_primary`, [student.id]);
    try {
      const p = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${v.id}/pickup`, payload: {}, headers: H(v.co.token) });
      assert.equal(p.statusCode, 409, p.body);
      assert.match(p.json().error, /not a usable mobile number/);
      assert.match(p.json().error, /photo ID at the desk/, 'and points at the path that is actually left');

      const visit = (await sql(`SELECT status, otp_request_id FROM plugin_visitors.visit WHERE id=$1`, [v.id])).rows[0];
      assert.equal(visit.status, 'checked_in', 'the visit must not be left at pickup_pending');
      assert.equal(visit.otp_request_id, null, 'and must not reference a code that was never sent');
      assert.equal(await liveCodes(), before, 'no vault row may survive a refusal');
    } finally {
      await sql(`UPDATE app.guardians SET phone=$2 WHERE student_id=$1 AND is_primary`, [student.id, student.phone]);
    }
  });

  test('the code still works end to end once a carrier exists — the fix did not break pickup', async () => {
    const v = await checkedInPickupVisit('Gate Nephew');
    const p = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${v.id}/pickup`, payload: {}, headers: H(v.co.token) });
    assert.equal(p.statusCode, 200, p.body);
    const ver = await app.inject({ method: 'POST', url: `/plugins/ops.visitors/visitors/${v.id}/pickup/verify`,
      payload: { code: p.json().devCode }, headers: H(v.co.token) });
    assert.equal(ver.statusCode, 200, ver.body);
    assert.equal(ver.json().status, 'verified', 'the guardian-verified release path is intact');
  });
});
