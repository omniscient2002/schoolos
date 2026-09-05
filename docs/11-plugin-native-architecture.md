# SchoolOS Plugin-Native Architecture — Platform Architecture v2
**Status: adopted as target architecture · supersedes docs/10 · amended by [docs/12-enterprise-hardening.md](12-enterprise-hardening.md) (2026-09) · 2026-09**

> **Amendments (docs/12, all non-weakening):** kernel split into primitives vs domain capabilities (§3 of docs/12 — attendance/fees/cases/memory/documents split; money/work/artifact become kernel primitives) · Capability Contract is first-class (`app.capability_contracts`) · AI rule corrected to "deterministic-first wherever an authoritative deterministic rule exists; AI may perform bounded transformations" · trust ladder T0–T4 orthogonal to plugin class · event budgets + circuit breakers · 14-state lifecycle with drain protocol · tenancy modes A/B/C · plugin protocol made language-neutral (TS SDK remains V1) · certification framework with blocking categories. The target architecture and all invariants below stand.

> "SchoolOS has a stable operating core that can safely absorb new capabilities without constantly changing its foundation."

This document answers the boundary question — what is kernel, what is plugin, what is pack — and specifies the full plugin model: manifest, events, security, AI, UI, data, lifecycle, SDK, marketplace, economics, and moat. It is written against the **existing implemented system** (kernel surfaces `/today /attention /ask /next /people /learning /operations /insights /automation /memory`, action spine, capability-centric AI gateway, append-only audit ledger, migration engine, plugin registry + Plugin Manager already shipped).

---

## 0. VERDICT AND SCORE

**Adopt the plugin-native architecture. Score: 9.1/10 as designed below** (the naive version everyone builds — "everything is a plugin" — scores ~4/10 and is explicitly rejected).

| Model | Verdict |
|---|---|
| A. Current architecture (features, flags, control plane) | Strong spine, no ecosystem seam. Score 7.4 |
| B. Everything is a plugin | **REJECTED.** Fragmented core, incoherent UX, security theater. 4.1 |
| C. Core + controlled plugins | Good, but plugins get special treatment → second-class hacks. 8.0 |
| D. Microservices + plugins | **REJECTED.** Operational weight, latency, no school-visible gain. 5.9 |
| **E. Platform kernel + capability runtime + controlled plugins** | **ADOPTED.** One kernel contract, all plugins consume it identically, first-party included. 9.1 |

The decisive insight: **the kernel is small and absolute; everything else — including our own modules — is a plugin that speaks one contract.** First-party status is a business distinction (bundled, dogfooded, certified T1), never a technical distinction (no bypasses, no private APIs).

---

## 1. RECOMMENDED ARCHITECTURE

**SchoolOS = Operating Kernel + Capability Runtime + Plugins (four classes) + Policy Packs.**

```
┌────────────────────────────────────────────────────────────────────┐
│ SCHOOL EXPERIENCE (kernel-owned surfaces)                          │
│   TODAY · ATTENTION · ASK · NEXT · PEOPLE · LEARNING ·             │
│   OPERATIONS · INSIGHTS · AUTOMATION · MEMORY                      │
│   — plugins extend these surfaces; they never replace them —       │
├────────────────────────────────────────────────────────────────────┤
│ CAPABILITY RUNTIME (the only door a plugin gets)                   │
│   Event Bus ─ Action Spine ─ Comms Orchestrator ─ AI Gateway ─     │
│   Policy Engine (Constitution) ─ Retrieval/Search ─ Audit ─        │
│   Storage (scoped) ─ Scheduler ─ Plugin Manager                    │
├────────────────────────────────────────────────────────────────────┤
│ OPERATING KERNEL (permanent, not pluggable)                        │
│   School Graph (people·enrollment·attendance·fees) · Tenancy ·     │
│   Identity/AuthZ/RLS · Schema Registry · Money/Receipts · Memory   │
├────────────────────────────────────────────────────────────────────┤
│ PLUGIN CLASSES                                                     │
│   ① Capability plugins (first-party: transport, maintenance…)      │
│   ② Integration plugins (rails: WhatsApp BSP, UPI, GPS, Tally…)    │
│   ③ Policy packs (CBSE / ICSE / IB / State / RTE / DPDP)           │
│   ④ Third-party plugins (marketplace, gated — see §12)             │
└────────────────────────────────────────────────────────────────────┘
```

**The one invariant that defines the architecture:** every capability — first-party or third — participates in

> **EVENT → POLICY → AI/REASON → APPROVAL → ACTION → VERIFICATION → AUDIT**

