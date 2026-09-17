# HANDOFF — schoolOS → "Definition of 100" (lane L3)

Written 2026-09-14 by the outgoing session because its context is full. **This file is the durable state; the
register and the journal are the truth, not this summary.** Read `docs/PERFECT-100.md` §5 (register), §7 (plan +
Definition of 100) and §8 (change log) and `.coop/status/L3.md` (journal) before acting.

## 1. What is true right now

- **Suite:** 539 tests. A full CI-posture run at `531/539` (`.coop/logs/ci-posture-r22.log`) had 8 failures, all
  diagnosed and fixed; a later run (`.coop/logs/ci-posture-r23.log`, job bash-49) was **killed mid-flight because
  it predates the PLG-1/PLG-2/DAT-6 changes and would therefore be a mixed-epoch artifact**. The last *targeted*
  CI-posture run was **39/39** (`plugins`, `rails-catalog-otp`, `rbac-plugin-edge`, `audit-coverage`,
  `plg-permissions`, `plg-entitlement`, `dat6-attendance-audit`). **A fresh full CI-posture run is step 1.** *Update (round 28): that run happened — 556 tests, 555 pass, 1 fail, and the single failure was the VACUITY GATE catching a defect the outgoing session had introduced in the privilege-pin edit (a 6-line comment wall between a test's opening and its first assertion). Fixed by hoisting the comment; re-scan clean; `test-hygiene` + `rls-boundary` + `admissions-executor` = 15/15. So the suite is believed green but has not been re-run whole since the fix — that re-run is still step 1.*
- **Phases:** 0 ✅ complete · 1 🟢 ~85% · 2 🟡 ~62% · 3 🟡 ~45% · 4 🟢 ~65% · 5 🔴 0% · 6 🔴 0%.
- **Open P0s (10):** DAT-1, DAT-2, DAT-3, DAT-6, PRD-1, PRD-2, OPS-1, OPS-2, OPS-3, OPS-6.
  Closed this arc: PLG-1, PLG-2 (Phase 4's P0s), TST-4, TST-8, DAT-5 (register row was stale — 075 had fixed it).
- **Migrations claimed by L3:** 075–080. **081 is free.** Claim numbers in `.coop/help.md` before writing.

## 2. Resume: the objective to re-create as a goal, and the ceremony

New session, same repo. Re-create the goal with this objective verbatim (goals are session-scoped and do NOT
survive a new session):

> Take schoolOS to the §7 "Definition of 100" in docs/PERFECT-100.md by executing Phases 0–6 in order: close every
> P0 finding in the §5 register, then the P1/P2 items, each with a test or CI assertion that proves the fix and
> would fail if it regressed. Preserve the existing test suite (no weakening of assertions), respect coop laws (no
> git commands, claim migration numbers via .coop/help.md, own migrations are numbered sequentially, TEST_DB_NAME
> for own test runs), and journal progress to .coop/status/L3.md.

Standing lane role **S3/L3**. Round budget was 40; ~18 used.

## 3. Ordered next steps

1. **Fresh full CI-posture run** (≈50 min, background it):
   `cd server && NODE_ENV=test OTP_DEV_ECHO= TEST_DB_NAME=schoolos_ci_r<NN> node --test --test-concurrency=1 --test-timeout=120000 tests/*.test.js > ../.coop/logs/ci-posture-r<NN>.log 2>&1`
   Expect green. Known-justified pin: `rls-boundary.test.js` `AUDITED = 111` (PLG-2's plan lookup). Do not run two
   suites at once (DB contention has produced fake "all cancelled" results before).
2. **DAT-1 (P0, Phase 2)** — tenant alignment is not enforced by the schema: child FKs reference a parent by id
   alone, so a row in tenant A can point at a parent in tenant B. Design: composite keys `(tenant_id, id)` on
   parents + composite FKs on children; migrate in slices (audit the surface first with a query, then enforce the
   core tables, then the plugin schemas). DAT-2 (40 FK-less reference columns) is the sibling.
3. **DAT-6 remainder (P0)** — attendance is done (`tests/dat6-attendance-audit.test.js`, 3/3). Remaining named
   paths: transfer + `enrollment_history`, payment confirm + obligation post, admission→student conversion,
   14 plugin paths, vault lifecycle (OTP issue/consume/attempt bump, MFA enrol, recovery-code consumption), OAuth
   identity linkage, workers (comms transitions).
4. Then Phase 3 (`OPS-1` one-command boot, `OPS-2` compose bootstrap, `OPS-3` alerting, `OPS-6` backups,
   `OPS-8` workers), Phase 2 leftovers, and Phases 5–6.

## 4. Rules that have repeatedly caught real defects (do not relax them)

- **Verify in the CI posture.** `NODE_ENV=test` is what CI runs and where the OTP dev echo is deliberately OFF.
  A file that needs a code must declare `process.env.NODE_ENV='development'` before importing the app (T101 pins
  that staging/test never arm the flags). Local `.env` arms `OTP_DEV_ECHO=1`, which has hidden real CI failures.
- **Changing a test's SETUP is allowed; weakening an assertion is not.** Several "regressions" this arc were
  order-dependent fixtures (B2 deleted one of three rails while asserting "no channel") — fix the fixture and say
  why in a comment.
- **`tests/test-hygiene.test.js` is the vacuity gate** (TST-4, plan item 31). It fails the suite on shapes that
  cannot fail (`>= 0` counts, regex against a literal, `ok(true)`, self-comparison, a test whose only assertion is
  behind a conditional). If it fires, fix the assertion — an allowlist entry needs a reason.
- **Independent verification has found real defects in every round it was used.** Use the review lane before
  marking anything CLOSED: own log under `.coop/logs/`, read-only otherwise, no migrations, no git, its own
  `TEST_DB_NAME`, no concurrent suite, no server start/stop.
- **A stale register row is as damaging as a false closure.** DAT-5 was already fixed by 075; correct the register
  with evidence rather than "fixing" working code — and never close a P0 on a green test alone.

## 5. Traps already paid for (do not re-pay)

- `auditLog(c, tenant, { … })` forwards **`recordRef`**, not `recordId` — a wrong key is dropped silently.
- `loginAs()` returns a token, **not** a tenant id; read the tenant from the DB (`slug='meridian'`).
- Plugin ids contain dots (`ops.visitors`) — filter directories with `withFileTypes`, not on the name.
- `app.communications.dedup_key` has a **partial** unique index: `ON CONFLICT (dedup_key)` fails with 42P10.
  Delete-then-insert instead.
- The OTP door rate-limits **5 requests/minute** per file; a test that needs more must configure a channel.
- Unresolvable audiences are logged as `log-only` and count as **sent** in development — a real failure needs a
  rail that actually fails, or drive `processClaimedRow` directly (the dispatcher exports it).
- Seeding now runs the plugin catalogue per tenant, so `rails.*` rows EXIST as `registered` — test fixtures must
  insert idempotently.
- The full suite takes ≈50 min; a run started before your edits is a mixed-epoch artifact. Kill it and restart.

## 6. Where things live

- Register/plan/log: `docs/PERFECT-100.md` (§5 rows carry the evidence and the exact fix for each finding).
- Journal: `.coop/status/L3.md`. Coop law + migration claims: `.coop/help.md`. Recon for the plugin P0s:
  `.coop/logs/recon-plg12.md` (688 lines — PLG-1's enforcement points and PLG-2's matrix rationale).
- New code this arc: `server/src/plugin-permissions.js`, `server/src/entitlements.js`,
  `server/migrations/080_tenant_plan.sql`, `server/tests/plg-permissions.test.js`,
  `server/tests/plg-entitlement.test.js`, `server/tests/dat6-attendance-audit.test.js`,
  `server/tests/test-hygiene.test.js`.
- Regressions/verification artifacts: `.coop/logs/ci-posture-r2*.log`, `.coop/logs/review-r20.md`.
