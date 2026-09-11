// Diagnostic: stage-rows 500 trace + custom-roles door state (container-only).
import pg from 'pg';
import { setupTestDb, loginAs } from './tests/helpers.js';

await setupTestDb();
const sql = async (text, params = []) => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try { return await c.query(text, params); } finally { await c.end(); }
};
const { buildApp } = await import('./src/app.js');
const app = await buildApp({ logger: { level: 'error' } });
await app.ready();
const ownerToken = (await loginAs(app, 'owner@meridian.edu')).token;
const H = { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' };

const mk = await app.inject({ method: 'POST', url: '/migration/sources', payload: { name: 'probe src', kind: 'csv' }, headers: H });
console.log('source:', mk.statusCode);
const r = await app.inject({ method: 'POST', url: `/migration/sources/${mk.json().source.id}/stage-rows`, payload: { rows: [{ rowNo: 1, data: { name: 'Probe Kid', grade: '6', section: 'B' } }] }, headers: H });
console.log('STAGE-ROWS:', r.statusCode, r.body.slice(0, 200));

const cr = await app.inject({ method: 'GET', url: '/roles', headers: H });
console.log('ROLES GET:', cr.statusCode, cr.body.slice(0, 160));

await app.close();
process.exit(0);
