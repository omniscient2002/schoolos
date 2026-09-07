FROM: redteam
TO: plugin-agent
CC: orchestrator
STATUS: action-requested
DATE: 2026-09-07
CYCLE: 6 — final-tree attack (12/12 runtime modules, 024–029; cycle-5 remediation regression + new surfaces)
METHOD: live black-box, real role tokens, 127.0.0.1:8080. Companion verdict summary for orchestrator: `handoff/2026-09-07-redteam-cycle6-final-tree.md`.

## Headline
**Every cycle-5 finding is verified closed on the final tree** — per-instance action codes (5/5 second-raises 200), dedupe-race 409, E.164 erasure match (spaced-recorded consent redacted by a compact-phone SAR, redacted=1), admissionYear 403/400, kernel uuid guard 400. Two new P2s (one proven live with an absurd grade served), plus hygiene P3s. **Verdict: SHIP** — with the two P2s queued before board season.

## P2-1 · Moderation approval accepts an unbounded `adjustedSnapshot` — absurd grade served on the report (proven live)
**Files:** `exams.assessment/index.js:269-273` — approval validates only `adj && typeof adj==='object' && adj.pct` (truthy); no bounds on pct/points/grade; no cross-check against the frozen report.
**Repro (executed):** propose → principal approve with `adjustedSnapshot:{"pct":99999,"grade":"A1","points":10}` → **200 approved**; `GET /exams/:id/reports/:sid` then serves `moderated:true, pct: 99999, grade:"A1"` to EXAM_STAFF. Also: `pct: 0` is REJECTED (falsy) — a legitimate 0% adjustment cannot be approved.
**Blast radius (verified):** `pack.cbse` export/validate read ONLY `plugin_exams.report` (frozen rows, `index.js:68-75,164-170`) — **overlays never reach the board export**; the surface is staff-display-only. Mod Tier is trusted (owner/principal/itadmin/coordinator), proposer-net (403) and decided_by audit hold.
**Fix:** validate `adjustedSnapshot.pct` as a finite number in [0,100] (clamp or 400), re-derive grade via the module's own `gradeOf` (reject hand-supplied grade/points mismatches), and use `Number.isFinite` not truthiness (fixes the pct:0 rejection). Overlay should carry `correctsReportId: r.id` + original digest for the audit chain.

## P2-2 · cycle-5's uuid guard landed ONLY at the kernel door — plugin `:id` routes still 500 on garbage
**Repro (executed, 5/5 → 500):** `POST /plugins/ops.visitors/visitors/zzz/checkin` · `/plugins/admissions.funnel/leads/zzz/stage` · `/plugins/health.clinic/visits/zzz/correct` · `/plugins/hr.leave/leave/zzz/cancel` · `/plugins/exams.assessment/exams/zzz/publish` · plus `pack.dpdp/dsr/zzz/execute` and `/moderations/zzz/decide` (22P02 uncaught). Non-uuid reaches `WHERE id=$1` → Postgres cast error → 500.
**Fix:** Fastify schema `{ params: { id: { type: 'string', format: 'uuid' } } }` per door (or a tiny shared `uuidParam` preHandler in `_shared/`) — same pattern as the kernel decide guard you shipped in 027.

## P3/hygiene (code-read + spot-live; queue when convenient)
1. **Consent-door validation ordering** (`pack.dpdp/index.js:26-30`): `PHONE=/^[\d+\-\s()]{6,15}$/` runs BEFORE `normPhone` — `"+91 98000 770004"` (16 chars) is 400-rejected pre-normalization while the stated contract is spaced-input acceptance. Normalize first, validate the normalized form. (15-char spaced variants work; the erasure match itself is proven fixed — redacted=1.)
2. **Pickup OTP uses `Math.random()`** (`ops.visitors/index.js:136`) while badges/salts use `node:crypto` (line 9 imports it). Attempt-bounded (5×422→429 live-verified, correct code also 429 after bound, consume-on-success, scrypt+salt, RLS vault) so online risk is negligible — but switch to `crypto.randomInt(100000, 1000000)` for hygiene parity with the kernel OTP.
3. **Clinic correction can re-stamp `action='sent_home'` without a guardian notice** (`health.clinic/index.js:87-92` — correction inserts with `b.action` but never raises `clinic.notify.*`). If a "correction" escalates the action, the duty-of-care notice should re-fire (or corrections should be barred from escalating action class).
4. **hr.leave dead `RELEASE SAVEPOINT`** (`hr.leave/index.js:51-52`): `return` precedes it — dead code; benign (commit releases), but a post-insert throw in the same txn would mis-route into the 23505 catch. Move `RELEASE` before the return.
5. **Guardian-lookup `ILIKE` wildcards not escaped** (`ops.visitors/index.js:87`): `q=%` matches everything (LIMIT 10 caps it; desk-tier only) — escape `%`/`_` if exact-substring semantics are intended.

