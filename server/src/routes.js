// Domain routes — every request runs as the RLS-constrained app role with the
// caller's tenant + role in session. Mutations write the audit ledger.
import { randomUUID } from 'node:crypto';
import { linkLineage, requestAudit } from './audit.js';
import { ensurePluginCatalog } from './plugin-catalog.js';
import { isSecretKey, canonicalSchema, validateSettingsAgainstSchema } from './settings-contract.js';
import { checkEventBudget } from './governance.js';
import { q, sysq } from './db.js';
import { uuidParams } from './plugins/_shared/uuid-param.js';
import { toE164 } from './plugins/_shared/phone.js';
import { customRoles, canReach } from './custom-roles.js';
import { reachableDoors, capabilitiesFor } from './effective-access.js';
import { istNow, istToday } from './ist.js';
import { decryptSettings, encryptSettings, maskSettings } from './settings-crypto.js';
import { planIncludes, PLUGIN_PLAN } from './entitlements.js';
import { enabledCapability } from './plugin-capabilities.js';

const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

export function pageParams(query = {}, { defaultLimit = 100, maxLimit = 500 } = {}) {
  const rawLimit = query.limit == null || query.limit === '' ? defaultLimit : Number(query.limit);
  const rawOffset = query.offset == null || query.offset === '' ? 0 : Number(query.offset);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit;
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  return { limit, offset };
}

// PLG-2: manifests use a deliberately small semver range dialect. Reject
// unknown range syntax rather than silently accepting an incompatible plugin.
export const KERNEL_VERSION = '1.0.0';
const semverTuple = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '').trim());
  return m ? m.slice(1).map(Number) : null;
};
const semverCmp = (a, b) => {
  const x = semverTuple(a), y = semverTuple(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
};
export const kernelSatisfies = (range) => {
  if (!range) return true;
  return String(range).trim().split(/\s+/).filter(Boolean).every((clause) => {
    const m = /^(>=|<=|>|<|=)?v?(\d+\.\d+\.\d+)$/.exec(clause);
    if (!m) return false;
    const c = semverCmp(KERNEL_VERSION, m[2]);
    if (c === null) return false;
    return ({ '>': c > 0, '>=': c >= 0, '<': c < 0, '<=': c <= 0, '=': c === 0, undefined: c === 0 })[m[1]];
  });
};
export const dependencySpec = (value) => {
  const m = /^([a-z][a-z0-9.-]{2,63})@v?(\d+\.\d+\.\d+)$/.exec(String(value ?? '').trim());
  return m ? { id: m[1], version: m[2] } : null;
};

// ── PRD-17 · resolving a notice's real recipients ────────────────────────────────────────────────
// A notice action describes its audience in HUMAN words — "guardians", "Route 7 guardians". The decide
// executor used to insert that label as the audience and stamp the row `status='delivered'` with
// `sent_at`/`delivered_at = now()`, then emit "Parent notice SENT", while nothing was sent and nothing
// could be: `scripts/comms-dispatcher.js` resolves recipients from phone numbers, and a label is not one.
// `delivered` is also the strongest claim the schema makes — the dispatcher itself only ever sets
// `sent_at`. So approving a notice recorded a delivery to the whole audience that never happened.
//
// Recipients are now resolved from MACHINE-READABLE identifiers, and a notice that cannot be addressed
// says so out loud instead of being recorded as delivered. Deliberately NOT resolving the bare word
// "guardians" to every guardian in the school: a clinic notice reads "was sent home", so tenant-wide
// fan-out would tell every parent about one child. A label is not a selector.
//
// No cap here on purpose: the dispatcher owns the one decision about what audience is too large
// (`COMMS_MAX_RECIPIENTS`) and refuses rather than truncating. Capping in two places would let the
// queue quietly hold fewer recipients than the notice was approved for.
const UUID_RE_NOTICE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// RTE-8/9: query/body values were interpolated into `::uuid`/`::date` casts and malformed input reached
// Postgres as 22P02/22007 → a raw 500 (`?studentId=abc`, `?since=foo`, `?date=2026/01/01`). Validate first.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* PRD-2 — the class-ownership check the attendance door performs for a teacher.
 *
 * It reads the STUDENTS being marked and requires every one of them to sit in a class the caller owns. The
 * obvious cheaper implementation — trust the `grade`/`section` carried in the request payload — is exactly
 * wrong: a client asserting "this mark is for 8A" while sending another class's student ids is the attack the
 * check exists to stop, so the class of record is derived from the student rows, server-side, and the request
 * payload's opinion is never consulted.
 *
 * Rows that are not visible are reported separately from rows in the wrong class, because PostgreSQL's RLS
 * makes a cross-tenant or non-existent id indistinguishable from a typo — and saying "wrong class" about a
 * student the caller cannot see would leak that the id exists.
 */
export async function assertTeacherOwnsClasses(c, user, ownedClasses, marks) {
  const owned = new Set(ownedClasses.map((r) => `${r.grade}||${r.section}`));
  const ids = [...new Set(marks.map((m) => m.studentId))];
  const rows = (await c.query(
    `SELECT id, grade, section FROM app.students WHERE tenant_id=$1 AND id = ANY($2::uuid[])`,
    [user.tenant_id, ids])).rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    return { error: `No such student in this school: ${missing.length} of the submitted id(s) could not be found.` };
  }
  const foreign = rows.filter((r) => !owned.has(`${r.grade}||${r.section}`));
  if (foreign.length) {
    const classes = [...new Set(foreign.map((r) => `${r.grade}-${r.section}`))].sort().join(', ');
    const mine = [...owned].map((k) => k.replace('||', '-')).sort().join(', ');
    return { error: `You can only mark the register for your own class(es) — this submission includes ${foreign.length} student(s) from ${classes}. Your class(es): ${mine}.` };
  }
  return { ok: true };
}

export async function resolveNoticeRecipients(c, tenantId, p) {
  const explicit = Array.isArray(p?.recipients) ? p.recipients.map(toE164).filter(Boolean) : [];
  if (explicit.length) return [...new Set(explicit)];
  const ids = [...(Array.isArray(p?.studentIds) ? p.studentIds : []), ...(p?.studentId ? [p.studentId] : [])]
    .filter((v) => UUID_RE_NOTICE.test(String(v)));
  if (ids.length) {
    const r = await c.query(
      `SELECT DISTINCT g.phone FROM app.guardians g
        WHERE g.tenant_id=$1 AND g.student_id = ANY($2::uuid[]) AND g.phone IS NOT NULL`,
      [tenantId, ids]);
    return [...new Set(r.rows.map((x) => toE164(x.phone)).filter(Boolean))];
  }
  // transport notices name a bus route; the roster is students.bus_route
  if (p?.routeCode) {
    const r = await c.query(
      `SELECT DISTINCT g.phone FROM app.guardians g JOIN app.students s ON s.id = g.student_id
        WHERE g.tenant_id=$1 AND s.bus_route=$2 AND g.phone IS NOT NULL`,
      [tenantId, String(p.routeCode)]);
    return [...new Set(r.rows.map((x) => toE164(x.phone)).filter(Boolean))];
  }
  return [];
}

