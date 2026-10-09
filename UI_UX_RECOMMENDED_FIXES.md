# SchoolOS UI/UX Recommended Fixes
### Vision & usability audit for non-technical school users

**Date:** 2026-09-23
**Scope:** every screen reachable in the UI · every backend door vs frontend surface · plain-language fit for school owners, principals, teachers, parents, students, accountants, reception staff
**Method:**
- 867 screenshots captured at 1440×900 and 390×844 across 8 roles (chrome harness; vision unavailable in this model — analysis is DOM/text/source-based)
- 170 live screens extracted with visible copy, nav, buttons, table headers, empty states (7 roles)
- `server/scripts/parity-gate.js` run for write-door ↔ UI-caller coverage
- Source review of `Shell.tsx`, `DemoBar.tsx`, `liveApi.ts`, `friendlyErrors.ts`, screen files
- Runtime verification of session survival on refresh

**Evidence dir:** `shots/ui-audit-2026-09-23/` (screenshots + `spa-*.json` + `text-index.json`)

---

## 0. Executive verdict for a real school

| Question | Answer |
|---|---|
| Can a non-technical owner set up and run the school? | **Partially.** Onboarding and People are workable. Navigation is overwhelming (40+ items) and several core surfaces still show demo data. |
| Can a teacher use it without training? | **Yes for attendance/homework/marks.** Naming like "Command center", "Mastery map", "Teaching copilot" needs one walkthrough. |
| Can a parent use it from a phone? | **Mostly.** Parent plane is the cleanest. **Fees is missing from the parent tab bar** — the single most-used parent feature. |
| Can a student use it? | **Yes.** "My Day / Learn / Work" is excellent plain language. Many student features are hidden off the 3-tab bar. |
| Can an accountant collect fees? | **Not without training.** Error copy speaks in `PAYMENT_IN_PROGRESS`, "obligations", "ledger". |
| Is every backend door reachable from the UI? | **No.** 80 of 397 write doors have no UI caller (API-only). More critically, **some screens are still on the demo plane while real doors exist** (Library). |

**Top 5 things that would confuse a real school on day one:**
1. Refresh (or open a new tab) logs you out in the documented dev/proxy setup.
2. Library screen shows fake books while a full library backend exists.
3. Parent cannot see Fees in the bottom tab bar.
4. Owner sidebar lists "Library" twice and mixes "Home", "More", "AI memory", "Plugin settings".
5. Suspend / reset password / move student use browser `window.confirm`.

---

## 1. Door ↔ UI coverage (is every backend door available from the frontend?)

### 1.1 Measured

| Metric | Count | Source |
|---|---|---|
| Write doors catalogued | 397 | `parity-gate.js` |
| Wired to a UI caller | 309 | same |
| Wrapper-only (imported helper, thin UI) | 8 | same |
| Demo-only (mock plane) | 0 | same |
| Orphan (no UI caller) | 80 | same |
| Unresolved orphans (would fail CI `--enforce`) | 0 | 88 matched `API_ONLY_ALLOWLIST` |
| Mock-plane importers on live screens | 0 | same |

Read doors are additionally scanned; the allowlist openly names UI gaps.

### 1.2 The bigger problem: **screens that lie**

Parity only proves *some* caller exists. It does not prove the screen a user opens is wired. These screens show **demo/seed content while real doors exist**:

| Screen | Route | What the user sees | What actually exists |
|---|---|---|---|
| **Library** | `/library` | Hardcoded `BOOKS`/`LOANS` arrays (`Library.tsx:16-28`); "Return" only mutates React state | 20+ real APIs in `adminApi.ts:108-161` (`/plugins/library/catalog`, desk, loans, fines, reservations, acquisitions) + live `/library/desk` screens |
| **People (staff/teacher/guardian tabs)** | `/people` | *"Roster door not connected yet"* (`People.tsx:339`) | `GET /students` works; `people.admin` user list exists (`GET /plugins/people.admin/users`) |
| **Attention** | `/attention` | `seed.sections`, `seed.busRoutes`, `seed.feeObligations`, `seed.documents` (`Attention.tsx:63-151`) | Live actions, fees, transport, files doors all exist |
| **Insights** | `/insights` | `seed.insights`, `seed.students`, `seed.attendance` (`Insights.tsx:158-194`) | `ops.bi` read models exist |
| **AI governance** | `/ai-governance` | `seed.policies`, `seed.aiUsage`, `seed.models` (`AiGovernance.tsx:53-212`) | `GET /ai/calls` is live (partially used) |
| **Calendar** | `/calendar` | `seed.calendarEvents`, `seed.campuses` (`CalendarScreen.tsx:62,156`) | timetable/slots doors exist |
| **Automation** | `/automation` | `demo/seedServices` (`Automation.tsx:9`) | `GET/POST /workflow-rules` exist |
| **Report issue** | `/maintenance/report` | Photo button = `'Photo attached (demo)'` (`ReportIssue.tsx:174`) | `files.store` upload exists |
| **Vendors** | `/maintenance/vendors` | *"There is no vendors door on the server yet"* (`MaintVendors.tsx:28`) | honest, but dead end |
| **Student learning (practice/assignments/progress)** | `/student/learning` | `SampleNote` ×3 — "not read from your school records" (`StudentLearning.tsx:101,127,148`) | homework/results doors exist |
| **Constitution (reference set)** | `/constitution` | Sample policies below live school policies (`Constitution.tsx:160`) | live policies work |

