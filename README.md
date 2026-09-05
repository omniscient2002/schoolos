# SCHOOL OS — Master Product Blueprint

**The intelligent operating system for schools.** **v4.2 (platform kernel slice)** — v3.0 built the product (61 screens / 63 route paths (incl. the v4.2 /facilities→/maintenance redirect) after the v4.2 kill; see changelog history below); **v4.x adds the plugin platform**: kernel primitive capability split (money/work/artifact/comms), governance event budgets + circuit breakers, per-plugin event envelope v2 with lineage (`GET /events/lineage`), drain protocol on plugin disable, plugin registry + Library proof plugin (`GET /plugins`, `/plugins/:id/enable|disable`), attention ranking participation, and production hardening from the RTR-001 red team (audit ledger SECURITY DEFINER, money invariants, role-scoped reads). See `docs/10`, `docs/11`, `docs/12`. v3.0 (app build) — v2.0 was the final architectural refinement (`docs/06-refinement-v2.md`); the v3 layer is the **built product**: 56 screens / 57 routes, zero-TSC, headless-verified, adding the Maintenance & Facilities flagship (13 screens), the AI Front Desk, and the Migration console. The two §12.F rejections those flagships contradicted are formally re-opened with reasons in `docs/07`. See `app/README.md` to run it. Historical record: v1.0 produced via the mandated iteration loop (Rounds A–H below); refined to v2.0 by the final architectural & product refinement pass (`docs/06-refinement-v2.md`), which added six operating primitives, consolidated governance, and left the thesis intact. Claim labels used throughout: **[V]** verified from web this session, **[K]** training knowledge (≈2024–25) needing citation, **[I]** inference, **[D]** proposed design.

---

## Document map

| File | Covers |
|---|---|
| `docs/01-vision-and-market.md` | Exec vision · problem · target customers & buying committee · positioning · competitive analysis · differentiation · product principles · GTM wedge decision · assumptions challenged · stress-test matrix |
| `docs/02-product-experience.md` | Interaction model · roles & permissions philosophy · per-role experiences (principal/teacher/student/parent/admin/owner/IT) · golden journeys · feature classification & kill list · MVP experience bar · deliberately-thin domains |
| `docs/03-intelligence-layer.md` | School Graph & storage split · event spine · AI gateway · copilots/workers · action contract · human-control boundary · automation & workflow library · School Constitution/policy engine (3 layers) · learning intelligence · School Memory (closed-loop decisions) · simulation · failure design · evaluation |
| `docs/04-platform-and-security.md` | Modular monolith decision · stack · tenancy/isolation · data model (+v2.0 entities) · AI Migration Engine · permissions · country/board/policy/integration packs · privacy & security controls · offline-first · native-vs-integration boundary · cost drivers |
| `docs/05-business-and-roadmap.md` | Pricing & unit economics · GTM · MVP/V1/V1.5/V2/V3/global · north-star metrics · moat ranking · 10-minute demo · red team · decision tables · risks register · 5-year vision |
| `docs/09-red-team-audit.md` | **The red-team audit (8 hostile roles):** verdict 68→79/100 · top strengths/weaknesses · fatal risks · justified product/architecture/AI changes · recalculated unit economics (₹80–120 PSPM, GM 60–77%, paid migration) · the Tomorrow class contract (DUE/AT RISK/LIKELY/PREDICTED) · AI chain audit with draft-only re-classifications · moat test · kill list (10 removals) · design-partner gate table · verdict: BUILD WITH TARGETED CHANGES |
| `docs/08-production-build-plan.md` | **The production build plan:** 5 phases / ~40 weeks from demo to GA — stack & tenancy decisions, schema order, migration engine v1, operating loop live (SLA/workflows/comm orchestrator), flagships to production (telephony/ASR, offline PWA), payments + DPDP compliance, pilot→GA gates, team plan, risks register, definition of done |
| `docs/10-plugin-platform-v1.md` · `docs/11-plugin-platform-target.md` · `docs/12-enterprise-hardening.md` | **The plugin platform:** v1 slice (registry, Plugin Manager, Library proof) · target architecture (Platform Kernel, Capability Runtime, T0–T4 isolation, staged marketplace) · enterprise hardening (capability contracts, event budgets & breakers, drain protocol, tenancy modes, AI decision-vs-transformation, certification framework) |
| `docs/07-build-flagships-and-demo.md` | **The v3 build delta:** re-opens the two §12.F rejections with reasons (AI Reception, asset lifecycle) · documents both flagships (Maintenance 13 screens, AI Front Desk) · v3 primitive evidence table · the 15-minute demo script · route map · seed-corpus appendix |
| `docs/06-refinement-v2.md` | **The v2.0 delta:** 45-domain capability audit · primitive verdicts (A–M) · AI classification · agent red team (18 attacks) · business/UX red teams · final 14-primitive OS set · canonical architecture/entity/event/action/policy/AI-governance models · roadmap classification · moat copyability matrix · the forward-operating loop ("Tomorrow") · final verdict A–K |

