FROM: plugin-agent (EMPLOYEE-2)
TO: orchestrator
SUBJECT: UI-lane batch rides the cbse+remediation unit — ops.visitors 1.0.1 · 90/90 · wrapper removal unblocked
DATE: 2026-09-07

---

## Amends: 2026-09-07-plugindev-orchestrator-cycle5-remediation.md (cbse + cycle-5 batch, still 88/88 → now 90/90)

All four UI-lane items done. **Migration 028_ui_lane_visitors.sql** (registry bump +
ledger `ui-lane@1` + data convergence) applied ×2 on dev. ops.visitors → **1.0.1**.

## 1 · verify-door status codes — OTP-state ≠ auth (UI lane #1)

- invalid code → **422** (processable request, unprocessable code)
- expired / already-consumed code → **409** (state conflict)
- 401 now appears ONLY from auth failures (`require()` preHandler) — the global
  session-expiry convention is intact; the desk no longer logs out mid-verify.
- Pins: visitors.test.js test 4 re-pinned to 422; new test 10 (expired → 409, including a
  forced-expiry on a fresh visit).

## 2 · guardian-lookup door (UI lane #2) — my choice: door on ops.visitors, not dataset hydration

`GET /plugins/ops.visitors/guardian-lookup?studentId=|admissionNo=|q=` (desk tier; PII
aware): returns studentId (app.students **UUID** — the dataset's st_north_1-style ids are
fixture keys and stay out of the live path), admissionNo, name, class, and
`guardian {name, relation, phoneOnFile, phoneTail}` — masked; full numbers never leave
the OTP vault path. Students without a primary guardian return `guardian: null` (manual
photo-ID path, same as the pickup door's 409). Data-flow contract: **the pickup roster
resolves through this door; /dataset stays the UI's static mock.**

## 3 · seed coverage (UI lane #3) — 376/376

seed.js: primary guardian for EVERY student (was 15 of 25 8-B). Documented drill phones
pinned (Aarav → Kavita …0176, Diya → …0177). Migration 028 §1.5 backfills/converges
EXISTING environments to the same state (idempotent; skips covered students, converges
the pins) — verified live: 376/376, cast-Aarav now Kavita/…0176.

## 4 · F1 decision (UI lane #4) — your lean adopted: reseed-before-RC, NO delete door

Audit trails stay append-only; visitors rows accumulate until the RC reseed. Recorded in
the ledger entry `ui-lane@1` and here. If RC reseed needs a helper script later, that's a
fresh dispatch (bootstrap + seed already cover it).

## Evidence

- **Full suite 90/90, 0 cancelled** (visitors 9 → 11; +2 for the door and the expired-pin).
- Live :8080 (two-shell restart, 0 api errors): full pickup cycle — create → checkin →
  pickup (devCode) → **wrong code 422** (desk stayed logged in) → **correct code →
  verified**; second visit expired-code → **409**; lookup by id/admissionNo/name with
  masked tail (full phone absent — asserted); finance → 403 on the desk door; census
  376/376; visitors ver 1.0.1.
- **UI ACTION**: the 401-swallowing wrapper can be removed once this ships (this
  migration + ops.visitors 1.0.1 is the flip signal).

## Lane

Uncommitted (your git lane, adds to the cbse/remediation list): `migrations/028_ui_lane_visitors.sql` ·
`src/plugins/ops.visitors/index.js` (codes + lookup door) · `scripts/seed.js` (+028, guardians for all) ·
`tests/visitors.test.js` (test 4 re-pin, tests 10–11) · this handoff.
Ledger: 026 cbse · 027 cycle5-remediation · **028 ui-lane · next free 029 → hr.leave**
(health.clinic follows at 030). Cycle 6 fires after the combined unit lands + cycle 5's verdict.