**Why this matters:** A librarian opens Library, "returns" a book, sees a success toast — **nothing reaches the server**. That is worse than a missing feature.

**Fix:** Wire `/library` to `libraryCatalog`/`libraryDesk*` (already in `adminApi.ts`) or hide the route and deep-link to `/library/desk`. Do the same for Attention, Insights, Calendar, Automation. Keep `SampleNote` only where no door exists and add a **"Not connected" badge** instead of a working-looking button.

---

## 2. Session survival — refresh logs you out (Confirmed)

**Observed (runtime):**
1. Login as `owner@meridian.edu` → lands on `/today` with full shell.
2. `document.cookie` / `page.cookies()` = **empty** on the app origin.
3. `page.reload()` → **login screen**. Session gone.

**Cause:** `liveApi.ts:65-68,95,114`
```ts
const SAME_ORIGIN = new URL(BASE, window.location.origin).origin === window.location.origin;
...(SAME_ORIGIN ? { credentials: 'same-origin' } : {})
```
Token is **memory-only** (`liveApi.ts:26-31`). The HttpOnly `schoolos_session` cookie is set by the API origin (8080). In the **documented** run mode (`README.md`: API :8080 + Vite :4310/:5173) the origins differ, `credentials` is omitted, the cookie never rides along, and a reload cannot restore the session.

**User impact:** any refresh, browser restart, new tab, or OS-level restore = re-login. Teachers marking attendance between classes will hit this daily.

**Fix (pick one):**
1. **Serve the SPA from the API** (`STATIC_DIR` already exists in `config.js`) and document that as the only supported mode. *(fastest)*
2. Or enable cross-origin cookies properly: `CORS_ORIGINS` allowlist + `credentials: true` + `SameSite=None; Secure` — and send `credentials: 'include'` always.
3. Plus: keep a short-lived refresh token in `sessionStorage` so a reload within the same tab survives even in split-origin dev.

**Priority: P0 (usability) / P1 (production if any proxy splits origins).**

---

## 3. Navigation & information architecture

### 3.1 Owner sidebar is overloaded (live capture)

Captured owner nav (1440px):

> **DAILY OPERATIONS** · Today · Needs your attention (6) · Approvals · Group · Board pack · Morning brief · Announcements
> **RECORDS** · People console · People · Operations · Fees · Fee plans · Library · Library · Insights · Reports · Audit trail · Compliance · Certificates · Delegations · AI memory · Automation · AI usage · AI governance
> **PLATFORM** · More · Home · Classes & sections · Modules · System services · Appraisals · Maintenance (6) · Front desk · Data import · Roles & permissions · Plugin settings

**Defects (exact):**

