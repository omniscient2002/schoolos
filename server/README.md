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

## Backup & restore (T205 — ops audit §15)

**Backup.** `scripts/backup.sh` writes one directory per UTC night under
`BACKUP_DIR` (default `/var/backups/schoolos`): `globals.sql`
(`pg_dumpall --globals-only` — the roles `schoolos`/`schoolos_app`, their
passwords and memberships) plus `<db>.dump` (custom-format `pg_dump`, default db
`schoolos`; override with `BACKUP_DATABASES`). Every dump is verified with
`pg_restore --list` before it counts. The same night also contains
`files.tar.gz`, a verified archive of `FILES_DIR` (or the default
`server/storage`) so uploaded bytes are restored with `app.files` metadata.
Retention: `BACKUP_KEEP_DAYS` nights
(default 7). The script exits non-zero on any failure and deletes the failed
artifact; a missing night directory or a leftover `.incomplete` marker means that
night did not complete — treat it as **no backup for that night**.

```bash
# one-off, host with a postgres-client >= server major
BACKUP_DIR=/var/backups/schoolos PGUSER=postgres server/scripts/backup.sh

# nightly cron (02:17 IST; silence is success, mail on failure)
# 17 2 * * * BACKUP_DIR=/var/backups/schoolos PGUSER=postgres /srv/schoolos/server/scripts/backup.sh >> /var/log/schoolos-backup.log 2>&1

# docker-only variant (no host client needed — the db image ships the tools):
#   docker compose -f server/docker-compose.yml exec -T db pg_dump -U schoolos --format=custom schoolos \
#     > /var/backups/schoolos/schoolos-$(date -u +%F).dump
#   docker compose -f server/docker-compose.yml exec -T db pg_dumpall --globals-only -U schoolos \
#     > /var/backups/schoolos/globals-$(date -u +%F).sql
```

Backups contain student PII: keep `BACKUP_DIR` off any web path, owner-only
permissions (the script sets `umask 077`), encrypted volumes at rest.

**Restore (rehearse quarterly — an untested backup is a rumor).**

```bash
# 0) provision an EMPTY Postgres cluster (same or newer major version)
# 1) globals FIRST — the roles and memberships everything else depends on
psql -h 127.0.0.1 -U postgres -f /var/backups/schoolos/<date>/globals.sql
# 2) recreate the app database with the restored owner
psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE schoolos OWNER schoolos;"
# 3) restore as a SUPERUSER with owners preserved — the dump encodes ownership and
#    default-privilege entries for BOTH roles (schoolos + postgres), which only a
#    superuser can replay. (Drilled 2026-09-10: zero ignored errors + check green.
#    `--no-owner --role=schoolos` is NOT equivalent: it drops the postgres-owned
#    default-privilege entries with "permission denied" errors.)
pg_restore -h 127.0.0.1 -U postgres -d schoolos -j 4 \
  /var/backups/schoolos/<date>/schoolos.dump
# 4) restore private uploads beside the configured FILES_DIR. The archive
#    contains a top-level `storage/` directory when the default was used.
mkdir -p /srv/schoolos/server
tar -xzf /var/backups/schoolos/<date>/files.tar.gz \
  -C /srv/schoolos/server
# 5) verify the restored system gates green (reachability, migrations, RLS baseline)
cd server && DATABASE_URL=postgres://schoolos:schoolos_dev_pw@127.0.0.1:5432/schoolos node scripts/check.js
# 6) before serving restored traffic, replay encrypted DPDP erasure tokens
node scripts/replay-erasure-journal.js
```

**RPO with this scheme is ≤ 24h.** WAL archiving / point-in-time recovery is a
separate work item (sprint cut list) — do not claim PITR from these dumps.
