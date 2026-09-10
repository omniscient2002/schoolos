// Factory check — the single pre-ship gate. Fails closed on any red lamp:
//   1. permission matrix: every route guarded or reviewed-public (§43)
//   2. DB reachable at DATABASE_URL (5s connect budget — a stopped DB fails here,
//      not with a hang; ops-audit §13: the old "db reachable" step was an
//      un-awaited async placeholder that could never fail)
//   3. migrations applied: every migrations/*.sql on disk is tracked in
//      app.schema_migrations (catches "never migrated" AND partially-migrated)
//   4. RLS baseline: core catalog + revocation vault tables exist
// Each DB step uses its own short-lived client: after a failed connect, pg leaves
// a shared client permanently broken (later queries never settle → node exits 13
// on the unsettled top-level await instead of a clean exit 1). Add further gates
// here; keep each one fail-closed and print its evidence line.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let failed = 0;

const step = async (name, fn) => {
  try { await fn(); console.log(`✔ ${name}`); }
  catch (e) { failed = 1; console.error(`✖ ${name}\n  ${e.message}`); }
};

// Fresh client per step — a dead DB can never wedge the next step's await.
const dbStep = (name, fn) => step(name, async () => {
  const client = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000 });
  client.on('error', () => {}); // async socket errors settle via the query rejections below
  try {
    await client.connect();
    await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
});

await step('permission matrix (§43)', () => new Promise((resolve, reject) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'permission-matrix.js')], { encoding: 'utf8' });
  if (r.status !== 0) reject(new Error((r.stdout || '') + (r.stderr || 'permission-matrix failed')));
  else resolve();
}));

await dbStep(`db reachable (${config.databaseUrl.replace(/\/\/[^@/]*@/, '//***@')})`, async () => {});

await dbStep('migrations applied (every file on disk tracked in app.schema_migrations)', async (client) => {
  const files = readdirSync(join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  const res = await client.query('SELECT name FROM app.schema_migrations');
  const applied = new Set(res.rows.map((r) => r.name));
  const missing = files.filter((f) => !applied.has(f));
  if (missing.length) throw new Error(`${missing.length} migration(s) not applied: ${missing.join(', ')}`);
});

await dbStep('rls baseline: catalog + revocation tables', async (client) => {
  const t = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='app' AND tablename='plugins'`);
  if (!t.rows[0]) throw new Error('app.plugins missing');
  const rev = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='auth' AND tablename='revoked_token'`);
  if (!rev.rows[0]) throw new Error('auth.revoked_token missing — run migrations');
});

console.log(failed ? '✖ check: FAILED' : '✔ check: all green');
process.exit(failed);
