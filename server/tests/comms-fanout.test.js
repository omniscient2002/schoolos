// FEX-14 — the multi-recipient fan-out and the per-row recipient cap.
//
// THE DEFECT (PERFECT-100 §9.2 FEX-14). PRD-13 replaced the single-address shortcut with a real fan-out
// (`recipientsOf` / `fanOut`) and a refusal cap (`MAX_RECIPIENTS`), because `recipientOf` marked a
// 300-guardian notice 'sent' after reaching exactly one person. The replacement shipped with NO test: the
// only comms tests drive a single-recipient audience, so deleting the fan-out loop would keep the suite
// green. This file closes that gap with the register's two required behaviours:
//   1. an over-cap audience is REFUSED (nothing sent), not truncated and reported as complete;
//   2. a partial delivery is not a success — it reports `ok:false` and how many of how many arrived.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb } from './helpers.js';

describe('FEX-14 · the dispatcher fans out to the whole audience and refuses an over-cap one', () => {
  // ---- pure unit half: no DB, injected rail ----

  test('recipientsOf normalises, de-duplicates and drops unusable entries', async () => {
    const { recipientsOf } = await import('../scripts/comms-dispatcher.js');
    const got = recipientsOf({
      audience_json: [
        '+919845000301',
        '9845000302',                 // bare 10-digit → +91…
        { phone: '+919845000301' },   // duplicate of the first after normalisation
        { mobile: '+919845000303' },
        'not-a-phone',
        null,
        { to: '+919845000304' },
      ],
    });
    assert.deepEqual(got, ['+919845000301', '+919845000302', '+919845000303', '+919845000304'],
      'one entry per usable number, de-duplicated AFTER normalisation');
  });

  test('the per-row cap is a refusal threshold, not a truncation point', async () => {
    const { overRecipientCap } = await import('../scripts/comms-dispatcher.js');
    assert.equal(overRecipientCap({ audience_json: Array(500).fill('+919845000301') }), false,
      'exactly the cap is still allowed');
    assert.equal(overRecipientCap({ audience_json: Array(501).fill('+919845000301') }), true,
      'one over the cap must be refused, not silently trimmed');
  });

  test('fanOut reports partial delivery honestly instead of calling it sent', async () => {
    const { fanOut } = await import('../scripts/comms-dispatcher.js');
    const seen = [];
    const allOk = await fanOut(
      async (to) => { seen.push(to); return { ok: true, provider: 'fake', ref: `r_${to}` }; },
      ['+919845000301', '+919845000302', '+919845000303'], 'recipients');
    assert.equal(allOk.ok, true);
    assert.equal(seen.length, 3, 'every recipient was handed to the rail');
    assert.equal(allOk.sentCount, 3);
    assert.equal(allOk.totalCount, 3);
    assert.match(allOk.ref, /3\/3 recipients/, 'the receipt names how many of how many arrived');

    const partial = await fanOut(
      async (to) => (to === '+919845000302'
        ? { ok: false, error: 'carrier rejected number' }
        : { ok: true, provider: 'fake', ref: `r_${to}` }),
      ['+919845000301', '+919845000302', '+919845000303'], 'recipients');
    // THE REGRESSION GATE for the PRD-13 lie: a broadcast that reached 2 of 3 must NOT read ok:true.
    assert.equal(partial.ok, false, 'a half-delivered broadcast is not a success');
    assert.equal(partial.sentCount, 2);
    assert.equal(partial.totalCount, 3);
    assert.match(partial.error, /2 of 3 recipients delivered/);
    assert.match(partial.error, /carrier rejected number/, 'the first real failure is preserved for the operator');
  });

  test('an empty audience yields a failure, never a fabricated ok', async () => {
    const { fanOut } = await import('../scripts/comms-dispatcher.js');
    const none = await fanOut(async () => ({ ok: true, provider: 'fake' }), [], 'recipients');
    assert.equal(none.ok, false, 'zero recipients cannot be "sent"');
    assert.equal(none.sentCount, 0);
    assert.equal(none.totalCount, 0);
  });

  // ---- behavioural half: the real dispatcher against a real queued row ----

  let app;
  let sql;
  let tenantId;

  before(async () => {
    await setupTestDb();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();
    const { pool } = await import('../src/db.js');
    sql = (t, p = []) => pool.query(t, p);
    tenantId = (await sql(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
    // a sandbox SMS rail for this tenant (logger provider), so a real fan-out can run without a carrier
    await sql(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, settings)
               VALUES ($1,'rails.sms','1.0.0','B','enabled','{"provider":"logger"}'::jsonb)
               ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET settings='{"provider":"logger"}'::jsonb`,
      [tenantId]);
  });
  after(async () => { await app?.close(); });

  const queueRow = async (audience) => (await sql(
    `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, dedup_key, attempts)
     VALUES ($1,'guardian',$2::jsonb,'sms','FEX14','fan-out probe','queued',$3,0)
     RETURNING id, tenant_id, channel, template, body, audience_json, dedup_key, attempts`,
    [tenantId, JSON.stringify(audience), `fex14_${Math.random().toString(36).slice(2)}`])).rows[0];

  const claim = async (id) => (await sql(
    `SELECT id, tenant_id, channel, template, body, audience_json, dedup_key, attempts
       FROM app.communications WHERE id=$1`, [id])).rows[0];

  const run = async (row, opts) => {
    const dispatch = await import('../scripts/comms-dispatcher.js');
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      const res = await dispatch.processClaimedRow(c, row, opts);
      await c.query('COMMIT');
      return res;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
  };

  test('a 300-guardian notice reaches all 300 and the receipt says so', async () => {
    const audience = Array.from({ length: 300 }, (_, i) => `+9198${String(45000000 + i).padStart(8, '0')}`);
    const row = await queueRow(audience);
    const res = await run(await claim(row.id), { allowSandbox: true });
    assert.equal(res.outcome, 'sent', JSON.stringify(res));
    const after = (await sql(`SELECT status, provider_ref FROM app.communications WHERE id=$1`, [row.id])).rows[0];
    assert.equal(after.status, 'sent');
    assert.match(String(after.provider_ref), /300\/300 recipients/,
      'THE REGRESSION GATE: the old single-recipient shortcut recorded one delivery for a 300-guardian notice');
  });

  test('a 501-guardian notice is refused up front — nothing is sent and the reason is on the row', async () => {
    const audience = Array.from({ length: 501 }, (_, i) => `+9197${String(45000000 + i).padStart(8, '0')}`);
    const row = await queueRow(audience);
    const res = await run(await claim(row.id), { allowSandbox: true });
    assert.notEqual(res.outcome, 'sent', 'an over-cap audience must never report success');
    assert.match(String(res.error), /exceeds the per-row cap/);
    const after = (await sql(`SELECT status, sent_at, last_error FROM app.communications WHERE id=$1`, [row.id])).rows[0];
    assert.equal(after.sent_at, null, 'nothing was handed to a carrier');
    assert.match(after.last_error, /exceeds the per-row cap/);
  });
});
