# SIMULATION-FIXES — findings & improvement suggestions from the Cassandra run

> Source: the live walkthrough in `docs/SCHOOL-SIMULATION-LOG.md` (Steps 1–15) plus the fix
> passes recorded in `docs/INCOMPLETE-AND-PARTIAL-FIXES.md` and `TODO_FIX_MAP.md`.
>
> **Status:** `FIXED` (code changed) · `OPEN` (defect, no fix) · `ACCEPTED` (deliberate, no code
> needed) · `IMPROVE` (not a defect — a suggestion). Severity: **P0** trust/blocker ·
> **P1** real defect/broken contract · **P2** hardening/drift · **P3** cosmetic/docs.
>
> Every finding below was observed while running a real school through the real app. Line numbers
> drift; treat the cited door/section as the anchor.

---

## 0. Summary

| Group | Findings | Worst |
|---|---|---|
| A. Onboarding & identity | 4 | P1 |
| B. Timetable | 3 | P2 |
| C. Attendance & guardians | 3 | P1 |
| D. Library | 5 | P2 |
| E. Platform / governance | 3 | P2 |
| F. Exams | 3 | P1 |
| G. Admissions | 2 | P2 |
| H. Transport | 2 | P1 |
| I. HR / leave | 3 | P1 |
| J. Honest gaps (unbuilt) | 5 | — |
| K. Improvement suggestions | 19 | — |
| L. Extended run (fees · visitors · ops · governance · platform) | 7 | P1 |

---

## A. Onboarding & identity

| ID | Sev | Finding | Evidence | Suggested fix | Status |
|---|---|---|---|---|---|
| A1 | P1 | **`itadmin` could not admit students**, so the school had to grant a temporary custom-role overlay to get Step 10 done. | `POST /students` gate; `people.admin` `ROSTER` | Make `itadmin` the onboarding authority (students + import + all non-owner/non-principal roles); only owner creates `principal`. | **FIXED** (`docs/FIX-ITADMIN-ONBOARDING-AUTHORITY.md`, 2026-09-22) |
| A2 | P2 | **New schools were born with fabricated classes** (`1–8 × A/B/C`) nobody chose; every picker then offered them. | old `onboarding.js` `DEFAULT_SECTIONS` | Born empty; add a **classes** checklist step pointing to `/classes`. | **FIXED** |
| A3 | P2 | **The campus concept leaked through onboarding** and the demo/UI (624 occurrences). A school is one site; a second site is a separate tenant. | `onboarding.js`, Settings "Campuses" | Phase A (provisioning/UI) + **Phase B (demo/UI sweep) done** — `CampusId`/`Campus`, `campuses`, the `campus` field on every record, `campusScope`/`activeCampus`, the switcher, filters and the `/group` console are all removed. | **FIXED** |
| A4 | P2 | **No forced password change on self-signup.** | `onboarding.js` | Deliberate: the owner chose their own password; recorded as policy. | **ACCEPTED (M5)** |

---

## B. Timetable

| ID | Sev | Finding | Evidence | Suggested fix | Status |
|---|---|---|---|---|---|
| B1 | P1 | **A self-signup school could not build a timetable** — `ops.timetable` shipped only read/substitute/autofill doors; periods/slots were seeded by migration for tenants existing at migrate time (Cassandra: 0). | `ops.timetable/index.js` | Period + slot CRUD, `seed-default`, shared clash check, section-aware slots. | **FIXED** (M3/M4, migration 134; verified Step 14) |
| B2 | P2 | **Per-slot `timetable.published` events trip the plugin event budget** (`events_per_min: 60`): a full-grid build returns **429 `BUDGET_EXHAUSTED`** after ~60 writes; the breaker update rolls back with the transaction so it keeps refusing. | `governance.js:3,31-37`; Step 14 finding | Add a **bulk slot door that emits one summary event** (as `seed-default` already does), or raise the budget for operator bulk imports. | **FIXED** — `POST /plugins/ops.timetable/slots/bulk` writes a whole batch in one transaction and emits ONE summary event; the `/timetable` screen has a Bulk load action. Pinned by `timetable-write.test.js`. |
| B3 | P1 | **"First-period teacher takes attendance" was not expressible** — attendance binds by `class_assignments`; timetable slots were free-text/name-matched. | old `timetable_slots`; Step 8 | Section-aware slots + `GET /first-period-teacher` shipped. **Still to wire:** let the register owner for a class-section derive from the period-1 slot. | **FIXED** — `firstPeriodClasses()` in `routes.js` lets a teacher with no `class_assignments` row mark the register for the class-section whose day's first non-break period they teach; the audit stamps `timetable first period`. |

