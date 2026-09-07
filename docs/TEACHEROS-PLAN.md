# TeacherOS — Master Architecture & Build Plan

The complete teacher experience for SchoolOS: every feature from the 78-section Teacher Experience Architecture, decomposed into 6 parallel build lanes with frozen contracts. North star: **"The teacher opens SchoolOS → the day is already understood → she teaches → the system handles routine coordination → she makes the decisions that matter → the system records everything."**

---

## 0 · Five non-negotiable principles (inherited, enforced)
1. **Teach first** — every feature must remove work, never add it. Common task in ≤20 seconds.
2. **Context everywhere** — every screen knows teacher, classes, subjects, timetable, students.
3. **AI recommends, teacher decides** — all consequential acts ride the kernel approval spine (proposer≠approver, decide→execute, SoD 403).
4. **Governed by default** — RLS tenancy, least privilege, masked contacts, append-only corrections, immutable published records, full audit.
5. **Progressive complexity** — Tier 1 daily (seconds) · Tier 2 weekly · Tier 3 periodic. Progressive disclosure, never a feature dump.

## The four amendments to the source architecture (decided)
- **A1 · Curriculum is seeded, never teacher-typed** — curriculum trees import per tenant (migration staging pattern); office/owner owns authoring; AI assists. Teachers only *check off progress*.
- **A2 · Copilot runs on budget classes** — every AI call tagged; teacher tier capped; visible in AI usage governance. Copilot is retrieval-scoped to authorized data only.
- **A3 · Mastery labels decay** — a 🔴/🟢 is evidence-stamped and expires unless re-evidenced; no permanent negative labels on minors.
- **A4 · Offline & voice are infrastructure waves** — deferred to TI/TV (below), each with its own red-team cycle (sync conflicts can corrupt consequential data).

---

## 1 · Information architecture (final)

```
TEACHER HOME (Command Center)
├── NOW (current period, room, lesson, attendance state, end-lesson)
├── NEXT (next 2–4 commitments)
├── NEEDS ATTENTION (actionable only, ranked)
├── TODAY AT A GLANCE (periods/duties/deadlines)
├── QUICK ACTIONS (context-inferred, one menu from every screen)
└── COPILOT ("What do you need?")
TEACH        → Classes · Lessons · Curriculum progress · Resources · Copilot
STUDENTS     → Class lists · Profiles · Mastery maps · Concerns · Interventions · Timeline
ASSESS       → Homework+Submissions inbox · Assessments · Question bank · Analytics
COMMUNICATE  → Announcements · Messages · Templates · Parent comms drafts
SCHEDULE     → Timetable · Duties · Substitution · My leave · Calendar
INSIGHTS     → Class analytics · Workload · Curriculum coverage · Progress stories
ME           → Profile · Preferences · Leave history · My activity/audit
```
Mobile priority order: Today · Attendance · Next class · Homework · Messages · Concerns · Copilot · Quick actions.

---

## 2 · Feature catalog (78 sections → 12 product areas)

### P1 · Command Center home (§2,3,41,69,71,72)
- **NOW card**: current/next period, room, lesson objective, attendance state, [Start lesson] [Attendance] [Copilot] [End lesson]
- **NEXT**: 2–4 commitments (classes/duties/PTMs/exams)
- **NEEDS ATTENTION**: ranked actionable-only (pending reviews, learning gaps, missing substitute, approval-pending items). Never noise.
- **Quick actions** (14, context-inferred): Attendance · Assign homework · Create assessment · Record marks · Create lesson · Announce · Message parent · Flag concern · Request leave · Request substitute · Add observation · PTM note · Report incident · Ask AI. Opening from a class context prefills class/subject/teacher — teacher fills only what's necessary.
- **Action recommendations**: "What should I do next?" ranked by urgency+deadline+need, with time estimates. Suggestions only.
- **End-of-day brief** (opt-in, 17:00): done/needs-attention/tomorrow/preparation. **Weekly brief**: curriculum pace, trends, workload.

### P2 · Timetable & calendar (§4,37)
Teacher week grid: periods, rooms, subjects, lessons, duties, substitution status, exams, PTMs, events. Today/Week/Month/Academic-calendar views. Conflict detection (double-booking, room, duty, exam) → propose → coordinator approves. Never silently resolve.

