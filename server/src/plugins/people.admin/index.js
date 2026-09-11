// people.admin — runtime module (migration 046, Wave B unit 1). Class B: identity &
// roster administration. Closes three named gaps from docs/DATA-FLOW:
//   · §15.2 / §24 — "no admin suspension door (manual DB)": suspend/activate flip
//     app.users.active; the kernel authenticate hook re-reads the LIVE user row on
//     every request (app.js:43-45) and refuses with 'account disabled', so suspension
//     lands at the very next request without touching tokens or the denylist.
//   · §5 — "a live door for section change is NOT IMPLEMENTED": transfer writes an
//     append-only app.enrollment_history row (from→to) BEFORE flipping the student,
//     inside one transaction — history and current state can never disagree.
//   · §25.2 — "users are seeded/administered outside the app": provisioning issues
//     scrypt credentials (auth.js hashPassword, kernel parity), stamps force_change
//     when a temporary password is generated, shows the temp password EXACTLY ONCE,
//     and optionally binds a parent to a child via family.child_link (034 bridge).
// Safety invariants:
//   · owner_creation_forbidden — the owner role is never provisionable; the attempt
//     is audited (risk high) and refused. Owner accounts also cannot be suspended or
//     password-reset from any door (owner_suspend_forbidden).
//   · every write emits an event + requestAudit INSIDE the withUser transaction.
//   · expected UNIQUE violations ride the SAVEPOINT rethrow pattern
//     (teacher.classroom:139-150 precedent) → friendly 409, never a raw 500.
//   · uniform lifecycle gate on every door (P2-1 posture). All preHandlers async.
// Multipart note: @fastify/multipart is mounted on the ROOT instance from inside
// register() (payments.upi content-parser precedent), guarded by a process-wide
// symbol shared with files.store (the loader loads files.store first, so its 5MB
// limit lands; people.admin's attempt becomes a no-op). The CSV import door is
// JSON-first ({csv: string} — the frontend reads the file client-side); multipart
// is the convenience lane.
import { randomBytes } from 'node:crypto';
import multipart from '@fastify/multipart';
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js';
import { hashPassword } from '../../auth.js';

