// Rigorous coverage for the register rows GPT Luna's follow-up batches claimed to close but left with only
// source-string assertions or none at all: PLG-1b (scoped kernel facilities), PLG-2c (plan availability),
// OPS-20 (workers use the named owner path + event spine), DAT-12 (NOT VALID checks that still fail new
// writes) and DAT-9 (the authored indexes actually exist and are valid).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setupTestDb, loginAs } from './helpers.js';
import { scopedKernel } from '../src/plugin-permissions.js';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(SERVER_ROOT, 'migrations');
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

let app, pool, sql, tenantId;

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  const db = await import('../src/db.js');
  pool = db.pool;
  sql = (t, p = []) => pool.query(t, p);
  tenantId = (await sql(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
});
after(async () => { if (app) await app.close(); });

// ── PLG-1b · the manifest is the ceiling for kernel facilities ─────────────────────────────────────
describe('PLG-1b · scopedKernel enforces the manifest at the call site', () => {
  test('an undeclared facility is refused with an audited PERMISSION_DENIED, never silently run', async () => {
    const ledger = [];
    const kernel = {
      auditLog: async (_c, _t, entry) => { ledger.push(entry); return { id: 'a' }; },
      emitEvent: async (_c, _t, _ev, _topic, _payload, opts) => { ledger.push({ emit: opts }); return { id: 'e' }; },
      // a non-facility kernel property must still pass through the facade
      withUser: () => 'passthrough',
    };
    const scoped = scopedKernel(kernel, 'demo.plugin', ['events.emit']); // NOT audit.request
    assert.equal(scoped.withUser(), 'passthrough', 'the facade spreads the kernel, so unrelated helpers remain');
    await assert.rejects(
      scoped.auditLog({}, tenantId, { action: 'sneaky write' }),
      (e) => e.code === 'PERMISSION_DENIED' && e.statusCode === 403,
      'an undeclared audit must fail at the call site');
    const denial = ledger.find((e) => String(e.action).startsWith('Plugin facility denied'));
    assert.ok(denial, 'THE REGRESSION GATE: the refusal itself is a ledger row, not a silent no-op');
    assert.equal(denial.recordRef, 'demo.plugin');
  });

  test('a declared facility runs, and a plugin cannot forge another emitter identity', async () => {
    const ledger = [];
    const kernel = {
      auditLog: async () => ({ id: 'a' }),
      emitEvent: async (_c, _t, _ev, _topic, _payload, opts) => { ledger.push(opts); return { id: 'e' }; },
    };
    const scoped = scopedKernel(kernel, 'demo.plugin', ['events.emit']);
    await scoped.emitEvent({}, tenantId, { type: 'demo', label: 'x' }, 'demo.topic', {}, { emittedBy: 'kernel' });
    assert.equal(ledger[0].emittedBy, 'plugin:demo.plugin',
      'the loaded module, not the caller argument, is the provenance authority');

    const auditLedger = [];
    const kernel2 = { auditLog: async (_c, _t, e) => { auditLedger.push(e); return { id: 'a' }; } };
    const scoped2 = scopedKernel(kernel2, 'other.plugin', ['audit.request']);
    await scoped2.requestAudit({}, tenantId, 'other.plugin', { action: 'ok' });
    assert.equal(auditLedger[0].actorRole, 'plugin:other.plugin');
  });
});

// ── PLG-2c · /plugins tells a school what its plan includes ────────────────────────────────────────
describe('PLG-2c · availability is derived from the tenant plan', () => {
  test('GET /plugins reports available + requiredPlan, and the enable door answers 402', async () => {
    const owner = await loginAs(app, 'owner@meridian.edu');
    await sql(`UPDATE app.tenants SET plan='trial' WHERE id=$1`, [tenantId]); // trial = everything
    let body = (await app.inject({ method: 'GET', url: '/plugins', headers: H(owner.token) })).json();
    const libTrial = body.plugins.find((p) => p.plugin_id === 'library');
    assert.ok(libTrial, 'library must be in the catalogue');
    assert.equal(libTrial.available, true, 'trial includes everything');

    await sql(`UPDATE app.tenants SET plan='core' WHERE id=$1`, [tenantId]); // core includes nothing
    body = (await app.inject({ method: 'GET', url: '/plugins', headers: H(owner.token) })).json();
    const lib = body.plugins.find((p) => p.plugin_id === 'library');
    assert.equal(lib.available, false, 'THE REGRESSION GATE: core must not include library');
    assert.equal(lib.requiredPlan, 'campus', 'the upgrade path names the plan that includes it');

    const enabled = await app.inject({ method: 'POST', url: '/plugins/library/enable', headers: H(owner.token), payload: {} });
    assert.equal(enabled.statusCode, 402, `an unentitled enable must be refused before any write: ${enabled.body}`);
    assert.equal(enabled.json().code, 'NOT_ENTITLED');

    await sql(`UPDATE app.tenants SET plan='trial' WHERE id=$1`, [tenantId]);
  });
});

