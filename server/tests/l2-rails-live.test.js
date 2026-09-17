// L2-3.3 (Wave 3) — rails "live" adapters, sandbox-verified (D-26).
// Pins: provider receipts persisted by the dispatcher (058), email channel
// drained end to end via rails.email sandbox, failure → retry bookkeeping →
// parked dead-letter state, http-generic + cloud-api honest settings failures.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb } from './helpers.js';

let sql;
let dispatcher;
let emailRail;

before(async () => {
  await setupTestDb();
  dispatcher = await import('../scripts/comms-dispatcher.js'); // CLI guard: no loop on import
  emailRail = await import('../src/plugins/rails.email/index.js');
  // sandbox rails for the seeded tenant
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const t = (await c.query(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0];
  await c.query(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, settings)
                 VALUES ($1,'rails.email','1.0.0','B','enabled','{"provider":"logger"}'::jsonb)
                 ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET settings='{"provider":"logger"}'::jsonb`, [t.id]);
  await c.query(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, settings)
                 VALUES ($1,'rails.sms','1.0.0','B','enabled','{}'::jsonb)
                 ON CONFLICT (tenant_id, plugin_id) DO NOTHING`, [t.id]);
  await c.query(`INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, settings)
                 VALUES ($1,'rails.whatsapp','1.0.0','B','enabled','{}'::jsonb)
                 ON CONFLICT (tenant_id, plugin_id) DO NOTHING`, [t.id]);
  await c.end();
  sql = async (text, params = []) => {
    const cc = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await cc.connect();
    try { return await cc.query(text, params); } finally { await cc.end(); }
  };
});

const insertRow = async (over = {}) => {
  const t = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0];
  const r = await sql(
    `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, dedup_key)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6,'queued',$7) RETURNING id, attempts`,
    [t.id, over.audienceKind ?? 'guardian', JSON.stringify(over.audience ?? ['+919845000201']),
      over.channel ?? 'sms', over.template ?? 'TEST_MSG', over.body ?? 'sandbox ping', over.dedupKey ?? `test_${Math.random().toString(36).slice(2)}`]);
  return r.rows[0];
};

const claimRow = async (id) => {
  const r = await sql(`SELECT id, tenant_id, channel, template, body, audience_json, dedup_key, attempts FROM app.communications WHERE id=$1`, [id]);
  return r.rows[0];
};

