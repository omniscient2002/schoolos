# SchoolOS — Open Items (Operator, QA, Product, Engineering)

> **Everything in this file is OPEN.** It is the companion to `docs/HONEST-FLAGS.md`
> (the full register with evidence). Each item below is something a human — an
> operator, a tester, or a product owner — must still do, with exact steps and
> acceptance criteria. Nothing here is fixed in code; that is the point.
>
> Legend: `OPERATOR` (production access required) · `QA` (human click-through) ·
> `PRODUCT` (a decision before code) · `ENG` (future engineering work).
> Severity: BLOCKER / HIGH / MED / LOW.

---

## Part 1 — Operator runbook (do before inviting a real school)

### O-01 · Install the committed schedule — OPERATOR · HIGH · OPEN
- **Background:** `ops/cron/schoolos.cron` exists and `tests/ops-deploy.test.js`
  pins every CLI worker to a schedule, but a cron file in git runs nothing until
  an operator installs it. Until then: no nightly backup, no day-worker,
  no dunning, no reconcile sweep, no health-probe.
- **Steps:**
  1. `crontab ops/cron/schoolos.cron` (from the repo root, as the service user).
  2. `crontab -l` — confirm the entries are present.
  3. Wait one cycle (or trigger each job manually once) and confirm output.
- **Acceptance:** `crontab -l` shows the schedule; `backups/<date>/` appears after
  the backup window with no `.incomplete` marker.
- **Verify:** `node server/scripts/health-probe.js` (exit 0 = quiet, 1 = a rule fired).

### O-02 · Backup permissions + restore rehearsal — OPERATOR · HIGH · OPEN
- **Background:** `backups/` is git-ignored and `backup.sh` writes with `umask 077`,
  but pre-existing dumps may predate that; an untested backup is a hypothesis.
- **Steps:**
  1. `ls -la backups/` — every dump must be owner-only (`-rw-------`). Fix with
     `chmod 600 backups/**/*.dump backups/**/*.tar.gz` (and `chmod 700 backups/`).
  2. Confirm `backups/` is not tracked: `git status --short backups/` → empty.
  3. Rehearse a restore on a scratch host/DB per `ops/backup/README.md`:
     restore `globals.sql` FIRST, then the `-Fc` dump, then `files.tar.gz` into
     `FILES_DIR`; replay the DPDP erasure journal if the source DB had erasures.
  4. Boot the API against the restored DB and run `GET /audit/verify`.
- **Acceptance:** a dated restore drill log exists; the restored school signs in;
  the ledger verifies clean.

### O-03 · TLS at the edge + alerting — OPERATOR · HIGH · OPEN
- **Background:** the reference host serves plain HTTP on `:8080` with HSTS inert
  and zero alerting. The rules exist (`ops/alerts/schoolos.rules.yml`) and the
  probe exists (`server/scripts/health-probe.js`); no edge and no watcher exist.
- **Steps:**
  1. Terminate TLS at a reverse proxy (or LB); redirect HTTP→HTTPS; confirm HSTS.
  2. Scrape `GET /metrics` (owner/itadmin or `metrics.read` API key) into the
     monitoring system; load `ops/alerts/schoolos.rules.yml`.
  3. Alert at minimum on: `outbox_parked > 0`, `comms_sandbox_sent` rising,
     `wh_stalled > 0`, `api_heartbeat_age` stale, `backup_age > 26h`.
  4. Confirm cron mail (or equivalent) reaches a human for probe exit 1.
- **Acceptance:** https-only serving; one fired test alert acknowledged end-to-end.

### O-04 · Superuser default-ACL removal (D-35 residue) — OPERATOR · HIGH · OPEN
- **Background:** a `postgres`-owned default ACL can silently re-grant DELETE on
  future `postgres`-authored tables in schema `app`. Migrations `072`/`077` print
  the fix but cannot run it (`schoolos` is not superuser). `tests/acl-d35.test.js`
  guards the effect, not the cause.
- **Steps (as a superuser, once):**
  ```sql
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app
    REVOKE ALL ON TABLES FROM schoolos_app;
  ```
  2. Prove it: as `postgres`, `CREATE TABLE app._acl_probe(id int);` then check
     `has_table_privilege('schoolos_app','app._acl_probe','DELETE')` is false;
     `DROP TABLE app._acl_probe;`.
- **Acceptance:** probe shows no DELETE; `acl-d35` test still green.

### O-05 · Commit the tree in reviewed slices — OPERATOR · MED · OPEN
- **Background:** the tree carries a large dirty set (working fixes + prior
  uncommitted work) behind a single-committer convention (D-9).
- **Steps:** review `git status`, then commit in slices (migrations+code+tests per
  flag batch; docs separately). Never commit secrets, dumps, or `.env`.
- **Acceptance:** `git status --short` shows only intended untracked work; each
  commit message names the flag ID (e.g. `F-16`).

---

## Part 2 — QA checklists (human click-through, staging tenant)

### Q-01 · Money buttons end-to-end — QA · HIGH · OPEN
Server doors and wrappers are wired (F-23), but only a human can prove the buttons.
On a staging tenant with the fee plan generated:
1. Finance collects → payment `initiated`; confirm → `confirmed` + receipt PDF downloads.
2. Owner voids an unpaid obligation (ok) and a paid one (refused, told to refund).
3. Refund a payment (gateway leg first; below/above the ₹5,000 threshold paths).
4. Run dunning (expect quiet-hours honesty) and reconcile (ghost/missing/orphan).
5. Parent pays via UPI link and Razorpay order; webhook lands; confirm shows the
   gateway-verified (not manual) audit copy.
