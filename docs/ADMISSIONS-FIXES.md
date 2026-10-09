# Admissions Domain — Fixes Register (A1–A15)

> All 15 improvements from the admissions review, fixed one by one and pinned
> by `tests/admissions-fixes.test.js` (**14/14 green**). Pre-existing
> admissions suites updated where behavior intentionally changed and green:
> admissions (8) + v13 (9) + executor (4) + proposer (1) + mpd-rte-payroll.
> Migration `152_admissions_fixes.sql` carries the schema half.

| ID | Finding | Fix (file) | Status |
|---|---|---|---|
| A1 | Dismissing a conversion stranded the lead at `enrolled` — terminal, immutable, no student, no open action | Decide-executor recovery: dismiss reverts lead to `offer` + history; re-raise uses suffixed codes (`students.create.<id>.<n>`, first raise unchanged) — `routes.js` `runConversionDismissalRecovery` + registry entry | FIXED + pinned |
| A2 | Executor skipped P2-6/P2-8 guards (`'unassigned'` grades, duplicate children) | Same class-structure + same-name checks as `POST /students` in `executeStudentCreation` (`routes.js`) | FIXED + pinned |
| A3 | RTE reimbursements: received-without-claimed, duplicate refs, over-claim receives | Chain rules in door (`routes.js`): open-with-claimed, capped receives, received closes; duplicate-row UNIQUE (migration 152) + 23505→409 race backstop | FIXED + pinned |
| A4 | Document attach accepted any UUID without file ownership | Existence + tenant check against `app.files` → 404 (`admissions.funnel/index.js`) | FIXED + pinned |
| A5 | Follow-up SLA sweep had no scheduler | Shared `sla.js` (door + worker), `runAdmissionsFollowupHook` step in `day-worker.js`, cron line in `ops/cron/schoolos.cron` | FIXED + pinned |
| A6 | RTE import gated on `fees.concessions` tier (402 on a statutory flow) | Gate removed with rationale comment (`routes.js`); waiver still auto-approved | FIXED + pinned (core-plan import works) |
| A7 | `enrollment_term` accepted but never read | Removed from manifest schema → SEC-6 rejects it as unknown | FIXED + pinned |
| A8 | No seat limits — silent over-admission | `class_capacity` setting (0=unlimited) enforced at `→offer` with waitlist suggestion; shared `parseGradeApplied` (`admissions-access.js`, kernel refactored onto it) | FIXED + pinned |
| A9 | DOB collected at RTE import then unused; no age eligibility | Optional `dob` at capture (validated, stored — migration 152) → carried into student row; `age_bands` setting enforced at conversion (age as on 31 Mar) | FIXED + pinned |
| A10 | `source` free text rotted reports | `sources` catalogue setting; closed to catalogue when non-empty, free text otherwise | FIXED + pinned |
| A11 | Offer letter: bare text, no price | Fee-table enclosure from the class's plan templates in the letter + `feeLines` in response/audit | FIXED + pinned (binary PDF artifact needs `putFile` exposure to plugins — follow-up, not silent) |
| A12 | Session-window day used UTC, session-year IST (midnight off-by-one) | `mmddIST()` from the IST clock (`admissions.funnel/index.js`) | FIXED (one-liner; covered by window tests) |
| A13 | Scheduled interviews had no reminders | Shared sweep also surfaces 48h interviews/visits (per-activity-per-day dedup, `admission.interview.upcoming` event) | FIXED + pinned |
| A14 | Health orphans were read-only | `POST …/leads/:id/reopen` (owner/principal, reason required, stranded-only: enrolled + no student + no open action) | FIXED + pinned |
| A15 | `rejected`/`withdrawn` needed no reason | Reason required (400), stored on `stage_history.reason` (migration 152, pre-152 fallback) + history SELECT exposes it | FIXED + pinned (existing tests updated) |

Still open / follow-ups: A11 binary-PDF artifact (needs plugin file-write facility); `notify_guardians=false` silent path (no fallback task — by design, documented); RTE `sameName` guard is name-equality (matches `POST /students` P2-8 semantics — consistent, not changed).
