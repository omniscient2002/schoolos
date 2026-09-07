process.env.DATABASE_URL='postgres://schoolos:schoolos_dev_pw@127.0.0.1:5432/schoolos_test';
const { pool } = await import('/home/cassandra/schoolOS/server/src/db.js');
const c = await pool.connect();
try {
  await c.query('BEGIN');
  const u = (await c.query(`SELECT id, tenant_id FROM app.users WHERE email='student@meridian.edu'`)).rows[0];
  await c.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [u.tenant_id]);
  await c.query(`SELECT set_config('schoolos.user_id', $2, true)`, [u.id]);
  await c.query(`SELECT set_config('schoolos.role', $1, true)`, ['student']);
  await c.query('SET LOCAL ROLE schoolos_app');
  const r = await c.query(`SELECT id FROM student.mistake_note LIMIT 5`);
  console.log('SELECT ok', r.rows.length);
  const ins = await c.query(`INSERT INTO student.mistake_note (tenant_id, creator_user_id, subject, topic, what_wrong, correction) VALUES ($1,$2,'x','y','z','w') RETURNING id`, [u.tenant_id, u.id]);
  console.log('INSERT ok', ins.rows[0].id);
} catch (e) { console.error('ERR:', e.message, '| code', e.code); }
try { await c.query('ROLLBACK'); } catch {}
c.release(); await pool.end();
