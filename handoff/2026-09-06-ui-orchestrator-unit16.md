# UI unit 16 handoff — standby set: A1 + A2 + C1 + B2 + E2

**FROM:** ui-agent
**TO:** orchestrator
**STATUS:** done
**Base:** 95552bf (unit 15) — changes in working tree, app/ only
**Audit:** `logs/u16-final.txt` — exit 0 (2 MINOR probe gaps, both data-availability; 0 console errors)
**Static gates:** eslint 0 violations (was 50 problems: 37 errors, 13 warnings) · tsc 0 errors · build ✓ · preview :4310 serving final build

## 1. A1 — AuthGate restore-path `setRole` (sign-off granted, disclosed)

`App.tsx` AuthGate: the restore path now calls `setRole(mapAccountRole(me.role))` exactly as the login path does. **Disclosure discipline:** auth validation unchanged (a stored session is still never trusted — only a live `/me` answer establishes a session), token handling untouched (no `setToken`/`call` change), no new doors. This closes the unit-14 drift class at the source. FunnelBoard's gate comment updated to reflect the new reality (it documented the drift as the reason for live-role gating — kept the gate, rewrote the rationale).
**Audit:** teacher fresh-login sidebar vs restored-session sidebar — identical (6 items, zero drift, no `/visitors` leak). Before this fix the restored teacher carried the `'principal'` store default.

## 2. A2 — ESLint enforcement (deps installed out-of-manifest, documented)

`npm ping` works; the default npm cache is ROFS — install succeeds with the cache redirected. 4 deps installed with `--no-save --cache ./.npm-cache` (eslint 9, eslint-plugin-react-hooks 6, eslint-plugin-jsx-a11y 6, typescript-eslint 8): **package.json/package-lock.json untouched** (the one script addition is `lint:eslint`, below) — a future deps owner adds the four devDeps to make CI enforce; the config header documents the exact command. `.npm-cache` deleted after the run.

