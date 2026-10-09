// Domain routes — every request runs as the RLS-constrained app role with the
// caller's tenant + role in session. Mutations write the audit ledger.
import { randomUUID, createHash } from 'node:crypto';
import { linkLineage, requestAudit } from './audit.js';
import { ensurePluginCatalog } from './plugin-catalog.js';
import { isSecretKey, canonicalSchema, validateSettingsAgainstSchema } from './settings-contract.js';
import { checkEventBudget } from './governance.js';
import { q, sysq } from './db.js';
import { uuidParams } from './plugins/_shared/uuid-param.js';
import { toE164, maskPhone } from './plugins/_shared/phone.js';
import { parseDob, parseGender } from './plugins/_shared/enrolment.js';
import { hashPassword, verifyPassword } from './auth.js';
import { substitutionSuggestions } from './plugins/_shared/substitute-suggest.js';
import { FULL_PII, ADMIN as ADMISSIONS_ADMIN, FOLLOWUP_WEIGHTS, CLOSED_STAGES, parseGradeApplied } from './plugins/_shared/admissions-access.js';
import { customRoles, canReach } from './custom-roles.js';
import { reachableDoors, capabilitiesFor } from './effective-access.js';
import { istNow, istToday } from './ist.js';
import { decryptSettings, encryptSettings, maskSettings } from './settings-crypto.js';
import { planIncludes, PLUGIN_PLAN, feeFeatureIncluded, feeEntitlements, feeNotEntitled } from './entitlements.js';
import { enabledCapability } from './plugin-capabilities.js';
import { selectOverdue, selectBeforeDue, selectEscalation, overdueBody, beforeDueBody, escalationBody, overdueDedup, beforeDueDedup, escalationDedup, outstanding } from './fees/dunning.js';
import { findDiscrepancies, raiseDiscrepancyActions, recordReconRun } from './fees/reconcile.js';
import { splitInstallments } from './fees/installments.js';
import { receiptPdf } from './fees/receipt-pdf.js';
import { putFile, storageBase } from './file-artifacts.js';
import { moneyError } from './error-codes.js';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

/* OPP-API-9: the board pack runs several full-table aggregates; cache the per-tenant roll-up for a
   short window so a hot owner surface cannot be used as a cheap aggregate amplifier. */
const BOARD_PACK_TTL_MS = 30_000;
const boardPackCache = new Map(); // tenant_id -> { at:number, data:object }

/* Stable JSON (recursively sorted keys) so a content hash computed at write time still re-derives
   after PostgreSQL jsonb has normalized key order — a snapshot's hash must verify. */
const canonicalJson = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
};

export function pageParams(query = {}, { defaultLimit = 100, maxLimit = 500 } = {}) {
  const rawLimit = query.limit == null || query.limit === '' ? defaultLimit : Number(query.limit);
  const rawOffset = query.offset == null || query.offset === '' ? 0 : Number(query.offset);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit;
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  return { limit, offset };
}

/* School classes & sections — the school's own structure, authored by the owner, principal or IT
   admin. Stored in `app.tenants.config.setup.sections` in the SAME shape onboarding writes:
   `[{ grade: '6', sections: ['A', 'B'] }]`, so student rosters, class transfers and every class
   filter read ONE source. Nothing is fabricated — a new school starts with an empty list and the
   setup checklist points here. Pure + exported so the GET door normalises stored rows identically. */
export function normalizeClasses(input) {
  if (!Array.isArray(input)) return { ok: false, error: 'classes must be a list' };
  if (input.length > 60) return { ok: false, error: 'Too many classes — the maximum is 60' };
  const out = [];
  const seenGrades = new Set();
  for (const raw of input) {
    const grade = String(raw?.grade ?? '').trim().slice(0, 40);
    if (!grade) return { ok: false, error: 'Every class needs a name' };
    if (seenGrades.has(grade.toLowerCase())) return { ok: false, error: `Class '${grade}' is listed twice` };
    seenGrades.add(grade.toLowerCase());
    const rawSections = Array.isArray(raw?.sections) ? raw.sections : [];
    if (rawSections.length > 30) return { ok: false, error: `Too many sections in class '${grade}' (max 30)` };
    const sections = [];
    const seenSections = new Set();
    for (const s of rawSections) {
      const name = String(s ?? '').trim().toUpperCase().slice(0, 8);
      if (!name) continue;
      if (seenSections.has(name)) return { ok: false, error: `Section '${name}' is listed twice in class '${grade}'` };
      seenSections.add(name);
      sections.push(name);
    }
    out.push({ grade, sections });
  }
  return { ok: true, classes: out };
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

/* H2/L5 — ONE audience resolver, read as the UNION of the two ways a family is stored.
   `app.guardians` is the office-entered guardian row; a parent who signs up is a `parent` USER
   linked through `family.child_link` and has NO guardians row at all. The resolver read only
   the first arm, so every notice for an app-onboarded family (route, class, an explicit
   student, all_guardians) resolved ZERO recipients and silently reached nobody. Every audience
   is now described ONCE and read through both arms, so the two cannot drift apart again. */
const NOTICE_ARMS = [
  // the office-entered guardian record
  { alias: 'g', from: 'app.guardians g', scope: 'g.tenant_id=$1', phone: 'g.phone', student: 's.id = g.student_id' },
  // the parent ACCOUNT, linked to a child (only an active parent speaks for the family)
  { alias: 'cl', from: 'family.child_link cl JOIN app.users u ON u.id = cl.user_id',
    scope: "cl.tenant_id=$1 AND u.active AND u.role='parent'", phone: 'u.phone', student: 's.id = cl.student_id' },
];
const noticeArm = (arm, predicate) =>
  `SELECT DISTINCT ${arm.phone} AS phone FROM ${arm.from}${/\bs\./.test(predicate) ? ` JOIN app.students s ON ${arm.student}` : ''}
    WHERE ${arm.scope} AND ${predicate} AND ${arm.phone} IS NOT NULL`;

export async function resolveNoticeRecipients(c, tenantId, p) {
  const explicit = Array.isArray(p?.recipients) ? p.recipients.map(toE164).filter(Boolean) : [];
  if (explicit.length) return [...new Set(explicit)];
  if (p?.audienceKind === 'staff') {
    const r = await c.query(
      `SELECT DISTINCT phone FROM app.users WHERE tenant_id=$1 AND active AND role NOT IN ('parent','student') AND phone IS NOT NULL`,
      [tenantId]);
    return [...new Set(r.rows.map((x) => toE164(x.phone)).filter(Boolean))];
  }
  const ids = [...(Array.isArray(p?.studentIds) ? p.studentIds : []), ...(p?.studentId ? [p.studentId] : [])]
    .filter((v) => UUID_RE_NOTICE.test(String(v)));
  // transport notices name a bus route; the roster is students.bus_route
  const spec =
    ids.length ? { predicate: (scope) => `${scope}.student_id = ANY($2::uuid[])`, params: [ids] }
    : p?.routeCode ? { predicate: () => 's.bus_route=$2', params: [String(p.routeCode)] }
    : p?.audienceKind === 'class' && p?.audienceRef ? { predicate: () => 's.grade=$2', params: [String(p.audienceRef)] }
    : p?.audienceKind === 'route' && p?.audienceRef ? { predicate: () => 's.bus_route=$2', params: [String(p.audienceRef)] }
    : p?.audienceKind === 'all_guardians' ? { predicate: () => 'true', params: [] }
    : null;
  if (!spec) return [];
  const out = new Set();
  for (const arm of NOTICE_ARMS) {
    const sql = noticeArm(arm, spec.predicate(arm.alias));
    for (const row of (await c.query(sql, [tenantId, ...spec.params])).rows) {
      const phone = toE164(row.phone);
      if (phone) out.add(phone);
    }
  }
  return [...out];
}

/** OPP-PRD-3: the in-app audience is guardian/staff USER ids (notifications), not phones. */
export async function resolveNoticeUserIds(c, tenantId, p) {
  const ids = [];
  const push = (rows) => { for (const r of rows) if (r.user_id) ids.push(r.user_id); };
  if (p?.audienceKind === 'staff') {
    push((await c.query(`SELECT id AS user_id FROM app.users WHERE tenant_id=$1 AND active AND role NOT IN ('parent','student')`, [tenantId])).rows);
  } else if (p?.audienceKind === 'class' && p?.audienceRef) {
    push((await c.query(`SELECT cl.user_id FROM family.child_link cl JOIN app.students s ON s.id=cl.student_id WHERE cl.tenant_id=$1 AND s.grade=$2`, [tenantId, String(p.audienceRef)])).rows);
  } else if (p?.audienceKind === 'route' && p?.audienceRef) {
    push((await c.query(`SELECT cl.user_id FROM family.child_link cl JOIN app.students s ON s.id=cl.student_id WHERE cl.tenant_id=$1 AND s.bus_route=$2`, [tenantId, String(p.audienceRef)])).rows);
  } else {
    push((await c.query(`SELECT DISTINCT user_id FROM family.child_link WHERE tenant_id=$1`, [tenantId])).rows);
  }
  return [...new Set(ids)];
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
    const capabilities = capabilitiesFor(doors, undefined, req.user.role);
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
    if (b.base_role === 'owner') return bad(reply, 'A custom role cannot be based on the owner role');
    if (b.base_role === 'principal' && req.user.role !== 'owner')
      return bad(reply, 'Only the school owner can create a custom role based on the principal role', 403);
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
      if (base === 'owner') return bad(reply, 'A custom role cannot be based on the owner role');
      if (base === 'principal' && req.user.role !== 'owner')
        return bad(reply, 'Only the school owner can create a custom role based on the principal role', 403);
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
  app.post('/roles/:key/assign', { preHandler: [require(...ROLES_ADMIN), app.requireStepUp] }, async (req, reply) => {
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

  app.post('/roles/:key/unassign', { preHandler: [require(...ROLES_ADMIN), app.requireStepUp] }, async (req, reply) => {
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

  // F1: link a roster student to their student-role user when the name match is UNAMBIGUOUS (exactly one
  // roster row and one student user with that name). Best-effort: an ambiguous name stays unlinked.
  const linkStudentUser = async (c, tenantId, studentId, name) => {
    try {
      await c.query(
        `UPDATE app.students s SET user_id = u.id
           FROM app.users u
          WHERE s.id=$1 AND s.tenant_id=$2 AND s.user_id IS NULL
            AND u.tenant_id=$2 AND u.role='student' AND lower(u.name)=lower($3)
            AND (SELECT count(*) FROM app.students d WHERE d.tenant_id=$2 AND lower(d.name)=lower($3)) = 1
            AND (SELECT count(*) FROM app.users u2 WHERE u2.tenant_id=$2 AND u2.role='student' AND lower(u2.name)=lower($3)) = 1`,
        [studentId, tenantId, name]);
    } catch { /* best-effort link; a name mismatch just leaves user_id null */ }
  };

  /* P2-7 · dob + gender come from the shared parsers (module scope, above) so the manual form, the
   CSV import and the record edit cannot answer three different ways about the same value. */
  app.post('/students', { preHandler: require('owner','principal','coordinator','admissions','itadmin') }, async (req, reply) => {
    const b = req.body ?? {};
    for (const f of ['name','grade','section']) if (!b[f]) return bad(reply, `${f} required`);
    const dob = parseDob(b.dob ?? b.dateOfBirth);
    if (!dob.ok) return bad(reply, dob.error);
    const gender = parseGender(b.gender);
    if (!gender.ok) return bad(reply, gender.error);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const grade = String(b.grade).trim();
      const section = String(b.section).trim();

      /* P2-6: a pupil must land in a class this school actually has. The door took `grade` as
         free text and stored it verbatim, so "Grade 77" or "Grade 99 · Z" was accepted with 200
         and the child became invisible to every screen that reads the school's own structure —
         roster, attendance filter, timetable cell, fee plan. Both the CSV import and this door
         needed it; the import fixes its rows per-row, this one refuses the request.
         A school that has not defined its classes yet is NOT blocked — structure is optional
         at onboarding, so an empty list means "nothing to check against", not "reject". */
      const cfg = (await c.query(`SELECT config FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0];
      const parsed = normalizeClasses(cfg?.config?.setup?.sections ?? []);
      if (parsed.ok && parsed.classes.length) {
        const cls = parsed.classes.find((x) => x.grade === grade);
        if (!cls) {
          return bad(reply, `"${grade}" is not one of this school's classes. Add it on the Classes & sections screen first, or pick one of: ${parsed.classes.map((x) => x.grade).join(', ')}`);
        }
        if (!cls.sections.includes(section)) {
          return bad(reply, `Section "${section}" is not one of ${cls.grade}'s sections. Use one of: ${cls.sections.join(', ') || '(none configured)'}`);
        }
      }

      const code = String(b.admissionNo ?? `ADM-${Date.now().toString(36)}`).trim();

      /* P2-5: admission_no carries UNIQUE (tenant_id, admission_no) (migration 001), so a
         duplicate used to reach the INSERT and surface as an unhandled 23505 — a raw 500 with
         no indication of which number collided. Check first and answer 409 with the pupil it
         belongs to, which is what the caller can actually act on. */
      const clash = (await c.query(
        `SELECT name, grade, section FROM app.students WHERE tenant_id=$1 AND admission_no=$2`,
        [req.user.tenant_id, code])).rows[0];
      if (clash) {
        return bad(reply, `Admission number ${code} is already used by ${clash.name} (${clash.grade}-${clash.section}). Admission numbers must be unique.`, 409);
      }

      /* P2-8: duplicate detection. Two active pupils with the same name in one school is almost
         always a double entry — and the school cannot tell them apart in a roster, which sorts
         and filters by name. Siblings are named differently in practice; where a school genuinely
         has two, the fix is to give the second one a distinct admission number and correct the
         name, and this message says which pupil to look at. */
      const sameName = (await c.query(
        `SELECT admission_no, grade, section FROM app.students
          WHERE tenant_id=$1 AND lower(name)=lower($2) AND status='active' LIMIT 1`,
        [req.user.tenant_id, String(b.name).trim()])).rows[0];
      if (sameName) {
        return bad(reply, `${String(b.name).trim()} is already enrolled in this school (${sameName.admission_no}, ${sameName.grade}-${sameName.section}). Search before enrolling again — a second pupil with the same name cannot be told apart in a roster.`, 409);
      }

      const r = await c.query(
        `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone, bus_route, dob, gender, source, source_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [req.user.tenant_id, code, b.name, grade, section, b.guardianName ?? null, b.guardianPhone ?? null, b.busRoute ?? null, dob.value, gender.value, 'staff', req.user.id]);
      const student = r.rows[0];
      await linkStudentUser(c, req.user.tenant_id, student.id, b.name);
      /* M1: keep the canonical guardian contact table in sync at creation. The manual roster door
         previously wrote only the denormalised `students.guardian_*` columns, so `app.guardians`
         stayed empty for app-created students — and absence/visitor/audience lookups found no
         contact. Both guardian models are now written together. */
      if (b.guardianName && b.guardianPhone) {
        await c.query(
          `INSERT INTO app.guardians (tenant_id, student_id, name, phone, relation, is_primary)
           VALUES ($1,$2,$3,$4,'guardian',true)`,
          [req.user.tenant_id, student.id, b.guardianName, b.guardianPhone]);
      }
      // Structural phone match only (never name-equality): bind an existing parent account so the
      // family sees the child immediately. No match means the parent is provisioned via people.admin.
      if (b.guardianPhone) {
        const parent = (await c.query(
          `SELECT id FROM app.users WHERE tenant_id=$1 AND role='parent' AND active=true AND phone=$2 ORDER BY created_at ASC LIMIT 1`,
          [req.user.tenant_id, b.guardianPhone])).rows[0];
        if (parent) {
          await c.query(
            `INSERT INTO family.child_link (tenant_id, user_id, student_id, relation, is_primary)
             VALUES ($1,$2,$3,'guardian',true) ON CONFLICT (tenant_id, user_id, student_id) DO NOTHING`,
            [req.user.tenant_id, parent.id, student.id]);
        }
      }
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Created student', recordType: 'Student', recordRef: code, reason: b.reason ?? 'manual entry', outcome: 'created' });
      await emitEvent(c, req.user.tenant_id, { type: 'people', label: `Student enrolled — ${b.name} (${b.grade}-${b.section})`, ref: code });
      return { student };
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
      let noticesQueued = 0;
      if (newlyAbsent.length) {
        await emitEvent(c, req.user.tenant_id,
          { type: 'attendance', label: `attendance.marked — ${marks.length} students on ${date} · ${newlyAbsent.length} newly absent`, severity: newlyAbsent.length > 2 ? 'warn' : 'info' },
          'attendance.absences', { date, absentCount: newlyAbsent.length });
        /* M1: resolve each newly-absent child's guardian phone from EITHER guardian model.
           `app.guardians` is the canonical contact table (visitors/library/audience doors read it),
           while app-onboarded families link a parent USER structurally via `family.child_link`.
           The defect was that only `app.guardians` was read — empty for app-created students — so
           absence notices never queued. Reading the union means a notice is queued whichever path
           created the family; DISTINCT keeps one row per (child, phone). */
        const info = await c.query(
          `SELECT DISTINCT s.id AS student_id, s.name, t.phone
             FROM app.students s
             JOIN (
               SELECT g.student_id, g.phone FROM app.guardians g WHERE g.is_primary AND g.phone IS NOT NULL
               UNION
               SELECT cl.student_id, u.phone FROM family.child_link cl
                 JOIN app.users u ON u.id = cl.user_id
                WHERE u.phone IS NOT NULL AND u.active
             ) t ON t.student_id = s.id
            WHERE s.id = ANY($1::uuid[])`, [newlyAbsent.map(m => m.studentId)]);
        for (const g of info.rows) {
          await c.query(
            `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, policy_ref, dedup_key)
             VALUES ($1, $2::jsonb, 'whatsapp', 'ABSENCE_NOTICE', $3, 'Attendance §1.1', $4)`,
            [req.user.tenant_id, JSON.stringify([g.phone]), `Absence notice for ${g.name} (${date}) — please confirm.`, randomUUID()]);
          noticesQueued += 1;
        }
      }
      // M2: report the number of communication rows actually inserted (and guardians resolved),
      // never the number of newly-absent students — the old value reported 1 when 0 were queued.
      return { ok: true, marked: marks.length, absent: absents.length, noticesQueued, guardiansResolved: noticesQueued };
    });
  });

  // ============ school classes & sections (school structure) ============
  // The school's own class list. Owner, principal and IT admin define it; every roster, class
  // transfer and class/section filter reads it. A new school starts EMPTY (onboarding writes []) —
  // nothing is fabricated, and the setup checklist points the owner here. The read door is open to
  // any authenticated caller (a class NAME is not sensitive; the write door is gated).
  const CLASSES_ADMIN = ['owner', 'principal', 'itadmin'];
  app.get('/school/classes', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = (await c.query(`SELECT config FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0];
      const parsed = normalizeClasses(t?.config?.setup?.sections ?? []);
      return { classes: parsed.ok ? parsed.classes : [] };
    });
  });

  app.put('/school/classes', { preHandler: require(...CLASSES_ADMIN) }, async (req, reply) => {
    const parsed = normalizeClasses(req.body?.classes);
    if (!parsed.ok) return bad(reply, parsed.error);
    const classes = parsed.classes;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // FOR UPDATE: read-modify-write on the JSONB config loses a concurrent profile edit without it.
      const cur = (await c.query(`SELECT name, config FROM app.tenants WHERE id=$1 FOR UPDATE`, [req.user.tenant_id])).rows[0];
      if (!cur) return reply.code(404).send({ error: 'School not found' });
      const nextConfig = { ...(cur.config ?? {}) };
      nextConfig.setup = { ...(nextConfig.setup ?? {}), sections: classes, updatedAt: new Date().toISOString() };
      await c.query(`UPDATE app.tenants SET config=$1::jsonb WHERE id=$2`, [JSON.stringify(nextConfig), req.user.tenant_id]);
      /* F3: keep the normalized structure in step with the config the pickers read. Upsert every
         class/section, then mark the ones no longer listed inactive — never DELETE (D-35). The JSONB
         config stays the fast read; these tables are the real references new code can join on. */
      for (const [i, cls] of classes.entries()) {
        const row = (await c.query(
          `INSERT INTO app.classes (tenant_id, name, sort_idx, active) VALUES ($1,$2,$3,true)
           ON CONFLICT (tenant_id, name) DO UPDATE SET sort_idx=EXCLUDED.sort_idx, active=true RETURNING id`,
          [req.user.tenant_id, cls.grade, i])).rows[0];
        for (const sec of cls.sections) {
          await c.query(
            `INSERT INTO app.sections (tenant_id, class_id, name, active) VALUES ($1,$2,$3,true)
             ON CONFLICT (tenant_id, class_id, name) DO UPDATE SET active=true`,
            [req.user.tenant_id, row.id, sec]);
        }
        await c.query(
          `UPDATE app.sections SET active=false WHERE tenant_id=$1 AND class_id=$2 AND active AND name <> ALL($3::text[])`,
          [req.user.tenant_id, row.id, cls.sections]);
      }
      await c.query(
        `UPDATE app.classes SET active=false WHERE tenant_id=$1 AND active AND name <> ALL($2::text[])`,
        [req.user.tenant_id, classes.map((x) => x.grade)]);
      const sectionCount = classes.reduce((n, x) => n + x.sections.length, 0);
      await auditLog(c, req.user.tenant_id, {
        actor: req.user.name, actorRole: req.user.role, action: 'Updated classes & sections',
        recordType: 'Tenant', recordRef: cur.name,
        reason: `classes: ${classes.map((x) => `${x.grade}(${x.sections.join('/') || 'no sections'})`).join(', ') || 'none'}`,
        policyRef: 'School structure', risk: 'low',
        outcome: `${classes.length} class(es) · ${sectionCount} section(s)`,
      });
      await emitEvent(c, req.user.tenant_id,
        { type: 'platform', label: `Classes & sections updated (${classes.length} classes)` },
        'platform.school.classes.updated.v1', { by: req.user.id, classes: classes.length, sections: sectionCount });
      return { ok: true, classes };
    });
  });

  // ============ school profile (tenant identity & contact) ============
  // The school's own identity card: name, structured address, contacts,
  // timezone. Owner-only read AND write — contact details are not roster
  // data for every caller, and the School profile screen (`/school-profile`,
  // which writes through POST /onboard/school) prefills from this door. The
  // SURFACE_DOOR entry names this read so canSurface answers exactly where
  // the doors admit.
  const PROFILE_KEYS = ['address', 'city', 'state', 'postalCode', 'country', 'board', 'phone', 'email', 'website', 'timezone'];
  app.get('/school/profile', { preHandler: require('owner') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = (await c.query(`SELECT name, slug, onboarded_at, config FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0];
      if (!t) return { school: null };
      const cfg = t.config ?? {};
      const profile = {};
      for (const k of PROFILE_KEYS) profile[k] = typeof cfg[k] === 'string' ? cfg[k] : '';
      if (!profile.timezone) profile.timezone = 'Asia/Kolkata';
      return { school: { name: t.name, slug: t.slug, onboardedAt: t.onboarded_at, profile } };
    });
  });

  // ============ school setup guide (Part 1: the people chain) ============
  // One read for the Setup guide screen (`/setup`): each stage of staffing a new
  // school — school card → principal → IT admin → classes → teachers → students →
  // desk roles → finance roles → parent/pupil portal access — with live done-flags
  // and counts. Owner, principal and IT admin only: each stage's write doors re-gate (principal appoints the
  // IT admin and nothing else; the owner appoints the principal; the IT admin
  // fills the roster), so the surface answers exactly where the chain admits.
  // The SURFACE_DOOR entry names this read.
  app.get('/school/setup', { preHandler: require('owner', 'principal', 'itadmin') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = (await c.query(`SELECT name, slug, config FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0];
      const counts = (await c.query(
        `SELECT
           (SELECT count(*)::int FROM app.users WHERE tenant_id=$1 AND role='principal' AND active) AS principals,
           (SELECT count(*)::int FROM app.users WHERE tenant_id=$1 AND role='itadmin' AND active) AS itadmins,
           (SELECT count(*)::int FROM app.users WHERE tenant_id=$1 AND role='teacher' AND active) AS teachers,
           (SELECT count(*)::int FROM app.users WHERE tenant_id=$1 AND active
              AND role IN ('coordinator','counselor','admissions','transport','facilities','technician','librarian')) AS desk,
           (SELECT count(*)::int FROM app.users WHERE tenant_id=$1 AND active
              AND role IN ('finance','finance_head','finance_clerk')) AS finance,
           (SELECT count(*)::int FROM app.students WHERE tenant_id=$1 AND status='active') AS students,
           (SELECT count(*)::int FROM app.users WHERE tenant_id=$1 AND role='parent' AND active) AS parents,
           (SELECT count(*)::int FROM app.guardians WHERE tenant_id=$1) AS guardians`, [req.user.tenant_id])).rows[0];
      const cfg = t?.config ?? {};
      const sections = t?.config?.setup?.sections ?? [];
      return {
        school: { name: t?.name ?? null, slug: t?.slug ?? null },
        stages: [
          { id: 'school', label: 'School details', hint: 'Name, address, contacts, timezone — what invoices and reports read.', done: true, href: '/school-profile' },
          { id: 'principal', label: 'Appoint your principal', hint: 'Owner only. The principal runs the school day-to-day and appoints the IT admin.', done: counts.principals > 0, count: counts.principals },
          { id: 'itadmin', label: 'Create your IT admin', hint: 'Owner or principal. The IT admin adds everyone else, so you do not have to.', done: counts.itadmins > 0, count: counts.itadmins },
          { id: 'classes', label: 'Define your classes and sections', hint: 'Every roster, picker and filter reads this list.', done: sections.length > 0, count: sections.length, href: '/classes' },
          { id: 'teachers', label: 'Add teachers', hint: 'One by one on the People console — every class needs its teachers first.', done: counts.teachers > 0, count: counts.teachers, href: '/people-admin' },
          { id: 'students', label: 'Admit students', hint: 'One by one, CSV import, or the full migration load.', done: counts.students > 0, count: counts.students, href: '/people-admin' },
          { id: 'desk', label: 'Add desk roles', hint: 'Admissions, transport, front desk, counsellor, librarian — whoever runs each counter.', done: counts.desk > 0, count: counts.desk, href: '/people-admin' },
          { id: 'finance', label: 'Add finance roles', hint: 'Fee collection and payroll need their owners before Part 2 switches fees on.', done: counts.finance > 0, count: counts.finance, href: '/people-admin' },
          { id: 'portals', label: 'Give parents and pupils portal access', hint: 'Guardian accounts linked to their children; pupil accounts from the roster.', done: counts.parents > 0 || counts.guardians > 0, count: counts.parents, href: '/people-admin' },
        ],
      };
    });
  });

  // ============ subjects (F3) ============
  // The school's own subject list — the real references behind the free-text `subject` columns in
  // timetable/homework/exams. Any authenticated caller may read it (a subject name is not sensitive);
  // owner/principal/IT admin define it. Adding a subject that already exists is idempotent, never a 409.
  app.get('/school/subjects', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const subjects = (await c.query(
        `SELECT id, name, code, is_elective AS "isElective", is_skill AS "isSkill" FROM app.subjects WHERE tenant_id=$1 AND active ORDER BY name`,
        [req.user.tenant_id])).rows;
      return { subjects };
    });
  });

  app.post('/school/subjects', { preHandler: require(...CLASSES_ADMIN) }, async (req, reply) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
    if (!name) return bad(reply, 'A subject name is required');
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().slice(0, 12) || null : null;
    const isElective = req.body?.isElective === true;
    const isSkill = req.body?.isSkill === true;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `INSERT INTO app.subjects (tenant_id, name, code, active, is_elective, is_skill) VALUES ($1,$2,$3,true,$4,$5)
         ON CONFLICT (tenant_id, name) DO UPDATE SET active=true, code=COALESCE(EXCLUDED.code, app.subjects.code),
           is_elective=EXCLUDED.is_elective, is_skill=EXCLUDED.is_skill
         RETURNING id, name, code, is_elective AS "isElective", is_skill AS "isSkill"`, [req.user.tenant_id, name, code, isElective, isSkill])).rows[0];
      await auditLog(c, req.user.tenant_id, {
        actor: req.user.name, actorRole: req.user.role, action: 'Subject added',
        recordType: 'Tenant', recordRef: name, reason: 'school structure', policyRef: 'School structure',
        risk: 'low', outcome: `subject '${name}'${code ? ` (${code})` : ''}` });
      await emitEvent(c, req.user.tenant_id,
        { type: 'platform', label: `Subject added — ${name}` }, 'platform.school.subject.added.v1', { name, code });
      return { subject: row };
    });
  });

  // ============ class assignments (PRD-2) ============
  // Who owns which register. Without this the attendance door above could only answer 403 to every teacher,
  // and this pair of doors is what makes a school able to run its own daily workflow instead of routing every
  // class through the principal's office. Assignment is an ADMINISTRATIVE act (principal office) — a teacher
  // must not be able to grant themselves a class, which is the whole authority being delegated.

  /* P2-15 · the staff NAME PICKER. Two screens need to name a teacher by REFERENCE rather than by
     typing a name — the timetable slot editor (a slot storing `teacher_name` as free text cannot be
     reasoned about by the substitution engine, and a renamed teacher leaves every past slot naming
     someone who no longer exists) and the class-ownership panel. Both had exactly one way to get a
     teacher list: `GET /plugins/people.admin/users`, which the identity authority gates to owner and
     IT admin. A coordinator — who may write both the class assignment and the timetable slot — got an
     empty picker and had to ask a principal.

     This is the minimal read those two writes need: id + name + role for ACTIVE accounts, no email,
     no phone, no contact details, and never a password or session field. */
  app.get('/school/staff', { preHandler: require('owner', 'principal', 'coordinator', 'itadmin', 'finance_head') }, async (req, reply) => {
    if (req.user.role === 'api' && !req.apiScopes?.includes('users.read')) return bad(reply, 'API key lacks the users.read scope', 403);
    const { role } = req.query ?? {};
    const want = typeof role === 'string' && role.trim() ? role.trim().split(',').map((r) => r.trim()).filter(Boolean) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const staff = (await c.query(
        `SELECT id, name, role FROM app.users
          WHERE tenant_id=$1 AND active
            AND ($2::text[] IS NULL OR role = ANY($2::text[]))
            AND role NOT IN ('parent','student','api')
          ORDER BY name LIMIT 500`,
        [req.user.tenant_id, want])).rows;
      return { staff };
    });
  });

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

  app.post('/academic-years', { preHandler: require('owner', 'principal', 'finance', 'finance_head') }, async (req, reply) => {
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

  // ---- Master Action Plan · MPD compliance vault + RTE/EWS ledger + payroll-lite + billing ----
  // MPD: the Appendix-IX disclosure wall — every row an inspection can ask for, with its state.
  const MPD_REQUIRED = [
    { kind: 'affiliation_letter', label: 'Affiliation / upgradation letter + latest extension' },
    { kind: 'trust_registration', label: 'Society / Trust / Company registration (valid)' },
    { kind: 'noc_state', label: 'State NOC for CBSE affiliation' },
    { kind: 'rte_recognition', label: 'RTE recognition certificate (Class 1–8)' },
    { kind: 'building_safety', label: 'Building safety certificate (National Building Code)' },
    { kind: 'fire_safety', label: 'Fire safety certificate' },
    { kind: 'deo_certificate', label: 'DEO certificate / self-certification' },
    { kind: 'water_health_sanitation', label: 'Water, health & sanitation certificates' },
    { kind: 'fee_structure', label: 'Fee structure' },
    { kind: 'academic_calendar', label: 'Annual academic calendar' },
    { kind: 'smc_list', label: 'School Management Committee list' },
    { kind: 'pta_members', label: 'Parent-Teacher Association members' },
    { kind: 'board_results', label: 'Last three years board results' },
    { kind: 'staff_qualifications', label: 'Staff list with qualifications' },
  ];
  const mpdStatus = (doc) => {
    if (!doc) return 'missing';
    if (doc.expires_on && new Date(doc.expires_on).getTime() < Date.now() + 60 * 864e5) return 'expiring';
    return 'ok';
  };
  app.get('/compliance/mpd', { preHandler: roleGatedMe('owner', 'principal', 'itadmin', 'coordinator') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const docs = (await c.query(
        `SELECT id, name, kind, expires_on, created_at FROM app.mpd_docs WHERE active ORDER BY kind, created_at DESC`)).rows;
      const byKind = new Map();
      for (const d of docs) if (!byKind.has(d.kind)) byKind.set(d.kind, d);
      const checklist = MPD_REQUIRED.map((r) => {
        const d = byKind.get(r.kind) ?? null;
        return { ...r, status: mpdStatus(d), detail: d ? `${d.name}${d.expires_on ? ` · expires ${String(d.expires_on).slice(0, 10)}` : ''}` : 'Not on record — file it before an inspection asks', href: '/mpd' };
      });
      const t = (await c.query(`SELECT slug, name FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0];
      const updatedAt = docs.length ? docs.map((d) => d.created_at).sort().pop() : null;
      return { checklist, docs, disclosure: { url: `/public/disclosure?tenant=${t?.slug ?? ''}`, updatedAt } };
    });
  });
  app.post('/compliance/mpd/docs', { preHandler: require('owner', 'principal', 'itadmin') }, async (req, reply) => {
    const b = req.body ?? {};
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 160) : '';
    const kind = typeof b.kind === 'string' ? b.kind.trim().slice(0, 60) : '';
    if (!name) return bad(reply, 'Name the document (e.g. Fire safety certificate 2026-27)');
    if (!MPD_REQUIRED.some((r) => r.kind === kind)) return bad(reply, `kind must be one of: ${MPD_REQUIRED.map((r) => r.kind).join(', ')}`);
    let expiresOn = null;
    if (b.expiresOn !== undefined && b.expiresOn !== null && String(b.expiresOn).trim() !== '') {
      if (!DATE_RE.test(String(b.expiresOn).trim())) return bad(reply, 'expiresOn must be YYYY-MM-DD');
      expiresOn = String(b.expiresOn).trim();
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `INSERT INTO app.mpd_docs (tenant_id, name, kind, expires_on, created_by)
         VALUES ($1,$2,$3,$4::date,$5) RETURNING id, name, kind, expires_on`,
        [req.user.tenant_id, name, kind, expiresOn, req.user.id])).rows[0];
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Filed disclosure document', recordType: 'MpdDoc', recordRef: row.id, reason: kind, policyRef: 'CBSE Affiliation Bye-Laws (MPD)', risk: 'low', outcome: `${name}${expiresOn ? ` · expires ${expiresOn}` : ''}` });
      await emitEvent(c, req.user.tenant_id, { type: 'compliance', label: `Disclosure filed — ${name}`, ref: row.id });
      return { doc: row };
    });
  });
  app.post('/compliance/mpd/docs/:id/retire', { preHandler: [require('owner', 'principal', 'itadmin'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `UPDATE app.mpd_docs SET active=false, retired_at=now() WHERE id=$1 AND tenant_id=$2 AND active RETURNING id, name`,
        [req.params.id, req.user.tenant_id]);
      if (!r.rows[0]) return bad(reply, 'No active document with that id', 404);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Retired disclosure document', recordType: 'MpdDoc', recordRef: r.rows[0].id, reason: 'superseded/expired', policyRef: 'CBSE Affiliation Bye-Laws (MPD)', risk: 'low', outcome: `${r.rows[0].name} retired (history kept)` });
      return { ok: true };
    });
  });
  // Public by law: the disclosure wall is what an inspector or parent reads without signing in.
  // Institutional certificates only — never pupil, guardian, fee or staff PII.
  app.get('/public/disclosure', async (req, reply) => {
    const slug = typeof req.query?.tenant === 'string' ? req.query.tenant.trim().toLowerCase().slice(0, 80) : '';
    if (!slug) return bad(reply, 'tenant query (school code) is required');
    const t = await sysq(`SELECT id, name, slug FROM app.tenants WHERE slug=$1`, [slug]);
    const tenant = t.rows[0];
    if (!tenant) return reply.code(404).send({ error: 'No school with that code' });
    const docs = (await sysq(
      `SELECT name, kind, expires_on FROM app.mpd_docs WHERE tenant_id=$1 AND active ORDER BY kind`,
      [tenant.id])).rows;
    return { school: { name: tenant.name, slug: tenant.slug }, disclosures: docs, generatedAt: new Date().toISOString() };
  });

  // RTE §12(1)(c): the 25% quota lives on the roster (source='rte-lottery') + an auto-approved
  // statutory waiver, so reimbursement, fee and audit all read the same truth.
  const RTE_ENTRY_GRADES = ['Nursery', 'Jr KG', 'Sr KG', '1'];
  app.get('/rte/overview', { preHandler: roleGatedMe('owner', 'principal', 'coordinator', 'admissions', 'itadmin', 'finance', 'finance_head', 'finance_clerk') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const grades = RTE_ENTRY_GRADES;
      const total = (await c.query(
        `SELECT count(*)::int AS n FROM app.students WHERE status='active' AND grade = ANY($1::text[])`, [grades])).rows[0].n;
      const filled = (await c.query(
        `SELECT count(*)::int AS n FROM app.students WHERE status='active' AND source='rte-lottery' AND grade = ANY($1::text[])`, [grades])).rows[0].n;
      const quotaSeats = Math.ceil(total * 25 / 100);
      const money = (await c.query(
        `SELECT COALESCE(sum(amount_cents) FILTER (WHERE status IN ('claimed','partial')),0)::int AS claimed,
                COALESCE(sum(amount_cents) FILTER (WHERE status='received'),0)::int AS received
           FROM app.rte_reimbursements`)).rows[0];
      const pending = Math.max(0, money.claimed - money.received);
      const recent = (await c.query(
        `SELECT admission_no, name, grade, section FROM app.students WHERE source='rte-lottery' AND status='active' ORDER BY created_at DESC LIMIT 10`)).rows;
      return {
        quotaPct: 25, entryGrades: grades,
        seats: { total, reserved: quotaSeats, filled, remaining: Math.max(0, quotaSeats - filled) },
        reimbursements: { claimed_cents: money.claimed, received_cents: money.received, pending_cents: pending },
        recent,
      };
    });
  });
  app.post('/rte/lottery/import', { preHandler: require('owner', 'principal', 'coordinator', 'admissions', 'itadmin') }, async (req, reply) => {
    const b = req.body ?? {};
    const year = typeof b.academicYear === 'string' ? b.academicYear.trim().slice(0, 12) : '';
    if (!year) return bad(reply, 'academicYear is required (e.g. 2026-27)');
    if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 200) return bad(reply, 'rows[] with 1–200 lottery winners is required');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // A6: deliberately NOT gated on fees.concessions — the RTE waiver is statutory
      // (the lottery is the authority), not a commercial concession feature. A school
      // without the fees tier still admits its quota children.
      const cfg = (await c.query(`SELECT config FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0];
      const parsed = normalizeClasses(cfg?.config?.setup?.sections ?? []);
      const base = (await c.query(
        `SELECT count(*)::int AS n FROM app.students WHERE admission_no LIKE 'RTE-%'`)).rows[0].n;
      const imported = [];
      const failed = [];
      let seq = base;
      for (const [i, row] of b.rows.entries()) {
        const lineNo = i + 1;
        await c.query('SAVEPOINT rte_row');
        try {
          const name = String(row?.name ?? '').trim();
          const grade = String(row?.grade ?? '').trim();
          const section = String(row?.section ?? 'A').trim() || 'A';
          if (!name) throw new Error('name is required');
          const dob = parseDob(row?.dob);
          if (!dob.ok) throw new Error(dob.error);
          const gender = parseGender(row?.gender);
          if (!gender.ok) throw new Error(gender.error);
          if (parsed.ok && parsed.classes.length) {
            const cls = parsed.classes.find((x) => x.grade === grade);
            if (!cls) throw new Error(`"${grade}" is not one of this school's classes`);
            if (!cls.sections.includes(section)) throw new Error(`section "${section}" is not one of ${grade} (${cls.sections.join(', ')})`);
          }
          const sameName = (await c.query(
            `SELECT admission_no FROM app.students WHERE lower(name)=lower($1) AND status='active' LIMIT 1`, [name])).rows[0];
          if (sameName) throw new Error(`${name} is already enrolled (${sameName.admission_no})`);
          seq += 1;
          const adm = `RTE-${year.replace(/[^0-9]/g, '').slice(0, 8) || '0000'}-${String(seq).padStart(3, '0')}`;
          const st = (await c.query(
            `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone, dob, gender, source, source_ref)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'rte-lottery',$10) RETURNING id, admission_no, name`,
            [req.user.tenant_id, adm, name, grade, section,
             String(row?.guardianName ?? '').trim() || null,
             String(row?.guardianPhone ?? '').trim() || null,
             dob.value, gender.value, `lottery ${year}`])).rows[0];
          if (row?.guardianName && row?.guardianPhone) {
            await c.query(
              `INSERT INTO app.guardians (tenant_id, student_id, name, phone, relation, is_primary)
               VALUES ($1,$2,$3,$4,'guardian',true)`,
              [req.user.tenant_id, st.id, String(row.guardianName).trim(), String(row.guardianPhone).trim()]);
          }
          // Statutory waiver: tuition-free to Class 8 — approved at import (the lottery IS the authority),
          // audited as such. Percent 100 on every obligation the generate fan-out later creates.
          await c.query(
            `INSERT INTO app.fee_concessions (tenant_id, student_id, kind, percent, reason, status, requested_by, approved_by, approved_at)
             VALUES ($1,$2,'waiver',100,$3,'approved',$4,$4,now())`,
            [req.user.tenant_id, st.id, `RTE §12(1)(c) lottery ${year}`, req.user.id]);
          await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'RTE lottery admission', recordType: 'Student', recordRef: adm, reason: `lottery ${year} · ${row?.category ?? 'EWS/DG'}`, policyRef: 'RTE Act §12(1)(c)', risk: 'medium', outcome: `${name} enrolled with statutory waiver` });
          await emitEvent(c, req.user.tenant_id, { type: 'admissions', label: `RTE admission — ${name} (${grade}-${section})`, ref: adm });
          imported.push({ admissionNo: adm, name });
          await c.query('RELEASE SAVEPOINT rte_row');
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT rte_row');
          failed.push({ row: lineNo, error: e.message ?? 'could not import this row' });
        }
      }
      return { imported, failed, failedCount: failed.length };
    });
  });
  app.post('/rte/reimbursements', { preHandler: require('owner', 'principal', 'finance', 'finance_head') }, async (req, reply) => {
    const b = req.body ?? {};
    const year = typeof b.academicYear === 'string' ? b.academicYear.trim().slice(0, 12) : '';
    const amount = Number(b.amountCents);
    if (!year) return bad(reply, 'academicYear is required');
    if (!Number.isInteger(amount) || amount < 0) return bad(reply, 'amountCents must be a non-negative integer (paise)');
    const status = b.status === undefined ? 'claimed' : String(b.status);
    if (!['claimed','received','partial'].includes(status)) return bad(reply, 'status must be claimed|received|partial');
    const claimRef = typeof b.claimRef === 'string' ? b.claimRef.trim().slice(0, 80) || null : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // A3: a named claim is a chain, not a pile — first row must open it as
      // `claimed`; `partial`/`received` need a prior claim; `received` closes it;
      // cumulative received can never exceed what was claimed. Unnamed rows stay
      // free-form (history imports). Uniqueness itself is migration 152.
      if (claimRef) {
        const chain = (await c.query(
          `SELECT status, amount_cents FROM app.rte_reimbursements WHERE tenant_id=$1 AND claim_ref=$2 ORDER BY created_at, id`,
          [req.user.tenant_id, claimRef])).rows;
        if (!chain.length && status !== 'claimed') {
          return bad(reply, `claim ${claimRef} does not exist yet — open it with status claimed first`, 409);
        }
        if (chain.some((x) => x.status === 'received')) {
          return bad(reply, `claim ${claimRef} is already received — closed claims take no further rows`, 409);
        }
        if (status !== 'claimed') {
          const claimed = chain.filter((x) => x.status === 'claimed').reduce((a, x) => a + Number(x.amount_cents), 0);
          const got = chain.filter((x) => x.status !== 'claimed').reduce((a, x) => a + Number(x.amount_cents), 0);
          if (got + amount > claimed) {
            return bad(reply, `claim ${claimRef} claimed ${claimed} paise — this would receive ${got + amount}`, 409);
          }
        }
      }
      let row;
      try {
        row = (await c.query(
          `INSERT INTO app.rte_reimbursements (tenant_id, academic_year, amount_cents, claim_ref, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, academic_year, amount_cents, claim_ref, status`,
          [req.user.tenant_id, year, amount, claimRef, status, req.user.id])).rows[0];
      } catch (e) {
        // A3 race backstop: two writers opening the same named claim — the
        // loser's UNIQUE violation becomes a friendly 409, like lead dedupe.
        if (e?.code === '23505') return bad(reply, `claim ${claimRef ?? year} already has this row — refresh and continue its chain`, 409);
        throw e;
      }
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `RTE reimbursement ${status}`, recordType: 'RteReimbursement', recordRef: row.id, reason: year, policyRef: 'RTE Act §12(2)', risk: 'medium', outcome: `₹${(amount / 100).toFixed(2)} ${status}` });
      return { reimbursement: row };
    });
  });

  // Payroll-lite: structures (monthly + bank/pan) → draft run snapshots → ECS/cash disbursal.
  // Payslips snapshot the structure, so later edits never rewrite paid history (money law).
  const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  const MONTH_RE = /^[0-9]{4}-[0-9]{2}$/;
  const payrollStaff = async (c, tenantId) => (await c.query(
    `SELECT u.id, u.name, u.role, s.monthly_cents AS "monthlyCents",
            CASE WHEN s.bank_acct IS NULL OR s.bank_acct='' THEN NULL ELSE '****' || RIGHT(s.bank_acct, 4) END AS "bankLast4"
       FROM app.users u LEFT JOIN app.payroll_structures s ON s.user_id = u.id
      WHERE u.active AND u.role NOT IN ('parent','student','api')
      ORDER BY u.name`)).rows;
  app.get('/payroll/overview', { preHandler: roleGatedMe('owner', 'finance_head', 'finance_clerk') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const staff = await payrollStaff(c, req.user.tenant_id);
      const runs = (await c.query(
        `SELECT id, month, status, total_cents AS "totalCents", disburse_mode AS "disburseMode", disburse_ref AS "disburseRef",
                created_at AS "createdAt", disbursed_at AS "disbursedAt",
                (SELECT count(*)::int FROM app.payroll_payslips p WHERE p.run_id = app.payroll_runs.id) AS payslips
           FROM app.payroll_runs ORDER BY month DESC LIMIT 6`)).rows;
      const now = new Date();
      return { month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, staff, runs };
    });
  });
  app.put('/payroll/staff/:id', { preHandler: [require('owner', 'finance_head'), uuidParams('id')] }, async (req, reply) => {
    const b = req.body ?? {};
    const monthly = Number(b.monthlyCents);
    if (!Number.isInteger(monthly) || monthly < 0) return bad(reply, 'monthlyCents must be a non-negative integer (paise)');
    const bank = b.bankAcct === undefined || b.bankAcct === null || String(b.bankAcct).trim() === ''
      ? null : String(b.bankAcct).replace(/[\s-]/g, '').slice(0, 34);
    const pan = b.pan === undefined || b.pan === null || String(b.pan).trim() === ''
      ? null : String(b.pan).trim().toUpperCase();
    if (pan && !PAN_RE.test(pan)) return bad(reply, 'pan must look like ABCDE1234F (5 letters, 4 digits, 1 letter)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const u = (await c.query(
        `SELECT id, name, role FROM app.users WHERE id=$1 AND active AND role NOT IN ('parent','student','api')`,
        [req.params.id])).rows[0];
      if (!u) return bad(reply, 'No payable staff with that id (parents, students and API accounts are never on payroll)', 404);
      const row = (await c.query(
        `INSERT INTO app.payroll_structures (tenant_id, user_id, monthly_cents, bank_acct, pan, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, user_id) DO UPDATE
           SET monthly_cents=EXCLUDED.monthly_cents,
               bank_acct=COALESCE(EXCLUDED.bank_acct, app.payroll_structures.bank_acct),
               pan=COALESCE(EXCLUDED.pan, app.payroll_structures.pan),
               updated_by=EXCLUDED.updated_by, updated_at=now()
         RETURNING user_id AS "userId", monthly_cents AS "monthlyCents"`,
        [req.user.tenant_id, u.id, monthly, bank, pan, req.user.id])).rows[0];
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Payroll structure saved', recordType: 'PayrollStructure', recordRef: u.id, reason: `${u.name} (${u.role})`, policyRef: 'Payroll (bank/ECS proof)', risk: 'medium', outcome: `₹${(monthly / 100).toFixed(2)}/month${bank ? ' · bank on file' : ''}${pan ? ' · PAN on file' : ''}` });
      return { structure: { ...row, name: u.name, role: u.role } };
    });
  });
  app.post('/payroll/runs', { preHandler: require('owner', 'finance_head') }, async (req, reply) => {
    const month = typeof req.body?.month === 'string' ? req.body.month.trim() : '';
    if (!MONTH_RE.test(month)) return bad(reply, 'month must be YYYY-MM (e.g. 2026-10)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const dup = (await c.query(`SELECT id, status FROM app.payroll_runs WHERE month=$1`, [month])).rows[0];
      if (dup) return bad(reply, `A pay run for ${month} already exists (${dup.status}) — disburse it or void slips individually`, 409);
      const staff = (await c.query(
        `SELECT u.id, s.monthly_cents FROM app.users u JOIN app.payroll_structures s ON s.user_id = u.id
          WHERE u.active AND u.role NOT IN ('parent','student','api')`)).rows;
      const missing = (await c.query(
        `SELECT name FROM app.users WHERE active AND role NOT IN ('parent','student','api')
           AND id NOT IN (SELECT user_id FROM app.payroll_structures) ORDER BY name`)).rows.map((r) => r.name);
      const run = (await c.query(
        `INSERT INTO app.payroll_runs (tenant_id, month, created_by) VALUES ($1,$2,$3) RETURNING id, month, status`,
        [req.user.tenant_id, month, req.user.id])).rows[0];
      let total = 0;
      for (const s of staff) {
        await c.query(
          `INSERT INTO app.payroll_payslips (tenant_id, run_id, user_id, monthly_cents) VALUES ($1,$2,$3,$4)`,
          [req.user.tenant_id, run.id, s.id, s.monthly_cents]);
        total += s.monthly_cents;
      }
      await c.query(`UPDATE app.payroll_runs SET total_cents=$1 WHERE id=$2`, [total, run.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Payroll run computed', recordType: 'PayrollRun', recordRef: run.id, reason: month, policyRef: 'Payroll (bank/ECS proof)', risk: 'medium', outcome: `${staff.length} payslip(s) · ₹${(total / 100).toFixed(2)}${missing.length ? ` · ${missing.length} staff skipped (no structure)` : ''}` });
      await emitEvent(c, req.user.tenant_id, { type: 'payroll', label: `Pay run computed — ${month} (₹${(total / 100).toFixed(2)})`, ref: run.id });
      return { run: { ...run, total_cents: total }, payslips: staff.length, skipped: missing.map((name) => ({ name, reason: 'no pay structure — set monthly pay first' })) };
    });
  });
  app.post('/payroll/runs/:id/disburse', { preHandler: [require('owner', 'finance_head'), uuidParams('id')] }, async (req, reply) => {
    const mode = String(req.body?.mode ?? '').trim();
    const ref = typeof req.body?.ref === 'string' ? req.body.ref.trim().slice(0, 80) : '';
    if (!['ecs', 'cash', 'cheque'].includes(mode)) return bad(reply, 'mode must be ecs|cash|cheque (salary via bank is the affiliation-safe path)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const run = (await c.query(`SELECT id, month, status, total_cents FROM app.payroll_runs WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!run) return bad(reply, 'No pay run with that id', 404);
      if (run.status !== 'draft') return bad(reply, `Run ${run.month} is already ${run.status} — disbursed runs are history, not editable`, 409);
      await c.query(`UPDATE app.payroll_runs SET status='disbursed', disburse_mode=$1, disburse_ref=$2, disbursed_at=now() WHERE id=$3`, [mode, ref || null, run.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Payroll run disbursed', recordType: 'PayrollRun', recordRef: run.id, reason: `${run.month} via ${mode}${ref ? ` (${ref})` : ''}`, policyRef: 'Payroll (bank/ECS proof)', risk: 'high', outcome: `₹${(run.total_cents / 100).toFixed(2)} disbursed` });
      await emitEvent(c, req.user.tenant_id, { type: 'payroll', label: `Pay run disbursed — ${run.month} via ${mode}`, ref: run.id });
      return { run: { ...run, status: 'disbursed' } };
    });
  });

  // Billing: plan truth (trial = everything, operator-assisted upgrades until gateway checkout ships
  // per-tenant keys) + honest subscription checkout. Money-touching, so the rail pattern holds:
  // never half-create gateway state; unconfigured → 503 with operator guidance.
  const PLAN_PRICES = { core: 1800000, operations: 3500000, campus: 7500000, compliance: 7500000 };
  app.get('/billing', { preHandler: require('owner') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const plan = (await c.query(`SELECT plan FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0]?.plan ?? 'trial';
      const usage = (await c.query(
        `SELECT plugin_id, metric, count, updated_at FROM app.plugin_usage ORDER BY plugin_id, metric`)).rows;
      const declared = (await c.query(
        `SELECT plugin_id, COALESCE(manifest->'billing'->'metered', '[]'::jsonb) AS metered FROM app.plugins ORDER BY plugin_id`)).rows;
      const students = (await c.query(`SELECT count(*)::int AS n FROM app.students WHERE status='active'`)).rows[0].n;
      return { plan, plans: Object.fromEntries(Object.entries(PLAN_PRICES).map(([k, v]) => [k, { amount_cents: v }])), usage, declared, students,
        upgrade: { note: 'Upgrades are completed with the operator until gateway checkout is wired per-tenant. Nothing here charges anything by itself.' } };
    });
  });
  app.post('/billing/checkout', { preHandler: require('owner') }, async (req, reply) => {
    const plan = String(req.body?.plan ?? '').trim();
    if (!PLAN_PRICES[plan]) return bad(reply, `plan must be one of: ${Object.keys(PLAN_PRICES).join(', ')}`);
    const keyId = process.env.RAZORPAY_KEY_ID ?? '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET ?? '';
    if (!keyId || !keySecret) return reply.code(503).send({ error: 'Subscription payments are not configured on this deployment — ask the operator to wire gateway keys. Your plan has not changed and no money has moved.' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const amount = PLAN_PRICES[plan];
      const order = (await c.query(
        `INSERT INTO app.billing_orders (tenant_id, plan, amount_cents, created_by) VALUES ($1,$2,$3,$4) RETURNING id, plan, amount_cents, status`,
        [req.user.tenant_id, plan, amount, req.user.id])).rows[0];
      let gw;
      try {
        const res = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: { authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`, 'content-type': 'application/json' },
          body: JSON.stringify({ amount, currency: 'INR', receipt: order.id, notes: { tenant: req.user.tenant_id, plan } }),
        });
        gw = await res.json().catch(() => ({}));
        if (!res.ok || !gw.id) throw new Error(gw?.error?.description ?? `gateway answered ${res.status}`);
      } catch (e) {
        await c.query(`UPDATE app.billing_orders SET status='failed' WHERE id=$1`, [order.id]);
        return reply.code(502).send({ error: `Gateway order failed (${e.message}) — nothing was charged; the local order is marked failed for the trail.` });
      }
      await c.query(`UPDATE app.billing_orders SET gateway_order_id=$1 WHERE id=$2`, [gw.id, order.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Subscription checkout started', recordType: 'BillingOrder', recordRef: order.id, reason: `plan ${plan}`, policyRef: 'Billing (subscription)', risk: 'high', outcome: `gateway order ${gw.id} · ₹${(amount / 100).toFixed(2)} · plan flips only on paid webhook` });
      return { order: { ...order, gateway_order_id: gw.id } };
    });
  });
  // Public HMAC door (uniform 401, no oracle): env secret only; unknown/duplicate events 200-ignored.
  app.post('/billing/webhook', async (req, reply) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
    if (!secret) return reply.code(503).send({ error: 'Billing webhooks are not configured on this deployment' });
    const raw = req.rawBody ?? Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
    const sig = String(req.headers['x-razorpay-signature'] ?? '');
    let ok = false;
    try {
      const { createHmac, timingSafeEqual } = await import('node:crypto');
      const want = createHmac('sha256', secret).update(raw).digest('hex');
      ok = sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
    } catch { ok = false; }
    if (!ok) return reply.code(401).send({ error: 'bad signature' });
    const body = typeof req.body === 'string' ? JSON.parse(raw.toString('utf8')) : (req.body ?? {});
    if (body?.event !== 'payment.captured') return { ok: true, ignored: body?.event ?? 'unknown' };
    const gwOrderId = body?.payload?.payment?.entity?.order_id ?? null;
    if (!gwOrderId) return { ok: true, ignored: 'no-order' };
    const hit = await sysq(`SELECT id, tenant_id, plan, status FROM app.billing_orders WHERE gateway_order_id=$1`, [gwOrderId]);
    const order = hit.rows[0];
    if (!order || order.status === 'paid') return { ok: true, ignored: 'unknown-or-duplicate' };
    await sysq(`UPDATE app.billing_orders SET status='paid', paid_at=now() WHERE id=$1`, [order.id]);
    await sysq(`UPDATE app.tenants SET plan=$1 WHERE id=$2`, [order.plan, order.tenant_id]);
    return { ok: true, plan: order.plan };
  });

  // ---- Master Action Plan batch 2 · infra, meetings, health, CPD, PINs, acks, 360, templates ----
  // Counter-PIN enrollment: hash-only (like passwords — the ledger never sees a digit).
  app.post('/fees/pins', { preHandler: require('owner', 'finance_head') }, async (req, reply) => {
    const b = req.body ?? {};
    const userId = String(b.userId ?? '');
    const pin = String(b.pin ?? '');
    if (!UUID_RE_NOTICE.test(userId)) return bad(reply, 'userId must be a uuid');
    if (!/^[0-9]{4,6}$/.test(pin)) return bad(reply, 'pin must be 4–6 digits');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const u = (await c.query(
        `SELECT id, name, role FROM app.users WHERE id=$1 AND active AND role NOT IN ('parent','student','api')`,
        [userId])).rows[0];
      if (!u) return bad(reply, 'Counter PINs are for counter staff — no payable staff with that id', 404);
      await c.query(
        `INSERT INTO app.fee_pins (tenant_id, user_id, pin_hash, updated_at) VALUES ($1,$2,$3,now())
         ON CONFLICT (user_id) DO UPDATE SET pin_hash=EXCLUDED.pin_hash, updated_at=now()`,
        [req.user.tenant_id, u.id, hashPassword(pin)]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Counter PIN set', recordType: 'FeePin', recordRef: u.id, reason: `${u.name} (${u.role})`, policyRef: 'Fees §4.2 (counter fraud)', risk: 'medium', outcome: 'PIN enrolled — cash collections by this account now require it' });
      return { ok: true };
    });
  });

  // UDISE-facing infrastructure: one row per school, office-written, office-read.
  app.get('/school/infra', { preHandler: roleGatedMe('owner', 'principal', 'itadmin', 'coordinator', 'finance', 'finance_head') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(`SELECT * FROM app.school_infra LIMIT 1`)).rows[0] ?? null;
      const ptr = (await c.query(
        `SELECT (SELECT count(*)::int FROM app.students WHERE status='active') AS pupils,
                (SELECT count(*)::int FROM app.users WHERE active AND role='teacher') AS teachers`)).rows[0];
      return { infra: row, ptr: ptr.pupils && ptr.teachers ? Math.round(ptr.pupils / ptr.teachers * 10) / 10 : null };
    });
  });
  app.put('/school/infra', { preHandler: require('owner', 'principal', 'itadmin') }, async (req, reply) => {
    const b = req.body ?? {};
    const ints = {};
    for (const k of ['classrooms', 'labs', 'toiletsBoys', 'toiletsGirls', 'libraryVolumes']) {
      if (b[k] === undefined) continue;
      if (!Number.isInteger(b[k]) || b[k] < 0 || b[k] > 100000) return bad(reply, `${k} must be an integer 0–100000`);
      ints[k] = b[k];
    }
    const bools = {};
    for (const k of ['drinkingWater', 'playground', 'boundaryWall']) {
      if (b[k] === undefined) continue;
      if (typeof b[k] !== 'boolean') return bad(reply, `${k} must be true/false`);
      bools[k] = b[k];
    }
    if (!Object.keys({ ...ints, ...bools }).length) return bad(reply, 'Nothing to update');
    const col = { classrooms: 'classrooms', labs: 'labs', toiletsBoys: 'toilets_boys', toiletsGirls: 'toilets_girls', libraryVolumes: 'library_volumes', drinkingWater: 'drinking_water', playground: 'playground', boundaryWall: 'boundary_wall' };
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const sets = [];
      const vals = [];
      let i = 1;
      for (const [k, v] of [...Object.entries(ints), ...Object.entries(bools)]) {
        sets.push(`${col[k]}=$${i++}`);
        vals.push(v);
      }
      sets.push(`updated_by=$${i++}`, `updated_at=now()`);
      vals.push(req.user.id);
      const cur = (await c.query(`SELECT id FROM app.school_infra LIMIT 1`)).rows[0];
      const row = cur
        ? (await c.query(`UPDATE app.school_infra SET ${sets.join(', ')} RETURNING *`, vals)).rows[0]
        : (await c.query(
          `INSERT INTO app.school_infra (tenant_id, classrooms, labs, toilets_boys, toilets_girls, drinking_water, playground, boundary_wall, library_volumes, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [req.user.tenant_id, ints.classrooms ?? 0, ints.labs ?? 0, ints.toiletsBoys ?? 0, ints.toiletsGirls ?? 0,
           bools.drinkingWater ?? false, bools.playground ?? false, bools.boundaryWall ?? false, ints.libraryVolumes ?? 0, req.user.id])).rows[0];
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Updated school infrastructure', recordType: 'SchoolInfra', recordRef: row.id, reason: 'UDISE profile', policyRef: 'UDISE+ (infrastructure)', risk: 'low', outcome: 'infrastructure profile saved' });
      return { infra: row };
    });
  });

  // PTA/SMC meetings: the minutes behind MPD lists and fee-hike consultations.
  app.get('/meetings', { preHandler: roleGatedMe('owner', 'principal', 'itadmin', 'coordinator') }, async (req, reply) => {
    const { kind } = req.query ?? {};
    if (kind !== undefined && !['PTA', 'SMC'].includes(String(kind))) return bad(reply, 'kind must be PTA|SMC');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT id, kind, held_on, minutes, attendees, created_at FROM app.mtgs
          WHERE ($1::text IS NULL OR kind=$1) ORDER BY held_on DESC LIMIT 100`, [kind ?? null]);
      return { meetings: r.rows };
    });
  });
  app.post('/meetings', { preHandler: require('owner', 'principal', 'coordinator', 'itadmin') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!['PTA', 'SMC'].includes(b.kind)) return bad(reply, 'kind must be PTA|SMC');
    if (!DATE_RE.test(String(b.heldOn ?? ''))) return bad(reply, 'heldOn must be YYYY-MM-DD');
    const minutes = typeof b.minutes === 'string' ? b.minutes.trim() : '';
    if (minutes.length < 10 || minutes.length > 8000) return bad(reply, 'minutes must be 10–8000 characters (decisions, not placeholders)');
    const attendees = Array.isArray(b.attendees) ? b.attendees.map(String).slice(0, 50) : [];
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `INSERT INTO app.mtgs (tenant_id, kind, held_on, minutes, attendees, created_by)
         VALUES ($1,$2,$3::date,$4,$5::jsonb,$6) RETURNING id, kind, held_on, minutes, attendees, created_at`,
        [req.user.tenant_id, b.kind, String(b.heldOn), minutes, JSON.stringify(attendees), req.user.id])).rows[0];
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `${b.kind} meeting minuted`, recordType: 'Meeting', recordRef: row.id, reason: String(b.heldOn), policyRef: 'Governance (SMC/PTA)', risk: 'low', outcome: `${attendees.length} attendee(s) recorded` });
      await emitEvent(c, req.user.tenant_id, { type: 'governance', label: `${b.kind} meeting minuted — ${b.heldOn}`, ref: row.id });
      return { meeting: row };
    });
  });

  // Health lane: RBSK/vaccination/general checkups (parent sees own children) + PM-POSHAN meal log.
  app.get('/health-checks', { preHandler: roleGatedMe('owner', 'principal', 'coordinator', 'itadmin', 'counselor', 'parent') }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (req.user.role === 'parent') {
        const r = await c.query(
          `SELECT h.id, h.kind, h.detail, h.checked_on, s.name AS student_name
             FROM app.health_checks h JOIN app.students s ON s.id = h.student_id
             JOIN family.child_link cl ON cl.student_id = s.id
            WHERE cl.user_id=$1 ORDER BY h.checked_on DESC LIMIT 100`, [req.user.id]);
        return { checks: r.rows, scoped: 'own_children' };
      }
      const r = await c.query(
        `SELECT h.id, h.kind, h.detail, h.checked_on, s.name AS student_name, s.grade, s.section
           FROM app.health_checks h JOIN app.students s ON s.id = h.student_id
          ORDER BY h.checked_on DESC LIMIT 200`);
      return { checks: r.rows };
    });
  });
  app.post('/health-checks', { preHandler: require('owner', 'principal', 'coordinator', 'itadmin', 'counselor') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!UUID_RE_NOTICE.test(String(b.studentId ?? ''))) return bad(reply, 'studentId must be a uuid');
    if (!['RBSK', 'vaccination', 'general'].includes(b.kind)) return bad(reply, 'kind must be RBSK|vaccination|general');
    if (!DATE_RE.test(String(b.checkedOn ?? ''))) return bad(reply, 'checkedOn must be YYYY-MM-DD');
    const detail = typeof b.detail === 'string' ? b.detail.trim().slice(0, 500) : '';
    if (!detail) return bad(reply, 'detail is required (finding, not a placeholder)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const st = (await c.query(`SELECT id, name FROM app.students WHERE id=$1 AND status='active'`, [b.studentId])).rows[0];
      if (!st) return bad(reply, 'No active pupil with that id', 404);
      const row = (await c.query(
        `INSERT INTO app.health_checks (tenant_id, student_id, kind, detail, checked_on, created_by)
         VALUES ($1,$2,$3,$4,$5::date,$6) RETURNING id, kind, detail, checked_on`,
        [req.user.tenant_id, st.id, b.kind, detail, String(b.checkedOn), req.user.id])).rows[0];
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Health check recorded', recordType: 'HealthCheck', recordRef: row.id, reason: `${st.name} · ${b.kind}`, policyRef: 'Health (RBSK)', risk: 'low', outcome: 'checkup on record' });
      return { check: { ...row, student_name: st.name } };
    });
  });
  app.get('/meals', { preHandler: roleGatedMe('owner', 'principal', 'itadmin', 'coordinator') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT served_on, menu, veg_count, total_count FROM app.meals ORDER BY served_on DESC LIMIT 60`);
      return { meals: r.rows };
    });
  });
  app.post('/meals', { preHandler: require('owner', 'principal', 'itadmin', 'coordinator') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!DATE_RE.test(String(b.servedOn ?? ''))) return bad(reply, 'servedOn must be YYYY-MM-DD');
    const menu = typeof b.menu === 'string' ? b.menu.trim().slice(0, 200) : '';
    if (!menu) return bad(reply, 'menu is required');
    for (const k of ['vegCount', 'totalCount']) {
      if (!Number.isInteger(b[k]) || b[k] < 0) return bad(reply, `${k} must be a non-negative integer`);
    }
    if (b.vegCount > b.totalCount) return bad(reply, 'vegCount cannot exceed totalCount');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `INSERT INTO app.meals (tenant_id, served_on, menu, veg_count, total_count, created_by)
         VALUES ($1,$2::date,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, served_on) DO UPDATE SET menu=EXCLUDED.menu, veg_count=EXCLUDED.veg_count, total_count=EXCLUDED.total_count
         RETURNING served_on, menu, veg_count, total_count`,
        [req.user.tenant_id, String(b.servedOn), menu, b.vegCount, b.totalCount, req.user.id])).rows[0];
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Meal serving logged', recordType: 'Meal', recordRef: String(row.served_on).slice(0, 10), reason: menu, policyRef: 'PM-POSHAN', risk: 'low', outcome: `${row.total_count} served` });
      return { meal: row };
    });
  });

  // Staff CPD ledger: office sees all, everyone else sees their own hours.
  app.get('/staff-trainings', { preHandler: roleGatedMe('owner', 'principal', 'itadmin', 'coordinator', 'teacher', 'counselor', 'finance', 'finance_head', 'finance_clerk', 'admissions', 'transport', 'facilities', 'technician', 'librarian') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const office = ['owner', 'principal', 'itadmin', 'coordinator'].includes(req.user.role);
      const r = await c.query(
        `SELECT t.id, t.title, t.hours, t.provider, t.completed_on, u.name AS staff_name, u.role AS staff_role
           FROM app.staff_trainings t JOIN app.users u ON u.id = t.user_id
          WHERE ${office ? 'true' : 't.user_id=$1'}
          ORDER BY t.completed_on DESC NULLS LAST, t.created_at DESC LIMIT 200`,
        office ? [] : [req.user.id]);
      const total = office ? null : (await c.query(
        `SELECT COALESCE(sum(hours),0)::float AS h FROM app.staff_trainings WHERE user_id=$1`, [req.user.id])).rows[0].h;
      return { trainings: r.rows, scoped: office ? 'school' : 'own', ownHours: total };
    });
  });
  app.post('/staff-trainings', { preHandler: require('owner', 'principal', 'itadmin', 'coordinator') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!UUID_RE_NOTICE.test(String(b.userId ?? ''))) return bad(reply, 'userId must be a uuid');
    const title = typeof b.title === 'string' ? b.title.trim().slice(0, 160) : '';
    if (!title) return bad(reply, 'title is required (e.g. NISHTHA FLN module 4)');
    const hours = Number(b.hours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 500) return bad(reply, 'hours must be 0–500');
    if (b.completedOn !== undefined && b.completedOn !== null && String(b.completedOn).trim() !== '' && !DATE_RE.test(String(b.completedOn).trim())) {
      return bad(reply, 'completedOn must be YYYY-MM-DD');
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const u = (await c.query(`SELECT id, name FROM app.users WHERE id=$1 AND active AND role NOT IN ('parent','student','api')`, [b.userId])).rows[0];
      if (!u) return bad(reply, 'No active staff with that id', 404);
      const row = (await c.query(
        `INSERT INTO app.staff_trainings (tenant_id, user_id, title, hours, provider, completed_on, created_by)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7) RETURNING id, title, hours, provider, completed_on`,
        [req.user.tenant_id, u.id, title, hours,
         typeof b.provider === 'string' ? b.provider.trim().slice(0, 120) : null,
         b.completedOn && String(b.completedOn).trim() ? String(b.completedOn).trim() : null, req.user.id])).rows[0];
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Training recorded', recordType: 'StaffTraining', recordRef: row.id, reason: `${u.name} · ${title}`, policyRef: 'NEP (CPD)', risk: 'low', outcome: `${hours}h credited` });
      return { training: { ...row, staff_name: u.name } };
    });
  });

  // APAAR identity: national 12-digit pupil id, unique per tenant where present.
  app.post('/students/:id/identity', { preHandler: [require('owner', 'principal', 'coordinator', 'admissions', 'itadmin'), uuidParams('id')] }, async (req, reply) => {
    const apaar = String(req.body?.apaarId ?? '').trim();
    if (!/^[0-9]{12}$/.test(apaar)) return bad(reply, 'apaarId must be exactly 12 digits');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const st = (await c.query(`SELECT id, name FROM app.students WHERE id=$1 AND status='active'`, [req.params.id])).rows[0];
      if (!st) return bad(reply, 'No active pupil with that id', 404);
      const clash = (await c.query(`SELECT name, admission_no FROM app.students WHERE apaar_id=$1 AND id<>$2 LIMIT 1`, [apaar, st.id])).rows[0];
      if (clash) return bad(reply, `APAAR ${apaar} is already on ${clash.name} (${clash.admission_no}) — one child, one id`, 409);
      await c.query(`UPDATE app.students SET apaar_id=$1 WHERE id=$2`, [apaar, st.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'APAAR id recorded', recordType: 'Student', recordRef: st.id, reason: st.name, policyRef: 'APAAR (identity)', risk: 'low', outcome: 'national id linked' });
      return { ok: true };
    });
  });

  // Student 360: one honest page per child — core + attendance + dues + bus + loans + exams
  // + health + concessions. Staff full, parent own-children, pupil own-linked account only.
  app.get('/students/:id/360', { preHandler: [roleGatedMe('owner', 'principal', 'coordinator', 'teacher', 'counselor', 'finance_head', 'parent', 'student'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const st = (await c.query(
        `SELECT id, admission_no, name, grade, section, dob, gender, guardian_name, guardian_phone, bus_route, apaar_id, status FROM app.students WHERE id=$1`,
        [req.params.id])).rows[0];
      if (!st) return bad(reply, 'No pupil with that id', 404);
      if (req.user.role === 'parent') {
        const own = (await c.query(`SELECT 1 FROM family.child_link WHERE user_id=$1 AND student_id=$2`, [req.user.id, st.id])).rows[0];
        if (!own) return bad(reply, 'You can only open your own child’s page', 403);
      }
      if (req.user.role === 'student') {
        if (st.id !== req.user.studentId && !(await c.query(`SELECT 1 FROM app.students WHERE id=$1 AND user_id=$2`, [st.id, req.user.id])).rows[0]) {
          return bad(reply, 'You can only open your own page', 403);
        }
      }
      const att = (await c.query(
        `SELECT count(*)::int AS marks,
                count(*) FILTER (WHERE status IN ('present','late'))::int AS present
           FROM app.attendance WHERE student_id=$1`, [st.id])).rows[0];
      const dues = (await c.query(
        `SELECT COALESCE(sum(amount_cents - paid_cents),0)::int AS outstanding, count(*)::int AS dues
           FROM app.fee_obligations WHERE student_id=$1 AND status NOT IN ('void','paid')`, [st.id])).rows[0];
      // Money follows the obligations door: teachers/counselors never see dues (their door refuses),
      // so the 360 withholds them too rather than leaking through aggregation. Parents/students keep
      // their existing own-scoped money doors; staff on the money list keep full figures.
      const canSeeMoney = ['owner', 'principal', 'finance', 'finance_head', 'finance_clerk', 'coordinator', 'itadmin'].includes(req.user.role)
        || req.user.role === 'parent' || req.user.role === 'student';
      const guardians = (await c.query(
        `SELECT name, phone, relation FROM app.guardians WHERE student_id=$1 ORDER BY is_primary DESC NULLS LAST LIMIT 5`, [st.id])).rows;
      const conc = (await c.query(
        `SELECT kind, percent, amount_cents, status, reason FROM app.fee_concessions WHERE student_id=$1 AND status='approved' ORDER BY created_at DESC LIMIT 10`, [st.id])).rows;
      const safe = async (fn, fallback = null) => { try { return await fn(); } catch { return fallback; } };
      const loans = await safe(async () => (await c.query(
        `SELECT count(*) FILTER (WHERE returned_at IS NULL)::int AS open,
                COALESCE(sum(fine_cents) FILTER (WHERE returned_at IS NULL),0)::int AS fine_open
           FROM library.loan WHERE student_id=$1`, [st.id])).rows[0]);
      const exams = await safe(async () => (await c.query(
        `SELECT count(*)::int AS marks, COALESCE(sum(m.marks),0)::float AS scored, COALESCE(sum(m.max_marks),0)::float AS max
           FROM plugin_exams.mark m JOIN plugin_exams.exam e ON e.id = m.exam_id
          WHERE m.student_id=$1 AND e.status='published'`, [st.id])).rows[0]);
      const health = await safe(async () => (await c.query(
        `SELECT kind, detail, checked_on FROM app.health_checks WHERE student_id=$1 ORDER BY checked_on DESC LIMIT 3`, [st.id])).rows, []);
      const hw = await safe(async () => (await c.query(
        `SELECT count(*)::int AS pending FROM teacher.homework h
          WHERE h.status='open' AND h.class_grade=$1 AND h.due_at > now()
            AND NOT EXISTS (SELECT 1 FROM teacher.submission s WHERE s.homework_id=h.id AND s.student_id=$2)`,
        [st.grade, st.id])).rows[0], null);
      return {
        student: st,
        attendance: { marks: att.marks, pct: att.marks ? Math.round(att.present / att.marks * 1000) / 10 : null },
        fees: canSeeMoney
          ? { outstanding_cents: dues.outstanding, open_dues: dues.dues }
          : { outstanding_cents: null, open_dues: null, withheld: 'dues are visible to the office and the family, not to this role' },
        transport: { bus_route: st.bus_route },
        guardians, concessions: canSeeMoney ? conc : [], library: loans, exams, health, homework: hw,
      };
    });
  });

  // Diary/circular acks: read+sign receipts per announcement (idempotent — re-sign is a no-op).
  // Parent notices: the office reads /announcements; guardians read here — school-wide plus
  // their own children's classes, published states only, with their own ack state attached.
  app.get('/notices', { preHandler: require('parent') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const grades = (await c.query(
        `SELECT DISTINCT s.grade FROM app.students s JOIN family.child_link cl ON cl.student_id = s.id
          WHERE cl.user_id=$1 AND s.status='active'`, [req.user.id])).rows.map((r) => r.grade);
      const rows = (await c.query(
        `SELECT a.id, a.title, a.body, a.audience_kind, a.created_at, (k.user_id IS NOT NULL) AS acked
           FROM app.announcements a
           LEFT JOIN app.announcement_acks k ON k.announcement_id = a.id AND k.user_id=$1
          WHERE a.status IN ('queued','sent')
            AND (a.audience_kind='all_guardians' OR (a.audience_kind='class' AND a.audience_ref = ANY($2::text[])))
          ORDER BY a.created_at DESC LIMIT 30`, [req.user.id, grades])).rows;
      return { notices: rows };
    });
  });
  app.post('/announcements/:id/ack', { preHandler: [roleGatedMe('owner', 'principal', 'coordinator', 'itadmin', 'teacher', 'counselor', 'finance', 'finance_head', 'finance_clerk', 'admissions', 'transport', 'facilities', 'technician', 'librarian', 'parent', 'student'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const a = (await c.query(`SELECT id, title FROM app.announcements WHERE id=$1`, [req.params.id])).rows[0];
      if (!a) return bad(reply, 'No announcement with that id', 404);
      await c.query(
        `INSERT INTO app.announcement_acks (tenant_id, announcement_id, user_id) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, announcement_id, user_id) DO NOTHING`,
        [req.user.tenant_id, a.id, req.user.id]);
      return { acked: true };
    });
  });
  app.get('/announcements/:id/acks', { preHandler: [roleGatedMe('owner', 'principal', 'coordinator', 'itadmin'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const a = (await c.query(`SELECT id, title FROM app.announcements WHERE id=$1`, [req.params.id])).rows[0];
      if (!a) return bad(reply, 'No announcement with that id', 404);
      const rows = (await c.query(
        `SELECT u.name, u.role, k.signed_at FROM app.announcement_acks k JOIN app.users u ON u.id = k.user_id
          WHERE k.announcement_id=$1 ORDER BY k.signed_at`, [a.id])).rows;
      return { announcement: a, ackCount: rows.length, acks: rows };
    });
  });

  // Automation template gallery: named starting points over the live /workflow-rules doors.
  // Templates never execute here — applying POSTs the same body the office could hand-write.
  const AUTOMATION_TEMPLATES = [
    { key: 'absence-notice', name: 'Absence → guardian notice draft', topic: 'attendance.absences', blurb: 'Queues a guardian notice for every absence mark. The office still sends it.', action: { kind: 'outbox', topic: 'notice.absence.queued' } },
    { key: 'fee-due-3d', name: 'Fee due in 3 days → reminder', topic: 'fee.due.soon', blurb: 'Reminds guardians before the due date (quiet hours respected).', action: { kind: 'outbox', topic: 'fee.reminder.queued' } },
    { key: 'gps-delay', name: 'Bus delay ≥10 min → approval task', topic: 'transport.delay', blurb: 'Raises an approval instead of auto-notifying guardians.', action: { kind: 'outbox', topic: 'transport.delay.approval' } },
    { key: 'enquiry-followup', name: 'Enquiry → follow-up task', topic: 'admission.enquiry.captured', blurb: 'Puts every new enquiry on the follow-up pipeline. No auto-messaging.', action: { kind: 'outbox', topic: 'admission.followup.scheduled' } },
    { key: 'doc-expiry', name: 'Disclosure expiring → MPD task', topic: 'compliance.expiring', blurb: 'Nags the office 60 days before a certificate lapses.', action: { kind: 'outbox', topic: 'compliance.renewal.task' } },
    { key: 'low-attendance', name: 'Attendance <75% → counselor review', topic: 'attendance.low', blurb: 'Staff-only review list. Never shown to families as a score.', action: { kind: 'outbox', topic: 'attendance.review.task' } },
  ];
  app.get('/automation/templates', { preHandler: roleGatedMe('owner', 'principal', 'itadmin', 'coordinator') }, async () => ({ templates: AUTOMATION_TEMPLATES }));

  // ---- Master Action Plan batch 3 · NEP pack, transport compliance, payroll ECS, staff QR,
  // breach register, emergency broadcast ----
  // NEP 5+3+3+4 stages derive from the school's own grade names (Balvatika = pre-school grades).
  const nepStage = (grade) => {
    const g = String(grade ?? '').trim().toLowerCase();
    if (['nursery', 'jr kg', 'jr.kg', 'lkg', 'sr kg', 'sr.kg', 'ukg', 'balvatika', 'pre-primary'].includes(g)) return 'Foundational (Balvatika)';
    if (['1', '2', 'std 1', 'std 2', 'class 1', 'class 2'].includes(g)) return 'Foundational';
    if (['3', '4', '5'].some((n) => g === n || g === `std ${n}` || g === `class ${n}`)) return 'Preparatory';
    if (['6', '7', '8'].some((n) => g === n || g === `std ${n}` || g === `class ${n}`)) return 'Middle';
    if (['9', '10', '11', '12'].some((n) => g === n || g === `std ${n}` || g === `class ${n}`)) return 'Secondary';
    return 'Unstaged';
  };
  const FLN_SKILLS = ['oral_language', 'print_awareness', 'phonics', 'fluency', 'comprehension', 'number_sense', 'measurement', 'shapes'];
  const teacherOwnsPupil = async (c, tenantId, teacherId, studentId) => (await c.query(
    `SELECT 1 FROM app.students s JOIN app.class_assignments a ON a.grade = s.grade AND a.section = s.section
      WHERE s.id=$1 AND a.teacher_id=$2 AND a.active AND s.status='active'`, [studentId, teacherId])).rows[0];
  app.get('/nep/profile', { preHandler: roleGatedMe('owner', 'principal', 'itadmin', 'coordinator', 'teacher') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = (await c.query(`SELECT config FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0];
      const parsed = normalizeClasses(t?.config?.setup?.sections ?? []);
      const stages = parsed.ok ? parsed.classes.map((x) => ({ grade: x.grade, sections: x.sections, stage: nepStage(x.grade) })) : [];
      const r3 = (await c.query(`SELECT language, academic_year FROM app.school_r3 ORDER BY academic_year DESC LIMIT 1`)).rows[0] ?? null;
      const acts = (await c.query(`SELECT kind, title, held_on FROM app.nep_activities ORDER BY held_on DESC NULLS LAST LIMIT 5`)).rows;
      const skills = (await c.query(`SELECT skill, level, count(*)::int AS n FROM app.fln_skills GROUP BY skill, level`)).rows;
      return { stages, r3, recentActivities: acts, fln: skills };
    });
  });
  app.put('/nep/r3', { preHandler: require('owner', 'principal', 'itadmin') }, async (req, reply) => {
    const language = typeof req.body?.language === 'string' ? req.body.language.trim().slice(0, 60) : '';
    const year = typeof req.body?.academicYear === 'string' ? req.body.academicYear.trim().slice(0, 12) : '';
    if (!language || !year) return bad(reply, 'language and academicYear are required (Class-6 third language, OASIS R3)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      await c.query(
        `INSERT INTO app.school_r3 (tenant_id, academic_year, language, created_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, academic_year) DO UPDATE SET language=EXCLUDED.language`,
        [req.user.tenant_id, year, language, req.user.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Third language recorded', recordType: 'SchoolR3', recordRef: year, reason: language, policyRef: 'NCF-SE (R3/OASIS)', risk: 'low', outcome: `${year}: ${language}` });
      return { ok: true, academicYear: year, language };
    });
  });
  app.get('/nep/activities', { preHandler: roleGatedMe('owner', 'principal', 'itadmin', 'coordinator', 'teacher') }, async (req, reply) => {
    const { kind } = req.query ?? {};
    if (kind !== undefined && !['bagless', 'art', 'skill'].includes(String(kind))) return bad(reply, 'kind must be bagless|art|skill');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT id, kind, title, detail, held_on, grades FROM app.nep_activities
          WHERE ($1::text IS NULL OR kind=$1) ORDER BY held_on DESC NULLS LAST LIMIT 100`, [kind ?? null]);
      return { activities: r.rows };
    });
  });
  app.post('/nep/activities', { preHandler: require('owner', 'principal', 'coordinator', 'itadmin') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!['bagless', 'art', 'skill'].includes(b.kind)) return bad(reply, 'kind must be bagless|art|skill');
    const title = typeof b.title === 'string' ? b.title.trim().slice(0, 160) : '';
    if (!title) return bad(reply, 'title is required');
    if (b.heldOn !== undefined && b.heldOn !== null && String(b.heldOn).trim() !== '' && !DATE_RE.test(String(b.heldOn).trim())) {
      return bad(reply, 'heldOn must be YYYY-MM-DD');
    }
    const grades = Array.isArray(b.grades) ? b.grades.map(String).slice(0, 20) : [];
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `INSERT INTO app.nep_activities (tenant_id, kind, title, detail, held_on, grades, created_by)
         VALUES ($1,$2,$3,$4,$5::date,$6::jsonb,$7) RETURNING id, kind, title, held_on`,
        [req.user.tenant_id, b.kind, title,
         typeof b.detail === 'string' ? b.detail.trim().slice(0, 2000) : null,
         b.heldOn && String(b.heldOn).trim() ? String(b.heldOn).trim() : null,
         JSON.stringify(grades), req.user.id])).rows[0];
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `NEP activity recorded (${b.kind})`, recordType: 'NepActivity', recordRef: row.id, reason: title, policyRef: 'NEP 2020', risk: 'low', outcome: 'activity on record' });
      return { activity: row };
    });
  });
  // HPC: term inputs (teacher observations) + live aggregates computed at read time.
  app.post('/nep/hpc', { preHandler: require('owner', 'principal', 'coordinator', 'teacher') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!UUID_RE_NOTICE.test(String(b.studentId ?? ''))) return bad(reply, 'studentId must be a uuid');
    const term = typeof b.term === 'string' ? b.term.trim().slice(0, 24) : '';
    if (!term) return bad(reply, 'term is required (e.g. 2026-27 T1)');
    for (const k of ['strengths', 'interests', 'goals', 'teacherRemark']) {
      if (b[k] !== undefined && (typeof b[k] !== 'string' || b[k].length > 2000)) return bad(reply, `${k} must be text ≤2000 characters`);
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const st = (await c.query(`SELECT id, name, grade, section FROM app.students WHERE id=$1 AND status='active'`, [b.studentId])).rows[0];
      if (!st) return bad(reply, 'No active pupil with that id', 404);
      if (req.user.role === 'teacher' && !(await teacherOwnsPupil(c, req.user.tenant_id, req.user.id, st.id))) {
        return bad(reply, 'Holistic remarks belong to the pupil’s own teachers — ask the class teacher', 403);
      }
      await c.query(
        `INSERT INTO app.hpc_inputs (tenant_id, student_id, term, strengths, interests, goals, teacher_remark, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id, student_id, term) DO UPDATE SET
           strengths=EXCLUDED.strengths, interests=EXCLUDED.interests, goals=EXCLUDED.goals,
           teacher_remark=EXCLUDED.teacher_remark, updated_at=now()`,
        [req.user.tenant_id, st.id, term, b.strengths ?? null, b.interests ?? null, b.goals ?? null, b.teacherRemark ?? null, req.user.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'HPC inputs recorded', recordType: 'HpcInputs', recordRef: `${st.id}/${term}`, reason: `${st.name} · ${term}`, policyRef: 'NEP (HPC 360°)', risk: 'low', outcome: 'observations on record' });
      return { ok: true };
    });
  });
  const hpcAggregates = async (c, studentId, grade) => {
    const att = (await c.query(
      `SELECT count(*)::int AS marks, count(*) FILTER (WHERE status IN ('present','late'))::int AS present
         FROM app.attendance WHERE student_id=$1`, [studentId])).rows[0];
    const exams = (await c.query(
      `SELECT count(*)::int AS marks, COALESCE(sum(m.marks),0)::float AS scored, COALESCE(sum(m.max_marks),0)::float AS max
         FROM plugin_exams.mark m JOIN plugin_exams.exam e ON e.id=m.exam_id
        WHERE m.student_id=$1 AND e.status='published'`, [studentId])).rows[0];
    const hw = (await c.query(
      `SELECT count(*)::int AS pending FROM teacher.homework h
        WHERE h.status='open' AND h.class_grade=$1 AND h.due_at > now()
          AND NOT EXISTS (SELECT 1 FROM teacher.submission s WHERE s.homework_id=h.id AND s.student_id=$2)`,
      [grade, studentId])).rows[0];
    return {
      attendancePct: att.marks ? Math.round(att.present / att.marks * 1000) / 10 : null,
      examAvg: exams.max ? Math.round(exams.scored / exams.max * 1000) / 10 : null,
      homeworkPending: hw.pending,
    };
  };
  app.get('/nep/hpc/:studentId', { preHandler: [roleGatedMe('owner', 'principal', 'coordinator', 'teacher', 'parent'), uuidParams('studentId')] }, async (req, reply) => {
    const term = typeof req.query?.term === 'string' ? req.query.term.trim().slice(0, 24) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const st = (await c.query(`SELECT id, name, grade, section FROM app.students WHERE id=$1 AND status='active'`, [req.params.studentId])).rows[0];
      if (!st) return bad(reply, 'No active pupil with that id', 404);
      if (req.user.role === 'teacher' && !(await teacherOwnsPupil(c, req.user.tenant_id, req.user.id, st.id))) {
        return bad(reply, 'Holistic cards belong to the pupil’s own teachers', 403);
      }
      if (req.user.role === 'parent') {
        const own = (await c.query(`SELECT 1 FROM family.child_link WHERE user_id=$1 AND student_id=$2`, [req.user.id, st.id])).rows[0];
        if (!own) return bad(reply, 'You can only open your own child’s card', 403);
      }
      const inputs = term
        ? (await c.query(`SELECT term, strengths, interests, goals, teacher_remark, updated_at FROM app.hpc_inputs WHERE student_id=$1 AND term=$2`, [st.id, term])).rows[0] ?? null
        : (await c.query(`SELECT term, strengths, interests, goals, teacher_remark, updated_at FROM app.hpc_inputs WHERE student_id=$1 ORDER BY updated_at DESC LIMIT 5`, [st.id])).rows;
      return { student: st, stage: nepStage(st.grade), inputs, aggregates: await hpcAggregates(c, st.id, st.grade) };
    });
  });
  app.post('/nep/fln', { preHandler: require('owner', 'principal', 'coordinator', 'teacher') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!UUID_RE_NOTICE.test(String(b.studentId ?? ''))) return bad(reply, 'studentId must be a uuid');
    if (!FLN_SKILLS.includes(b.skill)) return bad(reply, `skill must be one of: ${FLN_SKILLS.join(', ')}`);
    if (!['beginner', 'developing', 'proficient'].includes(b.level)) return bad(reply, 'level must be beginner|developing|proficient');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const st = (await c.query(`SELECT id, name FROM app.students WHERE id=$1 AND status='active'`, [b.studentId])).rows[0];
      if (!st) return bad(reply, 'No active pupil with that id', 404);
      if (req.user.role === 'teacher' && !(await teacherOwnsPupil(c, req.user.tenant_id, req.user.id, st.id))) {
        return bad(reply, 'FLN levels belong to the pupil’s own teachers', 403);
      }
      await c.query(
        `INSERT INTO app.fln_skills (tenant_id, student_id, skill, level, created_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, student_id, skill) DO UPDATE SET level=EXCLUDED.level, created_by=EXCLUDED.created_by, created_at=now()`,
        [req.user.tenant_id, st.id, b.skill, b.level, req.user.id]);
      return { ok: true };
    });
  });
  app.get('/nep/fln', { preHandler: roleGatedMe('owner', 'principal', 'coordinator', 'itadmin', 'teacher', 'parent') }, async (req, reply) => {
    const { studentId, grade } = req.query ?? {};
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (req.user.role === 'parent') {
        const r = await c.query(
          `SELECT f.skill, f.level, s.name AS student_name FROM app.fln_skills f JOIN app.students s ON s.id=f.student_id
            JOIN family.child_link cl ON cl.student_id=s.id WHERE cl.user_id=$1 ORDER BY s.name, f.skill`, [req.user.id]);
        return { skills: r.rows, scoped: 'own_children' };
      }
      if (studentId) {
        if (!UUID_RE_NOTICE.test(String(studentId))) return bad(reply, 'studentId must be a uuid');
        if (req.user.role === 'teacher' && !(await teacherOwnsPupil(c, req.user.tenant_id, req.user.id, String(studentId)))) {
          return bad(reply, 'FLN levels belong to the pupil’s own teachers', 403);
        }
        const r = await c.query(`SELECT skill, level FROM app.fln_skills WHERE student_id=$1 ORDER BY skill`, [studentId]);
        return { skills: r.rows };
      }
      const r = await c.query(
        `SELECT s.grade, f.skill, f.level, count(*)::int AS n FROM app.fln_skills f JOIN app.students s ON s.id=f.student_id
          WHERE ($1::text IS NULL OR s.grade=$1) ${req.user.role === 'teacher' ? 'AND EXISTS (SELECT 1 FROM app.class_assignments a WHERE a.teacher_id=$2 AND a.grade=s.grade AND a.section=s.section AND a.active)' : ''}
          GROUP BY s.grade, f.skill, f.level ORDER BY s.grade, f.skill`,
        req.user.role === 'teacher' ? [grade ?? null, req.user.id] : [grade ?? null]);
      return { skills: r.rows };
    });
  });

  // Transport compliance core: daily runs + board/de-board timestamps + attendants + fares + inspections.
  const todayIso = () => new Date().toISOString().slice(0, 10);
  app.get('/transport/runs', { preHandler: roleGatedMe('owner', 'principal', 'transport', 'coordinator', 'itadmin', 'teacher') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT r.id, r.ran_on, t.code, t.name,
                (SELECT count(DISTINCT (student_id)) FROM app.boarding b WHERE b.run_id=r.id AND b.direction='board')::int AS boarded
           FROM app.bus_runs r JOIN app.routes t ON t.id=r.route_id
          ORDER BY r.ran_on DESC LIMIT 20`);
      return { runs: r.rows };
    });
  });
  // Authority inline per door (scanner-readable): owner, principal, transport, coordinator, itadmin.
  app.post('/transport/runs', { preHandler: require('owner','principal','transport','coordinator','itadmin') }, async (req, reply) => {
    const routeId = String(req.body?.routeId ?? '');
    if (!UUID_RE_NOTICE.test(routeId)) return bad(reply, 'routeId must be a uuid');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const route = (await c.query(`SELECT id, code, name FROM app.routes WHERE id=$1`, [routeId])).rows[0];
      if (!route) return bad(reply, 'No route with that id', 404);
      const today = new Date().toISOString().slice(0, 10);
      const run = (await c.query(
        `INSERT INTO app.bus_runs (tenant_id, route_id, ran_on, started_by) VALUES ($1,$2,$3::date,$4)
         ON CONFLICT (tenant_id, route_id, ran_on) DO NOTHING RETURNING id, ran_on`,
        [req.user.tenant_id, route.id, today, req.user.id])).rows[0]
        ?? (await c.query(`SELECT id, ran_on FROM app.bus_runs WHERE route_id=$1 AND ran_on=$2::date`, [route.id, today])).rows[0];
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Bus run started', recordType: 'BusRun', recordRef: run.id, reason: `${route.code} · ${today}`, policyRef: 'Transport (boarding log)', risk: 'low', outcome: 'run open for boarding' });
      return { run: { ...run, route: { code: route.code, name: route.name } } };
    });
  });
  app.post('/transport/runs/:id/board', { preHandler: [require('owner','principal','transport','coordinator','itadmin'), uuidParams('id')] }, async (req, reply) => {
    const b = req.body ?? {};
    if (!UUID_RE_NOTICE.test(String(b.studentId ?? ''))) return bad(reply, 'studentId must be a uuid');
    if (!['board', 'deboard'].includes(b.direction)) return bad(reply, 'direction must be board|deboard');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const run = (await c.query(`SELECT id, route_id FROM app.bus_runs WHERE id=$1`, [req.params.id])).rows[0];
      if (!run) return bad(reply, 'No run with that id', 404);
      const st = (await c.query(`SELECT id, name FROM app.students WHERE id=$1 AND status='active'`, [b.studentId])).rows[0];
      if (!st) return bad(reply, 'No active pupil with that id', 404);
      try {
        const row = (await c.query(
          `INSERT INTO app.boarding (tenant_id, run_id, student_id, direction, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, at`,
          [req.user.tenant_id, run.id, st.id, b.direction, req.user.id])).rows[0];
        return { boarding: row, student_name: st.name };
      } catch (e) {
        if (e.code === '23505') return bad(reply, `${st.name} is already marked ${b.direction}ed on this run`, 409);
        throw e;
      }
    });
  });
  app.get('/transport/runs/:id/board', { preHandler: [roleGatedMe('owner','principal','transport','coordinator','itadmin', 'teacher'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const run = (await c.query(`SELECT id, route_id, ran_on FROM app.bus_runs WHERE id=$1`, [req.params.id])).rows[0];
      if (!run) return bad(reply, 'No run with that id', 404);
      const rows = (await c.query(
        `SELECT b.student_id, s.name, s.grade, s.section, b.direction, b.at
           FROM app.boarding b JOIN app.students s ON s.id=b.student_id
          WHERE b.run_id=$1 ORDER BY s.name, b.direction`, [run.id])).rows;
      const riders = (await c.query(
        `SELECT count(*)::int AS n FROM app.students WHERE status='active' AND bus_route IS NOT NULL AND bus_route<>''`)).rows[0].n;
      const boarded = new Set(rows.filter((r) => r.direction === 'board').map((r) => r.student_id)).size;
      return { run, boardings: rows, riders, completeness: riders ? Math.round(boarded / riders * 1000) / 10 : null };
    });
  });
  app.get('/transport/attendants', { preHandler: roleGatedMe('owner','principal','transport','coordinator','itadmin') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT a.id, a.name, a.route_id, a.police_verified_on, u.name AS staff_name, u.role AS staff_role
           FROM app.attendants a LEFT JOIN app.users u ON u.id=a.user_id ORDER BY a.name`);
      return { attendants: r.rows };
    });
  });
  app.post('/transport/attendants', { preHandler: require('owner','principal','transport','coordinator','itadmin') }, async (req, reply) => {
    const b = req.body ?? {};
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : '';
    if (!name && !b.userId) return bad(reply, 'name or an existing staff userId is required (contract drivers have names, not accounts)');
    if (b.userId !== undefined && b.userId !== null && String(b.userId).trim() !== '' && !UUID_RE_NOTICE.test(String(b.userId))) {
      return bad(reply, 'userId must be a uuid');
    }
    let routeId = null;
    if (b.routeId !== undefined && b.routeId !== null && String(b.routeId).trim() !== '') {
      if (!UUID_RE_NOTICE.test(String(b.routeId))) return bad(reply, 'routeId must be a uuid');
      routeId = String(b.routeId);
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      let userId = null;
      let label = name;
      if (b.userId) {
        const u = (await c.query(`SELECT id, name FROM app.users WHERE id=$1 AND active AND role NOT IN ('parent','student','api')`, [b.userId])).rows[0];
        if (!u) return bad(reply, 'No active staff with that id', 404);
        userId = u.id;
        label = label || u.name;
      }
      const row = (await c.query(
        `INSERT INTO app.attendants (tenant_id, user_id, name, route_id, created_by) VALUES ($1,$2,$3,$4,$5)
         RETURNING id, name, route_id`,
        [req.user.tenant_id, userId, label, routeId, req.user.id])).rows[0];
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Attendant rostered', recordType: 'Attendant', recordRef: row.id, reason: label, policyRef: 'Transport (attendant rule)', risk: 'low', outcome: 'rostered — police verification still pending' });
      return { attendant: row };
    });
  });
  app.put('/transport/attendants/:id/verify', { preHandler: [require('owner','principal','transport','coordinator','itadmin'), uuidParams('id')] }, async (req, reply) => {
    if (!DATE_RE.test(String(req.body?.policeVerifiedOn ?? ''))) return bad(reply, 'policeVerifiedOn must be YYYY-MM-DD');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`UPDATE app.attendants SET police_verified_on=$1::date WHERE id=$2 RETURNING id, name`,
        [String(req.body.policeVerifiedOn), req.params.id]);
      if (!r.rows[0]) return bad(reply, 'No attendant with that id', 404);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Attendant police-verified', recordType: 'Attendant', recordRef: r.rows[0].id, reason: r.rows[0].name, policyRef: 'NCPCR (staff verification)', risk: 'low', outcome: `verified ${req.body.policeVerifiedOn}` });
      return { ok: true };
    });
  });
  app.get('/transport/fares', { preHandler: roleGatedMe('owner','principal','transport','coordinator','itadmin', 'finance', 'finance_head') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT academic_year, per_km_cents FROM app.fares ORDER BY academic_year DESC LIMIT 5`);
      return { fares: r.rows };
    });
  });
  app.put('/transport/fares', { preHandler: require('owner', 'principal', 'finance_head') }, async (req, reply) => {
    const year = typeof req.body?.academicYear === 'string' ? req.body.academicYear.trim().slice(0, 12) : '';
    const perKm = Number(req.body?.perKmCents);
    if (!year) return bad(reply, 'academicYear is required');
    if (!Number.isInteger(perKm) || perKm < 0) return bad(reply, 'perKmCents must be a non-negative integer (paise per km)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      await c.query(
        `INSERT INTO app.fares (tenant_id, academic_year, per_km_cents, created_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, academic_year) DO UPDATE SET per_km_cents=EXCLUDED.per_km_cents`,
        [req.user.tenant_id, year, perKm, req.user.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Transport fare set', recordType: 'Fare', recordRef: year, reason: `₹${(perKm / 100).toFixed(2)}/km`, policyRef: 'Transport (RTA fare)', risk: 'medium', outcome: 'rate on record' });
      return { ok: true, academicYear: year, perKmCents: perKm };
    });
  });
  app.post('/transport/fares/quote', { preHandler: roleGatedMe('owner','principal','transport','coordinator','itadmin', 'finance', 'finance_head', 'admissions') }, async (req, reply) => {
    const km = Number(req.body?.km);
    if (!Number.isFinite(km) || km < 0 || km > 200) return bad(reply, 'km must be 0–200');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rate = (await c.query(`SELECT per_km_cents, academic_year FROM app.fares ORDER BY academic_year DESC LIMIT 1`)).rows[0];
      if (!rate) return bad(reply, 'No fare rate on record — the office sets ₹/km first', 409);
      return { amountCents: Math.round(rate.per_km_cents * km), perKmCents: rate.per_km_cents, academicYear: rate.academic_year };
    });
  });
  app.get('/transport/inspections', { preHandler: roleGatedMe('owner','principal','transport','coordinator','itadmin') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT id, route_id, title, detail, inspected_on FROM app.inspections ORDER BY inspected_on DESC LIMIT 100`);
      return { inspections: r.rows };
    });
  });
  app.post('/transport/inspections', { preHandler: require('owner','principal','transport','coordinator','itadmin') }, async (req, reply) => {
    const b = req.body ?? {};
    const title = typeof b.title === 'string' ? b.title.trim().slice(0, 160) : '';
    if (!title) return bad(reply, 'title is required (e.g. joint RTO–education inspection)');
    if (!DATE_RE.test(String(b.inspectedOn ?? ''))) return bad(reply, 'inspectedOn must be YYYY-MM-DD');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `INSERT INTO app.inspections (tenant_id, route_id, title, detail, inspected_on, created_by)
         VALUES ($1,$2,$3,$4,$5::date,$6) RETURNING id, title, inspected_on`,
        [req.user.tenant_id, b.routeId ?? null, title,
         typeof b.detail === 'string' ? b.detail.trim().slice(0, 2000) : null,
         String(b.inspectedOn), req.user.id])).rows[0];
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Transport inspection logged', recordType: 'Inspection', recordRef: row.id, reason: title, policyRef: 'Transport (joint inspection)', risk: 'low', outcome: 'on record' });
      return { inspection: row };
    });
  });
  app.get('/transport/compliance-report', { preHandler: roleGatedMe('owner','principal','transport','coordinator','itadmin') }, async (req, reply) => {
    const q = typeof req.query?.quarter === 'string' ? req.query.quarter.trim() : '';
    if (!/^[0-9]{4}-Q[1-4]$/.test(q)) return bad(reply, 'quarter must be YYYY-QN (e.g. 2026-Q3)');
    const [yy, qq] = [q.slice(0, 4), Number(q.slice(-1))];
    const from = `${yy}-${String((qq - 1) * 3 + 1).padStart(2, '0')}-01`;
    const to = `${yy}-${String(qq * 3 + 1).padStart(2, '0')}-01`;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const runs = (await c.query(
        `SELECT count(*)::int AS n FROM app.bus_runs WHERE ran_on >= $1::date AND ran_on < $2::date`, [from, to])).rows[0].n;
      const board = (await c.query(
        `SELECT count(DISTINCT (run_id, student_id))::int AS boarded FROM app.boarding b
          JOIN app.bus_runs r ON r.id=b.run_id WHERE r.ran_on >= $1::date AND r.ran_on < $2::date AND b.direction='board'`, [from, to])).rows[0].boarded;
      const att = (await c.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE police_verified_on IS NOT NULL)::int AS verified FROM app.attendants`)).rows[0];
      const insp = (await c.query(
        `SELECT count(*)::int AS n FROM app.inspections WHERE inspected_on >= $1::date AND inspected_on < $2::date`, [from, to])).rows[0].n;
      return { quarter: q, runs, boardings: board, attendants: att, inspections: insp,
        note: 'District-committee pack: runs, boarding marks, attendant verification and inspections, straight from the registers.' };
    });
  });

  // Payroll ECS proof file: office-only, audited read, real bank accounts — handle like cash.
  app.get('/payroll/runs/:id/ecs-file', { preHandler: [require('owner', 'finance_head'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const run = (await c.query(`SELECT id, month, status, total_cents FROM app.payroll_runs WHERE id=$1`, [req.params.id])).rows[0];
      if (!run) return bad(reply, 'No pay run with that id', 404);
      if (run.status !== 'disbursed') return bad(reply, `Run ${run.month} is ${run.status} — the ECS file proves a disbursement, so it issues only after disbursing`, 409);
      const rows = (await c.query(
        `SELECT u.name, s.bank_acct, p.monthly_cents FROM app.payroll_payslips p
           JOIN app.users u ON u.id=p.user_id LEFT JOIN app.payroll_structures s ON s.user_id=u.id
          WHERE p.run_id=$1 ORDER BY u.name`, [run.id])).rows;
      const missing = rows.filter((r) => !r.bank_acct);
      const csv = ['name,bank_acct,amount_paise,month,run_ref',
        ...rows.filter((r) => r.bank_acct).map((r) => `"${String(r.name).replace(/"/g, '')}",${r.bank_acct},${r.monthly_cents},${run.month},${run.id}`)].join('\n');
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'ECS file downloaded', recordType: 'PayrollRun', recordRef: run.id, reason: run.month, policyRef: 'Payroll (bank/ECS proof)', risk: 'high', outcome: `${rows.length - missing.length} credited line(s)${missing.length ? ` · ${missing.length} without bank details excluded` : ''}` });
      reply.header('content-type', 'text/csv');
      reply.header('content-disposition', `attachment; filename="ecs-${run.month}.csv"`);
      return reply.send(csv);
    });
  });

  // Staff QR attendance: the token is an HMAC of tenant+day (no database, no replay across days).
  // Marking is one row per person per day — scanning twice is a no-op with already:true.
  app.get('/staff-attendance/qr', { preHandler: require('owner', 'principal', 'itadmin', 'coordinator') }, async (req) => {
    const day = new Date().toISOString().slice(0, 10);
    const { createHmac } = await import('node:crypto');
    const token = createHmac('sha256', `${process.env.JWT_SECRET ?? 'dev-only-secret-change-me'}|qr`).update(`${req.user.tenant_id}|${day}`).digest('hex');
    return { token, day };
  });
  app.post('/staff-attendance/scan', { preHandler: require('owner', 'principal', 'itadmin', 'coordinator', 'teacher', 'counselor', 'finance', 'finance_head', 'finance_clerk', 'admissions', 'transport', 'facilities', 'technician', 'librarian') }, async (req, reply) => {
    const token = String(req.body?.token ?? '');
    if (!/^[0-9a-f]{64}$/.test(token)) return bad(reply, 'token must be the day QR value');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const day = new Date().toISOString().slice(0, 10);
      const { createHmac } = await import('node:crypto');
      const want = createHmac('sha256', `${process.env.JWT_SECRET ?? 'dev-only-secret-change-me'}|qr`).update(`${req.user.tenant_id}|${day}`).digest('hex');
      if (token.length !== want.length) return bad(reply, 'This QR is not for today', 403);
      let ok = true;
      try {
        const { timingSafeEqual } = await import('node:crypto');
        ok = timingSafeEqual(Buffer.from(token), Buffer.from(want));
      } catch { ok = false; }
      if (!ok) return bad(reply, 'This QR is not for today', 403);
      const row = (await c.query(
        `INSERT INTO app.staff_attendance (tenant_id, user_id, day, source, created_by) VALUES ($1,$2,$3::date,'qr',$4)
         ON CONFLICT (tenant_id, user_id, day) DO NOTHING RETURNING day`,
        [req.user.tenant_id, req.user.id, day, req.user.id])).rows[0];
      return { marked: true, already: !row, day };
    });
  });
  app.post('/staff-attendance/mark', { preHandler: require('owner', 'principal', 'itadmin', 'coordinator') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!UUID_RE_NOTICE.test(String(b.userId ?? ''))) return bad(reply, 'userId must be a uuid');
    if (!DATE_RE.test(String(b.day ?? ''))) return bad(reply, 'day must be YYYY-MM-DD');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const u = (await c.query(`SELECT id, name FROM app.users WHERE id=$1 AND active AND role NOT IN ('parent','student','api')`, [b.userId])).rows[0];
      if (!u) return bad(reply, 'No active staff with that id', 404);
      await c.query(
        `INSERT INTO app.staff_attendance (tenant_id, user_id, day, source, created_by) VALUES ($1,$2,$3::date,'manual',$4)
         ON CONFLICT (tenant_id, user_id, day) DO NOTHING`,
        [req.user.tenant_id, u.id, String(b.day), req.user.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Staff presence marked', recordType: 'StaffAttendance', recordRef: `${u.id}/${b.day}`, reason: u.name, policyRef: 'HR (attendance)', risk: 'low', outcome: 'present' });
      return { marked: true };
    });
  });

  // DPDP breach register: found → contained → notified/closed, with the 72-hour clock visible.
  app.get('/dpdp/breaches', { preHandler: roleGatedMe('owner', 'principal', 'itadmin') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT id, title, detail, found_on, contained_on, notified_on, status FROM app.breach_log ORDER BY found_on DESC LIMIT 100`);
      return { breaches: r.rows };
    });
  });
  app.post('/dpdp/breaches', { preHandler: require('owner', 'principal', 'itadmin') }, async (req, reply) => {
    const b = req.body ?? {};
    const title = typeof b.title === 'string' ? b.title.trim().slice(0, 160) : '';
    const detail = typeof b.detail === 'string' ? b.detail.trim().slice(0, 2000) : '';
    if (!title || !detail) return bad(reply, 'title and detail are required (what happened, whose data)');
    if (!DATE_RE.test(String(b.foundOn ?? ''))) return bad(reply, 'foundOn must be YYYY-MM-DD');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(
        `INSERT INTO app.breach_log (tenant_id, title, detail, found_on, created_by) VALUES ($1,$2,$3,$4::date,$5)
         RETURNING id, title, status, found_on`,
        [req.user.tenant_id, title, detail, String(b.foundOn), req.user.id])).rows[0];
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Breach recorded', recordType: 'Breach', recordRef: row.id, reason: title, policyRef: 'DPDP (breach notification)', risk: 'high', outcome: '72-hour clock running' });
      await emitEvent(c, req.user.tenant_id, { type: 'governance', label: `Possible breach recorded — ${title}`, ref: row.id });
      return { breach: row };
    });
  });
  app.post('/dpdp/breaches/:id/contain', { preHandler: [require('owner', 'principal', 'itadmin'), uuidParams('id')] }, async (req, reply) => {
    const b = req.body ?? {};
    if (b.containedOn !== undefined && b.containedOn !== null && String(b.containedOn).trim() !== '' && !DATE_RE.test(String(b.containedOn).trim())) {
      return bad(reply, 'containedOn must be YYYY-MM-DD');
    }
    if (b.notifiedOn !== undefined && b.notifiedOn !== null && String(b.notifiedOn).trim() !== '' && !DATE_RE.test(String(b.notifiedOn).trim())) {
      return bad(reply, 'notifiedOn must be YYYY-MM-DD');
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const cur = (await c.query(`SELECT id, status FROM app.breach_log WHERE id=$1`, [req.params.id])).rows[0];
      if (!cur) return bad(reply, 'No breach with that id', 404);
      if (cur.status === 'closed') return bad(reply, 'A closed breach is history — record a new one if something changed', 409);
      const notified = b.notifiedOn && String(b.notifiedOn).trim() ? String(b.notifiedOn).trim() : null;
      const status = notified ? 'closed' : 'contained';
      await c.query(`UPDATE app.breach_log SET contained_on=$1::date, notified_on=$2::date, status=$3 WHERE id=$4`,
        [b.containedOn && String(b.containedOn).trim() ? String(b.containedOn).trim() : null, notified, status, cur.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Breach ${status}`, recordType: 'Breach', recordRef: cur.id, reason: b.note ?? status, policyRef: 'DPDP (breach notification)', risk: 'high', outcome: status });
      return { ok: true, status };
    });
  });

  // Emergency broadcast: owner/principal compose AND approve at once — they ARE the authority,
  // and an emergency must not wait in a queue. Audited high-risk; recipients resolved first so an
  // empty audience refuses before anything is written (FIX-12 shape).
  app.post('/announcements/emergency', { preHandler: require('owner', 'principal') }, async (req, reply) => {
    const { title, body, audienceKind, audienceRef, channel } = req.body ?? {};
    if (!title || !body) return bad(reply, 'title and body are required');
    const kind = String(audienceKind ?? 'all_guardians');
    if (!['all_guardians', 'class', 'route', 'staff', 'custom'].includes(kind)) return bad(reply, 'unknown audience');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const recipients = await announceReach(c, req.user.tenant_id, kind, audienceRef, channel ?? 'In-app');
      if (recipients.length === 0) return bad(reply, 'no reachable recipients resolved for this audience — nothing to send', 409);
      const a = (await c.query(
        `INSERT INTO app.announcements (tenant_id, title, body, audience_kind, audience_ref, channel, status, created_by, priority)
         VALUES ($1,$2,$3,$4,$5,$6,'queued',$7,'emergency') RETURNING *`,
        [req.user.tenant_id, title, body, kind, audienceRef ?? null, channel ?? 'In-app', req.user.id])).rows[0];
      const inApp = String(channel ?? 'In-app').toLowerCase() === 'in-app';
      if (inApp) {
        for (const uid of recipients) {
          await c.query(
            `INSERT INTO app.notifications (tenant_id, user_id, "group", title, body, ref) VALUES ($1,$2,'school',$3,$4,$5)`,
            [req.user.tenant_id, uid, title, body, `/announcements/${a.id}`]);
          await c.query(
            `INSERT INTO app.announcement_receipts (tenant_id, announcement_id, user_id, channel, status, detail)
             VALUES ($1,$2,$3,'In-app','delivered','emergency broadcast')`, [req.user.tenant_id, a.id, uid]);
        }
      } else {
        const comm = await c.query(
          `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, status, policy_ref, approved_by)
           VALUES ($1,$2::jsonb,$3,'ANNOUNCEMENT',$4,'queued','Communication §2', $5) RETURNING *`,
          [req.user.tenant_id, JSON.stringify(recipients), channel, body, req.user.id]);
        for (const phone of recipients) {
          await c.query(
            `INSERT INTO app.announcement_receipts (tenant_id, announcement_id, user_id, channel, status, detail)
             VALUES ($1,$2,NULL,$3,'queued',$4)`,
            [req.user.tenant_id, a.id, channel, `to ****${String(phone).slice(-4)}`]);
        }
        await c.query(`UPDATE app.announcements SET comm_id=$2 WHERE id=$1`, [a.id, comm.rows[0].id]);
      }
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Emergency broadcast: ${title}`, recordType: 'Announcement', recordRef: a.id, reason: `emergency · ${kind}`, policyRef: 'Communication §2 (emergency)', risk: 'high', outcome: `${recipients.length} recipient(s) queued at once` });
      await emitEvent(c, req.user.tenant_id, { type: 'comms', label: `Emergency broadcast "${title}" to ${recipients.length} recipient(s)`, ref: a.id });
      return { announcement: { ...a, status: 'queued' } };
    });
  });
  // Unacked escalation list: who has NOT signed (phones included — the office calls them).
  // Full numbers because this door is office-only; the ledger records every read of it.
  app.get('/announcements/:id/unacked', { preHandler: [roleGatedMe('owner', 'principal', 'coordinator', 'itadmin'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const a = (await c.query(`SELECT id, title, audience_kind, audience_ref, channel FROM app.announcements WHERE id=$1`, [req.params.id])).rows[0];
      if (!a) return bad(reply, 'No announcement with that id', 404);
      const acked = new Set((await c.query(`SELECT user_id FROM app.announcement_acks WHERE announcement_id=$1`, [a.id])).rows.map((r) => r.user_id));
      const ids = await announceReach(c, req.user.tenant_id, a.audience_kind, a.audience_ref, a.channel);
      const users = ids.length ? (await c.query(
        `SELECT id, name, role, phone FROM app.users WHERE id = ANY($1::uuid[])`, [ids])).rows : [];
      const unacked = users.filter((u) => !acked.has(u.id));
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Read unacked list', recordType: 'Announcement', recordRef: a.id, reason: a.title, policyRef: 'Communication §2 (escalation)', risk: 'medium', outcome: `${unacked.length} unacked` });
      return { announcement: { id: a.id, title: a.title }, ackedCount: users.length - unacked.length, unacked };
    });
  });

  // ---- Master Action Plan 4.5 · safety-audit checklist (NCPCR-mapped) + police
  // verification tracker for all account-holding staff/drivers ----
  // The checklist is a curated wall mapped to the NCPCR/MoE safety-manual headings —
  // coverage for a specific board still needs the school's lawyer to confirm, and the
  // screen says so. Attestations are history (open<->done flips, never deletes).
  const SAFETY_CHECKLIST = [
    { code: 'child-protection-committee', title: 'Child protection committee', detail: 'Named committee (POCSO Act) with displayed contacts, meeting minutes on file.' },
    { code: 'pocso-orientation', title: 'Staff POCSO orientation', detail: 'Every staff member oriented on POCSO duties this year; orientation dates on record.' },
    { code: 'cctv-premises', title: 'CCTV + premises watch', detail: 'Entry/exit and corridor coverage working; footage retention policy on record.' },
    { code: 'visitor-management', title: 'Visitor management', detail: 'Gate passes, visitor log and pickup-OTP discipline in daily use.' },
    { code: 'transport-safety', title: 'Transport safety', detail: 'Attendants rostered, police verification on file, boarding timestamps kept.' },
    { code: 'health-hygiene', title: 'Health + hygiene', detail: 'Safe drinking water, functional toilets (boys/girls), clinic log kept.' },
    { code: 'emergency-preparedness', title: 'Emergency preparedness', detail: 'Fire drill this term, evacuation plan displayed, emergency contacts current.' },
    { code: 'staff-verification', title: 'Staff police verification', detail: 'Every account-holding staff member verified within validity (see the ledger below).' },
    { code: 'grievance-box', title: 'Complaint / suggestion box', detail: 'Pupil complaint box checked weekly; safety-box reports reviewed by the designated authority.' },
    { code: 'cyber-safety', title: 'Cyber safety', detail: 'Pupil photo/device policy on record; no child data leaves the school without consent.' },
    { code: 'playground-safety', title: 'Playground + equipment', detail: 'Play area inspected; broken equipment retired, not taped off.' },
    { code: 'boundary-security', title: 'Boundary + building', detail: 'Boundary wall/compound secure; building safety (fire NOC) certificate live, not expired.' },
  ];
  const seedSafetyChecks = async (c, tenantId) => {
    for (const item of SAFETY_CHECKLIST) {
      await c.query(
        `INSERT INTO app.safety_checks (tenant_id, code, title, detail, status) VALUES ($1,$2,$3,$4,'open')
         ON CONFLICT (tenant_id, code) DO NOTHING`,
        [tenantId, item.code, item.title, item.detail]);
    }
  };
  const safetyScore = async (c) => {
    const r = (await c.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE status='done')::int AS done FROM app.safety_checks`)).rows[0];
    return { total: r.total, done: r.done, pct: r.total ? Math.round((r.done / r.total) * 100) : null };
  };
  // Verification state for one user on a date: valid | expiring (≤60d) | expired | missing.
  // Missing warns but never blocks (a school that never recorded anything is nagged, not
  // locked out day one); expired blocks the duty roster.
  const verificationState = (row, day) => {
    if (!row || !row.expires_on) return 'missing';
    const exp = String(row.expires_on).slice(0, 10);
    if (exp < day) return 'expired';
    const soon = new Date(day);
    soon.setDate(soon.getDate() + 60);
    if (exp <= soon.toISOString().slice(0, 10)) return 'expiring';
    return 'valid';
  };
  app.get('/safety/checklist', { preHandler: roleGatedMe('owner', 'principal', 'itadmin', 'coordinator', 'counselor') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      await seedSafetyChecks(c, req.user.tenant_id);
      const rows = (await c.query(
        `SELECT id, code, title, detail, status, evidence, checked_on FROM app.safety_checks ORDER BY code`)).rows;
      return { checks: rows, score: await safetyScore(c) };
    });
  });
  app.post('/safety/checks/:id/attest', { preHandler: [require('owner', 'principal', 'itadmin'), uuidParams('id')] }, async (req, reply) => {
    const done = req.body?.done;
    if (typeof done !== 'boolean') return bad(reply, 'done must be true/false');
    const evidence = typeof req.body?.evidence === 'string' ? req.body.evidence.trim().slice(0, 500) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const cur = (await c.query(`SELECT id, code, title, status FROM app.safety_checks WHERE id=$1`, [req.params.id])).rows[0];
      if (!cur) return bad(reply, 'No checklist item with that id', 404);
      const row = (await c.query(
        `UPDATE app.safety_checks SET status=$1, evidence=$2, checked_on=CURRENT_DATE, checked_by=$3, updated_at=now()
         WHERE id=$4 RETURNING id, code, title, status, evidence, checked_on`,
        [done ? 'done' : 'open', evidence, req.user.id, cur.id])).rows[0];
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Safety check ${done ? 'attested' : 'reopened'}: ${cur.title}`, recordType: 'SafetyCheck', recordRef: cur.id, reason: cur.code, policyRef: 'Safety (NCPCR-mapped audit)', risk: 'medium', outcome: row.status });
      return { check: row, score: await safetyScore(c) };
    });
  });
  app.get('/staff-verifications', { preHandler: roleGatedMe('owner', 'principal', 'itadmin', 'coordinator') }, async (req) => {
    const day = new Date().toISOString().slice(0, 10);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const staff = (await c.query(
        `SELECT id, name, role FROM app.users
         WHERE active AND role NOT IN ('parent','student','api') ORDER BY name`)).rows;
      // dates as TEXT (see hr.leave roster note): pg DATE columns arrive as JS Date
      // objects whose toString is locale-shaped, useless for lexicographic compare.
      const vers = (await c.query(
        `SELECT user_id, kind, to_char(verified_on,'YYYY-MM-DD') AS verified_on,
                to_char(expires_on,'YYYY-MM-DD') AS expires_on, note FROM app.staff_verifications`)).rows;
      const byUser = new Map(vers.map((v) => [v.user_id, v]));
      return {
        day,
        staff: staff.map((u) => {
          const v = byUser.get(u.id) ?? null;
          return { userId: u.id, name: u.name, role: u.role, state: verificationState(v, day),
            verifiedOn: v?.verified_on ?? null, expiresOn: v?.expires_on ?? null, note: v?.note ?? null };
        }),
      };
    });
  });
  app.post('/staff-verifications', { preHandler: require('owner', 'principal', 'itadmin') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!UUID_RE_NOTICE.test(String(b.userId ?? ''))) return bad(reply, 'userId must be a uuid');
    if (!DATE_RE.test(String(b.verifiedOn ?? ''))) return bad(reply, 'verifiedOn must be YYYY-MM-DD');
    const years = b.validYears === undefined ? 3 : Number(b.validYears);
    if (!Number.isInteger(years) || years < 1 || years > 10) return bad(reply, 'validYears must be 1–10');
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 500) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const u = (await c.query(
        `SELECT id, name, role FROM app.users WHERE id=$1 AND active AND role NOT IN ('parent','student','api')`,
        [String(b.userId)])).rows[0];
      if (!u) return bad(reply, 'No active staff with that id (parents, pupils and API accounts are never verified here)', 404);
      const exp = new Date(`${String(b.verifiedOn)}T00:00:00Z`);
      exp.setUTCFullYear(exp.getUTCFullYear() + years);
      const expiresOn = exp.toISOString().slice(0, 10);
      const row = (await c.query(
        `INSERT INTO app.staff_verifications (tenant_id, user_id, kind, verified_on, expires_on, verified_by, note)
         VALUES ($1,$2,'police',$3::date,$4::date,$5,$6)
         ON CONFLICT (tenant_id, user_id, kind) DO UPDATE
           SET verified_on=EXCLUDED.verified_on, expires_on=EXCLUDED.expires_on,
               verified_by=EXCLUDED.verified_by, note=EXCLUDED.note, updated_at=now()
         RETURNING user_id`,
        [req.user.tenant_id, u.id, String(b.verifiedOn), expiresOn, req.user.id, note])).rows[0];
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Police verification recorded: ${u.name}`, recordType: 'StaffVerification', recordRef: u.id, reason: `${u.role} · valid ${years}y`, policyRef: 'Safety (staff verification)', risk: 'medium', outcome: `expires ${expiresOn}` });
      // dates cross the wire as YYYY-MM-DD text (a pg DATE arrives as a JS Date whose
      // ISO string shifts a day under IST) — the computed expiry, not the row echo.
      return { verification: { user_id: row.user_id, verified_on: String(b.verifiedOn), expires_on: expiresOn } };
    });
  });

  // ---- Master Action Plan batch 4 · UDISE validation, hike gate, pupil QR, bus ETA,
  // stale-approval escalation ----
  // UDISE readiness: profile + people + money + R3 + MPD affiliation, each named. Read-only.
  app.get('/returns/udise/validate', { preHandler: roleGatedMe('owner', 'principal', 'itadmin', 'coordinator') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const checks = [];
      const infra = (await c.query(`SELECT * FROM app.school_infra LIMIT 1`)).rows[0] ?? null;
      const need = (key, label, ok, detail) => checks.push({ key, label, status: ok ? 'ok' : 'missing', detail });
      need('infra', 'Infrastructure profile', !!infra, infra ? `${infra.classrooms} rooms · ${infra.labs} labs · toilets ${infra.toilets_boys}/${infra.toilets_girls}` : 'Open Routes & stops → no — the school profile (UDISE section) first');
      const rooms = (await c.query(`SELECT count(*)::int AS n FROM app.school_infra`)).rows[0].n;
      void rooms;
      const people = (await c.query(
        `SELECT (SELECT count(*)::int FROM app.students WHERE status='active') AS pupils,
                (SELECT count(*)::int FROM app.users WHERE active AND role='teacher') AS teachers`)).rows[0];
      need('enrollment', 'Enrollment on record', people.pupils > 0, `${people.pupils} active pupils`);
      need('ptr', 'Pupil–teacher ratio ≤ 35', people.teachers > 0 && people.pupils / people.teachers <= 35,
        people.teachers ? `${people.pupils}:${people.teachers} = ${(people.pupils / people.teachers).toFixed(1)}` : 'No active teachers');
      if (infra) {
        need('toilets', 'Toilets for boys and girls', infra.toilets_boys > 0 && infra.toilets_girls > 0,
          `${infra.toilets_boys} boys · ${infra.toilets_girls} girls`);
        need('water', 'Drinking water', !!infra.drinking_water, infra.drinking_water ? 'recorded' : 'not recorded');
        need('r3', 'Class-6 third language (OASIS R3)', true, 'Recorded per year on the NEP desk (validates separately)');
      }
      const aff = (await c.query(
        `SELECT 1 FROM app.mpd_docs WHERE kind='affiliation_letter' AND active LIMIT 1`)).rows[0];
      need('affiliation', 'Affiliation letter on file', !!aff, aff ? 'MPD vault holds it' : 'File it on the MPD desk');
      return { checks, ready: checks.every((x) => x.status === 'ok') };
    });
  });

  // Pupil QR: day tokens per class roster (HMAC tenant+student+day); marking consumes them.
  // A screenshot from yesterday buys nothing — verification recomputes for today only.
  // Codes are 12 hex chars (48 bits — safe for ≤80-pupil rosters, typeable from a printed slip).
  const pupilQrToken = async (tenantId, studentId, day) => {
    const { createHmac } = await import('node:crypto');
    return createHmac('sha256', `${process.env.JWT_SECRET ?? 'dev-only-secret-change-me'}|qr-pupil`).update(`${tenantId}|${studentId}|${day}`).digest('hex').slice(0, 12);
  };
  app.get('/attendance/qr', { preHandler: roleGatedMe('owner', 'principal', 'coordinator', 'itadmin', 'teacher') }, async (req, reply) => {
    const { grade, section } = req.query ?? {};
    if (!grade || !section) return bad(reply, 'grade and section pick the roster (one class per code sheet)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (req.user.role === 'teacher') {
        const owns = (await c.query(
          `SELECT 1 FROM app.class_assignments WHERE teacher_id=$1 AND grade=$2 AND section=$3 AND active`,
          [req.user.id, String(grade), String(section)])).rows[0];
        if (!owns) return bad(reply, 'QR codes belong to your own classes — ask the coordinator for this one', 403);
      }
      const day = new Date().toISOString().slice(0, 10);
      const pupils = (await c.query(
        `SELECT id, name FROM app.students WHERE status='active' AND grade=$1 AND section=$2 ORDER BY name LIMIT 80`,
        [String(grade), String(section)])).rows;
      const tokens = [];
      for (const p of pupils) tokens.push({ studentId: p.id, name: p.name, code: await pupilQrToken(req.user.tenant_id, p.id, day) });
      return { day, grade, section, tokens };
    });
  });
  app.post('/attendance/qr-mark', { preHandler: require('owner', 'principal', 'coordinator', 'itadmin', 'teacher') }, async (req, reply) => {
    const { date = new Date().toISOString().slice(0, 10), codes } = req.body ?? {};
    const tokens = Array.isArray(codes) ? codes : req.body?.tokens;
    if (!DATE_RE.test(String(date))) return bad(reply, 'date must be YYYY-MM-DD');
    if (!Array.isArray(tokens) || !tokens.length || tokens.length > 80) return bad(reply, 'codes[] with 1–80 scanned codes is required');
    if (String(date) !== new Date().toISOString().slice(0, 10)) {
      return bad(reply, 'QR marking is for today only — past days go through the register with its audit', 403);
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      let owned = null;
      if (req.user.role === 'teacher') {
        owned = new Set((await c.query(
          `SELECT grade || '|' || section AS k FROM app.class_assignments WHERE teacher_id=$1 AND active`, [req.user.id])).rows.map((r) => r.k));
        if (!owned.size) return bad(reply, 'No class is assigned to you yet — the register stays with the office', 403);
      }
      const roster = (await c.query(`SELECT id, name, grade, section FROM app.students WHERE status='active'`)).rows;
      const byToken = new Map();
      for (const p of roster) byToken.set(await pupilQrToken(req.user.tenant_id, p.id, String(date)), p);
      const marked = [];
      let invalid = 0;
      for (const t of new Set(tokens.map(String))) {
        const p = byToken.get(t);
        if (!p) { invalid += 1; continue; }
        if (owned && !owned.has(`${p.grade}|${p.section}`)) { invalid += 1; continue; }
        await c.query(
          `INSERT INTO app.attendance (tenant_id, student_id, school_date, status, marked_by)
           VALUES ($1,$2,$3::date,'present',$4)
           ON CONFLICT (tenant_id, student_id, school_date) DO UPDATE SET status='present', marked_by=EXCLUDED.marked_by, marked_at=now()`,
          [req.user.tenant_id, p.id, String(date), req.user.id]);
        marked.push(p.name);
      }
      if (marked.length) {
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Marked attendance via QR', recordType: 'Attendance', recordRef: String(date), reason: `${marked.length} scanned`, policyRef: 'Attendance (QR)', risk: 'low', outcome: `${marked.join(', ').slice(0, 200)}${invalid ? ` · ${invalid} invalid ignored` : ''}` });
      }
      return { marked, markedCount: marked.length, invalid };
    });
  });

  // My day code: a pupil's own 12-char code for today (portal-bound account only).
  app.get('/attendance/my-qr', { preHandler: roleGatedMe('student') }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const st = (await c.query(`SELECT id, name FROM app.students WHERE user_id=$1 AND status='active'`, [req.user.id])).rows[0];
      if (!st) return bad(reply, 'No pupil portal is linked to this account yet — ask the school office', 404);
      const day = new Date().toISOString().slice(0, 10);
      return { code: await pupilQrToken(req.user.tenant_id, st.id, day), day, name: st.name };
    });
  });

  // Bus ETA: scheduled stop times from today's run start + offsets, with boarding state.
  app.get('/transport/runs/:id/eta', { preHandler: [roleGatedMe('owner', 'principal', 'transport', 'coordinator', 'itadmin', 'parent'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const run = (await c.query(
        `SELECT r.id, r.route_id, r.ran_on, r.created_at, t.code, t.name FROM app.bus_runs r
           JOIN app.routes t ON t.id = r.route_id WHERE r.id=$1`, [req.params.id])).rows[0];
      if (!run) return bad(reply, 'No run with that id', 404);
      const stops = (await c.query(
        `SELECT name, eta_offset_mins, seq FROM app.route_stops WHERE route_id=$1 ORDER BY seq`, [run.route_id])).rows;
      const boarded = new Set((await c.query(
        `SELECT DISTINCT student_id FROM app.boarding WHERE run_id=$1 AND direction='board'`, [run.id])).rows.map((r) => r.student_id));
      const start = new Date(run.created_at).getTime();
      return {
        run: { id: run.id, code: run.code, name: run.name, ranOn: run.ran_on },
        stops: stops.map((s) => ({
          name: s.name, scheduledAt: new Date(start + Number(s.eta_offset_mins ?? 0) * 60000).toISOString(),
        })),
        boardedCount: boarded.size,
      };
    });
  });

  // Stale approvals: open approval actions older than N days + one-tap escalation digest to owners.
  app.get('/actions/stale', { preHandler: roleGatedMe('owner', 'principal', 'itadmin', 'coordinator') }, async (req, reply) => {
    const days = req.query?.days === undefined ? 1 : Number(req.query.days);
    if (!Number.isFinite(days) || days < 0 || days > 3650) return bad(reply, 'days must be 0–3650');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT id, code, kind, title, priority, created_at FROM app.actions
          WHERE kind='approval' AND status='open' AND created_at < now() - ($1 || ' days')::interval
          ORDER BY created_at LIMIT 100`, [String(days)]);
      return { days, stale: r.rows };
    });
  });
  app.post('/actions/stale/escalate', { preHandler: require('owner', 'principal', 'itadmin', 'coordinator') }, async (req, reply) => {
    const days = req.body?.days === undefined ? 1 : Number(req.body.days);
    if (!Number.isFinite(days) || days < 0 || days > 3650) return bad(reply, 'days must be 0–3650');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const stale = (await c.query(
        `SELECT id, code, title FROM app.actions
          WHERE kind='approval' AND status='open' AND created_at < now() - ($1 || ' days')::interval
          ORDER BY created_at LIMIT 50`, [String(days)])).rows;
      if (!stale.length) return { escalated: 0 };
      const owners = (await c.query(
        `SELECT id FROM app.users WHERE active AND role IN ('owner','principal')`)).rows;
      for (const u of owners) {
        await c.query(
          `INSERT INTO app.notifications (tenant_id, user_id, "group", title, body, ref)
           VALUES ($1,$2,'approvals','Stale approvals need you',$3,'/action-center')`,
          [req.user.tenant_id, u.id, `${stale.length} approval(s) open beyond ${days}d: ${stale.slice(0, 5).map((s) => s.title).join(' · ')}`]);
      }
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Escalated stale approvals', recordType: 'Action', recordRef: `${stale.length} action(s)`, reason: `open beyond ${days}d`, policyRef: 'Automation (SLA)', risk: 'low', outcome: `digest to ${owners.length} owner(s)/principal(s)` });
      return { escalated: stale.length };
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

  // FEE-COM-1: the fee feature matrix surfaced with the tenant's plan, so a client can show what is
  // available and what each locked feature would require.
  // A6/D12: per-tenant fee policy is now writable (it was read-only; only tests wrote it directly).
  const FEE_SETTINGS_ROLES = ['owner', 'principal', 'finance', 'finance_head'];
  app.get('/fees/settings', { preHandler: require(...FEE_SETTINGS_ROLES) }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => ({ settings: await feeSettings(c, req.user.tenant_id) }));
  });
  app.put('/fees/settings', { preHandler: require('owner', 'finance_head') }, async (req, reply) => {
    const b = req.body ?? {};
    const numeric = ['refund_approval_threshold_cents', 'reconciliation_tolerance_cents', 'min_partial_cents', 'receipt_series_start', 'late_fee_per_day_cents', 'late_fee_cap_cents', 'late_fee_grace_days',
      'late_fee_fixed_cents', 'refund_window_days', 'installment_max_parts', 'max_extension_days', 'settlement_slo_hours', 'hike_evidence_max_age_days'];
    const bools = ['allow_parent_partial', 'late_fee_enabled', 'late_fee_auto_run', 'refund_require_reason', 'refund_partial_allowed', 'refund_auto_gateway',
      'cash_requires_pin', 'invoice_show_breakup', 'installment_allow_edit', 'dunning_enabled', 'dunning_stop_on_partial', 'reconciliation_auto_match', 'allow_owner_self_approve'];
    const patch = {};
    for (const k of numeric) {
      if (b[k] == null) continue;
      const n = Number(b[k]);
      if (!Number.isFinite(n) || n < 0) return bad(reply, `${k} must be a non-negative number`);
      patch[k] = Math.trunc(n);
    }
    for (const k of bools) if (b[k] != null) patch[k] = Boolean(b[k]);
    if (b.receipt_prefix != null) patch.receipt_prefix = String(b.receipt_prefix).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'RCP';
    // Enums (tenant-configurable policy modes — invalid values are 400, never silently coerced).
    const enums = {
      late_fee_mode: ['per_day', 'fixed', 'percent'],
      overpayment_rule: ['refuse', 'keep_credit', 'refund'],
      receipt_reset: ['never', 'yearly', 'academic_year'],
      installment_mode: ['equal', 'custom', 'percent'],
      installment_rounding: ['remainder_last'],
      concession_stacking: ['single_best', 'additive_capped'],
    };
    for (const [k, allowed] of Object.entries(enums)) {
      if (b[k] == null) continue;
      if (!allowed.includes(String(b[k]))) return bad(reply, `${k} must be one of ${allowed.join(', ')}`);
      patch[k] = String(b[k]);
    }
    // Percentages 0..100 (may be fractional — stored as-is).
    for (const k of ['late_fee_percent', 'refund_deduction_pct', 'concession_cap_pct', 'staff_default_pct', 'hike_review_threshold_pct']) {
      if (b[k] == null) continue;
      const n = Number(b[k]);
      if (!Number.isFinite(n) || n < 0 || n > 100) return bad(reply, `${k} must be 0..100`);
      patch[k] = n;
    }
    for (const k of ['sibling_min_children']) {
      if (b[k] == null) continue;
      const n = Number(b[k]);
      if (!Number.isInteger(n) || n < 2 || n > 10) return bad(reply, `${k} must be 2..10`);
      patch[k] = n;
    }
    // Method / channel lists.
    if (b.enabled_methods != null) {
      const METHODS = ['upi', 'razorpay', 'cash', 'card', 'cheque', 'netbanking', 'bank_transfer', 'manual'];
      if (!Array.isArray(b.enabled_methods) || !b.enabled_methods.length || b.enabled_methods.some((m) => !METHODS.includes(String(m)))) {
        return bad(reply, `enabled_methods must be a non-empty subset of ${METHODS.join(', ')}`);
      }
      patch.enabled_methods = [...new Set(b.enabled_methods.map(String))];
    }
    if (b.dunning_channels != null) {
      const CH = ['sms', 'whatsapp', 'email'];
      if (!Array.isArray(b.dunning_channels) || !b.dunning_channels.length || b.dunning_channels.some((m) => !CH.includes(String(m)))) {
        return bad(reply, `dunning_channels must be a non-empty subset of ${CH.join(', ')}`);
      }
      patch.dunning_channels = [...new Set(b.dunning_channels.map(String))];
    }
    const dayList = (k, max = 10, lo = 1, hi = 90) => {
      if (b[k] == null) return null;
      if (!Array.isArray(b[k]) || b[k].length > max || b[k].some((n) => !Number.isInteger(n) || n < lo || n > hi)) {
        return `${k} must be a list of ≤${max} integers ${lo}..${hi}`;
      }
      patch[k] = [...new Set(b[k])].sort((x, y) => x - y);
      return null;
    };
    for (const k of ['dunning_before_due_days', 'dunning_escalation_days']) {
      const err = dayList(k);
      if (err) return bad(reply, err);
    }
    // HH:MM fields.
    const hm = (v) => /^([01]?\d|2[0-3]):([0-5]\d)$/.test(String(v ?? ''));
    for (const k of ['dunning_quiet_start', 'dunning_quiet_end', 'default_due_time_ist']) {
      if (b[k] == null) continue;
      if (!hm(b[k])) return bad(reply, `${k} must be HH:MM (24h IST)`);
      patch[k] = String(b[k]);
    }
    if (b.invoice_notes != null) {
      if (typeof b.invoice_notes !== 'string' || b.invoice_notes.length > 500) return bad(reply, 'invoice_notes must be ≤500 characters');
      patch.invoice_notes = b.invoice_notes.trim();
    }
    // Late-fee opt-in is sticky and explicit-wins: setting any rate > 0 without
    // mentioning the flag opts the school in (pre-flag behaviour: any rate = on);
    // an explicit enabled true/false is always honoured and never overridden.
    if (b.late_fee_enabled == null
      && ['late_fee_per_day_cents', 'late_fee_fixed_cents', 'late_fee_percent'].some((k) => b[k] != null && Number(b[k]) > 0)) {
      patch.late_fee_enabled = true;
    }
    if (!Object.keys(patch).length) return bad(reply, 'no recognised setting supplied');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      await c.query(
        `INSERT INTO app.fee_settings (tenant_id, settings, updated_at) VALUES ($1,$2::jsonb, now())
         ON CONFLICT (tenant_id) DO UPDATE SET settings = app.fee_settings.settings || EXCLUDED.settings, updated_at=now()`,
        [req.user.tenant_id, JSON.stringify(patch)]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Fee settings updated', recordType: 'FeeSettings', recordRef: req.user.tenant_id, reason: 'fee policy', policyRef: 'Fees §1', risk: 'medium', outcome: Object.keys(patch).join(', ') });
      return { settings: await feeSettings(c, req.user.tenant_id) };
    });
  });

  // D2 · apply late fees to overdue obligations from the tenant policy. Deterministic and idempotent:
  // each obligation's late_fee_cents is SET (not added) from the tenant mode:
  //   per_day: days-overdue × per-day bounded by cap · fixed: flat amount · percent: % of amount.
  // ?dryRun=true returns the would-be updates without writing. Heads with applies_late_fee=false
  // are skipped; per-head overrides in fee_late_rules win over the tenant default when active.
  app.post('/fees/late-fees/run', { preHandler: require('owner', 'finance_head') }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const s = await feeSettings(c, req.user.tenant_id);
      const dryRun = req.query?.dryRun === 'true' || req.body?.dryRun === true;
      // Explicit off is off (dry-run still previews). Opt-in happens in PUT:
      // setting any rate without the flag auto-enables, so pre-flag tenants
      // that configured a rate keep working without a second step.
      if (s.late_fee_enabled === false && !dryRun) {
        return bad(reply, 'Late fees are not enabled — turn on late_fee_enabled and set a rate in fee settings first', 409);
      }
      const mode = ['per_day', 'fixed', 'percent'].includes(String(s.late_fee_mode)) ? String(s.late_fee_mode) : 'per_day';
      const perDay = Math.max(0, Math.trunc(Number(s.late_fee_per_day_cents) || 0));
      const fixed = Math.max(0, Math.trunc(Number(s.late_fee_fixed_cents) || 0));
      const pct = Math.min(100, Math.max(0, Number(s.late_fee_percent) || 0));
      if (mode === 'per_day' && perDay <= 0) return bad(reply, 'Late fees are not configured — set late_fee_per_day_cents in fee settings first', 409);
      if (mode === 'fixed' && fixed <= 0) return bad(reply, 'Late fees are not configured — set late_fee_fixed_cents in fee settings first', 409);
      if (mode === 'percent' && pct <= 0) return bad(reply, 'Late fees are not configured — set late_fee_percent in fee settings first', 409);
      const cap = Math.max(0, Math.trunc(Number(s.late_fee_cap_cents) || 0));
      const grace = Math.max(0, Math.trunc(Number(s.late_fee_grace_days) || 0));
      const feeExpr = mode === 'fixed'
        ? `LEAST(CASE WHEN $4 > 0 THEN $4 ELSE o.amount_cents END, $5)`
        : mode === 'percent'
          ? `LEAST(CASE WHEN $4 > 0 THEN $4 ELSE 9223372036854775807 END, (o.amount_cents * $5 / 100)::bigint)`
          : `LEAST(CASE WHEN $4 > 0 THEN $4 ELSE 9223372036854775807 END,
                     GREATEST(0, (('now' AT TIME ZONE 'Asia/Kolkata')::date - o.due_on) - $3) * $2)`;
      const calcParams = mode === 'fixed'
        ? [req.user.tenant_id, 0, grace, cap, fixed]
        : mode === 'percent'
          ? [req.user.tenant_id, 0, grace, cap, pct]
          : [req.user.tenant_id, perDay, grace, cap];
      let rows = null;
      try {
        rows = (await c.query(
          `WITH calc AS (
             SELECT o.id, ${feeExpr} AS fee
               FROM app.fee_obligations o
               LEFT JOIN app.fee_heads h ON h.id = o.fee_head_id
              WHERE o.tenant_id=$1 AND o.status NOT IN ('paid','void') AND o.due_on IS NOT NULL
                AND o.due_on < ('now' AT TIME ZONE 'Asia/Kolkata')::date
                AND (h.id IS NULL OR h.applies_late_fee)
                AND (('now' AT TIME ZONE 'Asia/Kolkata')::date - o.due_on) > $3
           )
           SELECT calc.id, calc.fee FROM calc JOIN app.fee_obligations o ON o.id = calc.id
            WHERE o.late_fee_cents <> calc.fee LIMIT 500`, calcParams)).rows;
      } catch (e) {
        if (e.code !== '42703') throw e;
        // Pre-150 database without the per-head flag — legacy per-day behaviour.
        const legacyExpr = `LEAST(CASE WHEN $4 > 0 THEN $4 ELSE 9223372036854775807 END,
                           GREATEST(0, (('now' AT TIME ZONE 'Asia/Kolkata')::date - due_on) - $3) * $2)`;
        rows = (await c.query(
          `WITH calc AS (SELECT id, ${legacyExpr} AS fee FROM app.fee_obligations
            WHERE tenant_id=$1 AND status NOT IN ('paid','void') AND due_on IS NOT NULL
              AND due_on < ('now' AT TIME ZONE 'Asia/Kolkata')::date)
           SELECT calc.id, calc.fee FROM calc JOIN app.fee_obligations o ON o.id = calc.id
            WHERE o.late_fee_cents <> calc.fee LIMIT 500`, [req.user.tenant_id, perDay, grace, cap])).rows;
      }
      if (dryRun) return { dryRun: true, mode, wouldUpdate: rows.length, sample: rows.slice(0, 20) };
      let updated = 0;
      for (const r of rows) {
        const u = await c.query(`UPDATE app.fee_obligations SET late_fee_cents=$2 WHERE id=$1 AND tenant_id=$3 AND late_fee_cents <> $2`,
          [r.id, r.fee, req.user.tenant_id]);
        updated += u.rowCount;
      }
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Late fees applied', recordType: 'FeeSettings', recordRef: req.user.tenant_id, reason: `${mode} · grace ${grace}d · cap ${cap ? `₹${cap / 100}` : 'none'}`, policyRef: 'Fees §4.4', risk: 'medium', outcome: `${updated} obligation(s) updated` });
      return { updated, mode, perDayCents: perDay, fixedCents: fixed, percent: pct, graceDays: grace, capCents: cap };
    });
  });
  app.get('/fees/entitlements', { preHandler: roleGatedMe('owner','principal','itadmin','finance','finance_head','finance_clerk','coordinator') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const plan = (await c.query(`SELECT plan FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0]?.plan ?? 'trial';
      return { plan, features: feeEntitlements(plan) };
    });
  });

  // ============ fee heads (FEE-DAT-1b) ============
  // First-class charge categories, so a plan/obligation carries a head instead of a free-text label and a
  // report can group by head. Staff-configurable; the desk reads them for pickers.
  app.get('/fees/heads', { preHandler: roleGatedMe('owner','principal','itadmin','finance','finance_head','finance_clerk','coordinator') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const includeInactive = req.query?.includeInactive === 'true';
      const r = await c.query(
        `SELECT h.id, h.name, h.category, h.is_refundable, h.tax_code, h.gl_ledger_name, h.active, h.created_at,
                h.applies_late_fee, h.allows_installments, h.allows_concession, h.refund_window_days, h.sort_order,
                (SELECT count(*)::int FROM app.fee_obligations o WHERE o.fee_head_id = h.id) AS obligations
           FROM app.fee_heads h
          WHERE ($1 OR h.active)
          ORDER BY h.sort_order, h.active DESC, h.name`, [includeInactive]).catch(() => null);
      if (r) return { feeHeads: r.rows };
      const legacy = await c.query(
        `SELECT h.id, h.name, h.category, h.is_refundable, h.tax_code, h.gl_ledger_name, h.active, h.created_at,
                (SELECT count(*)::int FROM app.fee_obligations o WHERE o.fee_head_id = h.id) AS obligations
           FROM app.fee_heads h
          WHERE ($1 OR h.active)
          ORDER BY h.active DESC, h.name`, [includeInactive]);
      return { feeHeads: legacy.rows };
    });
  });

  app.post('/fees/heads', { preHandler: require('owner','principal','finance','finance_head') }, async (req, reply) => {
    const b = req.body ?? {};
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 80) return bad(reply, 'name is required (≤80 characters)');
    const category = typeof b.category === 'string' ? b.category.trim().slice(0, 60) || null : null;
    const taxCode = typeof b.taxCode === 'string' ? b.taxCode.trim().slice(0, 40) || null : null;
    const glLedgerName = typeof b.glLedgerName === 'string' ? b.glLedgerName.trim().slice(0, 120) || null : null;
    const isRefundable = b.isRefundable === undefined ? true : Boolean(b.isRefundable);
    const appliesLateFee = b.appliesLateFee === undefined ? true : Boolean(b.appliesLateFee);
    const allowsInstallments = b.allowsInstallments === undefined ? true : Boolean(b.allowsInstallments);
    const allowsConcession = b.allowsConcession === undefined ? true : Boolean(b.allowsConcession);
    let refundWindow = null;
    if (b.refundWindowDays !== undefined && b.refundWindowDays !== null && String(b.refundWindowDays).trim() !== '') {
      refundWindow = Number(b.refundWindowDays);
      if (!Number.isInteger(refundWindow) || refundWindow < 0 || refundWindow > 3650) return bad(reply, 'refundWindowDays must be 0..3650');
    }
    let sortOrder = 0;
    if (b.sortOrder !== undefined && b.sortOrder !== null && String(b.sortOrder).trim() !== '') {
      sortOrder = Number(b.sortOrder);
      if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) return bad(reply, 'sortOrder must be 0..9999');
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!(await feeFeatureGate(c, reply, req.user.tenant_id, 'fees.heads'))) return;
      try {
        let row = null;
        try {
          const r = await c.query(
            `INSERT INTO app.fee_heads (tenant_id, name, category, is_refundable, tax_code, gl_ledger_name, applies_late_fee, allows_installments, allows_concession, refund_window_days, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [req.user.tenant_id, name, category, isRefundable, taxCode, glLedgerName, appliesLateFee, allowsInstallments, allowsConcession, refundWindow, sortOrder]);
          row = r.rows[0];
        } catch (e) {
          if (e.code === '42703') {
            const r = await c.query(
              `INSERT INTO app.fee_heads (tenant_id, name, category, is_refundable, tax_code, gl_ledger_name)
               VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
              [req.user.tenant_id, name, category, isRefundable, taxCode, glLedgerName]);
            row = r.rows[0];
          } else throw e;
        }
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Created fee head', recordType: 'FeeHead', recordRef: name, reason: category ?? 'charge category', outcome: `created — refundable ${isRefundable} · late-fee ${appliesLateFee} · installments ${allowsInstallments}` });
        return { feeHead: row };
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'a fee head with this name already exists', 409);
        throw e;
      }
    });
  });

  // Tenant discount / scholarship catalogue (migration 150). Rules are tenant-owned; instances
  // stay in fee_concessions with the request→approve lifecycle. Auto-apply rules propose at
  // generation time (never write concession_cents directly).
  const DISCOUNT_KINDS = ['merit', 'need', 'ews', 'rte', 'sibling', 'staff', 'early_bird', 'other', 'concession', 'scholarship', 'waiver'];
  app.get('/fees/discount-rules', { preHandler: roleGatedMe('owner', 'principal', 'finance', 'finance_head', 'finance_clerk', 'coordinator') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT dr.*, h.name AS fee_head_name FROM app.fee_discount_rules dr LEFT JOIN app.fee_heads h ON h.id = dr.fee_head_id WHERE dr.tenant_id=$1 ORDER BY dr.priority, dr.name`,
        [req.user.tenant_id]).catch(() => ({ rows: [], missing: true }));
      if (r.missing) return { discountRules: [], unmigrated: true };
      return { discountRules: r.rows };
    });
  });
  app.post('/fees/discount-rules', { preHandler: require('owner', 'finance_head') }, async (req, reply) => {
    const b = req.body ?? {};
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 80) return bad(reply, 'name is required (≤80 characters)');
    if (!DISCOUNT_KINDS.includes(String(b.kind))) return bad(reply, `kind must be one of ${DISCOUNT_KINDS.join(', ')}`);
    if (!['percent', 'flat'].includes(String(b.valueType))) return bad(reply, 'valueType must be percent|flat');
    const val = Number(b.value);
    if (!Number.isFinite(val) || val < 0) return bad(reply, 'value must be ≥ 0');
    if (String(b.valueType) === 'percent' && val > 100) return bad(reply, 'percent value must be 0..100');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      try {
        const r = await c.query(
          `INSERT INTO app.fee_discount_rules (tenant_id, name, kind, value_type, value_numeric, max_per_student_cents, valid_from, valid_to, grades, fee_head_id, requires_approval, auto_apply, stackable, priority, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [req.user.tenant_id, name, String(b.kind), String(b.valueType), val,
            b.maxPerStudentCents != null ? Math.trunc(Number(b.maxPerStudentCents)) : null,
            b.validFrom ?? null, b.validTo ?? null,
            Array.isArray(b.grades) ? b.grades.filter((g) => typeof g === 'string') : [],
            b.feeHeadId ?? null,
            b.requiresApproval === undefined ? true : Boolean(b.requiresApproval),
            b.autoApply === undefined ? false : Boolean(b.autoApply),
            Boolean(b.stackable), Math.trunc(Number(b.priority) || 0),
            b.active === undefined ? true : Boolean(b.active)]);
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Created discount rule', recordType: 'FeeDiscountRule', recordRef: name, reason: String(b.kind), outcome: `${b.valueType} ${val}` });
        return { discountRule: r.rows[0] };
      } catch (e) {
        if (e.code === '42P01' || e.code === '42703') return bad(reply, 'discount rules are not migrated yet — apply migration 150 first', 409);
        if (e.code === '23505') return bad(reply, 'a discount rule with this name already exists', 409);
        throw e;
      }
    });
  });

  // Per-head late-fee overrides (migration 150). Null feeHeadId = tenant default (kept in fee_settings).
  app.get('/fees/late-rules', { preHandler: roleGatedMe('owner', 'principal', 'finance', 'finance_head', 'finance_clerk') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT lr.*, h.name AS fee_head_name FROM app.fee_late_rules lr LEFT JOIN app.fee_heads h ON h.id = lr.fee_head_id WHERE lr.tenant_id=$1 AND lr.active ORDER BY h.name NULLS FIRST`,
        [req.user.tenant_id]).catch(() => ({ rows: [], missing: true }));
      if (r.missing) return { lateRules: [], unmigrated: true };
      return { lateRules: r.rows };
    });
  });
  app.post('/fees/late-rules', { preHandler: require('owner', 'finance_head') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!['per_day', 'fixed', 'percent'].includes(String(b.mode ?? 'per_day'))) return bad(reply, 'mode must be per_day|fixed|percent');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      try {
        const r = await c.query(
          `INSERT INTO app.fee_late_rules (tenant_id, fee_head_id, mode, per_day_cents, fixed_cents, percent, cap_cents, grace_days, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING *`,
          [req.user.tenant_id, b.feeHeadId ?? null, String(b.mode ?? 'per_day'),
            Math.max(0, Math.trunc(Number(b.perDayCents) || 0)), Math.max(0, Math.trunc(Number(b.fixedCents) || 0)),
            Math.min(100, Math.max(0, Number(b.percent) || 0)), Math.max(0, Math.trunc(Number(b.capCents) || 0)),
            Math.max(0, Math.trunc(Number(b.graceDays) || 0))]);
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Created late-fee rule', recordType: 'FeeLateRule', recordRef: b.feeHeadId ?? 'default', reason: String(b.mode ?? 'per_day'), outcome: 'created' });
        return { lateRule: r.rows[0] };
      } catch (e) {
        if (e.code === '42P01' || e.code === '42703') return bad(reply, 'late-fee rules are not migrated yet — apply migration 150 first', 409);
        throw e;
      }
    });
  });

  // RTE-11: a `me`-only read exposed every tenant-wide fee-plan template to any role (parent/student
  // included), whose mutations are owner/finance-gated. Staff/admin gate.
  app.get('/fee-plans', { preHandler: roleGatedMe('owner','principal','finance','finance_head','finance_clerk','coordinator','itadmin') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT t.id, t.name, t.grades, t.terms, t.academic_year_id, t.fee_head_id, t.installments, t.auto_concession, t.hike_pct, t.consultation_meeting_id, t.created_at,
                h.name AS fee_head_name,
                (SELECT count(*)::int FROM app.fee_obligations o
                  WHERE o.source_ref = 'feeplan:' || t.id::text) AS obligations_generated,
                (SELECT max(o.created_at) FROM app.fee_obligations o
                  WHERE o.source_ref = 'feeplan:' || t.id::text) AS last_generated_at
         FROM app.fee_plan_templates t
         LEFT JOIN app.fee_heads h ON h.id = t.fee_head_id
         ORDER BY t.created_at DESC`);
      return { feePlans: r.rows };
    });
  });

  // FEE-DAT-5b: an installment schedule is an ordered list of parts. `amount_cents` is optional — an omitted
  // part is split evenly from the obligation's net, with the remainder on the last part (integer paise, never
  // floats). `due_on` is optional; when absent the term's due date is used.
  const validateInstallments = (installments) => {
    if (installments == null) return null;
    if (!Array.isArray(installments) || installments.length === 0 || installments.length > 24) return 'installments must be a non-empty list (≤24 parts)';
    for (const p of installments) {
      if (!p || typeof p !== 'object') return 'each installment must be an object';
      // Positive-only: app.fee_installments carries CHECK (amount_cents > 0), so a zero
      // part that passed validation used to 500 at generation. Reject it here with a 400.
      if (p.amount_cents !== undefined && (!Number.isInteger(p.amount_cents) || p.amount_cents < 1)) return 'each installment amount_cents must be a positive integer (paise ≥ 1)';
      if (p.percent !== undefined && (!Number.isFinite(Number(p.percent)) || Number(p.percent) <= 0 || Number(p.percent) > 100)) return 'each installment percent must be > 0 and ≤ 100';
      if (p.amount_cents !== undefined && p.percent !== undefined) return 'each installment takes amount_cents or percent, not both';
      if (p.due_on !== undefined && (typeof p.due_on !== 'string' || !DATE_RE.test(p.due_on))) return 'installment due_on must be a YYYY-MM-DD date';
    }
    return null;
  };
  // D3: the auto-concession rule applied at generation. `sibling` = a student who shares a guardian phone
  // with another active student gets `percent` off each generated obligation.
  const validateAutoConcession = (ac) => {
    if (ac == null) return null;
    if (typeof ac !== 'object' || Array.isArray(ac)) return 'autoConcession must be an object';
    if (ac.kind !== 'sibling') return 'autoConcession.kind must be sibling';
    if (!Number.isFinite(Number(ac.percent)) || Number(ac.percent) < 0 || Number(ac.percent) > 100) return 'autoConcession.percent must be 0..100';
    if (ac.min_children !== undefined && (!Number.isInteger(ac.min_children) || ac.min_children < 2 || ac.min_children > 10)) return 'autoConcession.min_children must be 2..10';
    return null;
  };

  app.post('/fee-plans', { preHandler: require('owner', 'principal', 'finance', 'finance_head', 'finance_clerk') }, async (req, reply) => {
    const b = req.body ?? {};
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const grades = Array.isArray(b.grades) ? b.grades.filter((g) => typeof g === 'string' && g.trim()) : null;
    if (!name || name.length > 80) return bad(reply, 'name is required (≤80 characters)');
    if (!grades || grades.length === 0 || grades.length > 40) return bad(reply, 'grades must be a non-empty list of grade names');
    const termsErr = validateTerms(b.terms);
    if (termsErr) return bad(reply, termsErr);
    const instErr = validateInstallments(b.installments);
    if (instErr) return bad(reply, instErr);
    const acErr = validateAutoConcession(b.autoConcession);
    if (acErr) return bad(reply, acErr);
    /* Fee-hike governance (Action Plan 4.2): a rise above 10% must cite the SMC consultation
       that approved it (kind SMC, held within 180 days). The meeting id is validated now so a
       hike can never be recorded on hearsay; ≤10% passes without paper. */
    let hikePct = null;
    let consultId = null;
    if (b.hikePct !== undefined && b.hikePct !== null && String(b.hikePct).trim() !== '') {
      hikePct = Number(b.hikePct);
      if (!Number.isFinite(hikePct) || hikePct < 0 || hikePct > 100) return bad(reply, 'hikePct must be 0–100');
    }
    if (b.consultationMeetingId !== undefined && b.consultationMeetingId !== null && String(b.consultationMeetingId).trim() !== '') {
      if (!UUID_RE_NOTICE.test(String(b.consultationMeetingId))) return bad(reply, 'consultationMeetingId must be a uuid');
      consultId = String(b.consultationMeetingId);
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (b.feeHeadId && !(await feeFeatureGate(c, reply, req.user.tenant_id, 'fees.heads'))) return;
      if (b.installments && !(await feeFeatureGate(c, reply, req.user.tenant_id, 'fees.installments'))) return;
      const _pol = await feeSettings(c, req.user.tenant_id).catch(() => ({}));
      const hikeThreshold = Number.isFinite(Number(_pol.hike_review_threshold_pct)) ? Number(_pol.hike_review_threshold_pct) : 10;
      const hikeMaxAge = Math.max(1, Math.trunc(Number(_pol.hike_evidence_max_age_days) || 180));
      try {
        if (b.academicYearId) {
          const ay = await c.query(`SELECT 1 FROM app.academic_years WHERE id=$1`, [b.academicYearId]);
          if (!ay.rows[0]) return bad(reply, 'academicYearId does not reference this school\'s calendar', 400);
        }
        if (b.feeHeadId) {
          const head = (await c.query(`SELECT 1 FROM app.fee_heads WHERE id=$1 AND active`, [b.feeHeadId])).rows[0];
          if (!head) return bad(reply, 'feeHeadId does not reference an active fee head in this school', 400);
        }
        if (hikePct !== null && hikePct > hikeThreshold) {
          const mtg = consultId ? (await c.query(
            `SELECT held_on FROM app.mtgs WHERE id=$1 AND kind='SMC'`, [consultId])).rows[0] : null;
          if (!mtg) return bad(reply, `A rise above ${hikeThreshold}% needs its SMC consultation — record the meeting first, then cite it here`, 400);
          if (new Date(mtg.held_on).getTime() < Date.now() - hikeMaxAge * 864e5) {
            return bad(reply, `That SMC consultation is older than ${hikeMaxAge} days — fresh consultations back fresh hikes`, 400);
          }
        }
        const r = await c.query(
          `INSERT INTO app.fee_plan_templates (tenant_id, name, grades, terms, academic_year_id, fee_head_id, installments, auto_concession, hike_pct, consultation_meeting_id)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8::jsonb,$9,$10) RETURNING id, name, grades, terms, academic_year_id, fee_head_id, installments, auto_concession, hike_pct, consultation_meeting_id`,
           [req.user.tenant_id, name, grades, JSON.stringify(b.terms), b.academicYearId ?? null, b.feeHeadId ?? null, b.installments ? JSON.stringify(b.installments) : null, b.autoConcession ? JSON.stringify(b.autoConcession) : null, hikePct, consultId]);
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Created fee plan template', recordType: 'FeePlan', recordRef: name, reason: `grades: ${grades.join(', ')}${b.feeHeadId ? ` · head ${b.feeHeadId}` : ''}${hikePct !== null ? ` · hike ${hikePct}%` : ''}`, outcome: `created — ${b.terms.length} terms${b.installments ? ` · ${b.installments.length} installments` : ''}${hikePct !== null && hikePct > 10 ? ' · SMC consultation cited' : ''}` });
        return { feePlan: r.rows[0] };
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'a fee plan with this name already exists', 409);
        throw e;
      }
    });
  });

  app.post('/fee-plans/:id/generate', { preHandler: [require('owner', 'principal', 'finance', 'finance_head', 'finance_clerk'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const tpl = (await c.query(`SELECT id, name, grades, terms, academic_year_id, fee_head_id, installments, auto_concession FROM app.fee_plan_templates WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!tpl) return bad(reply, 'fee plan not found', 404);
      if (Array.isArray(tpl.installments) && tpl.installments.length > 0
        && !(await feeFeatureGate(c, reply, req.user.tenant_id, 'fees.installments'))) return;
      const scope = (await c.query(`SELECT count(*)::int n FROM app.students WHERE status='active' AND grade = ANY($1)`, [tpl.grades])).rows[0].n;
      // A billing run groups every obligation this generation produces, so a whole run can be reasoned
      // about (and, later, voided) as one unit.
      const run = (await c.query(
        `INSERT INTO app.billing_runs (tenant_id, plan_template_id, created_by, note) VALUES ($1,$2,$3,$4) RETURNING id`,
        [req.user.tenant_id, tpl.id, req.user.id, `generated from ${tpl.name}`])).rows[0];
      // FEE-DAT-1b: the head rides the obligation so reports can group by head, not free-text label.
      const ins = await c.query(
        `INSERT INTO app.fee_obligations (tenant_id, student_id, term, label, due_on, amount_cents, academic_year_id, source_ref, billing_run_id, fee_head_id)
         SELECT $1, s.id, te->>'term', te->>'label', NULLIF(te->>'due_on','')::date, (te->>'amount_cents')::bigint, $2, 'feeplan:' || $3, $6, $7
         FROM app.students s CROSS JOIN jsonb_array_elements($4::jsonb) te
         WHERE s.status='active' AND s.grade = ANY($5)
         ON CONFLICT (tenant_id, student_id, term, label) DO NOTHING
         RETURNING id, amount_cents`,
        [req.user.tenant_id, tpl.academic_year_id, tpl.id, JSON.stringify(tpl.terms), tpl.grades, run.id, tpl.fee_head_id ?? null]);
      const inserted = ins.rowCount;
      // FEE-DAT-5b: split each generated obligation into its installment schedule, in order. Regeneration
      // never touches existing rows (ON CONFLICT DO NOTHING), so a paid installment is never re-created.
      let installmentsCreated = 0;
      if (Array.isArray(tpl.installments) && tpl.installments.length > 0) {
        for (const ob of ins.rows) {
          const split = splitInstallments(tpl.installments, ob.amount_cents);
          if (split.error) continue;
          for (let i = 0; i < tpl.installments.length; i++) {
            const due = tpl.installments[i]?.due_on ?? null;
            const r = await c.query(
              `INSERT INTO app.fee_installments (tenant_id, obligation_id, seq, due_on, amount_cents)
               VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, obligation_id, seq) DO NOTHING`,
              [req.user.tenant_id, ob.id, i + 1, due, split.amounts[i].toString()]);
            installmentsCreated += r.rowCount;
          }
        }
      }
      // D3: apply the plan's auto-concession rule (design §6.1) to the obligations this run produced.
      // `sibling` = a student sharing a guardian phone with another active student. `concession_cents = 0`
      // guards against re-applying; net_amount_cents is a generated column, so the ledger reflects it.
      let autoConcessions = 0;
      const ac = tpl.auto_concession;
      if (ac && ac.kind === 'sibling' && Number(ac.percent) > 0) {
        const minC = Number.isInteger(ac.min_children) ? ac.min_children : 2;
        const upd = await c.query(
          `UPDATE app.fee_obligations o
              SET concession_cents = round(o.amount_cents * $3 / 100.0)::bigint
             FROM app.students s
            WHERE o.student_id = s.id AND o.billing_run_id=$1 AND o.tenant_id=$2
              AND o.concession_cents = 0
              AND (SELECT count(DISTINCT g2.student_id) FROM app.guardians g2
                    WHERE g2.tenant_id=$2 AND g2.phone IS NOT NULL
                      AND g2.phone = (SELECT g1.phone FROM app.guardians g1
                                       WHERE g1.student_id = s.id AND g1.tenant_id=$2 AND g1.phone IS NOT NULL LIMIT 1)) >= $4`,
          [run.id, req.user.tenant_id, Number(ac.percent), minC]);
        autoConcessions = upd.rowCount;
      }
      const attempted = scope * (Array.isArray(tpl.terms) ? tpl.terms.length : 0);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Generated fee obligations', recordType: 'FeePlan', recordRef: tpl.name, reason: `${scope} active students × ${tpl.terms.length} terms`, outcome: `${inserted} created · ${attempted - inserted} skipped (already exist — payments untouched) · ${installmentsCreated} installments · ${autoConcessions} auto-concessions · run ${run.id}` });
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `Fee plan ${tpl.name} generated — ${inserted} obligations created for ${scope} students`, ref: run.id });
      return { inserted, skipped: attempted - inserted, students: scope, terms: Array.isArray(tpl.terms) ? tpl.terms.length : 0, installmentsCreated, autoConcessions, billingRunId: run.id };
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

  // Tenant-configurable due dates: extend an obligation's due date within the tenant's
  // max_extension_days. Paid/void rows are refused; the extension is audited with a reason.
  app.post('/fees/obligations/:id/extend', { preHandler: [require('owner', 'finance_head', 'principal'), uuidParams('id')] }, async (req, reply) => {
    const dueOn = String(req.body?.due_on ?? '');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    if (!DATE_RE.test(dueOn)) return bad(reply, 'due_on must be a YYYY-MM-DD date');
    if (!reason) return bad(reply, 'a reason is required to extend a due date');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const s = await feeSettings(c, req.user.tenant_id);
      const maxExt = Math.max(0, Math.trunc(Number(s.max_extension_days ?? 30)));
      const o = (await c.query(`SELECT id, label, due_on, status FROM app.fee_obligations WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!o) return bad(reply, 'obligation not found', 404);
      if (o.status === 'void' || o.status === 'paid') return bad(reply, `a ${o.status} obligation cannot be extended`, 409);
      if (o.due_on) {
        const delta = Math.round((new Date(dueOn).getTime() - new Date(o.due_on).getTime()) / 864e5);
        if (delta < 0) return bad(reply, 'extensions move the due date forward, never backward');
        if (delta > maxExt) return bad(reply, `this school allows extensions up to ${maxExt} days`);
      }
      const r = await c.query(`UPDATE app.fee_obligations SET due_on=$2 WHERE id=$1 RETURNING id, label, due_on`, [o.id, dueOn]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Extended fee due date', recordType: 'FeeObligation', recordRef: o.label, reason, outcome: `due ${o.due_on ?? '—'} → ${dueOn}` });
      return { obligation: r.rows[0] };
    });
  });

  // Tenant-configurable late-fee waiver: zero an obligation's late fee with a reason (audited).
  app.post('/fees/obligations/:id/late-fee/waive', { preHandler: [require('owner', 'finance_head'), uuidParams('id')] }, async (req, reply) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    if (!reason) return bad(reply, 'a reason is required to waive a late fee');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const o = (await c.query(`SELECT id, label, late_fee_cents FROM app.fee_obligations WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!o) return bad(reply, 'obligation not found', 404);
      if (BigInt(o.late_fee_cents ?? 0) <= 0n) return { obligation: o, already: true };
      const r = await c.query(`UPDATE app.fee_obligations SET late_fee_cents=0 WHERE id=$1 RETURNING *`, [o.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Waived late fee', recordType: 'FeeObligation', recordRef: o.label, reason, outcome: `late_fee ${o.late_fee_cents} → 0` });
      return { obligation: r.rows[0] };
    });
  });

  // Tenant-configurable installments: edit a pending part's date/amount (rebalancing is the
  // caller's job — the door refuses to touch paid/overdue-settled parts), or waive it.
  app.patch('/fees/installments/:id', { preHandler: [require('owner', 'finance_head'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const s = await feeSettings(c, req.user.tenant_id);
      if (s.installment_allow_edit === false) return bad(reply, 'installment editing is disabled for this school', 403);
      const row = (await c.query(`SELECT * FROM app.fee_installments WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!row) return bad(reply, 'installment not found', 404);
      if (row.status !== 'pending') return bad(reply, `only pending installments can be edited (this one is ${row.status})`, 409);
      const patch = [];
      const vals = [req.user.tenant_id, row.id];
      if (req.body?.due_on !== undefined) {
        if (!DATE_RE.test(String(req.body.due_on))) return bad(reply, 'due_on must be a YYYY-MM-DD date');
        patch.push(`due_on=$${vals.length + 1}`);
        vals.push(String(req.body.due_on));
      }
      if (req.body?.amount_cents !== undefined) {
        if (!Number.isInteger(req.body.amount_cents) || req.body.amount_cents <= 0) return bad(reply, 'amount_cents must be a positive integer (paise)');
        patch.push(`amount_cents=$${vals.length + 1}`);
        vals.push(String(req.body.amount_cents));
      }
      if (!patch.length) return bad(reply, 'nothing to update — pass due_on and/or amount_cents');
      patch.push(`updated_at=now()`);
      const r = await c.query(`UPDATE app.fee_installments SET ${patch.join(', ')} WHERE tenant_id=$1 AND id=$2 RETURNING *`, vals);
      try { await c.query(`UPDATE app.fee_installments SET updated_by=$3 WHERE tenant_id=$1 AND id=$2`, [req.user.tenant_id, row.id, req.user.id]); } catch { /* pre-150 */ }
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Edited installment', recordType: 'FeeInstallment', recordRef: `${row.obligation_id}#${row.seq}`, reason: String(req.body?.reason ?? 'tenant edit'), outcome: patch.join(', ') });
      return { installment: r.rows[0] };
    });
  });
  app.post('/fees/installments/:id/waive', { preHandler: [require('owner', 'finance_head'), uuidParams('id')] }, async (req, reply) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    if (!reason) return bad(reply, 'a reason is required to waive an installment');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const row = (await c.query(`SELECT * FROM app.fee_installments WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!row) return bad(reply, 'installment not found', 404);
      if (row.status === 'paid') return bad(reply, 'a paid installment cannot be waived', 409);
      const r = await c.query(`UPDATE app.fee_installments SET status='waived' WHERE tenant_id=$1 AND id=$2 RETURNING *`, [req.user.tenant_id, row.id]);
      try { await c.query(`UPDATE app.fee_installments SET waived_reason=$3, updated_at=now(), updated_by=$4 WHERE tenant_id=$1 AND id=$2`, [req.user.tenant_id, row.id, reason, req.user.id]); } catch { /* pre-150 */ }
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Waived installment', recordType: 'FeeInstallment', recordRef: `${row.obligation_id}#${row.seq}`, reason, outcome: 'status=waived' });
      return { installment: r.rows[0] };
    });
  });

  // Plan preview (dry-run generation) + clone for year rollover. Preview never writes.
  app.post('/fee-plans/:id/preview', { preHandler: [require('owner', 'principal', 'finance', 'finance_head', 'finance_clerk'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const tpl = (await c.query(`SELECT id, name, grades, terms, installments, auto_concession FROM app.fee_plan_templates WHERE id=$1`, [req.params.id])).rows[0];
      if (!tpl) return bad(reply, 'fee plan not found', 404);
      const terms = Array.isArray(tpl.terms) ? tpl.terms : [];
      const students = (await c.query(`SELECT id, name, grade FROM app.students WHERE status='active' AND grade = ANY($1) LIMIT 500`, [tpl.grades])).rows;
      const sample = students.slice(0, 10).map((st) => ({
        studentId: st.id, studentName: st.name, grade: st.grade,
        obligations: terms.map((t) => ({ term: t.term, label: t.label, amount_cents: t.amount_cents, due_on: t.due_on ?? null })),
      }));
      return { plan: tpl.name, studentsInScope: students.length, sample, installments: tpl.installments ?? null, autoConcession: tpl.auto_concession ?? null, writes: false };
    });
  });
  app.post('/fee-plans/:id/clone', { preHandler: [require('owner', 'finance_head'), uuidParams('id')] }, async (req, reply) => {
    const b = req.body ?? {};
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 80) return bad(reply, 'name is required for the clone (≤80 characters)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const tpl = (await c.query(`SELECT name, grades, terms, academic_year_id, fee_head_id, installments, auto_concession FROM app.fee_plan_templates WHERE id=$1`, [req.params.id])).rows[0];
      if (!tpl) return bad(reply, 'fee plan not found', 404);
      try {
        const r = await c.query(
          `INSERT INTO app.fee_plan_templates (tenant_id, name, grades, terms, academic_year_id, fee_head_id, installments, auto_concession)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8::jsonb) RETURNING id, name`,
          [req.user.tenant_id, name, tpl.grades, JSON.stringify(tpl.terms), b.academicYearId ?? tpl.academic_year_id, tpl.fee_head_id, tpl.installments ? JSON.stringify(tpl.installments) : null, tpl.auto_concession ? JSON.stringify(tpl.auto_concession) : null]);
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Cloned fee plan', recordType: 'FeePlan', recordRef: name, reason: `cloned from ${tpl.name}`, outcome: `created ${r.rows[0].id}` });
        return { feePlan: r.rows[0], clonedFrom: req.params.id };
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'a fee plan with this name already exists', 409);
        throw e;
      }
    });
  });

  // ============ fees & payments ============
  // SEC-5: roles that legitimately work the school-wide fee ledger. Narrower than
  // STAFF_CASE_ROLES on purpose (no teacher, no admissions) — this is financial data about
  // children, and neither role has a fee mandate in the shipped product.
  const FEE_LEDGER_ROLES = new Set(['owner', 'principal', 'itadmin', 'finance', 'finance_head', 'finance_clerk', 'coordinator']);
  // FEES-109: the finance split. `finance` is the legacy broad role (grandfathered as head-equivalent);
  // `finance_clerk` is maker-only, `finance_head` is checker. A refund at/above the threshold may not be
  // executed by a pure maker, and never by the same user who settled the payment (unless owner).
  const FEE_MAKER_ROLES = ['finance', 'finance_head', 'finance_clerk', 'owner', 'principal'];
  const FEE_REFUND_ROLES = ['finance', 'finance_head', 'finance_clerk', 'owner'];
  // FEE-SEC-9 / FEE-DAT-8: fee policy is per-tenant, not a constant. `app.fee_settings` holds the overrides;
  // the defaults below preserve the pre-110 behaviour for a tenant that has never configured anything.
  const REFUND_APPROVAL_THRESHOLD_CENTS = 500000; // ₹5,000 — the default until a tenant sets its own
  const FEE_SETTING_DEFAULTS = Object.freeze({
    refund_approval_threshold_cents: REFUND_APPROVAL_THRESHOLD_CENTS,
    reconciliation_tolerance_cents: 0,
    // A7: `auto_settle_verified_capture` was a dead flag — settlement is staff-only by design
    // (Fees §4.2: the rail never moves money), so a verified capture does not auto-settle. Removed
    // rather than left as a setting that reads as implemented. `settled_via='auto'` stays reserved
    // in the CHECK but is never written.
    allow_parent_partial: true,
    min_partial_cents: 10000,
    receipt_prefix: 'RCP',
    receipt_series_start: 1,
    receipt_reset: 'never',
    // D2 · late fees: per-day paise applied to overdue obligations, with an optional cap and grace.
    // per_day_cents = 0 means late fees are off. `late_fee_enabled=false` keeps the run door
    // refusing with 409 until the tenant opts in; mode fixed|percent are tenant alternatives.
    late_fee_enabled: false,
    late_fee_mode: 'per_day',
    late_fee_per_day_cents: 0,
    late_fee_fixed_cents: 0,
    late_fee_percent: 0,
    late_fee_cap_cents: 0,
    late_fee_grace_days: 0,
    late_fee_auto_run: false,
    // Refunds: window + deduction + partial policy. Defaults preserve pre-change behaviour
    // (no window, no deduction, partial allowed, reason required only above threshold).
    refund_window_days: 0,
    refund_deduction_pct: 0,
    refund_require_reason: false,
    refund_partial_allowed: true,
    refund_auto_gateway: false,
    // Payments: tenant-enabled rails + overpayment rule. Defaults = all rails on, overpay refused
    // (the previous `amountCents > totalDue → 400` behaviour).
    enabled_methods: ['upi', 'razorpay', 'cash', 'card', 'cheque', 'netbanking', 'bank_transfer', 'manual'],
    overpayment_rule: 'refuse',
    cash_requires_pin: true,
    invoice_notes: '',
    invoice_show_breakup: true,
    // Installments: mode + edit policy. Defaults preserve equal-split remainder-last generation.
    installment_mode: 'equal',
    installment_max_parts: 12,
    installment_allow_edit: true,
    installment_rounding: 'remainder_last',
    // Dunning ladder: tenant-owned offsets + quiet hours (fee settings win; plugin settings are fallback).
    dunning_enabled: true,
    dunning_before_due_days: [],
    dunning_escalation_days: [],
    dunning_quiet_start: '21:00',
    dunning_quiet_end: '08:00',
    dunning_channels: ['whatsapp'],
    dunning_stop_on_partial: false,
    // Concessions / scholarships.
    concession_stacking: 'single_best',
    concession_cap_pct: 100,
    sibling_min_children: 2,
    staff_default_pct: 0,
    allow_owner_self_approve: true,
    // Governance knobs.
    hike_review_threshold_pct: 10,
    hike_evidence_max_age_days: 180,
    default_due_time_ist: '23:59',
    max_extension_days: 30,
    settlement_slo_hours: 24,
    reconciliation_auto_match: true,
  });
  const feeSettings = async (c, tenantId) => {
    const row = (await c.query(`SELECT settings FROM app.fee_settings WHERE tenant_id=$1`, [tenantId])).rows[0];
    return { ...FEE_SETTING_DEFAULTS, ...(row?.settings ?? {}) };
  };
  // FEE-COM-1: the tenant's plan gates the fee feature matrix. Returns false and sends 402 when the feature
  // is not entitled; callers `if (!(await feeFeatureGate(...))) return;`.
  const feeFeatureGate = async (c, reply, tenantId, feature) => {
    const plan = (await c.query(`SELECT plan FROM app.tenants WHERE id=$1`, [tenantId])).rows[0]?.plan ?? 'trial';
    if (feeFeatureIncluded(plan, feature)) return true;
    reply.code(402).send(feeNotEntitled(feature, plan));
    return false;
  };
  // Append-only money trail (migration 109). Best-effort: a failure here must never roll back the ledger,
  // so callers wrap it; the audit ledger remains the authoritative hash-chained record.
  const recordPaymentEvent = async (c, tenantId, { paymentId, kind, actor, actorRole, source, amountCents, payload }) => {
    try {
      await c.query(
        `INSERT INTO app.payment_events (tenant_id, payment_id, kind, actor, actor_role, source, amount_cents, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [tenantId, paymentId, kind, actor ?? null, actorRole ?? null, source ?? null,
         amountCents != null ? String(amountCents) : null, JSON.stringify(payload ?? {})]);
    } catch { /* never fail the money path on the event trail */ }
  };
  // Receipt recipients: the primary guardian phones for a student (family.child_link -> users), falling back
  // to the denormalised app.students.guardian_phone. Used to make FEE_RECEIPT deliverable (FEE-DEL-1).
  const guardianPhones = async (c, tenantId, studentId) => {
    const linked = (await c.query(
      `SELECT u.phone FROM family.child_link cl JOIN app.users u ON u.id = cl.user_id
        WHERE cl.student_id=$1 AND u.phone IS NOT NULL`, [studentId])).rows.map((r) => r.phone).filter(Boolean);
    if (linked.length) return [...new Set(linked)];
    const fallback = (await c.query(`SELECT guardian_phone AS phone FROM app.students WHERE id=$1 AND tenant_id=$2`, [studentId, tenantId])).rows[0]?.phone;
    return fallback ? [fallback] : [];
  };
  app.get('/fees/obligations', { preHandler: roleGatedMe('owner','principal','itadmin','finance','finance_head','finance_clerk','coordinator','parent','student') }, async (req, reply) => {
    const { studentId, status } = req.query;
    if (studentId != null && !UUID_RE_NOTICE.test(String(studentId))) return bad(reply, 'studentId must be a uuid');
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 500 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // RT-7cyc8 P1-9: guardians are structurally scoped to their own children
      // (family.child_link) — a parent-supplied studentId for another child is refused.
      let scope = studentId ?? null;
      // FEE-PRD-9: a student is structurally scoped to their OWN record via app.student_accounts (108). The
      // link is the identity; a missing link yields an empty, honest self-view rather than the school ledger.
      if (req.user.role === 'student') {
        const link = (await c.query(`SELECT student_id FROM app.student_accounts WHERE user_id=$1`, [req.user.id])).rows[0];
        const mine = link ? [link.student_id] : [];
        if (scope && !mine.includes(scope)) return { obligations: [], scoped: 'self' };
        const r2 = await c.query(
          `SELECT o.*, s.name AS student_name, s.grade, s.section
           FROM app.fee_obligations o JOIN app.students s ON s.id = o.student_id
           WHERE o.student_id = ANY($1::uuid[]) AND ($2::text IS NULL OR o.status=$2)
           ORDER BY o.due_on NULLS LAST LIMIT $3 OFFSET $4`, [mine, status ?? null, limit, offset]);
        return { obligations: r2.rows, scoped: 'self', limit, offset, hasMore: r2.rows.length === limit };
      }
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
      // SEC-5: the fallback below was reached by EVERY role that is not a parent, so a student account
      // received up to 500 obligations for the entire school. Students are now handled by the
      // `app.student_accounts` branch above (FEE-PRD-9); this fallback is staff-only.
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

  // D7: the documented single-obligation read (FEES-DESIGN §5) — with its payments, installments and
  // concessions. Scoped exactly like the list door (parents/students to their own rows).
  app.get('/fees/obligations/:id', { preHandler: [roleGatedMe('owner','principal','itadmin','finance','finance_head','finance_clerk','coordinator','parent','student'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const o = (await c.query(
        `SELECT o.*, s.name AS student_name, s.grade, s.section
           FROM app.fee_obligations o JOIN app.students s ON s.id = o.student_id
          WHERE o.id=$1 AND o.tenant_id=$2`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!o) return bad(reply, 'not found', 404);
      if (req.user.role === 'parent') {
        const own = (await c.query(`SELECT 1 FROM family.child_link WHERE tenant_id=$1 AND user_id=$2 AND student_id=$3`,
          [req.user.tenant_id, req.user.id, o.student_id]).catch(() => ({ rows: [] }))).rows[0];
        if (!own) return bad(reply, 'This fee is not for your child', 403);
      }
      if (req.user.role === 'student') {
        const link = (await c.query(`SELECT student_id FROM app.student_accounts WHERE tenant_id=$1 AND user_id=$2`, [req.user.tenant_id, req.user.id])).rows[0];
        if (!link || link.student_id !== o.student_id) return bad(reply, 'This fee is not yours', 403);
      }
      const payments = (await c.query(
        `SELECT id, amount_cents, method, status, gateway_ref, settled_via, receipt_no, created_at
           FROM app.payments WHERE tenant_id=$1 AND obligation_id=$2 ORDER BY created_at DESC`, [req.user.tenant_id, o.id])).rows;
      const installments = (await c.query(
        `SELECT id, seq, due_on, amount_cents, status, payment_id FROM app.fee_installments
          WHERE tenant_id=$1 AND obligation_id=$2 ORDER BY seq`, [req.user.tenant_id, o.id])).rows;
      return { obligation: o, payments, installments };
    });
  });

  // D1 · the invoice document. Renders a deterministic invoice into the private file store on first
  // request and returns the same artifact thereafter (idempotent). Parents scoped to their child.
  app.get('/fees/obligations/:id/invoice', { preHandler: [roleGatedMe('owner','principal','itadmin','finance','finance_head','finance_clerk','coordinator','parent'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const o = (await c.query(
        `SELECT o.*, s.name AS student_name, s.grade, s.section FROM app.fee_obligations o
           JOIN app.students s ON s.id=o.student_id WHERE o.id=$1 AND o.tenant_id=$2`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!o) return bad(reply, 'not found', 404);
      if (req.user.role === 'parent') {
        const own = (await c.query(`SELECT 1 FROM family.child_link WHERE tenant_id=$1 AND user_id=$2 AND student_id=$3`,
          [req.user.tenant_id, req.user.id, o.student_id]).catch(() => ({ rows: [] }))).rows[0];
        if (!own) return bad(reply, 'This invoice is not for your child', 403);
      }
      if (o.invoice_file_id) {
        const f = (await c.query(`SELECT id, filename, sha256 FROM app.files WHERE id=$1 AND tenant_id=$2`, [o.invoice_file_id, req.user.tenant_id])).rows[0];
        if (f) return { invoice: { fileId: f.id, filename: f.filename, sha256: f.sha256 }, cached: true };
      }
      const school = (await c.query(`SELECT name FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0]?.name ?? 'SchoolOS';
      const money = (v) => (Number(v ?? 0) / 100).toFixed(2);
      const _iset = await feeSettings(c, req.user.tenant_id).catch(() => ({}));
      const lines = [
        `INVOICE — ${school}`,
        `Student: ${o.student_name} (${o.grade}-${o.section})`,
        `Term: ${o.term ?? '—'} · ${o.label}`,
        `Amount: ${money(o.amount_cents)}`,
        `Concession: ${money(o.concession_cents)}`,
        `Waived: ${money(o.waived_cents)}`,
        `Late fee: ${money(o.late_fee_cents)}`,
        `Net payable: ${money(o.net_amount_cents)}`,
        `Paid: ${money(o.paid_cents)}`,
        `Due: ${o.due_on ?? '—'}`,
        `Status: ${o.status}`,
      ];
      if (_iset.invoice_notes) lines.push(`Note: ${_iset.invoice_notes}`);
      const file = await putFile(c, req.user.tenant_id, req.user.id, {
        filename: `invoice-${o.id}.txt`, mime: 'text/plain', buf: Buffer.from(lines.join('\n'), 'utf8'), scope: 'student', refId: o.student_id });
      await c.query(`UPDATE app.fee_obligations SET invoice_file_id=$2 WHERE id=$1`, [o.id, file.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Invoice rendered', recordType: 'FeeObligation', recordRef: o.id, reason: 'invoice document', policyRef: 'Fees §5', risk: 'low', outcome: `artifact ${file.id}` });
      return { invoice: { fileId: file.id, filename: file.filename, sha256: file.sha256 }, cached: false };
    });
  });

  // ============ student own-dues (FEE-PRD-9) ============
  // A student's read-only money view, scoped structurally through app.student_accounts (108). No payments
  // can be initiated here; the student sees dues, payments and receipts for their own record only.
  app.get('/student/fees', { preHandler: roleGatedMe('student') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const link = (await c.query(`SELECT student_id FROM app.student_accounts WHERE tenant_id=$1 AND user_id=$2`, [req.user.tenant_id, req.user.id])).rows[0];
      if (!link) return { linked: false, studentId: null, obligations: [], payments: [], receipts: [], outstandingCents: 0 };
      const sid = link.student_id;
      const obligations = (await c.query(
        `SELECT o.id, o.term, o.label, o.due_on, o.amount_cents, o.concession_cents, o.waived_cents, o.net_amount_cents,
                o.paid_cents, o.status
           FROM app.fee_obligations o WHERE o.student_id=$1 ORDER BY o.due_on NULLS LAST`, [sid])).rows;
      const payments = (await c.query(
        `SELECT p.id, p.amount_cents, p.refunded_cents, p.method, p.status, p.receipt_no, p.confirmed_at, p.created_at,
                p.settled_via, p.reconciliation_status
           FROM app.payments p WHERE p.student_id=$1 ORDER BY p.created_at DESC LIMIT 100`, [sid])).rows;
      const receipts = (await c.query(
        `SELECT id, receipt_no, payment_id, amount_cents, issued_at, voided_at, pdf_file_id
           FROM app.fee_receipts WHERE student_id=$1 ORDER BY issued_at DESC LIMIT 100`, [sid])).rows;
      const outstanding = obligations.reduce((a, o) => a + (o.status === 'void' ? 0 : Number(o.net_amount_cents) - Number(o.paid_cents)), 0);
      return { linked: true, studentId: sid, obligations, payments, receipts, outstandingCents: outstanding, scoped: 'self' };
    });
  });

  app.post('/fees/payments', { preHandler: require('parent','finance','finance_head','finance_clerk','owner','principal') }, async (req, reply) => {
    const b = req.body ?? {};
    // FEE-PRD-10: pay-many. `obligationIds` (or a single `obligationId`) opens ONE payment allocated across
    // several obligations. All obligations must belong to the same student, and the allocations sum ≤ amount.
    const ids = Array.isArray(b.obligationIds)
      ? [...new Set(b.obligationIds.filter((x) => typeof x === 'string'))]
      : (b.obligationId ? [b.obligationId] : []);
    if (!ids.length) return moneyError(reply, 'VALIDATION_FAILED', 'obligationId or obligationIds required');
    if (ids.length > 20) return moneyError(reply, 'VALIDATION_FAILED', 'at most 20 obligations may be settled by one payment');
    for (const id of ids) if (!UUID_RE_NOTICE.test(String(id))) return moneyError(reply, 'VALIDATION_FAILED', 'obligation ids must be uuids');
    const paymentMethod = String(b.method ?? 'upi').toLowerCase();
    if (!['upi', 'razorpay', 'cash', 'card', 'cheque', 'netbanking', 'bank_transfer', 'manual'].includes(paymentMethod)) {
      return moneyError(reply, 'VALIDATION_FAILED', 'unsupported payment method');
    }
    const idempotencyKey = String(req.headers['idempotency-key'] ?? '').trim();
    if (idempotencyKey && (idempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey))) {
      return moneyError(reply, 'VALIDATION_FAILED', 'Idempotency-Key must be 1-128 letters, numbers, dots, underscores, colons or hyphens');
    }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (ids.length > 1 && !(await feeFeatureGate(c, reply, req.user.tenant_id, 'fees.multi_obligation'))) return;
      // Tenant-configurable rails: a school can disable cash/cheque/etc. from its own policy.
      const _fs = await feeSettings(c, req.user.tenant_id);
      const _enabled = Array.isArray(_fs.enabled_methods) && _fs.enabled_methods.length ? _fs.enabled_methods : null;
      if (_enabled && !_enabled.includes(paymentMethod)) {
        return moneyError(reply, 'VALIDATION_FAILED', `this school does not accept ${paymentMethod} — enabled: ${_enabled.join(', ')}`);
      }
      if (idempotencyKey) {
        const prior = await c.query(
          `SELECT * FROM app.payments WHERE tenant_id=$1 AND idempotency_key=$2 LIMIT 1`,
          [req.user.tenant_id, idempotencyKey]);
        if (prior.rows[0]) return { payment: prior.rows[0], already: true };
      }
      /* Counter-PIN (143): cash at the desk is the borrowed-phone fraud vector — a staff member
         with an enrolled PIN must present it with every cash collection. No enrolled PIN means
         the old behavior (the office enrolls PINs progressively, nobody is locked out by default).
         Checked before any row is locked. */
      if (paymentMethod === 'cash') {
        const pin = (await c.query(`SELECT pin_hash FROM app.fee_pins WHERE user_id=$1`, [req.user.id])).rows[0];
        if (pin) {
          const given = String(b.pin ?? '');
          if (!/^[0-9]{4,6}$/.test(given) || !verifyPassword(given, pin.pin_hash)) {
            return moneyError(reply, 'FORBIDDEN', 'Counter PIN required — enter your 4–6 digit collection PIN');
          }
        }
      }
      // Lock in a stable id order so two concurrent pay-many calls cannot deadlock each other.
      const obs = [];
      for (const id of [...ids].sort()) {
        const row = (await c.query(`SELECT * FROM app.fee_obligations WHERE id=$1 AND status <> 'void' FOR UPDATE`, [id])).rows[0];
        if (!row) return moneyError(reply, 'NOT_FOUND', 'obligation not found');
        obs.push(row);
      }
      // T105b (§7.3 P1-3): a parent may start a payment ONLY on their own child's obligation(s) (structural
      // family.child_link binding, rename-proof). 404 keeps obligation existence private.
      if (req.user.role === 'parent') {
        for (const o of obs) {
          const own = await c.query(`SELECT 1 FROM family.child_link WHERE user_id=$1 AND student_id=$2`, [req.user.id, o.student_id]);
          if (!own.rows[0]) return moneyError(reply, 'NOT_FOUND', 'obligation not found');
        }
      }
      const studentIds = new Set(obs.map((o) => o.student_id));
      if (studentIds.size > 1) return moneyError(reply, 'VALIDATION_FAILED', 'all obligations must belong to the same student');
      const studentId = obs[0].student_id;
      // net_amount_cents = amount − concessions − waivers (generated, migration 109).
      const parts = obs.map((o) => ({ id: o.id, label: o.label, due: BigInt(o.net_amount_cents ?? o.amount_cents) - BigInt(o.paid_cents) })).filter((x) => x.due > 0n);
      if (!parts.length) return moneyError(reply, 'OBLIGATION_SETTLED', 'obligation already settled');
      for (const part of parts) {
        // F-09: the legacy single-obligation check misses pay-many initiations
        // (those store obligation_id=NULL and live in payment_allocations), which
        // then died on the partial unique index as a 500. Check both shapes.
        const open = await c.query(`SELECT id FROM app.payments WHERE obligation_id=$1 AND status='initiated'`, [part.id]);
        const openMany = open.rows[0] ? null : await c.query(
          `SELECT pa.payment_id FROM app.payment_allocations pa JOIN app.payments p ON p.id = pa.payment_id
            WHERE pa.tenant_id=$1 AND pa.obligation_id=$2 AND p.status='initiated' LIMIT 1`,
          [req.user.tenant_id, part.id]);
        if (open.rows[0] || openMany?.rows[0]) return moneyError(reply, 'PAYMENT_IN_PROGRESS', 'a payment for this obligation is already in progress');
      }
      const totalDue = parts.reduce((s, p2) => s + p2.due, 0n);
      let amount = totalDue;
      if (b.amountCents != null) {
        if (!Number.isInteger(b.amountCents) || b.amountCents <= 0) return moneyError(reply, 'VALIDATION_FAILED', 'amountCents must be a positive integer (paise)');
        amount = BigInt(b.amountCents);
        if (amount > totalDue) return moneyError(reply, 'VALIDATION_FAILED', 'amountCents exceeds the total outstanding');
        const settings = await feeSettings(c, req.user.tenant_id);
        if (amount < totalDue) {
          if (req.user.role === 'parent' && settings.allow_parent_partial === false) return moneyError(reply, 'VALIDATION_FAILED', 'partial payments are not enabled for this school');
          if (amount < BigInt(settings.min_partial_cents)) return moneyError(reply, 'VALIDATION_FAILED', `the minimum partial payment is ${settings.min_partial_cents} paise`);
        }
      }
      // Allocate greedily in obligation order until the amount is exhausted; never allocate more than a due.
      let remaining = amount;
      const allocations = [];
      for (const part of parts) {
        if (remaining <= 0n) break;
        const take = part.due < remaining ? part.due : remaining;
        allocations.push({ obligationId: part.id, amountCents: take.toString(), label: part.label });
        remaining -= take;
      }
      const single = parts.length === 1 ? parts[0].id : null;
      let p;
      try {
        p = await c.query(
          `INSERT INTO app.payments (tenant_id, student_id, obligation_id, amount_cents, method, status, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,'initiated',$6) RETURNING *`,
          [req.user.tenant_id, studentId, single, amount.toString(), paymentMethod, idempotencyKey || null]);
      } catch (e) {
        if (e.code !== '23505' || !idempotencyKey) throw e;
        const prior = await c.query(`SELECT * FROM app.payments WHERE tenant_id=$1 AND idempotency_key=$2`, [req.user.tenant_id, idempotencyKey]);
        if (prior.rows[0]) return { payment: prior.rows[0], already: true };
        throw e;
      }
      for (const a of allocations) {
        await c.query(
          `INSERT INTO app.payment_allocations (tenant_id, payment_id, obligation_id, amount_cents)
           VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, payment_id, obligation_id) DO NOTHING`,
          [req.user.tenant_id, p.rows[0].id, a.obligationId, a.amountCents.toString()]);
      }
      await recordPaymentEvent(c, req.user.tenant_id, { paymentId: p.rows[0].id, kind: 'initiated', actor: req.user.name, actorRole: req.user.role, source: 'kernel', amountCents: amount });
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `payment.initiated — ₹${Number(amount)/100} (${allocations.length} obligation${allocations.length > 1 ? 's' : ''})`, ref: p.rows[0].id });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Initiated payment', recordType: 'Payment', recordRef: p.rows[0].id, reason: `settle ${allocations.map((a) => a.label).join(', ')}`, outcome: `initiated · ${allocations.length} allocation(s) · ₹${Number(amount) / 100}` });
      return { payment: p.rows[0], allocations };
    });
  });

  // D6: confirming a settlement is a CHECKER act (FEES-DESIGN §2.2: clerk initiates/collects,
  // head confirms/reconciles). `finance_clerk` (the maker) was wrongly admitted; removed.
  app.post('/fees/payments/:id/confirm', { preHandler: [require('finance','finance_head','owner'), uuidParams('id')] }, async (req, reply) => {
    // FEE-SEC-2: never fabricate a gateway reference. When the desk settles cash/cheque there is no
    // provider reference; the row records the reserved sentinel `MANUAL` and `settled_via='manual'` so the
    // provenance is explicit, not a gateway-shaped string the schema's CHECK happens to accept.
    const suppliedRef = typeof req.body?.gatewayRef === 'string' ? req.body.gatewayRef.trim() : '';
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const p = (await c.query(`SELECT * FROM app.payments WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!p) return moneyError(reply, 'NOT_FOUND', 'payment not found');
      if (p.status === 'confirmed') return { payment: p, already: true }; // idempotent
      if (p.status !== 'initiated') return moneyError(reply, 'CONFLICT', `payment in status ${p.status}`);
      // RTE-5: a VOIDED obligation must not be resurrected by confirming a still-initiated payment against
      // it. `void` refuses paid_cents>0, so a void obligation has no confirmed payment — but an initiated
      // one could be confirmed here afterwards and flip the obligation back to paid/partial. Refuse
      // BEFORE any mutation.
      const voided = (await c.query(
        `SELECT 1 FROM app.fee_obligations o
          WHERE o.tenant_id=$1 AND o.status='void'
            AND (o.id = $2 OR o.id IN (SELECT obligation_id FROM app.payment_allocations WHERE tenant_id=$1 AND payment_id=$3))
          LIMIT 1`, [req.user.tenant_id, p.obligation_id, p.id])).rows[0];
      if (voided) return moneyError(reply, 'OBLIGATION_SETTLED', 'the obligation was voided — a payment cannot be confirmed against it');
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
      const gatewayRef = suppliedRef || 'MANUAL';
      let verifiedBy = null;
      if (typeof gatewayRef === 'string' && gatewayRef.length > 0 && gatewayRef !== 'MANUAL') {
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
        // A3: UPI captures verify against the UPI webhook ledger too. A UPI settlement used to always
        // settle as 'manual' because only razorpay evidence was consulted.
        if (!verifiedBy) {
          const upi = await c.query(
            `SELECT 1 FROM plugin_upi.webhook_log
              WHERE to_regclass('plugin_upi.webhook_log') IS NOT NULL
                AND tenant_id = $1
                AND (event_id = $2
                     OR payload::jsonb->'payload'->'payment'->'entity'->'notes'->>'paymentId' = $3)
              LIMIT 1`, [req.user.tenant_id, gatewayRef, p.id]).catch((e) => {
            if (e?.code === '42P01') return { rows: [] };
            throw e;
          });
          if (upi.rows[0]) verifiedBy = 'upi';
        }
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
      const settledVia = webhookVerified ? 'gateway' : 'manual';
      // A5: deterministic per-tenant receipt number under a tenant lock. The old
      // `RCP-<base36 timestamp>` + ON CONFLICT DO NOTHING could silently skip a receipt on collision.
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fee_receipt:${req.user.tenant_id}`]);
      const rset = await feeSettings(c, req.user.tenant_id);
      const rprefix = String(rset.receipt_prefix ?? 'RCP').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'RCP';
      const rstart = Math.max(1, Number(rset.receipt_series_start ?? 1) || 1);
      // Tenant-configurable series reset: `yearly` scopes the sequence to the calendar year so
      // receipt numbers restart every January; `academic_year` scopes to the student's academic year
      // when the payment carries one. `never` (default) keeps the global per-tenant sequence.
      const reset = String(rset.receipt_reset ?? 'never');
      const yearScope = reset === 'yearly' ? String(new Date().getFullYear()) : null;
      const rmax = (await c.query(
        // F-11: series_start is a FLOOR, not just a first-row seed — a school that
        // sets 500 mid-year gets 500 next, not max+1 of the old series.
        // F-12: parse the TRAILING numeric segment only — yearly numbers look like
        // PREFIX-2026-0001, and the old leading-strip parsed '2026-0001'::int (22P02
        // → 500 on the next confirm after any yearly receipt existed).
        `SELECT GREATEST(COALESCE(MAX((regexp_match(receipt_no, '([0-9]+)$'))[1]::int), 0), $2 - 1) AS m
           FROM app.fee_receipts WHERE tenant_id=$1 AND ($3::text IS NULL OR receipt_no LIKE '%' || $3 || '%')`, [req.user.tenant_id, rstart, yearScope])).rows[0];
      const receiptNo = reset === 'yearly' ? `${rprefix}-${yearScope}-${String(Number(rmax.m) + 1).padStart(4, '0')}` : `${rprefix}-${String(Number(rmax.m) + 1).padStart(6, '0')}`;
      const confirmed = await c.query(
        `UPDATE app.payments
            SET status='confirmed', confirmed_at=now(), gateway_ref=$2, receipt_no=$3,
                settled_by=$4, settled_via=$5,
                reconciliation_status = CASE WHEN $5='gateway' THEN 'matched' ELSE 'manual' END
          WHERE id=$1 RETURNING *`,
        [p.id, storedRef, receiptNo, req.user.id, settledVia]);
      // F-03: close this payment's allocations (migration 151's trigger does the same;
      // the explicit write documents intent and covers pre-trigger databases).
      await c.query(`UPDATE app.payment_allocations SET open=false WHERE tenant_id=$1 AND payment_id=$2 AND open`,
        [req.user.tenant_id, p.id]).catch(() => {});
      // ledger: distribute the settlement across the payment's ALLOCATIONS (FEE-PRD-10), so a pay-many
      // payment moves every obligation it covers. Legacy payments with no allocation fall back to the
      // single obligation_id. Each obligation's paid_cents is against its NET amount (amount − concessions).
      const allocRows = (await c.query(
        `SELECT obligation_id, amount_cents FROM app.payment_allocations WHERE tenant_id=$1 AND payment_id=$2`,
        [req.user.tenant_id, p.id])).rows;
      const effectiveAllocs = allocRows.length
        ? allocRows
        : (p.obligation_id ? [{ obligation_id: p.obligation_id, amount_cents: p.amount_cents }] : []);
      const settledObligations = [];
      for (const a of effectiveAllocs) {
        const u = await c.query(
          `UPDATE app.fee_obligations SET paid_cents = paid_cents + $2,
             status = CASE WHEN paid_cents + $2 >= net_amount_cents THEN 'paid' ELSE 'partial' END
           WHERE id=$1 AND status <> 'void' RETURNING *`, [a.obligation_id, a.amount_cents.toString()]);
        if (!u.rows[0]) continue;
        settledObligations.push(u.rows[0]);
        // FEE-DAT-5b: settle installments IN ORDER up to this obligation's new paid total.
        await c.query(
          `UPDATE app.fee_installments fi SET status='paid', payment_id=$2
            WHERE fi.tenant_id=$1 AND fi.obligation_id=$3 AND fi.status IN ('pending','overdue')
              AND (SELECT COALESCE(SUM(x.amount_cents),0) FROM app.fee_installments x
                    WHERE x.tenant_id=fi.tenant_id AND x.obligation_id=fi.obligation_id AND x.seq <= fi.seq) <= $4`,
          [req.user.tenant_id, p.id, u.rows[0].id, u.rows[0].paid_cents.toString()]);
      }
      const primary = settledObligations[0] ?? null;
      // immutable receipt artifact (migration 109) — the receipt_no column above is the index; this is the record.
      // A5: no ON CONFLICT — the number is unique under the tenant lock, and a collision must be a
      // hard error, never a silently skipped receipt.
      const receiptRow = (await c.query(
        `INSERT INTO app.fee_receipts (tenant_id, payment_id, receipt_no, student_id, amount_cents, issued_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id`,
        [req.user.tenant_id, p.id, receiptNo, p.student_id, p.amount_cents.toString(), req.user.id])).rows[0];
      // FEE-DAT-3b: render the receipt PDF and store it as a real artifact, then point the receipt row at it.
      // Best-effort: a storage failure must never roll back a completed settlement; the row still exists and
      // can be re-rendered. The artifact is scoped `student` so the child's guardians can download it through
      // files.store's audited door.
      if (receiptRow) {
        try {
          const st = (await c.query(
            `SELECT name, admission_no, grade, section FROM app.students WHERE id=$1`, [p.student_id])).rows[0] ?? {};
          const pdf = receiptPdf({
            receiptNo, studentName: st.name, admissionNo: st.admission_no, grade: st.grade, section: st.section,
            label: primary?.label, term: primary?.term, amountCents: p.amount_cents, method: p.method,
            gatewayRef: storedRef, issuedAt: new Date(), paymentId: p.id });
          const file = await putFile(c, req.user.tenant_id, req.user.id, {
            filename: `receipt-${receiptNo}.pdf`, mime: 'application/pdf', buf: pdf, scope: 'student', refId: p.student_id });
          await c.query(`UPDATE app.fee_receipts SET pdf_file_id=$2 WHERE id=$1`, [receiptRow.id, file.id]);
        } catch { /* artifact is best-effort; the immutable receipt row is the record */ }
      }
      await recordPaymentEvent(c, req.user.tenant_id, { paymentId: p.id, kind: 'confirmed', actor: req.user.name, actorRole: req.user.role, source: settledVia, amountCents: p.amount_cents, payload: { verifiedBy, receiptNo, allocations: settledObligations.length } });
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `payment.confirmed — ₹${Number(p.amount_cents)/100} · receipt ${receiptNo}`, ref: p.id });
      if (primary) await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `reconciliation verified — ${primary.label} status ${primary.status}`, ref: primary.id });
      // FEE-DEL-1: resolve real recipients and a dedup key so the receipt is deliverable, not a row with an
      // empty audience the dispatcher can never send.
      const phones = await guardianPhones(c, req.user.tenant_id, p.student_id);
      await c.query(
        `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, policy_ref, dedup_key)
         VALUES ($1,'guardian',$2::jsonb,'whatsapp','FEE_RECEIPT',$3,'Fees §4.2',$4)
         ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
        [req.user.tenant_id, JSON.stringify(phones), `Receipt ${receiptNo} — ₹${Number(p.amount_cents)/100} received. Thank you.`, `receipt:${p.id}`]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: webhookVerified
          ? `Confirmed payment (gateway reference ${verifiedBy} verified against the provider's own record)`
          : 'Confirmed payment (manual reconciliation — no gateway evidence)', recordType: 'Payment', recordRef: `${receiptNo}`, reason: webhookVerified
            ? `gateway confirm — reference found in ${verifiedBy} log for this payment`
            : 'manual confirm — no gateway record for this reference; verify the statement', policyRef: 'Fees §4.2', outcome: `ledger updated · ${settledObligations.length} obligation(s) settled` });
      return { payment: confirmed.rows[0], obligation: primary, obligations: settledObligations };
    });
  });

  // ============ payments list + receipts (FEE-API-1 / FEE-API-2) ============
  // The itemised payment list the desk and parents both need — filters, pagination, receipt + verification
  // state. Parents are structurally scoped to their own children; staff see the tenant ledger.
  app.get('/payments', { preHandler: roleGatedMe('owner','principal','itadmin','finance','finance_head','finance_clerk','coordinator','parent') }, async (req, reply) => {
    const { studentId, status, method, recon } = req.query;
    if (studentId != null && !UUID_RE_NOTICE.test(String(studentId))) return bad(reply, 'studentId must be a uuid');
    if (recon != null && recon !== 'disputed') return bad(reply, 'recon must be disputed (the mismatch queue) or omitted');
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 500 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const params = [status ?? null, method ?? null, limit, offset];
      let where = `p.tenant_id = app.current_tenant()::uuid
        AND ($1::text IS NULL OR p.status=$1) AND ($2::text IS NULL OR p.method=$2)`;
      if (recon === 'disputed') where += ` AND p.reconciliation_status='disputed'`;
      if (req.user.role === 'parent') {
        const kids = (await c.query(`SELECT student_id FROM family.child_link WHERE user_id=$1`, [req.user.id])).rows.map((r) => r.student_id);
        params.push(kids.length ? kids : ['00000000-0000-0000-0000-000000000000']);
        where += ` AND p.student_id = ANY($${params.length}::uuid[])`;
      } else if (studentId != null) {
        params.push(studentId);
        where += ` AND p.student_id = $${params.length}`;
      } else if (!canReach(req, [...FEE_LEDGER_ROLES])) {
        return reply.code(403).send({ error: 'The full payment ledger is for school staff. Families see their own payments under My fees.' });
      }
      const r = await c.query(
        `SELECT p.id, p.student_id, p.obligation_id, p.amount_cents, p.refunded_cents, p.method, p.status,
                p.gateway_ref, p.receipt_no, p.confirmed_at, p.created_at, p.settled_via, p.reconciliation_status,
                s.name AS student_name, s.grade, s.section, o.label AS obligation_label, o.term,
                -- 4.3 match signal (facts only, never settlement): did a rail speak for this payment?
                -- 'captured' = the rail says money moved; 'recorded' = the rail spoke but not a capture.
                CASE
                  WHEN (to_regclass('plugin_razorpay.order_log') IS NOT NULL AND EXISTS (
                          SELECT 1 FROM plugin_razorpay.order_log ol
                           WHERE ol.tenant_id = p.tenant_id AND ol.payment_id = p.id AND ol.status = 'captured'))
                    OR (to_regclass('plugin_upi.webhook_log') IS NOT NULL AND EXISTS (
                          SELECT 1 FROM plugin_upi.webhook_log wl
                           WHERE wl.tenant_id = p.tenant_id
                             AND wl.payload::jsonb->'payload'->'payment'->'entity'->'notes'->>'paymentId' = p.id::text
                             AND wl.event_type LIKE '%captur%')) THEN 'captured'
                  WHEN (to_regclass('plugin_razorpay.order_log') IS NOT NULL AND EXISTS (
                          SELECT 1 FROM plugin_razorpay.order_log ol
                           WHERE ol.tenant_id = p.tenant_id AND ol.payment_id = p.id))
                    OR (to_regclass('plugin_upi.webhook_log') IS NOT NULL AND EXISTS (
                          SELECT 1 FROM plugin_upi.webhook_log wl
                           WHERE wl.tenant_id = p.tenant_id
                             AND wl.payload::jsonb->'payload'->'payment'->'entity'->'notes'->>'paymentId' = p.id::text)) THEN 'recorded'
                  ELSE NULL END AS gateway_fact
           FROM app.payments p
           JOIN app.students s ON s.id = p.student_id
           LEFT JOIN app.fee_obligations o ON o.id = p.obligation_id
          WHERE ${where}
          ORDER BY p.created_at DESC LIMIT $3 OFFSET $4`, params);
      return { payments: r.rows, limit, offset, hasMore: r.rows.length === limit, scoped: req.user.role === 'parent' ? 'own_children' : 'school' };
    });
  });

  // 4.3: sweep history for the mismatch queue header — when the ledger was last
  // compared, by whom/what, and what it found. Reads only; money untouched.
  app.get('/payments/recon-runs', { preHandler: roleGatedMe('owner','principal','finance','finance_head') }, async (req, reply) => {
    const n = req.query?.limit == null ? 10 : Number(req.query.limit);
    if (!Number.isInteger(n) || n < 1 || n > 50) return bad(reply, 'limit must be 1–50');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = (await c.query(
        `SELECT id, ran_at, source, ghost, missing, orphan, amount_mismatch, actions_raised,
                ghost+missing+orphan+amount_mismatch AS total
           FROM app.recon_runs ORDER BY ran_at DESC LIMIT $1`, [n])).rows;
      return { runs: r };
    });
  });

  // D7: the documented single-payment read (FEES-DESIGN §5) — with its provenance events and allocations.
  app.get('/payments/:id', { preHandler: [roleGatedMe('owner','principal','itadmin','finance','finance_head','finance_clerk','coordinator','parent'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const p = (await c.query(
        `SELECT p.*, s.name AS student_name, s.grade, s.section, o.label AS obligation_label, o.term
           FROM app.payments p JOIN app.students s ON s.id = p.student_id
           LEFT JOIN app.fee_obligations o ON o.id = p.obligation_id
          WHERE p.id=$1 AND p.tenant_id=$2`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!p) return bad(reply, 'not found', 404);
      if (req.user.role === 'parent') {
        const own = (await c.query(`SELECT 1 FROM family.child_link WHERE tenant_id=$1 AND user_id=$2 AND student_id=$3`,
          [req.user.tenant_id, req.user.id, p.student_id]).catch(() => ({ rows: [] }))).rows[0];
        if (!own) return bad(reply, 'This payment is not for your child', 403);
      } else if (!canReach(req, [...FEE_LEDGER_ROLES])) {
        return bad(reply, 'The payment ledger is for school staff.', 403);
      }
      const events = (await c.query(`SELECT kind, actor, actor_role, source, amount_cents, payload, created_at FROM app.payment_events WHERE tenant_id=$1 AND payment_id=$2 ORDER BY created_at`, [req.user.tenant_id, p.id]).catch(() => ({ rows: [] }))).rows;
      const allocations = (await c.query(`SELECT obligation_id, amount_cents FROM app.payment_allocations WHERE tenant_id=$1 AND payment_id=$2`, [req.user.tenant_id, p.id]).catch(() => ({ rows: [] }))).rows;
      return { payment: p, events, allocations };
    });
  });

  // D7: the documented billing-run void (FEES-DESIGN §5). A run with no money against any of its
  // obligations can be voided; its still-open obligations are voided with it. Owner / finance head.
  app.post('/billing-runs/:id/void', { preHandler: [require('owner', 'finance_head'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const run = (await c.query(`SELECT * FROM app.billing_runs WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!run) return bad(reply, 'not found', 404);
      if (run.status === 'void') return bad(reply, 'this billing run is already void', 409);
      const paid = (await c.query(
        `SELECT COALESCE(SUM(paid_cents),0)::bigint AS paid, count(*) FILTER (WHERE paid_cents > 0)::int AS touched
           FROM app.fee_obligations WHERE tenant_id=$1 AND billing_run_id=$2`, [req.user.tenant_id, run.id])).rows[0];
      if (Number(paid.touched) > 0) return bad(reply, `This run has payments against ${paid.touched} obligation(s) — refund or reconcile them before voiding`, 409);
      const voided = (await c.query(
        `UPDATE app.fee_obligations SET status='void' WHERE tenant_id=$1 AND billing_run_id=$2 AND status <> 'void'`, [req.user.tenant_id, run.id])).rowCount;
      await c.query(`UPDATE app.billing_runs SET status='void', voided_by=$2, voided_at=now() WHERE id=$1`, [run.id, req.user.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Billing run voided`, recordType: 'BillingRun', recordRef: run.id, reason: req.body?.reason ?? 'billing run void', policyRef: 'Fees §3', risk: 'high', outcome: `${voided} obligation(s) voided` });
      return { ok: true, voidedObligations: voided };
    });
  });

  app.get('/fees/receipts', { preHandler: roleGatedMe('owner','principal','itadmin','finance','finance_head','finance_clerk','coordinator','parent') }, async (req, reply) => {
    const { studentId } = req.query;
    if (studentId != null && !UUID_RE_NOTICE.test(String(studentId))) return bad(reply, 'studentId must be a uuid');
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 500 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const params = [limit, offset];
      let where = `r.tenant_id = app.current_tenant()::uuid`;
      if (req.user.role === 'parent') {
        const kids = (await c.query(`SELECT student_id FROM family.child_link WHERE user_id=$1`, [req.user.id])).rows.map((x) => x.student_id);
        params.push(kids.length ? kids : ['00000000-0000-0000-0000-000000000000']);
        where += ` AND r.student_id = ANY($${params.length}::uuid[])`;
      } else if (studentId != null) {
        params.push(studentId);
        where += ` AND r.student_id = $${params.length}`;
      } else if (!canReach(req, [...FEE_LEDGER_ROLES])) {
        return reply.code(403).send({ error: 'Receipts are for school staff. Families see their own under My fees.' });
      }
      const r = await c.query(
        `SELECT r.id, r.receipt_no, r.payment_id, r.student_id, r.amount_cents, r.issued_at, r.voided_at, r.pdf_file_id,
                s.name AS student_name, o.label AS obligation_label, o.term
           FROM app.fee_receipts r
           JOIN app.students s ON s.id = r.student_id
           LEFT JOIN app.payments p ON p.id = r.payment_id
           LEFT JOIN app.fee_obligations o ON o.id = p.obligation_id
          WHERE ${where}
          ORDER BY r.issued_at DESC LIMIT $1 OFFSET $2`, params);
      return { receipts: r.rows, limit, offset, hasMore: r.rows.length === limit };
    });
  });

  app.get('/fees/receipts/:id', { preHandler: [roleGatedMe('owner','principal','itadmin','finance','finance_head','finance_clerk','coordinator','parent'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = (await c.query(
        `SELECT r.*, s.name AS student_name, s.admission_no, s.grade, s.section,
                o.label AS obligation_label, o.term, p.method, p.gateway_ref, p.settled_via
           FROM app.fee_receipts r
           JOIN app.students s ON s.id = r.student_id
           LEFT JOIN app.payments p ON p.id = r.payment_id
           LEFT JOIN app.fee_obligations o ON o.id = p.obligation_id
          WHERE r.id=$1`, [req.params.id])).rows[0];
      if (!r) return bad(reply, 'receipt not found', 404);
      if (req.user.role === 'parent') {
        const own = (await c.query(`SELECT 1 FROM family.child_link WHERE user_id=$1 AND student_id=$2`, [req.user.id, r.student_id])).rows[0];
        if (!own) return bad(reply, 'receipt not found', 404);
      }
      return { receipt: r, school: { name: 'SchoolOS' } };
    });
  });

  // FEE-FE-7: download the immutable receipt PDF artifact. The bytes are never web-served; this kernel door
  // applies the SAME scoping as the receipt read (parent → own children) and streams the stored file. It
  // deliberately does not depend on the files.store plugin lifecycle — a parent holding a receipt must be
  // able to download it even if the school has not enabled the generic file module.
  app.get('/fees/receipts/:id/pdf', { preHandler: [roleGatedMe('owner','principal','itadmin','finance','finance_head','finance_clerk','coordinator','parent'), uuidParams('id')] }, async (req, reply) => {
    const verdict = await withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = (await c.query(
        `SELECT r.id, r.receipt_no, r.student_id, r.pdf_file_id FROM app.fee_receipts r WHERE r.id=$1`,
        [req.params.id])).rows[0];
      if (!r) return { refused: 404, msg: 'receipt not found' };
      if (req.user.role === 'parent') {
        const own = (await c.query(`SELECT 1 FROM family.child_link WHERE user_id=$1 AND student_id=$2`, [req.user.id, r.student_id])).rows[0];
        if (!own) return { refused: 404, msg: 'receipt not found' };
      } else if (!canReach(req, [...FEE_LEDGER_ROLES])) {
        return { refused: 403, msg: 'Receipts are for school staff. Families see their own under My fees.' };
      }
      if (!r.pdf_file_id) return { refused: 404, msg: 'this receipt has no PDF artifact' };
      const f = (await c.query(`SELECT filename, mime, storage_path FROM app.files WHERE id=$1`, [r.pdf_file_id])).rows[0];
      if (!f) return { refused: 410, msg: 'the receipt file is no longer available' };
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Downloaded fee receipt PDF', recordType: 'FeeReceipt', recordRef: r.receipt_no, reason: 'receipt artifact download', policyRef: 'Fees §4.2', risk: 'low', outcome: 'served through the kernel receipt door' });
      return { ok: true, file: f };
    });
    if (verdict.ok !== true) return bad(reply, verdict.msg, verdict.refused);
    if (verdict.file.storage_path.includes('..') || verdict.file.storage_path.startsWith('/')) return bad(reply, 'invalid file reference', 400);
    const path = join(storageBase(), verdict.file.storage_path);
    const st = await stat(path).catch(() => null);
    if (!st) return bad(reply, 'the receipt file is no longer available on this server', 410);
    const safe = String(verdict.file.filename ?? 'receipt.pdf').replace(/"/g, '');
    reply.header('content-type', verdict.file.mime ?? 'application/pdf');
    reply.header('content-length', String(st.size));
    reply.header('content-disposition', `attachment; filename="${safe}"`);
    reply.header('cache-control', 'no-store');
    return reply.send(createReadStream(path));
  });

  // ============ fee-message delivery view (FEE-DEL-6) ============
  // The fee-specific delivery surface: every FEE_REMINDER/FEE_RECEIPT/FEE_ESCALATION row with its honest
  // carrier state. `comms.whatsapp/receipts` is generic; an operator watching fee delivery needs the fee
  // subset and the reason a message did not reach a guardian.
  app.get('/fees/delivery', { preHandler: roleGatedMe('owner','principal','itadmin','finance','finance_head','finance_clerk','coordinator') }, async (req, reply) => {
    if (!canReach(req, [...FEE_LEDGER_ROLES])) return reply.code(403).send({ error: 'Fee delivery is for school staff.' });
    const { status } = req.query;
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 300 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT id, template, channel, status, provider, provider_ref, attempts, last_error,
                audience_json, dedup_key, sent_at, delivered_at, created_at
           FROM app.communications
          WHERE template LIKE 'FEE%' AND ($1::text IS NULL OR status=$1)
          ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [status ?? null, limit, offset]);
      return { messages: r.rows, limit, offset, hasMore: r.rows.length === limit };
    });
  });

  // ============ installments (FEE-DAT-5b) ============
  // The scheduled parts of an obligation. Parents are structurally scoped to their own children; staff see
  // the tenant. A plan that carried an installment schedule produces these rows at generation.
  app.get('/fees/installments', { preHandler: roleGatedMe('owner','principal','itadmin','finance','finance_head','finance_clerk','coordinator','parent') }, async (req, reply) => {
    const { obligationId, studentId, status } = req.query;
    if (obligationId != null && !UUID_RE_NOTICE.test(String(obligationId))) return bad(reply, 'obligationId must be a uuid');
    if (studentId != null && !UUID_RE_NOTICE.test(String(studentId))) return bad(reply, 'studentId must be a uuid');
    const { limit, offset } = pageParams(req.query, { defaultLimit: 200, maxLimit: 500 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const params = [obligationId ?? null, status ?? null, limit, offset];
      let where = `fi.tenant_id = app.current_tenant()::uuid
        AND ($1::uuid IS NULL OR fi.obligation_id=$1) AND ($2::text IS NULL OR fi.status=$2)`;
      if (req.user.role === 'parent') {
        const kids = (await c.query(`SELECT student_id FROM family.child_link WHERE user_id=$1`, [req.user.id])).rows.map((r) => r.student_id);
        params.push(kids.length ? kids : ['00000000-0000-0000-0000-000000000000']);
        where += ` AND o.student_id = ANY($${params.length}::uuid[])`;
      } else if (studentId != null) {
        params.push(studentId);
        where += ` AND o.student_id = $${params.length}`;
      } else if (!canReach(req, [...FEE_LEDGER_ROLES])) {
        return reply.code(403).send({ error: 'Installments are for school staff. Families see their own under My fees.' });
      }
      const r = await c.query(
        `SELECT fi.id, fi.obligation_id, fi.seq, fi.due_on, fi.amount_cents, fi.status, fi.payment_id,
                o.label AS obligation_label, o.term, o.student_id, s.name AS student_name, s.grade, s.section
           FROM app.fee_installments fi
           JOIN app.fee_obligations o ON o.id = fi.obligation_id
           JOIN app.students s ON s.id = o.student_id
          WHERE ${where}
          ORDER BY fi.due_on NULLS LAST, fi.seq LIMIT $3 OFFSET $4`, params);
      return { installments: r.rows, limit, offset, hasMore: r.rows.length === limit };
    });
  });

  // ============ concessions / waivers (FEE-DAT-4 / FEE-API-3) ============
  // D4: a concession may be REQUESTED by the family or the class teacher (design §6.5) — it is only
  // DECIDED by finance/owner/principal (the decide door below is unchanged). A parent is scoped to
  // their own child.
  app.post('/fees/concessions', { preHandler: require('owner','principal','finance','finance_head','finance_clerk','parent','teacher') }, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.studentId || !UUID_RE_NOTICE.test(String(b.studentId))) return bad(reply, 'studentId must be a uuid');
    if (!['concession','scholarship','sibling','staff','waiver'].includes(b.kind)) return bad(reply, 'kind must be concession|scholarship|sibling|staff|waiver');
    if (b.percent == null && b.amountCents == null) return bad(reply, 'provide percent or amountCents');
    if (b.percent != null && (!Number.isFinite(Number(b.percent)) || Number(b.percent) < 0 || Number(b.percent) > 100)) return bad(reply, 'percent must be 0..100');
    if (b.amountCents != null && (!Number.isInteger(b.amountCents) || b.amountCents < 0)) return bad(reply, 'amountCents must be a non-negative integer');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!(await feeFeatureGate(c, reply, req.user.tenant_id, 'fees.concessions'))) return;
      if (req.user.role === 'parent') {
        const own = (await c.query(`SELECT 1 FROM family.child_link WHERE tenant_id=$1 AND user_id=$2 AND student_id=$3`,
          [req.user.tenant_id, req.user.id, b.studentId]).catch(() => ({ rows: [] }))).rows[0];
        if (!own) return bad(reply, 'You can only request a concession for your own child', 403);
      }
      // F-04: a concession for student X against student Y's obligation must die here —
      // otherwise one approval silently moves another child's net. Missing obligation
      // reads as 404 (no existence leak); a wrong-student pairing is a 400.
      if (b.obligationId != null) {
        if (!UUID_RE_NOTICE.test(String(b.obligationId))) return bad(reply, 'obligationId must be a uuid');
        const ob = (await c.query(`SELECT id, student_id FROM app.fee_obligations WHERE id=$1 AND tenant_id=$2`,
          [b.obligationId, req.user.tenant_id])).rows[0];
        if (!ob) return bad(reply, 'obligation not found', 404);
        if (ob.student_id !== b.studentId) return bad(reply, 'the obligation does not belong to this student', 400);
      }
      const r = await c.query(
        `INSERT INTO app.fee_concessions (tenant_id, student_id, obligation_id, fee_head_id, kind, percent, amount_cents, reason, status, requested_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'requested',$9) RETURNING *`,
        [req.user.tenant_id, b.studentId, b.obligationId ?? null, b.feeHeadId ?? null, b.kind,
         b.percent ?? null, b.amountCents ?? null, typeof b.reason === 'string' ? b.reason.slice(0, 300) : null, req.user.id]);
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `concession.requested — ${b.kind} for student ${b.studentId}`, ref: r.rows[0].id });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Requested fee concession', recordType: 'FeeConcession', recordRef: r.rows[0].id, reason: b.reason ?? b.kind, policyRef: 'Fees §4.2', outcome: 'requested' });
      return { concession: r.rows[0] };
    });
  });

  app.get('/fees/concessions', { preHandler: roleGatedMe('owner','principal','itadmin','finance','finance_head','finance_clerk','coordinator','parent','teacher') }, async (req, reply) => {
    const { status } = req.query;
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 300 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // D4: a requester (parent/teacher) sees only the concessions they raised; staff see the ledger.
      const selfOnly = req.user.role === 'parent' || req.user.role === 'teacher';
      if (selfOnly) {
        const r = await c.query(
          `SELECT fc.*, s.name AS student_name, s.grade, s.section, o.label AS obligation_label, o.term
             FROM app.fee_concessions fc
             JOIN app.students s ON s.id = fc.student_id
             LEFT JOIN app.fee_obligations o ON o.id = fc.obligation_id
            WHERE fc.requested_by=$1 AND ($2::text IS NULL OR fc.status=$2)
            ORDER BY fc.created_at DESC LIMIT $3 OFFSET $4`, [req.user.id, status ?? null, limit, offset]);
        return { concessions: r.rows, limit, offset, hasMore: r.rows.length === limit, scoped: 'own_requests' };
      }
      if (!canReach(req, [...FEE_LEDGER_ROLES])) return reply.code(403).send({ error: 'Fee concessions are for school staff.' });
      const r = await c.query(
        `SELECT fc.*, s.name AS student_name, s.grade, s.section, o.label AS obligation_label, o.term
           FROM app.fee_concessions fc
           JOIN app.students s ON s.id = fc.student_id
           LEFT JOIN app.fee_obligations o ON o.id = fc.obligation_id
          WHERE ($1::text IS NULL OR fc.status=$1)
          ORDER BY fc.created_at DESC LIMIT $2 OFFSET $3`, [status ?? null, limit, offset]);
      return { concessions: r.rows, limit, offset, hasMore: r.rows.length === limit };
    });
  });

  app.post('/fees/concessions/:id/decide', { preHandler: [require('owner','principal','finance','finance_head'), uuidParams('id')] }, async (req, reply) => {
    const decision = req.body?.decision;
    if (!['approve','reject'].includes(decision)) return bad(reply, 'decision must be approve|reject');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const con = (await c.query(`SELECT * FROM app.fee_concessions WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!con) return bad(reply, 'concession not found', 404);
      if (con.status !== 'requested') return bad(reply, `concession already ${con.status}`, 409);
      if (con.requested_by && con.requested_by === req.user.id && req.user.role !== 'owner') {
        return reply.code(403).send({ error: 'A concession cannot be approved by its requester', code: 'SOD_REQUIRED' });
      }
      if (decision === 'reject') {
        const r = await c.query(`UPDATE app.fee_concessions SET status='rejected', approved_by=$2, approved_at=now() WHERE id=$1 RETURNING *`, [con.id, req.user.id]);
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Rejected fee concession', recordType: 'FeeConcession', recordRef: con.id, reason: 'rejected', policyRef: 'Fees §4.2', outcome: 'rejected' });
        return { concession: r.rows[0] };
      }
      // approve: apply to the obligation when one is named. The reduction may never exceed the unpaid remainder.
      if (con.obligation_id) {
        const o = (await c.query(`SELECT id, amount_cents, paid_cents, concession_cents, waived_cents FROM app.fee_obligations WHERE id=$1 FOR UPDATE`, [con.obligation_id])).rows[0];
        if (o) {
          const base = BigInt(o.amount_cents) - BigInt(o.concession_cents) - BigInt(o.waived_cents);
          let reduction = con.amount_cents != null ? BigInt(con.amount_cents) : (base * BigInt(Math.round(Number(con.percent) * 100)) / 10000n);
          const unpaid = base - BigInt(o.paid_cents);
          if (reduction > unpaid) reduction = unpaid < 0n ? 0n : unpaid;
          const col = con.kind === 'waiver' ? 'waived_cents' : 'concession_cents';
          await c.query(`UPDATE app.fee_obligations SET ${col} = ${col} + $2 WHERE id=$1`, [o.id, reduction.toString()]);
        }
      }
      const r = await c.query(`UPDATE app.fee_concessions SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1 RETURNING *`, [con.id, req.user.id]);
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `concession.decided — ${con.kind} approved`, ref: con.id });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Approved fee concession', recordType: 'FeeConcession', recordRef: con.id, reason: con.kind, policyRef: 'Fees §4.2', outcome: 'approved — obligation reduced' });
      return { concession: r.rows[0] };
    });
  });

  // ============ transport ============
  app.get('/transport/routes', { preHandler: me }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // retired_at: a retired route leaves every read but keeps its history (migration 136)
      const r = await c.query(
        `SELECT r.*, (SELECT count(*) FROM app.students s WHERE s.bus_route = r.code) AS riders
         FROM app.routes r WHERE r.retired_at IS NULL ORDER BY r.code`);
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

  app.get('/work-orders', { preHandler: require('principal','owner','itadmin','finance','finance_head','finance_clerk','coordinator','facilities','technician','transport','teacher') }, async (req, reply) => {
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
  app.get('/assets', { preHandler: roleGatedMe('owner','principal','itadmin','finance','finance_head','finance_clerk','coordinator','facilities','technician','transport') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.assets ORDER BY code LIMIT 500`);
      return { assets: r.rows };
    });
  });

  // ============ cases ============
  const STAFF_CASE_ROLES = new Set(['owner', 'principal', 'itadmin', 'coordinator', 'teacher', 'finance']);
  app.get('/cases', { preHandler: roleGatedMe('owner','principal','itadmin','coordinator','teacher','finance','finance_head','finance_clerk') }, async (req, reply) => {
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

  // One case, for the case workspace at /cases/:id. The board reads the whole log; opening a case
  // needs the row itself, and until this door existed the workspace could only show the demo store —
  // so a real case had no page. Staff see any case; a guardian may read ONLY the case they filed
  // (`opened_by` is their own user id), which is the same structural rule every other parent read uses.
  app.get('/cases/:id', { preHandler: [me, uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.cases WHERE id=$1`, [req.params.id]);
      const row = r.rows[0];
      if (!row) return bad(reply, 'not found', 404);
      if (!canReach(req, [...STAFF_CASE_ROLES])) {
        /* a parent who did not file it is refused the same way the staff log refuses them */
        if (row.opened_by !== req.user.id) {
          return reply.code(403).send({ error: 'That case belongs to another family. Parents track their own complaints at /my-cases.' });
        }
      }
      return { case: row };
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
  app.get('/actions', { preHandler: require('owner','principal','itadmin','finance','finance_head','finance_clerk','coordinator','teacher','admissions','transport','facilities','technician') }, async (req) => {
    const { status, owner_role, kind, overdue } = req.query;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // OPP-API-7: the owner/principal console filters its own queue. `overdue` returns open actions past
      // their deadline (the SLA worker's subject); `owner_role`/`kind` narrow the oversight view.
      const r = await c.query(
        `SELECT * FROM app.actions
          WHERE ($1::text IS NULL OR status=$1)
            AND ($2::text IS NULL OR owner_role=$2)
            AND ($3::text IS NULL OR kind=$3)
            AND ($4::boolean IS NOT TRUE OR (status='open' AND deadline IS NOT NULL AND deadline < now()))
          ORDER BY created_at DESC LIMIT 200`,
        [status ?? null, owner_role ?? null, kind ?? null, overdue === 'true']);
      return { actions: r.rows };
    });
  });

  /* OPP-OVR-2: delegation of approval authority. A role-holder (or the owner on their behalf) names a
     deputy for a bounded window. The decide handler honours an active row and stamps the decision as
     delegated. Finance and owner-owned actions are never delegable (SoD). */
  app.get('/delegations', { preHandler: require('owner','principal','itadmin','coordinator') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT d.*, uf.name AS from_name, ut.name AS to_name
           FROM app.action_delegations d
           LEFT JOIN app.users uf ON uf.id = d.from_user_id
           LEFT JOIN app.users ut ON ut.id = d.to_user_id
          WHERE d.tenant_id=$1 ORDER BY d.ends_at DESC LIMIT 100`, [req.user.tenant_id]);
      return { delegations: r.rows };
    });
  });
  // OPP-RBAC-6: a roster read the DELEGATING roles can actually reach (people.admin/users is
  // owner/itadmin only, so the principal's deputy picker was empty). Excludes owner/finance (never
  // delegable) and non-staff roles.
  app.get('/delegations/roster', { preHandler: require('owner','principal','itadmin','coordinator') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT id, name, role FROM app.users
          WHERE tenant_id=$1 AND active AND role NOT IN ('parent','student','owner','finance','finance_head','finance_clerk')
          ORDER BY name LIMIT 500`, [req.user.tenant_id]);
      return { users: r.rows };
    });
  });
  app.post('/delegations', { preHandler: require('owner','principal','itadmin','coordinator') }, async (req, reply) => {
    const { fromUserId, toUserId, fromRole, toRole, scopeRole, startsAt, endsAt, reason } = req.body ?? {};
    if (!toUserId || !fromRole || !toRole || !endsAt) return bad(reply, 'toUserId, fromRole, toRole and endsAt are required');
    // OVR-7: the WHOLE finance tier and the owner are non-delegable — not just the literal 'finance'.
    const FINANCE_TIER = ['finance', 'finance_head', 'finance_clerk'];
    if (fromRole === 'owner' || FINANCE_TIER.includes(fromRole) || FINANCE_TIER.includes(scopeRole))
      return bad(reply, 'owner and finance approval authority cannot be delegated (segregation of duties)', 403);
    if (toRole === 'owner' || FINANCE_TIER.includes(toRole))
      return bad(reply, 'approval authority cannot be delegated to an owner or finance role (segregation of duties)', 403);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const from = fromUserId
        ? (await c.query(`SELECT id, role FROM app.users WHERE id=$1 AND tenant_id=$2`, [fromUserId, req.user.tenant_id])).rows[0]
        : { id: req.user.id, role: req.user.role };
      const to = (await c.query(`SELECT id, role FROM app.users WHERE id=$1 AND tenant_id=$2`, [toUserId, req.user.tenant_id])).rows[0];
      if (!from || !to) return bad(reply, 'from or to user not found', 404);
      // OVR-7 (delegation forgery): the stored role is the DB-resolved role, so the declared
      // `fromRole` must match it — otherwise a caller could name another user (e.g. the principal)
      // as the delegator while declaring a harmless role, minting authority they do not hold.
      if (String(from.role) !== String(fromRole))
        return bad(reply, 'fromRole must match the delegating user\'s actual role', 403);
      // Only the owner may delegate on another user's behalf; everyone else delegates only their own.
      if (from.id !== req.user.id && req.user.role !== 'owner')
        return bad(reply, 'only the owner may delegate another user\'s approval authority', 403);
      // A delegation must name a genuinely different deputy.
      if (to.id === from.id) return bad(reply, 'a delegation must name a different deputy', 400);
      const starts = startsAt ? new Date(startsAt) : new Date();
      const ends = new Date(endsAt);
      if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts)
        return bad(reply, 'endsAt must be a valid time after the start');
      if (ends <= new Date()) return bad(reply, 'endsAt must be in the future');
      const r = await c.query(
        `INSERT INTO app.action_delegations
           (tenant_id, from_user_id, from_role, to_user_id, to_role, scope_role, starts_at, ends_at, reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.user.tenant_id, from.id, from.role, to.id, to.role, scopeRole ?? null, starts.toISOString(), ends.toISOString(), reason ?? null, req.user.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Approval authority delegated: ${from.role} → ${to.role}`, recordType: 'Delegation', recordRef: r.rows[0].id, reason: reason ?? 'vacation cover', policyRef: 'Approvals §1.4 (delegation)', risk: 'medium', outcome: `until ${ends.toISOString()}` });
      await emitEvent(c, req.user.tenant_id, { type: 'governance', label: `Approval authority delegated ${from.role} → ${to.role}` }, 'approval.delegated.v1', { from: from.id, to: to.id, endsAt: ends.toISOString() });
      return { delegation: r.rows[0] };
    });
  });

  /* OPP-OVR-1: a first-class OWNER-owned action queue. Board decisions, high-risk exceptions and
     SoD escalations are raised with `owner_role='owner'`, so the owner has a distinct queue instead of
     existing only as an override. Only the owner can raise and decide these. */
  app.post('/owner/actions', { preHandler: require('owner') }, async (req, reply) => {
    const { title, detail, why, priority, policyRef, kind } = req.body ?? {};
    if (!title) return bad(reply, 'title is required');
    const k = ['approval','incident','case','exception','recommendation','reminder'].includes(String(kind)) ? String(kind) : 'exception';
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const a = await c.query(
        `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_plugin, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8,'owner',$9,false,NULL,$10::jsonb) RETURNING *`,
        [req.user.tenant_id, `owner.decision.${randomUUID().slice(0, 8)}`, k, title, detail ?? null, why ?? null,
         ['critical','high','normal','low'].includes(String(priority)) ? String(priority) : 'high',
         req.user.name, policyRef ?? 'Owner authority §1',
         JSON.stringify({ proposed_by: req.user.id, proposed_by_role: req.user.role, owner_owned: true })]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Owner decision raised: ${title}`, recordType: 'Action', recordRef: a.rows[0].code, reason: 'owner-owned queue', policyRef: policyRef ?? 'Owner authority §1', risk: 'medium', outcome: 'awaiting owner decision' });
      return { action: a.rows[0] };
    });
  });

  /* ── OPP: owner/principal oversight product (board pack, brief, announcements, compliance, certs) ──────
     All read over the live tables under RLS; writes ride the kernel approval spine where consequential. */

  // OPP-PRD-1 · the board pack / cross-domain roll-up. One call, every desk, computed from real rows.
  app.get('/reports/board-pack', { preHandler: require('owner','principal','coordinator','finance','finance_head','itadmin') }, async (req) => {
    const cached = boardPackCache.get(req.user.tenant_id);
    if (cached && Date.now() - cached.at < BOARD_PACK_TTL_MS) return { ...cached.data, cached: true };
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const istToday = `('now' AT TIME ZONE 'Asia/Kolkata')::date`;
      // Sequential: one pg client cannot run concurrent queries (pg@9 deprecation, and parameter
      // binding collides across overlapping statements).
      const att = await c.query(`SELECT count(*) FILTER (WHERE status='present')::int present,
                        count(*) FILTER (WHERE status='absent')::int absent,
                        count(*)::int marked
                   FROM app.attendance WHERE tenant_id=$1 AND school_date=${istToday}`, [req.user.tenant_id]);
      const fees = await c.query(`SELECT COALESCE(sum(amount_cents),0)::bigint billed, COALESCE(sum(paid_cents),0)::bigint collected,
                        COALESCE(sum(amount_cents - paid_cents),0)::bigint outstanding,
                        count(*) FILTER (WHERE status IN ('pending','partial'))::int open_obligations
                   FROM app.fee_obligations WHERE tenant_id=$1`, [req.user.tenant_id]);
      const cases = await c.query(`SELECT count(*) FILTER (WHERE status='open')::int open, count(*)::int total FROM app.cases WHERE tenant_id=$1`, [req.user.tenant_id]);
      const funnel = await c.query(`SELECT count(*)::int leads FROM plugin_admissions.lead WHERE tenant_id=$1 AND stage NOT IN ('enrolled','lost')`, [req.user.tenant_id]);
      const staff = await c.query(`SELECT count(*)::int staff FROM app.users WHERE tenant_id=$1 AND active AND role NOT IN ('parent','student')`, [req.user.tenant_id]);
      const safety = await c.query(`SELECT count(*) FILTER (WHERE status='open')::int open_safety FROM safety.box WHERE tenant_id=$1`, [req.user.tenant_id]);
      const students = (await c.query(`SELECT count(*)::int n FROM app.students WHERE tenant_id=$1 AND status='active'`, [req.user.tenant_id])).rows[0].n;
      const data = {
        as_of: new Date().toISOString(),
        students,
        attendance_today: att.rows[0],
        fees: { ...fees.rows[0], billed: Number(fees.rows[0].billed), collected: Number(fees.rows[0].collected), outstanding: Number(fees.rows[0].outstanding) },
        cases: cases.rows[0],
        admissions_open_leads: funnel.rows[0].leads,
        staff_count: staff.rows[0].staff,
        safety_open: safety.rows[0].open_safety,
      };
      boardPackCache.set(req.user.tenant_id, { at: Date.now(), data });
      return data;
    });
  });

  // OPP-PRD-1/DAT-2 · generate + persist an immutable snapshot (append-only; content-hashed).
  app.post('/reports/board-pack/snapshot', { preHandler: require('owner','principal','itadmin') }, async (req, reply) => {
    const kind = String(req.body?.kind ?? 'board_pack');
    if (!['board_pack','inspection_pack','fee_health','safety_summary'].includes(kind)) return bad(reply, 'unknown snapshot kind');
    const period = String(req.body?.period ?? new Date().toISOString().slice(0, 7));
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const istToday = `('now' AT TIME ZONE 'Asia/Kolkata')::date`;
      const att = (await c.query(`SELECT count(*) FILTER (WHERE status='present')::int present, count(*) FILTER (WHERE status='absent')::int absent, count(*)::int marked FROM app.attendance WHERE tenant_id=$1 AND school_date=${istToday}`, [req.user.tenant_id])).rows[0];
      const fees = (await c.query(`SELECT COALESCE(sum(amount_cents),0)::bigint billed, COALESCE(sum(paid_cents),0)::bigint collected, COALESCE(sum(amount_cents-paid_cents),0)::bigint outstanding FROM app.fee_obligations WHERE tenant_id=$1`, [req.user.tenant_id])).rows[0];
      const payload = { kind, period, attendance: att, fees: { billed: Number(fees.billed), collected: Number(fees.collected), outstanding: Number(fees.outstanding) }, generated_by: req.user.name };
      if (kind === 'inspection_pack') {
        // OPP-PRD-6: the one-click inspection bundle also carries safety, cases and compliance facts.
        const cases = (await c.query(`SELECT count(*) FILTER (WHERE status='open')::int open, count(*)::int total FROM app.cases WHERE tenant_id=$1`, [req.user.tenant_id])).rows[0];
        const safety = (await c.query(`SELECT count(*) FILTER (WHERE status<>'closed')::int open, count(*)::int total FROM safety.box WHERE tenant_id=$1`, [req.user.tenant_id])).rows[0];
        const compliance = (await c.query(`SELECT count(*) FILTER (WHERE status='filed')::int filed, count(*)::int total FROM app.compliance_items WHERE tenant_id=$1`, [req.user.tenant_id])).rows[0];
        payload.cases = cases; payload.safety = safety; payload.compliance = compliance;
      }
      const hash = createHash('sha256').update(canonicalJson(payload)).digest('hex');
      const r = await c.query(
        `INSERT INTO app.report_snapshots (tenant_id, kind, period, payload, content_hash, generated_by)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6)
         ON CONFLICT (tenant_id, kind, period, content_hash) DO NOTHING RETURNING *`,
        [req.user.tenant_id, kind, period, JSON.stringify(payload), hash, req.user.id]);
      if (!r.rows[0]) return { snapshot: null, content_hash: hash, already: true };
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Generated ${kind} snapshot`, recordType: 'ReportSnapshot', recordRef: r.rows[0].id, reason: 'board/inspection pack', policyRef: 'Governance §2', risk: 'low', outcome: `period ${period}` });
      return { snapshot: r.rows[0] };
    });
  });
  app.get('/reports/snapshots', { preHandler: require('owner','principal','coordinator','finance','finance_head','itadmin') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT id, kind, period, content_hash, generated_by, created_at FROM app.report_snapshots WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.user.tenant_id]);
      return { snapshots: r.rows };
    });
  });
  // OPP-DAT-10: retrieve a stored snapshot (the artifact the board/inspection pack is made of).
  app.get('/reports/snapshots/:id', { preHandler: [require('owner','principal','coordinator','finance','finance_head','itadmin'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.report_snapshots WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.user.tenant_id]);
      if (!r.rows[0]) return bad(reply, 'not found', 404);
      const snap = r.rows[0];
      // Re-derive the hash from the stored payload and refuse if it does not match — a snapshot is a fact.
      const recomputed = createHash('sha256').update(canonicalJson(snap.payload)).digest('hex');
      return { snapshot: snap, hash_ok: recomputed === snap.content_hash, recomputed_hash: recomputed };
    });
  });

  // OPP-PRD-2 · the principal's brief.
  app.get('/brief/principal', { preHandler: require('owner','principal','itadmin','coordinator') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT payload, brief_date, created_at FROM app.principal_briefs WHERE tenant_id=$1 ORDER BY brief_date DESC LIMIT 1`, [req.user.tenant_id]);
      return { brief: r.rows[0]?.payload ?? null, brief_date: r.rows[0]?.brief_date ?? null };
    });
  });

  // OPP-API-1 · one live oversight aggregate, computed over the real tables under RLS.
  const oversightHome = async (c, tenantId) => {
    const istToday = `('now' AT TIME ZONE 'Asia/Kolkata')::date`;
    const queue = (await c.query(`SELECT owner_role, count(*)::int n FROM app.actions WHERE tenant_id=$1 AND status='open' GROUP BY owner_role`, [tenantId])).rows;
    const fees = (await c.query(`SELECT COALESCE(sum(amount_cents),0)::bigint billed, COALESCE(sum(paid_cents),0)::bigint collected, COALESCE(sum(amount_cents-paid_cents),0)::bigint outstanding, count(*) FILTER (WHERE status IN ('pending','partial'))::int open_obligations FROM app.fee_obligations WHERE tenant_id=$1`, [tenantId])).rows[0];
    const students = (await c.query(`SELECT count(*)::int n FROM app.students WHERE tenant_id=$1 AND status='active'`, [tenantId])).rows[0].n;
    const attendance = (await c.query(`SELECT count(*) FILTER (WHERE status='present')::int present, count(*) FILTER (WHERE status='absent')::int absent FROM app.attendance WHERE tenant_id=$1 AND school_date=${istToday}`, [tenantId])).rows[0];
    const compliance = (await c.query(`SELECT count(*) FILTER (WHERE status<>'filed')::int open, count(*) FILTER (WHERE status<>'filed' AND due_on <= ${istToday})::int overdue FROM app.compliance_items WHERE tenant_id=$1`, [tenantId])).rows[0];
    const safety = (await c.query(`SELECT count(*) FILTER (WHERE status<>'closed')::int open FROM safety.box WHERE tenant_id=$1`, [tenantId])).rows[0].open;
    const brief = (await c.query(`SELECT payload, brief_date FROM app.principal_briefs WHERE tenant_id=$1 ORDER BY brief_date DESC LIMIT 1`, [tenantId])).rows[0] ?? null;
    return {
      as_of: new Date().toISOString(),
      students,
      queue,
      queue_total: queue.reduce((s, r) => s + r.n, 0),
      fees: { billed: Number(fees.billed), collected: Number(fees.collected), outstanding: Number(fees.outstanding), open_obligations: fees.open_obligations },
      attendance_today: attendance,
      compliance,
      safety_open: safety,
      brief: brief?.payload ?? null,
      brief_date: brief?.brief_date ?? null,
    };
  };
  app.get('/owner/home', { preHandler: require('owner','principal','itadmin') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, (c) => oversightHome(c, req.user.tenant_id));
  });
  app.get('/principal/home', { preHandler: require('owner','principal','itadmin','coordinator') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, (c) => oversightHome(c, req.user.tenant_id));
  });

  // OPP-PRD-3 · the announcement composer. Compose → approve (kernel action) → queue.
  app.get('/announcements', { preHandler: require('owner','principal','coordinator','finance','finance_head','itadmin') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.announcements WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.user.tenant_id]);
      return { announcements: r.rows };
    });
  });
  const announceReach = async (c, tenantId, kind, ref, channel) => {
    if (String(channel).toLowerCase() === 'in-app') return resolveNoticeUserIds(c, tenantId, { audienceKind: kind, audienceRef: ref });
    return resolveNoticeRecipients(c, tenantId, { audienceKind: kind, audienceRef: ref, routeCode: kind === 'route' ? ref : undefined, channel });
  };
  app.post('/announcements', { preHandler: require('owner','principal','itadmin','coordinator') }, async (req, reply) => {
    const { title, body, audienceKind, audienceRef, channel } = req.body ?? {};
    if (!title || !body) return bad(reply, 'title and body are required');
    const kind = String(audienceKind ?? 'all_guardians');
    if (!['all_guardians','class','route','staff','custom'].includes(kind)) return bad(reply, 'unknown audience');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // Resolve the audience NOW so the approver sees the true reach (and the executor queues exactly it).
      const recipients = await announceReach(c, req.user.tenant_id, kind, audienceRef, channel ?? 'In-app');
      const a = await c.query(
        `INSERT INTO app.announcements (tenant_id, title, body, audience_kind, audience_ref, channel, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'draft',$7) RETURNING *`,
        [req.user.tenant_id, title, body, kind, audienceRef ?? null, channel ?? 'In-app', req.user.id]);
      // OVR-10: composing raises a principal-owned approval action, so approval rides the kernel
      // spine (proposer ≠ approver) instead of being a private door decision.
      const act = await c.query(
        `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_plugin, payload)
         VALUES ($1,$2,'approval',$3,$4,$5,'normal','open','Principal','principal','Communication §2',false,NULL,$6::jsonb) RETURNING id`,
        [req.user.tenant_id, `announcements.approve.${a.rows[0].id}`,
         `Approve announcement: ${title}`,
         `Audience ${kind} — ${recipients.length} recipient(s).`,
         'A whole-school announcement is a consequential communication — it is approved before it is queued.',
         JSON.stringify({ announcementId: a.rows[0].id, proposed_by: req.user.id, proposed_by_role: req.user.role })]);
      await c.query(`UPDATE app.announcements SET action_id=$2 WHERE id=$1`, [a.rows[0].id, act.rows[0].id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Announcement drafted: ${title}`, recordType: 'Announcement', recordRef: a.rows[0].id, reason: 'announcement composer', policyRef: 'Communication §2', risk: 'low', outcome: `${recipients.length} recipient(s) resolved; action ${act.rows[0].id} raised` });
      return { announcement: { ...a.rows[0], action_id: act.rows[0].id }, recipients: recipients.length };
    });
  });
  app.post('/announcements/:id/approve', { preHandler: require('owner','principal') }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const ann = (await c.query(`SELECT * FROM app.announcements WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!ann) return bad(reply, 'not found', 404);
      if (ann.status !== 'draft') return bad(reply, `announcement already ${ann.status}`, 409);
      // OVR-10: approval decides the raised kernel action — proposer ≠ approver (owner override).
      // Atomicity (action-plan batch 2): every refusal below must happen BEFORE any write. An early
      // `return bad(...)` after the action row was already flipped used to COMMIT the half-finished
      // approval (action approved, announcement still draft) with no recovery path — the second
      // attempt 409s forever. So: validate everything first, mutate once at the end; and a row left
      // in that exact stuck shape by the old code resumes instead of refusing.
      let resumeApproved = false;
      if (ann.action_id) {
        const act = (await c.query(`SELECT * FROM app.actions WHERE id=$1 AND tenant_id=$2`, [ann.action_id, req.user.tenant_id])).rows[0];
        if (!act) return bad(reply, 'the approval action is missing — re-compose the announcement', 409);
        const proposedBy = act.payload && typeof act.payload === 'object' ? act.payload.proposed_by : null;
        if (proposedBy && proposedBy === req.user.id && req.user.role !== 'owner')
          return bad(reply, 'self-approval is not permitted (segregation of duties)', 403);
        if (act.status !== 'open') {
          if (act.status === 'approved') resumeApproved = true;
          else return bad(reply, `the approval action is already ${act.status}`, 409);
        }
      }
      const inApp = String(ann.channel).toLowerCase() === 'in-app';
      const recipients = await announceReach(c, req.user.tenant_id, ann.audience_kind, ann.audience_ref, ann.channel);
      if (recipients.length === 0) return bad(reply, 'no reachable recipients resolved for this audience — nothing to send', 409);
      if (ann.action_id && !resumeApproved) {
        await c.query(`UPDATE app.actions SET status='approved', decided_by=$2, decided_at=now(), decision_note=$3 WHERE id=$1`,
          [ann.action_id, req.user.id, 'announcement approved']);
      }
      let commId = null;
      if (inApp) {
        // In-app announcements are app.notifications rows (per user), delivered immediately inside SchoolOS.
        for (const uid of recipients) {
          await c.query(
            `INSERT INTO app.notifications (tenant_id, user_id, "group", title, body, ref) VALUES ($1,$2,'school',$3,$4,$5)`,
            [req.user.tenant_id, uid, ann.title, ann.body, `/announcements/${ann.id}`]);
          // DAT-8: per-recipient receipt — in-app is delivered immediately.
          await c.query(
            `INSERT INTO app.announcement_receipts (tenant_id, announcement_id, user_id, channel, status, detail)
             VALUES ($1,$2,$3,'In-app','delivered','delivered in-app')`, [req.user.tenant_id, ann.id, uid]);
        }
      } else {
        const comm = await c.query(
          `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, status, policy_ref, approved_by)
           VALUES ($1,$2::jsonb,$3,'ANNOUNCEMENT',$4,'queued','Communication §2',$5) RETURNING *`,
          [req.user.tenant_id, JSON.stringify(recipients), ann.channel, ann.body, req.user.id]);
        commId = comm.rows[0].id;
        // DAT-8: outbound receipts start QUEUED — the dispatcher owns delivery and the honest verdict.
        // The recipient is a phone; keep only a masked tail so the receipt table is not a second PII store.
        for (const phone of recipients) {
          await c.query(
            `INSERT INTO app.announcement_receipts (tenant_id, announcement_id, user_id, channel, status, detail)
             VALUES ($1,$2,NULL,$3,'queued',$4)`,
            [req.user.tenant_id, ann.id, ann.channel, `to ****${String(phone).slice(-4)}`]);
        }
      }
      const r = await c.query(
        `UPDATE app.announcements SET status='queued', comm_id=$2, recipients=$3, approved_by=$4, approved_at=now() WHERE id=$1 RETURNING *`,
        [ann.id, commId, recipients.length, req.user.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Announcement approved and ${inApp ? 'delivered in-app' : 'queued'}: ${ann.title}`, recordType: 'Announcement', recordRef: ann.id, reason: 'announcement composer', policyRef: 'Communication §2', risk: 'medium', outcome: `${recipients.length} recipient(s)` });
      await emitEvent(c, req.user.tenant_id, { type: 'comms', label: `Announcement "${ann.title}" approved and ${inApp ? 'delivered in-app' : 'QUEUED'} to ${recipients.length} recipient(s)`, ref: commId });
      return { announcement: r.rows[0] };
    });
  });
  // OPP-DAT-8 · delivery receipts for an announcement.
  app.get('/announcements/:id/receipts', { preHandler: [require('owner','principal','coordinator','finance','finance_head','itadmin'), uuidParams('id')] }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT status, count(*)::int n FROM app.announcement_receipts WHERE tenant_id=$1 AND announcement_id=$2 GROUP BY status ORDER BY status`,
        [req.user.tenant_id, req.params.id])).rows;
      const total = rows.reduce((s, r) => s + r.n, 0);
      return { receipts: rows, total };
    });
  });

  // OPP-PRD-5 · the compliance calendar.
  app.get('/compliance', { preHandler: require('owner','principal','coordinator','finance','finance_head','itadmin') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.compliance_items WHERE tenant_id=$1 ORDER BY due_on ASC LIMIT 200`, [req.user.tenant_id]);
      return { items: r.rows };
    });
  });
  app.post('/compliance', { preHandler: require('owner','principal','itadmin','coordinator') }, async (req, reply) => {
    const { kind, title, dueOn, ownerRole } = req.body ?? {};
    if (!title || !dueOn) return bad(reply, 'title and dueOn are required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dueOn))) return bad(reply, 'dueOn must be YYYY-MM-DD');
    const k = String(kind ?? 'other');
    if (!['board_return','inspection','fire_drill','dpdp_audit','certification','other'].includes(k)) return bad(reply, 'unknown compliance kind');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `INSERT INTO app.compliance_items (tenant_id, kind, title, due_on, owner_role, created_by)
         VALUES ($1,$2,$3,$4::date,$5,$6) ON CONFLICT (tenant_id, kind, title, due_on) DO NOTHING RETURNING *`,
        [req.user.tenant_id, k, title, dueOn, ownerRole ?? 'principal', req.user.id]);
      if (!r.rows[0]) return { item: null, already: true };
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Compliance item added: ${title}`, recordType: 'Compliance', recordRef: r.rows[0].id, reason: 'compliance calendar', policyRef: 'Governance §3', risk: 'low', outcome: `due ${dueOn}` });
      return { item: r.rows[0] };
    });
  });
  app.post('/compliance/:id/file', { preHandler: require('owner','principal','itadmin') }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `UPDATE app.compliance_items SET status='filed', evidence_ref=$3, filed_by=$4, filed_at=now()
          WHERE id=$1 AND tenant_id=$2 AND status <> 'filed' RETURNING *`,
        [req.params.id, req.user.tenant_id, req.body?.evidenceRef ?? null, req.user.id]);
      if (!r.rows[0]) return bad(reply, 'not found or already filed', 404);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Compliance filed: ${r.rows[0].title}`, recordType: 'Compliance', recordRef: r.rows[0].id, reason: 'compliance calendar', policyRef: 'Governance §3', risk: 'low', outcome: req.body?.evidenceRef ?? 'filed' });
      return { item: r.rows[0] };
    });
  });

  // OPP-PRD-7 · certificate signing (TC / bonafide / character).
  /* OVR-9/DAT-9: issuing a certificate renders a content-addressed artifact into the private file
     store (app.files.sha256 is the content digest) and marks the row issued. Shared by the direct
     sign door and the kernel decide executor, so both paths produce the same artifact. */
  const issueCertificate = async (c, req, cert) => {
    const rendered = [
      'CERTIFICATE',
      `Kind: ${cert.kind}`,
      `Serial: ${cert.serial}`,
      `Student: ${cert.student_id}`,
      `Issued by: ${req.user.name} (${req.user.role})`,
      `Issued at: ${new Date().toISOString()}`,
      '',
      cert.body ?? '',
    ].join('\n');
    const file = await putFile(c, req.user.tenant_id, req.user.id, {
      filename: `${cert.serial}.txt`, mime: 'text/plain',
      buf: Buffer.from(rendered, 'utf8'), scope: 'student', refId: cert.student_id,
    });
    const r = await c.query(
      `UPDATE app.certificates SET status='issued', signed_by=$2, signed_at=now(), artifact_ref=$3 WHERE id=$1 RETURNING *`,
      [cert.id, req.user.id, file.id]);
    await emitEvent(c, req.user.tenant_id, { type: 'governance', label: `Certificate ${cert.serial} signed` }, 'certificate.signed.v1', { certificateId: cert.id, kind: cert.kind, artifactRef: file.id });
    return r.rows[0];
  };
  app.get('/certificates', { preHandler: require('owner','principal','coordinator','finance','finance_head','itadmin') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT * FROM app.certificates WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.user.tenant_id]);
      return { certificates: r.rows };
    });
  });
  app.post('/certificates', { preHandler: require('owner','principal','itadmin','coordinator') }, async (req, reply) => {
    const { kind, studentId, body } = req.body ?? {};
    if (!studentId) return bad(reply, 'studentId is required');
    const k = String(kind ?? 'bonafide');
    if (!['transfer','bonafide','character','study','other'].includes(k)) return bad(reply, 'unknown certificate kind');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const stu = (await c.query(`SELECT id, name FROM app.students WHERE id=$1 AND tenant_id=$2`, [studentId, req.user.tenant_id])).rows[0];
      if (!stu) return bad(reply, 'student not found', 404);
      const serial = `CERT-${k.slice(0, 3).toUpperCase()}-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const cert = await c.query(
        `INSERT INTO app.certificates (tenant_id, kind, student_id, serial, body, status, created_by)
         VALUES ($1,$2,$3,$4,$5,'pending_approval',$6) RETURNING *`,
        [req.user.tenant_id, k, studentId, serial, body ?? null, req.user.id]);
      // Signing is consequential → a principal-owned kernel action (proposer ≠ approver).
      const act = await c.query(
        `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_plugin, payload)
         VALUES ($1,$2,'approval',$3,$4,$5,'normal','open','Principal','principal','Certificates §1',false,'certificates',$6::jsonb) RETURNING id`,
        [req.user.tenant_id, `certificates.sign.${cert.rows[0].id}`,
         `Sign ${k} certificate for ${stu.name}`,
         `Serial ${serial}. Approve to issue the signed certificate.`,
         'A signed certificate is a school attestation — the principal authorises it before issue.',
         JSON.stringify({ certificateId: cert.rows[0].id, studentId, kind: k, proposed_by: req.user.id, proposed_by_role: req.user.role })]);
      await c.query(`UPDATE app.certificates SET action_id=$2 WHERE id=$1`, [cert.rows[0].id, act.rows[0].id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Certificate requested: ${k} for ${stu.name}`, recordType: 'Certificate', recordRef: cert.rows[0].id, reason: 'certificate request', policyRef: 'Certificates §1', risk: 'low', outcome: `action ${act.rows[0].id} raised for principal` });
      return { certificate: { ...cert.rows[0], action_id: act.rows[0].id } };
    });
  });
  app.post('/certificates/:id/sign', { preHandler: require('owner','principal') }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const cert = (await c.query(`SELECT * FROM app.certificates WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!cert) return bad(reply, 'not found', 404);
      if (cert.status !== 'pending_approval') return bad(reply, `certificate already ${cert.status}`, 409);
      if (!cert.action_id) return bad(reply, 'this certificate has no signing action — re-request it', 409);
      // OVR-9: signing decides the raised action rather than bypassing it, so the action can never
      // be left open and the proposer cannot sign their own request (owner override excepted).
      const act = (await c.query(`SELECT * FROM app.actions WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [cert.action_id, req.user.tenant_id])).rows[0];
      if (!act) return bad(reply, 'the signing action is missing — re-request the certificate', 409);
      if (act.status !== 'open') return bad(reply, `the signing action is already ${act.status}`, 409);
      const proposedBy = act.payload && typeof act.payload === 'object' ? act.payload.proposed_by : null;
      if (proposedBy && proposedBy === req.user.id && req.user.role !== 'owner')
        return bad(reply, 'self-approval is not permitted (segregation of duties)', 403);
      await c.query(`UPDATE app.actions SET status='approved', decided_by=$2, decided_at=now(), decision_note=$3 WHERE id=$1`,
        [act.id, req.user.id, 'certificate signed']);
      const issued = await issueCertificate(c, req, cert);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Certificate signed: ${cert.kind} ${cert.serial}`, recordType: 'Certificate', recordRef: cert.id, reason: 'principal signature', policyRef: 'Certificates §1', risk: 'medium', outcome: 'issued' });
      return { certificate: issued };
    });
  });
  // OPP-DAT-9 · the rendered certificate artifact (private-store download by id).
  app.get('/certificates/:id/artifact', { preHandler: [require('owner','principal','coordinator','finance','finance_head','itadmin'), uuidParams('id')] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const cert = (await c.query(`SELECT id, artifact_ref FROM app.certificates WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!cert) return bad(reply, 'not found', 404);
      if (!cert.artifact_ref) return bad(reply, 'no artifact has been generated for this certificate yet', 409);
      const file = (await c.query(`SELECT id, filename, mime, storage_path, sha256 FROM app.files WHERE id=$1 AND tenant_id=$2`, [cert.artifact_ref, req.user.tenant_id])).rows[0];
      if (!file) return bad(reply, 'artifact not found', 404);
      return { artifact: { id: file.id, filename: file.filename, mime: file.mime, sha256: file.sha256 } };
    });
  });

  // OPP-PRD-12 · the school constitution policy store (versioned, audited — no longer read-only).
  const POLICY_ROLES = ['owner', 'principal', 'itadmin', 'coordinator', 'teacher', 'finance', 'finance_head', 'finance_clerk'];
  app.get('/policy-documents', { preHandler: require(...POLICY_ROLES) }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `SELECT id, ref, title, category, body, version, updated_at FROM app.policy_documents
          WHERE tenant_id=$1 ORDER BY category, ref`, [req.user.tenant_id]);
      return { policies: r.rows };
    });
  });
  app.post('/policy-documents', { preHandler: require('owner', 'principal', 'itadmin') }, async (req, reply) => {
    const { ref, title, category, body } = req.body ?? {};
    if (!ref || !title || !body) return bad(reply, 'ref, title and body are required');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `INSERT INTO app.policy_documents (tenant_id, ref, title, category, body, version, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,1,$6,now())
         ON CONFLICT (tenant_id, ref) DO UPDATE
           SET title=EXCLUDED.title, category=EXCLUDED.category, body=EXCLUDED.body,
               version=app.policy_documents.version+1, updated_by=EXCLUDED.updated_by, updated_at=now()
         RETURNING *`,
        [req.user.tenant_id, String(ref).slice(0, 120), String(title).slice(0, 200), String(category ?? 'school').slice(0, 60), String(body).slice(0, 20000), req.user.id]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Policy saved: ${title}`, recordType: 'Policy', recordRef: r.rows[0].ref, reason: 'constitution edit', policyRef: 'Governance §1', risk: 'medium', outcome: `version ${r.rows[0].version}` });
      await emitEvent(c, req.user.tenant_id, { type: 'governance', label: `Policy updated: ${title} (v${r.rows[0].version})`, ref: r.rows[0].ref });
      return { policy: r.rows[0] };
    });
  });

  // OPP-PRD-11 · staff appraisals (per staff, per cycle; draft → shared → acknowledged).
  app.get('/staff/appraisals', { preHandler: require('owner', 'principal', 'itadmin') }, async (req) => {
    const cycle = req.query.cycle ? String(req.query.cycle) : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT a.id, a.staff_user_id, u.name AS staff_name, u.role AS staff_role, a.cycle,
                a.rating, a.strengths, a.improvements, a.status, a.updated_at
           FROM app.staff_appraisals a
           JOIN app.users u ON u.id = a.staff_user_id AND u.tenant_id = a.tenant_id
          WHERE a.tenant_id=$1 AND ($2::text IS NULL OR a.cycle=$2)
          ORDER BY u.name`, [req.user.tenant_id, cycle])).rows;
      const staff = (await c.query(
        `SELECT id, name, role FROM app.users
          WHERE tenant_id=$1 AND active AND role NOT IN ('parent','student','owner') ORDER BY name`, [req.user.tenant_id])).rows;
      return { appraisals: rows, staff };
    });
  });
  app.post('/staff/appraisals', { preHandler: require('owner', 'principal') }, async (req, reply) => {
    const { staffUserId, cycle, rating, strengths, improvements, status } = req.body ?? {};
    if (!staffUserId || !cycle) return bad(reply, 'staffUserId and cycle are required');
    if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) return bad(reply, 'rating must be 1..5');
    const st = ['draft', 'shared', 'acknowledged'].includes(status) ? status : 'draft';
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(
        `INSERT INTO app.staff_appraisals (tenant_id, staff_user_id, cycle, rating, strengths, improvements, reviewer_id, status, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
         ON CONFLICT (tenant_id, staff_user_id, cycle) DO UPDATE
           SET rating=EXCLUDED.rating, strengths=EXCLUDED.strengths, improvements=EXCLUDED.improvements,
               reviewer_id=EXCLUDED.reviewer_id, status=EXCLUDED.status, updated_at=now()
         RETURNING *`,
        [req.user.tenant_id, staffUserId, String(cycle).slice(0, 40), rating ?? null,
         strengths ? String(strengths).slice(0, 4000) : null, improvements ? String(improvements).slice(0, 4000) : null, req.user.id, st]);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `Appraisal saved (${st})`, recordType: 'Appraisal', recordRef: r.rows[0].id, reason: 'staff appraisal', policyRef: 'People §2', risk: 'medium', outcome: `cycle ${cycle} · rating ${rating ?? '—'}` });
      return { appraisal: r.rows[0] };
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
  // B-4: a free-text `class_applied` ("Grade 6", "Class 6", "6") must not become a student
  // row whose grade is the literal string "Grade 6". Shared normaliser (A8) — the funnel
  // capacity guard uses the same definition, so a seat counted is a seat created.
  const parseClassApplied = parseGradeApplied;
  const executeStudentCreation = async (c, req, a, p) => {
    const lead = (await c.query(
      `SELECT id, student_name, class_applied, guardian_name, guardian_phone, stage, dob, admission_year
       FROM plugin_admissions.lead WHERE id=$1 FOR UPDATE`, [p.leadId])).rows[0];
    if (!lead) throw Object.assign(new Error('the admissions lead behind this approval no longer exists'), { statusCode: 409 });
    const existing = (await c.query(
      `SELECT id, name FROM app.students WHERE tenant_id=$1 AND source='admissions' AND source_ref=$2`,
      [req.user.tenant_id, String(p.leadId)])).rows[0];
    if (existing) return { type: 'student', id: existing.id, name: existing.name, already: true };
    if (lead.stage !== 'enrolled') throw Object.assign(new Error(`lead is "${lead.stage}", not "enrolled" — conversion stale`), { statusCode: 409 });
    const { grade, section } = parseClassApplied(lead.class_applied);
    // A2: the executor used to skip the guards POST /students enforces (P2-6/P2-8):
    // a free-text class became grade 'unassigned' (invisible everywhere downstream)
    // and a second lead for the same child became a second student. Same rules here.
    {
      const cfg = (await c.query(`SELECT config FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0];
      const parsed = normalizeClasses(cfg?.config?.setup?.sections ?? []);
      if (parsed.ok && parsed.classes.length) {
        const cls = parsed.classes.find((x) => x.grade === grade);
        if (!cls) throw Object.assign(new Error(`"${grade}" is not one of this school's classes — fix the lead's class before converting`), { statusCode: 409 });
        if (!cls.sections.includes(section)) throw Object.assign(new Error(`section "${section}" is not one of ${grade}'s sections — fix the lead's class before converting`), { statusCode: 409 });
      }
      const sameName = (await c.query(
        `SELECT admission_no, grade, section FROM app.students
          WHERE tenant_id=$1 AND lower(name)=lower($2) AND status='active' LIMIT 1`,
        [req.user.tenant_id, String(lead.student_name).trim()])).rows[0];
      if (sameName) throw Object.assign(new Error(`${lead.student_name} is already enrolled (${sameName.admission_no}, ${sameName.grade}-${sameName.section}) — a second lead for the same child cannot become a second student`), { statusCode: 409 });
    }
    // A9: age eligibility — dob captured on the lead, bands configured per grade.
    // Age as on 31 March of the admission year (the Indian norm). No band or no
    // dob means no check (paper process of record).
    if (lead.dob) {
      const bands = (await c.query(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id='admissions.funnel'`,
        [req.user.tenant_id]).catch(() => ({ rows: [] }))).rows[0]?.settings?.age_bands;
      const band = bands && typeof bands === 'object' ? bands[grade] : null;
      if (band && (Number.isFinite(Number(band.min)) || Number.isFinite(Number(band.max)))) {
        const sessYear = /^(20\d{2})/.exec(String(p.admissionYear ?? lead.admission_year ?? ''))?.[1] ?? String(new Date().getFullYear());
        const cutoff = new Date(Date.UTC(Number(sessYear), 2, 31));
        const born = new Date(lead.dob);
        let age = cutoff.getUTCFullYear() - born.getUTCFullYear();
        if (new Date(Date.UTC(cutoff.getUTCFullYear(), born.getUTCMonth(), born.getUTCDate())) > cutoff) age -= 1;
        if ((Number.isFinite(Number(band.min)) && age < Number(band.min)) || (Number.isFinite(Number(band.max)) && age > Number(band.max))) {
          throw Object.assign(new Error(`${lead.student_name} is ${age} on 31 Mar ${sessYear} — outside class ${grade}'s band${band.min != null ? ` (min ${band.min})` : ''}${band.max != null ? ` (max ${band.max})` : ''}`), { statusCode: 409 });
        }
      }
    }
    const ay = /^[0-9]{4}(-[0-9]{2})?$/.test(String(p.admissionYear ?? '')) ? String(p.admissionYear) : String(new Date().getFullYear());
    let s = null;
    await c.query('SAVEPOINT student_insert');
    try {
      // A9: the lead's dob rides into the core student row when present.
      s = await c.query(
        `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone, dob, status, source, source_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active','admissions',$9)
         ON CONFLICT (tenant_id, admission_no) DO NOTHING RETURNING id, name, admission_no`,
        [req.user.tenant_id, `ADM-${ay}-${String(p.leadId).slice(0, 8).toUpperCase()}`, lead.student_name, grade, section, lead.guardian_name, lead.guardian_phone, lead.dob ?? null, String(p.leadId)]);
      await c.query('RELEASE SAVEPOINT student_insert');
    } catch (e) {
      // admission_no collision on the deterministic form → fall back to the full
      // lead uuid (still deterministic, still idempotent via source_ref).
      await c.query('ROLLBACK TO SAVEPOINT student_insert');
      await c.query('RELEASE SAVEPOINT student_insert');
      s = await c.query(
        `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone, dob, status, source, source_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active','admissions',$9)
         ON CONFLICT (tenant_id, admission_no) DO NOTHING RETURNING id, name, admission_no`,
        [req.user.tenant_id, `ADM-${ay}-${String(p.leadId).toUpperCase()}`, lead.student_name, grade, section, lead.guardian_name, lead.guardian_phone, lead.dob ?? null, String(p.leadId)]);
    }
    if (!s.rows[0]) throw Object.assign(new Error('could not allocate an admission number for this conversion'), { statusCode: 409 });
    const student = s.rows[0];
    // F1: link the new student to their student-role user when the name match is unambiguous.
    await linkStudentUser(c, req.user.tenant_id, student.id, student.name);
    let parentLinked = false;
    if (lead.guardian_name && lead.guardian_phone) {
      await c.query(`INSERT INTO app.guardians (tenant_id, student_id, name, phone, relation, is_primary)
                     VALUES ($1,$2,$3,$4,'guardian',true)`, [req.user.tenant_id, student.id, lead.guardian_name, lead.guardian_phone]);
      // E-7: bind an EXISTING parent account to the new student so the family sees the child
      // immediately. The match is structural — the account's stored E.164 phone equals the
      // lead's guardian phone — never name-equality (the P1-4 anti-pattern the roster doors
      // already reject). No matching account means nothing to link: the parent is provisioned
      // through people.admin (which accepts a studentId), not guessed here.
      const parent = (await c.query(
        `SELECT id FROM app.users
          WHERE tenant_id=$1 AND role='parent' AND active=true AND phone=$2
          ORDER BY created_at ASC LIMIT 1`, [req.user.tenant_id, lead.guardian_phone])).rows[0];
      if (parent) {
        await c.query(
          `INSERT INTO family.child_link (tenant_id, user_id, student_id, relation, is_primary)
           VALUES ($1,$2,$3,'guardian',true) ON CONFLICT (tenant_id, user_id, student_id) DO NOTHING`,
          [req.user.tenant_id, parent.id, student.id]);
        parentLinked = true;
      }
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
        + (lead.guardian_name && lead.guardian_phone ? ', primary guardian recorded' : ', no guardian on the lead')
        + (parentLinked ? ', parent account linked (family.child_link)' : ''),
      recordType: 'Student',
      recordRef: student.id,
      policyRef: 'Admissions §3 — lead conversion',
    });
    return { type: 'student', id: student.id, name: student.name, admissionNo: student.admission_no, grade, section };
  };

  // A1: dismissal recovery for admissions conversions. Dismissing a students.create
  // action used to strand the lead at `enrolled` — terminal and immutable, with no
  // student and no open action (the health probe's strandedEnrolled). Now the lead
  // returns to `offer` with a history row, so the office can re-raise conversion.
  // Only when the lead is still `enrolled` AND no student was created from it.
  const runConversionDismissalRecovery = async (c, req, a, p, decision, note) => {
    const lead = (await c.query(
      `SELECT id, stage FROM plugin_admissions.lead WHERE id=$1 FOR UPDATE`, [p.leadId])).rows[0];
    if (!lead || lead.stage !== 'enrolled') return undefined;
    const made = (await c.query(
      `SELECT 1 FROM app.students WHERE tenant_id=$1 AND source='admissions' AND source_ref=$2`,
      [req.user.tenant_id, String(p.leadId)])).rows[0];
    if (made) return undefined;
    await c.query(`UPDATE plugin_admissions.lead SET stage='offer', updated_at=now() WHERE id=$1 AND tenant_id=$2`,
      [p.leadId, req.user.tenant_id]);
    try {
      await c.query(`INSERT INTO plugin_admissions.stage_history (tenant_id, lead_id, from_stage, to_stage, actor, reason)
        VALUES ($1,$2,'enrolled','offer',$3,$4)`,
        [req.user.tenant_id, p.leadId, req.user.email, (note ?? '').slice(0, 300) || 'conversion dismissed — returned to offer for rework']);
    } catch {
      await c.query(`INSERT INTO plugin_admissions.stage_history (tenant_id, lead_id, from_stage, to_stage, actor)
        VALUES ($1,$2,'enrolled','offer',$3)`, [req.user.tenant_id, p.leadId, req.user.email]);
    }
    return { type: 'lead-recovery', id: p.leadId, status: 'reopened-to-offer' };
  };

  /* OVR-5 · the decide-executor registry. Each entry is a typed side-effect keyed by a `when`
     predicate; adding an action kind is ONE entry here (with its own test) rather than another branch
     in a growing if/else. `run` returns the `execution` descriptor, or undefined to leave it alone. */
  const runMessageExecutor = async (c, req, a, p) => {
    // PRD-17: QUEUE it. The dispatcher owns delivery and records it honestly; this door must not
    // pre-empt or claim that verdict.
    const audienceLabel = String(p.audience ?? 'guardians');
    const recipients = await resolveNoticeRecipients(c, req.user.tenant_id, p);
    if (recipients.length === 0) {
      await emitEvent(c, req.user.tenant_id, {
        type: 'comms', severity: 'warn',
        label: `Parent notice approved but NOT sent — no contactable recipients could be resolved for "${audienceLabel}" (${p.template ?? 'message'}, approved by ${req.user.name}). Record it as unsent and act at the desk.`,
      });
      return { type: 'communication', id: null, status: 'unaddressed', recipients: 0, audience: audienceLabel };
    }
    if (recipients.length > 500) {
      // RTE-1: this runs AFTER the status flip. Throw so `withUser` rolls the whole tx back and the
      // error handler turns the statusCode into a 413 — a `return bad()` would persist the approval.
      throw Object.assign(new Error('This notice has more than 500 recipients. Split the audience into smaller notices before approving it.'), { statusCode: 413 });
    }
    const comm = await c.query(
      `INSERT INTO app.communications (tenant_id, audience_json, channel, template, body, status, policy_ref, approved_by)
       VALUES ($1, $2::jsonb, $3, $4, $5, 'queued', $6, $7) RETURNING *`,
      [req.user.tenant_id, JSON.stringify(recipients), p.channel ?? 'WhatsApp', p.template ?? null,
       p.draft ?? a.detail, a.policy_ref, req.user.id]);
    await emitEvent(c, req.user.tenant_id, { type: 'comms', label: `Parent notice approved and QUEUED to ${recipients.length} guardian${recipients.length === 1 ? '' : 's'} — ${audienceLabel} (${p.template ?? 'message'}, approved by ${req.user.name})`, ref: comm.rows[0].id });
    return { type: 'communication', id: comm.rows[0].id, status: 'queued', recipients: recipients.length, audience: audienceLabel };
  };
  const runTaskExecutor = async (c, req, a, p) => {
    const n = await c.query(
      `INSERT INTO app.notifications (tenant_id, "group", title, body, ref) VALUES ($1,'needs-you',$2,$3,$4) RETURNING id`,
      [req.user.tenant_id, p.title ?? a.title, p.body ?? a.detail, a.code]);
    return { type: 'notification', id: n.rows[0].id };
  };
  const runChildLeaveApproved = async (c, req, a, p) => {
    const fr = (await c.query(
      `SELECT id, child_id, payload, status FROM family.request WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
      [p.requestId, req.user.tenant_id])).rows[0];
    if (!fr || fr.status === 'resolved' || fr.status === 'closed') return undefined;
    await c.query(`SELECT set_config('schoolos.family_request_transition', 'on', true)`);
    await c.query(`UPDATE family.request SET status='resolved' WHERE id=$1`, [fr.id]);
    await c.query(
      `INSERT INTO family.request_event (tenant_id, request_id, from_status, to_status, note, actor_id)
       VALUES ($1,$2,$3,'resolved','leave approved — attendance marked',$4)`,
      [req.user.tenant_id, fr.id, fr.status, req.user.id]);
    const dates = Array.isArray(fr.payload?.dates) ? fr.payload.dates
      : String(fr.payload?.dates ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    let days = 0;
    if (fr.child_id) {
      for (const d of dates) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) continue;
        const u = await c.query(
          `INSERT INTO app.attendance (tenant_id, student_id, school_date, status, marked_by)
           VALUES ($1,$2,$3::date,'leave',$4)
           ON CONFLICT (tenant_id, student_id, school_date) DO UPDATE SET status='leave', marked_by=EXCLUDED.marked_by`,
          [req.user.tenant_id, fr.child_id, d, req.user.id]);
        days += u.rowCount;
      }
    }
    return { type: 'child_leave', id: fr.id, status: 'resolved', days };
  };
  const runChildLeaveDismissed = async (c, req, a, p) => {
    const fr = (await c.query(
      `SELECT id, status FROM family.request WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
      [p.requestId, req.user.tenant_id])).rows[0];
    if (!fr || fr.status === 'resolved' || fr.status === 'closed') return undefined;
    await c.query(`SELECT set_config('schoolos.family_request_transition', 'on', true)`);
    await c.query(`UPDATE family.request SET status='closed' WHERE id=$1`, [fr.id]);
    await c.query(
      `INSERT INTO family.request_event (tenant_id, request_id, from_status, to_status, note, actor_id)
       VALUES ($1,$2,$3,'closed','leave not approved',$4)`,
      [req.user.tenant_id, fr.id, fr.status, req.user.id]);
    return { type: 'child_leave', id: fr.id, status: 'closed' };
  };
  const runCertificateExecutor = async (c, req, a, p) => {
    // OPP-PRD-7/OVR-9: deciding the principal-owned signing action issues the certificate and renders
    // its artifact — the SAME helper the direct sign door uses.
    const cert = (await c.query(
      `SELECT * FROM app.certificates WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
      [p.certificateId, req.user.tenant_id])).rows[0];
    if (!cert || cert.status !== 'pending_approval') return undefined;
    const issued = await issueCertificate(c, req, cert);
    return { type: 'certificate', id: issued.id, status: 'issued' };
  };
  const runStudentCreationExecutor = async (c, req, a, p) => executeStudentCreation(c, req, a, p);
  const runTeacherLeaveOutcome = async (c, req, a, p, decision, note) => {
    const approved = decision === 'approved';
    const n = await c.query(
      `INSERT INTO app.notifications (tenant_id, user_id, "group", title, body, ref)
       VALUES ($1,$2,'needs-you',$3,$4,$5) RETURNING id`,
      [req.user.tenant_id, p.teacherId,
       approved ? 'Your leave was approved' : 'Your leave was not approved',
       `Your staff leave request was ${approved ? 'approved' : 'declined'}${note ? ` — ${String(note).slice(0, 200)}` : ''}.`,
       a.code]);
    let execution = { type: 'leave_outcome_notification', id: n.rows[0].id, decision };
    if (approved && p.leaveRequestId) {
      try {
        // I1: read the dates as TEXT. `pg` returns a `date` column as a JS Date, so the old
        // `${lr.from_date}T00:00:00Z` template built "Tue Sep 29 2026 …T00:00:00Z" → Invalid Date →
        // the weekday loop never ran → 0 periods. to_char gives the YYYY-MM-DD the code assumes.
        const lr = (await c.query(
          `SELECT id, teacher_id, to_char(from_date,'YYYY-MM-DD') AS from_date, to_char(to_date,'YYYY-MM-DD') AS to_date
             FROM teacher.leave_request WHERE id=$1 AND tenant_id=$2`,
          [p.leaveRequestId, req.user.tenant_id])).rows[0];
        if (lr) {
          // I3: project the decision into the row HERE, so the DB and the authoritative app.actions row
          // agree immediately rather than waiting for the teacher's next poll. Idempotent on 'pending';
          // the transition is audited once (the lazy GET projection then sees no pending row and is a no-op).
          const projected = await c.query(
            `UPDATE teacher.leave_request SET status=$2, decided_by=$3, decided_at=now()
              WHERE id=$1 AND status='pending'`,
            [lr.id, approved ? 'approved' : 'rejected', req.user.id]);
          if (projected.rowCount === 1) {
            await auditLog(c, req.user.tenant_id, {
              actor: req.user.name ?? 'system', actorRole: req.user.role,
              action: 'Leave decision projected onto request', recordType: 'LeaveRequest', recordRef: lr.id,
              reason: `kernel action ${a.code} decided ${decision}`,
              policyRef: 'Platform §2.4 (identity & access) · approvals', risk: 'medium',
              outcome: `teacher.leave_request.status set to "${approved ? 'approved' : 'rejected'}" from the kernel decision; the app.actions row remains the authority`,
            });
          }
          const hasPacket = (await c.query(`SELECT to_regclass('teacher.handover_packet') AS t`)).rows[0].t;
          if (approved && hasPacket) {
            const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const days = [];
            const dateList = []; // L6: each calendar day of the leave, with its weekday
            const end = new Date(`${lr.to_date}T00:00:00Z`);
            for (let d = new Date(`${lr.from_date}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
              const wd = WD[d.getUTCDay()];
              if (!days.includes(wd)) days.push(wd);
              dateList.push({ date: d.toISOString().slice(0, 10), wd });
            }
            const teacher = (await c.query(`SELECT name FROM app.users WHERE id=$1`, [lr.teacher_id])).rows[0];
            const hasSlots = (await c.query(`SELECT to_regclass('app.timetable_slots') AS t`)).rows[0].t;
            const classes = [];
            const assignments = []; // L6: {slot_id, date, substitute} — the coordinator's cover proposal
            if (hasSlots && teacher) {
              const hasPeriods = (await c.query(`SELECT to_regclass('app.timetable_periods') AS t`)).rows[0].t;
              // I2: match cover by the stable teacher_id (M4), not the free-text teacher_name.
              const slots = (await c.query(
                `SELECT s.id AS slot_id, s.teacher_name, s.subject, s.room, s.day_of_week${hasPeriods ? ', p.seq, p.start_time, p.end_time' : ''}
                 FROM app.timetable_slots s${hasPeriods ? ' LEFT JOIN app.timetable_periods p ON p.id = s.period_id' : ''}
                 WHERE s.tenant_id=$1 AND s.teacher_id=$2 AND s.day_of_week = ANY($3::text[])
                 ORDER BY ${hasPeriods ? 'p.sort_idx' : 's.subject'}`,
                [req.user.tenant_id, lr.teacher_id, days])).rows;
              const hasLesson = (await c.query(`SELECT to_regclass('teacher.lesson') AS t`)).rows[0].t;
              // L6: one deterministic suggestion per (teacher_name, weekday), from the SAME ranking the
              // ops.timetable suggest door offers the desk — never a second, drifting ranking.
              const topBySlot = new Map();
              const seenPairs = new Set();
              for (const s of slots) {
                const key = `${s.day_of_week}\u0000${s.teacher_name}`;
                if (seenPairs.has(key)) continue;
                seenPairs.add(key);
                try {
                  const { suggestions } = await substitutionSuggestions(c, req.user.tenant_id,
                    { absentTeacher: s.teacher_name, dayOfWeek: s.day_of_week });
                  for (const sug of suggestions) topBySlot.set(sug.slot.id, sug.candidates[0]?.teacher ?? null);
                } catch { /* ranking is best-effort — a slot with no pick stays unassigned */ }
              }
              for (const s of slots) {
                let lastTopic = null;
                if (hasLesson) {
                  lastTopic = (await c.query(
                    `SELECT topic FROM teacher.lesson WHERE teacher_id=$1 AND subject=$2 ORDER BY lesson_date DESC, created_at DESC LIMIT 1`,
                    [lr.teacher_id, s.subject])).rows[0]?.topic ?? null;
                }
                classes.push({
                  class_grade: null,
                  period: s.seq != null ? `P${s.seq}` : (s.start_time ?? '—'),
                  subject: s.subject,
                  room: s.room ?? '—',
                  note: lastTopic ? `Last topic: ${lastTopic}. Continue from there; leave independent practice.` : 'No lesson plan on file — cover the next topic from the curriculum.',
                });
                const substitute = topBySlot.get(s.slot_id) ?? null;
                for (const dt of dateList) {
                  if (dt.wd === s.day_of_week) assignments.push({ slot_id: s.slot_id, date: dt.date, substitute });
                }
              }
            }
            await c.query(
              `INSERT INTO teacher.handover_packet (tenant_id, leave_request_id, teacher_id, classes)
               VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (leave_request_id) DO NOTHING`,
              [req.user.tenant_id, lr.id, lr.teacher_id, JSON.stringify(classes)]);
            // L6: raise the coordinator-owned substitution PROPOSAL so the cover decision has a desk.
            // The proposal carries every affected {slot, date} pair and a deterministic suggested
            // substitute; approving it (POST /coord/substitution/decide) writes the substitution rows and
            // stamps the handover packet. proposed_by is the absent teacher, so proposer≠decider holds.
            const proposedCount = assignments.filter((x) => x.substitute).length;
            const subCode = `teacher.leave.sub.${lr.id}`;
            let subActionId = null;
            if (assignments.length) {
              const ins = await c.query(
                `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, source_event, payload, source_plugin)
                 VALUES ($1,$2,'substitution',$3,$4,$5,'normal','open','Coordinator','coordinator','TEACHEROS-PLAN · staff leave · cover proposal',false,$6,$7::jsonb,'teacher.classroom')
                 ON CONFLICT (tenant_id, code) DO NOTHING RETURNING id`,
                [req.user.tenant_id, subCode,
                 `Cover needed: ${teacher?.name ?? 'a teacher'} (${lr.from_date} → ${lr.to_date})`,
                 `${assignments.length} timetabled period${assignments.length === 1 ? '' : 's'} across the approved leave${proposedCount ? `; ${proposedCount} with a proposed substitute from the timetable` : ''}.`,
                 'An approved leave leaves timetabled periods uncovered — the coordinator decides the cover (proposer can never approve their own).',
                 lr.id,
                 JSON.stringify({ kind: 'substitution', leaveRequestId: lr.id, teacherId: lr.teacher_id, teacherName: teacher?.name ?? null,
                   days, assignments, proposed_by: lr.teacher_id, proposed_by_role: 'teacher' })]);
              subActionId = ins.rows[0]?.id
                ?? (await c.query(`SELECT id FROM app.actions WHERE tenant_id=$1 AND code=$2`, [req.user.tenant_id, subCode])).rows[0]?.id
                ?? null;
            }
            await c.query(
              `INSERT INTO app.notifications (tenant_id, "group", title, body, ref)
               VALUES ($1,'needs-you',$2,$3,$4)`,
              [req.user.tenant_id, `Cover needed: ${teacher?.name ?? 'a teacher'}`,
               `Leave approved — ${assignments.length || classes.length} period${(assignments.length || classes.length) === 1 ? '' : 's'} need cover. A handover note and a cover proposal are ready.`, subCode]);
            execution = { type: 'leave_handover', id: lr.id, periods: classes.length, substitutionAction: subActionId };
          }
        }
      } catch { /* best-effort packet; approval stands */ }
    }
    return execution;
  };
  const EXECUTORS = [
    { name: 'message', when: (a, p, d) => d === 'approved' && p.kind === 'message', run: runMessageExecutor },
    { name: 'task', when: (a, p, d) => d === 'approved' && p.kind === 'task', run: runTaskExecutor },
    { name: 'parent.leave.approved', when: (a, p, d) => d === 'approved' && a.code.startsWith('parent.leave.') && p.requestId, run: runChildLeaveApproved },
    { name: 'parent.leave.dismissed', when: (a, p, d) => d === 'dismissed' && a.code.startsWith('parent.leave.') && p.requestId, run: runChildLeaveDismissed },
    { name: 'certificates.sign', when: (a, p, d) => d === 'approved' && a.code.startsWith('certificates.sign.') && p.certificateId, run: runCertificateExecutor },
    { name: 'students.create', when: (a, p, d) => d === 'approved' && a.code.startsWith('students.create.') && p.leadId != null, run: runStudentCreationExecutor },
    { name: 'students.create.dismissed', when: (a, p, d) => d === 'dismissed' && a.code.startsWith('students.create.') && p.leadId != null, run: runConversionDismissalRecovery },
    { name: 'teacher.leave.outcome', when: (a, p) => a.code.startsWith('teacher.leave.') && p.teacherId, run: runTeacherLeaveOutcome },
  ];

  app.post('/actions/:id/decide', { preHandler: require('owner','principal','itadmin','finance','finance_head','finance_clerk','coordinator','teacher','admissions','transport','facilities','technician') }, async (req, reply) => {
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
      // OPP-OVR-1: the principal's broad non-finance authority deliberately EXCLUDES owner-owned actions —
      // those are the owner's alone.
      // OVR-8: the finance exclusion is the whole finance TIER, not the literal 'finance' string —
      // the reconciliation desk raises owner_role='finance_head', which the old check let the
      // principal decide. The owner override is unaffected.
      const FINANCE_TIER = ['finance', 'finance_head', 'finance_clerk'];
      let ownerOk = a.owner_role === req.user.role
        || req.user.role === 'owner'
        || (req.user.role === 'principal' && !FINANCE_TIER.includes(a.owner_role) && a.owner_role !== 'owner');
      /* OPP-OVR-2: bounded delegation. A role may hand its approval authority to a named deputy for a
         window (vacation cover). Delegation is deliberately NARROWER than the role: it never confers the
         owner override, and it never applies to finance-owned actions (SoD). A delegate's decision is
         stamped as delegated in the audit row below. */
      let delegated = null;
      if (!ownerOk) {
        const d = (await c.query(
          `SELECT id, from_role, to_role, scope_role FROM app.action_delegations
            WHERE tenant_id=$1 AND to_user_id=$2 AND starts_at <= now() AND ends_at > now()
              AND (scope_role IS NULL OR scope_role = $3)
              AND from_role = $3
            ORDER BY ends_at DESC LIMIT 1`,
          [req.user.tenant_id, req.user.id, a.owner_role])).rows[0];
        if (d && !FINANCE_TIER.includes(a.owner_role) && a.owner_role !== 'owner') { ownerOk = true; delegated = d; }
      }
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
      const systemRaised = a.payload && typeof a.payload === 'object' && a.payload.raised_by_system === true;
      // OVR-4: generalised — ANY unattributed raise (no named proposer and not a system/worker
      // raise) cannot be self-approved by its owning desk; the owner remains the backstop. Every
      // human raise site stamps `proposed_by`; a system sweep stamps `raised_by_system:true`.
      const unattributed = proposedBy == null && !systemRaised;
      if (decision === 'approved' && unattributed && req.user.role === a.owner_role && req.user.role !== 'owner') {
        return bad(reply, 'Segregation of duties — this proposal was raised without an attributable proposer, so the owning desk cannot approve it. Ask the school owner to decide.', 403);
      }
      // OPP-OVR-1: owner-owned actions are exempt — there is no authority above the owner to propose to
      // them, so the owner may decide an action they raised. Every other desk keeps proposer≠approver.
      if (a.owner_role !== 'owner' && a.payload && typeof a.payload === 'object' && a.payload.proposed_by === req.user.id && decision === 'approved')
        return bad(reply, 'self-approval is not permitted (segregation of duties)', 403);
      await c.query(`UPDATE app.actions SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1`,
        [a.id, decision, req.user.id, note ?? null]);
      let execution = null;
      const p = a.payload ?? {};
      for (const ex of EXECUTORS) {
        if (ex.when(a, p, decision)) {
          const r = await ex.run(c, req, a, p, decision, note);
          if (r !== undefined) execution = r;
        }
      }
      // C5: lineage on the decide path. The raise sites link event→action; without this the lineage
      // spine went sparse the moment a decision happened. Best-effort via a SAVEPOINT so a lineage
      // failure can never abort the decision transaction (a bare try/catch left it aborted → 25P02).
      // `relation` must be one of the table's CHECK values ('raised','triggered','notified','resolved').
      try {
        await c.query('SAVEPOINT lineage');
        const decisionEvent = await emitEvent(c, req.user.tenant_id,
          { type: 'governance', label: `Action ${decision}: ${a.title}`, ref: a.code },
          'action.decided.v1',
          { actionId: a.id, code: a.code, decision, ownerRole: a.owner_role, delegated: delegated?.id ?? null });
        await linkLineage(c, req.user.tenant_id, { eventId: decisionEvent.id, actionId: a.id, relation: 'resolved', policyRef: a.policy_ref });
        await c.query('RELEASE SAVEPOINT lineage');
      } catch {
        await c.query('ROLLBACK TO SAVEPOINT lineage').catch(() => {});
      }
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: `${decision === 'approved' ? 'Approved' : 'Dismissed'} action: ${a.title}${delegated ? ' (delegated)' : ''}`, recordType: 'Action', recordRef: a.code, reason: note ?? (delegated ? `decided under delegation from ${delegated.from_role}` : 'decided in Action Center'), policyRef: a.policy_ref, aiInvolved: a.ai_involved, risk: 'medium', outcome: execution ? `executed: ${execution.type} ${execution.id ?? execution.status}` : 'no execution' });
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

  app.post('/payments/:id/refund', { preHandler: [require('owner', 'finance', 'finance_head', 'finance_clerk'), uuidParams('id')] }, async (req, reply) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.params.id))) return bad(reply, 'payment id must be a uuid');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const p = (await c.query(`SELECT * FROM app.payments WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!p) return moneyError(reply, 'NOT_FOUND', 'payment not found');
      if (p.status === 'refunded') return moneyError(reply, 'CONFLICT', 'payment already refunded');
      if (p.status !== 'confirmed') return moneyError(reply, 'PAYMENT_NOT_CONFIRMED', `only confirmed payments can be refunded (this one is ${p.status})`);
      const refundable = BigInt(p.amount_cents) - BigInt(p.refunded_cents ?? 0);
      // FEE-API-4: partial refunds. Default is the full remaining amount; a caller may refund less.
      let refundCents = refundable;
      if (req.body?.refundCents != null) {
        if (!Number.isInteger(req.body.refundCents) || req.body.refundCents <= 0) return moneyError(reply, 'VALIDATION_FAILED', 'refundCents must be a positive integer (paise)');
        refundCents = BigInt(req.body.refundCents);
        if (refundCents > refundable) return moneyError(reply, 'CONFLICT', 'refund exceeds the refundable amount');
      }
      // FEE-SEC-1 / FEE-SEC-4: separation of duties + a mandatory reason for material reversals.
      // FEE-SEC-9: the threshold is a per-tenant setting, not the hardcoded constant.
      const settings = await feeSettings(c, req.user.tenant_id);
      const isFullRefund = refundCents >= refundable;
      // Tenant refund policy: partial on/off, window, head refundability.
      if (!isFullRefund && settings.refund_partial_allowed === false) {
        return moneyError(reply, 'VALIDATION_FAILED', 'partial refunds are disabled for this school — refund the full remaining amount');
      }
      if (settings.refund_require_reason === true && !reason) {
        return moneyError(reply, 'VALIDATION_FAILED', 'a reason is required for every refund at this school');
      }
      const windowDays = Math.max(0, Math.trunc(Number(settings.refund_window_days) || 0));
      if (windowDays > 0 && p.confirmed_at) {
        const ageMs = Date.now() - new Date(p.confirmed_at).getTime();
        if (ageMs > windowDays * 864e5) return moneyError(reply, 'VALIDATION_FAILED', `refunds are allowed within ${windowDays} days of confirmation at this school`);
      }
      const material = isFullRefund && BigInt(p.amount_cents) >= BigInt(settings.refund_approval_threshold_cents);
      if (material) {
        if (req.user.role === 'finance_clerk') return reply.code(403).send({ error: 'This refund needs a checker (finance head, principal or owner) — a maker cannot approve their own reversal', code: 'SOD_REQUIRED' });
        if (p.settled_by && p.settled_by === req.user.id && req.user.role !== 'owner') return reply.code(403).send({ error: 'A refund cannot be approved by the person who settled the payment', code: 'SOD_REQUIRED' });
        if (!reason) return moneyError(reply, 'VALIDATION_FAILED', 'a reason is required for a refund at or above the approval threshold');
      }
      // RTE-2: read and validate the obligations BEFORE the gateway call. This guard used to run AFTER it, so
      // an inconsistent ledger let real money leave the gateway while the door returned 409 with the ledger
      // untouched. A refund must be provably representable in the ledger before it is sent. Never floor an
      // inconsistent ledger to zero: a refund is safe only when this payment is still represented in the
      // obligation(s) it allocated to. FEE-PRD-10: pay-many payments reverse their allocations.
      const allocRows = (await c.query(
        `SELECT obligation_id, amount_cents FROM app.payment_allocations WHERE tenant_id=$1 AND payment_id=$2`,
        [req.user.tenant_id, p.id])).rows;
      const targetAllocs = allocRows.length
        ? allocRows
        : (p.obligation_id ? [{ obligation_id: p.obligation_id, amount_cents: p.amount_cents }] : []);
      const locked = new Map();
      for (const a of targetAllocs) {
        let row = null;
        try {
          row = (await c.query(`SELECT id, amount_cents, paid_cents, net_amount_cents, fee_head_id FROM app.fee_obligations WHERE id=$1 FOR UPDATE`, [a.obligation_id])).rows[0];
        } catch (e) {
          if (e.code !== '42703') throw e;
          row = (await c.query(`SELECT id, amount_cents, paid_cents, net_amount_cents FROM app.fee_obligations WHERE id=$1 FOR UPDATE`, [a.obligation_id])).rows[0];
          if (row) row.fee_head_id = null;
        }
        if (row) locked.set(a.obligation_id, row);
      }
      // Per-head refundability: a non-refundable head (e.g. admission fee) blocks the refund.
      // Separate lookup (never FOR UPDATE on the join) so pre-150 databases keep working.
      for (const [, row] of locked) {
        if (!row.fee_head_id) continue;
        const head = await c.query(`SELECT is_refundable, refund_window_days FROM app.fee_heads WHERE id=$1`, [row.fee_head_id]).catch(() => ({ rows: [] }));
        const h = head.rows?.[0];
        if (!h) continue;
        if (h.is_refundable === false) return moneyError(reply, 'VALIDATION_FAILED', 'one of the fee heads in this payment is marked non-refundable for this school');
        const hw = h.refund_window_days == null ? null : Number(h.refund_window_days);
        if (hw !== null && Number.isFinite(hw) && hw >= 0 && p.confirmed_at && (Date.now() - new Date(p.confirmed_at).getTime() > hw * 864e5)) {
          return moneyError(reply, 'VALIDATION_FAILED', 'the refund window for one of the fee heads has passed');
        }
      }
      const reversals = [];
      let toReverse = refundCents;
      for (const a of targetAllocs) {
        if (toReverse <= 0n) break;
        const row = locked.get(a.obligation_id);
        if (!row) continue;
        const take = BigInt(a.amount_cents) < toReverse ? BigInt(a.amount_cents) : toReverse;
        if (BigInt(row.paid_cents) < take) return moneyError(reply, 'LEDGER_INCONSISTENT', 'payment ledger is inconsistent; reconcile the obligation before refunding');
        reversals.push({ id: row.id, take, row });
        toReverse -= take;
      }
      if (toReverse > 0n) return moneyError(reply, 'LEDGER_INCONSISTENT', 'payment ledger is inconsistent; reconcile the obligation before refunding');
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
          const r = await rzpRefund(keyId, keySecret, op.razorpay_payment_id, refundCents);
          if (!r.ok) return moneyError(reply, 'GATEWAY_REFUSED', `gateway refused the refund (HTTP ${r.http}) — ledger untouched`);
          gateway = { mode: 'gateway', refundId: r.refundId, status: r.status };
        }
      }
      // Ledger reversal: reverse exactly the refunded amount across the payment's allocations; a partial
      // refund leaves the payment 'confirmed' with a larger refunded_cents, a full refund flips it to 'refunded'.
      for (const rv of reversals) {
        const newPaid = BigInt(rv.row.paid_cents) - rv.take;
        const net = BigInt(rv.row.net_amount_cents ?? rv.row.amount_cents);
        const newStatus = newPaid <= 0n ? 'open' : (newPaid < net ? 'partial' : 'paid');
        await c.query(`UPDATE app.fee_obligations SET paid_cents=$2, status=$3 WHERE id=$1 AND tenant_id=$4`, [rv.id, newPaid.toString(), newStatus, req.user.tenant_id]);
      }
      const newRefunded = BigInt(p.refunded_cents ?? 0) + refundCents;
      const fullyRefunded = newRefunded >= BigInt(p.amount_cents);
      // FEX-15: record the amount given back in the same statement that flips the status. The column is
      // CHECK-constrained (`refunded_cents <= amount_cents`), so a refund can never overdraw the payment.
      const upd = await c.query(
        `UPDATE app.payments SET status=$5, refunded_at=now(), refund_reason=$2, refund_gateway_ref=$3,
                refunded_cents=$6
         WHERE id=$1 AND tenant_id=$4 RETURNING id, status, refunded_at, refunded_cents`,
        [p.id, reason || null, gateway.refundId ?? gateway.note ?? null, req.user.tenant_id,
         fullyRefunded ? 'refunded' : 'confirmed', newRefunded.toString()]);
      if (fullyRefunded) {
        await c.query(`UPDATE app.fee_receipts SET voided_at=now() WHERE tenant_id=$1 AND payment_id=$2 AND voided_at IS NULL`, [req.user.tenant_id, p.id]);
      }
      await recordPaymentEvent(c, req.user.tenant_id, { paymentId: p.id, kind: 'refunded', actor: req.user.name, actorRole: req.user.role, source: gateway.mode, amountCents: refundCents, payload: { reason, refundGatewayRef: gateway.refundId ?? null, partial: !fullyRefunded } });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Refunded payment', recordType: 'Payment', recordRef: p.id, reason: reason || 'owner/finance refund', policyRef: 'Fees §4.2', risk: 'high', outcome: `₹${Number(refundCents) / 100} ${fullyRefunded ? 'fully' : 'partially'} refunded via ${gateway.mode}${gateway.refundId ? ` (${gateway.refundId})` : ''} — ${reversals.length ? `${reversals.length} obligation allocation(s) reversed` : 'no linked obligation — payment status only (no ledger entry to reverse)'}` });
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `payment.refunded — ₹${Number(refundCents) / 100} (${gateway.mode})`, ref: p.id });
      return { payment: upd.rows[0], gateway, refundedCents: Number(refundCents) };
    });
  });

  app.post('/payments/reconcile', { preHandler: require('owner', 'finance', 'finance_head', 'finance_clerk') }, async (req, reply) => {
    // Settlement reconciliation sweep: four discrepancy classes between the kernel ledger and the rail's own
    // order_log. The CLASSES live in src/fees/reconcile.js and are shared with the all-tenant worker
    // (FEE-DEL-5). Each finding is emitted as an event, written to the append-only payment trail, audited, and
    // raises ONE owned Action Center card (FEE-SEC-5) so a human is assigned the mismatch.
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!(await feeFeatureGate(c, reply, req.user.tenant_id, 'fees.reconciliation'))) return;
      const settings = await feeSettings(c, req.user.tenant_id);
      const report = await findDiscrepancies(c.query.bind(c), req.user.tenant_id, {
        limit: 50, toleranceCents: settings.reconciliation_tolerance_cents });
      const { ghost, missing, orphan, mismatch } = report;
      const markDisputed = async (id) => c.query(`UPDATE app.payments SET reconciliation_status='disputed' WHERE id=$1 AND tenant_id=$2`, [id, req.user.tenant_id]);
      for (const g of ghost) { await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `reconciliation.discrepancy — confirmed locally, rail says ${g.rail_status} (order ${g.razorpay_order_id})`, ref: g.id }); await recordPaymentEvent(c, req.user.tenant_id, { paymentId: g.id, kind: 'disputed', actor: req.user.name, actorRole: req.user.role, source: 'reconcile', payload: { class: 'ghost', railStatus: g.rail_status } }); await markDisputed(g.id); }
      for (const m of missing) { await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `reconciliation.discrepancy — rail captured, ledger still ${m.ledger_status} (order ${m.razorpay_order_id})`, ref: m.id }); await recordPaymentEvent(c, req.user.tenant_id, { paymentId: m.id, kind: 'disputed', actor: req.user.name, actorRole: req.user.role, source: 'reconcile', payload: { class: 'missing', ledgerStatus: m.ledger_status } }); await markDisputed(m.id); }
      for (const w of orphan) { await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `reconciliation.discrepancy — confirmed with no rail order log entry`, ref: w.id }); await recordPaymentEvent(c, req.user.tenant_id, { paymentId: w.id, kind: 'disputed', actor: req.user.name, actorRole: req.user.role, source: 'reconcile', payload: { class: 'orphan' } }); await markDisputed(w.id); }
      for (const x of mismatch) { await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `reconciliation.discrepancy — amount mismatch: ledger ₹${Number(x.ledger_cents) / 100} vs rail ₹${Number(x.rail_cents) / 100} (order ${x.razorpay_order_id})`, ref: x.id }); await recordPaymentEvent(c, req.user.tenant_id, { paymentId: x.id, kind: 'disputed', actor: req.user.name, actorRole: req.user.role, source: 'reconcile', payload: { class: 'amount_mismatch', ledgerCents: String(x.ledger_cents), railCents: String(x.rail_cents) } }); await markDisputed(x.id); }
      const actionsRaised = await raiseDiscrepancyActions(c.query.bind(c), req.user.tenant_id, report);
      await recordReconRun(c.query.bind(c), req.user.tenant_id,
        { source: 'manual', byUserId: req.user.id, report, actionsRaised });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Ran payment reconciliation sweep', recordType: 'Fees', recordRef: IST_TODAY(), reason: 'ledger vs rail settlement comparison', policyRef: 'Fees §4.2', risk: 'medium', outcome: `${report.total} discrepancy(ies): ghost ${ghost.length} · missing ${missing.length} · orphan ${orphan.length} · amount-mismatch ${mismatch.length} · ${actionsRaised} action(s) assigned to finance_head` });
      return { checked: { confirmedRazorpay: report.total }, discrepancies: { ghostLocalConfirmed: ghost, missingLocalConfirmation: missing, orphanNoRailLog: orphan, amountMismatch: mismatch }, total: report.total, actionsRaised };
    });
  });

  // FEE-SEC-5 decide door: an operator reviews a flagged payment and clears it. Sets reconciliation_status
  // back to 'matched', resolves the owned Action card, and audits — the discrepancy lifecycle is now closed.
  app.post('/payments/:id/mark-matched', { preHandler: [require('owner', 'finance', 'finance_head'), uuidParams('id')] }, async (req, reply) => {
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : '';
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const p = (await c.query(`SELECT id, reconciliation_status FROM app.payments WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!p) return bad(reply, 'payment not found', 404);
      if (p.reconciliation_status === 'matched') return { payment: p, already: true };
      const upd = await c.query(
        `UPDATE app.payments SET reconciliation_status='matched' WHERE id=$1 AND tenant_id=$2
         RETURNING id, reconciliation_status`, [p.id, req.user.tenant_id]);
      await c.query(
        `UPDATE app.actions SET status='resolved', decided_by=$2, decided_at=now(), decision_note=$3
          WHERE tenant_id=$1 AND status='open' AND code LIKE $4`,
        [req.user.tenant_id, req.user.id, note || 'marked matched after operator review', `fee.recon.%.${p.id}`]);
      await recordPaymentEvent(c, req.user.tenant_id, { paymentId: p.id, kind: 'reconciled', actor: req.user.name, actorRole: req.user.role, source: 'reconcile', payload: { note } });
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Marked payment matched', recordType: 'Payment', recordRef: p.id, reason: note || 'operator reconciled the discrepancy', policyRef: 'Fees §4.2', risk: 'medium', outcome: 'reconciliation_status=matched · discrepancy action resolved' });
      await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `reconciliation resolved — payment ${p.id} marked matched`, ref: p.id });
      return { payment: upd.rows[0] };
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
    // Tenant fee settings win; the comms.whatsapp plugin settings remain the fallback so
    // existing tenants keep their quiet hours until they configure fees explicitly.
    const fr = await sysq(`SELECT settings FROM app.fee_settings WHERE tenant_id=$1`, [tenantId]).catch(() => ({ rows: [] }));
    const fs = fr.rows?.[0]?.settings ?? {};
    if (fs.dunning_quiet_start && fs.dunning_quiet_end) return { start: fs.dunning_quiet_start, end: fs.dunning_quiet_end };
    const provider = await enabledCapability(sysq, tenantId, 'comms.whatsapp.templates');
    const s = provider?.settings ?? {};
    const qs = s.quiet_hours ?? {};
    return { start: qs.start ?? '21:00', end: qs.end ?? '08:00' };
  };
  // Dunning selection lives in ONE place (src/fees/dunning.js) shared with the day-worker script.
  // before_due_days / escalation_days are tenant fee settings first, comms.whatsapp plugin second;
  // the overdue 7-day window is always on. The overdue dedup key remains `dunning:<id>` (pinned by
  // tests and by the 7-day NOT EXISTS).
  const dunningPolicy = async (tenantId) => {
    const fr = await sysq(`SELECT settings FROM app.fee_settings WHERE tenant_id=$1`, [tenantId]).catch(() => ({ rows: [] }));
    const fs = fr.rows?.[0]?.settings ?? {};
    const clean = (v) => Array.isArray(v) ? v.filter((n) => Number.isInteger(n) && n > 0 && n <= 90) : null;
    let before = clean(fs.dunning_before_due_days);
    let escalate = clean(fs.dunning_escalation_days);
    if (before === null || escalate === null) {
      const provider = await enabledCapability(sysq, tenantId, 'comms.whatsapp.templates');
      const s = provider?.settings ?? {};
      if (before === null) before = Array.isArray(s.before_due_days) ? s.before_due_days.filter((n) => Number.isInteger(n) && n > 0) : [];
      if (escalate === null) escalate = Array.isArray(s.escalation_days) ? s.escalation_days.filter((n) => Number.isInteger(n) && n > 0) : [];
    }
    return { before, escalate };
  };

  app.post('/fees/dunning/run', { preHandler: require('owner', 'principal', 'finance', 'finance_head', 'finance_clerk') }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      if (!(await feeFeatureGate(c, reply, req.user.tenant_id, 'fees.dunning'))) return;
      const quiet = await dunningQuietHours(req.user.tenant_id);
      const q0 = parseHm(quiet.start), q1 = parseHm(quiet.end);
      const minute = IST_MINUTE_OF_DAY();
      if (inQuietHours(q0, q1, minute)) {
        const opensAt = minute < (q1 ?? 0) ? quiet.end : `${quiet.end} (next day IST)`;
        return { queued: 0, quietHours: quiet, note: `quiet hours in effect (IST) — sweep writes nothing until ${opensAt}` };
      }
      const today = IST_TODAY();
      const policy = await dunningPolicy(req.user.tenant_id);
      let queued = 0; let skippedNoContact = 0; let beforeDueQueued = 0; let escalated = 0;

      const queue = async (o, { kind, dedup, body, offsetDays }) => {
        if (!o.guardian_phone) { skippedNoContact += 1; return 0; }
        const inserted = await c.query(
          `INSERT INTO app.communications (tenant_id, audience_kind, audience_json, channel, template, body, status, policy_ref, dedup_key)
           VALUES ($1,'guardian',$2::jsonb,'whatsapp',$3,$4,'queued','Fees §4.2',$5)
           ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
          [req.user.tenant_id, JSON.stringify([o.guardian_phone]),
           kind === 'escalation' ? 'FEE_ESCALATION' : 'FEE_REMINDER', body, dedup]);
        if (inserted.rowCount > 0) {
          await c.query(
            `INSERT INTO app.fee_dunning_log (tenant_id, obligation_id, kind, channel, offset_days, dedup_key)
             VALUES ($1,$2,$3,'whatsapp',$4,$5) ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
            [req.user.tenant_id, o.id, kind, offsetDays ?? null, dedup]);
        }
        return inserted.rowCount;
      };

      // overdue (always on) — also emits fee.due once, so the rail subscribers become live
      for (const o of await selectOverdue(c.query.bind(c), req.user.tenant_id, today)) {
        const n = await queue(o, { kind: 'overdue', dedup: overdueDedup(o.id), body: overdueBody(o) });
        queued += n;
        if (n > 0) await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `fee.due — ${o.student_name} ${o.label} due ${o.due_on}`, ref: o.id }, 'fee.due', { obligationId: o.id, dueOn: o.due_on, overdue: true });
      }
      // before-due (opt-in offsets) — also emits fee.due, the event the rails subscribe to
      for (const offset of policy.before) {
        for (const o of await selectBeforeDue(c.query.bind(c), req.user.tenant_id, today, offset)) {
          const n = await queue(o, { kind: 'before_due', dedup: beforeDueDedup(o.id, offset), body: beforeDueBody(o), offsetDays: offset });
          beforeDueQueued += n;
          if (n > 0) await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `fee.due — ${o.student_name} ${o.label} due ${o.due_on}`, ref: o.id }, 'fee.due', { obligationId: o.id, dueOn: o.due_on, offsetDays: offset });
        }
      }
      // escalation (opt-in ages) — raises a finance Action, not just a message
      for (const days of policy.escalate) {
        for (const o of await selectEscalation(c.query.bind(c), req.user.tenant_id, today, days)) {
          const n = await queue(o, { kind: 'escalation', dedup: escalationDedup(o.id, days), body: escalationBody(o), offsetDays: days });
          if (n > 0) {
            escalated += 1;
            await c.query(
              `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, payload)
               VALUES ($1,$2,'exception',$3,$4,$5,'high','open','Finance','finance','Fees §4.2',false,$6::jsonb)`,
              [req.user.tenant_id, `fee.overdue.${o.id}`,
               `Overdue fee ${days}d+ — ${o.student_name} ${o.label}`,
               `₹${Number(outstanding(o)) / 100} outstanding since ${o.due_on}.`,
               'Fee escalation policy: an aged overdue obligation needs a human decision.',
               JSON.stringify({ obligationId: o.id, daysOverdue: days, proposed_by: req.user.id, proposed_by_role: req.user.role })]);
          }
        }
      }
      const total = queued + beforeDueQueued;
      if (total > 0 || escalated > 0) {
        await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Ran fee dunning sweep', recordType: 'Fees', recordRef: today, reason: 'overdue / before-due / escalation obligations', policyRef: 'Fees §4.2', outcome: `${queued} overdue · ${beforeDueQueued} before-due queued (deduped) · ${escalated} escalated · ${skippedNoContact} skipped without guardian contact` });
        if (total > 0) await emitEvent(c, req.user.tenant_id, { type: 'fees', label: `Fee dunning — ${total} reminder(s) queued`, ref: today });
      }
      return { queued: total, overdueQueued: queued, beforeDueQueued, escalated, skippedNoContact, quietHours: quiet, template: 'FEE_REMINDER' };
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
    // F5: the assembly keys (the same shape the plugin-level board_policy uses). When present, the
    // per-exam policy is APPLIED at report assembly and overrides the plugin default.
    if (bp.scale !== undefined && !['cbse_10_point', 'gpa_4', 'percent'].includes(bp.scale)) return 'scale must be cbse_10_point|gpa_4|percent';
    if (bp.pass_pct !== undefined && (typeof bp.pass_pct !== 'number' || !Number.isFinite(bp.pass_pct) || bp.pass_pct < 0 || bp.pass_pct > 100)) return 'pass_pct must be a number 0..100';
    if (bp.divisions !== undefined) {
      if (!Array.isArray(bp.divisions) || bp.divisions.length > 10) return 'divisions must be an array (≤10)';
      for (const d of bp.divisions) {
        if (!d || typeof d.label !== 'string' || !d.label.trim() || d.label.length > 20) return 'each division needs a label (≤20 chars)';
        if (typeof d.min_pct !== 'number' || !Number.isFinite(d.min_pct) || d.min_pct < 0 || d.min_pct > 100) return 'each division needs min_pct 0..100';
      }
    }
    const allowed = ['board', 'rounding', 'components', 'gradingScale', 'notes', 'scale', 'pass_pct', 'divisions'];
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
      // F5: a policy that declares a `scale` is APPLIED at report assembly (it overrides the plugin-level
      // board_policy); the reference-only shape (no scale) is stored but assembly uses the plugin default.
      const applied = ['cbse_10_point', 'gpa_4', 'percent'].includes(req.body?.scale);
      await auditLog(c, req.user.tenant_id, { actor: req.user.name, actorRole: req.user.role, action: 'Set exam board policy', recordType: 'Exam', recordRef: e.name, reason: `board ${req.body.board}`, outcome: applied ? 'stored — applied at report assembly (per-exam overrides the plugin default)' : 'stored — reference only (no `scale`; assembly uses the plugin default)' });
      return { examId: e.id, boardPolicy: req.body, applied, note: applied ? 'applied at report assembly (per-exam overrides the plugin default)' : 'stored as reference — add a `scale` for it to be applied at assembly' };
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
  // D-2: the weights + filter were the OLD lattice (inquiry/school-visit/applied/assessment/
  // offer) and excluded `enrolled/dropped`, so every live stage scored at weight 1.0 and the
  // rejected/withdrawn side exits leaked into the queue. Both now come from the shared
  // admissions-access module the plugin itself uses — one vocabulary, no drift.
  // RTE-3: this was gated on the broad `me`, so a parent or student read every open lead's
  // name/class/source/stage. `fullPii` masks two fields but authorizes nobody. It now mirrors the
  // admissions funnel's own lead-list gate via `roleGatedMe`, which also publishes the real role
  // set to the route registry so custom-role authoring cannot widen it (RBAC-1c).
  app.get('/admissions/followups', { preHandler: roleGatedMe(...ADMISSIONS_ADMIN, 'teacher') }, async (req) => {
    const fullPii = FULL_PII.includes(req.user.role);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT id, student_name, class_applied, source, stage, guardian_name, guardian_phone, updated_at,
                GREATEST(0, extract(epoch FROM (now() - updated_at)) / 86400)::int AS days_in_stage
         FROM plugin_admissions.lead
         WHERE tenant_id=$1 AND stage <> ALL($2::text[])
         -- RTE-13: the ranking ran over every open lead in JS; bound the input like every other list door.
         ORDER BY updated_at ASC LIMIT 500`, [req.user.tenant_id, CLOSED_STAGES])).rows;
      const queue = rows.map((r) => {
        const days = Number(r.days_in_stage);
        const w = FOLLOWUP_WEIGHTS[r.stage] ?? 1;
        return {
          leadId: r.id, studentName: r.student_name, classApplied: r.class_applied, source: r.source,
          stage: r.stage, daysInStage: days, stageWeight: w, score: Math.round(days * w * 10) / 10,
          stuck: days > 7,
          guardianName: fullPii ? r.guardian_name : null,
          guardianPhone: fullPii ? r.guardian_phone : maskPhone(r.guardian_phone),
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
  app.get('/reports/fees/summary', { preHandler: require('owner', 'principal', 'coordinator', 'finance', 'finance_head', 'finance_clerk', 'itadmin') }, async (req, reply) => {
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
      // FEE-DAT-1b: the same aggregate grouped by FEE HEAD, so the report speaks in charge categories
      // rather than free-text labels. Un-headed (legacy) rows group under a null head and are labelled.
      const byHead = (await c.query(
        `SELECT h.id AS fee_head_id, COALESCE(h.name, 'Unassigned') AS fee_head_name,
                count(*)::int AS obligations,
                COALESCE(SUM(o.amount_cents), 0)::bigint AS billed_cents,
                COALESCE(SUM(o.paid_cents), 0)::bigint AS collected_cents,
                COALESCE(SUM(o.amount_cents - o.paid_cents) FILTER (WHERE o.status IN ('open','partial')), 0)::bigint AS outstanding_cents
           FROM app.fee_obligations o
           LEFT JOIN app.fee_heads h ON h.id = o.fee_head_id
          WHERE o.tenant_id=$1 AND ($2::uuid IS NULL OR o.academic_year_id=$2::uuid)
          GROUP BY h.id, h.name ORDER BY COALESCE(h.name, 'Unassigned')`, [req.user.tenant_id, ay ?? null])).rows;
      const sum = (k) => r.reduce((a, x) => a + Number(x[k]), 0);
      const billed = sum('billed_cents'), collected = sum('collected_cents');
      return {
        terms: r,
        heads: byHead,
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

  app.get('/communications', { preHandler: require('owner','principal','coordinator','finance','finance_head','finance_clerk','itadmin','transport') }, async (req) => {
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 500 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await c.query(`SELECT id, tenant_id, audience_kind, audience_json, channel, template, status, policy_ref, approved_by, sent_at, delivered_at, created_at FROM app.communications ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
      return { communications: r.rows, limit, offset, hasMore: r.rows.length === limit };
    });
  });

  app.get('/audit', { preHandler: require('owner','principal','itadmin','finance','finance_head','finance_clerk') }, async (req) => {
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
  // OPP-SEC-4: the plugin-settings WRITE door accepts owner/principal/itadmin, but the read redacted
  // values to owner/itadmin — a principal could write settings it was not allowed to see. Symmetry:
  // whoever may write the settings may read them.
  const isPrivileged = (role) => ['owner', 'principal', 'itadmin'].includes(role);

  // FEE-COM-2: the usage report behind every manifest's declared `billing.metered` counters. A tenant can
  // see what its rails actually did; a declared-but-uncounted metric shows as zero rather than as a promise.
  app.get('/usage', { preHandler: require('owner', 'itadmin') }, async (req) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const usage = (await c.query(
        `SELECT plugin_id, metric, count, updated_at FROM app.plugin_usage ORDER BY plugin_id, metric`)).rows;
      const declared = (await c.query(
        `SELECT plugin_id, COALESCE(manifest->'billing'->'metered', '[]'::jsonb) AS metered FROM app.plugins ORDER BY plugin_id`)).rows;
      return { usage, declared, plan: (await c.query(`SELECT plan FROM app.tenants WHERE id=$1`, [req.user.tenant_id])).rows[0]?.plan ?? 'trial' };
    });
  });

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

  app.post('/plugins/:id/enable', { preHandler: [require('owner','principal','itadmin'), pluginGuard] }, async (req, reply) => {
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

  app.post('/plugins/:id/disable', { preHandler: [require('owner','principal','itadmin'), pluginGuard, app.requireStepUp] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // RTE-17: confirm the plugin exists BEFORE the drain. The 404 used to fire after the drain UPDATE,
      // so disabling an unknown id could still reassign that desk's open actions.
      const exists = await c.query(`SELECT 1 FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [req.user.tenant_id, req.params.id]);
      if (!exists.rows[0]) return bad(reply, 'plugin not registered', 404);
      // DRAIN PROTOCOL (docs/12 §12): disable may never abandon school work.
      // OPP-DAT-1: reassign by the raising plugin (`source_plugin`, stamped at every plugin raise) OR the
      // legacy `owner_role`/`owner` string match OR event provenance. Before `source_plugin` existed, the
      // first two clauses never matched a plugin id and the drain handed back ZERO rows (PLG-6/A22).
      const drained = await c.query(
        `UPDATE app.actions SET owner='Principal desk (drain hand-back)', owner_role='principal'
         WHERE tenant_id=$1 AND status='open' AND (
           source_plugin=$2 OR owner_role=$2 OR owner=$2 OR EXISTS (
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

  app.post('/plugins/:id/settings', { preHandler: [require('owner','principal','itadmin'), pluginGuard] }, async (req, reply) => {
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
    if (data.busRoute != null && String(data.busRoute).trim().length > 40) return 'busRoute must be 40 characters or fewer';
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
          `INSERT INTO app.students (tenant_id, admission_no, name, grade, section, guardian_name, guardian_phone, bus_route, status, source, source_ref)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active','migration',$9)
           ON CONFLICT (tenant_id, admission_no) DO NOTHING RETURNING id`,
          [req.user.tenant_id, admissionNo, String(d.name).trim(), String(d.grade).trim(), String(d.section).trim(),
            d.guardianName ? String(d.guardianName).trim() : null, d.guardianPhone ? String(d.guardianPhone).trim() : null,
            /* ops.import's mapping schema accepts bus_route, so committing a mapped file must not
               silently drop the column the file was told it could carry. */
            d.busRoute ? String(d.busRoute).trim().slice(0, 40) : null,
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
