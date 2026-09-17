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
  // OPS-2: this used to fall back to the literal 'schoolos_app_pw' — a PUBLISHED password on a LOGIN role
  // that every RLS policy in the system depends on, and no compose service passed the variable, so every
  // stack that did not set it created exactly that. The security model rests on `schoolos_app` being the
  // constrained role, which makes this a credential rather than a convenience.
  //
  // An EXISTING role is left alone (its password may have been set deliberately out of band), so this
  // guard only fires on the path that creates it — which is also the only path where the password is
  // actually used. Fail loudly rather than invent one.
  const appRolePw = process.env.APP_ROLE_PASSWORD;
  if (!appRolePw || appRolePw.length < 12) {
    console.error('bootstrap: ✖ APP_ROLE_PASSWORD must be set (12+ chars) — refusing to create the '
      + 'constrained app role with a default or short password. It is a credential every RLS policy '
      + 'depends on, and the old hardcoded default was public.');
    process.exit(1);
  }
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
await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE schoolos IN SCHEMA app REVOKE ALL ON SEQUENCES FROM schoolos_app`);
await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE schoolos IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO schoolos_app`);

// ── the stray `postgres`-owned default ACL (PERFECT-100 §6.1 item 2, D-35) ─────
// A second default-privilege rule exists in schema `app` that appears in NO repo file and sits outside the
// migration checksum ledger: `{schoolos_app=arwd/postgres}`. Default privileges are keyed by the role that
// CREATES the object, so the `FOR ROLE schoolos` statements just above never touched it — which is why 054's
// revoke did not close this, and why migration 085 can restate the schoolos posture but cannot remove this
// rule: `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` requires the `postgres` role or a superuser, while
// migrations run with `DATABASE_URL` (role `schoolos`).
//
// It belongs HERE because this file is already the superuser path — `ADMIN_DATABASE_URL` is documented at the
// top of this file as connecting "as the superuser (role + grant management)". The rule grants full DML
// INCLUDING DELETE to the app role on every future `app` table, which is exactly what D-35 forbids, so leaving
// it armed means "we revoked the 12 existing grants" is undone by the next migration that adds a table.
//
// Guarded rather than unconditional: if bootstrap is ever invoked without the superuser the attempt raises
// insufficient_privilege, and losing the whole boot over a grant an operator may have scoped away
// deliberately would be the wrong trade. The condition is loud instead — and
// `tests/acl-default-privileges.test.js` fails CI while the rule exists, so it cannot pass unnoticed.
try {
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app REVOKE ALL ON TABLES FROM schoolos_app`);
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app REVOKE ALL ON SEQUENCES FROM schoolos_app`);
  console.log('revoked the stray postgres-owned default ACL in schema app (D-35)');
} catch (e) {
  console.warn(`⚠ could not revoke the postgres-owned default ACL in schema app (${e.code ?? e.message}).\n`
    + '  While it exists, a table created in `app` by the postgres role grants schoolos_app full DML\n'
    + '  including DELETE, violating D-35. Re-run bootstrap with ADMIN_DATABASE_URL set to a superuser.');
}

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
// DATX-15: oauth_states is only ever touched through `sysq` (owner), so the app role needs no grant at all.
// `REVOKE ALL` (not the INSERT/UPDATE/DELETE subset above) because the historical over-grant included
// SELECT, which the block above would leave in place.
await client.query(`REVOKE ALL ON app.oauth_states FROM schoolos_app`);
// AUTH-4/AUTH-8: the throttle table is kernel-only.
await client.query(`REVOKE ALL ON auth.request_throttles FROM schoolos_app`);

// ── D-35: table-level DELETE for the app role, across EVERY data schema ────────
// The baseline above revokes `ALL TABLES IN SCHEMA app` — only `app`. The plugin and `student` schemas were
// never covered even in principle, and the two money ledgers SEC-2b named (`plugin_razorpay.order_log`,
// `plugin_razorpay.webhook_log`) live in `plugin_razorpay`. `scripts/seed.js` then replays migrations that
// re-grant DELETE anyway, so it applies the same tightening as its final step; the shared module is used in
// both places so the two cannot drift.
{
  const { tightenAppRoleDeletes, tightenAppRoleColumns } = await import('../src/grant-tightening.js');
  const { revoked, granted } = await tightenAppRoleDeletes(client);
  console.log(`app-role table DELETE tightened: revoked in ${revoked.length} schema(s), re-granted on ${granted.length || 0} (${granted.join(', ') || 'none'})`);
  // DATX-1: the DELETE tightening alone leaves the baseline's table-level UPDATE/SELECT in place,
  // silently undoing migration 077's column scope. Same module, same last-step rule.
  const cols = await tightenAppRoleColumns(client);
  console.log(`app-role column grants tightened (077 scope re-applied): ${cols.join(', ') || 'none'}`);
}

console.log('bootstrap complete (grant matrix mirrors 054)');
await client.end();
