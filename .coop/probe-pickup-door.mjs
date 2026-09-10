// L2 diagnostic (T201): replay the ops.visitors pickup door's exact SQL sequence
// inside one transaction that is ROLLED BACK — zero persistent writes. Owner-path
// statements (settings, pickup_otp INSERT) run as the DATABASE_URL user; app-role
// statements emulate withUser(): BEGIN + tenant GUC + SET LOCAL ROLE schoolos_app.
import pg from 'pg';

const url = process.env.PROBE_URL ?? 'postgres://schoolos:schoolos_dev_pw@127.0.0.1:5432/schoolos';

const owner = new pg.Client({ connectionString: url });
await owner.connect();
await owner.query('BEGIN');

const tenantId = (await owner.query(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0]?.id;
if (!tenantId) { console.log('no tenants — nothing to probe'); process.exit(0); }
const s = (await owner.query(
  `SELECT s.id, s.name, g.phone FROM app.students s
   JOIN app.guardians g ON g.student_id=s.id AND g.is_primary AND g.phone IS NOT NULL LIMIT 1`)).rows[0];
console.log(`probe: tenant=${tenantId} student=${s ? s.id : 'NONE (no student w/ primary guardian phone)'}`);
if (!s) process.exit(0);

const step = async (name, fn) => {
  try { const r = await fn(); console.log(`✔ ${name} → ${JSON.stringify(r).slice(0, 100)}`); }
  catch (e) { console.log(`✖ ${name} → ${e.message} (code ${e.code ?? '-'})`); }
};

await step('a. settings SELECT (owner q)', () =>
  owner.query(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, 'ops.visitors']));

await step('c. pickup_otp INSERT w/ make_interval (owner q)', async () =>
  (await owner.query(
    `INSERT INTO plugin_visitors.pickup_otp (tenant_id, visit_id, phone, code_hash, expires_at)
     VALUES ($1,$2,$3,$4, now() + make_interval(mins => $5)) RETURNING id`,
    [tenantId, null, s.phone, 'aa:bb', 5])).rows);

// app-role emulation on a second client (its own rolled-back tx)
const approle = new pg.Client({ connectionString: url });
await approle.connect();
await approle.query('BEGIN');
await approle.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [tenantId]);
await approle.query('SET LOCAL ROLE schoolos_app');

await step('b. guardian SELECT (app-role c)', async () =>
  (await approle.query(
    `SELECT phone FROM app.guardians WHERE student_id=$1 AND tenant_id=$2 AND is_primary AND phone IS NOT NULL ORDER BY created_at LIMIT 1`,
    [s.id, tenantId])).rows);

await step('d. visit UPDATE otp_request_id (app-role c)', async () =>
  (await approle.query(
    `UPDATE plugin_visitors.visit SET status='pickup_pending', otp_request_id=NULL, updated_at=now() WHERE tenant_id=$1 AND id='00000000-0000-0000-0000-000000000000' RETURNING id`,
    [tenantId])).rowCount);

await owner.query('ROLLBACK'); await owner.end();
await approle.query('ROLLBACK'); await approle.end();
console.log('probe: done (all rolled back)');
