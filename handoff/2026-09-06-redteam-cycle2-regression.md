FROM: redteam
TO: orchestrator
STATUS: action-requested
DATE: 2026-09-06
CYCLE: 2 — regression-attack of the cycle-1 remediation (handoff/2026-09-06-orchestrator-redteam-p0fixes.md) + auth lifecycle re-sweep
METHOD: live black-box probes (curl + Playwright headless Chrome) against 127.0.0.1:8080 / :4310; read-only source review. Every finding has an executed repro. Note: the UI app instance changed between cycles (code refs re-verified against current files).

## Headline
**All cycle-1 P0/P1 fixes verified live and correct.** No new P0 found. One new P1 (silent permanent login lockout after a single transient hydrate failure), plus P2 polish. Code-level verification (not live-provable) noted where env can't be changed on the running box.

---

## Remediation regression results — all PASS
| Cycle-1 finding | Fix claim | Live result |
|---|---|---|
| P0-1 OTP dev-echo takeover | opt-in `OTP_DEV_ECHO=1`, default OFF, prod hard-off | PASS — `config.js:26` `devEcho: process.env.SMS_PROVIDER ? false : (NODE_ENV !== 'production' && OTP_DEV_ECHO === '1')`; response shape uniform `{sent,expiresInSeconds,devEcho}` for registered (+919845000101 → 200, devCode present because this demo box opts in) and unregistered (+919999999999 → 200, no devCode, no existence signal) |
| P0-2 /dataset public | `preHandler: app.authenticate` | PASS — anon `GET /dataset` → `401 {"error":"unauthorized"}` (app.js:177) |
| P0-2 guest /demo exposure | /demo inside AuthGate | PASS — anon Playwright: /demo, /login, /today all render the login card; **0 /dataset requests fired while anonymous**; 0 console errors |
| P1-1 google demo SSO | `AUTH_DEV_SSO=1` + non-prod gate | PASS (flag present on this box → 200; code at app.js:157 gates on `AUTH_DEV_SSO === '1' && config.env !== 'production'`; flag-absent behavior verified by code read only — cannot unset env on the live server) |
| P1-2 login → 404 | /login real route, lands on dashboard | PASS — `/login` route exists (App.tsx:219); Playwright form login → URL `/today`, KPI dashboard, no NotFound |
| P2 CORS credentials:true | credentials:false | PASS — preflight `OPTIONS /dataset` returns `access-control-allow-origin: *` with **no** `access-control-allow-credentials` header |

Also re-verified still clean: `/me` uniform 401s (garbage/expired-format/alg:none — spot re-check), login rate limit now **survives XFF rotation** (21 bad logins with rotating `X-Forwarded-For` → 20×401 then `429`; trustProxy off confirmed effective), `/health` leaks nothing but `{status,db,time}`, TRACE/DELETE → clean 404s.

---

## P1 — fix now

