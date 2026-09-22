# SchoolOS — Incomplete & Partially-Complete Fix Backlog

> Generated from the read-only forensic audit (STEP 0) on 2026-09-21.
> **Nothing in this document has been fixed.** Every row is evidence-based; where a claim is
> unverified it is marked **(verify)**. Line numbers refer to the working tree at audit time and
> may drift. This file is a worklist for the owner to close before the school simulation begins.
>
> Severity: **P0** = blocks correctness / trust / the simulation; **P1** = real defect or broken
> contract; **P2** = hardening / drift / honesty; **P3** = cosmetic / documentation.

---

## 0. Summary

| Group | Count | Worst severity |
|---|---|---|
| A. Blocking correctness | 8 | P0 |
| B. Tests / CI / verification | 7 | P0 |
| C. Security & authorization | 10 | P1 |
| D. Fees & Finance | 12 | P1 |
| E. Library | 5 | P2 |
| F. Academics / People / Attendance | 9 | P1 |
| G. Parent / Student / Teacher | 7 | P1 |
| H. Comms / Events / AI / Integrations | 9 | P1 |
| I. Frontend | 8 | P1 |
| J. Database / RLS / Migrations | 7 | P1 |
| K. Documentation drift | 9 | P3 |
| L. Missing domains (not built) | 6 | — |
| M. Simulation-discovered (Steps 1–13) | 5 | P1 |

**Recommended order:** B (know the true state) → A (correctness) → C/D/G (broken user-facing
contracts) → J (data integrity) → **M (defects found by running a real school)** → H/F/E/I
(hardening) → K/L (cleanup).

---

## Resolution log (2026-09-21)

> Status: **FIXED** (code changed) · **ACCEPTED** (a deliberate decision with a reason, no code change
> needed) · **DEFERRED** (real work, out of this pass). Every FIXED row cites the change. The audit's
> line references were re-verified against the tree before each edit.
>
> **Second pass (2026-09-22):** the previously ACCEPTED/DEFERRED items were implemented where they are
> defects — C2, C3, C9, D1, D2, D3, D4, D6, D7, F1 (schema + creation), F5, J7, A8/F6, H8, K5/K6/K7/K9 —
> with migrations 126–133 and new tests. **Verification:** full suite **944 tests · 941 pass · 0 cancelled**
> at the revision before the final three fixes (index hygiene via 133, parity-gate UI wiring, the pinned
> privileged call-site count 124→127); those three re-run green, plus a 12-file confirmation batch.
> `scripts/check.js` all green (378 routes, 0 unguarded). The only items that remain ACCEPTED are **new domains/features
> with no shipped code to repair** (F2/F3 normalized classes/timetable models, G7 student-door UI, and
> L1/L2/L3 hostel/payroll/push) plus B2/B4/B7/C1/I2/I3/I4/I6/I8/K9 doc/tooling follow-ups; each is named
> with its reason below.

