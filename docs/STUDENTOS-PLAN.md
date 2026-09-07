# StudentOS — Build Plan (compact)

Companion to TEACHEROS/PARENTOS plans. Hard constraint from the architecture: **students carry no personal phones** — every feature works on school infrastructure (lab/kiosk/teacher machine), via teacher mediation, or on paper, with home access device-agnostic. Feature classes: **S**chool infra · **T**eacher-mediated · **P**aper-supported · **H**ome access. No feature may be essential because of a phone. No streaks/feeds/engagement loops (§88). Acceptance test §92 gates every unit.

## Reuse map (what students get from existing/in-flight work)
✅ Already live: timetable/day view · homework view+submit (teacher.classroom, in flight — paper mode: teacher records receipt) · results (frozen reports, plain explain) · AI Ask (StudentAsk) · learning/portfolio screens · concern filing (teacher.support: safety box door is student-role!) · attendance read · announcements · calendar · library surface
🔨 New in StudentOS v1: Session-Isolation Guard (shared computer) · Print Center (plans/timetables/portfolio/checklists) · Paper-mode assignment flows · Mistake notebook · Flashcards+study mode · "What do I need tomorrow?" · print-ready weekly noticeboard summary

## Data model (migration 036)
```
student.mistake_note   (id, tenant, student_id, subject, topic, what_wrong, correction, lesson, at)  -- own-rows only
student.flashcard      (id, tenant, student_id?, deck, front, back, subject, topic, created_by)
student.print_job      (id, tenant, student_id, kind timetable|study_plan|checklist|portfolio|mistake_sheet|
                        flashcards|noticeboard, payload jsonb, status queued|printed, requested_at)
student.study_task     (id, tenant, student_id, title, due_date, done bool, source manual|homework)
```
Session isolation: server enforces `Cache-Control: no-store` + `Clear-Site-Data` on logout for student sessions + short idle timeout (config STUDENT_IDLE_TIMEOUT default 10min) — pinned by test. Print jobs are school-controlled (office/teacher print queue door), never phone push.

## Frozen API contracts (v0)
```
GET  /student/home            → {next_class, today:{classes,assignments_due,upcoming_test}, needs_attention[], progress[{subject,direction}], bag_tomorrow[]}
GET  /student/homework        → {digital:[], paper:[]} (mode field from teacher.homework; paper = "in notebook" no upload)
POST /student/homework/:id/submit     (digital only; already in classroom lane)
GET  /student/results         → published reports + explain lines (reuse family.view logic scoped to self)
POST /student/mistakes        · GET /student/mistakes · POST /student/flashcards · GET /student/flashcards?deck=
GET/POST /student/tasks       (study tasks + homework-derived checklist; printable)
POST /student/print           {kind, payload} → queued (office/teacher prints; status polled)
GET  /student/print/queue     (staff door: office/teacher see pending print jobs)
GET  /student/noticeboard     → print-ready weekly summary (assignments/exams/events/clubs) — staff door too
POST /student/wellbeing       → routed to counselor via teacher.support concern flow (role student)
```
Role gates: student sees ONLY own rows (session-scoped; shared-computer safe); teacher/office see print queue + noticeboard; counselor sees wellbeing routing; no student door ever exposes another student's data.

## Lanes (4, disjoint)
| Lane | Scope | Files |
|---|---|---|
| **SS-1** server-student | migration 036 (4 tables + RLS + registry + ledger) + ALL doors above + session-isolation middleware (no-store, Clear-Site-Data on logout, idle timeout) | `server/src/plugins/student.world/**`, `migrations/036_*`, `tests/student-world.test.js` |
| **SU-1** ui-student-home | Student Home rebuild (§90 sketch): NEXT CLASS/TODAY/NEEDS ATTENTION/PROGRESS/QUICK ACCESS + bag-tomorrow + print buttons + session-isolation UX (auto-logout countdown, "log out when done" nudge) | `app/src/screens/student/StudentHome2.tsx`, `app/src/components/student/**` |
| **SU-2** ui-student-learn | Homework center (digital+paper modes) · Mistake notebook · Flashcards · Study tasks+planner · Print center · Results view | `app/src/screens/student/learn/**` |
| **SU-3** ui-staff-student | Teacher/office print queue + noticeboard generator · classroom session controls stubs | `app/src/screens/student/staff/**` |

## Sequencing
W1: SS-1 → W2: SU-1+SU-2+SU-3 on live doors → W3: integration + red-team student cycle (session isolation, own-rows-only, no-phone audit) → factory-check. Est: **6–9h** with 4 lanes.

## Acceptance script (final gate — §92/§97)
1. Student logs into lab computer → Home shows day + needs attention + progress — zero phone
2. Homework paper mode → teacher marks received → student sees "Teacher marked received" — no upload
3. Digital homework → submit from lab computer → receipt with timestamp
4. Shared computer: logout → Student B sees NOTHING of Student A (no-store/clear verified by test)
5. Print study plan/timetable/portfolio → print job queued → office prints
6. Mistake notebook + flashcards on lab machine; printable sheet generated
7. "What do I need tomorrow?" from timetable — printable checklist
8. AI Tutor works on school computer; integrity respected; no engagement loops anywhere
