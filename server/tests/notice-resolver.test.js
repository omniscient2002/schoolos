// H2 — the shared notice resolver reaches app-onboarded families.
//
// `resolveNoticeRecipients` read only `app.guardians`, so a Route/class notice for students created by
// the app (who link a parent USER via `family.child_link`) resolved 0 recipients. This pins the union.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers.js';

let pool, resolveNoticeRecipients, tenantId, studentId, parentPhone;
before(async () => {
  await setupTestDb();
  ({ pool } = await import('../src/db.js'));
  ({ resolveNoticeRecipients } = await import('../src/routes.js'));
  tenantId = (await pool.query(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  parentPhone = '+919800000222';
  // a parent account with a phone, linked to a child via family.child_link — and NO app.guardians row.
  const parent = (await pool.query(
    `INSERT INTO app.users (tenant_id, email, name, role, password_hash, phone, active)
     VALUES ($1,'h2.parent@meridian.edu','H2 Parent','parent','x',$2,true) RETURNING id`,
    [tenantId, parentPhone])).rows[0];
  studentId = (await pool.query(
    `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, bus_route, status)
     VALUES ($1,'H2-ZZ','H2 Child','H2G','A','H2ZZ','active') RETURNING id`, [tenantId])).rows[0].id;
  await pool.query(
    `INSERT INTO family.child_link (tenant_id, user_id, student_id, relation, is_primary)
     VALUES ($1,$2,$3,'guardian',true)`, [tenantId, parent.id, studentId]);
  const g = (await pool.query(`SELECT count(*)::int n FROM app.guardians WHERE tenant_id=$1 AND student_id=$2`, [tenantId, studentId])).rows[0].n;
  assert.equal(g, 0, 'fixture: the child has NO app.guardians row');
});
after(async () => { await pool?.end().catch(() => {}); });

test('H2 · a route notice resolves the linked parent phone (no app.guardians row)', async () => {
  const phones = await resolveNoticeRecipients(pool, tenantId, { routeCode: 'H2ZZ' });
  assert.ok(phones.includes(parentPhone), `route audience must include the linked parent (got ${JSON.stringify(phones)})`);
});

test('H2 · a class audience resolves the linked parent phone', async () => {
  const phones = await resolveNoticeRecipients(pool, tenantId, { audienceKind: 'class', audienceRef: 'H2G' });
  assert.ok(phones.includes(parentPhone), `class audience must include the linked parent (got ${JSON.stringify(phones)})`);
});

test('H2 · an explicit studentId audience resolves the linked parent phone', async () => {
  const phones = await resolveNoticeRecipients(pool, tenantId, { studentId });
  assert.ok(phones.includes(parentPhone), `student audience must include the linked parent (got ${JSON.stringify(phones)})`);
});

// L5: the outbound all-guardians audience read only `app.guardians`, so a WhatsApp/SMS announcement
// reached nobody for app-onboarded families. It must use the same union.
test('L5 · an all_guardians audience resolves the linked parent phone', async () => {
  const phones = await resolveNoticeRecipients(pool, tenantId, { audienceKind: 'all_guardians' });
  assert.ok(phones.includes(parentPhone), `all_guardians audience must include the linked parent (got ${JSON.stringify(phones)})`);
});