---

## C. Attendance & guardians

| ID | Sev | Finding | Evidence | Suggested fix | Status |
|---|---|---|---|---|---|
| C1 | P1 | **Absence notices never queued** for app-onboarded students: the pipeline joined `app.guardians`, which `POST /students` never populated; parent links lived only in `family.child_link`. | `routes.js` attendance mark | Resolve the phone from **either** model (`app.guardians` UNION `family.child_link`→`users.phone`); `POST /students` now also upserts `app.guardians`. | **FIXED** (M1; verified Step 13-R) |
| C2 | P2 | **`noticesQueued` over-reported** — it returned the count of newly-absent students, not notices actually written. | same handler | Return the actual inserted count (and `guardiansResolved`). | **FIXED** (M2) |
| C3 | P2 | **Two guardian models populated by different paths** (`app.guardians` vs `family.child_link`) — a standing drift risk beyond the absence notice. | Step 13 finding | Keep both in step at every family-writing door (started in M1); add a reconciliation check. | **FIXED** — every family-writing door (manual admit, admissions convert, people.admin parent link) writes `app.guardians`; `students-lifecycle.test.js` pins the drift check. |

---

## D. Library

| ID | Sev | Finding | Evidence | Suggested fix | Status |
|---|---|---|---|---|---|
| D1 | P2 | **No owner/principal identifier-scheme door.** `PUT /desk/settings` deliberately rejects identifier keys, and the design's `/plugins/library/settings` is unbuilt — so a tenant is stuck on the default accession/`LIB` scheme. | `library/index.js:62,952`; Step 15 | Add the owner/principal settings door (full schema, validated by `settings-contract.js`). | **FIXED** — typed `GET/PUT/POST /plugins/library/settings` (owner/principal/itadmin) validates and MERGES, so an identifier-scheme change never resets the librarian's desk policy. |
| D2 | P3 | **`POST /acquisitions` returns an inconsistent key:** `{ request }` for a new suggestion but `{ requestId }` when it de-dupes into a vote — a client cannot read one key for both. | `library/index.js:1126,1136` | Return `requestId` (and `request`) in both branches. | **FIXED** — both branches return `requestId` (and `request` on creation). |
| D3 | P3 | **The vote door requires a JSON body** — an empty `POST /acquisitions/:id/vote` (no body) returns `400 Unexpected end of JSON input`. | Step 15 | Treat an absent body as `{}`. | **FIXED** — the shared JSON parser treats an empty body as `{}`; malformed non-empty JSON is still a 400. |
| D4 | P2 | **No student login accounts / `app.student_accounts` is empty**, so the student borrower surface ("my loans/fines/requests") is unreachable for app-onboarded students; `selfBorrower` falls back to a fragile name-match. | Step 15 (0 rows); `library/index.js:144-158` | Create + link a student user at admission (or provide a door to link); prefer the stable link over name-match everywhere. | **FIXED (link preference)** — the library now resolves a student via the stable `app.students.user_id` link (F1/132) before the legacy bridge or name-match. Creating the accounts themselves remains an onboarding decision. |
| D5 | P2 | **Library budget + bulk:** like B2, every library write emits an event; a large catalog load can trip the same 60/min budget. | `governance.js` | Consider a bulk catalog import that emits one summary event. | **IMPROVE** |

---

## E. Platform / governance

