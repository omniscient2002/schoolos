# SchoolOS Frontend Fix Log

## 2026-09-08 — Frontend blue-team lane: P0 audit fixes (1–6)

Lane scope honored: only `app/src/**` touched (plus `app/.env.development`).
No server, `tests/b9`, migrations, or repo-doc changes. Server test suite NOT run (shared DB).

### Fix 1 — `/teacher` white-screen crash (teacherContext.tsx:67 throw, provider never mounted)
- `src/App.tsx`: `<TeacherProvider>` now mounted once, inside `<AuthGate>` around `<Frame />` (needs StoreProvider for `useStore`, BrowserRouter for `useNavigate`). Every `/teacher/*` screen's `useTeacher()` now resolves; the floating QuickActions menu still renders only for teacher sessions.
- NEW `src/components/ErrorBoundary.tsx`: root class-component boundary (getDerivedStateFromError + componentDidCatch logging error + component stack to console). Renders a calm full-page state ("Something went wrong on this screen", data-safe copy) with **Back to home** (clears boundary state, `window.location.href='/'`) and a secondary Reload. Deliberately dependency-free (no store/router context) so it renders even when the crash is in the store/kernel/router.
- `src/App.tsx`: `<ErrorBoundary>` wraps the whole `<BrowserRouter>` tree — any render crash anywhere below keeps the tree mounted.

### Fix 2 — Demo credential + ungated surfaces in prod
- NEW `src/lib/demoMode.ts`: single `export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === '1'` gate (do not read the env var ad hoc).
- NEW `app/.env.development`: `VITE_DEMO_MODE=1`. Vite loads `.env.development` only in development mode → `npm run build` (production) ships **no demo UI**; dev keeps it. `VITE_DEMO_MODE=1 npm run build` opts a prod build back in for verification.
- (a) `src/screens/Login.tsx`: the "Try SchoolOS: pick a role" grid + password hint + demo phone list render only `{DEMO_MODE && …}`. `DEMO_PASSWORD` stays in code (per audit) but the login grid no longer surfaces it in prod.
- (a) `src/App.tsx`: `/demo`, `/demo/day`, `/demo/parent`, `/demo/summary`, `/live` routes render only under the flag (unregistered in prod → fall through to NotFound). Belt-and-braces: the demo lazy loaders are `DEMO_BUILD ? lazy(import(…)) : NotFound`, and App.tsx reads the env var **inline** (`DEMO_BUILD`) so Vite folds it per-file and Rollup eliminates the Demo*/LiveMode chunks from the prod bundle entirely (verified: 0 such chunks in prod dist; all present in the demo build).
- (a) `src/components/Shell.tsx` `useNavItems()`: the `/demo` sidebar nav entry is filtered out when not in demo mode (dead link otherwise).
- (b) `src/App.tsx`: `'/live'` added to `staffOnly`; `/live` route element is now `<S><LiveMode /></S>` (Guard + PageShell + Suspense).
- (c) `src/components/Shell.tsx`: new `useChromeIdentity()` hook — Topbar identity (ProfileMenu + SidebarFooter) comes from the authenticated session (`useSession` — live /me user: name, title-cased role, email) when `DEMO_MODE` is off; demoAccounts personas display only in demo mode. Avatar initials follow the same identity.
- (d) `src/components/Shell.tsx` ProfileMenu: the "Switch demo role" persona switcher (and its separator) renders only `{DEMO_MODE && …}`.

### Fix 3 — teacherFixtures 401 handling (teacherFixtures.ts:116–124)
- `src/services/teacherFixtures.ts`: both `call()` (TU-1 home/brief transport) and `flowCall()` (TU-2 flow transport) now handle `401 && !path.startsWith('/auth/')` exactly like liveApi: clear `schoolos.session` + token (`setToken(null)`), redirect to `/login?return=<current path>`, throw `'session expired'`. Teacher screens never render a raw "HTTP 401".

### Fix 4 — 401 redirect with return-URL in all 4 fetch wrappers + Login honors `?return`
- `src/services/liveApi.ts`: new exported `redirectToLoginWithReturn()` — `window.location.href = '/login?return=' + encodeURIComponent(pathname + search + hash)`. `call()`'s 401 branch uses it.
- `src/services/coordApi.ts`, `src/services/parentApi.ts`, `src/services/studentApi.ts`: their local `call()`/`studentCall()` 401 branches now use the same helper (keeps the "identical contract" law; one implementation, no drift).
- `src/screens/Login.tsx`: reads `?return=` via `useSearchParams`, sanitized to in-app absolute paths only (must start with `/`, must not start with `//` — no open redirect); after successful auth `navigate(returnTo, { replace: true })`, default `/today`.
- Consistency: ProfileMenu sign-out and `components/student/SessionSafety.tsx` sign-out also route through `redirectToLoginWithReturn()` so the next sign-in returns the user to their page. **Grep result: `href='/login'` bare literal count = 0** across `app/src/**`; the only remaining literal targets are `/login?return=…` (liveApi helper) and `/` (ErrorBoundary back-home).

