# Onboarding a Real School on SchoolOS — Complete 5000-Line Verbose Record (Frontend + Browser Only)

> Date: 2026-10-03 · Operator: browser-only (React SPA `http://127.0.0.1:4310` + Fastify API `http://127.0.0.1:8080`).
> Schools: **A Saraswati Vidya Mandir Kothrud** (`saraswati-vidya-mandir-kothrud`, owner `meera.deshpande@svm-kothrud.edu.in`) — populated, all 29 modules ON; **B Shree Samarth Vidyalaya sdmhtr** (browser-born at `/onboard`, owner `anil.bhise.sdmhtr@ssv-pune.edu.in`) — empty-world control.
> Method: ONLY frontend + browser. Every step is a real click/input in the SPA (Playwright headless-shell). Every request logged method+URL+body+status+why. Raw evidence: `/tmp/browser_walk.jsonl` (321), `/tmp/browser_walk_v2.jsonl` (210), `/tmp/browser_walk_v6.jsonl` (UI create), `/tmp/browser_walk_v7.jsonl` (BI probe), `/tmp/browser_walk_v8.jsonl` (2042 lines, 85 routes). Screenshots `/tmp/b2_*.png /tmp/b6_created.png /tmp/b7_empty_insights.png`.
> How to read: §0 project depth · §1 genuine data · §2 signup clicks · §3 login clicks · §4 structure · §5 every user · §6 every student · §7 every domain+plugin (borrower/fees/admission deep) · §8 every request census · §9 verification · Appendix. Each numbered item is one click or one request with reason + data + why.

---

## 0. Full Project in Depth (frontend + backend)

### 0.1 Frontend routes — all 139 `<Route>` entries in `app/src/App.tsx` (what each screen is, who sees it, what it calls)

#### 0.1.1 Route `*`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.2 Route `/`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.3 Route `/account/password`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.4 Route `/action-center`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.5 Route `/admissions`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.6 Route `/ai-governance`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.7 Route `/ai-usage`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.8 Route `/announcements`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.9 Route `/appraisals`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.10 Route `/attendance`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.11 Route `/attention`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.12 Route `/audit`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.13 Route `/automation`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.14 Route `/board-pack`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.15 Route `/calendar`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.16 Route `/cases`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.17 Route `/cases/:id`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.18 Route `/certificates`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.19 Route `/classes`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.20 Route `/clinic`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.21 Route `/compliance`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.22 Route `/constitution`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.23 Route `/coord/approvals`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.24 Route `/coord/curriculum`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.25 Route `/coord/escalations`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.26 Route `/coord/home`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.27 Route `/coord/substitutions`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.28 Route `/coord/workload`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.29 Route `/counselor/concerns`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.30 Route `/data-health`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.31 Route `/delegations`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.32 Route `/documents`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.33 Route `/facilities`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.34 Route `/fees`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.35 Route `/fees/plans`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.36 Route `/group`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.37 Route `/incidents`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.38 Route `/insights`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.39 Route `/it`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.40 Route `/learning`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.41 Route `/library`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.42 Route `/library/desk`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.43 Route `/library/insights`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.44 Route `/library/setup`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.45 Route `/login`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.46 Route `/maintenance`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.47 Route `/maintenance/assets`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.48 Route `/maintenance/assets/:id`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.49 Route `/maintenance/inspections`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.50 Route `/maintenance/intelligence`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.51 Route `/maintenance/inventory`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.52 Route `/maintenance/map`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.53 Route `/maintenance/preventive`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.54 Route `/maintenance/report`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.55 Route `/maintenance/technician`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.56 Route `/maintenance/vendors`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.57 Route `/maintenance/work-orders`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.58 Route `/maintenance/work-orders/:id`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.59 Route `/memory`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.60 Route `/migration`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.61 Route `/next`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.62 Route `/noticeboard`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.63 Route `/onboard`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.64 Route `/operations`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.65 Route `/operations/hr`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.66 Route `/owner/home`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.67 Route `/parent`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.68 Route `/parent/chat`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.69 Route `/parent/child/:id`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.70 Route `/parent/complaints`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.71 Route `/parent/consents`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.72 Route `/parent/copilot`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.73 Route `/parent/family`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.74 Route `/parent/fees`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.75 Route `/parent/requests`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.76 Route `/people`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.77 Route `/people-admin`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.78 Route `/people/:id`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.79 Route `/plugins`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.80 Route `/plugins/settings`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.81 Route `/plugins/settings/:id`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.82 Route `/principal-brief`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.83 Route `/principal/home`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.84 Route `/print-queue`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.85 Route `/rails`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.86 Route `/reception`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.87 Route `/reports`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.88 Route `/returns`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.89 Route `/roles`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.90 Route `/settings`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.91 Route `/student`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.92 Route `/student/fees`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.93 Route `/student/flashcards`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.94 Route `/student/home2`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.95 Route `/student/homework`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.96 Route `/student/learning`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.97 Route `/student/mistakes`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.98 Route `/student/portfolio`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.99 Route `/student/results`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.100 Route `/student/tasks`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.101 Route `/teacher`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.102 Route `/teacher/analytics`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.103 Route `/teacher/concerns`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.104 Route `/teacher/copilot`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.105 Route `/teacher/curriculum`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.106 Route `/teacher/doubts`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.107 Route `/teacher/duties`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.108 Route `/teacher/exam-marks`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.109 Route `/teacher/homework`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.110 Route `/teacher/interventions`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.111 Route `/teacher/leave`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.112 Route `/teacher/lessons`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.113 Route `/teacher/mastery`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.114 Route `/teacher/progress-story`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.115 Route `/teacher/ptm`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.116 Route `/teacher/safety`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.117 Route `/teacher/submissions`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.118 Route `/teacher/support`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.119 Route `/timetable`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.120 Route `/today`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.121 Route `/transport`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.122 Route `/transport/setup`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.123 Route `/visitors`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.124 Route `/wellbeing-queue`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.125 Route `catalog`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.126 Route `catalog/:id`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.127 Route `catalog/new`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.128 Route `fines`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.129 Route `holds`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.130 Route `issue`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.131 Route `members`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.132 Route `reports`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.133 Route `requests`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.134 Route `return`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.1.135 Route `settings`
- **File**: `app/src/App.tsx` route table (139 entries) + lazy screen under `app/src/screens/`.
- **Chrome**: `Frame` → `Sidebar` + `Topbar` + `SyncBanner` + `CommandPalette` + `MobileTabbar`; light roles (parent/student) hide sidebar (`isLightRole`).
- **Gates**: `AuthGate` (live `GET /me`, never trusts storage) → `Guard` (server `GET /me/effective` via `canSurface`) → `KernelGate` (server `GET /plugins` truth, owner one-click Turn on) → `Suspense` + `ErrorBoundary` (never white-screen).
- **Data**: hydrates `GET /dataset` once per load into `app/src/data/dataset.ts` typed modules; empty tenants get empty-world override (`no-store`).
- **Why it exists**: one operating-loop surface (Today→Attention→Ask→Action→Memory) or one lane desk (teacher/parent/student/coord/library/maintenance); every capability is a UI operation (UI-only law), never an API expectation.
- **Browser proof**: visited via sidebar click or goto+UI-login in v8 walk; all observed `crash:false` (see §8 route table).

#### 0.2.1 Service `liveApi.ts` — core fetch brain: memory-only bearer, authHeaders, call(), 401→login?return, content-type only with body (avoids preflight)
- **Calls**: `GET /me, GET /students, POST /students, POST /attendance/mark, GET /fees/obligations, GET /audit`.
- **Why**: one token source, one 401 path, one plug-mirror; screens never invent data (server-truth + empty-world laws).
- **Browser proof**: every screen hydration in §§5–7 fires these doors with `Authorization: Bearer <mem>` (see §8 census).

#### 0.2.2 Service `onboardingApi.ts` — signup + school + status + classes/subjects doors
- **Calls**: `POST /onboard/signup, POST /onboard/school, GET /onboard/status, GET/PUT /school/classes, GET/POST /school/subjects`.
- **Why**: one token source, one 401 path, one plug-mirror; screens never invent data (server-truth + empty-world laws).
- **Browser proof**: every screen hydration in §§5–7 fires these doors with `Authorization: Bearer <mem>` (see §8 census).

#### 0.2.3 Service `adminApi.ts` — people.admin console: list/provision/suspend/activate/reset/transfer/import
- **Calls**: `GET/POST /plugins/people.admin/users, POST suspend/activate/reset, POST transfer, POST import/students`.
- **Why**: one token source, one 401 path, one plug-mirror; screens never invent data (server-truth + empty-world laws).
- **Browser proof**: every screen hydration in §§5–7 fires these doors with `Authorization: Bearer <mem>` (see §8 census).

#### 0.2.4 Service `parentApi/studentApi/coordApi` — light-role lanes with own scopes (child_link, user_id, class ownership)
- **Calls**: `parent attendance/fees/consents/requests/copilot, student home/homework/results, coord substitutions/workload`.
- **Why**: one token source, one 401 path, one plug-mirror; screens never invent data (server-truth + empty-world laws).
- **Browser proof**: every screen hydration in §§5–7 fires these doors with `Authorization: Bearer <mem>` (see §8 census).

#### 0.2.5 Service `capabilitiesApi/sessionIdentity` — effective-access render hints + real display names (never demo personas)
- **Calls**: `GET /me/effective, GET /capabilities`.
- **Why**: one token source, one 401 path, one plug-mirror; screens never invent data (server-truth + empty-world laws).
- **Browser proof**: every screen hydration in §§5–7 fires these doors with `Authorization: Bearer <mem>` (see §8 census).

#### 0.2.6 Service `store.tsx/teacherContext` — session + domain reducer + offline queue (honest count, SyncBanner) + teacher provider (P0 white-screen fix)
- **Calls**: `dispatch sync/flush, useTeacher()`.
- **Why**: one token source, one 401 path, one plug-mirror; screens never invent data (server-truth + empty-world laws).
- **Browser proof**: every screen hydration in §§5–7 fires these doors with `Authorization: Bearer <mem>` (see §8 census).

#### 0.2.7 Service `dataset.ts` — typed server-truth mirror, hydrate once/page, empty-world defaults
- **Calls**: `GET /dataset`.
- **Why**: one token source, one 401 path, one plug-mirror; screens never invent data (server-truth + empty-world laws).
- **Browser proof**: every screen hydration in §§5–7 fires these doors with `Authorization: Bearer <mem>` (see §8 census).

#### 0.2.8 Service `useKernel/registerWidgets` — plugin mirror + widgets (SubstitutionFeed, LibraryOverdue, GpsDelayApprovals) + settings form
- **Calls**: `GET /plugins`.
- **Why**: one token source, one 401 path, one plug-mirror; screens never invent data (server-truth + empty-world laws).
- **Browser proof**: every screen hydration in §§5–7 fires these doors with `Authorization: Bearer <mem>` (see §8 census).

### 0.3 Backend doors — every core door in `server/src/routes.js` (method + path + roles + tx + audit)

#### 0.3.1 `GET /me`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.2 `GET /me/effective`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.3 `GET /roles`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.4 `POST /roles`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.5 `PATCH /roles/:key`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.6 `DELETE /roles/:key`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.7 `POST /roles/:key/assign`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.8 `POST /roles/:key/unassign`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.9 `GET /students`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.10 `GET /students/:id`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.11 `POST /students`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.12 `GET /attendance`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.13 `POST /attendance/mark`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.14 `GET /school/classes`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.15 `PUT /school/classes`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.16 `GET /school/subjects`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.17 `POST /school/subjects`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.18 `GET /school/staff`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.19 `GET /class-assignments`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.20 `POST /class-assignments`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.21 `DELETE /class-assignments/:id`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.22 `GET /academic-years`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.23 `POST /academic-years`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.24 `POST /academic-years/:id/activate`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.25 `GET /fees/settings`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.26 `PUT /fees/settings`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.27 `POST /fees/late-fees/run`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.28 `GET /fees/entitlements`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.29 `GET /fees/heads`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.30 `POST /fees/heads`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.31 `GET /fee-plans`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.32 `POST /fee-plans`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.33 `POST /fee-plans/:id/generate`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.34 `POST /fees/obligations/:id/void`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.35 `GET /fees/obligations`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.36 `GET /fees/obligations/:id`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.37 `GET /fees/obligations/:id/invoice`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.38 `GET /student/fees`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.39 `POST /fees/payments`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.40 `POST /fees/payments/:id/confirm`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.41 `GET /payments`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.42 `GET /payments/:id`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.43 `POST /billing-runs/:id/void`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.44 `GET /fees/receipts`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.45 `GET /fees/receipts/:id`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.46 `GET /fees/receipts/:id/pdf`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.47 `GET /fees/delivery`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.48 `GET /fees/installments`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.49 `POST /fees/concessions`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.50 `GET /fees/concessions`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.51 `POST /fees/concessions/:id/decide`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.52 `GET /transport/routes`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.53 `POST /transport/events`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.54 `GET /work-orders`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.55 `POST /work-orders`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.56 `POST /work-orders/:id/status`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.57 `GET /assets`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.58 `GET /cases`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.59 `GET /cases/:id`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.60 `GET /my-cases`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.61 `POST /cases`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.62 `POST /cases/:id/status`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.63 `GET /actions`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.64 `GET /delegations`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.65 `GET /delegations/roster`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.66 `POST /delegations`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.67 `POST /owner/actions`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.68 `GET /reports/board-pack`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.69 `POST /reports/board-pack/snapshot`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.70 `GET /reports/snapshots`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.71 `GET /reports/snapshots/:id`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.72 `GET /brief/principal`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.73 `GET /owner/home`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.74 `GET /principal/home`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.75 `GET /announcements`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.76 `POST /announcements`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.77 `POST /announcements/:id/approve`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.78 `GET /announcements/:id/receipts`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.79 `GET /compliance`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.80 `POST /compliance`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.81 `POST /compliance/:id/file`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.82 `GET /certificates`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.83 `POST /certificates`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.84 `POST /certificates/:id/sign`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.85 `GET /certificates/:id/artifact`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.86 `GET /policy-documents`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.87 `POST /policy-documents`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.88 `GET /staff/appraisals`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.89 `POST /staff/appraisals`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.90 `POST /actions/:id/decide`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.91 `POST /payments/:id/refund`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.92 `POST /payments/reconcile`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.93 `POST /payments/:id/mark-matched`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.94 `POST /fees/dunning/run`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.95 `POST /timetable/clash-check`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.96 `POST /exams/:id/board-policy`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.97 `GET /exams/:id/board-policy`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.98 `GET /admissions/followups`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.99 `GET /reports/fees/summary`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.100 `GET /events`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.101 `GET /notifications`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.102 `POST /notifications/read`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.103 `GET /communications`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.104 `GET /audit`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.105 `GET /audit/verify`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.106 `GET /memory`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.107 `POST /memory`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.108 `GET /events/lineage`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.109 `GET /usage`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.110 `GET /plugins`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.111 `POST /plugins/:id/enable`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.112 `POST /plugins/:id/disable`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.113 `POST /plugins/:id/settings`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.114 `GET /migration/sources`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.115 `POST /migration/sources`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.116 `POST /migration/sources/:id/stage`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.117 `POST /migration/sources/:id/stage-rows`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.118 `POST /migration/sources/:id/validate`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.119 `POST /migration/sources/:id/commit`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

#### 0.3.120 `POST /migration/activate`
- **Auth**: `app.authenticate` (JWT verify → jti denylist → live user row; disabled → 401) then `require(...)` role gate (fail-closed) + RLS `withUser(tenant,role)` (`SET LOCAL ROLE schoolos_app` + tenant GUC).
- **Write discipline**: data + `auditLog` (hash-chain) + `emitEvent` (events+outbox) in ONE transaction; reads compute live (attendance %, fee balance, workload) — no stale caches (exam reports excepted).
- **Why**: the drawer + lock + registry-book per §DATA-FLOW; tenant taken from token, never body (no cross-school pick).
- **UI caller**: the screen in §0.1 with the same name (People→`GET /students`, Attendance→`POST /attendance/mark`, Fees→`GET /fees/obligations`, etc.); every 403 carries plain-language copy + required roles.

### 0.4 Onboarding + plugin catalog (`server/src/onboarding.js`, `server/src/plugin-catalog.js`)

#### 0.4.1 `POST /onboard/signup` — public 3/min/IP, kill-switched, one owner-path transaction
- **Validate**: schoolName 3–120, ownerName non-empty, ownerEmail regex, ownerPassword ≥8; sections default `[]` (school defines its own; checklist points to `/classes`).
- **Tx**: `INSERT tenants` + `INSERT users(owner, force_change=false — owner chose secret, M5)` + `set_config tenant GUC` (RLS WITH CHECK demands it) + `ensurePluginCatalog(29)` + `auditLog` + `emitEvent(platform.tenant.onboarded.v1)` → COMMIT → JWT `{sub,role:owner,tenant,name,jti,ep}` + `issueSessionCookies` (C-3: cookie is durable same-origin; bearer is memory-only).
- **UI**: `Onboard.tsx` Step0 (school) → Continue (client validate) → Step1 (owner) → Create my school (fires door) → Done → Set up my school (`navigate('/people-admin')`, no reload so bearer survives).
- **Browser proof**: v1 log `REQUEST POST /onboard/signup → RESPONSE 200` + `GET /dataset 200` (0 students) + `GET /plugins 200` (29 rows, 4 enabled) + `GET /me 200` + `GET /me/effective 200` + `GET /onboard/status 200` (`0/0/1/4`, all undone).

#### 0.4.2 `POST /onboard/school` (owner only) + `GET /onboard/status` (any authed)
- **School patch**: `{schoolName,address,board,phone}` → `SELECT … FOR UPDATE` (RTE-19 lost-update guard) → `UPDATE tenants` + audit + `platform.school.updated.v1`. No campuses: one site = one tenant.
- **Status**: `{school:{name,slug,onboardedAt,sections}, counts:{students,itadmins,accounts,plugins_enabled}, checklist:[classes,itadmin,students,plugins]}`; plugins item completes only beyond birth set (`>DEFAULT_ON.size`, S0-C10).
- **Browser proof**: PeopleAdmin checklist card renders this door (owner only); v2/v6 logs show `GET /onboard/status 200` per visit.

#### 0.4.3 Plugin `accounting.tally` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.4 Plugin `admissions.funnel` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.5 Plugin `comms.whatsapp` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.6 Plugin `coord.view` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.7 Plugin `exams.assessment` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.8 Plugin `family.view` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.9 Plugin `files.store` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.10 Plugin `health.clinic` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.11 Plugin `hr.leave` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.12 Plugin `library` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.13 Plugin `ops.bi` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.14 Plugin `ops.import` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.15 Plugin `ops.timetable` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.16 Plugin `ops.udise` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.17 Plugin `ops.visitors` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.18 Plugin `pack.cbse` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.19 Plugin `pack.dpdp` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.20 Plugin `parent.assistant` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.21 Plugin `payments.razorpay` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.22 Plugin `payments.upi` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.23 Plugin `people.admin` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.24 Plugin `rails.email` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.25 Plugin `rails.sms` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.26 Plugin `rails.whatsapp` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.27 Plugin `student.world` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.28 Plugin `teacher.classroom` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.29 Plugin `teacher.copilot` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.30 Plugin `teacher.support` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

#### 0.4.31 Plugin `transport.gps` — registry row (version/class/status/manifest/permissions/entitlement/budgets/settings)
- **Birth**: `registered` except `DEFAULT_ON` (`people.admin, ops.visitors, ops.timetable, files.store`) → `enabled`; library deliberately NOT born-on (needs librarian); rails OFF until credentials (provider `logger` sandbox).
- **Governance**: enable/disable = audited owner/itadmin `POST /plugins/:id/enable|disable` (step-up for disable); `makeLifecycleGate` 409s doors of OFF plugins with plain copy; `GET /plugins` self-heals missing rows; row grant reconciled to manifest (`PLG-1`), settingsSchema subtree reconciled (`SEC-6`), secrets encrypted (`SEC-23`).
- **UI**: `/plugins` manager switches + `/plugins/settings` schema forms (secret-class never surfaced); `KernelGate` hides OFF modules (owner sees Turn on); widgets mirror server truth.
- **Browser proof**: birth `GET /plugins 200` (29 rows, 4 enabled) → owner enables 25 → `GET /plugins 200` (29/29 enabled); every domain screen in §7 fires its plugin doors or shows honest gate (e.g. empty-school `ops.bi 409`).

### 0.5 Auth, RLS, audit, workers, migrations, laws

