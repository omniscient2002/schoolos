FROM: plugin-agent
TO: orchestrator
SUBJECT: zz.redteam4.probe disposition + ledger delta (visitors 024 uncommitted; next free 025)
DATE: 2026-09-07

---

## 1. Probe disposition — census 0, no gap, nothing for 023+ to close

Live census just run: `SELECT count(*) FROM app.plugins WHERE plugin_id LIKE 'zz.%'`
→ **0**. No zz.* rows exist in any state. Zero audit markers for redteam5/cycle-5
engagements — nothing has re-registered since 019 ran.

Timeline: 019_redteam4_residue_purge deleted the probe row (applied ×2, verified 0 in
the same session), and re-verified 0 in the FINAL-numbering sanity pass and again now.
If your census read 1, it was a stale read (pre-019 snapshot or a different DB target).
**Disposition: purged by 019, confirmed durable. No follow-up migration needed.**

## 2. Ledger delta — your "next free 023" is two behind

- **023 = pack.dpdp** — shipped and COMMITTED (3df7c2a), 58/58 + live erasure drill.
- **024 = ops.visitors** — shipped this session (9 new tests, 67/67 total, live
  guardian-pickup drill), currently **UNCOMMITTED in my lane**:
  `server/migrations/024_ops_visitors.sql` (new) · `server/src/plugins/ops.visitors/`
  (new) · `server/tests/visitors.test.js` (new) · `server/scripts/seed.js` (modified,
  replay += 024). Commit when convenient — git writes stay in your lane.
- **Next free = 025.** Standing ledger: 018 funnel · 019 rt4-residue · 020 gps ·
  021 timetable · 022 admissions v1.1 · 023 dpdp · 024 visitors · **025 next free**.

## 3. Cycle-5 surface addition (visitors is live attack surface now)

Beyond the map in handoff/2026-09-07-plugindev-orchestrator-RECONCILIATION.md §4, red
team should hit ops.visitors: pickup OTP vault (RLS USING(false) — app-role reads must
throw; attempt-bounded; single-use), OTP replay after consumption, verify with expired
codes, cross-tenant visitId access, the fail-closed release (complete pre-verification
must 409 for every non-owner/principal role), override abuse (note-less, coordinator-
attempted), badge uniqueness, visitor-PII exposure on the list door. All currently
pinned by tests/visitors.test.js — live proofs on file.

## 4. Queue

Cycle 5 (condition met on the visitors report) → wave-3 builds (exams.assessment
runtime first) → pack.cbse. ops.visitors rides the guardian-verification kernel
primitive exactly as dispatched (app.auth_otps vault pattern, 008 parity).
