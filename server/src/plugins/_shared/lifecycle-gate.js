// Shared per-plugin lifecycle gate — uniform-gating decision (orchestrator, redteam P2-1).
// Kernel requireRole is role-only; EVERY module door must additionally refuse while the
// plugin row is not enabled for the tenant. 409 + explicit reason, zero data surfaced.
// Usage in a plugin's register():
//   const lifecycleGate = makeLifecycleGate(sysq, '<plugin.id>');
//   app.get(`/plugins/<id>/door`, { preHandler: [require(...roles), lifecycleGate] }, ...)
// The gate reads the row per request (fresh after enable/disable, no caching).
/* PLG-1: the manifest is the CEILING, the row is the GRANT, and a door may not open while the grant does not
   cover the declaration. Resolved once per process (a manifest is code on disk, not a per-request fact), so the
   gate stays synchronous at construction — the call sites in 27 plugins do not change. A manifest that cannot be
   read leaves `declared` as [] and the gate behaves exactly as before: enforcement must never become an outage
   because a file is missing. */
let permsModule = null;
let entitlementsModule = null;
const declaredCache = new Map();
async function declaredFor(pluginId) {
  if (!declaredCache.has(pluginId)) {
    permsModule ??= await import('../../plugin-permissions.js');
    declaredCache.set(pluginId, await permsModule.declaredPermissions(pluginId));
  }
  return declaredCache.get(pluginId);
}

export function makeLifecycleGate(sysq, pluginId) {
  return async function lifecycleGate(req, reply) {
    const row = (await sysq(`SELECT status, permissions FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
      [req.user.tenant_id, pluginId])).rows[0];
    if (!row || !['enabled', 'active', 'degraded'].includes(row.status)) {
      // plain-language copy pass: the plugin id is support detail, the desk needs the ask
      const FRIENDLY = {
        'ops.visitors': 'Visitors', 'ops.timetable': 'Timetable', 'hr.leave': 'Leave & duty roster',
        'health.clinic': 'Health clinic', 'exams.assessment': 'Exams', 'admissions.funnel': 'Admissions',
        'pack.dpdp': 'Data requests (DPDP)', 'pack.cbse': 'CBSE pack', 'payments.upi': 'Fee payments',
        'payments.razorpay': 'Fee payments', 'transport.gps': 'Transport', 'comms.whatsapp': 'WhatsApp updates',
        'accounting.tally': 'Accounting',
      };
      const label = FRIENDLY[pluginId] ?? pluginId.split('.')[0].replace(/^./, (c) => c.toUpperCase());
      return reply.code(409).send({ error: `${label} is switched off — ask the school owner to turn it on` });
    }
    /* PLG-2: entitlement. A row can say `enabled` because it was written before the school's plan changed (or by
       a plan downgrade), so the plan is checked per request rather than trusted from the row. 402, not 403: this
       is a commercial boundary, not a permission the plugin failed to hold. */
    entitlementsModule ??= await import('../../entitlements.js');
    const plan = (await sysq(`SELECT plan FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0]?.plan ?? 'trial';
    if (!entitlementsModule.planIncludes(plan, pluginId)) {
      return reply.code(402).send(entitlementsModule.notEntitled(pluginId, plan));
    }
    const declared = await declaredFor(pluginId);
    if (declared && declared.length) {
      permsModule ??= await import('../../plugin-permissions.js');
      if (!permsModule.covers(row.permissions, declared)) {
        // The realistic way a row falls short: a plugin version declares a permission the stored grant does not
        // hold yet (a new release, or a row written before the declaration existed). Refuse, name the gap, and
        // change nothing — the owner re-enables, which records the manifest's set as the grant.
        const missing = permsModule.firstMissing(row.permissions, declared);
        return reply.code(403).send(permsModule.denied(pluginId, missing, { declared, granted: row.permissions ?? [] }));
      }
    }
  };
}
