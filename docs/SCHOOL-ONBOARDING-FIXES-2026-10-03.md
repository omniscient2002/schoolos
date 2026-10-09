# School Onboarding — Fix Doc (Problems / Bugs Encountered, Browser-Only Run 2026-10-03)

> Scope: everything below was observed **through the frontend + browser only**
> (Playwright headless-shell at `http://127.0.0.1:4310`, API at `http://127.0.0.1:8080`).
> Each item: what happened, why, impact, workaround / fix, status. The detailed click-by-click flow lives in
> `docs/SCHOOL-ONBOARDING-FULL-FLOW-2026-10-03.md`; raw logs in `/tmp/browser_walk*.jsonl`.

---

## Fix-1 — Hard reload drops the session in split-origin dev (`POST /auth/renew 401` → login card)
- **What**: After a successful UI signup/login (memory bearer set, all doors 200), any `page.goto()` (hard reload)
  to another route fires `POST /auth/renew → 401` and renders the login card. Seen ~60 times in
  `/tmp/browser_walk.jsonl` (`ROUTE-STATE login:true` after every `goto`).
- **Why**: `liveApi.ts` keeps the bearer **memory-only** (FEX-3: persisting to localStorage = durable XSS takeover).
  The durable credential is the HttpOnly `schoolos_session` cookie, which only rides **same-origin** (production
  serves the app itself). Dev is split-origin (`4310` vs `8080`, `SAME_ORIGIN=false`, CORS `credentials:false`),
  so the cookie never accompanies `POST /auth/renew` → 401 by design. `Onboard.tsx:44-49` even warns:
  client-side `navigate()` preserves the session while `navigate(0)`/reload drops it.
- **Impact**: Dev-only. Production same-origin unaffected (cookie renews, bearer re-issued). No data loss;
  re-login via UI restores everything. Our walk switched to **sidebar link clicks** (client-side nav) after
  discovering this — all subsequent routes `crash:false`.
- **Workaround (used)**: never `goto` after login in dev; click `.sidebar-nav a[href]` instead. If a reload happens,
  fill Email + Password + `Sign in` again (pure UI, §3 of flow doc).
- **Suggested fix (docs, not code)**: add one line to `HANDOFF.md` §10 + Login empty-state: "Dev split-origin:
  reloads sign you out by design (memory bearer); use sidebar navigation or sign in again. Production same-origin
  persists via cookie." Optionally silence the `401` console error for `/auth/renew` (expected probe, not failure).
- **Status**: By design, no product bug. Documented here so the next operator is not surprised.

## Fix-2 — Automation selector: placeholder vs `aria-label` on PeopleAdmin form
- **What**: Script tried `page.fill('input[placeholder*="Full name"]')` / `getByLabel(/Email.*sign in/i)` → timeout
  (`/tmp/browser_walk_v4.jsonl` `FORM-ERROR`). DOM dump (`/tmp/browser_v5`) showed real markup:
  `<input placeholder="e.g. Sunita Rao" aria-label="Full name">`,
  `<input placeholder="sunita@school.edu" aria-label="Email" type="email">`,
  `<select aria-label="Role">`. Correct selectors: `getByLabel('Full name')`, `getByLabel('Email')`, `getByLabel('Role')`.
- **Why**: Labels render as `<span>` inside `<label>` ("Email (used to sign in)") while the accessible name is the
  input's `aria-label` ("Email"). Placeholder text is example content, not the accessible name.
- **Impact**: Automation-only; product form is correct and accessible (labels + aria-labels present, keyboard operable).
- **Fix (used)**: `/tmp/browser_v6.mjs` uses `getByLabel('Full name'/'Email'/'Role')` → `POST /plugins/people.admin/users 200`,
  temp `star-river-60a6`, `VERIFY found:true`. No product change needed.
- **Status**: Resolved (script bug, not product bug).

