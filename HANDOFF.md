# SchoolOS — Agent Handoff

> **Read this first.** Everything an incoming agent needs: current state, what is real,
> what is simulated, what is missing, the project's laws, and every operational trap.
> Last verified: 2026-09-09 · HEAD `b86d6fa` (pushed) · suite **232/232** · dev DB **empty**.

---

## 0. What this product is

SchoolOS is an **India-first, multi-tenant AI school receptionist / school OS**. A school
owner signs up, provisions staff, admits students, and runs the entire school — fees,
attendance, transport, library, visitors, exams, HR, communications — from one React SPA.
The founding doctrine: **every user is non-technical** — everything must be a UI
operation, never an API/technical expectation. A deterministic AI layer (Ask screen,
copilots, briefings) reads records under role permissions and proposes actions through
AUTO / APPROVAL / HUMAN-ONLY postures; nothing sends or changes without approval.

There are **two builds**:
- **Real build** (what the current user runs): self-serve onboarding at `/onboard`,
  empty-at-birth world, live Postgres behind every door.
- **Demo build** (`VITE_DEMO_MODE=1` at build time): the Meridian International Academy
  demo world (DemoDay, LiveMode, demo role-switcher). Demo screens are **excluded from
  production builds** (`app/src/App.tsx:27,116`).

---

## 1. Current state (verified at handoff)

| | |
|---|---|
| HEAD | `b86d6fa` — "Fix: IT-admin role crash on fresh schools" (pushed to origin) |
| Dev DB `schoolos` | **0 tenants, 0 users, 0 students** — deliberately wiped; schema + 53 migrations + 110 capability contracts intact |
| Test DB `schoolos_test` | dropped; recreated by any test run (`setupTestDb()`) |
| API | `:8080`, boot log `server/api-boot.log` — running |
| UI | `:4310` (`npx vite preview` from `app/`, serves `app/dist/`) — running |
| Workers | outbox-worker + comms-dispatcher running (logs in `server/*.log`) |
| Postgres | 18.4 at `127.0.0.1:5432` — DBs: `schoolos` (dev), role `schoolos`/`schoolos_dev_pw`; admin role `postgres` (passwordless local); test DB `schoolos_test` |
| Node | v26.4.0 |
| Suite | 232/232 green across 30 files (253 declared tests; some skip-conditionally) |

**The sanctioned entry into a fresh dev platform is `http://127.0.0.1:4310/onboard`**
(signup → owner auto-login → checklist: create IT admin → admit students → switch on
modules). `scripts/seed.js` creates the Meridian demo world and is **only** for demo
builds — it was deliberately NOT run on the current dev DB (the user ordered every
school/demo remnant destroyed; it has been truncated repeatedly and must stay empty).

---

## 2. Repo map (what lives where)

