// Master Action Plan — MPD vault + RTE/EWS ledger + payroll-lite + billing (migration 142).
// Pins: MPD checklist derives from vault rows (missing→ok→missing on retire); public disclosure
// carries institutional docs only; RTE lottery admits with statutory waiver + per-row failures;
// reimbursements track claimed/received; payroll structures→draft snapshots→disbursed history;
// billing checkout 503s honestly without gateway keys; signed webhook flips the plan;
// new surfaces appear in /me/effective exactly where the doors admit.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;
let owner, teacher, admissions, financeHead, clerk;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  teacher = await loginAs(app, 'teacher@meridian.edu');
  admissions = await loginAs(app, 'admissions@meridian.edu');
  // seed ships role 'finance' but no head/clerk — provision both like the office would
  for (const [email, name, role] of [
    ['head.finance@meridian.edu', 'Finance Head', 'finance_head'],
    ['clerk.finance@meridian.edu', 'Finance Clerk', 'finance_clerk'],
  ]) {
    const made = await app.inject({ method: 'POST', url: '/plugins/people.admin/users',
      headers: H(owner.token), payload: { email, name, role, password: 'Seeded-Pay-1' } });
    assert.equal(made.statusCode, 200, `provision ${role}: ${made.body}`);
  }
  financeHead = await loginAs(app, 'head.finance@meridian.edu', 'Seeded-Pay-1');
  clerk = await loginAs(app, 'clerk.finance@meridian.edu', 'Seeded-Pay-1');
});

after(async () => { await app?.close(); });

// ── MPD ─────────────────────────────────────────────────────────────────────
test('mpd: empty vault → 14 missing; file → ok; retire → missing again', async () => {
  const empty = await app.inject({ method: 'GET', url: '/compliance/mpd', headers: H(owner.token) });
  assert.equal(empty.statusCode, 200, empty.body);
  assert.equal(empty.json().checklist.length, 14, 'Appendix-IX wall has 14 rows');
  assert.ok(empty.json().checklist.every((c) => c.status === 'missing'));

  const add = await app.inject({ method: 'POST', url: '/compliance/mpd/docs', headers: H(owner.token),
    payload: { name: 'Fire safety 2026-27', kind: 'fire_safety', expiresOn: '2027-03-31' } });
  assert.equal(add.statusCode, 200, add.body);
  const after = await app.inject({ method: 'GET', url: '/compliance/mpd', headers: H(owner.token) });
  const fire = after.json().checklist.find((c) => c.kind === 'fire_safety');
  assert.equal(fire.status, 'ok');

  const ret = await app.inject({ method: 'POST', url: `/compliance/mpd/docs/${add.json().doc.id}/retire`, headers: H(owner.token), payload: {} });
  assert.equal(ret.statusCode, 200, ret.body);
  const gone = await app.inject({ method: 'GET', url: '/compliance/mpd', headers: H(owner.token) });
  assert.equal(gone.json().checklist.find((c) => c.kind === 'fire_safety').status, 'missing', 'retire returns the row to missing (history kept)');
});

test('mpd: teacher cannot file; bad kind/expiry refused; public wall carries docs only', async () => {
  const denied = await app.inject({ method: 'POST', url: '/compliance/mpd/docs', headers: H(teacher.token),
    payload: { name: 'X', kind: 'fire_safety' } });
  assert.equal(denied.statusCode, 403, denied.body);
  const badKind = await app.inject({ method: 'POST', url: '/compliance/mpd/docs', headers: H(owner.token),
    payload: { name: 'X', kind: 'nope' } });
  assert.equal(badKind.statusCode, 400, badKind.body);
  const badDate = await app.inject({ method: 'POST', url: '/compliance/mpd/docs', headers: H(owner.token),
    payload: { name: 'X', kind: 'fire_safety', expiresOn: '31-03-2027' } });
  assert.equal(badDate.statusCode, 400, badDate.body);

  const slug = (await pool.query(`SELECT slug FROM app.tenants WHERE slug IS NOT NULL LIMIT 1`)).rows[0].slug;
  const pub = await app.inject({ method: 'GET', url: `/public/disclosure?tenant=${slug}` });
  assert.equal(pub.statusCode, 200, pub.body);
  assert.ok(pub.json().school?.name, 'school named');
  assert.ok(!JSON.stringify(pub.json()).includes('admission_no'), 'no pupil identifiers on the public wall');
  const missing = await app.inject({ method: 'GET', url: '/public/disclosure?tenant=no-such-school-xyz' });
  assert.equal(missing.statusCode, 404, missing.body);
});

