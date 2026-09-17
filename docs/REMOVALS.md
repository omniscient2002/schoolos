# Simplification log — what was removed and why

This records deliberate removals of features/code that were **over-complicating the project** without
earning their keep. The rule applied: *a surface stays only if a real user does a real task with it,
end-to-end.* Everything removed here was either unreachable, fabricated, or a parallel copy of something
real.

Each entry: **what**, **why**, **how verified**. Verification for the batch: `app` `tsc -b` (strict) clean,
`vitest` 5/5, production build clean; server `frontend-grants`, `parity-gate`, `test-hygiene` green.

---

## Batch 1 — 2026-09-17

### 1. The "Living Register" character layer — `app/src/styles/character.css`
- **Removed:** the whole file (stamp physics, ripples, breathing AI orb, roll-call stagger, marigold thread,
  card spine, sparkles) and its `@import` in `index.css`.
- **Why:** it was a second, conflicting design layer on top of `components.css`, and a previous pass had
  already neutralised most of its animations in `polish.css` (the calm brief). Keeping a file whose effects
  are all overridden is pure conflict surface and confuses anyone styling the app.
- **Still works:** `components/motion.tsx` (Reveal) is independent and stays; the tokens it referenced are
  in `tokens.css`.

### 2. The parallel demo app — 5 route screens + wiring
- **Removed files:** `screens/Demo.tsx`, `screens/DemoDay.tsx`, `screens/DemoParent.tsx`,
  `screens/DemoSummary.tsx`, `screens/LiveMode.tsx`.
- **Removed wiring:** `App.tsx` `DEMO_BUILD` const, the five lazy screen imports, the five `/demo*` + `/live`
  routes, and the whole `DEMO_BUILD` staff-route redirect block in `Guard`.
- **Why:** a second product (scripted day, parent demo, summary, live mode) lived inside the app and forced
  `DEMO_MODE`/`DEMO_BUILD` branches through real screens, chrome and the router. It is a sales tool, not a
  school feature, and it doubled the surface area of the frontend.
- **Effect:** production builds were already tree-shaking these; now the code is simply gone.

### 3. The demo role switcher — `Shell.tsx` ProfileMenu
- **Removed:** the "Switch demo role" persona list and its `demoAccounts`/`setRole` wiring in the account menu.
- **Why:** it was the **second role source** that leaked into real permission checks (`session.roleId` vs the
  authenticated `live.role`) — a known defect class (FEX-4/FEX-7). The authenticated role is now the only one
  used for chrome.

### 4. `DEMO_MODE` hard-disabled — `app/src/lib/demoMode.ts`
- **Changed:** `DEMO_MODE` from `import.meta.env.VITE_DEMO_MODE === '1'` to the constant `false`.
- **Why:** neutralises every remaining in-screen `DEMO_MODE ? <Demo…> : <Live…>` branch so only the live path
  runs, without a risky per-screen rewrite in the same batch. The fixture guards (`isLoadedPerson`,
  `isLoadedStudent`) are kept — they render honest empty states when the server dataset omits a fixture.
- **Note:** this makes the in-file `Demo…` components unreachable dead code — see Deferred.

---

## Deferred to the next batch (identified, not yet removed)

These are the same class of problem and are queued; they need per-file edits + a full verification run.

| Item | Where | Why it's over-complicating |
|---|---|---|
| In-screen `Demo…` components (now dead) | ~15 screens with `DEMO_MODE ? <DemoX/> : <LiveX/>` | Dead branches and duplicate UI; delete the `DemoX` half and the flag. |
| Mock AI | `screens/Ask.tsx`, `components/AiDock.tsx`, `demo/seedServices.ts` `aiService` | Fabricated answers behind a real-looking Ask. Wire one cited door or remove the surfaces. |
| IT-Admin fake surfaces | `screens/ItAdmin.tsx` `SESSION_ROWS`, `CONTROL_PLANE`, `FLAGS` | Synthetic sessions and a "platform activity log" that no runtime produces. |
| Plugin long tail | `coord.view`, `ops.bi`, `ops.udise`, `ops.import`, `health.clinic`, `teacher.copilot`, `parent.assistant`, `accounting.tally`, `pack.cbse` | No reachable flow; freeze (stop building, remove nav) until a school asks. |
| Student doors with no UI | mistakes, flashcards, tasks, results, homework, library loans, wellbeing submit | Wire the valuable ones or hide the rest — a door with no screen is maintained for nobody. |
| `?plugins=` URL override | `plugins/useKernel.tsx` | Demo affordance that bypasses the server registry. |
| Parity allowlist drift | `scripts/parity-gate.js` | 61 allowlisted vs 83 wired — shrink by removing dormant doors, not by growing the list. |
| `demo/loops.ts` | `demo/loops.ts` (still imported by `Migration.tsx`) | Delete once Migration's demo branch is dropped. |
| `teacherFixtures` fallback | `services/teacherFixtures.ts` | "Show fixtures when the door is absent" is the honesty anti-pattern; render empty states. |

