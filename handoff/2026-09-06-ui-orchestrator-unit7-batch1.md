FROM: ui-agent
TO: orchestrator
STATUS: done

UNIT 7 · BATCH 1 — /people /learning /operations /fees /attention /today /ask /maintenance
Role matrix walked: owner@meridian.edu AND parent@meridian.edu (localStorage cleared between roles). Method as agreed + your two additions (role matrix; table interaction on /fees and /maintenance). Ritual: tsc 0 errors, build 1.1s, preview per pkill law, Playwright audit (playwright-core, retry ×5), scratch cleaned. Final audit: exit 0 — BLOCKER 0 · MAJOR 0 · CONSOLE 0 · FINDINGS 3 (all intentional backlog, below). Sweep 1920/768/390 clean; console-error budget clean on steady state (one transient ERR_CONNECTION_REFUSED mid-run traced to a preview restart, not the app — reproduced 0 failures in a 30s networkidle probe).

DISCLOSURE — App.tsx touched (lane ruling on auth semantics)
The role-gate BLOCKER below lives in Guard/Frame (App.tsx). I changed ONLY those two functions' light-role derivation and the staffOnly list. AuthGate's token handling, /me validation, and login flow are untouched; liveApi.ts untouched. If you consider Guard/Frame off-lane too, the revert is 3 one-line diffs listed in the ledger.

SEVERITY LEDGER (found → disposition)

BLOCKER (9 found → 9 fixed)
1. Role gates were DEAD CODE: Guard compared `session.roleId`, but SessionUser is {name, role, email} — no roleId field exists, so `light` was always false and parent/student could open every staff console (verified: parent@meridian.edu saw full /fees, /operations, /attention… with real data). Fix (App.tsx Guard + Frame): light = live authenticated role ('parent'|'student' via useSession) OR demo view switcher. Parent now lands on the calm gate ("Not available on this account") on all 8 routes; no staff-domain words leak past the gate.
2. '/maintenance' was missing from the staffOnly list entirely (the work-order console with SLA boards + technician names was open to light roles). Added; subroutes (work-orders, assets, technician) inherit the gate.
3. (Reclassified) '/parent never rendered' was an audit probe artifact — ParentHome renders an <h1> greeting, not .page-head; probe now accepts h1. /parent renders, 0 staff-only links found.

MAJOR (8 found → 8 fixed)
4. 60 click-only rows on /fees (DataTable `<tr onClick>` — no keyboard activation). Fix: tabIndex=0 + Enter/Space handler + `:focus-visible` row outline in CSS. Applies to every DataTable consumer app-wide.
5. Maintenance tabs declared role="tab" but arrows did nothing (Enter/Space worked). Fix: Tabs component now implements WAI-ARIA roving tabindex (ArrowLeft/Right/Home/End move selection + focus; only the active tab is a tab stop) in both pill and plain variants; tabs gained ids/data-tab-id.
6. MobileTabbar keyed its destinations on the demo switcher roleId (default 'principal') — a parent login was offered Today/Attention/Ask/Ops/People on mobile. Fix: authenticated role first, switcher override (mirrors Guard derivation; note the circular import App.tsx ⇄ DemoBar.tsx compiles and runs clean).
7–8. Four "no visible focus ring" findings on inputs/selects were AUDIT FALSE POSITIVES — components.css:65 gives .input/.select/.textarea an accent-border + 3px halo on :focus, which my outline-only heuristic couldn't see. Auditor now counts box-shadow; the CSS was already correct. No product change.

MINOR (fixed this batch)
9. --text-3 #8A8C91 → #6B7075: 3.36:1 → 5.0:1 on surface, ≥4.6 on every surface tint (systemic .u-faint counts/labels).
10. badge-warning text on --warning-weak was 2.82:1 → #92400E (6.27:1).
11. Touch floors: --ctl-h-sm 26→32px (all .btn-sm — topbar Sync/Ask/search/notifications/account, approve/dismiss actions), .iconbtn 30→32px, .tabs-pill .tab min-height 32 + count color to --text-2, .nav-item min-height 32, sidebar 30px links gone.
12. DataTable th now scope="col" app-wide.

BACKLOG (reported, deliberately not fixed — need product/design calls)
13. MINOR: no role="tabpanel" regions / tab ids unlinked (Tabs doesn't own the panel; needs a small API change in Tabs consumers).
14. POLISH: /fees data tables have no <caption>; no sortable headers exist (sort UX absent, not broken — if you want sort, that's a DataTable API addition, happy to spec it).
15. POLISH: 32px floors are set; 44px touch guidance would need a coarse-pointer media query (desktop-first app — your call).

OPEN FOR ORCHESTRATOR
A. The store's demo switcher still never syncs with the login identity (the deeper bridge lives in AuthGate — out of my lane). With today's fix this no longer affects gating or the tabbar, but the avatar switcher remains the only way the store roleId changes. If you want login identity to seed the switcher, that's a 2-line AuthGate change for the auth owner.
B. Staff previewing 'parent' via the avatar switcher now sees the calm gates (coherent with the gate copy "Switch to a staff demo role…"). If you want switcher previews to stay full-access, drop the `|| session.roleId` clause in Guard/Frame (2 diffs).
C. Server drift note: registry rows moved 5→6 enabled during the run (sibling activity); /maintenance gate additions are client-side only.

FILES CHANGED (all app/src)
App.tsx (Guard/Frame light-role + staffOnly+=/maintenance) · components/ui.tsx (DataTable keyboard rows + scope=col; Tabs roving arrows) · components/DemoBar.tsx (MobileTabbar role derivation) · screens/Maintenance.tsx (Map link touch floor) · styles/tokens.css (--text-3, --ctl-h-sm) · styles/components.css (row focus ring, nav-item/tab/iconbtn/tabs-pill floors, badge-warning AA)

NEXT: Batch 2 (/library /documents /calendar /insights /automation /audit /cases /memory) on your go.
