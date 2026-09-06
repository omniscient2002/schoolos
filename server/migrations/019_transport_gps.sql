-- 019: transport.gps — per-plugin migration (plugin factory, docs/11 §2.2)
-- Unit: wave-1 completion · per-plugin provisioning discipline
--
-- Independence contract: idempotent like 011/013/015 — (a) no-ops where 009/010
-- already provisioned the artifacts, (b) fully provisions transport.gps on a bare
-- kernel. Registry row + gps.position.ingest contract copied VERBATIM from 009;
-- the positions DDL/RLS/grants copied verbatim from 010 §0/§4/§6/§10.
-- Runtime module: server/src/plugins/transport.gps/ (mounted by the loader).

-- ── 1. Plugin-owned schema + positions (verbatim DDL from 010 §0/§4) ───────────
CREATE SCHEMA IF NOT EXISTS plugin_transport_gps;
CREATE TABLE IF NOT EXISTS plugin_transport_gps.positions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id),
  route_code  text NOT NULL,
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  delay_mins  integer,
  deviation_m integer,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gps_pos_tenant_idx ON plugin_transport_gps.positions(tenant_id, route_code, occurred_at DESC);

-- RLS (verbatim policy shape from 010 §6)
DO $$
DECLARE sch text; tbl text;
BEGIN
  FOREACH sch IN ARRAY ARRAY['plugin_transport_gps'] LOOP
    tbl := 'positions';
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', sch, tbl);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', sch, tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', sch, tbl);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I.%I
      USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)$p$, sch, tbl);
  END LOOP;
END $$;

-- ── 2. Registry row (verbatim manifest from 009; status 'registered') ───────────
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, entitlement, trust_level, event_budget, ai_budget)
SELECT t.id, v.plugin_id, v.version, v.class, 'registered', v.manifest, v.permissions, v.entitlement, 'T1', v.event_budget, v.ai_budget
FROM app.tenants t
CROSS JOIN (VALUES
  ('transport.gps', '1.0.0', 'B',
   '{"id":"transport.gps","name":"Transport GPS","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"B","trust":"T1","description":"GPS vendor integration: live bus positions, route-deviation alerts and delay events feeding the transport plugin approval loop and guardian notifications. Deterministic-first: the delay guard (delay_minutes >= 10, Transport §3.1) fires before any AI.","permissions":["students.read","events.emit","audit.request"],"events":{"subscribe":[],"publish":[{"type":"gps.position","schema":"v1"},{"type":"transport.route_deviation","schema":"v1"},{"type":"transport.delay","schema":"v1"}]},"eventSubscriptions":[],"automation":{"triggers":[{"on":"gps.position","guard":"delay_minutes >= 10","then":{"raise_action":"notify_guardians","approval":"required","policy_ref":"Transport §3.1"}}]},"slots":["settings"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"vendor":{"type":"string","enum":["trackschoolbus","chalo","fleettrack","custom"],"default":"trackschoolbus","description":"GPS vendor adapter"},"api_key_ref":{"type":"string","description":"Vault reference for the vendor API key"},"poll_interval_secs":{"type":"integer","default":30,"minimum":10,"maximum":300,"description":"Position poll interval (event-budget capped)"},"deviation_threshold_m":{"type":"integer","default":500,"description":"Off-route distance that raises a deviation alert"},"delay_threshold_mins":{"type":"integer","default":10,"description":"Delay that raises an approval-required guardian notice (Transport §3.1)"}},"required":["vendor","api_key_ref"]},"data":{"schema":"plugin_transport_gps","core_refs":["routes.id","students.id"],"retention":{"positions_days":30,"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"rails","metered":["gps_pings"]},"dependencies":[],"defaultEnabled":false}'::jsonb,
   '["students.read","events.emit","audit.request"]'::jsonb,
   '{"plan":"rails","billing":"usage-metered"}'::jsonb,
   jsonb_build_object('events_per_min',240,'payload_max_bytes',65536,'subscriber_max',25,'fanout_max',50,'chain_depth_max',5,'replay_max',10000,'scheduled_per_day',100),
   '{}'::jsonb)
) AS v(plugin_id, version, class, manifest, permissions, entitlement, event_budget, ai_budget)
WHERE NOT EXISTS (
  SELECT 1 FROM app.plugins p WHERE p.tenant_id = t.id AND p.plugin_id = v.plugin_id);

-- ── 3. Capability contract: gps.position.ingest (verbatim from 009, guarded) ────
INSERT INTO app.capability_contracts (tenant_id, plugin_id, capability_id, version, kind, contract, enforced)
SELECT NULL, v.plugin_id, v.capability_id, v.version, v.kind, v.contract, v.enforced
FROM (VALUES
  ('transport.gps', 'gps.position.ingest', '1.0.0', 'capability',
   '{"description":"Vendor GPS ingestion: live bus positions normalized into the v2 event envelope; deterministic deviation and delay guards feed the transport plugin approval loop and guardian notifications. No AI in the guard.","read_scopes":["transport.read:routes","graph.read:students"],"write_scopes":["plugin_transport_gps.positions"],"event_outputs":["gps.position.v1","transport.route_deviation.v1","transport.delay.v1"],"side_effects":[{"type":"event.publish","approval":"never"},{"type":"action.raise","approval":"required","policy_ref":"Transport §3.1","guard":"delay_minutes >= 10"}],"policy_refs":["Transport §3.1"],"audit":{"level":"digest","includes":["route","position_digest","guard_decision"]},"data_classification":["internal","pii:guardian_contact"],"latency_sla":{"p95_ms":1500,"timeout_ms":5000},"idempotency":{"key":"event.id+handler","window":"24h"},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"digest","invariants":["deterministic_guard_before_ai","budget_enforced","breaker_enforced","positions_retained_30d"]}'::jsonb)
) AS v(plugin_id, capability_id, version, kind, contract, enforced)
WHERE NOT EXISTS (
  SELECT 1 FROM app.capability_contracts x
  WHERE x.tenant_id IS NULL AND x.capability_id = v.capability_id AND x.version = v.version);

-- ── 4. Grants (verbatim shape from 010 §10) ─────────────────────────────────────
GRANT USAGE ON SCHEMA plugin_transport_gps TO schoolos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plugin_transport_gps TO schoolos_app;

-- ── 5. Guarded ledger entry (same hash chain as 001/009-018) ────────────────────
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'transport.gps@1.0.0-perplugin')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"migration 019 (plugin factory)","actorRole":"system","action":"Plugin unit registered: transport.gps (wave-1 completion)","recordType":"Plugin","recordRef":"transport.gps@1.0.0-perplugin","outcome":"positions table + RLS + grants provisioned · registry row + gps.position.ingest contract verbatim from 009 · module src/plugins/transport.gps mounted by loader · uniform lifecycle gating live","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'migration 019 (plugin factory)', 'system',
  'Plugin unit registered: transport.gps (wave-1 completion)',
  'Plugin', 'transport.gps@1.0.0-perplugin',
  'per-plugin provisioning: positions DDL/RLS/grants + verbatim catalog row/contract',
  'Platform §3.1 (plugin governance)', false, 'low',
  'registered (not enabled) · plugin_transport_gps provisioned · module mounted by loader',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
