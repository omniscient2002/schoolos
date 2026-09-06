# UI unit 14 handoff — admissions.funnel board

**FROM:** ui-agent
**TO:** orchestrator
**STATUS:** done
**Commit base:** ae4fefa — changes in working tree, app/src only
**Audit:** `logs/u14-v6.txt` — exit 0, TOTAL_FINDINGS=0 (owner + teacher paths, capture→form→withdrawn lifecycle, masking, dark, regressions)

## 1. Check result: there was NO UI for admissions.funnel v1.1

`/admissions` renders the demo-lane kanban (admissionsService mock, 7-stage core lattice). Zero app code referenced the plugin doors. Server state: `admissions.funnel enabled=True` on meridian (v1.1 runtime, migrations 018+022), manifest class C / T1.

## 2. What I built — `app/src/screens/FunnelBoard.tsx`

A server-truth funnel board replacing the demo kanban on `/admissions` **while the server flag is on** ("server flag wins" — enforced via kernel `isEnabled`, which resyncs from the server registry):

- **DataTable** (unit-11 sort API: 5 sortable columns, rowKey tiebreak, aria-sort): Student+class, Guardian, Source, Stage chip, Updated (relative). House three-tier: SkeletonCard → content / ErrorState with retry / Empty.
- **Stage chips**: Badge tones mapped to the server lattice (enquiry→info, form→info, interaction→accent, offer→ai, enrolled→success, rejected→danger, withdrawn→warning).
- **Transitions (ADMIN roles only)**: inline `Form`/`Interaction` buttons + `More` menu (house Dropdown, APG menu-button semantics) for `Accept offer` and side exits (`Mark rejected/withdrawn`). Server-lattice mirror drives only *which buttons to offer* — the server is the enforcer; 409s surface verbatim in toasts.
- **Lifecycle walked in audit**: capture door (POST, unique phone beats dedupe guard) → enquiry→form (refetch reflects) → history drawer (`enquiry → form` trail) → interaction→withdrawn → row shows **Withdrawn + Terminal**. Terminal rows offer no moves (regression asserted).
- **offer→enrolled surfaces the kernel law**: success toast + audit entry disclose `students.create` raised as an approval action for the Principal (plugin never writes core students); an office-view note card counts offers awaiting decision.
- **PII masking = server truth**: the `masked` flag from GET /leads decides the view. Teacher: guardian column shows a Masked chip, sub-line discloses the masking tier, zero full phone digits (audit asserts regex), zero transition buttons (Read-only), no transition buttons regardless of client role. History: per-lead More-menu item, drawer with ordered trail (stage→stage · actor · relative time).
- **Stats row**: server `/summary` when the role can reach it (ADMIN-only door — teacher's fetch would 403, so it's skipped and counts degrade to the fetched leads page; counts are not PII, disclosed in code). Cumulative SegmentedBar over the funnel path.

## 3. Shared-surface changes (disclosed, additive)

- **`plugins/pluginRegistry.ts`**: +1 manifest — `admissions.funnel` v1.1.0, class C, headless (slots settings/reports), `defaultEnabled: false`. Mirrors `server/src/plugins/admissions.funnel/manifest.js`. Without a registry entry the kernel resync can never enable it client-side (the set only admits registry-known ids).
- **`App.tsx`**: `/admissions` route now renders `AdmissionsHost` = `isEnabled('admissions.funnel') ? <FunnelBoard/> : <Admissions/>`. Kernel flag is server-resynced; disabled → demo kanban returns. No Guard/staffOnly changes.
- **`services/liveApi.ts`**: +4 additive wrappers (`apiFunnelLeads/MoveStage/History/Summary`) + `LIVE_BASE` export. **Token handling byte-untouched** (`setToken`/`call`/auth logic).
- **`plugins/useKernel.tsx` — 2 fixes, both real bugs the board exposed**:
  1. Resync used a **relative** `/plugins` fetch — silently no-ops whenever the API isn't same-origin (audit serving on :4310; the known split-origin backlog item). Now `${LIVE_BASE}/plugins` — identical to every other door's base chain (`VITE_API_BASE` env, collapsing to relative in same-origin deploys — the deploy contract is preserved exactly).
  2. Resync no-oped when the token didn't exist **at provider mount** — fresh browsers kept plugin enablement at defaults until the next reload (AuthGate mounts the provider pre-auth). Now bounded-waits for the token (40×250ms, same pattern as the dataset loader).

## 4. The role-gate lesson (worth the orchestrator's attention)

First cut gated actions on the store's `session.roleId` — wrong: **AuthGate's session-restore path never calls `setRole`** (only the Login path does), so store roleId stays at its `'principal'` default for restored sessions and drifts from the authenticated identity (my teacher probe saw principal-authorized buttons). Fixed by gating on `useSession().role` — the live server role (same source AuthGate validates via `/me`; DemoBar already imports it). Pre-existing demo-lane quirk: any store-role-based client gating in live mode has this drift. Server enforcement makes it a preview-fidelity issue, not a security hole — but flagging it for whoever owns the demo role-preview model. *(AuthGate is sign-off zone; not touched.)*

## 5. Verification

- `logs/u14-v6.txt` exit 0: owner (unmasked PII, 5 sort buttons, capture→form→history→withdrawn+Terminal, old terminal rows immutable), teacher (masked chips, no phone digits ≥6, no transition buttons, masking disclosed in sub), 0 console errors, widths 390/768/1920, dark smoke on the board (badge 6.73:1, primary ink on dark gradient 6.24:1, sort 15.18, 0 pageerrors).
- `tsc` clean, `vite build` clean; scratch (`audit-unit14.mjs`) deleted; `:4311` + `.wt-u13` removed; `contrast-matrix.mjs` kept (disclosed in unit-13 handoff).

## 6. Not built (deliberate scope, note for backlog)

- **Capture form in UI** — the door exists and the audit uses it via API; a staff-facing capture form (with session-window + dedupe 409 messaging) is a small follow-up.
- **Stage history inline per-lead is a drawer, not inline expansion** — fine for minimal; revisit if coordinators want side-by-side.
- **ops.visitors gate-pass surface**: server plugin is live (enabled=True, v1.0/024). Rides the same pattern (kernel flag → server-truth board on an existing route, or its own lane per orchestrator). Ready to build on signal.

## 7. Backlog updates

- ~~split-origin /plugins~~ — **resolved for the kernel resync** (LIVE_BASE); the broader split-origin serving item remains infra.
- NEW (minor): AuthGate restore-path `setRole` drift — demo role-preview fidelity (§4).
- NEW: funnel capture form in UI; terminal-stage leads are list-rows only (no side-exit section) — acceptable at v1.
