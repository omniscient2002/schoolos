# TS-3 (server-ai) — teacher.copilot v0 handoff · 2026-09-08

Lane: TeacherOS TS-3 (server-ai), clean retry, REDUCED v0 scope — deterministic only,
**no LLM wiring anywhere**. Status: **GREEN** — `tests/teacher-copilot.test.js` **13/13
pass**, parent-family regression **8/8 pass** (fresh DB each, solo run, DROP-first
discipline). Lane law respected: only `teacher.copilot/**`, migration `033_*`,
`tests/teacher-copilot.test.js`, and this handoff were touched.

## Shipped

### Plugin `teacher.copilot` (v0.1.0, class C, trust T1) — `server/src/plugins/teacher.copilot/`
| Door | Method | Roles | What it does |
|---|---|---|---|
| `/curriculum/tree?subject=&grade=` | GET | staff (owner/principal/itadmin/coordinator/teacher) | Seeded tree (units→topics) + coverage bars per class |
| `/curriculum/progress` | POST | staff | Teacher check-off `{node_id, class_grade, pct}` — **audited** (A1: teachers tick, never author) |
| `/mastery/student/:id?subject=` | GET | staff | Level + evidence links; A3 decay applied on read; `uuidParams('id')` guard |
| `/mastery/class/:grade?subject=` | GET | staff | Class map, evidence-bearing cells only |
| `/teacher/brief?when=eod\|week` | GET | **teacher only** | Deterministic day/week aggregation in plain sentences |
| `/copilot/draft` | POST | **teacher only** | `{kind: lesson\|worksheet\|feedback\|message, params}` → labelled `ai_draft` TEMPLATE (no model) |
| `/copilot/ask` | POST | **teacher only** | Keyword-routed question → `{answer, sources[], label}` over authorized data (no model) |
| `/teacher/usage` | GET | **teacher only** | Caller's own A2 budget ledger |

Every door carries the uniform lifecycle gate (`makeLifecycleGate`, 409 when disabled)
and plain-language errors. No route collisions with 031–037 plugins (verified).

### Tables (migration `033_teacheros_ai_runtime.sql`, idempotent, RLS on all)
- `curriculum.node` — subject/grade/parent_id/kind unit|topic|objective/name/order_no.
  **App role is SELECT-only** (A1: seeded via migration; the RLS test pins the INSERT refusal).
  Seed: CBSE-aligned tree, grades 6–8 × Mathematics+Science, 3 units × 4 topics each
  (90 nodes total), per-tenant idempotent.
- `curriculum.progress` — node_id/class_grade/covered_pct/covered_by/evidence_ref/covered_at,
  UNIQUE(tenant,node,class); upsert door.