// ── OPS-20 · maintenance workers use the named owner path and the event spine ──────────────────────
describe('OPS-20 · reconciliation is importable and emits through the spine', () => {
  test('a ledger↔rail discrepancy is found and emitted as a warn event by the kernel spine', async () => {
    const src = readFileSync(join(SERVER_ROOT, 'scripts', 'reconcile-payments.js'), 'utf8');
    assert.doesNotMatch(src, /new pg\.Client|pool\.connect/,
      'the worker must not hand-roll its own privileged client — it uses the named sysq/tx path');

    const student = (await sql(`SELECT id FROM app.students LIMIT 1`)).rows[0];
    assert.ok(student, 'fixture: the seed must contain a student');
    const payment = (await sql(
      `INSERT INTO app.payments (tenant_id, student_id, amount_cents, method, status, gateway_ref, confirmed_at)
       VALUES ($1,$2,100,'razorpay','confirmed','RZP-PROBE', now()) RETURNING id`, [tenantId, student.id])).rows[0];
    // ghost: confirmed locally, the rail never captured it
    await sql(`INSERT INTO plugin_razorpay.order_log (tenant_id, payment_id, razorpay_order_id, status)
               VALUES ($1,$2,$3,'created')`, [tenantId, payment.id, `order_probe_${randomUUID()}`]);

    const before = Number((await sql(`SELECT count(*)::int AS n FROM app.events WHERE tenant_id=$1 AND emitted_by='worker:reconcile-payments'`, [tenantId])).rows[0].n);
    const { runReconciliation } = await import('../scripts/reconcile-payments.js');
    const report = await runReconciliation();
    assert.ok(report.total >= 1, `the planted ghost must be found: ${JSON.stringify(report)}`);

    const rows = (await sql(`SELECT severity, emitted_by, subject, payload FROM app.events WHERE tenant_id=$1 AND emitted_by='worker:reconcile-payments' ORDER BY created_at`, [tenantId])).rows;
    assert.equal(rows.length - before, report.total, 'exactly one event per discrepancy');
    const ev = rows[rows.length - 1];
    assert.equal(ev.severity, 'warn', 'the spine only accepts a valid severity (governance)');
    assert.equal(ev.subject, `payment:${payment.id}`, 'the event carries the subject for lineage');
  });
});

// ── PLG-2b · dependency declarations name a version that exists ────────────────────────────────────
describe('PLG-2b · dependency versions are real, not decorative', () => {
  test('every machine-readable dependency names the version the dependency actually ships', async () => {
    const dir = join(SERVER_ROOT, 'src', 'plugins');
    const manifests = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('_')) continue;
      try { const m = (await import(`../src/plugins/${e.name}/manifest.js`)).default; if (m?.id) manifests.push(m); } catch { /* a manifest-less plugin is not a dependency target */ }
    }
    assert.ok(manifests.length >= 25, `fixture: only ${manifests.length} manifests loaded`);
    const byId = new Map(manifests.map((m) => [m.id, m]));
    const problems = [];
    for (const m of manifests) {
      for (const dep of (m.dependencies ?? [])) {
        const parsed = /^([a-z][a-z0-9.-]{2,63})@v?(\d+\.\d+\.\d+)$/.exec(String(dep).trim());
        if (!parsed) continue; // prose dependencies are ignored by the enable gate as well
        const target = byId.get(parsed[1]);
        if (!target) { problems.push(`${m.id} depends on '${parsed[1]}', which has no manifest`); continue; }
        if (target.version !== parsed[2]) problems.push(`${m.id} requires ${parsed[1]}@${parsed[2]} but it ships ${target.version}`);
      }
    }
    assert.deepEqual(problems, [], 'the enable door compares these versions exactly, so a mismatch makes the dependent plugin unenablable');
  });
});

