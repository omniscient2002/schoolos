# Backend Map — Every Entry Point, Every Logical Unit

State: post-Wave-4 (67 migrations, 25 plugins). Totals: **~12,100 lines of backend source** across the
composition root (2 files), **26 plugin services**, and **19 operational scripts**.
**~264 HTTP doors** (61 core-domain in `routes.js`, 33 auth/kernel in `app.js`, ~170 in plugins).
Every door runs behind the same substrate: Fastify hook → `authenticate` → role gate → `withUser`
(RLS session vars) → handler → audit ledger row. There are no unauthenticated doors except
`/health`, `/ready`, `/auth/*`, `/onboard/*`, and webhook receivers (signature-verified).

---

## UNIT A — Composition root & kernel
| File | Role | Doors |
|---|---|---|
| `src/index.js` | Boot: Fastify, plugins, CORS, rate limits, mounts onboarding → core → plugin routes | — |
| `src/config.js` | Env → typed config; dev flags dual-gated (NODE_ENV + explicit opt-in); OTP/echo/session-epoch/limits | — |
| `src/db.js` | Two pools: **owner connection** (migrations, vault writes) + **app pool**; `q()`; `withUser(tenant, role)` = `SET LOCAL schoolos.tenant_id/role` — the tenancy substrate every door runs under | — |
| `src/app.js` (33 doors) | **Identity & session**: `/auth/login`, `/auth/renew` (cookie), `/auth/otp/request+verify` (CSPRNG → hashed vault, tenant-scope, multi-tenant 409 picker), `/auth/google/start+callback`, `/auth/logout`, `POST /me/password`, `/me/reset-request+confirm`, **MFA**: `/me/mfa/enroll|disable|verify`; **Multi-school**: `/me/tenants`, `/me/switch`; **Kernel/platform**: `/dataset` (strict allowlist), `/capabilities`, plugin enable/disable; **Platform API**: `/api-keys` CRUD (scoped), `/webhooks` CRUD (signed delivery); **AI plane**: `/ai/call`, `/ai/calls`, `/ai/eval`; **Workflow**: `/workflow-rules` CRUD; **Observability**: `/health`, `/ready`, `/metrics` | 33 |

## UNIT B — Tenancy & security substrate
| File | Role |
|---|---|
| `src/audit.js` | `auditLog` (tamper-evident ledger rows w/ policyRef+risk), `linkLineage`, `requestAudit` |
| `src/governance.js` | Event budgets (`checkEventBudget`), rate governance per tenant |
| `src/plugin-catalog.js` | The 23-plugin born-at-signup catalog; DEFAULT_ON set; per-plugin permissions/tiers |
| `scripts/permission-matrix.js` | Static analysis: role×door matrix, drift checker |
| `src/plugins/_shared/` | `ai-gateway` (ledgered AI calls), `lifecycle-gate` (force_change/epoch enforcement), `raw-body-parser` (webhook signatures), `uuid-param` |

## UNIT C — Onboarding
| File | Role | Doors |
|---|---|---|
| `src/onboarding.js` | Self-serve tenant creation: school+owner+section grid; ONE transaction → tenant + owner + full catalog + audit + event; `uniqueSlug` | `POST /onboard/*` (incl. `/onboard/status` checklist) |

## UNIT D — Domain core (`src/routes.js`, 61 doors)
Groups by prefix (all staff-gated unless noted):
- **People**: `/students` CRUD-lifecycle (search/create/PATCH/withdraw/promote; parent=403, student=403)
- **Attendance**: `/attendance` read (parent-scoped to own children), `/attendance/mark` (principal+ or class-of-record; honest 403 when unbound)
- **Money**: `/fees/obligations` (child-scoped for parents), `/fee-plans`+generate (idempotent), void (owner), `/reports/fees/summary`, refund/settlement hooks
- **Approvals**: `/actions` queue + decide (SoD: unattributed → owner only)
- **Teaching**: `/homework`, `/submissions`, `/exams` (+ bulk marks, board policy, recompute)
- **Ops**: `/timetable` + `/timetable/clash-check`, `/work-orders`+status, `/transport/routes`+events
- **Comms/notify**: notifications, `/events` feed
- **Migration engine**: `/migration/*` (stage → validate → shadow → commit; real `differenceCents`)
- **Admissions**: `/admissions/followups` (deterministic, no model)
- **Session mirror**: `/me` (enrollment state), `/dataset` shadow
- **Audit/BI read doors**: `/audit`, ops aggregates

