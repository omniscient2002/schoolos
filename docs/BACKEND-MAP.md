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
