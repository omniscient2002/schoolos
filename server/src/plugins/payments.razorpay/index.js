// payments.razorpay — Razorpay order rails (Wave A). Money-touching: creates
// gateway orders + records signed-webhook FACTS; settlement is kernel-only
// (staff confirm, Fees §4.2). Decoupled from the kernel: zero kernel logic —
// mounts its own doors only (docs/11 §2.3), payments.upi as the template.
const ID = 'payments.razorpay';
export { default as manifest } from './manifest.js';
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { decryptSettings } from '../../settings-crypto.js';

const ORDERS_API = 'https://api.razorpay.com/v1/orders';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, sysq } = kernel;
  const lifecycleGate = makeLifecycleGate(kernel.sysq, ID);
  const bad = (reply, msg, code = 400, extra = {}) => reply.code(code).send({ error: msg, ...extra });

  // settings via kernel path (owner connection) — ops.visitors parity
  const settingsFor = (tenantId) =>
    sysq(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, ID])
      .then((r) => ({ rows: r.rows.map((row) => ({ ...row, settings: decryptSettings(row.settings, tenantId) })) }));

  // ── SEC-21: the verification candidate set must NOT depend on the request payload ──────────────
  // Previously the candidates were [env secret] + [the RESOLVED tenant's webhook_secret], and the
  // tenant was resolved from ids the CALLER supplies (order_log by razorpay_order_id, then
  // app.payments by notes.paymentId). Two consequences, both observable without any signature:
  //   1. an order id that resolves to a secret-bearing tenant answered 401 while a non-existent one
  //      answered 403 ("Payments are not set up yet") — an unauthenticated existence/rail-config
  //      oracle, plus a timing oracle from two owner-path queries + one settings read per guess;
  //   2. "not set up" was decided per-payload, so the 403 genuinely leaked configuration state.
  // The candidates are now derived from the PLUGIN REGISTRY alone, so the pre-verification answer is
  // payload-independent and identical for every unauthenticated caller.
  //
  // Ordering matters for cost as well as security: when the env secret is present (the documented
  // single-deployment path) the hot path touches the database ZERO times before verifying.
  // No cache, deliberately. A TTL cache here looked like an easy optimisation and is not worth it:
  // webhook volume is a few per school per day, the enumeration is one indexed SELECT, and the
  // staleness failure mode is a REAL PAYMENT being rejected for the length of the TTL right after an
  // operator configures a secret — and, worse, a rotated-away secret still being ACCEPTED for that
  // window. Correctness over a micro-optimisation; and because this query is payload-INDEPENDENT, its
  // cost leaks nothing to an unauthenticated caller.
  const MAX_TENANT_SECRETS = 50;          // defensive bound — fail closed rather than verify against a truncation
  const tenantSecrets = async () => {
    const r = await sysq(
      `SELECT tenant_id, settings
         FROM app.plugins
        WHERE plugin_id=$1 AND status IN ('enabled','active','degraded')
          LIMIT ${MAX_TENANT_SECRETS + 1}`, [ID]);
    // Truncation must fail CLOSED: verifying against a partial candidate list would 401 a legitimate
    // school whose secret fell outside the cap, and a caller could not tell that from a bad signature.
    if (r.rows.length > MAX_TENANT_SECRETS) {
      throw new Error(`${ID}: refusing to verify — more than ${MAX_TENANT_SECRETS} tenants have a webhook secret; use the deployment-wide RAZORPAY_WEBHOOK_SECRET instead`);
    }
    return r.rows.map((row) => ({ tenant_id: row.tenant_id, secret: decryptSettings(row.settings, row.tenant_id).webhook_secret }))
      .filter((row) => row.secret);
  };
  /** [{secret, tenantId}] — tenantId null marks the deployment-wide env secret, which is trusted
   *  for any tenant (it is what a single-deployment install configures). */
  const webhookCandidates = async () => {
    const env = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (env) return [{ secret: env, tenantId: null }];
    const rows = await tenantSecrets();
    return [...new Map(rows.filter((x) => x.secret).map((x) => [x.secret, x])).values()]
      .map((x) => ({ secret: x.secret, tenantId: x.tenant_id }));
  };
  /** ONE response for every unauthenticated failure. The oracle existed because these differed. */
  const unauth = (reply) => bad(reply, 'Payment event could not be verified', 401);

  // ── Boot guard (payments.upi parity, redteam P0-1): a money rail must not serve
  // forged facts. While ANY tenant runs this rail enabled, a webhook secret must
  // exist for it — env RAZORPAY_WEBHOOK_SECRET or the tenant's settings key.
  app.addHook('onReady', async () => {
    const r = (await sysq(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE settings ? 'webhook_secret')::int AS with_secret
       FROM app.plugins WHERE plugin_id='${ID}' AND status IN ('enabled','active','degraded')`)).rows[0];
    if (r.n > 0 && !process.env.RAZORPAY_WEBHOOK_SECRET && r.with_secret < r.n) {
      throw new Error(`boot refused: RAZORPAY_WEBHOOK_SECRET (or per-tenant settings.webhook_secret) must be set while ${ID} is enabled (Fees §4.2 — no unsigned webhook acceptance)`);
    }
  });

  // Keys: settings first (per-tenant), env fallback. Env is read HERE, in the
  // plugin (config.js stays untouched — Wave-A law), payments.upi boot-guard style.
  const resolveKeys = async (tenantId) => {
    const s = (await settingsFor(tenantId)).rows[0]?.settings ?? {};
    const keyId = s.key_id ?? process.env.RAZORPAY_KEY_ID ?? null;
    const keySecret = s.key_secret ?? process.env.RAZORPAY_KEY_SECRET ?? null;
    return { s, keyId, keySecret, configured: Boolean(keyId && keySecret) };
  };

  // ══ Door: create a gateway order against an open fee obligation ═══════════════
  app.post(`/plugins/${ID}/orders`, { preHandler: [require('finance', 'owner', 'principal'), lifecycleGate] }, async (req, reply) => {
    const { obligationId } = req.body ?? {};
    if (!obligationId || !UUID_RE.test(String(obligationId))) return bad(reply, 'Which fee is being paid? (a valid obligationId is missing)');
    const { keyId, keySecret, configured } = await resolveKeys(req.user.tenant_id);
    // graceful degradation: without keys the door must NEVER half-create gateway state
    if (!configured) return bad(reply, 'Razorpay not configured — add keys in plugin settings', 503);

    // ── Phase 1 (tenant tx): lock the obligation, refuse double-spend, open the
    // kernel payment row. Locks are never held across the network call (phase 2).
    let ctx = null;
    await withUser(req.user.tenant_id, req.user.role, async (c) => {
      const o = (await c.query(
        `SELECT o.*, st.name AS student_name FROM app.fee_obligations o
         JOIN app.students st ON st.id = o.student_id
         WHERE o.id=$1 AND o.tenant_id=$2 AND o.status <> 'void' FOR UPDATE`,
        [obligationId, req.user.tenant_id])).rows[0];
      if (!o) return bad(reply, 'We couldn\'t find that fee record', 404);
      const due = BigInt(o.amount_cents) - BigInt(o.paid_cents);
      if (due <= 0n) return bad(reply, 'This fee is already settled', 409);
      // existing open attempt → 409 with its paymentId (recoverable), never a raw 23505 → 500
      const open = (await c.query(
        `SELECT id FROM app.payments WHERE tenant_id=$1 AND obligation_id=$2 AND status IN ('initiated','pending') LIMIT 1`,
        [req.user.tenant_id, obligationId])).rows[0];
      if (open) return bad(reply, 'A payment is already in progress for this fee', 409, { paymentId: open.id });
      const r = await c.query(
        `INSERT INTO app.payments (tenant_id, student_id, obligation_id, amount_cents, method, status)
         VALUES ($1,$2,$3,$4,'razorpay','initiated') RETURNING id`,
        [req.user.tenant_id, o.student_id, obligationId, due.toString()]);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Razorpay order initiated', recordType: 'Payment', recordRef: r.rows[0].id,
        reason: `obligation ${o.label}`, policyRef: 'Fees §4.2', risk: 'medium',
        outcome: `kernel payment opened (₹${Number(due) / 100}) · gateway order pending · settlement remains kernel-only` });
      ctx = { paymentId: r.rows[0].id, due, studentName: o.student_name, label: o.label, obligationId };
      return ctx;
    });
    if (!ctx) return reply; // a gate above answered (404/409) — response already sent

    // ── Phase 2: gateway order via REST (Basic auth over key_id:key_secret) —
    // deliberately OUTSIDE any transaction so a slow gateway never holds locks.
    let order = null;
    let gwErr = null;
    try {
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const res = await fetch(ORDERS_API, {
        method: 'POST',
        headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: Number(ctx.due), currency: 'INR',
          receipt: `obl_${String(ctx.obligationId).slice(0, 8)}`,
          notes: { paymentId: ctx.paymentId, obligationId: ctx.obligationId },
        }),
        signal: AbortSignal.timeout(10000),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.id) gwErr = j?.error?.description ?? `gateway answered HTTP ${res.status}`;
      else order = j;
    } catch (e) {
      gwErr = String(e?.cause?.message ?? e?.message ?? 'gateway unreachable');
    }

    // ── Phase 3 (tenant tx): record the outcome. Success stores the order FACT +
    // event; failure marks the kernel payment 'failed' so the desk can retry.
    let out = null;
    await withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!order) {
        await c.query(
          `UPDATE app.payments SET status='failed' WHERE id=$1 AND tenant_id=$2 AND status='initiated'`,
          [ctx.paymentId, req.user.tenant_id]);
        await requestAudit(c, req.user.tenant_id, ID, {
          actor: req.user.name, action: 'Razorpay order failed', recordType: 'Payment', recordRef: ctx.paymentId,
          reason: `obligation ${ctx.label}`, policyRef: 'Fees §4.2', risk: 'medium',
          outcome: `gateway refused — ${String(gwErr).slice(0, 200)} · payment marked failed (retryable)` });
        out = bad(reply, 'Razorpay could not create the order — try again or collect at the desk', 502, { detail: String(gwErr).slice(0, 200) });
        return out;
      }
      await c.query(
        `INSERT INTO plugin_razorpay.order_log (tenant_id, payment_id, razorpay_order_id, razorpay_payment_id, status, payload)
         VALUES ($1,$2,$3,NULL,$4,$5)`,
        [req.user.tenant_id, ctx.paymentId, order.id, order.status ?? 'created', JSON.stringify(order).slice(0, 16384)]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'fees', label: `razorpay.order.created — ${ctx.studentName} · ₹${Number(ctx.due) / 100} (${ctx.label})`, ref: order.id },
        'razorpay.order.created', { paymentId: ctx.paymentId, obligationId: ctx.obligationId, razorpayOrderId: order.id, amountCents: ctx.due.toString() });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Razorpay order created', recordType: 'Payment', recordRef: ctx.paymentId,
        reason: `obligation ${ctx.label}`, policyRef: 'Fees §4.2', risk: 'medium',
        outcome: `gateway order ${order.id} · ₹${Number(ctx.due) / 100} · settlement remains kernel-only` });
      out = { paymentId: ctx.paymentId, orderId: order.id, amountCents: ctx.due.toString(), currency: order.currency ?? 'INR', keyId, status: order.status ?? 'created', studentName: ctx.studentName, obligationLabel: ctx.label };
      return out;
    });
    return out ?? reply;
  });

  // ══ Door: signed gateway webhook (public) — payments.upi gate pattern ═════════
  app.post(`/plugins/${ID}/webhook`, { config: { rateLimit: { max: 2000, timeWindow: '1 minute' } } }, async (req, reply) => {
    // ── Gate 0 (body shape): upi parses after HMAC; this rail must read the
    // payload BEFORE verification to pick a per-tenant secret candidate when no
    // env secret exists (gateway payloads carry no tenant). The parse is
    // read-only — it records nothing — and 400s garbage exactly like upi (P1-2).
    const raw = req.rawBody ?? Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(raw.toString('utf8')) : (req.body ?? {});
    } catch {
      return bad(reply, 'Payment data could not be read');
    }
    const type = body?.event ?? 'payment.captured';
    const entity = body?.payload?.payment?.entity ?? {};
    const entityId = entity.id ?? null;
    const rzpOrderId = body?.payload?.order?.entity?.id ?? entity.order_id ?? null;
    const paymentId = entity.notes?.paymentId ?? body?.paymentId ?? null;

    // ── Gate 1: fail-closed, verification FIRST (SEC-21). The candidate set comes from the plugin
    // registry + env only — never from the payload — so nothing an unauthenticated caller sends can
    // change the answer they get, or the number of database queries their request causes.
    const candidates = await webhookCandidates();
    if (!candidates.length) return bad(reply, 'Payments are not set up yet', 403);

    // ── Gate 2: HMAC sha256 over the RAW request bytes, timing-safe, any candidate.
    // Every failure below is the SAME response: a missing signature, a malformed one and a wrong one
    // must be indistinguishable, because telling them apart is free information for an attacker.
    const sig = req.headers['x-razorpay-signature'];
    if (!sig) return unauth(reply);
    let matched = null;
    for (const cand of candidates) {
      const mac = createHmac('sha256', cand.secret).update(raw).digest();
      try { if (timingSafeEqual(mac, Buffer.from(String(sig), 'hex'))) { matched = cand; break; } } catch { /* non-hex sig → next candidate */ }
    }
    if (!matched) return unauth(reply);
    const verified = true;   // the row records "the HMAC matched", which is now the only way to get here

    // ── Gate 3: tenant resolution — AUTHENTICATED work, so a payload-dependent answer is fine here
    // (and the 404-on-miss still stays ahead of any write, matching upi's response shape).
    let tenantId = null;
    if (rzpOrderId) {
      tenantId = (await sysq(`SELECT tenant_id FROM plugin_razorpay.order_log WHERE razorpay_order_id=$1 LIMIT 1`, [rzpOrderId])).rows[0]?.tenant_id ?? null;
    }
    if (!tenantId && paymentId && UUID_RE.test(String(paymentId))) {
      tenantId = (await sysq(`SELECT tenant_id FROM app.payments WHERE id=$1`, [paymentId])).rows[0]?.tenant_id ?? null;
    }
    // SEC-21 (second half): bind the event to the tenant whose secret proved it. Without this, a
    // party holding ANY tenant's webhook secret — a leaked per-school key, or a malicious tenant —
    // could sign a body naming ANOTHER school's order id and have the resulting fact written into that
    // school's ledger. A deployment-wide env secret is trusted for any tenant by design; a per-tenant
    // secret is trusted only for its own tenant.
    if (matched.tenantId && tenantId && matched.tenantId !== tenantId) {
      return bad(reply, 'Payment event does not belong to the school that signed it', 403);
    }

    // ── Gate 3: event identity. Razorpay payloads carry no event id, so the
    // composite `type:entityId` is the dedupe id — a REPLAY of the same webhook
    // recomputes it (no-op), while distinct event types for one payment record
    // separately. An explicit body.eventId (test harnesses) wins.
    const eventId = body?.eventId ?? (entityId ? `${type}:${entityId}` : null);
    if (!eventId) return bad(reply, 'Payment event is missing its event ID');
    if (!entityId && !rzpOrderId && !(paymentId && UUID_RE.test(String(paymentId)))) {
      return bad(reply, 'Payment event is missing a valid payment reference');
    }
    if (!tenantId) return bad(reply, 'We couldn\'t find that payment', 404);

    // webhook facts are tenant-resolved from the order/payment row, then written on that tenant's path
    return withUser(tenantId, 'system', async (c) => {
      // ── Gate 4: lifecycle (upi parity) — facts only for an ENABLED rail
      const pl = (await c.query(
        `SELECT status, COALESCE(settings->>'webhook_freshness_mins','15') AS fresh_mins
         FROM app.plugins WHERE tenant_id=$1 AND plugin_id='${ID}'`, [tenantId])).rows[0];
      if (!pl || !['enabled', 'active', 'degraded'].includes(pl.status)) {
        return bad(reply, 'Fee payments is switched off — ask the school owner to turn it on', 409);
      }
      // ── Gate 5: freshness (P1-1/P2-A/P2-B semantics, upi parity): accepted ONLY
      // within ±fresh_mins of now — strictly-older AND future-dated beyond the
      // same window are rejected (negative age is not an acceptance path).
      // SEC-21: a MISSING timestamp is now rejected instead of skipping the check. `if (ts != null)`
      // meant replay defence was opt-in by the sender: a signed body with the timestamp field simply
      // removed bypassed freshness entirely, and since a captured webhook is replayable by anyone who
      // observed it (or by the gateway's own retry), that is exactly the case the window exists for.
      const ts = entity.created_at ?? body?.timestamp;
      if (ts == null) {
        return bad(reply, 'Payment event has no timestamp — freshness cannot be established');
      }
      {
        const ageMins = (Date.now() / 1000 - Number(ts)) / 60;
        if (!Number.isFinite(ageMins) || Math.abs(ageMins) > Number(pl.fresh_mins)) {
          return bad(reply, `Payment event is too old (older than ${pl.fresh_mins} minutes)`);
        }
      }
      // ── Gate 6: dedupe EVERYTHING on one insert — the row landing is the ticket
      // for the event spine AND the audit entry; replays are 200 no-ops with zero
      // side effects (upi parity, UNIQUE (tenant_id, event_id) from migration 044).
      const ins = await c.query(
        `INSERT INTO plugin_razorpay.webhook_log (tenant_id, gateway, event_id, event_type, payload, signature_verified)
         VALUES ($1,'razorpay',$2,$3,$4,$5) ON CONFLICT (tenant_id, event_id) DO NOTHING RETURNING id`,
        [tenantId, eventId, type, raw.toString('utf8').slice(0, 16384), verified]);
      if (!ins.rows[0]) {
        return { ok: true, outcome: 'replay no-op (event already recorded); settlement is kernel-only (staff confirm)' };
      }
      // ── Facts only (NEVER settlement): payment.* events stamp the order row's
      // status + gateway payment reference. app.payments / app.fee_obligations are
      // deliberately untouched — kernel confirm stays the only settlement (Fees §4.2).
      if (String(type).startsWith('payment.')) {
        await c.query(
          `UPDATE plugin_razorpay.order_log SET status=$2,
                  razorpay_payment_id = COALESCE(razorpay_payment_id, $3)
           WHERE tenant_id=$1
             AND (($4::text IS NOT NULL AND razorpay_order_id=$4)
               OR ($5::text IS NOT NULL AND razorpay_payment_id=$5))`,
          [tenantId, type, entityId, rzpOrderId, entityId]);
      }
      await emitEvent(c, tenantId,
        { type: 'fees', label: `${type} — webhook fact recorded (${eventId})`, ref: entityId ?? rzpOrderId ?? null },
        type, { eventId, type, razorpayOrderId: rzpOrderId, razorpayPaymentId: entityId, verified });
      await requestAudit(c, tenantId, ID, {
        actor: 'gateway webhook', action: `Razorpay webhook ${type}`, recordType: 'Payment', recordRef: entityId ?? rzpOrderId ?? null,
        reason: `event ${eventId}`, policyRef: 'Fees §4.2', risk: 'low',
        outcome: 'fact recorded · HMAC verified over raw bytes · settlement untouched (kernel-only)' });
      return { ok: true, outcome: 'fact recorded; settlement is kernel-only (staff confirm)' };
    });
  });
}