and no plugin can reach any part of that loop except through the Capability Runtime. The loop is the OS. Plugins are device drivers for it.

---

## 2. CORE VS PLUGIN BOUNDARY TABLE

The test for kernel membership is not importance — it is: **"if this were optional, could a school be trusted?"**

### 2.1 PLATFORM KERNEL — permanently inside (non-negotiable)

| Kernel capability | Why it can never be a plugin | What plugins may do with it |
|---|---|---|
| **Identity & Person Registry** (school graph: person, student, staff, guardian, relationships) | Every safety guarantee (who may message whose child) collapses if graph ownership fragments | Read via scoped person API; never write |
| **Tenancy, RLS, sessions, roles** | Isolation is not a feature | Nothing. Absorbed implicitly |
| **Permission engine** (role + scope resolution) | The thing that would enforce plugin permissions can't itself be permissioned to a plugin | Declare requested permissions in manifest |
| **Event Bus + Schema Registry** | The loop starts here; ordering/idempotency/replay must be invariable | Publish registered event types; subscribe to approved ones |
| **Action Spine** (raise/approve/execute/verify/expire, SLA, delegation) | The governance guarantee: nothing consequential happens unranked, unapproved, unaudited | Raise typed actions; execute approved ones; never bypass |
| **Communication Orchestrator** (consent, quiet hours, dedup, receipts, template registry) | A rogue message to 500 parents is the industry's nightmare; safety must be invariable | Request sends via typed intents; channels are integration plugins beneath the orchestrator |
| **AI Gateway** (capability registry, routing, grounding, budgets, evals, traces) | Deterministic-first + permission-bound AI is the thesis | Request AI *capabilities*, never models |
| **Audit Ledger** (append-only, hash-chained) | Trust substrate. If plugins could write around it, it would be worthless | Request audit entries through the kernel API |
| **School Memory** (decisions, expected-vs-actual) | Institutional memory outlives every plugin | Append via kernel; never delete |
| **School Graph records: enrollment, attendance, fees/payments** | Legal/statutory spine in India (RTE register, fee receipts); the 80% that every school must run | Read via scopes. Money flows are kernel-only, forever |
| **Policy Engine (School Constitution)** | Human-approval boundaries, safeguarding net, §-referenced rules must be invariable | Policy *packs* extend rules; core boundaries (§2.4) are immutable |
| **Retrieval/Search** | Grounding substrate for Ask and AI; must index only what permissions allow | Contributed content indexed automatically from plugin-owned data |
| **Migration Engine** (migration-as-product) | Trust receipt, ₹0-difference reconciliation — the wedge product | Contribute *connectors* as plugins; the engine stays kernel |
| **Plugin Manager, registry, entitlements** | The switchboard cannot be a switch on itself | Nothing |

### 2.2 FIRST-PARTY CAPABILITY PLUGINS — dogfooded, bundled by pack

transport (GPS, routes, delays) · maintenance & facilities (assets, WOs, SLA) · reception/telephony front desk · admissions CRM · library · exams & assessment · timetable (primitives provider) · hostel · canteen · inventory · visitor management · sports & clubs · alumni · analytics extensions.

**Attendance, enrollment, fees, people remain kernel** (see §16 challenge pass 1) — but *transport is a plugin reading the roster*, *exams read the graph*, etc. This is the proof the seam is real: the modules we ship are clients of the same runtime a stranger would use.

### 2.3 INTEGRATION PLUGINS — the rails

WhatsApp BSP (Gupshup/Meta Cloud API), SMS, email · payment gateways (Razorpay/Cashfree/UPI) · GPS trackers · biometric/RFID attendance hardware · accounting (Tally/Zoho) · SSO (Google/Microsoft) · board portals (CBSE OASIS etc.) · LMS (Moodle). **Rule:** integrations are headless. They adapt rails ↔ kernel; they get no UI surface except status in Control Plane. Communication *channels* sit beneath the kernel Orchestrator and can never send without an approved intent.

### 2.4 COUNTRY/BOARD POLICY PACKS — rules, not code

CBSE, ICSE, IB, NIOS, state boards; India (RTE, DPDP); later Gulf/SEA. A pack = **data + evaluated rules**: calendars & holidays, grading scales, attestation/report formats, compliance report templates, retention schedules, board portal export formats, fee-regulation caps where applicable. Packs are **certified data packages consumed by the kernel Policy Engine** — not code, not UI. This keeps "India-first" a kernel virtue without hardcoding CBSE into the core. Safeguarding/POCSO boundaries are **not** pack content; they are kernel (§2.1) — a board can add obligations, never relax protections.

