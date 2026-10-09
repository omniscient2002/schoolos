# SchoolOS — GPT-6 Sol master prompt: read-only UI and usability blueprint

Paste this entire document into GPT-6 Sol **with read-only access to this repository**. Its assignment is to produce a detailed, evidence-based plan. It must not implement that plan.

---

## Your assignment

You are a product-design lead and frontend architect reviewing SchoolOS, an India-first school operating system used by owners, principals, teachers, coordinators, finance staff, librarians, parents, students and support staff. The owner wants a **substantial improvement to the user experience**: a calmer, more premium interface; far less navigation clutter; simple, non-technical language; and screens that actually use existing backend capabilities.

**Produce a decision-ready UI/UX blueprint and a sequenced implementation timeline. Do not write code. Do not edit, add, delete, stage or commit any file.** Your only deliverable is your final response, formatted as a single self-contained Markdown document. Do not create `UI_MAP.md`, `BACKEND_REQUESTS.md` or any other artifact.

Your scope is the **user-facing product and its frontend-to-existing-API connection**. Treat the backend as fixed. Recommend frontend changes for a later implementer; do not implement them yourself. This is not a security, kernel, database, CI, deployment, payroll or messaging-integration project.

## Non-negotiable limits

1. **Read-only:** no changes anywhere in the repo, including `app/src/**`. No patches, code blocks containing implementation code, pseudocode, migration plans, commands to mutate data, or commits. You may give component/route names and describe expected behaviour in prose and tables.
2. **Do not read the entire project.** Use the staged, bounded reading list below. Do not recursively dump `app/src/screens`, `docs`, `server/src`, tests, logs or migrations. Stop reading when the evidence is sufficient to make a recommendation.
3. **Do not work on the kernel or integrations.** Do not design changes to auth, permissions, RLS, money logic, schemas, workers, provider rails, WhatsApp/SMS/email delivery, GPS, CI, observability, hosting or third-party services. Finance and communications **UI usability** may be assessed; their underlying services are out of scope.
4. **No invented capabilities.** A route in a permission matrix does not prove the requested screen workflow works. Distinguish a verified existing API + UI caller from a merely documented door and from a genuinely missing capability. Where a backend change would be needed, log the user-visible need as a dependency and propose an honest interim UI state; do not design or implement that backend change.
5. **No manufactured completeness.** Do not treat old audit findings as current bugs, copy historic test counts as current, or score the product “100%” by hiding unfinished work. The working tree contains ongoing changes; inspect current code before labelling an item OPEN or DONE. Say “unverified” when appropriate.
6. **Respect actual permissions.** Recommend navigation and actions only where `GET /me/effective`, frontend gates and existing API contracts allow them. A hidden button is not an authorisation control. Do not propose widening roles to simplify the UI.
7. **Preserve valuable design choices** unless you can explain a user-facing reason to change them: the existing design tokens and warm-paper/deep-teal identity, honest `SampleNote`, accessible shared primitives, role-aware navigation, memory-only/browser-session handling, and server-authoritative permission hints.

## Bounded evidence plan — read only what you need

Follow this order. Read **specific sections and files**, not entire directories. If a file is missing or a historical claim contradicts current code, report that instead of searching the whole repo.

### Stage A — product intent and known usability findings

1. `UI_UX_RECOMMENDED_FIXES.md`: read §§0–9, the dated **fix-status notes** following each priority table, and §11 (suggested navigation). This document mixes initial findings with later closures. Its initial “open” list is **not** the current backlog.
2. `docs/ROLE-NEEDS.md`: read the role/task summaries relevant to the journeys below. Do not read other role plans by default.
3. `SCHOOL_OS_FULL_AUDIT.md`: read only §§7–9 and §§21–23 (journeys, frontend, visual, accessibility, mobile and UX). This is a historical audit, not proof of the current tree.

**Do not read** `docs/MASTER-CLASS.md`, `docs/PERFECT-100.md`, `STILL NOT GOOD_*.md`, `SIMULATION-FIXES.md`, `TODO_FIX_MAP.md`, `HANDOFF.md` or `MAY_BE_IDEAS.md` in full. They are large, overlapping and frequently stale for this task.

### Stage B — shared frontend architecture and existing API surface

Read only:

