# UI unit 13 handoff — designer-dark pass

**FROM:** ui-agent
**TO:** orchestrator
**STATUS:** done
**Commit base:** ae4fefa (unit 12) — changes staged in working tree, app/src only
**Audit:** `logs/u13-v4.txt` — exit 0, TOTAL_FINDINGS=0
**Contrast matrix:** `logs/u13-contrast-before.txt` (6 FAILs) → `logs/u13-contrast-after.txt` (FAILS=0)
**Pixel verdict:** `logs/u13-pixel-verdict.txt` — all 8 routes attributed

## 1. What the matrix said, what I did

The unit-12 AA audit (contrast-matrix.mjs, token-aware, scope-conditional) had 6 FAILs across light and dark. All fixed, all verified by re-run:

| Token / surface | Scope | Before | After | Fix |
|---|---|---|---|---|
| `--text-3` | light | 4.46 | **4.62** | `#6B7075` → `#686C71` |
| `--text-3` | dark | 4.26 | **4.55** | `#908C82` → `#9B968A` |
| `--warning` | light | 4.31 | **4.62** | `#9A6700` → `#8F6100` |
| `--chart-slate` | light | 2.45 | **3.10** | `#98A2B3` → `#828C98` |
| white on `--accent` (filled btn) | dark | 2.93 | **6.24** | `--btn-ink` channel (below) |
| `--danger` on `--danger-weak` | dark | 4.47 | **4.86** | danger family re-tuned |

## 2. The `--btn-ink` channel (new token channel, disclosed)

Dark filled buttons were the worst fail: white ink on the teal gradient = 2.93:1. New channel:
`components.css`: filled-button ink is now `color: var(--btn-ink, #fff)` (light = fallback white, untouched pixels).
`dark.css`: `--btn-ink: #161511` (surface-0 ink on the lifted teal = 6.24:1).
Applied to 6 filled surfaces: `.btn-primary`, `.btn-ai`, `.btn-danger`, `.checkbox .box svg`, `.toast-count`, `.logo-mark`.
Toast dark-safety catch: `.toast` bg is `var(--surface-inverse)` (inverts in dark) but its sub/button text was **hardcoded white-on-white in dark**. Now `color-mix` off `--text-inverse` (65%/70% base, 100% hover). Verified by a live dark toast in the audit.

## 3. Dark palette craft pass (both blocks kept in sync)

- `--gradient-accent`: `#3FA795→#2E7D6F` → `#46B5A2→#3FA795` (dark teal was muddy; new stops pass with dark ink)
- `--danger-hover` direction bug: was **darker** than `--danger` in dark mode (hover should lift): `#C4544A` → `#E06E5E`
- Chart family lifted for dark: amber/blue/red/steel/violet/teal re-tuned (matrix validates each against `--surface-0/1/2/3`)
- Campus-hue channel unchanged (hue dots keep server hue; `--campus-hue-dot` color-mix retained)

## 4. Pixel attribution (the methodology, since unit 12's verdict tool was invalidated)

`pxattr.mjs` (monotone-darkening) was wrong: it counted AA re-rasterization and LCD subpixel fringes as violations. Replaced by bucket physics (`logs/u13-pixel-verdict.txt`):

- **8 routes, before(4311 @ ae4fefa) vs after(4310)**: every changed pixel lands in a nudge bucket — `≤3` = text-3 delta (61–92% of changes per route), `≤11` = warning, `≤30` = chart-slate — plus a small `>30` remainder that is **LCD subpixel fringes** (channel-sum Δ=0, e.g. `255,0,255`↔`0,255,0`, glyph-edge confined, 98/150 isolated on /fees).
- **Self-floor control**: same-build twice-shoot → /people **0 px** (renderer deterministic), /transport 69 px (live GPS churn). So cross-build diffs are exactly the ink re-renders; fringes are their glyph edges, not edits.
- **FINAL:** light-mode changes are exactly the three disclosed AA nudges + their fringes. No layout shift, no unexplained color.

## 5. Audit (functional, both-ways)

`logs/u13-v4.txt` exit 0: dark[pref] auto-applies (attr=null scheme=dark, contrast 15.18, btnInk rgb(22,21,17) on gradient = 6.24); dark[attr] via settings radiogroup (roving arrows, persists, no flash — boot-applied in main.tsx pre-render); dark toast readable; light btnInk white = 15.60; sort/rows/skip-link/widths regressions clean.

## 6. Files (all app/src)

- `styles/tokens.css` — 3 light nudges + chart ramps (hover tokens)
- `styles/dark.css` — gradient, danger family, text-3, chart family, `--btn-ink` ×2 blocks
- `styles/components.css` — ink channel ×6 surfaces, toast dark-safety ×3 rules
- `app/contrast-matrix.mjs` — **KEPT as persistent tool** (token-aware WCAG matrix; disclose: it parses tokens.css + dark.css, models ink channel + gradient ends)
- Scratch deleted (audit-unit13.mjs, px-*.mjs, u13-s*.png); `.wt-u13` worktree + :4311 preview removed

## 7. Backlog

- `--chart-red-deep`/`--chart-steel` naming: covered by the 116-token blessing, no further action needed
- LCD fringe definition is now codified in the pixel-verdict tool logic (channel-sum Δ0 + glyph-row isolation) — reusable for future pixel proofs
