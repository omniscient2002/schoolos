FROM: redteam
TO: orchestrator
STATUS: action-requested
DATE: 2026-09-06
CYCLE: 3 — independent regression of the two landed security units + carry-over sweep
METHOD: live black-box probes (curl + Playwright) with real role tokens against 127.0.0.1:8080/:4310; read-only source review. All repros executed this cycle. Companion report for the plugin surface (UPI webhook P0, whatsapp doors, residue): `handoff/2026-09-06-redteam-upi-webhook-plugins.md`.

## Headline
**All four fixes verified independently — the fixers' claims hold.** One new **P0** found on the incoming payments.upi webhook unit (HMAC gate is presence-optional and fail-open; audit/event surfaces accept unauthenticated forged facts — settlement itself held). Carry-over P2s re-confirmed open. Verdict at bottom.

---

## Regression results — all four PASS (independent repros, not the fixers' tests)

### 1. plugin_id pattern enforcement — PASS (extended beyond the fixer's 5 shapes)
`routes.js:503-508` (`PLUGIN_ID_RE`, async `pluginGuard` on enable/disable/settings) + `loader.js:15` (same regex at boot).
Executed: `POST /plugins/:id/enable` with `../../kernel` (URL-encoded traversal), `UPPER.case`, `has%20space`, `x` (too short), `_underscore`, `-leading`, `has_underscore`, and a 71-char id → **all 400 `{"error":"invalid plugin id"}`**, registry unchanged. Semantics note (not a defect): the pinned pattern allows digit-first ids — `9lives` enable → 200 (then disabled; row marked as redteam residue). If you ever namespace numerically, revisit.

### 2. Settings strip (option a) — PASS (independent, all roles × all rows)
`routes.js:521-532`. Executed `GET /plugins` as parent, teacher, coordinator across all 9 registry rows (incl. wave-1 `comms.whatsapp`, `payments.upi`, `transport.gps`, `ops.timetable`): **zero settings value bytes in any response**, shape is exactly `{…, settings: absent, hasSettings, keys, settings_schema}`. Owner/itadmin still receive real settings values (9/9 rows) — privileged path intact. Canary cross-check (plugin report D2): owner-written template value is invisible to parent; only the key *name* (`templates`) leaks, which is your documented tradeoff. (`keys` leaking secret *names* remains an accepted, documented exposure — keep it on the ledger for the option-(b) upgrade.)

### 3. Migration 012 purge — PASS
Owner `GET /plugins`: 9 rows, zero hits for `zz.redteam.*`, `../../kernel`, `com.rtprobe.test`. The `com.rtprobe.test` closure (RTR-001 RT-015 fixture, ledger-provenance-checked) is accepted — no rotation needed, agreed with the plugin agent's analysis.

### 4. Login lockout fix — PASS (the cycle-2 P1 is really dead)
Playwright, executed: route `**/dataset` → 500 → form login → **error surfaces in `.login-error` ("internal error") and the button re-enables** (`disabled:false`) — no more silent "Signing in…" wedge; token is set (server login succeeded) and `schoolos.session` cleared cleanly. Then unrouted the 500 and clicked Sign in again **without reload** → dashboard at `/today`. `ensureDataset` no longer caches rejections; hydrate errors are visible and retryable. Zero pageerrors. (L1/L2 transcript this cycle.)

---

## Carry-over P2s — re-confirmed open (as documented), not regressions
- **Per-account password throttle:** still absent — 5× wrong password → clean 401s, valid login immediately after (no lockout, no per-account counter; only the 20/min/IP limiter).
- **Token revocation on logout:** still none — `POST /auth/logout` 200, then the same token still satisfies `/me` (200). Logout remains client-side + audit-only (`app.js:167-171`, `liveApi.ts:50`).
- **localStorage persistence:** re-confirmed live — token survives tab close in the same profile (L3: fresh tab → auto-authed at `/today`).
- **CORS_ORIGINS wildcard:** still `access-control-allow-origin: *` (credentials header correctly absent). Safe under header-borne auth; pin origins before any non-localhost exposure.

All four were explicitly accepted as demo-deployment tradeoffs in your cycle-2 disposition — status unchanged, queued hardening units remain queued.

---

## Attacked and clean this cycle (beyond the four regressions)
- 012 replay-safety claim: consistent with the static review (migration tracking); live replay not run (redteam scope — no DB writes/restarts), noted honestly.
- Settings write authz: teacher/parent → 403 on `/plugins/:id/settings` (owner/itadmin only).
- WhatsApp template doors: write denied to teacher/parent (403), read denied to parent (403), finance receipts 200 (staff list correct), hostile template names parameterized safely (registry intact) — details in the plugin report.
- Login surface: 5× wrong password clean 401s; valid login unaffected.
- Frontend: zero pageerrors across all probes; dashboard rendering normal.

## Residue disclosure (marked zz.redteam3.*, cleanup via next migration — see plugin report for the full list)
`9lives` plugin row (disabled), UPI webhook test rows/events/audit entries (`evt_rt3_*`), one orphan `app.payments` row status `initiated` (created via the legitimate finance door to obtain a real paymentId for the webhook attack). WhatsApp settings restored to pre-redteam state (verified: only `transport_delay` remains). Nothing in app/src, server/src, or migrations was edited; no git; no kills/restarts.

---

## Verdict
**FIX-FIRST** — the four landed fixes are solid (ship-quality regressions), but the payments.upi webhook unit carries a P0 that must be fixed before 013 ships: see `handoff/2026-09-06-redteam-upi-webhook-plugins.md`. Carry-over P2s remain accepted-for-demo.
