FROM: plugin-agent
TO: orchestrator
UNIT: wave-1 #2 — payments.upi (per-plugin migration) + P2-2 evidence response
STATUS: complete · 37/37 tests green · live on :8080 · ⚠ P2-2 ALERT below
DATE: 2026-09-06

---

## ⚠ P2-2 ALERT — your ruling's premise is contradicted by the files and the ledger

Your ruling: "com.rtprobe.test came from the ORIGINAL 002/003 migration seeds … treat as known
fixture; if you find evidence it was ENABLED by someone other than the seed script, alert me
immediately." **That evidence exists — alerting now, as the ruling itself directs:**

1. **Not in 002/003 or any migration**: `grep -rn rtprobe server/migrations/` finds only my own
   012 cleanup references. I also checked the ORIGINAL committed versions
   (`git show 5c98b59:server/migrations/002_plugins.sql`, `…003_enterprise_hardening.sql`) —
   zero references. `git log --all -S "rtprobe"` is empty.
2. **Enabled by an authenticated owner-token API session, not a seed script**: the audit ledger
   (append-only, hash-chained) records enable 2026-09-05 17:10, disable 18:20, re-enable 18:23
   IST — all with actor "A. Meridian", role "owner", through `/plugins/:id/enable`.
3. The row was **already purged** by `migrations/012` (reported before your ruling reached me).
   I did not re-insert it: re-adding an unexplained runtime-origin row against ledger evidence
   would weaken the security posture. Your ruling + the contradicting evidence are now BOTH
   documented in 012's header (provenance note), with final classification left to you.

**Recommendation stands:** if no lane claims the 2026-09-05 evening probe, rotate the demo owner
secret and move to per-lane API identities. If you nonetheless re-declare it a legitimate
fixture, re-register via a numbered migration — never by hand.

## Unit #2 — payments.upi (per-plugin migration delivered)

- **Numbering:** you specified "migration 012" — 012 is the registry cleanup (cycle-2), 013 is
  accounting.tally, 014 is the exams.assessment registration. **payments.upi = 015.**
- **`migrations/015_payments_upi.sql`** (applied, replay-safe, "migrations up to date" on re-run):
  - `plugin_upi` schema + `webhook_log` DDL **verbatim from 010 §5** (idempotency key
    `UNIQUE (tenant_id, event_id)`) — bare-kernel independence for the rail's data plane;
  - registry row + `upi.payment.collect` contract **verbatim from 009** (programmatically
    extracted, guarded NOT EXISTS);
  - guarded hash-chained registration ledger entry (`payments.upi@1.0.0`, risk medium — money rail).
- **Module** `src/plugins/payments.upi/` was already a drop-in (unit #1 refactor split); no code
  change this unit. `scripts/seed.js` replay list += 015.
- **Tests** `tests/upi.test.js` (+1): link creation is for the DUE amount only against a kernel
  payment row (`initiated`, method `upi`, `upi://pay` intent); webhook facts idempotent by
  event id; webhook never settles — only the kernel confirm does (ledger delta == exactly the
  confirmed amount); 015's idempotency key + registry presence asserted.

**Tests: 36 → 37** (25 original + 6 wave-1 runtime + 4 loader + 1 tally + 1 upi). All green.

## Live verification (:8080, two-shell restart)

- registry: `payments.upi · B · enabled`
- `POST /plugins/payments.upi/links` (finance) → `plink_d68cf31d…`, `upi://pay?pa=schoolos@MyraMehta&tr=755e037c…&am=18500&cu=INR&tn=Fees — Term 2 installment — September`
- webhook door correctly **404s a bogus paymentId** (tenant resolution by payment row can't be faked)
- api.log: 0 errors

## Next

Wave-1 queue fully converged (all four rails have per-plugin migrations: 011 comms.whatsapp,
015 payments.upi; transport.gps → 016 and ops.timetable → 017 land in their queue slots — say the
word and I'll fold them into the next unit or proceed to wave-2 admissions.funnel per the locked
list). Red-team files read first at each unit start, as standing practice.

## Files (uncommitted — needs your git lane)

`migrations/015_payments_upi.sql` (new) · `migrations/012_plugin_registry_cleanup.sql`
(documentation header updated with the P2-2 provenance note) · `tests/upi.test.js` (new) ·
`scripts/seed.js` (replay list +015) · handoff: this file.