| ID | Sev | Finding | Evidence | Suggested fix | Status |
|---|---|---|---|---|---|
| E1 | P2 | **The plugin event budget (60/min) blocks any bulk operator action** (timetable, catalog) with no bulk door. | `governance.js:3` | See B2/D5 — bulk doors with summary events, or a per-tenant bulk budget. | **FIXED (timetable)** — the bulk slot door (B2) removes the wall for the grid build; a catalog bulk door remains an improvement (D5). |
| E2 | P2 | **The `library.overdue` attention widget called a librarian-scoped door as the owner**, 403-ing on every staff screen. | `TODO_FIX_MAP.md` X1; `library/index.js` overdue scope | Gate the widget on `useRoleOrGrant`/`canSurface` so it only mounts for the librarian (or map it to a surface the owner holds). | **FIXED** — the widget now mounts (and fetches) only when `useRoleOrGrant(['librarian'], ['GET /plugins/library/overdue'])` allows it. |
| E3 | P2 | **Demo/seed branding + fake badges** ("Meridian", "99.2% Live", fake overdue rows) on live-looking screens. | `TODO_FIX_MAP.md` T1–T11; `SampleNote` gate | Continued: every seed-reading screen carries `SampleNote` or an allowlist reason (CI gate shipped). | **FIXED (ongoing gate)** |

---

## F. Exams

| ID | Sev | Finding | Evidence | Suggested fix | Status |
|---|---|---|---|---|---|
| F1 | P1 | **The parent-facing read ignores the moderation overlay.** Staff see the moderated report (`pct 90 · A2`) via the exams report door, but `GET /parent/child/:id/academics` and `/exams` read the stored snapshot directly and showed the **pre-moderation `57 · C1`**. Moderation is meant to supersede the frozen snapshot. | `family.view/index.js:228-232,271-277` vs `exams.assessment/index.js:281-296` | Have the parent doors serve latest-approved-overlay ?? original, sharing the exams plugin's read logic. | **FIXED** — one read model in `_shared/exam-report.js`; the parent timeline/academics/exams doors serve the approved overlay and re-derive the grade. Pinned by `parent-exam-read.test.js`. |
| F2 | P3 | **A published exam appears in the parent "upcoming" list.** `parent/child/:id/exams` builds `upcoming` from `status IN ('draft','published')`, so a published exam shows in both lists. | `family.view/index.js:266-269` | `upcoming` should be `status='draft'` (or `<> 'published'`). | **FIXED** — `upcoming` is `status='draft'` only. |
| F3 | P2 | **The attendance floor excludes students the moment the term starts** (by design). A student absent once in a short term fell to 57% and their marks were rejected (`saved 88` of 90), so class 1 published 2 reports not 3. | `exams.assessment/index.js:161-172,417-434`; Step 16 finding 1 | Not a defect — but the desk needs a clear, actionable eligibility view (who is blocked and why) before marks entry, not only a per-row rejection. | **FIXED** — `GET /plugins/exams.assessment/exams/:id/eligibility` lists the class with each student's attendance pct and floor status; the ExamMarks screen shows a warning banner before entry. |

---

## G. Admissions

| ID | Sev | Finding | Evidence | Suggested fix | Status |
|---|---|---|---|---|---|
| G1 | P2 | **Offer→enrolled conversion escalates to the owner.** The `students.create` action is raised with `owner_role='principal'`, but the stage door does **not** stamp `proposed_by`, so the decide door treats it as an unattributable proposal and refuses the principal (`403 "… Ask the school owner to decide."`). Every enrollment needs the owner, even though the action names the principal. | `admissions.funnel/index.js:199-211`; `routes.js` decide SoD | Stamp `proposed_by` at raise time (the exams publish door already does) so the principal desk can approve without weakening SoD. | **FIXED** — the stage door stamps `proposed_by`/`proposed_by_role` on the raised `students.create` action, so the principal desk decides it; self-approval is still refused. Pinned by `admissions-proposer.test.js`. |
| G2 | P3 | **The named `admissions` desk role has no account.** `ADMIN`/`FULL_PII` include `admissions`, but the simulated school staffed no such user, so the desk ran as coordinator/principal. Not a defect — a staffing note: the funnel is built for a dedicated admissions officer. | `_shared/admissions-access.js:30-32`; Cassandra users | Provision an `admissions` account in the setup wizard/checklist so the intended desk exists. | **FIXED** — `/onboard/status` now counts `admissions` accounts and the setup checklist carries an optional "Create an admissions desk account" step. |

