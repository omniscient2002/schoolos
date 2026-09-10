# SchoolOS — Full Codebase Audit & Improvement Plan

> **Date:** 2026-09-10 · **Method:** 32-agent fan-out audit (API surface map, frontend route map, 6 specialist
> auditors, 18 adversarial skeptic passes) + orchestrator spot-verification. Evidence files: `.audit/api-map.md`,
> `.audit/fe-map.md`, `.audit/data-path.md`, `.audit/dead-controls.md`, `.audit/parity.md`,
> `.audit/server-gaps.md`, `.audit/ux.md`, `.audit/hygiene.md`, `.audit/skeptic-*.md`.
> **Verdict integrity:** ~180 of ~207 findings independently re-verified as confirmed; a handful downgraded or
> scope-corrected; the corrections are reflected below.

---

## 0. Verdict

The **server is genuinely strong**: 204 tested, RLS-isolated, lifecycle-gated doors, atomic audit/outbox ledger,
honest rails design, clean route guards (200 routes, 0 unguarded). The **UI design system is genuinely strong**
(a11y primitives, focus traps, touch targets, honest empties). The defect is the **seam between them**:

1. **The demo→live migration stopped halfway.** `services/liveApi.ts` hard-codes `LIVE_API = true`, but ~24 of
   ~74 staff screens still read/write the **mock brain** (`services/index.ts` mutable stores over `dataset.ts`).
   Their buttons show success toasts while touching nothing that persists.
2. **~63% of server doors (≈129/204) have no reachable UI caller** — the product's own "UI-only law" is broken
   at scale. Nearly every fake write already has a real door waiting (often with an unused wrapper in
   `liveApi.ts`), so most of this is wiring work, not invention.
3. **Several screens actively lie or crash on real (non-demo) tenants** — wrong-tenant demo personas, fabricated
   KPIs/AI answers, fake DPDP/payment/audit claims, and 4 guaranteed crash routes.
4. Genuinely missing server capability: **fee plan/obligation creation, password change, admissions→student
   executor, multi-school picker for SSO/OTP, any scheduler/workflow engine, real message/email rails.**

---

## 1. Critical — broken or lying today, on every real tenant (P0)

