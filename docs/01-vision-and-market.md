# 01 — Vision, Problem, Customer, Market

> Status: v1.0 draft. Claim labels: **[V]** verified from web (see Research Appendix in `README.md`), **[K]** training knowledge (≈2024–25, needs citation), **[I]** inference from evidence, **[D]** proposed design.
> Regulatory/legal content identifies engineering and product obligations to be reviewed by qualified counsel; it is not legal advice.

---

## 1. Executive vision

**SchoolOS is the system schools run on.** One record of every person, event, obligation, and asset in the school; one intelligence layer that turns that record into daily decisions; one operating loop (event → policy → AI reasoning → approval → action → verification → audit) that executes the routine work of the school.

The strategic claim is not "we have AI + 500 modules." It is narrower and stronger:

> Incumbent school software is a **system of record** built for compliance and reporting. The daily work of a school — the register, the fee reminder, the absent-child call, the timetable clash, the parent's "did he reach the bus?", the board report — happens **outside** any system, in WhatsApp, Excel, and paper. SchoolOS moves that work inside a system that already knows the school, and does the routine share of it autonomously under human control.

Three design bets follow (each stress-tested in Rounds C–G of the iteration log):

1. **The record is compact, not maximal.** We deliberately do not build the largest feature list. We build the smallest complete spine (people, enrollment, timetable, attendance, fees, comms, documents, workflows, decisions) and put disproportionate engineering into the intelligence and migration layers that sit on top.
2. **The parent surface is WhatsApp/SMS-first, not app-first** [D — strongest in India; SMS/email-first in US/UK]. Parents will not install a thirteenth app. The app is the deep surface; the chat is the habit surface.
3. **AI is permission-bound, citation-bound, and policy-bound.** Every AI output about a real person is grounded in tenant records with a clickable source, executed under the tenant's written "School Constitution," with an explicit AUTO / APPROVAL / HUMAN-ONLY action boundary. The product must be fully usable **with AI switched off** — AI accelerates the loop; it is never the single point of failure.

North-star outcome (measured by the product itself, not claimed in sales decks): **admin minutes eliminated per school per week**, and **time-to-live in days** from contract to a fully operating first day.

---

## 2. Problem definition — what actually happens in a school today

### 2.1 The real stack (field observation model) [I]

| Layer | India (premium private) | US district | US independent | UK state/MAT | IB/international |
|---|---|---|---|---|---|
| System of record | Aging ERP (Entab/Edunext/MCB-class) or Excel | District SIS (PowerSchool/Infinite Campus/Skyward) | Veracross/Blackbaud/FACTS | SIMS/Arbor/Bromcom MIS | SIS (Veracross/iSAMS) + ManageBac/Toddle |
| Daily comms | **WhatsApp groups** (parents, class groups, staff) | Email, ParentSquare/Remind | Email, portals | Email, MCAS-class apps | Email, portals |
| Fees | Tally + bank portal + Excel follow-up | District finance systems | FACTS/Blackbaud tuition | Bursar systems | Bursar + local rails |
| Operations | Paper registers, phone calls, biometric boxes | District workflows | Ad-hoc | Ad-hoc | Ad-hoc |
| The "glue" | **A person** (usually the admin office) | Integration team + SIS vendor | A person | MIS manager | A person |

The universal pattern: **the glue is a human being with a spreadsheet.** That person is the actual "school OS" today. SchoolOS's true competitor in every market is not the incumbent vendor — it is *the admin office's current coping system*, which is free, flexible, and understood. Any product that cannot beat "Excel + WhatsApp + effort" in the first two weeks will not be bought regardless of its feature count.

### 2.2 The four failures this creates

1. **Fragmentation:** six systems, no shared truth. The principal's Monday question — "what changed and why?" — is unanswerable. Attendance lives in one place, fees in another, the complaint about the bus in a WhatsApp thread nobody can find.
2. **Teacher burden without teacher value:** teachers are forced data-entry operators for systems that give them little back. Every product that adds teacher keystrokes gets quietly abandoned → the record decays → AI/analytics built on it are garbage. **Record quality is a teacher-experience problem before it is a data problem.**
3. **Parent distrust:** parents receive floods of untargeted messages and cannot answer the three questions they actually have: *Is my child okay? What is due? What do I owe?* [I — consistent across all markets studied]
4. **Implementation as a project:** incumbents sell licenses, then charge and delay for implementation. Schools with no IT staff cannot run a 6-month implementation. Time-to-live is the industry's dirty secret and the clearest switching lever.

