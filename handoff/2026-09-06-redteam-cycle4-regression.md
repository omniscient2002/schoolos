FROM: redteam
TO: orchestrator
STATUS: action-requested
DATE: 2026-09-06
CYCLE: 4 — independent regression of the shipped webhook fix (all 8 requirements) + wide sweep of new doors + carry-over P2s
METHOD: live black-box with real role tokens against 127.0.0.1:8080; HMAC signatures computed locally against the deployment secret (read from `server/.env`, value never printed — verifying the server's verification logic, not the secret's box-local secrecy); read-only source review. Companion detail for plugin-agent: `handoff/2026-09-06-redteam-cycle4-webhook-regression.md`.

## Headline
**All 8 requirements PASS with executed repros. The webhook unit is release-quality.** One P2 found (future timestamps accepted by the freshness gate) and one semantics note. No P0/P1 anywhere this cycle. Verdict: **SHIP**.

---

## R1–R8 regression results (all independently reproduced)

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Fail-closed | **PASS** | unsigned → `401 {"error":"signature required"}`; bogus sig → `401 {"error":"invalid signature"}`. Secret-unset 403 branch and boot refusal verified in code (`payments.upi/index.js:70-73`, `:28-33` — onReady throws when any tenant has the rail enabled and `UPI_WEBHOOK_SECRET` absent; cannot restart the live box, code-read only, as agreed) |
| 2 | Raw-bytes MAC | **PASS** | Discriminating payload (unicode `fee — ₹१८५ ✓` + non-canonical double-spaces): sig over exact wire bytes → **200 fact recorded**; sig over `JSON.stringify(JSON.parse(wire))` → **401**. The server MACs wire bytes — the cycle-3 re-serialization hole is dead (`index.js:15-23` custom parser stores `req.rawBody`) |
| 3 | Spine+audit dedupe | **PASS** | same event_id ×3 → `200 fact recorded` then 2× `200 replay no-op (event already recorded)`; spine rows for that eventId: **1**; audit rows: **1** (verified via `GET /events/lineage` + `GET /audit`); webhook_log=1 by construction (`ON CONFLICT … RETURNING` single-insert ticket, `index.js:119-125`) |
| 4 | Freshness | **PASS (one P2)** | ts=−16min → `400 stale event rejected`; ts=NaN → 400. −15min boundary: strict `>` semantics with wall-clock drift — my −900s probe landed 400 (age crossed 15.0min during processing); semantics are "older than 15 min rejected" — document inclusive/exclusive. **Deviation:** ts=+1h future → **200 accepted** (negative age passes) — see P2-A |
| 5 | JSON guard | **PASS** | signed garbage with `application/json` → **400** (parser-level, `err.statusCode=400`); signed garbage `text/plain` → **400 {"error":"malformed payload"}`. Zero 500s this cycle — the cycle-3 500 is dead |
| 6 | Lifecycle | **PASS** | disabled `payments.upi` → signed fresh webhook → `409 {"error":"payments.upi is not enabled for this tenant"}`; the while-disabled event **absent from the spine**; re-enabled → 200 recorded. (Rail restored — verified accepting again) |
| 7 | Letter-first | **PASS** | `9lives`, `9lives.x`, `7up` → all `400 "invalid plugin id"`; both regexes updated (`routes.js:503`, `loader.js:15`); valid letter-first id still accepted (probe canary, disabled after) |
| 8 | Residue 016/017 | **PASS** | registry: zero `zz.redteam3.*`/`9lives`/`rtprobe`/traversal rows; spine: zero `rt3` events in last-100 lineage; webhook_log=0 per your verification — spot-checks concur. Old rt3 payment row also gone (webhook 404 on it) |

Bonus verification: the recoverable-409 on `/plugins/payments.upi/links` works — re-linking an obligation with an open attempt returns the **existing paymentId** instead of erroring or duplicating (`index.js:44-48`).

---

## Wide sweep — new doors (all clean)

- **transport.gps**: `GET/POST /plugins/transport.gps/positions` — parent 403, teacher 403, transport 200. Input validation: `lat:"abc"` → 400 (typeof guard, `index.js:17`); SQL-injection routeCode → 404 (parameterized); positive ingest with a real route code → 200, and the delay-action guard held (2min delay < 10min threshold → no guardian-notice action spawned, `index.js:43-57`). Event budget breaker checked before writes (`index.js:25`).
- **ops.timetable**: `GET grid` teacher 200 / parent 403; `POST substitutions` teacher 403; `GET substitutions/suggest` teacher 403; `POST attendance/autofill` parent 403. Mutation doors are coordinator/principal/owner/itadmin as designed; all queries parameterized.
- **exams.assessment**: registered, class D, **no doors mounted** (no `src/plugins/exams.assessment/`; door probe → 404). Registry-only — correct for its lifecycle stage.
- Nothing new is reachable that shouldn't be; every new door's authz matched its role list exactly.

## Carry-over P2s — all re-confirmed open (as accepted)
- Per-account password throttle: still absent (5×401 then valid 200, no lockout).
- Token revocation on logout: still none (`/me` 200 with post-logout token).
- localStorage persistence: token survives tab close (code unchanged, `liveApi.ts:15-21`; live-reproduced cycle 3 L3).
- CORS wildcard: `access-control-allow-origin: *`, allow-credentials header absent (0 in preflight). Safe under header-borne auth; pin before non-localhost.

---

## P2 — polish (the only new findings)

### P2-A · Freshness gate accepts future timestamps (negative age)
`payments.upi/index.js:109-115` — `ageMins > fresh_mins` only rejects *positive* age. A signed event with `created_at` = now+1h passes and, once recorded, stays replay-immune-by-freshness forever. Requires a valid HMAC to exploit (secret compromise is the bigger problem), so P2. **Fix:** reject `Math.abs(ageMins) > fresh_mins` (or `ageMins < -5` skew bound).

### P2-B · Freshness boundary semantics — document inclusive/exclusive
"Exactly −15min" probes are wall-clock racy (processing delay pushes age past 15.0). State in the docs/tests that the gate rejects `age > 15min` (i.e. ≤15:00 accepted) and pin a test at −870s (passes) / −960s (rejects) so semantics can't drift.

---

## Residue disclosure (mine, zz.redteam4.*, itemized for migration 018)
- `app.plugins`: `zz.redteam4.probe` (disabled) — valid letter-first canary.
- `app.payments`: one row `0dc7fc8a-3195-…` status `initiated` (obligation `41313c7e…`, via the legit finance door to obtain a paymentId; recoverable-409 correctly returned it on re-link).
- `plugin_upi.webhook_log`: 5 rows — `evt_rt4_raw1`, `evt_rt4_replay`, `evt_rt4_future`, `evt_rt4_lifecycle2`, `evt_rt4_after_reenable`.
- `app.events`/`app.audit`: the matching 5 webhook facts + 1 `payment.link.created` + 1 GPS ping event; audit rows for the same, plus the payments.upi disable/enable pair (lifecycle test — state restored) and the zz.redteam4.probe enable/disable pair. All rejected probes (401/400/404/409) wrote nothing.
- `transport.gps` positions: 1 row (positive-path probe).
- State restoration verified: payments.upi enabled + accepting; whatsapp settings untouched; no catalog rows modified.

## Verdict
**SHIP** — 8/8 regressions green, wide sweep clean, P2-only findings. The webhook unit and the new doors are demo-ready; the accepted carry-over hardening queue (throttle/revocation/localStorage/CORS pinning) remains the only open surface.
