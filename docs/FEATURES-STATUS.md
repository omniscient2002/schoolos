# FEATURES-STATUS — SchoolOS 13-plane enterprise candidate

> Living document, updated per release cycle. **Every count below is illustrative, not authoritative.**
> Pass/test counts are generated into `docs/VERIFICATION.md`; route and guard counts into
> `docs/PERMISSION-MATRIX.md`; migration/module counts into `docs/VERIFICATION.md`. The per-plane door/test
> figures in the table were typed by hand and have not all been re-measured (an earlier "183/183" here was
> stale), so read them as the shape of a plane, never as a current count.

## Role planes (13)

| Plane | Server (migration · doors · tests) | UI | Status |
|---|---|---|---|
| Owner | core registry + kernel · 009/010 · lifecycle doors, custom roles, plugins, metrics, migration, audit-verify | Action Center, Group console, Insights/Reports, Fees, Roles, Plugin settings, Audit, Migration | 🟡 Partial — oversight console GA; board pack / announcement composer / certificate signing / inspection pack absent (`docs/OWNER-PRINCIPAL-PERFECT-100.md`) |
| Principal | core registry + kernel · coord.view · principal-owned approval spine | Today/Attention/Next, Action Center, Learning, Fees, AI usage, Automation, Audit, Safety | 🟡 Partial — approval spine GA; 7am brief / fee-health control / compliance calendar / counselor referral absent (`docs/OWNER-PRINCIPAL-PERFECT-100.md`) |
| Coordinator | `coord.view` · 037 · 7 doors · 9 tests | 6 screens (Command Center, Substitutions, Workload, Curriculum, Escalations, Approval Center) | ✅ GA |
| Teacher (classroom) | `teacher.classroom` · 031 + 114 · 14 doors | TeacherHome, Homework, SubmissionsInbox, MyLeave, Lessons, Duties & workload, Teaching copilot | ✅ GA |
| Teacher (support) | `teacher.support` · 032 · 24 doors | Student-support hub: concerns, doubts, interventions, parent meetings, safety box | ✅ GA |
| Teacher (AI copilot) | `teacher.copilot` · 033 · 9 doors | Copilot (ask/draft), Mastery map, Curriculum, Progress story, Exam marks — all routed | ✅ GA |
| Parent (family view) | `family.view` · 034 · 17 doors | FamilyHome, Consents, Requests, per-child flows (attendance+leave, exams, assignments, timeline, explain, PTM) | ✅ GA |
| Parent (assistant) | `parent.assistant` · 035 · 4 doors | ParentCopilot (budgeted, deterministic) | ✅ GA |
| Student | `student.world` · 036 · 19 doors | StudentHome2, learn lane (homework+submit, mistakes, flashcards, tasks, results), print center, wellbeing, noticeboard | ✅ GA |
| Finance | `accounting.tally` 013, `payments.upi` 015, kernel fees 109–111 | fee desk, plans, payments, receipts (PDF), concessions, installments, reconciliation, dunning, delivery, student dues | ✅ GA — fees domain 100/100 (`docs/FEES-PERFECT-100.md`) |
| Admissions | `admissions.funnel` 018/022/119/123 (v1.3) | funnel screens (capture/edit/schedule/docs/offer/health/SLA) | ✅ GA |
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

- **Library v2 (docs/LIBRARY-DESIGN.md)** — shipped: dedicated `librarian` role, opt-in plugin, per-copy
  tracking, reservations, fines ledger, purchase requests, due/overdue reminder sweep, and an aggregate
  owner/principal operations dashboard. The old 4-role staff gate is gone: only the librarian runs the desk.
  Enterprise pass (docs/LIBRARY-PERFECT-100.md §1a): reservation-expiry sweep, lost/damaged closure +
  replacement charge, fine-waiver setting, scan config, reports/CSV, pagination envelope, per-account
  borrower throttles (migration 111), cover images, acquisition vendor/budget tracking, library KPI gauges
  + alert rules, backup/restore round-trip and DPDP erasure of library free text. Remaining: external
  red-team pass; advanced-tier features (barcode images, ISBN lookup, CSV import, reading lists, e-resources).
- Counselor/clinic confidentiality pin suite (B9) — planned.
- Secret-scan as CI cron (E5) — script exists in §37 gate, cron wiring pending.
- Red-team cycle 7 on classroom/coord/revocation — in flight.