- **Acceptance:** every button either completes or refuses with plain language;
  no toast claims what the ledger does not show.

### Q-02 · Cookie-session POSTs on every transport — QA · HIGH · OPEN
Code now shares one transport (F-24), but cookie deployment must be clicked:
as parent, student, coordinator, teacher, and staff, perform one POST each
(consent decide, homework submit, substitution decide, review, visitor verify).
- **Acceptance:** zero 403-CSRF failures; no silent no-ops.

### Q-03 · Teacher + counselor screens load live data — QA · MED · OPEN
Routes and nav match (F-27), but each screen must be opened as its role:
`/teacher/exam-marks`, `/teacher/mastery`, `/teacher/curriculum`,
`/teacher/progress-story`, `/counselor/concerns`, `/wellbeing-queue`.
- **Acceptance:** every screen renders live rows or an honest empty state; none
  404s, none shows fixture data as real.

### Q-04 · Parent + student + visitor happy paths — QA · MED · OPEN
Parent: consents decide, request filed + tracked, fees paid, PTM booked.
Student (kiosk): homework listed, submission filed, wellbeing filed (named +
anonymous), print queued. Desk: visitor check-in → pickup OTP → verify →
complete; one wrong-code attempt (expect the high-risk audit row).
- **Acceptance:** each path completes; anonymous filings store no identity
  (spot-check the row).

---

## Part 3 — Product decisions (decide, then code)

### P-01 · GPS device authentication (HMAC) — PRODUCT · MED · OPEN
- **Background (F-11):** ingestion is staff-JWT; no device identity. Options:
  (a) per-route shared-secret header verified over raw bytes (like webhooks);
  (b) keep staff-JWT and document that devices authenticate as users.
- **Acceptance:** decision recorded; if (a), implemented + tested like the UPI gates.

### P-02 · `deviationM` geofence — PRODUCT · MED · OPEN
- **Background:** deviation is collected, compared to nothing. Options: (a) a
  per-route geofence width setting with a `route.deviated` event + action;
  (b) drop the column.
- **Acceptance:** either a working comparison or no dead data.

### P-03 · `ops.bi cache_seconds` — PRODUCT · MED · OPEN
- **Background (F-22):** declared, unread; BI computes live. Options: (a) implement
  a bounded per-tenant TTL cache with the setting as the bound; (b) remove the
  declaration.
- **Acceptance:** declared behavior is true, or the setting is gone.

### P-04 · `absence_feed` consumer — PRODUCT · MED · OPEN
- **Background (F-22):** `hr.leave` declares the contract; `ops.timetable` never
  consumes it. Options: (a) build leave→substitution linkage; (b) remove the
  declaration from both manifests.
- **Acceptance:** a leave visibly reaches the timetable, or no contract is claimed.

### P-05 · `degraded` plugin handling — PRODUCT · MED · OPEN
- **Background (F-17):** three gates accept `degraded`; nothing writes it; the
  loader is boot-fatal. Options: (a) per-plugin degrade (a broken folder disables
  itself with lineage); (b) keep boot-fatal and remove `degraded` from the gates.
- **Acceptance:** the state machine has no unwritten state.

### P-06 · Razorpay idempotency keys + refund rail path — PRODUCT · MED · OPEN
- **Background (F-12):** gateway-side gaps the kernel cannot fix alone.
- **Acceptance:** order creation is idempotent; refunds have a provider path.

---

## Part 4 — Engineering follow-ups (scheduled work, not today's code)

### E-01 · Retention for `ai_calls` + `parent.brief_log` — ENG · MED · OPEN (F-20)
Purge rows past N days (tenant-scoped, additive) in `retention-worker.js`;
cover with retention tests. `brief_log` first (child PII), then `ai_calls`.

### E-02 · Reconcile worker privilege + event spine — ENG · MED · OPEN (F-10)
Replace the owner-path client with a per-tenant constrained loop; route warnings
through `emitEvent` so subscribers see them. Cover with reconcile tests.

### E-03 · Audit same-ms ordering + cold-chain walk — ENG · LOW · OPEN (F-19 limits)
Documented limits today. If re-engineered: single ordering for trigger and
verifier; cold-chain walk (or a stated boundary proof). Keep `audit/verify`
limitations honest either way.

### E-04 · Demo-store honesty pass — ENG · LOW · OPEN (F-28 rest)
Stop inventing audit policy-refs in demo mode; collapse the three divergent
demo-account tables to one source; label remaining fixture surfaces.

### E-05 · i18n growth — ENG · LOW · OPEN (F-29)
Either finish hi-IN coverage or stop implying bilingual; keep the 57% figure
honest until then.

### E-06 · `GET /plugins` self-heal write — ENG · LOW · OPEN (D-4)
Split the self-heal into an explicit repair door (or document the GET-that-writes
as intended). Do not leave a mutating GET unexplained.

### E-07 · CI image build + smoke — ENG · LOW · OPEN (F-05 rest)
Build the server image in CI and boot a fresh DB from it (catches start-order
and image-vs-host drift like the Node 22/26 split).

---

## How to work this file

1. Pick the highest-severity OPEN item you own.
2. Follow its steps; meet its acceptance criteria.
3. Move it to `docs/HONEST-FLAGS.md` as FIXED with evidence, or record the
   decision here if the outcome was (b)/remove.
4. Never close an item by editing its acceptance criteria — change the system.
