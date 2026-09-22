# FIX SPEC — IT-admin onboarding authority (students + all non-owner/non-principal accounts)

> **STATUS: IMPLEMENTED (2026-09-22).** All five edits applied exactly as specified, the tests added,
> the generated matrix regenerated, and the docs updated. Evidence:
> - Edits 1–5: `routes.js` (`POST /students` gate; `POST`/`PATCH /roles` base_role guards),
>   `plugins/people.admin/index.js` (`ROSTER` + the principal-refusal block mirroring the owner-refusal
>   commit-before-send contract).
> - Tests: `students-lifecycle.test.js` (itadmin admit 200 / parent+student 403),
>   `wave-b.test.js` (itadmin import 200; itadmin→principal 403 + `risk:'high'` ledger row; owner→principal
>   200), `custom-roles.test.js` (itadmin principal-based role 403 / owner 200 / owner-based 400 / PATCH
>   variants). All green.
> - `docs/PERMISSION-MATRIX.md` regenerated: `POST /students` now lists `itadmin`; 372 routes, 0 unguarded.
> - `docs/ROLE-CAPABILITIES.md` §10 and `docs/SECURITY-MATRIX.md` §2 (B11) updated.
> - `node scripts/check.js` all green; `app` `tsc`/`vite` green; **full suite 932/932 pass, 0 fail, 0 cancelled**.
>
> **Scope:** server-side authorization only. No UI change is strictly required (the IT-admin
> screens already exist); the client is render-only and the server is authority.
>
> **Safety:** this change is a **net security improvement** — it removes two existing escalation
> paths while granting student admission.

---

## 1. Objective

Make the built-in **`itadmin`** role the school's **onboarding authority**:

| Actor | May create | May NOT create |
|---|---|---|
| `owner` | everyone **except `owner`** | `owner` |
| `itadmin` | **students** (create + bulk import) and every account role **except `owner` and `principal`** — incl. teacher, coordinator, counselor, finance, finance_head, finance_clerk, admissions, transport, facilities, technician, librarian, parent; plus custom roles | `owner`, `principal` |
| everyone else | unchanged | unchanged |

Additional rule: **only the owner may create a custom role whose `base_role` is `principal`.**
No one may create a custom role based on `owner` (owner accounts cannot carry an overlay anyway).

---

## 2. Current behavior (evidence)

| # | Capability | Current gate | File:line |
|---|---|---|---|
| 1 | Create student | `require('owner','principal','coordinator','admissions')` | `server/src/routes.js:615` |
| 2 | Bulk import students | `ROSTER = ['owner','principal','coordinator','admissions']` | `server/src/plugins/people.admin/index.js:46,543` |
| 3 | Provision accounts | `ADMIN = ['owner','itadmin']` — **itadmin can create `principal`** | `server/src/plugins/people.admin/index.js:45,77` |
| 4 | Create custom role | `base_role` must be in `ROLES` — **itadmin can choose `principal`** | `server/src/routes.js:453` |
| 5 | Update custom role base | same check on PATCH | `server/src/routes.js:487` |
| 6 | Owner-creation refusal (pattern to mirror) | audited then 403 | `server/src/plugins/people.admin/index.js:94-106` |

Already correct / unchanged:
- `itadmin` can provision every role except `owner` (`ADMIN`, `ROLES_NO_OWNER`).
- `itadmin` can create/assign custom roles (`ROLES_ADMIN = ['owner','itadmin']`, `routes.js:434`).
- `GET /students` staff gate already includes `itadmin` (`STAFF_ROSTER_ROLES`, `routes.js:942`).
- Owner-creation is already refused and audited (`people.admin/index.js:94-106`).

---

## 3. Exact edits

### Edit 1 — allow itadmin to create students
**File:** `server/src/routes.js:615`

Before:
```js
  app.post('/students', { preHandler: require('owner','principal','coordinator','admissions') }, async (req, reply) => {
```
After:
```js
  app.post('/students', { preHandler: require('owner','principal','coordinator','admissions','itadmin') }, async (req, reply) => {
```

### Edit 2 — allow itadmin to bulk-import students
**File:** `server/src/plugins/people.admin/index.js:46`