### 2.3 What is *not* the problem (assumption corrections)

- **"Schools lack features."** No — schools lack *outcomes*. Every incumbent has attendance, fees, transport. Feature parity is table stakes and must not be the pitch (§ Round C, kill list in `02`).
- **"Schools want AI."** Schools want fewer fires. AI is acceptable only as invisible labor (drafting, summarizing, detecting, executing-with-approval) or visible magic (ask anything about your school, cited). Decorative AI (an AI mascot on a dashboard) is a credibility tax.
- **"One system must do everything."** Depth in accounting, payroll, LMS content, and library is *integration* territory, not build territory (build-vs-integrate table in `04`).

---

## 3. Target customers and the buying committee

SchoolOS's design must model the committee, because the committee, not the product, decides. (Per-market specifics and motion are in `05`; this section is role architecture.)

### 3.1 The six seats

| Seat | Pays? | Decides? | Blocks? | Daily user? | What wins them | What loses them |
|---|---|---|---|---|---|---|
| **Owner / Trust / Board** | Yes (op budget) | Final yes | Yes ("data leak", cost, teacher pushback) | No | Fee leakage fixed, admissions funnel, group-level control, board pack in 1 click | "Another dashboard", opex with no visible revenue effect |
| **Principal / Head** | Influences | **Champion** — the yes that matters | Yes (staff workload, "it will fail like the last one") | **Yes — daily, morning** | Morning briefing that is right; compliance safety; one place to see everything | One hallucinated number; a product that makes them do data entry |
| **Admin/Finance coordinator** | No | Influences strongly | **Yes — silently, by sabotage** (they own the current spreadsheet) | Yes | Migration done *for* them; Tally reconciliation; no double entry | Anything that demands they re-key their Excel |
| **Teachers** | No | No | Yes (adoption is theirs to give) | Yes | Time returned (5–10 min/class/day), WhatsApp-grade effort for their tasks | A 14th login; forced training; "yet another parent chat app" |
| **Parents** | No | No (but churn pressure via complaints) | Indirectly | If we win them | One trusted daily summary in their language, on WhatsApp | Spam; an app they must install to know anything |
| **IT (often 1 outsourced person in India; real dept in US/UK)** | No | Veto on security | Yes | Rarely | SSO, audit logs, export rights, no on-prem servers | On-prem install, no SSO, no data exit path |

### 3.2 Structural conclusions [I]

1. **The principal is the champion; the coordinator is the gatekeeper.** Most school software dies at the coordinator's spreadsheet. Hence: migration is a first-class product (AI Migration Engine, `04`), not a services line item.
2. **Teachers are the retention surface, parents are the reputation surface, fees are the revenue proof.** The product must visibly return time to teachers within week one, or the record decays and everything downstream (AI, analytics, renewal) decays with it.
3. **The buyer's real KPI in India is fee realization and admissions; in the US/UK it is compliance, communication, and staff time.** Same platform, different value emphasis — handled via **country/segment packs** (`04`), not forks.
4. **Churn concentrates at the academic-year boundary** (India: Mar–Jun; US/UK: summer). The product must be embedded in daily operations *before* January/February, or renewal conversations start from zero. Retention engineering is a product problem, not a CS problem.

---

## 4. Market positioning

### 4.1 Category choice [D]

Do not position as "school ERP" (commodity, price-war category) or "AI SIS" (feature of incumbents). Position as:

> **"The operating system for schools"** — the place where the school's daily operating loop actually runs, replacing *the stack*: ERP + spreadsheets + WhatsApp chaos + ad-hoc tools.

Positioning against the two incumbent archetypes:

| vs | Their identity | Their structural weakness | Our wedge |
|---|---|---|---|
| **Record vendors** (PowerSchool, Infinite Campus, Veracross, SIMS-class) | System of record for compliance/reporting | Record-shaped data model; the operating loop lives outside them; 6–18-month implementations; portals parents ignore | We *are* the record *and* run the loop; days-to-live via migration engine |
| **Point tools** (ClassDojo, ParentSquare, Teachmint-class ERPs, MagicSchool-class AI) | One job done well | Each owns a fragment; the school still glues | We are the graph they'd each need; we absorb their job as a surface, not a silo |

