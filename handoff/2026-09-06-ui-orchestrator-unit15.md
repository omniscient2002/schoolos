# UI unit 15 handoff — ops.visitors gate-pass board

**FROM:** ui-agent
**TO:** orchestrator
**STATUS:** done
**Commit base:** 9f283a5 (units 13+14) — changes in working tree, app/src only
**Audit:** `logs/u15-final.txt` — exit 0, TOTAL_FINDINGS=1 (1 MINOR, probe-scoping note; 0 console errors)
**Scope:** wave-2 UI surface set closed (admissions.funnel + ops.visitors)

## 1. Placement decision: standalone `/visitors` route (rationale)

Reception.tsx is the **AI-call surface** (phone/WhatsApp/walk-in call handling with its own evidence-trace mental model) — the gate-pass desk is a different op with a different rhythm (badges, OTPs, physical release). A separate route keeps Reception calm and gives the fail-closed release gate room to be **loud**. Nav item ('Visitors', Shield icon) added for the four DESK roles, plugin-gated via `useKernelNav` through the manifest's declared `routes: [{ path: '/visitors' }]` — it disappears automatically if the server flag turns off (server truth wins, same pattern as unit 14). Route is in `staffOnly` (Guard blocks light roles before the page even loads).

## 2. The board — `app/src/screens/VisitorsBoard.tsx` (new)

Server truth from migration 024 (`server/src/plugins/ops.visitors/index.js`, read in full):
- **List** with DataTable sort API (5 sortable cols), badge codes in mono, relative timestamps.
- **Log visitor** (front desk): name/phone/purpose/detail + **student select for pickup purpose**. Pickup visits disclose the law at capture time: "Pickup visits release fail-closed: the guardian OTP must verify first." Badge `V-XXXXXXXX` lands in the success toast + row.
- **Lifecycle actions** per status, mirroring the server lattice: Check in (expected→checked_in), Request pickup OTP (raises the vault OTP), Enter OTP (verify modal), Release…/Complete, Deny (More-menu with optional note). Terminal rows show "Closed".
- **Release column — THE HEADLINE, rendered BEFORE any click**: every unverified pickup row carries a red `🔒 Blocked — guardian OTP required` chip; verified rows show `Authorized`; non-pickup rows show `gate pass`. A permanent banner states the law: *"Release law: no student leaves with a visitor until the guardian OTP verifies"* + invariant name `no_release_without_verification` + override disclosure.
- **Release modal (fail-closed, loud)**: red invariant panel with the server's law, the two clean paths (verify the OTP first / audited override), and the override form — **owner/principal only** (others see "Your role cannot override this gate" with no affordance), note field **mandatory** (button disabled without a note, enforced client-side; server enforces independently), count/capacity 200, plain-language warning that the bypass is a high-risk audit entry. Override success surfaces "UNVERIFIED RELEASE — OVERRIDE USED" with risk=high in the audit entry.
- **Verify modal**: 6-digit input (`inputMode=numeric`, `autoComplete=one-time-code`), devCode dev-badge (OTP_DEV_ECHO) mirroring Login's pattern, wrong-code 401s surface verbatim as error toasts.
- **Server-law surfacing**: every door error renders verbatim in toasts — the audit proves the honest 409 "no primary guardian phone on file — manual verification (photo ID at desk) required" surfaces as a toast when a student has no guardian phone.
- **Masking per server truth**: the visitors doors are **DESK-gated entirely** (teacher/finance/parent 403 on every door — unlike the funnel, no masked tier exists in the server). So non-DESK roles get an explicit restricted state: "Front-desk surface… The server rejects every door for other roles — there is no masked view of visitor PII." Zero rows, zero PII, zero actions (audit-asserted). No invented masked view — server truth wins.

## 3. Shared-surface changes (disclosed, additive)

