// RBAC-1 · the canonical role catalog must not drift from the database.
//
// Before this test the built-in role list lived in `auth.js` and in the database CHECK constraint with
// nothing tying them together: a role could be added to one and silently absent from the other. This
// pins the code catalog against the live constraint, and pins every capability's roles to the catalog.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers.js';
import { BUILTIN_ROLES, CAPABILITY_ROLES } from '../src/role-catalog.js';
import { ROLES } from '../src/auth.js';

let pool;
before(async () => {
  await setupTestDb();
  pool = (await import('../src/db.js')).pool;
});
after(async () => { await pool?.end().catch(() => {}); });

describe('RBAC-1 · role catalog vs the database CHECK', () => {
  test('auth.js ROLES is the catalog', () => {
    assert.deepEqual([...ROLES], [...BUILTIN_ROLES]);
  });

  test('the app.users role CHECK admits exactly the catalog roles', async () => {
    const def = (await pool.query(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
        WHERE c.conrelid = 'app.users'::regclass AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%role%'`)).rows.map((r) => r.def).join('\n');
    assert.ok(def.length > 0, 'app.users must carry a role CHECK constraint');
    const dbRoles = new Set([...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]));
    // the constraint may also mention pg_role values; only compare the ones the catalog names
    const catalog = new Set(BUILTIN_ROLES);
    const missingInDb = [...catalog].filter((r) => !dbRoles.has(r));
    const extraInDb = [...dbRoles].filter((r) => !catalog.has(r) && !['authenticated', 'anon', 'service_role', 'schoolos', 'schoolos_app', 'postgres'].includes(r));
    assert.deepEqual(missingInDb, [], 'catalog roles missing from the DB CHECK');
    assert.deepEqual(extraInDb, [], 'DB CHECK admits roles the catalog does not name');
  });

  test('every capability names only catalog roles', () => {
    const catalog = new Set(BUILTIN_ROLES);
    for (const [cap, roles] of Object.entries(CAPABILITY_ROLES)) {
      for (const r of roles) assert.ok(catalog.has(r), `${cap} names a non-catalog role: ${r}`);
    }
  });
});
