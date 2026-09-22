-- 118 · OWNER / PRINCIPAL — announcement delivery receipts (docs/OWNER-PRINCIPAL-PERFECT-100.md, DAT-8).
--
-- WHAT THIS ADDS
--   · OPP-DAT-8  `app.announcement_receipts` — one row per recipient of an approved announcement, so
--                "compose → approve → queued → receipts" is a real chain rather than a recipient count.
--                In-app rows are `delivered` (written immediately); outbound rows start `queued` and the
--                dispatcher owns the honest verdict (never pre-claimed delivered).
--
-- LAWS OBEYED
--   · DAT-1: composite (tenant_id, id) UNIQUE on the parent + tenant-aligned FKs; a receipt can never
--     point at another tenant's announcement or user.
--   · D-35: the app role gets SELECT/INSERT/UPDATE, never DELETE.
--   · 074: every policy routes through app.current_tenant().
--   · Idempotent: IF NOT EXISTS / pg_constraint-guarded; runs on an empty database and on a replay.

BEGIN;

-- The parent needs the composite key the FK targets (guarded; may already exist).
DO $$
BEGIN
  IF to_regclass('app.announcements') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
       WHERE c.contype IN ('u','p') AND t.relname='announcements'
         AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum) = ARRAY['tenant_id','id']
    ) THEN
      ALTER TABLE app.announcements ADD CONSTRAINT announcements_tenant_id_id_key UNIQUE (tenant_id, id);
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app.announcement_receipts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES app.tenants(id),
  announcement_id uuid NOT NULL,
  user_id         uuid,
  channel         text NOT NULL DEFAULT 'In-app',
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','delivered','failed')),
  detail          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.announcement_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.announcement_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.announcement_receipts;
CREATE POLICY tenant_isolation ON app.announcement_receipts
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.announcement_receipts TO schoolos_app;

ALTER TABLE app.announcement_receipts DROP CONSTRAINT IF EXISTS announcement_receipts_tenant_id_id_key;
ALTER TABLE app.announcement_receipts ADD CONSTRAINT announcement_receipts_tenant_id_id_key UNIQUE (tenant_id, id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcement_receipts_announcement_fkey') THEN
    ALTER TABLE app.announcement_receipts ADD CONSTRAINT announcement_receipts_announcement_fkey
      FOREIGN KEY (tenant_id, announcement_id) REFERENCES app.announcements(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcement_receipts_user_fkey') THEN
    ALTER TABLE app.announcement_receipts ADD CONSTRAINT announcement_receipts_user_fkey
      FOREIGN KEY (tenant_id, user_id) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS announcement_receipts_idx
  ON app.announcement_receipts (tenant_id, announcement_id, status);

COMMIT;