const ID = 'people.admin';
// cross-plugin mount guard (files.store shares it): exactly one @fastify/multipart
// registration per Fastify instance, no matter the loader's directory order.
const MULTIPART_MOUNTED = Symbol.for('schoolos.multipart.mounted');

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, q } = kernel;

  const ADMIN = ['owner', 'itadmin'];                                 // identity authority
  const ROSTER = ['owner', 'principal', 'coordinator', 'admissions']; // roster authority
  const lifecycleGate = makeLifecycleGate(q, ID);
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  if (!app[MULTIPART_MOUNTED]) {
    app.register(multipart, {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 }, // CSV import cap: 2MB ≫ 500 rows
      attachFieldsToBody: false,
    });
    app[MULTIPART_MOUNTED] = true;
  }

  // Provisionable roles: ROLES minus 'owner' (owner creation is structurally forbidden).
  const ROLES_NO_OWNER = ['principal', 'coordinator', 'finance', 'admissions', 'transport', 'facilities', 'technician', 'teacher', 'itadmin', 'parent', 'student'];

  // Temporary password generator — readable, CSPRNG (Math.random is not a secret
  // source; ops.visitors precedent). Shown once in the door response, never stored
  // in plaintext (only its scrypt hash rides app.users.password_hash).
  const tempPassword = () => {
    const words = ['sun', 'rain', 'leaf', 'star', 'moon', 'river', 'tiger', 'lotus', 'mango', 'monsoon'];
    const w1 = words[randomBytes(1)[0] % words.length];
    const w2 = words[randomBytes(1)[0] % words.length];
    return `${w1}-${w2}-${randomBytes(2).toString('hex')}`; // e.g. rain-lotus-3f9a
  };
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ── provision a user (owner, itadmin) — owner role is forbidden ─────────────
  app.post(`/plugins/${ID}/users`, { preHandler: [require(...ADMIN), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const phone = typeof b.phone === 'string' && b.phone.trim() ? b.phone.trim() : null;
    const role = typeof b.role === 'string' ? b.role.trim() : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(reply, 'Enter a valid email address');
    if (!name) return bad(reply, 'Enter the person\'s full name');
    if (role === 'owner') {
      // audit-before-send contract: the ledger row must COMMIT before the refusal is
      // transmitted. Returning bad() from inside the withUser transaction made
      // Fastify send at the first await — the 403 raced (and beat) the audit's own
      // COMMIT, so an immediate ledger read could not see the refusal row.
      await withUser(req.user.tenant_id, req.user.role, async (c) => {
        await requestAudit(c, req.user.tenant_id, ID, {
          actor: req.user.name, action: 'Attempted owner provisioning (refused)', recordType: 'User', recordRef: email,
          reason: 'role requested: owner', policyRef: 'Platform §2.4 (identity & access)', risk: 'high',
          outcome: 'refused — the owner role cannot be provisioned through any door' });
      });
      return bad(reply, 'The owner role cannot be created here — ownership is provisioned at tenant bootstrap', 403);
    }
    if (!ROLES_NO_OWNER.includes(role)) return bad(reply, `Role must be one of: ${ROLES_NO_OWNER.join(', ')}`);
    const suppliedPassword = typeof b.password === 'string' && b.password.length >= 8 ? b.password : null;
    if (b.password != null && !suppliedPassword) return bad(reply, 'Password must be at least 8 characters (or leave it out to generate a temporary one)');
    const temp = suppliedPassword ? null : tempPassword();
    const password = suppliedPassword ?? temp;

    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // validation BEFORE write: a bad student reference must not leave a
      // half-provisioned account behind
      if (role === 'parent' && b.studentId) {
        if (!UUID_RE.test(String(b.studentId))) return bad(reply, 'That student reference is not a valid id');
        const st = (await c.query(`SELECT id FROM app.students WHERE id=$1 AND tenant_id=$2`, [b.studentId, req.user.tenant_id])).rows[0];
        if (!st) return bad(reply, 'That student is not in your school\'s roster', 404);
      }
      // UNIQUE(tenant_id, email) → SAVEPOINT → friendly 409 (teacher.classroom precedent)
      let row;
      await c.query('SAVEPOINT provision_user');
      try {
        row = (await c.query(
          `INSERT INTO app.users (tenant_id, email, name, role, password_hash, phone, force_change)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, email, name, role, active, created_at`,
          [req.user.tenant_id, email, name.slice(0, 120), role, hashPassword(password), phone, temp ? true : false])).rows[0];
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT provision_user');
        if (e.code === '23505') return bad(reply, 'An account with this email already exists at your school', 409);
        throw e;
      }
      await c.query('RELEASE SAVEPOINT provision_user');
      let linkedStudentId = null;
      if (role === 'parent' && b.studentId) {
        await c.query(
          `INSERT INTO family.child_link (tenant_id, user_id, student_id, relation, is_primary)
           VALUES ($1,$2,$3,'guardian',true) ON CONFLICT (tenant_id, user_id, student_id) DO NOTHING`,
          [req.user.tenant_id, row.id, b.studentId]);
        linkedStudentId = b.studentId;
      }
      await emitEvent(c, req.user.tenant_id,
        { type: 'people', label: `Account created: ${row.name} (${row.role})`, ref: row.id },
        'people.user.created', { userId: row.id, email: row.email, role: row.role, tempPasswordIssued: !!temp, linkedStudentId });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'User provisioned', recordType: 'User', recordRef: row.id,
        reason: `${row.role} · ${row.email}`, policyRef: 'Platform §2.4 (identity & access)', risk: 'medium',
        outcome: `${row.role} account created${temp ? ' · temporary password issued (force_change stamped)' : ' · password set by caller'}${linkedStudentId ? ' · linked to child' : ''}` });
      return {
        ok: true, user: { id: row.id, email: row.email, name: row.name, role: row.role, active: row.active, forceChange: temp ? true : false, createdAt: row.created_at },
        // tempPassword: the adminApi client alias for the same once-only secret
        ...(temp ? { temporaryPassword: temp, tempPassword: temp, note: 'This temporary password is shown once — it is not stored in plaintext; the user must change it at first sign-in.' } : {}),
      };
    });
  });

  // ── list accounts (owner, itadmin) — the Accounts pane's roster of users ────
  app.get(`/plugins/${ID}/users`, { preHandler: [require(...ADMIN), lifecycleGate] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT id, email, name, role, phone, active, force_change, created_at
         FROM app.users WHERE tenant_id=$1 ORDER BY role, name LIMIT 500`, [req.user.tenant_id])).rows;
      return { users: rows.map((u) => ({
        id: u.id, email: u.email, name: u.name, role: u.role, phone: u.phone,
        active: u.active, forceChange: u.force_change, createdAt: u.created_at,
      })) };
    });
  });

  // ── suspend / activate (owner, itadmin) — owner accounts are protected ──────
  const setSuspended = (suspend) =>
    app.post(`/plugins/${ID}/users/:id/${suspend ? 'suspend' : 'activate'}`,
      { preHandler: [require(...ADMIN), uuidParams('id'), lifecycleGate] },
      async (req, reply) => {
        return withUser(req.user.tenant_id, req.user.role, async (c) => {
          const u = (await c.query(`SELECT id, email, name, role, active FROM app.users WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
            [req.params.id, req.user.tenant_id])).rows[0];
          if (!u) return bad(reply, 'We couldn\'t find that account', 404);
          if (u.role === 'owner') return bad(reply, 'The owner account cannot be suspended or reactivated here', 403);
          if (u.active === !suspend) return bad(reply, suspend ? 'That account is already suspended' : 'That account is already active', 409);
          const upd = await c.query(`UPDATE app.users SET active=$2 WHERE id=$1 RETURNING active`, [u.id, !suspend]);
          await emitEvent(c, req.user.tenant_id,
            { type: 'people', label: `Account ${suspend ? 'suspended' : 'reactivated'}: ${u.name} (${u.role})`, ref: u.id, severity: suspend ? 'warn' : 'info' },
            suspend ? 'people.user.suspended' : 'people.user.activated', { userId: u.id, email: u.email, role: u.role });
          await requestAudit(c, req.user.tenant_id, ID, {
            actor: req.user.name, action: suspend ? 'User suspended' : 'User reactivated', recordType: 'User', recordRef: u.id,
            reason: `${u.role} · ${u.email}`, policyRef: 'Platform §2.4 (identity & access)', risk: 'medium',
            outcome: suspend ? 'active=false — the next request fails with "account disabled"' : 'active=true — sign-in restored' });
          return { ok: true, userId: u.id, active: upd.rows[0].active, ...(suspend ? { note: 'Their sessions die at the next request — the kernel re-reads the account row on every call.' } : {}) };
        });
      });
  setSuspended(true);
  setSuspended(false);

  // ── reset password (owner, itadmin) — temp password shown once ──────────────
  app.post(`/plugins/${ID}/users/:id/reset-password`, { preHandler: [require(...ADMIN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const u = (await c.query(`SELECT id, email, name, role, active FROM app.users WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!u) return bad(reply, 'We couldn\'t find that account', 404);
      if (u.role === 'owner') return bad(reply, 'The owner password cannot be reset here', 403);
      const temp = tempPassword();
      await c.query(`UPDATE app.users SET password_hash=$2, force_change=true WHERE id=$1`, [u.id, hashPassword(temp)]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'people', label: `Password reset: ${u.name} (${u.role}) — temporary password issued`, ref: u.id, severity: 'warn' },
        'people.user.password_reset', { userId: u.id, email: u.email, forceChange: true });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Password reset (temporary issued)', recordType: 'User', recordRef: u.id,
        reason: `${u.role} · ${u.email}`, policyRef: 'Platform §2.4 (identity & access)', risk: 'medium',
        outcome: 'scrypt hash replaced · force_change=true · temp password shown once to the admin' });
      return { ok: true, userId: u.id, temporaryPassword: temp, note: 'This temporary password is shown once — the user must change it at next sign-in.' };
    });
  });

  // ── transfer a student (owner, principal, coordinator) — THE section-change flow ──
  app.post(`/plugins/${ID}/students/:id/transfer`, { preHandler: [require('owner', 'principal', 'coordinator'), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const toGrade = typeof (b.to_grade ?? b.toGrade) === 'string' ? String(b.to_grade ?? b.toGrade).trim() : '';
    const toSection = typeof (b.to_section ?? b.toSection) === 'string' ? String(b.to_section ?? b.toSection).trim().toUpperCase() : '';
    const reason = b.reason ? String(b.reason).slice(0, 300) : null;
    if (!toGrade || !toSection) return bad(reply, 'Choose the new class (grade) and section');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const s = (await c.query(`SELECT id, name, grade, section, status FROM app.students WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!s) return bad(reply, 'We couldn\'t find that student', 404);
      if (s.status !== 'active') return bad(reply, `Only an active student can be transferred (this student is ${s.status})`, 409);
      if (s.grade === toGrade && s.section === toSection) return bad(reply, 'The student is already in that class and section', 409);
      // THE invariant: history row and the flip commit together — a transfer without
      // its history row cannot exist (single transaction, both writes or neither).
      await c.query(
        `INSERT INTO app.enrollment_history (tenant_id, student_id, from_grade, from_section, to_grade, to_section, changed_by, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.user.tenant_id, s.id, s.grade, s.section, toGrade, toSection, req.user.id, reason]);
      const upd = await c.query(`UPDATE app.students SET grade=$2, section=$3 WHERE id=$1 RETURNING grade, section`, [s.id, toGrade, toSection]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'people', label: `Student transferred: ${s.name} — ${s.grade}-${s.section} → ${toGrade}-${toSection}`, ref: s.id },
        'people.student.transferred', { studentId: s.id, fromGrade: s.grade, fromSection: s.section, toGrade, toSection, reason });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Student transferred', recordType: 'Student', recordRef: s.id,
        reason: reason ?? 'class/section change', policyRef: 'Platform §2.4 · enrollment-history invariant', risk: 'medium',
        outcome: `${s.grade}-${s.section} → ${upd.rows[0].grade}-${upd.rows[0].section} · history row written` });
      return { ok: true, userId: s.id,
        // two response shapes on purpose: the door contract (userId/from/to) AND the
        // adminApi client shape (student/history) so the screen renders the move 1:1
        student: { id: s.id, name: s.name, grade: upd.rows[0].grade, section: upd.rows[0].section },
        history: { fromGrade: s.grade, fromSection: s.section, toGrade: upd.rows[0].grade, toSection: upd.rows[0].section, reason },
        from: { grade: s.grade, section: s.section }, to: { grade: upd.rows[0].grade, section: upd.rows[0].section } };
    });
  });

  // ── enrollment history (owner, principal, coordinator) — year-on-year reports ──
  app.get(`/plugins/${ID}/students/:id/history`, { preHandler: [require('owner', 'principal', 'coordinator'), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const st = (await c.query(`SELECT id, name, admission_no, grade, section FROM app.students WHERE id=$1 AND tenant_id=$2`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!st) return bad(reply, 'We couldn\'t find that student', 404);
      const rows = (await c.query(
        `SELECT h.id, h.from_grade, h.from_section, h.to_grade, h.to_section, h.reason, h.created_at,
                u.name AS changed_by_name
         FROM app.enrollment_history h LEFT JOIN app.users u ON u.id = h.changed_by
         WHERE h.student_id=$1 ORDER BY h.created_at ASC LIMIT 200`, [st.id])).rows;
      return { student: st, history: rows.map((r) => ({
        id: r.id, fromGrade: r.from_grade, fromSection: r.from_section, toGrade: r.to_grade, toSection: r.to_section,
        reason: r.reason, createdAt: r.created_at, changedBy: r.changed_by_name ?? null,
      })) };
    });
  });

  // ── L3-2.1 student lifecycle doors ──────────────────────────────────────────
  // PATCH /students/:id     — core-field edit (identity/status/provenance immutable)
  // POST /students/:id/withdraw — active → transferred · bus unassigned · everything kept
  // POST /students/:id/promote  — grade+1 with the transfer door's history invariant
  // All three follow the transfer door's law: row lock, active-guard, single-tx
  // writes, event + audit inside the withUser transaction.

  const CORE_FIELD_CAPS = { name: 120, guardian_name: 120, guardian_phone: 24, bus_route: 40 };
  const cleanField = (v, cap) => {
    if (v === undefined) return undefined;
    if (v === null || (typeof v === 'string' && v.trim() === '')) return null; // empty clears
    if (typeof v !== 'string') return { __err: 'must be text' };
    const t = v.trim();
    if (t.length > cap) return { __err: `keep it under ${cap} characters` };
    return t;
  };

  // ── edit core fields (owner, principal, coordinator) ────────────────────────
  app.patch(`/plugins/${ID}/students/:id`, { preHandler: [require('owner', 'principal', 'coordinator'), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    // Identity anchors never ride the edit door: admission_no is the UNIQUE key and
    // provenance lives in source/source_ref; status changes go through the lifecycle
    // doors; grade/section MUST go through transfer so the enrollment-history
    // invariant ("history row and the flip commit together") cannot be bypassed.
    for (const k of ['admission_no', 'status', 'source', 'source_ref', 'grade', 'section']) {
      if (b[k] !== undefined) {
        if (k === 'grade' || k === 'section')
          return bad(reply, 'Class and section changes go through the transfer door so the move is written to the student\'s history', 409);
        return bad(reply, `${k === 'admission_no' ? 'The admission number' : k === 'status' ? 'The status' : 'Provenance'} can\'t be edited here`, 409);
      }
    }
    const patch = {};
    for (const [k, cap] of Object.entries(CORE_FIELD_CAPS)) {
      if (b[k] === undefined) continue;
      const v = cleanField(b[k], cap);
      if (v && v.__err) return bad(reply, `${k === 'name' ? 'The name' : k === 'bus_route' ? 'The bus route' : 'The field'} ${v.__err}`);
      patch[k] = v;
    }
    if (!Object.keys(patch).length) return bad(reply, 'Nothing to update — send at least one field (name, guardian_name, guardian_phone, bus_route)');
    if (patch.name === null) return bad(reply, 'The name can\'t be empty');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const s = (await c.query(`SELECT id, name, grade, section, guardian_name, guardian_phone, bus_route, status FROM app.students WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!s) return bad(reply, 'We couldn\'t find that student', 404);
      if (s.status !== 'active') return bad(reply, `Only an active student's record can be edited (this student is ${s.status})`, 409);
      const sets = [], vals = [s.id];
      const changes = [];
      for (const [k, v] of Object.entries(patch)) {
        vals.push(v);
        sets.push(`${k}=$${vals.length}`);
        const before = s[k];
        if ((before ?? null) !== (v ?? null)) changes.push(v === null ? `${k} cleared` : `${k} updated`);
      }
      if (!changes.length) return { ok: true, student: s, changed: [] };
      const upd = (await c.query(`UPDATE app.students SET ${sets.join(', ')} WHERE id=$1 RETURNING id, name, grade, section, guardian_name, guardian_phone, bus_route`, vals)).rows[0];
      await emitEvent(c, req.user.tenant_id,
        { type: 'people', label: `Student record updated: ${s.name} — ${changes.join(', ')}`, ref: s.id },
        'people.student.updated', { studentId: s.id, fields: changes });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Student record updated', recordType: 'Student', recordRef: s.id,
        reason: 'core-field edit', policyRef: 'Platform §2.4 · student lifecycle (L3-2.1)', risk: 'low',
        outcome: `${changes.join(', ')} · ${s.grade}-${s.section} · history invariant untouched` });
      return { ok: true, student: upd, changed: changes };
    });
  });

  // ── withdraw / transfer-out (owner, principal) ──────────────────────────────
  // Semantics (L3-2.1): status → 'transferred' (the existing CHECK value — a
  // dedicated 'withdrawn' state needs an L1 CHECK migration and is recorded as the
  // follow-up), bus unassigned, attendance/fees/guardian links deliberately KEPT
  // (history must survive the exit; DPDP export flows read them later).
  app.post(`/plugins/${ID}/students/:id/withdraw`, { preHandler: [require('owner', 'principal'), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (reason.length < 2) return bad(reply, 'Tell us why the student is leaving (this goes on the record)');
    if (reason.length > 300) return bad(reply, 'Keep the reason under 300 characters');
    let effectiveDate = new Date().toISOString().slice(0, 10);
    if (b.effective_date != null) {
      const d = String(b.effective_date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) return bad(reply, 'The effective date must look like 2026-04-01');
      effectiveDate = d;
    }
    const lastSchool = b.last_school ? String(b.last_school).trim().slice(0, 120) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const s = (await c.query(`SELECT id, name, grade, section, status, bus_route FROM app.students WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!s) return bad(reply, 'We couldn\'t find that student', 404);
      if (s.status !== 'active') return bad(reply, `Only an active student can be withdrawn (this student is ${s.status})`, 409);
      await c.query(`UPDATE app.students SET status='transferred', bus_route=NULL WHERE id=$1`, [s.id]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'people', label: `Student withdrawn: ${s.name} (${s.grade}-${s.section}) — ${reason.slice(0, 80)}`, ref: s.id },
        'people.student.withdrawn', {
          studentId: s.id, reason, effectiveDate, lastSchool,
          statusSet: 'transferred', busUnassigned: true, attendanceKept: true, feesKept: true, parentLinksPreserved: true,
          academicYear: null, ayNote: 'next-AY scoping lands with the academic-year entity (L1)',
        });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Student withdrawn', recordType: 'Student', recordRef: s.id,
        reason, policyRef: 'Platform §2.4 · student lifecycle (L3-2.1)', risk: 'high',
        outcome: `status → transferred (effective ${effectiveDate}) · bus unassigned · attendance/fees/guardian links kept${lastSchool ? ` · last school: ${lastSchool}` : ''}` });
      return { ok: true, student: { id: s.id, name: s.name, status: 'transferred', busRoute: null },
        effectiveDate, note: 'Attendance, fee records and parent links are kept. The bus seat is released. This can\'t be undone from here — re-admission creates a fresh record.' };
    });
  });

  // ── promote to the next class (owner, principal, coordinator) ───────────────
  // Grade+1 with the transfer door's invariant: the enrollment_history row and the
  // flip commit together. Numeric grades advance 1..11; LKG→UKG→1; grade 12 is
  // terminal in the IN ladder (mark alumni via the office flow instead).
  const nextGrade = (g) => {
    if (/^\d+$/.test(g)) { const n = Number(g); if (n < 1 || n > 12) return null; return n === 12 ? { terminal: true } : { to: String(n + 1) }; }
    if (g === 'LKG') return { to: 'UKG' };
    if (g === 'UKG') return { to: '1' };
    return null; // free-text grade — caller must supply to_grade explicitly
  };
  app.post(`/plugins/${ID}/students/:id/promote`, { preHandler: [require('owner', 'principal', 'coordinator'), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const toSection = typeof (b.to_section ?? b.toSection) === 'string' ? String(b.to_section ?? b.toSection).trim().toUpperCase() : null;
    if (toSection != null && (toSection.length === 0 || toSection.length > 16)) return bad(reply, 'Keep the section under 16 characters');
    let toGrade = typeof (b.to_grade ?? b.toGrade) === 'string' ? String(b.to_grade ?? b.toGrade).trim() : null;
    if (toGrade != null && (toGrade.length === 0 || toGrade.length > 16)) return bad(reply, 'Keep the class under 16 characters');
    const reason = b.reason ? String(b.reason).slice(0, 300) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const s = (await c.query(`SELECT id, name, grade, section, status FROM app.students WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!s) return bad(reply, 'We couldn\'t find that student', 404);
      if (s.status !== 'active') return bad(reply, `Only an active student can be promoted (this student is ${s.status})`, 409);
      if (!toGrade) {
        const nxt = nextGrade(s.grade);
        if (!nxt) return bad(reply, `"${s.grade}" can\'t be advanced automatically — tell us the next class (to_grade)`);
        if (nxt.terminal) return bad(reply, 'Grade 12 is the final class — use the office flow to mark the student as alumni instead', 409);
        toGrade = nxt.to;
      } else if (/^\d+$/.test(toGrade) && s.grade !== toGrade) {
        const cur = Number(s.grade);
        if (Number.isFinite(cur) && Number(toGrade) > cur + 1)
          return bad(reply, `A student moves up one class at a time (${s.grade} → ${cur + 1}); use the transfer door for a different class`, 409);
      }
      const toSec = toSection ?? s.section;
      if (s.grade === toGrade && s.section === toSec) return bad(reply, 'The student is already in that class and section', 409);
      // THE invariant (same as transfer): history row and the flip commit together.
      await c.query(
        `INSERT INTO app.enrollment_history (tenant_id, student_id, from_grade, from_section, to_grade, to_section, changed_by, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.user.tenant_id, s.id, s.grade, s.section, toGrade, toSec, req.user.id, reason ?? 'promoted to the next class']);
      const upd = await c.query(`UPDATE app.students SET grade=$2, section=$3 WHERE id=$1 RETURNING grade, section`, [s.id, toGrade, toSec]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'people', label: `Student promoted: ${s.name} — ${s.grade}-${s.section} → ${toGrade}-${toSec}`, ref: s.id },
        'people.student.promoted', {
          studentId: s.id, fromGrade: s.grade, fromSection: s.section, toGrade, toSection: toSec, reason,
          academicYear: null, ayNote: 'next-AY scoping lands with the academic-year entity (L1)',
        });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Student promoted', recordType: 'Student', recordRef: s.id,
        reason: reason ?? 'end-of-year promotion', policyRef: 'Platform §2.4 · student lifecycle (L3-2.1)', risk: 'medium',
        outcome: `${s.grade}-${s.section} → ${upd.rows[0].grade}-${upd.rows[0].section} · history row written` });
      return { ok: true, student: { id: s.id, name: s.name, grade: upd.rows[0].grade, section: upd.rows[0].section },
        from: { grade: s.grade, section: s.section }, to: { grade: upd.rows[0].grade, section: upd.rows[0].section } };
    });
  });

  // ── CSV roster import (owner, principal, coordinator, admissions) ───────────
  // JSON-first contract: {csv: "name,grade,section,..."} — the frontend reads the
  // file client-side. Multipart file upload is accepted as the convenience lane.
  // Robustness contract: one bad row NEVER aborts the file — per-row SAVEPOINT,
  // failures land in failed[] with a human line number; valid rows commit; in-file
  // duplicate admission numbers dedupe (first occurrence wins); DB duplicates
  // (UNIQUE tenant+admission_no → 23505) fail that row only; a 500-row cap and a
  // 2MB cap keep the desk honest. ONE audit row + ONE import event for the batch.
  const parseCsv = (text) => {
    const rows = [];
    let cur = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { cur.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        cur.push(field); field = '';
        if (cur.some((f) => f.trim() !== '')) rows.push(cur);
        cur = [];
      } else field += ch;
    }
    cur.push(field);
    if (cur.some((f) => f.trim() !== '')) rows.push(cur);
    return rows;
  };

  const importStudents = async (req, reply, csvText) => {
    const MAX_ROWS = 500;
    if (!csvText || !String(csvText).trim()) return bad(reply, 'Paste or upload the CSV first (header row: name,grade,section,admission_no,guardian_name,guardian_phone)');
    if (String(csvText).length > 2 * 1024 * 1024) return bad(reply, 'That file is too large — the limit is 2MB per import', 413);
    const table = parseCsv(String(csvText));
    if (!table.length) return bad(reply, 'That CSV is empty');
    const header = table[0].map((h) => h.trim().toLowerCase());
    const idx = (n) => header.indexOf(n);
    for (const n of ['name', 'grade', 'section']) if (idx(n) === -1) return bad(reply, `The header row must have a ${n} column (found: ${header.join(', ') || 'none'})`);
    const iName = idx('name'), iGrade = idx('grade'), iSection = idx('section');
    const iAdm = idx('admission_no'), iGn = idx('guardian_name'), iGp = idx('guardian_phone');

    const dataRows = table.slice(1);
    if (dataRows.length > MAX_ROWS) return bad(reply, `That file has ${dataRows.length} rows — the limit is ${MAX_ROWS} per import. Split it and try again.`, 413);

    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const seenAdm = new Set();   // in-file dedupe: first occurrence wins
      const ok = []; const failed = [];
      for (let r = 0; r < dataRows.length; r++) {
        const rowNo = r + 2; // human line number (header is line 1)
        const cells = dataRows[r];
        const name = (cells[iName] ?? '').trim();
        const grade = (cells[iGrade] ?? '').trim();
        const section = (cells[iSection] ?? '').trim().toUpperCase();
        const admissionNo = iAdm === -1 ? '' : (cells[iAdm] ?? '').trim();
        const guardianName = iGn === -1 ? null : ((cells[iGn] ?? '').trim() || null);
        const guardianPhone = iGp === -1 ? null : ((cells[iGp] ?? '').trim() || null);
        try {
          if (!name) throw new Error('name is required');
          if (name.length > 120) throw new Error('name is too long (max 120 characters)');
          if (!grade) throw new Error('grade is required');
          if (!section) throw new Error('section is required');
          if (admissionNo && seenAdm.has(admissionNo)) throw new Error(`duplicate admission number in file (${admissionNo}) — keeping the first`);
          if (admissionNo) seenAdm.add(admissionNo);
          await c.query('SAVEPOINT import_row');
          try {
            const ins = await c.query(
              `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone, source, source_ref)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'import',$8) RETURNING id, admission_no`,
              [req.user.tenant_id,
               admissionNo || `IMP-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`,
               name, grade, section, guardianName, guardianPhone, `csv row ${rowNo}`]);
            await c.query('RELEASE SAVEPOINT import_row');
            ok.push({ row: rowNo, studentId: ins.rows[0].id, name, grade, section, admissionNo: ins.rows[0].admission_no });
          } catch (e) {
            await c.query('ROLLBACK TO SAVEPOINT import_row');
            if (e.code === '23505') throw new Error('this admission number is already on the roster');
            throw new Error('the row could not be saved — check the values');
          }
        } catch (e) {
          failed.push({ row: rowNo, name: name || null, error: e.message });
        }
      }
      await emitEvent(c, req.user.tenant_id,
        { type: 'people', label: `Roster import: ${ok.length} admitted, ${failed.length} needs attention`, severity: failed.length ? 'warn' : 'info' },
        'people.import.completed', { imported: ok.length, failed: failed.length, total: dataRows.length, by: req.user.email });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Student roster imported', recordType: 'Student', recordRef: null,
        reason: 'CSV import', policyRef: 'Platform §2.4 · import per-row isolation', risk: 'medium',
        outcome: `${ok.length} inserted · ${failed.length} failed (kept in the report, file not aborted) · ${dataRows.length} rows offered` });
      // contract: {ok: rows, failed: rows, imported/failedCount/total counts} — the
      // ImportReport client type reads ok/failed/total; ok:true is not echoed (the
      // array IS the ok field), failures always carry the human line number.
      return { ok, failed, total: dataRows.length, imported: ok.length, failedCount: failed.length };
    });
  };

  app.post(`/plugins/${ID}/import/students`, { preHandler: [require(...ROSTER), lifecycleGate] }, async (req, reply) => {
    // Multipart lane: a file field named `csv`. JSON lane: {csv}. The smaller 2MB
    // CSV cap is enforced in code (the shared parser limit is files.store's 5MB).
    if (req.isMultipart?.()) {
      const file = await req.file();
      if (!file) return bad(reply, 'Attach the CSV file (field name: csv)');
      const buf = await file.toBuffer();
      return importStudents(req, reply, buf.toString('utf8'));
    }
    const csv = req.body?.csv;
    return importStudents(req, reply, typeof csv === 'string' ? csv : null);
  });
}
