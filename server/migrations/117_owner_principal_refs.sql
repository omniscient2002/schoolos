-- 117 · tenant-aligned references for the owner/principal spine tables (116).
--
-- 116 created app.announcements and app.certificates with `action_id`/`comm_id` columns that
-- reference real parents but carried no FK, so the DAT-2 census (tests/dat2-reference-integrity.test.js)
-- correctly flags them as unaccounted. The columns have parents, so the right answer is a constraint.
-- Composite (tenant_id, id) FKs, 082 pattern, so a row can never cross a tenant.
--
-- Guarded on table existence: these are another lane's tables, and a deployment that has not applied
-- 116 must still migrate cleanly. Idempotent.

BEGIN;

-- app.communications needs the composite key the FK targets; add it only if absent (it may already
-- exist, and dropping/re-adding a key other FKs depend on fails).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
     WHERE c.contype IN ('u','p') AND t.relname='communications'
       AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum) = ARRAY['tenant_id','id']
  ) THEN
    ALTER TABLE app.communications ADD CONSTRAINT communications_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('app.announcements') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_action_id_ref_fkey') THEN
      ALTER TABLE app.announcements ADD CONSTRAINT announcements_action_id_ref_fkey
        FOREIGN KEY (tenant_id, action_id) REFERENCES app.actions(tenant_id, id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_comm_id_ref_fkey') THEN
      ALTER TABLE app.announcements ADD CONSTRAINT announcements_comm_id_ref_fkey
        FOREIGN KEY (tenant_id, comm_id) REFERENCES app.communications(tenant_id, id) ON DELETE RESTRICT;
    END IF;
  END IF;

  IF to_regclass('app.certificates') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificates_action_id_ref_fkey') THEN
      ALTER TABLE app.certificates ADD CONSTRAINT certificates_action_id_ref_fkey
        FOREIGN KEY (tenant_id, action_id) REFERENCES app.actions(tenant_id, id) ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;

COMMIT;
