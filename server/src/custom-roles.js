// Custom-role MASK enforcement — one definition, used by BOTH role gates.
//
// RBAC-1 (PERFECT-100 §5.1): the mask machinery lived entirely inside `registerRoutes`, so only the
// kernel's `require()`/`me` doors honoured it. Every PLUGIN door is gated by a different gate
// (`src/app.js` `requireRole`, handed to `loadPlugins`), which checked `roles.includes(req.user.role)`
// and nothing else. The consequence was asymmetric and both halves were wrong:
//   • a matched DENY was silently ignored on plugin doors, so "this librarian must not reach the
//     safeguarding queue" was unenforceable exactly where it matters most;
//   • a matched ALLOW could not lift a plugin door's role refusal, so a custom role could not be GIVEN
//     a plugin door the bases role lacks — which is the whole point of the librarian preset (D-43).
// The store, the matcher and the decision rule now live here and both gates call `applyMask`, so there
// is no second implementation to drift.
//
// Resolution order is unchanged and deliberately simple — deny wins, then allow, then the base role:
//   1. the base role decides as usual,
//   2. a matched DENY refuses (403) even when the base role allowed,
//   3. a matched ALLOW grants even when the base role lacked the door.
//
// This module deliberately does NOT know about `app.roles` validation (pattern legality, the
// amplification ceiling against the live route registry) — that belongs with the route registry, which
// only the kernel has. Enforcement is what must not fork.

import { withUser } from './db.js';

