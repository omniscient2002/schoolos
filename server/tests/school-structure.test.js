// F3 — the normalized school structure (classes, sections, subjects).
//
// The audit found class structure lived only in tenant-config JSONB and subjects were free text. This
// pins the real tables: the `/school/classes` door keeps them in step (retiring by `active`, never a
// DELETE), subjects are a first-class list, the composite FK refuses a cross-tenant section, and the
// app role still holds no DELETE.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

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
  otherTenant = (await sql(`INSERT INTO app.tenants (slug, name) VALUES ('ss-other','SS Other') RETURNING id`)).rows[0].id;
});

after(async () => {
  await sql(`DELETE FROM app.sections WHERE tenant_id=$1`, [otherTenant]).catch(() => {});
  await sql(`DELETE FROM app.classes WHERE tenant_id=$1`, [otherTenant]).catch(() => {});
  await sql(`DELETE FROM app.subjects WHERE tenant_id=$1`, [otherTenant]).catch(() => {});
  await sql(`DELETE FROM app.tenants WHERE id=$1`, [otherTenant]).catch(() => {});
  await app?.close();
});

test('SS · saving classes syncs the normalized tables', async () => {
  const r = await req('PUT', '/school/classes', owner, { classes: [{ grade: 'SS-6', sections: ['A', 'B'] }, { grade: 'SS-7', sections: [] }] });
  assert.equal(r.statusCode, 200, r.body);
  const cls = (await sql(`SELECT name, active FROM app.classes WHERE tenant_id=$1 AND name LIKE 'SS-%' ORDER BY name`, [tenantA])).rows;
  assert.deepEqual(cls.map(c => c.name), ['SS-6', 'SS-7']);
  assert.ok(cls.every(c => c.active));
  const secs = (await sql(`SELECT s.name FROM app.sections s JOIN app.classes c ON c.id=s.class_id
                             WHERE s.tenant_id=$1 AND c.name='SS-6' ORDER BY s.name`, [tenantA])).rows;
  assert.deepEqual(secs.map(s => s.name), ['A', 'B']);
});

test('SS · dropping a class retires it (active=false), never deletes it', async () => {
  await req('PUT', '/school/classes', owner, { classes: [{ grade: 'SS-6', sections: ['A'] }] });
  const gone = (await sql(`SELECT active FROM app.classes WHERE tenant_id=$1 AND name='SS-7'`, [tenantA])).rows[0];
  assert.equal(gone.active, false, 'SS-7 was retired');
  const still = (await sql(`SELECT count(*)::int AS n FROM app.classes WHERE tenant_id=$1 AND name='SS-7'`, [tenantA])).rows[0].n;
  assert.equal(still, 1, 'the row still exists — retirement is a status, not a delete');
  const secB = (await sql(`SELECT s.active FROM app.sections s JOIN app.classes c ON c.id=s.class_id
                            WHERE s.tenant_id=$1 AND c.name='SS-6' AND s.name='B'`, [tenantA])).rows[0];
  assert.equal(secB.active, false, 'section B was retired');
});

test('SS · subjects are first-class and idempotent', async () => {
  const add = await req('POST', '/school/subjects', owner, { name: 'SS Mathematics' });
  assert.equal(add.statusCode, 200, add.body);
  const again = await req('POST', '/school/subjects', owner, { name: 'SS Mathematics' });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.json().subject.name, 'SS Mathematics');
  const list = await req('GET', '/school/subjects', owner);
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().subjects.filter(s => s.name === 'SS Mathematics').length, 1, 'no duplicate subject');
});

test('SS · only the structure authority may write; teachers may read', async () => {
  const t = await req('POST', '/school/subjects', teacher, { name: 'SS Nope' });
  assert.equal(t.statusCode, 403, t.body);
  const t2 = await req('PUT', '/school/classes', teacher, { classes: [] });
  assert.equal(t2.statusCode, 403, t2.body);
  const read = await req('GET', '/school/subjects', teacher);
  assert.equal(read.statusCode, 200, read.body);
});

test('SS · a cross-tenant section is refused by the composite FK', async () => {
  const otherClass = (await sql(
    `INSERT INTO app.classes (tenant_id, name) VALUES ($1,'SS Other Class') RETURNING id`, [otherTenant])).rows[0].id;
  await assert.rejects(
    () => sql(`INSERT INTO app.sections (tenant_id, class_id, name) VALUES ($1,$2,'X')`, [tenantA, otherClass]),
    /foreign key/i,
    'a Meridian section cannot reference another tenant\'s class');
});

test('SS · the app role holds no DELETE on the structure tables', async () => {
  const r = await sql(`SELECT table_schema||'.'||table_name AS t, privilege_type
                         FROM information_schema.role_table_grants
                        WHERE grantee='schoolos_app' AND table_name IN ('classes','sections','subjects')
                          AND table_schema='app' AND privilege_type='DELETE'`);
  assert.equal(r.rows.length, 0, 'no DELETE grant (D-35)');
});
