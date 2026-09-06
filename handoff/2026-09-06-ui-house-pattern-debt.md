# UI house-pattern debt — standby filing (no code)

**FROM:** ui-agent
**TO:** orchestrator
**STATUS:** filed — document only, zero code changes this unit
**Context:** standby between unit 15 (95552bf) and the next surface (cbse / wave-3 tail) or RC visual audit. Facts below were re-verified against the tree today; nothing is from memory.

Categories: A correctness-adjacent · B pattern extraction (wave-3 boards are the next consumers) · C a11y · D mechanical/product · E tooling · F data hygiene · G server-lane coordination. Effort: S <1h · M ~half-day · L day+.

## A. Correctness-adjacent (shared surface / sign-off zone)

**A1. AuthGate restore-path `setRole` drift — M, needs your sign-off.**
`App.tsx` AuthGate calls `setRole(mapAccountRole(role))` only in the Login path; the `/me`-restore path never does, so the store's `session.roleId` stays at its `'principal'` default for restored sessions and drifts from the authenticated identity. Unit 14 proved it live (teacher restored session carried principal-grade client gates). Server enforcement makes it a demo-preview fidelity issue, not a hole — but any client gate reading `session.roleId` in live mode is suspect. Two clean fixes: (a) restore-path calls `setRole` too, or (b) deprecate store-role gating on live surfaces in favor of `useSession().role` (FunnelBoard/VisitorsBoard already do). AuthGate is sign-off zone — not touched.

**A2. No ESLint config in app/ — M.**
Verified: no `eslint*` file, no eslint dep in package.json. Consequence: the hooks-after-early-return hazard that produced **React error #310 live in unit 15** (a `useMemo` below early returns in VisitorsBoard) is statically unguarded, as are `react-hooks/exhaustive-deps` and a11y basics. `eslint-plugin-react-hooks` + `eslint-plugin-jsx-a11y` would have caught the #310 class pre-build and several of the C-items below. Recommend wiring it before the RC visual audit; I can do it as a UI-lane unit (config only, no source changes).

## B. Pattern extraction — the wave-3 boards (hr.leave, health.clinic, cbse) are the next consumers

