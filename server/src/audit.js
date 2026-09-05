// Shared helpers: audit ledger writer (hash-chained), event emitter, outbox.
import { createHash } from 'node:crypto';

/** Append to the audit ledger inside an existing transaction. Hash-chained.
 * Serialization via advisory lock (row lock would need UPDATE privilege,
 * which the app role deliberately lacks on the immutable ledger). */
export async function auditLog(client, tenantId, entry) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 42))`, [tenantId]);
  const prev = await client.query(
    `SELECT hash, created_at FROM app.audit_log WHERE tenant_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, [tenantId]);
  const prevHash = prev.rows[0]?.hash ?? 'GENESIS';
  // RTR-001 Track E: hash exactly what the row stores (created_at comes from the DB)
  const at = new Date().toISOString();
  const material = JSON.stringify({
    tenant: tenantId, actor: entry.actor, actorRole: entry.actorRole, action: entry.action,
    recordType: entry.recordType, recordRef: entry.recordRef ?? null, outcome: entry.outcome ?? null,
    at,
  });
  const hash = createHash('sha256').update(prevHash + material).digest('hex');
  const r = await client.query(
    `SELECT * FROM app.audit_append($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [tenantId, entry.actor, entry.actorRole, entry.action, entry.recordType, entry.recordRef ?? null,
     entry.reason ?? null, entry.policyRef ?? null, entry.aiInvolved ?? false, entry.risk ?? 'low',
     entry.outcome ?? null, prevHash, hash, at]);
  return r.rows[0];
}

/** Emit an event with the v2 envelope (docs/12 §10) + outbox linkage. */
export async function emitEvent(client, tenantId, { type, label, severity = 'info', ref = null }, topic = null, payload = null, opts = {}) {
  const { emittedBy = 'kernel', subject = null, correlationId = null, causationId = null, schemaVersion = 1 } = opts;
  const e = await client.query(
    `INSERT INTO app.events (tenant_id, type, label, severity, ref, emitted_by, subject, correlation_id, causation_id, schema_version, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, created_at`,
    [tenantId, type, label, severity, ref, emittedBy, subject, correlationId, causationId, schemaVersion, payload ? JSON.stringify(payload) : null]);
  await client.query(
    `INSERT INTO app.outbox (tenant_id, topic, payload, event_id, schema_version, emitted_by, subject, correlation_id, causation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [tenantId, topic ?? `event.${type}`, payload ?? { eventId: e.rows[0].id, type, label, severity },
     e.rows[0].id, schemaVersion, emittedBy, subject, correlationId, causationId]);
  return e.rows[0];
}

/** Link an action (or downstream event) to its causing event — the lineage spine. */
export async function linkLineage(client, tenantId, { eventId, actionId = null, downstreamEventId = null, relation = 'raised', policyRef = null }) {
  await client.query(
    `INSERT INTO app.event_action_link (tenant_id, event_id, action_id, downstream_event_id, relation, policy_ref)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [tenantId, eventId, actionId, downstreamEventId, relation, policyRef]);
}

/** Plugin-path audit: the documented (docs/10 §7) entry point for plugin code.
 * Provenance is stamped into actor_role so first-party and third-party plugin
 * writes are distinguishable in the ledger. */
export async function requestAudit(client, tenantId, pluginId, entry) {
  return auditLog(client, tenantId, {
    ...entry,
    actorRole: `plugin:${pluginId}`,
    policyRef: entry.policyRef ?? `Platform §3 (plugin governance) · ${pluginId}`,
  });
}