### Coverage audit — all 57 required output sections

1 Exec vision → 01§1 · 2 Problem → 01§2 · 3 Target customers → 01§3 · 4 Positioning → 01§4 · 5 Competitive analysis → 01§5 + README appendix · 6 Differentiation → 01§6 · 7 Principles → 01§7 · 8 Product architecture → 02§1/§5 + 03 + 04 · 9 Roles → 02§2 · 10 Journeys → 02§4 · 11 Feature architecture → 02§5 · 12 School Graph → 03§1 · 13 AI architecture → 03§2 · 14 Agent architecture → 03§3 · 15 Permissions → 04§6 (+02§2) · 16 Policy engine → 03§5 · 17 Automation engine → 03§4 · 18 Learning intelligence → 03§6 · 19 Principal Command Center → 02§3.1 · 20 Teacher experience → 02§3.2 · 21 Student experience → 02§3.3 · 22 Parent experience → 02§3.4 · 23 Admin experience → 02§3.5 · 24 Finance → 02§3.5/§4 + 04§4 · 25 Admissions → 02§5 + 03§3.1 · 26 Transport → 02§5 + 04§10 · 27 HR → 02§5 (HR-lite, payroll integrated) · 28 Library → 02§5 (cut/integrate, reasoned) · 29 Campus operations → 02§5 + 03§8 (2D canvas) · 30 Communication → 02§3.4 + 03 digest worker + 04§7 rails · 31 Document system → 02§5 + 03§7 · 32 Analytics → 02 INSIGHTS + 03§1 warehouse split · 33 Simulation → 03§8 · 34 School Memory → 03§7 · 35 Digital Twin → 02§5/03§8 (2D, 3D cut) · 36 Integrations → 04§10 · 37 Developer platform → 04§10 · 38 Privacy/security → 04§8 · 39 Internationalization → 04§7 · 40 Technical architecture → 04§1–2 · 41 Data model → 04§4 · 42 API architecture → 04§2/§10 · 43 AI infrastructure → 03§2 · 44 Cost architecture → 04§11 + 05§1.2 · 45 Pricing → 05§1.1 · 46 GTM → 05§2 · 47 MVP → 05§3 + 02§6 · 48 V1 → 05§3 · 49 V2 → 05§3 · 50 Long-term roadmap → 05§3/§10 · 51 Moat → 05§5 · 52 Risks → 05§9 · 53 Failure modes → 03§9 · 54 Mitigations → 03§9 + 05§9 · 55 Success metrics → 05§4/§11 · 56 10-minute demo → 05§6 · 57 Five-year vision → 05§10.

Required decision tables (prompt §40): features by value/effort → 05§8.4 · by differentiation/moat → 05§5 · MVP candidates → 05§3 · future features → 02§5 FUTURE rows · integrations → 04§10 · AI agents → 03§3 · automation opportunities → 03§4 · security risks → 05§8.3 · regulatory considerations → 05§8.3 · technology choices → 05§8.1 · country expansion → 05§8.2.

---

## Iteration log (Rounds A–H, evidence of the loop)

