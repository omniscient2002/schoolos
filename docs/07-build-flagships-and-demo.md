# 07 — The v3 Build: Flagships, Re-Opened Verdicts, and the Demo Script

**Status:** the third layer of the product record. v1.0 produced the blueprint (Rounds A–H), v2.0 refined the architecture (`06-refinement-v2.md`). Since then the frontend was **built**: 56 screens, 57 routes, zero-TSC, production bundle, headless-verified. This document records what the build changed, re-opens the two §12.F rejections the build contradicted, documents the two flagships, and gives the canonical demo script.

Claim labels carry over from the README: **[V]** verified in the build, **[I]** inference, **[D]** proposed design.

---

## 1. The two re-opened verdicts (docs/06 §12.F, rescinded with reasons)

### F1 — "AI voice-call agents" → **RESCINDED, now the AI Reception flagship**
v2.0 rejected telephony AI as compliance risk, reasoning SMS/WhatsApp suffices. Three things changed:

1. **The compliance risk is now engineered, not feared.** The desk ships with a consent line ("This call may be recorded… say STOP"), caller verification before any student data, an explicit never-do list, and a policy hook (Front Desk §1.1–1.4). The risk was real; the mitigation is designable. [V — `Reception.tsx`, `mock/reception.ts`]
2. **India's actual front-desk reality made the cost of rejection worse than the risk.** Schools miss 30–60% of parent calls during admission season; WhatsApp doesn't answer the phone. A desk that answers in 3 seconds in Hindi/Hinglish, grounded in the school's own records, is a wedge no ERP has. [I]
3. **The deterministic pattern already existed in the codebase** — the maintenance voice-completion parser proved voice→fields works honestly (transcript stored beside parsed values, nothing silently guessed). The desk is the same pattern pointed at the gate. [V]

**What shipped:** 7 fully-scripted calls (Bus 14 tracking in Hinglish, pending-settlement fee receipt, TC request, hazard-report handoff, guardian-informed absence, admissions booking, no-response), visitor register, gate passes, intent-mix bars, escalation ladder (answer → callback → live handoff → emergency interrupt), per-call EvidenceChain + AiTraceCard, handoff-rate and cost telemetry.

### F2 — "Asset lifecycle management" → **RESCINDED, now the Maintenance flagship**
v2.0 scoped facilities to "registry only." The build demonstrates why the *operating loop* (not a new subsystem) is the right frame: the 13 maintenance screens are the v2 primitives — capture affordances (QR/voice/photo), SLA-from-policy, evidence-first AI, audit trail, School-Memory learning — applied to one domain. Verdicts survive; scope lines were drawn before the loop existed. [V]