### Fix 5 — SyncBanner fabrication (store.tsx:55 seeded 12)
- `src/state/store.tsx`: `offlineQueue` initial state **12 → 0**. No fabricated "12 offline changes queued"; SyncBanner (`src/App.tsx`) still shows the honest browser-offline notice, and the queue count only appears when real `offline/queue` dispatches accumulate (or a `sync/flush` clears them). Banner text now also handles singular ("1 offline change queued").

### Fix 6 — staffOnly drift (App.tsx:171)
- `src/App.tsx` Guard `staffOnly` list += `'/plugins'`, `'/settings'`, `'/library'` (drift closed; these now answer parents/students with the calm "Not available on this account" state). `/student/home2` deliberately NOT added (stays student-accessible per audit). `'/live'` added per fix 2b.

### Verification (all green)
1. `npx tsc -b --force` → **exit 0**
2. `npm run build` → **success** (✓ built in ~0.7s; demo chunks eliminated: LiveMode=0, Demo*=0; bundle strings "Switch demo role"=0 files, "Try SchoolOS: pick a role"=0 files)
3. `VITE_DEMO_MODE=1 npm run build` → **success** (demo routes/chunks present: "Switch demo role"=1 in index chunk)
4. Grep checks: `TeacherProvider` mounted in App.tsx ✓ · `<ErrorBoundary>` wraps `<BrowserRouter>` ✓ · bare `href='/login'` count = **0** ✓ · `offlineQueue: 0` seeded ✓
5. oxlint on all 12 touched files: 0 errors, 9 warnings — all confirmed pre-existing on the clean tree (same rules, line-shifted); no new lint debt.
6. Dev-mode flag: `app/.env.development` sets `VITE_DEMO_MODE=1` (Vite loads it only for development mode; verified the prod build does not read it and the shell-env build does).

### Deviations / notes
- **SidebarFooter identity (Shell.tsx)** also driven from the authenticated session — same file, same demoAccounts-persona leak class as the flagged Topbar line; leaving it would have shown a fabricated persona next to the fixed Topbar. Reported as a deliberate same-class extension.
- **Sign-out redirects** (ProfileMenu, SessionSafety) now include `?return=` for grep-consistency with the "no bare `/login`" rule; behavior change is limited to post-re-login landing (same screen you signed out of).
- **`/live` route element** changed from bare `<LiveMode />` to `<S><LiveMode /></S>` (adds Guard + PageShell + Suspense) — required by fix 2b.
- Demo screen **chunks** are additionally tree-shaken from the prod bundle (unreachable routes alone would have left dead chunks in dist). Achieved by inlining the env read in App.tsx (`DEMO_BUILD`) so Vite's per-file replacement happens before Rollup tree-shaking; `lib/demoMode.ts` remains the canonical runtime gate for Shell/Login.
- Server test suite intentionally NOT executed (lane law: other lanes share the DB). No files outside `app/` touched.

**Files changed (13):** `app/src/App.tsx`, `app/src/components/Shell.tsx`, `app/src/components/ErrorBoundary.tsx` (new), `app/src/components/student/SessionSafety.tsx`, `app/src/screens/Login.tsx`, `app/src/lib/demoMode.ts` (new), `app/src/services/liveApi.ts`, `app/src/services/coordApi.ts`, `app/src/services/parentApi.ts`, `app/src/services/studentApi.ts`, `app/src/services/teacherFixtures.ts`, `app/src/state/store.tsx`, `app/.env.development` (new).

## 2026-09-09 — Re-scan cycle-1 P3 fix: light-role dead-end on staff routes

### Fix 7 — Guard dead-end for authenticated parents/students (App.tsx Guard)
- `src/App.tsx` Guard: when the **authenticated** role is light (`live.role` is parent/student) and the path is `staffOnly`, the Guard now **redirects to the role's home** (`/parent/family` / `/student/home2`, `replace`) instead of rendering the "Not available on this account" dead end. Rationale: post-login landing is `/today` (the default `returnTo`), so every real parent/student sign-in previously ended on a locked screen whose guidance referenced the demo role switcher — which exists only under `VITE_DEMO_MODE=1`.
- The demo-preview path is unchanged: a staff member previewing a light role via the switcher (`session.roleId` light, `live.role` staff) still gets the informative locked screen with the "switch back" copy.
- No loop risk: neither `/parent/family` nor `/student/home2` is in `staffOnly`; redirect fires only on `staffOnly` paths.
- Verified: `npx tsc -b --force` exit 0; no other files touched.

**Files changed (1):** `app/src/App.tsx`.
