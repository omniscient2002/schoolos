# SchoolOS Full-System Audit

**Audit date:** 2026-09-23
**Tree audited:** `/home/cassandra/schoolOS` @ `d0f492c` (main) **plus a dirty working tree** (23 modified files + 5 untracked — transport write model, exam-report shared module, simulation fixes in flight)
**Auditor stance:** senior principal architect · security engineer · QA lead · UX auditor · product engineer · DevOps · DBA · real school administrator
**Method:** repository mapping → parallel deep-dives (auth/tenancy, DB/business logic, frontend/API/UX, tests/ops/code quality) → independent source verification of every high-severity claim → runtime test execution
**Rule followed:** evidence over assumption. Anything not verified is marked `Not verified`.

---

## 1. Executive Summary

### Product

SchoolOS is an **India-first, multi-tenant school operating system**: one operating loop (Today → Attention → Ask → Action → Memory) over a compact school record, with a constitution-gated AI layer, a plugin registry, and India-specific integration surfaces (WhatsApp, UPI, Razorpay, GPS, Tally, CBSE, DPDP).

It is **not** a thin CRUD school SIS. It is a platform kernel (tenancy, RBAC, audit ledger, plugin registry, outbox spine) with ~26 plugin domains layered on top covering people, academics, money, library, transport, HR/leave, admissions, compliance, and AI assistants.

### Architecture

| Layer | Technology |
|---|---|
| Backend | Node 26, Fastify 5, plain ESM JavaScript, zod in deps (largely unused at boundary) |
| Database | PostgreSQL 18, 136 migrations, Postgres RLS (ENABLE + FORCE), two pools (owner `sysq` / constrained `schoolos_app` `q`/`withUser`) |
| Frontend | React 19, Vite 8, TypeScript, React Router 7, custom CSS design tokens (no Tailwind) |
| Auth | scrypt passwords, HS256 JWT (`@fastify/jwt`), HttpOnly cookie + CSRF double-submit, TOTP MFA, Google SSO, phone OTP |
| Async | Outbox pattern + 8 workers (outbox, comms, webhook, workflow, day, dunning, retention, reconcile) |
| Deploy | Dockerfile (digest-pinned `node:26-alpine`, non-root, healthcheck), docker-compose (8 services), GitHub Actions CI (4 jobs) |
| Scale of tree | ~33.7k LOC backend JS · ~44.5k LOC frontend TS · 136 migrations · 133 server test files · ~80 screens · 402 catalogued routes |

### Overall Score

**6.0 / 10**

### Production Readiness

**PRODUCTION WITH MAJOR RISKS**

The kernel (auth, RLS, audit, plugin isolation, CI gates) is genuinely production-grade in design. The **product riding on it** still has confirmed money-path race conditions, an attendance register that can be silently rewritten, a full test suite that currently does not complete, and several security edges that a real school's insurer would care about. Deploy for a real fee-paying school only after P0.

### Top Strengths

1. **scrypt N=2^17 password hashing** with legacy rehash-on-login and `timingSafeEqual` (`server/src/auth.js:15-52`).
2. **Postgres RLS ENABLE+FORCE** across `app.*` and `plugin_*`, fail-closed GUC handling (`server/src/db.js:22-27`, `migrations/001`, `124`).
3. **Custom-role deny-wins masks** shared by kernel `require()` and plugin `requireRole()`, with an anti-amplification ceiling (`server/src/custom-roles.js:73-78`, `routes.js:422-434`).
4. **Permission-matrix + UI↔door parity gates in CI** — 402 routes, 0 unguarded (`docs/PERMISSION-MATRIX.md`, `server/scripts/permission-matrix.js`, `parity-gate.js --enforce`).
5. **Append-only hash-chained audit ledger** via `SECURITY DEFINER audit_append` (`migrations/006`, `server/src/audit.js`).
6. **Money is integer `bigint` cents + JS `BigInt`** — no float ledger (`001_init.sql`, `src/fees/installments.js`).
7. **Library double-issue is structurally impossible** — `loan_one_open_per_copy` partial unique index (`migrations/108_library_v2.sql:197-198`).
8. **Backup/restore with a real drill** including DPDP erasure replay (`ops/backup/`, `tests/backup-restore-drill.test.js`).
9. **Honest demo labeling** — `SampleNote` component, parity gate bans mock-plane imports on live screens (`app/src/components/ui.tsx:97-104`).
10. **Self-documented debt** — `SIMULATION-FIXES.md`, `STILL NOT GOOD_*.md`, `PERFECT-100.md` grade the project *lower* after deeper audit. Rare honesty.

### Top Problems

1. Full serial test suite does not complete — mass `'Promise resolution is still pending'` failures (contradicts `docs/VERIFICATION.md` "959/959 green").
2. Multi-obligation ("pay-many") payments store `obligation_id=NULL`, bypassing `payments_one_open_per_obligation` and the in-app open-payment check → concurrent double-settlement of the same dues.
3. Default string `'dev-only-secret-change-me'` is both the JWT signing fallback **and** the plugin-settings AES master-key fallback.
4. Step-up re-auth accepts the account password in an `x-step-up-password` request header (credential-in-logs).
5. School `owner`/`itadmin` can read platform-wide `fleet_*` metrics (cross-tenant operational intelligence).
6. Attendance is an unlimited overwrite upsert — no date lock, no close-of-day, any historical register rewritable.
7. Parent leave approval silently clobbers a teacher's register with `'leave'` and writes no audit row for the attendance mutation.
8. No Content-Security-Policy anywhere.
9. Two user-enumeration oracles on auth edges (Google callback 403 + password-reset 503).
10. `adminOnly()` gate used by `/api-keys` and `/webhooks` bypasses the custom-role mask system entirely.
11. `fee_obligations.amount_cents` has no `CHECK (>= 0)`; `plugin_exams.mark` has no `CHECK (marks <= max_marks)`.
12. 15+ money/lifecycle queries key only on `WHERE id=$1` with no `tenant_id` predicate (RLS is the sole barrier).
13. No payroll/salary module at all.
14. `students.bus_route` is free text — no FK to routes, no capacity/permit enforcement.
15. `initiated` payments never expire; the `created` status is dead code.
16. Academic-year "rollover" is only an `is_current` flag — no archival, no year-scoped data move; `academic_year_id` is nullable and not defaulted.
17. `students.grade`/`section` are free text while `app.classes`/`app.sections` tables exist (migration 135) — rename does not update rosters.
18. Frontend has 17 tests for ~44.5k LOC; no E2E browser suite in CI.
19. `server/src/routes.js` is a 4,380-line god file spanning 10+ domains.
20. Working tree is dirty with in-flight transport/exam/timetable changes not yet committed — the audited tree is not a clean release.

### Critical Risks

| Risk | Why it is critical |
|---|---|
| Pay-many payment race → double collection of the same dues | Real money can be booked twice against one obligation set |
| Default secret fallback for JWT **and** settings crypto | One unset env var = total auth forgery + offline decryption of every tenant's SMTP/gateway secrets |
| Test suite cannot be trusted as a gate | Any of the above can regress silently; `VERIFICATION.md` currently overclaims |
| Unlimited attendance rewrite + silent family-leave clobber | Exam eligibility (75% floor) and statutory attendance can be falsified after the fact |
| Password-in-header step-up path | Reverse proxies/APM commonly log headers → credential leak |
| Cross-tenant `fleet_*` metrics to school IT admins | Platform-scope intelligence behind a tenant-scope door |

---

## 2. Overall Rating

**Overall Score: 6.0 / 10**

**Scoring method (not a blind average):**

Categories are weighted by how much a real school would be harmed if that category fails:

| Weight class | Categories | Weight |
|---|---|---|
| **Critical** (×1.5) | Security, Authorization, Multi-tenancy, Data integrity, Authentication, Business logic correctness | 6 categories |
| **Core** (×1.2) | Backend quality, API quality, Validation, Error handling, Reliability, School workflow completeness, Testing | 7 |
| **Standard** (×1.0) | Architecture, Code quality, Frontend quality, Database design, Performance, Scalability, UX, Product completeness, Maintainability | 9 |
| **Secondary** (×0.8) | Accessibility, Mobile responsiveness, Documentation, Deployment readiness, Observability | 5 |

Raw mean of the 27 category scores (§33) is **6.07**. Weighted mean (critical categories carry 1.5×, secondary 0.8×) lands at **6.0**.

Why not higher: money-path races, a non-completing test suite, and auth-edge oracles are exactly the failures that destroy trust in a school finance/child-data system. Why not lower: the security engineering depth (RLS+FORCE, deny-wins RBAC, hash-chained audit, jti+session_epoch revocation, MFA with replay guards) is well above average for this class of product, and the majority of domain surfaces are wired to real APIs with real DB constraints.

---

## 3. Production Readiness

**PRODUCTION WITH MAJOR RISKS**

Justification, strictly from evidence:

| Gate | Status | Evidence |
|---|---|---|
| Boots and serves | PASS | `node src/index.js` reaches listen (EADDRINUSE only because another instance holds :8080) |
| Auth works | PASS | Login/MFA/OTP/SSO/reset all implemented + unit-tested |
| Tenant isolation | PASS (with gaps) | RLS+FORCE; residual id-only SQL is defense-in-depth, not a proven bypass |
| Money correctness | **FAIL** | Pay-many open-payment race confirmed at `routes.js:1571-1647` |
| Audit integrity | PASS | Hash-chained append-only ledger with tamper tests |
| Test gate trustworthy | **FAIL** | Full `npm test` floods with `'Promise resolution is still pending'`; per-file runs pass |
| Secret hygiene | **PARTIAL** | No live keys committed; default fallbacks exist; `server/.env` holds real 64-hex secrets on disk |
| Operational readiness | **PARTIAL** | Backups+drill excellent; no APM/error tracking; no migration rollback |
| School-day workflow completeness | **PARTIAL** | Most planes GA; payroll absent; attendance unlocked; AY rollover shallow |
| Accessibility / mobile | **PARTIAL** | Good ARIA infrastructure; `window.confirm/prompt/alert` remain on high-traffic paths |

**Not NOT READY** — the system does real work correctly in most domains.
**Not EARLY PRODUCTION** — it is past a pilot toy; CI, RLS, audit, and money constraints are real.
**Not PRODUCTION READY WITH MINOR GAPS** — payment races and an unlocked attendance register are not minor.

**Rule for a real school:** do not collect real fees through this until P0-1 and P0-2 are fixed and the suite is green.

---

## 4. Technology & Architecture Overview

### 4.1 Composition

```
app/          React 19 + Vite SPA (80 screens, role-guarded shells)
server/
  src/index.js          boot
  src/app.js            2,024 lines — identity, session, MFA, SSO, API keys, webhooks, AI, metrics, workflow
  src/routes.js         4,380 lines — domain core (people, attendance, fees, actions, cases, migration, BI…)
  src/db.js             dual pool: q() = schoolos_app (RLS) · sysq() = owner (bypass)
  src/auth.js           scrypt + role catalog re-export
  src/custom-roles.js   deny-wins mask resolution
  src/effective-access.js  door/surface map for UI gating
  src/onboarding.js     public self-signup → tenant + owner + 23-plugin catalog
  src/plugins/          26 isolated plugin services, each with own schema plugin_*
  migrations/001–136    forward-only SQL
  scripts/              migrate, bootstrap, seed, check, parity-gate, permission-matrix, backup, workers
```

### 4.2 Authentication flow (verified)

1. `POST /auth/login` (20/min/IP + DB-backed per-user and per-identifier lockouts, 5 fails → 15 min).
2. Optional MFA challenge (5-min `mfaPending` JWT) → `POST /me/mfa/verify` (TOTP with step-replay guard, or one-time HMAC recovery code).
3. Issue JWT: `jti` mandatory (`app.js:207-209`), TTL 12h (students 30m), plus `session_epoch` stamp.
4. Set `schoolos_session` cookie `HttpOnly; SameSite=Strict; Secure(prod)` + JS-readable `schoolos_csrf` cookie.
5. Also return `token` in the JSON body (leak surface — see §12).
6. Every request: `authenticate` → jti denylist check → `session_epoch` compare → custom-role mask.
7. Logout writes jti to `auth.revoked_token`; password change bumps `session_epoch` (kills all sessions).

### 4.3 Authorization model

- 16 builtin roles frozen in `role-catalog.js` (owner, principal, coordinator, teacher, counselor, finance, finance_head, finance_clerk, admissions, transport, facilities, technician, itadmin, librarian, parent, student).
- Custom roles: `base_role` + DENY/ALLOW door masks. Resolution order: **DENY wins → ALLOW → base**.
- Anti-amplification: an `itadmin` cannot grant a door their own role cannot reach (`routes.js:422-434`); wildcard methods banned; `/*` root grants banned.
- Role assignment requires step-up (password or 5-min token) and refuses self-assignment (`routes.js:541-552`).
- Owner accounts cannot be re-roled; `people.admin` structurally refuses creating/suspending/resetting `owner`.

### 4.4 Multi-tenancy

- Every tenant table carries `tenant_id`; composite tenant-aligned FKs backfilled in `081`/`082`.
- `withUser(tenant, role)` sets `schoolos.tenant_id` / `schoolos.role` as `SET LOCAL`; missing GUC fails **closed**.
- RLS policies normalize NULL/'' GUC to deny (`074`).
- Kernel vaults (`auth.otps`, `auth.mfa_secrets`, reset tokens) are `USING (false)` for `schoolos_app`.
- File bytes live under `server/storage/<tenantId>/<uuid>.<ext>`, never web-served directly, path-traversal guarded.

### 4.5 Data flow

Write path: HTTP door → `authenticate` → role gate → `withUser` (RLS) → handler → `auditLog` (+ optional outbox event) → worker drain (comms/webhooks/workflow).

### 4.6 Deployment model

Single compose stack: `db` (PG18 digest-pinned) → `db-init` (migrate + bootstrap) → `api` + 5 workers + optional `demo-init` / `files-backup`. Secrets fail-closed via `${JWT_SECRET:?}` interpolation. CI runs server suite + web build + compose smoke + secret scan + `npm audit`.

---

## 5. Complete Feature Inventory

Status key: **WORKING** (evidence of correct end-to-end behavior) · **MOSTLY WORKING** (works, minor defects) · **PARTIAL** (significant gaps) · **BROKEN** (confirmed incorrect) · **MISSING** · **UNVERIFIED**.

