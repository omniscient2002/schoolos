/* Door grants — the client-side MIRROR of the server's custom-role mask, used ONLY to decide which
   controls to render. It is not, and must never become, an authorization decision: every door
   re-decides on the server, and the server refuses regardless of what this returns.

   WHY IT EXISTS (RBAC-3 / RBAC-6): the shipped "Librarian" role is a teacher-based CUSTOM role, so
   `/me` reported `role:'teacher'` and screens hardcoded the built-in role — `LibraryLive.tsx` computed
   `isStaff = ['owner','principal','coordinator','facilities'].includes(live.role)`, which is false for a
   librarian, so the owner saw the module title with NONE of its controls even though every library door
   authorised them (server/src/plugins/library STAFF is the same list, which the mask now lifts). The
   screen needed the one fact the client did not have: the caller's own mask. `/me` now returns it.

   The matcher is deliberately the same rule as the server's `patternMatches`
   (server/src/custom-roles.js): "METHOD /path", an optional trailing '*' meaning prefix, and a '?' suffix
   accepted on the request path. DENY WINS over allow — the same predictable order, so the client cannot
   show a control the server will refuse. */

export interface RoleMask { allow: string[]; deny: string[] }
export interface MaskedSession { role?: string; role_key?: string | null; custom?: RoleMask | null }

/** Does this mask pattern cover this door? Mirrors server/src/custom-roles.js patternMatches. */
export function patternCovers(pattern: string, method: string, path: string): boolean {
  const sp = pattern.indexOf(' ');
  if (sp < 0) return false;
  const pm = pattern.slice(0, sp);
  const pp = pattern.slice(sp + 1);
  if (pm !== '*' && pm !== method.toUpperCase()) return false;
  if (pp.endsWith('*')) return path.startsWith(pp.slice(0, -1));
  return path === pp || path.startsWith(`${pp}/`) || path.startsWith(`${pp}?`);
}

/** 'deny' | 'allow' | null for one door — deny first, exactly like the server. */
export function maskDecision(mask: RoleMask | null | undefined, method: string, path: string): 'deny' | 'allow' | null {
  if (!mask) return null;
  for (const p of mask.deny ?? []) if (patternCovers(p, method, path)) return 'deny';
  for (const p of mask.allow ?? []) if (patternCovers(p, method, path)) return 'allow';
  return null;
}

/** May the caller's custom role reach this door? A deny always answers false; an allow always true. */
export function granted(session: MaskedSession | null | undefined, door: string): boolean {
  const sp = door.indexOf(' ');
  if (sp < 0) return false;
  const decision = maskDecision(session?.custom ?? null, door.slice(0, sp), door.slice(sp + 1));
  return decision === 'allow';
}

/** Any of these doors granted — the common case for "does this screen's module apply to me?". */
export function grantedAny(session: MaskedSession | null | undefined, doors: string[]): boolean {
  return doors.some((d) => granted(session, d));
}

/** Built-in role list OR an explicit grant: what a screen should use instead of a hardcoded role list. */
export function roleOrGrant(session: MaskedSession | null | undefined, builtinRoles: string[], doors: string[]): boolean {
  if (builtinRoles.includes(session?.role ?? '')) return true;
  return grantedAny(session, doors);
}
