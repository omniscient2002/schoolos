-- 009: School plugin catalog — the six rails + policy packs designed in the
-- product/architecture sessions (docs/11 §2.2–§2.4), registered as REAL rows in
-- the plugin registry (app.plugins), not mock data:
--   comms.whatsapp · payments.upi · transport.gps · accounting.tally  (Class B, rails)
--   pack.cbse · pack.dpdp                                             (Class C, packs)
--
-- Lifecycle (docs/10 §6, docs/12 14-state): rows land as status 'registered' —
-- listed in the Plugin Manager and GET /plugins, NOT enabled. Enable is an
-- audited owner action (POST /plugins/:id/enable) that also requires settings
-- consent (BSP keys, gateway keys, GPS vendor credentials live in settings).
--
-- Every manifest carries the kernel contract: events consumed/emitted, scoped
-- permissions, headless UI slots (rails get Control Plane status only, docs/11
-- §2.3), settings schema, regions/residency, and money-touching guarantees where
-- applicable. Capability contracts for their requestable AI + runtime
-- capabilities are registered platform-level in app.capability_contracts
-- (docs/11 §7 capability catalog: draft.parent_message, summarize.day).
--
-- Idempotent by design: scripts/seed.js re-applies this whole file after its
-- TRUNCATE (the catalog is platform data that must survive a demo reseed), and
-- re-runs here are no-ops (conflict guards + NOT EXISTS everywhere).

