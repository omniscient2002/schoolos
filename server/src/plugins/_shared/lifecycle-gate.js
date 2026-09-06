// Shared per-plugin lifecycle gate — uniform-gating decision (orchestrator, redteam P2-1).
// Kernel requireRole is role-only; EVERY module door must additionally refuse while the
// plugin row is not enabled for the tenant. 409 + explicit reason, zero data surfaced.
// Usage in a plugin's register():
//   const lifecycleGate = makeLifecycleGate(q, '<plugin.id>');
//   app.get(`/plugins/<id>/door`, { preHandler: [require(...roles), lifecycleGate] }, ...)
// The gate reads the row per request (fresh after enable/disable, no caching).
export function makeLifecycleGate(q, pluginId) {
  return async function lifecycleGate(req, reply) {
    const row = (await q(`SELECT status FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
      [req.user.tenant_id, pluginId])).rows[0];
    if (!row || !['enabled', 'active', 'degraded'].includes(row.status)) {
      return reply.code(409).send({ error: `${pluginId} is not enabled for this tenant` });
    }
  };
}
