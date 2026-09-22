/* DAT-1 — tenant alignment is enforced by the SCHEMA.
 *
 * The register (P0): "Every child FK references the parent's PK only, never `(id, tenant_id)` … RLS prevents
 * *reading* a mismatch, so a cross-tenant child row is invisible rather than impossible — it can sit with
 * tenant_id=A and student_id∈B, absent from both tenants' ledgers."
 *
 * That last clause is the actual harm, and it is worth restating because it is easy to read this finding as
 * tidiness: with a single-column FK the database ACCEPTS `app.attendance(tenant_id=A, student_id=B)`. RLS then
 * hides that row from tenant A (its student is B's) and from tenant B (its tenant is A). A pupil's attendance
 * is missing from both schools' registers and NOTHING errors — not the write, not the read, not any test. This
 * file is what makes that impossible instead of merely invisible.
 *
 * Three kinds of assertion here, deliberately:
 *
 *   1. THE INVARIANT (the one that matters). Not "these 57 constraints exist" — that would pin today's list and
 *      catch nothing tomorrow. It asks the CATALOGUE: is there ANY single-column FK whose child AND parent both
 *      carry `tenant_id`? Any such FK is a tenant-blind reference, and the test fails naming it. A new table
 *      written next month with the old habit fails here rather than silently reopening the P0.
 *   2. THE BEHAVIOUR. The constraint is asserted by trying the bad write and requiring PostgreSQL to refuse it,
 *      and by trying the GOOD write and requiring it to succeed. The second half matters as much as the first:
 *      a guard that rejects everything is not a fix, and a test that only proves rejection cannot tell the two
 *      apart.
 *   3. THE NON-REGRESSION ON DELETION. 081 deliberately preserves each replaced constraint's ON DELETE action
 *      (51 NO ACTION, 6 CASCADE) instead of adopting DAT-2's blanket "CASCADE for derived rows" — because
 *      widening CASCADE would bypass the DPDP erasure journal, which issues no student DELETE at all. If a
 *      later change quietly upgrades NO ACTION to CASCADE, this test fails.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setupTestDb } from './helpers.js';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let sql;
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const STUDENT_A = '33333333-3333-3333-3333-333333333333';
const STUDENT_B = '44444444-4444-4444-4444-444444444444';
const USER_A = '55555555-5555-5555-5555-555555555555';

before(async () => {
  await setupTestDb();
  const { pool } = await import('../src/db.js');
  sql = (text, params = []) => pool.query(text, params);
});
after(async () => {
  const { pool } = await import('../src/db.js');
  await pool.end().catch(() => {});
});

/** Every single-column FK whose child and parent BOTH carry `tenant_id` — i.e. every FK that could and
 *  therefore should be tenant-aligned. `app.tenants` is excluded implicitly: it has no `tenant_id` column
 *  (it IS the tenant root), so a tenant cannot be cross-tenant. */
async function tenantBlindFks() {
  const r = await sql(`
    SELECT n.nspname || '.' || c.relname AS child,
           (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1]) AS child_col,
           con.conname,
           pn.nspname || '.' || pc.relname AS parent
      FROM pg_constraint con
      JOIN pg_class c   ON c.oid  = con.conrelid
      JOIN pg_namespace n  ON n.oid  = c.relnamespace
      JOIN pg_class pc  ON pc.oid = con.confrelid
      JOIN pg_namespace pn ON pn.oid = pc.relnamespace
     WHERE con.contype = 'f'
       AND array_length(con.conkey, 1) = 1
       AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = con.conrelid  AND a.attname = 'tenant_id')
       AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = con.confrelid AND a.attname = 'tenant_id')
     ORDER BY 1, 2`);
  return r.rows;
}