| # | Defect | Evidence | User impact |
|---|---|---|---|
| 1 | `SLA_POLICY` is `const`-bound to the pre-hydration dataset → `undefined` forever | `app/src/data/dataset.ts:172` (verified) | **Report-an-issue (ReportIssue.tsx) crashes 100% of the time** on every tenant, demo included — hangs on "Reading the report…" |
| 2 | Empty-world override omits `DEMO_STUDENT`/`DEMO_GUARDIAN`/`DEMO_SECTION_ID`/`FEE_STORY`/`deskSettings` | `server/src/app.js:293-309` (verified: 0 demo keys in override) + `ParentFees.tsx:18` `const CHILD = seed.DEMO_STUDENT` | Real school's parent sees **"Aarav Sharma, Grade 8-B"** with a fee ledger and a Pay button that fabricates a payment + WhatsApp receipt |
| 3 | Teacher landing: `mySection = seed.sections.find(…) ?? find(DEMO_SECTION_ID)!` with empty sections | `app/src/screens/Today.tsx:394` | Teacher role hits the **error boundary every day** on real tenants |
| 4 | `StudentHome.tsx:35` derefs `seed.TERM_DAYS[…].getTime()` on `[]` | routed at `/student`, in student sidebar | Real student's **Home = crash** |
| 5 | Attendance submit is pure theater: `attendanceService.mark` returns `{marked, workflowTriggered:'wf_1'}` mutating nothing | `app/src/services/index.ts:75-77`; real door `POST /attendance/mark` unused | Daily register **silently lost on reload**; "N guardians will be notified" never happens |
| 6 | Fees "Retry" flips `f.status='paid'; f.method='UPI'` in RAM | `services/index.ts:62-66`, `Fees.tsx:208` toast "ledger updates on settlement" | Finance believes a UPI payment was re-initiated; **no gateway, no ledger, no audit** |
| 7 | Ask/AiDock answer from canned Meridian branches with fabricated trace (`model 'Frontier', tokens 1240`) + "Approve → is executing … written to the audit trail" | `services/index.ts:139-225`, `Ask.tsx:64`, `AiDock.tsx:140` | Principal gets confident fiction about a bus route that doesn't exist; approvals evaporate |
| 8 | Audit screen renders the client reducer array while claiming "append-only · hash-chained · verified nightly" | `Audit.tsx:27`, copy :237; `apiAudit`/`GET /audit` never called | The compliance surface is **fiction in both directions** (misses real entries, shows fake ones) |
| 9 | Teacher grading contract mismatch: UI sends `status:'reviewed'` with a grade; server requires `'graded'` | `teacher/SubmissionsInbox.tsx:161` vs `teacher.classroom/index.js:168` | The **primary grading action always fails** on the live lane |
| 10 | Teacher QuickActions FAB: 9 of 15 entries → unrouted paths → NotFound | `components/teacher/QuickActions.tsx:40-53` vs `App.tsx:403-405` | "Take attendance", "Request leave", "Flag a concern" **dead-end at 404** (server doors exist for all three) |
| 11 | ActionCenter approve/dismiss → reducer RAM; only coord ApprovalCenter decides server-side | `ActionCenter.tsx:224` vs unused `POST /actions/:id/decide` | 8 of 10 decide-roles "approve" into the void |
| 12 | Settings "Your data rights" fakes DPDP export/correction cases (toast-only) | `Settings.tsx:270-271`; real doors `POST /plugins/pack.dpdp/dsr`, `/parent/report-discrepancy` unused | A statutory DPDP right silently not exercised |
| 13 | ParentChat fabricates delivery ticks + a scripted "school" reply | `ParentChat.tsx:65-74`, `store.tsx:130-134` | Guardian believes the school read their message; school never received it |
| 14 | Calendar "Event added to the school calendar" persists nowhere (no door exists at all) | `CalendarScreen.tsx:111-122` | School-wide event is on one laptop, gone on reload |
| 15 | ItAdmin: session revoke / key rotation / snapshot email / export queue all toast-only | `ItAdmin.tsx:104-119, :290-293` | Security-looking no-ops; revoked sessions stay valid |
| 16 | Maintenance plane (13 screens) = in-memory `woStore` snapshotted pre-hydration (empty forever); `POST /work-orders` doors unused | `services/index.ts:295-297` | Facilities workflow vanishes; **also makes 12 of the 13 screens permanently empty** |
| 17 | Migration wizard "Activate SchoolOS" is a fictional journey (even server-side it fabricates the trust receipt: `imported` cols nothing writes, flips all sources `verified`) | `Migration.tsx:95-106`; `routes.js:696-712` | Owner believes go-live import happened, with an audit row certifying it |
| 18 | Cases/Incidents staff lanes are reducer-only (`POST /cases`, `/cases/:id/status` unused); server accepts **any** case transition anyway | `Cases.tsx:117`, `routes.js:403-416` | Incident lifecycle lost on reload; no state machine |
| 19 | Documents upload stores no file ("42 documents assembled" is hardcoded) | `Documents.tsx:169-204`; `files.store` wrappers have zero callers | Compliance certificates vanish; expiry tracking misses them |
| 20 | Reception desk shows "49 calls today · 96% answered by AI · Desk online" constants | `dataset.ts:327-329`, `Reception.tsx:86-89` | Owner believes a phone service is live when nothing exists |

Also confirmed (medium): Ask crash on "why does the AC keep failing" (`assetStore.find('NOR-AC-04')!`,
`services/index.ts:519`); People "Add person" fake-audit success while POST /students is orphaned; HR leave
approvals setTimeout theater (`/teacher/leave` has a live-capable consumer — orphan file `teacher/MyLeave.tsx`);
Memory close-the-loop RAM; student ticks localStorage-only; DataHealth "94" score on an empty school;
homework overclaims "students were notified"; `submission_count` vs `submission_counts` → stats read 0.

---

## 2. Not implemented (missing behind the UI too)

1. **Fee plans / obligations have NO creation path anywhere** — no server door, no UI (skeptic: worse than
   claimed). The money core can't be set up by a real school. (The one true "NOT IMPLEMENTED" at the center.)
2. **Password change** — no door; `force_change` is stamped by admins and never enforced at login (`M7`).
3. **Admissions offer-accepted → student** — approval raises `students.create.<id>` with **no executor**; the
   funnel's headline conversion creates nobody (`H2`).
4. **SSO/OTP tenancy safety** — password login 409s for multi-tenant emails, but Google SSO and OTP **silently
   pick an arbitrary tenant** (`H3`); the 409 has no follow-up picker flow in the client either.
5. **Student scoping on kernel doors** — `roleScope()` is dead code; a student token can read the whole roster,
   any classmate's fees + 60-day attendance, full register (`H4`).
6. **No email system at all** (verification, resets, receipts); **OTP "sent: true" while nothing is sent** —
   phone login can never complete in production (`H5`); rails default to `logger` (known decision, but the UX
   must say "no channel configured", not "sent").
7. **No scheduler / no workflow engine** — the Automation screen is 100% client mock; constitution copy
   (quiet hours, repeat guards) is enforced nowhere; `export_hour` is decorative; preventive-maintenance plans
   have no generator (`M1`).
