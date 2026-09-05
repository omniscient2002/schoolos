# 09 — Red-Team Audit: Can SchoolOS Survive Contact With Reality?

**Audit roles:** principal product strategist · SaaS architect · AI systems architect · school-operations expert · security/privacy reviewer · GTM strategist · CFO · hostile competitor.
**Method:** every section attacks; nothing was praised unless it survived attack. Rules honored: deterministic-first preserved; no new agents; scope changes require evidence; subtraction preferred.
**Inputs:** docs/01–08 (source of truth) + the shipped v3 build (56 screens, mock layer).

---

## 1. EXECUTIVE VERDICT — 68/100 (as-is) → 79/100 with the targeted changes below

**Why not higher, as-is.** The architecture is unusually coherent for an early product: one operating loop, deterministic-first AI with provenance, an honest audit spine, and a demo that proves the *coherence* (the Bus 14 event rippling through transport → attendance → fees → briefing is real, verified, and rare in this market). But coherence is a property of the design, not of the market. The 32 missing points are: (a) zero real-world validation of the three riskiest claims — voice quality, principal habit, migration speed; (b) unit economics that flip from good to bad based on two variables the plan doesn't yet control (support ratio, voice/AI COGS); (c) an incumbent copy window measured in quarters; (d) two retention-critical school functions (exams/report cards, absent-teacher cover) that are absent; (e) internal product redundancy (legacy Facilities screen vs the flagship; Next vs Tomorrow vs Attention) that will confuse the first 100 users.

**Why not lower.** Most products at this stage die of incoherence or dishonesty; SchoolOS has engineered both away. The remaining risks are execution-shaped, and the plan's own gates (docs/08) already anticipate several of them.

---

## 2. TOP 10 STRENGTHS (only ones that materially matter)

1. **The operating loop is one loop.** Fees, buses, broken projectors, and parent calls all flow through intake → record → rank → action → audit. Every new domain is configuration, not a new product. This is the difference between a product and a feature factory.
2. **Deterministic-first is enforced, not aspirational.** SLA clocks, priority tables, ranking orders, replacement rules, and the desk's answer router are all rule systems; LLMs sit only at language edges. This makes costs predictable and failures degradable.
3. **Provenance is a UI contract, not a slide.** `EvidenceChain` + `AiTraceCard` render on every AI surface with data-used/policy/verification/cost. Any backend that fails to feed them real provenance is visibly broken. Copying this requires incumbents to rebuild their data access, not just their UI.
4. **Migration-as-product with a trust receipt.** Never-overwrite, dry-run sandbox, flag-and-propose fix queues, sum-check reconciliation, 30-day rollback. This attacks the real reason schools stay on Excel: fear of losing history.
5. **The audit ledger is the product's memory and its alibi.** Every action carries actor, policy, reason, outcome. Support, trust, compliance, and the closed-loop School Memory all draw from the same table.
6. **WhatsApp-first parent surface is market-truth.** Parents live on WhatsApp; incumbents' portals die of login friction. Riding the channel (not replacing it) is the single best adoption decision in the plan.
7. **Degraded mode is designed.** AI-off operation, offline-tolerant critical paths, human ring-through at the desk, landline fallback. The system's floor is "a good school ERP," not "a broken demo."
8. **Honest scope boundaries.** The kill list (no LMS, no payroll engine, no library, no social feed) survived two refinement rounds and the red team. Restraint is documented and repeatable.
9. **The seed corpus doubles as a test suite.** 1,472 students, planted anomalies (8-B collapse, Route 7 payment cluster, AC-04 failure curve) are narrative *and* regression fixtures — the demo's coherence is convertible into CI.
10. **Capture-at-source ergonomics.** One-line reports, QR pre-fill, voice-to-fields with transcript-beside-parse, paste-grade bulk grids. The data-entry burden was priced at the person doing the work, which is why staff adoption is plausible.

## 3. TOP 15 WEAKNESSES (ranked by severity)

