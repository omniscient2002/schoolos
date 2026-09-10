# SchoolOS 48-Hour Sprint — Master Coordination Plan

**Sprint goal (48h): make the system safe, honest, and not crashing.** Kill the 3 P0 auth findings, fix CI,
fix the frontend kernel bugs, wire the core staff screens to the real API doors, and replace every fake
success toast with truthful copy. This is NOT the full remediation plan — the cut list is in `decisions.md`.

**Master of record:** session S0 (the auditor session that wrote `STILL NOT GOOD_1.md`). S0 integrates,
verifies, merges, rules on disputes, and re-grades at the end. Workers do not commit to git.

## Reading order (every worker session, first 10 minutes)
1. This file (`PLAN.md`) — the rules.
2. `decisions.md` — binding rulings; check back whenever you face an ambiguous choice.
3. Your lane brief: `tasks/L1.md` … `tasks/L5.md` — your assigned scope, tasks, acceptance criteria.
4. Evidence source: `STILL NOT GOOD_1.md` (repo root) — every task cites its section; read only what you need.

## Lanes (one per worker session; file ownership is ABSOLUTE)
| Lane | Session | Scope |
|---|---|---|
| L1 | S1 | Server security core + all new migrations |
| L2 | S2 | CI, ops, repo hygiene, backups, production build |
| L3 | S3 | Frontend kernel (store/dataset/boot) → then the honesty sweep |
| L4 | S4 | Core staff screens → real doors (Today/Attendance/Fees/ActionCenter/Audit/bell) |
| L5 | S5 | Parent + student + teacher lanes + nav model |

**Integration gates:** every 4 hours from sprint start (T+4, T+8, … T+44, T+48). S0 runs the full server test
suite, builds the app, resolves cross-lane conflicts, commits, and posts rulings to `decisions.md`. Workers
keep working through gates unless S0 posts a freeze note in `decisions.md`.

## Protocol rules
1. **File ownership is absolute.** Touch only files in your lane brief. Need another lane's file? Write it to
   `blocks.md` and keep working on something else. NEVER edit cross-owned files — this is what makes 5 agents
   in one tree safe.
2. **No git commands.** S0 owns all commits. You edit files; git history is S0's problem.
3. **Test discipline:** full server suite (`cd server && npm test`) is S0-only at gates (it uses one shared
   test DB — parallel runs corrupt it). Workers get fast feedback with `node --check <file>` (server) or
   `npx tsc --noEmit` in `app/`. If you must run the suite between gates, announce "TESTING" in your status
   file first and wait 2 minutes for objections.
4. **Status journal:** append to `status/<your-lane>.md` as you complete each task: one line per task —
   `T-xxx DONE: <one-line evidence>` or `T-xxx BLOCKED: <reason>` (mirror to `blocks.md`).
5. **Honesty rule for all UI copy:** a toast may only claim persistence if a 2xx response came back. Where no
   door exists, say what is true ("Saved on this device only — not connected to school records").
6. **No scope creep.** If a fix pulls you into another lane's area, `blocks.md` it. The cut list in
   `decisions.md` is binding — do not start MFA, httpOnly, fee engines, rails, or i18n.
7. **Early finish:** pick from `tasks/BACKLOG.md` in order. Do not invent work.

## Target outcomes at T+48
- 0 P0 auth findings reproducible; CI green on a clean clone.
- No crash routes for a fresh tenant; no demo identity (Aarav/Kavita/₹55,500) shown to real tenants.
- Attendance, fees, actions, audit, notifications operating on real doors; grading + stats contracts fixed.
- Zero toasts claiming writes that did not happen (spot-checked list in lane briefs).
- Shipped bundle no longer brands a demo school; `.qa-relcert*` PII residue gone.
- S0 delivers `STILL NOT GOOD_2.md` — the delta verdict with re-graded scores (baseline: 58/31).
