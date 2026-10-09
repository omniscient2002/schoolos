# SchoolOS — Honest Flags Register

> **One document for every known gap.** Each flag carries a severity, a verification status
> against HEAD, the evidence (file), the fix (done or planned), and how to verify it.
> Statuses: `FIXED` (verified in tree) · `OPEN` (verified broken) · `OPERATOR`
> (needs a human with production access) · `DECISION` (needs a product call).
>
> Verified 2026-10-06 against `main` @ `d0f492c` + working tree, live Postgres probe,
> and direct source reads. Where the September audit (`docs/PERFECT-100.md`,
> `docs/PROJECT-MAP.md`) disagrees with HEAD, **HEAD wins** and the audit line is
> marked stale.
>
> Companion: `docs/OPEN-ITEMS.md` — everything still OPEN (operator runbook, QA
> checklists, product decisions, engineering follow-ups), each with exact steps
> and acceptance criteria.

## Method

Each flag was checked one of three ways: **(R)** read the source directly; **(P)** live
Postgres probe; **(A)** the project's own audit/docs (second-hand, well-grounded). The
method is noted per flag.

---

## F-01 · Workers unscheduled — FIXED
- **Severity:** was BLOCKER.
- **Evidence:** `server/docker-compose.yml` (R) now schedules `webhook-worker`,
  `workflow-worker` (long-lived pollers) plus `outbox`, `comms-dispatcher`, `retention`;
  `ops/cron/schoolos.cron` covers one-shots (`day-worker`, `dunning-reminders`,
  `reconcile-payments`); `server/tests/ops-deploy.test.js` fails if a CLI worker is
  scheduled in neither place.
- **Fix (done):** OPS-8 closed structurally — a new worker cannot ship unscheduled again.
- **Verify:** `node --test tests/ops-deploy.test.js`; `rg -n "command: node scripts" server/docker-compose.yml`.

## F-02 · Compose start-order inversion — FIXED
- **Severity:** was BLOCKER.
- **Evidence:** `server/docker-compose.yml` (R) has a one-shot `db-init` service running
  `migrate → bootstrap`; every long-lived service waits on
  `service_completed_successfully`. The old `bootstrap && migrate` chain is gone.
- **Verify:** inspect `db-init.command`; `tests/helpers.js` documents the same order.

## F-03 · Backups unscheduled / PII perms — PARTIALLY FIXED
- **Severity:** HIGH → MED.
- **Evidence:** `.gitignore` (R) already excludes `backups/`; `ops/backup/` has README,
  `restore-drill.sh`, `money-drill.sh`, `encrypt-offsite.sh`, `pitr.compose.yml`;
  `ops/cron/schoolos.cron` covers scheduling.
- **Remaining (OPERATOR):** install the cron on the host; `chmod 600` existing dumps;
  rehearse one restore (DB + `FILES_DIR`).
- **Verify:** `crontab -l`; `ls -la backups/`.

## F-04 · No TLS/edge, no alerting on reference host — OPERATOR
- **Severity:** HIGH. Nothing in code can fix a missing edge; `ops/alerts/` exists.
- **Fix:** terminate TLS at the edge, scrape `GET /metrics`, alert on `outbox_parked`,
  `comms_sandbox_sent`, `wh_stalled`, `api_heartbeat_age`, `backup_age`.

## F-05 · CI never builds image / Node mismatch — FIXED
- **Severity:** was MED.
- **Evidence:** `.github/workflows/ci.yml` (R) pins Postgres 18 (digest-pinned) and
  Node 26 to match the runtime (`TST-14` comment).
- **Remaining:** image build/smoke still not in CI — tracked as backlog in comments.

## F-06 · RLS ENABLE-not-FORCE on ~30 domain tables — FIXED (audit line stale)
- **Severity:** was HIGH.
- **Evidence (P):** live probe of all `app/*`, `auth/*`, and domain schemas: every
  RLS-enabled table is FORCED except by-design `app.auth_otps` (`USING(false)` vault)
  and `app.capability_contracts` (platform read). Only `app.ops_counters`
  (deliberate) and `auth.session_activity` lack RLS.
- **Fix (done):** `server/migrations/124_force_rls_plugin_schemas.sql` + earlier sweeps.
- **Verify:** the probe SQL in §Method (re-run any time).

## F-07 · `postgres` default ACL can re-arm DELETE — OPEN (needs superuser)
- **Severity:** HIGH.
- **Evidence (A):** migrations `072`/`077` print the superuser command but cannot run it.
- **Fix:** run the printed command as superuser; `tests/acl-d35.test.js` guards the effect.
- **Status:** OPERATOR (one command) + test-guarded.

