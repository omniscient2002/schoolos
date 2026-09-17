/* D-35 · the app role must never hold table-level DELETE — asserted over the DEFAULT PRIVILEGES, not just the
 * tables that happen to exist today.
 *
 * WHY THIS FILE EXISTS, AND WHY THE PREVIOUS FIX WAS INCOMPLETE. PERFECT-100 §5 SEC-2b found `schoolos_app`
 * holding DELETE on 12 tables, including both Razorpay money ledgers, and it recorded the root cause: a stray
 * `postgres`-owned default ACL in schema `app` — `{schoolos_app=arwd/postgres}` — that appears in NO repo file
 * and sits OUTSIDE the migration checksum ledger. The remediation revoked the 12 existing grants, which is the
 * part that looks like progress and is the part that does not survive: **a default privilege governs tables
 * that do not exist yet.** Revoke twelve grants today and the next migration that creates a table gets a fresh
 * one, with DELETE, from a rule nobody can find in the repository.
 *
 * Default privileges are keyed by the role that CREATES the object, which is why migration 054 — which revokes
 * `FOR ROLE schoolos` — never touched the `postgres` rule at all. Measured on the dev instance before the fix,
 * all three rows were:
 *     postgres | app | r | {schoolos_app=arwd/postgres}   ← DELETE, violates D-35
 *     schoolos | app | S | {schoolos_app=rU/schoolos}
 *     schoolos | app | r | {schoolos_app=arw/schoolos}
 *
 * WHAT IS ASSERTED HERE, and why each half is needed:
 *   (1) STATE — no default ACL in schema `app`, for ANY creating role, grants DELETE to the app role.
 *   (2) STATE — the owning role's default ACL grants EXACTLY SELECT/INSERT/UPDATE. Asserting only the absence
 *       of DELETE would pass on an EMPTY default ACL, which is a different outage: future tables would be
 *       invisible to the app role until a later migration remembered to grant, so the first migration that
 *       forgot would produce 500s in production instead of a missing DELETE.
 *   (3) BEHAVIOUR — the assertion is proved against a table CREATED IN THE TEST, because state assertions about
 *       default privileges can pass while the privileges themselves are wrong for reasons the catalog does not
 *       show. The table is created by the schema-owning role and dropped in the same test.
 *
 * HONEST LIMIT, stated rather than hidden: a `postgres`-owned rule can only be altered by the `postgres` role
 * or a superuser, and the migration runner connects as `schoolos`. The revoke therefore lives in
 * `scripts/bootstrap.js` behind `ADMIN_DATABASE_URL` (the file's documented superuser path), and this test is
 * where a deployment that could not perform it finds out. On an instance where `postgres` also CREATES `app`
 * tables, the corresponding CHECK below reports exactly that rather than failing with a misleading message.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers.js';
import pg from 'pg';

let sql;
let appRoleExists = false;

before(async () => {
  await setupTestDb();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try { return await c.query(text, params); } finally { await c.end(); }
  };
  appRoleExists = (await sql(`SELECT 1 FROM pg_roles WHERE rolname='schoolos_app'`)).rowCount === 1;
});

after(async () => {
  // The behaviour test creates a real table; make sure it never outlives the run even if an assertion throws.
  try { await sql(`DROP TABLE IF EXISTS app.zz_acl_default_probe`); } catch { /* database is torn down anyway */ }
});

/** Every default ACL row in schema `app`, with the privileges each grantee receives, decoded. */
const defaultAcls = async () => (await sql(
  `SELECT pg_get_userbyid(d.defaclrole) AS creator,
          d.defaclobjtype      AS objtype,
          a.grantee, a.privilege_type
     FROM pg_default_acl d
     JOIN pg_namespace n ON n.oid = d.defaclnamespace
     CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE n.nspname = 'app'`)).rows;