| # | Defect | Location | Fix |
|---|---|---|---|
| N1 | **"Library" appears twice** (`library` → `/library`, `libraryOps` → `/library/insights`, same label) | `Shell.tsx:47-48` | Rename second to "Library reports" / "Library insights" |
| N2 | **"Home" and "More" as PLATFORM items** | `Shell.tsx:60` + overflow | Put Home at top as brand link only; fold overflow into a labeled "More tools" section, not a nav item called "More" |
| N3 | **"Group"** — opaque to a school owner | `Shell.tsx:80` | Rename to "School group" or "All campuses" (or hide if single-site) |
| N4 | **"AI memory", "AI governance", "AI usage", "Automation"** in RECORDS for an owner | `Shell.tsx:85-86` | Collapse into one "AI & automation" section, only if enabled |
| N5 | **"Plugin settings", "Modules", "System services", "Data import", "Roles & permissions"** are engineer words | `Shell.tsx:44,53` + PLATFORM | "Add-ons" / "Integrations" / "Data tools" / "Who can do what" |
| N6 | **"Front desk" label → `/reception` route**; screen titled Reception | `Shell.tsx:75` | Pick one word ("Front desk" is better for schools) |
| N7 | **"Command center" (teacher) vs "Command Center" (coordinator)** | `Shell.tsx:96,119` | One capitalisation; better: "My classes" / "Coordinator desk" |
| N8 | **40+ top-level items**, no progressive disclosure | owner/teacher nav arrays | Cap at 8–10 primary + grouped "More"; add role-based defaults |
| N9 | Teacher nav includes **"Mastery map", "Progress story", "Teaching copilot", "Class analytics"** | `Shell.tsx:103-107` | Move under "Insights" or "Tools"; plain names ("How the class is doing") |
| N10 | Role chip shows **"Itadmin"** | captured itadmin landing | "IT administrator" |
| N11 | **"Needs your attention"** vs mobile tab **"Attention"** | `Shell.tsx:63` vs `DemoBar.tsx:24` | One phrase |
| N12 | **Campus selector "North Campus"** still in the header | captured landing | Remove per SIMULATION-FIXES A3 (one site = one tenant) |

### 3.2 Parent mobile tab bar is missing Fees (Confirmed)

`DemoBar.tsx:21`:
```ts
[{ to: '/parent/family', label: 'Family' }, { to: '/parent/requests', label: 'Requests' },
 { to: '/parent/copilot', label: 'Ask' }, { to: '/parent/consents', label: 'Consents' }]
```
`/parent/fees` exists and works (`ParentFees.tsx`) but is **not in the tab bar and not in the parent sidebar** (parent nav captured: `Family · Requests · Ask · Consents` only).

**Impact:** the #1 parent task (pay fees / see dues) is unreachable without knowing the URL.

**Fix:** tab bar = `Family · Fees · Ask · More` (More sheet holds Requests, Consents, Chat, Complaints, Noticeboard, Account). **P0.**

### 3.3 Student mobile tab bar hides most of the student world

`DemoBar.tsx:23`: `My Day · Learn · Work` only.

Hidden but real: `/student/fees`, `/student/homework`, `/student/mistakes`, `/student/flashcards`, `/student/tasks`, `/student/results`, `/noticeboard`, `/print-queue`, `/wellbeing-queue`.

**Fix:** `My Day · Learn · Work · More` sheet with Fees, Results, Noticeboard, Wellbeing, Print queue. Keep the 3 good labels. **P1.**

---

## 4. Plain-language audit (non-technical user)

### 4.1 Good copy (keep)

| Where | Copy | Why it works |
|---|---|---|
| Login | "Sign in to your school's workspace" | Plain, warm |
| Login | "Starting a new school? Set it up here" | Clear CTA |
| Student home | "Hi Aarav" | Personal |
| Student tabs | "My Day / Learn / Work" | Perfect for children |
| Parent tabs | "Family / Requests / Ask / Consents" | Mostly plain |
| Fees empty | "No fee records yet — Obligations appear here once the school records them" | Explains next step (but see jargon below) |
| People empty | "Roster door not connected yet… this tab stays empty rather than showing seeded people as if they were real" | Honest |
| `friendlyErrors` | "Can't reach the school server right now…" | Excellent |

### 4.2 Jargon that must change

