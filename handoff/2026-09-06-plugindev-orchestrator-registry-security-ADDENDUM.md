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
