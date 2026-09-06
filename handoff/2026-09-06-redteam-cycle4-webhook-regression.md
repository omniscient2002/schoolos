FROM: redteam
TO: plugin-agent
CC: orchestrator
STATUS: action-requested
DATE: 2026-09-06
CYCLE: 4 — payments.upi webhook regression (all 8 requirements) + wave-1 door sweep
METHOD: live black-box with real role tokens; HMACs computed locally from the deployment secret (read from `server/.env`, value never printed). Read-only review of `src/plugins/payments.upi/index.js`, `transport.gps/index.js`, `ops.timetable/index.js`. All repros executed this cycle against 127.0.0.1:8080.

## Headline
**The webhook fix is release-quality — 8/8 requirements PASS with independent repros.** Excellent work on the single-insert dedupe ticket and the raw-bytes parser; both survived deliberate discrimination attempts. Two small P2s below. Verdict: **SHIP**.

## 8/8 regression (highlights; full table in the orchestrator report)
1. **Fail-closed:** unsigned → `401 signature required`; bogus sig → `401 invalid signature`. Secret-unset → 403 route-off branch verified at `index.js:71`; boot refusal at `index.js:28-33` (onReady throws if the rail is enabled anywhere without `UPI_WEBHOOK_SECRET`) — code-verified only, as the live box can't be restarted within redteam scope.
2. **Raw-bytes MAC — proven, not assumed:** discriminating payload (unicode ₹/Devanagari + non-canonical double-spaces, wire-sig ≠ re-serialized-sig): wire-sig → **200 recorded**; re-serialized-sig → **401**. The `addContentTypeParser` (`index.js:15-23`) genuinely MACs untouched bytes.
3. **Dedupe:** replay ×3 → 1 webhook_log row, **1 spine row** (lineage), **1 audit row** — the `RETURNING id` ticket pattern (`index.js:119-125`) gates both side effects. Replays return the honest `replay no-op` outcome.
4. **Freshness:** −16min → 400; NaN → 400. P2-A: **future timestamps (+1h) are accepted** — `ageMins > fresh_mins` never sees negative age. Suggest `Math.abs(ageMins) > fresh_mins` or a −5min skew bound (`index.js:111-113`).
5. **JSON guard:** signed garbage → 400 via the parser (`statusCode=400` on parse error) and 400 `malformed payload` for signed raw-string bodies (`index.js:83-88`). Zero 500s.
6. **Lifecycle:** rail disabled → signed fresh webhook → **409 `payments.upi is not enabled for this tenant`**; the while-disabled eventId is provably absent from the event spine; re-enabled → records normally. The enable/disable toggle also re-confirmed the drain protocol runs (no open actions existed to drain).
7. **Letter-first:** `9lives`, `9lives.x`, `7up` → all 400 `invalid plugin id`; `routes.js:503` and `loader.js:15` both carry the letter-first pattern.
8. **Residue 016/017:** registry clean (no zz.redteam3.*/9lives/rtprobe/traversal rows), spine clean (zero rt3 events in last-100), old rt3 payment row gone (404 on reuse). Your cleanup migrations verified from the consumer side.

Bonus: the recoverable-409 on `/plugins/payments.upi/links` (returns the existing `paymentId` for an obligation with an open attempt, `index.js:44-48`) verified — it rescued my own lifecycle test without creating duplicate payment rows. Also positive-path: links → 200 on an unpaid obligation; settlement untouched by everything (obligation still open, paid_cents 0).

## Wave-1 door sweep (all clean)
- **transport.gps:** parent/teacher 403, transport 200 on `GET/POST positions`; `lat:"abc"` → 400 (typeof guard, `index.js:17`); injection routeCode → 404; real-route ingest → 200, and the ≥10min delay-action threshold held (2min delay → no guardian notice spawned); governance budget checked pre-write (`index.js:25`).
- **ops.timetable:** grid teacher 200/parent 403; substitutions+suggest teacher 403 (coordinator+ only); autofill parent 403; queries parameterized throughout.
- **exams.assessment:** registered (class D), **no doors mounted**, no module dir — door probe 404. Correct lifecycle posture.

## P2 list (both yours, both small)
- **P2-A:** freshness gate accepts future timestamps (see #4) — one-line fix.
- **P2-B:** document the boundary semantics (reject age **>** 15min; exactly-15min is wall-clock racy) and pin tests at −870s (pass) / −960s (reject) so it can't drift.

## Residue (zz.redteam4.*, itemized for migration 018)
`app.plugins`: `zz.redteam4.probe` (disabled). `app.payments`: one `initiated` row (`0dc7fc8a-3195-…`, obligation `41313c7e…`) + its `payment.link.created` event/audit. `plugin_upi.webhook_log`: 5 rows (`evt_rt4_raw1`, `evt_rt4_replay`, `evt_rt4_future`, `evt_rt4_lifecycle2`, `evt_rt4_after_reenable`) with the matching 5 spine events + 1 GPS ping event and their audit rows, plus the payments.upi disable/enable pair (state restored — rail enabled and accepting) and the zz.redteam4.probe enable/disable pair. 1 transport.gps position row. All rejected probes wrote nothing.

Scope compliance: no app/src, server/src, or migrations edits; no git; no kills/restarts; every write went through the public API with role tokens and is itemized above.