// ── RTE ─────────────────────────────────────────────────────────────────────
test('rte: overview starts empty; lottery admits with waiver; bad rows fail per-row', async () => {
  const empty = await app.inject({ method: 'GET', url: '/rte/overview', headers: H(admissions.token) });
  assert.equal(empty.statusCode, 200, empty.body);
  assert.equal(empty.json().quotaPct, 25);

  const classes = await app.inject({ method: 'GET', url: '/school/classes', headers: H(owner.token) });
  const entryGrades = ['Nursery', 'Jr KG', 'Sr KG', '1'];
  const g = classes.json().classes.find((c) => entryGrades.includes(c.grade)) ?? classes.json().classes[0];
  const imp = await app.inject({ method: 'POST', url: '/rte/lottery/import', headers: H(admissions.token),
    payload: { academicYear: '2026-27', rows: [
      { name: 'RTE Lottery One', dob: '2019-04-01', gender: 'female', guardianName: 'RTE Guardian One', guardianPhone: '+919000000031', category: 'EWS', grade: g.grade, section: g.sections[0] ?? 'A' },
      { name: 'Bad Row Kid', dob: 'not-a-date', gender: 'male', guardianName: 'G', guardianPhone: '+919000000032', category: 'EWS', grade: g.grade, section: g.sections[0] ?? 'A' },
    ] } });
  assert.equal(imp.statusCode, 200, imp.body);
  assert.equal(imp.json().imported.length, 1, 'good row lands');
  assert.equal(imp.json().failed.length, 1, 'bad row reported, not thrown');
  assert.match(imp.json().imported[0].admissionNo, /^RTE-/, 'RTE admission series');

  const waiver = await pool.query(
    `SELECT status, percent FROM app.fee_concessions WHERE student_id=(SELECT id FROM app.students WHERE admission_no=$1)`,
    [imp.json().imported[0].admissionNo]);
  assert.equal(waiver.rows[0]?.status, 'approved', 'statutory waiver approved at import');
  assert.equal(String(waiver.rows[0]?.percent), '100.00');

  const full = await app.inject({ method: 'GET', url: '/rte/overview', headers: H(admissions.token) });
  assert.ok(full.json().recent.some((s) => s.admission_no === imp.json().imported[0].admissionNo), 'overview surfaces the lottery pupil');
  if (['Nursery', 'Jr KG', 'Sr KG', '1'].includes(g.grade)) {
    assert.ok(full.json().seats.filled >= 1, 'filled counts the lottery pupil in entry grades');
  }

  const denied = await app.inject({ method: 'POST', url: '/rte/lottery/import', headers: H(teacher.token),
    payload: { academicYear: '2026-27', rows: [] } });
  assert.equal(denied.statusCode, 403, denied.body);
});

test('rte: reimbursements track claimed vs received; finance_head writes, teacher cannot', async () => {
  const no = await app.inject({ method: 'POST', url: '/rte/reimbursements', headers: H(teacher.token),
    payload: { academicYear: '2026-27', amountCents: 50000 } });
  assert.equal(no.statusCode, 403, no.body);
  const bad = await app.inject({ method: 'POST', url: '/rte/reimbursements', headers: H(financeHead.token),
    payload: { academicYear: '2026-27', amountCents: -5 } });
  assert.equal(bad.statusCode, 400, bad.body);
  const c1 = await app.inject({ method: 'POST', url: '/rte/reimbursements', headers: H(financeHead.token),
    payload: { academicYear: '2026-27', amountCents: 100000, claimRef: 'MH-RTE-26-001', status: 'claimed' } });
  assert.equal(c1.statusCode, 200, c1.body);
  const c2 = await app.inject({ method: 'POST', url: '/rte/reimbursements', headers: H(financeHead.token),
    payload: { academicYear: '2026-27', amountCents: 40000, claimRef: 'MH-RTE-26-001', status: 'received' } });
  assert.equal(c2.statusCode, 200, c2.body);
  const over = await app.inject({ method: 'GET', url: '/rte/overview', headers: H(financeHead.token) });
  assert.equal(over.json().reimbursements.pending_cents, 60000, 'pending = claimed − received');
});