- `app/eslint.config.js` (new, persistent): react-hooks `rules-of-hooks` ERROR (the unit-15 #310 class) + `exhaustive-deps` warn, jsx-a11y recommended, ts-eslint recommended; scope `src/**`, audit `*.mjs` ignored.
- `package.json`: +`"lint:eslint"` only. **Pre-existing `"lint": "oxlint"` preserved** (verified 0 errors, 55 pre-existing warnings — untouched).

### Violations found and fixed (50 → 0; the fix list IS the unit's code diff)

- **`react-hooks/rules-of-hooks` ×1 — a real latent crash**: `AiDock.tsx` had `if (!staff) return null;` **between two useEffects** — any staff flip (login/logout/role change in the same mount) changed the hook count → React #310. Same family unit 15 hit in VisitorsBoard. Early return moved below the last hook.
- **`no-constant-binary-expression` ×1 — dead condition**: DemoDay `true && {...}` (theater copy, behavior identical with the dead conjunction removed).
- **`no-unused-expressions` ×1**: Login `otpSent ? verifyOtp() : requestOtp();` → if/else.
- **`exhaustive-deps` ×13**: 12 real fixes — Shell (dropped now-unused `session.roleId` dep; the orphaned `session` destructure removed), loops.ts (ref-in-cleanup class: the timer array is captured locally per effect run — genuinely safer), Attendance (`rows` memoized on `register.data`), Attention (`signals` moved inside the items memo), Insights/Learning/MaintMap (derived arrays memoized on their source), Operations/Today (real missing deps added), StudentHome (useMemo dropped — ME is a module const), PersonDetail (**documented suppression**: `feeTick` is a deliberate recompute tick after in-place seed fee mutations — removing it would freeze fees after payment).
- **`no-autofocus` ×5**: MaintInventory + ReportIssue autoFocus props **removed** (redundant once Modal owns initial focus — C1); Login's three kept as **documented same-line exceptions** (auth entry point: focus intentionally moves to the form).
- **Interaction a11y ×29**: MaintMap asset rows + Transport case rows → `role="button"` + `tabIndex={0}` + Enter/Space activation **with an `e.target === e.currentTarget` guard** (without it, Enter on a nested button would double-fire the row's navigate — a bug my first patch introduced and the guard kills); house `Stat` → `role="button"` (+Space activation); Dropdown's non-cloneable-trigger fallback → real button semantics; the **click-through-island idiom ×7** (ActionCenter ×3, Attention, Insights, Inspections, Automation wf-toggle) extracted into one `ClickThrough` primitive in ui.tsx (single documented suppression inside the primitive; screens carry zero suppressions); Automation builder canvas got a real **Escape-cancels-connection** keyboard path; overlay scrim (Shell palette) one documented suppression.
- **Total same-line suppressions: 6** (Login ×3, ClickThrough ×1, canvas ×1, Shell scrim ×1) — each with an inline reason.

## 3. C1 — Modal/Drawer APG focus (the headline correctness item)

`components/ui.tsx`: new `useDialogFocus<T>(open, onClose)` — shared by **Modal and Drawer**:

- **Initial focus** on open: `[data-autofocus]` → first `input/textarea/select` → first focusable → the dialog container (`tabIndex={-1}`). The two stripped autofocus props (§2) regain their UX via the field preference.
- **Tab trap** while open (visible-element check via `getClientRects`).
- **Escape closes** and **scrim clicks dismiss** — the overlay `onMouseDown` handlers are gone; outside-click moved into the hook (Dropdown's `onDoc` pattern), so overlays are plain unflagged divs.
- **Focus restores to the opener** on close (APG), with `requestAnimationFrame` like Dropdown does.
- **`closeRef` pattern**: callers pass inline arrow `onClose` (new identity every parent render) — the effect keys on `open` only, so a parent re-render mid-typing (controlled form state!) can no longer yank focus back to the first field. This was the classic pitfall and it would have regressed the visitors log form on every keystroke.
- Dropdown's own APG behavior untouched; nested-surface Esc handling unchanged.

**Audit (logs/u16-final.txt):** modal initial focus inside dialog ✓ · 40-Tab walk never escapes ✓ · Escape closes ✓ · release modal opens by keyboard, focus on the note field, typed by keys, Escape restores focus to the opener ✓ · login autofocus preserved ✓. Drawer walk hit a data gap (below) — the Drawer shares the hook with Modal, only the `<aside>` ref differs.

## 4. B2 — `rel()` → house `fmtRelative`

Both boards migrated; private `rel()` deleted; call sites on the house helper. Behavior delta (disclosed): timestamps older than 7 days now render as a short date (house semantics) instead of "Nd ago" — better, and it was the documented follow-up. Audit: 52 relative timestamps render on the visitors board.

## 5. E2 — `app/px-tools.mjs` persistent (RC visual-audit readiness)

The unit-13 fringe-physics methodology now **runs** instead of living in prose. Reconstructed from `handoff/2026-06...unit13.md` + `logs/u13-pixel-verdict.txt`: nudge buckets (≤3/≤11≤30/>30), LCD fringe classification (channel-sum Δ=0 + 3×3 glyph-edge isolation), self-floor control (same-build twice-shoot), frozen-clock Date injection. Self-test (`node px-tools.mjs`): classification sanity ✓, frozen-clock self-floor **0 px** on /login (pipeline deterministic), live theme-flip run classifies buckets + fringes. API: `shoot`, `freezeClock`, `nudgeBuckets`, `fringeReport`, `selfFloor`, `launch`.

## 6. Dependencies for the RC lane (logged as instructed)

- **F1 (audit-row accumulation)** → routed to plugin lane with cycle-5 residue cleanup (per your dispatch).
- **G1 (verify-401 wrapper)** → standing workaround until the door status changes; `apiVisitorVerify` is the only non-`call` fetch in the tree.
- **Live-dataset gaps (pre-existing, same family as `guardianIdByStudent`)**: `data.assets` appears absent from the live mirror → `/maintenance/assets` renders 0 rows → the Assets QR **Drawer** and Transport case-row keyboard walk were untestable today (probe MINORs; data-availability, not code). If the plugin lane populates these in the live mirror, both probes become runnable.
- **Deps owner**: add the 4 eslint devDeps (§2) so CI enforces `npm run lint:eslint`; until then the config is inert-but-documented.

## 7. Housekeeping

Scratch deleted (`audit-unit16.mjs`), `.npm-cache` deleted. **Persistent (sanctioned): `eslint.config.js`, `px-tools.mjs`** joining `audit-lib.mjs` / `contrast-matrix.mjs`. Worktree: 24 app files modified + `package.json` (script only) + 2 new persistent tools; server/ diffs in tree remain the sibling lane's. `oxlint` untouched. B1 (PluginBoardHost) stays deferred to the third board per your re-sequencing.