-- ── 1. Capability contracts (platform-level: tenant_id NULL survives the seed
--       TRUNCATE because 007 dropped the FK) ─────────────────────────────────────
-- Guard with NOT EXISTS, not ON CONFLICT: the unique index (tenant_id,
-- capability_id, version) treats NULLs as distinct, so platform rows would
-- duplicate on re-run.
INSERT INTO app.capability_contracts (tenant_id, plugin_id, capability_id, version, kind, contract, enforced)
SELECT NULL, v.plugin_id, v.capability_id, v.version, v.kind, v.contract, v.enforced
FROM (VALUES
  -- comms.whatsapp — delivers approved orchestrator intents only (docs/11 §2.3)
  ('comms.whatsapp', 'whatsapp.deliver', '1.0.0', 'command',
   '{"description":"WhatsApp Business template delivery beneath the kernel Communication Orchestrator: accepts approved intents only (consent-gated per recipient, quiet hours, dedup), renders DLT-registered templates, emits delivery receipts. Headless rail — never sends directly.","read_scopes":["comms.read:templates","graph.read:students"],"write_scopes":["plugin_whatsapp.messages"],"event_inputs":["attendance.marked@>=1.0","fee.due@>=1.0","transport.delay@>=1.0"],"event_outputs":["whatsapp.receipt.v1"],"side_effects":[{"type":"comms.send","channel":"whatsapp.template","consent":"verified","policy_ref":"Comms §1.2"},{"type":"ledger.audit","approval":"never","policy_ref":"Platform §2.4"}],"policy_refs":["Comms §1.2"],"audit":{"level":"full","includes":["template","audience_digest","actor","approval","receipt"]},"data_classification":["pii:guardian_contact"],"latency_sla":{"p95_ms":2000,"timeout_ms":8000},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"full","invariants":["orchestrator_intent_required","consent_verified_per_recipient","quiet_hours_respected","dlt_template_registered","receipt_emitted"]}'::jsonb),
  -- payments.upi — money-touching: links + facts only, settle is kernel-only
  ('payments.upi', 'upi.payment.collect', '1.0.0', 'command',
   '{"description":"UPI collection rails via a Razorpay-style gateway: create payment links on fee obligations, verify signed webhooks, reconcile against the kernel fee ledger, Tally-ready export. Creates links and records facts; settlement confirm is staff-only through the kernel action spine.","read_scopes":["money.read:obligations"],"write_scopes":["plugin_upi.links","plugin_upi.webhooks"],"event_inputs":["fee.due@>=1.0"],"event_outputs":["payment.link.created.v1","payment.captured.v1","payment.failed.v1"],"side_effects":[{"type":"payment.link.create","approval":"never","policy_ref":"Fees §4.2"},{"type":"ledger.post","approval":"required","policy_ref":"Fees §4.2","note":"settle only via kernel fee.payment.settle (staff confirm)"}],"policy_refs":["Fees §4.2"],"audit":{"level":"full","includes":["actor","obligation","gateway_ref","webhook_verified"]},"data_classification":["financial","pii:guardian_contact"],"idempotency":{"key":"webhook.id","window":"24h"},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"full","invariants":["never_auto_moves_money","settle_kernel_only","webhook_signature_required","gateway_ref_honesty","paid_cents<=amount_cents"]}'::jsonb),
  -- transport.gps — deterministic guard before any AI or notice (Transport §3.1)
  ('transport.gps', 'gps.position.ingest', '1.0.0', 'capability',
   '{"description":"Vendor GPS ingestion: live bus positions normalized into the v2 event envelope; deterministic deviation and delay guards feed the transport plugin approval loop and guardian notifications. No AI in the guard.","read_scopes":["transport.read:routes","graph.read:students"],"write_scopes":["plugin_transport_gps.positions"],"event_outputs":["gps.position.v1","transport.route_deviation.v1","transport.delay.v1"],"side_effects":[{"type":"event.publish","approval":"never"},{"type":"action.raise","approval":"required","policy_ref":"Transport §3.1","guard":"delay_minutes >= 10"}],"policy_refs":["Transport §3.1"],"audit":{"level":"digest","includes":["route","position_digest","guard_decision"]},"data_classification":["internal","pii:guardian_contact"],"latency_sla":{"p95_ms":1500,"timeout_ms":5000},"idempotency":{"key":"event.id+handler","window":"24h"},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"digest","invariants":["deterministic_guard_before_ai","budget_enforced","breaker_enforced","positions_retained_30d"]}'::jsonb),
  -- accounting.tally — reads money, exports vouchers, never posts
  ('accounting.tally', 'tally.voucher.export', '1.0.0', 'command',
   '{"description":"Daily voucher export from the kernel fee ledger into Tally-ready output; ledger mapping is tenant settings. The plugin reads money and exports — it never posts to the ledger.","read_scopes":["money.read:obligations"],"write_scopes":["plugin_tally.exports"],"event_inputs":["payment.captured@>=1.0"],"event_outputs":["tally.export.completed.v1"],"side_effects":[{"type":"artifact.put","approval":"never","policy_ref":"Platform §5.2"}],"policy_refs":["Platform §5.2","Fees §4.2"],"audit":{"level":"digest","includes":["window","voucher_count","content_hash"]},"data_classification":["financial"],"latency_sla":{"p95_ms":5000,"timeout_ms":30000},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"digest","invariants":["read_only_on_ledger","scheduled_job_declared","voucher_totals_match_ledger"]}'::jsonb),
  -- pack.cbse — rules, not code; adds obligations, never relaxes safeguards
  ('pack.cbse', 'cbse.assessment.validate', '1.0.0', 'capability',
   '{"description":"Deterministic validation primitives from the CBSE pack: assessment weightage totals, report-card structure, board-calendar obligation checks consumed by the kernel Policy Engine. Rules, not code (docs/11 §2.4).","read_scopes":["plugin_cbse.calendar","attendance.read:section"],"write_scopes":["plugin_cbse.validation"],"event_outputs":["cbse.obligation.due.v1"],"side_effects":[{"type":"action.raise","approval":"required","policy_ref":"CBSE pack obligations","guard":"weightage_total <> 100"}],"policy_refs":["CBSE pack obligations","Platform §3 (plugin governance)"],"audit":{"level":"full","includes":["rule","inputs_digest","decision"]},"data_classification":["internal"],"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"full","invariants":["deterministic_only","adds_obligations_never_relaxes_safeguards","weightage_total_enforced"]}'::jsonb),
  -- pack.dpdp — consent ledger, residency hooks, SAR workflow
  ('pack.dpdp', 'dpdp.consent.ledger', '1.0.0', 'capability',
   '{"description":"DPDP Act 2023 compliance primitives: immutable consent artifacts per guardian, data-residency zone enforcement hooks (IN) consumed by the AI Gateway and storage, subject-access request workflow through the kernel action spine, retention schedule references.","read_scopes":["graph.read:students"],"write_scopes":["plugin_dpdp.consent","actions.raise"],"event_outputs":["consent.recorded.v1","sar.opened.v1","sar.fulfilled.v1"],"side_effects":[{"type":"action.raise","approval":"required","policy_ref":"DPDP Act 2023 · SAR"},{"type":"ledger.audit","approval":"never","policy_ref":"Platform §2.4"}],"policy_refs":["DPDP Act 2023 · consent and retention","Platform §2.4"],"audit":{"level":"full","includes":["actor","consent_digest","sar_state"]},"data_classification":["pii:guardian_contact","pii:student_records"],"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"full","invariants":["residency_zone_enforced","consent_immutable","sar_sla_tracked","retention_schedule_linked"]}'::jsonb),
  -- Kernel AI Gateway capabilities (docs/11 §7 catalog) — plugin_id NULL: owned
  -- by the gateway, requested BY plugins (comms.whatsapp), never by models
  (NULL, 'draft.parent_message', '1.0.0', 'capability',
   '{"description":"AI Gateway capability: drafts a guardian message from a deterministic trigger context. Transformation-only, grounded in scoped retrieval, PII-masked. Output is a DRAFT — sending rides comms.send with approval; a deterministic guard rule must exist before the request.","read_scopes":["graph.read:students","attendance.read:section"],"write_scopes":[],"side_effects":[{"type":"comms.draft","approval":"required","policy_ref":"Comms §1.2"}],"policy_refs":["Comms §1.2","Platform §2.4"],"audit":{"level":"full","includes":["capability","trace_id","grounding_refs","guard_rule"]},"data_classification":["pii:guardian_contact"],"ai_eligibility":{"modes":["transformation"],"grounding":"required","pii_masking":true,"budget_enforced":true},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"full","invariants":["draft_only_never_sends","grounding_required","deterministic_guard_precedes_request","pii_masked_in_prompt","budget_enforced"]}'::jsonb),
  (NULL, 'summarize.day', '1.0.0', 'capability',
   '{"description":"AI Gateway capability: tenant-scoped day and attention summaries. Read-only transformation over scoped retrieval; no side effects; graceful degradation when the AI budget is exhausted.","read_scopes":["attendance.read:own_tenant","fees.read:own_tenant"],"write_scopes":[],"side_effects":[],"policy_refs":["Platform §2.4"],"audit":{"level":"digest","includes":["capability","trace_id","window"]},"data_classification":["pii:student_records","internal"],"ai_eligibility":{"modes":["summarization"],"grounding":"required","pii_masking":true,"budget_enforced":true},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb,
   '{"audit":"digest","invariants":["read_only","tenant_scoped_grounding","budget_enforced"]}'::jsonb)
) AS v(plugin_id, capability_id, version, kind, contract, enforced)
WHERE NOT EXISTS (
  SELECT 1 FROM app.capability_contracts x
  WHERE x.tenant_id IS NULL AND x.capability_id = v.capability_id AND x.version = v.version);

