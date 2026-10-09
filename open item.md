# Open items — Part 1 onboarding (people chain)

Status as of 2026-10-06. "Done" = implemented + tested. "Open" = verified gap, fix deferred with reason.

## Open

### 1. `/parent/links` has API but no screen
- Bind/unbind a guardian account ↔ child post-hoc (`POST|GET|DELETE /parent/links`, `family.view/index.js:499-560`). Only creation-time linking exists (People console picker + automatic phone-match).
- Bites when: wrong child picked, account predates the pupil, guardian phone changed.
- Recommendation: add link/unbind controls on parent rows in `PeopleAdmin` (reuses existing wrappers). **First steady-state item after Part 1**, not an onboarding blocker.
- Effort: medium.

### 2. Bulk promote has API but no screen
- `POST /plugins/people.admin/students/promote/bulk` (grade-cohort year-end rollover).
- No onboarding use case — a new school has no year history. Revisit with the year-end flow (year 2+).
- Effort: small, when scheduled.

### 3. No idempotency on account provisioning
- Double-submit (or retried request) mints duplicate accounts; UI busy-guards cover clicks only.
- Accepted: same as every other door, no corruption path (unique constraints hold), low blast radius. Revisit only if bulk/provisioning automation retries appear.
- Effort: medium (idempotency keys), not justified now.

### 4. Deferred school-identity fields (explicit scope cut)
- Currency, academic-year config, school type, affiliation/registration no., established year, logo — deliberately left out of signup/profile to keep onboarding minimal. Needed when: fees needs currency, reports/returns need affiliation, certificates need logo.
- Recommendation: add to the School profile screen (`/school-profile` → `tenants.config`) when the first consumer lands, not before.
- Effort: small per field.

### 5. ARCHITECTURE CHANGE — sibling discount must require explicit principal/finance-head approval
**Current behaviour (auto-apply):** `POST /fee-plans/:id/generate` directly writes
`fee_obligations.concession_cents` for every student who shares a guardian phone with another
active student — `server/src/routes.js:2954-2973`. The discount is applied with **no human
review**, and the plan only needs `auto_concession = { kind:'sibling', percent, min_children }`
(`validateAutoConcession`, `routes.js:2848-2855`). The `concession_cents = 0` clause is the only
guard against re-applying.

**Problems with auto-apply:**
1. **Money is forgiven without approval.** Creating/keeping a plan with a sibling rule silently
   reduces what families owe, bypassing the concession approval workflow entirely. The person who
   sets the plan controls the discount with no second pair of eyes.
2. **The sibling match is a heuristic.** Shared guardian phone can produce false positives
   (unrelated children at one number, a foster/combined household, a shared office number) and
   false negatives (siblings with different phones / different spellings). Auto-trusting it moves
   real money.
3. **Inconsistent with every other concession.** Scholarship/staff/waiver all require
   request → approve; sibling is the one kind that applies itself. Same money, different control.

**Desired behaviour (propose → approve):** Generation should **propose** sibling concessions,
not apply them. For each matched student it creates a `fee_concessions` row with
`kind='sibling'`, `status='requested'` (never `approved`), `requested_by = NULL` (system/plan),
carrying the computed `percent`/`amount_cents` and the obligation it targets. `net_amount_cents`
does **not** change at generation. A principal or finance head then reviews and approves through
the existing decide door (`POST /fees/concessions/:id/decide`, `routes.js:3793`), which applies
`concession_cents` as it already does.

**Design decisions to settle when implementing:**
- **Approver set.** User's requirement: principal or finance head. Existing decide gate is
  `require('owner','principal','finance','finance_head')` (`routes.js:3793`). Decide whether to
  narrow to principal/finance_head (+owner as ultimate authority) for `kind='sibling'`, or accept
  the current set.
- **System requester + SoD.** The decide door refuses `requested_by == approver` unless owner
  (`routes.js:3800-3802`). System requests have `requested_by = NULL`; the guard must treat NULL
  as "not self" and admit any authorized approver.
- **Dedup / idempotency.** `fee_concessions` has **no unique key** (one row per call). Re-running
  generation must not spawn duplicate pending sibling requests. Add a dedup key, e.g. unique
  pending sibling concession per `(tenant_id, student_id, obligation_id, kind)`, and have
  generation `ON CONFLICT DO NOTHING`.
- **Bulk approval UX.** A large school could queue hundreds of sibling requests at once. The
  Concessions tab needs a bulk "approve all matching" affordance, or approvers drown. This is the
  main new UI work.
- **Who may create plan rules.** Since the rule now only *proposes*, the plan-create gate can stay
  as-is (`owner, principal, finance, finance_head, finance_clerk`). But consider: should only the
  approver tier be able to *author* a sibling rule, to avoid clutter?
- **Migration/backfill.** Schools that already have auto-applied sibling concessions keep them
  (already-approved, already in `concession_cents`); only generation going forward changes. No
  data rewrite. Consider marking historic auto rows so reports can distinguish them.
- **Naming.** `auto_concession` / `validateAutoConcession` now describe a proposal; consider
  renaming to `sibling_concession_rule` / `validateSiblingRule` for honesty.

**Touch points:**
- `server/src/routes.js` generation block `:2954-2973` (apply → propose).
- `server/src/routes.js` decide door `:3793-3822` (NULL requester handling; approver set).
- `fee_concessions` migration (dedup key) — new migration file.
- `app/src/screens/FeePlans.tsx` (rule copy: "proposes", not "applies") and the Concessions tab in
  `app/src/screens/Fees.tsx` (bulk approve).
- Docs: `FEES-DESIGN.md` §6.5 lifecycle + §14 plan step; `FEES-STORY.md` "sibling discount that
  fired by itself" must become a request→approve scene.
- Tests: `server/tests/fee-plans.test.js:169-181` ("sibling auto-concession is applied at
  generation", asserts `autoConcessions >= 2`) must flip to asserting **pending** requests and
  an unchanged net; add propose→approve→net-drops and unapproved-does-not-reduce-net tests. Also
  `fees-enterprise.test.js:131` already exercises a manually-created `kind:'sibling'` concession,
  so the approval path is partly covered.

**Effort:** medium-high (server + migration + bulk-approve UI + test/doc sweep). **Classification:**
architecture change to the money path — schedule deliberately, not as a drive-by.

## Done, pending test verification
(none — all verified 2026-10-06; see regression anchors below)

## Done and verified (regression anchors)
- **RTE lottery import admits IT admin** — door gate + `RteManager` `canWrite` + lane copy (`setup.test.js:08`, 10/10 pass; `mpd-rte-payroll` 8/8 unaffected).
- **Bare parent accounts refused door-side** — 400 G-2 mirror (`setup.test.js:09`); `wave-b.test.js` stranger-parent updated to carry a phone (no child_link, same 403 intent), 11/11 pass.
- Suspended sole IT admin reopens the step on both `/onboard/status` and `/school/setup` (`onboard.test.js:11b`).
- Principal-overreach refusal audited before 403 (`setup.test.js:04`).
- Phone-clash 409 names the phone (`setup.test.js:03b`).
- Principal → IT-admin only; owner → principal only; teacher provisions nobody (`setup.test.js:01-04`).
- Setup guide read is owner/principal/itadmin only (`setup.test.js:06`).