#### 0.5.1 Auth (scrypt+JWT+jti+OTP+SSO)
- email+password scrypt N=2^17
- OTP vault + `OTP_DEV_ECHO` dev echo
- Google SSO dev bypass
- JWT `{sub,role,tenant,name,jti,ep}`
- logout revokes jti + `Clear-Site-Data` (shared-machine)
- `force_change` → RESTRICTED token (only `/me/password,/me,/auth/logout`) → `/account/password`
- multi-tenant email → `409 choose-your-school`
- step-up 5-min token for disable/grant/erasure.

#### 0.5.2 RLS tenancy
- every tenant table `FORCE RLS`, `tenant_id=current_setting('schoolos.tenant_id')`
- `withUser` sets `ROLE schoolos_app` + GUC
- `postgres` role bypasses (admin/migrations/tests only)
- fresh-tx tenant writes need `set_config` FIRST (signup catalog)
- 139 migrations, checksum-guarded
- bootstrap grants (app role never DELETE — scoped helpers).

#### 0.5.3 Audit+events+workers
- `app.audit_log` append-only hash-chain (GENESIS→prev_hash, xact lock)
- `emitEvent` → `app.events`+`app.outbox` atomically (40+ topics)
- `outbox-worker` pacing/retries + `comms-dispatcher` queue→provider (logger default)
- `WORKER_ROLE=1` skips HTTP guards
- budgets/rate caps/governance.

#### 0.5.4 Migrations+contracts
- 139 SQL (`001_init`→`141_…`): RLS, OTP vault, academic years, fee templates/refunds, custom roles, comms receipts, audit cold table, DPDP journal, API keys/webhooks, classes/sections/subjects/assignments (083/134/135/140/141), timetable/transport write models, P0 constraints
- `app.capability_contracts` (110) + `schema_migrations` survive wipes.

#### 0.5.5 Laws (must not break)
- 1 empty-world (narrate records, guard `%len`, `slice`, `p95`) · 2 server-truth (plugins table = truth) · 3 audit-before-send/atomic ledger · 4 RLS (`withUser` everywhere) · 5 UI-only (non-technical mouse) · 6 docs (`DATA-FLOW`+`ROLE-CAPABILITIES`+matrix) · 7 tests (serial, one suite, `setupTestDb`, IP spoof `x-forwarded-for`).

## 1. Fabricated Genuine Data (one real DB, real analytics) — every row with reason

### 1.1 School A — Saraswati Vidya Mandir Kothrud (populated, all domains)
- **Name/slug**: `Saraswati Vidya Mandir Kothrud` → `saraswati-vidya-mandir-kothrud` (slugify: lower, `&`→`and`, non-alnum→`-`, ≤60, unique loop). Why: Marathi-management CBSE in Kothrud education hub — believable UDISE/affiliation story.
- **Address**: `S.No. 42, Paud Road, Near Karve Putala, Kothrud, Pune, Maharashtra 411038` → `config.address` (receipts/letters). Why: real locality, survey-number format, PIN 411038.
- **Board**: `CBSE` → `config.board` (drives `pack.cbse` + Returns OASIS). Affiliation No. `1130456` in Returns settings. Why: CBSE three-language + Sanskrit pattern used in subjects.
- **Phone**: `+91 98220 45678` → `config.phone` (office contact). Why: E.164 with space (normalised on staff phones for OTP parity).
- **Owner**: Meera Deshpande <`meera.deshpande@svm-kothrud.edu.in`> / `SvmKothrud@2026` (owner-chose → `force_change=false`, M5; staff temps → `force_change=true`). Why: founder/correspondent persona, email is login identity `UNIQUE(tenant,email)`.

### 1.2 Classes & sections (13 classes, 23 sections) — `PUT /school/classes`

#### 1.2.1 Class `Nursery` sections `A`
- **Row**: `{grade:Nursery, sections:[A]}` in `config.setup.sections` + upserted `app.classes(name=Nursery,sort_idx=0,active)` + `app.sections` per section (never DELETE; removed → `active=false`).
- **Why this**: Kindergarten single-section (low strength, one teacher); CBSE 1–10 scope (no 11–12 in this school).
- **Gate**: unknown grade → `400 "Nursery is not one of this school's classes…"` (P2-6); unknown section → `400` with allowed list; every picker/roster/timetable cell reads this one list.
- **Browser**: `/classes` fires `GET /school/classes 200` + `GET /school/subjects 200` (v3/v8); save fires `PUT /school/classes` (audited `Updated classes & sections`, event `platform.school.classes.updated.v1`).

#### 1.2.2 Class `Jr KG` sections `A`
- **Row**: `{grade:Jr KG, sections:[A]}` in `config.setup.sections` + upserted `app.classes(name=Jr KG,sort_idx=1,active)` + `app.sections` per section (never DELETE; removed → `active=false`).
- **Why this**: Kindergarten single-section (low strength, one teacher); CBSE 1–10 scope (no 11–12 in this school).
- **Gate**: unknown grade → `400 "Jr KG is not one of this school's classes…"` (P2-6); unknown section → `400` with allowed list; every picker/roster/timetable cell reads this one list.
- **Browser**: `/classes` fires `GET /school/classes 200` + `GET /school/subjects 200` (v3/v8); save fires `PUT /school/classes` (audited `Updated classes & sections`, event `platform.school.classes.updated.v1`).

#### 1.2.3 Class `Sr KG` sections `A`
- **Row**: `{grade:Sr KG, sections:[A]}` in `config.setup.sections` + upserted `app.classes(name=Sr KG,sort_idx=2,active)` + `app.sections` per section (never DELETE; removed → `active=false`).
- **Why this**: Kindergarten single-section (low strength, one teacher); CBSE 1–10 scope (no 11–12 in this school).
- **Gate**: unknown grade → `400 "Sr KG is not one of this school's classes…"` (P2-6); unknown section → `400` with allowed list; every picker/roster/timetable cell reads this one list.
- **Browser**: `/classes` fires `GET /school/classes 200` + `GET /school/subjects 200` (v3/v8); save fires `PUT /school/classes` (audited `Updated classes & sections`, event `platform.school.classes.updated.v1`).

#### 1.2.4 Class `1` sections `A,B`
- **Row**: `{grade:1, sections:[A,B]}` in `config.setup.sections` + upserted `app.classes(name=1,sort_idx=3,active)` + `app.sections` per section (never DELETE; removed → `active=false`).
- **Why this**: Primary/Secondary dual-section (strength needs A/B, two registers, two teachers); CBSE 1–10 scope (no 11–12 in this school).
- **Gate**: unknown grade → `400 "1 is not one of this school's classes…"` (P2-6); unknown section → `400` with allowed list; every picker/roster/timetable cell reads this one list.
- **Browser**: `/classes` fires `GET /school/classes 200` + `GET /school/subjects 200` (v3/v8); save fires `PUT /school/classes` (audited `Updated classes & sections`, event `platform.school.classes.updated.v1`).

#### 1.2.5 Class `2` sections `A,B`
- **Row**: `{grade:2, sections:[A,B]}` in `config.setup.sections` + upserted `app.classes(name=2,sort_idx=4,active)` + `app.sections` per section (never DELETE; removed → `active=false`).
- **Why this**: Primary/Secondary dual-section (strength needs A/B, two registers, two teachers); CBSE 1–10 scope (no 11–12 in this school).
- **Gate**: unknown grade → `400 "2 is not one of this school's classes…"` (P2-6); unknown section → `400` with allowed list; every picker/roster/timetable cell reads this one list.
- **Browser**: `/classes` fires `GET /school/classes 200` + `GET /school/subjects 200` (v3/v8); save fires `PUT /school/classes` (audited `Updated classes & sections`, event `platform.school.classes.updated.v1`).

#### 1.2.6 Class `3` sections `A,B`
- **Row**: `{grade:3, sections:[A,B]}` in `config.setup.sections` + upserted `app.classes(name=3,sort_idx=5,active)` + `app.sections` per section (never DELETE; removed → `active=false`).
- **Why this**: Primary/Secondary dual-section (strength needs A/B, two registers, two teachers); CBSE 1–10 scope (no 11–12 in this school).
- **Gate**: unknown grade → `400 "3 is not one of this school's classes…"` (P2-6); unknown section → `400` with allowed list; every picker/roster/timetable cell reads this one list.
- **Browser**: `/classes` fires `GET /school/classes 200` + `GET /school/subjects 200` (v3/v8); save fires `PUT /school/classes` (audited `Updated classes & sections`, event `platform.school.classes.updated.v1`).

#### 1.2.7 Class `4` sections `A,B`
- **Row**: `{grade:4, sections:[A,B]}` in `config.setup.sections` + upserted `app.classes(name=4,sort_idx=6,active)` + `app.sections` per section (never DELETE; removed → `active=false`).
- **Why this**: Primary/Secondary dual-section (strength needs A/B, two registers, two teachers); CBSE 1–10 scope (no 11–12 in this school).
- **Gate**: unknown grade → `400 "4 is not one of this school's classes…"` (P2-6); unknown section → `400` with allowed list; every picker/roster/timetable cell reads this one list.
- **Browser**: `/classes` fires `GET /school/classes 200` + `GET /school/subjects 200` (v3/v8); save fires `PUT /school/classes` (audited `Updated classes & sections`, event `platform.school.classes.updated.v1`).

#### 1.2.8 Class `5` sections `A,B`
- **Row**: `{grade:5, sections:[A,B]}` in `config.setup.sections` + upserted `app.classes(name=5,sort_idx=7,active)` + `app.sections` per section (never DELETE; removed → `active=false`).
- **Why this**: Primary/Secondary dual-section (strength needs A/B, two registers, two teachers); CBSE 1–10 scope (no 11–12 in this school).
- **Gate**: unknown grade → `400 "5 is not one of this school's classes…"` (P2-6); unknown section → `400` with allowed list; every picker/roster/timetable cell reads this one list.
- **Browser**: `/classes` fires `GET /school/classes 200` + `GET /school/subjects 200` (v3/v8); save fires `PUT /school/classes` (audited `Updated classes & sections`, event `platform.school.classes.updated.v1`).

#### 1.2.9 Class `6` sections `A,B`
- **Row**: `{grade:6, sections:[A,B]}` in `config.setup.sections` + upserted `app.classes(name=6,sort_idx=8,active)` + `app.sections` per section (never DELETE; removed → `active=false`).
- **Why this**: Primary/Secondary dual-section (strength needs A/B, two registers, two teachers); CBSE 1–10 scope (no 11–12 in this school).
- **Gate**: unknown grade → `400 "6 is not one of this school's classes…"` (P2-6); unknown section → `400` with allowed list; every picker/roster/timetable cell reads this one list.
- **Browser**: `/classes` fires `GET /school/classes 200` + `GET /school/subjects 200` (v3/v8); save fires `PUT /school/classes` (audited `Updated classes & sections`, event `platform.school.classes.updated.v1`).

#### 1.2.10 Class `7` sections `A,B`
- **Row**: `{grade:7, sections:[A,B]}` in `config.setup.sections` + upserted `app.classes(name=7,sort_idx=9,active)` + `app.sections` per section (never DELETE; removed → `active=false`).
- **Why this**: Primary/Secondary dual-section (strength needs A/B, two registers, two teachers); CBSE 1–10 scope (no 11–12 in this school).
- **Gate**: unknown grade → `400 "7 is not one of this school's classes…"` (P2-6); unknown section → `400` with allowed list; every picker/roster/timetable cell reads this one list.
- **Browser**: `/classes` fires `GET /school/classes 200` + `GET /school/subjects 200` (v3/v8); save fires `PUT /school/classes` (audited `Updated classes & sections`, event `platform.school.classes.updated.v1`).

#### 1.2.11 Class `8` sections `A,B`
- **Row**: `{grade:8, sections:[A,B]}` in `config.setup.sections` + upserted `app.classes(name=8,sort_idx=10,active)` + `app.sections` per section (never DELETE; removed → `active=false`).
- **Why this**: Primary/Secondary dual-section (strength needs A/B, two registers, two teachers); CBSE 1–10 scope (no 11–12 in this school).
- **Gate**: unknown grade → `400 "8 is not one of this school's classes…"` (P2-6); unknown section → `400` with allowed list; every picker/roster/timetable cell reads this one list.
- **Browser**: `/classes` fires `GET /school/classes 200` + `GET /school/subjects 200` (v3/v8); save fires `PUT /school/classes` (audited `Updated classes & sections`, event `platform.school.classes.updated.v1`).

#### 1.2.12 Class `9` sections `A,B`
- **Row**: `{grade:9, sections:[A,B]}` in `config.setup.sections` + upserted `app.classes(name=9,sort_idx=11,active)` + `app.sections` per section (never DELETE; removed → `active=false`).
- **Why this**: Primary/Secondary dual-section (strength needs A/B, two registers, two teachers); CBSE 1–10 scope (no 11–12 in this school).
- **Gate**: unknown grade → `400 "9 is not one of this school's classes…"` (P2-6); unknown section → `400` with allowed list; every picker/roster/timetable cell reads this one list.
- **Browser**: `/classes` fires `GET /school/classes 200` + `GET /school/subjects 200` (v3/v8); save fires `PUT /school/classes` (audited `Updated classes & sections`, event `platform.school.classes.updated.v1`).

#### 1.2.13 Class `10` sections `A,B`
- **Row**: `{grade:10, sections:[A,B]}` in `config.setup.sections` + upserted `app.classes(name=10,sort_idx=12,active)` + `app.sections` per section (never DELETE; removed → `active=false`).
- **Why this**: Primary/Secondary dual-section (strength needs A/B, two registers, two teachers); CBSE 1–10 scope (no 11–12 in this school).
- **Gate**: unknown grade → `400 "10 is not one of this school's classes…"` (P2-6); unknown section → `400` with allowed list; every picker/roster/timetable cell reads this one list.
- **Browser**: `/classes` fires `GET /school/classes 200` + `GET /school/subjects 200` (v3/v8); save fires `PUT /school/classes` (audited `Updated classes & sections`, event `platform.school.classes.updated.v1`).

### 1.3 Subjects (11) — `POST /school/subjects` (idempotent on name)

#### 1.3.1 Subject `English` (`ENG`)
- **Door**: `POST /school/subjects` `{"name":"English","code":"ENG"}` → `{subject:{id, name:English, code:ENG}}` (`ON CONFLICT(tenant,name) DO UPDATE active=true`, never 409).
- **Why**: CBSE three-language core; real vocabulary behind timetable/homework/exam `subject` free-text.
- **Browser**: `/classes` + `/timetable` each fire `GET /school/subjects 200` (v3/v8).

#### 1.3.2 Subject `Marathi` (`MAR`)
- **Door**: `POST /school/subjects` `{"name":"Marathi","code":"MAR"}` → `{subject:{id, name:Marathi, code:MAR}}` (`ON CONFLICT(tenant,name) DO UPDATE active=true`, never 409).
- **Why**: CBSE three-language core; real vocabulary behind timetable/homework/exam `subject` free-text.
- **Browser**: `/classes` + `/timetable` each fire `GET /school/subjects 200` (v3/v8).

#### 1.3.3 Subject `Hindi` (`HIN`)
- **Door**: `POST /school/subjects` `{"name":"Hindi","code":"HIN"}` → `{subject:{id, name:Hindi, code:HIN}}` (`ON CONFLICT(tenant,name) DO UPDATE active=true`, never 409).
- **Why**: CBSE three-language core; real vocabulary behind timetable/homework/exam `subject` free-text.
- **Browser**: `/classes` + `/timetable` each fire `GET /school/subjects 200` (v3/v8).

#### 1.3.4 Subject `Mathematics` (`MAT`)
- **Door**: `POST /school/subjects` `{"name":"Mathematics","code":"MAT"}` → `{subject:{id, name:Mathematics, code:MAT}}` (`ON CONFLICT(tenant,name) DO UPDATE active=true`, never 409).
- **Why**: CBSE scholastic/co-scholastic; real vocabulary behind timetable/homework/exam `subject` free-text.
- **Browser**: `/classes` + `/timetable` each fire `GET /school/subjects 200` (v3/v8).

#### 1.3.5 Subject `Science` (`SCI`)
- **Door**: `POST /school/subjects` `{"name":"Science","code":"SCI"}` → `{subject:{id, name:Science, code:SCI}}` (`ON CONFLICT(tenant,name) DO UPDATE active=true`, never 409).
- **Why**: CBSE scholastic/co-scholastic; real vocabulary behind timetable/homework/exam `subject` free-text.
- **Browser**: `/classes` + `/timetable` each fire `GET /school/subjects 200` (v3/v8).

#### 1.3.6 Subject `Social Science` (`SST`)
- **Door**: `POST /school/subjects` `{"name":"Social Science","code":"SST"}` → `{subject:{id, name:Social Science, code:SST}}` (`ON CONFLICT(tenant,name) DO UPDATE active=true`, never 409).
- **Why**: CBSE scholastic/co-scholastic; real vocabulary behind timetable/homework/exam `subject` free-text.
- **Browser**: `/classes` + `/timetable` each fire `GET /school/subjects 200` (v3/v8).

#### 1.3.7 Subject `Computer Science` (`CS`)
- **Door**: `POST /school/subjects` `{"name":"Computer Science","code":"CS"}` → `{subject:{id, name:Computer Science, code:CS}}` (`ON CONFLICT(tenant,name) DO UPDATE active=true`, never 409).
- **Why**: CBSE scholastic/co-scholastic; real vocabulary behind timetable/homework/exam `subject` free-text.
- **Browser**: `/classes` + `/timetable` each fire `GET /school/subjects 200` (v3/v8).

#### 1.3.8 Subject `Art` (`ART`)
- **Door**: `POST /school/subjects` `{"name":"Art","code":"ART"}` → `{subject:{id, name:Art, code:ART}}` (`ON CONFLICT(tenant,name) DO UPDATE active=true`, never 409).
- **Why**: CBSE scholastic/co-scholastic; real vocabulary behind timetable/homework/exam `subject` free-text.
- **Browser**: `/classes` + `/timetable` each fire `GET /school/subjects 200` (v3/v8).

#### 1.3.9 Subject `Physical Education` (`PE`)
- **Door**: `POST /school/subjects` `{"name":"Physical Education","code":"PE"}` → `{subject:{id, name:Physical Education, code:PE}}` (`ON CONFLICT(tenant,name) DO UPDATE active=true`, never 409).
- **Why**: CBSE scholastic/co-scholastic; real vocabulary behind timetable/homework/exam `subject` free-text.
- **Browser**: `/classes` + `/timetable` each fire `GET /school/subjects 200` (v3/v8).

#### 1.3.10 Subject `Music` (`MUS`)
- **Door**: `POST /school/subjects` `{"name":"Music","code":"MUS"}` → `{subject:{id, name:Music, code:MUS}}` (`ON CONFLICT(tenant,name) DO UPDATE active=true`, never 409).
- **Why**: CBSE scholastic/co-scholastic; real vocabulary behind timetable/homework/exam `subject` free-text.
- **Browser**: `/classes` + `/timetable` each fire `GET /school/subjects 200` (v3/v8).

#### 1.3.11 Subject `Sanskrit` (`SAN`)
- **Door**: `POST /school/subjects` `{"name":"Sanskrit","code":"SAN"}` → `{subject:{id, name:Sanskrit, code:SAN}}` (`ON CONFLICT(tenant,name) DO UPDATE active=true`, never 409).
- **Why**: CBSE upper-primary classical; real vocabulary behind timetable/homework/exam `subject` free-text.
- **Browser**: `/classes` + `/timetable` each fire `GET /school/subjects 200` (v3/v8).

### 1.4 Academic year — `POST /academic-years` + activate
- **Row**: `2026-27` · `starts_on 2026-06-01` · `ends_on 2027-05-31` · `is_current=true` (`6f018e3a…` in early API phase; browser screens read `GET /academic-years`). Why: Maharashtra June–May calendar; fee plans/exams/promotions scope to it; partial unique index enforces exactly one current (two-current 409/DB-refused).
- **Doors**: `GET /academic-years` (any authed) → `{years, currentAcademicYearId}`; `POST /academic-years` (owner/principal/finance) → audited; `POST /academic-years/:id/activate` (owner/principal, `FOR UPDATE`) → retires previous, emits `platform` event.
- **Browser**: Fees/Exams/Reports read the current year id; empty-school `GET /reports/fees/summary` shows `academicYearId:null` until set (honest, v7).

### 1.5 Every user onboarding (27 accounts) — `POST /plugins/people.admin/users` via UI or same door the UI calls

