# School OS 2026 — Evidence-Driven Product Strategy for Indian Schools

> Date: 2026-10-04 · Role: product strategist + edtech researcher + SaaS architect + UX researcher + India school-ops expert.
> Evidence base: NEP 2020 + NCF-SE 2023 implementation record; CBSE affiliation bye-laws + May-2026 MPD crackdown + Class-6 R3/OASIS directive; UDISE+ 2025-26 scale data; RTE §12(1)(c) 2026 litigation + state portals; Parliament fee-clarification (Aug 2026); Maharashtra school-bus amendment 2026; NCPCR/MoE safety manuals; competitor marketing + docs + Play Store reviews (MyClassBoard 3.8★/59.9K, Fedena 3.6★, Teachmint, Pathsala comparison 30-Aug-2026, EduGradUP/Pro-ERP/ESMS pricing pages); adoption-failure reporting (Careers360 Dec 2025, ToI, SchoolCues 2026); WhatsApp-vs-app analyses (Campus24x7, Ether, Relay, EdPayU, Vidyom); current SchoolOS codebase + browser-verified behavior (hands-on, Oct 2026).
> Grading used throughout: **[F]** verified fact · **[P]** strong pattern across sources · **[A]** anecdotal · **[H]** product hypothesis to validate.
> Likely target market assumed (state it plainly): **private unaided CBSE/State-board day schools, ₹20k–₹60k/year fees, 300–2,000 pupils, urban + tier-2 (Pune-like)** — NOT ₹1L/yr international schools, NOT government schools. Where needs diverge by segment, §2 says so.

---

## 1. Executive Summary — the 10 conclusions that matter

1. **The product's foundation is unusually strong and should be protected.** Tenancy-isolated data model, atomic audit+event writes, role-truth from the server, honest empty states, lifecycle-gated plugins — competitors with 40+ modules routinely fail exactly here (fee paid but not reflecting **[P]**, duplicate/delayed notifications **[P]**, silent permission failures). Do not trade this for feature velocity.
2. **You are missing the three things schools buy software for.** Payroll + bank/ECS salary proof (CBSE affiliation requirement) **[F]**, RTE/EWS quota + reimbursement tracking (SC "national mission", states owe thousands of crores) **[F]**, and MPD compliance (CBSE surprise inspections since May 2026) **[F]**. None exist in the product. This is the single biggest gap.
3. **Parents will judge you on one screen: money + absence + bus on their phone.** Competitor reviews prove parent apps live or die on push reliability, fee reflection speed, regional fonts, and load time **[P]**. You have no parent mobile app, no push, no i18n — the parent plane exists only as web screens. This is gap #2.
4. **WhatsApp is the product, not a channel.** 90–95% parent engagement on WhatsApp vs 15–30% on school apps **[P]** (vendor claim, directionally consistent with review complaints about dead school apps). Your rails are logger-sandbox stubs. Real BSP wiring with DLT templates, delivery/read receipts, failover to SMS, and a shared office inbox is a must-have, not a nice-to-have.
5. **Teachers don't hate software — they hate double work.** The adoption killer is data re-entry across SATS/UDISE/DIKSHA/MDM portals **[P]** (Careers360), surveillance-feeling attendance apps (10% adoption in Indore despite salary threats **[F]**), and slow/buggy apps **[P]**. Your 10-second register + owned-class authority + honest 403s are exactly right; the threat is adding teacher-facing features that cost them minutes (exam marks entry UX, timetable editing, substitution review must all be sub-minute).
6. **Your "AI" posture is correct and should stay boring.** Deterministic copilots with budgets and approval gates — competitors' AI (timetable gen, face attendance, predictions) is either unproven or creepy. Build AI only where a human approves and the answer cites records. Explicit avoid-list in §11.
7. **NEP alignment is a sales weapon, not pedagogy charity.** 360° Holistic Progress Cards, 5+3+3+4 stages, FLN/NIPUN tracking, Class-6 third-language/OASIS compliance (deadline passed May 2026 — schools are non-compliant *now*), SAFAL-style competency tagging, bagless days, art-integration records. None exist in-product. CBSE schools need these for affiliation-period conversations.
8. **Transport law just changed under you.** Maharashtra's 2026 bus amendment (fares/km, boarding timestamps, attendants, real-time traceability, quarterly compliance reports) makes your GPS-positions-only module non-compliant as a compliance story. The upgrade is well-defined (§13).
9. **Pricing must be flat and published.** Market: ₹5k–₹50k/yr, per-student ₹25–300; winners publish flat bands (₹9–24k) with WhatsApp/SMS as metered add-ons **[F]**. Your entitlement/plan scaffolding exists (`trial/core/operations/campus/compliance/rails`) but `trial`=everything-forever — wire it before someone asks what anything costs. Recommended: flat bands + metered comms.
10. **Remove almost nothing — but hide plenty.** The product is lean, not bloated. The real problem is *presentation*: demo narratives on real schools, always-on advanced screens for 300-pupil schools, and a mobile tab bar that buries Fees/Library/Insights. Presets + progressive disclosure (§8–9), not deletion — except the demo-seed content, which should die.

