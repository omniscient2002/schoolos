# SchoolOS frontend improvement blueprint

> External review (provided by Sol / GPT-6). Saved verbatim as the improvement brief.
> Scope: read-only review of selected frontend journeys and their existing API wrappers.

Scope: This is a read-only review of selected frontend journeys and their existing API wrappers. It proposes frontend changes for a future implementation team. I did not edit code, run a browser study, or audit every screen. Backend, kernel, CI, deployment, and messaging providers are outside this plan.

## 1. Executive verdict

SchoolOS already has useful building blocks: a restrained warm-paper and teal palette, shared loading and error components, role-aware routes, and several genuinely live workflows. The biggest opportunity is clarity, not a new visual theme.

Four changes would make the strongest difference to a school user:

1. **Give each role a clear home and a short menu.** The owner's navigation currently mixes daily decisions, school records, reports, and administration in one long list. `Shell.tsx:163–201,304–342`
2. **Make the common task unmistakable.** On Fees, "Record payment" is a row action beneath four statistics and seven tabs; the page is titled "Fee Intelligence." `Fees.tsx:382–410,473–486`
3. **Connect or honestly retire misleading surfaces.** The People directory offers teacher, staff, and guardian tabs that currently resolve to an empty "not connected" state, although a separate administration screen has a user-list call. Whether that call can serve each directory role requires a permission check. `People.tsx:88–123,339–342`; `PeopleAdmin.tsx:92–99`
4. **Make phone navigation match real needs.** The current parent bottom bar has Family, Requests, Ask, and Consents—but no Fees. The student home labels Results "soon" although a live Results screen and client call exist. `DemoBar.tsx:20–24`; `StudentHome2.tsx:62–75`; `student/learn/Results.tsx:23–35`

The aim is a product in which a user opens the app, recognises their task, finishes it, and understands what happened—without learning SchoolOS terminology.

## 2. Evidence and limits

The current-source observations above and below come from selected files: `App.tsx`, `Shell.tsx`, `DemoBar.tsx`, `ui.tsx`, `tokens.css`, `effective.ts`, `roles.ts`, `friendlyErrors.ts`, the named journey screens, their relevant service wrappers, and selected entries in `docs/PERMISSION-MATRIX.md`. I used `UI_UX_RECOMMENDED_FIXES.md`, `docs/ROLE-NEEDS.md`, and the UX sections of `SCHOOL_OS_FULL_AUDIT.md` for context.

Historical status notes conflict with the current working tree. For example, `UI_UX_RECOMMENDED_FIXES.md:316–334` records the parent Fees tab and friendly money errors as fixed, while the currently inspected `DemoBar.tsx:20–24` lacks that tab and `friendlyErrors.ts:19–27` has seven string-based rewrites. The present source is the basis for these recommendations; I have not established why the notes and working tree differ.

Other historical problems are already addressed or have changed shape: `/library` routes to the live `LibraryHome` behind `KernelGate`, rather than the old sample `Library.tsx`. `App.tsx:466–485`; `screens/library/LibraryHome.tsx:33–44`. The previous claim that Library itself is a fake screen should not be reopened.

No pixel-level judgement, measured tap count, screen-reader result, or API-response success is claimed here. Those require the future usability pass.

## 3. Role journeys: what the first screen should help with