### 2.5 THIRD-PARTY PLUGINS — future, gated (see §12)

---

## 3. PLUGIN TAXONOMY

| # | Class | Trust level | Runs | UI | Examples |
|---|---|---|---|---|---|
| ① | **Capability** (domain) | T1 (first-party) | In-process, kernel runtime, same contract as anyone | Full surfaces via slots/routes | Transport, Maintenance, Library |
| ② | **Integration** (rails) | T1/T2 | In-process adapter or out-of-process webhook | Control Plane status only | UPI gateway, WhatsApp BSP, GPS |
| ③ | **Policy pack** | T1/T2 certified | Data consumed by Policy Engine | Report templates, Compliance section | CBSE pack, RTE pack |
| ④ | **Third-party** | T3/T4 | Out-of-process, sandboxed | Restricted slots, reviewed widgets | Coaching content, photo vendor |

Anti-taxonomy (explicit non-goals): no "agent plugins", no plugin-defined LLM chains, no plugin that is really a configuration blob pretending to be software (low-code drift, §16 pass 1).

---

## 4. PLUGIN MANIFEST

Versioned, signed for T2+. Stored in `app.plugins.manifest` (registry shipped; runtime enforcement is the Platform Core work in §18).

```yaml
id: in.schoolos.transport            # reverse-DNS, immutable, unique
name: Transport
version: 1.4.0                       # semver; breaking = major
kernel: ">=1.0.0 <2.0.0"             # compat range, hard gate
class: capability                    # capability | integration | policy-pack | third-party
trust: T1                            # T1 first-party · T2 certified · T3 sandboxed · T4 review-required
signature: cosign://schoolos/prod/…  # required for T2+

permissions:                         # typed, smallest-possible, user-visible
  - graph.read:students              #   scope-annotated
  - attendance.read:section
  - events.publish: [transport.delay, transport.arrived]
  - events.subscribe: [attendance.marked, student.enrolled]
  - actions.raise: [notify_guardians, schedule_inspection]
  - comms.request: [whatsapp.template]   # intent only — orchestrator sends
  - audit.request
  - ai.request: [draft.parent_message, summarize.delay_pattern]   # capabilities, never models
  - storage.own                      # plugin-private schema only

events:                              # declared, schema-versioned (§5)
  publish:
    - { type: transport.delay, schema: v1 }
  subscribe:
    - { type: attendance.marked, schema: ">=1.0 <2" }

ui:                                  # rationed slots (§8)
  nav:        { label: Transport, icon: bus, roles: [principal, transport, coordinator] }
  routes:     ["/transport", "/transport/routes"]
  widgets:
    - { slot: attention, max_weight: 60 }   # principal attention, budgeted
    - { slot: student-record, tab: transport }
  ask_facts: [route_roster, delay_history]  # retrieval contributions, not answers

data:
  schema: plugin_transport           # plugin-private Postgres schema, RLS-enforced
  core_refs: [students.id, staff.id] # typed references; read-only joins via views
  custom_fields:                     # namespaced onto core entities, finite types
    - { entity: student, key: transport.bus_route, type: enum, options_ref: routes }
  retention: { on_uninstall: export_then_purge_30d }
  residency: [IN]                    # hard restriction
regions: [IN]
billing: { model: pack, pack: operations, metered: [gps_pings] }
dependencies: []                     # acyclic; kernel never depends on plugins
automation:
  triggers:
    - on: attendance.marked          # absence correlation
      guard: "delay_minutes >= 10"   # deterministic-first: rules before AI
      then: { raise_action: notify_guardians, approval: required, policy_ref: "Transport §3.1" }
lifecycle:                           # kernel-invoked hooks
  install: install.sql               # additive-only migrations (§10)
  activate: on_activate
  deactivate: on_deactivate          # must complete/hand-back pending actions
  upgrade: { from: ">=1.3 <1.5", migrate: v15.sql, rollback: v15_down.sql }
  health: /healthz                   # class E; kernel probes
observability: { otlp: true, log_level: info }
certification: { evals: [conformance, delay-policy-suite], last_certified: 2026-09 }
```

**Manifest rules that matter:** every field is enforced, not advisory (kernel validates on install). `permissions` and `events` are added only via a *version upgrade that re-triggers review* — the manifest is a security contract, not documentation.

---

## 5. EVENT ARCHITECTURE

The event bus is the loop's circulatory system. Kernel-owned: schema registry, dispatch, ordering, retries, replay, DLQ, tenancy filter.

**Envelope v1** (extends the existing `app.events` + outbox pattern):