---

## 2. Indian school market overview (segments that matter for you)

| Segment | Size/fee reality | Operating truth | What they need from software |
|---|---|---|---|
| Private unaided CBSE, urban/tier-2, 300–2,000 pupils **[TARGET]** | ₹20–60k/yr; fee faces state regulation + SMC process | Office of 3–8 non-technical staff; principal is academic + compliance officer; WhatsApp runs the school | Fees+receipts+reminders that reconcile; attendance parents trust; CBSE/UDISE/RTE compliance without consultants; parent app that actually notifies |
| Budget private (<₹20k), tier-2/3 | thin margins; one clerk doubles as everything | Price-sensitive (₹5–15k/yr software); Hindi/regional UI decisive | Flat cheap pricing, Hindi UI, offline-tolerant attendance, WhatsApp-first comms |
| Premium/international (₹1L+) | can pay ₹50k+/yr + per-student | Expect LMS, skill electives, transport tracking, parent concierge | Your product is under-featured here (no LMS depth, no electives engine) — do NOT chase first |
| State-board (Maharashtra SSC etc.) | board exams + government portals dominate | Need board-specific report cards, scholarship trackers, RTE portal sync | Board-pack variants per board; scholarship/reimbursement ledgers |
| Government schools | DIKSHA/SATS/UDISE/MDM portals mandatory; near-zero software budget | Teachers drown in duplicate data entry **[P]**; connectivity poor | Not your buyer — but your UDISE export + offline attendance patterns matter for credibility |
| Large groups (5+ branches) | trust/society HQ + per-school ops | Group roll-ups, per-school drill-down, central admissions | Your `/group` exists — strengthen into HQ dashboard; per-school billing bands |
| Telangana/AP specifics | regional portals, Telugu expectations, local ERP incumbents (e.g. MyClassBoard is Hyderabad-based) | Telugu font rendering is a *shipping* issue (reviews show boxes, not glyphs) **[F]** | Bundle Noto Sans Telugu/Tamil/Kannada etc. from day one; test on ₹8k Android phones |

---

## 3. The top 20 real operational problems (ranked)

Ranked by frequency × severity × solvability. Basis in brackets.