| Role | First useful destination | Three leading jobs | Frontend direction |
|---|---|---|---|
| Owner | One school overview—choose between existing `/owner/home` and `/today` | Finish decisions; see school health; complete setup | Make one clear primary home; show the next setup step until complete; move board packs and configuration into secondary navigation. Both overview routes currently exist. `App.tsx:428,506` |
| Principal | School overview | Handle approvals; see attendance and safety; review the morning brief | Put actionable decisions ahead of secondary statistics. Keep brief and board pack accessible without giving each permanent top-level prominence. |
| Teacher | `/teacher` | Take attendance; see next class; assign/review homework | Preserve the live, time-oriented teacher home. Put Take attendance beside the current class and place homework/review next. `TeacherHome.tsx:98–163`; `App.tsx:546–569` |
| Coordinator | `/coord/home` | Arrange cover; handle escalations; balance duties | Group the coordinator desk under one clear entry, with substitutions and escalations immediately visible. Its detailed screens have not been reviewed here. |
| Finance | `/fees` | Find a student's dues; record money received; check payment status | Rename the page Fees, foreground finding a student and recording a payment, then place reconciliation and policy tools in a secondary area. |
| Librarian | `/library/desk` | Issue; return; find a book | Keep the separate desk and borrower catalogue. Group desk tasks rather than presenting every subpage as equally important. `Shell.tsx:247–262` |
| Parent | `/parent/family` | Check a child's day; see/pay fees; contact school | Preserve the child switcher and calm daily summary; put Fees in the bottom bar. `FamilyHome.tsx:144–182`; `ParentFees.tsx:190–247` |
| Student | `/student/home2` | See today; find homework; see results | Keep "My Day"; link its quick-access Results and Homework tiles to their existing live routes after checking the student's effective access. `StudentHome2.tsx:62–75`; `App.tsx:540–544` |

For admissions, counselor, facilities, technician, transport, and IT administration, preserve their distinct authorised workspaces. Redesign their detailed navigation during a targeted role review, rather than guessing their daily priorities from the general staff menu.

## 4. Navigation proposal

The governing rule is roughly five to nine prominent destinations per role, with a discoverable More or Tools area. "More" must be a real, labelled way to find less frequent work; it must not silently drop routes. `Shell.tsx:295–320` already protects against dropped items by putting unmatched routes under More. Preserve that safeguard.

| Role | Prominent destinations | Secondary grouping |
|---|---|---|
| Owner | Home (`/owner/home` or `/today`, choose one); Needs you (`/attention`); Approvals (`/action-center`); People (`/people`); Fees (`/fees`); Classes (`/classes`); Reports (`/reports`) | School setup, timetable, library insights, maintenance, compliance, board pack, administration |
| Principal | Home; Needs you; Approvals; People; Attendance; Learning; Reports | Brief, timetable, visitors, maintenance, fees, compliance |
| Teacher | My teaching (`/teacher`); Attendance (`/attendance`); Homework; To review; Lessons; My leave | Student support, exam marks, class insights, other tools |
| Coordinator | Coordinator desk; Substitutions; Escalations; Timetable; People | Duty balance, curriculum, approvals and other authorised tools |
| Finance | Fees; Payments within Fees; Fee structure (`/fees/plans`); People; Reports | Discounts, reminders and reconciliation within the finance workspace |
| Librarian | Desk; Issue; Return; Catalogue; Holds | Fines, purchase requests, members, reports and settings |
| Parent—phone | Family · Fees · Ask the school · More | Requests, consents, messages and account—only where reachable |
| Student—phone | My Day · Learn · My work · More | Homework, results, tasks, fees and available school tools |

These are proposed frontend groupings, not assertions that every destination is currently authorised for every listed role. The implementation team must retain `canSurface` and plugin enablement filtering before showing links; `Shell.tsx:287` already applies these checks.

Specific migration decisions:

- Treat `/owner/home` and `/today` as different existing views until the team chooses one primary landing, then make the other a contextual link rather than a second "Home" item. `OversightHome.tsx:49–90` is an aggregate view; `Today.tsx:614–691` is a detailed briefing.
- Keep People for finding records and Manage people for the authorised account-provisioning workspace; do not label both "People." `App.tsx:431–432,465`
- Rename "Library insights" distinctly if it remains visible beside the catalogue or desk. The current `Shell.tsx:49–50` gives both library links the label "Library."
- Do not make a school user interpret "System services," "Plugin settings," or "AI memory" as daily tasks. Place authorised tools under clearly named administration or school-tools groups.

## 5. Premium design direction

Keep the existing visual identity. `tokens.css:6–63` already supplies warm surfaces, deep teal and readable semantic colours. A premium pass should strengthen hierarchy and consistency rather than introduce a competing palette.