8. **UPI links fabricate the payee VPA** (`schoolos@<StudentName>`; `default_vpa` setting read by no code) (`M4`).
9. Outbox has **no real subscriber** (console.log), parked rows indistinguishable from delivered, DLQ invisible
   in metrics (`M9`); comms dispatcher marks undeliverable rows `sent` and holds row locks across network calls
   (`M3`); retention misses outbox/comms/webhook logs/files; razorpay log tables ship **without RLS** (`M10`).
10. transport.gps **synthesizes fake bus positions + a 12-min delay** on the live GET door for real tenants (`M6`).
11. Platform billing/quotas, httpOnly-cookie sessions, PWA/i18n, real GPS vendor, real LLM AI — acknowledged gaps.

## 3. Partially implemented (contract/wiring bugs)

- **Teacher plane**: live for homework/submissions/brief, but 7 fixture-fallback doors that don't exist
  server-side silently swap in synthetic "Priya Iyer" data behind a 'Demo data' badge; review-status bug; stats
  field-name mismatch; `/teacher/home` door absent.
- **Wrong client paths (5)**: `/student/tasks/:id/toggle`, `/student/print/jobs`,
  `/parent/child/:id/assignments`, `/parent/explain?topic=` (server: `/explain/:topic`), etc. — these calls
  always error.
- **Live screens that read the wrong store**: PeopleAdmin writes real users/students, but People/Attendance/
  Fees/PersonDetail/HR read the empty dataset → UI contradicts the DB it just wrote.
- **Orphaned-by-one-flag**: FunnelBoard (real) vs Admissions (mock) with fabricated stall narrative;
  `POST …/leads` (create) has no wrapper/caller so even FunnelBoard can't intake a lead.
- **coord duty allocate / dpdp / cbse / tally / hr / clinic / timetable grid / GPS positions** — real plugin
  doors with zero UI (`parity.md` §2 lists 96 orphan doors; plugin-level orphan lists: health.clinic 5/5,
  pack.dpdp 6/6, pack.cbse 3/3, hr.leave 4/4, files.store 3/3, comms.whatsapp 3/3, accounting.tally 3/3,
  transport.gps 2/2, ops.timetable 4/4, teacher.support ~22/22).

## 4. UI↔API parity scoreboard (204 doors)

| Verdict | Count | Share |
|---|---|---|
| WIRED (reachable UI caller) | ~75 | 37% |
| MOCK-ONLY / decoy control (UI offers it, no server call) | ~22 | 11% |
| ORPHAN (API-only capability or DARK screen) | ~96 | 47% |
| DEMO-ONLY caller (LiveMode, tree-shaken) | ~5 | 2% |
| WEBHOOK/OPS (machine-only — fine) | 6 | 3% |

**Every orphan write door that matters, by role** → `.audit/parity.md` §4. The cheapest fix: `liveApi.ts`
already exports `apiFeeObligations, apiWorkOrders, apiMarkAttendance, apiDecideAction, apiAudit, apiMemory,
apiRoutes, apiTransportEvent, apiCases, apiEvents` — **zero call sites**. The swap layer is built; the screens
never moved onto it.

## 5. User-friendliness (from `.audit/ux.md`, skeptic-calibrated)

Design-system primitives are excellent; the **content and wiring betray them**:
- Only **8 of 149 empty states** carry an action (all "Try again") → first-run is a corridor of dead ends.
- Onboarding checklist: `plugins` item **pre-ticked at birth** (threshold `>1` vs born-on 5), links don't
  deep-link the right PeopleAdmin pane, invisible to itadmin, missing fee/rails steps.
- Sidebar omissions per role: finance/owner have **no Fees entry** (reachable via Today links — corrected by
  skeptic — but not one tap), admissions/transport missing; owner governance screens not in nav.
- 3× `window.confirm`, fake "Undo batch" in DataHealth, 420ms fake boot delay + "Meridian" shown before
  session, jargon leaks ("Plugin Manager", "RLS", "class E", permission-ID chips, OAuth copy on login),
  staff ≤768px strands Homework/Maintenance (tabbar is 5 fixed items), 21 `catch {}` swallows (≈8-9 genuine
  server-error discards), palette not role-filtered and mock-fed.

## 6. Engineering hygiene (from `.audit/hygiene.md`)

- `tsc -b` 0 errors — but **no `"strict"`** in tsconfig (the 6 past crash families are strict-mode catches).
- oxlint 89 warnings / 0 errors; `lint:eslint` **11 errors, not in CI**; CI `npm audit || true` (neutered);
  `check.js` has an always-green placeholder where DB reachability should gate.
- **Production bundle ships demo identity**: `app/dist/index.html` `<title>SchoolOS — Meridian International
  Academy</title>` + meta "Demo environment with simulated data" (verified).
- Vite resolves the **CJS `.js` twins** of `lib/format`/`lib/rng` before the `.ts` files (they're what actually
  ships); `types/domain.js` is the only genuinely dead twin.