- `mastery.evidence` — student_id/subject/node_id/kind/ref/value/observed_at/**expires_at**
  (NULL = non-expiring). kind deliberately not enum-locked (cross-lane write surface).
- `mastery.state` — level (`needs_support|developing|secure`, needs-support-never-failing),
  confidence (`low|medium|high`), derived_from jsonb (incl. decay marker), UNIQUE per cell.
- `copilot.call` — user_id/verb(`ask|draft|brief`)/budget_class(`teacher_tier`)/sources
  jsonb/at — one row per call (A2). tokens stay 0 in v0.
- Registry row + contracts (`copilot.ask.v1`, `copilot.draft.v1` — `deterministic_only`
  invariant) + guarded hash-chained ledger entry, per 018/020/029 precedent.

## Semantics that matter to reviewers

**A3 decay (pinned by test):** on read, evidence with `expires_at < now()` stops
counting. If the persisted state's evidence basis fully expired: level slides **exactly
ONE step down** (secure→developing→needs_support, floored), confidence → `low`,
persisted once (`derived_from.reason='evidence_expired'`, `decayed_at`) — later reads
are idempotent, no double-sliding. Fresh evidence always governs (deterministic
recovery: `[70]` alone → secure, even after a decay). Cells with no evidence ever get
**no label and no state row** (no evidence-free negative labels on minors).

**Brief degradation (pinned):** sibling sources (TS-1 `teacher.homework`/`submission`,
TS-2 `teacher.concern`) are read through `information_schema` table probes + per-source
try/catch + **column-shape probes**. With tables present but empty →
`available:true` + honest "no submissions are waiting" sentences; with data → counts
upgrade the sentences; with tables absent (older DB) → `available:false`, said plainly,
never a 500. Own tables (curriculum) always answer. A half-ticked topic (60%) is not
hidden: the pace phrase counts "touched" topics (full+partial) with the % still
full-coverage-based. **031/032 ship `created_by`/`filed_by`** (not `teacher_id`) — the
plugin probes the catalog and supports both shapes.

**Copilot v0 honesty:** every draft carries `label:'ai_draft'` + "no AI model involved"
in the body; ask returns `label:'deterministic_answer'`, `suggested_action:null`, and
`sources[]`. Abstract questions ("meaning of teaching") fall to the brief fallback —
keyword router no longer hijacks on bare "teach". Budget: 200 ask/draft per 24h per
user; 429 past cap; every call writes `copilot.call`; `/teacher/usage` exposes it.

## Test evidence (fresh DB per run)
- `tests/teacher-copilot.test.js`: **13 pass / 0 fail** (curriculum tree+guards,
  audited check-off+upsert, decay one-step+idempotence+recovery, floor, no-evidence
  cells, class map, brief degradation zero-row, brief upgrade with real 031/032 rows,
  draft labels+budget, ask routing×5+guards, brief param determinism, teacher-only
  doors, lifecycle gate 409, RLS cross-tenant + app-role INSERT refusal + uuidParams).
- `tests/parent-family.test.js` (regression): **8 pass / 0 fail**.
- Discipline: `DROP DATABASE IF EXISTS schoolos_test WITH (FORCE)` before every run;
  one suite per process (the shared DB + concurrent runners caused transient
  57P01 terminations earlier in the day — not a code bug).

## Fix ledger this cycle (plugin vs test)
- **Plugin fixes:** decay slide direction (was stepping UP on expiry — `Math.min(idx+1)`
  → `Math.max(idx-1)`, the observed `secure`-stuck/`needs_support`-climb bug);
  recovery path returns `decayed:false` and rewrites `derived_from` cleanly;
  brief sibling queries re-aimed at real 031/032 columns with shape probes;
  pace honesty (partial coverage surfaced); ask router keyword hygiene.
- **Test fixes (fixture/expectation, not plugin):** duplicate/ambiguous `$1` bindings
  (pre-fixed by reviewer); sibling fixtures rebuilt to the real 031/032 shapes
  (UNIQUE(homework_id,student_id) respected via 3 distinct students); RLS WITH-CHECK
  pin corrected (mismatched `tenant_id` vs GUC is the true rejection path);
  recovery/class-map expectations aligned to "fresh evidence alone governs" (the
  correct A3 semantics — `[70]` → secure, not developing); token cache to respect the
  20 logins/min limiter.

## Integration notes for TU-3 (UI lane)
- Base path: doors are mounted at root (`/teacher/brief`, `/copilot/*`,
  `/curriculum/*`, `/mastery/*`) — plugin doors in this codebase mount at `/`, not
  `/plugins/<id>/` (matches teacher.classroom/teacher.support).
- Enable first: owner must enable `teacher.copilot` (registry row ships
  `status:'registered'`); every door 409s with plain copy until enabled.
- Brief payload: `{when, generatedFor, timetable, homework, concerns, curriculumPace,
  sources[], sentences[], label:'deterministic_summary'}` — render `sentences[]`
  verbatim; gate sections on the per-source `available` flags; `when ∈ {eod, week}`
  (anything else → eod, server-side default).
- Mastery payload: `level ∈ needs_support|developing|secure` (+ `levelLabel`),
  `confidence`, `decayed:true` flags a cell whose label just slid — show the decay
  glyph + evidence links (`evidence[]` with `expired` booleans). Empty `map` = no
  evidence, render "no observations yet", never a negative badge.
- Draft payload: `label:'ai_draft'`, `deterministic:true`, `budget:{used,cap}` —
  keep the ai_draft badge visible until the teacher edits; there is no send path from
  this plugin (message sending stays a separate approved flow).
- Ask payload: `answer`, `sources[]`, `label:'deterministic_answer'` — always show
  sources; suggested_action is null in v0.
- Errors are plain-language strings in `{error}` (400/403/404/409/429).

## Known limits (v0, deliberate)
- Mastery evidence has no producer door yet (write surface is reserved for sibling
  lanes/assessments; tests seed rows directly) — no hard FK by plugin-isolation rule.
- Timetable matching uses the demo grid's `teacher_name` string (021 shape); a
  teacher_id column would replace the name join.
- copilot.call.tokens_in/out stay 0 until a governed model is wired (v1); drafts are
  templates, ask is keyword routing — by design, not by omission.
