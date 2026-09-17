# SchoolOS — Frontend

The frontend of **SchoolOS**, the intelligent operating system for schools. It runs against the real
Fastify + Postgres backend (`server/`); `app/src/services/*.ts` call the live API (`VITE_API_BASE`, default
`http://127.0.0.1:8080`). A deterministic demo dataset still backs screens that have no live door yet, but
the app is **not** a backend-less demo.

> **Counts in this file are illustrative, not authoritative** (item 34: a hand-typed count is true once and
> then decays). The measured numbers live in generated artifacts — route/guard counts in
> `docs/PERMISSION-MATRIX.md`, test counts in `docs/VERIFICATION.md`, role count in `server/src/auth.js`
> (`ROLES`). The former headline "61 screens · 63 route paths · 10 roles · no backend connected" contradicted
> itself (line 86 said 56 screens) and the role count was wrong (the kernel defines **13** roles).

**Historical note:** the plugin layer is real — the registry (`GET /plugins`) drives nav, routes and slot
reservations from the server; see `docs/10-plugin-platform-v1.md`.

---

## Run it

```bash
cd app
npm install          # once
npm run dev          # http://localhost:5173
# or production build:
npm run build && npm run preview
```

---

> **Demo removed (2026-09-17):** the parallel demo app (`/demo*`, `/live`, the scripted day in `demo/loops.ts`, the mock AI Ask panel) has been deleted. `DEMO_MODE` is hard-`false`; only the live product runs. See `docs/REMOVALS.md`.

## Verify

```bash
export npm_config_cache=/tmp/npm-cache   # required in every shell here
npx tsc --noEmit -p tsconfig.app.json    # must print nothing
npx vite build                           # production bundle
```

## The 60-second tour

1. **Land on Today as the Principal.** The Morning Briefing is banded: **NEEDS YOU → CHANGED OVERNIGHT → TODAY → WATCH/COMING DUE**. Every claim carries its source, timestamp, and confidence.
2. **Click the top card** (Grade 8-B attendance collapsed to 23%). The evidence chain opens: attendance register → GPS deviation → route roster overlap → parent messages. Every step sourced.
3. **Approve the drafted parent message** in the Action Center. Posture: APPROVAL REQUIRED. Delivery receipts appear. The audit ledger records the decision.
4. **Open Memory.** The decision loop is already closed: *Bus 14 pre-route inspections* — decision → expected outcome → review date.
5. **Switch roles** (avatar menu, top right). The kernel defines **13** roles — owner, principal, coordinator, counselor, finance, admissions, transport, facilities, technician, teacher, itadmin, parent, student — each with permission-accurate navigation, data scope, and AI behavior. (See `server/src/auth.js` `ROLES`; the client mirror is drift-guarded by `server/tests/frontend-grants.test.js`.)
6. **Press ⌘K.** The command palette searches people, records, decisions, and screens.
7. **Bottom demo bar.** Run the four scripted scenarios (start with *Bus 14 breaks down* — a 14-step guided journey), simulate a bus delay, a payment, or an incident; toggle **Simulation Mode** to watch the live event stream.

### The narrative (why the data looks like this)

This morning **Bus 14** (Route 7, Sector 12 bridge) suffered a coolant leak — 38 students, 13-minute delay. That single event ripples through the entire demo:

- **Grade 8-B attendance collapsed** (23% vs 93% ten-day average — 15 of 20 absentees ride Bus 14)
- **Fee collections dipped** to 82.3% (41 of 47 failed payments are Route 7 households)
- **Two WhatsApp complaints** opened a case with a 24h SLA
- **An incident, a decision, and an audit trail** were created — and a **pre-route inspection policy** now protects the next four weeks

Separately: 23 gateway timeouts await settlement-file import (a *data quality* story, not a payment failure), a 12.5% sibling waiver exceeds the 10% policy cap (an *approval* story), and the fire-safety certificate expires in 21 days (an *obligation* story).

---

## What's inside

| Surface | Screens |
|---|---|
| Operating loop | Today (Morning Briefing) · Attention · Next · Ask (evidence-grounded AI) · Action Center |
| Records | People directory · Student 360 · Learning · Attendance mark sheet |
| Operations | Fee Intelligence ("WHAT CHANGED?") · Admissions kanban (drag-drop funnel) · Transport (live map, Bus 14) · Documents · Facilities · HR · Calendar · **Migration console** (the switch from Excel/Tally, with fix queues) |
| Governance | School Constitution (AUTO / APPROVAL REQUIRED / HUMAN-ONLY) · Automation builder (+ NL-to-workflow compiler) · Incidents lifecycle · Case management · Audit ledger · Data Health |
| Intelligence | Insights (question-driven) · School Memory (closed decision loops) · AI Governance · AI Usage & Cost |
| Group | Owner console (cross-campus ask) · IT Admin (health, keys, flags, residency) · Settings |
| Family | Parent home, WhatsApp-style chat, fee center, calm Ask · Student "My Day", Learning, Portfolio |
| **Maintenance & Facilities (flagship, 13 screens)** | Overview · board · work-order lifecycle (8 states + SLA countdowns) · **technician workspace** (copilot + voice-to-fields) · assets (health, QR, replacement evaluation) · preventive plans · inspections · inventory · vendors · facilities map · maintenance intelligence · one-line report flow |
| **AI Front Desk (flagship)** | Grounded call answering (phone/WhatsApp/walk-in) with consent + caller verification · visitor register · gate passes · escalation ladder · intent mix & cost telemetry |

### Signature interactions to try

- **"Why did SchoolOS do this?"** — every AI suggestion carries an expandable trace: trigger, policy, data used, reasoning role, approval status, verification, model & cost.
- **Posture badges** — every action is classified AUTO / APPROVAL REQUIRED / HUMAN-ONLY, enforced by the Constitution screen.
- **Live event stream** — Simulation Mode emits realistic events (attendance marked, payments received, routes delayed) that appear on Today and Attention.
- **Offline simulation** — a persistent queue banner shows how attendance and messages sync when connectivity returns.
- **Multi-campus** — switch campuses (or open the Group overview) as Principal/Owner; scoped roles see the lock.
- **Maintenance sims** (demo bar) — AC repeat failure, elevator entrapment, SLA breach, parts shortage, a front-desk call, a migration dry-run — each visibly mutates the board, Attention, events and the audit ledger.
- **Scenario tour: "The projector that got fixed"** — 10 guided steps from a teacher's one-line report to the closed learning loop.

---

## Architecture

```
src/
  App.tsx              # router, shell, boot gate, sync banner
  components/          # design-system primitives (ui), charts, icons, AI surfaces, shell, demo bar
  screens/             # role-aware screens (lazy-loaded; the count is not stated here because the former "61" and "56" in this file disagreed — enumerate `src/screens/` instead)
  services/index.ts    # THE API BOUNDARY — async services with simulated latency
  mock/seed.ts         # deterministic seeded data (mulberry32 PRNG), narrative anchors
  state/store.tsx      # session + domain state (actions, cases, chat, audit, events)
  styles/              # tokens.css → base.css → components.css (hand-rolled design system)
  types/domain.ts      # the domain contract — future API DTOs
  lib/                 # format (₹, en-IN dates, relative time), rng
```

**Design system**: warm paper background, deep-teal accent, iris AI accent, hairline borders, tabular numerals, calm motion (120/200/320ms, reduced-motion respected). WCAG 2.2 AA: keyboard-complete, focus-visible, aria-labels, semantic tables.

**Swap-ready**: `services/*` are async and typed against `types/domain`. Replacing `feeService.obligations()` with a fetch is a one-file change; no screen code edits.
