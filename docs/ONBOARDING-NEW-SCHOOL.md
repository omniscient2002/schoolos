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
- School full name (3–120 chars) · structured address (line/city/state/postal/country) · board ·
  school phone/email/website · timezone (browser zone proposed, IANA-validated) · owner name · owner email
  (login identity) · owner password (≥8) · optional owner phone (stored E.164, the shape OTP doors look up).
  Classes/sections are NOT collected here — the school defines them on `/classes` after signup.
One owner-path transaction creates: the **tenant**, the first **owner** user, the **full 23-plugin
catalog** (every plugin born "registered" so Modules has real switches on day one), the onboarding audit
entry, and the platform event. No demo data, no demo-school branding — a self-signup school sees only its
own identity (the `/dataset` allowlist guarantees it).

## Part 1 — Staffing the school: the people chain (the Setup guide, `/setup`)

Onboarding is divided in two. **Part 1 staffs the school** (school → principal →
IT admin → classes → staff → students → parent/pupil portal access); **Part 2
switches on the operating domains** (fees, admissions, transport, visitors,
library, …) per plugin. Part 1 runs as staged delegation, enforced by the
doors and guided by `GET /school/setup` (owner/principal/IT admin read):

1. **School + owner** — Phase 1 above. The owner lands on `/people-admin`.
2. **Principal, appointed by the owner only** — `POST /plugins/people.admin/users`
   with `role='principal'` refuses non-owners (audited 403); an IT admin attempting
   it is refused the same way.
3. **IT admin, appointed by the owner OR the principal** — the principal's one
   delegation step: `POST /plugins/people.admin/users` admits a principal caller
   **iff** `role='itadmin'`; a principal reaching for any other role gets 403.
   Suspend/activate/reset/list stay owner+IT-admin (identity authority does not
   follow the principal), and nobody provisions `owner` through any door.
4. **Everyone else, provisioned by the IT admin** through the existing methods —
   single accounts on the People console, student CSV import, the staged
   migration load (`/migration`), manual enrolment, RTE lottery, the admissions
   funnel. The guide tracks teachers, desk roles (admissions/transport/counsellor/
   librarian/…) and finance roles as separate rows. Guardian accounts link to
   children (`family.child_link`); pupil portal accounts are created from the
   roster row only.

## Part 2 — Switching on the operating domains (per plugin)

1. **Modules** screen — switches per plugin. Born ON: `people.admin`, `ops.visitors`,
   `ops.timetable`, `files.store` (chosen so day-one school operations aren't blocked; the library is
   deliberately opt-in until a librarian exists — see `plugin-catalog.js` `DEFAULT_ON`). Everything else
   flips on with an audited owner action. Credential rails (WhatsApp/SMS/UPI/Razorpay) are born OFF —
   "switched off with no switch" never happens, but fake connectivity never happens either.
2. Campus scope: multi-campus schools set campuses in tenant config; role defaults scope to `all` or one.

## Phase 3 — People & roles
1. **People console** (`/people-admin`) → provision staff with one-time passwords (test-verified HANDOVER
   chain: owner → itadmin → teacher). The new user is `force_change`-stamped → first sign-in lands on
   `/account/password` → sets a real password (old sessions revoked). The password is shown **once**;
   if it is ever lost, reset it rather than guessing — the reset door issues a new one and says so.
