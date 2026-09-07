process.env.DATABASE_URL='postgres://schoolos:schoolos_dev_pw@127.0.0.1:5432/schoolos_test';
const { pool } = await import('/home/cassandra/schoolOS/server/src/db.js');
const c = await pool.connect();
const u = (await c.query(`SELECT id, tenant_id FROM app.users WHERE email='student@meridian.edu'`)).rows[0];
for (const [label, stmt, params] of [
  ['begin', 'BEGIN', []],
  ['guc tenant', `SELECT set_config('schoolos.tenant_id', $1::text, true)`, [u.tenant_id]],
  ['guc user', `SELECT set_config('schoolos.user_id', $1::text, true)`, [u.id]],
  ['guc role', `SELECT set_config('schoolos.role', $1::text, true)`, ['student']],
  ['set role', 'SET LOCAL ROLE schoolos_app', []],
  ['select', 'SELECT id FROM student.mistake_note LIMIT 3', []],
  ['insert', `INSERT INTO student.mistake_note (tenant_id, creator_user_id, subject, topic, what_wrong, correction) VALUES ($1::uuid,$2::uuid,'x','y','z','w') RETURNING id`, [u.tenant_id, u.id]],
]) {
  try { const r = await c.query(stmt, params); console.log(label, 'OK', r.rows?.length ?? ''); }
  catch (e) { console.log(label, 'FAIL:', e.message); }
}
c.release(); await pool.end();
