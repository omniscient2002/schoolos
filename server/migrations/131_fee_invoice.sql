-- 131 · invoice artifact pointer on fee obligations (D1).
--
-- The receivable is `app.fee_obligations` and the settlement artifact is `app.fee_receipts`; there was no
-- invoice DOCUMENT. This points an obligation at its rendered invoice in the private file store (the
-- first request renders and stores it; later requests return the same artifact). Idempotent.

BEGIN;

ALTER TABLE app.fee_obligations ADD COLUMN IF NOT EXISTS invoice_file_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_obligations_invoice_file_fkey') THEN
    ALTER TABLE app.fee_obligations ADD CONSTRAINT fee_obligations_invoice_file_fkey
      FOREIGN KEY (tenant_id, invoice_file_id) REFERENCES app.files (tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
