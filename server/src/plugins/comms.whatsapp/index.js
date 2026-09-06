import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
// comms.whatsapp — WhatsApp BSP rail beneath the kernel Communication Orchestrator.
// Sends are NOT direct: an approved action (kind 'message') executes through the
// orchestrator; this rail registers DLT templates and reads kernel receipts.
// The rail adds ZERO kernel logic — it only mounts doors (docs/11 §2.3).
const ID = 'comms.whatsapp';
export { default as manifest } from './manifest.js';

export function register(app, kernel) {
  const { withUser, requestAudit, require } = kernel;
  const lifecycleGate = makeLifecycleGate(kernel.q, 'comms.whatsapp');

  app.post(`/plugins/${ID}/templates`, { preHandler: [require('owner', 'itadmin'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.name || !b.body) return reply.code(400).send({ error: 'name and body required' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // Templates live in plugin settings (DLT registry), never as fake communication rows.
      // jsonb_set + per-key merge: template registrations accumulate, never clobber.
      const r = await c.query(
        `UPDATE app.plugins SET settings = jsonb_set(settings, '{templates}',
            COALESCE(settings->'templates', '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb), true),
         updated_at = now()
         WHERE tenant_id=$1 AND plugin_id='${ID}'
         RETURNING settings->'templates' AS templates`,
        [req.user.tenant_id, b.name, JSON.stringify({ body: b.body, dltId: b.dltId ?? null })]);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: `WhatsApp template registered: ${b.name}`, recordType: 'Plugin',
        recordRef: b.name, reason: 'DLT template registry', policyRef: 'Comms §1.2',
        risk: 'low', outcome: 'template available to the orchestrator' });
      return { templates: r.rows[0]?.templates ?? {} };
    });
  });

  app.get(`/plugins/${ID}/templates`, { preHandler: [require('owner','itadmin','principal','coordinator','transport','finance'), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const s = (await c.query(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id='${ID}'`, [req.user.tenant_id])).rows[0];
      return { templates: s?.settings?.templates ?? {}, policyRef: 'Comms §1.2' };
    });
  });

  app.get(`/plugins/${ID}/receipts`, { preHandler: [require('owner','itadmin','principal','coordinator','transport','finance'), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT id, template, body, status, policy_ref, sent_at, delivered_at, created_at
         FROM app.communications WHERE channel='whatsapp' ORDER BY created_at DESC LIMIT 100`);
      return { receipts: r.rows };
    });
  });
}