## UNIT E — Plugin services (26, each an isolated unit with its own schema `plugin_<name>`)
**People & family**: `people.admin` (10), `student.world` (18), `family.view` (11), `coord.view` (7), `parent.assistant` (4)
**Teaching**: `teacher.classroom` (8), `teacher.support` (22 — interventions), `teacher.copilot` (8 — deterministic, honestly labeled), `exams.assessment` (13)
**Ops**: `ops.visitors` (8 — guardian-verified pickup OTP), `ops.timetable` (4), `ops.bi` (4 — canonical read models), `ops.import` (3), `ops.udise` (2), `library` (8), `files.store` (3), `health.clinic` (5), `hr.leave` (4), `admissions.funnel` (5), `transport.gps` (2)
**Money**: `payments.razorpay` (2 — webhook receiver, signature-verified), `payments.upi` (2), `accounting.tally` (1 — read-only daybook/export, digest-audited)
**Rails** (sandbox-first, honest 503s): `rails.sms`, `rails.email`, `rails.whatsapp`
**Compliance packs**: `pack.cbse` (3), `pack.dpdp` (6 — consent ledger, SAR, erasure)
**AI**: `teacher.copilot` + `/ai/*` kernel doors — deterministic templates today, gateway ledger ready for real models

## UNIT F — Async plane (the outbox spine)
Pattern: domain writes `app.outbox`/events in the same transaction → workers drain.
| Worker | Job |
|---|---|
| `outbox-worker.js` | Drains the outbox (retry/backoff → DLQ) |
| `comms-dispatcher.js` | SMS/WhatsApp/Email sends via rails adapters; receipts to `app.communications`; failure → DLQ |
| `webhook-worker.js` | Signed outbound webhook deliveries (retry → park) |
| `workflow-worker.js` | Runs workflow rules off plugin events (minimal runner) |
| `day-worker.js` | Cron one-shot: preventive WOs, tally export, retention sweep, dunning (contained skips — never crashes cron) |
| `dunning-reminders.js` | Overdue obligation reminders (quiet hours) |
| `retention-worker.js` | outbox/comms/webhook-log sweeps; audit = cold-table archival, never DELETE |
| `reconcile-payments.js` | Gateway vs ledger reconciliation sweep |

## UNIT G — Ops tooling & CI
`migrate.js` (ordered, recorded) · `bootstrap.js` (RLS force + grant baseline) · `seed.js` (demo school) ·
`check.js` (DB+migrations+RLS gate; exit-code semantics) · `parity-gate.js` (100 write doors ↔ UI callers;
fails CI on drift) · `backup.sh` · `ci-init-db.js` · `verify-settings-strip.mjs` · `reconcile_wo1046.mjs`.

## UNIT H — Data layer
`migrations/001–069` across schemas: `app` (tenants, users, students, attendance, fees, actions, audit,
outbox, auth_otps, plugins, roles, api_keys, webhooks, migration engine, academic_years), `auth`
(mfa_secrets — owner-connection only), `family` (child_link), `plugin_*` (one schema per plugin).

## Entry-point taxonomy (the 4 kinds)
1. **HTTP doors** (~264) — the only client surface; all behind RLS + role gates
2. **Async workers** (8) — outbox spine; cron/loop via compose or host cron
3. **CI/gates** — `check.js`, `parity-gate.js`, `npm test` (273+ tests, serial, per-file DB)
4. **CLI scripts** — migrate, bootstrap, seed, backup

**Invariants that hold everywhere:** tenant pin via RLS (no cross-tenant read/write), audit row on every
mutation, no table-level DELETE for the app role (D-35), dev doors dual-gated + loud, honesty rule on all
failure copy, TypeScript-free server (plain ESM node) with the parity gate guarding the UI contract.

---

# UNIT A DEEP-DIVE (end-to-end review, every line read)

