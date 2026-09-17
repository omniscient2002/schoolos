// Migration runner — applies SQL files in order, tracked in app.schema_migrations.
// Ops audit P1-8 hardening:
//   · SINGLE WRITER — the whole run is serialized by pg_advisory_lock(727272)
//     (session-scoped, released in `finally`): two concurrent runners (docker-compose
//     api + a human psql session, two pods racing at boot) can no longer double-apply.
//   · DRIFT DETECTION — every applied file's sha256 is recorded at apply time
//     (`checksum` column, added idempotently by 041 + re-ensured here because a fresh
//     database must have the column before 041 itself applies) and re-verified on
//     every later run. A file edited AFTER it was applied is a hard failure: silent
//     history rewrites make rebuilds untrustworthy ("migration file drifted after apply").
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config.js';
import { stripTopLevelTransactions } from '../src/migration-sql.js';

const LOCK_ID = 727272;
// MIGRATIONS_DIR lets the runner's behavioural test point it at a scratch directory (FEX-12); the
// default is the repository's own migrations, unchanged for every real boot.
const dir = process.env.MIGRATIONS_DIR ? resolve(process.env.MIGRATIONS_DIR) : join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const client = new pg.Client({ connectionString: config.databaseUrl });
await client.connect();

const sha256 = (f) => createHash('sha256').update(readFileSync(join(dir, f))).digest('hex');

let failed = false;
try {
  // P1-8: block until any concurrent runner finishes (session-level lock).
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);

  await client.query('CREATE SCHEMA IF NOT EXISTS app');
  await client.query(`CREATE TABLE IF NOT EXISTS app.schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  // Mirror of 041_migration_checksums.sql — needed BEFORE 041 itself applies on a
  // fresh database, so the very first run can stamp checksums at apply time.
  await client.query('ALTER TABLE app.schema_migrations ADD COLUMN IF NOT EXISTS checksum text');

  const rows = (await client.query('SELECT name, checksum FROM app.schema_migrations')).rows;
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  // Drift check first: refuse to touch anything if recorded history no longer matches disk.
  for (const f of files) {
    if (!applied.has(f)) continue;
    const onDisk = sha256(f);
    const recorded = applied.get(f);
    if (recorded == null) {
      // A NULL checksum is historical state, not permission to silently bless
      // whatever happens to be on disk. Re-baselining is an explicit operator
      // action so an edited migration cannot launder itself on the next boot.
      if (process.env.MIGRATION_REBASELINE !== 'true') {
        throw new Error(`migration ${f} has no recorded checksum — set MIGRATION_REBASELINE=true for an explicit one-time rebaseline`);
      }
      await client.query('UPDATE app.schema_migrations SET checksum=$1 WHERE name=$2', [onDisk, f]);
      console.warn(`checksum rebaselined explicitly ${f}`);
    } else if (recorded !== onDisk) {
      throw new Error(`migration file drifted after apply: ${f} (recorded ${recorded.slice(0, 12)}…, on disk ${onDisk.slice(0, 12)}…) — restore the file or re-baseline deliberately`);
    }
  }

  for (const f of files) {
    if (applied.has(f)) { console.log(`skip ${f}`); continue; }
    // DATX-6: 031/034-040 carry a top-level BEGIN;/COMMIT; that would close the runner's transaction
    // early. Strip them so the per-file transaction stays atomic. (Editing an applied file is forbidden,
    // so this belongs in the runner.)
    const sql = stripTopLevelTransactions(readFileSync(join(dir, f), 'utf8'));
    console.log(`applying ${f} …`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO app.schema_migrations(name, checksum) VALUES ($1, $2)', [f, sha256(f)]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`FAILED ${f}: ${e.message}`);
    }
  }
  console.log('migrations up to date');
} catch (e) {
  failed = true;
  console.error(e.message);
} finally {
  try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]); } catch { /* session gone */ }
  await client.end();
}
if (failed) process.exit(1);
