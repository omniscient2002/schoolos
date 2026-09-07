# SchoolOS Role Deep-Dive — Every operational need, by role

Method: simulate a full week inside each role — morning, classroom, lunch, end-of-day, term-start, term-end, crisis day — and capture every "I wish the system could…" moment. Each item is tagged: ✅ exists today · 🔨 build next · 🌅 later wave. This is the requirement source for the automation waves; nothing here invents structure beyond what the kernel/plugins can already express.

---

## 1 · STUDENT — "My day, my work, my voice"

### Daily learning
- ✅ See today's timetable, rooms, teacher
- ✅ Ask the AI a doubt in plain language (Ask)
- ✅ Learning practice + portfolio
- 🔨 **Homework list with due dates** — per subject, what's pending, what's late
- 🔨 **Submit homework** — text/photo/file upload; teacher sees submission time
- 🔨 **Test/exam calendar** — "what's coming next week" (exams plugin has the data; student view missing)
- 🔨 **Results view** — published report cards with plain-language meaning ("A2 = excellent")
- 🌅 Syllabus progress ("where are we in the chapter")
- 🌅 Past papers / practice question bank
- 🌅 Olympiad/competitive-exam prep track

### Voice & safety
- ✅ AI Ask doubles as a question channel
- ✅ (via parent) complaints
- 🔨 **Anonymous safety box** — report bullying/ragging/unsafe behaviour, name optional, goes ONLY to principal/counselor, append-only, serious ones page the principal
- 🔨 **Student leave application** — sick leave/short leave with reason; sees approval status ("approved — rest well")
- 🔨 **Lost & found** — report/check items (small, high delight)
- 🌅 Peer-help board (doubts answered by seniors, moderated)
- 🌅 Club/society sign-ups

### Logistics
- ✅ Attendance visible (via parent today; student surface small add)
- 🔨 **Bus ETA + delay alerts for my route**
- 🔨 **Calendar of school events** (exams, PTMs, holidays, functions) — feed exists in spine, needs student view
- 🌅 Cafeteria pre-order (deferred plugin)
- 🌅 Sports/equipment booking

---

## 2 · PARENT — "Is my child safe, learning, and on track?"

