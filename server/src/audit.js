// Shared helpers: audit ledger writer (hash-chained), event emitter, outbox.

/** Append to the audit ledger inside an existing transaction. Hash-chained.
 *
 * SEC-20: the hash is computed by the DATABASE (trigger `audit_pin_hash_bi` on app.audit_log, added
 * in migration 075) and the chain link is taken from the table inside the same statement. This
 * function used to compute both in JS and pass them in — and `app.audit_append` stored the supplied
 * hash VERBATIM while validating only `prev_hash`, so any app-role caller could write a row whose
 * hash it had chosen. The row still linked correctly, which is why ordinary chain checking saw
 * nothing (measured on the dev ledger: 26 of 53 rows do not reproduce from their own columns).
 *
 * Consequences a reader must know:
 *  - `p_hash` (13th argument) is now IGNORED by app.audit_append. It is passed as NULL, deliberately.
 *  - `p_prev_hash` is now only a CONFLICT DETECTOR: the call still fails if the caller's view of the
 *    chain is stale, which is useful, but it no longer decides the stored link.
 *  - the advisory lock below is belt-and-braces: PostgreSQL takes the same lock inside
 *    app.audit_append, which is what actually protects the 33 migration replays, scripts/seed.js
 *    and any future direct caller. Keeping it here preserves the lock-before-read ordering for
 *    multi-statement callers in one transaction, at no correctness cost.
 *  - verification is `SELECT * FROM app.audit_verify($tenant)` — see GET /audit/verify.
 */
export async function auditLog(client, tenantId, entry) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 42))`, [tenantId]);
  const prev = await client.query(
    `SELECT hash FROM app.audit_log WHERE tenant_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, [tenantId]);
  const prevHash = prev.rows[0]?.hash ?? 'GENESIS';
  const at = new Date().toISOString();
  const r = await client.query(
    `SELECT * FROM app.audit_append($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [tenantId, entry.actor, entry.actorRole, entry.action, entry.recordType, entry.recordRef ?? null,
     entry.reason ?? null, entry.policyRef ?? null, entry.aiInvolved ?? false, entry.risk ?? 'low',
     entry.outcome ?? null, prevHash, null /* p_hash ignored: the DB pins the hash (migration 075) */, at]);
  return r.rows[0];
}

/** Emit an event with the v2 envelope (docs/12 §10) + outbox linkage. */
export async function emitEvent(client, tenantId, { type, label, severity = 'info', ref = null }, topic = null, payload = null, opts = {}) {
  const { emittedBy = 'kernel', subject = null, correlationId = null, causationId = null, schemaVersion = 1 } = opts;
  // Event rows fan out to workers and dashboards; bound the envelope before it
  // reaches PostgreSQL so one malformed plugin payload cannot exhaust a queue.
  if (!/^[a-z][a-z0-9_.-]{0,63}$/i.test(String(type ?? ''))) throw new Error('event type is invalid');
  if (String(label ?? '').length > 500) throw new Error('event label exceeds 500 characters');
  if (topic != null && !/^[a-z][a-z0-9_.-]{0,127}$/i.test(String(topic))) throw new Error('event topic is invalid');
  let encodedPayload = null;
  if (payload != null) {
    try { encodedPayload = JSON.stringify(payload); } catch { throw new Error('event payload must be JSON-serializable'); }
    if (Buffer.byteLength(encodedPayload, 'utf8') > 64 * 1024) throw new Error('event payload exceeds 64KiB');
  }
  const e = await client.query(
    `INSERT INTO app.events (tenant_id, type, label, severity, ref, emitted_by, subject, correlation_id, causation_id, schema_version, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, created_at`,
    [tenantId, type, label, severity, ref, emittedBy, subject, correlationId, causationId, schemaVersion, encodedPayload]);
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
