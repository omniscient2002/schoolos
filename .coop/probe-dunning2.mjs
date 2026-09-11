// One-shot dunning door probe (container-only): with away-window quiet hours set.
import pg from 'pg';
import { setupTestDb } from './tests/helpers.js';

await setupTestDb();
const sql = async (text, params = []) => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try { return await c.query(text, params); } finally { await c.end(); }
};
const tenantA = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
const sid = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 LIMIT 1`, [tenantA])).rows[0].id;
await sql(`UPDATE app.students SET guardian_phone='+919000006001' WHERE id=$1`, [sid]);

const nowM = (() => { const d = new Date(Date.now() + 5.5 * 3600 * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
const hm = (t) => { const x = ((t % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
await sql(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, enabled_at, enabled_by, settings)
           VALUES ($1,'comms.whatsapp','1.0.0','C','enabled','{}'::jsonb,'[]'::jsonb, now(), NULL, $2::jsonb)
           ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET settings = $2::jsonb`,
  [tenantA, JSON.stringify({ quiet_hours: { start: hm(nowM + 2), end: hm(nowM + 3) } })]);
console.log('settings:', JSON.stringify((await sql(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id='comms.whatsapp'`, [tenantA])).rows[0]?.settings));

await sql(`INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, status)
           VALUES ($1,$2,'Term 2','probe overdue', (now() AT TIME ZONE 'Asia/Kolkata')::date - 10, 150000, 'open')`, [tenantA, sid]);

const { buildApp } = await import('./src/app.js');
const app = await buildApp({ logger: { level: 'error' } });
await app.ready();
const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@meridian.edu', password: 'schoolos-demo' } });
const r = await app.inject({ method: 'POST', url: '/fees/dunning/run', payload: {}, headers: { authorization: `Bearer ${login.json().token}`, 'content-type': 'application/json' } });
console.log('DOOR:', r.statusCode, r.body.slice(0, 300));
await app.close();
process.exit(0);
