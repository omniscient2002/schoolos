-- 005: Grants refresh — fixes the "migrations create tables after bootstrap" class of bug
-- (QA REL-CERT-001 blocker B1: /plugins 500 = permission denied on live DB).
-- Run by the table owner (schoolos), so GRANT here is valid without superuser.
GRANT USAGE ON SCHEMA app TO schoolos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO schoolos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO schoolos_app;
-- Future tables created by migrations are granted automatically (owner-scoped default privileges):
ALTER DEFAULT PRIVILEGES FOR ROLE schoolos IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO schoolos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE schoolos IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO schoolos_app;
-- Re-tighten the append-only guarantee after the broad grant (docs/12 §2.1):
REVOKE UPDATE, DELETE ON app.audit_log FROM schoolos_app;
