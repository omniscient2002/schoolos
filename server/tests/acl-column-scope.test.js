// SEC-2b (UPDATE / SELECT half) — least privilege at COLUMN granularity.
//
// Companion to tests/acl-d35.test.js, which closed the DELETE half. 072 proved the app role
// must not hold table-level DELETE; this file proves the same for the two over-grants where
// the damage is quieter than a DELETE:
//
//   · table-level UPDATE on `app.users` — the table carrying `password_hash` AND `role`.
//     Table-level means every column, so any bug that reaches an UPDATE could set
//     `role='principal'` (privilege escalation) or move a row to another `tenant_id`.
//   · table-level SELECT on `app.webhook_subscriptions` — the row holds `sign_secret`,
//     which signs every outbound webhook for that tenant, so a reader can forge webhooks
//     the tenant's own systems will trust.
//
// The point of these tests is the DIFFERENCE between the two: the fix must remove the
// dangerous capability WITHOUT removing the ones the product ships on. A blanket REVOKE
// would pass a "no UPDATE privilege" assertion and break suspending a user, so several
// assertions below exist specifically to catch that failure mode.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setupTestDb } from './helpers.js';

const ACL_077 = new URL('../migrations/077_acl_column_scope.sql', import.meta.url);

let pool;
let withUser;
let tenant;
let userId;

const colPriv = async (table, column, priv) => (await pool.query(
  `SELECT has_column_privilege('schoolos_app', $1, $2, $3) AS ok`, [table, column, priv])).rows[0].ok;

const tblPriv = async (table, priv) => (await pool.query(
  `SELECT has_table_privilege('schoolos_app', $1, $2) AS ok`, [table, priv])).rows[0].ok;

const applyRepair = async () => pool.query(await readFile(ACL_077, 'utf8'));

