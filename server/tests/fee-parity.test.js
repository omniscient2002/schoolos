// P1 · dunning door↔worker parity — the HTTP door and the cron worker must select
// the SAME candidates from fee_settings (F-14): same overdue set, same ladder,
// same escalation Actions (kind exception). Wipe between runs, compare counts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app, sql, pool, owner, head, tenant;
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
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  owner = (await loginAs(app, 'owner@meridian.edu')).token;
  const fin = (await sql(`SELECT password_hash FROM app.users WHERE email='finance@meridian.edu'`)).rows[0];
  tenant = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  await sql(`INSERT INTO app.users (tenant_id,email,name,role,password_hash) VALUES ($1,'phead@meridian.edu','P Head','finance_head',$2) ON CONFLICT DO NOTHING`, [tenant, fin.password_hash]);
  head = (await loginAs(app, 'phead@meridian.edu')).token;
});
after(async () => { await pool?.end(); await app?.close(); });

const wipe = () => Promise.all([
  sql(`DELETE FROM app.communications WHERE tenant_id=$1 AND template LIKE 'FEE%'`, [tenant]),
  sql(`DELETE FROM app.fee_dunning_log WHERE tenant_id=$1`, [tenant]),
  sql(`DELETE FROM app.actions WHERE tenant_id=$1 AND code LIKE 'fee.overdue.%'`, [tenant]),
]);

test('PARITY · door and worker queue the same overdue set + escalation actions', async () => {
  // push seed dues out of the way so the fixture is exactly what we create
  await sql(`UPDATE app.fee_obligations SET due_on = (now() AT TIME ZONE 'Asia/Kolkata')::date + 3650
             WHERE tenant_id=$1 AND status IN ('open','partial')`, [tenant]);
  // ensure 3 students with guardian phones, dues 40d overdue (overdue + 30d escalation)
  const studs = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 3`, [tenant])).rows;
  for (const [i, s] of studs.entries()) {
    await sql(`UPDATE app.students SET guardian_phone=$2 WHERE id=$1`, [s.id, `+9198100000${i}`]);
    await sql(`INSERT INTO app.fee_obligations (tenant_id,student_id,term,label,amount_cents,due_on) VALUES ($1,$2,'PTY','parity due',100000,(now() AT TIME ZONE 'Asia/Kolkata')::date - 40)`, [tenant, s.id]);
  }
  await app.inject({ method: 'PUT', url: '/fees/settings', headers: H(head), payload: { dunning_before_due_days: [], dunning_escalation_days: [30], dunning_quiet_start: '00:00', dunning_quiet_end: '00:01' } });
  await wipe();
  const door = (await app.inject({ method: 'POST', url: '/fees/dunning/run', headers: H(head), payload: {} })).json();
  assert.ok(door.queued >= 3, `door queues our 3 overdue (got ${door.queued})`);
  assert.ok(door.escalated >= 3, `door escalates our 3 aged (got ${door.escalated})`);
  const doorActions = (await sql(`SELECT kind FROM app.actions WHERE tenant_id=$1 AND code LIKE 'fee.overdue.%'`, [tenant])).rows;
  assert.ok(doorActions.length >= 3 && doorActions.every((a) => a.kind === 'exception'), 'door escalation actions are kind=exception');
  await wipe();
  const { runDunning } = await import('../scripts/dunning-reminders.js');
  const rep = await runDunning({ q: (t, p) => pool.query(t, p), quiet: false });
  assert.equal(rep.queuedTotal, door.queued, `worker queues same overdue set as door (${rep.queuedTotal} vs ${door.queued})`);
  assert.equal(rep.escalatedTotal ?? 0, door.escalated, `worker escalates same set (${rep.escalatedTotal} vs ${door.escalated})`);
  const wActions = (await sql(`SELECT kind FROM app.actions WHERE tenant_id=$1 AND code LIKE 'fee.overdue.%'`, [tenant])).rows;
  assert.ok(wActions.length >= 3 && wActions.every((a) => a.kind === 'exception'), 'worker escalation actions are kind=exception too');
});

test('PARITY · worker reads the fee_settings ladder (not just the plugin)', async () => {
  await wipe();
  await sql(`UPDATE app.fee_obligations SET due_on = (now() AT TIME ZONE 'Asia/Kolkata')::date + 3650
             WHERE tenant_id=$1 AND status IN ('open','partial')`, [tenant]);
  const s = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tenant])).rows[0];
  await sql(`UPDATE app.students SET guardian_phone='+9198100099' WHERE id=$1`, [s.id]);
  await sql(`INSERT INTO app.fee_obligations (tenant_id,student_id,term,label,amount_cents,due_on) VALUES ($1,$2,'PTY','parity soon',50000,(now() AT TIME ZONE 'Asia/Kolkata')::date + 5)`, [tenant, s.id]);
  await app.inject({ method: 'PUT', url: '/fees/settings', headers: H(head), payload: { dunning_before_due_days: [5], dunning_escalation_days: [] } });
  const { runDunning } = await import('../scripts/dunning-reminders.js');
  const rep = await runDunning({ q: (t, p) => pool.query(t, p), quiet: false });
  const bd = (await sql(`SELECT count(*)::int n FROM app.fee_dunning_log WHERE tenant_id=$1 AND kind='before_due'`, [tenant])).rows[0].n;
  assert.ok(bd >= 1, `worker fired the fee_settings before-due offset (log rows: ${bd}, queued: ${rep.queuedTotal})`);
});