---

## H. Transport

| ID | Sev | Finding | Evidence | Suggested fix | Status |
|---|---|---|---|---|---|
| H1 | P1 | **No route/stop write door.** `transport.gps` ships only position ingest/read; the kernel ships `GET /transport/routes` and `POST /transport/events`. `app.routes` / `app.route_stops` are populated by **migration seed only**, so a self-signup school has 0 routes and cannot create any. | `transport.gps/index.js` (2 doors); `routes.js:2117,2126`; migration seeds | Add route + stop write doors (owner/principal/transport), audited, soft-retire — same shape as the timetable M3/M4 fix. | **FIXED** — route + stop create/edit/soft-retire doors in `transport.gps` (migration 136), a `/transport/routes` screen + nav + `KernelGate`, and the kernel read filters retired routes. Pinned by `transport-write.test.js`. |
| H2 | P1 | **The route/class audience resolver reads only `app.guardians`.** App-onboarded students have no `app.guardians` rows (they link via `family.child_link`→`users.phone`), so approving a **Route R2** delay notice resolved **0 recipients** (`status:'unaddressed'`) — no guardian told. Proof: the 3 admissions-created students (who *do* have `app.guardians`) queued the notice with 3 recipients. | `routes.js:165-211` (`resolveNoticeRecipients`) | Resolve route/class audiences from `app.guardians` **UNION** `family.child_link`→`users.phone` — the M1 fix applied to this shared resolver too. | **FIXED** — `resolveNoticeRecipients` resolves route/class/student audiences from `app.guardians` UNION `family.child_link`→`users.phone`. Pinned by `notice-resolver.test.js`. |

---

## I. HR / leave

| ID | Sev | Finding | Evidence | Suggested fix | Status |
|---|---|---|---|---|---|
| I1 | P1 | **The teacher-leave handover packet is always empty.** `runTeacherLeaveOutcome` computes leave weekdays with ``new Date(`${lr.from_date}T00:00:00Z`)``, but `pg` returns a `date` column as a **JS Date object**, so the template is `"Tue Sep 29 2026 …T00:00:00Z"` → **Invalid Date** → the weekday loop never runs → `days=[]` → no slots match. Result: `execution {type:'leave_handover', periods:0}` and "0 periods need cover". | `routes.js:3084-3099` (verified: 16 matching slots exist for Priya) | Select `to_char(from_date,'YYYY-MM-DD')` or use `.toISOString().slice(0,10)` before building the ISO string. Add a test with a teacher who has slots. | **FIXED** — the leave dates are read as text (`to_char`), so the weekday loop runs and the packet lists the affected periods. |
| I2 | P2 | **The handover matches `s.teacher_name` free-text**, not `teacher_id`, so a renamed/duplicate-named teacher loses cover. | `routes.js:3097` | Match on `s.teacher_id = lr.teacher_id` (the column exists since M4). | **FIXED** — cover is matched by `s.teacher_id`, not the free-text `teacher_name`. |
| I3 | P3 | **The leave row lags the kernel decision.** A dismissed/accepted action leaves `teacher.leave_request.status='pending'` until the teacher next polls `/teacher/leave/mine` (documented lazy projection). The `app.actions` row is authoritative but the DB row is stale between decision and next poll. | `teacher.classroom/index.js:713-757`; Step 19 note | Project the decision into the row inside the decide executor (`runTeacherLeaveOutcome`) so the two agree immediately. | **FIXED** — the decision is projected into `teacher.leave_request` inside the decide executor (audited once); the lazy GET projection is now a no-op. Pinned by `leave-handover.test.js`. |

---

## J. Honest gaps (unbuilt — not defects)

| ID | Gap | Note |
|---|---|---|
| F1 | **Outbound delivery** (email/SMS/WhatsApp) is `provider='logger'` until per-school keys exist. | OTP login, receipts, dunning stay "not connected" until then (L1). |
| F2 | **GPS telemetry** is a simulated vendor feed, honestly labelled. | H9/L6. |
| F3 | **Workflow runtime** — minimal runner or delete the fiction (decision pending). | `.coop/L2-5.2-workflow-runtime-decision.md`. |
| F4 | **AI copilots** remain deliberately rule-based (deterministic templates, tokens 0). | Product ruling. |
| F5 | **Hostel / payroll / push notifications** — new domains with no shipped code to repair. | L1/L2/L3 accepted out of scope. |

