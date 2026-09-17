// teacher.copilot — DAT-7: the mastery READ-PATH WRITES are audited on real change only.
//
// The defect this suite pins: `resolveMasteryState` (src/plugins/teacher.copilot/index.js) is
// reached from the two GET mastery doors and performs real persistence — INSERT mastery.state,
// the fresh-evidence refresh UPDATE, and the one-shot A3 decay UPDATE. Both doors are GETs the
// UI polls, and neither wrote a ledger row, so a student's persisted level could move permanently
// with no entry in app.audit_log. The sibling teacher-copilot suite already asserted the
// *persisted level*, which is exactly why it never caught this: the write was visible, its
// provenance was not.
//
// The fix's shape is asserted here, not just its existence:
//   · a read that CHANGED state writes ONE row naming the acting staff member and the change;
//   · a read that changed NOTHING writes NOTHING (the anti-noise pin — an unconditional audit
//     call on a polled GET would bury the ledger in the noise it exists to cut through);
//   · a level move (both directions — evidence-added recovery and evidence-expired decay) records
//     the from/to levels, so the row answers "what did it become, and from what";
//   · BOTH doors are covered, not just the per-student one.
//
// One suite per process (own database, per TEST_DB_NAME) — setupTestDb() recreates it.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let app;
let sql;
const tokens = {}; // login cache — the limiter allows 20 logins/min, suites share it
async function tok(email) {
  if (!tokens[email]) tokens[email] = (await loginAs(app, email)).token;
  return tokens[email];
}

let teacherToken;
let teacherName;        // the ledger `actor` must be this, never 'system'
let tenantId;
// The 033 seed ships the 90-node tree; these two are deliberately private to this suite so no
// assertion here depends on what the sibling suite left behind.
let mathTopicA;         // used by the per-student-door tests
let mathTopicB;         // used by the class-door test
let studentA;           // target of the per-student-door tests
let studentB;           // target of the class-door test

const auditCount = async (recordRef) => (await sql(
  `SELECT count(*)::int n FROM app.audit_log
    WHERE record_type='MasteryState' AND actor_role='plugin:teacher.copilot' AND record_ref=$1`,
  [String(recordRef)])).rows[0].n;

const stateIdOf = async (studentId, nodeId) => (await sql(
  `SELECT id FROM mastery.state WHERE student_id=$1 AND subject='Mathematics' AND node_id=$2`,
  [studentId, nodeId])).rows[0]?.id;

