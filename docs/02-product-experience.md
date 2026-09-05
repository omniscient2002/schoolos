# 02 — Product Experience, Roles, Journeys, Feature Architecture

> Claim labels: **[V]** verified web, **[K]** training knowledge, **[I]** inference, **[D]** proposed design. Companion: `03-intelligence-layer.md` (how the surfaces get their intelligence), `04` (platform), `05` (business).

---

## 1. The interaction model — ten verbs, not forty modules

Primary navigation is role-scoped and contains at most these concepts [D]:

| Surface | What it is | Home for |
|---|---|---|
| **TODAY** | The operating picture for this person, this day | Everyone |
| **ATTENTION** | Ranked items needing a human; each with evidence + one-tap action | Everyone (staff) |
| **ASK** | Natural-language question over the school graph, cited answers | Everyone (permission-scoped) |
| **NEXT** | The single recommended action queue (approve/release/send/plan) | Staff |
| **PEOPLE** | Student/staff/parent records — the graph's human front | Staff |
| **LEARNING** | Classes, assignments, mastery, assessments | Teachers/students |
| **OPERATIONS** | Fees, admissions, transport, campus, documents, workflows | Admin roles |
| **INSIGHTS** | Trends with "why" drill-downs and assumptions shown | Principal/owner |
| **AUTOMATION** | Workflow builder (visual + natural language), approval inbox | Principal/coordinator |
| **MEMORY** | Decision log, meeting intelligence, document search | Leadership |

Every screen must answer, in order: **What is happening? What matters? What should I do next?** Evidence and action are one tap apart; nothing important is more than two taps from its source record.

### 1.1 What is deliberately absent

- No top-level "dashboard graveyard": dashboards exist inside INSIGHTS with drill-downs, never as landing pages.
- No forced module tree. Traditional modules (Fee Plan Editor, Transport Route Designer…) exist under OPERATIONS for power users; the daily loop never requires them.
- No student social feed, no engagement-streak mechanics for minors (safety + principle 8 in `01`).

---

## 2. User roles and permission philosophy

**Roles are bundles of capabilities over the graph, enforced at the data layer** (RLS + permission middleware; see `03` §5, `04` §6). Personas: Student, Guardian, Teacher, Class Teacher (superset), Subject Coordinator, Grade Head, Principal/Head of School, Vice-Principal, Admin Office, Finance, Admissions Counselor, Transport In-charge, HR-lite, IT Admin, Owner/Trustee (multi-campus), District/Group Admin, SchoolOS Support (zero-knowledge-by-default; support access is granted per-incident, time-boxed, and logged — "break-glass" model).

Cross-cutting permission rules [D]:
1. Every record access, every AI query, every automated action is logged to the immutable audit ledger with actor, scope, and reason.
2. Support staff see *metadata and deltas*, never student content, unless a school admin grants a time-boxed grant.
3. Guardians see their children only; co-parenting configurations (restricted guardians, court orders) are first-class data, not annotations.
4. Students' sensitive questions to AI (health, abuse, mental-health) trigger the **Sensitive-Query Shield**: content is never exposed to staff feeds; only aggregate wellbeing signals and, on crisis classifiers, a human-counselor routing protocol fire (`03` §9).

---

## 3. Role experiences (the seven surfaces that matter)

### 3.1 Principal — the Command Center

The principal's day is triage under interruption. The product's flagship surface is the **Morning Briefing** (delivered 6:00–7:30 AM as push + WhatsApp + web):

1. **One screen, four bands:** *Needs you* (decisions with deadlines: leave conflicts, discipline escalation flagged by policy not by AI judgment, fee escalations past policy threshold), *Changed overnight* (absence spikes, incidents, failed payments, transport deviations — each with delta + cause + source link), *Today* (calendar-critical items: exams, events, inspections, board items), and — v2.0 — *Coming due* (the **"Tomorrow" forward band**: obligations, case SLA breaches, coverage gaps and calendar clashes computed 7/30 days ahead, each pre-opened as a case or proposal; `06` §11).
2. **Every claim is clickable to its record.** "Class 8-B absence 23% vs 6% baseline [view register]" — no unverifiable numbers, ever.
3. **Ask** is the principal's real interface: "Why are 8-B absences up?" → the system traces: register events → transport route deviation → bus 14 breakdown Tuesday → unresolved parent complaints thread. It shows the chain with dates; it says "I don't have data on X" when it doesn't.
4. **Proposals, not autopilot:** briefing items carry a proposed action (send note to 8-B parents, open substitute workflow, schedule counselor check-in) that the principal approves, edits, or dismisses — and every dismissal teaches the ranking model (per-tenant preference data, never shared raw).
5. **What-if:** from any anomaly: "simulate adding a section to 8" → scoped solver run with assumptions shown (`03` §10).

