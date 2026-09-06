-- 016: red-team cycle-3 residue cleanup (plugindev unit #2, orchestrator-directed)
-- Itemized by redteam (handoff/2026-09-06-redteam-upi-webhook-plugins.md, all created
-- via the public API during their live cycle):
--   app.plugins           : '9lives' (digit-first id test row — disabled; digit-first
--                           ids are now rejected by the tightened letter-first regex)
--   plugin_upi.webhook_log: evt_rt3_u1, evt_rt3_b1, evt_rt3_rp, evt_rt3_spam_1..5
--   app.events (+outbox)  : 'payment.captured — webhook fact recorded (evt_rt3_*)'
--                           and the orphan payment's 'payment.link.created'
--   app.payments          : 40e049cb-688c-4ac1-af98-cafaf6cdafc6 (status initiated,
--                           created via the legit finance door solely to obtain a real
--                           paymentId; no money moved — settlement untouched)
--   comms.whatsapp settings: already restored by red team (verified)
-- The audit LEDGER is append-only: rt3 audit rows are retained (compliance surface);
-- this migration deletes only the event-spine copies, the webhook facts, and the
-- orphan payment. Idempotent: deleting absent rows is a no-op.

DELETE FROM app.plugins WHERE plugin_id = '9lives';

DELETE FROM plugin_upi.webhook_log WHERE event_id LIKE 'evt\_rt3\_%';

-- outbox first (outbox_event_id_fkey → events.id), then the spine rows
DELETE FROM app.outbox
WHERE (topic = 'payment.captured' AND payload->>'eventId' LIKE 'evt\_rt3\_%')
   OR (topic = 'payment.link.created' AND payload->>'paymentId' = '40e049cb-688c-4ac1-af98-cafaf6cdafc6');

DELETE FROM app.events
WHERE (type = 'fees' AND label LIKE 'payment.captured — webhook fact recorded (evt\_rt3\_%)')
   OR (type = 'fees' AND label LIKE 'payment.link.created%' AND ref = '40e049cb-688c-4ac1-af98-cafaf6cdafc6');

DELETE FROM app.payments WHERE id = '40e049cb-688c-4ac1-af98-cafaf6cdafc6' AND status = 'initiated';

-- Guarded ledger entry (hash chain as 001/009-015) — once per tenant that carried residue.
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'registry-cleanup-rt3@1')
  AND EXISTS (
    SELECT 1 FROM app.audit_log y
    WHERE y.tenant_id = t.id AND y.record_type = 'Payment'
      AND (y.record_ref = '40e049cb-688c-4ac1-af98-cafaf6cdafc6' OR y.action LIKE 'UPI webhook%'))
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 016 (registry cleanup)","actorRole":"system","action":"Registry cleanup rt3: 9lives · evt_rt3_* webhook facts · rt3 event-spine rows · orphan payment 40e049cb","recordType":"Plugin","recordRef":"registry-cleanup-rt3@1","outcome":"red-team cycle-3 residue purged per itemized list · audit ledger retained (append-only) · letter-first id regex tightened","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 016 (registry cleanup)', 'system',
  'Registry cleanup rt3: 9lives · evt_rt3_* facts · rt3 events · orphan payment',
  'Plugin', 'registry-cleanup-rt3@1',
  'red-team cycle-3 residue cleanup per itemized list (audit ledger retained)',
  'Platform §3.1 (plugin governance)', false, 'low',
  'rt3 residue purged · audit ledger retained append-only · letter-first id regex enforced',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