before(async () => {
  await setupTestDb();
  ({ pool, withUser } = await import('../src/db.js'));
  tenant = (await pool.query(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  userId = (await pool.query(`SELECT id FROM app.users WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`, [tenant])).rows[0].id;
});

after(async () => { await pool.end().catch(() => {}); });

describe('DATX-1: the shipped pipeline ends tightened (migrate → bootstrap → seed)', () => {
  // PERFECT-100 §9.1: a hardening must be asserted against the real pipeline, not by
  // re-running the migration in-process. This test deliberately does NOT call applyRepair()
  // — it reads the state `setupTestDb()` (migrate → bootstrap → seed) left behind. Before the
  // fix it failed: bootstrap's `GRANT ... ON ALL TABLES IN SCHEMA app` and the seed's replay
  // had re-created the exact over-grants 077 removed, which is why every other test in this
  // file re-applied 077 first and could never see it.
  test('077\'s column scope survives to the end of the real boot pipeline', async () => {
    assert.equal(await tblPriv('app.users', 'UPDATE'), false, 'bootstrap/seed must not re-widen table-level UPDATE on app.users');
    assert.equal(await tblPriv('app.webhook_subscriptions', 'SELECT'), false, 'the pipeline must not re-widen table-level SELECT on the secret-bearing table');
    assert.equal(await colPriv('app.webhook_subscriptions', 'sign_secret', 'SELECT'), false, 'sign_secret must be unreadable post-pipeline');
    assert.equal(await tblPriv('app.enrollment_history', 'UPDATE'), false, 'the write-once ledger stays write-once post-pipeline');
    assert.equal(await tblPriv('app.files', 'UPDATE'), false, 'app.files stays write-once post-pipeline');
  });
});

describe('SEC-2b: UPDATE is narrowed to real columns on app.users', () => {
  test('the 077 repair genuinely revokes table-level UPDATE — proven by simulating the drift first', async () => {
    // Simulate exactly what the stray postgres default ACL does to a table.
    await pool.query(`GRANT UPDATE ON app.users TO schoolos_app`);
    assert.equal(await tblPriv('app.users', 'UPDATE'), true, 'drift simulated (table-level UPDATE granted)');

    await applyRepair();

    assert.equal(await tblPriv('app.users', 'UPDATE'), false, 'table-level UPDATE revoked by 077');
  });

  test('PRIVILEGE ESCALATION IS BLOCKED: the app role cannot rewrite role / tenant_id / email', async () => {
    await applyRepair();
    // `role` is the escalation vector: setting it to a builtin principal would grant the
    // account every door in the tenant. `tenant_id` would move a row across the tenancy
    // boundary; `email` is the login identifier.
    for (const c of ['role', 'tenant_id', 'email', 'id', 'created_at']) {
      assert.equal(await colPriv('app.users', c, 'UPDATE'), false,
        `schoolos_app must NOT be able to UPDATE app.users.${c}`);
    }
  });

  test('the grant is NOT vacuous: every column the product actually writes is still updatable', async () => {
    await applyRepair();
    // Derived from every UPDATE app.users in the repo (see the 077 header for file:line).
    // If one of these is missing, a shipped feature 500s — so this assertion is the
    // counterweight to the "no UPDATE" assertions above.
    for (const c of ['active', 'password_hash', 'force_change', 'auth_provider', 'session_epoch', 'mfa_enrolled_at', 'role_key']) {
      assert.equal(await colPriv('app.users', c, 'UPDATE'), true,
        `schoolos_app must still be able to UPDATE app.users.${c} — a real feature depends on it`);
    }
  });

  test('FUNCTIONAL: suspending a user works on the constrained path, escalating does not', async () => {
    await applyRepair();
    // This is the assertion that makes the ACL change meaningful rather than cosmetic: it
    // runs both statements AS the app role inside a real withUser transaction.
    const before = (await pool.query(`SELECT active FROM app.users WHERE id=$1`, [userId])).rows[0].active;

    // 1. the permitted write succeeds (deactivating an account is a shipped feature)
    await withUser(tenant, 'principal', (c) =>
      c.query(`UPDATE app.users SET active=$2 WHERE id=$1`, [userId, !before]));
    const after = (await pool.query(`SELECT active FROM app.users WHERE id=$1`, [userId])).rows[0].active;
    assert.notEqual(after, before, 'the app role must be able to toggle active — otherwise 077 broke suspension');

    // restore
    await pool.query(`UPDATE app.users SET active=$2 WHERE id=$1`, [userId, before]);

    // 2. the forbidden write fails with a PRIVILEGE error, not silently
    await assert.rejects(
      () => withUser(tenant, 'principal', (c) => c.query(`UPDATE app.users SET role='principal' WHERE id=$1`, [userId])),
      (e) => e.code === '42501' || /permission denied/i.test(e.message),
      'escalating via app.users.role must be refused by the database itself');
  });
});

describe('SEC-2b: write-once ledgers accept no UPDATE', () => {
  test('app.enrollment_history and app.files cannot be updated by the app role', async () => {
    await applyRepair();
    // Both are INSERT-only across the entire codebase (files.store/index.js:133;
    // people.admin/index.js:216,395; routes.js:955), and enrollment_history is documented
    // as "written once, never edited" — a grant permitting edits is not least privilege.
    assert.equal(await tblPriv('app.enrollment_history', 'UPDATE'), false, 'enrollment_history is write-once');
    assert.equal(await tblPriv('app.files', 'UPDATE'), false, 'app.files is written once on upload');
  });

  test('but INSERT survives on both (the narrowing must not break uploading or enrolment)', async () => {
    await applyRepair();
    assert.equal(await tblPriv('app.files', 'INSERT'), true, 'files.store INSERTs on the app path');
    assert.equal(await tblPriv('app.enrollment_history', 'INSERT'), true, 'enrolment history is written by the app');
  });
});

describe('SEC-2b: sign_secret is unreadable by the app role', () => {
  test('table-level SELECT is gone and sign_secret in particular is unreadable', async () => {
    await applyRepair();
    assert.equal(await tblPriv('app.webhook_subscriptions', 'SELECT'), false, 'table-level SELECT revoked by 077');
    assert.equal(await colPriv('app.webhook_subscriptions', 'sign_secret', 'SELECT'), false,
      'sign_secret signs every outbound webhook — a reader could forge deliveries the tenant trusts');
  });

  test('the non-secret columns remain readable so listing subscriptions still works', async () => {
    await applyRepair();
    for (const c of ['id', 'tenant_id', 'url', 'events', 'active', 'created_at']) {
      assert.equal(await colPriv('app.webhook_subscriptions', c, 'SELECT'), true,
        `listing subscriptions needs SELECT on ${c}`);
    }
    // Creating a subscription writes `sign_secret`, and that path runs on the OWNER
    // connection deliberately (app.js:759 uses `sysq`, verified live). So the constrained
    // role holds no INSERT on this table at all — a STRONGER position than 077 needed, and
    // this assertion pins it: if anyone moves creation onto the app path, they must add a
    // deliberate grant for the secret-bearing column and justify it here.
    assert.equal(await tblPriv('app.webhook_subscriptions', 'INSERT'), false,
      'the secret-bearing table is written only on the owner path — the app role must not acquire INSERT by accident');
  });
});