- README/HANDOFF stats stale (62/63 vs 87+ routes; "25/25 tests" vs ~227; "zero mock modules" vs 25 importers;
  "177 routes" vs 200).
- Working tree carries ~26 MB QA residue; **`.qa-relcert*` dirs contain expired JWTs and student PII dumps** —
  delete regardless of other priorities.
- 8 orphan source files (`screens/Library.tsx`, TeacherNav + 5 teacher screens, InsightsShared) — 5 of them are
  the **entire UI** for real teacher capabilities (MyLeave with a working POST).

---

## 7. Recommended plan (ordered, each phase independently shippable)

**P0 — Stop the lying & the crashing (days, high urgency)**
1. Hydrate-time fix: rebind `SLA_POLICY` in `ensureDataset()`; guard `TERM_DAYS`/`sections`/`DEMO_SECTION_ID`
   derefs; add `DEMO_STUDENT/DEMO_GUARDIAN/FEE_STORY/deskSettings` to the empty-world override (or make
   `ParentHome/ParentFees` demo-only and route parents to live `family.view` screens only).
2. Kill every fake success: toast only on 2xx. Sweep `dead-controls.md` list — Ask approve, Settings data
   rights, ItAdmin ops, ParentChat ticks, Migration activate, Documents upload, Learning buttons, Memory,
   DataHealth. Where no door exists (Calendar, chat): honest "device-only draft / not connected" copy.
3. Route the dead QuickActions entries to existing routes (or hide the FAB until wired). Delete the 4 crash
   routes' triggers. Rebuild dist (and fix `index.html` title/meta per tenant).

**P1 — Move the staff core onto the doors that already exist (the big parity win)**
Swap screen-by-screen from `services/index.ts` → `liveApi.ts` (wrappers mostly exist):
Attendance (→`/attendance/mark`), Fees reads (→`/fees/obligations`) and retry (→`/fees/payments/:id/confirm`),
Maintenance flagship (→ work-orders/assets), Audit (→`/audit`), ActionCenter (→`/actions` + decide),
Cases/CaseDetail (→ case doors), Memory (→`/memory`), Transport reads + drill (→`/transport/routes`,
`/transport/events`), HR leave list/decide (→ hr.leave doors), People create (→`POST /students`), Documents
upload (→ `files.store` wrappers), FunnelBoard create-lead (new wrapper → `POST …/leads`), parent fees pay
(→`POST /fees/payments`) — and **delete the mock stores** when each screen moves. Fix the 5 wrong client paths
+ the graded/reviewed + submission_counts contracts. Add the 3 missing teacher screens (route MyLeave,
Concerns/PTM or cut their QuickAction entries).

**P2 — Build what is genuinely missing (product decisions flagged ✱)**
Fee-plan → obligation **creation doors + finance UI**✱ (blocking money); self-service **password change** door
+ enforce `force_change`; **students.create executor** on admission approval; **tenant-picker** for SSO/OTP +
mirror the 409 (and scope student tokens on kernel reads — security); real **SMS/mail rails** behind plugin
settings with "no channel configured" 503s (then OTP login truly works); `default_vpa` read + 503; DPDP/CBSE/
clinic/timetable-grid/**plugin settings UI** (a generic manifest-driven settings form would light up ~6
orphaned plugins at once); minimal **scheduler** (cron already exists in docker-compose) for preventive WO
generation, tally export, retention sweep; DLQ visibility in `/metrics`.

**P3 — Usability pass (after P0/P1, when the copy becomes truthful again)**
Empty-state CTAs on the top ~20 screens; checklist fixes (threshold, deep-links, itadmin visibility, fee+rail
steps); sidebar role entries (Fees/Admissions/Transport/governance); staff mobile "More" sheet; terminology
sweep; styled confirm modal replacing `window.confirm`; role-filtered palette; surface `friendly(e)` in the
~9 real swallows; drop fake boot delay + demo branding.

**P4 — Factory & repo**
`"strict": true` (expect a day of fallout — it is the cheapest class of the past 6 crash-bugs prevented);
delete `.qa-relcert*` (PII/JWTs) + root logs + `.chrome-profile*` now; retire the CJS twins and the 8 orphan
files (after rescuing MyLeave etc.); put `lint:eslint` + a **no-mock-imports rule** (grep gate: no new
`services/index` importers) + regenerated permission matrix in CI; un-neuter `npm audit`; correct README/
HANDOFF numbers; archive `handoff/` into `docs/handoff/`.

**Structural guardrail for the future (the audit's one big lesson):** make *every UI action ↔ a door* a
mechanical check — a generated parity report (extend `permission-matrix.js` to also grep `app/src` for each
door's caller) that fails CI when a write door gains zero UI consumers or a screen imports the mock layer.
That is the only way the UI-only law survives the next 50 doors.
