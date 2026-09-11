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
- **D-25 SCOPE CHANGE (owner, 2026-09-11): the AI voice receptionist is REMOVED from this project's scope.**
  It was never built (zero code references), so removal affects roadmap documents only: STRIKE from Phase 5
  planning, from the §24 NOT-IMPLEMENTED inventory, and from all future waves. Do not design, estimate, or
  schedule anything voice/telephony-related. The company name ("AI Reception") may still reference the
  concept in branding — that is a business decision outside engineering scope. Current grades (74/56) are
  unaffected: the receptionist was never weighted in them.
- **D-26 RUN SCOPE (owner directive, T+0 of Waves 2–5 run):** continuous execution until T+46h or full
  completion; strict P2→P3→P4→P5 priority; STOP ruling posted by S0 at T+46; honest projection ~82/70 at
  halt; live-credential items (SMS/BSP/SMTP sends, external staging) ship code-complete + sandbox-verified
  and are NOT failures.
- **D-27 TAKEOVER STANDING ORDER:** lane silent ≥90 min (no journal line AND no file changes) → S0 declares
  it dead and executes its queue directly. No permission needed; journal records the takeover.
- **D-29 liveApi amendment:** L4 may ADD wrappers to `app/src/services/liveApi.ts` this run (Wave-1 freeze
  partially lifted); no lane may delete from `services/index.ts` (deferred cleanup).
- **D-30 App.tsx continuous ownership:** L5 owns App.tsx for the whole run (Wave-1 D-3 window superseded);
  S0 reviews at gates.
- **D-31 Secrets rotation (S0-executed):** JWT_SECRET + webhook secrets regenerated in `server/.env` this
  run; server restart required; deployed environments must mirror before next release.
- **D-32 CREDENTIALS-LAST PROTOCOL (owner directive):** all provider integrations (SMS/WhatsApp/SMTP/gateway)
  are built, configured, and TESTED against sandbox adapters now. Owner supplies real keys/passwords at the
  END of the run; only then are they placed into server/.env / plugin settings. Rules: (1) no lane blocks on
  credentials — ever; (2) keys NEVER enter git, tests, logs, or code comments; (3) final integration step is
  S0-only, with values written to server/.env and documented in the final report; (4) every integration ships
  with a credential checklist in the report so the owner knows exactly which key goes where.
- **D-33 QUALITY BAR (owner directive):** enterprise target = accuracy + consistency + security + features
  per the audit's Phase 2-5 definitions. "Done" per item = code + negative tests + tsc/suite green + honest
  UI. No shortcuts to hit the clock: if Wave 5 exceeds T+46h, remaining items are recorded precisely as the
  post-run backlog rather than shipped loose.
- **D-34 HELP CHANNEL (owner directive):** `.coop/help.md` is the single place to post findings, blockers,
  questions, and asks. Post FIRST when stuck (before idling), then continue the next unblocked queue item.
  S0 answers every entry inline prefixed [S0]; standing rules get mirrored here. The D-27 90-minute takeover
  still applies to lanes that are silent WITHOUT a help.md entry — posting here is how you buy time honestly.
- **D-35 STANDING GRANT LAW (ratifies L1's bootstrap finding):** the app role NEVER receives table-level
  DELETE in schema app; deletes go through scoped SECURITY DEFINER helpers. bootstrap.js baseline is the
  enforcement point; L1's fix is ratified. Every lane designs delete paths accordingly.
- **D-36 WAVE-5 GO (conditional):** all lanes MAY start P5 items now. Conditions: (1) your own P2-P4 test
  files are green first (L3's green cycle must land); (2) no new fiction anywhere (honesty rule); (3) parity
  gate + suite green at gates; (4) RUN-STOP unchanged at T+46h — P5 items unfinished then go to the post-run
  backlog as precisely specified stubs, never half-shipped.
- **D-37 L2 CONTRACT DEBTS (P3-security priority — BEFORE P5 items):** from L5's help entries:
  (a) MFA login challenge → plain JSON 401 {mfaRequired:true, challengeToken} — drop the 307+Location;
  (b) /auth/login honors body.tenantId mirroring the OTP doors; 409 carries the full picker;
  (c) force_change stamped on EVERY issueSession path (single shared helper — OTP/SSO/MFA-verify included);
  (d) POST /me/mfa/disable (password re-auth) + GET /me exposes mfa_enrolled_at + enroll refuses when enabled;
  (e) POST /auth/renew (cookie-authed re-issue; 401 when absent) — L5 flips RENEW_DOOR_LIVE after it lands.
- **D-38 BI CANONICAL:** L3's ops.bi doors are THE read-model surface. L1-5.2 consumes them
  (invalidateBiCache exported for L1) and adds only kernel aggregates ops.bi lacks. L1-5.1 ranking proceeds.
- **D-39 PLUGIN REGISTRY GRANT:** L5 owns app/src/plugins/pluginRegistry.ts ADDITIONS to mirror the new
  catalog rows (ops.udise, ops.import, ops.bi, money.invoicing) — nothing else in that file.
- **D-40 MIGRATION NUMBERING:** files are L1-owned; current set verified unique by S0. Future rule: claim the
  next free number via a help.md entry BEFORE creating the file.
- **D-41 LANE TEST DBs:** TEST_DB_NAME override in tests/helpers.js is ratified as the standard for lane-level
  runs (L2's 35/35 on schoolos_l2test stands). schoolos_test stays S0-only for gates (D-10).
- **D-42 SOURCE TREE LAW:** app/src is TypeScript-only — no .js artifacts may exist or be committed there
  (vite resolves .js before .ts, so a stray compiled file silently replaces the real source and crashes
  boot). S0 deleted lib/format.js, lib/rng.js, types/domain.js (compiled CJS strays). Emit nothing into src/.
- **D-43 WAVE-5 ACCEPTANCE ITEM (owner request):** "Librarian" must be creatable as a custom role via the
  /roles console (L5-5.1) with library-scoped permissions, and the kernel (L3-4.2 resolution) must honor
  it end-to-end: a user with ONLY the librarian role sees the Library module and nothing management-only.
  L5 builds the console flow; L3 verifies enforcement server-side (a librarian token cannot read finance
  doors, CAN use library doors). This item is verified in STILL NOT GOOD_3.md — it does not count done
  until demonstrated. Note for the product ledger: principals keeping read-oversight of library is
  acceptable and expected; the acceptance target is that a librarian-only account works.
