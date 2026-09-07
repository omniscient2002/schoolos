FROM: plugin-agent (EMPLOYEE-2)
TO: orchestrator
SUBJECT: FINAL UNIT — cycle-6 P2/P3 hardening + rt6 residue (030) · 114/114 · lane closes clean
DATE: 2026-09-07

---

## Cycle-6 report read FIRST (standing policy): handoff/2026-09-07-redteam-cycle6-plugin-report.md

All P2/P3 findings + the itemized residue executed in this unit. Verdict SHIP upheld —
these were the queued-before-board-season items, now closed.

## P2-1 · Moderation bounds + re-derivation (`exams.assessment` v1.0.1)

- `adjustedSnapshot.pct` must be a finite number in [0,100] via **Number.isFinite** —
  the pct:0 truthiness bug is fixed (0% is now a legitimate adjustment; proven live).
- **grade/points are RE-DERIVED** via the module's own `gradeOf` on the exam's scale;
  a hand-supplied grade that mismatches the derivation → 400 (pct 50 + "A1" refused).
- Overlay now carries the audit chain: `correctsReportId` + `originalDigest`.
- **Read-path defense (trust nothing stored)**: the report door re-derives grade on the
  way out; a poisoned/pre-hardening overlay (pct 99999 injected directly via SQL in the
  test) is NOT served (`moderated:false`, bounded snapshot). The red team's live-served
  absurd-grade vector is dead at both doors.

## P2-2 · Shared uuid-param guard (`src/plugins/_shared/uuid-param.js`) — 7 :id doors / 5 modules

`uuidParams('id'[, 'studentId'|'mid'])` preHandler added to: visitors
checkin/pickup/verify/complete/deny · admissions stage/history · exams marks/publish/
publish-execute/reports(+studentId)/moderate(+studentId)/moderations/:mid/decide ·
clinic correct/sick-pass/revoke · hr cancel · dpdp dsr-export/dsr-execute. Garbage ids
→ 400 `"<param> must be a uuid"` everywhere — the 027 kernel pattern generalized.
Live: 4/4 spot doors → 400.

## P3 batch — all five

1. **dpdp normalize-before-validate** (v1.1.1): PHONE regex judges the NORMALIZED form;
   the 16-char `+91 98000 770004` class is accepted (live: 200, stored E.164), garbage
   still 400.
2. **visitors OTP → `crypto.randomInt(100000, 1000000)`** (v1.0.2): CSPRNG parity with
   the kernel OTP; scrypt+salt vault behavior unchanged.
3. **clinic escalation re-notice** (v1.0.1): corrections extracted a shared
   `raiseGuardianNotice` helper — a correction that escalates to sent_home/hospital_
   referral re-fires the guardian notice with a per-instance code on the correction row;
   non-escalating corrections fire nothing (pinned). Severity guard lives INSIDE the
   helper so no caller can bypass it (found by my own suite run mid-unit).
4. **hr `RELEASE SAVEPOINT` before the return** (v1.0.1): dead code removed; behavior
   unchanged (hr suite green).
5. **guardian-lookup ILIKE escape** (visitors): `%`/`_` escaped with an explicit
   `ESCAPE '\'` — `q=%` now matches nothing (live: 0 matches).

## Migration 030 — `migrations/030_cycle6_hardening.sql` (applied ×2)

- **rt6 residue purge, outbox-first**: 7 SARs (…770001-3, erasures …001/002, the
  fulfilled …55001) + their per-instance actions, 3 RT6 leads + stage history, the
  RT6 exam family (mark→report→**moderation incl. the live pct=99999 overlay**→exam;
  moderation matched via report lineage — my first draft had the classic bug of
  matching report ids against exam ids), 2 ZZ.RT6 visits + vault OTPs, the cancelled
  hr leave row, the rt6 UPI canary (guarded — it vanished mid-inventory), evt_rt6_*
  webhooks, both erased probe consents (zz_rt6_norm + the re-probed …55001 trail;
  matcher widened after the first run left 1 orphan). **Census after: all zeros.**
- Registry bumps: exams.assessment 1.0.1 · admissions.funnel 1.2.1 · pack.dpdp 1.1.1 ·
  ops.visitors 1.0.2 · hr.leave 1.0.1 · health.clinic 1.0.1 (manifests match).
- Guarded ledger `cycle6-hardening@1`. Seed replay includes 030 (idempotent temp-table
  pattern from 027).

## Tests — 16 new pins (tests/cycle6-hardening.test.js) · full suite **114/114, 0 cancelled**

Garbage-uuid matrix across 6 doors + the multi-param moderate route · pct:99999 → 400 ·
pct:0 → approved-and-served with grade E · grade-mismatch → 400 · poisoned-overlay
read-path defense · overlay audit chain · dpdp 16-char spaced 200 + garbage 400 · OTP
structure under randomInt · wildcard literals · escalation re-notice (+ non-escalation
null). Note: the suite caches login tokens — the kernel rate limiter is real and my
first run tripped it; cache added rather than weakening the limiter.

## Live evidence (:8080, two-shell restart, 0 api errors)

P2-2: 4 doors garbage-uuid → 400 · P2-1 full chain on a live eligible student
(Vihaan Menon — Aarav is attendance-gated at 72.7%, correctly refused): marks → publish
→ owner decide (SoD) → owner execute → coordinator proposes → **pct 99999 → 400** →
**pct 0 → approved** → read: `pct 0 · grade E · moderated true` · P3-1 spaced 200 ·
P3-5 `q=%` → 0 matches. My drill artifacts (RT6 Hardening Check exams, probe consents)
cleaned post-drill by direct owner-path DELETE (FK order) — drill rows from EARLIER
units (Live Conv leads, Late Pickup visit) remain as standing evidence.

## Lane close-out

**The lane's last numbered unit is done. Ledger: 001→030 complete · suite 114/114 ·
12/12 catalog ids · every red-team cycle remediated or pinned.** Release-cert factory
input updated: migration tree 001→030 applied ×2; verdict history FIX-FIRST ×3 →
SHIP ×2, with the SHIP's queued P2/P3 batch now closed in 030.

**Files for your commit**: `migrations/030_cycle6_hardening.sql` ·
`src/plugins/_shared/uuid-param.js` (new) · index.js edits in exams.assessment /
admissions.funnel / pack.dpdp / ops.visitors / hr.leave / health.clinic + 6 manifests ·
`tests/cycle6-hardening.test.js` · `scripts/seed.js` · this handoff.
