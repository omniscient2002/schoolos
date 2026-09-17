// FEX-16 — the highest-consequence teacher.support flows had no test: the doubt answer/promote workflow
// and the intervention plan lifecycle. Role gates + audit rows are asserted, not just the happy path.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
let app; let sql; let tenantId; let student; let coordinator; let parent;

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
  tenantId = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  await sql(`UPDATE app.plugins SET status='enabled', updated_at=now() WHERE tenant_id=$1 AND plugin_id='teacher.support'`, [tenantId]);
  student = await loginAs(app, 'student@meridian.edu');
  coordinator = await loginAs(app, 'coordinator@meridian.edu');
  parent = await loginAs(app, 'parent@meridian.edu');
});

after(async () => { await app?.close(); });

describe('FEX-16 · teacher.support doubt + intervention lifecycle', () => {
  test('a student doubt is answered, promoted to a class FAQ exactly once, and audited', async () => {
    const ask = await app.inject({ method: 'POST', url: '/plugins/teacher.support/doubt', payload: { subject: 'Mathematics', question: 'Why is 0! = 1?' }, headers: H(student.token) });
    assert.equal(ask.statusCode, 200, ask.body);
    const id = ask.json().doubtId;
    const ans = await app.inject({ method: 'POST', url: `/teacher/support/doubts/${id}/answer`, payload: { answer: 'By convention the empty product is 1.' }, headers: H(coordinator.token) });
    assert.equal(ans.statusCode, 200, ans.body);
    const promote = await app.inject({ method: 'POST', url: `/teacher/support/doubts/${id}/promote-faq`, payload: {}, headers: H(coordinator.token) });
    assert.equal(promote.statusCode, 200, promote.body);
    const again = await app.inject({ method: 'POST', url: `/teacher/support/doubts/${id}/promote-faq`, payload: {}, headers: H(coordinator.token) });
    assert.equal(again.statusCode, 409, 'a doubt becomes a FAQ once');
    const aud = (await sql(`SELECT count(*)::int n FROM app.audit_log WHERE record_type IN ('SupportDoubt','SupportFaq')`)).rows[0].n;
    assert.ok(aud >= 3, 'route + answer + promote are all audited');
  });

  test('an unanswered doubt cannot be promoted; a parent cannot answer or promote', async () => {
    const ask = await app.inject({ method: 'POST', url: '/plugins/teacher.support/doubt', payload: { subject: 'Science', question: 'What is photosynthesis?' }, headers: H(student.token) });
    assert.equal(ask.statusCode, 200, ask.body);
    const id = ask.json().doubtId;
    assert.equal((await app.inject({ method: 'POST', url: `/teacher/support/doubts/${id}/promote-faq`, payload: {}, headers: H(coordinator.token) })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: `/teacher/support/doubts/${id}/answer`, payload: { answer: 'x' }, headers: H(parent.token) })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: `/teacher/support/doubts/${id}/promote-faq`, payload: {}, headers: H(parent.token) })).statusCode, 403);
  });

  test('an intervention plan follows the append-only state machine', async () => {
    const studentId = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tenantId])).rows[0].id;
    const create = await app.inject({ method: 'POST', url: '/interventions', payload: { studentId, objective: 'Improve reading fluency', activity: 'Daily 15-min guided reading' }, headers: H(coordinator.token) });
    assert.equal(create.statusCode, 200, create.body);
    const id = create.json().planId;
    // identified -> improved is not an edge in the machine
    assert.equal((await app.inject({ method: 'POST', url: `/interventions/${id}/transition`, payload: { to: 'improved' }, headers: H(coordinator.token) })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: `/interventions/${id}/transition`, payload: { to: 'planned' }, headers: H(coordinator.token) })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: `/interventions/${id}/transition`, payload: { to: 'in_progress' }, headers: H(parent.token) })).statusCode, 403);
    const events = (await sql(`SELECT count(*)::int n FROM intervention.plan_event WHERE plan_id=$1`, [id])).rows[0].n;
    assert.equal(events, 2, 'creation + one transition = two append-only history rows');
  });
});
