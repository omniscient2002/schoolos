// Test harness: fresh isolated database per run.
import pg from 'pg';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = 'postgres://postgres@127.0.0.1:5432/postgres';
// TEST_DB_NAME (L2, D-34): lets a lane run its own test files against a SEPARATE
// database while S0's gate run holds schoolos_test — e.g. TEST_DB_NAME=schoolos_l2test.
// Default unchanged; the running gate process is unaffected (module already loaded).
export const TEST_DB = process.env.TEST_DB_NAME ?? 'schoolos_test';
export const TEST_URL = `postgres://schoolos:schoolos_dev_pw@127.0.0.1:5432/${TEST_DB}`;

export async function setupTestDb() {
  // 1) recreate the database cleanly
  const admin = new pg.Client({ connectionString: ADMIN });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB} OWNER schoolos`);
  await admin.end();

  // 2) run bootstrap → migrate → seed against the test db (owner role may SET ROLE)
  //
  // ADMIN_DATABASE_URL is set EXPLICITLY rather than inherited, and it must point at the SAME DATABASE as
  // DATABASE_URL with superuser credentials — the scripts do grant work *inside* the target database.
  // `scripts/bootstrap.js` derives it that way itself (`new URL(config.databaseUrl)` with the username swapped
  // to postgres) when the variable is absent, and that derivation is exactly what this pins. Two failure modes
  // came from leaving it to the ambient environment, both harness artifacts rather than product behaviour:
  //   · nothing exported  → bootstrap silently skipped its superuser-only half, including the revocation of the
  //     stray `postgres`-owned default ACL that D-35 depends on, so the D-35 assertions could pass or fail
  //     depending on the developer's shell;
  //   · something exported pointing at the `postgres` maintenance database (the natural mistake, and the one
  //     the harness's own ADMIN constant invites, since it is used above to CREATE the test database) →
  //     bootstrap crashed with `schema "app" does not exist` while looking in the wrong database, failing every
  //     test in the file before a single assertion ran.
  const adminUrl = new URL(TEST_URL);
  adminUrl.username = 'postgres';
  adminUrl.password = process.env.ADMIN_PASSWORD ?? '';
  const env = { ...process.env, DATABASE_URL: TEST_URL, ADMIN_DATABASE_URL: adminUrl.toString() };
  for (const script of ['scripts/migrate.js', 'scripts/bootstrap.js', 'scripts/seed.js']) { // grants AFTER tables exist
    execSync(`node ${script}`, { env, stdio: 'pipe', cwd: SERVER_ROOT });
  }
  // 3) callers must set env BEFORE importing src modules (config reads it at import time)
  process.env.DATABASE_URL = TEST_URL;
  return TEST_URL;
}

export async function loginAs(app, email = 'principal@meridian.edu', password = 'schoolos-demo') {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password }, headers: { 'content-type': 'application/json' } });
  // S0 repair (D-44): temp-password accounts answer 403 {mustChange, token} — the
  // restricted-session contract. Complete the handover like the UI does (set a
  // real password) and return the fresh session, so callers get a usable token.
  if (res.statusCode === 403 && res.json()?.mustChange) {
    const pw = `${password}-Aa1`;
    const setPw = await app.inject({ method: 'POST', url: '/me/password', payload: { currentPassword: password, newPassword: pw }, headers: { 'content-type': 'application/json', authorization: `Bearer ${res.json().token}` } });
    if (setPw.statusCode !== 200) throw new Error(`password handover failed: ${setPw.body}`);
    return setPw.json();
  }
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  return res.json();
}