---

## Not touched (looks heavy, but is load-bearing — do not remove)
- RLS + forced policies, tenant-aligned FKs, hash-chained audit.
- Migrations with checksums + the repair migrations.
- The test gates (`test-hygiene`, `rls-boundary`, `permission-matrix`, `plugin-conformance`, parity).
- Backup/offsite/PITR + restore drill, and the outbox/retention/comms/webhook/workflow workers.
- The DPDP pack (consent/SAR/erasure-replay).

---

## Batch 2 (partial) — 2026-09-17

### 5. `?plugins=` URL override — removed
- **Removed:** `urlOverride()` and all its call sites in `app/src/plugins/useKernel.tsx`.
- **Why:** a demo affordance that let a URL bypass the server plugin registry and force local enablement —
  exactly the "client invents state" pattern the kernel exists to prevent.

### 6. IT-Admin fabricated surfaces — removed
- **Removed from `screens/ItAdmin.tsx`:** `SESSION_ROWS`/`DEVICES` (synthetic staff sessions with generated
  `lastActive`/device/status), `CONTROL_PLANE` (a fabricated "platform activity log" with fake change dates),
  `FLAGS`/`FLAG_DEFAULTS` and the non-functional "Feature switches" section. The "Active sessions" stat that
  read the synthetic rows is gone; the screen keeps only real metrics, honest read-only integration scope, and
  residency copy.
- **Why:** all three rendered measured-looking data (or controls) that no runtime produced — the exact
  fabrication class the project bans. Removed rather than labelled, because a control with no door is not a
  feature.

**Verification (batch 1 + 2 partial):** app `tsc -b` strict clean, `vitest` 5/5, production build clean;
server `frontend-grants`, `parity-gate --enforce`, `test-hygiene` 18/18.

---

## Batch 3 — 2026-09-17

### 7. In-screen `Demo…` components — removed across every screen
- **Removed:** the dead `DEMO_MODE ? <DemoX/> : <LiveX/>` half in ~30 screens, including the maintenance
  cluster (`Assets`, `AssetDetail`, `Maintenance`, `MaintIntelligence`, `MaintInventory`, `MaintVendors`,
  `MaintMap`, `WorkOrderDetail`, `WorkOrders`, `Preventive`, `Inspections`, `TechnicianWorkspace`,
  `Migration`), the parent/student plane (`ParentHome`, `ParentFees`, `ParentChat`, `ParentAsk`,
  `StudentHome`, `StudentAsk`, `StudentLearning`), and the inline branches in `People`, `Attention`, `Audit`,
  `Fees`, `PersonDetail`, `Reports`, `Login`, `Attendance`, `ReportIssue`, `finance/FeePlans`,
  `teacher/ExamMarks`. Each default export now renders its live component directly.
- **Why:** `DEMO_MODE` is hard-`false`, so the demo halves were unreachable code plus a second import/UI
  surface per screen. They also hid the fact that several live paths were honest empty states.
- **Effect:** with every branch gone the flag has no consumer, so `lib/demoMode.ts` itself was deleted
  (the `DEMO_MODE` constant and the now-unused `isLoadedPerson` / `isLoadedStudent` fixture guards). No
  module imports `DEMO_MODE` any more.

### 8. Mock AI — `Ask`, `AiDock`, `aiService`, `PersonDetail` briefing
- **Deleted files:** `screens/Ask.tsx`, `components/AiDock.tsx`. `screens/ParentAsk.tsx` and
  `screens/StudentAsk.tsx` (demo-walkthrough placeholders with no live answer engine) were deleted with their
  routes.
- **Removed from `demo/seedServices.ts`:** `aiService`, `maintenanceAsk`, the fabricated trace builders and
  the maintenance "Ask" router. The file keeps only the fixture services a live screen actually uses.
- **`PersonDetail.tsx`:** the `useBriefing` hook and the fabricated briefing branch are gone; the Student 360
  card states plainly that no briefing layer is connected and shows only the real evidence chain. The two
  "Ask about this…" buttons (pointing at the deleted `/ask`) were removed.
- **Wiring:** `App.tsx` (AiDock mount, `/ask` + `/parent/ask` + `/student/ask` routes and lazy imports),
  `Shell.tsx` (ten staff `Ask` nav entries, the AI palette item, the topbar Ask drawer button and its
  `schoolos:ask-toggle` listener, `demoAccounts` chrome identity), `DemoBar.tsx` (staff/student Ask tabs),
  `Insights.tsx` (the hand-off-to-Ask search box), `server/src/effective-access.js` (the removed surfaces'
  `/ask`, `/parent/ask`, `/student/ask`, `/demo*`, `/live` mappings).