## Boot sequence (`node src/index.js`)
1. Guard: `WORKER_ROLE=1` on the HTTP entry exits(1) — workers must boot the worker script (guards differ).
2. `buildApp()`: Fastify (logger; `trustProxy` opt-in only — XFF spoofing defeats limiters otherwise) →
   CORS (`corsOrigins`) → JWT (`jwtSecret`, TTL 12h) → rate-limit (300/min; login 20, otp 5, verify 10,
   reset 5, renew 30, mfa-verify 10; key = req.ip unless TRUST_PROXY) → cookie/CSRF helpers →
   `authenticate` decoration → health/ready → auth doors → password/MFA/api-keys/webhooks →
   `registerRoutes` (61 domain doors) → `registerOnboarding` (mounted BEFORE plugins so /onboard exists
   with zero plugins) → `loadPlugins` (the single plugin registration point) → `/dataset` → `/capabilities`
   → AI gateway doors → workflow rules → `/metrics` → 60s counter flush (unref'd, merged on boot) →
   error handler → onClose (flush cleared, pool.end).
3. Signal handling: SIGINT/SIGTERM → app.close with 15s force-exit; unhandledRejection logged,
   uncaughtException exits(1).

## Request lifecycle (every authenticated door)
`req` → rate-limit → CORS → `authenticate` hook:
X-API-Key? → GET-only, sha256 lookup, scope check (API_DOOR_SCOPES allowlist), synthetic principal.
Bearer/cookie? → CSRF double-submit (cookie mutations) → JWT verify → **jti denylist** (`auth.revoked_token`)
→ **live user row** (active, role, pg_role, session_epoch, force_change, mfa_enrolled_at) →
**epoch match** (`ep` claim) → mustChange/mfaPending door-restriction claims → `req.user` = DB truth.
Handler → `withUser(tenant, role)` → BEGIN → `set_config(tenant_id/role)` → `SET LOCAL ROLE schoolos_app`
→ fn → COMMIT/ROLLBACK → audit rows ride the same tx → onSend (no-store planes, security headers,
request counter) → error handler (5xx logged + counted; generic body).

## The auth state machine (the intellectual core)
Four issue paths — password, phone-OTP, Google SSO (+dev simulator), MFA-verify, renew — ALL converge on
one `issueSession()` helper (D-37c): stamps `mustChange` from the DB row (never caller's word), sets
HttpOnly session cookie + JS-readable CSRF cookie, audits via RLS path. **Every token carries jti +
epoch**; logout denylists the jti; password change/reset bumps the epoch (kills all other sessions
without a live-jti registry); students get 30m shared-computer TTLs; `mustChange` sessions reach only
/me/password, /me, /auth/logout; `mfaPending` challenge tokens (5m) reach only /me/mfa/verify.
Anti-enumeration everywhere: dummy scrypt burn on unknown email, uniform OTP failure copy, uniform reset
copy, multi-tenant 409 picker (ids+names) instead of silent rows[0] — the P0-3 cross-tenant fix, closed at
all four issue paths. OTP: CSPRNG 6-digit, scrypt-hashed in kernel-only vault (app role denied), attempts
capped, consumed single-use, tenant-bound (T103). Reset: 32B token, sha256-stored, race-safe consume,
channel-gated 503 (no fake sends). MFA: TOTP RFC-6238 + 8 single-use recovery codes (sha256), disable
requires password re-auth, re-enroll refused while enabled, parents/students excluded by posture.

## Verified findings (S0 review, every line read)
| # | Sev | Finding |
|---|---|---|
| A1 | **HIGH** | `DELETE /workflow-rules/:id` (app.js:917) runs real `DELETE` via the app role — but migration 071 grants only SELECT/INSERT/UPDATE (D-35 law). Every delete call = permission denied → **500**. Fix: soft-delete (`enabled=false`) like api-keys/webhooks. |
| A2 | **MED** | `/capabilities` reports `library: on('library.core')` (app.js:849) — the registry id is `library`; `library.core` never exists → capabilities always says Library is off, hiding an enabled module from any capabilities-driven UI. One-token fix. |
| A3 | **MED** | `/me/reset-request` stores the **plaintext reset token in the comms ledger body** (app.js:521-536) — `app.communications` is app-role-readable, so a 30-min single-use secret persists queryable. Redact/hash the code in the ledger row (keep delivery proof, not the secret). |
| A4 | **MED** | `/me/switch` (app.js:444) re-issues a session against another tenant with **no re-auth** — a stolen browser session escalates into the person's other-school account (teacher in A → owner in B). Require current password (or MFA) like `/me/mfa/disable`. |
| A5 | LOW | `/auth/google/start` creates `app.oauth_states` via runtime DDL fallback in the request path (app.js:340-343) — move to a migration. |
| A6 | LOW | `/auth/renew` issues a new jti without denylisting the old one — old token lives to natural 12h expiry (acceptable; note for a future session registry). |
| A7 | LOW | `authenticate` catch maps DB outages to 401 "unauthorized" — /ready disambiguates, but an error-status distinction would help ops. |
| A8 | LOW | Global rate limit keyed on req.ip without a proxy = all users behind one egress share the 300/min bucket (documented; TRUST_PROXY flips it when a proxy exists). |

## Strengths worth naming
Timing-equalized login; jti+epoch revocation without a session table; allowlist (not blocklist) dataset
for non-demo tenants; fail-closed dev doors computed once at config; production boot guards (localhost DB,
`*` CORS, short JWT secret all throw); statement/lock/idle timeouts on the pool; `SET LOCAL ROLE` as a
compiled constant (not injectable); CSRF double-submit with bearer exemption; uniform no-store planes;
honest 503 channel gates; every state change audited through the RLS path with policyRef.

---

# UNIT B DEEP-DIVE (end-to-end review, all 517 lines read)

## What each module does
- **`audit.js`** — the hash-chained ledger: per-tenant `pg_advisory_xact_lock` serializes writers; each
  row hashes (prevHash + material) and inserts via `audit_append` (owner fn, tenant-pinned). Same tx
  emits `app.events` + `app.outbox` rows (the async spine) and links lineage. `requestAudit` stamps
  `plugin:<id>` provenance into actor_role.
- **`governance.js`** — per-plugin event budgets (60/min default, 64KB payload cap) + circuit breaker
  (open → half-open self-heal after 5 min).
- **`plugin-catalog.js`** — the 26-row born-at-signup catalog; `ensurePluginCatalog` idempotent
  (WHERE NOT EXISTS), DEFAULT_ON = people.admin, visitors, library, timetable, files.store.
- **`ai-gateway.js`** — one seam for every AI call: ledger every attempt (ok|error|budget), budgets
  enforced BEFORE the provider (per-tenant daily cap; strictest per-plugin monthly cap; 0/false = off),
  pluggable providers — 'logger' sandbox, 'openai-compatible' intentionally inert until D-32 keys.
- **`lifecycle-gate.js`** — the uniform plugin gate (kernel OFF → honest 409 with per-plugin copy).
- **`raw-body-parser.js`** — install-once raw-body for HMAC webhook verification.
- **`uuid-param.js`** — :id params die 400 before any 22P02 500.
- **`permission-matrix.js`** — the ONE tool that knows every guard: scans all 262 doors, classifies
  public/auth/role-gated, fails CI on unguarded-or-unallowlisted doors, lints custom-role patterns
  against door guards, writes docs/PERMISSION-MATRIX.md.

## Verified findings (all fixed by S0, owner directive)
| # | Sev | Finding → fix |
|---|---|---|
| B12 | **HIGH** | **The permission matrix itself was failing**: 8 authed doors classified unguarded (adminOnly() helper invisible to the scanner) + 3 deliberately-public doors missing from the allowlist. Fixed: scanner recognizes the auth-helper set (both hasAuth and the demotion check), allowlist gains reset-request/reset-confirm/mfa-verify with threat notes, `/auth/renew` moved to preHandler-auth. Matrix now PASSES: 262 · 213 role-gated · 36 auth · 13 public. |
| B13 | MED | CSRF branch fired on **cookieless** requests (via fell to 'cookie' with no creds → absent-session renew answered 403 CSRF instead of 401). Fixed: CSRF applies only when a session cookie is actually present. |
| B6 | LOW | AI-gateway ledger writes could 500 a budget denial or successful call. Fixed: ledger failures are logged, never request-critical. |
| B1 | LOW (documented) | audit_log.id is a uuid — same-transaction audit rows share created_at, so a verifier sorting by (created_at, id) can misorder tied rows. The chain material itself is correct (advisory lock + same-tx prev read). Future: add a bigserial seq for verification order. |
| B3/B4/B9 | INFO | Breaker self-heal UPDATE is app-role-legal; catalog versions have no upgrade path (informational only); lifecycle-gate FRIENDLY map falls back to capitalized prefix for new plugins. Verified OK / accepted. |

## Verification
`permission matrix OK: 262 routes` · **31/31 tests green** (l2-mfa, l2-p5-gateway-workflow,
l2-rails-email-reset, wave-c, l2-multi-tenant) · node --check + tsc clean · backend restarted.