**B1. Plugin board scaffold is duplicated ×2 — M, highest leverage.**
FunnelBoard and VisitorsBoard each re-implement: `LIVE_API` gate → Empty; DESK-role gate via `useSession`; kernel-enabled host component in App.tsx (`AdmissionsHost`/`VisitorsHost` — same 6 lines twice); three-tier loading (SkeletonCard → content / ErrorState w/ verbatim error / Empty); toast-verbatim-error surfacing; per-board audit-dispatch closure. A `PluginBoardHost({ pluginId, board })` + `useServerBoard(fetchers)` hook collapses the third+ fourth board to their actual content. Do it when the first wave-3 board lands, not before (two consumers is the minimum for a pattern; we're there).

**B2. `rel()` duplicated, house helper already exists — S.**
`FunnelBoard.tsx:48` and `VisitorsBoard.tsx:45` each define a private `rel()`; `lib/format.ts:30` already exports `fmtRelative(d: Date | string)`. Migrate both boards; new boards must use the house helper. (Found while writing this — the boards predate my reading of format.ts.)

**B3. `staffOnly` is a hand-maintained literal — S.**
`App.tsx` staffOnly is a 30-route string array; every new staff route relies on memory (I added `/visitors` by hand). Manifests already declare `routes` — deriving staff-gating from route metadata (or a `staffOnly: true` manifest flag) removes the failure mode.

## C. A11y

**C1. Modal primitive: no focus management — M, affects every modal surface.**
Verified: `components/ui.tsx` Modal renders `role="dialog" aria-modal="true"` but has **no focus trap, no initial focus, no focus-restore to trigger on close** (0 focus references in the body). The Dropdown primitive (unit 10) does APG menu-button focus correctly (focus-return on Esc, arrow roving) — Modal is the parity gap. Keyboard users can tab behind the overlay on: log visitor, release override, verify OTP, deny, and every pre-existing modal (Maintenance report, etc.). Recommend: initial focus to first focusable, Tab loop within dialog, focus-restore to opener. RC-visual-audit candidate.

**C2. Icon set gap: no ellipsis/more icon — S.**
Verified 0 matches for Ellipsis/MoreVert/MoreHorizontal in Icon.tsx. VisitorsBoard's row menu uses a text "More" trigger as a result; Admissions uses an icon (ArrowRight). Add one ellipsis glyph; unify row-menu triggers.

## D. Mechanical / product

**D1. Sortable rollout — M (mechanical).**
Sort API (unit 11) live on: Audit, Fees, People, FunnelBoard, VisitorsBoard. Unsorted majors remain: Group (campus table w/ sparklines), Maint* screens, Documents, Cases, ActionCenter. Mechanical per table; batch as one unit.

**D2. Funnel capture form absent in UI — S.**
The admissions.funnel capture door (session window + dedupe 409s) has no staff-facing form; the unit-14 audit used the door via API. Small modal reusing the FunnelBoard toast/verbatim-error pattern.

**D3. Funnel terminal side-exits are rows only — S.**
Rejected/withdrawn leads appear in the table + counts but have no collapsed section or filter; acceptable at v1, revisit if coordinators ask.

**D4. Board stat-grid styles hand-rolled — S (polish).**
`gridTemplateColumns: 'repeat(4/5, minmax(0,1fr))'` literals duplicated across screens (Admissions stats, both boards). A `.grid-4/.grid-5` responsive utility in components.css would absorb them; purely cosmetic.

## E. Tooling (relevant to the RC visual audit you signaled)

**E1. contrast-matrix.mjs fragility — S.**
Persistent (sanctioned) but regex-parses tokens.css/dark.css — breaks silently if token syntax drifts (e.g. color-mix in token values). Worth a smoke assertion (FAILS=0 on the committed baseline) added to its own run, or a tools/ home.

**E2. Pixel-proof methodology is paper-only — M, recommend before the RC visual audit.**
The fringe-physics tooling (channel-sum-Δ0 LCD fringe classification, nudge-bucket physics, same-build self-floor control, frozen-clock Date injection) was deleted after unit 13 per ritual; the methodology survives only in `handoff/2026-09-06-ui-orchestrator-unit13.md` and `logs/u13-pixel-verdict.txt`. The RC visual audit (your remaining-work item 2) will want it rebuilt — consider sanctioning a persistent `app/px-tools.mjs` (like contrast-matrix) so the proof is runnable, not remembered.

**E3. audit-lib.mjs absorption — S.**
Every unit re-writes: login(email)/gotoRoute-with-retry/console-error filters/role-matrix scaffolding/seed-via-door patterns. audit-lib.mjs is already sanctioned; extending it with those helpers makes future board audits (wave-3, RC) faster and consistent.

## F. Data hygiene (before RC)

**F1. Audit-seed accumulation on meridian — S.**
15 units of door-probing left intentional rows: admissions funnel (Audit Walk/Verify/Deny leads in terminal stages), visitors (completed/denied passes incl. ~10 `GuardianPhoneProbe` rows I denied post-probe; some `Audit *` rows remain in expected/checked_in). They read as a working desk log, but RC should either purge them or seed realistic churn. No delete door exists on visitors (deny is terminal-close) — purging needs the server lane or a reseed.

## G. Server-lane coordination (routed by you already; tracked for closure)

**G1. Verify-door 401 status — S, blocked on plugin agent.** Client workaround (`apiVisitorVerify` no-redirect wrapper) shipped in 95552bf; when the door adopts a non-401 status, delete the wrapper and route through `call()` again. The wrapper duplicates `call`'s fetch/error-shape by design — it's the only place.
**G2. `guardianIdByStudent` empty in /dataset payload — S.** Demo-dataset parity gap; UI already migrated to server roster.
**G3. `/students` has no stable ORDER BY — S.** Any consumer assuming row order (as my first audit seeder did) is flaky; audit tooling now asks the doors instead.

## Priority read

If you want a single ordering: **A2 (ESLint) → C1 (Modal focus) → B1 (board scaffold) → E2 (px-tools)** as the standby/RC set — A2 and C1 are shared-surface correctness/a11y, B1 pays for itself on the first wave-3 board, E2 makes the RC visual audit a rerun instead of a rebuild. B2/D1/D4 are mechanical fillers; G1 unblocks itself when the plugin agent moves.

No code changed in this unit. Standing by for cbse / cycle-5-6 verdicts / RC signal.