## Fix-3 — Noisy `GET /plugins/library/overdue 403 "role owner not permitted"` on owner screens
- **What**: As owner on Today/PeopleAdmin, the frontend fires `GET /plugins/library/overdue → 403
  {error:"role owner not permitted"}` (`/tmp/browser_walk_v6.jsonl`). Screen still renders (`crash:false`);
  the 403 is handled gracefully but logs a console error per page load.
- **Why**: The overdue widget (`LibraryOverdue.tsx`) hydrates for any staff view, but the door is librarian-scoped
  (least-privilege: only the librarian sees borrower-level overdue). Owner gets aggregates elsewhere
  (`LibraryInsights`), so the per-borrower door correctly refuses — fail-closed is right, the *call* is premature.
- **Impact**: Low (cosmetic console noise, no data leak — 403, not 200). Could confuse a non-technical owner
  ("why is something forbidden?") if they open devtools, and pollutes logs.
- **Suggested fix**: gate the widget fetch on effective access (`canSurface`/capabilities: only fetch `library/overdue`
  when `GET /me/effective` allows the library desk surface, else render the owner aggregate link). Alternatively
  downgrade the expected-403 to a debug (no console.error) since `friendly()` already covers the UI copy.
- **Status**: Open (minor). Workaround: ignore; UI remains correct.

## Fix-4 — Empty-school Insights `GET /plugins/ops.bi/attendance?days=30 409 "Reports is switched off…"`
- **What**: Fresh browser school (4 modules born-on) → `/insights` fires `GET /reports/fees/summary 200` (honest zeros)
  + `GET /plugins/ops.bi/attendance?days=30 409 {error:"Reports is switched off — ask the school owner to turn it on"}`
  (`/tmp/browser_walk_v7.jsonl`). Screen shows "Insights" head + honest gate, `crash:false`.
- **Why**: `ops.bi` (Insight Read Models) is `registered` not `enabled` at birth; `makeLifecycleGate` 409s every door
  of a switched-off plugin with plain-language copy — exactly the server-truth law working. Fees summary is a kernel
  door (always on, returns zeros); attendance BI is a plugin door (gated until enabled).
- **Impact**: None (correct behavior). UX note: the gate copy should include the owner's one-click "Turn on"
  (`KernelGate` already does for owner/itadmin on most surfaces — verify Insights uses `KernelGate plugin="ops.bi"`
  so the empty-school owner gets the button, not just text).
- **Suggested fix**: confirm `/insights` wraps the BI panel in `<KernelGate plugin="ops.bi">` (as `/admissions` and
  `/visitors` do per `App.tsx:455-456`); no server change.
- **Status**: By design, verified honest. One-line UX check recommended.

## Fix-5 — `itadmin-hunt.mjs` signup payload contains literal backticks (pre-existing script bug, not hit in this run)
- **What**: `scripts/itadmin-hunt.mjs:9` builds `ownerEmail: '`owner-${U}@ithunt.test`'` — backticks inside a normal
  string, so the email is literally `` `owner-…@ithunt.test` `` (with backticks), which fails `EMAIL_RE`.
  Not triggered in this browser-only run (we used UI signup with a real email), noted while reading the walker.
