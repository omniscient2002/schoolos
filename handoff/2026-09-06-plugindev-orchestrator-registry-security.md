FROM: plugin-agent
TO: orchestrator
UNIT: red-team cycle-2 — plugin registry security (P1-1..P1-4) + wave-1 progress
STATUS: complete · 35/35 server tests green · verification bar met live on :8080
DATE: 2026-09-06

---

## ⚠ ALERT — P1-3: com.rtprobe.test is runtime-origin (purged per your directive)

**Finding:** `com.rtprobe.test` is **NOT seeded by any migration**. Investigation (grep across
`server/migrations/`, `server/scripts/seed.js`, `server/tests/`; `git log --all -S "rtprobe"` =
empty; migrations history = 3 commits, none referencing it): it appeared at **runtime**.

**Provenance evidence (ledger):** enabled 2026-09-05 17:10:27 +05:30 · disabled 18:20:10 ·
re-enabled 18:23:04 — all three actions by an **authenticated owner-token session**
(actor `A. Meridian`, role `owner`, through `/plugins/:id/enable`). Manifest `{}` (empty).

**Assessment:** cannot attribute to a specific lane from the ledger — the window overlaps
yesterday's multi-lane activity (main thread / UI agent / my units), all sharing demo owner
credentials. The id pattern (`com.rtprobe.test`) reads like a deliberate runtime probe of the
plugin kernel/mirror enable path, not like an attacker artifact; empty manifest and no other
actions in the window support that. **Not proof of compromise — but unclaimed owner-token
activity.** Recommendations: (1) confirm which lane probed the enable path yesterday evening;
(2) if unclaimed, treat as a credential-hygiene incident — rotate the demo owner secret and
consider per-lane API identities. **Row purged** via migration 012 (below); ledger history kept
(append-only) so the trail remains inspectable.

## P1-1 — registry id validation (your exact pattern)

`/plugins/:id/enable|disable|settings` and the drop-in loader now both enforce
**`^[a-z0-9][a-z0-9.-]{2,63}$`** (my previous unit used `^[a-z][a-z0-9._-]{2,63}$` — yours allows
digit-first ids and excludes underscore; all catalog ids conform, so switching was safe).
400 `{error: "invalid plugin id"}` on miss. Regression test now pins **5 shapes**: `../../kernel`
(URL-encoded traversal), `UPPER.case`, `has space`, `x` (too short), `_underscore` (charset rule).
Live: `../../kernel/enable` → **400**; registry stays clean.

## P1-2 — settings confidentiality (option (a), your shape)

`GET /plugins` serializes `settings` **only** to owner/itadmin. Other roles get exactly
`{ hasSettings: bool, keys: [names only], settings_schema: <manifest-derived> }` — never values.
**Tradeoff, per your request:** option (b) (RLS/role-filtered column) is stronger at the storage
layer, but PostgreSQL column privileges can't vary per app-role on one connection pool without a
masking view per role — heavier plumbing for a single consumer today. Option (a) keeps values out
of every response; key names are exposed by design (your spec) and are not credentials.
Tests: teacher + **parent** (your verification bar) both see zero settings values; canary value
never appears in either response; owner view unchanged. Live: parent GET → `any settings values: none`.

## P1-4 — cleanup migration (numbering note)

You specified `011_plugin_registry_cleanup.sql` — **011 was already taken** by unit #1's
per-plugin migration (`011_comms_whatsapp.sql`, charter one-migration-per-plugin). The cleanup is
**`migrations/012_plugin_registry_cleanup.sql`**; wave-1 per-plugin migrations shift to 013+.
Content: DELETE (all tenants) of `zz.redteam.probe`, `zz.redteam.oversize` (the ~800KB-manifest
row), `zz.redteam.race`, `../../kernel`, `com.rtprobe.test` + a guarded hash-chained ledger entry
per tenant that actually had residue. Applied to dev DB: **5 rows → 0**; entry emitted for
meridian only (dps-rival had no residue — correct gating); replay = "migrations up to date"
(idempotent by construction and by migrate tracking). Not added to seed replay: fresh seed
TRUNCATEs tenant data and never recreates these rows.

## Verification bar (this unit)

- [x] validation test green (5 malformed shapes → 400, registry clean)
- [x] settings-strip test green (teacher + parent; `{hasSettings, keys}` shape; owner intact)
- [x] `GET /plugins` as parent live: no settings values
- [x] `../../kernel` → 400 live
- [x] cleanup migration 012 applied (5→0 rows, ledger entry, replay-safe)
- [x] wave-1 progress reported (below)
- [x] `npm test`: **35/35** (25 original + 6 wave-1 runtime + 4 loader; extended in place, count unchanged)

## Wave-1 progress (P2 standing work)

- **Unit #1 comms.whatsapp: DONE** — drop-in module + `manifest.js`, loader hook, migration 011,
  35/35, live on :8080, handoff `2026-09-06-plugindev-orchestrator-comms.whatsapp.md`.
- Platform finding from unit #1 (worth propagation): **Fastify 5 hangs a request when an async
  preHandler precedes a sync one returning undefined in the same route array** — `pluginGuard` is
  async with a comment at the site; kernel/auth lanes should adopt async-everywhere preHandlers.
- **Next: unit #2 payments.upi** (module already split during unit #1; migration 013, audit entry,
  seed replay entry, handoff).

## Scope compliance

Touched: `src/routes.js` (regex + P1-2 shape on the plugin switchboard), `src/plugins/loader.js`
(regex), `tests/plugin-loader.test.js` (extended, same count), `migrations/012_plugin_registry_cleanup.sql`
(new). No app/src, no auth files, no git writes, no UI restart; :8080 restarted via two-shell law.
Read-only git (`git log -S`, `git log --oneline -- migrations/`) used once, per your explicit grant.
