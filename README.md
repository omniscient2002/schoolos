# SchoolOS — the AI-native operating system for schools

**India-first, multi-tenant school OS**: one operating loop (Today → Attention → Ask → Action → Memory) over a compact school record, with a constitution-gated AI layer, a plugin registry, and an India-ready integration surface (WhatsApp, UPI, GPS, Tally, CBSE, DPDP).

## Run it

```bash
# 1 — API (Fastify 5 + Postgres, RLS-isolated)
cd server && npm ci && npm run migrate && (npm start &)   # :8080

# 2 — UI (React 19 + Vite)
cd app && npm ci && npx vite build && npx vite preview --port 4310   # :4310

# 3 — the factory quality bar
cd server && node scripts/check.js && npm test   # pre-ship gate + full suite
cd ../app && npx tsc -b                          # frontend typecheck (no frontend tests yet)
```

**Sign in** — every role, one password: `principal@meridian.edu` / `schoolos-demo` (full cheat-sheet on the login card; phone OTP works via the listed numbers; Google SSO runs server-side). Every cold open validates the session against `GET /me` — no stale tokens, no mock brains.

## What is actually built

- **141 routes / 85 screens** (drift-prone counts — the live census is generated: `docs/PERMISSION-MATRIX.md` for doors) — Today, Attention, Ask, Next, People, Learning, Operations, Insights, Automation, Memory, Maintenance family, AI Front Desk, Migration console — all roles (principal, teacher, coordinator, finance, admissions, transport, facilities, technician, IT admin, owner, parent, student).
- **Real authentication** — scrypt + JWT, email/password, phone OTP, Google SSO; every sign-in audited; RLS tenancy isolation on every kernel path.
- **Server-owned dataset** — the demo domain is served by `GET /dataset` (function-stripped, date-revived); the frontend has zero mock modules.
- **Plugin registry** — `GET /plugins`, enable/disable with a drain protocol, capability contracts, event lineage; docs/10–12 define the class model (A–E), trust ladder (T0–T4), and staged marketplace.
- **Governance spine** — append-only audit ledger, action spine (Task/Approval/Case), School Constitution policy engine, AI gateway with budgets and human-approval gates.

## The production factory

Continuous hardening runs as three employees + an orchestrator, communicating through `handoff/` (FROM/TO/STATUS protocol):

| Employee | Lane | Charter |
|---|---|---|
| UI/UX | `app/src/**` | modern + characterful + zero UI/text breaks at 390–1920px; design-system-level fixes only |
| Plugin developer | `server/src/plugins/**` + migrations | prioritized, kernel-decoupled, plug-and-play catalog |
| Red team | read-only → `handoff/` reports | attacks every landed unit (auth, tenancy, UI); findings go back to the owner |

Every cycle ends with `node scripts/factory-check.mjs` green. The orchestrator holds git.

## Documentation

Design + architecture record: [`docs/01` vision](docs/01-vision-and-market.md) · [`docs/02` experience](docs/02-product-experience.md) · [`docs/03` intelligence](docs/03-intelligence-layer.md) · [`docs/04` platform](docs/04-platform-and-security.md) · [`docs/05` business](docs/05-business-and-roadmap.md) · [`docs/06` v2 refinement](docs/06-refinement-v2.md) · [`docs/07` flagships](docs/07-build-flagships-and-demo.md) · [`docs/08` production plan](docs/08-production-build-plan.md) · [`docs/09` red-team audit](docs/09-red-team-audit.md) · [`docs/10`–`12` plugin platform](docs/10-plugin-architecture.md).