2. The form also asks for a **phone**, and for a parent **which child they are**. Both were always
   accepted by the door; nothing asked, so a parent account used to sit in an empty family portal
   forever, and a notice to that family resolved **zero** recipients (the notice resolver read only
   `app.guardians`, while a self-signup family's child lives in `family.child_link`). Both are fixed —
   the phone matches structurally at enrolment, the child picker writes the link, and the resolver reads
   the union of both shapes.
3. Roles today: owner, principal, coordinator, counselor, teacher, finance, finance_head, finance_clerk,
   admissions, transport, facilities, technician, itadmin, librarian (+ parent/student desks). One
   declaration of what a school may appoint (`PROVISIONABLE_ROLES`) drives the dropdown, and the server's
   own list is asserted against it — a role the server issues cannot be missing from the console.
4. **Custom roles** (`/roles`, owner + IT-admin): create e.g. **"Librarian"** with library-scoped
   permissions (Wave-5 acceptance item D-43) — working access moves to the specialist; management keeps
   read-oversight. The role card can now also **retire** a role, which renames it out of the live
   namespace and empties its mask (the server refuses while any account still carries it).
5. **API keys** (`/it`, owner + IT admin): list, create and revoke the keys an integration uses. This
   existed on the server for the whole life of the console with no screen at all — a key could be minted
   by API and never reviewed or revoked by a person.

## Phase 4 — Academic year
Create the academic year (`POST /academic-years`) with start/end dates → **activate** exactly one current
year per tenant. Fee plans, exams and promotions scope to it. (Two-current is rejected at the DB.)

## Phase 5 — Getting students in (three routes)
1. **Bulk import** (recommended for an existing school): `/data-import` → upload → column mapping →
   per-row validation → **shadow load** (nothing written) → commit. The trust receipt shows the REAL
   `differenceCents` (rows in vs rows landed) — no fabricated zeros.
2. **Manual add**: People → Add person (`POST /students`: name, grade, section, guardian, bus, and —
   new — **date of birth, gender and your own admission-number series**). The class and section are
   validated against the classes your school actually has, so "Grade 77" is refused with the real list
   rather than filed into a class no picker or roster will ever offer; a duplicate admission number is
   answered by naming the pupil who holds it, and a duplicate NAME is refused outright (two children
   with one name cannot be told apart in a roster). The same rules apply per row to a spreadsheet import.
   Record the child's date of birth while you have it — it drives age-based admission and transport
   eligibility, and there was nowhere to put it before.
   For a pupil who needs their own portal login, use **"Give a pupil a portal account"** in the People
   console rather than creating a student account here: the account is bound to the roster row in the
   same step, which is what stops two same-named children inheriting each other's results.
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
- **Attendance**: register marks. A **coordinator, principal or IT admin can hand a teacher a register**
  from Classes & sections ("Who owns which class"), and only then can that teacher mark it — before this
  existed the door had no caller in the SPA, so a brand-new school could never give a teacher a class and
  no teacher could ever mark attendance. Absences queue notices.
- **Homework** (post → submissions → one-shot resubmit 409) · **Exams** — create an exam on Learning
  (weights must total exactly 100%), then bulk marks ≤500 with per-row errors, per-board policy, publish →
  report digests with honest drift detection. A family reads the **moderated** figure: if a result was
  reviewed and corrected, both the office and the family see the correction, never the pre-moderation
  score. · **Library** · **Visitors desk** (check-in → guardian-verified pickup OTP — hashed, CSPRNG,
  single-use) · **Transport** (`/transport` shows the school's real routes; **Routes & stops** creates and
  edits them; GPS telemetry **not connected yet** — the UI says so) · **Maintenance** (ReportIssue →
  work orders, and the board advances each job one step through the same state machine the server
  enforces) · **HR** (`/operations/hr` — today's duty roster, mark and cancel a staff absence) ·
  **Clinic** (`/clinic` — infirmary log, sick pass; a visit that sends a pupil home or refers them to
  hospital raises a guardian notice **for approval**, never sends one) · **Cases** (`/cases` — one queue
  for every channel, with the server's own deadline on each case) · **Files** (type-whitelisted, sha256,
  guardian-scoped downloads) · **Notifications bell** (45s refresh, from `GET /notifications`).

## Phase 8 — Governance
`/audit` (tamper-evident ledger, cold-table archival) · Action Center (approvals with
segregation-of-duties: unattributed proposals route to the owner, never self-approve — and the composer
tells the author who approves rather than offering a button that can only fail) · Reports/BI
(attendance %, fee aging, funnel conversion — SQL read models, cached, capped) ·
**Statutory returns** (`/returns`: the UDISE+ aggregate return, the CBSE OASIS result file, and the
accountant's Tally voucher export — all produced from your records, all refusing rather than guessing
when a setting is missing) · DPDP consent ledger + erasure with keyed surrogates (PII gone, decision
trail preserved).

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
OTP login needs the SMS rail for real phones · **GPS telemetry** · workflow runtime (decision pending:
minimal runner or fiction deleted) · real AI gateway (deterministic templates today — honestly labeled) ·
multi-region. The voice receptionist was removed from scope by owner decision (D-25).

**Closed since this walkthrough was first written** — each of these was a real blocker on the way above,
so if your notes say otherwise, your notes are older than the code:
teacher class-assignment binding (a coordinator can hand out registers) · the whole fee policy card
(late-fee rate, grace and cap are now collectable — "Run late fees" used to be a button that could only
ever answer 409) · staff leave and absence (the HR board is the real add-on, not a demo board) · the
infirmary log · statutory returns · role retirement · API-key review and revocation · pupil portal
accounts · parent↔child linking.

**Still sample-labelled, and said so on screen**: the Operations briefing prose and the asset/vendor
register, the Transport map and its Bus 14 drill, and the Today/Next briefing. Those are demo content
behind an honest note — not broken features, and not worth mistaking for your school's records.