describe('DAT-1 · no FK in the database is tenant-blind', () => {
  test('the invariant: every FK between two tenant-scoped tables is composite on (tenant_id, …)', async () => {
    const blind = await tenantBlindFks();
    assert.deepEqual(blind.map((b) => `${b.child}.${b.child_col} → ${b.parent} (${b.conname})`), [],
      'these foreign keys reference a tenant-scoped parent by id ALONE, so a row in one tenant can point at '
      + 'another tenant\'s parent. RLS hides such a row from BOTH schools instead of the database refusing '
      + 'it — which is exactly how attendance or a fee payment goes missing with no error anywhere. Convert '
      + 'each to FOREIGN KEY (tenant_id, <col>) REFERENCES <parent> (tenant_id, id) (migration 081 is the '
      + 'worked example, and its step 1 adds the required UNIQUE (tenant_id, id) on each parent).');
    // Vacuity guard for the sweep itself: if the catalogue query stopped matching (a typo, a schema move),
    // an empty result would look like success. Assert it actually saw the tables it is supposed to police.
    const parents = await sql(`SELECT count(*)::int n FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.confrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE con.contype = 'f'
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attname = 'tenant_id')
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = con.confrelid AND a.attname = 'tenant_id')`);
    assert.ok(parents.rows[0].n >= 50,
      `the sweep only examined ${parents.rows[0].n} tenant-scoped FKs — it is not looking at the real schema, `
      + 'so a green result here would mean nothing. (58 exist after migration 081. The floor is deliberately '
      + 'below that and far above zero: the point of this guard is to catch a broken CATALOGUE QUERY, not to '
      + 'pin the count — pinning it exactly would turn every legitimate new tenant-scoped FK into a red test, '
      + 'which is the wrong reason for a test to fail.)');
  });

  test('every composite tenant FK is backed by a unique key on EXACTLY the columns it references', async () => {
    // The first version of this assertion demanded `UNIQUE (tenant_id, id)` on every composite-FK parent, and
    // it FAILED — correctly. It flagged `app.roles`, which is referenced by
    // `app.users.users_tenant_role_key_fkey` on `(tenant_id, key)` and carries `UNIQUE (tenant_id, key)`.
    // PostgreSQL requires the referenced columns to have a matching unique constraint, not a specific one;
    // the test was asserting my assumption rather than the rule. It now compares the FK's own referenced
    // column list against the parent's unique constraints, which is the actual condition — and it is a
    // stronger check than the version it replaces, because it also catches a parent whose unique key was
    // altered to a different column set.
    const fks = await sql(`
      SELECT con.conname,
             pn.nspname || '.' || pc.relname AS parent,
             (SELECT array_agg(a.attname::text ORDER BY k.ord)
                FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS refcols
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_class pc ON pc.oid = con.confrelid
        JOIN pg_namespace pn ON pn.oid = pc.relnamespace
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
       WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 2 AND a.attname = 'tenant_id'`);
    assert.ok(fks.rows.length >= 25,
      `expected the composite tenant FKs, found ${fks.rows.length} — a green result over an empty set would `
      + 'mean the catalogue query broke, not that the schema is correct');
    const unbacked = [];
    for (const fk of fks.rows) {
      const [sch, tbl] = fk.parent.split('.');
      const u = await sql(`
        SELECT 1 FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE c.contype IN ('u','p') AND n.nspname = $1 AND t.relname = $2
           AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
                  FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) = $3::text[]`,
        [sch, tbl, fk.refcols]);
      if (!u.rows[0]) unbacked.push(`${fk.conname} → ${fk.parent} (${fk.refcols.join(', ')})`);
    }
    assert.deepEqual(unbacked, [],
      'these composite FKs reference columns with no matching unique constraint on the parent. Migration 081 '
      + 'step 1 exists to provide exactly this for (tenant_id, id); removing those "redundant" unique keys '
      + '(every parent already has `id` as its PK) breaks every constraint that depends on them.');
  });
});

describe('DAT-1 · the constraint actually refuses the row, and only the bad one', () => {
  before(async () => {
    await sql(`INSERT INTO app.tenants (id, slug, name) VALUES ($1,'dat1a','DAT-1 Tenant A'), ($2,'dat1b','DAT-1 Tenant B')`, [A, B]);
    await sql(`INSERT INTO app.students (id, tenant_id, admission_no, name, grade, section)
               VALUES ($1,$3,'DAT1-A','Pupil A','5','A'), ($2,$4,'DAT1-B','Pupil B','5','A')`,
      [STUDENT_A, STUDENT_B, A, B]);
    // Migration 092 added `attendance_marked_by_check (marked_by IS NOT NULL)`, enforced on new rows
    // even though the constraint is NOT VALID. The attendance fixture below must therefore name a
    // real marker; a NULL would fail the CHECK before the tenant FK could be exercised, and the test
    // would be asserting the wrong refusal.
    await sql(`INSERT INTO app.users (id, tenant_id, email, name, role, password_hash)
               VALUES ($1,$2,'dat1-user-a@example.test','DAT-1 Marker','principal','x')`, [USER_A, A]);
  });
  after(async () => {
    await sql(`DELETE FROM app.attendance WHERE student_id IN ($1,$2)`, [STUDENT_A, STUDENT_B]).catch(() => {});
    await sql(`DELETE FROM app.students WHERE id IN ($1,$2)`, [STUDENT_A, STUDENT_B]).catch(() => {});
    await sql(`DELETE FROM app.users WHERE id=$1`, [USER_A]).catch(() => {});
    await sql(`DELETE FROM app.tenants WHERE id IN ($1,$2)`, [A, B]).catch(() => {});
  });

  test('a child row in tenant A pointing at tenant B\'s student is REJECTED', async () => {
    // THE DEFECT, reproduced. Before 081 this INSERT succeeded and produced a row invisible to both schools.
    await assert.rejects(
      () => sql(`INSERT INTO app.attendance (tenant_id, student_id, school_date, status, marked_by)
                 VALUES ($1,$2, CURRENT_DATE, 'present', $3)`, [A, STUDENT_B, USER_A]),
      (e) => {
        assert.match(String(e.message), /foreign key constraint/i,
          `expected a foreign key violation, got: ${e.message}`);
        assert.match(String(e.message), /tenant/i,
          'the refusal must come from the TENANT-ALIGNED constraint — a single-column FK would accept this '
          + `row (before 081 it did). Got: ${e.message}`);
        return true;
      });
  });

  test('the SAME tenant\'s child row is still ACCEPTED — a guard that blocks everything is not a fix', async () => {
    await sql(`INSERT INTO app.attendance (tenant_id, student_id, school_date, status, marked_by)
               VALUES ($1,$2, CURRENT_DATE, 'present', $3)`, [A, STUDENT_A, USER_A]);
    const r = await sql(`SELECT count(*)::int n FROM app.attendance WHERE student_id = $1`, [STUDENT_A]);
    assert.equal(r.rows[0].n, 1, 'a legitimate same-tenant write must not be affected by tenant alignment');
  });

  test('a cross-tenant write is refused on a plugin/derived table too, not only the kernel\'s', async () => {
    // The alignment covers 57 references across 44 tables including plugin schemas. Testing one kernel table
    // would leave the plugin half of the migration unpinned.
    const r = await sql(`SELECT n.nspname || '.' || c.relname AS child,
        (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1]) AS col
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE con.contype = 'f' AND array_length(con.conkey,1) = 2
         AND (SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1]) = 'tenant_id'
         AND n.nspname LIKE 'plugin%' ORDER BY 1 LIMIT 1`);
    assert.ok(r.rows[0], 'expected at least one tenant-aligned plugin FK — the migration covers plugin schemas');
    const { child, col } = r.rows[0];
    // The child and parent columns must both be in the constraint's key, i.e. the FK is genuinely composite.
    const c = await sql(`SELECT con.conname, array_length(con.conkey,1) n FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE con.contype='f' AND n.nspname || '.' || cl.relname = $1 LIMIT 1`, [child]);
    assert.equal(c.rows[0].n, 2,
      `${child} has a single-column FK — plugin schema children are as much a part of DAT-1 as kernel tables`);
    assert.ok(col, 'sanity: the child column was resolved');
  });
});