- **`plugins/pluginRegistry.ts`**: +1 manifest — `ops.visitors` v1.0.0, class C, headless (settings/reports slots), `routes: [{ path: '/visitors' }]` for nav gating, `defaultEnabled: false`. Mirrors `server/src/plugins/ops.visitors/manifest.js` (invariants quoted in code).
- **`components/Shell.tsx`**: nav item for owner/principal/itadmin/coordinator. **Found a Sidebar quirk while wiring**: the sidebar **whitelists items into groups by label** — items not in a group list (Front desk, Maintenance, Demo, …) never render. 'Visitors' added to the Operating-loop group. Pre-existing ops items are affected the same way — worth a look if the sidebar ever drops items.
- **`App.tsx`**: `/visitors` route (lazy `VisitorsHost` with kernel gate + honest empty state when disabled), added to `staffOnly`.
- **`services/liveApi.ts`**: +8 additive wrappers (`apiVisitorsList/Log/Checkin/Pickup/Verify/Complete/Deny`) — **token handling untouched**. One real bug fix shipped through this: **`apiVisitorVerify` performs the request without the global 401-redirect** — the verify door returns 401 for *invalid/consumed/expired OTP*, which collided with `call()`'s session-expiry convention and would have **logged the desk out on a wrong guardian code**. Server lane owns the status code; flagging for their awareness (verify-door 401 ≠ session 401).

## 4. The id-space lesson (unit 14's drift cousin, server-side this time)

The pickup student-select initially read the **demo dataset** (`students`, `guardianLinks`, `guardianIdByStudent`) — wrong twice over: (a) the dataset uses `st_north_1`-style ids while the server validates against `app.students` UUIDs (the capture door 400s dataset ids server-side); (b) `guardianIdByStudent` is **empty in the live dataset payload** (0 keys; `guardianLinks` is populated). Fixed: the roster comes from **`apiStudents()`** (server domain, 101 students). One filter remains client-side for UX only (students with a phone-carrying guardian link) — the server re-validates at pickup and fails with the honest 409. *Also worth the server lane's attention: `guardianIdByStudent` ships empty from `/dataset`.*

## 5. Verification (logs/u15-final.txt, exit 0)

- **Owner**: nav item present, 5 sort buttons, law banner, badge codes, UI log form walk (purpose→student select→submit→toast+row), blocked chip **before click**, blocked modal (headline + invariant + note field), **override disabled empty → enabled with note → completed**, terminal rows closed.
- **Guardian-OTP verify path** (full happy path, seeded via the doors): pickup → pickup_pending → wrong code 401 (row stays pending, desk stays logged in) → devCode verify → **Guardian verified + Authorized** → Complete → Completed.
- **Coordinator** (DESK, non-override): full board + PII visible; blocked modal shows the **no-override variant** — no note field, no override button, "cannot override" explanation (walked in via Check in first; Release… correctly renders from checked_in onward).
- **Teacher**: restricted state, zero rows, zero PII/badge leak, zero actions.
- **Dark smoke**: board renders dark (body rgb(22,21,17)), danger badge 6.42:1, 0 pageerrors. Theme switch + sort/rows/skip-link regressions clean; widths 390/768/1920 swept; 0 console errors.
- **Keyboard walk of the headline control**: note field focusable, typed by keys, override enables, Escape closes without submitting.
- MINOR (probe-scoping, not a product gap): dev badge assertion only fires for UI-raised pickups; API-seeded ones verify via the echoed code directly.

## 6. Notes for the orchestrator / server lane

1. **Verify-door 401 collision** (§3) — server may want a distinct status for invalid OTP (409/422) to avoid the SPA auth-redirect convention; the client wrapper neutralizes it for now.
2. **`guardianIdByStudent` ships empty** from `/dataset` (§4) — demo-dataset parity gap, harmless once the UI reads the server roster.
3. **Sidebar label-whitelist** (§3) — 'Visitors' wired into the Operating-loop group; other role blocks may have items that never render.
4. **Seed guardian phones cover only 15 of 25 8-B students** (`slice(0,15)` in seed.js) — pickup on the others fails with the honest 409 by design; the audit's seeder asks the doors rather than guessing.
5. Test-visit accumulation on the meridian tenant (audit walks create completed/denied rows) — they read as a working desk log; flag if you want them purged.

## 7. Housekeeping

- Scratch deleted (`audit-unit15.mjs`); `contrast-matrix.mjs` remains as the persistent tool (disclosed unit 13). No worktree this unit (base commit served directly). `:4310` preview serving the final build. server/ diffs in tree are the sibling lane's — untouched.
- Backlog ledger: sortable rollout to remaining tables (mechanical) · Learning schedule-grid caption (product) · split-origin serving (infra) · AuthGate restore-path `setRole` drift (demo-model fidelity, unit 14 §4) · verify-door 401 status (server, §6.1) · sidebar label-whitelist refactor (ui, minor).
