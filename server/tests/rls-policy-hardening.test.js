// PERFECT-100 §8 residual / migration 074 — an authorization predicate must have exactly
// two outcomes: the row is visible, or it is not. It must never be able to FAIL the query.
//
// THE DEFECT (observed live, then reproduced): 94 policy predicates inlined
// `current_setting(...)` themselves in three shapes with two failure behaviours —
//   · `current_setting('schoolos.tenant_id', true)::uuid` with the GUC set to '' →
//     `''::uuid` → **22P02 ERROR**. A connection-state quirk turned an access-control
//     rule into a 500 for the whole request.
//   · `current_setting('schoolos.tenant_id')` with NO missing_ok argument and the GUC
//     never set → **42704 unrecognized configuration parameter**. A latent hard error on
//     a perfectly ordinary request, on 12 tables.
// So the same "no tenant context" state denied on 82 tables and errored on 12, and one
// state could take the request down entirely.
//
// THE FIX: every predicate now routes through app.current_tenant() / app.current_user_id(),
// which normalise BOTH NULL and '' to NULL. The helpers return TEXT (not uuid) because the
// substituted expression must keep the type of the one it replaces — policies use it both
// as `(...)::uuid` and as a plain text comparison.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers.js';

let pool;
let tenant;

before(async () => {
  await setupTestDb();
  pool = (await import('../src/db.js')).pool;
  tenant = (await pool.query(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
});

after(async () => { await pool.end().catch(() => {}); });

/** Run as the constrained app role with an explicit tenant GUC (or none at all). */
const asAppRole = async (gucValue, sql) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE schoolos_app');
    if (gucValue !== undefined) await c.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [gucValue]);
    return await c.query(sql);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    c.release();
  }
};

describe('074 — a policy DENIES on bad connection state, it never RAISES', () => {
  test('an EMPTY-STRING tenant GUC returns no rows instead of raising 22P02', async () => {
    // This is the exact regression pin. Before migration 074 this line threw:
    //   error: invalid input syntax for type uuid: ""  (22P02, sqlstate uuid.c string_to_uuid)
    const r = await asAppRole('', `SELECT count(*)::int AS n FROM app.students`);
    assert.equal(r.rows[0].n, 0, 'empty tenant context must DENY (and must not throw)');
  });

  test('an UNSET GUC on a table whose policy lacked missing_ok returns 0, not 42704', async () => {
    // ptm.booking's policy used current_setting(...) with no missing_ok argument, so a
    // session that never set the GUC raised 42704 "unrecognized configuration parameter".
    const r = await asAppRole(undefined, `SELECT count(*)::int AS n FROM ptm.booking`);
    assert.equal(r.rows[0].n, 0, 'unset tenant context must DENY on EVERY table, not just the ones that happened to use missing_ok');
  });

  test('a real tenant still SEES its rows (denying must not become denying everything)', async () => {
    const r = await asAppRole(tenant, `SELECT count(*)::int AS n FROM app.students`);
    assert.ok(r.rows[0].n > 0, `a valid tenant context must still return its rows (got ${r.rows[0].n})`);
  });

  test('the helpers normalise both NULL and empty string', async () => {
    const c = await pool.connect();
    try {
      const unset = await c.query(`SELECT app.current_tenant() AS t, app.current_user_id() AS u`);
      assert.equal(unset.rows[0].t, null, 'unset → NULL (missing_ok semantics preserved)');
      assert.equal(unset.rows[0].u, null, 'unset → NULL');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('schoolos.tenant_id', '', true)`);
      const empty = await c.query(`SELECT app.current_tenant() AS t`);
      assert.equal(empty.rows[0].t, null, 'empty string → NULL, which is what closes the 22P02 hole');
      await c.query('ROLLBACK');
    } finally { c.release(); }
  });

  test('NO policy inlines current_setting any more (so a new policy cannot reintroduce the hole)', async () => {
    // A static invariant over the catalogue: any future policy must use the helpers.
    const r = await pool.query(`
      SELECT n.nspname || '.' || c.relname || ' :: ' || p.polname AS offender
        FROM pg_policy p
        JOIN pg_class c      ON c.oid = p.polrelid
        JOIN pg_namespace n  ON n.oid = c.relnamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND (pg_get_expr(p.polqual, p.polrelid) LIKE '%current_setting%'
           OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%current_setting%')`);
    assert.deepEqual(r.rows.map((x) => x.offender), [],
      'a policy that inlines current_setting can raise instead of denying — use app.current_tenant()');
  });

  test('the app role can actually execute the helpers (else every policy would fail)', async () => {
    const r = await asAppRole(tenant, `SELECT app.current_tenant() IS NOT NULL AS ok`);
    assert.equal(r.rows[0].ok, true);
  });
});
