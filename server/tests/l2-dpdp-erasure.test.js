// L2-3.5 (Wave 3) — DPDP erasure completion (queue-scoped surfaces).
// Pins: guardians redaction with the keyed surrogate (format-insensitive match —
// spaced phone formats still die), comms recipient hashing, webhook payload scrub,
// OTP vaults purged, SAR trail surrogated (no raw phone anywhere post-erasure),
// journal idempotence with NO PII stored, consent/lead pins from dpdp.test intact.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const PHONE_DIGITS = '9844400444';

let app;
let sql;

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
  // erasure runs through pack.dpdp's lifecycle-gated door — enable the plugin
  const t = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  await sql(`UPDATE app.plugins SET status='enabled' WHERE tenant_id=$1 AND plugin_id='pack.dpdp'`, [t]);
});

const plantSubject = async () => {
  const t = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0];
  // spaced format on purpose — matching must be digit-normalized
  const s = await sql(`INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone)
    VALUES ($1,'ERASE-001','Erasure Kid','7','A','G. Parent','+91 98444 00444') RETURNING id`, [t.id]);
  const g = await sql(`INSERT INTO app.guardians (tenant_id, student_id, name, phone, relation)
    VALUES ($1,$2,'G. Parent','+91 98444 00444','mother') RETURNING id`, [t.id, s.rows[0].id]);
  await sql(`INSERT INTO app.users (tenant_id, email, name, role, password_hash, phone)
    VALUES ($1,'erasure.parent@meridian.edu','G. Parent','parent','x:y','+919844400444')`, [t.id]);
  const v = await sql(`INSERT INTO plugin_visitors.visit (tenant_id, visitor_name, visitor_phone, purpose, badge_code)
    VALUES ($1,'G. Parent','+91 98444 00444','pickup','B-ERASE') RETURNING id`, [t.id]);
  await sql(`INSERT INTO plugin_visitors.pickup_otp (tenant_id, visit_id, phone, code_hash, expires_at)
    VALUES ($1,$2,'+919844400444','stale:hash', now() - interval '2 hours')`, [t.id, v.rows[0].id]);
  await sql(`INSERT INTO app.auth_otps (tenant_id, phone, code_hash, expires_at)
    VALUES ($1,'+919844400444','stale:hash', now() - interval '2 hours')`, [t.id]);
  await sql(`INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status)
    VALUES ($1,'guardian','["+91 98444 00444", {"phone":"+919844400444"}]','whatsapp','ABSENCE','old notice','sent')`, [t.id]);
  await sql(`INSERT INTO plugin_razorpay.webhook_log (tenant_id, event_id, event_type, payload)
    VALUES ($1,'evt_erase_1','payment.captured','{"contact":"+91 98444 00444","amount":50000}')`, [t.id]);
  return { tenantId: t.id, studentId: s.rows[0].id, guardianId: g.rows[0].id };
};

const runErasure = async () => {
  const co = await loginAs(app, 'coordinator@meridian.edu');
  const r = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/dsr',
    payload: { kind: 'erasure', subjectRef: PHONE_DIGITS }, headers: H(co.token) });
  assert.equal(r.statusCode, 200, r.body);
  const { sarId, actionId } = r.json();
  const pr = await loginAs(app, 'principal@meridian.edu');
  const ap = await app.inject({ method: 'POST', url: `/actions/${actionId}/decide`,
    payload: { decision: 'approved', note: 'erasure completion test' }, headers: H(pr.token) });
  assert.equal(ap.statusCode, 200, ap.body);
  const ex = await app.inject({ method: 'POST', url: `/plugins/pack.dpdp/dsr/${sarId}/execute`, payload: {}, headers: H(pr.token) });
  assert.equal(ex.statusCode, 200, ex.body);
  return { sarId, bundle: ex.json().bundle };
};

