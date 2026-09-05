# SchoolOS Learning Path — Master the Whole Project, In and Out

A progressive curriculum in 14 modules. Each module lists: **Read** (files/docs), **Concepts** (what to master), **Do** (hands-on), **Prove it** (self-check). Work top to bottom — later modules depend on earlier ones. Time: ~40 focused hours for full depth; each module is self-contained enough to stop and resume.

Repository map (memorize this first):
```
schoolOS/
├── docs/                  # the constitution: 01–12 + ops/ + red-team/ + research/
├── server/                # production backend (Fastify + Postgres)
│   ├── src/               # app.js · db.js · audit.js · governance.js · routes.js · auth.js · config.js · index.js
│   ├── migrations/        # 001–007 (the data constitution, applied in order)
│   ├── tests/             # api · plugins · governance · security (+ helpers)
│   ├── scripts/           # bootstrap.js · migrate.js · seed.js · reconcile_wo1046.mjs
│   └── logs/              # api.log (runtime evidence)
├── app/                   # frontend (React + TS + Vite)
│   └── src/
│       ├── App.tsx        # route map (63 paths) + role gating
│       ├── components/    # Shell (nav/roles), DemoBar, ui kit, Flow
│       ├── screens/       # 61 role-aware screens
│       ├── plugins/       # THE FRONTEND KERNEL: registry, useKernel, Slot, KernelGate, widgets
│       ├── services/      # liveApi.ts (the real-API client)
│       ├── mock/          # deterministic demo universe (seed.ts)
│       └── state/ demo/   # in-browser state machines, demo scripts
└── logs/ · .qa-relcert2-tmp/  # runtime + certification evidence
```

---

## Module 0 — Orientation: run it, break it, feel it (1–2h)

**Read:** root `README.md` (skim only).
**Do:**
1. Start the stack: `cd server && (setsid node src/index.js > logs/api.log 2>&1 &)`; UI: `cd app && npx vite preview --host 127.0.0.1 --port 4310 --strictPort`. Health: `curl http://127.0.0.1:8080/health`.
2. Log into http://127.0.0.1:4310 as each role: `principal@ / owner@ / teacher@ / parent@ / finance@ / facilities@ / transport@ / technician@ / counselor@ / admissions@` — all password `schoolos-demo`. Note what each role sees and can't.
3. Run the DemoBar loops (bottom bar) — the three golden loops (Transport delay → principal approval → WhatsApp; Maintenance SLA breach; Fee reconciliation).
4. Read `logs/api.log` while clicking — watch requests hit real endpoints.
**Prove it:** You can explain what a parent can see vs a principal, and name the three golden loops.

## Module 1 — Product thesis: what this is and why (3h)

**Read (in order):** `docs/01-vision-and-market.md` (§1–6), `docs/02-product-experience.md` (the operating loop, role command centers), `docs/05-business-and-roadmap.md` (§1.1 pricing, §3 MVP/V1/V2, §10 long-term).
**Concepts:** the loop (compact record → deterministic triggers → approval → execution → memory); "operating system, not ERP modules"; deterministic-first AI; WhatsApp-first for India; the kill list (no LMS, no payroll engine, no social feed) and *why* restraint is the moat; migration-as-product; pricing/unit economics gates.
**Do:** For each of the 3 golden loops, write the loop in one line: *event → policy → action → decision → execution → memory*.
**Prove it:** Explain to a rubber duck why SchoolOS is not "another school ERP" in under 60 seconds, citing architecture, not features.

## Module 2 — Domain model & data constitution (4h)

**Read:** `docs/04-platform-and-security.md` (§4 data model, §6 permissions), then `server/migrations/001_init.sql` top to bottom. Then diffs: `002_plugins.sql`, `003_enterprise_hardening.sql`, `004_event_spine.sql`, `005_grants_refresh.sql`, `006_money_and_ledger_hardening.sql`, `007_capability_contracts.sql`.
**Concepts:** tenants → users → students → guardians; fee structures vs obligations vs payments; assets → work orders → WO lifecycle (`WO_FLOW` in routes.js: reported→assigned→accepted→en-route→on-site→repairing→verification→resolved→closed); events/actions/communications/audit_log; `app.plugins` shape; the event envelope columns; RLS policies on all 25 tables.
**Do:** `psql -h 127.0.0.1 -U schoolos -d schoolos` and: list all tables (`\dt app.*`), show one policy (`\d app.students`), count rows per core table, find the 200%-paid clamp evidence (`SELECT label, amount_cents, paid_cents FROM app.fee_obligations ORDER BY created_at DESC LIMIT 5`).
**Prove it:** Draw the ERD from memory: tenant → users/students/guardians → obligations → payments; students → attendance/fees; assets → work_orders; events → event_action_link → actions.

