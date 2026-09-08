// Postgres pool + helpers.
import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  connectionTimeoutMillis: 5000, // fail fast under DB outage (ops audit P1-6)
  idleTimeoutMillis: 30_000,
  idle_in_transaction_session_timeout: 60_000,
  statement_timeout: 15_000,
});

pool.on('error', (err) => {
  console.error('[pg] idle client error', err.message);
});

export const q = (text, params) => pool.query(text, params);

/** Run `fn(client)` inside a transaction (as the owner role — admin paths only). */
export const tx = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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
export const APP_ROLE = 'schoolos_app';

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
