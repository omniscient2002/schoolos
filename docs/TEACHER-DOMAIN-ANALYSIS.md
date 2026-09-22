# TEACHER DOMAIN — full-depth analysis

> **Scope.** The complete teacher experience as built on the current tree: the three TeacherOS
> plugins (`teacher.classroom` 031, `teacher.support` 032, `teacher.copilot` 033), the coordinator
> execution plane that consumes teacher facts (`coord.view` 037), every door, every table, every
> event, every UI surface, and every test. This is the domain-knowledge companion to
> `docs/TEACHEROS-PLAN.md` (the design) and `docs/TEACHER-PARENT-STUDENT-PERFECT-100.md` (the
> execution register). Every claim cites `file:line`.
>
> **Method.** Read every plugin `index.js`/`manifest.js`, migrations 031/032/033/037/039/086/087/102,
> the teacher/coord screens, `teacherFixtures.ts`, `App.tsx`, `Shell.tsx`, `DemoBar.tsx`,
> `effective-access.js`, and the four domain test files. Findings are reproduced against the
> working tree; nothing was edited.
>
> **Status (living).** Batch 1 closed **TCH-GAP-1** (`GET /teacher/home` now exists and the screen
> loads) and the submissions-inbox / leave contract drift. A hardening batch closed **TCH-DAT-1**
> (`concern_status_event` UPDATE revoked — append-only restored, SEC-1), **TCH-DAT-2** (FORCE RLS on
> every teacher-domain table, SEC-2), **TCH-GAP-12** (`POST /interventions/:id/reassess` alias),
> **TCH-GAP-8** (`POST /copilot/draft` kind `questions`; `suggested_action` now deterministic from
> the routed branch), **TCH-GAP-3** (homework digest/reminder worker `scripts/homework-reminders.js`,
> 16:30 IST weekdays), and **TCH-GAP-5**'s notification half (leave-approved notice, L5). It also
> fixed a live 500 on concern routing (invalid `in_app` comms channel). A surface batch then closed
> **TCH-GAP-2** (lessons lifecycle + `teacher.lesson`), **TCH-GAP-4** (duty roster + workload doors),
> **TCH-GAP-6** (student-support UI: concerns/doubts/interventions/PTM/safety), **TCH-GAP-7**
> (copilot ask/draft UI), **TCH-GAP-5** (handover packet on leave approval), **TCH-GAP-17/18**
> (class analytics + progress story doors/screens), and routed the insight screens. Remaining:
> TCH-GAP-9/10/11 (AI grading, question bank, curriculum import), TCH-GAP-13/16 (department spaces,
> notification prefs), TCH-GAP-14/15 (offline/voice infra waves). The register's §0 implementation
> log in `docs/TEACHER-PARENT-STUDENT-PERFECT-100.md` is the authoritative, up-to-date status; the
> gap table in §9 below is the original baseline snapshot.

---

## 0 · Verdict at a glance

The teacher **server spine is real**: 45 doors, RLS on every table, hash-chained audit on every
write, per-instance kernel approvals, deterministic copilots, A3 mastery decay, append-only
concern/intervention lifecycles. What holds the domain at **~52/100** is the **product surface**:
the command center cannot load, six screens are orphaned, the inbox/leave payloads do not match
their clients, whole feature areas (support/PTM/concern/intervention/copilot) have no UI at all,
and several screens assert capabilities (17:00 digest, auto-substitution, handover packet,
attendance auto-notify) that no code implements.

| Area | Score | One-line reason |
|---|---|---|
| Doors / frozen contract | 45 | 45 live doors; 4 frozen §4 contracts absent, 2 drifted |
| Data model / RLS | 72 | RLS everywhere; `concern_status_event` append-only broken by 039; no FORCE RLS |
| UI honesty | 35 | `/teacher/home` 404s; inbox/leave shape-broken; 6 orphan screens; fabricated claims |
| Test coverage | 55 | classroom/copilot/coord strong; safety-close, concern outcome/events, resubmit untested; zero UI tests |
| RBAC / cross-cutting | 70 | server mask correct; client gates use raw `roleId`; parity gate blind to GETs |
| **Overall** | **~52** | server spine real; product surface largely unreachable |

---

## 1 · Purpose & the five principles

North star (`docs/TEACHEROS-PLAN.md:3`): *the teacher opens SchoolOS → the day is already
understood → she teaches → the system handles routine coordination → she makes the decisions that
matter → the system records everything.*

1. **Teach first** — every feature removes work; common task ≤20s.
2. **Context everywhere** — every screen knows teacher/classes/subjects/timetable/students.
3. **AI recommends, teacher decides** — consequential acts ride the kernel approval spine
   (proposer≠approver, decide→execute, SoD 403).
4. **Governed by default** — RLS tenancy, least privilege, masked contacts, append-only corrections,
   immutable published records, full audit.