### 4.2 The one-sentence pitch per seat

- Owner: "Every rupee of fee leakage and every admission lead, in one place."
- Principal: "Tomorrow's problems, on your desk tonight — with the source behind every claim."
- Coordinator: "Send us your Excel; we do the migration; you stop being the glue."
- Teacher: "Ten minutes a day back, starting Monday."
- Parent: "One message a day, in your language, that actually matters."
- IT: "SSO, audit logs, full data export. No servers on your campus."

---

## 5. Competitive analysis

> Method note: competitor capabilities below are labeled per the claim-basis legend. Deep per-player detail lives in the Research Appendix (`README.md`) as delegations report back; the strategic read is stable regardless of individual feature drift, because it rests on *structural* properties (data model, deployment model, buyer) rather than feature lists.

### 5.1 Category map

| Category | Players | What they do exceptionally well | What customers complain about [K] | Structural limit |
|---|---|---|---|---|
| District SIS (US) | PowerSchool, Infinite Campus, Skyward, Focus | Scale, state reporting compliance, scheduling depth | Implementation length; UX debt; parent portal neglect; PowerSchool's Dec-2024 breach damaged trust sector-wide [V] | Built for the district buyer; per-school nimbleness impossible; AI will be bolted on as "copilot features" |
| Independent-school suites (US/global) | Veracross, Blackbaud, FACTS, Gradelink, Alma | Whole-school fit for admissions→alumni; tuition management | Switching pain; dated UX; per-module pricing | 6–12-month implementations; no AI operating loop; record-shaped like district SIS |
| UK MIS | SIMS (re-platforming under ParentPay Group [V]), Arbor (fast riser, acquired by ParentPay Group [K-verify]), Bromcom | Cloud-native challengers (Arbor, Bromcom) proved a legacy SIS market *can* be taken in ~5 years with better product + comms + MIS integration rails (Wonde) [I] | SIMS migration friction; report depth | UK-specific; proves our wedge is possible; Arbor is the existence proof to study, not fear |
| India ERPs | Entab, Edunext, MyClassBoard, Fedena, Vidyalaya, Nascorp | Price (₹30–120/student/yr typical [K]); local compliance (CBSE formats) | Form-heavy CRUD UX; weak parent apps; support quality; no intelligence; churn at year boundary | Compete on price/checklists; no record-quality flywheel; weak engineering depth |
| India "school OS" | Teachmint (pivoted hard after high burn [V-verify]), Classplus-adjacent | Speed, mobile-first, teacher tooling | Monetization struggles; feature sprawl; trust erosion after pivots | Lesson: **distribution without the record + fee layer does not retain** |
| Parent comms | ParentSquare (acquired Remind, Nov 2023 [V]), ClassDojo, TalkingPoints | Habit-level parent reach; translation depth | Not a record; school still runs SIS+comms separately | They need the graph we own; natural **partner-then-absorb** candidates |
| LMS/content | Google Classroom, Canvas, Schoology, Toddle, ManageBac | Classroom habits; IB/curriculum workflow depth (Toddle) | Fragmentation from SIS; grading duplication | **Do not fight.** Integrate; own assignments/mastery upstream of them |
| AI teaching tools | MagicSchool, Brisk, Diffit, SchoolAI, Khanmigo | Real teacher time savings; fast iteration | No school graph; copy-paste workflow; no record of effect | Threat *and* pattern-proof: AI tools without the graph stay point tools |
| Admissions CRM | OpenApply, Meritto/NoPaperForms (India), SchoolAdmin | Funnel depth | Another silo; admissions-to-SIS data re-entry | Module inside SchoolOS for the mid-market; deep competitor only at enterprise |

### 5.2 The copyability question (Round C)

If PowerSchool or Veracross decided to copy SchoolOS outright, what happens? [I]

- **They can copy surfaces** (briefing screen, copilots, WhatsApp bot) in 12–18 months. This is why surfaces are not the moat (moat ranking in `05`).
- **They cannot copy the posture:** their revenue is per-module licenses and implementation services — an AI loop that *removes* admin work attacks their own P&L. Incumbents monetize the pain we delete. This is the classic innovator's-dilemma shield and it is real but temporary (3–5 years).
- **They cannot cheaply copy the operating-loop data model:** retrofitting event → policy → approval → audit as the core schema onto a 20-year record schema is a re-platform, which large installed bases resist.
- **A well-funded startup could copy the concept in 18 months.** What they cannot copy fast: the migration corpus (schemas of 50+ real school exports), the cross-tenant policy/workflow library, local fee/WhatsApp rails glue, the eval corpus of school-specific correctness, and trust artifacts (audit track record, breach-free history). These compound with customers, not headcount.