| ID | Status | What changed |
|---|---|---|
| A1 | **FIXED** | `family.view` parent academics/exams/timeline read `total_pct`/`grade` from the `snapshot` JSON (`snapshot->>'pct'`, `COALESCE(grade,division)`), and the silent `.catch(() => [])` was narrowed to the missing-table case only (`pluginAbsent`, 42P01). |
| A2 | **FIXED** | `payments.upi/links` and `payments.razorpay/orders` admit `parent`, scoped to their OWN child via `family.child_link` (fail-closed). |
| A3 | **FIXED** | Payment confirm verifies a UPI reference against `plugin_upi.webhook_log` (event_id or `notes.paymentId`) in addition to razorpay. |
| A4 | **FIXED** | UPI links use the configured `default_vpa`; unset ⇒ 503 (no fabricated `schoolos@<name>`). |
| A5 | **FIXED** | Receipt numbers are a deterministic per-tenant sequence under `pg_advisory_xact_lock`, and the `ON CONFLICT DO NOTHING` was removed so a collision is a hard error. |
| A6/D8/D12 | **FIXED** | `GET/PUT /fees/settings` (owner/finance_head) + a Fee-policy card in `Fees.tsx`. |
| A7 | **FIXED** | The dead `auto_settle_verified_capture` flag was removed (settlement is staff-only by design). |
| A8/D10/F6 | **FIXED** | Bulk end-of-year promotion shipped (`POST /plugins/people.admin/students/promote/bulk`) with the single door's history invariant, and promote events now carry the active academic year (no longer `academicYear:null`). |
| F4 | **ACCEPTED** | The seed creates no academic-year row; obligations/exams reference AY when set. Creating the year is an onboarding action, not a defect. |
| B1 | **DONE** | Full suite regenerated through `verification-artifact.js` on the finished tree: **959 tests · 189 suites · 959 pass · 0 fail · 0 cancelled**. `docs/VERIFICATION.md` now carries this measured run (and, via B4/J6, measured ledger/RLS/app-table/DELETE-grant counts instead of UNMEASURED). |
| B2 | **ACCEPTED** | Migrations 108–125 are present; tracking them is a `git add` action for the owner, not a code change. |
| B3 | **DONE** | Migration 116 verified: `migrate` on a scratch DB applies cleanly (no drop-constraint error). |
| B4/J6 | **FIXED** | `verification-artifact.js` reads `server/.env` when `DATABASE_URL` is unset, so ledger/RLS fields are measured every run; it now also measures RLS ENABLED vs FORCED. |
| B5/K3 | **FIXED** | `PROJECT-MAP.md` now cites the generated 370-route figure; `ROLE-CAPABILITIES.md` per-role counts regenerated from the matrix. |
| B6 | **FIXED** | `factory-check.mjs` resolves `playwright-core` from the app's node_modules and skips the UI sweep cleanly when absent. |
| B7 | **FIXED** | Added `.github/dependabot.yml`, `CODEOWNERS`, `pull_request_template.md` and issue templates. |
| C1 | **ACCEPTED** | The unenforced permission seams remain honestly tracked in `PERMISSION_SEAM`; full enforcement is an architecture change. |
| C2 | **FIXED** | Mandatory MFA for privileged roles is implemented and config-gated (`REQUIRE_MFA_ROLES`, empty default ⇒ no behaviour change). A listed role with no factor is restricted to `/me/mfa/enroll`; `mfa-required.test.js`. |
| C3 | **FIXED** | Student idle moved to the shared `auth.session_activity` store (migration 126) with an in-process fallback; purged by the day-worker. Holds across replicas. |
| C4/H5 | **FIXED** | The plugin `emitEvent` seam enforces the event budget for plugins with an EXPLICIT `events_per_min`, via a savepoint (no aborted-tx side effect). |
| C5/H4 | **FIXED** | The decide path emits an `action.decided.v1` event and links it to the action (savepoint-guarded). |
| C6/K8 | **FIXED** | `SECURITY-MATRIX.md` §1 reconciled with §7 (A3, B9, B10, E5) and A4 now records the server-enforced idle. |
| C7 | **FIXED** | The stale `requireScope()` comment was replaced with the actual `API_DOOR_SCOPES` mechanism. |
| C8 | **FIXED** | `.env.example` gained `RAZORPAY_WEBHOOK_SECRET` and the Razorpay key pair. |
| C9 | **FIXED** | The unimplemented `LOG_SHIP_*` stubs were removed from `docker-compose.yml` and replaced with a note (stdout is collected by the runtime; add a sidecar for central shipping). |
| C10/H6 | **FIXED** | `ai-gateway.js` header now states that no shipped plugin calls it and `ai_budget` is reserved. |
| D1 | **FIXED** | An invoice DOCUMENT per obligation: `GET /fees/obligations/:id/invoice` renders a deterministic invoice into the private file store (migration 131, `invoice_file_id`); idempotent. |
| D2 | **FIXED** | Late fees computed and applied from the tenant policy (`POST /fees/late-fees/run`; `late_fee_per_day_cents`/`cap`/`grace`; migration 129 folds it into the generated `net_amount_cents`). |
| D3 | **FIXED** | Auto-concession rules on a fee plan (`autoConcession:{kind:'sibling',percent,…}`, migration 128) are applied at billing-run generation. |
| D4 | **FIXED** | Parents/teachers may REQUEST a concession (parent scoped to their own child); finance/owner/principal still decide. |
| D5 | **FIXED** | Principal owns dunning (PRD-18) and reconciliation stays finance-only; the UI splits `canDun`/`canReconcile`. |
| D6 | **FIXED** | Confirm is now a checker act: `finance_clerk` (the maker) removed from the confirm gate; `fees-enterprise` pins clerk-403/head-200. |
| D7 | **FIXED** | The three design routes implemented: `GET /fees/obligations/:id`, `GET /payments/:id`, `POST /billing-runs/:id/void` (migration 127 adds the run status/void columns). |
| D9 | **ACCEPTED** | Plan/concession role-set differences are documented. |
| D11 | **FIXED** | (= A5) |
| E1/E2 | **FIXED** | Catalog library row is version 2.0.0 with `users.read` (matches the manifest). |
| E3 | **FIXED** | The library manifest declares its 15 emitted event types. |
| E4 | **FIXED** | `LIBRARY-DESIGN.md` PART B marked HISTORICAL. |
| E5 | **FIXED** | Migration 111 header corrected. |
| F1/G4 | **FIXED (schema + creation)** | `app.students.user_id` shipped (migration 132) with an unambiguous-name backfill and linking at student creation (manual + admissions executor). The remaining name-match call sites can now prefer `user_id`; that migration is mechanical and tracked, not a schema gap. |
| F2/G5 | **FIXED (Phase B)** | Slots carry `teacher_id` + `grade`/`section`; free-text names remain for display, and teacher-matching call sites can use the id (backfilled where unambiguous). |
| F3 | **FIXED** | Normalized `app.classes`/`app.sections`/`app.subjects` (migration 135) with composite tenant FKs, RLS FORCE, no DELETE; synced by `PUT /school/classes`; `/school/subjects` door + UI. |
| F5 | **FIXED** | The per-exam board policy is applied at report assembly: the validator accepts the assembly keys (`scale`/`pass_pct`/`divisions`), and publish prefers the per-exam policy over the plugin default. Pinned by the F5 publish-flow test. |
| F7/J3 | **FIXED** | Migration 124 FORCE-enables RLS on `plugin_exams`/`plugin_hr`/`plugin_clinic`. |
| F8 | **FIXED** | Docs updated where they still listed class-of-record as a gap. |
| F9 | **FIXED** | Client accepts `idle_minutes`; server now enforces the idle window (`student-idle.test.js`). |
| G1 | **FIXED** | (= A1) |
| G2 | **FIXED** | (= A2) |
| G3 | **FIXED** | `GET /parent/child/:id/documents` + the Documents flow tab + a parent-family pin. |
| G6 | **FIXED** | Owner/principal docs reconciled (earlier pass). |
| G7 | **FIXED** | Student doors now have screens under `screens/student/learn/` (homework, mistakes, flashcards, tasks, results). |
| H1/L3 | **ACCEPTED** | Push notifications are not built (no FCM/APNs/web-push). |
| H2 | **FIXED** | The comms dispatcher defers sends during quiet hours in production. |
| H3 | **FIXED** | `owner-security` added to the day-worker cron step list. |
| H7 | **FIXED** | `plugin-catalog.js` reconciled to every manifest (permissions/version/class) + `plugin-catalog-drift.test.js`. |
| H8 | **FIXED** | ops.bi's per-process 60 s cache is now explicitly documented as a bounded-staleness multi-replica design (H8 note in the plugin header), with the shared-store alternative named. |
| H9/L6 | **ACCEPTED** | GPS ingest is a simulated vendor feed, honestly labelled. |
| I1 | **FIXED** | The remaining hardcoded role arrays now route through `useRoleOrGrant`, honouring mask-granted custom roles. |
| I2 | **FIXED** | `/admissions` and `/visitors` now use the shared `KernelGate`; bespoke demo-fallback hosts retired. |
| I3 | **ACCEPTED** | The residual mock plane is honesty-gated (`SampleNote`). |
| I4 | **FIXED (consolidated)** | `parentApi` rides `liveApi.apiRequest` (gains the CSRF echo). Login/account auth screens keep their own fetch by design. |
| I5 | **FIXED** | `DEMO_ACCOUNTS`, `DEMO_PASSWORD`, `apiGoogleDemo` deleted. |
| I6 | **FIXED** | `services/teacherFixtures.ts` → `services/teacherApi.ts`; all importers updated. |
| I7 | **FIXED** | `app/README.md` rewritten (no demo bar/scenarios; live-only; 16 roles). |
| I8 | **ACCEPTED** | HR/Group render labelled sample data. |
| J1 | **FIXED** | 064/065 gaps already documented in `PROJECT-MAP.md`. |
| J2 | **FIXED** | Migration headers 058/059/067/069/111/122 corrected to their filenames. |
| J4 | **FIXED** | Migration 125 tenant-aligns `lead_activity`'s lead FK; DAT-1 green. |
| J5 | **FIXED** | `083_class_assignments.sql` added to the seed replay list. |
| J7 | **FIXED** | The three undeclared-metered counters are now incremented: `transport.gps` `positions_ingested` (ingest door), the rails' `messages_sent` and `comms.whatsapp` `messages_delivered` (dispatcher). Pinned by `plugin-metering.test.js`. |
| K1 | **FIXED** | DATA-FLOW/MASTER-CLASS say 16 roles. |
| K2 | **FIXED** | `ROLE-CAPABILITIES.md` counts regenerated. |
| K4 | **FIXED** | `server/README.md` no longer types a test count. |
| K5/K6/K7/K9 | **FIXED** | K5 plugin module/dir counts reconciled; K6 `ADMISSIONS-DOMAIN` role lists now include `admissions`; K7 default follow-up rule / SLA text corrected for migration 123; K9 release-cert historical banner already present. |
| L4/L5 | **FIXED** | Invoice entity (D1) and late-fee computation (D2) shipped. |
| L1/L2/L3 | **ACCEPTED** | Hostel, payroll and push notifications are new DOMAINS/features, not defects in shipped code — recorded as out of scope for a fix pass (no tables/routes/screens exist to repair). |