| # | Problem | Who bleeds | Evidence | Software solvable? |
|---|---|---|---|---|
| 1 | Fee collection leakage: dues unclear, reminders manual, receipts disputed, paid-but-not-reflecting | office, parents | Reviews: Fedena fee-reflection complaint (16 helpful) **[P]**; fee-reminder automation claims +40% collection **[A]** | **Yes — #1 ROI** |
| 2 | Parent communication chaos: WhatsApp groups noisy, no read proof, circulars lost, numbers exposed | office, parents | 400–500 pupil threshold where groups break **[P]**; "No Messages" + hour-late duplicates **[P]** | Yes — receipts + roles + WhatsApp API |
| 3 | Teacher data-entry burden across government + school apps | teachers | Careers360 multi-portal reporting **[P]**; "teaching between reports" **[P]** | Partially — kill *your* duplication; prefill everything |
| 4 | Attendance disputes (wrong date, proxy, no audit) | teachers, office | Wrong-date upload = week of explanations **[A]**; 10% app adoption under threats **[F]** | Yes — 10-sec register + per-change audit + corrections flow |
| 5 | Admission season overload: enquiry leakage, no follow-up, paper files | admissions staff | Funnel analytics absent in most small schools **[H]** | Yes — lightweight CRM, not Salesforce |
| 6 | Substitution chaos (leave → who covers 3-A?) | coordinator, teachers | Daily 7am scramble in every school **[P]** (domain knowledge) | Yes — suggest + one-tap approve |
| 7 | Timetable clashes + room/lab conflicts | coordinator | Constraint pain universal **[P]** | Yes — conflict detection first, generation second |
| 8 | Exam marks errors → report-card reprints | teachers, office | Weightage + totaling mistakes **[P]** | Yes — entry guards + weightage enforcement (you have it) |
| 9 | RTE/EWS paperwork + reimbursement arrears | office, owners | ₹2,930cr owed in Maharashtra alone **[F]** | Yes — quota + waiver + reimbursement ledger (missing!) |
| 10 | Compliance scramble (affiliation/MPD/UDISE/OASIS deadlines) | principal, owner | May-2026 MPD crackdown + penalties **[F]** | Yes — compliance center with expiry alerts (missing!) |
| 11 | Transport safety + parent "where is the bus" calls | transport, parents | 2026 bus law answers with timestamps + traceability **[F]** | Yes — map + ETA + boarding log |
| 12 | Visitor/pickup security gaps | reception, parents | POCSO-climate news cycle **[P]** | Yes — OTP pickup (you have it) + police-verification tracker |
| 13 | Staff salary proof for affiliation (bank/ECS) | owner, accounts | CBSE bye-laws: salary via bank, no cash **[F]** | Yes — payroll (missing!) |
| 14 | Homework black hole (assigned → never seen/submitted) | teachers, parents | Review complaint pattern: parents can't see homework **[P]** | Yes — post once, submit once, inbox triage (you have it) |
| 15 | PTM scheduling ping-pong | teachers, parents | Manual slot coordination **[H]** | Yes — publish slots → book (you have it; needs parent-app surface) |
| 16 | Certificate/TC issuance delays | office, parents | Manual drafting per pupil **[P]** | Yes — templates + e-sign + DigiLocker (partial: you sign, no DigiLocker) |
| 17 | Duplicate records (two "Aarav Sharma"s, double admission nos) | office | Roster confusion **[P]** | Yes — you already refuse both (P2-5/P2-8; genuine differentiator) |
| 18 | Notification fatigue + wrong notifications | parents, teachers | "Bombarded all day" **[P]**; wrong-audience sends | Yes — audience scoping + quiet hours + per-topic control (mostly present) |
| 19 | Report-building labor (one person + Excel, per PowerSchool testimonial) | management | "Allocate one person to go through all data" **[A]** | Yes — live summaries, not exports (you do this) |
| 20 | ERP switching churn (slow, buggy, English-only, no support) | owners | 3.6–3.8★ incumbents; Hindi-boxes + slowness + dead notifications **[P]** | Yes — speed + fonts + Hindi + WhatsApp support channel |

---

## 4. Competitive landscape (what users love/hate, where the gap is)

| Product | Best | Weak / hated **[P]** | Target | Price position | Opportunity for SchoolOS |
|---|---|---|---|---|---|
| MyClassBoard (Hyderabad; 1M+ downloads, 3.8★/59.9K) | breadth, school-specific white-label apps | **No push; Hindi/Telugu boxes; slow/crashes; duplicate+hour-late notifications; tiny unzoomable text; leave-apply bug** | mainstream private | mid | Reliability + fonts + honest notifications is an open goal |
| Fedena (40k institutes, 3.6★) | 50+ modules, 7+ integrations, push | **paid-but-not-reflecting fees; no support contact; update broke app; notification→infinite loading** | large/standardized | ₹40k+/yr | Money-integrity + support that answers |
| Teachmint | ease, support, demos beat 8–10 rivals; LMS+ERP blend; AI homework/quizzes | online-test crashes; weak search/uploads | digital-learning schools | unpublished (enterprise) | Simplicity + deterministic AI without the crashiness |
| Entab/CampusCare | CBSE-chain depth, English-first polish | costly; per-student add-ons | CBSE chains, large | ₹35k+/yr | Flat pricing + Hindi + free migration |
| LEAD | measurable English/Maths/Science outcomes, owner app, lesson kits | pedagogy lock-in, pricey, outcomes claims debated **[A]** | outcome-seeking owners | premium | Don't fight outcomes; win operations + NEP evidence |
| Edoovi/Schoollog/Micron/Pathsala | GPS+ETA, fee PIN, driver photo, diary+signature, Student 360, Hindi-first, flat ₹9–24k, open pricing | smaller support orgs; depth varies | budget–mid | ₹5–24k flat | Match table stakes (PIN, diary, 360, Hindi), beat them on audit/roles/tenancy honesty |
| EduGradUP | 43 modules flat ₹9–23k, Hindi-first, offline Android, WhatsApp built-in | new/small vendor risk **[A]** | budget-conscious any size | cheapest flat | Same playbook + your superior architecture (isolated DB, hash audit) |
| Relay/Vidyom (comms specialists) | WhatsApp-first, read receipts, shared inbox, failover | point solution, not ERP | comms add-on | per-message | Either integrate or copy the pattern: receipts + inbox + templates |

**Commodity** (must-have, no differentiation): attendance, fees+receipts, exams+cards, timetable grid, SMS, library circulation, basic reports.
**Missing across market** (your openings): MPD center, RTE ledger, payroll+ECS proof, NEP/HPC evidence, transport compliance reports, honest notification receipts, duplicate-proof roster, per-school isolated data story.

