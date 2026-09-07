# SS-1 · student.world — handoff (2026-09-08)

Lane: server/src/plugins/student.world/** · server/migrations/036_student_world.sql ·
server/tests/student-world.test.js · this file. Nothing else touched (LANE LAW).

Hard constraint being implemented: students have NO personal phones — every door runs on
school computers/kiosks. §78/§79 session isolation on shared machines is a SECURITY
requirement: when a student session ends, nothing may leak to the next student.

Plan / status log (appended after each unit):
- [x] Unit 1: migration 036 — DONE. Verified: fresh test DB `migrate.js` applies 036 and a
  second run is a clean no-op (idempotent ×2). All 5 tables + 8 RLS policies present
  (tenant_isolation ×5, owner_scoped ×3 on mistake_note/flashcard/study_task).
  NOTE (pre-existing house property, matches 034 exactly): migrate.js runs before seed.js
  creates the tenant, so the `INSERT … FROM app.tenants` registry/contract/ledger rows
  match zero tenants at migration time on a FRESH db — the owner enable door materializes
  the registry row (parent-family.test.js relies on the same mechanism). On any db where
  tenants already exist the inserts land directly; replay is guarded by WHERE NOT EXISTS.
- [x] Unit 2: plugin manifest.js + index.js — DONE. All doors live and smoke-verified:
  GET /student/home (own name/grade/section, next_class from the IST day grid, today counts,
  needs_attention overdue-homework, progress improving|steady|declining from last two
  published pcts, bag_tomorrow with lab hints) · GET /student/homework (digital/paper split
  via information_schema probes; paper = "Complete in notebook — teacher marks receipt") ·
  GET /student/results (own published reports + one-line plain explains, family.view style) ·
  POST/GET/DELETE /student/mistakes · POST/GET /student/flashcards?deck= · GET/POST
  /student/tasks (POST with {id,done} toggles; GET carries homework-derived tasks_view) ·
  POST /student/print + GET /student/print/mine + staff GET /student/print/queue +
  POST /student/print/:id/done · GET /student/noticeboard (student + staff) ·
  POST /student/wellbeing + staff GET /student/wellbeing (principal/coordinator/owner/
  itadmin — teacher refused) · GET /student/session.
  Isolation guarantees, all pinned by test:
    1. onSend hook on /student/* → Cache-Control: no-store + Pragma: no-cache +
       Clear-Site-Data: "cache", "storage" on EVERY /student/* response (rides auth
       failures — the safe direction).
    2. withStudentUser(): user-scoped connection setting tenant + schoolos.user_id GUCs +
       SET LOCAL ROLE schoolos_app; the owner_scoped RLS policies make tenant match alone
       insufficient for mistakes/flashcards/tasks — verified at the DB layer (no user GUC →
       zero rows).
    3. withUser() doors (home/homework/results/noticeboard) scope every query by the
       resolved OWN student row or user id; staff print queue is read-only over the
       tenant's queued jobs; wellbeing staff door hides identity for anonymous rows.
    4. GUC note: set_config params must be explicitly ::text-cast in this driver mix
       (pg 42P18 with untyped $1 — 032's teacher-note helper casts at the call site via
       literal strings; we cast inline).
- [x] Unit 3: tests/student-world.test.js — GREEN. Final run on a fresh DB
  (DROP DATABASE IF EXISTS schoolos_test WITH (FORCE) → harness migrate+bootstrap+seed →
  node --test tests/student-world.test.js): tests 11 · pass 11 · fail 0 (~13s).
  Covers: enable-via-owner-door, home shape + roster-wide string scan (25 random other
  students + guardian names/phones must not appear), isolation headers on every student
  door, session contract, mistakes CRUD own-only incl. second-student context (user
  student-b@meridian.edu) + DB-layer RLS pin, flashcards deck filter, tasks toggle +
  tasks_view, print queue staff flow + terminal printed state + student 403 on staff door,
  noticeboard blocks, wellbeing anonymous-identity + teacher refusal + spine events,
  graceful degradation (absent → empty; present → split; absent again → stable), role
  gates + lifecycle 409 with plain message.
- [x] Unit 4: integration notes for orchestrator (this section).

## Orchestrator integration notes

1. ONE-LINE routes.js/app.js SUGGESTION (shared file — NOT applied per lane law):
   in src/app.js, the `/auth/logout` handler (currently ~line 167, registered before the
   plugin loader mounts) should add, when the requester is a student:
   ```js
   app.post('/auth/logout', { preHandler: app.authenticate }, async (req, reply) => {
     await withUser(/* …unchanged audit… */);
     if (req.user?.role === 'student') reply.header('Clear-Site-Data', '"cache", "storage"');
     return { ok: true };
   });
   ```
   "cookies" can be added if cookie sessions ever land (auth is JWT-bearer today, so
   cache+storage is complete). Until then, student.world already sends
   Clear-Site-Data: "cache", "storage" on every /student/* response (sanctioned fallback),
   so the kiosk clears itself on the next student's first student-door hit even before the
   logout patch lands.
2. Kiosk UI contract: GET /student/session → { idle_minutes, logout_url } —
   STUDENT_IDLE_TIMEOUT_MINUTES env (default '10'), clamp ≥1; UI should count down and hit
   POST /auth/logout (then the header in (1)) on expiry.
3. Homework shape (now REAL): a sibling wave landed teacher.homework/submission
   (class_grade/subject/title/detail/due_at + mode; GRANT SELECT to schoolos_app) during
   this session — the digital/paper split runs against the real table and the degradation
   test still pins absent/present/absent stability by force-dropping and recreating the
   table locally. mode semantics: mode containing 'paper' OR detail mentioning
   notebook/paper ⇒ paper; else digital.
4. Timetable limitation (honest): app.timetable_slots (021) has NO class/section column —
   the grid is uniform per section, so /student/home serves the tenant day grid for the
   student's own class via DISTINCT period reads. When a per-section slots table lands,
   narrow daySlots by grade+section (one WHERE).
5. Exam reports carry no subject column either (025) — progress rows are keyed by exam
   name with direction from the last two published snapshot->>'pct' values. A subject key
   can be added the day the snapshot schema carries one.
6. Registry rows materialize via the owner enable door on fresh DBs (seed truncates
   platform data and replays only ≤030) — same mechanism family.view relies on; on DBs
   with pre-existing tenants the 036 inserts land directly and are WHERE NOT EXISTS-guarded.
7. Migration slots: 035 (parent.assistant) and 037 (coord.view) were taken by sibling
   lanes mid-session; 036 was free and lands clean. CI note (pre-existing): tests share
   the single schoolos_test database — serialize node --test runs across lanes; sibling
   force-drops mid-run are the only way this suite fails today.

Design pins decided up front (evidence from repo study):
- Student identity resolution: the kernel has role='student' (auth.js ROLES + `selfOnly`)
  but NO user↔student foreign key anywhere. The demo seed (server/scripts/seed.js) creates
  user `student@meridian.edu` = 'Aarav Sharma' and exactly one student row named
  'Aarav Sharma' (8-B; all collisions renamed 'Aarav S. …'). Migration 031 (TeacherOS
  homework lane) is NOT on disk yet, so teacher.homework does not exist in a fresh test DB —
  every homework read probes information_schema and degrades gracefully.
- PIN: a student resolves to their student row by
  `app.students WHERE tenant_id=current_setting('schoolos.tenant_id',true)::uuid
   AND lower(name)=lower($user.name) AND status='active' LIMIT 1`.
  User-owned tables (mistakes/flashcards/tasks/print) are creator_user_id-scoped with an
  RLS policy pinned to schoolos.user_id (032 teacher.note precedent) — belt AND braces:
  even a door bug cannot widen a student to another student's rows.
- Timetable: app.timetable_slots has NO class/section column (021: UNIQUE(period, day,
  subject, teacher)); the demo grid is uniform per section, so /student/home serves the
  tenant grid for the student's own class via DISTINCT period/day reads. Honest limitation,
  documented for the orchestrator (not silently faked per-section).
- Progress: plugin_exams.report.snapshot->>'pct' per exam (exam has no subject column) —
  progress rows are keyed by exam name, direction improving|steady|declining from the last
  two published pcts. Absent table → [].
- Logout Clear-Site-Data: /auth/logout lives in src/app.js (not routes.js) and is registered
  BEFORE the plugin loader mounts, so an onSend hook added from this plugin cannot attach to
  it (Fastify snapshots hooks at route-registration time). One-line routes.js/app.js
  suggestion documented in Unit 4 for the orchestrator; meanwhile /student/* responses carry
  Cache-Control: no-store + Pragma: no-cache via a scoped onSend hook, and
  GET /student/session exposes {idle_minutes, logout_url} (STUDENT_IDLE_TIMEOUT_MINUTES,
  default 10) for the kiosk UI countdown.