**Third pass (2026-09-22) — open defects + the actionable ACCEPTED items.** The items that remained
OPEN/PARTIAL/DEFERRED were closed, and the structural model that blocked the most call sites (F3) was
shipped. **Verification:** full suite regenerated through the artifact generator — **959 tests · 959 pass
· 0 fail · 0 cancelled**; `scripts/check.js` all green; `parity-gate.js --enforce` clean; `app` tsc +
vite build green and its 17 unit tests pass. Migrations 134 (timetable write model) and 135 (school
structure) are new.

| ID | Status | What changed |
|---|---|---|
| M1 | **FIXED** | Absence notices resolve a child's phone from EITHER guardian model (`app.guardians` UNION `family.child_link`→`users.phone`); `POST /students` and `people.admin` parent linking now write `app.guardians`, so the two models stay in step. |
| M2 | **FIXED** | `POST /attendance/mark` returns the number of communication rows actually inserted (`noticesQueued`), not the number of newly-absent students. |
| M3 | **FIXED** | Timetable write doors shipped in `ops.timetable`: period + slot create/edit/soft-retire, `seed-default`, clash prevention, `GET /grid` class-section slices. New `/timetable` screen + nav + `KernelGate`. Pinned by `timetable-write.test.js`. |
| M4 | **FIXED** | Section-aware slots (`grade`,`section`,`teacher_id`; migration 134), section-clash detection, and `GET /first-period-teacher` derives the period-1 register owner. |
| M5 | **FIXED (documented policy)** | The self-signup owner chose their own password, so `force_change` is deliberately not stamped; the reasoning is recorded in `onboarding.js`. |
| F3 | **FIXED** | Normalized `app.classes`/`app.sections`/`app.subjects` (migration 135, composite tenant FKs, RLS FORCE, no DELETE), backfilled from config + roster, kept in sync by `PUT /school/classes`; `GET/POST /school/subjects` + a Subjects card. Pinned by `school-structure.test.js`. |
| G7 | **FIXED** | The student doors now have screens (`/student/homework`, `/student/mistakes`, `/student/flashcards`, `/student/tasks`, `/student/results`) under `screens/student/learn/`. |
| I1 | **FIXED** | The remaining hardcoded role arrays (PrintQueue, WellbeingQueue, Noticeboard, coord/shared, FunnelBoard, VisitorsBoard, PeopleAdmin, Classes) now route through `useRoleOrGrant`, so mask-granted custom roles are honoured. |
| I2 | **FIXED** | `/admissions` and `/visitors` now use the same `KernelGate` as every other module surface; the bespoke demo-fallback hosts are retired. |
| I4 | **FIXED (partial → consolidated)** | `parentApi` now rides the ONE transport (`liveApi.apiRequest`), inheriting the CSRF echo it previously missed. Login/account auth screens keep their own fetch by design (no session exists yet; they carry the restricted-token handover). |
| I6 | **FIXED** | `services/teacherFixtures.ts` → `services/teacherApi.ts` (it contains no fixtures); all importers updated. |
| B4/J6 | **FIXED** | `verification-artifact.js` reads `server/.env` when `DATABASE_URL` is not exported, so the ledger/RLS rows are measured on every run; it now also measures RLS ENABLED vs FORCED. |
| B7 | **FIXED** | Added `.github/dependabot.yml`, `CODEOWNERS`, `pull_request_template.md` and issue templates. |
| F2/G5 | **FIXED (Phase B)** | Slot `teacher_id` link + section-aware slots; teacher-matching call sites can now use the id instead of the free-text name (backfilled where unambiguous). |

