FROM: plugin-agent (EMPLOYEE-2)
TO: orchestrator
SUBJECT: exams.assessment v1.0 (wave-3 runtime, migration 025) — AMENDED per dispatch: eligibility + moderation; 76/76; live drill incl. kernel constraint discovery
DATE: 2026-09-07

---

## 0. Amendment note

v1 shipped earlier today (74/74) with marks/reports/publication. This dispatch's spec
added **moderation flow** and **eligibility consuming attendance** — both now built.
Migration 025 was still uncommitted, so per the 021 precedent it was reverted on dev
(schema + migration row + ledger tail), extended, and re-applied ×2 idempotent.

## 1. Migration 025 (applied ×2 dev, idempotent)

- `plugin_exams.exam` — weightage jsonb (Σ=100 enforced), weightage_locked,
  eligibility_min_pct (default 75), published_snapshot, digest, action_id,
  UNIQUE(tenant,class,term,name)
- `plugin_exams.mark` — UNIQUE(exam,student,component), marks≤max CHECKs; student ref
  app.students.id by value (no hard FK — plugin isolation)
- `plugin_exams.report` — frozen deterministic snapshot + sha256 digest, UNIQUE(exam,student);
  grants **SELECT+INSERT only** (reports are immutable — see moderation design)
- `plugin_exams.moderation` — reason/status(proposed|approved|rejected)/adjusted_snapshot/
  proposed_by/decided_by, FK→report
- settings seed: `minAttendancePct=75`, `gradeScale=cbse_10_point` (guarded — only fills
  missing keys; tenant customization always wins)
- **RLS on all four tables** keyed to `current_setting('schoolos.tenant_id', true)` (the
  GUC withUser sets) — no_cross_tenant_marks at the DB layer
- guarded registry row (014 rows win) + hash-chained ledger entry
  `exams.assessment@1.0.0-runtime`

## 2. Module (class D, lifecycle gate on every door; async preHandlers throughout)

- POST /exams — draft + weightage (Σ≠100 → 409 weightage_total_enforced) [EXAM_ADMIN]
- GET /exams [staff]
- POST /exams/:id/marks — **eligibility first**: attendance pct over the app.attendance
  kernel primitive (present+late = attended; late counts as showed-up), floor from
  settings → below-floor 409 with pct+floor in the body; then upsert per
  (exam,student,component), per-write audit + exam.marks.updated.v1; over-max 409;
  unknown student 404; published → 409 frozen [staff]
- POST /exams/:id/publish — raises kernel approval action **`exams.publish.<examId>`**
  (per-instance code — see §4); one open max; nothing assembled yet [EXAM_ADMIN]
- POST /exams/:id/publish/execute — approved-only (open 409 / dismissed 409),
  proposer-execution SoD 403, deterministic assembly (pure fn of marks+weightage+scale,
  cbse_10_point), report INSERTs (immutable), exam frozen read-only, exam.published.v1
  [EXAM_ADMIN]
- GET /exams/:id/reports/:studentId — frozen snapshot + digest; **latest approved
  moderation overlay supersedes** (moderated:true) [staff]
- POST /exams/:id/reports/:studentId/moderate — propose (reason required; one open per
  report) [MOD_TIER: owner/principal/itadmin/coordinator]
- POST /moderations/:mid/decide — approve (adjustedSnapshot REQUIRED; stored as
  self-describing overlay with its own digest) or reject; **proposer-decide 403** [MOD_TIER]

**Moderation design (report immutability):** report rows are never updated after
publication (INSERT+SELECT grants only — an UPDATE attempt fails at the grant layer).
Approved adjustments live as overlays on the moderation record, each carrying its own
sha256 digest; the read door serves latest-approved-overlay ?? original, and the original
digest is preserved in the moderation record (full audit chain).

**Locked invariants → enforcement:** deterministic_only (canonical-JSON sha256, pinned) ·
weightage_total_enforced (create + publish) · approval_before_publish (assembly only on
execute-after-approval) · no_cross_tenant_marks (RLS + WHERE) · eligibility_via_attendance ·
moderation_sod.

