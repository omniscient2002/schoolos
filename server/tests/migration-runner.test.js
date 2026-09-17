// DATX-6 / FEX-12 — the migration runner's SQL pre-processing, plus the runner's drift/idempotence
// contract at the unit level (a full concurrent-runner / restore test needs a cluster; this pins the
// deterministic part that ships).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripTopLevelTransactions } from '../src/migration-sql.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'migrations');

describe('DATX-6 · the runner strips top-level BEGIN;/COMMIT; but never inside a routine', () => {
  test('a top-level BEGIN;/COMMIT; wrapper is removed', () => {
    const out = stripTopLevelTransactions('BEGIN;\nCREATE TABLE t (id int);\nCOMMIT;\n');
    assert.ok(!/\bBEGIN\b/i.test(out), `BEGIN survived: ${JSON.stringify(out)}`);
    assert.ok(!/\bCOMMIT\b/i.test(out), 'COMMIT survived');
    assert.match(out, /CREATE TABLE t/);
  });

  test('a PL/pgSQL body inside $$ … $$ is preserved verbatim', () => {
    const sql = `CREATE FUNCTION f() RETURNS void AS $$\nBEGIN\n  DELETE FROM t;\nEND;\n$$ LANGUAGE plpgsql;`;
    assert.equal(stripTopLevelTransactions(sql), sql, 'a routine body must not be touched');
  });

  test('a single-quoted body and a line comment are preserved', () => {
    const sql = `SELECT 'BEGIN; not a transaction';\n-- BEGIN; in a comment\nSELECT 1;`;
    assert.equal(stripTopLevelTransactions(sql), sql);
  });

  test('no migration file leaves a top-level BEGIN; / COMMIT; after stripping', () => {
    for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql'))) {
      const stripped = stripTopLevelTransactions(readFileSync(join(MIGRATIONS, f), 'utf8'));
      assert.ok(!/^\s*(BEGIN|COMMIT)\s*;/im.test(stripped),
        `${f} still has a top-level BEGIN;/COMMIT; after stripping — it would close the runner's transaction`);
    }
  });
});
