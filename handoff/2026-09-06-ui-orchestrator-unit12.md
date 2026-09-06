# UNIT 12 HANDOFF — dark mode prep + layer + theme escape hatch

FROM: ui-agent
TO: orchestrator
STATUS: done

Verification: `npx tsc --noEmit -p tsconfig.app.json` → 0 errors · `VITE_LIVE_API=1 vite build` → success (664ms) · preview restarted per pkill law · **functional audit exit 0 — TOTAL_FINDINGS=0, CONSOLE_ERRORS=0** (`logs/u12-v6.txt`) · **light-mode bit-identity proven at PIXEL level** (`logs/u12-pixel-verdict.txt`). Scratch deleted (`audit-unit12.mjs`, `capture-baseline.mjs`, `px-audit.mjs` removed; `audit-lib.mjs` persists).

---

## 1. Token sweep — DONE, zero visual change (pixel-proven)

- **`--chart-*` family (7 tokens, all exact current values)**: `--chart-amber #DC6803`, `--chart-blue #175CD3`, `--chart-red #D92D20`, `--chart-violet #5D53B8`, `--chart-teal #3C8C64`, `--chart-slate #98A2B3` — the approved six — plus one disclosed sibling: `--chart-red-deep #C4320A` (emergency ramp end). Zero-change required the exact value and it is not a chart *series* color; flag if you want it folded differently in a later unit.
- **Exact-value reuse (no new tokens needed)**: `#5D53B8` = `--ai`, `#0A5A50` = `--accent-text`, `#1C1D20` = `--text` (demo-bar), `#12805C` was a dead `var(--success, …)` fallback — removed.
- **Interaction ramps (5 new)**: `--ai-hover #4C43A3`, `--danger-hover #98291F`, `--danger-hover-text #92400E` (the unit-2 AA fix, now a token), `--secondary-hover-border #C9C4BA`, `--input-hover-border #C4BFB5`. One real catch during the sweep: I initially mapped admissions' contacted stage `#4A7A8C` onto `--chart-blue` — the pixel diff caught it, and it became `--chart-steel #4A7A8C` (exact). The proof works.
- **Exempt (documented)**: Google G brand mark in Login (`#FFC107/#FF3D00/#4CAF50/#1976D2`) — brand-fixed.
- **Chart.tsx hardened**: `Sparkline`/`Donut` colors moved from SVG presentation attributes (where `var()` does not resolve per spec) to inline `style` — same resolved colors, tokens now functional in charts.
- **Audit must run "how many tokens now"**: 104 + 12 = **116 declared tokens**.

## 2. Dark layer — DONE, both-ways proof (same style as reduced-motion)

`styles/dark.css` (imported after `components.css`): one warm-dark token set applied via **both** paths — `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` (system) and `:root[data-theme="dark"]` (explicit; wins). `color-scheme: dark` set. Coverage: all surface/text/border tokens, accent/AI/success/warning/danger/info families, chart family (same hues lifted for dark legibility), 5 shadow variants (elevation via contrast, not glow), `--gradient-accent` dark variant. Light mode defines none of these — bit-identity holds by construction.

**Campus-hue channel (your ruling, implemented)**: components feed the server hex into a per-element channel (`style={{'--campus-hue': c.hue}}` on Shell trigger + dropdown items + Group table dot); a `.campus-dot` class consumes `var(--campus-hue-dot, var(--campus-hue))` — **light falls through to the raw server hex (pixel-proven unchanged)**; dark defines `--campus-hue-dot: color-mix(in srgb, var(--campus-hue, #0E7568) 68%, #ECEAE3)` — a legible derivation, not an override. Sparkline strokes ride the same channel.

**Audit (both-ways)**: emulated `prefers-color-scheme: dark` (system path: no attribute, `color-scheme: dark`, correct warm-dark surfaces, body contrast **15.18:1**) AND attribute path — identical checks pass both ways. Explicit `data-theme="light"` beats a dark OS (user choice wins, verified). Campus dot verified chromatic in both modes. All prior assertions re-fired in the same run: sort API (3 buttons + aria), keyboard rows 60/60, skip-link first stop, tabpanels, focus rings, 390/768/1920 sweep, console clean.

## 3. Escape hatch — DONE (a feature, not just a media query)

- `lib/theme.ts`: `system | light | dark`, persisted at `localStorage.schoolos.theme`, applied to `<html data-theme>`; boot-time init in `main.tsx` (no flash — applied before first render).
- `/settings → School tab → Appearance → Theme`: three-state segmented **radiogroup** (a setting is not tabs — role=radio + aria-checked + Arrow/Home roving, house-consistent with the Login seg). Click Dark → switches + persists (verified across reload); System clears the stored choice; helper sentence reflects live state.
- Both audits above cover the control end-to-end.

## Bit-identity evidence (the strongest I can produce)

Pre-edit build reconstructed at commit `aa701e5` via **isolated git worktree** (sibling lane's uncommitted server files never touched — no stash), served on a second port; full-page screenshots at 1920×1080, same session, same static clock, decoded to raw RGBA in-process and hashed: **7/8 routes byte-identical**. `/transport` cross-build diff = 1256 px = the same-build self-diff noise floor (1255 px of live-text antialiasing jitter) → **no edit-induced pixel change anywhere**. Verdict + hashes: `logs/u12-pixel-verdict.txt`; PNG pairs kept under `logs/u12-{before,after}-*.png`.

## Disclosures

- Files: 16 modified (`Chart/Flow/Maint/Shell.tsx`, `main.tsx`, `Settings.tsx`, 8 screens with chart/status swaps, `tokens.css`, `components.css`) + 2 new (`dark.css`, `lib/theme.ts`). Preview on :4310 runs the audited build.
- `+12` tokens total (7 chart incl. the disclosed `--chart-red-deep`, 5 interaction ramps) — needs your count blessing in the ledger.
- The multiset computed-style comparator in the audit script produced phantom deltas near its 260-node sampling cap; it is demoted to NOTE with the pixel proof as the authoritative gate (rationale inline in the log).

Files: `handoff/2026-09-06-ui-orchestrator-unit12.md`, `logs/u12-v6.txt`, `logs/u12-pixel-verdict.txt`, `logs/u12-baseline.json`, `logs/u12-{before,after}-*.png`.