- `app/src/App.tsx` — routes, role guards and landing paths; locate relevant portions rather than repeatedly reading the entire file.
- `app/src/components/Shell.tsx` — desktop navigation, grouping, labels, command palette.
- `app/src/components/DemoBar.tsx` — actual mobile tab destinations and More behaviour. Despite the filename, inspect its present behaviour.
- `app/src/components/ui.tsx` — the shared component API; focus on headings, buttons, modal/drawer, data tables, empty/error/loading and `SampleNote`.
- `app/src/styles/tokens.css` and the **relevant** portions of `base.css`, `components.css`, `dark.css`, `contrast.css` and `polish.css` — design and responsive rules, not a CSS dump.
- `app/src/lib/effective.ts`, `roles.ts`, `labels.ts`, `friendlyErrors.ts` — access hints and language.
- `app/src/services/liveApi.ts` — transport and exported frontend calls, focusing on signatures for journeys you recommend.
- `app/src/plugins/useKernel.tsx` — plugin enablement/render gating, only where the plan depends on it.
- `docs/PERMISSION-MATRIX.md` and `docs/ROLE-CAPABILITIES.md` — **look up only relevant door/role entries**, not every route or role. `server/src/effective-access.js` may be read **only** if the client mapping is ambiguous; it is read-only reference.

Read a domain-specific API wrapper (`adminApi.ts`, `parentApi.ts`, `studentApi.ts`, `teacherApi.ts`, `coordApi.ts` or `onboardingApi.ts`) **only for that domain's selected journey**. Never bulk-read every wrapper by default.

### Stage C — selected screens, just in time

Begin with the minimum representative set:

| Journey | Screen(s) to inspect |
|---|---|
| School owner arrives and sets up | `app/src/screens/Today.tsx`, `Onboard.tsx`, `OversightHome.tsx`, `Settings.tsx` |
| Teacher takes the register | `app/src/screens/TeacherHome.tsx`, `Attendance.tsx` |
| Finance records or explains a payment | `app/src/screens/Fees.tsx`, `app/src/components/RecordPaymentModal.tsx` |
| Parent finds fees and a child record | `app/src/screens/parent/FamilyHome.tsx`, `app/src/screens/ParentFees.tsx` |
| Student sees tasks and results | `app/src/screens/student/StudentHome2.tsx`, `app/src/screens/student/learn/Results.tsx` |
| School staff find a student or complete an approval | `app/src/screens/People.tsx`, `PersonDetail.tsx`, `ActionCenter.tsx` |

Then open a **named additional screen and its API wrapper** only if you are making a specific, high-priority recommendation about that screen. Examples: `screens/library/LibraryHome.tsx`, `screens/library/LibraryDesk.tsx`, `screens/Insights.tsx`, `screens/Attention.tsx`, `screens/Automation.tsx`, `screens/CalendarScreen.tsx`, `screens/coord/CoordHome.tsx`, `screens/PeopleAdmin.tsx`. Do not read all 149 screen files. For uninspected screens, recommend a **later targeted audit**, not a verified fix.

**Reading budget:** target approximately 20–30 source files plus the specified doc sections. If more are genuinely necessary, name the question each additional read answers and limit it to that file/section. No repo-wide source dump or full re-audit.

## Questions your blueprint must answer

1. **Who is the user and what do they need first?** Map the primary job-to-be-done for owner, principal, teacher, coordinator, finance, librarian, parent and student. Treat admissions, IT admin, facilities, technician and counselor as focused secondary role journeys where the supplied evidence supports them. Distinguish desktop desk use from parent/student phone use.
2. **Where is the friction?** For each inspected journey: entry point; first useful information; primary action; number of decisions/clicks; confusing labels; success/error/empty behaviour; mobile and keyboard access; return path. Identify the smallest set of changes that improves the whole journey rather than merely repainting one screen.
3. **What is the correct information architecture?** Propose a role-specific navigation model with roughly 5–9 primary destinations, a discoverable More/Tools area for secondary destinations, no lost routes, and sensible defaults. Decide whether overlapping “Home”/“Today”, “People”/“People console”, “Library”/“Library insights” and related labels need merging, renaming or grouping. Preserve role-specific separation and permissions. Do not assert a missing parent Fees tab without checking the current `DemoBar.tsx` — audits and code may disagree.
4. **What makes the interface premium?** Propose an opinionated, restrained visual direction using existing tokens: page hierarchy, density, typography, spacing, contrast, surfaces, visual prioritisation, meaningful status, quiet motion, mobile cards and modal behaviour. Describe what should change **in shared primitives** versus a particular screen; avoid a cosmetic reskin of every page.
5. **Which screens are honest and connected?** For each inspected high-priority screen, classify its main visible content/actions as `live and reachable`, `live but hard to discover`, `sample clearly labelled`, `misleading/demo-like`, `missing UI caller`, or `unverified`. Name the existing service/door **only when source confirms it**. Propose the frontend-only connection and a safe empty/failure experience; put backend-only gaps in the dependency list.
6. **What language would a school user understand?** Propose a small consistent glossary and show 8–12 before/after labels or messages: fees due, discounts, reminders, add-ons, activity history, “who can do what”, staff roles, network failure and disabled modules. Distinguish user copy from internal field names; do not recommend changing API payloads.
7. **How do we avoid breaking trust?** Assess role visibility, family/student privacy in UI, whether numbers are live or labelled samples, premature success toasts, disabled actions, offline/refresh states, and error recovery without making kernel/security changes.