```
schoolOS/
├── server/
│   ├── src/
│   │   ├── index.js            entry; refuses WORKER_ROLE=1
│   │   ├── app.js              Fastify build: jwt, multipart, rate-limit, security
│   │   │                       headers, /dataset (+ empty-world override, no-store),
│   │   │                       /metrics, /capabilities, loadPlugins, requireRole
│   │   ├── routes.js           core doors: auth, students, attendance, fees, transport,
│   │   │                       documents, cases, incidents, notifications, events,
│   │   │                       audit, memory, plugins, logout (jti revoke + Clear-Site-Data)
│   │   ├── onboarding.js       /onboard/signup|school|status (self-serve owner path)
│   │   ├── plugin-catalog.js   23-row registry seeded at signup; DEFAULT_ON = 5 core modules
│   │   ├── auth.js             scrypt passwords, OTP vault, Google SSO, jti mint/verify
│   │   ├── audit.js            append-only hash-chain audit + emitEvent (events+outbox atomically)
│   │   ├── db.js               pg pool; withUser() = SET LOCAL ROLE schoolos_app + tenant GUC
│   │   ├── governance.js       event budgets, rate caps, makeLifecycleGate factory
│   │   ├── dataset.js          server-evaluated Meridian demo blob (vm)
│   │   ├── config.js           env contract (see §5)
│   │   └── plugins/            25 runtime plugins + _shared + loader.js (see §4)
│   ├── migrations/             53 SQL migrations, applied by scripts/migrate.js
│   ├── scripts/                bootstrap, migrate, seed, outbox-worker, comms-dispatcher,
│   │                           retention-worker, check.js, permission-matrix.js, schoolDay.js
│   ├── tests/                  30 files, serial runner (see §8)
│   └── .env / .env.example     secrets (gitignored); key names in §5
├── app/
│   ├── src/App.tsx             87 routes, AuthGate, Guard, KernelGate, demo exclusion
│   ├── src/plugins/            useKernel (server-truth mirror), pluginRegistry (23 manifests)
│   ├── src/state/store.tsx     session, domain reducer, demo roster (mock only)
│   ├── src/data/dataset.ts     typed dataset module; hydrate once/page; empty-world defaults
│   ├── src/services/           liveApi (all doors), adminApi, onboardingApi, parentApi,
│   │                           studentApi, coordApi, capabilitiesApi, sessionIdentity
│   ├── src/screens/            74 screens + coord/ parent/ student/ teacher/ subdirs
│   └── dist/                   built bundle (vite preview serves this)
├── docs/                       30 files — see §9 (DATA-FLOW.md is the map)
├── scripts/                    crash-hunt.mjs, itadmin-hunt.mjs (browser walkers)
└── HANDOFF.md                  this file
```

---

## 3. Architecture in ten lines

1. **Tenancy**: row-level. Every tenant table is `FORCE ROW LEVEL SECURITY` with
   `tenant_id = current_setting('schoolos.tenant_id')`. Every request flows
   `require(roles)` → handler → `withUser(tenantId, role, fn)` which `SET LOCAL ROLE
   schoolos_app` + sets the GUC (`server/src/db.js`). The `postgres` role bypasses RLS
   (why raw-psql probes see everything).
2. **Auth**: email+password (scrypt), phone OTP (`OTP_DEV_ECHO` returns devCode in dev),
   Google SSO (`AUTH_DEV_SSO` dev bypass). JWT with `jti`; `/auth/logout` revokes jti
   (`auth.revoked_token`) and sends `Clear-Site-Data: "cache", "storage"`. Same email in
   ≥2 tenants → login answers **409 choose-your-school**, never a silent wrong-tenant pick.
3. **Audit**: `app.audit_log` is append-only with a per-tenant **hash chain** (GENESIS →
   prev_hash; advisory xact lock). `emitEvent` writes an `app.events` row (human spine)
   and an `app.outbox` row (machine envelope) **atomically with the data** (40+ real topics).
4. **Plugin kernel**: 23 first-party plugins in `app.plugins` per tenant (version, class
   A–E, status in a 14-state lifecycle, manifest, permissions, entitlement, budgets,
   settings). Enable/disable is an **audited owner/itadmin action**; `makeLifecycleGate`
   409s every door of a switched-off plugin with plain-language copy. The **server table
   is the truth of record**; the frontend mirrors it (`useKernel`) for instant UX and
   re-syncs from `GET /plugins` on mount.
5. **Catalog-at-birth**: `server/src/plugin-catalog.js` seeds all 23 rows during signup
   (inside the signup transaction, after `set_config('schoolos.tenant_id', …)` — RLS
   WITH CHECK demands the GUC). `DEFAULT_ON = people.admin, ops.visitors, library,
   ops.timetable, files.store`; credential rails stay off. `GET /plugins` **self-heals**
   any tenant with missing rows.
6. **Onboarding**: `POST /onboard/signup` (public, 3/min/IP, `SELF_SIGNUP_ENABLED`
   kill-switch) creates tenant + owner + catalog + audit + event in ONE transaction and
   auto-logins. `/onboard/school` (owner) updates profile; `/onboard/status` drives the
   welcome checklist. Signup creates an **empty** tenant — no seed data ever.
