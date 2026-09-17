# FEATURES-STATUS — SchoolOS 13-plane enterprise candidate

> Living document, updated per release cycle. **Every count below is illustrative, not authoritative.**
> Pass/test counts are generated into `docs/VERIFICATION.md`; route and guard counts into
> `docs/PERMISSION-MATRIX.md`; migration/module counts into `docs/VERIFICATION.md`. The per-plane door/test
> figures in the table were typed by hand and have not all been re-measured (an earlier "183/183" here was
> stale), so read them as the shape of a plane, never as a current count.

## Role planes (13)

| Plane | Server (migration · doors · tests) | UI | Status |
|---|---|---|---|
| Owner / Principal | core registry + kernel · 009/010 · lifecycle doors | Action Center, Insights, Approvals | ✅ GA |
| Coordinator | `coord.view` · 037 · 7 doors · 9 tests | 6 screens (Command Center, Substitutions, Workload, Curriculum, Escalations, Approval Center) | ✅ GA |
| Teacher (classroom) | `teacher.classroom` · 031 · 8 doors · 11 tests | TeacherHome, Homework, SubmissionsInbox (routed) | ✅ GA |
| Teacher (support) | `teacher.support` · 032 · 22 doors | teacher support screens | ✅ GA |
| Teacher (AI copilot) | `teacher.copilot` · 033 · 8 doors · 13 tests | brief/mastery/curriculum doors consumed by teacher UI | ✅ GA |
| Parent (family view) | `family.view` · 034 · 11 doors · 8 tests | FamilyHome, Consents, Requests (+ timeline, roster↔user bridge) | ✅ GA |
| Parent (assistant) | `parent.assistant` · 035 · 4 doors · 9 tests | ParentCopilot (budgeted, deterministic) | ✅ GA |
| Student | `student.world` · 036 · 14 doors · 11 tests | StudentHome2 + print center + wellbeing + noticeboard (no-phone paper-first) | ✅ GA |
| Finance | `accounting.tally` 013, `payments.upi` 015 | fees, payments | ✅ GA |
| Admissions | `admissions.funnel` 018/022 | funnel screens | ✅ GA |
| Transport | `transport.gps` 020 | routes/GPS | ✅ GA |
| Facilities / Ops | `ops.timetable` 021, `ops.visitors` 024, work orders | operations desk | ✅ GA |
| IT / Governance | `pack.dpdp` 023, `pack.cbse` 026, HR/clinic 029 | IT, governance, DPDP pack | ✅ GA |

## Security program

- **Threat model + attack matrix**: `docs/SECURITY-MATRIX.md` — 40+ attacks classified; RT-1…RT-11 fixed and regression-pinned.
- **A3 logout revocation**: migration 038 `auth.revoked_token`; jti minted on every login; `/auth/logout` revokes immediately; denylist self-cleans. Regression: `tests/auth-revocation.test.js` (2/2).
- **§43 permission matrix**: `server/scripts/permission-matrix.js` — every route classified, **0 unguarded**. The exact route/guard counts are generated into `docs/PERMISSION-MATRIX.md` (never typed here; the "177 routes" once in this line was stale). Fails closed in `npm run check`.
- **RLS**: every tenant table scoped by `schoolos.tenant_id` GUC under `schoolos_app`; restrictive dual-policy holes audited (RT-9); cross-tenant probes pinned per suite.
- **Gates**: §37 secret scan clean · §45 no raw-HTML injection paths · §47 prod JWT_SECRET ≥32 guard · npm audit 0 vulns · DPDP consent ledger append-only.

## Acceptance gates (last run)

- Full serial suite: see **`docs/VERIFICATION.md`** for the measured counts, run log and source fingerprint (`npm test`, or regenerate with `node server/scripts/verification-artifact.js`).
- Factory check (`npm run check`): permission matrix + DB + RLS baseline — **green**.
- Web build (`npm run build`): **green** (tsc 0 errors, vite).
- Source revision: identified by the fingerprint in `docs/VERIFICATION.md` (this lane runs no `git` commands, so a commit hash is not available to assert here).

## Known follow-ups

- Counselor/clinic confidentiality pin suite (B9) — planned.
- Secret-scan as CI cron (E5) — script exists in §37 gate, cron wiring pending.
- Red-team cycle 7 on classroom/coord/revocation — in flight.
