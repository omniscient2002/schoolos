FROM: redteam
TO: orchestrator
STATUS: action-requested
DATE: 2026-09-06
CYCLE: 1 — auth lifecycle + server surface (server-only login, /me boot gate, /dataset, plugin registry)
METHOD: live black-box probing against http://127.0.0.1:8080 (API) and http://127.0.0.1:4310 (UI), read-only source review (server/src, app/src). Every finding below has a repro that was actually executed. Evidence script + screenshots: `handoff/redteam-ui-audit.mjs`, `handoff/redteam-shots/`.

---

## P0 — release-blocking

### P0-1 · OTP dev-echo is ON by default → complete account takeover with two curls
**Files:** `server/src/config.js:25` (`devEcho: process.env.SMS_PROVIDER ? false : true` — keyed to SMS provider, NOT to environment), `server/src/app.js:85-87` (`if (config.otp.devEcho) body.devCode = code`), displayed in UI at `app/src/screens/Login.tsx:57-59,126`.
**Impact:** Any caller who knows a staff phone gets a full JWT for that account. The valid phone numbers are printed on the login screen itself (`Login.tsx:163-171`), so no enumeration is even needed. Because devEcho defaults **on** whenever `SMS_PROVIDER` is unset, any non-prod deployment — and any production launch that forgets the env var, since the guard is not `NODE_ENV`-based — is an open takeover for all 12 seeded roles (principal, owner, finance, …).
**Repro (run, verbatim):**
```
curl -s -X POST http://127.0.0.1:8080/auth/otp/request -H 'Content-Type: application/json' -d '{"phone":"+919845000101"}'
→ 200 {"sent":true,"expiresInSeconds":300,"devEcho":true,"devCode":"220075"}
curl -s -X POST http://127.0.0.1:8080/auth/otp/verify -H 'Content-Type: application/json' -d '{"phone":"+919845000101","code":"220075"}'
→ 200 {"token":"eyJhbGciOiJIUzI1NiIs…","user":{"id":"0d92ec92-…","role":"principal",…}}
```
Principal JWT obtained with zero secrets. (Rate limit 5/min on request is verified working — see clean list — but 5/min is ample for takeover.)
**Fix:** `devEcho: process.env.SMS_PROVIDER ? false : (config.env !== 'production' && process.env.OTP_DEV_ECHO === '1')` — default OFF, opt-in per env, hard-off in production regardless. Keep the code-in-response path behind the same flag. Add a startup test asserting `POST /auth/otp/request` never contains `devCode` when `NODE_ENV=production`.

### P0-2 · GET /dataset is unauthenticated — 3.79 MB full school domain dump, incl. guardian/student PII
**Files:** `server/src/app.js:173-176` — the route has **no** `preHandler: app.authenticate` (contrast `/auth/logout` at `app.js:162` which has it, and every domain route in `server/src/routes.js` which gates via `me`/`require`). Payload assembled in `server/src/dataset.js:51-61`.
**Impact:** Anonymous full read of the demo domain: 737 guardians `{name, email, phone, role}`; 536 students `{name, email, phone, dob, admissionNo, busRoute}`; 68 admissions leads with phones; 7 call transcripts with caller numbers (`calls[0].callerNumber = "+91 98204 4xx71"`); 949 fee payments; 16,080 attendance rows; 144 documents; audit entries. Guest exposure is one click away in the UI too: `/demo` renders outside `AuthGate` (`App.tsx:245`, `AuthGate` wraps only `Frame`, `App.tsx:333-335`) and calls the same endpoint. The data is currently synthetic, but this route is the app's domain-data firehose — the shape it serves is real-PII-shaped (verified sample rows below), and nothing stops real data landing behind the same ungated route.
**Repro (run, verbatim):**
```
curl -s -o /tmp/ds.json -w "%{http_code} bytes=%{size_download}\n" http://127.0.0.1:8080/dataset
→ 200 bytes=3791666        # no Authorization header
# guardians[0]: {"id":"gd_1","name":"Tara Kaur","email":"gd.1@gmail.com","phone":"+91 9825243891","role":"Mother",…}
# students[0]: {"name":"Prisha Kaur","email":"st.north_1@student.meridian.edu","phone":"+91 98337244326","dob":"2021-02-14","admissionNo":"MIA-2019-002","busRoute":"Route 7 — Sector 12",…}
# UI: logged-out browser → http://127.0.0.1:4310/demo renders the data room
```
**Fix:** Add `{ preHandler: app.authenticate }` to the `/dataset` route (one line, matches the boot-gate contract: `app/src/App.tsx:171-194` already only trusts live `/me`). If the demo room must stay guest-visible, gate it behind an explicit `DEMO_PUBLIC=1` env flag AND strip guardian/student contact fields (name/email/phone/dob) from the anonymous payload — serve the full object only to authenticated sessions. Add a regression test: `GET /dataset` with no token → 401.