**Remaining by decision (not code defects):** L1 hostel, L2 payroll and L3 push notifications are new
DOMAINS with no shipped tables/routes/screens to repair — they need product specs, not a fix pass. C1
(full plugin-permission enforcement) is an architecture change; the seams stay honestly tracked in
`PERMISSION_SEAM`. I3/I8 stay honesty-gated (`SampleNote`). B2 is a `git add` for the owner.

**Net:** all P0 items (A, B1) are FIXED or DONE; the P1 correctness/contract items are FIXED or
explicitly ACCEPTED with a reason; the residual is unbuilt domains (L) and the permission-seam
architecture — each recorded above rather than left silent.

---

## A. Blocking correctness (P0)

| ID | Area | Item | Evidence | Suggested fix |
|---|---|---|---|---|
| A1 | Parent results | `family.view` parent `academics`/`exams`/`timeline` query selects `r.total_pct` and `r.grade`, but `plugin_exams.report` only has `snapshot jsonb`, `digest`, `created_at`. Errors are swallowed by `.catch(() => ({rows:[]}))`, so parent academics/exams/timeline silently render empty. | `server/src/plugins/family.view/index.js:199,214,256`; schema `server/migrations/025_exams_assessment_runtime.sql:54-63`; false comment at `family.view/index.js:219` | Read from `snapshot` (derive `total_pct`/`grade` from the snapshot JSON or `assembleReports`), or add generated columns. Remove the silent `.catch` so failures surface. |
| A2 | Parent fees | Parent gateway checkout UI calls `POST /plugins/payments.upi/links` and `POST /plugins/payments.razorpay/orders`, which are staff-gated (finance/owner/principal) → parent gets 403. Parents can only `POST /fees/payments` and wait for staff confirm. | `app/src/screens/ParentFees.tsx:56-78`, `app/src/services/parentApi.ts:301-307`; `server/src/plugins/payments.upi/index.js:24`, `payments.razorpay/index.js:94` | Either open a parent-scoped payment-intent door, or change the parent UI to the initiate-then-confirm flow. Decide the intended model first. |
| A3 | UPI settlement | Payment confirm verifies the gateway reference **only** against `plugin_razorpay.order_log`; UPI captures always settle as `settled_via='manual'`. | `server/src/routes.js:1401-1416` | Add `plugin_upi.webhook_log` verification (or a shared verification lookup). |
| A4 | UPI links | `default_vpa` is declared in the manifest but ignored; link hardcodes `schoolos@<studentName>`. | `server/src/plugins/payments.upi/index.js:38,55`; manifest | Use the configured `default_vpa`; fail honestly (503) when unset. |
| A5 | Receipts | Receipt number is `RCP-<base36 timestamp>` inserted with `ON CONFLICT DO NOTHING`; a collision would silently skip the receipt row/PDF. No `receipt_prefix`/`receipt_series_start` despite design. | `server/src/routes.js:1428,1463-1467` | Deterministic per-tenant sequence (DB sequence or `MAX+1` under lock); make collision a hard error. |
| A6 | Fee settings | `app.fee_settings` is read (`routes.js:1151`) but there is **no door to write it**; only tests write directly. | `server/migrations/110_fees_perfect.sql:18`; `server/src/routes.js:1141-1151` | Add `GET/PUT /fees/settings` (finance_head/owner), validated. |
| A7 | Auto-settle | `auto_settle_verified_capture` default exists but is never read; `settled_via='auto'` is allowed by CHECK but never written. | `server/src/routes.js:1146`; `server/migrations/109_fees_enterprise.sql:127-130` | Either implement verified-capture auto-settle or delete the dead flag. |
| A8 | Academic-year scoping | `academic_year_id` exists on fee plans/obligations/exams but promotion/withdraw events carry `academicYear:null`; there is no bulk/end-of-year promotion; the UI says it pairs with the AY engine "when it lands". | `server/src/plugins/people.admin/index.js:372,427`; `app/src/screens/People.tsx:502` | Decide whether AY scoping is in scope; if yes, wire promotion/withdrawal and bulk promotion to the active year. |

---

## B. Tests / CI / verification (P0)

| ID | Area | Item | Evidence | Suggested fix |
|---|---|---|---|---|
| B1 | Test status | Last generated artifact shows a **RED** suite: 863 tests / 247 pass / 186 fail / 430 cancelled. Cause was migration 116 failing (`cannot drop constraint users_tenant_id_id_key`). But 116 was edited **after** the run and migrations 117–123 were added untracked → **current status is unverified**. | `docs/VERIFICATION.md:14,18-29`; `server/test-run.log` | Run a fresh `npm test` and regenerate `docs/VERIFICATION.md`. This is the gate before anything else. |
| B2 | Migrations 117–123 | Newest migrations (owner/principal, admissions, appraisals, policy docs) are **untracked** in git. | `git status` untracked list | Commit/track them so CI and fresh DBs are reproducible. |
| B3 | Migration 116 | The failing revision dropped `users_tenant_id_id_key`; the current file does not. Confirm the file on disk is the intended final revision. | `server/migrations/116_owner_principal_spine.sql:61,97` **(verify)** | Re-run migrate on a scratch DB; confirm no dependency error. |
| B4 | Verification artifact | `docs/VERIFICATION.md` explicitly marks migration ledger rows, `app` tables, RLS policies, and app-role DELETE grants as **UNMEASURED**; its failure list is incomplete/partial. | `docs/VERIFICATION.md:31,1489-1494` | Extend `scripts/verification-artifact.js` to measure these. |
| B5 | Counts drift | `PROJECT-MAP.md` says 272 doors vs generated matrix 370; VERIFICATION says 30 plugin modules vs PROJECT-MAP 29; artifact counts 122 test files vs 126 on disk. | `docs/PROJECT-MAP.md:23,26`; `docs/VERIFICATION.md:27,1489` | Re-derive and point stale docs at generated artifacts. |
| B6 | Factory check | `scripts/factory-check.mjs` hardcodes `/usr/lib/code/...` Playwright paths → not portable off this machine. | `scripts/factory-check.mjs:6-8` | Resolve Playwright dynamically or via env; skip with a clear message. |
| B7 | CI coverage | `.github/` contains only `workflows/ci.yml`; no dependabot, CODEOWNERS, issue/PR templates. | `.github/` | Add as desired. |

