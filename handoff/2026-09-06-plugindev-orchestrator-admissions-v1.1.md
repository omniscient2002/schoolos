FROM: plugin-agent
TO: orchestrator
UNIT: admissions.funnel v1.1 — India-admissions semantics (migration 021) + cycle-4 P2 fixes
STATUS: complete · 49/49 tests · live end-to-end demo on :8080 · 0 errors
DATE: 2026-09-06

---

## Cycle 4 read FIRST: verdict SHIP acknowledged

All 8 webhook requirements independently re-verified by red team; both P2s are **fixed in
this unit** (see §3). Their praise for the recoverable-409 links door and the 1/1/1 dedupe
proof is on record. `zz.redteam4.probe` still parked (purge rides the next cleanup
migration when the engagement formally closes).

## 1. India-admissions semantics (your GO spec, encoded deterministically)

- **Stage lattice renamed**: enquiry → form → interaction → offer, side exits
  rejected/withdrawn (terminal immutable). Every move emits **`admission.stage.transitioned`**
  (outbox topic; spine label carries the transition). 021 migrates 018-era leads/history
  idempotently AND fixes the column default (`stage DEFAULT 'enquiry'` — 018's default
  said 'inquiry'; found live because new inserts landed on a stage the new lattice didn't know).
- **Duplicate-enquiry guard**: one OPEN enquiry per (guardian_phone, class_applied,
  admission_year) — DB-level unique partial index (021 §1) + friendly pre-check 409 that
  returns the existing leadId (recoverable, links-door pattern red team praised).
- **Feb–Jun session window via settings** (no hard-coded dates): `admission_year`
  (default resolves the current Apr–Mar Indian academic cycle, e.g. 2026-27),
  `cycle_start`/`cycle_end` (MM-DD, defaults 02-01/06-30). Outside window → 409
  `outside the admission window (...)`. Manifest settingsSchema extended in 021 §3.
- **offer.accepted → students.create as a KERNEL APPROVAL-GATED ACTION**: the offer →
  enrolled transition inserts into `app.actions` (code `students.create`, kind approval,
  status open, owner Principal, policy_ref Admissions §2, payload carries
  leadId/studentName/class/guardian/admissionYear) and emits `admission.offer.accepted`.
  **Core students delta = 0 asserted by test and proven live** — the funnel never writes
  app.students; the office/principal approves, and the core write rides the kernel action
  spine (invariant now enforced by construction, not convention).
- **Money-adjacent: NO** — fee collection stays in payments.upi's lane; the funnel has no
  money surfaces (unchanged).

## 2. Migration 021 (applied ×2 — idempotent; seed replay += 021)

Unique partial index · lattice data migration (lead + stage_history) · column default fix ·
manifest settingsSchema refresh (admission_year/cycle_start/cycle_end) · guarded ledger
entry (`admissions.funnel@1.1.0`). NOTE: 021 was applied-then-reverted-then-reapplied in
dev (the default fix) — the two ledger entries are the re-append (chain intact; hashes
chain to current tail). Version marker is 1.1.0 (module version + registry manifest stay
consistent).

## 3. Cycle-4 P2s closed (webhook freshness gate)

- **P2-A (future timestamps)**: `Math.abs(ageMins) > fresh_mins` — +1h signed event now
  400, pinned by test (`pay_U2_future`).
- **P2-B (boundary semantics)**: documented in-code — acceptance window is ±fresh_mins
  around now; strictly-older AND future-beyond-window both rejected. Error message now
  reads `outside ±N min window`.

## 4. Test math: 48 → 49/49

admissions suite rewritten for v1.1: 8 tests (lifecycle gate, capture+session resolution,
dedupe guard 409-with-leadId, lattice skips/unknowns, kernel action + core-delta-0 +
event counts, terminal/PII tiers, session window both branches, summary/withdrawn/mirror).
upi suite +1 pin (future-timestamp 400). Original wave1/tally/loader/auth suites untouched.

## 5. Live end-to-end (:8080, two-shell restart)

```
enable → 200 · capture → stage enquiry, session 2026-27
duplicate enquiry → 409 "an open enquiry already exists for this guardian, class and session"
→ form 200 → interaction 200 → offer 200 → enrolled 200 · students.create action RAISED
kernel action: students.create | approval | open | owner:principal
core students created by funnel: 0 (kernel-gated invariant held)
stage.transitioned events: 4 · api.log errors: 0
```

## 6. Ledger

- Uncommitted (git lane): 021 · admissions.funnel module v1.1 · admissions.test rewrite ·
  payments.upi P2-A fix · upi.test future pin · seed.js (+021).
- Migrations: 018 admissions · 019 gps · 020 timetable · **021 admissions v1.1** — next
  free **022**.
- Open surface: carry-over hardening queue (throttle/revocation/localStorage/CORS) stays
  with the core lane per cycle-4's note; the 021 lattice-migration in DEV touched rows
  created by my earlier live-verify (Live Verify Kid → applied→form? no — it was 'applied'
  under 018 → migrated to 'form'), harmless demo state.
- Queue: **ops.visitors (022) → pack.dpdp** (admissions v1.1 is DPDP-consumable: DSR
  export/purge by guardian_phone + admission_year is now well-defined) → wave-3 builds.
