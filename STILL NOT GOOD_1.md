# STILL NOT GOOD_1

## Enterprise Project Audit

Audit Date: 2026-09-09 (UTC)
Repository: /home/cassandra/schoolOS (SchoolOS — "AI-native operating system for schools", India-first multi-tenant SIS + operations platform)
Current Commit/Branch: `main` @ `da7c585f77550862e7599b656b4afe649e2aedb8` ("docs: HANDOFF.md — full codebase handoff for an incoming agent")

Current Overall Grade: **58 / 100** (Functional but substantial gaps)
Enterprise Readiness Grade: **31 / 100** (Major parts missing — NOT enterprise-ready)

Implementation Estimate (by capability count across the full feature inventory, §4):

| Status | Share | Reading |
|---|---|---|
| Fully Implemented | ~8% | Auth kernel, tenancy/RLS core, audit ledger, plugin lifecycle switchboard, people admin, visitor desk, file store, outbox/comms queue machinery |
| Mostly Implemented | ~10% | Payments rails (real REST, manual settlement), approvals spine, work orders, onboarding, HR leave, admissions funnel, DPDP pack |
| Partially Implemented | ~22% | Exams/assessment, library, timetable, health clinic, transport, parent/student portals, coordinator lane, teacher classroom |
| Minimally Implemented | ~10% | Migration console, rails board surfaces, CBSE pack, data health, AI governance screens (real data behind them is thin) |
| Not Implemented | ~28% | Academic years/terms, gradebook at scale, fee invoicing engine, exports/imports beyond CSV roster, reporting/BI, notifications beyond in-app log, backups/DR, MFA, i18n, platform billing, real messaging/AI/GPS vendors |
| Broken | ~4% | Store boot-capture bug (Action Center / case & WO detail / bell dead in every session); ReportIssue permanent hang; Copilot & FamilyHome crash-with-data; demo-anchored crashes on empty worlds; razorpay RLS gap |
| Mocked / Fake | ~16% | The entire `/dataset` demo world rendered by ~30 screens; fake AI with fabricated telemetry; fake attendance/fee/workflow writes in the mock service layer; simulated GPS; logger-only messaging |
| Uncertain | ~2% | (flagged inline where evidence was insufficient) |

> The percentages are honest counts over the ~130-capability inventory in §4, weighted by user-visible importance. The headline: **the platform kernel is real and unusually well engineered for a project of this kind; the school product riding on top of it is still, to a first approximation, a demo.**

---

## 0. Executive summary (read this first)

SchoolOS is two products in one repository, and the gap between them is the entire story of this audit:

1. **A genuinely solid multi-tenant kernel** (~15k lines): Fastify 5 + Postgres 18, transaction-scoped RLS tenancy (`SET LOCAL ROLE schoolos_app` + `set_config('schoolos.tenant_id', …)`, `server/src/db.js:48-64`), scrypt password hashing at hardened cost with timing equalization (`server/src/auth.js`), JWT with mandatory `jti` and a server-side revocation denylist (`server/src/app.js:41-56`), phone-OTP and Google SSO flows with enumeration defenses, an append-only hash-chained audit ledger (`server/migrations/006_money_and_ledger_hardening.sql:27-56`, `server/src/audit.js`), a plugin registry with lifecycle gates and a drain protocol (`server/src/routes.js:561-658`, `server/src/plugins/_shared/lifecycle-gate.js`), self-serve tenant onboarding in a single transaction (`server/src/onboarding.js`), a transactional outbox with retries/backoff, and a permission-matrix CI gate that fails on any unguarded route (`server/scripts/permission-matrix.js`, `.github/workflows/ci.yml`). This layer is better than most real products at this stage.

2. **A demo-world school product** wearing that kernel as a costume. The 62-screen UI renders overwhelmingly from `GET /dataset` (`server/src/dataset.js`) — a deterministic, function-stripped esbuild bundle of the *former frontend mock*, served to every authenticated user. ~30 screens read that blob directly; 25 screens import a mock service layer (`app/src/services/index.ts`) whose writes are no-ops (`attendanceService.mark`, `feeService.recordRetry`, `maintenanceService` in-memory store, a regex-canned "AI" that fabricates model/latency/token/cost telemetry). The server *does* implement real doors for attendance marking, fees, work orders and more — the flagship screens simply do not call them. A school that signed up today could mark attendance, record homework, run the visitor desk, provision users and store files against real Postgres tables; but attendance marks, fees, learning, insights, cases, documents, reception, HR, audit visualization, AI governance and the entire Maintenance (13-screen flagship) surface that the demos show off are **demo theater for anyone except the subset of flows wired to live doors**.

There is no AI anywhere (server code says so in its own comments: "deterministic template v0 — no model involved", `server/src/plugins/teacher.copilot/index.js:485`). There is no real messaging by default (logger provider; a generic-HTTP adapter exists but no Meta/BSP or TRAI/DLT integration). The UPI "payment link" is constructed as `upi://pay?pa=schoolos@<StudentFirstName>` (`server/src/plugins/payments.upi/index.js`) — money could never reach the school. Razorpay order creation is real, but webhooks record "facts only" and settlement stays a manual staff confirm whose "webhook verified" label is decided by a client-supplied string matching `/^[A-Z0-9-]{10,}$/` (`server/src/routes.js:214-241`).

**Bottom line:** this is a high-quality **kernel + reference demo**, roughly at "MVP backbone with demo flesh" stage. It is not a production SIS. It is not enterprise-ready. The chapters below substantiate every one of these sentences with file-and-line evidence, role by role, flow by flow. An independent 32-agent audit with adversarial skeptic passes (`docs/AUDIT-FULL-2026-09-10.md`, cross-checked in §26) measured the seam numerically and agrees: **of 204 server doors, only ~37% have a reachable UI caller, ~47% are orphaned API-only capability, ~11% are mock-only decoys.**

---

## 1. What was audited and how

- Full read of the kernel: `server/src/{app,routes,db,auth,audit,governance,plugin-catalog,onboarding,config,dataset}.js`, plugin loader and shared helpers.
- All 53 migrations (`server/migrations/001…053`) with a table-by-table RLS/grants sweep (automated diff of `CREATE TABLE` vs `ENABLE ROW LEVEL SECURITY` statements, then manual verification of every exception).
- All 26 plugins in `server/src/plugins/*` (doors, roles, persistence, external effects).
- Frontend: router and guards (`app/src/App.tsx`), kernel mirror (`app/src/plugins/useKernel.tsx`), state (`app/src/state/store.tsx`), the full service layer (`liveApi`, `index.ts` mock services, `adminApi/coordApi/parentApi/studentApi`, `teacherFixtures.ts`), and the data-source classification of all ~80 routes.
- Workers and scripts: `outbox-worker`, `comms-dispatcher`, `retention-worker`, `seed`, `bootstrap`, `migrate`, `schoolDay`, `permission-matrix`, `check`, plus `scripts/factory-check.mjs`, `secret-scan.mjs`.
- Infrastructure: `server/Dockerfile`, `server/docker-compose.yml`, `.github/workflows/ci.yml`, `server/.env` / `.env.example` (secrets redacted, presence noted).
- Tests: `server/tests/*.test.js` (29 files) inventory and quality assessment; frontend test story; CI enforcement.
- Documentation: `README.md`, `HANDOFF.md`, `docs/01…12` claims cross-checked against code.
- Six parallel deep-dive audits (security/authz; backend/domain; frontend/UX; database; tests/ops; docs-vs-reality) whose findings were integrated and spot-verified against the code before inclusion.

No project files were modified. No servers or test suites were executed against production data; all evidence is from static inspection plus repository logs of prior runs.

---

## 2. Architecture as found (ground truth, not the docs' version)

```
Browser (React 19 + Vite SPA, app/)
 ├── AuthGate: cold-open GET /me validation (App.tsx:312-351) — good
 ├── KernelProvider: mirrors /plugins registry into localStorage (useKernel.tsx:44-96)
 ├── DATA PLANE (the split that defines this product):
 │    ├── REAL doors  → services/liveApi.ts + adminApi/coordApi/parentApi/studentApi
 │    │                 (~20 screens: Login, Onboard, Plugins, PeopleAdmin, LibraryLive,
 │    │                  RailsBoard, VisitorsBoard, FunnelBoard, coord/*, parent/*,
 │    │                  student/StudentHome2, PrintQueue, WellbeingQueue, Noticeboard)
 │    ├── FIXTURE-FIRST → services/teacherFixtures.ts (TeacherOS: live door probe,
 │    │                  404 → typed fixture fallback, honest 'source' stamps)
 │    └── DEMO BLOB    → data/dataset.ts over GET /dataset + services/index.ts mock
 │                      writers (~30 screens incl. Attendance, Fees, Today, People,
 │                      Learning, Insights, Cases, Documents, Reception, Maintenance*)
 └── No offline implementation: SyncBanner's "sync" clears a counter (App.tsx:157-176,
      store.tsx:146-147) — nothing is queued or replayed.

API (Fastify 5, server/src)                                Postgres 18 (RLS)
 ├── authenticate: JWT + jti denylist + live user re-read   ├── app.*      22 tables (001 loop)
 ├── withUser(): tx + tenant/role GUC + SET LOCAL ROLE      ├── teacher/student/parent/family/
 │   schoolos_app  (db.js:48-64)                            │   library/ops/curriculum/mastery/
 ├── routes.js: kernel domain doors                         │   coord/duty/safety/support/...
 ├── onboarding.js: self-serve tenant signup                ├── plugin_*   rails + packs
 ├── plugins loader: 26 modules, lifecycle-gated            ├── auth.revoked_token, app.auth_otps
 └── /dataset: generated demo world (VM-evaluated bundle)   └── app.audit_log (append-only, hash chain)

Workers: outbox relay (SKIP LOCKED, backoff, park),
         comms dispatcher (rails → logger/http-generic), retention (one-shot purge)
```

### 2.1 The two-worlds problem (the single biggest architectural weakness)