| Feature | Domain | Roles | Frontend | Backend | DB | APIs | Status | Tested? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| School self-signup / tenant creation | Onboarding | public → owner | `Onboard.tsx` | `onboarding.js` | `tenants`, `users` | `POST /onboard/signup` | **WORKING** | Yes | 3-step wizard, one tx, rate 3/min, kill-switch |
| Post-signup checklist | Onboarding | owner | `onboardingApi` | `onboarding.js` | — | `GET /onboard/status` | **WORKING** | Yes | |
| Owner onboarding walkthrough doc | Onboarding | owner | — | — | — | — | **WORKING** | — | `docs/ONBOARDING-NEW-SCHOOL.md` code-verified |
| Login (email+password) | Auth | all | `Login.tsx` | `app.js:321+` | `users`, `login_throttles` | `POST /auth/login` | **WORKING** | Yes | lockouts + dummyVerify |
| Login (phone OTP) | Auth | all | `Login.tsx` | `app.js:492+` | `auth_otps`, `request_throttles` | `/auth/otp/*` | **MOSTLY WORKING** | Yes | multi-tenant picker leaks school names (§14) |
| Google SSO | Auth | all | disabled button | `app.js:769-835` | `oauth_states` | `/auth/google/*` | **MOSTLY WORKING** | Yes | enumeration oracle on callback |
| MFA / TOTP + recovery codes | Auth | all | account screens | `totp.js`, `app.js:1122+` | `auth.mfa_secrets` | `/me/mfa/*` | **WORKING** | Yes | secrets plaintext at rest |
| Password reset | Auth | all | login card | `app.js:994-1119` | `auth.reset_tokens` | `/me/reset-*` | **MOSTLY WORKING** | Yes | 503 enumeration oracle |
| Session renew / logout / revoke | Auth | all | `liveApi` | `app.js:427,891` | `revoked_token` | `/auth/renew`, `/auth/logout` | **WORKING** | Yes | no absolute session ceiling |
| Multi-school account switch | Auth | multi-enrolled | switcher | `app.js:906-942` | `users` | `/me/tenants`, `/me/switch` | **WORKING** | Yes | target-password step-up (good) |
| Step-up re-auth | Auth | all | `window.prompt` path | `app.js:1368+` | — | `/me/step-up` | **WORKING** | Yes | header password path is a leak (§12) |
| Roles & custom roles | AuthZ | owner, itadmin | `RolesAdmin.tsx` | `custom-roles.js`, `routes.js:390+` | `roles` | `/roles/*` | **WORKING** | Yes | deny-wins + amplification ceiling |
| Role assignment (step-up) | AuthZ | owner, itadmin | `RolesAdmin` | `routes.js:541` | — | `/roles/:key/assign` | **WORKING** | Yes | self-assign refused |
| Effective-access surface map | AuthZ | all | `Guard` in `App.tsx` | `effective-access.js` | — | `/me/effective` | **WORKING** | Yes | UI hint only; server re-decides |
| API keys (scoped, hashed) | Platform | owner, itadmin | ItAdmin | `app.js:1299+` | `api_keys` | `/api-keys` | **MOSTLY WORKING** | Partial | `adminOnly` skips custom-role masks |
| Outbound webhooks (signed) | Platform | owner, itadmin | ItAdmin | `app.js:1333+` | `webhooks` | `/webhooks` | **MOSTLY WORKING** | Partial | same `adminOnly` hole |
| Students CRUD + search | People | owner, principal, coordinator, admissions, itadmin | `People.tsx` | `routes.js:583+` | `students` | `/students` | **WORKING** | Yes | parent structural binding checked |
| Student admit / withdraw / promote | People | owner, principal, itadmin | `PeopleAdmin.tsx` | `people.admin` | `enrollment_history` | plugin doors | **MOSTLY WORKING** | Yes | bulk promote has no dry-run/exceptions |
| Guardians / parent links | People | admin, parent | family screens | `family.view`, `people.admin` | `guardians`, `family.child_link` | `/parent/*` | **MOSTLY WORKING** | Yes | dual-model drift was fixed (M1) |
| Classes / sections / subjects | Academic | owner, principal, coordinator | `Classes.tsx` | `routes.js:850+` | `classes`, `sections`, `subjects` (135) | `/school/classes` | **PARTIAL** | Partial | students still store free-text grade/section |
| Academic years | Academic | owner, principal | Settings | `routes.js:1059+` | `academic_years` | `/academic-years` | **MOSTLY WORKING** | Yes | rollover is flag-only |
| Attendance marking | Academic | teacher (class-of-record), owner/principal/coordinator | `Attendance.tsx` | `routes.js:726+` | `attendance` | `/attendance/mark` | **BROKEN (policy)** | Partial | unlimited overwrite; no lock (§17) |
| Attendance read (parent-scoped) | Academic | parent, student, staff | family/student | `routes.js:704+` | `attendance` | `/attendance` | **WORKING** | Yes | |
| Absence notices | Comms | system | — | `routes.js:802+` | `outbox`, `communications` | internal | **MOSTLY WORKING** | Yes | dual guardian model now written |
| Timetable (periods/slots/clash) | Academic | coordinator, owner, itadmin | `Timetable.tsx` | `ops.timetable` | `plugin_timetable.*` | plugin + `/timetable/clash-check` | **MOSTLY WORKING** | Yes | bulk door added to avoid event budget 429 |
| Homework create / submit / review | Academic | teacher, student | teacher/student screens | `teacher.classroom`, `student.world` | `teacher.homework`, `submission` | plugin doors | **WORKING** | Yes | UNIQUE(homework_id, student_id) |
| Exams / marks / publication | Academic | teacher, coordinator, principal | `ExamMarks.tsx` | `exams.assessment` | `plugin_exams.*` | plugin doors | **MOSTLY WORKING** | Yes | freeze is app-only; no `marks<=max_marks` DB check |
| Report cards / CBSE pack | Academic | coordinator, principal | Reports | `pack.cbse` | `plugin_cbse.*` | plugin | **MOSTLY WORKING** | Yes | float pct boundary drift |
| Grading scale / board policy | Academic | owner, principal | Settings | `exams.assessment`, `routes.js:3628` | — | plugin + kernel | **WORKING** | Yes | weightage must sum 100 |
| Fee heads / plan templates / generate | Finance | finance*, owner, principal | `Fees.tsx` | `routes.js:1088-1335` | `fee_heads`, `fee_plan_templates`, `fee_obligations` | `/fee-plans/*` | **MOSTLY WORKING** | Yes | (student,term,label) unique collides across plans |
| Fee obligations / dues | Finance | finance*, parent, student | `Fees.tsx`, `ParentFees`, `StudentFees` | `routes.js:1421+` | `fee_obligations` | `/fees/obligations` | **WORKING** | Yes | |
| Payments (initiate/confirm) | Finance | finance*, parent | `RecordPaymentModal` | `routes.js:1550-1830` | `payments`, `payment_allocations` | `/fees/payments` | **BROKEN (race)** | Partial | pay-many open-payment hole (§17) |
| Receipts (PDF) | Finance | finance*, parent | Fees | `routes.js:1750+`, `fees/receipt-pdf.js` | `fee_receipts`, `files` | `/fees/receipts` | **MOSTLY WORKING** | Yes | multiple receipts per payment possible |
| Concessions / waivers | Finance | finance*, owner | Fees | `routes.js:2105+` | `fee_concessions` | `/fees/concessions` | **MOSTLY WORKING** | Yes | owner self-approve; null-obligation no-op |
| Installments / partial pay | Finance | finance*, parent | Fees | `routes.js:1622+`, `fees/installments.js` | `fee_installments` | — | **WORKING** | Yes | integer-cents split |
| Refunds | Finance | finance_head, owner | Fees | `routes.js:3313-3407` | `payments`, allocations | `/payments/:id/refund` | **MOSTLY WORKING** | Yes | SoD; gateway-before-ledger; paid_cents decreases |
| Late fees / dunning | Finance | finance*, system | Fees | `routes.js:1125+,3490+` | `fee_dunning_log` | `/fees/dunning` | **MOSTLY WORKING** | Yes | late fee skips paid (good); quiet hours; dedup |
| Reconciliation | Finance | finance_head | Fees | `routes.js:3410+`, `fees/reconcile.js` | `payments` | `/fees/reconcile` | **WORKING** | Yes | |
| UPI / Razorpay gateways + webhooks | Finance | system | — | `payments.upi`, `payments.razorpay` | `plugin_upi.*`, `plugin_razorpay.*` | webhook receivers | **MOSTLY WORKING** | Yes | HMAC; idempotency optional |
| Tally daybook export | Finance | finance | — | `accounting.tally` | `plugin_tally.*` | plugin | **WORKING** | Yes | read-only, digest-audited |
| Library books / copies / issue / return | Library | librarian, owner/principal | `Library.tsx` | `library` | `library.*` | plugin | **WORKING** | Yes | one-open-per-copy unique |
| Library reservations / fines / lost | Library | librarian | Library | `library` | `library.fine`, reservations | plugin | **MOSTLY WORKING** | Yes | UTC day math; fines only at return |
| Library acquisitions / budgets | Library | librarian, owner | Library | `library` | `acquisition_*` | plugin | **WORKING** | Yes | |
| Transport routes / stops / events | Transport | transport, owner | `Transport.tsx` | `transport.gps`, `routes.js:2140+` | `routes`, `route_stops` | plugin + kernel | **PARTIAL** | Partial | `bus_route` free text, no capacity (§17) |
| GPS positions | Transport | transport | Transport map | `transport.gps` | `plugin_transport_gps.positions` | plugin | **UNVERIFIED** | Partial | write model is new/uncommitted |
| Visitors / pickup OTP | Ops | reception, facilities | `VisitorsBoard.tsx` | `ops.visitors` | `plugin_visitors.*` | plugin | **WORKING** | Yes | guardian-verified pickup |
| Work orders / preventive / assets | Ops | facilities, technician | `WorkOrders`, `Assets`, `Preventive` | `routes.js:2240+` | `work_orders` | `/work-orders` | **MOSTLY WORKING** | Partial | |
| HR leave (mark + request/approve) | HR | staff, principal | `MyLeave.tsx` | `hr.leave` | `plugin_hr.leave`, `teacher.leave_request` | plugin + kernel | **MOSTLY WORKING** | Yes | no half-day |
| Staff appraisals | HR | principal, owner | `Appraisals.tsx` | `routes.js:2890+` | `staff_appraisals` | `/staff-appraisals` | **WORKING** | Yes | 1..5 ratings |
| **Payroll / salary / payslips** | HR | accountant | — | — | — | — | **MISSING** | — | no schema, no routes |
| Admissions funnel (leads→offer) | Admissions | admissions | `Admissions`, `FunnelBoard` | `admissions.funnel` | `plugin_admissions.*` | plugin | **WORKING** | Yes | |
| Admissions followups (SLA) | Admissions | admissions | Admissions | `routes.js` | — | `/admissions/followups` | **WORKING** | Yes | deterministic |
| Announcements | Comms | owner, principal, coordinator | `Announcements.tsx` | `routes.js` | `announcements`, `announcement_receipts` | `/announcements` | **MOSTLY WORKING** | Partial | |
| Notifications bell / events feed | Comms | all | `NotificationsBell`, `Today` | `routes.js` | `outbox`, `events` | `/events`, notifications | **MOSTLY WORKING** | Partial | |
| Email / SMS / WhatsApp rails | Comms | system | RailsBoard | `rails.*` | `communications` | plugin | **PARTIAL** | Yes | sandbox-first, honest 503 |
| Parent family view (per-child) | Parent | parent | `FamilyHome`, child flows | `family.view` | `family.child_link` | `/parent/*` | **WORKING** | Yes | structural child binding |
| Parent copilot (budgeted) | Parent | parent | `ParentCopilot` | `parent.assistant` | plugin | plugin | **WORKING** | Yes | monthly budget 429 |
| Student world (homework, marks, wellbeing) | Student | student | `StudentHome2`, learn lane | `student.world` | `plugin_student.*` | `/student/*` | **WORKING** | Yes | owner_scoped RLS |
| Teacher classroom | Teacher | teacher | `TeacherHome`, homework, duties | `teacher.classroom` | `teacher.*` | plugin | **WORKING** | Yes | created_by scoping |
| Teacher support (concerns, interventions) | Teacher | teacher, counselor | support hub | `teacher.support` | `plugin_support.*` | plugin | **WORKING** | Yes | B9 confidentiality pinned |
| Coordinator desk | Coordinator | coordinator | `Group.tsx` screens | `coord.view` | `plugin_coord.*` | plugin | **WORKING** | Yes | SoD on decide |
| Principal / owner dashboards | Oversight | owner, principal | `OversightHome`, `PrincipalBrief`, `BoardPack` | `routes.js` owner-home | — | `/owner/home`, `/principal/home` | **MOSTLY WORKING** | Partial | 7am brief / fee-health control absent per docs |
| Reports / BI / insights | Reporting | owner, principal, finance | `Reports`, `Insights`, `ops.bi` | `ops.bi`, `routes.js` | read models | plugin + `/reports/*` | **MOSTLY WORKING** | Yes | |
| Audit log + verification | Governance | owner, itadmin | `Audit.tsx` | `audit.js`, `routes.js` | `audit_log` | `/audit`, `/audit/verify` | **WORKING** | Yes | hash chain verified |
| DPDP pack (consent, SAR, erasure) | Compliance | itadmin, owner | `Compliance.tsx` | `pack.dpdp` | `plugin_dpdp.*` | plugin | **WORKING** | Yes | |
| CBSE pack | Compliance | coordinator | BoardPack | `pack.cbse` | — | plugin | **MOSTLY WORKING** | Yes | |
| Plugin catalog / enable / settings | Platform | owner, itadmin | `Plugins`, `PluginSettings` | `plugin-catalog.js`, `routes.js` | `plugins`, `plugins.settings` | `/plugins/*` | **WORKING** | Yes | born-at-signup catalog |
| Entitlements / plans | Platform | system | — | `entitlements.js` | — | internal | **WORKING** | Yes | |
| Data import (stage→shadow→commit) | Platform | itadmin | `Migration.tsx` | `ops.import`, `routes.js` | migration engine | `/migration/*` | **MOSTLY WORKING** | Yes | real `differenceCents` |
| Files store / documents | Platform | all (scoped) | `Documents.tsx` | `files.store` | `files` | plugin | **WORKING** | Yes | tenant dirs, no direct serve |
| Certificates | Academic | principal | `Certificates.tsx` | `routes.js` | — | `/certificates` | **PARTIAL** | Partial | signing absent per owner docs |
| AI gateway + budgets | AI | all | `Ai.tsx`, copilots | `_shared/ai-gateway` | `ai_calls` | `/ai/*` | **MOSTLY WORKING** | Yes | deterministic v0; no live LLM |
| Workflow rules / automation | Platform | owner, principal | `Automation.tsx` | `app.js` workflow doors | `workflow_rules` | `/workflow-rules` | **PARTIAL** | Partial | minimal runner |
| Search (global) | Platform | all | Cmd+K palette | — | — | — | **PARTIAL** | No | client-side palette only; no server search API |
| Subscriptions / SaaS billing | Business | platform | — | — | — | — | **MISSING** | — | tenant plans are entitlement flags only |
| Support / helpdesk for schools | Business | all | `ReportIssue.tsx` | — | — | — | **PARTIAL** | No | photo capture is simulated |
| Inventory (non-library) | Ops | facilities | `MaintInventory` | maintenance screens | — | — | **PARTIAL** | Partial | assets exist; full stock ledger unverified |
| Messaging (internal chat) | Comms | parent, staff | `ParentChat.tsx` | `family.view` | messages tables | plugin | **MOSTLY WORKING** | Partial | |
| Health clinic | Health | clinic staff | screens | `health.clinic` | `plugin_clinic.*` | plugin | **WORKING** | Yes | B9 tiered visibility |
| Document management | Platform | all | `Documents.tsx` | `files.store` | `files` | plugin | **WORKING** | Yes | |
| User management (provision/reset/suspend) | Admin | owner, itadmin | `PeopleAdmin.tsx` | `people.admin` | `users` | plugin | **MOSTLY WORKING** | Yes | itadmin can mint peer itadmins |
| Settings / school profile | Admin | owner, principal | `Settings.tsx` | `routes.js`, `settings-contract.js` | `tenants.config` | `/school/*` | **WORKING** | Yes | secrets sealed via settings-crypto |
| i18n | UX | all | `app/src/i18n/` | — | — | — | **PARTIAL** | No | presence only; coverage unverified |
| Observability (metrics/health) | Ops | itadmin | ItAdmin | `app.js:295,1623` | — | `/health`, `/ready`, `/metrics` | **PARTIAL** | Yes | fleet_ leak (§14); no APM |

---

## 6. User Roles & Permissions

### 6.1 Builtin roles (16)

`owner`, `principal`, `coordinator`, `teacher`, `counselor`, `finance`, `finance_head`, `finance_clerk`, `admissions`, `transport`, `facilities`, `technician`, `itadmin`, `librarian`, `parent`, `student` — frozen in `server/src/role-catalog.js:11-42`.

### 6.2 Scope model (`auth.js:77+ roleScope`)

| Role | Data scope |
|---|---|
| parent | own children only (`family.child_link`) |
| student | self only |
| technician | maintenance only |
| teacher | teaching only |
| other staff | tenant staff scope |

### 6.3 How enforcement works

