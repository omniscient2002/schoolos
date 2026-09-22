# SchoolOS — Frontend

The frontend of **SchoolOS**, the intelligent operating system for schools. It runs against the real
Fastify + Postgres backend (`server/`); the service modules under `app/src/services/*.ts` call the live
API (`VITE_API_BASE`, default `http://127.0.0.1:8080`). There is **no parallel demo app** — only the live
product runs.

> **Counts in this file are illustrative, not authoritative** (a hand-typed count is true once and then
> decays). The measured numbers live in generated artifacts — route/guard counts in
> `docs/PERMISSION-MATRIX.md`, test counts in `docs/VERIFICATION.md`, the role count in
> `server/src/role-catalog.js` (re-exported by `server/src/auth.js` as `ROLES`).

---

## Run it

```bash
cd app
npm install          # once
npm run dev          # http://localhost:5173  (proxy to the API at :8080)
# or production build:
npm run build && npm run preview
```

## Verify

```bash
npx tsc -b                               # must print nothing
npx vitest run                           # unit/behavioural tests
npx oxlint                               # warnings-only baseline
```

## What's inside

Role-aware screens, all lazy-loaded under `src/screens/` (enumerate the directory rather than trust a
count here). Highlights: Today / Attention / Next / Ask / Action Center; People & Student 360; Learning
and Attendance; Fees; Admissions funnel; Transport; Documents; Facilities & Maintenance (flagship);
Parent and Student lanes; Owner/Principal oversight (board pack, brief, announcements, compliance,
certificates, delegations, appraisals); CoordinatorOS; IT Admin & Settings.

**Authentication.** Email + password, phone OTP, and server-side Google SSO. A cold open validates the
session against `GET /me`; the client keeps the bearer in memory and relies on the same-origin HttpOnly
cookie for durability. The capability payload from `GET /me/effective` is the client's only permission
source (`canSurface` fails closed on an unnamed surface); custom-role masks are honoured server-side.

## Architecture

```
src/
  App.tsx              # router, AuthGate, shell
  components/          # design-system primitives (ui), charts, icons, AI surfaces, Shell
  screens/             # role-aware screens (lazy-loaded)
  services/            # liveApi.ts (the API boundary), parentApi/studentApi/coordApi, teacherFixtures.ts (live wrappers)
  state/store.tsx      # session + client-side workspace state
  styles/              # tokens.css → base.css → components.css (hand-rolled design system)
  types/domain.ts      # the domain contract
  lib/                 # format (₹, en-IN dates, relative time), effective.ts (capabilities), roles.ts
```

**Design system**: warm paper background, deep-teal accent, iris AI accent, hairline borders, tabular
numerals, calm motion (120/200/320ms, reduced-motion respected). WCAG 2.2 AA: keyboard-complete,
focus-visible, aria-labels, semantic tables.

**Honesty.** Screens that render sample data carry a `SampleNote`; the honesty gate
(`src/test/honesty-gate.test.ts`) fails CI if a seed-reading screen is unlabelled.