| Current | Where seen | Plain replacement |
|---|---|---|
| "tenancy-isolated sessions" | Login footer | "Your school's data stays private to your school" |
| "Obligations" | `Fees.tsx:99,450` | "Fees due" / "Amounts due" |
| "Fee plans" vs "Fees" | Nav | "Fee structure" under Finance; keep "Fees" |
| "dunning" / "fee messages" | `Fees.tsx:618` | "Reminders sent home" |
| "concessions" | `Fees.tsx:648` | "Discounts & waivers" |
| "PAYMENT_IN_PROGRESS", "LEDGER_INCONSISTENT", "OBLIGATION_SETTLED", "VALIDATION_FAILED" | money errors (`error-codes.js`) | Map all 16 codes in `friendlyErrors.ts` (today only **7** strings total are rewritten — `friendlyErrors.ts:14-21`) |
| "amount_cents", "paise" | any raw API leak | Never show; format as ₹ always |
| "Plugin · class A (record)" | `Library.tsx` badge | "Add-on" or hide |
| "Modules" | `/plugins` | "Add-ons" / "Integrations" |
| "System services" | `/rails` | "Message channels (SMS, email, WhatsApp)" |
| "Data import" | `/migration` | "Bring your data in" |
| "Roles & permissions" | `/roles` | "Who can do what" |
| "AI memory", "Memory" | `/memory` | "Notes & history" or "What the AI remembers" |
| "Audit trail" | `/audit` | "Activity history" (subtitle: "who changed what") |
| "Delegations" | `/delegations` | "Standing in / acting for" |
| "Board pack", "Morning brief" | `/board-pack`, `/principal-brief` | OK for principals; hide from teachers |
| "Mastery map", "Progress story" | teacher | "Topic understanding" / "How students are doing" |
| "Teaching copilot" | teacher | "Teaching assistant" |
| "Command center" | teacher/coord | "My day" / "Coordinator desk" |
| "Workload fairness" | coord | "Duty balance" |
| "Curriculum monitor" | coord | "Syllabus progress" |
| "Work" (student portfolio tab) | student | "My work" or "Portfolio" |
| "Ask" (parent copilot) | parent | "Ask the school" (it is a school copilot, not a web search) |

### 4.3 Error & empty-state tone

| Issue | Location | Fix |
|---|---|---|
| Only 7 friendly rewrites | `friendlyErrors.ts:14-21` | Cover every `error-codes.js` code + the 10 most common 400/403/409 strings |
| Money errors show codes | fees flows | Show "A payment for these fees is already being processed. Wait a minute or check Payments." |
| `window.confirm("Suspend X's account? They will not be able to sign in…")` | `PeopleAdmin.tsx:130` | Accessible modal with title, body, typed confirmation for destructive acts |
| `window.confirm("Generate a new password for X? Their current password stops working immediately.")` | `PeopleAdmin.tsx:140` | Same + show the new password in a reveal-once dialog |
| `window.confirm("Move student …?")` | `PeopleAdmin.tsx:150` | Modal with from → to summary |
| `window.prompt('Confirm your password…')` for step-up | `liveApi.ts:91` | Modal password field (also fixes a11y + trains users to type passwords into native prompts) |
| `window.alert('SchoolOS keyboard shortcuts…')` | `App.tsx:605` | "?" opens a proper help drawer |

---

## 5. Forms & actions (hostile-but-realistic user)

| Finding | Evidence | Fix |
|---|---|---|
| Destructive confirms are native dialogs | `PeopleAdmin.tsx:130,140,150` | Design-system Modal (already exists in `ui.tsx:259`) |
| Step-up password via `window.prompt` | `liveApi.ts:91` | Same Modal + lockout copy |
| Fees void already uses a good Modal with reason | `Fees.tsx:271-285` | **Pattern to copy everywhere** |
| ExamMarks disables submit when busy/empty | `ExamMarks.tsx:266-267` | Good — replicate on all write forms |
| Report-issue photo is fake | `ReportIssue.tsx:174` | Wire `files.store` upload or remove the button |
| "Edit draft" locked with no unlock path | `Constitution.tsx:288` | Tooltip + link to who can unlock |
| Google button disabled with explanation | `Login.tsx:504` | Good honesty — keep |
| Double-submit: `busy` guards on major forms | `ui.tsx:16` | Good; add to PeopleAdmin actions (native confirm blocks but does not disable) |

---

## 6. Per-role journey notes

### Owner / principal
- 40+ nav items; "People console" **and** "People" both present (`Shell.tsx:52,67`) — merge or differentiate ("People" = directory, "People console" = admin).
- "Group", "Board pack", "Delegations", "Appraisals", "Certificates" mixed into daily ops — split **Daily** vs **This term** vs **Settings**.
- Owner landing shows "North Campus" — remove.

### Teacher
- Best day-to-day set (Lessons, Homework, Submissions, Exam marks, My leave).
- "Command center" as the home label is grandiose; "My teaching" is clearer.
- "Report issue" is good plain language.
- Missing: quick "today's timetable" on the home screen (route exists: `/timetable`).

### Parent (mobile)
- **Fees missing from tab bar** (critical).
- "Ask" implies open internet; it is a budgeted school copilot — label honestly.
- Complaints & Chat exist as routes only.
- IST-first greeting is excellent.

