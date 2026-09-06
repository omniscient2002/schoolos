FROM: ui-agent
TO: orchestrator
STATUS: done

UNIT 7 · BATCH 2 — /library /documents /calendar /insights /automation /audit /cases /memory
Role matrix: owner + parent (localStorage cleared between roles). Same method + your dense-list additions (empty-state honesty; pagination/scroll at 390). Ritual: tsc 0 errors, build 511ms, preview per pkill law, Playwright audit ×5-retry, scratch cleaned. Final audit: exit 0 — BLOCKER 0 · MAJOR 0 · CONSOLE 0 · TOTAL_FINDINGS 1.

AUDIT BASELINE NOTE
/library currently renders the kernel's honest not-enabled gate (server registry row disabled — sibling testing flips it; re-enablement is a server call, not a UI state). The audit treats this as the correct, honest surface and was fixed to probe it as one.

SEVERITY LEDGER

BLOCKER (2 found → 2 fixed, one root)
1. KernelGate's not-enabled Empty had no page-level heading — every gated route (e.g. /library) had zero <h1>, breaking heading order from the jump. Fix: shared Empty component gained a `titleAs` prop (default 'h3' — zero impact on all existing callers); KernelGate passes titleAs="h1" so the not-enabled gate is a real page heading. This also future-proofs every route that can land in a gated/error Empty state.

MAJOR (1 found → fixed)
2. Calendar type-toggle pills (PTM/Exam/Trip…) were 27px touch targets — inline-style buttons. Fix: minHeight 32 on the toggle set (aria-pressed already present and verified working).

MINOR (audit-side, corrected — no product change)
3. /audit "role filter changed but row count identical": the audit ledger mirror starts session-empty (historical audit entries are server-side; the mirror doesn't hydrate them — same mirror-gap class unit 6 documented). Filters operate (both labeled selects accept keyboard) and the honest empty state renders ("No entries match these filters" — verified with a forced-empty filter walk: rows=0, honest=true). Expected mirror behavior, reported per the report-don't-invent rule; not papered over in the auditor.

VERIFIED CLEAN (explicitly tested, nothing to fix)
- Parent matrix: /documents /calendar /insights /automation /audit /cases /memory all gated=true, no staff-domain words leak; /library (shared parent surface) renders for parent with 0 staff-only links and an 11-stop keyboard walk.
- Empty-state honesty: /audit forced-empty → "No entries match these filters"; /memory no-hit search → "Nothing in memory matches" (both honest, both keyboard-reachable).
- /documents upload modal: opens, labelled ("Upload document"), Esc closes.
- Dense lists at 390: /audit table sits in .table-wrap (668>362px inside an overflow-x:auto container) — page-level h-overflow clean at 1920/768/390 on all 8 routes.
- Keyboard: 20–26 stops per route owner-side, all rings visible, no traps, no positive tabindex, no unnamed controls.
- Console: 0 errors across the whole run.

BACKLOG (no new items this batch; standing items from batch 1 unchanged)
- /audit sortable headers + <caption> (part of the standing DataTable sort/caption spec call).
- Server-side audit history hydration into the mirror (server lane, not UI).

FILES CHANGED (all app/src)
components/ui.tsx (Empty titleAs prop) · plugins/useKernel.tsx (KernelGate h1) · screens/CalendarScreen.tsx (toggle pill touch floor)
No auth-surface files touched this batch. No server changes; /library enablement state is server-held and was left exactly as found.

NEXT: Batch 3 (/reception /admissions /operations/hr /it /data-health /ai-governance /ai-usage /constitution) on your go.
