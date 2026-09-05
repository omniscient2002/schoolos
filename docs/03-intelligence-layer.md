# 03 — Intelligence Layer: School Graph, AI & Agent Architecture, Policy Engine, Automation

> Claim labels: **[V]** verified web, **[K]** training knowledge, **[I]** inference, **[D]** proposed design.

---

## 1. The School Graph — what it is and is not

The School Graph is the **context model of one school**: people and their relationships (guardianship, teaching, enrollment, employment), the operating objects they touch (sections, timetable slots, rooms, buses, fee obligations, assignments, assessments, documents, workflows, decisions, messages), and the **event stream** of everything that happens to them.

**It is not a graph database.** School relationships are shallow (1–3 hops: student → guardian, student → section → teacher, bus → route → students) and highly transactional. A labeled property graph buys nothing and costs operational maturity. [D — decided on workload shape, not fashion.]

### 1.1 Storage split (the required architecture decision)

| Concern | Store | Rationale |
|---|---|---|
| Entities + relationships + ledgers (people, enrollment, fees, grades, workflow state) | **PostgreSQL (core OLTP)** with row-level security | Transactions, integrity, tenancy; 1–3 hop queries are SQL joins |
| Event stream (every state change, AI action, approval, message) | **Transactional outbox → queue (managed) → append-only event table** | Audit, automation triggers, replay; later mirrored to warehouse |
| Full-text/people/document search | **Postgres FTS → Typesense/OpenSearch at scale** | Cheap start; dedicated search only when FTS hurts |
| Semantic retrieval (documents, policy, meeting notes, lesson material) | **pgvector, per-tenant namespaces** | One database to operate; namespace isolation is the AI boundary |
| Analytics marts (attendance, fees, admissions, mastery) | **Warehouse (ClickHouse/BigQuery) fed nightly + CDC** in V2 | OLTP stays lean |
| Files | **Object storage (S3-compatible)**, per-tenant prefixes, AV-scan on ingest | |
| Cache/rate limits | Redis | |

Graph-shaped *queries* (multi-hop, e.g., "students on Route 7 with 2+ failed payments whose class teacher is X") are materialized views + SQL; a dedicated graph engine is a V3 consideration only if relationship complexity genuinely grows (e.g., prerequisite mastery graphs at scale).

### 1.2 The event spine

Every meaningful mutation is an event: `attendance.marked`, `payment.failed`, `message.sent`, `workflow.approved`, `ai.action.executed`, `document.classified`, `grade.submitted`… Events carry actor, tenant, policy-relevant attributes, and a correlation id. Three consumers: (1) automation triggers, (2) the audit ledger, (3) analytics. **The loop in §4 is literally event-driven; the loop is the product.**

---

## 2. AI architecture overview

```
Surfaces (web/PWA/WhatsApp) 
   → API layer (permission middleware)
      → AI Gateway  ── model registry (frontier / small / local), routing, caching, cost ledger
      → Orchestrator (copilots + workers; tool registry; retrieval service; policy engine hooks)
      → Tool layer (typed tools, each with permission contract + risk class)
      → Core OLTP / event spine (the only place truth lives)
```

Principles [D]:
1. **The model never touches the database.** Models reason; typed tools act; tools enforce permissions server-side.
2. **Permission inheritance:** a copilot runs inside the *human's* permission envelope. It can never see or do what its operator could not. (For headless workers, a narrow service scope is defined per worker.)
3. **Grounding or silence:** answers about real people/money must cite record IDs; ungrounded generation is confined to drafting (where the human approves the output).
4. **The product is fully functional with AI disabled** (degraded-mode design, §9). AI accelerates; it is never load-bearing for the record.
5. **Tenant data boundaries:** retrieval is namespace-filtered by tenant at the query layer, not by prompt; prompts are assembled server-side; model providers receive only what the task requires (PII minimization middleware, redaction for logs and for non-resident models per country pack).

### 2.1 AI Gateway

- **Model registry & routing:** task-class → model-class mapping with cost/latency/quality targets. Routing tiers: (a) classification/extraction/cheap drafting → small fast models; (b) reasoning/analysis/multi-step → frontier models; (c) bulk nightly (document classification, transcript processing) → batch/small; (d) optionally self-hosted open models for cost-heavy bulk and for jurisdictions demanding in-region inference. Routing is configuration, not code — providers change quarterly; lock-in avoidance is a stated requirement, so all calls go through one gateway abstraction with structured outputs and tool-calling normalized.
- **Cost ledger:** tokens and currency attributed to tenant/feature/task; per-tenant quotas; the pricing model depends on this (`05`).

