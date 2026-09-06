FROM: plugin-agent
TO: orchestrator
UNIT: ops.visitors v1.0 (migration 024) — gate pass + guardian-verified pickup shipped
STATUS: complete · 67/67 tests (49 + 9 dpdp + 9 visitors) · live pickup drill on :8080 · 0 errors
DATE: 2026-09-07

---

## 1. Ledger corrections (stale frames in this dispatch — evidence-backed)

- **rt4 residue purge "dropped item"**: SHIPPED as **019** (your db22e5f commit). Census 0,
  ledger entry registry-cleanup-rt4@1. Not queued — done.
- **Freshness Math.abs "dropped item"**: SHIPPED — payments.upi gate is ±window
  (`Math.abs(ageMins) > fresh_mins`), `pay_U2_future` → 400 pinned in upi.test. Cycle-4
  P2-A closed.
- **pack.dpdp**: SHIPPED as **023** (your 3df7c2a), 58/58 + live erasure drill. Not
  "after visitors" — it precedes visitors.
- **Numbering**: visitors took **024** (022 = admissions v1.1, 023 = dpdp — both applied
  and committed). "Next free" was never 021/022. Standing ledger: 018 funnel · 019
  rt4-residue · 020 gps · 021 timetable · 022 admissions v1.1 · 023 dpdp · **024
  visitors · 025 next free**.

## 2. ops.visitors v1.0 — factory-authored (018 precedent: no prior contract existed)

**Migration 024_ops_visitors.sql**: plugin_visitors.visit (gate-pass data plane; badge
unique per tenant) + **plugin_visitors.pickup_otp vault** — the 008 kernel pattern:
scrypt+salt hashed, TTL + attempt-bounded, single-use, RLS `USING (false)` denying the
app role entirely (no grants at all — owner connection only). Guarded registry rows +
**capability contract `visitors.gate.pass@1.0.0`** (factory-authored, plugin_id linked)
+ guarded ledger entry. Applied ×2 idempotent; seed replay += 024.

**Module** (6 doors, uniform lifecycle gate, front-desk tier = owner/principal/itadmin/
coordinator; teacher/finance/parent 403):
1. POST /visitors — log expected visitor (visitorName/purpose; studentId validated
   tenant-scoped) → `visitor.logged.v1` + badge V-XXXXXXXX
2. GET /visitors — front-desk list
3. POST /visitors/:id/checkin — expected → checked_in → `visitor.checked_in.v1`
4. POST /visitors/:id/pickup — raises a 6-digit OTP to the student's **PRIMARY guardian
   phone** (app.guardians, is_primary), scrypt-hashed into the kernel vault, TTL from
   settings (pickup_otp_ttl_minutes, default 5) → `visitor.pickup.requested.v1`;
   devCode echoed only under OTP_DEV_ECHO (kernel parity). Fail-closed sub-cases: no
   student link → 400; no primary guardian phone → 409 "manual verification (photo ID
   at desk) required"; re-request while a code is pending → 409 (one active code).
5. POST /visitors/:id/pickup/verify — attempt-bounded (config.otp.maxAttempts), expiry
   checked, timingSafeEqual, **consumed on success** → `visitor.pickup.verified.v1`;
   wrong code bumps attempts on both vault row and visit.
6. POST /visitors/:id/complete — **FAIL-CLOSED RELEASE**: pickup visits without
   verification → 409 "student release is BLOCKED"; the only bypass is an audited
   owner/principal override WITH note (outcomes recorded as "UNVERIFIED RELEASE
   OVERRIDE"). + POST /visitors/:id/deny.

## 3. Tests — 9 new, 67/67 total

Lifecycle gate + front-desk tier pins · badge + double-checkin refusal · OTP-to-primary-
guardian proof (vault row phone == guardian phone) · wrong-code 401 + attempt bump ·
correct-code verify + single-use consumption · **fail-closed release + override
semantics (no-note refused; override completed + loudly audited)** · no-link 400 +
guardianless fail-closed 409 · parent/teacher/finance denials + unknown-student 404 ·
**vault RLS proof: `SET ROLE schoolos_app` → SELECT on pickup_otp throws (permission
denied)** · registry + contract mirror with plugin_id linkage.

Two real bugs the suite caught pre-ship: (a) badge_code column omitted from the INSERT
(500); (b) vault I/O initially ran on the app-role connection — RLS correctly denied it;
moved to the kernel owner path (q) exactly as 008's OTP flow does. Also fixed: the
override gate initially blocked pickup_pending completion even WITH override — the
override now completes from pickup_pending (its entire purpose), still audited loudly.

## 4. Live guardian-pickup drill (:8080, two-shell restart, 0 errors)

```
enable → 200 · pickup visit 37fc7fd7… badge V-CF5606D7
OTP to primary guardian (…0176) — dev-echo only, TTL 5m
complete pre-verification → 409 (fail-closed holds)
wrong code → 401 · correct code → 200 · release → completed (no override)
visitor events: 5 · vault OTP consumed: true
```

## 5. Ledger

Uncommitted (git lane): 024 · ops.visitors module (manifest + index) · visitors.test.js ·
seed.js (+024) · the two capability-contract repairs are data-side (dev UPDATE 2; the
migration file itself carries the fix). **Next free migration: 025.**

**Cycle 5 condition met**: this report covers visitors + the two "dropped" items (both
long-shipped, re-evidenced above). Cycle 5 may fire. Post-cycle-5 queue: wave-3 builds
(exams.assessment runtime first) → pack.cbse.