5. **Progressive complexity** — Tier 1 daily · Tier 2 weekly · Tier 3 periodic.

Four amendments (`TEACHEROS-PLAN.md:14-18`): **A1** curriculum is seeded never teacher-typed;
**A2** copilot runs on budget classes; **A3** mastery labels decay; **A4** offline/voice are
infrastructure waves (deferred).

---

## 2 · Roles & authority tiers

| Role | Teacher-domain reach |
|---|---|
| `teacher` | own homework + review desk; own leave; file/read own concerns; interventions; doubts routed to them; publish own PTM slots; private notes; copilot/brief/ask/draft/usage; curriculum check-off; mastery maps |
| `coordinator` | route concerns; decide coordinator-owned kernel actions (substitution); duty allocation; escalations; curriculum monitor; workload; coord copilot |
| `principal` | read the whole concern board; safety-box authority; may read coord doors; owns escalation/safety-page actions |
| `owner`/`itadmin` | safeguarding authority; plugin lifecycle/settings; oversight |
| `counselor` | concern oversight tier; safety-box reader; close concerns; wellbeing plane |
| `student` | submit homework; file doubt; file safety box; read own doubts |
| `parent` | PTM slot board (no other-family booking detail); book own child |

Role consts: `teacher.support/index.js:43-56` (STAFF / ROUTE_AUTHORITY / CONCERN_OVERSIGHT /
SAFEGUARD_AUTHORITY / BOX_READERS), `teacher.copilot/index.js:51-54` (STAFF / TEACHER_ONLY),
`coord.view/index.js:32` (AUTHORITY).

---

## 3 · Plugins & schemas

| Plugin | Migration | Manifest | Owns |
|---|---|---|---|
| `teacher.classroom` | `031_teacher_classroom.sql` | `teacher.classroom/manifest.js` | schema `teacher`: homework, submission, leave_request |
| `teacher.support` | `032_teacher_support_runtime.sql` | `teacher.support/manifest.js` | schemas `safety`, `support`, `intervention`, `ptm` + `teacher.concern*`, `teacher.note` |
| `teacher.copilot` | `033_teacheros_ai_runtime.sql` | `teacher.copilot/manifest.js` | schemas `curriculum`, `mastery`, `copilot` |
| `coord.view` | `037_coord_view.sql` | `coord.view/manifest.js` | schemas `coord`, `duty` |

All four are `class:'C'`, `trust:'T1'`, `defaultEnabled:false` (opt-in via
`app/plugins`, `plugin-catalog.js` `DEFAULT_ON` excludes them).

---

## 4 · Data model (tables, constraints, RLS, grants, append-only)

### 4.1 `teacher.classroom` (031)

| Table | Key columns | Constraints | RLS | Grants |
|---|---|---|---|---|
| `teacher.homework` | id, tenant_id, class_grade, subject, title, detail, attachment_ref, due_at, created_by, status, created_at | status ∈ open/closed | ENABLE only (`031:66-75`) | SELECT/INSERT/UPDATE (`031:77`) |
| `teacher.submission` | id, tenant_id, homework_id→homework CASCADE, student_id, content_type, content, status, grade, feedback, submitted_at, reviewed_by, reviewed_at | `content_type ∈ text/link`; `status ∈ submitted/late/reviewed/graded/resubmit_requested`; **UNIQUE(homework_id, student_id)** (`031:46`) | ENABLE only | SELECT/INSERT/UPDATE |
| `teacher.leave_request` | id, tenant_id, teacher_id, kind, from_date, to_date, reason, status, decided_by, decided_at, note, created_at | `kind ∈ sick/casual/earned/duty/comp_off/other`; `status ∈ pending/approved/rejected`; `to_date >= from_date` (`031:62`) | ENABLE only | SELECT/INSERT/UPDATE |

Post-031 changes: `086_teacher_submission_student_link.sql` re-keys `submission.student_id` to
`app.students(tenant_id, id)` (082 constrained it) and adds `teacher.submission_needs_linking`
(FORCE RLS in 102:23-24). `teacher.classroom/manifest.js:33` still omits
`submission_needs_linking` from `data.schema` (drift).

### 4.2 `teacher.support` (032)