1. **Server:** every door has `preHandler: require(...roles)` / `roleGatedMe` / `me` / plugin `requireRole`. `permission-matrix.js` fails CI on any unguarded route (402 routes · 358 role-gated · 31 auth-only · 13 public · **0 unguarded**).
2. **Masks:** custom roles apply DENY/ALLOW over the base gate (`custom-roles.js:73-78`).
3. **UI:** `canSurface(live.effective, pathname)` hides nav/routes — explicitly documented as a render hint only (`App.tsx:213-237`).
4. **Fail-closed UI:** unknown roles map to `student` (lightest surface) (`app/src/lib/roles.ts:24-29`).

### 6.4 Permission defects (verified)

| Defect | Location | Impact |
|---|---|---|
| `adminOnly()` ignores custom-role masks and never stamps `__gateRoles` | `app.js:1299-1302` | DENY on `/api-keys` or `/webhooks` is silently inert; amplification ceiling has a hole on those doors |
| `/onboard/school` does an inline `role !== 'owner'` check outside the gate system | `onboarding.js:141-142` | mask drift class |
| `itadmin` can create/reset peer `itadmins` | `people.admin/index.js:45,77,225` | one compromised itadmin → persistent backdoor accounts |
| `GET /metrics` role-gates `owner,itadmin` but emits platform `fleet_*` | `app.js:1670-1889` | school IT admin sees fleet-wide queue depths/failures |
| `GET /cases` returns `SELECT *` to a wide staff set including finance | `routes.js:2281-2288` | safeguarding-adjacent data over-exposed |

---

## 7. User Journey Audit

### Stage 1 — Discovery / entry

| Step | Result | Evidence |
|---|---|---|
| Open app | WORKING | Vite SPA, route map in `App.tsx:426-589` |
| Login screen | WORKING | 3 methods (password/OTP/Google-disabled), roving tabindex tabs, return-to-URL preserved and open-redirect-safe (`Login.tsx:61-67`) |
| Registration (school) | WORKING | `/onboard` public wizard → tenant + owner + 23-plugin catalog in one tx |
| Invitation | **MISSING** | No invite-by-link/email flow found; users are provisioned with temp passwords |
| Password recovery | MOSTLY WORKING | 30-min single-use hashed token; **503 oracle** when email rail off |
| Email verification | **MISSING** | `onboarding.js` accepts `ownerEmail` with no ownership proof |

**Verdict:** a brand-new school owner can reach a logged-in owner session in ~5 minutes. Email is not verified — a typo locks out the real owner and an attacker can squat an email.

### Stage 2 — School onboarding

| Step | Result | Notes |
|---|---|---|
| School profile | WORKING | name/address/board in signup + Settings |
| Principal/admin creation | WORKING | `people.admin` HANDOVER chain; force_change on temp passwords |
| Academic year | WORKING | one `is_current` per tenant (DB-enforced) |
| Classes / sections | MOSTLY WORKING | born empty (A2 fix); dual home (JSON `tenants.config.setup.sections` + `app.classes`) |
| Subjects | MOSTLY WORKING | `app.subjects` arrives only in migration 135 |
| Staff | WORKING | PeopleAdmin provision with temp passwords |
| Students | WORKING | manual, bulk import (shadow→commit), or admissions funnel |
| Parents | MOSTLY WORKING | dual model (`app.guardians` + `family.child_link`) now written together |
| Configuration | WORKING | plugin catalog switches; credential rails born OFF |
| Permissions | WORKING | custom roles + assign with step-up |
| Defaults | MOSTLY WORKING | fee plans/exams still need manual setup |

**Verdict:** yes, a new school can reach a usable state. Gap: no email verification of the owner, and class/section identity is split across free-text and tables, which will bite on rename.

### Stage 3 — Administration

User create/edit/suspend/reset/password-generate all work (`people.admin`). Defects: `window.confirm` for suspend/reset/move (`PeopleAdmin.tsx:130,140,150`); itadmin peer-provisioning not restricted; role change requires step-up (good) but owner cannot be re-roled (good).

### Stage 4 — Teacher workflow

Login → `TeacherHome` (live) → timetable (live) → attendance (works but unlocked) → homework/submissions (live, teacher-scoped) → exam marks (live, frozen at publish) → leave (live) → support hub (live). First-period fallback for attendance without `class_assignments` is implemented (`routes.js` `firstPeriodClasses()`).

**Break points:** attendance can be rewritten later; family leave clobbers the register; a suspended teacher's `class_assignments` may remain active (probable).

### Stage 5 — Student workflow

`StudentHome2` + learn lane are live and owner_scoped at the RLS layer. Legacy `StudentHome.tsx` renders `StudentHomeNotConfigured` (honest empty state). Short 30m session TTL is correct for kiosks.

**Gap:** student login accounts are an onboarding decision — `app.student_accounts` is empty on app-onboarded schools (SIMULATION-FIXES D4), so some self-service surfaces need a linked `user_id`.

### Stage 6 — Parent workflow

`FamilyHome` + per-child flows (attendance, leave request, exams, assignments, timeline, PTM, consents) are live and structurally child-bound. Fees/dues scoped. Mobile tabbar exists.

**Break points:** leave approval clobbers attendance; parent chat/complaints exist but depth is partial.

### Stage 7 — Finance workflow

Fee heads → plan templates → generate (idempotent) → obligations → payments (partial supported) → confirm (maker/checker) → receipts (PDF) → concessions → refunds → dunning → reconciliation. Integer cents throughout.

**Break points (confirmed):**
1. Pay-many race can double-settle the same obligations.
2. Idempotency-Key is optional.
3. `initiated` payments never expire and can hold the one-open slot forever (single-obligation case).
4. Owner can self-approve concessions.
5. A concession with no `obligation_id` approves as a silent no-op.
6. Multiple receipts per payment are possible (no `UNIQUE(payment_id)`).

### Stage 8 — Library workflow

Books/copies/issue/return/holds/fines/lost/replacement/acquisitions all exist and are librarian-gated. Double-issue impossible. **Defects:** fines use UTC date math and only accrue at return; identifier scheme needs owner/principal settings door (now shipped per D1 fix).

### Stage 9 — Academic workflow

Exams → components (weightage sums 100) → marks (frozen at publish, app-level) → approval spine → reports/digests → CBSE export. Promotion writes `enrollment_history` atomically; Grade 12 terminal guard.

**Break points:** no DB `marks <= max_marks`; publish freeze has no DB trigger; grade band uses float percentage; academic-year rollover is a flag only; retention requires manual transfer after bulk promote.

### Stage 10 — Communication

Announcements, notifications, events feed, parent chat, absence notices, dunning reminders, delivery receipts in `app.communications` (codes redacted). Rails are sandbox-first with honest 503s.

### Stage 11 — Administrative lifecycle

| Event | Behavior | Assessment |
|---|---|---|
| AY rollover | flips `is_current`; nothing archived; `academic_year_id` nullable | PARTIAL |
| Teacher leaves | `active=false`, sessions die next request; class_assignments not cleared | PROBABLE GAP |
| Student transfers | `status='transferred'`, bus cleared, history kept | WORKING |
| Student deactivation | status enum, history kept | WORKING |
| Class/section change | PeopleAdmin move with confirm | MOSTLY WORKING (free-text grade) |
| Archived users | `active=false` | WORKING |
| Historical data | enrollment_history append-only; attendance/fees kept | WORKING |

---

## 8. Frontend Audit

**Stack:** React 19 + Vite + TS + custom CSS tokens. `App.tsx` (~696 lines) holds ~90 routes. State = `store.tsx` reducer + `TeacherProvider`. API = single `call()` brain in `liveApi.ts:106-145`.

### Strengths
- Memory-only bearer token; durable credential is HttpOnly cookie (`liveApi.ts:26-31`) — XSS cannot steal a persistent token from storage.
- 401 → clear + `/login?return=…` with open-redirect validation.
- `Empty` / `ErrorState` / `Skeleton` / `SampleNote` primitives used broadly (`ui.tsx:81-127`).
- Unknown role fails closed to `student`.
- Offline sync banner (`App.tsx:180-206`).
- Focus trap in dialogs (`useDialogFocus`, `ui.tsx:197-231`).

### Defects
| Finding | Location | Impact |
|---|---|---|
| `window.confirm` for suspend / reset password / move student | `PeopleAdmin.tsx:130,140,150` | inaccessible, unstyleable, blocks main thread |
| `window.prompt` for step-up password | `liveApi.ts:91` | same; also trains users to type passwords into native prompts |
| `window.alert` for keyboard help | `App.tsx:605` | same |
| Hard `window.location.href` on 401 | `liveApi.ts:123-129` | loses in-memory form state |
| No retry/backoff in `call()` | `liveApi.ts:106-145` | flaky networks need manual retry per screen |
| Two error shapes (`{error,code}` vs `{error}`) | `error-codes.js` vs `routes.js:28` | inconsistent client handling |
| Mixed REST + RPC naming | routes | cognitive load |
| `StudentHome` / `ParentHome` legacy screens are empty shells next to live v2 screens | `StudentHome.tsx`, `ParentHome.tsx` | duplicated navigation surfaces |
| Terminology drift | `Shell.tsx` | "Front desk" vs "Reception"; "Needs your attention" vs "Attention" |

### Parity gate
`server/scripts/parity-gate.js` classifies write doors as wired/wrapper-only/orphan/demo-only and is **enforced in CI** (`--enforce`). Mock-plane imports are banned on live screens. This is a genuinely good control.

---

## 9. Visual / Screenshot Audit

`shots/` and `.ui-audit/` exist in-tree but are gitignored scratch. **Live browser screenshots were not produced in this audit pass** (no browser session attached).

What is verifiable from code (`app/src/styles/`):
- Breakpoints at 768px and 640px; `MobileTabbar` replaces sidebar under 768px (`base.css:67-68,94,138,161`, `DemoBar.tsx:10-71`).
- Overflow safety layer: `min-width:0` on all children, `overflow-x:clip` on html/body, `overflow-wrap:break-word` on text (`base.css:114-167`) — deliberate defense against horizontal scroll.
- Wide tables get `.table-wrap { overflow-x:auto }` + `min-width:max-content` (`base.css:135-140`) — horizontal scroll *inside* the table, not the page.

**Not verified:** pixel-level overlapping elements, dialog footer reachability at 390px, contrast ratios measured in a browser, broken icons.

Code-level visual risks:
1. Modal footers are not position:sticky in `components.css` — on short viewports a long form's primary action can sit below the fold (pattern risk on PeopleAdmin/Fees dialogs). **Not verified in browser.**
2. Badge status is color-toned (`badge-success/danger/warning/info`) with optional dots — color-only status (see §21).
3. `u-hide-mobile` simply hides content under 768px — important columns must be duplicated in a card pattern or they disappear; per-screen coverage **Not verified**.

---

## 10. Forms & Validation Audit

### Client
- Onboard: `minLength` 8 password, 3 school name, `required`, email format.
- Login: `required`, `aria-invalid`, `aria-describedby` on error.
- ExamMarks: submit disabled while `busy` or no valid rows (`ExamMarks.tsx:266-267`).
- Fees void: proper Modal with reason field (`Fees.tsx:162-164,271-285`).
- Double-submit prevention via `busy`/`loading` on `Button` (`ui.tsx:16`).

### Server
Manual validation dominates. `zod` is in `package.json` but **no `z.object` / `safeParse` usage** at the API boundary (grep across `app.js`, `routes.js` returns zero schema calls). Helpers do exist: `pageParams`, `normalizeClasses`, `validateTerms`, `validateInstallments`, `uuidParams`, regexes for keys/dates.

### Gaps

| Finding | Severity | Evidence |
|---|---|---|
| No runtime schema validation library in use despite dependency | Medium | `package.json` has zod@4; zero schema calls in server source |
| Password policy is length-only (≥8) | High | `app.js:967`, `onboarding.js:68`, `people.admin:118` — `password1` accepted |
| `fee_obligations.amount_cents` allows 0 and has no `>=0` CHECK | High | `001_init.sql:94` vs payments which have `CHECK (amount_cents > 0)` |
| `plugin_exams.mark` has no `marks <= max_marks` CHECK | High | `025_exams_assessment_runtime.sql:45-46` |
| Many list endpoints unpaginated (`/work-orders`, `/cases`, `/actions`, `/announcements`, `/audit`, `/payments`) | Medium | `pageParams` used only on `/students`, `/fees/obligations` |
| Empty JSON body behavior depends on shared parser (fixed to `{}` per D3) | Low | `plugins/_shared/raw-body-parser.js` |
| Extremely long strings: only some fields length-capped (school 3–120, role key 2–40) | Medium | no global max on names/notes |

**Frontend validation is not a security control** — and the server does validate the dangerous paths (roles, money amounts as integer cents, UUID params). The gap is consistency, not a free-for-all.

---

## 11. API Audit

**Surface:** 402 catalogued routes (358 role-gated, 31 auth-only, 13 public, 0 unguarded). Core: 34 doors in `app.js` + 118 in `routes.js`; plugins add the rest.

| Criterion | Assessment |
|---|---|
| Auth on every door | PASS — `permission-matrix.js` enforces |
| AuthZ | PASS with exceptions (`adminOnly`) |
| Tenant isolation | PASS at RLS; id-only SQL is residual risk |
| Validation | PARTIAL — manual, uneven |
| Error shape | INCONSISTENT — money uses `{error,code}` (16 codes), rest `{error}` |
| Pagination | PARTIAL — helper exists, rarely used |
| Filtering/sorting | PARTIAL — ad hoc query params |
| Rate limiting | PASS — global 300/min + tight auth doors |
| Docs | PARTIAL — fees-only OpenAPI 3.1 (`src/fees/openapi.js`); no global spec |
| Idempotency | PARTIAL — `Idempotency-Key` supported on payments but optional |
| Request IDs | PASS — `x-request-id` echoed into client errors (`liveApi.ts:139-143`) |

### API problems
1. `POST /api-keys`, `/webhooks` show as `auth`-only in the permission matrix (because `adminOnly` does not stamp `__gateRoles`) — the matrix cannot see their true role set.
2. Unbounded list endpoints will degrade at 2,000-student school volumes.
3. Mixed RPC verbs (`/decide`, `/mark`, `/generate`) vs REST resources.
4. Webhook receivers correctly use raw-body signature verification (`_shared/raw-body-parser.js`) — order of HMAC vs payment lookup should be re-verified (see §15, **Not verified**).

---

## 12. Authentication Audit

### What is strong (verified)
| Control | Location |
|---|---|
| scrypt N=2^17, r=8, p=1, keylen 64, 16-byte salt | `auth.js:15-27` |
| `timingSafeEqual` compare; malformed hash → false not 500 | `auth.js:26-37` |
| Legacy N=16384 accepted then rehashed on login | `auth.js:49-50`, `app.js:398-401` |
| `dummyVerify` equalizes unknown-user timing | `auth.js:54-58`, `app.js:354` |
| jti mandatory on every token | `app.js:207-209` |
| jti denylist + `session_epoch` global revoke | `app.js:210-220`, migrations 038, 055 |
| Per-user + per-identifier lockout (5/15min), checked before user lookup | `app.js:328-389`, migration 097 |
| TOTP ±1 step with monotonic `last_totp_step` replay guard | `totp.js:40-51`, `app.js:1247-1251` |
| Recovery codes 80-bit, keyed HMAC, atomic single-use | `app.js:43,1240-1243` |
| MFA demanded on every issuance path (password/OTP/SSO/switch) | `app.js:456-470,765,832,945` |
| OAuth `state` single-use 10-min TTL | `app.js:793` |
| Reset tokens: 32 random bytes, sha256-at-rest, single-use race-safe, 30 min, epoch bump | `app.js:1029-1115` |
| OTP/reset codes redacted from `app.communications` and audit | `app.js:684,1051` |
| Cookies `HttpOnly; SameSite=Strict; Secure(prod)` | `app.js:100-136` |
| CSRF double-submit on cookie-authed mutations | `app.js:194-202` |
| Dev SSO/echo dual-gated (NODE_ENV + explicit flag) and loud | `config.js:64-92` |

### Authentication defects