7. **Dataset serving**: `GET /dataset` returns the tenant's world (demo blob for the
   demo tenant; **empty world** for every real tenant — `server/src/app.js` overrides
   every collection key and carries `cache-control: no-store`). The frontend hydrates it
   once per page load into typed module state (`app/src/data/dataset.ts`).
8. **Money/PII discipline**: every write commits data + audit row + outbox row together;
   payments settle through obligation states; DPDP consents are append-only; SARs have a
   state machine; students have enrollment history on transfer.
9. **Frontend role model**: 12 roles (owner, principal, coordinator, itadmin, finance,
   admissions, transport, facilities, technician, teacher, parent, student). `Guard`
   redirects parent/student away from the `staffOnly` route list; light roles get their
   own surfaces. `KernelGate` hides switched-off modules — and for owner/itadmin shows a
   **one-click "Turn on"** button (dead-end impossible).
10. **Workers**: outbox-worker (event delivery pacing/retries) and comms-dispatcher
    (message queue → provider) poll the DB; neither listens on HTTP. `WORKER_ROLE=1`
    processes skip JWT/CORS guards by design.

---

## 4. Plugin inventory (all 25 folders)

| Plugin | Class | What it actually does | Tests |
|---|---|---|---|
| people.admin | B | Full identity console: list/provision/suspend/activate users, temp passwords (shown once), password reset, student transfer w/ enrollment history, CSV student import (2MB cap) | onboard 12, plugins 4 |
| ops.visitors | C | Visitor desk: pre-registration, check-in/out, pickup OTP verify | visitors 12 |
| library | C | Catalog, issue/return, **UTC-calendar fine calculation**, retire | plugins, api |
| ops.timetable | C | Periods/slots, substitutions, deterministic attendance period-autofill | wave1 6 |
| files.store | B | Artifact storage (kernel-native), storage/ dir, 2MB caps | api |
| hr.leave | C | Leave requests, duty roster, substitutions feed | hr-clinic 8 |
| health.clinic | C | Sick passes, clinic log, health issues | hr-clinic |
| exams.assessment | D | Exams, marks, moderation, report cards | exams 10 |
| pack.cbse | C | CBSE obligations calendar, exam compliance | cbse 5 |
| pack.dpdp | C | DPDP consent ledger (append-only), SAR state machine, two-person rule | dpdp 9 |
| admissions.funnel | C | Lead capture, stage machine, offer/accept, session-bound ownership | admissions 8 |
| payments.upi | B | UPI collect intents, obligation settlement, `UPI_WEBHOOK_SECRET` door | upi 5 |
| payments.razorpay | B | Order rails, webhook `payment.captured/failed` (`RAZORPAY_WEBHOOK_SECRET`), order/webhook logs | upi |
| accounting.tally | B | Tally reconciliation export | tally 1 |
| transport.gps | B | Routes, GPS positions, delay detection → guardian notifications, simulate-breakdown drill | api |
| rails.sms / rails.whatsapp / comms.whatsapp | B | Outbound message rails. **Provider = 'logger' by default** (structured log + ok). `http-generic` provider supported; real BSP/vendor needs per-tenant settings + operator DLT compliance | rails 10 |
| teacher.classroom | C | Homework, submissions, classroom ops | teacher-classroom 13 |
| teacher.support | C | Concerns, safeguarding (HUMAN-ONLY posture), counseling trail | b9-confidentiality 6 |
| teacher.copilot | C | **Deterministic** teaching copilot (briefs, mastery, curriculum) — no LLM | teacher-copilot 19 |
| parent.assistant | C | **Deterministic** parent copilot over linked children (460 lines, zero LLM) | parent-assistant 18 |
| family.view | C | Guardian↔child linking, consent, requests, timeline | parent-family 10 |
| student.world | C | Paper-first student plane: print queue, wellbeing requests, noticeboard | student-world 11 |
| coord.view | C | Coordinator command center, substitution review, workload, escalations | coord-view 11 |

---

## 5. Environment contract

`server/.env` (gitignored; `.env.example` documents it). **Key names only here — never
commit values.**

