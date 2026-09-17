# SchoolOS — The Master Class

**Zero to hero: every part of the system, every role, every screen, and how data moves between them.**

> This is the single guided document for understanding SchoolOS end-to-end. It is deliberately long. Read
> it in order the first time; use it as a reference afterwards. Every claim is grounded in the repository
> (file paths and line numbers are cited throughout). Where the code has a known gap, the doc says so
> rather than pretending.
>
> **Generated/derived companion docs:** `docs/PERMISSION-MATRIX.md` (every route + its guard, machine-generated),
> `docs/VERIFICATION.md` (test counts, machine-generated), `docs/PERFECT-100.md` (the honest audit + fix register),
> `docs/PROJECT-MAP.md`, `docs/BACKEND-MAP.md`, `docs/DATA-FLOW.md` (deep dives per subsystem).
>
> **Structure:** Part I is the narrative (how it all works). Part II is the catalogues (every role, every screen,
> every scenario, every table, every plugin, every route). If you only have ten minutes, read Parts 1–4 of Part I.

---

## Table of contents

**Part I — How SchoolOS works**
1. [What SchoolOS is](#1-what-schoolos-is)
2. [Architecture at a glance](#2-architecture-at-a-glance)
3. [The tenancy, identity and RBAC substrate](#3-the-tenancy-identity-and-rbac-substrate)
4. [The backend kernel: doors, domains, money, audit](#4-the-backend-kernel-doors-domains-money-audit)
5. [The plugin platform](#5-the-plugin-platform)
6. [The event spine, outbox and workers](#6-the-event-spine-outbox-and-workers)
7. [The frontend: shell, routing, state, live-vs-demo](#7-the-frontend-shell-routing-state-live-vs-demo)
8. [Operations, deployment and CI](#8-operations-deployment-and-ci)
9. [Testing and verification](#9-testing-and-verification)
10. [Where the project is weak (read this)](#10-where-the-project-is-weak)

**Part II — The catalogues (reference)**
- [Catalogue A — The 13 roles, end-to-end](#catalogue-a--the-13-roles-end-to-end)
- [Catalogue B — Every screen](#catalogue-b--every-screen)
- [Catalogue C — 18 end-to-end scenarios](#catalogue-c--18-end-to-end-scenarios)
- [Catalogue D — The data model (104 tables)](#catalogue-d--the-data-model-104-tables)
- [Catalogue E — The plugin catalogue](#catalogue-e--the-plugin-catalogue)
- [Catalogue F — The route index (267 routes)](#catalogue-f--the-route-index-267-routes)

---
---

# Part I — How SchoolOS works

## 1. What SchoolOS is

SchoolOS is a **multi-tenant School Information System (SIS)** for Indian K-12 schools. One deployment
serves many schools (tenants); each school's data is isolated at the database level by row-level security.
It is built as a **kernel + plugin factory**: a small kernel owns identity, tenancy, the event/audit spine
and the money invariants; 30 drop-in plugin modules own the domain surfaces (library, exams, admissions,
transport, visitors, clinic, HR, classroom, parent/student portals, statutory packs…).

**The product promise in one sentence:** a school can run a full term on it — admissions to alumni, fees to
report cards, attendance to safeguarding — with every action recorded, every message honestly delivered,
and every role seeing exactly what it should.

**The mental model (memorise this).**

| Layer | Owns | Fails how |
|---|---|---|
| **Postgres (RLS)** | The real tenant boundary. Every row carries `tenant_id`; policies compare it to a per-transaction GUC. | Fails **closed** — no GUC ⇒ zero rows. |
| **Kernel (`src/app.js`, `src/routes.js`)** | Auth, tenancy setup, role gates, core doors, money, audit, events, plugin registry. | Refuses with a typed 4xx; never fabricates. |
| **Plugins (`src/plugins/<id>/`)** | Domain modules; each declares a manifest (class, permissions, events, settings) and mounts its own doors. | Lifecycle-gated: refuses 409 until the school enables it. |
| **Workers (`scripts/*.js`)** | Outbox relay, webhook fan-out, workflow rules, comms delivery, retention, dunning, reconciliation, backups. | At-least-once with retry + park; honest failure states. |
| **Client (`app/src`)** | Role-aware shell, screens, live API services, honest demo fallback. | Renders an honest empty/error, never invented data (mostly — see §10). |

**Terminology you will meet everywhere.**

| Term | Meaning |
|---|---|
| **Kernel** | The non-plugin core (`src/app.js`, `src/routes.js`, `src/db.js`, `src/audit.js`). |
| **Door** | A single HTTP route (`METHOD /path`) with a preHandler gate. |
| **Gate** | The preHandler chain: `authenticate` (+ role / custom-mask check) + lifecycle + entitlement. |
| **Owner path / `sysq()`** | The privileged DB path (role `schoolos`, `BYPASSRLS`). Used only for bootstrap, registry, vaults, maintenance. |
| **Constrained path / `q()` / `withUser()`** | Runs `SET LOCAL ROLE schoolos_app`, so RLS applies. `withUser` also sets the tenant/role GUCs. |
| **GUC** | Postgres per-transaction setting: `schoolos.tenant_id`, `schoolos.role`, `schoolos.user_id`. |
| **Event** | A fact row in `app.events` + a work item in `app.outbox`, written together. |
| **Audit row** | A hash-chained ledger row in `app.audit_log`, written through `app.audit_append`. |
| **Plugin class A–E** | Trust/impact classification declared in each manifest. |
| **Capability** | A named provider contract a plugin can offer (e.g. `auth.otp`, `comms.whatsapp.templates`), resolved per tenant. |
| **Effective access** | `GET /me/effective` — the server's render hint telling the client which surfaces it may show. |

---

## 2. Architecture at a glance

```
                            ┌───────────────────────────────────────────────┐
   Browser (React/TS)       │  App.tsx  AuthGate → Shell (sidebar) → Guard   │
   app/src  ~39k LOC        │  screens/*  services/*  state/store.tsx        │
                            └───────────────┬───────────────────────────────┘
                                            │  fetch  (Bearer JWT or HttpOnly cookie + CSRF)
                                            ▼
   ┌──────────────────────────────────────────────────────────────────────────────────┐
   │  Fastify app  (server/src/app.js + routes.js)                                     │
   │  CORS → rate-limit → body parse (2 MiB) → ingest/raw-body → route preHandler:     │
   │    authenticate  → [custom-mask DENY] → role gate → lifecycle gate → entitlement   │
   │  core doors: auth, me, students, attendance, fees, cases, actions, exams?          │
   │  plugin doors: mounted drop-in by loader.js                                        │
   └───────────────┬───────────────────────────────┬──────────────────────────────────┘
                   │ withUser(tenant, role)         │ sysq() owner path (rare)
                   ▼                                ▼
   ┌──────────────────────────────────────────────────────────────────────────────────┐
   │  Postgres  (25 schemas, 104 tables, RLS on tenant tables)                          │
   │  app.*  auth.*  family.*  teacher.*  plugin_*  library  safety  support  ptm …      │
   └───────────────▲──────────────────────────────────────────────────────────────────┘
                   │ claim rows, deliver, mark
   ┌───────────────┴──────────────────────────────────────────────────────────────────┐
   │  Workers: outbox relay · webhook fan-out · workflow rules · comms dispatcher ·    │
   │  day worker (dunning, retention) · reconciliation · backup · health probe           │
   └──────────────────────────────────────────────────────────────────────────────────┘
```

**Repository map.**

| Path | What lives there |
|---|---|
| `server/src/app.js` | Fastify factory: plugin registration, auth hook, core auth/me/admin/metrics doors, error contract. |
| `server/src/routes.js` | The kernel business doors (students, attendance, fees, cases, actions, plugins, roles, BI…). |
| `server/src/db.js` | Pool + `q`/`sysq`/`tx`/`withUser`; the RLS-by-default switch. |
| `server/src/audit.js` | `auditLog` (hash chain) + `emitEvent` (events + outbox). |
| `server/src/auth.js` | Password hashing, roles, `roleScope`. |
| `server/src/custom-roles.js` | Custom-role store, mask matching, enforcement. |
| `server/src/effective-access.js` | `SURFACE_DOOR`, `reachableDoors`, `capabilitiesFor`. |
| `server/src/plugin-*.js` | Catalog, permissions vocabulary, capability resolver. |
| `server/src/plugins/<id>/` | 30 drop-in modules (`index.js` + `manifest.js`). |
| `server/src/plugins/loader.js` | Mounts plugins; fails the boot loudly rather than half-mounting. |
| `server/src/onboarding.js` | Self-signup (`/onboard/signup`) and school setup. |
| `server/migrations/*.sql` | 99 ordered schema migrations (idempotent, checksum-tracked). |
| `server/scripts/*.js` | Workers and operator scripts. |
| `app/src/` | React client: `App.tsx` routes, `components/Shell.tsx` nav, `screens/`, `services/`, `state/store.tsx`. |
| `docs/` | Vision, architecture, the honest audit (`PERFECT-100.md`), generated matrix/verification. |
| `ops/` | Cron schedule, alert rules, deploy notes. |

**Boot sequence (`server/src/app.js`, `src/index.js`).**

1. `config.js` loads `.env`, applies fail-fast production guards (refuses localhost DSN, `CORS=*`, short JWT secret, missing `PLUGIN_SETTINGS_KEY`; dev doors arm only in `development` **and** explicit opt-in).
2. `buildApp()` registers **cors → jwt → rate-limit** (`300/min`, per-IP), then **multipart once** (kernel-owned, 5 MiB) and the **raw-bytes JSON parser once** (so webhook HMACs verify over exact wire bytes), regardless of plugin order.
3. `app.decorate('authenticate', …)` installs the auth hook (cookie or bearer; API-key principals; session revocation; `mustChange`/`mfaPending` restricted sessions; custom-role DENY everywhere).
4. Core doors register, then `registerRoutes()`, then `registerOnboarding()`, then **`loadPlugins()`** mounts every module (a failure collects all errors and aborts the boot).
5. `src/index.js` listens, logs the build fingerprint, and wires graceful drain (SIGTERM sets `schoolosDraining`, `/ready` returns 503 while draining, 15 s close budget).

**Request lifecycle (one authenticated mutation).**

1. Client sends `Authorization: Bearer <jwt>` (or `Cookie: schoolos_session` + `X-CSRF-Token`).
2. Fastify parses the body; rate limiter counts the request.
3. Route `preHandler` runs `authenticate`: verify JWT → reject revoked `jti` → load the live user row → reject stale `session_epoch` → enforce restricted-session paths → apply custom-role mask (DENY fails here) → set `req.user`.
4. Gate checks role (built-in or custom ALLOW); plugin doors also check `lifecycleGate` (409 until enabled) and entitlement (402 if the plan excludes it).
5. Handler runs inside `withUser(tenant, role)`: `SET LOCAL ROLE schoolos_app` + tenant/role GUCs; every query is RLS-filtered.
6. Mutations write `app.events`+`app.outbox` (`emitEvent`) and a hash-chained `app.audit_log` row (`auditLog`) **in the same transaction**.
7. Response. Workers later claim outbox/delivery rows and fan out to webhooks/comms.

---

## 3. The tenancy, identity and RBAC substrate

### 3.1 Tenancy: RLS is the boundary, not the code

The single most important design decision: **the default query path is the constrained role.**

| Helper | Role | RLS | Used for |
|---|---|---|---|
| `q(text, params)` | `schoolos_app` | **enforced** | ordinary reads/writes (default) |
| `withUser(tenant, role, fn)` | `schoolos_app` inside a tx | enforced + GUCs set | every request path (the norm) |
| `tx(fn)` | `schoolos` (owner) | bypassed | privileged admin paths, kernel vaults |
| `sysq(text, params)` | `schoolos` (owner) | bypassed | auth bootstrap, registry, maintenance |

`withUser` runs `set_config('schoolos.tenant_id', …, true)` / `('schoolos.role', …, true)` and
`SET LOCAL ROLE schoolos_app`; `SET LOCAL` is transaction-scoped so a role/GUC can never leak onto a pooled
connection. Policies compare `tenant_id` to `app.current_tenant()` (a `NULLIF`-guarded helper so an empty or
unset GUC **denies** rather than raising). The consequence: a forgotten `WHERE tenant_id=` returns **zero
rows**, not another school's data. `tests/rls-boundary.test.js` pins this and also pins the count of
owner-path call sites so privilege cannot grow silently.

### 3.2 Identity: five ways in

| Method | Door(s) | Notes |
|---|---|---|
| Password | `POST /auth/login` | scrypt; timing-equalised unknown-email path; per-account lockout after 5 failures (15 min); MFA challenge if enabled. |
| Phone OTP | `POST /auth/otp/request` → `POST /auth/otp/verify` | E.164-normalised; hashed code in a kernel-only vault; attempt-capped; anti-enumeration copy. |
| Google SSO | `GET /auth/google/start` → `…/callback` | verifies `email_verified`; multi-tenant emails 409 with a picker. |
| Dev SSO (dev only) | `POST /auth/google/demo` | arms only in `development` + explicit opt-in. |
| API key | `X-API-Key` header | scoped, read-only machine identity on an allowlist of read doors. |

**Sessions.** A JWT carries `sub`, `role`, `tenant`, `name`, `jti`, `ep` (session epoch), optionally
`mustChange`/`mfaPending`. `POST /auth/renew` re-issues and revokes the old `jti`; logout revokes the exact
token; password change bumps `session_epoch` and kills sibling sessions. Browser sessions also get an
HttpOnly `schoolos_session` cookie + a JS-readable `schoolos_csrf` cookie (double-submit required on
cookie-authenticated mutations). Staff MFA is TOTP (RFC 6238) with single-use moving factors (migration 095)
and single-use recovery codes.

### 3.3 RBAC: 13 built-in roles + custom-role masks

`server/src/auth.js:72`: `owner, principal, coordinator, counselor, finance, admissions, transport,
facilities, technician, teacher, itadmin, parent, student`.

- **Role gates.** Every door is gated by one of: `authenticate` (any signed-in user), a role set, or a
  custom-role-aware gate (`require(...)` / `roleGatedMe(...)`). The generated `docs/PERMISSION-MATRIX.md`
  is the authoritative census: **267 routes — 222 role-gated, 32 auth-only, 13 public, 0 unguarded.**
- **Custom roles.** The owner can author a role = builtin base + allow/deny **mask** over real doors
  (`roles` table, migration 063). Masks are validated against the live route registry (no dead patterns) and
  capped so an `allow` cannot grant a door the author itself cannot reach (unless owner). Resolution order:
  **custom mask → builtin role**; a matched DENY refuses even a base-role door; a matched ALLOW lifts a
  role refusal.
- **Effective access.** `GET /me/effective` returns `role`, `role_key`, `custom`, `scope.classes`,
  `capabilities`, `nav` and the full reachable `doors`, computed from the same registry + mask the gates
  use. The client uses it as a **render hint**; the server still re-decides every request.

**Data scope per role (`roleScope`, `auth.js:75-83`):** the coarse read plane a role may touch before
per-door checks (e.g. principal/coordinator see the school; teacher sees own classes; parent sees linked
children; student sees self).

---

## 4. The backend kernel: doors, domains, money, audit

The kernel's business doors live in `server/src/routes.js` (~2,400 lines) plus `app.js` for auth/admin.
Below is the domain map. The **full route index with guards is Catalogue F** (generated).

| Domain | Representative doors | Who | Key invariant |
|---|---|---|---|
| **Students & classes** | `GET/POST /students`, `/students/:id`, `/class-assignments` | staff; roster = owner/principal/coordinator/admissions | parent sees only `family.child_link` children; teacher ownership derived from `class_assignments` |
| **Attendance** | `GET /attendance`, `POST /attendance/mark` | mark = owner/principal/coordinator/teacher | per-student class ownership; one mark per student/day (unique); IST date default |
| **Fees & payments** | `/fee-plans`, `/fees/obligations`, `/fees/payments`, `/fees/payments/:id/confirm`, `/payments/:id/refund`, `/payments/reconcile`, `/fees/dunning/run` | finance/owner/principal (+ parent initiate) | integer paise; one open payment per obligation; settlement is staff-only; webhooks record facts only; refund consistency guard |
| **Cases & actions** | `POST /cases`, `/cases/:id/status`, `/actions`, `/actions/:id/decide` | cases: any reporter (parent/student) + staff board; actions: owner/principal decision | caller-authored `origin/owner/priority/sla` are derived from role; SoD (no self-approval) |
| **Comms** | `GET /communications`, notice execution via actions | staff read; owner/principal approve | never claims delivery before a carrier; sandbox ≠ delivery in production |
| **Events & lineage** | `GET /events`, `/events/lineage` | staff roles only | student/parent refused (API-1) |
| **Audit** | `GET /audit`, `GET /audit/verify` | owner/principal/itadmin/finance | hash-chained; verification recomputes the chain |
| **AI** | `POST /ai/call`, `GET /ai/calls`, `/ai/eval` | call any; read owner/itadmin | per-plugin and tenant budgets; deterministic fallback |
| **Plugins** | `GET /plugins`, `POST /plugins/:id/enable|disable|settings` | read any; write owner/itadmin | enable resolves metadata from the on-disk manifest; dependency + kernel-compat + entitlement gates |
| **Roles** | `GET/POST/PATCH/DELETE /roles`, `/roles/:key/assign` | owner/itadmin | masks validated against live routes; no self-assign; owner can't be overlaid |
| **Ops** | `/health`, `/ready`, `/metrics`, `/build-info` | health public; metrics owner/itadmin | `/metrics` is Prometheus text with fleet queues, pool, latency histogram, build id |
| **Migration/import** | `/migration/*`, plugin `ops.import`, `people.admin` CSV | owner/coordinator/admissions | staged → validated → committed with per-row reports |

**Money invariants (memorise).** Amounts are integer **paise** (`amount_cents`). A payment is a row with a
status machine (`initiated → confirmed → refunded`, or `void`). An obligation's `paid_cents` is updated only
by staff confirmation. Gateway webhooks **record facts** and never settle; settlement requires an
authenticated staff confirmation whose provenance is a record in the gateway's own `order_log`, not a regex.
Refunds reverse the obligation ledger and refuse when the ledger is inconsistent.

**Error contract.** `setErrorHandler` maps status → machine code (`BAD_REQUEST`, `UNAUTHORIZED`,
`FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `INTERNAL_ERROR`), never leaks
internals on 5xx, and stamps `requestId` (also returned as `x-request-id`). `setNotFoundHandler` returns a
JSON 404 rather than Fastify's default HTML.

---

## 5. The plugin platform

A plugin is a directory `server/src/plugins/<id>/` with an `index.js` (`export function register(app, kernel)`)
and a `manifest.js`. The loader mounts every directory; a broken module aborts the boot with all errors
listed (never a half-mounted system).

**Manifest fields (`plugin-permissions.js`, `plugin-catalog.js`):**

| Field | Meaning |
|---|---|
| `id`, `version`, `class` (A–E) | identity + trust/impact classification |
| `kernel` | semver range the plugin needs (checked at enable; PLG-2b) |
| `dependencies` | machine-readable `id@version` deps (checked at enable) |
| `permissions` | the **ceiling** the module declares from the frozen kernel vocabulary |
| `capabilities` | provider contracts it offers (resolved per tenant by `enabledCapability`) |
| `events.publish` / `subscribe` | declared event contract |
| `settingsSchema` | typed config schema (drives the write-only settings form) |
| `money.moves_money` | explicit money classification |

**Lifecycle.** Catalog rows are seeded at signup/self-heal (`ensurePluginCatalog`) in `registered` state.
`POST /plugins/:id/enable` resolves `version`/`class`/`manifest`/`permissions` **from the on-disk manifest**
(client body ignored), enforces entitlement (402), kernel-compat and dependencies (409), then stores the
declared grant. Every plugin door carries a per-request `lifecycleGate` (409 until enabled). Disable runs a
drain protocol (hands open actions back) and retains data. Settings are validated against the schema and
**secret keys are AES-256-GCM encrypted** (tenant-bound key) before persistence.

**Permission enforcement (PLG-1).** The manifest is the ceiling; the stored grant is the only grant. The
shared gate refuses when the grant doesn't cover the declaration. `scopedKernel` additionally makes
undeclared `auditLog`/`emitEvent` calls **fail at the call site** with an audited refusal.

**Capabilities (PLG-10).** Instead of hardcoding plugin ids, the kernel resolves a provider by capability:
`enabledCapability(sysq, tenantId, 'auth.otp')` etc. This lets a school swap the OTP/SMS/email/WhatsApp/payments
provider without a kernel change.

See **Catalogue E** for all modules with their class, capabilities, permissions, events and settings keys.

---

## 6. The event spine, outbox and workers

**Every mutation emits a fact and a work item together** (`emitEvent`, `audit.js:37-59`): a row in
`app.events` (typed, labelled, severity, payload ≤64 KiB) and a row in `app.outbox` (topic, payload,
lineage ids, `emitted_by`). The audit ledger (`auditLog`) writes a separate hash-chained row through
`app.audit_append`, with the hash pinned by a database trigger.

**Delivery pipeline.**

```
emitEvent ─┬─ app.events      (facts, lineage, Action Center, dashboards)
           └─ app.outbox      (work queue)
                  │
                  ▼  outbox relay (scripts/outbox-worker.js)  → marks processed_at / parked_at
                  ▼  webhook fan-out (scripts/webhook-worker.js) → app.webhook_deliveries (queued/failed/stalled)
                  ▼  workflow rules (scripts/workflow-worker.js)  → outbound comms / notifications
           comms (scripts/comms-dispatcher.js): claim lease → send via rails (email/sms/whatsapp/logger)
                  → status sent/failed + provider + sent_at (never delivered_at for a sandbox)
           retention (scripts/retention-worker.js): ages terminal rows; archives audit cold
           dunning / reconcile / day worker: scheduled business sweeps
```

**At-least-once + honesty rules.**
- Rows are claimed with `FOR UPDATE SKIP LOCKED`; comms claims are **leases** (claim, commit, send outside
  the transaction, release; stale leases reclaim after 10 min).
- Retry with exponential backoff, then **park** (`parked_at`, not `processed_at`) so failure is a positive
  signal, not a hole.
- A **sandbox** carrier (`logger`/`log-only`) is a legitimate sandbox and a **lie in production**: in
  production it becomes terminal `failed` and never sets `sent_at`; the `schoolos_comms_sandbox_sent`
  gauge makes the population measurable.

**Observability.** `/metrics` exposes uptime, build info, counters, a request-duration histogram, pool
stats, and queue gauges (`outbox_pending/parked`, `comms_queued/failed/sandbox_sent`,
`webhook_deliveries_queued/failed/stalled`). `scripts/health-probe.js` evaluates `ops/alerts/schoolos.rules.yml`
and exits 0/1/2 (clean / firing / could-not-run). See §10 for the gaps here.

---

## 7. The frontend: shell, routing, state, live-vs-demo

**Boot & auth gate.** `App.tsx` renders `AuthGate`, which reads the stored session, calls `GET /me` (and
`GET /me/effective`), and either shows `Login`/`Onboard` or mounts the `Shell`. A `/onboard` school renders
outside the session tree until its first owner signs in.

**Shell & navigation.** `components/Shell.tsx` builds the sidebar from a per-role switch (`useNavItems`),
then filters it against the server's `GET /me/effective` payload: a surface the server says the caller may
not render is hidden. The command palette is filtered the same way. Two chromes exist (a staff topbar and a
light parent/student layout).

**Routing.** `App.tsx` defines ~89 routes (see **Catalogue B**). Two guard layers apply:
1. `staffOnly` — a client prefix list that bars parent/student sessions (and demo previews) from staff routes.
2. The effective-access hint — server-declared reachability for mapped surfaces.
The server remains the authority: every door re-authorizes.

**State.** `state/store.tsx` holds the session, the hydrated dataset (`ensureDataset`), and selectors used
across screens. Live mode fetches the real dataset; demo mode uses a seeded in-memory world. `lib/effective.ts`
exposes `canSurface`, and `lib/roles.ts` maps account roles with a fail-closed fallback (an unknown role
becomes the **narrowest** surface, not the broadest).

**Services.** `services/liveApi.ts` is the shared fetch wrapper (bearer/cookie, CSRF, 401 → re-auth). Domain
services (`parentApi`, `studentApi`, `coordApi`, `adminApi`, `capabilitiesApi`, `onboardingApi`) wrap specific
planes. `services/index.ts` is the **mock/seed plane** — several screens still render it as if it were live
(this is the biggest frontend honesty defect; see §10 and FEX-2/FEX-1 in `PERFECT-100.md` §9).

**Live vs demo.** `DEMO_MODE` selects a seeded demo tenant; live screens degrade to honest empty/error
states with `friendly(e)` copy. Screens differ in how much they are wired: some are fully live (attendance,
fees, visitors, exams via plugin screens), some are still demo-only (`Next`, `Insights`, `Operations`,
`Documents`, `DataHealth`, `Memory`, `Automation`). Catalogue B marks each.

---

## 8. Operations, deployment and CI

**Boot pipeline (order matters).** `db-init` runs `migrate.js` then `bootstrap.js`; `api` runs
`node src/index.js` and depends on `db-init` completing; every worker depends on `db-init` too. The demo
profile additionally runs `seed.js` (never in the API path). `migrate.js` is the single writer (advisory
lock), checksum-tracked, and refuses a file that drifted after apply.

**Compose services (`server/docker-compose.yml`).** `db` (Postgres), `db-init`, `api`, `comms-dispatcher`,
`outbox`, `webhook-worker`, `workflow-worker`, `retention`, `demo-init` (profile). Non-root image;
`COPY --chown=node:node`; healthchecks and stop-grace configured. (Known gap: the shipped compose sets
`NODE_ENV=development` on `comms-dispatcher` — see §10.)

**Cron (`ops/cron/schoolos.cron`).** Scheduled: backup, health probe, day worker (dunning + retention),
reconciliation, and the event workers where not run as services.

**Backup/restore (`scripts/backup.sh`).** `umask 077`, one night directory, `pg_dumpall --globals-only` +
`pg_dump`, verified with `pg_restore --list`, plus a `files.tar.gz` of the private storage tree, and a
`backup_last_success_epoch` heartbeat the probe alerts on. Restore runbook extracts files and replays the
erasure journal.

**CI (`.github/workflows/ci.yml`).** Server job: install, provision DB, compose config validation,
`node --check` on all modules, migrate, permission-matrix gate, parity gate, the full test suite, then
`check.js` (DB/migrations/RLS baseline). Web job: install, lint (`oxlint`), type-check + build, vitest.
Security job: `npm audit` (prod deps, high/critical) + `secret-scan.mjs`.

**Config/env.** `DATABASE_URL`, `JWT_SECRET`, `PORT`, `HOST`, `LOG_LEVEL`, `CORS_ORIGINS`, `OTP_TTL_MS`,
`OTP_MAX_ATTEMPTS`, `RESET_TTL_MS`, `GOOGLE_*`, `RATE_LIMIT_MAX`, `PLUGIN_SETTINGS_KEY` (required in prod),
`FILES_DIR`, `TRUST_PROXY`, `SELF_SIGNUP_ENABLED`, `OTP_DEV_ECHO`/`AUTH_DEV_SSO`/`RESET_TOKEN_DEV_LOG`
(dev-only), `WORKER_ROLE`. Production refuses to boot on localhost DB, `CORS=*`, short JWT secret or missing
plugin key.

---

## 9. Testing and verification

| Layer | What | Where |
|---|---|---|
| Server suite | 105 files, **717 tests**, per-file fresh database; full CI posture (`NODE_ENV=test OTP_DEV_ECHO=`, 120 s timeout) | `server/tests/*.test.js` |
| Vacuity gate | scans the suite for tautologies, conditional silent passes, assertions-behind-`if` | `tests/test-hygiene.test.js` |
| RLS boundary | proves `q()` runs constrained, no bare `q(`, owner-path count pinned | `tests/rls-boundary.test.js` |
| Permission matrix | every route gated; fails on unguarded/public-unallowlisted | `scripts/permission-matrix.js` |
| Secret scan | cloud keys, private keys, live tokens, URL creds, dotenv secrets | `scripts/secret-scan.mjs` |
| Vaults/crypto | settings encryption, tenant binding, masking | `tests/settings-crypto.test.js` |
| Verification artifact | regenerates `docs/VERIFICATION.md` from a run log | `scripts/verification-artifact.js` |
| Frontend | Vitest/jsdom, effective-access tests (coverage is thin — see §10) | `app/src/**/*.test.ts` |

The authoritative current status is `docs/VERIFICATION.md` (generated) and `docs/PERFECT-100.md` (the audit
+ fix register with per-finding evidence).

---

## 10. Where the project is weak (read this)

Read `docs/PERFECT-100.md` §9 for the full 2026-09-17 re-audit. The honest summary:

- **The pipeline can silently undo a hardening.** `bootstrap.js` re-grants table-level UPDATE/SELECT,
  partly reverting migration 077's column scope; the shipped compose runs the comms dispatcher with
  `NODE_ENV=development`, disabling the sandbox-is-not-delivery rule. A "closed" finding must be asserted
  against the real `migrate → bootstrap → seed` / `compose up` pipeline, not by re-running the migration in
  a test.
- **The identity seam is inconsistent.** `/me/switch`, OTP and SSO paths have gaps around `force_change`,
  MFA and cross-tenant email identity (AUTH-1 is a P0).
- **`withUser` commits on `return`.** Several handlers use `return bad(...)` expecting a rollback and commit
  partial state (actions, imports).
- **Two plugin doors lag the kernel's own fixes** (student noticeboard event leak, timetable autofill class
  bypass).
- **The frontend is the least honest area.** ~23 live routes still render the mock plane; `/group` can crash
  the whole app for a real tenant; the client hand-codes its permission model in ~111 places despite
  `GET /me/effective`; the session JWT is in `localStorage`.
- **Operational proof is missing** (no CI boot of the image, no DR/off-site/PITR, no restore drill, no
  migration-runner or money-concurrency tests).

None of this erases what is genuinely strong (RLS-by-default, the money facts-only model, the hash-chained
ledger, the plugin factory, the honesty machinery). It is the difference between "built" and "proven".

---
---

# Part II — The catalogues (reference)

The catalogues below are the detailed reference: every role, every screen, every end-to-end scenario, the
full data model, the plugin catalogue, and the route index. They are generated from / grounded in the code.

---

# Catalogue A — The 13 roles, end-to-end


Source of truth for this document (read-only survey, 2026-09-17):

- `server/src/auth.js` — `ROLES` (`auth.js:72`), `roleScope` (`auth.js:75-83`).
- `server/src/routes.js` — kernel door gates + in-handler role/ownership checks.
- `server/src/effective-access.js` — `SURFACE_DOOR` (`:22-110`) and `capabilitiesFor` (`:137`).
- `server/scripts/permission-matrix.js` → `docs/PERMISSION-MATRIX.md` — generated route→role census (267 routes: 222 role-gated, 32 auth-only, 13 public, 0 unguarded). **This is the authoritative door list**; `docs/ROLE-CAPABILITIES.md` and `docs/role-matrices/*.txt` predate the build-out wave and are stale in places (called out below).
- `app/src/App.tsx` — `Guard`/staff-only list (`:186-240`), routes (`:427-543`).
- `app/src/components/Shell.tsx` — the per-role nav switch (`:59-243`), grouping (`:265-280`).
- `app/src/lib/roles.ts` — client role mapping, fail-closed fallback.
- `server/src/plugins/*/manifest.js` + `index.js` — plugin doors, in-handler role constants, data schemas.

---

## Shared mechanics (apply to every role)

**Identity / session.** Login is `POST /auth/login` (also OTP `POST /auth/otp/request|verify`, Google SSO `/auth/google/start|callback`, silent renew `POST /auth/renew`, logout `POST /auth/logout`). A session is a JWT carrying `tenant_id` + `role`. The frontend validates against `GET /me` on every cold open (`App.tsx:323-387`) — a stored session is never trusted alone.

**Tenant isolation.** Every read is re-filtered by Postgres RLS (`tenant_id = current_setting('schoolos.tenant_id')`) on ~70 tables; parent/student scoping adds `family.child_link` and `schoolos.user_id` GUC policies.

**Data scope per role** (`roleScope`, `auth.js:75-83`):

| role | scope |
|---|---|
| parent | `{ parentOfOnly: true }` |
| student | `{ selfOnly: true }` |
| technician | `{ maintenanceOnly: true }` |
| teacher | `{ teachingOnly: true }` |
| everyone else | `{ staff: true }` |

**Client role mapping** (`app/src/lib/roles.ts`). `KNOWN_ROLES` is all 13. An unrecognised role string **fails closed to `student`** (`UNKNOWN_ROLE_FALLBACK`), never to the broadest role. `isLightRole` = parent or student. A custom role reports its **base** role through `/me` plus a display-only `custom` mask.

**Effective access** (`effective-access.js`, surfaced by `GET /me/effective`, `routes.js:231`). The server computes `reachableDoors({role, mask, doorRoles, registeredRoutes})` from the **same registry the gates enforce**, then `capabilitiesFor` maps each user-facing surface via `SURFACE_DOOR` to the one door that represents it. This is a **render hint only** — every door re-decides. Custom-role semantics: base role decides first, a matched `deny` always wins, a matched `allow` can lift a base-role refusal (custom → builtin resolution, `routes.js:260-330`).

**Navigation** (`Shell.tsx`). Each role's switch returns an ordered `items[]`. It is then filtered:
1. `.filter(i => DEMO_MODE || (i.to !== '/demo' && i.to !== '/live'))` — Demo/Live only exist under `VITE_DEMO_MODE=1`.
2. `.filter(i => canSurface(effective, i.to))` — a surface the server says the caller cannot reach (or a disabled plugin's surface) is dropped.
3. Sidebar groups whatever survives; anything unnamed lands under "More" so an assigned item can never silently vanish (`Shell.tsx:265-280`).

**Two hard front-door guards** (`App.tsx:186-240`):
- `staffOnly` prefix list: `/fees, /admissions, /visitors, /reception, /migration, /transport, /insights, /automation, /constitution, /memory, /data-health, /ai-governance, /ai-usage, /it, /maintenance, /group, /audit, /action-center, /cases, /incidents, /operations, /learning, /attendance, /calendar, /documents, /operations/hr, /today, /attention, /ask, /next, /people, /coord, /teacher, /print-queue, /wellbeing-queue, /noticeboard, /plugins, /settings, /library, /live, /people-admin, /rails, /roles`.
- A light role (parent/student) deep-linking a staff surface is redirected to its own home (`/parent/family` or `/student/home2`).
- Any caller whose `/me/effective` says a surface is unreachable gets an honest "Not available for your role" screen rather than a screen that fails every request.

**Role counts (generated door census, `docs/PERMISSION-MATRIX.md` Roles column):**
owner 161 · principal 135 · itadmin 125 · coordinator 123 · teacher 52 · finance 34 · student 21 · facilities 19 · parent 19 · counselor 12 · transport 12 · admissions 9 · technician 8. (Some rows are the same route counted across methods; the heading figures in `ROLE-CAPABILITIES.md` are stale.)

---

### owner

- **One-line mandate.** The tenant's ultimate authority: holds (nearly) every door, is one of only two roles that can administer plugins and custom roles, and is the override authority for segregation-of-duties deadlocks.
- **Login surface / home screen.** Standard session (`POST /auth/login`); lands on `/today`. Nav case at `Shell.tsx:145`. Full management shell (not light).
- **Nav (every item, in order)** — `Shell.tsx:145-166`:
  1. Demo (`/demo`)
  2. Live mode (`/live`)
  3. Today (`/today`)
  4. Group (`/group`)
  5. Library (`/library`, plugin `library`)
  6. People console (`/people-admin`, plugin `people.admin`)
  7. Modules (`/plugins`)
  8. System services (`/rails`)
  9. Ask (`/ask`)
  10. People (`/people`)
  11. Operations (`/operations`)
  12. Maintenance (`/maintenance`, badge open WOs)
  13. Front desk (`/reception`)
  14. Visitors (`/visitors`)
  15. Data import (`/migration`)
  16. Insights (`/insights`)
  17. Fee plans (`/fees/plans`)
  18. Roles & permissions (`/roles`)
  19. Plugin settings (`/plugins/settings`)
  - (Demo/Live hidden unless `VITE_DEMO_MODE=1`; plugin-gated items hidden when disabled.)

- **Can do (doors), by domain.**
  - **People/students:** `POST /students` (admit; `routes.js:514`), full roster reads with guardian phones (`GET /students`, `routes.js:454`; `STAFF_ROSTER` `:453`), child detail (`GET /students/:id`, `:487`). People console account provisioning/suspend/reset + student transfer/import (plugin `people.admin`).
  - **Attendance:** read everything (`GET /attendance`, `:535`). **Cannot mark** — owner is absent from the `POST /attendance/mark` gate (`:564`).
  - **Fees:** open payment (`POST /fees/payments`, `:936`), **confirm** (`POST /fees/payments/:id/confirm`, `:986` — finance+owner), refund (`POST /payments/:id/refund`, `:1496`), reconcile (`:1545`), dunning (`:1606`), void obligation (`POST /fees/obligations/:id/void`, `:864` — owner only), fee plans + generate (`:816`, `:843`), academic years (`:739`), UPI links (`plugins/payments.upi`), Tally suite (`accounting.tally`, owner/itadmin/finance).
  - **Exams:** full EXAM_ADMIN + MOD_TIER (`exams.assessment:87-89`).
  - **Safety/safeguarding:** `GET /safety/box` (BOX_READERS, `teacher.support:56`), `GET /safety/box/summary` (SAFEGUARD_AUTHORITY `:51`), assign (`:376`), close (`:406`).
  - **Wellbeing:** `GET /student/wellbeing` (WELLBEING_READERS, `student.world:37`).
  - **HR:** mark/cancel staff leave (owner/principal/itadmin, `hr.leave`), roster/read.
  - **Transport:** `GET /transport/routes` (`:1052`), `POST /transport/events` (`:1061`), GPS ingest/read (`transport.gps`).
  - **Visitors/front desk:** full `ops.visitors` suite.
  - **Maintenance:** read/create/status work orders (`:1112`, `:1126`, `:1145`), assets (`:1171`).
  - **Admissions:** full funnel ADMIN (`admissions.funnel:57`) with FULL_PII (`:56`).
  - **Cases:** staff case board + status (`STAFF_CASE_ROLES`, `routes.js:1179`, `:1271`).
  - **Approvals:** `GET /actions` (`:1287`), decide **any** open action (`:1370`) except finance-owned (`:1392`) and self-proposed (`:1411`).
  - **Governance/admin:** events + lineage (`:1832`, `:1956`), communications (`:1859`), audit (`:1867`) + audit verify (`:1888`), memory read+write (`:1935`, `:1942`), plugin enable/disable/settings (`:2020`, `:2094`, `:2120`), custom roles full CRUD/assign (`:335-450`, owner is uncapped in mask amplification `:314`), migration sources→commit (`:2215-2368`) and activate (`:2370`), WhatsApp template registration (`comms.whatsapp`) and receipts, files upload/list/download (`files.store:64`), library staffing (`library:31`), files store.
- **Data they GENERATE.**
  - `app.students` rows, `app.guardians`, `app.enrollment_history`; `app.class_assignments`; `app.academic_years`; `app.fee_plan_templates` + `app.fee_obligations`.
  - `app.payments` (initiate/confirm/refund) and obligation `paid_cents`/`status` mutations; `app.communications` FEE_RECEIPT/FEE_REMINDER rows.
  - `app.actions` decision rows (`decided_by`, `decided_at`, `decision_note`) and their executions (queued comms, notifications, admissions→student conversion).
  - `app.work_orders` + `app.wo_events`; `app.transport_events`; `app.memory_entries`.
  - `app.plugins` status/manifest/settings (credential rotations audited by changed key names, never values, `:2174-2186`); `app.roles` + `app.users.role_key`.
  - `app.migration_sources` / `app.migration_rows`; the trust-receipt event.
  - Every mutation writes a hash-chained `app.audit_log` row; events go to `app.events` (+ `app.event_action_link`).
- **Data they CONSUME.** Whole-tenant read: any student, fee, case, event, communication, audit, memory, plugin, migration, and staff record; the coordinator command centre (only via principal), all admissions PII.
- **How other roles see their data.**
  - Students they create populate the teacher roster, the parent family view, the coordinator/principal boards, and fee plans.
  - Plugin switches they flip remove/add nav surfaces for **every** role (kernel mirror).
  - Custom roles they mint govern other users' reachable doors; assignment is audited.
  - Their audit-chain verifications are themselves audit rows.
  - Their action decisions (queued notices, student conversion) surface to principals, transport, and parents.
- **Boundaries / explicitly cannot.**
  - **Cannot take attendance** (`POST /attendance/mark` gate, `routes.js:564`).
  - **Cannot decide a finance-owned action** (`:1392` excludes finance from owner/principal override) and cannot approve a proposal they raised (`:1411`).
  - **Excluded from `coord.view`** — the coordinator suite is coordinator+principal only (`coord.view:32`).
  - Cannot read/write another tenant (RLS), and cannot see parent/student-scoped rows that are not theirs.

---

### principal

- **One-line mandate.** The school's academic and operational head: owner-like breadth on records and decisions, plus the attendance register and the coordinator command centre — but no plugin/role administration.
- **Login surface / home screen.** Standard session; lands on `/today`. Nav case `Shell.tsx:60`.
- **Nav (every item, in order)** — `Shell.tsx:60-80`:
  1. Demo (`/demo`)
  2. Live mode (`/live`)
  3. Today (`/today`)
  4. Needs your attention (`/attention`, badge open actions)
  5. Ask (`/ask`)
  6. Next (`/next`)
  7. People (`/people`)
  8. Learning (`/learning`)
  9. Operations (`/operations`)
  10. Maintenance (`/maintenance`, badge open WOs)
  11. Front desk (`/reception`)
  12. Visitors (`/visitors`)
  13. Insights (`/insights`)
  14. Fee plans (`/fees/plans`)
  15. Automation (`/automation`)
  16. AI memory (`/memory`)
  17. Library (`/library`)
  18. Modules (`/plugins`)
- **Can do (doors), by domain.**
  - **Attendance:** **has** `POST /attendance/mark` (`routes.js:564`) — one of three roles that can take the register.
  - **Students:** `POST /students`, full roster with phones, child detail, people-admin transfer/promote/withdraw/import (not account creation — owner/itadmin only).
  - **Coord suite:** the entire `coord.view` AUTHORITY set (`coord.view:32`, doors `:267-561`) — home, curriculum monitor, workload, substitution decide, duty allocate, escalations, copilot-lite.
  - **Exams:** EXAM_ADMIN + MOD_TIER (publish, moderate, recompute).
  - **Fees:** open payment, fee plans/generate, academic years, reports summary; **cannot confirm/refund** (`:986`, `:1496` are finance+owner).
  - **Safety/safeguarding:** box read/summary/assign/close; wellbeing read.
  - **HR:** mark/cancel staff leave, roster.
  - **Transport/visitors/work orders:** events, full visitors suite, work-order lifecycle.
  - **Admissions:** funnel ADMIN with FULL_PII.
  - **Governance:** events, communications, audit read, memory read+write, migration **activate** only (`:2370`).
  - **Approvals:** decide actions with SoD: **cannot approve a coordinator-owned action** (`routes.js:1388-1391` — "Segregation of duties — ask the owner"), **cannot decide finance-owned** (`:1392`), **cannot self-approve** (`:1411`); dismissal is open.
- **Data they GENERATE.** Attendance rows (`app.attendance` upserts, `marked_by`), absence-notice `app.communications` (`:628-643`) and per-student audit rows (`:614-626`); class assignments (`:667`); academic years; fee-plan templates/obligations; work orders; transport events; action decisions; exam publications/moderations; health/HR/visitor/library writes via shared doors; memory entries; the migration trust receipt.
- **Data they CONSUME.** Audit ledger, institutional memory, coord suite, fee ledger and collection summary, admissions PII, all staff plugin data.
- **How other roles see their data.** Attendance marks → parent absence notices and student attendance; published exams → parent/student published results; class assignments → the affected teacher's register authority; action decisions → the raising desk and downstream comms; fee-plan generation → finance/parent obligations.
- **Boundaries / explicitly cannot.** No plugin enable/disable/settings (`:2020`), no custom roles (`ROLES_ADMIN`, `:334`), no tally suite, no WhatsApp template **registration** (owner/itadmin), no migration source staging/commit (owner/coordinator/itadmin — principal only activates), no `/metrics` (owner/itadmin).

---

### coordinator

- **One-line mandate.** The school's execution authority for the daily timetable: staffing, substitutions, workload fairness, curriculum pace, escalations, and the coordinator-owned approval desk.
- **Login surface / home screen.** Standard session; lands `/today`; signature surface `/coord/home` (Command Center). Nav case `Shell.tsx:94`.
- **Nav (every item, in order)** — `Shell.tsx:94-115`:
  1. Command Center (`/coord/home`)
  2. Substitutions (`/coord/substitutions`)
  3. Workload fairness (`/coord/workload`)
  4. Curriculum monitor (`/coord/curriculum`)
  5. Escalations (`/coord/escalations`)
  6. Approvals (`/coord/approvals`)
  7. Demo (`/demo`)
  8. Live mode (`/live`)
  9. Today (`/today`)
  10. Needs your attention (`/attention`, badge)
  11. Ask (`/ask`)
  12. Next (`/next`)
  13. People (`/people`)
  14. Operations (`/operations`)
  15. Maintenance (`/maintenance`, badge)
  16. Front desk (`/reception`)
  17. Visitors (`/visitors`)
  18. Report issue (`/maintenance/report`)
- **Can do (doors), by domain.**
  - **Coord view** (`coord.view:32`, coordinator+principal only): `/coord/home`, `/coord/curriculum-monitor`, `/coord/teacher-workload` (aggregates + fairness flag, **never a score/rank**), `POST /coord/substitution/decide` (only coordinator-owned kernel actions), `POST /coord/duty/allocate` (least-loaded deterministic), `/coord/escalations`, `POST /coord/copilot-lite` (keyword intents, 200/month).
  - **Attendance:** `POST /attendance/mark` + timetable autofill (`ops.timetable`, teacher/coordinator/principal).
  - **Students:** `POST /students`, roster with phones (`STAFF_ROSTER` includes coordinator).
  - **Timetable:** grid read, `POST /plugins/ops.timetable/substitutions` (emits `substitution.assigned`).
  - **Admissions:** funnel ADMIN with FULL_PII.
  - **Exams:** EXAM_STAFF + EXAM_ADMIN + MOD_TIER (marks, publish, moderation).
  - **Health clinic:** visit log/correct/sick-pass/read.
  - **HR leave:** OFFICE (mark/cancel) + DESK (roster/read).
  - **Visitors:** full suite incl. guardian lookup and pickup verification.
  - **Transport:** `POST /transport/events`, `transport.gps` ingest/read.
  - **Maintenance:** work-order create/status/read.
  - **Cases:** staff board + status.
  - **Safety/safeguarding:** box read/close; concern file/read/**route** (ROUTE_AUTHORITY, `teacher.support:48`); wellbeing read (`WELLBEING_READERS`).
  - **Governance:** events, communications read, memory **write only** (no read — `GET /memory` is owner/principal/itadmin), audit **not** accessible, migration sources/stage/rows/validate/commit, custom-role? no.
  - **Misc:** library staffing (owner/principal/coordinator/facilities), files upload/list/download, admissions follow-up queue (full PII).
- **Data they GENERATE.** `app.attendance` marks; substitution rows + `substitution.assigned` events (`ops.timetable`); duty assignments (`duty.assigned.v1`); `coord.copilot_call` budget rows; class assignments; admission stage moves + `stage_history`; exam marks/publish; health visits; HR leave; visitor passes; transport events; work orders; `app.memory_entries`; per-instance kernel actions (e.g. teacher leave decisions).
- **Data they CONSUME.** Timetable grid, HR leave, teacher leave requests, `app.actions` (coordinator-owned), family requests, routed concerns, curriculum progress, workload aggregates, fees ledger read, audit not.
- **How other roles see their data.** Substitution assignments → affected teacher + timetable consumers; duty allocation → staff rosters; attendance marks → parents/students; action decisions → the raising desk; memory entries → owner/principal/itadmin readers; escalations → concern/intervention boards.
- **Boundaries / explicitly cannot.** No open/confirm payments (fees read only); no `GET /memory`; no `/audit`; no plugin admin; no migration activate; no `/metrics`; cannot see another coordinator's routed identities; action self-approval blocked (`routes.js:1411`).

---

### counselor

- **One-line mandate.** The dedicated safeguarding/wellbeing role — reads the anonymous safety box and student wellbeing queue and works concerns/interventions/PTM; nothing commercial, no infrastructure.
- **Login surface / home screen.** Standard session; lands `/today`; signature surface `/wellbeing-queue`. Nav case `Shell.tsx:184`.
- **Nav (every item, in order)** — `Shell.tsx:184-200`:
  1. Demo (`/demo`)
  2. Live mode (`/live`)
  3. Today (`/today`)
  4. Wellbeing queue (`/wellbeing-queue`)
  5. Needs your attention (`/attention`)
  6. Ask (`/ask`)
  - Note in-code: the student-concerns board and safety box are server doors with no client screen yet; inventing a wrong menu entry was judged worse than the honest gap (`Shell.tsx:195-197`).
- **Can do (doors), by domain.**
  - **Wellbeing:** `GET /student/wellbeing` (WELLBEING_READERS, `student.world:37`, door `:517`).
  - **Safety box:** `GET /safety/box` (BOX_READERS, `teacher.support:56`, door `:320`), `GET /safety/box/summary` (`:357`), `POST /safety/box/:id/close` — allowed only if SAFEGUARD_AUTHORITY **or** the report is assigned to them (`:415`).
  - **Concerns/interventions:** file/read concerns (`teacher.support:97`, `:150`), add outcomes (`:222`), read concern events (`:253`); interventions create/list/transition (`:559`, `:588`, `:615`); PTM slots read (`:655`).
  - **Roster read:** `GET /students` (not in `STAFF_ROSTER`, so guardian phones are stripped; `routes.js:466`).
- **Data they GENERATE.** Concern status/outcome append-only event rows; intervention plan + lifecycle events; safety-box close transitions; PTM slot bookings are parents'; wellbeing reads are audited.
- **Data they CONSUME.** Anonymous safety reports, student wellbeing requests (category, never reporter identity for anonymous filings), teacher concerns, intervention plans, PTM slots.
- **How other roles see their data.** Concern outcomes and intervention transitions feed the principal/coordinator safeguarding picture; safety-box closures reconcile the box queue; wellbeing actions never expose the filer to classroom teachers.
- **Boundaries / explicitly cannot.**
  - **Cannot route a concern** — ROUTE_AUTHORITY is owner/principal/itadmin/coordinator (`teacher.support:48`); counselor only adds outcomes for routed items.
  - **Cannot assign a safety-box item** — SAFEGUARD_AUTHORITY only (owner/principal/itadmin, `:376`); counselor sees the summary but not assignment.
  - No fees, no audit, no memory, no infrastructure, no plugin admin, no attendance marking, no people-admin.

---

### finance

- **One-line mandate.** The money desk: settles fee payments, refunds/reconciles, chases overdue fees, exports the ledger to Tally, and reads the audit chain.
- **Login surface / home screen.** Standard session; lands `/today`; core surface `/fees`. Nav case `Shell.tsx:116`.
- **Nav (every item, in order)** — `Shell.tsx:116-132` (labels through `t()`):
  1. Demo (`/demo`)
  2. Live mode (`/live`)
  3. Today (`/today`)
  4. Needs your attention (`/attention`, badge)
  5. Ask (`/ask`)
  6. Next (`/next`)
  7. Fees (`/fees`)
  8. Fee plans (`/fees/plans`)
  9. People (`/people`)
  10. Operations (`/operations`)
  11. Maintenance (`/maintenance`, badge)
  12. Front desk (`/reception`)
  13. Data import (`/migration`)
  14. Insights (`/insights`)
- **Can do (doors), by domain.**
  - **Fees:** open payment (`POST /fees/payments`, `:936` — parent/finance/owner/principal), **confirm/settle** (`POST /fees/payments/:id/confirm`, `:986` — finance+owner; obligation `paid_cents` update, receipt, FEE_RECEIPT comms), refund (`POST /payments/:id/refund`, `:1496`), reconcile (`:1545`), dunning sweep (`:1606`), fee plans/create/generate (`:816`, `:843`), academic years (`:739`), obligations read (`FEE_LEDGER_ROLES`, `:882-883`), collection summary (`GET /reports/fees/summary`, `:1796`).
  - **Tally:** daybook, export, export history (owner/itadmin/finance).
  - **Payment rails:** UPI links (`payments.upi`), Razorpay orders (`payments.razorpay` — orders + signed-webhook facts only; settlement stays kernel).
  - **Admissions:** funnel ADMIN + FULL_PII.
  - **Governance:** `GET /audit` (one of four roles, `:1867`), communications read, memory **write only**, events/lineage, actions create/decide (finance-owned actions decidable **only** by finance, `:1392`).
  - **Misc:** work orders read, timetable grid, WhatsApp templates/receipts read, safety box read+close.
- **Data they GENERATE.** `app.payments` (initiated → confirmed/refunded, `gateway_ref`, `receipt_no`, `verifiedBy`), obligation ledger mutations (`paid_cents`/`status`), `app.communications` FEE_RECEIPT/FEE_REMINDER, reconciliation discrepancy events, Tally export rows, fee plans, academic years, memory entries, audit rows.
- **Data they CONSUME.** Obligations ledger (all students), audit ledger, admission lead PII, communications, events.
- **How other roles see their data.** A confirmed payment flips the parent's fee status and sends the receipt; refunds reverse the ledger and are high-risk audit rows; the collection summary feeds principal/coordinator/insights; Tally exports are finance/owner/itadmin-only.
- **Boundaries / explicitly cannot.** No attendance marking, no exams/homework/concern/PTM plane, no coord suite, no plugin admin, **no memory read**, no people-admin, no attendance register; cannot decide a non-finance-owned action except through the owner/principal override path (and not finance-owned by others).

---

### admissions

- **One-line mandate.** The admissions office / roster authority: admits students manually, runs bulk roster import, maps import sources, and works the generic approval/action desk.
- **Login surface / home screen.** Standard session; lands `/today`; roster surface `/people`; `/admissions` renders the funnel board only if the funnel plugin is enabled (`App.tsx:411-414`). Nav case `Shell.tsx:133`.
- **Nav (every item, in order)** — shared with transport, `Shell.tsx:133-144`:
  1. Demo (`/demo`)
  2. Live mode (`/live`)
  3. Today (`/today`)
  4. Needs your attention (`/attention`)
  5. Ask (`/ask`)
  6. Next (`/next`)
  7. People (`/people`)
  8. Operations (`/operations`)
- **Can do (doors), by domain.**
  - **Students:** `POST /students` (`routes.js:514`), full roster reads **with guardian phones** (`STAFF_ROSTER` includes admissions, `:453`).
  - **Import:** `POST /plugins/people.admin/import/students` (owner/principal/coordinator/admissions), `ops.import` schema + validate-mapping (owner/principal/coordinator/itadmin/admissions).
  - **Approvals:** `GET /actions` + decide (ten staff roles, `:1287`, `:1370`), events/lineage, timetable grid, safety box read+close.
  - **Admissions follow-up queue:** `GET /admissions/followups` is `me` (any auth) and **masks PII for admissions** because `fullPii` is only owner/principal/itadmin/coordinator (`routes.js:1763`).
  - **⚠️ Important drift to record:** the generated matrix shows the `admissions` built-in role is **not** in the `admissions.funnel` plugin doors at all. `ADMIN = owner, principal, itadmin, finance, coordinator` and `FULL_PII = owner, principal, itadmin, coordinator` (`admissions.funnel/index.js:56-57`). The role named "admissions" cannot capture leads, move stages, read funnel history, or see the summary; `docs/ROLE-CAPABILITIES.md` §5 (which says admissions is the FULL_PII tier) and the pre-build `role-matrices/admissions.txt` are stale on this point. Teacher, by contrast, **is** on the masked `GET .../leads` door (`admissions.funnel:136`).
- **Data they GENERATE.** `app.students` rows via `POST /students` (+ audit + `people` event), CSV-imported students and enrollment history, import mapping/validation artifacts, action decisions, audit rows.
- **Data they CONSUME.** Whole-school roster with guardian contacts, seed/import schemas, action board, events, timetable grid, safety box.
- **How other roles see their data.** Students they admit immediately appear on teacher/coordinator/principal/finance/parent surfaces and in fee-plan generation scope; their action decisions execute comms/notifications; their import produces source-linked students.
- **Boundaries / explicitly cannot.** No fees (no payment doors), no audit, no attendance marking, no exams, no homework/concern plane, no plugin admin, no coord suite, no memory, and — per the code above — no admissions-funnel doors.

---

### transport

- **One-line mandate.** The transport desk: records route delays and GPS facts, raising a guardian-notice approval when a delay crosses the policy threshold.
- **Login surface / home screen.** Standard session; lands `/today`; surface `/transport`. Nav case `Shell.tsx:133` (shared with admissions).
- **Nav (every item, in order)** — `Shell.tsx:133-144`: Demo, Live mode, Today, Needs your attention, Ask, Next, People, Operations.
- **Can do (doors), by domain.**
  - **Transport:** `POST /transport/events` (`routes.js:1061` — transport/coordinator/principal/facilities/owner). A delay ≥ 10 min raises a kernel `approval` action owned by principal (guardian notice, `Transport §3.1`, `:1082-1096`). GPS: `POST|GET /plugins/transport.gps/positions` (transport/coordinator/principal/owner).
  - **Governance/ops:** work orders read, actions create/decide, events/lineage, communications read, timetable grid, WhatsApp templates/receipts read, safety box read+close.
- **Data they GENERATE.** `app.transport_events` (`route_id`, `kind`, `delay_mins`, `note`), `plugin_transport_gps.positions` (30-day retention), kernel approval actions for delay notices, audit/event rows.
- **Data they CONSUME.** `app.routes`, rider counts (`students.bus_route`), GPS feed, the approval outcome.
- **How other roles see their data.** A delay raises a principal-owned approval action; on approval, a queued parent notice is resolved from the route roster (`resolveNoticeRecipients`, `routes.js:118-125`); GPS positions feed coord/home and dashboards; delay events appear in the event feed for all staff roles.
- **Boundaries / explicitly cannot.** No routes/stops CRUD (no door exists — not implemented), no attendance, no fees, no audit, no exams, no plugin admin, no memory.

---

### facilities

- **One-line mandate.** The facilities manager: creates/advances maintenance work orders, records transport events, runs the front desk, and staffs the library.
- **Login surface / home screen.** Standard session; lands `/today`; surface `/maintenance`. Nav case `Shell.tsx:201`.
- **Nav (every item, in order)** — `Shell.tsx:201-213`:
  1. Demo (`/demo`)
  2. Live mode (`/live`)
  3. Today (`/today`)
  4. Needs your attention (`/attention`, badge open WOs)
  5. Maintenance (`/maintenance`, badge open WOs)
  6. Front desk (`/reception`)
  7. Report issue (`/maintenance/report`)
  8. Operations (`/operations`)
  9. Insights (`/insights`)
  10. Ask (`/ask`)
- **Can do (doors), by domain.**
  - **Maintenance:** `GET /work-orders` (`:1112`), **create** (`POST /work-orders`, `:1126`), status transitions (`POST /work-orders/:id/status`, `:1145` — state machine `reported→…→closed`, 409 on illegal moves), assets read (`:1171`).
  - **Transport:** `POST /transport/events` (facilities is in the gate, `:1061`).
  - **Visitors/front desk:** `ops.visitors` suite is owner/principal/itadmin/coordinator — **facilities is not in it**; `/reception` surface maps to the visitors door (`SURFACE_DOOR`) and will be hidden by `canSurface` if unreachable. (Facilities' nav lists Front desk; the effective-access filter governs whether it renders.)
  - **Library:** staffing (`library:31` — owner/principal/coordinator/facilities): catalog add/retire, issue/return, overdue.
  - **Safety/safeguarding:** `GET /safety/box` read + close (BOX_READERS includes... no: BOX_READERS = owner/principal/itadmin/coordinator/counselor — **facilities is not a box reader**; the matrix lists no safety door for facilities). Correct per matrix: facilities has no safety box doors.
  - **Governance/ops:** actions read/decide, events/lineage, timetable grid, files upload/list/download.
- **Data they GENERATE.** `app.work_orders` + `app.wo_events` (created/status notes, SLA due, `cost_cents` on resolve, `sla_breached`), transport events, library loans/fines, files.
- **Data they CONSUME.** Work-order queue, assets, actions, events, timetable grid, library catalog/loans.
- **How other roles see their data.** Work orders raised by anyone appear on the facilities/principal/technician board; status transitions notify the reporter and feed `/operations`; resolved orders feed insights; transport events raise principal approvals.
- **Boundaries / explicitly cannot.** No fees, no attendance, no audit, no memory, no homework/concern plane, no plugin admin, no coord suite, no people-admin.

---

### technician

- **One-line mandate.** The field technician: works assigned maintenance jobs and assets, reports new issues, and asks the assistant — the narrowest staff surface.
- **Login surface / home screen.** Standard session; lands `/today` (reachable via `GET /actions`); signature surface `/maintenance/technician` ("My Jobs"). Nav case `Shell.tsx:214`.
- **Nav (every item, in order)** — `Shell.tsx:214-220`:
  1. My Jobs (`/maintenance/technician`)
  2. Assets (`/maintenance/assets`)
  3. Report issue (`/maintenance/report`)
  4. Ask (`/ask`)
  - (No Demo/Live/Today items declared; the login default `/today` is still re­nderable because technician is in the `GET /actions` gate.)
- **Can do (doors), by domain.**
  - **Maintenance:** `GET /work-orders` (`:1112`), **create** (`POST /work-orders` — technician *is* in the gate at `:1126`; the older `ROLE-CAPABILITIES.md` claim that technician cannot create is stale), status transitions (`:1145`), assets read (`:1171`).
  - **Governance/ops:** actions read/decide, events/lineage, timetable grid, safety box read+close? — matrix lists no safety door for technician; `technician` scope is `maintenanceOnly` (`auth.js:79`).
- **Data they GENERATE.** Work orders + `wo_events` status notes, cost on resolve, `sla_breached`; asset-linked history; action decisions.
- **Data they CONSUME.** Assigned/queued work orders, assets, action board, events, timetable grid.
- **How other roles see their data.** Status transitions move the work order across the principal/facilities board and the reporter's view; resolve records SLA met/breached for insights; costs feed finance work-order reads.
- **Boundaries / explicitly cannot.** No fees, no attendance, no audit, no memory, no students/roster, no plugin admin, no coord suite, no people-admin, no visitors/library/transport.

---

### teacher

- **One-line mandate.** The classroom working core: owns the register for assigned classes, sets and grades homework, files concerns, enters exam marks, and carries the teaching copilot.
- **Login surface / home screen.** Standard session; lands `/today`; workspace `/teacher`, classroom `/teacher/homework`. Nav case `Shell.tsx:81`.
- **Nav (every item, in order)** — `Shell.tsx:81-93`:
  1. Demo (`/demo`)
  2. Live mode (`/live`)
  3. Today (`/today`)
  4. Needs your attention (`/attention`)
  5. Ask (`/ask`)
  6. Next (`/next`)
  7. People (`/people`)
  8. Learning (`/learning`)
  9. Report issue (`/maintenance/report`)
  10. Library (`/library`, plugin `library`)
- **Can do (doors), by domain.**
  - **Attendance:** `POST /attendance/mark` (`:564`) — **bound to class ownership** via `app.class_assignments` (`routes.js:581-591`, `assertTeacherOwnsClasses` `:86-104`); no assignment ⇒ 403. Absentees queue guardian notices (`:628-643`), each change writes a per-student audit row (`:614-626`). `GET /attendance` whole-school read.
  - **Classroom/homework** (`teacher.classroom`): `POST`/`GET /plugins/teacher.classroom/homework` (only own: `created_by` pin), detail, `POST /submissions/:id/review` (assigning teacher only), submissions inbox (pending/reviewed/late/missing). Students submit through the same plugin.
  - **Staff self-leave:** `POST /teacher/leave` (raises per-instance kernel action `teacher.leave.<id>`), `GET /teacher/leave/mine`.
  - **HR:** roster + leave read (DESK tier).
  - **Exams:** EXAM_STAFF (marks entry, report read) — **cannot publish/moderate** (MOD_TIER excludes teacher, `exams.assessment:89`).
  - **Concerns/support:** file/read concerns, add outcome when routed, read events; **cannot route** (`teacher.support:48`); doubts read/answer/promote-FAQ; interventions create/transition; PTM slot publish + private notes (RLS-pinned `schoolos.user_id`).
  - **Student ops:** print queue + mark done, noticeboard publish (student.world STAFF doors).
  - **Teaching copilot** (`teacher.copilot`, deterministic v0, no LLM): curriculum tree/progress, mastery per student/class, teacher brief, draft/ask, usage.
  - **Approvals:** actions read + decide (teacher-owned only; no self-approval, no finance-owned).
  - **Work orders:** create + read (no status transitions).
  - **Admissions:** `GET .../leads` **masked** (name null, phone masked — `admissions.funnel:137,153-154`).
  - **Files:** upload/list/download.
- **Data they GENERATE.** `app.attendance` marks + absence comms; `teacher.homework`, `teacher.submission` (grades/feedback), `teacher.leave_request`; `curriculum.progress`, `mastery.evidence/state`, `copilot.call` budget rows; `teacher.concern` + append-only status events; `support.doubt`/`faq`; `intervention.plan`; `ptm.slot`/`ptm.booking` + teacher-only `teacher.note`; work orders; action decisions; audit/event rows.
- **Data they CONSUME.** Own classes' roster (no guardian phones — not in `STAFF_ROSTER`), timetable grid, own homework/submissions, own leave, curriculum/mastery, masked admission leads, safety/wellbeing **not at all**.
- **How other roles see their data.** Marks → coordinator/principal moderation, then **parent/student** published reports; attendance → parent absence notices / student attendance; homework → student learning view; concerns → coordinator/principal/counselor; leave → coordinator/owner decides; mastery/curriculum → coordinator curriculum monitor; print queue → office staff.
- **Boundaries / explicitly cannot.**
  - **No access to the safety box at all** (`BOX_READERS` excludes teacher, `teacher.support:56`) and no wellbeing queue (`WELLBEING_READERS` excludes teacher, `student.world:37`).
  - No audit, no memory, no fees beyond obligation read? — teacher is **not** in `FEE_LEDGER_ROLES` nor `/fees/obligations`, so no fee access.
  - No plugin admin, no coord suite, no `POST /students`, no admissions PII, no exam publish/moderate, no migration.

---

### itadmin

- **One-line mandate.** The platform administrator: the same admin plane as the owner for plugins, custom roles, metrics, and people provisioning — but without the owner's operational writes.
- **Login surface / home screen.** Standard session; lands `/today`; platform surface `/it` ("Platform"). Nav case `Shell.tsx:167`.
- **Nav (every item, in order)** — `Shell.tsx:167-183`:
  1. Demo (`/demo`)
  2. Live mode (`/live`)
  3. Today (`/today`)
  4. Needs your attention (`/attention`)
  5. Ask (`/ask`)
  6. Operations (`/operations`)
  7. Visitors (`/visitors`)
  8. Platform (`/it`)
  9. AI memory (`/memory`)
  10. Roles & permissions (`/roles`)
  11. Plugin settings (`/plugins/settings`)
  12. People console (`/people-admin`, plugin `people.admin`)
  13. Modules (`/plugins`)
  14. System services (`/rails`)
- **Can do (doors), by domain.**
  - **Admin plane:** `GET /roles` + create/update/retire/assign (owner+itadmin, `ROLES_ADMIN` `routes.js:334`; itadmin's `allow` masks are **capped at its own reach** by the amplification ceiling, `:314-319`), `POST /plugins/:id/enable|disable|settings` (`:2020`, `:2094`, `:2120` — only two roles), plugin read with **unredacted** settings visibility (`isPrivileged`, `:1984`), `GET /metrics`, workflow rules, `GET /ai/calls`, `GET /audit` + `GET /audit/verify` (`:1888`), `GET /memory` (read, not write), `/rails`, `/it`.
  - **People console:** account provisioning/suspend/reset (owner/itadmin only); student transfer/promote/history/patch (owner/principal/coordinator); withdraw (owner/principal); CSV import.
  - **Records/read-side:** events/lineage, communications, admissions funnel ADMIN + FULL_PII, exams EXAM_ADMIN + MOD_TIER, health clinic, HR leave OFFICE+DESK, timetable substitutions, visitors, safety box read/summary/assign/close, print/wellbeing queues, cases, tally suite, WhatsApp templates **read only** (registration owner-only), files.
  - **Approvals:** actions read/decide (with the same SoD rules as principal).
  - **Migration:** sources/stage/rows/validate/commit (owner/coordinator/itadmin), not activate.
- **Data they GENERATE.** `app.plugins` status/settings/manifest (secret rotations labelled by changed key names); `app.roles`/`role_key`; `app.users` provisioning/suspend/reset + `app.enrollment_history`; plugin exposure changes that ripple through every user's effective-access/nav; audit-chain verification rows; moderation decisions.
- **Data they CONSUME.** Everything read-side except being excluded from operational writes: `/metrics`, `/audit`, memory, all plugin data, admissions PII, whole roster.
- **How other roles see their data.** Role minting/assignment changes other users' reachable doors; plugin enable/disable changes every role's nav; account suspension makes the live-row check refuse sign-in; memory reads inform owner/principal.
- **Boundaries / explicitly cannot.** **No attendance marking, no student creation, no transport events, no work-order status changes, no payments, no memory write** (`POST /memory` excludes itadmin — owner/principal/coordinator/finance). Cannot create/suspend/reset **owner** accounts (owner pin; `people.admin` `owner_creation_forbidden`).

---

### parent

- **One-line mandate.** A guardian reading only their own linked children and acting on their behalf: consents, requests, payments, PTM bookings, messages, and a deterministic assistant.
- **Login surface / home screen.** Light session. The login default returnTo `/today` is a staff surface, so a parent is redirected to `/parent/family` (`App.tsx:200-211`). Nav case `Shell.tsx:221`.
- **Nav (every item, in order)** — `Shell.tsx:221-232` (labels through `t()`):
  1. Family (`/parent/family`)
  2. Consents (`/parent/consents`)
  3. Requests (`/parent/requests`)
  4. AI Assistant (`/parent/copilot`)
  5. Home (`/parent`)
  6. My complaints (`/parent/complaints`)
  7. Messages (`/parent/chat`)
  8. Fees (`/parent/fees`)
  9. Ask (`/parent/ask`)
- **Can do (doors), by domain.** Every child-scoped door re-derives "my children" from `family.child_link`; a forged studentId yields 403/404/empty, never another family's data.
  - **Family read-plane** (`family.view`, GUARDIAN only): `/parent/home` (per-child today: attendance, homework, consents, attention), `/parent/child/:id/timeline|academics|attendance|exams` (`assertOwnChild`, `family.view:24+`), `/parent/consents` + `POST /parent/consents/:id/decide` (decisions final; DB guard), `POST|GET /parent/requests`, `POST /parent/report-discrepancy`, `POST /parent/leave-request` (raises per-instance kernel action).
  - **Assistant** (`parent.assistant`, parent only, deterministic — no LLM): `GET /parent/brief`, `POST /parent/copilot/ask|draft`, `GET /parent/explain/:topic` (own rows only, banned-judgement language, 100 calls/month).
  - **Fees:** `POST /fees/payments` to open a payment for **their child's** obligation (child_link check, `routes.js:960-963`); `GET /fees/obligations` scoped to own children (`:890-903`). **Confirm is staff-only.**
  - **PTM:** `GET /ptm/slots`, `POST /ptm/book` (own child only).
  - **Auth-only shared reads scoped to own children:** `/students` (`LEFT JOIN child_link`, `:470-481`), `/students/:id` (404 unless linked, `:494-497`), `/attendance` (`scoped: own_children`, `:542-551`), `/my-cases`, notifications, events lineage? — parent is **not** in `EVENT_FEED_ROLES` (`:1831`), so no lineage. Files download for `scope=student` own child only.
- **Data they GENERATE.** `family.request` + append-only status events, `family.consent` decisions, child leave kernel actions (`parent.leave.<id>`), discrepancy reports, `app.payments` rows (initiated, not confirmed), `app.cases` (origin `parent`), `parent.copilot_call` budget rows.
- **Data they CONSUME.** Their own children's attendance, published exam results, homework, fee obligations, consents, requests, teachers' communication.
- **How other roles see their data.** A payment initiation → finance confirm queue and the audit ledger; a consent decision → school consent state; a request/leave → the office/coordinator action board; a complaint → the staff case board; a discrepancy → the relevant staff desk.
- **Boundaries / explicitly cannot.** Any staff door (403 at the gate), audit/memory/events actions, other families' data (child_link + RLS), noticeboard/staff queues, plugin admin, student wellbeing/safety reads.

---

### student

- **One-line mandate.** The kiosk-isolated learner: their own day, homework, results, self-study tools, print jobs, and anonymous wellbeing/safety reporting.
- **Login surface / home screen.** Light session. Login default `/today` is staff-only → redirected to `/student/home2` ("My Day"). Nav case `Shell.tsx:233`. Session is short-TTL (30 min); every `/student/*` response is `no-store` + `Clear-Site-Data` (`student.world`).
- **Nav (every item, in order)** — `Shell.tsx:233-241`:
  1. My Day (`/student/home2`)
  2. Home (`/student`)
  3. Learning (`/student/learning`)
  4. Portfolio (`/student/portfolio`)
  5. Library (`/library`, plugin `library`) — note: the `/library` surface maps to `GET /plugins/library/books`, which only staff reach, so effective-access will typically **drop** this item for a student; the student's own loans surface is `GET /plugins/library/loans/mine`.
  6. Ask (`/student/ask`)
- **Can do (doors), by domain.**
  - **Student world** (`student.world`, STUDENT only): `/student/home`, `/student/homework`, `/student/results`, mistakes journal create/list/delete, flashcards create/list, study tasks create/list, `POST /student/print` + `GET /student/print/mine`, `GET /student/noticeboard`, `GET /student/session` (kiosk idle), `POST /student/wellbeing`.
  - **Homework submission:** `POST /plugins/teacher.classroom/homework/:id/submit` (student only; class gate fail-closed, duplicate 409, late decided at insert).
  - **Doubts:** `POST /plugins/teacher.support/doubt` (deterministic timetable routing), `GET /teacher/support/doubts` (own).
  - **Safety:** `POST /safety/box` — **anonymous by default**, no reporter identity stored.
  - **Library:** `GET /plugins/library/loans/mine` (own loans, name-match pin).
  - **Fees/cases:** no payment door; can open a `app.cases` complaint (origin `student`); reads own via `/my-cases`.
- **Data they GENERATE.** `student.mistake_note`, `student.flashcard`, `student.study_task`, `student.print_job`, `student.wellbeing_request`; `teacher.submission`; `support.doubt`; anonymous `safety.box` rows; `app.cases` (origin student); audit/event rows.
- **Data they CONSUME.** Own timetable/day, own homework, own published results, noticeboard, own library loans, FAQ answers.
- **How other roles see their data.** A homework submission → the assigning teacher's review desk; a doubt → the teacher/coordinator answer queue; an identified wellbeing request → counselor/principal/coordinator queue; an anonymous safety report → safety-box readers with **no identity**; a print request → the staff print queue.
- **Boundaries / explicitly cannot.** Every staff door; other students' data (RLS `schoolos.user_id` + name-match pin); fees (no payment door); reading wellbeing/safety — **even their own safety report is anonymous to them**; audit; the staff print queue; the school roster (`GET /students` refuses students, `routes.js:459`); school-wide attendance (`:536`).

---

## Cross-role capability matrix

Roles-as-rows is too wide, so each row is a capability domain and the cells name which roles can **act** vs **view** (generated census + in-handler pins). "—" = no access.

| Capability domain | Can ACT | Can VIEW |
|---|---|---|
| Attendance register | mark: principal, coordinator, teacher (owned classes) | all staff whole-school; parent own children; student — (403) |
| Students / admission | create student: owner, principal, coordinator, admissions | full roster + guardian phones: owner, principal, itadmin, finance, coordinator, admissions, transport, facilities, technician; roster sans phones: teacher, counselor; parent own child; student — |
| People admin (accounts) | provision/suspend/reset: owner, itadmin; transfer/promote/history: owner, principal, coordinator; withdraw: owner, principal; CSV import: owner, principal, coordinator, admissions | owner, itadmin (+ principal/coordinator on student flows) |
| Fees — open payment | parent, finance, owner, principal | own obligation: parent/student? student —; ledger: owner, principal, itadmin, finance, coordinator |
| Fees — settle / refund | confirm: finance, owner; refund: finance, owner | audit-visible to audit readers |
| Fee plans / academic years | owner, principal, finance | all auth read `GET /fee-plans`, `GET /academic-years` |
| Dunning / reconciliation | owner, finance | — |
| Accounting (Tally) | export: owner, itadmin, finance | owner, itadmin, finance |
| Exams — enter marks | owner, principal, itadmin, teacher, coordinator | same staff; parent/student published only |
| Exams — publish / moderate | owner, principal, itadmin, coordinator | — |
| Safety box (anonymous) | report: student; assign: owner, principal, itadmin; close: any BOX_READER (assigned-only for coordinator/counselor) | owner, principal, itadmin, coordinator, counselor |
| Student wellbeing | file: student | principal, coordinator, owner, itadmin, counselor (never teacher) |
| Library | catalog/issue/return: owner, principal, coordinator, facilities | own loans: student |
| HR / staff leave | mark/cancel: owner, principal, itadmin; self-leave (teacher lane): teacher | owner, principal, itadmin, coordinator, teacher |
| Transport events / GPS | events: transport, coordinator, principal, facilities, owner; GPS: transport, coordinator, principal, owner | route read: any auth |
| Visitors / front desk | owner, principal, itadmin, coordinator | same |
| Maintenance / work orders | create: owner, principal, coordinator, facilities, technician, teacher; status: owner, principal, coordinator, facilities, technician | owner, principal, itadmin, finance, coordinator, facilities, technician, transport, teacher |
| Admissions funnel | leads/stage/summary: owner, principal, itadmin, finance, coordinator (FULL_PII: owner, principal, itadmin, coordinator) | teacher masked read; followups masked for teacher/admissions/finance/transport/facilities/technician; admissions **not** on funnel doors |
| Cases / complaints | open: any auth (parent/student file); board status: owner, principal, itadmin, coordinator, teacher, finance | own: parent, student (`/my-cases`) |
| Communications | queue via approvals: owner, principal, itadmin, coordinator, finance (deciders of notice actions) | owner, principal, coordinator, finance, itadmin, transport |
| Audit ledger | verify: owner, itadmin | owner, principal, itadmin, finance |
| Institutional memory | write: owner, principal, coordinator, finance | owner, principal, itadmin |
| Plugin enable/disable/settings | owner, itadmin | all auth read `GET /plugins` (settings redacted for non-privileged) |
| Custom roles | owner, itadmin (owner uncapped; itadmin capped at own reach) | owner, itadmin |
| Migration / import | sources/stage/rows/validate/commit: owner, coordinator, itadmin; activate: owner, principal; ops.import mapping: owner, principal, coordinator, itadmin, admissions; people.admin CSV import: owner, principal, coordinator, admissions | sources read: any auth |
| Files | upload/list: owner, principal, coordinator, teacher, itadmin, facilities | download: + parent/student for `scope=student` (own child/self) |
| Approvals / action spine | read+decide: owner, principal, itadmin, finance, coordinator, teacher, admissions, transport, facilities, technician (SeD: no self-approval; principal cannot approve coordinator-owned; finance-owned only by finance) | same |
| Reports / BI | ops.bi reads: owner, principal, coordinator, finance, itadmin; fees summary: owner, principal, coordinator, finance, itadmin | same |
| Coordination desk | coord.view: coordinator, principal; timetable substitutions: owner, principal, coordinator, itadmin; autofill: teacher, coordinator, principal | coordinator, principal (coord.view); grid: all staff |
| Wellbeing/print/noticeboard staff desks | print done: owner, principal, itadmin, coordinator, teacher; noticeboard publish: student.world STAFF; wellbeing read: WELLBEING_READERS | same |

### Notes on divergences found during the survey

1. **`admissions` vs the admissions funnel.** The built-in `admissions` role is **not** on any `admissions.funnel` door; funnel authority sits with owner/principal/itadmin/finance/coordinator, and FULL_PII only for owner/principal/itadmin/coordinator. `docs/ROLE-CAPABILITIES.md` §5 and `docs/role-matrices/admissions.txt` are stale here; the generated `PERMISSION-MATRIX.md` is correct.
2. **Technician work-order create.** `POST /work-orders` includes technician in the live gate (`routes.js:1126`) and in the generated matrix, contradicting the prose in `ROLE-CAPABILITIES.md` §8 that says technician only transitions status.
3. **Facilities and the safety box.** Facilities' nav declares Front desk and Maintenance, but per the matrix it has no safety-box doors and no visitors doors; effective-access hides surfaces the server says are unreachable, so the nav rendering is the honest gate.
4. **Student Library item.** Student nav declares `/library`, but `SURFACE_DOOR['/library'] = 'GET /plugins/library/books'`, a staff door — so `canSurface` normally drops it for students; their own-loans door is separate.
5. **Coordinator memory write-only.** Coordinator can `POST /memory` but not `GET /memory`; finance likewise. The read tier is owner/principal/itadmin.

---

# Catalogue B — Every screen


Source of truth: `app/src/App.tsx` route table (read in full), then every routed screen component under `app/src/screens/` (and subdirs), read at source. Supporting reads: `components/Shell.tsx` (role-aware nav), `lib/roles.ts`, `lib/effective.ts`, `lib/grants.ts`, `lib/demoMode.ts`, `components/DemoBar.tsx`, and the service contracts `services/liveApi.ts`, `coordApi.ts`, `parentApi.ts`, `studentApi.ts`, `adminApi.ts`, `capabilitiesApi.ts`, `onboardingApi.ts`, `services/index.ts`.

## How gating works (read this before the per-screen notes)

- **`AuthGate`** (`App.tsx`) is the front door: no live `/me` answer → `Login`. A brand-new `/onboard` school renders outside the session tree.
- **`Guard`** applies two gates. (1) In a demo build, any `parent`/`student` session is barred from the `staffOnly` route list (redirected to their home if authenticated, or shown a "Not available on this account" screen for a staff preview). (2) The server's `GET /me/effective` answer is a render hint: a surface the server says a caller may not reach is not rendered. The server still enforces every door.
- **`Shell.tsx` nav** is per-role (the switch in `useNavItems`) and is additionally filtered by the effective-access payload.
- **"Live vs demo"** below distinguishes four data doors: the **mock service layer** (`services/index.ts`, seed-backed, no network), the **demo seed** (`data/dataset`), a **live service** (`liveApi.ts`, `parentApi.ts`, `studentApi.ts`, `coordApi.ts`, `adminApi.ts`, `capabilitiesApi.ts`, `onboardingApi.ts`), or **both** (usually `DEMO_MODE ? seed : liveApi`). Most live screens degrade to honest `Empty`/`ErrorState`/`friendly()` copy when a door is unreachable, and flag fixture fallback with a visible badge.

## Summary table

| Route | Component | Who sees it | Data source |
|---|---|---|---|
| `/login` | `Login` | public (no session) | live `/auth/*` |
| `/onboard` | `Onboard` | public (no session) | live `/onboard/*` |
| `/` | → redirect `/today` | staff | — |
| `/today` | `Today` | staff (role-aware) | both |
| `/attention` | `Attention` | staff | both |
| `/ask` | `Ask` | staff | mock service |
| `/next` | `Next` | staff | demo seed |
| `/people` | `People` | staff (role-scoped actions) | both |
| `/people/:id` | `PersonDetail` | staff | both |
| `/learning` | `Learning` | staff | demo seed |
| `/attendance` | `Attendance` | staff (teacher edit) | both |
| `/operations` | `Operations` | staff | demo seed |
| `/fees` | `Fees` | finance/owner/principal (read: staff) | both |
| `/fees/plans` | `FeePlans` | finance/owner/principal | live |
| `/admissions` | `AdmissionsHost` → `FunnelBoard` or `Admissions` | staff | live funnel / demo kanban |
| `/visitors` | `VisitorsHost` → `VisitorsBoard` | desk roles; owner/principal override | live |
| `/transport` | `Transport` | staff | demo seed |
| `/documents` | `Documents` | staff | demo seed |
| `/maintenance` | `Maintenance` | facilities/owner/principal | both |
| `/maintenance/work-orders` | `WorkOrders` | staff | both |
| `/maintenance/work-orders/:id` | `WorkOrderDetail` | staff | both |
| `/maintenance/technician` | `TechnicianWorkspace` | technician + supervisors | both |
| `/maintenance/assets` | `Assets` | staff | both |
| `/maintenance/assets/:id` | `AssetDetail` | staff | both |
| `/maintenance/preventive` | `Preventive` | staff | demo seed |
| `/maintenance/inspections` | `Inspections` | staff | demo seed |
| `/maintenance/inventory` | `MaintInventory` | staff | demo seed |
| `/maintenance/vendors` | `MaintVendors` | staff | demo seed |
| `/maintenance/intelligence` | `MaintIntelligence` | staff | demo seed |
| `/maintenance/map` | `MaintMap` | staff | demo seed |
| `/maintenance/report` | `ReportIssue` | staff (teacher/facilities/technician) | both |
| `/reception` | `Reception` | principal/finance/owner/coordinator/facilities | demo seed |
| `/migration` | `Migration` | owner/finance/principal | both |
| `/plugins` | `PluginsScreen` | staff | live kernel |
| `/plugins/settings`, `/plugins/settings/:id` | `PluginSettings` | owner/IT admin | live |
| `/people-admin` | `PeopleAdmin` | owner/IT admin (+ role-scoped actions) | live |
| `/library` | `LibraryLive` | staff/students (KernelGate `library`) | live |
| `/rails` | `RailsBoard` | owner/IT admin | live |
| `/operations/hr` | `HR` | staff | demo seed |
| `/calendar` | `CalendarScreen` | staff | demo seed |
| `/cases` | `Cases` | staff | demo seed |
| `/cases/:id` | `CaseDetail` | staff | demo seed |
| `/incidents` | `Incidents` | staff | demo seed |
| `/insights` | `Insights` | staff (role-aware ordering) | demo seed |
| `/automation` | `Automation` | staff | mock service |
| `/constitution` | `Constitution` | staff | demo seed |
| `/memory` | `Memory` | staff | mock service |
| `/data-health` | `DataHealth` | staff | demo seed |
| `/action-center` | `ActionCenter` | staff | both |
| `/audit` | `Audit` | owner/principal/itadmin/finance | both |
| `/ai-governance` | `AiGovernance` | staff | demo seed |
| `/ai-usage` | `AiUsage` | staff (finance/owner/principal variant) | demo seed |
| `/group` | `Group` | owner (~principal/finance) | demo seed |
| `/it` | `ItAdmin` | IT admin | both |
| `/settings` | `Settings` | any signed-in | both |
| `/roles` | `RolesAdmin` | owner/IT admin | live |
| `/account/password` | `ChangePassword` | any signed-in (+ forced gate) | live |
| `/parent` | `ParentHome` | parent | demo (live honest empty) |
| `/parent/family` | `FamilyHome` | parent | live |
| `/parent/consents` | `ParentConsents` | parent | live |
| `/parent/requests` | `ParentRequests` | parent | live |
| `/parent/copilot` | `ParentCopilot` | parent | live |
| `/parent/complaints` | `ParentComplaints` | parent | live |
| `/parent/chat` | `ParentChat` | parent | demo seed |
| `/parent/fees` | `ParentFees` | parent | demo seed |
| `/parent/ask` | `ParentAsk` | parent | demo seed |
| `/student` | `StudentHome` | student | demo (live honest empty) |
| `/student/home2` | `StudentHome2` | student | live |
| `/student/learning` | `StudentLearning` | student | demo seed |
| `/student/portfolio` | `StudentPortfolio` | student | static artifacts |
| `/student/ask` | `StudentAsk` | student | demo seed |
| `/teacher`, `/teacher/homework`, `/teacher/submissions`, `/teacher/leave` | `TeacherHome`, `teacher/Homework`, `SubmissionsInbox`, `teacher/MyLeave` | staff (teacher lane) | live-probe + typed fixtures |
| `/print-queue`, `/wellbeing-queue`, `/noticeboard` | `student/PrintQueue`, `student/WellbeingQueue`, `student/Noticeboard` | staff desks | live |
| `/coord/home`, `/coord/substitutions`, `/coord/workload`, `/coord/curriculum`, `/coord/escalations`, `/coord/approvals` | `coord/*` | coordinator + principal | live |
| `/demo`, `/demo/day`, `/demo/parent`, `/demo/summary` | `Demo*` | staff (demo build only) | demo |
| `/live` | `LiveMode` | staff (demo build only) | live |
| `*` | `NotFound` | any signed-in | — |

---

## Auth & account

### `/login` — `Login` (`app/src/screens/Login.tsx`)
- **Who sees it:** Public. Rendered by `AuthGate` whenever no live session exists; it is not in the routed tree (routes redirect `/login` to `/today`).
- **Purpose:** The single front door. Signs a person in by email+password, phone+OTP, or Google SSO; also the multi-tenant school picker and the forced-password-change hand-off.
- **Data shown:** Email/password fields, phone/OTP flow, Google demo button; in demo builds a seeded account grid (`DEMO_ACCOUNTS` from `liveApi.ts`: principal/teacher/finance/transport/facilities/technician/parent/owner/itadmin), a school/tenant picker (`listTenants`), and a role legend.
- **Actions:** `loginFull()` → `POST /auth/login` (reads the 403 `mustChange` + restricted-token body directly, unlike the shared wrapper); OTP `POST /auth/otp/request` and `/auth/otp/verify` (reads 409 `multiTenant` body directly); `POST /auth/google/demo`; `switchTenant`; logout audit `POST /auth/logout`. Honors a `?return=` query and a `tenantId` scope.
- **Live vs demo:** Live. All three methods run against the server; the demo account grid appears only under `VITE_DEMO_MODE`.
- **Data generated:** Auth session/token (`schoolos_token`, `schoolos.session`), logout audit row.

### `/onboard` — `Onboard` (`app/src/screens/Onboard.tsx`)
- **Who sees it:** Public, outside the session tree. `OnboardOrApp` renders it for a school owner who has no session yet.
- **Purpose:** Self-serve school signup (Platform §1.1) — three steps: your school, you the owner, what happens next.
- **Data shown:** Three-step form collecting school name/address/board/phone and owner name/email/password, a password-strength meter, and a done summary (school name + slug). No server data listed beyond the create result.
- **Actions:** `apiSignup({...school, ...owner})` → `POST /onboard/signup`, which returns a token and signs the owner in immediately; then `ensureDataset()` (empty school → honest empty states) and a hard route into the app.
- **Live vs demo:** Live (`onboardingApi.ts`). No demo fallback.
- **Data generated:** Creates the tenant/school, the owner user, and an audited onboarding record in one server transaction.

### `/account/password` — `ChangePassword` (`app/src/screens/account/ChangePassword.tsx`)
- **Who sees it:** Any signed-in role. Not in the `staffOnly` list, so parents/students change their own passwords here too. The same component also renders as the **forced gate** (`mode="gate"`) from `AuthGate` before any route exists.
- **Purpose:** Self-service password change in two modes: `gate` (a provisioned temp-password account with a restricted `mustChange` session) and `page` (voluntary change from Settings).
- **Data shown:** Current/new/confirm password fields, local strength hints, and forced-flow copy explaining the restricted session.
- **Actions:** Posts to `/me/password` via a local full-response fetch (not the shared `call()`, so the door's 401 "current password is not right" does not wipe the session); on success re-issues a full token (epoch bump revokes other sessions), calls `onAuthed`, and navigates.
- **Live vs demo:** Live (`LIVE_BASE` + `setToken`).
- **Data generated:** `users.password_hash` / session epoch bump; audit entry.

---

## Daily command surfaces

### `/today` — `Today` (`app/src/screens/Today.tsx`)
- **Who sees it:** All staff; the content is role-aware (`principal`, `teacher`, `finance`, `transport`, `itadmin`, etc. branches). Light roles are guarded out of `/today`.
- **Purpose:** The role-aware daily home. Principal gets the Morning Briefing (NEEDS YOU / CHANGED OVERNIGHT / TODAY / WATCH); other staff get scoped variants of the same bands; every claim cites source · time · confidence.
- **Data shown:** Brief bands assembled from `seed` actions/obligations/transport, live transport routes (`apiTransportRoutes`), plugin widgets via `<Slot>`, sparklines, and an evidence chain. Staff-role branches add system/integration items (live `/capabilities` for itadmin).
- **Actions:** Navigate to the referenced surface from each briefing card; plugin slots may add their own actions. Refetch on campus/role change.
- **Live vs demo:** Both. `DEMO_MODE` uses the seed briefing; live uses `apiGet`/`apiTransportRoutes` with honest loading/empty/error states.
- **Data generated:** None directly (read/navigation surface).

### `/attention` — `Attention` (`app/src/screens/Attention.tsx`)
- **Who sees it:** All staff (staffOnly).
- **Purpose:** The ranked attention feed merging open Action Center items ("recommended") with derived signals computed from seed records (unmarked registers, delayed routes, failed fees, expiring documents). Every card carries why-it-matters, evidence and a decision path.
- **Data shown:** `apiActions()` recommendations plus derived signals from `data/dataset`; evidence chains, suggested actions, and a plugin `<Slot>`.
- **Actions:** Approve/dismiss via `apiDecideAction(id, decision)` → `POST /actions/:id/decide` (optimistic, reconciles on response; 403 stays open with a friendly error). Click-through to source.
- **Live vs demo:** Both. Live uses `apiActions`/`apiDecideAction`; demo keeps the session-queue behaviour, labelled.
- **Data generated:** Action decisions (`actions` table) and audit entries.

### `/ask` — `Ask` (`app/src/screens/Ask.tsx`)
- **Who sees it:** Staff (staffOnly). The docked `AiDock` full-page counterpart.
- **Purpose:** The full-page conversational surface: turns kept in local state, answers with an evidence chain and trace; right rail shows suggested questions, capability boundary (can/cannot) and grounding notes.
- **Data shown:** Local conversation turns, `aiService.ask` responses (`AiResponse` with evidence/trace), suggested follow-ups, actor/role line ("Access follows your role… every AI read is logged").
- **Actions:** Ask → `aiService.ask` (mock service layer); suggested actions; follow-up questions.
- **Live vs demo:** Mock (`services/index.ts` `aiService`), not a live AI door.
- **Data generated:** Audit entries for AI reads (`audit/add`).

### `/next` — `Next` (`app/src/screens/Next.tsx`)
- **Who sees it:** Staff (staffOnly).
- **Purpose:** "What's next" — a personal plan view merging open actions, obligations, calendar events and active cases into NOW / TODAY / THIS WEEK / LATER bands, plus a generated plan block showing how the plan was derived.
- **Data shown:** Derived from `seed` actions/obligations/calendar/cases, SLA countdowns, `ROLE_OWNER_HINT` ordering by `session.roleId`, evidence chain + AI trace of sources/counts.
- **Actions:** Navigate to each item's source; no writes.
- **Live vs demo:** Demo seed only.
- **Data generated:** None (read surface).

---

## People, learning, operations

### `/people` — `People` (`app/src/screens/People.tsx`)
- **Who sees it:** Staff (staffOnly). Edit/enrol/withdraw controls are role-scoped: `canAddStudent` = owner/principal/coordinator/admissions; `canEdit` = owner/principal/coordinator; `canWithdraw` = owner/principal.
- **Purpose:** The school directory — Students / Teachers / Staff / Guardians, with search, scoped filters and role-aware stats.
- **Data shown:** Live student roster via `apiStudents()` (`GET /students`), seed teachers/staff/guardians in demo, class options, stats (student/teacher/staff/guardian counts, avg attendance sparkline). Live mode honestly shows "—" and "door not connected" for teacher/guardian/attendance rollups.
- **Actions:** Search/filter; Enrol student (`apiUpdateStudent`/`apiPost`) or "Log request" in demo; edit student (`apiUpdateStudent` → `PATCH /plugins/people.admin/students/:id`); withdraw (`apiWithdrawStudent`); promote (`apiPromoteStudent`); CSV export of the current rows (`createObjectURL`/`createElement`).
- **Live vs demo:** Both, split by `DEMO_MODE`. Live writes to people.admin doors; demo uses `peopleService` and a local audit entry.
- **Data generated:** Student records/enrolment (`students`, `student_enrollments`), audit entries.

### `/people/:id` — `PersonDetail` (`app/src/screens/PersonDetail.tsx`)
- **Who sees it:** Staff (staffOnly). Payment confirmation is restricted to finance/owner (`canConfirm`).
- **Purpose:** Student 360 for students; a lighter profile (schedule, classes, contact) for teachers/staff; linked students for guardians. Every AI claim carries provenance.
- **Data shown:** Person record from `seed` + live lookups via `apiGet`; real fee-ledger obligations (`fee_obligations`); attendance sparkline; AI summary via `aiService`; linked students/guardians.
- **Actions:** `apiGet`/`apiPost` doors; "confirm payment" (`POST` settlement) restricted to finance/owner, audited with actor name/role; navigation.
- **Live vs demo:** Both, split by `DEMO_MODE`; live fee rows come from the ledger.
- **Data generated:** Fee payment/confirmation records (`fee_payments`), audit entries.

### `/learning` — `Learning` (`app/src/screens/Learning.tsx`)
- **Who sees it:** Staff (staffOnly).
- **Purpose:** Assignments, assessments, mastery and timetable for the teaching view.
- **Data shown:** Locally generated teaching datasets with fixed seed 3131 (`makeRng`), plus shared timetable/sections from `seed`; `session.roleId === 'teacher'` resolves the acting teacher; bar charts, sparklines, mastery skills.
- **Actions:** Open assignment/assessment drawers, mark items, toasts; no server writes.
- **Live vs demo:** Demo seed / deterministic local generation only.
- **Data generated:** None.

### `/attendance` — `Attendance` (`app/src/screens/Attendance.tsx`)
- **Who sees it:** Staff (staffOnly); teacher is the editing role (`isTeacher`).
- **Purpose:** The mark sheet + register history. Submitting hits the real door; the register prefers server rows so submitted marks survive a reload.
- **Data shown:** `apiAttendance(date, grade, section)` (`GET /attendance`) rows with status; seed term days in demo; attendance line chart; stats.
- **Actions:** Mark present/absent per student and submit via `apiMarkAttendance(date, marks)` → `POST /attendance/mark`; success toast quotes the server's counts (marked/absent/noticesQueued), failures show friendly errors. Demo fixture ids (`st_north_*`) are session-local and labelled.
- **Live vs demo:** Both. Live uses the real doors; demo falls back to the demo blob and says so.
- **Data generated:** `attendance` rows, absence notices queued, audit entry.

### `/operations` — `Operations` (`app/src/screens/Operations.tsx`)
- **Who sees it:** Staff (staffOnly).
- **Purpose:** The operations hub — one live card per domain (every summary recomputed from records), the daily briefing, plus the group asset register and vendor contracts.
- **Data shown:** `feeService` (mock) plus `seed` records recomputed locally; deterministic `makeRng`; daily briefing, vendor contracts, assets.
- **Actions:** Navigate into domain screens; "Reviewed vendor renewal workflow" writes a local audit entry.
- **Live vs demo:** Demo seed / mock service only.
- **Data generated:** Local audit entry (demo store); no backend write.

---

## Fees, admissions, visitors, transport, documents

### `/fees` — `Fees` (`app/src/screens/Fees.tsx`)
- **Who sees it:** Staff. Payment authority is role-scoped: `canInitiate` = finance/owner/principal; `canConfirm` = finance/owner. Others see the ledger read-only with a plain-language reason.
- **Purpose:** The school's money desk — obligation ledger, payment rails, fee plans tab, voiding and analytics.
- **Data shown:** Live ledger via `apiFeeObligations(status)` (`GET /fees/obligations`) with `open/partial/paid/void`; live fee-plan tab embeds `FeePlans`; demo shows `due/overdue/failed/waived`. Charts (line/bar/donut/segmented), student drawer, KPIs, evidence chain.
- **Actions:** Initiate payment (`apiPost`/`apiGet` to the payments rails) and confirm settlement (`POST /fees/payments/:id/confirm`) gated to finance/owner; void an obligation (`apiVoidObligation(id, reason)` → `POST /fees/obligations/:id/void`); demo path writes local audit only.
- **Live vs demo:** Both, split by `DEMO_MODE`, with a "Live ledger" badge; success toasts only quote the server's receipt.
- **Data generated:** `fee_payments`, obligation status/voids, audit entries.

### `/fees/plans` — `FeePlans` (`app/src/screens/finance/FeePlans.tsx`)
- **Who sees it:** Finance/owner/principal (nav) and staff via `/fees/plans`; route is staffOnly via the `/fees` prefix.
- **Purpose:** Wave-2 finance invoicing — define a fee-plan template (grade-set × terms × amount) and bulk-generate student obligations.
- **Data shown:** `apiFeePlans()` (`GET /fee-plans`) list with category, grades, terms, generated counts; honest "doors not live yet" state.
- **Actions:** Create plan (`apiCreateFeePlan` → `POST /fee-plans`) with grade multi-select and per-term amounts; generate (`apiGenerateFeePlan(id)` → `POST /fee-plans/:id/generate`), quoting exactly the server's inserted/skipped/students counts. Voiding lives on `/fees`.
- **Live vs demo:** Live (`liveApi.ts`); explicit non-invention when the door is unavailable.
- **Data generated:** `fee_plans`, bulk `fee_obligations` in one server transaction.

### `/admissions` — `AdmissionsHost` (`Admissions.tsx` / `FunnelBoard.tsx`)
- **Who sees it:** Staff (staffOnly). `AdmissionsHost` chooses by server kernel flag: `admissions.funnel` enabled → `FunnelBoard`; off → demo `Admissions`. Funnel stage transitions are role-scoped (`canTransition` = owner/principal/itadmin/finance/coordinator).
- **Purpose:** The enrollment funnel. `Admissions` is the drag-and-drop kanban; `FunnelBoard` is the live plugin surface with server-enforced PII masking and stage lattice.
- **Data shown:** Demo kanban from `seed` + `admissionsService` (lead cards, stage totals, AI stall diagnosis). Live: `apiFunnelLeads()` (`GET /plugins/admissions.funnel/leads`, masked flag decides PII), `apiFunnelSummary()`, `apiFunnelHistory(id)`.
- **Actions:** Drag / "Move to" stage → `apiFunnelMoveStage(id, to)` (`POST .../leads/:id/stage`, lattice enforced server-side); open history. Demo move writes a local audit entry.
- **Live vs demo:** Both — the kernel flag decides the host; FunnelBoard is strict live.
- **Data generated:** `admission_leads` stage changes + `actions`/audit; demo writes local audit.

### `/visitors` — `VisitorsHost` → `VisitorsBoard` (`VisitorsBoard.tsx`)
- **Who sees it:** Gate-desk roles (`DESK` = owner/principal/itadmin/coordinator) can operate; release override additionally requires owner/principal (`OVERRIDE_ROLES`). When the `ops.visitors` flag is off, the route shows an honest "switched off" empty state.
- **Purpose:** The `ops.visitors` gate pass: log a visitor, check in, raise OTP to the primary guardian for pickup, verify, complete (fail-closed) or deny.
- **Data shown:** `apiVisitorsList(status)` visits with badge, purpose, student, verified state; student picker via `apiStudents()`; danger chip on rows where release is blocked.
- **Actions:** Log (`apiVisitorLog` → `POST /plugins/ops.visitors/visitors`), check-in, raise pickup OTP (`apiVisitorPickup`), verify code (`apiVisitorVerify`, a 401 here is a door error, not session expiry), complete (`apiVisitorComplete`, 409 blocked unless audited owner/principal override with note), deny (`apiVisitorDeny`).
- **Live vs demo:** Live plugin doors only; flag-off degrades to an honest empty state.
- **Data generated:** `visits` records, OTP vault entries, audit entries.

### `/transport` — `Transport` (`app/src/screens/Transport.tsx`)
- **Who sees it:** Staff (staffOnly); transport role is a primary owner in nav.
- **Purpose:** Live route board — route cards with capacity/next stops, Bus 14 (Route 7) standing out with its linked incident, a deterministic SVG map with animated buses, and a delay simulator that trips guardian + leniency workflows.
- **Data shown:** `transportService` (mock) + `seed` routes; deterministic `makeRng` map geometry; capacity progress bars; delay simulator.
- **Actions:** Simulate delay → mock service + local audit entry (`actorRole`), which propagates to guardian/leniency demo workflows.
- **Live vs demo:** Demo/mock service only.
- **Data generated:** Local audit entry (demo store); no backend write.

### `/documents` — `Documents` (`app/src/screens/Documents.tsx`)
- **Who sees it:** Staff (staffOnly).
- **Purpose:** The compliance registry — filters/search, expiring-soon renewals with one-tap tasks, expiry-forecast AI block, inspection-pack generator, mock upload.
- **Data shown:** `seed.documents` filtered/searched; expiry forecast (deterministic `makeRng`); renewal task list; status badges; bar chart.
- **Actions:** Create renewal task (local `createRenewalTask`); generate inspection pack; mock upload appends to the working list; each write logs a local audit entry.
- **Live vs demo:** Demo seed only (explicitly "mock upload").
- **Data generated:** Local working list + audit entries; no backend.

---

## Maintenance suite

### `/maintenance` — `Maintenance` (`app/src/screens/Maintenance.tsx`)
- **Who sees it:** Staff; nav for principal/coordinator/finance/owner/facilities. staffOnly via `/maintenance`.
- **Purpose:** The operations overview — what's broken, at risk, who is on it, due this week, where the money goes. Every AI statement summarises the records below it.
- **Data shown:** `maintenanceService.overview` (mock) and live `apiWorkOrders()` (`GET /work-orders`) + `apiEvents()`; analytics, SLA risk, assets, plans; evidence/AI trace; maintenance chips (`PriorityBadge`, `SLAIndicator`, `WOStatusChip`).
- **Actions:** Navigate into work orders/assets/plans; tabs; refetch.
- **Live vs demo:** Both, split by `DEMO_MODE`; live prefers the real work-orders door.
- **Data generated:** None directly.

### `/maintenance/work-orders` — `WorkOrders` (`app/src/screens/WorkOrders.tsx`)
- **Who sees it:** Staff; nav for facilities/owner/principal/coordinator.
- **Purpose:** The maintenance board — kanban columns Reported / Assigned / On site / Repairing / Verification; live build reads the real door and transitions run the server state machine.
- **Data shown:** `apiWorkOrders()` (live) or hydrated demo store; priority/status/SLA chips; stats; tabs. The door does not expose assignment/reporter/building/resolved_at, so those columns are deliberately absent (never invented).
- **Actions:** Advance/transition status via the board (server `POST /work-orders/:id/status` in live; local `wo/advance` in demo); open detail.
- **Live vs demo:** Both, split by `DEMO_MODE`; honest about missing columns.
- **Data generated:** `work_orders` status transitions + audit.

### `/maintenance/work-orders/:id` — `WorkOrderDetail` (`app/src/screens/WorkOrderDetail.tsx`)
- **Who sees it:** Staff. Manage actions are role-gated.
- **Purpose:** Full work-order page — what was understood, priority rationale, assignee, SLA, cost and audit-grade timeline; manage actions (assign, advance, override, verify, escalate) write to the ledger.
- **Data shown:** `apiWorkOrders()` / `apiWorkOrderStatus()` live, or demo store; `AiUnderstanding`, `PriorityWhy`, `TechnicianWhy`, `WOStepper`, SLA, cost, timeline, asset mini.
- **Actions:** Advance status (`POST /work-orders/:id/status`, optional cost on resolve), override/escalate/verify, with confirmation modal; demo dispatches `wo/advance`.
- **Live vs demo:** Both, split by `DEMO_MODE`.
- **Data generated:** `work_orders` transitions, cost, audit entries.

### `/maintenance/technician` — `TechnicianWorkspace` (`app/src/screens/TechnicianWorkspace.tsx`)
- **Who sees it:** Technician (nav "My Jobs"); supervisors opening the route see the whole campus queue with a note.
- **Purpose:** Mobile-first job sheet for the signed-in technician (demo identity Arif Shaikh). Voice-first completion: inspect per category steps, hit the mic, confirm the parsed summary, complete — the job moves to verification.
- **Data shown:** Tabs Mine / Queue / Done; `apiWorkOrders()` + `apiWorkOrderStatus()` or demo store; priority/SLA/asset chips; category step lists; voice-parsed summary.
- **Actions:** Accept/advance/complete a job, record parts/cost via `maintenanceService.complete()` (which decrements inventory in demo) or the live status door; every action audited with technician name.
- **Live vs demo:** Both, split by `DEMO_MODE`.
- **Data generated:** `work_orders` transitions, inventory decrements (demo), audit entries.

### `/maintenance/assets` — `Assets` (`app/src/screens/Assets.tsx`)
- **Who sees it:** Staff; nav for technician and owner/principal.
- **Purpose:** The asset registry — every maintained thing on campus, scoped to the active campus, sorted worst-health first; answers what we own, where, health, next service, and how to report from the floor (QR tag).
- **Data shown:** `apiAssets()` (live `GET /assets`) or `maintenanceService.assets`; health rings, status dots, asset tags, QR pattern, drawer.
- **Actions:** Filter/sort; open asset; QR tag opens `ReportIssue` with the asset preset; refetch.
- **Live vs demo:** Both, split by `DEMO_MODE`.
- **Data generated:** None directly.

### `/maintenance/assets/:id` — `AssetDetail` (`app/src/screens/AssetDetail.tsx`)
- **Who sees it:** Staff.
- **Purpose:** One asset, whole story — identity/location, health model with factors, failure history, attached work orders and preventive plans, rule-based replacement evaluation (labelled a heuristic, not a prediction).
- **Data shown:** `apiAssets()` + `apiWorkOrders()` live, or `maintenanceService`; `HealthRing`, timeline, MP key-values, QR pattern.
- **Actions:** Navigate to related work orders/plans; report an issue against this asset; refetch.
- **Live vs demo:** Both, split by `DEMO_MODE`.
- **Data generated:** None (read surface).

### `/maintenance/preventive` — `Preventive` (`app/src/screens/Preventive.tsx`)
- **Who sees it:** Staff.
- **Purpose:** The planned-work board — what maintenance is scheduled, what is late, which high-risk assets the plan windows touch, what to do about each plan; every number recomputed from plan/asset records.
- **Data shown:** `maintenanceService.plans` + assets (mock/seed); plan cards, late/soon chips, asset mini, drawer.
- **Actions:** Create a work order from a plan (`createWO` in demo), open asset, mark plan actions; toasts.
- **Live vs demo:** Demo seed / mock service only.
- **Data generated:** Local demo work order (no backend).

### `/maintenance/inspections` — `Inspections` (`app/src/screens/Inspections.tsx`)
- **Who sees it:** Staff.
- **Purpose:** The compliance check register — what is scheduled, completed this month, failed, and whether each failure already has a work order behind it. Counts recomputed from records.
- **Data shown:** `maintenanceService.inspections` (mock/seed); `AssetTag`, DataTable, drawer, KPIs.
- **Actions:** Open findings, navigate, refetch; no writes.
- **Live vs demo:** Demo seed / mock service only.
- **Data generated:** None.

### `/maintenance/inventory` — `MaintInventory` (`app/src/screens/MaintInventory.tsx`)
- **Who sees it:** Staff.
- **Purpose:** Spare parts and consumables — what is in stores, below threshold, already requested, and holding cost. Restock requests land locally (demo) and on the procurement desk.
- **Data shown:** `maintenanceService.inventory` (mock/seed); below-threshold progress, cost sparkline, restock modal.
- **Actions:** Raise a restock request (local demo), open procurement; inventory decrements automatically when technicians record parts on work orders.
- **Live vs demo:** Demo seed / mock service only.
- **Data generated:** Local demo restock request; no backend.

### `/maintenance/vendors` — `MaintVendors` (`app/src/screens/MaintVendors.tsx`)
- **Who sees it:** Staff.
- **Purpose:** Who does the work we can't do in-house — contract status, SLA performance, spend and ratings, expiry watch, and work orders escalated to vendor partners.
- **Data shown:** `maintenanceService.vendors` + work orders (mock/seed); vendor cards, expiry callout, escalation list, drawer.
- **Actions:** Review vendor/escalation, navigate; no writes.
- **Live vs demo:** Demo seed / mock service only.
- **Data generated:** None.

### `/maintenance/intelligence` — `MaintIntelligence` (`app/src/screens/MaintIntelligence.tsx`)
- **Who sees it:** Staff.
- **Purpose:** "Read the operations" — where the money goes, SLA holding, repeat-failing assets, replacement cost, technician performance, preventive compliance. Deterministic arithmetic, rule-based insight honestly labelled.
- **Data shown:** `maintenanceService` records + `makeRng`; bar/donut charts, DataTable, segmented bars, asset/priority chips.
- **Actions:** Drill into asset/WO links; refetch.
- **Live vs demo:** Demo seed / mock service only.
- **Data generated:** None.

### `/maintenance/map` — `MaintMap` (`app/src/screens/MaintMap.tsx`)
- **Who sees it:** Staff.
- **Purpose:** Facilities map — "where is the trouble": a deterministic schematic floorplan per campus with tagged assets as status dots, active work orders as pulsing rings, technicians on shift below.
- **Data shown:** `maintenanceService` + seed assets/work orders; `makeRng(9101)` building layout, id-hashed dot positions; tabs per campus, drawer.
- **Actions:** Click assets/work orders for a drawer; navigate.
- **Live vs demo:** Demo seed / mock service only.
- **Data generated:** None.

### `/maintenance/report` — `ReportIssue` (`app/src/screens/ReportIssue.tsx`)
- **Who sees it:** Staff; nav for teacher/facilities/technician. Accepts `?asset=` preset (from QR tags).
- **Purpose:** "Tell us what happened." One box; AI extracts category, asset, location, priority and skill; the reporter confirms with one tap. No ten-field form.
- **Data shown:** Free-text input with examples; classification result (`AiUnderstanding`, asset, priority, SLA, technician why); phases input → thinking → classified → assigned → done.
- **Actions:** Classify via `maintenanceService.createFromReport` (deterministic demo extraction) or live `apiCreateWorkOrder` → `POST /work-orders`; assign/advance via `apiWorkOrderStatus`; local audit entry.
- **Live vs demo:** Both, split by `DEMO_MODE` (demo uses the mock extractor; live posts the work order).
- **Data generated:** `work_orders` record (+ assignment/status), audit entry.

---

## Front desk, migration, kernel & platform

### `/reception` — `Reception` (`app/src/screens/Reception.tsx`)
- **Who sees it:** Staff; nav for principal/coordinator/finance/owner/facilities.
- **Purpose:** The AI front desk — answers every call from school records, never guesses, hands off with context, and shows its work (phone + WhatsApp + walk-in, one desk).
- **Data shown:** `seed` reception calls with transcripts, intents, outcomes (resolved / handoff / callback-scheduled / voicemail), evidence chain and AI trace; stat cards.
- **Actions:** Open a call drawer, play/review the transcript, hand off to a staff member; no server writes.
- **Live vs demo:** Demo seed only.
- **Data generated:** None.

### `/migration` — `Migration` (`app/src/screens/Migration.tsx`)
- **Who sees it:** Staff; nav for owner/finance. staffOnly.
- **Purpose:** Golden Loop 1 — the guided switch: connect → analyze → map → health → shadow → trust receipt → cutover → first day, with a seeded corpus of student/fee/admissions sources.
- **Data shown:** Seeded `MIG_SOURCES` (rows/imported/flagged/skipped/confidence, per-row issues) plus live `apiMigrationSources()` when available; step rail, event timeline, trust receipt, verify rows, first-day script.
- **Actions:** Create source (`apiMigrationCreateSource` → `POST /migration/sources`), stage rows (`apiMigrationStageRows`), advance stages (`apiMigrationStage`), validate (`apiMigrationValidate`), commit (`apiMigrationCommit`), activate (`apiMigrationActivate`). Demo build runs the seeded corpus.
- **Live vs demo:** Both; live writes to the migration tables, demo uses the seeded corpus and honest badges.
- **Data generated:** `migration_sources`+staged rows, imported student/fee records on commit, trust receipt, audit.

### `/plugins` — `PluginsScreen` (`app/src/screens/Plugins.tsx`)
- **Who sees it:** Staff; nav label "Modules" for principal/owner/itadmin.
- **Purpose:** The plugin switchboard (kernel-owned, not a plugin). Enable/disable modules; every switch is audited server-side.
- **Data shown:** `useKernel()` registry (all/enabled/configured/available/requiredPlan) intersected with `BUILT_IN_CAPABILITIES`; friendly name/description map; class/permission info; inline `PluginSettingsForm` drawer.
- **Actions:** Enable (`apiEnablePlugin(id, version, class, permissions)` → `POST /plugins/:id/enable`), disable (`apiDisablePlugin` → `POST /plugins/:id/disable`); open settings.
- **Live vs demo:** Live kernel (`LIVE_API`), with friendly fallback text for server manifest prose.
- **Data generated:** `plugins` enablement state + audit entries.

### `/plugins/settings`, `/plugins/settings/:id` — `PluginSettings` (`app/src/screens/PluginSettings.tsx`)
- **Who sees it:** Owner + IT admin only (the save door's roles); staffOnly routing keeps light roles out.
- **Purpose:** The settings hub — every registered plugin declaring a `settingsSchema`, rendered through the shared generic form.
- **Data shown:** `apiGet('/plugins')` rows with manifest `settingsSchema`; for owner/IT admin only, the saved `settings` values (non-privileged readers get `{hasSettings, keys}` + schema, never values — redteam P1-2); per-plugin form.
- **Actions:** Save via the shared `PluginSettingsForm` (`POST /plugins/:id/settings`, wholesale jsonb replace; blank secret = keep saved value; client-side validation against the L3-5.1 dialect).
- **Live vs demo:** Live.
- **Data generated:** `plugins.settings` jsonb + audit.

### `/people-admin` — `PeopleAdmin` (`app/src/screens/PeopleAdmin.tsx`)
- **Who sees it:** Owner/IT admin for provisioning/suspend/reset/import (`canAdmin` = owner/itadmin); student transfer gated to owner/principal/coordinator; withdraw to owner/principal. Route is behind `KernelGate plugin="people.admin"` and staffOnly.
- **Purpose:** The school-office console for people, live: provision a user (temp password shown once), suspend/reactivate, reset password, transfer a student, import students from CSV with a per-row report.
- **Data shown:** `adminListUsers()` (`GET /plugins/people.admin/users`) with active state and role; onboarding checklist via `apiOnboardStatus()`; role options from `KNOWN_ROLES` minus owner/student; import report rows.
- **Actions:** Create user (`adminCreateUser` → `POST .../users`), suspend/activate/reset (`POST .../users/:id/*`), transfer (`adminTransferStudent` → `POST .../students/:id/transfer`), import (`adminImportStudents` → `POST .../import/students`), plus `apiUpdateStudent`/`apiWithdrawStudent`. Every secret shown once with copy.
- **Live vs demo:** Live (`adminApi.ts` + `liveApi`).
- **Data generated:** `users`, `student_enrollments`/transfer history, imported students, audit entries.

### `/library` — `LibraryLive` (`app/src/screens/LibraryLive.tsx`)
- **Who sees it:** `KernelGate plugin="library"`; staff (owner/principal/coordinator/facilities, or a custom role granted the doors via `roleOrGrant`); students see their own loans (`isStudent`). Disabling the plugin removes the route.
- **Purpose:** Real library surface — catalog, add book, issue → return → overdue (and a student's own loans).
- **Data shown:** `libraryBooks()` (`GET /plugins/library/books`), `libraryLoans()`/`libraryOverdue()` or `libraryMyLoans()` depending on the caller; fine amounts.
- **Actions:** Add book (`libraryAddBook` → `POST .../books`), issue (`libraryIssue` → `POST .../loans`), return (`libraryReturn` → `POST .../loans/:id/return`).
- **Live vs demo:** Live `library.*` doors; honest error/empty when unreachable.
- **Data generated:** `library_books`, `library_loans` (issue/return) + audit.

### `/rails` — `RailsBoard` (`app/src/screens/RailsBoard.tsx`)
- **Who sees it:** Owner/IT admin (nav "System services"); staffOnly.
- **Purpose:** System services status — which optional rails are actually configured (SMS, WhatsApp, Razorpay), which plugins are on, and message-queue health. Uses `/capabilities` so the school never wonders "is WhatsApp actually sending?".
- **Data shown:** `getCapabilities()` from `capabilitiesApi` (rail configured flags, plugin enablement) and Prometheus gauges from `apiGet` (`outbox_pending`, `comms_queued`); a 403 on `/metrics` degrades to "unavailable".
- **Actions:** Refresh; no writes.
- **Live vs demo:** Live.
- **Data generated:** None.

### `/operations/hr` — `HR` (`app/src/screens/HR.tsx`)
- **Who sees it:** Staff (staffOnly via `/operations`).
- **Purpose:** Staff operations — leave requests with approve/reject and audit, the attendance strip, the Ms. Sarita Mishra substitution case with ranked candidates, and staff certificate-expiry watch.
- **Data shown:** `actionService` (mock) + `seed`; leave requests, staff attendance, substitution candidates, certificate expiry; AI trace; deterministic `makeRng`.
- **Actions:** Approve/reject leave (mock `actionService`, local audit entry with actor/role); review substitution candidates; toasts.
- **Live vs demo:** Demo/mock service only.
- **Data generated:** Local audit; no backend.

### `/calendar` — `CalendarScreen` (`app/src/screens/CalendarScreen.tsx`)
- **Who sees it:** Staff (staffOnly).
- **Purpose:** Month grid with event chips, type/campus filters, a day drawer with an add-event modal, an upcoming side panel and the exam-conflict policy card (max one exam per campus per day).
- **Data shown:** `seed` calendar events; event types (exam/ptm/trip/deadline/staff/inspection/admission/event), colour coding, countdowns, exam-conflict policy.
- **Actions:** Add event (writes a local audit entry explicitly noting "Saved on this device only — school calendar not connected"); filter; open day drawer.
- **Live vs demo:** Demo seed only; the add-event modal is device-local and says so.
- **Data generated:** Local audit entry; no backend.

### `/it` — `ItAdmin` (`app/src/screens/ItAdmin.tsx`)
- **Who sees it:** IT admin (nav "Platform"); staffOnly.
- **Purpose:** IT Admin console — platform health, access & sessions, API keys/integrations, feature flags, data residency and backups. T305: controls with no server door render disabled with honest copy.
- **Data shown:** Deterministic demo data (`makeRng(4040)`) for sessions/keys/flags/backups; live platform metrics parsed from `apiGet` Prometheus text (uptime, requests, errors, pool waiting, schema migrations).
- **Actions:** Where a door exists, refresh/rotate/download; otherwise disabled controls with explanatory copy. No fabricated success.
- **Live vs demo:** Both — live metrics parse from the server where available; the rest is honest demo/disabled.
- **Data generated:** None (read/disabled surface).

### `/settings` — `Settings` (`app/src/screens/Settings.tsx`)
- **Who sees it:** Any signed-in role (also linked from the account menu).
- **Purpose:** User/app settings — profile, appearance (system/light/dark), language (English/Hindi partial), account security (MFA), demo personas, and data-protection requests.
- **Data shown:** Session/actor info, `useStore` demo accounts, seeded tenant info, theme and language state, MFA section (`account/MfaSection`).
- **Actions:** Change theme (`setTheme`), language (`setLang`), open MFA; file a DPDP data request via `apiPost('/plugins/pack.dpdp/dsr', { kind, subjectRef })` for export/erasure, requiring the guardian phone on record.
- **Live vs demo:** Both — theme/language are local; the DPDP DSR call is a live, DPO-gated door.
- **Data generated:** `pack.dpdp` DSR record; local preferences.

### `/roles` — `RolesAdmin` (`app/src/screens/RolesAdmin.tsx`)
- **Who sees it:** Owner + IT admin (server `ROLES_ADMIN`); staffOnly.
- **Purpose:** Custom-roles console over the L3-4.2 doors — a custom role is a builtin base role plus an allow/deny mask over real doors.
- **Data shown:** `apiGet('/roles')` custom roles with base_role, permissions `{allow,deny}`, members, and `builtin` role list; presets that the server validates against the live route registry.
- **Actions:** Create (`POST /roles`), edit (`PATCH /roles/:key`), delete (`DELETE /roles/:key`, 409 while members > 0), assign/unassign users (`POST /roles/:key/assign|unassign`, 1–200, never self/owners). PATCH/DELETE use local full-response fetches on `LIVE_BASE`.
- **Live vs demo:** Live.
- **Data generated:** `custom_roles` + assignments + audit.

---

## Intelligence, governance, group

### `/cases` — `Cases` (`app/src/screens/Cases.tsx`)
- **Who sees it:** Staff (staffOnly).
- **Purpose:** Unified case management across every channel: WhatsApp, phone, walk-in, system events and staff referrals.
- **Data shown:** `seed` cases with kind tabs (complaint/request/reconciliation/compliance/transport/facilities), SLA countdown clock, stats, AI triage, evidence chain.
- **Actions:** Open case detail; create a case (local, audited with actor/role); tabs/filters.
- **Live vs demo:** Demo seed only.
- **Data generated:** Local audit entry; no backend.

### `/cases/:id` — `CaseDetail` (`app/src/screens/CaseDetail.tsx`)
- **Who sees it:** Staff (staffOnly via `/cases`).
- **Purpose:** The case workspace — thread, notes, WhatsApp reply draft, SLA clock, similar cases and AI triage.
- **Data shown:** `seed` case by id; message thread, internal notes, SLA progress, similar cases, AI trace/evidence.
- **Actions:** Add internal note, draft/send WhatsApp reply, escalate to principal, advance status; each logs a local audit entry with actor/role.
- **Live vs demo:** Demo seed only.
- **Data generated:** Local audit entries; no backend.

### `/incidents` — `Incidents` (`app/src/screens/Incidents.tsx`)
- **Who sees it:** Staff (staffOnly).
- **Purpose:** The incident lifecycle board: Detected → Triaged → Assigned → In-progress → Resolved → Reviewed.
- **Data shown:** `seed` incident records with status lanes, sparkline, timeline drawer, stats.
- **Actions:** Advance status, open a case from an incident, log a maintenance note; local audit entries.
- **Live vs demo:** Demo seed only.
- **Data generated:** Local audit; no backend.

### `/insights` — `Insights` (`app/src/screens/Insights.tsx`)
- **Who sees it:** Staff (staffOnly); role-aware — the viewer's own domain sorts/highlights first (`ins.ownerRole === session.roleId`).
- **Purpose:** Question-driven analytics home — a search box handing off to Ask, three seed-computed stats, and a grid of question cards.
- **Data shown:** `seed.insights` question cards, collection/attendance/workload stats, full-analysis drawer with charts/clusters/actions.
- **Actions:** Search → navigate to Ask; "Open full analysis" drawer; click-through to source.
- **Live vs demo:** Demo seed only.
- **Data generated:** None.

### `/automation` — `Automation` (`app/src/screens/Automation.tsx`)
- **Who sees it:** Staff (staffOnly); nav for principal.
- **Purpose:** The constitution-gated workflow runtime — library cards, workflow detail drawer, NL-to-workflow compiler, and a visual click-to-connect builder.
- **Data shown:** `workflowService` (mock) + `seed` workflow definitions/runs/steps; step icons, run history, stats, error/empty states.
- **Actions:** Create/edit workflows (NL compiler, visual builder), run in observe mode, save draft; local audit entries.
- **Live vs demo:** Mock service only.
- **Data generated:** Local audit entries; no backend.

### `/constitution` — `Constitution` (`app/src/screens/Constitution.tsx`)
- **Who sees it:** Staff (staffOnly).
- **Purpose:** The three-layer policy manager — platform floor, regulatory pack, school constitution.
- **Data shown:** `seed.policies` grouped into categories (Attendance/Fees/Communication/Approvals/Safeguarding/Transport/Privacy/AI Governance) with posture (AUTO / APPROVAL REQUIRED / HUMAN-ONLY) and pinned clause refs.
- **Actions:** Add/edit a constitution entry (modal), toggle policy posture; writes a local audit entry with actor/role.
- **Live vs demo:** Demo seed only.
- **Data generated:** Local audit only.

### `/memory` — `Memory` (`app/src/screens/Memory.tsx`)
- **Who sees it:** Staff (staffOnly); nav "AI memory" for principal/itadmin.
- **Purpose:** The closed loop — decisions, meetings, documents and the merged timeline; expected vs actual outcomes, reconciled.
- **Data shown:** `memoryService` (mock) + `seed` decision records, meetings, documents, merged timeline; status tones; AI trace/evidence.
- **Actions:** Close a decision loop, note a task from a meeting (explicitly no task created), open detail; local audit entries.
- **Live vs demo:** Mock service only.
- **Data generated:** Local audit entries; no backend.

### `/data-health` — `DataHealth` (`app/src/screens/DataHealth.tsx`)
- **Who sees it:** Staff (staffOnly).
- **Purpose:** The trust console for records and integrations — a health score, issues grouped by category, affected seed records, fixes, integration status and recent fixes.
- **Data shown:** `seed` health issues/people; score animates locally as issues are fixed (+2.6 baseline 94); drawer, DataTable, progress.
- **Actions:** Review/Fix/Ignore an issue — writes an immutable local audit entry and updates local status (seed untouched).
- **Live vs demo:** Demo seed only.
- **Data generated:** Local audit entries; no backend.

### `/action-center` — `ActionCenter` (`app/src/screens/ActionCenter.tsx`)
- **Who sees it:** Staff (staffOnly).
- **Purpose:** The unified inbox of everything awaiting a decision; loads from `GET /actions` and approves/dismisses through the real decide door.
- **Data shown:** `apiActions()` queue with kind/status/age, evidence chains, tabs, drawer, stats; demo keeps the session queue labelled.
- **Actions:** Approve/dismiss via `apiDecideAction(id, decision)` → `POST /actions/:id/decide` (optimistic; a 403 "not the owning authority" or any failure surfaces a friendly error and leaves the item open; toasts only claim what the server returned). Demo dispatches `action/decide`.
- **Live vs demo:** Both, split by `DEMO_MODE`.
- **Data generated:** `actions` decisions + execution + audit.

### `/audit` — `Audit` (`app/src/screens/Audit.tsx`)
- **Who sees it:** Owner/principal/itadmin/finance (the door's roles); all staff can reach the route but non-allowed roles get the honest session-only fallback.
- **Purpose:** The school's append-only ledger; entries load from `GET /audit`. If the door is unreachable or the role is not allowed, it says so and falls back to **this session's** entries with a visible label — never presented as the school ledger.
- **Data shown:** `apiAudit(limit)` (`GET /audit`) hash-chained entries with actor/action/record/policy/risk/outcome; filters, drawer, stats, CSV export.
- **Actions:** Export builds a real CSV from the rows on screen and downloads it; filter/inspect; no writes.
- **Live vs demo:** Both, split by `DEMO_MODE`; demo shows session entries with a label.
- **Data generated:** None (read; CSV download).

### `/ai-governance` — `AiGovernance` (`app/src/screens/AiGovernance.tsx`)
- **Who sees it:** Staff (staffOnly).
- **Purpose:** The human-control boundary — policy posture table, recent AI decisions with "Why" traces, the shield log, model routing and AI cost & usage.
- **Data shown:** `seed.policies` filtered to AI Governance category, posture distribution, `seed` AI traces/shield log/model routing/cost; tables and sparkline.
- **Actions:** Filter posture, open "Why" trace drawer; toasts; no writes.
- **Live vs demo:** Demo seed only.
- **Data generated:** None.

### `/ai-usage` — `AiUsage` (`app/src/screens/AiUsage.tsx`)
- **Who sees it:** Staff; `isFinanceView` (finance/owner/principal) changes the subtitle/framing.
- **Purpose:** AI usage & cost — spend vs budget, daily cost and request volume, per-feature split, latency, model mix and cost guardrails.
- **Data shown:** `seed.aiUsage` (days, byFeature, latency, failureRate, monthSpend, budget) with bar/donut/line/sparkline charts and a DataTable.
- **Actions:** Read-only; no writes.
- **Live vs demo:** Demo seed only.
- **Data generated:** None.

### `/group` — `Group` (`app/src/screens/Group.tsx`)
- **Who sees it:** Owner (nav "Group"); the trace text states the group scope is Owner/Principal/Finance only. staffOnly.
- **Purpose:** The multi-campus Owner console — campus comparison, cross-campus Ask with evidence, group decisions, obligations and shared standards.
- **Data shown:** `seed` campuses + canonical per-campus metrics (`CAMPUS_METRICS`) and deterministic trends (`makeRng`); comparison table, group decisions, obligations, AI trace/evidence.
- **Actions:** Review group decisions (local audit entry "Reviewed vendor renewal workflow" lives on Operations; Group itself is read/decision display), switch campus scope via the topbar.
- **Live vs demo:** Demo seed only.
- **Data generated:** None directly.

---

## Parent surfaces

### `/parent` — `ParentHome` (`app/src/screens/ParentHome.tsx`)
- **Who sees it:** Parent (light role). In a demo build, `DEMO_MODE` renders `DemoParentHome`; otherwise `ParentHomeNotConfigured`.
- **Purpose:** The warm, WhatsApp-first parent home for Kavita Sharma, guardian of Aarav Sharma (8-B): today, learning, fees, school messages and quick actions. No admin jargon.
- **Data shown:** `seed.DEMO_STUDENT`/`DEMO_GUARDIAN` fixed demo pair read inside the component; timetable, fee summary, messages, quick actions. If the fixture is absent, an honest "no demo family configured" state (no substituted child, no fake numbers).
- **Actions:** Quick action modals (pay fee, message, ask), navigate to linked parent screens; no server writes.
- **Live vs demo:** Demo seed; live tenant gets the honest not-configured state pointing at the live Family surface.
- **Data generated:** None.

### `/parent/family` — `FamilyHome` (`app/src/screens/FamilyHome.tsx`)
- **Who sees it:** Parent (light role). This is the parent landing surface.
- **Purpose:** The Family Command Center — which child, how is today, what needs you, how was the week.
- **Data shown:** `getParentHome()`, `getBrief(when)`, `getConsents()`, and per-child `getAttendance`/`getAssignments`/`getExams`; plain-language attendance words, attention items, actions, brief. Uses `parentFirstName()` and `isDeniedError()`.
- **Actions:** Navigate per child/attention item; no writes on this screen.
- **Live vs demo:** Live `parentApi.ts` only; every door failure degrades to a calm `DeniedEmpty`/`ParentError` (never invented data).
- **Data generated:** None.

### `/parent/consents` — `ParentConsents` (`app/src/screens/parent/Consents.tsx`)
- **Who sees it:** Parent (light role).
- **Purpose:** The parent consent center — the school asks permission (trips, photos, medical, activities, transport); one decision per form, final and read-only once decided.
- **Data shown:** `getConsents()` (`GET /parent/consents`) with kind/title/detail/due/status; review modal.
- **Actions:** Grant/decline via `decideConsent(id, 'granted'|'declined')` → `POST /parent/consents/:id/decide` (immutable once set), with busy/error states.
- **Live vs demo:** Live `parentApi.ts`.
- **Data generated:** `parent_consents` decision + audit.

### `/parent/requests` — `ParentRequests` (`app/src/screens/parent/Requests.tsx`)
- **Who sees it:** Parent (light role).
- **Purpose:** The unified parent request center — certificates, documents, transport, activity, profile correction, re-evaluation, other — each with a stepped status timeline.
- **Data shown:** `getRequests()` (`GET /parent/requests`) with category/status timeline, SLA, owner role; plain-language status words.
- **Actions:** Create request (`createRequest` → `POST /parent/requests`); report a discrepancy (`reportDiscrepancy` → `POST /parent/report-discrepancy`, case-style). Parents never edit school records.
- **Live vs demo:** Live.
- **Data generated:** `family_requests` + events, discrepancy case.

### `/parent/copilot` — `ParentCopilot` (`app/src/screens/parent/Copilot.tsx`)
- **Who sees it:** Parent (light role).
- **Purpose:** The family AI assistant — deterministic v0 answers composed from the family's authorized records, every answer showing its sources; an honest-empty answer says what it could not find; budget-capped server-side.
- **Data shown:** Conversation turns (`CopilotAnswer` with sources + remaining budget); starter prompts; human-in-the-loop draft textarea.
- **Actions:** Ask (`askCopilot(question, childId?)` → `POST /parent/copilot/ask`); draft a note (`draftCopilotNote` → `POST /parent/copilot/draft`, always editable — the human sends).
- **Live vs demo:** Live `parentApi.ts`.
- **Data generated:** None (reads logged); no record writes.

### `/parent/complaints` — `ParentComplaints` (`app/src/screens/ParentComplaints.tsx`)
- **Who sees it:** Parent (light role).
- **Purpose:** "My complaints" — the parent's own view of a concern they raised; the board itself stays staff-only.
- **Data shown:** `apiMyCases()` (`GET /my-cases`) filtered to `origin === 'parent'` or `kind === 'complaint'`, with status labels ("Received — the school will review", etc.).
- **Actions:** Submit via `apiCreateCase({ origin: 'parent' })` → `POST /cases`; load/refresh; inline busy/error states.
- **Live vs demo:** Live `liveApi.ts`.
- **Data generated:** `cases` record (origin parent) + audit.

### `/parent/chat` — `ParentChat` (`app/src/screens/ParentChat.tsx`)
- **Who sees it:** Parent (light role).
- **Purpose:** The WhatsApp-style thread with the school — bubbles, day separators, template labels, quick replies, a voice-note flow and a school autoreply.
- **Data shown:** `seed` messages for the fixed demo pair; quick replies; T504 honest status ticks (replaces fabricated delivered/read ticks — this thread is device-only).
- **Actions:** Send a message, tap quick replies, record a voice note, receive the school autoreply; device-local only.
- **Live vs demo:** Demo seed only; the thread is device-only and labelled.
- **Data generated:** None server-side.

### `/parent/fees` — `ParentFees` (`app/src/screens/ParentFees.tsx`)
- **Who sees it:** Parent (light role).
- **Purpose:** The parent fee center — next due payment with mock checkout, payment history with retry, fee structure explainer and concessions.
- **Data shown:** `seed.DEMO_STUDENT`/ledger-driven next-due (earliest open Term 2 obligation; falls back to next scheduled term), payment history, status badges, fee structure, concessions.
- **Actions:** Pay now (mock checkout modal), retry a failed payment, view receipt; device-local/demo.
- **Live vs demo:** Demo seed only.
- **Data generated:** None server-side.

### `/parent/ask` — `ParentAsk` (`app/src/screens/ParentAsk.tsx`)
- **Who sees it:** Parent (light role).
- **Purpose:** A calm question-and-answer surface for parents; answers built from the child's actual records with small source chips. No admin AI panel, no traces.
- **Data shown:** Fixed demo anchors (`DEMO_STUDENT`/`DEMO_GUARDIAN`) — bus status, upcoming tests, PTM, fee line items — with source chips.
- **Actions:** Ask a suggested or free-form question; answers are composed locally with sources.
- **Live vs demo:** Demo seed only.
- **Data generated:** None.

---

## Student surfaces

### `/student` — `StudentHome` (`app/src/screens/StudentHome.tsx`)
- **Who sees it:** Student (light role). `DEMO_MODE` renders `DemoStudentHome`; otherwise `StudentHomeNotConfigured`.
- **Purpose:** "My Day" for Aarav Sharma (8-B) — a calm vertical rhythm: today, due soon, growth, school life. No feeds, no streaks, no red alerts.
- **Data shown:** `seed.DEMO_STUDENT` fixture read inside the component; today's timetable, due-soon work, growth, school life. Absent fixture → honest not-configured state.
- **Actions:** Navigate to learning/portfolio/ask; no server writes.
- **Live vs demo:** Demo seed; live tenant gets the honest empty state.
- **Data generated:** None.

### `/student/home2` — `StudentHome2` (`app/src/screens/student/StudentHome2.tsx`)
- **Who sees it:** Student (light role). The live student landing.
- **Purpose:** "My Day" over the live student doors: today, what needs attention, your own progress, quick access, tomorrow's bag, and paper. School-computer-first (wide, keyboard-complete, printable), no push notifications/streaks, facts never ranks.
- **Data shown:** `getStudentHome()` (`GET /student/home`), `getSession()`, `getMyPrints()`; next class, today counts, attention items, progress arrows, bag list, print jobs. `SessionSafety` shows idle countdown; `PrintButton` requests paper.
- **Actions:** Toggle a task (`toggleTask` → `POST /student/tasks/:id/toggle`), request a print (`POST /student/print` via `PrintButton`), print the day (`window.print()` with print CSS). Calm empty/error states.
- **Live vs demo:** Live `studentApi.ts`.
- **Data generated:** `student.study_task` toggles, `student_print_jobs`.

### `/student/learning` — `StudentLearning` (`app/src/screens/StudentLearning.tsx`)
- **Who sees it:** Student (light role).
- **Purpose:** Practice / Assignments / Progress tabs — a tiny MCQ practice with gentle feedback, an assignment drawer with mark-as-done, and per-subject progress with a teacher note.
- **Data shown:** Hardcoded/demo skills, assignments, MCQ questions and progress; calm aesthetic.
- **Actions:** Answer practice questions, mark assignments done, open drawers; device-local.
- **Live vs demo:** Demo/static only.
- **Data generated:** None.

### `/student/portfolio` — `StudentPortfolio` (`app/src/screens/StudentPortfolio.tsx`)
- **Who sees it:** Student (light role).
- **Purpose:** "Proud work" — artifacts chosen with teachers, each with a subject chip and a teacher comment, plus a term reflection; click through for the full view.
- **Data shown:** Static `ARTIFACTS` array (fraction poster, river map, photosynthesis lab, etc.) with teacher comments, dates and glyphs; reflection.
- **Actions:** Open an artifact drawer; no writes.
- **Live vs demo:** Static screen (no service/seed dependency).
- **Data generated:** None.

### `/student/ask` — `StudentAsk` (`app/src/screens/StudentAsk.tsx`)
- **Who sees it:** Student (light role).
- **Purpose:** A simple helper chat — short grounded answers from the student's own records, source chips, and a gentle guard that routes personal topics to a human.
- **Data shown:** Demo student anchors; homework and bus-time canned answers with source chips.
- **Actions:** Ask suggested/free-form questions; local answer composition.
- **Live vs demo:** Demo seed only.
- **Data generated:** None.

---

## Teacher surfaces (TeacherOS)

`TeacherHome`, `teacher/Homework`, `teacher/SubmissionsInbox`, `teacher/MyLeave` all run through `services/teacherFixtures.ts`, which probes the live door and falls back to a typed local fixture while the server lanes build. Fixture mode is never silent — a visible "Demo data" badge/`FixtureTag` is shown. Staff-gated (`/teacher` is in `staffOnly`); `TEACHER_STAFF_ROLES` mirrors the role allowlist.

### `/teacher` — `TeacherHome` (`app/src/screens/TeacherHome.tsx`)
- **Who sees it:** Staff in the teacher lane; the teacher's default landing.
- **Purpose:** The Teacher Command Center — zero clicks to understand the day: NOW (current period/room/subject/time left/attendance state), NEXT commitments, NEEDS ranked actionable cards, AT A GLANCE, "What should I do next", and EOD/weekly briefs.
- **Data shown:** `getTeacherHome()` + `getTeacherBrief('eod'|'week')` via `teacherFixtures`; each card zone exercises the 12-state contract (`CardStates`, `StateChip`, `StateNotice`); visible fixture badge.
- **Actions:** Start/end lesson, take attendance, Ask AI, dismiss the brief; suggestions only, never auto-act.
- **Live vs demo:** Live-probe with typed fixture fallback; honest state notices.
- **Data generated:** None directly (navigation/action launch).

### `/teacher/homework` — `teacher/Homework` (`app/src/screens/teacher/Homework.tsx`)
- **Who sees it:** Staff in the teacher lane.
- **Purpose:** P6 — the 20-second assignment: class/subject prefilled, four visible fields, one Enter to publish. Submissions auto-publish to the class + guardian digest at 17:00.
- **Data shown:** `listHomework()`/`listSubmissions()`/`teacherContext()` via fixtures; due presets, recent homework list, submission counts.
- **Actions:** Create homework (`createHomework` → `POST /plugins/teacher.classroom/homework` when live), filter by class, open submissions.
- **Live vs demo:** Both — live probe with fixture fallback + `FixtureTag`.
- **Data generated:** `teacher.classroom` homework record + auto-published digests.

### `/teacher/submissions` — `SubmissionsInbox` (`app/src/screens/teacher/SubmissionsInbox.tsx`)
- **Who sees it:** Staff in the teacher lane.
- **Purpose:** P6 — the Gmail-style review desk. Tabs All / Pending / Reviewed / Late / Missing; bulk review; per-item drawer (grade/feedback/request resubmission); filters by class, student, homework.
- **Data shown:** `listSubmissions()`/`listHomework()`/`teacherContext()`; submission rows with state counts; empty states explain that auto-reminders already chased.
- **Actions:** Review a submission (`reviewSubmission` → `POST /plugins/teacher.classroom/submissions/:id/review`), bulk review, request resubmission.
- **Live vs demo:** Both — live probe with fixture fallback + `FixtureTag`.
- **Data generated:** `teacher.submissions` review record + audit.

### `/teacher/leave` — `teacher/MyLeave` (`app/src/screens/teacher/MyLeave.tsx`)
- **Who sees it:** Staff in the teacher lane. (T508: screen existed unrouted; now both doors are live.)
- **Purpose:** P8 — teacher self-leave. Flow: apply → policy validation → coordinator approval → auto substitution → handover packet. Balances stay visible.
- **Data shown:** `listMyLeave()` → requests + balances; status timeline (requested/approved/rejected), handover packet after approval; leave kinds (casual/sick/earned/duty).
- **Actions:** Apply (`createLeave` → `POST /teacher/leave`) with kind/dates/reason; view balances/handover.
- **Live vs demo:** Both — live probe (`isFlowDoorLive`) with fixture fallback; `POST /teacher/leave` and `GET /teacher/leave/mine` are the doors.
- **Data generated:** `teacher_leave` request + approval/substitution chain + audit.

---

## StudentOS staff desks

### `/print-queue` — `student/PrintQueue` (`app/src/screens/student/PrintQueue.tsx`)
- **Who sees it:** Staff roles (`STAFF_ROLES` = teacher/coordinator/principal/owner/itadmin). staffOnly.
- **Purpose:** The office desk behind the student Print Center. Requests students queue from school computers land here; staff print them, then mark them done. Every print request is recorded.
- **Data shown:** Direct fetch on `LIVE_BASE` → `GET /student/print/queue` (queued jobs with kind/student/requested time); stats; DataTable; calm degradation if the door is mid-build.
- **Actions:** Mark a job done (`POST /student/print/:id/done`); refresh.
- **Live vs demo:** Live direct fetch; failures degrade calmly via `friendly()`.
- **Data generated:** `student_print_jobs` status change + audit.

### `/wellbeing-queue` — `student/WellbeingQueue` (`app/src/screens/student/WellbeingQueue.tsx`)
- **Who sees it:** Authorized staff — counselor (nav "Wellbeing queue") and the office/coordinator/principal set. staffOnly.
- **Purpose:** The STAFF read side of student wellbeing requests: who asked, what category, what they wrote, when, and where it stands. No reply/engage features — wellbeing is handled by people, not an inbox.
- **Data shown:** Direct fetch `GET /student/wellbeing` (tolerant v0 shapes) with category/urgency/status; tabs and stats. Degrades calmly to the contract-based empty state if the list door 404s/403s or is mid-build. Student identity handled by the server.
- **Actions:** Review/route via the underlying `teacher.support` concern flow (screen is read-oriented); refresh.
- **Live vs demo:** Live direct fetch; never broken, always honest.
- **Data generated:** None directly (routing handled upstream in `teacher.support`).

### `/noticeboard` — `student/Noticeboard` (`app/src/screens/student/Noticeboard.tsx`)
- **Who sees it:** Staff (`STAFF_ROLES` = teacher/coordinator/principal/owner/itadmin). staffOnly.
- **Purpose:** One print-ready weekly sheet — the class noticeboard is how a whole class sees the week without any phone. Staff preview the physical sheet, print it, pin it.
- **Data shown:** `getNoticeboard()` → `GET /student/noticeboard` returning `{ student, blocks:[{title, lines[]}] }` (Homework due this week / Results published / Announcements & events / Printed by); paper preview keeps light theme.
- **Actions:** Regenerate (re-pull the week), Print for the noticeboard (`window.print()`; print CSS hides app chrome).
- **Live vs demo:** Live (`studentApi.ts`); T506 rewired to the real shape; server errors surface verbatim.
- **Data generated:** None (read/print).

---

## Coordinator surfaces (CoordinatorOS)

All `/coord/*` screens share `screens/coord/shared.tsx`: the server authority set `COORD_AUTHORITY = ['coordinator', 'principal']`, a `useCoordData` async hook, and shared `CoordDenied`/`CoordBanner`/`CoordPrivacyNote`. Non-authorized roles get the "Coordinator desk only" empty state. Route is staffOnly via `/coord`.

### `/coord/home` — `CoordHome` (`app/src/screens/coord/CoordHome.tsx`)
- **Who sees it:** Coordinator + principal.
- **Purpose:** The coordinator command center for TODAY — who is off, uncovered periods, what needs a decision, curriculum pace, staff load fairness, what is escalated; every card deep-links to detail. Ask box is deterministic copilot-lite v0.
- **Data shown:** `getCoordHome()` (`GET /coord/home`): `staffing_today[]` (present/on_leave/absent, periods_affected), `substitution_gaps[]`, `pending_approvals[]`, `curriculum_delays[]`, `open_issues[]`, `grid_note`.
- **Actions:** Deep-link to each desk; Ask (`copilotLite(question)` → `POST /coord/copilot-lite`, deterministic, sources shown, budget cap).
- **Live vs demo:** Live `coordApi.ts`; denied state for others.
- **Data generated:** None from the home view (Ask is read-only).

### `/coord/substitutions` — `SubstitutionReview` (`app/src/screens/coord/SubstitutionReview.tsx`)
- **Who sees it:** Coordinator + principal.
- **Purpose:** Review substitution proposals from the coordinator-owned kernel approvals queue; cover protects the class, not a favour ledger. Server law mirrored: coordinator-owned, the proposer can never approve their own proposal (SoD), every decision audited.
- **Data shown:** `getCoordHome()` filtered to substitution-kind pending approvals; workload-impact line (overload risk).
- **Actions:** Approve/reject via `decideSubstitution(actionId, decision, note)` → `POST /coord/substitution/decide`.
- **Live vs demo:** Live.
- **Data generated:** Substitution decision/action + audit (SoD enforced server-side).

### `/coord/workload` — `WorkloadBoard` (`app/src/screens/coord/WorkloadBoard.tsx`)
- **Who sees it:** Coordinator + principal.
- **Purpose:** Per-teacher AGGREGATES for fairness; never a score or ranking. Default order alphabetical; the only visual signal is a calm amber "carrying extra load" flag at the server's monthly threshold.
- **Data shown:** `getTeacherWorkload()` (`GET /coord/teacher-workload`): periods_week, substitutions_month, invigilation, duties, grading_est, `overload` flag, threshold basis; tabs (all / extra).
- **Actions:** Filter by tab; no writes (the duty allocation door is not exposed on this screen).
- **Live vs demo:** Live.
- **Data generated:** None.

### `/coord/curriculum` — `CurriculumMonitor` (`app/src/screens/coord/CurriculumMonitor.tsx`)
- **Who sees it:** Coordinator + principal.
- **Purpose:** Per class×subject coverage — covered vs expected progress bars, plain-language weeks-behind chips, revision-need flags, and a printable monitoring sheet. A planning aid, never a judgement on a teacher.
- **Data shown:** `getCurriculumMonitor()` (`GET /coord/curriculum-monitor`): pace (`days_elapsed/total`, term weeks, expected_pct), rows (topics, covered_pct, expected_pct, weeks_behind, revision_needed), `available`/`note`.
- **Actions:** Filter; print the sheet (`window.print()`).
- **Live vs demo:** Live.
- **Data generated:** None.

### `/coord/escalations` — `EscalationsQueue` (`app/src/screens/coord/EscalationsQueue.tsx`)
- **Who sees it:** Coordinator + principal.
- **Purpose:** Parent/student escalations landing on the coordinator desk — family requests owned by the coordinator plus teacher concerns routed here; status timelines from append-only events. Student identity appears only where the coordinator is the routed authority (items without identity render anonymised on purpose).
- **Data shown:** `getEscalations()` (`GET /coord/escalations`): source, kind, category, title, status, urgency, student (tiered), SLA, routed_at, timeline.
- **Actions:** Review, resolve/hand off with a note (handover tells the next desk what was already tried); no silent writes.
- **Live vs demo:** Live.
- **Data generated:** Escalation status/routing updates + audit.

### `/coord/approvals` — `ApprovalCenter` (`app/src/screens/coord/ApprovalCenter.tsx`)
- **Who sees it:** Coordinator + principal.
- **Purpose:** The coordinator's kernel approvals queue — every open kernel action owned by the coordinator role. Substitution-kind actions go through the coord decide door; everything else through the generic kernel decide.
- **Data shown:** `getCoordHome()` → `pending_approvals[]` with code/kind/title/age.
- **Actions:** Decide with an optional note: substitution-kind → `decideSubstitution` (`POST /coord/substitution/decide`); other → `decideGenericAction` (`POST /actions/:id/decide`). Non-coordinator kernel work links to the shared Action Center (not duplicated).
- **Live vs demo:** Live.
- **Data generated:** Action decisions + execution + audit.

---

## Demo & live proof surfaces (demo build only)

These routes are registered only when `VITE_DEMO_MODE === '1'`; a production build tree-shakes them out and falls through to `NotFound`. `/live` is additionally staffOnly.

### `/demo` — `Demo` (`app/src/screens/Demo.tsx`)
- **Who sees it:** Staff in a demo build.
- **Purpose:** The product demo launcher — three loops (Confidence / Control / Trust), one guided path, one operating system.
- **Data shown:** Static loop cards (migrate my school / run my day / resolve a parent issue) with step lists and CTAs from `demo/loops.GUIDED_PATH`.
- **Actions:** Navigate to `/migration`, `/demo/day`, `/demo/parent`.
- **Live vs demo:** Demo static.
- **Data generated:** None.

### `/demo/day` — `DemoDay` (`app/src/screens/DemoDay.tsx`)
- **Who sees it:** Staff in a demo build.
- **Purpose:** Golden Loop 2 "Run My Day": simulate a school morning → event spine → briefing → ask why → approve → watch one action propagate → loop closed.
- **Data shown:** `useScriptedDay(mode)` timelines for normal/busy/disruption/exam days; event timeline, action chain, AI trace, suggested actions, approval state machine.
- **Actions:** Choose a day mode, run the simulation, ask why, edit/approve the guardian message (queued→sent→delivered→closed); dispatch local events/audit with actor/role.
- **Live vs demo:** Demo scripted.
- **Data generated:** Local demo events/audit; no backend.

### `/demo/parent` — `DemoParent` (`app/src/screens/DemoParent.tsx`)
- **Who sees it:** Staff in a demo build.
- **Purpose:** Golden Loop 3 "Resolve a parent issue": parent WhatsApp → verify before disclose → deterministic answer → self-serve payment → receipt → reconciliation → installment-plan case → finance approval → resolution → "why closed?" → audit.
- **Data shown:** Eight-phase flow (`inbound`…`resolved`), parent fee constants (`PARENT_FEE`), payment lifecycle steps, event timeline, action chain, verify rows, orchestration drawer.
- **Actions:** Step the phase machine, verify, pay, request/approve a plan, close the loop; dispatch local audit entries.
- **Live vs demo:** Demo scripted.
- **Data generated:** Local demo audit; no backend.

### `/demo/summary` — `DemoSummary` (`app/src/screens/DemoSummary.tsx`)
- **Who sees it:** Staff in a demo build.
- **Purpose:** The final "School Running" moment — every number derived from the live mock domain state, not hardcoded, followed by the closing credo.
- **Data shown:** `useStore().domain` counts (events, actions done, messages, resolved cases/work orders) plus `followChains` tabs: Follow the event / money / person / problem; section labels.
- **Actions:** Switch follow-chain tabs, navigate.
- **Live vs demo:** Demo store-derived.
- **Data generated:** None.

### `/live` — `LiveMode` (`app/src/screens/LiveMode.tsx`)
- **Who sees it:** Staff (demo build only; `/live` is staffOnly).
- **Purpose:** The real-API proof surface — a single screen that exercises the frontend's data contracts against the actual backend: live login, students, attendance marking with policy notices, actions with approvals, audit.
- **Data shown:** `apiLogin`, `apiStudents`, `apiAttendance`, `apiActions`, `apiAudit` results; a stage rail (login → ready), event timeline, verify rows, actor/role key-values.
- **Actions:** Log in as a seeded account (`DEMO_ACCOUNTS`/`DEMO_PASSWORD`), mark attendance (`apiMarkAttendance`), decide actions (`apiDecideAction`), reload audit.
- **Live vs demo:** Live only (`liveApi.ts`).
- **Data generated:** Real `attendance`/`actions`/audit rows in the backend.

---

## Fallback

### `*` — `NotFound` (`app/src/screens/NotFound.tsx`)
- **Who sees it:** Any signed-in user on an unknown path (the catch-all route, wrapped in the `S` guard/frame).
- **Purpose:** Friendly dead end that routes home by role and offers search.
- **Data shown:** Static icon/copy; computes `homeByRole` (`/parent/family` for parent, `/student/home2` for student, `/today` else) and a matching label. T509: light roles are sent to their LIVE homes, never back into demo surfaces.
- **Actions:** "Search" button announces the command palette (`schoolos:open-palette`) and navigates to `/today`; "Go to …" home button.
- **Live vs demo:** No data door.
- **Data generated:** None.

---

## Unrouted / orphan screens and shared helpers (not in `App.tsx`)

These are real screen files or lane helpers that exist but have **no route** in the current router. Documented for completeness; none is reachable by URL today.

- `app/src/screens/Library.tsx` — `Library`. The proof plugin (class A: record plugin) demo: hardcoded books/loans, returns/overdue, event emission. **Unrouted** — `/library` now renders the live `LibraryLive` behind `KernelGate plugin="library"`. Pure demo; local store dispatch only.
- `app/src/screens/Reports.tsx` — `Reports`. Wave-4 BI surfaces reading the `ops.bi` read-model doors (`apiBiAttendance`, `apiBiAging`, `apiBiFunnel`) with door-labelled charts and honest empty states. **Unrouted.** Live doors when reachable; demo labelled otherwise.
- `app/src/screens/teacher/CurriculumProgress.tsx` — P3/A1 curriculum coverage (tick topics, `POST /curriculum/progress`). Part of the teacher lane; **no route registered**.
- `app/src/screens/teacher/DutyWorkload.tsx` — P8 duties + personal workload (`GET /duty/roster`, `GET /workload/mine`), fairness-framed, no rankings. **Unrouted.**
- `app/src/screens/teacher/ExamMarks.tsx` — Wave-3 exam depth (`exams.assessment` plugin: exams list, bulk marks ≤300/batch, publish + SoD publish/execute, board policy). **Unrouted.**
- `app/src/screens/teacher/MasteryMap.tsx` — P5 mastery & growth (A3 decay); one-student and whole-class views, evidence drawers, no score rankings. **Unrouted.**
- `app/src/screens/teacher/ProgressStory.tsx` — P5 chronological per-student narrative from evidence. **Unrouted.**
- `app/src/screens/teacher/InsightsShared.tsx` — shared insights-lane pieces (`A3Evidence`, `EvidenceList`/`EvidenceDrawer`, `DecayNote`, `InsightsRoleGate`, `InsightsSkeleton`, `FilterRow`, `ClassPicker`, `FixtureTag`). Helper, not a screen.
- `app/src/screens/teacher/teacherKit.tsx` — TU-2 shared kit (async spine, `AsyncGate`, `DeniedState`, `FixtureTag`, `TEACHER_STAFF_ROLES`, `onEnter`, `Field`, `dueState`). Helper.
- `app/src/screens/coord/shared.tsx` — CU-1 coordinator access gate/data hook/banner primitives. Helper.
- `app/src/screens/account/MfaSection.tsx` — MFA setup section embedded by `Settings`. Helper/section.
- `app/src/screens/account/tenantSwitch.ts` — `listTenants`/`switchTenant`/`PickSchool` helper used by `Login` and the Shell account menu. Helper.

---

## Counts

- **Routed screens documented with route headings:** 89 (`/login`, `/onboard`, `/account/password`, 4 daily-command, 3 people/learning/ops, 6 fees/admissions/visitors/transport/documents, 15 maintenance, `/reception`, `/migration`, 13 kernel/platform/intelligence/governance, 9 parent, 5 student, 4 teacher, 3 student-staff desks, 6 coord, 5 demo/live, 1 `NotFound`). `AdmissionsHost` is documented as both possible components (`Admissions` and `FunnelBoard`); `VisitorsHost` resolves to `VisitorsBoard`.
- **Distinct routed screen components:** 90 (counting `Admissions` and `FunnelBoard` separately; `ChangePassword`, `PluginSettings` each register on two paths).
- **Unrouted screen files documented:** 7 (`Library`, `Reports`, `CurriculumProgress`, `DutyWorkload`, `ExamMarks`, `MasteryMap`, `ProgressStory`) plus helpers.
- **Public (no session):** `Login`, `Onboard`.
- **Light-role surfaces:** all `/parent/*` and `/student/*`.
- **Forced/voluntary account:** `/account/password`.
- **Demo-build-only routes:** `/demo`, `/demo/day`, `/demo/parent`, `/demo/summary`, `/live`.

---

# Catalogue C — 18 end-to-end scenarios


Every claim below is grounded in the repository at `/home/cassandra/schoolOS` and cites `file:line`.
Format per scenario: **Actors** → **Chain** (screen → door → logic → tables → events/audit → worker → visibility) → **Honest vs broken**.

Conventions used throughout:

- **The tenancy substrate** every authenticated door runs under: `authenticate` → live user row → role gate → `withUser(tenant, role)` sets transaction-local `schoolos.tenant_id` / `schoolos.role` and `SET LOCAL ROLE schoolos_app` (`server/src/db.js:115-131`; `server/src/app.js:129-216`). `sql` below is shorthand for "inside that same transaction".
- **Two-row atomic spine**: `emitEvent` always writes an `app.events` row AND an `app.outbox` row in one statement pair (`server/src/audit.js:37-59`); `auditLog` writes the hash-chained ledger row through `app.audit_append` (`server/src/audit.js:22-34`).
- **Owner path** = `sysq()` (RLS-bypassed pool, `server/src/db.js:90`) — used only for auth bootstrap, registry, maintenance, vault tables.

---

## 1. New school onboarding (self-signup) + owner first login

**Actors:** a school owner with no account; the platform operator (kill-switch); the owner after auto-login.

**Chain:**

- Public signup screen `/onboard` (`app/src/screens/Onboard.tsx:9,30`) → `apiSignup` (`app/src/services/onboardingApi.ts:20`) → **`POST /onboard/signup`** (`server/src/onboarding.js:52`).
- Kernel logic: kill-switch check (`SELF_SIGNUP_ENABLED`, `onboarding.js:53-58`); field validation + section grid ≤15 grades × ≤8 sections (`:64-73`); slug derivation with 50-attempt uniqueness (`slugify` `:32-37`, `uniqueSlug` `:39-48`).
- **ONE owner-path transaction** (`pool.connect()` + `BEGIN`, `onboarding.js:85-111`):
  - `INSERT INTO app.tenants (slug,name,config,onboarded_at,onboarded_via) … 'self-signup'` (`:88-91`).
  - `INSERT INTO app.users (… role='owner' …)` — the ONE sanctioned runtime owner creation (`:92-95`); `people.admin` structurally refuses owner (`server/src/plugins/people.admin/index.js:94-106`).
  - `ensurePluginCatalog(client, t.id)` seeds the full catalog as `registered` (`:100-101`; catalog in `server/src/plugin-catalog.js`, DEFAULT_ON set).
  - hash-chained audit row `Tenant onboarded (self-signup)` (`:102-106`) + event `platform.tenant.onboarded.v1` (`:107-110`).
  - `COMMIT`, then mint an auto-login JWT with `jti` + `ep` (`:111-117`).
- **First login:** the auto-login token is used directly on the boot path; a return visit uses the normal flow `POST /auth/login` (`server/src/app.js:244`) or `POST /auth/renew` silent cookie renewal (`app.js:341`; probed by `app/src/App.tsx:333-341`).
- Owner-only profile patch `POST /onboard/school` (`onboarding.js:134`) audits `Updated school profile` and emits `platform.school.updated.v1` (`:167-174`).
- Setup checklist `GET /onboard/status` (`onboarding.js:180`) reads live counts and marks the "switch on modules" item done only when `plugins_enabled > DEFAULT_ON.size` (`:193-200`; DEFAULT_ON export use documented at `:196-199`).

**Tables written:** `app.tenants` (`server/migrations/001_init.sql:8`; onboarded columns added `053_onboarding.sql`), `app.users`, `app.plugins` (catalog rows), `app.audit_log` (`001_init.sql:281`), `app.events`/`app.outbox` (`001_init.sql:240,302`).

**Events:** `platform.tenant.onboarded.v1`, `platform.school.updated.v1`.
**Audit:** `Tenant onboarded (self-signup)` (risk medium), `Updated school profile` (risk low).

**Workers:** `outbox-worker` relays both platform events to its durable log sink (`server/scripts/outbox-worker.js:65-75,77-124`). No comms row is created — there is no welcome email path.

**Who else sees it:** platform operator via `/metrics` plugin/outbox gauges (`server/src/app.js:1360`); any authenticated member of the new tenant via `/plugins` (catalog appears registered).

**Honest vs broken:**
- No email verification exists (no mail sender in the signup path) — mitigated by the 3/min rate limit (`onboarding.js:52`), the production kill-switch (`:56-58`), and the fact that a signup creates an EMPTY tenant. Documented at `onboarding.js:14-16`.
- The auto-login token now stamps `ep` like every issue path (S0 fix C1) — before the fix a future epoch bump would have locked fresh signups out (`:112-114`).
- Renaming the school does not change the slug (stable identifier by design).

---

## 2. Staff provisioning by owner (people.admin) → temporary password → force_change handover

**Actors:** owner/IT-admin (provisioner); the new teacher/staff member (first sign-in).

**Chain:**

- Provisioner uses the People console `/people-admin` (`app/src/screens/PeopleAdmin.tsx:23-25`) → `adminApi.createUser` (`app/src/services/adminApi.ts:28`) → **`POST /plugins/people.admin/users`** (`server/src/plugins/people.admin/index.js:77`).
- Kernel/plugin logic: role allowlist derived from `auth.js ROLES` minus owner (`people.admin:63`); role `owner` refused + high-risk audited (`:94-106`); phone normalised to E.164 (`:86-90`); temp password CSPRNG generated (`tempPassword`, `:68-73`) when no password supplied; `SAVEPOINT provision_user` maps `23505` to a friendly 409 (`:121-134`).
- Write: `INSERT INTO app.users (… password_hash, phone, force_change)` with `force_change = (temp ? true : false)` (`:125-128`); optional `family.child_link` row for a parent (`:136-142`).
- Event `people.user.created` (`:143-145`); audit `User provisioned` (risk medium) (`:146-149`); temp password returned ONCE in the response (`:150-154`).
- **Handover:** the user signs in with the temp password at `POST /auth/login` (`app.js:244`). `issueSession` stamps `mustChange` from the DB row (`app.js:360-367`), login answers **403 `{mustChange:true, token}`** (`app.js:325-331`).
- The restricted session may only reach `/me/password`, `/me`, `/auth/logout`; every other door refuses with 403 (`app.js:186-191`).
- Frontend routes every path to the password screen (`app/src/App.tsx:369-375,396-399`).
- User sets a real password at **`POST /me/password`** (`app.js:765`): verifies current, bumps `session_epoch`, clears `force_change` and audits atomically (`:774-781`), re-issues a full token.

**Tables written:** `app.users` (`force_change` column from `046_enrollment_history.sql:46`), `family.child_link`, `app.audit_log`, `app.events`/`app.outbox`.

**Events:** `people.user.created`, `people.user.password_reset` (reset door), `people.user.suspended`/`activited` (paired doors).
**Audit:** `User provisioned`, `Attempted owner provisioning (refused)` (risk high), `Password changed`, `Set a new password` restricted refusals.

**Workers:** `outbox-worker` relays `people.user.created`; no comms is queued — the temp password is delivered by the human provisioner, never by the system.

**Who else sees it:** owner/itadmin in the People console via `GET /plugins/people.admin/users` (`people.admin:159`); the provisioned user via restricted session; suspension lands at the next request because `authenticate` re-reads the live row (`app.js:173-174`).

**Honest vs broken:**
- Owner accounts cannot be created, suspended or password-reset from ANY door (`people.admin:180,202`).
- The temp password is shown once and never stored plaintext (only its scrypt hash).
- Suspension kills the session at the next request, but there is no per-account token revocation registry — an outstanding token dies at the epoch bump only on password change, otherwise at the live-row check (`app.js:173`).

---

## 3. Student admission: admissions lead → followup → offer → approved action → student row → enrollment_history

**Actors:** admissions/office staff (capture + funnel moves); principal (approver); the lead's guardian.

**Chain:**

- Funnel board `/admissions` → `FunnelBoard.tsx` (`app/src/screens/FunnelBoard.tsx:75,87,99,127`) → `apiFunnelLeads` / `apiFunnelMoveStage` (`app/src/services/liveApi.ts:295,296`).
- **Capture enquiry:** **`POST /plugins/admissions.funnel/leads`** (`server/src/plugins/admissions.funnel/index.js:62`): session-window + duplicate-guard (`:74-98`), race backstop via partial unique index mapped to 409 (`:99-120`), `INSERT INTO plugin_admissions.lead` + `stage_history` (`:104-123`); event `admission.enquiry.captured` + audit `admission enquiry captured` (`:124-130`).
- **Follow-up queue:** `GET /admissions/followups` (`server/src/routes.js:1762`) — deterministic ranking `score = days-in-stage × stage weight`, stuck >7d first, no model (`:1756-1788`); PII masked for non-full-PII roles (`:1763,1777-1778`). Screen `app/src/screens/Admissions.tsx` via `apiAdmissionFollowups` (`liveApi.ts:189`).
- **Stage moves:** **`POST /plugins/admissions.funnel/leads/:id/stage`** (`admissions.funnel:161`): server-enforced lattice (`NEXT`, `:15-22`), terminal stages refuse (`:168`), `stage_history` append (`:197-198`), event `admission.stage.transitioned` (`:199-201`).
- **Offer accepted → core write request:** moving `offer → enrolled` raises a KERNEL approval action with a per-instance code `students.create.<leadId>` (`admissions.funnel:177-194`), payload carries leadId + guardian; events `admission.offer.accepted` (`:202-206`); the funnel never writes `app.students` directly.
- **Approval:** principal decides at **`POST /actions/:id/decide`** (`server/src/routes.js:1370`) with SoD checks (owning authority, self-approval block, `:1382-1412`).
- **Executor** `executeStudentCreation` (`routes.js:1309`): locks the lead `FOR UPDATE`, requires `stage='enrolled'`, idempotent lookup by `(source='admissions', source_ref=leadId)` (`:1310-1318`), `INSERT app.students` with deterministic admission no + `SAVEPOINT student_insert` fallback (`:1322-1341`), `INSERT app.guardians` from the lead (`:1343-1346`), `INSERT app.enrollment_history` admission row (`:1347-1350`), event `people` student-created (`:1351`), audit `Student created from admissions lead …` (`:1358-1366`).

**Tables written:** `plugin_admissions.lead`, `plugin_admissions.stage_history`, `app.actions`, `app.students`, `app.guardians`, `app.enrollment_history` (`server/migrations/046_enrollment_history.sql:24`), `app.audit_log`, `app.events`/`app.outbox`.

**Events:** `admission.enquiry.captured`, `admission.stage.transitioned`, `admission.offer.accepted`, event `people` "Student created from admissions".
**Audit:** `admission enquiry captured`, `admission stage transitioned`, `Student created from admissions lead …` (policyRef Admissions §3).

**Workers:** `outbox-worker` relays all admission events; `workflow-worker` can match rules on those topics (`server/scripts/workflow-worker.js:30`); no auto-guardian-account creation.

**Who else sees it:** the funnel board (staff); the roster `GET /students` (`routes.js:454`); parents gain access only if a `family.child_link` row exists (seeded/administered, not auto-created here).

**Honest vs broken:**
- Duplicate conversion is blocked three ways: the decide door refuses a second decision (`routes.js:1381`), the action code is unique per lead, and the `source_ref` lookup returns the existing student (`routes.js:1314-1317`).
- Lead PII (guardian name/phone) is masked for roles outside `owner/principal/itadmin/coordinator` (`admissions.funnel:56,137,153-154`).
- `family.child_link` is NOT auto-created at admission; a parent self-serve claim flow does not exist.

---

## 4. Attendance: teacher marks own class; parent/student views; absence notice

**Actors:** teacher (register); parent (own child); student (refused on school-wide register).

**Chain:**

- Attendance screen `/attendance` (`app/src/screens/Attendance.tsx:15`) → `apiMarkAttendance` (`liveApi.ts:152`) → **`POST /attendance/mark`** (`server/src/routes.js:564`).
- Validation: `date` defaults to IST today (`routes.js:565`, `IST_TODAY` defined `:1582`), `marks[]` shape + ≤300 rows (`:566-569`).
- **Class ownership (PRD-2):** office roles bypass; a teacher must hold an active `app.class_assignments` row or gets honest 403 (`routes.js:581-592`); `assertTeacherOwnsClasses` derives the class of record from the STUDENT rows server-side, never the payload, and reports invisible rows separately (`routes.js:86-104`).
- Write: bulk upsert `INSERT … ON CONFLICT (tenant_id, student_id, school_date) DO UPDATE` (`routes.js:600-608`).
- **Audit-per-change:** one row per student whose status actually changed, with from→to (`routes.js:614-626`) plus a summary row (`:644`).
- **Absence notices:** for each absent student, primary guardian phone read and `INSERT app.communications ('whatsapp','ABSENCE_NOTICE',… status default queued)` (`routes.js:628-643`); event `attendance.absences` (`:631-633`).
- Class assignment admin: `POST /class-assignments` retires the prior holder and audits the handover (`routes.js:667-708`), soft-retire via `DELETE /class-assignments/:id` (`:710-725`).

**Tables written:** `app.attendance`, `app.communications`, `app.class_assignments`, `app.audit_log`, `app.events`/`app.outbox`.

**Events:** `attendance.absences` (payload date + absentCount), event type `attendance`.
**Audit:** per-student `Attendance for <id> on <date>: <from> → <to>` / `recorded <status>`, plus `Marked attendance` with authority provenance (`principal office` vs `class owner`).

**Workers:** `comms-dispatcher` claims the queued ABSENCE_NOTICE rows and resolves the channel rail (`server/scripts/comms-dispatcher.js:281-296,185-198`); in a production tenant with only a sandbox carrier the row becomes `failed` with a reason rather than `sent` (`:249-257`).

**Who else sees it:** parents via **`GET /attendance`** scoped by `family.child_link` (`routes.js:542-551`, returns `scoped:'own_children'`); staff see the whole roster (`:553-560`). Frontend `Attendance.tsx`; parent sees it inside `/parent/family` (`app/src/screens/parent/FamilyHome.tsx`, `app/src/services/parentApi.ts:162`). Students are refused the school-wide register (`routes.js:536-538`).

**Honest vs broken:**
- Re-marking is an upsert (unique tenant+student+date), and the ledger records each real change, so corrections are additive facts, not silent overwrites.
- The absence notice is QUEUED, not sent; actual delivery depends on the SMS/WhatsApp rail settings. With no provider the dispatcher log-only drains in sandbox and fails-closed in production (`comms-dispatcher.js:249-257`).
- A notice is never recalled if the mark is later corrected.

---

## 5. Exam lifecycle: create → marks → eligibility (attendance floor) → publish (approval spine) → report snapshot → CBSE pack validation → moderation

**Actors:** exam coordinator (create/publish-request), teacher (marks), principal (approval + moderation decision), parent/student (published reports), CBSE pack.

**Chain:**

- Teacher screen `/teacher` marks desk uses `ExamMarks.tsx` (`app/src/screens/teacher/ExamMarks.tsx:17`); publish via `apiExamPublish`/`apiExamPublishExecute` (`liveApi.ts:209,211`).
- **Create exam:** `POST /plugins/exams.assessment/exams` (`server/src/plugins/exams.assessment/index.js:109`) — weightage must be finite non-negative and sum EXACTLY 100 (`validWeightage`, `:97-108`); audit `exam created (draft)` (`:120-123`).
- **Marks entry:** `POST /plugins/exams.assessment/exams/:id/marks` (`:140`) — exam locked `FOR UPDATE`, published exam refuses (`:152-155`), **eligibility floor**: attendance % computed live, default 75, below floor → 409 (`:158-171`), upsert `plugin_exams.mark`, event `exam.marks.updated.v1`, audit `marks entered` (risk medium) (`:173-186`). Bulk variant per-row SAVEPOINT with failure report (`:376-454`).
- **Publish request:** `POST /plugins/exams.assessment/exams/:id/publish` (`:191`) — re-checks weightage=100, raises kernel action `exams.publish.<examId>` with `kind='approval'` (`:205-213`); nothing is assembled yet.
- **Approval:** `POST /actions/:id/decide` (`routes.js:1370`).
- **Execute:** `POST /plugins/exams.assessment/exams/:id/publish/execute` (`exams.assessment:223`) — verifies the action is decided, blocks proposer self-approval (`:230-235`), deterministic `assembleReports` (pure function of marks+weightage+scale, `:67-82`), sha256 digest (`:246`), inserts `plugin_exams.report` snapshots + freezes the exam (`:247-256`), event `exam.published.v1`, audit `exam published (kernel-approved)` (risk high) (`:257-263`).
- **CBSE pack validation:** `GET /plugins/pack.cbse/validate/exam/:examId` (`server/src/plugins/pack.cbse/index.js:67`) runs rules R1 weightage, R2 scale, R3 marks bounds, R4 floor ≥75, R5 report integrity, R6 board identity (`:36-43,80-125`); on R1 fail it raises `cbse.weightage.<examId>` obligation action + event `cbse.obligation.due.v1` (`:129-147`); digest-audited.
- **OASIS export:** `GET /plugins/pack.cbse/export/oasis/:examId` (`pack.cbse:160`) requires affiliation+year and a published exam, emits CSV with formula neutralisation and content hash (`:175-204`).
- **Moderation:** `POST /plugins/exams.assessment/exams/:id/reports/:studentId/moderate` (`exams.assessment:298`) proposes; `POST /plugins/exams.assessment/moderations/:mid/decide` (`:319`) enforces proposer≠decider (`:329-331`), re-derives grade from pct (`:332-355`); overlay served by the report door (`:276-289`). Recompute verifier detects digest drift (`:501-534`).

**Tables written:** `plugin_exams.exam`, `plugin_exams.mark`, `plugin_exams.report`, `plugin_exams.moderation`, `app.actions`, `app.audit_log`, `app.events`/`app.outbox`.

**Events:** `exam.marks.updated.v1`, `exam.marks.bulk.v1`, `exam.published.v1`, `cbse.obligation.due.v1`.
**Audit:** `exam created (draft)`, `marks entered`, `publication requested`, `exam published (kernel-approved)`, `assessment validated (CBSE pack)`, `moderation approved/rejected`.

**Workers:** `outbox-worker` relays; no worker assembles reports (assembly is synchronous on execute). `cbse.obligation.due.v1` can be matched by `workflow-worker`.

**Who else sees it:** parents see only PUBLISHED reports, growth-framed, via `GET /parent/child/:id/exams` (`server/src/plugins/family.view/index.js:186`); staff raw reports via the plugin read door (`exams.assessment:269`). Board-policy read/write at kernel `GET/POST /exams/:id/board-policy` (`routes.js:1727,1740`).

**Honest vs broken:**
- Approval-before-publish is real: execute refuses an open/dismissed action and a proposer-decided action (`exams.assessment:230-235`).
- The per-exam board policy kernel door `POST /exams/:id/board-policy` is stored but NOT consumed — the reply says "validation only — no downstream behavior reads this yet" (`routes.js:1735-1736`). The consumed policy is the plugin-settings `board_policy` (`exams.assessment:243`).
- Marks are frozen only at publish; before that, edits are allowed and each is audited.

---

## 6. Fees: plan → obligation → parent pay → gateway webhook → finance confirm → receipt → dunning → refund

**Actors:** finance (plan/create/generate/confirm/refund), parent (initiate), gateway (webhook), dispatcher (delivery).

**Chain:**

- **Plan template:** `app/src/screens/finance/FeePlans.tsx` → `apiCreateFeePlan`/`apiGenerateFeePlan` (`liveApi.ts:176,178`). `POST /fee-plans` (`server/src/routes.js:816`) validates terms (`validateTerms`, `:792-801`), inserts `app.fee_plan_templates` (`001_init.sql` companion `059_fee_plan_templates.sql:8`), audits (`routes.js:834`).
- **Generate obligations:** `POST /fee-plans/:id/generate` (`routes.js:843`) — one INSERT…SELECT over active students × terms with `ON CONFLICT (tenant_id, student_id, term, label) DO NOTHING` (`:848-855`), never overwrites paid rows; audit `Generated fee obligations`, event `fees` (`:858-859`).
- **Parent initiates payment:** `POST /fees/payments` (`routes.js:936`) — obligation `FOR UPDATE`, owner check for parents via `family.child_link` (`:954-963`), due>0 else 409, one-open-payment guard (`:964-967`), idempotency key support (`:943-952,975-979`), `INSERT app.payments status='initiated'`, event `payment.initiated`, audit `Initiated payment` (`:968-982`).
- **Gateway link/order:** `POST /plugins/payments.upi/links` builds `upi://pay?...` (`server/src/plugins/payments.upi/index.js:23,43`); `POST /plugins/payments.razorpay/orders` creates a real gateway order in three phases (lock → REST outside tx → record) (`server/src/plugins/payments.razorpay/index.js:93-183`), event `razorpay.order.created`.
- **Webhook (public):** `POST /plugins/payments.upi/webhook` (`payments.upi:55`) and `POST /plugins/payments.razorpay/webhook` (`payments.razorpay:186`): boot-refusal without secret (`upi:16-21`; `razorpay:73-81`), raw-bytes HMAC via install-once parser (`server/src/plugins/_shared/raw-body-parser.js:14-26`), freshness window, replay dedupe on `(tenant_id,event_id)` (`upi:115-124`; `razorpay:278-287`). **Facts only — never settlement.**
- **Finance confirm (the only settlement):** `POST /fees/payments/:id/confirm` (`routes.js:986`) — `FOR UPDATE`, status machine, gateway reference verified against `plugin_razorpay.order_log` (not a regex) (`:1008-1027`), updates payment + obligation `paid_cents`/status (`:1028-1035`), two `fees` events (`:1036-1037`), queues `FEE_RECEIPT` comms (`:1038-1041`), audit `Confirmed payment (…verified…)` or `(manual reconciliation — no gateway evidence)` (`:1042-1046`).
- **Dunning:** `POST /fees/dunning/run` (`routes.js:1606`) + all-tenant cron `scripts/dunning-reminders.js:46` — overdue open/partial, phone only, IST quiet hours, 7-day dedup `dunning:<obligationId>` (`routes.js:1598-1604,1617-1628`), event `fees` dunning.
- **Refund:** `POST /payments/:id/refund` (`routes.js:1496`) — gateway leg first (refused refund leaves ledger untouched, `:1504-1518`), ledger reversal with floor-safety check (`:1524-1535`), event `payment.refunded`, audit risk high (`:1539-1540`).
- **Reconcile:** `POST /payments/reconcile` (`routes.js:1545`) / `scripts/reconcile-payments.js:26` — three discrepancy classes, `reconciliation.discrepancy` warn events.

**Tables written:** `app.fee_plan_templates`, `app.fee_obligations` (`001_init.sql:87`), `app.payments` (`001_init.sql:102`), `app.communications` (`001_init.sql:251`), `plugin_upi.webhook_log`, `plugin_razorpay.order_log`, `app.audit_log`, `app.events`/`app.outbox`.

**Events:** `payment.initiated`, `payment.link.created`, `razorpay.order.created`, `payment.captured`/`payment.failed`, `payment.confirmed`, `payment.refunded`, `reconciliation.discrepancy`, `cbse.obligation.due.v1`-style pattern reused for other obligations.
**Audit:** `Initiated payment`, `Confirmed payment …`, `Refunded payment`, `Ran fee dunning sweep`, `Razorpay order created/failed`, webhook `fact recorded`.

**Workers:** `comms-dispatcher` drains FEE_RECEIPT/FEE_REMINDER (`comms-dispatcher.js:281-296,173-223`); `reconcile-payments.js` daily sweep; `day-worker.js:35-44` tally summary; `outbox-worker` relays.

**Who else sees it:** parents see own-children obligations via `GET /fees/obligations` parent branch (`routes.js:887-903`) and family home; finance/owner/principal see the ledger (allowlist `FEE_LEDGER_ROLES`, `:882`); summary `GET /reports/fees/summary` (`:1796`); accounting read model `GET /plugins/ops.bi/fees/aging` (`ops.bi/index.js:88`).

**Honest vs broken:**
- Double settlement is structurally impossible: one-open-payment partial unique index + confirm `FOR UPDATE` + webhook dedupe.
- The webhook never settles; only finance confirm does. The confirm is honest about whether a gateway vouched for the reference (`routes.js:1042-1046`).
- A payment left `initiated` because no webhook arrived stays pending; the desk must confirm manually.
- Dunning never sends during IST quiet hours (`routes.js:1611-1614`).

---

## 7. Complaint/case: parent/student files → owner/coordinator triage → SLA → status; my-cases

**Actors:** parent/student (filer); staff (triage/status); coordinator (default owner).

**Chain:**

- Parent complaint screen `/parent/complaints` (`app/src/screens/ParentComplaints.tsx:2,28,36`) → `apiCreateCase` (`liveApi.ts:253`) → **`POST /cases`** (`server/src/routes.js:1206`).
- **Field authority (SEC-4):** `origin` is DERIVED from role, never the body (`routes.js:1241`); parent cannot self-assign `owner` or arbitrary `priority`; `critical` is staff-only (`:1231-1233`); `slaHours` bound for reporters is 7 days vs 365 for staff (`:1204-1238`); parent owner forced to `Coordinator` (`:1242`).
- Idempotency-key support with SAVEPOINT retry (`routes.js:1243-1264`); `INSERT app.cases`; event `case`; audit `Opened case` (`:1265-1266`).
- **Parent view:** `GET /my-cases` filters `opened_by = caller` (`routes.js:1193-1200`) → `apiMyCases` (`liveApi.ts:256`).
- **Staff board:** `GET /cases` role-gated and `canReach`-checked (`routes.js:1180-1189`) → `apiCases` (`liveApi.ts:252`); frontend `Cases.tsx` / `CaseDetail.tsx`.
- **Triage/status:** `POST /cases/:id/status` (`routes.js:1271`) with state set `open|triaged|in-progress|resolved|closed`; audit `Case → <to>` + event `case` (`:1280-1281`).
- **Escalations board:** coordinator reads family requests + routed concerns via `GET /coord/escalations` (`server/src/plugins/coord.view/index.js:429`).

**Tables written:** `app.cases`, `app.audit_log`, `app.events`/`app.outbox`.

**Events:** `case` opened / status-changed.
**Audit:** `Opened case` (outcome origin/owner/SLA), `Case → <to>`.

**Workers:** `outbox-worker` relays; `workflow-worker` can match `case` events; no SLA-enforcement worker exists.

**Who else sees it:** staff board (owner/principal/itadmin/coordinator/teacher/finance, plus mask grants) via `Cases.tsx`; the filing parent via `ParentComplaints.tsx`; the SLA `sla_due_at` is visible on both.

**Honest vs broken:**
- The door stays open to families by tested design (`routes.js:1207-1213`), but the FIELDS the caller controls are now derived, closing the self-assignment/priority/SLA holes.
- SLA is a stored deadline, not an enforcing job — nothing escalates a breached case automatically.
- There is no per-case append-only status history table for `app.cases` (the family request center DOES have `family.request_event`; cases only carry the current status).

---

## 8. Safeguarding: concern filed → routing/SoD → wellbeing queue → intervention transitions → safety box

**Actors:** teacher (concern), coordinator (route), counselor/principal (outcome), student (anonymous safety box), safeguarding authority (box reads).

**Chain:**

- Teacher one-tap concern: `/teacher` concern UI (`app/src/services/teacherFixtures.ts:991`) → **`POST /teacher/concern`** (`server/src/plugins/teacher.support/index.js:97`): inserts `teacher.concern` + first `concern_status_event` (append-only) (`:110-119`); safety/critical raises per-instance action `concern.escalate.<id>` with `payload.proposed_by` (`:120-136`); event `concern.filed.v1`, audit risk high for safety (`:137-144`).
- **Routing (SoD):** **`POST /teacher/concern/:id/route`** (`teacher.support:179`) — only `ROUTE_AUTHORITY` (owner/principal/itadmin/coordinator, `:48`); filer cannot route own (`:188`), router cannot route to self (`:189`); inserts a notification to the designee + a `concern.routed.v2` comms receipt (`:201-209`); event `concern.routed.v1`, audit (`:210-217`).
- **Outcome/close:** `POST /teacher/concern/:id/outcome` (`:222`) — only designee or owner/principal/counselor (`:232-233`); appends status event; event `concern.closed.v1`, audit (`:234-248`).
- **Queue visibility:** `GET /teacher/concerns` — oversight tier sees the board, a teacher sees only own/routed (`:150-176`).
- **Interventions:** `POST /interventions` (`:559`), list (`:588`), lifecycle transition state machine + append-only `intervention.plan_event` (`:615-648`); event `intervention.status.changed.v1`.
- **Safety box (anonymous by design):** **`POST /safety/box`** (`:274`) student-only; anonymous is the DEFAULT, stores NO reporter identity and audits as `'anonymous (student)'` (`:280-289,310-313`); serious severity raises `safety.page.<boxId>` to the principal (`:294-306`); event `safety.report.filed.v1`.
- **Box reads:** `GET /safety/box` designated authority only, never teachers (`:320-354`, `BOX_READERS` `:51,56`); weekly summary counts only, never identity (`:357-373`); assign (`:376`), close (`:406`).
- Screen `app/src/screens/student/WellbeingQueue.tsx` (staff queue, `:30,77`); the anonymous submission UI is the student safety box.

**Tables written:** `teacher.concern`, `teacher.concern_status_event`, `safety.box`, `intervention.plan`, `intervention.plan_event`, `app.actions`, `app.notifications`, `app.communications`, `app.audit_log`, `app.events`/`app.outbox`.

**Events:** `concern.filed.v1`, `concern.routed.v1`, `concern.closed.v1`, `safety.report.filed.v1`, `intervention.status.changed.v1`, `doubt.routed.v1`, `ptm.booked.v1`.
**Audit:** `Concern filed (…)`, `Concern routed`, `Concern closed`, `Safety report filed` (actor anonymised), `Safety report assigned/closed`, `Intervention plan → …`.

**Workers:** `outbox-worker` relays; `workflow-worker` can act on `concern.*`/`safety.*` topics; the routed-concern notification is consumed by the designee's `GET /notifications` (`routes.js:1843`).

**Who else sees it:** routing tier + counselor via `GET /teacher/concerns`; safeguarding authority (`owner/principal/itadmin/coordinator/counselor`) via `GET /safety/box`; teachers are refused the box on EVERY door (`teacher.support:320,376`).

**Honest vs broken:**
- Anonymous reports genuinely cannot be unmasked — the row stores a nullable reporter pair and the audit actor is fixed to `'anonymous (student)'` (`:280-289`).
- The box read set was deliberately narrowed so the assignable set equals the reader set — before, a report could be assigned to finance who could then neither read nor close it (`:384-394`).
- The intervention/duty data planes may be absent on older databases and degrade with honest 409s (`coord.view:378-380`).

---

## 9. Transport: route/stop → GPS delay event → approval action → parent notice → pickup OTP at the gate

**Actors:** transport desk / GPS vendor feed (ingest); principal (approve notice); parent (receives notice); gate desk (pickup OTP — see scenario 10).

**Chain:**

- Transport screen `/transport` (`app/src/screens/Transport.tsx`) → `apiTransportEvent` (`liveApi.ts:263`).
- **Two ingest doors:**
  - kernel `POST /transport/events` (`server/src/routes.js:1061`) — route resolved, `INSERT app.transport_events`, riders counted, transport capability enabled check (`:1074-1075`), event budget/breaker (`checkEventBudget`, `:1076-1077`), event `transport.delay` (`:1078-1081`); delay ≥10 raises approval action `act_<id>` with `kind='message'`, `owner_role='principal'` (`:1084-1095`).
  - plugin `POST /plugins/transport.gps/positions` (`server/src/plugins/transport.gps/index.js:17`) — normalises lat/lng/delay, budget+breaker first (`:27-33`), writes `plugin_transport_gps.positions` + `app.transport_events` (`:35-42`), event `gps.position` (`:44-47`), delay ≥10 raises the same approval action + `event_action_link` lineage (`:50-64`).
- **Approval:** `POST /actions/:id/decide` (`routes.js:1370`) with SoD (`:1382-1412`); on approve, `resolveNoticeRecipients` resolves MACHINE-READABLE recipients (studentIds / routeCode), never the human audience label (`routes.js:106-127`); a resolvable audience queues `app.communications status='queued'` (`routes.js:1439-1445`); an unaddressable notice is recorded `unaddressed` and emits a warn event instead of claiming delivery (`:1426-1434`).
- **Parent notice:** queued comms → dispatcher → rail.
- **Pickup OTP at the gate:** transport itself has NO OTP. The pickup OTP lives in `ops.visitors` (see scenario 10): `POST /plugins/ops.visitors/visitors/:id/pickup` mints a code in `plugin_visitors.pickup_otp` and sends via SMS (`server/src/plugins/ops.visitors/index.js:131-251`). The transport roster supplies the guardian phone via `students.bus_route` (`routes.js:119-124`; `ops.visitors:138-140`).

**Tables written:** `app.routes`, `app.route_stops`, `app.transport_events`, `plugin_transport_gps.positions`, `app.actions`, `app.event_action_link`, `app.communications`, `app.audit_log`, `app.events`/`app.outbox`.

**Events:** `transport.delay` / `gps.position`, `visitor.pickup.requested.v1` (cross-ref).
**Audit:** `Transport event recorded (gps_delay)` / `GPS position ingested` (risk low), `Parent notice approved and QUEUED…`, `guardian pickup verified`.

**Workers:** `outbox-worker` relays GPS events; `comms-dispatcher` drains the queued parent notice; `retention-worker` purges GPS positions >30 days (read filtered at `transport.gps:78-89`; purge via `day-worker.js:47-52` → `retention-worker`).

**Who else sees it:** transport/coordinator/principal/owner via `GET /plugins/transport.gps/positions` and `GET /transport/routes` (`routes.js:1052`); parents receive the notice only after approval and only if a real channel is configured.

**Honest vs broken:**
- Delay ≥10 min produces an APPROVAL-REQUIRED draft, never an automatic send.
- A notice whose audience cannot be resolved to phones is recorded UNSENT (`unaddressed`), not `delivered` (`routes.js:1425-1434`) — this was a prior lie (PRD-17).
- GPS positions are API-level (role-gated), not a device protocol; no biometric/RFID integration exists.
- There is no transport-side pickup OTP; that flow belongs to `ops.visitors`.

---

## 10. Visitor/reception: gate pass → check-in → guardian-verified pickup OTP → release

**Actors:** front desk (owner/principal/itadmin/coordinator); visitor; guardian; student.

**Chain:**

- Reception screen `/reception` (`app/src/screens/Reception.tsx`) and `/visitors` (`app/src/screens/VisitorsBoard.tsx:27,91-157`) → `apiVisitorLog/Checkin/Pickup/Verify/Complete/Deny` (`liveApi.ts:309,311,313,319,330,332`).
- **Log expected visitor:** `POST /plugins/ops.visitors/visitors` (`server/src/plugins/ops.visitors/index.js:32`) — badge generated, `INSERT plugin_visitors.visit`, event `visitor.logged.v1`, audit (`:40-52`).
- **Guardian lookup:** `GET /plugins/ops.visitors/guardian-lookup` by id/admission/name with ILIKE escaping, phone tail only (`ops.visitors:83-111`).
- **Check in:** `POST …/visitors/:id/checkin` (`:113`) status `expected → checked_in`, event `visitor.checked_in.v1`, audit.
- **Pickup request:** `POST …/visitors/:id/pickup` (`:131`) — resolves primary guardian phone, normalises E.164 BEFORE minting (`:152-153`), CSPRNG code scrypt-hashed into `plugin_visitors.pickup_otp` (RLS denies app role), status `pickup_pending` (`:156-167`), sends DIRECTLY via `rails.sms` (not queued — a live single-use code must never sit in the six-role-readable comms table), writes a REDACTED `PICKUP_OTP` comms row as delivery evidence (`:188-223`), event `visitor.pickup.requested.v1`, audit with sandbox honesty note (`:240-247`). On undeliverable, it withdraws the vault row and reverts the visit (`:225-238`).
- **Verify:** `POST …/visitors/:id/pickup/verify` (`:255`) — scrypt compare, attempt cap, consume-on-success, `pickup_pending → verified`; wrong attempts audit risk HIGH (`:271-293`); event `visitor.pickup.verified.v1`, audit.
- **Release (fail-closed):** `POST …/visitors/:id/complete` (`:310`) — an unverified pickup visit is BLOCKED unless owner/principal override with a note, audited risk high (`:317-337`); event `visitor.completed.v1`.
- **Deny:** `POST …/visitors/:id/deny` (`:342`).

**Tables written:** `plugin_visitors.visit`, `plugin_visitors.pickup_otp`, `app.communications`, `app.audit_log`, `app.events`/`app.outbox`.

**Events:** `visitor.logged.v1`, `visitor.checked_in.v1`, `visitor.pickup.requested.v1`, `visitor.pickup.verified.v1`, `visitor.completed.v1`.
**Audit:** `visitor logged`, `visitor checked in`, `pickup OTP raised`, `guardian pickup verified`, `visit completed`, `guardian pickup code rejected` (risk high), `visitor denied`.

**Workers:** the OTP is sent directly by the door (not the dispatcher); the comms evidence row is written `sent`/`failed` immediately. `retention-worker` purges expired pickup OTPs; DPDP erasure deletes them too (`pack.dpdp:286-289`).

**Who else sees it:** front desk via `GET /plugins/ops.visitors/visitors`; parents indirectly (they receive the OTP); `VisitorsBoard.tsx`.

**Honest vs broken:**
- Release without verification is structurally blocked; the only bypass is an audited senior override (`ops.visitors:317-324`).
- Pickup codes live in their OWN vault, never in `app.auth_otps` — otherwise a gate code could be redeemed at `/auth/otp/verify` for a full guardian session (`ops.visitors:159-162`).
- If no SMS provider is configured, the code reaches nobody and the door fails loudly to the photo-ID override rather than pretending (`:225-238`).

---

## 11. Library: book catalogue → issue/return (loan) → overdue chase

**Actors:** library staff (owner/principal/coordinator/facilities); student (own loans).

**Chain:**

- Library screen `/library` (`app/src/screens/LibraryLive.tsx:20`) → `adminApi` library functions (`app/src/services/adminApi.ts:93,96,105,108`) and `apiCreateBook` etc.
- **Catalogue:** `POST /plugins/library/books` (`server/src/plugins/library/index.js:58`) — code optional, server-generated `LIB-…` spine (`:64`); event `library.book.added.v1`, audit (`:74-80`).
- **Catalog read:** `GET /plugins/library/books` (`:86`) with escaped search and DERIVED `available = copies_total − open_loans` (`:94-105`).
- **Issue:** `POST /plugins/library/loans` (`:131`) — book locked `FOR UPDATE` (`:141`), retired title refused (`:144`), student must be ACTIVE (`:148`), availability re-checked under lock (`:149-150`), `INSERT library.loan`, event `library.loan.issued.v1`, audit (`:151-169`).
- **Return:** `POST /plugins/library/loans/:id/return` (`:174`) — fine computed ONCE as whole days overdue × `fine_per_day_cents` (default 500 paise), UTC calendar (`:184-199`), event `library.loan.returned.v1`, audit (`:200-207`).
- **Overdue chase:** `GET /plugins/library/overdue` (`:244`) joins guardians for phone; staff list. This is a READ list — no automatic notices.
- **Student own loans:** `GET /plugins/library/loans/mine` (`:268`) — identity via the 036 name-match pin, fail-closed ("card isn't linked yet") (`:43-48,270-271`).
- Retire: `POST /plugins/library/books/:id/retire` refuses while copies are out (`:110-128`).

**Tables written:** `library.book`, `library.loan`, `app.audit_log`, `app.events`/`app.outbox`.

**Events:** `library.book.added.v1`, `library.book.retired.v1`, `library.loan.issued.v1`, `library.loan.returned.v1`.
**Audit:** `Book added to catalog`, `Book issued`, `Book returned` (with fine), `Book retired`.

**Workers:** `outbox-worker` relays; no worker sends overdue notices.

**Who else sees it:** library staff via the catalog/loans screens; the borrowing student via "my books". No parent door exists for loans.

**Honest vs broken:**
- Availability is derived, never stored, and re-checked under the book lock — two desks cannot both issue the last copy (`library:6-10,149-150`).
- Fines are computed once at return and never edited; the returned row is the fine ledger.
- Overdue chase is a screen list only — there is no dunning-style automated library reminder.

---

## 12. HR/leave + substitution: teacher leave request → coordinator substitution overlay → timetable

**Actors:** teacher (self-leave request); coordinator (approve substitution, decide leave); office (mark leave); timetable consumers.

**Chain:**

- Teacher leave screen `/teacher/leave` (`app/src/screens/teacher/MyLeave.tsx:68-95`) → `teacherFixtures` `flowWrite('leave', '/teacher/leave')` (`app/src/services/teacherFixtures.ts:688,703`).
- **Teacher files leave:** `POST /teacher/leave` (`server/src/plugins/teacher.classroom/index.js:327`) — inserts `teacher.leave_request`, raises kernel action `teacher.leave.<requestId>` owned by coordinator with `payload.proposed_by` (`:334-348`); event `staff.leave.requested.v1`, audit (`:349-354`).
- **Coordinator decides:** `POST /actions/:id/decide` (`routes.js:1370`) — owner_role must be coordinator; SoD enforced.
- **Teacher sees outcome:** `GET /teacher/leave/mine` (`teacher.classroom:359`) mirrors the kernel decision into `teacher.leave_request` idempotently and audits each REAL transition (`:381-403`).
- **Office marks leave (absence fact):** `POST /plugins/hr.leave/leave` (`server/src/plugins/hr.leave/index.js:17`) — SAVEPOINT + per-staff-day unique backstop (`:37-63`); event `staff.leave.marked.v1`, audit (`:44-51`). Cancellation `POST /plugins/hr.leave/leave/:id/cancel` emits `staff.leave.cancelled.v1` (`:67-83`).
- **Substitution overlay:** coordinator screen `/coord/substitutions` (`app/src/screens/coord/SubstitutionReview.tsx:19`) → `getCoordHome` / `coordDecideSubstitution` (`app/src/services/coordApi.ts:65,107`). `GET /plugins/ops.timetable/substitutions/suggest` (`server/src/plugins/ops.timetable/index.js:70`) ranks same-subject free teachers deterministically (`:91-103`). `POST /plugins/ops.timetable/substitutions` (`:38`) upserts `app.timetable_substitutions`, event `substitution.assigned` (`:50-60`).
- **Coordinator decision door:** `POST /coord/substitution/decide` (`server/src/plugins/coord.view/index.js:316`) — validates owner_role=coordinator and a substitution-shaped code (`:327-339`), SoD proposer≠decider (`:342-344`), emits `sub.assign.v1` on approval, audits.
- **Timetable reads the overlay:** `GET /plugins/ops.timetable/grid` exposes `effectiveTeacher` from assigned substitutions for the day (`ops.timetable:22-34`); `hr.leave` absence facts are the declared feed consumed when ops.timetable's `absence_feed='hr.leave'` setting is on (`server/src/plugins/ops.timetable/manifest.js:19`; `manifest.js` of hr.leave `:24-26`).

**Tables written:** `teacher.leave_request`, `app.actions`, `plugin_hr.leave`, `app.timetable_substitutions`, `app.audit_log`, `app.events`/`app.outbox`.

**Events:** `staff.leave.requested.v1`, `staff.leave.marked.v1`, `staff.leave.cancelled.v1`, `substitution.assigned`, `sub.assign.v1`, `duty.assigned.v1`.
**Audit:** `Staff leave requested`, `Staff leave marked (…)`, `Substitution assigned`, `Substitution action approved/dismissed`, `Leave decision projected onto request`.

**Workers:** `outbox-worker` relays; `workflow-worker` can match `substitution.assigned`; the timetable feed is a settings-level code contract, not a worker.

**Who else sees it:** coordinator via `/coord/substitutions` and `/coord/home`; office via `GET /plugins/hr.leave/roster/:date` (`hr.leave:87`) and `GET /plugins/hr.leave/leave` (`:109`); teacher via My Leave; worked teachers via grid `effectiveTeacher`.

**Honest vs broken:**
- The teacher leave request and the office-marked hr.leave absence are TWO separate records joined only by the decision projection — the leave request does not itself write the absence fact.
- Substitution conflicts are section-agnostic in v1 (one grid per school); the clash-check door honestly reports section clashes as not-applicable (`routes.js:1685`).
- Only the assigned substitution is overlaid; there is no automatic timetable regeneration.

---

## 13. Files/documents: upload → storage → permissioned download; DPDP SAR/erasure

**Actors:** staff/teacher (uploader); owner/principal/itadmin (admin readers); parent/student (scoped readers); DPO (SAR).

**Chain:**

- Documents screen `/documents` (`app/src/screens/Documents.tsx`) and `adminApi.uploadFile` (`adminApi.ts:123`).
- **Upload:** `POST /plugins/files.store/upload` (`server/src/plugins/files.store/index.js:141`) — JSON base64 primary lane or multipart; 5MB cap; mime whitelist AND extension agreement (a `.exe` dressed as pdf → 415) (`:51-59,94-106`); sha256 over bytes; bytes written under `FILES_DIR/<tenant>/<uuid>.<ext>` (`:125-131`); metadata `INSERT app.files` (`app/files` schema via `048_files.sql`), event `files.stored.v1`, audit `File uploaded` (`:133-176`).
- **Permissioned download:** `GET /plugins/files.store/:id/download` (`files.store:204`) — uploader + owner/principal/itadmin always; `scope=student` additionally admits that child's guardians via `family.child_link` and the student via name-match pin (`:216-235`); refused access is AUDITED risk medium (`:236-241`); successful download audited risk low; bytes streamed only AFTER the audit tx commits, path traversal blocked (`:250-262`).
- **List metadata:** `GET /plugins/files.store` — non-admin staff pinned to own uploads (`:266-285`).
- **DPDP consent:** `POST /plugins/pack.dpdp/consent` (`server/src/plugins/pack.dpdp/index.js:44`) — append-only immutable; a re-grant is refused only if the live artifact is still granted (`:58-67`); event `consent.recorded.v1`, audit.
- **DPDP SAR:** `POST /plugins/pack.dpdp/dsr` (`pack.dpdp:111`) opens `plugin_dpdp.sar` and raises kernel action `dpdp.dsr.<kind>.<sarId>` (per-instance code) (`:130-140`); event `sar.opened.v1`, audit risk high for erasure. DPO decides via `POST /actions/:id/decide`; execute `POST /plugins/pack.dpdp/dsr/:id/execute` (`:185`) enforces approved + proposer≠executor (`:192-199`).
- **Erasure surfaces:** consent + admissions lead redaction (`:214-219`); keyed surrogate journal (`:243-254`); guardians (`:262-265`), comms recipients (`:266-273`), gateway webhook payloads (`:274-285`), pickup OTP + login OTP purge (`:286-293`), visitor phones (`:294-297`), SAR refs (`:298-301`); office-lane `app.students.guardian_name/phone` redacted by the kernel core-lane action `students.redactGuardianPii` (`:310-316`; `server/src/core-lane-actions.js`); event `sar.fulfilled.v1`, audit.
- Export bundle `GET /plugins/pack.dpdp/dsr/:id/export` only after fulfilled (`:169-182`).

**Tables written:** `app.files` + filesystem under `FILES_DIR`; `plugin_dpdp.consent`, `plugin_dpdp.sar`, `plugin_dpdp.erasure_journal`; `app.guardians`, `app.communications`, `plugin_razorpay.webhook_log`/`order_log`, `plugin_upi.webhook_log`, `plugin_visitors.pickup_otp`, `app.auth_otps`, `plugin_visitors.visit`, `app.students` (via core-lane action), `app.audit_log`, `app.events`/`app.outbox`.

**Events:** `files.stored.v1`, `consent.recorded.v1`, `sar.opened.v1`, `sar.fulfilled.v1`.
**Audit:** `File uploaded`, `File downloaded`, `File download refused` (risk medium), `consent granted/withdrawn`, `SAR export/erasure opened`, `SAR … executed (kernel-approved)` (risk high for erasure).

**Workers:** none for files; `outbox-worker` relays DPDP events; `retention-worker` enforces retention; the erasure journal has a replay script `scripts/replay-erasure-journal.js`.

**Who else sees it:** uploader and admins via the Documents screen; a parent only for `scope=student` files tied to their child; the DPO via the DPDP doors; audit readers (owner/principal/itadmin/finance) see the download/refusal rows.

**Honest vs broken:**
- Bytes are never web-served; there is no static route, every read goes through the access check (`files.store:6-10`).
- The reset/OTP doors redact secrets from the comms ledger; file metadata carries no bytes.
- Erasure is a governed, audited exception that preserves decision trails; `app.users` login identities remain office-lane and the audit chain is redacted/rebased post-run (`pack.dpdp:225-233`).
- The erasure's office-lane step is reached only through the kernel core-lane action; the DPDP pack itself holds no `app.students` SQL.

---

## 14. Plugin lifecycle: catalog → enable (gates) → settings (encrypted) → disable/drain

**Actors:** owner/IT-admin (switchboard); plugin manifest; tenant plan.

**Chain:**

- Plugin manager screen `/plugins` (`app/src/screens/Plugins.tsx:12,44-45`) → `apiEnablePlugin`/`apiDisablePlugin` (`liveApi.ts:284,286`); settings screen `/plugins/settings/:id` (`app/src/screens/PluginSettings.tsx:20`).
- **Catalog read:** `GET /plugins` (`server/src/routes.js:1986`) — self-heals missing catalog rows (`ensurePluginCatalog`, `:1990`), returns settings MASKED for non-privileged roles (`:2000-2012`), surfaces capability contracts and the tenant plan.
- **Enable gates** at `POST /plugins/:id/enable` (`routes.js:2020`):
  - manifest resolved from DISK, body ignored (PLG-4) (`:2026-2028`);
  - permission vocabulary check (`unknownPermissions`, `:2030-2031`; `server/src/plugin-permissions.js:26-31,74-76`);
  - class A–E required (`:2033-2034`);
  - kernel semver compatibility (`kernelSatisfies`, `:2035-2036,41-50`);
  - manifest ≤64KB (`:2038`);
  - ENTITLEMENT: `planIncludes(plan, plugin)` else 402 (`:2043-2045`; `server/src/entitlements.js:51-65`);
  - dependency enable + version check (`:2046-2060`);
  - manifest merge preserving stored `settingsSchema` (`:2071-2078`);
  - upsert `app.plugins` grant = the manifest declaration (`:2079-2088`); audit `Plugin enabled` risk medium (`:2089`).
- **Runtime lifecycle gate:** every plugin door carries `makeLifecycleGate` (`server/src/plugins/_shared/lifecycle-gate.js:24-59`) — kernel OFF → 409 friendly copy; plan gap → 402; grant not covering declaration → 403 (`:28-58`). The manifest ceiling is enforced at kernel facilities by `scopedKernel` (`plugin-permissions.js:116-144`).
- **Settings:** `POST /plugins/:id/settings` (`routes.js:2120`) — locked read-modify-write, schema validation (SEC-6, `:2152-2162`), `encryptSettings` before persist (`:2163-2168`; `server/src/settings-crypto.js`), audit records CHANGED KEY NAMES only, secret-class flagged risk high (`:2171-2187`).
- **Disable/drain:** `POST /plugins/:id/disable` (`routes.js:2094`) — DRAIN PROTOCOL: open actions re-owned to the Principal desk, linked events counted and retained (`:2097-2115`); audit includes drain counts.

**Tables written:** `app.plugins`, `app.audit_log`, `app.events`/`app.outbox`.

**Events:** none emitted by enable/disable itself; the registry status change is consumed by the frontend kernel resync (`app/src/plugins/useKernel.tsx`).
**Audit:** `Plugin enabled: <id>` (risk medium), `Plugin disabled: <id>` (with DRAIN counts), `Plugin settings updated: <id>` (secret rotation risk high).

**Workers:** none directly; `lifecycle-gate` is read per request so a disable takes effect immediately.

**Who else sees it:** all authenticated roles see the plugin list, but only owner/itadmin see settings values (`routes.js:2000-2012`); nav is hidden client-side from `/me/effective` and the kernel resync — the server still enforces every door.

**Honest vs broken:**
- Enable metadata can no longer be client-forged; version/class/permissions come from the on-disk manifest.
- Plan entitlement is enforced per request, not trusted from the row, so a downgrade binds.
- A plugin with no manifest on disk is refused (`404`) instead of fabricating a registry row (`routes.js:2028`).
- Some manifest permission seams are recorded as `unenforced` in `plugin-permissions.js:36-53` — the ceiling is real only where a seam exists.

---

## 15. Event spine: emit → outbox → relay → webhook fan-out → delivery states; comms dispatcher claims/leases

**Actors:** every domain door; the outbox relay; the webhook worker; the comms dispatcher; subscribers.

**Chain:**

- **Emit (same tx):** `emitEvent` validates type/topic/label/payload size, inserts `app.events` then `app.outbox` with envelope v2 fields (`server/src/audit.js:37-59`; columns `004_event_spine.sql`).
- **Relay:** `scripts/outbox-worker.js` `tick()` claims due rows `FOR UPDATE SKIP LOCKED`, increments attempts for EVERY claimed row before delivery, backoff `min(BASE·2^(attempts-1), MAX)`, parks after 8 attempts on `parked_at` while leaving `processed_at` NULL so failure ≠ idleness (`:77-124`; backoff `:55`; park `:97-104`). Default sink is the structured log line (`:65-75`).
- **Webhook fan-out:** `scripts/webhook-worker.js`:
  - `enqueueFromEvents` discovers UN-discovered outbox rows by STATE (`discovered_at IS NULL`), schedules matching active subscriptions (`'*'` wildcard), then marks the whole page discovered (`:36-82`; table `app.webhook_deliveries` from `069_api_keys_webhooks.sql`).
  - `processDueDeliveries` claims due deliveries `FOR UPDATE SKIP LOCKED`, POSTs signed payload `X-SchoolOS-Signature: t=<unix>,v1=hmac_sha256(secret,t+"."+body)` (`:32-34,84-106`), mirrors backoff/park semantics (`:108-144`).
- **Workflow runner:** `scripts/workflow-worker.js` `runWorkflowPass` state-discovers outbox rows (`workflow_scanned_at IS NULL`), matches enabled rules by topic+condition, performs ONE action (comms enqueue or derived outbox fan-out) with `wf:` dedup keys, never rule-triggers-rule (`:30-88`; rules stored `app.workflow_rules`, CRUD `routes.js:1326-1358`).
- **Comms dispatcher:** `scripts/comms-dispatcher.js` `tick()` claims queued comms as a LEASE (`claimed_at`/`claimed_by`, 10-min stale reclaim; migration `099_comms_claim_leases.sql`), provider calls OUTSIDE the claim transaction (`:281-313`); `processClaimedRow` resolves rail by channel, fans out to EVERY recipient (`fanOut`, `:147-171`), refuses over-cap rather than truncating (`:179-184`), and applies carrier honesty: in production a sandbox carrier is terminal `failed`, never `sent` (`:249-257`); retry/park mirrors outbox (`:264-278`).
- **API/keys:** `/api-keys` CRUD and `/webhooks` CRUD at `app.js:1083-1141`; owners receive the signing secret once.

**Tables:** `app.events` (`001_init.sql:240`), `app.outbox` (`:302`), `app.event_action_link` (`004_event_spine.sql`), `app.webhook_subscriptions`/`app.webhook_deliveries` (`069`), `app.workflow_rules`, `app.communications`, `app.ops_counters` (metrics flush, `app.js:1526-1530`).

**Delivery states:**
- Outbox: `processed_at` set = relayed; `parked_at` set = given up; `next_attempt_at` = retry pacing.
- Webhook: `queued` → `delivered` / retried → `failed`.
- Comms: `queued` (claimed/leased) → `sent` (carrier named) / retried → `failed`; `failed` IS the DLQ (a query, not a table).

**Audit/events:** every emit also writes its domain audit row; the workers write no audit rows of their own (they are bookkeeping).

**Who else sees it:** staff via `GET /events` (`routes.js:1832`) and `GET /events/lineage` (`:1956`); operators via `/metrics` gauges `schoolos_outbox_pending/parked`, `schoolos_comms_queued/sandbox_sent/failed`, `schoolos_webhook_deliveries_queued/failed/stalled` (`app.js:1441-1489`).

**Honest vs broken:**
- `outbox_pending` is NOT a delivery measure — the HELP text says so explicitly; a 0 can coexist with every webhook failing (`app.js:1444-1449`).
- Sandbox comms are counted separately so the "sent to nobody" population is measurable (`app.js:1461-1473`).
- Workflow rules are minimal (one condition + one action), no UI yet, every change audited (`app.js:1323-1325`).
- Correlation/causation ids are declared in the envelope but not populated by most callers.

---

## 16. Audit ledger: hash chain → /audit/verify; privileged mutation coverage

**Actors:** every mutating door (system); audit readers (owner/principal/itadmin/finance); verifier (owner/itadmin).

**Chain:**

- **Write:** `auditLog` takes a per-tenant advisory lock, reads the previous hash, calls `app.audit_append` (`server/src/audit.js:22-34`).
- **DB pinning (migration 075):** `app.audit_pin_hash` BEFORE INSERT trigger sets `prev_hash`, `hash`, `hash_version=2`, truncates `created_at` to ms, computing `sha256(prev || app.audit_material(...))`; `p_hash` is ignored (`server/migrations/075_audit_integrity.sql`). An UPDATE trigger refuses rewrites; `app.audit_append` holds the serialization lock and a tenant pin (`075`).
- **Read:** `GET /audit` (`routes.js:1867`) role-gated to owner/principal/itadmin/finance, limit ≤500, returns `prev_hash`/`hash`.
- **Verify:** `GET /audit/verify` (`routes.js:1888`) calls `app.audit_verify(tenant, limit)` on the OWNER path (so the revoke-all cold table is visible), classifies `link_break` / `hash_mismatch`, never 5xx, and writes an audit row recording the verification run itself (`:1908-1916`); it states limitations (legacy v1 rows unrecomputable, cold chain not walked, superuser can bypass the trigger) (`:1924-1931`).
- **Privileged mutation coverage:** every domain write calls `auditLog` (kernel) or `requestAudit` (plugin, provenance `plugin:<id>`) inside the same `withUser` transaction (`server/src/audit.js:72-78`). Examples across all 18 scenarios above.

**Tables written:** `app.audit_log` (`001_init.sql:281`), `app.audit_log_cold` (`067_audit_cold.sql:8`), `app.events`/`app.outbox`.

**Events:** audit verification itself is audited; chain archival is chain-preserving (hot→cold verbatim, `retention-worker`).
**Audit:** one row per mutation; `Audit chain verified` records the run outcome.

**Workers:** `retention-worker` archives (never DELETEs) audit rows to cold; `day-worker.js:47-52` invokes it.

**Who else sees it:** four roles via `/audit` (`app/src/screens/Audit.tsx:27,84`); owner/itadmin via the Data Health surface (`DataHealth.tsx`).

**Honest vs broken:**
- The ledger is tamper-EVIDENT (database-pinned hash + verifier), not tamper-proof: a DB superuser can `session_replication_role`-bypass the trigger, which the verifier then detects (`075`; `routes.js:1929-1930`).
- `ip` is hashed but no writer populates it yet (`075` note; `audit.js`).
- v1 rows predating 075 cannot be recomputed and are counted, never laundered into "verified".

---

## 17. Custom roles: author mask → assign → enforcement at doors + effective-access

**Actors:** owner/itadmin (author); any user carrying a `role_key`; custom-role machinery.

**Chain:**

- Admin screen `/roles` (`app/src/screens/RolesAdmin.tsx:26,86`) → `GET/POST/PATCH/DELETE /roles` (`server/src/routes.js:335,346,372,397`).
- **Author:** `POST /roles` (`routes.js:346`) validates key/label/base_role (`:349-353`), `validateMask` checks each pattern matches a REAL registered door, forbids grant-all root paths, and enforces the AMPLIFICATION CEILING: an `allow` pattern may only cover doors the AUTHOR can already reach; owner is exempt, non-owner role-admins are capped (`:287-325`). Insert `app.roles`, audit risk high (`:357-369`).
- **Assign:** `POST /roles/:key/assign` (`routes.js:421`) — owner accounts and self are structurally refused (`:430-432`); updates `app.users.role_key`; invalidates the binding cache immediately via `forgetBinding` (`:433-435`); audit risk high.
- **Enforcement (one shared module):** `server/src/custom-roles.js` `applyMask` is called by BOTH gates:
  - kernel `require()`/`me()` (`routes.js:158-200`),
  - plugin `requireRole` (`server/src/app.js:1162-1185`),
  - and unconditionally in `authenticate` for the restrictive half (`app.js:199-206`).
  Resolution order: base role decides; a matched DENY refuses; a matched ALLOW lifts (`custom-roles.js:14-17,73-117`). One decision is memoised per request (`MASK_DECISION`, `:89-117`).
- **Mask authoring/validation** stays kernel-side because it needs the live route registry (`registeredRoutes`/`doorRoles` captured by the `onRoute` hook, `routes.js:138-156`).
- **Effective access:** `GET /me/effective` (`routes.js:231`) computes reachable doors from the SAME registry + the caller's mask (`server/src/effective-access.js:119-133`), maps them to user-facing surfaces via `SURFACE_DOOR`, and returns `capabilities`/`nav`/`scope.classes`; the frontend `Guard` uses it as a render hint (`app/src/App.tsx:228-238`).

**Tables written:** `app.roles` (`063_custom_roles.sql:13`), `app.users.role_key` (`063`), `app.audit_log`, `app.events`/`app.outbox`.

**Events:** none emitted directly; role changes are audited.
**Audit:** `Custom role created/updated/retired/assigned/cleared` (risk medium–high), `Custom role deleted` reports retirement in place.

**Workers:** none; the 30s binding cache bounds cross-request staleness but assign/unassign invalidate it at once (`custom-roles.js:44-54,133`).

**Who else sees it:** owner/itadmin manage; the affected user sees their own `role_key`/mask via `GET /me` and reachable surfaces via `/me/effective` (`routes.js:217-222,231-256`); frontend screens render controls from that hint. Enforcement is always server-side.

**Honest vs broken:**
- The mask can never exceed its author's reach (amplification ceiling), and grant-all wildcards were removed (`routes.js:276-325`).
- A DELETE retires the role in place (D-35 grant law: no app-role DELETE) so `recordRef` stays resolvable (`routes.js:397-416`).
- A `deny` cannot be lifted by a base role; an `allow` can lift a base-role refusal — this is the whole point of the librarian preset.

---

## 18. MFA / OTP / SSO / password reset / multi-tenant switch

**Actors:** any signer-in; a staff member enrolling MFA; a multi-school person; the mailbox/SMS rails.

**Chain:**

- **Password login:** `POST /auth/login` (`app.js:244`) — tenant scoping, multi-tenant 409 picker (`:250-261`), dummy-verify timing equalisation (`:263-268`), DB-backed account lockout 5/15min (`:272-295`), legacy-hash upgrade (`:302-305`), MFA challenge branch (`:310-319`), then the shared `issueSession` (`:360-367`). `mustChange` → 403 restricted (`:325-331`).
- **Session issue (one path):** `issueSession` stamps `jti` + `ep`, sets HttpOnly session cookie + JS CSRF cookie, audits `Signed in (<via>)` (`app.js:360-368`). Cookies/CSRF helpers `:80-112`; CSRF double-submit enforced only for cookie-carried mutations (`:155-164`).
- **Token validation:** `authenticate` (`app.js:129-216`) — API-key synthetic principal (`:131-148`), jti denylist lookup (`:170-172`), live user row (`:173-174`), epoch match (`:179-181`), `mustChange`/`mfaPending` restrictions (`:186-197`), custom-role mask (`:206`).
- **Phone OTP:** `POST /auth/otp/request` (`app.js:397`) normalises E.164 once (`:405`), channel gate BEFORE minting (`:438-442,450-458`), CSPRNG 6-digit scrypt-hashed vault row tenant-bound (`:460-468`), direct rail send with redacted comms evidence (`:485-528`); `POST /auth/otp/verify` (`:533`) uniform failure copy, attempts cap, single-use consume, session issued (`:544-589`).
- **Google SSO:** `GET /auth/google/start` stores single-use server-side state (`:594-610`); `GET /auth/google/callback` deletes+validates state, timeout-bounded fetches, multi-tenant 409, audits the provider transition risk high (`:612-656`); dev simulator dual-gated (`:662-671`; `config.js:67-86`).
- **MFA (staff):** `POST /me/mfa/enroll` (`app.js:924`) refuses parents/students, refuses re-enroll while live, inserts `auth.mfa_secrets enabled=false`, audits risk high (secret never recorded) (`:928-947`); `POST /me/mfa/disable` requires password re-auth and runs on the OWNER path because the vault denies the app role (`:952-973`); `POST /me/mfa/verify` (`:979`) dual-path (enroll-confirm vs login-challenge), atomic attempts, TOTP then single-use recovery codes, mints recovery codes only when enabling (`:1044-1072`). TOTP in `server/src/totp.js`.
- **Password reset:** `POST /me/reset-request` (`app.js:795`) anti-enumeration 200 on unknown email, channel gate 503, one open token per account, sha256-stored 32B token, raw code REDACTED from the comms ledger (SEC-0) (`:805-885`); `POST /me/reset-confirm` (`:888`) race-safe consume, epoch bump, audit (`:890-911`).
- **Multi-tenant:** `GET /me/tenants` lists memberships (`app.js:724`); `POST /me/switch` requires the current password when the account has one (S0 fix A4) and re-issues a session for the target tenant (`:733-762`); multiTenantReply picker contract (`:381-386`). Frontend `tenantSwitch.ts` / `ChangePassword.tsx` / `MfaSection.tsx`.

**Tables written:** `app.users` (password_hash, session_epoch, force_change, mfa_enrolled_at, auth_provider), `app.auth_otps` (`008_full_authentication.sql:12`, app-role-blind), `auth.reset_tokens` (`056_auth_reset.sql:6`), `auth.mfa_secrets` (`057_mfa.sql:8`), `auth.mfa_recovery_codes` (`057:16`), `auth.mfa_challenges` (`096_mfa_challenge_attempts.sql:4`), `auth.revoked_token`, `auth.login_throttles`, `app.oauth_states`, `app.communications`, `app.audit_log`, `app.events`/`app.outbox`.

**Events:** OTP issue/warn/withdraw, SSO link, reset request; most auth transitions are AUDIT rows rather than outbox events.
**Audit:** `Signed in (password|phone|google-sso|MFA|renew)`, `Signed out`, `Password changed`, `Phone OTP issued/accepted/rejected`, `SSO identity linked` (risk high), `MFA enrolment started` (risk high), `MFA disabled`, `MFA enabled`, `MFA second factor verified`, `Password reset requested/completed`, `Switched school`.

**Workers:** reset and OTP emails/SMS are sent DIRECTLY by the door (not queued) so a live code never sits in the six-role-readable comms ledger; `retention-worker` purges expired OTPs/tokens.

**Who else sees it:** the user via `Login.tsx`, `MfaSection.tsx`, `ChangePassword.tsx`; audit readers see the auth rows; nobody can read OTP/MFA secrets (kernel-only tables).

**Honest vs broken:**
- Every token carries `jti` + `ep`; logout denylists the jti; a password change bumps the epoch and kills all other sessions without a live-jti registry (`app.js:179-181,774-781`).
- `POST /auth/renew` retires the token being renewed (S0 fix A6) (`app.js:346-352`).
- MFA is staff-only by posture; parents/students use the OTP channel and short-lived (30m) shared-computer sessions (`app.js:363,924-925`).
- `/me/switch` requires password step-up when one exists; OTP-only desks switch on the phone factor (`app.js:737-748`).
- No email verification exists for signup; the SMS/email rails must be configured per tenant or the doors answer honest 503s rather than faking a send.

---

### Cross-cutting honest notes (apply to every scenario)

- **Tenant isolation** is enforced by `withUser` GUCs + FORCE RLS on the app role (`server/src/db.js:115-131`); `sysq()` bypasses it and is deliberately enumerated for auth, registry and maintenance.
- **No hard deletes** for the app role in schema `app` (D-35): mutations are status flips, retirement-in-place, or soft-disable (`routes.js:1349-1353` workflow-rules, `:410-414` roles).
- **Honesty rule:** sandbox carriers in production become `failed`, never `sent` (`comms-dispatcher.js:249-257`); a notice with no resolvable recipients is `unaddressed`, never `delivered` (`routes.js:1425-1434`).
- **Read models are live joins**, not caches, except deliberate frozen exam report snapshots and the immutable audit ledger.
- **Known weak seams** named in code: student identity is a name-match pin where no `students.user_id` link exists (`teacher.classroom:40-77`); attendance class-ownership is `app.class_assignments`-based but timetable slots are section-agnostic (`routes.js:1685`); `plugin-permissions.js:36-53` records which permission seams are still `unenforced`.

---

# Catalogue D — The data model (104 tables)


> Generated from the live migrated database (`schoolos`) on 2026-09-17 via `information_schema`. Columns show `name type` (`!` = NOT NULL, `PK` = primary key, `→` = foreign key target, `=default`). `RLS` = row-level security (F = FORCE). `rows` = dev-DB row count (seed data, not production).

## schema `app` (46 tables)

### `app.academic_years`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.tenants.id; `name` text !; `starts_on` date !; `ends_on` date !; `is_current` boolean ! =false; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

### `app.actions`  ·  rows=1  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.users.tenant_id; `code` text !; `kind` text !; `title` text !; `detail` text; `why` text; `priority` text ! ='normal'::text; `status` text ! ='open'::text; `owner` text; `owner_role` text; `policy_ref` text; `ai_involved` boolean ! =false; `source_event` text; `payload` jsonb ! ='{}'::jsonb; `deadline` timestamp with time zone; `decided_by` uuid →app.users.tenant_id; `decided_at` timestamp with time zone; `decision_note` text; `created_at` timestamp with time zone =now()

### `app.ai_calls`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.users.tenant_id; `user_id` uuid →app.users.tenant_id; `plugin_id` text !; `purpose` text !; `provider` text !; `model` text; `tokens_in` integer ! =0; `tokens_out` integer ! =0; `latency_ms` integer; `outcome` text !; `error` text; `sandbox` boolean ! =true; `created_at` timestamp with time zone ! =now()

### `app.api_keys`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.users.tenant_id; `key_hash` text !; `name` text !; `scopes` ARRAY ! ='{}'::text[]; `revoked_at` timestamp with time zone; `last_used_at` timestamp with time zone; `created_by` uuid →app.users.tenant_id; `created_at` timestamp with time zone ! =now()

### `app.assets`  ·  rows=6  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.tenants.id; `code` text !; `name` text !; `category` text !; `building` text; `room` text; `status` text ! ='operational'::text; `health_score` integer ! =100; `installed_on` date; `created_at` timestamp with time zone =now()

### `app.attendance`  ·  rows=3752  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.students.tenant_id; `student_id` uuid ! →app.students.tenant_id; `school_date` date !; `status` text !; `marked_by` uuid →app.users.tenant_id; `marked_at` timestamp with time zone ! =now(); `note` text

### `app.audit_log`  ·  rows=230  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.tenants.id; `actor` text !; `actor_role` text !; `action` text !; `record_type` text !; `record_ref` text; `reason` text; `policy_ref` text; `ai_involved` boolean ! =false; `risk` text ! ='low'::text; `outcome` text; `ip` inet; `prev_hash` text; `hash` text; `created_at` timestamp with time zone ! =now(); `hash_version` smallint ! =1

### `app.audit_log_cold`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `actor` text !; `actor_role` text !; `action` text !; `record_type` text !; `record_ref` text; `reason` text; `policy_ref` text; `ai_involved` boolean ! =false; `risk` text ! ='low'::text; `outcome` text; `ip` inet; `prev_hash` text; `hash` text; `created_at` timestamp with time zone ! =now(); `archived_at` timestamp with time zone ! =now(); `hash_version` smallint

### `app.auth_otps`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.tenants.id; `phone` text !; `code_hash` text !; `purpose` text ! ='login'::text; `attempts` integer ! =0; `expires_at` timestamp with time zone !; `consumed_at` timestamp with time zone; `created_at` timestamp with time zone ! =now()

### `app.capability_contracts`  ·  rows=138  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid; `plugin_id` text; `capability_id` text !; `version` text !; `contract` jsonb !; `active` boolean ! =true; `created_at` timestamp with time zone ! =now(); `kind` text ='capability'::text; `enforced` jsonb ! ='{"audit": "full"}'::jsonb; `optional` boolean ! =true

### `app.cases`  ·  rows=1  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.users.tenant_id; `code` text !; `kind` text !; `title` text !; `detail` text; `priority` text ! ='normal'::text; `status` text ! ='open'::text; `owner` text; `opened_by` uuid →app.users.tenant_id; `origin` text ! ='staff'::text; `sla_due_at` timestamp with time zone; `linked_refs` jsonb ! ='[]'::jsonb; `created_at` timestamp with time zone =now(); `resolved_at` timestamp with time zone; `idempotency_key` text

### `app.class_assignments`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.users.tenant_id; `teacher_id` uuid ! →app.users.tenant_id; `grade` text !; `section` text !; `active` boolean ! =true; `assigned_by` uuid; `created_at` timestamp with time zone ! =now()

### `app.communications`  ·  rows=2  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.users.tenant_id; `audience_kind` text ! ='guardian'::text; `audience_json` jsonb ! ='[]'::jsonb; `channel` text ! ='whatsapp'::text; `template` text; `body` text !; `status` text ! ='queued'::text; `policy_ref` text; `dedup_key` text; `approved_by` uuid →app.users.tenant_id; `sent_at` timestamp with time zone; `delivered_at` timestamp with time zone; `created_at` timestamp with time zone =now(); `attempts` integer ! =1; `last_error` text; `next_attempt_at` timestamp with time zone; `provider` text; `provider_ref` text; `claimed_at` timestamp with time zone; `claimed_by` text

### `app.enrollment_history`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.students.tenant_id; `student_id` uuid ! →app.students.tenant_id; `from_grade` text !; `from_section` text !; `to_grade` text !; `to_section` text !; `changed_by` uuid →app.users.tenant_id; `reason` text; `created_at` timestamp with time zone ! =now()

### `app.event_action_link`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.outbox.tenant_id; `event_id` uuid →app.events.tenant_id; `outbox_id` uuid →app.outbox.tenant_id; `action_id` uuid →app.actions.tenant_id; `downstream_event_id` uuid →app.events.tenant_id; `relation` text ! ='raised'::text; `policy_ref` text; `created_at` timestamp with time zone ! =now()

### `app.events`  ·  rows=7  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.tenants.id; `type` text !; `label` text !; `severity` text ! ='info'::text; `ref` text; `created_at` timestamp with time zone ! =now(); `schema_version` integer ! =1; `emitted_by` text ! ='kernel'::text; `subject` text; `correlation_id` uuid; `causation_id` uuid; `payload` jsonb

### `app.fee_obligations`  ·  rows=1125  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.students.tenant_id; `student_id` uuid ! →app.students.tenant_id; `term` text !; `label` text !; `due_on` date; `amount_cents` bigint !; `paid_cents` bigint ! =0; `status` text ! ='open'::text; `source_ref` text; `created_at` timestamp with time zone ! =now(); `academic_year_id` uuid →app.academic_years.tenant_id

### `app.fee_plan_templates`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.academic_years.tenant_id; `name` text !; `grades` ARRAY !; `terms` jsonb !; `academic_year_id` uuid →app.academic_years.tenant_id; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

### `app.fee_plans`  ·  rows=375  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.students.tenant_id; `student_id` uuid ! →app.students.tenant_id; `term` text !; `total_cents` bigint !; `installments` integer ! =3; `created_at` timestamp with time zone ! =now(); `academic_year_id` uuid →app.academic_years.tenant_id

### `app.files`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.users.tenant_id; `uploader_id` uuid →app.users.tenant_id; `filename` text !; `mime` text !; `bytes` integer !; `sha256` text !; `storage_path` text !; `scope` text !; `ref_id` uuid; `created_at` timestamp with time zone ! =now()

### `app.guardians`  ·  rows=375  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.students.tenant_id; `student_id` uuid ! →app.students.tenant_id; `name` text !; `phone` text !; `relation` text ! ='guardian'::text; `is_primary` boolean ! =true; `created_at` timestamp with time zone ! =now()

### `app.memory_entries`  ·  rows=1  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.tenants.id; `kind` text ! ='decision'::text; `title` text !; `body` text; `evidence` jsonb ! ='[]'::jsonb; `decided_by` text; `decided_at` timestamp with time zone =now(); `expected` text; `actual` text

### `app.migration_rows`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.students.tenant_id; `source_id` uuid ! →app.migration_sources.tenant_id; `row_no` integer !; `kind` text ! ='student'::text; `payload` jsonb ! ='{}'::jsonb; `status` text ! ='staged'::text; `error` text; `committed_student_id` uuid →app.students.tenant_id; `created_at` timestamp with time zone ! =now()

### `app.migration_sources`  ·  rows=5  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.tenants.id; `name` text !; `kind` text !; `row_count` integer ! =0; `imported` integer ! =0; `flagged` integer ! =0; `skipped` integer ! =0; `status` text ! ='connected'::text; `meta` jsonb ! ='{}'::jsonb; `created_at` timestamp with time zone =now(); `sample_json` jsonb ! ='{}'::jsonb

### `app.notifications`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.users.tenant_id; `user_id` uuid →app.users.tenant_id; `group` text ! ='updates'::text; `title` text !; `body` text; `ref` text; `read_at` timestamp with time zone; `created_at` timestamp with time zone =now()

### `app.oauth_states`  ·  rows=0  ·  RLS=FORCE
  `state` text PK !; `created_at` timestamp with time zone ! =now()

### `app.ops_counters`  ·  rows=3  ·  RLS=FORCE
  `name` text PK !; `value` bigint ! =0; `updated_at` timestamp with time zone ! =now()

### `app.outbox`  ·  rows=42  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.events.tenant_id; `topic` text !; `payload` jsonb !; `created_at` timestamp with time zone ! =now(); `processed_at` timestamp with time zone; `event_id` uuid →app.events.tenant_id; `schema_version` integer ! =1; `emitted_by` text ! ='kernel'::text; `subject` text; `correlation_id` uuid; `causation_id` uuid; `attempts` integer ! =0; `last_error` text; `next_attempt_at` timestamp with time zone; `dedup_key` text; `parked_at` timestamp with time zone; `discovered_at` timestamp with time zone; `workflow_scanned_at` timestamp with time zone

### `app.payments`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.students.tenant_id; `student_id` uuid ! →app.students.tenant_id; `obligation_id` uuid →app.fee_obligations.tenant_id; `amount_cents` bigint !; `method` text ! ='upi'::text; `gateway_ref` text; `status` text ! ='created'::text; `receipt_no` text; `created_at` timestamp with time zone ! =now(); `confirmed_at` timestamp with time zone; `refunded_at` timestamp with time zone; `refund_reason` text; `refund_gateway_ref` text; `idempotency_key` text

### `app.plugins`  ·  rows=52  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.users.tenant_id; `plugin_id` text !; `version` text !; `class` text !; `status` text ! ='registered'::text; `manifest` jsonb ! ='{}'::jsonb; `permissions` jsonb ! ='[]'::jsonb; `settings` jsonb ! ='{}'::jsonb; `entitlement` jsonb ! ='{}'::jsonb; `enabled_at` timestamp with time zone; `enabled_by` uuid →app.users.tenant_id; `updated_at` timestamp with time zone ! =now(); `created_at` timestamp with time zone ! =now(); `event_budget` jsonb ! ='{}'::jsonb; `ai_budget` jsonb ! ='{}'::jsonb; `breaker_state` jsonb ! ='{"open": false}'::jsonb; `trust_level` text ! ='T1'::text; `cert_score` jsonb

### `app.roles`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.tenants.id; `key` text !; `label` text !; `base_role` text !; `permissions` jsonb ! ='{"deny": [], "allow": []}'::jsonb; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

### `app.route_stops`  ·  rows=17  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.routes.tenant_id; `route_id` uuid ! →app.routes.tenant_id; `seq` integer !; `name` text !; `eta_offset_mins` integer ! =0

### `app.routes`  ·  rows=4  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.tenants.id; `code` text !; `name` text !; `vehicle` text; `capacity` integer ! =40; `permit_capacity` integer; `created_at` timestamp with time zone =now()

### `app.schema_migrations`  ·  rows=41  ·  RLS=FORCE
  `name` text PK !; `applied_at` timestamp with time zone ! =now(); `checksum` text

### `app.students`  ·  rows=375  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.tenants.id; `admission_no` text !; `name` text !; `grade` text !; `section` text !; `guardian_name` text; `guardian_phone` text; `bus_route` text; `status` text ! ='active'::text; `source` text ! ='migration'::text; `source_ref` text; `created_at` timestamp with time zone ! =now()

### `app.tenants`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `slug` text !; `name` text !; `config` jsonb ! ='{}'::jsonb; `created_at` timestamp with time zone ! =now(); `onboarded_at` timestamp with time zone; `onboarded_via` text; `plan` text ! ='trial'::text

### `app.timetable_periods`  ·  rows=10  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.tenants.id; `seq` text !; `label` text !; `start_time` text !; `end_time` text !; `is_break` boolean ! =false; `sort_idx` integer !

### `app.timetable_slots`  ·  rows=270  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.timetable_periods.tenant_id; `period_id` uuid ! →app.timetable_periods.tenant_id; `day_of_week` text !; `subject` text !; `teacher_name` text !; `room` text

### `app.timetable_substitutions`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.timetable_slots.tenant_id; `slot_id` uuid ! →app.timetable_slots.tenant_id; `date` date !; `absent_teacher` text !; `substitute` text !; `reason` text; `status` text ! ='assigned'::text; `assigned_by` uuid →app.users.tenant_id; `created_at` timestamp with time zone ! =now()

### `app.transport_events`  ·  rows=1  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.routes.tenant_id; `route_id` uuid ! →app.routes.tenant_id; `kind` text !; `delay_mins` integer; `note` text; `occurred_at` timestamp with time zone ! =now()

### `app.users`  ·  rows=17  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.roles.tenant_id; `email` text !; `name` text !; `role` text !; `password_hash` text !; `pg_role` text ! ='schoolos_app'::text; `active` boolean ! =true; `created_at` timestamp with time zone ! =now(); `phone` text; `auth_provider` text ! ='password'::text; `force_change` boolean ! =false; `session_epoch` integer ! =1; `mfa_enrolled_at` timestamp with time zone; `role_key` text →app.roles.tenant_id

### `app.webhook_deliveries`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.webhook_subscriptions.tenant_id; `subscription_id` uuid ! →app.webhook_subscriptions.tenant_id; `event_id` uuid !; `topic` text !; `payload` jsonb ! ='{}'::jsonb; `status` text ! ='queued'::text; `attempts` integer ! =1; `last_error` text; `response_code` integer; `next_attempt_at` timestamp with time zone; `delivered_at` timestamp with time zone; `created_at` timestamp with time zone ! =now()

### `app.webhook_subscriptions`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.users.tenant_id; `url` text !; `events` ARRAY ! ='{}'::text[]; `sign_secret` text !; `active` boolean ! =true; `created_by` uuid →app.users.tenant_id; `created_at` timestamp with time zone ! =now()

### `app.wo_events`  ·  rows=4  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.work_orders.tenant_id; `wo_id` uuid ! →app.work_orders.tenant_id; `kind` text !; `note` text; `actor_id` uuid →app.users.tenant_id; `created_at` timestamp with time zone =now()

### `app.work_orders`  ·  rows=4  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.users.tenant_id; `code` text !; `title` text !; `description` text; `category` text !; `priority` text !; `status` text ! ='reported'::text; `asset_id` uuid →app.assets.tenant_id; `assigned_to` uuid →app.users.tenant_id; `reported_by` uuid →app.users.tenant_id; `sla_due_at` timestamp with time zone; `sla_breached` boolean ! =false; `cost_cents` bigint ! =0; `created_at` timestamp with time zone =now(); `resolved_at` timestamp with time zone

### `app.workflow_rules`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →app.users.tenant_id; `name` text !; `topic` text !; `condition` jsonb; `action` jsonb !; `enabled` boolean ! =true; `created_by` uuid →app.users.tenant_id; `created_at` timestamp with time zone ! =now()

## schema `auth` (6 tables)

### `auth.login_throttles`  ·  rows=0  ·  RLS=FORCE
  `user_id` uuid PK !; `failed_attempts` integer ! =0; `locked_until` timestamp with time zone; `last_failed_at` timestamp with time zone ! =now()

### `auth.mfa_challenges`  ·  rows=0  ·  RLS=FORCE
  `jti` text PK !; `user_id` uuid !; `tenant_id` uuid !; `attempts` integer ! =0; `expires_at` timestamp with time zone !; `consumed_at` timestamp with time zone; `created_at` timestamp with time zone ! =now()

### `auth.mfa_recovery_codes`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `user_id` uuid !; `tenant_id` uuid !; `code_hash` text !; `consumed_at` timestamp with time zone; `created_at` timestamp with time zone ! =now()

### `auth.mfa_secrets`  ·  rows=0  ·  RLS=FORCE
  `user_id` uuid PK !; `tenant_id` uuid !; `secret` text !; `enabled` boolean ! =false; `created_at` timestamp with time zone ! =now(); `last_totp_step` bigint

### `auth.reset_tokens`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `user_id` uuid !; `token_hash` text !; `expires_at` timestamp with time zone !; `consumed_at` timestamp with time zone; `created_at` timestamp with time zone ! =now()

### `auth.revoked_token`  ·  rows=0  ·  RLS=FORCE
  `jti` text PK !; `tenant_id` uuid; `revoked_at` timestamp with time zone ! =now(); `exp` timestamp with time zone !

## schema `coord` (1 tables)

### `coord.copilot_call`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `user_id` uuid !; `verb` text !; `budget_class` text ! ='coordinator_tier'::text; `tokens_in` integer ! =0; `tokens_out` integer ! =0; `sources` jsonb ! ='[]'::jsonb; `at` timestamp with time zone ! =now()

## schema `copilot` (1 tables)

### `copilot.call`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `user_id` uuid !; `verb` text !; `budget_class` text ! ='teacher_tier'::text; `tokens_in` integer ! =0; `tokens_out` integer ! =0; `sources` jsonb ! ='[]'::jsonb; `approved_action_id` uuid; `at` timestamp with time zone ! =now()

## schema `curriculum` (2 tables)

### `curriculum.node`  ·  rows=90  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →curriculum.node.tenant_id; `subject` text !; `grade` text !; `parent_id` uuid →curriculum.node.tenant_id; `kind` text !; `name` text !; `order_no` integer ! =0; `created_at` timestamp with time zone ! =now()

### `curriculum.progress`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →curriculum.node.tenant_id; `node_id` uuid ! →curriculum.node.tenant_id; `class_grade` text !; `covered_pct` integer !; `covered_by` uuid; `evidence_ref` text; `covered_at` timestamp with time zone ! =now(); `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

## schema `duty` (1 tables)

### `duty.assignment`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `teacher_id` uuid !; `kind` text !; `duty_date` date !; `period` text; `note` text; `allocated_by` uuid; `created_at` timestamp with time zone ! =now()

## schema `family` (4 tables)

### `family.child_link`  ·  rows=1  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `user_id` uuid !; `student_id` uuid !; `relation` text ! ='guardian'::text; `is_primary` boolean ! =true; `created_at` timestamp with time zone ! =now()

### `family.consent`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `student_id` uuid !; `kind` text !; `title` text !; `detail_ref` text; `due_at` timestamp with time zone; `status` text ! ='pending'::text; `decided_by` uuid; `decided_at` timestamp with time zone; `created_at` timestamp with time zone ! =now()

### `family.request`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `guardian_id` uuid !; `child_id` uuid; `category` text !; `title` text !; `payload` jsonb ! ='{}'::jsonb; `status` text ! ='submitted'::text; `owner_role` text; `sla_at` timestamp with time zone; `created_at` timestamp with time zone ! =now()

### `family.request_event`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →family.request.tenant_id; `request_id` uuid ! →family.request.tenant_id; `from_status` text; `to_status` text !; `note` text; `actor_id` uuid; `at` timestamp with time zone ! =now()

## schema `intervention` (2 tables)

### `intervention.plan`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `student_id` uuid !; `owner_id` uuid !; `objective` text !; `activity` text !; `target_end` date; `status` text ! ='identified'::text; `outcome` text; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

### `intervention.plan_event`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →intervention.plan.tenant_id; `plan_id` uuid ! →intervention.plan.tenant_id; `from_status` text; `to_status` text !; `note` text; `actor_id` uuid; `created_at` timestamp with time zone ! =now()

## schema `library` (2 tables)

### `library.book`  ·  rows=1  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `code` text !; `title` text !; `author` text; `category` text; `copies_total` integer !; `status` text ! ='available'::text; `created_by` uuid; `created_at` timestamp with time zone ! =now()

### `library.loan`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →library.book.tenant_id; `book_id` uuid ! →library.book.tenant_id; `student_id` uuid !; `issued_by` uuid; `issued_at` timestamp with time zone ! =now(); `due_on` date !; `returned_at` timestamp with time zone; `fine_cents` integer ! =0; `status` text ! ='issued'::text; `created_at` timestamp with time zone ! =now()

## schema `mastery` (2 tables)

### `mastery.evidence`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `student_id` uuid !; `subject` text !; `node_id` uuid; `kind` text !; `ref` text; `value` numeric; `observed_at` timestamp with time zone ! =now(); `expires_at` timestamp with time zone; `created_at` timestamp with time zone ! =now()

### `mastery.state`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `student_id` uuid !; `subject` text !; `node_id` uuid !; `level` text !; `confidence` text ! ='medium'::text; `derived_from` jsonb ! ='{}'::jsonb; `computed_at` timestamp with time zone ! =now(); `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

## schema `parent` (2 tables)

### `parent.brief_log`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `user_id` uuid !; `when_kind` text !; `payload` jsonb ! ='{}'::jsonb; `at` timestamp with time zone ! =now()

### `parent.copilot_call`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `user_id` uuid !; `verb` text !; `question` text; `answer_ref` text; `sources` jsonb ! ='[]'::jsonb; `budget_class` text ! ='P-copilot'::text; `at` timestamp with time zone ! =now()

## schema `plugin_admissions` (2 tables)

### `plugin_admissions.lead`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `student_name` text !; `guardian_name` text; `guardian_phone` text !; `class_applied` text !; `source` text ! ='walk-in'::text; `stage` text ! ='enquiry'::text; `notes` jsonb ! ='{}'::jsonb; `created_by` uuid; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

### `plugin_admissions.stage_history`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →plugin_admissions.lead.tenant_id; `lead_id` uuid ! →plugin_admissions.lead.tenant_id; `from_stage` text; `to_stage` text !; `actor` text !; `at` timestamp with time zone ! =now()

## schema `plugin_clinic` (2 tables)

### `plugin_clinic.sick_pass`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `visit_id` uuid !; `student_id` uuid !; `issued_at` timestamp with time zone ! =now(); `valid_until` timestamp with time zone !; `status` text ! ='active'::text; `issued_by` uuid; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

### `plugin_clinic.visit`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `student_id` uuid !; `visited_at` timestamp with time zone ! =now(); `complaint` text !; `temperature_c` numeric; `action` text ! ='first_aid'::text; `notes` text; `logged_by` uuid; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

## schema `plugin_dpdp` (3 tables)

### `plugin_dpdp.consent`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `subject_ref` text !; `subject_type` text ! ='guardian'::text; `purpose` text !; `decision` text !; `basis` text; `channel` text; `actor` text; `evidence` jsonb ! ='{}'::jsonb; `valid_from` timestamp with time zone ! =now(); `valid_until` timestamp with time zone; `created_at` timestamp with time zone ! =now()

### `plugin_dpdp.erasure_journal`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `subject_key` text !; `surrogate` text !; `surfaces` jsonb ! ='{}'::jsonb; `executed_by` text; `executed_at` timestamp with time zone ! =now(); `subject_token` jsonb; `replayed_at` timestamp with time zone

### `plugin_dpdp.sar`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `kind` text !; `subject_ref` text !; `status` text ! ='open'::text; `action_id` uuid; `sla_due_at` timestamp with time zone; `fulfilled_at` timestamp with time zone; `bundle` jsonb; `requested_by` text; `created_at` timestamp with time zone ! =now()

## schema `plugin_exams` (4 tables)

### `plugin_exams.exam`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `name` text !; `term` text ! ='term-1'::text; `class_grade` text !; `status` text ! ='draft'::text; `weightage` jsonb; `weightage_locked` boolean ! =false; `eligibility_min_pct` integer ! =75; `published_snapshot` jsonb; `digest` text; `action_id` uuid; `published_at` timestamp with time zone; `published_by` text; `created_by` uuid; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now(); `academic_year_id` uuid; `board_policy` jsonb

### `plugin_exams.mark`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →plugin_exams.exam.tenant_id; `exam_id` uuid ! →plugin_exams.exam.tenant_id; `student_id` uuid !; `component` text ! ='written'::text; `marks` numeric !; `max_marks` numeric ! =100; `entered_by` uuid; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

### `plugin_exams.moderation`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →plugin_exams.report.tenant_id; `report_id` uuid ! →plugin_exams.report.tenant_id; `reason` text !; `status` text ! ='proposed'::text; `adjusted_snapshot` jsonb; `proposed_by` uuid; `decided_by` text; `decided_at` timestamp with time zone; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

### `plugin_exams.report`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →plugin_exams.exam.tenant_id; `exam_id` uuid ! →plugin_exams.exam.tenant_id; `student_id` uuid !; `snapshot` jsonb !; `digest` text !; `created_at` timestamp with time zone ! =now()

## schema `plugin_hr` (1 tables)

### `plugin_hr.leave`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `staff_id` uuid !; `leave_date` date !; `kind` text !; `status` text ! ='marked'::text; `reason` text; `marked_by` uuid; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

## schema `plugin_razorpay` (2 tables)

### `plugin_razorpay.order_log`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `payment_id` uuid !; `razorpay_order_id` text !; `razorpay_payment_id` text; `status` text ! ='created'::text; `payload` jsonb ! ='{}'::jsonb; `created_at` timestamp with time zone ! =now()

### `plugin_razorpay.webhook_log`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `gateway` text ! ='razorpay'::text; `event_id` text !; `event_type` text !; `payload` jsonb ! ='{}'::jsonb; `signature_verified` boolean ! =true; `received_at` timestamp with time zone ! =now()

## schema `plugin_transport_gps` (1 tables)

### `plugin_transport_gps.positions`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `route_code` text !; `lat` double precision !; `lng` double precision !; `delay_mins` integer; `deviation_m` integer; `occurred_at` timestamp with time zone ! =now()

## schema `plugin_upi` (1 tables)

### `plugin_upi.webhook_log`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `gateway` text ! ='razorpay'::text; `event_id` text !; `event_type` text !; `payload` jsonb ! ='{}'::jsonb; `signature_verified` boolean ! =true; `received_at` timestamp with time zone ! =now()

## schema `plugin_visitors` (2 tables)

### `plugin_visitors.pickup_otp`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `visit_id` uuid !; `phone` text !; `code_hash` text !; `attempts` integer ! =0; `expires_at` timestamp with time zone !; `consumed_at` timestamp with time zone; `created_at` timestamp with time zone ! =now()

### `plugin_visitors.visit`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `visitor_name` text !; `visitor_phone` text; `purpose` text !; `detail` text; `student_ref` uuid; `status` text ! ='expected'::text; `badge_code` text !; `verified_at` timestamp with time zone; `otp_request_id` uuid; `otp_attempts` integer ! =0; `created_by` uuid; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

## schema `ptm` (2 tables)

### `ptm.booking`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →ptm.slot.tenant_id; `slot_id` uuid ! →ptm.slot.tenant_id; `student_id` uuid !; `guardian_id` uuid !; `booked_at` timestamp with time zone ! =now(); `created_at` timestamp with time zone ! =now()

### `ptm.slot`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `teacher_id` uuid !; `slot_date` date !; `start_time` text !; `end_time` text !; `status` text ! ='open'::text; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

## schema `safety` (1 tables)

### `safety.box`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `reporter_anonymous` boolean ! =true; `reporter_user_id` uuid; `class_grade` text !; `category` text !; `detail` text !; `severity` text !; `status` text ! ='submitted'::text; `assigned_to` uuid; `assigned_by` uuid; `page_action_id` uuid; `closed_at` timestamp with time zone; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

## schema `student` (5 tables)

### `student.flashcard`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `creator_user_id` uuid !; `student_id` uuid; `deck` text !; `front` text !; `back` text !; `subject` text; `topic` text; `created_at` timestamp with time zone ! =now()

### `student.mistake_note`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `creator_user_id` uuid !; `student_id` uuid; `subject` text !; `topic` text !; `what_wrong` text !; `correction` text !; `lesson` text; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

### `student.print_job`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `creator_user_id` uuid !; `student_id` uuid; `kind` text !; `payload` jsonb ! ='{}'::jsonb; `status` text ! ='queued'::text; `printed_by` uuid; `printed_at` timestamp with time zone; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

### `student.study_task`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `creator_user_id` uuid !; `student_id` uuid; `title` text !; `due_date` date; `done` boolean ! =false; `done_at` timestamp with time zone; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

### `student.wellbeing_request`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `creator_user_id` uuid; `student_id` uuid; `category` text !; `detail` text !; `anonymous` boolean ! =false; `status` text ! ='submitted'::text; `handled_by` uuid; `handled_at` timestamp with time zone; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

## schema `support` (2 tables)

### `support.doubt`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `asked_by` uuid !; `student_id` uuid; `subject` text !; `topic` text; `question` text !; `status` text ! ='routed'::text; `routed_to` uuid; `routed_reason` text; `answered_by` uuid; `answer` text; `answered_at` timestamp with time zone; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

### `support.faq`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →support.doubt.tenant_id; `subject` text !; `topic` text; `question` text !; `answer` text !; `source_doubt_id` uuid ! →support.doubt.tenant_id; `promoted_by` uuid; `created_at` timestamp with time zone ! =now()

## schema `teacher` (7 tables)

### `teacher.concern`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `student_id` uuid; `filed_by` uuid !; `category` text !; `urgency` text ! ='normal'::text; `detail` text !; `evidence_ref` text; `status` text ! ='open'::text; `routed_to` uuid; `routed_role` text; `routed_by` uuid; `outcome` text; `outcome_note` text; `closed_at` timestamp with time zone; `created_at` timestamp with time zone ! =now(); `updated_at` timestamp with time zone ! =now()

### `teacher.concern_status_event`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid ! →teacher.concern.tenant_id; `concern_id` uuid ! →teacher.concern.tenant_id; `from_status` text; `to_status` text !; `note` text; `actor_id` uuid; `created_at` timestamp with time zone ! =now()

### `teacher.homework`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid; `class_grade` text; `subject` text; `title` text; `detail` text; `attachment_ref` text; `due_at` timestamp with time zone; `created_by` uuid; `status` text ='open'::text; `created_at` timestamp with time zone =now()

### `teacher.leave_request`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `teacher_id` uuid !; `kind` text !; `from_date` date !; `to_date` date !; `reason` text !; `status` text ! ='pending'::text; `decided_by` uuid; `decided_at` timestamp with time zone; `note` text; `created_at` timestamp with time zone ! =now()

### `teacher.note`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid !; `teacher_id` uuid !; `booking_id` uuid; `student_id` uuid; `note` text !; `created_at` timestamp with time zone ! =now()

### `teacher.submission`  ·  rows=0  ·  RLS=FORCE
  `id` uuid PK !; `tenant_id` uuid; `homework_id` uuid; `student_id` uuid; `content_type` text ='text'::text; `content` text; `status` text ='submitted'::text; `grade` text; `feedback` text; `submitted_at` timestamp with time zone =now(); `reviewed_by` uuid; `reviewed_at` timestamp with time zone

### `teacher.submission_needs_linking`  ·  rows=0  ·  RLS=FORCE
  `submission_id` uuid PK !; `tenant_id` uuid !; `homework_id` uuid !; `prior_student_id` uuid; `prior_user_name` text; `content_type` text; `content` text; `status` text; `grade` text; `feedback` text; `submitted_at` timestamp with time zone; `reviewed_by` uuid; `reviewed_at` timestamp with time zone; `reason` text !; `moved_at` timestamp with time zone ! =now()

---

# Catalogue E — The plugin catalogue


> Extracted from each `server/src/plugins/<id>/manifest.js`. Class A–E per docs/11; `money` = declares money movement; `caps` = kernel capabilities it provides; `perms` = declared permission ceiling; `deps` = machine-readable dependencies.

| id | class | ver | default on | money | capabilities | permissions | depends | settings keys |
|---|---|---|---|---|---|---|---|---|
| `accounting.tally` | B | 1.0.0 | — | — | fees.accounting.export | fees.read, events.emit, audit.request | — | tally_url, company_name, export_hour, ledger_mapping |
| `admissions.funnel` | C | 1.2.1 | — | — | — | events.emit, audit.request | — | default_source, enrollment_term, admission_year, cycle_start, cycle_end |
| `comms.whatsapp` | B | 1.0.0 | — | — | comms.whatsapp.templates | students.read, attendance.read, fees.read, comms.send, events.emit, audit.request | — | bsp_provider, sender_id, dlt_entity_id, dlt_template_ids, pay_button_template, quiet_hours |
| `coord.view` | C | 1.0.0 | no | — | — | users.read, students.read, events.emit, audit.request | — | copilot_monthly_cap |
| `exams.assessment` | D | 1.0.1 | — | — | — | students.read, attendance.read, events.emit, audit.request | — | grade_scale, report_card_template |
| `family.view` | C | 1.0.0 | no | — | — | students.read, events.emit, audit.request | — | — |
| `files.store` | B | 1.0.0 | — | — | — | students.read, files.write, events.emit, audit.request | — | — |
| `health.clinic` | C | 1.0.0 | no | — | — | students.read, events.emit, audit.request | — | notify_on_sent_home, notify_on_referral, sick_pass_ttl_hours |
| `hr.leave` | C | 1.0.0 | no | — | — | users.read, events.emit, audit.request | — | absence_feed_contract |
| `library` | C | 1.0.0 | — | — | — | students.read, events.emit, audit.request | — | fine_per_day_cents |
| `ops.bi` | B | 1.0.0 | — | — | — | students.read, fees.read, events.emit, audit.request | — | cache_seconds |
| `ops.import` | B | 1.0.0 | — | — | — | students.read, events.emit, audit.request | — | max_shadow_rows |
| `ops.timetable` | C | 1.0.0 | — | — | — | students.read, attendance.write, events.emit, audit.request | — | working_days, autofill_default, absence_feed |
| `ops.udise` | B | 1.0.0 | — | — | — | students.read, events.emit, audit.request | — | udise_code, school_name, school_type |
| `ops.visitors` | C | 1.0.2 | — | — | — | students.read, events.emit, audit.request | — | pickup_otp_ttl_minutes, pickup_otp_max_attempts |
| `pack.cbse` | C | 1.0.0 | — | — | — | students.read, attendance.read, events.emit, audit.request | exams.assessment@1.0.1 | affiliation_no, academic_year, board, report_card_template, weightage_strict |
| `pack.dpdp` | C | 1.1.1 | — | — | — | students.read, actions.raise, events.emit, audit.request | — | consent_validity_days, dsr_sla_days |
| `parent.assistant` | C | 1.0.0 | no | — | — | students.read, events.emit, audit.request | — | deterministic_v0 |
| `payments.razorpay` | B | 1.0.0 | — | — | fees.razorpay.gateway | fees.read, events.emit, audit.request | — | key_id, key_secret, webhook_secret, webhook_freshness_mins |
| `payments.upi` | B | 1.0.0 | — | — | fees.upi.gateway | fees.read, events.emit, audit.request | — | gateway, webhook_secret_configured, default_vpa, webhook_freshness_mins |
| `people.admin` | B | 1.0.0 | — | — | — | users.write, students.write, events.emit, audit.request | — | — |
| `rails.email` | B | 1.0.0 | — | — | auth.password_reset, comms.email.delivery | comms.send, events.emit, audit.request | — | provider, host, port, secure, username, password, from_address, reject_unauthorized |
| `rails.sms` | B | 1.0.0 | — | — | auth.otp, comms.sms.delivery | comms.send, events.emit, audit.request | — | provider, url, auth_header_name, auth_header_value, sender_header_name, sender_header_value |
| `rails.whatsapp` | B | 1.0.0 | — | — | comms.whatsapp.delivery | comms.send, events.emit, audit.request | comms.whatsapp.templates capability (optional — degrades to logger) | provider, url, auth_header_name, auth_header_value, sender_header_name, sender_header_value, phone_number_id, access_token, api_version |
| `student.world` | C | 1.0.0 | no | — | — | students.read, events.emit, audit.request | — | student_idle_timeout_minutes |
| `teacher.classroom` | C | 1.0.0 | no | — | — | students.read, events.emit, audit.request | — | — |
| `teacher.copilot` | C | 0.1.0 | no | — | — | students.read, users.read, audit.request | — | deterministic_v0 |
| `teacher.support` | C | 1.0.0 | no | — | — | students.read, users.read, events.emit, audit.request | — | escalate_on_critical, page_on_serious |
| `transport.gps` | B | 1.0.0 | — | — | transport.gps.ingest | students.read, events.emit, actions.raise, audit.request | — | vendor, delay_guard_mins, position_retention_days |

## Descriptions, events and settings

### `accounting.tally` — class B v1.0.0
- Tally reconciliation rails: daily voucher export from the kernel fee ledger, ledger-mapping settings, Tally-importable output. Read-only on money — the ledger is kernel-owned; the plugin exports, it never posts.
- publishes: tally.export.completed
- subscribes: payment.captured
- settings: tally_url, company_name, export_hour, ledger_mapping

### `admissions.funnel` — class C v1.2.1
- Admission inquiry-to-enrollment funnel: lead capture, enforced stage lattice (inquiry → applied → interview → offer → enrolled, side exits rejected/withdrawn), stage history trail, PII-masked teacher surfaces. Applicant/guardian PII stays in plugin_admissions 
- publishes: —
- subscribes: —
- settings: default_source, enrollment_term, admission_year, cycle_start, cycle_end

### `comms.whatsapp` — class B v1.0.0
- WhatsApp BSP rail beneath the kernel Communication Orchestrator: DLT template registry, receipt surface. Headless by rule (docs/11 §2.3) — delivers approved orchestrator intents only, never sends directly.
- publishes: whatsapp.receipt
- subscribes: attendance.marked, fee.due, transport.delay
- settings: bsp_provider, sender_id, dlt_entity_id, dlt_template_ids, pay_button_template, quiet_hours

### `coord.view` — class C v1.0.0
- The coordinator execution plane: staffing today (absences, periods affected), substitution gaps on the timetable grid, open kernel approvals owned by the coordinator role (decide door with proposer≠decider SoD), curriculum pace vs term expectation (weeks_behin
- publishes: coord.home.v1, coord.decision.v1, sub.assign.v1, duty.assigned.v1
- subscribes: —
- settings: copilot_monthly_cap

### `exams.assessment` — class D v1.0.1
- Examination primitives: marks entry, deterministic report-card assembly, publication via the kernel approval spine. Marks freeze read-only at publication; nothing guardian-visible before approval.
- publishes: —
- subscribes: —
- settings: grade_scale, report_card_template

### `family.view` — class C v1.0.0
- The parent read-plane: per-child home aggregation (attendance, assignments, exams, timeline), the unified request center with append-only ticket statuses, immutable event consents, child leave requests via per-instance kernel actions, and the report-discrepanc
- publishes: family.request.v1, family.consent.v1, child.leave.requested.v1
- subscribes: —
- settings: —

### `files.store` — class B v1.0.0
- Private file storage: uploads are validated (5MB cap, mime whitelist PDF/PNG/JPEG/WebP/CSV/DOCX with extension agreement, sha256 integrity digest) and stored under the server-owned FILES_DIR tree — never web-served. Every read flows through the download door: 
- publishes: —
- subscribes: —
- settings: —

### `health.clinic` — class C v1.0.0
- Infirmary log, sick passes and guardian health notices. Visits are append-first (corrections append); sent-home and hospital-referral outcomes raise a per-instance kernel approval action (clinic.notify.<visitId>) executed by the decide handler onto the comms r
- publishes: clinic.visit.logged.v1, clinic.sick_pass.issued.v1
- subscribes: —
- settings: notify_on_sent_home, notify_on_referral, sick_pass_ttl_hours

### `hr.leave` — class C v1.0.0
- Staff leave marking and the daily duty roster. Emits staff.leave.marked.v1 / staff.leave.cancelled.v1 — the absence facts consumed by ops.timetable when its absence_feed setting is set to hr.leave (021 contract). No communication rail use — absence is a fact, 
- publishes: staff.leave.marked.v1, staff.leave.cancelled.v1
- subscribes: —
- settings: absence_feed_contract

### `library` — class C v1.0.0
- The school library desk: catalog with per-title copy counts, issue/return against active students, availability derived from open loans (never stored), overdue fines computed at return (days_overdue × fine_per_day_cents, default ₹5/day) and an overdue chase li
- publishes: —
- subscribes: —
- settings: fine_per_day_cents

### `ops.bi` — class B v1.0.0
- School-level insight over real records, aggregates only: attendance percentage by class (windowed, per-student drill for staff), fee aging buckets by term, admissions funnel conversion and stage aging, homework completion by class. Read models are 60s-cached a
- publishes: —
- subscribes: —
- settings: cache_seconds

### `ops.import` — class B v1.0.0
- Column-mapping validator, row-level error collection, shadow-load (staged analysis, zero domain writes) and dry-run diff summaries for school-data imports (students, guardians, fees). The engine is importable by the kernel migration doors; commit authority sta
- publishes: ops.import.shadow.completed
- subscribes: —
- settings: max_shadow_rows

### `ops.timetable` — class C v1.0.0
- Period grid, class-section slots, daily substitutions (deterministic suggester), and attendance period-autofill primitives consumed by attendance/exams/comms. Substitution assignment is audited; ranking is a rule, never a model.
- publishes: substitution.assigned, attendance.autofilled
- subscribes: —
- settings: working_days, autofill_default, absence_feed

### `ops.udise` — class B v1.0.0
- Deterministic UDISE+-style statistical export from real school records: on-roll enrollment by class × section × gender bucket, staff by role, infrastructure by category and status. Aggregates only — never names, never PII. The gender split is honest about what
- publishes: udise.export.completed
- subscribes: —
- settings: udise_code, school_name, school_type

### `ops.visitors` — class C v1.0.2
- Campus gate pass with guardian-verified student pickup. Front desk logs visitors, issues badges; student pickup raises an OTP to the primary guardian (kernel OTP-vault pattern, scrypt-hashed, TTL + attempt-bounded); release is fail-closed without verification.
- publishes: —
- subscribes: —
- settings: pickup_otp_ttl_minutes, pickup_otp_max_attempts

### `pack.cbse` — class C v1.0.0
- CBSE policy pack — deterministic validation primitives over exams.assessment data (weightage totals, board attendance norm, report integrity) and OASIS-ready export. Stateless: no own writes; validation/exports audited through the kernel ledger.
- publishes: —
- subscribes: —
- settings: affiliation_no, academic_year, board, report_card_template, weightage_strict

### `pack.dpdp` — class C v1.1.1
- DPDP Act 2023 compliance pack: immutable consent ledger, SAR (export/erasure) workflow through the kernel action spine, retention schedule hooks. Data-residency IN.
- publishes: —
- subscribes: —
- settings: consent_validity_days, dsr_sla_days

### `parent.assistant` — class C v1.0.0
- The parent assistant: morning/evening/week brief per child (attendance today, homework due in the next 24h when the homework lane is connected, pending consents, exams announced in the last 7 days, open requests, weekly attendance share and published reports),
- publishes: —
- subscribes: —
- settings: deterministic_v0

### `payments.razorpay` — class B v1.0.0
- Razorpay order rails for fee collection: gateway orders against open fee obligations (REST, Basic auth) + signed-webhook facts in plugin_razorpay.order_log. Money-touching: never auto-moves money — orders and webhook facts only; settlement confirm is staff-onl
- publishes: razorpay.order.created, payment.captured, payment.failed
- subscribes: fee.due
- settings: key_id, key_secret, webhook_secret, webhook_freshness_mins

### `payments.upi` — class B v1.0.0
- UPI payment links + signed gateway webhook facts. Settlement stays kernel-only (staff confirm on /fees/payments/:id/confirm, Fees §4.2); the rail never moves money.
- publishes: payment.link.created, payment.captured, payment.failed
- subscribes: fee.due
- settings: gateway, webhook_secret_configured, default_vpa, webhook_freshness_mins

### `people.admin` — class B v1.0.0
- Identity & roster administration: user provisioning for every role except owner (scrypt credentials, optional parent child-link), suspend/activate (suspension makes the kernel live-row check refuse the account), forced-change temporary passwords, the student c
- publishes: —
- subscribes: —
- settings: —

### `rails.email` — class B v1.0.0
- EMAIL rail beneath the kernel Communication Orchestrator: settings-driven, dedup-keyed. provider=logger (default, sandbox) logs a structured line and reports ok — sandbox-verified until SMTP credentials exist (D-26). provider=smtp speaks a minimal raw SMTP cli
- publishes: email.sent, email.failed
- subscribes: sar.requested, fee.due
- settings: provider, host, port, secure, username, password, from_address, reject_unauthorized

### `rails.sms` — class B v1.0.0
- SMS rail beneath the kernel Communication Orchestrator: settings-driven, E.164 recipients, dedup-keyed. provider=logger (default) logs a structured line and reports ok; provider=http-generic POSTs to a settings URL with a settings auth header — generic, no ven
- publishes: sms.sent, sms.failed
- subscribes: attendance.marked, fee.due, transport.delay
- settings: provider, url, auth_header_name, auth_header_value, sender_header_name, sender_header_value

### `rails.whatsapp` — class B v1.0.0
- WhatsApp dispatch rail beneath the kernel Communication Orchestrator: reuses the comms.whatsapp DLT template registry (settings → templates), E.164 recipients, dedup-keyed. provider=logger (default, sandbox) logs a structured line and reports ok; provider=http
- publishes: whatsapp.sent, whatsapp.failed
- subscribes: attendance.marked, fee.due, transport.delay
- settings: provider, url, auth_header_name, auth_header_value, sender_header_name, sender_header_value, phone_number_id, access_token, api_version

### `student.world` — class C v1.0.0
- The student world on school computers/kiosks (no personal phones): own home view (next class from the timetable grid + current IST period, today counts, upcoming test, needs-attention, progress directions, bag-for-tomorrow), homework split digital/paper (paper
- publishes: student.home.v1, student.print.v1, student.wellbeing.v1
- subscribes: —
- settings: student_idle_timeout_minutes

### `teacher.classroom` — class C v1.0.0
- The teacher classroom lane: post homework per class and subject with due dates, one-shot student submissions (text or link) with automatic late detection, the assigning-teacher-only review desk (reviewed / graded / resubmit_requested with grade and feedback), 
- publishes: homework.v1, submission.v1, staff.leave.requested.v1
- subscribes: —
- settings: —

### `teacher.copilot` — class C v0.1.0
- Teacher day brief (eod/week), curriculum tree with audited coverage check-off, mastery maps with A3 evidence decay, and Copilot ask/draft. V0 is deterministic-only: no external AI model is contacted anywhere — drafts are clearly labelled templates built from c
- publishes: —
- subscribes: —
- settings: deterministic_v0

### `teacher.support` — class C v1.0.0
- One-tap concerns with append-only status events and coordinator routing (counselor/principal designees), the anonymous student safety box (reporter identity never stored for anonymous reports; serious severity raises the per-instance kernel page safety.page.<b
- publishes: concern.filed, concern.routed, concern.closed, safety.report.filed, safety.page.raised, doubt.routed, doubt.answered, doubt.faq.promoted, intervention.status.changed, ptm.slot.published, ptm.booked
- subscribes: —
- settings: escalate_on_critical, page_on_serious

### `transport.gps` — class B v1.0.0
- Vendor GPS position ingestion with deterministic guardian-notice guard (delay ≥ 10 min → approval-required action, Transport §3.1). Positions retained 30 days; approval before any send.
- publishes: gps.position
- subscribes: —
- settings: vendor, delay_guard_mins, position_retention_days

---

# Catalogue F — The route index (267 routes)


> Generated by `server/scripts/permission-matrix.js` — do not edit by hand.
> Gate: every route is role-gated, auth-only, or on the reviewed PUBLIC_ALLOWLIST.
> Counts: 267 routes · 222 role-gated · 32 auth-only · 13 public · 0 unguarded.

| Verb | Path | Guard | Roles | Plugin gate | File |
|---|---|---|---|---|---|
| GET | `/health` | public | — | — | src/app.js |
| GET | `/ready` | public | — | — | src/app.js |
| POST | `/auth/login` | public | — | — | src/app.js |
| POST | `/auth/renew` | auth | — | — | src/app.js |
| POST | `/auth/otp/request` | public | — | — | src/app.js |
| POST | `/auth/otp/verify` | public | — | — | src/app.js |
| GET | `/auth/google/start` | public | — | — | src/app.js |
| GET | `/auth/google/callback` | public | — | — | src/app.js |
| POST | `/auth/google/demo` | public | — | — | src/app.js |
| POST | `/auth/logout` | auth | — | — | src/app.js |
| GET | `/me/tenants` | auth | — | — | src/app.js |
| POST | `/me/switch` | auth | — | — | src/app.js |
| POST | `/me/password` | auth | — | — | src/app.js |
| POST | `/me/reset-request` | public | — | — | src/app.js |
| POST | `/me/reset-confirm` | public | — | — | src/app.js |
| POST | `/me/mfa/enroll` | auth | — | — | src/app.js |
| POST | `/me/mfa/disable` | auth | — | — | src/app.js |
| POST | `/me/mfa/verify` | public | — | — | src/app.js |
| POST | `/api-keys` | auth | — | — | src/app.js |
| GET | `/api-keys` | auth | — | — | src/app.js |
| DELETE | `/api-keys/:id` | auth | — | — | src/app.js |
| POST | `/webhooks` | auth | — | — | src/app.js |
| GET | `/webhooks` | auth | — | — | src/app.js |
| DELETE | `/webhooks/:id` | auth | — | — | src/app.js |
| GET | `/dataset` | auth | — | — | src/app.js |
| GET | `/capabilities` | auth | — | — | src/app.js |
| POST | `/ai/call` | auth | — | — | src/app.js |
| GET | `/ai/calls` | role-gated | owner, itadmin | — | src/app.js |
| POST | `/ai/eval` | role-gated | owner, itadmin | — | src/app.js |
| GET | `/workflow-rules` | role-gated | owner, itadmin | — | src/app.js |
| POST | `/workflow-rules` | role-gated | owner, itadmin | — | src/app.js |
| DELETE | `/workflow-rules/:id` | role-gated | owner, itadmin | — | src/app.js |
| GET | `/metrics` | role-gated | owner, itadmin | — | src/app.js |
| GET | `/me` | auth | — | — | src/routes.js |
| GET | `/me/effective` | auth | — | — | src/routes.js |
| GET | `/roles` | role-gated | owner, itadmin | — | src/routes.js |
| POST | `/roles` | role-gated | owner, itadmin | — | src/routes.js |
| PATCH | `/roles/:key` | role-gated | owner, itadmin | — | src/routes.js |
| DELETE | `/roles/:key` | role-gated | owner, itadmin | — | src/routes.js |
| POST | `/roles/:key/assign` | role-gated | owner, itadmin | — | src/routes.js |
| POST | `/roles/:key/unassign` | role-gated | owner, itadmin | — | src/routes.js |
| GET | `/students` | auth | — | — | src/routes.js |
| GET | `/students/:id` | role-gated | id | — | src/routes.js |
| POST | `/students` | role-gated | owner, principal, coordinator, admissions | — | src/routes.js |
| GET | `/attendance` | auth | — | — | src/routes.js |
| POST | `/attendance/mark` | role-gated | owner, principal, coordinator, teacher | — | src/routes.js |
| GET | `/class-assignments` | auth | — | — | src/routes.js |
| POST | `/class-assignments` | role-gated | owner, principal, coordinator | — | src/routes.js |
| DELETE | `/class-assignments/:id` | role-gated | owner, principal, coordinator, id | — | src/routes.js |
| GET | `/academic-years` | auth | — | — | src/routes.js |
| POST | `/academic-years` | role-gated | owner, principal, finance | — | src/routes.js |
| POST | `/academic-years/:id/activate` | role-gated | owner, principal, id | — | src/routes.js |
| GET | `/fee-plans` | auth | — | — | src/routes.js |
| POST | `/fee-plans` | role-gated | owner, principal, finance | — | src/routes.js |
| POST | `/fee-plans/:id/generate` | role-gated | owner, principal, finance, id | — | src/routes.js |
| POST | `/fees/obligations/:id/void` | role-gated | owner, id | — | src/routes.js |
| GET | `/fees/obligations` | role-gated | owner, principal, itadmin, finance, coordinator, parent | — | src/routes.js |
| POST | `/fees/payments` | role-gated | parent, finance, owner, principal | — | src/routes.js |
| POST | `/fees/payments/:id/confirm` | role-gated | finance, owner, id | — | src/routes.js |
| GET | `/transport/routes` | auth | — | — | src/routes.js |
| POST | `/transport/events` | role-gated | transport, coordinator, principal, facilities, owner | — | src/routes.js |
| GET | `/work-orders` | role-gated | principal, owner, itadmin, finance, coordinator, facilities, technician, transport, teacher | — | src/routes.js |
| POST | `/work-orders` | role-gated | teacher, facilities, technician, coordinator, principal, owner | — | src/routes.js |
| POST | `/work-orders/:id/status` | role-gated | technician, facilities, coordinator, principal, owner, id | — | src/routes.js |
| GET | `/assets` | auth | — | — | src/routes.js |
| GET | `/cases` | role-gated | owner, principal, itadmin, coordinator, teacher, finance | — | src/routes.js |
| GET | `/my-cases` | auth | — | — | src/routes.js |
| POST | `/cases` | auth | — | — | src/routes.js |
| POST | `/cases/:id/status` | role-gated | id | — | src/routes.js |
| GET | `/actions` | role-gated | owner, principal, itadmin, finance, coordinator, teacher, admissions, transport, facilities, technician | — | src/routes.js |
| POST | `/actions/:id/decide` | role-gated | owner, principal, itadmin, finance, coordinator, teacher, admissions, transport, facilities, technician | — | src/routes.js |
| POST | `/payments/:id/refund` | role-gated | owner, finance, id | — | src/routes.js |
| POST | `/payments/reconcile` | role-gated | owner, finance | — | src/routes.js |
| POST | `/fees/dunning/run` | role-gated | owner, finance | — | src/routes.js |
| POST | `/timetable/clash-check` | role-gated | owner, principal, coordinator, itadmin | — | src/routes.js |
| POST | `/exams/:id/board-policy` | role-gated | owner, principal, itadmin, id | — | src/routes.js |
| GET | `/exams/:id/board-policy` | role-gated | id | — | src/routes.js |
| GET | `/admissions/followups` | auth | — | — | src/routes.js |
| GET | `/reports/fees/summary` | role-gated | owner, principal, coordinator, finance, itadmin | — | src/routes.js |
| GET | `/events` | role-gated | owner, principal, itadmin, finance, coordinator, teacher, admissions, transport, facilities, technician | — | src/routes.js |
| GET | `/notifications` | auth | — | — | src/routes.js |
| POST | `/notifications/read` | auth | — | — | src/routes.js |
| GET | `/communications` | role-gated | owner, principal, coordinator, finance, itadmin, transport | — | src/routes.js |
| GET | `/audit` | role-gated | owner, principal, itadmin, finance | — | src/routes.js |
| GET | `/audit/verify` | role-gated | owner, itadmin | — | src/routes.js |
| GET | `/memory` | role-gated | owner, principal, itadmin | — | src/routes.js |
| POST | `/memory` | role-gated | owner, principal, coordinator, finance | — | src/routes.js |
| GET | `/events/lineage` | role-gated | owner, principal, itadmin, finance, coordinator, teacher, admissions, transport, facilities, technician | — | src/routes.js |
| GET | `/plugins` | auth | — | — | src/routes.js |
| POST | `/plugins/:id/enable` | role-gated | owner, itadmin | — | src/routes.js |
| POST | `/plugins/:id/disable` | role-gated | owner, itadmin | — | src/routes.js |
| POST | `/plugins/:id/settings` | role-gated | owner, itadmin | — | src/routes.js |
| GET | `/migration/sources` | auth | — | — | src/routes.js |
| POST | `/migration/sources` | role-gated | owner, coordinator, itadmin | — | src/routes.js |
| POST | `/migration/sources/:id/stage` | role-gated | owner, coordinator, itadmin | — | src/routes.js |
| POST | `/migration/sources/:id/stage-rows` | role-gated | owner, coordinator, itadmin | — | src/routes.js |
| POST | `/migration/sources/:id/validate` | role-gated | owner, coordinator, itadmin | — | src/routes.js |
| POST | `/migration/sources/:id/commit` | role-gated | owner, coordinator, itadmin | — | src/routes.js |
| POST | `/migration/activate` | role-gated | owner, principal | — | src/routes.js |
| GET | `/plugins/accounting.tally/daybook` | role-gated | owner, itadmin, finance | yes | src/plugins/accounting.tally/index.js |
| POST | `/plugins/accounting.tally/export` | role-gated | owner, itadmin, finance | yes | src/plugins/accounting.tally/index.js |
| GET | `/plugins/accounting.tally/exports` | role-gated | owner, itadmin, finance | yes | src/plugins/accounting.tally/index.js |
| POST | `/plugins/admissions.funnel/leads` | role-gated | owner, principal, itadmin, finance, coordinator | yes | src/plugins/admissions.funnel/index.js |
| GET | `/plugins/admissions.funnel/leads` | role-gated | teacher, owner, principal, itadmin, finance, coordinator | yes | src/plugins/admissions.funnel/index.js |
| POST | `/plugins/admissions.funnel/leads/:id/stage` | role-gated | id, owner, principal, itadmin, finance, coordinator | yes | src/plugins/admissions.funnel/index.js |
| GET | `/plugins/admissions.funnel/leads/:id/history` | role-gated | id, owner, principal, itadmin, finance, coordinator | yes | src/plugins/admissions.funnel/index.js |
| GET | `/plugins/admissions.funnel/summary` | role-gated | owner, principal, itadmin, finance, coordinator | yes | src/plugins/admissions.funnel/index.js |
| POST | `/plugins/comms.whatsapp/templates` | role-gated | owner, itadmin | yes | src/plugins/comms.whatsapp/index.js |
| GET | `/plugins/comms.whatsapp/templates` | role-gated | owner, itadmin, principal, coordinator, transport, finance | yes | src/plugins/comms.whatsapp/index.js |
| GET | `/plugins/comms.whatsapp/receipts` | role-gated | owner, itadmin, principal, coordinator, transport, finance | yes | src/plugins/comms.whatsapp/index.js |
| GET | `/coord/home` | role-gated | coordinator, principal | yes | src/plugins/coord.view/index.js |
| GET | `/coord/curriculum-monitor` | role-gated | coordinator, principal | yes | src/plugins/coord.view/index.js |
| GET | `/coord/teacher-workload` | role-gated | coordinator, principal | yes | src/plugins/coord.view/index.js |
| POST | `/coord/substitution/decide` | role-gated | coordinator, principal | yes | src/plugins/coord.view/index.js |
| POST | `/coord/duty/allocate` | role-gated | coordinator, principal | yes | src/plugins/coord.view/index.js |
| GET | `/coord/escalations` | role-gated | coordinator, principal | yes | src/plugins/coord.view/index.js |
| POST | `/coord/copilot-lite` | role-gated | coordinator, principal | yes | src/plugins/coord.view/index.js |
| POST | `/plugins/exams.assessment/exams` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/exams.assessment/index.js |
| GET | `/plugins/exams.assessment/exams` | role-gated | owner, principal, itadmin, teacher, coordinator | yes | src/plugins/exams.assessment/index.js |
| POST | `/plugins/exams.assessment/exams/:id/marks` | role-gated | id, owner, principal, itadmin, teacher, coordinator | yes | src/plugins/exams.assessment/index.js |
| POST | `/plugins/exams.assessment/exams/:id/publish` | role-gated | id, owner, principal, itadmin, coordinator | yes | src/plugins/exams.assessment/index.js |
| POST | `/plugins/exams.assessment/exams/:id/publish/execute` | role-gated | id, owner, principal, itadmin, coordinator | yes | src/plugins/exams.assessment/index.js |
| GET | `/plugins/exams.assessment/exams/:id/reports/:studentId` | role-gated | id, owner, principal, itadmin, teacher, coordinator | yes | src/plugins/exams.assessment/index.js |
| POST | `/plugins/exams.assessment/exams/:id/reports/:studentId/moderate` | role-gated | id, owner, principal, itadmin, coordinator | yes | src/plugins/exams.assessment/index.js |
| POST | `/plugins/exams.assessment/moderations/:mid/decide` | role-gated | mid, owner, principal, itadmin, coordinator | yes | src/plugins/exams.assessment/index.js |
| POST | `/plugins/exams.assessment/exams/:id/marks/bulk` | role-gated | id, owner, principal, itadmin, teacher, coordinator | yes | src/plugins/exams.assessment/index.js |
| GET | `/plugins/exams.assessment/board-policy` | role-gated | owner, principal, itadmin, teacher, coordinator | yes | src/plugins/exams.assessment/index.js |
| PUT | `/plugins/exams.assessment/board-policy` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/exams.assessment/index.js |
| POST | `/plugins/exams.assessment/exams/:id/recompute` | role-gated | id, owner, principal, itadmin, coordinator | yes | src/plugins/exams.assessment/index.js |
| GET | `/plugins/exams.assessment/moderations` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/exams.assessment/index.js |
| GET | `/parent/home` | role-gated | parent | yes | src/plugins/family.view/index.js |
| GET | `/parent/child/:id/timeline` | role-gated | id, parent | yes | src/plugins/family.view/index.js |
| GET | `/parent/child/:id/academics` | role-gated | id, parent | yes | src/plugins/family.view/index.js |
| GET | `/parent/child/:id/attendance` | role-gated | id, parent | yes | src/plugins/family.view/index.js |
| GET | `/parent/child/:id/exams` | role-gated | id, parent | yes | src/plugins/family.view/index.js |
| GET | `/parent/consents` | role-gated | parent | yes | src/plugins/family.view/index.js |
| POST | `/parent/consents/:id/decide` | role-gated | id, parent | yes | src/plugins/family.view/index.js |
| POST | `/parent/requests` | role-gated | parent | yes | src/plugins/family.view/index.js |
| GET | `/parent/requests` | role-gated | parent | yes | src/plugins/family.view/index.js |
| POST | `/parent/report-discrepancy` | role-gated | parent | yes | src/plugins/family.view/index.js |
| POST | `/parent/leave-request` | role-gated | parent | yes | src/plugins/family.view/index.js |
| POST | `/plugins/files.store/upload` | role-gated | owner, principal, coordinator, teacher, itadmin, facilities | yes | src/plugins/files.store/index.js |
| GET | `/plugins/files.store/:id/download` | role-gated | parent, student, id, owner, principal, coordinator, teacher, itadmin, facilities | yes | src/plugins/files.store/index.js |
| GET | `/plugins/files.store` | role-gated | owner, principal, coordinator, teacher, itadmin, facilities | yes | src/plugins/files.store/index.js |
| POST | `/plugins/health.clinic/visits` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/health.clinic/index.js |
| POST | `/plugins/health.clinic/visits/:id/correct` | role-gated | id, owner, principal, itadmin, coordinator | yes | src/plugins/health.clinic/index.js |
| POST | `/plugins/health.clinic/visits/:id/sick-pass` | role-gated | id, owner, principal, itadmin, coordinator | yes | src/plugins/health.clinic/index.js |
| GET | `/plugins/health.clinic/visits` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/health.clinic/index.js |
| POST | `/plugins/health.clinic/sick-passes/:id/revoke` | role-gated | owner, principal, itadmin, id | yes | src/plugins/health.clinic/index.js |
| POST | `/plugins/hr.leave/leave` | role-gated | owner, principal, itadmin | yes | src/plugins/hr.leave/index.js |
| POST | `/plugins/hr.leave/leave/:id/cancel` | role-gated | id, owner, principal, itadmin | yes | src/plugins/hr.leave/index.js |
| GET | `/plugins/hr.leave/roster/:date` | role-gated | owner, principal, itadmin, coordinator, teacher | yes | src/plugins/hr.leave/index.js |
| GET | `/plugins/hr.leave/leave` | role-gated | owner, principal, itadmin, coordinator, teacher | yes | src/plugins/hr.leave/index.js |
| POST | `/plugins/library/books` | role-gated | owner, principal, coordinator, facilities | yes | src/plugins/library/index.js |
| GET | `/plugins/library/books` | role-gated | owner, principal, coordinator, facilities | yes | src/plugins/library/index.js |
| POST | `/plugins/library/books/:id/retire` | role-gated | id, owner, principal, coordinator, facilities | yes | src/plugins/library/index.js |
| POST | `/plugins/library/loans` | role-gated | owner, principal, coordinator, facilities | yes | src/plugins/library/index.js |
| POST | `/plugins/library/loans/:id/return` | role-gated | id, owner, principal, coordinator, facilities | yes | src/plugins/library/index.js |
| GET | `/plugins/library/loans` | role-gated | owner, principal, coordinator, facilities | yes | src/plugins/library/index.js |
| GET | `/plugins/library/overdue` | role-gated | owner, principal, coordinator, facilities | yes | src/plugins/library/index.js |
| GET | `/plugins/library/loans/mine` | role-gated | student | yes | src/plugins/library/index.js |
| GET | `/plugins/ops.bi/attendance` | role-gated | owner, principal, coordinator, finance, itadmin | yes | src/plugins/ops.bi/index.js |
| GET | `/plugins/ops.bi/fees/aging` | role-gated | owner, principal, coordinator, finance, itadmin | yes | src/plugins/ops.bi/index.js |
| GET | `/plugins/ops.bi/funnel` | role-gated | owner, principal, coordinator, finance, itadmin | yes | src/plugins/ops.bi/index.js |
| GET | `/plugins/ops.bi/homework` | role-gated | owner, principal, coordinator, finance, itadmin | yes | src/plugins/ops.bi/index.js |
| GET | `/plugins/ops.import/schema/:kind` | role-gated | owner, principal, coordinator, itadmin, admissions | yes | src/plugins/ops.import/index.js |
| POST | `/plugins/ops.import/validate-mapping` | role-gated | owner, principal, coordinator, itadmin, admissions | yes | src/plugins/ops.import/index.js |
| POST | `/plugins/ops.import/shadow` | role-gated | owner, principal, coordinator, itadmin | yes | src/plugins/ops.import/index.js |
| GET | `/plugins/ops.timetable/grid` | role-gated | owner, principal, coordinator, teacher, itadmin, finance, admissions, transport, facilities, technician | yes | src/plugins/ops.timetable/index.js |
| POST | `/plugins/ops.timetable/substitutions` | role-gated | coordinator, principal, owner, itadmin | yes | src/plugins/ops.timetable/index.js |
| GET | `/plugins/ops.timetable/substitutions/suggest` | role-gated | coordinator, principal, owner, itadmin | yes | src/plugins/ops.timetable/index.js |
| POST | `/plugins/ops.timetable/attendance/autofill` | role-gated | teacher, coordinator, principal | yes | src/plugins/ops.timetable/index.js |
| GET | `/plugins/ops.udise/columns` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/ops.udise/index.js |
| GET | `/plugins/ops.udise/export` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/ops.udise/index.js |
| POST | `/plugins/ops.visitors/visitors` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/ops.visitors/index.js |
| GET | `/plugins/ops.visitors/visitors` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/ops.visitors/index.js |
| GET | `/plugins/ops.visitors/guardian-lookup` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/ops.visitors/index.js |
| POST | `/plugins/ops.visitors/visitors/:id/checkin` | role-gated | id, owner, principal, itadmin, coordinator | yes | src/plugins/ops.visitors/index.js |
| POST | `/plugins/ops.visitors/visitors/:id/pickup` | role-gated | id, owner, principal, itadmin, coordinator | yes | src/plugins/ops.visitors/index.js |
| POST | `/plugins/ops.visitors/visitors/:id/pickup/verify` | role-gated | id, owner, principal, itadmin, coordinator | yes | src/plugins/ops.visitors/index.js |
| POST | `/plugins/ops.visitors/visitors/:id/complete` | role-gated | id, owner, principal, itadmin, coordinator | yes | src/plugins/ops.visitors/index.js |
| POST | `/plugins/ops.visitors/visitors/:id/deny` | role-gated | id, owner, principal, itadmin, coordinator | yes | src/plugins/ops.visitors/index.js |
| GET | `/plugins/pack.cbse/rules` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/pack.cbse/index.js |
| GET | `/plugins/pack.cbse/validate/exam/:examId` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/pack.cbse/index.js |
| GET | `/plugins/pack.cbse/export/oasis/:examId` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/pack.cbse/index.js |
| POST | `/plugins/pack.dpdp/consent` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/pack.dpdp/index.js |
| GET | `/plugins/pack.dpdp/consent/state` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/pack.dpdp/index.js |
| POST | `/plugins/pack.dpdp/dsr` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/pack.dpdp/index.js |
| GET | `/plugins/pack.dpdp/dsr` | role-gated | owner, principal, itadmin, coordinator | yes | src/plugins/pack.dpdp/index.js |
| GET | `/plugins/pack.dpdp/dsr/:id/export` | role-gated | id, owner, principal, itadmin, coordinator | yes | src/plugins/pack.dpdp/index.js |
| POST | `/plugins/pack.dpdp/dsr/:id/execute` | role-gated | id, owner, principal, itadmin, coordinator | yes | src/plugins/pack.dpdp/index.js |
| GET | `/parent/brief` | role-gated | parent | yes | src/plugins/parent.assistant/index.js |
| POST | `/parent/copilot/ask` | role-gated | parent | yes | src/plugins/parent.assistant/index.js |
| POST | `/parent/copilot/draft` | role-gated | parent | yes | src/plugins/parent.assistant/index.js |
| GET | `/parent/explain/:topic` | role-gated | parent | yes | src/plugins/parent.assistant/index.js |
| POST | `/plugins/payments.razorpay/orders` | role-gated | finance, owner, principal | yes | src/plugins/payments.razorpay/index.js |
| POST | `/plugins/payments.razorpay/webhook` | public | — | — | src/plugins/payments.razorpay/index.js |
| POST | `/plugins/payments.upi/links` | role-gated | finance, owner, principal | yes | src/plugins/payments.upi/index.js |
| POST | `/plugins/payments.upi/webhook` | public | — | — | src/plugins/payments.upi/index.js |
| POST | `/plugins/people.admin/users` | role-gated | owner, itadmin | yes | src/plugins/people.admin/index.js |
| GET | `/plugins/people.admin/users` | role-gated | owner, itadmin | yes | src/plugins/people.admin/index.js |
| POST | `/plugins/people.admin/users/:id/${suspend ? 'suspend' : 'activate'}` | role-gated | id, owner, itadmin | yes | src/plugins/people.admin/index.js |
| POST | `/plugins/people.admin/users/:id/reset-password` | role-gated | id, owner, itadmin | yes | src/plugins/people.admin/index.js |
| POST | `/plugins/people.admin/students/:id/transfer` | role-gated | owner, principal, coordinator, id | yes | src/plugins/people.admin/index.js |
| GET | `/plugins/people.admin/students/:id/history` | role-gated | owner, principal, coordinator, id | yes | src/plugins/people.admin/index.js |
| PATCH | `/plugins/people.admin/students/:id` | role-gated | owner, principal, coordinator, id | yes | src/plugins/people.admin/index.js |
| POST | `/plugins/people.admin/students/:id/withdraw` | role-gated | owner, principal, id | yes | src/plugins/people.admin/index.js |
| POST | `/plugins/people.admin/students/:id/promote` | role-gated | owner, principal, coordinator, id | yes | src/plugins/people.admin/index.js |
| POST | `/plugins/people.admin/import/students` | role-gated | owner, principal, coordinator, admissions | yes | src/plugins/people.admin/index.js |
| GET | `/student/home` | role-gated | student | yes | src/plugins/student.world/index.js |
| GET | `/student/homework` | role-gated | student | yes | src/plugins/student.world/index.js |
| GET | `/student/results` | role-gated | student | yes | src/plugins/student.world/index.js |
| POST | `/student/mistakes` | role-gated | student | yes | src/plugins/student.world/index.js |
| GET | `/student/mistakes` | role-gated | student | yes | src/plugins/student.world/index.js |
| DELETE | `/student/mistakes/:id` | role-gated | id, student | yes | src/plugins/student.world/index.js |
| POST | `/student/flashcards` | role-gated | student | yes | src/plugins/student.world/index.js |
| GET | `/student/flashcards` | role-gated | student | yes | src/plugins/student.world/index.js |
| GET | `/student/tasks` | role-gated | student | yes | src/plugins/student.world/index.js |
| POST | `/student/tasks` | role-gated | student | yes | src/plugins/student.world/index.js |
| POST | `/student/print` | role-gated | student | yes | src/plugins/student.world/index.js |
| GET | `/student/print/mine` | role-gated | student | yes | src/plugins/student.world/index.js |
| GET | `/student/print/queue` | role-gated | teacher, coordinator, principal, owner, itadmin | yes | src/plugins/student.world/index.js |
| POST | `/student/print/:id/done` | role-gated | id, teacher, coordinator, principal, owner, itadmin | yes | src/plugins/student.world/index.js |
| GET | `/student/noticeboard` | role-gated | student, teacher, coordinator, principal, owner, itadmin | yes | src/plugins/student.world/index.js |
| POST | `/student/wellbeing` | role-gated | student | yes | src/plugins/student.world/index.js |
| GET | `/student/wellbeing` | role-gated | principal, coordinator, owner, itadmin, counselor | yes | src/plugins/student.world/index.js |
| GET | `/student/session` | role-gated | student | yes | src/plugins/student.world/index.js |
| POST | `/plugins/teacher.classroom/homework` | role-gated | teacher | yes | src/plugins/teacher.classroom/index.js |
| GET | `/plugins/teacher.classroom/homework` | role-gated | teacher | yes | src/plugins/teacher.classroom/index.js |
| GET | `/plugins/teacher.classroom/homework/:id` | role-gated | id, teacher | yes | src/plugins/teacher.classroom/index.js |
| POST | `/plugins/teacher.classroom/homework/:id/submit` | role-gated | id, student | yes | src/plugins/teacher.classroom/index.js |
| POST | `/plugins/teacher.classroom/submissions/:id/review` | role-gated | id, teacher | yes | src/plugins/teacher.classroom/index.js |
| GET | `/plugins/teacher.classroom/submissions` | role-gated | teacher | yes | src/plugins/teacher.classroom/index.js |
| POST | `/teacher/leave` | role-gated | teacher | yes | src/plugins/teacher.classroom/index.js |
| GET | `/teacher/leave/mine` | role-gated | teacher | yes | src/plugins/teacher.classroom/index.js |
| GET | `/curriculum/tree` | role-gated | owner, principal, itadmin, coordinator, teacher | yes | src/plugins/teacher.copilot/index.js |
| POST | `/curriculum/progress` | role-gated | owner, principal, itadmin, coordinator, teacher | yes | src/plugins/teacher.copilot/index.js |
| GET | `/mastery/student/:id` | role-gated | id, owner, principal, itadmin, coordinator, teacher | yes | src/plugins/teacher.copilot/index.js |
| GET | `/mastery/class/:grade` | role-gated | owner, principal, itadmin, coordinator, teacher | yes | src/plugins/teacher.copilot/index.js |
| GET | `/teacher/brief` | role-gated | teacher | yes | src/plugins/teacher.copilot/index.js |
| POST | `/copilot/draft` | role-gated | teacher | yes | src/plugins/teacher.copilot/index.js |
| POST | `/copilot/ask` | role-gated | teacher | yes | src/plugins/teacher.copilot/index.js |
| GET | `/teacher/usage` | role-gated | teacher | yes | src/plugins/teacher.copilot/index.js |
| POST | `/teacher/concern` | role-gated | owner, principal, itadmin, coordinator, counselor, teacher | yes | src/plugins/teacher.support/index.js |
| GET | `/teacher/concerns` | role-gated | owner, principal, itadmin, coordinator, counselor, teacher | yes | src/plugins/teacher.support/index.js |
| POST | `/teacher/concern/:id/route` | role-gated | id, owner, principal, itadmin, coordinator | yes | src/plugins/teacher.support/index.js |
| POST | `/teacher/concern/:id/outcome` | role-gated | id, owner, principal, itadmin, coordinator, counselor, teacher | yes | src/plugins/teacher.support/index.js |
| GET | `/teacher/concern/:id/events` | role-gated | id, owner, principal, itadmin, coordinator, counselor, teacher | yes | src/plugins/teacher.support/index.js |
| POST | `/safety/box` | role-gated | student | yes | src/plugins/teacher.support/index.js |
| GET | `/safety/box` | role-gated | owner, principal, itadmin, coordinator, counselor | yes | src/plugins/teacher.support/index.js |
| GET | `/safety/box/summary` | role-gated | counselor, owner, principal, itadmin | yes | src/plugins/teacher.support/index.js |
| POST | `/safety/box/:id/assign` | role-gated | id, owner, principal, itadmin | yes | src/plugins/teacher.support/index.js |
| POST | `/safety/box/:id/close` | role-gated | id, owner, principal, itadmin, coordinator, counselor | yes | src/plugins/teacher.support/index.js |
| POST | `/plugins/teacher.support/doubt` | role-gated | student | yes | src/plugins/teacher.support/index.js |
| GET | `/teacher/support/doubts` | role-gated | teacher, owner, principal, itadmin, coordinator, student | yes | src/plugins/teacher.support/index.js |
| POST | `/teacher/support/doubts/:id/answer` | role-gated | teacher, owner, principal, itadmin, coordinator, id | yes | src/plugins/teacher.support/index.js |
| POST | `/teacher/support/doubts/:id/promote-faq` | role-gated | teacher, owner, principal, itadmin, coordinator, id | yes | src/plugins/teacher.support/index.js |
| POST | `/interventions` | role-gated | owner, principal, itadmin, coordinator, counselor, teacher | yes | src/plugins/teacher.support/index.js |
| GET | `/interventions` | role-gated | owner, principal, itadmin, coordinator, counselor, teacher | yes | src/plugins/teacher.support/index.js |
| POST | `/interventions/:id/transition` | role-gated | id, owner, principal, itadmin, coordinator, counselor, teacher | yes | src/plugins/teacher.support/index.js |
| GET | `/ptm/slots` | role-gated | parent, owner, principal, itadmin, coordinator, counselor, teacher | yes | src/plugins/teacher.support/index.js |
| POST | `/ptm/slots` | role-gated | teacher | yes | src/plugins/teacher.support/index.js |
| POST | `/ptm/book` | role-gated | parent | yes | src/plugins/teacher.support/index.js |
| POST | `/ptm/:id/notes` | role-gated | teacher, id | yes | src/plugins/teacher.support/index.js |
| GET | `/ptm/:id/notes` | role-gated | teacher, id | yes | src/plugins/teacher.support/index.js |
| POST | `/plugins/transport.gps/positions` | role-gated | transport, coordinator, principal, owner | yes | src/plugins/transport.gps/index.js |
| GET | `/plugins/transport.gps/positions` | role-gated | transport, coordinator, principal, owner | yes | src/plugins/transport.gps/index.js |

---

# Appendix G — Run it locally, demo world, env vars, glossary, navigator

## G.1 Run it locally (from `server/`)

| Step | Command | What it does |
|---|---|---|
| 1 | `npm ci` | install server deps |
| 2 | `node scripts/migrate.js` | apply the 99 ordered migrations (schema + RLS) |
| 3 | `node scripts/bootstrap.js` | create `schoolos_app`, grants, default-ACL tightening (needs `ADMIN_DATABASE_URL`/superuser for role management) |
| 4 | `node scripts/seed.js` | load the demo school (refuses in production) |
| 5 | `npm start` | API on `:8080` (`GET /health`) |
| 6 | `cd ../app && npm ci && npm run dev` | client on `:5173` (set `VITE_LIVE_API=1` to point at the live API) |

**Order law:** always `migrate → bootstrap → seed`. Bootstrap grants `ON ALL TABLES`, so it must run after
tables exist; re-run it after adding migrations. Docker path: `JWT_SECRET=dev-secret docker compose up --build`.

## G.2 The demo world (seed: "Meridian International Academy")

| Entity | Count / shape |
|---|---|
| Tenant | 1 (`meridian`, campuses north/south) |
| Users | 12 (one per role, all password `schoolos-demo`; provisioned `force_change` where applicable) |
| Students | 375 (grades 6–10 × 3 sections); one pinned cast: "Aarav Sharma" 8-B, guardian Kavita |
| Guardians | 375 (primary, with phones; two pinned drill numbers) |
| Fee plans / obligations | 375 plans; 1125 obligations (Term 2 × 3 installments; Aarav's September left open) |
| Routes / stops | 4 routes, 17 stops (Route 7 pinned) |
| Assets / work orders | 6 assets, 4 work orders |
| Attendance | ~3750 rows (10 days) |
| Events / audit | genesis audit row + a few seeded events; plugin rows from migrations 009–048 + catalog |

The seed is deterministic (mulberry32 RNG) and TRUNCATEs tenant data first; `NODE_ENV=production` refuses it.
`scripts/seed.js` also re-applies the RLS policy hardening (074) after replaying migrations 009–048 — the
replay re-creates old policies, so anything that hardens a policy must be re-applied here too.

## G.3 Demo accounts (password `schoolos-demo`)

| Email | Role | Use it to see |
|---|---|---|
| `owner@meridian.edu` | owner | plugin enable/settings, roles, audit, metrics, everything |
| `principal@meridian.edu` | principal | actions inbox, approvals, staff view |
| `coordinator@meridian.edu` | coordinator | coord home, substitutions, workload, curriculum, escalations |
| `counselor@meridian.edu` | counselor | wellbeing/safeguarding tier |
| `finance@meridian.edu` | finance | fees, fee plans, refunds, reconciliation, dunning |
| `admissions@meridian.edu` | admissions | funnel/leads |
| `transport@meridian.edu` | transport | routes, transport events |
| `facilities@meridian.edu` / `technician@meridian.edu` | facilities / technician | maintenance, assets, work orders |
| `teacher@meridian.edu` | teacher | today, homework, attendance, marks (own classes) |
| `itadmin@meridian.edu` | itadmin | IT console, metrics, API keys, webhooks |
| `parent@meridian.edu` | parent | parent home, fees, complaints, consents, chat, ask |
| `student@meridian.edu` | student | student home, learning, results, noticeboard, print |

## G.4 Environment variables (read by `server/src/config.js` / `app.js`)

| Var | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | production enables fail-fast guards; dev doors need `development` + opt-in |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | listen address |
| `DATABASE_URL` | dev DSN | app pool + migration runner |
| `ADMIN_DATABASE_URL` | derived (postgres) | superuser path for bootstrap |
| `JWT_SECRET` / `JWT_TTL` | dev / `12h` | session signing + lifetime |
| `STUDENT_SESSION_TTL` | `30m` | short student sessions (shared computers) |
| `CORS_ORIGINS` | `*` (dev) | allowlist; production refuses `*` |
| `RATE_LIMIT_MAX` | `300` | requests/min per identity |
| `TRUST_PROXY` / `FORCES_HTTPS` | `false` | proxy IP handling / HSTS |
| `PLUGIN_SETTINGS_KEY` | — | **required in production**; encrypts secret plugin settings |
| `OTP_TTL_MS` / `OTP_MAX_ATTEMPTS` / `OTP_DEV_ECHO` | 5 min / 5 / dev | OTP policy + dev echo |
| `RESET_TTL_MS` / `RESET_TOKEN_DEV_LOG` | 30 min / dev | reset policy + dev log |
| `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | — | Google SSO |
| `UPI_WEBHOOK_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | — | webhook HMAC secrets (fail closed) |
| `SELF_SIGNUP_ENABLED` | off | kill-switch for `/onboard/signup` |
| `SEED_GUARD` | — | `strict` required in production |
| `FILES_DIR` | `server/storage` | private uploaded-file bytes |
| `WORKER_ROLE=1` | — | marks a worker process (guards differ); refused on the HTTP entry |
| `OUTBOX_POLL_MS/BATCH/MAX_ATTEMPTS/BACKOFF_*` | see `.env.example` | relay tuning |
| `LOG_LEVEL` / `STATIC_DIR` | `info` / — | logging; optional static frontend |

## G.5 Event types and topics (index)

`emitEvent(client, tenant, { type, label, severity, ref }, topic, payload, opts)` writes `app.events` +
`app.outbox`. The `type` is the coarse domain; the `label` is human copy; `topic` (or `event.<type>`) is the
outbox routing key; `emitted_by` is `kernel` or `plugin:<id>`.

| Domain `type` | Example labels | Typical topic |
|---|---|---|
| `attendance` | `Marked attendance · N students on <date>`, `Period autofill — 8-B · …` | `attendance.absences`, `attendance.autofilled` |
| `fees` | `payment.initiated`, `payment.confirmed`, `payment.refunded`, `Fee dunning — N reminders` | `fees.reconciliation`, `fees.razorpay.gateway` |
| `case` | `Case opened — <title>`, `Case <code> → resolved` | `event.case` |
| `classroom` | `Homework posted/submitted/reviewed`, `Staff leave requested` | `event.classroom` |
| `transport` | `Bus Route 7 delayed +12 min — 75 students affected` | `transport.delay` |
| `visitors` | `visitor.logged`, `visitor.checked_in`, `visitor.pickup.verified`, `visitor.completed` | `event.visitors` |
| `library` | `Book issued → <student>`, overdue notices | `event.library` |
| `safety` | `safety.report.filed`, `safety.page.raised`, `concern.*` | `event.safety` |
| `exams` | `exam.published`, `exam.marks.bulk`, `cbse.obligation.due.v1` | `event.exams` |
| `comms` | `Parent notice approved and QUEUED…`, `…NOT sent` | `event.comms` |
| `hr` / `duty` / `ptm` | `staff.leave.requested.v1`, `duty.assigned.v1`, `ptm.booked` | `event.hr` etc. |
| `migration` / `people` / `files` / `dpdp` / `admissions` | import/export, provisioning, file stored, erasure, funnel | `event.<type>` |
| dotted v1 | `child.leave.requested.v1`, `family.consent.v1`, `family.request.v1`, `student.home.v1`, `student.print.v1`, `student.wellbeing.v1`, `submission.v1`, `sub.assign.v1`, `homework.v1`, `coord.home.v1`, `coord.decision.v1`, `doubt.routed/answered/faq.promoted`, `intervention.status.changed` | `event.<type>` |

## G.6 Glossary (quick reference)

| Term | Definition |
|---|---|
| **Door** | one HTTP route with a gate |
| **Gate** | preHandler chain: authenticate → role/mask → lifecycle → entitlement |
| **Kernel** | non-plugin core (app.js, routes.js, db.js, audit.js) |
| **Owner path** | `sysq()`/`tx()` running as `schoolos` with `BYPASSRLS` |
| **Constrained path** | `q()`/`withUser()` running `SET LOCAL ROLE schoolos_app` (RLS applies) |
| **GUC** | transaction-local setting: `schoolos.tenant_id`, `schoolos.role`, `schoolos.user_id` |
| **Lifecycle gate** | per-request check that a plugin is enabled for the tenant (409 otherwise) |
| **Entitlement** | plan check on enable and per request (402 `NOT_ENTITLED`) |
| **Capability** | named provider contract resolved by `enabledCapability` (e.g. `auth.otp`) |
| **Outbox** | `app.outbox` work queue; relay marks `processed_at`/`parked_at` |
| **Parked** | a row the relay gave up on (`parked_at` set, `processed_at` still NULL) |
| **Sandbox carrier** | `logger`/`log-only` provider — sent in a sandbox, undeliverable in production |
| **Effective access** | `GET /me/effective` render hint (surfaces + doors + scope) |
| **SoD** | segregation of duties (e.g. proposer cannot approve their own action) |

## G.7 Task navigator — "I want to…"

| I want to… | Go to |
|---|---|
| See the big picture | `PERFECT-100.md` §1, this doc Part I |
| Understand a role | Catalogue A |
| Understand a screen | Catalogue B |
| Trace a business flow | Catalogue C |
| Find a table/column | Catalogue D |
| Understand a plugin | Catalogue E |
| Find a route and who may call it | Catalogue F / `docs/PERMISSION-MATRIX.md` |
| Know what is broken | `PERFECT-100.md` §5 (register) + §9 (fresh re-audit) |
| Verify the suite is green | `docs/VERIFICATION.md` (generated) |
| Deploy | §8 here + `server/README.md` + `server/docker-compose.yml` |
| Extend with a plugin | Catalogue E + §5 here (manifest contract) |
