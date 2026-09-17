# Release notes

## 0.9.0 — 13-plane enterprise candidate (2026-09-08)

SchoolOS reaches the enterprise-candidate bar: every role plane runs on the shared plugin core, the full serial suite is green, and the security program's gates pass.

### New role planes
- **CoordinatorOS** (037): staffing today, substitution review with SoD decide, least-loaded duty allocation, curriculum monitor, escalation timelines, copilot-lite. Workload boards carry **no score/rank fields** (pinned by test) — fairness framing is contractual.
- **TeacherOS** (031/032/033): homework posting → one-shot student submissions (409 on resubmit; late marking at insert) → assigning-teacher-only review desk → missing-inbox roster bridge; support runtime; AI copilot with evidence-decayed mastery labels (secure→developing→needs_support, floored, idempotent) and seeded-only curriculum.
- **ParentOS** (034/035): family view with per-child timeline (now bridged to classroom submissions via the 034 name-match convention), consents, requests; assistant with deterministic answers, monthly budget (429), banned-words pin.
- **StudentOS** (036): no-personal-phone architecture — paper-first homework split (unlabelled = paper), print center, wellbeing requests routed to counselor, session isolation for shared computers.

### Security
- **A3 logout revocation**: jti denylist (038) — a logged-out session is dead immediately; sibling tokens unaffected; legacy tokens compatible; denylist self-cleans.
- **§43 permission matrix**: every route inventoried, 0 unguarded; new public endpoints fail CI unless consciously allowlisted. The route/guard counts are generated, not typed — see `docs/PERMISSION-MATRIX.md` (the "177 routes" formerly here was the count at the 0.9.0 tree and is stale).
- **RT-7…RT-11** fixed and pinned: schema-QUALIFIED table probes, tenant-correlated registry guards, RESTRICTIVE dual-policy RLS, duty-schema USAGE grant, coord decide SoD.
- Attack matrix expanded to 40+ classified vectors with repro + fix ledger.

### Reliability & delivery
- Seed self-provisioning: migrations 031–037 replay on fresh databases (curriculum tree, demo fixtures, registry rows).
- Factory check (`npm run check`): permission matrix + DB + RLS baseline, fails closed.
- Full serial suite: **counts are generated, not typed — see `docs/VERIFICATION.md`** (the "183/183" once written here was stale; the real suite is far larger). Web build green; handoff logs per lane in `handoff/`.

### Upgrades & operators
- One migration path: `node scripts/migrate.js` (031–038 all idempotent, replay-proven ×2).
- Student sessions: `STUDENT_SESSION_TTL` (default 30m) on both mint paths; no-store on personal-data planes; logout sends `Clear-Site-Data`.
