// FEX-13 — a REAL backup → restore → erasure-replay drill, not a source-string assertion.
//
// The register's complaint: `ops-backup.test.js` only greps `backup.sh` for strings, and the restore-time
// erasure replay (`replay-erasure-journal.js`) had zero test references. So the two claims an operator
// relies on — "the dump restores" and "a DPDP redaction survives a restore" — were both unproven. This
// drill executes the actual tools against the actual database:
//   1. insert a guardian with a phone number, and a DPDP erasure-journal row for it (the request);
//   2. `pg_dump` the database (a genuine backup);
//   3. restore it into a fresh database (a genuine restore);
//   4. run the shipped `replay-erasure-journal.js` against the restored copy;
//   5. assert the erased phone is gone in the RESTORED database and the journal is marked replayed.
// Plus a second test that runs `backup.sh` end to end and verifies its artifacts.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { setupTestDb, TEST_DB, TEST_URL } from './helpers.js';
import { encryptValue } from '../src/settings-crypto.js';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = 'postgres://postgres@127.0.0.1:5432/postgres';
const RESTORE_DB = `${TEST_DB}_restore`;
const RESTORE_URL = TEST_URL.replace(`/${TEST_DB}`, `/${RESTORE_DB}`);
const PHONE = '+919845000777';

const admin = async (text) => {
  const c = new pg.Client({ connectionString: ADMIN });
  await c.connect();
  try { return await c.query(text); } finally { await c.end(); }
};
const owner = async (text, params = []) => {
  const c = new pg.Client({ connectionString: TEST_URL });
  await c.connect();
  try { return await c.query(text, params); } finally { await c.end(); }
};

let tenantId;
let tmp;

