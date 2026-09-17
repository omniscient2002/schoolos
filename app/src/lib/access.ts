/* FEX-4 / FEX-7 — ONE role notion for render decisions.
 *
 * The app had two: `useStore().session.roleId` (set on login AND mutable by the demo-preview switcher) and
 * `useSession().role` (the server-authenticated role). Permission checks written against different ones
 * drift. These helpers make the authenticated server role the single source for staff/permission UI, and
 * route grants through the custom-mask matcher (`lib/grants.ts`) exactly like the server — a teacher-based
 * custom role such as "Librarian" is admitted where the mask allows it. This is a RENDER hint only: every
 * door re-decides on the server.
 */
import { useSession } from '../App';
import { useStore } from '../state/store';
import { isLightRole } from './roles';
import { roleOrGrant } from './grants';

/** The caller's role for permission UI: the authenticated server role, or the demo-preview role when there
 *  is no server session (the demo switcher). */
export function useLiveRole(): string {
  const live = useSession();
  const { session } = useStore();
  return live?.role || session.roleId;
}

/** Is this a parent/student (light) surface? One definition, used by the chrome. */
export function useLightRole(): boolean {
  return isLightRole(useLiveRole());
}

/** May this caller use a control? A built-in role in `roles`, OR the caller's own custom mask explicitly
 *  ALLOWs one of `doors`. Deny-wins is handled by `roleOrGrant`. */
export function useRoleOrGrant(roles: string[], doors: string[]): boolean {
  const live = useSession();
  // roleOrGrant already works from the authenticated identity; fall back to null for safety.
  return roleOrGrant(live, roles, doors);
}