- **Page structure:** a short title in the user's language; one sentence explaining what can be done; one prominent next action; secondary controls nearby but visually quieter.
- **Information density:** show today's exceptions before charts or broad statistics. On a finance desk, "Find student → see amount due → record payment" should dominate. On a teacher home, "Current class → take register" should dominate.
- **Shared patterns:** specify one treatment for a page header, search-and-filter area, task card, confirmation dialog, read-only state, empty state and retryable error. Existing `Button`, `Card`, `Empty`, `ErrorState`, `SkeletonCard` and `SampleNote` provide a foundation. `ui.tsx:7–21,39–55,81–125`
- **Mobile:** design 390px views around readable cards and an always-findable primary action. Inspect each formerly hidden table column to ensure its meaning appears in the mobile card. Check long dialogs with the on-screen keyboard open.
- **Accessibility:** keep the existing keyboard and dialog primitives; require visible focus, text alongside status colour, meaningful headings and clear reasons for disabled actions. Respect reduced-motion and review both dark and high-contrast presentations.
- **Honesty:** label sample material as sample, distinguish "payment started" from "payment confirmed," and do not present "no results" when a request actually failed.

## 6. Existing-backend connection opportunities

These are frontend recommendations based on inspected clients and screens, not claims that every call was exercised live.

| User task | Current screen evidence | Existing client connection |
|---|---|---|
| Mark attendance | Register loads server rows and submits marks. `Attendance.tsx:92–121,202–212` | `apiAttendance`, `apiMarkAttendance` → `GET /attendance`, `POST /attendance/mark`. `liveApi.ts:208–212` |
| Record a fee payment | Action is inside a ledger row and a modal. `Fees.tsx:473–486` | Existing modal initiates and confirms using `/fees/payments` and `/fees/payments/:id/confirm`. `RecordPaymentModal.tsx:47–63` |
| Review decisions | List and decide are server-backed. `ActionCenter.tsx:1–15,68–86` | `apiActions`, `apiDecideAction`. `liveApi.ts:411–412` |
| Check a child | Family home loads children and per-child information. `FamilyHome.tsx:74–106,115–128` | `getParentHome`, `getAttendance`, `getAssignments`, `getExams`. `parentApi.ts:153–167` |
| Pay or track a fee | Parent Fees displays dues, payments and receipts. `ParentFees.tsx:164–176,190–247` | `getMyFees`, `getMyPayments`, `getMyReceipts`; payment options call existing wrappers. `parentApi.ts:261–301` |
| See results | Results has loading, error and empty states. `student/learn/Results.tsx:23–61` | `getStudentResults` → `/student/results`. `studentApi.ts:238–261` |
| Browse library | `/library` renders the live `LibraryHome`. `App.tsx:466–485` | Catalogue and borrower calls are already used. `LibraryHome.tsx:33–44` |
| Find staff or guardians | Non-student People tabs return an empty disconnected state. `People.tsx:88–93,339–342` | `PeopleAdmin` calls `adminListUsers`, but the permission matrix limits `GET /plugins/people.admin/users` to owner and IT admin. `PeopleAdmin.tsx:92–99`; `docs/PERMISSION-MATRIX.md:319` |

## 7. Prioritised frontend fix register