before(async () => {
  // The DPDP token is sealed with a key derived from PLUGIN_SETTINGS_KEY/JWT_SECRET. The test process does
  // not import config.js (so it would use the fallback), while the replay CHILD loads .env — different keys,
  // so the drill must pin one key for both. Set it before encrypting; the child inherits it, and dotenv does
  // not override an env var that is already set.
  process.env.PLUGIN_SETTINGS_KEY = 'fex13-drill-key';
  await setupTestDb();
  tmp = mkdtempSync(join(tmpdir(), 'fex13-'));
  tenantId = (await owner(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
});

after(async () => {
  await admin(`DROP DATABASE IF EXISTS ${RESTORE_DB} WITH (FORCE)`).catch(() => {});
  rmSync(tmp, { recursive: true, force: true });
});

describe('FEX-13 · a backup restores and the erasure replay survives the restore', () => {
  test('restored copy loses the phone again when the shipped replay runs', async () => {
    // 1. a real phone on a real guardian, and the erasure request that targets it
    const student = (await owner(`SELECT id FROM app.students WHERE tenant_id=$1 LIMIT 1`, [tenantId])).rows[0];
    assert.ok(student, 'fixture: seed must have a student');
    await owner(`INSERT INTO app.guardians (tenant_id, student_id, name, phone) VALUES ($1,$2,$3,$4)`,
      [tenantId, student.id, 'Drill Guardian', PHONE]);
    // the journal token carries the subject in the same shape the DPDP door writes: { subject: <phone> }
    const token = encryptValue({ subject: PHONE }, tenantId);
    await owner(
      `INSERT INTO plugin_dpdp.erasure_journal (tenant_id, subject_key, surrogate, subject_token, executed_by)
       VALUES ($1, $2, $3, $4, 'fex13-drill')
       ON CONFLICT (tenant_id, subject_key) DO UPDATE SET subject_token=EXCLUDED.subject_token, replayed_at=NULL`,
      [tenantId, `fex13:${tenantId}`, '[erased:drill]', token]);
    const before = (await owner(`SELECT count(*)::int n FROM app.guardians WHERE tenant_id=$1 AND phone=$2`, [tenantId, PHONE])).rows[0].n;
    assert.equal(before, 1, 'fixture: the phone is present before the drill');

    // 2. genuine backup
    const dump = join(tmp, 'drill.dump');
    execFileSync('pg_dump', ['--format=custom', '--no-password', '-f', dump, TEST_URL], { stdio: 'pipe' });
    assert.ok(statSync(dump).size > 0, 'the dump must be non-empty');
    execFileSync('pg_restore', ['--list', dump], { stdio: 'pipe' }); // readable archive

    // 3. genuine restore into a fresh database (owner role preserved so the app role can run the replay)
    await admin(`DROP DATABASE IF EXISTS ${RESTORE_DB} WITH (FORCE)`);
    await admin(`CREATE DATABASE ${RESTORE_DB} OWNER schoolos`);
    execFileSync('pg_restore', ['--no-password', '-d', RESTORE_URL, dump], { stdio: 'pipe' });

    // the restored copy still HAS the phone (the dump predates the scrub) — that is the gap replay closes
    const restoredHasPhone = async () => {
      const c = new pg.Client({ connectionString: RESTORE_URL });
      await c.connect();
      try { return (await c.query(`SELECT count(*)::int n FROM app.guardians WHERE tenant_id=$1 AND phone=$2`, [tenantId, PHONE])).rows[0].n; }
      finally { await c.end(); }
    };
    assert.equal(await restoredHasPhone(), 1, 'the restored copy still holds the phone, as a pre-erasure backup would');

    // 4. run the SHIPPED replay against the restored copy
    const out = execFileSync('node', ['scripts/replay-erasure-journal.js'], {
      cwd: SERVER_ROOT, encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: RESTORE_URL, ADMIN_DATABASE_URL: ADMIN },
    });
    assert.match(out, /erasure replay: 1 journal entry reconciled/, `replay output: ${out}`);

    // 5. the redaction now holds in the restored database
    const c = new pg.Client({ connectionString: RESTORE_URL });
    await c.connect();
    try {
      const g = (await c.query(`SELECT count(*)::int n FROM app.guardians WHERE tenant_id=$1 AND phone=$2`, [tenantId, PHONE])).rows[0].n;
      assert.equal(g, 0, 'THE REGRESSION GATE: the phone must be gone after the replay');
      const j = (await c.query(`SELECT replayed_at FROM plugin_dpdp.erasure_journal WHERE tenant_id=$1`, [tenantId])).rows[0];
      assert.ok(j?.replayed_at, 'the journal entry is marked replayed so it is not replayed twice');
    } finally { await c.end(); }
  });

  test('backup.sh produces verified artifacts and clears its completion marker', () => {
    const dir = join(tmp, 'backups');
    const files = join(tmp, 'files');
    execFileSync('mkdir', ['-p', files]);
    const out = execFileSync('bash', [join(SERVER_ROOT, 'scripts', 'backup.sh')], {
      cwd: SERVER_ROOT, encoding: 'utf8',
      env: {
        ...process.env,
        BACKUP_DIR: dir, BACKUP_DATABASES: TEST_DB, BACKUP_RECORD_LAST_RUN: '0', FILES_DIR: files,
        PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'postgres',
      },
    });
    assert.match(out, /✔ .*dumped and verified/, `backup.sh output: ${out}`);
    const date = new Date().toISOString().slice(0, 10);
    const night = join(dir, date);
    for (const f of ['globals.sql', `${TEST_DB}.dump`, 'files.tar.gz']) {
      assert.ok(existsSync(join(night, f)), `${f} must exist in the night directory`);
    }
    assert.ok(!existsSync(join(night, '.incomplete')), 'the completion marker must be cleared on success');
    // and the dump is a readable archive, not just bytes on disk
    assert.doesNotThrow(() => execFileSync('pg_restore', ['--list', join(night, `${TEST_DB}.dump`)], { stdio: 'pipe' }));
  });
});
