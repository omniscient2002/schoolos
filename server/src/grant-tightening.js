// D-35 grant tightening — the app role's table-level DELETE is revoked LAST, after every step that widens it.
//
// WHY THIS MODULE EXISTS. PERFECT-100 §5 SEC-2b recorded the D-35 violation and the remediation recorded with it
// was "revoke the 12 existing grants". Measured on a freshly built database, that remediation does not hold —
// every one of the grants comes back. Removing them by hand is undone by the next `seed.js`, and nothing in the
// repository said so, because the ordering is what makes it invisible:
//
//     migrate   → applies 010/018/020/021/036, which GRANT ... DELETE explicitly
//     bootstrap → revokes them (its baseline REVOKEs ALL ON ALL TABLES **IN SCHEMA app**)
//     seed      → REPLAYS those migrations to rebuild fixtures, and re-grants what bootstrap just revoked
//
// So the final posture is decided by the LAST step, and the last step grants DELETE. That is also why the
// developer database and a freshly built one disagreed: dev measured `schoolos_app=arw` on the timetable tables
// while a fresh database measured `arwd`, because dev had not replayed the seed since someone revoked them by
// hand. Two databases built from the same 83 migrations, different security posture.
//
// Bootstrap's revoke is additionally scoped to schema `app`, so the plugin and `student` schemas were never
// covered even in principle: `plugin_razorpay.order_log` and `plugin_razorpay.webhook_log` — the two money
// ledgers SEC-2b named — are in `plugin_razorpay`, not `app`.
//
// WHAT THIS DOES, AND THE ONE DELIBERATE EXCEPTION. It revokes table-level DELETE from the app role across every
// schema that holds application data, then re-grants it on the single table whose code path genuinely needs it.
// That exception is not a guess: grepping the server source for `DELETE FROM` against these schemas yields
// exactly three sites, and only one of them runs on the app role —
//   `src/plugins/student.world/index.js:300` — `DELETE FROM student.mistake_note WHERE id=$1 AND creator_user_id=$2`
// (the other two, `app.js:407` `app.auth_otps` and `app.js:519` `app.oauth_states`, go through `sysq()`, the
// owner path, which holds its own privileges and is unaffected by the app role's grants).
//
// Re-granting one table is honest where blanket-revoking is not: a fix that silently removed DELETE from a code
// path the product uses would turn a privilege violation into a 500, and the register's own remedy says so —
// "schoolos_app holds DELETE on 1 table (down from 12, and not a money ledger: student.mistake_note)". That
// sentence is the target state, and this module converges to it rather than to zero.
//
// Idempotent: revoking a privilege that is already absent is a no-op.

/** Schemas holding application data. Listed explicitly rather than derived from `pg_namespace`, because a
 *  `WHERE nspname NOT IN ('pg_catalog','information_schema')` sweep would silently reach any extension schema
 *  a future dependency installs. A new schema must be added here deliberately — and the CI assertion in
 *  `tests/acl-default-privileges.test.js` fails if one is missed, since it sweeps by catalogue rather than by
 *  this list. */
export const APP_DATA_SCHEMAS = [
  'app', 'auth', 'coord', 'copilot', 'curriculum', 'duty', 'family', 'intervention', 'library', 'mastery',
  'parent', 'plugin_admissions', 'plugin_clinic', 'plugin_dpdp', 'plugin_exams', 'plugin_hr', 'plugin_razorpay',
  'plugin_transport_gps', 'plugin_upi', 'plugin_visitors', 'ptm', 'safety', 'student', 'support', 'teacher',
];

/** The tables whose app-role DELETE is used in code. See the header for the grep that establishes the first.
 *  `family.child_link` (SEC-5/DAT-3) is the second: the link-management door unbinds a guardian —
 *  `src/plugins/family.view/index.js` `DELETE FROM family.child_link WHERE id=$1 AND tenant_id=$2`. It is an
 *  authorization table, not a ledger, and a revoked binding must actually disappear (not linger as a row
 *  that still grants read access). */
export const DELETE_EXCEPTIONS = ['student.mistake_note', 'family.child_link'];

