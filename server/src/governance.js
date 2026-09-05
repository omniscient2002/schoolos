// Event governance — per-plugin budgets + circuit breaker (docs/12 §10).
// Kernel-originated events are never budgeted; registered plugins are.
const DEFAULTS = { events_per_min: 60, payload_max_bytes: 65536 };

export async function checkEventBudget(client, tenantId, pluginId, payloadBytes = 0) {
  const p = await client.query(
    `SELECT event_budget, breaker_state FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
    [tenantId, pluginId]);
  if (!p.rows[0]) return { allowed: true, mode: 'kernel-path' }; // unregistered ⇒ kernel semantics
  const budget = { ...DEFAULTS, ...(p.rows[0].event_budget ?? {}) };
  const breaker = p.rows[0].breaker_state ?? {};
  if (breaker.open === true) {
    return { allowed: false, code: 'BREAKER_OPEN', since: breaker.opened_at ?? null };
  }
  if (payloadBytes > budget.payload_max_bytes) {
    return { allowed: false, code: 'PAYLOAD_TOO_LARGE', limit: budget.payload_max_bytes };
  }
  const r = await client.query(
    `SELECT count(*)::int AS n FROM app.events
     WHERE tenant_id=$1 AND emitted_by=$2 AND created_at > now() - interval '1 minute'`,
    [tenantId, `plugin:${pluginId}`]);
  const n = r.rows[0].n;
  if (n >= budget.events_per_min) {
    await client.query(
      `UPDATE app.plugins SET breaker_state = jsonb_build_object('open', true, 'opened_at', now(), 'reason', 'events_per_min exceeded', 'observed', $3::int)
       WHERE tenant_id=$1 AND plugin_id=$2`,
      [tenantId, pluginId, n]);
    return { allowed: false, code: 'BUDGET_EXHAUSTED', emitted_last_min: n, breaker: 'opened' };
  }
  return { allowed: true, emitted_last_min: n };
}
