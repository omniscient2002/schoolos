# SchoolOS Enterprise Architecture Hardening — Platform Architecture v2.1
**Status: ADOPTED · amends docs/11 (target architecture unchanged) · 2026-09**

> Hardening pass, not a redesign. Every §1 invariant of docs/11 survives. This document (a) splits kernel into **primitives vs domain capabilities**, (b) makes the **capability contract** first-class, (c) makes trust/isolation, event governance, certification, lifecycle, tenancy modes enterprise-grade, (d) corrects the deterministic-first AI rule, (e) hardens economics and failure modes. Where a §-reference is made without a doc number, it refers to docs/11.

---

## 1. FINAL ARCHITECTURE VERDICT

**The architecture stands. Score improves 9.1 → 9.4.** The adopted model — PLATFORM KERNEL + CAPABILITY RUNTIME + PLUGINS + POLICY PACKS — is preserved exactly. The hardening pass found four genuine weaknesses, fixed in place:

1. **Kernel was carrying domain logic where a primitive suffices** (fee *structures* sat beside the money *primitive*; attendance *analytics* sat beside the attendance *fact*). Fixed by the primitive/capability split (§3) — a reclassification of contracts, not a code rewrite (§22).
2. **The capability was implicit.** Plugins, events, actions and workflows blurred. Fixed by a first-class **Capability Contract** (§4) with an explicit ontology.
3. **The deterministic-first rule was over-broad** — it would have banned harmless AI transformations. Corrected to the **decision/transformation distinction** (§11).
4. **Lifecycle and trust were directionally right but not enterprise-grade.** Upgraded (§7, §6) and grounded in the schema (migration 003: 14 lifecycle states, capability_contracts table, event/AI budgets, breaker state, trust_level, cert_score).

Everything else in docs/11 — four plugin classes, one contract for all, the operating loop, staged marketplace, no low-code, no microservices — is untouched.

---

## 2. BEFORE vs AFTER

| Dimension | docs/11 (v2.0) | docs/12 (v2.1) |
|---|---|---|
| Kernel membership | Binary: kernel vs plugin | Two-tier: **kernel primitives** (guarantees) vs **domain capabilities** (behavior) |
| Capability | Described in prose + manifest fields | **First-class contract object**, registered, versioned, runtime-enforced (`app.capability_contracts`) |
| AI rule | "Deterministic guard before every AI capability" | "**Deterministic-first wherever an authoritative deterministic rule exists.** AI may perform bounded transformations where no authoritative business decision is being delegated." |
| Trust | T1–T4 labels | **T0–T4 hierarchy** with full isolation spec, orthogonal to plugin class, promotion ladder (§5) |
| Plugin protocol | TypeScript SDK | **Language-neutral protocol** (canonical manifest/envelope/error/negotiation); TS SDK is the V1 binding (§13) |
| Event governance | Outbox, DLQ, replay, ordering | + **per-plugin event budgets, circuit breakers, chain-depth caps, lineage view** (§10) |
| Lifecycle | 5 states | **14 states** with drain/hand-back guarantees (§12); enforced in schema |
| Data model | 3 zones | 3 zones + **5 formal data concepts**; storage abstraction decoupled from PostgreSQL (§9) |
| Tenancy | Implicit pooled | **Modes A/B/C** (pooled / dedicated / sovereign) formalized (§14) |
| Composition | "Never plugin-to-plugin" | Async default + **governed synchronous read/capability invocation** exception (§15) |
| Certification | Conformance suite mention | **Certification framework with blocking categories and score** (§8) |
| Kernel tables today | — | Migration 003 adds lifecycle states, contracts, budgets, breaker, trust_level, cert_score |

---

## 3. FINAL KERNEL BOUNDARY — KERNEL PRIMITIVE / CAPABILITY / INTEGRATION / POLICY PACK

**The rule:** a *kernel primitive* provides a universally required platform guarantee; a *domain capability* implements school-specific operational behavior on top of primitives. Apply §17's hard question to every component: "If removed, would SchoolOS cease to be a trustworthy operating platform?"

