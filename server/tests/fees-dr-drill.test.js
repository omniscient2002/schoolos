// FEE-OPS-4 — a REAL money-path restore drill, not a source-string assertion.
//
// The register's complaint: there was no drill that proved the fee LEDGER and RECEIPTS survive a restore.
// This test executes the actual tools:
//   1. write a fee obligation, a confirmed payment, its allocation and its immutable receipt;
//   2. `pg_dump` the database;
//   3. restore it into a fresh database;
//   4. run the shipped `scripts/money-dr-drill.js` against the restored copy;
//   5. assert it reports ok — the audit hash chain verifies, the ledger invariants hold, and every receipt
//      still points at its payment.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { setupTestDb, TEST_DB, TEST_URL } from './helpers.js';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = 'postgres://postgres@127.0.0.1:5432/postgres';
const RESTORE_DB = `${TEST_DB}_moneydrill`;
const RESTORE_URL = TEST_URL.replace(`/${TEST_DB}`, `/${RESTORE_DB}`);

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
let studentId;
let tmp;
let paymentId;

before(async () => {
  await setupTestDb();
  tmp = mkdtempSync(join(tmpdir(), 'fee-drill-'));
  tenantId = (await owner(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  studentId = (await owner(`SELECT id FROM app.students WHERE tenant_id=$1 LIMIT 1`, [tenantId])).rows[0].id;
});

after(async () => {
  await admin(`DROP DATABASE IF EXISTS ${RESTORE_DB} WITH (FORCE)`).catch(() => {});
  rmSync(tmp, { recursive: true, force: true });
});

describe('FEE-OPS-4 · the money ledger and receipts survive a restore', () => {
  test('restored copy passes the money drill: hash chain, ledger invariants, receipts', async () => {
    // 1. a real money fixture: obligation → confirmed payment → allocation → receipt
    const ob = (await owner(
      `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, amount_cents)
       VALUES ($1,$2,'Drill','Drill Fee',100000) RETURNING id`, [tenantId, studentId])).rows[0];
    const p = (await owner(
      `INSERT INTO app.payments (tenant_id, student_id, obligation_id, amount_cents, method, status, gateway_ref, receipt_no, settled_via, reconciliation_status)
       VALUES ($1,$2,$3,100000,'cash','confirmed','MANUAL','RCP-DRILL-1','manual','manual') RETURNING id`,
      [tenantId, studentId, ob.id])).rows[0];
    paymentId = p.id;
    await owner(`UPDATE app.fee_obligations SET paid_cents=100000, status='paid' WHERE id=$1`, [ob.id]);
    await owner(
      `INSERT INTO app.payment_allocations (tenant_id, payment_id, obligation_id, amount_cents) VALUES ($1,$2,$3,100000)`,
      [tenantId, p.id, ob.id]);
    await owner(
      `INSERT INTO app.fee_receipts (tenant_id, payment_id, receipt_no, student_id, amount_cents)
       VALUES ($1,$2,'RCP-DRILL-1',$3,100000)`, [tenantId, p.id, studentId]);

    // 2. genuine backup
    const dump = join(tmp, 'money.dump');
    execFileSync('pg_dump', ['--format=custom', '--no-password', '-f', dump, TEST_URL], { stdio: 'pipe' });
    assert.ok(statSync(dump).size > 0, 'the dump must be non-empty');

    // 3. genuine restore
    await admin(`DROP DATABASE IF EXISTS ${RESTORE_DB} WITH (FORCE)`);
    await admin(`CREATE DATABASE ${RESTORE_DB} OWNER schoolos`);
    execFileSync('pg_restore', ['--no-password', '-d', RESTORE_URL, dump], { stdio: 'pipe' });

    // 4. run the SHIPPED money drill against the restored copy
    const out = execFileSync('node', ['scripts/money-dr-drill.js'], {
      cwd: SERVER_ROOT, encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: RESTORE_URL },
    });
    const report = JSON.parse(out);
    assert.equal(report.ok, true, `the restored ledger must pass the drill: ${out}`);
    const meridian = report.tenants.find((t) => t.slug === 'meridian');
    assert.ok(meridian.counts.payments >= 1, 'the confirmed payment survived');
    assert.ok(meridian.counts.receipts >= 1, 'the receipt survived');
    assert.equal(meridian.auditBreaks, 0, 'the audit hash chain still verifies after the restore');
    assert.equal(meridian.badReceipts, 0, 'every receipt still points at its payment');
    assert.equal(meridian.orphanAllocations, 0, 'every allocation still points at its payment and obligation');
  });
});