**Round A — Understand.** Field model: in every studied market the school's real "OS" is Excel + WhatsApp + a person. Incumbents are systems of record (compliance-shaped); the operating loop lives outside them. Buying committee mapped (principal = champion, coordinator = gatekeeper, owner = payer via fee/admissions KPIs, teachers = retention surface, parents = reputation surface).

**Round B — Explore.** Five strategic directions scored: (1) better ERP checklist — rejected (price war, no moat); (2) parent-comms-first point tool — rejected (no record = no moat; contested by ParentSquare/Dojo); (3) AI-tutor-first — rejected as wedge (needs record quality first); (4) SIS replacement for US districts — rejected (procurement wall); (5) **AI-native operating loop on a compact record with migration-as-product — selected**, because it attacks the glue-person directly, monetizes owners' KPIs, and compounds data assets.

**Round C — Challenge (destroy-the-idea record).** Killed or redesigned: 14 named agents → 6 copilots + 5 workers (eval/permission/cost explosion); 3D digital twin → 2D canvas (novelty, no daily utility); general simulation engine → 3 scoped solvers (unmaintainable trust risk); marketplace at launch → connector framework first (two-sided cold start); LMS content authoring → integrate (unwinnable vs Google/Toddle); student social feed & gamification → removed (safety/liability); "AI-native" as the pitch → reversed ("runs your school" is the pitch); parent app-first → WhatsApp/SMS-first; student AI tutor as MVP headline → moved to V1; analytics agent → worker + copilot (hallucination reputational risk).

**Round D — Compare.** Wedge scoring table in `01` §8 → India premium private + multi-campus groups primary, IB/international same-metros secondary, US independent third, UK fourth, US districts last. Economics sanity check (`05` §1) exposed that naive Pro pricing is thin — led to group/enterprise mix, COGS-as-KPI, and AI-quota design.

**Round E — Recombine.** Final architecture: compact relational spine (the School Graph) + event-driven operating loop + policy engine (School Constitution) + AI gateway with permission-bound copilots + migration engine as the switching product (`03`, `04`).

**Round F — Stress test.** Tiny school: self-serve, WhatsApp-only surface, floor pricing — passes. Large school/group: campus scoping, group console — passes with V1 group tier. Public/district: excluded until V3+ with gates (Ed-Fi, SDPC). International/IB: pack architecture — passes. Low-connectivity: offline-tolerant critical paths defined (`04` §9) — partial by design, honest about limits. Regulated environments: policy engine drives AI modes (EU AI Act grading posture, DPDP consent) — passes with counsel caveat.

**Round G — Redesign.** Added: degraded-mode-without-AI requirement; sensitive-query shield for student AI; staged migration with rollback; digest batching as cost+UX lever; outcome meter; no-auto-block exam eligibility rule (education-access guardrail); support break-glass access model.

**Round H — Repeat.** Second pass focused on failure design (§9 of `03`), economics honesty (`05` §1.2 explicitly shows the thin-margin problem rather than hiding it), and moat honesty (`05` §5 — surfaces explicitly ranked WEAK). Marginal-gain point reached: remaining open questions are empirical (pricing validation, WhatsApp metering specifics, Arbor deal details) rather than conceptual.

---

## SchoolOS 2.0 — final refinement verdict (full detail: `docs/06-refinement-v2.md` §12)

**A. Already excellent (unchanged):** compact record · event-driven loop as schema · Constitution · permission-bound cited AI · migration-as-product · WhatsApp-first parent surface · teacher time-return · degraded mode · honest scope cuts.

**B. Missing (now added):** Obligation/Calendar engine (biggest gap — v1 could not answer "what's due next week") · Case engine (complaints/incidents/requests; system-raised, staff confirm-and-close) · Communication Orchestrator as a deterministic platform service · Data Health worker + score · Continuous Reconciliation (gateway/Tally, then GPS/payroll) · Control Plane + feature flags · closed-loop decision records · staff lifecycle · capture affordances (QR/photo-OCR/bulk grid).

**C. Changed:** governance consolidated into one Control Plane · five action shapes unified into one spine (ATTENTION/NEXT are views) · policy formalized into 3 layers (platform floor / regulatory / Constitution — tighten-only) · AI governance made capability-centric · briefing gains the forward band.

