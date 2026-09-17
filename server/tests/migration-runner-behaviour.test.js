// FEX-12 — the migration RUNNER's behavioural contract, not just its SQL pre-processing.
//
// `migration-runner.test.js` pins `stripTopLevelTransactions` (the DATX-6 fix) but the register's FEX-12
// asks for the runner itself: that two concurrent runs cannot double-apply, that an edited (drifted)
// migration is refused, that a NULL checksum needs an explicit rebaseline, and that a failing file rolls
// its transaction back so a half-applied migration never sticks. Those are the guarantees the runner's own
// header advertises; none of them had a test.
//
// The test drives the REAL `scripts/migrate.js` as a child process against a scratch database, with
// MIGRATIONS_DIR pointed at a temp directory, so it exercises the shipped code path without touching the
// repository's migrations or the shared test database.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATE = join(SERVER_ROOT, 'scripts', 'migrate.js');
const ADMIN = 'postgres://postgres@127.0.0.1:5432/postgres';
const DB = process.env.FEX12_DB ?? 'schoolos_fex12';
const URL_ = `postgres://schoolos:schoolos_dev_pw@127.0.0.1:5432/${DB}`;

const spawnRun = (env = {}) => {
  const child = spawn(process.execPath, [MIGRATE], {
    cwd: SERVER_ROOT, env: { ...process.env, DATABASE_URL: URL_, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return new Promise((resolve) => child.on('exit', (code) => resolve({ code, out })));
};

const admin = async (text) => {
  const c = new pg.Client({ connectionString: ADMIN });
  await c.connect();
  try { return await c.query(text); } finally { await c.end(); }
};
const scratch = async (fn) => {
  const c = new pg.Client({ connectionString: URL_ });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
};

let dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fex12-'));
  await admin(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin(`CREATE DATABASE ${DB} OWNER schoolos`);
});

after(async () => {
  await admin(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  rmSync(dir, { recursive: true, force: true });
});

describe('FEX-12 · the migration runner is single-writer, drift-proof and atomic', () => {
  test('two concurrent runners apply each migration exactly once (advisory lock)', async () => {
    const d = mkdtempSync(join(tmpdir(), 'fex12-conc-'));
    try {
      for (let i = 1; i <= 5; i++) writeFileSync(join(d, `00${i}_t${i}.sql`), `CREATE TABLE app.conc_${i} (id int);`);
      const [a, b] = await Promise.all([
        spawnRun({ MIGRATIONS_DIR: d, FEX12_CONC: '1' }),
        spawnRun({ MIGRATIONS_DIR: d, FEX12_CONC: '2' }),
      ]);
      assert.equal(a.code, 0, `runner A failed: ${a.out}`);
      assert.equal(b.code, 0, `runner B failed: ${b.out}`);
      const { rows } = await scratch((c) => c.query('SELECT name, count(*)::int n FROM app.schema_migrations GROUP BY name'));
      assert.equal(rows.length, 5, `expected 5 tracked files, got ${JSON.stringify(rows)}`);
      for (const r of rows) assert.equal(r.n, 1, `${r.name} was applied ${r.n} times — the advisory lock did not serialize the runners`);
      const tables = await scratch((c) => c.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='app' AND table_name LIKE 'conc_%'`));
      assert.equal(tables.rows[0].n, 5);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a migration that fails mid-file rolls back, so the runner never leaves a partial schema', async () => {
    const d = mkdtempSync(join(tmpdir(), 'fex12-roll-'));
    try {
      writeFileSync(join(d, '001_ok.sql'), 'CREATE TABLE app.roll_ok (id int);');
      writeFileSync(join(d, '002_bad.sql'), 'CREATE TABLE app.roll_partial (id int);\nSELECT * FROM app.no_such_table_here;');
      const r = await spawnRun({ MIGRATIONS_DIR: d });
      assert.equal(r.code, 1, `the run must exit non-zero, got ${r.code}: ${r.out}`);
      assert.match(r.out, /FAILED 002_bad\.sql/);
      const ok = await scratch((c) => c.query(`SELECT to_regclass('app.roll_ok') AS t`));
      assert.ok(ok.rows[0].t, 'the committed first migration must survive');
      const partial = await scratch((c) => c.query(`SELECT to_regclass('app.roll_partial') AS t`));
      assert.equal(partial.rows[0].t, null, 'the failed file must leave NO partial objects — the transaction rolled back');
      const tracked = await scratch((c) => c.query(`SELECT count(*)::int n FROM app.schema_migrations WHERE name='002_bad.sql'`));
      assert.equal(tracked.rows[0].n, 0, 'a failed file is not recorded as applied');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('an applied file edited on disk is refused as drift', async () => {
    const d = mkdtempSync(join(tmpdir(), 'fex12-drift-'));
    try {
      writeFileSync(join(d, '001_a.sql'), 'CREATE TABLE app.drift_a (id int);');
      assert.equal((await spawnRun({ MIGRATIONS_DIR: d })).code, 0);
      // Tamper with the RECORDED checksum (we may not edit the applied file in the repo, and the point
      // is the same: recorded history no longer matches what is on disk).
      await scratch((c) => c.query(`UPDATE app.schema_migrations SET checksum='deadbeef' WHERE name='001_a.sql'`));
      const r = await spawnRun({ MIGRATIONS_DIR: d });
      assert.equal(r.code, 1, `drift must fail the run: ${r.out}`);
      assert.match(r.out, /drifted after apply/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a NULL checksum requires an explicit MIGRATION_REBASELINE, then heals', async () => {
    const d = mkdtempSync(join(tmpdir(), 'fex12-rebase-'));
    try {
      writeFileSync(join(d, '001_b.sql'), 'CREATE TABLE app.rebase_b (id int);');
      assert.equal((await spawnRun({ MIGRATIONS_DIR: d })).code, 0);
      await scratch((c) => c.query(`UPDATE app.schema_migrations SET checksum=NULL WHERE name='001_b.sql'`));
      const refused = await spawnRun({ MIGRATIONS_DIR: d });
      assert.equal(refused.code, 1, 'a NULL checksum must not silently bless whatever is on disk');
      assert.match(refused.out, /no recorded checksum/);
      const healed = await spawnRun({ MIGRATIONS_DIR: d, MIGRATION_REBASELINE: 'true' });
      assert.equal(healed.code, 0, healed.out);
      const rec = await scratch((c) => c.query(`SELECT checksum FROM app.schema_migrations WHERE name='001_b.sql'`));
      assert.ok(rec.rows[0].checksum && rec.rows[0].checksum !== '', 'the rebaseline records a real checksum');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