| Current kernel item | Verdict | Kernel primitive (stays) | Capability plugin (moves/already out) | Integration / Pack |
|---|---|---|---|---|
| **Attendance** | **SPLIT** | attendance fact · session primitive · immutable history · correction w/ audit · offline queue primitive · permission model | biometric capture · boarding-school attendance · attendance analytics · attendance automation · specialized reporting | biometric hardware = integration |
| **Fees / payments** | **SPLIT** | **money primitive**: currency · transaction · payment · receipt · settlement · **ledger** · **reconciliation primitive** · financial audit | fee structures · concessions · collection campaigns · defaulter workflow · fee analytics | gateway = integration; board fee-cap rules = pack |
| **Obligations** | **MOVE** | (receivable/settlement entries via money primitive) | obligations are a *fee-domain* entity owned by the fee capability, posted to the kernel ledger | — |
| **Reconciliation** | SPLIT | reconciliation *primitive* (match rules, ₹0-difference proof) | domain reconciliation flows (fee, transport, canteen) | bank/gateway feeds = integration |
| **Cases** | **MOVE** (with a new primitive) | **work-object primitive**: durable, assignable, SLA-tracked, stateful record (the spine beneath actions *and* cases) | case engine (clustering, dedup, domain case types: transport, discipline, admissions-funnel) | — |
| **Documents** | **SPLIT** | **artifact primitive**: immutable, hash-addressed, provenance-linked, retention-honoring store | document management (folders, workflows, e-sign) | storage backends = integration |
| **School Memory** | **SPLIT** | event/history substrate · decision-record primitive · provenance · retrieval contract · retention | domain memory contributions (transport decisions, finance decisions) via kernel API | — |
| Identity/Person registry, tenancy, RLS, permissions | KEEP (whole) | the graph *is* the context guarantee | — | — |
| Event bus, action spine, approvals, comms orchestrator, AI gateway, audit ledger, policy engine, retrieval, migration engine, plugin manager | KEEP (whole) | each is a guarantee, not a behavior | — | — |

**V1 implementation note (honest scope):** today's `fee_plans`/`fee_obligations`/`cases` tables stay where they are in code. The reclassification is a **contract statement**: their public APIs become capability contracts (`fee.*`, `cases.*`) consuming kernel primitives (`money.*`, `work.*`); when the primitives are extracted (roadmap §20), no plugin-visible contract changes. Prevents churn now, preserves the boundary forever.

---

## 4. CAPABILITY CONTRACT SPECIFICATION

The formal abstraction — the unit the runtime governs, audits, bills and certifies:

```
PLUGIN MANIFEST  (who you are, what you may hold)
      ↓ declares
CAPABILITY CONTRACT  (what each thing you offer means, exactly)
      ↓ enforced by
CAPABILITY RUNTIME  (authz, budgets, audit, circuit breakers)
      ↓ implemented on
KERNEL SERVICES  (primitives: money, work, artifact, events, comms, AI…)
```

**Contract schema** (stored in `app.capability_contracts.contract`; JSON Schema-validated at registration):

```jsonc
{
  "capability_id": "transport.delay.detected",      // namespace.verb.object
  "version": "1.2.0",                               // contract semver
  "kind": "capability",                             // capability|command|query|transformation
  "input_schema":  { /* JSON Schema */ },
  "output_schema": { /* JSON Schema */ },
  "read_scopes":  ["graph.read:students:section", "transport.read:routes"],
  "write_scopes": ["plugin_transport.events", "comms.intent"],   // enumerated, smallest
  "event_inputs":  ["attendance.marked@>=1.0"],
  "event_outputs": ["transport.delay.v1"],
  "side_effects": [{"type": "action.raise", "approval": "required", "policy_ref": "Transport §3.1"},
                    {"type": "comms.send", "channel": "whatsapp.template", "consent": "verified"}],
  "policy_refs": ["Transport §3.1"],                // constitution linkage
  "audit": {"level": "full", "includes": ["inputs_digest", "decision", "actor", "approval"]},
  "data_classification": ["pii:guardian_contact", "internal"],    // drives AI + residency gates
  "ai_eligibility": {"capabilities": ["draft.parent_message"], "modes": ["transformation"], "grounding": "required"},
  "latency_sla": {"p95_ms": 1500, "timeout_ms": 5000},
  "idempotency": {"key": "event.id + handler", "window": "24h"},
  "compat": {"kernel": ">=1.0 <2.0", "input_backcompat": "1.x"},
  "regions": ["IN"], "residency": "IN"
}
```

**Ontology — never interchangeable:**

