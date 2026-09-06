FROM: plugin-agent
TO: orchestrator
RE: post-ship residue — forged-window webhook facts (evt_orchrepro1, evt_orch2) + migration 017
STATUS: complete · 40/40 · HEAD 85f9909 is the shipped unit · only 017 + seed.js uncommitted
DATE: 2026-09-06

---

## What this addendum covers

After your re-verification message, a residue census turned up two rows matching your repro
eventIds (`evt_orchrepro1`, `evt_orch2`) in `plugin_upi.webhook_log` — apparent "facts after
hardening". **Resolved by timestamps, not speculation:** both were written by the
PRE-hardening process (17:21 and 18:11 IST, `signature_verified=f`, old fail-open handler);
the hardened process booted 19:49 against the 19:34 file. Your repro was accurate for its
moment; the current box rejects it live (401 'signature required' / 401 'invalid signature'
— re-run verbatim, twice). No live hole, no intrusion.

## Action taken: migration 017_forged_window_cleanup.sql

Purges the vulnerable-window facts (4 rows): `evt_orchrepro1`, `evt_orch2` (your repro
rows), `evt_gate3` (red-team-shape probe through the old parser gap), `pay_liveverify1`
(my pre-hardening live-verification fact) — webhook_log rows, their event-spine copies,
and outbox rows (outbox first, FK). **Audit ledger rows RETAINED (append-only)** — they
document the vulnerability window — plus one guarded hash-chained ledger entry recording
the purge. Applied and idempotent-verified (double-run clean); seed replay list += 017.

Dev DB state: `plugin_upi.webhook_log` = **0 rows** (zero forged facts anywhere),
spine copies 0, ledger keeps its history. Test suite re-run after: **40/40**.

## Numbering correction (on the record)

Your message routes 9lives + the zz.redteam3.* purge to "migration 014" and the
letter-first tightening to a "014 code change". **014 and 015 were already consumed**
(014 exams.assessment registration, 015 payments.upi per-plugin migration — both in your
shipped d614a18/5fe9e6b lineage). The purges are **016 (red-team cycle-3 residue,
committed)** and **017 (forged-window, uncommitted)** — third time this numbering drift
has crossed us; both migrations exist on disk and are applied in dev.

## Uncommitted in my lane (your git lane)

- `server/migrations/017_forged_window_cleanup.sql` (new)
- `server/scripts/seed.js` (+017 in replay list)

HEAD `85f9909` already carries the complete P0 unit (all 8 requirements, 40/40, per its
own commit message). `server/.env` is gitignored — secret never enters the tree.

## State

P0 unit: SHIPPED (your confirmation + my live re-verification, both sides agree).
9lives: red-team probe residue per cycle-3 report — purged in 016 (committed), letter-first
regex live in routes.js + loader.js (committed).
pack.dpdp: unblocked, ready to start on your go.

---

## ADDENDUM 2 — your unit-2 re-send (the one genuine gap: full live HMAC round-trip)

Your re-send of the unit-2 override named the one piece of live evidence I had not yet
produced: a **complete valid-HMAC → 200 round-trip on the live box** (016 had purged the
only paymentId, so my live runs stopped at 401/404). Closed this turn:

```
1) VALID HMAC            → 200 {"ok":true,"outcome":"fact recorded; settlement is kernel-only (staff confirm)"}
2) ONE-BYTE-TAMPERED SIG → 401 {"error":"invalid signature"}
3) EXACT REPLAY          → 200 {"ok":true,"outcome":"replay no-op (event already recorded); …"}
DB after: webhook rows 1 (verified=true) · spine events 1 · audit rows 1  ← dedupe proven live
```

(Valid-signature payload was built on a real paymentId via the finance links door; the
secret came from `server/.env` inside the verification script only — never printed.)

### Bonus find + fix: links door 23505 → 500 on duplicate open attempt

The round-trip exposed a real bug the suite missed: POST /links on an obligation that
already has an `initiated` payment (my earlier live-verify row) hit the
`payments_one_open_per_obligation` unique constraint as a raw 500 instead of a friendly
conflict. Fixed: the door now pre-checks and returns **409 with the existing paymentId**
(recoverable — the caller can poll/confirm that payment), and a new **test 5** pins
200 → 409 → 409 stability. Suite: **41/41**. Two-shell restart performed; the 409 verified
live in the same run.

### Ledger for your cycle-4 planning

- Test count: 25 original + 6 wave-1 + 4 loader + 1 tally + **5 upi** = **41/41**.
- The links-door 409 fix is **uncommitted** in my lane (index.js + upi.test.js) — git lane
  when convenient. Everything else from the P0 unit is already in `85f9909` and later.
- Migrations: 015 upi · 016 rt3 residue · 017 forged-window. Next free: **018**.
- Ready for red-team cycle 4: the HMAC attack chain (unsigned → 401/403, tampered → 401,
  replayed → no-op, stale → 400, malformed → 400, lifecycle → 409) is fully armed on the
  live box; the links door is the newest surface (409 path).
- Next in my queue per your sequence: **admissions.funnel** (needs migration 018) — say go.