| Table | Key columns | Constraints | Append-only | RLS |
|---|---|---|---|---|
| `teacher.concern` | id, tenant_id, student_id?, filed_by, category, urgency, detail, evidence_ref, status, routed_to, routed_role, routed_by, outcome, outcome_note, closed_at, created_at, updated_at | category ∈ 6; urgency ∈ 4; status ∈ open/routed/in_support/closed; routed_role ∈ counselor/principal; outcome ∈ 4 (`032:39-60`) | no (status pointer mutable) | ENABLE (`032:79-83`) |
| `teacher.concern_status_event` | id, tenant_id, concern_id→concern, from_status, to_status, note, actor_id, created_at | — | **intended** SELECT+INSERT only (`032:77-78`) — **BROKEN by `039:9` granting UPDATE** | ENABLE (`032:84-88`) |
| `safety.box` | id, tenant_id, reporter_anonymous, reporter_user_id, class_grade, category, detail, severity, status, assigned_to, assigned_by, page_action_id, closed_at, timestamps | category ∈ 9; severity ∈ 4; status ∈ submitted/assigned/closed; **CHECK `NOT reporter_anonymous OR reporter_user_id IS NULL`** (`032:113-114`) | no | ENABLE |
| `support.doubt` | id, tenant_id, asked_by, student_id?, subject, topic, question, status, routed_to, routed_reason, answered_by, answer, answered_at | status ∈ routed/answered/promoted | no | ENABLE |
| `support.faq` | id, tenant_id, subject, topic, question, answer, source_doubt_id→doubt, promoted_by | **UNIQUE(tenant_id, source_doubt_id)** (`032:160`) | no | ENABLE |
| `intervention.plan` | id, tenant_id, student_id, owner_id, objective, activity, target_end, status, outcome | status ∈ identified/planned/in_progress/reassessed/improved/continue/escalate | no | ENABLE |
| `intervention.plan_event` | id, tenant_id, plan_id→plan, from_status, to_status, note, actor_id | — | **yes** SELECT+INSERT (`032:206`) | ENABLE |
| `ptm.slot` | id, tenant_id, teacher_id, slot_date, start_time, end_time, status | **UNIQUE(teacher_id, slot_date, start_time)** (`032:230`); status ∈ open/booked/cancelled | no | ENABLE |
| `ptm.booking` | id, tenant_id, slot_id→slot, student_id, guardian_id | **UNIQUE(slot_id)** (`032:242`) | no | ENABLE |
| `teacher.note` | id, tenant_id, teacher_id, booking_id?, student_id?, note, created_at | — | SELECT+INSERT (`032:273`) | ENABLE with **user-pinned policy** `tenant_id AND teacher_id = schoolos.user_id` (`032:276-280`) |

**Finding P1 (TCH-DAT-1):** `039_teacher_concern_grants.sql:9` grants `UPDATE` on
`teacher.concern_status_event`, contradicting `032:77-78`, the manifest invariant
(`teacher.support/manifest.js:4-5`), and the plugin header (`index.js:6-8`). Concern history is
rewritable by the app role. No test pins the grant.

### 4.3 `teacher.copilot` (033)

| Table | Key columns | Constraints | RLS / grants |
|---|---|---|---|
| `curriculum.node` | id, tenant_id, subject, grade, parent_id→node, kind, name, order_no | kind ∈ unit/topic/objective; partial unique keys (`033:43-46`) | ENABLE; **SELECT only — A1 read-only** (`033:48`) |
| `curriculum.progress` | id, tenant_id, node_id→node, class_grade, covered_pct, covered_by, evidence_ref, covered_at | `covered_pct 0..100`; **UNIQUE(tenant_id, node_id, class_grade)** (`033:68`) | ENABLE; SELECT/INSERT/UPDATE |
| `mastery.evidence` | id, tenant_id, student_id, subject, node_id?, kind, ref, value, observed_at, expires_at, created_at | `value 0..100` | ENABLE; **SELECT/INSERT append-only** (`033:99`) |
| `mastery.state` | id, tenant_id, student_id, subject, node_id, level, confidence, derived_from jsonb, computed_at, timestamps | level ∈ needs_support/developing/secure; confidence ∈ low/medium/high; **UNIQUE(tenant_id, student_id, subject, node_id)** (`033:122`) | ENABLE; SELECT/INSERT/UPDATE |
| `copilot.call` | id, tenant_id, user_id, verb, budget_class, tokens_in, tokens_out, sources, approved_action_id, at | verb ∈ ask/draft/brief | ENABLE; **SELECT/INSERT append-only** (`033:151`) |

Seed: CBSE-aligned tree grades 6–8, Mathematics + Science, 3 units × 4 topics per subject-grade
(`033:161-236`). `SUBJECTS=['Mathematics','Science']` is hardcoded (`teacher.copilot/index.js:43`).

### 4.4 `coord.view` (037)

| Table | Key columns | Constraints | RLS / grants |
|---|---|---|---|
| `coord.copilot_call` | id, tenant_id, user_id, verb, budget_class, tokens, sources, at | verb ∈ ask | ENABLE; SELECT/INSERT (`037:34`) |
| `duty.assignment` | id, tenant_id, teacher_id, kind, duty_date, period, note, allocated_by | kind ∈ duty/invigilation/event/exam; unique `(tenant, teacher, kind, date, COALESCE(period,''))` (`037:60-61`) | ENABLE; SELECT/INSERT (`037:63`) |

