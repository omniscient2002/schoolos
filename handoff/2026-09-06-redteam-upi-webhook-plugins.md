FROM: redteam
TO: plugin-agent
CC: orchestrator
STATUS: action-requested
DATE: 2026-09-06
CYCLE: 3 — payments.upi webhook (mounted ahead of migration 013) + comms.whatsapp template registry + plugin doors
METHOD: live black-box with real role tokens (owner/itadmin/finance/teacher/parent/coordinator/principal), plus read-only review of `src/plugins/payments.upi/index.js`, `src/plugins/comms.whatsapp/index.js`, `src/plugins/loader.js`. All repros executed against 127.0.0.1:8080 this cycle. Settlement invariant tested under direct attack and **held**.

---

## P0 — release-blocking (block the 013 ship until fixed)

### P0-1 · UPI webhook HMAC gate is presence-optional and fail-open — unauthenticated forged facts reach the event spine and audit ledger
**Files:** `src/plugins/payments.upi/index.js` webhook handler — `if (secret && sig) { …verify… }` then proceeds unconditionally to record facts, emit events, and write audit rows. `UPI_WEBHOOK_SECRET` is not set in `server/.env` (key list verified), and there is no production guard for its absence (contrast `config.js:37-39` JWT_SECRET boot refusal).
**Impact (executed, not hypothetical):** With the secret unset — the state this box is in, and the state any prod launch forgets into — *any* unauthenticated caller can write `plugin_upi.webhook_log` rows, emit `payment.captured` events into the kernel event spine, and append "gateway webhook" entries to the append-only audit ledger (labeled `risk: low`, outcome admits "dev mode (unsigned)"). Even **with** the secret set, a caller who simply *omits* `x-razorpay-signature` skips the check entirely (`secret && sig` is false) — the fact is still recorded (verified=false) and 200 returned; a real gateway always sends the header, so fail-closed is the only correct posture. The audit ledger is the compliance surface — forged entries are stored with attacker-controlled `event` type and eventId (only the 16KB payload slice is bounded). Rate limiting is the global 300/min/IP only.
**Repro (executed, verbatim shape):**
```
# real paymentId obtained via the legit finance door (POST /plugins/payments.upi/links)
curl -X POST http://127.0.0.1:8080/plugins/payments.upi/webhook -H 'Content-Type: application/json' \
  -d '{"eventId":"evt_rt3_u1","event":"payment.captured","paymentId":"40e049cb-688c-4ac1-af98-cafaf6cdafc6"}'
→ 200 {"ok":true,"outcome":"fact recorded; settlement is kernel-only (staff confirm)"}
# bogus signature header:
curl … -H 'x-razorpay-signature: deadbeef' -d '{"eventId":"evt_rt3_b1",…}'
→ 200 (secret unset ⇒ HMAC skipped; proves the gate never triggers here)
# 5× distinct eventIds, unsigned → 5×200; 12 redteam events visible in the last 100 lineage rows
GET /events/lineage?limit=100 → "payment.captured — webhook fact recorded (evt_rt3_spam_5)" … ×12
```
**Fix (do all three before 013 ships):**
1. Fail-closed when the secret exists: `if (secret) { if (!sig) return 401; …verify…; if (!verified) return 401; }` — header omission must never be an acceptance path.
2. Refuse unsigned in production: if `NODE_ENV === 'production' && !secret` → 503 at request time (or refuse boot, mirroring the JWT_SECRET guard).
3. Non-prod unsigned acceptance should be flag-gated like `OTP_DEV_ECHO` (e.g. `UPI_WEBHOOK_INSECURE_DEV=1`), not the default of an unset env var.
Also noted (code): HMAC uses `createHmac`+`timingSafeEqual` (good), but the raw-bytes fidelity is broken for real gateways — Fastify parses JSON and the handler re-serializes (`JSON.stringify(req.body)`) before MAC, so genuine Razorpay signatures (computed over the wire bytes) will not verify. When you wire the real provider, MAC over the untouched request stream.

### P1-1 · Replay "idempotency" dedupes the log row but re-fires every side effect
**Files:** same handler — `INSERT … ON CONFLICT (tenant_id, event_id) DO NOTHING` guards only `plugin_upi.webhook_log`; `emitEvent` + `requestAudit` run unconditionally afterwards. No timestamp/freshness window is checked (Razorpay docs recommend one).
**Repro (executed):** identical payload (eventId `evt_rt3_rp`) ×3 → 3×200, 3 separate event-spine rows + 3 audit entries, 1 webhook_log row. Today the events are facts-only, so impact is amplification/noise — but the moment any subscriber acts on `payment.captured`, replay multiplies real effects.
**Fix:** gate `emitEvent`/`requestAudit` on the insert actually landing (`… DO NOTHING RETURNING id` + rowCount check), and reject events older than a window using the gateway timestamp.

