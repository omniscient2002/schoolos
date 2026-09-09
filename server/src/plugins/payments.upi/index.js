// payments.upi — UPI collection rails. Money-touching: creates links + records
// signed-webhook facts; settlement is kernel-only (staff confirm, Fees §4.2).
// Decoupled: zero kernel logic — mounts its own doors only (docs/11 §2.3).
const ID = 'payments.upi';
export { default as manifest } from './manifest.js';
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { installRawJsonParser } from '../_shared/raw-body-parser.js';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, q } = kernel;
  const lifecycleGate = makeLifecycleGate(kernel.q, ID);

  // ── Raw-bytes capture (redteam P0-1): real Razorpay HMACs are computed over the
  // wire bytes — re-serialized JSON will never verify. Now the SHARED parser
  // (_shared/raw-body-parser.js): Wave A adds payments.razorpay, and Fastify
  // refuses a second application/json parser — install-once keeps both rails'
  // webhooks byte-exact regardless of loader mount order.
  installRawJsonParser(app);

  // ── Boot guard (redteam P0-1): a money rail must not serve forged facts. If any
  // tenant has payments.upi enabled, the HMAC secret is mandatory at boot — the
  // JWT_SECRET pattern (config.js fail-fast), applied at plugin scope.
  app.addHook('onReady', async () => {
    const enabled = (await q(`SELECT count(*)::int n FROM app.plugins WHERE plugin_id='payments.upi' AND status IN ('enabled','active','degraded')`)).rows[0].n;
    if (enabled > 0 && !process.env.UPI_WEBHOOK_SECRET) {
      throw new Error('boot refused: UPI_WEBHOOK_SECRET must be set while payments.upi is enabled (Fees §4.2 — no unsigned webhook acceptance)');
    }
  });

  app.post(`/plugins/${ID}/links`, { preHandler: [require('finance','owner','principal'), lifecycleGate] }, async (req, reply) => {
    const { obligationId } = req.body ?? {};
    if (!obligationId) return reply.code(400).send({ error: 'Which fee is being paid? (obligationId is missing)' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const o = (await c.query(`SELECT o.*, s.name AS student_name FROM app.fee_obligations o
        JOIN app.students s ON s.id = o.student_id WHERE o.id=$1 AND o.status <> 'void'`, [obligationId])).rows[0];
      if (!o) return reply.code(404).send({ error: 'We couldn\'t find that fee record' });
      const due = BigInt(o.amount_cents) - BigInt(o.paid_cents);
      if (due <= 0n) return reply.code(409).send({ error: 'This fee is already settled' });
      // existing open attempt → 409 with its paymentId (recoverable), never a raw 23505 → 500
      const open = (await c.query(
        `SELECT id FROM app.payments WHERE tenant_id=$1 AND obligation_id=$2 AND status IN ('initiated','pending') LIMIT 1`,
        [req.user.tenant_id, obligationId])).rows[0];
      if (open) return reply.code(409).send({ error: 'A payment is already in progress for this fee', paymentId: open.id });
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
    // ── Gate 1: fail-closed, always (redteam cycle-3 P0-1). No dev-acceptance mode:
    // money-adjacent facts don't get dev doors. Secret unset → the route is OFF.
    const secret = process.env.UPI_WEBHOOK_SECRET;
    if (!secret) return reply.code(403).send({ error: 'Payments are not set up yet' });
    const sig = req.headers['x-razorpay-signature'];
    if (!sig) return reply.code(401).send({ error: 'Payment event was not signed' });
    // ── Gate 2: HMAC over the RAW request bytes (never re-serialized JSON)
    const raw = req.rawBody ?? Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
    const mac = createHmac('sha256', secret).update(raw).digest();
    let verified = false;
    try { verified = timingSafeEqual(mac, Buffer.from(String(sig), 'hex')); } catch { verified = false; }
    if (!verified) return reply.code(401).send({ error: 'Payment could not be verified (signature mismatch)' });

    // ── Gate 3: body shape (redteam P1-2 — malformed JSON is 400, never 500; the
    // content parser already 400s application/json, this guards signed raw-string bodies)
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(raw.toString('utf8')) : (req.body ?? {});
    } catch {
      return reply.code(400).send({ error: 'Payment data could not be read' });
    }
    const eventId = body?.payload?.payment?.entity?.id ?? body?.eventId ?? body?.event;
    if (!eventId) return reply.code(400).send({ error: 'Payment event is missing its event ID' });
    const type = body?.event ?? 'payment.captured';
    // resolve the tenant from the payment id (gateway payloads do not carry tenant context).
    // Service-path read via the owner pool: withUser cannot be opened before the tenant is
    // known (RLS would hide the row). The fact-writes below run as the constrained app role.
    const paymentId = body?.payload?.payment?.entity?.notes?.paymentId ?? body?.paymentId;
    if (!paymentId || !/^[0-9a-f-]{36}$/i.test(paymentId)) return reply.code(400).send({ error: 'Payment event is missing a valid payment reference' });
    const p = (await q(`SELECT tenant_id FROM app.payments WHERE id=$1`, [paymentId])).rows[0];
    if (!p) return reply.code(404).send({ error: 'We couldn\'t find that payment' });
    // webhook facts are tenant-resolved from the payment row, then written on that tenant's path
    return withUser(p.tenant_id, 'system', async (c) => {
      // ── Gate 4: lifecycle (redteam P2-1 promoted) — facts only for an ENABLED rail
      const pl = (await c.query(
        `SELECT status, COALESCE(settings->>'webhook_freshness_mins','15') AS fresh_mins
         FROM app.plugins WHERE tenant_id=$1 AND plugin_id='payments.upi'`, [p.tenant_id])).rows[0];
      if (!pl || !['enabled', 'active', 'degraded'].includes(pl.status)) {
        return reply.code(409).send({ error: 'Fee payments is switched off — ask the school owner to turn it on' });
      }
      // ── Gate 5: freshness (redteam P1-1; P2-A/P2-B closed cycle-4) — replay
      // defense, settings-overridable. Boundary semantics (P2-B, documented):
      // events are accepted ONLY within ±fresh_mins of now — strictly-older is
      // rejected AND future-dated beyond the same window is rejected (negative age
      // is not an acceptance path). Timestamps are compared in seconds.
      const ts = body?.payload?.payment?.entity?.created_at ?? body?.timestamp;
      if (ts != null) {
        const ageMins = (Date.now() / 1000 - Number(ts)) / 60;
        if (!Number.isFinite(ageMins) || Math.abs(ageMins) > Number(pl.fresh_mins)) {
          return reply.code(400).send({ error: `Payment event is too old (older than ${pl.fresh_mins} minutes)` });
        }
      }
      // ── Gate 6: dedupe EVERYTHING on one insert — the row landing is the ticket for
      // the event spine AND the audit entry (one audit row per unique event; replays
      // are 200 no-ops with zero side effects, redteam P1-1).
      const ins = await c.query(
        `INSERT INTO plugin_upi.webhook_log (tenant_id, gateway, event_id, event_type, payload, signature_verified)
         VALUES ($1,'razorpay',$2,$3,$4,$5) ON CONFLICT (tenant_id, event_id) DO NOTHING RETURNING id`,
        [p.tenant_id, eventId, type, raw.toString('utf8').slice(0, 16384), verified]);
      if (!ins.rows[0]) {
        return { ok: true, outcome: 'replay no-op (event already recorded); settlement is kernel-only (staff confirm)' };
      }
      await emitEvent(c, p.tenant_id,
        { type: 'fees', label: `${type} — webhook fact recorded (${eventId})`, ref: paymentId },
        type, { paymentId, eventId, verified });
      await requestAudit(c, p.tenant_id, ID, {
        actor: 'gateway webhook', action: `UPI webhook ${type}`, recordType: 'Payment', recordRef: paymentId,
        reason: `event ${eventId}`, policyRef: 'Fees §4.2', risk: 'low',
        outcome: `fact recorded · HMAC verified over raw bytes · settlement untouched (kernel-only)` });
      return { ok: true, outcome: 'fact recorded; settlement is kernel-only (staff confirm)' };
    });
  });
}
