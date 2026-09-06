# UNIT 8 HANDOFF — UI/UX production-hardening backlog (in order)

FROM: ui-agent
TO: orchestrator
STATUS: done

Verification: `npx tsc --noEmit -p tsconfig.app.json` → 0 errors · `VITE_LIVE_API=1 vite build` → success (474ms) · preview restarted per pkill law (separate shells), curl 200 · Playwright audit **exit 0, TOTAL_FINDINGS=0, CONSOLE_ERRORS=0** (log: `logs/u8-v7.txt`). Scratch script deleted; **`app/audit-lib.mjs` intentionally persists** (see Disclosure).

---

## 1. Coarse-pointer 44px touch targets — DONE

`@media (pointer: coarse)` block appended to `src/styles/components.css`: `.btn`, `.btn-sm`, `.tab`, `.iconbtn`/`.icon-btn` (+min-width 44), `.seg-btn`, `.nav-item`, `.dropdown-item`, `.mtab` → `min-height: 44px`; keyboard-activatable table rows (`.row-click td`, `tr[tabindex="0"] td`) → 14px vertical cell padding (tr min-height is unreliable; padding is robust). **Desktop pointer untouched — 32px floors from unit 7 verified intact** (fresh no-touch context measured `.btn` at exactly 32px).

Verified two ways: (a) shipped-CSS assertion — the minified `@media(pointer:coarse)` block contains all five selector families + `min-height:44px`; (b) live measurement under coarse-pointer emulation (`hasTouch` context): `.btn` 44px, `.iconbtn` 44×44, `.nav-item` 44px. Note for future audits: CDP `Emulation.setEmulatedMedia` pointer features did **not** flip `matchMedia('(pointer: coarse)')` in headless-shell — `hasTouch: true` on the context is the reliable lever; both findings are encoded in `app/audit-lib.mjs`.

## 2. Tabpanel wiring — DONE (4 owned-panel screens + login)

House rule established: a Tabs instance gets `panelId` only when **it owns the panels** (each tab = one panel; conditional blocks render per-tab). Tabs now emits `id={panelId}-tab-{id}` + `aria-controls={panelId}-panel-{id}`; panels render `role="tabpanel" id=… aria-labelledby=…`. Focus outline on `[role="tabpanel"]:focus-visible` added to components.css.

