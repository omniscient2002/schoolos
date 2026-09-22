-- 108 · library v2 — the librarian role + full LMS data plane.
-- Design: docs/LIBRARY-DESIGN.md. Owner-approved defaults (2026-09-17).
--
-- WHAT THIS ADDS
--   · the 14th built-in role `librarian` (users + roles base_role CHECKs; auth.js ROLES must match).
--   · `app.student_accounts` — the stable student<->user link that overdue notifications need (the
--     student identity was a name-match pin; a reminder to the wrong child is worse than none).
--   · `library.copy` — per-copy identity (barcode / accession / status), so lost/damaged/withdrawn and
--     inventory audits are expressible. v1's `copies_total − open_loans` cannot say "copy 3 is damaged".
--   · `library.reservation` — online pre-booking with a FIFO queue.
--   · `library.fine` — a fines ledger separate from the loan (waivers/partials).
--   · library.book metadata columns + library.loan borrower generalization (student OR staff) and the
--     renewal/return/source fields.
--   · registry manifest `defaultEnabled:false` (plugin becomes opt-in; the catalog DEFAULT_ON removal is code).
--
-- LAWS OBEYED
--   · DAT-1: every FK between two tenant-scoped tables is composite on (tenant_id, …). Parents get
--     UNIQUE (tenant_id, id) where missing (book already has it via 081; 087 precedent for guarded adds).
--   · DAT-2: no new FK-less reference column — every reference is constrained or will be added to the census.
--   · D-35: the app role gets SELECT/INSERT/UPDATE and NEVER DELETE on any of these tables.
--   · 074: policies route through app.current_tenant(), never inline current_setting.
--   · Idempotent: every step is IF NOT EXISTS / pg_constraint-guarded, safe on a fresh database and on
--     replay. Runs on an EMPTY database (tests/helpers migrate→bootstrap→seed), so nothing requires seed data.
--
-- BACKFILL POLICY. Existing `library.loan` rows all carry a student borrower; this migration sets
-- borrower_type='student' for them and leaves `student_id` NOT NULL for history. `student_accounts` is
-- NOT backfilled here by name-match: on a live database names are not unique and a wrong link leaks a
-- child's data to another parent. The application resolves student_accounts first, then falls back to the
-- existing name-match pin, so behaviour is unchanged until an operator links accounts deliberately.

-- ── 1. the 14th role ────────────────────────────────────────────────────────────
ALTER TABLE app.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE app.users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
  'owner'::text, 'principal'::text, 'coordinator'::text, 'counselor'::text, 'finance'::text,
  'admissions'::text, 'transport'::text, 'facilities'::text, 'technician'::text, 'teacher'::text,
  'itadmin'::text, 'parent'::text, 'student'::text, 'librarian'::text]));

ALTER TABLE app.roles DROP CONSTRAINT IF EXISTS roles_base_role_check;
ALTER TABLE app.roles ADD CONSTRAINT roles_base_role_check CHECK (base_role = ANY (ARRAY[
  'owner'::text, 'principal'::text, 'coordinator'::text, 'counselor'::text, 'finance'::text,
  'admissions'::text, 'transport'::text, 'facilities'::text, 'technician'::text, 'teacher'::text,
  'itadmin'::text, 'parent'::text, 'student'::text, 'librarian'::text]));

-- ── 2. student <-> user link (notification target) ─────────────────────────────
CREATE TABLE IF NOT EXISTS app.student_accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id),
  student_id uuid NOT NULL,
  user_id    uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, student_id),
  UNIQUE (tenant_id, user_id)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_accounts_tenant_student_id_fkey') THEN
    ALTER TABLE app.student_accounts ADD CONSTRAINT student_accounts_tenant_student_id_fkey
      FOREIGN KEY (tenant_id, student_id) REFERENCES app.students(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_accounts_tenant_user_id_fkey') THEN
    ALTER TABLE app.student_accounts ADD CONSTRAINT student_accounts_tenant_user_id_fkey
      FOREIGN KEY (tenant_id, user_id) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE app.student_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.student_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.student_accounts;
CREATE POLICY tenant_isolation ON app.student_accounts
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON app.student_accounts TO schoolos_app;

-- ── 3. library.book metadata ────────────────────────────────────────────────────
-- DAT-1: app.files needs a composite key to be an FK target (081 added it to most parents; files was not one).
DO $$ BEGIN
  IF to_regclass('app.files') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'files_tenant_id_id_key') THEN
    ALTER TABLE app.files ADD CONSTRAINT files_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

