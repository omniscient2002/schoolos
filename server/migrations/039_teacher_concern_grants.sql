-- 039 · teacher.support route/outcome/close doors use SELECT … FOR UPDATE and
-- UPDATE teacher.concern — Postgres requires the UPDATE privilege for both, but
-- 032 granted only SELECT, INSERT. Every concern routing/outcome/close call
-- failed with 42501 "permission denied for table concern" (found by the B9
-- confidentiality suite). Safety.box already carries UPDATE (032:118) — this
-- completes the same shape for the concern lifecycle tables.
BEGIN;

GRANT SELECT, INSERT, UPDATE ON teacher.concern, teacher.concern_status_event TO schoolos_app;

COMMIT;
