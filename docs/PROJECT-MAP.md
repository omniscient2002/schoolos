# SchoolOS — The Complete Project Map

> **One document to understand the whole system.** Written 2026-09-14 by the CTO orchestrator after a six-track deep audit of the actual code. **The counts that were in this line (77 migrations, 99 tables, 29 plugins, 272 doors, 534 tests) are a snapshot and drift** — the live figures are generated: migrations/modules/tests in `docs/VERIFICATION.md`, the door census in `docs/PERMISSION-MATRIX.md`, the role count in `server/src/auth.js` (`ROLES`). Every claim here traces to code, not to design documents — where docs and code disagree, this map follows the code, and where a number can be generated it should be.
>
> Older companions: `README.md` (mission + run instructions), `docs/01–12` (original design record), `HANDOFF.md`, `.coop/` (live engineering process). This file is the **current-state source of truth**.

---

## 0 · The 4-paragraph mental model

**What it is.** SchoolOS is an India-first, multi-tenant "AI-native operating system for schools." One Postgres database backs many tenants (schools); one Fastify API serves one React SPA; every tenant's data is isolated by PostgreSQL **row-level security**, not just by query filters. The product loop for staff is *Today → Attention → Ask → Action → Memory*; parents and students get their own narrow portals inside the same SPA.

**Three layers.** (1) A security **kernel** — `server/src/app.js` + `routes.js` — owns auth (scrypt+JWT, OTP, MFA, tenant picker), tenancy, the dataset endpoint, governance (audit ledger, constitution, event budgets), and the plugin registry. (2) **Plugins** — `server/src/plugins/*`, 29 domain units (fees rails, transport GPS, exams, AI copilots, CBSE/DPDP packs…) that register routes and tables but are enabled *per tenant* via DB rows and a drain protocol. (3) The **SPA** — `app/src`, which renders the kernel + whatever the tenant has enabled, in two skins: a demo sandbox (fabricated dataset via `/dataset`) and **Live mode** (`/live`, real API calls with your own tenant credentials).

**One request pipeline.** Every HTTP call walks the same corridor: Fastify hooks (CORS → rate limit → JWT verify with `session_epoch` invalidation + `mustChange` restricted-token gate) → `requireRole` → handler runs **as the tenant-scoped app role** (`SET LOCAL` tenant + role → RLS policies) → mutations append rows to `app.audit_log` → response. The app-role can never `DELETE` kernel tables (D-35, enforced by grants).

**Two rivers of side effects.** `audit_log` is the **history river** (append-only, everything that happened); `app.outbox` is the **promise river** (everything that should happen): comms dispatch, workflow-rule fan-out, and plugin drains ride it, deduplicated by `dedup_key` so a retried event can never double-send. AI calls flow through a third channel — the **gateway** (`_shared/ai-gateway.js`) with per-tenant budgets and a ledger — and high-impact AI actions stall at human-approval gates, never auto-fire.

---

## 1 · Backend request lifecycle & complete API map

*Fastify 5.12 + Postgres 18. True door count: **370** — the generated `docs/PERMISSION-MATRIX.md` is authoritative and now scans every registered route (including `onboarding.js` and settings-form doors). Role split: 327 role-gated · 30 auth-only · 13 public · **0 unguarded**. (K3: the old hand-counted 272/263 split is superseded; re-derive from the generated matrix.)*

### 1.1 Boot (`src/index.js` → `buildApp()`)
`WORKER_ROLE=1` on the HTTP entry refuses to boot (workers must not arm prod guards off). `config.js` fail-closed: required vars, prod refuses localhost DB / `CORS='*'` / loose SEED_GUARD / short JWT. Dev doors (`AUTH_DEV_SSO`, `OTP_DEV_ECHO`, `RESET_TOKEN_DEV_LOG`) need `development` AND explicit opt-in — **this box has `OTP_DEV_ECHO=1`** (codes echo in responses — never ship this `.env`). Decoration: CORS (credentials:false) → rate-limit 300/min → JWT. Mount order: kernel routes → onboarding (before plugins so signup works on a zero-plugin school) → **`loadPlugins`** → `/dataset` `/capabilities` `/ai/*` `/workflow-rules` `/metrics`. **Loader is registry-blind and boot-fatal:** every folder must mount or the process dies collecting all errors ("a plugin that cannot mount must never half-exist"); `degraded` status is read by three gates but written nowhere; `register()` is awaited-but-not-really (sync call at loader.js:45 — async escape hatch exists). Enablement is a *per-request* `lifecycleGate` (DB read, 409 unless enabled|active|degraded), never a mount-time decision. Catalog `ensurePluginCatalog` seeds 29 rows (5 DEFAULT_ON) at signup + `GET /plugins` self-heal.

### 1.2 The corridor of one authenticated request
hooks (CORS → rate limit → body parse: default 1 MiB; files.store 8 MiB multipart; money rails install the raw-bytes JSON parser once) → **`app.authenticate` (app.js:89–176)** in strict order:
1. **X-API-Key branch** — reads only (`GET /me`, `GET /dataset` w/ `core.read` scope), mutations 403, sha256 lookup, synthetic `role:'api'` principal.
2. cookie-vs-bearer selection; **CSRF double-submit on cookie mutations only** (bearer exempt).
3. JWT verify — **`jti` mandatory** (unrevokable = refused).
4. `auth.revoked_token` denylist → user row re-read **from DB** (`active` checked; token claims never authoritative for role).
5. `session_epoch` compare — credential change killed all sessions.
6. Restricted tokens: `mustChange` → only `/me`,`/me/password`,`/auth/logout`; `mfaPending` → only `/me/mfa/verify`.
7. Custom-role `applyMask` — on EVERY authed door (deny can cut even `me`-level reads).
8. Failure taxonomy: DB-outage codes → **503** (never disguises as 401); everything → 401.
Then `requireRole` (base role ⊕ mask, §3.1) → handler runs `withUser(tenant, role, fn)`: `BEGIN → set_config GUCs → SET LOCAL ROLE schoolos_app → work → COMMIT` — pool (20, statement_timeout 15 s) connects as BYPASSRLS owner; **`q()` (the app-role helper) has zero production callers** — the audit trail of "who touches what": `withUser` 246 sites, `sysq` 115 (owner path: vaults, registry, metrics, cross-tenant login resolution). Response: no envelope; `onSend` adds no-store on personal planes + security headers; ≥500 → generic 'internal error'.

### 1.3 Kernel API surface (98 doors, grouped; full row-by-row in docs/PERMISSION-MATRIX.md)
- **Health:** `GET /health` (200-degraded on DB down) · `GET /ready` (503).
- **Auth (app.js):** login(20/min, four outcomes) · renew · otp request(5/min)/verify(10/min) · google start/callback + demo (flag-gated) · logout (denylist + Clear-Site-Data). `/me`(+tenants/switch/password/reset-request/reset-confirm/mfa enroll|verify|disable) — all rate-limited 5–10/min, password ≥8 + differs, epoch bumps, code redaction on every reset path.
- **Machine credentials:** /api-keys POST/GET/DELETE(soft) · /webhooks same — owner|itadmin only; raw secrets shown exactly once.
- **Tenant context:** `GET /dataset` (allowlisted empty world for non-demo tenants; module-global cache — per-tenant truth rests on the allowlist) · `GET /capabilities` (flags only).
- **AI/workflow/metrics admin:** `/ai/call|calls|eval` · `/workflow-rules` GET/POST/DELETE(soft-disable) · `/metrics` (Prometheus text incl. honesty gauges; 60 s counter flush).
- **Custom roles:** /roles CRUD + assign/unassign — mask regex-validated, no grant-all, amplification ceiling, retire-in-place.
- **People/attendance:** GET /students (parent→children, student→403, phone only for roster tier) · /students/:id · POST /students · GET /attendance (scoped) · **POST /attendance/mark** (gate says 4 roles, handler restricts to owner/principal until class-assignment data exists; absence notices queue to comms).
- **Calendar/money:** /academic-years + activate (one-current CHECK named in 409s) · /fee-plans + generate (idempotent, never overwrites paid) · obligations GET (canReach tiered) / **void owner-only, refuses paid>0** · payments POST (parent must own child; one open per obligation) / confirm (gateway_ref required for 'webhook-verified'; paid_cents monotonic) · **refund** (gateway leg FIRST — refused ⇒ ledger byte-identical; floor 0) · reconcile (ghost/missing/orphan) · dunning/run (IST quiet hours write NOTHING; 7-day dedup).
- **Ops:** transport routes/events (event-budget 429; delay≥10 ⇒ action+lineage) · work-orders GET(9 desks)/POST(SLA-shaped)/status(5 roles, strict machine, breach stamping) · assets · cases GET(staff)/my-cases/POST(origin/owner/priority DERIVED from role, not body)/status.
- **Spine:** GET /actions(10 desks) · **POST /actions/:id/decide** — SoD (owner_role decides, no self-approve), `kind:'message'` QUEUES never claims delivery, `students.create.*` runs the admissions executor. events/lineage (shared role array prevents drift-forgot-a-door leaks) · notifications (+read) · communications (the SELECT * that forced SEC-0 redaction) · audit (≤500 + hashes) · **audit/verify** (owner path, always 200 with findings + stated limits) · memory read/POST.
- **Plugins:** GET /plugins (⚠️ a GET that WRITES — catalog self-heal; settings values stripped for non-privileged) · enable · disable (drain protocol §5.5) · settings (secret-class ⇒ risk:high audit, key-names-only).
- **Migration (Golden Loop 1):** sources CRUD-ish + stage-rows (SECURITY DEFINER `purge_staged_rows` because D-35) + validate + commit (idempotent `source_ref='mig:<src>:<n>'`) + **activate owner/principal trust-receipt**.
- **Onboarding:** signup (public 3/min, `SELF_SIGNUP_ENABLED` kill-switch, one tx: tenant+owner+catalog+audit+event) · /onboard/school (owner) · status (checklist honest about DEFAULT_ON count).