-- ── 2. The catalog itself — real registry rows, per tenant, status 'registered'.
--       Permissions column uses the docs/10 §4 kernel vocabulary (the same array
--       POST /plugins/:id/enable persists); manifest.events + automation use the
--       docs/11 §4 envelope. Rails are headless: settings slot only (docs/11 §2.3).
INSERT INTO app.plugins (tenant_id, plugin_id, version, class, status, manifest, permissions, entitlement, trust_level, event_budget, ai_budget)
SELECT t.id, v.plugin_id, v.version, v.class, 'registered', v.manifest, v.permissions, v.entitlement, 'T1', v.event_budget, v.ai_budget
FROM app.tenants t
CROSS JOIN (VALUES
  ('comms.whatsapp', '1.0.0', 'B',
   '{"id":"comms.whatsapp","name":"WhatsApp Business Rails","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"B","trust":"T1","description":"WhatsApp Business rails (BSP adapter) beneath the kernel Communication Orchestrator: digest delivery with UPI pay buttons, guardian notifications, template management, DLT compliance. Headless by rule (docs/11 §2.3) — delivers approved orchestrator intents only, never sends directly.","permissions":["students.read","attendance.read","fees.read","comms.send","events.emit","audit.request"],"events":{"subscribe":[{"type":"attendance.marked","schema":">=1.0 <2"},{"type":"fee.due","schema":">=1.0 <2"},{"type":"transport.delay","schema":">=1.0 <2"}],"publish":[{"type":"whatsapp.receipt","schema":"v1"}]},"eventSubscriptions":["attendance.marked","fee.due","transport.delay"],"ai":{"request":["draft.parent_message","summarize.day"],"modes":["transformation"],"grounding":"required","note":"capabilities, never models — deterministic guard precedes any draft (docs/11 §7)"},"slots":["settings"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"bsp_provider":{"type":"string","enum":["gupshup","meta_cloud_api","aisensy","interakt"],"default":"gupshup","description":"WhatsApp Business Solution Provider"},"sender_id":{"type":"string","description":"WABA sender / phone-number id provisioned per tenant"},"dlt_entity_id":{"type":"string","description":"DLT registered entity id (TRAI compliance)"},"dlt_template_ids":{"type":"object","description":"Registered template id per kernel template (fee_digest, absence_notice, delay_notice)"},"pay_button_template":{"type":"string","description":"Template carrying the UPI pay button on fee digests"},"quiet_hours":{"type":"object","description":"Local quiet hours — the orchestrator also enforces its own"}},"required":["bsp_provider","sender_id"]},"data":{"schema":"plugin_whatsapp","core_refs":["students.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"rails","metered":["messages_delivered"]},"dependencies":[],"defaultEnabled":false,"lifecycle":{"deactivate":"pending receipts flushed; intents handed back to the orchestrator","health":"template + DLT status probe"}}'::jsonb,
   '["students.read","attendance.read","fees.read","comms.send","events.emit","audit.request"]'::jsonb,
   '{"plan":"rails","billing":"usage-metered"}'::jsonb,
   jsonb_build_object('events_per_min',60,'payload_max_bytes',65536,'subscriber_max',25,'fanout_max',50,'chain_depth_max',5,'replay_max',10000,'scheduled_per_day',1000),
   '{"calls_per_day":2000,"tokens_per_day":400000,"tools_per_day":200}'::jsonb),
  ('payments.upi', '1.0.0', 'B',
   '{"id":"payments.upi","name":"UPI Payment Rails","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"B","trust":"T1","description":"UPI collection rails via a Razorpay-style gateway: payment links on fee obligations, signed webhook capture, reconciliation against the kernel fee ledger, Tally-ready export. Money-touching: never auto-moves money — links and webhook facts only; settlement confirm is staff-only through the kernel action spine (fee.payment.settle, Fees §4.2).","permissions":["fees.read","events.emit","actions.raise","audit.request"],"money":{"moves_money":false,"invariant":"Never auto-moves money without kernel approval semantics: creates links, records signed-webhook facts, and lets the kernel settle the ledger (staff confirm, Fees §4.2)."},"events":{"subscribe":[{"type":"fee.due","schema":">=1.0 <2"}],"publish":[{"type":"payment.link.created","schema":"v1"},{"type":"payment.captured","schema":"v1"},{"type":"payment.failed","schema":"v1"}]},"eventSubscriptions":["fee.due"],"slots":["settings"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"gateway":{"type":"string","enum":["razorpay","cashfree","phonepe"],"default":"razorpay"},"key_id":{"type":"string","description":"Gateway key id placeholder (rzp_live_REPLACE_ME) — provision per tenant"},"key_secret_ref":{"type":"string","description":"Vault reference for the gateway secret — the secret itself never lives in settings"},"webhook_secret_ref":{"type":"string","description":"Vault reference for webhook HMAC verification"},"reconciliation_window_mins":{"type":"integer","default":30,"description":"Max drift between gateway capture and ledger post before a reconciliation case is raised"}},"required":["gateway","key_id"]},"data":{"schema":"plugin_upi","core_refs":["fee_obligations.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"rails","metered":["transactions_captured"]},"dependencies":[],"defaultEnabled":false}'::jsonb,
   '["fees.read","events.emit","actions.raise","audit.request"]'::jsonb,
   '{"plan":"rails","billing":"usage-metered"}'::jsonb,
   jsonb_build_object('events_per_min',120,'payload_max_bytes',65536,'subscriber_max',25,'fanout_max',50,'chain_depth_max',5,'replay_max',10000,'scheduled_per_day',100),
   '{}'::jsonb),
  ('transport.gps', '1.0.0', 'B',
   '{"id":"transport.gps","name":"Transport GPS","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"B","trust":"T1","description":"GPS vendor integration: live bus positions, route-deviation alerts and delay events feeding the transport plugin approval loop and guardian notifications. Deterministic-first: the delay guard (delay_minutes >= 10, Transport §3.1) fires before any AI.","permissions":["students.read","events.emit","audit.request"],"events":{"subscribe":[],"publish":[{"type":"gps.position","schema":"v1"},{"type":"transport.route_deviation","schema":"v1"},{"type":"transport.delay","schema":"v1"}]},"eventSubscriptions":[],"automation":{"triggers":[{"on":"gps.position","guard":"delay_minutes >= 10","then":{"raise_action":"notify_guardians","approval":"required","policy_ref":"Transport §3.1"}}]},"slots":["settings"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"vendor":{"type":"string","enum":["trackschoolbus","chalo","fleettrack","custom"],"default":"trackschoolbus","description":"GPS vendor adapter"},"api_key_ref":{"type":"string","description":"Vault reference for the vendor API key"},"poll_interval_secs":{"type":"integer","default":30,"minimum":10,"maximum":300,"description":"Position poll interval (event-budget capped)"},"deviation_threshold_m":{"type":"integer","default":500,"description":"Off-route distance that raises a deviation alert"},"delay_threshold_mins":{"type":"integer","default":10,"description":"Delay that raises an approval-required guardian notice (Transport §3.1)"}},"required":["vendor","api_key_ref"]},"data":{"schema":"plugin_transport_gps","core_refs":["routes.id","students.id"],"retention":{"positions_days":30,"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"rails","metered":["gps_pings"]},"dependencies":[],"defaultEnabled":false}'::jsonb,
   '["students.read","events.emit","audit.request"]'::jsonb,
   '{"plan":"rails","billing":"usage-metered"}'::jsonb,
   jsonb_build_object('events_per_min',240,'payload_max_bytes',65536,'subscriber_max',25,'fanout_max',50,'chain_depth_max',5,'replay_max',10000,'scheduled_per_day',100),
   '{}'::jsonb),
  ('accounting.tally', '1.0.0', 'B',
   '{"id":"accounting.tally","name":"Tally Reconciliation","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"B","trust":"T1","description":"Tally reconciliation rails: daily voucher export from the kernel fee ledger, ledger-mapping settings, Tally-importable output. Read-only on money — the ledger is kernel-owned; the plugin exports, it never posts.","permissions":["fees.read","events.emit","audit.request"],"events":{"subscribe":[{"type":"payment.captured","schema":">=1.0 <2"}],"publish":[{"type":"tally.export.completed","schema":"v1"}]},"eventSubscriptions":["payment.captured"],"slots":["settings"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"tally_url":{"type":"string","description":"Tally XML RPC endpoint on the accountant machine"},"company_name":{"type":"string","description":"Tally company vouchers post into"},"export_hour":{"type":"integer","minimum":0,"maximum":23,"default":20,"description":"Scheduled daily export hour (declared kernel scheduler job, capped)"},"ledger_mapping":{"type":"object","description":"Fee head to Tally ledger name map (kernel fee heads, read-only)"}},"required":["tally_url","company_name"]},"data":{"schema":"plugin_tally","core_refs":["fee_obligations.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"rails","metered":["vouchers_exported"]},"dependencies":[],"defaultEnabled":false}'::jsonb,
   '["fees.read","events.emit","audit.request"]'::jsonb,
   '{"plan":"rails","billing":"usage-metered"}'::jsonb,
   jsonb_build_object('events_per_min',60,'payload_max_bytes',65536,'subscriber_max',25,'fanout_max',50,'chain_depth_max',5,'replay_max',10000,'scheduled_per_day',100),
   '{}'::jsonb),
  ('pack.cbse', '1.0.0', 'C',
   '{"id":"pack.cbse","name":"CBSE Policy Pack","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"C","trust":"T1","description":"CBSE policy pack — certified data consumed by the kernel Policy Engine (docs/11 §2.4): board calendar obligations, report-card structure, assessment weightage validation. Rules, not code: a pack adds obligations, it never relaxes kernel safeguards (safeguarding and POCSO boundaries stay kernel).","permissions":["students.read","attendance.read","memory.write","audit.request"],"events":{"subscribe":[],"publish":[{"type":"cbse.obligation.due","schema":"v1"}]},"eventSubscriptions":[],"pack":{"kind":"policy","applies_to":"CBSE","contents":["board_calendar","holidays","grading_scale","report_card_structure","assessment_weightage_rules","compliance_report_templates"]},"slots":["reports","settings"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"affiliation_no":{"type":"string","description":"CBSE affiliation number"},"academic_year":{"type":"string","description":"Academic year (e.g. 2026-27) driving calendar and report templates"},"board":{"type":"string","enum":["CBSE"],"default":"CBSE"},"report_card_template":{"type":"string","enum":["cbse_secondary","cbse_senior_secondary"],"default":"cbse_secondary"},"weightage_strict":{"type":"boolean","default":true,"description":"Reject assessment plans whose weightage does not total 100%"}},"required":["affiliation_no","academic_year"]},"data":{"schema":"plugin_cbse","core_refs":["students.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"pack","pack":"compliance"},"dependencies":[],"defaultEnabled":false}'::jsonb,
   '["students.read","attendance.read","memory.write","audit.request"]'::jsonb,
   '{"plan":"compliance-pack","billing":"per-board-year"}'::jsonb,
   jsonb_build_object('events_per_min',60,'payload_max_bytes',65536,'subscriber_max',25,'fanout_max',50,'chain_depth_max',5,'replay_max',10000,'scheduled_per_day',100),
   '{}'::jsonb),
  ('pack.dpdp', '1.0.0', 'C',
   '{"id":"pack.dpdp","name":"DPDP Compliance Pack","version":"1.0.0","kernel":">=1.0.0 <2.0.0","class":"C","trust":"T1","description":"DPDP Act 2023 compliance pack: consent ledger for guardian data, data-residency zone enforcement hooks (IN) consumed by the AI Gateway and storage, subject-access request (SAR) workflow through the kernel action spine, retention policy references for every data zone.","permissions":["students.read","actions.raise","memory.write","audit.request"],"events":{"subscribe":[],"publish":[{"type":"consent.recorded","schema":"v1"},{"type":"sar.opened","schema":"v1"},{"type":"sar.fulfilled","schema":"v1"}]},"eventSubscriptions":[],"pack":{"kind":"policy","applies_to":"DPDP Act 2023","contents":["consent_artifacts","residency_rules","sar_workflow","retention_schedules","breach_playbook_refs"]},"slots":["reports","settings"],"routes":[],"widgets":[],"settingsSchema":{"type":"object","properties":{"dpo_contact":{"type":"string","description":"Data Protection Officer contact published in consent notices"},"residency_zone":{"type":"string","enum":["IN"],"default":"IN","description":"Data-residency zone — enforcement hook consulted by the AI Gateway and storage (docs/11 §7 regional routing)"},"sar_sla_days":{"type":"integer","default":30,"minimum":7,"description":"Subject-access request fulfilment SLA in days"},"retention_refs":{"type":"object","description":"Retention schedule reference per data zone (kernel + plugin schemas)"}},"required":["dpo_contact","residency_zone"]},"data":{"schema":"plugin_dpdp","core_refs":["students.id"],"retention":{"on_uninstall":"export_then_purge_30d"},"residency":["IN"]},"regions":["IN"],"residency":"IN","billing":{"model":"pack","pack":"compliance"},"dependencies":[],"defaultEnabled":false}'::jsonb,
   '["students.read","actions.raise","memory.write","audit.request"]'::jsonb,
   '{"plan":"compliance-pack","billing":"per-board-year"}'::jsonb,
   jsonb_build_object('events_per_min',60,'payload_max_bytes',65536,'subscriber_max',25,'fanout_max',50,'chain_depth_max',5,'replay_max',10000,'scheduled_per_day',100),
   '{}'::jsonb)
) AS v(plugin_id, version, class, manifest, permissions, entitlement, event_budget, ai_budget)
ON CONFLICT (tenant_id, plugin_id) DO NOTHING;

