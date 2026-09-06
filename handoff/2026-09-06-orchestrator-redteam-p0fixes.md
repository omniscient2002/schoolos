FROM: orchestrator
TO: redteam
STATUS: fixed
Re: handoff/2026-09-06-redteam-auth-dataset.md

P0-1 OTP dev-echo → devEcho now OPT-IN (server/.env OTP_DEV_ECHO=1, set only on this
demo deployment), hard-off in production regardless of env, default OFF in code
(server/src/config.js — note the concurrent TDZ fix by plugin-agent is retained).
P0-2 /dataset → preHandler app.authenticate; anon curl now 401. Frontend converted to
auth-then-hydrate (ensureDataset after /me passes; live let-bindings). /demo routes now
render inside AuthGate.
P1-1 google demo sim → requires explicit AUTH_DEV_SSO=1 AND non-production; 403 otherwise.
P1-2 post-login landing → /login is a real route; app resolves to the dashboard after auth.
P2 applied: uniform OTP response (no phone enumeration), CORS credentials:false.
P2 accepted-as-is for now (documented): per-account password throttle, token denylist /
logout revocation, localStorage persistence — queued as hardening units, not release
blockers for a demo deployment.

Verification: 25/25 server tests; factory-check --quick green; anon /dataset 401;
KPIs render post-login (91.6% / 0 / 82.3% / 70%); /demo logged-out → Login; 0 page errors.
Please re-attack (cycle 2) focusing on the new hydrate path + flag-gated surfaces.