## Module 3 — Tenancy kernel: RLS, roles, withUser (3h)

**Read:** `server/src/db.js` (whole file — it's short and it's the heart), `server/src/config.js`, RLS policy examples in 001, `docs/04` §tenancy.
**Concepts:** `withUser()` = `BEGIN → set_config('schoolos.tenant_id') → set_config('schoolos.role') → SET LOCAL ROLE schoolos_app → fn → COMMIT`. Claims are tx-scoped session vars; isolation is a property of the transaction, not of WHERE clauses. App role is deliberately crippled (no table ownership, no ledger INSERT). Roles: owner, itadmin, principal, coordinator, teacher, parent, student, finance, facilities, technician, transport, counselor, admissions — where each is checked (`require(...roles)` in routes.js) and where RLS takes over.
**Do:** In psql, run `SET LOCAL ROLE schoolos_app` inside a tx with/without `set_config('schoolos.tenant_id', …)` and watch queries return nothing / the tenant's rows. Try a cross-tenant query as the app role.
**Prove it:** Explain why a stolen JWT for user X still can't read tenant Y — and which layer the red team confirmed held (Track A).

## Module 4 — Auth & identity (2h)

**Read:** `server/src/app.js` (Fastify host: JWT register, `authenticate` decorator, rate limiting, CORS, health), `server/src/auth.js`, `server/src/config.js` (fail-fast secret rule), `server/tests/security.test.js` (Track F test).
**Concepts:** token = pointer, not authority (role/tenant re-read from DB per request); production fail-fast on default JWT_SECRET; rate limiting keyed on socket IP unless `TRUST_PROXY=true` (why: XFF rotation attack, RTR-001 Track F); login limiter 20/min.
**Do:** Forge a token signed with a wrong secret → 401. Fire 21 rapid logins → 429. Rotate `X-Forwarded-For` → still 429 (because trustProxy is off).
**Prove it:** Name the three things `authenticate()` trusts and the one thing it never trusts.

## Module 5 — The event spine (4h)

**Read:** `server/src/audit.js` (`emitEvent`, `linkLineage`, `requestAudit`), migration 004, `server/tests/governance.test.js` (envelope test), the transport route block in `routes.js` (search `transport/events`).
**Concepts:** envelope v2 fields (`emitted_by`, `subject`, `correlation_id`, `causation_id`, `schema_version`, `payload`); events table (queryable) vs outbox (delivery intent, `event_id/attempts/last_error`); `app.event_action_link` as the lineage spine; `GET /events/lineage` resolution; kernel vs `plugin:<id>` provenance.
**Do:** `POST /transport/events {"routeCode":"Route 7","kind":"gps_delay","delayMins":12}` as principal → then `GET /events/lineage?limit=3` and trace event → action → policy ref. Then query `app.event_action_link` directly.
**Prove it:** From one lineage row, recite the full causal story: GPS tick → policy → approval → (execution) → policy ref.

## Module 6 — Actions, approvals & the comms boundary (3h)

**Read:** routes.js `actions` block + `/actions/:id/decide`, `communications` block, `docs/02` (approval surfaces), `docs/12` §8 (AI decision-vs-transformation rule).
**Concepts:** action = a proposed side effect owned by a named authority (`owner_role`, `policy_ref`, `ai_involved`); decision gated by `owner_role` (RT-002 fix) + self-approval forbidden (`payload.proposed_by`); only approval executes side effects (WhatsApp blasts, notifications); comms are template-bound and consent-gated; `idempotency` (double-decide → 409).
**Do:** Raise a transport action as principal, then try to decide it as teacher/parent (403), then as principal (executes). Check the audit row for the decision.
**Prove it:** State the rule: "AI may draft, never decide" — and name the three code places that enforce it.

## Module 7 — Money & the audit ledger (4h)

**Read:** routes.js fees block (payments/confirm), `server/src/audit.js` (`auditLog`), migration 006 (CHECKs, unique index, `audit_append`), `server/tests/security.test.js` (RT-003/004, Track E), `docs/red-team/RTR-001.md` (RT-003/004, Track E) + `docs/red-team/RTR-001-REMEDIATION.md`.
**Concepts:** four money layers (DB CHECK `paid≤amount`, partial unique one-open-payment, `FOR UPDATE` at initiation, staff-only confirm); honest audit labeling (webhook-verified vs manual reconciliation); hash chaining (`prev_hash + stored fields`, advisory-lock serialization); SECURITY DEFINER `audit_append` as sole INSERT path; recomputable hashes; genesis chaining; idempotent confirm (409/`already`).
**Do:** Re-verify a hash in psql: take the newest ledger row, recompute sha256(prev_hash + JSON of stored fields) — match it. Attempt `INSERT INTO app.audit_log` as `schoolos_app` → denied.
**Prove it:** Explain why the ledger is evidence in a dispute, not just a log.