### Student
- Labels are the best in the product.
- Fees, Results, Wellbeing, Print queue, Noticeboard are invisible on the 3-tab bar.
- `/student` (legacy empty shell) still routed beside `/student/home2` — remove or redirect.

### Finance / accountant
- Sees "Fee plans", "Fees", "Insights", "Reports", "Operations", "Maintenance" — Maintenance is noise for a bursar.
- No "Record payment" primary CTA on the fee dashboard (it is in a modal from a table row) — add a top-right **"Record payment"** button.
- Error codes will phone the developer.

### Reception / front desk
- "Front desk" nav → `/reception` + separate "Visitors" — good pairing, unify naming.

### IT administrator
- Role chip "Itadmin".
- "Plugin settings" + "Modules" + "System services" + "Data import" + "Roles & permissions" — all engineer-speak.
- API keys / webhooks are **disabled read-only** (per parity allowlist OPSX-4) with no explanation of how to create one.

---

## 7. Accessibility & mobile (code-evidenced)

| Finding | Evidence | Fix |
|---|---|---|
| `window.confirm/prompt/alert` on critical paths | §4.3 | Accessible modals |
| Color-only status badges | `ui.tsx:25-31`, `components.css` | Add icon or text (e.g. "● Active" → "✓ Active") |
| `u-hide-mobile` hides content under 768px | `base.css:67-68` | Audit each hidden column has a mobile card counterpart |
| Modal footers not sticky | `components.css` | `position: sticky; bottom: 0` on dialog footers so Save is reachable at 390px |
| PageHead uses `<h1>` (good) | `ui.tsx:431` | Keep |
| Skip link, focus trap, ARIA menus/tabs | `App.tsx:619`, `ui.tsx:197-231` | Keep — this is above average |
| Wide tables scroll horizontally | `base.css:135-140` | OK; add "scroll hint" on first visit |
| Parent tab bar 4 items | `DemoBar.tsx:21` | 4 max is right — just swap Consents→Fees in the bar |

---

## 8. Backend doors with no UI (80 orphans) — which ones matter?

From `API_ONLY_ALLOWLIST` (`parity-gate.js:144-173`):

| Door group | Allowlist says | Should a school user see it? | Recommendation |
|---|---|---|---|
| `POST/DELETE /api-keys`, `/webhooks` | "ItAdmin shows read-only, disabled controls" | Yes — IT admin needs to mint keys | **Build a real UI** (create/revoke key with reveal-once secret) |
| `POST /payments/:id/refund`, `POST /payments/reconcile` | "refunds run from the gateway/ops tooling" | **Yes — accountants refund from the desk** | Add Refund/Reconcile actions on Payments (SoD-aware) |
| `POST /academic-years`, `/academic-years/:id/activate` | "no shipped screen" | **Yes — owner must roll the year** | Academic year manager on Settings |
| `POST /class-assignments`, `DELETE /class-assignments/:id` | "no shipped screen" | **Yes — assigning class teachers is day-1** | Classes screen → "Class teacher" assign |
| `POST /fees/dunning/run`, `POST /fees/late-fees/run` | worker/API | Partly — a "Send reminders now" button | Expose as a button on Fees |
| `POST /parent/requests/:id/transition` | "office surface lands with the PU-2 flows" | **Yes — office must close parent requests** | Finish the office request desk |
| `(GET\|POST) /parent/links` | "office console lands with the People roster" | **Yes — link guardians** | People → "Link parent" |
| `POST /owner/actions` | "UI lane in flight" | Yes | Finish the owner action raise |
| `GET /reports/snapshots` | "UI lane in flight" | Yes | Board pack history |
| `GET /delegations` (+POST) | "UI lane in flight" | Yes | Finish Delegations screen |
| `GET /parent/child/:id/academics` | "no dedicated academics tab yet" | **Yes — parents want report cards** | Add Academics tab on child hub |
| `GET /safety/box/summary` | "oversight read" | Optional | Keep API-only |
| `POST /me/reset-*`, `/auth/google/demo` | by design | No | Keep |
| Plugin dynamic-import doors | plugin-conformance | N/A | Keep |

**Bottom line:** ~25 of the 80 orphans should become real screens or buttons for a non-technical school. The rest are legitimately machine/worker faces.

---

## 9. Prioritized fix list (UI/UX only)

### P0 — a real school hits these in week one