- **Why:** the surface fabricated answers, evidence chains, approvals and "audit" entries client-side with no
  server door behind any of it — the honesty anti-pattern. Generic staff Ask had no grounded door to wire
  (the real assistants are per-role: `/parent/copilot`, `/teacher/brief`, `/coord/copilot-lite`).

### 9. Demo nav entries and scripted engine
- **Removed:** every `/demo` + `/live` nav item (routes no longer exist), the `DEMO_MODE` nav filter, and
  `demo/loops.ts` (its last importer, `Migration.tsx`'s demo branch, was deleted in Batch 3 item 7).

### 10. Broken student task toggle — fixed, not hidden
- **Fixed:** `services/studentApi.ts` `toggleTask` posted to `/student/tasks/:id/toggle`, a sub-path that
  never existed server-side. It now rides the real `POST /student/tasks` door with `{ id, done }`
  (`plugins/student.world/index.js:372`). The student home tutor tile that pointed at the deleted
  `/student/ask` was removed.

### 11. Settings "Roles & access" demo roster — replaced with real roles
- **Removed from `screens/Settings.tsx`:** the 12 fictional Meridian demo accounts (`demoAccounts`) and the
  fake per-account "Manage" button. The `demoAccounts` export was also deleted from `state/store.tsx`; the
  store's `actorName` now comes only from the live `/me` identity (`sessionIdentity`), falling back to
  `'Unknown account'` rather than a demo persona.
- **Replaced with:** a "Built-in roles" card (the product's real roles from `lib/roles.ts` with plain-language
  purposes) beside a "Custom roles" card fed by the real `GET /roles` door — label, built-in base role,
  granted/refused mask counts and member count, with honest loading/error/empty states and a Manage link to
  `/roles` for owner/IT-admin.

### 12. `teacherFixtures` fixture fallback — removed
- **Removed:** `services/teacherFixtures.ts` shrank **1547 → 813 lines**. Every per-door fixture builder and
  the whole fixture dataset (home, brief, homework, submissions, leave, duty/workload, announcements,
  messages, PTM, concerns, mastery, progress story, curriculum, analytics, interventions) are gone. The
  file now contains only the frozen contract types and the live transport.
- **Behaviour:** a door that is absent (404 / not-found) — or a build with `LIVE_API` off — now throws a
  clear `"This teacher door is not connected yet."`; the screens' real loading/empty/error states render.
  The "proven live this session" latch is unchanged, and a live-but-failing door still surfaces its real
  error. `rosterFor` returns `[]` rather than a fabricated roster; `sourceOf` is always `'live'`. The
  `FixtureTag` "Demo data" badge (no longer reachable) was deleted from `teacher/teacherKit.tsx`.
- **Why:** `/teacher/home` does not exist server-side, so the fallback meant `TeacherHome` always rendered
  seed-derived sample data to a real tenant. See the honesty law: a door with no data must say so.
- **Consumers updated:** `TeacherHome.tsx` and `teacher/{Homework,SubmissionsInbox,MyLeave,MasteryMap,
  ProgressStory,CurriculumProgress,DutyWorkload,InsightsShared}.tsx`.

**Verification (batch 3):** app `tsc -b --force` clean, `vitest` 5/5, `vite build` clean, `oxlint` warnings
only (all pre-existing).

---

## Still deferred (identified; need a dedicated verified pass)

| Item | Where | Why it is not in this batch |
|---|---|---|
| Plugin long tail freeze | `coord.view`, `ops.bi`, `ops.udise`, `ops.import`, `health.clinic`, `teacher.copilot`, `parent.assistant`, `accounting.tally`, `pack.cbse` | Audit found **no nav surface to remove** for most of these (they already have no UI or are role/route-gated), and the server plugins + tests are load-bearing. Freezing them is a product stance, not a code deletion. |
| Student server doors with no UI | mistakes, flashcards, tasks create, results, homework, wellbeing submit | The doors are covered by `student-world` tests and hidden behind the parity allowlist's `/student/` blanket. Removing them means editing the allowlist **and** the tests — a server change that needs the full CI-posture run, not a frontend pass. |
| Parity allowlist shrink | `scripts/parity-gate.js` | Depends on the row above; shrink by deleting dormant doors, never by growing the list. |
| Unrouted screens | `screens/Library.tsx` + `components/Flow.tsx`, `ops.bi`'s `Reports.tsx`, unrouted teacher mastery/curriculum screens | Reachable from no route. Deleting them is a separate, mechanical pass (they no longer depend on fixtures). |