**D. Not changed:** wedge · compact-spine boundary and all scope cuts · 6 copilots + 5 workers (no new agents) · MVP scope · pricing architecture · deterministic-first · HUMAN-ONLY floor · parent-surface primacy · migration as the switching product.

**E. New primitives justified:** Case · Obligation · Communication · Data Health · Reconciliation · Control Plane — each traced to a concrete audited failure.

**F. Explicitly rejected:** procurement module · ITSM helpdesk · AI voice-call agents · auto-sent AI newsletters · asset lifecycle management · pre-consent cohort benchmarks · real-time queue forecasting · new agent personas.

**G–I.** Updated architecture (canonical layers/entity/event/action/policy/AI-governance models) → `06` §8; updated roadmap (V1 spine, V1.5 forward loop) → `06` §9 + `05` §3; updated moat (compliance-pack library + reconciliation upgraded to STRONG; outcome telemetry added) → `06` §10.

**J. Remaining risks (new):** WhatsApp metering dependency · principal-turnover champion loss · case-engine abandonment (mitigated by auto-creation) · forward-band accuracy (deterministic, assumption-labeled) · Control Plane complexity creep (a registry, not a rules engine).

**K. SchoolOS 2.0 thesis:** *SchoolOS is the school's operating loop, running in both directions of time.* Backwards: every event, decision, message, and payment lands in one compact, health-scored, audit-complete record, and the loop (event → policy → AI → approval → action → verification → audit) executes routine work under human control. Forwards: every obligation, deadline, SLA, and known risk is tracked with lead time and opened as a case before it becomes a fire, surfaced as **"Tomorrow"** — a deterministic, evidence-linked answer to *what will go wrong next week and what it needs from me*. The parent lives on WhatsApp, the teacher gets minutes back, the principal reads one cited briefing, the coordinator stops being the glue, the owner sees money and readiness — and switching takes days because migration is the product. AI accelerates every step it can prove itself on, is forbidden from the steps a school must decide, and the whole system runs with AI switched off.

**The category-defining feature:** the forward-operating loop — "Tomorrow" (`06` §11). Every incumbent reports the past; SchoolOS answers the school's real morning question deterministically, with evidence, before the fact.

---

## FINAL PRODUCT THESIS (v1.0 — superseded in part by 2.0 above; retained for the record)

**SchoolOS wins by moving the school's daily operating loop — attendance, fees, communication, coordination, compliance — inside one permission-bound, policy-bound, audit-complete system that runs on AI-assisted automation under human control, and by making switching (migration) a product instead of a project. The record is compact; the intelligence is deep; the AI proposes and the school disposes; the parent lives on WhatsApp/SMS, the teacher gets time back, the principal gets a cited morning briefing, and the owner sees money and growth.**

### Why this version is better than the starting hypothesis
It replaces "unified platform connecting 23 domains" (a feature checklist that forces incumbency-shaped scope) with a compact record + loop + policy substrate; it chooses a market wedge with defensible economics instead of launching everywhere; it converts switching cost from a services line item into the primary product; it makes AI trustworthy by architecture (permissions, citations, approval boundaries, degraded mode) rather than by promise; and it removes the modules that would have consumed the company (14 agents, 3D twin, general simulation, marketplace-first, LMS authoring).

### What was removed
14-agent zoo (→ 6 copilots + 5 workers) · 3D digital twin · general what-if engine · launch marketplace · LMS content authoring · HR payroll depth · library module depth · student social feed & gamification · emotion recognition & facial-recognition defaults (permanent) · parent-paid tiers · advertising/data monetization (permanent).

### What was added
AI Migration Engine as a product with staged rollback · School Constitution (policy engine binding AI and automation) · WhatsApp/SMS-first parent surface with one prioritized digest · cross-tenant workflow/policy library (privacy-sandboxed) · outcome meter (measured minutes saved) · School Memory with decision records · Sensitive-Query Shield for student AI · degraded mode (full function with AI off) · fee intelligence (defaulter worklists, reconciliation to the paisa) · board-pack generator · AI action risk classes (AUTO/APPROVAL/HUMAN-ONLY) enforced in code.