---

## K. Improvement suggestions (roadmap)

1. **Bulk endpoints with summary events** for timetable slots, catalog/copies, and student import —
   removes the event-budget wall (B2/D5/E1).
2. **Wire first-period-teacher into attendance** so a class-section's register owner can come from
   the timetable slot, not only `class_assignments` (B3).
3. **One guardian model, or a reconciler** — write `app.guardians` and `family.child_link`
   together everywhere; add a drift check (C3).
4. **Student identity at admission** — create/link `app.student_accounts` so the student portal and
   library borrower side work without name-matching (D4).
5. **Owner/principal library settings door** for the identifier/catalog scheme (D1).
6. **Small API-contract cleanups** — acquisitions response key (D2), bodyless vote (D3).
7. **Finish the campus-removal sweep** (A3 Phase B), driven by `tsc`.
8. **Widget/permission hygiene** — mount attention widgets only where the door is reachable (E2).
9. **One exam read model** — the report door, the parent doors and any export should share the
   latest-approved-overlay logic so moderation is consistent everywhere (F1), and `upcoming`
   should exclude published exams (F2).
10. **Exam eligibility preview** — surface who is below the attendance floor *before* marks entry
    (F3), so the desk can act rather than discover per-row rejections.
11. **Attribute proposals at raise time** — stamp `proposed_by` on every kernel approval a door
    raises (admissions conversion, G1), so the named desk can decide instead of always escalating
    to the owner.
12. **Transport route/stop write doors** — let a school create its own routes and stops (H1),
    replacing migration-only seeding.
13. **One guardian-contact resolver** — make `resolveNoticeRecipients` read `app.guardians` UNION
    `family.child_link`→`users.phone`, so route/class notices reach app-onboarded families (H2/C3).
14. **Fix the leave handover** — parse the `date` column as `YYYY-MM-DD` and match cover by
    `teacher_id` (I1/I2), so an approved leave actually produces a cover packet.
15. **Project leave decisions at decision time** — write the outcome into `teacher.leave_request`
    inside the executor instead of lazily on the next teacher poll (I3).
16. **Fix the board-pack fee metric** (L1) — count `open` obligations; the number is currently
    always 0.
17. **Route the visitors resolver through the same guardian union** (L2) — the last door still
    reading `app.guardians` alone.
18. **Asset + principal-brief write doors** (L3/L4) — both tables are currently unreachable for
    creation from the app.
19. **Align decision vocabulary** (L6) and add an audited dunning force-run (L7).

---

## L. Extended run — fees · visitors · ops · governance · platform (Step 20)

