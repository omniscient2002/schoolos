FROM: plugin-agent (EMPLOYEE-2)
TO: orchestrator
SUBJECT: exams.assessment v1.0 (wave-3 runtime, migration 025) — 74/74, live publication spine, cycle-5 shipped-around
DATE: 2026-09-07

---

## 1. Unit

**exams.assessment v1.0 runtime** — wave-3 builds. Registry + contract `exams.publication`
were provisioned by 014 (its "registers in wave 3" note); 025 adds the data plane. No
registry edits, zero core files touched.

**Migration 025** (applied ×2 dev, idempotent):
- `plugin_exams.exam` — weightage jsonb (components→percent, enforced Σ=100),
  weightage_locked, published_snapshot, digest, action_id, UNIQUE(tenant,class,term,name)
- `plugin_exams.mark` — UNIQUE(exam,student,component), marks≤max CHECKs; student ref is
  app.students.id by value (no hard FK — plugin isolation)
- `plugin_exams.report` — frozen deterministic snapshot + sha256 digest, UNIQUE(exam,student)
- **RLS on all three tables** keyed to `current_setting('schoolos.tenant_id', true)` — the
  GUC withUser already sets — as defense-in-depth for the locked invariant
  no_cross_tenant_marks (exam-grade data justifies more than WHERE-scoping)
- guarded registry row (bare-kernel DBs; 014 rows win) + guarded hash-chained ledger entry
  `exams.assessment@1.0.0-runtime`

**Module** (`src/plugins/exams.assessment/`, class D, lifecycle gate on every door):
- POST /exams — draft + weightage; Σ≠100 → 409 weightage_total_enforced (EXAM_ADMIN)
- GET /exams (staff)
- POST /exams/:id/marks — upsert per (exam,student,component), per-write audit +
  exam.marks.updated.v1; over-max 409; unknown student 404; **published exam → 409 frozen**
- POST /exams/:id/publish — raises kernel approval action `exams.publish` (one open max);
  nothing assembled yet (approval_before_publish)
- POST /exams/:id/publish/execute — verify approved (open → 409, dismissed → 409),
  proposer-execution SoD 403, deterministic assembly (pure fn of marks+weightage+scale,
  cbse_10_point default), report INSERTs, exam frozen, exam.published.v1
- GET /exams/:id/reports/:studentId — post-publication deterministic read
- Tiers: EXAM_ADMIN owner/principal/itadmin/**coordinator** (assessment coordinator —
  standard school role); teacher/finance/parent 403; teacher MAY enter marks.

**Locked invariants → encoded:** deterministic_only (canonical-JSON sha256, same inputs →
same digest, pinned), weightage_total_enforced (create + publish double-check),
approval_before_publish (assembly only on execute-after-approval), no_cross_tenant_marks
(RLS + WHERE scoping).

## 2. Tests — 7 new, suite 74/74 (0 cancelled)

Gate 409 pre-enable · parent 403 · weightage 409s · marks upsert+audit+event · over-max/
unknown-student · **publication spine** (raise → duplicate-open 409 → execute-before-
approval 409 → principal approve → execute 200 → digest stamped → marks frozen 409) ·
**deterministic_only** (88/100·70% + 18/20·30% → 88.6 → A2, points 9; two reads → same
digest) · **no_cross_tenant_marks** (second tenant via direct INSERT, dpdp precedent: GUC
switch → 0 rows visible to schoolos_app; cross-tenant INSERT → RLS WITH CHECK rejection;
cross-tenant examId → scoped miss) · teacher tier pins.

## 3. Bugs the harness caught (all pre-ship)

1. EXAM_ADMIN initially omitted coordinator → 403s (domain call: coordinator administers
   assessment) — tier fixed.
2. **publish door raised the action but never linked exam.action_id** → execute saw no
   action. Same link step as dpdp's SAR flow — added the UPDATE.
3. `INSERT … ON CONFLICT DO UPDATE` needs UPDATE privilege upfront; report was
   SELECT-granted. Assembly is single-shot (FOR UPDATE + status gate), so plain INSERT is
   correct; conflict would mean tampering → fails loudly. **Migration was uncommitted, so
   per the 021 precedent: reverted on dev (schema + migration row + ledger tail), fixed
   grants (report INSERT+SELECT), re-applied ×2.**
4. Test 6 assumed a second tenant existed — test seed is single-tenant; now creates one
   (dpdp direct-INSERT precedent).

## 4. Live evidence (:8080, two-shell restart, 0 api errors)

enable 200 (014 manifest intact — registry-truth guard held) → create "Term 1 Assessment"
class 8, weightage {written 70, oral 30} → marks written 88/100 + oral 18/20 for Aarav S.
Sharma → publish → action `aa79735c…` → principal approve → execute → **published, 1
report, exam digest `52604d61…`** → report card **88.6% A2 (points 9)**, per-report digest
`eba9b2c8…` → post-publish marks write → **409 "marks are frozen"**. Census: marks 2 ·
reports 1 · exam.published.v1 ×1 · exam.marks.updated.v1 ×2 · 4 audits · 0 api errors.

## 5. Cycle-5 overlap note

Cycle 5 fired mid-unit (per standing rule I shipped through; verification happens at
close). Red-team brief already filed (2026-09-07-plugindev-cycle5-briefing.md) — add
exams.assessment to the surface list: publication spine replay, decide-by-finance,
weightage bypass via direct mark upserts pre-publish, digest stability, RLS probes.

## 6. Lane + queue

Uncommitted (your git lane): `migrations/025_exams_assessment_runtime.sql` ·
`src/plugins/exams.assessment/` · `tests/exams.test.js` · `scripts/seed.js` (replay +=
025) · this handoff. Ledger: 024 visitors · **025 exams · next free 026**. Queue:
**pack.cbse** (consumes the weightage/CBSE rules this unit encodes) → wave-3 remainder.
