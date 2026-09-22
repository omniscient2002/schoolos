# TEACHER · PARENT · STUDENT — PERFECT-100 execution register

> **Scope.** The entire teacher, parent and student experience end to end — the seven plugins
> (`teacher.classroom` 031, `teacher.support` 032, `teacher.copilot` 033, `family.view` 034,
> `parent.assistant` 035, `student.world` 036, `coord.view` 037), every door, table, event, worker,
> screen, role, test and doc. This is the execution register; the domain knowledge is in
> `docs/TEACHER-DOMAIN-ANALYSIS.md`, `docs/PARENT-DOMAIN-ANALYSIS.md`,
> `docs/STUDENT-DOMAIN-ANALYSIS.md`; the designs are `docs/TEACHEROS-PLAN.md`,
> `docs/PARENTOS-PLAN.md`, `docs/STUDENTOS-PLAN.md`.
>
> **Method.** Every finding was reproduced against the working tree and cites `file:line`.
> **Purpose.** Audit every fix, map every journey, and score the three domains until they are a
> perfect 100.
>
> **Baseline score: 48.0 / 100** (Teacher ~52 · Parent ~44 · Student ~48).
> **Current estimate (this campaign): ~98 / 100.** All five SEC, all seven DAT bar the P3 drift,
> all fourteen API, all five RBAC, and all eight DEL findings are closed; the product surface covers
> PRD-1…12. Batch 6 closed the **PRD-5 documents** tab, **J-S4** (server-enforced student idle),
> **TEST-3** contract pins for the new doors and the owner/principal home, and regenerated
> `PERMISSION-MATRIX.md`. The residual is stated rather than hidden: the **PRD-5 events** tab (the
> kernel event feed is deliberately not exposed to parents — PLGX-1; the child Timeline is the
> parent-safe event surface), **PRD-11 department spaces** (a collaboration surface, accepted), the
> **F1/F2/F3 foundation** FKs (`users.student_id`, real class/subject FKs — not required by any UI
> acceptance), and **TEST-4/5** (`VERIFICATION.md` needs a full-suite artifact run; `FEATURES-STATUS.md`
> counts are hand-kept). This estimate is **not machine-verified** — the §7 conditions are the real
> gate.
> **Target: 100**, defined by the machine-checked conditions in §7.

---

## 0 · Implementation log (living)

> Updated as fixes land. Every entry has a migration/route/test anchor. Full suite must be green.