| Concept | Definition | Lives where |
|---|---|---|
| **PLUGIN** | A deployable, permissioned *unit of ownership* (manifest, trust level, lifecycle, billing) | registry |
| **CAPABILITY** | A *contracted behavior* a plugin offers or requests — the unit of governance | capability_contracts |
| **COMMAND** | A synchronous, approval-aware *invocation* of a capability (writes) | runtime |
| **EVENT** | An immutable *fact that already happened* (read-only to consumers) | event bus |
| **WORKFLOW** | A *durable multi-step process* composed of commands/events with state persisted in work-objects | runtime + work primitive |
| **INTEGRATION** | A plugin class that *adapts external rails*; headless | integration class |

Rules: events never command; commands are never "facts"; workflows never mutate foreign plugin state except via their capability contracts; integrations have no capabilities beyond rail adaptation.

**Five worked examples:**

| Capability contract | Kind | Side effects / approvals | Notes |
|---|---|---|---|
| `transport.delay.detected` | capability (reflex) | raises `notify_guardians` action — **approval required** (§3.1) | deterministic trigger `delay_minutes ≥ 10`; AI draft = downstream transformation |
| `fee.collection.followup` | capability | drafts reminder → comms intent → **approval above N/quiet-hours enforced by orchestrator**; posts ledger note | uses `money.*` read scopes only |
| `maintenance.workorder.create` | command | creates work-object; SLA clock starts; verification on resolve | state machine in contract |
| `admissions.application.review` | workflow | multi-step: verify docs (artifact) → fee posting (money) → decision action (**human approval mandatory**) | classification `pii:child` gates AI eligibility |
| `parent.message.request` | command (plugin-facing) | **never sends directly** → orchestrator applies consent/quiet-hours/dedup/template → receipt → audit | the only legal path to a parent's WhatsApp |

---

## 5. RUNTIME ISOLATION MODEL (T0–T4, orthogonal to class)

| | **T0 Kernel** | **T1 First-party prod** | **T2 Certified partner** | **T3 Sandboxed dev** | **T4 Untrusted/provisional** |
|---|---|---|---|---|---|
| Execution | kernel process | in-process, scoped path | **isolated process** | container | container/WASM + policy agent |
| Network | n/a | internal only | egress allowlist | deny-all default | deny-all + brokered egress |
| Database | full (owner) | scoped role per plugin | scoped role per plugin | sandbox schema, fake data | broker only, no DSN |
| API access | all | per capability contract | per contract | read-only mocks | brokered, rate-limited |
| Storage | kernel | plugin namespace | plugin namespace | sandbox | namespace via broker |
| Events | emit all | pub/sub per contract | sub per contract | replay only | none (poll broker) |
| AI | gateway | per contract budgets | per contract budgets | mocked models | none |
| Secrets | kernel vault | vault-scoped | vault-scoped, rotate 90d | dev-only | none |
| Production data | full | scoped (RLS) | scoped + masked option | never | never |
| Deployment | platform team | platform pipeline | signed artifact pipeline | self-serve sandbox | review-gated |
| Max risk class | — | high (governed) | medium | none (fake data) | low |

Orthogonality: **class ≠ trust.** A third-party *capability* plugin (T2) gets UI + contracts but no more authority than a third-party *integration* (T2). Promotions run on the ladder: **in-process → isolated process → container/WASM → sandbox**, triggered by: first third-party artifact (⇒ isolated process), first unreviewed dependency or user-content execution (⇒ container/WASM), any T3/T4 listing (⇒ sandbox + broker). The **broker protocol** (§13) is designed now so tightening isolation later changes the *execution binding*, never the contract.

---

## 6. PLUGIN BOUNDARY (final)

Capability plugins own: domain entities in their namespace, domain workflows via work-objects, UI contributions per §16 governance, memory contributions via kernel API. They never: own canonical identity, post to the ledger directly (they call `money.*`), send comms directly, rank Attention (they *contribute ranked inputs*), or see another tenant. Current first-party set (transport, maintenance, reception, admissions, library, exams, timetable, hostel, canteen, inventory, visitor, analytics) is unchanged; **fee-structures and cases join this list as contracts** (§3). Proof plugin (Library) already conforms.

## 7. INTEGRATION & POLICY-PACK BOUNDARY (final)

**Integrations (headless, Control-Plane status only):** WhatsApp BSP, SMS/email, payment gateways, GPS, biometric/RFID hardware, accounting (Tally/Zoho), SSO, board portals, LMS. Rule unchanged: no surface, no capabilities beyond rail adaptation, no send without orchestrator intent.