**The bridge that resolves the "dual facilities model" finding:** a facilities **Case** (docs' model) *raises* a **Work Order** (built model), the WO *executes*, and resolution *verifies and closes* the case. One lifecycle, two names: `Case (facilities) → WO_FLOW → verify → case closed`. The case spine (raised→triaged→owned→acted→verified→closed) and `WO_FLOW` (reported→assigned→accepted→en-route→on-site→repairing→verification→resolved) are the same shape; the WO adds field-operations granularity the case spine deliberately abstracts. [D — canonical relationship, to be encoded in docs/04 §4 as a 1:N case→WO link]

---

## 2. Flagship A — Maintenance & Facilities Operations (13 screens)

The seven-step principle, implemented: **UNDERSTAND → PRIORITIZE → ASSIGN → ACT → VERIFY → LEARN → PREDICT**. [V]

| Capability | Where | Honesty mechanism |
|---|---|---|
| One-line report → structured WO | ReportIssue | Rule extraction (room regex, asset word-match, safety keywords); confidence shown; low-confidence files as general |
| Deterministic priority | SLA_POLICY table | emergency 10m/4h · critical 30m/8h · high 1h/24h · medium 4h/72h · low 8h/168h; overrides audited with reason |
| Explainable assignment | recommendTechnicians | score = skill 0.45 + first-time-fix 0.30 + availability 0.25; "why" rendered per technician |
| Technician copilot | TechnicianWorkspace | asset history, manual, inspection steps; AI as decision support, never a verdict |
| Voice-to-fields | same | canned transcripts parsed to parts/labour/duration; transcript always stored beside parsed fields |
| SLA engine | slaState | countdown pills, breach → escalation + Attention surface |
| Asset health | AssetRecord.health | derived from failure count/spend/age/PM adherence — never entered by humans |
| Replacement intelligence | replacementView | rule-based: spend ratio > 20% OR age > 75% life with 3+ failures; UI states "not a predictive model" |
| Preventive compliance | Preventive, Inspections | plans → generated inspections → failed findings → WO in one tap |
| Inventory | MaintInventory | thresholds → purchase requests; completion auto-decrements |
| Facilities map | MaintMap | SVG floorplan, asset dots by status, pulsing open-WO rings |
| Intelligence | MaintIntelligence | money-by-building, repeat-failure table, SLA donut, technician performance |

**Narrative anchors:** WO-1045 projector (NOR-PRJ-204, Priya Iyer, 97% match) · NOR-AC-04 4th failure (₹18,400/63d → replacement flag) · WO-1041 Bus 14 emergency · WO-1046 CCTV (Arif Shaikh's demo queue).

## 3. Flagship B — AI Front Desk (Reception)

Phone + WhatsApp + walk-in, one desk, zero hold music. Grounded answers only; student data only after caller verification; hands off with full context; emergency interrupt rings the duty principal (Front Desk §1.4). Handoff is a success state, not a failure. Visitor register and gate passes (guardian informed before departure, Safeguarding §2.1) live on the same screen. [V]

**Reception guardrail set (the designable compliance answer):** consent line → caller verification → grounded-or-say-so → sensitive topics route to humans → emergency keyword interrupt → transcript + trace stored per call. [V]

## 4. v3 build deltas to v2.0 primitives [V]

| v2.0 primitive | Build evidence |
|---|---|
| Obligation/Calendar engine | seed: 9 obligations, 12 calendar events; Today band; CalendarScreen |
| Case engine | Cases/CaseDetail, CaseKind incl. transport + exception; KIND_SLA table |
| Communication Orchestrator | ParentChat; notification rail; DemoBar comms events (partial — no unified comm_log panel yet, honest gap) |
| Data Health worker + bulk grid | DataHealth: score, worklists, **spreadsheet-grade paste-fix grid with validate/preview/apply/undo** (the docs' "V1 requirement") |
| Continuous Reconciliation | Fees gateway diff, Route 7 cluster (partial — no live Tally sync, honest gap) |
| Control Plane | ItAdmin registry table: flags + AI capability profiles + policy versions + integration scopes; flag toggles write through it |
| Forward loop ("Tomorrow") | Today's **Tomorrow** band: SLA clocks closing <6h, obligations, decision reviews |
| Capture affordances | QR pre-fill, photo attach, voice-to-fields (intake + completion), bulk grid |
| Migration-as-product | **Migration console** (`/migration`): 5 sources, 5,099 rows, fix queues with proposed fixes, 5-phase cutover, trust receipt, rollback door |
| School Memory | 5 closed-loop decisions with expected-vs-actual; 3 meeting extractions; Memory screen |

**Honest gaps (not hidden):** no live ASR/telephony behind Reception (canned transcripts) · no real gateway/WhatsApp webhooks · migration console shows Meridian's completed onboarding, not a live importer · Communication Orchestrator lacks a single trace panel.

## 5. The 15-minute demo script (reconciles docs/05 §6 — Act 0 is now showable)

**Act 0 — The switch (2 min).** `/migration` as principal or owner: 5,099 records, 85 flags each with a proposed fix, open NOR-AC-04's invoice-matching flag. One line: *"Every row is stamped with its source; nothing overwrites; rollback stays live 30 days."*

**Act 1 — The morning (2 min).** `/today`: briefing, **Tomorrow** band showing an SLA clock closing in 5.2h. Open the work order from the band — the clock is real, deterministic.

**Act 2 — The report (3 min).** `/maintenance/report` as teacher: type the projector line; watch understanding (97% asset match), priority with reasons, technician recommendation with the "why". Assign. Switch to technician — accept, en route, copilot, voice completion.

**Act 3 — The question (2 min).** `/ask`: "Why does the science lab AC keep failing?" — evidence chain walks the 4-failure table; replacement evaluation is rule-based and says so.

**Act 4 — The desk (2 min).** `/reception`: play RC-214 (Bus 14 in Hinglish) and RC-211 (hazard → live handoff). Intent-mix bars; escalation ladder.

**Act 5 — The proof (2 min).** `/audit`: every action taken above is already in the ledger, with actor, policy and outcome. Close on `/maintenance/intelligence`: the money, the repeat offender, the honest footnote.

**Act 6 — The chaos (2 min).** DemoBar → Maintenance sims → Elevator entrapment: emergency escalates across board, Attention, events, ledger — live.

**DemoBar cheat-sheet:** role switcher (10 identities) · Scenario tours (incl. 10-step "Projector that got fixed") · Maintenance sims (AC repeat, elevator, plumbing, SLA breach, parts shortage, front-desk call, migration dry-run).

## 6. Route map (57)

`/today /attention /ask /next /people /learning /operations /maintenance (+11 subroutes) /reception /migration /insights /automation /memory /calendar /documents /data-health /audit /constitution /ai-governance /ai-usage /it /group /action-center /cases (+detail) /incidents /admissions /fees /facilities /operations/hr /person/:id /settings /student (×4) /parent (×4)` — full list: `app/src/App.tsx`.

## 7. Seed corpus → what it demonstrates

| Corpus | Count | Consumed by | Evidences |
|---|---|---|---|
| Students/sections/attendance (30d, 8-B anomaly planted) | 1,472 / 30 / ~44k marks | Attendance, Today, Ask, Insights | 8-B investigation, Bus 14 ripple |
| Guardians (+ duplicate clusters, emergency-contact gaps) | ~700 | DataHealth worklists, bulk grid | Data Health worker |
| Fee ledger (47-failure Route 7 cluster) | 2,913 txns | Fees, Ask, Attention | Reconciliation, Narrative coherence |
| Leads / admissions | 68 | Admissions | Funnel discipline |
| Routes/buses/GPS + Bus 14 roster (38 riders, 15 in 8-B) | 10 / 418 | Transport, Attendance, Reception | Cross-module event ripple |
| Assets/technicians/WOs/plans/inspections/inventory/vendors | 10+ / 6 / 8 / 8 / 5 / 10 / 5 | 13 maintenance screens | Flagship A |
| Reception calls/visitors/gate passes | 7 / 5 / 2 | Reception | Flagship B |
| Obligations/decisions/meetings/policies/workflows | 9 / 5 / 3 / 14 / 6 | Today, Memory, Automation, Constitution | v2.0 primitives |

## 8. Verdict

The build did not contradict the v2.0 thesis — it **proved it**: every flagship is the same operating loop pointed at a new domain, and the two rescinded rejections came back stronger *because* they were rebuilt on the loop's guardrails. The OS now answers the three questions every school asks daily — *what needs me, what's coming, who's on it* — from the front gate to the board pack. Remaining gaps are integration-shaped (telephony, gateways, live import), not architecture-shaped.
