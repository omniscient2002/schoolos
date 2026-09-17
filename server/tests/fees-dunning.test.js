// Fee dunning (Wave 3 · L1-3.2): overdue-obligation reminders queued as
// communications with 7-day dedup, quiet-hours respect (plugin settings, IST),
// no-contact skips, honest copy, and role gates.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app;
let sql;
let ownerToken, financeToken, teacherToken;
let tenantA, studentId, fixtureStudentId, obligationId;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

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
  ownerToken = (await loginAs(app, 'owner@meridian.edu')).token;
  financeToken = (await loginAs(app, 'finance@meridian.edu')).token;
  teacherToken = (await loginAs(app, 'teacher@meridian.edu')).token;
  tenantA = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  /* A DEDICATED fixture student, and it is not cosmetic. These tests drive the dunning SWEEP, which reads
     the whole tenant, orders by due_on and takes only the first 200 candidates. Using a seeded student made
     the fixtures compete with the seeded corpus for those 200 slots, and the corpus is not frozen: seed.js:160
     pins the September installments to an absolute due_on='2026-10-05', so from 2026-10-06 every still-open
     September installment (measured: 290) is older than these fixtures (10 days late) and sorts ahead of them,
     pushing them past the cap — the sweep then queues nothing for a fixture that is genuinely overdue. A
     scoped count does not save you from that: it reports 0 instead of the inflated number, and 0 is still a
     false red. Giving the fixtures their own student whose contact we control removes the competition at the
     source, so every assertion below measures product behaviour rather than the world's stock of overdue fees.
     `obligationId` is left unused by design — it was assigned but never read. */
  const fs = await sql(
    `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone, source, source_ref)
     VALUES ($1,'DN-FIXTURE-1','DN Fixture Student','8','A','DN Fixture Guardian','+919000006001','migration','dn-fixture')
     RETURNING id`, [tenantA]);
  fixtureStudentId = fs.rows[0].id;
  studentId = fixtureStudentId;
  /* Take the tenant's SEEDED obligations out of the candidate set, so the sweep's input is entirely owned by
     this file. This is the part that a dedicated student alone did not fix, and the reason is worth recording:
     the sweep runs per TENANT (`WHERE o.tenant_id=$1 ... ORDER BY o.due_on LIMIT 200`), so isolating the fixture
     student does nothing about the corpus competing for those 200 slots. Measured: on 2026-10-06, 290 seeded
     September installments (due 2026-10-05) become overdue and sort AHEAD of a fixture that is 10 days late
     (due ≈ 2026-09-26), so they consume the whole cap and the sweep reports 0 reminders for a fixture that is
     genuinely overdue. A scoped count does not rescue that — it reports a wrong 0 instead of a wrong 291, and a
     false red is as corrosive as a false green. Pushing the seeded rows far out of the window leaves every
     assertion below measuring the fixtures AND the product's limit/ordering behaviour, without depending on the
     calendar. Verified by re-running this file with the seed's September due date rewritten to 2026-01-05, which
     reproduces the 2026-10-06 corpus exactly. */
  await sql(`UPDATE app.fee_obligations SET due_on = (now() AT TIME ZONE 'Asia/Kolkata')::date + 3650
            WHERE tenant_id=$1 AND student_id <> $2`, [tenantA, fixtureStudentId]);
});
after(async () => { await app?.close(); });

