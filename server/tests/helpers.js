// Test harness: fresh isolated database per run.
import pg from 'pg';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = 'postgres://postgres@127.0.0.1:5432/postgres';
export const TEST_DB = 'schoolos_test';
export const TEST_URL = `postgres://schoolos:schoolos_dev_pw@127.0.0.1:5432/${TEST_DB}`;

export async function setupTestDb() {
  // 1) recreate the database cleanly
  const admin = new pg.Client({ connectionString: ADMIN });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB} OWNER schoolos`);
  await admin.end();

  // 2) run bootstrap → migrate → seed against the test db (owner role may SET ROLE)
  const env = { ...process.env, DATABASE_URL: TEST_URL };
  for (const script of ['scripts/migrate.js', 'scripts/bootstrap.js', 'scripts/seed.js']) { // grants AFTER tables exist
    execSync(`node ${script}`, { env, stdio: 'pipe', cwd: SERVER_ROOT });
  }
  // 3) callers must set env BEFORE importing src modules (config reads it at import time)
  process.env.DATABASE_URL = TEST_URL;
  return TEST_URL;
}

export async function loginAs(app, email = 'principal@meridian.edu', password = 'schoolos-demo') {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password }, headers: { 'content-type': 'application/json' } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  return res.json();
}