### 5.2 Verdicts
- **Good (protect)**: tenancy/RLS, atomic audit+events, auth incl. force_change/step-up, owned-register attendance + per-change audit, fee money invariants + idempotent generate, duplicate-proof roster, visitor OTP, DPDP ledger, SoD + HUMAN-ONLY safeguarding, honest empty states, import honesty, open API keys.
- **Weak (redesign)**: fees last mile (gateway→parent-pay→PIN→dunning), comms (logger→BSP+receipts+inbox), transport (positions→compliance system), parent experience (web→app+push+Hindi), Insights/Today demo residue, mobile discovery, setup guidance.
- **Missing (build)**: payroll+ECS, RTE/EWS ledger, MPD center, NEP/HPC pack, safety-audit + police-verification tracker, parent app, transport compliance reports, scholarship/APAAR/DigiLocker fields, billing/checkout.
- **Unnecessary as-is (tier/hide, don't delete)**: maintenance intelligence/map, counselor analytics depth, UDISE/CBSE exports for sub-500 schools (auto-hide until needed), student flashcards/mistakes (keep but never lead with them), AI Front Desk for small schools.
- **Confusing (fix copy/flows)**: "Illustrative/sample" badges that persist after lanes go live; Guard copy (fixed Round 3); renew-401 console noise (documented); plugin settings sprawl.

---

## 6. ADD — the missing capabilities (each: problem, role, evidence, frequency, impact, complexity, priority)

| # | Feature | Problem → target role | Evidence | Freq | Impact | Complexity | Priority |
|---|---|---|---|---|---|---|---|
| A1 | MPD Compliance Center (Appendix-IX checklist, doc vault + expiry, auto disclosure page, circular tracker) | Affiliation jeopardy → owner/principal | CBSE May-2026 directive + penalties **[F]** | yearly + continuous | **business-critical** | medium | **P0** |
| A2 | RTE/EWS quota manager (25% seats, lottery import, fee waiver to Cl.8, reimbursement ledger claimed-vs-received) | Crores stuck, compliance risk → owner/admissions | SC Jan-2026 "national mission"; ₹2,930cr owed (MH) **[F]** | yearly admissions | **revenue + legal** | medium | **P0** |
| A3 | Payroll + ECS salary proof (structures, bank disbursal file, TDS/PF records) | Affiliation salary-via-bank rule → owner/accounts | CBSE bye-laws **[F]**; payroll in every rival tier **[F]** | monthly | high | medium-high | **P0** |
| A4 | Parent mobile app/PWA + push + Hindi (+Marathi/Telugu fonts bundled) | Parents never come back → parents | 3.6–3.8★ incumbents; boxes/slowness/dead pushes **[P]** | daily | **adoption** | high | **P0** |
| A5 | Real comms: BSP WhatsApp + DLT SMS + read receipts + shared office inbox + failover + Hindi templates | Chaos + no proof → office/parents | 90–95% WA engagement **[P]**; read-proof gap **[P]** | daily | **retention** | medium-high | **P0** |
| A6 | NEP pack: 5+3+3+4 stages, HPC 360° generator, FLN tracker, SAFAL tagging, R3/OASIS sync, bagless + art-integration logs, skill electives | Affiliation-period conversations → principal/teachers | NCF-SE 2023; R3 deadline May-2026 **[F]**; HPC phased **[F]** | termly | differentiation | high | P1 |
| A7 | Transport compliance: boarding timestamps, attendant roster + verification, fare/km engine, quarterly report, inspection log, parent map+ETA | 2026 bus law → transport/owner | MH amendment Apr-2026 **[F]** | daily + quarterly | legal | medium-high | P1 |
| A8 | In-app parent UPI pay + dynamic structures/discounts + counter PIN + dunning broadcast + SMC-hike workflow | Leakage + disputes → office/parents | +40% via reminders **[A]**; dynamic structures standard **[F]** | daily (seasonal peaks) | **revenue** | medium | P1 |
| A9 | Safety-audit checklist (NCPCR-mapped) + police-verification tracker (all staff/drivers, periodic) | Accountability framework → principal/owner | NCPCR manual + MoE 2021 guidelines **[F]** | termly + on-hire | legal/trust | low-medium | P1 |
| A10 | Fee/attendance staff surface: staff QR attendance + adapter interface (NOT face recognition) | Proxy + payroll linkage → HR | 10% adoption under coercion **[F]**; Pathsala sells face/GPS variants **[F]** | daily | medium | low (QR) / high (biometric) | P1 QR; defer biometrics |
| A11 | PTA/SMC manager (meetings, minutes, fee-consultation record) | Hike legality + MPD rows → owner | MPD requires SMC/PTA lists; hikes need SMC process **[F]** | termly | legal | low | P1 |
| A12 | Scholarships (NMMSS/pre/post-matric) + APAAR field + DigiLocker TC + sibling/staff-ward/RTE discount engine | Dropout at Cl.9 cliff; TC delays → office/parents | RTE Cl.8→9 cliff + hidden-cost dropouts **[P]**; DigiLocker push **[F]** | yearly | medium-high | medium | P2 |
| A13 | Infrastructure module (UDISE fields: rooms/labs/toilets/water/playground/PTR) + deadline tracker | UDISE real-time validation → office | 14.67L schools, 4-level validation **[F]** | yearly | compliance | low-medium | P2 |
| A14 | Health extension: RBSK checkups, vaccination, PM-POSHAN meal log | Parent questions → nurse/office | Government-school adjacent; private demand **[H]** | weekly | low-medium | low | P2 |
| A15 | School diary with parent e-signature + circulars with read receipts | "Lost in the bag" → teachers/parents | Diary+signature ships in rivals; read-proof gap **[P]** | daily | medium | low-medium | P1 (rides A5) |
| A16 | Student 360 + class-teacher field-level sharing | Pre-meeting scramble → principal/teachers | Ships in rivals; teachers want controlled visibility **[P]** | weekly | medium | medium | P2 |
| A17 | Staff 360 + CPD (NISHTHA/TET/training) | Promotion + compliance → principal | NEP teacher standards; TET revamp **[F]** | termly | medium | low-medium | P2 |
| A18 | Billing/checkout/quotas wired to existing plan scaffolding | No revenue capture → business | Market flat bands + metered comms **[F]** | once + metered | **business** | medium | **P0 (business)** |
| A19 | Guided setup by school size + CSV onboarding service | Trial→paid conversion → new owners | Assisted migration wins deals **[F]**; setup friction kills trials **[P]** | once per school | conversion | low-medium | P1 |
| A20 | Offline attendance queue (mark → sync, conflict-safe) + low-end-Android + font discipline | Rural/patchy-network reality → teachers | Poor-network cited in adoption failure **[F]**; font boxes **[F]** | daily | adoption | medium | P1 |

---

## 7. IMPROVE — redesigns of existing features

| Feature | Current state | Redesign | Why |
|---|---|---|---|
| Fees last mile | kernel correct, rails dead | Parent self-pay (UPI intent → webhook → auto-confirm under cap; over-cap stays staff-confirmed) + counter PIN + dunning broadcast + dynamic discounts + SMC-hike flow | Collection is the #1 ROI; staff-only pay doesn't scale |
| Comms | orchestrator + logger | WhatsApp-first: BSP send, DLT registry, per-parent sent→delivered→read, shared inbox, SMS failover, Hindi/Marathi templates, push; keep approval gates | Coexist with WhatsApp; don't try to replace it day one |
| Transport | positions only | Compliance system (§6-A7) + parent map/ETA; keep approval-before-notify (it's right) | Law changed; parents call about the bus daily |
| Today/Insights | live summaries + seed-illustrative residue | Delete hardcoded narratives (Bus 14); cards go live-or-empty; "Illustrative" badges conditional on actual unwired lanes | Demo residue on real schools erodes trust |
| Timetable | grid + suggest | Add conflict detector (room/teacher/lab) surfaced inline; constrained auto-assist; never full-auto (coordinator owns the call) | Detection >> generation in value/risk |
| Admissions | honest pipeline | Light CRM: source tracking, counsellor scoreboard, lost-lead reasons, bulk WA follow-up, conversion + aging analytics | Owners buy enrolments, not pipelines |
| Marks entry | functional | Spreadsheet-speed grid (keyboard-first, bulk paste, per-cell validation, class-section filter) timed to <60s/class | Teachers hate slow marks screens (review pattern) |
| Mobile discovery | tabbar-4 + palette | Keep + add size-aware More sheet (done Round 3) + PWA install prompt + offline queue UI | Parents/staff live on phones |
| Setup | settings sprawl | Size-preset wizard (300-pupil primary vs 2,000-pupil secondary): modules, roles, fee heads preconfigured; hide advanced until needed | Trials die in settings |
| Automation/constitution | invisible spine | "When this → then that" template gallery (absence→notice, fee→reminder, delay→approval, enquiry→task) with dry-run + audit preview | Invisible automation gets zero use |
| Returns/UDISE | manual exports | Compliance center (merge with A1): fields + validation + deadline + submission log + MPD page |
| Roles console | works | Ship bursar/dispatcher/warden presets; document roster-only student flow (FIX-11) | Fewer custom-role support tickets |

---

## 8. REMOVE / hide / merge (be strict)

| Feature/pattern | Verdict | Reasoning |
|---|---|---|
| Hardcoded demo narratives (Bus 14 coolant leak, sample collection figures) on real tenants | **DELETE** | Unlabeled fiction on real schools; SampleNote doesn't excuse named-bus stories. Live-or-empty only. |
| Persistent "Illustrative/sample" badges after lanes go live | **CONDITIONALIZE** | Badge per unwired lane, never global; vanish when wired. |
| Maintenance intelligence/map, counselor analytics, UDISE exports for <500-pupil schools | **HIDE by preset** (not delete) | Rarely used at small size; flagship earns chains, confuses budget schools. |
| Student flashcards/mistakes self-study as marketed surface | **DEPRIORITIZE** (keep code) | LEAD owns learning outcomes; your edge is operations. Never lead sales with it. |
| AI Front Desk for small schools | **GATE by need** | Reception load differs 10× by size. |
| Separate rails boards UX (sms vs whatsapp vs comms.whatsapp) | **MERGE** into one Message-channels surface | Owners can't distinguish rails from orchestrator; keep both engines, one face. |
| Face-recognition attendance | **DO NOT BUILD** (adapter only) | Delhi 2021 privacy fight **[F]**; QR + owned-register already answers proxy; creepy + support-heavy. |
| Full auto-timetable generation as flagship | **DO NOT PROMISE** | Detection + assist; coordinators own the call; over-promising burns trust. |
| LLM parent/student open chat | **DO NOT BUILD** | Safety (POCSO climate), accuracy, cost, DPDP-minor data risk. Keep keyword copilots with honest "ask your teacher". |
| Predictive dropout/risk scores shown to parents | **DO NOT SHOW** (staff-only, labeled) | Labeling children with scores is a safeguarding + reputation risk; staff may see ranked review lists. |
| Email as parent channel investment | **DEPRIORITIZE** | 8–12% open rates **[P]**; WhatsApp + push + SMS-failover cover India. |
| Hostel module | **DEFER** unless targeting residential schools | Narrow segment; build only with a design partner. |
| Public school website builder | **DEFER** (MPD page first) | MPD disclosure page (A1) covers the legal need; full builder is a second product. |

---

## 9. Recommended product architecture (the OS, not an ERP)

Keep your substrate — it already matches the right model: **unified data layer (RLS) + events + tasks/approvals + policies + audit**. Organize the surface into 10 modules (merge/split noted):

| Module | Contains (merge →) | Primary users | Frequency |
|---|---|---|---|
| 1. Command (Today/Attention/Action Center/Memory) | briefings + triage + approvals + timeline | all staff | daily |
| 2. People (roster, guardians, staff, roles, onboarding) | ← merge visitor-guardian lookup consumer | office, principal | daily |
| 3. Learn (attendance, timetable, homework, lessons, exams+HPC, PTM) | ← merge teacher/student/parent study surfaces as role views, not modules | teachers, students, parents | daily |
| 4. Money (fees, payroll, expenses-lite, Tally, RTE ledger, scholarships) | ← payroll + RTE land here | office, owner | daily/weekly |
| 5. Admission (funnel/CRM + onboarding + TC/DigiLocker) | ← merge migration/import as entry tool | admissions, office | seasonal+daily |
| 6. Move (transport compliance + GPS + boarding + visitors + gate) | ← merge visitors here (it's all physical safety) | transport, reception, parents | daily |
| 7. Care (clinic + meals + safety-audit + concerns + counselor) | ← merge health, safeguarding, NCPCR checklist | nurse, counselor, principal | daily/weekly |
| 8. Comply (MPD + UDISE/OASIS + affiliation + DPDP + certificates) | ← merge Returns + documents-expiry + policy packs | owner, principal | weekly/yearly |
| 9. Talk (channels, inbox, diary, circulars, surveys, DLT) | ← merge rails boards into one face | office, teachers, parents | daily |
| 10. Run (automation gallery, constitution, AI usage, IT keys, settings, group HQ) | ← merge plugins/settings/roles/API/audit-view | itadmin, owner | weekly |

Moves to global search/palette: every destination (already), every pupil/staff (add), every action ("record payment", "admit pupil") as commands. Actions-not-pages: approve, confirm, waive, assign, publish — all inline, never a page.

## 10. Role-based experience (top-5 actions; dashboards answer "what do I do next?")

- **Principal** sees first: attendance exceptions, fee-at-risk total, approvals waiting, compliance deadlines, staff gaps. Top-5: approve (leave/announcement/case), assign cover, review flagged class, sign certificate, check MPD/RTE status. Never search for: today's numbers, who needs me.
- **Teacher** sees first: now/next period, register CTA (one tap), unreviewed submissions count, today's homework due, cover duties. Top-5: mark register, post homework, enter marks (grid), request leave, file concern. Automated: substitution suggestions, absence notices queued, timetable autofill. Approvals needed: leave (coordinator), marks publish (moderation).
- **Parent** sees first: is my child in school today, anything to pay, anything to sign, bus status, tomorrow's needs. Top-5: pay fee, sign diary/consent, view homework, book PTM, message teacher (controlled). Never search for: dues, dates, bus.
- **Accountant** sees first: collected today, failed/pending, defaulter list by class, receipts to issue, gateway mismatches. Top-5: record payment, confirm settlement, send reminder broadcast, issue receipt, run aging. Automated: reminders, late-fee computation, reconciliation matching. Approval: confirm over cap, waive, void run.
- **Transport manager** sees first: buses departed/late, boarding completeness, driver/attendant presence, complaints, inspection due. Top-5: start route, mark boarding, report delay, request approval, log inspection.
- **Admission counselor** sees first: today's follow-ups, hot leads, visit schedule, conversion vs target, lost reasons. Automated: capture→task, visit reminders, offer letters.

## 11. AI strategy (measurable value only)

- **BUILD**: homework/marks anomaly flags (human reviews); fee-default early list (staff-only, labeled); timetable conflict detection; parent-message drafting from templates (human sends); natural-language internal analytics over own records with per-claim citations (staff-only); document field extraction for admissions (human verifies).
- **CONSIDER (pilot-gated)**: substitution ranking (your suggest engine + learning); Kannada/Telugu/Hindi parent-message translation with human approve; lesson-plan first drafts aligned to NCF-SE (teacher edits).
- **AVOID**: open LLM chat for parents/students; predictive scores shown to families; face recognition; auto-sending anything; auto-grading open answers; AI timetables sold as flagship; anything touching minor data without DPDP-grade consent + audit.

## 12. Automation strategy (Trigger → Decision → Action → Notification → Audit)

Highest value, all human-gated where money/safety/children involved: absence mark → queue guardian notice (office sends); due-date −3d → fee reminder (auto under cap, logged); payment webhook → match-or-flag (auto-match exact, human resolves rest); leave approve → substitution propose → coordinator one-tap; GPS delay ≥10m → approval task → on-approve notify; enquiry capture → follow-up task + visit reminder; marks publish → report cards + parent notices; low attendance (<75%) → counselor review list (staff-only); doc expiry −30d → MPD task; RTE lottery import → seat + waiver rows. NEVER automate: money movement, safeguarding decisions, safety broadcasts content, published results.

## 13. India-specific strategy (why this wins *here*)

Hindi-first UI + bundled Indic fonts (boxes kill you on ₹8k phones); WhatsApp-first with DLT/SMS failover; UPI-native money with staff-confirm discipline; CBSE/State-board report variants + OASIS/R3 sync; UDISE 4-level validation + deadline memory; RTE lottery→waiver→reimbursement chain; MH bus-law compliance pack; SMC/PTA on record; salary-via-bank proof; per-school isolated data + DPDP ledger as the trust story; flat published pricing in rupees with WhatsApp/SMS metered separately; offline-tolerant attendance; founder-led WhatsApp support in onboarding (rivals win on this). Coexist with Excel (import/export everywhere), with WhatsApp (don't replace day one), with government portals (prefill + export, never retype).

---

## 14. MVP — exact feature set (sellable to a ₹30k/yr CBSE school in 8 weeks)

Roster + guardians + classes + year; owned-register attendance + corrections + queued notices; fee heads/plans/generate/record/confirm/receipts + Razorpay/UPI wiring + reminders; exams entry + weightage + cards; timetable grid + conflict detector + substitutions; admissions stages + enrol; visitors + pickup OTP; transport routes + boarding log + GPS + delay approvals; library circulation; HR leave (+payroll-lite: structures + ECS file); clinic log; cases triage; DPDP consent+SAR; WhatsApp BSP + SMS failover + receipts + inbox; MPD center v1 (checklist + vault + disclosure page); RTE v1 (quota + waiver + reimbursement ledger); parent PWA + push + Hindi; staff QR attendance; audit/memory/action-center (already); size-preset setup + CSV import; flat pricing wired. Explicitly OUT of MVP: HPC, SAFAL tagging, electives, hostel, LMS/video, biometrics, predictions, website builder, multi-branch HQ.

## 15. Roadmap

- **Phase 1 — MVP** (above): sell to 5 design-partner schools; success = daily attendance + fee collection without Excel.
- **Phase 2 — Core OS**: NEP pack v1 (stages, HPC, FLN, R3/OASIS), transport compliance reports, safety-audit + verification tracker, diary+e-sign, Student 360, staff 360/CPD, PTA/SMC, scholarships/APAAR/DigiLocker, infrastructure/UDISE depth, automation gallery, offline queues.
- **Phase 3 — Automation**: dunning broadcasts, reconciliation auto-match, substitution ranking, publish-on-approval chains, compliance deadline engine, admission bulk follow-up.
- **Phase 4 — Intelligence**: cited NL analytics (staff), drafting copilots (human sends), anomaly flags, timetable assist; tokens metered per tenant; everything labeled deterministic-first.
- **Phase 5 — Platform**: open API docs + sandbox, webhooks (exists) + Zapier-style recipes, white-label parent app, multi-branch HQ billing, vendor marketplace (BSPs, gateways, biometric adapters).

## 16. Differentiation — 8 defensible advantages

1. Money integrity (idempotent dues, paid-never-decreases, kernel settlement, counter PIN) vs paid-not-reflecting rivals.
2. Duplicate-proof roster (name + admission-no guards with holder named) vs Excel chaos.
3. Honest notifications (receipts, scopes, quiet hours, no duplicates) vs dead/duplicate pushes.
4. Compliance centers (MPD + RTE ledger + bus-law pack) vs generic exports.
5. Approval-gated everything (nothing sends/moves without a human) vs auto-messaging risk.
6. Server-truth roles + hash audit (prove it to auditors/parents) vs shared-DB black boxes.
7. Hindi-first + font discipline + low-end-Android speed vs boxes and splash crashes.
8. Flat published pricing + metered comms vs per-student creep and unpublished enterprise quotes.

## 17. Risks

- **Product**: over-building for premium/international too early; NEP pack scope creep; timetable full-auto temptation; chatbot safety incident.
- **Technical**: BSP/gateway webhook reliability; push delivery on cheap Android (battery killers); biometric hardware sprawl (stay adapter-only); background-worker ops at scale.
- **Adoption**: teacher minutes-per-day budget (measure it; kill features exceeding it); parent app install friction (PWA + WhatsApp-first mitigates); Hindi quality (human-reviewed templates first).
- **Legal/privacy**: DPDP enforcement phasing (stay ahead: breach runbook, minor-data minimization); POCSO-adjacent features need lawyer review before shipping (concern workflows, photo/boarding images); fee-hike workflows must cite state acts, not folk wisdom.
- **Business**: competing with ₹9k flat rivals on price while funding support; per-message margins; onboarding cost per school (productize setup + migration).

## 18. Final recommendation — build this, ignore that, do differently

> **Build**: the 10-module OS in §9 with the MVP in §14; money-integrity + roster-truth + honest comms as the core loop; compliance centers as the moat; WhatsApp-first parent experience; deterministic AI with approvals.
> **Ignore**: international-school LMS depth, hostel, facial recognition, open LLM chat, predictive parent-facing scores, email-channel investment, website builder, full-auto timetabling.
> **Do differently from ERP companies**: sell *outcomes with proof* (collection %, read receipts, compliance checklists green) instead of module counts; publish flat pricing; onboard with founder-led WhatsApp support and free migration; keep the audit ledger as the product's spine, not a report; refuse demo data everywhere including your own marketing screens; measure teacher-minutes-per-day and parent-notification-trust as your north-star metrics, not logins.

---

## School OS 2026 Master Blueprint (one page)

**Structure**: 10 modules (§9) on the existing substrate (RLS tenancy, atomic audit+events, server-truth roles, lifecycle plugins).
**Priority features (P0)**: MPD center, RTE ledger, payroll+ECS, parent app+push+Hindi, real comms (BSP+receipts+inbox), billing wired.
**P1**: NEP pack, transport compliance, fee hardening, safety-audit + verification, staff QR, PTA/SMC, diary+e-sign, setup presets, offline attendance.
**Removed/hidden**: demo narratives; global illustrative badges; small-school advanced screens (preset-hidden); face recognition; open LLM chat; parent-facing predictions; email investment; hostel; website builder.
**Differentiation**: money integrity, duplicate-proof roster, honest notifications, compliance centers, approval-gated everything, hash audit, Hindi-first speed, flat pricing.
**MVP**: §14 (8-week sellable slice for a ₹30k/yr CBSE school).
**Roadmap**: MVP → Core OS → Automation → Intelligence → Platform (§15).
**Metrics**: teacher minutes/day down; notification read-rate up; collection % up; compliance checklists green; zero demo data; support answers in hours.



