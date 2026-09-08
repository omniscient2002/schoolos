// CoordinatorOS lane CS-1 — coord.view pins.
// The coordinator command-center lessons institutionalized by test, never assumed:
// owner-door enable · home shape (staffing/gaps/approvals/delays/issues) · curriculum
// weeks_behind computed from seeded progress rows against the deterministic IST term
// calendar · workload aggregates with a fairness overload flag and NO score/rank
// field · duty allocation picks the least-loaded candidate deterministically ·
// substitution decide records + audits with proposer≠decider SoD · escalations carry
// append-only timelines and student identity only where the coordinator is the routed
// authority · the copilot is deterministic, honest on unknowns and budgeted (429 at
// 200/month) · teachers refused on every /coord door · doors degrade gracefully when
// sibling-lane tables are absent.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb } from './helpers.js';

let app;
before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  // enable coord.view through the real lifecycle door (registry row from migration 037)
  const owner = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@meridian.edu', password: 'schoolos-demo' }, headers: { 'content-type': 'application/json' } });
  assert.equal(owner.statusCode, 200, owner.body);
  const en = await app.inject({ method: 'POST', url: '/plugins/coord.view/enable', headers: { authorization: `Bearer ${owner.json().token}`, 'content-type': 'application/json' }, payload: { version: '1.0.0', class: 'C' } });
  assert.equal(en.statusCode, 200, en.body);
});
after(async () => { await app?.close(); });

const login = async (email) => {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'schoolos-demo' }, headers: { 'content-type': 'application/json' } });
  assert.equal(r.statusCode, 200, `login ${email}: ${r.body}`);
  return r.json();
};
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const istDow = () => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.now() + 5.5 * 3600 * 1000).getUTCDay()];
// seed.js replays migrations only through 030 (031's demo teacher2 is not seeded),
// so the fairness pins create their second teacher as a fixture here.
const ensureSecondTeacher = async (pool, tenant) => {
  const two = (await pool.query(`SELECT id, name FROM app.users WHERE tenant_id=$1 AND role='teacher' AND active ORDER BY name`, [tenant]));
  if (two.rows.length >= 2) return two.rows;
  await pool.query(
    `INSERT INTO app.users (tenant_id, email, name, role, password_hash, active)
     VALUES ($1,'cs1.teacher2@meridian.edu','A. Bhatia','teacher','x:0',true)
     ON CONFLICT DO NOTHING`, [tenant]);
  return (await pool.query(`SELECT id, name FROM app.users WHERE tenant_id=$1 AND role='teacher' AND active ORDER BY name`, [tenant])).rows;
};

test('role gates: teacher refused on every /coord door', async () => {
  const t = await login('teacher@meridian.edu');
  for (const [method, url] of [
    ['GET', '/coord/home'], ['GET', '/coord/curriculum-monitor'], ['GET', '/coord/teacher-workload'],
    ['GET', '/coord/escalations'], ['POST', '/coord/substitution/decide'],
    ['POST', '/coord/duty/allocate'], ['POST', '/coord/copilot-lite'],
  ]) {
    const r = await app.inject({ method, url, headers: H(t.token), payload: method === 'POST' ? {} : undefined });
    assert.equal(r.statusCode, 403, `${url} → 403 for teacher (got ${r.statusCode})`);
  }
});

