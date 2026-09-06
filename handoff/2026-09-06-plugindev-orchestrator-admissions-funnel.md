FROM: plugin-agent
TO: orchestrator
UNIT: wave-2 #1 · admissions.funnel — migration 018 (registration + runtime) + module + tests
STATUS: complete · 48/48 tests · live-verified on :8080 · teacher masked, parent denied
DATE: 2026-09-06

---

## Scope delivered (one migration per plugin — 018 is admissions.funnel's only one)

**Migration 018_admissions_funnel.sql** (applied both tenants, replay-safe):
1. `plugin_admissions` schema — `lead` (applicant/guardian PII confined here, purgeable)
   + `stage_history` (audit trail) + tenant/stage index. **App-role grants included**
   (GRANT USAGE + DML to schoolos_app, 010 §5 pattern — initially missing, caught by the
   suite as a 42501, fixed before ship).
2. Registry row `admissions.funnel@1.0.0` class **C** status `registered` (T1) — authored
   here first (009 never provisioned it); permissions `events.emit, audit.request` only;
   manifest declares PII policy, `dependencies: ["pack.dpdp"]`, DSR-friendly retention.
3. Capability contract `admissions.capture@1.0.0` (command, full-audit) with invariants:
   stage_lattice_enforced · terminal_stages_immutable · no_core_students_writes ·
   teacher_surfaces_pii_masked · no_money_surfaces.
4. Guarded hash-chained ledger entry (record_ref `admissions.funnel@1.0.0`).

**Module `src/plugins/admissions.funnel/`** (manifest + register, factory drop-in, zero
core edits): POST /leads (admin), GET /leads (admin+teacher, **role-tiered PII masking**),
POST /leads/:id/stage (server-enforced lattice: inquiry → applied → interview → offer →
enrolled, side exits rejected/withdrawn; terminal immutable; FOR UPDATE lock),
GET /leads/:id/history, GET /summary. Every door: kernel requireRole + **per-module
lifecycle gate (409 while not enabled — redteam P2-1 closed for this module**, the
uniform-gating pattern I flagged last unit). All preHandlers async (Fastify 5 law).

## Invariants under test (7 new tests; suite 41 → 48)

- Registered-not-enabled → **409 'not enabled'** on every door (no PII surfaced).
- Owner enable (audited) → capture → history seeded at inquiry.
- Lattice: inquiry→offer **409** 'illegal transition', unknown stage 400.
- Happy path to `enrolled`: **core students delta = 0** (funnel never writes core students —
  asserted against a seed baseline, not absolute zero, because the demo seed ships same-named students).
- Terminal immutability: enrolled→rejected 409; withdrawn→applied 409.
- **PII tiers: coordinator (admissions office) sees full guardian contact; finance sees
  masked phone `98xxxx10` + no guardian name; teacher masked; parent 403.**
- Registry mirror: exactly one row, contract present, `/plugins` strip intact.

## Live evidence (:8080, two-shell restart)

```
registry 11 rows · admissions.funnel registered · enable → 200
capture → 200 stage inquiry · inquiry→offer → 409 · inquiry→applied → 200
summary byStage counts correct · teacher masked=true (90xxxx22) · api.log 0 errors
/plugins uniform strip re-verified: teacher + parent, every row settings===undefined
```

## Notes

- Test math: 25 original + 6 wave-1 + 4 loader + 1 tally + 5 upi + **7 admissions = 48/48**.
- Uncommitted (your git lane): 018 · module dir · tests/admissions.test.js · seed.js (+018)
  · links-door 409 fix (payments.upi/index.js + test 5, from ADDENDUM 2).
- Dev DB has one live-verify lead (Live Verify Kid → applied) — harmless demo residue; not
  a purge item (created through legit doors post-verification).
- pack.dpdp is the natural next unit: admissions PII surfaces are built to its consent/
  DSR contract (`dependencies` declared), and ops.visitors follows per your sequence.
- Migrations ledger: next free after this unit is **019**.