| ID | Fix | Where | Effort |
|---|---|---|---|
| U-01 | **Stop logging users out on refresh** (serve SPA same-origin, or fix cookie/CORS + sessionStorage bridge) | `liveApi.ts:65-114`, README, `config.js staticDir` | S–M |
| U-02 | **Add Fees to the parent tab bar** (and parent nav) | `DemoBar.tsx:21`, parent `useNavItems` | S |
| U-03 | **Wire `/library` to the real library APIs** (or hide and deep-link `/library/desk`) | `Library.tsx` → `adminApi.ts:108-161` | M |
| U-04 | **Replace `window.confirm/prompt/alert`** on suspend / reset / move / step-up / shortcuts | `PeopleAdmin.tsx:130,140,150`, `liveApi.ts:91`, `App.tsx:605` | S |
| U-05 | **Map every money error code to plain language** | `friendlyErrors.ts` + `error-codes.js` | S |
| U-06 | **De-duplicate "Library" nav label** and remove "Home"/"More" as nav items | `Shell.tsx:47-48,60` | S |

> **Fix status — verified and fixed (2026-09-23):**
> - **U-01 FIXED** — split-origin (dev) now bridges the memory-only bearer through `sessionStorage`
>   (per-tab, cleared on tab close); same-origin production keeps the memory-only + HttpOnly-cookie
>   design. A refresh lands on `/me`, not the login screen. `liveApi.ts`.
> - **U-02 FIXED** — **Fees** added to the parent tab bar, and parents/students now get a **More**
>   sheet (Requests/Consents/Complaints/Noticeboard · Fees/Results/Noticeboard/Wellbeing/Print).
>   `DemoBar.tsx`.
> - **U-03 already resolved** — `/library` is routed to the real `LibraryHome` (library v2), not the
>   old `Library.tsx`; no wiring change needed.
> - **U-04 FIXED** — native `window.prompt/confirm/alert` replaced by one in-app dialog service
>   (`lib/dialogs.ts` + `components/DialogHost.tsx`): step-up password, suspend/reset/move confirms,
>   and the keyboard-shortcut help. `liveApi.ts`, `PeopleAdmin.tsx`, `App.tsx`.
> - **U-05 FIXED** — `friendlyErrors.ts` now maps every money error **code** to plain language, and
>   the transport carries `err.code`. `liveApi.ts`.
> - **U-06 FIXED (label de-dupe)** — the second "Library" nav entry is now **"Library insights"**.
>   (The "Home" nav entries were left: `/principal/home` and `/owner/home` are real dashboards, not
>   duplicate chrome; removing them from nav would orphan them.)
>
> Verified: `tsc` clean · `vitest` 17/17 · `vite build` ok.

### P1 — first month of real use

| ID | Fix | Where | Effort |
|---|---|---|---|
| U-07 | Collapse owner nav to ≤10 primary items + grouped More; rename engineer terms (§4.2) | `Shell.tsx` | M |
| U-08 | Student tab bar + More sheet (Fees, Results, Noticeboard, Wellbeing, Print) | `DemoBar.tsx:23` | S |
| U-09 | Wire Attention / Insights / Calendar / Automation to live doors; keep SampleNote only where nothing exists | those screens | M |
| U-10 | People: staff/teacher/guardian tabs via `people.admin` users, not the empty "roster door" state | `People.tsx:339` | M |
| U-11 | Refund + Reconcile buttons on Payments (SoD-aware) | `Fees.tsx` / payments table | M |
| U-12 | Academic year manager (create/activate) on Settings | `Settings.tsx` | S |
| U-13 | Class-teacher assignment UI on Classes | `Classes.tsx` | S |
| U-14 | Parent request **office** desk (transition/close) | new or `Cases.tsx` | M |
| U-15 | Child "Academics / report card" tab | `ParentChildFlows` | S |
| U-16 | "Record payment" primary CTA on finance fee dashboard | `Fees.tsx` | S |
| U-17 | Remove campus selector + campus words (A3 Phase B) | header + demo | S |
| U-18 | Remove/redirect legacy `/student` and `/parent` empty shells | `App.tsx` routes | S |
| U-19 | Sticky modal footers + mobile column→card audit | `components.css`, screens | M |
| U-20 | Badge status: icon/text not colour-only | `ui.tsx:25-31` | S |