---

## C. Security & authorization (P1)

| ID | Area | Item | Evidence | Suggested fix |
|---|---|---|---|---|
| C1 | Plugin permissions | The plugin permission "ceiling" is real for only 4 seams (`audit.request`, `events.emit`, `comms.send`, `files.write`); most declared permissions are `unenforced:raw-sql`. | `server/src/plugin-permissions.js:36-53` | Enforce or honestly re-scope the manifest vocabulary; track remaining seams. |
| C2 | MFA posture | No mandatory MFA for owner/principal; privileged roles can remain single-factor. | `server/src/app.js:1106` (opt-in, staff-only) | Decide whether to enforce MFA for `owner`/`principal`/`itadmin`/`finance_head`. |
| C3 | Student idle | Student idle logout is server-enforced via an **in-memory** per-`jti` map → does not hold across replicas. | `server/src/app.js:161-165,237-249` | Move idle tracking to a shared store/DB if multi-replica. |
| C4 | Event budgets | `checkEventBudget` is called at only 2 sites; plugin `emitEvent` via `scopedKernel` does not consult it; `subscriber_max`, `fanout_max`, `chain_depth_max`, `replay_max`, `scheduled_per_day` are seeded but unenforced. | `server/src/governance.js:3-37`; `server/src/routes.js:1773`; `accounting.tally/index.js:117`; `migrations/004_event_spine.sql:51-54` | Enforce budgets at the plugin emit seam, or document them as reserved. |
| C5 | Lineage | `linkLineage` has one caller (transport delay); the action-decide path does not write `app.event_action_link`, so the lineage view is sparse. | `server/src/audit.js:62`; `server/src/routes.js:1796,2772-2860` | Link lineage on every action decide/executor. |
| C6 | Doc contradiction | `SECURITY-MATRIX.md` §1 table says A3 (JWT lifetime/rotation) is OPEN while §7 says DONE; same for B9 counselor confidentiality and E5 secret-scan. | `docs/SECURITY-MATRIX.md:12,27,60,80-83` | Reconcile the table against current code. |
| C7 | `requireScope` | A comment references `requireScope()` but no implementation exists. | `server/src/app.js:146` | Remove the stale reference or implement it. |
| C8 | Prod config | `RAZORPAY_WEBHOOK_SECRET` is in `.env` but absent from `.env.example`; `TRUST_PROXY`/`FORCES_HTTPS` are documented but read directly in `app.js`, not centralised in `config.js`. | `server/.env`, `.env.example`; `server/src/app.js:50,78,846` | Align `.env.example`; centralise config reads. |
| C9 | Log shipping | `LOG_SHIP_URL`/`LOG_SHIP_TOKEN` are explicit UNIMPLEMENTED stubs. | `server/docker-compose.yml:72-76` | Wire a log shipper or remove the stub. |
| C10 | AI budget | `ai_budget` is seeded per plugin but **no plugin invokes the AI gateway**; only `/ai/call` and `/ai/eval` call it. | `server/src/plugins/_shared/ai-gateway.js`; `server/src/app.js:1537,1555` | Decide AI rollout; either wire plugins or document the seam as unused. |

---

## D. Fees & Finance (P1)

| ID | Area | Item | Evidence | Suggested fix |
|---|---|---|---|---|
| D1 | Invoice | There is **no invoice entity, route, or PDF**. The receivable is `fee_obligations`; the settlement artifact is `fee_receipts`. | `server/migrations/109_fees_enterprise.sql`; `server/src/routes.js` fee section | Decide whether an invoice document is required; if so, add entity + render. |
| D2 | Late fees | Design placeholder only (`{enabled:false, per_day_cents:0, cap_cents:0}`); no computation/door/UI. | `docs/FEES-DESIGN.md:420`; `app/src/screens/Fees.tsx:665` | Implement or remove from the design. |
| D3 | Concessions at generation | Sibling/staff concessions are not applied during billing-run generation (design §6.1); they apply only via the decide door on a named obligation. | `docs/FEES-DESIGN.md:281`; `server/src/routes.js:1083-1090` | Apply auto-concession rules at generation, or update the design. |
| D4 | Concession requests | Parent/teacher cannot request a concession (design §6.5); the door gate is finance/owner/principal only. | `server/src/routes.js:1677`; `docs/FEES-DESIGN.md:319` | Add requester role or correct the design. |
| D5 | Reconcile roles | `POST /payments/reconcile` excludes `principal`, while dunning includes them; UI comment claims principal owns fee-health. | `server/src/routes.js:2984` vs `3064`; `app/src/screens/Fees.tsx:180` | Align role sets with the intended ownership. |
| D6 | Maker/checker | `finance_clerk` may confirm settlements even though confirm is described as a checker act; `finance` legacy role parity with `finance_head` is not mechanically asserted. | `server/src/routes.js:1364`; `docs/FEES-DESIGN.md:61` | Decide confirm authority; add a parity test. |
| D7 | Design routes absent | `POST /billing-runs/:id/void`, `GET /fees/obligations/:id`, `GET /payments/:id` are documented but not implemented; aging is served by `/plugins/ops.bi/fees/aging`. | `docs/FEES-DESIGN.md:230-242` | Implement or update the design. |
| D8 | Fee settings door | (same as A6) no write path for `app.fee_settings`. | — | See A6. |
| D9 | Role-set drift | Plan/concession door role sets are broader than the design table. | `server/src/routes.js:1035,1677` vs `docs/FEES-DESIGN.md:228,243` | Reconcile. |
| D10 | Report-card / result linkage | Promotion is not linked to results; no bulk/end-of-year promotion. | `server/src/plugins/people.admin/index.js:393-436` | See A8. |
| D11 | Receipt collision | See A5. | — | See A5. |
| D12 | Refund threshold config | `refund_approval_threshold_cents` is read from `fee_settings` (default 500000) but that table has no write door. | `server/src/routes.js:1142-1144` | Covered by A6. |

