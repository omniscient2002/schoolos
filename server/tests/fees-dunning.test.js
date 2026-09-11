// Fee dunning (Wave 3 · L1-3.2): overdue-obligation reminders queued as
// communications with 7-day dedup, quiet-hours respect (plugin settings, IST),
// no-contact skips, honest copy, and role gates.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app;
let sql;
let ownerToken, financeToken, teacherToken;
let tenantA, studentId;
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
  studentId = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tenantA])).rows[0].id;
  await sql(`UPDATE app.students SET guardian_phone='+919000006001' WHERE id=$1`, [studentId]); // deterministic contact
});
after(async () => { await app?.close(); });

// quiet-hours control: a window that NEVER contains "now" (now+2…now+3 min IST)
// so dunning tests are honest any time of day; the quiet-hours test overrides it.
const IST_MINUTES_NOW = () => { const d = new Date(Date.now() + 5.5 * 3600 * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hm = (total) => { const t = ((total % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const setQuiet = async (quiet) => {
  await sql(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, enabled_at, enabled_by, settings)
             VALUES ($1,'comms.whatsapp','1.0.0','C','enabled','{}'::jsonb,'[]'::jsonb, now(), NULL, $2::jsonb)
             ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET settings = $2::jsonb`,
  [tenantA, JSON.stringify({ quiet_hours: quiet })]);
};
const awayWindow = () => ({ start: hm(IST_MINUTES_NOW() + 2), end: hm(IST_MINUTES_NOW() + 3) });

const overdue = (label, cents, daysLate = 10, phone = '+919000006001') => sql(
  `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, status)
   VALUES ($1,$2,'Term 2',$3, (now() AT TIME ZONE 'Asia/Kolkata')::date - $4::int, $5, 'open') RETURNING id`,
  [tenantA, studentId, label, daysLate, cents]);

const run = (t) => app.inject({ method: 'POST', url: '/fees/dunning/run', payload: {}, headers: H(t) });
const queuedFor = async (obligationId) =>
  (await sql(`SELECT status, template, body, dedup_key, audience_json FROM app.communications WHERE dedup_key=$1`, [`dunning:${obligationId}`])).rows;

test('DN · overdue obligation → one queued reminder with honest copy and dedup key', async () => {
  await setQuiet(awayWindow()); // dunning must be writable now (not IST quiet hours)
  const o = (await overdue('DN overdue case', 150000)).rows[0];
  const r = await run(ownerToken);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().queued, 1);
  assert.equal(r.json().template, 'FEE_REMINDER');
  const cm = (await queuedFor(o.id))[0];
  assert.equal(cm.status, 'queued');
  assert.equal(cm.template, 'FEE_REMINDER');
  assert.deepEqual(cm.audience_json, ['+919000006001']);
  assert.match(cm.body, /Fee reminder/);
  assert.match(cm.body, /₹1500/);
  assert.match(cm.body, /If you have already paid/);
});

test('DN · 7-day dedup: immediate re-run queues nothing', async () => {
  const r = await run(financeToken);
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().queued, 0, 'the same obligation is inside its 7-day window');
});

test('DN · not-overdue, paid and void obligations are never reminded', async () => {
  const before = (await sql(`SELECT count(*)::int n FROM app.communications WHERE tenant_id=$1 AND template='FEE_REMINDER'`, [tenantA])).rows[0].n;
  await sql(`INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, status)
             VALUES ($1,$2,'Term 2','DN future', (now() AT TIME ZONE 'Asia/Kolkata')::date + 7, 100000, 'open')`, [tenantA, studentId]);
  await sql(`INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, paid_cents, status)
             VALUES ($1,$2,'Term 2','DN paid', (now() AT TIME ZONE 'Asia/Kolkata')::date - 5, 100000, 100000, 'paid')`, [tenantA, studentId]);
  await sql(`INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, status)
             VALUES ($1,$2,'Term 2','DN void', (now() AT TIME ZONE 'Asia/Kolkata')::date - 5, 100000, 'void')`, [tenantA, studentId]);
  const r = await run(ownerToken);
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().queued, 0);
  const after = (await sql(`SELECT count(*)::int n FROM app.communications WHERE tenant_id=$1 AND template='FEE_REMINDER'`, [tenantA])).rows[0].n;
  assert.equal(after, before);
});

test('DN · obligations without a guardian phone are skipped, not silently dropped', async () => {
  await sql(`UPDATE app.students SET guardian_phone=NULL WHERE id=$1`, [studentId]);
  await overdue('DN no-contact case', 75000);
  const r = await run(ownerToken);
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().queued, 0);
  assert.equal(r.json().skippedNoContact, 1, 'reported honestly');
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
