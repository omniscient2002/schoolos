# 04 — Platform: Technical Architecture, Data Model, Migration, Internationalization, Privacy & Security

> Claim labels: **[V]** verified web, **[K]** training knowledge, **[I]** inference, **[D]** proposed design.

---

## 1. Architecture decision: modular monolith on a strict module boundary

**Decision [D]: a modular monolith (TypeScript/Node or similar, single deployable) + separate workflow/worker processes + managed queue + PostgreSQL.** No microservices at v1–v2.

Rationale (scored, not aesthetic):
- Team-scale: a seed-stage team can operate one deployable with real on-call discipline; microservices at this stage convert engineering hours into infra-sitter hours.
- The SchoolOS workload is transactional CRUD + event handling + background jobs — not independent scaling regimes.
- Module boundaries are enforced **structurally** (package-level imports linted; modules communicate via the event spine and service interfaces, never reaching into each other's tables), which preserves the option to extract a service later if a real scaling need appears (migration engine, evaluation pipelines are the likely first extractions).

Deployment: single primary region per residency zone (India / US / EU-UK zones), active-passive with PITR backups; multi-region active-active is explicitly deferred (school data has a natural home region; the complexity is not bought until contracts demand it).

## 2. The stack (chosen for boring reliability)

| Concern | Choice | Why |
|---|---|---|
| Core OLTP | PostgreSQL (managed), RLS per tenant | Transactions, tenancy, FTS+pgvector in one engine at v1 |
| Queue/jobs | Managed queue (SQS/Cloud Tasks-class) + idempotent workers | Event spine without Kafka ops burden; Kafka is a V3 revisit if event volume warrants |
| API | REST (typed, OpenAPI) + webhooks; GraphQL deferred | Simplicity; mobile/WhatsApp surfaces are server-driven |
| Search | PG FTS → Typesense/OpenSearch at scale | Cheap start |
| Vectors | pgvector, per-tenant namespaces | One engine; namespace isolation = AI boundary |
| Warehouse | ClickHouse/BigQuery via CDC in V2 | Analytics without touching OLTP |
| Object storage | S3-compatible, per-tenant prefixes, server-side encryption, AV-scan | Documents, media, exports |
| Cache | Redis | Sessions, rate limits, digest coalescing |
| AuthN | OIDC (Google/Microsoft SSO), WhatsApp OTP for parents, magic links for staff; WebAuthn for admins | Audience-appropriate friction |
| Web/PWA | Next-class SSR + service worker (offline attendance queue) | One web codebase, installable on low-end Android |
| Mobile | PWA first; native wrappers only where WhatsApp/deep-link UX demands | Team scale |
| Observability | OpenTelemetry → managed APM + structured logs + audit ledger (separate, append-only, WORM-style storage) | |
| Infra | One cloud (per residency zone), IaC (Terraform), preview environments | |

## 3. Multi-tenancy and isolation

- **Pool tenancy with RLS** (tenant_id on every row, connection-scoped GUCs, CI tests that fail on any query path lacking tenancy) — not schema-per-tenant (migration pain across thousands of tenants) and not DB-per-tenant (cost) [D].
- Escalation hatch: the largest campus groups with contractual isolation demands can get a dedicated database via the same code path (deployment option, not a fork).
- Storage: per-tenant prefixes + signed short-lived URLs; exports are tenant-scoped archives.
- The audit ledger is append-only, hash-chained per tenant, and replicated to WORM storage — it is the trust artifact for breach forensics and dispute resolution.

## 4. Data model (core spine, abridged)

**Parties:** `person` (unified; staff/student/guardian/lead with role records), `guardianship` (with legal-restriction metadata), `staff_role`, `enrollment` (student↔section, effective-dated), `section`, `subject`, `curriculum_unit`, `skill` (pack-defined), `timetable_slot`, `room`, `bus_route`, `bus_stop`, `vehicle`.
**Operations:** `fee_plan`, `fee_item`, `fee_obligation`, `payment`, `concession`, `receipt`, `leave_request`, `substitution`, `attendance_session`, `attendance_entry`, `assignment`, `submission`, `assessment`, `assessment_item`, `grade`, `mastery_observation`, `lead`, `application_stage`, `document`, `consent`.
**Loop:** `event` (outbox→spine), `workflow_def` (versioned), `workflow_run`, `approval_request`, `task`, `notification` (with delivery receipts), `ai_call` (gateway log), `policy_version` (constitution), `decision_record`.
**Cross-tenant (system-level, never tenant content):** connector registry, workflow-library artifacts (sanitized), model registry, eval corpora (opt-in, consented, scrubbed).

Design rules: effective-dating everywhere history matters (enrollment, fee plans, policies); soft-delete with tombstones; money in minor units with per-currency ledgers; every row carries `tenant_id, created_by, updated_at`; PII columns tagged for redaction in logs and for per-class retention enforcement.

**v2.0 entity additions** (`06` §8.2): `case` (+ case-kind policy: SLA/posture per kind — complaint, incident, request, facilities, reconciliation, compliance), `calendar_event`, `obligation` (deadline-bearing duty with lead-time, owner, breach→case), `reconciliation_run`/`reconciliation_diff`, `health_verdict` (per-record + per-tenant Data Health score), `comm_log` (orchestrated send with full routing history), `vendor` (minimal directory) + `asset` (minimal registry), deepened `decision_record` (alternatives, evidence, expected vs actual, review date), `feature_flag` + governance registry (Control Plane), effective-dated staff `lifecycle_record`. Canonical action spine: one state machine (raised → triaged → owned → [approval] → acted → verified → closed [+ reviewed]) underlying Task/Approval/Case and the ATTENTION/NEXT views.

## 5. Migration Engine (the switching product)

Pipeline [D]: **ingest → schema detect → map propose → validate → shadow load → diff preview → human approval → activate → verify → rollback window.**

1. **Ingest:** CSV/XLSX, legacy ERP exports (India: Entab/MCB/Edunext/Fedena-class dump formats mapped from the corpus), PDFs (fee ledgers, report cards) via doc extraction, photos of paper registers (V1.5), Tally XML for fee history (V2).
2. **Propose mapping:** column→field mapping with confidence scores; entity resolution (duplicate students by name+dob+class heuristics, flagged not auto-merged); relationship repair (guardian links, class assignments).
3. **Validate:** per-rule checks (orphan rows, fee sums vs ledger totals, timetable feasibility, attendance history sanity); a **migration report card** is generated for the coordinator — this artifact alone out-positions incumbent services teams.
4. **Shadow load + diff preview:** the school sees "what SchoolOS thinks your school looks like" before activation; corrections loop back to mapping.
5. **Activate + rollback:** staged switch (attendance first week, fees second, comms third — the "parallel fortnight"); rollback = restore from pre-activation snapshot within the window; post-live verification compares computed totals vs source (fees reconciled to the paisa).

Moat mechanics: every migration adds to the schema-corpus and mapping rules (tenant data never leaves the tenant; only *schemas and mapping outcomes* are learned system-wide, consented) — the asset compounds and is invisible to competitors.

## 6. Permissions architecture

- RBAC baseline (role → capability grants), **ABAC overlay** (guardianship scope, section scope, campus scope for groups), deny-by-default middleware on every tool and endpoint, row-level security in DB, object-level checks for documents/health data.
- Support access: break-glass, time-boxed, school-visible, logged; zero standing access to student content.
- AI inherits operator permissions (§ `03`); headless workers get narrow service scopes enumerated in policy-as-code; permission correctness is a release-gated eval suite (`03` §10).

## 7. Internationalization: packs, not forks

Four pack families [D]; the core schema hard-codes none of it:

| Pack | Contents (examples) |
|---|---|
| **Country** | identity fields, currency & tax, payment rails (UPI+RuPay+netbanking / ACH+cards / BACS+cards / SEPA), comms rails (WhatsApp/SMS-HSM+DLT registration / SMS+email+push / email+MCAS), data residency, retention defaults, language sets, accessibility/locale formats |
| **Board/Curriculum** | skill graph, grading scales, assessment structure, report-card formats (CBSE/ICSE/state/IB-MYP-DP/Cambridge/US-standards/UK-national), exam schemas, transcript exports |
| **Policy** | constitution templates (attendance, fees, comms tone, approvals, safeguarding), starting workflow-library slices |
| **Integration** | connector configs per market (Tally/Zoho, GPS vendors, biometric boxes, IDPs, video) |

Sequencing: India pack (deep) → IB/Cambridge packs (global beachhead) → US independent → UK. The core-tenancy rule: **pack data is configuration in versioned registries; if a pack needs a schema migration, the case is reviewed for generality before it enters core.**

## 8. Privacy & security architecture (product requirements, not legal advice)

Sector context that shapes this design [V]: the two largest education-platform breaches on record — PowerSchool (Dec 2024, stolen contractor credentials on a support portal, ~60M student records, follow-on extortion of districts) and Canvas/Instructure (Apr–May 2026, user data exposed, disclosed within a week) — both trace to privileged-access and detection-latency failures, and both made school buyers permanently more suspicious. SchoolOS treats the security posture as a sales asset: the controls below are demonstrable in the first meeting (tenant-isolation proof pack, privileged-access model, audit ledger sample, breach-notification SLA), not revealed under questionnaire.

Controls [D, mapped to frameworks in `05` §7]:

1. **Data classification:** PII-C (child PII), PII-S (sensitive: health, safeguarding, disciplinary), FIN, OPS. Classification drives encryption scope, retention, access templates, and AI exposure rules.
2. **Encryption:** TLS 1.2+ everywhere; AES-256 at rest with KMS-managed keys, per-tenant key separation for PII-C/PII-S; field-level encryption for health/safeguarding stores; secrets in a managed vault; no secrets in code or logs.
3. **Access:** least privilege RBAC/ABAC; quarterly recertification; JIT elevation for ops; session hardening; step-up auth for sensitive exports. **No shared maintenance/support backdoors** — a compromised vendor support portal was the root cause of the sector's largest student-data breach (PowerSchool, Dec 2024 [K — verify with current reporting]); all privileged access is per-person, MFA, JIT, session-recorded, tenant-visible, and revocable from a single kill-switch.
4. **Audit:** every read of PII-S and every state change logged; hash-chained ledger; anomaly alarms (bulk exports, off-hours access).
5. **AI boundaries:** tenant-namespace retrieval; per-country model-region pinning (DPDP/UK-GDPR transfer posture); PII redaction middleware before non-resident model calls; no training on tenant data by default (contractual + technical); prompts/outputs logged with redaction, retained per class. Every AI feature ships with an **AI risk-management file** (inputs/outputs logged, human-override points for admissions/grading/placement, model cards) — the conformity-assessment substrate for the EU AI Act's high-risk education provisions applying from 2 Aug 2026 [V].
6. **Lifecycle:** retention per data class from constitution; deletion honored with tombstones; **student data export & account deletion self-serve** for schools (FERPA inspection-rights posture; DPDP erasure); alumni conversion path (student→minimal alumni record at graduation).
7. **Children-specific:** no behavioral advertising or profiling-for-ads ever (hard-banned for children under India DPDP Rules 2025 [V]); no emotion inference (EU AI Act Art. 5(1)(f) [V]); **consent machinery per pack:** India — verifiable parental consent for under-18s with registered Consent Manager integration [V]; US — COPPA school-consent flows plus PPRA notice/consent gating for any survey features [K]; UK/EU — GDPR Art. 8 age-appropriate gates [K]; student AI companion logs are parent-visible on request; crisis-intent handling routes to humans, never auto-responds to self-harm content (defined protocol, trained staff loop).
8. **Application security:** SAST/DAST in CI, dependency scanning, pen test annually + before enterprise deals, secure SDLC with design reviews for any PII-C feature, bug-bounty at scale stage.
9. **Resilience:** PITR (≥15 min RPO), documented RTO (≤4h), restore drills quarterly, backup encryption + separate account, incident response runbook with school-notification SLAs (configurable ≤24–72h per DPA) and a single compromised-credential kill-switch, status page with per-feature AI degraded-mode flags.
10. **Vendor governance:** sub-processor list public and versioned; DPAs with processors; transfer mechanisms documented per zone.

Procurement-aligned artifacts to produce early (they gate deals): SOC 2 Type II path (start controls at v1, audit when ≥10 paying schools), ISO 27001 (UK/enterprise), **VPAT/ACR targeting WCAG 2.2 AA** (WCAG 2.1 AA is the regulatory floor — US ADA Title II requires public-school services to meet it by 2026/2027 by entity size [K]; India RPwD + 2021 ICT Accessibility Standards [K]; watch EU EAA applicability), **pre-signed SDPC National DPA** for the US motion [V], security whitepaper + CAIQ-style questionnaire autofill, DPIA template pack (UK schools expect this posture; UK GDPR Art. 28 processor terms + Children's Code defaults [V]).

---

## 9. Offline-first (scope honesty)

Full offline SaaS is not buildable by a seed team; the design targets **offline-tolerant critical paths** [D]:
- Attendance + basic roster + timetable read: PWA cache + local queue, sync with teacher-wins-within-24h conflict rule (`03` §9).
- Assignment view/submit (files queue and upload later); fee receipts and digests cached.
- Biometric/bus hardware continues writing locally where it already does; SchoolOS ingests on reconnect (integration adapters buffer).
- The campus Wi-Fi/backhaul problem is a deployment consideration (adapter + local sync box is a V2/enterprise item, priced as hardware-assisted deployment — not a core promise).

## 10. Integrations: native vs connected (the boundary)

**Native (build deep):** identity/SSO, Google Workspace & Microsoft 365 (roster sync, calendars, file pick), WhatsApp Business API + SMS/email rails, payment gateways per pack (Razorpay/PayU-class India; Stripe-class US/UK), calendar, audit/export APIs.
**Connected (connector framework, shallow-and-standard):** accounting (Tally/Zoho/QuickBooks/Xero), payroll, GPS/transport trackers, biometric/ID card systems, video conferencing, library systems, content/LMS (Google Classroom/Teams/Toddle/ManageBac via standard exports first, OneRoster/LTI-class later), government/regulatory reporting bodies per country (board portals in India; state reporting = US FUTURE gate).
**Marketplace:** deferred until connector demand proves pull; the connector framework + webhooks + event bus are the actual developer platform (API keys with scopes, webhook signing, sandbox tenant, event replay) — developers integrated *before* a marketplace exists.

## 11. Cost architecture (infrastructure view; unit economics in `05`)

Driver ranking for a 3,000-student school: (1) model inference (dominant, controllable by routing: digests/classification on small models; briefings/ask on frontier only for reasoning steps; batch nightly for bulk), (2) WhatsApp conversation-class pricing (India: service conversations cheap, template/utility conversations metered — digest batching is therefore a design constraint, not just UX taste [K-verify current Meta pricing]), (3) storage (media, AV, backups), (4) warehouse compute (V2), (5) support labor.
Controls: semantic cache, per-tenant AI budgets with constitution-set caps, token budgets per task class, nightly batch windows, storage tiering, digest coalescing. AI cost is metered per tenant — this is what makes usage-based AI pricing honest (`05`).