**[CONFIRMED] Password accepted via `x-step-up-password` header**
- Location: `server/src/app.js:1372-1385`
- Evidence: `const pw = req.headers['x-step-up-password']; … verifyPassword(String(pw), …)`
- Impact: account passwords transit in a header. Reverse proxies, load balancers, APM agents, and Fastify request logging commonly capture headers → credential leak into logs.
- Fix: accept passwords only in a JSON body on `POST /me/step-up`; disable the header path.
- Confidence: high

**[CONFIRMED] Default secret fallback for JWT and settings master key**
- Location: `server/src/config.js:33`, `server/src/settings-crypto.js:5`
- Evidence: `jwtSecret: req('JWT_SECRET', 'dev-only-secret-change-me')` and `process.env.PLUGIN_SETTINGS_KEY ?? process.env.JWT_SECRET ?? 'dev-only-secret-change-me'`
- Impact: any non-`production` process signs tokens with a known string (account forgery) and derives the AES-256-GCM key for SMTP passwords / gateway secrets from a known string (offline decrypt of every tenant's sealed settings). Also couples signing key to data-at-rest key.
- Fix: no fallback — refuse to boot without explicit secrets in every env except a clearly-marked local dev; use a distinct `PLUGIN_SETTINGS_KEY`.
- Confidence: high

**[CONFIRMED] User-enumeration oracles**
- Location: `app.js:814` (Google: `403 no SchoolOS account for ${email}`), `app.js:1015-1027` (reset: `503` when email rail off vs `200 {sent:true}` for unknown)
- Impact: unauthenticated attacker enumerates valid accounts.
- Fix: uniform response shape and message on all three paths.
- Confidence: high

**[CONFIRMED] JWT returned in JSON body as well as cookie**
- Location: `app.js:418,453,960,984,1292` — `return { token: s.token, user: s.user }`
- Impact: response-body logging, browser extensions, or XSS can read a bearer token even though the cookie is HttpOnly.
- Fix: stop returning tokens to browser clients.
- Confidence: high

**[RISK] No absolute session ceiling**
- Location: `app.js:427-439` (`/auth/renew` issues a fresh full-TTL token)
- Impact: stolen cookie kept alive indefinitely.
- Fix: cap rolling sessions; force re-login every N hours.
- Confidence: high

**[RISK] TOTP secrets plaintext at rest**
- Location: `app.js:1148-1150`, `migrations/057`
- Fix: envelope-encrypt like plugin settings.
- Confidence: high

**[RISK] Password policy is 8-char length only**
- Location: `app.js:967`, `onboarding.js:68`, `people.admin:118`
- Confidence: high

**[RISK] Self-signup mints an `owner` with no email verification and no MFA**
- Location: `onboarding.js:53-121`
- Confidence: medium

**[RISK] CSRF compare is not constant-time** (`app.js:199`) — inconsistent with the rest of the codebase.
**[RISK] Login CSRF not mitigated** on `/auth/login`.
**[RISK] Rolling MFA challenge JWT (5 min) is not in the jti denylist** (`app.js:463,1205-1209`).
**[RISK] `trustProxy` keyGenerator uses rightmost XFF hop** — multi-proxy residual (`app.js:78-80`).
**[RISK] CORS `credentials:false` + stale comment** while cookie auth exists (`app.js:65`). Split-origin deployments will silently depend on the body token.

---

## 13. Authorization Audit

See §6 for the model. Confirmed defects:

**[CONFIRMED] `adminOnly()` bypasses the custom-role system**
- Location: `server/src/app.js:1299-1302`
```js
const adminOnly = (...roles) => async (req, reply) => {
  await app.authenticate(req, reply);
  if (!['owner', 'itadmin'].includes(req.user?.role)) return reply.code(403).send({ error: 'owner or itadmin only' });
};
```
- Used by `POST/GET/DELETE /api-keys` and `/webhooks`.
- Two-sided impact: (1) a custom-role DENY on these doors is silently ignored while the product claims denies always fire; (2) these doors are invisible to `doorRoles`, so the anti-amplification ceiling (`routes.js:422-434`) cannot see them — an `itadmin` could author an `allow` mask naming `POST /api-keys` without tripping `MASK_AMP`.
- Fix: route `adminOnly` through the shared `require()`/`requireRole()` factory that stamps `__gateRoles` and applies masks.
- Confidence: high

**[CONFIRMED] Inline role check on `/onboard/school`**
- Location: `onboarding.js:141-142` — `if (req.user.role !== 'owner') …`
- Same registry-drift class. Low direct severity.
- Confidence: high

**[CONFIRMED] `itadmin` peer provisioning**
- Location: `people.admin/index.js:45,77,225` — `ADMIN = ['owner','itadmin']` for create and password reset.
- Impact: compromised itadmin mints persistent itadmins (owner is protected; itadmin is not).
- Fix: require owner (or owner notification + step-up) for itadmin-peer mutations.
- Confidence: high

**[CONFIRMED] Platform metrics behind a tenant door** — see §14.

### What is strong
- Teachers cannot self-escalate: role CRUD is `owner|itadmin`, assign requires step-up, self-assign 403, owner accounts immutable (`routes.js:541-557`).
- Money SoD: confirm is checker-only (clerk removed from confirm), concession requester cannot approve (except owner), action decide is owning-role only with principal/coordinator and finance exclusions (`routes.js:1667-1669, 2105-2112, 3205-3244`).
- Parent/child binding is structural (`family.child_link`), not name matching (RT-7cyc7 fix).
- Teacher homework review is `created_by`-scoped.

---

## 14. Multi-Tenancy Audit

### Controls (verified strong)
- `q()` = constrained `schoolos_app` (RLS applies); `sysq()` = owner (bypass) — only 3 `sysq` sites in `routes.js` (`:321, :3852, :3855`).
- RLS ENABLE + FORCE on `app.*` and plugin schemas (`001`, `054`, `113`, `124`).
- NULL/'' GUC → deny (`074`).
- Composite tenant FKs (`081`, `082`) prevent cross-tenant child rows from being accepted then hidden.
- Multi-row email/phone identity never silently picks `rows[0]` — returns 409 multi-tenant picker (`app.js:336-348,484-489`).
- File storage is per-tenant directory with traversal guards (`files.store/index.js:5-10,203-261`).
- Tests: `l2-multi-tenant.test.js`, `rls-boundary.test.js`, `dat1-tenant-alignment.test.js`, `b9-confidentiality.test.js`.

### Defects

**[CONFIRMED] School-level roles read platform `fleet_*` metrics**
- Location: `server/src/app.js:1670-1889` (series names `schoolos_fleet_*`), gated at `GET /metrics` by `requireRole('owner','itadmin')` (`app.js:1623`)
- Evidence: source comment admits these are "platform-wide totals … (ALL tenants)".
- Impact: a school's IT admin learns fleet-wide outbox backlog, comms failures, webhook stalls, fee settlement latency, dunning queue age, wellbeing stalls across **every tenant**. Not row-level PII, but platform-scope operational intelligence and a competitive/privacy concern in a multi-school deployment.
- Fix: split into `GET /metrics` (tenant-scoped) and an operator-only listener/role for `fleet_*`.
- Confidence: high

**[RISK] 15+ queries key only on `WHERE id=$1` with no `tenant_id`**
These run under `withUser()` so RLS is the barrier today. Each is a defense-in-depth gap: one RLS regression = cross-tenant read/write.

| Door | Location |
|---|---|
| `GET /students/:id` | `routes.js:622` — `SELECT * FROM app.students WHERE id=$1` |
| `POST /fees/obligations/:id/void` | `routes.js:1345` |
| `POST /fees/payments` (obligation lock) | `routes.js:1600` |
| `POST /fees/payments/:id/confirm` | `routes.js:1677` |
| `POST /fees/concessions/:id/decide` | `routes.js:2124` |
| `POST /payments/:id/refund` | `routes.js:3329,3364` |
| Fee receipt file lookup | `routes.js:1977` area |
| `people.admin` user updates | `people.admin/index.js:210,235` |
| `academic-years` activate | `routes.js:1067` |
| Library copy/loan updates | `library/index.js:303,591,604,670,705,741,904,960` |
| `teacher.copilot` student reads | `teacher.copilot/index.js:313,400` |
| File download SELECT | `files.store/index.js:213` |
| Work-order / case / action status | `routes.js:2249,2378,3202` |

- Fix: add `AND tenant_id=$2` everywhere (belt) on top of RLS (suspenders).
- Confidence: high (that the predicate is missing); the active exploitability is **unverified** because RLS was not bypassed.

**[RISK] `/me/tenants` lists every school where the caller's email has an account** (`app.js:906-913`) — legitimate for the switcher, a privacy leak if emails are shared.

**[RISK] Webhook payment lookup via `sysq` by id** (`payments.razorpay/index.js:247`, `payments.upi/index.js:109`) — **order of HMAC verification vs this lookup Not verified**.

---

## 15. Security Audit

### Summary of security posture

The security *program* is real: threat model (`docs/SECURITY-MATRIX.md`), red-team ledger with RT-1…RT-11 fixed and pinned, secret-scan fail-closed in CI, `npm audit --audit-level=high`, permission matrix, parity gate, DPDP pack.

### Security vulnerabilities (consolidated)

| # | Sev | Finding | Location | Category |
|---|---|---|---|---|
| S1 | **High** | Known default string is JWT fallback **and** settings master key | `config.js:33`, `settings-crypto.js:5` | Secrets / crypto |
| S2 | **High** | Password accepted in `x-step-up-password` header | `app.js:1372-1385` | Credential exposure |
| S3 | **High** | User-enumeration oracles (Google 403, reset 503) | `app.js:814,1015-1027` | Info disclosure |
| S4 | **High** | No Content-Security-Policy anywhere (repo-wide zero hits) | absent | XSS mitigation |
| S5 | **High** | JWT in response body alongside HttpOnly cookie | `app.js:418` et al. | Token leakage |
| S6 | **High** | Pay-many open-payment race (double settlement) | `006:15-16`, `routes.js:1616-1647` | Business/race |
| S7 | **Medium** | `fleet_*` metrics to school owner/itadmin | `app.js:1670+` | Tenant boundary |
| S8 | **Medium** | `adminOnly` bypasses custom-role masks on API keys/webhooks | `app.js:1299-1302` | AuthZ |
| S9 | **Medium** | OTP multi-tenant picker returns school names pre-auth | `app.js:585` | Info disclosure |
| S10 | **Medium** | itadmin can mint/reset peer itadmins | `people.admin:45,77,225` | Privilege escalation |
| S11 | **Medium** | TOTP secrets plaintext at rest | `app.js:1148`, `057` | Secrets at rest |
| S12 | **Medium** | 8-char length-only password policy | `app.js:967` et al. | Weak credentials |
| S13 | **Medium** | `fee_obligations.amount_cents` no `>=0` CHECK | `001:94` | Data integrity |
| S14 | **Medium** | `marks <= max_marks` not DB-enforced | `025:45-46` | Data integrity |
| S15 | **Medium** | Attendance unlimited overwrite, no lock | `routes.js:770-778` | Integrity/authorization |
| S16 | **Medium** | Family leave clobbers attendance without audit | `routes.js:3057-3069` | Integrity |
| S17 | **Medium** | 15+ id-only SQL without `tenant_id` | see §14 | Defense-in-depth |
| S18 | **Medium** | No absolute session ceiling (infinite renew) | `app.js:427-439` | Session |
| S19 | **Low** | CSRF compare not constant-time | `app.js:199` | Crypto hygiene |
| S20 | **Low** | CORS `credentials:false` + `*` default + stale comment | `app.js:65`, `config.js:39` | Config footgun |
| S21 | **Low** | HSTS opt-in via `FORCES_HTTPS` only | `app.js:872` | Transport |
| S22 | **Low** | Demo seed password `schoolos-demo` for every role | `scripts/seed.js:76` | Secrets |
| S23 | **Low** | Login CSRF unmitigated | `app.js:321` | CSRF |
| S24 | **Low** | Global rate limiter is in-process (per-replica) | `app.js:67-81` | DoS |
| S25 | **Info** | `server/.env` holds real 64-hex secrets on disk (gitignored, not committed) | `server/.env` | Ops hygiene — rotate |

### Explicitly checked and found sound
- **SQL injection:** parameterized queries house-wide. No string-concatenated SQL found.
- **XSS:** no raw-HTML injection paths (secret/scan gates); React escapes by default. CSP missing (S4) is the residual.
- **CSRF:** double-submit present for cookie auth; SameSite=Strict.
- **Path traversal:** `files.store` rejects `..` and absolute `storage_path` (`files.store/index.js:203-261`).
- **Command injection / SSRF:** webhook targets validated via `assertPublicWebhookUrl` (`_shared/webhook-target.js`).
- **File uploads:** `@fastify/multipart` with size limits; UUID disk names; tenant-scoped dirs.
- **Payment replay:** idempotency key + unique open-payment index (hole for pay-many — S6).
- **Audit tamper:** hash chain + INSERT-only grants for `schoolos_app`; tests forge-hash rejection.
- **Dependencies:** CI runs `npm audit --omit=dev --audit-level=high` for both packages. No known-vulnerable dependency claim made without verification.
- **Git history secret sweep:** **Not verified** (pattern scan of working tree only).

---

## 16. Database Audit

### Schema map (core)

| Domain | Tables | Notes |
|---|---|---|
| Tenancy | `app.tenants` | `config` JSONB holds setup |
| Identity | `app.users`, `app.roles`, `auth.*` | custom roles (063) |
| People | `students`, `guardians`, `enrollment_history`, `student_accounts`, `class_assignments` | |
| Structure | `classes`, `sections`, `subjects` | **migration 135 only** |
| Academic | `academic_years` | nullable `academic_year_id` on children |
| Attendance | `attendance` | UNIQUE(tenant, student, date) |
| Exams | `plugin_exams.exam/mark/report/moderation` | |
| Fees | `fee_obligations`, `payments`, `payment_allocations`, `payment_events`, `fee_receipts`, `fee_concessions`, `fee_installments`, `fee_dunning_log`, `fee_heads`, `fee_plan_templates`, `billing_runs`, `fee_settings` | richest domain |
| Library | `library.book/loan/copy/reservation/fine/acquisition_*` | |
| Transport | `routes`, `route_stops`, `transport_events`, `plugin_transport_gps.positions` | |
| Comms | `announcements`, `announcement_receipts`, `communications`, `outbox` | |
| Audit | `audit_log`, `audit_log_cold` | hash-chained |
| HR | `plugin_hr.leave`, `staff_appraisals` | no payroll |

### Database findings

| # | Sev | Finding | Location |
|---|---|---|---|
| D1 | **High** | `fee_obligations.amount_cents bigint NOT NULL` with **no** positivity CHECK (payments have `> 0`) | `001_init.sql:94` |
| D2 | **High** | `payments_one_open_per_obligation` partial unique treats NULL `obligation_id` as distinct → unlimited concurrent pay-many `initiated` rows | `006:15-16` |
| D3 | **High** | No constraint that `SUM(payment_allocations.amount_cents) == payments.amount_cents` | `109:147-166` |
| D4 | **High** | `fee_receipts` has `UNIQUE(tenant_id, receipt_no)` but **not** `UNIQUE(payment_id)` → duplicate receipts per payment | `109:195-206` |
| D5 | **High** | `plugin_exams.mark`: `CHECK (marks >= 0)` but no `CHECK (marks <= max_marks)` | `025:45-46` |
| D6 | **Medium** | No `updated_at` on core tables (`students`, `payments`, `fee_obligations`, `attendance`) | `001` throughout |
| D7 | **Medium** | Inconsistent soft-delete: `students.status` enum vs `users.active` vs `retired_at` vs `status='retired'` | multiple |
| D8 | **Medium** | `fee_obl_student_term_label_uidx` on `(tenant, student, term, label)` silently collides across different fee plans → second plan's dues never generate | `059:45-46`, `routes.js:1289-1293` |
| D9 | **Medium** | Destructive migrations in chain: `DROP TABLE fee_plans` (`109:330`), red-team `DELETE FROM app.payments` (`016:30`, `019:25`, `027:32`, `030:46`), duplicate purge (`059:36-44`) | migrations |
| D10 | **Medium** | `students.grade`/`section` free text vs `app.classes`/`sections` tables — no FK | `001:36-37` vs `135` |
| D11 | **Medium** | `students.bus_route text` — no FK, no capacity/permit CHECK | `001:40` |
| D12 | **Medium** | `academic_year_id` nullable on obligations/exams; not defaulted to current | `058:51-53` |
| D13 | **Medium** | N+1: attendance marks loop + **serial** audit inserts (hash chain forces serialization) | `routes.js:771-799` |
| D14 | **Low** | `library.loan.student_id` NOT NULL dropped with no CHECK pairing `borrower_type='student'` ↔ non-null | `108:153` |
| D15 | **Low** | `payments.status` includes dead value `'created'` | `001:110` |
| D16 | **Low** | Fee `overdue` is never materialized on obligations (always computed) while `fee_installments.status` has `'overdue'` that is never set | `001:96`, `109:271` |
| D17 | **Info** | 57 composite tenant FK conversions backfilled (`081`, `082`) — good historical repair | |

### "What happens when…?"

| Question | Answer |
|---|---|
| A record is deleted | App role has no table-level DELETE (D-35); deletes go through scoped helpers / status flips. Good. |
| A user changes role | Old sessions keep claims until expiry unless `session_epoch` bumps (it bumps on password change, **not** on role change — **Not verified** whether role change revokes). |
| A student moves class | `enrollment_history` row + `UPDATE students SET grade, section` — free-text values, no class FK. |
| A school closes an academic year | Flag flips. Nothing archived. Children keep nullable `academic_year_id`. |

---

## 17. Business Logic Audit

### Fees — verified behaviors

| Behavior | Verdict | Evidence |
|---|---|---|
| Duplicate payment prevention | PARTIAL | Idempotency key exists but **optional** (`routes.js:1583`); one-open index fails for pay-many |
| Partial payments | WORKING | bounded by settings `allow_parent_partial` / `min_partial_cents` (`routes.js:1622-1630`) |
| Money math | WORKING | `bigint` cents + `BigInt`; installments "no floats" (`fees/installments.js:6`) |
| Maker/checker on confirm | WORKING | clerk removed from confirm (`routes.js:1667-1669`) |
| Gateway provenance | WORKING | `payments_gateway_ref_req` CHECK; Razorpay/UPI order-log lookup; `MANUAL` sentinel audited differently |
| Refunds | MOSTLY WORKING | SoD + reason + not-the-settler; gateway-before-ledger (RTE-2); `refunded_cents` CHECK |
| Concessions | MOSTLY WORKING | reduction capped by unpaid; **owner bypasses requester≠approver**; null-obligation = silent no-op |
| Late fees | WORKING (better than first suspected) | `routes.js:1135-1145` filters `status NOT IN ('paid','void')` — late fees are **not** applied to paid rows. Status is not recomputed but the filter prevents the "paid with unpaid net" trap on this path. |
| Dunning | WORKING | `dedup_key` partial unique, quiet hours, shared selection logic |
| Receipts | MOSTLY WORKING | PDF artifact + composite FK to `files`; duplicate-per-payment possible |

**[CONFIRMED] CRITICAL — pay-many open-payment race**
- Location: `migrations/006_money_and_ledger_hardening.sql:15-16` + `server/src/routes.js:1616-1647`
- Evidence:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_open_per_obligation
  ON app.payments(tenant_id, obligation_id) WHERE status = 'initiated';
```
```js
const single = parts.length === 1 ? parts[0].id : null;
// … INSERT INTO app.payments (… obligation_id …) VALUES (…, single, …)
for (const part of parts) {
  const open = await c.query(`SELECT id FROM app.payments WHERE obligation_id=$1 AND status='initiated'`, [part.id]);
```
- Multi-obligation payments store `obligation_id = NULL` (links live in `payment_allocations`). Postgres treats NULLs as distinct in unique indexes → unlimited concurrent `initiated` pay-many rows. The in-app check reads `payments.obligation_id` **only**, never `payment_allocations`, so a second pay-many covering the same dues is invisible.
- Impact: two desk clerks/parents concurrently open payments against the same obligations; both confirm → `paid_cents` incremented twice. Overpay is then caught only by `CHECK (paid_cents <= net_amount_cents)` as a raw 23514 mid-transaction (rolls back after possible gateway work) — or, if partials stay under net, obligations settle faster than intended and receipts disagree with what the payer was told.
- Fix: enforce exclusivity via `payment_allocations` (status-aware partial unique), and make the in-app check join allocations.
- Confidence: high

**[CONFIRMED] `initiated` payments never expire** (`routes.js:1645`, metric at `app.js:1923` counts stale ones but no reaper). A forgotten initiation holds the one-open slot forever (single-obligation case).

### Attendance

**[CONFIRMED] HIGH — unlimited overwrite of any date**
- Location: `routes.js:770-778`
```js
INSERT INTO app.attendance (…) VALUES (…)
ON CONFLICT (tenant_id, student_id, school_date) DO UPDATE SET status=EXCLUDED.status, marked_by=EXCLUDED.marked_by, marked_at=now()
```
- No date window, no lock table, no term-close gate. A June register can be rewritten in September. Each change is audited per-student — good — but nothing prevents the change.
- Impact: exam-eligibility 75% floors (`exams.assessment/index.js:80-86`) and statutory attendance can be manipulated after the fact.
- Fix: date window ±N days, or `attendance.locks` with principal-only unlock.
- Confidence: high

**[CONFIRMED] HIGH — family leave approval silently clobbers the register**
- Location: `routes.js:3057-3069`
```sql
INSERT INTO app.attendance (…, status, …) VALUES (…,'leave',…)
ON CONFLICT (…) DO UPDATE SET status='leave', marked_by=EXCLUDED.marked_by
```
- Unconditional. A student marked `present` is flipped to `leave`. The executor writes `family.request_event` but **no `auditLog` row** for the attendance mutation.
- Fix: refuse when prior status exists and differs (or require principal override); audit the change.
- Confidence: high

**[CONFIRMED] MEDIUM — invalid leave dates silently skipped while request resolves**
- Location: `routes.js:3057-3062` — `if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) continue;`
- Impact: request can be marked resolved with 0 days actually marked.

Positive: teacher authority is bound to `class_assignments` / first-period slot, not name text (`routes.js:733-761`). Duplicate submit does not re-spam notices (RTE-16).

### Exams / grading

| Check | Verdict |
|---|---|
| Negative marks | DB-blocked (`marks >= 0`) + app-blocked |
| Marks > max | App-blocked only; **no DB CHECK**; CBSE R3 reports after the fact |
| Change after publish | App-level 409 on both entry doors (`exams.assessment/index.js:152,406`) — **no DB trigger** |
| Weightage | must sum 100, non-negative finite (`index.js:91-110`) |
| Grade bands | float `marks/max*100` (`index.js:58`) → boundary drift possible |
| Moderation | separate overlay, never touches marks (good) |
| Publication | behind approval spine with digests (good) |

### Library

- Double-issue of the same copy: **structurally impossible** (`108:197-198`).
- Holds FIFO with `FOR UPDATE` (`library/index.js:292-309`).
- Fine formula `min(cap, days×perDay)` with grace is correct and capped — but computed on **UTC** dates (`library/index.js:286-289`) and **only at return**. Unreturned books accrue no fine row.
- Fix: IST date math (`src/ist.js` exists) + optional daily accrual.

### Transport

- `students.bus_route` free text (`001:40`) matched by route `code` text. Capacity/permit columns exist (`001:124-125`) and are displayed but **never enforced on assign**.
- Rider counts in some queries include inactive students (`routes.js:2176`, `transport.gps/index.js:46`).
- Route rename does not rewrite `students.bus_route` (orphans riders).
- Delay > 10 min raises an approval-required parent notice (good).

### Academic lifecycle

- Promotion writes history + grade flip atomically; Grade 12 terminal guard; one-step-at-a-time (`people.admin:408-502`).
- Bulk promote has **no dry-run and no per-student exception list** (retention needs manual transfer).
- Withdrawal keeps attendance/fees/guardian links; clears bus (good).
- AY "rollover" is a flag only (`routes.js:1059-1070`) — audit copy claims "previous year archived" but nothing is archived.

### HR / payroll

**[MISSING] No payroll module.** No salary, wage, bonus, PF/ESI/TDS, payslip schema or routes (repo-wide search). What exists: leave marking (unique per staff-day, no half-day), leave requests + approval, staff appraisals (1..5). A real school's accountant cannot run payroll here.

---

## 18. Error Handling Audit

### Server
- Consistent `bad(reply, msg, code)` in `routes.js:28`; `moneyError()` with 16 structured codes in `error-codes.js`.
- `app.js` uses inline `reply.code(403).send({ error })` — two coexisting patterns.
- DB outage → 503 on readiness (`/ready`).
- `uuidParams` converts UUID cast 500s into clean 400s.
- Empty JSON body treated as `{}` (D3 fix).
- Audit ledger redacts OTPs/reset codes.

### Client
- `friendlyErrors.ts` rewrites only 7 known strings; most server copy passes through.
- `ErrorState` with `onRetry` used widely.
- `x-request-id` surfaced in error messages.
- Offline banner + sync queue count.

### Failure-condition matrix (tested where possible)

| Condition | Behavior | Verdict |
|---|---|---|
| 401 | clear session, redirect `/login?return=` | GOOD |
| 403 | error message shown | OK |
| 404 | `not found` (existence kept private on parent paths) | GOOD |
| 429 | message shown | OK |
| 500 | `ErrorState` / thrown message | OK but money-path 23514 can surface as untyped 500 (see §17) |
| Network fail | friendly message | GOOD |
| Timeout | friendly message | GOOD |
| Session expiry mid-form | **hard redirect loses in-memory form state** | POOR |
| Double-click submit | `busy` guard on major forms | GOOD |
| Backend down | cannot verify UI degradation live | **Not verified** |
| Malformed response | `body.error ?? 'HTTP n'` fallback | OK |

---

## 19. Performance Audit

**No load-test numbers were produced.** The following are code-level concerns.

| Concern | Location | Why |
|---|---|---|
| Attendance N upserts + N **serial** audit inserts | `routes.js:771-799` | A 300-student register issues ~300 upserts + 300 sequential `audit_append` calls (hash chain serializes). This is the bottleneck. |
| Unpaginated list endpoints | `/work-orders`, `/cases`, `/actions`, `/announcements`, `/audit`, `/payments` | 2,000-student school + multi-year history = large payloads |
| Fee confirm N updates per allocation | `routes.js:1775-1788` | acceptable for small N |
| Dunning / generation per-row inserts | `routes.js:1289-1310, 3522-3537` | batchable |
| `SELECT *` on students/cases/payments | `routes.js:622,2281,1677` | wide rows over the wire |
| In-process rate-limit store | `app.js:67-81` | N replicas = N× budget (account lockout is DB-backed — the important surface is fine) |
| Frontend: lazy routes via `F()`/`lazy()` | `App.tsx` | good |
| Scrypt at N=2^17 (~0.4s/hash) | `auth.js` | correct for security; login is intentionally slow |

---

## 20. Scalability Audit

| Dimension | Assessment |
|---|---|
| Multi-tenant DB | Sound: RLS + tenant_id + composite FKs. Single shared Postgres will need read replicas at larger fleet sizes. |
| 2,000-student school | Attendance marking and unpaginated lists are the first pain points. |
| Horizontal API | Possible (stateless JWT) but rate limiting becomes per-replica; session revocation is DB-backed (good). |
| Workers | Outbox pattern scales; per-process loops need leader election when replicated (**Not verified** that workers are single-instance safe). |
| File storage | Local disk (`server/storage/`) — no S3/object-store adapter. **Blocks multi-node API.** |
| Event budget | `governance.js` 60 events/min per plugin — bulk paths needed (timetable bulk door exists; library bulk import still OPEN per SIMULATION-FIXES D5). |
| Audit ledger | Append-only with hash chain; cold table archival exists (`067`) — good. |

---

## 21. Accessibility Audit

### Strong (verified in code)
- 632 `aria-*`/`role`/`tabIndex`/`onKeyDown` matches across screens/components.
- `useDialogFocus`: Tab trap, Escape, focus return (`ui.tsx:197-231`).
- `Modal`: `role="dialog" aria-modal="true"`.
- `Dropdown`: WAI-ARIA menu-button with arrow/Home/End.
- Login tabs: `role="tablist"` + roving tabindex.
- Skip link (`App.tsx:619`).
- `aria-invalid` + `aria-describedby` on form errors.
- Decorative dots/avatars `aria-hidden`.

### Barriers

| Barrier | Location | Impact |
|---|---|---|
| `window.confirm` on suspend/reset/move student | `PeopleAdmin.tsx:130,140,150` | Not announced properly, cannot be styled, blocks AT |
| `window.prompt` for step-up password | `liveApi.ts:91` | Same + password typing in native prompt |
| `window.alert` for keyboard shortcuts | `App.tsx:605` | Same |
| Color-only status badges | `ui.tsx:25-31`, `components.css:88+` | CVD users cannot distinguish Active/Suspended |
| Wide tables as primary UI | `table.data` | Screen-reader table navigation burden; no card fallback on desktop |
| No automated axe/contrast audit in CI | — | Contrast ratios **Not verified** |

**Score reflects: good primitives, undermined by native dialogs on high-stakes flows and color-only status.**

---

## 22. Mobile / Responsive Audit

### Verified in CSS
- Breakpoints: 768px (sidebar → `MobileTabbar`), 640px (grids → 1 col).
- Overflow safety: `min-width:0`, `overflow-x:clip`, `overflow-wrap:break-word` (`base.css:114-167`).
- Tables: `.table-wrap { overflow-x:auto }`.
- Role-aware bottom tabbar including a parent variant (`DemoBar.tsx:10-71`).
- Parent home is IST-first (deliberate India-first copy).

### Risks
1. `u-hide-mobile` **hides** columns/content under 768px rather than reflowing — if a screen relies on a hidden column for critical status, mobile users lose it. Per-screen coverage **Not verified**.
2. Modal footers not visibly sticky in CSS — long dialogs on 390px height may require scrolling to reach the primary action. **Not verified in browser.**
3. `window.prompt/confirm` on mobile browsers are particularly hostile (and `prompt` for passwords is a training hazard).
4. No `viewport` meta verification performed — assumed present via Vite template.

**Cannot issue a screenshot-based responsive verdict in this pass.** Code-level posture is good; live 390–1920px sweep is claimed in `factory-check.mjs` docs but that script's current behavior was **Not verified**.

---

## 23. UX Audit

### Coherence
The product has a real IA (Today → Attention → Ask → Action → Memory) and role-aware shells. Terminology is 80% consistent with visible drift ("Front desk"/"Reception", "Needs your attention"/"Attention", "Command center"/"Command Center").

### Could a non-technical administrator use it?
Partially. The onboarding wizard and PeopleAdmin are approachable. The fees desk is powerful but speaks in `amount_cents`, idempotency keys, and ledger terms in error copy — an accountant will not understand `PAYMENT_IN_PROGRESS` or `LEDGER_INCONSISTENT` without training.

### Could a teacher use it without training?
Yes for attendance/homework/marks. The exam publish/approval spine needs one walkthrough.

### Could a parent use it from a phone?
Yes — the parent plane is the most mobile-tuned surface (tabbar, IST-first, child-scoped flows). The native `window.prompt` step-up and any wide-table screens are the regressions.

### UX defects
| Finding | Location |
|---|---|
| Native confirm/prompt/alert on high-traffic paths | `PeopleAdmin.tsx`, `liveApi.ts:91`, `App.tsx:605` |
| Legacy `StudentHome`/`ParentHome` empty shells beside live v2 screens | `StudentHome.tsx`, `ParentHome.tsx` |
| Money error codes shown raw | `error-codes.js` + `friendlyErrors.ts` (only 7 rewrites) |
| "Edit draft" locked button with lock icon but no explanation of how to unlock | `Constitution.tsx:288` |
| Photo capture labeled demo — honest, but the feature is incomplete | `ReportIssue.tsx:174` |
| Campus concept still leaks in demo/UI (Phase B open, ~624 occurrences per `SIMULATION-FIXES` A3) | multiple |
| Empty states good (`Empty`) but success toasts/feedback consistency **Not verified** across 80 screens | — |

---

## 24. Code Quality Audit

### God files
- `server/src/routes.js` — **4,380 lines / 324KB** spanning students, attendance, school structure, academic years, all of fees, roles, custom roles, actions, cases, notices, documents, audit, plugins admin, migration console, BI. Imports 20+ modules (`routes.js:3-25`).
- `server/src/app.js` — **2,024 lines / 149KB** spanning auth, MFA, SSO, reset, switch, dataset, capabilities, plugins, API keys, webhooks, AI, workflow, metrics.
- `app/src/App.tsx` — ~696 lines with ~90 routes and guards.

### Coupling
Kernel imports from `plugins/_shared/*` (`routes.js:9-11`, `app.js:8-22`) — the plugin architecture is partially cosmetic; a plugin cannot be removed without touching kernel files.

### Duplication / inconsistency
- Two error helpers (`bad()` vs inline).
- Dual guardian models (fixed at write time; still two tables).
- Dual class homes (JSON config vs `app.classes`).
- Two student/parent home screens (legacy + v2).
- zod declared but unused.

### Dead code / debt markers
Unusually clean: almost no `TODO`/`FIXME`/`HACK`. Known debt is tracked in prose docs (`SIMULATION-FIXES.md` OPEN items: campus Phase B, library bulk import, substitution handover packet L6).

### Type safety
Frontend: TS with `tsc -b` clean; 134 `any`/`@ts-ignore`/`eslint-disable` matches (many in tests). Backend: plain JS, no runtime schema validation.

### Maintainability verdict
The domain logic itself is often excellent (fees, library, auth). The **shape** will hurt: `routes.js` guarantees merge conflicts and makes isolated testing nearly impossible. Plugin `_shared` leakage will block true plugin extraction.

---

## 25. Testing Audit

### Inventory
| Area | Files | Depth |
|---|---|---|
| Auth/session/MFA/throttle | ~10 | Deep — negative tests, anti-enumeration, lockout, revocation |
| RBAC / custom roles / ACL | ~9 | Deep — privilege escalation blocks, column-scoped grants |
| Multi-tenant / RLS | ~5 | Deep — cross-tenant probes, FORCE verification |
| Payments / fees | ~8 | Deep — refund SoD, HMAC webhooks, reconciliation, dunning |
| Exams | ~5 | Deep — lifecycle, freeze, board policy |
| Audit ledger | ~2 | Deep — hash chain, forgery rejection |
| Migrations | ~3 | Deep — drift, advisory lock |
| Ops/backup/DR | ~5 | Deep — real pg_dump→restore→DPDP replay |
| Plugins | ~6 | Moderate-deep |
| **Frontend** | **6 files / 17 tests** | **Thin** — unit + import smoke only |
| **E2E browser** | **0 in CI** | `tests-rt/` is manual red-team scripts; puppeteer-core present but unused |

### Test quality
Real Postgres, real migrations, real RLS, real `app.inject()` HTTP. Not mock-heavy. Security boundary assertions exist (`security.test.js`, `acl-column-scope`, `rls-boundary`, `backup-restore-drill`).

### CRITICAL — the suite does not complete

**[CONFIRMED]** Running `cd server && npm test` (133 files, `--test-concurrency=1`) produces a flood of:
```
✖ tests/<file>.test.js
  'Promise resolution is still pending but the event loop has already resolved'
```
across dozens of files (student-world, students-lifecycle, tally, teacher-*, timetable-*, totp-replay, transport-write, udise-export, upi, verification-artifact, visitors, wave-*, webhook-preauth, …). The run does not produce a trustworthy aggregate.

**But individual files pass:**
- `tests/api.test.js` → **11/11 pass** in isolation.
- `tests/l2-multi-tenant.test.js` alone → 4 pass, then the same 'Promise resolution is still pending' hang.

`docs/VERIFICATION.md` claims **959 pass / 0 fail** generated 2026-09-22 from a green run. **That claim is not reproducible on this tree today.** The dirty working tree (23 modified files including tests) is one plausible cause; leaked `pg.Client` handles are another (the codebase itself warns about this pattern in `tests/exams.test.js:24-27`).

**Impact:** CI's suite gate is unreliable. Critical regressions (including the money races in §17) can merge behind a red-but-ignored or hung suite.

**Fix:** (1) make every test file use `try/finally` client cleanup or a shared pool with teardown; (2) run each test file in a subprocess and aggregate; (3) add a connection-leak detector in `helpers.js`; (4) regenerate `VERIFICATION.md` only from a clean, committed tree.

### Coverage gaps
- No dedicated `attendance.test.js` (covered incidentally).
- No frontend integration/API round-trip tests.
- No load tests.
- No contract tests against OpenAPI.
- No browser E2E in CI.

### Gates that DO work
- `permission-matrix.js` — fails on any unguarded route.
- `parity-gate.js --enforce` — fails on mock-plane imports and orphan write doors.
- `secret-scan.mjs` — fail-closed in CI.
- `npm audit --audit-level=high` for server + app.

---

## 26. Deployment & Production Audit

| Area | Status | Evidence |
|---|---|---|
| Dockerfile | GOOD | digest-pinned `node:26-alpine`, multi-stage, `USER node`, HEALTHCHECK `/ready` |
| Compose | GOOD | 8 services, healthchecks, `depends_on: service_healthy`, secrets `${JWT_SECRET:?}` fail-closed |
| CI | GOOD | 4 jobs (server, web, compose-smoke, security); no `|| true`; digest-pinned PG18 |
| Config guards | GOOD | prod refuses localhost DATABASE_URL, `CORS_ORIGINS=*`, missing `PLUGIN_SETTINGS_KEY`, weak `JWT_SECRET` |
| Migrations | PARTIAL | forward-only, advisory lock, checksum drift detection, **no rollback** |
| Logging | PARTIAL | pino JSON; OTP/reset redaction; phone masked to last-4; no shipper |
| Error tracking | **MISSING** | zero Sentry/Datadog/OTel/Bugsnag matches |
| Health checks | GOOD | `/health`, `/ready`, `/metrics`, cron health-probe 02:45 IST |
| Backups | GOOD | `backup.sh` + AES offsite + PITR compose + monthly restore drill |
| Disaster recovery | PARTIAL | drill exists; PITR "configured, not exercised end-to-end" (honest `ops/backup/README.md`) |
| Secrets on disk | PARTIAL | `server/.env` real 64-hex secrets, gitignored — **rotate** |
| Seed safety | PARTIAL | `SEED_GUARD` exists; demo password `schoolos-demo` for all seed users |
| Multi-node | **BLOCKED** | local-disk file storage; in-process rate limit |
| Rollback story | **MISSING** | no down migrations; restore-from-backup is the only path |

**"Can this survive production?"** — Single-node, carefully configured, with backups: yes for a pilot. Multi-node or unattended: no (file storage, rate-limit store, no APM, no rollback).

---

## 27. Real-World School Simulation

**Scenario:** 1 principal · 5 admins · 80 teachers · 2,000 students · 1,500 parents · 40 support staff · 20 classes × 3 sections · 4 fee structures · 3 academic years.

| Workflow | Expected behavior (from code) | Risk at this scale |
|---|---|---|
| Morning attendance, 40 sections × 40 students | 40 requests × ~40 upserts + 40 serial audits each | Slow; audit chain serializes; 08:15 rush will feel it |
| Fee day, 1,500 parents + desk | Pay-many race (S6) can double-charge under concurrency | **Money loss / angry parents** |
| Exam marks entry, 80 teachers | Freeze at publish holds; no `marks<=max` DB check | Out-of-range marks enterable via import/SQL |
| Report cards | CBSE pack + digests | Float grade boundary complaints |
| Library period | One-open-per-copy holds | Fine disputes around IST midnight (UTC math) |
| Bus routes | No capacity enforcement | 45 kids assigned to a 40-seat permitted bus — invisible until RTO check |
| Year rollover | Flag flip | Mis-filed fees against wrong `academic_year_id` (nullable, not defaulted) |
| Teacher resigns mid-term | `active=false` | Probable: `class_assignments` stay active |
| 2 admins edit one student | Last write wins (`PATCH` has no version/If-Match) | Silent overwrite |
| Webhook arrives twice | Idempotency key if set; UPI/Razorpay HMAC + order log | OK if client sends keys; race if not |
| Internet drops mid-submit | Offline banner + queue count; no auto-retry in `call()` | User must resubmit manually; double-submit risk on doors without idempotency keys |
| Unauthorized user guesses `/students/<uuid>` | 404 via RLS | OK (RLS holds) |
| 200 concurrent logins | scrypt ~0.4s each → CPU bound | DoS-ish on shared node; rate limit 20/min/IP helps |
| DB query goes slow | `/ready` flips 503 when DB unreachable | OK for outage; no slow-query observability |
| Parent changes phone | PeopleAdmin edit | OTP login identity changes; old OTPs invalidated by vault design |
| Payment succeeds, webhook twice | order_log + payment status short-circuit on confirm | Mostly OK; `created` dead status is noise |
| Marks changed after publish | App refuses (409) | Direct SQL can still change them (no trigger) |

**Abnormal situations the product does NOT model:** payroll run, statutory PF/ESI/TDS, half-day leave, student retention (repeat year) as a first-class action, multi-campus (deliberately removed — one site = one tenant).

---

## 28. Confirmed Bugs

*(Evidence that it behaves incorrectly.)*

| ID | Bug | Location | Impact |
|---|---|---|---|
| CB-1 | Pay-many payments bypass one-open-per-obligation → concurrent double settlement | `006:15-16`, `routes.js:1616-1647` | Duplicate collection of the same dues |
| CB-2 | Full test suite hangs/fails with `'Promise resolution is still pending'`; `VERIFICATION.md` overclaims green | `npm test` (observed 2026-09-23) | CI gate unreliable |
| CB-3 | Family leave approval overwrites any attendance status with `'leave'` and writes no audit row | `routes.js:3057-3069` | Silent register corruption |
| CB-4 | Attendance can be rewritten for any past/future date without limit | `routes.js:770-778` | Falsifiable attendance/eligibility |
| CB-5 | `fee_receipts` allows multiple receipts per payment | `109:195-206` | Receipt-book integrity break |
| CB-6 | Concession/waiver changes do not recompute `fee_obligations.status` (late-fee path is protected by `status NOT IN ('paid','void')` filter) | `routes.js:2122-2129` | Dunning/reports can disagree with ledger |
| CB-7 | Concession with `obligation_id = NULL` approves as a silent no-op | `routes.js:2121` | "Approved" money reduction that never applies |
| CB-8 | Owner bypasses concession requester≠approver SoD | `routes.js:2112` | Self-approved fee relief |
| CB-9 | `(student, term, label)` unique collides across different fee plans → second plan's dues silently skipped | `059:45-46`, `routes.js:1289-1293` | School under-bills with no error |
| CB-10 | `initiated` payments never expire; `created` status is dead | `routes.js:1645`, `001:110` | One-open slot held forever |
| CB-11 | Google SSO callback echoes the email in a 403 | `app.js:814` | Account enumeration |
| CB-12 | Password-reset returns 503 (known email, no rail) vs 200 (unknown email) | `app.js:1015-1027` | Account enumeration |
| CB-13 | `/metrics` emits `schoolos_fleet_*` (ALL tenants) to school owner/itadmin | `app.js:1670-1889` | Cross-tenant intel |
| CB-14 | `adminOnly` ignores custom-role DENY on `/api-keys` and `/webhooks` | `app.js:1299-1302` | Stated denies silently inert |
| CB-15 | Step-up accepts raw password in `x-step-up-password` header | `app.js:1372-1385` | Passwords in proxy/APM logs |
| CB-16 | JWT returned in JSON body as well as HttpOnly cookie | `app.js:418` et al. | Token theft via response logging/XSS |
| CB-17 | Rider counts include inactive students | `routes.js:2176`, `transport.gps/index.js:46` | Wrong bus load figures |
| CB-18 | Family-leave dates with invalid format are silently skipped (`continue`) while still resolving the request | `routes.js:3057-3062` | Request marked resolved with 0 days marked |

---

## 29. Probable Bugs

*(Strong evidence, full reproduction not completed.)*

| ID | Bug | Location | Why probable |
|---|---|---|---|
| PB-1 | Suspending a teacher does not deactivate `app.class_assignments` | `people.admin/index.js:195-218` vs `routes.js:747-749` | Ownership check filters `assignments.active` but nothing clears it on suspend; the check does not join `users.active` |
| PB-2 | Confirm can trip `CHECK (paid_cents <= net_amount_cents)` mid-tx after gateway capture exists (untyped 500 on money path) | `routes.js:1758-1779` | Obligations not re-locked before `paid_cents + $2` update; combined with CB-1 |
| PB-3 | Gateway refund succeeds then a later statement throws → tx rollback leaves gateway refunded, ledger unrefunded | `routes.js:3377` (gateway call inside tx) | Ordering avoids this for *refusal* (3378) but not post-success failure |
| PB-4 | Grade boundary mis-banding from float `marks/max*100` | `exams.assessment/index.js:58`, `_shared/exam-report.js:16-23` | Classic binary float boundary (`9/10*100`) |
| PB-5 | Receipt number generator breaks on all-alpha receipt numbers or int overflow | `routes.js:1750-1757` `regexp_replace(...)::int` | `::int` cast |
| PB-6 | Multi-replica workers may double-process outbox rows | `scripts/outbox-worker.js` | Claim/lease pattern exists for comms (`099_comms_claim_leases.sql`) but coverage across all workers **Not verified** |
| PB-7 | Role change does not revoke existing sessions (only password change bumps `session_epoch`) | `app.js:214-220` | No epoch bump found on role assign path |
| PB-8 | `net_amount_cents` definition differs across migrations (`109:92-93` generated column vs `129` late-fee-inclusive) | `109` vs `129` | Two definitions; replay/migration-order dependent |

---

## 30. Security Vulnerabilities

Consolidated list with severity — see §15 table S1–S25. Highest priority:

1. **S1** Default secret fallback (JWT + settings AES master key) — `config.js:33`, `settings-crypto.js:5`
2. **S6** Pay-many payment race — `routes.js:1616-1647`
3. **S2** Password-in-header step-up — `app.js:1372-1385`
4. **S3** User enumeration oracles — `app.js:814`, `app.js:1015-1027`
5. **S4** No Content-Security-Policy
6. **S5** JWT in response bodies
7. **S7** Cross-tenant `fleet_*` metrics
8. **S8** `adminOnly` mask bypass
9. **S10** itadmin peer minting
10. **S11** TOTP secrets at rest in plaintext

---

## 31. Missing Features

### Genuinely necessary for a real school
| Missing | Why |
|---|---|
| **Payroll / salary / statutory (PF, ESI, TDS) / payslips** | Accountant cannot run the month. Currently zero schema/routes. |
| **Attendance lock / close-of-day** | Statutory + exam-eligibility integrity |
| **Student retention (repeat year) as a first-class action** | Every school has repeaters; today it's a manual transfer hack |
| **Email verification of the owner at signup** | Account squatting / lockout |
| **Invitation links for staff/parents** | Temp passwords by side channel are operationally unsafe |
| **Migration rollback or documented rollback runbook** | A bad migration is currently restore-from-backup only |
| **Error tracking / alerting (Sentry-class)** | Production errors go to stdout and die |
| **Global search API** | Cmd+K palette is client-side only |
| **Server-side pagination everywhere** | 2,000-student school will hit this in term 1 |

### Useful
- Duplicate-submission/idempotency keys on all write doors (not just payments)
- Soft-delete standardization (`deleted_at` or one `is_live` convention)
- `updated_at` on core tables
- Object storage adapter for files (unblocks multi-node)
- Half-day leave
- Optimistic concurrency (If-Match/version) on user/student edits
- Full OpenAPI for the whole surface
- Automated axe + contrast CI job
- Browser E2E in CI
- Absolute session lifetime ceiling

### Optional
- Barcode/ISBN library tooling (already flagged advanced-tier in `FEATURES-STATUS.md`)
- Reading lists / e-resources
- Richer BI dashboards
- Multi-campus (deliberately out of scope — one site = one tenant)

### Future enhancements
- Live LLM tier behind the AI gateway (budgets/approval gates already exist)
- Plugin marketplace (T0–T4 trust ladder is documented)
- Native mobile apps
- Parent web push / WhatsApp interactive flows beyond the rails

---

## 32. Technical Debt

| Debt | Location | Cost |
|---|---|---|
| `routes.js` 4,380-line god file | `server/src/routes.js` | Merge conflicts, untestable units |
| `app.js` 2,024-line composition of unrelated concerns | `server/src/app.js` | Same |
| Kernel ↔ `plugins/_shared` coupling | `routes.js:9-11`, `app.js:8-22` | Blocks true plugin extraction |
| zod declared, unused at boundary | `server/package.json` | Inconsistent validation |
| Two error envelopes | `error-codes.js` vs `bad()` | Client complexity |
| Dual guardian models | `app.guardians` + `family.child_link` | Drift risk (write-time fix landed) |
| Dual class homes (JSON + tables) | `tenants.config.setup.sections` vs `app.classes` | Rename breaks rosters |
| Free-text `students.grade`/`section`/`bus_route` | `001:36-40` | No referential integrity |
| Dead `payments.status='created'` | `001:110` | Confusion |
| Inconsistent soft-delete conventions | multiple | Every query must remember the liveness predicate |
| No `updated_at` on core tables | `001` | Cache/sync/audit without ledger |
| Destructive red-team DELETEs inside migration chain | `016`, `019`, `027`, `030` | Replay hazard |
| Campus concept residue in demo/UI (~624 occurrences) | `SIMULATION-FIXES` A3 | Confusing for one-site schools |
| Legacy `StudentHome`/`ParentHome` shells beside v2 | `app/src/screens` | Nav confusion |
| `window.confirm/prompt/alert` | `PeopleAdmin`, `liveApi`, `App` | A11y + mobile |
| Frontend test desert (17 tests / 44.5k LOC) | `app/src` | Regressions merge freely |
| No down migrations | `server/migrations` | Restore-only recovery |
| Local-disk file storage | `server/storage/` | Blocks horizontal scale |
| In-process rate limit | `app.js:67-81` | Per-replica budgets |
| Dirty working tree with unreviewed transport/exam changes | `git status` | Audited tree ≠ released tree |

---

## 33. Ratings by Category

| # | Category | Score | Justification |
|---|---|---|---|
| 1 | Architecture | **7** | Real kernel/plugin split, outbox spine, dual-pool RLS substrate. Deducted for god files and kernel↔`_shared` coupling that undermines the plugin claim. |
| 2 | Code quality | **6** | Domain logic (fees/library/auth) is high quality and well commented. `routes.js`/`app.js` shape and dual error patterns drag it down. Almost no TODO/FIXME litter. |
| 3 | Frontend quality | **6** | Good primitives (Empty/ErrorState/Skeleton/SampleNote), honest demo labeling, memory-only tokens. Deducted for native dialogs, legacy shells, thin error-code mapping. |
| 4 | Backend quality | **7** | Careful money math, SoD, approval spine, audit on mutations. Deducted for races (CB-1), dead status, missing expiry. |
| 5 | Database design | **6** | RLS+FORCE, composite tenant FKs, hash-chained audit, generated net column. Deducted for missing CHECKs (amount, marks<=max), no `updated_at`, free-text FKs, NULL-holed unique index, destructive migrations. |
| 6 | Authentication | **8** | scrypt N=2^17 + rehash, jti+epoch revocation, lockouts that close enumeration, TOTP replay guards, atomic recovery codes. Deducted for header-password step-up, body tokens, no session ceiling, plaintext TOTP seeds. |
| 7 | Authorization | **7** | Deny-wins masks, anti-amplification, step-up on role assign, structural parent-child binding. Deducted for `adminOnly` bypass, itadmin peer minting, inline `/onboard/school` check. |
| 8 | Multi-tenancy | **7** | RLS+FORCE fail-closed, composite FKs, tenant-scoped files, 409 multi-tenant picker. Deducted for `fleet_*` leak and 15+ id-only queries (defense-in-depth gaps). |
| 9 | Security | **6.5** | Strong program (threat model, red-team ledger, secret-scan, npm audit, CSP-less but React-escaped). Deducted hard for default-secret fallback, enumeration oracles, no CSP, password-in-header, payment race. |
| 10 | API quality | **6** | 402 routes, 0 unguarded, request IDs, rate limits. Deducted for missing pagination, inconsistent errors, mixed REST/RPC, fees-only OpenAPI. |
| 11 | Validation | **5** | Manual validation on dangerous paths is decent; zod unused; missing DB CHECKs; length-only passwords; uneven field caps. |
| 12 | Error handling | **6** | Structured money codes, friendlyErrors, ErrorState+retry, redacted secrets. Deducted for untyped 500s on money 23514, hard redirect losing form state, only 7 friendly rewrites. |
| 13 | Performance | **5.5** | Integer math, lazy routes, some batching. Attendance N+1 + serial audit chain and unpaginated lists are real bottlenecks at school scale. No measured benchmarks. |
| 14 | Scalability | **5** | Stateless API + outbox is a good shape, but local-disk files, in-process rate limit, and single-node assumptions block horizontal scale. |
| 15 | Reliability | **5** | Backups+drill excellent; suite currently untrustworthy; payment races; no absolute session bound; no APM. |
| 16 | Accessibility | **6** | 632 a11y attributes, focus traps, ARIA menus/tabs, skip link. Native confirm/prompt/alert and color-only badges are real barriers. |
| 17 | UX | **6** | Coherent IA, honest empty/demo states, parent mobile focus. Money jargon, terminology drift, locked mystery buttons, campus residue. |
| 18 | Mobile responsiveness | **6.5** | Deliberate overflow safety, tabbar, breakpoints. `u-hide-mobile` content loss and unverified modal footers at 390px. |
| 19 | Product completeness | **6** | Most school planes exist and are wired to real APIs. Payroll, retention, invitations, email verification, global search missing. |
| 20 | School workflow completeness | **5.5** | Day-to-day (attendance, fees, exams, library, transport, admissions) is real. Payroll absent, attendance unlocked, AY rollover shallow, retention unsupported. |
| 21 | Data integrity | **5** | Many good constraints (paid<=net, gateway_ref on confirm, one-open-per-copy, idempotency). Undercut by CB-1 race, missing CHECKs, duplicate receipts, silent skips, free-text FKs. |
| 22 | Testing | **5** | Depth on security boundaries is genuinely good (real DB, negative tests, restore drills). Undercut by a suite that currently does not complete, 17 frontend tests, zero CI E2E. |
| 23 | Documentation | **7.5** | Exceptional honesty (`PERFECT-100.md` grades itself 53/100; `STILL NOT GOOD_*`; `SIMULATION-FIXES`). Deducted for stale README counts ("25/25 tests") and drifting hand-written figures. |
| 24 | Deployment readiness | **6.5** | Digest-pinned Docker, fail-closed compose secrets, 4-job CI, prod config guards, backup drill. No rollback, no APM, local disk files, rotate `.env`. |
| 25 | Observability | **5** | `/health`, `/ready`, Prometheus `/metrics`, cron health-probe, PII-masked pino. No APM/error tracking/alerting pipeline; `fleet_` metrics on the wrong door. |
| 26 | Maintainability | **5.5** | Clean debt markers, strong test helpers, clear module comments. God files + kernel/plugin coupling + dual models will slow every future change. |
| 27 | Business logic correctness | **6** | Money SoD, refund ordering, library copy law, promotion history are right. Attendance law is wrong; pay-many race is wrong; fee-plan uniqueness is wrong; payroll absent. |

**Raw mean: 6.07 → Weighted overall: 6.0**

---

## 34. Overall Assessment

SchoolOS is a **seriously engineered platform with a partially complete school product on top**.

The bottom half of the stack (auth, tenancy, audit, plugin registry, CI gates, backups) is better than most production SaaS in this category. The team writes threat models, pins red-team findings with regression tests, and grades itself *down* when audits go deeper. That culture is the single best predictor of long-term quality.

The top half still has defects a school bursar would hit in week one: a payment race that can double-collect dues, an attendance register that can be rewritten after the fact (and silently clobbered by a leave approval), a fee-plan generator that can silently skip a plan's dues, and no payroll at all. On top of that, the test suite — the thing that is supposed to catch exactly these — currently does not complete on this tree while a generated artifact claims 959/959 green.

**6.0/10** reflects: excellent bones, real domains, honest process — minus money-path races, integrity holes, and an untrustworthy gate.

---

## 35. Top Strengths

1. scrypt N=2^17 + legacy rehash + `timingSafeEqual` + `dummyVerify` timing equalization.
2. RLS ENABLE+FORCE with fail-closed GUC and composite tenant FKs (after 081/082).
3. Deny-wins custom-role masks shared across kernel and plugins, with an anti-amplification ceiling.
4. Permission-matrix + UI↔door parity gates enforced in CI (0 unguarded routes).
5. Hash-chained append-only audit ledger with forgery-rejection tests.
6. Integer-cents money discipline end to end.
7. Library one-open-per-copy structural uniqueness.
8. Real backup + restore + DPDP-erasure drill (not a checkbox).
9. Honest UI labeling (`SampleNote`) and demo/live separation enforced by tooling.
10. Self-critical documentation culture (`PERFECT-100.md`, `STILL NOT GOOD_*`, `SIMULATION-FIXES.md`).

---

## 36. Top Problems

1. Pay-many payment race (CB-1 / S6).
2. Suite does not complete; `VERIFICATION.md` overclaims (CB-2).
3. Default secret fallback for JWT + settings AES key (S1).
4. Step-up password-in-header (S2 / CB-15).
5. User-enumeration oracles (S3 / CB-11, CB-12).
6. No Content-Security-Policy (S4).
7. JWT in response bodies (S5 / CB-16).
8. Attendance unlimited rewrite (CB-4) + family-leave clobber (CB-3).
9. Cross-tenant `fleet_*` metrics (S7 / CB-13).
10. `adminOnly` custom-role bypass on API keys/webhooks (S8 / CB-14).
11. Missing DB CHECKs: `amount_cents >= 0`, `marks <= max_marks` (S13, S14).
12. Duplicate receipts per payment (CB-5 / D4).
13. Fee-plan generation silent skip via unique collision (CB-9 / D8).
14. `initiated` payments never expire (CB-10).
15. No payroll module.
16. `bus_route` free text, no capacity enforcement (D11).
17. AY rollover is a flag only; nullable `academic_year_id` (D12).
18. itadmin peer minting (S10).
19. Frontend test desert + no CI E2E.
20. `routes.js` god file + kernel↔plugin coupling.

---

## 37. Critical Risks

| Risk | Scenario | Blast radius |
|---|---|---|
| Double fee collection | Two clerks hit Pay on the same multi-obligation dues | Financial loss, parent trust, audit findings |
| Default-secret boot | Any env that is not literally `NODE_ENV=production` | Total auth forgery + decrypt of all sealed plugin credentials |
| Attendance falsification | Marks rewritten after term close to protect exam eligibility | Exam fraud, statutory non-compliance |
| Credential-in-logs | Step-up password captured by proxy/APM | Account takeover of privileged roles |
| Cross-tenant intel | School IT admin reads fleet metrics | Competitive/privacy exposure across schools |
| Untrustworthy gate | Green artifact while suite hangs | Any of the above can ship unnoticed |

---

## 38. P0 Fixes

Critical — security vulnerabilities, data loss, tenant isolation failures, authentication bypasses, catastrophic business logic problems.

| ID | Issue | Impact | Location | Recommended fix | Complexity | Dependencies | Priority |
|---|---|---|---|---|---|---|---|
| P0-1 | Pay-many open-payment race | Double collection of the same dues | `006:15-16`, `routes.js:1616-1647` | Enforce exclusivity via `payment_allocations` (partial unique on open allocations per obligation); make the in-app check join allocations; make `Idempotency-Key` **required** on pay-many | Medium | None | P0 |
| P0-2 | Default secret fallback (JWT + settings AES key) | Auth forgery + offline decrypt of sealed plugin credentials | `config.js:33`, `settings-crypto.js:5` | Remove fallbacks; refuse boot without explicit `JWT_SECRET` and distinct `PLUGIN_SETTINGS_KEY` in every env except `ALLOW_DEV_DEFAULTS=1` | Low | None | P0 |
| P0-3 | Suite does not complete / `VERIFICATION.md` overclaims | All regressions ship | `server/tests/*`, `scripts/verification-artifact.js` | Fix client leaks (try/finally or shared pool); run files in subprocesses and aggregate; refuse to write the artifact from a dirty tree | Medium | None | P0 |
| P0-4 | Password in `x-step-up-password` header | Credential leak via proxy/APM logs | `app.js:1372-1385` | Body-only step-up; delete the header path | Low | None | P0 |
| P0-5 | User-enumeration oracles | Account harvesting | `app.js:814`, `app.js:1015-1027` | Uniform 200/401 shapes and messages on Google callback + reset | Low | None | P0 |
| P0-6 | Attendance unlimited rewrite + family-leave clobber | Falsifiable attendance / exam eligibility | `routes.js:770-778`, `3057-3069` | Date window + `attendance.locks` (principal unlock); leave approval refuses conflicting status and always `auditLog`s the mutation | Medium | None | P0 |
| P0-7 | Missing money/mark CHECKs | Impossible states | `001:94`, `025:45-46` | `CHECK (amount_cents >= 0)` and `CHECK (marks <= max_marks)`; backfill/repair first | Low | None | P0 |
| P0-8 | Cross-tenant `fleet_*` metrics | Platform-scope intel to school IT admins | `app.js:1670-1889` | Split `GET /metrics` (tenant) vs operator-only door/listener for `fleet_*` | Low | None | P0 |

> **Fix status — verified against the tree and fixed (2026-09-23):**
> - **P0-1 FIXED** — `migrations/138` adds `payment_allocations.open` + partial unique
>   `payment_alloc_one_open_per_obligation`; the pay-many check now reads allocations, an
>   `Idempotency-Key` is required for pay-many, and allocations close on confirm. Pinned by
>   `tests/fees-perfect-100.test.js`.
> - **P0-4 FIXED** — the `x-step-up-password` header is disabled in production (the 5-minute step-up
>   token is the production proof); dev/test keep it. `tests/custom-roles.test.js` green.
> - **P0-5 FIXED** — the Google callback no longer echoes the probed email.
> - **P0-6 FIXED** — attendance is windowed (teacher: 7 days; office: 90 days / future allowed) and a
>   family-leave approval no longer clobbers a conflicting register row (it skips, audits, and reports
>   `conflicts`). Pinned by `ist-dates` / `dat6-attendance-audit` / `parent-family`.
> - **P0-7 FIXED** — `migrations/137` adds `fee_obligations.amount_cents >= 0`,
>   `payments.amount_cents/refunded_cents >= 0`, `plugin_exams.mark.marks <= max_marks`.
> - **P0-8 FIXED** — the `fleet_*` gauges are emitted only when `METRICS_FLEET_TOKEN` is set and the
>   scrape presents a matching `x-fleet-token`; otherwise only tenant-scoped gauges are served. Pinned
>   by `tests/ops-deploy.test.js`.
> - **P0-2 already mitigated** — production refuses a missing `JWT_SECRET`/`PLUGIN_SETTINGS_KEY`
>   (`config.js:113,:22`); the fallback is dev/test-only by design.
> - **P0-3 not applicable as written** — the lane forbids git commands, so the artifact cannot test
>   for a dirty tree; the "suite does not complete" half still needs reproduction.

---

## 39. P1 Fixes

High — major workflow failures, serious authorization issues, important reliability problems.

| ID | Issue | Impact | Location | Recommended fix | Complexity | Dependencies | Priority |
|---|---|---|---|---|---|---|---|
| P1-1 | `adminOnly` bypasses custom-role masks | Stated DENYs silently inert on `/api-keys`/`/webhooks`; amplification ceiling hole | `app.js:1299-1302` | Route through shared `require()`/`requireRole()` | Low | None | P1 |
| P1-2 | Duplicate receipts per payment | Receipt-book integrity | `109:195-206` | `UNIQUE (tenant_id, payment_id)` (partial where `voided_at IS NULL` if voids re-issue) | Low | None | P1 |
| P1-3 | Fee-plan generation silent skip via unique collision | School under-bills with no error | `059:45-46`, `routes.js:1289-1293` | Include `fee_head_id`/`billing_run_id`/`source_ref` in the uniqueness key; surface skipped count in UI | Medium | None | P1 |
| P1-4 | `initiated` payments never expire | One-open slot held forever | `routes.js:1645`, `app.js:1923` | Reaper worker → `failed` after N hours | Low | P0-1 | P1 |
| P1-5 | No payroll module | Accountant cannot run the month | absent | Design + implement payroll (salary structures, attendance/leave inputs, payslips, statutory PF/ESI/TDS, exports) | **High** | None | P1 |
| P1-6 | `bus_route` free text, no capacity/permit enforcement | Oversubscription vs RTO permit invisible | `001:40`, `routes.js:656`, `transport.gps` | `route_id` FK + assignment endpoint enforcing `count < LEAST(capacity, permit_capacity)` | Medium | None | P1 |
| P1-7 | itadmin can mint/reset peer itadmins | Persistent backdoor accounts | `people.admin/index.js:45,77,225` | Require owner (or owner notify + step-up) for itadmin-peer mutations | Low | None | P1 |
| P1-8 | TOTP secrets plaintext at rest | Second-factor bypass on DB/backup leak | `app.js:1148`, `057` | Envelope-encrypt like plugin settings | Low | P0-2 | P1 |
| P1-9 | JWT returned in response bodies | Token theft via response logging/XSS | `app.js:418` et al. | Stop returning tokens to browser clients | Low | None | P1 |
| P1-10 | No Content-Security-Policy | XSS unmitigated | absent | Strict CSP (`default-src 'self'`, nonce scripts, `object-src 'none'`, `frame-ancestors 'none'`) | Medium | None | P1 |
| P1-11 | Suspending a teacher may leave `class_assignments` active | Suspended staff retain attendance authority | `people.admin:195-218`, `routes.js:747-749` | Deactivate assignments on suspend; join `users.active` in the ownership check | Low | None | P1 |
| P1-12 | Role change does not revoke sessions | Stale elevated claims | `app.js:214-220` | Bump `session_epoch` on role assign/unassign | Low | None | P1 |
| P1-13 | Confirm can 23514 mid-tx after gateway capture | Untyped 500 on money path | `routes.js:1758-1779` | Lock obligations in stable order before any mutation; re-check `net-paid` inside the UPDATE `WHERE` | Medium | P0-1 | P1 |
| P1-14 | AY rollover is flag-only; `academic_year_id` nullable | Mis-filed fees/exams across years | `routes.js:1059-1070`, `058:51-53` | Default `academic_year_id` to current; make NOT NULL after backfill; define real rollover (archive/lock) | Medium | None | P1 |
| P1-15 | No error tracking / alerting | Production errors die in stdout | absent | Add Sentry-class + log shipping + alert rules on `/metrics` gauges | Medium | None | P1 |

---

## 40. P2 Fixes

Medium — important bugs and significant UX/performance issues.

| ID | Issue | Impact | Location | Recommended fix | Complexity | Dependencies | Priority |
|---|---|---|---|---|---|---|---|
| P2-1 | 15+ id-only SQL without `tenant_id` | Defense-in-depth gap | see §14 table | Add `AND tenant_id=$2` on every id-keyed query | Medium | None | P2 |
| P2-2 | Concession null-obligation no-op + owner self-approve | Silent no-op money; SoD hole | `routes.js:2112,2121` | Refuse null-obligation concessions (or apply to a chosen obligation); remove owner SoD bypass | Low | None | P2 |
| P2-3 | Password policy length-only | Weak credentials | `app.js:967` et al. | 12+ chars + breach blocklist (k-anonymity) | Low | None | P2 |
| P2-4 | No absolute session ceiling | Stolen cookie lives forever | `app.js:427-439` | Cap rolling renewals (e.g. 12h absolute) | Low | None | P2 |
| P2-5 | Attendance N+1 + serial audit | Slow 300-student registers | `routes.js:771-799` | Single `INSERT … unnest`; bulk `audit_append` | Medium | None | P2 |
| P2-6 | Unpaginated list endpoints | Slow at 2k-student scale | `/work-orders`,`/cases`,`/actions`,`/announcements`,`/audit`,`/payments` | Use `pageParams` everywhere | Medium | None | P2 |
| P2-7 | `window.confirm/prompt/alert` | A11y + mobile hostility | `PeopleAdmin.tsx:130,140,150`, `liveApi.ts:91`, `App.tsx:605` | Replace with accessible Modal components | Low | None | P2 |
| P2-8 | Color-only status badges | CVD users cannot distinguish | `ui.tsx:25-31` | Add text/icon redundancy | Low | None | P2 |
| P2-9 | Library fines on UTC days, only at return | Fine disputes; understated outstanding | `library/index.js:286-289` | IST date math (`src/ist.js`); optional daily accrual | Medium | None | P2 |
| P2-10 | Grade float boundary drift | Mis-banded report cards | `exams.assessment/index.js:58` | Integer hundredths (`marks*10000/max`) | Low | None | P2 |
| P2-11 | Email verification of owner at signup | Account squatting/lockout | `onboarding.js:53-121` | Magic-link/OTP proof before owner session is usable | Medium | None | P2 |
| P2-12 | Invitation links for staff/parents | Unsafe temp-password side channel | absent | Signed single-use invite links | Medium | P2-11 | P2 |
| P2-13 | Student retention (repeat year) first-class | Manual transfer hack | `people.admin:408-502` | Add retain action + bulk promote dry-run/exceptions | Medium | None | P2 |
| P2-14 | Dual class homes + free-text grade/section | Rename breaks rosters | `001:36-37`, `135` | FK `students(tenant_id, class_id, section_id)`; treat grade/section as cached | Medium | None | P2 |
| P2-15 | No `updated_at` on core tables | Cache/sync/audit without ledger | `001` | Add `updated_at` + trigger | Low | None | P2 |
| P2-16 | Inconsistent soft-delete | Query liveness-predicate bugs | multiple | One convention (`deleted_at` or `is_live`) | Medium | None | P2 |
| P2-17 | `GET /cases` `SELECT *` to wide staff set | Safeguarding data over-exposed | `routes.js:2281-2288` | Column projection + role-based field masking | Medium | None | P2 |
| P2-18 | Frontend test desert + no CI E2E | UI regressions merge freely | `app/src` | Top-20 screen render tests + Playwright smoke in CI | High | None | P2 |
| P2-19 | `routes.js` god file | Merge conflicts, untestable | `server/src/routes.js` | Extract domain modules (students, attendance, fees, roles, plugins-admin, migration) | High | None | P2 |
| P2-20 | Kernel ↔ `plugins/_shared` coupling | Blocks plugin extraction | `routes.js:9-11`, `app.js:8-22` | Promote `_shared` utilities to kernel | Medium | None | P2 |
| P2-21 | Object storage adapter for files | Blocks multi-node | `server/storage/`, `files.store` | S3/MinIO adapter | Medium | None | P2 |
| P2-22 | Migration rollback runbook | Restore-only recovery | `server/scripts/migrate.js` | Document + test a rollback procedure; add down-migrations for destructive changes | Medium | None | P2 |
| P2-23 | Full OpenAPI for the surface | Client/integration friction | `src/fees/openapi.js` only | Generate global OpenAPI | Medium | None | P2 |
| P2-24 | CSRF compare not constant-time; login CSRF | Hygiene | `app.js:199,321` | `timingSafeEqual`; Origin check on login | Low | None | P2 |
| P2-25 | Global search API | Cmd+K is client-only | absent | Server search with role-scoped results | Medium | None | P2 |
| P2-26 | Money error codes shown raw | Accountant confusion | `error-codes.js`, `friendlyErrors.ts` | Map all 16 codes to plain-language copy | Low | None | P2 |
| P2-27 | Optimistic concurrency on edits | Silent last-write-wins | `PATCH /students` etc. | `If-Match`/version column | Medium | P2-15 | P2 |
| P2-28 | Campus concept residue (~624 occurrences) | Confusing for one-site schools | `SIMULATION-FIXES` A3 Phase B | Sweep demo/UI as already scoped | Medium | None | P2 |
| P2-29 | Half-day leave | Real schools need it | `029:37`, `hr.leave` | Extend leave schema + UI | Low | None | P2 |
| P2-30 | `net_amount_cents` definition drift across migrations | Replay/migration-order dependent | `109:92-93` vs `129` | Reconcile to one generated definition | Low | None | P2 |

---

## 41. P3 Fixes

Low — polish and lower-impact improvements.

| ID | Issue | Impact | Location | Recommended fix | Complexity | Priority |
|---|---|---|---|---|---|---|
| P3-1 | Terminology drift ("Front desk"/"Reception" etc.) | Cognitive load | `Shell.tsx`, `DemoBar.tsx` | One glossary | Low | P3 |
| P3-2 | Legacy `StudentHome`/`ParentHome` shells beside v2 | Nav confusion | `app/src/screens` | Remove or redirect | Low | P3 |
| P3-3 | Dead `payments.status='created'` | Confusion | `001:110` | Drop or use | Low | P3 |
| P3-4 | `fee_installments.status='overdue'` never set | Dead enum value | `109:271` | Materialize or drop | Low | P3 |
| P3-5 | Rider counts include inactive students | Wrong bus figures | `routes.js:2176` | Filter `s.status='active'` | Low | P3 |
| P3-6 | CORS stale comment / `credentials:false` footgun | Config trap | `app.js:65` | Update comment; document split-origin token path | Low | P3 |
| P3-7 | HSTS only via `FORCES_HTTPS` | Transport | `app.js:872` | Send HSTS on HTTPS always | Low | P3 |
| P3-8 | Demo seed password `schoolos-demo` | Weak seed creds | `scripts/seed.js:76` | Randomize + print once | Low | P3 |
| P3-9 | README stale counts ("25/25 tests") | Misleading | `README.md` | Point at generated artifacts | Low | P3 |
| P3-10 | Receipt number `::int` cast fragility | Edge-case break | `routes.js:1750-1757` | Numeric sequence or bigint | Low | P3 |
| P3-11 | `window.alert` keyboard-help | A11y polish | `App.tsx:605` | Accessible help dialog | Low | P3 |
| P3-12 | "Edit draft" locked with no unlock explanation | UX | `Constitution.tsx:288` | Tooltip + path to unlock | Low | P3 |
| P3-13 | Destructive red-team DELETEs in migration chain | Replay hazard | `016`,`019`,`027`,`030` | Move out of chain | Low | P3 |
| P3-14 | `library.loan.student_id` nullable without CHECK | Orphanable | `108:153` | `CHECK (borrower_type <> 'student' OR student_id IS NOT NULL)` | Low | P3 |
| P3-15 | In-process rate limit | Per-replica budgets | `app.js:67-81` | Shared store (Redis) | Low | P3 |
| P3-16 | MFA challenge JWT not jti-revoked | 5-min residual | `app.js:463,1205-1209` | Register + check consumed_at at the door | Low | P3 |
| P3-17 | `/me/tenants` school-name disclosure | Privacy edge | `app.js:906-913` | Opaque hints until step-up | Low | P3 |
| P3-18 | OTP picker returns school names pre-auth | Privacy edge | `app.js:585` | Require factor proof before listing names | Low | P3 |
| P3-19 | Login CSRF | Session fixation edge | `app.js:321` | Origin check | Low | P3 |
| P3-20 | zod unused at boundary | Inconsistent validation | `server/package.json` | Adopt zod schemas per door | Medium | P3 |

---

## 42. Top 10 Recommended Changes

Chosen for **impact on security, correctness, reliability, UX, maintainability, production readiness** — not for ease.

1. **Close the pay-many open-payment race** (P0-1) — real money can be double-collected today.
2. **Kill the default secret fallbacks** (P0-2) — one unset env var is total compromise.
3. **Make the test suite a trustworthy gate** (P0-3) — without this, nothing else stays fixed.
4. **Remove the password-in-header step-up path** (P0-4) — credentials in logs are an account-takeover pipeline.
5. **Lock attendance + fix the family-leave clobber** (P0-6) — attendance is statutory and drives exam eligibility.
6. **Close the user-enumeration oracles** (P0-5) + **add a CSP** (P1-10) — the two cheapest large security wins on the auth/XSS edge.
7. **Add the missing money/mark DB CHECKs** (P0-7) + **unique receipt per payment** (P1-2) — make impossible states impossible at rest.
8. **Split tenant vs fleet metrics** (P0-8) + **fix `adminOnly`** (P1-1) — restore the tenancy/RBAC story the product claims.
9. **Build payroll** (P1-5) — the single largest product hole for a real school's month-end.
10. **Extract `routes.js` into domain modules** (P2-19) + **promote `plugins/_shared` to kernel** (P2-20) — unblock every future change safely.

---

## 43. Long-Term Improvements

| Horizon | Improvement | Why |
|---|---|---|
| Next quarter | Full OpenAPI + contract tests; browser E2E in CI; axe/contrast CI | Lock the API and UI contracts |
| Next quarter | Object storage adapter + shared rate-limit store + worker leader election | Unlock multi-node / HA |
| Next quarter | Real APM/error tracking + alert rules on the existing `/metrics` gauges | Operate rather than hope |
| 2 quarters | Payroll + statutory compliance (PF/ESI/TDS) + payslip exports | Become the school's system of record for staff money |
| 2 quarters | Real academic-year rollover (lock, archive, promote pipeline with dry-run) | Survive year 2 without manual archaeology |
| 2 quarters | Soft-delete standard + `updated_at` + optimistic concurrency | Sync/export/cache correctness |
| 2+ quarters | Live LLM tier behind the existing AI gateway (budgets/approval gates already exist) | Deliver on the AI-native claim without new risk surface |
| 2+ quarters | Plugin marketplace on the documented T0–T4 trust ladder | Platform economics |
| Ongoing | Keep the self-critical documentation culture (`PERFECT-100`, `STILL NOT GOOD`, `SIMULATION-FIXES`) | It is the best asset in the repo |

---

## 44. Final Conclusion

SchoolOS is **the most seriously engineered school platform in its class that this audit has seen with an honest self-assessment culture** — and it is still **not safe to put a real school's fees and children's attendance on today**.

What is real: authentication that would pass a fintech review; tenancy built on Postgres RLS with FORCE and composite tenant FKs; an append-only hash-chained audit ledger; deny-wins RBAC with an anti-amplification ceiling; a permission matrix and UI↔door parity gate enforced in CI; integer-cents money discipline; a library domain where double-issue is structurally impossible; backups with a restore + DPDP-erasure drill that is actually exercised.

What is wrong: a payment race that can book the same dues twice; an attendance register that can be rewritten months later and silently clobbered by a leave approval; a fee-plan generator that can skip an entire plan's dues with no error; default secret fallbacks that turn one unset environment variable into total compromise; passwords accepted in headers; enumeration oracles on the auth edge; no CSP; platform metrics leaking across tenants; and — most damning for a project with this much test depth — a full suite that currently does not complete while a generated artifact claims 959/959 green.

**Overall Score: 6.0 / 10**
**Production Readiness: PRODUCTION WITH MAJOR RISKS**

Fix the eight P0 items, land payroll (P1-5), and make the suite a gate again. Do that, and this becomes a 7.5–8 product that a real school can run. Do not, and the first fee day with two clerks at the desk will write the postmortem for you.

---

*End of audit. Findings are evidence-based and location-specific. Items marked `Not verified` were explicitly not confirmed. No application source code was modified during this audit.*
