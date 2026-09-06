FROM: plugin-agent
TO: orchestrator
UNIT: wave-1 #1 — comms.whatsapp (factory charter: decoupled plugin architecture)
STATUS: complete · 35/35 server tests green · live on :8080
DATE: 2026-09-06

---

## 0. Red-team input (addressed first, per charter §5)

Read `handoff/2026-09-06-redteam-plugins-surface.md` (TO: plugin-agent) before coding:

| Finding | Status | Where |
|---|---|---|
| **P1-1** registry id validation (path-traversal-style ids minted rows) | **FIXED + regression-tested** | `routes.js` — `PLUGIN_ID_RE = /^[a-z][a-z0-9._-]{2,63}$/` + `pluginGuard` on enable/disable/settings; loader also rejects bad ids at drop-in time. Residue rows (`../../kernel`, `zz.redteam.*`) stay listed until reseed — they are `disabled`, so no live surface; a reseed clears them. |
| **P1-2** settings column readable by every role (credential exposure) | **FIXED + regression-tested** | `GET /plugins` now serializes `settings` only to owner/itadmin; lesser roles get `settings: undefined` + `configured: bool` + `settings_schema` (from the manifest). Canary repro in tests asserts zero leakage to teacher, owner still sees the value. |
| **P2-1** no bounds on manifest/version/permissions | **FIXED + regression-tested** | enable door: semver version, manifest ≤ 64KB (413), permissions string-array ≤ 32. |
| **P2-2** foreign `com.rtprobe.test` row enabled | **NOT MINE — flagged** | Predates my units; I did not touch it (could be another lane's fixture). **Orchestrator: confirm + disable or document.** |
| **P2-3** disable leaves rows listed (no purge) | accepted for demo, noted | Drain protocol keeps rows (lineage/audit integrity). Purge/decommission state = future unit. |

Red team's "verified clean" notes confirmed the manifest-preservation fix and RLS matrix held under attack.

## 1. The plugin factory is now real (charter §2)

**The one thin hook** (`app.js`, ~10 lines): after `registerRoutes`, the kernel calls
`loadPlugins(app, { withUser, auditLog, emitEvent, requestAudit, q, require })`. That is the ONLY
plugin-aware code in core. `server/src/plugins/loader.js` (my lane) scans the directory, validates
each drop-in, and mounts it. **Adding plugin #7 = drop a folder + one migration + add its file to
the seed replay list. Zero core edits.**

Drop-in contract (enforced by the loader, fail-loud at boot):
```
server/src/plugins/<plugin-id>/
  manifest.js   — default-export manifest; manifest.id MUST equal the directory name
  index.js      — export function register(app, kernel)  // kernel: withUser/auditLog/emitEvent/requestAudit/q/require
```
Directory ids are validated against the same namespace regex the registry routes use, so a bad
folder fails at boot, never half-mounts.

## 2. Unit #1: comms.whatsapp

- `src/plugins/comms.whatsapp/{manifest.js,index.js}` — DLT template registry door (owner/itadmin),
  template list + receipts doors (staff roles). Zero kernel logic; templates live in registry
  settings; receipts read the kernel `app.communications` table. Headless-by-rule preserved.
- `migrations/011_comms_whatsapp.sql` — per-plugin migration: registry-row guard + `whatsapp.deliver`
  contract guard (both verbatim from 009) + guarded per-plugin audit entry (`comms.whatsapp@1.0.0`).
  Independently apply-able: on a bare kernel it provisions the plugin end-to-end; where 009 already
  did, every statement is a no-op. `seed.js` replay list now includes it.
- Structure note: the pre-charter wave-1 runtimes were a single blob (`plugins/wave1.js` wired from
  routes.js). This unit dissolved it into the four drop-in directories
  (`comms.whatsapp`, `payments.upi`, `transport.gps`, `ops.timetable`) so the loader is the only
  registration path. No behavior change — 31 pre-existing tests pass untouched.
- Their per-plugin migrations (012/013/014) land in their own units (#2/#3/#4).

## 3. Tests: 25 → 35 (charter §4 disclosure)

- 25 original: green, untouched.
- 6 wave-1 runtime tests (added pre-charter, previously reported): green.
- **+4 new this unit** (`tests/plugin-loader.test.js`), each tied to a requirement:
  1. loader mounts every drop-in door with zero core wiring (404-never assertion per plugin),
  2. loader validation fails loud (bad id / missing register) and a good fixture drop-in mounts,
  3. redteam P1-1 regression: traversal-style ids → 400, registry stays clean (+P2-1 bounds),
  4. redteam P1-2 regression: settings canary invisible to teacher, `configured` flag exposed, owner unaffected.
- **35/35 pass.**

## 4. Live verification (:8080, restarted via two-shell pkill law)

- `curl /plugins`: 13 plugins · 18 contracts — comms.whatsapp (B, enabled), payments.upi (B),
  transport.gps (B), ops.timetable (C) all present with correct classes; `enabled` flag correct.
- P1-1 live repro now 400; teacher `/plugins` view leaks no settings; owner view intact.
- api.log: 0 errors.

## 5. Platform finding worth the kernel team's attention

**Fastify 5 hangs requests when an `async` preHandler is followed by a sync preHandler that returns
`undefined` in the same route array** (pinned empirically: async auth hook + sync guard → request
never settles; making the guard `async` or merging hooks → 200). I hit this through the P1-2 test,
root-caused it with a minimal repro, and made `pluginGuard` async with a comment at the site.
Kernel/auth lanes should know: **in this codebase, every preHandler must be `async`.**

## 6. Scope compliance

Touched: `server/migrations/011_comms_whatsapp.sql` (new), `server/src/plugins/**` (loader + four
drop-ins + tests fixture cleanup), `server/src/app.js` (the one thin hook), `server/src/routes.js`
(removed old wiring; P1-1/P1-2/P2-1 fixes on the three plugin routes), `server/tests/*` (+1 file),
`server/scripts/seed.js` (replay list +1 line — factory infra, disclosed). **No app/src, no auth
files, no git, no UI restart. Only :8080 restarted (two-shell law).**

## 7. Next unit

**#2 payments.upi** — module split already in place from this unit's refactor; remaining: per-plugin
migration 012 (upi tables/contracts/audit guards from 010), seed replay entry, red-team regressions,
handoff. Then #3 transport.gps (013), #4 ops.timetable (014).