### Top 10 differentiators
1. Time-to-live in days (migration-as-product, staged switch, rollback).
2. The operating loop as core schema (event→policy→AI→approval→action→verify→audit), not a feature.
3. WhatsApp/SMS-first parent surface with prioritized, paid-actionable digest.
4. Cited-everything AI (briefing numbers link to records; "cite or stay silence" rule).
5. School Constitution — school rules as data that bind automation and AI modes.
6. Teacher copilot that returns time in week one (voice-first capture, zero added entry burden).
7. Outcome meter — the product proves its own value at renewal.
8. Fee intelligence tied to the owner's P&L (India wedge currency).
9. Cross-tenant workflow/policy library — automation everyone inherits.
10. Governed-AI posture as a product (risk classes, evals, audit ledger, region pinning).

### Top 10 moats (ranked honestly)
STRONG: migration corpus & mapping engine · workflow/policy library network effect · School Memory institutional history · local rails glue (WhatsApp/DLT, UPI, Tally, GPS, board formats) · record gravity with portable-by-principle data.
MODERATE: eval corpus & safety track record · policy engine depth.
WEAK (copyable; never claimed as moat): copilot UX, briefing screens, feature breadth.
FUTURE-MODERATE: marketplace/ecosystem, Skill Passport portability network.

### Top 10 risks
Parent-facing AI error · child-data breach · India price-anchor trap · teacher rejection · academic-year churn cliff · implementation consulting spiral · AI cost blowout · incumbent copying of surfaces · regulatory surprise (DPDP rules, EU AI Act) · wedge misread.

### MVP / V1 / V2 / Long-term
- **MVP (12 wks):** tenancy+permissions+audit · people/enrollment · migration engine v0 · timetable+attendance loops · fee ledger+WhatsApp pay+digests · teacher copilot v0 · principal briefing v0 + Ask v0 · constitution v0 · approval inbox. Bar: partner school runs a full week with zero rows typed beyond approvals.
- **V1 (m4–9):** admissions funnel · transport+GPS · automation builder+library · HR-lite+payroll integrations · gradebook/report cards (CBSE) · School Memory v0 · IB/Cambridge pack v0.
- **V2 (m9–18):** learning intelligence depth · AI tutor v1 · 3 scoped solvers · 2D campus canvas · group/enterprise tier · US/UK pack builds · SOC 2 window.
- **Long-term:** Skill Passport (portable student credentials) · marketplace · US district gate (Ed-Fi/SDPC) · EU AI-Act conformance pack · multi-region; the workflow/policy library becomes the industry's shared operating knowledge base.

---

## Research appendix (integrations from delegated research agents)

### A. Regulatory & security intelligence — REPORTED (labels per agent: VERIFIED-WEB / TRAINING ~2024)

**Verified from web [V]:**
- FERPA school-official exception, 34 CFR §99.31(a)(1)(i)(B) — direct control + purpose limitation + legitimate-educational-interest access limits (Cornell LII).
- SDPC National DPA is the dominant US signing mechanism — vendors sign once via the SDPC Resource Registry (sdpc.a4l.org); SchoolOS should pre-sign NDPA before US motion.
- India DPDP Rules 2025 notified (MeitY/PIB): Act + Rules operative with phased windows; children under 18 require verifiable parental consent; tracking, behavioral monitoring, and targeted advertising directed at children are prohibited; penalties up to ₹50 crore for safeguard failures; Significant Data Fiduciary triggers (DPO in India, audits, DPIAs); registered Consent Managers.
- EU AI Act: education AI is high-risk (Annex III(3): admissions, evaluating learning outcomes incl. steering learning, level placement, test-behavior monitoring); emotion recognition in education prohibited (Art. 5(1)(f)); high-risk obligations (risk management, logging, human oversight, accuracy/robustness, conformity assessment) apply from 2 Aug 2026; prohibitions + AI literacy from Feb 2025.
- ICO Children's Code applies to SchoolOS student surfaces (high-privacy defaults, no nudge techniques, geolocation off by default).
- UK DfE generative-AI product safety expectations (Jan 2025, updated Aug 2025) — filtering, age-appropriateness, alignment to safety standards for edtech AI.
- US ED Office of EdTech AI guidance emphasizes human-in-the-loop for consequential student decisions.