| ID | Sev | Finding | Evidence | Suggested fix | Status |
|---|---|---|---|---|---|
| L1 | P2 | **`board-pack.open_obligations` is always 0.** It counts `status IN ('pending','partial')`, but fee obligations are created `status='open'` (65 open / 25 paid here) — the metric reads **0** while ₹16,25,000 is outstanding. | `routes.js:2503` | Include `'open'` in the filter (`status IN ('open','partial')`). | **FIXED** — the board-pack and oversight-home metrics count `status IN ('open','partial')`; the day-worker's principal-brief fee-dues query had the same bug and is fixed too. Pinned by `owner-principal.test.js` (L1). |
| L2 | P1 | **Visitors `guardian-lookup` + `pickup` read only `app.guardians`.** For app-onboarded students that table is empty, so lookup returns `guardian:null` and pickup refuses "No guardian phone on file". Proof: a pickup for an admissions-created student (has `app.guardians`) minted an OTP and completed. Third instance of the H2/C1 root cause. | `ops.visitors/index.js:104,142` | Resolve the primary guardian from `app.guardians` **UNION** `family.child_link`→`users.phone`. | **FIXED** — both doors resolve `app.guardians` UNION `family.child_link`→`users.phone`, preferring the canonical guardians row. Pinned by `visitors.test.js` (test 12). |
| L3 | P2 | **No asset write door.** `GET /assets` exists; nothing creates assets, so `app.assets` stays 0 and work orders can never link an `asset_id`. | `routes.js:2266` (read only) | Add asset create/edit/retire doors (owner/principal/facilities). | **FIXED** — `POST /assets` + `PATCH /assets/:id` + `POST /assets/:id/retire` (owner/principal/itadmin/facilities), audited + evented; retirement is a status (no DELETE) and refuses while an open work order links the asset. Pinned by `rte-hardening.test.js` (L3). |
| L4 | P2 | **No principal-brief generation door.** `app.principal_briefs` is read-only; briefs appear only if a worker/seed writes them. | `routes.js:2574,2588` | Add a generate door (or document the worker that writes it). | **FIXED** — `POST /brief/principal/generate` (owner/principal/itadmin) deterministically writes today's brief from the live read models; the 07:00 `day-worker` remains the scheduled writer. Pinned by `owner-principal.test.js` (L4). |
| L5 | P2 | **The announcement outbound (non-in-app) path uses the phone resolver that reads only `app.guardians`** (H2), so a WhatsApp/SMS announcement reaches nobody for onboarded families. The in-app path is correct (resolves `family.child_link` → 45 recipients). | `routes.js:2618` (`announceReach`→`resolveNoticeRecipients`) | Same union fix as H2. | **FIXED** — the `all_guardians` outbound branch now uses the same guardian union (class/route already did after H2). Pinned by `notice-resolver.test.js` (L5). |
| L6 | P3 | **Concession decisions use `approve|reject`** while every other decision door uses `approved|dismissed`. | `routes.js:2113` | Accept both spellings, or align on one. | **FIXED** — the concession decide door accepts `approved|dismissed` as aliases of `approve|reject`. Pinned by `fees-enterprise.test.js` (L6). |
| L7 | P3 | **Dunning cannot run during quiet hours** (returns `queued:0` with a note) with no force/override, so a missed sweep cannot be backfilled by an operator. | `routes.js:3487` | Add an explicit `force:true` (audited) for an operator-initiated backfill. | **FIXED** — `force:true` overrides the quiet-hours guard and writes a dedicated audit row; the response marks `forced`. Pinned by `fees-dunning.test.js` (L7). |

---

## Verification of the fixes cited above

- `docs/VERIFICATION.md` — **959 tests · 959 pass · 0 fail · 0 cancelled** (fingerprint
  `2a604e82…`), regenerated through `verification-artifact.js`.
- `node scripts/check.js` — all green (378 routes, 0 unguarded).
- Live re-runs on the Cassandra tenant: **Step 13-R** (absence notice queues), **Step 14**
  (10 periods + 1800 slots, clash 409, first-period teacher resolves), **Step 15** (34 titles,
  134 copies, full circulation/holds/fines/acquisitions), **Step 16** (15 exams, 88 marks, 2
  published, moderation + recompute), **Step 17** (14 leads, 3 conversions → students, health ✓),
  **Step 18** (6 routes, 22 stops, 48 riders, GPS + delay notices), **Step 19** (5 staff marks,
  2 teacher requests, 1 child leave → attendance), **Step 20** (fees ₹625k collected/14 receipts,
  8 visitors, 8 work orders, 3 announcements, board-pack + snapshot, 6 clinic visits, 5 cases,
  subjects/compliance/policies/appraisals/certificates, API keys/webhooks, migration sources).

---

## Follow-up pass (2026-09-23) — the open findings closed

The findings that the simulation pass recorded as NOT IMPLEMENTED were implemented in the follow-up
pass, each with a test. The parallel-session changes the earlier note flagged are now part of the
verified tree.

