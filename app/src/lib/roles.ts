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
  'owner', 'principal', 'teacher', 'coordinator', 'counselor', 'finance', 'finance_head', 'finance_clerk',
  'admissions', 'transport', 'parent', 'student', 'itadmin', 'facilities', 'technician', 'librarian',
];

/** The lightest surface: what an unrecognised role gets. Never the broadest — see the note above. */
export const UNKNOWN_ROLE_FALLBACK: RoleId = 'student';

/* The roles the school can APPOINT through the provisioning console — one declaration, derived.
 *
 * `owner` is excluded because owners are created at tenant bootstrap (one per school, and only
 * there); the server's own list of issuable roles is `ROLES_NO_OWNER`, and a school must not be able
 * to mint a second one from a dropdown.
 *
 * `student` used to be excluded here too, which left the whole student portal with no possible
 * user: the server issues the role, ~20 `/student/*` doors exist, and nothing could ever create one
 * (G-1). A pupil's portal account is now created the same way any account is — from the roster,
 * where the school actually is (see PeopleAdmin's "Create portal account" on a student row).
 */
export const PROVISIONABLE_ROLES: readonly RoleId[] = KNOWN_ROLES.filter((r) => r !== 'owner');

export function mapAccountRole(role: string | null | undefined): RoleId {
  const r = String(role ?? '');
  return (KNOWN_ROLES as readonly string[]).includes(r) ? (r as RoleId) : UNKNOWN_ROLE_FALLBACK;
}

/** Does this role get the calm (parent/student) surface? */
export const isLightRole = (role: string | null | undefined): boolean =>
  mapAccountRole(role) === 'parent' || mapAccountRole(role) === 'student';

/* The role's own landing page — the first item in that role's navigation (Shell.tsx useNavItems), so a
   signed-in account opens on its own workspace instead of the generic /today.
 *
 * /today is gated by the server (`GET /actions`), which parent, student and librarian do NOT hold, so the
 * generic landing showed them "Not available for your role" the moment they signed in. Technician holds
 * /today but has no Today item in its nav either, so it also lands on its jobs board. Roles whose nav
 * starts at /today (owner, principal, teacher, finance, admissions, transport, facilities, itadmin,
 * counselor) are unchanged. Coordinator deliberately stays on /today because its nav DOES link to Today:
 * redirecting every /today visit would break that link, and /today is reachable for it anyway. */
const ROLE_HOME: Partial<Record<RoleId, string>> = {
  parent: '/parent/family',
  student: '/student/home2',
  librarian: '/library/desk',
  technician: '/maintenance/technician',
};

export function homeForRole(role: string | null | undefined): string {
  return ROLE_HOME[mapAccountRole(role)] ?? '/today';
}
