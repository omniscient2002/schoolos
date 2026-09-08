# SchoolOS — Complete Role Capability Matrix

**Method**: every door below is extracted from the generated permission matrix (`docs/PERMISSION-MATRIX.md`, 178 routes, 0 unguarded) and cross-checked against the door implementations (`server/src/routes.js`, `server/src/plugins/*/index.js`) and the frontend routing map (`app/src/App.tsx:307-403`). In-handler conditions (ownership, SoD, scoping) are cited to code. Labels: **IMPLEMENTED** / **PARTIALLY IMPLEMENTED** / **NOT IMPLEMENTED** / **MOCK** (frontend screen runs on demo dataset, not live doors).

**Shared facts for every role** (from `src/app.js`, `src/db.js`, `src/auth.js`):
- Login: `POST /auth/login` (20/min), OTP `POST /auth/otp/request|verify` (5/min, 10/min; **no SMS sender** — dev echo only), Google SSO `/auth/google/start|callback` (account must pre-exist by email), logout `POST /auth/logout` (revokes the token's `jti`).
- Any-role doors (18): `GET /me`, `GET /dataset` (demo bundle), `GET /students`, `GET /students/:id`, `GET /attendance`, `GET /fees/obligations`, `GET /transport/routes`, `GET /assets`, `GET /cases`, `GET /my-cases`, `POST /cases`, `POST /cases/:id/status`, `GET /events/lineage`, `GET /notifications`, `POST /notifications/read`, `GET /communications`—*no, staff-gated* — plus `GET /plugins` (settings redacted for non-privileged), `GET /migration/sources`, `POST /auth/logout`. (Exact 18 in the matrix; role-independent behavior is described per door below.)
- Every "read" below is **re-filtered by the database**: RLS `tenant_id = current_setting('schoolos.tenant_id')` on 70 tables; parent/student scoping via `family.child_link` / `schoolos.user_id` GUC policies.

---

## 1. OWNER — 95 role-gated doors (the most powerful role)

**Session**: standard 12h JWT. **Screens**: all staff screens + every live screen suite (frontend is role-agnostic for staff; owner passes every staff door).

**People & students**
- `POST /students` — admit a student (name/grade/section validated; `UNIQUE(tenant, admission_no)`).
- `GET /students`, `GET /students/:id` — full roster **with guardian phones** (`STAFF_ROSTER` includes owner), child detail incl. fees+attendance+route.
- `GET /attendance` — whole-school roster view for any date.

**Attendance** — `POST /attendance/mark`? **No** — owner is *not* in the mark door (`teacher, coordinator, principal` only). Owner reads everything but does not take the register.

**Fees** — `POST /fees/payments` (open a payment), `GET /fees/obligations` (all students — no parent scoping), UPI links via plugin. **Cannot** confirm payments: `POST /fees/payments/:id/confirm` is `finance, owner`… *owner IS included* — owner can confirm (`routes.js:209`). But a *finance-owned approval action* can only be decided by finance (owner-check excludes finance-owned actions from owner/principal override, `routes.js:446-447`).

**Approvals (action spine)** — `GET /actions`, `POST /actions/:id/decide`: can decide **any** open action regardless of `owner_role` except (a) finance-owned (finance only) and (b) self-proposed (`routes.js:448-449`).

**Transport** — `POST /transport/events` (delay event → kernel approval action), `GET /transport/routes`.
**Work orders** — `GET/POST /work-orders`, `POST /work-orders/:id/status` (state machine open→triaged→in-progress→resolved→closed, 409 on illegal moves).
**Cases** — all case doors; `GET /cases` full school log (any-role door but in-handler staff gate; owner passes).
**Governance spine** — `GET /events`, `GET /communications`, `GET /audit` (**hash-chained ledger read** — one of 4 roles), `POST /memory` (institutional decisions; **cannot** read it back — `GET /memory` is owner/principal/itadmin… owner IS included ✓).
**Plugins** — `GET /plugins`, `POST /plugins/:id/enable|disable|settings` (owner + itadmin only; disable runs the **drain protocol** — open actions handed to Principal desk, lineage counted, `routes.js:624-641`).
**Migration wizard** — `POST /migration/sources`, `POST /migration/sources/:id/stage`, `POST /migration/activate` (owner+principal only; trust-receipt event).
**Plugin doors owner shares**: full admissions funnel (FULL_PII), exams (incl. publish execute, moderations), hr.leave OFFICE+DESK, ops.timetable (+substitutions, autofill), comms templates+receipts, **tally daybook/export**, safety box read+close, students print/wellbeing staff doors, coord doors? **No** — coord.view is coordinator+principal only (`AUTHORITY`), owner excluded from coord doors.
**All teacher.copilot/parent.assistant staff-side doors** where listed (brief, curriculum, mastery, usage).

**Cannot (owner)**: take attendance (`POST /attendance/mark` — not in guard), decide finance-owned approvals, see coord.view doors (coordinator/principal only), access any parent/student-scoped row that isn't theirs, cross-tenant anything (RLS).

---

## 2. PRINCIPAL — 94 doors

Same as owner EXCEPT (verified diff of the two door lists):
- **Has**: `POST /attendance/mark` (principal takes the register), the **entire coord.view suite** (`GET /coord/home|curriculum-monitor|teacher-workload|escalations`, `POST /coord/substitution/decide|duty/allocate|copilot-lite` — coordinator+principal only).
- **Has not**: plugin enable/disable/settings, migration source staging, tally daybook/export, WhatsApp template registration (`POST /plugins/comms.whatsapp/templates` is owner-only).
- **SoD on decisions** (`routes.js:436-449`): principal **cannot approve coordinator-owned actions** (403 'Segregation of duties — ask the owner to decide this'); cannot decide finance-owned actions; cannot approve self-proposed; **may dismiss** anything (dismissal path is unrestricted); principal-owned flows (DPDP SARs, exam publications, dismissal of actions) fully intact.
- Everything else mirrors owner: audit read, memory write+read, events, communications, all staff plugin doors, cases, work orders, transport events, safety box, migration activate (owner+principal).

---

## 3. COORDINATOR — 86 doors

- **People**: `POST /students`, roster reads with phones.
- **Attendance**: `POST /attendance/mark`, `GET /attendance`; timetable autofill (`POST /plugins/ops.timetable/attendance/autofill` — unmarked marked present, audited).
- **Fees**: `GET /fees/obligations` (no parent scoping) — **cannot** open or confirm payments.
- **Coord.view suite (the coordinator's own plane, `coord.view/index.js`)**: `GET /coord/home` (staffing today, substitution gaps, pending approvals, curriculum delays, open issues — identity shown **only where coordinator is the routed authority**, `:18-22`), curriculum monitor (term pace), teacher workload (**aggregates + overload boolean only — no score/rank by design**, EXTRA_LOAD_LIMIT=8), `POST /coord/substitution/decide` (executes **only coordinator-owned kernel actions**, mirrored SoD), `POST /coord/duty/allocate` (fairness-aware least-loaded), escalations, copilot-lite (keyword intents, 200/month).
- **Timetable**: grid read + `POST /plugins/ops.timetable/substitutions` (upsert, emits `substitution.assigned`).
- **Admissions funnel with FULL_PII** (see role §6 for the lattice), exams staff+admin tiers (marks entry, publish raise/execute, moderation decide), hr.leave OFFICE tier (approve/cancel) + DESK (roster), transport events, work orders (create+status), cases, actions/events/audit read, memory **write only** (`GET /memory` excludes coordinator), communications read, safety box read+close, students print/wellbeing staff doors, WhatsApp templates+receipts read, tally (no — tally is owner/itadmin/finance), plugins read (settings redacted? — coordinator is not in `isPrivileged` (`owner, itadmin`) so sees `hasSettings/keys` only).
- **Cannot**: confirm payments, read memory, plugin admin, migration activate, see another coordinator's routed identities, decide finance-owned actions, approve coordinator-owned actions **if principal** — n/a; coordinator deciding coordinator-owned: allowed only if not self-proposed.

---

## 4. FINANCE — 23 doors

- **Fees (the core)**: `POST /fees/payments` (open), `POST /fees/payments/:id/confirm` (**the settlement authority** — finance+owner only; `FOR UPDATE`, obligation `paid_cents` update, receipt row queued), obligations read (all students).
- **Tally accounting**: daybook, export, export history (finance+owner+itadmin).
- **UPI**: `POST /plugins/payments.upi/links` (finance+owner+principal), obligations gating (due ≤0 → 409; open attempt → 409).
- **Actions/events**: decide board (finance-owned actions are decidable **only by finance**), audit read (finance is one of the 4), memory write, communications read, events read.
- **Misc**: work orders read, admissions leads (FULL_PII), timetable grid, WhatsApp templates/receipts read, safety box read+close.
- **Cannot**: attendance marking, homework/concern/PTM plane, coord suite, plugin admin, memory read.

---

## 5. ADMISSIONS — 7 doors

The narrowest staff role, by design: `POST /students`, funnel doors (`POST /plugins/admissions.funnel/leads`, `GET /leads` **with FULL_PII** — guardian names/phones visible, stage moves along the enforced lattice enquiry→form→interaction→offer→enrolled (+rejected/withdrawn; illegal moves rejected; FOR UPDATE), lead history, funnel summary), decide board + events read, timetable grid, safety box read+close.
**Cannot**: everything else — no fees, no audit, no attendance, no homework, no plugin admin. Funnel PII masking does not apply (admissions IS the FULL_PII tier).

---

## 6. TRANSPORT — 13 doors

- `POST /transport/events` (route delay → raises kernel approval for guardian notice; governance budget/breaker checked with pluginId 'transport' — currently unregistered → always allowed, flagged in core dossier),
- GPS: `POST|GET /plugins/transport.gps/positions` (ingestion + read; delay ≥10 raises approval).
- Work orders read; actions/events decide+read; communications read; timetable grid; WhatsApp templates/receipts read; safety box read+close.
- **Cannot**: routes/stops CRUD (no door exists — **NOT IMPLEMENTED**), attendance, fees, audit, plugin admin.

---

## 7. FACILITIES — 10 doors / 8. TECHNICIAN — 9 doors

Nearly identical: transport events (facilities only), work orders create+status (technician: status only — `POST /work-orders` excludes technician? verified: technician has `POST /work-orders/:id/status` + `GET /work-orders` only; facilities has create too), decide board + events, timetable grid, safety box read+close, both **in `STAFF_ROSTER` → guardian phones visible on roster reads**.
Facilities extra vs technician: `POST /transport/events`, `POST /work-orders`.
**Cannot**: fees, attendance, audit, memory, homework plane, plugin admin.

---

## 9. TEACHER — 46 doors (the working core)

**Attendance**: `POST /attendance/mark` (whole-class register; absentees generate queued `ABSENCE_NOTICE` comms), `GET /attendance`, timetable grid + autofill.
**Homework (privacy-pinned)**: `POST /plugins/teacher.classroom/homework` (class/subject/title/due validated; attachment = validated name/http(s) string only — `javascript:` refused), `GET /plugins/teacher.classroom/homework` (**only own: `created_by = $1` unconditional pin**, `:90`), detail, `POST /submissions/:id/review` (**assigning teacher only** — another teacher's submission id → 403, `:179`; grade only with status='graded'), `GET /submissions?state=pending|reviewed|late|missing`.
**Leave**: `POST /teacher/leave` (raises kernel action `teacher.leave.<id>`), `GET /teacher/leave/mine` (mirrors kernel decision), hr.leave roster read + leave list (DESK tier), own leave via hr plugin? teacher reads `GET /plugins/hr.leave/leave`.
**Exams (EXAM_STAFF tier)**: `GET /plugins/exams.assessment/exams`, `POST /exams/:id/marks` (locked after publish → 409; per-write audit), report read per student. **Cannot** publish or moderate (EXAM_ADMIN/MOD_TIER exclude teacher).
**Concerns & student support (teacher.support)**: file a concern (`POST /teacher/concern` — **filer cannot route own**, `:178`), read concerns, **cannot route** (ROUTE_AUTHORITY = owner/principal/itadmin/coordinator), outcome designee only when routed to them; doubts: read, answer, promote-FAQ; interventions create/transition; PTM: publish slots, book? (no — parents book), private notes via dedicated `schoolos.user_id` GUC connection.
**Safety box: NO ACCESS AT ALL** (BOX_READERS excludes teacher; weekly summary counts only — the confidentiality pin).
**Wellbeing queue: NO** (WELLBEING_READERS = principal/coordinator/owner/itadmin).
**Student ops**: print queue + mark done, noticeboard publish (student.world staff doors).
**Copilot (rule-based, no AI)**: curriculum tree/progress read+write, mastery per student/class, teacher brief, draft/ask, usage.
**Decide board**: actions read + decide (teacher-owned actions only; cannot approve self-proposed; cannot decide finance-owned).
**Work orders**: create + read (no status transitions).
**Cannot**: audit, memory, payments/confirm, fees beyond read, plugin admin, coord suite, funnel PII (leads list is **masked** for teacher — names/phones nulled/masked, `admissions.funnel:137,153-154`), students create.

---

## 10. ITADMIN — 84 doors

Same as coordinator minus the operational writes (no student create, no attendance mark, no transport events, no work-order status) PLUS the admin plane: `GET /audit`, `GET /memory`, `POST /plugins/:id/enable|disable|settings` (with owner — the only two), tally suite, plugin settings visibility unredacted (`isPrivileged`), everything read-side (events, communications, funnel FULL_PII, exams incl. admin tiers? — itadmin is in EXAM_ADMIN/MOD_TIER ✓, safety box, print/wellbeing queues, cases, WhatsApp templates **read only** (template registration is owner-only)).
**Cannot**: attendance register, student create, work-order status changes, memory write? — itadmin lacks `POST /memory` (owner/principal/coordinator/finance only), transport events, payments.

---

## 11. PARENT — 18 doors (structurally scoped)

Every child-scoped door re-derives "my children" from `family.child_link` (`UNIQUE tenant+user+student`) — a forged studentId returns empty/403/404, never another family's data (verified live):

- `GET /parent/home` — per-child today: attendance, digital/paper homework (roster↔user bridge, grade-scoped, fail-closed), consents, attention tiers. Teacher-refused (403).
- `GET /parent/child/:id/timeline` — 403 unless the child is linked (`assertOwnChild`, `family.view:113`); attendance 30 + submissions 30 (grade-scoped) + published reports, 50 max.
- `GET /parent/child/:id/academics|attendance|exams` — published marks only, growth framing (no rank), fee view via obligations read.
- `GET /parent/consents` + `POST /parent/consents/:id/decide` — own children's consent requests; decided rows are final (409 'decisions are final' + DB guard in 034).
- `POST|GET /parent/requests`, `POST /parent/report-discrepancy` (parents never edit records — discrepancy goes to staff, policyRef §82), `POST /parent/leave-request` (raises kernel action, 48h SLA).
- `GET /parent/brief`, `POST /parent/copilot/ask|draft`, `GET /parent/explain/:topic` — deterministic, own-rows only, banned-judgement words, 100/month cap.
- `GET /ptm/slots` + `POST /ptm/book` — books **only for their own child** (name-guarded 403, `teacher.support:698`).
- `POST /fees/payments` — open a payment for **their child's obligation** (scoping via obligations read); confirm is staff-only.
- Auth-only shared reads: `/students` (own children only, `LEFT JOIN child_link`), `/students/:id` (child_link check → 404), `/attendance` (`scoped: own_children`), `/fees/obligations` (own children), cases (own + open), notifications, events lineage, plugins (redacted).
- **Screens (live)**: /parent/family, /parent/consents, /parent/requests, /parent/copilot. Legacy mock: /parent, /parent/chat, /parent/fees, /parent/ask (dataset).
- **Cannot**: any staff door (403 at require), audit/memory/events actions, other families' anything (child_link + RLS), noticeboard/staff queues, plugin admin.

---

## 12. STUDENT — 19 doors (kiosk-isolated)

Session: **30m TTL** (`STUDENT_SESSION_TTL`), every `/student/*` response gets `no-store` + `Clear-Site-Data` (shared-computer safety, `student.world:60-68`); identity via demo name-match `ownStudent`; RLS adds the `schoolos.user_id` GUC so other students' rows are hidden at the database level (owner-scoped policies).

- `GET /student/home` — IST day grid, digital/paper homework split by mode, progress *direction* from last two published reports (no rank).
- `GET /student/homework`, `GET /student/results`, `POST /plugins/teacher.classroom/homework/:id/submit` — class gate fail-closed ('This homework is for a different class'), duplicate → 409, late decided at insert.
- Mistakes journal: create/list/delete own; flashcards create/list; study tasks create/list — all user-scoped via the GUC.
- `POST /student/print` + `GET /student/print/mine` — print center (paper-first contract).
- `GET /student/noticeboard`; `GET /student/session` (kiosk idle expiry).
- `POST /student/wellbeing` — wellbeing request (readable only by WELLBEING_READERS, never classroom teacher).
- `POST /safety/box` — **anonymous by default**: no reporter identity stored (audit actor 'anonymous (student)').
- Doubts: `POST /plugins/teacher.support/doubt` (deterministic timetable routing, no AI), `GET /teacher/support/doubts` (own).
- **Cannot**: every staff door, other students' anything, fees (no payment door), wellbeing/safety reads (even own safety report — anonymous), audit, print queue (staff side).

---

## Cross-role one-line differences (verified)

| Action | owner | principal | coordinator | finance | teacher | itadmin | parent | student |
|---|---|---|---|---|---|---|---|---|
| Take attendance | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Admit student | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Confirm payment | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Decide finance-owned action | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Approve coordinator-owned action | ✓ | ✗ (SoD) | ✓ (non-self) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Publish exam | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Enter marks | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Route a concern | ✓ | ✓ | ✓ | ✗ | ✗ (filer) | ✓ | ✗ | ✗ |
| Read safety box | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Read audit ledger | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ |
| Enable/disable plugin | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| See coord.view suite | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| See admission lead PII | ✓ | ✓ | ✓ | ✓ | masked | ✓ | ✗ | ✗ |
| See guardian phones on roster | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | own only | ✗ |
| Read institutional memory | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Write memory | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Migration activate | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

*Every ✓/✗ above is mechanical — extracted from `docs/PERMISSION-MATRIX.md` guard lists (door count per role: owner 95, principal 94, coordinator 86, itadmin 84, teacher 46, finance 23, parent 18, student 19, transport 13, facilities 10, technician 9, admissions 7) plus in-handler SoD/ownership code cited per role. Beyond door access, RLS adds the tenant wall for all roles, and parent/student/teacher layers add their structural scoping pins described above.*