describe('L2-3.5 · DPDP erasure completion', () => {
  let planted;
  before(async () => { planted = await plantSubject(); });

  test('erasure sweeps all queue surfaces with the keyed surrogate', async () => {
    const { bundle } = await runErasure();
    assert.ok(bundle.surfaces.guardiansRedacted >= 1, JSON.stringify(bundle.surfaces));
    assert.ok(bundle.surfaces.commsRecipientsHashed >= 1);
    assert.ok(bundle.surfaces.webhookPayloadsScrubbed >= 1);
    assert.ok(bundle.surfaces.pickupOtpPurged >= 1);
    assert.ok(bundle.surfaces.loginOtpPurged >= 1);
    assert.ok(bundle.surfaces.visitorPhonesRedacted >= 1);
    assert.ok(bundle.surfaces.sarRefsSurrogated >= 1);
    assert.ok(!JSON.stringify(bundle).includes(PHONE_DIGITS), 'bundle carries no raw phone');

    // grep-style assertions: no surface still carries the phone digits
    const leaks = [
      `SELECT count(*)::int n FROM app.guardians WHERE tenant_id=$1 AND regexp_replace(phone,'[^0-9]','','g') LIKE '%${PHONE_DIGITS}%'`,
      `SELECT count(*)::int n FROM app.communications WHERE tenant_id=$1 AND audience_json::text LIKE '%${PHONE_DIGITS}%'`,
      `SELECT count(*)::int n FROM plugin_razorpay.webhook_log WHERE tenant_id=$1 AND payload::text LIKE '%${PHONE_DIGITS}%'`,
      `SELECT count(*)::int n FROM plugin_visitors.pickup_otp WHERE tenant_id=$1 AND regexp_replace(phone,'[^0-9]','','g') LIKE '%${PHONE_DIGITS}%'`,
      `SELECT count(*)::int n FROM app.auth_otps WHERE tenant_id=$1 AND regexp_replace(phone,'[^0-9]','','g') LIKE '%${PHONE_DIGITS}%'`,
      `SELECT count(*)::int n FROM plugin_visitors.visit WHERE tenant_id=$1 AND regexp_replace(visitor_phone,'[^0-9]','','g') LIKE '%${PHONE_DIGITS}%'`,
      `SELECT count(*)::int n FROM plugin_dpdp.sar WHERE tenant_id=$1 AND regexp_replace(subject_ref,'[^0-9]','','g') LIKE '%${PHONE_DIGITS}%'`,
    ];
    for (const q of leaks) {
      const r = await sql(q, [planted.tenantId]);
      assert.equal(r.rows[0].n, 0, `PII leak: ${q}`);
    }
    // the surrogate is present where joins must survive
    const g = await sql(`SELECT phone, name FROM app.guardians WHERE id=$1`, [planted.guardianId]);
    assert.match(g.rows[0].phone, /^[0-9a-f]{24}$/, 'guardian phone is the surrogate');
    assert.match(g.rows[0].name, /^\[erased:/, 'guardian name redacted');
    const wh = await sql(`SELECT payload FROM plugin_razorpay.webhook_log WHERE event_id='evt_erase_1'`);
    assert.equal(wh.rows[0].payload.contact, bundle.subjectRef, 'webhook contact = the surrogate');
  });

  test('journal idempotence: repeat erasure reuses the surrogate; journal stores no PII', async () => {
    const first = await sql(`SELECT surrogate, subject_key, surfaces FROM plugin_dpdp.erasure_journal WHERE tenant_id=$1`, [planted.tenantId]);
    assert.equal(first.rows.length, 1);
    assert.ok(!first.rows[0].subject_key.includes(PHONE_DIGITS), 'journal key is a hash, not the phone');
    assert.ok(!JSON.stringify(first.rows[0].surfaces).includes(PHONE_DIGITS));
    // repeat the full flow for the same subject
    const { bundle } = await runErasure();
    const again = await sql(`SELECT surrogate FROM plugin_dpdp.erasure_journal WHERE tenant_id=$1`, [planted.tenantId]);
    assert.equal(again.rows.length, 1, 'one journal row per subject');
    assert.equal(bundle.subjectRef, first.rows[0].surrogate, 'repeat erasure carries the SAME surrogate');
    assert.equal(bundle.surfaces.guardiansRedacted, 0, 'second pass finds nothing left to redact');
  });

  test('office-lane surfaces untouched (students denormals + users) — documented gap', async () => {
    const s = await sql(`SELECT guardian_phone FROM app.students WHERE id=$1`, [planted.studentId]);
    assert.match(s.rows[0].guardian_phone, /98444/, 'students denormals stay (office-lane decision pending — blocks.md)');
  });
});
