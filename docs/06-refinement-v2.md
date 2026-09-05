# 06 — Final Architectural & Product Refinement (v2.0 pass)

> This document is the **delta**, not a rewrite. The v1.0 thesis (compact record · event-driven spine · School Graph · Constitution · permission-bound AI · READ→REASON→PROPOSE→APPROVE→ACT→VERIFY→AUDIT · Migration Engine · WhatsApp-first parent surface · degraded mode · child-safety boundaries) is the baseline and is **unchanged**. Everything here either fills a genuine gap found by audit, consolidates something scattered, or explicitly rejects a tempting addition.
> Ground rules honored: no feature-count growth; every addition must strengthen operating coverage, staff time saved, revenue, risk reduction, data quality, trust, switching, retention, intelligence, or moat. Claim labels: **[V]** verified web · **[K]** training knowledge · **[I]** inference · **[D]** proposed design.

---

## 1. Phase 1 — Capability audit (45 domains)

Verdicts: **EXISTS** (as designed) · **PARTIAL** (strengthen) · **MISSING** (add) · **EXCLUDED** (stays out; reasoning) · **INTEGRATION**.

| # | Domain | State | Verdict |
|---|---|---|---|
| 1 | Identity | EXISTS (unified person, SSO/OTP/WebAuthn) | PARTIAL: add effective-dated joiner/mover/leaver records for staff (admissions owns student lifecycle; staff lifecycle is thin) |
| 2 | People | EXISTS | Keep |
| 3 | Enrollment | EXISTS (effective-dated) | Keep |
| 4 | Guardianship | EXISTS (restrictions) | PARTIAL: verified-contact flags (parent verification loop → record badge) |
| 5 | Attendance | EXISTS | Keep |
| 6 | Timetable | PARTIAL (grid + conflicts; solver V2) | Keep as scoped |
| 7 | Learning | PARTIAL (V1) | Keep as scoped |
| 8 | Assessments | PARTIAL (V1/V2) | Keep as scoped |
| 9 | Fees | EXISTS | Keep |
| 10 | Payments | EXISTS | Keep; add idempotency standard (Phase 4) |
| 11 | Admissions | PARTIAL (V1) | Keep |
| 12 | Transport | PARTIAL (V1) | Keep |
| 13 | HR | PARTIAL (thin by design) | Keep thin; payroll INTEGRATION |
| 14 | Communication | PARTIAL — logic scattered across Digest Worker, notifications, constitution quiet hours | **MISSING-as-primitive → Communication Orchestrator (platform service, §4.4)** |
| 15 | Documents | PARTIAL | PARTIAL: expiry/renewal becomes Obligation-fed |
| 16 | Calendar | **MISSING** (no calendar entity in the v1 data model) | **ADD (§4.3)** |
| 17 | Incidents | **MISSING as object** | **ADD as Case kind (§4.4)** |
| 18 | Cases / service requests | **MISSING** | **ADD — one universal Case engine (§4.4)** |
| 19 | Tasks | EXISTS | Merge into unified action spine |
| 20 | Approvals | EXISTS | Merge into unified action spine |
| 21 | Facilities | PARTIAL (loop defined in `02`§7) | Map to Case kind + Obligation SLAs; 2D canvas stays V2 |
| 22 | Assets | THIN | Minimal asset registry (rooms/vehicles/IT) V1.5; no lifecycle management |
| 23 | Procurement | EXCLUDED | **STAYS EXCLUDED** (Phase 2H verdict below) |
| 24 | Vendors | THIN | Minimal vendor directory (transport contractors, AMC, facilities) feeding Cases |
| 25 | Compliance | PARTIAL (Compliance Worker) | PARTIAL: Obligation engine + case kind=compliance |
| 26 | Data quality | **MISSING as continuous service** (migration validates once; hygiene is a workflow) | **ADD Data Health worker + score (§4.6)** |
| 27 | Analytics | PARTIAL (V2 warehouse) | Keep |
| 28 | School Memory | EXISTS | PARTIAL: close the decision loop (§4.7) |
| 29 | AI | EXISTS | Keep; capability-centric governance (§4.8) |
| 30 | Automation | EXISTS | Keep; add circuit breakers (Phase 4) |
| 31 | Search | EXISTS (ASK) | PARTIAL: formalize one retrieval primitive across graph+events+docs+memory |
| 32 | Integrations | EXISTS (connector framework) | PARTIAL: add continuous reconciliation (§4.5) |
| 33 | Reporting | PARTIAL (board packs, report cards) | Keep |
| 34 | Mobile | EXISTS (PWA-first) | Keep |
| 35 | Offline | PARTIAL by design | Keep honest scope |
| 36 | Security | EXISTS | Keep |
| 37 | Privacy | EXISTS | Keep |
| 38 | Governance | **PARTIAL/scattered** (constitution, permission middleware, gateway, packs are four places doing governance) | **ADD Control Plane formalization (§4.1)** |
| 39 | Billing | Fee ledger EXISTS (school↔parent); SchoolOS's own subscription billing is vendor ops, not product | Keep |
| 40 | Multi-campus | PARTIAL (V1/V2 tier) | Keep |
| 41 | Internationalization | EXISTS (packs) | Keep |
| 42 | Developer platform | EXISTS (API/webhooks/sandbox) | Keep; webhook untrusted-input rule (Phase 4) |
| 43 | Migration | EXISTS (MVP) | Keep |
| 44 | Observability | EXISTS | Keep |
| 45 | Disaster recovery | EXISTS | Keep |