test('coord home: staffing/gaps/approvals/delays/issues sections present; absence graded; gap surfaced', async () => {
  const c = await login('coordinator@meridian.edu');
  const { pool } = await import('../src/db.js');
  const tenant = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;
  const t1 = (await pool.query(`SELECT id, name FROM app.users WHERE tenant_id=$1 AND role='teacher' AND active ORDER BY name LIMIT 1`, [tenant])).rows[0];
  const today = istToday();
  // seed: t1 on approved sick leave today + one grid slot for today's day-of-week
  await pool.query(
    `INSERT INTO teacher.leave_request (tenant_id, teacher_id, kind, from_date, to_date, reason, status, decided_by, decided_at)
     SELECT tenant_id, $1, 'sick', $2::date, $2::date, 'CS-1 seed: fever', 'approved', id, now()
     FROM app.users WHERE email='owner@meridian.edu'`, [t1.id, today]);
  const period = (await pool.query(`SELECT id FROM app.timetable_periods WHERE tenant_id=$1 ORDER BY sort_idx LIMIT 1`, [tenant])).rows[0];
  await pool.query(
    `INSERT INTO app.timetable_slots (tenant_id, period_id, day_of_week, subject, teacher_name)
     VALUES ($1,$2,$3,'CS1 Gap Probe',$4) ON CONFLICT DO NOTHING`,
    [tenant, period.id, istDow(), t1.name]);

  const r = await app.inject({ method: 'GET', url: '/coord/home', headers: H(c.token) });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  for (const k of ['staffing_today', 'substitution_gaps', 'pending_approvals', 'curriculum_delays', 'open_issues']) {
    assert.ok(Array.isArray(body[k]), `${k} is an array`);
  }
  const away = body.staffing_today.find((x) => x.teacher === t1.name);
  assert.ok(away, `${t1.name} listed in staffing_today`);
  assert.equal(away.status, 'absent', 'approved sick leave grades absent');
  assert.ok(away.periods_affected >= 1, 'periods affected counted from the grid');
  const gap = body.substitution_gaps.find((g) => g.subject === 'CS1 Gap Probe');
  assert.ok(gap, 'uncovered slot for the absent teacher surfaced');
  assert.equal(gap.uncovered, true);
  assert.ok('class_grade' in gap, 'gap shape carries class_grade (null on the section-agnostic grid)');
  // a coordinator-owned open kernel action appears as pending approval
  await pool.query(
    `INSERT INTO app.actions (tenant_id, code, kind, title, status, owner, owner_role, payload)
     VALUES ($1,$2,'approval','CS-1 approval probe','open','Coordinator','coordinator','{}'::jsonb)
     ON CONFLICT (tenant_id, code) DO NOTHING`,
    [tenant, 'cs1.home.approval.probe']);
  const r2 = await app.inject({ method: 'GET', url: '/coord/home', headers: H(c.token) });
  const pa = r2.json().pending_approvals.find((a) => a.code === 'cs1.home.approval.probe');
  assert.ok(pa, 'coordinator-owned open action listed as pending approval');
  assert.equal(typeof pa.age_hours, 'number');
});

