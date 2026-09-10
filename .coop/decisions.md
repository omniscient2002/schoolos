# Binding decisions (S0 writes; workers must comply)

- **D-1 Migration numbering:** new migrations start at `server/migrations/054_security_sprint.sql` and are
  created ONLY by L1. Multiple logical changes may share one file if independent files are not required.
- **D-2 Shared-file freeze:** `app/src/services/index.ts`, `app/src/services/liveApi.ts`, and
  `app/src/services/teacherFixtures.ts` are owned by NOBODY this sprint. Lanes may IMPORT from `liveApi.ts`
  (adding exports there is forbidden — if a wrapper is missing, `blocks.md` it). Do NOT delete mock functions
  from `services/index.ts` — leaving dead mocks is acceptable for 48h; removal happens post-sprint.
- **D-3 App.tsx ownership window:** L3 owns `app/src/App.tsx` exclusively from T+0 to T+3 (boot changes only).
  From T+4 onward L5 owns it (route registrations, staffOnly list, NotFound fixes). L3 must not touch it after
  T+3. No other lane touches it at any time.
- **D-4 SLA_POLICY interplay:** L1 blanks `SLA_POLICY` (and every seed-derived key) from the `/dataset`
  empty-world payload (server). L3 adds a code-level `DEFAULT_SLA` table in `dataset.ts` used whenever the
  dataset payload lacks the key, and rebinds after hydration. ReportIssue must submit successfully in BOTH
  demo and empty worlds by T+8.
- **D-5 Empty-world contract:** server `/dataset` for non-demo tenants returns only tenant-real data + a fixed
  allowlist of structural keys. L3's kernel code must tolerate EVERY removed key (no `!`-asserts on dataset
  values anywhere in store/dataset code).
- **D-6 Honest toast standard:** 2xx → success toast allowed. Non-2xx → `friendly(e)` error toast. No door at
  all → copy states device-only/unsaved truth. No spinner-only hangs: every await has a catch that surfaces.
- **D-7 Grading contract:** fix is CLIENT-side (L5): send `status:'graded'` whenever a grade is recorded
  (server already requires it: teacher.classroom:168). Do not weaken the server check.
- **D-8 submission stats:** server returns `submission_count` (singular). L5 fixes fixtures + screens to
  singular. Do not change the server column alias.
- **D-9 Branches/commits:** none by workers. S0 commits at gates with per-lane messages.
- **D-10 Concurrency:** server test suite runs are S0-exclusive (D-3 of PLAN). `vite build` is S0/L2-only at
  gates; workers use `npx tsc --noEmit` for type feedback.
- **D-11 Conflicts:** two lanes needing the same file → first claim in `blocks.md` wins; S0 re-partitions at
  the next gate if needed. Resolution is S0's; never negotiate by editing each other's files.
- **D-12 Cut list (binding — do NOT start):** MFA, httpOnly cookie sessions, academic-year/fee engine, full
  maintenance 13-screen swap, real SMS/WhatsApp/email rails, i18n, full PITR/DR, DPDP erasure completion,
  family-home rework, plugin settings UI, parity CI gate (L2 stretch only if everything else is green).
- **D-13 Sprint clock:** T+0 = 2026-09-10 13:10 UTC. Gates every 4h (17:10, 21:10, 01:10 UTC, …). Workers:
  re-read THIS FILE at least once per hour — gate results, freezes, and re-partitions are posted here.
- **D-14 If a worker session dies or stalls:** its lane is frozen (no one else may claim its files) until S0
  re-partitions in this file. A stalled lane = no status-journal line for 90 minutes.