**Audit conclusion [I]:** the v1.0 system is complete on the *record* and *reactive loop* sides, and thin in exactly five places that daily operations actually run through: **Communication, Cases/Incidents, Calendar/Obligations, Data Health, Continuous Reconciliation** — plus one consolidation (Control Plane) and one deepening (Decision records). Notably, all six are *loop infrastructure*, not features.

---

## 2. Phase 2 — Missing primitives (A–M verdicts)

| Candidate | Verdict | Reasoning |
|---|---|---|
| **A. School Control Plane** | **ACCEPT (formalization, not new software)** | Governance is already spread across four mechanisms: Constitution (policy), permission middleware (identity), AI gateway (AI governance), packs (residency/retention defaults). They never drift *within* themselves but the *map* of them is tribal knowledge. The Control Plane is one versioned, auditable subsystem where all governance objects live (constitution versions, role/capability grants, AI governance profiles, automation policies, integration scopes, residency/retention classes, **feature flags** — absent from v1 entirely, approval matrices, audit config). Enforcement points (middleware, gateway, workers, orchestrator) read from it; every change is an audited event (`control_plane.changed`). Minimum addition: a governance registry + feature flags + single config API. Nothing else moves. |
| **B. Universal Action Center** | **ACCEPT (consolidation — explicitly *not* a new dashboard)** | v1 has five implicit mechanisms for "things needing humans": ATTENTION items, NEXT queue, approval inbox, tasks, and ad-hoc "tickets" in journeys. That's five object shapes with five state machines. Unify on **one action model** (§4.4): need attention → evidence → proposed action → owner → deadline → (approval gate) → action → verification → closure. ATTENTION and NEXT become *views* over the unified model. This is a subtraction of complexity disguised as an addition. |
| **C. Incident Management** | **ACCEPT — as a Case kind, not a separate system** | Incidents (safety, transport, teacher absence at scale, infra failure, exam issue, integration failure) share 90% of the case lifecycle. Distinct requirements honored via kind-specific policy: safety/safeguarding incidents are HUMAN-ONLY decisions, mandatory-review closure, stricter comms posture. Detected → triaged → assigned → acted → communicated → resolved → reviewed is a Case state path with kind=incident. |
| **D. Case Management** | **ACCEPT — one engine, kind taxonomy, auto-created** | Complaints, fee disputes, document requests, IT/staff/facilities/vendor requests, student-support referrals → one `case` object with kinds. **The anti-abandonment property is essential [D]:** cases are mostly *opened by the system* (from parent replies, anomaly detection, obligation breaches, reconciliation diffs, data-health verdicts, webhooks) — staff *confirm and close*, they do not do data entry to create tickets. Ticket systems die in schools precisely because logging a ticket is unpaid work. |
| **E. Communication Control Plane** | **ACCEPT — promote to platform service** | Every outbound message (digest item, reminder, escalation, incident note, marketing-free notice) passes one deterministic orchestrator: audience resolution → constitution filter (priority/quiet hours/language) → dedup/coalescing (audience×template×window key) → channel with fallback (WhatsApp→SMS→email→push per pack) → delivery receipts → reply classification → escalation to Case. **The orchestrator contains zero models** — it is rules and state. AI drafts content *before* the orchestrator; the orchestrator is the enforcement point for the "no autonomous external communication beyond the AUTO whitelist" invariant. This also fixes a cost risk: batching/coalescing is where WhatsApp spend is controlled (`04` §11). |
| **F. Data Quality Engine** | **ACCEPT — as a worker + score + worklists** | Continuous Data Health worker runs rule packs over the graph: duplicates, missing/unverified guardians, missing consent, date conflicts, enrollment errors, fee mismatches, timetable conflicts, broken relationships, expired documents, integration inconsistencies. Output: per-record health verdicts (feeding the action model), a per-school **Data Health score** shown to principal/owner (trend, not vanity), and completion tasks. Rule-based first; AI only for fuzzy entity resolution. **Health gates AI: AUTO-class actions on a record require the record to pass a health threshold** (synthesis with Phase 4). |
| **G. Continuous Reconciliation** | **ACCEPT — migration's missing second half** | Migration solves onboarding; drift starts the day after. A reconciliation worker continuously diffs connected systems against the canonical record: payment gateway vs fee ledger, Tally vs SchoolOS ledger, GPS roster vs transport roster, payroll vs HR-lite. Each diff: difference, source, severity, suggested resolution → approval → audit; unresolved diffs become Case kind=reconciliation. Deterministic diffing; AI only suggests resolutions. **Finance-person verdict [I]: without this, finance coordinators keep living in Tally** — this is what makes the fee ledger *trustworthy* rather than merely present. Scope: gateway + Tally at V1.5; GPS/payroll V2. |
| **H. Procurement + Vendor ops** | **REJECT (with one absorption)** | Full procurement loop is a different buyer (trustee/procurement office), a different rhythm (weekly-to-quarterly), and accounting systems already own POs — it would add a module without strengthening the daily loop. **Absorbed fragment:** contract/license/AMC *renewal deadlines* become Obligations, and a minimal vendor directory supports facilities/transport cases. Explicitly rejected: quotes, POs, goods receipt, three-way matching. Revisit only if group-tier contracts demand it (then as INTEGRATION). |
| **I. Facilities + Maintenance** | **MAP, don't build new** | The loop in `02`§7 (issue → ticket → assignment → SLA → vendor → cost → resolution → recurrence) is a Case kind (facilities) with SLA from Obligation, vendor from directory, and recurrence detection as deterministic clustering. AI only for triage/dedupe. No new subsystem. |
| **J. Institutional Planning** | **ACCEPT — Calendar + Obligation engine (the biggest genuine gap)** | v1 has timetable slots but **no school calendar entity at all**. Add `calendar_event` (exams, events, PTMs, holidays, inspections, trips) and `obligation` (any deadline-bearing duty: board filings, license/certificate renewals, fee milestones, compliance reports, insurance, staff certifications) with lead-time, owner, evidence, and breach→Case behavior. The briefing gains a **forward band** ("coming due: next 7/30 days") and the compliance pack pre-seeds standard filing dates per country pack. This answers the audit question "what can go wrong next week because of the school's calendar?" — which v1 literally could not answer. |
| **K. Decision Intelligence** | **ACCEPT — deepen, don't rebuild** | Extend `decision_record`: alternatives considered, evidence links, policy link (constitution version), approver, **expected result, review date, actual result**. Review dates become Obligations (coherence with J). This turns School Memory from an archive into a closed learning loop — and is the difference between "searchable history" and institutional intelligence. Small schema change, large moat contribution. |
| **L. Universal Search** | **ACCEPT (formalize)** | ASK already conceptually spans the graph; formalize **one retrieval primitive** over four stores (records/events/documents+memory) with structured filters ("all Route 7 complaints", "documents expiring this month", "who hasn't verified pickup?") and saved views. No new index types; permission-scoped as today. |
| **M. Operational Capture** | **ACCEPT — affordances over existing objects** | "Capture reality faster than humans can type it": voice (teachers, exists), photo+OCR (receipts, invoices, notices → Document + extraction), QR codes on rooms/buses/assets (scan → pre-filled Case with context), quick actions in PWA, spreadsheet-grade bulk grid editing for coordinators (the Excel-competitiveness requirement from Phase 6). No new primitive — input affordances over Case/Document/records. |