**Policy packs = certified data packages** consumed by the Policy Engine: calendars, grading scales, attestation/report templates, compliance exports, retention schedules, fee-regulation caps, regional AI constraints. V2.1 additions: packs declare **`obligations` vs `relaxations`** — only obligations may extend kernel protections, relaxations are structurally impossible (schema-level: pack format has no relaxation verbs). Pack upgrades follow plugin lifecycle (§12) with a compliance-regression eval gate.

---

## 8. PLUGIN CERTIFICATION FRAMEWORK

**Cert score (0–100) with mandatory blocking categories.** No plugin reaches production merely because it "works."

| Category | Weight | Blocking? | Checks |
|---|---|---|---|
| Security | 25 | **YES** | tenant isolation negatives · privilege boundaries · secret handling · egress · injection resistance |
| Data | 15 | **YES** | schema compat · migration safety (rollback tested) · deletion/export · retention |
| Events | 10 | **YES (idempotency only)** | idempotency · replay safety · DLQ behavior · ordering expectations |
| Actions | 15 | **YES** | action-spine compliance · approval fidelity · verification · rollback |
| AI | 10 | YES if AI requested | grounding · permission boundary · tool authorization · eval quality vs golden set · cost limits |
| UX | 10 | no | design system · accessibility · slot budgets · provenance · degraded behavior |
| Reliability | 10 | **YES (timeouts/retries only)** | timeout handling · retries · circuit breakers · load |
| Operations | 5 | no | observability · supportability · upgrade/uninstall safety |

Blocking categories gate production regardless of total score. Grades: **A ≥ 90 + all blockers green** (marketplace badge) · B ≥ 75 (production, first-party default) · C ≥ 60 (pilot tenants only) · **F < 60 or any blocker = cannot enable**. Conformance suite (SDK §13) emits the score; Control Plane displays cert badge, score history, and blocking failures.

---

## 9. DATA ISOLATION MODEL

Three zones (unchanged) with **five formal concepts**:

| Concept | Definition |
|---|---|
| **CORE PRIMITIVE** | kernel-owned guarantee table (ledger, attendance fact, work-object, artifact, person) |
| **PLUGIN-OWNED ENTITY** | entity fully governed by one plugin's namespace + lifecycle |
| **CORE EXTENSION** | typed, namespaced field on a core entity (`transport.bus_route`), registered, finite types |
| **TENANT CUSTOM FIELD** | admin-created, namespaced, typed; never consumed by kernel logic |
| **DERIVED VIEW** | read-projection of core data for a plugin's scopes; the *only* way plugins read core |

Rules (all retained, now formal): no duplicate identities — person/student resolution is kernel-only; plugins reference core by stable IDs; **no arbitrary joins into kernel tables** (views only); no direct DDL on kernel schema; extension fields typed + namespaced; plugin data has its own lifecycle (retention, export); **storage abstraction ≠ physical PostgreSQL** — the contract is a *storage namespace API* (`store.get/put/query` with scopes); physical mapping per tenancy mode: pooled = shared tables keyed by `(tenant_id, plugin_id)`, dedicated = plugin schemas, sovereign = regional cluster. (Migration 003 keeps `plugin_*` schemas as the dedicated-mode physical realization.)

---

## 10. EVENT GOVERNANCE MODEL

Retained: Postgres outbox, schema registry, tenant filtering, idempotency, DLQ, replay, correlation/causation IDs, per-aggregate ordering.

**Added — per-plugin event budgets** (config columns shipped in migration 003; defaults shown):

| Budget | Default | Purpose |
|---|---|---|
| events/min | 60 | storm containment |
| payload max | 64 KB | bus health |
| subscriber count | 25 | fan-out cost |
| fan-out per event | 50 | amplification |
| **event-chain depth** | 5 (synchronous reflex) | recursion: depth counts *synchronous* A→B→C reflexes; long processes must persist state in work-objects, not chain events |
| replay volume | 10k events/request | replay cost |
| scheduled executions | 100/day | hidden background activity cap |

**Protections:** circuit breaker (open on error-rate/velocity breach → plugin marked `degraded`, breaker_state column; kernel-originated events always get reserved headroom) · recursion protection (causation-loop detector: a causation chain revisiting the same (plugin, event-type) twice within depth 5 is cut and alarmed) · runaway workflow protection (work-objects carry step budgets + wall-clock caps) · duplicate-event protection (idempotency table) · poison-message handling (3 parse/contract failures → DLQ with structured reason, never requeued silently) · dependency-cycle detection at registration (capability/event graph must be acyclic across plugins).