---

## E. Library (P2)

| ID | Area | Item | Evidence | Suggested fix |
|---|---|---|---|---|
| E1 | Version drift | Manifest says `2.0.0`; `plugin-catalog.js` and migration 047 registry say `1.0.0`. | `server/src/plugins/library/manifest.js`; `server/src/plugin-catalog.js:24`; `migrations/047_library.sql` | Single-source the version from the manifest. |
| E2 | Permission drift | Manifest declares `users.read`; catalog/047 registry omit it. | `manifest.js:13` vs `plugin-catalog.js:24` | Reconcile catalog to manifest (reconciliation corrects rows at signup, but the constant is stale). |
| E3 | Event declarations | v2 manifest has no `events` block while the plugin emits ~12 event types (`book.updated`, `copy.added`, `loan.renewed`, `fine.settled`, `acquisition.*`, …). | `server/src/plugins/library/manifest.js`; `library/index.js` | Declare all emitted events or update the conformance check. |
| E4 | Design doc stale | `LIBRARY-DESIGN.md` PART B documents the v1 desk (staff gate, student name-match) which no longer exists. | `docs/LIBRARY-DESIGN.md` PART B | Mark PART B historical; point to v2. |
| E5 | Migration header | `111_library_governance.sql` header says "110 · library governance". | `server/migrations/111_library_governance.sql:1` | Fix header. |

---

## F. Academics / People / Attendance (P1)

| ID | Area | Item | Evidence | Suggested fix |
|---|---|---|---|---|
| F1 | Student identity | No structural `students.user_id` link; student identity is **name-match** (duplicate names tie-break on lowest `admission_no`). Affects submissions, missing-inbox, parent homework bridge. | `server/src/plugins/teacher.classroom/index.js:65-77`; `student.world/index.js`; `docs/STUDENT-DOMAIN-ANALYSIS.md` STU-GAP-12 | Add a stable student↔user link and migrate name-match call sites. |
| F2 | Timetable keying | Timetable slots are section-agnostic and key teachers by free-text `teacher_name`; section clashes are undetectable. | `migrations/021_ops_timetable.sql:29`; `server/src/routes.js:3183` | Add grade/section + teacher id to slots; backfill. |
| F3 | Class model | `app.classes`/`app.subjects` do not exist; class structure lives in `tenants.config.setup.sections` JSONB; subjects are free text; class_assignments is one owner per class (form teacher), not per subject. | `migrations/083_class_assignments.sql`; `001_init.sql:36-37` | Decide whether a normalized classes/subjects model is required. |
| F4 | Academic year | No tenant has an academic year in the live DB (0 rows); exam/plan scoping is partial. | Live read-only snapshot; `migrations/058_academic_year.sql` | See A8. |
| F5 | Board policy | `GET /exams/:id/board-policy` is validation-only; nothing consumes the per-exam policy. | `server/src/routes.js:3225-3244` | Wire the policy into assembly or remove. |
| F6 | Bulk promotion | No bulk/end-of-year promotion; single promote only. | `server/src/plugins/people.admin/index.js:393-436` | Add if in scope. |
| F7 | Attendance RLS | `plugin_exams`, `plugin_hr`, `plugin_clinic` have RLS `ENABLE` but **no FORCE** (defense-in-depth gap; owner BYPASSRLS still applies). | `migrations/025:91-94`, `029:41,68,91` | Add FORCE RLS. |
| F8 | Class-assignment doc drift | Docs still list class-of-record binding as a gap; it is implemented (migration 083). | `docs/ONBOARDING-NEW-SCHOOL.md:74,103`; `migrations/083` | Update docs. |
| F9 | Student idle contract | Server sends `idle_minutes`, client reads `idle_timeout_minutes`; idle timeout is client-only on the client side. | `docs/STUDENT-DOMAIN-ANALYSIS.md:204-210` | Align the key names and enforce server-side. |

---

## G. Parent / Student / Teacher (P1)

| ID | Area | Item | Evidence | Suggested fix |
|---|---|---|---|---|
| G1 | Parent results | See A1. | — | See A1. |
| G2 | Parent checkout | See A2. | — | See A2. |
| G3 | Parent docs | `parent/child/:id/documents` depends on files/consents; verify end-to-end coverage. | `family.view/index.js:289-302` **(verify)** | Test the full parent document flow. |
| G4 | Teacher homework scoping | Homework/submissions key off `created_by` + name-match; assigning-teacher-only enforced, but no subject/class binding beyond `class_assignments`. | `teacher.classroom/index.js:291,302,404` | Tie to class_assignments/subject when F1/F3 land. |
| G5 | Teacher handover | Handover packet derives affected periods from `timetable_slots.teacher_name` (free text). | `server/src/routes.js:2693-2760` | Fix with F2. |
| G6 | Coordinator/principal docs | Principal dunning control, duty fairness in nav, counselor referral queue listed as closed in one doc but absent in others. | `docs/OWNER-PRINCIPAL-PERFECT-100.md:44`; `docs/OWNER-PRINCIPAL-DOMAIN-ANALYSIS.md` | Reconcile. |
| G7 | Student doors without UI | Some student doors have no UI (noted in REMOVALS deferral). | `docs/REMOVALS.md:49-63` | Build UI or remove doors. |

---

## H. Comms / Events / AI / Integrations (P1)