- **Wired**: Login seg (`login-seg-panel-{password,phone,google}`, buttons already had `seg-tab-*` ids — panels aligned to them, `aria-controls` added), Maintenance (4), Fees (4), Learning (4), Attendance (2; the mark-tab ternary's two branches share one panel id — mutually exclusive renders).
- **Correctly skipped (filter tabs, not panel owners)**: Attention (priority/kind filters over one shared list), Cases (kind filter), Learning status pill (filter), MaintMap (campus filter), ActionCenter (kind filter over one queue).

Audit: all four wired screens show `present=true labelled=true activeControlsLive=true`; login shows 3/3 tabs wired + labelled panel. Mid-unit self-catch: Maintenance was first wired with `maint-panel-*` ids, inconsistent with the `*-tab-panel-*` convention that emerged — unified to `maint-tab-*` before acceptance.

## 3. DataTable `<caption>` — DONE (mechanism universal, copy exemplared)

`DataTable` now always renders `<caption class="sr-only">` (new utility in components.css): explicit `caption` prop when provided, honest generic fallback `Data table — N rows` otherwise — so **all 26 call sites emit a caption today with zero further edits**. Curated copy shipped on the three highest-traffic tables: Fees obligations ledger, People directory, Audit ledger. Rollout of specific copy to the remaining ~23 tables is a tracked backlog item (pattern + prop documented in ui.tsx); rendered-table audit on 5 routes: every `table.data` captioned.

## 4. Focus-ring detector: heuristic permanently documented — DONE

Created **`app/audit-lib.mjs`** — persistent (not scratch) shared audit library at your instruction, so the unit-7 batch-1 false-positive class can never regress. It encodes: the **canonical ring detector** (`outline` OR `boxShadow !== 'none'` OR accent-border on form fields) with a header comment citing the unit-7 batch-1 handoff as the reason; the inline contrast/luminance/bg-walk snippets (Node helpers don't cross the JS context — the crash lesson); and the coarse-pointer emulation note (hasTouch over CDP). Regression run: 6 keyboard stops on /fees, all ring-positive; contrast sanity `.u-muted` 7.23:1.

## 5. Skeleton/loading consistency sweep — DONE (no violation found; convention documented)

Inventory: **25 screens / 62 `SkeletonCard` uses** (route-level first paint), 14 screens compose raw `<Skeleton>` shimmers (same primitive family), and exactly **3 spinner instances, none a bare loading state**:
- `Ask.tsx:194`, `Next.tsx:259` — skeleton lines **plus** an 11px spinner + status sentence ("Reading records and recomputing figures…"). This is a deliberate, mutually consistent pair: skeleton = shape, spinner+text = liveness. Not drift.
- `TechnicianWorkspace.tsx:365` — "Hearing you — describe the fix…" while voice is listening. **Not a loading state** (live-input feedback); skeletonizing it would be wrong.
- `Attendance.tsx:238` — PageHead sub "Loading today's register…" over skeleton rows: compliant.

**Documented three-tier convention** (now in this handoff, enforceable in future audits): (1) route first paint → SkeletonCard grid; (2) in-place recompute → Skeleton lines + one status sentence, spinner glyph optional but must match Ask/Next if used; (3) live-input feedback → spinner + present-tense status, never skeletons. **Disposition: no spinner-vs-skeleton mix exists; no code churn.** If you want tier-2 spinner glyphs gone for pure-calm, it's a 2-line change in Ask/Next — flagged, not done.

---

## Disclosure ledger

- **Shared surface: NONE touched this unit.** App.tsx, AuthGate, liveApi.ts, DemoBar untouched. Closest-to-shared change is `screens/Login.tsx` (seg ids/panels — pre-existing manual tablist; I aligned panel `aria-labelledby` to the buttons' existing `seg-tab-*` ids and added `aria-controls`). No token handling anywhere.
- **`app/audit-lib.mjs` persists** — deliberate exception to the scratch-deletion law, created per your instruction so the detector is permanent. It is test tooling in app/ root, never imported by src. Delete on your word.
- Component API surface (all backward-compatible; tsc 0 across every consumer): `DataTable` +optional `caption`; `Tabs` +optional `panelId`; `Section` now spreads rest-props (`Omit<HTMLAttributes,'style'|'title'>` — title omitted because Section's own `title` is ReactNode) so panels can be Section-rooted.
- Observation, not finding: `/audit` renders 0 `table.data` until a query runs — conditional table, no gap.
- Backlog touched but not done: specific captions ×~23; DataTable sortable headers (still needs product sign-off); mirror hydration / /library flip / configured chip remain server-lane as agreed.

---

## Five micro-improvement proposals (character/visual-polish pass — yours to greenlight)

**Today.** Give the screen its identity: a "day ribbon" — one 24px horizontal strip under PageHead showing the day's arc as proportional muted segments (assembly · periods · lunch · dismissal) with a single now-marker tick, built from the timetable dataset already on /dataset-derived, no new palette, no animation. Paired with a time-aware greeting chip in --text-2 ("Good morning — 3 things need you before lunch") computed from the existing attention count. Today currently opens with stats like every other console; this one strip makes it *the* school-day screen without breaking enterprise calm.

**Attention.** Triage should feel like a steady pulse, not an alarm: a 2px severity accent bar on each card's left edge (severity color at 60% opacity, so the queue reads calm at a glance but scannable), and an empty state with a small drawn-check moment and honest copy ("All clear — nothing needs escalation since 8:00"). The kernel widgets already render here; the bar treatment gives first-party and plugin cards one shared visual grammar so the slot-ration mix doesn't look like two products.

**Fees.** Money deserves dignity: switch KPI and ledger numerals to `font-feature-settings: 'tnum'` (tabular numerals — columns stop jittering), and in By-class add a thin 4px deterministic collection bar per class row (width = collected/due, no animation loop) so the collection story is visible before the numbers are read. Micro-moment: when a class crosses 90% collected, its bar end gets a single calm check glyph. Zero new colors beyond existing accent/warning tokens.

**Ask.** Make answers feel like a registrar's written reply, not chatbot bubbles: style the answer card's provenance footer as a citation slip (dashed top border, --text-2, "Sources: fee ledger · policy §4.2" from the existing citations data), and reveal the answer's lines with a one-time 150ms/line fade-up gated on `prefers-reduced-motion` (the skeleton+status state already sets up the moment). The result: the AI surface reads as considered and authored — which it is.

**Transport.** Routes are geography: give each route row a static mini-map strip — an SVG polyline of its stops (monochrome, 1.5px, stop dots; accent only for the current-position dot when gps.delay live data exists) — no live-tracking claims, pure deterministic geometry from the transport dataset. Delayed routes alone get the traffic-light left border. The screen stops being a table of ETAs and becomes a picture of the fleet at a glance, with motion-free calm.

---

Files changed: `src/styles/components.css`, `src/components/ui.tsx`, `src/screens/{Login,Maintenance,Fees,Learning,Attendance,People,Audit}.tsx`; created `app/audit-lib.mjs` (persistent). Preview on :4310 is running the verified build.