| ID | Priority | Confirmed user-visible issue and evidence | Proposed frontend fix |
|---|---|---|---|
| UX-01 | Highest | Parent Fees is absent from the phone tab bar. `DemoBar.tsx:20–24` | Family · Fees · Ask the school · More, filtered by access |
| UX-02 | Highest | Owner and principal menus contain many near-equal destinations. `Shell.tsx:60–94,163–201` | Choose one primary home; curate daily destinations; group infrequent work without dropping it |
| UX-03 | Highest | Student home calls Results "soon" while a live Results route exists. `StudentHome2.tsx:62–75`; `App.tsx:540–544` | Link the tile to `/student/results` when allowed; keep its honest empty state |
| UX-04 | High | Today mixes substantial seed-derived material into a live-looking briefing, including campus language and a fixed "94.1% healthy band." `Today.tsx:200–251,650–659` | Prioritise verified live tasks and facts; plainly label any illustrative sections or omit them from a real-school home |
| UX-05 | High | Attendance catches a register fetch error before constructing an apparently empty live roster. `Attendance.tsx:92–121` | Preserve failure as a retryable error; keep genuine zero-student state separate |
| UX-06 | High | People has disconnected non-student tabs, hardcoded class choices, campus wording and a demo-school CSV filename. `People.tsx:35–62,88–123,129–140,339–342,427–439` | Review directory access by role; use school-defined choices; remove campus/demo identity from the real-school journey |
| UX-07 | High | Fees begins with "Fee Intelligence," statistics and seven tabs; payment recording is in a row. `Fees.tsx:382–410,473–486` | Lead with the fee task, student search and a permitted Record payment action; put policy/analysis later |
| UX-08 | Medium | Shared friendly errors currently rewrite seven strings and otherwise pass raw text through. `friendlyErrors.ts:19–32` | Map user-facing errors into clear explanations and a next step in the frontend |
| UX-09 | Medium | A parent homework failure is described as unavailable, but the card's comments assert a missing door while a corresponding client wrapper exists. `FamilyHome.tsx:97–104,202–218`; `parentApi.ts:161` | Distinguish confirmed missing route, refused access and temporary failure before choosing copy |
| UX-10 | Medium | Library offers disabled "Join queue" when no copy is available. `LibraryHome.tsx:83–86` | Either connect that action to an existing permitted reservation workflow or explain how to request a book |

Preserve and verify rather than reopen: live Library routing, the student Results screen's honest states, the parent child switcher, attendance's server-backed submit, the decision inbox's server-backed actions, shared `SampleNote` and the existing design tokens.

Investigate later: the detailed coordinator, admissions, counselor, maintenance and IT-admin screens were not assessed sufficiently to call individual controls broken.

## 8. Implementation timeline for a future frontend team

These are estimates for implementation, not work performed in this review.

| Phase | Estimate | Decision and work |
|---|---|---|
| 1. Agree role journeys and navigation | 3–5 days | Choose the single owner/principal landing; define primary/More destinations and route mapping; fix parent/student phone reachability. |
| 2. Strengthen shared UI and language | 4–6 days | Set page hierarchy and task-card patterns; make errors and disabled states plain; verify responsive dialogs and themes. |
| 3. Repair daily staff journeys | 5–8 days | Address Today's data provenance, Attendance's load states, Fees' primary task, and People's directory boundaries. |
| 4. Polish parent and student phones | 3–5 days | Put Fees on the parent bar, connect student home tiles, review per-child failures and payment state language. |
| 5. Targeted secondary-screen passes | 5–10 days | Inspect one role or screen group at a time; fix only verified friction against existing doors. |
| 6. Observe real users | 2–4 days | Run scripted tasks with school staff and families on phone and desktop; fix the highest-impact failures. |

## 9. Backend-dependent needs and exclusions

| User need | Current evidence and boundary | Honest interim frontend behaviour |
|---|---|---|
| A teacher or principal searches staff/guardian records from People | People's tabs are empty; the user-list door checked here is owner/IT-admin only. `People.tsx:339–342`; `docs/PERMISSION-MATRIX.md:319` | Do not reuse an admin-only call for broader roles. Explain the limitation or link to an authorised workspace. Backend owner decides whether another scoped directory is warranted. |
| A parent sees homework status on the family card during a failed request | A client wrapper exists, but the screen currently collapses request failure to null. `FamilyHome.tsx:97–104,202–218` | Show "couldn't load—try again" for temporary failure. Investigate route availability before recording a backend request. |
| A real-school briefing shows every seed-derived insight as measured truth | Today still references substantial seed data. `Today.tsx:229–251` | Show only confirmed live facts; label genuinely illustrative content. Backend owner decides later whether additional live summaries are needed. |

