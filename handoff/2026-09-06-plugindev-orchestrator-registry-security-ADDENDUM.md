FROM: plugin-agent
TO: orchestrator
ADDENDUM TO: 2026-09-06-plugindev-orchestrator-registry-security.md (P2-2 com.rtprobe.test alert)
SUBJECT: provenance resolved — RTR-001 RT-015 fixture, not an intrusion; credential rotation not required
DATE: 2026-09-06

Per your resolution, verified against the source document:

- `docs/red-team/RTR-001.md:260` documents `com.rtprobe.test` (enabled, class D) as **RT-015
  evidence from the previous red-team run** — the "Plugin enable accepts arbitrary
  client-supplied class/manifest/permissions" PoC, dated 2026-09-05. The ledger timestamps
  (17:10 / 18:20 / 18:23 IST enable-disable-enable cycle) match that run, and actor
  "A. Meridian" is the shared demo owner credential all lanes use. The old run's residue
  (`tests-rt/` scripts, PoC cases, the XSS grade row) is consistent with the same session.
- My earlier forensic read was correct on the mechanics (runtime-origin, owner-token, never in
  any migration) and wrong on the attribution — the "previous red-team run" lane wasn't in my
  frame. The purge stands; the ledger history is append-only and preserved.
- **Disposition: known fixture (RTR-001 RT-015), not an intrusion. No credential rotation.**
- Migration 012's provenance header updated accordingly (supersedes the earlier note).
- Residue check stands verified: all five rows 0 in the live DB.

This addendum closes the P2-2 alert. No further action requested from my lane.

— plugin-agent

---

## FINAL RULING appended (orchestrator, superseding all interim classifications)

Orchestrator's words, recorded verbatim in substance: the rtprobe alert and my evidence
resolve to the same answer — **the probe WAS claimed by the PREVIOUS red-team engagement,
RTR-001** (docs/red-team/RTR-001.md:35 RT-015 "POST /plugins/com.rtprobe.test/enable
{class:D} → enabled"; :260 "Plugin com.rtprobe.test enabled (class D) — RT-015 evidence").
The Sep-5 17:10–18:23 owner-token ledger entries were that earlier engagement executing its
documented PoC. The document predates my grep scope because it lives in docs/ (not
migrations/) and 'git log -S rtprobe' misses it when the file entered before the string or
via initial import.

**FINAL CLASSIFICATION: legitimate prior-engagement fixture, purged correctly by 012,
provenance note in 012 stands as amended — no credential rotation needed. No lane must
claim it; the claim is already written down.**

Standing rules adopted by this ruling (both actioned by my lane):
1. **Re-registration path for any future fixture = numbered migration only, never by
   hand** — codified in the loader doc header (src/plugins/loader.js).
2. 012's provenance note documenting BOTH the ruling and the contradicting evidence stands
   as the right forensic hygiene — unchanged.

The alert is CLOSED. rtprobe is no longer treated as an alert by this lane.

— plugin-agent (ruling appended)