## Module 8 — Governance: budgets, breakers, contracts, drain (4h)

**Read:** `server/src/governance.js` (whole), migration 007 + `app.capability_contracts` rows, drain block in routes.js, `docs/12` §4 (contract spec), §10 (budgets), §12 (drain), `server/tests/governance.test.js` (all four tests).
**Concepts:** budget ladder (kernel-path → BREAKER_OPEN → PAYLOAD_TOO_LARGE → BUDGET_EXHAUSTED); breaker state as persisted jsonb; per-plugin runtime-adjustable budgets; capability contracts (kind, scopes, side_effects, policy_refs, enforced invariants); the 7 registered contracts; drain protocol (open actions → principal desk, `DRAIN: N` audit, `events_retained`).
**Do:** Set `event_budget='{"events_per_min":2}'` on transport in psql, fire 3 transport events, watch 429 → breaker; reset breaker. Read all 7 contract rows.
**Prove it:** Recite the budget ladder in order and explain why a flood degrades one plugin, not the school.

## Module 9 — Plugin architecture (5h)

**Read:** `docs/10-plugin-architecture.md` (all), `docs/11-plugin-native-architecture.md` (target), `app/src/plugins/` — `pluginTypes.ts`, `pluginRegistry.ts` (the 4 manifests), `useKernel.tsx`, `Slot.tsx`, `KernelGate`, `widgets/LibraryOverdue.tsx`, `registerWidgets.ts`, `screens/Plugins.tsx` (the manager), `screens/Library.tsx`.
**Concepts:** manifest anatomy (id/class/permissions/slots/routes/widgets/subscriptions/kernel-compat); classes A–E (A read+act … E third-party); slots as the only aperture (max 2 widgets per slot — enforced); enable/disable lifecycle (frontend kernel flip + `POST /plugins/:id/enable|disable` in live mode); server re-sync on mount; `KernelGate` empty state; Library as the proof plugin (ship-off, full loop); first-party feature-plugins (transport/maintenance) vs the proof plugin; what's NOT built (exams module, third-party onboarding, marketplace).
**Do:** Enable Library as owner in the UI; watch nav/route/widget appear; disable; watch drain. Read the enable/disable audit rows. Trace one Library widget render: manifest → Slot → registerWidget → useKernel.isEnabled.
**Prove it:** Add a do-nothing plugin manifest in a scratch branch and predict exactly what appears/disappears — then verify.

## Module 10 — Frontend architecture (5h)

**Read:** `app/src/App.tsx` (route map, `staffOnly`, lazy loading, redirect), `app/src/components/Shell.tsx` (nav by role, DemoBar wiring), `app/src/components/ui.tsx` + `Flow.tsx` (the design system: Card/Badge/Button/Empty, EventTimeline/VerifyRow), `app/src/state/` (in-browser state machines), `app/src/mock/seed.ts` (the deterministic universe), `app/src/services/liveApi.ts` (BASE, LIVE_API flag, token storage, endpoint functions), 2–3 representative screens (`Attention.tsx`, `WorkOrders.tsx`, `Plugins.tsx`).
**Concepts:** mock vs live split (`VITE_LIVE_API=1` builds; demo loops stay mock by design); role-aware rendering; lazy screens; design-system discipline (why every screen uses the ui kit); the 61 screens / 63 route paths incl. the `/facilities → /maintenance` redirect; deterministic seed (375 students, pinned demo cast).
**Do:** Add a trivial screen using the ui kit, route it behind a role, verify as two roles. Break `mock/seed.ts` determinism (add randomness) and observe why it's forbidden.
**Prove it:** Explain how the same UI runs with either brain (mock/live) and where the seam lives (`services/liveApi.ts`).

## Module 11 — Security engineering: the red team curriculum (4h)