Excluded: kernel/API changes, permissions expansion, CI, operations, payment-provider changes, WhatsApp/SMS/email delivery and other integrations.

## 10. User acceptance checklist for the future team

- **Owner, desktop and 390px:** sign in, identify the next decision, reach People and Fees, and finish a setup step. No duplicate "Home" choice obscures where to begin. Every statistic shown as live has a real source.
- **Teacher, desktop and 390px:** reach today's class, open its register, mark exceptions and submit. If the register cannot load, see an error and retry—not an empty class.
- **Finance, desktop:** find a student's amount due and start the permitted Record payment flow. Read a failed action in ordinary language; distinguish an initiated attempt from a confirmed payment.
- **Parent, 390px:** open Fees directly from the bottom bar, choose a child, view what is due, start payment and understand that a receipt appears after confirmation. A failed child-data request is not represented as "nothing due" or "no homework."
- **Student, 390px and keyboard:** open My Day, reach Homework and published Results, and understand an unpublished-results empty state. No "soon" tile points away from an existing authorised page.
- **Across all journeys:** check keyboard focus, readable status without colour, loading/empty/error recovery, dark and high-contrast themes, and whether the user can describe in their own words what the primary action will do.

The guiding decision: make SchoolOS feel premium by making the next step clear and the information trustworthy—not by adding more cards, dashboards or technical vocabulary.

---

## Implementation status (this working tree)

The visual layer follows the companion brief `UI_VISUAL_DIRECTION_PROMPT.md`.

| ID | Status | What changed |
|---|---|---|
| UX-01 | Done | Parent phone bar is now **Family · Fees · Ask school · More**; students get **My Day · Learn · My work · More**; each role's More sheet reaches the remaining routes, filtered by access. `components/DemoBar.tsx` |
| UX-02 | Done | Owner/principal menus curate daily destinations and move infrequent work into labelled groups. One aggregate **School overview** replaces the duplicate Home/Today pair; jargon renamed (AI memory→Notes & history, Audit trail→Activity history, Plugin settings→Add-on settings, Modules→Add-ons, People console→Manage people, Library insights→Library reports). Teacher gains **Attendance**; Command center→My teaching. `components/Shell.tsx` |
| UX-03 | Done | Student home **Homework** → `/student/homework`, **Results** → `/student/results` (was a "not available yet" tile). `screens/student/StudentHome2.tsx` |
| UX-04 | Done | Today: campus language removed, fabricated health band removed and seed figures labelled; verified live actions lead. `screens/Today.tsx` |
| UX-05 | Done | Attendance: a failed register fetch is now a retryable error, not an empty roster. `screens/Attendance.tsx` |
| UX-06 | Done | People: non-student tabs explain the permission boundary and link to Manage people; hardcoded classes removed; campus/CSV demo identity removed. `screens/People.tsx` |
| UX-07 | Done | Fees: page renamed **Fees**, a student search and a primary **Record payment** action lead; statistics and policy sit below. `screens/Fees.tsx` |
| UX-08 | Done | Errors carry the server's stable `code`; `friendlyErrors` maps every money/API code to plain language with a next step. `lib/friendlyErrors.ts`, `services/liveApi.ts` |
| UX-09 | Done | Family home distinguishes empty vs temporary failure (with retry) vs access refused per child door. `screens/parent/FamilyHome.tsx` |
| UX-10 | Done | Library "Join queue" connected to the live reservation workflow. `screens/library/LibraryHome.tsx` |
| Visual tokens | Done | Body/label type sizes raised, page and section titles brought to target, phone tap targets enlarged (~40/34px), status badge text readable, modal head/footer pinned with a taller mobile overlay. `styles/tokens.css`, `styles/base.css`, `styles/components.css` |
| Nav labels | Done | Plain names applied across owner/principal/teacher/coordinator/finance/itadmin menus (shared `lib/labels.ts`). |

Verified: `tsc -b` clean · `vitest` 17/17 · `vite build` ok · `oxlint` no errors (pre-existing warnings only). Pixel-level light/dark/high-contrast checks remain for a browser pass.
