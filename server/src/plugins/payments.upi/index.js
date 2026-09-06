// payments.upi — UPI collection rails. Money-touching: creates links + records
// signed-webhook facts; settlement is kernel-only (staff confirm, Fees §4.2).
// Decoupled: zero kernel logic — mounts its own doors only (docs/11 §2.3).
const ID = 'payments.upi';
export { default as manifest } from './manifest.js';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, q } = kernel;

  app.post(`/plugins/${ID}/links`, { preHandler: require('finance','owner','principal') }, async (req, reply) => {
    const { obligationId } = req.body ?? {};
    if (!obligationId) return reply.code(400).send({ error: 'obligationId required' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const o = (await c.query(`SELECT o.*, s.name AS student_name FROM app.fee_obligations o
        JOIN app.students s ON s.id = o.student_id WHERE o.id=$1 AND o.status <> 'void'`, [obligationId])).rows[0];
      if (!o) return reply.code(404).send({ error: 'obligation not found' });
      const due = BigInt(o.amount_cents) - BigInt(o.paid_cents);
      if (due <= 0n) return reply.code(409).send({ error: 'obligation already settled' });
      const linkId = `plink_${randomUUID().slice(0, 12)}`;
      const r = await c.query(
        `INSERT INTO app.payments (tenant_id, student_id, obligation_id, amount_cents, method, status)
         VALUES ($1,$2,$3,$4,'upi','initiated') RETURNING id`,
        [req.user.tenant_id, o.student_id, obligationId, due.toString()]);
      const paymentId = r.rows[0].id;
      const link = `upi://pay?pa=schoolos@${o.student_name.slice(0, 12).replace(/\s+/g, '')}&tr=${paymentId}&am=${Number(due) / 100}&cu=INR&tn=${encodeURIComponent(`Fees — ${o.label}`)}`;
      await emitEvent(c, req.user.tenant_id,
        { type: 'fees', label: `payment.link.created — ${o.student_name} · ₹${Number(due) / 100} (${o.label})`, ref: paymentId },
        'payment.link.created', { paymentId, obligationId, amountCents: due.toString(), linkId });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Payment link created', recordType: 'Payment', recordRef: paymentId,
        reason: `obligation ${o.label}`, policyRef: 'Fees §4.2', risk: 'medium',
        outcome: `link ${linkId} · ₹${Number(due) / 100} · settlement remains kernel-only` });
      return { paymentId, linkId, link, amountCents: due.toString(), studentName: o.student_name, obligationLabel: o.label };
    });
  });

  app.post(`/plugins/${ID}/webhook`, async (req, reply) => {
    const sig = req.headers['x-razorpay-signature'];
    const secret = process.env.UPI_WEBHOOK_SECRET;
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    // HMAC is REQUIRED when UPI_WEBHOOK_SECRET is set (Fees §4.2 posture): an unsigned
    // request is rejected before any fact is read. Dev-unsigned mode exists only when
    // the secret is absent (ephemeral test boots / pre-provisioning demo).
    let verified = false;
    if (secret) {
      if (!sig) return reply.code(401).send({ error: 'signature required' });
      const mac = createHmac('sha256', secret).update(raw).digest();
      try { verified = timingSafeEqual(mac, Buffer.from(String(sig), 'hex')); } catch { verified = false; }
      if (!verified) return reply.code(401).send({ error: 'invalid signature' });
    }
    const body = typeof req.body === 'string' ? JSON.parse(raw) : (req.body ?? {});
    const eventId = body?.payload?.payment?.entity?.id ?? body?.eventId ?? body?.event;
    if (!eventId) return reply.code(400).send({ error: 'event/EventId required' });
    const type = body?.event ?? 'payment.captured';
    // resolve the tenant from the payment id (gateway payloads do not carry tenant context).
    // Service-path read via the owner pool: withUser cannot be opened before the tenant is
    // known (RLS would hide the row). The fact-writes below run as the constrained app role.
    const paymentId = body?.payload?.payment?.entity?.notes?.paymentId ?? body?.paymentId;
    if (!paymentId || !/^[0-9a-f-]{36}$/i.test(paymentId)) return reply.code(400).send({ error: 'paymentId (uuid) required in notes' });
    const p = (await q(`SELECT tenant_id FROM app.payments WHERE id=$1`, [paymentId])).rows[0];
    if (!p) return reply.code(404).send({ error: 'payment not found' });
    // webhook facts are tenant-resolved from the payment row, then written on that tenant's path
    await withUser(p.tenant_id, 'system', async (c) => {
      await c.query(`INSERT INTO plugin_upi.webhook_log (tenant_id, gateway, event_id, event_type, payload, signature_verified)
        VALUES ($1,'razorpay',$2,$3,$4,$5) ON CONFLICT (tenant_id, event_id) DO NOTHING`,
        [p.tenant_id, eventId, type, JSON.stringify(body).slice(0, 16384), verified]);
      await emitEvent(c, p.tenant_id,
        { type: 'fees', label: `${type} — webhook fact recorded (${eventId})`, ref: paymentId },
        type, { paymentId, eventId, verified });
      await requestAudit(c, p.tenant_id, ID, {
        actor: 'gateway webhook', action: `UPI webhook ${type}`, recordType: 'Payment', recordRef: paymentId,
        reason: `event ${eventId}`, policyRef: 'Fees §4.2', risk: 'low',
        outcome: `fact recorded${verified ? ' · HMAC verified' : ' · dev mode (unsigned)'} · settlement untouched (kernel-only)` });
    });
    return { ok: true, outcome: 'fact recorded; settlement is kernel-only (staff confirm)' };
  });
}
