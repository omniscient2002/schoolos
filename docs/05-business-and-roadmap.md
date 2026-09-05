# 05 — Business: Economics, Pricing, GTM, Roadmap, Moats, Red Team, Decision Tables

> Claim labels: **[V]** verified web, **[K]** training knowledge, **[I]** inference, **[D]** proposed design. Pricing figures below are *models with named assumptions* to validate with live data, not published competitor prices.

---

## 1. Economics (bottom-up, India wedge)

### 1.1 Revenue model (per-student-per-year, floored per school)

| Tier | Target customer | Included | Model price [D] |
|---|---|---|---|
| Starter | ≤500-student schools, self-serve | Spine: records, attendance, timetable, comms digests, fee ledger + links | ₹40–60/student/yr, floor ₹30k/yr |
| Pro | 800–3,500-student premium schools | + copilots (teacher/principal/parent/ops), automation + constitution, admissions, transport, AI quota | ₹120–180/student/yr |
| Group/Business | 3–20 campuses | + group console, consolidation, board packs, SSO, connector suite, higher AI quota | per-campus pricing, 15–30% volume discount |
| Enterprise | >20 campuses / international / dedicated tenancy | + residency choices, custom DPA, SLA, premium migration, private model routing | custom (₹25L+/yr equivalent) |

Reference unit: a 2,500-student Pro school ≈ ₹3–4.5L/yr (~$3.6–5.4k); a 10-campus group ≈ ₹25–45L/yr. One-time implementation: free ≤300 students (self-serve); ₹25k–2L for complex migrations (waived for design partners); migration is a product, not a profit center — its job is *switching*.

**What we do not monetize:** parents (no parent-paid tiers), student data (never), ads (never), AI features that gate child-safety workflows, data export/exit. Trust is the retention engine at the academic-year churn point.

### 1.2 Cost model per Pro school (2,500 students) [D, order-of-magnitude]

| Line | Monthly est. | Notes |
|---|---|---|
| Infra (compute, DB, storage, queue) | ₹8–15k | RLS-pooled tenancy, one region |
| AI inference | ₹10–30k | Routing-heavy; digests cheap, briefings/ask mid; nightly batch |
| WhatsApp/SMS rails | ₹10–25k | Digest batching is a cost lever as well as UX |
| Support (amortized) | ₹15–25k | The real cost center; migration quality reduces it |
| **Total COGS** | **₹45–95k** | vs revenue ₹25–37k/mo at ₹120–180/student/yr |

⚠️ This arithmetic says the naive Pro price is thin-to-negative at 2,500 students unless (a) AI cost stays ≤15% of revenue (enforced by gateway budgets), (b) support is driven down by migration quality and the workflow library, (c) ACV rises via groups and IB/international (₹8–25L deals) where gross margins are healthy. **Conclusion [I]: the India wedge works only with a mix of Pro schools (land) and Group/Enterprise+IB (expand), and with COGS discipline as a core metric, not an ops afterthought.** Validate with live design-partner telemetry before freezing pricing.

### 1.3 Unit economics targets [D]