**Control Plane lineage view:** `event → subscribers → actions raised → downstream events`, per tenant, per capability — the debugging and audit spine for the event system (minimal ops tooling, not a feature).

---

## 11. AI GOVERNANCE MODEL (corrected rule)

**New principle:** *"Deterministic-first wherever an authoritative deterministic rule exists. AI may perform bounded transformations where no authoritative business decision is being delegated."*

| | **A — AI decision-making** | **B — AI transformation** |
|---|---|---|
| Question | "Should this happen? Who is notified? What is flagged?" | "Turn this voice note into a structured lesson record." |
| Rule | deterministic/policy logic establishes the decision boundary; AI may draft/explain/rank **inside** it | permitted directly if: schema-constrained output · permission-bound input · grounded where factual · audited · evaluated · **reversible or human-reviewed** |
| Example | auto-notify parent on delay → policy decides, AI drafts | teacher voice note → lesson record; photo → attendance-correction *suggestion* (human confirms) |

Chain unchanged and mandatory for both modes:
`PLUGIN → CAPABILITY REQUEST → POLICY → PERMISSION → RETRIEVAL → MODEL → TOOL → APPROVAL → ACTION → VERIFICATION → AUDIT`
Additions: contract `ai_eligibility.modes` declares decision vs transformation; data classification gates (§4) apply per mode; transformation outputs carry provenance + a `transformation` flag in AiTraceCard; budget exhaustion = graceful refusal (kernel degrades, school works). This correction kills no invariant: no autonomous sends, no agent zoo, no model choice by plugins.

---

## 12. LIFECYCLE & VERSIONING MODEL (14 states)

```
draft → validated → signed → certified → registered → installed → enabled → active
   ↘ degraded (auto, breaker/health) → suspended (kernel kill switch)
enabled/active → disabled → deprecated → retired → uninstalled
```

| Transition | Rule |
|---|---|
| validated→signed | artifact hash + signature (T2+) |
| signed→certified | cert score ≥ production gate (§8), blockers green |
| registered→installed | manifest validation + compat + additive migration |
| installed→enabled | entitlement + deps + health probe |
| active→degraded | auto on breaker/health/latency SLA breach; visible banner, never silent |
| any→suspended | kernel kill switch ≤ 60s, audited, appeal path |
| **enabled→disabled** | **drain protocol:** (1) subscriptions disarm immediately, (2) **pending actions hand back** to owner role — never silently abandoned, (3) executing workflows get `quiesce + persist` — resumable or reassignable, (4) unresolved cases transfer with full history, (5) scheduled jobs cancelled (kernel-invoked), (6) external credentials revoked, (7) AI capability registrations deactivated, (8) data exported per retention contract |
| deprecated | kernel announced; 2-major support window; migration guide mandatory |
| retired→uninstalled | 30-day export window → purge per retention; ledger history of its effects is forever |
| upgrade | re-signed artifact, compat gate, tested rollback, staged 1→10→100%; permission gains force re-consent |

Schema enforcement shipped (migration 003). "A plugin may never be disabled in a way that silently abandons school work" — now a tested lifecycle contract, not prose.

---

## 13. PLUGIN PROTOCOL (language-neutral) & SDK

Canonical, transport-neutral artifacts: **manifest** (JSON Schema, signed), **request/response envelope** (`{cap_id, version, tenant_ctx, actor_ctx, payload, idempotency_key, deadline, trace}`), **event envelope** (docs/11 §5 v1, unchanged), **error model** (`{code, retryable, budget_exhausted?, policy_ref?, trace_id}` — codes: `PERMISSION_DENIED / BUDGET_EXHAUSTED / POLICY_BLOCKED / SCHEMA_INVALID / UNAVAILABLE / TIMEOUT`), **version negotiation** (kernel ↔ contract range intersect; no overlap = install-time failure), **signatures** (cosign-style artifact signing), **invocation semantics** (at-least-once for events, deadline-bounded for commands).

**V1: TypeScript `@schoolos/sdk` (kept).** Future bindings (Python/Java/Go/.NET) implement the same protocol; none are built now. The broker/invocation layer is the seam for future isolation changes (§5).

---

## 14. ENTERPRISE TENANCY MODES