### P3 · Lessons & curriculum (§5,7,33,34,35,36,47)
- Lesson workspace: objectives, activities, resources, duration, differentiation, assessment method. Lifecycle Planned→Prepared→Teaching→Completed→Reflected (10–20s reflection) → curriculum progress auto-updates.
- **AI lesson generation**: "40-min fractions lesson for Class 7" → full draft → teacher edits/approves. Generated content always labelled AI-draft.
- **Curriculum (A1)**: imported tree (subject→grade→unit→topic→objective). Progress bars per topic; pacing detection (behind/ahead/weak-mastery-despite-coverage). Teachers tick coverage; office authors.
- Resource library + AI generators (worksheets/quizzes/revision/flash cards) — teacher reviews before use. Differentiation: support/standard/advanced variants, simplified language. Document intelligence: upload → AI extracts questions/objectives → teacher confirms.

### P4 · Teaching Copilot (§6,68,70)
Scoped to authorized data. Four verbs: **Ask** ("what did I teach 8A last week?", "who hasn't submitted 3 assignments?") · **Create** (drafts; teacher approves) · **Analyze** (class performance, gaps, patterns) · **Explain/Adapt** (simple/advanced/analogy/multilingual). Super-search: natural language → permission-checked operations ("students in 8A who missed 2+ maths assignments this month"). AI safety: sources shown, suggestions labelled, approval for consequential acts, AI action log, budget class T-copilot (A2), no diagnosis, uncertainty visible.

### P5 · Students: mastery & growth (§9,32,50,59)
- **Mastery map** per student per subject (A3 decay): Fractions 🟢 · Algebra 🟡 · Word problems 🔴 — every label click-through to evidence (assessments, homework, observations). Trend arrows. "Needs support", never "failing".
- **Progress story**: chronological narrative (introduced → assessed weak → intervention → improved → mastery) instead of score-only.
- **Lightweight observations**: participation/confusion/engagement/confidence in neutral language; AI finds patterns, teacher corrects.
- **Universal timeline** (permission-filtered): homework, submissions, assessments, interventions, PTMs — restricted records (clinic/safeguarding/fees) NEVER appear for teachers.

### P6 · Homework & submissions (§14,15)
- 20-second assignment: class/subject/title/description/attachment/due/submission method → auto-publish to students + guardian digest (17:00).
- Submissions: text/image/PDF/link/scan → **Gmail-style inbox** (All/Pending/Reviewed/Late/Missing/Needs-attention), bulk review, filters, AI triage.
- Review: mark reviewed/grade/comment/request resubmission/flag concern. Automation: reminders, digest status, repeated non-submission patterns → teacher weekly (not naggy).

### P7 · Assessment & grading (§11,12,13,38,54,55,56)
- Builder: quiz/test/exam-proposal/practical/project; AI question generation filtered by topic/objective/difficulty/Bloom/marks; **validation** (totals, weightage, blueprint, coverage, duplicates) — reuses exams weightage machinery.
- **AI grading assistant**: submission → AI rubric suggestion → teacher reviews/edits → teacher approves → final mark. Labels: AI suggestion vs teacher decision. Never auto-publish.
- Feedback copilot: one-tap strengths/improvement/next-step/encouragement drafts, five tones, teacher edits before send.
- Question bank (school-controlled), moderation multi-reviewer (proposer≠approver), re-evaluation workflow (append-only, kernel action), academic integrity (duplicate detection → "review required", never auto-accuse).

### P8 · Attendance, leave, substitution, duty, workload (§16–20)
- Attendance: one-tap, GPS autofill, **leave-aware pre-marking**, late/early, corrections append-only. Deterioration patterns → appropriate people, teacher only sees actionable cases.
- **Teacher self-leave**: request → policy validation → coordinator approval → **auto substitution proposal** (free periods, subject compatibility, workload fairness) → approval → handover packet (class/room/lesson/last-topic/suggested activity) → all notified. Balance/history/status visible.
- Duty tracking (invigilation/corridor/assembly/lunch/events) + fairness analytics + excessive-allocation detection. **Workload engine**: teaching+substitutions+invigilation+grading+PTMs+meetings+duties → My workload + coordinator insights — for fairness & burnout prevention, NEVER performance rankings.

### P9 · Communication (§21,22,23)
- Class announcements (scheduled, receipts), direct in-school messages (masked numbers, never personal), approved template library (homework reminder, absence follow-up, PTM invite, appreciation, concern, exam info…). Parent-communication copilot: "tell Rahul's parents he improved in algebra but needs word-problem practice" → professional draft → teacher edits → send. AI must not invent/diagnose/promise/disclose.

