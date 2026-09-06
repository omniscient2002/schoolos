FROM: plugin-agent
TO: orchestrator
UNIT: P0 override — payments.upi webhook hardening (red-team cycle-3, all 8 blocking requirements)
STATUS: complete · 40/40 tests · all gates live-verified on :8080 · boot guard proven
DATE: 2026-09-06

---

## All 8 blocking requirements — implemented, tested, live-verified

| # | Requirement | Implementation | Test | Live |
|---|---|---|---|---|
| 1 | Fail-closed HMAC | Gate order: secret unset → **403 'webhook not configured'** (route OFF, no dev-acceptance mode); set → missing sig **401 'signature required'**, invalid sig **401 'invalid signature'**. **Boot guard** (`onReady`): payments.upi enabled + secret absent → boot REFUSED (exit 1, JWT_SECRET pattern). Allow-path verified live; refusal path proven by forcing the env empty on a supervised boot: `boot refused: UPI_WEBHOOK_SECRET must be set while payments.upi is enabled (Fees §4.2 …)`. | upi.test 1 | ✅ 403/401/401 + boot refusal |
| 2 | Raw-bytes MAC | `addContentTypeParser('application/json', {parseAs:'buffer'})` stores the untouched body on `req.rawBody`; HMAC runs over those bytes. Real Razorpay signatures (wire bytes) now verify; re-serialization is gone. | upi.test 2 (HMAC over exact JSON) | ✅ valid HMAC accepted |
| 3 | Spine+audit dedupe | Single `INSERT … ON CONFLICT (tenant_id, event_id) DO NOTHING RETURNING id` is the ticket: `emitEvent` and `requestAudit` run only when the row lands. Replay → 200 `replay no-op`, **zero** new spine/audit rows. | upi.test 2 (counts: log=1, events=1, audit=1) | by test |
| 4 | Freshness | Gateway `created_at` checked against `settings.webhook_freshness_mins` (default 15, schema-clamped 1–120). Stale → 400 `stale event rejected`. | upi.test 2 (−1h event → 400) | by test |
| 5 | JSON guard | Content-parser wraps parse → 400; gate 3 wraps the signed raw-string parse → 400 `malformed payload`. **My own live run exposed the gap the red team's unsigned repro missed: garbage + VALID HMAC was still 500** — fixed and now pinned with exactly that shape. | upi.test 3 | ✅ 400 both shapes |
| 6 | Lifecycle gate | Webhook resolves the plugin row: `registered`/disabled → **409** before any fact write (redteam P2-1 promoted into the gate chain). | upi.test 2 (409 while registered) | by test |
| 7 | Letter-first ids | `^[a-z][a-z0-9.-]{2,63}$` on routes AND loader — `9lives`-class digit-run ids now bounce. | upi.test 4 | ✅ 9lives + 1abc.def → 400 |
| 8 | Residue cleanup | **`migrations/016_redteam3_cleanup.sql`** (014/015 taken — exams.assessment registration, payments.upi). Deletes: `9lives`, `evt_rt3_*` webhook facts, rt3 event-spine + outbox rows (outbox FIRST — FK `outbox_event_id_fkey`), the orphan payment `40e049cb…` (status-initiated guard). **Audit ledger rows RETAINED (append-only)**, guarded ledger entry once per tenant with residue. Applied: 9lives 1→0, rt3 facts 8→0, rt3 events 10→0, orphan 1→0, audit kept 15. Replay-safe; seed replay list += 016. | dev DB counts | ✅ residue 0 |

## Test math

**25 original + 6 wave-1 + 4 loader + 1 tally + 4 upi (was 1 — expanded into 4 for the gate chain) = 40/40.** No original test was removed; the wave-1 upi section was UPDATED from dev-unsigned acceptance to the fail-closed posture (secret forced empty in its `before()`), per your direction that no dev door ships on this route.

## Live verification (:8080, two-shell restart, secret loaded from .env — value never printed)

```
R1 unsigned (your exact repro shape, real paymentId) → 401 signature required
R1 invalid signature                                 → 401 invalid signature
R2 valid HMAC (purged paymentId)                     → 404 payment not found
R5 garbage + valid HMAC over raw bytes               → 400 malformed payload
R7 9lives / 1abc.def enable                          → 400 invalid plugin id
R8 residue census (plugins view)                     → 0
api.log errors: 0
```

## Notes for the record

- `UPI_WEBHOOK_SECRET` generated (openssl rand-hex-32) into `server/.env` last turn and now load-bearing: the boot guard makes it mandatory while the rail is enabled. Value never printed anywhere; `.env` must stay gitignored.
- Red-team P2-1 (static, doors-not-lifecycle-gated) is now PARTIALLY closed by design: the upi webhook is lifecycle-gated (409). Other module doors (links/daybook/templates) remain role-gated-but-not-lifecycle-gated — either gate them uniformly or document the divergence; flagging for the next unit rather than silently changing door semantics.
- Red-team P2-2 (per-field length caps) also closed this unit: version ≤ 32 chars, each permission string ≤ 128 (routes.js), on top of the 64KB/413 manifest bound.
- credit where due: red team's "verified clean" on settlement-kernel-only was confirmed again under my own tests — the money invariant held throughout.

## Files (your git lane)

`src/plugins/payments.upi/index.js` (gate chain + raw parser + boot guard) · `src/plugins/payments.upi/manifest.js` (freshness setting) · `src/routes.js` + `src/plugins/loader.js` (letter-first regex) · `migrations/016_redteam3_cleanup.sql` (new) · `tests/upi.test.js` (1→4 tests) · `tests/wave1.test.js` (fail-closed posture) · `scripts/seed.js` (+016) · handoff: this file.

**Next:** transport.gps (017) + ops.timetable (018) migrations, then wave-2 admissions.funnel per the locked list.
