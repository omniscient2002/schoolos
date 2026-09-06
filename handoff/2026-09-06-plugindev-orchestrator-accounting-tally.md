FROM: plugin-agent
TO: orchestrator
UNIT: settings-strip verification + reconciliation · wave-2 #1 accounting.tally
STATUS: complete · 36/36 server tests green · strip uniform live · accounting.tally live on :8080
DATE: 2026-09-06

---

## 1. Your verification finding (parent sees comms.whatsapp settings) — diagnosis

Your "leaked: True" result does not reproduce on the current tree or the live API:

- **Working tree** `src/routes.js`: uniform projection present (one `.map()` over ALL rows; non-privileged get `{settings: undefined, hasSettings, keys, settings_schema}`).
- **Your own commit** `b8339b7` ("Plugin factory + comms.whatsapp unit 1 … 35/35") already contains the strip (committed line: `settings: undefined, settings_schema…, configured: …`) — it strips for every row too.
- **Live re-verified after a fresh two-shell restart** (API process 16:39, routes.js mtime 16:22 — running current code): parent GET /plugins → **9 rows, 0 settings leaks**, comms.whatsapp → `settings: undefined, hasSettings: true, keys:["templates"]`; owner still sees own-tenant settings verbatim.
- The mixed result you saw (comms.whatsapp leaks, others show none) is the signature of a process running the **pre-unit-#1 projection** (raw rows; only comms.whatsapp had settings data — the other three were `{}`). Your "31/31" test count is the wave-1-era count (unit #1 added the 4 loader tests → 35; wave-2 #1 → 36), so your verification ran against a tree/process that predates unit #1's P1-2 fix. **Please re-verify against the current checkout.**

**Uniformity is now also pinned by test:** `tests/plugin-loader.test.js` (P1-2) asserts `every(pl => pl.settings === undefined)` across ALL rows for teacher AND parent, plus the `{hasSettings, keys}` shape — not just pack.cbse.

## 2. Plugin_id validation — yes, that fix was mine

Unit #1 added `PLUGIN_ID_RE` + `pluginGuard` on enable/disable/settings (commit b8339b7); cycle-2 hardened it to your exact pattern `^[a-z0-9][a-z0-9.-]{2,63}$` (uncommitted working-tree edit, see §4). Traversal/bogus ids → 400, five shapes pinned by test.

## 3. com.rtprobe.test forensics (recap — full alert in 2026-09-06-plugindev-orchestrator-registry-security.md)

**Runtime-origin, not from any migration**: zero references in `server/migrations/`, `scripts/seed.js`, `tests/`; `git log --all -S "rtprobe"` = empty. Ledger: enabled 2026-09-05 17:10, disabled 18:20, re-enabled 18:23 (+05:30) — all via an authenticated **owner-token session** (actor "A. Meridian"). Manifest `{}`. **Purged** via cleanup migration (below). Recommend: confirm which lane probed the enable path yesterday evening; if unclaimed, rotate demo owner secrets.

**Also flagging:** a new non-catalog registry row `9lives` (class A, **disabled**) appeared on meridian — not mine, id passes the regex, no live surface. Listed here for provenance; purge candidate for the next cleanup migration if unclaimed.

## 4. Cleanup migration — done as 012 (011 was taken by comms.whatsapp's per-plugin migration)

`migrations/012_plugin_registry_cleanup.sql`: DELETE (all tenants) of `zz.redteam.probe`, `zz.redteam.oversize` (the ~800KB manifest row), `zz.redteam.race`, `../../kernel`, `com.rtprobe.test` + guarded hash-chained ledger entry per tenant with residue. Applied to dev DB: 5 → 0 rows; ledger entry on meridian only (dps-rival had no residue); replay-safe ("migrations up to date"). Registry now: 9 rows (8 catalog + `9lives`).

## 5. Wave-2 #1 — accounting.tally (B, T1) delivered

- **Module** `src/plugins/accounting.tally/{manifest.js,index.js}` (drop-in; loader mounts it; zero core edits): `GET /daybook` (confirmed payments for a window, voucher-ready rows, totals computed from the same GROUP BY that renders vouchers → `voucher_totals_match_ledger` by construction), `POST /export` (Tally-importable receipt-voucher XML, content-hash digest audit per the 009 contract, emits `tally.export.completed` under the event budget), `GET /exports` (history rides the kernel audit ledger). **Read-only on money: every door is SELECT-only; the only writes are the plugin's own audit/event rows.**
- **Migration** `013_accounting_tally.sql` — registry row + `tally.voucher.export` contract copied VERBATIM from 009 (extracted programmatically, not retyped) + guarded registration audit entry; applied + replay-safe; `seed.js` replay list updated.
- **Tests** `tests/tally.test.js` (+1): kernel-flow payment → daybook totals match → export XML digest → history shows digest → ledger byte-identical after (read_only_on_ledger) → payments.upi webhook fact still cannot settle (kernel-only settlement holds).
- **36/36** (25 original + 6 wave-1 + 4 loader + 1 tally). Live: enabled (owner, audited), daybook shows the seeded ₹18,500 UPI receipt, export returns `<ENVELOPE>…` XML, api.log 0 errors.

## 6. Next

Wave-2 continues per the approved list: **pack.dpdp → admissions.funnel → ops.visitors** (same per-unit bar). Uncommitted working-tree files from my cycle-2 + this unit (routes.js, loader.js, plugin-loader.test.js, migrations/012 + 013, plugins/accounting.tally/, tests/tally.test.js, seed.js) need your git lane to commit — git writes stay out of my lane.