| Key | Dev value / behavior |
|---|---|
| `DATABASE_URL` | `postgres://schoolos:schoolos_dev_pw@127.0.0.1:5432/schoolos` (fallback in config.js) |
| `JWT_SECRET` | dev fallback `dev-only-secret-change-me`; **production boot fails <32 chars** |
| `NODE_ENV` | `production` + localhost DB → refuses to boot |
| `PORT` | 8080 |
| `OTP_DEV_ECHO` / `AUTH_DEV_SSO` | demo opt-ins; code ignores them in production |
| `UPI_WEBHOOK_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | webhook HMAC doors (present in dev .env) |
| `SELF_SIGNUP_ENABLED` | unset ⇒ allowed in dev; **forbidden in production unless set true** (kill-switch) |
| `TRUST_PROXY`, `CORS_ORIGINS`, `FORCES_HTTPS`, `RATE_LIMIT_MAX` | deployment hardening knobs |
| `WORKER_ROLE` | `1` = event-spine process (no HTTP guards) |
| `SMS_PROVIDER`, `WHATSAPP_BSP_PROVIDER` | provider selection for rails |
| `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | real Google SSO (unset in dev) |
| `OTP_TTL_MS`, `OTP_MAX_ATTEMPTS`, `OUTBOX_*`, `COMMS_*` | tuned worker/auth knobs (P2 boot guards) |

Frontend build flags: `VITE_API_BASE` (pinned at build; same-origin contract),
`VITE_DEMO_MODE=1` (demo build only).

---

## 6. IMPLEMENTED — working, tested, verified live

- **Self-serve onboarding** end-to-end (signup→IT admin→students→modules), 12/12 tests,
  browser-verified. Owner checklist; ambiguity-guarded login; catalog-at-birth (23 rows,
  5 born-on); owner "Turn on" button on every gated page.
- **Core operations**: students (admission, transfer+history, CSV import), attendance
  (register, autofill, anomaly lens), fees (plans→obligations→payments→receipts, retry,
  UPI intents, Razorpay webhook doors), timetable/substitutions, transport (routes, GPS
  feed, delay→notify), documents registry with expiry, cases+incidents with triage chain,
  work orders/preventive maintenance/assets/vendors, HR leave+duty, health clinic,
  library (fines in UTC), visitors desk with pickup OTP, admissions funnel, DPDP pack,
  CBSE pack, exams+report cards, accounting export.
- **Identity & governance**: 12 roles, 177-route permission matrix (generated,
  fail-closed via `npm run check`), jti revocation, rate limits, security headers,
  secret scan, `/metrics` + `/capabilities`.
- **AI layer (deterministic by product ruling)**: Ask screen with evidence chains,
  Today/Operations briefings, Attention triage, teacher/parent copilots — all recomputed
  from records, budgeted, zero external LLM calls (tokens stay 0).
- **Event spine**: atomic events+outbox, worker delivery with retry/backoff, budgets.
- **Frontend**: 87 routes, role-scoped nav, empty-world law everywhere (§7), offline-safe
  demo build split, full onboarding UX.

## 7. The Laws (invariants you must not break)

1. **Empty-world law**: screens narrate *records*. A school with no records shows honest
   empty states ("No fee records yet") — **never** demo copy, synthetic rows, or fake
   benchmarks. Every derived list must guard the empty pool (`% pool.length` ÷0,
   `slice(10,18)` of [], `latency.p95` of `{}` have all bitten us — 6 crashed screens).
2. **Server-truth law**: plugin enablement lives in `app.plugins`; the frontend mirror is
   a cache that re-syncs. Never trust localStorage alone.
3. **Audit-before-send / atomic-ledger law**: data + audit hash row + outbox envelope in
   one transaction. No direct sends anywhere — rails deliver orchestrator intents only.
4. **RLS law**: every tenant query inside `withUser`. Raw connections (postgres) bypass
   RLS — only for admin/migrations/tests. Writes to RLS tables inside a fresh transaction
   need `set_config('schoolos.tenant_id', …, true)` FIRST (signup catalog seeding).
