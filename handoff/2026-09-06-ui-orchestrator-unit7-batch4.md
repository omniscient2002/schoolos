FROM: ui-agent
TO: orchestrator
STATUS: done

UNIT 7 · BATCH 4 — role-scoped tails: /parent /student surfaces, /migration /next /group /settings, PersonDetail, 404
Final audit: exit 0 — BLOCKER 0 · MAJOR 0 · CONSOLE 0 · TOTAL_FINDINGS 0 (9 found → 9 fixed → 0). Ritual: tsc 0 errors, build 482ms, preview per pkill law, Playwright ×5-retry, scratch cleaned.

YOUR FOUR SPECIFICS — RESULTS

1. 404/error page: PASSED. H1 present ("This page moved or never existed"), way back via home button (role-aware → /today for staff) + primary CTA. Enumeration check: parent hitting an unknown route gets the 404; parent hitting /fees gets the calm gate — the two renders are distinguishable (different h1/text), so staff routes cannot be probed via a distinct "404 vs gate" oracle. No staff-route names in the 404 body.

2. PersonDetail (sharpest PII edge): PASSED. Directory rows are keyboard rows; owner Enter-activates row 1 → real student id st_north_1. Parent + student hitting /people/st_north_1 BOTH get the calm gate ("Not available on this account") — the record never renders for light roles, including their own child's id: "or nothing" per your spec. Zero PII text in the parent's DOM.

3. /settings: PASSED. Parents CAN open /settings (not in staffOnly — by design, it's identity/branding surface): zero staff links, zero role-grant controls — the Roles & access tab is read-only for non-itadmin (Lock icon vs Manage button); role switching exists ONLY in the avatar demo switcher (demo affordance, accepted per batch-1 ruling + your d3cbe41 bridge). No dead-code-gate regression.

4. Calm surfaces: PASSED. /parent /parent/fees /parent/ask /student /student/learning /student/portfolio /student/ask — zero staff-vocabulary matches (approval spine / audit ledger / work orders / payroll / recruitment / enquiry pipeline / technician dispatch / salary / CTC). /migration /next /group gated for parent with no leaks.

FIXES SHIPPED (9 findings → 0)
- MAJOR ×4: card action links "Open chat" (/parent) and "Open learning" (/student) at 19px → floored to 32.
- MINOR ×5: heading skips H1→H3 on /parent /student /migration → 16 top-level cards promoted via Card headAs="h2" (ParentHome 4, StudentHome 4, Migration 8). Sequences now H1 → H2 ×N.
- Note: /parent /student walked for OWNER too (owner can preview light-role surfaces) — all clean.

ROTATION COMPLETE. One-page summary: handoff/2026-09-06-ui-orchestrator-unit7-rotation-summary.md (batches 1–4, severity tally, systemic fixes now house style, backlog with recommended owners).

FILES CHANGED (app/src): screens/ParentHome.tsx, screens/StudentHome.tsx, screens/Migration.tsx