**Finding P2 (TCH-DAT-2):** no `FORCE ROW LEVEL SECURITY` on any teacher-domain table except
`teacher.submission_needs_linking` (`102:24`). The house pattern adopted FORCE for later tables
(083/102); the domain is inconsistent.

**Absent vs plan §3 (`TEACHEROS-PLAN.md:112-141`):** `teacher.lesson`, `teacher.observation`,
`notification.pref` do not exist anywhere.

---

## 5 · Door inventory (45 doors)

### 5.1 `teacher.classroom` — 8 doors (`server/src/plugins/teacher.classroom/index.js`)

| # | Method + path | Roles | Line | Behaviour |
|---|---|---|---|---|
| 1 | `POST /plugins/teacher.classroom/homework` | teacher | :107 | validates class/subject/title/due; `safeAttachmentRef` (http(s)/plain only); inserts; emits `homework.v1`; audits |
| 2 | `GET /plugins/teacher.classroom/homework` | teacher | :133 | `created_by=self` unconditional; `submission_count`; LIMIT 100. **`class` param ignored** |
| 3 | `GET /plugins/teacher.classroom/homework/:id` | teacher | :147 | own-only; joins submissions to `app.students` for name; 404 otherwise |
| 4 | `POST /plugins/teacher.classroom/homework/:id/submit` | student | :169 | one-shot; late at insert; resolves roster row by name+grade (`resolveStudent`); 409 on 23505; 409 unlinked account. **only `text|link`** |
| 5 | `POST /plugins/teacher.classroom/submissions/:id/review` | teacher | :240 | assigning-teacher-only 403; status ∈ reviewed/graded/resubmit_requested; grade only when graded; emits `submission.v1`; audits |
| 6 | `GET /plugins/teacher.classroom/submissions` | teacher | :274 | state ∈ pending/reviewed/late/missing (default `pending`); own homework only. **`homework` filter ignored; no `all` state** |
| 7 | `POST /teacher/leave` | teacher | :327 | kind/date/reason validation; inserts leave_request; raises kernel action `teacher.leave.<id>`; emits `staff.leave.requested.v1`; audits |
| 8 | `GET /teacher/leave/mine` | teacher | :359 | lists own leave; **mirrors kernel decision into row** (idempotent, audited per real transition) |

### 5.2 `teacher.support` — 22 doors (`server/src/plugins/teacher.support/index.js`)

| # | Method + path | Roles | Line |
|---|---|---|---|
| 1 | `POST /teacher/concern` | STAFF | :97 |
| 2 | `GET /teacher/concerns` | STAFF | :150 |
| 3 | `POST /teacher/concern/:id/route` | ROUTE_AUTHORITY | :179 |
| 4 | `POST /teacher/concern/:id/outcome` | STAFF | :222 |
| 5 | `GET /teacher/concern/:id/events` | STAFF | :253 |
| 6 | `POST /safety/box` | student | :274 |
| 7 | `GET /safety/box` | BOX_READERS | :320 |
| 8 | `GET /safety/box/summary` | SAFEGUARD_AUTHORITY+counselor | :357 |
| 9 | `POST /safety/box/:id/assign` | SAFEGUARD_AUTHORITY | :376 |
| 10 | `POST /safety/box/:id/close` | BOX_READERS | :406 |
| 11 | `POST /plugins/teacher.support/doubt` | student | :429 |
| 12 | `GET /teacher/support/doubts` | teacher/oversight/student | :486 |
| 13 | `POST /teacher/support/doubts/:id/answer` | teacher/oversight | :508 |
| 14 | `POST /teacher/support/doubts/:id/promote-faq` | teacher/oversight | :530 |
| 15 | `POST /interventions` | STAFF | :559 |
| 16 | `GET /interventions` | STAFF | :588 |
| 17 | `POST /interventions/:id/transition` | STAFF | :615 |
| 18 | `GET /ptm/slots` | STAFF+parent | :655 |
| 19 | `POST /ptm/slots` | teacher | :681 |
| 20 | `POST /ptm/book` | parent | :708 |
| 21 | `POST /ptm/:id/notes` | teacher | :761 |
| 22 | `GET /ptm/:id/notes` | teacher | :784 |

### 5.3 `teacher.copilot` — 8 doors (`server/src/plugins/teacher.copilot/index.js`)

| # | Method + path | Roles | Line |
|---|---|---|---|
| 1 | `GET /curriculum/tree` | STAFF | :98 |
| 2 | `POST /curriculum/progress` | STAFF | :128 |
| 3 | `GET /mastery/student/:id` | STAFF | :308 |
| 4 | `GET /mastery/class/:grade` | STAFF | :354 |
| 5 | `GET /teacher/brief` | TEACHER_ONLY | :531 |
| 6 | `POST /copilot/draft` | TEACHER_ONLY | :549 |
| 7 | `POST /copilot/ask` | TEACHER_ONLY | :656 |
| 8 | `GET /teacher/usage` | TEACHER_ONLY | :748 |

