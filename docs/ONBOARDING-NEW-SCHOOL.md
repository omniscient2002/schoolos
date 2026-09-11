# Onboarding a New School on SchoolOS — the Full Walkthrough

Audience: the school owner (or the platform operator acting for them). This reflects the codebase as of
Wave 2–4 (post-sprint), verified against `src/onboarding.js`, `plugin-catalog.js`, routes, and the test
suites. Items marked **[RAIL]** or **[OWNER]** need real-world credentials/actions; everything else is
self-serve in the product.

---

## Phase 0 — Platform deployment (once, per server) [OWNER]
1. Postgres 16+ (18 tested), Node 26. `cd server && cp .env.example .env` (or create `.env`):
   `DATABASE_URL`, `JWT_SECRET` (fresh 32-byte hex), `NODE_ENV=production`,
   `CORS_ORIGINS=https://your-domain` (never `*` in production), `SELF_SIGNUP_ENABLED` as policy.
2. `npm run migrate` — applies `app.schema_migrations` (67+ files: RLS everywhere, OTP vault split,
   academic years, fee templates, refunds, custom roles, comms receipts, audit cold table, DPDP journal,
   API keys/webhooks).
3. `node scripts/bootstrap.js` — RLS force + grant baseline. **Law (D-35):** the app role NEVER gets
   table-level DELETE; deletes go through scoped SECURITY DEFINER helpers.
4. Serve the API (`npm start`, :8080) and the frontend (`app && npm run build` → serve `dist/` same-origin
   or CDN; the app calls the API at `VITE_API_BASE`).
5. Backups from day one: `server/scripts/backup.sh` (globals + custom-format per DB + `pg_restore --list`
   verify) in cron. **[OWNER]** Rehearse one restore before inviting real schools.

## Phase 1 — School self-signup (5 minutes, self-serve)
The owner opens the app → **Onboard** (`/onboard`, migration 053, `src/onboarding.js`):
- School full name (3–120 chars) · owner name · owner email (login identity) · owner password (≥8) ·
  optional address/board/phone · **section grid** (grade × sections; a sensible default is prefilled).
One owner-path transaction creates: the **tenant**, the first **owner** user, the **full 23-plugin
catalog** (every plugin born "registered" so Modules has real switches on day one), the onboarding audit
entry, and the platform event. No demo data, no demo-school branding — a self-signup school sees only its
own identity (the `/dataset` allowlist guarantees it).

## Phase 2 — First hour as owner
1. `/onboard/status` — the setup checklist (code-verified door).
2. **Modules** screen — switches per plugin. Born ON: `people.admin`, `ops.visitors`, `library`,
   `ops.timetable`, `files.store` (chosen so day-one school operations aren't blocked). Everything else
   flips on with an audited owner action. Credential rails (WhatsApp/SMS/UPI/Razorpay) are born OFF —
   "switched off with no switch" never happens, but fake connectivity never happens either.
3. Campus scope: multi-campus schools set campuses in tenant config; role defaults scope to `all` or one.

## Phase 3 — People & roles
1. **PeopleAdmin** → provision staff with temp passwords (test-verified HANDOVER chain: owner → itadmin →
   teacher). The new user is `force_change`-stamped → first login lands on `/account/password` → sets a
   real password (old sessions revoked).
2. Fixed roles today: owner, principal, coordinator, teacher, finance, admissions, transport, facilities,
   technician, itadmin (+ parent/student desks).
3. **Custom roles** (`/roles`, owner + IT-admin): create e.g. **"Librarian"** with library-scoped
   permissions (Wave-5 acceptance item D-43) — working access moves to the specialist; management keeps
   read-oversight.

## Phase 4 — Academic year
Create the academic year (`POST /academic-years`) with start/end dates → **activate** exactly one current
year per tenant. Fee plans, exams and promotions scope to it. (Two-current is rejected at the DB.)

## Phase 5 — Getting students in (three routes)
1. **Bulk import** (recommended for an existing school): `/data-import` → upload → column mapping →
   per-row validation → **shadow load** (nothing written) → commit. The trust receipt shows the REAL
   `differenceCents` (rows in vs rows landed) — no fabricated zeros.
2. **Manual add**: People → Add person (`POST /students`: name, grade, section, guardian, bus).
3. **Admissions funnel**: leads → stage pipeline → followups queue (`GET /admissions/followups` —
   deterministic stuck-first rule, no AI) → approve → the executor **actually creates the student** +
   enrollment history (the Wave-2 fix for the audit's "admissions creates nobody" finding).

## Phase 6 — Money setup
1. **Fee plans** (`/fees/plans`): grade-set × terms × amounts (`term`, `label`, `amount_cents`, optional
   `due_on`) → **Generate** → bulk-inserts obligations for active students, idempotent per
   (tenant, student, term, label) at the DB level — re-clicking never double-bills. Void is owner-only and
   refuses paid rows (409).
2. Collections: payments against obligations (**[RAIL]** UPI/Razorpay live after keys; sandbox until then);
   refunds + settlement reconciliation sweep; dunning reminders on overdue obligations (queued honestly —
   they deliver once the SMS/WhatsApp rail has keys).

## Phase 7 — Daily operations (what staff actually touch)
- **Attendance**: register marks (principal+ always; teachers need a class-of-record binding — the door is
  honest that this data model doesn't exist yet, so it routes to the principal's office). Absences queue
  notices.
- **Homework** (post → submissions → one-shot resubmit 409) · **Exams** (bulk marks ≤500 with per-row
  errors, per-board policy, publish → report digests with honest drift detection) · **Library** ·
  **Visitors desk** (check-in → guardian-verified pickup OTP — hashed, CSPRNG, single-use) ·
  **Transport** (routes/riders; GPS telemetry **not connected yet** — the UI says so) ·
  **Maintenance** (ReportIssue → work orders; preventive generation via the day-worker) · **Files**
  (type-whitelisted, sha256, guardian-scoped downloads) · **Notifications bell** (45s refresh).

## Phase 8 — Governance
`/audit` (tamper-evident ledger, cold-table archival) · Action Center (approvals with
segregation-of-duties: unattributed proposals route to the owner, never self-approve) · Reports/BI
(attendance %, fee aging, funnel conversion — SQL read models, cached, capped) · UDISE+ export ·
DPDP consent ledger + erasure with keyed surrogates (PII gone, decision trail preserved).

## Phase 9 — Rails go-live [OWNER — keys at the end, per D-32]
Plugin settings → paste provider keys: **SMS** (MSG91 or any HTTP-generic), **WhatsApp BSP**, **SMTP**
(verification, password reset, receipts), **UPI/Razorpay** (+ webhook secrets). The moment keys exist:
OTP phone login works end-to-end, receipts deliver, dunning sends, payment confirmations stop being
simulated. Until then every surface says "not connected" — never "99.2% Live".

## Phase 10 — Operational maturity [OWNER]
Backup cron + rehearsed restore · staging environment + CD · alerting/observability keys (Sentry/OTel) ·
load test before 100-school scale · rotate secrets on any staff exit.

---

## Honest gaps you will meet (as of this sprint)
OTP login needs the SMS rail for real phones · teacher class-assignment binding · GPS telemetry ·
workflow runtime (decision pending: minimal runner or fiction deleted) · real AI gateway (deterministic
templates today — honestly labeled) · multi-region. The voice receptionist was removed from scope by
owner decision (D-25).
