process.env.DATABASE_URL='postgres://schoolos:schoolos_dev_pw@127.0.0.1:5432/schoolos_test';
const { pool } = await import('/home/cassandra/schoolOS/server/src/db.js');
const c = await pool.connect();
const u = (await c.query(`SELECT id, tenant_id FROM app.users WHERE email='student@meridian.edu'`)).rows[0];
await c.query('BEGIN');
const tests = [
  ['guc tenant uncast', `SELECT set_config('schoolos.tenant_id', $1, true)`, [u.tenant_id]],
  ['guc user uncast', `SELECT set_config('schoolos.user_id', $1, true)`, [u.id]],
  ['guc role uncast', `SELECT set_config('schoolos.role', $1, true)`, ['student']],
  ['set role', 'SET LOCAL ROLE schoolos_app', []],
  ['insert uncast', `INSERT INTO student.mistake_note (tenant_id, creator_user_id, subject, topic, what_wrong, correction) VALUES ($1,$2,'x','y','z','w') RETURNING id`, [u.tenant_id, u.id]],
];
for (const [label, stmt, params] of tests) {
  try { const r = await c.query(stmt, params); console.log(label, 'OK', JSON.stringify(r.rows?.[0] ?? r.rows?.length)); }
  catch (e) { console.log(label, 'FAIL:', e.message, e.code); }
}
await c.query('ROLLBACK'); c.release(); await pool.end();