```
{ id: uuid, tenant_id, type: "transport.delay", schema_version: 1,
  occurred_at, emitted_by: "plugin:in.schoolos.transport@1.4.0",
  subject: "route:7|2026-09-05",            # aggregate root (ordering key)
  correlation_id: <loop id>, causation_id: <event that caused this>,
  payload: { route_code, delay_minutes, riders: 75, note },
  policy_refs: ["Transport §3.1"] }         # constitution linkage
```

| Concern | Decision |
|---|---|
| **Transport** | Postgres outbox (already implemented) → dispatcher → per-subscriber queue. No Kafka. No new infra |
| **Schema versioning** | Registry validates on publish. Additive = minor (consumers tolerate). Breaking = new major topic (`transport.delay.v2`), 6-month dual-emit window |
| **Idempotency** | Subscriber declares idempotency key (`event.id + handler`); kernel dedups. Every handler idempotent or it doesn't ship |
| **Ordering** | Guaranteed per `(tenant_id, subject)` only. Cross-aggregate ordering is explicitly unsupported |
| **Replay** | Event store retained 400d (policy-pack configurable). Replay = kernel admin op per tenant, per topic, dry-run first. Replays re-enter the **same loop** — approvals are never auto-replayed (human decisions are not replayable) |
| **Retries** | Exp backoff, 5 attempts → DLQ. DLQ surfaces in Control Plane (Operations), with replay/patch/drop — all audited |
| **Tenant filtering** | Dispatch layer injects `schoolos.tenant_id`; a subscriber physically cannot see another tenant's events (same RLS machinery as the API) |
| **Permissions** | `events.subscribe` in manifest + tenant-admin enablement. Kernel events (attendance.marked, payment.failed) are read-only facts; only kernel can emit them |
| **Fan-out contract** | One event, many subscribers, no cross-talk: `transport.delay` → comms intent → case → attention/tomorrow contribution → analytics, each independently, each audited |

Canonical flows (already live in demo data): `attendance.marked → absence notices (§1.1) → parent comms`; `transport.delay → approval-required notice action (§3.1) → approved → delivered comms`; `payment.failed → reconciliation → case → principal attention`.

---

## 6. SECURITY MODEL

Assume every third-party developer is malicious or incompetent. Trust levels: **T1** first-party (still no bypasses) · **T2** certified partner (signed, reviewed) · **T3** sandboxed dev · **T4** provisional (human-review queue for actions).

