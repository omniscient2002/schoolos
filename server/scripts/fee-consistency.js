// fee-consistency.js · L5 runner: executes fee-consistency.sql per tenant (or one
// tenant via TENANT=slug|uuid) and exits non-zero with the violating rows.
// CI: node scripts/fee-consistency.js            (DATABASE_URL must be set)
// Cron: TENANT=<slug> node scripts/fee-consistency.js
import pg from 'pg';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sqlText = fs.readFileSync(join(root, 'scripts', 'fee-consistency.sql'), 'utf8');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  let tenant = process.env.TENANT ?? null;
  if (tenant && !tenant.includes('-')) {
    const r = await c.query(`SELECT id FROM app.tenants WHERE slug=$1`, [tenant]);
    if (!r.rows[0]) { console.error(`unknown tenant slug: ${tenant}`); process.exit(2); }
    tenant = r.rows[0].id;
  }
  // pg has no psql :'var' substitution: replace with a literal (NULL = all tenants).
  // Strip psql meta-commands and full-line comments first (a stale split once
  // filtered out EVERY check and reported a false CLEAN — never again: assert count).
  let violations = 0;
  const scrubbed = sqlText.split('\n').filter((l) => !/^\s*(--|\\pset)/.test(l)).join('\n');
  const withTenant = scrubbed.replace(/:'tenant'/g, tenant ? `'${tenant}'` : 'NULL');
  const stmts = withTenant.split(/;/).map((s) => s.trim()).filter((s) => /^SELECT/i.test(s));
  console.log(`running ${stmts.length} consistency checks${tenant ? ` for tenant ${tenant}` : ' (all tenants)'}`);
  if (stmts.length < 10) { console.error('CHECK-ERROR: expected ≥10 checks, splitter is broken'); process.exit(2); }
  for (const s of stmts) {
    let rows;
    try { rows = (await c.query(s)).rows; }
    catch (e) { console.error('CHECK-ERROR:', e.message); violations += 1000; continue; }
    if (rows.length) {
      violations += rows.length;
      console.log(`VIOLATION x${rows.length}:`, JSON.stringify(rows.slice(0, 5)));
    }
  }
  console.log(violations === 0 ? 'CONSISTENCY CLEAN' : `CONSISTENCY VIOLATIONS: ${violations}`);
  process.exit(violations === 0 ? 0 : 1);
} finally { await c.end(); }