**Phase 2 net effect:** six new primitives (Control Plane, Action model, Case, Communication orchestrator, Obligation, Data Health), two strengthenings (Reconciliation, Decision records), one absorption (renewals→Obligation), one rejection (Procurement). Everything else maps onto what exists.

---

## 3. Phase 3 — AI classification (deterministic-first, enforced)

| Capability | Class | Note |
|---|---|---|
| Fee computation, receipts, statements | DETERMINISTIC | Never a model |
| Attendance marking, absence alerts, digests *assembly* | RULE-BASED (constitution thresholds) | No model in the send path |
| Communication orchestration | **RULE-BASED entirely** | The orchestrator has zero models — structural safety property |
| Timetable (V2), substitution fit | OPTIMIZATION/SOLVER | LLM only translates constraints and explains |
| Attendance anomaly, reconciliation diffing, data-quality rules, recurrence detection | DETERMINISTIC/RULE-BASED | SPC-style thresholds; explainable by construction |
| Entity resolution (migration, dedup) | AI CLASSIFICATION (+ rules) | Confidence-scored, human-confirmed merges |
| Document classification/extraction | AI CLASSIFICATION | Schema-validated outputs |
| Reply classification (complaint/crisis/intent) | AI CLASSIFICATION | Recall-prioritized for crisis; human review of triggers |
| Digest narrative, teacher drafts, rubrics, feedback batches | AI GENERATION | Human approves anything externally visible |
| Briefing narrative, Ask investigation, decision-review assist | AI REASONING | Grounded + cited; numbers recomputed deterministically |
| Enrollment/fee forecasting (V2) | STATISTICAL (assumption-labeled) | Not LLM; sensitivity bands |
| Discipline, admissions finals, grades, safeguarding, employment | HUMAN-ONLY | Platform-invariant |