// ── payroll ─────────────────────────────────────────────────────────────────
test('payroll: structure → draft snapshots → disburse locks history; guards hold', async () => {
  const denied = await app.inject({ method: 'GET', url: '/payroll/overview', headers: H(teacher.token) });
  assert.equal(denied.statusCode, 403, denied.body);
  const over = await app.inject({ method: 'GET', url: '/payroll/overview', headers: H(clerk.token) });
  assert.equal(over.statusCode, 200, over.body);
  assert.match(over.json().month, /^\d{4}-\d{2}$/, 'current month suggested');

  const who = over.json().staff.find((s) => s.role === 'teacher');
  const badPan = await app.inject({ method: 'PUT', url: `/payroll/staff/${who.id}`, headers: H(financeHead.token),
    payload: { monthlyCents: 4500000, pan: 'nope' } });
  assert.equal(badPan.statusCode, 400, badPan.body);
  const parentRow = (await pool.query(`SELECT id FROM app.users WHERE role='parent' LIMIT 1`)).rows[0];
  if (parentRow) {
    const noParent = await app.inject({ method: 'PUT', url: `/payroll/staff/${parentRow.id}`, headers: H(financeHead.token),
      payload: { monthlyCents: 100 } });
    assert.equal(noParent.statusCode, 404, noParent.body);
  }
  const set = await app.inject({ method: 'PUT', url: `/payroll/staff/${who.id}`, headers: H(financeHead.token),
    payload: { monthlyCents: 4500000, bankAcct: '5020001234567890', pan: 'ABCDE1234F' } });
  assert.equal(set.statusCode, 200, set.body);
  const masked = await app.inject({ method: 'GET', url: '/payroll/overview', headers: H(financeHead.token) });
  const mine = masked.json().staff.find((s) => s.id === who.id);
  assert.equal(mine.bankLast4, '****7890', 'reads mask the account');

  const run = await app.inject({ method: 'POST', url: '/payroll/runs', headers: H(financeHead.token), payload: { month: '2026-10' } });
  assert.equal(run.statusCode, 200, run.body);
  assert.ok(run.json().payslips >= 1, 'structured staff get slips');
  assert.ok(Array.isArray(run.json().skipped), 'unstructured staff reported by name');
  const dup = await app.inject({ method: 'POST', url: '/payroll/runs', headers: H(financeHead.token), payload: { month: '2026-10' } });
  assert.equal(dup.statusCode, 409, dup.body);
  const badMonth = await app.inject({ method: 'POST', url: '/payroll/runs', headers: H(financeHead.token), payload: { month: 'October' } });
  assert.equal(badMonth.statusCode, 400, badMonth.body);

  const clerkNo = await app.inject({ method: 'POST', url: `/payroll/runs/${run.json().run.id}/disburse`, headers: H(clerk.token),
    payload: { mode: 'ecs', ref: 'HDFC-01' } });
  assert.equal(clerkNo.statusCode, 403, clerkNo.body, 'clerk reads but never disburses');
  const dis = await app.inject({ method: 'POST', url: `/payroll/runs/${run.json().run.id}/disburse`, headers: H(financeHead.token),
    payload: { mode: 'ecs', ref: 'HDFC-01' } });
  assert.equal(dis.statusCode, 200, dis.body);
  assert.equal(dis.json().run.status, 'disbursed');
  const again = await app.inject({ method: 'POST', url: `/payroll/runs/${run.json().run.id}/disburse`, headers: H(financeHead.token),
    payload: { mode: 'ecs' } });
  assert.equal(again.statusCode, 409, again.body);
});

