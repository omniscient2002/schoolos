// P2-9 · the case workspace had no door to read a case with.
//
// `app/src/screens/CaseDetail.tsx` opened a case from `domain.cases` — a reducer seeded at login —
// and `liveApi.apiCase()` pointed at `GET /cases/:id`, which the server never registered. So a case
// filed through the parent app could not be opened at all: the URL 404s and the screen falls back to
// the demo store's copy. This pins the door, its scope, and the parent rule.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app, sql, owner, teacher, parent, tenantId, caseId, parentCaseId, otherCaseId;
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
  tenantId = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;

  /* The guardian account is created through the product's own door rather than an INSERT with a fake
     hash, so the login path under test is the one a school actually uses. */
  const mk = await req('POST', '/plugins/people.admin/users', owner, {
    email: 'casews.parent@meridian.edu', name: 'Case WS Parent', role: 'parent', phone: '+919800009999',
  });
  assert.equal(mk.statusCode, 200, mk.body);
  const pUserId = mk.json().user.id;

  caseId = (await sql(
    `INSERT INTO app.cases (tenant_id, code, kind, title, detail, priority, status, owner, origin, opened_by, sla_due_at, linked_refs)
     VALUES ($1,'CASE-WS-1','complaint','Bus did not arrive','The 7:40 bus skipped my stop twice this week','high','open','Academic Coordinator','parent',$2, now() + interval '24 hours', '[{"label":"Route 7","ref":"/transport"}]'::jsonb)
     RETURNING id`, [tenantId, pUserId])).rows[0].id;
  parentCaseId = caseId;

  parent = (await loginAs(app, 'casews.parent@meridian.edu', mk.json().temporaryPassword)).token;

  otherCaseId = (await sql(
    `INSERT INTO app.cases (tenant_id, code, kind, title, priority, status, origin, opened_by)
     VALUES ($1,'CASE-WS-2','fee','Fee receipt not received','normal','open','staff',
             (SELECT id FROM app.users WHERE tenant_id=$1 AND role='teacher' ORDER BY id LIMIT 1))
     RETURNING id`,
    [tenantId])).rows[0].id;
});

after(async () => {
  await sql(`DELETE FROM app.cases WHERE tenant_id=$1 AND code LIKE 'CASE-WS-%'`, [tenantId]).catch(() => {});
  await sql(`DELETE FROM app.users WHERE tenant_id=$1 AND email='casews.parent@meridian.edu'`, [tenantId]).catch(() => {});
  await app?.close();
});

describe('GET /cases/:id — the case workspace reads the real record', () => {
  test('staff read any case, with every column the workspace renders', async () => {
    const r = await req('GET', `/cases/${caseId}`, owner);
    assert.equal(r.statusCode, 200, r.body);
    const c = r.json().case;
    assert.equal(c.code, 'CASE-WS-1');
    assert.equal(c.status, 'open');
    assert.equal(c.origin, 'parent');
    assert.ok(c.sla_due_at, 'the deadline the workspace counts down to is on the row');
    assert.equal(c.linked_refs?.[0]?.label, 'Route 7');
    const t = await req('GET', `/cases/${caseId}`, teacher);
    assert.equal(t.statusCode, 200, 'a teacher holds the case log, so a teacher may open a case');
  });

  test('a guardian reads the case they filed', async () => {
    const r = await req('GET', `/cases/${parentCaseId}`, parent);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().case.code, 'CASE-WS-1');
  });

  test("a guardian is refused another family's case, and told where to go", async () => {
    const r = await req('GET', `/cases/${otherCaseId}`, parent);
    assert.equal(r.statusCode, 403, r.body);
    assert.match(r.json().error, /my-cases/i);
  });

  test('an unknown id is a 404, not an empty case', async () => {
    const r = await req('GET', '/cases/00000000-0000-4000-8000-000000000000', owner);
    assert.equal(r.statusCode, 404, r.body);
  });

  test('a non-uuid id is refused before it reaches the database', async () => {
    const r = await req('GET', '/cases/not-a-uuid', owner);
    assert.ok([400, 404].includes(r.statusCode), r.body);
  });

  test("another tenant's case is invisible (RLS, not a filter someone has to remember)", async () => {
    const other = (await sql(`INSERT INTO app.tenants (slug, name) VALUES ('casews-other','Case WS Other') RETURNING id`)).rows[0].id;
    const foreignOwner = (await sql(
      `INSERT INTO app.users (tenant_id, email, name, role, password_hash, active)
       VALUES ($1,'casews.foreign@other.test','Foreign Owner','teacher','x',true) RETURNING id`, [other])).rows[0].id;
    const foreign = (await sql(
      `INSERT INTO app.cases (tenant_id, code, kind, title, priority, status, origin, opened_by)
       VALUES ($1,'CASE-WS-X','other','Foreign case','normal','open','staff',$2) RETURNING id`, [other, foreignOwner])).rows[0].id;
    const r = await req('GET', `/cases/${foreign}`, owner);
    assert.equal(r.statusCode, 404, r.body);
    await sql(`DELETE FROM app.cases WHERE id=$1`, [foreign]).catch(() => {});
    await sql(`DELETE FROM app.users WHERE id=$1`, [foreignOwner]).catch(() => {});
    await sql(`DELETE FROM app.tenants WHERE id=$1`, [other]).catch(() => {});
  });

  test('the status move is the server\u2019s: it writes the row and the ledger', async () => {
    const r = await req('POST', `/cases/${otherCaseId}/status`, owner, { to: 'in-progress' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().case.status, 'in-progress');
    const row = (await sql(`SELECT status FROM app.cases WHERE id=$1`, [otherCaseId])).rows[0];
    assert.equal(row.status, 'in-progress', 'the write reached the database, not the browser');
    const audit = await sql(
      `SELECT count(*)::int n FROM app.audit_log WHERE tenant_id=$1 AND record_ref='CASE-WS-2' AND action LIKE 'Case →%'`,
      [tenantId]);
    assert.ok(audit.rows[0].n >= 1, 'the status change is in the audit ledger');
  });
});