Canonical routing table (task → model class → why) [D]:

| Task | Model class | Rationale |
|---|---|---|
| Digest assembly, notification templating, doc classification, intent classification | Small fast model (or rules where deterministic) | Volume × low complexity; cost dominates; deterministic alternatives preferred where possible |
| Semantic FAQ answers (fees, timetable, logistics) | **No model — data lookup** | Computed truth, zero hallucination surface |
| Parent Ask (open language) | Small/mid model with retrieval | Language flexibility; grounded scope keeps quality adequate |
| Teacher drafting (messages, rubrics, feedback batches) | Mid/frontier model | Quality is the adoption driver; batch nightly where possible |
| Principal briefing narrative + Ask investigation | Frontier model, reasoning steps only | The trust-critical surface; citations enforced; cost is small at principal-count volumes |
| Student practice generation | Mid model + curriculum-pack constraints | Quality + safety; generation is templated by curriculum structure |
| Briefing numeric computation | **No model — deterministic recompute** | Numbers never come from a model (§10 eval gate) |
| Nightly bulk (doc processing, transcript structuring, embedding) | Batch/small + local open models where residency demands | Cost + residency |

- **Caching:** semantic cache for FAQ-class parent questions; deterministic answers (fees, timetable) come from **data, never models**.
- **Safety middleware:** PII redaction for logs; prompt-injection armor for document-derived content (documents are untrusted input — pattern: document text enters as *data* with tool-observable provenance, never as instructions); refusal classes for out-of-scope requests; crisis-intent classifier for student queries routes to human protocol (§9).
- **Observability:** every model call logged (prompt hash, retrieval set, output, latency, cost, eval tags) — the substrate for the eval system (§11).

---

## 3. Agent architecture: copilots and workers, not fourteen chatbots

Round C verdict: the 14-agent list in the original brief fragments evaluation, permissions, and cost. Replacement [D]: **one orchestration core, 6 role-scoped copilots, 5 headless workers.** A copilot = system prompt + tool bundle + memory scope + approval posture. Same brain, different brief.

### 3.1 Copilots (human-facing)

| Copilot | Serves | Tool bundle (typical) | Distinct posture |
|---|---|---|---|
| **Principal Copilot** | Principal/VP | read-all-scope tools, proposal tools, simulation trigger | Briefing + investigation + proposals; most approval-bound |
| **Teacher Copilot** | Teachers | attendance, notes→logs, assignment/rubric draft, grade-assist, parent-draft | Voice-first capture; drafts only; never auto-sends |
| **Parent Agent** | Guardians | read-child, fee read/pay link, consent, appointment, ticket-create | Chat-first; deterministic answers from data; escalates to human tickets |
| **Student Companion** | Students | own-record read, practice generation, own portfolio | Tutor posture; hard refusals (marks changes, peer data, health advice beyond routing) |
| **Admissions Copilot** | Counselors | lead read/enrich, follow-up draft, funnel analytics, interview scheduling | Funnel math is deterministic; AI drafts & summarizes calls |
| **Ops/Finance Copilot** | Admin/finance/transport | fee ops, reconciliation exceptions, transport exceptions, document ops | Exception-driven worklists; bulk actions always approval-gated |

### 3.2 Workers (headless, scheduled/evented)

Migration Engine (import mapping/validation), Document Worker (classification, expiry, retention), Digest Worker (parent/staff digests, briefing assembly), Insight Worker (anomaly detection → attention items), Compliance Worker (retention enforcement, consent expiry, audit pack generation).

### 3.3 The universal action contract (READ → REASON → PROPOSE → APPROVE → ACT → VERIFY → AUDIT)

Every autonomous-capable action declares a **risk class**, and the policy engine (§5) maps risk class × tenant constitution to a posture:

