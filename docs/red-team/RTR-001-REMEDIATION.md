# RTR-001 Remediation Ledger — Engineering Response

Status: **CRITICALS FIXED & VERIFIED (23/23 tests)** · Highs: 5 of 8 closed · Owner: CTO orchestrator · Date: 2026-09-05

This document is the fix-side mirror of `docs/red-team/RTR-001.md`. Every critical and
every high finding is tracked here with its resolution and verification evidence.

## Criticals — all closed

| ID | Finding | Fix | Verified by |
|----|---------|-----|-------------|
| RT-001 | JWT secret in repo + hardcoded fallback; staff uuids harvestable; `authenticate()` trusts token `sub` | `config.js` fails fast when `NODE_ENV=production` without `JWT_SECRET` ≥32 chars; dev secret clearly labeled dev-only. uuid harvest broken (RT-009 fix). Claim-tampering was already inert (DB re-read) | code review + security.test.js |
| RT-002 | `/actions/:id/decide` guarded by `me` only — parent approved a principal action | Route now enforces `owner_role` match (owner/principal override for drain hand-backs); self-approval blocked via `payload.proposed_by` | security.test.js "RT-002" |
| RT-003 | Parent self-confirms payments, audit claims "gateway webhook verified" | Confirm role-gated to `finance,owner`; audit line distinguishes `gateway webhook verified` (well-formed ref) vs `manual reconciliation` | security.test.js "RT-003" |
| RT-004 | Double sequential pay → obligation at 200%, two receipts | `FOR UPDATE` at initiation; refusal of second open payment (409); DB `CHECK (paid_cents <= amount_cents)`; unique open payment per obligation | security.test.js "RT-004" + migration 006 |

## Highs

| ID | Finding | Status |
|----|---------|--------|
| RT-005 | `roleScope()` dead code — parents read whole school | **FIXED**: `/students` parent-scoped via guardian record (`guardian_name = user.name`); `/students/:id` 404s for other children; guardian_phone stripped for non-staff roles |
| RT-009 | Staff uuids leak via `/work-orders` | **FIXED**: minimized column list (no ids of people); teacher given read access to the minimized list |
| Track E | Ledger INSERT-forgeable by app role | **FIXED**: `REVOKE INSERT`; writes only through `app.audit_append()` (SECURITY DEFINER, enforces chain) |
| Track E | Hashes unrecomputable (writer hashed unstored timestamp) | **FIXED**: `auditLog()` now hashes exactly the stored columns and passes `created_at` explicitly; seed genesis re-chained; security.test.js recomputes the newest hash |
| Track F | XFF rotation defeats login rate limiter | **FIXED**: limiter keyed on socket IP unless `TRUST_PROXY=true` is explicitly set |

## Accepted risks / deferred (with rationale)

- **Alg:none & claim tampering** — already rejected (JWT library + DB re-read). No change needed.
- **No CSP** — accepted for v1 demo posture; React escaping verified by RTR-001's headless sweep. Scheduled: CSP header default in the platform kernel phase (docs/12 §21).
- **WO non-resolve transitions unaudited** — accepted; the audit ledger covers money/identity/approval paths; low-value transitions to be batched later.
- **Secret rotation mechanics** — dev secret retained for demo continuity; production boot now refuses defaults. Rotation runbook lands with docs/12 §21 deployment hardening.
- **Live PoC evidence rows** (obligation paid 200%, receipts RCP-MTOAQNA6/QNBN/S5L9/S5P1, WO-1046 negative cost) — obligation clamped to exactly ≤100% by migration 006; receipts retained deliberately as documented evidence of the exploited path (see RTR-001 appendix); WO-1046 cost reconciled −99,999 → 0 via `server/scripts/reconcile_wo1046.mjs` with a chain-valid audit_append ledger entry (REL-CERT-002 W2 resolved).

## Verification snapshot (2026-09-05)

- `node --test tests/api.test.js tests/plugins.test.js tests/governance.test.js tests/security.test.js` → **23/23 pass**
- Live smoke: `/plugins` 200 principal / 403 parent; `/work-orders` 403 parent, 0 uuid leaks for teacher; `/students` parent sees exactly 1 child, no `guardian_phone` key; transport event → lineage link intact.
- tsc clean; mock + live vite builds pass; UI serving on :4310, API on :8080 with all fixes.
- Certification delegated to QA-1 → `docs/ops/RELEASE-CERT-002.md` (in progress).

## Addendum: G18 kill-list execution (2026-09-05, final round)

RTR-001's Track G flagged the `/facilities` kill-list claim as FALSE (screen still routed).
Executed during this milestone: route removed from `App.tsx`, `/facilities` now 302s to
`/maintenance` via `Navigate replace`, `Facilities.tsx` (509 lines) deleted, facilities-desk
links in `Shell.tsx` and `Incidents.tsx` re-pointed to the flagship. Docs updated
(docs/09 §executed; README + app/README counts now 61 screens / 63 route paths incl. redirect).
tsc 0 errors, both builds pass, :4310 serving the post-kill build.