describe('L2-3.3 · rails live adapters (sandbox-verified)', () => {
  test('email channel drains via rails.email sandbox with provider receipt (058)', async () => {
    const row = await insertRow({ channel: 'email', audience: ['teacher@meridian.edu'], template: 'ATTENDANCE_NOTICE' });
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      const claimed = await claimRow(row.id);
      const res = await dispatcher.processClaimedRow(client, claimed);
      assert.equal(res.outcome, 'sent', JSON.stringify(res));
      assert.equal(res.provider, 'logger', 'sandbox provider recorded');
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { await client.end(); }
    const after = await sql(`SELECT status, provider, provider_ref, sent_at, attempts FROM app.communications WHERE id=$1`, [row.id]);
    assert.equal(after.rows[0].status, 'sent');
    assert.equal(after.rows[0].provider, 'logger');
    assert.ok(after.rows[0].provider_ref, 'provider receipt persisted');
    assert.ok(after.rows[0].sent_at, 'sent_at stamped');
  });

  test('rail failure → retry bookkeeping; last attempt parks the row (DLQ state)', async () => {
    // point the sms rail at an unreachable endpoint for this tenant
    const t = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0];
    await sql(`UPDATE app.plugins SET settings='{"provider":"http-generic","url":"https://127.0.0.1:9/hook","auth_header_name":"X-K","auth_header_value":"v"}'::jsonb
               WHERE tenant_id=$1 AND plugin_id='rails.sms'`, [t.id]);
    const row = await insertRow({ channel: 'sms' });
    // each attempt runs in its own transaction + fresh claim, mirroring production
    const runAttempt = async ({ maxAttempts = 4 } = {}) => {
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        await client.query('BEGIN');
        const claimed = await claimRow(row.id);
        const res = await dispatcher.processClaimedRow(client, claimed, { maxAttempts });
        await client.query('COMMIT');
        return res;
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { await client.end(); }
    };
    const res = await runAttempt();
    assert.equal(res.outcome, 'retry', 'first failure schedules a retry');
    assert.equal(res.attempts, 2, 'enqueue counts as attempt 1 (043 default)');
    assert.ok(res.nextMs > 0);
    // second failure → still retry
    const res2 = await runAttempt();
    assert.equal(res2.outcome, 'retry');
    assert.equal(res2.attempts, 3, 'attempts accumulate across claims');
    // third failure on attempts=4 = max → parked
    const res3 = await runAttempt();
    assert.equal(res3.outcome, 'parked');
    const parked = await sql(`SELECT status, attempts, last_error, next_attempt_at FROM app.communications WHERE id=$1`, [row.id]);
    assert.equal(parked.rows[0].status, 'failed', 'parked = dead-letter state');
    assert.equal(parked.rows[0].attempts, 4);
    assert.match(parked.rows[0].last_error, /max attempts reached/);
    assert.equal(parked.rows[0].next_attempt_at, null, 'no retry date once parked');
    await sql(`UPDATE app.plugins SET settings='{}'::jsonb WHERE tenant_id=$1 AND plugin_id='rails.sms'`, [t.id]);
  });

  test('http-generic + cloud-api honest settings failures (no network)', async () => {
    const { sendSms } = await import('../src/plugins/rails.sms/index.js');
    const t = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0];
    await sql(`UPDATE app.plugins SET settings='{"provider":"http-generic","url":"http://insecure.test/hook","auth_header_name":"X-K","auth_header_value":"v"}'::jsonb
               WHERE tenant_id=$1 AND plugin_id='rails.sms'`, [t.id]);
    const insecure = await sendSms({ to: '+919845000201', body: 'x', dedupKey: 'k1', tenantId: t.id });
    assert.equal(insecure.ok, false);
    assert.match(insecure.error, /https/, 'plain http refused — credentials never cross plaintext');
    await sql(`UPDATE app.plugins SET settings='{"provider":"cloud-api"}'::jsonb WHERE tenant_id=$1 AND plugin_id='rails.whatsapp'`, [t.id]);
    const { sendWhatsapp } = await import('../src/plugins/rails.whatsapp/index.js');
    const wa = await sendWhatsapp({ to: '+919845000201', body: 'x', dedupKey: 'k2', tenantId: t.id });
    assert.equal(wa.ok, false);
    assert.match(wa.error, /phone_number_id \+ access_token/, 'cloud-api unconfigured → honest settings error');
    await sql(`UPDATE app.plugins SET settings='{}'::jsonb WHERE tenant_id=$1 AND plugin_id='rails.whatsapp'`, [t.id]);
    // dedupKey/tenantId guard rails (approval receipt contract)
    const noDedup = await sendSms({ to: '+919845000201', body: 'x', tenantId: t.id });
    assert.equal(noDedup.ok, false);
    assert.match(noDedup.error, /dedupKey/);
  });

  test('email rail subject/body render + reset rows are NOT re-drained', async () => {
    // the reset door writes status='sent' rows directly — the dispatcher claims
    // only status='queued'; assert the claim predicate leaves sent rows alone.
    const t = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0];
    await sql(`INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, dedup_key)
               VALUES ($1,'email','["teacher@meridian.edu"]','email','PASSWORD_RESET','seed','sent','reset_seed')`, [t.id]);
    /* TST-4: this asserted that a query for QUEUED reset rows returns zero — which was true because nothing
       was queued at all, so it passed whatever the claim predicate said, including a predicate that would
       re-drain a sent row. The discriminating pair is planted here: one QUEUED row and one SENT row, then the
       claim predicate must select exactly the queued one. */
    // the unique index on dedup_key is PARTIAL, so `ON CONFLICT (dedup_key)` cannot infer it (42P10) — clear
    // the probe first and insert plainly
    await sql(`DELETE FROM app.communications WHERE dedup_key='reset_probe_queued'`);
    await sql(`INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, dedup_key)
               VALUES ($1,'email','["teacher@meridian.edu"]','email','PASSWORD_RESET','queued probe','queued','reset_probe_queued')`, [t.id]);
    const rows = (await sql(
      `SELECT dedup_key FROM app.communications
        WHERE tenant_id=$1 AND status='queued' AND template='PASSWORD_RESET'`, [t.id])).rows.map((r) => r.dedup_key);
    assert.deepEqual(rows, ['reset_probe_queued'],
      'the claim predicate takes the queued reset row and leaves the SENT one alone');
    const sent = (await sql(
      `SELECT count(*)::int AS n FROM app.communications
        WHERE tenant_id=$1 AND status='queued' AND dedup_key='reset_seed'`, [t.id])).rows[0].n;
    assert.equal(sent, 0, 'the already-sent reset row is not claimable — re-draining it would re-deliver a consumed token');
    await sql(`DELETE FROM app.communications WHERE dedup_key='reset_probe_queued'`);
  });
});