**Training-knowledge, high confidence [K]:** COPPA school-consent mechanics (FTC 2017 guidance; amended rule tightening retention/WISP from mid-2025 — confirm dates); SOPIPA; NY Ed Law 2-d + Part 121; PPRA eight protected survey categories; SOC 2 Type II as de-facto US procurement gate; WCAG 2.2 (Oct 2023) as build target with VPAT/ACR collateral; ADA Title II 2024 DOJ rule (WCAG 2.1 AA for public schools by 2026/2027 by entity size); RPwD Act 2016 + ICT Accessibility Standards (2021) in India; UK GDPR Art. 28 processor DPAs + DPIAs for profiling/grading edtech; transfers via IDTA/UK Addendum.

**Design lessons from breach history [K + agent inference]:** PowerSchool Dec-2024 incident (compromised maintenance/support portal account; ~60M student + ~9.5M educator records; reported extortion aftermath), Illuminate (2022), Edmodo (2022) — recurring root causes: over-broad standing credentials, long detection latency. → Engineering requirements adopted into `04` §8: JIT break-glass access only (no shared maintenance backdoors), session recording, configurable ≤24h breach-notification pipeline per contract, tenant-isolation proof pack.

**Adopted requirements now reflected in docs:** PPRA gating for any survey features; WCAG 2.2 AA build target; SDPC NDPA pre-sign; DPDP consent layer (verifiable parental consent + Consent Manager integration); AI risk-management file per feature with 2 Aug 2026 conformity prep; hard architectural ban on emotion recognition; no shared maintenance credentials.

### B. Sector trust environment — verified directly this session [V] (Wikipedia API fetches)
- **PowerSchool (Dec 2024 breach):** attacker used stolen contractor credentials against a support/maintenance portal to exfiltrate full-customer database extracts (~60M student + ~9.5M educator records reported), followed by extortion of individual districts; prosecuted in connection with the ShinyHunters extortion ecosystem (Wikipedia: ShinyHunters; US DOJ reporting). PowerSchool is now owned by Bain Capital (take-private completed, per PowerSchool's announcement referenced on Wikipedia).
- **Canvas LMS / Instructure (April–May 2026 breach):** unauthorized access April 25, 2026, detected April 29, disclosed May 1; exposed names, emails, student ID numbers, and user messages; company stated no passwords/DOB/government IDs/financial data involved (Wikipedia: 2026 Canvas data breach).
- **ParentSquare acquired Remind in November 2023** (Wikipedia: Remind) — US parent-communication consolidation continues; supports the "partner-then-absorb surface" posture toward comms point tools rather than competing head-on in the US.
- **IB scale:** over 6,234 schools offer one or more IB programmes worldwide as of July 2026 (Wikipedia, citing IB's Find a World School list) — the IB/Cambridge beachhead is a real, addressable global segment.
- **Implication for SchoolOS [I]:** education platforms are now proven crown-jewel extortion targets, and school buyers know it. Security posture stops being a procurement checkbox and becomes a *sales asset*: tenant-isolation proof pack, no-shared-credential privileged access, breach-notification pipeline, and a public security whitepaper should be in the first sales meeting, not the last.

### C. India ERP market · D. US/global incumbents · E. UK/IB landscape — research abbreviated at sponsor's direction before completion. The affected competitive claims remain tagged [K] (training knowledge ≈2024–25, flagged for citation) in `docs/01` §5 and `docs/05`; the strategic read does not depend on them, because it rests on structural properties (data models, deployment models, buyer economics) rather than current feature lists. Items most worth verifying before investor/customer conversations: Teachmint's 2024–25 pivot details · Arbor–ParentPay Group deal specifics · current PowerBuddy/Gemini-for-Education/MagicSchool adoption numbers · Indian ERP price lists · Meta WhatsApp pricing tiers.
