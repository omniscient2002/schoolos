// Domain routes — every request runs as the RLS-constrained app role with the
// caller's tenant + role in session. Mutations write the audit ledger.
import { randomUUID } from 'node:crypto';
import { linkLineage, requestAudit } from './audit.js';
import { ensurePluginCatalog } from './plugin-catalog.js';
import { checkEventBudget } from './governance.js';
import { q } from './db.js';

const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

export function registerRoutes(app, { withUser, auditLog, emitEvent, ROLES }) {

  const require = (...roles) => async (req, reply) => {
    await app.authenticate(req, reply);
    if (reply.sent) return;
    let allowed = roles.includes(req.user.role);
    if (allowed) {
      // a matched DENY refuses even a door the base role permits (deny wins)
      await applyCustomMask(req, reply);
      if (reply.sent) return;
    } else {
      // custom → builtin resolution: an explicit ALLOW grant lifts the role refusal
      allowed = await applyCustomMask(req, reply);
      if (reply.sent) return; // a DENY already answered 403
    }
    if (!allowed) {
      return reply.code(403).send({ error: `Your role (${req.user.role}) doesn't allow this action` });
    }
  };

  const me = async (req, reply) => {
    await app.authenticate(req, reply);
    if (reply.sent) return;
    await applyCustomMask(req, reply); // read doors honour a deny too
  };

  // ============ me / demo users ============
  app.get('/me', { preHandler: me }, async (req) => {
    const u = req.user;
    // School identity rides every session (frontend header + title). The
    // tenant's own row is the truth; a fresh self-signup school shows ITS name.
    const t = await q(`SELECT name, slug FROM app.tenants WHERE id=$1`, [u.tenant_id]);
    // D-37(d): mfa_enrolled_at is the only MFA fact /me exposes (the Settings
    // UI renders "Turn off two-step" from it); secrets stay kernel-only.
    return { id: u.id, name: u.name, role: u.role, email: u.email, tenantId: u.tenant_id,
      mfa_enrolled_at: u.mfa_enrolled_at ?? null,
      school: { name: t.rows[0]?.name ?? null, slug: t.rows[0]?.slug ?? null } };
  });

  // ============ custom roles (L3-4.2) ============
  // A custom role = {key, label, base_role, permissions:{allow:[],deny:[]}} stored in
  // app.roles; a user carries role_key (nullable). RESOLUTION ORDER (custom → builtin):
  //   1. the base role decides as usual (require() semantics unchanged),
  //   2. a matched DENY pattern refuses (403) even when the base role allowed,
  //   3. a matched ALLOW pattern GRANTS even when the base role lacked the door.
  // Enforcement lives in require()/me() below — every kernel door checks the mask;
  // plugin doors keep base-role gating this run (requireRole is app.js-owned —
  // journal note for S0).
  // SCHEMA GATE: the store needs L1's migration (app.roles + users.role_key). Until it
  // lands, the doors answer 503 with the exact reason — never a silent no-op.
  let rolesSchemaReady = null;
  const rolesAvailable = async () => {
    if (rolesSchemaReady === null) {
      const r = await q(`SELECT to_regclass('app.roles') IS NOT NULL AS ok,
                                EXISTS (SELECT 1 FROM information_schema.columns
                                        WHERE table_schema='app' AND table_name='users' AND column_name='role_key') AS col`);
      rolesSchemaReady = !!(r.rows[0]?.ok && r.rows[0]?.col);
    }
    return rolesSchemaReady;
  };

  // every registered route is recorded here so a mask pattern is validated against
  // REAL doors — a typo can never silently grant (or refuse) nothing.
  const registeredRoutes = new Set();
  app.addHook('onRoute', (route) => {
    if (!route?.url) return;
    for (const m of (route.method || 'GET').split(',').map((x) => x.trim())) {
      if (m === 'HEAD' || m === 'OPTIONS') continue;
      registeredRoutes.add(`${m} ${route.url}`);
    }
  });

  const MASK_RE = /^(GET|POST|PATCH|PUT|DELETE|\*)\s+\/[^\s]{0,118}$/;
  const patternMatches = (pattern, method, url) => {
    // pattern: "METHOD /path" with an optional trailing '*' (prefix match)
    const sp = pattern.indexOf(' ');
    if (sp < 0) return false;
    const pm = pattern.slice(0, sp);
    const pp = pattern.slice(sp + 1);
    if (pm !== '*' && pm !== method) return false;
    if (pp.endsWith('*')) return url.startsWith(pp.slice(0, -1));
    return url === pp || url.startsWith(pp + '/') || url.startsWith(pp + '?');
  };
  const maskDecides = (mask, method, url) => {
    // returns 'deny' | 'allow' | null — deny wins over allow (predictable order)
    for (const p of mask?.deny ?? []) if (patternMatches(p, method, url)) return 'deny';
    for (const p of mask?.allow ?? []) if (patternMatches(p, method, url)) return 'allow';
    return null;
  };
  const validateMask = (perms) => {
    if (perms == null) return { allow: [], deny: [] };
    if (typeof perms !== 'object' || Array.isArray(perms)) return null;
    const out = { allow: [], deny: [] };
    for (const kind of ['allow', 'deny']) {
      const list = perms[kind];
      if (list === undefined) continue;
      if (!Array.isArray(list) || list.length > 100) return null;
      for (const p of list) {
        if (typeof p !== 'string' || !MASK_RE.test(p)) return null;
        // must hit at least one registered door (same matcher as enforcement)
        const [pm, pp] = [p.slice(0, p.indexOf(' ')), p.slice(p.indexOf(' ') + 1)];
        const hit = [...registeredRoutes].some((r) => {
          const [rm, ru] = [r.slice(0, r.indexOf(' ')), r.slice(r.indexOf(' ') + 1)];
          if (pm !== '*' && pm !== rm) return false;
          if (pp.endsWith('*')) return ru.startsWith(pp.slice(0, -1));
          return ru === pp || ru.startsWith(pp + '/');
        });
        if (!hit) return null;
      }
      out[kind] = list;
    }
    return out;
  };
  // role-key binding cache: userId → {key, at}. authenticate() (app.js) selects a
  // fixed column list that doesn't include role_key, so the binding is resolved here —
  // self-sufficient, never touching kernel files. TTL 30s bounds cross-request staleness
  // of an assignment; the mask itself is always read FRESH (PATCH/DELETE invalidate).
  const bindingCache = new Map(); // userId → {key: string|null, at: ms}
  const BINDING_TTL_MS = 30_000;
  const roleKeyFor = async (c, user) => {
    const hit = bindingCache.get(user.id);
    if (hit && Date.now() - hit.at < BINDING_TTL_MS) return hit.key;
    const r = await c.query(`SELECT role_key FROM app.users WHERE id=$1 AND tenant_id=$2`, [user.id, user.tenant_id]);
    const key = r.rows[0]?.role_key ?? null;
    if (bindingCache.size > 1000) bindingCache.clear();
    bindingCache.set(user.id, { key, at: Date.now() });
    return key;
  };
  const maskForUser = async (c, user, roleKey) => {
    if (!roleKey) return null;
    const r = await c.query(`SELECT permissions FROM app.roles WHERE tenant_id=$1 AND key=$2`, [user.tenant_id, roleKey]);
    return r.rows[0]?.permissions ?? null;
  };
  // called at the END of require()/me(): applies the caller's custom mask, if any.
  // Deny → 403 (reply sent); allow grants → returns true so the role refusal lifts.
  // Silent when the store is absent or the caller carries no binding.
  const applyCustomMask = async (req, reply) => {
    if (!(await rolesAvailable())) return false;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const roleKey = await roleKeyFor(c, req.user);
      if (!roleKey) return false;
      const mask = await maskForUser(c, req.user, roleKey);
      const decision = mask ? maskDecides(mask, req.method, req.url.split('?')[0]) : null;
      if (decision === 'deny') {
        reply.code(403).send({ error: 'Your school\'s custom role for you refuses this action' });
        return true;
      }
      return decision === 'allow';
    });
  };

  const ROLES_ADMIN = ['owner', 'itadmin'];
  app.get('/roles', { preHandler: require(...ROLES_ADMIN) }, async (req, reply) => {
    if (!(await rolesAvailable())) return reply.code(503).send({ error: 'Custom roles need the roles store (migration 061 by L1) — not on this database yet' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT r.key, r.label, r.base_role, r.permissions, r.created_at,
                (SELECT count(*)::int FROM app.users u WHERE u.role_key = r.key) AS members
         FROM app.roles r WHERE r.tenant_id=$1 AND r.key NOT LIKE 'retired-%' ORDER BY r.created_at`, [req.user.tenant_id])).rows;
      return { roles: rows, builtin: ROLES };
    });
  });

  app.post('/roles', { preHandler: require(...ROLES_ADMIN) }, async (req, reply) => {
    if (!(await rolesAvailable())) return reply.code(503).send({ error: 'Custom roles need the roles store (migration 061 by L1) — not on this database yet' });
    const b = req.body ?? {};
    const key = typeof b.key === 'string' ? b.key.trim().toLowerCase() : '';
    if (!/^[a-z0-9_-]{2,40}$/.test(key)) return bad(reply, 'The role key must be 2-40 characters: lowercase letters, digits, - or _');
    const label = typeof b.label === 'string' ? b.label.trim() : '';
    if (label.length < 2 || label.length > 60) return bad(reply, 'Give the role a name of 2-60 characters');
    if (!ROLES.includes(b.base_role)) return bad(reply, `base_role must be one of: ${ROLES.join(', ')}`);
    const mask = validateMask(b.permissions);
    if (mask === null) return bad(reply, 'permissions must be {allow:[], deny:[]} — entries like "GET /fees" or "POST /students/*" (max 100, each must match a real screen)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      try {
        const r = (await c.query(
          `INSERT INTO app.roles (tenant_id, key, label, base_role, permissions) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,
          [req.user.tenant_id, key, label, b.base_role, JSON.stringify(mask)])).rows[0];
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Custom role created', recordType: 'Role', recordRef: key, reason: `base ${b.base_role}`, policyRef: 'Custom roles (L3-4.2) · custom → builtin resolution', risk: 'high',
          outcome: `key=${key} · base=${b.base_role} · allow ${mask.allow.length} · deny ${mask.deny.length}` });
        return { role: r };
      } catch (e) {
        if (e.code === '23505') return bad(reply, `A role keyed "${key}" already exists`, 409);
        throw e;
      }
    });
  });

  app.patch('/roles/:key', { preHandler: require(...ROLES_ADMIN) }, async (req, reply) => {
    if (!(await rolesAvailable())) return reply.code(503).send({ error: 'Custom roles need the roles store (migration 061 by L1) — not on this database yet' });
    const b = req.body ?? {};
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const cur = (await c.query(`SELECT * FROM app.roles WHERE tenant_id=$1 AND key=$2 FOR UPDATE`, [req.user.tenant_id, req.params.key])).rows[0];
      if (!cur) return bad(reply, 'We couldn\'t find that role', 404);
      let mask = cur.permissions;
      if (b.permissions !== undefined) {
        mask = validateMask(b.permissions);
        if (mask === null) return bad(reply, 'permissions must be {allow:[], deny:[]} — entries like "GET /fees" (max 100, each must match a real screen)');
      }
      const label = b.label != null ? String(b.label).trim() : cur.label;
      if (label.length < 2 || label.length > 60) return bad(reply, 'The name must be 2-60 characters');
      const base = b.base_role != null ? b.base_role : cur.base_role;
      if (!ROLES.includes(base)) return bad(reply, `base_role must be one of: ${ROLES.join(', ')}`);
      const r = (await c.query(
        `UPDATE app.roles SET label=$3, base_role=$4, permissions=$5::jsonb, updated_at=now() WHERE tenant_id=$1 AND key=$2 RETURNING *`,
        [req.user.tenant_id, req.params.key, label, base, JSON.stringify(mask)])).rows[0];
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Custom role updated', recordType: 'Role', recordRef: req.params.key, policyRef: 'Custom roles (L3-4.2)', risk: 'high',
        outcome: `base=${base} · allow ${mask.allow?.length ?? 0} · deny ${mask.deny?.length ?? 0} · cache invalidated` });
      return { role: r };
    });
  });

  app.delete('/roles/:key', { preHandler: require(...ROLES_ADMIN) }, async (req, reply) => {
    if (!(await rolesAvailable())) return reply.code(503).send({ error: 'Custom roles need the roles store (migration 061 by L1) — not on this database yet' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const members = (await c.query(`SELECT count(*)::int AS n FROM app.users WHERE role_key=$2 AND tenant_id=$1`, [req.user.tenant_id, req.params.key])).rows[0].n;
      if (members > 0) return bad(reply, `${members} account(s) still carry this role — reassign them first`, 409);
      // D-35 grant law: the app role NEVER hard-DELETEs in schema app — an empty
      // role is RETIRED in place (key namespaced out of the live namespace, mask
      // emptied) so the audit ledger's recordRef stays resolvable forever. The
      // SECURITY DEFINER hard-delete can come later via an L1 migration if the
      // fleet ever needs true row removal.
      const cur = (await c.query(`SELECT key, label FROM app.roles WHERE tenant_id=$1 AND key=$2 FOR UPDATE`, [req.user.tenant_id, req.params.key])).rows[0];
      if (!cur) return bad(reply, 'We couldn\'t find that role', 404);
      if (cur.key.startsWith('retired-')) return bad(reply, 'That role is already retired', 409);
      const retiredKey = `retired-${Date.now().toString(36)}-${cur.key.slice(0, 30)}`;
      const r = (await c.query(
        `UPDATE app.roles SET key=$3, label=$4, permissions='{"allow":[],"deny":[]}'::jsonb, updated_at=now() WHERE tenant_id=$1 AND key=$2 RETURNING key`,
        [req.user.tenant_id, req.params.key, retiredKey, `[Retired] ${cur.label}`.slice(0, 60)])).rows[0];
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Custom role retired', recordType: 'Role', recordRef: req.params.key, policyRef: 'Custom roles (L3-4.2) · D-35 grant law (no app-role DELETE)', risk: 'medium', outcome: `empty role retired in place → ${retiredKey} (audit trail resolvable)` });
      return { ok: true, retired: true, key: retiredKey };
    });
  });

  // assignment: a user carries ONE role_key (their custom overlay). Re-assigning
  // replaces it; assigning with {roleKey: null} clears back to the pure builtin.
  app.post('/roles/:key/assign', { preHandler: require(...ROLES_ADMIN) }, async (req, reply) => {
    if (!(await rolesAvailable())) return reply.code(503).send({ error: 'Custom roles need the roles store (migration 061 by L1) — not on this database yet' });
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
    if (!userIds.length || userIds.length > 200) return bad(reply, 'Send userIds (1-200 accounts to carry this role)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const role = (await c.query(`SELECT key, base_role FROM app.roles WHERE tenant_id=$1 AND key=$2`, [req.user.tenant_id, req.params.key])).rows[0];
      if (!role) return bad(reply, 'We couldn\'t find that role', 404);
      // structurally protected targets: the acting owner never re-roles themselves,
      // and owner accounts are never re-roled (matches people.admin's owner pin)
      if (userIds.includes(req.user.id)) return bad(reply, 'You can\'t change your own role from here — ask another owner or IT admin', 403);
      const owners = (await c.query(`SELECT id FROM app.users WHERE tenant_id=$1 AND role='owner' AND id = ANY($2::uuid[])`, [req.user.tenant_id, userIds])).rows;
      if (owners.length) return bad(reply, 'Owner accounts can\'t carry a custom role overlay', 409);
      const r = await c.query(`UPDATE app.users SET role_key=$3 WHERE tenant_id=$1 AND id = ANY($2::uuid[]) RETURNING id`, [req.user.tenant_id, userIds, req.params.key]);
      for (const id of userIds) bindingCache.delete(id);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Custom role assigned', recordType: 'Role', recordRef: req.params.key, policyRef: 'Custom roles (L3-4.2)', risk: 'high', outcome: `${r.rowCount} account(s) now carry "${req.params.key}" (base ${role.base_role} + mask)` });
      return { ok: true, assigned: r.rowCount };
    });
  });

  app.post('/roles/:key/unassign', { preHandler: require(...ROLES_ADMIN) }, async (req, reply) => {
    if (!(await rolesAvailable())) return reply.code(503).send({ error: 'Custom roles need the roles store (migration 061 by L1) — not on this database yet' });
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
    if (!userIds.length) return bad(reply, 'Send userIds to clear');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`UPDATE app.users SET role_key=NULL WHERE tenant_id=$1 AND id = ANY($2::uuid[]) AND role_key=$3`, [req.user.tenant_id, userIds, req.params.key]);
      for (const id of userIds) bindingCache.delete(id);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Custom role cleared', recordType: 'Role', recordRef: req.params.key, policyRef: 'Custom roles (L3-4.2)', risk: 'medium', outcome: `${r.rowCount} account(s) back to their builtin role` });
      return { ok: true, cleared: r.rowCount };
    });
  });

  // ============ students & people ============
  const STAFF_ROSTER = new Set(['principal','owner','itadmin','finance','coordinator','admissions','transport','facilities','technician']);
  app.get('/students', { preHandler: me }, async (req, reply) => {
    // T105a (§7.3 P1-2): the whole-school roster is a STAFF surface. There is no
    // structural user↔student binding for the student role (name-equality is the
    // P1-4 anti-pattern), so the student role is refused here — their plane is
    // student.world's own doors.
    if (req.user.role === 'student') return bad(reply, 'Your student desk shows your own records — the school roster is staff-only', 403);
    const { grade, section, search, limit = 100, offset = 0 } = req.query;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // RTR-001 RT-005: parents are scoped to their own child via the guardian record;
      // teachers/technicians get the roster WITHOUT guardian contact details.
      const showPhones = STAFF_ROSTER.has(req.user.role);
      // RT-7cyc8 P3: parents are structurally scoped via family.child_link
      // (rename-proof) — NOT guardian_name matching. $6 is the caller's user id
      // for parents; staff pass NULL and the LEFT JOIN keeps every student.
      const r = await c.query(
        `SELECT s.id, s.admission_no, s.name, s.grade, s.section, s.guardian_name,
                ${showPhones ? 's.guardian_phone' : 'NULL::text AS guardian_phone'},
                s.bus_route, s.status, s.source, s.source_ref
         FROM app.students s
         LEFT JOIN family.child_link cl ON cl.student_id = s.id AND cl.user_id = $6::uuid
         WHERE s.status='active' AND ($1::text IS NULL OR s.grade=$1) AND ($2::text IS NULL OR s.section=$2)
           AND ($3::text IS NULL OR s.name ILIKE '%'||$3||'%' OR s.admission_no ILIKE '%'||$3||'%')
           AND ($6::uuid IS NULL OR cl.user_id IS NOT NULL)
         ORDER BY s.grade, s.section, s.name LIMIT $4 OFFSET $5`,
        [grade ?? null, section ?? null, search ?? null, Math.min(+limit, 500), +offset,
         req.user.role === 'parent' ? req.user.id : null]);
      for (const row of r.rows) if (!showPhones) delete row.guardian_phone;
      return { students: r.rows };
    });
  });

  app.get('/students/:id', { preHandler: me }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // T105a (P1-2): a student may not open arbitrary student records; without a
      // structural binding there is no id they can authorize, so 404 (existence
      // not revealed).
      if (req.user.role === 'student') return bad(reply, 'not found', 404);
      // RTR-001 RT-005: a parent may only open their own child's record.
      if (req.user.role === 'parent') {
        // RT-7cyc8 P1-9: structural guardian binding (family.child_link), NOT name matching.
        const own = await c.query(`SELECT 1 FROM family.child_link WHERE user_id=$1 AND student_id=$2`, [req.user.id, req.params.id]);
        if (!own.rows[0]) return bad(reply, 'not found', 404);
      }
      const s = await c.query(`SELECT * FROM app.students WHERE id=$1`, [req.params.id]);
      if (!s.rows[0]) return bad(reply, 'not found', 404);
      const student = s.rows[0];
      const [fees, att, route] = await Promise.all([
        c.query(`SELECT id, term, label, amount_cents, paid_cents, status, due_on FROM app.fee_obligations WHERE student_id=$1 ORDER BY created_at`, [req.params.id]),
        c.query(`SELECT school_date, status FROM app.attendance WHERE student_id=$1 ORDER BY school_date DESC LIMIT 60`, [req.params.id]),
        student.bus_route
          ? c.query(`SELECT code, name, vehicle, capacity FROM app.routes WHERE code=$1`, [student.bus_route])
          : Promise.resolve({ rows: [] }),
      ]);
      if (!STAFF_ROSTER.has(req.user.role)) delete student.guardian_phone;
      return { student, fees: fees.rows, attendance: att.rows, route: route.rows[0] ?? null };
    });
  });

  app.post('/students', { preHandler: require('owner','principal','coordinator','admissions') }, async (req, reply) => {
    const b = req.body ?? {};
    for (const f of ['name','grade','section']) if (!b[f]) return bad(reply, `${f} required`);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const code = b.admissionNo ?? `ADM-${Date.now().toString(36)}`;
      const r = await c.query(
        `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone, bus_route, source, source_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.user.tenant_id, code, b.name, b.grade, b.section, b.guardianName ?? null, b.guardianPhone ?? null, b.busRoute ?? null, 'staff', req.user.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Created student', recordType: 'Student', recordRef: code, reason: b.reason ?? 'manual entry', outcome: 'created' });
      await emitEvent(c, req.user.tenant_id, { type: 'people', label: `Student enrolled — ${b.name} (${b.grade}-${b.section})`, ref: code });
      return { student: r.rows[0] };
    });
  });

  // ============ attendance ============
  app.get('/attendance', { preHandler: me }, async (req) => {
    const { date = new Date().toISOString().slice(0,10), grade, section } = req.query;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (req.user.role === 'parent') {
        // RT-7cyc8 P1-9: a guardian reads attendance for their own children only.
        const r = await c.query(
          `SELECT s.id, s.admission_no, s.name, s.grade, s.section, a.status, a.note
           FROM family.child_link cl
           JOIN app.students s ON s.id = cl.student_id AND s.status='active'
           LEFT JOIN app.attendance a ON a.student_id = s.id AND a.school_date = $2::date
           WHERE cl.user_id = $1
           ORDER BY s.grade, s.section, s.name LIMIT 50`, [req.user.id, date]);
        return { date, rows: r.rows, scoped: 'own_children' };
      }
      const r = await c.query(
        `SELECT s.id, s.admission_no, s.name, s.grade, s.section, a.status, a.note
         FROM app.students s
         LEFT JOIN app.attendance a ON a.student_id = s.id AND a.school_date = $2::date
         WHERE s.status='active' AND ($1::text IS NULL OR (s.grade=$1 AND ($3::text IS NULL OR s.section=$3)))
         ORDER BY s.grade, s.section, s.name LIMIT 2000`,
        [grade ?? null, date, section ?? null]);
      return { date, rows: r.rows };
    });
  });

  app.post('/attendance/mark', { preHandler: require('owner','principal','coordinator','teacher') }, async (req, reply) => {
    const { date = new Date().toISOString().slice(0,10), marks } = req.body ?? {};
    if (!Array.isArray(marks) || marks.length === 0) return bad(reply, 'marks[] required (studentId, status)');
    const valid = ['present','absent','late','leave'];
    if (marks.some(m => !m.studentId || !valid.includes(m.status))) return bad(reply, 'invalid marks payload');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // T105c (§7.3 P1-7): marking is bound to class ownership. Best-effort
      // class_of_record check first: the only assignment surfaces that exist
      // (app.timetable_slots / app.timetable_substitutions, migration 021) carry
      // teacher_name but NO grade/section binding — verified against the schema —
      // so no class-assignment data can exist for (teacher → this student's class).
      // Per the sprint brief the fallback is therefore: principal+ authority marks
      // the register, and the fallback is stamped into the audit outcome below.
      const sodFallback = !['owner', 'principal'].includes(req.user.role);
      if (sodFallback) {
        return bad(reply, 'Class-assignment records don\'t exist yet, so the register can only be marked by the principal\'s office.', 403);
      }
      const upserts = [];
      for (const m of marks) {
        upserts.push(c.query(
          `INSERT INTO app.attendance (tenant_id, student_id, school_date, status, marked_by)
           VALUES ($1,$2,$3::date,$4,$5)
           ON CONFLICT (tenant_id, student_id, school_date) DO UPDATE SET status=EXCLUDED.status, marked_by=EXCLUDED.marked_by, marked_at=now()`,
          [req.user.tenant_id, m.studentId, date, m.status, req.user.id]));
      }
      await Promise.all(upserts);
      const absents = marks.filter(m => m.status === 'absent');
      // Policy: Attendance §1.1 — guardians informed of absences automatically.
      if (absents.length) {
        await emitEvent(c, req.user.tenant_id,
          { type: 'attendance', label: `attendance.marked — ${marks.length} students on ${date} · ${absents.length} absent`, severity: absents.length > 2 ? 'warn' : 'info' },
          'attendance.absences', { date, absentCount: absents.length });
        const info = await c.query(
          `SELECT s.name, g.phone FROM app.students s JOIN app.guardians g ON g.student_id = s.id
           WHERE s.id = ANY($1::uuid[]) AND g.is_primary`, [absents.map(m => m.studentId)]);
        for (const g of info.rows) {
          await c.query(
            `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, policy_ref, dedup_key)
             VALUES ($1, $2::jsonb, 'whatsapp', 'ABSENCE_NOTICE', $3, 'Attendance §1.1', $4)`,
            [req.user.tenant_id, JSON.stringify([g.phone]), `Absence notice for ${g.name} (${date}) — please confirm.`, randomUUID()]);
        }
      }
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Marked attendance', recordType: 'Attendance', recordRef: `${marks.length} students on ${date}`, reason: 'register marked', policyRef: 'Attendance §1.1', outcome: `${absents.length} absence notices queued · authority: principal+ (T105c: no class-assignment data exists to bind a teacher to a class)` });
      return { ok: true, marked: marks.length, absent: absents.length, noticesQueued: absents.length };
    });
  });

  // ============ academic years (Wave 2 · L1-2.1) ============
  // The school calendar money/academic rows hang off. Exactly ONE year is current
  // per tenant — the partial unique index (055) is the law; the doors below only
  // make the legal path convenient. Every mutation is audited.
  app.get('/academic-years', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT id, name, starts_on, ends_on, is_current, created_at
                               FROM app.academic_years ORDER BY starts_on DESC`);
      return { years: r.rows, currentAcademicYearId: r.rows.find((y) => y.is_current)?.id ?? null };
    });
  });

  app.post('/academic-years', { preHandler: require('owner', 'principal', 'finance') }, async (req, reply) => {
    const b = req.body ?? {};
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const startsOn = typeof b.starts_on === 'string' ? b.starts_on.trim() : '';
    const endsOn = typeof b.ends_on === 'string' ? b.ends_on.trim() : '';
    if (!name || name.length > 80) return bad(reply, 'name is required (≤80 characters)');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn))
      return bad(reply, 'starts_on and ends_on must be YYYY-MM-DD dates');
    if (endsOn <= startsOn) return bad(reply, 'ends_on must be after starts_on');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      try {
        // is_current at birth: clear any other current FIRST (same tx — atomic),
        // the partial unique index still owns the invariant against races.
        if (b.is_current === true)
          await c.query(`UPDATE app.academic_years SET is_current=false, updated_at=now() WHERE tenant_id=$1 AND is_current`, [req.user.tenant_id]);
        const r = await c.query(
          `INSERT INTO app.academic_years (tenant_id, name, starts_on, ends_on, is_current)
           VALUES ($1,$2,$3,$4,$5) RETURNING id, name, starts_on, ends_on, is_current`,
          [req.user.tenant_id, name, startsOn, endsOn, b.is_current === true]);
        const year = r.rows[0];
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Created academic year', recordType: 'AcademicYear', recordRef: year.name, reason: 'academic calendar', outcome: year.is_current ? 'created and set current' : 'created (not current)' });
        return { year };
      } catch (e) {
        if (e.code === '23505')
          return bad(reply, e.constraint === 'academic_years_one_current_idx'
            ? 'another academic year was just set current — reload and retry'
            : 'an academic year with this name already exists', 409);
        throw e;
      }
    });
  });

  app.post('/academic-years/:id/activate', { preHandler: require('owner', 'principal') }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const cur = (await c.query(
        `SELECT id, name, is_current FROM app.academic_years WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!cur) return bad(reply, 'academic year not found', 404);
      if (cur.is_current) return { ok: true, id: cur.id, name: cur.name, is_current: true, already: true };
      await c.query(`UPDATE app.academic_years SET is_current=false, updated_at=now() WHERE tenant_id=$1 AND is_current AND id<>$2`, [req.user.tenant_id, cur.id]);
      await c.query(`UPDATE app.academic_years SET is_current=true, updated_at=now() WHERE id=$1`, [cur.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Activated academic year', recordType: 'AcademicYear', recordRef: cur.name, reason: 'academic calendar', outcome: 'set current — single-current enforced, previous year archived' });
      await emitEvent(c, req.user.tenant_id, { type: 'people', label: `Academic year ${cur.name} is now current`, ref: cur.id });
      return { ok: true, id: cur.id, name: cur.name, is_current: true };
    });
  });

  // ---- fee plan templates & bulk generation (Wave 2 · L1-2.2) ----
  // A template scopes a grade-set × term-list; /generate fans it out to every
  // ACTIVE student in scope in one statement. (tenant, student, term, label) is
  // the idempotency key (057): regeneration skips what exists — paid_cents
  // invariant D-5/D-21: generation never overwrites a row carrying payments.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const validateTerms = (terms) => {
    if (!Array.isArray(terms) || terms.length === 0 || terms.length > 24) return 'terms must be a non-empty list (≤24 entries)';
    for (const t of terms) {
      if (!t || typeof t.term !== 'string' || !t.term.trim() || t.term.trim().length > 40) return 'each term needs a term name (≤40 chars)';
      if (typeof t.label !== 'string' || !t.label.trim() || t.label.trim().length > 80) return 'each term needs a label (≤80 chars)';
      if (!Number.isInteger(t.amount_cents) || t.amount_cents < 0) return 'each term needs an integer amount_cents ≥ 0';
      if (t.due_on !== undefined && (typeof t.due_on !== 'string' || !DATE_RE.test(t.due_on))) return 'due_on must be a YYYY-MM-DD date';
    }
    return null;
  };

  app.get('/fee-plans', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT t.id, t.name, t.grades, t.terms, t.academic_year_id, t.created_at,
                (SELECT count(*)::int FROM app.fee_obligations o
                  WHERE o.source_ref = 'feeplan:' || t.id::text) AS obligations_generated,
                (SELECT max(o.created_at) FROM app.fee_obligations o
                  WHERE o.source_ref = 'feeplan:' || t.id::text) AS last_generated_at
         FROM app.fee_plan_templates t ORDER BY t.created_at DESC`);
      return { feePlans: r.rows };
    });
  });

  app.post('/fee-plans', { preHandler: require('owner', 'principal', 'finance') }, async (req, reply) => {
    const b = req.body ?? {};
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const grades = Array.isArray(b.grades) ? b.grades.filter((g) => typeof g === 'string' && g.trim()) : null;
    if (!name || name.length > 80) return bad(reply, 'name is required (≤80 characters)');
    if (!grades || grades.length === 0 || grades.length > 40) return bad(reply, 'grades must be a non-empty list of grade names');
    const termsErr = validateTerms(b.terms);
    if (termsErr) return bad(reply, termsErr);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      try {
        if (b.academicYearId) {
          const ay = await c.query(`SELECT 1 FROM app.academic_years WHERE id=$1`, [b.academicYearId]);
          if (!ay.rows[0]) return bad(reply, 'academicYearId does not reference this school\'s calendar', 400);
        }
        const r = await c.query(
          `INSERT INTO app.fee_plan_templates (tenant_id, name, grades, terms, academic_year_id)
           VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id, name, grades, terms, academic_year_id`,
          [req.user.tenant_id, name, grades, JSON.stringify(b.terms), b.academicYearId ?? null]);
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Created fee plan template', recordType: 'FeePlan', recordRef: name, reason: `grades: ${grades.join(', ')}`, outcome: `created — ${b.terms.length} terms` });
        return { feePlan: r.rows[0] };
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'a fee plan with this name already exists', 409);
        throw e;
      }
    });
  });

  app.post('/fee-plans/:id/generate', { preHandler: require('owner', 'principal', 'finance') }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const tpl = (await c.query(`SELECT id, name, grades, terms, academic_year_id FROM app.fee_plan_templates WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!tpl) return bad(reply, 'fee plan not found', 404);
      const scope = (await c.query(`SELECT count(*)::int n FROM app.students WHERE status='active' AND grade = ANY($1)`, [tpl.grades])).rows[0].n;
      const ins = await c.query(
        `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, academic_year_id, source_ref)
         SELECT $1, s.id, te->>'term', te->>'label', NULLIF(te->>'due_on','')::date, (te->>'amount_cents')::bigint, $2, 'feeplan:' || $3
         FROM app.students s CROSS JOIN jsonb_array_elements($4::jsonb) te
         WHERE s.status='active' AND s.grade = ANY($5)
         ON CONFLICT (tenant_id, student_id, term, label) DO NOTHING
         RETURNING id`,
        [req.user.tenant_id, tpl.academic_year_id, tpl.id, JSON.stringify(tpl.terms), tpl.grades]);
      const inserted = ins.rowCount;
      const attempted = scope * (Array.isArray(tpl.terms) ? tpl.terms.length : 0);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Generated fee obligations', recordType: 'FeePlan', recordRef: tpl.name, reason: `${scope} active students × ${tpl.terms.length} terms`, outcome: `${inserted} created · ${attempted - inserted} skipped (already exist — payments untouched)` });
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `Fee plan ${tpl.name} generated — ${inserted} obligations created for ${scope} students`, ref: tpl.id });
      return { inserted, skipped: attempted - inserted, students: scope, terms: Array.isArray(tpl.terms) ? tpl.terms.length : 0 };
    });
  });

  app.post('/fees/obligations/:id/void', { preHandler: require('owner') }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const o = (await c.query(`SELECT id, label, amount_cents, paid_cents, status FROM app.fee_obligations WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!o) return bad(reply, 'obligation not found', 404);
      if (o.status === 'void') return { ok: true, id: o.id, status: 'void', already: true };
      if (BigInt(o.paid_cents) > 0n)
        return bad(reply, 'obligation carries payments — refund before voiding (paid_cents can never decrease)', 409);
      const r = await c.query(`UPDATE app.fee_obligations SET status='void' WHERE id=$1 RETURNING id, label, status`, [o.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Voided fee obligation', recordType: 'FeeObligation', recordRef: o.label, reason: 'owner void', outcome: 'void — no payments attached' });
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `Fee obligation ${o.label} voided by owner`, ref: o.id });
      return { ok: true, obligation: r.rows[0] };
    });
  });

  // ============ fees & payments ============
  app.get('/fees/obligations', { preHandler: me }, async (req) => {
    const { studentId, status } = req.query;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // RT-7cyc8 P1-9: guardians are structurally scoped to their own children
      // (family.child_link) — a parent-supplied studentId for another child is refused.
      let scope = studentId ?? null;
      if (req.user.role === 'parent') {
        const kids = await c.query(
          `SELECT cl.student_id FROM family.child_link cl WHERE cl.user_id=$1`, [req.user.id]);
        const mine = kids.rows.map((k) => k.student_id);
        if (scope && !mine.includes(scope)) return { obligations: [], scoped: 'own_children' };
        if (!scope && mine.length) scope = null; // unfiltered → constrain to own children below
        const list = scope ? [scope] : mine;
        const r2 = await c.query(
          `SELECT o.*, s.name AS student_name, s.grade, s.section
           FROM app.fee_obligations o JOIN app.students s ON s.id = o.student_id
           WHERE o.student_id = ANY($1::uuid[]) AND ($2::text IS NULL OR o.status=$2)
           ORDER BY o.due_on NULLS LAST LIMIT 500`, [list, status ?? null]);
        return { obligations: r2.rows, scoped: 'own_children' };
      }
      const r = await c.query(
        `SELECT o.*, s.name AS student_name, s.grade, s.section
         FROM app.fee_obligations o JOIN app.students s ON s.id = o.student_id
         WHERE ($1::uuid IS NULL OR o.student_id=$1) AND ($2::text IS NULL OR o.status=$2)
         ORDER BY o.due_on NULLS LAST LIMIT 500`,
        [scope, status ?? null]);
      return { obligations: r.rows };
    });
  });

  app.post('/fees/payments', { preHandler: require('parent','finance','owner','principal') }, async (req, reply) => {
    const { obligationId, method = 'upi' } = req.body ?? {};
    if (!obligationId) return bad(reply, 'obligationId required');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const o = await c.query(`SELECT * FROM app.fee_obligations WHERE id=$1 AND status <> 'void' FOR UPDATE`, [obligationId]);
      if (!o.rows[0]) return bad(reply, 'obligation not found', 404);
      // T105b (§7.3 P1-3): a parent may start a payment ONLY on their own child's
      // obligation (structural family.child_link binding, rename-proof) — a parent
      // initiating on another family's obligation deadlocks the real one via the
      // one-open-payment constraint. 404 keeps obligation existence private.
      if (req.user.role === 'parent') {
        const own = await c.query(`SELECT 1 FROM family.child_link WHERE user_id=$1 AND student_id=$2`, [req.user.id, o.rows[0].student_id]);
        if (!own.rows[0]) return bad(reply, 'obligation not found', 404);
      }
      const due = BigInt(o.rows[0].amount_cents) - BigInt(o.rows[0].paid_cents);
      if (due <= 0n) return bad(reply, 'obligation already settled', 409);
      const open = await c.query(`SELECT id FROM app.payments WHERE obligation_id=$1 AND status='initiated'`, [obligationId]);
      if (open.rows[0]) return bad(reply, 'a payment for this obligation is already in progress', 409);
      const p = await c.query(
        `INSERT INTO app.payments (tenant_id, student_id, obligation_id, amount_cents, method, status)
         VALUES ($1,$2,$3,$4,$5,'initiated') RETURNING *`,
        [req.user.tenant_id, o.rows[0].student_id, obligationId, due.toString(), method]);
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `payment.initiated — ₹${Number(due)/100} (obligation ${o.rows[0].label})`, ref: p.rows[0].id });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Initiated payment', recordType: 'Payment', recordRef: p.rows[0].id, reason: `settle ${o.rows[0].label}`, outcome: 'initiated' });
      return { payment: p.rows[0] };
    });
  });

  app.post('/fees/payments/:id/confirm', { preHandler: require('finance','owner') }, async (req, reply) => {
    const gatewayRef = req.body?.gatewayRef ?? `GATEWAY-${randomUUID().slice(0,8)}`;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const p = (await c.query(`SELECT * FROM app.payments WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!p) return bad(reply, 'payment not found', 404);
      if (p.status === 'confirmed') return { payment: p, already: true }; // idempotent
      if (p.status !== 'initiated') return bad(reply, `payment in status ${p.status}`, 409);
      // RTR-001 RT-003: confirm with no verifiable gateway reference is a red flag —
      // still allowed for manual reconciliation, but never labeled as webhook-verified.
      const webhookVerified = typeof gatewayRef === 'string' && /^[A-Z0-9-]{10,}$/.test(gatewayRef);
      const confirmed = await c.query(
        `UPDATE app.payments SET status='confirmed', confirmed_at=now(), gateway_ref=$2, receipt_no=$3 WHERE id=$1 RETURNING *`,
        [p.id, gatewayRef, `RCP-${Date.now().toString(36).toUpperCase()}`]);
      // ledger: obligation paid_cents
      const o = await c.query(
        `UPDATE app.fee_obligations SET paid_cents = paid_cents + $2,
           status = CASE WHEN paid_cents + $2 >= amount_cents THEN 'paid' ELSE 'partial' END
         WHERE id=$1 RETURNING *`, [p.obligation_id, p.amount_cents.toString()]);
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `payment.confirmed — ₹${Number(p.amount_cents)/100} · receipt ${confirmed.rows[0].receipt_no}`, ref: p.id });
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `reconciliation verified — ${o.rows[0].label} status ${o.rows[0].status}`, ref: o.rows[0].id });
      await c.query(
        `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, policy_ref)
         VALUES ($1, '[]'::jsonb, 'whatsapp', 'FEE_RECEIPT', $2, 'Fees §4.2')`,
        [req.user.tenant_id, `Receipt ${confirmed.rows[0].receipt_no} — ₹${Number(p.amount_cents)/100} received. Thank you.`]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: webhookVerified ? 'Confirmed payment (gateway webhook verified)' : 'Confirmed payment (manual reconciliation)', recordType: 'Payment', recordRef: `${confirmed.rows[0].receipt_no}`, reason: webhookVerified ? 'gateway confirm' : 'manual confirm — verify gateway statement', policyRef: 'Fees §4.2', outcome: `ledger updated · obligation ${o.rows[0].status}` });
      return { payment: confirmed.rows[0], obligation: o.rows[0] };
    });
  });

  // ============ transport ============
  app.get('/transport/routes', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT r.*, (SELECT count(*) FROM app.students s WHERE s.bus_route = r.code) AS riders
         FROM app.routes r ORDER BY r.code`);
      return { routes: r.rows };
    });
  });

  app.post('/transport/events', { preHandler: require('transport','coordinator','principal','facilities','owner') }, async (req, reply) => {
    const { routeCode, kind = 'gps_delay', delayMins = 0, note } = req.body ?? {};
    if (!routeCode) return bad(reply, 'routeCode required');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const route = (await c.query(`SELECT * FROM app.routes WHERE code=$1`, [routeCode])).rows[0];
      if (!route) return bad(reply, 'route not found', 404);
      const tev = await c.query(
        `INSERT INTO app.transport_events (tenant_id, route_id, kind, delay_mins, note) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.user.tenant_id, route.id, kind, delayMins, note ?? null]);
      const riders = (await c.query(`SELECT count(*)::int AS n FROM app.students WHERE bus_route=$1`, [routeCode])).rows[0].n;
      const gov = await checkEventBudget(c, req.user.tenant_id, 'transport');
      if (!gov.allowed) { await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Event rejected by governance', recordType: 'Transport', recordRef: route.code, policyRef: 'Platform §10 (event budgets)', outcome: gov.code }); return reply.code(429).send({ error: gov.code, ...gov }); }
      const ev = await emitEvent(c, req.user.tenant_id,
        { type: 'transport', label: `Bus ${routeCode} ${kind === 'gps_delay' ? `delayed +${delayMins} min` : kind} — ${riders} students affected`, severity: delayMins >= 10 ? 'warn' : 'info', ref: route.code },
        'transport.delay', { routeCode, delayMins, riders },
        { emittedBy: 'plugin:transport', subject: `route:${routeCode}`, schemaVersion: 1 });
      // Policy Transport §3.1: delay > 10 min → parent notice DRAFT, APPROVAL REQUIRED
      let action = null;
      if (kind === 'gps_delay' && delayMins >= 10) {
        const a = await c.query(
          `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload)
           VALUES ($1,$2,'approval',$3,$4,$5,'high','open','Principal','principal','Transport §3.1',true,$6,$7::jsonb) RETURNING *`,
          [req.user.tenant_id, `act_${randomUUID().slice(0,8)}`,
           `Notify ${riders} guardians — Bus ${routeCode} +${delayMins} min`,
           `Draft ready (template TRANSPORT_DELAY). Audience resolved from ${routeCode} roster.`,
           `Transport §3.1 — delay > 10 min triggers guardian notice; approval before send.`,
           ev.id,
           JSON.stringify({ kind: 'message', audience: `Route ${routeCode} guardians`, audienceCount: riders, channel: 'WhatsApp', template: 'TRANSPORT_DELAY', draft: `Bus ${routeCode} is running approximately ${delayMins} minutes late today. Expected delay at each stop accordingly. — Transport Desk`, proposed_by: req.user.id, proposed_by_role: req.user.role })]);
        action = a.rows[0];
        await linkLineage(c, req.user.tenant_id, { eventId: ev.id, actionId: action.id, relation: 'raised', policyRef: 'Transport §3.1' });
      }
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Transport event recorded (${kind})`, recordType: 'Transport', recordRef: route.code, reason: note ?? 'GPS feed', policyRef: 'Transport §3.1', outcome: action ? 'parent-notice action raised (APPROVAL REQUIRED)' : 'logged' });
      return { event: tev.rows[0], riders, action };
    });
  });

  // ============ maintenance ============
  const SLA_POLICY = {
    emergency: { responseMins: 10, resolveHours: 4 },
    critical: { responseMins: 30, resolveHours: 24 },
    high: { responseMins: 60, resolveHours: 72 },
    medium: { responseMins: 240, resolveHours: 120 },
    low: { responseMins: 480, resolveHours: 168 },
  };
  const WO_FLOW = ['reported','assigned','accepted','en-route','on-site','repairing','verification','resolved','closed','cancelled'];

  app.get('/work-orders', { preHandler: require('principal','owner','itadmin','finance','coordinator','facilities','technician','transport','teacher') }, async (req) => {
    const { status, priority, assetId } = req.query;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT w.id, w.code, w.title, w.description, w.category, w.priority, w.status, w.sla_due_at, w.cost_cents,
                w.sla_breached, w.created_at, a.code AS asset_code, a.name AS asset_name
         FROM app.work_orders w LEFT JOIN app.assets a ON a.id = w.asset_id
         WHERE ($1::text IS NULL OR w.status=$1) AND ($2::text IS NULL OR w.priority=$2) AND ($3::uuid IS NULL OR w.asset_id=$3)
         ORDER BY w.created_at DESC LIMIT 200`,
        [status ?? null, priority ?? null, assetId ?? null]);
      return { workOrders: r.rows, slaPolicy: SLA_POLICY };
    });
  });

  app.post('/work-orders', { preHandler: require('teacher','facilities','technician','coordinator','principal','owner') }, async (req, reply) => {
    const b = req.body ?? {};
    for (const f of ['title','category','priority']) if (!b[f]) return bad(reply, `${f} required`);
    if (!SLA_POLICY[b.priority]) return bad(reply, 'invalid priority');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const sla = SLA_POLICY[b.priority];
      const code = b.code ?? `WO-${Date.now().toString(36).toUpperCase()}`;
      const r = await c.query(
        `INSERT INTO app.work_orders (tenant_id, code, title, description, category, priority, status, asset_id, reported_by, sla_due_at)
         VALUES ($1,$2,$3,$4,$5,$6,'reported',$7,$8, now() + ($9 || ' hours')::interval) RETURNING *`,
        [req.user.tenant_id, code, b.title, b.description ?? null, b.category, b.priority, b.assetId ?? null, req.user.id, sla.resolveHours]);
      await c.query(`INSERT INTO app.wo_events (tenant_id, wo_id, kind, note, actor_id) VALUES ($1,$2,'created',$3,$4)`,
        [req.user.tenant_id, r.rows[0].id, `Reported · SLA ${sla.resolveHours}h`, req.user.id]);
      await emitEvent(c, req.user.tenant_id, { type: 'maintenance', label: `New ${b.priority} report — ${code} · ${b.category}`, severity: b.priority === 'emergency' ? 'critical' : b.priority === 'critical' ? 'warn' : 'info', ref: code });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Created work order', recordType: 'WorkOrder', recordRef: code, reason: b.title, outcome: `SLA due in ${sla.resolveHours}h` });
      return { workOrder: r.rows[0] };
    });
  });

  app.post('/work-orders/:id/status', { preHandler: require('technician','facilities','coordinator','principal','owner') }, async (req, reply) => {
    const to = req.body?.to;
    if (!to || !WO_FLOW.includes(to)) return bad(reply, `invalid status (flow: ${WO_FLOW.join(' → ')})`);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const w = (await c.query(`SELECT * FROM app.work_orders WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!w) return bad(reply, 'not found', 404);
      const fromIdx = WO_FLOW.indexOf(w.status), toIdx = WO_FLOW.indexOf(to);
      if (toIdx !== fromIdx + 1 && !(w.status === 'reported' && to === 'cancelled')) {
        return bad(reply, `invalid transition ${w.status} → ${to} (state machine)`, 409);
      }
      const r = await c.query(
        `UPDATE app.work_orders SET status=$2,
           resolved_at = CASE WHEN $2 IN ('resolved','closed') THEN now() ELSE resolved_at END,
           sla_breached = CASE WHEN $2='resolved' AND sla_due_at IS NOT NULL AND now() > sla_due_at THEN true ELSE sla_breached END,
           cost_cents = COALESCE($3, cost_cents)
         WHERE id=$1 RETURNING *`, [w.id, to, req.body?.costCents ?? null]);
      await c.query(`INSERT INTO app.wo_events (tenant_id, wo_id, kind, note, actor_id) VALUES ($1,$2,'status',$3,$4)`,
        [req.user.tenant_id, w.id, `${w.status} → ${to}`, req.user.id]);
      await emitEvent(c, req.user.tenant_id, { type: 'maintenance', label: `${w.code} → ${to.replace('-',' ')}`, severity: to === 'resolved' ? 'info' : 'warn', ref: w.code });
      if (to === 'resolved') {
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Work order resolved & verified', recordType: 'WorkOrder', recordRef: w.code, policyRef: 'Facilities §1.1', outcome: `SLA ${new Date() > new Date(w.sla_due_at ?? 0) ? 'BREACHED' : 'met'}` });
      }
      return { workOrder: r.rows[0] };
    });
  });

  app.get('/assets', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.assets ORDER BY code LIMIT 500`);
      return { assets: r.rows };
    });
  });

  // ============ cases ============
  const STAFF_CASE_ROLES = new Set(['owner', 'principal', 'itadmin', 'coordinator', 'teacher', 'finance']);
  app.get('/cases', { preHandler: me }, async (req, reply) => {
    if (!STAFF_CASE_ROLES.has(req.user.role)) return reply.code(403).send({ error: 'The full school case log is staff-only. Parents can see their own complaints at /my-cases.' });
    const { status } = req.query;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT * FROM app.cases WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT 200`,
        [status ?? null]);
      return { cases: r.rows };
    });
  });

  // A parent's own complaints — and only those (other families' cases never leave the staff board).
  app.get('/my-cases', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT * FROM app.cases WHERE opened_by=$2 AND ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT 100`,
        [req.query.status ?? null, req.user.id]);
      return { cases: r.rows };
    });
  });

  app.post('/cases', { preHandler: me }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.title || !b.kind) return bad(reply, 'title and kind required');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const code = b.code ?? `case_${randomUUID().slice(0,8)}`;
      const r = await c.query(
        `INSERT INTO app.cases (tenant_id, code, kind, title, detail, priority, owner, opened_by, origin, sla_due_at, linked_refs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + ($10 || ' hours')::interval, $11::jsonb) RETURNING *`,
        [req.user.tenant_id, code, b.kind, b.title, b.detail ?? null, b.priority ?? 'normal', b.owner ?? 'Coordinator', req.user.id, b.origin ?? 'staff', String(b.slaHours ?? 48), JSON.stringify(b.linkedRefs ?? [])]);
      await emitEvent(c, req.user.tenant_id, { type: 'case', label: `Case opened — ${b.title}`, severity: b.priority === 'critical' ? 'critical' : 'info', ref: code });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Opened case', recordType: 'Case', recordRef: code, reason: b.title, outcome: `owner ${b.owner ?? 'Coordinator'} · SLA ${b.slaHours ?? 48}h` });
      return { case: r.rows[0] };
    });
  });

  app.post('/cases/:id/status', { preHandler: me }, async (req, reply) => {
    if (!STAFF_CASE_ROLES.has(req.user.role)) return reply.code(403).send({ error: 'Only school staff can change a case status. Parents track progress in My complaints.' });
    const to = req.body?.to;
    if (!['open','triaged','in-progress','resolved','closed'].includes(to)) return bad(reply, 'invalid status');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `UPDATE app.cases SET status=$2, resolved_at = CASE WHEN $2 IN ('resolved','closed') THEN now() ELSE resolved_at END WHERE id=$1 RETURNING *`,
        [req.params.id, to]);
      if (!r.rows[0]) return bad(reply, 'not found', 404);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Case → ${to}`, recordType: 'Case', recordRef: r.rows[0].code, outcome: to });
      await emitEvent(c, req.user.tenant_id, { type: 'case', label: `Case ${r.rows[0].code} → ${to}`, ref: r.rows[0].code });
      return { case: r.rows[0] };
    });
  });

  // ============ actions (approvals) ============
  app.get('/actions', { preHandler: require('owner','principal','itadmin','finance','coordinator','teacher','admissions','transport','facilities','technician') }, async (req) => {
    const { status } = req.query;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT * FROM app.actions WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT 200`,
        [status ?? null]);
      return { actions: r.rows };
    });
  });

  // Wave 2 · L1-2.3: admissions→student executor (kernel-side by design — the
  // funnel keeps its no_core_students_writes invariant). Runs on approval of a
  // students.create.<leadId> action: INSERT the student (+guardian rows from the
  // lead), an enrollment_history admission row, audit trail. Idempotent three
  // ways: (1) the decide door refuses a second decision on the same action (409);
  // (2) the action code students.create.<leadId> is UNIQUE per tenant, so a lead
  // cannot raise twice; (3) the (source='admissions', source_ref=leadId) lookup
  // makes a replay return the existing record instead of duplicating it.
  const parseClassApplied = (s) => {
    const m = /^(\S+)-([A-Za-z0-9]+)$/.exec(String(s ?? '').trim());
    return m ? { grade: m[1], section: m[2].toUpperCase() } : { grade: String(s ?? '').trim() || 'unassigned', section: 'A' };
  };
  const executeStudentCreation = async (c, req, a, p) => {
    const lead = (await c.query(
      `SELECT id, student_name, class_applied, guardian_name, guardian_phone, stage
       FROM plugin_admissions.lead WHERE id=$1 FOR UPDATE`, [p.leadId])).rows[0];
    if (!lead) throw Object.assign(new Error('the admissions lead behind this approval no longer exists'), { statusCode: 409 });
    const existing = (await c.query(
      `SELECT id, name FROM app.students WHERE tenant_id=$1 AND source='admissions' AND source_ref=$2`,
      [req.user.tenant_id, String(p.leadId)])).rows[0];
    if (existing) return { type: 'student', id: existing.id, name: existing.name, already: true };
    if (lead.stage !== 'enrolled') throw Object.assign(new Error(`lead is "${lead.stage}", not "enrolled" — conversion stale`), { statusCode: 409 });
    const { grade, section } = parseClassApplied(lead.class_applied);
    const ay = /^[0-9]{4}(-[0-9]{2})?$/.test(String(p.admissionYear ?? '')) ? String(p.admissionYear) : String(new Date().getFullYear());
    let s = null;
    await c.query('SAVEPOINT student_insert');
    try {
      s = await c.query(
        `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone, status, source, source_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active','admissions',$8)
         ON CONFLICT (tenant_id, admission_no) DO NOTHING RETURNING id, name, admission_no`,
        [req.user.tenant_id, `ADM-${ay}-${String(p.leadId).slice(0, 8).toUpperCase()}`, lead.student_name, grade, section, lead.guardian_name, lead.guardian_phone, String(p.leadId)]);
      await c.query('RELEASE SAVEPOINT student_insert');
    } catch (e) {
      // admission_no collision on the deterministic form → fall back to the full
      // lead uuid (still deterministic, still idempotent via source_ref).
      await c.query('ROLLBACK TO SAVEPOINT student_insert');
      await c.query('RELEASE SAVEPOINT student_insert');
      s = await c.query(
        `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone, status, source, source_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active','admissions',$8)
         ON CONFLICT (tenant_id, admission_no) DO NOTHING RETURNING id, name, admission_no`,
        [req.user.tenant_id, `ADM-${ay}-${String(p.leadId).toUpperCase()}`, lead.student_name, grade, section, lead.guardian_name, lead.guardian_phone, String(p.leadId)]);
    }
    if (!s.rows[0]) throw Object.assign(new Error('could not allocate an admission number for this conversion'), { statusCode: 409 });
    const student = s.rows[0];
    if (lead.guardian_name && lead.guardian_phone) {
      await c.query(`INSERT INTO app.guardians (tenant_id, student_id, name, phone, relation, is_primary)
                     VALUES ($1,$2,$3,$4,'guardian',true)`, [req.user.tenant_id, student.id, lead.guardian_name, lead.guardian_phone]);
    }
    await c.query(
      `INSERT INTO app.enrollment_history (tenant_id, student_id, from_grade, from_section, to_grade, to_section, changed_by, reason)
       VALUES ($1,$2,$3,$4,$3,$4,$5,$6)`,
      [req.user.tenant_id, student.id, grade, section, req.user.id, `admission via ${a.code} — funnel conversion`]);
    await emitEvent(c, req.user.tenant_id, { type: 'people', label: `Student created from admissions — ${student.name} (${grade}-${section})`, ref: student.id });
    return { type: 'student', id: student.id, name: student.name, admissionNo: student.admission_no, grade, section };
  };

  app.post('/actions/:id/decide', { preHandler: require('owner','principal','itadmin','finance','coordinator','teacher','admissions','transport','facilities','technician') }, async (req, reply) => {
    const { decision, note } = req.body ?? {};
    if (!['approved','dismissed'].includes(decision)) return bad(reply, "decision must be 'approved' or 'dismissed'");
    // P2-3 (cycle 5): non-uuid :id hit the SELECT with 22P02 → raw 500; format-guard
    // first (same pattern as /events/lineage)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.params.id))) {
      return bad(reply, 'This record needs a valid ID');
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const a = (await c.query(`SELECT * FROM app.actions WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!a) return bad(reply, 'not found', 404);
      if (a.status !== 'open') return bad(reply, `action already ${a.status}`, 409);
      // RTR-001 RT-002 + RT-7 #5: segregation of duties — only the owning authority
      // decides, the proposer can never approve their own proposal, and the principal
      // may not rubber-stamp the coordinator desk's own actions (staff leave et al):
      // those need the coordinator or the owner. Principal-owned actions (DPDP SARs,
      // exam publications) and owner overrides are untouched; dismissal stays open to
      // the principal (coord-view pin: another authority may reject).
      const coordDeskPrincipalStamp = decision === 'approved' && req.user.role === 'principal' && a.owner_role === 'coordinator';
      if (coordDeskPrincipalStamp) {
        return bad(reply, 'Segregation of duties — ask the owner to decide this', 403);
      }
      const ownerOk = a.owner_role === req.user.role || ['owner','principal'].includes(req.user.role) && a.owner_role !== 'finance';
      if (!ownerOk) return bad(reply, `only the owning authority (${a.owner_role}) may decide this action`, 403);
      // T105d (§7.3 P1-9): the self-approval guard only had teeth when the payload
      // carried proposed_by. For UNATTRIBUTED raises, block approval only where the
      // raising desk CAN include the decider's role — the audited exploit paths:
      //   · admissions offer→enrolled conversions (admissions ADMIN includes principal)
      //   · legacy transport delay notices (transport desk includes principal; new
      //     ones carry proposed_by — stamped at the raise site above)
      // Sources whose raising desk provably EXCLUDES owner_role (health.clinic
      // guardian notices, pack.cbse obligations) are untouched — there the owner
      // role is a genuinely second authority approving a lower desk's raise.
      // Dismissal stays open to the owning authority (rejection is not self-dealing).
      const proposedBy = a.payload && typeof a.payload === 'object' ? (a.payload.proposed_by ?? null) : null;
      const exploitableUnattributed = a.payload && typeof a.payload === 'object' && proposedBy == null
        && ((a.source_event === 'admission.offer.accepted' && a.payload.leadId != null)
          || (a.payload.kind === 'message' && a.payload.template === 'TRANSPORT_DELAY' && a.payload.proposed_by == null));
      if (decision === 'approved' && exploitableUnattributed && req.user.role === a.owner_role && req.user.role !== 'owner') {
        return bad(reply, 'Segregation of duties — this proposal was raised without an attributable proposer, so the owning desk cannot approve it. Ask the school owner to decide.', 403);
      }
      if (a.payload && typeof a.payload === 'object' && a.payload.proposed_by === req.user.id && decision === 'approved')
        return bad(reply, 'self-approval is not permitted (segregation of duties)', 403);
      await c.query(`UPDATE app.actions SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1`,
        [a.id, decision, req.user.id, note ?? null]);
      let execution = null;
      if (decision === 'approved') {
        const p = a.payload ?? {};
        if (p.kind === 'message') {
          // execute the communication
          const comm = await c.query(
            `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, status, policy_ref, approved_by, sent_at, delivered_at)
             VALUES ($1, $2::jsonb, $3, $4, $5, 'delivered', $6, $7, now(), now()) RETURNING *`,
            [req.user.tenant_id, JSON.stringify([p.audience ?? 'guardians']), p.channel ?? 'WhatsApp', p.template ?? null,
             p.draft ?? a.detail, a.policy_ref, req.user.id]);
          execution = { type: 'communication', id: comm.rows[0].id, status: 'delivered' };
          await emitEvent(c, req.user.tenant_id, { type: 'comms', label: `Parent notice SENT — ${p.audience ?? 'guardians'} (${p.template ?? 'message'}, approved by ${req.user.name})`, ref: comm.rows[0].id });
        }
        if (p.kind === 'task') {
          const n = await c.query(
            `INSERT INTO app.notifications (tenant_id, "group", title, body, ref) VALUES ($1,'needs-you',$2,$3,$4) RETURNING id`,
            [req.user.tenant_id, p.title ?? a.title, p.body ?? a.detail, a.code]);
          execution = { type: 'notification', id: n.rows[0].id };
        }
        if (a.code.startsWith('students.create.') && p.leadId != null) {
          // Wave 2 · L1-2.3: the admissions→student executor. Any executor error
          // throws inside withUser → the whole tx (status flip included) rolls
          // back atomically; known executor conditions surface as honest 4xx.
          try {
            execution = await executeStudentCreation(c, req, a, p);
          } catch (e) {
            if (e.statusCode) return bad(reply, e.message, e.statusCode);
            throw e;
          }
        }
      }
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `${decision === 'approved' ? 'Approved' : 'Dismissed'} action: ${a.title}`, recordType: 'Action', recordRef: a.code, reason: note ?? 'decided in Action Center', policyRef: a.policy_ref, aiInvolved: a.ai_involved, risk: 'medium', outcome: execution ? `executed: ${execution.type} ${execution.id}` : 'no execution' });
      return { ok: true, decision, execution };
    });
  });

  // ---- payments live loop: refund + settlement reconciliation (Wave 3 · L1-3.1) ----
  // Razorpay REST keys resolve exactly like the rail's own doors (plugin settings
  // first, env fallback). Network calls happen BEFORE any ledger mutation and
  // never inside a lock we can't release — a gateway refusal leaves the ledger
  // byte-identical.
  const RZP_REFUND_API = (paymentId) => `https://api.razorpay.com/v1/payments/${paymentId}/refund`;
  const resolveRzpKeys = async (tenantId) => {
    const s = (await q(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id='payments.razorpay'`, [tenantId])).rows[0]?.settings ?? {};
    const keyId = s.key_id ?? process.env.RAZORPAY_KEY_ID ?? null;
    const keySecret = s.key_secret ?? process.env.RAZORPAY_KEY_SECRET ?? null;
    return { configured: Boolean(keyId && keySecret), keyId, keySecret };
  };
  const rzpRefund = async (keyId, keySecret, razorpayPaymentId, amountCents) => {
    const res = await fetch(RZP_REFUND_API(razorpayPaymentId), {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ amount: Number(amountCents), speed: 'normal' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, http: res.status };
    const body = await res.json().catch(() => ({}));
    return { ok: true, refundId: body?.id ?? null, status: body?.status ?? 'processed' };
  };

  app.post('/payments/:id/refund', { preHandler: require('owner', 'finance') }, async (req, reply) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.params.id))) return bad(reply, 'payment id must be a uuid');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const p = (await c.query(`SELECT * FROM app.payments WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!p) return bad(reply, 'payment not found', 404);
      if (p.status === 'refunded') return bad(reply, 'payment already refunded', 409);
      if (p.status !== 'confirmed') return bad(reply, `only confirmed payments can be refunded (this one is ${p.status})`, 409);
      // Gateway leg first (razorpay): a refused refund must not touch the ledger.
      let gateway = { mode: p.method === 'razorpay' ? 'gateway' : 'manual' };
      if (p.method === 'razorpay') {
        const op = (await c.query(
          `SELECT razorpay_payment_id FROM plugin_razorpay.order_log WHERE payment_id=$1 AND razorpay_payment_id IS NOT NULL
           ORDER BY created_at DESC LIMIT 1`, [p.id])).rows[0];
        const { configured, keyId, keySecret } = await resolveRzpKeys(req.user.tenant_id);
        if (!configured || !op) {
          gateway = { mode: 'manual', note: !configured ? 'gateway keys not configured — refund recorded manually, attach proof' : 'no razorpay payment id on the order log — refund recorded manually' };
        } else {
          const r = await rzpRefund(keyId, keySecret, op.razorpay_payment_id, p.amount_cents);
          if (!r.ok) return bad(reply, `gateway refused the refund (HTTP ${r.http}) — ledger untouched`, 409);
          gateway = { mode: 'gateway', refundId: r.refundId, status: r.status };
        }
      }
      // Ledger reversal (full refund this sprint): payment → 'refunded' finally
      // used; obligation paid_cents reversed with floor 0 and status recomputed.
      const o = p.obligation_id
        ? (await c.query(`SELECT id, amount_cents, paid_cents FROM app.fee_obligations WHERE id=$1 FOR UPDATE`, [p.obligation_id])).rows[0]
        : null;
      if (o) {
        const newPaid = BigInt(o.paid_cents) - BigInt(p.amount_cents) < 0n ? 0n : BigInt(o.paid_cents) - BigInt(p.amount_cents);
        const newStatus = newPaid <= 0n ? 'open' : (newPaid < BigInt(o.amount_cents) ? 'partial' : 'paid');
        await c.query(`UPDATE app.fee_obligations SET paid_cents=$2, status=$3 WHERE id=$1`, [o.id, newPaid.toString(), newStatus]);
      }
      const upd = await c.query(
        `UPDATE app.payments SET status='refunded', refunded_at=now(), refund_reason=$2, refund_gateway_ref=$3 WHERE id=$1 RETURNING id, status, refunded_at`,
        [p.id, reason || null, gateway.refundId ?? gateway.note ?? null]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Refunded payment', recordType: 'Payment', recordRef: p.id, reason: reason || 'owner/finance refund', policyRef: 'Fees §4.2', risk: 'high', outcome: `status refunded via ${gateway.mode}${gateway.refundId ? ` (${gateway.refundId})` : ''} — obligation paid_cents reversed` });
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `payment.refunded — ₹${Number(p.amount_cents) / 100} (${gateway.mode})`, ref: p.id });
      return { payment: upd.rows[0], gateway };
    });
  });

  app.post('/payments/reconcile', { preHandler: require('owner', 'finance') }, async (req) => {
    // Settlement reconciliation sweep: three discrepancy classes between the
    // kernel ledger and the rail's own order_log. Each finding is emitted as an
    // event so the Action Center/ops see it; the report is the cron payload.
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const ghost = (await c.query(
        `SELECT p.id, p.amount_cents, p.receipt_no, ol.status AS rail_status, ol.razorpay_order_id
         FROM app.payments p JOIN plugin_razorpay.order_log ol ON ol.payment_id = p.id
         WHERE p.tenant_id=$1 AND p.method='razorpay' AND p.status='confirmed' AND ol.status <> 'captured'
         ORDER BY p.confirmed_at DESC LIMIT 50`, [req.user.tenant_id])).rows;
      const missing = (await c.query(
        `SELECT p.id, p.status AS ledger_status, p.amount_cents, ol.razorpay_order_id, ol.razorpay_payment_id
         FROM app.payments p JOIN plugin_razorpay.order_log ol ON ol.payment_id = p.id
         WHERE p.tenant_id=$1 AND p.method='razorpay' AND ol.status = 'captured' AND p.status NOT IN ('confirmed','refunded')
         ORDER BY ol.created_at DESC LIMIT 50`, [req.user.tenant_id])).rows;
      const orphan = (await c.query(
        `SELECT p.id, p.amount_cents, p.receipt_no, p.gateway_ref
         FROM app.payments p
         WHERE p.tenant_id=$1 AND p.method='razorpay' AND p.status='confirmed'
           AND NOT EXISTS (SELECT 1 FROM plugin_razorpay.order_log ol WHERE ol.payment_id = p.id)
         ORDER BY p.confirmed_at DESC LIMIT 50`, [req.user.tenant_id])).rows;
      for (const g of ghost) await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `reconciliation.discrepancy — confirmed locally, rail says ${g.rail_status} (order ${g.razorpay_order_id})`, ref: g.id });
      for (const m of missing) await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `reconciliation.discrepancy — rail captured, ledger still ${m.ledger_status} (order ${m.razorpay_order_id})`, ref: m.id });
      for (const w of orphan) await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `reconciliation.discrepancy — confirmed with no rail order log entry`, ref: w.id });
      return { checked: { confirmedRazorpay: ghost.length + missing.length + orphan.length }, discrepancies: { ghostLocalConfirmed: ghost, missingLocalConfirmation: missing, orphanNoRailLog: orphan }, total: ghost.length + missing.length + orphan.length };
    });
  });

  // ---- fee dunning (Wave 3 · L1-3.2) ----
  // Overdue-obligation reminders: one queued communication per overdue obligation
  // per 7-day window (dedup_key), guardians with a phone only, honest copy, and
  // quiet hours from plugin settings (comms.whatsapp settings.quiet_hours, IST —
  // default 21:00–08:00). During quiet hours the sweep WRITES NOTHING — there is
  // no delivery worker yet, so queueing at 2am would risk a 2am send.
  const IST_NOW_MS = () => Date.now() + 5.5 * 3600 * 1000;
  const IST_TODAY = () => new Date(IST_NOW_MS()).toISOString().slice(0, 10);
  const IST_MINUTE_OF_DAY = () => {
    const d = new Date(IST_NOW_MS());
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  };
  const parseHm = (s) => {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s ?? ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const inQuietHours = (q0, q1, minute) => q0 === null || q1 === null ? false : (q0 <= q1 ? (minute >= q0 && minute < q1) : (minute >= q0 || minute < q1));
  const dunningQuietHours = async (tenantId) => {
    const s = (await q(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id='comms.whatsapp'`, [tenantId])).rows[0]?.settings ?? {};
    const qs = s.quiet_hours ?? {};
    return { start: qs.start ?? '21:00', end: qs.end ?? '08:00' };
  };
  const DUNNING_SELECT = `
    SELECT o.id, o.student_id, o.label, o.due_on, o.amount_cents, o.paid_cents,
           s.name AS student_name, s.guardian_phone
    FROM app.fee_obligations o JOIN app.students s ON s.id = o.student_id
    WHERE o.tenant_id = $1 AND o.status IN ('open','partial') AND o.due_on < $2::date AND o.amount_cents > o.paid_cents
      AND NOT EXISTS (SELECT 1 FROM app.communications cm
                       WHERE cm.dedup_key = 'dunning:' || o.id::text AND cm.created_at > now() - interval '7 days')`;

  app.post('/fees/dunning/run', { preHandler: require('owner', 'finance') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const quiet = await dunningQuietHours(req.user.tenant_id);
      const q0 = parseHm(quiet.start), q1 = parseHm(quiet.end);
      const minute = IST_MINUTE_OF_DAY();
      if (inQuietHours(q0, q1, minute)) {
        const opensAt = minute < (q1 ?? 0) ? quiet.end : `${quiet.end} (next day IST)`;
        return { queued: 0, quietHours: quiet, note: `quiet hours in effect (IST) — sweep writes nothing until ${opensAt}` };
      }
      const rows = (await c.query(`${DUNNING_SELECT} ORDER BY o.due_on LIMIT 200`, [req.user.tenant_id, IST_TODAY()])).rows;
      let queued = 0; let skippedNoContact = 0;
      for (const o of rows) {
        if (!o.guardian_phone) { skippedNoContact += 1; continue; }
        const due = BigInt(o.amount_cents) - BigInt(o.paid_cents);
        await c.query(
          `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, policy_ref, dedup_key)
           VALUES ($1,'guardian',$2::jsonb,'whatsapp','FEE_REMINDER',$3,'queued','Fees §4.2',$4)`,
          [req.user.tenant_id, JSON.stringify([o.guardian_phone]),
           `Fee reminder: ${o.student_name} — ${o.label}, ₹${Number(due) / 100} was due on ${o.due_on}. Please pay via the parent portal or at the school office. If you have already paid, please share the receipt with the office — no action otherwise.`,
           `dunning:${o.id}`]);
        queued += 1;
      }
      if (queued > 0) {
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Ran fee dunning sweep', recordType: 'Fees', recordRef: IST_TODAY(), reason: 'overdue obligations', policyRef: 'Fees §4.2', outcome: `${queued} reminders queued (7-day dedup per obligation) · ${skippedNoContact} skipped without guardian contact` });
        await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `Fee dunning — ${queued} reminder(s) queued for overdue fees`, ref: IST_TODAY() });
      }
      return { queued, skippedNoContact, quietHours: quiet, template: 'FEE_REMINDER' };
    });
  });

  // ---- timetable clash-check (Wave 4 · L1-4.2) ----
  // Read-only planner check: would a proposed (teacher, room) double-book against
  // the weekly grid AND the day's substitutions (the effective-teacher overlay)?
  // The v1 grid is section-agnostic (one grid per school — ops.timetable:33), so
  // section clashes are reported as not-applicable rather than fabricated.
  app.post('/timetable/clash-check', { preHandler: require('owner', 'principal', 'coordinator', 'itadmin') }, async (req, reply) => {
    const b = req.body ?? {};
    const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    if (!DAYS.includes(b.dayOfWeek)) return bad(reply, `dayOfWeek must be one of ${DAYS.join(', ')}`);
    const proposals = Array.isArray(b.proposals) ? b.proposals : [b];
    if (proposals.length === 0 || proposals.length > 50) return bad(reply, 'provide 1–50 proposals');
    for (const pr of proposals) {
      if (!pr || (pr.teacherName == null && pr.room == null)) return bad(reply, 'each proposal needs a teacherName and/or room');
      if (pr.teacherName != null && (typeof pr.teacherName !== 'string' || !pr.teacherName.trim() || pr.teacherName.length > 80)) return bad(reply, 'teacherName must be a non-empty string (≤80 chars)');
      if (pr.room != null && (typeof pr.room !== 'string' || !pr.room.trim() || pr.room.length > 40)) return bad(reply, 'room must be a non-empty string (≤40 chars)');
    }
    if (b.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) return bad(reply, 'date must be YYYY-MM-DD');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const period = b.periodId
        ? (await c.query(`SELECT id, seq, label, start_time, end_time FROM app.timetable_periods WHERE id=$1`, [b.periodId])).rows[0]
        : b.periodSeq
          ? (await c.query(`SELECT id, seq, label, start_time, end_time FROM app.timetable_periods WHERE seq=$1`, [String(b.periodSeq)])).rows[0]
          : null;
      if (!period) return bad(reply, 'period not found — pass periodId or periodSeq', 404);
      const results = [];
      for (const pr of proposals) {
        const teacher = pr.teacherName?.trim();
        const room = pr.room?.trim();
        const grid = (await c.query(
          `SELECT id, subject, teacher_name, room FROM app.timetable_slots
           WHERE period_id=$1 AND day_of_week=$2 AND (
             ($3::text IS NOT NULL AND lower(teacher_name) = lower($3))
             OR ($4::text IS NOT NULL AND room IS NOT NULL AND lower(room) = lower($4)))`,
          [period.id, b.dayOfWeek, teacher ?? null, room ?? null])).rows;
        const teacherClashes = teacher ? grid.filter((g) => g.teacher_name.toLowerCase() === teacher.toLowerCase()).map((g) => ({ slotId: g.id, subject: g.subject, teacher: g.teacher_name, room: g.room, via: 'grid' })) : [];
        const roomClashes = room ? grid.filter((g) => g.room && g.room.toLowerCase() === room.toLowerCase() && !teacherClashes.some((t) => t.slotId === g.id)).map((g) => ({ slotId: g.id, subject: g.subject, teacher: g.teacher_name, room: g.room, via: 'grid' })) : [];
        let substitutionClashes = [];
        if (b.date && teacher) {
          const subs = (await c.query(
            `SELECT sub.id, sub.absent_teacher, sub.substitute, s.subject, s.room
             FROM app.timetable_substitutions sub JOIN app.timetable_slots s ON s.id = sub.slot_id
             WHERE s.period_id=$1 AND s.day_of_week=$2 AND sub.date=$3::date AND sub.status='assigned'
               AND lower(sub.substitute) = lower($4)`,
            [period.id, b.dayOfWeek, b.date, teacher])).rows;
          substitutionClashes = subs.map((x) => ({ substitutionId: x.id, absentTeacher: x.absent_teacher, subject: x.subject, room: x.room, via: 'substitution' }));
        }
        results.push({ proposal: { teacherName: teacher ?? null, room: room ?? null }, teacherClashes, roomClashes, substitutionClashes, clean: teacherClashes.length === 0 && roomClashes.length === 0 && substitutionClashes.length === 0 });
      }
      return { period, date: b.date ?? null, results, note: 'slots are section-agnostic in v1 (one grid per school) — section clashes are undetectable until per-section slots ship' };
    });
  });

  // ---- exam depth: per-exam board policy (Wave 4 · L1-4.3) ----
  // The plugin already ships a bulk-marks door (one tx, ≤300 rows, eligibility,
  // audit) — that half of L1-4.3 exists on main. This adds the missing half: a
  // PER-EXAM board policy json (the settings-carried one is tenant-wide).
  // VALIDATION ONLY this sprint: shape-checked and stored; nothing consumes it
  // yet (the reply says so — no fabricated downstream behavior).
  const BOARD_POLICY_SHAPE = (bp) => {
    if (!bp || typeof bp !== 'object' || Array.isArray(bp)) return 'boardPolicy must be an object';
    if (typeof bp.board !== 'string' || !bp.board.trim() || bp.board.trim().length > 40) return 'board is required (≤40 chars, e.g. CBSE)';
    if (bp.rounding !== undefined && !['nearest', 'floor', 'ceil'].includes(bp.rounding)) return 'rounding must be nearest|floor|ceil';
    if (bp.components !== undefined) {
      if (!bp.components || typeof bp.components !== 'object' || Array.isArray(bp.components)) return 'components must be an object of {name: percent}';
      const entries = Object.entries(bp.components);
      if (entries.length === 0 || entries.length > 20) return 'components needs 1–20 entries';
      let sum = 0;
      for (const [k, v] of entries) {
        if (typeof k !== 'string' || !k.trim() || k.length > 40) return 'component names must be non-empty (≤40 chars)';
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) return 'component percents must be numbers 0..100';
        sum += v;
      }
      if (sum > 100.0001) return `component percents sum to ${sum} — cannot exceed 100`;
    }
    if (bp.gradingScale !== undefined) {
      if (!Array.isArray(bp.gradingScale) || bp.gradingScale.length === 0 || bp.gradingScale.length > 20) return 'gradingScale must be a non-empty array (≤20 bands)';
      let prev = null;
      for (const band of bp.gradingScale) {
        if (!band || typeof band.min !== 'number' || !Number.isFinite(band.min) || band.min < 0 || band.min > 100) return 'each grading band needs min 0..100';
        if (typeof band.grade !== 'string' || !band.grade.trim() || band.grade.length > 10) return 'each grading band needs a grade label (≤10 chars)';
        if (prev !== null && band.min >= prev) return 'grading bands must be strictly descending by min';
        prev = band.min;
      }
    }
    if (bp.notes !== undefined && (typeof bp.notes !== 'string' || bp.notes.length > 500)) return 'notes must be a string (≤500 chars)';
    const allowed = ['board', 'rounding', 'components', 'gradingScale', 'notes'];
    for (const k of Object.keys(bp)) if (!allowed.includes(k)) return `unknown boardPolicy key "${k}" (allowed: ${allowed.join(', ')})`;
    return null;
  };

  app.post('/exams/:id/board-policy', { preHandler: require('owner', 'principal', 'itadmin') }, async (req, reply) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.params.id))) return bad(reply, 'exam id must be a uuid');
    const err = BOARD_POLICY_SHAPE(req.body);
    if (err) return bad(reply, err);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const e = (await c.query(`SELECT id, name FROM plugin_exams.exam WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!e) return bad(reply, 'exam not found', 404);
      await c.query(`UPDATE plugin_exams.exam SET board_policy=$2::jsonb, updated_at=now() WHERE id=$1`, [e.id, JSON.stringify(req.body)]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Set exam board policy', recordType: 'Exam', recordRef: e.name, reason: `board ${req.body.board}`, outcome: 'stored — validation only, nothing consumes it yet' });
      return { examId: e.id, boardPolicy: req.body, note: 'validation only — no downstream behavior reads this yet' };
    });
  });

  app.get('/exams/:id/board-policy', { preHandler: me }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const e = (await c.query(`SELECT id, name, board_policy FROM plugin_exams.exam WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!e) return bad(reply, 'exam not found', 404);
      return { examId: e.id, boardPolicy: e.board_policy ?? null };
    });
  });

  // ---- L1-5.1 admissions follow-up queue (kernel ranking service, D-36/D-38) ----
  // Deterministic rule, NO model (docs/11 §7, pol_14): the server ranks leads for
  // follow-up so the rule lives in one audited place instead of being recomputed
  // per screen. ruleVersion 'followups-1':
  //   score = days-in-stage × stage weight (inquiry 1.0, school-visit 1.2,
  //   applied 1.5, assessment 2.0, offer 2.5 — later stages are closer to
  //   enrollment and more expensive to lose); stuck = >7 days in stage; stuck
  //   rows first, then score desc. enrolled/dropped never rank.
  const FOLLOWUP_WEIGHTS = { inquiry: 1, 'school-visit': 1.2, applied: 1.5, assessment: 2, offer: 2.5 };
  const maskPhoneLikeFunnel = (p) => {
    if (!p) return null;
    const d = String(p).replace(/\D/g, '').slice(-10);
    return `${d.slice(0, 2)}xxxx${d.slice(-2)}`;
  };
  app.get('/admissions/followups', { preHandler: me }, async (req) => {
    const fullPii = ['owner', 'principal', 'itadmin', 'coordinator'].includes(req.user.role);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT id, student_name, class_applied, source, stage, guardian_name, guardian_phone, updated_at,
                GREATEST(0, extract(epoch FROM (now() - updated_at)) / 86400)::int AS days_in_stage
         FROM plugin_admissions.lead
         WHERE tenant_id=$1 AND stage NOT IN ('enrolled','dropped')`, [req.user.tenant_id])).rows;
      const queue = rows.map((r) => {
        const days = Number(r.days_in_stage);
        const w = FOLLOWUP_WEIGHTS[r.stage] ?? 1;
        return {
          leadId: r.id, studentName: r.student_name, classApplied: r.class_applied, source: r.source,
          stage: r.stage, daysInStage: days, stageWeight: w, score: Math.round(days * w * 10) / 10,
          stuck: days > 7,
          guardianName: fullPii ? r.guardian_name : null,
          guardianPhone: fullPii ? r.guardian_phone : maskPhoneLikeFunnel(r.guardian_phone),
        };
      }).sort((a, b) => (a.stuck === b.stuck) ? b.score - a.score : (a.stuck ? -1 : 1));
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Listed admissions follow-up queue', recordType: 'AdmissionLead', recordRef: 'followups', reason: 'daily queue (docs/02 §daily-queue)', policyRef: 'deterministic ranking rule followups-1 — no model', risk: 'low', outcome: `${queue.length} open leads ranked, ${queue.filter((x) => x.stuck).length} stuck >7d` });
      return {
        ruleVersion: 'followups-1',
        rule: 'score = days-in-stage × stage weight (inquiry 1.0 → offer 2.5); stuck (>7d) first; deterministic — no model',
        masked: !fullPii,
        queue,
      };
    });
  });

  // ---- L1-5.2 fees collection summary (kernel aggregate ops.bi lacks, D-38) ----
  // ops.bi's aging door covers OVERDUE money only. This is the whole-collection
  // view per term: billed vs collected vs outstanding vs voided, optional
  // academic-year filter — tenant-scoped, staff-gated (parents see their own
  // children's ledger, never school-wide aggregates).
  app.get('/reports/fees/summary', { preHandler: require('owner', 'principal', 'coordinator', 'finance', 'itadmin') }, async (req, reply) => {
    const ay = req.query?.academicYearId;
    if (ay != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(ay))) return bad(reply, 'academicYearId must be a uuid');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = (await c.query(
        `SELECT o.term,
                count(*)::int AS obligations,
                COALESCE(SUM(o.amount_cents), 0)::bigint AS billed_cents,
                COALESCE(SUM(o.paid_cents), 0)::bigint AS collected_cents,
                COALESCE(SUM(o.amount_cents - o.paid_cents) FILTER (WHERE o.status IN ('open','partial')), 0)::bigint AS outstanding_cents,
                count(*) FILTER (WHERE o.status = 'void')::int AS voided,
                count(*) FILTER (WHERE o.status = 'paid')::int AS fully_paid
         FROM app.fee_obligations o
         WHERE o.tenant_id=$1 AND ($2::uuid IS NULL OR o.academic_year_id=$2::uuid)
         GROUP BY o.term ORDER BY o.term`, [req.user.tenant_id, ay ?? null])).rows;
      const sum = (k) => r.reduce((a, x) => a + Number(x[k]), 0);
      const billed = sum('billed_cents'), collected = sum('collected_cents');
      return {
        terms: r,
        totals: { obligations: sum('obligations'), billed_cents: billed, collected_cents: collected, outstanding_cents: sum('outstanding_cents'), voided: sum('voided'), fully_paid: sum('fully_paid') },
        collectionPct: billed > 0 ? Math.round((collected / billed) * 1000) / 10 : null,
        academicYearId: ay ?? null,
        note: 'paid_cents never decreases (D-5/D-21); voided rows keep their history but are excluded from outstanding; not_due rows count in billed — collection % is whole-ledger, unlike ops.bi/fees/aging which is overdue-only',
      };
    });
  });

  // ============ events / notifications / communications / audit / memory ============
  app.get('/events', { preHandler: require('owner','principal','itadmin','finance','coordinator','teacher','admissions','transport','facilities','technician') }, async (req) => {
    const since = req.query.since ? new Date(req.query.since) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT id, type, label, severity, ref, created_at FROM app.events
         WHERE ($1::timestamptz IS NULL OR created_at > $1) ORDER BY created_at DESC LIMIT 100`, [since]);
      return { events: r.rows };
    });
  });

  app.get('/notifications', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.notifications WHERE user_id=$1 OR user_id IS NULL ORDER BY created_at DESC LIMIT 100`, [req.user.id]);
      return { notifications: r.rows };
    });
  });

  app.post('/notifications/read', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      await c.query(`UPDATE app.notifications SET read_at=now() WHERE id=$1 AND user_id=$2`, [req.body?.id, req.user.id]);
      return { ok: true };
    });
  });

  app.get('/communications', { preHandler: require('owner','principal','coordinator','finance','itadmin','transport') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.communications ORDER BY created_at DESC LIMIT 100`);
      return { communications: r.rows };
    });
  });

  app.get('/audit', { preHandler: require('owner','principal','itadmin','finance') }, async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? '100', 10), 500);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT id, actor, actor_role, action, record_type, record_ref, reason, policy_ref, ai_involved, risk, outcome, prev_hash, hash, created_at
         FROM app.audit_log ORDER BY created_at DESC, id DESC LIMIT $1`, [limit]);
      return { entries: r.rows };
    });
  });

  app.get('/memory', { preHandler: require('owner','principal','itadmin') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.memory_entries ORDER BY decided_at DESC LIMIT 100`);
      return { entries: r.rows };
    });
  });

  app.post('/memory', { preHandler: require('owner','principal','coordinator','finance') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.title) return bad(reply, 'title required');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `INSERT INTO app.memory_entries (tenant_id, kind, title, body, evidence, decided_by, expected, actual)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *`,
        [req.user.tenant_id, b.kind ?? 'decision', b.title, b.body ?? null, JSON.stringify(b.evidence ?? []), req.user.name, b.expected ?? null, b.actual ?? null]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Recorded institutional decision', recordType: 'Memory', recordRef: r.rows[0].id, reason: b.title, outcome: 'remembered with expected-vs-actual' });
      return { entry: r.rows[0] };
    });
  });

  // ============ event lineage (docs/12 §10: event → subscriber → action → downstream) ============
  app.get('/events/lineage', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const limit = Math.min(parseInt(req.query.limit ?? '25', 10) || 25, 100);
      const correlation = req.query.correlation && /^[0-9a-f-]{36}$/i.test(req.query.correlation) ? req.query.correlation : null;
      const evs = await c.query(
        `SELECT e.id, e.type, e.label, e.severity, e.emitted_by, e.subject, e.correlation_id, e.causation_id, e.created_at,
           (SELECT json_agg(json_build_object('action_id', l.action_id, 'relation', l.relation, 'policy_ref', l.policy_ref))
              FROM app.event_action_link l WHERE l.event_id = e.id) AS links
         FROM app.events e
         WHERE e.tenant_id=$1 AND ($2::uuid IS NULL OR e.correlation_id = $2)
         ORDER BY e.created_at DESC LIMIT $3`,
        [req.user.tenant_id, correlation, limit]);
      return { lineage: evs.rows };
    });
  });

  // ============ plugins (the switchboard) ============
  // redteam cycle-3: registry ids are letter-first namespaced strings — digit-run ids
  // ('9lives') walked the earlier digit-first pattern; underscore/traversal/uppercase
  // all bounce. Same regex governs the drop-in loader.
  // NOTE: must be `async` — Fastify 5 stalls when an async preHandler is followed
  // by a sync one (empirically pinned: async guard → 200, sync guard → hung request).
  const PLUGIN_ID_RE = /^[a-z][a-z0-9.-]{2,63}$/;
  const pluginGuard = async (req, reply) => {
    if (!PLUGIN_ID_RE.test(req.params.id)) {
      return bad(reply, 'invalid plugin id');
    }
  };
  const isPrivileged = (role) => ['owner', 'itadmin'].includes(role);

  app.get('/plugins', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      /* Self-heal: a tenant provisioned before catalog-seeding landed has zero
         registry rows — seed them so the plugin manager has real switches. */
      await ensurePluginCatalog(c, req.user.tenant_id);
      // `enabled` is the resync flag the kernel mirror reads on mount
      // (app/src/plugins/useKernel.tsx): the 14-state lifecycle (docs/12) has
      // three enabled-equivalent states — registered/draft/… normalize to false.
      // redteam cycle-2 P1-2 (orchestrator option (a)): settings is the secrets column
      // (009 designs it for BSP/gateway/vendor credentials) — non-privileged roles get
      // ONLY {hasSettings, keys} + the manifest schema; never values. Tradeoff (option (b),
      // RLS/role-filtered column) noted in the unit report: stronger at the storage layer,
      // but heavier — deferred until a second consumer needs secret reads.
      const privileged = isPrivileged(req.user.role);
      const r = (await c.query(
        `SELECT plugin_id, version, class, status, (status IN ('enabled','active','degraded')) AS enabled,
                manifest, permissions, settings, entitlement, enabled_at FROM app.plugins ORDER BY plugin_id`)).rows;
      // docs/12 §4: capability contracts are first-class — surface them with the registry
      const contracts = await c.query(`SELECT capability_id, version, kind, contract, enforced FROM app.capability_contracts ORDER BY capability_id`);
      return {
        plugins: r.map(p => {
          if (privileged) return p;
          const keys = Object.keys(p.settings ?? {});
          return { ...p, settings: undefined, hasSettings: keys.length > 0, keys, settings_schema: p.manifest?.settingsSchema ?? null };
        }),
        contracts: contracts.rows,
      };
    });
  });

  app.post('/plugins/:id/enable', { preHandler: [require('owner','itadmin'), pluginGuard] }, async (req, reply) => {
    const { version, class: pClass, manifest, permissions } = req.body ?? {};
    if (!pClass || !['A','B','C','D','E'].includes(pClass)) return bad(reply, 'class A–E required');
    // redteam P2-1: registry hygiene — semver-ish version, bounded manifest, bounded permission set
    if (version != null && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) return bad(reply, 'version must be semver (e.g. 1.0.0)');
    if (version != null && String(version).length > 32) return bad(reply, 'version too long (max 32 chars)');
    if (manifest != null && Buffer.byteLength(JSON.stringify(manifest)) > 65536) return bad(reply, 'manifest too large (max 64KB)', 413);
    if (permissions != null && (!Array.isArray(permissions) || permissions.length > 32 || !permissions.every(p => typeof p === 'string' && p.length <= 128))) return bad(reply, 'permissions must be a string array (max 32, each ≤128 chars)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // Catalog rows (009/010) carry the governance manifest server-side; a UI enable
      // with no manifest body must never blank it (docs/12: the registry is the truth).
      const known = (await c.query(`SELECT manifest, permissions FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [req.user.tenant_id, req.params.id])).rows[0];
      const r = await c.query(
        `INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, enabled_at, enabled_by)
         VALUES ($1,$2,$3,$4,'enabled',$5::jsonb,$6::jsonb, now(), $7)
         ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET status='enabled', version=EXCLUDED.version,
           manifest=EXCLUDED.manifest, permissions=EXCLUDED.permissions, enabled_at=now(), enabled_by=EXCLUDED.enabled_by, updated_at=now()
         RETURNING *`,
        [req.user.tenant_id, req.params.id, version ?? '1.0.0', pClass,
         JSON.stringify(manifest ?? known?.manifest ?? {}),
         JSON.stringify(permissions ?? known?.permissions ?? []),
         req.user.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Plugin enabled: ${req.params.id}`, recordType: 'Plugin', recordRef: `${req.params.id}@${version ?? '1.0.0'}`, reason: `class ${pClass} · permissions: ${(permissions ?? []).join(', ') || 'none'}`, policyRef: 'Platform §3.1 (plugin governance)', risk: 'medium', outcome: 'nav, routes and slots will reflect the module' });
      return { plugin: r.rows[0] };
    });
  });

  app.post('/plugins/:id/disable', { preHandler: [require('owner','itadmin'), pluginGuard] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // DRAIN PROTOCOL (docs/12 §12): disable may never abandon school work.
      const drained = await c.query(
        `UPDATE app.actions SET owner='Principal desk (drain hand-back)', owner_role='principal'
         WHERE tenant_id=$1 AND status='open' AND (owner_role=$2 OR owner=$2) RETURNING id`,
        [req.user.tenant_id, req.params.id]);
      const subs = await c.query(
        `SELECT count(*)::int AS n FROM app.event_action_link l
         JOIN app.events e ON e.id = l.event_id
         WHERE e.tenant_id=$1 AND e.emitted_by=$2 AND l.created_at > now() - interval '30 days'`,
        [req.user.tenant_id, `plugin:${req.params.id}`]);
      const r = await c.query(`UPDATE app.plugins SET status='disabled', updated_at=now() WHERE tenant_id=$1 AND plugin_id=$2 RETURNING *`, [req.user.tenant_id, req.params.id]);
      if (!r.rows[0]) return bad(reply, 'plugin not registered', 404);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Plugin disabled: ${req.params.id}`, recordType: 'Plugin', recordRef: req.params.id, reason: 'switched off by school', policyRef: 'Platform §3.1', risk: 'low', outcome: `data retained · subscriptions stopped · DRAIN: ${drained.rowCount} open action(s) handed back to principal · ${subs.rows[0].n} linked events retained for lineage` });
      return { plugin: r.rows[0], drained: { actions_reassigned: drained.rowCount, events_retained: subs.rows[0].n } };
    });
  });

  app.post('/plugins/:id/settings', { preHandler: [require('owner','itadmin'), pluginGuard] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`UPDATE app.plugins SET settings=$3::jsonb, updated_at=now() WHERE tenant_id=$1 AND plugin_id=$2 RETURNING *`, [req.user.tenant_id, req.params.id, JSON.stringify(req.body ?? {})]);
      if (!r.rows[0]) return bad(reply, 'plugin not registered', 404);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Plugin settings updated: ${req.params.id}`, recordType: 'Plugin', recordRef: req.params.id, outcome: 'settings saved' });
      return { plugin: r.rows[0] };
    });
  });

  // ============ plugin runtimes live in src/plugins/<id>/ (see loader.js) ============
  // Docs/11 §2.2: each plugin mounts its own doors; the core adds no per-plugin logic.
  // Registry enable/disable + drain protocol remain right here (the switchboard).

  // ============ migration (Golden Loop 1 backend) ============
  app.get('/migration/sources', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.migration_sources ORDER BY created_at`);
      return { sources: r.rows };
    });
  });

  app.post('/migration/sources', { preHandler: require('owner','coordinator','itadmin') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.name || !b.kind) return bad(reply, 'name and kind required');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `INSERT INTO app.migration_sources (tenant_id, name, kind, row_count, meta) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,
        [req.user.tenant_id, b.name, b.kind, b.rowCount ?? 0, JSON.stringify(b.meta ?? {})]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Connected migration source', recordType: 'Migration', recordRef: b.name, reason: b.kind, outcome: 'connected — nothing imported yet' });
      return { source: r.rows[0] };
    });
  });

  app.post('/migration/sources/:id/stage', { preHandler: require('owner','coordinator','itadmin') }, async (req, reply) => {
    const to = req.body?.to;
    // L1-4.1: 'verified' is EARNED by a committed import (the commit door), never
    // hand-flipped — the trust receipt must never describe work that didn't happen.
    const valid = ['analyzed','mapped','health-check','shadow'];
    if (!valid.includes(to)) return bad(reply, `stage must be one of ${valid.join(', ')}`);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`UPDATE app.migration_sources SET status=$2 WHERE id=$1 RETURNING *`, [req.params.id, to]);
      if (!r.rows[0]) return bad(reply, 'not found', 404);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Migration source → ${to}`, recordType: 'Migration', recordRef: r.rows[0].name, policyRef: 'Migration §1.1', outcome: 'dry-run stage advanced — no live data changed' });
      return { source: r.rows[0] };
    });
  });

  // ---- migration engine: staged rows → validate → commit (Wave 4 · L1-4.1) ----
  // Canonical row shape (columns mapping): { rowNo?, data: { admissionNo?, name,
  //   grade, section, guardianName?, guardianPhone?, fees?: [{ term, label,
  //   amountCents, dueOn?, paidCents? }] } }
  // students+guardians+fees land idempotently: students carry
  // source='migration', source_ref='mig:<sourceId>:<rowNo>'.
  const MIG_PHONE = /^[\d+\-\s()]{6,15}$/;
  const migValidateRow = (data) => {
    if (!data || typeof data !== 'object') return 'row is not an object';
    if (!data.name || !String(data.name).trim() || String(data.name).trim().length > 120) return 'name is required (≤120 chars)';
    if (!data.grade || String(data.grade).trim().length > 20) return 'grade is required (≤20 chars)';
    if (!data.section || String(data.section).trim().length > 10) return 'section is required (≤10 chars)';
    if (data.guardianPhone != null && data.guardianPhone !== '' && !MIG_PHONE.test(String(data.guardianPhone))) return 'guardianPhone does not look like a phone number';
    const fees = Array.isArray(data.fees) ? data.fees : [];
    if (fees.length > 24) return 'fees list too long (≤24 per student)';
    for (const f of fees) {
      if (!f || !f.term || !String(f.term).trim() || String(f.term).trim().length > 40) return 'each fee needs a term (≤40 chars)';
      if (!f.label || !String(f.label).trim() || String(f.label).trim().length > 80) return 'each fee needs a label (≤80 chars)';
      if (!Number.isInteger(f.amountCents) || f.amountCents < 0) return 'each fee needs an integer amountCents ≥ 0';
      if (f.dueOn != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(f.dueOn))) return 'fee dueOn must be YYYY-MM-DD';
      if (f.paidCents != null && (!Number.isInteger(f.paidCents) || f.paidCents < 0 || f.paidCents > f.amountCents)) return 'fee paidCents must be an integer between 0 and amountCents';
    }
    return null;
  };

  app.post('/migration/sources/:id/stage-rows', { preHandler: require('owner','coordinator','itadmin') }, async (req, reply) => {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 5000) return bad(reply, 'rows must be a non-empty list (≤5000)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const src = (await c.query(`SELECT id, name, status FROM app.migration_sources WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!src) return bad(reply, 'source not found', 404);
      if (src.status === 'verified' || src.status === 'activated') return bad(reply, `source is ${src.status} — connect a new source to import more`, 409);
      // re-staging replaces the staged set (staged only; committed history stays).
      // App-role table-level DELETE is not granted (bootstrap 054 baseline) — the
      // scoped SECURITY DEFINER helper does the delete, tenant-guarded.
      await c.query(`SELECT app.purge_staged_rows($1)`, [src.id]);
      let n = 0;
      for (const r of rows) {
        const rowNo = Number.isInteger(r.rowNo) ? r.rowNo : n + 1;
        if (!Number.isInteger(rowNo) || rowNo < 1 || rowNo > 1000000) return bad(reply, `rowNo must be an integer 1..1000000`);
        await c.query(
          `INSERT INTO app.migration_rows (tenant_id, source_id, row_no, kind, payload, status)
           VALUES ($1,$2,$3,'student',$4::jsonb,'staged')
           ON CONFLICT (source_id, row_no) DO UPDATE SET payload = EXCLUDED.payload, status = 'staged', error = NULL`,
          [req.user.tenant_id, src.id, rowNo, JSON.stringify(r.data ?? {})]);
        n += 1;
      }
      const total = (await c.query(`SELECT count(*)::int n FROM app.migration_rows WHERE source_id=$1`, [src.id])).rows[0].n;
      await c.query(
        `UPDATE app.migration_sources SET row_count=$2, status = CASE WHEN status='connected' THEN 'analyzed' ELSE status END,
           sample_json = $3::jsonb WHERE id=$1`,
        [src.id, total, JSON.stringify({ preview: rows.slice(0, 3), stagedAt: new Date().toISOString(), stagedCount: n })]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Staged migration rows', recordType: 'Migration', recordRef: src.name, reason: 'file staged for import', outcome: `${n} rows staged (${total} total) — nothing imported` });
      return { staged: n, total };
    });
  });

  app.post('/migration/sources/:id/validate', { preHandler: require('owner','coordinator','itadmin') }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const src = (await c.query(`SELECT id, name FROM app.migration_sources WHERE id=$1`, [req.params.id])).rows[0];
      if (!src) return bad(reply, 'source not found', 404);
      const rows = (await c.query(`SELECT id, row_no, payload FROM app.migration_rows WHERE source_id=$1 AND status <> 'ok' ORDER BY row_no`, [src.id])).rows;
      let ok = 0; const errors = [];
      for (const row of rows) {
        const err = migValidateRow(row.payload);
        if (err) {
          errors.push({ rowNo: row.row_no, error: err });
          await c.query(`UPDATE app.migration_rows SET status='error', error=$2 WHERE id=$1`, [row.id, err]);
        } else {
          ok += 1;
          await c.query(`UPDATE app.migration_rows SET status='staged', error=NULL WHERE id=$1 AND status='error'`, [row.id]);
        }
      }
      await c.query(`UPDATE app.migration_sources SET flagged=$2, status = CASE WHEN status IN ('connected','analyzed') THEN 'health-check' ELSE status END WHERE id=$1`, [src.id, errors.length]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Validated migration rows', recordType: 'Migration', recordRef: src.name, outcome: `${ok} clean · ${errors.length} row errors` });
      return { clean: ok, errors: errors.length, first: errors.slice(0, 20) };
    });
  });

  app.post('/migration/sources/:id/commit', { preHandler: require('owner','coordinator','itadmin') }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const src = (await c.query(`SELECT id, name FROM app.migration_sources WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!src) return bad(reply, 'source not found', 404);
      const errs = (await c.query(`SELECT count(*)::int n FROM app.migration_rows WHERE source_id=$1 AND status='error'`, [src.id])).rows[0].n;
      if (errs > 0) return bad(reply, `fix ${errs} row error(s) before committing`, 409);
      // L1-4.1 idempotent replay: staged rows are processed; rows already
      // committed (status 'ok' with a student) count as skips — a re-commit
      // must NEVER create duplicates.
      const rows = (await c.query(`SELECT id, row_no, payload, status, committed_student_id FROM app.migration_rows
                                   WHERE source_id=$1 AND (status='staged' OR (status='ok' AND committed_student_id IS NOT NULL))
                                   ORDER BY row_no`, [src.id])).rows;
      let created = 0; let skipped = 0;
      for (const row of rows) {
        if (row.status === 'ok' && row.committed_student_id) { skipped += 1; continue; }
        const d = row.payload ?? {};
        const admissionNo = d.admissionNo ? String(d.admissionNo).trim() : `MIG-${String(src.id).slice(0, 8).toUpperCase()}-${row.row_no}`;
        const s = await c.query(
          `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone, status, source, source_ref)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'active','migration',$8)
           ON CONFLICT (tenant_id, admission_no) DO NOTHING RETURNING id`,
          [req.user.tenant_id, admissionNo, String(d.name).trim(), String(d.grade).trim(), String(d.section).trim(),
           d.guardianName ? String(d.guardianName).trim() : null, d.guardianPhone ? String(d.guardianPhone).trim() : null,
           `mig:${src.id}:${row.row_no}`]);
        if (!s.rows[0]) return bad(reply, `row ${row.row_no}: admission number ${admissionNo} already belongs to another student`, 409);
        const studentId = s.rows[0].id;
        if (d.guardianName && d.guardianPhone) {
          await c.query(`INSERT INTO app.guardians (tenant_id, student_id, name, phone) VALUES ($1,$2,$3,$4)`,
            [req.user.tenant_id, studentId, String(d.guardianName).trim(), String(d.guardianPhone).trim()]);
        }
        for (const [i, f] of (Array.isArray(d.fees) ? d.fees : []).entries()) {
          const paid = f.paidCents ?? 0;
          const status = paid >= f.amountCents ? 'paid' : (paid > 0 ? 'partial' : 'open');
          await c.query(
            `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, paid_cents, status, source_ref)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [req.user.tenant_id, studentId, String(f.term).trim(), String(f.label).trim(), f.dueOn ?? null, f.amountCents, paid, status, `mig:${src.id}:${row.row_no}:fee:${i}`]);
        }
        await c.query(`UPDATE app.migration_rows SET status='ok', committed_student_id=$2 WHERE id=$1`, [row.id, studentId]);
        created += 1;
      }
      const imported = (await c.query(`SELECT count(*)::int n FROM app.migration_rows WHERE source_id=$1 AND status='ok'`, [src.id])).rows[0].n;
      // the ONLY path that sets 'verified'
      await c.query(`UPDATE app.migration_sources SET imported=$2, skipped=$3, status='verified', flagged=0 WHERE id=$1`, [src.id, imported, skipped]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Committed migration import', recordType: 'Migration', recordRef: src.name, policyRef: 'Migration §1.1', risk: 'high', outcome: `${created} students created · ${skipped} already present (idempotent replay) · source verified` });
      await emitEvent(c, req.user.tenant_id, { type: 'migration', label: `Migration committed — ${created} students imported from ${src.name}`, ref: src.id });
      return { created, skipped, imported, status: 'verified' };
    });
  });

  app.post('/migration/activate', { preHandler: require('owner','principal') }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const src = await c.query(`SELECT * FROM app.migration_sources`);
      // L1-4.1: no trust receipt without a committed import — 'verified' is set
      // by the commit door only, so a verified source with imported>0 must exist.
      const verified = src.rows.filter((s) => s.status === 'verified' && s.imported > 0);
      if (verified.length === 0) return bad(reply, 'nothing to activate — commit an import (a verified source with imported records) first', 409);
      const totalRows = src.rows.reduce((a, s) => a + s.row_count, 0);
      const imported = src.rows.reduce((a, s) => a + s.imported, 0);
      const flagged = src.rows.reduce((a, s) => a + s.flagged, 0);
      const feeTotal = (await c.query(`SELECT COALESCE(SUM(amount_cents),0)::bigint AS t FROM app.fee_obligations`)).rows[0].t;
      const paidTotal = (await c.query(`SELECT COALESCE(SUM(paid_cents),0)::bigint AS t FROM app.fee_obligations`)).rows[0].t;
      await c.query(`UPDATE app.migration_sources SET status='activated' WHERE status='verified' AND imported > 0`);
      await emitEvent(c, req.user.tenant_id, { type: 'migration', label: `Trust receipt issued — ${imported}/${totalRows} records source-linked · ${flagged} flags resolved`, severity: 'info' }, 'migration.activated', { totalRows, imported, flagged });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Issued trust receipt (migration verified)', recordType: 'Migration', recordRef: `TR-${Date.now().toString(36).toUpperCase()}`, reason: 'import committed · fix queue cleared', policyRef: 'Migration §1.1', risk: 'medium', outcome: `${imported} imported · ${flagged} flagged · fee ledger ₹${Number(feeTotal)/100} / paid ₹${Number(paidTotal)/100}` });
      return {
        trustReceipt: { totalRows, imported, flagged, skipped: totalRows - imported - flagged, feeTotalCents: feeTotal, feePaidCents: paidTotal, differenceCents: (BigInt(feeTotal) - BigInt(paidTotal)).toString(), rollbackDays: 30 },
        sources: src.rows,
      };
    });
  });
}