| ID | Finding | What changed |
|---|---|---|
| F1 | Parent doors ignored the moderation overlay | One read model in `_shared/exam-report.js`; parent timeline/academics/exams serve the approved overlay. `parent-exam-read.test.js`. |
| B2 / E1 | Plugin event budget blocked bulk timetable writes | `POST /plugins/ops.timetable/slots/bulk` emits ONE summary event; `/timetable` Bulk load. `timetable-write.test.js`. |
| D1 | No owner/principal library identifier-scheme door | Typed `GET/PUT/POST /plugins/library/settings` validates and MERGES. |
| D2 | `POST /acquisitions` inconsistent key | Both branches return `requestId`. |
| D3 | Bodyless vote returned 400 | The shared JSON parser treats an empty body as `{}`. |
| E2 | Owner 403 on the library overdue widget | Widget gated on `useRoleOrGrant`. |
| F2 | Parent "upcoming" included published exams | `upcoming` is `status='draft'` only. |
| G1 | Admissions conversion escalated to the owner | The raise stamps `proposed_by`; the principal desk decides. `admissions-proposer.test.js`. |
| G2 | No `admissions` desk account | Setup checklist surfaces the optional account. |
| H1 | No transport route/stop write door | Route/stop CRUD + soft-retire (migration 136) + `/transport/routes` screen. `transport-write.test.js`. |
| H2 | Route/class notice resolver read only `app.guardians` | The resolver uses the union. `notice-resolver.test.js`. |
| I1/I2/I3 | Teacher-leave handover empty / name-matched / stale | Dates read as text; cover matched by `teacher_id`; the decision is projected at decide time. `leave-handover.test.js`. |
| L1–L7 | Board-pack metric · visitors guardian union · asset write doors · brief generate · all-guardians union · concession vocabulary · dunning force | Implemented in the second follow-up pass; each pinned by the test named in section L. |

**Still open by decision:** A3 Phase B (the campus-removal sweep — a dedicated ~35-file refactor, driven
by `tsc`) and D5 (a library bulk-catalog door; the library plugin carries no explicit `events_per_min`,
so its emit seam is not budget-enforced today). Both are improvements, not defects.

---

## Proposed fixes (patch-ready)

Concrete edits for each open finding, so a follow-up session can implement without re-deriving the
analysis. Apply in the order below (highest severity first). Every server fix should keep the
existing audit + event + `withUser` transaction discipline.

### FIX-1 · H2 — route/class notice resolver reads only `app.guardians` (P1)
**File:** `server/src/routes.js` — `resolveNoticeRecipients` (the `routeCode`, `audienceKind:'class'`
and `audienceKind:'route'` branches, ~:178-199).
Replace the guardian-only lookup with the union the attendance notice already uses (M1):
```sql
SELECT DISTINCT t.phone
  FROM app.students s
  JOIN (
    SELECT g.student_id, g.phone FROM app.guardians g WHERE g.is_primary AND g.phone IS NOT NULL
    UNION
    SELECT cl.student_id, u.phone FROM family.child_link cl
      JOIN app.users u ON u.id = cl.user_id
     WHERE u.phone IS NOT NULL AND u.active
  ) t ON t.student_id = s.id
 WHERE s.tenant_id = $1 AND s.bus_route = $2   -- or s.grade = $2 for the class branch
```
**Done-when:** a `TRANSPORT_DELAY` (or class audience) approval on an app-onboarded roster queues
with `recipients > 0`; add a test that seeds a student with only `family.child_link` (no
`app.guardians`) and asserts a queued communication.

### FIX-2 · H1 — no transport route/stop write doors (P1)
**File:** `server/src/plugins/transport.gps/index.js` (new doors; keep reads in the kernel).
Add, mirroring the timetable M3/M4 shape: `POST/PATCH /plugins/transport.gps/routes`,
`POST .../routes/:id/retire`, `POST/PATCH .../stops`, `POST .../stops/:id/retire`; gates
`owner|principal|transport|coordinator`; `withUser` + `requestAudit` + `emitEvent`; soft-retire
(`retired_at`) because the app role holds no DELETE. Add a `/transport` setup UI + nav.
**Done-when:** a self-signup school creates a route + stops through the app and its riders resolve.

### FIX-3 · G1 — admissions conversion escalates to the owner (P2)
**File:** `server/src/plugins/admissions.funnel/index.js:199-211`.
Stamp the proposer on the raised action so the named desk can decide:
```js
JSON.stringify({ leadId: req.params.id, ..., proposed_by: req.user.id, proposed_by_role: req.user.role })
```
**Done-when:** a principal-owned `students.create` action raised by the admissions desk is
approvable by the principal (proposer ≠ approver still enforced).

