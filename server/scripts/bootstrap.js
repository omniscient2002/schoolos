// One-time bootstrap: creates the constrained app role. Requires superuser or CREATEROLE.
import pg from 'pg';
import { config } from '../src/config.js';

// same host/db as DATABASE_URL, but as the superuser (role + grant management)
const adminUrl = process.env.ADMIN_DATABASE_URL
  ?? config.databaseUrl.replace(/\/\/[^@]+@/, '//postgres@');
const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
const res = await client.query(`SELECT 1 FROM pg_roles WHERE rolname='schoolos_app'`);
if (res.rowCount === 0) {
  await client.query(`CREATE ROLE schoolos_app LOGIN PASSWORD 'schoolos_app_pw' NOINHERIT`);
  console.log('created role schoolos_app');
}
await client.query(`GRANT USAGE ON SCHEMA app TO schoolos_app`);
await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO schoolos_app`);
await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO schoolos_app`);
await client.query(`REVOKE UPDATE, DELETE ON app.audit_log FROM schoolos_app`);
await client.query(`GRANT schoolos_app TO schoolos`); // owner may SET ROLE into the constrained role
console.log('bootstrap complete');
await client.end();
