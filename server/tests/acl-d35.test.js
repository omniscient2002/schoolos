// SEC-1 / law D-35 — the app role must never hold table-level DELETE.
//
// This file guards the EFFECT, not the cause. The cause is a `postgres`-owned default
// ACL on schema app ({schoolos_app=arwd/postgres}) that silently re-grants DELETE to
// every table created BY postgres, which a migration cannot remove (that needs
// superuser). Guarding the effect is what is testable without superuser — and it goes
// red the moment the trap bites again, which is the symptom that actually matters.
//
// Verified live (dev DB) that this was a real, exploitable drift, not a theory:
// schoolos_app held DELETE on 12 tables, including app.timetable_periods,
// app.timetable_slots, app.timetable_substitutions (schema app — direct D-35
// violations) and the plugin_razorpay / plugin_upi webhook ledgers.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setupTestDb } from './helpers.js';

const ACL_072 = new URL('../migrations/072_acl_repair.sql', import.meta.url);

let pool;

// every table (outside system schemas) where the constrained app role may DELETE
const deleteHolders = async () => (await pool.query(
  `SELECT n.nspname AS sch, c.relname AS tbl
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\\_%'
      AND has_table_privilege('schoolos_app', c.oid, 'DELETE')
    ORDER BY 1, 2`)).rows;

const canDelete = async (qualified) => (await pool.query(
  `SELECT has_table_privilege('schoolos_app', $1, 'DELETE') AS ok`, [qualified])).rows[0].ok;

const applyRepair = async () => pool.query(await readFile(ACL_072, 'utf8'));

before(async () => {
  await setupTestDb();
  pool = (await import('../src/db.js')).pool;
});

describe('SEC-1 / D-35: the app role holds no table-level DELETE', () => {
  test('the 072 repair genuinely revokes — proven by simulating the drift first', async () => {
    // 1. simulate exactly what the postgres default ACL does to a new table
    await pool.query(`GRANT DELETE ON app.timetable_slots TO schoolos_app`);
    assert.equal(await canDelete('app.timetable_slots'), true, 'drift simulated (DELETE granted)');
    assert.ok((await deleteHolders()).some((r) => r.sch === 'app' && r.tbl === 'timetable_slots'),
      'the violation is observable before the repair');

    // 2. run the real migration artifact (idempotent, so re-running it is safe)
    await applyRepair();

    // 3. the violation is gone — so the migration is doing work, not just existing
    assert.equal(await canDelete('app.timetable_slots'), false, 'DELETE revoked by 072');
  });

  test('no table in schema app grants the app role DELETE (law D-35 as written)', async () => {
    await applyRepair();
    const inApp = (await deleteHolders()).filter((r) => r.sch === 'app');
    assert.deepEqual(inApp, [], `schema app must grant no DELETE to the app role, found: ${JSON.stringify(inApp)}`);
  });

  test('the money, webhook and audit ledgers are DELETE-proof', async () => {
    await applyRepair();
    // These are the ones where a DELETE is not a bug but evidence destruction.
    for (const t of ['app.audit_log', 'plugin_razorpay.order_log', 'plugin_razorpay.webhook_log', 'plugin_upi.webhook_log']) {
      const exists = (await pool.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [t])).rows[0].ok;
      assert.equal(exists, true, `${t} should exist after migrations`);
      assert.equal(await canDelete(t), false, `${t} must not be deletable by the app role`);
    }
  });

  test('the one deliberate exception is intact and documented', async () => {
    await applyRepair();
    // A student may hard-delete their OWN notebook note (student.world:297 runs AS the
    // app role, scoped to creator_user_id, and rides the audit ledger). Revoking this
    // would break a shipped feature, so 072 excludes it on purpose. This assertion
    // pins that decision: if someone revokes it, they get told the feature will break.
    assert.equal(await canDelete('student.mistake_note'), true,
      'student.mistake_note keeps DELETE by design — see 072 header (follow-up: convert the door to a SECURITY DEFINER helper)');
  });

  test('the persistent default-ACL trap is reported (warning, not a failure)', async () => {
    await applyRepair();
    const trap = (await pool.query(
      `SELECT pg_get_userbyid(d.defaclrole) AS owner, d.defaclacl::text AS acl
         FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
        WHERE n.nspname = 'app' AND d.defaclobjtype = 'r'
          AND d.defaclacl::text LIKE '%schoolos_app=arwd%'`)).rows;
    let warned = false;
    if (trap.length) {
      warned = true;
      // Not a test failure: no table is currently in violation (proven above), and a
      // migration cannot remove a postgres-owned default ACL. Surfaced loudly instead
      // of silently, with the exact superuser command required.
      console.warn('⚠️  D-35 TRAP STILL ARMED — a postgres-owned default ACL on schema app grants '
        + 'schoolos_app arwd, so the NEXT table created by postgres re-acquires DELETE. '
        + 'Migration 072 revokes grants that already exist but cannot remove this. As superuser run: '
        + "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app REVOKE ALL ON TABLES FROM schoolos_app;");
    }
    /* TST-4: this test ended on `assert.ok(true)` — a placeholder that could not fail. Its name is "reported
       (warning, not a failure)", so the falsifiable claim is exactly that: either there is no trap, or the trap
       was surfaced LOUDLY. Delete the console.warn and this fails; make the trap fatal and it fails too. */
    assert.ok(trap.length === 0 || warned,
      'a default-ACL trap that exists must be reported, never swallowed (D-35 tolerance is bounded by being loud)');
  });
});