// ── billing ─────────────────────────────────────────────────────────────────
test('billing: owner reads plan+usage; checkout 503s honestly without gateway keys', async () => {
  const denied = await app.inject({ method: 'GET', url: '/billing', headers: H(teacher.token) });
  assert.equal(denied.statusCode, 403, denied.body);
  const got = await app.inject({ method: 'GET', url: '/billing', headers: H(owner.token) });
  assert.equal(got.statusCode, 200, got.body);
  assert.ok(got.json().plan, 'plan answered');
  assert.ok(got.json().plans?.core?.amount_cents > 0, 'published plan prices');

  const badPlan = await app.inject({ method: 'POST', url: '/billing/checkout', headers: H(owner.token), payload: { plan: 'everything' } });
  assert.equal(badPlan.statusCode, 400, badPlan.body);
  const out = await app.inject({ method: 'POST', url: '/billing/checkout', headers: H(owner.token), payload: { plan: 'operations' } });
  assert.equal(out.statusCode, 503, out.body, 'no gateway keys in test env → honest 503, plan untouched');
  const still = await app.inject({ method: 'GET', url: '/billing', headers: H(owner.token) });
  assert.equal(still.json().plan, got.json().plan, 'failed checkout changes nothing');
});

test('billing: webhook 401s bad signatures; paid event flips the plan', async () => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? 'test-only-secret';
  const tenant = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;
  const ord = (await pool.query(
    `INSERT INTO app.billing_orders (tenant_id, plan, amount_cents, gateway_order_id, created_by)
     VALUES ($1,'operations',3500000,'order_test_9', (SELECT id FROM app.users WHERE email='owner@meridian.edu')) RETURNING id`,
    [tenant])).rows[0];
  const payload = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { order_id: 'order_test_9' } } } });
  const badSig = await app.inject({ method: 'POST', url: '/billing/webhook', payload,
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'deadbeef' } });
  assert.equal(badSig.statusCode, 401, badSig.body);
  const good = createHmac('sha256', secret).update(payload).digest('hex');
  const ok = await app.inject({ method: 'POST', url: '/billing/webhook', payload,
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': good } });
  // without the deployment secret the door is honestly 503; with it, the plan flips
  if (ok.statusCode === 503) {
    assert.match(ok.body, /not configured/, 'honest 503 without webhook secret');
    await pool.query(`DELETE FROM app.billing_orders WHERE id=$1`, [ord.id]);
  } else {
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().plan, 'operations');
    const plan = (await pool.query(`SELECT plan FROM app.tenants WHERE id=$1`, [tenant])).rows[0].plan;
    assert.equal(plan, 'operations', 'paid webhook flips the tenant plan');
    const replay = await app.inject({ method: 'POST', url: '/billing/webhook', payload,
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': good } });
    assert.equal(replay.statusCode, 200, replay.body, 'duplicate delivery is ignored, not double-applied');
    await pool.query(`UPDATE app.tenants SET plan='trial' WHERE id=$1`, [tenant]);
  }
});

// ── surfaces ────────────────────────────────────────────────────────────────
test('effective: new surfaces render exactly where the doors admit', async () => {
  const o = await app.inject({ method: 'GET', url: '/me/effective', headers: H(owner.token) });
  assert.equal(o.statusCode, 200, o.body);
  for (const s of ['/mpd', '/rte', '/payroll', '/billing']) assert.equal(o.json().capabilities[s], true, `owner renders ${s}`);
  const t = await app.inject({ method: 'GET', url: '/me/effective', headers: H(teacher.token) });
  assert.equal(t.json().capabilities['/payroll'] ?? false, false, 'teacher does not render payroll');
  assert.equal(t.json().capabilities['/billing'] ?? false, false, 'teacher does not render billing');
});