/** @param {{ withUser: Function }} deps */
export function createCustomRoles({ withUser: wu = withUser } = {}) {
  let rolesSchemaReady = null; // null = not yet probed

  /** Is the roles store present on THIS database? Cached after the first probe. Both gates are silent
   *  without it, so a database that predates migration 061 behaves exactly as it did before. */
  const rolesAvailable = async (sysq) => {
    if (rolesSchemaReady === null) {
      const r = await sysq(`SELECT to_regclass('app.roles') IS NOT NULL AS ok,
                              EXISTS (SELECT 1 FROM information_schema.columns
                                      WHERE table_schema='app' AND table_name='users' AND column_name='role_key') AS col`);
      rolesSchemaReady = !!(r.rows[0]?.ok && r.rows[0]?.col);
    }
    return rolesSchemaReady;
  };

  // role-key binding cache: userId → {key, at}. authenticate() selects a fixed column list that does
  // not include role_key, so the binding is resolved here. TTL 30s bounds cross-request staleness of an
  // assignment; the mask itself is always read FRESH (PATCH/DELETE invalidate).
  const bindingCache = new Map();
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

  // "METHOD /path" with an optional trailing '*' (prefix match)
  const patternMatches = (pattern, method, url) => {
    if (typeof pattern !== 'string') return false;
    const sp = pattern.indexOf(' ');
    if (sp < 0) return false;
    const pm = pattern.slice(0, sp);
    const pp = pattern.slice(sp + 1);
    if (pm !== '*' && pm !== method) return false;
    if (pp.endsWith('*')) return url.startsWith(pp.slice(0, -1));
    return url === pp || url.startsWith(pp + '/') || url.startsWith(pp + '?');
  };

  /** 'deny' | 'allow' | null — deny wins over allow (predictable order). */
  const maskDecides = (mask, method, url) => {
    for (const p of mask?.deny ?? []) if (patternMatches(p, method, url)) return 'deny';
    for (const p of mask?.allow ?? []) if (patternMatches(p, method, url)) return 'allow';
    return null;
  };

  /** Apply the caller's custom mask, if any. `false` = the mask does not speak for this door (the base
   *  role's decision stands). `true` = an ALLOW grant, so a role refusal may be lifted. If a DENY
   *  matched, the 403 is already sent — callers must check `reply.sent`.
   *
   *  `req.url` is taken verbatim here, NOT stripped of its query string: `patternMatches` handles a
   *  `?` suffix, and the kernel gate has always matched against the raw URL. Stripping it in one gate
   *  and not the other is how two gates drift into different answers for the same request. */
  // One decision per request. `authenticate` applies the mask for the restrictive half, then a role gate
  // asks the same question again — without memoising, every request would read the roles store twice.
  const MASK_DECISION = Symbol('schoolos.maskDecision');
  const applyMask = async (req, reply, sysq) => {
    if (!req?.user) return false;
    if (MASK_DECISION in req) {
      const cached = req[MASK_DECISION];
      if (cached === 'deny') {
        // the deny was already answered by whichever gate ran first; do not send a second 403
        if (!reply.sent) reply.code(403).send({ error: 'Your school\'s custom role for you refuses this action' });
        return true;
      }
      return cached === 'allow';
    }
    if (!(await rolesAvailable(sysq))) {
      req[MASK_DECISION] = null;
      return false;
    }
    const decision = await wu(req.user.tenant_id, req.user.role, async (c) => {
      const roleKey = await roleKeyFor(c, req.user);
      if (!roleKey) return null;
      const mask = await maskForUser(c, req.user, roleKey);
      return mask ? maskDecides(mask, req.method, req.url) : null;
    });
    req[MASK_DECISION] = decision;
    if (decision === 'deny') {
      if (!reply.sent) reply.code(403).send({ error: 'Your school\'s custom role for you refuses this action' });
      return true;
    }
    return decision === 'allow';
  };

  /** The caller's own role binding + mask, for DISPLAY decisions on the client (`/me`). Returns null when
   *  the caller carries no custom role or the store is absent. Never returns another user's mask. */
  const maskInfo = async (user, sysq) => {
    if (!user || !(await rolesAvailable(sysq))) return null;
    return wu(user.tenant_id, user.role, async (c) => {
      const key = await roleKeyFor(c, user);
      if (!key) return null;
      const mask = (await maskForUser(c, user, key)) ?? { allow: [], deny: [] };
      return { key, allow: Array.isArray(mask.allow) ? mask.allow : [], deny: Array.isArray(mask.deny) ? mask.deny : [] };
    });
  };

  /** Invalidate one user's cached binding: a role assignment must take effect at once, not after the
   *  binding TTL. The kernel calls this when it assigns or clears a role_key. */
  const forgetBinding = (userId) => bindingCache.delete(userId);

  /** Did the caller's mask explicitly ALLOW this request? The decision is computed once per request by
   *  `authenticate` and memoised, so this is a pure read — no query, no second opinion. Used by doors that
   *  re-check the built-in role INSIDE the handler (a `require()` gate cannot help them), so that a custom
   *  role granted the door is not refused by the very check that was supposed to be superseded by masks. */
  const allows = (req) => req?.[MASK_DECISION] === 'allow';

  /** Built-in role OR an explicit mask grant for this door. Deliberately NOT used for scope/SoD checks
   *  (e.g. "is this record mine?", "may this role both make and check?"): a mask grant answers "may you
   *  reach this door", not "is this row yours". */
  const canReach = (req, roles) => roles.includes(req?.user?.role) || allows(req);

  /** Test seam: forget the schema probe and the binding cache. */
  const reset = () => { rolesSchemaReady = null; bindingCache.clear(); };

  return { rolesAvailable, roleKeyFor, maskForUser, patternMatches, maskDecides, applyMask, maskInfo, allows, canReach, forgetBinding, reset };
}

// ONE instance for the whole process. Two instances would mean two binding caches and two schema probes, and
// an invalidation would clear only one of them — which is exactly the bug the first version of this module
// shipped: the assign door cleared the kernel instance's cache while the plugin gate kept answering from its
// own stale copy for up to 30s, so a role change (and a newly added DENY) did not take effect on plugin
// doors. Shared state is the point: the kernel gate and the plugin gate must see the SAME binding.
export const customRoles = createCustomRoles();

/** Module-level façades for the parts a door needs directly: `import { canReach } from './custom-roles.js'`.
 *  (The first version of this exported nothing but the instance, and `import { canReach }` failed at module
 *  load with "does not provide an export named 'canReach'" — a SyntaxError that surfaced only as every test
 *  in the file being cancelled.) */
export const canReach = (req, roles) => customRoles.canReach(req, roles);
export const maskAllows = (req) => customRoles.allows(req);