5. **UI-only law**: every capability reachable by a non-technical user in the UI; no
   "here's the API" cop-outs. If a screen can't do it, the product can't do it.
6. **Docs law**: material changes update `docs/DATA-FLOW.md` + `docs/ROLE-CAPABILITIES.md`
   (+ `docs/PERMISSION-MATRIX.md` when routes change — regenerate via
   `server/scripts/permission-matrix.js`). Honest `NOT IMPLEMENTED` labels required.
7. **Test laws**: serial only (`--test-concurrency=1 --test-timeout=90000`), ONE
   `node --test` at a time (pgrep first), every file owns its world via `setupTestDb()`,
   kill-switch tests need a second app instance closed in `after()` not mid-run,
   per-test IP spoofing via `x-forwarded-for` + `TRUST_PROXY=true`.

## 8. Not implemented / honest gaps (verify in docs/DATA-FLOW.md §683 before claiming otherwise)

- **Real outbound delivery**: SMS/WhatsApp ship provider='logger'. Production needs
  per-school BSP/vendor credentials in plugin settings + DLT compliance (operator duty).
- **Real payments**: UPI/Razorpay doors and webhooks exist and are tested, but no live
  gateway keys are wired in dev; settlement-file import flow is manual.
- **No email anywhere**: signup has **no email verification** (mitigations: 3/min limit,
  kill-switch, empty-tenant signup). No mail sender exists in the product.
- **No billing/subscription system** for the platform itself; no per-tenant quotas beyond
  event/AI budgets.
- **AI is deliberately rule-based** (no LLM integration anywhere; `parent.assistant`
  states it in code). Wiring a real LLM = new product decision, budgets exist for it.
- **Accounting.tally export scheduling** absent (manual door only).
- **Attendance class-ownership scoping** beyond the register door is role-trust.
- **No PWA/i18n**, no push notifications; tokens in localStorage (XSS mitigations only —
  no httpOnly cookies; split-origin serving is a hardening backlog item).
- **Transport GPS** is a feed door + simulator drill; no real vendor GPS integration.
- **Student/parent planes** are real server-side (student.world, family.view) but the
  paper-first UI is intentionally minimal; Demo* screens are demo-build-only.

## 9. Docs map

- `docs/DATA-FLOW.md` (683 ln, §1–43 + Tables A–F): **the** architecture map; final
  section lists every remaining honest gap (quote-accurate).
- `docs/ROLE-CAPABILITIES.md` (219 ln): every role's door list (owner 95 … technician 9).
- `docs/PERMISSION-MATRIX.md` (208 ln): 177 routes classified; regenerate with
  `server/scripts/permission-matrix.js` after route changes.
- `docs/FEATURES-STATUS.md`: 13-plane status board (counts may lag by a few doors).
- `docs/01…12-*.md`: vision → product → intelligence → platform/security → business →
  refinement → build plan → red-team → plugin architecture ×2 → enterprise hardening.
- `docs/SECURITY-MATRIX.md`, `RELEASE-CERT.md`, `RELEASE-NOTES.md`, plan docs
  (TEACHEROS/PARENTOS/STUDENTOS/COORDINATOROS/MASTER-AUTOMATION/AUTOMATION),
  `ops/`, `red-team/`, `research/`, `role-matrices/`.

## 10. Operational traps (learned the hard way)

1. `pkill -f "node src/index[.]js"` — **bracket the dot** or you kill your own shell
   (SIGTERM, empty tool output). Same for workers.
2. `/tmp` does NOT persist between bash calls; and is sometimes read-only — use
   workspace paths for scratch files.
3. `pgrep -f "node --test"` before starting a suite; **one** suite at a time (shared
   `schoolos_test` with `DROP DATABASE WITH (FORCE)` per file).
4. Suite takes ~15–20 min (scrypt N=2^17); factory-check timeout raised to 1800s.
5. `npm run build` (tsc -b && vite build) before `vite preview` picks anything up;
   UI :4310 serves `app/dist/` only.
