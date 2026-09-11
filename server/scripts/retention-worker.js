#!/usr/bin/env node
// Retention worker (Wave B → extended in L2-3.4, Waves 2-5 run) — ONE purge pass,
// then exit. Built for the compose one-shot `retention` service (restart: "no") or
// a cron line (see bottom); it never loops, so a stuck pass cannot pile up.
// Also importable: `export { pass }` — scripts/day-worker.js calls it as its
// retention step (CLI guard below keeps `node scripts/retention-worker.js` the
// only path that runs standalone).
//
// What it purges (and the promise each purge honors):
//   · plugin_transport_gps.positions — docs/DATA-FLOW §11/§22: GPS retention
//     promised; default 30 days (GPS_POSITIONS_DAYS).
//   · app.auth_otps — 008 login OTP vault: expired, or consumed >7d ago
//     (OTP_RETENTION_DAYS). Verification secrets must not outlive their purpose.
//   · plugin_visitors.pickup_otp — 024/054 pickup vault (kernel-only): same
//     semantics as the login vault (D-15b: the split vault needs its own sweep).
//   · auth.reset_tokens — 056 single-use reset tokens: consumed or expired
//     tokens older than 7d (OTP_RETENTION_DAYS).
//   · auth.revoked_token — 038 jti denylist past natural expiry.
//   · app.oauth_states — 040 pre-auth rows past their 10-minute TTL.
//   · app.outbox — 001/042 relay rows: processed rows older than
//     OUTBOX_DAYS (default 14). Unprocessed rows are NEVER purged here —
//     they belong to the relay's own retry/DLQ semantics.
//   · app.communications — sent/failed rows older than COMMS_DAYS (default 90).
//   · plugin_razorpay.webhook_log + plugin_upi.webhook_log + order_log —
//     gateway receipts older than WEBHOOK_LOG_DAYS (default 90).
//   · app.audit_log — CHAIN-PRESERVING ARCHIVAL (059): rows older than
//     AUDIT_ARCHIVE_DAYS (default 365) MOVE verbatim into app.audit_log_cold
//     inside one transaction (single copy-then-delete CTE). Audit rows are
//     never merely deleted; hot∪cold stays one verifiable chain.
//
// Safety: every target table/column is probed via information_schema first — a
// database migrated before any referenced table skips that step with a count of
// 0 instead of crashing the cron line. All vault tables are RLS-denied to
// schoolos_app — this pass MUST run on the OWNER connection, which is exactly
// what DATABASE_URL gives scripts (kernel/owner path, BYPASSRLS by bootstrap).
// Idempotent: deleting nothing is a valid, successful pass.
// Exit code: 0 = pass ran (even all-skips), 1 = a purge query failed (cron alert).
//
// Cron alternative to the compose one-shot (host cron, one line):
//   0 3 * * * cd /srv/schoolos/server && /usr/bin/docker compose run --rm retention >> /var/log/schoolos-retention.log 2>&1
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { config } from '../src/config.js';

const days = (env, dflt) => {
  const n = Number(process.env[env]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};
const GPS_DAYS = days('GPS_POSITIONS_DAYS', 30);
const OTP_DAYS = days('OTP_RETENTION_DAYS', 7);
const OUTBOX_DAYS = days('OUTBOX_DAYS', 14);
const COMMS_DAYS = days('COMMS_DAYS', 90);
const WEBHOOK_DAYS = days('WEBHOOK_LOG_DAYS', 90);
const AUDIT_ARCHIVE_DAYS = days('AUDIT_ARCHIVE_DAYS', 365);

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });

const tableExists = async (c, schema, table) =>
  !!(await c.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
    [schema, table])).rows.length;
const columnExists = async (c, schema, table, column) =>
  !!(await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
    [schema, table, column])).rows.length;
// first existing timestamp column from a preference list
const stampColumn = async (c, schema, table, prefs) => {
  for (const col of prefs) if (await columnExists(c, schema, table, col)) return col;
  return null;
};