### 1.4 Side-effect machinery (who runs what)
`emitEvent` = the only production outbox enqueue (no dedup_key) + `events` row, same tx. Workers (all standalone processes, none cron'd — §8c#24): **outbox-relay** (SKIP LOCKED, backoff, park ≠ processed — 073) · **workflow-runner** (state-based scan, `wf:` dedup, marker-last-in-tx) · **comms-dispatcher** (8-attempt cap, ≤500 recipients refused-not-truncated, production sandbox ⇒ terminal 'undeliverable') · **webhook-worker** (`x-schoolos-signature: t,v1=hmac(secret,'t.body')`) · **retention** (chain-preserving cold move) · **day-worker** (4 contained steps) · dunning/reconcile (⚠️ build their own pg clients = **run as owner, RLS bypassed**; reconcile writes `events` directly with NO outbox row — its warnings reach no subscriber). In-process timers: metrics flush only — no cron in the API.

### 1.5 Security gate inventory (condensed, all tested)
scrypt N=2¹⁷ r=8 p=1 + legacy-cost fallback + `dummyVerify` timing parity · OTP default-cost scrypt (correct for 6-digit TTL secrets) · TOTP RFC 6238 ±1 window (⚠️ compared with `===`, exported `constantTimeEqual` unused) · webhook HMACs over **wire bytes** with uniform-401 anti-enumeration + tenant-bound secret trust + freshness + ON CONFLICT replay no-ops · `isSecretKey` classification powering audit-risk, write-only forms, and value-stripping reads · column ACLs (users UPDATE = 7 named columns, sign_secret unreadable) · uuidParams on ~40 `:id` doors · API-key scope allowlist · session epoch + jti denylist + 30-min student TTL + Clear-Site-Data.

## 2 · Data model & what gets logged

*77 migration files, numbered 001–079 (064/065 deliberately absent — four different numbering systems coexist; always cite by **filename**). 99 tables.*

### 2.1 Schemas, roles, and the RLS architecture

**Two core + 22 domain schemas.** `app` is the kernel (001). `auth` arrived late (038) and holds only token rails: `revoked_token` (038), `reset_tokens` (056), `mfa_secrets`/`mfa_recovery_codes` (057). Every plugin owns its schema (`plugin_exams`, `family`, `student`, `teacher`, `safety`, `library`, `plugin_dpdp`…) created by its numbered migration.

**Two Postgres roles.** `schoolos` = owner: owns tables, runs migrate/seed, **BYPASSRLS**. `schoolos_app` = constrained runtime role (created by `scripts/bootstrap.js`, NOINHERIT, granted to schoolos). The pool connects as owner; `withUser()` sets `schoolos.tenant_id`/`schoolos.role` GUCs then **`SET LOCAL ROLE schoolos_app`** — the RLS envelope. (`app.users.pg_role` column exists but is inert.)

**One RLS predicate, four shapes.** Tenant isolation `tenant_id = app.current_tenant()::uuid` pinned ENABLE+FORCE over core tables (001 loop), swept onto stragglers (049), razor-blade for late tables (054). Variants: **row-owner pins** (`teacher.note`, `student.*` via `schoolos.user_id`), **kernel-only vaults** (`USING(false)`: `auth_otps`, `pickup_otp`, `reset_tokens`, mfa), **platform read** (`capability_contracts USING(true)`).

**Migration 074 — "a policy must DENY, never RAISE."** Pre-074, policies inlined `current_setting(...)`: an empty-string GUC raised 22P02 → 500s. 074 adds `app.current_tenant()`/`app.current_user_id()` helpers (returning TEXT deliberately) wrapping `NULLIF(...,'')` and rewrites all 94 predicates *from a snapshot* (its first version hardened only 44/94 — caught and documented) and refuses to report success on partial rewrite. No post-074 migration adds an inline-policy.

**D-35: the app role never gets DELETE.** 072: an AWS-style trap — a **`postgres`-owned** default ACL (`{schoolos_app=arwd/postgres}`) silently granted DELETE on tables postgres creates; three timetable tables were live violations. 072 revokes DELETE everywhere, one *documented* exception: `student.mistake_note` (students hard-delete their own notes through a scoped audited door). **The default ACL itself is still armed** — removing it needs superuser; until an operator does, a postgres-authored CREATE TABLE in `app` re-arms it (`tests/acl-d35.test.js` guards the effect).

**Grants history (each layer undoing the last):** 005 broad grants → 006 ledger behind SECURITY DEFINER `app.audit_append()` → **054 re-baseline: kills the default-privilege trap, blanks grants, law: new tables born with ZERO grants, each migration grants explicitly** → 072 DELETE ban → 077 column scope.

### 2.2 Table catalog (99 tables by domain)

**Identity/tenancy:** `tenants` (config jsonb — the ONLY config column in the DB), `users` (role CHECK now 13 incl. counselor via 079; `session_epoch` for instant global logout, `force_change`, `pg_role` inert), `roles` (custom roles: key, label, base_role, permissions `{allow,deny}`, composite-FK'd from users, ON DELETE RESTRICT), `plugins` (the switchboard: version/class/status 14-state CHECK, **manifest/settings carry real schema since PLG-4**, entitlement, trust T0–T4, event_budget, ai_budget, breaker_state, cert_score), `capability_contracts` (enforced-as-data contracts incl. 5 kernel primitives; `optional` marker 051 — frontend must read `/capabilities`, never assume), `api_keys` (sha256 hash only), `oauth_states`, plus `auth.*` vaults (reset tokens sha256, TOTP secrets + hashed recovery codes — deliberately NOT in app.users since rosters SELECT it; jti denylist; scrypt OTP vault purpose='login' only).

**People:** `students` (roster of record; NO gender column — UDISE export honestly says `not_recorded`), `guardians`, `enrollment_history` (write-once: transfer/promote inserted BEFORE the flip), `family.child_link` (the parent↔student authorization spine), `family.request`+`request_event` (append-only ticket trail), `family.consent` (**immutable once decided — DB trigger 034:68**), `teacher.note` (owner-pinned RLS).

**Academics:** `academic_years` (one current per tenant, money hangs off it), `timetable_periods/slots/substitutions` (kernel-owned; substitution is an *overlay* — original slot untouched, UNIQUE(slot,date)), `curriculum.node` (read-only for app role)/`progress`, `mastery.evidence`(+`expires_at`)/`state` (derived level + `derived_from` decay marker), `teacher.homework`/`submission` (UNIQUE(hw,student) = structurally one-shot)/`leave_request`, `duty.assignment`, `ptm.slot`/`booking`, `plugin_exams.exam/mark/report/moderation` (report stores `snapshot`+`digest` — freeze at publish; moderation overlay never touches marks; `board_policy` column exists but **validation-only, nothing consumes it yet** 062).

**Attendance:** `app.attendance` — UNIQUE(tenant,student,date): one row per child per day, 4 statuses.

**Fees/money:** `fee_plans` (term, installments, `paid<=amount` CHECK 006), `fee_obligations` (installment rows, status), `payments` (one OPEN per obligation; confirm requires gateway_ref; refund columns 060), `fee_plan_templates` (grade-set×terms, fanned out on generate).

**Transport:** `routes`/`route_stops`/`transport_events` + `plugin_transport_gps.positions` (30-day read-enforced retention).

**Facilities/ops:** `assets`, `work_orders` (10-state + SLA fields), `wo_events`, `cases`, **`actions`** (the spine: kind approval/incident/exception/recommendation/reminder, owner_role, policy_ref, `ai_involved`, UNIQUE(tenant,code) — every plugin escalation in the system is one row here), `plugin_hr.leave` (partial UNIQUE per staff-day WHERE marked), `plugin_visitors.visit`+`pickup_otp` (FK-free by design 054 — after an incident where pickup codes leaked into the LOGIN vault, purge included), `ops_counters` (no tenant, no RLS, deliberately).

**Comms:** `communications` (audience_json, channel, template, status machine incl. undeliverable, policy_ref, **dedup_key** 071, provider+provider_ref 066, attempts/backoff 043), `notifications` (in-app, group-keyed), `webhook_subscriptions` (+`sign_secret` — SELECT column-scoped away by 077, relay signs on owner path), `webhook_deliveries` (UNIQUE(sub,event), retry).

**Event spine:** `events` (envelope v2: emitted_by, subject, correlation_id, causation_id), **`outbox`** (the promise river: topic/payload/event_id FK, attempts/last_error/next_attempt_at 042, **dedup_key + partial unique** 071, **parked_at** 073 — separates failure from idleness (a total relay failure previously looked metrically identical to an idle system), discovered_at/workflow_scanned_at markers 076), `event_action_link` (lineage). Workers self-ensure their columns on startup — acknowledged schema-vs-runtime drift allowance (042/043).

**Logging:** **`audit_log`** (§2.3), `audit_log_cold` (chain-preserving archive), `memory_entries` (institutional decisions: expected vs actual — the learning loop).

**AI:** **`app.ai_calls`** (the ONLY AI ledger; `ai_ledger` does not exist), `copilot.call` (teacher), `parent.copilot_call`, `coord.copilot_call` (private per-plugin ledgers, aiInvolved:false), `parent.brief_log` (exact briefs served — ⚠️ full child-name JSON, no purge path).

**Workflow:** `app.workflow_rules` (071) — topic filter + {field,op} condition + ONE action (kind outbox|comms); **grants SELECT/INSERT/UPDATE, no DELETE** → the DELETE door is soft-disable.

**Privacy/safeguarding:** `plugin_dpdp.consent` (INSERT-only ledger)/`sar` (SLA clock)/`erasure_journal` (sha256 subject_key + HMAC surrogate — idempotent erasure with zero PII), `safety.box` (structural anonymity: reporter_user_id NULL when anonymous), `support.doubt`/`faq`, `intervention.plan`+`_event`, `teacher.concern`+`_status_event`, `student.mistake_note/flashcard/study_task/print_job/wellbeing_request` (anonymous ⇒ CHECK-enforced no identity columns).

**Files:** `app.files` (metadata; path relative under server FILES_DIR; INSERT-only table — UPDATE revoked outright 077).

*(Correction worth knowing: `app.plugins` has NO `config` column — plugin state is `settings jsonb` shaped by `manifest.settingsSchema`; `config` exists only on tenants.)*

### 2.3 The audit trail — exactly what gets recorded

- **Columns:** tenant_id, actor (user id/email; migrations write 'migration NNN (plugin factory)'), actor_role, action, record_type, record_ref, reason, policy_ref, ai_involved, risk low/med/high, outcome, ip (**in hash material but populated by 0 of 168 writers**), prev_hash, hash, hash_version, created_at. Index (tenant, created_at DESC).
- **One write path:** 168 sites → `audit.js` `requestAudit` (107, plugins — actorRole FORCED to `plugin:<id>`, policy default `Platform §3`) + `auditLog` (61 kernel) → **`SELECT * FROM app.audit_append(...)`** SECURITY DEFINER. Workers never touch it. ⚠️ `POST /ai/call` is the only mutating door with NO audit row.
- **075 integrity saga (read this once):** the old function *validated* prev_hash but stored caller-supplied hash verbatim — forensics: 26 of 53 dev rows don't reproduce; **one row was demonstrably altered post-insert** (matched the migration file's literal, not its column). 075 fixes: BEFORE INSERT trigger computes prev/hash/hash_version=2 (caller hash ignored), `created_at` ms-truncated for determinism, per-tenant advisory lock *inside* the function (JS-only lock never protected the 33 migration replays), BEFORE **UPDATE** immutability trigger (NOT delete — retention archives via DELETE), `app.audit_verify()` recompute (link_break/hash_mismatch/cold_boundary_break; legacy v1 rows reported, not laundered). ⚠️ Trigger orders DESC+id, verifier ASC — same-millisecond pairs can flip (075 §8, open).
- **Retention:** `retention-worker.js` archives >AUDIT_ARCHIVE_DAYS (default 365) verbatim into cold, INSERT-then-DELETE one tx; cold = owner-read-only; boundary-hash check only, cold-chain walk explicitly NOT done (says so on the door). ⚠️ positional column mapping broke silently when 075 added hash_version — archival stopped without alerting. ⚠️ `ai_calls` has NO retention and grows forever.
- **What actions exist:** 167 distinct strings (130 static, 37 templated like `'Case → ${to}'`, `'Plugin enabled: ${id}'`); migrations seed their own genesis rows ("Plugin unit shipped…" ×36 files); one accidental duplicate ('File uploaded' ×2).

### 2.4 What the seed creates (`server/scripts/seed.js` — ⚠️ TRUNCATEs all tenants; guarded since 2026-09-12, `--allow-nuke` only)

1 tenant (meridian) · **12 users** (one per role minus counselor, all `schoolos-demo`) · **375 students** (grades 6–10 × 3 sections) · 375 guardians · 375 fee plans + **1125 obligations** · 4 routes + 17 stops · 6 assets + 4 work orders + events · **3750 attendance rows** (10 days) · 1 case + 1 action (ai_involved) + 1 gps delay + 5 events + 1 communication · 5 migration sources · 1 memory entry · 1 genesis audit row (~8030 rows total; ZERO outbox rows, ZERO custom roles). Plugin rows come from **replaying migrations 009–048** + `ensurePluginCatalog` — a known hazard recorded in the file: the hard-coded list ends at 048, so later per-tenant/RLS hardenings silently unwind on seed (074 patched by hand; no test enforces the list).

### 2.5 Data-layer gaps, honestly
- RLS ENABLE-only (no FORCE) on ~30 tenant tables (all `teacher/family/student/parent/coord/curriculum/mastery/library…`) — small practical exposure under BYPASSRLS-owner, but inconsistent with the 049 posture.
- Default ACL re-arm trap still armed until superuser command (072/077 say it, with the command).
- `users.password_hash` still readable by app role (login `SELECT *` sites; residual tracked in docs/PERFECT-100.md).
- `ai_calls`: no audit pairing, no retention; per-plugin budget dead (§5.3 key mismatch).
- Numbering drift: filename ≠ header ≠ prose references; cross-read carefully.
- `schema_migrations` created by the RUNNER but ALTERed/pinned/revoked by migrations — ordering dependency SQL can't express.

## 3 · User types, capabilities & the day-in-the-life of each role

### 3.1 There are exactly 13 canonical roles + a custom-role overlay
`server/src/auth.js:66`: **owner, principal, coordinator, counselor, finance, admissions, transport, facilities, technician, teacher, itadmin, parent, student** (mirrored by the DB CHECK — `counselor` was only made *issuable* by migration 079: five server gate lists and a screen already named it, yet no user could ever hold it — safeguarding's least-privileged role was structurally absent. Client fails closed: unknown role → student-lite surface, `roles.ts:25`). Dead code to know about: `roleScope()` (`auth.js:69`) has zero callers — real scoping is per-door.

**Custom roles (063 + `custom-roles.js`)**: `app.roles` = key/label/**base_role** (one of the 13) + `{allow,deny}` masks of `"METHOD /path"*` patterns. Resolution: base role checked first; **deny beats allow**; an allow can lift a base refusal (D-43, e.g. the shipped "Librarian" preset = teacher + library doors). Amplification ceiling: a non-owner role-admin may only allow doors **their own role already reaches** (`routes.js:189–195`) — self-promotion to owner-equivalent is impossible. Masks hit every gate: kernel require, kernel read-doors, plugin requireRole, and authenticate itself. Owner rows can never carry a mask.

### 3.2 Capability matrix (server-truth)
| Role | Server doors (representative) | Nav gets | Data slice |
|---|---|---|---|
| **owner** | everything + sole: fee-obligation **void** (620), `POST /migration/activate`, school-profile edit; exempt from mask ceiling | full admin set: /group, /people-admin, /plugins(+/settings), /rails, /roles, /migration… | whole tenant |
| **principal** | action-decide, notices, memory read, reports, full staff plane | /today /attention /ask /next /people /learning /operations /maintenance /reception /visitors /insights /memory /automation /fees /audit(via profile) | whole tenant |
| **coordinator** | coord.view (all 7), timetable writes, duty allocate, leave desk, visitors DESK, exams staff tier, gps | 6 × `/coord/*` + staff basics | whole tenant |
| **counselor** | **narrowest by design (RBAC-2)**: `GET /student/wellbeing`, safety-box readers + summary, concern list/outcome, doubts | only /today, **/wellbeing-queue**, /attention, /ask — no fees/audit/memory/insights | wellbeing plane only |
| **finance** | fee ledger read/confirm, plans, bi, tally, import, dunning | /fees, /fees/plans, /insights, /migration… | whole tenant, money-focused |
| **admissions** | funnel ADMIN (all but GET-leads-full-PII), roster, import (no shadow) | /today /people /operations (short list) | whole tenant |
| **transport** | gps ingest+read, transport events, whatsapp receipts, grid | short staff list | tenant, transport-focused |
| **facilities** | WO manage, assets, library, files upload | /maintenance(+report), /reception, /operations | tenant, ops-focused |
| **technician** | WO **status transitions only** (837), assets read | literally 4 items: /maintenance/technician /maintenance/assets /maintenance/report /ask | assigned work |
| **teacher** | classroom/copilot/support/exams-staff/timetable-grid/hr-desk | /today /attention /people /learning /library — ⚠️ `/teacher/*` screens exist but are **on no nav list** (mobile More-sheet only) | **`created_by=self`** predicates on homework; PTM notes 403 otherwise |
| **itadmin** | everything owner+itadmin share: api-keys, webhooks, metrics, ai/calls+eval, workflow-rules, audit/verify, plugins enable/disable/settings, roles CRUD, people.admin — ⚠️ **zero itadmin-ONLY doors**; NOT fee-void | /it, /plugins(+settings), /roles, /rails, /people-admin, /memory, /visitors | tenant, platform-focused, masked by ceiling |
| **parent** | me-scoped kernel: own children's /students, /attendance, /fees/obligations, /my-cases, pay-initiate + family.view 8 doors + parent.assistant 4 + PTM book + files download (child scope) | 9 × `/parent/*` | **`family.child_link`** — `assertOwnChild` 403-no-data on every `:id` door |
| **student** | student.world doors, homework submit, safety-box/doubt filing, loans/mine, files download (own), notifications | 6 × `/student/*` + library | **name-equality identity pin** (`ownStudent`, exactly-one active match or "not set up") + owner-pinned RLS (`creator_user_id`); 403 on /students, /attendance list |

Cross-cutting: RLS (tenant GUC; `schoolos.user_id` set ONLY by the two owner-pinned connections) is the real boundary; client guards (`grants.ts`) are display-only mirrors of `patternMatches`; nav filters by plugin enablement (`useKernelNav`).

⚠️ **Matrix defects:** (1) `POST /attendance/mark` advertises teacher but a SoD fallback inside the handler refuses everyone but owner/principal (routes.js:449–452) — the teacher door is unusable; (2) client `staffOnly` does not cover `/parent/*`, `/student/*`, `/calendar`, `/attendance` — staff can *render* those screens, only the server refuses; (3) counselor's real tools (safety box, concerns board) have **no client screens** — server doors, zero UI; (4) `/it` screen is mostly deterministic demo data — revocation/rotation/flags have no doors and render disabled (T305).

### 3.3 How each user actually enters the system
- **Staff password**: `POST /auth/login` → one of **four** outcomes: 200 session; **409 picker** (same email in N schools — email is the cross-tenant key, role is per-tenant row); **401 `{mfaRequired, challengeToken}`** (5-min pending token → `/me/mfa/verify`, TOTP from `auth.mfa_secrets` or single-use recovery code; MFA is staff-only, disable needs the password); **403 `{mustChange, token}`** → restricted token that reaches exactly `/me`, `/me/password`, `/auth/logout` → forced ChangePassword gate renders alone. Tokens carry `jti` (denylist revoke) + `ep` epoch (password change kills every other session); silent `POST /auth/renew` retires jti.
- **OTP (phone→SMS only)**: `/auth/otp/request|verify`; scrypt-hashed vault rows `USING(false)`; undeliverable send **withdraws** the code and says so (honesty law PRD-13); uniform 503 when the tenant's SMS rail is off (no number enumeration); `OTP_DEV_ECHO` dev-only. Google SSO: deliberately off, honest copy. Password reset = email rail + single-use sha256 token → same mustChange gate.
- **New school = self-serve**: `/onboard/signup` (public, 3/min) — one owner-path transaction: tenant + owner user + **full 29-row plugin catalog** (5 DEFAULT_ON, rails OFF until consciously configured) + audit + event; issues its own session; hard reload lands at /people-admin; world starts **empty by design** (`GET /dataset` allowlist — Meridian's demo blob is shown only to demo-savvy tenants; Live mode shows your real nothing).
- **Parent vs student after login**: parents get the 9-item family nav and `parentApi`; students get kiosk semantics — 30-min session TTL, `Clear-Site-Data` + no-store on every `/student/*` response, idle countdown door, AI doors refuse them outright.
- **School switcher**: memberships via `GET /me/tenants` → `POST /me/switch` re-issues token (re-audited "Switched school"), asks for the password inline on the 403 `passwordRequired` path, then full page reload; cancel on the pre-auth picker revokes the bootstrap token server-side. Campus switcher is **client-side only** — no server campus scoping exists.

### 3.4 Day in the life (nav → screens, per role)
**owner**: /today → /people-admin (provision staff) → /roles → /plugins (enable lanes) → /rails (configure creds) → /group (school profile).
**principal**: /today → **/attention** (the decide queue — everything escalates here) → /people drill → /fees/plans → /audit (who did what).
**coordinator**: /coord/home (staffing + gaps) → /coord/substitutions (decide) → /coord/workload (allocate duty, no-rank policy) → /coord/escalations → /coord/approvals.
**counselor**: /today → /wellbeing-queue (student filings, anon rows de-identified) → /attention → /ask.
**finance**: /fees (mark paid — the only settlement path; void = owner) → /fees/plans (generate from templates) → /insights (BI) → /migration (import) → receipts.
**admissions**: /funnel board (stage lattice moves, masked phones; enrolled ⇒ kernel `students.create` action for principal to approve).
**transport**: /today → /operations (fleet, GPS positions, delay events) → WhatsApp receipts.
**facilities**: /maintenance (WO board) → WO detail (10-state transitions, SLA) → /reception → /maintenance/report.
**technician**: /maintenance/technician (my queue) → assets → report issue → ask.
**teacher**: /today → /learning → my homework desk lives **off-nav** (/teacher/*) → submit reviews, copilot brief/ask/draft (deterministic, capped 200/day), PTM slots + private notes, file concerns (safety ⇒ principal approval action).
**itadmin**: /it → /plugins + settings (secret rotation audits key-names only, value-never-logged, risk:high on secret change) → /roles → /rails → /memory.
**parent**: /parent/family (children, today) → consents (decide-or-nothing) → requests (track) → /parent/fees (UPI/Razorpay links) → copilot brief/ask → PTM book → discrepancy filings.
**student**: /student/home2 (next class, counts) → homework + submit (one-shot, late at insert) → mistakes/flashcards/tasks (own, deletable) → print queue (school prints) → noticeboard → **safety box** (anonymous default) → doubts → results (published only).

## 4 · UI map — every screen, button and where it goes

*React **19** (docs still say 18) + Vite + TS, 158 files / 46k lines in `app/src`.*

### 4.0 Two truths that frame everything
1. **`LIVE_API = true` is a hardcoded literal** (`services/liveApi.ts:10`) — `VITE_LIVE_API` exists only in stale comments/empties. The live transport is always on; what's actually gated is `DEMO_BUILD = VITE_DEMO_MODE === '1'` (`App.tsx:28`), which in production builds tree-shakes ALL demo screens to `NotFound` (verified: `app/dist` has zero Demo chunks).
2. **Most screens are two screens behind one export**: `DEMO_MODE ? <Demo/> : <Live/>` (`lib/demoMode.ts:15`). The demo half is largely scripted fiction; the live half ranges from genuinely complete (visitors, exams, library, fee-plans, attendance, audit, notifications) to honest empty stubs (many maintenance screens) to *permanent* empties (wrong door paths).

### 4.1 Routing & gates (`App.tsx`)
BrowserRouter + lazy chunks, ErrorBoundary root. **AuthGate**: token is never trusted locally — cold-validates via `GET /me` (+ silent `POST /auth/renew` probe) then hydrates `/dataset`. **mustChange gate**: decodes the `mustChange` claim → renders *only* ChangePassword (gate mode). **staffOnly** redirects (`:197–209`): parent→/parent/family, student→/student/home2; staff previewing light-role screens gets the locked card. ⚠️ staffOnly misses `/parent/*`+`/student/*` *sub*paths when staff type them (server still refuses per-door — display-only leak). **KernelGate plugin="people.admin"|"library"** gates routes by `/plugins` enablement; VisitorsHost/FunnelBoard swap in when their plugins are on. Every route wrapped Guard→PageShell→Suspense. `/login` is a redirect; `path="*"` → NotFound with role-aware home. Unknown role → student-lite (fails closed). Campus: client-side only (`ROLE_CAMPUS` map; switcher hidden for light roles) — **no server campus scoping exists**.

### 4.2 Shell (663 ln)
Per-role nav arrays (the §3.1 matrix in §3) + i18n labels + **live badge counts** (`openActions`, `openWOs` from the API) + plugin-enablement filter + demo/live links stripped in prod. Topbar: command palette · CampusSwitcher · **Ask door** (light roles → their /ask page; staff → dispatches `schoolos:ask-toggle` → AiDock) · NotificationsBell (real doors: `GET /notifications` 45-s poll; school-wide items can't be cleared) · ProfileMenu (theme lives ONLY in Settings; "Switch demo role" + "Switch school" here; sign-out = token+session clear + `/auth/logout`).

### 4.3 Screens by area — what each button really does
**Login (576 ln — all four auth branches real):** email/password → full outcome matrix (§3.4); phone tab → OTP request/verify (⚠️ the *liveApi* wrappers `apiRequestOtp/apiVerifyOtp` are dead — Login has its own fetches); Google button permanently disabled with honest copy; demo role-grid cheat-sheet (`DEMO_MODE` only); tenant picker incl. inline password re-auth.

**Today** — live `/capabilities`+`/dataset` briefing; rows deep-link /attention, /action-center, KPIs. Demo money buttons mutate the store only. **Ask** + **AiDock** — staff-only dock; engine is `aiService.ask`, a **keyword-regex fixture** (matches /absen|fee|aarav|bus/ and returns hardcoded Meridian answers — "Aarav Sharma (8-B)", 82.3%, Bus 14) with `ctx` discarded; mic = toast. Every "AI" answer in the demo UI is fiction; the server's real copilots are deterministic too (§5).

**ActionCenter** — real `GET /actions` + `POST /actions/:id/decide` (optimistic removal + note; failure restores row). **Attention** — event feed, filters local. **Next** — honest "PREDICTED — by design not supported" placeholders.

**Attendance** — real date/class/section fetch + `POST /attendance/mark` (⚠️ who can actually mark: §3.2's owner/principal trap; DataTable sort affordances render on non-sortable columns and do nothing).

**LiveMode (/live)** — a **demo-account harness, not a connection wizard**: 9 seeded accounts (no student), each loads 4 live panels (`/students?grade=8&section=B`, `/attendance`, `/actions`, `/audit` — silently sliced to ≤12 rows). Buttons: "Mark unmarked as absent" (⚠️ only the FIRST 2 unmarked rows, copy says all), per-action Approve/Dismiss (real), Sign-out (⚠️ half-logout: no `/auth/logout`, no cookie clear — cookie session can resurrect), "Backend connected" badge (⚠️ unconditional, no probe). MFA/mustChange/multi-tenant dead-end as raw toasts; store identity/role/dataset never re-hydrated after sign-in here (previous tenant's chrome persists).

**Money:** Fees live = obligations tabs on real doors; ⚠️ Payments tab permanently empty (no door); Collect/Send-reminder/waive/export/receipt-print = **demo store mutations or toasts — no money door is wired in liveApi** (the server doors exist — §1 — the UI doesn't call them). FeePlans = the one honest money flow: real create/generate/list + server-count-quoted confirm modal; gating mirrors server; `POST /fees/obligations/:id/void` exists in liveApi with **no UI caller**.

**People:** PeopleAdmin — real lifecycle (create/suspend/activate/reset/transfer/PATCH/promote/withdraw + CSV import) via adminApi; ⚠️ destructive confirms use raw `window.confirm`; no client role check beyond the route guard. PersonDetail/Cases etc mostly wired to real /students, /my-cases, POST /cases.

**Maintenance family (12 screens, the widest demo↔live spread):** real doors exist for WO list/status and assets only. **WorkOrderDetail** — the best-built: full 10-state machine, live buttons `POST /work-orders/:id/status`, `canTransition` matches server exactly; ⚠️ fetches a 200-row list to `.find()` one WO (no GET-by-id door — on blocks.md as L4's missing door). **TechnicianWorkspace** — live transitions real but **no client role check** (server refuses after click); demo "Voice completion" = timer + canned transcript (no mic anywhere). **ReportIssue** — ⚠️ NO demo/live split at all: always calls the mock; photo = hardcoded filename; two uncleared timers. **Preventive/Intelligence/Inventory/Map/Vendors/Inspections** — live = `Empty` "Not connected yet" stubs (though `/assets`+`/work-orders` exist for the map); demo: "Create work order" toasts nothing, "Start inspection" hardcodes "Manoj Patil", "Copy tag reference" copies nothing, inventory restock = local state, `NOR-AC-04` and headline figures hardcoded, SLA% counts cancelled WOs as met. Two are **orphan routes** (no nav, no link): inventory, vendors. `Board` view drops resolved/closed/cancelled jobs entirely. **QR is fake** — `QRPattern` is a decorative hash grid that encodes nothing.

**Transport** — mock tracking + counter "simulator"; `apiTransportEvent` dead export; the real board is the ops.visitors **VisitorsBoard** (front desk): the most complete live flow on the platform — check-in → pickup OTP send (dev code printed on-screen under OTP_DEV_ECHO) → verify → complete/deny with audited fail-closed override; renders server 409 invariants through `friendly()`. ⚠️ its `apiVisitorVerify` uses a bespoke raw fetch (skips 401 redirect + CSRF).

**Learning/Exams** — Learning screen: local publish + 6 toast-only controls. The REAL exam surface (`teacher/ExamMarks.tsx`) wires exams/marks-bulk/publish/execute/board-policy correctly — but is **not routed** in prod and demo mode replaces it with an empty card. LibraryLive = fully real (books/loans/returns/overdue) + the app's ONLY `grants.ts` consumer; `Library.tsx` is dead code imported nowhere. Documents upload controls non-functional (`adminApi.files*` — three dead wrappers while files.store doors exist). Homework/SubmissionsInbox/MyLeave (teacher) — real doors; bulk review = sequential POSTs, promised progress counter never rendered. Five teacher screens (`CurriculumProgress/MasteryMap/DutyWorkload/ProgressStory/`…) exist but are **unrouted** — `TeacherNav` links to 10 paths that all hit NotFound; MasteryMap's class picker is inert. `teacherFixtures.ts` is a probe-first shim (real door 200→live; 404→fixture forever; also no CSRF/credentials).

**Coord suite (6 screens, coordinator/principal)** — all live via `coordApi` (home, substitutions decide, workload-no-ranking, curriculum-monitor + real `window.print()`, escalations, approvals). ⚠️ every screen fetches BEFORE its own gate (doomed 403 then denied-card); ⚠️ coordApi has no CSRF/credentials (breaks cookie deployment); EscalationsQueue "Resolve with handoff note" **only copies to clipboard** (honestly captioned); `allocateDuty` wrapper dead.

**Parent suite** — FamilyHome/Consents/Requests/Copilot/Fees on real family.view+parent.assistant doors via parentApi (its own transport, bearer-only; the app's only authz-vs-outage distinction — `isDeniedError` renders a calm lock). ⚠️ `getAssignments` calls an unregistered door → permanent "Not available yet"; ⚠️ `getExplain` builds `?topic=` against a `/:topic` route — guaranteed 404 if ever wired; three dead exports.

**Student suite** — StudentHome2 real (`/student/home`, session TTL countdown, print/mine); ⚠️ task ticks persist only `kind==='task'` — other checkboxes evaporate at reload; Study/Results tiles = "soon" toasts. Noticeboard/PrintQueue/WellbeingQueue staff screens real-read; "Regenerate weekly" = refetch theatre. PrintButton success announced ONLY through a 1-px screen-reader node. SessionSafety = honest countdown + real logout.

**Governance/admin:** Audit — real `GET /audit` (demo feed client-invents policy refs). Memory — reads fixtures (`apiMemory` dead export). Constitution — reader with self-contradictory copy (`:262` vs `:99`). AiGovernance/AiUsage — **fixtures presented as telemetry**, zero controls on AiUsage. Settings — the only theme UI; hi-IN partial (57%) honestly surfaced; notification prefs device-local; DSR button real (pack.dpdp). MfaSection — enroll/verify/disable real; ⚠️ promises a QR and ships raw-text otpauth URI only; recovery codes shown-once honest. Plugins + PluginSettingsForm — enable/disable/settings real doors; ⚠️ inline toggle applies the local flip even when the server call fails; validation client-only. RolesAdmin — real CRUD/mask editor; delete button doesn't exist (retire-in-place server-side); roleSend bypasses the 401 redirect. **ItAdmin — every control permanently disabled** (honest: the doors don't exist — T305). Migration — the live path IS wired (sources/stage/validate/commit/activate) alongside a "simulated" toggle; the 5,099-records figure is a screen-local constant. Automation — demo-only keyword compiler. Group — multi-campus roll-up is seeded fiction (makeRng) but is the app's only `permissionError` consumer. Onboard — real signup flow → /people-admin. RailsBoard — real `/capabilities` + plugin badges; `commsFailed` always undefined.

**Demo suite (DEMO_BUILD only)** — Demo launcher ("Start the switch→" is a styled `<span>` with no handler; loop cards hard-reload), DemoDay (scripted timers; **3 suggested-action buttons literally do nothing** — `onApprove={() => {}}` — while labelled "Run" despite "APPROVAL REQUIRED" text; edited drafts never sent), DemoParent (8-phase fiction; "Pay now ₹18,500" = state advance; audit written as "Ms. Rao" whoever you are; "callback queued" while nothing is), DemoSummary (scoreboard arithmetic on constants while claiming "read from this session's live state"). DemoBar is actually the production MobileTabbar.

### 4.4 The data layer's real shape (this is where UI honesty lives or dies)
**Six transports, one compliant.** Only `liveApi.call` sends `credentials:'same-origin'` + `X-CSRF-Token` (§6.3's cookie story) — parentApi/studentApi/coordApi/teacherFixtures + the inline visitors fetch are bearer-only: **under cookie-session deployment half the app's POSTs would CSRF-fail**. Error funnel: 401 → wipe + hard-navigate (real cause discarded); everything else → one generic `Error(message|HTTP <code>)` — **no 403/409/429 differentiation anywhere**; `friendlyErrors.ts` covers 7 string needles (plugin-off, guardian-phone, 2 visitors invariants, fetch-fail, timeout) — so a 403 on a staff screen shows "HTTP 403" to a human. No timeout/AbortController anywhere except Login+renew (hung request = hung screen). **9 dead liveApi exports** (incl. the OTP wrappers, apiFeesSummary, apiTransportEvent). The store (`state/store.tsx`, 73 importers) is **not persisted** (reload = principal/north demo state), hydrates inbound-only (never writes), fabricates chat receipts (900/2200 ms), `syncing` never clears, and invents audit policy-refs in demo mode. **`/dataset` is not a client mock** — server-generated (esbuild-evaluated mock modules), ~22,000 rows for meridian; so demo and live share one data origin and only the transport differs. Three divergent "demo accounts" tables exist (liveApi 9 · Login grid 12 · store personas 12 with different names) — only the first two log in.
**i18n:** hand-rolled, reaches 5 files only (Login/ChangePassword/Settings/MfaSection/Shell); hi-IN covers 50 keys (57%); all service strings English-only.

### 4.5 Dead-control inventory (every button that lies — the fix list)
Demo theatre: DemoDay ×3 do-nothing Approves · Demo "Start the switch" span · ReportIssue (photo/voice/override/assign, no split) · Fees Collect/reminder/Message/Renew · Maintenance Scan-QR + Preventive create-WO + intelligence share + inventory restock · Assets copy-tag · AssetDetail start-inspection · Inspections raise-WO · Noticeboard regenerate · Reception "Test call" · Settings ×5 not-connected · EscalationsQueue clipboard-only · MasteryMap inert picker · Automation compiler · AiUsage/AiGovernance fake telemetry · ItAdmin disabled rows (honest) · Print/Reports/Documents exports. Half-truths (live but flawed): LiveMode mark-all-but-2 + fake badge + half-logout · Study/Results "soon" toasts · ExamMarks unrouted · void-door unwired · teacher unrouted screens · parent getAssignments wrong path. A11y: nested `<button>`s (Preventive rows), invisible-only print confirmation, 8 teacher classes with zero CSS (unstyled FAB).

## 5 · Plugin domains & the AI subsystem

*29 plugin modules plus `_shared/` (6 seam files) = **30 directories** under `src/plugins/` (K5: the
"29 vs 30" discrepancy was a counting-method difference — module count vs directory count; both are now
stated). Every line below was read from source.*

### 5.1 The shared guard model (every plugin door uses these three)

| Guard | File | Behavior |
|---|---|---|
| `require(...roles)` | kernel `requireRole` (`app.js:1001–1024`) | `app.authenticate` → base-role check → **custom-role mask** (a DENY beats an allow; an ALLOW can lift a base refusal, D-43) → 403 `role X not permitted`. Delivered to plugins via the kernel object `app.js:1028`. |
| `lifecycleGate(sysq, id)` | `_shared/lifecycle-gate.js:8–25` | Per-request read of `app.plugins.status` (no cache); outside `enabled|active|degraded` → **409** with a friendly label. |
| `uuidParams('id')` | `_shared/uuid-param.js:6–16` | 400 unless param matches UUID regex — a malformed `:id` never reaches a `WHERE id=$1` cast (raw PG 22P02 → 500 otherwise). |

### 5.2 Plugin catalog (purpose · doors · tables)

**Money & payments**
- **payments.razorpay** — gateway *orders* only; settlement stays with kernel `fee_payment_settle` (`POST /orders` finance/owner/principal; **public webhook**). 3-phase with `FOR UPDATE` before network call, `AbortSignal.timeout(10s)`; HMAC over raw wire bytes, candidate-secret set capped 50 (throws rather than verifying a truncated list), uniform 401 to kill enumeration, ±freshness window, replay dedupe `ON CONFLICT (tenant_id,event_id) DO NOTHING` → 200 no-op. ⚠️ No idempotency keys, no refund path.
- **payments.upi** — `upi://` intent links + signed webhook facts (env `UPI_WEBHOOK_SECRET` **only**, never per-tenant; boot refuses if enabled without it; redteam fix H5 moved HMAC before lifecycle gate). ⚠️ Obligation lookup lacks explicit tenant predicate (RLS-only); never compares signed amount to the obligation; VPA derived from student's name (not manifest `default_vpa`).
- **accounting.tally** — read-only Tally 4.1 export: IST day-book of confirmed payments, content-addressed XML (sha256 ref), audit digest never amounts. ⚠️ `?company=` interpolated raw into the XML envelope (injection surface).

**Comms rails (headless — `routes: []` on all three)**
- **rails.email** (logger|smtp — hand-rolled SMTP over node:net/tls, STARTTLS, AUTH LOGIN, dot-stuffing), **rails.sms** (logger|http-generic), **rails.whatsapp** (logger|http-generic|**Meta Cloud API** + DLT template renderer reading `comms.whatsapp`'s registry). E.164 enforced; **dedupKey required** (real dedup is `app.communications.dedup_key`). ⚠️ All three return `ok:true, provider:'logger'` when credentials missing **and when the settings read fails** — delivery honesty is enforced *by callers* (dispatcher/kernel), not by the rails; `rails.email` can AUTH LOGIN in cleartext if server doesn't advertise STARTTLS.
- **comms.whatsapp** — DLT template registry (non-clobbering jsonb merge) + read-only receipts over `app.communications`. No send door exists (intents from orchestrator/plugins send). ⚠️ `/receipts` has no tenant predicate — RLS-only.

**People & families**
- **people.admin** — provisioning (all roles but owner; owner-provision attempt = high-risk audit), suspend/activate (never owner), temp passwords `word-word-hex` scrypt-hashed returned **once** with `force_change=true`, **no role-change door**, transfer/promote/withdraw with `enrollment_history` written *before* the flip (same tx), CSV import (500 rows, per-row SAVEPOINT). Explicit `tenant_id` everywhere.
- **family.view** — parent read-plane: `/parent/home`, child timeline/academics/attendance/exams, consents (decisions final — DB 034 guards too), unified request center (append-only `request_event`), leave request → kernel approval `parent.leave.<id>` owned by coordinator. `assertOwnChild` on every `:id` door → 403 with no data. ⚠️ **Silent-empty defect**: selects `total_pct, published_at` from `plugin_exams.report` — columns that don't exist (025); the error is swallowed → parent report cards render empty forever.
- **admissions.funnel** — lead→enquiry→form→interaction→offer→enrolled lattice enforced server-side; terminal rows refuse moves; `FOR UPDATE`; phone-normalized duplicate guard; applicant PII stays in `plugin_admissions`; `offer→enrolled` raises a kernel approval (never writes `app.students`); stage history append-only.
- **ops.visitors** — gate pass + **guardian-verified pickup OTP**: CSPRNG code, scrypt-vaulted in `plugin_visitors.pickup_otp` (kernel-only), TTL 5 min, `timingSafeEqual`, consumed-on-success; deliberately NOT `app.auth_otps`; delivery compensation — undeliverable send **deletes the vault row + reverts status** then 503; fail-closed release needs owner override **with a mandatory note** (`UNVERIFIED RELEASE OVERRIDE` audit). ⚠️ `pickup_otp_max_attempts` setting never read.

**Academics**
- **teacher.classroom** — homework CRUD + attachment **scheme allowlist** (stored-XSS control), one-shot submissions (structural via unique + SAVEPOINT), late flag at insert, teacher-only review (`FOR UPDATE`), leave → kernel action. ⚠️ `GET /teacher/leave/mine` **writes state inside a GET**. NO attendance/marks doors exist here.
- **exams.assessment** — marks entry (bulk ≤300 rows, per-row savepoints), deterministic `canonical()`+sha256 report assembly, publish via approval spine (SoD: proposer can't approve), moderation as overlay never rewriting frozen snapshots, per-board `board_policy` (absent → byte-identical legacy digests), attendance floor default 75%, weightage must sum **exactly 100**.
- **pack.cbse** — read-only rules engine R1–R6 over plugin_exams (weightage, grade scale, bounds, 75% eligibility, report-integrity re-derivation, board identity) + OASIS CSV export; its "gate" is raising kernel obligations (`cbse.weightage.<exam>`), not blocking. ⚠️ `weightage_strict` setting never consulted.
- **student.world** — the StudentOS kiosk plane: `/student/home/homework/results`, mistakes/flashcards/tasks (private via `user_session` GUC — `withStudentUser` sets `SET LOCAL ROLE schoolos_app` + user GUC; staff without the GUC see nothing), print jobs (5 MiB, `no-store` + `Clear-Site-Data` headers, done = the only DELETE in the repo), noticeboard, **anonymous wellbeing** filings (reader tier counselor/principal/coordinator/owner/itadmin — never general staff; anonymous rows refuse per-row reads 403). ⚠️ Student identity pinned by name-match (`name_matches === 1` guard); `.catch(() => rows:[])` swallows real errors as "no data".
- **teacher.support** — one-tap concerns (append-only status events, escalation → kernel action), **anonymous-by-default safety box** (assign/close, critical pages principal), deterministic doubts + FAQ promotion, interventions, PTM slots/bookings with **teacher-private notes** (dedicated `withNoteUser` session-var). ⚠️ comms written directly to `app.communications` with dedup receipts — bypasses the workflow-rules engine.
- **coord.view** — coordinator command plane (`AUTHORITY=coordinator+principal`; teachers refused): staffing derived from `teacher.leave`⋈`timetable_slots` (no writes), substitution decide with **desk-aliasing guard** (sub-approvals decide only substitution payloads), SoD proposer≠decider, curriculum pace vs term, workload *aggregate only — no rankings* (`overload` boolean), least-loaded duty allocation (load→name→id tie-break), escalations union (concerns + open family requests), **keyword-only copilot** with private capped ledger (200/mo, IST).

**Operations & assets**
- **ops.timetable** — grid, substitution UPSERT (`ON CONFLICT (slot_id,date)`), deterministic suggester (teaches-subject, stable tiebreak), **idempotent** attendance period-autofill (`WHERE NOT EXISTS`, never touches human marks — always writes 'present' ⚠️ ignores its own `autofill_default` setting). No substitute search.
- **transport.gps** — POST positions (staff JWT — **no webhook/HMAC exists** ⚠️) + delay guard: `delayMins ≥ 10` raises ONE approval `transport.delay.<id>` with pre-drafted WhatsApp message; `deviationM` collected but **no geofence compares it**; reads bounded to `now()-30d` window (no deletion); GET includes honestly-labelled simulated positions.
- **library** — catalog/issue/return with copy-count math re-checked under `FOR UPDATE`, fine at return = overdue days × `fine_per_day_cents` (UTC-exact comment), retire not delete, `loans/mine` for students (name-match, fails closed), ILIKE escape, no comms (overdue list only).
- **health.clinic** — append-only visits (corrections = new row `CORRECTION of <id>`), sick passes (real `valid_until` epoch, TTL clamped 8h, revoke the only mutation), guardian notices ONLY for sent_home/hospital_referral via kernel actions (`clinic.notify.<visit>`), settings-gated.
- **hr.leave** — one `plugin_hr.leave` row per staff-day, past-date refusal vs IST today, friendly duplicate 409 via SAVEPOINT, roster = absent × on-duty, cancel keeps row. NO approval flow, NO balance table; `absence_feed` contract declared by ops.timetable is read by nothing.
- **ops.udise** — deterministic AY×grade×section CSV/JSON export, refuses without configured UDISE code, **gender honestly `not_recorded`** (no column), CSV formula-injection defense, CRLF.
- **ops.import** — dry-run only (schema/validate-mapping/shadow — all SELECTs): per-kind canonical target schema, all-field error collection, typed coercion, shadow diff vs live rows. **No CSV parsing** (JSON rows in). Not wired to the kernel staging path (camelCase vs snake_case mismatch ⚠️).
- **files.store** — 5 MB cap enforced four ways, mime **and** extension agreement, server-side rename, `storage_path` relative under `FILES_DIR`, traversal rejected, download streams `no-store`, guardians/students reach scoped files via child links, **audit-before-response** (verdict + audit commit before bytes/403). ⚠️ No presigned URLs exist (verified) — bytes served by the API process.
- **parent.assistant** — deterministic-only (verbatim: *"NO external LLM is contacted anywhere in this module"*): per-child brief (attendance/homework/exams/consents/reports/fees/requests), keyword ask answering ONLY from own children, template drafts, plain-language explains; double-enforced guardian scoping; private monthly budget (100); banned-word tone filter; HONEST_UNKNOWN constant. ⚠️ `brief_log.payload` retains full child-name JSON with no purge path.
- **teacher.copilot** — deterministic day-brief + ask/draft, seeded curriculum tree with audited check-off, A3 mastery maps with **idempotent evidence decay**; budget ledger `copilot.call` 200/day; sibling-schema drift probed via information_schema; ask reuses `buildBrief()` so ask can never read more than the brief.

### 5.3 The AI gateway — contract and reality (`_shared/ai-gateway.js`)

- **Ledger**: every attempt writes `app.ai_calls` (ok|error|budget) — kernel pool only, plugin role has SELECT-only (070). **No prompt or completion text is ever stored.**
- **Budgets enforced before the provider runs**: (1) per-plugin `ai_budget` — `off` if literally `false`, else strictest finite `calls` wins (SQL returns NULL, never 0 — the `Number(null)===0` bug is commented in); (2) per-tenant daily cap `tenants.config→ai.dailyCallCap` default **200**; budget-refusals don't consume budget. ⚠️ **The plugin-level cap is dead**: gateway reads `calls`, every seed writes `calls_per_day`/`requests_per_day` (verified — no writer of `calls` exists). Only the tenant cap is live.
- **Providers**: `logger` (sandbox echo, char/4 token estimate) and `openai-compatible` which **intentionally returns 'unconfigured' even with keys present** ("credentials-last, D-32"). Unknown provider → 503 + error ledger row. `registerProvider` exists, unused.
- **Reality check**: exactly ONE consumer — the kernel doors (`POST /ai/call` staff-not-student +30/min, `GET /ai/calls` owner/itadmin, `POST /ai/eval` 5/hr). **Zero plugins call it** despite manifests declaring `ai` capabilities. `call()` takes a bare string input — no temperature/model/messages, no output validation, no PII redaction. Any real AI feature must extend this contract first.
- ⚠️ `/ai/call` lets any staff role claim **any pluginId** — attribution is caller-trusted.

### 5.4 The workflow rules engine (L2-5.2) — exact path

Rules live in `app.workflow_rules` (condition `{field,op∈exists|equals|contains}` + action `{kind:outbox|comms,…}`; **no DELETE grant** — the DELETE door soft-`enabled=false`'s). Runner `scripts/workflow-worker.js` polls `app.outbox` rows never scanned (`workflow_scanned_at IS NULL`, excluding its own `wf:` outputs = loop-breaker), evaluates matching enabled rules, writes **exactly one** action row with `dedup_key='wf:<rule>:<event>'` (partial uniques from 071 make (rule,event) fire-once), stamps the marker **last, same tx** (crash = rollback, no silent loss). `comms` actions → queued `app.communications` (dispatcher sends them); `outbox` actions → derived topic re-emitted for subscribers. Management: `GET/POST/DELETE /workflow-rules` owner/itadmin. **Note**: plugins today write comms directly rather than through rules — the engine is real but barely consumed.

### 5.5 Enablement lifecycle

- Provision: `app.plugins` rows only via numbered migrations + signup path (`ensurePluginCatalog` — 29 catalog rows; day-one on: people.admin, ops.visitors, library, ops.timetable, files.store; **credential rails always OFF**; upsert `WHERE NOT EXISTS` self-heal on `GET /plugins`).
- `POST /plugins/:id/enable` (owner/itadmin) — validates class/semver/manifest size/permissions bounds; **no install/uninstall code path exists** ("uninstall" is manifest-declared data policy). Disable = **drain protocol** (reassign open actions to Principal desk, retained-lineage count, status=disabled, audited). Settings save is the secret-rotation door: `FOR UPDATE` prev row, changed-keys diff, `isSecretKey(/secret|password|token|api_?key|webhook|credential/i)` → **risk high, values never recorded** (the CTE trap that would mis-flag every save is documented at `routes.js:1741`). Settings-read doors strip secret-class keys for non-privileged roles. Manifest is the settings contract: unknown keys refused, `settings-form` doors render/write-only secrets.
- `loadPlugins` throws on ANY plugin failure ("a plugin that cannot mount must never half-exist" — that's the crash you saw fixed 2026-09-12).

### 5.6 The AI-receptionist angle — honest answer

**There is no telephony/voice/ASR backend in this repo** (twilio/asterisk/sip/etc.: zero code hits). The "AI Front Desk" screen (`Reception.tsx`) is a beautifully-designed surface over **mock data** served through `/dataset` from a server bundle of `mock/reception.ts`. What's real beneath it: the `ops.visitors` gate desk, the comms rails, and the deliberately-empty AI gateway contract. The receptionist today is product DNA expressed as UI + fixtures; a live call feature needs provider integration + the gateway contract extended (model/temperature/output-schema) — neither exists yet.

## 6 · Operations, tests, process & honest current state

### 6.1 Test suite — the quality engine
**74 test files, 534 named tests** (`node --test`, serial, ~30–90 min at scrypt cost). Exact commands:
```bash
cd server && npm test                                    # full suite
node --test --test-concurrency=1 --test-timeout=60000 tests/<file>.test.js   # one file
TEST_DB_NAME=schoolos_<lane> npm test                    # lane DB (D-41)
```
Harness (`tests/helpers.js`): `setupTestDb()` drops+creates the lane DB as postgres, runs **migrate → bootstrap → seed** (order matters), then sets `DATABASE_URL` *before* any src import. `loginAs()` walks the D-44 mustChange contract (403 → /me/password → fresh session). Coverage spans every plugin lane + the security invariants (rls-boundary pins the owner-path privilege count; acl-d35 guards the DELETE ban; audit-integrity walks the hash chain; comms-honesty forbids fake 'sent'). **Frontend has ZERO tests** — the client is guarded only by `tsc` in CI.
⚠️ Live reds/traps: `tally.test.js` fails at HEAD (fresh-DB lifecycle: the test enables only tally, then calls a UPI door — its rewrite made a previously-silent invariant assert for the first time); `fees-dunning` carries a **calendar bomb armed 2026-10-06**; CI's `NODE_ENV=test` posture diverges from what the OTP tests model.

### 6.2 Scripts (`server/scripts`)
`migrate.js` (advisory-locked, checksum ledger on `app.schema_migrations`, **hard-fails on drift** of an applied file, one tx per migration) · `bootstrap.js` (role + grants matrix for fresh DBs) · `seed.js` (§2.4 — two guards after the incident) · `comms-dispatcher.js` (SKIP LOCKED drain, backoff, park at 8 attempts, **'undeliverable' as the fourth outcome** when sandbox meets production, per-recipient fan-out, ≤500 recipients refused-not-truncated) · `outbox-worker.js` (relay; self-heals 042/073 columns) · **six shipped-but-NEVER-SCHEDULED workers**: workflow, webhook, day, retention, dunning, reconcile-payments (OPS-8 — in a real deploy today, rules/webhooks/retention silently don't run) · gates/tooling: `check.js`, `permission-matrix.js` (generates docs/PERMISSION-MATRIX.md: **263 routes · 218 role-gated · 32 auth-only · 13 public · 0 unguarded**), `parity-gate.js` (UI↔door parity, report-only), hunt scripts (`itadmin-hunt.mjs` leaves its tenant behind) · `backup.sh` — genuinely good (globals + per-DB -Fc + `--list` verify + .incomplete marker + umask 077 + KEEP_DAYS=7) **but nothing schedules it** (crontab isn't even installed).

### 6.3 Environments & topology
`server/.env.example` documents the surface (JWT_SECRET ≥32 outside dev, SEED_GUARD, OTP/SMS, dev doors, webhook secrets; ⚠️ `RAZORPAY_WEBHOOK_SECRET` is in `.env` but missing from the example). Production boot **refuses** on: localhost DB URL, `CORS_ORIGINS='*'`, non-strict SEED_GUARD, short JWT secret. Dev doors (`AUTH_DEV_SSO`/`OTP_DEV_ECHO`/`RESET_TOKEN_DEV_LOG`) fail closed — `development` **and** explicit opt-in required (a relaxed version was tried and reverted; pinned by test T101). Frontend flags: `VITE_DEMO_MODE` (demo UI, dev-only — the production build ships no demo), `VITE_LIVE_API` (gates `/live` + live boards), `VITE_API_BASE` (default 127.0.0.1:8080). Docker: digest-pinned Postgres 18 + Node 26, services api/retention/outbox/comms — ⚠️ the api command runs **bootstrap before migrate**, the exact inversion (OPS-1) that makes the only documented production start path unable to boot a fresh DB. CI 3 jobs: server (ci-init-db → migrate → permission-matrix → parity report → **npm test** → check) · web (tsc+build only) · security (secret-scan + npm-audit fail-closed). CI never builds or smoke-runs the image (OPS-14) and runs Node 22 against the image's 26.

### 6.4 The `.coop` factory (how this codebase was actually built)
Five lanes + one master: **L1** server money/academics · **L2** server platform/security · **L3** records/data engine · **L4** frontend money UI · **L5** frontend shell/identity · **S0** orchestrator (sole committer, gate runner, conflict resolver). Mechanics: strict P2→P5 queues, per-task journal lines, file claims in `blocks.md`, **D-34 help channel** (post findings there FIRST then continue; S0 answers inline `[S0]`), **D-27** 90-min-silence takeover, **D-40** claim migration numbers before creating files, **D-41** lane test DBs, **D-10** full-suite runs S0-exclusive. 43 rulings D-1…D-44 (D-28 absent); the load-bearing ones: D-33 quality bar (code + negative tests + tsc + honest UI), D-35 no-DELETE law, D-37 auth contract debts (all five landed), D-44 cross-zone repair law. Waves 2–5 run 4-hourly gates from T+0 = 09-10 13:10 UTC, RUN-STOP T+46; final report `STILL NOT GOOD_3.md` **does not exist yet**. Audit of record: **docs/PERFECT-100.md** — 122 findings, honest scores: implementation **53/100**, enterprise-readiness **34/100** (fell because the audit went deeper, not from regressions).

### 6.5 Dev-DB reality
**73 `schoolos*` databases** on this host — sediment of lane runs and review rounds (`r20a…r21j`, `rev20_*`, `s0fix1…7`…). Dev `schoolos`: **2 tenants** (meridian, 15 users + rebuilt `lkmmm`), 75 migrations applied ending **077** — even the dev DB trails the 079-file tree; `schoolos_test` at 69/ending-071. Backups: exactly two -Fc dumps in `backups/manual/` (pre- and post-incident-rebuild), ⚠️ mode **644 world-readable child PII** — and `backups/` is NOT in `.gitignore`, one `git add -A` from committing PII.

### 6.6 Git — the single biggest live risk
Repo initialized 09-06; 138 commits; local == origin **at `b40996e` (2026-09-11 23:46)**. Nothing has been committed since while **129 working-tree paths (92 modified, 37 untracked) carry three days of the heaviest work in the project**: migrations 072–079, `custom-roles.js`, `_shared/delivery-honesty.js` + `phone.js`, 18 new test files, the whole PERFECT-100 remediation, today's live fixes. A disk event erases the post-incident hardening — and the rebuilt account's schema. D-9 forbids worker commits; S0 holds git. (This map's §6 was written 02:09 UTC observing exactly this state.)

### 6.7 Docs map — what to trust
- **Current:** `docs/PERFECT-100.md` (audit of record) · `docs/DATA-FLOW.md` (683 ln, the architecture spine) · `docs/BACKEND-MAP.md` · `docs/PERMISSION-MATRIX.md` (generated) · `docs/ONBOARDING-NEW-SCHOOL.md` · this file.
- **Stale/fiction — do not cite:** README's "62 screens / 25/25 factory", HANDOFF's counts (232 tests / 53 migrations — now 3× larger). `.ui-audit/` screenshots predate the entire sprint; `.audit/` is the sealed pre-`.coop` corpus.
  - **Partially remediated 2026-09-14 (§6.5 item 29):** the hand-typed pass counts in `RELEASE-CERT.md` ("114/114") and `FEATURES-STATUS.md`/`RELEASE-NOTES.md` ("183/183") are **gone** — each now points at `docs/VERIFICATION.md`, which is generated by `server/scripts/verification-artifact.js` from the runner's own output and records the run log, source fingerprint and exit code. Real figures at that time: **87 test files · 637 declared cases** (a "15 files / 114 tests" claim could not have been true for a long while). The route-count contradiction in `FEATURES-STATUS.md` is still outstanding.
- **Voice receptionist:** out of this repo's scope by owner ruling **D-25**; branding/mock UI only (§5.6) until the owner commissions it.

## 7 · The journey of every request type (worked examples, traced through real code)

**A. Staff password login (`lk@gmail.com`):** browser → `POST :8080/auth/login {email,password}` → rate limit 20/min → lookup joins `users⋈tenants (+mfa_secrets)` — 0 rows → constant-time `dummyVerify` → uniform 401; >1 tenants → **409 picker**; scrypt verify fail → 401 (same shape/timing); MFA on → 401 JSON challenge; success → `issueSession` (JWT with `session_epoch` claim) → **403 `{mustChange:true, token}`** if temp password (restricted token can only reach /me, /me/password, /rails/*); else **200 `{token,user,tenant}`** + `audit_log` row `sign_in`. SPA stores token, cold-opens every session with `GET /me`.

**B. Any authenticated read (`GET /students`):** JWT decode → epoch check → `withUser(c, tenant, role)` opens a pooled client → `SET LOCAL app.tenant_id / app.role` + `SET LOCAL ROLE schoolos_app` → query runs **inside RLS** (policy filters `tenant_id = current_setting(...)`) → column masks applied (077 ACL) → rows back. The kernel's own privileged pool (`q`/`sysq`) is only used where deliberately chosen (auth lookups, plugin settings, vaults, ledger writes).

**C. Attendance mark (`POST /attendance/mark`):** role guard (gate says owner/principal/coordinator/teacher; the handler currently answers 403 for anyone but owner/principal — T105c, §3.2) → tx: upsert today's rows (`UNIQUE(tenant,student,date)`) → absent children's guardians looked up → absence notices **queued** into `app.communications` (status `queued`, dedup-safe) → append `audit_log` → `emitEvent(attendance.marked.v1)` writes `app.events` + `app.outbox` row **in the same tx** → commit → 200. Async after: `comms-dispatcher` claims queued messages (`FOR UPDATE SKIP LOCKED`), sends via rail (or marks failed — sandboxed sends are *never* labeled delivered), `workflow-worker` scans the outbox row, fires any enabled rule once (`wf:` dedup), subscribers drain. The HTTP response never waits for any of that. (Caveat: none of those workers is scheduled by the shipped compose — §8c#24.)

**D. Parent OTP login:** `POST /auth/otp/send` → scrypt-vault in `auth.otps` (attempt-counted, expiring) → SMS rail (sandbox-flagged honestly) → `POST /auth/otp/verify` → timingSafe → same `issueSession` as password login (epoch, mustChange, audit parity).

**E. Payment webhook (UPI/Razorpay):** public route → **raw wire bytes captured** (shared content-type parser) → HMAC verify (constant-time; uniform 401) → freshness window → replay ticket `INSERT … ON CONFLICT DO NOTHING` (dup = silent 200) → resolve tenant → lifecycle gate → write facts (`payments` initiated→confirmed, `fee_obligations` paid, ledger rows) → `emitEvent(fee.payment.v1)` → audit. Money is never moved by the plugin — settlement is kernel-owned.

**F. AI question (staff):** `POST /ai/call` → `app.authenticate` → student refused 403 → rate 30/min → `callAI({tenantId, pluginId, purpose, input})` → budget check #1 plugin (`ai_budget`, strictest `calls`; **effectively always NULL**) → #2 tenant daily cap (200) → provider `logger` → **sandbox echo** → ledger row (never stores the text) → 200. The "copilot"/"assistant" plugin features skip this gateway entirely — deterministic templates with private ledgers.

**G. Tenant switch:** owner/itadmin with `tenant_scope=053` → `GET /me/tenants` → pick → `POST /me/switch` validates membership → new token same epoch → dataset refetch. Logout rotates `session_epoch` → every old token of that user dies instantly.

**H. Plugin disable:** `POST /plugins/:id/disable` → drain: open actions of that plugin reassigned to Principal desk, event lineage counted (30 d), status=disabled, audited → every plugin route now 409s live (gate reads DB per request — no cache to go stale).

## 8 · Known debts, gaps & imperfections (the honest list)

### 8a · Plugin & AI domain risks (from the plugin audit; other tracks' risks merge here)
1. **AI gateway has zero plugin consumers**; its only non-sandbox provider is hard-disabled (`ai-gateway.js:33–34`). `call()` can't express model/temperature/output-schema; no prompt-side PII masking. Real AI work must extend the contract first.
2. ~~**Plugin-level AI budget is dead**~~ — **FIXED 2026-09-15 (PLG-7).** The gateway now accepts all three spellings (`calls`/`calls_per_day`/`requests_per_day`, plus `0`/`false`) and a POSITIVE cap is actually enforced against the plugin's own `app.ai_calls` this month (the original grep was right that the key never hit, and reading the code showed a matched positive cap was never enforced either). `src/plugin-catalog.js` writes the canonical `calls` key so read and write cannot drift. Pinned by `tests/plg-ai-budget.test.js` (11/11). The event-budget half is still a distinct open item (PLG-7b). *This is the second debt in this list whose row was stale; treat the whole list as written at 2026-09-14 and re-check before acting.*
3. **RLS-only reads (no explicit tenant predicate)**: `comms.whatsapp /receipts`, `files.store /:id/download`, `exams.assessment` (:213/:277/:326/:354/:358), `health.clinic` (:80), `payments.upi /links` (:35), `ops.timetable` (:15/:48). Contained by FORCE RLS today — one policy bug from exposure.
4. **`family.view` silent-empty**: selects `total_pct/published_at` from `plugin_exams.report` — columns that don't exist (025); errors swallowed → parent report cards render empty forever.
5. **Capability contracts & `dependencies` are decorative** — enforced nowhere; enable route never checks deps (pack without its dependency enables fine).
6. **Delivery honesty lives in callers, not rails**: rails return `ok:true` on missing creds *and* failed settings reads; sms/whatsapp never set `sandbox` flag; reset door stamps `delivered_at` on first-hop `250`.
7. **`rails.email` can AUTH LOGIN in cleartext** if server doesn't advertise STARTTLS (no `require_starttls`); unknown `provider` silently degrades to logger.
8. **payments**: Razorpay has no idempotency keys, no refund path; UPI never compares signed amount to obligation, VPA derived from student name, `Number()` on BigInt cents.
9. **transport.gps**: staff-JWT ingestion with no HMAC (raw-body-parser exists, unused); `deviationM` collected with no geofence; threshold 10 hardcoded ×2, its setting unread.
10. **Six declared settings never read**: ops.bi `cache_seconds`, ops.import `max_shadow_rows`, ops.timetable `autofill_default` + `absence_feed`, ops.visitors `pickup_otp_max_attempts`, pack.cbse `weightage_strict`.
11. **accounting.tally XML-injects** unescaped `?company=` into the export envelope.
12. **State-write inside a GET** (`/teacher/leave/mine`) outside the CSRF model; `parent.brief_log` retains full child-name JSON with no purge path.

### 8b · Data-layer risks (from the data model audit)
13. **`POST /ai/call` writes no audit row** — the only mutating door that skips the ledger.
14. **`app.ai_calls` has no retention** (grows unbounded) and never feeds `audit_log`.
15. **RLS ENABLE-but-not-FORCE on ~30 tenant tables** (teacher/family/student/parent/coord/library/curriculum/mastery…) — inconsistent with the 049 "FORCE so even the owner is subject" posture.
16. **The `postgres`-owned default ACL can re-arm the D-35 DELETE grant** on any future postgres-authored table in schema `app`; removal needs a superuser command both 072 and 077 print but cannot run. No migration guards this — only `tests/acl-d35.test.js` catches the effect.
17. **`users.password_hash` remains app-role-readable** (login `SELECT *`); residual tracked in `docs/PERFECT-100.md`.
18. **Seed's migration replay hard-stops at 048** — per-tenant data and policy hardening from later migrations silently unwind on re-seed (074 patched by hand; no test enforces the list).
19. **075 trigger orders `created_at DESC, id DESC`, verifier orders ASC** — same-millisecond rows can report false link-breaks (§8 of 075, open).
20. **Migration numbering is four incompatible systems** (filename/header/prose/blocks-id); 064–065 skipped; always cite filenames.
21. Audit `ip` column is in hash material but populated by 0 of 168 write sites.

### 8c · Ops & process risks (from the ops audit)
22. **Git: three days of the hardest work uncommitted** (last commit `b40996e` 09-11 23:46; 129 paths dirty incl. migrations 072–079 and 18 test files). Single disk event = total loss of post-incident hardening. **Recommend: immediate S0 commit.**
23. **`backups/manual/*.dump` are mode 644 (world-readable child PII)** and `backups/` is not in `.gitignore`. No scheduler installs `backup.sh`; no off-host copy. (chmod 600 + gitignore entry are minutes of work.)
24. **Six workers are never scheduled anywhere** (workflow, webhook, day, retention, dunning, reconcile) — the rule engine, outbound webhooks, dunning and retention silently no-op in a "production" deploy (OPS-8).
25. **Documented production start path cannot boot a fresh DB** — compose `api` runs bootstrap before migrate (OPS-1); CI never builds the image (OPS-14).
26. **No TLS/edge exists on this host** (no nginx/certbot); API bound 0.0.0.0:8080; HSTS inert; zero alerting — the relay can die with no signal (its healthcheck is deliberately disabled, OPS-3).
27. **`tally.test.js` is a live red** (fresh-DB plugin lifecycle gap) and `fees-dunning` has a deterministic failure armed **2026-10-06** (PERFECT-100 item 30) — the next full-suite gate traps on both.
28. **PERFECT-100 §6.1 trust blockers items 2–8 not started**: owner-shaped pool role (BYPASSRLS), uncapped custom-role allow masks (`base_role:'owner'` reachable by itadmin), plugin settings not validated on the persisting door, webhook timestamp fail-closed, and the postgres-owned default-ACL re-arm (§8b-16).
29. **Dev DB trails the tree** (75/079 applied on `schoolos`; 69/071 on `schoolos_test`) — "it works locally" is weaker than it looks; 73 scratch databases indicate cleanup debt.
30. **No frontend tests exist at all** (44 k LOC behind tsc only); stale certs (`RELEASE-CERT`, `FEATURES-STATUS`) still claim counts that were never re-verified; final sprint report `STILL NOT GOOD_3.md` missing.

### 8d · Role & identity risks (from the roles audit)
31. **Student identity is name-equality**, not a FK: `ownStudent()` pins a session to `app.students` via `lower(name)` with exactly-one-active-match fail-closed (student.world:110–119); guardian paths match `guardian_name` strings similarly. Renames/duplicates silently sever access (fail-closed = "not set up" message, not corruption — but it's the system's weakest structural link and a known TODO shaped as prose).
32. **`POST /attendance/mark` advertises teacher but refuses them** — an in-handler SoD fallback (routes.js:449–452) lets only owner/principal mark; the class-assignment data that would make the SoD real doesn't exist. Teacher register-marking is architecturally open but practically dead.
33. **Client guards have holes** (server still saves it): `staffOnly` doesn't cover `/parent/*`, `/student/*`, `/attendance`, `/calendar`, `/maintenance/report` — staff can render family/student screens until a door 403s mid-fetch.
34. **Counselor has doors but no screens** (safety box + concerns board are server-complete, zero UI; nav omits them honestly) and **/it is largely fake** — revocation/rotation/flags/snapshots have no doors, render disabled (T305).
35. **Campus switcher is client-side theatre** — no server campus scoping exists behind it (`session.campusScope` never enforced in doors).
36. `roleScope()` in auth.js is dead code — the "documented" scoping model and the enforced one differ; enforcement is per-door ad hoc.
37. Teacher's real desk (`/teacher/*`) is on no desktop nav list — reachable only via mobile More-sheet or typed URL; discoverability defect for the platform's largest user class.

### 8e · UI risks (from the button-level audit — dead-control inventory in §4.5)
38. **Money UI is disconnected from money doors**: server has confirm/refund/dunning doors; liveApi has **no payment wrapper at all** — Fees "Collect" mutates the demo store; the void wrapper exists with no button. The finance role's core job is currently fiction in the browser.
39. **Five transports send bearer-only (no CSRF/credentials)** — under the cookie-session deployment (which liveApi itself prepares), every parent/student/coord/teacher POST would 403. Either the whole app goes bearer-cookie-compliant or the transports unify.
40. **No error differentiation anywhere**: 403/409/429 collapse into `HTTP <code>` strings; users see raw status codes on staff screens; no timeouts → hung request = hung screen; the 401 path hard-navigates and discards the cause.
41. **`/live` (LiveMode) is a demo harness, not a wizard** — fake "Backend connected" badge, marks only 2 rows while promising all, half-logout, store identity never refreshed (previous tenant's chrome persists behind its UI).
42. **Unrouted real doors** (server complete, UI absent): ExamMarks screen exists but ships unrouted; five teacher screens unrouted; Documents upload wrappers uncalled; `TeacherNav` links 10 paths that all NotFound. `GET /work-orders/:id`, `POST /work-orders` client wrapper — missing pieces listed in blocks.md (L4).
43. **AI answer surfaces in the browser are fixture engines** (`aiService.ask` keyword regex with hardcoded Meridian names/numbers; AiUsage fake telemetry) — while the server's deterministic copilots are honest about being deterministic. The UI undercuts the server's honesty policy.
44. Three divergent demo-account tables (login grid ≠ liveApi list ≠ store personas); store persona names are unreachable by real logins. `store.tsx` invents policy-refs into demo audit entries; chat receipts faked at fixed timers; `syncing` never clears.
45. i18n reaches 5 files / 57% hi-IN while marketing says bilingual; service-produced strings never translated.

### 8f · Backend cross-cutting risks (from the backend audit)
46. **`degraded` lifecycle status is read by three gates but written by nobody** — the state machine has a hole where plugin failure should land; and one broken plugin folder still kills the whole API (loader throws) instead of degrading.
47. **Settings-form doors skip lifecycleGate** (`settings-contract.js:210/215`) contradicting its own invariant — a *disabled* plugin's form is still readable/validatable (owner/itadmin only, so low blast radius).
48. `q()` (constrained app role helper) has zero callers; two cron scripts build raw clients → **run as owner with RLS bypassed** (least-privilege violation in workers); `reconcile-payments` bypasses `emitEvent` (warning rows reach no subscriber).
49. Governance bypass-by-naming: `checkEventBudget(...,'transport')` passes a non-plugin id → always the unbudgeted kernel path (transport pings escape their budget there).
50. TOTP compares with `===` (module ships an unused `constantTimeEqual`); dataset cache is module-global across tenants (correct only thanks to the allowlist); `OTP_DEV_ECHO=1` armed on this box — the `.env` must never ship.
51. ~~`pack.cbse` TDZ shadow bug~~ **FIXED 2026-09-14** (`boundsFail` rename + regression test #6; suite 6/6) — was: unknown-exam validate → 500 instead of 404.