6. Wipe recipe (destroys ALL tenant data, keeps schema): `TRUNCATE app.tenants CASCADE;`
   then `rm -rf server/storage/*`. `TRUNCATE ... CASCADE` cascades ~70 tables — read the
   NOTICE list before running on anything but dev. `app.capability_contracts` and
   `app.schema_migrations` survive (they're what you want to survive).
7. Migration checksum drift: `migrate.js` refuses changed files; deliberate re-baseline
   = direct `UPDATE app.schema_migrations SET checksum=…` (done once for 045).
8. Browser walkers need the API up, a fresh `dist`, and playwright-core at
   `/usr/lib/code/node_modules/playwright-core/index.mjs` with headless shell at
   `~/.cache/ms-playwright/chromium_headless_shell-1234/...`. They log in **inside the
   browser** (token must land in localStorage) — a Node-side fetch login proves nothing.
9. "Sign in" text-matching false-positives: detect the login screen by `.login-card`.
10. `server/.env` and `app/dist/` are gitignored; never commit `test-campaign-marker.txt`,
    `smoke.json`, or `.npm-cache/`.
11. `Clear-Site-Data` rides `/auth/logout` and `/student/*` — do not "fix" 401-flapping
    by removing it; it's the shared-machine protection.

## 11. Test harness

Run: `cd server && timeout 1800 node --test --test-concurrency=1 --test-timeout=90000 tests/<file>.test.js`
(or the whole dir for the 232-test suite; ~15–20 min).

30 files: api 11, auth-revocation 2, admissions 8, b9-confidentiality 6, cases-privacy 6,
cbse 5, coord-view 11, cycle5 7, cycle6 11, dpdp 9, exams 10, governance 4, hr-clinic 8,
onboard 12, parent-assistant 18, parent-family 10, plugin-loader 5, plugins 4, rails 10,
security 9, student-world 11, tally 1, teacher-classroom 13, teacher-copilot 19, upi 5,
visitors 12, wave-b 10, wave-c 10, wave1 6.

Browser walkers (repo root): `node scripts/crash-hunt.mjs` (18 staff routes as owner;
`PROBE_EMAIL`/`PROBE_PW`/`PROBE_ROUTES` overridable) and `node scripts/itadmin-hunt.mjs`
(self-contained: signs up a unique school, provisions an IT admin, browser-logins,
walks 41 routes; leaves its tenant in the DB — **truncate `app.tenants CASCADE`
afterwards**). Expected output: `ALL ROUTES CLEAN`, only student-module gates off.

## 12. Recent history (this session's arc)

| Commit | What it did |
|---|---|
| `9959105` | Full build-out: rails, library, files, people console, retention, RLS closure, headers, /metrics+/capabilities |
| `b8f7a08` | Self-serve onboarding (/onboard): signup/school/status, checklist UI, 12 tests |
| `8758446` | Tenant identity on /me + /dataset; sidebar shows the school's own name |
| `6d37b38` | Empty-world dataset override for non-demo tenants |
| `ade496b` | Empty-world render-crash guards (Today, Insights, Shell) |
| `3239265` | Purged every hardcoded demo narrative from real-user screens (empty-world law established) |
| `ea2157b` | Plugin catalog born with every school (23 rows, 5 core on); owner turn-on button; sessionIdentity (real names, not demo personas); /dataset no-store |
| `b86d6fa` | IT-admin crash fix (aiUsage zero-shape, empty-pool guards in ItAdmin/HR); itadmin-hunt harness |

## 13. Suggested next steps for the incoming agent

1. **Confirm the user's school works end-to-end** after re-onboarding: create students,
   mark attendance, collect a fee, walk every role in `itadmin-hunt` style.
2. **Email verification + password reset emails** — biggest trust gap in onboarding
   (needs a mail rail; the comms-dispatcher is the natural carrier).
3. **Provider adapters** for rails.sms/rails.whatsapp (gupshup/meta_cloud_api are named
   in the settings schema) and real Razorpay key wiring.
4. **Regenerate the permission matrix** after any route change; keep docs law.
5. Consider httpOnly-cookie sessions + split-origin hardening before any real deployment.