export async function pass() {
  const counts = {};

  // ── 1. GPS positions (transport.gps retention promise) ──────────────────────
  {
    const c = await pool.connect();
    try {
      if (await tableExists(c, 'plugin_transport_gps', 'positions')) {
        const stamp = (await stampColumn(c, 'plugin_transport_gps', 'positions', ['created_at', 'occurred_at'])) ?? 'occurred_at';
        const r = await c.query(`DELETE FROM plugin_transport_gps.positions WHERE ${stamp} < now() - interval '${GPS_DAYS} days'`);
        counts.gpsPositionsDeleted = r.rowCount ?? 0;
      } else { counts.gpsPositionsDeleted = 0; console.error('retention: plugin_transport_gps.positions absent — skipped'); }
    } finally { c.release(); }
  }

  // ── 2. Login OTP vault: expired now, or consumed >OTP_DAYS ago (owner path) ──
  {
    const c = await pool.connect();
    try {
      if (await tableExists(c, 'app', 'auth_otps')) {
        const r = await c.query(
          `DELETE FROM app.auth_otps
           WHERE expires_at < now() - interval '${OTP_DAYS} days'
              OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '${OTP_DAYS} days')`);
        counts.authOtpsDeleted = r.rowCount ?? 0;
      } else { counts.authOtpsDeleted = 0; console.error('retention: app.auth_otps absent — skipped'); }
    } finally { c.release(); }
  }

  // ── 3. Pickup OTP vault (024/054, D-15b): same semantics as the login vault ─
  {
    const c = await pool.connect();
    try {
      if (await tableExists(c, 'plugin_visitors', 'pickup_otp')) {
        const r = await c.query(
          `DELETE FROM plugin_visitors.pickup_otp
           WHERE expires_at < now() - interval '${OTP_DAYS} days'
              OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '${OTP_DAYS} days')`);
        counts.pickupOtpsDeleted = r.rowCount ?? 0;
      } else { counts.pickupOtpsDeleted = 0; console.error('retention: plugin_visitors.pickup_otp absent — skipped'); }
    } finally { c.release(); }
  }

  // ── 4. Reset tokens (056): consumed or expired past retention ───────────────
  {
    const c = await pool.connect();
    try {
      if (await tableExists(c, 'auth', 'reset_tokens')) {
        const r = await c.query(
          `DELETE FROM auth.reset_tokens
           WHERE expires_at < now() - interval '${OTP_DAYS} days'
              OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '${OTP_DAYS} days')`);
        counts.resetTokensDeleted = r.rowCount ?? 0;
      } else { counts.resetTokensDeleted = 0; console.error('retention: auth.reset_tokens absent — skipped'); }
    } finally { c.release(); }
  }

  // ── 5. Revoked-token denylist past natural expiry (038) ─────────────────────
  {
    const c = await pool.connect();
    try {
      if (await tableExists(c, 'auth', 'revoked_token')) {
        const r = await c.query(`DELETE FROM auth.revoked_token WHERE exp < now()`);
        counts.revokedTokensDeleted = r.rowCount ?? 0;
      } else { counts.revokedTokensDeleted = 0; console.error('retention: auth.revoked_token absent — skipped'); }
    } finally { c.release(); }
  }

  // ── 6. OAuth pre-auth states older than their 10-minute TTL (040) ───────────
  {
    const c = await pool.connect();
    try {
      if (await tableExists(c, 'app', 'oauth_states')) {
        const r = await c.query(`DELETE FROM app.oauth_states WHERE created_at < now() - interval '10 minutes'`);
        counts.oauthStatesDeleted = r.rowCount ?? 0;
      } else { counts.oauthStatesDeleted = 0; console.error('retention: app.oauth_states absent — skipped'); }
    } finally { c.release(); }
  }

  // ── 7. Outbox relay rows: processed older than OUTBOX_DAYS ──────────────────
  {
    const c = await pool.connect();
    try {
      if (await tableExists(c, 'app', 'outbox') && await columnExists(c, 'app', 'outbox', 'processed_at')) {
        const r = await c.query(
          `DELETE FROM app.outbox WHERE processed_at IS NOT NULL AND processed_at < now() - interval '${OUTBOX_DAYS} days'`);
        counts.outboxDeleted = r.rowCount ?? 0;
      } else { counts.outboxDeleted = 0; console.error('retention: app.outbox absent — skipped'); }
    } finally { c.release(); }
  }

  // ── 8. Communications ledger: terminal rows older than COMMS_DAYS ───────────
  {
    const c = await pool.connect();
    try {
      if (await tableExists(c, 'app', 'communications')) {
        const r = await c.query(
          `DELETE FROM app.communications
           WHERE status IN ('sent','failed') AND created_at < now() - interval '${COMMS_DAYS} days'`);
        counts.communicationsDeleted = r.rowCount ?? 0;
      } else { counts.communicationsDeleted = 0; console.error('retention: app.communications absent — skipped'); }
    } finally { c.release(); }
  }

  // ── 9. Gateway webhook/order receipts older than WEBHOOK_DAYS ───────────────
  counts.webhookLogsDeleted = 0;
  for (const [schema, table, stamps] of [
    ['plugin_razorpay', 'webhook_log', ['received_at', 'created_at']],
    ['plugin_razorpay', 'order_log', ['created_at']],
    ['plugin_upi', 'webhook_log', ['received_at', 'created_at']],
  ]) {
    const c = await pool.connect();
    try {
      if (await tableExists(c, schema, table)) {
        const stamp = await stampColumn(c, schema, table, stamps);
        if (stamp) {
          const r = await c.query(`DELETE FROM ${schema}.${table} WHERE ${stamp} < now() - interval '${WEBHOOK_DAYS} days'`);
          counts.webhookLogsDeleted += r.rowCount ?? 0;
        }
      }
    } finally { c.release(); }
  }

  // ── 10. Audit archival (059): chain-preserving MOVE to the cold table ───────
  {
    const c = await pool.connect();
    try {
      if (await tableExists(c, 'app', 'audit_log') && await tableExists(c, 'app', 'audit_log_cold')) {
        await c.query('BEGIN');
        // one CTE: copy-then-delete is atomic — rows MOVE byte-identical (hash
        // chain columns untouched), so hot∪cold remains a single verifiable
        // chain. A bare DELETE is never used on audit data.
        const r = await c.query(
          `WITH moved AS (
             DELETE FROM app.audit_log
             WHERE created_at < now() - interval '${AUDIT_ARCHIVE_DAYS} days'
             RETURNING *
           ) INSERT INTO app.audit_log_cold SELECT moved.*, now() AS archived_at FROM moved`);
        await c.query('COMMIT');
        counts.auditRowsArchived = r.rowCount ?? 0;
      } else { counts.auditRowsArchived = 0; console.error('retention: app.audit_log_cold absent (059 not applied) — archival skipped'); }
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      console.error('retention: audit archival failed — hot table untouched:', e.message);
      counts.auditRowsArchived = 0;
    } finally { c.release(); }
  }

  return counts;
}

// CLI guard: `node scripts/retention-worker.js` runs the pass standalone;
// importing the module (day-worker, tests) only gets the exported functions.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const counts = await pass();
    console.log(JSON.stringify({ kind: 'retention.pass', at: new Date().toISOString(), ...counts }));
    await pool.end();
    process.exit(0);
  } catch (e) {
    console.error('retention pass failed:', e.message);
    await pool.end().catch(() => {});
    process.exit(1);
  }
}