// quiet-hours control: a window that NEVER contains "now" (now+2…now+3 min IST)
// so dunning tests are honest any time of day; the quiet-hours test overrides it.
const IST_MINUTES_NOW = () => { const d = new Date(Date.now() + 5.5 * 3600 * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hm = (total) => { const t = ((total % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const setQuiet = async (quiet) => {
  /* PLG-10: `dunningQuietHours` resolves the settings through the `comms.whatsapp.templates` CAPABILITY,
     which only selects an ENABLED provider carrying that declaration in its STORED MANIFEST. A hand-written
     row with `manifest '{}'` resolves nothing and falls back to the default 21:00–08:00 window — which is
     why these tests failed at night. Persist the real on-disk manifest. */
  const { declaredManifest } = await import('../src/plugin-permissions.js');
  const manifest = await declaredManifest('comms.whatsapp');
  await sql(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, enabled_at, enabled_by, settings)
             VALUES ($1,'comms.whatsapp','1.0.0','C','enabled',$3::jsonb,'[]'::jsonb, now(), NULL, $2::jsonb)
             ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET status='enabled', settings = $2::jsonb, manifest = EXCLUDED.manifest`,
  [tenantA, JSON.stringify({ quiet_hours: quiet }), JSON.stringify(manifest)]);
};
const awayWindow = () => ({ start: hm(IST_MINUTES_NOW() + 2), end: hm(IST_MINUTES_NOW() + 3) });

const overdue = (label, cents, daysLate = 10, phone = '+919000006001') => sql(
  `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, status)
   VALUES ($1,$2,'Term 2',$3, (now() AT TIME ZONE 'Asia/Kolkata')::date - $4::int, $5, 'open') RETURNING id`,
  [tenantA, studentId, label, daysLate, cents]);

const run = (t) => app.inject({ method: 'POST', url: '/fees/dunning/run', payload: {}, headers: H(t) });
const queuedFor = async (obligationId) =>
  (await sql(`SELECT status, template, body, dedup_key, audience_json FROM app.communications WHERE dedup_key=$1`, [`dunning:${obligationId}`])).rows;

// ---- expiry-proof scoping -------------------------------------------------------------------------
// `run()` returns a sweep-wide `queued` count, and the seeded corpus is NOT frozen: seed.js:160 pins
// the September installments to an ABSOLUTE `due_on = '2026-10-05'`, and DUNNING_SELECT (routes.js:1444)
// selects `due_on < IST_TODAY()` with no upper bound. So on 2026-10-06 every still-open September
// installment crosses that boundary at once and joins the candidate set. Absolute `queued`/`skippedNoContact`
// assertions therefore expire on a calendar date with no code change — a false red, which is as corrosive
// as a false green. These helpers scope a sweep result to the fixtures a single test created, so the
// assertions measure product behaviour instead of the world's stock of overdue fees.
const queuedCount = async (obligationId) => (await queuedFor(obligationId)).length;
/* Retire this file's own overdue fixtures between tests. The sweep caps its candidate set at 200, so each
   test must know exactly which overdue obligations it is asking about; leaving earlier fixtures overdue makes
   later tests' global counts (`skippedNoContact`, `queued`) depend on execution order. Retiring them keeps the
   candidate set equal to the fixtures the CALLING test created. Marked 'paid' rather than deleted because the
   ledger is append-only in spirit and a deleted obligation would hide a real bug if the sweep ever resurrected
   one — and it must never be `status='void'`, which the sweep also ignores for a different reason. */
const retireOverdueFixtures = () => sql(
  `UPDATE app.fee_obligations SET status='paid', paid_cents=amount_cents
   WHERE tenant_id=$1 AND student_id=$2 AND status IN ('open','partial')`, [tenantA, fixtureStudentId]);

/* Between every test, retire this file's own overdue fixtures. Without this, a later test's sweep-wide
   counters depend on what earlier tests left overdue — which is how the original absolute-count assertions
   became reproducible-looking but order-dependent. */
afterEach(retireOverdueFixtures);

const commsCount = async () =>
  (await sql(`SELECT count(*)::int n FROM app.communications WHERE tenant_id=$1 AND template='FEE_REMINDER'`, [tenantA])).rows[0].n;

test('DN · overdue obligation → one queued reminder with honest copy and dedup key', async () => {
  await setQuiet(awayWindow()); // dunning must be writable now (not IST quiet hours)
  const o = (await overdue('DN overdue case', 150000)).rows[0];
  const r = await run(ownerToken);
  assert.equal(r.statusCode, 200, r.body);
  // Scoped to THIS fixture's obligation (was: assert.equal(r.json().queued, 1)). The sweep's global count
  // also includes every other overdue obligation in the database, which grows without bound as seeded
  // absolute due dates elapse — see the expiry-proof scoping note above. The product property under test
  // is unchanged: running the sweep queues a reminder for an overdue obligation exactly once.
  assert.equal(await queuedCount(o.id), 1, 'the sweep queued exactly one reminder for this obligation');
  assert.equal(r.json().template, 'FEE_REMINDER');
  const cm = (await queuedFor(o.id))[0];
  assert.equal(cm.status, 'queued');
  assert.equal(cm.template, 'FEE_REMINDER');
  assert.deepEqual(cm.audience_json, ['+919000006001']);
  assert.match(cm.body, /Fee reminder/);
  assert.match(cm.body, /₹1500/);
  assert.match(cm.body, /If you have already paid/);
  obligationId = o.id; // the 7-day dedup pin below is about this same obligation
});

test('DN · 7-day dedup: immediate re-run queues nothing', async () => {
  const r = await run(financeToken);
  assert.equal(r.statusCode, 200);
  // Scoped to the same obligation (was: assert.equal(r.json().queued, 0)) for the same reason — the
  // dedup property is "this obligation is not queued twice", which is a statement about this row, not
  // about how many other rows in the database happen to be overdue today.
  assert.equal(await queuedCount(obligationId), 1, 'the same obligation is inside its 7-day window: still exactly one queued reminder');
});

test('DN · not-overdue, paid and void obligations are never reminded', async () => {
  const before = await commsCount();
  const future = await sql(`INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, status)
             VALUES ($1,$2,'Term 2','DN future', (now() AT TIME ZONE 'Asia/Kolkata')::date + 7, 100000, 'open') RETURNING id`, [tenantA, studentId]);
  const paid = await sql(`INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, paid_cents, status)
             VALUES ($1,$2,'Term 2','DN paid', (now() AT TIME ZONE 'Asia/Kolkata')::date - 5, 100000, 100000, 'paid') RETURNING id`, [tenantA, studentId]);
  const voided = await sql(`INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, status)
             VALUES ($1,$2,'Term 2','DN void', (now() AT TIME ZONE 'Asia/Kolkata')::date - 5, 100000, 'void') RETURNING id`, [tenantA, studentId]);
  const r = await run(ownerToken);
  assert.equal(r.statusCode, 200);
  // Scoped to the three fixtures (was: assert.equal(r.json().queued, 0) — a sweep-wide count that any
  // unrelated overdue obligation in the seeded corpus can break, and does from 2026-10-06 onwards).
  for (const [kind, res] of [['future', future], ['paid', paid], ['void', voided]]) {
    assert.equal(await queuedCount(res.rows[0].id), 0, `${kind} obligation is never reminded`);
  }
  const after = await commsCount();
  assert.equal(after, before, 'no FEE_REMINDER communication was written at all');
});

test('DN · obligations without a guardian phone are skipped, not silently dropped', async () => {
  const commsBefore = await commsCount();
  await sql(`UPDATE app.students SET guardian_phone=NULL WHERE id=$1`, [studentId]);
  const o = (await overdue('DN no-contact case', 75000)).rows[0];
  const r = await run(ownerToken);
  assert.equal(r.statusCode, 200);
  // Scoped to this test's own fixture (was: assert.equal(r.json().queued, 0) and
  // assert.equal(r.json().skippedNoContact, 1), both sweep-wide). Global `queued` is 0 today only because
  // no seeded obligation is overdue yet; from 2026-10-06 it is hundreds, and global `skippedNoContact`
  // counts every contact-less obligation in the database. The product property is: the sweep skipped THIS
  // contact-less overdue obligation and wrote nothing for it.
  //
  // Blinding the student's phone also blinds obligations earlier tests hung on the same student, so a
  // count of contact-less rows would not belong to this fixture. The sweep's own report does: the fixture
  // is the only OVERDUE contact-less obligation here (the seeded corpus is contact-less-free, and the
  // other DN fixtures on this student are either already contacted or not yet due), so the sweep must
  // report that it skipped exactly it.
  assert.equal(r.json().skippedNoContact, 1, 'the sweep found this contact-less overdue obligation and skipped it');
  assert.equal(r.json().queued, 0, 'and queued nothing for it');
  assert.equal(await commsCount(), commsBefore, 'no communication was written for the contact-less candidate');
  assert.equal(await queuedCount(o.id), 0, 'nothing at all under this obligation\'s dedup key');
  await sql(`UPDATE app.students SET guardian_phone='+919000006001' WHERE id=$1`, [studentId]);
});

test('DN · quiet hours from plugin settings (IST): sweep writes nothing inside the window', async () => {
  // quiet window straddling the current IST minute: start = now-1min, end = now+1min
  const cur = IST_MINUTES_NOW();
  await setQuiet({ start: hm(cur - 1), end: hm(cur + 1) });
  await overdue('DN quiet case', 25000);
  const r = await run(ownerToken);
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().queued, 0, 'nothing queued during quiet hours');
  assert.match(r.json().note, /quiet hours/);
  await setQuiet(awayWindow()); // restore: dunning writable again
});

test('DN · role gates: teacher refused; finance may run', async () => {
  const t = await app.inject({ method: 'POST', url: '/fees/dunning/run', payload: {}, headers: H(teacherToken) });
  assert.equal(t.statusCode, 403);
  const f = await app.inject({ method: 'POST', url: '/fees/dunning/run', payload: {}, headers: H(financeToken) });
  assert.equal(f.statusCode, 200);
});