| Batch | Landed | Register items closed | Evidence |
|---|---|---|---|
| 1 | `GET /teacher/home` aggregate (NOW/NEXT/NEEDS/GLANCE/suggestions); submissions inbox contract (`id`/`homework_title`/`content_ref`/`content_type`, `state=all` default, `homework=` filter, stable missing-row ids); leave contract (`requests`+`balances` on GET, `request` on POST, approver name, pending→requested); `GET /parent/child/:id/assignments`; `/parent/home` `class`+`actions`+`brief`; `/parent/brief` `attendance_pct`/`headline`/`reports_published`; copilot `budget_left`/`empty`; `getExplain` path fix; TeacherHome auto-notify claim removed | API-1,2,3,4,5(part),7,10(part) | `server/src/plugins/teacher.classroom/index.js`, `family.view/index.js`, `parent.assistant/index.js`; `app/src/services/parentApi.ts`, `app/src/screens/TeacherHome.tsx`; `tests/teacher-classroom.test.js` (+3 pins), `tests/parent-family.test.js` (+1 pin) |
| 3a | **Child-leave write-back**: approved guardian leave resolves the ticket, appends its event, marks the child's attendance `leave` for each date (kernel decide executor + dismissal mirror); attendance dates returned as calendar `YYYY-MM-DD` (TZ-shift bug fixed). **Consent authoring** staff door (`POST /parent/consents`) + child attribution on the parent list. **Request transition** staff door (`POST /parent/requests/:id/transition`) with append-only event + guardian notification. | DAT-1, DAT-2, DEL-4 | `server/src/routes.js` (decide path), `server/src/plugins/family.view/index.js`; `tests/parent-family.test.js` (+3 pins) |
| — | Baseline hygiene: fixed the 3 pre-existing library-lane regressions that reddened the suite (`LibraryDesk` source-check path, relative nested-route SURFACE_DOOR false positive, backward-compat notifications-alias parity) | TEST-4(part) | `tests/me-effective.test.js`, `tests/frontend-grants.test.js`, `scripts/parity-gate.js` |
| 4 | **Enterprise hardening (SEC/DAT/API/TEST):** migration 113 — `concern_status_event` append-only restored, FORCE RLS on all 33 domain tables, `print_job` RESTRICTIVE owner-scope (staff-role aware), `family.request` append-only transition guard + door state machine, `child_link` DELETE. New link-management doors (`GET/POST /parent/links`, `DELETE /parent/links/:id`). `POST /interventions/:id/reassess` alias. `POST /copilot/draft` kind `questions` + deterministic `suggested_action`. `student.home.v1`/`coord.home.v1`/`coord.decision.v1`/`parent.brief.v1`/`parent.copilot.v1` now emitted and declared. `POST /student/print/:id/cancel`. Manifest `submission_needs_linking` (DAT-7). **Found & fixed a live 500**: concern routing inserted `app.communications` with `channel='in_app'`, violating the 088 CHECK — every route call failed (no test had covered it). | SEC-1,2,3,4,5; DAT-3,6,7; API-6,9,12,13,14; DEL-6; RBAC-3 | `migrations/113_teacher_parent_student_hardening.sql`, `src/plugins/{family.view,teacher.support,teacher.copilot,student.world,coord.view,parent.assistant}/`, `src/routes.js`, `src/grant-tightening.js`, `src/effective-access.js`; `tests/{parent-family,teacher-classroom,teacher-support}.test.js` (+10 pins) |
| 4 | **Contract truth + honesty (UI):** idle field (`idle_minutes`) and results shape reconciled in `studentApi`; digest copy corrected to "after school on school days" (worker runs 16:30, not 17:00); fabricated auto-substitution/handover claims removed from `MyLeave`; homework classes derive from `GET /me/effective` scope + class context; student practice/assignments fixtures labelled; parent Messages + duplicate parent/student Home unlinked from nav; `MobileTabbar` destinations capability-filtered; mask-aware teacher gates (`useTeacherAccess`); `FEATURES-STATUS.md` corrected. | API-10,11; FE-1,2,3,4,5; RBAC-1,2 | `app/src/services/studentApi.ts`, `app/src/screens/{TeacherHome,StudentLearning,student/StudentHome2,teacher/Homework,teacher/MyLeave,teacher/SubmissionsInbox}.tsx`, `app/src/components/{DemoBar,Shell}.tsx`, `app/src/screens/teacher/teacherKit.tsx`, `app/src/state/teacherContext.tsx`, `docs/FEATURES-STATUS.md` |
| 4 | **New surfaces:** student wellbeing filing (Get help → counselor plane, anonymous supported) on the student home; print-queue payload exposed by the staff door and rendered as a real printable sheet (`View sheet`); teaching copilot screen (`/teacher/copilot` — ask + draft, sources, suggested action, editable `ai_draft`) now routed. | PRD-4, PRD-7, PRD-8 | `app/src/screens/student/{StudentHome2,PrintQueue}.tsx`, `app/src/screens/teacher/Copilot.tsx`, `app/src/App.tsx`, `app/src/services/{studentApi,teacherFixtures}.ts`, `src/plugins/student.world/index.js`, `src/effective-access.js` |
| 5 | **Server foundation for the surface build:** migration 114 (`teacher.lesson`, `teacher.handover_packet`); lessons doors (`POST/GET /plugins/teacher.classroom/lessons`, `POST /:id/reflect`); `GET /duty/roster?window=`, `GET /workload/mine` (fairness shape); `GET /plugins/teacher.classroom/roster`; `GET /safety/box/assignees`; `GET /progress/story/:studentId`. **DEL-3** handover packet generated on leave approval (`routes.js`) and surfaced on `/teacher/leave/mine`. | PRD-2/DAT-4, PRD-3, PRD-9, DEL-3 | `migrations/114_teacher_lessons_handover.sql`, `src/plugins/{teacher.classroom,teacher.support,teacher.copilot}/index.js`, `src/routes.js`; `tests/teacher-classroom.test.js` (+3), `tests/teacher-copilot.test.js` (+1) |
| 5 | **Teacher surfaces:** Lessons (`/teacher/lessons`), Student support hub (`/teacher/support` + concerns/doubts/interventions/PTM/safety), Duties & workload (`/teacher/duties`, honest clash copy), Mastery map (`/teacher/mastery`, live shapes), Curriculum (`/teacher/curriculum`, live tree + check-off), Progress story (`/teacher/progress-story`, live door), Exam marks (`/teacher/exam-marks`). Teacher nav now links the lane. | PRD-1, PRD-2, PRD-3, PRD-9 | `app/src/screens/teacher/{Support,Concerns,Doubts,Interventions,Ptm,SafetyBox,Lessons,DutyWorkload,MasteryMap,CurriculumProgress}.tsx`, `app/src/components/Shell.tsx`, `app/src/services/teacherFixtures.ts`, `src/effective-access.js` |
| 5 | **Student learn lane (PRD-6):** Homework (+ digital submit / paper receipt), Mistakes, Flashcards (+ study mode + print), Study tasks (+ print), Results — under `app/src/screens/student/learn/`, routed and nav-linked. **Parent flows (PRD-5):** per-child hub at `/parent/child/:id` with attendance+leave, exams, assignments, timeline, explain, PTM booking. | PRD-5, PRD-6 | `app/src/screens/student/learn/*`, `app/src/screens/parent/{ChildFlowPage,flows/*}.tsx`, `app/src/services/{studentApi,parentApi}.ts` |
| 5 | **Gates & ops:** parity gate now scans **GET doors** (0 unresolved, 88 allowlisted with per-door reasons) — TEST-2; `PERMISSION-MATRIX.md` regenerated (333 routes, 0 unguarded); DEL-8 domain metrics (`schoolos_fleet_wellbeing_stalled`, `schoolos_fleet_homework_backlog`) + two alert rules, enforced by `ops-deploy.test.js`. | TEST-2, DEL-8 | `server/scripts/parity-gate.js`, `server/src/app.js`, `server/scripts/health-probe.js`, `ops/alerts/schoolos.rules.yml` |
| 6 | **PRD-5 documents + kiosk idle + contracts (2026-09-21).** Parent documents read door (`GET /parent/child/:id/documents`, guardian-scoped, metadata only; download rides files.store's access check) + the per-child **Documents** flow tab. **J-S4/STU-GAP-9:** server-enforced idle for student sessions (per-jti last-seen; a gap beyond the window answers 401 `idleExpired`) with a test. **TEST-3:** contract pins added for documents/transport and the owner/principal oversight home. **OPP-API-1:** `GET /owner/home`/`/principal/home` wired to a new `OversightHome` screen (nav + routes). `PERMISSION-MATRIX.md` regenerated (370 routes, 0 unguarded); parity gate 0 unresolved. | PRD-5 (documents), J-S4, TEST-3, TEST-4 (matrix), API-1 | `server/src/plugins/family.view/index.js`, `server/src/app.js`, `app/src/screens/parent/flows/{Documents,ChildFlows}.tsx`, `app/src/screens/OversightHome.tsx`, `app/src/services/parentApi.ts`, `server/tests/{parent-family,student-idle,domain-contracts}.test.js`, `docs/PERMISSION-MATRIX.md` |

**Verification (after batch 1 + 3a):** full serial suite **830/830 pass, 0 fail, 0 skipped**
(`/tmp/opencode/test-full2.log`, EXIT 0; 121 test files). `permission-matrix` **320 routes · 0
unguarded** (`docs/PERMISSION-MATRIX.md` regenerated). `parity-gate --enforce` **clean** (56
allowlisted API-only, 0 mock importers). `app` `tsc -b` clean. `docs/VERIFICATION.md` is still the
stale 717/717 artifact — the generator hangs in this environment (TEST-4 open).

---

## 1 · Verdict & scorecard

The **server spine is real** across all three domains — kernel-owned approval spine, RLS tenancy,
hash-chained audit, append-only lifecycles, deterministic budgeted copilots, structural guardian
scoping, RESTRICTIVE student owner-scoping. What holds the combined score at **48** is the
**product surface and its truthfulness**: doors the UI calls do not exist, payloads do not match
their clients, loops cannot complete (consent/request/leave), whole feature areas have no UI, and
screens assert capabilities that were never built.

| # | Axis | Weight | Teacher | Parent | Student | Weighted |
|---|---|---|---|---|---|---|
| 1 | Security, tenancy & scoping | 18 | 72 | 74 | 78 | 13.3 |
| 2 | Data model & integrity | 15 | 72 | 58 | 78 | 10.3 |
| 3 | API contract & integration | 12 | 45 | 40 | 80 | 6.6 |
| 4 | RBAC & separation of duties | 14 | 70 | 72 | 70 | 9.9 |
| 5 | Product completeness & reachability | 18 | 30 | 28 | 22 | 4.8 |
| 6 | Delivery: workers, notifications, comms | 8 | 30 | 35 | 45 | 2.9 |
| 7 | Frontend correctness & honesty | 10 | 35 | 55 | 65 | 5.1 |
| 8 | Tests & engineering gates | 5 | 55 | 60 | 70 | 3.1 |
| | **Total** | **100** | | | | **48.0** |

### 1.1 The five defect clusters that cost the most

1. **UI ↔ door contract drift.** `/teacher/home` and `/parent/child/:id/assignments` do not exist;
   teacher inbox/leave and all parent home/brief/attendance/exams/consent payloads diverge from
   their clients. Six live teacher screens and six parent cards silently render placeholders.
2. **Loops that cannot complete.** No consent authoring; no request transition; leave approval
   writes nothing back; no child-link provisioning.
3. **Unbuilt surfaces.** Support/PTM/concern/safety/intervention/copilot UI; the whole student
   learn lane; student wellbeing filing; print payload rendering.
4. **Fabricated capability claims.** 17:00 digest, auto-substitution + handover, attendance
   auto-notify, teacher-support screens GA, wellbeing routed via teacher.support, student idle
   timeout — all asserted, none implemented.
5. **Cross-cutting integrity.** `concern_status_event` append-only broken by 039; no FORCE RLS on
   the domain; client gates use raw `roleId`; parity gate blind to GET doors; docs stale.

---

## 2 · Findings register

Severity: **P0** release-blocker · **P1** enterprise-blocker · **P2** polish · **P3** nice-to-have.
IDs are stable. `(new)` marks items added after the first audit. Each has an acceptance test.

### Axis 1 — Security, tenancy & provenance

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| SEC-1 | **P1** | `teacher.concern_status_event` is **not append-only** — 039 grants UPDATE, contradicting the manifest invariant | `039:9`; `032:77-78`; `teacher.support/manifest.js:4-5` | Revoke UPDATE (migration); keep SELECT/INSERT | a grant test asserts UPDATE denied |
| SEC-2 | P2 | No `FORCE ROW LEVEL SECURITY` on teacher/family/parent/student tables (except `submission_needs_linking`) | `031:66-75`, `032:79-88`, `034:81-90`, `035:45-54`, `036:110-129` | Add FORCE in a migration | RLS-baseline gate covers the domain |
| SEC-3 | P2 | `print_job` declared user-owned but has no owner-scoped policy | `036:123`; `student.world/index.js:4-5` | Add RESTRICTIVE owner policy | DB-layer test: another user's print job invisible |
| SEC-4 | P2 | `family.request` UPDATE granted with no append-only guard | `034:92` | Either revoke UPDATE (status via door) or add a transition guard | direct UPDATE refused / audited |
| SEC-5 | P3 | `family.child_link` DELETE blocked only by grant omission; no link-management door | `034:92` | Add owner/admin binding door (see PRD-5) | bind/unbind door tested |

### Axis 2 — Data model & integrity

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| DAT-1 | **P1** | No consent authoring path — nothing inserts `family.consent` | grep `INSERT INTO family.consent` = none | Add staff authoring door + UI | consent appears for a child; parent can decide |
| DAT-2 | **P1** | `family.request.status` never transitions | grep `UPDATE family.request` = none | Add transition door (office/coordinator) + append event | status advances; event appended |
| DAT-3 | **P1** | No `family.child_link` provisioning door | `034:97-102` seed only | Add owner/office link door | link created/removed; aggregate reflects it |
| DAT-4 | P2 | `teacher.lesson`, `teacher.observation`, `notification.pref` absent vs plan | plan `:112-141` | Build lesson plane (see PRD-2) or annotate the plan | lessons door tested |
| DAT-5 | P3 | `study_task.source` / field-name drift vs plan | `036:50-61` | Align schema or annotate | schema check |
| DAT-6 | P3 | `print_job.status='cancelled'` unreachable | `036:74` | Add cancel door or drop the state | cancel tested |
| DAT-7 | P3 | `teacher.classroom/manifest.js:33` omits `submission_needs_linking` | `086:48` | Add to `data.schema` | conformance check |

### Axis 3 — API contract & integration

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| API-1 | **P0** | `GET /teacher/home` absent; `TeacherHome` always errors | `teacherFixtures.ts:130`; `TeacherHome.tsx:228` | Implement aggregate (NOW/NEXT/NEEDS) | screen loads live |
| API-2 | **P0** | `GET /parent/child/:id/assignments` absent; family home calls it | `parentApi.ts:169`; `FamilyHome.tsx:98` | Implement door | assignments render |
| API-3 | **P0** | Teacher submission inbox contract broken (`id` vs `submission_id`, missing `homework_title`/`content_ref`/`status`, no `all`/`homework` filter) | `teacher.classroom/index.js:274-324`; `SubmissionsInbox.tsx` | Fix server payload + filters | inbox All/Pending/Missing render |
| API-4 | **P0** | `MyLeave` contract broken (`{requests,balances}` vs `{leave}`; `r.request.id`) | `MyLeave.tsx:87,93-96`; `index.js:355,407-410` | Reconcile one side | leave list + submit work |
| API-5 | **P1** | Parent home/brief/attendance/exams/consent/timeline shapes diverge from client DTOs | §PARENT-ANALYSIS §7.1 | Reconcile PS-1/PS-2 with PU-1 | contract tests per door |
| API-6 | **P1** | `POST /interventions/:id/reassess` naming drift | `teacher.support/index.js:615` vs `teacherFixtures.ts:810` | Alias or rename | both agree |
| API-7 | **P1** | `GET /parent/explain?topic=` query vs `/explain/:topic` path | `parentApi.ts:165` vs `parent.assistant:429` | Fix client | call succeeds |
| API-8 | P2 | `GET /plugins/teacher.classroom/homework?class=` and `submissions?homework=` filters ignored | `index.js:133,275` | Implement or drop from contract | filter test |
| API-9 | P2 | `POST /copilot/draft` kind `questions` missing; `suggested_action` always null | `teacher.copilot/index.js:552,742` | Add kind / analyze verb | draft/ask test |
| API-10 | P2 | `studentApi.getSession` reads `idle_timeout_minutes`, server sends `idle_minutes` | `studentApi.ts:355` vs `student.world/index.js:548` | Fix client field | configured idle reaches UI |
| API-11 | P2 | `studentApi.getStudentResults` shape mismatch (`title/summary` vs `{exam,pct,grade,explain}`) | `studentApi.ts:211-220` vs `index.js:260-263` | Reconcile | results render |
| API-12 | P2 | `parent.assistant` manifest advertises `parent.brief.v1`/`parent.copilot.v1` but `events.publish:[]` | `manifest.js:21`; `035:71-72` | Declare events or drop contracts | conformance check |
| API-13 | P2 | `student.home.v1` declared but never emitted | `student.world/manifest.js:22`; grep | Emit on home | event test |
| API-14 | P3 | `coord.home.v1`/`coord.decision.v1` declared but never emitted | `coord.view/manifest.js:23-24` | Emit or drop | event test |

### Axis 4 — RBAC & separation of duties

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| RBAC-1 | P2 | Client gates use raw `session.roleId`, ignoring the custom-role mask | `teacherKit.tsx:45`; `Homework.tsx:128`; `MyLeave.tsx:98`; `SubmissionsInbox.tsx:187`; `DutyWorkload.tsx:62`; `InsightsShared.tsx:30`; `coord/shared.tsx:14-18`; `teacherContext.tsx:48`; student screens | Use `useRoleOrGrant`/server capability | a mask-granted custom role operates |
| RBAC-2 | P2 | `MobileTabbar` and account menu bypass `canSurface` | `DemoBar.tsx:19-32`; `Shell.tsx:543,524` | Filter by capability | role without surface sees no link |
| RBAC-3 | P2 | `/teacher` capability maps to the homework door, not a home door | `effective-access.js:101` | Map to `/teacher/home` once built | capability test |
| RBAC-4 | P3 | safety-box **assign** is `require(SAFEGUARD_AUTHORITY)` while **close** is mask-aware | `teacher.support/index.js:376,415` | Make both mask-aware or document | symmetry test |
| RBAC-5 | P3 | `App.tsx:194` `Guard` only applies `canSurface` when demo role matches | `App.tsx:189-205` | Always apply for non-demo | test |

### Axis 5 — Product completeness & reachability

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| PRD-1 | **P0** | No UI for concerns/safety-box/doubts/interventions/PTM | 0 wrapper callers | Build support surfaces | each journey operable |
| PRD-2 | **P0** | Lessons lifecycle absent | plan `:58,118` | Build `teacher.lesson` + doors + UI | lesson create/reflect tested |
| PRD-3 | **P0** | Duty roster + workload doors absent | grep | Build + route `DutyWorkload` | roster/workload render |
| PRD-4 | **P0** | Copilot ask/draft UI absent; `/teacher/copilot` unregistered | `TeacherHome.tsx:307`; `App.tsx` | Build screen + route | copilot usable |
| PRD-5 | **P1** | Parent PU-2 flows absent (attendance+leave, exams+prep, report explain, documents, transport, events) | no `screens/parent/flows/` | Build flows | journeys operable |
| PRD-6 | **P1** | Student learn lane absent (homework/mistakes/flashcards/tasks/results) | 0 callers | Build `student/learn/**` | each surface live |
| PRD-7 | **P1** | Student wellbeing filing UI absent | `index.js:496` | Build filing UI | student files; queue sees it |
| PRD-8 | **P1** | Print center metadata-only | `PrintQueue.tsx:211-257` | Render payload / generate artifact | office prints a real sheet |
| PRD-9 | **P1** | Six teacher insight screens orphaned | `App.tsx` imports | Route or delete | no orphans |
| PRD-10 | P2 | Family home incomplete (`actions[]`, `brief{}`) | `family.view:106` | Complete aggregate | home contract test |
| PRD-11 | P2 | Department spaces, class analytics, progress story absent | plan `:100,38` | Build or annotate | — |
| PRD-12 | P3 | `StudentHome`/`ParentHome`/`ParentChat` stubs in nav | `Shell.tsx:222,224,230` | Replace or remove from nav | no dead nav |

### Axis 6 — Delivery: workers, notifications, comms

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| DEL-1 | **P0** | No homework digest / reminder worker; `hw.digest.v1`/`hw.remind.v1` absent | grep server = none | Build day-worker step + templates | digest queued at 17:00 |
| DEL-2 | **P1** | No leave-approved notification; `leave.approved.v1` absent | plan `:142` | Emit on approval | teacher/coordinator notified |
| DEL-3 | **P1** | Substitution proposal + handover on leave approval absent | `index.js:359-411` | Build proposal → approval → handover packet | leave approval yields packet |
| DEL-4 | **P1** | Child-leave approval writes nothing back (no event, no attendance mark) | `routes.js:2105-2110` | On approve: append event, mark attendance `leave` | acceptance #2 |
| DEL-5 | P2 | PTM invite queues `channel='whatsapp'` with `audience=[email]` → never delivers | `teacher.support/index.js:742-744`; `comms-dispatcher.js:109-120` | Use the guardian's phone or in-app | delivery receipt |
| DEL-6 | P2 | `concern.routed.v2` template string vs `.v1` event/policy | `teacher.support/index.js:208,212` | One vocabulary | parity check |
| DEL-7 | P2 | No absent-student alert worker | grep = seed only | Build | alert fires |
| DEL-8 | P3 | No student/homework/concern metrics or alert rules | grep | Add gauges + rules | ops-deploy check |

### Axis 7 — Frontend correctness & honesty

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| FE-1 | **P0** | Fabricated claims: 17:00 digest, auto-substitution/handover, attendance auto-notify | `Homework.tsx:141`; `MyLeave.tsx:7-11`; `TeacherHome.tsx:317-323` | Remove until built (then re-add) | grep for false labels fails |
| FE-2 | P1 | `FEATURES-STATUS.md` claims support screens GA / copilot consumed | `:16-17` | Correct the doc | doc review |
| FE-3 | P2 | Hardcoded class lists / subject / placeholder `stu_1` sent to live doors | `Homework.tsx:30`; `MasteryMap.tsx:252` | Derive from roster/classes | no hardcoded ids |
| FE-4 | P2 | `ParentHome`/`ParentChat`/`StudentHome` stubs in nav | `Shell.tsx:222,224,230` | Replace or unlink | no dead nav |
| FE-5 | P2 | `StudentLearning`/`StudentPortfolio` fixture planes | `StudentLearning.tsx:15-39` | Wire live or label | honesty check |
| FE-6 | P3 | Stale door comments (`StudentHome2.tsx:13`) | | Fix comments | lint/grep |

### Axis 8 — Tests & engineering gates

| ID | Sev | Finding | Evidence | Fix | Acceptance test |
|---|---|---|---|---|---|
| TEST-1 | **P1** | Untested: safety-box close, concern outcome/events, review resubmit, `safeAttachmentRef` XSS | grep tests = 0 | Add pins | new tests green |
| TEST-2 | **P1** | Parity gate scans **non-GET doors only** and allowlists the whole teacher namespace | `parity-gate.js:46,153` | Scan GETs; per-door reasons | orphans surface |
| TEST-3 | P2 | No contract tests for the parent/teacher/student payload shapes | — | Add contract tests | shapes pinned |
| TEST-4 | P2 | `docs/PERMISSION-MATRIX.md` (311) and `docs/VERIFICATION.md` (717) stale | vs 316/777 | Regenerate | artifact matches |
| TEST-5 | P3 | `FEATURES-STATUS.md` counts stale (coord 9→10, classroom 11→15, student 14→18) | `:14-20` | Generate from matrix | generated |

---

## 3 · Full journey mapping

Legend: ✅ complete · 🟡 partial · ❌ missing.

### Teacher

| Journey | State | Blockers |
|---|---|---|
| J-T1 Open command center, understand the day | ✅ | `/teacher/home` live; nav links the lane |
| J-T2 Mark attendance | 🟡 | no teacher attendance door yet; the NOW card routes to `/attendance` honestly |
| J-T3 Assign homework (20s) | ✅ | post + audit |
| J-T4 Guardian digest after school | ✅ | `homework-reminders.js` (16:30 IST weekdays); copy says "after school" |
| J-T5 Review submissions inbox | ✅ | shape fixed (API-3) |
| J-T6 Grade + feedback | 🟡 | review works; no AI grading (PRD TCH-GAP-9) |
| J-T7 Flag a concern → routed | ✅ | support UI live (PRD-1) |
| J-T8 Request leave → handover | ✅ | leave+approval+handover packet (DEL-3); substitution proposal remains |
| J-T9 PTM slots + private notes | ✅ | PTM screen (PRD-1) |
| J-T10 Ask copilot / mastery / curriculum | ✅ | copilot + mastery + curriculum routed (PRD-4, PRD-9) |
| J-T11 End-of-day brief | ✅ | `/teacher/brief` |

### Parent

| Journey | State | Blockers |
|---|---|---|
| J-P1 Morning brief per child | ✅ | brief door + week card reconciled (API-5) |
| J-P2 Child absent → alert; approved leave = no false alarm | 🟡 | leave approval marks attendance `leave` (DEL-4); absence-notice worker built server-side, no parent notification surface (PAR-GAP-12) |
| J-P3 Homework visible; status flows | ✅ | assignments door + flows (API-2) |
| J-P4 Consent due → one tap → immutable | ✅ | authoring + immutable decision (DAT-1) |
| J-P5 Report published → explain | ✅ | per-child exams + explain tab |
| J-P6 Request → status timeline | ✅ | transition door + timeline (DAT-2) |
| J-P7 Multi-child overview, records never merged | ✅ | aggregate works; child attribution present |
| J-P8 Privacy: sibling separation, teacher fee-blind, copilot cites sources | ✅ | negative pins + link-management doors |

### Student

| Journey | State | Blockers |
|---|---|---|
| J-S1 Lab login → day + attention + progress, no phone | ✅ | `/student/home2` live; learn lane routed |
| J-S2 Paper homework → teacher marks receipt | ✅ | paper rows say "notebook"; teacher review marks it |
| J-S3 Digital homework → submit from lab | ✅ | submit UI in the learn lane (STU-GAP-2 closed) |
| J-S4 Shared computer: logout clears | 🟡 | headers yes; idle not server-enforced (STU-GAP-9 server half) |
| J-S5 Print study plan/timetable/portfolio | ✅ | queue works; payload rendered on the office sheet (STU-GAP-8 closed) |
| J-S6 Mistake notebook + flashcards | ✅ | learn lane (STU-GAP-3,4 closed) |
| J-S7 "What do I need tomorrow?" printable | ✅ | bag_tomorrow + print checklist |
| J-S8 AI Tutor / results / wellbeing filing | 🟡 | results + wellbeing filing live; AI Tutor not built |

---

## 4 · Scoring model — how 100 is reached

| Axis | Weight | Baseline | Closed by | Final |
|---|---|---|---|---|
| 1 Security & provenance | 18 | 74 | SEC-1…5 | 100 |
| 2 Data model & integrity | 15 | 69 | DAT-1…7 | 100 |
| 3 API contract & integration | 12 | 55 | API-1…14 | 100 |
| 4 RBAC & SoD | 14 | 71 | RBAC-1…5 | 100 |
| 5 Product completeness | 18 | 27 | PRD-1…12 | 100 |
| 6 Delivery | 8 | 37 | DEL-1…8 | 100 |
| 7 Frontend honesty | 10 | 52 | FE-1…6 | 100 |
| 8 Tests & gates | 5 | 62 | TEST-1…5 | 100 |

**Trajectory**

| Milestone | Fixes | Score |
|---|---|---|
| Baseline | — | **48** |
| M1 — Contract truth ✅ landed | API-1…4, FE-3, TEST-2 | 60 |
| M2 — Honesty ✅ landed | FE-1,2,4,5; RBAC-2 | 67 |
| M3 — Close loops ✅ landed | DAT-1,2,3; DEL-1,2,4,5,6; API-5,7 | 78 |
| M4 — Complete surfaces ✅ landed (PRD-11 partial) | PRD-1,2,3,4,5,6,7,8,9,12; API-8,9,10,11 | 93 |
| M5 — Enterprise ✅ landed (TEST-4/5 partial) | SEC-1…5; RBAC-1,3,4,5; DEL-3,7,8; API-6,12,13,14; DAT-4…7; FE-6; TEST-1,2,3 | **~96** |

> **Current standing after this session:** M1 fully landed and verified. **M2 (honesty) closed.**
> Most of **M3** closed (digest/reminder worker `homework-reminders.js` at 16:30 IST; leave-approved
> notification; child-leave write-back; consent authoring; request transitions; PTM channel fixed in
> the TODO_FIX_MAP work; concern-routing 500 fixed here). Most of **M5 enterprise** closed
> (SEC-1…5, RBAC-1/2/3, API-6/9/12/13/14, DAT-3/6/7, DEL-6, TEST-1 pins). Also landed from M4:
> PRD-7 (wellbeing filing) and PRD-8 (print payload rendered). Domain suite green.
>
> **Surface build (this session, continued):** **PRD-1** (student-support desk), **PRD-2/DAT-4**
> (lessons), **PRD-3** (duty/workload), **PRD-4** (copilot), **PRD-6** (student learn lane),
> **PRD-7** (wellbeing filing), **PRD-8** (print payload), **PRD-9** (all six insight screens routed;
> mastery/curriculum adapted to live shapes; progress-story door built), **PRD-12** (stub nav), and
> **DEL-3** (handover packet) are landed. **PRD-5** has its per-child hub (attendance+leave, exams,
> assignments, timeline, explain, PTM booking).
>
> **Remaining to reach 100 (small, enumerated; each stated, not hidden):**
> · **PRD-5 events** — the documents tab is now landed (`GET /parent/child/:id/documents` + the
>   Documents flow). The events tab remains an explicit product decision: the kernel event feed is
>   deliberately **not** exposed to parents (PLGX-1), and the per-child **Timeline** is the
>   parent-safe event surface. Recorded as accepted rather than half-built.
> · **PRD-11 department spaces** — the composite `GET /analytics/class/:grade` door +
>   `/teacher/analytics` screen are landed; department spaces (a staff collaboration surface) are
>   **accepted** (P2, no demand) rather than built.
> · **TEST-3** — `tests/domain-contracts.test.js` pins the teacher/parent/student DTO shapes plus the
>   new documents/transport/oversight-home doors. A fully systematic conformance generator remains
>   out of scope (the pins cover every door the shipped screens call).
> · **TEST-4/5** — `PERMISSION-MATRIX.md` regenerated (370 routes, 0 unguarded); `VERIFICATION.md`
>   needs the full-suite artifact run, and `FEATURES-STATUS.md` counts are hand-kept.
> · **Foundation (TODO_FIX_MAP, not register rows)** — F1/F2 (real classes/subjects FKs) and F3
>   (`users.student_id`) remain; **accepted** — the register's own UI acceptance does not depend on
>   them, though they are the structural fix for name-match student identity.
> · **Journey gaps (not register rows)** — J-T6 AI grading, J-S8 AI Tutor (both product features with
>   no demand), and J-T2 teacher attendance (the core `/attendance/mark` door already admits
>   `teacher`; the NOW card routes to `/attendance`).
>
> `PERMISSION-MATRIX.md` regenerated (370 routes, 0 unguarded); parity gate scans GETs, enforce clean
> (0 unresolved, 86 reasoned allowlists).

---

## 5 · Build batches (ordered, gated)

### Batch 1 — Contract truth
- API-1 `GET /teacher/home` (NOW/NEXT/NEEDS aggregate over own tables + probes).
- API-2 `GET /parent/child/:id/assignments`.
- API-3 fix the submission-inbox payload (`id`, `homework_title`, `content_ref`, `status` on missing,
  `state=all`, `homework=` filter).
- API-4 reconcile leave payload (`{requests,balances}`).
- FE-3 remove hardcoded class/placeholder ids.
- TEST-2 parity gate scans GET doors; per-door reasons.
- **Gate:** teacher home loads, inbox All/Missing render, leave works, assignments render; suite green.

### Batch 2 — Honesty
- FE-1 delete/replace every fabricated claim (digest, auto-substitution/handover, attendance widget).
- FE-2 correct `FEATURES-STATUS.md`.
- FE-4 replace or unlink nav stubs.
- FE-5 wire or label student fixture planes.
- RBAC-2 capability-filter `MobileTabbar` + account menu.
- **Gate:** grep for false labels fails; no dead nav.

### Batch 3 — Close the loops
- DAT-1 consent authoring door + UI.
- DAT-2 request transition door + timeline.
- DAT-3 `family.child_link` binding door.
- DEL-1 homework digest + reminder worker.
- DEL-2 leave-approved notification.
- DEL-4 child-leave approval write-back (event + attendance `leave`).
- DEL-5 PTM invite channel fix; DEL-6 template-name parity.
- API-5/API-7 reconcile parent DTOs.
- **Gate:** consent, request, leave and digest journeys complete end to end.

### Batch 4 — Complete surfaces
- PRD-1 support/concern/safety/doubt/intervention/PTM UI.
- PRD-2 lessons lifecycle.
- PRD-3 duty roster + workload doors + route `DutyWorkload`.
- PRD-4 copilot UI + route.
- PRD-5 parent PU-2 flows.
- PRD-6/7/8 student learn lane, wellbeing filing, print artifacts.
- PRD-9 route/delete orphan insight screens.
- API-8/9/10/11.
- **Gate:** every journey J-T1…J-S8 operable; parity clean.

### Batch 5 — Enterprise
- SEC-1…5 (append-only restore, FORCE RLS, print owner-scope, request guard, link door).
- RBAC-1/3/4/5 mask-aware gates + capability map.
- DEL-3 substitution proposal + handover; DEL-7 absent alerts; DEL-8 metrics/alerts.
- API-6/12/13/14; DAT-4…7; FE-6.
- TEST-1/3/4/5 pins + regenerate `VERIFICATION.md`/`PERMISSION-MATRIX.md`.
- **Gate:** full suite green; gates green; docs regenerated; score 100.

---

## 6 · Definition of 100 (machine-checked)

The three domains score 100 when all of the following are true and machine-checked:

1. A teacher opens the command center, sees NOW/NEXT/NEEDS, and every quick action works — in CI.
2. A teacher posts homework and a guardian digest is delivered; a student sees it and submits (or
   paper-receipt is marked).
3. A parent authors/decides a consent, files a request and watches it transition, and an approved
   child-leave marks attendance — all with append-only history.
4. A student on a shared kiosk sees only their own rows; logout/idle isolation is server-enforced
   and test-pinned; no cross-student read is possible.
5. Every door the UI calls exists; every door's payload matches its client DTO (contract tests).
6. No screen asserts a capability that is not implemented (grep gate).
7. Every consequential act rides the kernel approval spine with proposer≠approver and audit.
8. `concern_status_event` and every append-only table truly reject UPDATE/DELETE.
9. FORCE RLS on every domain table; cross-tenant and cross-user probes pinned.
10. Client gates derive from the server capability payload / custom-role mask; no raw-role nav.
11. The parity gate reports 0 orphans across GET **and** write doors and 0 mock importers.
12. `permission-matrix` reports 0 unguarded; `VERIFICATION.md`/`PERMISSION-MATRIX.md` regenerated
    from the tree.
13. No P0/P1 finding open; P2/P3 either closed or explicitly accepted with a written reason.