---

## P1 — fix now

### P1-1 · `/auth/google/demo` mints a real session for any known email — no password, no Google
**Files:** `server/src/app.js:152-159` (gate is `googleConfigured() || config.env === 'production'` → enabled whenever Google OAuth is unconfigured and NODE_ENV ≠ production, which is the current live state), client caller `app/src/services/liveApi.ts:59-60`, `app/src/screens/Login.tsx:69-74`.
**Impact:** Passwordless login as any user whose email is known — and all 12 demo emails are listed on the login screen (`Login.tsx:13-26`). Bypasses the password entirely; same end state as P0-1. Also a regression hazard: the only production guard is the `NODE_ENV` string.
**Repro (run, verbatim):**
```
curl -s -X POST http://127.0.0.1:8080/auth/google/demo -H 'Content-Type: application/json' -d '{"email":"principal@meridian.edu"}'
→ 200 {"token":"eyJhbGciOiJIUzI1NiIs…","user":{"role":"principal","name":"Dr. Meera Krishnan",…}}
```
**Fix:** Behind an explicit env flag defaulting off (`AUTH_DEV_SSO=1`) and additionally require `NODE_ENV !== 'production'` (belt-and-braces), or delete the endpoint and drive the demo SSO UX from a test fixture. Same note as P0-1: default-off beats default-on.

### P1-2 · Successful form login lands on the 404 page — URL stays on `/login`, no redirect target
**Files:** `app/src/App.tsx:203` (`onAuthed` stores the session but nothing navigates), route table `app/src/App.tsx:215-278` contains **no** `/login` route, so the post-login view is the `*` NotFound screen (`App.tsx:79`, `app/src/screens/NotFound.tsx`).
**Impact:** Every password login ends on "This page moved or never existed"; the user must click "Go to Today" manually. Verified in headless Chrome and consistent with the route table. Looks broken to any first-time user — bad for the demo this product exists for.
**Repro (click path, executed via Playwright `handoff/redteam-ui-audit.mjs`):** open `http://127.0.0.1:4310/login` → fill email `principal@meridian.edu` + password `schoolos-demo` → click "Sign in" → URL remains `/login`, main heading reads "This page moved or never existed" (screenshot `handoff/redteam-shots/after-login.png`).
**Fix:** Either add a `/login` route rendering `Login` (so the URL is honest and post-login navigation can `navigate('/today')` inside `onAuthed`), or redirect to `/today` on auth. One-line UX fix; keep `AuthGate` as the actual gate.

---

## P2 — polish / hardening notes

### P2-1 · JWT default-secret fallback exists in code (not exploitable on this box — verified)
`server/src/config.js:15` falls back to `'dev-only-secret-change-me'`; the production boot guard at `config.js:37-38` only checks `NODE_ENV === 'production'`. I forged an HS256 token signed with that default (`sub` of the principal) → `/me` returned **401**, so the running server uses the real `JWT_SECRET` from `server/.env` (key presence confirmed; values not read). Risk: any staging/preview deployment reachable off-host that doesn't set the var gets instant token forgery. **Fix:** remove the fallback — `req('JWT_SECRET')` with no default — and keep a weak-value blocklist in tests.