### FIX-4 · F2 — parent "upcoming" includes published exams (P3)
**File:** `server/src/plugins/family.view/index.js:266-269`.
Change `status IN ('draft','published')` to `status = 'draft'`.

### FIX-5 · D2/D3 — library acquisitions contract (P3)
**File:** `server/src/plugins/library/index.js`.
- New-suggestion branch (:1136) should return `requestId` alongside `request`.
- Vote door (:1151) should treat an absent body as `{}` (guard `req.body ?? {}`) instead of
  relying on the JSON parser.

### FIX-6 · D1 — owner/principal library identifier-scheme door (P2)
**File:** `server/src/plugins/library/index.js` (new `GET/PUT /plugins/library/settings`).
Accept the `IDENTIFIER_KEYS` set only, validate through `settings-contract.js`, gate
`owner|principal`, audit. The librarian's `PUT /desk/settings` keeps rejecting identifier keys.

### FIX-7 · B2/D5/E1 — bulk doors with summary events (P2)
Add bulk endpoints for **timetable slots**, **library catalog/copies**, and any large seed path,
each emitting **one summary event** (as `periods/seed-default` already does) so operator bulk work
does not trip the `events_per_min: 60` plugin budget.

### FIX-8 · E2 — library overdue widget mounts for the owner (P2)
**File:** `app/src/plugins/widgets/LibraryOverdue.tsx` (+ its registration).
Gate on `useRoleOrGrant`/`canSurface` so it only mounts where the overdue door is reachable (the
librarian), or map it to a surface the owner holds.

### FIX-9 · I1/I2/I3 — teacher-leave handover (P1)
**File:** `server/src/routes.js` — `runTeacherLeaveOutcome` (~:3076-3126).
- Read the dates as text: `SELECT id, teacher_id, to_char(from_date,'YYYY-MM-DD') AS from_date, to_char(to_date,'YYYY-MM-DD') AS to_date ...`, or convert with `new Date(lr.from_date).toISOString().slice(0,10)`.
- Match cover by id, not name: `AND s.teacher_id = $2` (pass `lr.teacher_id`).
- Project the decision into `teacher.leave_request` here (`UPDATE ... SET status=...)` so I3's
  row no longer lags.
**Done-when:** approving a leave for a teacher with slots yields `execution {type:'leave_handover', periods:>0}`.

### FIX-10 · L1 — board-pack `open_obligations` (P2)
**File:** `server/src/routes.js:2503`. Change `status IN ('pending','partial')` →
`status IN ('open','partial')`.
**Done-when:** with 65 open obligations the board-pack reports 65, not 0.

### FIX-11 · L2/L5 — visitors + announcement resolver (P1)
**Files:** `server/src/plugins/ops.visitors/index.js:104,142`; `server/src/routes.js:2618`.
Resolve the primary guardian from `app.guardians` **UNION** `family.child_link`→`users.phone`
(the FIX-1 helper). For the announcement path, route `announceReach` through the fixed
`resolveNoticeRecipients`.
**Done-when:** a pickup for an app-onboarded student mints an OTP, and a WhatsApp announcement
resolves >0 recipients.

### FIX-12 · L3 — asset write doors (P2)
**File:** `server/src/routes.js` (beside `GET /assets`).
Add `POST /assets` + `PATCH /assets/:id` + retire (owner/principal/facilities), audited, so work
orders can reference real assets.

### FIX-13 · L4 — principal-brief generation (P2)
**File:** `server/src/routes.js` (beside the brief read at :2574).
Add `POST /reports/principal-brief` (owner/principal) that assembles and stores a brief for the
current IST date (deterministic, from existing read models), or document the worker that writes it.

---

*Generated 2026-09-23. Companion to `docs/SCHOOL-SIMULATION-LOG.md`, `TODO_FIX_MAP.md` and
`docs/INCOMPLETE-AND-PARTIAL-FIXES.md`.*
