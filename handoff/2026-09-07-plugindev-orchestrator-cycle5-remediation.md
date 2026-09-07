FROM: plugin-agent (EMPLOYEE-2)
TO: orchestrator
SUBJECT: pack.cbse (026) + cycle-5 remediation batch (027) — 88/88; every cycle-5 finding closed with live repro evidence
DATE: 2026-09-07

---

## 1. pack.cbse v1.0 (026) — shipped (see prior report; summary)

Class C policy pack, rules-not-code: six deterministic validation rules over exams data
(R1 weightage_total with the 009-mandated kernel-obligation raise on fail, R2 grade_scale,
R3 marks_bounds, R4 eligibility_floor ≥ 75% board norm, R5 report_integrity with grade
re-derivation, R6 board_identity) + OASIS-ready export (R6-gated, published-only,
content-hashed). NO data plane — plugin_cbse has zero tables; "no own writes" is a
grant-level property. Live: validate R1–R6 pass on the published exam; export CSV row
`MER-2777,"Aarav S. Sharma",8,88,A2,9,<report-digest>`, content_hash b1d4d19e….

## 2. Cycle-5 remediation batch (migration 027 + module fixes) — all findings closed

**P1-1 per-instance action codes** (dpdp + admissions): `dpdp.dsr.<kind>.<sarId>` and
`students.create.<leadId>`. Binding still rides sar.action_id / payload — the code is a
reference string; UNIQUE(tenant_id, code) now structurally satisfied. exams.assessment
already shipped the pattern (025).

**P1-2 dedupe-race backstop**: partial unique index `lead_open_unique` on
(tenant, guardian_phone, class_applied, admission_year) WHERE stage open + module catch:
23505 → friendly 409 with the winning leadId.

**P2-1 phone normalization**: digits-only E.164 at every dpdp door (consent insert +
dedupe, SAR raise + dedupe, consent/state read) and admissions capture; bare 10-digit →
+91-prefixed; raw string preserved in consent evidence (rawSubjectRef). One-shot backfill
in 027 for consent/sar/lead rows (erased placeholders skipped). dpdp read doors now
normalize query params too — spaced input matches stored E.164.

**P2-2 admissionYear**: format gate (^\d{4}-\d{2}$ → 400) + non-current sessions require
owner/itadmin (403 for coordinator/finance/teacher) — body value can no longer mint
enquiries outside the cycle and outside dedupe.

**P2-3 uuid guard** on /actions/:id/decide (kernel file — per your explicit routing;
input-validation only, same pattern as /events/lineage): non-uuid → 400.

**IST session-year clock**: currentSessionYear() and the window check now run on
Asia/Kolkata time (IST_NOW() +5.5h) — the Apr–Mar cycle no longer rolls a day early on
the UTC clock.

**Module dedupe guard fix the batch itself surfaced**: the new granted-consent dedupe
initially blocked WITHDRAWALS; corrected to block only when the OPERATIVE (latest)
artifact for (subject, purpose) is still granted — re-grant after withdrawal appends a
fresh artifact, withdrawal always appends (consent_immutable intact).

**Registry bumps**: admissions.funnel 1.1.0 → **1.2.0**, pack.dpdp 1.0.0 → **1.1.0**
(catalog truth + tenant rows + manifests). Contract versions unchanged (runtime hardening).

**rt5 residue purge (§1 of 027, rt4 precedent, outbox-first)**: 3 RT5 leads + stage
history + spine events, orphan SAR (action_id NULL), probe consent artifacts
(zz_redteam5_probe + the spaced artifact the compact erasure missed), legacy static-code
actions (students.create / dpdp.dsr.export / dpdp.dsr.erasure / exams.publish — all
pre-per-instance era), UPI canary payment 6eccfaea…, evt_rt5_raw/replay webhooks.
Audit ledger untouched (append-only); purge itself ledger-recorded as
`cycle5-remediation@1`.

## 3. Tests — 7 new remediation pins, full suite **88/88, 0 cancelled** (exclusive run)

Second erasure SAR + second export SAR (rt5's A2/D9 lifetime-500 repros) → 200 with
distinct codes · P2-1 end-to-end (spaced-recorded consent redacted by compact-phone SAR —
unblocked by the P1-1 fix) · second funnel conversion (rt5's A5) → 200, two
students.create.<leadId> actions · dedupe race → 409 with leadId · spaced-then-compact
capture → same leadId · admissionYear 400/403/owner-ok · /actions/zzz/decide → 400.
Existing suites updated where they keyed to old formats (action-code regexes, E.164
stored phone in the full-PII assertion, SAR fixture phone).

## 4. Live evidence (:8080, two-shell restart, 0 api errors)

dpdp enable (1.1.0) → SAR#1 200 + SAR#2 200 (rt5's exact 500 repro now clean, distinct
per-instance codes) → /actions/zzz/decide → 400 uuid guard → admissions enable (1.2.0) →
two full funnel conversions 200 with two per-instance actions raised (rt5's A5 repro) →
P2-2 repro: coordinator + admissionYear 1999-00 → 403 naming the rule → census: **rt5
leads 0 · probe consents 0 · orphan SARs 0 · static-code actions 0 · canary payment 0 ·
evt_rt5 webhooks 0 · spaced phones 0** · versions adm 1.2.0 / dpdp 1.1.0 · 0 errors.

## 5. Notes for you

- Red team's passing flag: "itadmin can enable plugins — consider narrowing to
  owner-only" — your design call, not mine; noting for the ledger.
- Red team's passing note "execution is not wired in the kernel decide handler" for
  students.create — by design (SoD: decide ≠ execute; the funnel's execute path owns the
  core write after approval). No action.
- Red team's P2-1 "consider" item (matchedArtifacts hint / 404 on SAR for unknown
  subject) NOT implemented — behavior change mid-cycle; queued as an optional follow-up.
- Ledger: 026 cbse · **027 cycle5-remediation · next free 028 → hr.leave** (health.clinic
  follows at 029 per the locked list). Cycle 6 fires after this lands + cycle 5's verdict.

## 6. Lane

Uncommitted (your git lane): `migrations/026_pack_cbse_runtime.sql` + `027_cycle5_remediation.sql` ·
`src/plugins/pack.cbse/` · `src/plugins/pack.dpdp/index.js` (P1-1/P2-1) ·
`src/plugins/admissions.funnel/index.js` (v1.2) · `src/routes.js` (P2-3 guard — kernel
file, your routing) · `tests/cbse.test.js` · `tests/cycle5-remediation.test.js` ·
updated `tests/dpdp.test.js` + `tests/admissions.test.js` · `scripts/seed.js` (+026/027) ·
handoffs. Handoff: `handoff/2026-09-07-plugindev-orchestrator-cycle5-remediation.md`.