- **D-15 (T+86, from L1's blocks):** L2 takes two additions — (a) `server/scripts/bootstrap.js` must mirror
  migration 054's tightened grant matrix instead of blanket `GRANT ALL` (otherwise every test-DB setup re-widens
  the REVOKEs; L1's grant-matrix tests are written grant-independent and hold regardless); (b) add
  `app.visitor_pickup_otps` to `retention-worker.js`'s expired/consumed sweep. File ownership transfer is
  temporary and specific: L2 may touch ONLY those two scripts for this purpose.
- **D-16 (T+86, from L1's heads-up):** L4 — on Action Center cards for actions WITHOUT `payload.proposed_by`
  (admissions conversions, transport delay notices), approval by the owning desk role now 403s by design
  (SoD default). Add an "Owner must approve" hint on those cards; owner approval path is unaffected.
- **D-17 (T+86):** L5 (S5) has no journal entries or file changes at T+86. Expected: status line in
  `.coop/status/L5.md` by 15:10 UTC (T+120) or S0 re-partitions its scope (L4/L3 inherit pieces after their
  core tasks). No freeze yet — no L5 files are touched by anyone.
- **D-18 Gate-1 note:** L4 began screen edits before L3's kernel fix merged — acceptable (disjoint files:
  `store.tsx` vs `Attendance.tsx`); Attendance must be verified against the HYDRATED store at Gate-1.
- **D-19 (T+2h17, from L1's T105c):** L1 gets a SCOPED exception to `server/src/plugins/ops.timetable/index.js`
  — only the period-autofill attendance write (~lines 107-123) may be edited, to apply the same
  principal+/assignment binding as routes.js. No other lines of that file. This closes the P1-7 second half.
- **D-20 (T+2h17):** L4/L5 — student-role 403s on `GET /students` and 404s on `/students/:id` are CORRECT
  server truth now (L1's T105a). Student surfaces must use `student.world` doors only; staff screens rely on
  Guard. Do not "fix" the 403s client-side; file to blocks.md if a surface truly lacks a door.
- **D-21 Journal discipline:** L3 and L5 — append status lines as you complete tasks (protocol rule 4). S0
  treats 0 journal entries with file changes as a soft violation; first Gate-1 merge requires your journal.
- **D-22 (T+8h, Gate-2):** L5 unfreeze granted for `app/src/services/teacherFixtures.ts` and
  `app/src/services/parentApi.ts` — ONLY for the `submission_counts`→`submission_count` enrichment and the
  copilot `kind`/`sources` typing noted in blocks.md. Both lanes' core briefs are DONE; finish these two
  scoped fixes and stop.
- **D-23 (T+8h, Gate-2):** L3 granted scoped ownership of `app/src/components/Ai.tsx` for the
  `AiResponseView` honesty fix noted in blocks.md. Nothing else in that file.
- **D-24 (T+8h, Gate-2):** L2 — T208 (dist title/meta tenant-neutral): edit `app/index.html` source (not
  dist), then rebuild. `app/index.html` ownership granted to L2 for this one change. Gate-2 verification
  (server suite + build) is running; do not start new work until S0 posts results.
- **GATE-2 RESULTS (T+8h20, 21:30 UTC):** server suite EXIT:0 — ~273 tests pass, 0 failures, incl. L1's new
  negative-test file (~18.6 min run). App build EXIT:0 (tsc -b + vite, 51 changed files). Per-lane commits
  pushed to local main: 53fd349 L1, 0a46843 L2, b72874f L3, f2ad74c L4, 1dd9f4c L5 + sprint records.
  ALL FIVE LANE BRIEFS COMPLETE. Remaining: D-22 scoped fixes (L5 fixtures, L3 Ai.tsx), D-24 T208 dist
  rebrand + rebuild, then S0 final regression + re-grade. Workers: idle until S0 posts GO for the scoped
  fixes — pick nothing new from BACKLOG without a ruling.
- **GO (S0, T+8h40):** owner authorized push + full completion. L2: execute D-24 T208 (app/index.html
  rebrand + rebuild). L5: D-22 fixture/typing fixes. L3: D-23 Ai.tsx honesty fix. S0 will run the final
  regression at the next gate and deliver STILL NOT GOOD_2.md. If any lane is inactive, S0 executes the
  scoped fix directly (owner directive: "complete all").