**Missing AI capabilities audit:** anomaly detection → formalize Insight Worker (SPC + AI triage) — accept. Forecasting → V2 scoped. Summarization/document understanding/multi-step workflows/school-wide reasoning/decision support/data quality/search/reconciliation/comms orchestration/incident triage → **already covered by v1 + Phase 2, with most deliberately non-AI.** No new agents justified: every Phase-2 addition is a *capability* served by existing copilots/workers (e.g., reconciliation = Ops/Finance Copilot surface + a worker), not new agent identities.

---

## 4. Phase 4 — Red team: the autonomous agent

**Verdict on the v1 action contract:** READ→REASON→PROPOSE→APPROVE→ACT→VERIFY→AUDIT is necessary but **not sufficient**. It governs *single actions* well; it does not govern (a) what *enters* the system, (b) the *policy itself*, (c) *aggregate* behavior, (d) *inbound* trust, (e) *preconditions* of action. Ten genuine gaps found; ten safeguards added (all substrate, no features):

| Attack | v1 state | New safeguard |
|---|---|---|
| Prompt injection via documents | Partially covered (docs-as-data) | **Content-boundary middleware:** *all* tenant content (documents, messages, voice transcripts, notes) enters as untrusted data with provenance; tool calls originate only from the planner layer; document-processing workers run read-only with output allowlists |
| Malicious parent message (injection via WhatsApp reply) | Gap | Same content boundary; reply text is classified (never executed); complaint replies auto-open Cases, not actions |
| Poisoned school handbook (constitution poisoning) | Gap | **Dual control** on AI-governance/approval-matrix constitution edits; full version diff review; 3-layer policy model (§4.7) means the platform floor cannot be edited away |
| Hallucinated policy | Covered (RAG over constitution) | Keep |
| Stale policy | Covered (versions + drift detection) | Keep |
| Conflicting policies | Gap | **Constitution linter:** deterministic contradiction check at save (same scope+object+different outcome → error); conflicts cannot ship |
| Bad data → wrong action | Partial (verify stage) | **Health-gated AUTO:** AUTO-class actions require the record to pass data-health threshold; unhealthy records downgrade to APPROVAL |
| Wrong guardian (mis-delivery) | Gap | **Verified-contact gating:** sensitive-class communications require a verified contact + guardianship check from the orchestrator; unverified contacts route to confirmation, never to content |
| Cross-campus / cross-role leakage | Covered (ABAC + evals) | Keep |
| Incorrect automated communication | Covered (whitelist) | Orchestrator adds dedup/coalescing + rate caps per audience |
| Runaway workflow | Gap | **Circuit breakers:** per-workflow execution/fan-out/cost caps, depth limit + cycle detection for workflow-triggering-workflow, automatic pause + alert on volume/error anomalies |
| Recursive workflow | Gap | Included in circuit breakers |
| Duplicate payments | Implicit | **Idempotency keys** standard on all money and message operations; reconciliation diffs catch leaks anyway |
| Duplicate messages | Partial | Orchestrator coalescing key (audience×template×window) |
| Mass accidental updates | Covered (bulk = APPROVAL + preview/undo) | Restated under the unified action model |
| Model/provider compromise | Partial | Output schema validation on every structured call; provider-change review checklist; output anomaly alarms; provider diversity in registry |
| Malicious integration webhook | Gap | **Webhooks are untrusted input:** signature verification + allowlist per connector; webhooks may create Cases/exceptions, never direct mutations without validation; per-connector rate limits |
| Compromised staff account | Covered (JIT/MFA/kill-switch) | Extend anomaly alarms to AI-action volume per user |

---

## 5. Phase 5 — Red team: the business