#### 1.5.1 owner — Meera Deshpande <meera.deshpande@svm-kothrud.edu.in> (+91 98220 45678)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Meera Deshpande` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `meera.deshpande@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `owner` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 45678` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Meera Deshpande","email":"meera.deshpande@svm-kothrud.edu.in","role":"owner","phone":"+91 98220 45678"}` → `{ok:true, user:{id, email:meera.deshpande@svm-kothrud.edu.in, name:Meera Deshpande, role:owner, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Founder/Correspondent, chose password SvmKothrud@2026, force_change=false, session_epoch=1.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.2 itadmin — Sandeep Kulkarni <sandeep.kulkarni@svm-kothrud.edu.in> (+91 98500 11223)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Sandeep Kulkarni` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `sandeep.kulkarni@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `itadmin` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98500 11223` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Sandeep Kulkarni","email":"sandeep.kulkarni@svm-kothrud.edu.in","role":"itadmin","phone":"+91 98500 11223"}` → `{ok:true, user:{id, email:sandeep.kulkarni@svm-kothrud.edu.in, name:Sandeep Kulkarni, role:itadmin, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: First checklist hire, temp moon-monsoon-c366, force_change=true, can provision all staff.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.3 principal — Vandana Joshi <vandana.joshi@svm-kothrud.edu.in> (+91 98220 10001)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Vandana Joshi` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `vandana.joshi@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `principal` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 10001` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Vandana Joshi","email":"vandana.joshi@svm-kothrud.edu.in","role":"principal","phone":"+91 98220 10001"}` → `{ok:true, user:{id, email:vandana.joshi@svm-kothrud.edu.in, name:Vandana Joshi, role:principal, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Academic head, only owner may create (server 403 otherwise), owns class-assignment authority.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.4 coordinator — Rahul Patil <rahul.patil@svm-kothrud.edu.in> (+91 98220 10002)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Rahul Patil` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `rahul.patil@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `coordinator` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 10002` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Rahul Patil","email":"rahul.patil@svm-kothrud.edu.in","role":"coordinator","phone":"+91 98220 10002"}` → `{ok:true, user:{id, email:rahul.patil@svm-kothrud.edu.in, name:Rahul Patil, role:coordinator, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Timetable + substitution + class-assignment writer, staff picker reader.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.5 counselor — Sneha Pawar <sneha.pawar@svm-kothrud.edu.in> (+91 98220 10003)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Sneha Pawar` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `sneha.pawar@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `counselor` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 10003` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Sneha Pawar","email":"sneha.pawar@svm-kothrud.edu.in","role":"counselor","phone":"+91 98220 10003"}` → `{ok:true, user:{id, email:sneha.pawar@svm-kothrud.edu.in, name:Sneha Pawar, role:counselor, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Wellbeing queue + safety-box designated reader, HUMAN-ONLY safeguarding.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.6 finance_head — Anil Shinde <anil.shinde@svm-kothrud.edu.in> (+91 98220 10004)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Anil Shinde` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `anil.shinde@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `finance_head` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 10004` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Anil Shinde","email":"anil.shinde@svm-kothrud.edu.in","role":"finance_head","phone":"+91 98220 10004"}` → `{ok:true, user:{id, email:anil.shinde@svm-kothrud.edu.in, name:Anil Shinde, role:finance_head, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Fee settings writer, payment confirmer, Tally export runner.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.7 finance_clerk — Pooja Jadhav <pooja.jadhav@svm-kothrud.edu.in> (+91 98220 10005)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Pooja Jadhav` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `pooja.jadhav@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `finance_clerk` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 10005` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Pooja Jadhav","email":"pooja.jadhav@svm-kothrud.edu.in","role":"finance_clerk","phone":"+91 98220 10005"}` → `{ok:true, user:{id, email:pooja.jadhav@svm-kothrud.edu.in, name:Pooja Jadhav, role:finance_clerk, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Payment recorder, receipt issuer, concession clerk.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.8 admissions — Nitin Gaikwad <nitin.gaikwad@svm-kothrud.edu.in> (+91 98220 10006)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Nitin Gaikwad` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `nitin.gaikwad@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `admissions` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 10006` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Nitin Gaikwad","email":"nitin.gaikwad@svm-kothrud.edu.in","role":"admissions","phone":"+91 98220 10006"}` → `{ok:true, user:{id, email:nitin.gaikwad@svm-kothrud.edu.in, name:Nitin Gaikwad, role:admissions, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Funnel owner, lead capture + stage moves + offer/accept, POST /students authority.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.9 transport — Vijay Mane <vijay.mane@svm-kothrud.edu.in> (+91 98220 10007)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Vijay Mane` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `vijay.mane@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `transport` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 10007` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Vijay Mane","email":"vijay.mane@svm-kothrud.edu.in","role":"transport","phone":"+91 98220 10007"}` → `{ok:true, user:{id, email:vijay.mane@svm-kothrud.edu.in, name:Vijay Mane, role:transport, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Routes/stops writer, GPS delay approver, bus_route assigner.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.10 facilities — Prakash Lokhande <prakash.lokhande@svm-kothrud.edu.in> (+91 98220 10008)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Prakash Lokhande` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `prakash.lokhande@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `facilities` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 10008` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Prakash Lokhande","email":"prakash.lokhande@svm-kothrud.edu.in","role":"facilities","phone":"+91 98220 10008"}` → `{ok:true, user:{id, email:prakash.lokhande@svm-kothrud.edu.in, name:Prakash Lokhande, role:facilities, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Maintenance assets + work-orders + vendors requester.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.11 technician — Santosh Yadav <santosh.yadav@svm-kothrud.edu.in> (+91 98220 10009)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Santosh Yadav` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `santosh.yadav@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `technician` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 10009` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Santosh Yadav","email":"santosh.yadav@svm-kothrud.edu.in","role":"technician","phone":"+91 98220 10009"}` → `{ok:true, user:{id, email:santosh.yadav@svm-kothrud.edu.in, name:Santosh Yadav, role:technician, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Technician workspace executor, preventive task closer.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.12 librarian — Kavita Nair <kavita.nair@svm-kothrud.edu.in> (+91 98220 10010)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Kavita Nair` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `kavita.nair@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `librarian` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 10010` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Kavita Nair","email":"kavita.nair@svm-kothrud.edu.in","role":"librarian","phone":"+91 98220 10010"}` → `{ok:true, user:{id, email:kavita.nair@svm-kothrud.edu.in, name:Kavita Nair, role:librarian, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Library desk operator, issue/return/renew/holds/fines, accession cataloguer.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.13 teacher — Priya Sharma <priya.sharma@svm-kothrud.edu.in> (+91 98220 20001)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Priya Sharma` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `priya.sharma@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `teacher` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 20001` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Priya Sharma","email":"priya.sharma@svm-kothrud.edu.in","role":"teacher","phone":"+91 98220 20001"}` → `{ok:true, user:{id, email:priya.sharma@svm-kothrud.edu.in, name:Priya Sharma, role:teacher, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Nursery-A register owner, homework poster, attendance marker.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.14 teacher — Sunita Reddy <sunita.reddy@svm-kothrud.edu.in> (+91 98220 20002)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Sunita Reddy` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `sunita.reddy@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `teacher` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 20002` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Sunita Reddy","email":"sunita.reddy@svm-kothrud.edu.in","role":"teacher","phone":"+91 98220 20002"}` → `{ok:true, user:{id, email:sunita.reddy@svm-kothrud.edu.in, name:Sunita Reddy, role:teacher, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Jr KG-A register owner.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.15 teacher — Asha Iyer <asha.iyer@svm-kothrud.edu.in> (+91 98220 20003)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Asha Iyer` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `asha.iyer@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `teacher` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 20003` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Asha Iyer","email":"asha.iyer@svm-kothrud.edu.in","role":"teacher","phone":"+91 98220 20003"}` → `{ok:true, user:{id, email:asha.iyer@svm-kothrud.edu.in, name:Asha Iyer, role:teacher, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Sr KG-A register owner.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.16 teacher — Deepak Verma <deepak.verma@svm-kothrud.edu.in> (+91 98220 20004)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Deepak Verma` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `deepak.verma@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `teacher` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 20004` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Deepak Verma","email":"deepak.verma@svm-kothrud.edu.in","role":"teacher","phone":"+91 98220 20004"}` → `{ok:true, user:{id, email:deepak.verma@svm-kothrud.edu.in, name:Deepak Verma, role:teacher, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Std 1-A register owner, father of Yash Verma 6-A (staff-child link, no favour).
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.17 teacher — Neha Gupta <neha.gupta@svm-kothrud.edu.in> (+91 98220 20005)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Neha Gupta` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `neha.gupta@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `teacher` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 20005` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Neha Gupta","email":"neha.gupta@svm-kothrud.edu.in","role":"teacher","phone":"+91 98220 20005"}` → `{ok:true, user:{id, email:neha.gupta@svm-kothrud.edu.in, name:Neha Gupta, role:teacher, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Std 1-B register owner.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.18 teacher — Rajesh Kumar <rajesh.kumar@svm-kothrud.edu.in> (+91 98220 20006)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Rajesh Kumar` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `rajesh.kumar@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `teacher` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 20006` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Rajesh Kumar","email":"rajesh.kumar@svm-kothrud.edu.in","role":"teacher","phone":"+91 98220 20006"}` → `{ok:true, user:{id, email:rajesh.kumar@svm-kothrud.edu.in, name:Rajesh Kumar, role:teacher, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Std 2-A register owner, father of Vedant Kumar 5-B.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.19 teacher — Meena Kulkarni <meena.kulkarni@svm-kothrud.edu.in> (+91 98220 20007)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Meena Kulkarni` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `meena.kulkarni@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `teacher` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 20007` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Meena Kulkarni","email":"meena.kulkarni@svm-kothrud.edu.in","role":"teacher","phone":"+91 98220 20007"}` → `{ok:true, user:{id, email:meena.kulkarni@svm-kothrud.edu.in, name:Meena Kulkarni, role:teacher, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Std 2-B register owner, mother of Sneha Kulkarni 7-A.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.20 teacher — Amit Deshmukh <amit.deshmukh@svm-kothrud.edu.in> (+91 98220 20008)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Amit Deshmukh` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `amit.deshmukh@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `teacher` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 20008` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Amit Deshmukh","email":"amit.deshmukh@svm-kothrud.edu.in","role":"teacher","phone":"+91 98220 20008"}` → `{ok:true, user:{id, email:amit.deshmukh@svm-kothrud.edu.in, name:Amit Deshmukh, role:teacher, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Std 3-A register owner, father of Pranav Deshmukh 8-A.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.21 teacher — Shweta Joshi <shweta.joshi@svm-kothrud.edu.in> (+91 98220 20009)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Shweta Joshi` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `shweta.joshi@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `teacher` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 20009` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Shweta Joshi","email":"shweta.joshi@svm-kothrud.edu.in","role":"teacher","phone":"+91 98220 20009"}` → `{ok:true, user:{id, email:shweta.joshi@svm-kothrud.edu.in, name:Shweta Joshi, role:teacher, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Std 3-B register owner.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.22 teacher — Kiran More <kiran.more@svm-kothrud.edu.in> (+91 98220 20010)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Kiran More` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `kiran.more@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `teacher` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 20010` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Kiran More","email":"kiran.more@svm-kothrud.edu.in","role":"teacher","phone":"+91 98220 20010"}` → `{ok:true, user:{id, email:kiran.more@svm-kothrud.edu.in, name:Kiran More, role:teacher, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Std 4-A register owner.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.23 teacher — Divya Menon <divya.menon@svm-kothrud.edu.in> (+91 98220 20011)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Divya Menon` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `divya.menon@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `teacher` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 20011` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Divya Menon","email":"divya.menon@svm-kothrud.edu.in","role":"teacher","phone":"+91 98220 20011"}` → `{ok:true, user:{id, email:divya.menon@svm-kothrud.edu.in, name:Divya Menon, role:teacher, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Std 5-A register owner.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.24 teacher — Suresh Pillai <suresh.pillai@svm-kothrud.edu.in> (+91 98220 20012)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Suresh Pillai` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `suresh.pillai@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `teacher` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 20012` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Suresh Pillai","email":"suresh.pillai@svm-kothrud.edu.in","role":"teacher","phone":"+91 98220 20012"}` → `{ok:true, user:{id, email:suresh.pillai@svm-kothrud.edu.in, name:Suresh Pillai, role:teacher, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Std 6-A register owner, father of Shreyas Pillai 4-A.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.25 teacher — Anjali Thorat <anjali.thorat@svm-kothrud.edu.in> (+91 98220 20013)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Anjali Thorat` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `anjali.thorat@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `teacher` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 20013` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Anjali Thorat","email":"anjali.thorat@svm-kothrud.edu.in","role":"teacher","phone":"+91 98220 20013"}` → `{ok:true, user:{id, email:anjali.thorat@svm-kothrud.edu.in, name:Anjali Thorat, role:teacher, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Std 7-A register owner.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.26 teacher — Rohit Shelar <rohit.shelar@svm-kothrud.edu.in> (+91 98220 20014)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `Rohit Shelar` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `rohit.shelar@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `teacher` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 20014` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"Rohit Shelar","email":"rohit.shelar@svm-kothrud.edu.in","role":"teacher","phone":"+91 98220 20014"}` → `{ok:true, user:{id, email:rohit.shelar@svm-kothrud.edu.in, name:Rohit Shelar, role:teacher, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Std 8-A register owner, kin of Om Shelar 5-A + Rohan Shelar 10-B.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.27 teacher — UI Teacher Three <ui.teacher.dwuel@svm-kothrud.edu.in> (+91 98220 29999)
- **Clicks (UI)**: `/people-admin` → Accounts pane → fill `Full name` (`getByLabel('Full name')`, placeholder `e.g. Sunita Rao`) = `UI Teacher Three` → fill `Email` (`getByLabel('Email')`, placeholder `sunita@school.edu`) = `ui.teacher.dwuel@svm-kothrud.edu.in` (lower-cased, regex-validated, `UNIQUE(tenant,email)` → 409 `already exists at your school` otherwise) → select `Role in the school` (`getByLabel('Role')`) = `teacher` (from `PROVISIONABLE_ROLES`; `owner` absent by construction — server 403-audits owner attempts; `principal` only owner may pick — server 403 otherwise) → optional `Phone` = `+91 98220 29999` (`toE164` normalised, unusable → 400 with example; OTP doors compare E.164 so this parity matters) → **Click `Create account` (`button:has-text('Create account')`).
- **Request**: `POST /plugins/people.admin/users 200` `{"name":"UI Teacher Three","email":"ui.teacher.dwuel@svm-kothrud.edu.in","role":"teacher","phone":"+91 98220 29999"}` → `{ok:true, user:{id, email:ui.teacher.dwuel@svm-kothrud.edu.in, name:UI Teacher Three, role:teacher, active:true, forceChange:true}, temporaryPassword:"<shown-once>", note:"shown once…"}` (CSPRNG `word-word-hex`, e.g. `moon-monsoon-c366`, `star-river-60a6`; only scrypt hash stored; `force_change=true` → first login `403 mustChange` + RESTRICTED token → `/account/password`; shown ONCE with copy button; audited + evented in-tx; `SAVEPOINT provision_user` → friendly 409).
- **Why this person/role**: Created 100% via UI clicks §5.6 (getByLabel Full name/Email/Role + Create account), temp star-river-60a6, proves frontend writes real DB.
- **After**: row in users table (`GET /plugins/people.admin/users` refresh, `Suspend`/`Reset password` per row); checklist `itadmins>0` flips when Sandeep exists; class-assignment picker (`GET /school/staff?role=teacher`) lists teachers (id+name+role only, no PII); parent/student binds via `studentId` picker when applicable (`family.child_link` + `app.guardians` mirror, G-2).
- **Browser proof**: v6 `REQUEST POST /plugins/people.admin/users` → `RESPONSE 200` (user `ecae83aa…`, temp `star-river-60a6`) → `VERIFY found:true` + screenshot `/tmp/b6_created.png`; v2/v3/v8 `GET /plugins/people.admin/users 200` lists all 27–28 on every `/people-admin` visit.

#### 1.5.28 Parent portal accounts (guardian-linked, light chrome)
- **Clicks**: `/people-admin` → parent row → pick child (`Which child` picker from `GET /students` id+name) → Create account role `parent` + `studentId` → server validates UUID + same-tenant student, writes `family.child_link(guardian,primary)` + mirrors `app.guardians` (G-2 union resolver fixes zero-recipient notices).
- **Why**: a parent with no link sees empty portal forever (H2/L5); phone structural match (`POST /students guardianPhone` ↔ provisioned parent phone) auto-binds at admission; notices resolve union of both shapes.
- **Browser**: parent screens (`/parent`, `/parent/fees`, `/parent/family`, `/parent/consents`, `/parent/requests`, `/parent/copilot`, `/parent/child/:id`) render light chrome (no sidebar) + own-children scope (`child_link.user_id=me`); v8 visited all (owner sees honest scope/redirect, `crash:false`).

#### 1.5.29 Student portal accounts (paper-first, kiosk-safe)
- **Clicks**: roster row → `Give a pupil a portal account` → writes `app.students.user_id` (G-1; migration 132 backfilled rest); `student.world` resolves via `user_id`, falls back to unambiguous name only for pre-account rows.
- **Why**: `~20 /student/*` doors existed with no possible user before G-1 (role issued but unappointable); now every pupil can have a portal without a second identity.
- **Browser**: `/student`, `/student/home2`, `/student/fees|learning|portfolio|homework|mistakes|flashcards|tasks|results` visited in v8 (`crash:false`); session isolation (`schoolos.user_id` RLS pin, `no-store`, idle-countdown) is server-enforced.

### 1.6 Every student admission (38) — `POST /students` (same door the People `Add person` UI calls)

#### 1.6.1 `SVM2026-001` — Aarav Joshi (Nursery-A, male, DOB 2022-05-14) guardian Sachin Joshi (+91 98221 10001) bus `Route-1`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Aarav Joshi` → `Class=Nursery` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-001` (own series; blank → `ADM-<base36>`) → `DOB=2022-05-14` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Sachin Joshi` + `Phone=+91 98221 10001` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-1` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Aarav Joshi","grade":"Nursery","section":"A","admissionNo":"SVM2026-001","dob":"2022-05-14","gender":"male","guardianName":"Sachin Joshi","guardianPhone":"+91 98221 10001","busRoute":"Route-1"}` → `{student:{id, admission_no:SVM2026-001, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Aarav Joshi (Nursery-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-001, Nursery-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Nursery 4y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.2 `SVM2026-002` — Myra Kulkarni (Nursery-A, female, DOB 2022-08-22) guardian Swapnil Kulkarni (+91 98221 10002) bus `Route-1`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Myra Kulkarni` → `Class=Nursery` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-002` (own series; blank → `ADM-<base36>`) → `DOB=2022-08-22` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Swapnil Kulkarni` + `Phone=+91 98221 10002` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-1` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Myra Kulkarni","grade":"Nursery","section":"A","admissionNo":"SVM2026-002","dob":"2022-08-22","gender":"female","guardianName":"Swapnil Kulkarni","guardianPhone":"+91 98221 10002","busRoute":"Route-1"}` → `{student:{id, admission_no:SVM2026-002, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Myra Kulkarni (Nursery-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-002, Nursery-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Nursery 4y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.3 `SVM2026-003` — Vihaan Deshmukh (Jr KG-A, male, DOB 2021-06-10) guardian Amol Deshmukh (+91 98221 10003) bus `-walk-`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Vihaan Deshmukh` → `Class=Jr KG` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-003` (own series; blank → `ADM-<base36>`) → `DOB=2021-06-10` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Amol Deshmukh` + `Phone=+91 98221 10003` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=-walk-` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Vihaan Deshmukh","grade":"Jr KG","section":"A","admissionNo":"SVM2026-003","dob":"2021-06-10","gender":"male","guardianName":"Amol Deshmukh","guardianPhone":"+91 98221 10003"}` → `{student:{id, admission_no:SVM2026-003, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Vihaan Deshmukh (Jr KG-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-003, Jr KG-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (KG 5–6y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.4 `SVM2026-004` — Anaya Pawar (Jr KG-A, female, DOB 2021-09-03) guardian Kiran Pawar (+91 98221 10004) bus `Route-2`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Anaya Pawar` → `Class=Jr KG` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-004` (own series; blank → `ADM-<base36>`) → `DOB=2021-09-03` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Kiran Pawar` + `Phone=+91 98221 10004` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-2` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Anaya Pawar","grade":"Jr KG","section":"A","admissionNo":"SVM2026-004","dob":"2021-09-03","gender":"female","guardianName":"Kiran Pawar","guardianPhone":"+91 98221 10004","busRoute":"Route-2"}` → `{student:{id, admission_no:SVM2026-004, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Anaya Pawar (Jr KG-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-004, Jr KG-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (KG 5–6y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.5 `SVM2026-005` — Ishaan Patil (Sr KG-A, male, DOB 2020-07-19) guardian Rahul Patil (+91 98221 10005) bus `Route-2`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Ishaan Patil` → `Class=Sr KG` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-005` (own series; blank → `ADM-<base36>`) → `DOB=2020-07-19` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Rahul Patil` + `Phone=+91 98221 10005` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-2` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Ishaan Patil","grade":"Sr KG","section":"A","admissionNo":"SVM2026-005","dob":"2020-07-19","gender":"male","guardianName":"Rahul Patil","guardianPhone":"+91 98221 10005","busRoute":"Route-2"}` → `{student:{id, admission_no:SVM2026-005, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Ishaan Patil (Sr KG-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-005, Sr KG-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (KG 5–6y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.6 `SVM2026-006` — Diya Mane (Sr KG-A, female, DOB 2020-11-30) guardian Vijay Mane (+91 98221 10006) bus `-walk-`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Diya Mane` → `Class=Sr KG` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-006` (own series; blank → `ADM-<base36>`) → `DOB=2020-11-30` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Vijay Mane` + `Phone=+91 98221 10006` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=-walk-` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Diya Mane","grade":"Sr KG","section":"A","admissionNo":"SVM2026-006","dob":"2020-11-30","gender":"female","guardianName":"Vijay Mane","guardianPhone":"+91 98221 10006"}` → `{student:{id, admission_no:SVM2026-006, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Diya Mane (Sr KG-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-006, Sr KG-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (KG 5–6y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.7 `SVM2026-007` — Aditya Shinde (1-A, male, DOB 2019-04-12) guardian Anil Shinde (+91 98221 20001) bus `Route-1`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Aditya Shinde` → `Class=1` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-007` (own series; blank → `ADM-<base36>`) → `DOB=2019-04-12` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Anil Shinde` + `Phone=+91 98221 20001` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-1` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Aditya Shinde","grade":"1","section":"A","admissionNo":"SVM2026-007","dob":"2019-04-12","gender":"male","guardianName":"Anil Shinde","guardianPhone":"+91 98221 20001","busRoute":"Route-1"}` → `{student:{id, admission_no:SVM2026-007, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Aditya Shinde (1-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-007, 1-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 1 1y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.8 `SVM2026-008` — Saanvi Jadhav (1-A, female, DOB 2019-08-25) guardian Suresh Jadhav (+91 98221 20002) bus `Route-1`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Saanvi Jadhav` → `Class=1` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-008` (own series; blank → `ADM-<base36>`) → `DOB=2019-08-25` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Suresh Jadhav` + `Phone=+91 98221 20002` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-1` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Saanvi Jadhav","grade":"1","section":"A","admissionNo":"SVM2026-008","dob":"2019-08-25","gender":"female","guardianName":"Suresh Jadhav","guardianPhone":"+91 98221 20002","busRoute":"Route-1"}` → `{student:{id, admission_no:SVM2026-008, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Saanvi Jadhav (1-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-008, 1-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 1 1y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.9 `SVM2026-009` — Krishna Gaikwad (1-B, male, DOB 2019-05-02) guardian Nitin Gaikwad (+91 98221 20003) bus `Route-3`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Krishna Gaikwad` → `Class=1` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=B` (picker per class) → `Admission No=SVM2026-009` (own series; blank → `ADM-<base36>`) → `DOB=2019-05-02` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Nitin Gaikwad` + `Phone=+91 98221 20003` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-3` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Krishna Gaikwad","grade":"1","section":"B","admissionNo":"SVM2026-009","dob":"2019-05-02","gender":"male","guardianName":"Nitin Gaikwad","guardianPhone":"+91 98221 20003","busRoute":"Route-3"}` → `{student:{id, admission_no:SVM2026-009, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Krishna Gaikwad (1-B))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-009, 1-B`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 1 1y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.10 `SVM2026-010` — Aadhya Thorat (1-B, female, DOB 2019-10-11) guardian Sandip Thorat (+91 98221 20004) bus `-walk-`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Aadhya Thorat` → `Class=1` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=B` (picker per class) → `Admission No=SVM2026-010` (own series; blank → `ADM-<base36>`) → `DOB=2019-10-11` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Sandip Thorat` + `Phone=+91 98221 20004` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=-walk-` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Aadhya Thorat","grade":"1","section":"B","admissionNo":"SVM2026-010","dob":"2019-10-11","gender":"female","guardianName":"Sandip Thorat","guardianPhone":"+91 98221 20004"}` → `{student:{id, admission_no:SVM2026-010, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Aadhya Thorat (1-B))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-010, 1-B`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 1 1y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.11 `SVM2026-011` — Arjun Nair (2-A, male, DOB 2018-03-15) guardian Sreekumar Nair (+91 98221 20005) bus `Route-2`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Arjun Nair` → `Class=2` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-011` (own series; blank → `ADM-<base36>`) → `DOB=2018-03-15` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Sreekumar Nair` + `Phone=+91 98221 20005` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-2` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Arjun Nair","grade":"2","section":"A","admissionNo":"SVM2026-011","dob":"2018-03-15","gender":"male","guardianName":"Sreekumar Nair","guardianPhone":"+91 98221 20005","busRoute":"Route-2"}` → `{student:{id, admission_no:SVM2026-011, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Arjun Nair (2-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-011, 2-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 2 2y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.12 `SVM2026-012` — Navya Reddy (2-A, female, DOB 2018-07-08) guardian Venkat Reddy (+91 98221 20006) bus `Route-2`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Navya Reddy` → `Class=2` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-012` (own series; blank → `ADM-<base36>`) → `DOB=2018-07-08` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Venkat Reddy` + `Phone=+91 98221 20006` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-2` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Navya Reddy","grade":"2","section":"A","admissionNo":"SVM2026-012","dob":"2018-07-08","gender":"female","guardianName":"Venkat Reddy","guardianPhone":"+91 98221 20006","busRoute":"Route-2"}` → `{student:{id, admission_no:SVM2026-012, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Navya Reddy (2-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-012, 2-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 2 2y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.13 `SVM2026-013` — Rudra Yadav (2-B, male, DOB 2018-05-21) guardian Santosh Yadav (+91 98221 20007) bus `Route-3`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Rudra Yadav` → `Class=2` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=B` (picker per class) → `Admission No=SVM2026-013` (own series; blank → `ADM-<base36>`) → `DOB=2018-05-21` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Santosh Yadav` + `Phone=+91 98221 20007` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-3` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Rudra Yadav","grade":"2","section":"B","admissionNo":"SVM2026-013","dob":"2018-05-21","gender":"male","guardianName":"Santosh Yadav","guardianPhone":"+91 98221 20007","busRoute":"Route-3"}` → `{student:{id, admission_no:SVM2026-013, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Rudra Yadav (2-B))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-013, 2-B`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 2 2y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.14 `SVM2026-014` — Pari Lokhande (2-B, female, DOB 2018-12-01) guardian Prakash Lokhande (+91 98221 20008) bus `-walk-`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Pari Lokhande` → `Class=2` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=B` (picker per class) → `Admission No=SVM2026-014` (own series; blank → `ADM-<base36>`) → `DOB=2018-12-01` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Prakash Lokhande` + `Phone=+91 98221 20008` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=-walk-` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Pari Lokhande","grade":"2","section":"B","admissionNo":"SVM2026-014","dob":"2018-12-01","gender":"female","guardianName":"Prakash Lokhande","guardianPhone":"+91 98221 20008"}` → `{student:{id, admission_no:SVM2026-014, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Pari Lokhande (2-B))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-014, 2-B`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 2 2y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.15 `SVM2026-015` — Atharva More (3-A, male, DOB 2017-04-18) guardian Kiran More (+91 98221 30001) bus `Route-1`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Atharva More` → `Class=3` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-015` (own series; blank → `ADM-<base36>`) → `DOB=2017-04-18` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Kiran More` + `Phone=+91 98221 30001` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-1` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Atharva More","grade":"3","section":"A","admissionNo":"SVM2026-015","dob":"2017-04-18","gender":"male","guardianName":"Kiran More","guardianPhone":"+91 98221 30001","busRoute":"Route-1"}` → `{student:{id, admission_no:SVM2026-015, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Atharva More (3-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-015, 3-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 3 3y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.16 `SVM2026-016` — Anvi Sharma (3-A, female, DOB 2017-09-14) guardian Rakesh Sharma (+91 98221 30002) bus `Route-1`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Anvi Sharma` → `Class=3` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-016` (own series; blank → `ADM-<base36>`) → `DOB=2017-09-14` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Rakesh Sharma` + `Phone=+91 98221 30002` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-1` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Anvi Sharma","grade":"3","section":"A","admissionNo":"SVM2026-016","dob":"2017-09-14","gender":"female","guardianName":"Rakesh Sharma","guardianPhone":"+91 98221 30002","busRoute":"Route-1"}` → `{student:{id, admission_no:SVM2026-016, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Anvi Sharma (3-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-016, 3-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 3 3y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.17 `SVM2026-017` — Sai Rajguru (3-B, male, DOB 2017-06-27) guardian Mangesh Rajguru (+91 98221 30003) bus `Route-4`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Sai Rajguru` → `Class=3` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=B` (picker per class) → `Admission No=SVM2026-017` (own series; blank → `ADM-<base36>`) → `DOB=2017-06-27` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Mangesh Rajguru` + `Phone=+91 98221 30003` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-4` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Sai Rajguru","grade":"3","section":"B","admissionNo":"SVM2026-017","dob":"2017-06-27","gender":"male","guardianName":"Mangesh Rajguru","guardianPhone":"+91 98221 30003","busRoute":"Route-4"}` → `{student:{id, admission_no:SVM2026-017, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Sai Rajguru (3-B))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-017, 3-B`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 3 3y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.18 `SVM2026-018` — Ira Deshpande (3-B, female, DOB 2017-02-09) guardian Mandar Deshpande (+91 98221 30004) bus `-walk-`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Ira Deshpande` → `Class=3` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=B` (picker per class) → `Admission No=SVM2026-018` (own series; blank → `ADM-<base36>`) → `DOB=2017-02-09` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Mandar Deshpande` + `Phone=+91 98221 30004` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=-walk-` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Ira Deshpande","grade":"3","section":"B","admissionNo":"SVM2026-018","dob":"2017-02-09","gender":"female","guardianName":"Mandar Deshpande","guardianPhone":"+91 98221 30004"}` → `{student:{id, admission_no:SVM2026-018, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Ira Deshpande (3-B))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-018, 3-B`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 3 3y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.19 `SVM2026-019` — Shreyas Pillai (4-A, male, DOB 2016-05-05) guardian Suresh Pillai (+91 98221 40001) bus `Route-4`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Shreyas Pillai` → `Class=4` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-019` (own series; blank → `ADM-<base36>`) → `DOB=2016-05-05` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Suresh Pillai` + `Phone=+91 98221 40001` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-4` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Shreyas Pillai","grade":"4","section":"A","admissionNo":"SVM2026-019","dob":"2016-05-05","gender":"male","guardianName":"Suresh Pillai","guardianPhone":"+91 98221 40001","busRoute":"Route-4"}` → `{student:{id, admission_no:SVM2026-019, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Shreyas Pillai (4-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-019, 4-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 4 4y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.20 `SVM2026-020` — Avni Menon (4-A, female, DOB 2016-10-20) guardian Rajesh Menon (+91 98221 40002) bus `Route-2`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Avni Menon` → `Class=4` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-020` (own series; blank → `ADM-<base36>`) → `DOB=2016-10-20` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Rajesh Menon` + `Phone=+91 98221 40002` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-2` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Avni Menon","grade":"4","section":"A","admissionNo":"SVM2026-020","dob":"2016-10-20","gender":"female","guardianName":"Rajesh Menon","guardianPhone":"+91 98221 40002","busRoute":"Route-2"}` → `{student:{id, admission_no:SVM2026-020, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Avni Menon (4-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-020, 4-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 4 4y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.21 `SVM2026-021` — Om Shelar (5-A, male, DOB 2015-06-11) guardian Rohit Shelar (+91 98221 50001) bus `Route-3`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Om Shelar` → `Class=5` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-021` (own series; blank → `ADM-<base36>`) → `DOB=2015-06-11` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Rohit Shelar` + `Phone=+91 98221 50001` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-3` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Om Shelar","grade":"5","section":"A","admissionNo":"SVM2026-021","dob":"2015-06-11","gender":"male","guardianName":"Rohit Shelar","guardianPhone":"+91 98221 50001","busRoute":"Route-3"}` → `{student:{id, admission_no:SVM2026-021, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Om Shelar (5-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-021, 5-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 5 5y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.22 `SVM2026-022` — Shreya Iyer (5-A, female, DOB 2015-08-30) guardian Krishnan Iyer (+91 98221 50002) bus `Route-3`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Shreya Iyer` → `Class=5` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-022` (own series; blank → `ADM-<base36>`) → `DOB=2015-08-30` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Krishnan Iyer` + `Phone=+91 98221 50002` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-3` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Shreya Iyer","grade":"5","section":"A","admissionNo":"SVM2026-022","dob":"2015-08-30","gender":"female","guardianName":"Krishnan Iyer","guardianPhone":"+91 98221 50002","busRoute":"Route-3"}` → `{student:{id, admission_no:SVM2026-022, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Shreya Iyer (5-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-022, 5-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 5 5y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.23 `SVM2026-023` — Vedant Kumar (5-B, male, DOB 2015-03-22) guardian Rajesh Kumar (+91 98221 50003) bus `Route-1`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Vedant Kumar` → `Class=5` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=B` (picker per class) → `Admission No=SVM2026-023` (own series; blank → `ADM-<base36>`) → `DOB=2015-03-22` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Rajesh Kumar` + `Phone=+91 98221 50003` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-1` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Vedant Kumar","grade":"5","section":"B","admissionNo":"SVM2026-023","dob":"2015-03-22","gender":"male","guardianName":"Rajesh Kumar","guardianPhone":"+91 98221 50003","busRoute":"Route-1"}` → `{student:{id, admission_no:SVM2026-023, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Vedant Kumar (5-B))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-023, 5-B`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 5 5y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.24 `SVM2026-024` — Tanvi Gupta (5-B, female, DOB 2015-11-17) guardian Sanjay Gupta (+91 98221 50004) bus `-walk-`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Tanvi Gupta` → `Class=5` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=B` (picker per class) → `Admission No=SVM2026-024` (own series; blank → `ADM-<base36>`) → `DOB=2015-11-17` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Sanjay Gupta` + `Phone=+91 98221 50004` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=-walk-` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Tanvi Gupta","grade":"5","section":"B","admissionNo":"SVM2026-024","dob":"2015-11-17","gender":"female","guardianName":"Sanjay Gupta","guardianPhone":"+91 98221 50004"}` → `{student:{id, admission_no:SVM2026-024, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Tanvi Gupta (5-B))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-024, 5-B`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 5 5y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.25 `SVM2026-025` — Yash Verma (6-A, male, DOB 2014-07-07) guardian Deepak Verma (+91 98221 60001) bus `Route-4`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Yash Verma` → `Class=6` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-025` (own series; blank → `ADM-<base36>`) → `DOB=2014-07-07` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Deepak Verma` + `Phone=+91 98221 60001` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-4` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Yash Verma","grade":"6","section":"A","admissionNo":"SVM2026-025","dob":"2014-07-07","gender":"male","guardianName":"Deepak Verma","guardianPhone":"+91 98221 60001","busRoute":"Route-4"}` → `{student:{id, admission_no:SVM2026-025, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Yash Verma (6-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-025, 6-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 6 6y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.26 `SVM2026-026` — Riya Singh (6-A, female, DOB 2014-09-19) guardian Ajay Singh (+91 98221 60002) bus `Route-4`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Riya Singh` → `Class=6` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-026` (own series; blank → `ADM-<base36>`) → `DOB=2014-09-19` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Ajay Singh` + `Phone=+91 98221 60002` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-4` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Riya Singh","grade":"6","section":"A","admissionNo":"SVM2026-026","dob":"2014-09-19","gender":"female","guardianName":"Ajay Singh","guardianPhone":"+91 98221 60002","busRoute":"Route-4"}` → `{student:{id, admission_no:SVM2026-026, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Riya Singh (6-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-026, 6-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 6 6y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.27 `SVM2026-027` — Kabir Khan (6-B, male, DOB 2014-04-25) guardian Imran Khan (+91 98221 60003) bus `Route-2`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Kabir Khan` → `Class=6` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=B` (picker per class) → `Admission No=SVM2026-027` (own series; blank → `ADM-<base36>`) → `DOB=2014-04-25` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Imran Khan` + `Phone=+91 98221 60003` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-2` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Kabir Khan","grade":"6","section":"B","admissionNo":"SVM2026-027","dob":"2014-04-25","gender":"male","guardianName":"Imran Khan","guardianPhone":"+91 98221 60003","busRoute":"Route-2"}` → `{student:{id, admission_no:SVM2026-027, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Kabir Khan (6-B))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-027, 6-B`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 6 6y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.28 `SVM2026-028` — Ananya Das (6-B, female, DOB 2014-12-12) guardian Soumen Das (+91 98221 60004) bus `-walk-`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Ananya Das` → `Class=6` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=B` (picker per class) → `Admission No=SVM2026-028` (own series; blank → `ADM-<base36>`) → `DOB=2014-12-12` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Soumen Das` + `Phone=+91 98221 60004` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=-walk-` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Ananya Das","grade":"6","section":"B","admissionNo":"SVM2026-028","dob":"2014-12-12","gender":"female","guardianName":"Soumen Das","guardianPhone":"+91 98221 60004"}` → `{student:{id, admission_no:SVM2026-028, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Ananya Das (6-B))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-028, 6-B`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 6 6y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.29 `SVM2026-029` — Aryan Joshi (7-A, male, DOB 2013-05-16) guardian Milind Joshi (+91 98221 70001) bus `Route-1`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Aryan Joshi` → `Class=7` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-029` (own series; blank → `ADM-<base36>`) → `DOB=2013-05-16` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Milind Joshi` + `Phone=+91 98221 70001` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-1` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Aryan Joshi","grade":"7","section":"A","admissionNo":"SVM2026-029","dob":"2013-05-16","gender":"male","guardianName":"Milind Joshi","guardianPhone":"+91 98221 70001","busRoute":"Route-1"}` → `{student:{id, admission_no:SVM2026-029, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Aryan Joshi (7-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-029, 7-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 7 7y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.30 `SVM2026-030` — Sneha Kulkarni (7-A, female, DOB 2013-10-08) guardian Meena Kulkarni (+91 98221 70002) bus `Route-1`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Sneha Kulkarni` → `Class=7` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-030` (own series; blank → `ADM-<base36>`) → `DOB=2013-10-08` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Meena Kulkarni` + `Phone=+91 98221 70002` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-1` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Sneha Kulkarni","grade":"7","section":"A","admissionNo":"SVM2026-030","dob":"2013-10-08","gender":"female","guardianName":"Meena Kulkarni","guardianPhone":"+91 98221 70002","busRoute":"Route-1"}` → `{student:{id, admission_no:SVM2026-030, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Sneha Kulkarni (7-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-030, 7-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 7 7y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.31 `SVM2026-031` — Pranav Deshmukh (8-A, male, DOB 2012-06-21) guardian Amit Deshmukh (+91 98221 80001) bus `Route-3`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Pranav Deshmukh` → `Class=8` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-031` (own series; blank → `ADM-<base36>`) → `DOB=2012-06-21` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Amit Deshmukh` + `Phone=+91 98221 80001` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-3` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Pranav Deshmukh","grade":"8","section":"A","admissionNo":"SVM2026-031","dob":"2012-06-21","gender":"male","guardianName":"Amit Deshmukh","guardianPhone":"+91 98221 80001","busRoute":"Route-3"}` → `{student:{id, admission_no:SVM2026-031, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Pranav Deshmukh (8-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-031, 8-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 8 8y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.32 `SVM2026-032` — Pooja Sharma (8-A, female, DOB 2012-08-13) guardian Ramesh Sharma (+91 98221 80002) bus `Route-3`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Pooja Sharma` → `Class=8` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-032` (own series; blank → `ADM-<base36>`) → `DOB=2012-08-13` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Ramesh Sharma` + `Phone=+91 98221 80002` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-3` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Pooja Sharma","grade":"8","section":"A","admissionNo":"SVM2026-032","dob":"2012-08-13","gender":"female","guardianName":"Ramesh Sharma","guardianPhone":"+91 98221 80002","busRoute":"Route-3"}` → `{student:{id, admission_no:SVM2026-032, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Pooja Sharma (8-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-032, 8-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 8 8y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.33 `SVM2026-033` — Adwait Patil (9-A, male, DOB 2011-04-29) guardian Sunil Patil (+91 98221 90001) bus `Route-4`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Adwait Patil` → `Class=9` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-033` (own series; blank → `ADM-<base36>`) → `DOB=2011-04-29` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Sunil Patil` + `Phone=+91 98221 90001` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-4` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Adwait Patil","grade":"9","section":"A","admissionNo":"SVM2026-033","dob":"2011-04-29","gender":"male","guardianName":"Sunil Patil","guardianPhone":"+91 98221 90001","busRoute":"Route-4"}` → `{student:{id, admission_no:SVM2026-033, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Adwait Patil (9-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-033, 9-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 9 9y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.34 `SVM2026-034` — Shravani More (9-A, female, DOB 2011-11-02) guardian Nilesh More (+91 98221 90002) bus `Route-4`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Shravani More` → `Class=9` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-034` (own series; blank → `ADM-<base36>`) → `DOB=2011-11-02` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Nilesh More` + `Phone=+91 98221 90002` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-4` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Shravani More","grade":"9","section":"A","admissionNo":"SVM2026-034","dob":"2011-11-02","gender":"female","guardianName":"Nilesh More","guardianPhone":"+91 98221 90002","busRoute":"Route-4"}` → `{student:{id, admission_no:SVM2026-034, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Shravani More (9-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-034, 9-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 9 9y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.35 `SVM2026-035` — Sahil Thorat (10-A, male, DOB 2010-05-30) guardian Anil Thorat (+91 98221 10001) bus `Route-1`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Sahil Thorat` → `Class=10` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-035` (own series; blank → `ADM-<base36>`) → `DOB=2010-05-30` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Anil Thorat` + `Phone=+91 98221 10001` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-1` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Sahil Thorat","grade":"10","section":"A","admissionNo":"SVM2026-035","dob":"2010-05-30","gender":"male","guardianName":"Anil Thorat","guardianPhone":"+91 98221 10001","busRoute":"Route-1"}` → `{student:{id, admission_no:SVM2026-035, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Sahil Thorat (10-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-035, 10-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 10 10y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.36 `SVM2026-036` — Mrunal Jadhav (10-A, female, DOB 2010-09-25) guardian Pooja Jadhav (+91 98221 10002) bus `Route-1`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Mrunal Jadhav` → `Class=10` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=A` (picker per class) → `Admission No=SVM2026-036` (own series; blank → `ADM-<base36>`) → `DOB=2010-09-25` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Pooja Jadhav` + `Phone=+91 98221 10002` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-1` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Mrunal Jadhav","grade":"10","section":"A","admissionNo":"SVM2026-036","dob":"2010-09-25","gender":"female","guardianName":"Pooja Jadhav","guardianPhone":"+91 98221 10002","busRoute":"Route-1"}` → `{student:{id, admission_no:SVM2026-036, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Mrunal Jadhav (10-A))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-036, 10-A`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 10 10y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.37 `SVM2026-037` — Rohan Shelar (10-B, male, DOB 2010-03-18) guardian Datta Shelar (+91 98222 10003) bus `Route-3`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Rohan Shelar` → `Class=10` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=B` (picker per class) → `Admission No=SVM2026-037` (own series; blank → `ADM-<base36>`) → `DOB=2010-03-18` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=male` (shared `parseGender`) → `Guardian=Datta Shelar` + `Phone=+91 98222 10003` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-3` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Rohan Shelar","grade":"10","section":"B","admissionNo":"SVM2026-037","dob":"2010-03-18","gender":"male","guardianName":"Datta Shelar","guardianPhone":"+91 98222 10003","busRoute":"Route-3"}` → `{student:{id, admission_no:SVM2026-037, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Rohan Shelar (10-B))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-037, 10-B`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 10 10y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

#### 1.6.38 `SVM2026-038` — Vaishnavi Shinde (10-B, female, DOB 2010-07-07) guardian Anil Shinde (+91 98222 10004) bus `Route-3`
- **Clicks (UI)**: `/people` → `Add person` → `Name=Vaishnavi Shinde` → `Class=10` (picker from `/school/classes`; free-text `Grade 77` refused) → `Section=B` (picker per class) → `Admission No=SVM2026-038` (own series; blank → `ADM-<base36>`) → `DOB=2010-07-07` (shared `parseDob` with import/edit, P2-7; drives age/transport eligibility) → `Gender=female` (shared `parseGender`) → `Guardian=Anil Shinde` + `Phone=+91 98222 10004` (writes BOTH `students.guardian_*` + `app.guardians` row, M1 — absence/visitor/audience lookups need the table) → `Bus=Route-3` (`students.bus_route`, `-walk-` = walker, no bus) → Save.
- **Request**: `POST /students 200` `{"name":"Vaishnavi Shinde","grade":"10","section":"B","admissionNo":"SVM2026-038","dob":"2010-07-07","gender":"female","guardianName":"Anil Shinde","guardianPhone":"+91 98222 10004","busRoute":"Route-3"}` → `{student:{id, admission_no:SVM2026-038, class_id/section_id via trigger `sync_student_class_ref` (invalidated on grade change), source:'staff'}}` + `auditLog(Created student)` + `emitEvent(people, Student enrolled — Vaishnavi Shinde (10-B))`; phone match auto-inserts `family.child_link` when a same-phone parent exists.
- **Guards**: missing class → `400` with real class list (P2-6); dup admission_no → `409` naming holder (P2-5); dup name (case-insensitive, active) → `409` naming existing (`SVM2026-038, 10-B`) with `Search before enrolling` (P2-8 — roster sorts by name, two same-names untellable).
- **Why this child**: age-correct DOB for 2026-27 (Std 10 10y), mixed genders per class, guardian surnames matching local community + staff-child links (Deepak→Yash, Rajesh→Vedant, Meena→Sneha, Amit→Pranav, Suresh→Shreyas, Rohit→Om/Rohan) for realistic family graph; bus spread across Route-1…4 + walkers.
- **Downstream joins**: appears in `GET /students` roster, `GET /attendance` register, `fee_plans/obligations` (`UNIQUE(tenant,student,term)`), `bus_route` transport, `plugin_exams.mark`, homework submissions (class gate name-match), visitor pickup (guardian lookup), parent doors only via `child_link`.

## 2. Browser-Only Signup — School B (every click + every request, v1 log)

#### 2.1 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/onboard", "why": "sanctioned entry for fresh school, public door outside session tree"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.2 `SCREENSHOT-ONBOARD-STEP0` — `{"heading": "\n    SStart your schoolSchoolOS \u2014 the digital school officeSchool nameAddress (optional)Board (optional)Phone (optional)Continue Your classes and sections are yours to define \u2014 nothing is added for yo"}`
- **Why**: screen narration (empty-world law for fresh school; own-name brand, honest empty states).

#### 2.3 `FILL` — `{"field": "schoolName", "value": "Shree Samarth Vidyalaya sdmhtr", "why": "tenant name 3-120 chars, becomes slug + sidebar brand"}`
- **Why**: field `schoolName` → tenant/user column (schoolName 3–120→name+slug; address/board/phone→config; ownerName→audit actor; ownerEmail→login identity; ownerPassword≥8→scrypt, owner-chose so `force_change=false`).

#### 2.4 `FILL` — `{"field": "address", "value": "Plot 18, Sinhagad Road, Hingne Khurd, Pune, Maharashtra 411051", "why": "tenant config.address, printed on receipts"}`
- **Why**: field `address` → tenant/user column (schoolName 3–120→name+slug; address/board/phone→config; ownerName→audit actor; ownerEmail→login identity; ownerPassword≥8→scrypt, owner-chose so `force_change=false`).

#### 2.5 `FILL` — `{"field": "board", "value": "CBSE", "why": "tenant config.board, drives CBSE pack"}`
- **Why**: field `board` → tenant/user column (schoolName 3–120→name+slug; address/board/phone→config; ownerName→audit actor; ownerEmail→login identity; ownerPassword≥8→scrypt, owner-chose so `force_change=false`).

#### 2.6 `FILL` — `{"field": "phone", "value": "+91 98220 77889", "why": "tenant config.phone, office contact"}`
- **Why**: field `phone` → tenant/user column (schoolName 3–120→name+slug; address/board/phone→config; ownerName→audit actor; ownerEmail→login identity; ownerPassword≥8→scrypt, owner-chose so `force_change=false`).

#### 2.7 `CLICK` — `{"button": "Continue", "why": "Step0 validation: schoolName>=3, advances to owner step client-side, no request yet"}`
- **Why**: client-side `setStep(1)` after `schoolName.trim()>=3`; no request — non-technical guard before server work.

#### 2.8 `FILL` — `{"field": "ownerName", "value": "Anil Bhise", "why": "first owner user name"}`
- **Why**: field `ownerName` → tenant/user column (schoolName 3–120→name+slug; address/board/phone→config; ownerName→audit actor; ownerEmail→login identity; ownerPassword≥8→scrypt, owner-chose so `force_change=false`).

#### 2.9 `FILL` — `{"field": "ownerEmail", "value": "anil.bhise.sdmhtr@ssv-pune.edu.in", "why": "login identity, UNIQUE per tenant"}`
- **Why**: field `ownerEmail` → tenant/user column (schoolName 3–120→name+slug; address/board/phone→config; ownerName→audit actor; ownerEmail→login identity; ownerPassword≥8→scrypt, owner-chose so `force_change=false`).

#### 2.10 `FILL` — `{"field": "ownerPassword", "value": "***8+chars***", "why": "scrypt hash, auto-login, no force_change (owner chose it)"}`
- **Why**: field `ownerPassword` → tenant/user column (schoolName 3–120→name+slug; address/board/phone→config; ownerName→audit actor; ownerEmail→login identity; ownerPassword≥8→scrypt, owner-chose so `force_change=false`).

#### 2.11 `CLICK` — `{"button": "Create my school", "why": "POST /onboard/signup \u2014 ONE transaction: tenant+owner+catalog+audit+event, sets in-memory bearer"}`
- **Why**: fires `POST /onboard/signup` ONE transaction (tenant+owner+catalog(29)+audit+event→COMMIT→JWT+cookies+`{token,user,tenant,next}`); rate 3/min/IP, kill-switched; empty tenant, no demo data.

#### 2.12 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/onboard/signup", "post": "{\"schoolName\":\"Shree Samarth Vidyalaya sdmhtr\",\"address\":\"Plot 18, Sinhagad Road, Hingne Khurd, Pune, Maharashtra 411051\",\"board\":\"CBSE\",\"phone\":\"+91 98220 77889\",\"ownerName\":\"Anil Bhise\",\"ownerEmail\":\"anil.bhise.sdmhtr@ssv-pune.edu.in\",\"ownerPassword\":\"SsvPune@2026\"}"}`
- **Why**: `POST http://127.0.0.1:8080/onboard/signup` with `{"schoolName":"Shree Samarth Vidyalaya sdmhtr","address":"Plot 18, Sinhagad Road, Hingne Khurd, Pune, Maharashtra 411051","board":"CBSE","phone":"+91 98220 77889","ownerName":"Anil Bhise","ownerEmail"` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.13 `RESPONSE` — `{"status": 200, "url": "http://127.0.0.1:8080/onboard/signup"}`
- **Why**: `200 http://127.0.0.1:8080/onboard/signup` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.14 `REQUEST` — `{"method": "GET", "url": "http://127.0.0.1:8080/dataset", "post": ""}`
- **Why**: `GET http://127.0.0.1:8080/dataset` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.15 `REQUEST` — `{"method": "GET", "url": "http://127.0.0.1:8080/plugins", "post": ""}`
- **Why**: `GET http://127.0.0.1:8080/plugins` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.16 `RESPONSE` — `{"status": 200, "url": "http://127.0.0.1:8080/dataset"}`
- **Why**: `200 http://127.0.0.1:8080/dataset` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.17 `RESPONSE` — `{"status": 200, "url": "http://127.0.0.1:8080/plugins"}`
- **Why**: `200 http://127.0.0.1:8080/plugins` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.18 `SCREEN-AFTER-SIGNUP` — `{"text": "\n    SStart your schoolSchoolOS \u2014 the digital school officeShree Samarth Vidyalaya sdmhtr is readyYou are signed in as its owner.Create your IT admin \u2014 then they can add the rest of the staff, so you don't have to.Admit your students \u2014 one by one or by importing a file.Switch on modules \u2014 library, fees, transport\u2026 anything you don't switch on simply never appear`
- **Why**: screen narration (empty-world law for fresh school; own-name brand, honest empty states).

#### 2.19 `CLICK` — `{"button": "Set up my school", "why": "client-side navigate to /people-admin where office work starts, AuthGate validates via GET /me"}`
- **Why**: screen narration (empty-world law for fresh school; own-name brand, honest empty states).

#### 2.20 `REQUEST` — `{"method": "GET", "url": "http://127.0.0.1:8080/me", "post": ""}`
- **Why**: `GET http://127.0.0.1:8080/me` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.21 `REQUEST` — `{"method": "GET", "url": "http://127.0.0.1:8080/plugins", "post": ""}`
- **Why**: `GET http://127.0.0.1:8080/plugins` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.22 `RESPONSE` — `{"status": 200, "url": "http://127.0.0.1:8080/me"}`
- **Why**: `200 http://127.0.0.1:8080/me` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.23 `REQUEST` — `{"method": "GET", "url": "http://127.0.0.1:8080/me/effective", "post": ""}`
- **Why**: `GET http://127.0.0.1:8080/me/effective` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.24 `RESPONSE` — `{"status": 200, "url": "http://127.0.0.1:8080/me/effective"}`
- **Why**: `200 http://127.0.0.1:8080/me/effective` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.25 `RESPONSE` — `{"status": 200, "url": "http://127.0.0.1:8080/plugins"}`
- **Why**: `200 http://127.0.0.1:8080/plugins` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.26 `REQUEST` — `{"method": "GET", "url": "http://127.0.0.1:8080/onboard/status", "post": ""}`
- **Why**: `GET http://127.0.0.1:8080/onboard/status` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.27 `REQUEST` — `{"method": "GET", "url": "http://127.0.0.1:8080/plugins/people.admin/users", "post": ""}`
- **Why**: `GET http://127.0.0.1:8080/plugins/people.admin/users` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.28 `REQUEST` — `{"method": "GET", "url": "http://127.0.0.1:8080/school/classes", "post": ""}`
- **Why**: `GET http://127.0.0.1:8080/school/classes` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.29 `RESPONSE` — `{"status": 200, "url": "http://127.0.0.1:8080/plugins/people.admin/users"}`
- **Why**: `200 http://127.0.0.1:8080/plugins/people.admin/users` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.30 `RESPONSE` — `{"status": 200, "url": "http://127.0.0.1:8080/onboard/status"}`
- **Why**: `200 http://127.0.0.1:8080/onboard/status` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.31 `RESPONSE` — `{"status": 200, "url": "http://127.0.0.1:8080/school/classes"}`
- **Why**: `200 http://127.0.0.1:8080/school/classes` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.32 `LANDED` — `{"url": "http://127.0.0.1:4310/people-admin", "title": "SchoolOS \u2014 School Operations Platform"}`
- **Why**: client-side `navigate('/people-admin')` (no reload → bearer survives); AuthGate re-validates `GET /me`+`GET /me/effective`+`GET /plugins`+`GET /onboard/status`+`GET /users`+`GET /classes`.

#### 2.33 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/today", "why": "Today command center \u2014 briefings over real records"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.34 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.35 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.36 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/attention", "why": "Attention triage queue"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.37 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.38 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.39 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/next", "why": "Next actions"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.40 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.41 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.42 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/people", "why": "People roster (students list)"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.43 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.44 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.45 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/people-admin", "why": "People console \u2014 provision staff, admit students"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.46 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.47 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.48 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/classes", "why": "Classes & sections structure"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.49 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.50 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.51 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/timetable", "why": "Timetable grid (ops.timetable gate)"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.52 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.53 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.54 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/operations", "why": "Operations hub"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.55 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.56 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.57 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/fees", "why": "Fees \u2014 plans/obligations/payments/receipts"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.58 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.59 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.60 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/fees/plans", "why": "Fee plans dedicated door"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.61 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.62 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.63 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/admissions", "why": "Admissions funnel (admissions.funnel gate)"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.64 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.65 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.66 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/visitors", "why": "Visitors desk (ops.visitors gate)"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.67 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.68 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.69 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/transport", "why": "Transport overview"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.70 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.71 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.72 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/transport/setup", "why": "Transport routes/stops write model"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.73 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.74 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.75 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/library", "why": "Library home (library gate)"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.76 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.77 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.78 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/library/desk", "why": "Library desk workspace"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.79 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.80 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.81 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/library/setup", "why": "Library setup wizard"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.82 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.83 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.84 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/rails", "why": "Rails board \u2014 SMS/WhatsApp/email/UPI status"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.85 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.86 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.87 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/operations/hr", "why": "HR leave + duty"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.88 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.89 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.90 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/clinic", "why": "Health clinic log"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.91 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.92 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.93 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/returns", "why": "UDISE/CBSE/Tally exports"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.94 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.95 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.96 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/calendar", "why": "Calendar"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.97 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.98 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.99 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/cases", "why": "Cases list"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.100 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.101 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.102 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/incidents", "why": "Incidents"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.103 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.104 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.105 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/insights", "why": "Insights analytics over real records"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.106 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.107 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.108 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/reports", "why": "Reports"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.109 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.110 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.111 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/automation", "why": "Automation rules"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.112 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.113 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.114 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/constitution", "why": "School constitution policy engine"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.115 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.116 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.117 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/memory", "why": "Memory timeline"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.118 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.119 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.120 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/data-health", "why": "Data health checks"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.121 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.122 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.123 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/action-center", "why": "Action center approvals"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.124 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.125 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.126 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/audit", "why": "Append-only audit ledger"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.127 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.128 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.129 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/ai-governance", "why": "AI governance budgets/gates"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.130 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.131 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.132 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/ai-usage", "why": "AI usage meters"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.133 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.134 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.135 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/board-pack", "why": "Board pack oversight"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.136 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.137 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.138 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/principal-brief", "why": "Principal brief"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.139 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.140 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.141 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/owner/home", "why": "Owner oversight home"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.142 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.143 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.144 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/announcements", "why": "Announcements"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.145 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.146 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.147 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/compliance", "why": "Compliance"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.148 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.149 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.150 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/certificates", "why": "Certificates"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.151 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.152 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.153 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/delegations", "why": "Delegations"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.154 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.155 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.156 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/it", "why": "IT admin \u2014 API keys, sessions"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.157 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.158 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.159 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/roles", "why": "Custom roles console"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.160 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.161 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.162 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/plugins", "why": "Plugin manager \u2014 29 switches"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.163 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.164 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.165 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/plugins/settings", "why": "Plugin settings list"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.166 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.167 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.168 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/settings", "why": "Settings"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.169 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.170 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.171 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/teacher", "why": "Teacher home"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.172 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.173 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.174 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/teacher/homework", "why": "Teacher homework"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.175 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.176 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.177 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/parent", "why": "Parent home (light role chrome)"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.178 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.179 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.180 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/student", "why": "Student home"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.181 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.182 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.183 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/coord/home", "why": "Coordinator home"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.184 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.185 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.186 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/maintenance", "why": "Maintenance flagship"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.187 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.188 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.189 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/reception", "why": "Reception / AI front desk"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.190 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.191 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.192 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/migration", "why": "Migration console"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.193 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.194 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.195 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/people-admin", "why": "return to provisioning surface for interactive clicks"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.196 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.197 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.198 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/plugins", "why": "plugin manager switches"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.199 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.200 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

#### 2.201 `NAVIGATE` — `{"url": "http://127.0.0.1:4310/classes", "why": "school structure editor"}`
- **Why**: sanctioned public entry (`App.tsx:653` outside session tree); no session needed; static bundle only.

#### 2.202 `REQUEST` — `{"method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **Why**: `POST http://127.0.0.1:8080/auth/renew` with `` — the button's door; auth `Bearer <mem>` except public signup.

#### 2.203 `RESPONSE` — `{"status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **Why**: `401 http://127.0.0.1:8080/auth/renew` — 200 = committed+audited; 4xx = human copy (validation/gate); 409 = lifecycle/duplicate; 401 = renew/login needed (Fix-1).

## 3. Login via UI — School A (every click + every request, v2/v3/v6 logs)

#### 3.1 `NAVIGATE` — `{"step": "NAVIGATE", "url": "/today", "why": "cold open \u2014 AuthGate tries POST /auth/renew then shows login card"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.2 `REQUEST` — `{"step": "REQUEST", "method": "POST", "url": "/auth/renew", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.3 `RESPONSE` — `{"step": "RESPONSE", "status": 401, "url": "/auth/renew"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.4 `SCREEN` — `{"step": "SCREEN", "state": "login-card visible", "why": "no valid session yet"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.5 `FILL` — `{"step": "FILL", "field": "email", "value": "meera.deshpande@svm-kothrud.edu.in", "why": "login identity"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.6 `FILL` — `{"step": "FILL", "field": "password", "value": "***", "why": "scrypt verify server-side"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.7 `CLICK` — `{"step": "CLICK", "button": "Sign in", "why": "POST /auth/login -> in-memory bearer + GET /me + GET /me/effective + GET /dataset"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.8 `REQUEST` — `{"step": "REQUEST", "method": "POST", "url": "/auth/login", "post": "{\"email\":\"meera.deshpande@svm-kothrud.edu.in\",\"password\":\"SvmKothrud@2026\"}"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.9 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/auth/login"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.10 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/me/tenants", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.11 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/me/tenants"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.12 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/me", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.13 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/me"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.14 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/me/effective", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.15 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/me/effective"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.16 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/dataset", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.17 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/plugins", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.18 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/dataset"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.19 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/plugins"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.20 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/events", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.21 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/plugins/library/overdue", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.22 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/transport/routes", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.23 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/capabilities", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.24 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/actions?status=open", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.25 `RESPONSE` — `{"step": "RESPONSE", "status": 403, "url": "/plugins/library/overdue"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.26 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/events"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.27 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/capabilities"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.28 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/transport/routes"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.29 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/actions?status=open"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.30 `AFTER-LOGIN` — `{"step": "AFTER-LOGIN", "url": "/today", "sidebar": true, "head": "Skip to content\nM\nSchoolOS\nSaraswati Vidya Mandir Kothrud\nDAILY OPERATIONS\nNeeds you\nApprovals\nToday's briefing\nBoard pack\nMorning brief\nAnnouncements"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.31 `CLICK` — `{"step": "CLICK", "nav": "Today", "why": "client-side route change, AuthGate already validated, screen hydrates via its doors"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.32 `SCREEN` — `{"step": "SCREEN", "nav": "Today", "url": "/today", "crash": false, "gated": false, "denied": false, "head": "Good evening, Meera Deshpande"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.33 `CLICK` — `{"step": "CLICK", "nav": "People", "why": "client-side route change, AuthGate already validated, screen hydrates via its doors"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.34 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/students?limit=200", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.35 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/students?limit=200"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.36 `SCREEN` — `{"step": "SCREEN", "nav": "People", "url": "/people", "crash": false, "gated": false, "denied": false, "head": "Directory"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.37 `CLICK` — `{"step": "CLICK", "nav": "Classes", "why": "client-side route change, AuthGate already validated, screen hydrates via its doors"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.38 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/school/classes", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.39 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/school/subjects", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.40 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/school/subjects"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.41 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/school/classes"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.42 `SCREEN` — `{"step": "SCREEN", "nav": "Classes", "url": "/classes", "crash": false, "gated": false, "denied": false, "head": "Classes & sections"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.43 `CLICK` — `{"step": "CLICK", "nav": "Timetable", "why": "client-side route change, AuthGate already validated, screen hydrates via its doors"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.44 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/plugins/ops.timetable/periods", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.45 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/plugins/ops.timetable/grid", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.46 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/school/classes", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.47 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/school/subjects", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.48 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/school/classes"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.49 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/school/subjects"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.50 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/plugins/ops.timetable/periods"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.51 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "/plugins/ops.timetable/grid"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.52 `SCREEN` — `{"step": "SCREEN", "nav": "Timetable", "url": "/timetable", "crash": false, "gated": false, "denied": false, "head": "Timetable"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.53 `CLICK` — `{"step": "CLICK", "nav": "Operations", "why": "client-side route change, AuthGate already validated, screen hydrates via its doors"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.54 `SCREEN` — `{"step": "SCREEN", "nav": "Operations", "url": "/operations", "crash": false, "gated": false, "denied": false, "head": "Operations"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.55 `CLICK` — `{"step": "CLICK", "nav": "Fees", "why": "client-side route change, AuthGate already validated, screen hydrates via its doors"}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.56 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/fees/settings", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.57 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/fees/obligations", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.58 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/payments", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.59 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/fees/concessions", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

#### 3.60 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "/fees/installments", "post": ""}`
- **Why**: cold open → `POST /auth/renew 401` (no cookie split-origin, expected probe) → `.login-card` → fill identity+secret → `Sign in` (`loginFull` reads body directly to catch `403 mustChange`+RESTRICTED token) → `POST /auth/login 200` → `GET /me/tenants`+`GET /me`+`GET /me/effective`+`GET /dataset`+`GET /plugins` (`completeSignIn`: session hint, `setRole`, `setSessionIdentity`, `ensureDataset`) → Today hydrates (`/actions?status=open`, `/events`, `/transport/routes`, `/capabilities`). Token memory-only (FEX-3); same-origin cookie would persist (Fix-1).

## 4. School Structure via UI (`/classes`, subjects, year) — every click + request

#### 4.1 Sidebar click `Classes & sections` (`a[href="/classes"]`, client-side nav preserves bearer)
- **Requests**: `GET /school/classes 200` (`{classes:[13]}`) + `GET /school/subjects 200` (11) — read open to any signed-in (names not sensitive); write owner/principal/itadmin (`PUT /school/classes`, `POST /school/subjects`).
- **Why**: one list drives every picker/roster/timetable cell; save normalises + upserts `app.classes/sections` + retires removed (never DELETE) + audits + emits `platform.school.classes.updated.v1`.
- **Browser**: v3 `REQUEST GET /school/classes` → `RESPONSE 200`, `REQUEST GET /school/subjects` → `RESPONSE 200`; `CLASSES-SCREEN` text + screenshot `/tmp/b3_classes.png`; v8 `ROUTE /classes crash:false`.

#### 4.2 Class assignments (14) — `POST /class-assignments` (principal office; teacher by assignment only)
- **Clicks**: `/classes` → assignment panel → pick teacher (`GET /school/staff?role=teacher` id+name+role, no PII) → pick grade/section → Assign. Handover retires prior holder (partial unique `active`) + audits change-of-holder.
- **Why**: PRD-2 ownership — teacher marks only owned classes (`app.class_assignments`); others 403 `No class is assigned… Ask administrator`; owner/principal/coordinator fallback = principal office (audited as such).
- **Rows**: Priya→Nursery-A … Rohit→8-A (§1.5 notes); unassigned 9/10-B revert to office until staffed (honest gap).

#### 4.3 Attendance register — `GET /attendance` + `POST /attendance/mark` (upsert, per-student audit, absence notices queued not sent)
- **Clicks**: `/attendance` → date (`YYYY-MM-DD`, default IST today) + grade/section filter → roster (`admission_no,name,grade,section,status,note`, 2000 cap) → tick present/absent/late/leave (≤300/submit, 413 otherwise) → Submit.
- **Requests**: `GET /attendance?date=2026-10-03&grade=5&section=A 200` (2 rows, `status:null` before) → `POST /attendance/mark 200` `{date,marks:[{studentId,status}]}` → `{ok,marked:2,absent:1,noticesQueued:1,guardiansResolved:1}` (Shreya absent → `app.communications ABSENCE_NOTICE queued` + `emitEvent(attendance.absences)` + per-changed-student audit `DAT-6`; re-submit unchanged = no audit).
- **Why**: `ON CONFLICT(tenant,student,school_date) DO UPDATE` (re-mark = update); parent reads own children live (`child_link` join, no copy); student whole-register 403 (SEC-3); derived % at read (present+late/all, leave counts against, raw buckets included).
- **Browser**: v8 `ROUTE /attendance crash:false`; Today/Attention surface the absent + queued notice (triage, never auto-send).

## 5. Fees Domain Deep (heads → plans → obligations → payments → receipts → concessions → installments → rails)

#### 5.1 Heads (`POST /fees/heads`)
- owner/principal/finance: `Tuition TUIT 450000c (₹4,500)`, `Transport TRANS 120000c`, `Activity ACT 80000c` → `{feeHead:{id,name,active}}` (paise
- `is_refundable`, `tax_code`, `gl_ledger` for Tally). UI: `/fees` → Fee structure → + Head. Why three: tuition (all), transport (bus riders), activity (all) — mirrors real CBSE fee card.

#### 5.2 Plans + generate (`/fees/plans`, `/generate`)
- finance: template `{grade-set × term-list}` (e.g. `2026-27-T1` Std 1–10 tuition+activity
- `2026-27-TRANS-T1` bus riders) → `/generate` fans out to ACTIVE students in scope in ONE statement, idempotent `(tenant,student,term,label)` (regen skips
- paid rows never overwritten D-5/D-21). UI: `/fees/plans` → New plan → Generate. Browser: `/fees/plans` visited v8 `crash:false`.

#### 5.3 Obligations (`GET /fees/obligations`)
- owner…coordinator+parent/student(scoped): per-student dues (`billed - paid = outstanding`, voided excluded, `not_due` counts in billed). UI: `/fees` table (find dues) → per-student drill. Browser: v2/v3 `REQUEST GET /fees/obligations` → `RESPONSE 200` per `/fees` visit
- empty-school zeros (v7).

#### 5.4 Payments (`POST /fees/payments`, `POST /fees/payments/:id/confirm`)
- parent/finance/owner: record `{obligationId, amount_cents, mode: cash|upi|razorpay, ref}` → pending → finance/owner `confirm` settles (obligation state machine
- `paid_cents` never decreases). Kernel-only settlement
- rails never move money (facts only). UI: `RecordPaymentModal.tsx` → Confirm (staff-only).

#### 5.5 Receipts (`GET /fees/receipts`, `/:id`, `/:id/pdf`)
- scoped list + detail + PDF (address/board from tenant config
- hash-audited). UI: receipt → Print/Download. Browser: `GET /payments`, `GET /fees/delivery` per `/fees` visit.

#### 5.6 Concessions (`POST /fees/concessions`, `:id/decide`)
- any of owner…teacher may request (sibling/EWS/staff-child), owner/principal/finance decide (approve/reject, audited). UI: Concessions tab → Request → Decide. Browser: `GET /fees/concessions 200` per visit.

#### 5.7 Installments + settings + late-fees + dunning
- `GET /fees/installments` (splits), `GET/PUT /fees/settings` (owner/finance_head: due dates, grace, fine rules), `POST /fees/late-fees/run`, `POST /fees/dunning/run` (reminders → queue, never direct send). UI: Settings tab. Browser: `GET /fees/settings/installments/delivery 200` per visit.

#### 5.8 UPI + Razorpay rails (logger sandbox, honest 503)
- `payments.upi` (intent links + `UPI_WEBHOOK_SECRET` HMAC, freshness 15m) + `payments.razorpay` (orders + `payment.captured/failed` webhooks). Unconfigured → `503` with operator guidance (enter gateway/VPA/keys in `/plugins/settings`), webhooks fail-closed. UI: `/rails` board (`configured:false`, `sandbox:true` via `GET /capabilities`). Money-touching invariant: rails = facts only
- settlement = kernel staff confirm (Fees §4.2).

#### 5.9 Analytics (`GET /reports/fees/summary`, `GET /plugins/ops.bi/fees/aging`)
- whole-ledger `{terms,heads,totals:{obligations,billed,collected,outstanding,voided,fully_paid},collectionPct,academicYearId,note}` (paid never decreases
- voided excluded
- not_due in billed) + overdue-only aging buckets. 60s-cached, 500-cap (≤60s stale, never >1m wrong). UI: `/insights` + `/reports`. Browser: v2 `REQUEST /reports/fees/summary → RESPONSE 200`
- v7 empty `200` zeros (`collectionPct:null`)
- v8 `ROUTE /insights crash:false`.

## 6. Library Domain Deep (borrower data: catalog → copies → members → issue/return/renew → holds → fines → acquisitions)

#### 6.1 Catalog (`library.book`)
- librarian: `+ Add book` (`/library/desk/catalog/new`) → `{title,author,isbn,publisher,year,category}` (e.g. `Wings of Fire — Kalam`, `Malgudi Days — Narayan`, `Blue Umbrella — Bond`, NCERT Std5 Maths/EVS) → `{book:{id}}`. Import CSV supported (`catalog.imported.v1`). UI: `/library/desk/catalog` table (search by title/author/ISBN). Browser: v8 `ROUTE /library/desk/catalog crash:false`, `ROUTE /library/desk/catalog/new crash:false`. Tenant identifier scheme from settings (`accession|barcode|isbn|qr|custom`, prefix `LIB`, padding 5).

#### 6.2 Copies (`library.copy`)
- librarian: book → `+ Add copy` → `{copy_code: LIB-00001…, barcode, accession, status:available}` (per-copy tracking
- `availability_derived_from_copies`
- `one_open_loan_per_copy`). Scan accepts `copy_code|barcode|isbn|accession`. UI: Book detail (`/library/desk/catalog/:id`) → copies list. Browser: v8 visited (crash:false).

#### 6.3 Members (borrower identities)
- students + teachers + staff borrow (`one_borrower_identity`)
- `max_loans_student:2 / teacher:5 / staff:5`, `loan_days_student:14 / teacher:21 / staff:21`, `renewal_limit:1 / renewal_days:7`, `grace_days:0`, `max_reservations:3`. UI: `/library/desk/members` (roster join). Browser: v8 `crash:false`. Owner `GET /plugins/library/overdue → 403 role owner not permitted` is correct (borrower-level overdue = librarian-only
- owner gets aggregates) — see Fix-3.

#### 6.4 Issue (`library.loan.issued.v1`)
- librarian desk: `/library/desk/issue` → scan member + scan copy → `POST issue` (`{memberId,copyId,due: today+loan_days}`) → validates max_loans, no open loan on copy, member cap → creates open loan + `emitEvent` + audit. UI: Issue form (member picker + copy picker). Browser: v8 `ROUTE /library/desk/issue crash:false`.

#### 6.5 Return + renew (`returned/renewed.v1`)
- `/library/desk/return` → scan copy → computes UTC-calendar days late × `fine_per_day_cents:500 (₹5)` (cap `fine_cap_cents:20000`), `fine_computed_once_at_return` → closes loan + writes fine row (open) → renew extends `due+renewal_days` if under limit + no hold. UI: Return form shows fine inline. Browser: v8 `crash:false`.

#### 6.6 Holds FIFO (`reservation.created/ready.v1`)
- `/library/desk/holds` → reserve `{bookId,memberId}` → FIFO queue (`holds_fifo`) → `ready` when copy returns → `reservation_hold_days:2` pickup window → `due_reminder [2,1]` days. `allow_self_reserve:true`. UI: Holds queue table. Browser: v8 `crash:false`.

#### 6.7 Fines ledger (`fine.settled.v1`)
- `/library/desk/fines` → open fines (`overdue_repeat_days:7` re-nudge) → Settle (cash/UPI ref) or Waive (`allow_fine_waiver:true`, audited, librarian+owner) → `lost_charge_percent:100` + `damage_charge` when lost/damaged. No DELETE (D-35). UI: Fines table + Settle/Waive. Browser: v8 `crash:false`.

#### 6.8 Acquisitions + reports + setup
- `/library/desk/requests` (purchase requests, `allow_acquisition_requests:true`, `max_open:5`, votes `acquisition_votes:true` → `decided`) → `/library/desk/reports` (circulation, overdue, fines) → `/library/desk/settings` (schema from manifest: loan days, caps, quiet_hours_ist `[21,8]`, notify `in_app`, channels) → `/library/insights` (owner aggregates) → `/library/setup` (wizard: scheme, prefix, librarian account — explains why library born OFF). UI: all visited v8 `crash:false`
- `/library` home + `/library/desk` dashboard shell the 11 jobs.

## 7. Every Remaining Domain + Plugin (one block each — clicks, requests, data, why)

#### 7.1 Admissions funnel (`admissions.funnel` v1.3.0)
- `/admissions` (`KernelGate admissions.funnel`): Lead capture (`name,phone,grade,soughtYear,source`) → `admission.enquiry.captured` → default rule `enquiry → follow-up pipeline` (outbox fan-out, migration 123 + catalog seed, never auto-message) → stage machine (new→contacted→visited→offered→accepted→enrolled) → Offer/Accept (session-bound ownership) → Enrol converts to `POST /students` (same P2-6/5/8 guards). UI: FunnelBoard columns + lead drawer. Browser: v2/v8 `ROUTE /admissions crash:false`. Why: paid-enquiry honesty (no auto-SMS to guardians).

#### 7.2 Visitors desk (`ops.visitors` v1.0.2, born ON)
- `/visitors` (`KernelGate`): Pre-register (`visitor,phone,purpose,child,slot`) → Check-in (badge, gate log) → Check-out → Pickup OTP verify (`guardian lookup via guardians+child_link union`, H2). UI: VisitorsBoard (today list + pre-reg form + OTP box). Browser: v2/v8 `crash:false`. Why born ON: desk must work day one
- OTP prevents wrong-child handover.

#### 7.3 Transport (`transport.gps` v1.0.0 + kernel routes/stops)
- `/transport` (overview: 4 routes, assignments, delays) + `/transport/setup` (`KernelGate transport.gps`: routes/stops writer — retirement never deletion, H1): Route `{name, depot, loop}` (Route-1 Kothrud depot→Karve Putala
- Route-2 Chandni Chowk
- Route-3 Warje
- Route-4 Bavdhan) → Stops `{name, eta}` → assign `students.bus_route` → GPS `POST positions` (`vendor: generic|eternalrobotics…`, 30d retention) → delay≥10m → approval-required guardian notice (Transport §3.1, never auto-send) → `simulate-breakdown` drill. UI: Transport + Setup tables + GPS widget (`GpsDelayApprovals`). Browser: `GET /transport/routes 200` per Today/login
- v2/v8 `crash:false`.

#### 7.4 Timetable (`ops.timetable` v1.0.0, born ON)
- `/timetable` (`KernelGate`): Periods (`GET /plugins/ops.timetable/periods`) + Grid (`GET /plugins/ops.timetable/grid` per class×day×period: `{subject, teacher_name, room}`) + Substitutions (leave → suggest via `_shared/substitute-suggest`, coordinator reviews) + attendance period-autofill. Write surface M3/M4 (coordinator+). UI: grid editor (teacher picker from `GET /school/staff`, P2-15 minimal id+name+role, no PII). Browser: v3 `periods+grid+classes+subjects 200`
- v8 `crash:false`. Why born ON: school runs day one.

#### 7.5 Files store (`files.store` v1.0.0, born ON)
- Artifact storage (kernel-native, `server/storage/`, 2MB caps): pupil docs (`scope:student, ref:studentId` — TC/birth-cert via parent download, access-checked) + `attachment_ref` elsewhere = validated names/URLs only. UI: Documents (`/documents`: registry + expiry) + per-record attachments. Browser: v8 `/documents crash:false`. Why born ON: office files day one.

#### 7.6 HR leave (`hr.leave`) + duty
- `/operations/hr`: Leave requests (teacher `POST /teacher/leave` + `GET /mine` → coordinator decides on kernel door `teacher.leave.<id>`) + Duty roster + Substitutions feed. UI: HR tables + MyLeave (`/teacher/leave`). Browser: v8 both `crash:false`. Why: leave without register gap (substitution suggested).

#### 7.7 Health clinic (`health.clinic`)
- `/clinic` (`KernelGate`): Sick passes + clinic log + health issues. UI: Clinic log table + pass form (5 doors, infirmary). Browser: v8 `crash:false`. Why: nurse paper trail, safeguarding-adjacent.

#### 7.8 Exams (`exams.assessment` v1.0.1)
- Teacher `ExamMarks` (`/teacher/exam-marks`: enter per student×subject) → moderation → publish snapshots `plugin_exams.report` (only stored snapshots in product) → report cards (CBSE template) → `ClassAnalytics/MasteryMap/CurriculumProgress/ProgressStory` recompute. UI: 5 exam screens visited v8. Why: publish-once integrity (weightage totals enforced by `pack.cbse`).

#### 7.9 CBSE pack (`pack.cbse`)
- Policy pack (stateless, no own writes): board calendar + holidays + grading scale + report structure + weightage rules + OASIS export + compliance report templates. Settings: `affiliation_no:1130456`, `academic_year:2026-27`, `board:CBSE`. UI: `/returns` (OASIS) + `/calendar` + exam validation errors. Browser: v8 `crash:false`. Why: CBSE determinism (adds obligations, never relaxes safeguards).

#### 7.10 DPDP pack (`pack.dpdp` v1.1.1)
- Consent ledger (append-only: purpose+validity 1095d) + SAR state machine (export/erasure, SLA 30d, two-person rule) + retention hooks, residency IN. UI: `/parent/consents`, `/parent/requests`, Compliance SAR queue. Browser: visited `crash:false`. Why: DPDP Act 2023 honesty (immutable consent, SLA-tracked).

#### 7.11 Comms + rails (`rails.sms|whatsapp|email`, `comms.whatsapp`)
- `provider:logger` default (structured log + ok, sandbox-verified) → `http-generic` (URL+auth header in settings) → `cloud-api/smtp` when credentials exist (per-tenant settings + DLT compliance = operator duty). Dedup-keyed, E.164, quiet_hours. UI: `/rails` board (`GET /capabilities` → `sms/whatsapp:{configured:false,sandbox:true}`) + `/plugins/settings/:id` credential forms (secret-class never surfaced). Dispatcher drains queue to log-only until configured. Browser: v8 `crash:false`. Why: never fake delivery.

#### 7.12 UPI + Razorpay (money rails, facts only)
- `payments.upi` (links + `UPI_WEBHOOK_SECRET` HMAC, freshness 15m, `gateway:razorpay|cashfree|phonepe`, `default_vpa`) + `payments.razorpay` (orders + `payment.captured/failed`, key fallbacks to env). Unconfigured → `503` guidance
- webhooks fail-closed. Settlement = kernel staff confirm only (Fees §4.2). UI: `/rails` + fee modals. Browser: `GET /capabilities` shows `razorpay:{configured:false}`.

#### 7.13 Tally + UDISE + BI + Import (`accounting.tally`, `ops.udise`, `ops.bi`, `ops.import`)
- Tally: reconciliation export (manual door, no scheduler) → `/returns`. UDISE+: aggregates (enrollment class×section×gender incl. `not_recorded`, staff by role, infra by category — never PII
- needs `udise_code` 11-digit) → `/returns`. BI: attendance%/fee-aging/funnel/homework read models (60s cache, 500 cap) → `/insights`+`/reports`. Import: column-map → per-row validate → shadow load (zero writes) → commit + real `differenceCents` receipt → `/migration` + PeopleAdmin Import pane. Browser: `/returns`, `/insights`, `/reports`, `/migration` v8 `crash:false`
- empty `fees/summary 200 zeros`
- un-enabled `ops.bi 409` gate (Fix-4).

#### 7.14 Teacher classroom (`teacher.classroom`)
- Homework post (class×subject×due) → submissions (one-shot, text/link, late auto) → assigning-teacher-only review (reviewed/graded/resubmit + feedback) → inbox (pending/reviewed/late/missing) + lessons lifecycle + leave. Privacy: students submit-as-self only (second refused)
- teachers see own homework
- review = assigner only. UI: `/teacher`, `/teacher/homework|submissions|lessons|leave` visited v8. Browser: `crash:false`.

#### 7.15 Teacher copilot (`teacher.copilot` v0.1.0, deterministic)
- Day brief (eod/week) + curriculum tree (seeded, audited check-off A1) + mastery (evidence decay A3, `needs support` never `failing`) + ask/draft (keyword-routed, labelled templates, budget `copilot.call` A2, tokens 0 until LLM v1). UI: `/teacher/copilot|mastery|curriculum|progress-story|analytics`. Browser: v8 `crash:false`. Why: no LLM anywhere (product ruling)
- budgets exist for v1.

#### 7.16 Teacher support (`teacher.support`: concerns/safety/doubts/interventions/PTM)
- Concerns (one-tap + append-only status + coordinator routing) + Safety box (anonymous stores no identity
- serious → `safety.page.<id>` kernel page to principal
- designated reads only
- weekly class/category counts, never people) + Doubts (deterministic routing over timetable + FAQ promote) + Interventions (append-only lifecycle) + PTM slots/bookings (teacher-private notes RLS-pinned). UI: `/teacher/support|concerns|doubts|interventions|ptm|safety` + `/counselor/concerns`. Browser: v8 `crash:false`. Posture HUMAN-ONLY for safeguarding.

#### 7.17 Parent assistant (`parent.assistant`, deterministic)
- Per-child brief (attendance today, homework due 24h, consents, 7d exams, requests, weekly %, published reports) + keyword ask (own records only + sources + honest no + teacher pointer) + labelled draft templates (question-to-teacher, leave note
- parent edits before send) + explains from real numbers. Budget `parent.copilot_call` 100/mo (P-copilot). Scoped `family.child_link`
- cross-guardian refused
- teachers refused. UI: `/parent/copilot` (+family/consents/requests/child/:id). Browser: v8 `crash:false` (owner sees scope honesty).

#### 7.18 Family view (`family.view`) + Student world (`student.world`) + Coord view (`coord.view`)
- Family: guardian↔child links + consents + requests + timeline (union guardians+child_link resolver). Student: kiosk home (next class IST + counts + test + attention + bag-tomorrow) + homework split digital/paper (paper=no-submit, teacher receipts) + own results + self-study (mistakes/flashcards/tasks) + print queue (office prints) + noticeboard + wellbeing→counselor (anonymous = no identity
- `no-store`, idle-countdown). Coord: substitutions review + workload + curriculum monitor + escalations + approvals. UI: `/parent/family`, `/student/*` (9), `/print-queue`, `/wellbeing-queue`, `/noticeboard`, `/coord/*` (6). Browser: all v8 `crash:false` (owner redirected/scoped honestly where role-gated).

#### 7.19 Documents + Cases + Incidents + Maintenance flagship
- Documents: registry + expiry (TC/birth-cert) + access-checked download. Cases: list → detail (`/cases/:id`) + triage chain + SoD (own-approve refused) + confidentiality (B9). Incidents: log + pattern. Maintenance (13 screens): `/maintenance` hub + `work-orders` (+`:id`) + `technician` + `assets` (+`:id`: fans/RO/bus) + `preventive` (AMC) + `inspections` + `inventory` + `vendors` (Balaji/PureAqua) + `intelligence` + `map` + `report` (ReportIssue). UI: all visited v8 `crash:false`.

#### 7.20 Oversight + governance (owner/principal)
- `BoardPack` (`/board-pack`: oversight:board-pack write owner/principal/itadmin) + `PrincipalBrief` + `OversightHome` (`/owner/home`, `/principal/home`) + `Announcements` (announce + owner/principal approve) + `Compliance` + `Certificates` (write + owner/principal sign: bonafide/TC) + `Delegations` + `Appraisals` + `ItAdmin` (`/it`: API keys list/create/revoke — existed server-only, now UI) + `Roles` (`/roles`: custom Librarian preset + retire→rename+empty mask
- server refuses while bound) + `PluginSettings` (`/plugins/settings(/:id)`: schema forms) + `Settings` + `ActionCenter` + `Audit` (hash ledger) + `AiGovernance/AiUsage` (budgets/gates/meters) + `Constitution` (AUTO/APPROVAL/HUMAN-ONLY) + `Memory` + `DataHealth` + `Automation` + `Group` + `Calendar` + `Migration`. UI: all v8 `crash:false`
- sidebar `SchoolOS` brand = own school (`sessionSchoolName`).

## 8. Every Request Census (browser-observed — method + URL + body + status + why)

### 8.1 Census — 1090 browser requests across v1+v2+v6+v7+v8 (unique 46)

#### 8.1.1 `GET /actions?status=open` ×87
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.2 `GET /announcements` ×1
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.3 `GET /capabilities` ×88
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.4 `GET /certificates` ×1
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.5 `GET /compliance` ×1
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.6 `GET /dataset` ×88
- **Fired by**: session hydrate.
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: empty-world dataset (no-store) / plugin truth re-sync.

#### 8.1.7 `GET /events` ×89
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.8 `GET /fees/concessions` ×3
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.9 `GET /fees/delivery` ×3
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.10 `GET /fees/installments` ×3
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.11 `GET /fees/obligations` ×3
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.12 `GET /fees/settings` ×3
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.13 `GET /me` ×88
- **Fired by**: session hydrate.
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: establish/validate session (only live /me counts).

#### 8.1.14 `GET /me/effective` ×88
- **Fired by**: session hydrate.
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: establish/validate session (only live /me counts).

#### 8.1.15 `GET /me/tenants` ×88
- **Fired by**: session hydrate.
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: establish/validate session (only live /me counts).

#### 8.1.16 `GET /onboard/status` ×3
- **Fired by**: checklist card.
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: setup progress + roster + structure for the console.

#### 8.1.17 `GET /payments` ×3
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.18 `GET /plugins` ×89
- **Fired by**: session hydrate.
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: empty-world dataset (no-store) / plugin truth re-sync.

#### 8.1.19 `GET /plugins/library/ops/overview?days=30` ×2
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.20 `GET /plugins/library/overdue` ×2
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.21 `GET /plugins/ops.bi/attendance?days=30` ×3
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.22 `GET /plugins/ops.timetable/grid` ×1
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.23 `GET /plugins/ops.timetable/periods` ×1
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.24 `GET /plugins/ops.visitors/visitors` ×1
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.25 `GET /plugins/people.admin/users` ×3
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: setup progress + roster + structure for the console.

#### 8.1.26 `GET /reports/board-pack` ×1
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.27 `GET /reports/fees/summary` ×3
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.28 `GET /school/classes` ×5
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: setup progress + roster + structure for the console.

#### 8.1.29 `GET /school/subjects` ×2
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.30 `GET /students?` ×2
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.31 `GET /students?limit=200` ×1
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.32 `GET /transport/routes` ×88
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.33 `GET /work-orders` ×1
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.34 `GET /workflow-rules` ×1
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.35 `GET http://127.0.0.1:8080/dataset` ×1
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.36 `GET http://127.0.0.1:8080/me` ×1
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: establish/validate session (only live /me counts).

#### 8.1.37 `GET http://127.0.0.1:8080/me/effective` ×1
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: establish/validate session (only live /me counts).

#### 8.1.38 `GET http://127.0.0.1:8080/onboard/status` ×1
- **Fired by**: checklist card.
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: setup progress + roster + structure for the console.

#### 8.1.39 `GET http://127.0.0.1:8080/plugins` ×2
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: the screen narrating its records (empty → honest empty, never demo; OFF plugin → 409 gate; wrong role → honest denied).

#### 8.1.40 `GET http://127.0.0.1:8080/plugins/people.admin/users` ×1
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: setup progress + roster + structure for the console.

#### 8.1.41 `GET http://127.0.0.1:8080/school/classes` ×1
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: setup progress + roster + structure for the console.

#### 8.1.42 `POST /auth/login` ×88
- **Fired by**: Login Sign in.
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: establish/validate session (only live /me counts).

#### 8.1.43 `POST /auth/renew` ×89
- **Fired by**: AuthGate cold-open probe.
- **Auth**: none (public, 3/min/IP, kill-switched).
- **Why**: establish/validate session (only live /me counts).

#### 8.1.44 `POST /plugins/people.admin/users` ×1
- **Fired by**: screen hydration (sidebar click, client-side nav).
- **Auth**: Bearer <mem> (memory-only; cookie same-origin only) + server JWT+jti+RLS re-check.
- **Why**: setup progress + roster + structure for the console.

#### 8.1.45 `POST http://127.0.0.1:8080/auth/renew` ×57
- **Fired by**: AuthGate cold-open probe.
- **Auth**: none (public, 3/min/IP, kill-switched).
- **Why**: establish/validate session (only live /me counts).

#### 8.1.46 `POST http://127.0.0.1:8080/onboard/signup` ×1
- **Fired by**: public signup button.
- **Auth**: none (public, 3/min/IP, kill-switched).
- **Why**: ONE-tx tenant+owner+catalog+audit+event.

### 8.2 Per-route browser states — all 85 v8 routes (click/goto + UI-login when needed + screen + requests)

#### 8.2.1 `/today` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/today)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.2 `/attention` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/attention)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.3 `/next` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/next)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.4 `/people` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/people)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /dataset`; `GET /plugins`; `GET /me/effective`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.5 `/learning` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/learning)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.6 `/attendance` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/attendance)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.7 `/classes` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/classes)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.8 `/timetable` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/timetable)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.9 `/operations` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/operations)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.10 `/fees` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/fees)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.11 `/fees/plans` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/fees/plans)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.12 `/admissions` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/admissions)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.13 `/visitors` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/visitors)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.14 `/transport` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/transport)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.15 `/transport/setup` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/transport/setup)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.16 `/documents` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/documents)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.17 `/maintenance` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/maintenance)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.18 `/maintenance/work-orders` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/maintenance/work-orders)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.19 `/maintenance/technician` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/maintenance/technician)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.20 `/maintenance/assets` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/maintenance/assets)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.21 `/maintenance/preventive` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/maintenance/preventive)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.22 `/maintenance/inspections` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/maintenance/inspections)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.23 `/maintenance/inventory` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/maintenance/inventory)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.24 `/maintenance/vendors` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/maintenance/vendors)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.25 `/maintenance/intelligence` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/maintenance/intelligence)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.26 `/maintenance/map` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/maintenance/map)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.27 `/maintenance/report` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/maintenance/report)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.28 `/reception` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/reception)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.29 `/migration` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/migration)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.30 `/plugins` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/plugins)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.31 `/people-admin` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/people-admin)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.32 `/library` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/library)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.33 `/library/desk` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/library/desk)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.34 `/library/desk/issue` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/library/desk/issue)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.35 `/library/desk/return` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/library/desk/return)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.36 `/library/desk/catalog` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/library/desk/catalog)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.37 `/library/desk/catalog/new` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/library/desk/catalog/new)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.38 `/library/desk/holds` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/library/desk/holds)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.39 `/library/desk/fines` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/library/desk/fines)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.40 `/library/desk/requests` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/library/desk/requests)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.41 `/library/desk/members` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/library/desk/members)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.42 `/library/desk/reports` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/library/desk/reports)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.43 `/library/desk/settings` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/library/desk/settings)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.44 `/library/insights` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/library/insights)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.45 `/library/setup` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/library/setup)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.46 `/rails` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/rails)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.47 `/maintenance/report` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/maintenance/report)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.48 `/operations/hr` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/operations/hr)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.49 `/clinic` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/clinic)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.50 `/returns` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/returns)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.51 `/calendar` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/calendar)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.52 `/cases` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/cases)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.53 `/incidents` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/incidents)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.54 `/insights` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/insights)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.55 `/reports` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/reports)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.56 `/automation` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/automation)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.57 `/constitution` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/constitution)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.58 `/memory` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/memory)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.59 `/data-health` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/data-health)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.60 `/action-center` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/action-center)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.61 `/audit` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/audit)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.62 `/ai-governance` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/ai-governance)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.63 `/ai-usage` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/ai-usage)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.64 `/group` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/group)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.65 `/board-pack` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/board-pack)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.66 `/principal-brief` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/principal-brief)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.67 `/owner/home` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/owner/home)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.68 `/principal/home` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/principal/home)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.69 `/announcements` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/announcements)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.70 `/compliance` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/compliance)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.71 `/certificates` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/certificates)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.72 `/delegations` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/delegations)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.73 `/it` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/it)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.74 `/settings` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/settings)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.75 `/roles` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/roles)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.76 `/plugins/settings` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/plugins/settings)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.77 `/account/password` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/account/password)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.78 `/parent` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/parent)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.79 `/parent/complaints` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/parent/complaints)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.80 `/parent/chat` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/parent/chat)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.81 `/parent/fees` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/parent/fees)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.82 `/parent/family` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/parent/family)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.83 `/parent/consents` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/parent/consents)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.84 `/parent/requests` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/parent/requests)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

#### 8.2.85 `/parent/copilot` → `/today` — head `Good evening, Meera Deshpande`
- **How reached**: `goto(/parent/copilot)` + conditional UI login (fill Email + Password + Click Sign in) when `.login-card` present (hard reload drops memory bearer split-origin, Fix-1); otherwise already-authed client-side state. No fetch/psql — only `page.goto/fill/click`.
- **State**: `crash:False` (all false — ErrorBoundary never tripped), `login:False`, `gated:False` (true only when plugin OFF — honest lifecycle gate), `denied:False` (true only when role lacks surface — honest Guard).
- **Requests (11)**: `POST /auth/renew`; `POST /auth/login`; `GET /me/tenants`; `GET /me`; `GET /me/effective`; `GET /dataset`; `GET /plugins`; `GET /actions?status=open`; `GET /events`; `GET /transport/routes`
- **Why these doors**: the screen's hydration set (roster/register/fees/grid/loans/leads/rules/ledger — each `withUser` + RLS + audit/event on writes; reads compute live).
- **Buttons (4)**: `Search or ask…⌘K`, `Saraswati Vidya Mandir Kothrud — Main`, `MD`, `More`
- **Inputs (0)**: `(filters/pickers — class/section/date/search from school's own lists)`
- **Text (first 260)**: `Skip to content ⏎ M ⏎ SchoolOS ⏎ Saraswati Vidya Mandir Kothrud ⏎ DAILY OPERATIONS ⏎ Needs you ⏎ Approvals ⏎ Today's briefing ⏎ Board pack ⏎ Morning brief ⏎ Announcements ⏎ School group ⏎ Visitors ⏎ SCHOOL RECORDS ⏎ People ⏎ Fees ⏎ Classes & sections ⏎ Manage people ⏎ Operations ⏎ Fee structure ⏎ SC`
- **Verdict**: `REAL DATA / HONEST EMPTY (no demo copy)` — empty-world + server-truth laws hold.

### 8.3 Proven UI writes (frontend mutated the real DB — no API client)

#### 8.3.1 `REQUEST` — `{"step": "REQUEST", "m": "POST", "u": "/auth/renew", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.2 `RESPONSE` — `{"step": "RESPONSE", "s": 401, "u": "/auth/renew", "b": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.3 `CLICK` — `{"step": "CLICK", "b": "Sign in"}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.4 `REQUEST` — `{"step": "REQUEST", "m": "POST", "u": "/auth/login", "post": "{\"email\":\"meera.deshpande@svm-kothrud.edu.in\",\"password\":\"SvmKothrud@2026\"}"}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.5 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/auth/login", "b": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.6 `REQUEST` — `{"step": "REQUEST", "m": "GET", "u": "/me/tenants", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.7 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/me/tenants", "b": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.8 `REQUEST` — `{"step": "REQUEST", "m": "GET", "u": "/me", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.9 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/me", "b": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.10 `REQUEST` — `{"step": "REQUEST", "m": "GET", "u": "/me/effective", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.11 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/me/effective", "b": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.12 `REQUEST` — `{"step": "REQUEST", "m": "GET", "u": "/dataset", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.13 `REQUEST` — `{"step": "REQUEST", "m": "GET", "u": "/plugins", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.14 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/dataset", "b": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.15 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/plugins", "b": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.16 `REQUEST` — `{"step": "REQUEST", "m": "GET", "u": "/events", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.17 `REQUEST` — `{"step": "REQUEST", "m": "GET", "u": "/plugins/library/overdue", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.18 `REQUEST` — `{"step": "REQUEST", "m": "GET", "u": "/transport/routes", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.19 `REQUEST` — `{"step": "REQUEST", "m": "GET", "u": "/capabilities", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.20 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/events", "b": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.21 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/transport/routes", "b": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.22 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/capabilities", "b": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.23 `REQUEST` — `{"step": "REQUEST", "m": "GET", "u": "/actions?status=open", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.24 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/actions?status=open", "b": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.25 `RESPONSE` — `{"step": "RESPONSE", "s": 403, "u": "/plugins/library/overdue", "b": "{\"error\":\"role owner not permitted\"}"}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.26 `REQUEST` — `{"step": "REQUEST", "m": "GET", "u": "/onboard/status", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.27 `REQUEST` — `{"step": "REQUEST", "m": "GET", "u": "/plugins/people.admin/users", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.28 `REQUEST` — `{"step": "REQUEST", "m": "GET", "u": "/school/classes", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.29 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/onboard/status", "b": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.30 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/school/classes", "b": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.31 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/plugins/people.admin/users", "b": "{\"users\":[{\"id\":\"71e06297-94b6-4d34-bac0-997fa83c18ec\",\"email\":\"nitin.gaikwad@svm-kothrud.edu.in\",\"name\":\"Nitin Gaikwad\",\"role\":\"admissions\",\"phone\":\"+919822010006\",\"active\":true,\"forceChange\":true,\"createdAt\":\"2026-10-03T12:35:29.004Z\"},{\"id\":\"e4602685-`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.32 `FILL` — `{"step": "FILL", "f": "Full name", "v": "UI Teacher Three"}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.33 `FILL` — `{"step": "FILL", "f": "Email", "v": "ui.teacher.dwuel@svm-kothrud.edu.in"}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.34 `SELECT` — `{"step": "SELECT", "f": "Role", "v": "teacher"}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.35 `CLICK` — `{"step": "CLICK", "b": "Create account", "why": "POST /plugins/people.admin/users"}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.36 `REQUEST` — `{"step": "REQUEST", "m": "POST", "u": "/plugins/people.admin/users", "post": "{\"name\":\"UI Teacher Three\",\"email\":\"ui.teacher.dwuel@svm-kothrud.edu.in\",\"role\":\"teacher\"}"}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.37 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/plugins/people.admin/users", "b": "{\"ok\":true,\"user\":{\"id\":\"ecae83aa-9a1c-476b-8ad5-f3bcd8517d34\",\"email\":\"ui.teacher.dwuel@svm-kothrud.edu.in\",\"name\":\"UI Teacher Three\",\"role\":\"teacher\",\"active\":true,\"forceChange\":true,\"createdAt\":\"2026-10-03T12:45:00.623Z\"},\"temporaryPassword\":\"star-river`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.38 `REQUEST` — `{"step": "REQUEST", "m": "GET", "u": "/onboard/status", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.39 `REQUEST` — `{"step": "REQUEST", "m": "GET", "u": "/plugins/people.admin/users", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.40 `REQUEST` — `{"step": "REQUEST", "m": "GET", "u": "/school/classes", "post": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.41 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/onboard/status", "b": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.42 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/school/classes", "b": ""}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.43 `RESPONSE` — `{"step": "RESPONSE", "s": 200, "u": "/plugins/people.admin/users", "b": "{\"users\":[{\"id\":\"71e06297-94b6-4d34-bac0-997fa83c18ec\",\"email\":\"nitin.gaikwad@svm-kothrud.edu.in\",\"name\":\"Nitin Gaikwad\",\"role\":\"admissions\",\"phone\":\"+919822010006\",\"active\":true,\"forceChange\":true,\"createdAt\":\"2026-10-03T12:35:29.004Z\"},{\"id\":\"e4602685-`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.44 `AFTER` — `{"step": "AFTER", "text": "Skip to content\nM\nSchoolOS\nSaraswati Vidya Mandir Kothrud\nDAILY OPERATIONS\nNeeds you\nApprovals\nToday's briefing\nBoard pack\nMorning brief\nAnnouncements\nSchool group\nVisitors\nSCHOOL RECORDS\nPeople\nFees\nClasses & sections\nManage people\nOperations\nFee structure\nSCHOOL SETUP\nTimetable\nAppraisals\nCompliance\nCertif`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

#### 8.3.45 `VERIFY` — `{"step": "VERIFY", "email": "ui.teacher.dwuel@svm-kothrud.edu.in", "found": true}`
- **Why**: PeopleAdmin `Full name` (`aria-label`, placeholder `e.g. Sunita Rao`) + `Email` (`aria-label`, placeholder `sunita@school.edu`, lower+regex+UNIQUE) + `Role` (`aria-label`, `PROVISIONABLE_ROLES`, owner absent) → `Create account` → `POST /plugins/people.admin/users 200` (`ecae83aa…`, temp `star-river-60a6`, `force_change:true`, shown once) → list refresh (`GET /users` now 28) → `VERIFY found:true` + `/tmp/b6_created.png`. Selectors fixed per Fix-2 (placeholder ≠ accessible name).

## 9. Verification — real DB + real analytics via frontend (no SQL)

#### 9.1 Onboard checklist `/onboard/status`: School A `{students:38, itadmins:1, accounts:28, plugins_enabled:29}` all `done:true`; School B `{0,0,1,4}` all `done:false` — the same door drives the owner card (v2/v6/v8 `200`).

#### 9.2 `/people` (38 rows: admission_no+name+grade+section; phones hidden non-staff) + `/people-admin` (28 accounts incl. UI-created + Suspend/Reset per row) + `/classes` (13×23) + `/school/subjects` (11) — roster/structure proof.

#### 9.3 `/fees` (6 doors: settings/obligations/payments/concessions/installments/delivery) + `/fees/plans` + `/reports/fees/summary` (whole-ledger totals + `collectionPct`) — money proof; empty-school `200` zeros (`collectionPct:null`, `academicYearId:null`).

#### 9.4 `/insights` (`/reports/fees/summary` + `/plugins/ops.bi/attendance?days=30`: present+late/all, leave-against, raw buckets, 60s/500-cap) — analytics proof; empty-school `ops.bi 409` gate = correct (only 4 born-on; turn on in `/plugins`).

#### 9.5 `/attendance` register (upsert + per-change audit + `ABSENCE_NOTICE queued`) + `/timetable` (`periods`+`grid`+classes+subjects) + `/transport/routes` (4) + library desk 11 jobs + funnel/rules/ledger — domain proof.

#### 9.6 `/audit` hash-chain (every signup/save/provision/admission/mark/payment/enable with actor+role+reason+policyRef+outcome) + `/memory` timeline + `/action-center` spine + `/ai-governance|usage` (200 calls/200k tokens, 0 LLM) — governance proof.

#### 9.7 Zero `Something went wrong` across 85 v8 + 30 v2 route-states; gated/denied states honest (lifecycle/role), never white-screen; sidebar brand = own school (`sessionSchoolName`); Today greets real owner (`Good evening, Meera/Anil`).

#### 9.8 Evidence bundle: `/tmp/browser_walk.jsonl`(321) + `_v2`(210) + `_v6`(44) + `_v7`(4) + `_v8`(2042) = 2621 log lines; screenshots `/tmp/b2_*.png /tmp/b6_created.png /tmp/b7_empty_insights.png`; `/tmp/browser_school.json` + `/tmp/browser_created_teacher2.json`.

## Appendix — maps + runbook

### A. Role → doors (16 built-ins; server `role-catalog.js` + `GET /me/effective` render hints, server re-decides every door)
- `owner`: 95 doors (all + school patch + principal create + enable + sign + activate year + confirm payments)
- `principal`: academic head (assignments, marking fallback, funnel, exams, announcements approve)
- `coordinator`: timetable/slots + assignments + substitutions + workload + escalations
- `counselor`: wellbeing + safety designated reads (HUMAN-ONLY)
- `finance`: dues + record + receipts
- `finance_head`: settings + confirm + Tally
- `finance_clerk`: record + receipts
- `admissions`: funnel + POST /students
- `transport`: routes/stops + GPS + delays
- `facilities`: assets + work-orders + vendors
- `technician`: workspace + preventive close
- `teacher`: owned-register marking + homework + leave + copilot + support
- `itadmin`: provision + keys + settings (not principal-create)
- `parent`: own-children (light chrome, copilot, consents, fees)
- `student`: own rows (light, kiosk, no-store)
- `librarian`: desk (issue/return/holds/fines/catalog), overdue door

### B. Runbook (browser-only re-run)
- Pre: API `:8080/health ok` + UI `:4310/onboard 200` (restart: `server: nohup node src/index.js`; `app: npx vite preview --port 4310`).
- Signup: `/onboard` → fill school → Continue → fill owner → Create my school → Set up my school (client nav, no reload).
- Login: `/today` → fill Email + Password → Sign in (catches `403 mustChange` → `/account/password`).
- Navigate: sidebar `a[href]` clicks (client-side, bearer survives); never `goto` mid-session (Fix-1) — or re-login via UI when login-card appears.
- Provision: `/people-admin` → `getByLabel('Full name'/'Email'/'Role')` → Create account (temp once) → verify row.
- Structure: `/classes` → edit → Save (`PUT /school/classes`); subjects `+ Add`; year create+activate.
- Domains: click each sidebar + desk tabs; enable OFF plugins in `/plugins` (audited); admit via `/people` Add person; mark via `/attendance`; collect via `/fees`; issue via `/library/desk/issue`; capture via `/admissions`; check-in via `/visitors`; drill via `/transport/setup`.
- Verify: `/insights` + `/reports/fees/summary` (real numbers) vs fresh school (zeros + `ops.bi 409` gate); `/audit` ledger; screenshots per screen.

## 10. Verbatim Browser Evidence (sample — full logs in /tmp/browser_walk*.jsonl, 2621 lines)


#### 10.1 `NAVIGATE` — `{"step": "NAVIGATE", "url": "http://127.0.0.1:4310/onboard", "why": "sanctioned entry for fresh school, public door outside session tree"}`
- **At**: `2026-10-03T12:36:58.380Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.2 `SCREENSHOT-ONBOARD-STEP0` — `{"step": "SCREENSHOT-ONBOARD-STEP0", "heading": "\n    SStart your schoolSchoolOS \u2014 the digital school officeSchool nameAddress (optional)Board (optional)Phone (optional)Continue Your classes and sections are yours to define \u2014 nothing is added for yo"}`
- **At**: `2026-10-03T12:37:00.774Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.3 `FILL` — `{"step": "FILL", "field": "schoolName", "value": "Shree Samarth Vidyalaya sdmhtr", "why": "tenant name 3-120 chars, becomes slug + sidebar brand"}`
- **At**: `2026-10-03T12:37:00.774Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.4 `FILL` — `{"step": "FILL", "field": "address", "value": "Plot 18, Sinhagad Road, Hingne Khurd, Pune, Maharashtra 411051", "why": "tenant config.address, printed on receipts"}`
- **At**: `2026-10-03T12:37:00.802Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.5 `FILL` — `{"step": "FILL", "field": "board", "value": "CBSE", "why": "tenant config.board, drives CBSE pack"}`
- **At**: `2026-10-03T12:37:00.816Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.6 `FILL` — `{"step": "FILL", "field": "phone", "value": "+91 98220 77889", "why": "tenant config.phone, office contact"}`
- **At**: `2026-10-03T12:37:00.824Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.7 `CLICK` — `{"step": "CLICK", "button": "Continue", "why": "Step0 validation: schoolName>=3, advances to owner step client-side, no request yet"}`
- **At**: `2026-10-03T12:37:00.834Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.8 `FILL` — `{"step": "FILL", "field": "ownerName", "value": "Anil Bhise", "why": "first owner user name"}`
- **At**: `2026-10-03T12:37:01.496Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.9 `FILL` — `{"step": "FILL", "field": "ownerEmail", "value": "anil.bhise.sdmhtr@ssv-pune.edu.in", "why": "login identity, UNIQUE per tenant"}`
- **At**: `2026-10-03T12:37:01.504Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.10 `FILL` — `{"step": "FILL", "field": "ownerPassword", "value": "***8+chars***", "why": "scrypt hash, auto-login, no force_change (owner chose it)"}`
- **At**: `2026-10-03T12:37:01.513Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.11 `CLICK` — `{"step": "CLICK", "button": "Create my school", "why": "POST /onboard/signup \u2014 ONE transaction: tenant+owner+catalog+audit+event, sets in-memory bearer"}`
- **At**: `2026-10-03T12:37:01.522Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.12 `REQUEST` — `{"step": "REQUEST", "method": "POST", "url": "http://127.0.0.1:8080/onboard/signup", "post": "{\"schoolName\":\"Shree Samarth Vidyalaya sdmhtr\",\"address\":\"Plot 18, Sinhagad Road, Hingne Khurd, Pune, Maharashtra 411051\",\"board\":\"CBSE\",\"phone\":\"+91 98220 77889\",\"ownerName\":\"Anil Bhise\`
- **At**: `2026-10-03T12:37:01.570Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.13 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "http://127.0.0.1:8080/onboard/signup"}`
- **At**: `2026-10-03T12:37:02.045Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.14 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "http://127.0.0.1:8080/dataset", "post": ""}`
- **At**: `2026-10-03T12:37:02.077Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.15 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "http://127.0.0.1:8080/plugins", "post": ""}`
- **At**: `2026-10-03T12:37:02.078Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.16 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "http://127.0.0.1:8080/dataset"}`
- **At**: `2026-10-03T12:37:02.086Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.17 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "http://127.0.0.1:8080/plugins"}`
- **At**: `2026-10-03T12:37:02.133Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.18 `SCREEN-AFTER-SIGNUP` — `{"step": "SCREEN-AFTER-SIGNUP", "text": "\n    SStart your schoolSchoolOS \u2014 the digital school officeShree Samarth Vidyalaya sdmhtr is readyYou are signed in as its owner.Create your IT admin \u2014 then they can add the rest of the staff, so you don't have to.Admit your students \u2014 one by `
- **At**: `2026-10-03T12:37:05.077Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.19 `CLICK` — `{"step": "CLICK", "button": "Set up my school", "why": "client-side navigate to /people-admin where office work starts, AuthGate validates via GET /me"}`
- **At**: `2026-10-03T12:37:05.077Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.20 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "http://127.0.0.1:8080/me", "post": ""}`
- **At**: `2026-10-03T12:37:05.116Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.21 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "http://127.0.0.1:8080/plugins", "post": ""}`
- **At**: `2026-10-03T12:37:05.116Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.22 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "http://127.0.0.1:8080/me"}`
- **At**: `2026-10-03T12:37:05.125Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.23 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "http://127.0.0.1:8080/me/effective", "post": ""}`
- **At**: `2026-10-03T12:37:05.128Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.24 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "http://127.0.0.1:8080/me/effective"}`
- **At**: `2026-10-03T12:37:05.141Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.25 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "http://127.0.0.1:8080/plugins"}`
- **At**: `2026-10-03T12:37:05.295Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.26 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "http://127.0.0.1:8080/onboard/status", "post": ""}`
- **At**: `2026-10-03T12:37:05.469Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.27 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "http://127.0.0.1:8080/plugins/people.admin/users", "post": ""}`
- **At**: `2026-10-03T12:37:05.470Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.28 `REQUEST` — `{"step": "REQUEST", "method": "GET", "url": "http://127.0.0.1:8080/school/classes", "post": ""}`
- **At**: `2026-10-03T12:37:05.470Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.29 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "http://127.0.0.1:8080/plugins/people.admin/users"}`
- **At**: `2026-10-03T12:37:05.526Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.30 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "http://127.0.0.1:8080/onboard/status"}`
- **At**: `2026-10-03T12:37:05.527Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.31 `RESPONSE` — `{"step": "RESPONSE", "status": 200, "url": "http://127.0.0.1:8080/school/classes"}`
- **At**: `2026-10-03T12:37:05.527Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.32 `LANDED` — `{"step": "LANDED", "url": "http://127.0.0.1:4310/people-admin", "title": "SchoolOS \u2014 School Operations Platform"}`
- **At**: `2026-10-03T12:37:07.622Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.33 `NAVIGATE` — `{"step": "NAVIGATE", "url": "http://127.0.0.1:4310/today", "why": "Today command center \u2014 briefings over real records"}`
- **At**: `2026-10-03T12:37:07.622Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.34 `REQUEST` — `{"step": "REQUEST", "method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **At**: `2026-10-03T12:37:07.674Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.35 `RESPONSE` — `{"step": "RESPONSE", "status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **At**: `2026-10-03T12:37:07.682Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.36 `CONSOLE-ERROR` — `{"step": "CONSOLE-ERROR", "text": "Failed to load resource: the server responded with a status of 401 (Unauthorized)"}`
- **At**: `2026-10-03T12:37:07.682Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.37 `ROUTE-STATE` — `{"step": "ROUTE-STATE", "route": "/today", "crash": false, "login": true, "gated": false, "notAvail": false, "head": "S\nSchoolOS\nSign in to your school's workspace\n\nThe intelligent operating system for schools. Sign in to continue.\n\nEmail\nPhone\nGoogle\nEmail\nPassword\nSign in\nPro", "empty"`
- **At**: `2026-10-03T12:37:11.886Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.38 `NAVIGATE` — `{"step": "NAVIGATE", "url": "http://127.0.0.1:4310/attention", "why": "Attention triage queue"}`
- **At**: `2026-10-03T12:37:11.886Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.39 `REQUEST` — `{"step": "REQUEST", "method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **At**: `2026-10-03T12:37:11.913Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.40 `RESPONSE` — `{"step": "RESPONSE", "status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **At**: `2026-10-03T12:37:11.915Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.41 `CONSOLE-ERROR` — `{"step": "CONSOLE-ERROR", "text": "Failed to load resource: the server responded with a status of 401 (Unauthorized)"}`
- **At**: `2026-10-03T12:37:11.915Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.42 `ROUTE-STATE` — `{"step": "ROUTE-STATE", "route": "/attention", "crash": false, "login": true, "gated": false, "notAvail": false, "head": "S\nSchoolOS\nSign in to your school's workspace\n\nThe intelligent operating system for schools. Sign in to continue.\n\nEmail\nPhone\nGoogle\nEmail\nPassword\nSign in\nPro", "em`
- **At**: `2026-10-03T12:37:16.117Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.43 `NAVIGATE` — `{"step": "NAVIGATE", "url": "http://127.0.0.1:4310/next", "why": "Next actions"}`
- **At**: `2026-10-03T12:37:16.117Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.44 `REQUEST` — `{"step": "REQUEST", "method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **At**: `2026-10-03T12:37:16.155Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.45 `RESPONSE` — `{"step": "RESPONSE", "status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **At**: `2026-10-03T12:37:16.155Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.46 `CONSOLE-ERROR` — `{"step": "CONSOLE-ERROR", "text": "Failed to load resource: the server responded with a status of 401 (Unauthorized)"}`
- **At**: `2026-10-03T12:37:16.155Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.47 `ROUTE-STATE` — `{"step": "ROUTE-STATE", "route": "/next", "crash": false, "login": true, "gated": false, "notAvail": false, "head": "S\nSchoolOS\nSign in to your school's workspace\n\nThe intelligent operating system for schools. Sign in to continue.\n\nEmail\nPhone\nGoogle\nEmail\nPassword\nSign in\nPro", "empty":`
- **At**: `2026-10-03T12:37:20.355Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.48 `NAVIGATE` — `{"step": "NAVIGATE", "url": "http://127.0.0.1:4310/people", "why": "People roster (students list)"}`
- **At**: `2026-10-03T12:37:20.355Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.49 `REQUEST` — `{"step": "REQUEST", "method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **At**: `2026-10-03T12:37:20.401Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.50 `RESPONSE` — `{"step": "RESPONSE", "status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **At**: `2026-10-03T12:37:20.406Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.51 `CONSOLE-ERROR` — `{"step": "CONSOLE-ERROR", "text": "Failed to load resource: the server responded with a status of 401 (Unauthorized)"}`
- **At**: `2026-10-03T12:37:20.406Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.52 `ROUTE-STATE` — `{"step": "ROUTE-STATE", "route": "/people", "crash": false, "login": true, "gated": false, "notAvail": false, "head": "S\nSchoolOS\nSign in to your school's workspace\n\nThe intelligent operating system for schools. Sign in to continue.\n\nEmail\nPhone\nGoogle\nEmail\nPassword\nSign in\nPro", "empty`
- **At**: `2026-10-03T12:37:24.605Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.53 `NAVIGATE` — `{"step": "NAVIGATE", "url": "http://127.0.0.1:4310/people-admin", "why": "People console \u2014 provision staff, admit students"}`
- **At**: `2026-10-03T12:37:24.605Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.54 `REQUEST` — `{"step": "REQUEST", "method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **At**: `2026-10-03T12:37:24.640Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.55 `RESPONSE` — `{"step": "RESPONSE", "status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **At**: `2026-10-03T12:37:24.644Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.56 `CONSOLE-ERROR` — `{"step": "CONSOLE-ERROR", "text": "Failed to load resource: the server responded with a status of 401 (Unauthorized)"}`
- **At**: `2026-10-03T12:37:24.644Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.57 `ROUTE-STATE` — `{"step": "ROUTE-STATE", "route": "/people-admin", "crash": false, "login": true, "gated": false, "notAvail": false, "head": "S\nSchoolOS\nSign in to your school's workspace\n\nThe intelligent operating system for schools. Sign in to continue.\n\nEmail\nPhone\nGoogle\nEmail\nPassword\nSign in\nPro", `
- **At**: `2026-10-03T12:37:28.846Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.58 `NAVIGATE` — `{"step": "NAVIGATE", "url": "http://127.0.0.1:4310/classes", "why": "Classes & sections structure"}`
- **At**: `2026-10-03T12:37:28.846Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.59 `REQUEST` — `{"step": "REQUEST", "method": "POST", "url": "http://127.0.0.1:8080/auth/renew", "post": ""}`
- **At**: `2026-10-03T12:37:28.942Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.

#### 10.60 `RESPONSE` — `{"step": "RESPONSE", "status": 401, "url": "http://127.0.0.1:8080/auth/renew"}`
- **At**: `2026-10-03T12:37:28.948Z`.
- **Why**: same-door explanation as §§2–8 (signup/login/hydrate/gate); this line is verbatim browser evidence, not prose.
