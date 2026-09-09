#!/usr/bin/env node
// Retention worker (Wave B) — ONE purge pass, then exit. Built for the compose
// one-shot `retention` service (restart: "no") or a cron line (see bottom);
// it never loops, so a stuck pass cannot pile up.
//
// What it purges (and the promise each purge honors):
//   · plugin_transport_gps.positions — docs/DATA-FLOW §11/§22: "GPS positions
//     (retention promised, purge NOT IMPLEMENTED)". 020 declares retention
//     positions_days:30 → rows older than 30 days. Column note: 020 stamps rows
//     with occurred_at; created_at is preferred when a future migration adds one.
//   · app.auth_otps — 008 OTP vault: rows whose expires_at has passed, or whose
//     consumed_at is older than 7 days (verification secrets must not outlive
//     their purpose by more than a week; visitor pickup OTPs ride the same vault).
//     The vault is RLS-denied to schoolos_app (USING (false)) — this pass MUST run
//     on the OWNER connection, which is exactly what DATABASE_URL gives scripts
//     (the script pool is the kernel/owner path, BYPASSRLS by bootstrap).
//   · auth.revoked_token — 038 jti denylist: entries past their natural expiry are
//     dead weight (the authenticate hook already refuses on exp).
//   · app.oauth_states — 040 pre-auth rows (kept from the earlier draft of this
//     worker): state is single-use with a 10-minute TTL, so anything older is dust.
//
// Safety: every target table is probed via information_schema first — a database
// migrated before 008/020/038/040 (or a worker pointed at a bare kernel) skips that
// step with a count of 0 instead of crashing the cron line. Idempotent: deleting
// nothing is a valid, successful pass. Exit code: 0 = pass ran (even all-skips),
// 1 = a purge query failed (so cron/compose can alert).
//
// Cron alternative to the compose one-shot (host cron, one line):
//   0 3 * * * cd /srv/schoolos/server && /usr/bin/docker compose run --rm retention >> /var/log/schoolos-retention.log 2>&1
import pg from 'pg';
import { config } from '../src/config.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });

const tableExists = async (schema, table) =>
  !!(await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
    [schema, table])).rows.length;
const columnExists = async (schema, table, column) =>
  !!(await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
    [schema, table, column])).rows.length;

async function pass() {
  const counts = {};

  // ── 1. GPS positions older than 30 days (transport.gps retention promise) ───
  if (await tableExists('plugin_transport_gps', 'positions')) {
    const stampCol = (await columnExists('plugin_transport_gps', 'positions', 'created_at')) ? 'created_at' : 'occurred_at';
    const r = await pool.query(`DELETE FROM plugin_transport_gps.positions WHERE ${stampCol} < now() - interval '30 days'`);
    counts.gpsPositionsDeleted = r.rowCount ?? 0;
  } else {
    counts.gpsPositionsDeleted = 0;
    console.error('retention: plugin_transport_gps.positions absent — skipped');
  }

  // ── 2. OTP vault: expired now, or consumed >7d ago (owner path — RLS-denied) ─
  if (await tableExists('app', 'auth_otps')) {
    const r = await pool.query(
      `DELETE FROM app.auth_otps
       WHERE expires_at < now() - interval '7 days'
          OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '7 days')`);
    counts.authOtpsDeleted = r.rowCount ?? 0;
  } else {
    counts.authOtpsDeleted = 0;
    console.error('retention: app.auth_otps absent — skipped');
  }

  // ── 3. Revoked-token denylist past natural expiry (038) ─────────────────────
  if (await tableExists('auth', 'revoked_token')) {
    const r = await pool.query(`DELETE FROM auth.revoked_token WHERE exp < now()`);
    counts.revokedTokensDeleted = r.rowCount ?? 0;
  } else {
    counts.revokedTokensDeleted = 0;
    console.error('retention: auth.revoked_token absent — skipped');
  }

  // ── 4. OAuth pre-auth states older than their 10-minute TTL (040) ───────────
  if (await tableExists('app', 'oauth_states')) {
    const r = await pool.query(`DELETE FROM app.oauth_states WHERE created_at < now() - interval '10 minutes'`);
    counts.oauthStatesDeleted = r.rowCount ?? 0;
  } else {
    counts.oauthStatesDeleted = 0;
    console.error('retention: app.oauth_states absent — skipped');
  }

  return counts;
}

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
