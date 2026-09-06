FROM: plugin-agent (EMPLOYEE-2)
TO: orchestrator
SUBJECT: pack.cbse v1.0 (026) — the 12-plugin roadmap COMPLETE; 81/81; rules-not-code proven; live OASIS export
DATE: 2026-09-07

---

## 1. Unit

**pack.cbse v1.0** — wave-3 policy pair completed (pairs exams.assessment 025). Class C
policy pack: **rules, not code** (docs/11 §2.4 via the 009 contract).

**Migration 026** (applied ×2 dev, idempotent): NO data plane by design —
`plugin_cbse` contains zero tables (the pack's contract is validation + export only;
"no own writes" is a grant-level property, not a convention). One guarded per-tenant
hash-chained ledger entry `pack.cbse@1.0.0-runtime`. Registry manifest + capability
contract `cbse.assessment.validate` remain exactly as 009 provisioned them.

**Module** (`src/plugins/pack.cbse/`, lifecycle gate on every door; tier
owner/principal/itadmin/coordinator — teacher/finance/parent 403):

- GET /rules — six-rule catalog (deterministic body)
- GET /validate/exam/:examId — cross-plugin read over plugin_exams, six deterministic
  decisions + sha256 inputs_digest, full-level audit (rule/inputs_digest/decision per
  the 009 contract):
  **R1 weightage_total** (the contract's guard rule: weightage_total <> 100) ·
  **R2 grade_scale** · **R3 marks_bounds** · **R4 eligibility_floor ≥ 75%** (board norm —
  the pack FLOORS it; adds obligations, never relaxes) · **R5 report_integrity** (digest
  presence + grade re-derived from stored pct — the pack re-derives, never trusts) ·
  **R6 board_identity** (affiliation + academic year).
- On R1 FAIL the pack performs the contract-mandated side effect: raises the kernel
  approval action `cbse.weightage.<examId>` (per-instance code — the UNIQUE(tenant,code)
  lesson from the exams unit applied from birth) with policy_ref 'CBSE pack obligations',
  and emits **cbse.obligation.due.v1**. Open obligation is reused, never duplicated.
- GET /export/oasis/:examId — OASIS-ready board export: R6-gated (409 without
  affiliation/AY), **published-only** (409 on drafts — nothing leaves for the board
  before kernel approval), CSV with board header + candidate rows (enrollment, name,
  class, pct, grade, points, per-report digest), sha256 content_hash, digest-level audit
  (tally.voucher.export precedent).

**Invariants encoded:** deterministic_only (same exam → same decisions → same validation
digest, pinned) · adds_obligations_never_relaxes_safeguards (R4 floors ≥75; R1 raise is
advisory-approval, never a bypass) · weightage_total_enforced · no_own_writes (0 tables).

## 2. Tests — 5 new, full suite **81/81, 0 cancelled** (clean exclusive run)

Gate 409 pre-enable · tier 403s (teacher/finance/parent) · deterministic catalog ·
**R1 fail → kernel obligation raised under per-exam code** (+ reuse-while-open pin +
cbse.obligation.due.v1 + full-level audit) — with the key posture proof: exams.create
itself refuses Σ≠100, so the test corrupts stored weightage directly (the pack re-derives,
it never trusts) · remediation flow (data fixed → re-validation passes; the obligation
stays open for humans) · all-pass: six decisions, digest stable, no obligation ·
**OASIS export**: R6 409 → settings → draft 409 → publish via the kernel spine →
export 200 with header/content-hash + digest-level audit row.

## 3. Bugs the harness caught pre-ship

1. Test-order coupling: test 4 validated the exam test 3 had corrupted (Σ=90) — fixed by
   restoring the weightage first, which also models real remediation.
2. Export JOIN assumed first_name/last_name/class_grade — `app.students` carries
   `name`/`grade` (caught at 500, fixed to actual schema).

## 4. Live evidence (:8080, two-shell restart, 0 api errors)

enable 200 → settings persisted (affiliation 1130001, AY 2026-27) → rules catalog
(R1–R6) → validate on the published exam: R1 pass (Σ=100) / R2 pass (cbse_10_point) /
R3 pass / R4 pass / R5+R6 pass → **OASIS export: format oasis_v1, board CBSE,
affiliation 1130001, AY 2026-27, 1 candidate, content_hash b1d4d19e…**; CSV row:
`MER-2777,"Aarav S. Sharma",8,88,A2,9,<report-digest>` → own-writes census:
**plugin_cbse tables = 0**, cbse audits = 2 (validate + export).

## 5. Ops note

One full-suite run collided with a concurrent `npm test` (a 700s-timeout verification
run by another agent — two suites dropping `schoolos_test` under each other). I waited
it out; the reported 81/81 is a clean exclusive run. Consider a file-lock or distinctive
DB name per runner if concurrent verification becomes routine.

## 6. Roadmap + queue

**The 12-plugin roadmap is COMPLETE** (every catalog id has runtime + tests + live
evidence). Ledger: 024 visitors · 025 exams · **026 cbse · next free 027**. Uncommitted
in my lane (your git lane): `migrations/026_pack_cbse_runtime.sql` ·
`src/plugins/pack.cbse/` · `tests/cbse.test.js` · `scripts/seed.js` (replay += 026) ·
this handoff. Per the locked list, next: **hr.leave (027) → health.clinic (028)** —
await dispatch (roadmap says 12 plugins; confirm whether hr.leave/health.clinic are the
next two or whether wave-3 remainder means something else in your ledger). Cycle 6
fires when cycle 5's verdict lands.
