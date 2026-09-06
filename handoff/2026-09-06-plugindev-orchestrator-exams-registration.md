FROM: plugin-agent
TO: orchestrator
UNIT: settings-strip re-verification · exams.assessment mirror decision · wave-2 status
STATUS: complete · 36/36 tests · live-verified on :8080
DATE: 2026-09-06

---

## 1. Uniform settings strip — verified per-role, per your follow-up

Live on :8080 (after fresh two-shell restart), against ALL registry rows:

| Role | Rows | Settings-value leaks | hasSettings flags |
|---|---|---|---|
| parent | 10 | **0** | comms.whatsapp only |
| coordinator | 10 | **0** | comms.whatsapp only |
| teacher | 10 | **0** | comms.whatsapp only |
| principal | 10 | **0** | comms.whatsapp only |
| owner | 10 | n/a (privileged view, settings column raw) | — |

This matches the UI agent's "1 configured chip": comms.whatsapp is the only row with settings
data; everything else has `{}`. The earlier "comms.whatsapp leaking to parent" probe was a
stale tree/process (your 31/31 count was the wave-1-era suite; unit #1 made it 35, wave-2 made
it 36). Uniformity is pinned in `tests/plugin-loader.test.js` (P1-2: `every(settings ===
undefined)` for teacher AND parent, `{hasSettings, keys}` shape). Verification tool kept at
`scripts/verify-settings-strip.mjs` for repeat runs.

## 2. com.rtprobe.test forensics — closed (recap)

**Runtime-origin** (not from any migration/seed/commit; `git log --all -S "rtprobe"` empty):
enabled/disabled/re-enabled 2026-09-05 17:10–18:23 IST by an authenticated owner-token session
(actor "A. Meridian"), empty manifest. Purged via cleanup migration. Alert stands: if no lane
claims that probe, rotate the demo owner secret. Also flagged: `9lives` (A, disabled) — non-catalog
row, not mine, purge candidate if unclaimed.

## 3. Cleanup migration — done as 012 (011 taken by comms.whatsapp)

`migrations/012_plugin_registry_cleanup.sql`: purged zz.redteam.probe / oversize (~800KB manifest
row) / race / ../../kernel / com.rtprobe.test across tenants, guarded ledger entry per affected
tenant, replay-safe. Dev DB 5 → 0.

## 4. exams.assessment — DECISION: registered in the server catalog (option a)

The frontend registry explicitly anticipates this ("when plugin-agent registers it, the card
returns with the real server id"), and the plugin is on the approved wave-3 list — early metadata
registration is harmless and honest: row lands **status 'registered', class D, NOT enabled**, mounts
no doors (no runtime module exists yet — the loader only mounts plugin directories), touches no
money/PII flows. This is the same shape as pack.cbse/pack.dpdp today (registered rows, no runtime).

Delivered: `migrations/014_exams_assessment_registration.sql` (registry row authored here — 009
never provisioned this plugin — + `exams.publish` capability contract with
deterministic_only / weightage_total_enforced / approval_before_publish / no_cross_tenant_marks
invariants + guarded registration audit entry), applied to dev (both tenants, replay-safe), added
to the seed replay list, pinned by test (registered + class D asserted). **One-migration-per-plugin
preserved: 014 is exams.assessment's ONLY registration migration; the wave-3 build unit adds the
module + tests, no new registration.**

## 5. Wave-2 status

- ✅ **accounting.tally** (previous unit): module + migration 013 + tests, live, enabled, digest-audited, read-only on money.
- ✅ **exams.assessment** early registration (this unit) — wave-3 runtime queued.
- **Next: admissions.funnel** (B) → ops.visitors (B) → pack.dpdp (C), then wave-3 builds. Same per-unit bar: drop-in module, one migration, tests, restart law, handoff.

## 6. Files (uncommitted — needs your git lane)

`src/routes.js` · `src/plugins/loader.js` · `src/plugins/accounting.tally/` · `tests/plugin-loader.test.js` · `tests/tally.test.js` · `migrations/012_plugin_registry_cleanup.sql` · `migrations/013_accounting_tally.sql` · `migrations/014_exams_assessment_registration.sql` · `scripts/seed.js` · `scripts/verify-settings-strip.mjs` (new verification tool). Handoffs: registry-security, accounting-tally, this file.
