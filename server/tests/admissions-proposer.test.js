// G1 — the admissions conversion is attributed to its raiser, so the named principal desk can decide.
//
// Without `proposed_by`, the decide door treated the raise as unattributed and refused the owning desk
// (`principal`) with "Ask the school owner to decide", escalating every enrolment to the owner.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import pg from 'pg';

let app, sql, owner, coordinator, principal, coordinatorId;
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
  owner = await loginAs(app, 'owner@meridian.edu');
  coordinator = await loginAs(app, 'coordinator@meridian.edu');
  principal = await loginAs(app, 'principal@meridian.edu');
  const en = await req('POST', '/plugins/admissions.funnel/enable', owner.token, { version: '1.0.0', class: 'C' });
  assert.ok([200, 409].includes(en.statusCode), `enable: ${en.body}`);
  coordinatorId = (await sql(`SELECT id FROM app.users WHERE email='coordinator@meridian.edu'`)).rows[0].id;
});

after(async () => { await app?.close(); });

test('G1 · a coordinator-raised conversion is approvable by the principal', async () => {
  const mk = await req('POST', '/plugins/admissions.funnel/leads', coordinator.token, {
    studentName: 'G1 Proposer', guardianName: 'G1 Guardian', guardianPhone: '+919000007001', classApplied: '6-A', source: 'walk-in',
  });
  assert.equal(mk.statusCode, 200, mk.body);
  const leadId = mk.json().leadId;
  for (const to of ['form', 'interaction', 'offer', 'enrolled']) {
    const st = await req('POST', `/plugins/admissions.funnel/leads/${leadId}/stage`, coordinator.token, { to });
    assert.equal(st.statusCode, 200, `${to}: ${st.body}`);
  }
  const act = (await sql(`SELECT id, payload FROM app.actions WHERE code=$1 AND status='open'`, [`students.create.${leadId}`])).rows[0];
  assert.ok(act, 'the conversion raised a students.create action');
  assert.equal(act.payload.proposed_by, coordinatorId, 'the raise is attributed to the coordinator (G1)');
  // The owning desk (principal) may now decide; without proposed_by this was a 403.
  const decide = await req('POST', `/actions/${act.id}/decide`, principal.token, { decision: 'approved', note: 'principal desk approves' });
  assert.equal(decide.statusCode, 200, decide.body);
  assert.equal(decide.json().execution.type, 'student');
});
