# 08 — Production Build Plan (v3 demo → revenue-generating product)

**Scope:** turn the built demo (56 screens, deterministic mock layer) into a multi-tenant, production-deployed SchoolOS — the "intelligent operating system for schools" — in 5 phases over ~40 weeks, then the V1.5/V2 expansion. This plan inherits the architecture decisions of `docs/04`, the v2.0 primitive set of `docs/06`, and the shipped v3 flagships of `docs/07`. Every phase ends with a hard **Definition of Done** and a **go/no-go gate**.

Label reminders: **[V]** already verified in the build · **[D]** decision to make now · **[B]** build item.

---

## 0. Ground rules the plan must not violate

1. **Deterministic-first AI.** Rules where rules work; models where language is needed; every model claim carries evidence + trace (`EvidenceChain`/`AiTraceCard` contracts are already the UI standard — the backend must feed them real provenance). [V]
2. **The action spine.** Every mutation flows: intake → record → event → (rank) → action (AUTO/APPROVAL/HUMAN-ONLY) → audit ledger. No feature bypasses it. [V]
3. **Capture at source, compute everything else.** The intake channels (taps, one-line text, voice, photo, QR, bulk import, documents, integrations, derived) are the only doors; analytics are never entered. [V]
4. **Offline-tolerant critical paths.** Attendance, technician jobs, registers queue on-device and reconcile. [B]
5. **Honest gaps stay visible.** The demo's "honest gaps" section becomes the Phase-3/4 backlog — not marketing copy.

---

## 1. Phase 0 — Foundation (Weeks 1–4)

**Goal:** a deployable skeleton: CI/CD, tenancy, auth, observability, and the contract layer that lets the existing frontend keep working **unchanged** (its `services/index.ts` boundary was designed for exactly this swap). [V]

### 1.1 Decisions to lock in week 1 [D]

| Decision | Choice | Rationale |
|---|---|---|
| Backend style | **Modular monolith** (NestJS or Fastify+Zod), service-ready seams | docs/04 §1; team ≤ 8 engineers through Phase 4; split later only at proven seams |
| Database | **PostgreSQL 16 + RLS** (row-level security, `tenant_id` on every table) | multi-tenant isolation without schema-per-tenant ops cost; Supabase-eligible but self-hosted-first |
| Cache/queue | Redis (cache + BullMQ jobs) | SLA tickers, digests, webhook ingestion, report rendering |
| Event spine | Transactional **outbox** → Postgres `events` table → in-process consumers; Kafka NOT until >50 schools | the `LiveEvent`/audit shapes in `types/domain.ts` are already event-first [V] |
| File storage | S3-compatible (S3 or Cloudflare R2), private buckets, signed URLs | invoices, photos, recordings, documents |
| Frontend | Keep the existing Vite app; add a thin API client (`src/lib/api.ts`) implementing the same function signatures as `services/index.ts` | screens don't change; mock layer stays for demo mode [V] |
| Mobile | **PWA first** (technician workspace + teacher register), native wrapper only in Phase 4 if push/background-sync demands | 80% of the value at 20% of the cost |
| Telephony/voice | Exotel (India DID + recording) → Deepgram/Google STT (hi/en/Hinglish) → template+LLM responder | India-first DID pricing; Bhashini ASR as cost fallback |
| Payments | Razorpay (primary) + Cashfree (secondary), settlement-file import from day 1 | the Route 7 reconciliation story becomes a real feature [V] |
| WhatsApp | WhatsApp Cloud API, template library locked per tenant | Communication Orchestrator rails [V] |
| Hosting | ap-south-1 (Mumbai); Cloudflare edge; DPDP data-residency note in ToS | latency + residency |

### 1.2 Build items

