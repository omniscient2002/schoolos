-- Dev-only cleanup: remove walker/probe tenants (parity-zero-*, dbg-*) and every
-- row they own, without touching real dev schools (saraswati, meridian, …).
-- Run as the postgres superuser (bypasses FORCE RLS):
--   psql -U postgres -h /var/run/postgresql -d schoolos -f scripts/dev-clean-walks.sql
DO $$
DECLARE
  tids uuid[] := ARRAY(
    SELECT id FROM app.tenants
    WHERE slug LIKE 'parity-zero-walk-%'
       OR slug LIKE 'dbg%-walk-%'
       OR slug LIKE 'dbg7-%'
       OR slug LIKE 'dbg8-%'
       OR slug LIKE 'pzero-%'
       OR slug LIKE 'dbg-%');
  tbl text;
BEGIN
  -- composite FK (tenant_id, enabled_by) -> users: clear the pointer first
  UPDATE app.plugins SET enabled_by = NULL WHERE tenant_id = ANY(tids);
  -- tenant tables reference each other with composite RESTRICT FKs (e.g.
  -- sections -> classes on (tenant_id, class_id)), so one alphabetical pass is
  -- not enough: repeat until each pass deletes nothing (leaf rows first).
  FOR pass IN 1..8 LOOP
    FOR tbl IN
      SELECT DISTINCT table_schema || '.' || table_name
        FROM information_schema.columns
       WHERE column_name = 'tenant_id' AND table_schema = 'app'
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM %s WHERE tenant_id = ANY($1)', tbl) USING tids;
      EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
        -- a referenced parent: a later pass (or the final users/tenants step) takes it
        NULL;
      END;
    END LOOP;
  END LOOP;
  DELETE FROM app.users WHERE tenant_id = ANY(tids);
  DELETE FROM app.tenants WHERE id = ANY(tids);
  RAISE NOTICE 'walk tenants removed; remaining tenants: %', (SELECT count(*) FROM app.tenants);
END $$;
