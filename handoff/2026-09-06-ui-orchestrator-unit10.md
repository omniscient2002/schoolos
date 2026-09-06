# UNIT 10 HANDOFF — visual consistency sweep + the remaining surface

FROM: ui-agent
TO: orchestrator
STATUS: done

Verification: `npx tsc --noEmit -p tsconfig.app.json` → 0 errors · `VITE_LIVE_API=1 vite build` → success (855ms) · preview restarted per pkill law (separate shells), curl 200 · Playwright audit **exit 0 — TOTAL_FINDINGS=0, CONSOLE_ERRORS=0** (log: `logs/u10-v5.txt`; runs v1–v4 absorbed one real API blip + two audit-accounting artifacts — see Method notes). All prior assertions still firing in the same run: skip-link first-Tab, focus rings (audit-lib heuristic), coarse-pointer 44px (verified on the NEW menuitem class — 44px exactly), reduced-motion gate, tabpanel wiring, table captions, 390/768/1920 overflow sweep. Scratch deleted; `app/audit-lib.mjs` persists (sanctioned).

---

## 1. Avatar/menu surfaces — the popover-menu pattern (shared chrome)

**Verdict: WAI-ARIA APG menu-button pattern is the correct one** (button-triggered popover of commands), and it is now implemented in the **`Dropdown` primitive once** — `Shell.tsx`'s CampusSwitcher, NotificationsBell, ProfileMenu (the role switcher lives inside it) all inherit, as do the three screen-level dropdowns (Admissions stage move, CaseDetail + Incidents status advance).

What was wrong (findings, all fixed):
- **MINOR/MAJOR — trigger semantics**: `aria-expanded` sat on a wrapper div, no `aria-haspopup`. Now the primitive clones the trigger element and attaches `onClick`/`aria-expanded`/`aria-haspopup="menu"` **to the real button** (verified in-audit: `expandedOnButton=true`, tag BUTTON).
- **MAJOR — no menu semantics**: menu container now `role="menu"` + `aria-label` (per-menu: "Account menu", "Notifications", "Campus switcher", "Stage move", "Status advance"); items `role="menuitem"`; labels/separators `role="none"`. Verified: 7+ menuitems in the profile menu, bell menu renders `role=menu` with label.
- **MAJOR — no arrow-key roving**: ArrowDown/ArrowUp/Home/End now rove `[role="menuitem"]:not(:disabled)` with wrap-around, opening focus on ArrowDown. Verified live: ArrowDown enters menu (menuitem), moves between items.
- **MINOR — Esc focus return**: Esc already closed; now it also **returns focus to the trigger** (APG requirement). Verified live: `closed=true, focusBack=true`.

Touch floors: dropdown-items inherit the unit-8 coarse block (`.dropdown-item` was already listed) — audited at 390px hasTouch context: **44px exactly**. Contrast: account block name/title/email are existing `--text`/`--text-2`/`--text-3` tokens (≥4.5:1 on `--surface`, unit-7-verified); no new colors introduced. One POLISH noted in the handoff ledger, not acted on: Sign out uses a hardcoded `#b91c1c` (pre-existing, outside my color remit to tokenize unilaterally — recommend `--danger-text` in a platform pass).

## 2. Tables class — one decision, applied everywhere

Audited exemplars ( Fees /people /operations /learning) + wide sweeps. The uniform standard, now documented:
- **Row height 34–60px band** (padding-driven: `td { padding: 10px 14px }`, keyboard-row coarse variant 14px vertical): Fees 58, People 58, Operations 42 — all in band, one CSS source (`table.data td`), zero per-screen overrides found. `/learning`'s 62px "row" is the **timetable schedule grid** (stacked subject/teacher/room cells — a matrix, not a data table) — explicitly exempt, logged in the audit.
- **Header treatment**: uppercase 12px `--text-3` on `--surface-2` with `--border` bottom rule — verified identical on every rendered table (audit asserts `thUpper` + `thBg === rgb(250,249,247)`).
- **Zebra: NONE.** Hover `--surface-2` only. Audit sweeps for striped rows: none found. (Decision: hover + generous padding + row focus ring already give guidance; zebra would fight the busy badge/cell content.)
- **Empty cells: em-dash.** `DataTable` now renders `—` in `u-faint` for `null`/`undefined`/`''` cells (rendered or raw) — one decision at the component, all 26 sites inherit. Falsy-but-meaningful values (`0`, `false`) pass through untouched.
- **Raw-table outliers unified**: ItAdmin control-plane table and Migration's two tables keep their compact inline style but are **inside `.table-wrap` with `table.data`-compatible markup**; Learning's raw `table.data` (schedule grid) already conforms structurally (scope/`caption` unaffected — it is not a DataTable; noted, not forced).
- `/audit` + `/hr` render 0 `table.data` until a query/data exists (conditional) — no gap.

