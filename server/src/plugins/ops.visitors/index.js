// ops.visitors — runtime module (migration 024). Class C: campus gate pass with
// guardian-verified student pickup. The pickup OTP rides the KERNEL PATTERN from 008:
// scrypt+salt hashed, short TTL, attempt-bounded, consumed-on-success, stored in
// plugin_visitors.pickup_otp under RLS that DENIES the app role (USING (false)) —
// secret reads/writes happen only through the kernel/owner connection (kernel.q via
// withUser). Release is FAIL-CLOSED: a pickup visit cannot complete without guardian
// verification (audited owner/principal override is the only bypass). Uniform
// lifecycle gate on every door (P2-1 posture). All preHandlers async (Fastify 5 law).
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js';
import { config } from '../../config.js';

const ID = 'ops.visitors';

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, q } = kernel;

  const DESK = ['owner', 'principal', 'itadmin', 'coordinator']; // front-desk authority
  const lifecycleGate = makeLifecycleGate(kernel.q, ID);
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  const badge = () => 'V-' + randomBytes(4).toString('hex').toUpperCase();
  const ttl = (s) => Math.max(1, Math.min(30, Number(s?.pickup_otp_ttl_minutes) || 5));
  const maxAttempts = (s) => Math.max(1, Math.min(10, Number(s?.pickup_otp_max_attempts) || 5));
  // settings via kernel path (owner connection) — tenant is always req.user.tenant_id
  const settings = (tenantId) => q(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, ID]);

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
      // kernel OTP-vault write (owner path): scrypt+salt hash, TTL from settings
      const s = (await settings(req.user.tenant_id)).rows[0]?.settings ?? {};
      const code = String(randomInt(100000, 1000000)); // P3-2 (cycle 6): CSPRNG — Math.random is not a secret source
      const salt = randomBytes(16).toString('hex');
      const hash = scryptSync(code, salt, 64).toString('hex');
      // kernel OTP-vault write (owner path): the app role is RLS-denied on the vault —
      // only the kernel connection may write verification secrets (008 parity)
      const otp = await q(
        `INSERT INTO app.auth_otps (tenant_id, phone, code_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(mins => $4)) RETURNING id`,
        [req.user.tenant_id, g.phone, `${salt}:${hash}`, ttl(s)]);
      await c.query(`UPDATE plugin_visitors.visit SET status='pickup_pending', otp_request_id=$1, updated_at=now() WHERE id=$2`, [otp.rows[0].id, v.id]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'visitors', label: `pickup requested — OTP sent to primary guardian (…${g.phone.slice(-4)})`, ref: v.id },
        'visitor.pickup.requested.v1', { visitId: v.id, studentRef: v.student_ref });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.email, action: 'pickup OTP raised', recordType: 'VisitorPass', recordRef: v.id,
        reason: 'guardian-verified pickup', policyRef: 'Student safety · guardian pickup verification', risk: 'medium',
        outcome: `OTP issued to primary guardian (…${g.phone.slice(-4)}), TTL ${ttl(s)}m — secret in kernel vault` });
      const body = { ok: true, status: 'pickup_pending', ttlMinutes: ttl(s) };
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
      const otp = (await q(`SELECT id, phone, code_hash, attempts, expires_at, consumed_at FROM app.auth_otps WHERE id=$1`, [v.otp_request_id])).rows[0];
      if (!otp || otp.consumed_at) return bad(reply, 'That code is used up — request a new one', 409); // UI lane #1: OTP-state ≠ auth
      if (new Date(otp.expires_at) < new Date()) return bad(reply, 'That code has expired — request a new one', 409); // UI lane #1
      if (otp.attempts >= config.otp.maxAttempts) return bad(reply, 'Too many wrong attempts — request a new code', 429);
      const [salt, hash] = otp.code_hash.split(':');
      const ok = (() => { try { return timingSafeEqual(scryptSync(String(code), salt, 64), Buffer.from(hash, 'hex')); } catch { return false; } })();
      if (!ok) {
        await q(`UPDATE app.auth_otps SET attempts = attempts + 1 WHERE id=$1`, [otp.id]);
        await c.query(`UPDATE plugin_visitors.visit SET otp_attempts = otp_attempts + 1, updated_at=now() WHERE id=$1`, [v.id]);
        return bad(reply, 'That code is not right — check it and try again', 422); // UI lane #1: unprocessable code, not an auth failure
      }
      await q(`UPDATE app.auth_otps SET consumed_at = now() WHERE id=$1`, [otp.id]); // consume on success (kernel parity, owner path)
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