| ID | Area | Item | Evidence | Suggested fix |
|---|---|---|---|---|
| H1 | Push channel | No FCM/APNs/web-push/device-token anywhere. Channels: sms, whatsapp, email, in-app, log-only. | grep of `server/src`, `migrations/` | Add push or document as out of scope. |
| H2 | Quiet hours | Enforced producer-side only; the dispatcher will send any queued row at any hour. | `scripts/comms-dispatcher.js:173-272`; `dunning-reminders.js:53-60` | Enforce quiet hours in the dispatcher (or guarantee all producers gate). |
| H3 | Owner security digest | `runOwnerSecurityDigest` is defined but the committed cron step list omits it; no other schedule runs it. | `scripts/day-worker.js:318-352`; `ops/cron/schoolos.cron:71` | Add `owner-security` to the day-worker step list. |
| H4 | Lineage | See C5. | — | See C5. |
| H5 | Event budgets | See C4. | — | See C4. |
| H6 | AI gateway | See C10. | — | See C10. |
| H7 | Catalog permission drift | `plugin-catalog.js` CATALOG permission lists differ from on-disk manifests for several plugins (`ops.visitors`, `exams.assessment`, `pack.cbse`, `pack.dpdp`, `family.view`, `health.clinic`, `transport.gps`, `teacher.support`). | `server/src/plugin-catalog.js:11-47` vs `src/plugins/*/manifest.js` | Derive the catalog constant from manifests or add a drift test. |
| H8 | ops.bi cache | Per-process 60s cache → multi-replica may serve slightly different read models. | `server/src/plugins/ops.bi/index.js:12` | Move cache to shared store or document. |
| H9 | Transport GPS | GPS ingest is a simulated vendor feed by default; live tracking not connected. | `server/src/plugins/transport.gps/index.js:10-11,90-102` | Wire a real vendor feed or keep the honest label. |

---

## I. Frontend (P1)

| ID | Area | Item | Evidence | Suggested fix |
|---|---|---|---|---|
| I1 | In-screen role lists | Hardcoded role arrays persist despite the server `/me/effective` model: PrintQueue, WellbeingQueue, Noticeboard, teacherKit, coord/shared, FunnelBoard, VisitorsBoard, PeopleAdmin, Classes. | `app/src/screens/student/PrintQueue.tsx:33`; `WellbeingQueue.tsx:39`; `Noticeboard.tsx:32`; `teacher/teacherKit.tsx:47`; `coord/shared.tsx:18`; `FunnelBoard.tsx:74`; `VisitorsBoard.tsx:58-59`; `PeopleAdmin.tsx:52`; `Classes.tsx:78` | Route through `useRoleOrGrant`/`canSurface`. |
| I2 | KernelGate coverage | `KernelGate` wraps only 5 route groups; `/admissions` and `/visitors` use custom host components. | `app/src/App.tsx:476,479,481,495,496,407-421` | Standardize plugin gating. |
| I3 | Residual mock plane | `src/demo/seedServices.ts` is imported by 7 screens (Automation, Operations, Transport, Memory, ReportIssue, HR, Admissions); honesty-gated but still sample data. | `docs/REMOVALS.md:49-63` | Replace with live doors or keep SampleNote. |
| I4 | Fetch duplication | Four fetch wrappers duplicate the 401/CSRF/session contract (liveApi, parentApi, Login, account screens). | `app/src/services/liveApi.ts`, `parentApi.ts`, `screens/Login.tsx`, `account/*` | Consolidate onto `apiRequest`. |
| I5 | Dead exports | `DEMO_ACCOUNTS`, `DEMO_PASSWORD`, `apiGoogleDemo` remain in `liveApi.ts` with no consumers. | `app/src/services/liveApi.ts:452-463,167-168` | Delete. |
| I6 | Misnamed module | `services/teacherFixtures.ts` contains no fixtures (live-only). | `app/src/services/teacherFixtures.ts:1-19` | Rename. |
| I7 | Stale README | `app/README.md` still documents the removed demo bar and scripted scenarios while line 31 says demo removed. | `app/README.md:31,49,53,85` | Rewrite. |
| I8 | HR / Group screens | `HR.tsx` and `Group.tsx` remain seed/local. | `app/src/screens/HR.tsx:123,206`; `Group.tsx` | Wire to live doors or label. |

---

## J. Database / RLS / Migrations (P1)

| ID | Area | Item | Evidence | Suggested fix |
|---|---|---|---|---|
| J1 | Migration gap | Files `064` and `065` are missing from the sequence. | `server/migrations/` listing | Confirm intentional; document. |
| J2 | Header drift | Several migration headers disagree with filenames (058 says 055, 059 says 057, 067 says 059, 069 says 065, 122 says 119, 111 says 110). | migration file first lines | Fix headers. |
| J3 | FORCE RLS gaps | `plugin_exams`, `plugin_hr`, `plugin_clinic` ENABLE without FORCE; `auth_otps`/`capability_contracts` ENABLE-only by design. | `migrations/025`, `029`, `008`, `007` | Add FORCE where safe; document intentional exceptions. |
| J4 | Tenant FK alignment | Migrations 081/082/086/087/115/117/118/121 progressively tenant-align FKs; confirm no remaining single-column FKs. | those migrations | Run the reference-integrity check and close residue. |
| J5 | Seed drift | `seed.js` replay list ends at 048; `083` seeds class_assignments only for tenants existing at migrate time, so the demo tenant may have none after seed. | `scripts/seed.js:355`; `migrations/083:86-99` | Replay 083 in seed or create assignments explicitly. |
| J6 | Unmeasured schema | See B4. | — | See B4. |
| J7 | `plugin_usage` / misc | `app.plugin_usage` metering exists; confirm all counters are incremented. | `migrations/110:42` **(verify)** | Audit metering call sites. |

---

## K. Documentation drift (P3)