ALTER TABLE library.book ADD COLUMN IF NOT EXISTS subtitle      text;
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS publisher     text;
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS edition       text;
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS pub_year      integer;
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS language      text;
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS isbn10        text;
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS isbn13        text;
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS subject       text;
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS dewey_code    text;
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS description   text;
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS shelf_location text;
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS price_cents   integer CHECK (price_cents IS NULL OR price_cents >= 0);
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS acquired_on   date;
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS vendor        text;
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS bill_ref      text;
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS book_type     text NOT NULL DEFAULT 'book';
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS cover_file_id uuid;
ALTER TABLE library.book ADD COLUMN IF NOT EXISTS updated_at    timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'book_book_type_check') THEN
    ALTER TABLE library.book ADD CONSTRAINT book_book_type_check
      CHECK (book_type = ANY (ARRAY['book','reference','magazine','journal','other']::text[]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'book_tenant_cover_file_id_fkey') THEN
    IF to_regclass('app.files') IS NOT NULL THEN
      ALTER TABLE library.book ADD CONSTRAINT book_tenant_cover_file_id_fkey
        FOREIGN KEY (tenant_id, cover_file_id) REFERENCES app.files(tenant_id, id) ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS book_tenant_isbn13_idx ON library.book (tenant_id, isbn13) WHERE isbn13 IS NOT NULL;
CREATE INDEX IF NOT EXISTS book_tenant_category_idx ON library.book (tenant_id, category);

-- ── 4. library.copy — per-copy identity ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS library.copy (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id),
  book_id      uuid NOT NULL,
  copy_code    text NOT NULL,
  barcode      text,
  accession_no text,
  status       text NOT NULL DEFAULT 'available'
                 CHECK (status = ANY (ARRAY['available','issued','reserved','lost','damaged','withdrawn']::text[])),
  condition    text,
  acquired_on  date,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, copy_code)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'copy_tenant_id_id_key') THEN
    ALTER TABLE library.copy ADD CONSTRAINT copy_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'copy_tenant_book_id_fkey') THEN
    ALTER TABLE library.copy ADD CONSTRAINT copy_tenant_book_id_fkey
      FOREIGN KEY (tenant_id, book_id) REFERENCES library.book(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS copy_tenant_barcode_key ON library.copy (tenant_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS copy_tenant_book_status_idx ON library.copy (tenant_id, book_id, status);

ALTER TABLE library.copy ENABLE ROW LEVEL SECURITY;
ALTER TABLE library.copy FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON library.copy;
CREATE POLICY tenant_isolation ON library.copy
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON library.copy TO schoolos_app;

-- ── 5. library.loan — borrower generalization + renewal/return/source ────────────
ALTER TABLE library.loan ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE library.loan ADD COLUMN IF NOT EXISTS borrower_user_id uuid;
ALTER TABLE library.loan ADD COLUMN IF NOT EXISTS borrower_type    text NOT NULL DEFAULT 'student';
ALTER TABLE library.loan ADD COLUMN IF NOT EXISTS copy_id          uuid;
ALTER TABLE library.loan ADD COLUMN IF NOT EXISTS returned_by      uuid;
ALTER TABLE library.loan ADD COLUMN IF NOT EXISTS return_condition text;
ALTER TABLE library.loan ADD COLUMN IF NOT EXISTS renewal_count    integer NOT NULL DEFAULT 0;
ALTER TABLE library.loan ADD COLUMN IF NOT EXISTS last_renewed_at  timestamptz;
ALTER TABLE library.loan ADD COLUMN IF NOT EXISTS source           text NOT NULL DEFAULT 'walk_in';

-- every pre-108 loan is a student loan
UPDATE library.loan SET borrower_type = 'student' WHERE borrower_type IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_tenant_id_id_key') THEN
    ALTER TABLE library.loan ADD CONSTRAINT loan_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_tenant_borrower_user_id_fkey') THEN
    ALTER TABLE library.loan ADD CONSTRAINT loan_tenant_borrower_user_id_fkey
      FOREIGN KEY (tenant_id, borrower_user_id) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_tenant_copy_id_fkey') THEN
    ALTER TABLE library.loan ADD CONSTRAINT loan_tenant_copy_id_fkey
      FOREIGN KEY (tenant_id, copy_id) REFERENCES library.copy(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_tenant_returned_by_fkey') THEN
    ALTER TABLE library.loan ADD CONSTRAINT loan_tenant_returned_by_fkey
      FOREIGN KEY (tenant_id, returned_by) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_borrower_type_check') THEN
    ALTER TABLE library.loan ADD CONSTRAINT loan_borrower_type_check
      CHECK (borrower_type = ANY (ARRAY['student','staff']::text[]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_source_check') THEN
    ALTER TABLE library.loan ADD CONSTRAINT loan_source_check
      CHECK (source = ANY (ARRAY['walk_in','reservation']::text[]));
  END IF;
  -- exactly one borrower identity: a roster student XOR a staff user
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_borrower_exactly_one_check') THEN
    ALTER TABLE library.loan ADD CONSTRAINT loan_borrower_exactly_one_check
      CHECK (num_nonnulls(student_id, borrower_user_id) = 1);
  END IF;
END $$;

-- one open loan per physical copy (partial so history rows are unconstrained)
CREATE UNIQUE INDEX IF NOT EXISTS loan_one_open_per_copy ON library.loan (copy_id) WHERE status = 'issued' AND copy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS loan_tenant_borrower_user_idx ON library.loan (tenant_id, borrower_user_id) WHERE borrower_user_id IS NOT NULL;

-- ── 6. library.reservation — holds / online pre-booking ─────────────────────────
CREATE TABLE IF NOT EXISTS library.reservation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES app.tenants(id),
  book_id            uuid NOT NULL,
  borrower_type      text NOT NULL CHECK (borrower_type = ANY (ARRAY['student','staff']::text[])),
  borrower_student_id uuid,
  borrower_user_id    uuid,
  status             text NOT NULL DEFAULT 'requested'
                       CHECK (status = ANY (ARRAY['requested','ready','fulfilled','expired','cancelled']::text[])),
  queue_no           integer,
  requested_at       timestamptz NOT NULL DEFAULT now(),
  ready_at           timestamptz,
  expires_at         timestamptz,
  fulfilled_loan_id  uuid,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(borrower_student_id, borrower_user_id) = 1)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservation_tenant_book_id_fkey') THEN
    ALTER TABLE library.reservation ADD CONSTRAINT reservation_tenant_book_id_fkey
      FOREIGN KEY (tenant_id, book_id) REFERENCES library.book(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservation_tenant_borrower_student_id_fkey') THEN
    ALTER TABLE library.reservation ADD CONSTRAINT reservation_tenant_borrower_student_id_fkey
      FOREIGN KEY (tenant_id, borrower_student_id) REFERENCES app.students(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservation_tenant_borrower_user_id_fkey') THEN
    ALTER TABLE library.reservation ADD CONSTRAINT reservation_tenant_borrower_user_id_fkey
      FOREIGN KEY (tenant_id, borrower_user_id) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservation_tenant_fulfilled_loan_id_fkey') THEN
    ALTER TABLE library.reservation ADD CONSTRAINT reservation_tenant_fulfilled_loan_id_fkey
      FOREIGN KEY (tenant_id, fulfilled_loan_id) REFERENCES library.loan(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservation_tenant_created_by_fkey') THEN
    ALTER TABLE library.reservation ADD CONSTRAINT reservation_tenant_created_by_fkey
      FOREIGN KEY (tenant_id, created_by) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

-- one ACTIVE reservation per borrower per title (COALESCE so student/staff share the queue)
CREATE UNIQUE INDEX IF NOT EXISTS reservation_one_active
  ON library.reservation (tenant_id, book_id, COALESCE(borrower_student_id, borrower_user_id))
  WHERE status IN ('requested','ready');
CREATE INDEX IF NOT EXISTS reservation_tenant_book_status_idx ON library.reservation (tenant_id, book_id, status, queue_no);

ALTER TABLE library.reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE library.reservation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON library.reservation;
CREATE POLICY tenant_isolation ON library.reservation
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON library.reservation TO schoolos_app;

-- ── 7. library.fine — fines ledger ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS library.fine (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES app.tenants(id),
  loan_id             uuid,
  borrower_type       text NOT NULL CHECK (borrower_type = ANY (ARRAY['student','staff']::text[])),
  borrower_student_id uuid,
  borrower_user_id    uuid,
  cause               text NOT NULL CHECK (cause = ANY (ARRAY['overdue','damage','lost']::text[])),
  amount_cents        integer NOT NULL CHECK (amount_cents >= 0),
  status              text NOT NULL DEFAULT 'outstanding'
                        CHECK (status = ANY (ARRAY['outstanding','paid','waived']::text[])),
  assessed_at         timestamptz NOT NULL DEFAULT now(),
  settled_at          timestamptz,
  settled_by          uuid,
  notes               text,
  CHECK (num_nonnulls(borrower_student_id, borrower_user_id) = 1)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fine_tenant_loan_id_fkey') THEN
    ALTER TABLE library.fine ADD CONSTRAINT fine_tenant_loan_id_fkey
      FOREIGN KEY (tenant_id, loan_id) REFERENCES library.loan(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fine_tenant_borrower_student_id_fkey') THEN
    ALTER TABLE library.fine ADD CONSTRAINT fine_tenant_borrower_student_id_fkey
      FOREIGN KEY (tenant_id, borrower_student_id) REFERENCES app.students(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fine_tenant_borrower_user_id_fkey') THEN
    ALTER TABLE library.fine ADD CONSTRAINT fine_tenant_borrower_user_id_fkey
      FOREIGN KEY (tenant_id, borrower_user_id) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fine_tenant_settled_by_fkey') THEN
    ALTER TABLE library.fine ADD CONSTRAINT fine_tenant_settled_by_fkey
      FOREIGN KEY (tenant_id, settled_by) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS fine_tenant_status_idx ON library.fine (tenant_id, status, cause);
CREATE INDEX IF NOT EXISTS fine_tenant_loan_idx ON library.fine (tenant_id, loan_id);

ALTER TABLE library.fine ENABLE ROW LEVEL SECURITY;
ALTER TABLE library.fine FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON library.fine;
CREATE POLICY tenant_isolation ON library.fine
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON library.fine TO schoolos_app;

-- ── 7b. library.acquisition_request — "suggest a book to buy" ───────────────────
CREATE TABLE IF NOT EXISTS library.acquisition_request (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES app.tenants(id),
  title                   text NOT NULL,
  author                  text,
  isbn                    text,
  note                    text,
  requested_by_user_id    uuid,
  requested_by_student_id uuid,
  normalized_key          text NOT NULL,
  status                  text NOT NULL DEFAULT 'requested'
                            CHECK (status = ANY (ARRAY['requested','approved','rejected','ordered','added','cancelled']::text[])),
  vote_count              integer NOT NULL DEFAULT 1 CHECK (vote_count >= 1),
  decided_by              uuid,
  decided_at              timestamptz,
  decision_note           text,
  added_book_id           uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(requested_by_user_id, requested_by_student_id) = 1)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acq_tenant_id_id_key') THEN
    ALTER TABLE library.acquisition_request ADD CONSTRAINT acq_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acq_tenant_requested_by_user_id_fkey') THEN
    ALTER TABLE library.acquisition_request ADD CONSTRAINT acq_tenant_requested_by_user_id_fkey
      FOREIGN KEY (tenant_id, requested_by_user_id) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acq_tenant_requested_by_student_id_fkey') THEN
    ALTER TABLE library.acquisition_request ADD CONSTRAINT acq_tenant_requested_by_student_id_fkey
      FOREIGN KEY (tenant_id, requested_by_student_id) REFERENCES app.students(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acq_tenant_decided_by_fkey') THEN
    ALTER TABLE library.acquisition_request ADD CONSTRAINT acq_tenant_decided_by_fkey
      FOREIGN KEY (tenant_id, decided_by) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acq_tenant_added_book_id_fkey') THEN
    ALTER TABLE library.acquisition_request ADD CONSTRAINT acq_tenant_added_book_id_fkey
      FOREIGN KEY (tenant_id, added_book_id) REFERENCES library.book(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

-- one OPEN request per title (normalized) so demand is a vote, not duplicate rows
CREATE UNIQUE INDEX IF NOT EXISTS acquisition_open_key
  ON library.acquisition_request (tenant_id, normalized_key)
  WHERE status IN ('requested','approved','ordered');
CREATE INDEX IF NOT EXISTS acquisition_tenant_status_idx ON library.acquisition_request (tenant_id, status, vote_count DESC);

ALTER TABLE library.acquisition_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE library.acquisition_request FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON library.acquisition_request;
CREATE POLICY tenant_isolation ON library.acquisition_request
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON library.acquisition_request TO schoolos_app;

-- ── 7c. library.acquisition_vote — demand signal ────────────────────────────────
CREATE TABLE IF NOT EXISTS library.acquisition_vote (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id),
  request_id     uuid NOT NULL,
  voter_user_id  uuid,
  voter_student_id uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(voter_user_id, voter_student_id) = 1)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acq_vote_tenant_request_id_fkey') THEN
    ALTER TABLE library.acquisition_vote ADD CONSTRAINT acq_vote_tenant_request_id_fkey
      FOREIGN KEY (tenant_id, request_id) REFERENCES library.acquisition_request(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acq_vote_tenant_voter_user_id_fkey') THEN
    ALTER TABLE library.acquisition_vote ADD CONSTRAINT acq_vote_tenant_voter_user_id_fkey
      FOREIGN KEY (tenant_id, voter_user_id) REFERENCES app.users(tenant_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acq_vote_tenant_voter_student_id_fkey') THEN
    ALTER TABLE library.acquisition_vote ADD CONSTRAINT acq_vote_tenant_voter_student_id_fkey
      FOREIGN KEY (tenant_id, voter_student_id) REFERENCES app.students(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS acquisition_vote_one
  ON library.acquisition_vote (tenant_id, request_id, COALESCE(voter_student_id, voter_user_id));

ALTER TABLE library.acquisition_vote ENABLE ROW LEVEL SECURITY;
ALTER TABLE library.acquisition_vote FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON library.acquisition_vote;
CREATE POLICY tenant_isolation ON library.acquisition_vote
  USING (tenant_id = app.current_tenant()::uuid) WITH CHECK (tenant_id = app.current_tenant()::uuid);
GRANT SELECT, INSERT, UPDATE ON library.acquisition_vote TO schoolos_app;

-- ── 8. the plugin becomes opt-in ────────────────────────────────────────────────
-- The code side (plugin-catalog DEFAULT_ON) is what stops auto-enable; this keeps the stored manifest
-- honest for any reader and for signup reconciliation.
UPDATE app.plugins SET manifest = jsonb_set(manifest, '{defaultEnabled}', 'false'::jsonb, true)
WHERE plugin_id = 'library' AND manifest ? 'defaultEnabled';