- **[B] Repo & environments.** Monorepo: `apps/web` (existing frontend), `apps/api`, `packages/shared` (move `types/domain.ts` here verbatim — it is the DTO contract [V]), `packages/db` (Drizzle/Prisma schema + migrations), `infra/` (Terraform: VPC, RDS, Redis, S3, ECS/Fly.io), `.github/workflows` (lint → tsc → unit → build → deploy-dev).
- **[B] Schema v0.** Translate the domain contract to SQL. Non-negotiable columns everywhere: `tenant_id`, `created_at`, `updated_at`, `created_by`, `deleted_at` (soft delete). Core tables first (see §2.1). RLS policies enforced by a migration test (attempt cross-tenant read in CI — must fail).
- **[B] Auth.** Staff: Google Workspace OAuth + role claim. Parents/teachers-on-mobile: phone OTP (MSG91/Gupshup). Session: httpOnly cookie + CSRF. Roles mirror the 12 demo RoleIds exactly [V]; permission matrix lives in `packages/shared/rbac.ts` as data (the demo's `permissionError` map is the seed of it [V]).
- **[B] Audit ledger service.** Append-only `audit_log` (no UPDATE grant), actor/role/record/reason/policy/outcome — the demo reducer's audit entries are the spec [V]. Expose `/audit` pagination API.
- **[B] Observability.** OpenTelemetry → Grafana Cloud (traces/logs/metrics), Sentry (frontend+api), uptime checks on `/health`, `/health/deep` (DB+queue+webhooks). SLOs: API p95 < 400ms, webhook ingestion p95 < 2s, uptime 99.5% (Phase 0→1), 99.9% from GA.
- **[B] Seed parity harness.** The demo's `mock/seed.ts` corpus (1,472 students, 30d attendance, Bus 14 ripple, Route 7 cluster…) becomes a **fixture generator** for the API — integration tests replay demo narratives against real endpoints and assert identical rankings/answers. This is the single highest-leverage test asset; it converts the demo's coherence into a regression suite. [B]
- **[B] Feature flags + Control Plane tables.** `flags`, `ai_capabilities`, `policy_versions`, `integration_scopes` — the ItAdmin registry table becomes real [V], changes emit `control_plane.changed`.

**DoD Phase 0:** `make dev` boots web+api+db locally seeded from the parity fixture; auth works for 3 roles; audit entries append; CI green including RLS test; staging deployed on every merge.

**Gate 0:** security review of auth/tenancy; demo frontend running against real API for `/today` and `/audit` read paths.

---

## 2. Phase 1 — Record Spine + Migration Engine (Weeks 5–10)

**Goal:** the School Graph in Postgres, and the **switching product** working for real — the #1 sales asset. [D: priority over features, per docs/05 §2]

### 2.1 Core schema (order of implementation)

1. `people` (students/staff/guardians as roles over persons) → `sections` → `enrollments` → `guardian_links`
2. `fee_structures` → `fee_obligations` → `payments` → `receipts`
3. `routes` → `buses` → `stops` → `rider_links` (+ `permit_capacity` enforcement — the demo's "permit wins" rule [V])
4. `assets` → `asset_events` (failures, services, meter readings) → `maint_plans`
5. `calendar_events`, `obligations` (category, leadTime, owner, status — the v2.0 engine [V])
6. `documents` (S3 pointer + extracted metadata), `vendors`, `inventory_items`
7. `cases` (CaseKind incl. transport/exception [V]), `incidents`, `actions`, `notifications`

### 2.2 Migration engine v1 (the flagship of this phase)

The demo console showed Meridian's *completed* onboarding; now build the live importer behind it. [B]

- **Sources:** Excel/XLSX + CSV (master sheets), Tally XML/export, bank statement PDFs (CAMT/MT940 or bank-specific), WhatsApp chat exports (transport logs), AMC/invoice PDFs (OCR via Textract/GCV with human-confirm).
- **Pipeline:** upload → column-mapping (learned per tenant, editable — the demo's "field confidence" [V]) → **dry-run into sandbox** → fix-queue (each flag: row, field, problem, **proposed fix**, accept/edit/dismiss — exactly the demo's UI [V]) → verification report (row counts, sum checks, the "trust receipt" [V]) → cutover (evening swap; old system stays read-only alongside 30 days) → post-cutover reconciliation.
- **Rules from the demo, now enforced in code:** never overwrite; dual-entry notes for merger windows; permit-capacity conflicts resolve to the stricter value; duplicate-guardian merge preserves both roles + contact trail [V].
- **[B] Bulk grid API** behind DataHealth's paste-validate-preview-apply grid (demo already built the interaction [V]); each applied batch = one audit entry + 30-min undo window.
- **[B] Data Health worker:** nightly recomputation of health issues (duplicates, missing emergency contacts, mismatches, expiries) → issues table → DataHealth screen + Attention. Health-gated AUTO actions (docs/06 §4.1): workflows on records below threshold downgrade AUTO→APPROVAL.

**DoD Phase 1:** one pilot school migrated end-to-end from real Excel+Tally+PDFs; trust receipt matches bank to the rupee; DataHealth live; bulk grid shipping real writes.

**Gate 1:** migration of a second school in < 5 school-days with < 2% manual flags (KPI: docs/05 §11).

---

## 3. Phase 2 — The Operating Loop, Live (Weeks 11–16)

**Goal:** Today/Attention/Action Center/Automation run on real data with real execution (messages, assignments, escalations) — the loop stops being a simulation.

### 3.1 Build items

- **[B] Ranking service.** Attention/Today ranking deterministic and versioned (priority rank + SLA pressure + impact — the demo's documented ordering [V]); ranking params live in the Control Plane; every rank emits `ranked_at` + inputs hash so "why is this above that?" is answerable.
- **[B] Action execution engine.** `actions` table with posture (AUTO/APPROVAL/HUMAN-ONLY), executor per action type (send_whatsapp, create_wo, assign_case, schedule_callback, export_pack). APPROVAL executes after principal tap (existing UI contract [V]) with idempotency keys; every execution → audit + receipts.
- **[B] Communication Orchestrator** (the v2.0 primitive, closes demo gap #10): audience resolution (guardian links, role filters) → Constitution filter (quiet hours 21:00–07:00, frequency caps, opt-outs) → dedup/coalesce key → channel fallback (WhatsApp → SMS → voice drop for emergencies) → delivery receipts → reply classification (intent + sentiment → route to cases/desk). Templates locked per tenant; all sends logged in `comm_log`.
- **[B] SLA engine.** Generic: policy table per domain (maintenance SLA_POLICY exists [V]; case KIND_SLA exists [V]) → `sla_clocks` with response/resolve deadlines → tick worker (Redis delayed jobs) → warnings at 50/80% → breach → escalation ladder + Attention. Demo countdown pills get real timestamps.
- **[B] Workflow engine.** The 6 seeded workflows [V] become real: trigger (event/condition) → guard (health-gate, policy) → steps (task/action/approval) → outcome + verification. NL-to-workflow compiler stays HUMAN-ONLY (draft only) — as demoed.
- **[B] Ask — grounded retrieval.** Postgres full-text + pgvector over: records, comm_log, audit, documents (chunked). Answer assembly = the existing branch structure (maintenanceAsk pattern [V]) ported server-side: deterministic routers per intent, template answers with **live record substitution**, every claim → record link. LLM only for query rewriting + the "weird sentence" fallback, always with retrieval-grounded prompting + no-student-data-to-unverified rules. The `AiTraceCard` fields (data used, role, verification, model, cost) become API metadata — not decoration.
- **[B] AI Gateway.** One egress: provider routing (fast model for classify/route, strong model for long-form, local/Bhashini for cheap ASR), per-tenant quotas, PII redaction middleware, prompt-injection shields on document/WhatsApp content, full prompt+response logging with retention policy, evaluation harness (golden Q/A set from the seed narratives — regression gate for prompt changes).

**DoD Phase 2:** a coordinator runs a real morning from Today: approve 3 actions (messages actually deliver with receipts), one SLA escalation fires, one workflow runs AUTO, one Ask question answers with live citations; all of it in the audit ledger.

**Gate 2:** internal "red team day" — attempts at data leakage via Ask/comm, cross-tenant probes, SLA tampering; findings closed.

---

## 4. Phase 3 — Flagships to Production (Weeks 17–26)

### 4.1 Maintenance & Facilities [V→B]

- **[B] WO lifecycle API:** the 8-state `WO_FLOW` as a state machine (guarded transitions, who-may-move-what per role) + SLA clocks + escalation ladder + vendor handoff.
- **[B] Report intake service:** the extraction engine (room regex, asset word-match, category/safety rules, confidence) ported from `createFromReport` [V], plus LLM assist only for sentences the rules score < 0.6; low-confidence files as general-facilities (never lost).
- **[B] Technician PWA (offline-first):** job queue cached locally; accept/en-route/on-site taps work offline (queued, timestamped on-device — honest timestamps flagged as such); voice completion via on-device ASR with transcript-beside-parsed-fields (the demo's honesty rule [V]); photo upload resumes; inventory decrement idempotent.
- **[B] QR system:** printable tag sheets per asset (QRPattern already renders them [V]) + scan-to-report deep links + annual scan-audit mode.
- **[B] Replacement & health service:** `replacementView` rule set [V] as a versioned policy with a quarterly recompute job; asset health derivation job; spend analytics materialized views.
- **[B] Preventive engine:** plans → generated inspections (calendar) → inspection app (checklist, pass/fail, follow-up WO in one tap) → compliance reporting.

### 4.2 AI Front Desk [V→B]

- **[B] Telephony:** Exotel DID per campus → ring 15s → AI answer (the demo's threshold [V]) → barge-in capable ASR stream → intent router (the 9 intents [V]) → grounded responder.
- **[B] Caller verification:** phone-number match against guardian/staff records before any student data; unverified callers get public info + callback booking only (Front Desk §1.1 as code).
- **[B] Handoff service:** live transfer to front-office with whisper summary + screen-pop (caller history, linked records, sentiment — the demo's handoff card [V]); callback queue with SLA.
- **[B] Emergency interrupt:** keyword/intent classifier (safety, medical, injury) → immediate human bridge + duty principal + nurse ring; tested weekly (drill script included in ops runbook).
- **[B] Recording & consent:** consent line + opt-out honored per call; recordings encrypted at rest, 90-day retention (configurable), DPDP notice text in tenant config.
- **[B] Visitor & gate-pass module:** pre-registration links, badge printing, host-SMS, gate pass with guardian-WhatsApp-before-departure (Safeguarding §2.1 [V]).

### 4.3 Safeguarding net [B] (small, trust-critical)

Bus RFID/QR scan → "reached school" parent notification; absent-without-notice by 09:15 → auto-reminder → coordinator escalation. Built on the intake channels that already exist.

**DoD Phase 3:** technician completes a job on a dead-zone basement and syncs; a parent calls the DID in Hindi about a bus and gets the tracking link; a hazard call hands off live with summary; a QR scan files a report with the asset attached.

**Gate 3:** voice quality eval ≥ 90% intent accuracy on a 200-call hi/en test set; offline sync chaos-tested; pen-test round 1.

---

## 5. Phase 4 — Money, Compliance, Hardening (Weeks 27–32)

- **[B] Payments (collect, not just reconcile):** payment links from fee obligations, UPI mandates for term fees, instant receipts (WhatsApp+PDF), refund flows, partial-payment ledger (Route 7 story becomes real).
- **[B] Continuous reconciliation:** settlement-file import → auto-match → exceptions queue; Tally sync (read+write vouchers); variance report to finance.
- **[B] DPDP Act compliance:** consent registry (guardian consent per purpose), data-subject request workflow (export/erasure with school-approval gate), retention schedule per record class, child-data minimization review on every AI surface, breach-notification runbook.
- **[B] Security hardening:** rate limits, WAF, secrets rotation, least-privilege DB roles, break-glass access model (docs Round G [V] → code: time-boxed, dual-approved, fully audited), backup/restore drills (weekly automated, monthly restore test), pen test remediation.
- **[B] Ops runbooks:** on-call rota, incident severity ladder (the emergency-ladder pattern applied to ourselves), school-hours super-uptime mode (freeze deploys 07:00–16:30), status page.
- **[B] Billing & licensing:** per-school pricing (docs/05 §1 architecture), seat/AI-quota metering (AI Gateway already meters [B]), invoice + dunning.

**DoD Phase 4:** money in → receipt out → ledger reconciled, on real tenants; DPDP checklist signed by counsel; restore drill passes; billing live.

**Gate 4:** GA readiness review (security, support load, cost-per-tenant vs pricing floor — the docs' thin-margin honesty check [V]).

---

## 6. Phase 5 — Pilot → GA (Weeks 33–40)

- **[B] Pilot cohort:** 5–8 schools (1 multi-campus group) on paid pilots; weekly migration sprints (target: ≤ 5 school-days each); success KPIs from docs/05 §11 (principal time-on-briefing < 10 min, missed-call rate < 5%, collection +N pts, technician first-time-fix ≥ 90%).
- **[B] Support model:** in-app support with context (the audit trail *is* the support ticket), WhatsApp support line answered by our own desk product (dogfooding), school-hours SLAs.
- **[B] GA launch:** pricing page, self-serve onboarding for single-campus, migration-as-product sales kit (the console + trust receipt as the demo), case studies from pilots.
- **[B] Outcome telemetry:** the docs' outcome meter — did the drafted message actually recover payments? did preventive plans cut failures? feeds Memory expected-vs-actual [V] and the sales narrative.

**Gate 5 / GA:** 3 schools live > 30 days with data; NPS ≥ 40 among principals; cost-to-serve within pricing model; zero P1 incidents in the last 4 weeks.

---

## 7. V1.5 → V2 (post-GA, quarter-sized chunks)

Priority-ordered, each still on the same loop:

1. **Timetable engine** — constraint solver (teacher/room/workload), what-if simulations; the seed timetable becomes ground truth for tests.
2. **Examinations & report cards** — marks entry (bulk grid!), grade policies per board (CBSE/IB packs — the docs' country/board pack architecture), remark drafting (AI drafts, teacher approves).
3. **Front-desk voice v2** — outbound reminder calls, voice for attendance contingency days.
4. **Energy & utilities** — generator runtime, water levels (intake channel 8) feeding asset health + cost analytics.
5. **Substitute/cover orchestration** — absence → free-slot matching → one-tap cover + parent notification for teacher change.
6. **Board/government reporting** — UDISE+/SARAS pack: the obligations engine driving compliance filings with approval gates.
7. **Hostel module** (for boarding tenants) — the loop on rooms/leave-outs/night rolls.
8. **Cafeteria/mid-day meal** — attendance-linked counts, vendor billing.

## 8. Team plan (lean, senior-heavy)

| Phase | Team |
|---|---|
| 0–1 | 1 tech lead (arch), 2 full-stack, 1 product eng (data/migration), 1 designer (part-time), 1 founder/PM |
| 2–3 | +2 full-stack (comms/workflows; voice), 1 QA automation, 1 part-time SRE |
| 4–5 | +1 security/compliance consultant, +1 support engineer (becomes school-hours on-call), +1 full-stack (billing/GA) |
| Steady state (≈10 eng) | squads: Loop (Today/Attention/Ask/Automation) · Ops (maintenance/desk/migration) · Money (fees/recon/billing) · Platform (infra/health/control plane) |

## 9. Risks register (top 8, with mitigations)

| # | Risk | Mitigation |
|---|---|---|
| 1 | Voice quality erodes desk trust | eval harness + weekly call sampling + "say human" escape hatch on every call |
| 2 | Migration surprises at real schools | dry-run-first product; never-overwrite; fix-queue UX; rollback door; timebox ritual |
| 3 | DPDP/child-data incident | consent registry, minimization review, redaction middleware, breach runbook, counsel retainer |
| 4 | Thin margins (docs/05 §1.2 honesty) | AI cost metering per tenant, quota design, COGS dashboard from Phase 2 |
| 5 | WhatsApp policy/template churn | template library per tenant locked via Control Plane; SMS fallback always configured |
| 6 | Offline sync conflicts | CRDT-lite last-writer-wins per field with on-device timestamp flagging; conflict queue UI |
| 7 | Key-person (voice/AI) bus factor | deterministic-first means the system degrades, not dies (docs' degraded-mode requirement [V]) |
| 8 | Scope creep into LMS/HR | the kill list stays killed; integrations over modules (docs/02 §5 [V]) |

## 10. Definition of Done — the whole plan

A school's coordinator migrates in a week and goes live the next morning; the principal's 8:00 briefing is assembled from real records with every claim one click from its source; a parent's Hindi call about a late bus is answered, grounded, and logged in 30 seconds; a broken projector goes from sentence to fixed-and-verified without a single form; the owner can prove every rupee reconciled and every action audited — and the whole thing degrades gracefully when the internet, the AI, or a human is unavailable.

That is SchoolOS in production; the demo was its rehearsal.
