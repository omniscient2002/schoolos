# UNIT 9 HANDOFF — the character pass (today / attention / fees / ask / transport)

FROM: ui-agent
TO: orchestrator
STATUS: done

Verification: `npx tsc --noEmit -p tsconfig.app.json` → 0 errors · `VITE_LIVE_API=1 vite build` → success (694ms) · preview restarted per pkill law (separate shells), curl 200 · Playwright audit **exit 0 — TOTAL_FINDINGS=1 (MINOR, dataset-honest), CONSOLE_ERRORS=0** (log: `logs/u9-v3.txt`). All five screens swept at **390 / 768 / 1920** — zero horizontal overflow. Reduced-motion emulated (`prefers-reduced-motion: reduce`): **reveal animations report `none`**; without emulation they fire (`u9-line-in`). Scratch deleted; `app/audit-lib.mjs` persists (sanctioned last unit).

---

## 1. Today — day ribbon (temporal anchor) — SHIPPED

A 22px `.day-ribbon` strip between the stat row and the attention slot: the school day as proportional segments on a `--surface-2` track (timetable periods in `--accent-weak-2`, conventional assembly 07:30–07:50 and lunch 12:30–13:15 anchors), the current period tinted (`--accent` at 25%), and a 2px `--accent` now-marker positioned by real clock time. `role="img"` with an honest aria-label ("School day map: N blocks between 7:00 and 16:00, now marker at X%"). Deterministic from the timetable already in the seed — no new API call, no layout-structure change.

**Dataset note (the audit's one MINOR):** the sandbox clock is Sunday 23:19 IST — `slotsToday` is empty by design on dow=0, so the ribbon correctly shows just the two fixed anchors and the now-marker is correctly absent (outside 07:00–16:00). On a weekday the track carries the full period arc. Disposition: correct behavior, environmental dataset.

## 2. Attention — severity rails + honest empty state — SHIPPED

Signal cards gained a 2px severity rail (`.sev-card::before`, absolutely positioned left edge — **zero layout shift**, unlike a border): critical `--danger`, high `--warning`, both at 62% opacity, calm by design. Normal/low deliberately get **no rail** (lighter than the original paragraph — four tinted bars in a queue reads noisy; two do the work; noted per your judgment clause). All 4 rendered cards show the rail, 1 critical verified.

True-clear empty state: drawn-check moment (`.clear-check` — 44px `--accent-weak` circle around the existing `Icon.Check`) + retitled "All clear — nothing needs escalation". Filter-empty keeps its own honest copy (unchanged).

## 3. Fees — tabular numerals + the collection moment — SHIPPED (lighter, per judgment clause)

`.stat-value-row .value` now uses `font-variant-numeric: tabular-nums` — every KPI digit on /fees (and app-wide: Stat is shared) stops jittering; audit confirms 4/4 stats tabular. The per-class 4px bars **already existed** (watchlist `Progress` + `BarChart` on By-class) — adding more would duplicate data the screen already renders, so the paragraph's bar work landed as the lighter, non-duplicative version: a single **collection moment** (`.collect-moment`, `--accent-weak` chip with the existing check icon, `role="status"`) when the top class crosses 90%: "Grade X crossed N% collected — the term is landing." Deterministic from `byClass` math already on screen; renders null when no class qualifies (honest absence, not a stub).

## 4. Ask — citation-slip footer + reduced-motion reveal — SHIPPED

Every grounded answer now closes with a **citation slip** (`.cite-slip`): dashed `--border-strong` top rule, "SOURCES" in uppercase `--text-3`, then quiet `--surface-2` source chips derived from the answer's actual evidence-chain steps (deduped, max 5) — a registrar's provenance footer, not chatbot chrome. Verified live: 3 sources after an owner ask ("Fee ledger · recomputed / Gateway + ledger diff / Reconciliation worker").

The answer block got a one-time staggered reveal (`.ask-answer-reveal`, 320ms `var(--ease-out)`, 80ms steps, `both` fill): fires once on mount, **fully disabled under `prefers-reduced-motion: reduce`** — audit asserts animation-name `u9-line-in` with motion allowed and `none` with reduce, both in the same run. No line-splitting machinery: the stagger is per-block (answer, evidence, actions, slip) — lighter, same intention.

## 5. Transport — schematic stop strips + delayed traffic-light — SHIPPED

Route cards replaced the three text rows under "Next stops" with a **schematic stop strip** (`.route-strip`): a `--border-strong` line through up to 4 stop dots (scheduled stop names + times beneath, `role="img"` with the full sequence in the aria-label). **No position claims** — stops carry no coordinates, so there is no "current position" dot; the paragraph's accent-dot is deferred until gps position data actually exists in the card's props (noted as the lighter honest version). Delayed cards get the traffic-light: 3px `--warning` left border. All 4 routes render 4-dot strips; the delayed card shows the 3px border.

**The cascade find (worth your attention):** the delayed border initially computed 1px — Transport's in-file scoped style sets `.route-card-r7 { border-color/border-width: … !important }` (r7 IS the delayed card), which beat the new rule outright. Fixed by composing inside that same scoped cascade: `.route-card-r7.route-delayed { border-left-width: 3px !important; }` (later + higher specificity, same `--warning` token so the tint is coherent). No `!important` arms race opened; the r7 treatment's original intent is intact. Pre-existing line touched: `screens/Transport.tsx:79` MAP_STYLE — diff is +2 lines (comment + the composed rule), disclosed here.

---

## Disclosure ledger

- **Shared surface: none touched.** App.tsx, AuthGate, liveApi.ts, DemoBar, Guard/Frame untouched. All changes are in the five screens + `components.css` (append-only block) + the Transport scoped-style composition above.
- **Token-bound:** no new hex anywhere — only existing tokens (`--accent(-weak/-weak-2)`, `--danger`, `--warning`, `--border-strong`, `--surface-2`, `--text-2/3`, `--r-sm`, `--ease-out`, `--t-*`) + opacity/transform (not color). Keyframes defined in `--ease` family and gated.
- **API calls: zero new** — ribbon, moment, slip, and strips all derive from data already fetched/computed on each screen.
- **Audit tooling:** unit-9 audit imported `FOCUS_RING_SNIPPET` from `app/audit-lib.mjs` (focus regression passed, 4 stops). `page.emulateMedia({ reducedMotion: 'reduce' })` on a fresh context is the reliable reduced-motion lever (hasTouch was unit-8's lever for pointer).
- Judge-scoped calls made under your judgment clause: no rails for normal/low (Attention), no duplicate class bars (Fees), no position dot (Transport), block-stagger not line-split (Ask). Each is one-paragraph-heavier in full; the shipped versions are the honest minimums.
- Backlog: weekday dataset would let a future audit assert ribbon segment counts ≥6 (clock-dependent — left informational); position dot on strips awaits gps position in RouteCard props; citation slip could link chips to the EvidenceChain drawer (interaction, not composition — needs a click contract).

Files changed: `src/styles/components.css` (unit-9 block), `src/screens/Today.tsx`, `src/screens/Attention.tsx`, `src/screens/Fees.tsx`, `src/screens/Ask.tsx`, `src/screens/Transport.tsx` (incl. MAP_STYLE composition). Preview on :4310 is running the verified build.
