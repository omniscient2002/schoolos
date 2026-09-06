FROM: ui-agent
TO: orchestrator
STATUS: done

════════════════════════════════════════════════════════════
UNIT 7 · A11Y + RESPONSIVE ROTATION — ROTATION SUMMARY (1 page)
════════════════════════════════════════════════════════════
4 batches · 34 routes walked · 3 roles (owner / parent / student) · method: role matrix, keyboard walk (first-Tab-stop + rings + traps), contrast math, landmarks/heading order, touch targets, 390/768/1920 sweep, console budget, severity tags. Every batch ended exit-0-clean before acceptance.

BATCH 1 (56595e9) — /people /learning /operations /fees /attention /today /ask /maintenance
  HEADLINE: role gates were DEAD CODE — Guard compared session.roleId (field doesn't exist on SessionUser) so parent/student could open every staff console. Fixed: live-role-first derivation in Guard/Frame; /maintenance added to staffOnly (was absent); MobileTabbar de-synced from the unsynced switcher. 60 click-only /fees rows → keyboard parity; Maintenance tabs → roving-tabindex arrows; focus-ring false positives corrected (inputs use border+halo). 206→3.

BATCH 2 (82b3303) — /library /documents /calendar /insights /automation /audit /cases /memory
  KernelGate not-enabled states had no H1 → Empty.titleAs (default h3, zero impact) + KernelGate h1. Calendar toggle pills floored. Empty-state honesty PROVEN (forced-empty walks render honest messages). Dense lists at 390: .table-wrap scrolls internally, zero page overflow. Mirror gap documented (/audit ledger starts session-empty) — reported, not invented.

BATCH 3 (2c3cb2d) — /reception /admissions /operations/hr /it /data-health /ai-governance /ai-usage /constitution
  SKIP-LINK shipped (first focusable, hidden→focus, Enter focuses <main tabIndex={-1}>); asserted on every route. PII zero-leak 8/8 (salary/CTC/₹/Aadhaar/PAN/phone patterns). Posture/budget states verified text+color redundant (AUTO/APPROVAL/HUMAN-ONLY; "70% of monthly budget") — old RT color-only risk closed. Card.headAs pattern introduced (Reception H1→H2×5). Constitution: 1 H1 + 3 H2 + chip floors. 0 final findings.

BATCH 4 (this ship) — /parent /student surfaces, /migration /next /group /settings, PersonDetail, 404
  Sharpest PII edge: parent AND student blocked from /people/:id (own child included — "or nothing" per your spec; directory uses keyboard rows, activation flow verified). 404: H1 + way-back, UNIFORM for unknown routes, distinguishable from the calm gate (no route-existence enumeration). /settings: parents can open it (by design) — zero staff links, no role-grant control (Manage is itadmin-only toast, others see Lock); role switching exists ONLY in the avatar demo switcher (demo affordance, accepted per batch-1 ruling). Calm surfaces: /parent /parent/fees /parent/ask /student /student/learning /student/portfolio /student/ask — zero staff vocabulary. Fixes: 4 card links floored (19→32), 16 top-level cards headAs="h2" (ParentHome 4, StudentHome 4, Migration 8) killing 5 H1→H3 skips. 9→0.

FINDINGS BY SEVERITY (audit-reported, all dispositioned)
  BLOCKER 10 → fixed 10 (8× ungated staff routes + /maintenance omission + 2× gate-page H1 root)
  MAJOR 14 → fixed 10, 4 auditor false positives (documented, heuristic corrected)
  MINOR ~30 → fixed 29 (tokens, scope=col, touch floors, heading order, 404), 1 tracked (tabpanel wiring)
  POLISH 3 → tracked (captions, sortable headers, 44px coarse-pointer)
  ENVIRONMENTAL 3 preview deaths (sibling activity) — retry law absorbed, never a product issue

SYSTEMIC FIXES NOW HOUSE STYLE
  1. Role derivation: live authenticated role first, demo switcher override (Guard/Frame/MobileTabbar + your AuthGate↔switcher bridge) — the dead-code class is closed at both ends
  2. Empty.titleAs + Card.headAs: zero-impact heading-level opt-ins (batch 2/3/4)
  3. Skip-link + first-Tab-stop assertion baked into every keyboard walk
  4. DataTable keyboard rows (tabIndex+Enter/Space) — all tables app-wide
  5. Tabs roving-tabindex arrows (WAI-ARIA) in both variants
  6. Touch floors: --ctl-h-sm 32, .iconbtn 32, .nav-item 32, chips/pills 32
  7. AA tokens: --text-3 5.0:1, badge-warning 6.27:1; th scope="col" app-wide

BACKLOG (item → recommended owner)
  • DataTable sortable headers + <caption> spec → ui-agent after product sign-off on sort UX
  • role="tabpanel" wiring for Tabs consumers (needs Tabs API extension) → ui-agent, small
  • 44px coarse-pointer touch guidance (media query) → product call, then ui-agent
  • Mirror hydration: actions/events/audit into store (offline/mirror reads) → server lane (your scheduled hardening unit)
  • /library enablement flip after sibling testing settles → plugin/server owner
  • configured chip re-verification after plugin-agent's next ship → ui-agent (pending, standing)
  • Split-origin deploy contract for /plugins fetch → platform backlog (unit-4 verdict standing)

ROTATION VERDICT: 34 routes, 3 roles, 0 BLOCKER/MAJOR/console findings standing. The calm-surface promise is enforced by code (role-first gating), verified by audit (vocabulary + PII sweeps), and the a11y floor is now uniform app-wide.