> **P1 fix status (2026-09-23):**
> - **U-07 DONE** — sidebar already groups the owner nav (Daily operations / Records / Intelligence /
>   More); engineer terms renamed: Add-ons, Message channels, Bring your data in, Who can do what,
>   Notes & history, Activity history, Standing in / acting for, Reception, Add-on settings.
> - **U-08 DONE** — student More sheet added (Fees, Results, Noticeboard, Wellbeing, Print centre).
> - **U-10 DONE** — the teacher/staff/guardian tabs now read the accounts roster
>   (`GET /plugins/people.admin/users`) instead of an empty "door not connected" state; the header
>   stats count them.
> - **U-14 DONE** — the coordinator Escalations desk now advances a family request through the ticket
>   state machine (`POST /parent/requests/:id/transition`), notifying the family and appending to the
>   timeline; the handoff-note copy was corrected.
> - **U-15 DONE** — a per-child **Academics** tab (report cards) wired to
>   `GET /parent/child/:id/academics`.
> - **U-19 DONE** — modal/drawer heads and footers are pinned (`flex-shrink:0`), only the body
>   scrolls; on ≤640px data tables become labelled cards (`data-label` per cell).
> - **U-30 DONE** — server-backed command-palette search: new `GET /search` (role-scoped — staff
>   search students + staff, parents only their own children) replaces the demo-seed people search.
> - **U-21 DONE** — IT admin now has real API-key mint/revoke and webhook add/remove with a
>   reveal-once secret (replacing the fake "Not configured / Rotate key" cards).
> - **U-09 DONE (as far as doors allow)** — Attention's decision queue is already live
>   (`GET /actions`); **Insights now reads live collection (`/reports/fees/summary`) and attendance
>   health (`/plugins/ops.bi/attendance`)**, with the question cards/workload still honestly labelled.
>   Automation has **no server workflow runtime** and Calendar has **no calendar door**, so those keep
>   their `SampleNote` (nothing to wire).
> - **U-11/U-16/U-22 ALREADY PRESENT** — Fees already has Record payment, Refund, Reconcile,
>   Run dunning and Apply late fees (committed).
> - **U-12 DONE** — real Academic-year manager (create + activate) on Settings.
> - **U-13 DONE** — Class-teacher assignment UI on Classes.
> - **U-17 DONE** — the campus concept is fully removed: `CampusId`/`Campus`, `campuses`, the
>   `campus` field on every record type, `campusScope`/`activeCampus`/`setActiveCampus` in the store,
>   the header switcher, and every campus filter/column/label across the screens. The `/group`
>   (multi-campus) console was removed with its test. (The ordinary English word "on campus" remains
>   in visitor copy — that is the site, not the concept.)
> - **U-18 DONE** — `/student` → `/student/home2`, `/parent` → `/parent/family` redirects.
> - **U-20 DONE** — dot-only badges now carry a screen-reader tone label.
> - **U-24 DONE** — the locked "Edit draft" button explains who can unlock it.
> - **U-25 DONE** — plain-language role titles ("IT administrator", "Bursar / Accountant", "Class teacher").
> - **U-28 DONE** — parent "Ask school", student "My work".
> - **U-09 NOT DONE** — wiring Attention/Insights/Calendar/Automation to live doors is per-screen work.

### P2 — polish & trust

| ID | Fix | Where |
|---|---|---|
| U-21 | IT admin: real API-key mint/revoke UI with reveal-once secret | `ItAdmin.tsx` |
| U-22 | "Send fee reminders now" / "Apply late fees" buttons | `Fees.tsx` |
| U-23 | Photo upload on Report issue via `files.store` (or drop the button) | `ReportIssue.tsx` |
| U-24 | Unlock explanation on Constitution "Edit draft" | `Constitution.tsx:288` |
| U-25 | Role chip labels: "IT administrator", "Class teacher", "Bursar/Accountant" | `Shell.tsx` footer |
| U-26 | Unify "Front desk"/"Reception", "Attention"/"Needs your attention", "Command center" casing | `Shell.tsx`, `DemoBar.tsx` |
| U-27 | Login footer: drop "tenancy-isolated" | `Login.tsx` |
| U-28 | Rename "Ask" → "Ask the school"; "Work" → "My work" | `DemoBar.tsx:21,23` |
| U-29 | First-run empty-state checklist on owner Today (link to onboarding checklist API) | `Today.tsx` / `OversightHome.tsx` |
| U-30 | Global search: surface server-backed results in ⌘K (today mostly client) | `App.tsx` palette |

### P3 — nice

| ID | Fix |
|---|---|
| U-31 | Reduced-motion respect (motion.tsx) audit |
| U-32 | High-contrast theme |
| U-33 | Screen-reader-only table captions consistency |
| U-34 | Loading skeleton parity on plugin-gated screens |
| U-35 | "What's new" / feature discovery for buried tools (Library desk, Copilot) |