### Today & every day
- ✅ Parent home: today card, timetable, messages
- ✅ Complaints with status tracking (built this session)
- ✅ UPI fee payment with receipts
- ✅ DPDP consent + data rights
- 🔨 **Absent-today instant alert** (the #1 parent ask: "is my child in school?")
- 🔨 **"My child today" card** — attendance + homework due + fees due + bus + any clinic visit, one glance
- 🔨 **Homework visibility + the 5pm digest** — what's due, what was missed
- 🔨 **Apply leave for my child** (sick/family function) with teacher approval status
- 🔨 **Event consent one-tap** (trip/photo/videos) with immutable record
- 🔨 **Bus ETA + delay push**
- 🌅 Fee forecast ("how much do I owe this term, month by month")
- 🌅 Sibling switcher (see all my children in one login) — *schema allows; surface missing*
- 🌅 Second-guardian visibility rules (both parents see; custody-restricted profile — sensitive, needs policy)

### Talking to school
- ✅ Parent chat (in-school, not personal WhatsApp)
- ✅ Ask the AI (school-policy questions)
- 🔨 **Announcements as notices** — see what school announced, not forwarded screenshots
- 🔨 **PTM booking** — see teacher slots, pick one, reschedule
- 🔨 **Complaint escalation visibility** — "if not resolved in 3 days it goes to the Principal automatically" (auto-escalation on SLA breach)
- 🌅 Group photo/video gallery with consent-aware sharing
- 🌅 Parent volunteer sign-ups (events, field trips)

### Money
- ✅ UPI links, receipts, ledger
- 🔨 **Due reminders + dunning ladder** (7/15/30 days, gentle tone, principal-controlled)
- 🌅 Part-payment plans / instalments
- 🌅 Sibling fee consolidation

---

## 3 · TEACHER — "Give me my time back and keep me fair"

### Every morning
- ✅ One-tap attendance + autofill from transport
- ✅ Today view: classes, substitutions, duties
- 🔨 **Homework assign in 20 seconds** — class, subject, text/photo, due date → auto digest to parents at 5pm → auto-reminder to non-submitters (never the teacher chasing)
- 🔨 **Submission inbox** — who submitted, who didn't, one tap to mark reviewed
- 🔨 **My absent-students auto-flag** (integrates the absent alert)
- 🌅 Seating chart / class layout
- 🌅 Lesson-plan templates with curriculum mapping

### Assessment
- ✅ Marks entry (audited, frozen after publish)
- ✅ Weightage-checked exam creation
- ✅ Moderation with second-person approval
- 🔨 **Class analytics after publish** — "class average, top/bottom topics, who needs help" (data exists; view missing)
- 🌅 Question-paper bank with difficulty tags
- 🌅 Rubric-based skill assessment (beyond marks)

### Duty, leave & load
- ✅ hr.leave marking + roster (office lane)
- ✅ Substitution suggestions (deterministic)
- 🔨 **Apply for MY leave from the app** (currently only office marks it) → auto duty-handover suggestion to the coordinator
- 🔨 **Duty-fairness view** — "who's been substitute-heavy this month" (auto-balanced proposals)
- 🌅 Workload dashboard (periods/week, supervision counts)

### Talking to parents
- ✅ Parent chat (in-school)
- 🔨 **Templates for common replies** (school-approved wording; nothing personal goes out)
- 🔨 **Student concern flag** — escalate a child's pattern (absence, grades drop) to counselor/principal with one tap (feeds cases)
- 🌅 Scheduled check-in notes per student

---

## 4 · PRINCIPAL — "One screen to run the school, one tap to decide"

### The morning screen
- ✅ Action Center (every kernel decision in one queue)
- ✅ Today / Attention bands
- ✅ Insights, AI governance & usage oversight
- 🔨 **Principal's brief (auto-generated 7am)** — absentees, fee dues, incidents overnight, deadlines today, AI actions needing review — written in plain sentences
- 🔨 **Fee health with dunning control** — dues by class/aging, ladder on/off, who's exempted
- 🔨 **Announcement composer** — write once → audience picker → WhatsApp+in-app+digest, receipts visible
- 🔨 **Duty fairness monitor** — auto-proposals, one-tap approval
- 🌅 Staff appraisal inputs (punctuality, duty load, parent feedback — privacy-gated)

### People & cases
- ✅ Cases board incl. parent complaints + status flow
- ✅ Visitor gate with fail-closed release + audited override
- ✅ Exams approval chain
- 🔨 **Anonymous safety box oversight** — serious reports page immediately; weekly pattern summary ("3 reports this month, Grade 8 corridor") without unmasking anyone
- 🔨 **Counselor referral flow** (teacher flags → counselor queue → outcome logged, privacy-tiered)
- 🔨 **Certificate signing** — TC/bonafide generated by office, principal approves with one tap (kernel approve-execute)
- 🌅 Discipline policy engine (consistent consequences, constitution-linked)

### Board & compliance
- ✅ CBSE rule checks + OASIS export
- ✅ DPDP consent/erasure/access
- ✅ Audit trail (hash-chained)
- 🔨 **Compliance calendar** — board returns, inspection dates, fire drill, DPDP audit — auto-reminders
- 🔨 **One-click inspection pack** (attendance + fees + safety + staff certs as a bundled PDF)
- 🌅 Multi-campus comparison (Group screen exists; deeper analytics later)

---

## 5 · OFFICE / FRONT-DESK / ADMIN — "The machine room"

### Admissions & people
- ✅ Funnel board (capture → follow-up → enroll, kernel-gated)
- ✅ People directory, PersonDetail
- 🔨 **Admission auto-follow-ups** — enquiry older than 3 days → reminder task, auto-whatsapp nudge (opt-out-able)
- 🔨 **Digital admission form + document upload** — parent fills online → lands in funnel
- 🔨 **Student ID card generator** (photo + class + QR) — print/PDF
- 🔨 **Certificate generator** — TC/bonafide/character/study certificate from real data
- 🌅 Online fee payment page for new applicants

### Front desk
- ✅ Visitor gate-pass desk (OTP release, override law)
- ✅ Reception (AI surface)
- 🔨 **Appointment booking for walk-ins** (principal/teacher slots)
- 🔨 **Phone-call log → AI receptionist** (Wave D: the deferred telephony plugin — answers, routes, books, takes complaints into cases)
- 🔨 **Late-arrival / early-departure slips** — student leaves class → parent gets notified → gate record matches
- 🌅 Courier/parcel register

### Money & stores
- ✅ Fees + UPI + Tally export + payment matching
- 🔨 **Fee dunning ladder engine** (templates, schedule, exemptions, principal-controlled)
- 🔨 **Refunds & adjustments** with approval chain
- 🔨 **Inventory** (deferred plugin start): stationery/uniform/asset issue-return
- 🔨 **Library** (deferred plugin start): issue/return, catalogue, fines auto-posted to fees
- 🔨 **PTM slot management** (office sets up; parents book)
- 🌅 Payroll inputs (attendance + duties → salary sheet export)

### Data & IT
- ✅ Data import (migration sources → stage → activate)
- ✅ Data quality board
- ✅ ItAdmin console
- 🔨 **Backup health check + download** (admin self-serve)
- 🔨 **End-of-term rollover wizard** (promote students, close terms, archive — staged like migration)
- 🌅 Bulk certificate/ID printing
- 🌅 Exam seating plan generator

---

## 6 · THE AUTOMATION SPINE (what makes all of this "automated", not just screens)

Every item above lands on the same rails that exist today — this is why the plan is credible:

1. **Kernel approval spine** — anything consequential (marks publish, enrollment, release of a child, certificate signing, escalation of a complaint) raises a decision → human approves → system executes. SoD: proposer ≠ approver, always audited.
2. **Comms rail** — every notification (absent alert, homework digest, fee reminder, bus delay, consent request) is one templated, receipted, audited send. No string-building in 20 places.
3. **Time+IST engine** — deadlines, rosters, sick-pass validity, dunning days all run on the school's clock, DST-proof.
4. **Append-only ledgers** — complaints, safety box, clinic, consent: history is never rewritten.
5. **Privacy scoping by test** — every parent/student read path is role-scoped and pinned by tests (the /my-cases lesson institutionalized).
6. **Digest engine** — one daily 5pm parent digest (homework + dues + notices) instead of 10 separate pings; one 7am principal brief instead of 5 dashboards.

---

## 7 · Build order (updated by this deep-dive)

| Wave | Items (from above) | New est. |
|---|---|---|
| **A · Daily loop** | homework + submission inbox + digest · student leave · absent alert · "my child today" · announcement composer | 12–16h |
| **B · Safety & trust** | anonymous safety box · counselor referral · event consent · bus ETA · late/early slip · PTM booking | 10–13h |
| **C · Office engine** | dunning ladder · certificates + student ID · admission auto-follow-up · digital admission form · inventory+library starts · rollover wizard · principal brief · compliance calendar | 14–18h |
| **D · Voice AI** | telephony receptionist (the deferred crown jewel) | 8–12h |

**Grand total: ~44–59 factory-hours to every item on this list.** Waves A+B alone deliver the parent/student/teacher daily promises in ~22–29h.
