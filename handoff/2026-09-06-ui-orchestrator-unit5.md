FROM: ui-agent
TO: orchestrator
STATUS: done

WHAT CHANGED (unit 5)
1. app/src/components/ui.tsx — ToastProvider: error toasts now carry role="alert" (implicit aria-live=assertive, ARIA 4.3 — verified live: empty-name upload on /documents → .toast.error[role="alert"]). Success/info toasts keep the polite stack region (no role attr), verified not role=alert.
2. No other app changes — unit 5 was a verification pass; everything below is reported as-is per the "report what IS" instruction.

REAL-DATA WALK — the headline: the six routes ARE server-data-driven, via ONE hydration path
- data/dataset.ts calls GET /dataset after login (waits for token) and replaces the entire demo dataset in place (53 keys: students, feeObligations 1072, busRoutes 10, timetable 1368 slots, workOrders 8, cases…). Every walked route's only API traffic is /me + /dataset — that hydration is the data plane; services/index.ts then computes from it per campus scope.
- KPI SPOT-CHECK (real math, not non-empty): /fees UI "79.4%" == /dataset Σpaid/Σbilled for the owner's north campus (456 obligations) — EXACT match. Note /fees/obligations (500 rows, 81.4%) is a DIFFERENT server cut — do not compare UI to that endpoint.
- Walk results: /today /attention /fees /transport /maintenance /plugins all render; 0 console errors; 0 pageerrors; every observed .empty region is a designed all-clear state ("Nothing in this band", "No SLA risk — every open job has time in hand", "The marketplace gate is closed by design") — zero empty-state regressions. Layout 18/18 (6 routes × 1920/768/390) clean.

MIGRATION-010 COVERAGE — two timetable representations, one GPS surface
- dataset.timetable = 1368 slots → drives /today's now/next class band (live server data).
- plugin grid GET /plugins/ops.timetable/grid = 289 slots (your number), verified live as owner. NO shell surface consumes it — ops.timetable/transport.gps are headless class-B/C rails by rule (docs/11 §2.3, settings/reports slots only); the walk captured ZERO app requests to either runtime endpoint. If you want grid/GPS surfaces in the shell, that's a new-feature decision for unit 6 (widget in the attention slot is the natural vehicle). GPS positions table currently holds 1 row.

/PLUGINS divergence (owner vs principal) — reported as-is
- Owner (privileged): raw settings flow; comms.whatsapp carries settings.templates (DLT ids) → settings-keys derivation shows the "configured" chip. Verified rendering (chip on card, zero settings VALUES in DOM — asserted against bsp_provider/dlt_entity_id/sender_id and template bodies).
- Principal: the CURRENTLY DEPLOYED /plugins build returns configured:None for all rows (the P1-2 flag from routes.js:525 is not in the running build) → honestly shows no chips. When the flag ships, the UI shows it automatically (proved by unit-3's mocked-flag run: server-flag-wins). Chip sets agreed across roles at audit time.
- HEADS-UP: the plugin registry table is being actively rewritten by another agent (13 rows → 9; zz.redteam.* gone; a new '9lives' row appeared mid-audit). Server-flag-wins assertions stay valid because they read the flag at render time, but expect drift in row counts between runs.

AUDIT (attempt 1, TOTAL_ISSUES=0, CONSOLE_ERRORS=0)
- tsc 0 errors (re-verified after cleanup); VITE_LIVE_API=1 build success (564ms); preview per pkill law; scratch scripts cleaned.
- One audit-method note: login redirect means a second role login in the same context needs localStorage.clear() first (AuthGate bounces /login while authed) — documented for future multi-role runs.

FOR UNIT 6
- Your call needed: shell surfaces for ops.timetable grid (289 slots) + transport.gps positions (attention-slot widgets are the natural vehicle) — currently headless-by-rule, no consumer.
- Principal `configured` flag: routes.js:525 computes it but the deployed build doesn't return it — server-side follow-up for whoever owns that deploy.
- Toast success path: submitUpload's success toast fires after a ~900ms simulated delay — my check window missed it; code guarantees no role on non-error tones (conditional spread), error path verified live.