- **AUTO:** low-risk, reversible, policy-covered (absence notifications, routine reminders, doc classification, digest assembly). Executed, then audited; samples re-verified by Insight Worker; auto rules can be tightened by any staff member with one tap ("never auto-send to this class again").
- **APPROVAL REQUIRED:** externally visible or financially consequential (any parent-directed message beyond templated AUTO class, schedule changes, fee concessions, workflow bulk actions, public posts). System posts to the human's approval inbox with evidence + proposed payload; expires per SLA with escalation.
- **HUMAN-ONLY:** the system may inform, never decide: disciplinary conclusions, admissions final decisions, final grades where policy requires, safeguarding decisions, employment actions, anything touching a child's access to education (exam eligibility, section transfers with academic consequences). The AI's output here is *context assembly* — it must never be a recommendation to act on a child.

Escalation behavior: low confidence, conflicting data, or policy conflict → downgrade posture (AUTO→APPROVAL, APPROVAL→human ticket). Hallucination-risk patterns (missing source, model hedge language) block AUTO execution outright.

Memory scopes: copilots get (1) session context, (2) role-scoped retrieval over tenant graph (no cross-tenant, no cross-role leakage), (3) per-tenant preference memory (approvals/dismissals feed ranking), (4) NO lifetime "learning about individual students" memory for the Student Companion beyond their own work artifacts — memory that profiles a minor is retention-classified data, minimized, and parent-visible.

### 3.4 The human-control boundary (explicit, platform-enforced)

The three postures from §3.3, with the canonical example set [D]. The policy engine reads this table *through the tenant constitution* — a school may tighten (move any AUTO item up to APPROVAL) but may never loosen HUMAN-ONLY items, which are platform-invariant:

| Class | Canonical examples (platform defaults) | Enforcement |
|---|---|---|
| **AUTO** (act, then audit + verify) | Absence/late notification to own guardians within policy window · routine event reminders · fee receipts · document classification · digest assembly · timetable-conflict detection · meeting transcription+summary (internal) | Rate limits + quiet hours from constitution; post-hoc sampling by Insight Worker; one-tap "stop doing this" by any affected staff member |
| **APPROVAL REQUIRED** (propose → human approves → act) | Any parent-directed message beyond templated AUTO class · schedule/timetable changes · substitution assignment · fee concessions & waiver exceptions · bulk communications · report-card publication · transport route changes · intervention group assignments · curriculum/lesson publication | Approval inbox with evidence + payload preview; SLA expiry + escalation; every approval/override logged with actor+reason |
| **HUMAN-ONLY** (system informs; never decides) | Disciplinary findings & consequences · final admissions decisions · final grades & grade changes · exam eligibility (never auto-block a child) · section transfer with academic consequence · safeguarding reports & responses · health/medical decisions · staff employment actions · anything altering a child's access to education | The AI's role is evidence assembly only; no recommendation framing is rendered in these flows; UI displays "decision rests with [role]" |

Two platform-invariant rules across all classes: (1) no autonomous action may alter a child's access to education; (2) no autonomous external communication beyond the templated AUTO whitelist, which starts empty and is populated only by explicit constitution entries. (v2.0 additions: AUTO-class actions additionally require the target record to pass a **data-health threshold** — unhealthy records downgrade to APPROVAL; **webhooks and all tenant content are formally untrusted input** — they may raise cases/exceptions, never execute actions; workflows carry **circuit breakers** — execution/fan-out/cost caps, depth limits, cycle detection, auto-pause on anomaly. Full attack matrix: `06` §4.)

---

## 4. School Autopilot — the automation framework

Event → Condition → AI reasoning (only where needed) → Policy check → Approval if required → Action → Verification → Audit [D].

