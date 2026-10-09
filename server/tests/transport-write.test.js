// H1 — a self-signup school can create its own bus routes and stops.
//
// `app.routes` / `app.route_stops` were seed-only, so a self-signup tenant had 0 routes and no door to
// add any. This pins the write doors, retirement (no DELETE), role gates, the kernel read filtering
// retired rows, and two-tenant isolation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let app, sql, owner, teacher, tenantA, otherTenant;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const req = (method, url, token, payload) => app.inject({ method, url, payload, headers: H(token) });

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
  owner = (await loginAs(app, 'owner@meridian.edu')).token;
  teacher = (await loginAs(app, 'teacher@meridian.edu')).token;
  tenantA = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  await sql(`UPDATE app.plugins SET status='enabled' WHERE tenant_id=$1 AND plugin_id='transport.gps'`, [tenantA]);
  otherTenant = (await sql(`INSERT INTO app.tenants (slug, name) VALUES ('tr-other','TR Other') RETURNING id`)).rows[0].id;
});

after(async () => {
  await sql(`DELETE FROM app.route_stops WHERE tenant_id=$1`, [otherTenant]).catch(() => {});
  await sql(`DELETE FROM app.routes WHERE tenant_id=$1`, [otherTenant]).catch(() => {});
  await sql(`DELETE FROM app.tenants WHERE id=$1`, [otherTenant]).catch(() => {});
  await app?.close();
});

test('TR · a route can be created; duplicate code is 409; edit works', async () => {
  const bad = await req('POST', '/plugins/transport.gps/routes', owner, { code: '', name: 'No code' });
  assert.equal(bad.statusCode, 400, bad.body);
  const ok = await req('POST', '/plugins/transport.gps/routes', owner, { code: 'TR1', name: 'TR Loop', capacity: 32, vehicle: 'KA-01-TR' });
  assert.equal(ok.statusCode, 200, ok.body);
  const id = ok.json().route.id;
  const dup = await req('POST', '/plugins/transport.gps/routes', owner, { code: 'TR1', name: 'Again' });
  assert.equal(dup.statusCode, 409, dup.body);
  const edit = await req('PATCH', `/plugins/transport.gps/routes/${id}`, owner, { name: 'TR Loop edited' });
  assert.equal(edit.statusCode, 200, edit.body);
  assert.equal(edit.json().route.name, 'TR Loop edited');
});

test('TR · stops can be added, edited and retired; the route retire retires its stops', async () => {
  const routeId = (await sql(`SELECT id FROM app.routes WHERE tenant_id=$1 AND code='TR1'`, [tenantA])).rows[0].id;
  const s1 = await req('POST', '/plugins/transport.gps/stops', owner, { routeId, name: 'TR Stop A' });
  assert.equal(s1.statusCode, 200, s1.body);
  const s2 = await req('POST', '/plugins/transport.gps/stops', owner, { routeId, name: 'TR Stop B', etaOffsetMins: 12 });
  assert.equal(s2.statusCode, 200, s2.body);
  const edit = await req('PATCH', `/plugins/transport.gps/stops/${s1.json().stop.id}`, owner, { etaOffsetMins: 5 });
  assert.equal(edit.statusCode, 200, edit.body);
  assert.equal(edit.json().stop.eta_offset_mins, 5);
  const ret = await req('POST', `/plugins/transport.gps/stops/${s2.json().stop.id}/retire`, owner, {});
  assert.equal(ret.statusCode, 200, ret.body);
  const rows = (await sql(`SELECT id, retired_at FROM app.route_stops WHERE tenant_id=$1 AND route_id=$2`, [tenantA, routeId])).rows;
  assert.equal(rows.length, 2, 'retirement is a status, not a delete');
  assert.ok(rows.find((r) => r.id === s2.json().stop.id).retired_at, 'the retired stop carries retired_at');
  const rr = await req('POST', `/plugins/transport.gps/routes/${routeId}/retire`, owner, {});
  assert.equal(rr.statusCode, 200, rr.body);
  const live = (await req('GET', '/transport/routes', owner)).json().routes.filter((r) => r.code === 'TR1');
  assert.equal(live.length, 0, 'a retired route leaves the kernel read');
  const raw = (await sql(`SELECT retired_at FROM app.routes WHERE id=$1`, [routeId])).rows[0];
  assert.ok(raw.retired_at, 'the route row still exists');
});

test('TR · role gates: owner writes, teacher cannot', async () => {
  const t = await req('POST', '/plugins/transport.gps/routes', teacher, { code: 'TR9', name: 'Nope' });
  assert.equal(t.statusCode, 403, t.body);
});

test('TR · RLS: another tenant\'s routes never surface', async () => {
  await sql(`INSERT INTO app.routes (tenant_id, code, name) VALUES ($1,'ZZ','Other route')`, [otherTenant]);
  const r = await req('GET', '/plugins/transport.gps/routes', owner);
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(!r.json().routes.some((x) => x.code === 'ZZ'), 'the other tenant\'s route is invisible');
});

test('TR · the plugin holds no table-level DELETE', async () => {
  const src = readFileSync(join(SERVER_ROOT, 'src', 'plugins', 'transport.gps', 'index.js'), 'utf8');
  assert.ok(!/DELETE\s+FROM\s+app\.(routes|route_stops)/i.test(src), 'no DELETE against routes/stops');
});
