// Postgres pool + helpers.
//
// ─────────────────────────────────────────────────────────────────────────────
// PERFECT-100 §5.1 SEC-1 / §3: THE DEFAULT IS NOW THE CONSTRAINED ROLE.
//
// The defect this file used to have: the pool authenticated as `schoolos`, which
// OWNS every table and carries `rolbypassrls = true` (verified live:
// schoolos → rolsuper=f, rolbypassrls=t; schoolos_app → both false). Row-level
// security is not merely unenforced for the owner — it is *skipped*. Only the 238
// `withUser(...)` call sites were protected, because they explicitly
// `SET LOCAL ROLE schoolos_app`. The 74 bare `q(...)` call sites ran as the owner
// with RLS bypassed, so any route using one was a cross-tenant read/write waiting
// for a bug. RLS is a boundary only if the role that reaches the tables is subject
// to it — otherwise the isolation the product sells is a property of *call-site
// discipline*, not of the database.
//
// The fix inverts the default: `q()` now runs as `schoolos_app`, so RLS applies to
// every ordinary query whether or not the author thought about tenancy. Privileged
// work must now be EXPLICIT (`sysq()` / `tx()` / `withUser()`), which makes it
// greppable and reviewable instead of invisible.
//
// Failure mode, stated honestly: with the tenant GUC unset the policy evaluates
// `tenant_id = NULL` → no rows. So a missed call site fails CLOSED (a route returns
// nothing) rather than OPEN (it returns another school's children). That is the
// correct direction to fail, but a silently empty result is its own form of
// success-shaped silence, which is why tests/rls-boundary.test.js pins both that the
// boundary holds AND that /metrics — a real tenant-serving path — still returns data.
// ─────────────────────────────────────────────────────────────────────────────
import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  connectionTimeoutMillis: 5000, // fail fast under DB outage (ops audit P1-6)
  idleTimeoutMillis: 30_000,
  idle_in_transaction_session_timeout: 60_000,
  statement_timeout: 15_000,
  // Server-level default: FOR UPDATE doors (and any other blocked acquisition)
  // fail with 55P03 after 5s instead of queueing behind a stuck holder (ops audit
  // P1-8 follow-up). Individual queries can still opt into longer waits.
  options: '-c lock_timeout=5s',
});

pool.on('error', (err) => {
  console.error('[pg] idle client error', err.message);
});

export const APP_ROLE = 'schoolos_app';
/** The session user: owns every table and carries BYPASSRLS. Never for user requests. */
export const OWNER_ROLE = 'schoolos';

/**
 * Run `fn(client)` in a transaction under an explicit role. `SET LOCAL` is
 * transaction-scoped, so the role can never leak onto a pooled connection that is
 * later handed to another request — the downgrade is self-cleaning by construction.
 */
const withRole = async (role, fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }
};

/**
 * Ordinary query — runs as the CONSTRAINED app role, so RLS applies. This is the
 * default on purpose: touching a table without reasoning about tenancy is now
 * impossible to do by accident.
 */
export const q = (text, params) => withRole(APP_ROLE, (c) => c.query(text, params));

/**
 * Privileged query — runs as the OWNER role (RLS bypassed). Only for operations that
 * are legitimately outside any single tenant, or that must run before a tenant is
 * known. Every call site must be justifiable as one of:
 *   · authentication bootstrap (finding a user by email before a tenant is known)
 *   · platform supervision (the plugin registry, /metrics, schema_migrations)
 *   · maintenance (retention, denylist sweeps, outbox)
 * Named distinctly so `grep -n sysq( src/` is a complete audit of privilege.
 */
export const sysq = (text, params) => pool.query(text, params);

/** Run `fn(client)` inside a transaction (as the owner role — admin paths only). */
export const tx = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${OWNER_ROLE}`);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }
};

/**
 * Run `fn(client)` inside a transaction AS the constrained app role, with the
 * tenant + role claims set for this transaction only. All RLS-protected
 * request paths go through this. The admin role (migrations/seed) bypasses
 * RLS and must never be used for user requests.
 */
export const withUser = async (tenantId, role, fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [tenantId]);
    await client.query(`SELECT set_config('schoolos.role', $1, true)`, [role]);
    await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }
};

/** Effective role facts for a client — used by the boundary test. */
export const roleFacts = async (client) => (await client.query(
  `SELECT current_user AS session_user, current_setting('role') AS current_role,
          (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS session_bypasses_rls`)).rows[0];