test('curriculum monitor: weeks_behind computed from seeded progress rows', async () => {
  const c = await login('coordinator@meridian.edu');
  const { pool } = await import('../src/db.js');
  const hasCurriculum = (await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='curriculum' AND table_name='node'`)).rows.length > 0;
  if (!hasCurriculum) return; // env without 033 — graceful degradation covered separately
  // seed a private subject×grade tree: 4 topics, one covered at 10% → avg covered 10
  const tenant = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;
  const unit = (await pool.query(
    `INSERT INTO curriculum.node (tenant_id, subject, grade, kind, name, order_no)
     VALUES ($1,'CS1 Probe Subject','9','unit','CS-1 Monitor Unit',90) RETURNING id`, [tenant])).rows[0].id;
  const topicIds = [];
  for (let i = 1; i <= 4; i++) {
    topicIds.push((await pool.query(
      `INSERT INTO curriculum.node (tenant_id, subject, grade, parent_id, kind, name, order_no)
       VALUES ($1,'CS1 Probe Subject','9',$2,'topic',$3,$4) RETURNING id`,
      [tenant, unit, `CS-1 Topic ${i}`, i])).rows[0].id);
  }
  await pool.query(
    `INSERT INTO curriculum.progress (tenant_id, node_id, class_grade, covered_pct)
     VALUES ($1,$2,'9',40) ON CONFLICT (tenant_id, node_id, class_grade) DO UPDATE SET covered_pct=40, updated_at=now()`,
    [tenant, topicIds[0]]);
  const r = await app.inject({ method: 'GET', url: '/coord/curriculum-monitor', headers: H(c.token) });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.available, true);
  const mine = body.monitor.find((m) => m.subject === 'CS1 Probe Subject' && m.class_grade === '9');
  assert.ok(mine, 'seeded subject×grade row present');
  assert.equal(mine.covered_pct, 10, 'covered_pct is the seeded 10% average (40 on one of 4 topics)');
  assert.ok(body.pace.expected_pct >= 0 && body.pace.expected_pct <= 100, 'expected_pct is a term fraction');
  const expectedBehind = Math.max(0, Math.round(((body.pace.expected_pct - 10) / 100) * body.pace.term_weeks * 10) / 10);
  assert.equal(mine.weeks_behind, expectedBehind, 'weeks_behind = (expected − covered)/100 × term weeks');  assert.equal(mine.revision_needed, expectedBehind >= 1, 'revision_needed flips at ≥ 1 week');
  // the delay surfaces on home too (term elapsed > coverage in any realistic window)
  if (expectedBehind > 0) {
    const home = await app.inject({ method: 'GET', url: '/coord/home', headers: H(c.token) });
    assert.ok(home.json().curriculum_delays.some((d) => d.subject === 'CS1 Probe Subject' && d.class_grade === '9'), 'delay listed in home.curriculum_delays');
  }
});

test('teacher workload: aggregates + overload flag, NO score/rank field', async () => {
  const c = await login('coordinator@meridian.edu');
  const { pool } = await import('../src/db.js');
  const tenant = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;
  await ensureSecondTeacher(pool, tenant);
  const r = await app.inject({ method: 'GET', url: '/coord/teacher-workload', headers: H(c.token) });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.ok(Array.isArray(body.workload) && body.workload.length >= 2, 'workload rows for seeded teachers');
  for (const w of body.workload) {
    for (const k of ['teacher_id', 'name', 'periods_week', 'substitutions_month', 'invigilation', 'duties', 'grading_est', 'overload']) {
      assert.ok(k in w, `${k} present`);
    }
    assert.equal(typeof w.overload, 'boolean', 'overload is a boolean flag');
    // the fairness pin: no scoring/ranking vocabulary anywhere in a row
    for (const banned of ['score', 'rank', 'rating', 'percentile', 'position']) {
      assert.ok(!(banned in w), `no "${banned}" field (fairness framing)`);
    }
  }
  // rows are roster order (name ASC) — never load-ordered
  const names = body.workload.map((w) => w.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'name-ordered, not load-ranked');
});

test('duty allocate: picks the least-loaded candidate deterministically', async () => {
  const c = await login('coordinator@meridian.edu');
  const { pool } = await import('../src/db.js');
  const tenant = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;
  const tids = await ensureSecondTeacher(pool, tenant);
  if (tids.length < 2) return; // need two candidates for the fairness pin
  const [tA, tB] = tids;
  const dutyDate = new Date(Date.now() + 5.5 * 3600 * 1000 + 7 * 864e5).toISOString().slice(0, 10); // next week IST
  // the duty roster plane ships with a sibling lane (never this migration) — build the
  // fixture with the house RLS shape when absent (parent-family graceful-degradation
  // precedent: tests may create the missing sibling shape to exercise the flow)
  const hasDuty = (await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='duty' AND table_name='assignment'`)).rows.length > 0;
  if (!hasDuty) {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS duty`);
    await pool.query(`GRANT USAGE ON SCHEMA duty TO schoolos_app`);
    await pool.query(`CREATE TABLE duty.assignment (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL, teacher_id uuid NOT NULL,
      kind text NOT NULL, duty_date date NOT NULL, period text,
      note text, allocated_by uuid, created_at timestamptz NOT NULL DEFAULT now())`);
    await pool.query(`ALTER TABLE duty.assignment ENABLE ROW LEVEL SECURITY`);
    await pool.query(`CREATE POLICY tenant_isolation ON duty.assignment
      USING (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('schoolos.tenant_id', true)::uuid)`);
    await pool.query(`GRANT SELECT, INSERT ON duty.assignment TO schoolos_app`);
  }
  // load A with 3 duties, B with 0 → the pick must be B
  for (let i = 0; i < 3; i++) {
    await pool.query(
      `INSERT INTO duty.assignment (tenant_id, teacher_id, kind, duty_date, period, allocated_by)
       VALUES ($1,$2,'duty',$3::date,$4,NULL)`, [tenant, tA.id, dutyDate, `pre${i}`]);
  }
  const r = await app.inject({ method: 'POST', url: '/coord/duty/allocate', headers: H(c.token), payload: { kind: 'duty', date: dutyDate, period: 'P1', candidates: [tA.id, tB.id] } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().assigned_to.teacher_id, tB.id, 'least-loaded candidate picked (0 < 3)');
  assert.equal(r.json().assigned_load_before, 0);
  const stored = await pool.query(`SELECT teacher_id FROM duty.assignment WHERE id=$1`, [r.json().assignment_id]);
  assert.equal(String(stored.rows[0].teacher_id), tB.id, 'row persisted for the picked teacher');
  // event + audit trail
  const ev = await pool.query(`SELECT 1 FROM app.outbox WHERE topic='duty.assigned.v1'`);
  assert.ok(ev.rows.length >= 1, 'duty.assigned.v1 emitted');
  const au = await pool.query(`SELECT 1 FROM app.audit_log WHERE record_type='DutyAssignment'`);
  assert.ok(au.rows.length >= 1, 'allocation audited');
  // bring B to 3 → 3-3 tie → deterministic name tie-break picks A (alphabetically first)
  for (let i = 0; i < 3; i++) {
    await pool.query(
      `INSERT INTO duty.assignment (tenant_id, teacher_id, kind, duty_date, period, allocated_by)
       VALUES ($1,$2,'duty',$3::date,$4,NULL)`, [tenant, tB.id, dutyDate, `tie${i}`]);
  }
  const r2 = await app.inject({ method: 'POST', url: '/coord/duty/allocate', headers: H(c.token), payload: { kind: 'duty', date: dutyDate, period: 'P2', candidates: [tB.id, tA.id] } });
  assert.equal(r2.statusCode, 200, r2.body);
  assert.equal(r2.json().assigned_to.teacher_id, tA.id, 'tie broken deterministically by name (A < B), never at random');
  // candidate validation: an unknown id is refused
  const bad = await app.inject({ method: 'POST', url: '/coord/duty/allocate', headers: H(c.token), payload: { kind: 'duty', date: dutyDate, candidates: [tA.id, '00000000-0000-4000-8000-000000000000'] } });
  assert.equal(bad.statusCode, 400, 'unknown candidate refused');
});

test('substitution decide: decision recorded + audited + sub.assign.v1; SoD self-approve refused', async () => {
  const c = await login('coordinator@meridian.edu');
  const principal = await login('principal@meridian.edu');
  const { pool } = await import('../src/db.js');
  const uid = async (email) => (await pool.query(`SELECT id FROM app.users WHERE email=$1`, [email])).rows[0].id;
  const mk = async (proposerId, code) => (await pool.query(
    `INSERT INTO app.actions (tenant_id, code, kind, title, detail, why, priority, status, owner, owner_role, policy_ref, ai_involved, payload)
     VALUES ($1,$2,'approval','Substitution: cover P3 Mathematics','cover P3 Mathematics','absence gap','normal','open','Coordinator','coordinator','coord.decision.v1',false,$3::jsonb)
     RETURNING id`, [tenantIdOf, code, JSON.stringify({ kind: 'task', proposed_by: proposerId })])).rows[0].id;
  const tenantIdOf = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;

  const a1 = await mk(await uid('principal@meridian.edu'), 'cs1.sub.ok');
  const a2 = await mk(await uid('coordinator@meridian.edu'), 'cs1.sub.self');

  const ok = await app.inject({ method: 'POST', url: '/coord/substitution/decide', headers: H(c.token), payload: { action_id: a1, decision: 'approved', note: 'ask R. Menon to cover' } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().decision, 'approved');
  assert.equal(ok.json().event, 'sub.assign.v1', 'approval emits sub.assign.v1');
  const row = await pool.query(`SELECT status, decision_note FROM app.actions WHERE id=$1`, [a1]);
  assert.equal(row.rows[0].status, 'approved', 'decision recorded on the action');
  const audit = await pool.query(
    `SELECT 1 FROM app.audit_log WHERE record_ref = (SELECT code FROM app.actions WHERE id=$1) AND action ILIKE '%approved%'`, [a1]);
  assert.ok(audit.rows.length > 0, 'decision audited');

  // SoD (routes.js decide rule): the proposer can never approve their own proposal
  const sod = await app.inject({ method: 'POST', url: '/coord/substitution/decide', headers: H(c.token), payload: { action_id: a2, decision: 'approved' } });
  assert.equal(sod.statusCode, 403, `self-approval refused (got ${sod.statusCode}: ${sod.body})`);
  // rejection path (another authority may reject; no event on rejection)
  const rej = await app.inject({ method: 'POST', url: '/coord/substitution/decide', headers: H(principal.token), payload: { action_id: a2, decision: 'rejected', note: 'no cover available' } });
  assert.equal(rej.statusCode, 200, rej.body);
  assert.equal(rej.json().event, null, 'rejected emits no event');
  const row2 = await pool.query(`SELECT status FROM app.actions WHERE id=$1`, [a2]);
  assert.equal(row2.rows[0].status, 'dismissed', 'rejection recorded (kernel status vocabulary)');
});

test('RT-7 #4: decide-door aliasing refused — a staff-leave action is not a substitution', async () => {
  const c = await login('coordinator@meridian.edu');
  const t = await login('teacher@meridian.edu');
  const { pool } = await import('../src/db.js');
  // classroom plugin rides its own lifecycle door (registry row from migration 031)
  const owner = await login('owner@meridian.edu');
  const en = await app.inject({ method: 'POST', url: '/plugins/teacher.classroom/enable', headers: H(owner.token), payload: { version: '1.0.0', class: 'C' } });
  assert.equal(en.statusCode, 200, en.body);
  // raise a real staff-leave action through the classroom door (code teacher.leave.<uuid>)
  const lv = await app.inject({ method: 'POST', url: '/teacher/leave', headers: H(t.token),
    payload: { kind: 'sick', from_date: istToday(), to_date: istToday(), reason: 'aliasing probe' } });
  assert.equal(lv.statusCode, 200, lv.body);
  const actionId = lv.json().actionId;
  assert.ok(/^[0-9a-f-]{36}$/.test(String(actionId)), 'leave raised a kernel action');
  // the coordinator tries to approve it through the substitution desk
  const r = await app.inject({ method: 'POST', url: '/coord/substitution/decide', headers: H(c.token),
    payload: { action_id: actionId, decision: 'approved', note: 'aliasing probe' } });
  assert.equal(r.statusCode, 409, `aliasing refused (got ${r.statusCode}: ${r.body})`);
  assert.equal(r.json().error, 'This decision belongs to a different desk');
  // NO side effects: the action is still open and the leave still pending
  const row = await pool.query(`SELECT status FROM app.actions WHERE id=$1`, [actionId]);
  assert.equal(row.rows[0].status, 'open', 'action untouched');
  const leave = await pool.query(`SELECT status FROM teacher.leave_request WHERE id=$1`, [lv.json().requestId]);
  assert.equal(leave.rows[0].status, 'pending', 'leave stays pending');
  // no substitution event was emitted for the foreign action
  const ev = await pool.query(`SELECT 1 FROM app.outbox WHERE topic='sub.assign.v1' AND payload::text LIKE $1`, ['%' + actionId + '%']);
  assert.equal(ev.rows.length, 0, 'no sub.assign.v1 for a leave action');
});

test('escalations: list + append-only timeline + authority-scoped student identity', async () => {
  const c = await login('coordinator@meridian.edu');
  const { pool } = await import('../src/db.js');
  const tenant = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;
  const parent = (await pool.query(`SELECT id FROM app.users WHERE tenant_id=$1 AND role='parent' ORDER BY id LIMIT 1`, [tenant])).rows[0].id;
  const student = (await pool.query(`SELECT id, name FROM app.students WHERE tenant_id=$1 ORDER BY id LIMIT 1`, [tenant])).rows[0];
  const teacher = (await pool.query(`SELECT id FROM app.users WHERE tenant_id=$1 AND role='teacher' ORDER BY id LIMIT 1`, [tenant])).rows[0].id;
  const principal = (await pool.query(`SELECT id FROM app.users WHERE tenant_id=$1 AND role='principal' ORDER BY id LIMIT 1`, [tenant])).rows[0].id;
  // open coordinator-owned family request (reevaluation) with one history event
  const req = (await pool.query(
    `INSERT INTO family.request (tenant_id, guardian_id, child_id, category, title, payload, owner_role, sla_at)
     VALUES ($1,$2,$3,'reevaluation','CS-1 re-evaluation request','{}'::jsonb,'coordinator', now() + interval '72 hours') RETURNING id`,
    [tenant, parent, student.id])).rows[0].id;
  await pool.query(
    `INSERT INTO family.request_event (tenant_id, request_id, to_status, note, actor_id) VALUES ($1,$2,'submitted','CS-1 seed event',NULL)`,
    [tenant, req]);
  // one OPEN concern (awaiting routing → coordinator authority) and one ROUTED concern
  const openC = (await pool.query(
    `INSERT INTO teacher.concern (tenant_id, student_id, filed_by, category, urgency, detail)
     VALUES ($1,$2,$3,'academic','high','CS-1 seed: open concern') RETURNING id`, [tenant, student.id, teacher])).rows[0].id;
  await pool.query(
    `INSERT INTO teacher.concern_status_event (tenant_id, concern_id, to_status, note, actor_id) VALUES ($1,$2,'open','concern filed',$3)`,
    [tenant, openC, teacher]);
  const routedC = (await pool.query(
    `INSERT INTO teacher.concern (tenant_id, student_id, filed_by, category, urgency, detail)
     VALUES ($1,$2,$3,'wellbeing','normal','CS-1 seed: routed concern') RETURNING id`, [tenant, student.id, teacher])).rows[0].id;
  await pool.query(
    `INSERT INTO teacher.concern_status_event (tenant_id, concern_id, to_status, note, actor_id) VALUES ($1,$2,'open','concern filed',$3)`,
    [tenant, routedC, teacher]);
  await pool.query(
    `UPDATE teacher.concern SET status='routed', routed_to=$2, routed_role='counselor', routed_by=$3 WHERE id=$1`,
    [routedC, principal, teacher]);
  await pool.query(
    `INSERT INTO teacher.concern_status_event (tenant_id, concern_id, from_status, to_status, note, actor_id) VALUES ($1,$2,'open','routed','routed to counselor',$3)`,
    [tenant, routedC, teacher]);

  const r = await app.inject({ method: 'GET', url: '/coord/escalations', headers: H(c.token) });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.ok(Array.isArray(body.escalations), 'escalations array');
  const mine = body.escalations.find((e) => e.source === 'family_request' && e.id === req);
  assert.ok(mine, 'seeded family request listed');
  assert.equal(mine.kind, 'reevaluation', 're-evaluation requests flagged');
  assert.equal(mine.student, student.name, 'coordinator is the routed authority → student identity present');
  assert.ok(Array.isArray(mine.timeline) && mine.timeline.length >= 1, 'family timeline present');
  assert.ok(mine.timeline.some((e) => e.to === 'submitted'), 'submitted event in timeline');
  const open = body.escalations.find((e) => e.source === 'teacher_concern' && e.id === openC);
  assert.ok(open, 'open concern listed');
  assert.equal(open.student, student.name, 'open concern: coordinator routes it → identity present');
  assert.ok(open.timeline.length >= 1, 'concern timeline present');
  const routed = body.escalations.find((e) => e.source === 'teacher_concern' && e.id === routedC);
  assert.ok(routed, 'routed concern still visible for oversight');
  assert.equal(routed.student, null, 'concern routed to another desk → NO student identity (privacy tiering)');
});

test('copilot-lite: intents routed, honest unknown, budget 429', async () => {
  const c = await login('coordinator@meridian.edu');
  const Hc = H(c.token);
  const ask = async (question) => app.inject({ method: 'POST', url: '/coord/copilot-lite', headers: Hc, payload: { question } });

  const s = await ask('Give me a quick summary for today');
  assert.equal(s.statusCode, 200, s.body);
  assert.equal(s.json().intent, 'summary');
  assert.ok(s.json().sources.length > 0, 'summary grounded with sources');
  assert.equal(s.json().budget.used >= 1, true, 'budget row written');

  assert.equal((await ask('Which class is behind on curriculum coverage?')).json().intent, 'curriculum');
  const sub = await ask('Who is absent and needs a substitution?');
  assert.equal(sub.json().intent, 'substitution');
  assert.match(sub.json().answer, /away|absence|covered/i);
  assert.equal((await ask('Any intervention concerns open right now?')).json().intent, 'intervention');

  const unk = await ask('What is the canteen menu on Friday?');
  assert.equal(unk.statusCode, 200);
  assert.equal(unk.json().intent, 'unknown');
  assert.equal(unk.json().sources.length, 0, 'unknown answers carry no fabricated sources');
  assert.match(unk.json().answer, /don't have data|won't guess/i, 'honest empty answer — copilot never invents');

  // budget: fill coord.copilot_call to the 200/month cap → plain 429
  const { pool } = await import('../src/db.js');
  const tenant = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;
  const uid = (await pool.query(`SELECT id FROM app.users WHERE email='coordinator@meridian.edu'`)).rows[0].id;
  const used = (await pool.query(`SELECT count(*)::int AS n FROM coord.copilot_call WHERE tenant_id=$1 AND user_id=$2`, [tenant, uid])).rows[0].n;
  const need = 200 - used;
  await pool.query(
    `INSERT INTO coord.copilot_call (tenant_id, user_id, verb, budget_class)
     SELECT $1,$2,'ask','coordinator_tier' FROM generate_series(1, GREATEST(0, $3::int)) g`,
    [tenant, uid, need]);
  const blocked = await ask('summary again');
  assert.equal(blocked.statusCode, 429, `budget exhausted → 429 (got ${blocked.statusCode}: ${blocked.body})`);
  assert.ok(!('answer' in blocked.json()), 'no answer body past the budget');
  assert.match(blocked.json().error, /limit/i, 'plain budget copy');
});

test('graceful degradation: doors stay green when sibling-lane tables are absent', async () => {
  // the principal runs this suite-last pass (fresh copilot budget — the coordinator's
  // 200/month ledger was deliberately exhausted by the budget test above)
  const c = await login('principal@meridian.edu');
  const { pool } = await import('../src/db.js');
  // simulate a tenant where the sibling lanes have not been built (run LAST — fresh DB per run)
  await pool.query(`DROP TABLE IF EXISTS teacher.submission, teacher.homework, teacher.leave_request, teacher.concern_status_event, teacher.concern CASCADE`);
  await pool.query(`DROP TABLE IF EXISTS curriculum.progress, curriculum.node, duty.assignment CASCADE`);
  const home = await app.inject({ method: 'GET', url: '/coord/home', headers: H(c.token) });
  assert.equal(home.statusCode, 200, home.body);
  const hb = home.json();
  for (const k of ['staffing_today', 'substitution_gaps', 'pending_approvals', 'curriculum_delays', 'open_issues']) {
    assert.ok(Array.isArray(hb[k]), `${k} still an array when teacher tables are absent`);
  }
  assert.equal(hb.open_issues.length, 0, 'no issues when the concern plane is absent');
  assert.equal(hb.staffing_today.every((s) => s.status === 'present'), true, 'no leave facts → everyone present');
  const mon = await app.inject({ method: 'GET', url: '/coord/curriculum-monitor', headers: H(c.token) });
  assert.equal(mon.statusCode, 200, mon.body);
  assert.equal(mon.json().available, false, 'monitor reports the data plane honestly');
  assert.equal(mon.json().monitor.length, 0);
  const wl = await app.inject({ method: 'GET', url: '/coord/teacher-workload', headers: H(c.token) });
  assert.equal(wl.statusCode, 200, wl.body);
  assert.equal(wl.json().workload.every((w) => w.overload === false), true, 'no duty facts → no overload flags');
  assert.ok(wl.json().workload.every((w) => !('score' in w || 'rank' in w)), 'fairness framing preserved');
  const esc = await app.inject({ method: 'GET', url: '/coord/escalations', headers: H(c.token) });
  assert.equal(esc.statusCode, 200, esc.body);
  assert.ok(esc.json().escalations.every((e) => e.source === 'family_request'), 'escalations degrade to the family plane');
  const ask = await app.inject({ method: 'POST', url: '/coord/copilot-lite', headers: H(c.token), payload: { question: 'summary' } });
  assert.equal(ask.statusCode, 200, ask.body);
  assert.equal(ask.json().intent, 'summary', 'copilot answers from what exists');
  const anyTeacher = (await pool.query(`SELECT id FROM app.users WHERE tenant_id=(SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu') AND role='teacher' AND active LIMIT 1`)).rows[0].id;
  const duty = await app.inject({ method: 'POST', url: '/coord/duty/allocate', headers: H(c.token), payload: { kind: 'duty', date: istToday(), candidates: [anyTeacher] } });
  assert.equal(duty.statusCode, 409, 'duty allocation refuses plainly when the plane is absent');
});
