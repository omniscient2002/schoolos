# TODO_FIX_MAP

> Prioritized remediation map for the high-impact gaps found in the code + the repo's own status
> registers. Companion to `MAY_BE_IDEAS.md` (which is a *menu*; this is the *work order*).
>
> **How to read:** each item is `ID · priority · effort · phase`, then *Problem → Evidence → Fix →
> Done-when → Depends*. Priorities: **P0** trust/daily-operation blocker · **P1** high value ·
> **P2** important, not urgent. Effort: **S** <1 day · **M** 2–5 days · **L** 1–3 weeks.
> Status is all **OPEN** until a pin/mutation proves otherwise (the repo's own closure law).

## Progress

**DONE**
- **Phase 0 (T1–T11) — trust.** `SampleNote` added to AiUsage, Insights, DataHealth, Reception, Next,
  Calendar, Documents, CaseDetail, Attention, Attendance, Automation, Constitution. Reception's false
  "Desk online" badge → "Preview — not connected". Insights' false "Recomputed nightly · verified"
  badge and "From live attendance records" wording fixed. CaseDetail uses the session school name.
  **T9** fixed: `PersonDetail` now resolves live student UUIDs via `GET /students/:id` (no more
  "Record not found" when opening a real student). **T11** shipped as
  `app/src/test/honesty-gate.test.ts` (fails CI if a seed-reading screen has no `SampleNote` and no
  allowlist reason).
- **M1 — finance maker/checker.** The doors already admitted `finance_head`/`finance_clerk`; the
  **generated matrix was wrong** — `server/scripts/permission-matrix.js` used `/'([a-z]+)'/` and
  silently dropped underscore role names. Fixed the regex and regenerated `docs/PERMISSION-MATRIX.md`
  (`finance_head` 4→38, `finance_clerk` 4→34).
- **D8 — `ops.bi/homework` UI.** Added `apiBiHomework` + a "Homework completion" tab to `/reports`.

**Phase 1 — verified against the current code; the map was stale on most of it**
- **L2 — DONE (already).** `ops/cron/schoolos.cron` is a committed schedule; pollers (outbox-worker,
  comms-dispatcher, webhook-worker, workflow-worker) are compose services. `ops-deploy.test.js` enforces
  the "every CLI worker is scheduled" invariant.
- **L9 — DONE (already).** `comms-dispatcher.js` claims with `FOR UPDATE SKIP LOCKED`, **commits and
  releases before any provider call** (`tick()`, comment at :302) — no locks held across the network.
- **L10 — DONE (already).** `outbox-worker.js` parks on `parked_at` and leaves `processed_at` NULL, so
  "logged" is no longer recorded as "delivered".
- **L8 — DONE (already).** Fee dunning lives in `dunning-reminders.js`, run by `day-worker.js` step 4.
- **L3 — DONE (already).** Absence notices are queued at `POST /attendance/mark` (routes.js).
- **L7 — DONE (already).** PTM invites queue the `ptm.invite.v1` template on booking
  (`teacher.support/index.js:737`).
- **L4 — DONE (implemented).** New `server/scripts/homework-reminders.js` — a cron-able sweep (exported
  `runHomeworkReminders`, quiet hours, dedup `homework:<kind>:<homeworkId>:<studentId>`) that queues
  guardian reminders for homework due in 24h and nudges non-submitters of work overdue in the last 7 days.
  Matches `class_grade` as grade or `grade-section`. Scheduled at **16:30 IST weekdays** in
  `ops/cron/schoolos.cron` — deliberately NOT in `day-worker` (which runs at 03:05 IST, inside quiet
  hours, so the guard would skip it every night). **Verified:** ran against the dev DB with a staged
  Meridian `6-A` homework → `queued: 25`; temp rows cleaned up. Committed integration test still to add.
- **L1 — code present, blocked on credentials (owner).** `rails.email` speaks SMTP, `rails.sms` /
  `rails.whatsapp` speak `http-generic`; delivery is `provider='logger'` until per-school credentials
  exist (`D-32`).
- **L5 — DONE (implemented).** `POST /actions/:id/decide` now inserts a **targeted** `app.notifications`
  row for the requesting teacher on both approve and decline (`routes.js`, after the generic task
  branch; `execution.type='leave_outcome_notification'`). The generic branch only wrote a *school-wide*
  `needs-you` row, which never reached the teacher as their own result. **Verified:** synthetic
  `teacher.leave.*` action decided by the coordinator → execution `leave_outcome_notification` and a
  `user_id`-targeted notification row (cleaned up).
- **L6 — OPEN.** Substitution decisions exist (`POST /coord/substitution/decide`) and
  `ops.timetable/substitutions/suggest` exists, but the **handover packet** on leave approval is not
  wired. This needs a design decision (what the packet contains, which periods, who receives it).

**Verified:** `tsc -b` clean · oxlint clean · vitest 11/11 (incl. the new gate) · browser: 7 labels
render, live student profile resolves, Reports homework tab renders (door 409s honestly because
`ops.bi` is off for the Meridian demo).

**DISCOVERED while verifying (pre-existing, not from Phase 0)**
- **X1 · `403 GET /plugins/library/overdue` for the owner.** A sidebar/widget calls the library overdue
  door as the owner, who holds `/library` but not the librarian desk's overdue door, so it 403s on
  every staff screen. Fix: gate the widget on `useRoleOrGrant`/`canSurface` so it only mounts for the
  librarian (or map it to a surface the owner holds). Evidence: browser run 2026-09-19; door gated in
  `server/src/plugins/library/index.js` (overdue is librarian-desk scope).

**NEW DIRECTIVE — remove the campus concept (separate sites = separate schools)**
- **Decided:** a school is **one site**. There are no campuses; a second site is a **separate tenant**.
  The `campus` in `entitlements.js` is a **billing-plan name**, not the campus concept — kept.
- **Phase A — DONE (provisioning + UI).** `onboarding.js` no longer accepts/updates `config.campuses`
  (`/onboard/school`); `seed.js` meridian config drops `campuses`; `onboardingApi.apiOnboardSchool` drops
  the field; the Settings "Campuses" card + "Add campus" are removed and the copy no longer says
  "across all campuses". New schools are born single-site; `app.js` already defaults a non-demo tenant to
  one site (`ownCampus` fallback).
- **Phase B — OPEN (the demo/UI sweep, ~624 occurrences across 35 files).** Remove `CampusId`/`Campus`
  from `types/domain.ts`; remove `campuses` + campus helpers (`campusWorkOrders`, `recommendTechnicians`,
  `maintAnalytics`, …) from `data/dataset.ts`; remove `campusScope`/`activeCampus`/`ROLE_CAMPUS` from
  `state/store.tsx`; sweep campus filters/labels from the ~35 screens; update `server/src/generated/*`
  demo data and `app.js`'s `ownCampus` block. This is a dedicated refactor — do it with `tsc` as the
  worklist, not piecemeal.

**F1 ORG-MODEL DECISION (production + security)**
- **Subjects now, not later.** Ship `classes`, `sections`, `subjects`, `teaching_assignments` in ONE
  migration with real FKs. Reason: free-text `grade`/`section`/`subject` is the root cause of the
  scoping/least-privilege defects (`PERFECT-100 §3`, `DAT-22`); adding the model once keeps the FK graph
  coherent and avoids a second migration. UI can roll out incrementally.
- **Bind the roster.** Add nullable FK columns to `app.students` → backfill from the text columns →
  enforce `NOT NULL`, keeping the text columns as a denormalized cache during transition. Reason: a
  server-enforceable class/section scope is what makes least privilege real; text matching is not.
- **No campus dimension** anywhere in the model (per the directive above).

**REMAINING (not started — Phases 1–5)**
L1–L10 (delivery + workers), F1–F5 (foundation), M2–M4 (live keys, maker-checker ceilings, refund
races), D1–D7/D9 (domains), P1–P5 (platform). These are multi-week and several are blocked on
**owner actions** (provider credentials, DR/offsite, pentest). See the board below.

---

## Summary board

| ID | Item | Pri | Effort | Phase |
|---|---|---|---|---|
| T1–T10 | Label or wire the 10 unlabelled demo screens | P0 | S–M | 0 Trust |
| T11 | CI guard: no unlabelled seed data on a live-looking screen | P0 | S | 0 |
| L1 | Real outbound delivery (email rail + SMS/WhatsApp adapters) | P0 | L | 1 Loops |
| L2 | Schedule the workers (cron + heartbeats) | P0 | M | 1 |
| L3 | Absent-student alert worker | P0 | M | 1 |
| L4 | Homework digest + non-submission reminder | P1 | M | 1 |
| L5 | Leave-approved notification | P1 | S | 1 |
| L6 | Substitution proposal + handover packet | P1 | M | 1 |
| L7 | PTM invite channel | P2 | S | 1 |
| L8 | Dunning ladder (fee reminders) | P1 | M | 1 |
| L9 | Dispatcher: stop holding row locks across network calls | P1 | S | 1 |
| L10 | Outbox/relay semantics: "logged" ≠ "delivered" | P1 | S | 1 |
| F1 | Organisation model: classes / subjects / teaching_assignments | P1 | L | 2 Foundation |
| F2 | Make grade/section/subject real references | P1 | M | 2 |
| F3 | Student login identity (`users.student_id`) | P1 | M | 2 |
| F4 | Server-side campus scoping | P2 | M | 2 |
| F5 | Delete ~111 hard-coded role arrays; drive from `/me/effective` | P1 | M | 2 |
| M1 | Fix `finance_head` / `finance_clerk` door gating | P1 | S | 3 Money |
| M2 | Live gateway keys + settlement reconciliation | P1 | L | 3 |
| M3 | Maker–checker + amount ceilings / second approver | P1 | M | 3 |
| M4 | Refund / partial-refund edge cases + money-race tests | P1 | M | 3 |
| D1 | Maintenance doors: inspections, preventive, inventory, vendors, map, intelligence | P1 | L | 4 Domain |
| D2 | Transport: ridership / ETA / boarding + analytics | P2 | L | 4 |
| D3 | Teacher/Parent/Student missing UIs (PRD-1…11) | P1 | L | 4 |
| D4 | Wire `Documents.tsx` to `files.store` | P2 | M | 4 |
| D5 | HR: unify staff+student leave + training | P1 | M | 4 |
| D6 | Automation runtime | P2 | L | 4 |
| D7 | Policy/constitution versioning door | P2 | M | 4 |
| D8 | `ops.bi/homework` UI | P2 | S | 4 |
| D9 | People console: teacher/staff/guardian roster doors | P2 | M | 4 |
| P1 | Email rail → signup verification + password reset | P1 | M | 5 Platform |
| P2 | Platform billing / subscription / quotas | P2 | L | 5 |
| P3 | PWA + push notifications | P2 | L | 5 |
| P4 | CI posture: full run, parity `--enforce`, artifact smoke | P1 | M | 5 |
| P5 | Observability/SLOs, DR/PITR/offsite, backups in cron | P1 | L | 5 |

---

## Phase 0 — Trust (P0)

The product's honesty law is already written: `SampleNote` (`app/src/components/ui.tsx:94`), "a
fabricated number must never read as the school's own record". Ten screens break it. This phase is the
highest impact per hour in the whole map.

| ID | Screen | Problem | Evidence | Fix |
|---|---|---|---|---|
| T1 | `AiUsage.tsx` | ₹ spend/budget/latency shown as measured, **zero disclaimer** | `seed.aiUsage` (`:20`) | Add `SampleNote`; or wire to `/ai/calls` + usage door |
| T2 | `Insights.tsx` | grid is seed; attendance card says "From live attendance records" | `:158`, `:182`, `:234` | Label seed cards; keep the one live stat clearly marked |
| T3 | `DataHealth.tsx` | "health score 94" + issue counts look measured | `seed.healthScore` (`:303`) | `SampleNote` at top; the deep copy is honest, the header is not |
| T4 | `Reception.tsx` | "Desk online", AI call log, answer times | `data/dataset` (`:10`), badge `:91` | Label; remove "online" until a door exists |
| T5 | `Next.tsx` | claims "recomputed from the live store" | `:128`, `:287` | Label; fix the trace wording |
| T6 | `CalendarScreen.tsx` | seeded year reads as the real calendar | `:62` | Label the seeded events; keep local-add honest copy |
| T7 | `Documents.tsx` | registry + expiry forecast look real | `:94` | Label now; wire in D4 |
| T8 | `CaseDetail.tsx` | case thread/SLA from seed; hardcodes tenant name | `:65`, `:104` | Label; use session school name |
| T9 | `PersonDetail.tsx` | **clicking a live student shows "Record not found"** | seed resolver `:54` vs live `People.tsx:92` | Resolve by live id (`apiStudent`), fall back to seed only for demo ids |
| T10 | `Attention.tsx` | derived signals from seed; header implies records | `:59`, `:415` | Label derived cards (chips already say "sample") |

- **T11 · Honesty gate (P0 · S).** Add a CI/lint check that flags a screen importing `data/dataset` or
  `demo/seedServices` without rendering `SampleNote` (or an explicit `data-live` marker). This is the
  guard that stops the class recurring.
- **Done-when:** no screen presents seed data as school records; the gate fails on regression.
- **Depends:** none. **Quick win:** T9 is a real bug — do it first.

---

## Phase 1 — Close the loops (P0/P1)

Today the system composes messages, records them, and delivers nothing (`provider='logger'`; no email),
and the workers that would fire alerts are never scheduled.

- **L1 · Real delivery (P0 · L).** Add an **email rail** and real provider adapters for
  `rails.sms` / `rails.whatsapp` (settings schemas already name gupshup / meta_cloud_api). Stop
  counting the logger path as delivered. Evidence: `HANDOFF §8`, `DATA-FLOW §43`. Done-when: a real
  message reaches a real inbox/phone in a sandbox. Depends: provider credentials (owner action).
- **L2 · Schedule the workers (P0 · M).** `dunning-reminders`, `reconcile-payments`, `outbox-worker`,
  `day-worker`, `retention-worker`, `health-probe` are standalone and **not cron'd** (`PROJECT-MAP
  §8c#24`; `ops/cron/schoolos.cron`). Add heartbeats + a missed-run alert. Done-when: every worker
  runs on schedule and a missed run alerts.
- **L3 · Absent-student alert (P0 · M).** `DEL-7`. On register mark → notify guardian. Done-when: a
  marked absence produces a delivered guardian notice.
- **L4 · Homework digest + non-submission reminder (P1 · M).** `DEL-1`.
- **L5 · Leave-approved notification (P1 · S).** `DEL-2`.
- **L6 · Substitution + handover packet (P1 · M).** `DEL-3`. Ties to F1 (real classes).
- **L7 · PTM invite channel (P2 · S).** `DEL-5/6`.
- **L8 · Dunning ladder (P1 · M).** Fees already have the selectors (`fees/dunning.js`); wire the run
  to real delivery. Ties to M2/M5.
- **L9 · Dispatcher locks (P1 · S).** Don't hold row locks across network calls (`OPS-15`).
- **L10 · Honest outbox state (P1 · S).** `processed_at` means "logged", not delivered; `DAT-3`
  residual. Done-when: delivery state is truthful end to end.
- **Done-when:** a real absence, a real dunning reminder and a real leave approval each reach a real
  person, and the UI shows delivery truthfully.

---

## Phase 2 — Foundation (P1)

- **F1 · Organisation model (P1 · L).** Add `classes`, `subjects`, `teaching_assignments`; replace
  free-text `grade`/`section` and timetable `subject`/`teacher_name` strings. Evidence: `PERFECT-100
  §3`, `§6.2 item 9`. This is the root cause behind the register 403s, the librarian/safeguarding scope
  gaps, and hand-built least privilege. The new `/classes` editor (just shipped) is the first brick.
- **F2 · Real references (P1 · M).** Backfill `students.grade/section` → class/section ids; keep a
  compatibility view during transition. Done-when: no free-text grade/section in new writes.
- **F3 · Student identity (P1 · M).** `app.users.student_id` + link; retire name-match resolution
  (`DAT-22`; 375 students / 76 names). Done-when: student login resolves to exactly one student.
- **F4 · Server campus scoping (P2 · M).** Campus is client-only today (`PROJECT-MAP`). Done-when:
  server filters by campus.
- **F5 · One role source (P1 · M).** Delete the ~111 per-screen role arrays; drive nav/screens from
  `/me/effective` (`FEX-4`, `FEX-6/7`; two role sources remain). Done-when: no hand-coded role list
  outside `lib/roles.ts` + effective-access.
- **Done-when:** least privilege is expressible from real structure, student identity is unambiguous,
  campus is server-enforced.

---

## Phase 3 — Money (P1)

- **M1 · Fix finance role gating (P1 · S).** `finance_head` and `finance_clerk` reach only **4
  `ops.bi` reads** in `docs/PERMISSION-MATRIX.md`; the fee doors are gated to `finance`. Add the
  maker/checker roles to the fee doors so the intended SoD works. Evidence: permission matrix +
  `docs/FEES-PERFECT-100.md` (maker-checker intent). **Quick win.**
- **M2 · Live gateway + reconciliation (P1 · L).** Wire real UPI/Razorpay keys; automate settlement
  import/reconcile. Depends: credentials (owner action).
- **M3 · Maker–checker + ceilings (P1 · M).** Amount ceiling + second approver (`RBAC-5`).
- **M4 · Refund edges + races (P1 · M).** Double-refund guard, partial refund (`refunded_cents`),
  money-race tests (`FEX-15`).
- **Done-when:** maker-checker usable via doors; a live payment round-trips; no double-refund.

---

## Phase 4 — Domain build-outs (P1/P2)

- **D1 · Maintenance (P1 · L).** Six unbuilt doors: inspections, preventive, inventory, vendors, map,
  intelligence (`Inspections.tsx:26`, `Preventive.tsx:26`, `MaintInventory.tsx:26`, `MaintVendors.tsx:27`,
  `MaintMap.tsx:26`, `MaintIntelligence.tsx:27`). Purpose-built, not generic forms (see `MAY_BE_IDEAS §8`).
- **D2 · Transport (P2 · L).** GPS feed only; add ridership, ETA, boarding, route analytics
  (`Transport.tsx` is seed-only, `:281`).
- **D3 · Teacher/Parent/Student UIs (P1 · L).** Doors exist and are tested; the screens are missing:
  concerns/safety-box/doubts/interventions/PTM (`PRD-1`), lessons (`PRD-2`), duty roster/workload
  (`PRD-3`), copilot UI (`PRD-4`), parent PU-2 flows (`PRD-5`), student learn lane (`PRD-6`),
  wellbeing filing (`PRD-7`), print payload (`PRD-8`), orphaned teacher insights (`PRD-9`), family-home
  actions/brief (`PRD-10`), department/class analytics (`PRD-11`).
- **D4 · Documents registry (P2 · M).** Wire `Documents.tsx` to `files.store`; also unblocks the
  Report Desk Library (`MAY_BE_IDEAS §1 gap 7`).
- **D5 · HR (P1 · M).** Unify staff+student leave (`MAY_BE_IDEAS §7`) + training/appraisals.
- **D6 · Automation runtime (P2 · L).** Workflows can't execute (`Automation.tsx:176`).
- **D7 · Policy versioning (P2 · M).** Constitution is read-only (`Constitution.tsx:99`).
- **D8 · `ops.bi/homework` UI (P2 · S).** Endpoint exists, no screen. **Quick win.**
- **D9 · People non-student tabs (P2 · M).** Teacher/staff/guardian rosters stay empty
  (`People.tsx:339`); add doors.
- **Done-when:** every surface is live or honestly empty; no demo-only screen remains.

---

## Phase 5 — Platform / commercial (P2)

- **P1 · Email rail → verification + reset (P1 · M).** No email anywhere; reset is 503 by
  construction (`HANDOFF §13`). Depends: L1 rail.
- **P2 · Billing/quotas (P2 · L).** No subscription/quota plane.
- **P3 · PWA + push (P2 · L).** Parents/teachers are mobile-first.
- **P4 · CI posture (P1 · M).** Full `migrate → bootstrap → seed` + compose boot, parity `--enforce`,
  artifact smoke (`OPSX-11/12`, `OPS-14`); regenerate `docs/VERIFICATION.md` from the runner.
- **P5 · Ops (P1 · L).** Alerting/SLOs, DR/PITR/offsite, backups in real cron + a rehearsed restore
  (`OPS-7`, `OPSX-10`).
- **Done-when:** deployable, billable, observable, restorable.

---

## Cross-cutting laws (every phase must hold)

- Empty-world, server-truth, audit-before-send, RLS, UI-only, docs, test laws (`HANDOFF §7`).
- **Pipeline verification law** (`PERFECT-100 §9.1`): route grant/policy tightening through
  `grant-tightening.js` / seed re-apply, or a later stage re-opens it.
- **Closure law** (`.coop/status/HANDOFF-2026-09-17.md`): never mark CLOSED without pin/mutation
  evidence.
- **Vacuity gate** (`tests/test-hygiene.test.js`): don't weaken assertions to go green.
- **Honesty gate** (new, T11): no unlabelled seed data on a live-looking screen.

---

## Critical path & dependencies

```
Phase 0 (trust)            ── independent, do now
Phase 1 (delivery)         ── needs provider creds (owner) for real send; adapters buildable without
        └─ P1 email rail   ── unblocks signup verification + password reset
Phase 2 (foundation)       ── F1 org model blocks D3 (teacher/parent/student) and F4 (campus)
Phase 3 (money)            ── M1 independent (quick); M2 needs gateway creds
Phase 4 (domains)          ── D1/D2/D3 largely independent once F1 lands
Phase 5 (platform)         ── P1 after L1; P4/P5 independent
```

## Owner actions (non-code, unblock the rest)

- Rotate `server/.env` secrets; wire provider credentials (SMS/BSP/SMTP/gateway) — the only true human
  dependency (`D-32`).
- Schedule backups in real cron + one rehearsed restore; PITR/offsite decision (`OPS-7`/`OPSX-10`).
- External pentest (library E5, fees).
- Set `SELF_SIGNUP_ENABLED` in production; never ship the dev `.env` (`OTP_DEV_ECHO=1`).
- Run the one-time superuser ACL revoke (`ALTER DEFAULT PRIVILEGES … REVOKE ALL … FROM schoolos_app`).

## Quick wins (<1 day each)

T9 (live student 404), T1/T3/T4/T5 labels, M1 (finance gating), D8 (`ops.bi/homework` UI), T11 (honesty
gate), regenerate `docs/PERMISSION-MATRIX.md` after M1.