### P1-2 · `text/plain` garbage body → 500 "internal error"
**Files:** same handler — `JSON.parse(raw)` is unguarded when Fastify hands the body over as a string.
**Repro (executed):** `POST /plugins/payments.upi/webhook` with `Content-Type: text/plain`, body `not json at all` → **500** (global handler masks it; no stack leak, but a trivially malformed request should be 400, and 5xx noise trips observability).
**Fix:** wrap the parse in try/catch → `bad(reply,'malformed payload',400)` (or force `application/json` only via content-type constraint on the route).

---

## P2 — polish / design notes

### P2-1 · Plugin doors respond regardless of registry lifecycle state
The loader mounts every `src/plugins/<id>/` door unconditionally (`loader.js:18-49`); enable/disable is registry-only. None of the module doors check `app.plugins.status` — a `registered` (never-enabled) plugin's doors answer operational calls today. All wave-1 plugins happen to be `enabled` on this box so I could not demonstrate the divergence live without toggling catalog state (skipped as too intrusive for redteam scope) — this is a static finding. Per docs/12 the registry is the truth; either gate doors on status (409/404 when not enabled) or document explicitly that doors are role-gated-but-not-lifecycle-gated.

### P2-2 · Manifest-bounds bypass via `permissions` strings and digit-run `version`
`routes.js:542-544` bounds the manifest at 64KB and the permissions *array* at 32, but neither bounds individual permission-string length nor `version` length (`\d+` unbounded): `version: "1"+"0"*100000+".0.0"` or `permissions: ["A".repeat(500000)]` sail through to jsonb (still under the 1MB body cap). Owner/itadmin-only, so P2 — add per-field length caps while you're in there.

---

## Verified clean (attacked, no finding)
- **Settlement stays kernel-only — HELD under direct attack.** After 10+ forged `payment.captured` webhooks, the target obligation stayed `open` with `paid_cents: 0`; the handler never touches `app.payments`/obligations. The core money invariant of the unit is real.
- **Template write authz:** `POST /plugins/comms.whatsapp/templates` → teacher 403, parent 403 (owner 200) — `require('owner','itadmin')` is enforced (comms.whatsapp/index.js:11).
- **Template read authz:** parent GET templates → 403; finance GET receipts → 200 (staff list as designed, index.js:32-46).
- **Settings strip holds at module level:** parent's `/plugins` view shows `hasSettings:true, keys:["templates"]` and **no canary value** (owner wrote `zz.redteam3.canary` = "RB3-CANARY" into templates; the string never appeared in the parent response).
- **Template key injection:** hostile names (`x'); DROP TABLE app.plugins;--`, object-valued name) → 200 but parameterized via `$2::text`/`jsonb_build_object` — registry intact, keys stored as opaque strings.
- **Links door:** teacher → 403, finance → 200 on an unpaid obligation (finance/owner/principal as designed); already-settled obligation → clean 409.
- **plugin_id validation (your unit):** extended regression — 8 malformed shapes (your 5 + `-leading`, `has_underscore`, 71-char) all 400; loader regex matches route regex (loader.js:15).

---

## Residue disclosure (mine, all via public API; marked for migration 014)
- `app.plugins`: row `9lives` (digit-first id test) — **disabled**; cycle-2 `zz.redteam.*` rows confirmed already purged by 012.
- `plugin_upi.webhook_log`: 8 rows (`evt_rt3_u1`, `evt_rt3_b1`, `evt_rt3_rp`×1 after dedupe, `evt_rt3_spam_1..5`).
- `app.events`: ~12 rows labeled `payment.captured — webhook fact recorded (evt_rt3_*)`; matching `app.audit` "UPI webhook" entries.
- `app.payments`: one row `40e049cb-688c-4ac1-af98-cafaf6cdafc6` status `initiated` (obligation `e6ecac96-ff24-4e7f-bdbf-ddfe4f97ad20`, ₹185.00) + its `payment.link.created` event/audit — created through the legit finance door solely to obtain a real paymentId; safe to void (no money moved, settlement untouched).
- `comms.whatsapp.settings.templates`: hostile/canary keys **removed**; restored to pre-redteam state (only `transport_delay` remains — verified by GET after cleanup).
Suggested: migration `014_redteam3_cleanup` (next free number after your 013) to delete the above; all items are tagged `rt3`/`zz.redteam3`-adjacent.

## Scope compliance
No edits to app/src, server/src, server/migrations; no git; no kills/restarts. All mutations went through the public API with role tokens, are itemized above, and the WhatsApp settings restore is verified.
