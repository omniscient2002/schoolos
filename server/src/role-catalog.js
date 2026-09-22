/* RBAC-1 · the canonical built-in role catalog.
 *
 * Before this module the built-in role list lived in four places that could drift: `auth.js` ROLES,
 * the database CHECK constraint (migrations 001/079/108/109), the per-door gate lists, and the client's
 * role arrays. This module is the single code source for the ROLE LIST; `auth.js` re-exports it, and
 * `tests/rbac-catalog.test.js` pins it against the database CHECK so a role cannot be added on one side
 * only. The per-door capability map below is the single source for the owner/principal oversight
 * capabilities the Perfect-100 campaign introduced; the older doors still carry inline lists (the
 * residual RBAC-1 work is deriving every gate from a capability map, tracked in the register).
 */
export const BUILTIN_ROLES = [
  'owner', 'principal', 'coordinator', 'counselor',
  'finance', 'finance_head', 'finance_clerk',
  'admissions', 'transport', 'facilities', 'technician',
  'teacher', 'itadmin', 'parent', 'student', 'librarian',
];

/** Capability → the built-in roles that hold it. Used by the oversight doors and by the tests. */
export const CAPABILITY_ROLES = Object.freeze({
  'oversight:board-pack': ['owner', 'principal', 'coordinator', 'finance', 'finance_head', 'itadmin'],
  'oversight:board-pack:write': ['owner', 'principal', 'itadmin'],
  'oversight:brief': ['owner', 'principal', 'itadmin', 'coordinator'],
  'oversight:announce': ['owner', 'principal', 'coordinator', 'finance', 'finance_head', 'itadmin'],
  'oversight:announce:approve': ['owner', 'principal'],
  'oversight:compliance': ['owner', 'principal', 'coordinator', 'finance', 'finance_head', 'itadmin'],
  'oversight:compliance:write': ['owner', 'principal', 'itadmin', 'coordinator'],
  'oversight:certificates': ['owner', 'principal', 'coordinator', 'finance', 'finance_head', 'itadmin'],
  'oversight:certificates:write': ['owner', 'principal', 'itadmin', 'coordinator'],
  'oversight:certificates:sign': ['owner', 'principal'],
  'oversight:delegations': ['owner', 'principal', 'itadmin', 'coordinator'],
  'oversight:policy:write': ['owner', 'principal', 'itadmin'],
  'oversight:appraisal': ['owner', 'principal', 'itadmin'],
  'oversight:appraisal:write': ['owner', 'principal'],
  'governance:roles': ['owner', 'itadmin'],
  'governance:metrics': ['owner', 'itadmin'],
  'governance:plugin-settings': ['owner', 'principal', 'itadmin'],
});

/** The roles that may reach a named capability (empty when the capability is unknown — fail closed). */
export function rolesForCapability(capability) {
  return CAPABILITY_ROLES[capability] ?? [];
}