### 5.4 `coord.view` — 7 doors (`server/src/plugins/coord.view/index.js`)

| # | Method + path | Roles | Line |
|---|---|---|---|
| 1 | `GET /coord/home` | AUTHORITY | :267 |
| 2 | `GET /coord/curriculum-monitor` | AUTHORITY | :291 |
| 3 | `GET /coord/teacher-workload` | AUTHORITY | :304 |
| 4 | `POST /coord/substitution/decide` | AUTHORITY | :316 |
| 5 | `POST /coord/duty/allocate` | AUTHORITY | :367 |
| 6 | `GET /coord/escalations` | AUTHORITY | :430 |
| 7 | `POST /coord/copilot-lite` | AUTHORITY | :562 |

### 5.5 Frozen §4 contracts (`TEACHEROS-PLAN.md:147-162`) — conformance

| Contract | Status |
|---|---|
| `GET /teacher/home` | **ABSENT** |
| `POST /lessons` · `GET /lessons?date=` · `POST /lessons/:id/reflect` | **ABSENT** |
| `GET /duty/roster?window=` | **ABSENT** |
| `GET /workload/mine` | **ABSENT** |
| `POST /interventions/:id/reassess` | **DRIFTED** (server `/transition`) |
| `POST /copilot/draft` kind `questions` | **PARTIAL** (only lesson/worksheet/feedback/message) |
| `POST /copilot/ask → suggested_action?` | **PARTIAL** (always null) |
| `GET /teacher/concerns?queue=` | **DRIFTED** (uses `status`) |
| `GET .../submissions?homework=&state=` | **DRIFTED** (`homework` ignored, no `all`) |
| `POST .../submit` (text/image/pdf/link) | **NARROWED** (text/link only) |
| `GET .../homework?class=&mine=1` | **DRIFTED** (`class` ignored) |

---

## 6 · Data travel (end-to-end flows)

### F1 · Homework lifecycle
```
teacher → POST homework ──▶ teacher.homework (status open)
                            ├─ emit homework.v1
                            └─ audit "Homework posted"
student → GET /student/homework (student.world) ◀── reads teacher.homework by class_grade
student → POST .../submit ──▶ resolveStudent(name, grade) ──▶ teacher.submission
                              ├─ late = now > due_at (status late/submitted)
                              ├─ UNIQUE(homework_id, student_id) ⇒ 2nd = 409
                              ├─ emit submission.v1
                              └─ audit "Homework submitted"
teacher → GET .../submissions?state=pending|reviewed|late|missing
teacher → POST .../review ──▶ status reviewed/graded/resubmit_requested
                              ├─ assigning-teacher-only (403)
                              ├─ emit submission.v1
                              └─ audit "Submission reviewed"
```
No digest/reminder worker exists on this path (see §9 TCH-GAP-3).

### F2 · Staff leave → kernel → projection
```
teacher → POST /teacher/leave ──▶ teacher.leave_request (pending)
                                  └─ app.actions code teacher.leave.<id> owner_role=coordinator
                                     payload.proposed_by = teacher
coordinator → POST /actions/:id/decide (kernel routes.js) ──▶ approved/dismissed (SoD)
teacher → GET /teacher/leave/mine ──▶ mirrors decision into leave_request (idempotent)
                                       └─ audit "Leave decision projected" per real transition
coord → GET /coord/home reads approved teacher.leave_request for staffing/gaps
```
No substitution proposal or handover packet is generated on approval (TCH-GAP-5).

### F3 · Concern lifecycle
```
STAFF → POST /teacher/concern ──▶ teacher.concern (open)
                                  ├─ append concern_status_event (NULL→open)
                                  ├─ if safety/critical: app.actions concern.escalate.<id> (principal)
                                  ├─ emit concern.filed.v1
                                  └─ audit
coordinator → POST /:id/route ──▶ status routed, routed_to/routed_role
                                  ├─ SoD: filer can't route; router ≠ designee
                                  ├─ app.notifications to designee
                                  ├─ app.communications template concern.routed.v2 (drift: event says .v1)
                                  ├─ append status event
                                  ├─ emit concern.routed.v1
                                  └─ audit
designee → POST /:id/outcome ──▶ closed + outcome
                                  ├─ append status event
                                  ├─ emit concern.closed.v1
                                  └─ audit
GET /:id/events → append-only history (but see TCH-DAT-1)
```