## F-08 · `users.password_hash` app-role-readable — OPEN
- **Severity:** MED.
- **Evidence (R):** `server/src/app.js:361` login selects `password_hash`.
- **Fix (planned, batch 1):** narrow auth SELECTs to explicit columns; keep a
  kernel-only password lookup.
- **Verify:** `tests/rls-boundary.test.js` + new column-scope assertion.

## F-09 · TOTP `===` while `constantTimeEqual` ships unused — FIXED
- **Severity:** was MED.
- **Evidence (R):** `server/src/totp.js:48` now uses `constantTimeEqual`.
- **Fix (done, batch 1):** constant-time compare in `verifyTotpStep`.
- **Verify:** `tests/l2-mfa.test.js` 6/6 + `tests/fixbatch1-honest-flags.test.js` 4/4.

## F-10 · Reconcile worker runs as owner, writes `events` with no outbox row — OPEN
- **Severity:** MED.
- **Evidence (R):** `server/scripts/reconcile-payments.js:13` aliases `q = sysq`
  ("all-tenant maintenance job").
- **Fix (planned):** per-tenant constrained loop; route warnings through `emitEvent`.
- **Verify:** reconcile tests.

## F-11 · No HMAC on GPS ingestion; `deviationM` unused; threshold hardcoded — PARTIALLY FIXED
- **Severity:** was MED.
- **Fix (done, batch 3):** threshold is now the `delay_threshold_mins` setting
  (default 10) — severity, guard, and action text.
- **Remaining:** device-secret HMAC (protocol decision) + `deviationM` geofence
  (feature). Tracked as product decisions.
- **Verify:** `tests/transport-write.test.js` (in the 19/19 batch).

## F-12 · UPI never compares signed amount; Razorpay no idempotency keys — PARTIALLY FIXED
- **Severity:** was MED.
- **Fix (done, batch 3):** webhook reads the signed `entity.amount`, compares to the
  payment row, and on mismatch emits a `warn` event with `amountMismatch` payload +
  high-risk audit (`SIGNED AMOUNT ≠ PAYMENT — confirm door must reconcile`).
  Additive only: fact-recording never blocks; settlement still kernel-only.
  Razorpay idempotency keys remain open (gateway-side change).
- **Verify:** `tests/upi.test.js` (+tally/rails) 10/10.

## F-13 · Tally `?company=` raw into XML — FIXED
- **Severity:** was MED.
- **Fix (done, batch 3):** `escXml` helper escapes company, ledger, party, receipt,
  student, and gateway-ref interpolations in `voucherXml`.
- **Verify:** `tests/tally.test.js` (in the 10/10 batch above).

## F-14 · Rails `ok:true` on missing creds AND failed settings reads — FIXED
- **Severity:** was MED.
- **Fix (done, batch 3):** all three rails return a failure sentinel on settings-read
  error; sends answer `{ok:false}` instead of degrading to logger-ok. Unconfigured
  (no credentials) still uses logger honestly.
- **Verify:** `tests/rails.test.js` + `tests/rail-provider-honesty.test.js` +
  `tests/comms-honesty.test.js` + `tests/comms-fanout.test.js` 23/23.

## F-15 · `POST /ai/call` writes no audit row; caller-trusted `pluginId` — FIXED
- **Severity:** was MED.
- **Evidence (R):** `server/src/app.js:1589` — audit row `AI call (ok|…)` written
  best-effort (gateway S0-B6 precedent: ledger failure never 500s the call).
  Attribution (`pluginId`) remains caller-supplied — noted in the row.
- **Verify:** `tests/plg-ai-budget.test.js` 11/11, `tests/me-effective.test.js` +
  `tests/l2-p5-gateway-workflow.test.js` 14/14, `tests/fixbatch1-honest-flags.test.js`.

## F-16 · Student identity split (`teacher.classroom` name-match) — FIXED
- **Severity:** was HIGH.
- **Fix (done, batch 4):** new `resolveStudentByUser` (structural first); submit gate
  uses the bound row's grade as the class check; name-match stays as fallback for
  pre-account rows; stale header comment rewritten.
- **Verify:** `tests/teacher-classroom.test.js` 25/25 incl. new F-16 test (bound
  submission lands on the bound namesake; wrong-grade bound refused).

## F-17 · `degraded` status written by nobody; loader boot-fatal — OPEN (DECISION)
- **Severity:** MED. Three gates accept `degraded`; no writer; one broken folder
  kills the API (`loader.js`).
- **Fix:** decide per-plugin degradation vs boot-fatal (product call), then implement.

## F-18 · Silent-empty `.catch(() => ({rows:[]}))` — FIXED
- **Severity:** was MED.
- **Fix (done, batch 2):** new shared `server/src/plugins/_shared/optional-table.js`
  (`pluginAbsent`, 42P01-only); `family.view` local copy replaced with the import;
  all 7 `student.world` sites + the family route lookup use it.
