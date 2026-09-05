// Migration runner — applies SQL files in order, tracked in schema_migrations.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const client = new pg.Client({ connectionString: config.databaseUrl });
await client.connect();

await client.query(`CREATE SCHEMA IF NOT EXISTS app`);
await client.query(`CREATE TABLE IF NOT EXISTS app.schema_migrations (
  name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

const applied = new Set((await client.query('SELECT name FROM app.schema_migrations')).rows.map(r => r.name));
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

for (const f of files) {
  if (applied.has(f)) { console.log(`skip ${f}`); continue; }
  const sql = readFileSync(join(dir, f), 'utf8');
  console.log(`applying ${f} …`);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO app.schema_migrations(name) VALUES ($1)', [f]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`FAILED ${f}: ${e.message}`);
    process.exit(1);
  }
}
console.log('migrations up to date');
await client.end();
