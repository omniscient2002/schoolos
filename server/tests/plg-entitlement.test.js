/* PLG-2 — a school can only enable what its plan includes, and a downgrade actually revokes access.

   The register: "`entitlement` is never checked — any tenant can enable any plugin, including paid packs and
   rails, and the ledger records it as legitimate." Four documented enable gates existed and none were
   implemented; this file pins the one that decides what a school has paid for.
*/

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';
import { PLANS, PLUGIN_PLAN, planIncludes, uncoveredPlugins, notEntitled } from '../src/entitlements.js';
import { CATALOG } from '../src/plugin-catalog.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const brief = (r) => `HTTP ${r.statusCode} ${String(r.body ?? '').slice(0, 180)}`;

describe('PLG-2 · entitlement is enforced at the door and at every request', () => {
  let app; let pool; let owner; let tenantId;
  const sql = (text, params) => pool.query(text, params);

  before(async () => {
    await setupTestDb();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp({ logger: false });
    pool = (await import('../src/db.js')).pool;
    owner = await loginAs(app, 'owner@meridian.edu');
    tenantId = (await pool.query(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  });

  test('the matrix is complete over the catalogue, and the plans do not overlap by accident', () => {
    const ids = CATALOG.map((p) => p.plugin_id);
    assert.ok(ids.length >= 29, `expected the full catalogue, found ${ids.length}`);
    assert.deepEqual(uncoveredPlugins(ids), [],
      'a catalogue plugin with no plan is a plugin NO school can enable — the failure mode this assertion exists to prevent');
    // the rails and the packs are the paid ones; assert the grouping is not accidentally universal
    assert.equal(planIncludes('rails', 'accounting.tally'), true);
    assert.equal(planIncludes('core', 'library'), false, 'core is kernel-only by definition');
    assert.equal(planIncludes('trial', 'anything.at.all'), true, 'trial is everything (see 080: unassigned = everything)');
    assert.equal(planIncludes('nonexistent-plan', 'library'), false, 'an unknown plan entitles nothing — never allow-by-default');
    assert.equal(PLUGIN_PLAN['pack.cbse'], 'compliance');
    assert.deepEqual(Object.keys(PLANS).sort(), ['campus', 'compliance', 'core', 'operations', 'rails', 'trial']);
  });

  test('enabling a plugin outside the plan is refused with 402 and writes nothing', async () => {
    await sql(`UPDATE app.tenants SET plan='core' WHERE id=$1`, [tenantId]);
    const before = (await sql(`SELECT status, enabled_at FROM app.plugins WHERE tenant_id=$1 AND plugin_id='library'`, [tenantId])).rows[0];
    const res = await app.inject({ method: 'POST', url: '/plugins/library/enable', headers: H(owner.token), payload: { version: '1.0.0', class: 'C' } });
    assert.equal(res.statusCode, 402, brief(res));
    assert.equal(res.json().code, 'NOT_ENTITLED', 'the refusal says why in a machine-readable way');
    assert.match(res.json().error, /plan \(core\)/i, 'and names the plan, so support can act on it');
    const after = (await sql(`SELECT status, enabled_at FROM app.plugins WHERE tenant_id=$1 AND plugin_id='library'`, [tenantId])).rows[0];
    assert.deepEqual(after, before, 'nothing was half-enabled — the gate sits before the write');

    // and the same plugin IS enableable once the plan includes it: the gate must not be a blanket refusal
    await sql(`UPDATE app.tenants SET plan='campus' WHERE id=$1`, [tenantId]);
    const ok = await app.inject({ method: 'POST', url: '/plugins/library/enable', headers: H(owner.token), payload: { version: '1.0.0', class: 'C' } });
    assert.equal(ok.statusCode, 200, `an entitled enable must succeed: ${brief(ok)}`);
  });

  test('a plan downgrade revokes access at the door, even while the row still says enabled', async () => {
    // the realistic sequence: a school is on `campus`, has library enabled, then moves down to `core`. No
    // back-office job runs; the row is untouched. The request gate is the only thing standing between the
    // school and features it no longer pays for — this is why it checks the plan rather than trusting the row.
    await sql(`UPDATE app.tenants SET plan='campus' WHERE id=$1`, [tenantId]);
    await app.inject({ method: 'POST', url: '/plugins/library/enable', headers: H(owner.token), payload: { version: '1.0.0', class: 'C' } });
    const enabled = (await sql(`SELECT status FROM app.plugins WHERE tenant_id=$1 AND plugin_id='library'`, [tenantId])).rows[0];
    assert.equal(enabled.status, 'enabled', 'fixture: the plugin really is enabled before the downgrade');

    await sql(`UPDATE app.tenants SET plan='core' WHERE id=$1`, [tenantId]);
    const denied = await app.inject({ method: 'GET', url: '/plugins/library/catalog', headers: H(owner.token) });
    assert.equal(denied.statusCode, 402, `a downgrade must revoke access at the door: ${brief(denied)}`);
    assert.equal(denied.json().code, 'NOT_ENTITLED');
    const row = (await sql(`SELECT status FROM app.plugins WHERE tenant_id=$1 AND plugin_id='library'`, [tenantId])).rows[0];
    assert.equal(row.status, 'enabled', 'the row is deliberately NOT rewritten: access follows the plan, and the ledger keeps its history');

    await sql(`UPDATE app.tenants SET plan='trial' WHERE id=$1`, [tenantId]);
    const back = await app.inject({ method: 'GET', url: '/plugins/library/catalog', headers: H(owner.token) });
    assert.equal(back.statusCode, 200, `and restoring the plan restores access without touching the row: ${brief(back)}`);
  });

  test('the refusal shape is one shape (so callers cannot tell "unpaid" from "broken")', () => {
    const r = notEntitled('pack.cbse', 'campus');
    assert.equal(r.code, 'NOT_ENTITLED');
    assert.equal(r.plugin, 'pack.cbse');
    assert.equal(r.plan, 'campus');
    assert.ok(r.error && !/undefined|null/i.test(r.error), 'the message is written for a person');
  });

  test('migration 080 gives every tenant a plan, and the column cannot hold an invented one', async () => {
    const t = (await sql(`SELECT plan FROM app.tenants WHERE id=$1`, [tenantId])).rows[0];
    assert.ok(t.plan, 'every tenant has a plan after 080');
    await assert.rejects(
      () => sql(`UPDATE app.tenants SET plan='platinum' WHERE id=$1`, [tenantId]),
      (e) => String(e.message).includes('tenants_plan_check'),
      'the CHECK constraint is what makes the matrix authoritative rather than advisory');
  });
});