- **Verify:** `tests/parent-family.test.js` + `tests/student-world.test.js` 27/27.

## F-19 · Audit `ip` unused; `075` same-ms ordering; cold chain not walked — PARTIALLY FIXED
- **Severity:** was LOW.
- **Fix (done, batch 1):** migrations `148_audit_ip.sql` (15-arg `audit_append`
  overload storing `NEW.ip`; 14-arg kept) + `149_audit_append_unambiguous.sql`
  (drops the 14-arg so untyped 14-arg calls resolve via `DEFAULT NULL` instead of
  erroring "not unique" — caught live via seed.js). `src/audit.js` passes
  `entry.ip` with a 42883 fallback for pre-148 DBs. Wired on identity doors:
  `issueSession` (all 6 issuance paths), logout, switch, password change,
  onboarding signup, `/ai/call`.
- **Remaining (acknowledged limits):** same-ms ordering + cold-chain walk stay
  documented limits.
- **Verify:** `tests/audit-integrity.test.js` 14/14 + `tests/fixbatch1-honest-flags.test.js`
  (login ip non-null); seed green after 149.

## F-20 · `ai_calls` no retention; `brief_log` no purge — OPEN
- **Severity:** MED.
- **Fix (planned):** retention-worker purges `ai_calls` past N days + `brief_log`
  past N days (tenant-scoped, additive).
- **Verify:** retention tests.

## F-21 · Seed replay list — FIXED
- **Severity:** was MED.
- **Evidence (R):** `server/scripts/seed.js:355` now covers `009–048` + `083` + `132`,
  and `:368-370` calls `ensurePluginCatalog(client, t.id)` — the signup catalog is
  the source of truth.
- **Verify:** seed + catalog-drift test.

## F-22 · Unread plugin settings — MOSTLY FIXED
- **Severity:** was MED.
- **Fix (done, batch 3):** `transport.gps delay_threshold_mins` wired (severity +
  guard + action text); `ops.timetable autofill_default` wired (`none` = report,
  no writes); `ops.import max_shadow_rows` passed to `shadowReport` caps;
  `pack.cbse weightage_strict` and `pickup_otp_max_attempts` verified already-read
  (map lines stale).
- **Remaining:** `ops.bi cache_seconds` (needs a freshness-semantics decision — a
  cache changes read guarantees) and timetable `absence_feed` consumer (a feature:
  leave→substitution linkage). Tracked as product decisions.
- **Verify:** transport/timetable/import suites green (19/19).

## F-23 · Money UI disconnected — FIXED (verify)
- **Severity:** was BLOCKER.
- **Evidence (R):** wrappers exist (`liveApi.ts:255-341`); `Fees.tsx` calls
  `apiVoidObligation`, `apiRefundPayment`, `apiReconcile`, `apiRunDunning` from
  buttons; `ParentFees.tsx` wires `createUpiLink`/`createRazorpayOrder`;
  reconcile surfaces `amountMismatch`.
- **Remaining:** click-through QA per button (operator QA).

## F-24 · Bearer-only transports — FIXED (verify)
- **Severity:** was HIGH.
- **Evidence (R):** all four transports import `apiRequest` (= shared `call`)
  from `liveApi`; the timeout fix (batch 5) applied once covers all.
- **Remaining:** run the app under cookie session and click each POST (operator QA).

## F-25 · Zero frontend tests — STALE (tests exist)
- **Severity:** was HIGH.
- **Evidence (R):** `app/` ships Vitest + jsdom + Testing Library with 10 suites;
  `npm test` = 64/64 green. Added `src/test/transport-timeout.test.ts` (F-26
  deadline + error contract) — now 11 suites.
- **Remaining:** grow coverage on money-button wiring and demo-label assertions.

## F-26 · No error differentiation / timeouts — MOSTLY FIXED
- **Severity:** was HIGH.
- **Evidence (R):** stable server `error-codes.js`, `err.code/status/payload` +
  request-id on the thrown Error, `friendlyErrors` CODE_MAP — all in tree.
- **Fix (done, batch 5):** `AbortSignal.timeout` (30s default, per-call
  `timeoutMs`) on the shared `call` — covers all four transports; TimeoutError
  maps to a friendly timeout copy (realm-safe name check).
- **Verify:** `src/test/transport-timeout.test.ts` 4/4; `tsc -b` clean.

## F-27 · Counselor/teacher/exam screens missing or unrouted — FIXED (verify)
- **Severity:** was MED.
- **Evidence (R):** every teacher Shell nav link has a matching `<Route>`
  (`/teacher`, `/homework`, `/submissions`, `/lessons`, `/leave`, `/support`,
  `/duties`, `/copilot`, `/mastery`, `/progress-story`, `/curriculum`,
  `/analytics`, `/exam-marks`, `/safety` + concerns/doubts/interventions/ptm).