### P1-1 · One failed dataset hydrate silently locks the user out of login until a full page reload
**Files:** `app/src/App.tsx:205` — `onAuthed={(s) => { localStorage.setItem('schoolos.session', …); void ensureDataset().then(() => setSession(s)); }}` (no `.catch`, `busy` stays true); `app/src/data/dataset.ts:47-50` — `ensureDataset` caches the in-flight promise in `loading` and never resets it on rejection; `app/src/screens/Login.tsx:41-44` — `run()` only clears `busy` when the inner promise rejects, but the hydrate runs detached inside `onAuthed`.
**Impact:** If `/dataset` fails once (server blip, proxy 5xx, laptop waking from sleep mid-login), the login button stays disabled reading "Signing in…" **forever** with no error message. Retyping credentials does nothing because `ensureDataset` keeps returning the same cached rejected promise (`dataset.ts:49`) and `hydrated` stays false. Only a full page reload (which resets module state) recovers. Silent, total, confusing lockout on a transient error — exactly the failure mode a school front-desk machine hits.
**Repro (executed, Playwright):** intercept `**/dataset` → fulfill 500 → login form with principal@meridian.edu / schoolos-demo → click Sign in → 4s later: URL `/login`, `.login-card` still present, `schoolos_token` set (server login succeeded), button still disabled "Signing in…", **no error shown**; unroute and click Sign in again → click times out (button disabled). Full reload → login succeeds normally. (Transcript: S5a/S5b in this cycle's run; contrast S5c.)
**Fix:** make the hydrate failure visible and retryable, e.g.
```ts
// App.tsx:205
onAuthed={(s) => { localStorage.setItem('schoolos.session', JSON.stringify(s));
  ensureDataset().then(() => setSession(s)).catch(() => { /* clear dataset.ts:49 cache + show error */ }); }}
```
plus in `dataset.ts`: `loading = null` in a `.catch` (reset the cache so the next attempt retries), and have `Login.run` treat hydrate failure as a fail() ("could not load school data — try again"). Alternatively await the hydrate inside `run()`'s fn so existing error handling covers it.

---

## P2 — polish

### P2-1 · Stale `schoolos.session` survives a server-side logout → wrong name/role displayed on the login screen after expiry
**Files:** `app/src/services/liveApi.ts:33-39` (401 handler removes `schoolos.session` + token, but only for API-originated 401s); `app/src/App.tsx:187-190` (boot catch does the same); `App.tsx:205` (login success writes it).
**Repro (executed):** login → `localStorage.removeItem('schoolos_token')` → soft-nav to /today (client router) → login card renders while `schoolos.session` is still `{"name":"Dr. Meera Krishnan",…}` in localStorage (S4 evidence: `{"login":true,"tok":false,"sess":true}`). The token is gone so nothing is spoofable server-side, but any code reading the stale session (or a user with devtools) sees a "logged-in" identity that isn't valid.
**Fix:** `setToken(null)`/`apiLogout` should also remove `schoolos.session`; or stop dual-writing and derive display identity solely from the live `/me`.

### P2-2 · CORS wildcard origin on an authenticated API
`server/src/config.js:18` defaults `CORS_ORIGINS='*'`; live preflight echoes `access-control-allow-origin: *`. With `credentials:false` and header-borne tokens this is not currently exploitable (a malicious page cannot read the victim's localStorage token), but any website can script anonymous calls (health, auth, OTP request) from a victim's browser/network position. **Fix:** pin `CORS_ORIGINS` to the real UI origin(s) before any non-localhost deployment.

### P2-3 · Deferred hardening accepted by orchestrator — unchanged, re-confirmed
localStorage token persists across tab close and simulated relaunch (re-verified in cycle-1 context tests; still true — `AFTER_TAB_CLOSE_REOPEN`-equivalent behavior), 12h token with no revocation (`config.js:16`, logout is client-side + audit-only), per-account password throttle still absent (20/min/IP only). Documented as accepted for the demo deployment; flagging they remain open.

---

## Not live-verifiable (stated honestly)
- **Production hard-off claims** (`OTP_DEV_ECHO`, `AUTH_DEV_SSO`, JWT default-secret boot refusal): verified by code read (`config.js:26,37-39`, `app.js:157`); the running server cannot have its env unset, so behavior-under-production was not exercised. Recommend one staging boot with `NODE_ENV=production` and a curl pass before any external demo.
- **`google/demo` with flag absent:** same constraint — code shows 403 (`!demoSso → 403`); the flag is set on this box, so live behavior is 200.

---

## Attacked and clean (cycle 2)
- OTP uniformity: identical status + shape for registered/unregistered phones (enumeration dead; only `devCode` differs, which is the documented dev-echo opt-in).
- Anon surface sweep: /demo, /login, /today anonymous → login card, **zero** /dataset fetches pre-auth, zero console/page errors (no hydrate leak on the login screen; dataset module fills only after `/me` passes).
- Mid-session token deletion → soft nav AND hard reload: graceful login card, no crash loop, no errors (S4).
- Forced-401 boot (mock /me + /students → 401): clean transition to login, stale keys cleared (S3).
- Login rate limit with rotating XFF: not bypassable (429 at attempt 21).
- Body-limit abuse on /plugins: clean `413 {"error":"Request body is too large"}` (no stack).
- /events/lineage: anon 401; garbage `correlation` safely nulls (regex `routes.js:485`); `limit=99999999` clamps to 100.
- Method abuse (TRACE/DELETE) and unknown paths: clean 404s.

---

## Verdict
**FIX-FIRST** — cycle-1 remediation is genuinely fixed (say this loudly), but P1-1 (silent login lockout on transient hydrate failure) should land before the next demo; P2s can ride along. Companion report for the plugin surface: `handoff/2026-09-06-redteam-plugins-surface.md`.
