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
      // plain-language copy pass: the plugin id is support detail, the desk needs the ask
      const FRIENDLY = {
        'ops.visitors': 'Visitors', 'ops.timetable': 'Timetable', 'hr.leave': 'Leave & duty roster',
        'health.clinic': 'Health clinic', 'exams.assessment': 'Exams', 'admissions.funnel': 'Admissions',
        'pack.dpdp': 'Data requests (DPDP)', 'pack.cbse': 'CBSE pack', 'payments.upi': 'Fee payments',
        'transport.gps': 'Transport', 'comms.whatsapp': 'WhatsApp updates', 'accounting.tally': 'Accounting',
      };
      const label = FRIENDLY[pluginId] ?? pluginId.split('.')[0].replace(/^./, (c) => c.toUpperCase());
      return reply.code(409).send({ error: `${label} is switched off — ask the school owner to turn it on` });
    }
  };
}
