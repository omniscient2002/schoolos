// One-time bootstrap: creates the constrained app role. Requires superuser or CREATEROLE.
// D-15a (L2, Waves 2-5 run): this script MIRRORS migration 054's tightened grant
// matrix instead of the Wave-A blanket GRANT ALL — otherwise every fresh
// bootstrap re-widened the revokes. Fresh dev/live databases now start at the
// tightened posture without rerunning 054 (test DBs keep L1's grant-independent
// fixtures either way).
import pg from 'pg';
import { config } from '../src/config.js';

// same host/db as DATABASE_URL, but as the superuser (role + grant management)
const adminUrl = process.env.ADMIN_DATABASE_URL
  ?? (() => { const u = new URL(config.databaseUrl); u.username = 'postgres'; u.password = process.env.ADMIN_PASSWORD ?? ''; return u.toString(); })();
const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
const res = await client.query(`SELECT 1 FROM pg_roles WHERE rolname='schoolos_app'`);
if (res.rowCount === 0) {
  const appRolePw = process.env.APP_ROLE_PASSWORD ?? 'schoolos_app_pw';
    await client.query(`CREATE ROLE schoolos_app LOGIN PASSWORD '${appRolePw.replace(/'/g, "''")}' NOINHERIT`);
  console.log('created role schoolos_app');
}
await client.query(`GRANT schoolos_app TO schoolos`); // owner may SET ROLE into the constrained role

// ── schema app: baseline (054 matrix) ──────────────────────────────────────────
await client.query(`GRANT USAGE ON SCHEMA app TO schoolos_app`);
await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA app FROM schoolos_app`);
await client.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA app TO schoolos_app`);
// kill the 005 default-privilege trap for FUTURE tables (same as 054 §6)
await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE schoolos IN SCHEMA app REVOKE ALL ON TABLES FROM schoolos_app`);
await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE schoolos IN SCHEMA app GRANT SELECT, INSERT, UPDATE ON TABLES TO schoolos_app`);

// ── per-table tightening (054 §5) ──────────────────────────────────────────────
await client.query(`REVOKE ALL ON app.audit_log FROM schoolos_app`);            // append-only: kernel function writes
await client.query(`GRANT SELECT ON app.audit_log TO schoolos_app`);            // readable, never writable
await client.query(`REVOKE ALL ON app.auth_otps FROM schoolos_app`);            // login OTP vault — kernel-only
await client.query(`REVOKE INSERT, UPDATE, DELETE ON app.oauth_states FROM schoolos_app`);   // 040: app-readable pre-auth states
await client.query(`REVOKE INSERT, UPDATE, DELETE ON app.schema_migrations FROM schoolos_app`);
await client.query(`REVOKE ALL ON app.ops_counters FROM schoolos_app`);         // metrics flush (050)
await client.query(`REVOKE INSERT, DELETE ON app.tenants FROM schoolos_app`);   // tenants: SELECT,UPDATE only
await client.query(`REVOKE INSERT, UPDATE, DELETE ON app.capability_contracts FROM schoolos_app`); // read-only catalog

// ── auth schema: the denylist is RLS-pinned readable, never writable (054 §7) ──
await client.query(`REVOKE ALL ON auth.revoked_token FROM schoolos_app`);
await client.query(`GRANT SELECT ON auth.revoked_token TO schoolos_app`);

// ── L2 kernel tables (055-057, 066-069): the blanket GRANT above re-widens
//    every table, so these are re-tightened AFTER it — vaults and
//    owner-managed registries stay out of the app role's hands. ─────────────────
for (const t of ['app.api_keys', 'app.webhook_subscriptions', 'app.webhook_deliveries',
  'app.audit_log_cold', 'auth.reset_tokens', 'auth.mfa_secrets', 'auth.mfa_recovery_codes']) {
  await client.query(`REVOKE INSERT, UPDATE, DELETE ON ${t} FROM schoolos_app`);
}

console.log('bootstrap complete (grant matrix mirrors 054)');
await client.end();
