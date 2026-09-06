-- 012: plugin registry cleanup — red-team cycle-2 P1-4 (plugindev unit, orchestrator-directed)
-- Purges test/probe residue rows from app.plugins so every environment converges to the
-- catalog truth. Rows removed (all created via the public API during red-team cycles;
-- none are seeded by any migration — verified: no migration/seed/commit references them):
--   zz.redteam.probe, zz.redteam.oversize (carried an ~800KB manifest), zz.redteam.race,
--   "../../kernel" (the P1-1 traversal repro row), com.rtprobe.test (runtime-created,
--   never seeded; purged per orchestrator directive — see handoff alert).
-- Idempotent: deleting already-absent rows is a no-op; safe to replay on any environment.
-- NOT added to seed.js replay: seed TRUNCATEs app.tenants CASCADE (all plugin rows die
-- with it) and replays the catalog migrations, so a fresh seed never contains these rows.

DELETE FROM app.plugins
WHERE plugin_id IN ('zz.redteam.probe', 'zz.redteam.oversize', 'zz.redteam.race', '../../kernel', 'com.rtprobe.test');

-- Guarded audit entry (same hash chain as 001/009/010/011) — one per tenant that
-- actually had residue, so the purge itself is on the ledger.
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  -- exactly once per tenant that actually had residue (audit evidence persists
  -- after the DELETE, so replay can never re-emit the ledger entry)
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'registry-cleanup@1')
  AND EXISTS (
    SELECT 1 FROM app.audit_log y
    WHERE y.tenant_id = t.id AND y.record_type = 'Plugin'
      AND (y.record_ref LIKE 'zz.redteam%' OR y.record_ref = 'com.rtprobe.test@1.0.0'
           OR y.record_ref = '../../kernel@1.0.0' OR y.record_ref = '../../kernel'))
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 012 (registry cleanup)","actorRole":"system","action":"Plugin registry cleanup: zz.redteam.probe · zz.redteam.oversize · zz.redteam.race · ../../kernel · com.rtprobe.test","recordType":"Plugin","recordRef":"registry-cleanup@1","outcome":"test/probe residue purged · com.rtprobe.test runtime-origin purged and escalated to orchestrator · catalog truth restored","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 012 (registry cleanup)', 'system',
  'Plugin registry cleanup: zz.redteam.* · ../../kernel · com.rtprobe.test',
  'Plugin', 'registry-cleanup@1',
  'red-team cycle-2 P1-4: purge test residue; runtime-origin row escalated per orchestrator directive',
  'Platform §3.1 (plugin governance)', false, 'low',
  'test/probe residue purged · com.rtprobe.test runtime-origin purged and escalated to orchestrator · catalog truth restored',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
