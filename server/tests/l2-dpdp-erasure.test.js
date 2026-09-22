// L2-3.5 (Wave 3) — DPDP erasure completion (queue-scoped surfaces).
// Pins: guardians redaction with the keyed surrogate (format-insensitive match —
// spaced phone formats still die), comms recipient hashing, webhook payload scrub,
// OTP vaults purged, SAR trail surrogated (no raw phone anywhere post-erasure),
// journal idempotence with NO PII stored, consent/lead pins from dpdp.test intact.
//
// OFFICE LANE (owner decision, 2026-09-14): erasure now REACHES the denormalised guardian PII on
// app.students. `guardian_phone` is CLEARED (NULL, not the surrogate — that column is the office lane's
// contact copy, and its consumers, e.g. the fee-dunning sweep, treat any non-empty value as a deliverable
// number), `guardian_name` is tombstoned `[erased:<student id>]`. The write is the KERNEL-executed
// core-lane action `students.redactGuardianPii` (src/core-lane-actions.js), REQUESTED by the pack — the
// pack still holds no SQL against app.students, per migration 023's recorded invariant. Login identities
// (app.users) remain office-lane and are asserted as such rather than left implied.
//
// ANTI-OVER-DELETION CONTROLS: every office-lane test plants, alongside its subject, (1) a student in the
// same tenant whose guardian phone does NOT match and (2) a student in ANOTHER tenant carrying the
// SUBJECT's phone. Both must be byte-identical after the erasure. These are the assertions that catch a
// WHERE-less `UPDATE app.students …`.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json', 'x-step-up-password': 'schoolos-demo' });
const PHONE_DIGITS = '9844400444';
const PHONE_E164 = '+919844400444';
// The control's phone shares nothing with any subject: no prefix, no suffix, no digit overlap.
const CONTROL_PHONE = '+91 98111 00999';

let app;
let sql;
let planted; // planted ONCE, before any erasure, so the primary subject's surfaces are a true baseline

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
  planted = await plantSubject();
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
  // LIB-E7: a library purchase request whose free-text note carries the subject's phone (the only place
  // library data can hold contact PII), and a loan row that must SURVIVE erasure — the library's borrower
  // reference is a tenant-aligned FK to the office lane, not a denormalised name.
  const bk = await sql(`INSERT INTO library.book (tenant_id, code, copies_total, title)
    VALUES ($1,'ERASE-BK-001','1','Erasure Book') RETURNING id`, [t.id]);
  const cp = await sql(`INSERT INTO library.copy (tenant_id, book_id, copy_code, status)
    VALUES ($1,$2,'ERASE-CP-001','issued') RETURNING id`, [t.id, bk.rows[0].id]);
  const ln = await sql(`INSERT INTO library.loan (tenant_id, book_id, copy_id, student_id, borrower_type, status, due_on)
    VALUES ($1,$2,$3,$4,'student','issued', current_date + 7) RETURNING id`,
    [t.id, bk.rows[0].id, cp.rows[0].id, s.rows[0].id]);
  await sql(`INSERT INTO library.acquisition_request (tenant_id, title, note, requested_by_student_id, normalized_key)
    VALUES ($1,'Privacy Please','reach me on +91 98444 00444',$2,'privacy please|')`, [t.id, s.rows[0].id]);
  // A SECOND tenant, for the cross-tenant control: the same guardian phone lives in both schools, and
  // erasing a data principal in one must not reach the other.
  const t2 = (await sql(`INSERT INTO app.tenants (slug, name) VALUES ('erasure-other-school','Other School') RETURNING id`)).rows[0];
  return { tenantId: t.id, studentId: s.rows[0].id, guardianId: g.rows[0].id, loanId: ln.rows[0].id, otherTenant: t2.id };
};

