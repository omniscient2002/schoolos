FROM: redteam
TO: orchestrator
STATUS: action-requested
DATE: 2026-09-07
CYCLE: 6 — final-tree disposition on the current tree (12/12 runtime modules, migrations 001→029, cycle-5 remediation regression + new surfaces per your GO)
METHOD: live black-box with real role tokens; full evidence in `handoff/2026-09-07-redteam-cycle6-plugin-report.md`.

## Verdict: SHIP

No P0/P1. Every cycle-5 finding independently verified CLOSED on the final tree; two new P2s are validation-robustness gaps in trusted-tier lanes (queued below), and the release lane is not blocked by them.

## Cycle-5 remediation — regression-verified (do not trust fixer tests; these are mine)
1. **P1-1 action codes:** 2nd/3rd export SAR, 2nd/3rd erasure SAR, 2nd funnel conversion — all 200 with distinct per-instance codes (`dpdp.dsr.<kind>.<sarId>`, `students.create.<leadId>`). The lifetime-500 class is dead.
2. **P1-2 dedupe race:** concurrent same-phone captures → one 200 + one 409 with the winning leadId (partial unique index + module catch; no 500, no duplicate).
3. **P2-1 E.164:** consent recorded spaced → erasure raised compact → **redacted: 1** — the erasure-miss gap is closed end-to-end; cross-format dedupe also 409s.
4. **P2-2 admissionYear:** coordinator + non-current session → 403 naming the rule; garbage format → 400.
5. **P2-3 uuid guard:** `/actions/zzz/decide` → 400 (kernel door).

## New findings (both P2, details + repros in the plugin report)
- **Moderation overlay unbounded (proven live):** approving a moderation with `adjustedSnapshot:{pct:99999, grade:"A1"}` succeeds and the report read then serves the absurd grade to staff. Blast radius verified narrow: cbse export reads ONLY the frozen `plugin_exams.report` rows — overlays never reach the board export; Mod Tier is trusted, proposer-net 403 and audit hold. Also `pct:0` is rejected (truthiness bug) so legitimate 0% adjustments can't be approved. Fix: finite-number bounds + grade re-derivation via the module's own `gradeOf`.
- **Plugin `:id` routes unguarded:** garbage uuid → 500 on 7 doors across 5 modules (visitors/admissions/clinic/hr/exams/dpdp). The 027 guard stopped at the kernel door; add a shared uuid-param schema/preHandler.
- P3/hygiene queue: consent-door PHONE regex runs pre-normalization (16-char spaced formats rejected before they can normalize), pickup OTP uses `Math.random` (attempt-bounded + scrypt vault, so risk is negligible — switch to `crypto.randomInt`), clinic correction can escalate action to `sent_home` without re-firing the guardian notice, dead `RELEASE SAVEPOINT` in hr.leave, unescaped ILIKE wildcards in guardian-lookup.

## What held on the final tree (attacked, clean)
Visitors OTP vault end-to-end (attempt bound fail-closed 429s including correct-code-after-bound, consume-on-success, RLS vault, release fail-closed 409, override owner/principal-only with mandatory note + audited high-risk, roster PII tail-masking with zero leakage); exams publication spine (approval-before-publish, weightage 409s, marks bounds, proposer-net on execute, freeze-after-publish 409, teacher/guardian tiering); IST boundaries **live inside the 5.5h drift window** (UTC-yesterday leave → 400 "today is 2026-09-07 IST"); lifecycle gates instant-409 with the enable guard validating class+version (all 13 registry rows verified re-enabled after my sweep — tree restored); UPI ±window 400 holds; cbse read-only/export-frozen posture; clinic/hr role matrices.

## Carry-over P2s — re-confirmed open, as accepted
Per-account throttle absent · token revocation absent · localStorage persistence · CORS wildcard (allow-credentials 0). Unchanged since cycles 3–5.

## Residue
`zz.redteam6.*` itemized in the plugin report for migration 030: 6 dpdp SARs (+1 redacted consent row), 3 admissions leads + 2 open enrollment actions, 1 published exam + 1 live pct=99999 moderation overlay (deliberately kept for P2 fix verification — or purge with the exam), 2 visitor passes (1 exhausted-OTP pickup_pending, 1 audited override), 1 cancelled hr leave row, 1 UPI canary, plugin toggle audit pairs. Tree state restored: all plugins enabled, no disabled rows, no 500-crash state. Scope held: read-only code, no git, no kills/restarts.

## Recommendation
Ship. Queue the two P2s (moderation bounds, uuid-param sweep) as the first post-release batch — the moderation one specifically before board-export season — plus the P3 hygiene list. Next cleanup migration: 030.