### 5.3 Where schools still use 3+ systems (our consolidation surface) [I]

1. SIS/ERP + WhatsApp + Excel (everywhere — the big three).
2. + Tally/bank portal (India fees) → native fee ledger + reconciliation export.
3. + GPS vendor portal (transport) → integrate GPS, own the parent surface.
4. + Admissions CRM + Google Forms → native funnel for mid-market.
5. + Separate report-card maker / board-format tool (India) → generated from the record.

---

## 6. Differentiation (evidence-linked, not adjective-linked)

1. **Time-to-live in days, not quarters.** AI Migration Engine ingests Excel/CSV/legacy exports/PDF fee ledgers, maps and validates with human approval, staged import with rollback (`04`). Incumbents sell 6–18-month implementations; we make switching the *product*.
2. **The operating loop as schema, not feature.** Events, policy checks, approvals, audit are core tables. Every AI action is traceable; every surface reads the same graph.
3. **Parent surface where parents are** (WhatsApp/SMS-first [D]) with one prioritized daily digest, native language, actionable buttons — vs portals that measured parent adoption in low single digits [K, verify per-product].
4. **AI that shows its sources.** Every number in the principal's briefing links to the record; every message drafted for a parent is approval-gated. Trust is a feature.
5. **The School Constitution.** The school's rules (attendance, grading, fees, comms tone, escalation, AI limits) are first-class data that bind both automation and AI (`03`). Competitors' "AI features" have no policy substrate — and in the EU, grading/admission AI is high-risk regulated territory requiring exactly this substrate [V — AI Act Annex III; verify scope].
6. **The outcome meter.** The product measures minutes saved, response times, collection cycle — renewals justified by telemetry, not testimonials.

---

## 7. Product principles