`GET /dataset` (`server/src/app.js:271-314`) serves one shared, deterministic demo dataset (Meridian International Academy: ~1,000 students, fees, timetable, leads, incidents, 13 maintenance screens' worth of assets) to **every authenticated user of every tenant**. For non-`meridian` tenants the server rewrites the blob to an "empty world" that keeps the tenant's own name/campuses but zeroes all domain arrays. The code comments are candid that this is a product decision ("only this demo backdrop is shared"). The consequences:

- Every demo-blob screen is *hardwired to a world that no real tenant has*. For a self-signup school these screens render empty states — correct behavior shipped by brute force (commit `ade496b`, `ea2157b`, `b86d6fa` each fixed crashes where screens dereferenced demo anchors on the empty world).
- **Cross-tenant demo-data exposure is real but bounded**: tenant B's users can read tenant A's *fictional* children (names, fee status, bus routes) if tenant B is still slug-`meridian`-adjacent… in practice only the seeded demo tenant receives the full blob; every other tenant gets the empty world. The residual exposure: any authenticated user of the demo tenant sees the full synthetic PII corpus, and the *shape* guarantees that a future per-tenant dataset would leak without per-tenant scoping. Grade: P2 finding with a structural root cause.
- Screens that must be *live* for a school to operate (attendance register, fees, learning/gradebook, cases, documents, reception, HR, the 13 maintenance screens) read this blob and write to in-memory mock services. The real doors exist server-side and are tested — the UI never calls them. **This is why the product looks finished in demos and is not finished in reality.**

### 2.2 What the kernel actually gets right (credit where due)

This list matters because it defines the foundation worth keeping:

- **Tenancy**: every tenant path runs in a transaction as a non-bypassing role with tenant GUC; `FORCE ROW LEVEL SECURITY` on core tables; `app.tenants` itself RLS-pinned (049); `schema_migrations` denied to the app role (`USING (false)`); OTP vault denied to the app role entirely.
- **AuthN**: scrypt N=2^17 with legacy-cost fallback + rehash; timing-equalized unknown-user path (`dummyVerify`); uniform OTP failure copy (no enumeration oracle); OTP stored hashed, consumed single-use, attempts-capped; Google SSO with server-side single-use state (10-min TTL), `email_verified` enforcement, no auto-provisioning; student sessions short-TTL; logout revokes `jti` server-side and asks the browser to `Clear-Site-Data`; `force_change` stamped on temp passwords.
- **AuthZ machinery**: uniform `require(...roles)` guards; a CI-enforced permission matrix that fails on any unguarded route (`permission-matrix.js` + `ci.yml`); lifecycle gates that 409 every plugin door when the module is disabled, regardless of the loader having mounted it.
- **Audit**: append-only ledger (UPDATE/DELETE revoked from app role), `audit_append()` SECURITY DEFINER that recomputes `prev` server-side and rejects stale `prev_hash` (006:27-56), advisory-lock serialization, plugin-provenance stamping via `requestAudit` (`actorRole: "plugin:<id>"`).
- **Money hygiene**: money as bigint cents, `FOR UPDATE` on obligations/payments, double-spend refusal via open-attempt checks, webhooks HMAC'd over **raw bytes** with replay dedupe on `UNIQUE (tenant_id, event_id)`, freshness windows, boot-time refusal to run a money rail without a webhook secret, and the invariant that webhooks never settle — staff confirm is the only settlement.
- **Ops**: `/ready` (503 unless DB answers) vs `/health`; Prometheus text `/metrics` with persisted monotonic counters; Dockerfile with non-root user + HEALTHCHECK; compose with outbox + comms workers and a one-shot retention pass; outbox retries with exponential backoff and parking.

---

## 3. Implementation-status rollup by major module

| Module | Status | Score /10 | One-line verdict (evidence in §4–§12) |
|---|---|---|---|
| AuthN (password/OTP/SSO/logout) | Mostly Implemented | 8 | Strong mechanics; no MFA, no password-reset-by-email (none exists), `force_change` never enforced |
| Multi-tenancy & RLS | Mostly Implemented | 8 | Core pinned; ~6 plugin planes shipped naked then patched (049); `plugin_razorpay.*`/`plugin_upi.webhook_log` still without RLS |
| RBAC / permission model | Mostly Implemented | 7 | 12 roles, uniform guards, CI matrix; coarse role-only checks, no per-class/subject resource scoping anywhere |
| People administration | Fully Implemented | 8.5 | Provision/suspend/reset/transfer/CSV import with per-row SAVEPOINTs; owner role structurally unprovisionable |
| Attendance (server) | Mostly Implemented | 7 | Real upsert + absence comms; **any teacher marks any student in the school** (no class-assignment table); UI uses a mock |
| Attendance (UI) | Mocked / Fake | 2 | `attendanceService.mark` returns `ok()` and touches nothing (services/index.ts:71-74) |
| Fees & payments | Partially Implemented | 5.5 | Real ledger, double-spend guards, real Razorpay orders; manual settlement with self-labeling "webhook verified"; **no fee invoice generation engine**; UPI links are fake |
| Approvals / action spine | Mostly Implemented | 7 | Segregation-of-duties enforced; proposer field unreliable for kernel-raised actions (self-approval guard can't fire) |
| Work orders / maintenance | Partially Implemented | 6 | Real state machine + SLA + events (server); the 13-screen Maintenance flagship is entirely demo-blob + mock service |
| Cases / incidents | Partially Implemented | 5 | Real cases table + parent scoping (`/my-cases`); Incidents/Reception screens are demo-blob |
| Exams & assessment | Partially Implemented | 5 | Marks entry with publish-lock + digest + approval-gated publication; no gradebook, no report cards UI beyond plugin, marks locked forever after publish |
| Library | Mostly Implemented | 7 | Real loans/overdue/return with guards |
| Visitor desk | Fully Implemented | 8 | Check-in/out, pickup OTP in RLS-denied vault, plate/gate pass flows |
| HR & leave | Mostly Implemented | 6.5 | Office-files-leave model (no self-service teacher leave), roster by date |
| Health clinic | Partially Implemented | 6 | Visits + sick pass with pickup OTP; no inventory, no consent surface |
| Transport | Partially Implemented | 4.5 | Routes/events/approval-guarded notices real; **GPS "vendor feed" is a sine-wave simulator** (transport.gps/index.js:91-102) |
| Admissions funnel | Mostly Implemented | 7 | Real leads + stage history + funnel board UI; no application forms/documents/fees tracking |
| Teacher classroom (homework) | Mostly Implemented | 7 | Real homework + submissions doors, frozen contracts, fixture-first UI |
| Teacher copilot / parent assistant / "AI" | Mocked / Fake | 2 | Deterministic keyword templates; zero model calls; frontend fabricates telemetry (services/index.ts:113-149) |
| DPDP pack | Partially Implemented | 5 | Consent ledger + SAR with approval; retention worker covers 4 kernel tables only; per-plugin purge promised, unimplemented |
| CBSE pack | Minimally Implemented | 4 | Calendar + publication rules; thin |
| Migration console | Minimally Implemented | 3 | "Connect source" rows + stage advance + a trust-receipt computed from zeros; **no importer exists** |
| Communications | Partially Implemented | 4.5 | Queue + dispatcher + DLT-style template registry; **logger-only delivery by default**, no real BSP/SMS vendor |
| Notifications | Partially Implemented | 4 | In-app only, global rows (`user_id IS NULL`) visible to everyone; **the UI bell reads seed data, not /notifications** (Shell.tsx:315) |
| Files store | Fully Implemented | 8 | Off-web-path storage, uuid names, ext+mime agreement, sha256, audited fail-closed downloads |
| Audit ledger & Memory | Mostly Implemented | 7.5 | Hash chain server-verified; `created_at` is caller-supplied (ordering caveat §8.5) |
| Onboarding & school profile | Fully Implemented | 8 | Single-tx signup, catalog seeding, checklist |
| Parent portal | Partially Implemented | 6 | Real child-scoped doors (family.view); ParentHome/ParentChat/ParentFees screens still demo-blob |
| Student portal | Partially Implemented | 5.5 | Real student.world doors; **identity = name match** (student.world/index.js:105-110) |
| Coordinator lane | Mostly Implemented | 7 | Real coord.view doors across 6 screens |
| Analytics / Insights | Mocked / Fake | 2.5 | Computed client-side over the demo blob; server has no reporting engine |
| Data health / AiGovernance / AiUsage / Constitution | Mocked / Fake | 2 | Screens render dataset fiction; server-side equivalents are budgets/breakers only |
| Platform billing / entitlements | Not Implemented | 1 | `entitlement` jsonb exists; nothing enforces plans |
| Internationalization | Not Implemented | 1 | English-only, hardcoded strings; ₹/en-IN formatting only |
| Backups / DR | Not Implemented | 0 | No pg_backup, no restore docs, no RPO/RTO anywhere |

---

## 4. Master feature inventory (what the system actually supports)

Statuses use the audit scale. Evidence is representative, not exhaustive; every claim was verified in code.

### 4.1 Identity, tenancy & access

| # | Feature | Roles | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|
| F-01 | Email+password login | all | Secure sign-in, audited | Works; audited; rate-limited 20/min; multi-tenant email → 409 with school count | FULLY IMPLEMENTED | app.js:72-98 |
| F-02 | Phone OTP login | all | OTP → session | Hashed CSPRNG code, single-use, attempts-capped, uniform failure copy; **delivery requires SMS_PROVIDER (none integrated) — dev echo only** | MOSTLY IMPLEMENTED (delivery missing) | app.js:110-154 |
| F-03 | Google SSO | all | OAuth code flow | Real code+state flow, server-side single-use state, email_verified enforced, **no auto-provisioning** (account must pre-exist); dev simulator gated | FULLY IMPLEMENTED (for pre-provisioned users) | app.js:156-213 |
| F-04 | Session revocation | all | Logout kills session server-side | jti denylist + live user re-read + Clear-Site-Data | FULLY IMPLEMENTED | app.js:233-245 |
| F-05 | `force_change` temp-password flow | staff | User must change temp password at first login | Flag is **stamped and displayed but never checked** at login or by the client — temp passwords remain valid indefinitely | **BROKEN (policy claim vs behavior)** | people.admin/index.js (stamp), grep: no consumer anywhere |
| F-06 | Self-serve school signup | owner | Tenant + first owner, empty world | Single transaction, catalog seeding, kill-switch, 3/min, audited | FULLY IMPLEMENTED | onboarding.js:52-129 |
| F-07 | User provisioning (11 roles) | owner/itadmin | Create staff/parents/students w/ temp password | Validated, owner-role forbidden, temp shown once, optional child-link | FULLY IMPLEMENTED | people.admin/index.js |
| F-08 | Suspend / reactivate | owner/itadmin | Immediate access loss | `active=false` + live re-read on every request | FULLY IMPLEMENTED | people.admin + app.js:50 |
| F-09 | Password reset by admin | owner/itadmin | Temp password issued | Works; owner protected | FULLY IMPLEMENTED | people.admin |
| F-10 | Self password reset (email) | all | "Forgot password" | **NOT IMPLEMENTED** — no email sender exists anywhere | NOT IMPLEMENTED | repo-wide grep: no mailer |
| F-11 | MFA / 2FA | all | Second factor for staff | **NOT IMPLEMENTED** | NOT IMPLEMENTED | — |
| F-12 | Permission matrix governance | platform | Every route guarded or reviewed-public | CI-enforced scanner + generated doc | FULLY IMPLEMENTED | permission-matrix.js, ci.yml |

### 4.2 People & academics

| # | Feature | Roles | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|
| F-13 | Student admission (single) | owner/principal/coordinator/admissions | Create student record | Real insert + audit + event; admission_no auto-generated if absent; **no duplicate-name/guardian dedupe** | MOSTLY IMPLEMENTED | routes.js:86-99 |
| F-14 | Student CSV import | staff | Bulk import with error report | Per-row SAVEPOINT, 500-row/2MB caps, dedupe, honest failure report | FULLY IMPLEMENTED (v1) | people.admin/index.js |
| F-15 | Student edit / profile update | staff | Update demographics, guardian, photo | **NOT IMPLEMENTED** — no PUT/PATCH for students anywhere | NOT IMPLEMENTED | routes.js (only POST) |
| F-16 | Student withdraw / transfer-out / graduate | staff | Status transitions with history | `status` enum exists ('alumni','transferred') but **no endpoint sets it**; only section/grade transfer exists | NOT IMPLEMENTED (workflow missing) | people.admin transfer door |
| F-17 | Enrollment history | staff | Year-on-year trail | Append-only rows written with the flip in one tx | FULLY IMPLEMENTED (v1) | people.admin, migration 046 |
| F-18 | Parent ↔ child linking | owner/itadmin | Structural link | `family.child_link` used by every parent door; seed name-match fallback noted | FULLY IMPLEMENTED (structural) | family.view, routes.js |
| F-19 | Student identity for student accounts | student | Row binding to the account | **`lower(users.name)=lower(students.name)` name-match** — duplicate names bind arbitrarily; rename breaks identity | **BROKEN / insecure design** | student.world/index.js:105-110; files.store download pin |
| F-20 | Classes / sections management | staff | CRUD for grade-sections | Sections exist only as student columns + onboarding config; **no class entity, no class-teacher assignment table** | NOT IMPLEMENTED (as first-class entity) | schema |
| F-21 | Subjects & teacher allocation | staff | Subject-teacher-class mapping | **NOT IMPLEMENTED** server-side (timetable slots carry subject text; no allocation entity) → every "teacher can only manage their class" claim in docs is currently unenforceable | NOT IMPLEMENTED | ops.timetable schema |
| F-22 | Timetable | coordinator | Period grid, conflicts, substitutions | Real slots/substitutions + deterministic substitution suggestions; conflict detection minimal; UI renders live door | MOSTLY IMPLEMENTED (thin) | ops.timetable, coord screens |
| F-23 | Attendance marking | teacher | Mark own class, absence notices | Server: any teacher/coordinator/principal can mark **any student in the tenant** (no class scoping); WhatsApp rows queued per absent; **UI writes go to the mock** | PARTIALLY IMPLEMENTED (server) + MOCKED (UI) | routes.js:127-161; services/index.ts:71-74 |
| F-24 | Attendance history & corrections | staff | Edit with audit trail | Upsert overwrite only; no correction workflow, no lock after N days | PARTIALLY IMPLEMENTED | routes.js |
| F-25 | Homework (teacher) | teacher | Create + submissions inbox | Real doors (teacher.classroom), fixture-first UI with honest source stamps | MOSTLY IMPLEMENTED | teacher.classroom, teacherFixtures |
| F-26 | Gradebook / marks entry at scale | teacher | Continuous assessment | Only plugin_exams marks (per exam, locked at publish); no assignment-grade gradebook | PARTIALLY IMPLEMENTED | exams.assessment |
| F-27 | Exam publication | principal | Approval-gated snapshot | Digest + approval action + freeze; **guardian visibility of published results via family.view only** | MOSTLY IMPLEMENTED | exams.assessment + 025 |
| F-28 | Report cards | staff/parent | Printable report | Assembled JSON; **no print/PDF surface** | PARTIALLY IMPLEMENTED | exams.assessment |
| F-29 | Learning / mastery maps / curriculum | teacher | Track mastery | **Entirely client-side demo constructs** over the dataset blob (Learning.tsx 791 lines) + curriculum tables exist but only copilot writes toy rows | MOCKED / FAKE | screens/Learning.tsx |
| F-30 | Library | librarian-ish staff | Catalog + issue/return + overdue | Real doors; overdue widget | MOSTLY IMPLEMENTED | library plugin, 047 |

### 4.3 Operations

| # | Feature | Roles | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|
| F-31 | Work orders | all staff | Report→assign→resolve with SLA | Real state machine, SLA due, breach flag, events; **UI Maintenance flagship is demo-blob/mock** (server doors exist) | PARTIALLY (server real, flagship UI mock) | routes.js:289-356; services/index.ts maintenanceService |
| F-32 | Assets / preventive / inspections / inventory / vendors | facilities | Asset lifecycle | **Server has `app.assets` only**; preventive/inspections/inventory/vendors exist **only in the demo blob** | MOCKED / FAKE (5 of 6 concepts) | dataset; 001 schema |
| F-33 | AI issue intake ("describe the problem") | staff | Parse text → classified WO | Regex + asset-name matching with **fabricated confidence scores and "AI understanding" fields** | MOCKED / FAKE | services/index.ts createFromReport |
| F-34 | Visitor desk | front desk | Gate pass, pickup OTP | Real; OTP in RLS-denied vault; dev-echo only for OTP delivery | FULLY IMPLEMENTED (delivery caveat) | ops.visitors |
| F-35 | Reception / front desk AI | reception | Call triage | Demo-blob screen only (`calls`, `deskIntents` are dataset fiction) | MOCKED / FAKE | dataset, Reception.tsx |
| F-36 | Transport routes & events | transport | Route mgmt, delays, parent notices | Routes/events/notice-approval real; **no route CRUD UI beyond dataset**; GPS = simulator | PARTIALLY IMPLEMENTED | routes.js, transport.gps |
| F-37 | GPS tracking | transport | Live positions | **Simulated sine-wave vendor feed**; no vendor integration | MOCKED / FAKE | transport.gps/index.js:91-102 |
| F-38 | Fee obligation lifecycle | finance | Terms, installments, invoices, reminders | **No creation UI/engine** (fee_plans table unused by any endpoint); obligations arrive via seed/import only | NOT IMPLEMENTED (engine) / PARTIAL (read+settle) | schema; routes.js fees doors |
| F-39 | Payment collection | finance/parent | UPI/Razorpay collect | Razorpay orders real (REST, timeout, phase-isolated); UPI links fake VPA; settlement manual-only; **webhookVerified label heuristics** | PARTIALLY IMPLEMENTED | payments.* plugins; routes.js:214-241 |
| F-40 | Receipts | finance | Numbered receipts | RCP- numbers on confirm; **parent-visible receipt only via comms row body text** | PARTIALLY IMPLEMENTED | routes.js |
| F-41 | Tally export | finance | Voucher XML | Real XML generator over confirmed payments + ledger mapping | MOSTLY IMPLEMENTED | accounting.tally |
| F-42 | Admissions funnel | admissions | Lead stages | Real leads + stage history + FunnelBoard UI; **no application form, documents, or fee tracking** | MOSTLY IMPLEMENTED (v1) | admissions.funnel |
| F-43 | HR / leave | office | Leave requests + approvals | Office-files-leave model (no employee self-service), roster by date, cancel | PARTIALLY IMPLEMENTED | hr.leave |
| F-44 | Health clinic | staff | Visits, sick pass | Real doors + pickup OTP reuse | MOSTLY IMPLEMENTED (v1) | health.clinic |
| F-45 | Cases / complaints | staff/parent | Case lifecycle | Real cases + parent `/my-cases` scoping; **Incidents screen is demo-blob**; CaseDetail reads dataset | PARTIALLY IMPLEMENTED | routes.js:365-416; screens/Cases.tsx |
| F-46 | Documents | staff/parent | Upload + scoped access | files.store real; **Documents.tsx screen reads dataset blob, not the store** | PARTIALLY (server real, screen mock) | files.store; Documents.tsx |
| F-47 | Announcements | staff | Compose → audience → send | Action-spine draft+approve executes a comms row; **audience is a text label, not resolved recipients** for action-executed messages | PARTIALLY IMPLEMENTED | routes.js:458-476 |
| F-48 | Notifications | all | Targeted, per-user | `user_id IS NULL` rows broadcast to everyone; **Shell bell reads seed data, never calls /notifications** | PARTIALLY (server) / MOCKED (UI) | routes.js:493-505; Shell.tsx:315 |
| F-49 | Calendar | staff | School calendar | Dataset fiction + timetable doors for students | MOCKED / FAKE (staff view) | CalendarScreen.tsx |

### 4.4 Platform & governance

| # | Feature | Roles | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|
| F-50 | Plugin registry & lifecycle | owner/itadmin | Enable/disable with drain | Real switchboard: 14-state claims aside, status ∈ {registered, enabled, disabled}; drain reassigns open actions; gates 409 all doors | FULLY IMPLEMENTED | routes.js:561-658 |
| F-51 | Plugin settings & secrets | owner/itadmin | Per-tenant config | jsonb settings; non-privileged roles get keys-only + schema (P1-2 fix) | FULLY IMPLEMENTED | routes.js:575-603 |
| F-52 | Event spine & lineage | staff | Envelope + lineage query | Real: correlation/causation ids, lineage door | FULLY IMPLEMENTED (v1) | audit.js, routes.js:545-559 |
| F-53 | Governance budgets & breakers | platform | Per-plugin event budgets | Real counter + breaker with half-open recovery | FULLY IMPLEMENTED | governance.js |
| F-54 | Capability contracts | platform | Declared contracts | Table + surface in /plugins; **nothing enforces them at runtime** | PARTIALLY IMPLEMENTED | 007, 045 |
| F-55 | Trust ladder T0-T4 / marketplace | platform | Signed third-party plugins | `trust_level` column = 'T1'/'T2' hardcoded in migrations; **no marketplace, no signing, no third-party loading** (loader only scans src/plugins) | MOCKED / FAKE | loader.js; migrations |
| F-56 | Constitution (policy engine) | principal | School-level policy evaluation | **Static UI over dataset**; server "policy" = hardcoded `policy_ref` strings in code | MOCKED / FAKE | Constitution.tsx; grep policy engine: none |
| F-57 | AI gateway / budgets | platform | Model calls metered | Budget tables exist; **zero model calls exist to meter** | MOCKED / FAKE | teacher.copilot comments |
| F-58 | Audit ledger UI | owner/principal/itadmin/finance | Read ledger | Real `/audit` door; **Audit.tsx screen reads dataset fiction instead** | PARTIALLY (server real, screen mock) | routes.js:514-522; Audit.tsx |
| F-59 | Memory (institutional decisions) | leadership | Record + recall | Real table + doors; Memory.tsx screen mixes dataset + door | MOSTLY IMPLEMENTED | routes.js:524-542 |
| F-60 | Data health | itadmin | Integrity dashboards | Dataset fiction; server has none | MOCKED / FAKE | DataHealth.tsx |
| F-61 | Migration console | owner | Import from legacy systems | Source rows + stage toggles + trust receipt from zeros; **no parser, no importer, no field mapping** | MINIMALLY IMPLEMENTED | routes.js:665-712 |
| F-62 | DPDP tooling | owner/principal | Consent ledger, SAR, erasure | Consent + SAR with approval gate; **erasure/anonymization NOT IMPLEMENTED**; retention covers 4 kernel tables only | PARTIALLY IMPLEMENTED | pack.dpdp; retention-worker |
| F-63 | CBSE pack | principal | Board compliance calendar | Calendar + publication rules; thin | MINIMALLY IMPLEMENTED | pack.cbse |

### 4.5 Screens-to-reality map (all 80 routes)

Legend — **LIVE**: real doors called; **FIXTURE-FIRST**: live probe with typed fallback; **DEMO**: reads `/dataset` blob; **MOCK-WRITE**: writes go to in-memory mock services.

| Route | Screen | Data plane | Staff write path |
|---|---|---|---|
| /login, /onboard | Login, Onboard | LIVE | — |
| /plugins | Plugins | LIVE | real enable/disable/settings |
| /people-admin | PeopleAdmin | LIVE | real provision/suspend/reset/transfer/import |
| /library | LibraryLive | LIVE | real issue/return |
| /rails | RailsBoard | LIVE (+capabilities) | real template/settings |
| /visitors | VisitorsBoard | LIVE | real checkin/out/pickup |
| /admissions | FunnelBoard (gated) / Admissions (demo fallback) | LIVE / DEMO | real stage moves (gated) |
| /coord/* (6) | Coordinator lane | LIVE | real doors |
| /parent/* (8) | Family portal | LIVE | real doors |
| /student/home2, /student/* (4) | Student portal | LIVE (student.world) | real doors |
| /print-queue, /wellbeing-queue, /noticeboard | StudentOS desks | LIVE | real doors |
| /teacher + /teacher/* (3) | TeacherOS | FIXTURE-FIRST | real doors where live; else fixture |
| /today, /attention, /ask, /next | Flagship loop | DEMO + MOCK-WRITE | mock services / local state |
| /people, /people/:id | People 360 | DEMO + MOCK-WRITE | mock |
| /attendance | Attendance register | DEMO + **MOCK-WRITE** | `attendanceService.mark` = no-op |
| /fees | Fees desk | DEMO + **MOCK-WRITE** | `feeService.recordRetry` mutates seed array |
| /learning | Learning/gradebook | DEMO | none |
| /operations, /operations/hr | Ops + HR | DEMO + MOCK-WRITE | mock |
| /maintenance/** (13) | Maintenance flagship | DEMO + MOCK-WRITE | in-memory woStore |
| /reception | Reception AI desk | DEMO | none |
| /cases, /cases/:id, /incidents | Case/incident boards | DEMO (kernel /cases unused by UI) | local reducer |
| /documents | Documents | DEMO (files.store unused by UI) | none |
| /insights, /ai-governance, /ai-usage | Analytics | DEMO (fabricated telemetry) | none |
| /automation | Automation/workflows | DEMO + fake NL compiler | local |
| /constitution, /memory, /data-health, /audit, /group, /it, /settings | Governance | DEMO (+ real /memory POST exists unused) | local |
| /calendar | Calendar | DEMO | none |
| /migration | Migration console | DEMO + real /migration doors | real stage advance; importer none |
| /parent/complaints, /parent/chat, /parent/fees, /parent/ask | Legacy parent screens | DEMO | local |
| /student (legacy), /student/learning, /student/portfolio, /student/ask | Legacy student screens | DEMO | local |
| /demo* (4 routes) | Demo stagecraft | DEMO | build-time gated out of prod |

**Count:** ~20 LIVE, ~10 FIXTURE-FIRST/legacy-live hybrid, ~45 DEMO (of which ~15 also MOCK-WRITE), ~4 demo-gated. The README's "62 screens / 63 routes" is true as a count and misleading as a product statement.

## 5. Role-by-role audit

The real role model (discovered from `auth.js:60` + the DB CHECK in `001_init.sql:21`, NOT from docs): **owner, principal, coordinator, finance, admissions, transport, facilities, technician, teacher, itadmin, parent, student** — 12 roles. There is no super-admin/platform-operator role (platform ops = shell + owner-role DB), no counselor/nurse role (those words appear in code but are not grantable — `P3-19`), and custom roles are impossible.

### 5.1 Owner
- **AuthN/onboarding:** created only by self-serve signup (`onboarding.js:92-95`); structurally the most protected account — cannot be provisioned, suspended, or password-reset through any door (`people.admin/index.js:92-94, 182-185, 216-218`).
- **Can do:** everything staff-side at kernel level; enable/disable plugins incl. money rails; write plugin settings (secrets); audit; memory; migration activate; school profile; reset any non-owner password.
- **Gaps:** no MFA; no break-glass/support-access pattern; JWT in localStorage; password reset requires an admin (owner forgot password = manual DB surgery — no email reset exists). Owner is also the only role that can update the school profile (`onboarding.js:133`) — principal cannot, which is operationally odd.
- **Over-permissive:** sees platform-wide `/metrics` aggregates (cross-tenant, `app.js:351-388` — by design but unscoped).
- **Verdict:** MOSTLY COMPLETE as an identity concept; EMPTY as a product experience — the owner's own screens (Plugins, PeopleAdmin, RailsBoard) are live; the rest of what a demo shows the owner is demo-blob.

### 5.2 Principal
- **Can do (real):** decide/deny approval actions (except coordinator-owned ones — SoD pin, `routes.js:447-449`); mark attendance anywhere; confirm payments with finance; read audit; memory entries; exam publication approval; plugin enable (money-rail enable is owner/itadmin only); everything via kernel doors.
- **What the demo shows vs reality:** Today/Attention/Ask/Insights/Constitution/AiGovernance are demo-blob or canned-AI surfaces. The principal's actual working set is: approvals, fees confirm, audit view (server door), exams publish, plugin toggles.
- **Missing:** no timetable-own view of school-wide attendance anomalies (real data), no delegated approval (vacation cover requires sharing credentials — no delegation concept exists), no signature/step-up on critical actions.
- **Broken/insecure:** can self-approve admissions-raised `students.create` actions because the raiser omits `proposed_by` (`admissions.funnel` payload — P1-9); can be suspended/password-reset by itadmin (acceptable admin model, but undocumented).
- **Verdict:** PARTIALLY IMPLEMENTED as a product role; approval-spine mechanics sound.

### 5.3 School IT admin (itadmin)
- **Can do (real):** provision/suspend/reset every non-owner account; CSV roster import; plugin enable/disable/settings **including money rails and webhook secrets** (`routes.js:605,651` — P2-8: within-tenant escalation over the finance/owner money-governance boundary); view audit.
- **Over-permissive:** money-rail control should be owner-only; can route a DPDP erasure execution (P2-18 — compensating SoD controls hold, but the role is too broad for an irreversible action).
- **Under-permissive:** cannot edit the school profile; cannot create owners (correct).
- **Note:** the b86d6fa commit history ("IT-admin role crash on fresh schools — six surfaces assumed demo-world records") shows this role's screens crashed on empty worlds until the last commits; residual demo anchors remain (Today.tsx:491 hardcodes "Tally gateway connected — healthy" in the itadmin band).
- **Verdict:** MOSTLY IMPLEMENTED (best-served staff role via people.admin); money-rail scope is the flaw.

### 5.4 Teacher
- **Can do (real):** homework create/review (`teacher.classroom`, owned by `created_by` — properly scoped); submissions inbox; concerns (teacher.support); mastery/class maps via copilot doors (fixture-first UI); leave request (self, via classroom plugin) routed to coordinator.
- **What is missing/broken:** **no class-of-record concept exists anywhere** — the server cannot know which students a teacher teaches. Consequences (verified): any teacher marks attendance for any student in the school (`routes.js:127-161`); any teacher enters/clobbers marks for any exam/student pre-publish (`exams.assessment:78-124`); bulk-"present" any class for any date via timetable autofill (`ops.timetable:107-123`); reads every staff member's leave reasons (`hr.leave` DESK tier, `:87-116`); sees the whole approval queue (`GET /actions :419-428`); can close any case; can promote any answered doubt into the school-wide FAQ (`teacher.support:510-521`). The docs' claim "teacher can only manage assigned classes" is **currently unenforceable fiction** (§10 R-6).
- **Data visibility:** roster read is phone-masked for teachers (`routes.js:42-58`) — good; but the whole roster is still readable, and via `/dataset` the demo world renders full profiles (demo tenant).
- **Verdict:** PARTIALLY IMPLEMENTED with the largest single authorization gap in the product (P1-7/P1-10).

### 5.5 Coordinator
- **Can do (real):** the best-covered staff role — 6 live screens (`/coord/*`): home, substitutions (SoD-guarded decide), workload, curriculum monitor, escalations, approvals; duty allocation; transport events; section transfers (with people.admin ROSTER tier); admissions roster import.
- **Missing:** no timetable conflict resolution UI beyond substitutions; approval queue visibility includes finance/HR rows (P1-9 family).
- **Over-permissive:** routes safeguarding concerns to **any active user id, no role predicate** (`teacher.support:171,180` — a parent/student account can be assigned a concern, P2-10); DPDP erasure executor (P2-18).
- **Verdict:** MOSTLY IMPLEMENTED.

### 5.6 Finance
- **Can do (real):** confirm payments (the only settlement path), initiate payments, Razorpay orders, read audit (incl. copilot question snippets — P2-16), comms receipts, Tally day-book/export, fee obligations read (whole school).
- **What is missing:** the entire front half of the money cycle — no fee-plan/obligation creation UI or engine, no dunning, no refunds, no concession workflow. Finance can confirm payments for obligations that nobody can create in-app.
- **Over-permissive:** reads guardian message bodies; audit includes AI question text; library overdue export hands it unmasked guardian phones (`library:244-260`).
- **Insecure:** `gatewayRef` laundering — any `^[A-Z0-9-]{10,}$` string labels a manual confirm "gateway webhook verified" in the audit ledger (`routes.js:215-223`, P2-11).
- **Verdict:** PARTIALLY IMPLEMENTED (settlement yes; revenue lifecycle no).

### 5.7 Admissions
- **Can do (real):** funnel board (live), leads + stage history, offer→student-create approval action, CSV roster import.
- **Missing:** application forms, document collection, admission fees, waitlists, communication history per lead.
- **Flaw:** `students.create` action payload omits `proposed_by` → the self-approval SoD guard cannot fire (P1-9); finance can write the funnel (`:57`).
- **Verdict:** MOSTLY IMPLEMENTED (v1 funnel genuinely usable).

### 5.8 Transport
- **Can do (real):** post route events, GPS positions (simulated vendor feed), delay-notice approvals land on principal.
- **Missing/broken:** no route CRUD, no student-route assignment UI (bus_route column only), no driver/vehicle management, GPS is a sine-wave simulator; **over-permissive:** `delayMins` is caller-supplied with no plausibility bounds — one transport user can flood the principal's approval queue with false delays at the 240/min budget (P2-15).
- **Verdict:** PARTIALLY IMPLEMENTED; tracking is MOCKED.

### 5.9 Facilities / Technician
- **Can do (real):** report work orders; technician transitions any work order and **sets cost cents** (`routes.js:332-346` — no raised-by/asset scope, P2-5); file uploads; inspections… (only in demo blob).
- **Missing:** the whole 13-screen Maintenance flagship (assets/preventive/inventory/vendors/inspections/map/intelligence) has **no server-side tables beyond `app.assets`** — it is a demo-blob product. A real technician gets: work-order doors + file store + that's it.
- **Verdict:** MINIMALLY IMPLEMENTED server-side; flagship UI is MOCKED.

### 5.10 Parent
- **Can do (real):** the genuinely good part of the product — `family.view` + `parent.assistant`: child-scoped timeline/academics/attendance/exams, consents decide, requests, report discrepancy, copilot (own-children aggregates only, budgeted, `assertOwnChild` on every door).
- **What the demo shows vs reality:** ParentHome/ParentChat/ParentFees/ParentAsk render the demo blob. A real parent gets FamilyHome/Consents/Requests/Copilot (live) — and the legacy demo screens still routable.
- **Insecure:** can initiate a payment against ANY obligation in the school (no child check on `POST /fees/payments :194-212`), which both leaks linkage and **deadlocks the victim family's payment via the one-open-per-obligation constraint** (P1-3); PTM booking via name-equality bridge (P1-4 family); file downloads via name-equality fallback (`files.store:224-232`).
- **Verdict:** MOSTLY IMPLEMENTED (best light-role surface), with two real holes.

### 5.11 Student
- **Can do (real):** `student.world` doors (home/homework/results/mistakes/flashcards/tasks/print/noticeboard/wellbeing) with RESTRICTIVE owner-pinned RLS on the personal tables — the strongest object-level enforcement in the platform.
- **Broken/insecure:** **identity is a name match** (`student.world:105-111`) — two same-named students collide; one reads the other's results/files and tags study rows with the twin's id (P1-4a); **over-permissive:** unscoped whole-school roster, any student's full record incl. fees+attendance, whole-school fee ledger, tenant event stream (`GET /students`, `/students/:id`, `/fees/obligations`, `/events/lineage` — P1-2/P1-3); `POST /cases` open to students (spam).
- **UX:** 30-min session TTL, `Clear-Site-Data`, SessionSafety idle banner — the shared-computer story is genuinely thought through.
- **Verdict:** PARTIALLY IMPLEMENTED; the P1-2/3 scoping holes are indefensible for a children's data platform.

### 5.12 Reception / Librarian / HR / Counselor / Security
- Do **not exist as roles**. Reception duties are covered by coordinator/transport/facilities tiers in ops.visitors (DESK tier = owner/principal/itadmin/coordinator); library doors are granted to broad staff; HR leave is "office files leave" (owner/principal/itadmin/coordinator/admissions/finance — OFFICE tier) with no employee self-service; counselor/nurse appear as strings in code but are not real roles (`auth.js:60` — P3-19). The docs' role list (docs/ROLE-CAPABILITIES.md) describes doors per role more accurately than any UI reality.

---

## 6. End-to-end data-flow audit (traced flows, with broken links)

Format: entry → validation → storage → reads → side effects → audit → notifications → exits. Every flow was traced in code.

### F-1 New school created
`POST /onboard/signup` → validation (name 3-120, email RE, password ≥8) → ONE owner-path tx: tenant + owner + catalog seed (23 rows) + audit + event → auto-login 12h token. **Sound.** Gaps: no email verification (no sender exists); 3/min/IP only → tenant spam (P2-25); sections config accepted up to 15×8.

### F-2 New administrator/staff created
PeopleAdmin → `POST /plugins/people.admin/users` → validation → scrypt temp password shown ONCE + `force_change=true` → user row → event + requestAudit. **Broken link #1: `force_change` is never enforced and no change-password door exists** (P1-1) — the temp password is the permanent password. Broken link #2: the only delivery of the credential is the admin's screen (copy/paste) — fine — but the *user* has no self-service path ever.

### F-3 Student admitted
`POST /students` (kernel) or funnel-offer approval or CSV import → `app.students` + audit + event. **Broken links:** no admission form/lead-conversion document flow; **no student edit/delete/withdraw endpoints exist**; admission_no auto-gen `ADM-<base36 time>` collides conceptually with seed's `MER-####` convention; duplicate guardian dedupe absent. CSV import is the only bulk path and it is solid (per-row SAVEPOINT, honest failure report).

### F-4 Parent linked to student
Provision parent with studentId → `family.child_link` (structural, 034) → every parent door checks it. **Sound** — this is the platform's best identity mechanism. Residual: name-match fallbacks elsewhere undermine it (P1-4), and parent provisioning validates the student exists but not guardian relationship truth.

### F-5 Attendance recorded
`POST /attendance/mark` → upsert per student (UNIQUE tenant+student+date) → absentees → `app.communications` rows (ABSENCE_NOTICE, dedup_key=uuid) → audit. **Broken links:** (a) no class scoping (P1-7); (b) the UI never calls this door (`Attendance.tsx` uses the mock) — in the demo world attendance is fiction; in a real school only API callers reach it; (c) `app.communications` rows are 'queued' — delivery depends on the comms-dispatcher worker running AND a configured rail; with logger provider the "notice" is a log line (§17). (d) No attendance correction/lock workflow; last-write-wins forever.

### F-6 Homework created → student submits → reviewed
Teacher → `POST /plugins/teacher.classroom/homework` (validated, attachment scheme-allowlisted) → student submit (UNIQUE(homework,student) one-shot, late stamped at insert) → teacher review transitions. **The one fully-wired academic loop** — but student submit-gate class-membership is name-equality (P1-4c) and the "17:00 guardian digest" is promised in UI copy with no server sender (DATA-FLOW.md admits it).

### F-7 Marks entered → exam published
Marks per student+component (validated 0..max, audited per write, locked at publish) → publication assembles report from marks+weightage → digest → approval action → principal approves → `published_at` + frozen snapshot. **Sound mechanics** (best-in-repo workflow). **Broken links:** no gradebook, no term/assessment-period model, teacher can write any student's marks (P1-10), report cards have no print surface, parent visibility rides family.view exams door only.

### F-8 Fee created → payment recorded
**Broken at step one:** there is no fee-obligation creation door/UI (fee_plans table unused). Obligations exist only via seed/import. Payment: initiate (`FOR UPDATE`, one-open constraint) → UPI link (fake VPA) or Razorpay order (real REST) → webhook (HMAC, replay-dedupe, facts only) → **manual confirm by finance/owner** → receipt + ledger `paid_cents` atomic add (CHECK-clamped) + comms row (FEE_RECEIPT with EMPTY audience — dispatch logs it only) → audit. **Integrity issues:** gatewayRef laundering (P2-11); parent cross-family initiation deadlock (P1-3); partial payments supported arithmetically but no partial-payment UI; no refunds/voids beyond status enum.

### F-9 Leave requested → approved
Teacher leave → `teacher.leave_request` + per-instance kernel action `teacher.leave.<id>` → coordinator approves on `/actions/:id/decide` → `/teacher/leave/mine` mirrors decision. **Sound.** Gaps: no balance/entitlement tracking; HR leave (staff) is office-filed only; leave reasons readable by all DESK staff (P2-13).

### F-10 Announcement created → notification delivered
Action spine: draft message → approval → on approve, `app.communications` row with **`status='delivered', sent_at=now(), delivered_at=now()` hardcoded** (`routes.js:461-469`) — the ledger records delivery that never happened unless the dispatcher+rail actually send later (and then the dispatcher will mark a row that is already 'delivered' — it selects `status='queued'`, so these rows are NEVER dispatched: **approved audience-labeled messages are permanently fabricated-delivered**). Task-kind actions insert notifications with `user_id=NULL` → tenant-wide broadcast including students (P2-7). **This is the most damning single flow: the approval loop's "execution" is fake.**

### F-11 Document uploaded → viewed
files.store: validated upload (mime+ext agreement, 5MB, sha256) → bytes off-web-path under `<tenant>/<uuid>` → download door fail-closed (uploader/admin; student-scope admits child_link guardians + name-matched student — P1-4b) → audited. **Sound v1.** Broken link: **the Documents screen doesn't use it** (reads dataset blob); no folders, no versioning, no AV scan, 5MB ceiling, local-disk only (no S3).

### F-12 Report generated
**There is no report generation.** Insights/Group/board-pack compute client-side over the demo blob; `/metrics` is ops-only; Tally export and CBSE CSV are the only real exports; `/audit` is capped at 500 rows with no export; SAR bundles are the only structured data-egress.

### F-13 Student transferred / withdrawn / teacher leaves / year rollover
- Transfer: section/grade flip + append-only `enrollment_history` in one tx (**sound**, people.admin).
- Withdraw/graduate: **NOT IMPLEMENTED** (status enum values exist, no endpoint).
- Teacher leaves: suspend account only; homework/leave history remains owned by a ghost.
- Academic-year rollover: **NOT IMPLEMENTED** — no academic-year entity anywhere; grades are free-text; promotion does not exist (transfer door is the closest primitive).

### F-14 Notification delivered (in-app)
`app.notifications` (user_id or NULL broadcast) → GET /notifications. **Broken:** the Shell bell reads **seed data** (`Shell.tsx:315` — `domain.notifications` from the dataset), never calls `/notifications`; `/notifications/read` exists but the UI's read-state is local reducer state. Real tenants never see server notifications in the bell.

---

## 7. Authentication / authorization / RLS — deep security review

### 7.1 What is genuinely strong (verified, keep it)
- `withUser()` transaction-scoped impersonation with tenant+role GUCs (`db.js:48-64`); no GUC bleed between pooled requests.
- RLS: ENABLE+FORCE + `tenant_isolation` on the 22 core tables (001 loop), `app.tenants` self-pin, `schema_migrations`/`auth_otps` denied to app role, plugin PII planes closed by 049 after being born naked (049's own header admits pre-049 `relrowsecurity=f` on nine tables).
- Only three role-aware RLS constructs exist (`teacher.note` user-pin; `student.*` RESTRICTIVE owner pins) — everything else is tenant-only, making in-tenant scoping a code-only concern (§7.3).
- Password hashing scrypt N=2^17 + legacy fallback + `dummyVerify` timing equalization; uniform OTP failure copy; CSPRNG codes; single-use consumed OTPs; attempt caps.
- JWT: mandatory jti (pre-038 tokens refused), global-by-jti denylist, live user re-read per request (suspension = next-request lockout), student 30m TTL.
- SSO: server-side single-use 10-min state, `email_verified` check (see caveat), no auto-provisioning.
- Money webhooks: raw-body HMAC, timing-safe compare, freshness window, UNIQUE dedupe, boot-time secret mandate, facts-only (never settle).
- Permission-matrix CI gate: 200 routes scanned, 0 unguarded, fails closed.
- No SQL injection found anywhere (every interpolation is a module constant or whitelist — exhaustively grepped by the security lane and spot-verified); no XSS sinks in app/src; path traversal guarded in files.store; no token-in-URL.

### 7.2 CRITICAL findings (P0)

| ID | Finding | Attack path | Evidence |
|---|---|---|---|
| **P0-1** | **OTP vault cross-wire.** Visitor-desk pickup codes are INSERTed into the login vault `app.auth_otps` (`ops.visitors/index.js:146-149`), and `/auth/otp/verify` selects the latest unconsumed row by phone **with no purpose/tenant binding** (`app.js:141`). | Front-desk role (owner/principal/itadmin/coordinator) creates a visitor for any student → requests pickup → the guardian's phone gets a vault row → redeem it at `/auth/otp/verify` → **full login session as that guardian**. With `OTP_DEV_ECHO=1` (armed in this checkout) the code comes back in the HTTP response; in prod it shadows/consumes the guardian's own login OTP. | ops.visitors:146-149; app.js:141-155; 008 schema (purpose CHECK allows only 'login' yet pickup rows land there) |
| **P0-2** | **Dev SSO door armed in this deployment.** `server/.env` sets `AUTH_DEV_SSO=1` (+ `OTP_DEV_ECHO=1`); `POST /auth/google/demo {email}` issues a full session for any existing email with zero credentials (`app.js:205-212`). | Any network-reachable user of this box → unauthenticated login as principal/owner/finance. Prod is gated by `NODE_ENV` — but staging boxes inherit dev posture silently. | server/.env:9-10; app.js:205-212 |
| **P0-3** | **Cross-tenant session issuance.** OTP request/verify and Google callback resolve the user across ALL tenants (`WHERE phone=$1` via owner path, `u.rows[0]`) with no tenant binding (`app.js:113,135,196`); self-signup makes same-phone-in-two-tenants trivially plantable. | Attacker creates a school, provisions a user with the victim's phone/email → OTP/SSO resolution sorts by `created_at` → the wrong tenant's account can receive/verify the code → session in the wrong tenant. Password login at least 409s on multi-match (but see P1-5). | app.js:75,113,135,141,196 |

### 7.3 HIGH findings (P1) — authorization & identity

| ID | Finding | Evidence |
|---|---|---|
| P1-1 | `force_change` stamped at provisioning, never enforced; **no change-password door exists anywhere** | 046:51; people.admin:110-112,188; grep: zero consumers |
| P1-2 | Student role: whole-school roster (`GET /students` under bare `me`), any student's full record + fees + attendance (`/students/:id`) | routes.js:37-61, 63-84 |
| P1-3 | Whole-school fee ledger + tenant event stream to light roles; **parent can initiate payment on ANY obligation → one-open constraint deadlocks the real family** | routes.js:164-192, 545-560, 194-212; 006:19-20 |
| P1-4 | **Name-equality as identity/authz** in 5+ places: student.world `ownStudent` (`lower(name)=lower(user.name)`, no uniqueness guard), teacher.classroom submit-gate + missing-bridge, files.store guardian/student download fallbacks, PTM booking, library | student.world:105-111; teacher.classroom:131-137,219; files.store:222-232 |
| P1-5 | Login 409 `multiTenant + schools:<count>` fires BEFORE password verification → unauthenticated account-existence oracle + skips the scrypt timing equalization | app.js:79-84 |
| P1-6 | Production frontend bundle ships the `/auth/google/demo` fetch; Google button not DEMO-gated | Login.tsx:119-124; dist grep |
| P1-7 | Any teacher marks any student (incl. fake absences → guardian notices); bulk-autofill present for any class/date | routes.js:127-161; ops.timetable:107-123 |
| P1-8 | `plugin_razorpay.order_log/webhook_log`: tenant data, `GRANT ALL`, **no RLS** (missed by 049) → cross-tenant gateway payloads given any app-role foothold (incl. default app-role password, P2-3) | 044:17-58; 049 sweep omits them |
| P1-9 | Approval queue visible to all 9 staff roles; decide = role-string equality; **self-approval guard only fires when `payload.proposed_by` is set — admissions omits it → principal self-approves student admissions** | routes.js:419-480; admissions.funnel payload |
| P1-10 | Any teacher enters/clobbers any student's marks pre-publish; `class_grade` never compared to the teacher | exams.assessment:78-124 |
| P1-11 | Default/short JWT secret accepted in ANY non-production NODE_ENV → token forgery on staging | config.js:31,58-60 |
| P1-12 | Demo-tenant posture: the full synthetic school PII corpus (names, guardian phones, fees) is served to every role via `/dataset` and hydrated as the world — by design for the demo tenant, but it is live-data-shaped PII | app.js:271-314 |

### 7.4 Notable P2s (condensed; full detail in the security annex above)
- `/metrics` serves **cross-tenant** aggregates to every tenant's owner/itadmin (`app.js:351-388`).
- `/dataset` non-meridian "empty world" is a **key blocklist, not an allowlist** — verified by reproducing the flattener: `DEMO_STUDENT` (Aarav Sharma, email, phone), `DEMO_GUARDIAN` (Kavita Sharma, email, +91 9892071862), `workOrders` (8 records), `SLA_POLICY`, `FEE_STORY`, `deskSettings`, `SCENARIOS`, `DEMO_SECTION_ID` etc. ship to **every non-demo tenant's users** (P2-2).
- Broadcast notifications (`user_id IS NULL`) reach every user incl. students; producers exist in the kernel task path (`routes.js:472`).
- Grant trap: `ALTER DEFAULT PRIVILEGES` (005) auto-grants full DML to `schoolos_app` on every future app table; later "narrow" grants (files, enrollment_history) are additive → **"append-only" claims for app.files/app.enrollment_history are false at the DB level**.
- `auth.revoked_token`: app role retains in-tenant DELETE (038 grants never tightened after 049 added RLS).
- Privileged SSRF: rails.sms/whatsapp POST `settings.url` (https-only, 8s timeout, no redirect control, no host allowlist) — owner/itadmin-writable.
- `gatewayRef` laundering into "webhook verified" audit labels (P2-11) + Tally XML injection surface.
- itadmin can enable money rails and write webhook secrets (P2-8).
- Audit chain is tamper-evident **only against the app role**; the owner/superuser connection can rewrite history with a clean chain (no secret, no external anchor) and `seed.js` TRUNCATEs the whole ledger; NULL-prev bypass in `audit_append` (006:62).
- Seeded demo credentials (`schoolos-demo` ×12 accounts, plus migration-embedded teacher2/student2) + default `schoolos_app_pw` app-role password.
- Onboarding: no email verification, 3/min/IP only → empty-tenant spam; each signup seeds 23 catalog rows.
- No CSP header anywhere (localStorage JWT is the crown jewels).
- Read-after-GET writes: `/plugins` self-heal INSERTs on GET; `pack.cbse` GET validates and INSERTs actions.

### 7.5 Frontend trust assumptions
- JWT in `localStorage` (XSS-impact = 12h takeover; XSS surface currently minimal — no sinks found); `Clear-Site-Data` + `/me` cold validation are good mitigations; `?return=` open-redirect validated; client role gates are UI-only (correctly backed by server 403s) with two gaps where staff routes render for light roles until the API refuses (`/rails`, `/people-admin` missing from `staffOnly`).
- `force_change`, permission-aware rendering, and demo-mode gating are all **client-side courtesies, not controls** — consistent with the audit's rule that only server enforcement counts.

---

## 8. Database / data-model audit

*(Full table-by-table matrix is in the security annex §1.2 and the database lane's inventory; this section records the structural verdicts.)*

### 8.1 Strengths
- 86+ tables across 14 schemas, every business table carries `tenant_id` + `created_at`; UNIQUE (tenant_id, …) keys on natural keys (admission_no, WO code, case code, action code, routes, plugin rows, webhook event ids); CHECK constraints on enums everywhere; money as bigint cents with CHECK clamps (`paid_cents <= amount_cents` via 006:12-17); partial unique index enforcing one-open-payment-per-obligation (006:19-20).
- Append-only enforced by *grant revocation* for audit_log (and by grants shape for several event tables — `*_event` tables are INSERT-only where the migration says so, e.g. 032 concern_status_event, 034 request_event — though the 005 default-privilege trap undermines this inside schema `app`).
- Migration runner: advisory lock, per-file transactions, **sha256 checksums with drift refusal** (041) — genuinely good; each test run replays all 53 migrations from scratch, which is accidental-but-real migration testing.
- No down-migrations exist (forward-only) — rollback = restore-from-backup, which does not exist (§15).

### 8.2 Defects that will bite

| # | Defect | Evidence / consequence |
|---|---|---|
| D-1 | **Grant trap**: `ALTER DEFAULT PRIVILEGES ... GRANT ALL` (005) auto-grants full DML to every future app table; later narrower grants are additive, no REVOKEs → "append-only" metadata claims are unenforced (files, enrollment_history); ops_counters gets DELETE via default privs | 005:8-11; 052 explicitly performs no REVOKEs |
| D-2 | **No RLS on `plugin_razorpay.*`** (money-adjacent gateway payloads) | 044; missed by 049 |
| D-3 | `app.capability_contracts` SELECT policy `USING(true)` — per-tenant rows readable cross-tenant | 007:18-21 |
| D-4 | **No academic-year/term entity**; grades/sections are free text; fee_plans.installments column unused by any code | schema survey |
| D-5 | Denormalized money: `fee_obligations.paid_cents` vs `app.payments` — reconciled only by the confirm code path; **no trigger/constraint** binds them; a stray owner-path write diverges silently | routes.js:228-231 |
| D-6 | `app.actions.payload.proposed_by` optional → SoD guard inert for kernel/plugin-raised actions | routes.js:455 |
| D-7 | Caller-supplied `created_at` on audit rows is the chain's sort key; backdating reorders lineage (owner-path) | audit.js:13; 006 |
| D-8 | Text-code FKs: `students.bus_route → routes.code` (no FK), `files.ref_id` polymorphic, `source_ref` strings — referential integrity is convention | 001; files.store |
| D-9 | Missing indexes for real query shapes: `students` ILIKE search (no trigram/`text_pattern` index), `attendance(student_id, school_date)` has the UNIQUE but the register query drives from students×date, `fee_obligations(status, due_on)`, `events(emitted_by, created_at)`, `notifications(user_id, read_at)`, `actions(status, created_at)`, `audit_log(tenant_id, created_at DESC, id DESC)` composite is present ✓ — several hot plugin queries (concern queues, copilot calls, positions by route+time) rely on tenant-only b-trees | cross-check of queries vs migrations |
| D-10 | Scale ceilings: attendance grows 1 row/student/school-day (100k students ≈ 20M rows/yr) with no partitioning story; `app.events`/`outbox`/`audit_log`/`communications` are unbounded with JSONB payloads; retention covers only 4 tables (GPS positions, OTPs, revoked tokens, oauth states) — events/audit/comms grow forever | retention-worker.js |
| D-11 | Soft-delete absence: users have `active`, students have `status`, everything else is hard-row forever or absent (no `deleted_at` discipline, no archival) | schema survey |
| D-12 | **Case-sensitive `UNIQUE (tenant_id, email)` while every lookup lowercases** → `X@Y.com` + `x@y.com` can coexist as two accounts; login then matches both (misleading 409) and Google/OTP resolve `rows[0]` **without deterministic order → possible wrong-account auth inside a tenant** | 001:26 vs app.js:75,196,210 |
| D-13 | N+1 patterns: `GET /students` roster then per-student fetches in the UI; copilot class-map loops student×topic with per-cell SELECT+UPDATE (pool-starvation DoS, P2-16); attendance mark does one INSERT per student (acceptable at 50, wrong at 500) | teacher.copilot:292-325; routes.js:132-141 |
| D-14 | **`audit_append` (the only SECURITY DEFINER function) never pins `p_tenant` against `current_setting('schoolos.tenant_id')`** — a caller reaching the function directly can forge an audit row into ANY tenant's hash chain; the serialization advisory lock lives in JS (`audit.js:8`), not in the function | 006:27-53 |
| D-15 | **The owner-path/FORCE-RLS design silently depends on `schoolos` holding BYPASSRLS/superuser, and no audited script grants it**: 001:372 and 049:10 claim bootstrap applies `ALTER ROLE schoolos BYPASSRLS`; `bootstrap.js` (22 lines) does not; `server/README.md` creates `schoolos` with LOGIN CREATEDB only. It works in compose only because `POSTGRES_USER: schoolos` is a superuser. FORCE RLS therefore adds no protection here — the owner bypasses it either way | 001:372; 049:10; bootstrap.js; docker-compose.yml:6 |
| D-16 | **`seed.js TRUNCATE app.tenants CASCADE` orphans every no-FK tenant table** (`app.outbox`, `app.event_action_link`, `teacher.homework/submission/leave_request`, `family.*`, `parent.*`) — dead rows referencing deleted tenants accumulate forever on every reseed. The guard comment says "wipes the tenant"; it actually wipes **all** tenants | seed.js:27 |
| D-17 | **DPDP erasure is platform-incomplete and self-defeating**: redacts only `plugin_dpdp.consent` + `plugin_admissions.lead` identity columns; leaves `app.guardians`, `app.communications.recipient`, `app.audit_log` (record_ref = email), OTP phones, visitor/clinic/exam PII and raw webhook payloads untouched — while writing the phone into the immutable `actions`/`events`/`audit_log`/`sar` ledgers **during** "erasure". A right-to-erasure cannot be satisfied platform-wide today | pack.dpdp:204-215 |
| D-18 | Migrations seed demo/foreign rows into **every** tenant: phantom `teacher2@meridian.edu`/`student2@meridian.edu` users (031:85-100), timetable periods/slots demo data (010:149, 021:82), the full CBSE curriculum tree (033:63-66), synthetic guardians for every student (028:18) — a self-signup school is born non-empty in the DB while `/dataset` masks it as empty | 031; 010; 021; 033; 028 |
| D-19 | No `updated_at` on most kernel tables; where the column exists there is **no trigger** maintaining it; **no optimistic-concurrency version columns anywhere** (38 `FOR UPDATE` sites are the only guard) | 001 schema survey |
| D-20 | Red-team-cleanup migrations (012/016/017/019/027/030) purge the project's own live-API residue from the shared persistent DB using **over-broad `payload::text LIKE '%'||id||'%'` substring deletes** (027:28-31, 030:41-44), treat all `status='cancelled'` leaves as residue (030:31) and delete all `[erased:%` consent rows globally (030:57); combined with no down-migrations and header↔filename numbering drift (020→"019", 021→"020", 022→"021"), rollback safety and audit traceability are both compromised | 027; 030; migration headers |
| D-21 | `fee_obligations.paid_cents` has **no refund/reversal path at all** — status `'refunded'` exists in the CHECK but is never set by any code; once confirmed, paid_cents only goes up; webhooks explicitly do not touch it (payments.razorpay:234-235), so ledger truth = "what staff confirmed", not "what the gateway captured" | 001:110; routes.js:229 |

### 8.3 Seed & demo data
`seed.js` truncates ALL tenant data and inserts the Meridian world (12 users all `schoolos-demo`, 375 students, 1,125 fee obligations, 12 routes, 9 assets, 8 WOs). Refused in production without `--i-know-this-wipes-data` (seed.js:14-19) — a real, fail-closed guard. But: (1) the Sept fee paid-amounts are generated with `Math.random()` — **the demo money is non-deterministic across reseeds** (seed.js:110-122); (2) demo credentials + migration-embedded fixture users mean **any seeded environment is a shared-password environment** (P2-4); (3) the truncate orphans the no-FK tables (D-16); (4) the `/dataset` world is a separate, code-generated corpus (not DB rows) — **two "Meridians" exist and they disagree** (docs/07 claims 1,472 students; seed creates 375); (5) migrations additionally seed demo/foreign rows into every tenant (D-18).

---

## 9. UX / UI audit

The design system is the strongest part of the frontend: consistent tokens (`theme.ts`), real component library with keyboard handling, `aria-*` on menus/dialogs/tabs, skip-link, focus-visible, ErrorBoundary at the router root, SkeletonCard loading states, `Empty` component with honest copy, toast system, friendly error mapping (`friendlyErrors.ts`), command palette (⌘K), responsive sweep tooling. The **fabricated** parts are the problem:

| Screen (flagship) | What renders | Reality |
|---|---|---|
| Today | Dashboard with live-event feed, KPI counts | Counts computed over the demo blob (or empty world); "Tally gateway connected — healthy" is a **hardcoded fiction** (Today.tsx:491); event feed = `window` CustomEvents from mock service writes |
| Attention | Priority queue with AI-ranked items | Ranking is client-side over dataset; empty world → empty list (honest) |
| Ask (AI) | "Ask anything" with evidence chains, model/latency/token/cost traces | **Regex puppet**: canned Meridian narratives; `draftStudentBriefing()` returns the same paragraph for any student (`void studentId`); telemetry fabricated (tokens 980, ₹0.08, "Frontier (reasoning) · ap-south-1") |
| Attendance | Section register, mark present/absent | **Write is a no-op mock** (`attendanceService.mark` → `ok()`); server door exists, uncalled |
| Fees | Obligations, retry/bulk retry | `feeService.recordRetry` mutates the seed array in place; "recorded" toast lies |
| Learning | Gradebook, mastery, curriculum | 100% demo construct over the blob |
| Maintenance (13 screens) | Assets, WO lifecycle with AI intake, SLA boards, maps | In-memory `woStore`; AI intake fabricates confidence values; the real `app.work_orders` doors are unused by these screens |
| Insights / AiGovernance / AiUsage / DataHealth / Constitution | Analytics & governance | All dataset fiction; Constitution "policy edits" mutate React state only, toast claims "effective immediately, audit entry recorded" (reload discards) |
| Automation | Workflow list + NL compiler | `compileFromNaturalLanguage` = keyword regex producing a canned WorkflowDef; no workflow runtime exists |
| Migration | Golden-loop console | Client-side staged simulation; "Activate" runs `firstDayScript` from demo/loops and fabricates audit lines; the real doors only move status strings and return `differenceCents: 0` hardcoded |
| PeopleAdmin / LibraryLive / VisitorsBoard / FunnelBoard / coord/* / parent/* / student/* / rails | Live doors | **Genuinely functional** against the API — the product that actually exists |
| TeacherOS (8 screens) | Command center + classroom | Fixture-first with honest per-card source stamps; homework/submissions live where the door is enabled |

**UX-state hygiene:** loading skeletons and empty states are near-universal in the live lanes (useAsync/AsyncGate, friendly ErrorStates, FixtureTag, honest door-off Empties); absent on the whole demo-blob plane (sync renders, unreachable error branches). Destructive confirms exist on PeopleAdmin's 3 real destructive actions (`window.confirm` ×3); unsaved-changes handling is absent (drawer/modal forms discard silently; the attendance draft is dropped on section switch); pagination is client-side `LIMIT` slices — People hard-caps at 60 rows (services:26), Fees history at 40, and several live doors cap at 500 server-side.

**Verified runtime defects (frontend lane, code-confirmed):**
1. **The store boot-capture bug kills an entire product layer in every session — demo included.** `state/store.tsx:49-62` copies `seed` arrays at module-eval, *before* `/dataset` hydration, so `domain.workOrders / actions / cases / notifications / chat / audit` are empty arrays **forever**: the notifications bell renders seed stubs and never `/notifications`, nav badges are always 0, Action Center always says "Queue is clear", **every WorkOrderDetail and CaseDetail renders "not found"**, Next's bands are permanently empty, HR's substitute dispatch is a no-op (it decides a hardcoded `act_3` against an empty array), ParentChat's thread is always blank, and `/audit` shows only in-session entries. This is why the demo itself looks half-dead.
2. **`SLA_POLICY` is `undefined` forever** (dataset.ts:172 evaluates it pre-hydration) → ReportIssue submit throws inside an un-caught promise (services:372) → the staff incident-report pipeline **hangs on the spinner permanently**. Not a crash — a silent dead feature.
3. **Two live parent screens crash with data present:** `/parent/copilot` throws after the first answer for **every tenant** (renders server `sources` objects as React children, Copilot.tsx:142) and its draft door always 400s (missing `kind`); `/parent/family` crashes for **any parent with a linked child** (reads `home.actions`, a field the server aggregate never sends, FamilyHome.tsx:134/243) and its homework column queries a door that doesn't exist.
4. **Live student desks shipped broken:** Noticeboard is permanently "empty this week" on every tenant (client normalizer expects `{assignments,exams,events,clubs}`, server returns `{blocks[]}` — studentApi.ts:387-401); the prints block 404s forever (`/jobs` vs server `/mine`, studentApi.ts:347); StudentHome2 shows "0 classes"/"(untitled item)" from field mismatches; WellbeingQueue guarantees teachers a 403 (client role list includes teacher, server's doesn't).
5. **Empty-world fabrication class:** a fresh tenant's parent sees "Hello Kavita Sharma", "Aarav's fee ₹55,500", "Bus 14 is 13 min late" (server blanking misses DEMO_STUDENT/DEMO_GUARDIAN/FEE_STORY, app.js:293-311), a fabricated **100.0% attendance rate** on zero records (dataset.ts:226), and reception stats "49 calls / 47 answered by AI / NaN%" (dataset.ts:321-335). Financial misinformation aimed at paying customers.
6. **Navigation collapse:** finance has **no `/fees` nav item at all** (verified zero `to:'/fees'` in Shell.tsx) and the sidebar's label-whitelist silently drops Maintenance, Front desk, Data import, Library, Modules, People console and the parent live screens; **parents/students get no desktop navigation whatsoever** (Sidebar omitted for light roles at App.tsx:450, MobileTabbar CSS-hidden >768px) — a laptop parent is an empty shell.
7. **Client gating holes:** `/rails` has zero gating and `/people-admin` is missing from the staffOnly list (App.tsx:200) — a parent session can mount both shells (server still 403s the data; `/capabilities` is authenticate-only, so the module catalog itself is readable by parents); `mapAccountRole` defaults **unknown server roles to principal** (App.tsx:185-187).
8. **Compiled CJS artifacts committed into `src/`** (`lib/format.js`, `lib/rng.js`, `types/domain.js`) — Vite resolves `.js` before `.ts` for extensionless imports, so the app can bundle stale copies (format.js has already drifted); plus ~9 dead liveApi wrappers (`apiFeeObligations`, `apiWorkOrders`, `apiCases`, `apiMemory`, `apiMigration*`, `apiRoutes`, `apiTransportEvent`, `apiNotifications` — zero consumers), an orphaned `screens/Library.tsx`, **6 orphaned teacher screens built against real server doors** (`/teacher/leave*`, `/teacher/concern`, `/ptm/slots`) that were never routed, and QuickActions linking 7 phantom routes.
9. **UTC/IST date-drift cluster:** `toISOString().slice(0,10)` defaults make the Learning homework due-date **yesterday** (functional bug, Learning.tsx:148), plus wrong-"today" defaults in ParentHome/MyLeave/LiveMode/LibraryLive and device-local-vs-IST day boundaries in StudentHome/StudentHome2/Noticeboard; only FamilyHome computes IST correctly. No i18n layer exists (English-only UI; copy advertises Hindi).
10. **Live teacher-lane contract bugs (verified this pass):** the server refuses any grade unless `status==='graded'` (teacher.classroom:168) while the inbox's default review action posts `status:'reviewed'` (SubmissionsInbox:119) — grading through the default path 400s (bulk no-grade review passes; scope-corrected from the cross-check audit); and homework stats read 0 because the server returns `submission_count` (singular, teacher.classroom:87) while the fixtures the UI was built against encode `submission_counts` (plural, teacherFixtures.ts:345) — the fixture layer taught the client the wrong DTO.
11. **The shipped production bundle brands every tenant Meridian:** `app/dist/index.html` carries `<title>SchoolOS — Meridian International Academy</title>` and meta "Demo environment with simulated data" (verified this pass).
12. **Even the live admissions board cannot intake a lead:** `POST /plugins/admissions.funnel/leads` has no client wrapper or caller (liveApi exports list/stage/history only) — FunnelBoard is read/move only.
13. **First-run corridor:** only 8 of 149 empty states carry an action (all "Try again"); the onboarding checklist's `plugins` item is **pre-ticked at birth** (threshold `>1` vs born-on 5), doesn't deep-link the right pane and is invisible to itadmin; the teacher QuickActions FAB routes **9 of 15 entries to unrouted paths** (server doors exist for several, incl. leave); staff on ≤768px are stranded from Homework/Maintenance (5 fixed tabbar items); a 420 ms fake boot delay shows "Meridian" before the session loads.

**Accessibility:** the design-system spine is genuinely strong and verified (Modal/Drawer focus traps, APG dropdown/tabs, roving tabindex, skip-link, `:focus-visible`, reduced-motion, live-region toasts with role=alert, labelled forms, print CSS in Noticeboard/StudentHome2). Verified defects: simulated "delivered/read" states announced to screen-reader users (ParentChat), dangling `aria-controls` in WellbeingQueue, success message styled with the red error class (ParentComplaints), Enter-only `role=button` rows, sub-44px touch targets, unlabelled charts/progress bars — and the deepest a11y failure is that assistive tech is told about states that don't exist.

**Responsive:** MobileTabbar is role-aware but the two mobile-priority staff surfaces (Next, DataHealth) crush at 390px (fixed 340px rails, no media collapse); the repo's own factory-check sweeps only 6 routes × 5 widths — the other ~70 routes are unswept. Print stylesheets are best-in-class where they exist.

---

## 10. Business-rules audit (each rule: implemented / partial / UI-only / missing / incorrect)

| Rule | Verdict | Evidence |
|---|---|---|
| Student must belong to a school | ✅ Correct (FK + RLS + UNIQUE admission) | 001 |
| Parent only accesses linked children | ✅ Correct structurally (child_link) — undermined by name-match fallbacks elsewhere | 034; files.store |
| Teacher manages only assigned classes | ❌ **Missing entirely** (no class-assignment entity; every "teacher-scoped" claim is currently role-trust) | routes.js; ops.timetable |
| Attendance not arbitrarily modifiable | ❌ Incorrect: any teacher, any student, any date, silent overwrite, no correction ledger | routes.js:127-161 |
| Published results need controlled modification | ✅ Correct (publish-lock + digest + approval); marks immutable post-publish | exams.assessment |
| Academic-year boundaries | ❌ Missing (no entity) | schema |
| Fee/payment status logic | ◑ Partial: status machine + one-open constraint + clamped ledger ✅; obligation lifecycle (create/void/refund) ❌ | 006; routes.js |
| Leave approval chains | ◑ Partial: single-level approval, no chain/delegation/balances | hr.leave; teacher.classroom |
| Timetable conflicts | ◑ Partial: substitution SoD ✅; clash detection ❌ | ops.timetable |
| Duplicate admissions | ◑ Partial: UNIQUE(tenant, admission_no) ✅; no duplicate-person detection (name+dob) | 001; CSV import dedupes admission_no only |
| Admissions offer-accepted → student created | ❌ **Missing executor**: approval raises a `students.create.<id>` kernel action (admissions.funnel:184) that **no decide-handler executes** — the funnel's headline conversion creates nobody even after a human approves | grep: zero `students.create` consumers in routes.js/app.js (verified this pass) |
| Inactive users lose access | ✅ Correct (live row re-read) | app.js:50 |
| Withdrawn students | ❌ Missing endpoint; status values exist unreachable | schema |
| Segregation of duties on approvals | ◑ Partial & **inconsistent**: principal↔coordinator pin ✅, proposer≠approver when `proposed_by` set ✅, admissions actions unguarded ❌, role-equality allows any same-role staff to decide ❌ | routes.js:447-456 |
| AI proposes / human approves | ✅ As designed — but "AI" is deterministic templates; the *frontend* Ask surface fakes execution + audit (❌) | services/index.ts |
| Parent notices require approval for delays>10min | ✅ Correct + lineage-linked | routes.js:269-283 |
| Guardian informed of absences | ◑ Partial: comms row queued; delivery depends on worker+rail; UI copy claims sent | routes.js:143-156 |
| Shared-computer student safety | ✅ Correct (30m TTL, no-store, Clear-Site-Data) | app.js; config |
| DPDP: consent immutable, SAR approval-gated, erasure redacts-with-trail | ◑ **Partial**: consent immutability + SAR gating ✅ (tested); erasure redacts only 2 of ~12 PII-bearing surfaces and writes fresh PII into immutable ledgers (D-17) — the "✅ Correct v1" claimed by docs holds only for the narrow tested path | pack.dpdp:204-215; §8 D-17 |

---

## 11. Edge-case and failure analysis (verified behaviors)

- **Double-submit:** payments guarded (one-open partial unique + FOR UPDATE + idempotent confirm) ✅; homework resubmission 409 ✅; **attendance/actions/cases/leads have no idempotency keys** — double-click duplicates rows (leads dedupe by 409 on UNIQUE, cases create duplicates).
- **Network interruption:** no retry/backoff in the frontend fetch wrappers; a failed mutation loses input (no draft persistence); SyncBanner's "offline queue" clears a counter without replaying anything (store.tsx:146-147) — **offline behavior is cosmetic**.
- **Concurrent admins:** last-write-wins everywhere (no version columns, no optimistic concurrency); student transfer is FOR UPDATE-serialized ✅.
- **Huge/malformed input:** CSV caps 500 rows/2MB ✅; files 5MB with ext+mime agreement ✅; JSON body limits on uploads (8MB) ✅; **no limits on case/detail/action text fields** (unbounded TEXT into jsonb payloads).
- **Timezones:** server anchors day-boundaries to `Asia/Kolkata` in Tally/visitors (`AT TIME ZONE 'Asia/Kolkata'`) but `school_date` defaults come from `new Date().toISOString().slice(0,10)` (UTC) in routes — **an attendance mark at 05:30 IST lands on "yesterday"** (UTC date); exams/visitors partially compensate; the frontend date formatting uses local browser tz → the demo's own screens and the real API disagree on "today" for any user outside IST (and for IST users the server-side UTC slicing is the bug).
- **Leap years/DST:** India has no DST; `make_interval` arithmetic is safe; the timetable "next Monday" helper handles month edges correctly (spot-checked).
- **Midnight boundaries:** same UTC-vs-IST issue for "today" registers; the comms dispatcher dedup keys are UUIDs — duplicate absence notices are prevented only by the UNIQUE(tenant,student,date) upsert, not by dedup_key semantics.
- **Deleted/disabled users:** suspension = next-request lockout ✅; **deletion doesn't exist** — no offboarding flow; tokens outlive account deletion-by-SQL (no cascade cleanup of child_link/assignments).
- **Third-party outage:** Razorpay order failure → payment marked failed, retryable ✅ (tested); rails → logger fallback ✅; Google SSO → 502 with clean copy ✅; **no circuit breakers on outbound calls** (fetch without retry), no queue replay for failed provider sends beyond the dispatcher's 8 attempts.
- **Partial workflow failure:** onboarding signup is single-tx ✅; plugin enable/disable audited ✅; **exam publication** approval executes without transactional guard on the snapshot write (approval then write — a crash between leaves an approved action with unpublished exam; recoverable by re-running validate — UNCERTAIN severity).
- **Empty world (new tenant):** code-verified crash set — `ParentHome:39`/`StudentHome:35` (`TERM_DAYS[-1]` on the blanked array → the default landing page of every fresh tenant throws), `Today:393` (teacher role, `DEMO_SECTION_ID!`), Group/MaintMap hardcoded campus-id maps, Learning's permanent dead-retry ErrorState; plus the crash-*with*-data class (Copilot:142, FamilyHome:134) and the fabrication class (100% attendance, NaN% desk stats, demo-identity leak, §9.5). Every fallback link (NotFound, MobileTabbar) routes back *into* the crash screens.

---

## 12. Security red-team review — consolidated severity register

| Severity | Count | Headline items |
|---|---|---|
| P0 | 3 | OTP vault cross-wire → guardian session takeover; dev-SSO door armed in checkout env; cross-tenant OTP/SSO session issuance |
| P1 | 12 | force_change unenforced; student whole-school reads ×2; parent payment deadlock; name-equality identity ×5; login 409 enumeration; demo-SSO in prod bundle; attendance integrity ×2; razorpay RLS gap; approvals SoD holes ×2; exam marks scoping; staging JWT secret; demo-PII corpus posture |
| P2 | ~25 | cross-tenant /metrics; /dataset residual PII (verified by reproduction); broadcast notifications; grant-trap append-only falsehoods; revoked-token DELETE grant; privileged SSRF; gatewayRef laundering; itadmin money-rail power; audit chain vs owner; seeded credentials; onboarding spam; localStorage JWT; no CSP; copilot DoS; GET-with-writes; DPDP executor breadth; clinic/leave/library/comms least-privilege gaps; GPS flood; single-layer tenant filters (comms receipts query has no tenant predicate) |
| P3 | ~20 | enumeration/timing tails; GET-with-write hygiene; XML/CSV injection tails; tz budget edge; role-vocabulary drift (counselor/nurse); metrics info leak; migration-source names to `me`; simulated-GPS integrity; unencoded path params (uuid-guarded) |

**Non-findings (verified negatives, worth stating):** no SQL injection (all parameterized/constant-interpolated); no XSS sinks in app/src; no token-in-URL; no open redirect (return param validated); path traversal guarded; webhooks fail-closed and replay-safe; suspension is effective; parent/staff cross-tenant isolation held under every probe the lanes designed (SQL twin-probes, API second-tenant tokens, INSERT attempts → 42501).

---

## 13. Testing audit

**The suite is the strongest evidence in the repo — and the pipeline around it is the weakest.**

- 29 test files, ~227 `test()` declarations (node reports 232 executed), ~1,270 assertions, real Postgres per file (`DROP/CREATE` + 53 migrations + seed per file), in-process `app.inject` (plus one true-HTTP onboarding file). Serial (`--test-concurrency=1`), 11-20 min.
- Quality: genuinely integration-grade with an authz-negative culture — cross-tenant RLS proofs at the SQL layer (wave-c: 9 tables, twin-probe rows, 42501 on cross-tenant INSERT), SoD and double-pay impossibility tests, hash-chain verification, webhook fail-closed/HMAC/replay tests, OTP attempt caps, degradation-via-DROP-TABLE surgery, calendar-month budget edge. Regression-catching is demonstrated in logs (231/232 at 19:40 → fix → 232/232 at 20:04 same day).
- **Zero coverage** (grep-verified): `/auth/otp/*`, all Google SSO doors, `/notifications*`, `/memory`, `/assets`, the whole migration console, `teacher.support` plugin, `POST /students`, positive `POST /attendance/mark`, `POST /work-orders`, people.admin reset-password; roles `technician@` and `admissions@` never log in during tests.
- **Frontend tests: none.** No test runner, no test files, no testing-library/vitest/playwright in the app package. The 87-route React app is guarded only by `tsc` + manual browser-walk scripts (machine-specific, gitignored artifacts).
- **CI (`.github/workflows/ci.yml`)**: permission-matrix gate (real, fails closed) + serial `npm test` + build + secret-scan. **The `server` job is almost certainly red as committed**: `setupTestDb` connects as `postgres` with no password while the service container runs `POSTGRES_USER: schoolos` and never creates the `schoolos` database that `check.js` points at; no `POSTGRES_HOST_AUTH_METHOD=trust`. No Actions history was verifiable from this environment (no `gh` auth) — statically, the job cannot pass.
- **Soft gates:** `npm audit --audit-level=high || true` (cannot fail); `check.js`'s "RLS baseline" step passes an async callback to a sync runner (never awaited — fails open or dies by unhandled rejection) and only checks two tables exist; `factory-check.mjs` gates tests at `pass ≥ 25` (the suite is 232 — an ~11% floor), requires a seeded demo DB + hardcoded `/usr/lib/code/...` playwright paths → **a local ritual, not a gate**.
- No coverage measurement, no lint in CI (oxlint exists; `lint:eslint` script references an eslint that isn't installed), no SAST, no dependabot, no migration-rollback tests (none exist to test), no load tests.

**Verdict:** a 8/10 test suite attached to a 3/10 pipeline. The tests are honest; the "factory quality bar" is a README sentence.

---

## 14. Performance / scalability audit

- **10 schools / ~10k users:** fine. Every hot kernel query is indexed on (tenant_id, …); pool max 20 with statement_timeout 15s and lock_timeout 5s; rate limits present.
- **100 schools / 100k users:** trouble begins: `GET /dataset` ships a multi-MB blob per session per tenant-empty-world (bandwidth + hydration cost per cold open; ~30 screens re-read module bindings); copilot class-maps do per-cell SELECT+UPDATE loops (pool starvation); ILIKE roster search without trigram indexes; no server pagination on most doors (500-row caps hide it); WebSocket/SSE absent — live updates are polling + window events.
- **1,000+ schools:** architecture holds *only* because RLS is per-row and stateless — but: single Postgres (no read replicas in compose), outbox/comms workers are single-instance pollers (SKIP LOCKED helps, but throughput ceiling), `/metrics` cross-tenant COUNTs scan global tables per scrape, no caching layer anywhere (no Redis), audit/events unbounded (no partitioning), uploads on local disk (multi-instance deployment breaks files.store unless FILES_DIR is shared), and the frontend dataset pattern cannot serve per-tenant truth at all — **the two-worlds problem is the scalability blocker for real tenants**, not the DB.
- **Reporting at scale:** nonexistent server-side; any real reporting would be new engineering, not tuning.
- **N+1 / payload hotspots:** `/students` roster + per-student detail fetches from the UI; dataset revival walks every value recursively (depth 12) client-side; attendance mark issues one INSERT per student serially in a Promise.all of 50+ queries (pool pressure).

---

## 15. Reliability / operations audit

| Area | State | Evidence |
|---|---|---|
| Health/readiness | ✅ `/ready` 503-unless-DB; `/health` degraded-200; Dockerfile HEALTHCHECK polls /ready | app.js:59-69 |
| Metrics | ◑ Prometheus text, counters + pool gauges + queue depths; **no histograms/durations/per-route; cross-tenant leak; bearer-gated (scraper-hostile)** | app.js:347-388 |
| Logging | ◑ pino JSON with reqId/responseTime; no correlation id propagation, no log shipping config | api-boot.log |
| Error tracking / tracing / alerting | ❌ None (no Sentry/OTel; breaker_state is app-internal, not alerting) | grep |
| Backups / DR | ❌ **Nothing.** No pg_dump/WAL tooling, no restore docs, no RPO/RTO; docs promise PITR + ≤4h RTO as prose | docs/04 vs repo |
| Migration safety | ✅ advisory lock + tx-per-file + checksum drift refusal; ❌ no down-path | migrate.js; 041 |
| Workers | ◑ outbox (SKIP LOCKED, backoff, park) ✅ but **no real subscriber** — the "delivery" consumer is a console.log; parked rows are indistinguishable from delivered and the DLQ is invisible in `/metrics`; comms dispatcher ✅ (NODE_ENV=development in compose — documented; **marks undeliverable rows `sent` and holds row locks across network calls**); retention = one-shot, **never scheduled** (cron story is a comment) | compose; outbox-worker; comms-dispatcher; §26 |
| Deploy story | ◑ compose single-host only; api service has **no restart policy**; no SPA production server (staticDir config knob is dead code; README suggests `vite preview`); no staging/CD; no image digest pinning; no `.dockerignore` (27MB context) | Dockerfile; compose |
| Feature flags / kill switches | ✅ SELF_SIGNUP kill-switch, lifecycle gates, FORCES_HTTPS, TRUST_PROXY, dev-door gates — all code-verified | config; onboarding |
| Incident response | ❌ No runbooks beyond server/README; no on-call/break-glass; audit `ip` column never populated | DATA-FLOW honest list |

**Operational blind spots:** you cannot currently restore this system after data loss, you will not be paged when the outbox parks messages or when 5xx rates spike, and the retention promise (DPDP) only runs if someone remembers to schedule the one-shot worker.

---

## 16. Privacy / data governance (engineering controls, no legal claims)

- **Collected:** student PII incl. guardian names/phones, DOB (dataset/seed), health visits (clinic), safeguarding reports (safety box), fee/financial records, staff leave reasons, GPS bus positions, copilot question transcripts.
- **Access control:** tenant RLS ✅; parent child_link scoping ✅; phone masking for teachers on roster ✅; **gaps:** student-role whole-school reads (P1-2/3), clinic history to coordinator/itadmin (P2-12), leave reasons to all DESK staff (P2-13), library overdue export with unmasked phones (P2-14), comms receipts without tenant predicate in SQL (P2-14), audit readable by finance incl. AI transcripts (P2-16), safety-box full-load-then-JS-filter (P2-9).
- **Retention:** OTPs/revocations/oauth states/GPS positions purge via one-shot worker (unscheduled); **no retention for events, audit, communications, notifications, files, copilot transcripts**; per-plugin `retention.on_uninstall` promises are unimplemented (compose comment admits).
- **Deletion/erasure:** DPDP SAR erasure = redact-with-trail, tenant-scoped, consent ledger immutable ✅; **no account-deletion flow, no full-tenant offboarding/export**; docs' "exit is a feature" has no implementation.
- **Minimization/secrets:** temp passwords shown once ✅; plugin settings values masked from non-privileged roles ✅; audit records no secrets ✅; **devEcho returns live OTPs in HTTP bodies** (armed here); logs log phone last-4 only (OTP path) but comms dispatcher logs bodies; `/dataset` demo PII to all tenants (P2-2).
- **Documents:** bytes off-web-path, sha256, audited downloads ✅; local disk, no encryption-at-rest story, no AV scan.
- **Repo residue (delete regardless of any other priority):** the working tree carries ~26 MB of QA debris — `.qa-relcert-tmp` / `.qa-relcert2-tmp` (~6.8 MB, contain expired JWTs and student PII dumps per the cross-checked audit; directories and sizes verified here), `.chrome-profile*` browser state, root logs. PII sitting untracked on disk is a live exposure even though it is not git-tracked.
- **Logging of sensitive values:** copilot questions land in audit rows readable by finance/owner; comms bodies readable by finance/transport; no field-level encryption anywhere (health/safeguarding are masked-at-code only).

---

## 17. Integrations & external systems — real vs mock register

| Integration | Claimed | Reality | Verdict |
|---|---|---|---|
| Google SSO | "Google SSO runs server-side" | Real OAuth code+state flow, fixed Google hosts, email_verified check, no auto-provisioning; dev simulator gated by env (armed here) | REAL (config-gated) |
| Phone SMS (OTP + notices) | "phone OTP works via the listed numbers" | No SMS provider integration; `rails.sms` = logger default + generic-HTTP adapter (https-only, header-auth, 8s timeout); OTP delivery exists only as devEcho | MOCKED (adapter only) |
| WhatsApp (BSP) | "WhatsApp updates" | `comms.whatsapp` = DLT-style template registry + receipts; `rails.whatsapp` = logger/http-generic; **no Meta/BSP integration**; approval path stamps rows 'delivered' with no rail | MOCKED (adapter + fake status) |
| UPI collect | "UPI" rail | `upi://pay?pa=schoolos@<StudentName>` — **fake VPA; money cannot reach the school**; webhook door is real (HMAC/freshness/dedupe) | MOCKED (link), REAL (webhook) |
| Razorpay | "payments" | Real REST order creation (Basic auth, timeout, 3-phase isolation, failure → payment failed/retryable) + signed webhook facts; **no keys configured anywhere; settlement manual** | REAL CODE, UNCONFIGURED |
| GPS tracking | "GPS" | Sine-wave simulator + ingest door; no vendor | MOCKED |
| Tally | "Tally" | Voucher XML export (day-book, ledger mapping); import into Tally is manual; no write-back, no scheduling | REAL EXPORT, MANUAL |
| CBSE / DPDP packs | "India-ready" | CBSE: calendar+publication rules+OASIS-style export (content-hashed, gated); DPDP: consent ledger+SAR+erasure — the most real of the "India" claims | PARTIAL |
| AI/LLM | "AI-native", "AI gateway", "Frontier (reasoning) · ap-south-1" | **Zero model calls anywhere.** Server copilots are deterministic aggregation (honest about it); frontend Ask fabricates model/latency/cost | FAKE (frontend), HONEST-DETERMINISTIC (server) |
| Email | — | **No email capability at all** (no SMTP lib, no verification, no password reset) | NOT IMPLEMENTED |
| Webhooks outbound / API keys / SCIM | docs 02 §3.7 sells them | None | NOT IMPLEMENTED |

---

## 18. Documentation vs reality

- **HANDOFF.md: mostly honest** — its gap list (rails=logger, no email, no billing, AI rule-based, GPS simulator, attendance role-trust, localStorage tokens) matches code exactly, and it is the single best orientation doc. Overclaims: "Ask recomputed from records" (staff Ask is canned) and "purged every demo narrative" (Bus 14 lives in 16 production chunks; Today.tsx:491 hardcodes Tally fiction).
- **README.md: stale + spin-adjacent.** "62 screens/63 routes" (actual 87 route lines/94 screen files); "the frontend has zero mock modules" (production dist contains demo personas; services/index.ts self-describes as mock repositories; teacherFixtures.ts is 1,579 lines of self-declared scaffolding); "School Constitution policy engine" (no tables, no endpoints — React state + hardcoded policy_ref strings); "AI gateway with budgets" (`ai_budget` column never read; zero model calls); "phone OTP works via the listed numbers" (devEcho only); "25/25 server tests" (232; the 25 is the factory floor).
- **docs/01-09:** honest-as-design ([V]/[D] labels, red-team doc self-scores 68→79 and lists unresolved risks) — but README converts their target architecture into present tense.
- **docs/10-12 (plugin platform):** properly labeled "target architecture"; the code implements the registry/drain/budgets (~40%) and nothing of the trust ladder (dead `trust_level` column, T1 hardcoded), signing, marketplace, or 12-of-14 lifecycle states.
- **Generated/truthful docs:** PERMISSION-MATRIX.md (200 routes, 0 unguarded — CI-enforced), ROLE-CAPABILITIES.md (explicit MOCK/dev-echo labels), DATA-FLOW.md (systematic NOT IMPLEMENTED labels — the most honest technical doc in the repo).
- **Dishonest-by-omission artifacts:** FEATURES-STATUS.md shows 13/13 "✅ GA" with zero NOT IMPLEMENTED rows; RELEASE-CERTs are date-stamped snapshots never marked superseded (114 tests then, 232 now).

---


## 19. Code quality / architecture

| Dimension | Grade | Evidence |
|---|---|---|
| Modularity / boundaries | **B+** | Kernel vs plugins split is genuinely clean; loader mounts by convention; shared helpers (`_shared/*`) reused; frontend mirrors the registry. Violations: plugin comments reference kernel line numbers (teacher.classroom "139-150 precedent"), migrations embed fixture users, `app/src` carries two generations of screens. |
| Naming / consistency | **B** | Strong convention discipline in SQL (schema-per-domain), route guards uniform; roles vocabulary drifts in code (`counselor`, `nurse` — not real roles, P3-19). |
| Typing | **B-** | Server is untyped JS; frontend TS is loose around the dataset (`Record<string, unknown>` + per-module bindings); **`tsconfig` has no `"strict"`** — the repo's past crash families are precisely strict-mode catches. |
| Duplication | **C** | 8 duplicated bearer-fetch wrappers; `format.js`/`format.ts`, `rng.js`/`rng.ts`, `domain.js`/`domain.ts` duplicates; two student homes; two parent fee surfaces; doc counts disagree across six files. |
| Error handling | **B** | Server: SAVEPOINT-rethrow, friendly 409 mapping, fail-closed webhooks; frontend friendlyErrors + ErrorBoundary — good. But many `!`-asserts on demo anchors, silent catches in the kernel provider, and **21 `catch {}` swallows** (~8-9 of them discard real server errors). |
| Dead code | **C** | `roleScope()` (auth.js:63) unreferenced; `staticDir` knob with no consumer; `ai_budget` column never read; `fee_plans.installments` unused; legacy screens; `lint:eslint`'s script exists but **eslint is absent from devDependencies and CI** (the cross-checked audit measured 11 errors when forced to run) — lint gates nothing. |
| TODO discipline | **A-** | ~2 TODOs in app, 1 in server; gaps are documented in DATA-FLOW.md instead — unusual and mostly honest. |
| Hacks/workarounds | **C+** | Demo-world key blocklist instead of allowlist; `GET /plugins` self-heal writes; `differenceCents: 0` hardcoded; approvals stamping 'delivered'; window-CustomEvent event bus; migration-created demo accounts. |
| Migration quality | **B+** | Idempotent, checksummed, advisory-locked; undermined by the 005 default-privileges grant trap and by five red-team-cleanup migrations (016/017/019/027/030) purging the project's own earlier hand-provisioned rows — process debt fossilized in DDL. |
| Maintainability | **HIGH RISK** | The two-worlds architecture means every new feature is written twice (kernel door + dataset/mock path); `teacherFixtures.ts` says "delete me when doors are live" and won't be. |

**Debt that becomes expensive soonest:** (1) the dataset/mock parallel universe; (2) grant-trap defaults; (3) name-equality identity pins; (4) untyped server; (5) duplicated fetch wrappers; (6) migration-embedded demo persons; (7) client-side analytics that can never reconcile with server truth.

---

## 20. Enterprise feature-gap analysis

Derived from docs/05+08's own roadmaps, plugin manifests' promises, and code reality. [D] = documented-missing, [U] = undocumented-missing.

### CRITICAL (blocks any real school)
1. **Real delivery rails** (SMS/WhatsApp/email) with provider receipts, quiet hours, fallback [D]. Without: absence/fee/emergency loops fail on day one, and approval-executed comms rows are stamped 'delivered' with no provider — a fabricated trust artifact (§6 F-10).
2. **Academic-year/term model + bulk fee-invoicing engine** [U]. No session entity; obligations cannot be created in-app — **no fee-plan/obligation creation path exists anywhere, server or UI** (skeptic-confirmed: the money core cannot be set up by a real school); installments column unused. A school cannot bill a term — the revenue wedge is absent.
3. **Migration/import engine** beyond students-CSV [D]. The console moves status strings; the trust receipt hardcodes `differenceCents: 0` and flips all sources `verified` while the `imported` columns are written by nothing; no mapping/fix-queue/shadow-load/rollback.
4. **Backup/PITR/restore drills** [D]. Zero tooling; one disk event = unrecoverable child-data loss.
5. **Staff identity hardening** [D]: MFA, domain-scoped SSO for staff, SCIM, httpOnly cookie sessions, password-reset email, enforced `force_change`.
6. **Teacher class-of-record model** [U]: the root fix for P1-7/P1-10 and the prerequisite for real attendance/gradebook workflows.
7. **Two-data-universes coherence** [U]: the flagship loop must render real tenant records; today it cannot.
8. **Full tenant egress** (export everything + signed audit export) [D].
9. **Admissions→student executor** [U]: the offer-accepted approval raises `students.create.<id>` with no executor (§10) — conversion dead-ends after human approval.
10. **Multi-tenant identity resolution** [U]: password login 409s on multi-tenant emails but **Google SSO and OTP silently pick an arbitrary tenant**, and the client has no tenant-picker flow to recover; a student token can read the whole roster, any classmate's fees and 60-day attendance on kernel doors (`roleScope()` is dead code).

### HIGH
Live payments loop (mandates/refunds/settlement reconciliation) · reporting/BI over tenant records · role granularity (custom roles, permissions UI, delegation) · workflow runtime (wf_* are demo fiction) · SLA escalation worker · server-side ranking service · outbound webhooks + scoped API keys · observability (OTel/Sentry/SLOs/status page) · staging/CD/load tests · CSP + secret rotation + break-glass · documents at scale (S3/AV/signed URLs) · i18n/Hindi digests · offline-tolerant PWA · exam depth (bulk marks, per-board policies) · data-health worker.

### MEDIUM
Timetable constraint solver · fee dunning ladders · announcement composer with resolved audiences · certificates · PTM depth · biometric/RFID/GPS vendor connectors · UDISE+ reporting · field-level encryption for health/safeguarding · browser E2E suite · DPDP consent-manager machinery · audit IP provenance + old/new diffs · multi-region residency.

### NICE
AI gateway + real LLMs + eval harness · marketplace/trust ladder · Skill Passport · what-if solvers · 2D campus map · substitute network · cross-tenant benchmarking · hostel/canteen · ~~voice receptionist~~ (**REMOVED FROM SCOPE by owner decision, 2026-09-11** — the founding-concept voice product is no longer part of this project; nothing was ever built for it, so removal touches roadmap only, not code).

---

## 21. Grading

### GRADE A — Current implementation quality: **58 / 100**
Kernel/security engineering 82 · data model 74 · backend domain coverage 55 · frontend product completeness 42 · test quality 78 · pipeline 32 · ops readiness 28 · docs honesty 60 · UX/design system 76 · accessibility 70. The kernel carries the average; the product layer drags it down.

### GRADE B — Enterprise production readiness: **31 / 100**
No backups (0) · CI server-job almost certainly red · no real messaging rails · no academic-year/fees engine · three P0 auth findings · no MFA · in-tenant scoping holes on children's data · no observability/alerting · no DR · single-host deploy story · flagship UI does not write to the database.

## 22. Feature-by-feature scores (0-10) — full table in §3 with per-line evidence
Auth kernel 8 · tenancy/RLS 8 · people.admin 8.5 · visitor desk 8 · files.store 8 · audit ledger 7.5 · onboarding 8 · approvals spine 7 · library 7 · admissions funnel 7 · coordinator lane 7 · homework loop 7 · work orders (server) 7 · attendance (server) 7 / (UI) 2 · payments 5.5 · exams 5.5 · HR/leave 6.5 · health clinic 6 · parent portal 6 · student portal 5.5 · DPDP 5 · transport 4.5 · comms 4.5 · notifications 4 · CBSE 4 · Maintenance flagship 3 · migration console 3 · AI (frontend) 2 · Insights/AiGovernance/DataHealth/Constitution 2 · billing 1 · i18n 1 · backups 0.

### Score rationale
- **Not higher than 58** because the kernel is real, tested (232 integration tests, cross-tenant SQL proofs), the permission matrix is CI-enforced, and ~20 screens work against real doors end-to-end (signup → provisioning → visitor desk → library → parent portal).
- **Not lower than 31 on readiness** only because tenancy isolation, auth mechanics, and money-path invariants are genuinely strong; every other readiness pillar (rails, billing engine, backups, alerting, MFA, product truth) is missing or fake.

---

## 23. Prioritized remediation plan

Estimates assume 3-4 engineers on the existing codebase. IDs are referenced from the findings above. "Acceptance" = the demonstrable end state, not the merge.

### PHASE 0 — STOP THE BLEEDING (week 1; ~1-2 eng-weeks) — none of this ships until done
| ID | Task | Acceptance |
|---|---|---|
| R0.1 | Rotate every secret in `server/.env` (JWT_SECRET is 28 chars; OTP/UPI/Razorpay webhook secrets are committed-adjacent); delete `AUTH_DEV_SSO=1` and `OTP_DEV_ECHO=1` from every environment; make both flags fail-closed (require explicit `NODE_ENV=development`) | `grep -r AUTH_DEV_SSO server/` shows no armed default; P0-2/P0-3 unreproducible in staging |
| R0.2 | Split the OTP vaults: visitor pickup OTPs out of `app.auth_otps` (separate table + `purpose` binding), and make every OTP/SSO resolution query tenant-bound | OTP issued to tenant A's phone cannot verify against tenant B's session (test added) |
| R0.3 | Fix CI: the server job's Postgres superuser vs `POSTGRES_USER: schoolos` mismatch; remove `|| true` from `npm audit`; fix `check.js`'s un-awaited step; stop treating `factory-check` (floor `pass>=25`) as a gate | CI green on a clean clone; audit findings visible as failures |
| R0.4 | `ENABLE/FORCE ROW LEVEL SECURITY` + tenant policy on `plugin_razorpay.order_log/webhook_log`; `REVOKE` the 005 default-privileges trap and re-grant explicitly | `schoolos_app` cross-tenant SELECT on razorpay rows returns 0 (test added) |
| R0.5 | Replace the `/dataset` empty-world **blocklist with an allowlist**; blank ALL seed-derived keys (DEMO_STUDENT, DEMO_GUARDIAN, FEE_STORY, deskSettings, SCENARIOS, workOrders…) for non-meridian tenants | Flattened `/dataset` for a fresh tenant contains zero `seed.*`-derived keys (test added) |
| R0.6 | Fix `store.tsx:49-62` boot-capture (initialize after hydration) and the `SLA_POLICY` pre-hydration const (dataset.ts:172) | Action Center, CaseDetail, WorkOrderDetail, bell render real content in the demo; ReportIssue submits |
| R0.7 | Pin the worst object predicates: `/students` unscoped (P1-2), parent-any-obligation (P1-3), attendance class-check (P1-7), visitor OTP purpose (P0-1 tail), exam SoD (P1-10), `/actions` SoD default (P1-9) | Each has a negative test that fails on the old code |
| R0.8 | Delete QA residue: `.qa-relcert*` (expired JWTs + student PII dumps), `.chrome-profile*`, root logs; rebuild `app/dist` with tenant-neutral title/meta | no PII-bearing untracked directories in the repo; the shipped bundle no longer brands a demo school |

### PHASE 1 — SECURITY & TENANCY HARDENING (weeks 2-4; ~4-6 eng-weeks)
R1.1 object predicates for name-equality identity pins (student.world:105-111, files.store:222-232) → id-based links with migration; R1.2 `audit_append` tenant-pin + move the advisory lock into SQL; R1.3 `UNIQUE(tenant_id, lower(email))` + deterministic resolution; R1.4 httpOnly cookie sessions (bearer fallback for API clients) + token-in-localStorage retirement; R1.5 staff MFA (TOTP) + enforced `force_change` + change-password door (client **and** server — neither exists); R1.6 per-tenant `/metrics` + `/dataset` auth tightening; R1.7 rate limits on OTP/login/webhooks per-tenant; R1.8 CSP + security headers; R1.9 Razorpay webhook payload minimization; R1.10 DPDP erasure completion (D-17): guardians, communications, webhook payloads, OTP phones + stop writing PII into immutable ledgers. *Acceptance: security lane's P0/P1 register re-run = zero findings; cross-tenant proof suite extended to every new door.*

### PHASE 2 — MAKE THE PRODUCT TRUE (weeks 3-8; ~8-12 eng-weeks) — the highest-value work in this repo
R2.1 Re-point the flagship staff screens to the **existing, tested doors**: Attendance → `POST /attendance/mark`, Fees → `/fees/*`, Action Center → `/actions`, Work orders → `/work-orders*`, Cases → `/cases*`, Audit → `/audit`, bell → `/notifications`, Memory/Migration/Transport likewise; R2.2 delete or quarantine `services/index.ts` and the AiDock canned service (every fake toast site, ~20, dies with it); R2.3 fix the live-lane contract bugs (Copilot:142 crash, FamilyHome `home.actions`, Noticeboard blocks-normalizer, prints `/jobs`→`/mine`, Requests discrepancy 400, SharedDetail `detail` drop, **the grading contract — `grade` requires `status:'graded'` (teacher.classroom:168) while the inbox posts `'reviewed'` — and `submission_count` vs `submission_counts` (teacher.classroom:87 vs fixtures:345), plus the 5 wrong client paths** (`/student/tasks/:id/toggle`, `/student/print/jobs`, `/parent/child/:id/assignments`, `/parent/explain?topic=`, …)); R2.4 academic-year/term entity + bulk fee-invoicing (obligation create/void in-app); R2.5 teacher class-of-record entity (root fix for P1-7/P1-10, prerequisite for real gradebook); R2.6 student edit/withdraw/promotion endpoints + `enrollment_history` on all status changes; R2.7 wire the 6 orphaned teacher screens to their real doors and register routes; R2.8 remove the compiled `.js` shadows, dead wrappers, orphaned Library.tsx; R2.9 one nav model (fix the sidebar whitelist, finance /fees item, desktop nav for parent/student); R2.10 **make the UI↔door law mechanical**: extend `permission-matrix.js` to also grep `app/src` for each door's caller and fail CI when a write door has zero UI consumers or a screen imports the mock layer (the single guardrail that prevents the two-universes regression); R2.11 enable `"strict": true` (about a day of fallout — it is the cheapest prevention of the repo's past crash families) and add FunnelBoard create-lead + the missing `students.create` executor so the funnel conversion completes. *Acceptance: a fresh tenant can run attendance → absence notice → fee record → approval with zero demo data on screen, and the two-universes map (§4.5) has no MOCK-WRITE rows left.*

### PHASE 3 — ENTERPRISE FLOOR (weeks 6-12; ~6-10 eng-weeks)
R3.1 backups: WAL archiving + PITR + nightly logical dumps + **documented, rehearsed restore** (RPO ≤ 15 min target); R3.2 observability: structured logs with request ids, RED metrics per door, Sentry or equivalent, alerting on worker lag/error rate; R3.3 real delivery rails (SMS/WhatsApp/email) with provider receipts replacing the logger default, quiet hours, retry/dead-letter — and delete the hardcoded 'delivered' stamp (routes.js:461-469); R3.4 staging environment + CD pipeline + load test at 100 schools/5k students; R3.5 retention scheduling for `outbox/events/audit_log/communications/webhook_logs` (the unbounded four + payloads) with chain-preserving audit archival; R3.6 secret rotation runbook + break-glass procedure; R3.7 i18n foundation (dictionary layer) — the product sells bilingual and ships English-only; R3.8 minimal scheduler (cron already exists in docker-compose) for preventive-WO generation, Tally export scheduling and the retention sweep, plus DLQ visibility in `/metrics`; R3.9 generic manifest-driven plugin-settings form — lights up ~6 orphaned plugins (DPDP/CBSE/clinic/timetable-grid) at once.

### PHASE 4 — PRODUCT COMPLETION (months 3-6; ~12-20 eng-weeks)
Migration/import engine with field mapping, fix-queue, shadow-load and a **real** reconciliation receipt (replace `differenceCents: 0`); payments live loop (mandates, refunds, settlement reconciliation — paid_cents SUM-invariance); exam depth (bulk marks grids, per-board policies); timetable clash detection; fee dunning; reporting/BI over tenant records; server-side ranking; role granularity + permissions UI.

### PHASE 5 — ADVANCED (months 6+; open-ended)
Real AI gateway with model policy + evals (retire fabricated telemetry); workflow runtime (the wf_* fiction becomes real or is deleted); marketplace/trust ladder; outbound webhooks + scoped API keys; UDISE+ exports; custom roles. *(The AI voice receptionist — previously listed here as the founding concept — was REMOVED FROM SCOPE by owner decision, 2026-09-11.)*

**Effort to grades:** Phases 0-3 executed fully ⇒ GRADE A ≈ 80-85, GRADE B ≈ 75-80 (sellable to a pilot cohort of friendly schools). Adding Phase 4 ⇒ 90+. Adding Phase 5 + a year of hardening ⇒ 95+ (defensible enterprise). Nothing above Phase 2 is worth doing before R0/R1/R2 land — the demo layer would keep lying underneath it.

---

## 24. What is actually done — the honest inventory

**THIS IS IMPLEMENTED (works end-to-end, verified):** Fastify kernel (auth, sessions, jti denylist, OTP + password lanes, Google SSO plumbing, demo door); RLS tenancy with per-request `SET LOCAL ROLE`; the 200-route permission matrix with a CI gate that fails on drift; hash-chained append-only audit ledger + `event_action_link` lineage; event spine + transactional outbox + SKIP LOCKED workers; plugin loader, 14-state lifecycle, enable/disable with audit; onboarding → tenant provisioning (single-tx, tested); people.admin console (staff CRUD, suspend, CSV import ≤500 rows, transfer, temp-password issuance); visitor desk (badge issue, checkout, pickup OTP — modulo P0-1); library (catalog, issue/return, fines); admissions funnel live board + SoD'd stage moves; coordinator lane end-to-end (substitution SoD, workload, curriculum monitor, approvals); teacher homework/submissions loop (live + fixtures, honest tags); parent consents (immutable decisions), complaints (`/my-cases`), requests (partial); files.store (sha256, ext/mime agreement, traversal-guarded); Tally XML export (modulo injection); Razorpay order creation + fail-closed replay-safe webhooks (facts-only); fee confirm path with clamped ledger + one-open constraint; exams validate/publish with snapshot digest + publish-lock; DPDP consent ledger + SAR approval gating (narrow sense); migration discipline (advisory lock, per-file tx, sha256 drift refusal); 232 integration tests including cross-tenant RLS proofs and authz-negative suites; the newest frontend lanes' UX discipline (AsyncGate, FixtureTag, honest Empties, focus-trapped dialogs, print CSS).

**THIS ONLY APPEARS IMPLEMENTED:** Today/Action Center/Attendance/Fees/Audit/Cases/Maintenance (13 screens)/Insights/AiGovernance/AiUsage/DataHealth/Constitution/Automation/Migration console/HR/ItAdmin/Settings — demo-blob or mock-write surfaces with fake success toasts (~20 sites); all "AI" surfaces (regex puppets with fabricated model/token/cost traces); notifications bell; workflow automation (no runtime); comms delivery status ('delivered' stamped with no provider); migration golden loop (`differenceCents: 0`); "WhatsApp Connected · 99.2%" settings fiction; GPS tracking (sine-wave simulator); UPI deep links (fake VPA).

**THIS IS NOT IMPLEMENTED:** backups/PITR/restore; real SMS/WhatsApp/email rails; MFA; change-password/force_change enforcement; academic year/term; refunds; obligation lifecycle; student withdraw/edit; teacher class assignment; timetable clash detection; workflow runtime; i18n (no framework); observability/alerting; staging/CD; reports/BI; outbound webhooks/API keys; real LLM integration; exam UI depth; bulk operations beyond CSV import.

**Top-20 problems (condensed from the register):** P0-1 OTP vault cross-wire · P0-2 dev SSO armed · P0-3 cross-tenant session issuance · store boot-capture kills a product layer · server bypass (flagship UI never calls the real doors) · razorpay RLS absent · grant trap 005 · empty-world demo-identity leak + financial misinformation · ReportIssue permanent hang · Copilot/FamilyHome crashes on live screens · `/dataset`+`/metrics` cross-tenant exposure · OTP/SSO phone-only resolution · no backups · CI server job broken · no academic year/fees engine · name-equality identity pins · SoD gaps (admissions/exams/actions) · fabricated AI telemetry & stats · paid_cents without refunds/reconciliation · DPDP erasure platform-incomplete.

**Top-20 improvements (condensed):** allowlist `/dataset` · split OTP vaults · object predicates everywhere (tenant+role+resource) · re-point flagship UI to live doors and delete the mock plane · academic-year + fee engine · teacher class-of-record · backups + restore drill · real rails with receipts · per-tenant metrics + alerting · httpOnly cookies + MFA + force_change · lower(email) unique · audit_append tenant-pin · DPDP erasure completion · shared client/server DTO layer · i18n dictionary · retention for unbounded tables · staging + CD + load tests · UI↔door parity CI gate (fail on orphan write doors and mock-layer imports) to kill the drift family permanently · wire the orphaned teacher screens · one nav model.

---

## 25. BRUTALLY HONEST FINAL VERDICT

**What this project is:** a genuinely well-engineered, well-tested **multi-tenant SaaS kernel** wearing a **film-set product** as its public face. The kernel (auth, tenancy, audit, events, plugin lifecycle, migration discipline, test culture) is roughly **75-80% production-grade** and better than most early-stage codebases I have audited. The backend domain layer is ~55-60% real (solid where it exists, riddled with under-scoped object predicates). The frontend product is ~30% real — the newest lanes work, the flagship loop is a demo. Operations readiness is ~15%. As a **sellable product** the whole is roughly **45-50% of the way there**; as a **platform foundation** it is most of the way there.

**Classification: functional prototype, pre-MVP.** Not a throwaway hack — the bones are real and worth keeping. Not production — three P0 auth findings, zero backups, a broken CI server job, and a UI whose headline loop does not write to the database make that a matter of record, not opinion.

- **Biggest risk:** demo-truth leakage into real tenants — a paying parent is shown another child's demo fee ("₹55,500", "Receipt sent on WhatsApp") and a fabricated 100% attendance rate, while ~20 success toasts assert writes that never happened. That is financial misinformation and a trust-destroyer aimed at schools, compounded by P0-1/P0-2/P0-3 in the auth path.
- **Biggest architectural weakness:** the two-universes split (dataset/mock plane vs kernel doors). Every feature is written twice, the flagship screens read the fake one, and the store bug means even the demo is incoherent. This single decision caused the majority of frontend findings.
- **Biggest security weakness:** identity resolution by phone/name equality across un-pinned vaults and tables (OTP cross-wire, student.world, files.store), plus dev doors that shipped armed and a case-sensitive email unique that permits wrong-account resolution.
- **Biggest product gap:** no academic year/fee engine — a school cannot bill a term — so the revenue workflow, the reason schools buy software, is absent while dashboards celebrate fictional money.
- **Biggest scalability concern:** unbounded append tables (events, outbox, audit, communications, webhook payloads) with no partitioning, no archival, missing hot-path indexes (login itself seq-scans), a 10-connection pool doing per-cell N+1 copilot writes, and a single-host deployment story with no DR.
- **What must happen before "enterprise-grade":** Phase 0 and 1 in full (secrets, vaults, RLS on money tables, object predicates, MFA, httpOnly, rate limits); Phase 2 (the UI must operate the database it demos); Phase 3 (backups with a rehearsed restore, observability, real delivery rails, staging + CD); Phase 4 for commercial completeness. Roughly 4-6 months of focused work by 3-4 engineers to a defensible 90+; anything less leaves the film set standing.

**THE BOTTOM LINE:** the backend is real, the tests are real, the tenancy is real — and the product the user sees is, to a first approximation, a movie. THIS IS NOT IMPLEMENTED: operations, delivery rails, the fee term, or real AI. THE FRONTEND IS A SET: beautiful, accessible, and lying. The honest path forward is unglamorous and completely achievable: spend week one on Phase 0, then spend a quarter making the screen tell the truth. The kernel deserves it. *(Post-audit owner note, 2026-09-11: the voice receptionist — the founding concept this company was named for — has been removed from project scope by owner decision; the grades above were never weighted on it, and no code referenced it.)*

---

## 26. Cross-check: independent 32-agent audit (`docs/AUDIT-FULL-2026-09-10.md`)

A second, independent audit — 32 agents (API surface map, frontend route map, 6 specialist auditors) with 18 adversarial skeptic passes and ~180 of ~207 findings re-verified — ran against the same commit. Its evidence files are in `.audit/` (`parity.md`, `server-gaps.md`, `dead-controls.md`, `hygiene.md`, `ux.md`, `skeptic-*.md`). This section records the reconciliation; its verified findings are now folded into the sections above (marked "cross-check" or "verified this pass").

### Convergence (independent agreement on the core verdict)
Both audits reached the same structural conclusion: **strong server kernel, strong UI design system, and a broken seam** — the demo→live migration stopped halfway, and the flagship UI operates a mock brain while ~three-quarters of the real API has no caller. The critical sets overlap almost exactly: SLA_POLICY undefined (ReportIssue dead), empty-world demo-identity leak, TERM_DAYS crashes, attendance/fees write theater, canned AI with fabricated traces, Audit-screen fiction, maintenance store snapshots empty forever, migration trust receipt fabrication, cases reducer-only, Settings' fake DPDP rights, ItAdmin toast-only security ops, ParentChat fabricated delivery. Both flag **no fee-plan/obligation creation path anywhere** as the one true central NOT-IMPLEMENTED, and both find README/HANDOFF numbers stale.

### Adopted after verification here (new to this report)
| Finding | Verification | Folded into |
|---|---|---|
| `students.create` approval action has **no executor** — admissions conversion dead-ends after human approval | grep: zero consumers in routes.js/app.js; raiser confirmed at admissions.funnel:184 | §10 new row; §20 CRITICAL-9; R2.11 |
| Server returns `submission_count` (singular, teacher.classroom:87); fixtures/UI encode `submission_counts` (plural) → live stats read 0 | grep both sides | §9.10; R2.3 |
| Grading contract: grade requires `status:'graded'` (teacher.classroom:168) while the inbox's default review posts `'reviewed'` (SubmissionsInbox:119) — **scope-corrected**: grade+reviewed 400s; bulk no-grade review passes (the source audit's "always fails" was over-broad) | code read of both sides | §9.10; R2.3 |
| Production `app/dist/index.html` ships `<title>SchoolOS — Meridian International Academy</title>` + "Demo environment with simulated data" | read this pass | §9.11; R0.8 |
| FunnelBoard cannot intake: `POST …/leads` has no client wrapper/caller | liveApi export grep | §9.12; R2.11 |
| QuickActions FAB: **9 of 15** entries unrouted (source's skeptic recount; the frontend lane had counted 7) | adopted skeptic count | §9.13 |
| Outbox has **no real subscriber** (console.log); parked rows indistinguishable from delivered; DLQ invisible in metrics; comms dispatcher marks undeliverable rows `sent` and **holds row locks across network calls** | adopted (consistent with my worker reads) | §15 workers row |
| `.qa-relcert*` (~6.8 MB) hold expired JWTs + student PII dumps; `.chrome-profile*`, root logs — delete now | dirs + sizes verified; contents per source audit | §16; R0.8 |
| `tsconfig` lacks `"strict"`; eslint absent from devDeps & CI; 21 `catch {}` swallows (~8-9 discard real server errors) | package.json verified | §19; R2.11 |
| Only **8 of 149 empty states** carry an action; onboarding checklist `plugins` item pre-ticked at birth (threshold `>1` vs born-on 5), invisible to itadmin; 5 wrong client paths (`/parent/explain?topic=` newly noted); staff ≤768px stranded from Homework/Maintenance; 420 ms fake boot delay | adopted from skeptic-calibrated UX pass | §9.13; R2.3/R3 |
| Google SSO & OTP **silently pick an arbitrary tenant** on multi-tenant emails (client has no picker flow) — sharpens my P0-3 | consistent with security lane | §7; §20 CRITICAL-10 |
| **UI↔door parity scoreboard (204 doors): 37% wired · 47% orphan · 11% mock-only · 2% demo-only · 3% webhook/ops** | adopted as the headline quantifier | §0; §4.5 framing |
| Structural guardrail: extend `permission-matrix.js` into a UI-caller parity gate + no-mock-imports CI rule | adopted as R2.10 | §23 |

### Discrepancies reconciled
- **Test count:** 232 (test logs, tests lane) vs "~227" (source audit) — same suite, different counting; immaterial.
- **`lint:eslint`:** my "references an uninstalled package" and their "11 errors" are both true — the script exists, eslint is absent from devDeps, and errors appear only when forced; either way nothing gates on it.
- **Screen-count framing:** "~45 of ~80 routes demo" (my map) vs "~24 of ~74 staff screens on the mock brain" (theirs) — different denominators, both true; the door-based parity scoreboard is the cleanest metric and is now headline.
- **`check.js`:** my "async step bug" and their "always-green placeholder where DB reachability should gate" describe the same defect from two sides.

### Where each audit goes further
The source audit goes further on **quantified parity** (`parity.md`'s 96 orphan doors with plugin-level lists — clinic 5/5, dpdp 6/6, cbse 3/3, hr 4/4, files 3/3, whatsapp 3/3, tally 3/3, gps 2/2, timetable 4/4, teacher.support ~22/22), the **empty-state census**, and **repo hygiene**. This report goes further on the **auth/RLS deep dive** (P0-1/P0-2/P0-3, per-table RLS proofs, grant trap, audit_append tenant-pin, BYPASSRLS dependency, seed orphaning, DPDP erasure analysis), the **role-by-role and data-flow chapters**, and the **graded, acceptance-criteriad remediation plan**. 

**Net effect on grades: none required.** Every adopted finding was already represented in the severity mix (P1/P2 or quantification of known classes); no new P0 emerged from ~207 independent findings — which is itself the strongest corroboration this report's 58/31 could have asked for. Two independent audit methodologies, one verdict: the kernel is real, the product is a set, and the seam is the project.
