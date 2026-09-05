// RTR-001 remediation: reconcile the PoC-negative work-order cost (WO-1046) and
// write the reconciliation to the immutable ledger via audit_append.
import pg from 'pg';
import { createHash } from 'node:crypto';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://schoolos:schoolos_dev_pw@127.0.0.1:5432/schoolos' });
await c.connect();
const t = (await c.query(`SELECT id FROM app.tenants LIMIT 1`)).rows[0].id;
const w = (await c.query(`SELECT id, code, cost_cents FROM app.work_orders WHERE code='WO-1046'`)).rows[0];
if (!w) { console.log('WO-1046 not found'); process.exit(0); }
const before = w.cost_cents;
if (before < 0) await c.query(`UPDATE app.work_orders SET cost_cents=0 WHERE id=$1`, [w.id]);
await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,42))`, [t]);
const prev = (await c.query(`SELECT hash FROM app.audit_log WHERE tenant_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, [t])).rows[0]?.hash ?? 'GENESIS';
const at = new Date();
const entry = { tenant: t, actor: 'CTO orchestrator', actorRole: 'system', action: 'Finance review: PoC-negative WO cost reconciled', recordType: 'WorkOrder', recordRef: w.code, outcome: `cost_cents ${before} → 0 · RTR-001 evidence retained in docs/red-team/RTR-001.md`, at: at.toISOString() };
const hash = createHash('sha256').update(prev + JSON.stringify(entry)).digest('hex');
await c.query(`SELECT * FROM app.audit_append($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
  [t, entry.actor, entry.actorRole, entry.action, entry.recordType, entry.recordRef, 'RTR-001 remediation (RT-004 ledger note)', 'Facilities §2.3', false, 'medium', entry.outcome, prev, hash, at]);
console.log(`WO-1046: ${before} → 0, ledger entry appended (hash ${hash.slice(0,12)}…)`);
await c.end();