1. **Nothing is validated.** Voice intent-accuracy, briefing habit formation, migration speed, and parent response rates are all assumptions with good stories. Every number in docs/05 is unmeasured. (Severity: fatal-if-unaddressed.)
2. **No exams / report cards / gradebook.** For a school, the two moments the whole community touches records are fees and report cards. Absent this, renewal conversations happen while the product feels optional. (High.)
3. **Absent-teacher day is uncovered.** The audit's school-day simulation shows the loop *sees* the gap but cannot *close* it (no cover orchestration). On the day a teacher falls sick, SchoolOS becomes another screen. (High.)
4. **Support economics are the swing variable.** GM swings ~15 points between support ratios of 1:15 and 1:25. The plan assumes 1:20 at GA without evidence. (High.)
5. **Voice COGS and quality risk (hi/Hinglish ASR).** 2,000 calls/month × quality-sensitive ASR; a bad accent day erodes desk trust faster than any feature builds it. (High.)
6. **Incumbent copy window.** Teachmint/Entab-class incumbents have distribution; an "AI morning summary" copy ships to thousands of schools in 2–3 quarters. Feature-level differentiation decays; the defensible layers must be deliberately deepened (see §12). (High.)
7. **Tomorrow's PREDICTED class is an open invitation.** Nothing in the current design prevents someone from wiring an LLM into "predicted" and destroying the surface's credibility. It needs a formal class contract now (§5). (Medium-high.)
8. **Product redundancy.** Legacy Facilities screen duplicates the flagship; Next/Attention/Tomorrow overlap; ParentChat is a standalone simulation of what production must make real. Confusion at first contact. (Medium.)
9. **WhatsApp dependency is rented land.** Meta pricing/policy changes can reprice the parent channel overnight. SMS + voice fallbacks exist; the risk is cost + deliverability, not existence. (Medium.)
10. **Data moat cold-start.** Outcome telemetry (did the message recover fees?) is the compounding asset, but it starts empty and needs explicit instrumentation from day one or it never exists. (Medium.)
11. **Founder-led sales doesn't scale past ~25 schools.** No channel strategy exists; the wedge (morning briefing) is demo-able remotely, which helps, but a partner/inside-sales motion is undefined. (Medium.)
12. **Offline-first is promised, not built.** Technician PWA and register offline paths are Phase 3/4; a basement dead-zone or a dead tower breaks the loop today. (Medium.)
13. **Duty-principal delegation is implicit.** Permission model supports it; no explicit "deputy while I'm away" flow exists for the emergency ladder. (Medium.)
14. **Group/owner surface is thin value.** Cross-campus ask + read is fine; anything more is scope creep, anything less weakens the group deal. (Low-medium.)
15. **Evaluation coverage is asymmetric.** Ask and desk have eval plans; ranking, digest, and health-worker outputs have none. Silent drift in ranking would quietly rot the core surface. (Low-medium.)

## 4. FATAL RISKS

**Fatal if unaddressed**
- F1. **Unvalidated core loop at paid pilots.** If principals don't build the ≥4×/week briefing habit, everything downstream (renewal, expansion, telemetry) dies. Mitigation: design-partner gates (§10) with a kill/pivot rule on the briefing metric.
- F2. **Support ratio blowout.** One bad migration cohort can consume a support engineer for a month; two of those end the company at current pricing. Mitigation: paid migration, health gates before go-live, support-ratio gate per cohort.
- F3. **AI trust incident at a child-surface.** One wrong answer about a child's fee/attendance reaching the wrong person is a national WhatsApp story. Mitigation: verification gates, redaction middleware, no-student-data-to-unverified-callers as code, incident runbook drilled.

