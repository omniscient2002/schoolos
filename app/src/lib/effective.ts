/* Effective access — the client's view of `GET /me/effective`. See server/src/effective-access.js.
 *
 * The SERVER decides; this module only READS the answer. `canSurface` is a render gate, never an
 * authorization gate: every door re-decides on the server and refuses regardless of what this returns.
 * It exists so a screen stops comparing a hardcoded role string and instead asks the one answer the
 * server derived from the same registry the doors enforce (PERFECT-100 §6.2 item 14 / RBAC-6 / FE-2).
 *
 * FEX-5: a surface the server did not name now fails CLOSED (not renderable). The server maps every
 * renderable route in `SURFACE_DOOR`, so an unnamed path is either a typo or a surface added without a
 * door — showing it would re-open the "unknown role becomes the broadest" class of defect. A MISSING
 * payload is still allowed: no `GET /me/effective` answer means the server has not spoken yet, and the
 * server still enforces every door regardless of what the client renders. */

export interface EffectiveAccess {
  role: string;
  role_key?: string | null;
  base_role?: string;
  scope?: { classes?: Array<{ grade: string; section: string }> };
  /** surface path → may render (server-computed from the route registry + the caller's mask). */
  capabilities?: Record<string, boolean>;
  /** the true subset of `capabilities`, in a stable order, for nav rendering. */
  nav?: string[];
  /** the caller's reachable doors, `"METHOD /path"`, for surfaces not named in the map. */
  doors?: string[];
}

/** May the caller render this surface? A surface the server did not name fails closed. */
export function canSurface(eff: EffectiveAccess | null | undefined, path: string): boolean {
  const caps = eff?.capabilities;
  if (!caps) return true; // no server answer yet — the server still enforces every door
  if (path in caps) return caps[path] === true;
  /* React Router gives us concrete paths while the server catalog deliberately
     uses `:param` placeholders. Resolve the most specific matching catalog
     entry so deep links cannot bypass the same render decision. */
  const match = Object.keys(caps)
    .filter(pattern => pattern.includes(':'))
    .filter(pattern => {
      const re = new RegExp(`^${pattern.split('/').map(part => part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('/')}\\/?$`);
      return re.test(path);
    })
    .sort((a, b) => b.length - a.length)[0];
  if (match != null) return caps[match] === true;
  /* A NESTED route inherits its section's surface: the desk's pages (`/library/desk/issue`, `/library/desk/catalog`,
     …) are all the librarian's desk, and the server names the section (`/library/desk`). Without this, every
     sub-page of a sectioned workspace failed closed and the tabs rendered "Not available for your role". The
     longest non-param prefix wins, so `/library/desk/...` is decided by `/library/desk`, not `/library`. */
  const prefix = Object.keys(caps)
    .filter(p => !p.includes(':') && path.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return prefix == null ? false : caps[prefix] === true;
}

/** The classes this caller owns (a teacher's form-classes); empty for every other role. */
export function ownedClasses(eff: EffectiveAccess | null | undefined): Array<{ grade: string; section: string }> {
  return eff?.scope?.classes ?? [];
}
