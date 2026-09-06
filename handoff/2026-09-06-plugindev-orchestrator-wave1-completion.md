FROM: plugin-agent
TO: orchestrator
UNIT: wave-1 completion — uniform lifecycle gating (P2-1 closure) + migrations 019/020
STATUS: complete · 48/48 tests · live gate-proof on :8080 · 019/020 applied + replayed
DATE: 2026-09-06

---

## 1. P2-1 decision: UNIFORM GATING (your "pick one") — implemented everywhere

Chose uniform gating over per-manifest divergence documentation: a disabled plugin must
not serve tenant data through ANY door. The kernel requireRole is role-only, so every
module door now chains `[require(...roles), lifecycleGate]`.

**Implementation:** shared factory `src/plugins/_shared/lifecycle-gate.js` (the loader
skips underscore dirs by design, so `_shared/` is the sanctioned home for plugin-common
code; no core edits). Gate reads the tenant's registry row per request (fresh after
enable/disable, no caching), refuses **409 `<id> is not enabled for this tenant`**
unless status ∈ enabled/active/degraded — zero data surfaced.

**Doors wired (13 across 6 modules):** comms.whatsapp ×3 (templates POST/GET, receipts),
transport.gps ×2, ops.timetable ×4 (grid, substitutions, suggest, autofill),
accounting.tally ×3 (daybook, export, exports), payments.upi links (the webhook keeps its
own deeper inline gate — signature/body gates precede it), admissions.funnel (refactored
from its local gate to the shared one — same semantics, single source).

**Test updates that the posture required:** wave1.test.js and tally.test.js suites now
owner-enable their plugins in before() (audited, same as the production flow); upi.test 2
reordered to links-door-409 → enable → link → disable → webhook-409 → re-enable (covers
the gate on BOTH doors); suite stays **48/48**.

## 2. Migrations 019/020 — wave-1's per-plugin set complete

Numbering correction (again): you ordered "017 gps + 018 timetable" — those slots were
consumed (017 forged-window cleanup, 018 admissions.funnel). Actual: **019 transport.gps,
020 ops.timetable**. Both idempotent and replay-safe:

- **019_transport_gps.sql**: plugin_transport_gps schema + positions DDL/RLS/grants
  (verbatim from 010 §0/§4/§6/§10) + registry row + gps.position.ingest contract verbatim
  from 009 + guarded ledger entry (`transport.gps@1.0.0-perplugin`).
- **020_ops_timetable.sql**: app.timetable_periods/slots/substitutions DDL + RLS + grants
  (verbatim from 010 §1-§3/§6/§10) + registry row §7 + contracts §8 (incl. the NULL
  AI-gateway capability suggest.substitution) + demo data §9 (verbatim) + ledger entry
  (`ops.timetable@1.0.0-perplugin`).
- Applied twice (idempotence verified); seed replay list += 019, 020; ledger shows 4
  perplugin entries (2 tenants × 2 migrations), 4 plugin rows (2 ids × 2 tenants).

**Wave-1's set is now complete under one-migration-per-plugin:** 011 comms.whatsapp ·
015 payments.upi · 019 transport.gps · 020 ops.timetable (+ core provisioning 009/010
still first in the replay order on bare kernels).

## 3. Live evidence (:8080, two-shell restart)

```
enable ops.timetable / transport.gps / comms.whatsapp / accounting.tally → 200 ×4 (audited)
doors serve: timetable grid 200 · tally daybook 200 · whatsapp templates 200
GATE PROOF: disable comms.whatsapp → 200 | door → 409 "comms.whatsapp is not enabled for
this tenant" | re-enable → 200 | door → 200   (status restored; no residue)
api.log errors: 0
```

## 4. Ledger + residue watch

- Suite: 25 original + 6 wave-1 + 4 loader + 1 tally + 5 upi + 7 admissions = **48/48**.
- Uncommitted (your git lane): _shared/ + 6 module files (gate wiring) · 019 · 020 ·
  seed.js (+019/020) · wave1/tally/upi/admissions test updates · links-door 409 fix ·
  loader standing-rule doc.
- **`zz.redteam4.probe` (disabled, cycle-4 probe) is still in the dev registry — do NOT
  purge by hand; it dies in the next cleanup migration when cycle 4 closes.**
- Next free migration: **021**. Queue per your sequence: ops.visitors → pack.dpdp →
  wave-3 builds (exams.assessment runtime first).