CAC (founder-led + admission-season webinars + 2–3 channel partners per metro): ₹60–150k per Pro school; payback ≤6 months on Pro, ≤3 months on Group. Gross margin ≥70% at scale. Logo retention target ≥90% across academic-year boundary (the industry's churn cliff); NRR ≥115% via seats/modules/group expansion.

## 2. Go-to-market (India wedge first)

1. **Design partners (months 0–6):** 8–12 premium schools + 1–2 groups in 2 metros; free migration + founding pricing; weekly embeds; the loop is co-designed with real coordinators.
2. **Land (months 6–18):** founder-led sales in 3–5 metros; demo = the migration + briefing show (`§6`); decision window is Nov–Mar (admission season); goal: live before the academic year starts, embedded before the churn window.
3. **Expand:** campus-by-campus inside groups; IB/Cambridge pack sells international schools in the same metros; Parent Teacher associations and owner networks as referral fabric; school-service providers (stationery/uniform vendors, photographers who already visit schools) as light channel.
4. **Carry out (year 3+):** IB references → US independent + UK; country packs + residency zones activate.

Sales physics to respect [I]: the principal is the champion, the coordinator is the gatekeeper, admission season is the clock. Never sell during exam months. The demo must include *their* data — the migration console is the closer.

## 3. MVP / V1 / V2 / V3 / Global

### MVP — "runs the school's first AI-assisted month" (12 weeks, 5–6 engineers) [D]

Scope (the magical minimum): tenancy+permissions+audit ledger; people/enrollment/guardianship; **migration engine v0** (Excel/CSV + 2–3 legacy formats + PDF fee ledgers); simple timetable + substitutions; attendance (seating chart, offline queue, absence→parent loop); **fee ledger + payment links + WhatsApp digests with pay buttons**; teacher copilot v0 (voice note→lesson log, parent-draft with approval, attendance assist); principal briefing v0 (attention + deltas, cited) + Ask v0 (grounded Q&A); constitution v0 (20-question onboarding); approval inbox.
**Success bar:** a partner school runs a full week with zero rows typed beyond approvals; briefing numeric fidelity ≥99.5%; 5 parent interactions per student per week on WhatsApp.
**Explicitly not in MVP:** HR, transport, admissions funnel, memory, analytics depth, IB pack, tutor, automation builder (constitution covers the 3 packaged flows).

### V1 (months 4–9): the daily loop completes
Admissions funnel; transport ops + GPS integrations; automation builder (visual + NL) + workflow library v0; HR-lite + payroll integrations; assignments/gradebook/report cards (CBSE pack first); School Memory v0 (decision records + doc Q&A); IB/Cambridge pack v0; evals + shadow-mode framework hardening; warehouse marts v0. **v2.0 additions** (`06` §9): unified action spine (Task/Approval/Case; ATTENTION/NEXT as views), case engine (auto-created complaint/facilities/fee-dispute kinds), Communication Orchestrator (platform service), calendar events, capture affordances (QR cases, photo+OCR, spreadsheet-grade bulk grid), universal search formalization, Data Health v0 (first 10 rule packs), Control Plane formalization + feature flags.

### V1.5 (months 9–12): the forward loop
Obligation engine + compliance pack (board filing/renewal dates per country pack); continuous reconciliation (payment gateway + Tally); incident + compliance case kinds (mandatory review); closed-loop decision records; vendor directory + minimal asset registry; staff joiner/mover/leaver lifecycle; Data Health full (all rule packs + tenant score); briefing "Tomorrow" band GA.

### V2 (months 9–18): depth + intelligence
Learning intelligence depth (mastery, item analysis, intervention recs); AI tutor v1; simulation (3 scoped solvers); 2D campus canvas; group/enterprise tier; US independent + UK pack builds; SOC 2 Type II audit window; marketplace groundwork (connector framework is already public API).

### V3 (18m+): ecosystem & scale
Skill Passport (student-owned portable credentials); marketplace; US district feasibility gate (Ed-Fi/state reporting, SDPC DPAs); alumni network surfaces; advanced compliance packs (EU AI Act high-risk conformance package as a *product* for EU/international schools).

## 4. North-star metrics (chosen, not listed)

| Metric | Why this one |
|---|---|
| **North star: Weekly Operating Coverage (WOC)** — % of a school's operational events (attendance, comms, fees, approvals, assignments) that flow through SchoolOS weekly | Measures "are we the OS or another app"; predicts retention better than logins; consolidates breadth of daily use |
| **Admin minutes saved / school / week** (measured from loop telemetry + quarterly calibration against coordinator time-studies) | The renewal argument in numbers |
| **Time-to-Live** (contract → first full operating day) | The switching promise; target ≤14 days incl. migration |
| **Guardrail: academic-year logo retention** ≥90% | The churn cliff decides the business |
| **Parent digest response rate** | Parent-surface health; leading indicator of referrals |
| **AI action correctness** (eval pass rate in production shadows) | Trust metric with teeth |

Explicitly *not* north stars: MAU (vanity in a staff-tool), feature count, seats sold (seats ≠ operating coverage).

## 5. Competitive moats — honest ranking

| Candidate | Rank | Reasoning |
|---|---|---|
| AI Migration Engine + schema/mapping corpus | **STRONG** | Compounds with every school onboarded; invisible to competitors; directly attacks the #1 switching barrier |
| Cross-tenant workflow/policy library (privacy-sandboxed) | **STRONG** | New schools inherit proven automation; the library's quality grows with customers; a network effect on *operational knowledge*, not data |
| School Memory (decision records, institutional history) | **STRONG (over 2–3y)** | Switching = amnesia; impossible to retrofit retroactively |
| Local rails glue (WhatsApp/DLT, UPI, Tally, GPS vendors, board formats) | **STRONG (locally), WEAK (portable)** | Deep, unglamorous, market-specific work |
| Accumulated tenant graph + record quality | **STRONG (gravity), not lock-in** | Portable by principle; the lock-in is continuity, not captivity |
| School-specific eval corpus + safety track record | **MODERATE** | Hard to copy fast; differentiates on trust for AI in schools |
| Policy engine + constitution | **MODERATE** | Copyable concept; depth-of-library hard to match |
| Copilots/briefing UX surfaces | **WEAK** | Copyable in 12–18 months; never claim as moat |
| Feature breadth (transport, HR, admissions…) | **WEAK** | Checklist parity is buyable by any incumbent |
| Marketplace/ecosystem | **FUTURE-MODERATE** | Only after connector pull is proven |
| Compliance/policy pack library + continuous reconciliation | **STRONG (v2-upgraded)** | Regulatory + rails labor that compounds and is miserable to copy; under-recognized in v1 (`06` §10) |
| Outcome telemetry (measured minutes saved at scale) | **MODERATE (new)** | Pricing/renewal weapon once WOC scale exists |
| Vetted substitute-teacher pool (shared across schools in a metro) | **FUTURE-MODERATE** | Real network effect on the universal teacher-absence pain; gated on vetting/insurance/liability design; revisit post-V2 |
| Privacy-sandboxed cohort benchmarks ("your fee realization vs similar schools") | **FUTURE-STRONG** | Cross-tenant data product; requires trust maturity + consent architecture first; powerful retention once live |

## 6. The 10-minute demo (designed, not listed)

Act 0 (90s) — *The switch:* a real (anonymized) legacy export goes into the migration console on stage; the mapping report card appears; coordinator approves; "your school is now in SchoolOS." Establishes time-to-live before anything else.
Act 1 (3m) — *The morning:* principal opens the phone: briefing — 8-B absence 23% vs 6% baseline [tap → register], bus 14 down Tuesday, 47 payments failed post-route change. "Why?" → the system walks the causal chain with dates and sources. "What should happen?" → proposals: note to 8-B parents (drafted, school tone, Hindi), transport follow-up task, fee reminder batch. Principal taps Approve. **v2.0:** the briefing's *Coming due* band shows next Tuesday's fire before it starts — "Fire-safety renewal expires in 9 days (case opened, vendor pending) · Class 9 PTM clashes with board exam prep · 3 Route-7 cases breach SLA this week" — each pre-assigned with evidence.
Act 2 (2m) — *The proof:* a parent in the room (or their phone mirrored) receives the WhatsApp message — in their language, with a pay button. Live. Then a teacher voice-notes after class; the lesson log and a parent follow-up draft appear; teacher approves.
Act 3 (2m) — *The governance:* open the School Constitution: show the policy that produced each automated action, the audit ledger entry for every AI action taken, the approval inbox. "Your rules bind the AI" — including what the AI is forbidden to do (discipline, admissions finals, grades).
Act 4 (1m) — *The scoreboard:* the outcome meter — minutes saved this month, response times, collection cycle — and the board pack PDF generated from the same graph.
Close: "This ran on your data, in a week, and every number had a source. And that problem for next Tuesday? Already assigned." *(v2.0 close — the forward loop is the category line.)*

## 7. Red team (Round C on the final design)

**If I were PowerSchool/Infinite Campus:** starve SchoolOS of district deals (I don't need to — they exclude themselves), extend my ecosystem lock (OneRoster/Ed-Fi, state reporting), bundle a "free AI assistant" with the SIS, and out-last on procurement relationships. **Survival:** never contest districts early; win segments they under-serve (India, IB, US independent); make our platform the *action layer* their SIS feeds (we integrate *with* district SIS as a connector — heresy in the brief, correct strategically for US later); out-ship on the loop. Note the trust environment [V]: both PowerSchool (Dec 2024) and Canvas (Apr 2026) suffered major breaches — "security-first challenger" is now a sellable wedge against incumbents' incident fatigue, and our no-shared-credential/JIT privileged-access model is a direct answer to how both incidents started.
**If I were Veracross/Blackbaud:** copy the briefing + copilots, defend with whole-school depth and integration breadth, price aggressively for switching schools. **Survival:** migration engine speed + WhatsApp/fee rails they lack culturally + group/IB expansion speed; their implementation model can't ship "live in 14 days" without cannibalizing services revenue.
**If I were a new AI-native startup (18-month copy):** copy copilots (easy), undercut price, move fast. **Survival:** the four compounding assets (§5) — corpus, library, memory, rails — plus design-partner relationships and the safety/eval record. Also: distribution via groups is relationship-gated.
**If I were Google/Microsoft:** bundle free "school AI" into Workspace/EDU. **Survival:** they will not build fee ledgers, Indian board formats, transport, or safeguarding workflows; be the record+action layer their suite plugs into (deep M365/Google integration is native for exactly this reason).
**Self-inflicted kill modes:** (1) one parent-facing hallucination — mitigations: citation-or-silence, approval gates, degraded mode; (2) a breach — mitigations: `04` §8 controls, WORM audit, IR runbook, narrow standing access; (3) consulting spiral — mitigations: migration-as-product, constitution-driven config boundaries, "we configure packs, we don't fork"; (4) AI cost blowout — budgets in the gateway; (5) year-boundary churn — embed before January, outcome meter at renewal; (6) India price war — sell ROI + groups + IB, never compete at ₹20/student.

## 8. Decision tables (summary)

### 8.1 Technology choices
| Decision | Choice | Rejected | Why |
|---|---|---|---|
| Service topology | Modular monolith + workers | Microservices | Team scale; transactional workload; structural boundaries preserve extraction options |
| Graph store | Postgres + views | Dedicated graph DB | 1–3 hop relationships; ops cost |
| Vector store | pgvector | Dedicated vector DB | Namespace isolation; one engine |
| Timetabling | Constraint solver | LLM generation | Determinism where math exists; LLM at the edges |
| Workflow engine | DB-backed state machine + queue | Temporal at v1 | Ops weight; revisit at scale |
| Mobile | PWA-first | Native-first | Team scale; WhatsApp carries the habit surface |
| Multi-region | Per-residency zones, active-passive | Global active-active | Cost vs need; contracts drive zones |

### 8.2 Country expansion (sequenced)
| Market | Sequence | Gate to enter |
|---|---|---|
| India premium + groups | 1 | None (home) |
| IB/Cambridge international | 1.5 (same metros) | Curriculum pack v0 |
| US independent | 2 | SOC 2, DPA templates, US entity/support hours |
| UK state/MAT | 3 | DfE/MIS rails (Wonde-class), DPIA pack, UK residency |
| US districts | 4+ | Ed-Fi/state reporting + partner motion |
| EU/international (Middle East) | 3–4 | Residency, AI Act conformance pack, Arabic pack |

### 8.3 Security risks (top) & regulatory map
| Risk | Mitigation anchor |
|---|---|
| Child-data breach | `04` §8 controls; WORM audit; IR notification SLAs |
| Insider/support misuse | Break-glass, time-boxed, school-visible access |
| AI data leakage via models | Namespace isolation, region pinning, redaction middleware, no-training default |
| Vendor AI compliance drift (EU AI Act class changes) | Policy engine drives AI modes per pack; conformance-as-product |
| Regulatory: FERPA school-official + COPPA + PPRA (US), DPDP Act 2023 + Rules 2025 (India) [V], UK GDPR + Children's Code + DfE AI product-safety standards [V], EU AI Act education high-risk (2 Aug 2026) + Art. 5 emotion-recognition ban [V] | Country packs carry the compliance posture; policy engine drives AI modes; pre-signed SDPC NDPA for US; AI risk-management files per feature; counsel review per market |

### 8.4 Features by value vs effort (MVP gate)
| High value / low effort (do first) | High value / high effort (plan) | Low value (cut/defer) |
|---|---|---|
| Migration console, fee+WhatsApp loop, attendance loop, briefing v0, Ask v0, voice teacher notes | Timetable solver, learning intelligence, simulation, IB pack, group console | 3D twin, gamification, student social, HR depth, library module, custom report builder |

## 9. Risks register (top 10)

1. **Parent-facing AI error** → citation-or-silence, approval gates, shadow mode, degraded mode.
2. **Security breach of child data** → controls in `04` §8; assume breach drills; minimize standing access.
3. **India price anchor trap** → ROI selling, group/IB mix, COGS discipline.
4. **Teacher rejection** → time-returned guarantees; copilot never adds entry burden; measure per-class usage weekly.
5. **Churn at year boundary** → embed pre-January; outcome meter; multi-year contracts with outcome clauses for groups.
6. **Implementation spiral** → migration-as-product; constitution config boundaries; no-fork rule.
7. **AI cost overrun** → gateway budgets, routing, caching; AI cost as % revenue KPI.
8. **Incumbent feature copying** → compound the four moats; speed of the loop; group relationships.
9. **Regulatory surprise (DPDP rules, AI Act timing)** → policy-engine-driven AI modes; packs carry compliance; counsel calendar.
10. **Founder-market misread on wedge** → design partners before pricing freeze; kill criteria: if 3 of first 10 premium schools won't pay Pro price after live month, re-examine segment (not just pricing).

## 10. Five-year vision (trajectory, not prophecy)

Year 1: the loop works in 50–100 Indian premium schools + first group; WOC >60% in embedded schools; migration corpus v1.
Year 2: 500+ schools incl. first IB/Cambridge cohort; learning intelligence live; library compounding; India pack deep.
Year 3: US independent + UK entry with references and residency; 1,000+ schools; Skill Passport beta; marketplace groundwork.
Year 4–5: multi-region steady state; groups/international >40% of ARR; the workflow library + policy packs become the industry's shared operating knowledge base; SchoolOS is the default answer to "what runs your school?"

## 11. Success metrics recap (company)

WOC (product), admin minutes saved (value proof), Time-to-Live (promise kept), AY-retention ≥90% (survival), NRR ≥115% (expansion), AI correctness ≥99.5% briefing fidelity (trust), COGS ≤25–30% of ARR (economics), migration NPS (switching engine health).