1. **Outcome over module.** Every feature must delete measured work or measured risk; else it is integration/future/removed.
2. **The record must survive the teacher.** Capture must cost seconds (voice, tap, auto) or it will not happen, and everything downstream rots.
3. **WhatsApp-grade effort, bank-grade audit.** Friction of a chat app, accountability of a ledger.
4. **AI proposes, school disposes.** AUTO / APPROVAL / HUMAN-ONLY is enforced by the platform, not by prompts (`03`).
5. **Cite or stay silent.** Any factual claim about a person or money links to its record.
6. **Offline is a first-class mode,** not an edge case (low-connectivity schools; bus journeys; exam halls).
7. **Exit is a feature.** Full export always available. Trust compounds; lock-in without trust churns at year boundaries.
8. **Never monetize the child.** No ads, no engagement-maximizing feeds for students, no data resale, no emotion recognition on students (prohibited in education under EU AI Act Art. 5(1)(f) [V]); no tracking/behavioral profiling or targeted ads directed at children (prohibited under India's DPDP Act/Rules 2025 [V]); no facial recognition by default.
9. **One graph, many skins.** Country/board/segment packs change vocabulary, formats, rails, and compliance fields — never the core schema (`04`).
10. **Calm beats comprehensive.** Screens answer: what's happening, what matters, what next. Dashboards are destinations, not homes.

---

## 8. The wedge decision (the single most consequential choice)

Options considered in Round B/D, scored on sales cycle, regulation, WTP, competition, AI receptivity, access, and expansion path:

| Option | Verdict | Reasoning |
|---|---|---|
| US districts | **No (later via partners)** | RFP-locked, Ed-Fi/OneRoster/procurement machine, 6–18-month cycles, incumbency; a startup cannot afford this as market #1 |
| US independent schools | **Second market** | Real WTP ($10–40k+/yr [K]), switching happens, but crowded (Veracross/Blackbaud/FACTS/Alma) and requires US presence; enter after IB pack + references |
| UK state/MATs | **Third** | Arbor/Bromcom prove challengers can win, but DfE/MIS rails (Wonde) and MAT procurement need local presence; strong *later* |
| IB/international schools (incl. India's IB/Cambridge schools) | **Yes — from day 1 as a segment** | High ACV, English-first, curriculum-pack-shaped, existing pain (ManageBac fragmentation [K-verify]); doubles as the global beachhead |
| India budget schools | **No** | Price war, ₹20–40/student/yr anchors, churn; unit economics poison |
| **India premium private schools + multi-campus groups** | **Primary wedge** | Thousands of schools with real budgets (₹5–25L/yr software [I]), acute pains we nail (fees, WhatsApp comms, admissions, board compliance, multi-campus control), weak product competition (CRUD-era ERPs), founder-led sales feasible, admission-season decision cycle, and the world's largest private-school market as the cost base and story |

**Wedge statement:** *Win 3,000-student-class premium day schools and 5–20-campus groups in 3–5 Indian metros with the fee-fee-fee + WhatsApp + morning-briefing loop; add IB/Cambridge pack to take international schools in the same cities; carry those references into US independent and UK markets in year 3.*

This inverts the default "start in the US because WTP" instinct. Counter-consideration, honestly stated: India WTP is structurally lower and price pressure is real; the answer is not lower price but **higher observed ROI** (fee leakage + admissions + staff time) and group-level contracts that push ACV to $10–80k equivalent, with India's cost base making those margins work.

---

## 9. Assumptions challenged (Round C record)

| Original assumption | Verdict | Replacement |
|---|---|---|
| "Unified platform connecting everything" (23 domains in the brief) | Rejected as v1 scope | Compact spine + pack/integration boundaries (`04` build-vs-integrate) |
| 14 named AI agents | Rejected | 6 role copilots + headless workers on one orchestration core (`03`) |
| Digital twin as flagship | Rejected for v1 | 2D campus canvas in V2; no 3D |
| Simulation engine as differentiator | Deferred | Three scoped what-if solvers in V2 (enrollment, fees, absence) |
| Students will use a portal voluntarily | Partly rejected | Students get value in chat + mastery surfaces tied to real coursework; no social feed (safety) |
| AI tutor as headline feature | De-prioritized for MVP | World's best *teacher* copilot first; tutor is V1 — tutor quality depends on curriculum data we only get after the record is live |
| Parent app | Reversed | WhatsApp/SMS-first; app = deep surface |
| "AI-native" as pitch | Reversed | "Runs your school" is the pitch; AI is the how |

---

## 10. Stress-test matrix (Round F)

| Environment | Fit | Required adaptation | Verdict |
|---|---|---|---|
| Tiny private school (≤300) | Good | Self-serve onboarding, starter tier, floor pricing, WhatsApp-only parent surface | Passes; no architecture change |
| Large private school (2,500–5,000) | **Primary wedge** | None — this is the design target | Passes |
| Public school (US district model) | Poor (by design, until V3+) | Ed-Fi/state reporting, procurement, union/staff dynamics — gated out of early scope | Deferred with explicit gate |
| School district (multi-school US) | Poor until V3 | Same as above + district-level tenancy | Deferred |
| International school | **Strong** | IB/Cambridge pack; English-first; higher ACV | Passes; second segment from day 1 |
| Multi-campus group | **Strong** | Group console, campus-scoped permissions, consolidated board packs, cross-campus benchmarking | Passes; V1 tier |
| Low-connectivity school | Partial (honest) | Offline-tolerant critical paths only (`04` §9); no promise of full offline ERP | Passes with scoped claims |
| Highly regulated environment (EU AI Act posture) | Good architecturally | Policy engine drives AI modes; risk-management files; 2 Aug 2026 conformity prep [V] | Passes with counsel caveat |
| India | **Primary** | Fee rails, WhatsApp/DLT, board formats, Hindi+vernacular digests, price discipline | Passes |
| United States | Later (independent first) | SOC 2, SDPC NDPA pre-sign [V], COPPA/PPRA/FERPA modes [V/K], M365/Google depth | Sequenced, gated |
| United Kingdom | Later | Wonde-class MIS rails, DPIA pack, Children's Code defaults [V], UK residency | Sequenced, gated |
| IB/Cambridge environments | Strong | Curriculum packs; transcript formats; ManageBac/Toddle coexistence (integrate, don't fight) | Passes |

Cross-cutting finding [I]: the only environment that forces a *different architecture* (not just packs) is the US district, which is exactly why it is sequenced last with hard gates — the compact-spine decision would be compromised by Ed-Fi-era schema requirements if it were allowed to influence the core model now.