### F4 · Anonymous safety box
```
student → POST /safety/box ──▶ safety.box (anonymous default)
                               ├─ anonymous ⇒ reporter_user_id NULL (CHECK)
                               ├─ audit actor 'anonymous (student)'
                               ├─ if serious: app.actions safety.page.<id> (principal, critical)
                               └─ emit safety.report.filed.v1
BOX_READERS → GET /safety/box[?assigned=1] (never teachers)
SAFEGUARD_AUTHORITY → POST /:id/assign (assignable set = reader set)
BOX_READERS/assignee → POST /:id/close
SAFEGUARD_AUTHORITY+counselor → GET /safety/box/summary (counts only)
```

### F5 · Doubt routing (deterministic, no AI)
```
student → POST /plugins/teacher.support/doubt
          ├─ grade by name-match
          ├─ subject → most-frequent teacher on app.timetable_slots (tie-break name)
          ├─ fallback: first active teacher (reason says so)
          └─ support.doubt (routed), emit doubt.routed.v1, audit
teacher → GET /teacher/support/doubts (routed_to me)
teacher → POST /:id/answer ──▶ answered, emit doubt.answered.v1
teacher → POST /:id/promote-faq ──▶ support.faq, doubt→promoted, emit doubt.faq.promoted.v1
```

### F6 · Intervention lifecycle
```
STAFF → POST /interventions ──▶ intervention.plan (identified) + plan_event
        → /:id/transition: identified→planned→in_progress→reassessed→improved|continue|escalate
          ├─ state machine enforced
          ├─ owner or CONCERN_OVERSIGHT only
          ├─ append plan_event
          ├─ emit intervention.status.changed.v1
          └─ audit
```

### F7 · PTM
```
teacher → POST /ptm/slots ──▶ ptm.slot (open), emit ptm.slot.published.v1
parent  → GET /ptm/slots (no other-family booking detail)
parent  → POST /ptm/book ──▶ ptm.booking, slot→booked
          ├─ guardianship via family.child_link (structural, not name)
          ├─ app.communications ptm.invite.v1 — **audience = [email] on channel whatsapp** (delivery bug)
          ├─ emit ptm.booked.v1
          └─ audit
teacher → POST /ptm/:id/notes ──▶ teacher.note via user-pinned RLS connection
teacher → GET /ptm/:id/notes
```

### F8 · Curriculum & mastery
```
STAFF → GET /curriculum/tree?subject=&grade= (seeded tree + coverage)
STAFF → POST /curriculum/progress ──▶ upsert curriculum.progress, audit
        (curriculum.node is SELECT-only for the app role — A1)
mastery.evidence is written by sibling lanes (assessments/homework/observations) — **no writer exists in-tree**
GET /mastery/student/:id → resolveMasteryState:
   no evidence        → no label persisted (A3)
   fresh evidence     → level from avg, persisted/refreshed
   only expired       → slide ONE step down, confidence low, persisted once
   ├─ audit on real change (DAT-7)
   └─ note: labels decay, "needs support" never "failing"
GET /mastery/class/:grade → cells with evidence/state only
```

### F9 · Copilot & brief (deterministic v0)
```
GET /teacher/brief?when=eod|week
   ├─ timetable (probe), homework (probe), concerns (probe), curriculum pace (own)
   ├─ deterministic sentences; missing neighbours said plainly
   ├─ budgetCall verb=brief
   └─ audit
POST /copilot/draft {kind: lesson|worksheet|feedback|message}
   ├─ grounding: curriculum.node when nodeId given
   ├─ template body labelled ai_draft; no model call
   ├─ DAILY_CAP 200 (ask+draft) → 429
   ├─ budgetCall verb=draft; audit
   └─ returns {draft, label:'ai_draft', builtFrom, budget}
POST /copilot/ask {question}
   ├─ keyword routing: curriculum | mastery | day | homework | fallback brief
   ├─ sources[]; suggested_action always null
   ├─ budgetCall verb=ask; audit
   └─ honest fallback = the brief itself
GET /teacher/usage → own 24h budget ledger
```

### F10 · Coordinator plane
```
GET /coord/home → staffingToday + curriculumMonitor + pendingApprovals + openIssues
   ├─ absences from teacher.leave_request(approved) + plugin_hr.leave(marked)
   ├─ gaps: absent teacher slots without a non-cancelled substitution
   └─ student identity in openIssues only where coordinator is routed authority
POST /coord/substitution/decide → kernel action owner_role=coordinator; code must carry 'sub'; SoD
POST /coord/duty/allocate → least-loaded deterministic pick; emit duty.assigned.v1
GET /coord/escalations → family.request(owner_role=coordinator) + open concerns, privacy-tiered
POST /coord/copilot-lite → keyword intents; 200/month; never invents
```

---

## 7 · UI surface map

### 7.1 Routed screens (`app/src/App.tsx:510-527`)