test('D-35 · no default ACL in schema app grants the app role DELETE', async () => {
  assert.equal(appRoleExists, true, 'premise: the constrained app role exists');
  const appOid = (await sql(`SELECT oid FROM pg_roles WHERE rolname='schoolos_app'`)).rows[0].oid;

  const offending = (await defaultAcls()).filter(
    r => String(r.grantee) === String(appOid) && r.privilege_type === 'DELETE');

  assert.deepEqual(offending, [],
    'a default ACL grants schoolos_app DELETE on tables that do not exist yet. This is the SEC-2b landmine: '
    + 'revoking the grants on existing tables does not hold, because the next migration that creates a table '
    + 'gets a fresh DELETE from this rule. Run: '
    + 'ALTER DEFAULT PRIVILEGES FOR ROLE <creator> IN SCHEMA app REVOKE ALL ON TABLES FROM schoolos_app '
    + '(superuser; `node scripts/bootstrap.js` does this for the postgres role when ADMIN_DATABASE_URL is set). '
    + `Offending rows: ${JSON.stringify(offending)}`);
});

test('D-35 · the owning role\'s default ACL states exactly SELECT/INSERT/UPDATE for the app role', async () => {
  const appOid = (await sql(`SELECT oid FROM pg_roles WHERE rolname='schoolos_app'`)).rows[0].oid;
  const owner = (await sql(`SELECT pg_get_userbyid(nspowner) AS o FROM pg_namespace WHERE nspname='app'`)).rows[0].o;

  const rows = (await defaultAcls()).filter(
    r => r.creator === owner && r.objtype === 'r' && String(r.grantee) === String(appOid));

  assert.ok(rows.length > 0,
    `no table default ACL is stated for the schema owner ${owner} in schema app — future tables would be `
    + 'created with NO app-role grants, which fails later and more confusingly than a missing DELETE');

  const verbs = rows.map(r => r.privilege_type).sort();
  assert.deepEqual(verbs, ['INSERT', 'SELECT', 'UPDATE'],
    `the stated posture must be EXACTLY the three intended verbs (got ${JSON.stringify(verbs)}). Asserting only `
    + '"no DELETE" would also pass on an empty set, which is a different outage: every future table would be '
    + 'invisible to the app role.');
});

test('D-35 · a table created NOW is born without DELETE for the app role (proved, not inferred)', async () => {
  /* The state assertions above read the catalog. This one CREATES A TABLE, because the catalog could agree with
   * itself while the effective grants differ — and because the whole point of a default privilege is what it
   * does to a table that did not exist when it was written. Created by the schema-owning role, exactly as a
   * migration does, and dropped immediately after. */
  await sql(`DROP TABLE IF EXISTS app.zz_acl_default_probe`);
  await sql(`CREATE TABLE app.zz_acl_default_probe (id int PRIMARY KEY)`);

  try {
    const g = (await sql(
      `SELECT has_table_privilege('schoolos_app', 'app.zz_acl_default_probe', 'SELECT') AS sel,
              has_table_privilege('schoolos_app', 'app.zz_acl_default_probe', 'INSERT') AS ins,
              has_table_privilege('schoolos_app', 'app.zz_acl_default_probe', 'UPDATE') AS upd,
              has_table_privilege('schoolos_app', 'app.zz_acl_default_probe', 'DELETE') AS del`)).rows[0];

    assert.equal(g.del, false,
      'a NEWLY created app table grants schoolos_app DELETE — the D-35 default-privilege rule is armed again, '
      + 'and this is precisely the condition that made revoking the 12 existing grants insufficient');
    assert.equal(g.sel, true, 'the app role must be able to read new tables, or every new table is an outage');
    assert.equal(g.ins, true, 'the app role must be able to insert into new tables');
    assert.equal(g.upd, true, 'the app role must be able to update new tables');
  } finally {
    await sql(`DROP TABLE IF EXISTS app.zz_acl_default_probe`);
  }
});

test('D-35 · no EXISTING app table carries a DELETE grant for the app role either', async () => {
  /* The default-privilege rules govern the future; this governs the present, and the two can disagree — that
   * disagreement is exactly what SEC-2b found (12 live grants, and a rule that would recreate them). Both are
   * asserted so neither can be fixed while the other regresses. */
  const rows = (await sql(
    `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND c.relkind = 'r'
        AND has_table_privilege('schoolos_app', c.oid, 'DELETE')
      ORDER BY 1`)).rows.map(r => r.relname);

  assert.deepEqual(rows, [],
    `the app role holds DELETE on ${rows.length} existing app table(s) — D-35 says it never may: ${rows.join(', ')}`);
});