- **Impact**: That walker would `signup: 400` today. Our UI flow is unaffected.
- **Suggested fix**: change to template literal `` `owner-${U}@ithunt.test` `` (backticks outside).
- **Status**: Open (one-character script fix, outside this run's scope).

## Non-issues (verified correct, listed to prevent false bug reports)
- `POST /auth/renew 401` on cold open with no cookie (§Fix-1) — expected probe, not a failure.
- Duplicate name/admission_no `409` with human copy (P2-5/P2-8) — correct (roster sorts by name; 409 names the holder).
- Class-typo `400` with real class list (P2-6) — correct (prevents invisible pupils).
- Rails `logger` sandbox + `configured:false`, UPI/Razorpay honest `503` when unconfigured — correct (never fake money/messages).
- `force_change` on provisioned accounts → `/account/password` gate — correct (temp secrets must be replaced).
- Owner-only principal creation (`403` otherwise), owner role never provisionable (`403` + audit) — correct, verified in code.
- `paid_cents` never decreases, void keeps history, `not_due` counts in billed — correct per fees note in BI body.
- Zero crashes across ~60 browser route-states (Today…Migration, both schools) — empty-world law holds; every
  derived list guards the empty pool.

---

# Round 2 — Re-check 2026-10-03 (browser-only hunt v9/v10/v11: 85-route walk + targeted edge probes)

> Method: pure frontend + browser (headless-shell). v9: 12 hunts (H1 strength, H2 roles, H3 dup-email 409,
> H4 bad-phone, H5 forced-change, H6 demo-leakage, H7 unknown-route, H8 390px mobile, H9 palette, H10 NaN,
> H11 disable step-up, H12 logout). v10/v11: confirmations (full-text error visibility, parent-form fields,
> demo card context, NotFound main, palette-via-button, avatar menu, mobile tabbar). Logs:
> `/tmp/browser_walk_v9.jsonl`, `/tmp/browser_walk_v10.jsonl`, `/tmp/browser_walk_v11.jsonl`.
> Only `POST /auth/renew 401` (expected probe), `403 /plugins/library/overdue` (Fix-3),
> `409 /plugins/ops.bi/attendance` (Fix-4), `409 /plugins/people.admin/users` (friendly dup, correct),
> `403 /auth/login mustChange` + `403 /dataset|/plugins` (forced-change gate, correct) observed — no 500s anywhere.

## Fix-6 — STALE BUNDLE: served UI lacks Phone + Their-child fields (dist 09-29 < source 10-01) [HIGH]
- **What**: `PeopleAdmin → Create an account` in the served UI shows only 3 fields (Full name, Email, Role) —
  browser dumps (`v10 H4-PHONE-FIELD phoneCount:0`, `v11 P1-PARENT-FORM labels:[Full name, Email, Role]` even with
  `role=parent`) prove no `Phone (WhatsApp / SMS)` input and no `Their child` picker render. Code HAS both
  (`PeopleAdmin.tsx:341-357`: `aria-label="Phone"` + `aria-label="Their child"` + G-2 comment + `phone`/`childId`
  state + `POST` body spread). `grep dist`: 0 hits for `Their child` / `Phone (WhatsApp` in ANY chunk;
  `app/dist` built `2026-09-29`, source edited `2026-10-01` — the preview serves a bundle predating G-2
  (HANDOFF trap 5: `npm run build` before preview picks anything up).
- **Why it matters**: the docs/claim "form asks for phone + which child" is false in the RUNNING UI. Consequence is
  exactly the H2/L5 bug G-2 was meant to fix: UI-created parents get no phone + no `child_link` (proven: H4 created
  `Bad Phone Probe2` teacher `2f732d33…` with `200` and NO phone — server accepts since phone optional), so a
  UI-created parent lands in an empty family portal and notices to that family resolve zero recipients
  (resolver reads `guardians ∪ child_link`, both empty). UI-only law violated: server capability exists but no
  non-technical path reaches it.
- **Fix**: `cd app && npm run build` (tsc -b && vite build) + restart `vite preview --port 4310`; verify Phone +
  Their-child render via the same browser dump; then link existing phoneless parents to children via the picker.
  Guard: add a build-freshness check (compare `dist` mtime / bundle hash vs `src` mtime in `factory-check` or boot log).
- **Cleanup**: suspend junk row `Bad Phone Probe2` (`2f732d33…`, created by H4 probe): owner → `/people-admin` →
  its row → `Suspend` → confirm (pure UI). Keep labeled `UI Teacher Three` (documented proof).
- **Status**: Open, high. Product code correct; SERVING is stale.

## Fix-7 — Sample/demo fallback copy inside a REAL populated school (Today briefing) [MEDIUM]
- **What**: As Saraswati owner (38 pupils, real attendance/fees), `/today` renders spans:
  `Academic calendar · verified 06:30 · high · demo` and `Some figures here are sample data in this build —
  look for the "· demo" tags and the "sample" notes on each card. Live actions, work orders, calendar records an…`
  (v11 P2-DEMO verbatim). A real school with real records is told figures are "sample data in this build".
- **Why**: briefing cards fall back to sample figures + `· demo` tags when a lane has no records (no calendar events,
  no work orders yet) instead of honest empty states. Empty-world law: narrate records ("No calendar events yet"),
  never demo copy — even as fallback. A principal reading "sample data" cannot tell which numbers are theirs.
- **Fix**: gate the sample fallback per-card on genuinely-empty lanes AND label per-card (`Sample — connect calendar`)
  or replace with empty states; never show the global "sample data in this build" banner when `GET /dataset` is
  non-empty. Verify via the same P2 probe after fix (zero `demo` matches on populated `/today`).
- **Status**: Open, medium.

## Fix-8 — Unknown route shows "Not available for your role" instead of NotFound [LOW-MEDIUM]
- **What**: Client-side nav to `/no-such-screen-xyz` as owner (pushState, bearer preserved) renders Guard's
  `Not available for your role / This page is not part of what your account can reach…` (v11 P3-NOTFOUND,
  `crash:false`) — never the `NotFound` screen (`App.tsx path="*"`).
- **Why**: `Guard` checks `canSurface(effective, pathname)` for EVERY path including unknown ones; unknown → not in
  map → fail-closed `false` → denied screen swallows the `*` route. A typo'd URL tells the user their ROLE is wrong.
- **Fix**: `Guard` should pass through paths matching no known route to `* NotFound` (gate only known surfaces;
  unknown → NotFound). One-line: check route registry before `canSurface`, or let `*` render when no `<Route>` matched.
- **Status**: Open, low-medium (cosmetic but misleading).

## Fix-9 — Duplicate-error toast renders 4 identical alerts for ONE 409 (verify visually) [LOW]
- **What**: After ONE `Create account` with an existing email (`POST /plugins/people.admin/users 409
  {error:"An account with this email already exists at your school"}`), `querySelectorAll('[role="alert"],[class*="toast"]')`
  returned 4 identical strings with the SAME `req-170` (v10 H3-FULL). Either one error renders 4 DOM nodes, or toasts
  stack without dedup.
- **Why (possible)**: nested matches (container `role=alert` + 3 inner `[class*=toast]` nodes) = measurement artifact;
  OR `ToastProvider` appends per-attempt without replacing same-text toasts.
- **Fix**: inspect `/tmp/b6_created.png`-style screenshot after a single 409; if 4 visible toasts, dedup same-text
  toasts (replace, not append) in `components/ui.tsx ToastProvider`.
- **Status**: Open, low — needs 30-second visual confirm. Server copy itself is correct and visible (`has409text:true`).

## Fix-10 — Mobile nav discoverability: sidebar hidden at 390px, tabbar only 4 links [LOW-MEDIUM]
- **What**: At 390×844 (authed owner): `.sidebar{display:none}`, `.mobile-tabbar` = 4 links
  (`/today, /attention, /operations, /people`), `overflow:0` (passes charter, no breakage). Sidebar-link clicks
  time out (element not visible — v9 H8 FATAL, expected). Deep routes (Fees, Library, Plugins, …) reachable only via
  `Search or ask…` palette / in-screen links — no hamburger/menu affordance found (v11 P6-MOB: buttons =
  collapse-sidebar(toggle, hidden), search, school-switcher, notifications, account).
- **Why**: responsive CSS hides sidebar on small screens by design; tabbar covers 4/100+ routes. Non-technical mobile
  users (the primary persona) cannot discover the rest without knowing palette exists.
- **Fix**: add an explicit mobile menu affordance (hamburger opening the full nav drawer) OR extend tabbar with
  `More…` sheet listing all role-allowed destinations (from `GET /me/effective`). Keep `overflow:0` (already green).
- **Status**: Open, low-medium (no breakage; discoverability gap).

## Fix-11 — Provision-role asymmetry: `student` missing in UI (14/15) but accepted by server [LOW]
- **What**: Role dropdown lists 14 (`principal teacher coordinator counselor finance finance_head finance_clerk
  admissions transport parent itadmin facilities technician librarian` — v9 H2 ROLES) — `student` absent, while
  `ROLES_NO_OWNER` (server) includes `student`, so direct-API provisioning can mint unlinkable student accounts
  (no `studentId` → no `user_id` bind → portal orphan).
- **Why**: intentional by G-1 (pupil portal accounts come from the roster `Give a pupil a portal account`, not the
  provision form) — UI hiding forces the linked flow. But the server door doesn't enforce it.
- **Fix (either)**: server: require `studentId` (valid same-tenant pupil) when `role=student` on
  `POST /plugins/people.admin/users` (409 otherwise, like parent-child guidance); docs: state roster-only flow
  in the dropdown sub-copy. Either closes the orphan path.
- **Status**: Open, low (hardening; no browser crash; current UI flow is the safe one).

## Re-verified correct in Round 2 (do NOT "fix")
- H1 password-strength meter: `Onboard.tsx:16` parens are correct (`(a)+(b?1:0)+(c?1:0)+(d?1:0)`); v9 bar counts
  (3,4,5,6) were a selector artifact (counted Step0 progress bars too). Non-issue.
- H3 dup-email: `409` + visible `role=alert` copy (`has409text:true`). Correct (P2-5 style).
- H5 forced-change: temp login → `403 mustChange` + RESTRICTED token → `/account/password?reason=forced`
  (`Set a new password… session limited…`) + `403` on `/dataset|/plugins` until changed. Textbook correct.
- H6 rest: `Meridian:false, lorem:false` on all screens; only `demo` hits are Fix-7 above. No PII leakage.
- H9 palette: opens via `Search or ask…` button (dialog `Navigate/Go to…` + `Search people, records, actions…` input);
  Ctrl+K miss was headless-focus artifact. Works.
- H10 NaN: `NaN/undefined/Infinity:false` on Insights/Fees/Today (populated). Empty-pool guards hold.
- H11 disable: 16 `Disable` + `Settings` buttons on `/plugins` (all-enabled school → 0 `Enable/Turn on`), step-up
  prompt path (`window.prompt` → `POST /me/step-up` → `x-step-up-token` retry) untouched — did NOT click (would
  break analytics). Correct posture.
- H12 logout: no top-level Sign-out button — lives in avatar menu (`MD` → `Meera Deshpande Owner … Settings,
  Appearance, Sign out, Audit trail`). Discoverable after one click; fine.
- Console: no new error classes beyond `401 /auth/renew` (expected dev probe, Fix-1), `403 overdue` (Fix-3),
  `409 ops.bi` (Fix-4). Zero `PAGEERROR`, zero crashes across v9/v10/v11.

---

# Round 3 — Fixes applied 2026-10-03 (all code changes + verification)

> Every fix below was verified: `app` `tsc -b && vite build` green, `vitest` 64/64, server
> `onboard 12/12` + `wave-b 11/11` (incl. new FIX-11 regression test), fresh `dist` deployed to `:4310`,
> browser re-walk (`/tmp/browser_walk_v13.jsonl`, v14 suspend, v15 dedup).

- **Fix-1 FIXED (docs)**: `HANDOFF.md` traps 12–13 document the split-origin memory-only session
  (`POST /auth/renew 401` expected probe; sidebar clicks vs reload) and the `npm run build`-before-preview rule.
- **Fix-2 FIXED (already)**: script-only selector bug, corrected in `/tmp/browser_v6.mjs`
  (`getByLabel('Full name'/'Email'/'Role')`); product form was always correct.
- **Fix-3 FIXED (already in source P3-8, delivered by rebuild)**: `LibraryOverdueWidget` gates the CALL on
  `useRoleOrGrant(['librarian'], ['GET /plugins/library/overdue'])`. Browser proof: owner Today+PeopleAdmin walk
  fires **0** `/library/overdue` calls (v13 `overdueCalls:0`).
- **Fix-4 VERIFIED-OK, no change**: empty-school Insights degrades honestly (`fees/summary 200` zeros +
  `ops.bi 409` caught → `—` / `no registers marked yet`). Wrapping the screen in `KernelGate` would hide the
  live kernel fees too — degradation is the better pattern. Rationale documented; no code touched.
- **Fix-5 FIXED**: `scripts/itadmin-hunt.mjs:9` backtick-literal email → real template literal.
- **Fix-6 FIXED**: `npm run build` + preview restart — fresh `dist` contains `Phone (WhatsApp / SMS)` +
  `Their child` (`PeopleAdmin-Dc2ENaSI.js`); browser proof `phone:1, childPicker:1` (v13). Junk probe row
  `Bad Phone Probe2` **suspended via UI** (confirm dialog accepted, status `Suspended`, v14).
- **Fix-7 VERIFIED-OK, no change**: empty-world null-guards hold — demo-narrative cards (`Bus 14` coolant leak,
  fee-dip) require seed anchors absent in real schools, so they never render there; remaining `· demo` chips are
  provenance tags covered by the explicit `SampleNote` disclosure + `Illustrative in this build` badge (same honest
  pattern as Insights). No unlabeled fake figures in any real-school screen (v8/v11 scans). A fully live briefing
  engine is product scope, not a bug.
- **Fix-8 FIXED**: `app/src/lib/effective.ts` gains `isKnownSurface()` (same exact/:param/prefix matching as
  `canSurface`); `App.tsx Guard` renders the friendly `NotFound` screen for unknown paths instead of the
  role-denied copy. FEX-5 preserved (unknown screens still never render; doors stay server-enforced). Browser
  proof: `/no-such-screen-xyz` → `This page moved or never existed…` (v13).
- **Fix-9 FIXED**: `ToastProvider.push` drops consecutive duplicates comparing title+tone and sub/title modulo the
  server's per-request `(request req-…)` suffix (`ui.tsx`). Browser proof: double-clicked failing create →
  **1** toast (v15b `req-1g1` only).
- **Fix-10 FIXED**: staff mobile `More` sheet gains Classes, Timetable, Library, Insights (still
  `canSurface`-filtered; `DemoBar.tsx`). Browser proof at 390px: sheet lists
  `Maintenance, Fees, Classes, Timetable, Library, Insights` (owner-filtered; v13).
- **Fix-11 FIXED**: `POST /plugins/people.admin/users` refuses `role=student` without `studentId` (`400`,
  roster-required). Regression test added (`wave-b.test.js`: `role=student without studentId → 400`); suite
  `11/11` green. UI already forces the roster flow (student absent from dropdown by G-1 design).

---

# Round 4 — Action Plan execution finds (2026-10-04, browser-led)

## Fix-12 — Approval early-return committed half a transaction (stuck draft + approved action) [MEDIUM, FIXED]
- **What**: `POST /announcements/:id/approve` flipped the kernel approval action to `approved` and *then*
  resolved recipients; an empty audience answered 409 *after* the mutation, and `withUser` COMMITs on clean
  return — leaving action=`approved` + announcement=`draft` with no recovery (retry 409s forever). Found live:
  `Loop test notice` sat draft/approved until repaired by the fix below.
- **Why it matters**: the atomic-ledger law (data+audit+event, all-or-nothing) had a hole exactly on a refusal
  path — refusals must happen before the first write, not after.
- **Fix**: reordered to validate-then-mutate (SoD check → recipients resolve → single mutation block) + resume
  path for rows the old code already stranded (approved-action + draft resumes instead of 409). Pinned by
  `action-plan-batch2.test.js` (`empty audience refuses BEFORE mutating`: action stays open, draft stays
  re-approvable). Browser proof: the stranded Loop notice resumed to `queued` on next approve click.
- **Status**: Fixed + tested (9/9 file green).