## 3. Form class — accessible names + the error pattern

- **Accessible names: 0 gaps.** Browser-side sweep across /login /fees /people /audit /operations /learning /attendance: every `input/select/textarea` carries `aria-label`, a `label[for]`, or a wrapping label. Static brace-aware source scan confirms: only **2** true gaps existed (the naive 33-count was regex false-positives from `>` inside JSX arrow functions — both fixed): `DemoDay` draft textarea → `aria-label="Message draft — template TRANSPORT_DELAY, edit before approving"`; `Shell` command palette input → `aria-label="Search people, records, actions — or type a command"`.
- **Error-state pattern — Login is the exemplar standard, now explicit**: error div gained `id="login-error"` (role=alert retained); all four method inputs (`email`, `tel`, `password`, `otp`) carry `aria-invalid={!!error}` + `aria-describedby={error ? 'login-error' : undefined}`. Audited end-to-end with a **deliberate wrong-password probe**: `role=alert` fires, `aria-invalid="true"`, describedby target resolves. No other inline form errors exist in the app (validation surfaces via toasts) — documented as the standard for future forms: error text in a `role="alert"` node + `aria-invalid` + `aria-describedby` pointing at it, exactly as Login now does.

## 4. Empty/zero-state gallery

`Empty` is already the universal structure (icon → `titleAs` heading → `p` sub → action) — **two bypasses unified, zero divergent skeletons remain**:
- `Automation.tsx:554` raw `div.empty` → `Empty icon={<Icon.Workflow/>} title="Canvas is empty" sub="Add a trigger node to begin."` (kept its compact 60px padding via a new optional `style` passthrough on `Empty` — additive, backward-compatible).
- `Shell.tsx:413` palette "No matches" raw div → `Empty` (compact padding, borderless per its inset context).
Audit renders live routes and asserts every `.empty` in the DOM has a heading: 100% structural.

---

## Method notes (for the audit trail)

- Run v1: killed by a real API blip (`401` cascade + `ERR_CONNECTION_REFUSED`) mid-run — later probes were actually the login redirect; retry law absorbed it. v4 flagged `CONSOLE: 401` — that is **my own deliberate wrong-password probe** (the login error exemplar test working); the audit now excludes that expected 401 from the console tally with a comment. v4 also flagged /learning rowH — resolved as the schedule-grid exemption above. v5: clean.
- `Dropdown` trigger cloning: non-cloneable triggers fall back to the old wrapper div (defensive try/catch) — all current triggers are single buttons.
- No API calls added; no new hex tokens (the `#b91c1c` is pre-existing, flagged not touched).

## Disclosure ledger

- **Shared-surface-adjacent touch, disclosed**: `components/Shell.tsx` (in-lane, per-lane rules; App.tsx/AuthGate untouched). Diffs: palette input +1 aria-label; palette empty div → Empty; `role="menuitem"` on 8 dropdown buttons; `role="none"` on labels/seps; 3 `label=` props on Dropdowns. Sign-out logic untouched.
- **Component API additions** (all backward-compatible, tsc 0 app-wide): `Dropdown` +optional `label`; `Empty` +optional `style`; `DataTable` empty-cell em-dash behavior (visual only, no prop).
- Standing backlog: `#b91c1c` tokenization (platform); `table.data` caption on the Learning schedule grid (needs a caption decision for matrix tables); DataTable sortable headers still awaiting product sign-off; server-lane items unchanged (mirror hydration, /library flip, configured chip).

Ready for red-team cycle 5 with UI-inclusive scope from my side.

Files changed: `src/components/ui.tsx` (Dropdown menu pattern, Empty style, DataTable em-dash), `src/components/Shell.tsx` (menu roles/labels, palette aria-label + Empty), `src/screens/{Admissions,CaseDetail,Incidents,Login,DemoDay,Automation}.tsx`, handoff + logs as linked above. Preview on :4310 runs the verified build.