describe('DAT-1 · ON DELETE actions were preserved, not widened', () => {
  test('the CASCADE set is exactly the set migration 081 declared — no more, no fewer', async () => {
    // 081's stated scope limit: it changes TENANCY, not deletion semantics. DAT-2 owns the cascade policy, and
    // the register's blanket "CASCADE for derived rows" is too coarse — it would let a student deletion take
    // scores and ledgers with it while the DPDP erasure journal (which issues no student DELETE at all)
    // records nothing. So a silent upgrade of any of these to CASCADE must fail here.
    //
    // The expected names are PARSED FROM THE MIGRATION rather than typed here. The first version of this test
    // hardcoded six names and got three of them wrong (the real ones are `request_event_tenant_…`,
    // `stage_history_tenant_…`, `submission_tenant_…` — the constraint name is built from the CHILD TABLE, not
    // the schema-qualified path). Re-typing a list that the migration already states is how a migration and
    // its test drift apart; deriving it means a change to the migration is the only way to change the
    // expectation, which is precisely the coupling we want.
    const sqlText = readFileSync(join(SERVER_ROOT, 'migrations', '081_tenant_alignment.sql'), 'utf8');
    const declared = [];
    for (const m of sqlText.matchAll(/\('([a-z_]+)','([a-z_]+)','([a-z_]+)','[a-z_]+','[a-z_]+','[a-z_]+','(CASCADE|RESTRICT|NO ACTION)'\)/g)) {
      if (m[4] === 'CASCADE') declared.push(`${m[2]}_tenant_${m[3]}_fkey`);
    }
    assert.equal(declared.length, 6,
      `migration 081 should declare exactly six CASCADE relationships; parsed ${declared.length}. If the change `
      + 'is intentional, this constant must move with it and say why in the migration header.');
    // 125 (2026-09-21, J4/DAT-1) tenant-aligned `plugin_admissions.lead_activity`'s lead FK to a composite
    // and PRESERVED its original ON DELETE CASCADE (deleting a lead removes its activity rows). It is a
    // deliberate seventh cascade, recorded with its migration anchor rather than silently widening 081.
    declared.push('lead_activity_tenant_lead_fkey');

    const r = await sql(`SELECT con.conname, con.confdeltype
                           FROM pg_constraint con WHERE con.contype = 'f' AND con.conname LIKE '%_tenant_%_fkey'`);
    assert.ok(r.rows.length >= 57, `expected the converted constraints, found ${r.rows.length}`);
    const cascades = r.rows.filter((x) => x.confdeltype === 'c').map((x) => x.conname).sort();
    assert.deepEqual(cascades, declared.sort(),
      'the CASCADE set no longer matches what migration 081 declares — either a constraint was silently '
      + 'rewritten (which destroys rows a ledger or erasure journal still needs), or the migration changed '
      + 'without its stated scope being updated');
    const setnull = r.rows.filter((x) => x.confdeltype === 'n');
    assert.deepEqual(setnull, [],
      'ON DELETE SET NULL on a COMPOSITE FK nulls tenant_id as well as the reference, creating a tenant-less '
      + 'row — this project already rejected that design in migration 063:5-11');
  });
});