**Serious**
- S1. Incumbent copy of the briefing layer (mitigate by deepening data/workflow/migration layers, not by more features).
- S2. ASR quality on Hinglish (mitigate: intent-first routing, deterministic templates, human ring-through as default-of-mercy).
- S3. Meta repricing the parent channel (SMS/voice fallbacks priced into COGS from day 1).
- S4. Exams absence shortens renewal conversations (V1.5 pulled into first-year roadmap for pilot schools' Term reporting).

**Manageable**
- M1. Product redundancy (delete/merge per §5). · M2. Duty-principal delegation flow. · M3. Ranking drift (add eval). · M4. Group surface scope.

## 5. PRODUCT CHANGES (each justified by a finding)

1. **Kill the legacy Facilities screen** (`/facilities`) and fold its residual worklists (QR-scan issue, 48h-SLA case) into the Maintenance flagship. Resolves the dual-model contradiction (docs/06 §2.I vs the built WO subsystem); one intake, one lifecycle. *Frees scope; removes first-contact confusion.* (Justified: finding 8; docs/07 bridge.)
2. **Demote Next to a personal queue and make Tomorrow the only forward surface.** Next keeps: my actions, my obligations, my callbacks. Everything school-wide and forward-looking lives in Tomorrow under the class contract in §5-of-audit (E). Reduces three overlapping "what's next" surfaces to two crisp ones.
3. **Add Exam-Mode** to the Control Plane: a time-boxed quiet profile (suppress non-critical Tomorrow items and comms except fee/emergency; surface exam-day logistics). Cheap, deterministic, and it makes the product feel like it knows the school year. (Justified: school-day sim "exam period".)
4. **Ship Duty-Principal delegation**: principal sets a deputy for a date range; emergency ladder and approvals route to them; audit records the delegation, not just the action. (Justified: "principal unavailable" sim.)
5. **ParentChat becomes the *specification* of the real channel.** In production, parent chat IS WhatsApp (via the orchestrator); the in-app thread is a staff-side view of the same conversation, not a second channel. Prevents "another inbox" failure. (Justified: adoption + finding on redundancy.)
6. **Pull a thin Exams/Report-Card spine into the first-year roadmap** (marks entry via the bulk grid, grade policy per board as a versioned policy, remark *drafts* human-approved, printable card). Not the full exam suite — the minimum that makes renewal season land on SchoolOS. (Justified: weakness 3; creates room by removals above.)

## 6. ARCHITECTURE CHANGES

1. **Formalize the case↔WO bridge in the schema** (docs/07 §1 already states it): `cases.facilities` → 1:N `work_orders` → verification closes the case. One lifecycle, two granularities; the legacy "case-kind-only" model and the WO subsystem stop being rivals.
2. **Ranking service gets an eval suite + versioned params** (docs/08 §3.1) elevated to Phase 2 *must-have*, not should-have: golden fixtures from the seed narratives; precision checks on the top-5 Attention surface; params hashed into every response. (Justified: weakness 15 — the core surface must not rot silently.)
3. **Export protection:** every data export (CSV/PDF/board pack) is watermarked with actor+timestamp, rate-limited, step-up-authenticated, and audit-logged as `data.exported`. (Justified: attack path G-2.)
4. **Break-glass as a first-class flow:** time-boxed, dual-approved, customer-visible in the school's own audit view. (Justified: G-3; already philosophically present [V].)
5. **Comm_log as a unified surface now, not later:** the orchestrator (Phase 2) writes one `comm_log`; Attention/Today/Support read it. The Communication Orchestrator gap closes as infrastructure, not as a screen.

## 7. AI / SAFETY CHANGES

**Chain audit result:** every shipped capability was walked as DATA → RETRIEVAL → MODEL → TOOL → POLICY → APPROVAL → ACTION → VERIFICATION → AUDIT.

| Capability | Chain verdict | Change |
|---|---|---|
| ask.investigate (staff) | Complete (grounded retrieval, read-only, cited) | Keep; add eval set + drift monitor |
| ask broad-LLM fallback | **Incomplete** (no eval, unbounded scope) | **Classify draft-only; disabled by default at GA** until 95% grounded-answer pass rate on the golden set |
| maintenance.classify | Complete (deterministic rules; confidence shown; fallback files as general) | Keep; log rule-hit/miss for tuning |
| maintenance.recommend | Complete (deterministic score; human assigns) | Keep |
| maintenance.voice-complete | Complete (transcript-beside-parse; human confirms) | Keep; add ASR confidence floor → fallback to typed fields |
| reception.answer | Complete (verification gate, consent, grounded-or-handoff, emergency interrupt) | Keep; add weekly drill + 200-call hi/en eval gate before any volume ramp |
| digest/summary worker | Complete (batching, human sends) | Keep |
| message drafting | Complete (APPROVAL posture; receipts) | Keep |
| NL-to-workflow compiler | **Incomplete** (generates executable-ish artifacts) | Remains HUMAN-ONLY draft; not a shipped feature at GA |
| health worker | Complete (deterministic; fixes audited) | Keep; add eval on issue precision |
| Tomorrow ranking | Complete (deterministic) but **no class contract** | See §5-of-audit (E) below |
| desk emergency interrupt | Complete (keyword/intent + human bridge) | Add false-positive drill metric (≤1 false emergency per 500 calls) |

**E — the Tomorrow contract (adopt verbatim):**
- **DUE** = date comparison against a tracked commitment (obligation.dueDate, sla.resolveBy, plan.nextDue, contract/certificate expiry). Evidence: the date itself. FP/FN tolerance: FN = 0 (safety/finance), FP tolerated only when date provenance is stale.
- **AT RISK** = deterministic threshold on tracked state (SLA remaining < 50%, stock < threshold, collection −2pts WoW, PM overdue, health < 60). Evidence: metric + threshold + window. FP tolerance ≤ 20% of reviewed items.
- **LIKELY** = repeated-pattern rule with history (3rd same-asset failure in 90d; 2nd UPI-timeout week for a household cluster; absence cluster correlated with route delay). Evidence: the matched instances, linked. FP ≤ 20%; FN = 0 for safety-relevant classes.
- **PREDICTED** = model-generated forecast. **Ships empty.** A slot may only be filled after a model passes 8-week live backtesting with logged precision/recall, is versioned in the Control Plane, and states its interval. Until then the UI says "not yet supported — by design."
- **Must remain silent:** single-occurrence anomalies; anything attributing intent to a person; samples below minimum size; anything not citable to ≥2 records; anything the principal can't verify in one tap.
- **Trust model:** class badge + evidence links + deterministic consequence ("if you do nothing: escalation fires at 17:00, ledger records breach") + per-class precision/recall published in-product.

**Other AI changes:** provider-failure playbook (ASR/LLM down → desk ring-through + Ask degrades to record-links-only; banner states mode) [degraded-mode principle, now with concrete triggers]; regional residency config per tenant (ap-south-1 endpoints, provider BAAs); PII minimization in prompts (IDs over names where feasible); cost governor (per-tenant quotas, hard caps, overage = explicit action not silent spend).

## 8. BUSINESS / PRICING (recalculated, not inherited)

**Revenue model:** per-student-per-month (PSPM), India premium private.
- 1,500-student school @ ₹80 PSPM = **₹14.4L ARR** (~$17k). @₹120 = ₹21.6L.

**COGS per 1,500-student school (₹/yr, first principles):**
- Infra/hosting: 60–100k (multi-tenant)
- WhatsApp + SMS: 15–30k (≈60 conv/student/yr @ ₹0.15 blended + SMS fallback)
- AI gateway (Ask + desk + classify): 40–120k (desk ≈2k calls/mo @ ₹1–2; Ask usage per staff seat)
- Support (loaded ₹5L/engineer): 200–330k at 1:15–1:25 schools per engineer ← **the swing variable**
- Migration amortized: 10–30k/yr (if paid, near-zero after year 1)
- **Total: ₹3.3–5.8L → GM 60–77%** at ₹80 PSPM; ~75–82% at ₹100–120.

**Segment where margin becomes attractive:** ≥800 students (below that, support + fixed COGS swamp revenue: a 300-student school at ₹80 = ₹2.9L ARR vs ₹1.5–2.5L allocated COGS → GM 15–48%). Small schools: self-serve WhatsApp-light tier at floor pricing only in V2, never in the year-1 motion.

**CAC/payback:** founder-led, deal cycle 4–8 weeks; cash CAC ₹30–60k + founder time. Payback 3–6 months at ₹12–18k MRR. **If migration were free: +₹50–80k CAC → payback 8–12 months and margin distortion. Therefore migration is a paid product, never a discount.**

**Pricing changes (3):**
1. **Migration is paid onboarding:** ₹75k single-campus / ₹1.5L multi-campus, credited against year-2 renewal if the health gate (≥99.5% financial reconciliation) is met. Aligns incentives; protects COGS; the "trust receipt" is the deliverable.
2. **AI inside the plan with a monthly quota; overage billed at cost+30% with a hard tenant cap.** The 5× AI-cost stress becomes a pricing line, not a margin surprise.
3. **Group discounts at contract level only** (never per-campus), with a 3-campus minimum for group tier. Prevents margin leak while matching how groups actually buy.

**Unit-economics gates:**
- **MVP (10 pilots):** COGS ≤ 50% of pilot revenue (support-heavy acceptable); time-to-live ≤ 10 school-days; ≥4 of 10 principals active ≥4 days/week.
- **V1 (25 schools):** GM ≥ 65%; support ≤ 1:15; CAC payback ≤ 6 months; churn ≤ 2 schools/quarter.
- **GA (100 schools):** GM ≥ 72%; support ≥ 1:20; NRR ≥ 105%; gross churn ≤ 8%/yr; AI COGS ≤ 8% of revenue.

## 9. ROADMAP V2 (re-scored; scope-neutral via removals)

Scoring: VALUE × FREQUENCY × DIFFERENTIATION × REVENUE × RETENTION × DATA/MOAT ÷ (EFFORT × RISK × OPS-COMPLEXITY). Changes vs docs/05+08:

**KEEP NOW (unchanged):** Migration engine + record spine (highest score: switching + every sale needs it) · Today/Attention ranking · Action spine + audit ledger · Comm orchestrator + WhatsApp · SLA engine · Maintenance flagship · Data Health + bulk grid · Control Plane · paid-pilot motion.

**MOVE EARLIER:** Fee **collection** (links/mandates/receipts) from Phase 4 → alongside Phase 2/3 (retention: money touches the owner's KPI weekly; the audit's "fee collection failure" sim showed reconcile-only is half a loop) · **Safeguarding arrival net** (tiny build on existing intake; trust-huge; parent-facing value independent of staff adoption) · **Exam-Mode + duty-principal delegation** (days of effort, closes two sim failures).

**MOVE LATER (confirmed):** Timetable solver · full exam suite beyond the spine · IoT/energy · hostel · cafeteria · board-reporting packs (keep obligations-driven checklist in V1) · outbound voice.

**REMOVE:** Legacy Facilities screen (merge) · Group console beyond cross-campus ask/read/report (owner gets: group Ask, consolidated numbers, board pack; nothing else) · ParentChat as a second channel (staff-side view only) · "Simulation mode" as a marketed feature (it's a demo tool; label it so).

**INTEGRATE (never build):** Payroll (Tally/Zoho) · LMS content (Google Classroom/Toddle) · library hardware · biometric devices (SDK import).

**EXPERIMENT ONLY:** Outcome-attribution models (did the drafted message recover the money?) · Ask broad-LLM fallback (draft-only until eval gate) · NL-to-workflow (draft-only) · outbound desk reminders.

**V1.5 shape change:** thin **Exams/Report-Card spine** enters V1.5 (bulk-grid marks entry, per-board grade policy, approved remarks, printable card) — displacing items moved later; no net scope increase.

**Gates:** MVP → V1 requires the §10 gates green on ≥7/10 pilots. V1 → V1.5 requires GM ≥ 65% + NRR signal ≥ 100% + eval suites green (ask, desk, ranking). V1.5 → V2 requires GM ≥ 72% + support ≥ 1:20 + one group contract live.

## 10. DESIGN-PARTNER EXPERIMENT PLAN (first 10 schools)

| Metric | Baseline | Target | Measurement | Failure threshold | Action if failed |
|---|---|---|---|---|---|
| Time-to-live | n/a | ≤ 10 school-days | contract→cutover date | > 15 days | pause cohort; root-cause importer gaps |
| Migration accuracy | n/a | ≥ 99.5% financial rows reconciled | trust receipt vs bank | < 99% | free re-run + paid-cohort discount; fix importer |
| Teacher adoption | paper registers | ≥ 70% registers via product by wk 6 | register-source telemetry | < 50% | in-class shadowing; simplify to 2-tap register |
| Coordinator adoption | Excel mornings | fix-queue MTTR ≤ 48h; ≥5 uses/wk | ledger telemetry | MTTR > 96h | co-design session; flag taxonomies |
| Principal briefing usage | n/a | ≥ 4 days/wk by wk 6 | briefing-open telemetry | ≤ 2 days/wk after wk 8 | **kill/pivot rule**: rework briefing before any expansion |
| Parent engagement | n/a | ≥ 35% read/reply on templates | WhatsApp receipts | < 20% | message-frequency audit; vernacular test |
| Admin minutes saved | time-diary baseline | ≥ 5 hrs/wk/coordinator | pre/post time-diary | < 2 hrs | surface-level redesign |
| Error rate | n/a | < 1% records touched wrongly | audit + fix-queue | > 3% | importer/validation hardening |
| AI correctness | n/a | ≥ 95% on golden set; ≤ 2 wrong-answer complaints/term | eval + complaint log | < 90% | surface ships draft-only |
| Support burden | n/a | ≤ 2 tickets/school/wk after wk 4 | ticket telemetry | > 5 | onboarding redo before next cohort |
| COGS | n/a | ≤ 50% pilot revenue | finance + gateway metering | > 70% | reprice or cut AI quota |
| Willingness to pay | n/a | ≥ 7/10 renew at quoted price | renewal interview | < 5/10 | pricing revisit with evidence |
| Renewal intent | n/a | ≥ 70% signed by month 9 | contract | < 50% | stop rollout; fix retention before scale |

Sequencing rule: no surface expands beyond pilots until its gate is green twice consecutively.

## 11. CATEGORY POSITIONING

**"SchoolOS is the school's operating loop — the system that notices, explains with evidence, and closes every loop from the front gate to the board pack, with a human approving anything that matters."**

Not marketing because: (a) "operating loop" is a mechanistic claim — one spine (intake→record→rank→action→audit) demonstrably shared by every module, not a list of modules; (b) "with evidence" is enforced by a UI contract and an append-only ledger, both inspectable in a demo; (c) "human approving anything that matters" is a policy posture (AUTO/APPROVAL/HUMAN-ONLY) that competitors' demos visibly lack. The claim is falsifiable in a 15-minute demo, which is what makes it defensible language rather than a slogan.

## 12. MOAT TEST ("can a well-funded incumbent copy it in 12–24 months?")

| Moat | Verdict | Why copying doesn't/does destroy it |
|---|---|---|
| Feature | **Weak** — briefing, copilots, dashboards are copyable in 2–3 quarters | Copying the demo ≠ copying the loop: incumbents would bolt AI onto record-first systems; the loop's *shape* (rank→action→audit) is an architecture decision, but architecture is copyable with a rewrite. Not a moat alone. |
| Data | **Weak→Moderate** | Outcome telemetry compounds only with instrumentation from day 1 and consent-safe pooling; incumbents have data but not *outcome-labeled* data. Year 1: honest weak. |
| Workflow | **Moderate-Strong** | Each school's Constitution + 2 years of closed decision loops + audit ledger = process memory. Copying the feature doesn't copy the school's configured rules; switching means re-encoding institutional knowledge. |
| Migration | **Strong (near-term)** | The moat is the playbook + format library (Tally quirks, per-board ledgers, WhatsApp-log parsers) refined per real school. Tool = weeks to copy; 50-school format library = years. Remains a moat only while paid+productized. |
| Compliance | **Moderate** | DPDP/child-data posture as pre-built sales friction removal; copyable, but incumbents' legacy architectures make it a migration for *them*. |
| Network/knowledge | **Weak (by design)** | No marketplace; don't fake one. |
| Distribution | **Weak initially** | Group deals create internal stickiness; the parent WhatsApp graph creates a channel incumbents' portals never had — but the channel is rented. |
| Trust | **Potentially Strong** | Honesty (degraded mode, draft-only AI, published precision, audit alibi) is behavioral and slow to fake. An incumbent copying "trust" means adopting constraints that slow their feature velocity — the one copy that costs them. |

**Net:** the defensible stack is **migration playbook + workflow memory + trust posture**, deepened deliberately; feature parity will arrive and must not be the moat claim.

## 13. KILL LIST

1. `/facilities` legacy screen (merged into Maintenance flagship). **EXECUTED 2026-09-05 (v4.2):** route removed, `/facilities` now redirects to `/maintenance`, `Facilities.tsx` deleted (−509 lines), residual desk links re-pointed to the flagship.
2. NL-to-workflow compiler as a user-facing capability (draft-only lab).
3. Group console beyond Ask/read/consolidated-report.
4. ParentChat as a second inbox (becomes staff view of WhatsApp).
5. "Simulation mode" as marketed product surface (relabel demo tool).
6. Ask broad-LLM fallback as a GA feature (draft-only behind eval gate).
7. Any PREDICTED-class Tomorrow item until the backtesting gate exists.
8. Outbound voice calls (experiment-only; WhatsApp+SMS first).
9. Per-campus group discounts.
10. Free migration (it's a product; free = services trap + margin leak).

## 14. FINAL RECOMMENDATION — **BUILD WITH TARGETED CHANGES**

The thesis (operating loop on a compact record, deterministic-first, migration-as-product, WhatsApp-first) survives the audit. The changes are: deletions (kill list), two scope moves earlier (collection, safeguarding), one scope addition (exam spine in V1.5), the Tomorrow class contract, the AI chain re-classifications, paid migration, and the unit-economics gates. Nothing requires reworking the core.

---

## Post-audit record (as required)

**Revised score: 79/100.** (68 → 79: deletions remove confusion; gates convert assumptions to evidence; pricing changes secure margin; Tomorrow contract prevents the highest-probability self-inflicted trust wound. The remaining gap to 90+ is entirely real-world validation, which no amount of design can substitute.)

**Exact changes made (this audit):** kill list ×10; Tomorrow class contract; AI chain re-classifications (2 draft-only); case↔WO bridge formalized; ranking eval suite promoted to must-have; export protection + break-glass flows; paid migration + AI overage + contract-level group discounts; collection + safeguarding + exam-mode + delegation moved earlier; exam spine added to V1.5; design-partner gate table; support/GM/NRR gates per stage.

**Unresolved risks:** voice quality at Hinglish scale (unmeasurable pre-pilot) · principal habit formation (unmeasurable pre-pilot) · support ratio at real cohort diversity · Meta channel economics · incumbent response speed.

**Assumptions requiring real-world validation:** ≥4×/week briefing habit; ≤10-day migrations on messy real data; 35% parent engagement; ₹80–120 PSPM willingness at ≥800-student schools; 1:20 support ratio; ≤8% AI COGS; outcome-attribution lift on fee recovery.

**Three highest-priority actions next:**
1. **Sign design-partner #1 (an 800+ student premium school) and run the paid migration within 30 days** — every gate in §10 needs this, and it converts the biggest assumption (switching speed) into evidence.
2. **Build the Tomorrow class contract + eval suites (ask/desk/ranking) before the first pilot touches production** — the trust surfaces must be instrumented from birth; retrofitting precision stats later is impossible.
3. **Implement the kill list + paid-migration pricing in the demo and sales kit now** — they cost nothing, remove the first-contact confusion, and prevent a services trap from being set before the first deal is signed.