**Read:** `docs/red-team/RTR-001.md` (all 8 sections + PoC appendix — read as a defender), `docs/red-team/RTR-001-REMEDIATION.md`, `server/tests/security.test.js` (every test = a dead attack).
**Concepts:** the 7 attack tracks (A tenant isolation, B authorization/SoD, C money, D concurrency, E ledger integrity, F input/transport, G docs-vs-reality); the kill-chain anatomy (secret leak → uuid harvest → forged token → total compromise) and how each link was cut; accepted risks (CSP absent, WO non-resolve transitions, rotation runbook pending) and where they're documented; W1/W3/W4/W5 dispositions.
**Do:** Re-run one PoC from `server/tests-rt/` against the current build and watch it fail. Add one new negative test for a surface you think is still soft.
**Prove it:** For any endpoint you pick at random, state its auth layer, role gate, tenant layer, audit consequence, and failure mode.

## Module 12 — Quality & certification system (3h)

**Read:** `server/tests/` (all 5 files — api, plugins, governance, security, helpers), `docs/ops/RELEASE-CERT-001.md` + `RELEASE-CERT-002.md` (incl. re-cert addendum), `docs/ops/DOCS-AUDIT-002.md`, `docs/ops/org-roster.md`.
**Concepts:** test architecture (fresh `schoolos_test` per file via helpers → bootstrap → migrate → seed; alphabetical order; ~45s gaps to dodge the login limiter); what each suite owns (api = domain invariants, plugins = registry lifecycle, governance = spine/budget/drain/contracts, security = dead attacks); the verify/fix separation of duties (QA-1 and REDTEAM-1 never fix code); docs claims vs code (DOCS-AUDIT method); the roster protocol (re-task before hire).
**Do:** `cd server && npm test` (expect 25/25). Then deliberately break one invariant (e.g. relax the money CHECK in a scratch migration) and watch the exact test that catches it.
**Prove it:** Map every RTR-001 critical to the test that keeps it dead, from memory.

## Module 13 — Operations (2h)

**Read:** `docs/ops/` certificates, `server/scripts/` (bootstrap, migrate, seed, reconcile), root `README.md` run section.
**Concepts:** process model (setsid background + logs/api.log; kill/start must be separate shells — pkill self-match hazard); DB roles (schoolos owner w/ BYPASSRLS for admin scripts; schoolos_app for requests; postgres superuser for emergencies); port map (API 8080, UI 4310, Postgres 5432, DSH GUI 3081); `/tmp` ephemerality; rate-limit patience between test runs; secrets handling (`.env` never committed; git deliberately not initialized per product owner).
**Do:** Cold-start everything from scratch using only the cheat-sheet in this repo's run docs. Reconcile a poisoned row using `scripts/reconcile_wo1046.mjs` as the template.
**Prove it:** Hand a new engineer a one-page runbook you wrote from memory.

## Module 14 — Business, market & the honest roadmap (3h)

**Read:** `docs/01-vision-and-market.md` (full), `docs/05-business-and-roadmap.md` (§1.1 pricing, §9 risks, §11 success metrics), `docs/research/` (all four standing analyses: India ERP market, global SIS, UK/IB competitive, privacy/DPDP), `docs/08-production-build-plan.md` (5 phases → GA), `docs/12` §16 (tenancy modes), §20–23 (roadmap items).
**Concepts:** why the wedge (fee-ledger trust) beats feature checklists; switching cost as product not services; DPDP/RTE/POCSO map and how tenancy modes A/B/C serve residency; the unit-economics gates; what's deliberately unbuilt (outbox consumers, T0–T4 tiers, marketplace, signed webhooks, CSP, offline PWA, telephony/ASR) and the sequencing logic.
**Do:** Write the one-page investor brief: wedge, moat (loop + migration + contracts), evidence (certificates), next 90 days.
**Prove it:** You can answer "why will this win?" with architecture + economics, no adjectives.

---

## Dependency map

```
0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14
        └────────────┬───────────────┘
     (2–8 are the backend spine; 9–10 the frontend; 11–14 the meta-layers)
```

## The 12 files that carry 80% of the depth

1. `server/src/db.js` — tenancy
2. `server/src/audit.js` — ledger, events, lineage
3. `server/src/governance.js` — budgets & breakers
4. `server/src/app.js` — host, auth, limits
5. `server/src/routes.js` — every domain capability + plugin lifecycle
6. `server/migrations/006_money_and_ledger_hardening.sql` — money law
7. `server/migrations/007_capability_contracts.sql` — contract law
8. `server/tests/security.test.js` — the attacks that must stay dead
9. `server/tests/governance.test.js` — the spine invariants
10. `app/src/plugins/pluginRegistry.ts` — manifest constitution
11. `app/src/plugins/useKernel.tsx` — frontend runtime
12. `docs/12-enterprise-hardening.md` — the target-state constitution