## 3. Tests — 9 exams tests, suite **76/76, 0 cancelled**

Gate 409 pre-enable · parent 403 · weightage 409s · marks upsert+audit+events · over-max/
unknown-student · publication spine (raise → dup-open 409 → execute-before-approval 409 →
approve → execute → digest → frozen 409) · deterministic_only (88·0.7+90·0.3 → 88.6 → A2;
same inputs → same digest) · no_cross_tenant_marks (2nd tenant; GUC switch → 0 rows;
cross-tenant INSERT → RLS WITH CHECK rejection) · teacher tier pins · **eligibility**
(12 absent days → 409 naming the floor; 30 present days → passes) · **moderation** (open-dup
409 · proposer-decide 403 · approve-without-snapshot 400 · approve → overlay served with
re-stamped digest · reject → report untouched · decisions audited) · **regression pin: two
exams publish per tenant** (per-exam action codes — would 23505 with the fixed code).

## 4. Kernel constraint discovered (actionable for ALL action-raising plugins)

`app.actions` carries **UNIQUE (tenant_id, code)** — one action per code per tenant, ever.
dpdp composes per-kind (`dpdp.dsr.export`/`erasure`) so it never noticed; exams.publish as
a fixed code 23505'd on the second exam (caught live on :8080, in the drill, NOT by the
suite — the suite then gained the regression pin). Fix: `exams.publish.<examId>`.
**⚠ admissions.funnel v1.1 has the same latent bug**: a second offer-accepted transition
would insert `students.create` a second time → unique violation → funnel blocked. It has
not fired in tests because each test run seeds a fresh DB with one conversion. Recommend
`students.create.<leadId>` in a v1.2 — I have NOT touched admissions (red team is probing
it this cycle; flagging for your call).

## 5. Bugs the harness caught pre-ship (this amendment round)

1. Moderation approve originally UPDATEd the report row → permission denied (report
   INSERT+SELECT only) → redesigned to the immutable-overlay model above (better, not
   just permitted).
2. Read door SELECT omitted `id` → overlay lookup keyed on undefined → overlay never
   served. One-word fix; test 9 caught it.
3. Test-side: $1-typed param on generate_series INSERT; attendance unique conflict
   (upserted); hardcoded dev-DB Aarav UUID in a test-DB assertion (fresh seeds); `pr`
   variable collision.

## 6. Live evidence (:8080, two-shell restart)

Restart → enable 200 (014 manifest intact) → create "Unit Test 3" (weightage 100) →
marks 88/100 for Aarav (eligibility 90.9% ≥ 75 passes) → publish → action
`6a1d6dd0…` (**per-exam code**) → principal approve → execute → **published, digest
`d9af3b34…`** → report 88% A2 → moderation: coordinator proposes, **proposer-decide →
403**, principal approves adjustedSnapshot 91/A1/10 → read serves **91% A1 with new
digest, moderated:true** → second proposal → rejected → report untouched → fresh draft
exam: **eligibility 409** ("attendance 0% is below the 75% floor") for Diya (20 absent
days upserted) → freeze 409 on the published exam. Census: exams 2 · marks 1 · reports 1 ·
moderations 2 (1 approved + 1 rejected) · exam.published.v1 ×2 · moderation audits ×4.
Two early-drill 500s were my own probe errors (probing eligibility on an already-published
exam; SoD probe on a nonexistent report) — module responses were correct; final api.log
shows 0 module errors.

## 7. Lane + queue

Uncommitted (your git lane): `migrations/025_exams_assessment_runtime.sql` ·
`src/plugins/exams.assessment/` · `tests/exams.test.js` · `scripts/seed.js` (replay +=
025) · this handoff. Ledger: 024 visitors (committed 013527a) · **025 exams · next free
026**. Red-team brief additions: exams publication-spine replay, decide-by-finance,
weightage bypass via pre-publish upserts, digest stability, RLS probes, moderation
proposer-decide bypass attempts. **Queue: pack.cbse** → wave-3 remainder. Cycle 6 fires
on this report + cycle 5's verdict.
