/* Which shell role does an authenticated account get?
 *
 * RBAC-3b: this mapping used to end `: 'principal'` — the BROADEST role — so any role string the client did
 * not recognise was silently escalated: a newly added built-in role, a value the server started returning
 * after a client release, or a malformed one all rendered the full management shell and satisfied the
 * staff-only route guard. The server still refused the doors, but "unknown ⇒ most powerful" is the wrong
 * direction to guess in, and it is exactly the kind of default that turns a small drift into a visible
 * management surface for the wrong person.
 *
 * It now fails CLOSED to the lightest surface ('student'). The cost of being wrong is that an unlisted staff
 * role sees the calm surface until the client ships knowledge of it; the cost of the old default was showing
 * an unrecognised account the principal's console. Note that a CUSTOM role is unaffected either way: /me
 * reports its BASE role, which is always one of these.
 *
 * Kept in its own module so it can be asserted directly (the app has no DOM runner); `RoleId` is imported
 * type-only, so importing this file never pulls in the React store. */
import type { RoleId } from '../types/domain';

export const KNOWN_ROLES: readonly RoleId[] = [
  'owner', 'principal', 'teacher', 'coordinator', 'counselor', 'finance', 'admissions',
  'transport', 'parent', 'student', 'itadmin', 'facilities', 'technician',
];

/** The lightest surface: what an unrecognised role gets. Never the broadest — see the note above. */
export const UNKNOWN_ROLE_FALLBACK: RoleId = 'student';

export function mapAccountRole(role: string | null | undefined): RoleId {
  const r = String(role ?? '');
  return (KNOWN_ROLES as readonly string[]).includes(r) ? (r as RoleId) : UNKNOWN_ROLE_FALLBACK;
}

/** Does this role get the calm (parent/student) surface? */
export const isLightRole = (role: string | null | undefined): boolean =>
  mapAccountRole(role) === 'parent' || mapAccountRole(role) === 'student';
