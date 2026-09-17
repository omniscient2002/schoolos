// ops.visitors — runtime module (migration 024). Class C: campus gate pass with
// guardian-verified student pickup. The pickup OTP rides the KERNEL PATTERN from 008:
// scrypt+salt hashed, short TTL, attempt-bounded, consumed-on-success, stored in
// plugin_visitors.pickup_otp under RLS that DENIES the app role (USING (false)) —
// secret reads/writes happen only through the kernel/owner connection (kernel.sysq via
// withUser). Release is FAIL-CLOSED: a pickup visit cannot complete without guardian
// verification (audited owner/principal override is the only bypass). Uniform
// lifecycle gate on every door (P2-1 posture). All preHandlers async (Fastify 5 law).
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js';
import { config } from '../../config.js';
import { isSandboxResult, sandboxAllowed } from '../_shared/delivery-honesty.js';
import { toE164 } from '../_shared/phone.js';

const ID = 'ops.visitors';

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, sysq } = kernel;

  const DESK = ['owner', 'principal', 'itadmin', 'coordinator']; // front-desk authority
  const lifecycleGate = makeLifecycleGate(kernel.sysq, ID);
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  const badge = () => 'V-' + randomBytes(4).toString('hex').toUpperCase();
  const ttl = (s) => Math.max(1, Math.min(30, Number(s?.pickup_otp_ttl_minutes) || 5));
  const maxAttempts = (s) => Math.max(1, Math.min(10, Number(s?.pickup_otp_max_attempts) || 5));
  // settings via kernel path (owner connection) — tenant is always req.user.tenant_id
  const settings = (tenantId) => sysq(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, ID]);

  // ── log an expected visitor (front desk) ─────────────────────────────────────
  app.post(`/plugins/${ID}/visitors`, { preHandler: [require(...DESK), lifecycleGate] }, async (req, reply) => {
    const { visitorName, visitorPhone, purpose, detail, studentId, expectedAt } = req.body ?? {};
    if (!visitorName || !purpose) return bad(reply, 'Visitor name and purpose are required');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (studentId) {
        const st = (await c.query(`SELECT id FROM app.students WHERE id=$1 AND tenant_id=$2`, [studentId, req.user.tenant_id])).rows[0];
        if (!st) return bad(reply, 'student not found', 404);
      }
      const r = await c.query(
        `INSERT INTO plugin_visitors.visit (tenant_id, visitor_name, visitor_phone, purpose, detail, student_ref, badge_code, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, badge_code`,
        [req.user.tenant_id, String(visitorName).slice(0, 120), visitorPhone ? String(visitorPhone) : null,
          String(purpose).slice(0, 40), detail ? String(detail).slice(0, 200) : null, studentId ?? null, badge(), req.user.id]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'visitors', label: `visitor logged: ${String(visitorName).slice(0, 60)} (${purpose})`, ref: r.rows[0].id },
        'visitor.logged.v1', { visitId: r.rows[0].id, purpose, studentRef: studentId ?? null });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'visitor logged', recordType: 'VisitorPass', recordRef: r.rows[0].id,
        reason: 'gate pass', policyRef: 'Student safety · guardian pickup verification', risk: 'low',
        outcome: `expected (${purpose}) · badge ${r.rows[0].badge_code}` });
      return { ok: true, visitId: r.rows[0].id, badge: r.rows[0].badge_code, status: 'expected' };
    });
  });

  // ── list passes (front desk) ─────────────────────────────────────────────────
  app.get(`/plugins/${ID}/visitors`, { preHandler: [require(...DESK), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const status = req.query.status ? String(req.query.status) : null;
      const rows = (await c.query(
        `SELECT v.id, v.visitor_name, v.visitor_phone, v.purpose, v.detail, v.status, v.badge_code,
                v.verified_at, s.name AS student_name, v.created_at, v.updated_at
         FROM plugin_visitors.visit v LEFT JOIN app.students s ON s.id = v.student_ref
         WHERE v.tenant_id=$1 AND ($2::text IS NULL OR v.status=$2)
         ORDER BY v.created_at DESC LIMIT 200`, [req.user.tenant_id, status])).rows;
      return {
        visits: rows.map((r) => ({
          id: r.id, visitorName: r.visitor_name, visitorPhone: r.visitor_phone, purpose: r.purpose,
          detail: r.detail, status: r.status, badge: r.badge_code, studentName: r.student_name,
          verified: !!r.verified_at, createdAt: r.created_at, updatedAt: r.updated_at,
        })),
      };
    });
  });

  // ── check in (expected → checked_in; badge physically issued) ────────────────
  // ── guardian lookup (front-desk pickup roster) ─────────────────────────────
  // UI lane #2 data-flow contract: the pickup roster is NOT dataset-derived. The desk
  // resolves student → primary guardian through this door (app.guardians is the single
  // source of truth; dataset student ids are fixture keys, not app.students UUIDs).
  // Resolve by uuid id, admission_no (MER-…), or name tail match; phone tail is NOT
  // echoed — masked to the desk tier (full numbers only ride the OTP vault path).
  app.get(`/plugins/${ID}/guardian-lookup`, { preHandler: [require(...DESK), lifecycleGate] }, async (req, reply) => {
    const { studentId, admissionNo, q: nameQuery } = req.query ?? {};
    if (!studentId && !admissionNo && !nameQuery) return bad(reply, 'Search by ID, admission number or name');
    // PLGX: studentId was compared to the uuid column raw — `?studentId=abc` was a 22P02 → 500.
    if (studentId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(studentId))) return bad(reply, 'studentId must be a uuid');
    if (nameQuery && String(nameQuery).length > 80) return bad(reply, 'Search text is too long');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const clauses = []; const params = [req.user.tenant_id];
      if (studentId) { params.push(String(studentId)); clauses.push(`s.id=$${params.length}`); }
      if (admissionNo) { params.push(String(admissionNo)); clauses.push(`s.admission_no=$${params.length}`); }
      if (nameQuery) {
        // P3-5 (cycle 6): escape ILIKE wildcards — q is a substring, not a pattern
        const esc = String(nameQuery).replace(/([%_\\])/g, '\\$1');
        params.push(`%${esc}%`);
        clauses.push(`s.name ILIKE $${params.length} ESCAPE '\\'`);
      }
      const rows = (await c.query(
        `SELECT s.id, s.admission_no, s.name, s.grade, s.section,
                g.name AS guardian_name, g.relation, g.phone,
                right(regexp_replace(g.phone, '\\D', '', 'g'), 4) AS phone_tail
         FROM app.students s
         LEFT JOIN app.guardians g ON g.student_id = s.id AND g.is_primary
         WHERE s.tenant_id=$1 AND ${clauses.join(' OR ')}
         ORDER BY s.name LIMIT 10`, params)).rows;
      return { matches: rows.map((r) => ({
        studentId: r.id, admissionNo: r.admission_no, studentName: r.name, class: `${r.grade}-${r.section}`,
        guardian: r.guardian_name ? {
          name: r.guardian_name, relation: r.relation,
          phoneOnFile: !!r.phone, phoneTail: r.phone_tail ?? null,
        } : null })) };
    });
  });

  app.post(`/plugins/${ID}/visitors/:id/checkin`, { preHandler: [require(...DESK), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const v = (await c.query(`SELECT id, status, purpose FROM plugin_visitors.visit WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!v) return bad(reply, 'We couldn\'t find that visit', 404);
      if (v.status !== 'expected') return bad(reply, `Only an expected visitor can be checked in (this one is ${v.status})`, 409);
      const u = await c.query(`UPDATE plugin_visitors.visit SET status='checked_in', updated_at=now() WHERE id=$1 RETURNING status`, [v.id]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'visitors', label: 'visitor checked in', ref: v.id },
        'visitor.checked_in.v1', { visitId: v.id, purpose: v.purpose });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'visitor checked in', recordType: 'VisitorPass', recordRef: v.id,
        reason: 'gate pass', policyRef: 'Student safety · guardian pickup verification', risk: 'low', outcome: 'on campus' });
      return { ok: true, status: u.rows[0].status };
    });
  });

  // ── request pickup (raises guardian OTP through the kernel vault) ────────────
  app.post(`/plugins/${ID}/visitors/:id/pickup`, { preHandler: [require(...DESK), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const v = (await c.query(`SELECT id, status, student_ref FROM plugin_visitors.visit WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!v) return bad(reply, 'We couldn\'t find that visit', 404);
      if (!['expected', 'checked_in'].includes(v.status)) return bad(reply, `Pickup can only start once the visitor is checked in (this one is ${v.status})`, 409);
      if (!v.student_ref) return bad(reply, 'pickup flow requires a student link (log the visit with studentId)', 400);
      const g = (await c.query(
        `SELECT phone FROM app.guardians WHERE student_id=$1 AND tenant_id=$2 AND is_primary AND phone IS NOT NULL ORDER BY created_at LIMIT 1`,
        [v.student_ref, req.user.tenant_id])).rows[0];
      if (!g) return bad(reply, 'No guardian phone on file — verify with photo ID at the desk', 409);
      // The stored number is whatever the school office typed — the seed itself keeps `+91 9720000243`,
      // with a space, which the rail refuses. Normalise BEFORE minting anything, or a configured channel
      // still delivers nothing.
      //
      // ORDERING IS THE POINT (found by independent review of the first version of this fix, which
      // normalised AFTER the vault write): on the refusal below the handler returns a reply rather than
      // throwing, so `withUser` COMMITS. Normalising later left the visit flipped to `pickup_pending` with
      // a live `otp_request_id` and an unconsumed vault row — precisely the dangling state the
      // undeliverable branch exists to prevent, reached by a different door. Refusing here changes
      // nothing: the vault write and the status flip have not happened yet.
      const to = toE164(g.phone);
      if (!to) return bad(reply, 'The guardian phone on file is not a usable mobile number — verify with photo ID at the desk, or correct it in the student record.', 409);
      // kernel OTP-vault write (owner path): scrypt+salt hash, TTL from settings
      const s = (await settings(req.user.tenant_id)).rows[0]?.settings ?? {};
      const code = String(randomInt(100000, 1000000)); // P3-2 (cycle 6): CSPRNG — Math.random is not a secret source
      const salt = randomBytes(16).toString('hex');
      const hash = scryptSync(code, salt, 64).toString('hex');
      // T102 (P0-1): pickup codes live in THIS plugin's vault (plugin_visitors.pickup_otp,
      // 024 — RLS denies the app role, owner-path write only). They must NEVER ride
      // app.auth_otps: a vault row there is a LOGIN OTP and a front-desk pickup code
      // could be redeemed at /auth/otp/verify for a full guardian session.
      const otp = await sysq(
        `INSERT INTO plugin_visitors.pickup_otp (tenant_id, visit_id, phone, code_hash, expires_at)
         VALUES ($1,$2,$3,$4, now() + make_interval(mins => $5)) RETURNING id`,
        [req.user.tenant_id, v.id, g.phone, `${salt}:${hash}`, ttl(s)]);
      await c.query(`UPDATE plugin_visitors.visit SET status='pickup_pending', otp_request_id=$1, updated_at=now() WHERE id=$2`, [otp.rows[0].id, v.id]);

      // ── PRD-13 · DELIVER IT. ────────────────────────────────────────────────────────────────────
      // Before this, the code was minted, scrypt-hashed and vaulted under RLS that denies the app role
      // — and handed to NOBODY. No rail call, no comms row, not even a queue entry existed, yet the
      // event announced "OTP sent to primary guardian" and the audit said "OTP issued to primary
      // guardian". The desk believed a code was on its way and the guardian had nothing to read out.
      // Because release is fail-closed, the practical effect was that every pickup degraded to the
      // photo-ID override WHILE THE RECORD CLAIMED THE IDENTITY CHECK HAD HAPPENED — the worst place
      // in the product for the ledger to lie.
      //
      // Sent DIRECTLY through the rail rather than queued, for the same reason the reset door does it:
      // a live single-use code must never sit in app.communications waiting for a dispatcher, because
      // that table is served with SELECT * to six roles (SEC-0). The ledger gets a REDACTED body as
      // delivery evidence — the ledger is evidence, never the channel.
      //
      // Bind the rail's kernel query first: `rails.*` are not in the plugin catalog, so their
      // register() never runs in this process and kernelQ stays null. An unbound rail does not fail —
      // readSettings throws, the catch "degrades to logger", and EVERY send comes back
      // {ok:true, provider:'logger'} whatever the tenant has configured. The reset door binds
      // rails.email for exactly this reason.
      const { bindKernel: bindSmsKernel, sendSms } = await import('../rails.sms/index.js');
      bindSmsKernel(sysq);
      const ttlMinutes = ttl(s);
      const smsBody = [
        `SchoolOS: the pickup code for your child is ${code}.`,
        `It expires in ${ttlMinutes} minutes and can be used once.`,
        'Show it to the gate staff. Do not share it — anyone with this code can collect your child.',
      ].join(' ');
      const dedupKey = `pickup:${otp.rows[0].id}`;
      const sms = await sendSms({ to, body: smsBody, dedupKey, tenantId: req.user.tenant_id });

      // The same carrier rule the dispatcher and the reset door use — one definition, not a third one.
      const sandboxed = isSandboxResult(sms);
      const undeliverable = !sms.ok || (sandboxed && !sandboxAllowed(config.env));
      const why = !sms.ok
        ? String(sms.error ?? 'provider error')
        : sandboxed && !sandboxAllowed(config.env)
          ? `undeliverable — sandbox carrier "${sms.provider}" in production: the pickup code reached nobody`
          : null;

      // Ledger row as EVIDENCE (SEC-0): redacted, so the code never lands in a six-role-readable table.
      // Written through the CONSTRAINED client, not the owner path: `schoolos_app` holds INSERT on
      // app.communications and the RLS policy checks `tenant_id = app.current_tenant()` as a WITH CHECK,
      // so the proposed path proves the row belongs to this tenant instead of asserting it. (The vault
      // DELETE above must stay on the owner path — plugin_visitors.pickup_otp denies the app role.)
      await c.query(
        `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, dedup_key, last_error, provider, sent_at, delivered_at)
         VALUES ($1,'guardian',$2::jsonb,'sms','PICKUP_OTP',$3,$4,$5,$6,$7,$8,$9)`,
        [req.user.tenant_id, JSON.stringify([to]),
          smsBody.replace(code, `${code.slice(0, 2)}…(redacted — the ledger is evidence, not the channel)`),
          undeliverable ? 'failed' : 'sent',
          undeliverable ? `${dedupKey}:failed` : dedupKey,
          why, String(sms.provider ?? 'unknown'),
          undeliverable ? null : new Date(),
          // only a REAL carrier can confirm delivery; a sandbox one never does (PRD-13)
          !undeliverable && !sandboxed ? new Date() : null]);

      if (undeliverable) {
        // COMPENSATION: withdraw the code and put the visit back exactly as it was. A live OTP nobody
        // holds is worse than none — it leaves the visit in 'pickup_pending' with a dangling
        // otp_request_id, so /pickup/verify answers "No pickup code is active for this visit" at a
        // desk that has just been told to expect one. Failing loudly sends them to the audited
        // photo-ID override instead, which is the truth about what is being relied on.
        await sysq(`DELETE FROM plugin_visitors.pickup_otp WHERE id=$1`, [otp.rows[0].id]);
        await c.query(`UPDATE plugin_visitors.visit SET status=$1, otp_request_id=NULL, updated_at=now() WHERE id=$2`, [v.status, v.id]);
        await requestAudit(c, req.user.tenant_id, ID, {
          actor: req.user.email, action: 'pickup OTP delivery failed', recordType: 'VisitorPass', recordRef: v.id,
          reason: 'guardian-verified pickup', policyRef: 'Student safety · guardian pickup verification', risk: 'medium',
          outcome: `no code reached the primary guardian (…${g.phone.slice(-4)}) — ${why}; vault row withdrawn and visit returned to "${v.status}" (photo-ID override is the remaining path)` });
        return bad(reply, `The pickup code could not be sent to the guardian (${why}). Verify with photo ID at the desk, or fix the SMS channel and try again.`, 503);
      }

      await emitEvent(c, req.user.tenant_id,
        { type: 'visitors', label: `pickup requested — code delivered to primary guardian (…${g.phone.slice(-4)}) via ${sms.provider}${sandboxed ? ' (sandbox — no carrier configured)' : ''}`, ref: v.id },
        'visitor.pickup.requested.v1', { visitId: v.id, studentRef: v.student_ref });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'pickup OTP raised', recordType: 'VisitorPass', recordRef: v.id,
        reason: 'guardian-verified pickup', policyRef: 'Student safety · guardian pickup verification', risk: 'medium',
        outcome: `OTP handed to the SMS carrier "${sms.provider}" for the primary guardian (…${g.phone.slice(-4)}), TTL ${ttlMinutes}m — secret in kernel vault`
          + (sandboxed ? ' [SANDBOX: no provider is configured, so only a log line exists — nothing left the building]' : '') });
      const body = { ok: true, status: 'pickup_pending', ttlMinutes, deliveredVia: String(sms.provider ?? 'unknown'), sandbox: sandboxed };
      if (config.otp.devEcho) body.devCode = code; // dev-only echo, opt-in via OTP_DEV_ECHO (kernel parity)
      return body;
    });
  });

  // ── verify pickup code (pickup_pending → verified; consumes the vault OTP) ───
  app.post(`/plugins/${ID}/visitors/:id/pickup/verify`, { preHandler: [require(...DESK), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const { code } = req.body ?? {};
    if (!code) return bad(reply, 'Please enter the pickup code');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const v = (await c.query(`SELECT id, status, otp_request_id FROM plugin_visitors.visit WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!v) return bad(reply, 'We couldn\'t find that visit', 404);
      if (v.status !== 'pickup_pending' || !v.otp_request_id) return bad(reply, `No pickup code is active for this visit (status: ${v.status})`, 409);
      const s = (await settings(req.user.tenant_id)).rows[0]?.settings ?? {};
      const otp = (await sysq(`SELECT id, phone, code_hash, attempts, expires_at, consumed_at FROM plugin_visitors.pickup_otp WHERE id=$1 AND tenant_id=$2`, [v.otp_request_id, req.user.tenant_id])).rows[0];
      if (!otp || otp.consumed_at) return bad(reply, 'That code is used up — request a new one', 409); // UI lane #1: OTP-state ≠ auth
      if (new Date(otp.expires_at) < new Date()) return bad(reply, 'That code has expired — request a new one', 409); // UI lane #1
      const allowedAttempts = maxAttempts(s);
      if (otp.attempts >= allowedAttempts) return bad(reply, 'Too many wrong attempts — request a new code', 429);
      const [salt, hash] = otp.code_hash.split(':');
      const ok = (() => { try { return timingSafeEqual(scryptSync(String(code), salt, 64), Buffer.from(hash, 'hex')); } catch { return false; } })();
      if (!ok) {
        const attempted = await sysq(
          `UPDATE plugin_visitors.pickup_otp SET attempts = attempts + 1
           WHERE id=$1 AND consumed_at IS NULL AND attempts < $2 RETURNING attempts`,
          [otp.id, allowedAttempts]);
        if (!attempted.rows[0]) return bad(reply, 'Too many wrong attempts — request a new code', 429);
        await c.query(`UPDATE plugin_visitors.visit SET otp_attempts = otp_attempts + 1, updated_at=now() WHERE id=$1`, [v.id]);
        // DAT-6: a REJECTED pickup code increments the attempt counters on both the vault row and the visit — a
        // real state change on the student-release path — but only the SUCCESS path audited, so a run of failed
        // attempts against a child's release code left the ledger looking untouched. That is backwards for the
        // one event a school most needs to reconstruct later: the attempts that preceded a release, or a series
        // of rejected codes at the gate that nobody ever completed. `otp_attempts` is a counter an operator can
        // see, but nothing recorded WHO tried, WHEN, or against WHICH visit, and the visit row carries no
        // history. Audited on every rejection rather than only at the attempt ceiling, because "it hit the
        // ceiling" is not the question anyone asks — "who was at the gate trying codes" is. The two counter
        // updates and this row share one transaction, so the ledger cannot disagree with the counters.
        // `risk: 'high'` is deliberate and is about the SUBJECT, not the privilege: a rejected guardian-pickup
        // code is an attempted release of a child to someone who could not prove they were authorised.
        await requestAudit(c, req.user.tenant_id, ID, {
          actor: req.user.email, action: 'guardian pickup code rejected', recordType: 'VisitorPass', recordRef: v.id,
          reason: 'student release authorization', policyRef: 'Student safety · guardian pickup verification', risk: 'high',
          outcome: `wrong pickup code — attempt ${attempted.rows[0].attempts} of ${allowedAttempts} · student NOT released · visit stays ${v.status}` });
        return bad(reply, 'That code is not right — check it and try again', 422); // UI lane #1: unprocessable code, not an auth failure
      }
      const consumed = await sysq(`UPDATE plugin_visitors.pickup_otp SET consumed_at = now() WHERE id=$1 AND consumed_at IS NULL RETURNING id`, [otp.id]); // consume on success (owner path)
      if (!consumed.rows[0]) return bad(reply, 'That code is used up — request a new one', 409);
      const u = await c.query(`UPDATE plugin_visitors.visit SET status='verified', verified_at=now(), updated_at=now() WHERE id=$1 RETURNING status`, [v.id]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'visitors', label: 'guardian verified pickup', ref: v.id },
        'visitor.pickup.verified.v1', { visitId: v.id });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'guardian pickup verified', recordType: 'VisitorPass', recordRef: v.id,
        reason: 'student release authorization', policyRef: 'Student safety · guardian pickup verification', risk: 'medium',
        outcome: 'guardian OTP verified — student release authorized' });
      return { ok: true, status: u.rows[0].status };
    });
  });

  // ── complete (release / departure) — FAIL-CLOSED for pickup visits ───────────
  app.post(`/plugins/${ID}/visitors/:id/complete`, { preHandler: [require(...DESK), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const override = req.body?.override === true;
    const note = req.body?.note ? String(req.body.note).slice(0, 200) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const v = (await c.query(`SELECT id, status, purpose, verified_at, student_ref FROM plugin_visitors.visit WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!v) return bad(reply, 'We couldn\'t find that visit', 404);
      const unverifiedPickup = v.purpose === 'pickup' && v.student_ref && !v.verified_at;
      if (unverifiedPickup) {
        // no_release_without_verification — the only bypass is an audited senior override,
        // which may complete from pickup_pending (that is precisely its purpose)
        if (!override || !['owner', 'principal'].includes(req.user.role)) {
          return bad(reply, 'student release is BLOCKED: pickup not guardian-verified (owner/principal override with note required)', 409);
        }
        if (!note) return bad(reply, 'override requires a note', 400);
      } else if (v.status !== 'verified' && v.status !== 'checked_in') {
        return bad(reply, `Verify the pickup code before completing (this visit is ${v.status})`, 409);
      }
      const u = await c.query(`UPDATE plugin_visitors.visit SET status='completed', updated_at=now() WHERE id=$1 RETURNING status`, [v.id]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'visitors', label: v.purpose === 'pickup' ? 'student released (pickup completed)' : 'visit completed', ref: v.id },
        'visitor.completed.v1', { visitId: v.id, override: override && !v.verified_at });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'visit completed', recordType: 'VisitorPass', recordRef: v.id,
        reason: v.purpose === 'pickup' ? 'student release' : 'departure',
        policyRef: 'Student safety · guardian pickup verification', risk: override ? 'high' : 'low',
        outcome: override && !v.verified_at ? `UNVERIFIED RELEASE OVERRIDE by ${req.user.role}: ${note}` : 'completed' });
      return { ok: true, status: u.rows[0].status, overrideUsed: override && !v.verified_at };
    });
  });

  // ── deny (front desk refuses entry) ──────────────────────────────────────────
  app.post(`/plugins/${ID}/visitors/:id/deny`, { preHandler: [require(...DESK), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const note = req.body?.note ? String(req.body.note).slice(0, 200) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const v = (await c.query(`SELECT id, status FROM plugin_visitors.visit WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!v) return bad(reply, 'We couldn\'t find that visit', 404);
      if (['completed', 'denied'].includes(v.status)) return bad(reply, `This visit can\'t be denied from ${v.status}`, 409);
      const u = await c.query(`UPDATE plugin_visitors.visit SET status='denied', updated_at=now() WHERE id=$1 RETURNING status`, [v.id]);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'visitor denied', recordType: 'VisitorPass', recordRef: v.id,
        reason: 'gate refusal', policyRef: 'Student safety · guardian pickup verification', risk: 'low',
        outcome: note ? `denied: ${note}` : 'denied' });
      return { ok: true, status: u.rows[0].status };
    });
  });
}