// ── DAT-12 · NOT VALID checks still fail new writes ────────────────────────────────────────────────
describe('DAT-12 · lifecycle checks are enforceable on new rows', () => {
  const NAMES = [
    'loan_status_check', 'attendance_marked_by_check', 'cases_opened_by_check', 'actions_decision_actor_check',
    'fee_obligations_created_at_check', 'routes_created_at_check', 'assets_created_at_check',
    'work_orders_created_at_check', 'wo_events_created_at_check', 'cases_created_at_check',
    'actions_created_at_check', 'communications_created_at_check', 'notifications_created_at_check',
    'migration_sources_created_at_check',
  ];

  test('every 092 constraint exists, is enforced (validated by 104), and rejects a violating INSERT', async () => {
    const rows = (await sql(`SELECT conname, convalidated FROM pg_constraint WHERE conname = ANY($1::text[])`, [NAMES])).rows;
    const found = new Set(rows.map((r) => r.conname));
    const missing = NAMES.filter((n) => !found.has(n));
    assert.deepEqual(missing, [], `migration 092 constraints missing: ${missing.join(', ')}`);
    // 092 authored these NOT VALID so a deploy with dirty historical rows could not abort. Migration 104
    // (DATX-9) then VALIDATED the whole clean set — it WARNs on any constraint whose historical rows are
    // dirty rather than aborting, so validation cannot make a deploy fail. The durable property is that the
    // checks EXIST and are ENFORCED for new rows (asserted below), which holds whether validated or not.
    // This assertion was updated when DATX-9 closed; the constraint's job did not change.
    for (const r of rows) {
      assert.equal(r.convalidated, true, `${r.conname} must be validated after migration 104 (DATX-9)`);
    }
    // NOT VALID constrains NEW rows immediately. This is the half a "did the migration run?" check misses.
    const code = `dat12_${randomUUID().slice(0, 8)}`;
    await assert.rejects(
      sql(`INSERT INTO app.cases (tenant_id, code, kind, title, opened_by) VALUES ($1,$2,'ops','x',NULL)`, [tenantId, code]),
      (e) => e.code === '23514',
      'a new case with no opener must be refused by cases_opened_by_check');
    const opener = (await sql(`SELECT id FROM app.users LIMIT 1`)).rows[0].id;
    const ok = await sql(`INSERT INTO app.cases (tenant_id, code, kind, title, opened_by) VALUES ($1,$2,'ops','x',$3) RETURNING id`, [tenantId, code, opener]);
    assert.ok(ok.rows[0].id, 'a legitimate insert must pass — the check is not a blanket refusal');
  });
});

// ── DAT-9 · the authored indexes exist and are valid ───────────────────────────────────────────────
describe('DAT-9 · every index authored by migrations 089–093 is live and valid', () => {
  test('no index can silently fail to create', async () => {
    const files = readdirSync(MIGRATIONS).filter((f) => /^0(?:89|90|91|93)_/.test(f) && f.endsWith('.sql'));
    assert.ok(files.length >= 4, `expected the four index migrations, found ${files.length}`);
    const expected = [];
    for (const f of files) {
      const src = readFileSync(join(MIGRATIONS, f), 'utf8');
      for (const m of src.matchAll(/CREATE(?:\s+UNIQUE)?\s+INDEX(?:\s+CONCURRENTLY)?\s+IF NOT EXISTS\s+([a-z0-9_]+)/gi)) expected.push(m[1]);
    }
    assert.ok(expected.length >= 25, `fixture: parsed only ${expected.length} indexes from ${files.join(', ')}`);
    const rows = (await sql(
      `SELECT c.relname AS name, i.indisvalid AS valid
         FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
        WHERE c.relname = ANY($1::text[])`, [expected])).rows;
    const found = new Map(rows.map((r) => [r.name, r.valid]));
    const missing = expected.filter((n) => !found.has(n));
    assert.deepEqual(missing, [], `indexes the migrations declare but the database lacks: ${missing.join(', ')}`);
    const invalid = rows.filter((r) => !r.valid).map((r) => r.name);
    assert.deepEqual(invalid, [], `indexes present but invalid: ${invalid.join(', ')}`);
  });
});