Before:
```js
  const ROSTER = ['owner', 'principal', 'coordinator', 'admissions']; // roster authority
```
After:
```js
  const ROSTER = ['owner', 'principal', 'coordinator', 'admissions', 'itadmin']; // roster authority
```
(`ROSTER` is used only by the import door at line 543, so this edit is contained.)

### Edit 3 — block itadmin from creating a principal
**File:** `server/src/plugins/people.admin/index.js` — insert **after** the owner-refusal block
(after line 106, before the `ROLES_NO_OWNER.includes(role)` check on line 107):

```js
    if (role === 'principal' && req.user.role !== 'owner') {
      // Mirror the owner-refusal contract: the ledger row must COMMIT before the 403 is sent.
      await withUser(req.user.tenant_id, req.user.role, async (c) => {
        await requestAudit(c, req.user.tenant_id, ID, {
          actor: req.user.name, action: 'Attempted principal provisioning (refused)', recordType: 'User', recordRef: email,
          reason: `role requested: principal by ${req.user.role}`, policyRef: 'Platform §2.4 (identity & access)', risk: 'high',
          outcome: 'refused — only the school owner may create a principal account' });
      });
      return bad(reply, 'Only the school owner can create a principal account', 403);
    }
```
Note: the owner still passes (owner is the only role allowed to create a principal).

### Edit 4 — block itadmin from creating a custom role based on principal/owner
**File:** `server/src/routes.js:453` (inside `POST /roles`)

Before:
```js
    if (!ROLES.includes(b.base_role)) return bad(reply, `base_role must be one of: ${ROLES.join(', ')}`);
```
After:
```js
    if (!ROLES.includes(b.base_role)) return bad(reply, `base_role must be one of: ${ROLES.join(', ')}`);
    if (b.base_role === 'owner') return bad(reply, 'A custom role cannot be based on the owner role');
    if (b.base_role === 'principal' && req.user.role !== 'owner')
      return bad(reply, 'Only the school owner can create a custom role based on the principal role', 403);
```

### Edit 5 — same guard on custom-role update
**File:** `server/src/routes.js:487` (inside `PATCH /roles/:key`)

Before:
```js
      if (!ROLES.includes(base)) return bad(reply, `base_role must be one of: ${ROLES.join(', ')}`);
```
After:
```js
      if (!ROLES.includes(base)) return bad(reply, `base_role must be one of: ${ROLES.join(', ')}`);
      if (base === 'owner') return bad(reply, 'A custom role cannot be based on the owner role');
      if (base === 'principal' && req.user.role !== 'owner')
        return bad(reply, 'Only the school owner can create a custom role based on the principal role', 403);
```

---

## 4. Tests to add / update

> The suite is per-file DB (`setupTestDb()` drops + migrates + seeds). Add the assertions below.

| Test file | Change |
|---|---|
| `server/tests/students-lifecycle.test.js` | Add: `itadmin` can `POST /students` → 200. Keep parent/student 403 assertions. |
| `server/tests/wave-b.test.js` | Add: `itadmin` can `POST /plugins/people.admin/import/students` → 200 (currently tested with coordinator). Add: `itadmin` creating `role:'principal'` → **403** and a ledger row `action ILIKE '%principal provisioning%'` with `outcome ILIKE '%refused%'`. Add: `owner` creating `role:'principal'` → **200**. Keep the existing owner-refusal test. |
| `server/tests/custom-roles.test.js` | Add: `itadmin` `POST /roles` with `base_role:'principal'` → **403**; `owner` same → **200**. Add: `base_role:'owner'` → **400** for both. Add the PATCH variant. |
| `server/tests/frontend-grants.test.js` | Verify the client role mirror is unaffected (it compares role *names*, not door gates) — run; fix only if it asserts gate membership. |
| `server/tests/rbac-plugin-edge.test.js`, `rbac-counselor.test.js` | Run; update only if they assert `itadmin` is denied student creation. |
| Any test asserting `itadmin` 403 on `POST /students` | Flip to 200. Search: `rg -n "itadmin" server/tests | rg -i "student"`. |