1. **Workflow primitives:** trigger (event/schedule/webhook/manual), condition (graph query, no code), steps (notify, create task, update record, request approval, call tool, branch/wait/merge), guardrails (rate limits, quiet hours, audience caps), outcome verification (did the notification actually deliver? did the payment reconcile?), full audit.
2. **Visual builder** for coordinators; **natural-language builder** ("when a student misses 3 school days in 2 weeks, notify the class teacher and create a follow-up task") compiled to the same primitive graph, shown back as a diagram for confirmation before activation — the NL compiler proposes, the human confirms; the compiled workflow's *first three executions* run in observe-only mode by default.
3. **The Library (cross-tenant, privacy-sandboxed):** workflows are artifacts with anonymous telemetry ("48 schools run a variant of this"). New schools start from the library's proven patterns, not blank canvases — this is a compounding moat (`05` §5) and is the difference between "automation for the 1% who configure" and "automation everyone gets."
4. **Determinism bias:** anything computable (fee schedules, timetable conflicts, eligibility rules) is computed by code/solvers; AI enters only for language, classification, anomaly triage, and drafting. (Example: timetabling = constraint solver; the LLM's job is translating "no double math days" into solver constraints and explaining results.)

---

## 5. The School Constitution — policy engine

A tenant's operating law as **structured, versioned data** (`constitution` documents with effective dates), captured at onboarding via a ~30-question guided interview + import of their handbook (Document Worker parses; coordinator approves) [D]:

- attendance ( thresholds, notification timing, short-leave rules ), grading ( scales, weightings, retakes, report-card format = board pack ), fees ( schedules, concession policy, escalation ladder, receipt rules ), communications ( tone, languages, quiet hours, channel priorities ), approvals ( who may approve what, thresholds, delegation when absent ), safeguarding & escalation ( incident classes, mandatory reporting hooks — always HUMAN-ONLY class ), transport ( eligibility, deviation alerts ), privacy ( retention per data class, consent requirements, media consent ), **AI governance** (copilots enabled, AUTO whitelist, model region pinning, data-use opt-outs).

Enforcement points: the policy engine is called in-line by tools and workflows (pre-action check: is this allowed? which posture? whose approval?), by the policy-aware retrieval layer (answers cite the constitution: "per your 2024 attendance policy §3…"), and by the Compliance Worker (drift detection: policy says X, practice shows Y — surfaced as attention items). Versioning matters: "why did we change the timetable last year?" is answered from decision records *linked to* the constitution version then in force. (v2.0: policy is formalized as **three layers** — platform floor (invariant: HUMAN-ONLY set, comms whitelist, child-access, emotion-AI ban), regulatory layer (per-country machine-enforced modes), Constitution (may tighten, never loosen) — with a **constitution linter** blocking contradictory saves and **dual control** on AI-governance sections; all governance objects live in the **Control Plane** registry (`06` §4.1, §8.5).)

This engine is also the compliance substrate for regulated jurisdictions: assist-only grading mode is the default posture wherever learning-outcome evaluation is regulated as high-risk (EU AI Act Annex III(3)(b) — applies to providers from 2 Aug 2026 [V]); consent gating follows each jurisdiction's child-consent mechanics (India DPDP verifiable parental consent for under-18s + registered Consent Managers [V]; US COPPA school-consent flows; UK GDPR Art. 8 age gates) [K].

---

## 6. Learning intelligence (data → signal → recommendation → decision, never silently)

1. **Data:** attendance, assessments (item-level where possible), submissions, teacher voice-note observations (structured on capture), practice interactions.
2. **Signals:** mastery estimates per skill (curriculum-pack-aligned skill graph), error-pattern taxonomy, engagement deltas, assessment-quality stats (item discrimination — flag weak questions to coordinators).
3. **Recommendations:** intervention candidates ("8 students share the same misconception on fractions — grouping suggestion + 3 practice items"), curriculum-gap flags, workload balance notes. Every recommendation shows its evidence and its confidence; recommendations are advisory inputs to teacher judgment.
4. **Decisions:** remain human. No auto-remediation assignment without teacher approval; no student-facing "you are behind" labels — framing is always forward ("next best practice").

Integrity rules: mastery is never derived from attendance/behavior (proxy discrimination risk); demographic attributes are excluded from all learning models; model outputs about minors are auditable and parent-explainable on request ("why does the system say developing?" shows the evidence trail).

---

## 7. School Memory

Institutional memory as first-class objects: **decision records** (what, when, who approved, linked constitution version, linked artifacts), **meeting intelligence** (agenda/notes/transcript → decisions extracted → tasks proposed → approval), **document knowledge** (classified, indexed, Q&A with citations), **timeline reconstruction** (any entity's history: student, class, route, fee plan, policy) [D]. (v2.0: decision records become **closed-loop** — alternatives considered, evidence links, expected result, review date, actual result; review dates surface as Obligations, making institutional learning a scheduled operating behavior rather than an archive.)

Retention is per data class from the constitution; memory is tenant-siloed; leadership-scoped access; deletion honored (a deleted document leaves a tombstone: "existed, deleted on X by Y" — audit needs the fact, not the content). The strategic value: after 2–3 years, School Memory is the school's operational history — switching means losing it (moat, `05` §5).

---

## 8. Simulation engine (scoped, assumption-honest)

V2 scope — three solvers with AI only at the edges [D]:
1. **Enrollment growth:** +N students → sections, rooms (from campus canvas), staff need, fee revenue, transport legs. Solver: constraint check over the graph. Output: resource delta + cost estimate + assumption list.
2. **Fee change:** plan delta × collection history → revenue projection with default-rate sensitivity bands (explicitly assumption-labeled, never presented as fact).
3. **Absence coverage:** teacher out → substitution options ranked by constraint fit, with workload-fairness notes.

Each run states inputs, assumptions, and confidence; nothing in a simulation writes to the record without an explicit human action ("apply as draft timetable"). The general what-if engine from the original brief is cut: open-ended simulation is research-grade, unmaintainable, and trust-destroying when wrong.

---

## 9. Failure design (the section that decides whether schools trust this)

| Failure | Design response |
|---|---|
| Model wrong about a person/money | Citation-or-silence rule; AUTO class blocked without grounded source; approval inbox shows evidence; post-hoc verification sampling |
| Model hallucinates policy | Policy answers retrieved from constitution text (RAG over tenant documents), never from model memory; "not in your policy" is a valid answer |
| Permissions wrong (bug) | Deny-by-default tool middleware; every tool declares scope; permission unit tests in CI; quarterly access recertification; audit ledger anomaly alarms |
| Prompt injection via documents | Documents parsed as data with provenance; document-derived text never executes tools; extraction outputs validated against schema |
| AI service down | **Degraded mode:** record + CRUD + manual comms fully functional; digests become template-based; briefing shows "data view" without narrative; status page per feature |
| Integration failure (WhatsApp, payment, GPS) | Queue-and-retry with backoff + channel fallback (WhatsApp→SMS→email per pack); parent-facing truth never depends on one rail (in-app fallback); incident mode surfaces in ATTENTION |
| Data missing | "Unknown" is a first-class answer; workflows that need missing data create a data-completion task instead of guessing |
| Policy conflicts with AI recommendation | Policy wins, always; conflict is logged and surfaced to constitution owner (the school decides whether to change the policy) |
| User misunderstanding | Every AI output carries its basis; destructive actions confirm with a plain-language consequence statement |
| Sync conflict (offline attendance) | Device-local queue; teacher override wins for attendance within 24h; conflicts surface in coordinator reconciliation view, never silently resolved |
| Migration error | Staged import (shadow tables) → diff preview → activate → one-click rollback within window (`04` §3) |

---

## 10. Evaluation system (ship-gate, not afterthought)

Test suites with named owners run in CI and nightly [D]:
- **Factuality/groundedness:** principal briefing numbers vs computed truth (deterministic recompute); parent fee answers vs ledger; ≥99.5% numeric fidelity target for briefing v1 — a wrong fee number is a fireable bug class.
- **Permission correctness:** adversarial suite — copilot attempts cross-tenant/cross-role reads; expected: deny + log. This suite gates every release.
- **Action correctness:** workflow dry-runs on fixture schools; approval routing correctness; escalation accuracy (crisis classifier recall prioritized over precision, with human review of all triggers).
- **Language quality:** vernacular digest quality (India packs) reviewed by native-speaker panel; tone vs constitution.
- **Cost/latency budgets:** per task-class, enforced by gateway.
- **Shadow mode:** every new autonomous capability runs observe-only against live traffic for N weeks; approval-accuracy measured before AUTO class is granted.

Benchmarks are per-tenant-configurable (a school can demand stricter thresholds in its constitution — AI governance as data).

---

## 11. What was removed from the original AI brief, and why

| Original | Verdict | Reason |
|---|---|---|
| 14 named agents | Replaced by 6 copilots + 5 workers | Evaluation, permission, and cost surface explosion; same capability, one core |
| Unrestricted "Analytics Agent" | Folded into Insight Worker + Principal Copilot | Autonomous analytics narrative is where hallucination does reputational damage |
| General what-if engine | 3 scoped solvers | Maintainability, trust |
| AI tutor as MVP headline | V1, after record quality | Tutor without curriculum data = toy |
| Emotion recognition / engagement biometrics | **REMOVE, permanently** | Prohibited in education under EU AI Act Art. 5(1)(f) [V]; tracking/behavioral profiling of children prohibited under India DPDP [V]; trust-negative everywhere; no defensible value |
| Facial-recognition attendance default | INTEGRATION only, OFF by default, policy-gated | Consent load on minors; spoofing; local law variance |
