-- 007: Capability contracts registered as enforced data (docs/12 §4, §23 item 1).
-- The contract is first-class: the runtime (governance, budget, audit) reads these
-- rows; GET /plugins surfaces them for inspection.

-- The table exists since the docs/10 build (plugin_id, contract, active).
-- 007 upgrades it in place: kind + enforced columns; contracts are platform-level
-- statements (plugin_id stays for plugin-declared contracts).
ALTER TABLE app.capability_contracts
  ADD COLUMN IF NOT EXISTS kind text,
  ALTER COLUMN plugin_id DROP NOT NULL;
UPDATE app.capability_contracts SET kind = 'capability' WHERE kind IS NULL;
ALTER TABLE app.capability_contracts
  ALTER COLUMN kind SET DEFAULT 'capability',
  ADD COLUMN IF NOT EXISTS enforced jsonb NOT NULL DEFAULT '{"audit":"full"}'::jsonb;
-- Platform-level contracts must survive the seed TRUNCATE (tenants CASCADE):
ALTER TABLE app.capability_contracts
  DROP CONSTRAINT IF EXISTS capability_contracts_tenant_id_fkey;
ALTER TABLE app.capability_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contracts_read ON app.capability_contracts;
CREATE POLICY contracts_read ON app.capability_contracts
  FOR SELECT TO schoolos_app USING (true);

-- Kernel primitives (docs/12 §3): the five guarantees every plugin consumes.
INSERT INTO app.capability_contracts (tenant_id, capability_id, version, kind, contract, enforced) VALUES
(NULL, 'money.ledger.post',      '1.0.0', 'capability', '{"description":"Double-entry-safe posting to the tenant ledger; immutable once posted; reconciliation-safe.","read_scopes":["money.read:obligations"],"write_scopes":["money.post"],"side_effects":[{"type":"ledger.post","approval":"never","policy_ref":"Fees §4.2"}],"policy_refs":["Fees §4.2"],"audit":{"level":"full","includes":["inputs_digest","actor","amount"]},"data_classification":["pii:fee_records","financial"],"idempotency":{"key":"obligation+attempt","window":"24h"},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb, '{"audit":"full","invariants":["paid_cents<=amount_cents","one_open_payment_per_obligation"]}'::jsonb),
(NULL, 'work.wo.transition',     '1.0.0', 'command',    '{"description":"Work-order state transitions; SLA clock events; deterministic-first (no AI in the loop).","read_scopes":["work.read:wo"],"write_scopes":["work.transition"],"event_inputs":["transport.delay@>=1.0"],"side_effects":[{"type":"action.raise","approval":"required","policy_ref":"Maintenance §2.1"}],"policy_refs":["Maintenance §2.1"],"audit":{"level":"full","includes":["actor","from","to"]},"data_classification":["internal"],"latency_sla":{"p95_ms":800,"timeout_ms":3000},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb, '{"audit":"full","invariants":["wo_flow_order_enforced"]}'::jsonb),
(NULL, 'artifact.store.put',     '1.0.0', 'capability', '{"description":"Immutable, hash-addressed, provenance-linked object store with retention honoring.","read_scopes":["artifact.read:own"],"write_scopes":["artifact.put"],"side_effects":[{"type":"artifact.put","approval":"never","policy_ref":"Platform §5.2"}],"policy_refs":["Platform §5.2"],"audit":{"level":"digest","includes":["content_hash","provenance"]},"data_classification":["pii:documents"],"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb, '{"audit":"digest"}'::jsonb),
(NULL, 'comms.send',             '1.0.0', 'command',    '{"description":"Tenant-approved communication send; template-bound; consent-gated per channel.","read_scopes":["comms.read:templates"],"write_scopes":["comms.intent"],"side_effects":[{"type":"comms.send","channel":"whatsapp.template","consent":"verified","policy_ref":"Comms §1.2"},{"type":"comms.send","channel":"email","consent":"verified","policy_ref":"Comms §1.3"}],"policy_refs":["Comms §1.2"],"audit":{"level":"full","includes":["template","audience_digest","actor","approval"]},"data_classification":["pii:guardian_contact"],"ai_eligibility":{"capabilities":["draft.message"],"modes":["transformation"],"grounding":"required"},"latency_sla":{"p95_ms":2000,"timeout_ms":8000},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb, '{"audit":"full","invariants":["approval_required_for_send"]}'::jsonb),
(NULL, 'audit.chain.append',     '1.0.0', 'capability', '{"description":"Append-only, hash-chained audit write through app.audit_append (SECURITY DEFINER). INSERT to the ledger is revoked from the app role.","read_scopes":["audit.read:own_tenant"],"write_scopes":["audit.append"],"side_effects":[{"type":"ledger.audit","approval":"never","policy_ref":"Platform §2.4"}],"policy_refs":["Platform §2.4"],"audit":{"level":"full","includes":["actor","action","prev_hash","hash"]},"data_classification":["audit"],"idempotency":{"key":"advisory_lock(tenant)","window":"transaction"},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb, '{"audit":"full","invariants":["insert_revoked_for_app_role","hash_recomputable_from_stored_columns"]}'::jsonb)
ON CONFLICT (tenant_id, capability_id, version) DO NOTHING;

-- ── Domain capability contracts (v1 note, docs/12 §3): fee/cases/transport APIs
--    are contract statements over the primitives — no code moves in v1.
INSERT INTO app.capability_contracts (tenant_id, capability_id, version, kind, contract, enforced) VALUES
(NULL, 'transport.delay.detected', '1.0.0', 'capability', '{"description":"GPS delay ingestion; raises principal approval when delay ≥ 10 min; envelope v2 event with lineage.","read_scopes":["transport.read:routes"],"write_scopes":["plugin_transport.events","comms.intent"],"event_outputs":["transport.delay.v1"],"side_effects":[{"type":"action.raise","approval":"required","policy_ref":"Transport §3.1"},{"type":"comms.send","channel":"whatsapp.template","consent":"verified"}],"policy_refs":["Transport §3.1"],"audit":{"level":"full","includes":["inputs_digest","decision","actor","approval"]},"data_classification":["pii:guardian_contact","internal"],"latency_sla":{"p95_ms":1500,"timeout_ms":5000},"idempotency":{"key":"event.id+handler","window":"24h"},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb, '{"audit":"full","invariants":["budget_enforced","breaker_enforced","lineage_linked"]}'::jsonb),
(NULL, 'fee.payment.settle',   '1.0.0', 'command', '{"description":"Initiate + confirm payment lifecycle; confirm is staff-only; gateway_ref honesty in audit.","read_scopes":["money.read:obligations"],"write_scopes":["money.post"],"side_effects":[{"type":"ledger.post","approval":"never","policy_ref":"Fees §4.2"},{"type":"comms.send","channel":"whatsapp.template","consent":"verified"}],"policy_refs":["Fees §4.2"],"audit":{"level":"full","includes":["actor","receipt","webhook_verified"]},"data_classification":["financial","pii:guardian_contact"],"idempotency":{"key":"payment.id","window":"24h"},"compat":{"kernel":">=1.0 <2.0"},"regions":["IN"],"residency":"IN"}'::jsonb, '{"audit":"full","invariants":["paid_cents<=amount_cents","parent_cannot_confirm","no_parallel_open_payments"]}'::jsonb)
ON CONFLICT (tenant_id, capability_id, version) DO NOTHING;