export function registerRoutes(app, { withUser, auditLog, emitEvent, ROLES }) {

  // Item 14 / RBAC-1: the route registry MUST be installed before ANY route is registered,
  // including the first `GET /me`. The `onRoute` hook used to be added ~120 lines in, so every
  // door declared above it (`GET /me`) never entered `registeredRoutes` — and a `SURFACE_DOOR`
  // entry mapping `/account/password` to `GET /me` then failed the drift guard in
  // `me-effective.test.js`. Registering it first makes "every registered route" true again.
  // every registered route is recorded here so a mask pattern is validated against
  // REAL doors — a typo can never silently grant (or refuse) nothing.
  const registeredRoutes = new Set();
  // RBAC-1 (PERFECT-100 §5.1/§5.2): door → the roles its kernel gate admits (null =
  // no role gate). Captured from the live registry so a custom-role mask can be
  // checked against the AUTHOR's real authority: a non-owner role-admin must not be
  // able to mint authority it does not itself hold. Both gate factories stamp
  // `__gateRoles`, so core doors and plugin doors are covered identically.
  const doorRoles = new Map();
  app.addHook('onRoute', (route) => {
    if (!route?.url) return;
    const pre = route.preHandler;
    const chain = Array.isArray(pre) ? pre : (pre ? [pre] : []);
    const gate = chain.find((h) => typeof h === 'function' && Array.isArray(h.__gateRoles));
    const roles = gate ? gate.__gateRoles : null;
    for (const m of (route.method || 'GET').split(',').map((x) => x.trim())) {
      if (m === 'HEAD' || m === 'OPTIONS') continue;
      registeredRoutes.add(`${m} ${route.url}`);
      doorRoles.set(`${m} ${route.url}`, roles);
    }
  });

  const require = (...roles) => {
    const gate = async (req, reply) => {
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
    // RBAC-1: stamped so the onRoute hook can record this door's real role gate, which
    // is what makes the custom-role amplification ceiling possible.
    gate.__gateRoles = roles;
    return gate;
  };

  const me = async (req, reply) => {
    await app.authenticate(req, reply);
    if (reply.sent) return;
    await applyCustomMask(req, reply); // read doors honour a deny too
  };
  // `me` is intentionally broad for self-service doors. Sensitive list doors
  // additionally publish their real role set to the route registry so custom
  // role authoring cannot grant a door whose author could not reach it.
  const roleGatedMe = (...roles) => {
    const gate = async (req, reply) => {
      await me(req, reply);
      if (reply.sent) return;
      if (!roles.includes(req.user.role) && !cr.allows(req)) {
        return reply.code(403).send({ error: `Your role (${req.user.role}) doesn't allow this action` });
      }
    };
    gate.__gateRoles = roles;
    return gate;
  };

  // ============ me / demo users ============
  app.get('/me', { preHandler: me }, async (req) => {
    const u = req.user;
    // School identity rides every session (frontend header + title). The
    // tenant's own row is the truth; a fresh self-signup school shows ITS name.
    const t = await sysq(`SELECT name, slug FROM app.tenants WHERE id=$1`, [u.tenant_id]);
    // D-37(d): mfa_enrolled_at is the only MFA fact /me exposes (the Settings
    // UI renders "Turn off two-step" from it); secrets stay kernel-only.
    // RBAC-3/RBAC-6: the caller's OWN custom-role binding and mask ride /me. The client cannot be the
    // enforcement point, but it must be able to tell which controls to RENDER — the shipped "Librarian"
    // preset is a teacher-based custom role, so `/me` reported `role:'teacher'` and the library screen
    // (LibraryLive.tsx `isStaff = ['owner','principal','coordinator','facilities']`) showed the module
    // title with none of its controls, even though every door authorised the librarian. Surfacing a
    // user's own permissions to that user is not a disclosure; it is what makes the granted UI reachable.
    // These fields are display hints only — every door still re-decides on the server.
    const custom = await cr.maskInfo(req.user, sysq);
    return { id: u.id, name: u.name, role: u.role, email: u.email, tenantId: u.tenant_id,
      mfa_enrolled_at: u.mfa_enrolled_at ?? null,
      role_key: custom?.key ?? null,
      custom: custom ? { allow: custom.allow, deny: custom.deny } : null,
      school: { name: t.rows[0]?.name ?? null, slug: t.rows[0]?.slug ?? null } };
  });

  // ============ effective access (PERFECT-100 §6.2 item 14 · RBAC-6 · FE-2) ============
  // The client may not invent a permission model. This door answers, from the SAME registry the gates
  // enforce (`registeredRoutes` / `doorRoles`) plus the caller's own custom mask, which user-facing
  // surfaces the caller may render. It is a RENDER hint only — every door still re-decides per request.
  // `scope.classes` is a teacher's form-classes (empty for every other role), the same data the
  // class-of-record checks read (PRD-2). Routing decisions never come from the client's list here.
  app.get('/me/effective', { preHandler: me }, async (req) => {
    const custom = await cr.maskInfo(req.user, sysq);
    const mask = custom ? { allow: custom.allow, deny: custom.deny } : null;
    const doors = reachableDoors({
      role: req.user.role, mask, doorRoles, registeredRoutes, maskDecides: cr.maskDecides,
    });
    const capabilities = capabilitiesFor(doors);
    const nav = Object.keys(capabilities).filter((k) => capabilities[k]);
    // `app.class_assignments` arrives with migration 083; a database without it (or a non-teacher) has
    // no classes — an empty scope, never a fabricated one.
    const classes = await withUser(req.user.tenant_id, req.user.role, async (c) =>
      (await c.query(
        `SELECT grade, section FROM app.class_assignments
          WHERE tenant_id=$1 AND teacher_id=$2 AND active ORDER BY grade, section`,
        [req.user.tenant_id, req.user.id])).rows).catch(() => []);
    return {
      role: req.user.role,
      base_role: req.user.role,
      role_key: custom?.key ?? null,
      custom: custom ? { allow: custom.allow, deny: custom.deny } : null,
      scope: { classes },
      capabilities,
      nav,
      doors,
    };
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
  // Custom-role enforcement lives in ONE place so the kernel gate and the plugin gate cannot drift
  // (RBAC-1). Everything below is a thin binding of the shared module to this file's `sysq`/`withUser`.
  // ONE shared instance (see src/custom-roles.js): a per-module instance would keep its own binding cache
  // and a role assignment cleared in one would keep answering from the other.
  const cr = customRoles;
  const rolesAvailable = () => cr.rolesAvailable(sysq);

  // RBAC-1: the wildcard METHOD is gone. It was the mechanism of the grant-all hole:
  // `* /*` validated successfully because `*` matches every door's method and `/*`
  // prefix-matches every door's path, producing a role indistinguishable from the
  // owner — and an `allow` mask lifts base-role refusals. No pattern in the repo
  // (including the shipped Librarian preset) uses a wildcard method, so nothing
  // legitimate is lost; masks must now name a real HTTP method.
  const MASK_RE = /^(GET|POST|PATCH|PUT|DELETE)\s+\/[^\s]{0,118}$/;
  // returned instead of null so the door can explain an amplification refusal honestly
  // rather than reusing the "that pattern matches no real screen" copy, which would be
  // a lie in this case.
  const MASK_AMP = Symbol('mask-amplification');
  const validateMask = (perms, authorRole) => {
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
        // RBAC-1: no grant-all. A bare root or root-prefix path covers every door.
        if (pp === '/' || pp === '/*') return null;
        const hit = [...registeredRoutes].some((r) => {
          const [rm, ru] = [r.slice(0, r.indexOf(' ')), r.slice(r.indexOf(' ') + 1)];
          if (pm !== rm) return false;
          if (pp.endsWith('*')) return ru.startsWith(pp.slice(0, -1));
          return ru === pp || ru.startsWith(pp + '/');
        });
        if (!hit) return null;
        // RBAC-1 ceiling: an `allow` pattern may only cover doors the AUTHOR can already
        // reach. The owner is the tenant's authority-granting principal and may grant
        // anything; any other role-admin (itadmin) is capped at its own reach. This is
        // what makes "create a role, assign it to yourself, become owner-equivalent"
        // impossible even by enumerating doors instead of using a wildcard.
        // `deny` is exempt — restricting is never amplification.
        if (kind === 'allow' && authorRole && authorRole !== 'owner') {
          for (const [door, grantRoles] of doorRoles) {
            const sp = door.indexOf(' ');
            if (!patternMatches(p, door.slice(0, sp), door.slice(sp + 1))) continue;
            if (grantRoles && !grantRoles.includes(authorRole)) return MASK_AMP;
          }
        }
      }
      out[kind] = list;
    }
    return out;
  };
  // validateMask (the route-registry half: pattern legality + the amplification ceiling against the
  // live registry) stays in this file — only the kernel knows the registered routes. ENFORCEMENT is
  // shared with the plugin gate: see src/custom-roles.js.
  const patternMatches = cr.patternMatches;   // used by validateMask, which stays in this file
  const applyCustomMask = (req, reply) => cr.applyMask(req, reply, sysq);
  // a role assignment must take effect at once rather than after the 30s binding TTL
  const forgetBinding = (userId) => cr.forgetBinding(userId);

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
    const mask = validateMask(b.permissions, req.user.role);
    if (mask === MASK_AMP) return reply.code(403).send({ error: `A custom role can only grant doors your own role (${req.user.role}) can already reach. Ask the owner to create this role. Nothing was saved.` });
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
        mask = validateMask(b.permissions, req.user.role);
        if (mask === MASK_AMP) return reply.code(403).send({ error: `A custom role can only grant doors your own role (${req.user.role}) can already reach. Ask the owner. Nothing was changed.` });
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
      for (const id of userIds) forgetBinding(id);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Custom role assigned', recordType: 'Role', recordRef: req.params.key, policyRef: 'Custom roles (L3-4.2)', risk: 'high', outcome: `${r.rowCount} account(s) now carry "${req.params.key}" (base ${role.base_role} + mask)` });
      return { ok: true, assigned: r.rowCount };
    });
  });

  app.post('/roles/:key/unassign', { preHandler: require(...ROLES_ADMIN) }, async (req, reply) => {
    if (!(await rolesAvailable())) return reply.code(503).send({ error: 'Custom roles need the roles store (migration 061 by L1) — not on this database yet' });
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
    // RTE-13: `assign` caps at 200 but `unassign` did not — a caller could send an unbounded array.
    if (!userIds.length || userIds.length > 200) return bad(reply, 'Send userIds (1-200 accounts)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`UPDATE app.users SET role_key=NULL WHERE tenant_id=$1 AND id = ANY($2::uuid[]) AND role_key=$3`, [req.user.tenant_id, userIds, req.params.key]);
      for (const id of userIds) forgetBinding(id);
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
    if (req.user.role === 'student' && !canReach(req, STAFF_ROSTER_ROLES)) return bad(reply, 'Your student desk shows your own records — the school roster is staff-only', 403);
    if (req.user.role === 'api' && !req.apiScopes?.includes('students.read')) return bad(reply, 'API key lacks the students.read scope', 403);
    const { grade, section, search } = req.query;
    const { limit, offset } = pageParams(req.query);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // RTR-001 RT-005: parents are scoped to their own child via the guardian record;
      // teachers/technicians get the roster WITHOUT guardian contact details.
      const showPhones = STAFF_ROSTER.has(req.user.role); // machine identities never receive guardian phones
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
        [grade ?? null, section ?? null, search ?? null, limit, offset,
         req.user.role === 'parent' ? req.user.id : null]);
      for (const row of r.rows) if (!showPhones) delete row.guardian_phone;
      return { students: r.rows };
    });
  });

  app.get('/students/:id', { preHandler: [me, uuidParams('id')] }, async (req, reply) => {
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
  // SEC-3 (PERFECT-100 §5.1): only `parent` was scoped below, so a STUDENT fell through
  // to the whole-school query and read every pupil's admission_no, name, grade, section
  // and daily status (LIMIT 2000). The sibling roster doors already refuse students at
  // :286 and :317, so this was an inconsistency rather than a policy — and it is the
  // same class of leak as API-1. Parents keep their own-children scope immediately below.
  app.get('/attendance', { preHandler: me }, async (req, reply) => {
    if (req.user.role === 'student' && !canReach(req, STAFF_ROSTER_ROLES)) {
      return bad(reply, 'The school-wide register is staff-only. Ask the school office for your own attendance record.', 403);
    }
    if (req.user.role === 'api' && !req.apiScopes?.includes('attendance.read')) return bad(reply, 'API key lacks the attendance.read scope', 403);
    const { date = IST_TODAY(), grade, section } = req.query;
    if (!DATE_RE.test(String(date))) return bad(reply, 'date must be YYYY-MM-DD');
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
    const { date = IST_TODAY(), marks } = req.body ?? {};
    if (!Array.isArray(marks) || marks.length === 0) return bad(reply, 'marks[] required (studentId, status)');
    if (marks.length > 300) return bad(reply, 'A register submission is limited to 300 students. Split the class and try again.', 413);
    const valid = ['present','absent','late','leave'];
    if (marks.some(m => !m || typeof m !== 'object' || !UUID_RE_NOTICE.test(String(m.studentId ?? '')) || !valid.includes(m.status))) return bad(reply, 'invalid marks payload');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // T105c (§7.3 P1-7) → PRD-2: marking is bound to class ownership. This block used to refuse every
      // non-principal role outright, and said why: the only assignment-shaped surfaces that existed
      // (`app.timetable_slots` / `app.timetable_substitutions`, migration 021) carry `teacher_name` but no
      // grade/section binding, so no query could answer "which classes does this teacher own". Asserting the
      // authority without the data was the documented reason for the blanket 403 — so the fix was to create
      // the data (migration 083), not to relax the check.
      //
      // The fallback is now the PRINCIPAL'S OFFICE ONLY (owner/principal/coordinator), and it is recorded as
      // such in the audit outcome. A teacher is authorised by an `app.class_assignments` row for the class
      // they are marking — nothing else, and never by name text.
      const isOffice = ['owner', 'principal', 'coordinator'].includes(req.user.role);
      let ownedClasses = null;
      if (!isOffice) {
        ownedClasses = (await c.query(
          `SELECT grade, section FROM app.class_assignments
            WHERE tenant_id=$1 AND teacher_id=$2 AND active`, [req.user.tenant_id, req.user.id])).rows;
        if (ownedClasses.length === 0) {
          return bad(reply, 'No class is assigned to you yet, so the register can only be marked by the principal\'s office. Ask an administrator to assign you a class.', 403);
        }
        const cap = await assertTeacherOwnsClasses(c, req.user, ownedClasses, marks);
        if (cap.error) return bad(reply, cap.error, 403);
      }
      /* DAT-6: read the register BEFORE writing, so the audit can say what changed rather than what happened.
         One query for the whole class keeps this O(1) in round trips. */
      const priorRows = (await c.query(
        `SELECT student_id, status FROM app.attendance
          WHERE tenant_id=$1 AND school_date=$2::date AND student_id = ANY($3::uuid[])`,
        [req.user.tenant_id, date, marks.map((m) => m.studentId)])).rows;
      const was = new Map(priorRows.map((r) => [r.student_id, r.status]));
      const upserts = [];
      for (const m of marks) {
        upserts.push(c.query(
          `INSERT INTO app.attendance (tenant_id, student_id, school_date, status, marked_by)
           VALUES ($1,$2,$3::date,$4,$5)
           ON CONFLICT (tenant_id, student_id, school_date) DO UPDATE SET status=EXCLUDED.status, marked_by=EXCLUDED.marked_by, marked_at=now()`,
          [req.user.tenant_id, m.studentId, date, m.status, req.user.id]));
      }
      await Promise.all(upserts);

      /* DAT-6: this door used to leave ONE audit row saying "Marked attendance · N students on <date>" — a
         COUNT, which cannot answer the question a school is audited on: who was changed, from what to what, by
         whom. One row per student whose status actually changed. A re-submit that changes nothing is not a
         mutation and is not recorded as one, so the ledger stays a record of acts rather than of clicks. */
      for (const m of marks) {
        const from = was.get(m.studentId) ?? null;
        if (from === m.status) continue;
        await auditLog(c, req.user.tenant_id, {
          actor: req.user.name,
          actorRole: req.user.role,
          action: from
            ? `Attendance for ${m.studentId} on ${date}: ${from} → ${m.status}`
            : `Attendance for ${m.studentId} on ${date}: recorded ${m.status}`,
          recordType: 'Attendance',
          recordRef: m.studentId,
          // T105c/PRD-2: the authority applied is stamped, not inferred from the actor's role —
          // "principal office" (owner/principal/coordinator fallback) vs a teacher's class assignment.
          outcome: isOffice ? 'principal office' : 'class assignment',
        });
      }

      const absents = marks.filter(m => m.status === 'absent');
      // RTE-16: notify only students whose status CHANGED to absent. A re-submit of an already-absent
      // student used to queue the guardian another absence notice on every save, and the per-change audit
      // rows above already record the act — so a separate summary row was a duplicate.
      const newlyAbsent = absents.filter((m) => was.get(m.studentId) !== 'absent');
      // Policy: Attendance §1.1 — guardians informed of NEW absences automatically.
      if (newlyAbsent.length) {
        await emitEvent(c, req.user.tenant_id,
          { type: 'attendance', label: `attendance.marked — ${marks.length} students on ${date} · ${newlyAbsent.length} newly absent`, severity: newlyAbsent.length > 2 ? 'warn' : 'info' },
          'attendance.absences', { date, absentCount: newlyAbsent.length });
        const info = await c.query(
          `SELECT s.name, g.phone FROM app.students s JOIN app.guardians g ON g.student_id = s.id
           WHERE s.id = ANY($1::uuid[]) AND g.is_primary`, [newlyAbsent.map(m => m.studentId)]);
        for (const g of info.rows) {
          await c.query(
            `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, policy_ref, dedup_key)
             VALUES ($1, $2::jsonb, 'whatsapp', 'ABSENCE_NOTICE', $3, 'Attendance §1.1', $4)`,
            [req.user.tenant_id, JSON.stringify([g.phone]), `Absence notice for ${g.name} (${date}) — please confirm.`, randomUUID()]);
        }
      }
      return { ok: true, marked: marks.length, absent: absents.length, noticesQueued: newlyAbsent.length };
    });
  });

  // ============ class assignments (PRD-2) ============
  // Who owns which register. Without this the attendance door above could only answer 403 to every teacher,
  // and this pair of doors is what makes a school able to run its own daily workflow instead of routing every
  // class through the principal's office. Assignment is an ADMINISTRATIVE act (principal office) — a teacher
  // must not be able to grant themselves a class, which is the whole authority being delegated.
  app.get('/class-assignments', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const isOffice = ['owner', 'principal', 'coordinator', 'itadmin'].includes(req.user.role);
      const r = await c.query(
        `SELECT a.id, a.teacher_id, u.name AS teacher_name, a.grade, a.section, a.created_at
           FROM app.class_assignments a JOIN app.users u ON u.id = a.teacher_id AND u.tenant_id = a.tenant_id
          WHERE a.active ${isOffice ? '' : 'AND a.teacher_id = $1'}
          ORDER BY a.grade, a.section`,
        isOffice ? [] : [req.user.id]);
      return { assignments: r.rows, scoped: isOffice ? 'school' : 'own_classes' };
    });
  });

  app.post('/class-assignments', { preHandler: require('owner','principal','coordinator') }, async (req, reply) => {
    const { teacherId, grade, section } = req.body ?? {};
    if (!teacherId || !grade || !section) return bad(reply, 'teacherId, grade and section are required');
    const g = String(grade).trim().slice(0, 8);
    const sec = String(section).trim().slice(0, 8);
    if (!g || !sec) return bad(reply, 'grade and section cannot be blank');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // The teacher must be a teacher in THIS tenant. The composite FK would already refuse a foreign tenant,
      // but a bad role would otherwise be accepted silently — an assignment to a student or a parent account
      // is not a class owner, it is a mistake that would take a term to notice.
      const t = (await c.query(
        `SELECT id, name FROM app.users WHERE tenant_id=$1 AND id=$2 AND role='teacher'`,
        [req.user.tenant_id, teacherId])).rows[0];
      if (!t) return bad(reply, 'That user is not a teacher in this school', 404);
      // One owner per class (partial unique index 083). Retire any current holder rather than failing, so the
      // door does the handover the school actually means, and audit it as a change of holder.
      const prior = (await c.query(
        `SELECT a.id, u.name FROM app.class_assignments a JOIN app.users u ON u.id = a.teacher_id
          WHERE a.tenant_id=$1 AND a.grade=$2 AND a.section=$3 AND a.active`,
        [req.user.tenant_id, g, sec])).rows[0];
      if (prior) {
        await c.query(`UPDATE app.class_assignments SET active=false WHERE id=$1 AND tenant_id=$2`, [prior.id, req.user.tenant_id]);
        await auditLog(c, req.user.tenant_id, {
          actor: req.user.name, actorRole: req.user.role,
          action: `Class ${g}-${sec} reassigned from ${prior.name} to ${t.name}`,
          recordType: 'ClassAssignment', recordRef: prior.id, reason: 'form-teacher handover',
          policyRef: 'PRD-2 class ownership', outcome: 'previous assignment retired',
        });
      }
      const row = (await c.query(
        `INSERT INTO app.class_assignments (tenant_id, teacher_id, grade, section, assigned_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, teacher_id, grade, section`,
        [req.user.tenant_id, t.id, g, sec, req.user.id])).rows[0];
      await auditLog(c, req.user.tenant_id, {
        actor: req.user.name, actorRole: req.user.role,
        action: `Class ${g}-${sec} assigned to ${t.name}`, recordType: 'ClassAssignment', recordRef: row.id,
        reason: 'form-teacher assignment', policyRef: 'PRD-2 class ownership',
        outcome: `register for ${g}-${sec} is now markable by ${t.name}`,
      });
      return { ok: true, assignmentId: row.id };
    });
  });

  app.delete('/class-assignments/:id', { preHandler: [require('owner','principal','coordinator'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // Soft-retire, never DELETE: the row is the record of who held the register, and the unique index is
      // partial on `active` precisely so this history can survive.
      const r = await c.query(
        `UPDATE app.class_assignments SET active=false WHERE id=$1 AND tenant_id=$2 AND active RETURNING id`,
        [req.params.id, req.user.tenant_id]);
      if (r.rowCount !== 1) return bad(reply, 'No active assignment with that id', 404);
      await auditLog(c, req.user.tenant_id, {
        actor: req.user.name, actorRole: req.user.role, action: 'Class assignment retired',
        recordType: 'ClassAssignment', recordRef: req.params.id, reason: 'assignment removed',
        policyRef: 'PRD-2 class ownership', outcome: 'register reverts to the principal office for that class',
      });
      return { ok: true };
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

  app.post('/academic-years/:id/activate', { preHandler: [require('owner', 'principal'), uuidParams('id')] }, async (req, reply) => {
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
// RTE-14: the staff roster/register role set, used through `canReach` so a custom-role ALLOW is consulted
// (a raw `req.user.role === 'student'` refusal ignored the mask and made the feature unreachable there).
const STAFF_ROSTER_ROLES = ['owner', 'principal', 'itadmin', 'finance', 'coordinator', 'counselor', 'teacher', 'admissions', 'transport', 'facilities', 'technician'];
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

  // RTE-11: a `me`-only read exposed every tenant-wide fee-plan template to any role (parent/student
  // included), whose mutations are owner/finance-gated. Staff/admin gate.
  app.get('/fee-plans', { preHandler: roleGatedMe('owner','principal','finance','coordinator','itadmin') }, async (req) => {
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

  app.post('/fee-plans/:id/generate', { preHandler: [require('owner', 'principal', 'finance'), uuidParams('id')] }, async (req, reply) => {
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

  app.post('/fees/obligations/:id/void', { preHandler: [require('owner'), uuidParams('id')] }, async (req, reply) => {
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
  // SEC-5: roles that legitimately work the school-wide fee ledger. Narrower than
  // STAFF_CASE_ROLES on purpose (no teacher, no admissions) — this is financial data about
  // children, and neither role has a fee mandate in the shipped product.
  const FEE_LEDGER_ROLES = new Set(['owner', 'principal', 'itadmin', 'finance', 'coordinator']);
  app.get('/fees/obligations', { preHandler: roleGatedMe('owner','principal','itadmin','finance','coordinator','parent') }, async (req, reply) => {
    const { studentId, status } = req.query;
    if (studentId != null && !UUID_RE_NOTICE.test(String(studentId))) return bad(reply, 'studentId must be a uuid');
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 500 });
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
           ORDER BY o.due_on NULLS LAST LIMIT $3 OFFSET $4`, [list, status ?? null, limit, offset]);
        return { obligations: r2.rows, scoped: 'own_children', limit, offset, hasMore: r2.rows.length === limit };
      }
      // SEC-5: the fallback below was reached by EVERY role that is not a parent, so a
      // student account received up to 500 obligations for the entire school — every
      // family's dues, with student names, grades and sections. The parent branch above is
      // structurally scoped (`family.child_link`); the unscoped branch had no gate at all.
      //
      // "student → own obligations only" (the audit's first preference) is NOT implementable
      // today: there is no link from a user account to a student record anywhere in the
      // schema. `app.users` has no student_id, and the only linkage tables (`app.guardians`,
      // `family.child_link`) are GUARDIAN links. Inventing one here would be a guess in a
      // money path, so this denies instead — a missing feature is better than a silent
      // whole-school disclosure. Building that link is Phase 2 (the organisation model).
      //
      // The allowlist is deliberately narrower than STAFF_CASE_ROLES: a teacher or an
      // admissions officer has no fee mandate, and this is financial data about children.
      // RBAC-1: a custom role explicitly granted this door is admitted — the mask grant is the whole
      // point of the custom-role feature, and refusing it here (as this door used to) made the feature
      // unusable for financial data while the mask claimed otherwise. `canReach` = built-in role OR the
      // mask's own ALLOW for this exact request. This is a PERMISSION check, so a grant may lift it;
      // the parent-scoping branch above is untouched because that one is about WHOSE rows these are.
      if (!canReach(req, [...FEE_LEDGER_ROLES])) {
        return reply.code(403).send({ error: 'The full fee ledger is for school staff. Families see their own dues under My fees.' });
      }
      const r = await c.query(
        `SELECT o.*, s.name AS student_name, s.grade, s.section
         FROM app.fee_obligations o JOIN app.students s ON s.id = o.student_id
         WHERE ($1::uuid IS NULL OR o.student_id=$1) AND ($2::text IS NULL OR o.status=$2)
         ORDER BY o.due_on NULLS LAST LIMIT $3 OFFSET $4`,
        [scope, status ?? null, limit, offset]);
      return { obligations: r.rows, limit, offset, hasMore: r.rows.length === limit };
    });
  });

  app.post('/fees/payments', { preHandler: require('parent','finance','owner','principal') }, async (req, reply) => {
    const { obligationId, method = 'upi' } = req.body ?? {};
    if (!obligationId) return bad(reply, 'obligationId required');
    const paymentMethod = String(method).toLowerCase();
    if (!['upi', 'razorpay', 'cash', 'card', 'cheque', 'netbanking', 'bank_transfer', 'manual'].includes(paymentMethod)) {
      return bad(reply, 'unsupported payment method');
    }
    const idempotencyKey = String(req.headers['idempotency-key'] ?? '').trim();
    if (idempotencyKey && (idempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey))) {
      return bad(reply, 'Idempotency-Key must be 1-128 letters, numbers, dots, underscores, colons or hyphens');
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (idempotencyKey) {
        const prior = await c.query(
          `SELECT * FROM app.payments WHERE tenant_id=$1 AND idempotency_key=$2 LIMIT 1`,
          [req.user.tenant_id, idempotencyKey]);
        if (prior.rows[0]) return { payment: prior.rows[0], already: true };
      }
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
      let p;
      try {
        p = await c.query(
          `INSERT INTO app.payments (tenant_id, student_id, obligation_id, amount_cents, method, status, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,'initiated',$6) RETURNING *`,
          [req.user.tenant_id, o.rows[0].student_id, obligationId, due.toString(), paymentMethod, idempotencyKey || null]);
      } catch (e) {
        if (e.code !== '23505' || !idempotencyKey) throw e;
        const prior = await c.query(`SELECT * FROM app.payments WHERE tenant_id=$1 AND idempotency_key=$2`, [req.user.tenant_id, idempotencyKey]);
        if (prior.rows[0]) return { payment: prior.rows[0], already: true };
        throw e;
      }
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `payment.initiated — ₹${Number(due)/100} (obligation ${o.rows[0].label})`, ref: p.rows[0].id });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Initiated payment', recordType: 'Payment', recordRef: p.rows[0].id, reason: `settle ${o.rows[0].label}`, outcome: 'initiated' });
      return { payment: p.rows[0] };
    });
  });

  app.post('/fees/payments/:id/confirm', { preHandler: [require('finance','owner'), uuidParams('id')] }, async (req, reply) => {
    const gatewayRef = req.body?.gatewayRef ?? `GATEWAY-${randomUUID().slice(0,8)}`;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const p = (await c.query(`SELECT * FROM app.payments WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!p) return bad(reply, 'payment not found', 404);
      if (p.status === 'confirmed') return { payment: p, already: true }; // idempotent
      if (p.status !== 'initiated') return bad(reply, `payment in status ${p.status}`, 409);
      // RTE-5: a VOIDED obligation must not be resurrected by confirming a still-initiated payment against
      // it. `void` refuses paid_cents>0, so a void obligation has no confirmed payment — but an initiated
      // one could be confirmed here afterwards and flip the obligation back to paid/partial. Refuse
      // BEFORE any mutation.
      const obl = (await c.query(`SELECT status FROM app.fee_obligations WHERE id=$1 FOR UPDATE`, [p.obligation_id])).rows[0];
      if (obl?.status === 'void') return bad(reply, 'the obligation was voided — a payment cannot be confirmed against it', 409);
      // SEC-8: `webhookVerified` was decided by REGEX-MATCHING THE CALLER'S OWN STRING —
      // `/^[A-Z0-9-]{10,}$/` — so any finance user could type `MANUAL-123456` into the confirm body and the audit
      // ledger would record "Confirmed payment (gateway webhook verified)". The claim the row depends on for its
      // money provenance was therefore a property of the STRING'S SHAPE, not of any gateway having spoken. The
      // refund path synthesised references the same way, so the pattern was also being manufactured internally.
      //
      // A reference is now verified only if the PROVIDER'S OWN RECORD contains it. `plugin_razorpay.order_log` is
      // written by the order-creation door with `razorpay_order_id` = the gateway's order id, and by the
      // signature-verified webhook with `razorpay_payment_id` = the id the gateway issued. So the lookup is the
      // evidence: a reference the caller invented matches nothing, and a reference the gateway issued is already
      // in the log before anyone types it. This is the `to_regclass` idiom because a deployment may not have the
      // plugin tables at all, and a missing table must mean "unverifiable" rather than a 500 on the money path.
      // The lookup runs inside `withUser`, so RLS scopes it to the caller's tenant — and it is additionally
      // joined to THIS payment row, so a genuine gateway reference belonging to a different payment cannot
      // launder this one.
      let verifiedBy = null;
      if (typeof gatewayRef === 'string' && gatewayRef.length > 0) {
        const ev = await c.query(
          `SELECT 1 FROM plugin_razorpay.order_log
            WHERE to_regclass('plugin_razorpay.order_log') IS NOT NULL
              AND payment_id = $1
              AND (razorpay_order_id = $2 OR razorpay_payment_id = $2)
            LIMIT 1`, [p.id, gatewayRef]).catch((e) => {
            // RTE-10: a transient DB error must NOT be swallowed — doing so relabelled the payment
            // "manual reconciliation (no gateway evidence)" when the evidence lookup had simply failed.
            // `42P01` is the only benign case (plugin table absent on a deployment without razorpay) and
            // `to_regclass` above already covers it; everything else propagates.
            if (e?.code === '42P01') return { rows: [] };
            throw e;
          });
        if (ev.rows[0]) verifiedBy = 'razorpay';
      }
      // Still permitted without evidence — a desk taking cash must be able to settle a payment — but it is
      // labELLED for what it is. The reference is still STORED even when unverified, and that is deliberate:
      // `app.payments` carries `CHECK (status <> 'confirmed' OR gateway_ref IS NOT NULL)`, so the schema itself
      // defines "confirmed" to require a reference and gives us nowhere to record the absence. Nulling it also
      // made the confirm fail with a raw 23514 on the money path. So the column records WHAT THE DESK TYPED and
      // `verifiedBy` records WHETHER A GATEWAY VOUCHED FOR IT — the distinction lives in the verification
      // method, which is exactly the thing that was a regex before. Pretending the column separates them would
      // be the same overclaim this fix exists to remove.
      const webhookVerified = verifiedBy !== null;
      const storedRef = gatewayRef;
      const confirmed = await c.query(
        `UPDATE app.payments SET status='confirmed', confirmed_at=now(), gateway_ref=$2, receipt_no=$3 WHERE id=$1 RETURNING *`,
        [p.id, storedRef, `RCP-${Date.now().toString(36).toUpperCase()}`]);
      // ledger: obligation paid_cents
      const o = await c.query(
        `UPDATE app.fee_obligations SET paid_cents = paid_cents + $2,
           status = CASE WHEN paid_cents + $2 >= amount_cents THEN 'paid' ELSE 'partial' END
         WHERE id=$1 AND status <> 'void' RETURNING *`, [p.obligation_id, p.amount_cents.toString()]);
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `payment.confirmed — ₹${Number(p.amount_cents)/100} · receipt ${confirmed.rows[0].receipt_no}`, ref: p.id });
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `reconciliation verified — ${o.rows[0].label} status ${o.rows[0].status}`, ref: o.rows[0].id });
      await c.query(
        `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, policy_ref)
         VALUES ($1, '[]'::jsonb, 'whatsapp', 'FEE_RECEIPT', $2, 'Fees §4.2')`,
        [req.user.tenant_id, `Receipt ${confirmed.rows[0].receipt_no} — ₹${Number(p.amount_cents)/100} received. Thank you.`]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: webhookVerified
          ? `Confirmed payment (gateway reference ${verifiedBy} verified against the provider's own record)`
          : 'Confirmed payment (manual reconciliation — no gateway evidence)', recordType: 'Payment', recordRef: `${confirmed.rows[0].receipt_no}`, reason: webhookVerified
            ? `gateway confirm — reference found in ${verifiedBy} log for this payment`
            : 'manual confirm — no gateway record for this reference; verify the statement', policyRef: 'Fees §4.2', outcome: `ledger updated · obligation ${o.rows[0].status}` });
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
    // RTE-18: unvalidated numeric input reached the integer column / the label; a string or a negative
    // value was a 500 or nonsense. Bound it.
    if (!Number.isInteger(delayMins) || delayMins < 0 || delayMins > 1440) return bad(reply, 'delayMins must be an integer 0..1440');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const route = (await c.query(`SELECT * FROM app.routes WHERE code=$1`, [routeCode])).rows[0];
      if (!route) return bad(reply, 'route not found', 404);
      // RTE-4: the provider and budget gates ran AFTER the INSERT, and `bad(...)`/`reply.code(...)` return
      // normally — so a rejected event was COMMITTED (withUser commits on return). Gate BEFORE the write.
      // PLG-10 (partial): the runtime plugin id was a THIRD spelling, `transport`, that has no module and no
      // catalog row — so this event's budget could never be charged to a plugin (PLG-7b) and no enable path
      // could create its row. It is now the real module id, `transport.gps`, matching the catalog and manifest.
      const transportProvider = await enabledCapability(sysq, req.user.tenant_id, 'transport.gps.ingest');
      if (!transportProvider) return bad(reply, 'Transport GPS is switched off — enable a transport provider first', 409);
      const gov = await checkEventBudget(c, req.user.tenant_id, transportProvider.plugin_id);
      if (!gov.allowed) { await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Event rejected by governance', recordType: 'Transport', recordRef: route.code, policyRef: 'Platform §10 (event budgets)', outcome: gov.code }); return reply.code(429).send({ error: gov.code, ...gov }); }
      const tev = await c.query(
        `INSERT INTO app.transport_events (tenant_id, route_id, kind, delay_mins, note) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.user.tenant_id, route.id, kind, delayMins, note ?? null]);
      const riders = (await c.query(`SELECT count(*)::int AS n FROM app.students WHERE bus_route=$1`, [routeCode])).rows[0].n;
      const ev = await emitEvent(c, req.user.tenant_id,
        { type: 'transport', label: `Bus ${routeCode} ${kind === 'gps_delay' ? `delayed +${delayMins} min` : kind} — ${riders} students affected`, severity: delayMins >= 10 ? 'warn' : 'info', ref: route.code },
        'transport.delay', { routeCode, delayMins, riders },
        { emittedBy: `plugin:${transportProvider.plugin_id}`, subject: `route:${routeCode}`, schemaVersion: 1 });
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
           JSON.stringify({ kind: 'message', audience: `${/^route\b/i.test(String(routeCode)) ? routeCode : `Route ${routeCode}`} guardians`, routeCode, audienceCount: riders, channel: 'WhatsApp', template: 'TRANSPORT_DELAY', draft: `Bus ${routeCode} is running approximately ${delayMins} minutes late today. Expected delay at each stop accordingly. — Transport Desk`, proposed_by: req.user.id, proposed_by_role: req.user.role })]);
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

  app.get('/work-orders', { preHandler: require('principal','owner','itadmin','finance','coordinator','facilities','technician','transport','teacher') }, async (req, reply) => {
    const { status, priority, assetId } = req.query;
    if (assetId != null && !UUID_RE_NOTICE.test(String(assetId))) return bad(reply, 'assetId must be a uuid');
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

  app.post('/work-orders/:id/status', { preHandler: [require('technician','facilities','coordinator','principal','owner'), uuidParams('id')] }, async (req, reply) => {
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

  // RTE-11: the tenant-wide asset inventory was readable by every role; work-order mutations are staff-gated.
  app.get('/assets', { preHandler: roleGatedMe('owner','principal','itadmin','finance','coordinator','facilities','technician','transport') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.assets ORDER BY code LIMIT 500`);
      return { assets: r.rows };
    });
  });

  // ============ cases ============
  const STAFF_CASE_ROLES = new Set(['owner', 'principal', 'itadmin', 'coordinator', 'teacher', 'finance']);
  app.get('/cases', { preHandler: roleGatedMe('owner','principal','itadmin','coordinator','teacher','finance') }, async (req, reply) => {
    if (!canReach(req, [...STAFF_CASE_ROLES])) return reply.code(403).send({ error: 'The full school case log is staff-only. Parents can see their own complaints at /my-cases.' });
    const { status } = req.query;
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 200 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT * FROM app.cases WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [status ?? null, limit, offset]);
      return { cases: r.rows, limit, offset, hasMore: r.rows.length === limit };
    });
  });

  // A parent's own complaints — and only those (other families' cases never leave the staff board).
  app.get('/my-cases', { preHandler: me }, async (req) => {
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 200 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT * FROM app.cases WHERE opened_by=$2 AND ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
        [req.query.status ?? null, req.user.id, limit, offset]);
      return { cases: r.rows, limit, offset, hasMore: r.rows.length === limit };
    });
  });

  const CASE_PRIORITIES = new Set(['critical', 'high', 'normal', 'low']);
  const CASE_MAX_SLA_HOURS = 24 * 365;          // staff may commit to a long review window
  const CASE_MAX_SLA_HOURS_REPORTER = 24 * 7;   // a family's report: a week, then the office owns it
  app.post('/cases', { preHandler: me }, async (req, reply) => {
    // SEC-4 — DELIBERATELY NOT THE REGISTER'S RECOMMENDATION, and this is the important part.
    // The audit says to gate this door on STAFF_CASE_ROLES and force origin 'staff'. That
    // would break a deliberate, TESTED product behaviour: this door is how a parent files a
    // complaint, and tests/cases-privacy.test.js ('parent files a complaint (bullying
    // scenario)') asserts a 200 carrying origin 'parent', with the file's header stating
    // "POST /cases stays open to every signed-in role (parents must be able to report)".
    // So the door stays open to families; the tested flow is not collateral damage.
    //
    // The actual defect is not WHO may open a case but WHICH FIELDS the caller controls.
    // Those were all staff decisions surrendered to the request body, and each one is a real
    // failure rather than noise:
    //   · `origin`   — a parent could label their own report 'staff' or 'system', so the
    //                  audit spine and the staff board would misattribute its source.
    //   · `owner`    — a parent could assign the case to any staff member by name.
    //   · `priority` — a parent could self-declare 'critical' and sit at the top of the
    //                  board (triaging severity is the office's job).
    //   · `slaHours` — a parent could set an SLA long enough that the case never escalates.
    // Each is now derived from the caller's role instead of trusted from the body.
    const isStaff = STAFF_CASE_ROLES.has(req.user.role);
    const b = req.body ?? {};
    if (!b.title || !b.kind) return bad(reply, 'title and kind required');
    // Validate rather than letting the DB CHECK reject it: an invalid priority used to
    // surface as a raw constraint error (a 500) instead of a usable 400.
    if (b.priority !== undefined && !CASE_PRIORITIES.has(b.priority)) return bad(reply, `invalid priority (${[...CASE_PRIORITIES].join(', ')})`);
    if (!isStaff && b.priority === 'critical') {
      return bad(reply, 'critical severity is set by staff triage — file it as high and the office will escalate', 403);
    }
    const maxSla = isStaff ? CASE_MAX_SLA_HOURS : CASE_MAX_SLA_HOURS_REPORTER;
    const slaHours = b.slaHours === undefined ? 48 : Number(b.slaHours);
    if (!Number.isFinite(slaHours) || slaHours <= 0 || slaHours > maxSla) {
      return bad(reply, `slaHours must be a positive number of hours (max ${maxSla})`);
    }
    // Derived, never supplied — this is the field the staff board and the audit spine use to
    // tell a family's report from an internal case.
    const origin = isStaff ? 'staff' : (req.user.role === 'student' ? 'student' : 'parent');
    const owner = isStaff ? (b.owner ?? 'Coordinator') : 'Coordinator';
    const idempotencyKey = String(req.headers['idempotency-key'] ?? '').trim();
    if (idempotencyKey && (idempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey))) {
      return bad(reply, 'Idempotency-Key must be 1-128 letters, numbers, dots, underscores, colons or hyphens');
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (idempotencyKey) {
        const prior = await c.query(`SELECT * FROM app.cases WHERE tenant_id=$1 AND idempotency_key=$2`, [req.user.tenant_id, idempotencyKey]);
        if (prior.rows[0]) return { case: prior.rows[0], already: true };
      }
      const code = b.code ?? `case_${randomUUID().slice(0,8)}`;
      let r;
      try {
        r = await c.query(
          `INSERT INTO app.cases (tenant_id, code, kind, title, detail, priority, owner, opened_by, origin, sla_due_at, linked_refs, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + ($10 || ' hours')::interval, $11::jsonb, $12) RETURNING *`,
          [req.user.tenant_id, code, b.kind, b.title, b.detail ?? null, b.priority ?? 'normal', owner, req.user.id, origin, String(slaHours), JSON.stringify(b.linkedRefs ?? []), idempotencyKey || null]);
      } catch (e) {
        if (e.code !== '23505' || !idempotencyKey) throw e;
        const prior = await c.query(`SELECT * FROM app.cases WHERE tenant_id=$1 AND idempotency_key=$2`, [req.user.tenant_id, idempotencyKey]);
        if (prior.rows[0]) return { case: prior.rows[0], already: true };
        throw e;
      }
      await emitEvent(c, req.user.tenant_id, { type: 'case', label: `Case opened — ${b.title}`, severity: b.priority === 'critical' ? 'critical' : 'info', ref: code });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Opened case', recordType: 'Case', recordRef: code, reason: b.title, outcome: `origin ${origin} · owner ${owner} · SLA ${slaHours}h` });
      return { case: r.rows[0] };
    });
  });

  app.post('/cases/:id/status', { preHandler: [me, uuidParams('id')] }, async (req, reply) => {
    if (!canReach(req, [...STAFF_CASE_ROLES])) return reply.code(403).send({ error: 'Only school staff can change a case status. Parents track progress in My complaints.' });
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
    /* DAT-6: this path creates a STUDENT — the single most consequential row in the database — plus a guardian,
       an enrollment_history entry and a funnel state change, and left no audit row for any of it. The
       enrollment_history row answers "where did they come from" for the school; the audit row answers "who
       created this, from which lead, and what else changed at the same moment" for anyone auditing the platform.
       recordType 'Student' with the new id, and the lead code in the action so the two records can be joined
       without guessing. */
    await auditLog(c, req.user.tenant_id, {
      actor: req.user.name,
      actorRole: req.user.role,
      action: `Student created from admissions lead ${a.code} — ${student.name} (${grade}-${section}), admission no ${student.admission_no}`
        + (lead.guardian_name && lead.guardian_phone ? ', primary guardian recorded' : ', no guardian on the lead'),
      recordType: 'Student',
      recordRef: student.id,
      policyRef: 'Admissions §3 — lead conversion',
    });
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
      // RTE-12: `&&` binds tighter than `||`, so the old expression was
      // `ownRole || (isOwnerOrPrincipal && owner !== finance)` — which excluded the OWNER from deciding
      // finance-owned actions, contradicting the adjacent comment. The finance exclusion is meant for the
      // principal only (the principal must not rubber-stamp the finance desk's own actions); the owner is
      // the unconditional override.
      const ownerOk = a.owner_role === req.user.role
        || req.user.role === 'owner'
        || (req.user.role === 'principal' && a.owner_role !== 'finance');
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
          // PRD-17: QUEUE it. The dispatcher owns delivery and records it honestly (a sandbox carrier in
          // production becomes 'failed' with a reason — see src/plugins/_shared/delivery-honesty.js), so
          // this door must not pre-empt that verdict. It also must not claim one: the previous version
          // wrote 'delivered' + sent_at + delivered_at here, with no rail and no queue entry, and the
          // dispatcher only ever claims `status='queued'`, so the row could never have been sent later.
          const audienceLabel = String(p.audience ?? 'guardians');
          const recipients = await resolveNoticeRecipients(c, req.user.tenant_id, p);
          if (recipients.length === 0) {
            // Nothing queued, nothing claimed: no comms row, and every record says so. The approval itself
            // still succeeds — the decision was the approver's to make, and refusing it here would leave
            // the action open with no way to explain why.
            execution = { type: 'communication', id: null, status: 'unaddressed', recipients: 0, audience: audienceLabel };
            await emitEvent(c, req.user.tenant_id, {
              type: 'comms', severity: 'warn',
              label: `Parent notice approved but NOT sent — no contactable recipients could be resolved for "${audienceLabel}" (${p.template ?? 'message'}, approved by ${req.user.name}). Record it as unsent and act at the desk.`,
            });
          } else {
            if (recipients.length > 500) {
              // RTE-1: this guard runs AFTER the status was flipped to 'approved'. `withUser` COMMITS on a
              // normal return, so `return bad(...)` persisted the approval with no notice queued and blocked
              // the retry. Throw instead: the transaction rolls back and the error handler turns the
              // statusCode into the same 413.
              throw Object.assign(new Error('This notice has more than 500 recipients. Split the audience into smaller notices before approving it.'), { statusCode: 413 });
            }
            const comm = await c.query(
              `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, status, policy_ref, approved_by)
               VALUES ($1, $2::jsonb, $3, $4, $5, 'queued', $6, $7) RETURNING *`,
              [req.user.tenant_id, JSON.stringify(recipients), p.channel ?? 'WhatsApp', p.template ?? null,
               p.draft ?? a.detail, a.policy_ref, req.user.id]);
            execution = { type: 'communication', id: comm.rows[0].id, status: 'queued', recipients: recipients.length, audience: audienceLabel };
            await emitEvent(c, req.user.tenant_id, { type: 'comms', label: `Parent notice approved and QUEUED to ${recipients.length} guardian${recipients.length === 1 ? '' : 's'} — ${audienceLabel} (${p.template ?? 'message'}, approved by ${req.user.name})`, ref: comm.rows[0].id });
          }
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
            // RTE-1: the same commit-on-return trap. The status flip above must roll back with the failed
            // executor, so rethrow — `withUser` rolls back and the error handler maps `e.statusCode`.
            throw e;
          }
        }
      }
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `${decision === 'approved' ? 'Approved' : 'Dismissed'} action: ${a.title}`, recordType: 'Action', recordRef: a.code, reason: note ?? 'decided in Action Center', policyRef: a.policy_ref, aiInvolved: a.ai_involved, risk: 'medium', outcome: execution ? `executed: ${execution.type} ${execution.id ?? execution.status}` : 'no execution' });
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
      const provider = await enabledCapability(sysq, tenantId, 'fees.razorpay.gateway');
      const s = decryptSettings(provider?.settings ?? {}, tenantId);
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

  app.post('/payments/:id/refund', { preHandler: [require('owner', 'finance'), uuidParams('id')] }, async (req, reply) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.params.id))) return bad(reply, 'payment id must be a uuid');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const p = (await c.query(`SELECT * FROM app.payments WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!p) return bad(reply, 'payment not found', 404);
      if (p.status === 'refunded') return bad(reply, 'payment already refunded', 409);
      if (p.status !== 'confirmed') return bad(reply, `only confirmed payments can be refunded (this one is ${p.status})`, 409);
      // RTE-2: read and validate the obligation BEFORE the gateway call. This guard used to run AFTER
      // it, so an inconsistent ledger let real money leave the gateway while the door returned 409 with
      // the ledger untouched (and no refund recorded). A refund must be provably representable in the
      // ledger before it is sent. No mutation has happened yet, so a plain `return bad` is safe here.
      // Never floor an inconsistent ledger to zero: that masks a prior duplicate/partial settlement and
      // understates the school's receivable. A refund is safe only when this payment is still represented
      // in the obligation's paid total; reconciliation must handle anything else.
      const o = p.obligation_id
        ? (await c.query(`SELECT id, amount_cents, paid_cents FROM app.fee_obligations WHERE id=$1 FOR UPDATE`, [p.obligation_id])).rows[0]
        : null;
      if (o && BigInt(o.paid_cents) < BigInt(p.amount_cents)) {
        return bad(reply, 'payment ledger is inconsistent; reconcile the obligation before refunding', 409);
      }
      // Gateway leg (razorpay): a refused refund must not touch the ledger.
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
      if (o) {
        const newPaid = BigInt(o.paid_cents) - BigInt(p.amount_cents);
        const newStatus = newPaid <= 0n ? 'open' : (newPaid < BigInt(o.amount_cents) ? 'partial' : 'paid');
        await c.query(`UPDATE app.fee_obligations SET paid_cents=$2, status=$3 WHERE id=$1 AND tenant_id=$4`, [o.id, newPaid.toString(), newStatus, req.user.tenant_id]);
      }
      // FEX-15: record the amount given back in the same statement that flips the status. The column is
      // CHECK-constrained (`refunded_cents <= amount_cents`), so a refund can never overdraw the payment.
      const upd = await c.query(
        `UPDATE app.payments SET status='refunded', refunded_at=now(), refund_reason=$2, refund_gateway_ref=$3,
                refunded_cents=amount_cents
         WHERE id=$1 AND tenant_id=$4 RETURNING id, status, refunded_at, refunded_cents`,
        [p.id, reason || null, gateway.refundId ?? gateway.note ?? null, req.user.tenant_id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Refunded payment', recordType: 'Payment', recordRef: p.id, reason: reason || 'owner/finance refund', policyRef: 'Fees §4.2', risk: 'high', outcome: `status refunded via ${gateway.mode}${gateway.refundId ? ` (${gateway.refundId})` : ''} — ${o ? 'obligation paid_cents reversed' : 'no linked obligation — payment status only (no ledger entry to reverse)'}` });
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
  // DAT-7: ONE IST definition lives in src/ist.js. The two attendance doors below used to default to a UTC
  // date, so between 00:00 and 05:30 IST a client omitting `date` read/wrote yesterday's register.
  const IST_NOW_MS = () => istNow().getTime();
  const IST_TODAY = istToday;
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
    const provider = await enabledCapability(sysq, tenantId, 'comms.whatsapp.templates');
    const s = provider?.settings ?? {};
    const qs = s.quiet_hours ?? {};
    return { start: qs.start ?? '21:00', end: qs.end ?? '08:00' };
  };
  const DUNNING_SELECT = `
    SELECT o.id, o.student_id, o.label, o.due_on, o.amount_cents, o.paid_cents,
           s.name AS student_name, s.guardian_phone
    FROM app.fee_obligations o JOIN app.students s ON s.id = o.student_id
    WHERE o.tenant_id = $1 AND o.status IN ('open','partial') AND o.due_on < $2::date AND o.amount_cents >= o.paid_cents
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
        const inserted = await c.query(
          `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, policy_ref, dedup_key)
           VALUES ($1,'guardian',$2::jsonb,'whatsapp','FEE_REMINDER',$3,'queued','Fees §4.2',$4)
           ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
          [req.user.tenant_id, JSON.stringify([o.guardian_phone]),
           `Fee reminder: ${o.student_name} — ${o.label}, ₹${Number(due) / 100} was due on ${o.due_on}. Please pay via the parent portal or at the school office. If you have already paid, please share the receipt with the office — no action otherwise.`,
           `dunning:${o.id}`]);
        queued += inserted.rowCount;
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

  app.post('/exams/:id/board-policy', { preHandler: [require('owner', 'principal', 'itadmin'), uuidParams('id')] }, async (req, reply) => {
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

  app.get('/exams/:id/board-policy', { preHandler: [me, uuidParams('id')] }, async (req, reply) => {
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
  // RTE-3: this was gated on the broad `me`, so a parent or student read every open lead's
  // name/class/source/stage. `fullPii` masks two fields but authorizes nobody. It now mirrors the
  // admissions funnel's own lead-list gate (owner/principal/itadmin/finance/coordinator/teacher) via
  // `roleGatedMe`, which also publishes the real role set to the route registry so custom-role
  // authoring cannot widen it (RBAC-1c).
  app.get('/admissions/followups', { preHandler: roleGatedMe('owner', 'principal', 'itadmin', 'finance', 'coordinator', 'teacher') }, async (req) => {
    const fullPii = ['owner', 'principal', 'itadmin', 'coordinator'].includes(req.user.role);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT id, student_name, class_applied, source, stage, guardian_name, guardian_phone, updated_at,
                GREATEST(0, extract(epoch FROM (now() - updated_at)) / 86400)::int AS days_in_stage
         FROM plugin_admissions.lead
         WHERE tenant_id=$1 AND stage NOT IN ('enrolled','dropped')
         -- RTE-13: the ranking ran over every open lead in JS; bound the input like every other list door.
         ORDER BY updated_at ASC LIMIT 500`, [req.user.tenant_id])).rows;
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
  // API-1 (SEC): the tenant event feed and its lineage view must share ONE role set —
  // they did not. /events correctly required ten staff roles, while /events/lineage was
  // gated on a bare `me`, so a student or parent could read emitted_by / subject /
  // correlation_id for the entire tenant, in a feed whose labels embed other families'
  // payment and receipt amounts, `PTM booked — <child>`, `Book issued → <student>` and
  // safety reports. Sharing this array makes the drift impossible to reintroduce, and
  // preserves /events' behaviour exactly.
  const EVENT_FEED_ROLES = ['owner','principal','itadmin','finance','coordinator','teacher','admissions','transport','facilities','technician'];
  app.get('/events', { preHandler: require(...EVENT_FEED_ROLES) }, async (req, reply) => {
    const since = req.query.since ? new Date(req.query.since) : null;
    // RTE-8/9: `new Date('foo')` is an Invalid Date; binding it to `$1::timestamptz` was a raw 500.
    if (since && Number.isNaN(since.getTime())) return bad(reply, 'since must be an ISO timestamp');
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 500 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT id, type, label, severity, ref, created_at FROM app.events
         WHERE ($1::timestamptz IS NULL OR created_at > $1) ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [since, limit, offset]);
      return { events: r.rows, limit, offset, hasMore: r.rows.length === limit };
    });
  });

  app.get('/notifications', { preHandler: me }, async (req) => {
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 200 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.notifications WHERE user_id=$1 OR user_id IS NULL ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [req.user.id, limit, offset]);
      return { notifications: r.rows, limit, offset, hasMore: r.rows.length === limit };
    });
  });

  app.post('/notifications/read', { preHandler: me }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const updated = await c.query(`UPDATE app.notifications SET read_at=now() WHERE id=$1 AND user_id=$2 AND read_at IS NULL`, [req.body?.id, req.user.id]);
      if (!updated.rowCount) return reply.code(404).send({ error: 'notification not found or already read' });
      return { ok: true };
    });
  });

  app.get('/communications', { preHandler: require('owner','principal','coordinator','finance','itadmin','transport') }, async (req) => {
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 500 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT id, tenant_id, audience_kind, audience_json, channel, template, status, policy_ref, approved_by, sent_at, delivered_at, created_at FROM app.communications ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
      return { communications: r.rows, limit, offset, hasMore: r.rows.length === limit };
    });
  });

  app.get('/audit', { preHandler: require('owner','principal','itadmin','finance') }, async (req) => {
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 500 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT id, actor, actor_role, action, record_type, record_ref, reason, policy_ref, ai_involved, risk, outcome, prev_hash, hash, created_at
         FROM app.audit_log ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
      return { entries: r.rows, limit, offset, hasMore: r.rows.length === limit };
    });
  });

  // SEC-20 / DAT-5: prove the ledger, don't assume it. The chain was verifiable in principle and
  // nothing in production ever verified it — when it was first recomputed from the live rows, 26 of
  // 53 did not reproduce, and one had provably been altered after insertion. This door recomputes.
  //
  // Deliberate design choices, each for a named failure mode:
  //  * OWNER PATH (sysq), not withUser. app.audit_log_cold is REVOKE ALL from schoolos_app, so a
  //    withUser implementation would read nothing on that side and still report a clean bill of
  //    health — exactly the success-shaped silence that kept this item invisible for so long.
  //  * Always 200 with a CLASSIFIED findings list. Never a 5xx: a 500 would make "cannot verify"
  //    indistinguishable from "no problems" to every monitor that alerts only on non-2xx.
  //  * `ok` never travels alone — the counts and the limitations ship with it.
  app.get('/audit/verify', { preHandler: require('owner','itadmin') }, async (req, reply) => {
    // Garbage or out-of-range input must not 500 (the sibling /audit door has no lower bound either).
    let limit = parseInt(req.query?.limit ?? '10000', 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 10000;
    limit = Math.min(limit, 100000);

    const tenant = req.user.tenant_id;
    const found = await sysq(
      `SELECT break_kind, row_id, created_at, expected_prev, actual_prev, expected_hash, actual_hash, hash_version
         FROM app.audit_verify($1,$2)`, [tenant, limit]);
    const tally = await sysq(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE hash_version = 1)::int  AS legacy_v1,
              count(*) FILTER (WHERE hash_version >= 2)::int AS pinned_v2,
              (SELECT count(*)::int FROM app.audit_log_cold WHERE tenant_id=$1) AS cold_rows
         FROM app.audit_log WHERE tenant_id=$1`, [tenant]);
    const c = tally.rows[0];
    const broken = found.rows;
    const ok = broken.length === 0;

    // A verification nobody can prove happened is not evidence: record the run itself.
    await withUser(tenant, req.user.role, (cx) => auditLog(cx, tenant, {
      actor: req.user.name, actorRole: 'system', action: 'Audit chain verified', recordType: 'Audit',
      policyRef: 'SEC-20 · ledger tamper-evidence (migration 075)',
      risk: ok ? 'low' : 'high',
      outcome: ok
        ? `${c.total} row(s) verified: 0 breaks · ${c.pinned_v2} hash-pinned · ${c.legacy_v1} pre-pinning (not recomputable) · ${c.cold_rows} archived`
        : `${broken.length} BREAK(S) in ${c.total} row(s): ${[...new Set(broken.map((b) => b.break_kind))].join(', ')}`,
    }));

    return reply.code(200).send({
      verifiedAt: new Date().toISOString(),
      tenant,
      ok,
      checked: { hotRows: c.total, hashPinned: c.pinned_v2, legacyUnverifiable: c.legacy_v1, archivedRows: c.cold_rows },
      broken,
      // Stated, not implied: what this run does NOT cover.
      limitations: [
        c.legacy_v1 > 0
          ? `${c.legacy_v1} row(s) predate hash pinning (hash_version=1) and were hashed by the old JS writer with different material, so they CANNOT be recomputed. They are counted here and asserted neither way — neither "verified" nor "tampered" is claimed for them.`
          : null,
        'The archived table is checked only at the hot→cold boundary; the cold chain itself is not walked (DAT-11).',
        'A superuser can bypass the pinning trigger via session_replication_role. Such a rewrite is what this endpoint detects after the fact; it cannot be prevented from inside the database.',
      ].filter(Boolean),
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
  app.get('/events/lineage', { preHandler: require(...EVENT_FEED_ROLES) }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const limit = Math.min(parseInt(req.query.limit ?? '25', 10) || 25, 100);
      // RTE-8/9 + PLGX: the old `[0-9a-f-]{36}` regex accepts 36 hyphens, which then 22P02s at `::uuid`.
      const correlation = req.query.correlation && UUID_RE_NOTICE.test(String(req.query.correlation)) ? req.query.correlation : null;
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
      const tenantPlan = (await c.query(`SELECT plan FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0]?.plan ?? 'core';
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
          const requiredPlan = PLUGIN_PLAN[p.plugin_id] ?? null;
          const availability = { available: planIncludes(tenantPlan, p.plugin_id), requiredPlan };
          if (privileged) return { ...p, ...availability, settings: maskSettings(p.settings) };
          const keys = Object.keys(p.settings ?? {});
          return { ...p, ...availability, settings: undefined, hasSettings: keys.length > 0, keys, settings_schema: p.manifest?.settingsSchema ?? null };
        }),
        contracts: contracts.rows,
        plan: tenantPlan,
      };
    });
  });

  app.post('/plugins/:id/enable', { preHandler: [require('owner','itadmin'), pluginGuard] }, async (req, reply) => {
    /* PLG-4: the client supplies NO registry metadata. `version`, `class` and `manifest` used to come from the
       request body, so a caller could claim library — really class C — was class A with one permission; and
       because PLG-1 made the recorded grant the only grant, the audit record of consent was client-authored.
       They are now resolved from the on-disk manifest (the same source the permission declaration comes from),
       and an id with no module is refused instead of fabricating a registry row. The body is ignored entirely. */
    const { declaredManifest, grantedFor, unknownPermissions } = await import('./plugin-permissions.js');
    const manifestFile = await declaredManifest(req.params.id);
    if (!manifestFile) return bad(reply, `No module on disk for plugin '${req.params.id}'`, 404);
    const declared = Array.isArray(manifestFile.permissions) ? manifestFile.permissions.map(String) : [];
    const invented = unknownPermissions(declared);
    if (invented.length) return bad(reply, `the manifest declares permissions outside the kernel vocabulary: ${invented.join(', ')}`);
    const version = typeof manifestFile.version === 'string' ? manifestFile.version : '1.0.0';
    const pClass = manifestFile.class;
    if (!pClass || !['A','B','C','D','E'].includes(pClass)) return bad(reply, 'the plugin manifest must declare a class A–E');
    if (!kernelSatisfies(manifestFile.kernel)) {
      return bad(reply, `Plugin '${req.params.id}' requires kernel ${manifestFile.kernel}; this server runs kernel ${KERNEL_VERSION}.`, 409);
    }
    if (Buffer.byteLength(JSON.stringify(manifestFile)) > 65536) return bad(reply, 'manifest too large (max 64KB)', 413);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      /* PLG-2: the plan is a fact about the TENANT (app.tenants.plan, migration 080), and this door is where a
         school spends it. 402 before any write, so an unentitled enable leaves nothing half-created — the same
         shape as the kernel-compat and permission gates. */
      const { planIncludes, notEntitled } = await import('./entitlements.js');
      const plan = (await c.query(`SELECT plan FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0]?.plan ?? 'trial';
      if (!planIncludes(plan, req.params.id)) return reply.code(402).send(notEntitled(req.params.id, plan));
      const dependencies = Array.isArray(manifestFile.dependencies)
        ? manifestFile.dependencies.map(dependencySpec).filter(Boolean)
        : [];
      for (const dep of dependencies) {
        const row = (await c.query(
          `SELECT version, status FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`,
          [req.user.tenant_id, dep.id],
        )).rows[0];
        if (!row || !['enabled', 'active', 'degraded'].includes(row.status)) {
          return bad(reply, `Plugin '${req.params.id}' requires '${dep.id}' to be enabled first.`, 409);
        }
        if (semverCmp(row.version, dep.version) !== 0) {
          return bad(reply, `Plugin '${req.params.id}' requires '${dep.id}' version ${dep.version}; found ${row.version}.`, 409);
        }
      }
      /* PLG-4 follow-up (regression caught by full run r51, `tests/wave1.test.js:214`). The enable door must not
         BLANK the stored manifest. Six plugins — ops.timetable, payments.razorpay, payments.upi, comms.whatsapp,
         accounting.tally, transport.gps — carry their settings schema under the SNAKE_CASE key `settings_schema`
         in the file manifest, while the row's stored manifest and the settings-validation door read the
         CAMEL_CASE `settingsSchema`. Writing the file manifest verbatim therefore dropped the schema for those
         six, making their settings unconfigurable after a re-enable — the exact "whole-manifest overwrite
         silently deletes six working settings schemas" trap `plugin-catalog.js:113` documents. The fix mirrors
         that module's own reconciliation: keep the stored manifest as the base, overlay the file manifest, and
         normalise whichever schema key the file declared into the camelCase key the door reads. A plugin whose
         file declares NO schema at all keeps its stored one (the six above are exactly this case). */
      const prevManifest = (await c.query(`SELECT manifest FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [req.user.tenant_id, req.params.id])).rows[0]?.manifest ?? null;
      const fileSchema = manifestFile.settingsSchema ?? manifestFile.settings_schema ?? null;
      const mergedManifest = { ...(prevManifest ?? {}), ...manifestFile };
      if (fileSchema === null && (prevManifest?.settingsSchema ?? prevManifest?.settings_schema) != null) {
        mergedManifest.settingsSchema = prevManifest.settingsSchema ?? prevManifest.settings_schema;
      } else if (fileSchema !== null) {
        mergedManifest.settingsSchema = fileSchema;   // normalise the file's snake_case to the read key
      }
      const r = await c.query(
        `INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, enabled_at, enabled_by)
         VALUES ($1,$2,$3,$4,'enabled',$5::jsonb,$6::jsonb, now(), $7)
         ON CONFLICT (tenant_id, plugin_id) DO UPDATE SET status='enabled', version=EXCLUDED.version,
           manifest=EXCLUDED.manifest, permissions=EXCLUDED.permissions, enabled_at=now(), enabled_by=EXCLUDED.enabled_by, updated_at=now()
         RETURNING *`,
        [req.user.tenant_id, req.params.id, version, pClass,
         JSON.stringify(mergedManifest),
         JSON.stringify(grantedFor(req.params.id, declared)),
         req.user.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Plugin enabled: ${req.params.id}`, recordType: 'Plugin', recordRef: `${req.params.id}@${version}`, reason: `class ${pClass} (from the manifest) · permissions: ${declared.join(', ') || 'none'}`, policyRef: 'Platform §3.1 (plugin governance)', risk: 'medium', outcome: 'nav, routes and slots will reflect the module' });
      return { plugin: r.rows[0] };
    });
  });

  app.post('/plugins/:id/disable', { preHandler: [require('owner','itadmin'), pluginGuard] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // RTE-17: confirm the plugin exists BEFORE the drain. The 404 used to fire after the drain UPDATE,
      // so disabling an unknown id could still reassign that desk's open actions.
      const exists = await c.query(`SELECT 1 FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [req.user.tenant_id, req.params.id]);
      if (!exists.rows[0]) return bad(reply, 'plugin not registered', 404);
      // DRAIN PROTOCOL (docs/12 §12): disable may never abandon school work.
      const drained = await c.query(
        `UPDATE app.actions SET owner='Principal desk (drain hand-back)', owner_role='principal'
         WHERE tenant_id=$1 AND status='open' AND (
           owner_role=$2 OR owner=$2 OR EXISTS (
             SELECT 1 FROM app.events e
             WHERE e.tenant_id=app.actions.tenant_id
               AND e.id::text=app.actions.source_event
               AND e.emitted_by=$3
           )
         ) RETURNING id`,
        [req.user.tenant_id, req.params.id, `plugin:${req.params.id}`]);
      const subs = await c.query(
        `SELECT count(*)::int AS n FROM app.event_action_link l
         JOIN app.events e ON e.id = l.event_id
         WHERE e.tenant_id=$1 AND e.emitted_by=$2 AND l.created_at > now() - interval '30 days'`,
        [req.user.tenant_id, `plugin:${req.params.id}`]);
      const r = await c.query(`UPDATE app.plugins SET status='disabled', updated_at=now() WHERE tenant_id=$1 AND plugin_id=$2 RETURNING *`, [req.user.tenant_id, req.params.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Plugin disabled: ${req.params.id}`, recordType: 'Plugin', recordRef: req.params.id, reason: 'switched off by school', policyRef: 'Platform §3.1', risk: 'low', outcome: `data retained · subscriptions stopped · DRAIN: ${drained.rowCount} open action(s) handed back to principal · ${subs.rows[0].n} linked events retained for lineage` });
      return { plugin: r.rows[0], drained: { actions_reassigned: drained.rowCount, events_retained: subs.rows[0].n } };
    });
  });

  app.post('/plugins/:id/settings', { preHandler: [require('owner','itadmin'), pluginGuard] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const next = req.body ?? {};
      // DAT-6: this route is the de-facto SECRET-ROTATION path — it is where a school's
      // key_secret / webhook_secret / SMTP password is replaced — and its audit row said only
      // "settings saved", naming nothing. So the single most consequential write in the product was
      // invisible in the ledger, and `SECRET_KEY_RE` (which exists for exactly this distinction) was
      // never consulted here. The CHANGED KEY NAMES are now recorded, never the values: this ledger is
      // readable by several staff roles, so a value would turn evidence into a leak.
      //
      // Two statements, deliberately, with the row locked in between — see the note below on why the
      // single-statement CTE version of this is a trap.
      const prevRow = await c.query(
        `SELECT settings, manifest FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2 FOR UPDATE`,
        [req.user.tenant_id, req.params.id]);
      if (!prevRow.rows[0]) return bad(reply, 'plugin not registered', 404);

      /* SEC-6: this door persisted `req.body` VERBATIM as the plugin's settings. The validator
       * (`validateSettingsAgainstSchema`) already existed and was wired only into the NON-PERSISTING
       * preview door, so the check ran on precisely the path that writes nothing and was skipped on the
       * path that writes everything. These settings drive webhook secrets, gateway keys, replay windows
       * and quiet hours, so the door accepted any shape of anything for the product's most security-
       * sensitive configuration.
       *
       * A key the manifest does not declare is now REJECTED (400) rather than dropped, because silently
       * discarding part of a credential payload is the worse failure: a school that typos a key name would
       * see a success and keep using the old secret. Only the NORMALIZED form is persisted, so defaults are
       * materialised and unvalidated values never reach the column.
       *
       * A plugin with no `settingsSchema` is left alone on purpose — `canonicalSchema` returns null and the
       * validator passes the payload through unchanged. Inventing a schema for a plugin that declares none
       * would be a guess in a credential path. */
      const schema = canonicalSchema(prevRow.rows[0].manifest);
      const check = validateSettingsAgainstSchema(schema, next);
      if (!check.ok) {
        return reply.code(400).send({
          error: 'Those settings were not saved — this module rejected them.',
          errors: check.errors,
          detail: schema
            ? 'Each key must be one the module declares; check the values against the module manifest.'
            : null,
        });
      }
      const toStore = check.normalized;
      const storedSettings = encryptSettings(toStore, req.user.tenant_id);
      const r = await c.query(
        `UPDATE app.plugins SET settings=$3::jsonb, updated_at=now()
          WHERE tenant_id=$1 AND plugin_id=$2 RETURNING *`,
        [req.user.tenant_id, req.params.id, JSON.stringify(storedSettings)]);
      if (!r.rows[0]) return bad(reply, 'plugin not registered', 404);

      const prev = decryptSettings(prevRow.rows[0].settings ?? {}, req.user.tenant_id);
      const changed = [...new Set([...Object.keys(prev), ...Object.keys(toStore)])]
        .filter((k) => JSON.stringify(prev[k] ?? null) !== JSON.stringify(toStore[k] ?? null));
      const secretKeys = changed.filter((k) => isSecretKey(k));
      const detail = changed.length
        ? `changed keys: ${changed.join(', ')}${secretKeys.length ? ` · SECRET-CLASS: ${secretKeys.join(', ')} (values deliberately never recorded)` : ''}`
        : 'no effective change (payload identical to stored settings)';

      await auditLog(c, req.user.tenant_id, {
        actor: req.user.name, actorRole: req.user.role,
        action: `Plugin settings updated: ${req.params.id}`, recordType: 'Plugin', recordRef: req.params.id,
        policyRef: secretKeys.length ? 'Platform §3 (plugin governance) · credential rotation' : undefined,
        // A secret-class change is a credential rotation and is flagged as such; an ordinary settings
        // edit is not. Keeping the two distinguishable is the whole point of recording the key names.
        risk: secretKeys.length ? 'high' : 'low',
        outcome: detail,
      });
      // On the CTE version of this diff, for whoever is tempted to "simplify" it back:
      //   WITH before AS (SELECT settings FROM app.plugins WHERE ... FOR UPDATE)
      //   UPDATE app.plugins SET settings=$3::jsonb WHERE ... RETURNING *, (SELECT settings FROM before)
      // returns **NULL** for the captured old row, not the old settings. The WITHOUT-FOR-UPDATE form
      // does work (as does a plain scalar subquery in RETURNING, which correctly sees the statement's
      // pre-update snapshot) — so the trap is specifically `FOR UPDATE` inside a CTE that the same
      // statement's RETURNING reads. The failure is silent and one-sided: every save would take
      // `prev = {}`, mark EVERY key changed, and flag every settings edit `risk:'high'` with
      // `key_secret` named — which destroys the risk column's usefulness from the other direction.
      // Verified against PostgreSQL 18; the two-statement form above additionally holds a real lock
      // across the read-modify-write, so the diff cannot race a concurrent save.
      return { plugin: { ...r.rows[0], settings: maskSettings(r.rows[0].settings) } };
    });
  });

  // ============ plugin runtimes live in src/plugins/<id>/ (see loader.js) ============
  // Docs/11 §2.2: each plugin mounts its own doors; the core adds no per-plugin logic.
  // Registry enable/disable + drain protocol remain right here (the switchboard).

  // ============ migration (Golden Loop 1 backend) ============
  // RTE-11: the whole migration pipeline was readable by any role; stage/commit are owner/coordinator/itadmin-gated.
  app.get('/migration/sources', { preHandler: roleGatedMe('owner','coordinator','itadmin') }, async (req) => {
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
      // RTE-6: validate the whole batch BEFORE the purge and inserts. A mid-loop `return bad` would commit
      // the purge and a partial staged set (withUser commits on a normal return).
      for (let i = 0; i < rows.length; i++) {
        const rowNo = Number.isInteger(rows[i].rowNo) ? rows[i].rowNo : i + 1;
        if (!Number.isInteger(rowNo) || rowNo < 1 || rowNo > 1000000) return bad(reply, `row ${i + 1}: rowNo must be an integer 1..1000000`);
      }
      // re-staging replaces the staged set (staged only; committed history stays).
      // App-role table-level DELETE is not granted (bootstrap 054 baseline) — the
      // scoped SECURITY DEFINER helper does the delete, tenant-guarded.
      await c.query(`SELECT app.purge_staged_rows($1)`, [src.id]);
      let n = 0;
      for (const r of rows) {
        const rowNo = Number.isInteger(r.rowNo) ? r.rowNo : n + 1;
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
      // RTE-13: bounded per-row validation loop (the stage cap is 5000 rows; never unbounded).
      const rows = (await c.query(`SELECT id, row_no, payload FROM app.migration_rows WHERE source_id=$1 AND status <> 'ok' ORDER BY row_no LIMIT 5000`, [src.id])).rows;
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
                                   ORDER BY row_no LIMIT 5000`, [src.id])).rows;
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
        // RTE-7: THROW, not `return bad` — the earlier rows of this loop have already INSERTed students,
        // guardians and fees, and `return` would COMMIT that partial import with no audit. A throw rolls
        // the whole import back; the error handler maps statusCode to the same 409.
        if (!s.rows[0]) throw Object.assign(new Error(`row ${row.row_no}: admission number ${admissionNo} already belongs to another student`), { statusCode: 409 });
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