| Route | Screen | Doors called | Verdict |
|---|---|---|---|
| `/teacher` | `TeacherHome.tsx` | `getTeacherHome`→**`/teacher/home` (404)**, `getTeacherBrief` | **always error page** (`TeacherHome.tsx:250-264`) |
| `/teacher/homework` | `teacher/Homework.tsx` | list/create/listSubmissions | live; class tabs hardcoded (`:30`) |
| `/teacher/submissions` | `teacher/SubmissionsInbox.tsx` | listHomework/listSubmissions/review | live; **shape-broken** (§7.4) |
| `/teacher/leave` | `teacher/MyLeave.tsx` | listMyLeave/createLeave | live; **shape-broken** (§7.4) |
| `/coord/*` (6) | `coord/*` | coord doors | live |

Teacher nav (`Shell.tsx:78-87`) contains **no `/teacher/*` entry**; teachers land on `/today`
(`roles.ts:45-53`). `MobileTabbar` exposes `/teacher/homework` + `/teacher/submissions` to every
staff role without `canSurface` (`DemoBar.tsx:28-29`).

### 7.2 Orphaned teacher screens (no route, no import)

`teacher/MasteryMap.tsx`, `teacher/CurriculumProgress.tsx`, `teacher/ProgressStory.tsx`,
`teacher/DutyWorkload.tsx`, `teacher/ExamMarks.tsx`, `teacher/InsightsShared.tsx` — verified: only
self-references in `App.tsx`.

### 7.3 No screen exists at all for

Concerns, safety box, doubts, interventions, PTM, announcements/messages, class analytics,
copilot ask/draft (`/teacher/copilot` unregistered → `NotFound`), question bank, lessons.
Verified by wrapper-caller count = 0.

### 7.4 Response-shape mismatches that break live screens

| Screen | Expects | Server returns | Effect |
|---|---|---|---|
| `SubmissionsInbox.tsx:103-105` | `s.id` | `s.id AS submission_id` (`teacher.classroom/index.js:315`) | selection/review keyed on undefined |
| `SubmissionsInbox.tsx:329,396` | `homework_title`, `content_ref` | `h.title`, `h.subject` only | blank columns |
| `SubmissionsInbox.tsx:347` | `s.status` on missing rows | missing branch omits `status` (`:296-308`) | `STATE_BADGE[undefined]` crash on Missing tab |
| `SubmissionsInbox.tsx:73-76` | "All" tab | no `state` → server defaults `pending` | All shows pending only |
| `MyLeave.tsx:93-96,191` | `{requests, balances}` | `{leave:[…]}` (`:407-410`) | `.map` throws → ErrorBoundary |
| `MyLeave.tsx:87` | `r.request.id` | `{requestId, actionId, note}` (`:355`) | success shown as failure |
| `MasteryMap.tsx:50,53` | `{topics[]}` | `{map[],note}` (`teacher.copilot/index.js:347-349`) | empty map |
| `CurriculumProgress.tsx:132` | `{units:[{coveredPct}], pacing}` | `{units:[{topics:[…]}]}` (`:115-122`) | undefined coverage/pacing |
| `Homework.tsx:268` | `submission_counts` | `submission_count` (`:138`) | fallback handles it |

### 7.5 Honesty defects (fabricated / live-sounding claims)

| ID | Sev | Defect | Evidence |
|---|---|---|---|
| TCH-HON-1 | P0 | `TeacherHome` static "Attendance · Not marked yet · absent guardians are told automatically" — no data, no door | `TeacherHome.tsx:317-323` |
| TCH-HON-2 | P1 | "Guardian digest 17:00 — Sent automatically" / "reminders run automatically" — no digest/reminder worker | `Homework.tsx:141,219`; `SubmissionsInbox.tsx:176,198,…` |
| TCH-HON-3 | P1 | `MyLeave` claims auto-substitution + handover packet; reads `r.handover` server never returns | `MyLeave.tsx:7-11,47,104,210-239` |
| TCH-HON-4 | P1 | `FEATURES-STATUS.md:16-17` claims support screens GA and copilot doors consumed by UI | no support screen exists |
| TCH-HON-5 | P2 | hardcoded class lists `['8-B','8-A','7-A']`, subject `'Maths'` | `Homework.tsx:30-31`; `MasteryMap.tsx:37` |
| TCH-HON-6 | P2 | fabricated placeholder student id `'stu_1'` sent to live doors | `MasteryMap.tsx:252,256`; `ProgressStory.tsx:76,79` |
| TCH-HON-7 | P2 | `DutyWorkload` asserts roster clash rules for a non-existent duty plane | `DutyWorkload.tsx:186-193` |

---

## 8 · Test coverage