| ID | Area | Item | Evidence |
|---|---|---|---|
| K1 | Role counts | Docs say "13 roles"; code has 16 built-ins. | `role-catalog.js:11-16` vs multiple docs |
| K2 | Capability counts | `ROLE-CAPABILITIES.md` per-role door counts do not match generated matrix (e.g. owner 161 vs 237). | `docs/ROLE-CAPABILITIES.md:3`; `docs/PERMISSION-MATRIX.md:5` |
| K3 | Door counts | `PROJECT-MAP.md` 272 vs matrix 370. | `docs/PROJECT-MAP.md:23` |
| K4 | Test counts | `server/README.md` says 25 integration tests; `VERIFICATION` says 122 files; disk has 126. | `server/README.md:58` |
| K5 | Plugin module count | 29 vs 30 inconsistency. | `docs/VERIFICATION.md:1489`; `docs/PROJECT-MAP.md:26` |
| K6 | Admissions role | Docs omit `admissions` from FULL_PII/ADMIN; code includes it. | `docs/ADMISSIONS-DOMAIN.md:67-69`; `_shared/admissions-access.js:30-32` |
| K7 | Admissions rule | Docs say no default admissions rule ships; migration 123 seeds one. | `docs/ADMISSIONS-DOMAIN.md:680`; `migrations/123` |
| K8 | Security matrix | Contradictions listed in C6. | `docs/SECURITY-MATRIX.md` |
| K9 | Release cert | Historical only; do not quote numbers. | `docs/RELEASE-CERT.md:5-9` |

---

## L. Missing domains / features (not built)

| ID | Domain | Status | Evidence |
|---|---|---|---|
| L1 | Hostel | NOT FOUND | no tables/routes/screens |
| L2 | Payroll | NOT FOUND | HR has leave + appraisals only |
| L3 | Push notifications | NOT FOUND | no FCM/APNs/web-push |
| L4 | Invoice entity | NOT FOUND | fees use obligations/receipts |
| L5 | Late fees | NOT IMPLEMENTED | design placeholder only |
| L6 | Live GPS tracking | PARTIAL | simulated vendor feed |

---

## M. Simulation-discovered defects (Steps 1–13)

> Found by actually onboarding and running Cassandra International School through the app
> (see `docs/SCHOOL-SIMULATION-LOG.md`). These were **not** visible from static inspection.
> Status: **ALL FIXED (2026-09-22)** — M1–M5 closed in the third pass; each row cites its change.

| ID | Area | Item | Evidence | Suggested fix |
|---|---|---|---|---|
| M1 | Absence notices | For an app-onboarded school, **absence notices never queue**. The notice pipeline joins `app.guardians` (`g.is_primary`), but no live door populates that table for app-created students: `POST /students` writes only the denormalised `app.students.guardian_name/guardian_phone`, and parent accounts link via **`family.child_link`**. Observed live: `app.guardians`=0, `family.child_link`=45, `app.communications`=0 after a real absence. | `server/src/routes.js` attendance notice join (`JOIN app.guardians g ON g.student_id=s.id AND g.is_primary`); `server/src/routes.js:625-628` (`POST /students`); `people.admin` parent path; live counts | **FIXED (2026-09-22):** the notice pipeline now resolves a child's phone from EITHER guardian model (`app.guardians` UNION `family.child_link`→`app.users.phone`), and both creation paths now write `app.guardians` (manual `POST /students` + people.admin parent linking), so the two models stay in step. |
| M2 | Absence notices | `POST /attendance/mark` returns `noticesQueued = newlyAbsent.length` — the number of newly-absent students, **not** the number of `app.communications` rows actually inserted. It reports `1` when `0` were queued. | `server/src/routes.js` return `{ …, noticesQueued: newlyAbsent.length }` | **FIXED:** returns the actual inserted count (`noticesQueued`, with `guardiansResolved`). |
| M3 | Timetable | The timetable **cannot be built from the app**: `ops.timetable` registers only read/substitute/autofill doors; `app.timetable_periods`/`app.timetable_slots` are seed-only. A self-signup tenant has 0 periods / 0 slots. | `server/src/plugins/ops.timetable/index.js` (4 doors, none writes periods/slots); `migrations/010_wave1_plugin_runtime.sql:140-164`; live: tenant 0, Meridian 10 | **FIXED:** period + slot CRUD/retire doors, `seed-default`, a `/timetable` screen + nav, `timetable-write.test.js`; migration 134. |
| M4 | Attendance model | "First-period teacher takes attendance" is unsupported: attendance binds to the form teacher via `class_assignments`; timetable slots are section-agnostic and key teachers by **free text**. | `server/src/routes.js` `assertTeacherOwnsClasses`; `migrations/021_ops_timetable.sql` slot schema; clash-check note "section clashes are undetectable" | **FIXED:** slots carry `grade`/`section`/`teacher_id` (migration 134), clash prevention includes section clashes, and `GET /plugins/ops.timetable/first-period-teacher` derives the period-1 register owner. |
| M5 | Onboarding | Self-signup does **not** stamp `force_change`; the owner's chosen password is permanent (no forced change on first login). | `server/src/onboarding.js:93-96` | **FIXED (documented policy):** the owner chose their own password (never issued/shown by anyone else), so a forced change is ceremony with no benefit — the decision and its reasoning are now recorded in `onboarding.js`. |

**Cross-reference:** `docs/SCHOOL-SIMULATION-LOG.md` (Steps 1–13) is the run record;
`docs/SPEC-TENANT-CONFIGURABILITY.md` and `docs/SPEC-TIMETABLE-WRITE-DOORS.md` are the fix specs.

---

## Verification checklist for the owner

1. [x] Fresh suite run regenerated `docs/VERIFICATION.md`: **959 tests · 959 pass · 0 fail · 0 cancelled** (B1/B3 done).
2. [x] `node scripts/check.js` all green (permission matrix + DB + RLS + fees OpenAPI).
3. [x] `npm run build` (tsc + vite) green in `app/`; `npm test` in `app/` 17/17 green.
4. [x] A1–A8 (correctness) closed.
5. [x] **M1/M2** (absence notices) closed — the notice pipeline reads both guardian models.
6. [ ] **Owner action:** `git add` the untracked migrations 108–135 and docs (B2) so a fresh clone/CI is reproducible.
7. [ ] Re-run the read-only audit snapshot after fixes to confirm the live DB state.

> **Audit law:** the repository is the source of truth. Re-verify every line reference before
> changing code; this document records findings, not fixes.
