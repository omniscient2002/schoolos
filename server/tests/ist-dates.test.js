// DAT-7 (PERFECT-100 §5.4/§5.6/§5.5) — school dates are IST, not UTC.
//
// THE DEFECT: the attendance read and mark doors defaulted `date` to `new Date().toISOString().slice(0,10)` —
// UTC — and `people.admin`'s withdraw effective date did the same, while Postgres runs `Asia/Kolkata` and the
// dunning code already used a correct IST helper. Between 00:00 and 05:30 IST the UTC date is the previous
// day, so a client omitting `date` read and wrote yesterday's register, absorbed silently by the attendance
// unique conflict target.
//
// WHAT THIS PINS: (1) the kernel helper agrees with Postgres's own IST date; (2) a mark request that omits
// `date` lands on the IST date, not the UTC one; (3) the two doors no longer contain a UTC date default —
// a source check, because the behavioural equality is vacuous on the ~80% of runs where IST and UTC agree.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, loginAs } from './helpers.js';
import { istToday } from '../src/ist.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

let app; let pool; let principal; let tenantId; let studentId;
before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  principal = await loginAs(app, 'principal@meridian.edu');
  tenantId = (await pool.query(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  studentId = (await pool.query(`SELECT id FROM app.students WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`, [tenantId])).rows[0].id;
});
after(async () => { await app?.close(); });

const sqlIstToday = async () => (await pool.query(
  `SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS d`)).rows[0].d;

describe('DAT-7 · the school date is IST', () => {
  test('the kernel helper agrees with Postgres ASIA/KOLKATA', async () => {
    assert.equal(istToday(), await sqlIstToday(),
      'src/ist.js and the database must agree on "today" — two definitions is the defect this closes');
  });

  test('a mark request that omits `date` lands on the IST date', async () => {
    const expected = await sqlIstToday();
    await pool.query(`DELETE FROM app.attendance WHERE tenant_id=$1 AND school_date=$2::date`, [tenantId, expected]);
    const res = await app.inject({ method: 'POST', url: '/attendance/mark', headers: H(principal.token), payload: {
      marks: [{ studentId, status: 'present' }] } });
    assert.equal(res.statusCode, 200, `HTTP ${res.statusCode} ${String(res.body).slice(0, 160)}`);
    const got = (await pool.query(
      `SELECT to_char(school_date, 'YYYY-MM-DD') AS d FROM app.attendance WHERE tenant_id=$1 AND student_id=$2
        ORDER BY school_date DESC LIMIT 1`, [tenantId, studentId])).rows[0].d;
    assert.equal(got, expected, 'the default register date must be the IST school day, not the UTC day');
  });

  test('no UTC date default survives in the doors (source check — the behavioural test is vacuous on most days)', () => {
    for (const rel of ['../src/routes.js', '../src/plugins/people.admin/index.js']) {
      const src = readFileSync(join(HERE, rel), 'utf8');
      const utcDefaults = src.match(/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/g) ?? [];
      assert.deepEqual(utcDefaults, [],
        `${rel} still derives a school date from UTC — use istToday()/IST_TODAY() (src/ist.js)`);
    }
    const routes = readFileSync(join(HERE, '../src/routes.js'), 'utf8');
    assert.match(routes, /const IST_TODAY = istToday/, 'the attendance defaults share the ONE IST definition');
  });
});