Why principals will not churn once habitual [I]: the briefing is the first thing they read; it replaces the morning WhatsApp scroll + coordinator huddle; its accuracy is auditable — the trust contract is explicit.

### 3.2 Teacher — the copilot that returns time

Design law: **no feature may add a keystroke without returning five.**

Daily loop, target ≤10 minutes total device time [D]:
1. **Attendance in 15 seconds:** seating-chart tap with yesterday pre-filled; or "everyone present except…" flow; offline-capable (PWA queue + sync).
2. **Class note (voice-first):** teacher speaks 20 seconds after class ("covered photosynthesis intro, three students weak on the equation, Riya's parent asked about test dates") → transcribed → structured: lesson log entry, mastery observations proposed, parent follow-up drafted. **Nothing sends without a tap.**
3. **Assignments:** create from curriculum unit; AI drafts the sheet/rubric from the unit + past artifacts; teacher edits; publish to class + parent digest.
4. **Grading assist:** rubric-anchored suggestions, batch feedback drafted per student from their actual submissions; teacher approves/edits in a review grid; final marks always human-submitted where policy requires (learning-outcome evaluation is high-risk regulated AI — EU AI Act Annex III(3)(b), applying from 2 Aug 2026 [V]; assist-only mode enforced per policy pack).
5. **Parent messages:** drafted in the parent's language, tone from the School Constitution; approval to send; logged on the relationship timeline.
6. **Substitute pack:** one tap generates the cover plan (today's lessons, seating, allergies/medical flags, duties) for the substitute.

Anti-bloat commitments: no lesson-marketplace socialism, no forced reflection journals, no PD gamification at v1. Lesson planning AI is available inside assignment creation, not as a separate silo teachers must feed.

### 3.3 Student — usefulness without a feed

Students use chat surfaces (school-controlled, audited, no DMs between students at v1) and focused surfaces [D]:

1. **My Day:** timetable now/next, due work, feedback received, fee/permission items for parents (routed to guardian).
2. **Mastery view:** subject → units → skills; honest state ("secure / developing / not yet") fed by assessments and teacher observations — **never a ranked leaderboard**; progression vs self.
3. **Study companion (V1):** practice generated from their actual class material + their mistake patterns (error-type taxonomy: careless, conceptual, procedure); explains with curriculum-aligned steps; **never gives final marks or predicts futures**; exam-prep mode builds a plan from the real syllabus and their mastery gaps.
4. **Portfolio & achievements (V1):** artifacts, projects, certificates, competitions — the seed of the portable **Skill Passport** (V3, student-owned export).
5. **Ask (scoped):** questions about their own work, school logistics, study help. Peer-data requests are permission-denied by design.

What was removed from the brief and why: career-explorer and scholarship discovery (V3, partner content — accuracy liability too high for v1), gamified XP (adolescent cynicism + equity concerns), anonymous peer social (moderation liability at minor scale).

### 3.4 Parent — one message that matters

**The chat surface is the product.** [D — WhatsApp Business API in India; SMS+email+push in US/UK]

1. **Daily digest (only when there is something):** child attended / absent with reason, work due, feedback worth reading, fee due with pay button, permission slips with approve button, transport status deltas. Prioritized; capped; in the guardian's language (auto-translated, human-reviewable for templates).
2. **Ask:** "Is the bus late?" "What did Aarav score in the math test?" "Can we meet the class teacher?" — answered from the graph; beyond-scope intents (complaints, disputes) **auto-open a case with SLA** (v2.0: cases are system-raised; staff confirm and close, never transcribe).
3. **Money:** fee statement, installments, one-tap pay (UPI/card/netbanking), receipts; never shaming language; dunning follows the school's policy pack.
4. **Consents & appointments:** trip approvals, PTM booking, document requests — self-serve, logged.
5. **Multi-child:** one thread per child under one guardian identity; settings: which events push vs digest vs silent.

6. **Data verification by conversation [D]:** the dirtiest data in every school is guardian contact/pickup/medical-consent data. The digest doubles as a verification loop — "Reply 1 to confirm Saturday's trip consent for Aarav" / "Who is authorized for pickup?" — so the parent surface *repairs* the record instead of merely consuming it. Verified fields are badged in the record; this also feeds the DPDP consent trail [V].

Explicit non-goals: no parent-to-parent social, no public class galleries without school-controlled consent per child (media consent is policy-pack data), no advertising ever.

### 3.5 Admin/Coordinator — the de-stressed operator

1. **Migration console** (the trust-builder at sale): watch the AI Migration Engine map their Excel; approve the diff; go live (`04`).
2. **Daily queue:** admissions follow-ups, fee reconciliation exceptions, leave approvals, document requests, transport changes — ranked, bulk actions.
3. **Fee operations:** plans, concessions, sibling/transport bundling, installments, payment links, defaulter worklist *with policy-safe tone presets*, Tally/Zoho export that reconciles to the paisa [D].
4. **Records:** every edit audited; bulk fixes with preview+undo; guardian data changes trigger parent confirmation flows (data hygiene as a workflow, not a hope).
5. **Bulk grid + reconciliation (v2.0):** spreadsheet-grade bulk editing (paste, validate, preview, undo) and continuous reconciliation queues — payment-gateway/Tally diffs surfaced with source, severity, suggested resolution, and one-tap closure. These close the two workflows where v1 lost to Excel+Tally (`06` §6).

### 3.6 Owner/Group — the P&L view

Group console: per-campus KPIs (enrollment vs capacity, fee realization %, admissions funnel conversion, staff absence cost, collection cycle days), consolidated board pack generator (one click, cited appendix), cross-campus benchmark deltas, expansion simulation hooks (V2 solver). The owner surface is deliberately small: money, growth, risk, people-cost.

### 3.7 IT Admin

SSO (Google/Microsoft), SCIM-style provisioning hooks, API keys with scopes, webhook subscriptions, audit export, data residency display, backup status, "export everything" button (trust), AI controls: model region pinning, feature toggles, opt-outs — the school governs its AI (`03` §8).

---

## 4. Golden journeys (end-to-end, with the loop visible)

1. **Absent child → parent informed in 90 seconds:** register marked → event → policy ("notify guardian within 15 min of first period") → auto (AUTO class) → WhatsApp/SMS with reply-to-explain → reply classified → teacher follow-up drafted → class teacher approves → logged. *No human initiated this; a human approved the one judgment step.*
2. **Fee default cluster → owner-visible recovery:** payment failure events cluster on Route 7 families → finance worklist → digest with pay link to affected guardians → 60% pay in 48h → remaining escalate per policy after human review. 
3. **Teacher absence at 6:40 AM → covered by 7:15:** leave event → policy finds substitution rules → candidate list ranked by load/subject → AP war-room: coordinator approves → substitute gets pack → affected classes' parents get a calm note (if policy says so).
4. **New school onboarding in ≤7 days:** sign → migration console ingests their Excel/legacy export → coordinator approves mapping → invite via WhatsApp links (guardians onboard by replying to the first digest) → first attendance taken → first briefing lands. (`04` §3 details.)
5. **Exam season:** schedule published → clash-checked → admit cards generated (policy: fees-cleared rule surfaces as *recommendation*, human decides exceptions — never auto-blocks a child from an exam) → marks entry with assist → board-format report cards generated → parent digest summarizes honestly.

---

## 5. Feature architecture — the honest classification

Classification: **CORE** (v1 must), **IMPORTANT** (v1–v2), **OPTIONAL** (v2+ or segmented), **INTEGRATION** (never build deep), **FUTURE** (v3+), **REMOVE** (killed).

| Domain | Verdict | Notes |
|---|---|---|
| Identity, tenancy, permissions, audit ledger | CORE | Platform bedrock |
| People/enrollment/guardianship graph | CORE | Includes restricted-guardian handling |
| Timetable (grid, conflicts, substitutions) | CORE | Solver-grade AI timetabling is V2 |
| Attendance (seating chart, offline, auto-flows) | CORE | Hardware = INTEGRATION |
| Fee ledger + payments + reconciliation | CORE | The owner's purchase driver (India wedge) |
| Parent comms: WhatsApp/SMS digests + reply automation | CORE | Rails per country pack |
| Teacher copilot (notes, drafts, grading assist, sub packs) | CORE | The retention surface |
| Principal briefing + Ask + approval inbox | CORE | The champion surface |
| Assignments + gradebook + report cards (board formats) | CORE | Report card generator is high-value India wedge item |
| Admissions funnel (inquiry→enroll) | IMPORTANT | Competes with Meritto/OpenApply at edges; mid-market depth |
| Automation builder (visual + NL) + policy engine | IMPORTANT | Constitution onboarding in v1; full builder v1.5 |
| School Memory (decisions, meetings, doc Q&A) | IMPORTANT | High differentiation, moderate effort |
| Transport ops + parent ETA (GPS = INTEGRATION) | IMPORTANT | India-standard expectation |
| Analytics/INSIGHTS with drill-down | IMPORTANT | Warehouse-grade marts in v2 |
| HR-lite (staff records, leave) | IMPORTANT | **Payroll = INTEGRATION** (Zoho/GreytHR/Keka-class) |
| Learning intelligence (mastery, misconception, item analysis) | IMPORTANT | Depth grows with data; tutor V1 |
| AI tutor / study companion | IMPORTANT (V1) | After record quality exists |
| Documents (capture, classify, retain, expire) | IMPORTANT | Feeds Memory; DMS-lite |
| Campus ops (2D canvas, rooms, inventory) | OPTIONAL (V2) | 2D only; no 3D twin |
| Simulation (3 scoped what-ifs) | OPTIONAL (V2) | Enrollment, fees, absence coverage |
| Health/counseling records | OPTIONAL | Highest-sensitivity schema; separate store, stricter access |
| LMS content authoring | INTEGRATION | Google Classroom/Teams/Toddle connect |
| Accounting, payroll, biometrics, GPS, IDP, video | INTEGRATION | Connector framework |
| Marketplace | FUTURE | After connector demand proves pull |
| Skill Passport (portable student credential) | FUTURE | Student-owned export, verifiable format |
| District/state reporting (US Ed-Fi etc.) | FUTURE | Gate for US district market only |
| 3D digital twin, gamified XP, student social feeds, emotion AI, facial-recognition attendance defaults | **REMOVE** | Cost/risk/trust-negative (see `01` §9) |

**Bloat gate (every PRD):** name the outcome metric it moves (minutes saved, cycle time, retention driver, revenue driver, moat contribution); if none, it goes to FUTURE or dies.

---

## 6. The demo-realistic MVP experience

The MVP (12-week build; full definition in `05`) supports exactly these golden journeys end-to-end: onboarding/migration, attendance + absence loop, fee ledger + WhatsApp payment links, teacher copilot basics, principal briefing + Ask, parent digest. Everything else is behind flags. The experience bar: **a school runs its first full day on SchoolOS within 7 days of signing, with zero rows typed by the school staff beyond approvals.**

---

## 7. Deliberately-thin domains — each keeps one loop, not a module

These domains exist in the brief and in schools, but building them "fully" is how school ERPs bloat. Each keeps the single loop that earns its place; everything else is integration or future [D].

| Domain | The one loop that earns its place | Explicitly not built |
|---|---|---|
| **Finance (school-side)** | Fee obligation → payment/link → receipt → reconciliation exception → escalation per policy | General accounting, payroll, budgeting (integrate Tally/Zoho/QuickBooks) |
| **Admissions** | Inquiry → follow-up (AI-drafted, human-sent) → visit/interview → decision (HUMAN-ONLY) → enrollment conversion (auto-creates the record) | Full CRM marketing automation; call-center dialers; lead scoring on minors (prohibited-class profiling) |
| **Transport** | Route/stop roster → live deviation alert (GPS integrated) → parent ETA delta → incident workflow | Fleet maintenance, driver payroll, route optimization research (V3 at best) |
| **HR** | Staff record → leave → substitution fit → workload balance | Payroll, recruitment funnels, performance reviews (integrate; reviews are future) |
| **Library** | Circulation event (borrow/return/fine) surfaced in digest + mastery context | Cataloging depth, acquisitions (integrate or partner; most schools have a legacy system) |
| **Campus ops** | Room/asset registry → utilization view → booking conflicts → maintenance tickets | 3D twin, IoT sensor fusion, energy management (2D canvas V2 covers 90% of value) |
| **Communication** | Event → policy-filtered → channel (WhatsApp/SMS/email/push) → delivery receipt → reply classification → task | Parent-to-parent social, class public feeds, bulk marketing |
| **Documents** | Capture → classify → expire/renew (certificates, licenses, consents) → citable in Ask/Compliance | Full DMS workflows, e-signature (integrate), OCR-heavy archival |

Design rule for all eight: if a domain's loop cannot demonstrate value in the first two weeks after onboarding, it ships later.
