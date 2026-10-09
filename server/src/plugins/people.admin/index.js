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
import { ROLES } from '../../auth.js';
import { toE164 } from '../_shared/phone.js';
import { parseDob, parseGender } from '../_shared/enrolment.js';
import { istToday } from '../../ist.js';

const ID = 'people.admin';
// cross-plugin mount guard (files.store shares it): exactly one @fastify/multipart
// registration per Fastify instance, no matter the loader's directory order.
const MULTIPART_MOUNTED = Symbol.for('schoolos.multipart.mounted');

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, sysq } = kernel;

  const ADMIN = ['owner', 'itadmin'];                                 // identity authority
  const ROSTER = ['owner', 'principal', 'coordinator', 'admissions', 'itadmin']; // roster authority
  const lifecycleGate = makeLifecycleGate(sysq, ID);
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  if (!app[MULTIPART_MOUNTED]) {
    app.register(multipart, {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 }, // CSV import cap: 2MB ≫ 500 rows
      attachFieldsToBody: false,
    });
    app[MULTIPART_MOUNTED] = true;
  }

  // Provisionable roles: ROLES minus 'owner' (owner creation is structurally forbidden).
  /* RBAC-2: this list used to be a hand-copied duplicate of `auth.js` ROLES, and it had silently fallen
     behind — the counsellor existed in five gate lists and a shipped screen but could not be appointed here
     ("Role must be one of: principal, coordinator, …"). Derived now, so the only place a role is declared is
     `auth.js` (plus migration 079's CHECK, which is what makes the two fail loudly instead of drifting). */
  const ROLES_NO_OWNER = ROLES.filter((r) => r !== 'owner');

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

  // ── provision a user (owner, itadmin; principal may mint ONLY the itadmin) ──
  // Owner role is forbidden everywhere. The people chain is owner → principal →
  // itadmin → everyone else: the owner appoints the principal (owner-only, below),
  // and the principal appoints the IT admin so a school is never blocked on the
  // owner for its one delegation step. A principal reaching for any other role is
  // refused — the IT admin adds everyone else. Suspend/activate/reset/list stay
  // ADMIN-only (identity authority does not follow the principal).
  app.post(`/plugins/${ID}/users`, { preHandler: [require(...ADMIN, 'principal'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    /* Review round 20, P2: this stored whatever was typed. Both OTP doors now compare the NORMALISED E.164
       form, so a phone saved as "+91 98450 00101" (the format the seed itself uses) could never be matched:
       the sign-in would answer the uniform "sent" and deliver nothing, forever, with no error anywhere. Store
       the same shape the doors look up. `toE164` also rejects what cannot be a phone at all, which is better
       done here — at the desk, with the operator present — than silently at sign-in time. */
    let phone = null;
    if (typeof b.phone === 'string' && b.phone.trim()) {
      phone = toE164(b.phone);
      if (!phone) return bad(reply, 'That phone number is not usable — enter it with the country code, e.g. +91 98450 00101');
    }
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
    if (role === 'principal' && req.user.role !== 'owner') {
      // Mirror the owner-refusal contract: the ledger row must COMMIT before the 403 is sent.
      await withUser(req.user.tenant_id, req.user.role, async (c) => {
        await requestAudit(c, req.user.tenant_id, ID, {
          actor: req.user.name, action: 'Attempted principal provisioning (refused)', recordType: 'User', recordRef: email,
          reason: `role requested: principal by ${req.user.role}`, policyRef: 'Platform §2.4 (identity & access)', risk: 'high',
          outcome: 'refused — only the school owner may create a principal account' });
      });
      return bad(reply, 'Only the school owner can create a principal account', 403);
    }
    if (req.user.role === 'principal' && role !== 'itadmin') {
      // Mirror the owner/principal refusal contracts: a delegation probe is a
      // privilege-escalation attempt, so the ledger row must COMMIT before the
      // 403 is transmitted — the trail exists even for refused calls.
      await withUser(req.user.tenant_id, req.user.role, async (c) => {
        await requestAudit(c, req.user.tenant_id, ID, {
          actor: req.user.name, action: 'Attempted provisioning beyond delegation (refused)', recordType: 'User', recordRef: email,
          reason: `role requested: ${role} by principal`, policyRef: 'Platform §2.4 (identity & access)', risk: 'medium',
          outcome: 'refused — principals may only create the IT admin account' });
      });
      return bad(reply, 'Principals can only create the IT admin account — the IT admin adds everyone else', 403);
    }
    if (!ROLES_NO_OWNER.includes(role)) return bad(reply, `Role must be one of: ${ROLES_NO_OWNER.join(', ')}`);
    /* FIX-11 (orphan student accounts): a pupil portal account without a roster binding is a login the
       student plane cannot pin to a child (G-1) — results/homework land nowhere and the account looks
       broken. The roster "Give a pupil a portal account" flow always supplies studentId; the bare
       provision form hides the student role for exactly this reason. Refuse the unbound case here so a
       direct-API caller cannot mint what the UI deliberately prevents. Parent stays optional (phone-only
       parents match structurally at admission). */
    if (role === 'student' && !b.studentId) return bad(reply, 'Pick the pupil this portal account belongs to — student accounts are created from the roster so results and homework land on the right child', 400);
    /* G-2 door-side mirror (FIX-11 precedent for pupils): a parent account with
       neither a phone nor a linked child can never see anything — no child_link,
       no phone-match. The console already refuses this; the door must too, so a
       direct-API caller cannot mint unreachable accounts and a future bulk-parent
       lane inherits the guard instead of mass-producing them. */
    if (role === 'parent' && !phone && !b.studentId) return bad(reply, 'Give the parent a phone number or pick their child — without one of these the account will never see a child', 400);
    const suppliedPassword = typeof b.password === 'string' && b.password.length >= 8 ? b.password : null;
    if (b.password != null && !suppliedPassword) return bad(reply, 'Password must be at least 8 characters (or leave it out to generate a temporary one)');
    const temp = suppliedPassword ? null : tempPassword();
    const password = suppliedPassword ?? temp;

return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // validation BEFORE write: a bad student reference must not leave a
      // half-provisioned account behind
      if ((role === 'parent' || role === 'student') && b.studentId) {
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
        if (e.code === '23505') {
          // one phone per tenant (008): a phone clash is NOT an email clash — say which one
          if (String(e.constraint ?? '').includes('phone')) {
            return bad(reply, 'That phone number is already used by another account at your school', 409);
          }
          return bad(reply, 'An account with this email already exists at your school', 409);
        }
        throw e;
      }
      await c.query('RELEASE SAVEPOINT provision_user');
      let linkedStudentId = null;
      if (role === 'parent' && b.studentId) {
        await c.query(
          `INSERT INTO family.child_link (tenant_id, user_id, student_id, relation, is_primary)
           VALUES ($1,$2,$3,'guardian',true) ON CONFLICT (tenant_id, user_id, student_id) DO NOTHING`,
          [req.user.tenant_id, row.id, b.studentId]);
        /* M1: mirror the binding into the canonical guardian contact table so the child has a
           reachable guardian for absence/visitor/audience resolution — not just a linked account.
           Only when the parent has a phone (app.guardians.phone is NOT NULL) and not already present. */
        if (phone) {
          const existing = (await c.query(
            `SELECT 1 FROM app.guardians WHERE tenant_id=$1 AND student_id=$2 AND phone=$3 LIMIT 1`,
            [req.user.tenant_id, b.studentId, phone])).rows[0];
          if (!existing) {
            await c.query(
              `INSERT INTO app.guardians (tenant_id, student_id, name, phone, relation, is_primary)
               VALUES ($1,$2,$3,$4,'guardian',true)`,
              [req.user.tenant_id, b.studentId, name.slice(0, 120), phone]);
          }
        }
        linkedStudentId = b.studentId;
      }
      /* G-1 · the pupil's OWN portal account. A parent links to a child through family.child_link;
         a pupil links to the roster row through `app.students.user_id` — the structural binding
         migration 132 added and student.world is supposed to resolve identity from. Creating the
         account without it left the pupil with a login the student plane could not pin to a child,
         which is why the whole portal looked unreachable even once the role could be issued.
         An account already bound elsewhere (the unique index says one row per user) is refused
         rather than moved silently: two children must not inherit one another's results. */
      if (role === 'student' && b.studentId) {
        const bound = (await c.query(
          `UPDATE app.students SET user_id=$3 WHERE tenant_id=$1 AND id=$2 AND (user_id IS NULL OR user_id=$3)
           RETURNING id, name, admission_no`,
          [req.user.tenant_id, b.studentId, row.id])).rows[0];
        if (!bound) {
          const other = (await c.query(`SELECT id FROM app.students WHERE tenant_id=$1 AND user_id=$2`, [req.user.tenant_id, row.id])).rows[0];
          if (other) return bad(reply, 'That pupil already has a portal account — suspend it first if you mean to replace it', 409);
        }
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
        // ONE name for the once-only secret (P2-11) — `temporaryPassword`, as the onboarding door
        // and every server test already read. It used to be emitted twice (`temporaryPassword` and a
        // `tempPassword` alias), which is how the SPA and the server disagreed in the first place.
        ...(temp ? { temporaryPassword: temp, note: 'This temporary password is shown once — it is not stored in plaintext; the user must change it at first sign-in.' } : {}),
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

  /* ── suspend / activate (owner, itadmin) — owner accounts are protected ──────
     The two paths are REGISTERED, not composed. They used to come from one factory whose path was
     `.../${suspend ? 'suspend' : 'activate'}`, which meant neither door could be found by the route
     scanner — so the permission matrix under-reported them, no drift guard could check a client's role
     list against them, and "is this door reachable?" had to be answered by reading the helper. The
     bodies stay shared below; only the registration is explicit. */
  const suspendActivate = (suspend) => async (req, reply) => {
        return withUser(req.user.tenant_id, req.user.role, async (c) => {
          const u = (await c.query(`SELECT id, email, name, role, active FROM app.users WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
            [req.params.id, req.user.tenant_id])).rows[0];
          if (!u) return bad(reply, 'We couldn\'t find that account', 404);
          if (u.role === 'owner') return bad(reply, 'The owner account cannot be suspended or reactivated here', 403);
          // OPP-SEC-3: the principal is the school's day-to-day authority; only the owner may stand it
          // down, never a peer IT admin (mirrors the owner-protection rule).
          if (u.role === 'principal' && req.user.role !== 'owner')
            return bad(reply, 'The principal account can only be changed by the school owner', 403);
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
  };

  app.post(`/plugins/${ID}/users/:id/suspend`,
    { preHandler: [require(...ADMIN), uuidParams('id'), lifecycleGate] }, suspendActivate(true));
  app.post(`/plugins/${ID}/users/:id/activate`,
    { preHandler: [require(...ADMIN), uuidParams('id'), lifecycleGate] }, suspendActivate(false));

  // ── reset password (owner, itadmin) — temp password shown once ──────────────
  app.post(`/plugins/${ID}/users/:id/reset-password`, { preHandler: [require(...ADMIN), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const u = (await c.query(`SELECT id, email, name, role, active FROM app.users WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!u) return bad(reply, 'We couldn\'t find that account', 404);
      if (u.role === 'owner') return bad(reply, 'The owner password cannot be reset here', 403);
      // OPP-SEC-3: only the owner may reset the principal's password.
      if (u.role === 'principal' && req.user.role !== 'owner')
        return bad(reply, 'The principal password can only be reset by the school owner', 403);
      const temp = tempPassword();
      await c.query(`UPDATE app.users SET password_hash=$2, force_change=true WHERE id=$1`, [u.id, hashPassword(temp)]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'people', label: `Password reset: ${u.name} (${u.role}) — temporary password issued`, ref: u.id, severity: 'warn' },
        'people.user.password_reset', { userId: u.id, email: u.email, forceChange: true });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Password reset (temporary issued)', recordType: 'User', recordRef: u.id,
        reason: `${u.role} · ${u.email}`, policyRef: 'Platform §2.4 (identity & access)', risk: 'medium',
        outcome: 'scrypt hash replaced · force_change=true · temp password shown once to the admin' });
      /* F3: this door used to answer `temporaryPassword` while the SPA read `tempPassword`, so
         "Reset password" minted a secret the office never saw — an unrecoverable lockout. A second
         name was then added to the create door as a deliberate alias. P2-11 removes the alias: one
         door answers one name, the client reads exactly that name, and a mismatch is a type error
         instead of a silently empty box. `temporaryPassword` is the name the server's own tests,
         the onboarding door and every audit of this door already read. */
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
    if (!Object.keys(patch).length) return bad(reply, 'Nothing to update — send at least one field (name, guardian_name, guardian_phone, bus_route, dob, gender)');
    if (patch.name === null) return bad(reply, 'The name can\'t be empty');
    /* P2-7: date of birth and gender are record FACTS about the child, not class placement, so they
       ride this door. Both are parsed by the same functions the enrolment door and the CSV import
       use — three lanes, one rule — and both may be cleared by sending an empty string. */
    if (b.dob !== undefined) {
      const dob = parseDob(b.dob);
      if (!dob.ok) return bad(reply, dob.error);
      patch.dob = dob.value;
    }
    if (b.gender !== undefined) {
      const gender = parseGender(b.gender);
      if (!gender.ok) return bad(reply, gender.error);
      patch.gender = gender.value;
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const s = (await c.query(`SELECT id, name, grade, section, guardian_name, guardian_phone, bus_route, dob, gender, status FROM app.students WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
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
      const upd = (await c.query(`UPDATE app.students SET ${sets.join(', ')} WHERE id=$1 RETURNING id, name, grade, section, guardian_name, guardian_phone, bus_route, dob, gender`, vals)).rows[0];
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
    // DAT-7: default the effective date in IST, not UTC (a 02:00 IST withdrawal is not "yesterday").
    let effectiveDate = istToday();
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
      // A8: carry the ACTIVE academic year on the promotion event (it used to be null with an "AY lands
      // later" note; the academic-year entity shipped).
      const ayRow = (await c.query(`SELECT id FROM app.academic_years WHERE tenant_id=$1 AND is_current ORDER BY created_at DESC LIMIT 1`, [req.user.tenant_id])).rows[0] ?? null;
      await emitEvent(c, req.user.tenant_id,
        { type: 'people', label: `Student promoted: ${s.name} — ${s.grade}-${s.section} → ${toGrade}-${toSec}`, ref: s.id },
        'people.student.promoted', {
          studentId: s.id, fromGrade: s.grade, fromSection: s.section, toGrade, toSection: toSec, reason,
          academicYear: ayRow?.id ?? null,
        });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Student promoted', recordType: 'Student', recordRef: s.id,
        reason: reason ?? 'end-of-year promotion', policyRef: 'Platform §2.4 · student lifecycle (L3-2.1)', risk: 'medium',
        outcome: `${s.grade}-${s.section} → ${upd.rows[0].grade}-${upd.rows[0].section} · history row written` });
      return { ok: true, student: { id: s.id, name: s.name, grade: upd.rows[0].grade, section: upd.rows[0].section },
        from: { grade: s.grade, section: s.section }, to: { grade: upd.rows[0].grade, section: upd.rows[0].section } };
    });
  });

  // A8/F6 · bulk end-of-year promotion: advance every active student in a grade to the next one, with the
  // SAME history invariant as the single door (a history row per student, committed with the flip). The
  // active academic year rides each event. Owner / principal / coordinator.
  app.post(`/plugins/${ID}/students/promote/bulk`, { preHandler: [require('owner', 'principal', 'coordinator'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const fromGrade = typeof b.fromGrade === 'string' ? b.fromGrade.trim() : '';
    if (!fromGrade) return bad(reply, 'fromGrade is required');
    let toGrade = typeof b.toGrade === 'string' ? b.toGrade.trim() : null;
    const toSection = typeof b.toSection === 'string' && b.toSection.trim() ? b.toSection.trim().toUpperCase() : null;
    if (toSection != null && toSection.length > 16) return bad(reply, 'Keep the section under 16 characters');
    const reason = b.reason ? String(b.reason).slice(0, 300) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!toGrade) {
        const nxt = nextGrade(fromGrade);
        if (!nxt) return bad(reply, `"${fromGrade}" can't be advanced automatically — supply toGrade`);
        if (nxt.terminal) return bad(reply, 'Grade 12 is the final class — use the office flow to mark students as alumni instead', 409);
        toGrade = nxt.to;
      }
      const ay = (await c.query(`SELECT id, name FROM app.academic_years WHERE tenant_id=$1 AND is_current ORDER BY created_at DESC LIMIT 1`, [req.user.tenant_id])).rows[0] ?? null;
      const students = (await c.query(
        `SELECT id, name, grade, section FROM app.students
          WHERE tenant_id=$1 AND status='active' AND grade=$2 ORDER BY admission_no FOR UPDATE`,
        [req.user.tenant_id, fromGrade])).rows;
      let promoted = 0;
      for (const s of students) {
        const sec = toSection ?? s.section;
        await c.query(
          `INSERT INTO app.enrollment_history (tenant_id, student_id, from_grade, from_section, to_grade, to_section, changed_by, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [req.user.tenant_id, s.id, s.grade, s.section, toGrade, sec, req.user.id, reason ?? 'bulk end-of-year promotion']);
        await c.query(`UPDATE app.students SET grade=$2, section=$3 WHERE id=$1`, [s.id, toGrade, sec]);
        await emitEvent(c, req.user.tenant_id,
          { type: 'people', label: `Student promoted: ${s.name} — ${s.grade}-${s.section} → ${toGrade}-${sec}`, ref: s.id },
          'people.student.promoted', { studentId: s.id, fromGrade: s.grade, fromSection: s.section, toGrade, toSection: sec, reason, academicYear: ay?.id ?? null });
        promoted++;
      }
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Bulk promotion', recordType: 'Student', recordRef: fromGrade,
        reason: reason ?? 'end-of-year promotion', policyRef: 'Platform §2.4 · student lifecycle (L3-2.1)', risk: 'high',
        outcome: `${promoted} student(s) ${fromGrade} → ${toGrade}${ay ? ` · AY ${ay.name}` : ''} · history rows written` });
      return { ok: true, promoted, fromGrade, toGrade, academicYearId: ay?.id ?? null };
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
    /* P2-7: the same two enrolment columns the manual form collects. Optional headers, optional
       values — a spreadsheet that has no dob column still imports exactly as before — but when the
       column IS there and holds something, the row is checked rather than stored blindly. */
    const iDob = idx('dob') === -1 ? idx('date_of_birth') : idx('dob');
    const iGender = idx('gender');

    const dataRows = table.slice(1);
    if (dataRows.length > MAX_ROWS) return bad(reply, `That file has ${dataRows.length} rows — the limit is ${MAX_ROWS} per import. Split it and try again.`, 413);

    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const seenAdm = new Set();   // in-file dedupe: first occurrence wins
      /* P2-6: validate the class the same way POST /students now does. This lane validated the
         NAME and nothing else, so "Bad Grade Row / Grade 77 / Z" came back in `ok[]` while a
         nameless row came back in `failed[]` — the per-row report was good enough to name a
         missing name and blind to a class that does not exist. `Grade 77` was accepted into a
         school with Grades 1-8 and is invisible to every screen that reads the school's own
         structure. Read the structure directly rather than importing routes.js, which imports
         this plugin's loader. Empty structure means the school has not set up classes yet, and
         is therefore not a reason to reject anything. */
      const cfgRow = (await c.query(`SELECT config FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0];
      const rawSections = cfgRow?.config?.setup?.sections;
      const schoolClasses = Array.isArray(rawSections)
        ? rawSections
            .filter((x) => x && typeof x.grade === 'string' && x.grade.trim())
            .map((x) => ({ grade: x.grade.trim(), sections: Array.isArray(x.sections) ? x.sections.map((s) => String(s).trim().toUpperCase()).filter(Boolean) : [] }))
        : [];
      const classMap = new Map(schoolClasses.map((x) => [x.grade, x.sections]));
      const ok = []; const failed = [];
      for (let r = 0; r < dataRows.length; r++) {
        const rowNo = r + 2; // human line number (header is line 1)
        const cells = dataRows[r];
        const name = (cells[iName] ?? '').trim();
        const grade = (cells[iGrade] ?? '').trim();
        const section = (cells[iSection] ?? '').trim().toUpperCase();
        const admissionNo = iAdm === -1 ? '' : (cells[iAdm] ?? '').trim();
        const guardianName = iGn === -1 ? null : ((cells[iGn] ?? '').trim() || null);
        // PLGX: the CSV lane stored the raw guardian phone, so a value like "98450 00101" (no country
        // code) landed undeliverable while the create door normalizes through toE164. Normalize here too.
        const rawPhone = iGp === -1 ? '' : String(cells[iGp] ?? '').trim();
        const guardianPhone = rawPhone ? toE164(rawPhone) : null;
        const rawDob = iDob === -1 ? '' : String(cells[iDob] ?? '').trim();
        const rawGender = iGender === -1 ? '' : String(cells[iGender] ?? '').trim();
        try {
          if (rawPhone && !guardianPhone) throw new Error('guardian phone is not usable — enter it with the country code, e.g. +91 98450 00101');
          // P2-7: parse with the SHARED parsers, so a spreadsheet dob is held to exactly the rule
          // the manual form is, and a bad one fails this ROW with a reason the office can act on
          // rather than 500-ing the batch on a date CHECK.
          const dob = parseDob(rawDob);
          if (!dob.ok) throw new Error(`date of birth: ${dob.error}`);
          const gender = parseGender(rawGender);
          if (!gender.ok) throw new Error(gender.error);
          if (!name) throw new Error('name is required');
          if (name.length > 120) throw new Error('name is too long (max 120 characters)');
          if (!grade) throw new Error('grade is required');
          if (grade.length > 16) throw new Error('grade is too long (max 16 characters)');
          if (!section) throw new Error('section is required');
          // S0 fix D4: the promote/transfer doors cap class+section at 16 — the
          // import lane must not sneak a longer value past that contract.
          if (section.length > 16) throw new Error('section is too long (max 16 characters)');
          if (classMap.size) {
            if (!classMap.has(grade)) {
              throw new Error(`"${grade}" is not one of this school's classes — expected one of: ${[...classMap.keys()].join(', ')}`);
            }
            const secs = classMap.get(grade);
            if (secs.length && !secs.includes(section)) {
              throw new Error(`section "${section}" is not one of ${grade}'s sections — expected one of: ${secs.join(', ')}`);
            }
          }
          if (admissionNo && seenAdm.has(admissionNo)) throw new Error(`duplicate admission number in file (${admissionNo}) — keeping the first`);
          if (admissionNo) seenAdm.add(admissionNo);
          await c.query('SAVEPOINT import_row');
          try {
            const ins = await c.query(
              `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone, dob, gender, source, source_ref)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'import',$10) RETURNING id, admission_no`,
              [req.user.tenant_id,
               admissionNo || `IMP-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`,
               name, grade, section, guardianName, guardianPhone, dob.value, gender.value, `csv row ${rowNo}`]);
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
      const file = await req.file({ limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
      if (!file) return bad(reply, 'Attach the CSV file (field name: csv)');
      const buf = await file.toBuffer();
      return importStudents(req, reply, buf.toString('utf8'));
    }
    const csv = req.body?.csv;
    return importStudents(req, reply, typeof csv === 'string' ? csv : null);
  });
}