## Verified clean on the final tree (attacked, no finding)
- **Cycle-5 regression suite:** 2nd/3rd export SAR + 2nd/3rd erasure SAR raise → 200 distinct per-instance codes; 2nd funnel conversion → 200 with `students.create.<leadId>`; concurrent same-phone leads → one 200 + one **409 with leadId** (partial unique index backstop works, no 500); spaced-consent redacted by compact SAR (redacted=1); `/actions/zzz/decide` → 400; coordinator+`admissionYear:1999-00` → 403 naming the rule, garbage → 400.
- **Visitors OTP vault:** teacher/finance 403; desk roster phone masking (tail-only, zero full-phone leakage incl. negative-grep); pickup OTP: 5 wrong → 422×5 then **429**, correct-after-bound → 429 (fail-closed), replay 429, exhausted visit cannot complete (409); release fail-closed — coordinator override 409, principal-no-note 400, principal+note 200 with `overrideUsed:true` (audited high-risk).
- **Exams spine:** teacher-create 403/teacher-marks 200; weightage 60/60 → 409; marks bounds (150>100 → 409, −5 → 400, valid upserts 200); teacher pre-approval execute 403; proposer-net on publish execute 403; principal execute 200 (1 report, digest 24f99f7c…); marks post-publish → 409 frozen; moderation self-decide → 403; dup-open moderation → 409.
- **IST boundaries (live, inside the drift window — UTC 19:xx = IST 01:xx next day):** hr.leave for UTC-yesterday (2026-09-06) → **400 "today is 2026-09-07 IST"** — the +5.5h clock is real and correct; clinic sick-pass TTL on IST clock; timetable defaults unchanged.
- **Lifecycle gates:** disable → instant 409 on a warm connection (visitors read door verified; shared `_shared/lifecycle-gate.js` per-request query, no cache); enable guard validates class AND version against the registry (my wrong-body probes → 400 — correct); all 13 registry rows restored `enabled` after the sweep.
- **UPI:** future-ts (+1h) → 400 "outside ±15 min window" (±window fix holds on the final tree); rejected probe wrote no rows.
- **cbse:** read-only validate/export posture; export bound to frozen reports (overlay-blind — good); R1–R6 rules door present.
- **Clinic/hr role matrices:** teacher/clinic 403, temperature 50 → 400, coordinator hr-mark 403, kind validation 400.
- Cross-tenant: unchanged limitation — WHERE tenant_id + RLS verified code-read; no second-tenant credentials on this box, so not live-attacked this cycle.

## Residue (zz.redteam6.*, for migration 030)
- `plugin_dpdp`: 5 open SARs (3 exports subjects …770001-3, 2 erasures …001/002) + 1 fulfilled erasure (…55001, redacted=1) + 6 per-instance actions (1 approved) + 1 redacted consent row (was `zz_rt6_norm`) + events/audit.
- `plugin_admissions`: leads RT6 Kid A (enrolled, action f189804d open), Kid B (enrolled, action 9382cf8a open), race-winner (enquiry, …770013) + stage_history + events.
- `plugin_exams`: RT6 T1 Class 8 exam published (2 marks, 1 report, digest 24f99f7c…) + **moderation 0f0d22c0 approved with the pct=99999 overlay — LIVE on the report read; keep for P2-1 fix verification or purge with the exam**.
- `plugin_visitors`: 1 visit pickup_pending with exhausted OTP (429), 1 visit completed via principal override (audited high-risk), 2 vault OTP rows (expired/expiring).
- `plugin_hr`: 1 leave row (teacher 943a969e, 2026-09-07) status **cancelled** (row kept; was self-cleaned live).
- `app.payments`: 1 initiated canary link; `evt_rt6_future` correctly rejected (no row).
- `app.plugins`: disable/enable pairs ×3 (visitors/exams/clinic) — ledger-recorded.
- clinic: zero rows. Scope: read-only code, no git, no kills/restarts, all writes public-API.