### P2-2 · No per-account throttle on password guessing; logout is client-side only
`app.js:48` rate-limits `/auth/login` at 20/min **per IP** (header verified: `x-ratelimit-limit: 20`). Three wrong passwords → clean 401s and no lockout; valid login still worked immediately after (no accidental DoS). But there is no per-account counter, so distributed guessing is unthrottled, and 20/min/IP ≈ 28.8k guesses/day/IP. Logout: `app/src/services/liveApi.ts:50` (`apiLogout = () => setToken(null)`) + audit-only server route `app.js:162-166` whose own outcome string admits "session ended client-side · token expires naturally". Token TTL is 12h (`config.js:16`), so a "signed out" token keeps working for up to 12h. **Fix:** per-account failure counter with backoff; consider a `jti` denylist (or short TTL + refresh) for real revocation.

### P2-3 · Persistent token in localStorage survives tab close and browser relaunch — shared-machine risk
Verified via Playwright: after login, `localStorage` holds `schoolos_token` (JWT) + `schoolos.session`; closing the tab and opening a new one → still authenticated (`AFTER_TAB_CLOSE_REOPEN {"url":"/today","token":true}`); a simulated relaunch via storageState auto-logs-in with no prompt (`AFTER_SIMULATED_RELAUNCH {"token":true,"bodyHasLogin":false}`). Plus `access-control-allow-origin: *` with `access-control-allow-credentials: true` on every response (`app.js:18`, `config.js:18` — invalid CORS combo per spec; harmless while auth is header-borne, dangerous if cookies are ever introduced). localStorage is also XSS-readable. **Fix:** acceptable for staff SaaS with the boot-gate revalidation in place, but for shared school machines: honor a short TTL in `AuthGate` (re-check /me more often than 12h), consider `sessionStorage` for non-"remember me" logins, and set `credentials: false` until cookies are real. (Positive: `AuthGate` at `App.tsx:171-194` never trusts the stored session — it revalidates against live `/me` and clears on failure.)

### P2-4 · OTP phone enumeration + minor cosmetics
`app.js:75` returns a distinct `404 {"error":"no account for this phone number"}` vs `200` for valid phones — reveals which numbers are accounts (mitigated: rate-limited 5/min verified `429` on 6th request; and the seeded numbers are printed on the login screen anyway). Return a uniform `202 {"sent":true}` and only store/verify for real accounts. Cosmetic: the 768px `/today` "overlaps" my detector flagged are two stacked decorative SVG icons (identical origin `[33,249]` / `[540,249]`, empty text) — not a content bug.

---

## Attacked and clean (verified, no finding)
- **(a) Valid login:** 200; token is HS256 JWT, 12h `exp`, claims `sub/role/tenant/name` — role+tenant are re-derived server-side from DB on every request (`app.js:30-39`), so claim tampering doesn't grant anything.
- **(b) Wrong password ×3:** clean `401 {"error":"invalid credentials"}` each time; no user enumeration in the message; valid login still accepted after (no unintended lockout).
- **(c) Malformed input:** broken JSON → `400` generic message; `{}` → `400 "email and password required"`; wrong content-type → `415`; SQL-ish payloads (`' OR '1'='1' --`, `UNION SELECT`) → `401` (queries are parameterized, `app.js:51`).
- **(d) /me:** no token / garbage token / expired-format token / `alg:none` token → uniform `401 {"error":"unauthorized"}` every time; no stack traces. Global error handler maps 5xx → `"internal error"` without leaking (`app.js:179-183`).
- **(e) OTP limits:** request 5/min → `429` on 6th; verify 10/min; per-code attempt cap 5 (`config.js:22`, `app.js:100`); codes scrypt-hashed with per-code salt (`app.js:77-79`), `timingSafeEqual` compare (`app.js:102`).
- **Forged default-secret token:** rejected 401 (see P2-1).
- **Plugin registry:** `/plugins`, `/plugins/:id/enable|disable|settings` all behind `me`/`require('owner','itadmin')` (`server/src/routes.js:497,506,522,541`) — not exposed.
- **UI layout (Playwright, 390px & 768px, /today + /ask):** horizontal overflow **0px** everywhere; zero clipped `.stat .value`; zero squished text nodes (<58px with >14 chars); zero JS console errors. Clean responsive behavior.

---

## Verdict
**FIX-FIRST** — P0-1 (OTP dev-echo takeover) and P0-2 (public /dataset) are one-line-class fixes that must land before any demo outside localhost; P1-1 (dev SSO) and P1-2 (login→404) should follow in the same pass.