-- ── 3. Kernel audit: registration is a governance action, so it rides the same
--       hash-chained ledger (audit_append, SECURITY DEFINER) — never a raw INSERT.
--       One entry per tenant; material matches audit.js byte-for-byte
--       (JSON.stringify field order, node toISOString timestamp) so the chain
--       stays recomputable from stored columns (docs/12 §4 invariant).
WITH cands AS (
  SELECT t.id AS tenant_id,
         COALESCE((SELECT a.hash FROM app.audit_log a
                    WHERE a.tenant_id = t.id
                    ORDER BY a.created_at DESC, a.id DESC LIMIT 1), 'GENESIS') AS prev_hash,
         to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_iso
  FROM app.tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM app.audit_log x
    WHERE x.tenant_id = t.id AND x.record_type = 'Plugin' AND x.record_ref = 'catalog@1.0.0')
), mat AS (
  SELECT c.tenant_id, c.prev_hash, c.at_iso,
    '{"tenant":"' || c.tenant_id::text
    || '","actor":"SchoolOS migration 009","actorRole":"system","action":"Plugin catalog registered: 6 school plugins (009) · WhatsApp · UPI · GPS · Tally · CBSE pack · DPDP pack","recordType":"Plugin","recordRef":"catalog@1.0.0","outcome":"status registered · capability contracts registered for rails and packs · enable remains an audited owner action","at":"' || c.at_iso || '"}' AS material
  FROM cands c
), hashed AS (
  SELECT m.tenant_id, m.prev_hash, m.at_iso, m.material,
         encode(sha256(convert_to(m.prev_hash || m.material, 'UTF8')), 'hex') AS row_hash
  FROM mat m
)
SELECT * FROM hashed
CROSS JOIN LATERAL app.audit_append(
  hashed.tenant_id, 'SchoolOS migration 009', 'system',
  'Plugin catalog registered: 6 school plugins (009) · WhatsApp · UPI · GPS · Tally · CBSE pack · DPDP pack',
  'Plugin', 'catalog@1.0.0',
  'docs/11 catalog as real registry rows: 4 rails (Class B) + 2 policy packs (Class C)',
  'Platform §3.1 (plugin governance)', false, 'low',
  'status registered · capability contracts registered for rails and packs · enable remains an audited owner action',
  hashed.prev_hash, hashed.row_hash, hashed.at_iso::timestamptz);
