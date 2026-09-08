# TS-1 retry — teacher.classroom (migration 031 · plugin · tests) — step log

Lane: own ONLY `server/src/plugins/teacher.classroom/**`, `server/migrations/031_teacher_classroom.sql`, `server/tests/teacher-classroom.test.js`, this handoff. Never touched family.view / teacher.support / teacher.copilot / routes.js / app / seed.js.

## State found at retry start
- `031_teacher_classroom.sql`, `teacher.classroom/{manifest.js,index.js}` existed committed (guards already tenant-correlated by the PS-2 lane, cc6ae86).
- `tests/teacher-classroom.test.js` did NOT exist.
- Dev DB `schoolos`: stale same-name 031 in `app.schema_migrations` (older partial application: tables OK, but **no** fixtures, **no** registry row, **no** ledger entry `teacher-classroom@1`), so `migrate.js` would skip the file forever.

## Steps
1. Re-read `index.js` + `manifest.js` to refresh door contracts; re-read `routes.js` enable/decide, `helpers.js`, seed cast.
2. **3 index.js bugs fixed** (details in "Bugs fixed" below): review door 404-instead-of-403 for colleague; dead `app.students` name joins (submissions key the user id); missing-inbox anti-join blind to user-identity submissions (Aarav would show "missing" after submitting). Also hardened the leave mirror to carry `decided_by`/`decided_at` from the kernel action.
3. Wrote `tests/teacher-classroom.test.js` (11 tests, parent-family conventions: before/after buildApp, `loginAs`, cached tokens — login limiter is 20/min; every POST carries a JSON body so no FST_ERR_CTP_EMPTY_JSON_BODY path exists).
4. Fresh-DB verify: `DROP DATABASE IF EXISTS schoolos_test WITH (FORCE)` → `node --test tests/teacher-classroom.test.js` → first run failed at teacher2 login.
5. **Root cause (fresh-DB ordering)**: `setupTestDb` = migrate → bootstrap → seed; migration 031 runs BEFORE seed, so its tenant/user-dependent inserts (fixtures, registry row, contracts, ledger) are silent no-ops; seed.js replays only migrations **009–030** (hardcoded list — not my lane to extend). The house's own answer is the enable door's registry upsert (routes.js `/plugins/:id/enable`). Fix *inside my lane*: test guarantees the two fixture users idempotently (`INSERT … ON CONFLICT DO NOTHING`, same scrypt format via `hashPassword`) before logging in; migration keeps its fixture insert for live DBs (where it applies post-seed).
6. Rerun fresh → **11/11 pass**.
7. Applied 031 to the dev DB directly via psql (idempotent by design, bypassing the stale `schema_migrations` record), **twice**: apply #1 inserted the ledger entry; apply #2 inserted nothing → ×2 idempotency proven on dev as well.
8. Dev verification: registry `teacher.classroom/registered` · contracts 3/tenant (multi-tenant dev: 9 rows total, per-tenant singleton held) · ledger `teacher-classroom@1` = 1 · fixtures teacher2@/student2@ present · `tenant_isolation` RLS policy on all 3 tables · grants to schoolos_app present.
9. Sibling suites (one file per process — see gotcha below): `plugin-loader.test.js` **4/4**, `parent-family.test.js` **8/8** (family.view reads my `teacher.homework`/`teacher.submission` — clean).

## Gotcha for the next integrator
`node --test fileA fileB` runs files **in parallel**; any two suites calling `setupTestDb()` race on the same `schoolos_test` (DROP/CREATE + `schema_migrations` PK → `_bt_check_unique`, then a 300s hang). Run suites one process at a time.

## Bugs fixed in index.js (for integration review)
1. **Review door masked the assigning-teacher pin as 404.** The SELECT filtered `h.created_by=$2`, so a colleague got "We couldn't find that submission" (404) instead of the required 403. Now: fetch without the owner filter (RLS still tenant-scopes), 404 only when truly absent, then `403 'Only the teacher who assigned this homework can review it'`.
2. **Dead student-name joins.** Submissions key `student_id` to the signed-in student USER id, so `LEFT JOIN app.students st ON st.id = s.student_id` never matched → `student_name` always NULL. Now joins `app.users su ON su.id = s.student_id` (detail door + inbox).
3. **Missing-inbox false positives.** Roster anti-join compared `s.student_id = st.id` (roster id ≠ user id), so students who HAD submitted appeared missing. Now bridges roster↔user with the 034 name-match convention (`s.student_id = st.id OR lower(su.name) = lower(st.name)`).
4. **Leave mirror carried no decider identity.** `/teacher/leave/mine` now mirrors `decided_by`/`decided_at` from the kernel action (not just `now()`), keeping the action row the single source of truth.

## Doors shipped (all `lifecycleGate`-gated, plain-language errors, `uuidParams` on :id)
- `POST /plugins/teacher.classroom/homework` (teacher; audited; emits `homework.v1`)
- `GET  /plugins/teacher.classroom/homework?mine=1` (teacher; unconditional `created_by=self` pin)
- `GET  /plugins/teacher.classroom/homework/:id` (assigning teacher only; colleague → 404, no data)
- `POST /plugins/teacher.classroom/homework/:id/submit` (student; one-shot UNIQUE via SAVEPOINT → 409 "Already submitted — resubmission is requested by your teacher, not allowed here"; `submitted_at > due_at` ⇒ `late`; emits `submission.v1`)
- `POST /plugins/teacher.classroom/submissions/:id/review` (assigning teacher only; `reviewed|graded|resubmit_requested`, grade only with `graded`)
- `GET  /plugins/teacher.classroom/submissions?state=pending|reviewed|late|missing` (teacher inbox; missing = roster anti-join with name bridge)
- `POST /teacher/leave` (teacher self; per-instance kernel action `teacher.leave.<requestId>`; emits `staff.leave.requested.v1`)
- `GET  /teacher/leave/mine` (teacher; mirrors kernel decision into the row)
- Coordinator decides on the standard kernel door `POST /actions/:id/decide` (`owner_role='coordinator'`).

## Verification (final)
- Fresh DB: `node --test tests/teacher-classroom.test.js` → **tests 11 · pass 11 · fail 0**.
- `plugin-loader.test.js` → **4/4** · `parent-family.test.js` → **8/8**.
- Dev DB: 031 applied ×2, ledger singleton `teacher-classroom@1`, registry row + contracts + fixtures + RLS verified.

## Integration notes
- Migration 031's data-plane inserts (registry/contracts/ledger/fixtures) only take effect where the migration applies AFTER seed (live DBs). On fresh test DBs the enable-upsert covers the registry row; the test covers the fixture users. If a future lane extends seed.js's replay list (009–030), adding `031_teacher_classroom.sql` would make fresh DBs fully self-provisioning.
- `student_id` on submissions is the student USER id (identity pin — no picker, no body override). family.view's timeline probe (`sub.student_id = <roster child id>`) therefore matches nothing for user-submitted work until a roster↔user bridge is agreed cross-lane (034 name-match is the candidate convention). Left untouched — family.view is not my lane.
