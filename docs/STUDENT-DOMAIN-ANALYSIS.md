# STUDENT DOMAIN — full-depth analysis

> **Scope.** The complete student experience as built on the current tree: `student.world` (036),
> the student UI surfaces, `studentApi.ts`, session isolation, and the student-facing doors that live
> in other plugins (homework submit, safety box, doubt, fees, exams, library). Companion to
> `docs/STUDENTOS-PLAN.md` (design) and `docs/TEACHER-PARENT-STUDENT-PERFECT-100.md` (register).
> Every claim cites `file:line`.
>
> **Method.** Read `student.world/index.js`/`manifest.js`, migration 036, the student screens,
> `studentApi.ts`, `App.tsx`, `Shell.tsx`, `DemoBar.tsx`, `effective-access.js`, and
> `student-world.test.js`. Nothing was edited.
>
> **Status (living).** A hardening batch closed **STU-GAP-9** (client now reads `idle_minutes`, the
> field the server sends), **STU-GAP-11** (`print_job` gained a RESTRICTIVE owner-scope policy in
> migration 113 — staff roles still read the queue), **STU-GAP-7** (wellbeing filing UI on the
> student home: Get help → counselor plane, anonymous supported), **STU-GAP-8** (the staff queue
> now returns `payload` and the UI renders it as a real printable sheet), **STU-GAP-18** (`POST
> /student/print/:id/cancel` makes `cancelled` reachable), and API-11 (results shape reconciled).
> The `student.home.v1` contract is now emitted (API-13). A surface batch then closed the learn lane
> **STU-GAP-1…6** (`app/src/screens/student/learn/**`: homework + digital submit, mistakes,
> flashcards + study mode, study tasks, results) and **STU-GAP-16**. Remaining: session TTL/idle
> server enforcement (STU-GAP-9's server half), student identity link (STU-GAP-12), and the
> attendance/announcements/calendar/library surfaces (STU-GAP-14).

---

## 0 · Verdict at a glance

The SS-1 server plane is largely built and well-pinned: 18 doors, all 12 frozen contracts exist,
RESTRICTIVE owner-scoped RLS on the self-study tables, no cross-student PII leak (pinned by a
roster-wide string scan), anonymous-wellbeing identity CHECK, school-controlled printing. The
**student-facing plane is largely absent or fixture-only**: Homework/Mistakes/Flashcards/StudyTasks/
Results/Wellbeing-filing have **no UI**, print is metadata-only, `/student/fees` is URL-only, the
idle timeout is client-only and reads the wrong field, and `/student`/`/student/learning`/
`/student/portfolio` are stubs or fixtures.

| Axis | Weight | Score | Reason |
|---|---|---|---|
| Server/API contract | 20 | 80 | all 12 frozen doors; graceful degradation; print payload not rendered; idle field mismatch |
| Data model & RLS | 15 | 78 | RESTRICTIVE owner-scope + anonymous CHECK; `print_job` unscoped; schema drift |
| Session isolation | 15 | 60 | no-store + logout clear; idle not server-enforced; client field bug; TTL unpinned |
| Product completeness / UI | 25 | 22 | homework/mistakes/flashcards/tasks/results/wellbeing filing absent; print metadata-only |
| RBAC & identity | 10 | 70 | counselor role real; self-scoping via `student_accounts`; name-match identity; DARK surfaces |
| Tests | 8 | 70 | strong SS-1 pins; no TTL/idle/logout/print-owner/UI pins |
| Frontend honesty | 7 | 65 | stubs/sample notes honest; stale door comment; false wellbeing-routing claim |
| **Total** | **100** | **~48** | |

---

## 1 · Purpose & hard constraint

Students carry **no personal phones** (`STUDENTOS-PLAN.md:3`). Every feature works on school
infrastructure (lab/kiosk/teacher machine), via teacher mediation, or on paper, with home access
device-agnostic. Feature classes: **S**chool infra · **T**eacher-mediated · **P**aper-supported ·
**H**ome access. No feature may be essential because of a phone. No streaks/feeds/engagement loops.

---

## 2 · Roles

| Role | Student-domain reach |
|---|---|
| `student` | own home/homework/results; own mistakes/flashcards/tasks/prints; noticeboard; file wellbeing; file safety box; file doubt; submit homework |
| `teacher`/`coordinator`/`principal`/`owner`/`itadmin` | print queue + noticeboard |
| `principal`/`coordinator`/`owner`/`itadmin`/`counselor` | wellbeing queue |
| `parent` | refused on student-owned doors |

Role consts: `student.world/index.js:30-42` (STUDENT / STAFF / WELLBEING_READERS /
EVENT_FEED_ROLES).

---

## 3 · Plugin & schema

`student.world` (migration `036_student_world.sql`), schema `student`, `class:'C'`, `trust:'T1'`,
`defaultEnabled:false`.

---

## 4 · Data model

| Table | Key columns | Constraints | Owner-scoped RLS | Grants |
|---|---|---|---|---|
| `student.mistake_note` | id, tenant_id, creator_user_id, student_id?, subject, topic, what_wrong, correction, lesson, timestamps | — | **RESTRICTIVE `creator_user_id = schoolos.user_id`** (`036:125-127`) | SELECT/INSERT/UPDATE/DELETE (`036:131`) |
| `student.flashcard` | id, tenant_id, creator_user_id, student_id?, deck, front, back, subject?, topic?, created_at | — | RESTRICTIVE (`036:125-127`) | SELECT/INSERT/UPDATE/DELETE |
| `student.study_task` | id, tenant_id, creator_user_id, student_id?, title, due_date?, done, done_at?, timestamps | — | RESTRICTIVE (`036:125-127`) | SELECT/INSERT/UPDATE/DELETE |
| `student.print_job` | id, tenant_id, creator_user_id, student_id?, kind, payload jsonb, status, printed_by?, printed_at?, timestamps | kind ∈ 7; status ∈ queued/printed/cancelled (`036:74`) | **none** (tenant only) | SELECT/INSERT/UPDATE (`036:132`) |
| `student.wellbeing_request` | id, tenant_id, creator_user_id?, student_id?, category, detail, anonymous, status, handled_by?, handled_at?, timestamps | category ∈ 6; status ∈ submitted/in_support/resolved; **CHECK anonymous ⇒ creator_user_id IS NULL AND student_id IS NULL** (`036:98`) | none (staff-read by design) | SELECT/INSERT/UPDATE |

**Findings:**
- **STU-DAT-1 (P2):** `print_job` is declared user-owned (`index.js:4-5`, `manifest.js:17`) but has
  **no owner-scoped policy**; `/student/print/mine` relies solely on `WHERE creator_user_id=$1`
  (`index.js:432`). A door bug would expose same-tenant print jobs at the DB layer.
- **STU-DAT-2 (P3):** schema drift vs plan: `study_task.source` absent; `mistake_note.at` →
  `created_at`; `flashcard.created_by` → `creator_user_id`; `print_job.requested_at` →
  `created_at`.
- **STU-DAT-3 (P3):** `print_job.status='cancelled'` is unreachable (no cancel door).

---

## 5 · Door inventory (18 doors, `server/src/plugins/student.world/index.js`)

| # | Method + path | Roles | Line |
|---|---|---|---|
| 1 | `GET /student/home` | student | :171 |
| 2 | `GET /student/homework` | student | :242 |
| 3 | `GET /student/results` | student | :253 |
| 4 | `POST /student/mistakes` | student | :271 |
| 5 | `GET /student/mistakes` | student | :292 |
| 6 | `DELETE /student/mistakes/:id` | student | :302 |
| 7 | `POST /student/flashcards` | student | :317 |
| 8 | `GET /student/flashcards` | student | :338 |
| 9 | `GET /student/tasks` | student | :354 |
| 10 | `POST /student/tasks` | student | :372 |
| 11 | `POST /student/print` | student | :408 |
| 12 | `GET /student/print/mine` | student | :428 |
| 13 | `GET /student/print/queue` | STAFF | :438 |
| 14 | `POST /student/print/:id/done` | STAFF | :453 |
| 15 | `GET /student/noticeboard` | student+STAFF | :469 |
| 16 | `POST /student/wellbeing` | student | :496 |
| 17 | `GET /student/wellbeing` | WELLBEING_READERS | :526 |
| 18 | `GET /student/session` | student | :544 |

All 12 frozen contracts exist. Extras: `/print/mine`, `/print/:id/done`, wellbeing GET,
`/session`, `DELETE /mistakes/:id`.

### 5.1 Student-facing doors in other plugins

| Feature | Door | Roles | File:line | Student UI? |
|---|---|---|---|---|
| Homework submit | `POST /plugins/teacher.classroom/homework/:id/submit` | student | `teacher.classroom/index.js:169` | **None** |
| Safety box | `POST /safety/box` | student | `teacher.support/index.js:274` | **None** |
| Doubt/Ask | `POST /plugins/teacher.support/doubt` | student | `teacher.support/index.js:429` | **None** |
| Own fees | `GET /student/fees` | student | `routes.js:1188` | `StudentFees.tsx` (DARK) |
| Library | catalog/reservations/loans/fines | student | `library/index.js` | DARK |

---

## 6 · Data travel

### F1 · Student home
```
GET /student/home
  ├─ ownStudent: name-match, refuses ambiguity (exactly one active match)
  ├─ next_class: today's timetable grid (app.timetable_slots) + current IST period
  ├─ today: classes_count, assignments_due, upcoming_test
  ├─ needs_attention: overdue homework, results-board hint
  ├─ progress: last two published pcts per exam → direction
  ├─ bag_tomorrow: subjects from tomorrow's grid
  └─ session: idle_minutes + logout_url
```

### F2 · Homework (digital/paper)
```
GET /student/homework
  ├─ probe teacher.homework; read by class_grade
  ├─ isDigital only when mode explicitly includes 'digital'
  └─ paper (default): "complete in notebook — teacher marks receipt"
[NO STUDENT SUBMIT UI] POST .../submit exists in teacher.classroom
```

### F3 · Self-study plane
```
POST/GET /student/mistakes (+DELETE)  → student.mistake_note (owner-scoped RLS)
POST/GET /student/flashcards          → student.flashcard
GET/POST /student/tasks               → student.study_task + tasks_view (homework-derived)
```

### F4 · Print (school-controlled)
```
POST /student/print {kind, payload} ──▶ student.print_job (queued)
   ├─ emit student.print.v1
   └─ audit
STAFF GET /student/print/queue ──▶ queued jobs with student name/class
STAFF POST /student/print/:id/done ──▶ printed
GET /student/noticeboard ──▶ print-ready weekly summary
```
**Payload is stored but never rendered** — the office queue shows only student/kind/time/status
(`PrintQueue.tsx:211-257`); `StudentHome2.tsx:336` sends `{}` for noticeboard.

### F5 · Wellbeing
```
POST /student/wellbeing ──▶ student.wellbeing_request (named default; anonymous = no identity)
   ├─ emit student.wellbeing.v1
   └─ audit (actor 'anonymous (student)' when anonymous)
GET /student/wellbeing ──▶ counselor/principal plane
```
The plan says "routed to counselor via teacher.support concern flow" (`STUDENTOS-PLAN.md:30`); the
built path emits `student.wellbeing.v1` and **no `teacher.support` subscriber exists**
(`teacher.support/manifest.js:20` `subscribe:[]`). The claim is false as written.

### F6 · Results
```
GET /student/results ──▶ plugin_exams.report (published) + explain lines
```

---

## 7 · Session isolation

The plan claims (`STUDENTOS-PLAN.md:17`): `Cache-Control: no-store` + `Clear-Site-Data` on logout +
short idle timeout (`STUDENT_IDLE_TIMEOUT` default 10min), pinned by test.

| Claim | Reality | Evidence |
|---|---|---|
| `no-store` on `/student/*` | ✅ enforced | `index.js:68-76`; global fallback `app.js:816` |
| `Clear-Site-Data` on logout | ✅ enforced (global, not student-scoped) | `app.js:840-841` |
| Short idle timeout | ⚠️ **not server-enforced**; absolute 30m JWT TTL only (`config.js:37`, `app.js:402`); "idle" is client-side (`SessionSafety.tsx:46-59`) | |
| Config name `STUDENT_IDLE_TIMEOUT` | ❌ actual `STUDENT_IDLE_TIMEOUT_MINUTES` (`index.js:547`) | |
| Idle value reaches UI | ❌ server sends `idle_minutes` (`index.js:548`); client reads `raw.idle_timeout_minutes` (`studentApi.ts:355-357`) → always falls back to 10 | |
| Pinned by test | partial: headers pinned (`student-world.test.js:68`); TTL/idle/logout not | |

---

## 8 · UI surface map

Routed (`App.tsx:505-520`).

| Screen | Route | Doors | Verdict |
|---|---|---|---|
| `StudentHome.tsx` | `/student` | none | honest stub; DARK |
| `student/StudentHome2.tsx` | `/student/home2` | home/session/print/tasks | live; defects below |
| `StudentFees.tsx` | `/student/fees` | `GET /student/fees` | live; DARK (no nav/tabbar) |
| `StudentLearning.tsx` | `/student/learning` | none | fixture-only; only Progress tab labelled sample |
| `StudentPortfolio.tsx` | `/student/portfolio` | none | fixture-only, labelled |
| `student/PrintQueue.tsx` | `/print-queue` | print queue/done | live staff |
| `student/WellbeingQueue.tsx` | `/wellbeing-queue` | wellbeing GET | live staff |
| `student/Noticeboard.tsx` | `/noticeboard` | noticeboard | live staff |

**Planned lane dirs `student/learn/**`, `student/staff/**` do not exist.**

**Honesty defects:**
- `StudentLearning.tsx` fixture `SKILLS/ASSIGNMENTS/QUESTIONS/PROGRESS`; only Progress labelled.
- `StudentHome2.tsx:13` claims a `POST /student/tasks/:id/toggle` door that does not exist.
- `StudentHome2` attention ticks are local-only (`sessionStorage`) because the server emits no
  `kind`/`taskId` (`index.js:196-202`).
- `WellbeingQueue.tsx:5,14` claims routing via teacher.support; false.
- `WellbeingQueue.tsx` category labels don't cover live enum `academic_pressure`/`friendship`.

**DARK surfaces:** `/student/fees`, `/student`, `/library` have no tabbar/palette link; the student
sidebar nav case (`Shell.tsx:227-235`) is never rendered (light roles get no Sidebar).

---

## 9 · Test coverage (`student-world.test.js`, 11)

home own-only + roster scan; session headers; session contract shape; mistakes CRUD own-only;
flashcards; tasks; print flow; noticeboard; wellbeing; graceful degradation; role gates + lifecycle.

**Not pinned:** absolute TTL / idle expiry; logout Clear-Site-Data; `print_job` owner-scoping;
wellbeing routing to a consumer; print payload content; homework submit; every UI.

---

## 10 · Gap register

| ID | Sev | Gap | Evidence |
|---|---|---|---|
| STU-GAP-1 | P1 | No student Homework Center UI (digital+paper) | `studentApi.ts:192` 0 callers |
| STU-GAP-2 | P1 | No homework submit UI | `teacher.classroom/index.js:169`; no caller |
| STU-GAP-3 | P1 | No mistake notebook UI | `studentApi.ts:226-248` |
| STU-GAP-4 | P1 | No flashcards/study-mode UI | `studentApi.ts:251-273` |
| STU-GAP-5 | P1 | No study tasks/planner UI | `studentApi.ts:276-306` |
| STU-GAP-6 | P1 | No results view UI | `StudentHome2.tsx:66` "soon" |
| STU-GAP-7 | P1 | No student wellbeing filing UI | `index.js:496`; no caller |
| STU-GAP-8 | P1 | Print center metadata-only (payload never rendered) | `PrintQueue.tsx:211-257` |
| STU-GAP-9 | P1 | Idle timeout not server-enforced; client reads wrong field | §7 |
| STU-GAP-10 | P2 | `/student/fees` DARK | `Shell.tsx:231`; `DemoBar.tsx:22` |
| STU-GAP-11 | P2 | `print_job` lacks owner-scoped RLS | `036:123` |
| STU-GAP-12 | P2 | Student identity is name-match, no users↔students FK | `index.js:113-127` |
| STU-GAP-13 | P2 | AI Tutor / StudentAsk absent | plan acceptance #8 |
| STU-GAP-14 | P2 | Attendance/announcements/calendar/library not surfaced | §5.1 |
| STU-GAP-15 | P2 | Student noticeboard view absent (only print) | `index.js:469` |
| STU-GAP-16 | P2 | `student/learn/**`, `student/staff/**` absent | find |
| STU-GAP-17 | P3 | schema field drift | §4 STU-DAT-2 |
| STU-GAP-18 | P3 | `cancelled` status unreachable | `036:74` |
| STU-GAP-19 | P3 | stale door comment; `upcoming_test` count bug | `StudentHome2.tsx:13`; `studentApi.ts:107-111` |
| STU-GAP-20 | P3 | Wellbeing category labels mismatch live enum | `WellbeingQueue.tsx:51-61` |

---

## 11 · Cross-cutting

- **Capability map** (`effective-access.js:104-118`): `/print-queue`, `/noticeboard`,
  `/wellbeing-queue`, `/student`, `/student/home2`, `/student/learning`→homework,
  `/student/portfolio`→results, `/student/fees`.
- **Permission matrix:** all 18 doors role-gated, 0 unguarded; no own-rows classification (RLS
  posture rests on tests/DB grants).
- **Own-rows pins:** mistake/flashcard/task RLS-pinned and DB-tested; `print_job` not.
- **No-phone audit:** no push/notification path targets students; delivery is print/office.
- **Parity:** many doors with no UI caller (homework/results/mistakes/flashcards/tasks/wellbeing/
  submit/safety/doubt); one stale comment; `studentApi` wrapper/server shape mismatches latent.
