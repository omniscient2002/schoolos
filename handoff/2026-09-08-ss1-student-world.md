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
- [ ] Unit 2: plugin manifest.js + index.js (all doors, session-isolation headers, student resolution pin)
- [ ] Unit 3: tests/student-world.test.js green (counts reported)
- [ ] Unit 4: integration notes for orchestrator

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
