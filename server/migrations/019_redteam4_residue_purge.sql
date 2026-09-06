-- 019: red-team cycle-4 residue purge (plugindev, orchestrator-itemized FINAL numbering)
-- Cycle-4 verdict was SHIP (all 8 webhook requirements passed independent regression);
-- this purges the engagement's own probe artifacts, itemized:
--   app.plugins           : zz.redteam4.probe (registered via the door, left disabled)
--   plugin_upi.webhook_log: evt_rt4_raw1, evt_rt4_replay, evt_rt4_future,
--                           evt_rt4_lifecycle2, evt_rt4_after_reenable (signed probes)
--   app.events + app.outbox: the spine/outbox copies of those 5 events (outbox FIRST — FK)
--   app.payments          : 0dc7fc8a-3195-43b1-89c3-212ab5ff2d59 (initiated ₹18,500 —
--                           created via the legit finance door to obtain a paymentId)
--   plugin_transport_gps.positions: 83359fc7-c177-4336-bd85-5bfcf7f298ee (Route 11 probe)
-- The AUDIT LEDGER is append-only and stays: rt4 audit rows AND the disable/enable
-- state-restoration pairs the engagement used are retained (they document the
-- engagement and the gate behavior under attack).
-- Idempotent: deleting absent rows is a no-op.

DELETE FROM app.plugins WHERE plugin_id LIKE 'zz.redteam4%';

DELETE FROM plugin_upi.webhook_log WHERE event_id LIKE 'evt\_rt4\_%';

-- outbox first (outbox_event_id_fkey → events.id), then the spine rows
DELETE FROM app.outbox WHERE payload->>'eventId' LIKE 'evt\_rt4\_%';

DELETE FROM app.events WHERE label LIKE '%webhook fact recorded (evt\_rt4\_%';

DELETE FROM app.payments WHERE id = '0dc7fc8a-3195-43b1-89c3-212ab5ff2d59' AND status = 'initiated';

DELETE FROM plugin_transport_gps.positions WHERE id = '83359fc7-c177-4336-bd85-5bfcf7f298ee';

-- Guarded ledger entry (hash chain as 001/009-022) — once per tenant that carried residue.
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'registry-cleanup-rt4@1')
  AND EXISTS (
    SELECT 1 FROM app.audit_log y
    WHERE y.tenant_id = t.id AND (y.action LIKE '%rt4%' OR y.action LIKE '%redteam4%'
      OR y.record_ref LIKE 'zz.redteam4%' OR y.action LIKE '%zz.redteam4%'))
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 019 (registry cleanup)","actorRole":"system","action":"Registry cleanup rt4: zz.redteam4.probe · evt_rt4_* webhook facts · spine/outbox copies · orphan payment 0dc7fc8a · Route 11 probe position","recordType":"Plugin","recordRef":"registry-cleanup-rt4@1","outcome":"cycle-4 residue purged per itemized list · audit ledger retained append-only incl. state-restoration pairs · webhook unit re-verified SHIP by independent regression","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 019 (registry cleanup)', 'system',
  'Registry cleanup rt4: probe row · signed probe facts · orphan payment · GPS position',
  'Plugin', 'registry-cleanup-rt4@1',
  'cycle-4 residue purge per itemized list (audit ledger retained append-only)',
  'Platform §3.1 (plugin governance)', false, 'low',
  'rt4 residue purged · ledger retained · SHIP verdict re-confirmed',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