| Mode | What it means | Plugin behavior |
|---|---|---|
| **A — Pooled** | shared everything, RLS-isolated (today's schoolos + schoolos_app pattern) | default; storage namespace = rows keyed `(tenant_id, plugin_id)` |
| **B — Dedicated** | dedicated DB/cluster per customer | plugin namespaces materialize as schemas (003 physicalization); same contracts, zero semantics change |
| **C — Sovereign/regional** | in-region data + AI residency (DPDP etc.) | contracts carry `regions/residency`; runtime refuses cross-region capability invocation; packs declare regional constraints |

The contract never assumes one database, region, storage system, or deployment. Migration A→B→C is an operations procedure, not an application change — the enterprise upsell path.

---

## 15. CROSS-PLUGIN COMPOSITION (corrected absolute)

**Default: composition through the kernel** — `PLUGIN A → event/capability → KERNEL (runtime authz + audit) → PLUGIN B`.

**Sanctioned exception — safe synchronous read / capability invocation**, permitted when ALL hold: latency justifies sync · read-only or governed-write via contract · no governance bypass (runtime authz + audit on every call) · typed contract (no raw API) · acyclic (enforced at registration) · budgeted. Everything else stays async events + work-objects. This removes an unnecessarily absolute ban without opening a governance hole.

---

## 16. UI EXTENSION GOVERNANCE

Ten kernel surfaces unchanged. Plugin contributions governed by: **slot registry** (finite, kernel-owned) · **cognitive budget** (Attention ≤ 2 plugin widgets, Today ≤ 3, student-record ≤ 2 tabs, nav ≤ 4) · visual hierarchy (native components only) · **performance budget** (interaction ≤ 100ms added, bundle ≤ 50KB gz per slot) · accessibility (WCAG 2.1 AA in conformance suite) · provenance (EvidenceChain/AiTraceCard on every AI-touched card) · mobile behavior · permission visibility (contribution invisible if scopes unavailable) · localization · keyboard/command-palette support. **No plugin replaces a kernel surface. No plugin silently injects into ATTENTION/NEXT — contributions enter kernel ranking/policy as inputs.** (Today's Slot system already conforms for what exists; ranking-participation is the immediate TODO, §22.)

---

## 17. MARKETPLACE TRUST MODEL

Gates (docs/11 §12) unchanged. Every listing must display: publisher identity (verified org + keys) · signing status · cert score + badge + history · **permissions displayed before install** (plain language: read/change/send/AI/data-destination) · data-access summary · supported countries · supported SchoolOS versions · compliance claims (with evidence links) · incident history · changelog · rollback status · support SLA · dependency status.

The six administrator questions — answerable *on the install screen*: What can this plugin read? What can it change? What can it send? What AI can it invoke? Where does its data go? What happens if I uninstall it?

---

## 18. ECONOMICS IMPLICATIONS (hardened, directional ₹)

Pack structure (docs/11 §13) retained; **Academic Pack** added (exams/timetable/documents/learning-analytics were previously homeless). Per-school/year, directional unit economics:

| Offering | Price add | Incremental ARR | Infra + AI cost | Support cost | Margin | Adoption effect |
|---|---|---|---|---|---|---|
| Core (kernel) | ₹120–180/student | base | high (AI gateway, rails) | base | ~55–60% | — |
| Operations Pack | +₹45/student | **+25–35% ARPA** | GPS ingest, storage | low (self-serve enable) | ~70% | daily-use → strongest retention |
| Academic Pack | +₹35/student | +20% | low (AI bounded) | low | ~75% | drives teacher habit |
| Campus Life Pack | +₹30/student | +15% | low | low | ~70% | secondary-school skew |
| Compliance Pack (per board) | +₹25–40k flat/school | high on small schools | near-zero | authoring amortized | ~85% | stickiness + audit story |
| Enterprise (B/C modes) | 3–8× uplift | concentrated | infra-heavy | service-heavy | ~50–65% | logo value |
| Rails (WhatsApp/SMS/AI/UPI) | metered | scales with adoption | pass-through | low | 15–25% | volume lock-in |

Anti-micro-module rule retained (three packs + compliance, never a la carte). **Support-explosion guard:** partner plugins are supported by partners (cert SLA tiering); SchoolOS supports kernel + first-party only — expansion grows support cost sublinearly. Pro-school thin-margin concern: packs lift ARPA 1.6–2.1× at ~70%+ gross margin with <20% support growth; rails revenue compounds with usage, not headcount.

---

## 19. UPDATED THREAT MODEL (delta from docs/11 §6)

New/refined: **budget-exhaustion DoS** (per-plugin isolation + kernel headroom) · **cross-plugin privilege laundering via sync exception** (acyclicity + runtime authz on the sanctioned path) · **cert-gaming** (eval golden sets private, rotating; cert re-run on every artifact) · **sovereignty bypass** (contract-level regions enforced at runtime, tested) · **drain-avoidance abuse** (disable storms to dodge approvals — drain protocol makes pending work visible and reassigned, audited) · **lineage-view information disclosure** (ops-only visibility, RLS'd). All prior threats and mitigations stand unchanged.

## 19b. FAILURE MODE ANALYSIS

| Failure | Detection | Containment | Degraded mode | Human visibility | Recovery | Audit |
|---|---|---|---|---|---|---|
| Malicious plugin | anomaly (egress/scope) | kill switch, suspend | its slots vanish; kernel runs | Control Plane banner + owner email | investigation, revoke keys | full |
| Compromised update | staged-rollout anomaly halt | auto-halt, version pin | previous version re-enabled | release incident notice | rollback artifact | version trail |
| Broken plugin (crash loop) | health probe + breaker | auto-degrade | degraded flag, slots dimmed | banner | fix/upgrade | breaker events |
| Event storm | budgets/breaker | breaker open | events dropped to DLQ | ops alert | replay from DLQ | DLQ ledger |
| Migration failure mid-upgrade | migration guard | auto-rollback (down-migration) | previous version | admin alert | fix + re-upgrade | migration ledger |
| Wrong parent communication | receipt anomaly + rate check | comms quota freeze | queued, unapproved | principal + parent apology flow | re-send correct | send + correction |
| PII leak via AI | output filters + classification gate | capability disabled | transformation refused | privacy officer alert | rotate, patch contract | trace + filter log |
| Excessive AI scope | budget + scope gate | budget exhausted → refuse | deterministic fallback path | budget report | raise budget (audited) | budget ledger |
| Stuck uninstall | uninstall watchdog | force-purge after window | data sealed, export held | admin task | manual ops runbook | purge certificate |
| Circular event chain | causation-loop detector | chain cut at depth | later hops queued | ops alert | refactor subscriber | cut record |
| Dependency disappears | enable-time dep check | dependents degraded | features dimmed | banner | replace dependency | dep graph snapshot |
| Publisher disappears | liveness (contract) | source escrow release | community fork path | marketplace notice | escrow/fork | escrow record |
| Kernel incompatibility | compat gate at upgrade | install blocked | current version keeps running | upgrade report | re-certify | gate record |
| AI budget abuse | budget ledger | exhaustion | deterministic path | finance + ops | budget change | ledger |
| Unavailable during critical process | timeout/deadline | command fails closed | manual fallback (degraded ops thesis) | process owner | vendor SLA | timeout trace |

---

## 20. UPDATED ROADMAP

- **Now (shipped):** docs/12 contract-level reclassification; migration 003 (lifecycle states, capability_contracts, budgets, breaker, trust_level, cert_score); all docs/11 proofs stand.
- **Next quarter:** money/work/artifact primitive extraction (contract-first: `money.post`, `work.open`, `artifact.put`); event envelope v2 (schema_version + budgets enforcement); drain protocol implementation in Plugin Manager; Attention ranking-participation for slot contributions; lineage view v0.
- **Then:** certification suite v1 (blocking categories automated); TS SDK beta; first two rail integrations as T2; CBSE pack v0.
- **Later:** staged marketplace per docs/11 §12 gates; additional SDK bindings only at Stage 3+.

## 21. EXACT CHANGES TO docs/01–08, 10–11

| Doc | Change |
|---|---|
| 01 vision | add one line: "packs + certification = expansion model" |
| 02 product experience | reference §16 slot governance; add drain-visibility banner spec |
| 03 intelligence layer | replace deterministic-first sentence with §11 corrected principle; add transformation/decision table |
| 04 platform & security | insert §5 isolation table, §9 data concepts, §19 threat deltas |
| 05 business & roadmap | replace pack list with §18 (adds Academic Pack); add margin table |
| 06 refinement v2 | note Attention contributions enter ranking (no silent injection) |
| 07 flagships & demo | Plugin Manager demo beat gains drain/visibility line ("disable → work hands back, nothing lost") |
| 08 production build plan | P2 adds money/work/artifact primitive extraction + envelope v2 + drain protocol; P4 adds certification program (§8) |
| 10 | already superseded by 11 — no change |
| 11 | add amendment banner → docs/12; its §3 finance/attendance rows and §7 AI rule are amended by this doc |

## 22. WHAT MUST REMAIN UNCHANGED (invariant audit — all pass)

Platform kernel + capability runtime · four plugin classes · one contract for all · **EVENT → POLICY → AI/REASON → APPROVAL → ACTION → VERIFICATION → AUDIT** · deterministic-first (as corrected, §11) · permission-bound AI · School Constitution (+ no-relaxation rule for packs) · Control Plane · append-only audit · migration-as-product · WhatsApp-first · degraded operation · kernel-owned surfaces · staged marketplace · no agent zoo · no low-code · no direct plugin DB access · no direct plugin comms · no microservices by default · no feature expansion from this pass.

## 23. IMPLEMENT IMMEDIATELY (grounded now)

1. **Migration 003** — shipped this pass (lifecycle states, capability_contracts, budgets, breaker, trust_level, cert_score; 15/15 tests still green).
2. Contract-first primitive extraction plan (§3 note) — declared in `app.capability_contracts` as the money/work/artifact contracts before code moves.
3. Event envelope v2 columns + budget enforcement in dispatcher.
4. Drain protocol in Plugin Manager (disable = hand-back flow).
5. Attention slot contributions → ranking inputs (remove any direct-injection path).
6. Lineage view v0 in Control Plane.
7. Docs amendments (§21) — this document.

## 24. DEFER TO SDK/MARKETPLACE STAGE

Isolation escalation beyond in-process+scoped-roles (containers/WASM/sandbox broker) · cert program operation (suite exists first) · non-TS SDKs · marketplace listing infrastructure · pack authoring tooling · dedicated/sovereign mode operations (contract already supports).

---

## Appendix A — Challenge passes (personas → objection → resolution)

| Persona | Strongest objection | Resolution |
|---|---|---|
| Enterprise CTO | "Per-plugin PG schemas at 2,000 tenants won't scale" | storage namespace API is the contract; physical mapping per mode (§9/§14) |
| School CIO | "Vendor goes bust mid-WO?" | drain protocol: actions hand back, history exported (§12) |
| Security architect | "First-party in-process = god mode" | in-process ≠ unrestricted: per-plugin scoped roles + contracts enforced for T1 too (§5) |
| Privacy officer | "AI on children's voice data?" | classification gates + transformation rules + regional routing (§4/§11) |
| Platform engineer | "Chain-depth cap breaks long workflows" | depth caps synchronous reflexes; workflows persist in work-objects (§10) |
| Plugin developer | "Contracts are heavy" | tiered conformance: minimal subset in dev, full cert before production (§8) |
| Malicious developer | "Exhaust a rival's budget" | per-plugin isolated budgets + kernel headroom (§10) |
| Principal | "More switches = confusion" | packs are the admin unit; modules nest inside (§18) |
| Coordinator | "Disable ate my case" | drain protocol + visibility banner (§12) |
| Finance buyer | "Packs inflate price" | pack ≈ 60–70% of à-la-carte; usage transparency on invoice (§18) |
| Infra operator | "2am incident — which plugin?" | plugin_id + cert version on every log/trace/audit row; lineage view; ≤60s kill switch |
| SaaS CFO | "Pro economics stay thin" | §18: ARPA ×1.6–2.1 at 70%+ margin, support sublinear |
| Competitor | "Copy the contract" | open contract is deliberate; moat = cert + packs + corpora + rails (docs/11 §14) |

**Pass 2 (consistency):** fee-structures → plugin still reconciles (kernel reconciliation primitive + settlement events); cases → capability still guarantees SLA (work-object primitive in kernel). **Pass 3 (invariants):** every §22 row re-verified against each change; the two softened absolutes (AI rule, plugin-to-plugin) both gained enforcement machinery rather than losing it. **Pass 4 (§20 quality bar):** security ✓ · UX ✓ (slot governance) · economics ✓ (§18) · reliability ✓ (§10/§19b) · extensibility ✓ (protocol neutral, §13) · operational complexity ✓ (no new infra: Postgres runtime, modes are ops procedures).

## Appendix B — The invariant, component by component

CORE provides trust (kernel primitives) · RUNTIME provides governance (capability contracts, budgets, breakers) · PLUGINS provide capabilities · INTEGRATIONS connect the world · POLICY PACKS provide local rules · THE SCHOOL GRAPH provides context · THE EVENT SPINE provides causality · THE ACTION SPINE provides control · THE AUDIT LEDGER provides proof — and every capability rides **EVENT → POLICY → AI/REASON → APPROVAL → ACTION → VERIFICATION → AUDIT**.