export async function tightenAppRoleDeletes(client) {
  const revoked = [];
  for (const schema of APP_DATA_SCHEMAS) {
    // `to_regnamespace` returns NULL for a schema this deployment does not have (a plugin that was never
    // installed), and `REVOKE ... IN SCHEMA NULL` would raise. Reading the tables first also keeps the
    // operation to one statement per schema, so a schema with no tables costs nothing.
    const { rows } = await client.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind = 'r'`, [schema]);
    if (rows.length === 0) continue;
    await client.query(`REVOKE DELETE ON ALL TABLES IN SCHEMA ${schema} FROM schoolos_app`);
    revoked.push(`${schema}(${rows.length})`);
  }

  const granted = [];
  for (const table of DELETE_EXCEPTIONS) {
    // Guarded: the table belongs to a plugin that may not be installed on this deployment.
    const { rows } = await client.query(`SELECT to_regclass($1) AS oid`, [table]);
    if (!rows[0]?.oid) continue;
    await client.query(`GRANT DELETE ON ${table} TO schoolos_app`);
    granted.push(table);
  }
  return { revoked, granted };
}

// ── DATX-1 (PERFECT-100 §9.1): the COLUMN scope has the same last-writer-wins trap ─────────────
//
// 077 revokes the app role's table-level UPDATE/SELECT and re-grants only the columns the product
// writes. But it is a migration, and the pipeline does not end at migrations:
//
//     migrate   → 077 narrows app.users to 7 updatable columns, revokes UPDATE on the ledgers,
//                 and narrows webhook_subscriptions SELECT so sign_secret is unreadable
//     bootstrap → `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA app` re-widens ALL of it
//     seed      → replays 010/018/… and re-widens again
//
// So in every environment booted through the shipped pipeline the column scope 077 claims to
// provide did not exist — measurable: `has_table_privilege('schoolos_app','app.users','UPDATE')`
// was true, and `webhook_subscriptions.sign_secret` was readable. `tests/acl-column-scope.test.js`
// hid it by re-running 077 inside each test. The register's law (§9.1) is that a hardening is
// asserted against the real pipeline, so this function is applied at the END of both widening
// paths (bootstrap and seed), exactly like the DELETE tightening above.
//
// The column list is 077's, derived from the code and documented in that file's header. Keeping it
// as a shared export means the migration and the runtime replay cannot drift.
export const USERS_UPDATABLE_COLUMNS = ['active', 'password_hash', 'force_change', 'auth_provider', 'session_epoch', 'mfa_enrolled_at', 'role_key'];
export const WRITE_ONCE_TABLES = ['app.enrollment_history', 'app.files'];
export const WEBHOOK_SUBSCRIPTION_SELECT_COLUMNS = ['id', 'tenant_id', 'url', 'events', 'active', 'created_at'];

export async function tightenAppRoleColumns(client) {
  const applied = [];

  if ((await client.query(`SELECT to_regclass('app.users') AS oid`)).rows[0]?.oid) {
    await client.query(`REVOKE UPDATE ON app.users FROM schoolos_app`);
    await client.query(`GRANT UPDATE (${USERS_UPDATABLE_COLUMNS.join(', ')}) ON app.users TO schoolos_app`);
    applied.push('app.users');
  }

  for (const table of WRITE_ONCE_TABLES) {
    if ((await client.query(`SELECT to_regclass($1) AS oid`, [table])).rows[0]?.oid) {
      await client.query(`REVOKE UPDATE ON ${table} FROM schoolos_app`);
      applied.push(table);
    }
  }

  if ((await client.query(`SELECT to_regclass('app.webhook_subscriptions') AS oid`)).rows[0]?.oid) {
    await client.query(`REVOKE SELECT ON app.webhook_subscriptions FROM schoolos_app`);
    await client.query(`GRANT SELECT (${WEBHOOK_SUBSCRIPTION_SELECT_COLUMNS.join(', ')}) ON app.webhook_subscriptions TO schoolos_app`);
    applied.push('app.webhook_subscriptions');
  }

  return applied;
}

// DATX-12: indexes that a longer btree on the same table already serves, so the short one only costs write
// time and disk. The list is shared between migration 106 and this module because `seed.js` replays
// migrations 009–048 AFTER 106 has run, and 032 recreates one of them — a migration-only drop would be
// undone by every seed. Applied as the last step of the seeding path, like the grant tightening above.
export const REDUNDANT_INDEXES = [
  'app.eal_event_idx',
  'app.fee_obl_student_idx',
  'app.users_tenant_idx',
  'intervention.intervention_plan_student_idx',
  'mastery.mastery_state_student_idx',
  'teacher.concern_student_idx',
];

export async function dropRedundantIndexes(client) {
  const dropped = [];
  for (const idx of REDUNDANT_INDEXES) {
    const r = await client.query('SELECT to_regclass($1) AS oid', [idx]);
    if (r.rows[0]?.oid) {
      await client.query(`DROP INDEX IF EXISTS ${idx}`);
      dropped.push(idx);
    }
  }
  return dropped;
}