| Threat | Mitigation |
|---|---|
| Malicious plugin (exfiltrate student PII) | No direct DB. Scoped views + RLS. Egress deny-by-default; class E runs in namespace with network policy. PII never enters AI prompts without capability-level masking |
| Compromised developer account | Signed releases; publisher key pinned; permission-gain updates go to review; instant tenant-level kill switch; publisher suspension propagates to all installs |
| Malicious update | Updates are new artifacts (not patches): re-signed, re-validated, compat-gated, staged rollout 1% → 10% → 100% with auto-halt on anomaly (error rate, audit volume, egress spikes) |
| Supply-chain attack | SBOM required; dependencies pinned; kernel runtime rejects unsigned artifacts; CI reproducibility for T2 |
| Excessive permissions | Manifest is a ceiling; runtime enforces per-call. Permission bundles reviewed at install; Usage of ungranted permission = hard error + audit event |
| Cross-tenant access | Every plugin call carries tenant context from the session, never from plugin input. RLS at storage; tenancy filter at bus; tests in CI run cross-tenant negative suites |
| Prompt injection via plugin content | Plugin data is **untrusted input** to the AI Gateway: retrieval results are quoted/delimited, tool execution never triggered by retrieved text, tool calls re-validated against manifest, and anything with side effects routes to approval |
| Data exfiltration via AI | AI Gateway enforces per-capability data scopes — the model never sees what the plugin's permissions don't allow; output filters scan for identifiers not present in allowed scope |
| Malicious webhook (class E) | Signed payloads (HMAC + timestamp + replay window), allowlisted endpoints, schema-validated, rate-limited, quarantined tenant on anomaly |
| Privilege escalation | Plugin tokens are scoped JWTs (`plugin_id`, tenant, grants, exp ≤ 15min); no recursive capability requests (plugins can't mint tokens) |
| Unauthorized AI tool execution | Tools are manifest-declared + tenant-approved; each execution = typed action with audit + verification step |
| Hidden background activity | No daemons. Work happens only via event subscriptions or scheduled kernel jobs (declared, capped). Kernel detects undeclared recurring access patterns → auto-suspend |
| HUMAN-ONLY actions | Kernel-enforced list: safeguarding conclusions, fee waivers > ₹X, exclusion of student, bulk comms > N, curriculum changes, staff records. Plugins may *propose*; only approved humans *execute* |

**The four never-bypass rules (kernel-enforced, tested in CI):**
1. Never bypass tenant isolation.
2. Never bypass the action spine — no side effects outside plugin-owned storage without a raised action.
3. Never bypass audit — every external effect requests a ledger entry.
4. Never send external communications directly — intents through the Orchestrator only (consent, quiet hours, dedup, receipts apply).

---

## 7. AI INTEGRATION MODEL

Plugins never see models. They request **capabilities** from the AI Gateway (existing capability-centric design, extended):

```
PLUGIN → CAPABILITY REQUEST → POLICY (constitution) → PERMISSION (manifest ∩ tenant)
      → RETRIEVAL (scoped) → MODEL (kernel-routed, regional) → TOOL (typed, manifest-declared)
      → APPROVAL (human where policy demands) → ACTION (spine) → VERIFICATION → AUDIT
```

- **Requestable capabilities (v1 catalog):** `draft.parent_message` · `summarize.day/attention` · `classify.signal` · `extract.document` · `match.dedupe` · `answer.query` (Ask) · `rank.attention` (kernel-owned; plugins contribute features, never the ranker).
- **Deterministic-first:** a plugin trigger must define its deterministic guard (e.g. `delay_minutes >= 10`) before any AI capability is invoked. AI drafts and explains; rules decide. A capability request that isn't justified by a rule is refused and audited.
- **Grounding:** mandatory; retrieval respects the plugin's permission scopes, nothing more.
- **Regional routing:** gateway honors pack + plugin `regions`/`residency` (e.g. DPDP → IN-region inference).
- **Budgets:** per plugin per tenant: requests/day, tokens/day, tool executions/day. Exhausted = graceful refusal (degraded operation, kernel keeps functioning — thesis: "degraded operation with AI disabled" now applies per plugin too).
- **Eval corpus:** every capability has a golden set (already the practice); plugins adding capabilities contribute cases; certification re-runs evals.
- **Human approval + verification:** AI outputs that act become actions in the spine; verification (delivery receipts, value checks) closes the loop; everything lands in the audit ledger with trace IDs.

---

## 8. UI EXTENSION MODEL

The ten SchoolOS surfaces are kernel-owned and unchanged. Plugins appear as **native atoms** inside them:

| Surface | Plugin extension | Ration |
|---|---|---|
| **TODAY** | contextual cards from subscribed events (delay, WO closed) | max 3 injected items |
| **ATTENTION** | ranked widget contributions | max 2 plugin widgets (implemented) |
| **ASK** | facts via retrieval (`ask_facts`); AI answers stay kernel | no plugin answers |
| **NEXT** | recommended actions via typed action templates | policy-gated |
| **PEOPLE** | `student-record` tab (transport ledger, library loans) | max 2 tabs |
| **LEARNING / OPERATIONS / INSIGHTS / AUTOMATION / MEMORY** | section cards, workflow templates, report cards, trigger contributions, memory appends | per-slot budget in manifest |
| **NAV** | one nav item per plugin | none if disabled (implemented) |
| **Command palette** | verbs (`action.verbs`) | ranked after kernel verbs |

Rules: kernel design system only (no plugin CSS bundles for T1–T3); every plugin card carries provenance (which plugin, which policy, which evidence — EvidenceChain/AiTraceCard components); disabled plugin = zero DOM presence (no dead links — implemented via `KernelGate`); UX conformance is part of certification.

---

## 9. PLUGIN DATA MODEL

Three strict zones:

| Zone | Lives in | Who writes | Examples |
|---|---|---|---|
| **CORE** | `app.*` kernel tables | Kernel only | students, attendance, fees, payments, actions, audit, memory |
| **PLUGIN** | `plugin_<id>.*` schemas, RLS-scoped, plugin-only | Plugin via typed interface | plugin_transport.routes, plugin_library.loans |
| **TENANT CUSTOM** | namespaced typed extension columns/tables, admin-approved | Kernel API on behalf of tenant admin | `student.transport.bus_route`, custom_fields registry |

Rules: plugins reference core rows by id (typed `core_refs`), read via **views** that project only granted scopes, never `UPDATE core tables`; custom fields are a **finite typed registry** (enum/number/text/date/ref) with namespacing `plugin.<id>.<field>` — not EAV anarchy, not a low-code form builder; custom event types must register a schema (prefixed `plugin.<id>.<event>`); custom workflow states are **not allowed on core workflows** — plugins define their own workflows over their own entities using kernel workflow templates (state machine + SLA + approvals). Arbitrary DB coupling is impossible because plugins have no core DDL grant — enforced by the `schoolos_app`-style role pattern already used for RLS.

---

## 10. LIFECYCLE & VERSIONING MODEL

```
registered → installed → enabled → [disabled ↔ enabled] → uninstalled
                    ↘ suspended (kernel kill switch, audited, appeal)
```

- **Install:** manifest validation → compat gate → permission consent (tenant admin) → additive-only migration (every plugin migration must be reversible or additive; destructive steps need a two-phase `prepare/commit` pair).
- **Enable:** entitlement check → dependency check → health probe → nav/routes/widgets appear; subscriptions arm; failure = enabled-but-degraded flag + Control Plane alert (never a broken surface).
- **Disable:** subscriptions disarm; widgets/routes/nav vanish (implemented); **pending actions must complete or hand back** (kernel reassigns) — a disabled plugin can never orphan an approval; data retained.
- **Upgrade:** new signed artifact; compat gate; migration with tested rollback; staged rollout (§6); permission additions force re-consent.
- **Rollback:** code + paired down-migration; kernel refuses rollback if data shape changed irreversibly (documented at install).
- **Uninstall:** 30-day export window, retention schedule applies, audit trail of the plugin's effects persists forever (ledger immutability includes plugin history).
- **Deprecation:** kernel majors deprecate surfaces 2 majors ahead; conformance suite runs against both.

---

## 11. DEVELOPER SDK CONCEPT

`@schoolos/sdk` (Node/TS) — the same door first-party plugins use:

- **Manifest toolkit:** typed manifest schema, validation, signing helper.
- **Kernel client:** typed clients for events (publish/subscribe), actions, comms intents, audit, scoped storage, retrieval, AI capabilities. Every client enforces the manifest at dev time (can't compile an ungranted call).
- **Dev harness:** local kernel (docker compose — already shipped), seeded Meridian tenant, event replay, **policy simulator** (feed an event, see the loop: policy hit, AI draft, approval, comms, audit), conformance suite runner.
- **Conformance suite (certification gate):** isolation negatives (cross-tenant), idempotency, degraded-mode behavior, permission-ceiling tests, UX conformance, audit completeness.
- **CLI:** `schoolos plugin init / dev / test / package / sign / submit`.

SDK beta unlocks at Stage 2 (§12) — after first-party modules have dogfooded the interface and the conformance suite exists.

---

## 12. MARKETPLACE ROADMAP (gated — do not launch prematurely)

| Stage | Scope | Gate to advance |
|---|---|---|
| **1. Internal modular plugins** (now) | First-party modules behind manifest + registry + Plugin Manager (shipped) | 3+ modules migrated onto the SDK-shaped contract; loop invariant tested in CI |
| **2. First-party extension SDK** | SDK alpha; integrations (UPI, WhatsApp BSP v2, Tally) become manifest plugins | 3 external pilot integrations run without kernel changes; conformance suite stable |
| **3. Certified integration partners** | T2 program: review, signing, revenue-share on rails | 10 certified partners; incident rate < threshold; security review board operating |
| **4. Developer sandbox** | T3 sandbox tenants, seeded data, self-serve harness | Sandbox abuse controls proven (quotas, egress, kill switch drills) |
| **5. Private school-installed plugins** | Tenant-scoped marketplace (school groups choose vendors) | 25 schools with private installs; audit anomaly detection mature |
| **6. Public marketplace** | Full catalog, ratings, cert badges | Dedicated trust & safety staffing; economics per §13 proven |

---

## 13. BUSINESS MODEL IMPLICATIONS

**Bundles, not à la carte.** A menu of 15 paid micro-modules makes schools poor assemblers and us poor support.

| Offering | Contents | Pricing |
|---|---|---|
| **Core** (included) | Kernel: graph, attendance, fees, comms, audit, Ask, attention | Per student/year tiered |
| **Operations Pack** | transport, maintenance, inventory, visitor | Add-on, per campus |
| **Campus Life Pack** | library, hostel, canteen, sports, events, alumni | Add-on, per campus |
| **Compliance Packs** | CBSE / ICSE / IB / RTE / DPDP report+attestation | Per board, per year |
| **Rails** | WhatsApp, SMS, AI, payment processing | **Usage-metered** at cost+margin (the only usage-based pricing) |
| **Enterprise** | SSO, residency, dedicated rails, custom packs | Negotiated |

Rules: no per-seat plugin pricing (perversely rewards non-adoption); no paywalled *safety* (safeguarding, audit are core); integrations that consume rails (GPS pings, gateway TPS) meter; partner marketplace later = revenue share (Stage 3+). The Plugin Manager displays entitlements — the sales surface and the trust surface are the same screen.

---

## 14. MOAT ANALYSIS

Does plugin-ness strengthen the moat? **Yes — if the kernel stays small.** Competitors can copy "we have plugins"; they cannot copy:

| Moat | Effect of plugin architecture |
|---|---|
| **Migration corpus** (5,099-row demo parity, connector library) | **Strengthens** — connectors become plugins; every new school migration adds a reusable, certified connector |
| **Policy/compliance packs** | **Strengthens** — CBSE pack is years of institutional detail; packs compound across boards/geographies |
| **Workflow library** (§-referenced, shipped defaults) | **Strengthens** — plugins contribute proven workflows; the library becomes the marketplace's real content |
| **School Memory** | **Strengthens** — memory gravity rises with every module writing decisions into one ledger |
| **AI evaluation corpus** | **Strengthens** — each plugin adds eval cases per capability; evals are the AI moat |
| **Local rails** (WhatsApp/UPI depth) | **Strengthens** — rail integrations certified once serve everyone; switching cost lives in the rails |
| **Reconciliation/money integrity** | **Unchanged** — kernel-only, so a competitor's plugin ecosystem doesn't dilute our guarantee |
| **Developer ecosystem** | **New moat** — certified partners have switching costs in certification + revenue share |
| **Distribution** | **Strengthens** — packs sell through one Plugin Manager screen; partner logos co-sell |
| **Operational data gravity** | **Strengthens** — the more modules feed one audit/event substrate, the more the school's institutional record is uniquely ours |
| **UX polish** | **Weakens if undisciplined** — mitigated: slot rationing, native components, cert (§8) |

The defensible core is **the kernel contract + governance + corpora + rails**. The plugin *mechanism* is table stakes in 3 years; the plugin *ecosystem on top of an audited Indian school operating loop* is not.

---

## 15. ARCHITECTURAL TRADEOFF — SCORES

1–5 per criterion, weighted by platform longevity (final = weighted).

| Criterion (wt) | A current | B everything-plugin | C core+plugins | D microservices | **E kernel+runtime** |
|---|---|---|---|---|---|
| Product coherence (×2) | 4 | 2 | 4 | 3 | **5** |
| Security (×2) | 4 | 2 | 4 | 3 | **5** |
| Development speed (×1.5) | 4 | 2 | 4 | 2 | **4** |
| Extensibility (×2) | 2 | 5 | 4 | 4 | **5** |
| Performance (×1) | 5 | 3 | 4 | 3 | **4** |
| Operational complexity (×1.5) | 5 | 3 | 4 | 1 | **4** |
| Tenant isolation (×2) | 5 | 2 | 4 | 3 | **5** |
| AI governance (×2) | 4 | 1 | 4 | 3 | **5** |
| UX consistency (×1.5) | 5 | 2 | 4 | 3 | **5** |
| Developer ecosystem (×1) | 1 | 5 | 3 | 4 | **4** |
| Long-term moat (×2) | 3 | 3 | 4 | 3 | **5** |
| Cost (×1.5) | 5 | 4 | 4 | 2 | **4** |
| **Weighted** | **3.9** | **2.7** | **3.95** | **2.9** | **4.6 → 9.1/10** |

E beats C because one runtime (same contract for everyone, no special first-party path) removes the two-tier temptation that historically rots plugin systems.

---

## 16. CHALLENGE PASSES (what was considered and rejected)

**Pass 1 — "Make attendance a plugin too."** Rejected. The RTE daily register is a legal record and the loop's most canonical trigger; if it were optional, transport's absence-correlation, comms §1.1, and briefings would all be optional too. Kernel keeps people/enrollment/attendance/fees. *Counter-considered:* boarding schools with biometric hardware — resolved as integration plugins writing attendance *facts* via kernel API, not owning attendance.

**Pass 2 — "Let plugins talk to plugins for speed."** Rejected. Direct plugin→plugin calls create hidden dependency graphs and governance escapes; the bus + typed actions keep the loop auditable. Performance concern resolved by in-process dispatch for first-party plugins (still through the runtime).

**Pass 3 — "Ship marketplace now; it's the moat."** Rejected. An uncataloged, unreviewed plugin store on children's data is how platforms die (see §6 threat model). Stages 1→6 with hard gates (§12); Stage 3 is the earliest revenue-relevant partner stage.

**Pass 4 — "Plugins need a config/forms builder (low-code pull)."** Rejected explicitly. The purpose is *absorbing capabilities safely*, not infinite configurability. Custom fields are a finite typed registry; forms are code-reviewed manifests; the "generic low-code platform" outcome is named as a core risk in §18.

**Pass 5 — "Microservices for plugin isolation."** Rejected as *default*. Isolation is achieved by scoped roles + RLS + (for T3/T4) out-of-process execution of only those plugins. Postgres-based runtime keeps ops at school-district simplicity.

---

## 17. RISKS INTRODUCED / ELIMINATED BY PLUGINS

**Introduced (and mitigated):** manifest sprawl & slot abuse (slot rationing, cert) · two sources of truth (server registry is truth, mirror on client — implemented) · permission fatigue (bundles, plain-language consent) · supply-chain exposure (signing, staged rollout, SBOM) · low-code drift (pass 4 constraints) · orphaned approvals on disable (hand-back contract) · event storm from badly-written plugins (per-plugin quotas, DLQ) · ecosystem support burden (T2 certification carries SLA).

**Eliminated (relative to today's architecture):** feature-request treadmill for niche domains (hostel, canteen, alumni now have a path without kernel changes) · hardcoding of board/country rules (packs) · one-off integration hacks under the desk (rails become certified plugins) · the "second product inside the product" temptation (a module that can't meet the contract can't ship).

---

## 18. EXACT CHANGES REQUIRED TO CURRENT DOCUMENTS

| Document | Change |
|---|---|
| `docs/01-vision-and-market.md` | Add "operating platform with certified packs" positioning; packs = expansion narrative |
| `docs/02-product-experience.md` | Add slot-rationing rules + provenance-on-every-plugin-card to UX constitution |
| `docs/03-intelligence-layer.md` | Reframe AI Gateway as the Capability Runtime's AI half; add plugin capability request catalog + budgets |
| `docs/04-platform-and-security.md` | Insert §6 (threat model, trust levels, four never-bypass rules, sandboxing) |
| `docs/05-business-and-roadmap.md` | Replace any à-la-carte pricing with §13 pack model; add Stage gates to roadmap |
| `docs/06-refinement-v2.md` | Note golden loops remain kernel-pure; plugin demo = Plugin Manager + Library proof |
| `docs/07-build-flagships-and-demo.md` | Add demo beat: IT-admin tour minute — "everything beyond the kernel is a switch" |
| `docs/08-production-build-plan.md` | Re-phase: P2 = capability runtime hardening (manifest enforcement, plugin schemas, scoped roles); P3 = SDK alpha + rail integrations as plugins; P4 = certification program (was: raw telephony build) |
| `docs/09-red-team-audit.md` | Add plugin attack surface to audit scope |
| `docs/10-plugin-architecture.md` | Superseded by this document (v1 kept for the record) |
| **Code TODOs** | enforce manifest permissions server-side (scoped `plugin_<id>` roles — pattern exists in `schoolos_app`); event envelope v2 columns (correlation/causation, schema_version); conformance suite; SDK package |

---

## 19. REVISED ROADMAP IMPACT

- **Now (shipped):** Plugin Manager, registry + RLS, Library proof plugin (nav/route/attention slots, gate, audit), backend `/plugins` API + tests (15/15), docs.
- **Next quarter:** manifest enforcement at runtime; migrate transport + maintenance to manifest-declared permissions; event envelope v2; conformance suite v0; two rail integrations (UPI gateway, Tally) as the first true integration plugins.
- **Following:** SDK alpha (Stage 2), CBSE pack v0 (first policy pack), Attention slot open to T2 partners behind flag.
- **Unchanged invariants:** WhatsApp-first, deterministic-first AI, migration-as-product, audit-complete, degraded-mode excellence. Plugin-ness accelerates these; it never replaces them.

---

## 20. FINAL RECOMMENDATION

**Adopt the kernel + capability-runtime architecture (E).** Keep the kernel ruthlessly small (§2.1 — identity, tenancy, the loop, money, audit, memory, constitution, AI gateway, plugin manager). Ship everything else — including our own transport, maintenance, library — as plugins over one contract, with policy packs carrying India/board complexity as certified data. Open the ecosystem on the staged gates, never before. The purpose is not configurability; it is a foundation that stops changing while the product keeps growing — and an audited loop that every capability, ours or a stranger's, must ride through **EVENT → POLICY → AI/REASON → APPROVAL → ACTION → VERIFICATION → AUDIT**.