### P10 · Student support & safeguarding (§24–29,40)
- **Doubt routing**: student asks → subject/topic classified → routed to authorized teacher; teacher sees context+prior questions; repeated doubts surface; convert to class FAQ.
- **One-tap concern flags** (academic/attendance/behaviour/wellbeing/safety/engagement) with observation+urgency+evidence → auto-route to correct team (counselor queue). Human review always; AI never diagnoses.
- **Early-warning**: authorized signals (attendance decline, missing assignments, assessment decline, gaps, flags) → "**Possible need for support**" + evidence; teacher acknowledges/dismisses.
- **Safeguarding**: restricted visibility, escalation rules, immutable audit, anonymous student safety box → designated authority; serious cases page principal. Incident recording: factual fields, append-only corrections, no AI conclusions.
- **Interventions**: plan (targets, objective, activity, duration, owner) → lifecycle Identified→Planned→In-progress→Reassessed→Improved/Continue/Escalate.

### P11 · PTM, notes, collaboration (§30,31,53)
- PTM workspace: upcoming, booked slots, pre-meeting pack (profile/academics/attendance/recent work — authorized scope), agenda/notes/actions/commitments/follow-up; history never overwritten; private teacher notes strictly teacher-only.
- Department spaces: shared resources, common plans, blueprints, moderation, announcements — permission-scoped.

### P12 · Platform: states, offline, voice, personalization, search
- Every feature supports all 12 states (empty/loading/success/partial/error/offline/denied/pending/approval/archived/locked/sync).
- Global search (permission-respecting at query time). Personalization: pinned actions, widget order, preferences — never bypasses policy.
- **TI · Offline** (infra wave): service worker + sync queue + conflict-safe writes for attendance/marks/notes; never lose teacher data.
- **TV · Voice** (infra wave): "mark everyone present except Anil and Kavya" → confirmation-gated consequential acts.

---

## 3 · Data model (new, migration 031–033)

```
teacher.homework        (id, tenant, class_grade, subject, teacher_id, title, detail,
                         attachments jsonb, due_at, status, created_by)
teacher.submission      (homework_id, student_id, content_type, content_ref, submitted_at,
                         status: submitted|late|reviewed|resubmit_requested, grade, feedback,
                         reviewed_by, reviewed_at)          UNIQUE(homework_id, student_id)
teacher.lesson          (id, tenant, teacher_id, class_grade, subject, date, period,
                         topic, objectives jsonb, resources jsonb, reflection jsonb, status)
curriculum.node         (id, tenant, subject, grade, parent_id, kind: unit|topic|objective,
                         name, order_no)                    -- imported via staging (A1)
curriculum.progress     (node_id, class_grade, covered_pct, covered_by, covered_at, evidence_ref)
mastery.evidence        (student_id, subject, node_id, kind, ref, value, observed_at, expires_at)  -- A3
mastery.state           (student_id, subject, node_id, level, confidence, derived_from jsonb)
teacher.leave_request   (id, tenant, teacher_id, kind, from_date, to_date, reason,
                         status, approver_id, decided_at, note)
duty.assignment         (id, tenant, teacher_id, kind, date, period, source: roster|substitution,
                         fair_load_seq)                     UNIQUE(teacher_id,date,period,kind)
teacher.observation     (id, tenant, teacher_id, student_id, category, note, evidence_ref, at)
teacher.concern         (id, tenant, teacher_id, student_id, category, urgency, detail,
                         status: open|routed|in_support|closed, routed_to, outcome)  -- append-only status events
safety.box              (id, tenant, reporter_anonymous bool, class_grade, category, detail,
                         severity, status, assigned_to)     -- no reporter identity column when anonymous
ptm.slot                (id, tenant, teacher_id, date, period, status)
ptm.booking             (slot_id, student_id, guardian_id, booked_at, notes_ref, outcome_ref)
intervention.plan       (id, tenant, student_id, owner_id, objective, activity, started_at,
                         target_end, status, outcome)
copilot.call            (id, tenant, user_id, verb, budget_class, tokens_in, tokens_out,
                         sources jsonb, approved_action_id, at)   -- A2, feeds ai usage governance
notification.pref       (user_id, channel, quiet_hours jsonb, batching jsonb)
```
RLS on every table (tenant GUC), app-role grants per house pattern, append-only where marked, all writes audited. Substitutions/duties reuse hr.leave + timetable 021 absence_feed. Homework digests ride the comms rail (new templates: `hw.digest.v1`, `hw.remind.v1`, `leave.approved.v1`, `sub.assign.v1`, `concern.routed.v1`, `ptm.invite.v1`).

## 4 · API contracts (frozen — UI lanes build against these)