// One fresh data principal for an office-lane test: the matching student, plus the two controls. The
// returned rows are the PRE-erasure snapshots, so "unchanged" is asserted byte-for-byte rather than by
// re-reading the fields we happened to think of.
const plantPrincipal = async (tag, digits, e164) => {
  const one = async (tid, admissionNo, name, guardianName, guardianPhone) => (await sql(
    `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone)
     VALUES ($1,$2,$3,'7','A',$4,$5) RETURNING *`,
    [tid, admissionNo, name, guardianName, guardianPhone])).rows[0];
  const subject = await one(planted.tenantId, `ERASE-${tag}`, `Kid ${tag}`, `G ${tag}`, e164);
  const bystander = await one(planted.tenantId, `ERASE-${tag}-CTL`, `Bystander ${tag}`, 'Other Guardian', CONTROL_PHONE);
  const other = await one(planted.otherTenant, `ERASE-${tag}-OT`, `Other School ${tag}`, `G ${tag}`, e164);
  return { tag, digits, e164, subject, bystander, other };
};

const runErasure = async (subjectRef = PHONE_DIGITS) => {
  const co = await loginAs(app, 'coordinator@meridian.edu');
  const r = await app.inject({ method: 'POST', url: '/plugins/pack.dpdp/dsr',
    payload: { kind: 'erasure', subjectRef }, headers: H(co.token) });
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

// Mirrors the pack's journal key derivation ON PURPOSE: it pins the derivation, and it lets a test find
// ITS OWN journal row (the journal is keyed per data principal, not per tenant, so a test cannot assume
// the table holds only one row once several principals have been erased).
const subjectKeyFor = (tenantId, e164) =>
  createHash('sha256').update(`dpdp-erasure:${tenantId}:${e164}`).digest('hex');

describe('L2-3.5 · DPDP erasure completion', () => {
  test('erasure sweeps all queue surfaces with the keyed surrogate', async () => {
    const { bundle } = await runErasure();
    assert.ok(bundle.surfaces.guardiansRedacted >= 1, JSON.stringify(bundle.surfaces));
    assert.ok(bundle.surfaces.commsRecipientsHashed >= 1);
    assert.ok(bundle.surfaces.webhookPayloadsScrubbed >= 1);
    assert.ok(bundle.surfaces.pickupOtpPurged >= 1);
    assert.ok(bundle.surfaces.loginOtpPurged >= 1);
    assert.ok(bundle.surfaces.visitorPhonesRedacted >= 1);
    assert.ok(bundle.surfaces.sarRefsSurrogated >= 1);
    assert.ok(bundle.surfaces.libraryBorrowerRefsRedacted >= 1, 'the library free-text surface is swept (LIB-E7)');
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
      // The office lane is a surface too now: the denormalised copy on the student row.
      `SELECT count(*)::int n FROM app.students WHERE tenant_id=$1 AND regexp_replace(COALESCE(guardian_phone,''),'[^0-9]','','g') LIKE '%${PHONE_DIGITS}%'`,
      // LIB-E7: the library's one contact-PII surface, the purchase-request free text.
      `SELECT count(*)::int n FROM library.acquisition_request WHERE tenant_id=$1 AND regexp_replace(COALESCE(note,''),'[^0-9]','','g') LIKE '%${PHONE_DIGITS}%'`,
    ];
    for (const q of leaks) {
      const r = await sql(q, [planted.tenantId]);
      assert.equal(r.rows[0].n, 0, `PII leak: ${q}`);
    }
    // LIB-E7: the academic record survives — the library's borrower reference is the FK, not PII.
    const loan = (await sql(`SELECT id, student_id, status FROM library.loan WHERE id=$1`, [planted.loanId])).rows;
    assert.equal(loan.length, 1, 'the library loan row survives erasure (academic record preserved)');
    assert.equal(loan[0].student_id, planted.studentId, 'its borrower FK still resolves to the pupil');
    // the surrogate is present where joins must survive
    const g = await sql(`SELECT phone, name FROM app.guardians WHERE id=$1`, [planted.guardianId]);
    assert.match(g.rows[0].phone, /^[0-9a-f]{24}$/, 'guardian phone is the surrogate');
    assert.match(g.rows[0].name, /^\[erased:/, 'guardian name redacted');
    const wh = await sql(`SELECT payload FROM plugin_razorpay.webhook_log WHERE event_id='evt_erase_1'`);
    assert.equal(wh.rows[0].payload.contact, bundle.subjectRef, 'webhook contact = the surrogate');
  });

  test('journal idempotence: repeat erasure reuses the surrogate; journal stores no PII', async () => {
    const key = subjectKeyFor(planted.tenantId, PHONE_E164);
    const first = await sql(`SELECT surrogate, subject_key, surfaces FROM plugin_dpdp.erasure_journal WHERE tenant_id=$1 AND subject_key=$2`,
      [planted.tenantId, key]);
    assert.equal(first.rows.length, 1);
    assert.ok(!first.rows[0].subject_key.includes(PHONE_DIGITS), 'journal key is a hash, not the phone');
    assert.ok(!JSON.stringify(first.rows[0].surfaces).includes(PHONE_DIGITS));
    // the journal records what the office-lane core action did — as a count
    assert.ok('studentsGuardianPiiRedacted' in first.rows[0].surfaces,
      `journal records the students-row surface: ${JSON.stringify(first.rows[0].surfaces)}`);
    assert.ok(first.rows[0].surfaces.studentsGuardianPiiRedacted >= 1);
    // repeat the full flow for the same subject
    const { bundle } = await runErasure();
    const again = await sql(`SELECT surrogate FROM plugin_dpdp.erasure_journal WHERE tenant_id=$1 AND subject_key=$2`, [planted.tenantId, key]);
    assert.equal(again.rows.length, 1, 'one journal row per subject');
    assert.equal(bundle.subjectRef, first.rows[0].surrogate, 'repeat erasure carries the SAME surrogate');
    assert.equal(bundle.surfaces.guardiansRedacted, 0, 'second pass finds nothing left to redact');
    assert.equal(bundle.surfaces.studentsGuardianPiiRedacted, 0, 'second pass finds no student row left to redact');
  });

  // OWNER-APPROVED REVERSAL (2026-09-14). This test previously read
  //   'office-lane surfaces untouched (students denormals + users) — documented gap'
  // and asserted `assert.match(guardian_phone, /98444/)`. The owner decided erasure must reach the
  // office lane, so the assertion is the opposite one — a test whose NAME says "untouched" while its
  // assertion says "touched" would be worse than no test at all, hence the new name.
  test('office-lane student row IS erased, while the primary surfaces stay erased (login identities remain office-lane)', async () => {
    await runErasure(); // self-contained: describe the state AFTER an erasure, whatever ran before
    // 1) the primary surfaces the pack owns: still erased
    const g = await sql(`SELECT phone, name FROM app.guardians WHERE id=$1`, [planted.guardianId]);
    assert.match(g.rows[0].phone, /^[0-9a-f]{24}$/, 'primary surface: guardian phone is still the surrogate');
    assert.match(g.rows[0].name, /^\[erased:/, 'primary surface: guardian name still redacted');
    const sarLeak = await sql(`SELECT count(*)::int n FROM plugin_dpdp.sar WHERE tenant_id=$1
      AND regexp_replace(subject_ref,'[^0-9]','','g') LIKE '%${PHONE_DIGITS}%'`, [planted.tenantId]);
    assert.equal(sarLeak.rows[0].n, 0, 'primary surface: SAR trail still carries no raw phone');
    // 2) the office lane: the denormalised guardian PII on the student row is GONE
    const s = await sql(`SELECT guardian_name, guardian_phone FROM app.students WHERE id=$1`, [planted.studentId]);
    assert.equal(s.rows[0].guardian_phone, null,
      'students denormalised guardian_phone is CLEARED by erasure (office-lane decision, 2026-09-14)');
    assert.match(s.rows[0].guardian_name, /^\[erased:/, 'students denormalised guardian_name is tombstoned');
    assert.ok(!JSON.stringify(s.rows[0]).includes(PHONE_DIGITS), 'no raw phone left on the student row');
    // 3) the part that is STILL a documented gap, asserted so it cannot rot silently: the LOGIN identity
    //    (app.users.phone) is not this pack's to erase — an unreconciled gap, not an oversight.
    const u = await sql(`SELECT phone FROM app.users WHERE email='erasure.parent@meridian.edu'`);
    assert.ok(u.rows[0].phone.includes(PHONE_DIGITS),
      'login identities (app.users) remain office-lane — unchanged by this decision (blocks.md)');
  });
});

// The office-lane half gets its own explicit coverage: the tests above pin the primary sweep, these pin
// the office-lane erasure itself — what it changes, what it must never change, and repeat behaviour.
describe('L2-3.5 · office-lane erasure (app.students denormalised guardian PII)', () => {
  test('(a) matched student: guardian_phone and guardian_name no longer carry the subject\'s PII', async () => {
    const p = await plantPrincipal('A', '9840011001', '+919840011001');
    const { sarId, bundle } = await runErasure(p.digits);
    assert.equal(bundle.surfaces.studentsGuardianPiiRedacted, 1,
      `the erasure reports exactly the matched student row: ${JSON.stringify(bundle.surfaces)}`);
    const s = (await sql(`SELECT guardian_name, guardian_phone FROM app.students WHERE id=$1`, [p.subject.id])).rows[0];
    assert.equal(s.guardian_phone, null, 'guardian_phone erased (NULL — not the surrogate; see the module note)');
    assert.equal(s.guardian_name, `[erased:${p.subject.id}]`, 'guardian_name tombstoned with the module marker');
    const raw = JSON.stringify(s);
    assert.ok(!raw.includes(p.digits) && !raw.includes(`G ${p.tag}`), `row carries no subject PII: ${raw}`);
    // BOUNDARY, pinned so it cannot be "fixed" by accident (docs/PERFECT-100 DAT-16 listed three parent
    // columns; only two are the SUBJECT's). The erasure is scoped to a data principal identified by a
    // GUARDIAN PHONE; `app.students.name` is the PUPIL's name — a different data principal — and the owner's
    // decision covers the students-row denormalised GUARDIAN PII, so the pupil's name stays.
    const pupil = (await sql(`SELECT name FROM app.students WHERE id=$1`, [p.subject.id])).rows[0];
    assert.equal(pupil.name, p.subject.name, 'the pupil\'s own name is NOT erased — a different data principal');
    // The office-lane action is likewise audited — the kernel writes this row IN THE SAME TRANSACTION as
    // the mutation — and the audit row itself carries no erased value.
    const audit = (await sql(`SELECT actor_role, action, outcome FROM app.audit_log
      WHERE tenant_id=$1 AND record_type='CoreLaneAction' AND record_ref=$2`, [planted.tenantId, sarId])).rows;
    assert.equal(audit.length, 1, 'the office-lane core-lane action left exactly one audit row, tied to the SAR');
    assert.match(audit[0].action, /students\.redactGuardianPii/, 'the audit names the action it executed');
    assert.equal(audit[0].actor_role, 'plugin:pack.dpdp', 'provenance: plugin-requested, kernel-executed');
    assert.ok(!JSON.stringify(audit[0]).includes(p.digits), 'the audit row records no erased value');
  });

  test('(b) anti-over-deletion: non-matching student in-tenant, and same-phone student in ANOTHER tenant, are unchanged', async () => {
    const p = await plantPrincipal('B', '9840022002', '+919840022002');
    const { bundle } = await runErasure(p.digits);
    assert.equal(bundle.surfaces.studentsGuardianPiiRedacted, 1, 'exactly one row matched — not the whole table');
    const bystander = (await sql(`SELECT * FROM app.students WHERE id=$1`, [p.bystander.id])).rows[0];
    assert.deepEqual(bystander, p.bystander,
      'a student whose guardian phone does not match is byte-identical (this catches a WHERE-less UPDATE)');
    const other = (await sql(`SELECT * FROM app.students WHERE id=$1`, [p.other.id])).rows[0];
    assert.deepEqual(other, p.other,
      'the SAME guardian phone in another tenant is untouched — the erasure is tenant-scoped');
    // ...and the other school can still reach that guardian by phone (it was not rewritten to a look-alike)
    const still = await sql(`SELECT count(*)::int n FROM app.students WHERE tenant_id=$1
      AND regexp_replace(guardian_phone,'[^0-9]','','g') LIKE '%' || $2 || '%'`, [planted.otherTenant, p.digits]);
    assert.equal(still.rows[0].n, 1);
  });

  test('(c) a second erasure for the same subject is idempotent (nothing left to redact)', async () => {
    // Its OWN principal, so the first pass genuinely has something to redact: on the primary subject an
    // earlier test already cleared the row, and asserting a count of 0 there would prove nothing.
    const p = await plantPrincipal('C', '9840033003', '+919840033003');
    const first = await runErasure(p.digits);
    assert.equal(first.bundle.surfaces.studentsGuardianPiiRedacted, 1, JSON.stringify(first.bundle.surfaces));
    const afterFirst = (await sql(`SELECT * FROM app.students WHERE id=$1`, [p.subject.id])).rows[0];
    assert.equal(afterFirst.guardian_phone, null);
    assert.equal(afterFirst.guardian_name, `[erased:${p.subject.id}]`);
    const second = await runErasure(p.digits);
    assert.equal(second.bundle.surfaces.studentsGuardianPiiRedacted, 0, 'second pass redacts no student row');
    const afterSecond = (await sql(`SELECT * FROM app.students WHERE id=$1`, [p.subject.id])).rows[0];
    assert.deepEqual(afterSecond, afterFirst, 'the erased row is stable across repeats (no re-tombstoning)');
    assert.equal(second.bundle.subjectRef, first.bundle.subjectRef, 'same surrogate on the repeat');
  });

  test('(d) the journal records the students-row surface, and still stores no PII', async () => {
    const p = await plantPrincipal('D', '9840044004', '+919840044004');
    const { bundle } = await runErasure(p.digits);
    const key = subjectKeyFor(planted.tenantId, p.e164);
    const j = (await sql(`SELECT subject_key, surrogate, surfaces FROM plugin_dpdp.erasure_journal
      WHERE tenant_id=$1 AND subject_key=$2`, [planted.tenantId, key])).rows;
    assert.equal(j.length, 1, 'this data principal has exactly one journal row');
    const surfaces = j[0].surfaces;
    assert.equal(surfaces.studentsGuardianPiiRedacted, 1, `surfaces: ${JSON.stringify(surfaces)}`);
    assert.ok(!('guardian_phone' in surfaces) && !('guardian_name' in surfaces) && !('students' in surfaces),
      'no erased value smuggled into the journal — the students-row surface is a COUNT');
    assert.ok(!JSON.stringify(j[0]).includes(p.digits), 'journal stores no raw phone');
    assert.ok(!JSON.stringify(j[0]).includes(`G ${p.tag}`), 'journal stores no guardian name');
    assert.ok(!JSON.stringify(bundle).includes(p.digits), 'the bundle carries no raw phone either');
  });

  // The office-lane write surface a plugin can reach is a REVIEWED LIST, not a facility. Adding an action
  // means editing src/core-lane-actions.js AND this pin — so "what can a plugin make the kernel do to the
  // office lane?" can never grow silently.
  test('(e) the core-lane action registry contains exactly the reviewed actions', async () => {
    const { CORE_LANE_ACTIONS } = await import('../src/core-lane-actions.js');
    assert.deepEqual([...CORE_LANE_ACTIONS], ['students.redactGuardianPii'],
      'the plugin-reachable office-lane action list changed — justify the new action and update this pin');
  });
});
