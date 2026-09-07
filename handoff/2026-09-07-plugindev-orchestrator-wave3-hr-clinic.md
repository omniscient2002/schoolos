FROM: plugin-agent (EMPLOYEE-2)
TO: orchestrator
SUBJECT: Wave-3 close-out — hr.leave v1.0 + health.clinic v1.0 (029) · 98/98 · ROADMAP COMPLETE
DATE: 2026-09-07

---

## Amends: cycle5-remediation + ui-lane handoffs (both shipped; 027/028 live, ui wrapper flip signal documented)

Ruling received and executed: the 12-plugin count is a catalog number, not a stopping
rule. hr.leave + health.clinic built as ONE combined unit per your dispatch. Numbering
re-baselined by the tree: 027 = cycle-5 remediation, 028 = UI lane, **029 = this unit**.

## hr.leave v1.0 — the absence_feed source

- **Data plane**: `plugin_hr.leave` (RLS-scoped, app-role grants SELECT/INSERT/UPDATE),
  per-staff-day partial unique on marked rows — the race degrades to the 23505→409
  backstop (cycle-5 P1-2 pattern, SAVEPOINT-guarded so the catch path survives the
  aborted txn).
- **Doors**: mark leave (office lane: owner/principal/itadmin — teacher 403), cancel
  (appends nothing, flips status + emits withdrawal), roster/:date (desk lane:
  absent × onDuty from one query), list.
- **Contract**: emits `staff.leave.marked.v1` / `staff.leave.cancelled.v1` on the spine —
  the source named by ops.timetable's `absence_feed` enum ('hr.leave', 021). Setting
  absence_feed=hr.leave is now a live switch, not a promise. Absence is a FACT: no
  comms rail use. IST clock on date validation; no retroactive marking (past date 400).
- Contracts registered: staff.leave.marked.v1, staff.leave.cancelled.v1 →
  "consumer: ops.timetable (absence_feed=hr.leave)".

## health.clinic v1.0 — infirmary log + sick passes + approved guardian notices

- **Data plane**: `plugin_clinic.visit` (append-first — corrections append a new row, the
  log is never rewritten) + `plugin_clinic.sick_pass` (valid_until on the IST clock,
  settings ttl default 8h).
- **Guardian notices are APPROVED communications**: sent_home / hospital_referral raise a
  per-instance kernel action `clinic.notify.<visitId>` (UNIQUE(tenant,code) satisfied
  from birth — the cycle-5 P1-1 lesson applied at authorship) with payload.kind='message';
  the kernel decide-executor delivers onto the comms rail (transport gps_delay
  precedent). Live-proven end-to-end: action raised → principal approved →
  `execution: {type:'communication', status:'delivered'}`.
- **PII tiering**: health history is nurse-lane (owner/principal/itadmin/coordinator);
  finance and parent get 403 on the read door. Input guards: temperature plausibility,
  action enum, uuid student.
- Settings: notify_on_sent_home / notify_on_referral (default true) / sick_pass_ttl_hours.

## Migration 029 — `migrations/029_hr_clinic_runtime.sql`

Both schemas + tables + RLS + grants, factory-authored registry rows (024 precedent —
INSERT column list fixed to match app.plugins: no name/trust columns; permissions
column included), 4 capability contracts, guarded ledger `wave3-hr-clinic@1`. Applied
×2 on dev. **Idempotent for the seed replay** (IF NOT EXISTS + DROP POLICY IF EXISTS —
found live when the test harness re-ran 029 on an existing DB).

## Tests — 8 new pins (tests/hr-clinic.test.js), full suite **98/98, 0 cancelled**

hr: gate/authority matrix · mark + spine event · duplicate staff-day 409 with leaveId ·
past-date 400 · parents-are-not-staff · cancel + roster flip + re-cancel 409 ·
bad-date 400. clinic: nurse-lane refusals · first_aid raises NO action · input guards ·
sent_home → per-instance approval action → principal decision → comms rail delivered ·
second visit distinct code (no UNIQUE collision) · sick pass issue/dup-409/revoke/
revoke-409/office-only · corrections append (original untouched) · parent 403 on history.

## Live evidence (:8080, two-shell restart, 0 api errors)

hr.leave enable → Priya Iyer sick leave marked (spine event) → duplicate 409 → roster 1
absent / 10 on duty. health.clinic enable → Aarav fever 38.7 sent_home →
`clinic.notify.<visitId> [approval/open]` → principal approve → **comms delivered** →
sick pass issued (valid 8h IST) → history read. Census: hr 1 row · clinic 1 visit ·
1 pass · leave events 1 · clinic events 2 · notify actions 1 · contracts 8 · ledger 2.

## Roadmap status

**THE LOCKED LIST IS DONE.** Every catalog id has runtime + tests + live evidence; the
two dispatch riders (cbse, remediation batch) and the UI-lane four are also closed.
Remaining queue per your ruling: (1) cycle-5 remediation — **already absorbed in 027,
all findings closed, 88/88 at the time** (this confirms status); (2) UI four items —
**done in 028** (verify-401 → 409/422 + wrapper flip signal, guardian-lookup door,
376/376 seed coverage, F1 reseed ruling recorded, no delete door); (3) **cycle 6
re-attack** — ready when you fire it; (4) release lane — ready.

**Ledger**: 026 cbse · 027 cycle5-remediation · 028 ui-lane · **029 wave3-hr-clinic ·
next free 030**.

## Lane (your git lane)

Uncommitted: `migrations/029_hr_clinic_runtime.sql` · `src/plugins/hr.leave/` ·
`src/plugins/health.clinic/` · `tests/hr-clinic.test.js` · `scripts/seed.js` (+029) ·
`src/plugins/hr.leave` + `admissions.funnel` SAVEPOINT hardening (see below) · this
handoff.

## ⚠️ Latent-kernel-bug found and hardened (flag for you)

While building hr.leave's 409 backstop I found that the cycle-5 P1-2 catch in
`admissions.funnel` was itself unsafe: inside `withUser`, a failed statement (the
23505) aborts the transaction — any query in the catch path dies with 25P02 (the
"current transaction is aborted" 500). Its tests never exercised the catch (the
pre-check 409 always won the race). **Fixed in BOTH modules** with the SAVEPOINT
pattern (`SAVEPOINT` → `RELEASE`/`ROLLBACK TO SAVEPOINT` before the catch's lookup
query). Recommend the pattern be noted in the factory docs as THE standard for
unique-backstop catches inside withUser — any future module copying the admissions
catch verbatim would have shipped the 500.
