-- 017: forged-window residue cleanup (plugindev unit #2, post-P0)
-- The four webhook facts below were recorded by the PRE-hardening fail-open handler
-- during the vulnerable window (verified=false, unsigned), including the
-- orchestrator's live P0 repro rows (evt_orchrepro1 @ 17:21, evt_orch2 @ 18:11 IST)
-- and one dev-mode verification fact from the fix lane itself (pay_liveverify1).
-- The hardened gate chain (fail-closed HMAC over raw bytes) has been live since the
-- 19:49 restart; the current box rejects all of these shapes (401/403).
-- Audit ledger rows for these events are RETAINED (append-only — they document the
-- vulnerability window); this purges only the facts table, the event-spine copies,
-- and their outbox rows (outbox first — FK outbox_event_id_fkey).

DELETE FROM plugin_upi.webhook_log
WHERE event_id IN ('evt_orchrepro1', 'evt_orch2', 'evt_gate3', 'pay_liveverify1');

DELETE FROM app.outbox
WHERE payload->>'eventId' IN ('evt_orchrepro1', 'evt_orch2', 'evt_gate3', 'pay_liveverify1');

DELETE FROM app.events
WHERE label LIKE '%webhook fact recorded (evt\_orchrepro1)%'
   OR label LIKE '%webhook fact recorded (evt\_orch2)%'
   OR label LIKE '%webhook fact recorded (evt\_gate3)%'
   OR label LIKE '%webhook fact recorded (pay\_liveverify1)%';

-- Guarded ledger entry (hash chain as 001/009-016) — once per tenant that had such rows.
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'registry-cleanup-forged-window@1')
  AND EXISTS (
    SELECT 1 FROM app.audit_log y
    WHERE y.tenant_id = t.id AND y.actor_role = 'plugin:payments.upi'
      AND y.action LIKE 'UPI webhook%' AND y.outcome LIKE '%dev mode%')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 017 (registry cleanup)","actorRole":"system","action":"Forged-window cleanup: evt_orchrepro1 · evt_orch2 · evt_gate3 · pay_liveverify1 (pre-hardening unsigned facts)","recordType":"Plugin","recordRef":"registry-cleanup-forged-window@1","outcome":"P0 vulnerable-window facts purged · audit ledger retained append-only · fail-closed HMAC live since 19:49 restart","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 017 (registry cleanup)', 'system',
  'Forged-window cleanup: pre-hardening unsigned webhook facts',
  'Plugin', 'registry-cleanup-forged-window@1',
  'post-P0 residue purge (orchestrator repro rows + dev-verification fact)',
  'Platform §3.1 (plugin governance) · Fees §4.2', false, 'low',
  'vulnerable-window facts purged · audit ledger retained · fail-closed gate chain live',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