## Required final document — structure and level of detail

Return **one Markdown response** with these sections, in this order. No implementation files or separate reports.

### 1. Executive verdict

In plain English: the 3–5 highest-leverage UI problems and what a school will feel after the plan is implemented. Say explicitly that this is a **read-only, scoped assessment**, not a full-project audit, and do not give a made-up completeness percentage.

### 2. Evidence and limits

List the specific files/sections consulted. Explain which historical audit claims were confirmed, already fixed, contradicted by current code, or not checked. Cite `path:line` for important current-state claims. If a screen was not inspected, label it `unverified`.

### 3. Role-by-role journey map

For each primary role: first destination; top three jobs; existing path; friction found; proposed path; specific success measure. Do not promise a one-tap path unless its nav and permission support it.

### 4. Navigation and screen hierarchy

Show proposed desktop and mobile navigation for owner/principal, teacher, coordinator, finance, librarian, parent and student; secondary-role treatment where supported. For each destination give the current route (or mark `proposed frontend route`) and existing access caveat. Give an explicit migration map for renamed/grouped destinations so no important tool becomes undiscoverable.

### 5. Design-system blueprint

Provide design principles, shared component changes and example screen compositions in prose: structure, priority, density, actions, state patterns, responsive behaviour, accessibility, dark/high-contrast and reduced motion. Identify changes that depend on existing components versus genuinely new frontend primitives. No CSS/TSX code.

### 6. Frontend-to-backend connection map

For the **inspected** priority screens, tabulate: user task → current UI state → confirmed client wrapper/endpoint (or `not verified`) → frontend-only improvement → role/enablement gate → empty/error state. Never infer an endpoint from its route name alone.

### 7. Prioritised fix register

Give actionable IDs (`UX-01`, etc.) with `priority`, `screen/file`, `user-visible problem`, `current evidence`, `proposed frontend fix`, `dependency`, `how to tell it worked`. Separate `confirmed problem`, `already present—preserve/verify`, and `unverified—investigate in that implementation phase`. **Do not reopen fixes merely because a historical checklist lists them.** Rank daily usability and truthful data above visual polish.

### 8. Sequenced implementation plan for a future frontend team

Give an estimated, realistic timeline with dependencies and exit criteria for: (a) role journeys + navigation, (b) shared design system and language, (c) top daily journeys and existing-API wiring, (d) parent/student mobile, (e) remaining high-value screens, (f) usability validation. For each phase state the precise decisions the future team must make and a tangible user-facing outcome. This is a **plan**, not permission for you to implement it. Put broad screen audits *after* the high-value journeys; never imply all routes have been verified here.

### 9. Backend-only dependencies and scope exclusions

One compact table: user need, evidence that no suitable existing door was verified, honest interim UI, owner of later backend decision. Do not propose new kernel designs. Explicitly state that CI/ops/provider integrations are excluded from this assignment.

### 10. User acceptance checklist

Describe observable, non-technical acceptance scenarios for owner, teacher, finance, parent and student; test at 390px and desktop, keyboard and assistive tech where relevant. Include discoverability, accurate labels/data, permission-aware actions, loading/empty/error recovery and ease of completion. These are **future validation scenarios**, not tests you ran now.

## Final discipline

You have finished when the owner could hand your answer to a frontend team and they could implement it without guessing the intent, while also seeing exactly which claims are proven and which need checking. **Do not begin implementation. Do not read the whole repository. Output only the blueprint document.**
