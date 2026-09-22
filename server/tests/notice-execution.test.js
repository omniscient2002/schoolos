// PRD-17 · approving a parent notice recorded a DELIVERY that never happened.
//
// THE DEFECT: the decide executor's `kind:'message'` branch (`src/routes.js`) inserted the comms row
// directly as `status='delivered'` with `sent_at = now()` AND `delivered_at = now()`, emitted an event
// reading "Parent notice SENT", and returned `execution.status = 'delivered'`. Nothing was sent — there
// is no rail call and no queue entry anywhere in that path — and nothing ever could be: the dispatcher
// only claims `status='queued'`, so a row born `delivered` is unreachable for delivery for the rest of
// its life. The audience written was `[p.audience ?? 'guardians']`, a free-text LABEL ("guardians",
// "Route 7 guardians"), which is not something any dispatcher can resolve a recipient from.
//
// `delivered` is the strongest claim the schema makes — `sent` and `delivered` are separate values, and
// the dispatcher itself only ever sets `sent_at`, never `delivered_at`. So approving a fee circular told
// the approver, the timeline, the notices list and the action record that every guardian had it.
//
// WHAT IS PINNED HERE:
//   1. Approving a notice QUEUES it and claims nothing more. No `delivered`, no timestamps, and the
//      recipients are real E.164 numbers resolved from machine-readable identifiers.
//   2. The whole pipeline actually delivers it: one dispatcher pass over the queued row reaches EVERY
//      recipient (the fan-out fix), and still does not claim `delivered_at` for a sandbox carrier.
//   3. A notice whose recipients cannot be resolved is NOT recorded as sent in any form — no comms row
//      at all, `execution.status = 'unaddressed'`, and an event that says so. The approval still returns
//      200: the decision was the approver's to make (a pinned flow in `l1-security-sprint.test.js`).
//   4. The old "Parent notice SENT" label is gone in both directions.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';
import { toE164 } from '../src/plugins/_shared/phone.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let app;
let sql;
let tenantId;
let routeCode;
let proposerId;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const r = await c.query(text, params);
    await c.end();
    return r;
  };
  tenantId = (await sql(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  // OVR-4: every human raise now stamps a proposer; a principal approving a coordinator's notice is
  // a genuine second authority. Use a coordinator as the proposer so the SoD rule is not tripped.
  proposerId = (await sql(`SELECT id FROM app.users WHERE tenant_id=$1 AND role='coordinator' LIMIT 1`, [tenantId])).rows[0].id;
  // a bus route that actually has students with a reachable guardian
  routeCode = (await sql(`SELECT s.bus_route FROM app.students s JOIN app.guardians g ON g.student_id=s.id
    WHERE s.bus_route IS NOT NULL AND g.phone IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`)).rows[0].bus_route;
  assert.ok(routeCode, 'seed must have a bus route with guardians');
  // a sandbox rail for this tenant, so the dispatcher pass has something to log to
  await sql(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, settings)
             VALUES ($1,'rails.sms','1.0.0','B','enabled','{"provider":"logger"}'::jsonb)
             ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET settings='{"provider":"logger"}'::jsonb`, [tenantId]);
});

const raise = async (payload, code = `act_prd17_${Math.random().toString(36).slice(2, 8)}`) => (await sql(
  `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload)
   VALUES ($1,$2,'approval','Parent notice','draft','duty of care','normal','open','Principal','principal','Comms §1.2',false,'prd17',$3::jsonb) RETURNING id`,
  [tenantId, code, JSON.stringify({ ...payload, proposed_by: proposerId, proposed_by_role: 'coordinator' })])).rows[0].id;

const approve = async (id) => {
  const pr = await loginAs(app, 'principal@meridian.edu');
  return app.inject({ method: 'POST', url: `/actions/${id}/decide`, payload: { decision: 'approved', note: 'prd17' }, headers: H(pr.token) });
};

describe('PRD-17 · an approved notice is queued honestly, then really delivered', () => {
  let commId;

  test('approving QUEUES the notice with resolved E.164 recipients — it never claims delivery', async () => {
    // NOT template TRANSPORT_DELAY: an unattributed transport notice is deliberately refused to the
    // owning desk by the T105d segregation rule (a different, correct guard). The resolver keys on
    // routeCode, so a neutral template exercises the executor without colliding with that rule.
    const id = await raise({ kind: 'message', routeCode, audience: `Route ${routeCode} guardians`, channel: 'sms', template: 'ROUTE_NOTICE', draft: 'Bus delayed' });
    const r = await approve(id);
    assert.equal(r.statusCode, 200, r.body);
    const exec = r.json().execution;
    assert.equal(exec.status, 'queued', `the executor must queue, not declare delivery (got ${JSON.stringify(exec)})`);
    assert.ok(exec.recipients > 0, 'and must resolve actual recipients from the route roster');

    commId = exec.id;
    const comm = (await sql(
      `SELECT id, status, sent_at, delivered_at, audience_json, provider
         FROM app.communications WHERE id=$1`, [commId])).rows[0];
    // THE REGRESSION GATE: these three are the exact claims the old code made before anything was sent.
    assert.notEqual(comm.status, 'delivered', 'nothing has been delivered yet — no carrier has seen this row');
    assert.equal(comm.status, 'queued');
    assert.equal(comm.sent_at, null, 'sent_at must stay NULL until a carrier takes it');
    assert.equal(comm.delivered_at, null, 'and delivered_at is the strongest claim of all — never pre-stamped');
    // recipients are real addresses, not the label the payload used
    assert.ok(Array.isArray(comm.audience_json) && comm.audience_json.length > 1,
      `a route notice addresses the whole roster, got ${JSON.stringify(comm.audience_json)}`);
    for (const a of comm.audience_json) assert.equal(a, toE164(a), `${a} is not E.164`);
    assert.ok(!comm.audience_json.some((a) => /guardian/i.test(a)), 'a label is not an address');

    const ev = (await sql(`SELECT label FROM app.events WHERE type='comms' ORDER BY created_at DESC, ctid DESC LIMIT 1`)).rows[0];
    assert.match(ev.label, /QUEUED to \d+ guardians?/, 'the event states the hand-off, not a delivery');
    assert.ok(!/SENT/.test(ev.label), 'and never claims it was SENT');
  });

  test('one dispatcher pass reaches EVERY recipient and still does not claim delivery', async () => {
    const dispatcher = await import('../scripts/comms-dispatcher.js');
    const claimed = (await sql(
      `SELECT id, tenant_id, channel, template, body, audience_json, dedup_key, attempts
         FROM app.communications WHERE id=$1`, [commId])).rows[0];
    const expected = claimed.audience_json.length;

    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    let res;
    try {
      await c.query('BEGIN');
      res = await dispatcher.processClaimedRow(c, claimed, { allowSandbox: true });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }

    assert.equal(res.outcome, 'sent', JSON.stringify(res));
    const after = (await sql(`SELECT status, provider_ref, sent_at, delivered_at FROM app.communications WHERE id=$1`, [commId])).rows[0];
    assert.equal(after.status, 'sent');
    assert.match(after.provider_ref, new RegExp(`\\(${expected}/${expected} recipients\\)`),
      'the receipt itself states how many of how many were reached');
    assert.ok(after.sent_at, 'sent_at means "handed to the named provider"');
    assert.equal(after.delivered_at, null, 'a sandbox carrier never confirms delivery — this is the PRD-13 rule');
  });

  test('a notice with no resolvable recipients is recorded as UNSENT, not as delivered', async () => {
    // The exact shape the pinned clinic flow uses in l1-security-sprint: a bare 'guardians' label and a
    // non-uuid visit ref. Nothing can be resolved from it, so nothing may be claimed.
    const before = Number((await sql(`SELECT count(*)::int n FROM app.communications`)).rows[0].n);
    const id = await raise({ kind: 'message', visitId: 'l1-visit-ref', audience: 'guardians', channel: 'WhatsApp', template: 'CLINIC_SENT_HOME' }, `act_prd17_unaddressed_${Math.random().toString(36).slice(2, 6)}`);
    const r = await approve(id);
    // 200 on purpose: the decision is the approver's, and turning it into a 4xx would leave the action
    // open with no way to say why. The honesty lives in what gets RECORDED, not in refusing to decide.
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().execution.status, 'unaddressed');
    assert.equal(r.json().execution.recipients, 0);

    const after = Number((await sql(`SELECT count(*)::int n FROM app.communications`)).rows[0].n);
    assert.equal(after, before,
      'no comms row may be written at all — a row is delivery EVIDENCE and there is no delivery to evidence');
    const ev = (await sql(`SELECT label, severity FROM app.events WHERE type='comms' ORDER BY created_at DESC, ctid DESC LIMIT 1`)).rows[0];
    assert.match(ev.label, /NOT sent — no contactable recipients/);
    assert.equal(ev.severity, 'warn', 'and it is not filed as routine');
    assert.ok(!/Parent notice SENT/.test(ev.label),
      'the old blanket "Parent notice SENT" claim must be gone (the template NAME may still contain SENT)');
    const au = (await sql(`SELECT outcome FROM app.audit_log WHERE record_type='Action' ORDER BY created_at DESC, ctid DESC LIMIT 1`)).rows[0];
    assert.match(au.outcome, /communication unaddressed/, 'the audit names the outcome rather than a bare null id');
  });

  test('the clinic notice resolves the child\'s guardians once the raise carries the student', async () => {
    // health.clinic now stamps studentId into the payload (it always had it in scope), so the notice is
    // genuinely addressable instead of being a label — and it addresses the ONE child's guardians, never
    // the whole school.
    const studentId = (await sql(`SELECT s.id FROM app.students s JOIN app.guardians g ON g.student_id=s.id
      WHERE g.phone IS NOT NULL LIMIT 1`)).rows[0].id;
    const id = await raise({ kind: 'message', studentId, audience: 'guardians', channel: 'sms', template: 'CLINIC_SENT_HOME', draft: 'sent home' }, `act_prd17_clinic_${Math.random().toString(36).slice(2, 6)}`);
    const r = await approve(id);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().execution.status, 'queued');
    assert.equal(r.json().execution.recipients, 1, 'only that child\'s guardians — a label is not a selector');
    const comm = (await sql(`SELECT audience_json, status FROM app.communications ORDER BY created_at DESC LIMIT 1`)).rows[0];
    assert.equal(comm.status, 'queued');
    assert.equal(comm.audience_json.length, 1);
  });

  test('RTE-1 · a >500-recipient notice is refused AND the approval rolls back with it', async () => {
    // The guard ran after the status flip and used `return bad(...)`, which `withUser` COMMITS — so a
    // refused notice left the action marked approved with nothing queued and no way to retry. It must
    // return 413 and leave the action OPEN.
    const recipients = Array.from({ length: 501 }, (_, i) => `+9190000${String(i).padStart(5, '0')}`);
    const before = Number((await sql(`SELECT count(*)::int n FROM app.communications`)).rows[0].n);
    const id = await raise({ kind: 'message', audience: 'guardians', channel: 'sms', template: 'BIG_NOTICE', draft: 'too many', recipients }, `act_rte1_${Math.random().toString(36).slice(2, 8)}`);
    const r = await approve(id);
    assert.equal(r.statusCode, 413, r.body);
    const row = (await sql(`SELECT status FROM app.actions WHERE id=$1`, [id])).rows[0];
    assert.equal(row.status, 'open', 'a refused notice must not commit the approval');
    const after = Number((await sql(`SELECT count(*)::int n FROM app.communications`)).rows[0].n);
    assert.equal(after, before, 'and no comms row may be written');
  });

  test('the resolver is exported and resolves nothing from a label alone', async () => {
    const { resolveNoticeRecipients } = await import('../src/routes.js');
    assert.equal(typeof resolveNoticeRecipients, 'function');
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      for (const p of [{ audience: 'guardians' }, { audience: 'Route 7 guardians' }, { visitId: 'not-a-uuid' }, {}]) {
        assert.deepEqual(await resolveNoticeRecipients(c, tenantId, p), [],
          `${JSON.stringify(p)} describes an audience in words only — it must resolve to nobody, not to everyone`);
      }
      const viaRoute = await resolveNoticeRecipients(c, tenantId, { routeCode });
      assert.ok(viaRoute.length > 0, 'a route code does resolve');
      assert.equal(await resolveNoticeRecipients(c, tenantId, { recipients: ['9876500099'] }).then((r) => r[0]), '+919876500099',
        'explicit numbers are normalised to E.164 like every other door');
      assert.equal(await resolveNoticeRecipients(c, tenantId, { recipients: ['not-a-number'] }).then((r) => r.length), 0,
        'and an unusable number resolves to nobody rather than being sent into the void');
    } finally { await c.end(); }
  });
});
