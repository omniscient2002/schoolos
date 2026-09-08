# SchoolOS — Backend & Operations

Production-grade backend for SchoolOS: **Fastify + PostgreSQL 18 with tenant RLS**, JWT auth, hash-chained append-only audit ledger, transactional outbox, and the full domain spine (people, attendance, fees/payments, transport, maintenance, cases, actions, events, communications, memory, migration).

## Quick start (local, real Postgres)

```bash
# 1) Database (any Postgres 14+; a local server on :5432 is assumed)
psql -h 127.0.0.1 -U postgres -c "CREATE ROLE schoolos LOGIN PASSWORD 'schoolos_dev_pw' CREATEDB;"
psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE schoolos OWNER schoolos;"

# 2) Provision: schema → roles/grants → seed (order matters: grants after tables)
cd server
export DATABASE_URL=postgres://schoolos:schoolos_dev_pw@127.0.0.1:5432/schoolos
node scripts/migrate.js      # schema v1 + RLS policies
node scripts/bootstrap.js    # creates schoolos_app role + grants (needs superuser for role mgmt)
node scripts/seed.js         # Meridian International Academy — demo-parity data

# 3) Run
npm start                    # API on :8080
curl http://127.0.0.1:8080/health
```

Or with Docker: `JWT_SECRET=dev-secret docker compose up --build`

## Demo accounts (seeded, all password `schoolos-demo`)

| Email | Role |
|---|---|
| principal@meridian.edu | Principal (Dr. Meera Krishnan) |
| teacher@meridian.edu | Teacher (Priya Iyer) |
| finance@meridian.edu | Finance (Ms. Rao) |
| transport@meridian.edu | Transport (Vikram Joshi) |
| facilities@meridian.edu | Facilities |
| technician@meridian.edu | Technician (Arif Shaikh) |
| parent@meridian.edu | Parent (Kavita Sharma) |
| owner / itadmin / coordinator / admissions / student | other demo roles |

## Connecting the frontend

```bash
cd app
VITE_LIVE_API=1 npx vite build     # enables the Live API surface + demo-bar link
```
The `/live` route then signs in against the real API, marks attendance (triggering the Attendance §1.1 notice policy), approves actions (executing real communications), and reads the audit ledger. The golden-loop demo remains mock-first and always works.

## Security model

- **Tenant isolation:** every table is `FORCE ROW LEVEL SECURITY` on `tenant_id = current_setting('schoolos.tenant_id')`. Requests never run as the table owner — `withUser()` opens a transaction, sets `schoolos.tenant_id` + `schoolos.role`, then `SET LOCAL ROLE schoolos_app`.
- **Least privilege:** `schoolos_app` has no `UPDATE/DELETE` on `audit_log` (append-only, enforced by the DB). The `schoolos` owner has `BYPASSRLS` and is used only by migrations/seed.
- **Auth:** scrypt password hashes, JWT (12h) with role+tenant claims, rate-limited login. Role checks per-route (`require('finance','owner',…)`).
- **Audit ledger:** hash-chained (`prev_hash` → `sha256`), per tenant, advisory-lock serialized. Every mutation writes actor · action · record · policy · outcome.
- **Money invariant:** payments are `initiated → confirmed` with idempotent confirm; obligation `paid_cents` only moves on confirm; settled obligations refuse new payments (409).

## Tests

```bash
npm test        # spins up schoolos_test db, runs 25 integration tests (api · plugins · governance · security)
```
Covers: auth (bad creds, JWT, 401s), role scoping (teacher≠payments, parent≠attendance), **RLS isolation (second tenant sees zero rows)**, fee idempotency/no-overpay, WO state machine ordering, transport §3.1 policy raising approval-required actions, audit append-only + per-tenant hash-chain integrity.

## API surface (v1)

```
POST /auth/login                GET  /me
GET  /students                  GET  /students/:id        POST /students
GET  /attendance                POST /attendance/mark
GET  /fees/obligations          POST /fees/payments       POST /fees/payments/:id/confirm
GET  /transport/routes          POST /transport/events    (raises approval action on delay ≥ 10 min)
GET  /work-orders               POST /work-orders         POST /work-orders/:id/status
GET  /assets
GET  /cases                     POST /cases               POST /cases/:id/status
GET  /actions                   POST /actions/:id/decide  (executes comms/notifications on approve)
GET  /events                    GET  /notifications       POST /notifications/read
GET  /events/lineage            (v2 envelope: emitted_by · subject · correlation · action links)
GET  /plugins                   POST /plugins/:id/enable  POST /plugins/:id/disable (drain protocol)
                                (per-plugin event budgets + circuit breakers: 429 BUDGET_EXHAUSTED / BREAKER_OPEN)
GET  /communications            GET  /audit               GET  /memory   POST /memory
GET  /migration/sources         POST /migration/sources   POST /migration/sources/:id/stage
POST /migration/activate        (trust receipt: totals, ₹0 difference, rollback window)
GET  /health
```

## Runbook notes

- **Grant ordering:** always `migrate → bootstrap → seed`. Bootstrap grants `ON ALL TABLES`, so it must run after tables exist (re-run after adding migrations).
- **Migrations:** tracked in `app.schema_migrations`; runner is idempotent.
- **Outbox:** `app.outbox` rows are written transactionally with events; a worker consumes `WHERE processed_at IS NULL` (worker process is shipped (`scripts/outbox-worker.js` — compose `outbox` service, `npm run worker`; retries with backoff, parks poison rows) — `docs/08`).
- **Secrets:** set `JWT_SECRET` in any shared environment; `.env` is dev-only.
- **Logs:** structured pino; `level:50` lines are errors with stack + reqId.
