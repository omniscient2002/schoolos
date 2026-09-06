FROM: redteam
TO: plugin-agent
CC: orchestrator
STATUS: action-requested
DATE: 2026-09-06
CYCLE: 2 — plugin registry + migration 009/010 surface (wider sweep requested by orchestrator)
METHOD: live black-box probes with real role tokens (owner / itadmin / teacher / coordinator / parent — all seeded `schoolos-demo`), plus static review of `server/src/routes.js`, `server/migrations/009`, `010`. All repros executed against 127.0.0.1:8080.

---

## P1 — fix now

### P1-1 · `:id` is accepted verbatim — registry pollution via path-traversal-style plugin IDs
**Files:** `server/src/routes.js:511-531` (`POST /plugins/:id/enable` — `req.params.id` upserted with zero format validation; same pattern at `:id/disable` routes.js:533-550 and `:id/settings` routes.js:552+).
**Impact:** Any owner/itadmin-shaped request can mint registry rows whose IDs break every consumer's assumptions: the kernel mirror keys routes/slots by plugin_id, and anything that later joins plugin-owned paths/tables (`plugin_<id>.*` per docs/11 §9, migration 010) on that string inherits the malformed key. Today it's an integrity/validation bug; if a future plugin runtime ever derives a schema or file path from `plugin_id`, it becomes traversal.
**Repro (executed):**
```
curl -X POST http://127.0.0.1:8080/plugins/..%2F..%2Fkernel/enable \
  -H "Authorization: Bearer <owner token>" -H 'Content-Type: application/json' -d '{"class":"A"}'
→ 200 {"plugin":{"plugin_id":"../../kernel","status":"enabled",…}}
GET /plugins → row listed with plugin_id "../../kernel"
```
(Cleaned: row disabled via `/plugins/../../kernel/disable` → 200; the row itself persists until reseed — no DELETE endpoint exists, see INFO-3.)
**Fix:** validate `:id` on all three plugin routes, e.g. `if (!/^[a-z][a-z0-9._-]{2,63}$/.test(req.params.id)) return bad(reply,'invalid plugin id');` — matches the existing catalog namespace (`comms.whatsapp`, `pack.cbse`, `ops.timetable`).

### P1-2 · Plugin `settings` are readable by every authenticated role — credential-storage design says this column will hold secrets
**Files:** `server/src/routes.js:499-509` — `GET /plugins` (`preHandler: me`) SELECTs `settings` for all rows; write side is owner/itadmin-only (`:id/settings`, routes.js:552). Migration `009_school_plugin_catalog.sql` header explicitly designs settings to hold "BSP keys, gateway keys, GPS vendor credentials".
**Impact:** As soon as any real credential lands in settings (which 009 says is the plan), every role — parent, student, technician — reads it in cleartext through the same endpoint the Plugin Manager uses. Verified end-to-end with a canary.
**Repro (executed):**
```
# as owner: POST /plugins/pack.cbse/settings {"redteam_canary":"SECRET-CANARY-9f3"} → 200
# as parent: GET /plugins →
  "pack.cbse" settings: {"redteam_canary":"SECRET-CANARY-9f3"}   # read back verbatim
# restored: owner wrote {} afterwards (canary cleared)
```
**Fix:** either role-gate the column (`settings` only serialized for owner/itadmin in GET /plugins) or move secrets to an encrypted column redacted on read, returning only `settings_schema` + a `configured: boolean` flag to lesser roles.

---

## P2 — polish

### P2-1 · No size/validation bound on `manifest` / `version` / `permissions`
**Files:** `routes.js:512-527` — `manifest ?? known?.manifest ?? {}` stringified straight into jsonb; `version ?? '1.0.0'` accepted as any string; Fastify's global 1MB body cap is the only limit.
**Repro (executed):** `POST /plugins/zz.redteam.oversize/enable` with an ~800KB manifest blob → `200`, stored and echoed back in full on every subsequent `GET /plugins` (row persistently carries an 800KB manifest — mine is disabled but still listed; the 5MB variant is cleanly rejected `413`).
**Fix:** validate `version` against semver, cap `manifest` (e.g. ≤64KB) and `permissions` array length; return 413/400 with the existing `bad()` helper.

### P2-2 · Foreign test row in the live registry — confirm and purge
`GET /plugins` currently lists `com.rtprobe.test` with `status:'enabled'` — **not created by redteam** (my probes used only `zz.redteam.*` and `../../kernel`). If it's your smoke-test fixture, disable/purge it; if not, it means someone else holds owner/itadmin credentials against this box and should be identified. (The kernel mirror reads `enabled` rows on mount — an unknown enabled plugin is live surface.)

### P2-3 · Enable race is safe; disable leaves disabled rows listed (no purge path)
5 concurrent `POST /plugins/zz.redteam.race/enable` → all `200`, exactly one row (`ON CONFLICT DO UPDATE` handles it — no corruption, no 500s). `POST /:id/disable` follows the drain protocol and sets status only; rows accumulate forever (`routes.js:545`). Acceptable for demo, but consider a purge/decommission state once the lifecycle hardens.

---

## Verified clean (no action)
- **Authorization matrix:** `GET /plugins` any authenticated role (owner/teacher/parent/coordinator all 200 with 9 catalog rows + 18 capability contracts — read-only governance data); `enable` → owner 200, itadmin 200, teacher/parent/coordinator `403 {"error":"role <x> not permitted"}` (routes.js:511 `require('owner','itadmin')`). RLS scope note: parent sees the full registry despite `parentOfOnly` scope — fine for platform-level rows, revisit if manifests ever embed tenant data.
- **Manifest preservation on bare enable:** enabling with no manifest body preserved the server-side catalog manifest (routes.js:517,525 — the 009 "registry is the truth" contract holds; verified via the 1443–2264-byte manifests intact on `comms.whatsapp`, `payments.upi`, etc.).
- **`/events/lineage`:** anon 401; `correlation` regex-guarded before the uuid cast (routes.js:485 — no 500 on garbage); `limit` clamped to 100 (routes.js:484).
- **Migration 009/010 idempotency (static):** both files are explicitly replay-safe — `CREATE TABLE IF NOT EXISTS`, `INSERT … SELECT … WHERE NOT EXISTS` (009 documents why NOT-EXISTS beats ON CONFLICT for NULL-keyed platform rows), and the seed-replay contract in the file headers. **I could not replay them live** (redteam scope forbids restarts/DB writes); the static pattern is sound. If you want dynamic proof, run the migration script twice against a scratch database.

## Test residue disclosure (my writes, all via the public API, all disabled)
`zz.redteam.probe`, `zz.redteam.oversize` (retains an 800KB manifest), `zz.redteam.race`, `../../kernel` — all set to `disabled` via the drain endpoint; rows remain listed until a reseed (scripts/seed.js TRUNCATEs). The `pack.cbse` settings canary was cleared to `{}`. No catalog rows were enabled, modified, or overwritten.

---

## Verdict
**FIX-FIRST** — P1-1 (id validation) and P1-2 (settings exposure) are small, surgical fixes on the three plugin routes; everything else on the surface held up under attack.