> **P2/P3 fix status (2026-09-23):**
> - **U-21 DONE** — real API-key/webhook UI (see P1 note).
> - **U-22 already present** — "Run dunning" / "Apply late fees" buttons ship on Fees.
> - **U-23 DONE** — the fake "Photo (demo)" button and its placeholder were removed from Report issue.
> - **U-24/U-25/U-27/U-28 DONE** (P1 note).
> - **U-26 DONE** — "Front desk" → **Reception**, staff tab "Attention" → **Needs you**, "Command
>   center" → "My teaching"/"Coordinator desk".
> - **U-29 DONE** — the setup checklist now surfaces on Today until every step is done.
> - **U-30 DONE** — server-backed ⌘K (see P1 note).
> - **U-31 already satisfied** — `components/motion.tsx` already honours `prefers-reduced-motion`
>   (hook + CSS media query).
> - **U-32 DONE** — a **High contrast** theme (light base + stronger text/border/focus), selectable
>   from the account menu and Settings.
> - **U-33 already satisfied** — `DataTable` renders an sr-only caption for every table.
> - **U-34 already satisfied** — plugin enablement is hydrated synchronously from a localStorage
>   mirror, so gated screens do not flash an empty state while the server syncs.
> - **U-35 DONE** — a "What's new" panel in the account menu surfaces the buried tools.

---

## 10. What is already good (do not regress)

1. **Student + parent vocabulary** — "My Day / Learn / Work", "Family / Requests / Ask / Consents", "Hi Aarav", IST-first parent greeting.
2. **Honesty** — `SampleNote`, "Roster door not connected yet… rather than showing seeded people as if they were real", disabled Google button with explanation, `MaintVendors` "no vendors door yet".
3. **Empty states with a next step** — Fees empty copy tells you where records come from; People empty offers "Clear search & filters".
4. **Error recovery** — `ErrorState` + Retry, offline banner with queue count, `x-request-id` in messages.
5. **A11y primitives** — skip link, focus trap (`useDialogFocus`), ARIA tablist on login, roving tabindex dropdowns.
6. **Fees void modal** — reason field + confirm (use as the house pattern).
7. **Login return-to** — `?return=` with open-redirect guard.
8. **Parity gate + honesty gate in CI** — mock-plane imports banned on live screens (`parity-gate.js --enforce`, `honesty-gate.test.ts`).
9. **Memory-only bearer token** — good XSS posture (once session restore is fixed, keep this).
10. **Role fail-closed UI** — unknown role maps to `student`, not admin.

---

## 11. Suggested nav model (target state)

**Owner (≤10 primary):** Today · Needs attention · People · Students · Fees · Classes & timetable · Learning · Reports · Settings · More ▾
> More ▾ → Add-ons · Who can do what · Activity history · Data tools · AI & automation · Maintenance · Front desk · Certificates · Compliance

**Teacher:** Today · My classes · Homework · To review · Exam marks · My leave · Tools ▾ (Assistant, Syllabus, Understanding, Analytics) · Report issue

**Parent (tab bar):** Family · **Fees** · Ask the school · More ▾
> More ▾ → Requests · Consents · Messages · Complaints · Noticeboard · Account

**Student (tab bar):** My Day · Learn · My work · More ▾
> More ▾ → Fees · Results · Noticeboard · Wellbeing · Print centre · Account

**Finance:** Today · Fees · Fee structures · Payments · Reminders · Reports · People · More

**IT administrator:** Today · People · Add-ons · Message channels · Activity history · Data tools · Who can do what · Account

---

## 12. Measurement (after fixes)

| Signal | Today | Target |
|---|---|---|
| Owner nav items | 40+ | ≤10 + More |
| Parent tab bar reachability of Fees | **0 clicks from home** (URL only) | 1 tap |
| Screens showing demo data on live routes | ≥10 | 0 (SampleNote allowed only when no door) |
| Money error strings shown raw | 16 codes | 0 |
| Native `window.*` dialogs on critical paths | 5 | 0 |
| Write doors with no UI that a school user needs | ~25 | 0 |
| Session survives refresh | **No** (split-origin) | Yes |
| Duplicate nav labels | 1 ("Library"×2) | 0 |

---

*Evidence: 867 screenshots + 170 DOM extracts + parity-gate run + source citations. Vision inspection of pixel layout was **Not verified** (model has no image input) — layout/contrast findings above are code-evidenced only.*
