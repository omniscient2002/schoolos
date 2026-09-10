// CI / fresh-machine provisioning: creates the `schoolos` owner role and the app
// database exactly as server/README.md's quick start, idempotently, so CI (and any
// new machine) can run migrate → test → check without manual psql.
//
// Requires a superuser admin connection:
//   · CI:  the postgres:16 service runs POSTGRES_USER=postgres + trust auth, so the
//          default admin URL (postgres://postgres@127.0.0.1:5432/postgres, no
//          password) connects — the same URL tests/helpers.js uses as ADMIN.
//   · dev: local Postgres with a passwordless/trust admin role (HANDOFF §1).
// Override with ADMIN_DATABASE_URL (same convention as scripts/bootstrap.js).
import pg from 'pg';

const adminUrl = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres';
const APP_ROLE = 'schoolos';
const APP_PASSWORD = process.env.APP_PASSWORD ?? 'schoolos_dev_pw';
const APP_DB = process.env.APP_DB ?? 'schoolos';
// schoolos_app must EXIST before `migrate` on a fresh cluster: 005_grants_refresh.sql
// GRANTs to it (valid without superuser — run by the table owner) and fails with
// `role "schoolos_app" does not exist` otherwise. On dev machines it already exists
// cluster-wide, which is why the test suite's fresh per-file DBs never hit this.
// bootstrap.js stays the grant authority; it no-ops the CREATE when the role exists.
const APP_EXEC_ROLE = 'schoolos_app';
const APP_EXEC_PASSWORD = process.env.APP_EXEC_ROLE_PASSWORD ?? 'schoolos_app_pw';

const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 10000 });
await client.connect();
try {
  const role = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [APP_ROLE]);
  if (role.rowCount === 0) {
    // Mirrors the actual green dev/test shape (HANDOFF §1 + pg_roles on a working
    // machine): LOGIN + CREATEDB + BYPASSRLS. BYPASSRLS on the owner role is the
    // status quo this suite is verified against (FORCE RLS + owner-path seed);
    // server/README.md's quick start omits it — that drift is tracked in the ops
    // audit (D-15), not fixed here.
    await client.query(
      `CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD.replace(/'/g, "''")}' CREATEDB BYPASSRLS`,
    );
    console.log(`ci-init-db: created role ${APP_ROLE}`);
  } else {
    console.log(`ci-init-db: role ${APP_ROLE} exists`);
  }
  const execRole = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [APP_EXEC_ROLE]);
  if (execRole.rowCount === 0) {
    await client.query(
      `CREATE ROLE ${APP_EXEC_ROLE} LOGIN PASSWORD '${APP_EXEC_PASSWORD.replace(/'/g, "''")}' NOINHERIT`,
    );
    console.log(`ci-init-db: created role ${APP_EXEC_ROLE}`);
  } else {
    console.log(`ci-init-db: role ${APP_EXEC_ROLE} exists`);
  }
  const db = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [APP_DB]);
  if (db.rowCount === 0) {
    await client.query(`CREATE DATABASE ${APP_DB} OWNER ${APP_ROLE}`);
    console.log(`ci-init-db: created database ${APP_DB}`);
  } else {
    console.log(`ci-init-db: database ${APP_DB} exists`);
  }
} finally {
  await client.end();
}
console.log('ci-init-db: complete');