- **Remaining:** click-through QA that each screen loads live data (operator QA).

## F-28 · Demo fiction as telemetry — FIXED (verify)
- **Severity:** was MED.
- **Evidence (R):** `AiGovernance.tsx:39` reads real `/ai/calls`;
  `AiUsage.tsx` carries a `SampleNote` ("illustrative in this build and are not
  read from your school's records").
- **Remaining:** demo-store honesty pass (invented policy-refs) — tracked.

## F-29 · `/live` harness flaws; campus switcher; i18n; misc UI — MIXED
- **`/live` harness (STALE):** no `/live` route exists in `App.tsx` — removed.
- **Fees dead toggle (FIXED, batch 5):** `setQueueOnly` unwired → read-only flag
  with comment; `tsc -b` clean.
- **PrintButton a11y (ACCEPTED):** toast + documented aria-live node; visible
  failure text. Adequate.
- **Student ticks (LABELED):** StudentLearning states ticks are device-only.
- **Remaining:** campus switcher (client-only by design), i18n coverage growth.

## F-30 · README stale counts (`factory-check.mjs`, `25/25`, `62/63`) — FIXED
- **Severity:** was LOW.
- **Fix (done, batch 1):** real gate commands (`check.js` + `npm test` + `tsc -b`);
  counts updated to 141 routes / 85 screens with pointer to generated matrix.

## F-31 · DEFAULT_ON "5 incl. library" claim — FIXED
- **Severity:** was LOW.
- **Fix (done, batch 1):** `ONBOARDING-NEW-SCHOOL.md` + two `PROJECT-MAP.md`
  lines corrected to 4 (library opt-in).

## F-32 · Migration numbering drift — ACKNOWLEDGED (convention)
- **Severity:** LOW. Cite filenames (already the convention).

## F-33 · Git: uncommitted work, single committer — PROCESS (open)
- **Severity:** MED. 259 changed paths in tree at handover time.
- **Fix:** commit in reviewed slices (operator/owner action; not done by agent unasked).

---

## Fix batches (execution record, 2026-10-06)

1. **Batch 1 — DONE:** F-09 (TOTP constant-time), F-15 (`/ai/call` audit row),
   F-19 (migrations 148+149 audit-ip overload + auth-door wiring), F-30/F-31
   (README + DEFAULT_ON doc corrections). New tests:
   `tests/fixbatch1-honest-flags.test.js` (4/4). Note: 148 alone broke seed with
   "function not unique" (overload ambiguity) — fixed by 149 dropping the 14-arg
   version so 14-arg calls resolve via `DEFAULT NULL`.
2. **Batch 2 — DONE:** F-18 (shared `_shared/optional-table.js`, both planes).
   F-06 verified already-fixed by live probe (all tables FORCED; `124` migration).
3. **Batch 3 — DONE:** F-12 (UPI signed-amount mismatch flag, additive), F-13
   (Tally `escXml`), F-14 (all three rails fail loudly on settings-read error),
   F-22 (GPS `delay_threshold_mins`, timetable `autofill_default`, import
   `max_shadow_rows`; `cache_seconds` + `absence_feed` consumer stay product
   decisions), F-11 (threshold part; HMAC/geofence stay decisions).
4. **Batch 4 — DONE:** F-16 (`resolveStudentByUser` structural-first + header
   rewrite + regression test incl. namesake and wrong-grade cases).
5. **Batch 5 — DONE (code) / QA (operator):** F-26 (shared-transport deadline +
   realm-safe TimeoutError + 4 frontend tests), Fees dead-toggle fix (`tsc`
   clean), F-23/F-24/F-27/F-28 verified wired-or-labeled in tree
   (F-25/F-29 sub-claims about missing tests/routes/harness were stale).
6. **Operator handoff (not code-fixable here):** F-03 (install cron, chmod,
   rehearse restore), F-04 (TLS + alerts), F-07 (superuser default-ACL command),
   F-33 (commit slices), plus click-through QA checklists on F-23/F-24/F-27.

Verification in this pass: `scripts/check.js` all green; server suites —
l2-mfa 6/6, audit-integrity 14/14, plg-ai-budget 11/11, gateway+effective 14/14,
fixbatch1 4/4, parent-family+student-world 27/27, teacher-classroom 25/25,
upi+tally+rails 10/10, transport+timetable+import 19/19, rails+comms 23/23,
import-mapping+clash+rails-live 28/28, onboard+session 27/27; app `tsc -b`
clean, Vitest 11 files / 68 tests green.