```
POST /plugins/teacher.classroom/homework                    {class_grade,subject,title,detail?,attachment?,due_at}
GET  /plugins/teacher.classroom/homework?class=&mine=1
POST /plugins/teacher.classroom/homework/:id/submit          (student; text/image/pdf/link)
POST /plugins/teacher.classroom/submissions/:id/review       {status, grade?, feedback?}
GET  /plugins/teacher.classroom/submissions?homework=&state=  (inbox views)
POST /plugins/teacher.classroom/lessons · GET …?date=        · POST /:id/reflect {worked,reinforce,next}
GET  /curriculum/tree?subject=&grade=  · POST /curriculum/progress {node_id,class_grade,pct,evidence?}
GET  /mastery/student/:id?subject=  (evidence-linked, decayed)  · GET /mastery/class/:grade?subject=
POST /teacher/leave  (self) · GET /teacher/leave/mine · GET /duty/roster?window= · GET /workload/mine
POST /teacher/concern  · GET /teacher/concerns?queue= · POST /:id/route (coordinator)
POST /safety/box  (student, anonymous ok) · GET /safety/box?assigned=1 (designated only)
GET/POST /ptm/slots · POST /ptm/book · POST /ptm/:id/notes
POST /copilot/ask {verb, question, scope} → {answer, sources[], suggested_action?, budget:{used,cap}}
POST /copilot/draft {kind: lesson|worksheet|feedback|message|questions, params} → draft (teacher approves)
POST /interventions · GET /interventions?student= · POST /:id/reassess
GET  /teacher/brief?when=eod|week  · GET /teacher/home  (NOW/NEXT/NEEDS-ATTENTION aggregate)
```
Role gates: teacher=own classes/subjects only · coordinator=approval+routing tier · counselor=support queue · principal=oversight+safeguarding authority · students/guardians = their own scope via existing surfaces.

## 5 · The 6 parallel lanes (ALL FIRED SIMULTANEOUSLY, contracts frozen above)

| Lane | Scope | Files owned (disjoint) | Migration |
|---|---|---|---|
| **TS-1 server-core** | P6 homework+submissions+digest hooks · P8 teacher leave+duty+workload · lessons | `server/src/plugins/teacher.classroom/**` | 031 |
| **TS-2 server-support** | P10 concerns+safety box+doubt routing+interventions · P11 PTM+notes | `server/src/plugins/teacher.support/**` | 032 |
| **TS-3 server-ai** | P4 copilot (ask/draft/analyze, budgets, action log) · AI grading+feedback drafts · P3 curriculum import+mastery read doors | `server/src/plugins/teacher.copilot/**` + `server/src/ai/**` | 033 |
| **TU-1 ui-home** | Command Center (NOW/NEXT/NEEDS/AT-A-GLANCE) · quick actions · nav/IA · briefs | `app/src/screens/TeacherHome*.tsx`, `app/src/components/teacher/**` | — |
| **TU-2 ui-flows** | Homework+inbox · attendance/leave/duty · communication · PTM surfaces | `app/src/screens/TeacherFlows/**` | — |
| **TU-3 ui-insights** | Mastery maps · timeline · class analytics · curriculum progress · workload | `app/src/screens/TeacherInsights/**` | — |

**Lane law:** disjoint file paths · frozen contracts · plain language everywhere · kernel approval for consequential acts · RLS everywhere · tests per door · handoff per unit · orchestrator is sole git authority · integration order TS-1/2/3 → TU-1/2/3 → cross-lane integration passes.

## 6 · Sequencing & success metrics

**Wave order:** W1 (TS-1+TS-2+TS-3 server doors + TU-1 home shell) → W2 (TU-2+TU-3 full surfaces on live doors) → W3 (briefs, digests live, recommendations, copilot tuning) → W4 (integration audit + red-team teacher-cycle + factory-check + release note). TI/TV follow as infrastructure waves.

**Success = the §73 metrics:** minutes-of-admin saved per day (target: ≥45), common task ≤20s, zero manual chasing (homework/absence), duty fairness visible, teacher-day rating "system removed work". Anti-metrics: no engagement-chasing, no teacher rankings, no notification floods.

## 7 · Teacher-day acceptance script (final gate)
1. 07:15 opens app → sees NOW/NEXT/needs — zero clicks to understand the day
2. 07:20 taps attendance → 30s done (leave-aware, autofilled)
3. 08:05 assigns homework in 20s → parents digest at 17:00 automatically
4. 10:00 reviews 6 submissions in inbox → 2 min
5. 11:30 flags a concern → routed to counselor, tracked
6. 13:00 requests leave Friday → coordinator approves → substitute proposed → everyone notified, handover packet ready
7. 15:00 asks copilot "who's weak in word problems?" → evidence-linked list → creates intervention
8. 16:45 gets end-of-day brief → tomorrow prepared
9. Every consequential act: audit trail + approval where due. Every string: plain language.