| Tier | Items |
|---|---|
| **Existential** | (1) Child-data breach — controls reduce but never eliminate; response speed and honesty are the brand. (2) Parent-facing AI catastrophe at scale — mitigated by whitelist/orchestrator/degraded mode. (3) **India unit-economics failure** — if the Pro-school mix doesn't reach margin (`05`§1.2 honesty) and group/IB expansion stalls, the wedge starves. (4) Wedge misread — kill criteria exist (`05`§9.10). |
| **Serious** | **WhatsApp pricing/metering shift** (single-rail dependency; mitigation: multi-rail packs, batching, in-app fallback, per-pack rails) · teacher rejection · year-boundary churn · **principal turnover** (new: the champion leaves mid-year → embed at coordinator+owner level too, so value doesn't walk out with one person) · support-cost spiral · AI cost blowout · coordinator gatekeeper sabotage (mitigated by migration-as-product + bulk-grid parity with Excel). |
| **Manageable** | Incumbent copying of surfaces · Google/Microsoft bundling · regulatory change (packs absorb) · contained cyberattack (controls + IR) · procurement friction (India private schools don't run RFPs for this class) · free Excel+WhatsApp (countered by capture speed + outcome meter + reconciliation trust) · parent adoption failure (chat-first + digest + verification loop). |
| **Acceptable tradeoffs** | No US districts early · partial offline · no procurement module · PWA-not-native · one region per residency zone · no marketplace until pull. |

---

## 6. Phase 6 — Red team: the UX (the Excel+WhatsApp test)

| Role | The one thing they need most | v1 taps | Excel+WhatsApp verdict | Change |
|---|---|---|---|---|
| Principal | "What needs me, with proof" | 1 (briefing push) | Loses to SchoolOS | Add forward band (§5 Phase 11) |
| Teacher | Attendance gone + notes kept | 15s attendance, 20s voice note | Loses | None |
| Parent | "Is my child okay / what's due / what do I owe" | 0 (push) + reply | WhatsApp ties on medium, SchoolOS wins on signal+action | None |
| Coordinator | Not re-keying; daily queue | Queue 1 tap; but **bulk edits** were web-form-slow | **Excel wins bulk ops today** | **Spreadsheet-grade bulk grid** (paste, validate, preview, undo) — V1 requirement |
| Finance | Books reconcile | Exception queue existed; deep match still manual | **Tally wins today** | **Continuous reconciliation with one-tap closure** — the decisive fix |
| Admissions counselor | Follow-ups that send themselves (with approval) | 2 taps | Loses | None |
| Transport in-charge | Deviation → parents informed calmly | 1 | Loses | None |
| Owner | Money + risk in one glance | 1 (P&L console) | Excel is stale by definition | Add Data Health + readiness (trust in numbers) |
| IT admin | Control without tickets | SSO/keys/audit | Loses | Control Plane view |
| Student | Own work + help | 1–2 | Excel+WhatsApp does nothing for students | None |

**Finding [I]:** v1 loses to Excel+WhatsApp in exactly two places — coordinator bulk operations and finance reconciliation. Both are fixed by Phase 2 (M and G). That these were the two "serious" UX findings confirms the primitive-level diagnosis.

---

## 7. Phase 7 — The final OS primitive set

Derived from the audit (not assumed). **14 primitives + 2 substrates; many domains built from few primitives:**

| # | Primitive | What it is | What it replaces/absorbs |
|---|---|---|---|
| 1 | **Identity & Access** | Person, roles, capabilities, sessions, delegation | v1 roles |
| 2 | **Record** | Typed entities + relationships of the School Graph | v1 entities |
| 3 | **Event** | Immutable occurrence (append-only spine) | v1 event spine |
| 4 | **Policy** | 3-layer law: platform floor / regulatory pack / Constitution | v1 Constitution (formalized into layers) |
| 5 | **Task** | Assigned human work with deadline | v1 task |
| 6 | **Approval** | Gated action with evidence, SLA, escalation | v1 approval inbox |
| 7 | **Case** | Long-lived resolution unit; kinds: complaint, incident, request, facilities, reconciliation, compliance, exception | *absorbs* Incident (C), tickets, exceptions |
| 8 | **Communication** | Orchestrated message: audience, priority, channel, language, timing, dedup, fallback, receipts, reply-classification | *absorbs* Notification + Digest Worker send-path |
| 9 | **Obligation** | Deadline-bearing duty/event with lead-time, owner, breach behavior | *absorbs* Calendar (J), compliance deadlines, renewals, decision review dates |
| 10 | **Workflow** | Compiled event→condition→steps machine (+ circuit breakers) | v1 automation |
| 11 | **Decision** | Closed-loop decision record (alternatives, evidence, expected vs actual, review) | v1 decision_record (deepened) |
| 12 | **Memory & Retrieval** | One retrieval primitive over records+events+documents+decisions | v1 ASK/Search/Memory access |
| 13 | **Integration & Reconciliation** | Connectors + continuous diff against canonical record | v1 connectors (extended) |
| 14 | **Data Health** | Continuous per-record/per-tenant quality verdicts | new |
| S1 | **Audit** (substrate) | Append-only hash-chained ledger | v1 |
| S2 | **Control Plane** (substrate) | Governance registry binding all of the above | consolidates scattered governance |

Merged away: Incident (→Case kind), Calendar (→Obligation/Event), Attention/Next (→views over Task/Approval/Case), Notification (→Communication), separate ticket systems (→Case).

---

## 8. Phase 8 — Final canonical architecture

### 8.1 Layers

```
Surfaces: WhatsApp/SMS · PWA/mobile · web · group console
   ↓ (role-scoped views only)
Experience layer: TODAY · ATTENTION · NEXT · ASK · PEOPLE · LEARNING · OPERATIONS · INSIGHTS · AUTOMATION · MEMORY
   ↓ reads/writes through
CONTROL PLANE (substrate S2): identity & access · policy (3-layer) · AI governance profiles · automation policies ·
   integration scopes · residency/retention classes · feature flags · approval matrices · audit config
   ↓ enforced at every boundary
AI layer: gateway (registry/routing/cost/safety) · orchestrator (6 copilots + 5+2 workers) · evals · degraded mode
   ↓ proposes through
ACTION layer (the loop): Task · Approval · Case · Workflow · Communication orchestrator
   ↓ acts on
SCHOOL GRAPH: records · Data Health verdicts · Memory/decisions · Obligations/calendar
   ↓ emits
EVENT SPINE (append-only): events → audit ledger → automation → analytics
   ⇅
INTEGRATION & RECONCILIATION: connectors · continuous diffs → Cases
   ↓
Infrastructure: residency zones · managed queue · Postgres+RLS+pgvector · object storage · warehouse · DR · observability
```

### 8.2 Canonical entity model — additions

`case` (kind, origin, state, sla, owner, evidence links, comms thread) · `case_kind_policy` (per-tenant SLA/posture per kind) · `calendar_event` · `obligation` (type: filing/renewal/fee-milestone/review; lead_time; owner; evidence; breach→case) · `vendor` (minimal directory) · `asset` (minimal registry) · `reconciliation_run`, `reconciliation_diff` · `health_verdict` (per record + per tenant score) · `comm_log` (orchestrated send with full routing history) · deepened `decision_record` (alternatives, evidence, expected, review date, actual) · `feature_flag` (in Control Plane) · staff `lifecycle_record` (effective-dated).

### 8.3 Canonical event model — additions

`case.opened/triaged/assigned/acted/resolved/reviewed/closed` · `obligation.due_soon/due/missed/waived` · `comm.queued/sent/delivered/read/replied/classified/blocked` (blocked = orchestrator enforcement, audited) · `reconciliation.diff.found/accepted/rejected` · `health.verdict.issued/record.repaired` · `decision.recorded/decision.reviewed` · `control_plane.changed` · `workflow.paused` (circuit breaker) · `integration.webhook.rejected`.

### 8.4 Canonical action model

One spine, four shapes. States: **raised → triaged → owned → [gated: approval] → acted → verified → closed (+ reviewed)**. An `attention_item` is the surfaced form of any Task/Approval/Case; ATTENTION and NEXT are views with per-role ranking; closure requires verification evidence; Case kinds=incident/compliance add mandatory `reviewed` before close. Parent replies, anomalies, obligation breaches, reconciliation diffs, health verdicts, and webhooks **raise** items automatically; humans triage/own/approve — capture-free operations.

### 8.5 Canonical policy model (3 layers)

1. **Platform floor** (SchoolOS-invariant): HUMAN-ONLY set, no autonomous external comms beyond whitelist, children-access invariant, emotion-recognition ban [V], no child profiling-for-ads [V]. Cannot be loosened by anyone, including SchoolOS staff.
2. **Regulatory layer** (per country pack, machine-enforced): DPDP consent mechanics [V], FERPA purpose limitation [V], COPPA/PPRA modes [K], ICO Children's Code defaults [V], EU AI Act AI modes (assist-only grading) [V].
3. **Constitution** (tenant): may *tighten* anything above; never loosen. Validated by the constitution linter; dual control on AI-governance sections; every change versioned + audited.

Enforcement points unchanged (tools, workflows, orchestrator, retrieval, Compliance Worker) — but all now read one Control Plane source of truth.

### 8.6 Canonical AI governance model (capability-centric, not agent-centric)

Governance objects are **capabilities** (briefing-narrative, parent-ask, grading-assist, doc-classification, reply-classification, practice-generation, decision-review, entity-resolution, forecasting). Each capability declares: model class → data-access scope → grounding requirement → risk class → approval posture → eval suite → region pinning → retention → audit-sampling rate. Copilots/workers *compose* capabilities; governance never attaches to a persona. This closes the v1 ambiguity where "AI governance" lived in the constitution and the gateway simultaneously.

---

## 9. Phase 9 — Roadmap classification of every addition

| Addition | Class | Criteria notes (value/freq/effort/moat/risk) |
|---|---|---|
| Control Plane formalization + feature flags | **V1** | Eng architecture, invisible to users; prevents governance drift before scale |
| Unified action model (Task/Approval/Case spine; ATTENTION/NEXT as views) | **V1** | High frequency; consolidates 5 shapes into 1; MVP keeps simple approval inbox, spine formalized in V1 |
| Case engine — kinds: complaint, facilities, fee-dispute | **V1** | Auto-created cases; fixes "complaints live in WhatsApp" |
| Communication Orchestrator | **V1** | Platform service; cost control + safety enforcement point |
| Calendar events (core) | **V1** | Missing entity; high frequency |
| Operational capture: QR cases, photo+OCR receipts, bulk grid editing | **V1** | Closes the two Excel-wins gaps |
| Universal Search formalization | **V1** | Small |
| Data Health — first 10 rules + worklists | **V1** | Record quality → AI quality |
| Incident kind + mandatory review; compliance kind | **V1.5** | Needs case engine maturity + policy |
| Obligation engine + compliance pack (filing dates per country) | **V1.5** | High value; moderate effort; moat-relevant (regulatory labor) |
| Continuous reconciliation — gateway + Tally | **V1.5** | Finance trust decisive |
| Data Health full (all rule packs) + tenant score | **V1.5** | |
| Decision records deepened (closed loop) | **V1.5** | Small schema, big memory value |
| Vendor directory + asset registry (minimal) | **V1.5** | Serves cases only |
| Reconciliation — GPS + payroll | **V2** | |
| Forecasting (enrollment, collections) | **V2** | Statistical, assumption-labeled |
| Staff joiner/mover/leaver lifecycle | **V1.5** | |
| **REJECTED (exciting but rejected)** | — | **Procurement module** (different buyer; Tally owns POs; absorbed renewals only) · **ITSM-style helpdesk** (ITIL weight; Case covers it) · **AI voice-call agents** (telephony AI compliance risk; SMS/WhatsApp suffices) · **auto-sent AI newsletters** (external comms stay gated) · **full asset lifecycle management** (registry only) · **cohort benchmarks pre-consent-maturity** (FUTURE) · **real-time queue forecasting** (solver theater) · **more copilots/agents** (capabilities, not personas) |

**MVP is unchanged in scope** [D]: the twelve-week MVP stands; the spine work lands in V1 where it belongs. The only MVP-adjacent addition: parent replies auto-opening Cases (complaint kind) because it's trivial once the model exists — and it's the anti-abandonment property in embryo.

---

## 10. Phase 10 — Moat audit (copyability matrix)

| Moat | Google | Microsoft | PowerSchool | Startup-18mo | Verdict |
|---|---|---|---|---|---|
| Migration corpus | Won't (India formats) | Won't | Could (US) but not India rails | Hard (needs customers) | **STRONG** |
| Workflow library | No | No | Could seed from services history | Content compounding delays value | **STRONG (grows with WOC)** |
| School Memory / decision loops | No | No | No (per-tenant, retroactive-impossible) | No | **STRONG (2–3y)** |
| Event history | Same | Same | Same | Same | **STRONG** |
| **Policy/compliance pack library** (machine-enforced DPDP+FERPA+COPPA+ICO+AI-Act modes) | Won't (not their layer) | Partially (compliance tooling exists but not school-domain) | Partially (US only) | Content copyable; enforcement + trust + maintenance labor not | **STRONG — under-recognized in v1; upgraded** |
| Local rails glue | No | No | Not in India | 12–18mo focused work possible | **STRONG locally** |
| Continuous reconciliation depth | No | No | No | Possible but unglamorous | **STRONG locally (upgraded from v1)** |
| Data-quality *outcomes* (record quality compounds) | No | No | No | Only via time | **MODERATE-STRONG** |
| Eval corpus | Could fund | Could fund | Could | Needs scale | **MODERATE** |
| Trust/security track record | Time-gated for anyone | Time-gated | Damaged [V] | Time-gated | **STRONG (3y+) — competitors cannot accelerate it** |
| Cohort benchmarking | Could (but consent) | Could | Could (consent culture weaker) | Needs installed base | **FUTURE-STRONG** |
| Outcome telemetry (measured minutes saved at scale) | No | No | No (services model hides it) | Needs installed base | **NEW-MODERATE — pricing/renewal weapon** |
| Ecosystem/marketplace | — | — | — | — | FUTURE |

**Moat-audit conclusions:** (1) the compliance-pack library and continuous reconciliation are under-recognized moats in v1 — both are *regulatory and rails labor* that compounds and is miserable to copy; (2) trust/security history is now empirically a moat given sector breaches [V]; (3) outcome telemetry becomes a moat-adjacent asset once WOC scale exists. No v1 moat claim was inflated; none collapses.

---

## 11. Phase 11 — The category-defining feature

**Candidate search:** autonomous loop (vague), memory (retrospective), action center (plumbing), control plane (invisible), reconciliation (finance-only), school health score (vanity risk), decision intelligence (leadership-only), outcome engine (metric, not feature).

**The strongest answer [D], and it emerges from the primitives rather than being bolted on:**

> **The forward-operating loop — "Tomorrow."**
> The Morning Briefing gains a deterministic forward band: *what will break in the next 7/30 days* — obligations coming due (board filings, license renewals, fee milestones), cases breaching SLA, coverage gaps from planned absences, exam/event clashes from the calendar, data-health risks that will corrupt the next report run, reconciliation drift accumulating — **each with its evidence and a pre-opened Case or proposal.**
>
> Everything in the band is computed by rules, solvers, and lead-times over the graph — **not model vibes** — and every number links to its source. The composite view for the owner is **School Readiness**: are we operationally ready for next week, and what would it take?

Why this is the category claim: every incumbent school system — and every point tool — **reports the past**. A school's real morning question is not "what happened?" but "what will go wrong next, and what do you need from me to prevent it?" v1 could not answer it (no calendar, no obligations, no cases, no health). The 2.0 primitives make it a *property of the architecture*, not a feature: obligations provide the lead-time, cases provide the follow-through, health and reconciliation provide the honesty, and the action model provides the closure. The demo line upgrades from "every number had a source" to **"here is next Tuesday's problem, and it's already assigned."** No hype required: it is deterministic, evidence-linked, and falsifiable in front of a buyer.

---

## 12. Phase 12 — Final verdict

### A. What is already excellent (unchanged)
Compact record over feature sprawl · event-driven loop as schema · Constitution as machine-enforceable law · permission-bound, cited AI · migration-as-product · WhatsApp-first parent surface with the record-repair loop · teacher time-returning copilot · degraded-mode-without-AI · honest scope cuts (procurement, LMS, 3D, simulation depth) · the claim-label discipline and the displayed thin-margin economics.

### B. What is missing (and now added)
**Obligation/Calendar engine** (the biggest gap — v1 could not answer "what's due next week") · **Case engine with incident kind** · **Communication Orchestrator as a platform service** · **Data Health worker + score** · **Continuous Reconciliation** · **Control Plane + feature flags** · closed-loop **Decision records** · staff lifecycle records · capture affordances (QR/photo/bulk grid).

### C. What should be changed
Governance consolidated into the Control Plane (was scattered across four mechanisms) · five action shapes unified into one spine · policy formalized into three layers (platform floor / regulatory / Constitution) · AI governance made capability-centric · communication logic centralized into one deterministic orchestrator · briefing extended with the forward band ("Tomorrow") · AI-governance constitution edits require dual control · AUTO-class actions gated by record health · webhooks and tenant content formally treated as untrusted inputs.

### D. What should NOT be changed
The wedge (India premium + groups → IB) · the compact-spine boundary and every scope cut · the six-copilots/five-workers agent posture (no new agents) · MVP scope · pricing architecture · deterministic-first principle · HUMAN-ONLY floor · parent-surface primacy · the migration engine's role as the switching product.

### E. New primitives justified by evidence
Case, Obligation, Communication, Data Health, Reconciliation, Control Plane — each traced to a concrete failure in the audit (§1–§2, §6): two Excel-wins gaps, one missing entity, four scattered mechanisms, and the un-answerable forward question.

### F. Features explicitly rejected
Procurement module · ITSM helpdesk · AI voice-call agents · auto-sent AI newsletters · asset lifecycle management · pre-consent cohort benchmarks · real-time queue forecasting · additional agent personas · any feature whose PRD cannot name its outcome metric.

### G. Updated architecture
§8 of this document (layers, entity/event/action/policy/AI-governance models) — layered on the v1.0 architecture without displacing it.

### H. Updated roadmap
§9 — MVP unchanged; V1 gains spine consolidation, cases (3 kinds), orchestrator, calendar, capture, health-v0, search formalization; V1.5 gains obligations+compliance pack, reconciliation (gateway/Tally), incidents/compliance kinds, decision loops, vendor/asset registries, staff lifecycle, health-full; V2 gains reconciliation (GPS/payroll) and forecasting. Everything else rejected or future.

### I. Updated moat
v1 moats stand. Upgraded: compliance/policy pack library and continuous reconciliation promoted to STRONG (regulatory+rails labor that compounds); outcome telemetry added as MODERATE at scale; trust/security history now evidence-backed [V]. Copyability matrix in §10.

### J. Remaining risks
All v1 risks stand, plus: **WhatsApp metering dependency** (now named, with multi-rail mitigation) · **principal turnover as champion-loss** (mitigate by embedding coordinator+owner value) · **case-engine abandonment** (mitigated by auto-creation — staff confirm/close, never transcribe) · **forward-band accuracy** (mitigated by deterministic computation + assumptions shown; a wrong "due next week" claim is a briefing-fidelity bug, same class as a wrong number) · Control Plane complexity creep (mitigated: it is a registry, not a rules engine).

### K. Final "SchoolOS 2.0" thesis

> **SchoolOS is the school's operating loop, running in both directions of time.** Backwards: every event, decision, message, and payment lands in one compact, health-scored, audit-complete record, and the loop (event → policy → AI → approval → action → verification → audit) executes the routine work under human control. Forwards: every obligation, deadline, SLA, and known risk is tracked with lead time, opened as a case before it becomes a fire, and surfaced as "Tomorrow" — a deterministic, evidence-linked answer to *what will go wrong next week and what it needs from me*. The parent lives on WhatsApp, the teacher gets minutes back, the principal reads one cited briefing, the coordinator stops being the glue, the owner sees money and readiness — and switching takes days because migration is the product. AI accelerates every step it can prove itself on, is forbidden from the steps a school must decide, and the whole system runs with AI switched off.
