// DATX-11/12/13 — schema index hygiene, asserted against the REAL migrated schema (not source strings).
//
// DATX-11: fifteen tenant tables had no tenant-leading index. DATX-12: six indexes were fully covered by a
// longer key on the same table (a btree serves any prefix, so the short index could never be chosen over
// the covering one). DATX-13: 083 created `app.class_assignments` with no grant, relying on bootstrap.
// This test reads the migrated database after the shipped pipeline, so a regression in 106 fails here.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { setupTestDb } from './helpers.js';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let client;

before(async () => {
  await setupTestDb();
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
});
after(async () => { await client?.end(); });

describe('DATX-11/12/13 · index hygiene holds in the migrated schema', () => {
  test('every tenant-scoped table has a tenant-leading index', async () => {
    const { rows } = await client.query(`
      SELECT n.nspname || '.' || c.relname AS tbl
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      WHERE c.relkind = 'r'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
        AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum)
      ORDER BY 1`);
    assert.deepEqual(rows.map((r) => r.tbl), [],
      'tenant tables without a tenant-leading index — RLS scans have no index to start from (DATX-11)');
  });

  test('the redundant prefix-covered indexes are gone', async () => {
    const dropped = [
      'app.eal_event_idx', 'app.fee_obl_student_idx', 'app.users_tenant_idx',
      'intervention.intervention_plan_student_idx', 'mastery.mastery_state_student_idx',
      'teacher.concern_student_idx',
    ];
    for (const idx of dropped) {
      const { rows } = await client.query('SELECT to_regclass($1) AS r', [idx]);
      assert.equal(rows[0].r, null, `${idx} is fully covered by a longer index and must stay dropped (DATX-12)`);
    }
  });

  test('083 carries its own class_assignments grant rather than only relying on bootstrap (DATX-13)', async () => {
    const sql = readFileSync(join(SERVER_ROOT, 'migrations', '106_index_hygiene_and_grants.sql'), 'utf8');
    assert.match(sql, /GRANT\s+SELECT,\s*INSERT,\s*UPDATE\s+ON\s+app\.class_assignments\s+TO\s+schoolos_app/i,
      'migration 106 must grant the app role on app.class_assignments so the table is not dead-on-arrival');
    // and the live grant the pipeline leaves behind (bootstrap also does this — asserted so the two cannot
    // silently disagree about the privilege set).
    const { rows } = await client.query(
      `SELECT has_table_privilege('schoolos_app', 'app.class_assignments', 'INSERT') AS ok`);
    assert.equal(rows[0].ok, true, 'the app role must be able to insert a class assignment after the pipeline');
  });
});