| File | Cases | Pins |
|---|---|---|
| `tests/teacher-classroom.test.js` | 14 | homework post/list/audit; submit+name; one-shot 409; late; graded review; role gates; missing inbox; staff leave 2 actions + DAT-6 projection; RLS; plain errors; 082 FK write; unlinked 409; body-override |
| `tests/teacher-support.test.js` | 3 | doubt answer→promote-once; unanswered refusal; parent refusal; intervention append-only |
| `tests/teacher-copilot.test.js` | 13 | A1 tree+check-off; A3 decay/recovery/idempotence/floor/no-negative; class map; brief; draft labelled + budget; ask routing + fallback; gates; lifecycle; RLS |
| `tests/coord-view.test.js` | 10 | teacher refused; home shape; weeks_behind; workload no score/rank; duty least-loaded; substitution SoD+aliasing; escalations privacy; copilot intents+429; degradation |
| `tests/mastery-audit.test.js` | 5 | DAT-7 read-path audit |
| `tests/b9-confidentiality.test.js` | 6 | concern tiers; routing SoD; box anonymity; summary counts-only; PTM notes privacy |
| `tests/rbac-counselor.test.js` | 7 | counselor issuance; concern board; assigned queue; box tier; teacher own-scope |

**Untested:** safety-box close; concern outcome/events; review `resubmit_requested`;
`safeAttachmentRef` XSS; copilot draft kinds feedback/message; **all UI**.

---

## 9 · Gap register vs TEACHEROS-PLAN

| ID | Feature | Sev | Evidence |
|---|---|---|---|
| TCH-GAP-1 | `GET /teacher/home` command center aggregate | P0 | absent; `teacherFixtures.ts:130`, `TeacherHome.tsx:228` |
| TCH-GAP-2 | Lessons lifecycle + `teacher.lesson` + reflect | P0 | absent; plan `:58,118` |
| TCH-GAP-3 | Homework guardian digest / reminders / non-submission patterns | P0 | no worker, no `hw.digest.v1`/`hw.remind.v1` |
| TCH-GAP-4 | Duty roster + workload doors | P0 | absent; `DutyWorkload.tsx` orphaned |
| TCH-GAP-5 | Substitution proposal → handover on leave approval | P0 | server mirrors decision only (`index.js:359-411`) |
| TCH-GAP-6 | Support/PTM/concern/safety/intervention UI | P0 | 0 wrapper callers |
| TCH-GAP-7 | Copilot ask/draft UI | P0 | no screen; `/teacher/copilot` unregistered |
| TCH-GAP-8 | Copilot Analyze verb + suggested_action + super-search | P1 | `index.js:742` always null |
| TCH-GAP-9 | AI grading assistant + feedback copilot | P1 | absent |
| TCH-GAP-10 | Question bank + moderation + duplicate detection | P1 | absent |
| TCH-GAP-11 | Curriculum import/staging (A1) | P1 | only hardcoded 033 seed |
| TCH-GAP-12 | `reassess` naming drift | P1 | `/transition` vs `/reassess` |
| TCH-GAP-13 | Department spaces | P2 | absent |
| TCH-GAP-14 | Offline sync queue / service worker | P2 | absent |
| TCH-GAP-15 | Voice | P2 | absent |
| TCH-GAP-16 | `notification.pref` + quiet hours | P2 | table absent |
| TCH-GAP-17 | Class analytics composite door | P2 | wrapper only |
| TCH-GAP-18 | Progress story door | P2 | `/progress/story` absent |
| TCH-GAP-19 | Mastery only 2 subjects seeded | P3 | `index.js:43` |

---

## 10 · Cross-cutting

- **Capability map** (`server/src/effective-access.js:100-103`): `/teacher`→homework door,
  `/teacher/homework`, `/teacher/submissions`, `/teacher/leave`→`/teacher/leave/mine`. Insights
  routes are unnamed → `canSurface` fails closed if ever routed (`app/src/lib/effective.ts:28-51`).
- **RBAC holes:** client gates use raw `session.roleId` (`teacherKit.tsx:45`, `Homework.tsx:128`,
  `MyLeave.tsx:98`, `SubmissionsInbox.tsx:187`, `DutyWorkload.tsx:62`, `InsightsShared.tsx:30`,
  `coord/shared.tsx:14-18`, `teacherContext.tsx:48`); only Fees/PersonDetail/FeePlans use
  `useRoleOrGrant`. `App.tsx:194` `Guard` only applies `canSurface` when the demo role matches.
- **Parity gate** (`server/scripts/parity-gate.js`) scans **non-GET doors only** (`:46`) and
  allowlists the whole `/teacher/` namespace (`:153`), so every missing GET and every orphan screen
  is invisible.
- **Manifest drift:** 031/032/034 registry permission JSON omits `actions.raise` (and `comms.send`);
  `lifecycle-gate.js:49-58` compares stored grant to manifest until `ensurePluginCatalog` resyncs.