// evidence INSERT mirroring the sibling suite's pattern (tenant_id sourced from the student row
// so the authoring role never has to know the tenant id).
const addEvidence = async (studentId, nodeId, value, { expiresIn = '30 days' } = {}) => {
  await sql(`INSERT INTO mastery.evidence (tenant_id, student_id, subject, node_id, kind, ref, value, observed_at, expires_at)
             SELECT tenant_id, $1, 'Mathematics', $2, 'assessment', 'mastery-audit-test', $3, now(), now() + $4::interval
             FROM app.students WHERE id=$1`, [studentId, nodeId, value, expiresIn]);
};
const expireEvidence = async (studentId, nodeId) => {
  await sql(`UPDATE mastery.evidence SET expires_at = now() - interval '1 hour'
              WHERE student_id=$1 AND node_id=$2`, [studentId, nodeId]);
};

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const r = await c.query(text, params);
    await c.end();
    return r;
  };
  teacherToken = await tok('teacher@meridian.edu');
  const t = (await sql(`SELECT id, tenant_id, name FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0];
  teacherName = t.name;
  tenantId = t.tenant_id;
  // enable the plugin (the lifecycle gate requires an enabled registry row)
  const o = await tok('owner@meridian.edu');
  const en = await app.inject({ method: 'POST', url: '/plugins/teacher.copilot/enable',
    payload: { version: '0.1.0', class: 'C' }, headers: H(o) });
  assert.equal(en.statusCode, 200, `enable failed: ${en.body}`);

  // two private topics, one per door under test
  const unit = (await sql(`SELECT id FROM curriculum.node
                            WHERE subject='Mathematics' AND grade='8' AND kind='unit' ORDER BY order_no LIMIT 1`)).rows[0].id;
  const topics = (await sql(`SELECT id FROM curriculum.node
                              WHERE parent_id=$1 AND kind='topic' ORDER BY order_no LIMIT 2`, [unit])).rows;
  mathTopicA = topics[0].id;
  mathTopicB = topics[1].id;

  // two private grade-8 students, created by this suite (no dependency on seed row identity)
  studentA = (await sql(`INSERT INTO app.students (tenant_id, admission_no, name, grade, section)
                         SELECT tenant_id, 'DAT7-A', 'DAT-7 Probe Student A', '8', 'Z' FROM app.students LIMIT 1
                         RETURNING id`)).rows[0].id;
  studentB = (await sql(`INSERT INTO app.students (tenant_id, admission_no, name, grade, section)
                         SELECT tenant_id, 'DAT7-B', 'DAT-7 Probe Student B', '8', 'Z' FROM app.students LIMIT 1
                         RETURNING id`)).rows[0].id;
  // precondition: neither probe cell has a persisted label yet
  const pre = await sql(`SELECT count(*)::int n FROM mastery.state WHERE student_id IN ($1,$2)`, [studentA, studentB]);
  assert.equal(pre.rows[0].n, 0, 'precondition: no mastery.state row for the probe students');
});

describe('teacher.copilot — DAT-7: mastery read-path writes are audited', () => {
  test('1 · per-student door: the FIRST read writes a state row AND one audit row naming the acting user', async () => {
    // 85/90/80 → avg 85 → 'secure', 3 rows → confidence 'high' (evidence counts, negative labels never)
    for (const v of [85, 90, 80]) await addEvidence(studentA, mathTopicA, v);

    const before = await sql(`SELECT count(*)::int n FROM mastery.state WHERE student_id=$1`, [studentA]);
    assert.equal(before.rows[0].n, 0, 'no state row before the read');

    const r = await app.inject({ method: 'GET', url: `/mastery/student/${studentA}?subject=Mathematics`, headers: H(teacherToken) });
    assert.equal(r.statusCode, 200, r.body);
    const cell = r.json().map.find((m) => m.nodeId === mathTopicA);
    assert.equal(cell.level, 'secure', 'the read created the label');
    assert.equal(cell.confidence, 'high');

    // the row really exists now (the write is real, not a projection in the response only)
    const stateId = await stateIdOf(studentA, mathTopicA);
    assert.ok(stateId, 'the GET persisted a mastery.state row');
    const after = await sql(`SELECT count(*)::int n FROM mastery.state WHERE student_id=$1`, [studentA]);
    assert.equal(after.rows[0].n, 1, 'exactly one cell persisted for this student');

    // …and the change is now evidence, not a silent mutation
    const rows = (await sql(`SELECT actor, actor_role, action, record_type, record_ref, risk, outcome, policy_ref
                             FROM app.audit_log WHERE record_type='MasteryState' AND record_ref=$1`, [String(stateId)])).rows;
    assert.equal(rows.length, 1, `expected exactly one audit row for the created label, got ${rows.length}`);
    const a = rows[0];
    assert.equal(a.actor, teacherName, 'the ledger names the acting staff member (never "system")');
    assert.notEqual(a.actor, 'system', 'a named read must be attributed to the human who caused it');
    assert.equal(a.actor_role, 'plugin:teacher.copilot', 'plugin provenance is stamped');
    assert.equal(a.record_type, 'MasteryState');
    assert.match(a.action, /mastery label created/i, 'the action says what kind of change this was');
    assert.match(String(a.outcome), /secure/, 'the outcome records the level it became');
    assert.match(String(a.outcome), /no label/, 'the outcome records what it was before (there was no label)');
    assert.equal(a.risk, 'low', 'a polled read-path projection of evidence is low risk, chosen honestly');
    assert.ok(a.policy_ref, 'a policy reference is recorded');
  });

  test('2 · per-student door: the SECOND read changes nothing and writes NO additional audit row (anti-noise)', async () => {
    const stateId = await stateIdOf(studentA, mathTopicA);
    assert.ok(stateId, 'precondition: test 1 created the row');
    const auditBefore = await auditCount(stateId);
    const stateBefore = await sql(`SELECT level, confidence, computed_at, updated_at FROM mastery.state WHERE id=$1`, [stateId]);
    assert.equal(auditBefore, 1, 'precondition: exactly one audit row from the creating read');

    // identical read — the UI polls this door; nothing about the cell has changed
    const again = await app.inject({ method: 'GET', url: `/mastery/student/${studentA}?subject=Mathematics`, headers: H(teacherToken) });
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().map.find((m) => m.nodeId === mathTopicA).level, 'secure');

    // a third read, to make sure this is not a one-shot accident
    const third = await app.inject({ method: 'GET', url: `/mastery/student/${studentA}?subject=Mathematics`, headers: H(teacherToken) });
    assert.equal(third.statusCode, 200, third.body);

    const auditAfter = await auditCount(stateId);
    assert.equal(auditAfter, 1,
      `a no-change read must write NOTHING to the ledger (was ${auditBefore}, became ${auditAfter})`);

    const ledger = await sql(`SELECT count(*)::int n FROM app.audit_log WHERE record_type='MasteryState'`);
    assert.equal(ledger.rows[0].n, 1, 'no extra mastery ledger rows anywhere after two no-change reads');

    const stateAfter = await sql(`SELECT level, confidence, computed_at, updated_at FROM mastery.state WHERE id=$1`, [stateId]);
    assert.equal(stateAfter.rows[0].level, 'secure');
    assert.deepEqual(stateAfter.rows[0].computed_at, stateBefore.rows[0].computed_at,
      'the no-change path did not even touch the row (so there is nothing to audit)');
    assert.deepEqual(stateAfter.rows[0].updated_at, stateBefore.rows[0].updated_at);
  });

  test('3 · per-student door: a level MOVE records one audit row carrying the from/to levels', async () => {
    // a second private cell: one weak fresh evidence row → 'needs_support', confidence 'low'
    await addEvidence(studentA, mathTopicB, 20);
    const first = await app.inject({ method: 'GET', url: `/mastery/student/${studentA}?subject=Mathematics`, headers: H(teacherToken) });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().map.find((m) => m.nodeId === mathTopicB).level, 'needs_support');
    const stateId = await stateIdOf(studentA, mathTopicB);
    assert.ok(stateId, 'the read created the second cell');
    assert.equal(await auditCount(stateId), 1, 'the creation read is audited');

    // the underlying EVIDENCE changes so the label moves: 3 strong rows average 85 → 'secure'
    for (const v of [85, 90, 80]) await addEvidence(studentA, mathTopicB, v);
    const moved = await app.inject({ method: 'GET', url: `/mastery/student/${studentA}?subject=Mathematics`, headers: H(teacherToken) });
    assert.equal(moved.statusCode, 200, moved.body);
    assert.equal(moved.json().map.find((m) => m.nodeId === mathTopicB).level, 'secure', 'the level moved');

    const n = await auditCount(stateId);
    assert.equal(n, 2, `the moving read must add exactly one row (got ${n})`);
    const a = (await sql(`SELECT actor, action, outcome, record_ref FROM app.audit_log
                           WHERE record_type='MasteryState' AND record_ref=$1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [String(stateId)])).rows[0];
    assert.equal(a.actor, teacherName, 'the move is attributed to the real user');
    assert.equal(a.record_ref, String(stateId), 'the row points at the mastery.state row it changed');
    assert.match(String(a.outcome), /needs_support/, 'the from-level is recorded');
    assert.match(String(a.outcome), /secure/, 'the to-level is recorded');
    assert.match(a.action, /mastery label refreshed/i);

    // and the moved-to state is now stable: another read adds nothing
    const stable = await app.inject({ method: 'GET', url: `/mastery/student/${studentA}?subject=Mathematics`, headers: H(teacherToken) });
    assert.equal(stable.statusCode, 200, stable.body);
    assert.equal(await auditCount(stateId), 2, 'the post-move no-change read writes nothing');
  });

  test('4 · class door: GET /mastery/class/:grade is audited on change too (and not on a no-change poll)', async () => {
    // a private cell for the class door: one weak fresh row → needs_support
    await addEvidence(studentB, mathTopicB, 20);
    const ledgerBefore = (await sql(`SELECT count(*)::int n FROM app.audit_log WHERE record_type='MasteryState'`)).rows[0].n;

    const cls = await app.inject({ method: 'GET', url: '/mastery/class/8?subject=Mathematics', headers: H(teacherToken) });
    assert.equal(cls.statusCode, 200, cls.body);
    const cell = cls.json().cells.find((c) => c.studentId === studentB && c.topicId === mathTopicB);
    assert.ok(cell, 'the class map carries the probe cell');
    assert.equal(cell.level, 'needs_support');

    const stateId = await stateIdOf(studentB, mathTopicB);
    assert.ok(stateId, 'the class-door read persisted the row');
    assert.equal(await auditCount(stateId), 1, 'the class door audited the label it created');
    const a = (await sql(`SELECT actor, action, outcome FROM app.audit_log
                           WHERE record_type='MasteryState' AND record_ref=$1`, [String(stateId)])).rows[0];
    assert.equal(a.actor, teacherName, 'the class-map read names the staff member who triggered it');
    assert.match(a.action, /mastery label created/i);
    assert.match(String(a.outcome), /needs_support/);

    // decay through the class door: expiry slides the label one step; it is FLOORED here
    // (needs_support is the bottom), so the confidence still flips low and the write is ledgered
    await expireEvidence(studentB, mathTopicB);
    const classAgain = await app.inject({ method: 'GET', url: '/mastery/class/8?subject=Mathematics', headers: H(teacherToken) });
    assert.equal(classAgain.statusCode, 200, classAgain.body);
    const decayed = classAgain.json().cells.find((c) => c.studentId === studentB && c.topicId === mathTopicB);
    assert.equal(decayed.level, 'needs_support', 'decay floors at needs_support');
    assert.equal(decayed.decayed, true);
    assert.equal(await auditCount(stateId), 2, 'the class door audited the real state change');
    const d = (await sql(`SELECT outcome, action FROM app.audit_log
                           WHERE record_type='MasteryState' AND record_ref=$1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [String(stateId)])).rows[0];
    assert.match(d.action, /mastery label decayed/i, 'the decay is named as a decay, not a generic edit');
    assert.match(String(d.outcome), /needs_support/, 'the floored from/to level is recorded');

    // a further poll of the same class screen changes nothing → no ledger growth
    const ledgerAfterDecay = (await sql(`SELECT count(*)::int n FROM app.audit_log WHERE record_type='MasteryState'`)).rows[0].n;
    const poll = await app.inject({ method: 'GET', url: '/mastery/class/8?subject=Mathematics', headers: H(teacherToken) });
    assert.equal(poll.statusCode, 200, poll.body);
    const ledgerAfterPoll = (await sql(`SELECT count(*)::int n FROM app.audit_log WHERE record_type='MasteryState'`)).rows[0].n;
    assert.equal(ledgerAfterPoll, ledgerAfterDecay, 'a class-map poll that changes nothing writes no ledger row');
    assert.equal(await auditCount(stateId), 2, 'the decayed cell is idempotent: no second slide, no second row');
    assert.ok(ledgerAfterDecay > ledgerBefore, 'the class door did write rows for the changes it made');
  });

  test('5 · the ledger row is inside the same transaction as the write (a rolled-back read leaves neither)', async () => {
    // The audit is written through the same `c` client inside withUser(), so a failure after the
    // state write cannot leave an unledgered state row. Asserted structurally: every MasteryState
    // ledger row's record_ref resolves to a real mastery.state row, and vice versa for the writes
    // this suite caused.
    const orphans = (await sql(
      `SELECT count(*)::int n FROM app.audit_log a
        WHERE a.record_type='MasteryState'
          AND NOT EXISTS (SELECT 1 FROM mastery.state s WHERE s.id::text = a.record_ref)`)).rows[0].n;
    assert.equal(orphans, 0, 'no ledger row references a mastery.state row that does not exist');
    const unledgered = (await sql(
      `SELECT count(*)::int n FROM mastery.state s
        WHERE s.student_id IN ($1,$2)
          AND NOT EXISTS (SELECT 1 FROM app.audit_log a
                           WHERE a.record_type='MasteryState' AND a.record_ref = s.id::text)`,
      [studentA, studentB])).rows[0].n;
    assert.equal(unledgered, 0, 'every state row this suite created carries its provenance');
    assert.match(String(tenantId), UUID, 'sanity: the fixture resolved a real tenant');
  });
});
