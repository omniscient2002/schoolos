// PLG-7 (PERFECT-100 §5.3) — per-plugin AI budgets actually apply.
//
// THE DEFECT, in two halves: the gateway read the cap from key `calls`, while the catalog wrote
// `requests_per_day` and the migrations wrote `calls_per_day` — so the cap was ALWAYS null and only the
// tenant-wide daily cap (200) ever applied; and even a matched POSITIVE cap was never enforced (only `0` was).
// This file pins all three spellings, the numeric form, `false`/0 disable, and the positive cap actually
// refusing the (n+1)th call in the month.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, loginAs } from './helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const PLUGIN = 'library';

let app; let pool; let staff; let tenantId;
const setBudget = (budget) => pool.query(
  `UPDATE app.plugins SET ai_budget=$3::jsonb WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, PLUGIN, JSON.stringify(budget)]);
const clearCalls = () => pool.query(
  `DELETE FROM app.ai_calls WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, PLUGIN]);
const aiCall = () => app.inject({ method: 'POST', url: '/ai/call', headers: H(staff.token), payload: { pluginId: PLUGIN, purpose: 'test', input: 'hello' } });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  staff = await loginAs(app, 'itadmin@meridian.edu');
  tenantId = (await pool.query(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  const row = await pool.query(`SELECT 1 FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, PLUGIN]);
  assert.equal(row.rowCount, 1, `fixture: ${PLUGIN} must have a registry row`);
  await clearCalls();
});
after(async () => { await app?.close(); });

describe('PLG-7 · per-plugin AI budget', () => {
  for (const budget of [{ calls: 0 }, { calls_per_day: 0 }, { requests_per_day: 0 }, 0, false]) {
    test(`a zero cap disables AI for the plugin — ${JSON.stringify(budget)}`, async () => {
      await setBudget(budget);
      const r = await aiCall();
      assert.equal(r.statusCode, 429, `expected 429 for ${JSON.stringify(budget)}, got ${r.statusCode}: ${String(r.body).slice(0, 120)}`);
      assert.equal(r.json().code, 'budget');
    });
  }

  for (const budget of [{ calls: 1 }, { calls_per_day: 1 }, { requests_per_day: 1 }, 1]) {
    test(`a positive cap of 1 refuses the SECOND call — ${JSON.stringify(budget)}`, async () => {
      await clearCalls();
      await setBudget(budget);
      const first = await aiCall();
      assert.equal(first.statusCode, 200, `first call must pass under ${JSON.stringify(budget)}: ${String(first.body).slice(0, 120)}`);
      const second = await aiCall();
      assert.equal(second.statusCode, 429, `the cap must refuse the (n+1)th call under ${JSON.stringify(budget)}`);
      assert.equal(second.json().code, 'budget');
    });
  }

  test('no cap ({} / absent) leaves the plugin bounded only by the tenant daily cap', async () => {
    await clearCalls();
    await setBudget({});
    const r = await aiCall();
    assert.equal(r.statusCode, 200, `an empty ai_budget must not refuse: ${String(r.body).slice(0, 120)}`);
  });

  test('the catalog writes the CANONICAL key (`calls`), so the read and the write cannot drift again', () => {
    const src = readFileSync(join(HERE, '../src/plugin-catalog.js'), 'utf8');
    assert.match(src, /\{"calls":200,/, 'the catalog must seed ai_budget with the canonical `calls` key');
    assert.ok(!src.includes('"requests_per_day":200'),
      'the old misspelt key must be gone — it is exactly the drift PLG-7 was');
  });
});
