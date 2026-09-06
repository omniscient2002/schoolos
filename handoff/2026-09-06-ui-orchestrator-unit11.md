# UNIT 11 HANDOFF — sign-out token, DataTable sort API, dark-mode feasibility

FROM: ui-agent
TO: orchestrator
STATUS: done

Verification: `npx tsc --noEmit -p tsconfig.app.json` → 0 errors · `VITE_LIVE_API=1 vite build` → success (568ms) · preview restarted per pkill law (separate shells), curl 200 · Playwright audit **exit 0 — TOTAL_FINDINGS=0, CONSOLE_ERRORS=0** (log: `logs/u11-v4.txt`). Prior assertions all firing in-run: keyboard rows 60/60, focus rings ×4, caption present, skip-link first stop, maintenance tabpanels wired, menuitem floor 34px (fine pointer; coarse 44px from unit 8 block), 390/768/1920 overflow sweep clean. Scratch deleted; `app/audit-lib.mjs` persists (sanctioned).

---

## 1. Sign-out `#b91c1c` → `--danger-text` — DONE

`components/Shell.tsx:315` now `style={{ color: 'var(--danger-text)' }}`. Audited live: computed color `rgb(179, 55, 46)` = `--danger-text` exactly, and the inline style carries the token (verified `"var": true`). App-wide stray-hex sweep re-run: no other `#b91c1c` instances existed.

## 2. DataTable SORT API — DONE (product sign-off honored, spec as given)

**API** (documented in the component header):
- Per column: `sortable?: boolean` + optional `sortValue?: (row) => string | number` (needed whenever the rendered value isn't the sort key — e.g. Fees' student cell renders name + grade, accessor is the name).
- Click (or Enter/Space — native `<button>`) on the header **cycles asc → desc → none**, one active sort column at a time.
- **In-memory and deterministic**: `[...rows]` copy — the `rows` prop order is never mutated (display order, not data policy); numbers compare numerically, strings `localeCompare(numeric, base)`, **ties break on `rowKey`** so repeated sorts are stable. No server round-trip.
- **aria-sort="ascending|descending|none"** on the `th` (explicit on sortable columns, absent on non-sortable); indicator icon is `aria-hidden` — ArrowUp/ArrowDown/-muted-ArrowUp per state (new `Icon.ArrowUp` added, same stroke family).
- Header buttons (`.sort-btn`) inherit th typography (font/letter-spacing/text-transform), `min-height 32px`, 44px under coarse pointers — density rules hold.

**Applied to the exemplars**: Fees ledger (Student by name, Amount numeric, Due date by timestamp), People (Person by name, Grade numeric — null-safe `?? 999` after the strict accessor surfaced `grade?: number`), Audit (When by timestamp, Actor by name — verified live on /fees + /people; /audit renders 0 rows today because **ledger hydration is the known server-lane mirror backlog** (unit-6 finding, reported not papered over) — the sortable table ships and renders when rows do).

**Audited live on /fees**: 3 sort buttons + 3 `aria-sort` ths; Amount asc → `ascending` + numerically ascending (`₹46,500 … ₹50,500`); second click → descending verified; third click → all `aria-sort="none"`; Enter on a focused header button sorts; **determinism: asc → clear → asc produces identical order** (`run1 === run2 === true`). Regressions: keyboard rows 60/60, captions, tabpanels, skip-link, focus rings all green.

One probe artifact for the audit trail: my first determinism probe compared an *unsorted* state against a *sorted* one (false MINOR); corrected to same-state-twice (true). Also `/audit: 0 sort buttons` was probe-expectation error, not a defect — classified as the standing backlog above.

## 3. DARK-MODE FEASIBILITY — assessment (not built, per instruction)

**Token inventory (measured):** 104 declared tokens in `tokens.css`. ~46 are color-valued (39 raw `#rgb/color-mix` literals in `:root` + 7 `var()` alias chains like `--warning-text: var(--warning)` — aliases follow their parent for free). 46 structural (spacing/radius/type/timing) + 5 `--shadow-*` need dark variants. The CSS layer is genuinely disciplined: every component reads `var(--token)`.

**Hardcoded assumptions (the real cost centers):**
1. **CSS layer — small**: 23 hex in `components.css`, mostly `#fff` text-on-accent (fine on the existing gradient in dark too) plus 6 hover-dark literals (`#4C43A3`, `#C9C4BA`, `#98291F`, `#DC6803`, …) that would need tokenizing. The 3 `linear-gradient`s + 2 `radial-gradient`s are all token/`color-mix`-derived (40 `color-mix` usages, nearly all from tokens) → they re-derive automatically when tokens flip. **No images anywhere** (zero `<img>`, zero raster `backgroundImage`) — the biggest traditional dark-mode cost doesn't exist here.
2. **Component layer — moderate**: ~25 hex literals in screens — a chart/status palette (`#DC6803` ×14 in MaintIntelligence legends/donuts, `#175CD3`, `#D92D20`, `#5D53B8`, `#98A2B3`, `#FFC107`, MaintMap's status map). Mostly mechanical one-to-one token swaps, but they are *semantic constants*, so they want a small `--chart-*`/`--status-*` token family rather than ad-hoc `--warning` reuse, to keep chart legibility decisions explicit.
3. **Data layer — platform contract**: `campus.hue` arrives from the **server** (`apiDataset()` hydration) as raw hex — client tokens can't recolor server strings without a mapping helper (`hue → --campus-1..n`) or a data-contract change. This is the one item outside my lane; flag for platform.
4. **Shadows**: 5 `--shadow-*` assume light-surface elevation; dark needs stronger-alpha variants (classic `--shadow-xs` becomes nearly invisible on `--surface: #1E1D1A`-class backgrounds).

**Recommendation (one paragraph):** Dark mode is cheap-to-moderate, and the unit-2 discipline is exactly why: the deliverable is one `@media (prefers-color-scheme: dark) { :root { … } }` override of ~46 color tokens + 5 shadow variants (a single new file next to `tokens.css`), preceded by a small prep unit that tokenizes the 6 CSS hover literals and introduces a 6-token `--chart-*` family for the ~25 screen-layer chart/status literals; the campus-hue data contract goes to platform. Roughly: one prep unit (token sweep, mechanical) + one dark-layer unit (the override file + a dark-mode audit asserting contrast on the five highest-traffic screens in emulated dark) — with chart palettes chosen for AA against dark surfaces rather than a naive invert. I recommend building it as **unit 12 exactly like that**, with the dark audit in the same style as the reduced-motion both-ways proof (assert both light and emulated dark pass the same contrast/density assertions).

---

## Disclosure ledger

- Files: `src/components/ui.tsx` (sort API + docs), `src/components/Icon.tsx` (+ArrowUp), `src/components/Shell.tsx` (sign-out token), `src/styles/components.css` (+sort-btn block), `src/screens/{Fees,People,Audit}.tsx` (sortable columns). No shared-surface files touched; no new API calls; no new hex (ArrowUp is a stroke path, not a color).
- `Icon.ArrowUp` is a new primitive — additive to the icon set, no behavioral impact.
- Backlog unchanged: mirror hydration (now also gating /audit sort UX), /library flip, configured chip, campus-hue data contract (new, from item 3), sortable columns for the remaining tables (pattern shipped on 3 exemplars).

Files changed: `src/components/{ui,Icon,Shell}.tsx`, `src/styles/components.css`, `src/screens/{Fees,People,Audit}.tsx`, `handoff/2026-09-06-ui-orchestrator-unit11.md`, `logs/u11-v4.txt`. Preview on :4310 runs the verified build.
