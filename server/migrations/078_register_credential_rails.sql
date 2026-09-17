-- 078 · register the three credential rails in the per-tenant plugin registry (PRD-4 / PLG-3)
--
-- THE DEFECT: rails.email, rails.sms and rails.whatsapp ship with complete manifests, settings contracts
-- and working send functions, and they are declared in app.capability_contracts (045). But they had NO row
-- in app.plugins for any tenant, so:
--   * the plugin manager listed 23 of 26 shipped plugins — the three rails could not be seen, enabled or
--     configured by any school;
--   * `/me/reset-request` gates on "does this tenant have a rails.email row": `SELECT 1 FROM app.plugins
--     WHERE tenant_id=$1 AND plugin_id='rails.email'` could NEVER match, so **self-service password reset
--     answered 503 for every tenant, forever** — a shipped feature that was unreachable by construction;
--   * the same absence silently forced the OTP and comms dispatchers onto the logger provider.
--
-- THE FIX: seed the same three rows here for tenants that already exist, and add them to
-- src/plugin-catalog.js so every tenant created afterwards by /onboard/signup gets them too (that module
-- exists precisely because "migrations only touched tenants existing at migration time").
--
-- STATUS stays 'registered' (OFF) on purpose: a rail is a credential holding an API key or SMTP password.
-- Switching one on stays an explicit owner action, and the channel gates in app.js require `status='enabled'`
-- so a school must consciously configure the channel before the platform claims it can reach anyone.
--
-- Idempotent by construction (WHERE NOT EXISTS), so migrate + seed replays land exactly one row per rail.
-- No schema change, no data rewrite, no RLS change: app.plugins already carries these columns.
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, entitlement, trust_level, event_budget, ai_budget)
SELECT t.id, v.plugin_id, '1.0.0', 'B', 'registered',
       jsonb_build_object('id', v.plugin_id, 'version', '1.0.0'),
       v.permissions, v.entitlement, 'T1',
       '{"events_per_min":60,"payload_max_bytes":65536,"subscriber_max":25,"fanout_max":50,"chain_depth_max":5,"replay_max":10000,"scheduled_per_day":1000}'::jsonb,
       '{"requests_per_day":200,"tokens_per_day":200000}'::jsonb
FROM app.tenants t
CROSS JOIN (VALUES
  ('rails.email',    '["comms.send","events.emit","audit.request"]'::jsonb, '{"plan":"rails","billing":"usage-metered"}'::jsonb),
  ('rails.sms',      '["comms.send","events.emit","audit.request"]'::jsonb, '{"plan":"rails","billing":"usage-metered"}'::jsonb),
  ('rails.whatsapp', '["comms.send","events.emit","audit.request"]'::jsonb, '{"plan":"rails","billing":"usage-metered"}'::jsonb)
) AS v(plugin_id, permissions, entitlement)
WHERE NOT EXISTS (
  SELECT 1 FROM app.plugins p WHERE p.tenant_id = t.id AND p.plugin_id = v.plugin_id
);

-- Same three rows for any tenant created between this migration and the next deploy are handled by
-- ensurePluginCatalog() at signup and by the self-heal in GET /plugins.