Also confirm no test asserts the exact literal role list string for `POST /students`; if one does,
update it to include `itadmin`.

---

## 5. Generated artifacts & docs to regenerate/update

1. **Regenerate the permission matrix** (do not hand-edit):
   ```
   cd server && node scripts/permission-matrix.js
   ```
   This rewrites `docs/PERMISSION-MATRIX.md`. Confirm the `POST /students` row now lists `itadmin`
   and the route counts remain sane (no new UNGUARDED doors).
2. `docs/ROLE-CAPABILITIES.md` — update the itadmin capability description to include student
   admission and the owner/principal creation exclusion.
3. `docs/SECURITY-MATRIX.md` — note the new rule "only the owner may create principal/owner
   accounts and principal-based custom roles" under identity authority.
4. If `docs/VERIFICATION.md` is regenerated by CI, let CI regenerate it.

---

## 6. Verification steps (definition of done)

```bash
# 1) server unit/integration
cd server && npm test            # expect all green (after test updates)

# 2) gates
cd server && node scripts/permission-matrix.js && node scripts/check.js

# 3) frontend build (no expected change, but must stay green)
cd app && npx tsc --noEmit -p tsconfig.app.json && npx vite build

# 4) restart the API, then manual checks against a scratch tenant:
#    as itadmin:
#      POST /students                         -> 200
#      POST /plugins/people.admin/import/students -> 200
#      POST /plugins/people.admin/users {role:'principal'} -> 403 + audit row
#      POST /roles {base_role:'principal'}    -> 403
#    as owner:
#      POST /plugins/people.admin/users {role:'principal'} -> 200
#      POST /roles {base_role:'principal'}    -> 200
```

Manual checks use the seeded demo accounts (`@meridian.edu`, password `schoolos-demo`) on a
scratch/test DB — **do not** run them against the live simulation tenant.

---

## 7. Security review notes

- **Escalation paths removed:** (a) itadmin → principal account; (b) itadmin → custom role based
  on principal. Both are closed by Edits 3–5.
- **New capability:** itadmin gains student creation + import. This is the stated requirement and
  matches the role's "identity & roster administration" charter.
- **Audit:** the principal refusal is written to the hash-chained ledger with `risk:'high'`,
  mirroring the owner-refusal contract (commit-before-send).
- **Least privilege preserved:** owner remains the only role that can mint owner/principal; the
  custom-role amplification ceiling is unchanged and still applies to itadmin-created roles.
- **Platform-wide effect:** this changes the built-in `itadmin` role for **all tenants**. That is
  the intent ("the itadmin role should have the access"). If a tenant-scoped variant is ever
  wanted, use a custom-role overlay instead — but note overlays cannot express the
  target-role-based principal exclusion, which is why Edits 3–5 are code.

---

## 8. Out of scope (decide separately)

- **Student lifecycle** — `transfer`, `patch`, `promote`, `withdraw` remain
  owner/principal/coordinator (withdraw owner/principal). Add `itadmin` only if "admit" is meant
  to include post-admission management.
- **Class assignments** (`POST /class-assignments`) — remains owner/principal/coordinator.
- **One-step custom-role provisioning** — `POST /plugins/people.admin/users` does not accept
  `role_key`; assigning a custom role is a second call (`POST /roles/:key/assign`, already
  itadmin-allowed). Adding `role_key` to provisioning is a separate change.

---

## 9. Rollback

- Revert the five edits (they are small and isolated). Audit rows already written remain
  (append-only by design) — that is correct.
- Re-run `node scripts/permission-matrix.js` and the test suite after rollback.

---

## 10. Reviewer checklist (for the audit session)

- [x] Edits 1–5 applied exactly as specified.
- [x] Principal-refusal audit row present and `risk:'high'` (wave-b test).
- [x] Owner can still create principal and principal-based custom roles.
- [x] `docs/PERMISSION-MATRIX.md` regenerated; `POST /students` row includes `itadmin`; 0 unguarded.
- [x] New/updated tests present and green.
- [x] `npm test`, `scripts/check.js`, frontend build all green.
- [x] No change to student lifecycle / class-assignment gates (unless separately approved).
