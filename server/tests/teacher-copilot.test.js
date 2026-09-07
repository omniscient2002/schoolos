// teacher.copilot (TeacherOS lane TS-3, migration 033) — unit suite (v0, deterministic).
// Pins: A1 seeded curriculum + audited teacher check-off · A3 mastery decay (expired
// evidence downgrades ONE step, exactly once, recovery on fresh evidence) · brief
// shape with graceful degradation when sibling lanes' tables are absent · drafts are
// labelled ai_draft templates (no model calls) · RLS tenant isolation on every table ·
// brief/ask/draft are teacher-role-only · lifecycle gate.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let app;
let sql;
let teacherToken;
let studentId;          // a grade-8 student for mastery tests
let mathTopic8;         // a class-8 Mathematics topic node id
let unit8;              // its unit id (for the kind guard)

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
  const t = await loginAs(app, 'teacher@meridian.edu');
  teacherToken = t.token;
  // enable the plugin (lifecycle gate requires an enabled registry row)
  const o = await loginAs(app, 'owner@meridian.edu');
  const en = await app.inject({ method: 'POST', url: '/plugins/teacher.copilot/enable',
    payload: { version: '0.1.0', class: 'C' }, headers: H(o.token) });
  assert.equal(en.statusCode, 200, `enable failed: ${en.body}`);
  // fixtures: student, curriculum nodes
  studentId = (await sql(`SELECT id FROM app.students WHERE grade='8' ORDER BY created_at LIMIT 1`)).rows[0].id;
  const units = await sql(`SELECT id, name FROM curriculum.node WHERE subject='Mathematics' AND grade='8' AND kind='unit' ORDER BY order_no`);
  unit8 = units.rows[0].id;
  mathTopic8 = (await sql(`SELECT id FROM curriculum.node WHERE parent_id=$1 AND kind='topic' ORDER BY order_no LIMIT 1`, [unit8])).rows[0].id;
});

describe('teacher.copilot v0 — curriculum (A1: seeded, never teacher-typed)', () => {
  test('tree returns the seeded units+topics for Mathematics class 8; rejects bad subject/grade', async () => {
    const r = await app.inject({ method: 'GET', url: '/curriculum/tree?subject=Mathematics&grade=8', headers: H(teacherToken) });
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    assert.equal(body.subject, 'Mathematics');
    assert.equal(body.grade, '8');
    assert.ok(body.units.length >= 3, 'seed guarantees 3 units per subject-grade');
    const topics = body.units.flatMap((u) => u.topics);
    assert.ok(topics.length >= 12, 'seed guarantees 4 topics per unit (3×4)');
    for (const t of topics) {
      assert.match(t.topicId, UUID);
      assert.equal(t.coveredPct, 0, 'nothing ticked yet');
      assert.equal(t.covered, false);
    }
    const badSub = await app.inject({ method: 'GET', url: '/curriculum/tree?subject=History&grade=8', headers: H(teacherToken) });
    assert.equal(badSub.statusCode, 400, 'plain-language rejection of non-seeded subject');
    const badGrade = await app.inject({ method: 'GET', url: '/curriculum/tree?subject=Mathematics&grade=banana', headers: H(teacherToken) });
    assert.equal(badGrade.statusCode, 400);
  });

  test('progress check-off upserts, is audited, and guards: bad pct / unit node / unknown node', async () => {
    const r = await app.inject({ method: 'POST', url: '/curriculum/progress',
      payload: { node_id: mathTopic8, class_grade: '8', pct: 100 }, headers: H(teacherToken) });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().progress.covered_pct, 100);
    // re-tick → upsert, not a second row
    const again = await app.inject({ method: 'POST', url: '/curriculum/progress',
      payload: { node_id: mathTopic8, class_grade: '8', pct: 60 }, headers: H(teacherToken) });
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().progress.covered_pct, 60);
    const rows = await sql(`SELECT count(*)::int n FROM curriculum.progress WHERE node_id=$1 AND class_grade='8'`, [mathTopic8]);
    assert.equal(rows.rows[0].n, 1, 'one coverage row per (tenant, node, class)');
    // audited
    const audit = await sql(`SELECT count(*)::int n FROM app.audit_log WHERE record_type='CurriculumProgress' AND actor_role='plugin:teacher.copilot'`);
    assert.ok(audit.rows[0].n >= 2, 'each check-off writes the plugin audit trail');
    // tree now shows coverage
    const tree = await app.inject({ method: 'GET', url: '/curriculum/tree?subject=Mathematics&grade=8', headers: H(teacherToken) });
    const ticked = tree.json().units.flatMap((u) => u.topics).find((t) => t.topicId === mathTopic8);
    assert.equal(ticked.coveredPct, 60);
    assert.equal(ticked.covered, false, '60% is not fully covered');
    // guards
    const badPct = await app.inject({ method: 'POST', url: '/curriculum/progress',
      payload: { node_id: mathTopic8, class_grade: '8', pct: 140 }, headers: H(teacherToken) });
    assert.equal(badPct.statusCode, 400);
    const unitTick = await app.inject({ method: 'POST', url: '/curriculum/progress',
      payload: { node_id: unit8, class_grade: '8', pct: 100 }, headers: H(teacherToken) });
    assert.equal(unitTick.statusCode, 400, 'units are not tickable — topics only');
    const ghost = await app.inject({ method: 'POST', url: '/curriculum/progress',
      payload: { node_id: '00000000-0000-0000-0000-000000000000', class_grade: '8', pct: 100 }, headers: H(teacherToken) });
    assert.equal(ghost.statusCode, 404);
  });
});

describe('teacher.copilot v0 — mastery (A3: labels decay with evidence)', () => {
  test('seeded evidence → secure; after expiry → ONE-step downgrade + confidence low, exactly once (idempotent)', async () => {
    // three strong fresh evidence rows → label secure, confidence high
    for (const v of [85, 90, 80]) {
      await sql(`INSERT INTO mastery.evidence (tenant_id, student_id, subject, node_id, kind, ref, value, observed_at, expires_at)
                 SELECT tenant_id, $2, 'Mathematics', $3, 'assessment', 'seed-test', $4, now(), now() + interval '30 days'
                 FROM app.students WHERE id=$2`, [studentId, studentId, mathTopic8, v]);
    }
    const before = await app.inject({ method: 'GET', url: `/mastery/student/${studentId}?subject=Mathematics`, headers: H(teacherToken) });
    assert.equal(before.statusCode, 200, before.body);
    const cellBefore = before.json().map.find((m) => m.nodeId === mathTopic8);
    assert.equal(cellBefore.level, 'secure');
    assert.equal(cellBefore.confidence, 'high', '3 evidence rows → high confidence');
    assert.ok(cellBefore.evidence.length >= 3, 'label click-through to evidence');
    assert.equal(cellBefore.evidence[0].expired, false);

    // expire ALL of the evidence (A3 decay trigger)
    await sql(`UPDATE mastery.evidence SET expires_at = now() - interval '1 hour' WHERE student_id=$1 AND node_id=$2`, [studentId, mathTopic8]);
    const after = await app.inject({ method: 'GET', url: `/mastery/student/${studentId}?subject=Mathematics`, headers: H(teacherToken) });
    const cellAfter = after.json().map.find((m) => m.nodeId === mathTopic8);
    assert.equal(cellAfter.level, 'developing', 'secure slides exactly ONE step on expiry');
    assert.equal(cellAfter.confidence, 'low', 'decayed confidence is low');
    assert.equal(cellAfter.decayed, true);
    const persisted = await sql(`SELECT level, confidence, derived_from FROM mastery.state WHERE student_id=$1 AND node_id=$2`, [studentId, mathTopic8]);
    assert.equal(persisted.rows[0].level, 'developing', 'decay is persisted');
    assert.equal(persisted.rows[0].derived_from.reason, 'evidence_expired');

    // re-read → idempotent: NO second slide, level stays developing
    const again = await app.inject({ method: 'GET', url: `/mastery/student/${studentId}?subject=Mathematics`, headers: H(teacherToken) });
    const cellAgain = again.json().map.find((m) => m.nodeId === mathTopic8);
    assert.equal(cellAgain.level, 'developing', 'no double-sliding on later reads');
    assert.equal(cellAgain.confidence, 'low');

    // fresh evidence arrives → deterministic recovery to the evidence level
    await sql(`INSERT INTO mastery.evidence (tenant_id, student_id, subject, node_id, kind, ref, value)
               SELECT tenant_id, $2, 'Mathematics', $3, 'homework', 'recovery', 70 FROM app.students WHERE id=$2`, [studentId, mathTopic8]);
    const recovered = await app.inject({ method: 'GET', url: `/mastery/student/${studentId}?subject=Mathematics`, headers: H(teacherToken) });
    const cellRecovered = recovered.json().map.find((m) => m.nodeId === mathTopic8);
    assert.equal(cellRecovered.level, 'developing', 'one 70-value on top of decay → evidence label (developing)');
    assert.equal(cellRecovered.decayed, false, 'recovery clears the decayed read-flag');
  });

  test('floor: developing + expiry lands on needs_support; no evidence at all → no label (no negative labels on minors)', async () => {
    // a second topic: weak evidence → needs_support already; expiry must FLOOR there
    const t2 = (await sql(`SELECT id FROM curriculum.node WHERE parent_id=$1 AND kind='topic' ORDER BY order_no OFFSET 1 LIMIT 1`, [unit8])).rows[0].id;
    await sql(`INSERT INTO mastery.evidence (tenant_id, student_id, subject, node_id, kind, ref, value, observed_at, expires_at)
               SELECT tenant_id, $2, 'Mathematics', $3, 'quiz', 'weak', 20, now(), now() + interval '7 days' FROM app.students WHERE id=$2`, [studentId, t2]);
    const first = await app.inject({ method: 'GET', url: `/mastery/student/${studentId}?subject=Mathematics`, headers: H(teacherToken) });
    const c1 = first.json().map.find((m) => m.nodeId === t2);
    assert.equal(c1.level, 'needs_support', 'weak evidence → needs support (never "failing")');
    await sql(`UPDATE mastery.evidence SET expires_at = now() - interval '1 hour' WHERE student_id=$1 AND node_id=$2`, [studentId, t2]);
    const second = await app.inject({ method: 'GET', url: `/mastery/student/${studentId}?subject=Mathematics`, headers: H(teacherToken) });
    const c2 = second.json().map.find((m) => m.nodeId === t2);
    assert.equal(c2.level, 'needs_support', 'decay floors at needs_support');
    // a topic with NO evidence anywhere → no label, no state row
    const t3 = (await sql(`SELECT id FROM curriculum.node WHERE parent_id=$1 AND kind='topic' ORDER BY order_no OFFSET 2 LIMIT 1`, [unit8])).rows[0].id;
    const bare = await app.inject({ method: 'GET', url: `/mastery/student/${studentId}?subject=Science`, headers: H(teacherToken) });
    assert.equal(bare.statusCode, 200);
    assert.equal(bare.json().map.length, 0, 'Science has no evidence — the map is empty, never negative');
    const bareState = await sql(`SELECT count(*)::int n FROM mastery.state WHERE student_id=$1 AND node_id=$2`, [studentId, t3]);
    assert.equal(bareState.rows[0].n, 0, 'no evidence-free state rows are persisted');
  });

  test('class map returns evidence-bearing cells with decayed labels; guards reject bad subject', async () => {
    const cls = await app.inject({ method: 'GET', url: '/mastery/class/8?subject=Mathematics', headers: H(teacherToken) });
    assert.equal(cls.statusCode, 200, cls.body);
    const body = cls.json();
    assert.equal(body.grade, '8');
    assert.ok(body.students > 0);
    assert.ok(body.cells.length >= 2, 'the cells we seeded appear on the class map');
    const mine = body.cells.filter((c) => c.studentId === studentId);
    assert.ok(mine.some((c) => c.topicId === mathTopic8 && c.level === 'developing'));
    assert.ok(mine.some((c) => c.level === 'needs_support'));
    const bad = await app.inject({ method: 'GET', url: '/mastery/class/8?subject=History', headers: H(teacherToken) });
    assert.equal(bad.statusCode, 400);
  });
});

describe('teacher.copilot v0 — brief (graceful degradation; sibling lanes absent)', () => {
  test('sibling tables do NOT exist in this database; brief still answers with plain sentences + sources', async () => {
    const hw = await sql(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='teacher' AND table_name='homework'`);
    assert.equal(hw.rows[0].n, 0, 'precondition: teacher.homework is another lane\'s table and is ABSENT here');
    const con = await sql(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='teacher' AND table_name='concern'`);
    assert.equal(con.rows[0].n, 0, 'precondition: teacher.concern is ABSENT here');
    const r = await app.inject({ method: 'GET', url: '/teacher/brief?when=eod', headers: H(teacherToken) });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.equal(b.when, 'eod');
    assert.equal(b.label, 'deterministic_summary');
    assert.ok(Array.isArray(b.sentences) && b.sentences.length >= 4, 'plain sentences present');
    assert.ok(b.sentences.some((s) => /homework inbox isn't connected/i.test(s)), 'homework absence is said plainly');
    assert.ok(b.sentences.some((s) => /concern queue isn't connected/i.test(s)), 'concern absence is said plainly');
    assert.ok(b.sentences.some((s) => /nothing was invented/i.test(s)), 'the brief states it is deterministic');
    assert.equal(b.homework.available, false, 'degraded payload, not a crash');
    assert.equal(b.concerns.available, false);
    assert.equal(b.curriculumPace.available, true, 'own tables always answer');
    // curriculum pace is live (we ticked a topic to 60% — not 100, so 0 fully covered)
    const paceRow = b.curriculumPace.rows.find((p) => p.subject === 'Mathematics' && p.grade === '8');
    assert.ok(paceRow && paceRow.total >= 12);
    // A2: the brief wrote its budget row
    const calls = await sql(`SELECT count(*)::int n FROM copilot.call WHERE verb='brief'`);
    assert.ok(calls.rows[0].n >= 1, 'briefs land on the A2 budget ledger');
  });

  test('brief with sibling tables PRESENT aggregates homework+concern counts (graceful upgrade)', async () => {
    // emulate sibling lanes by creating their shape EXACTLY as the plan §3 contract
    // specifies (these stay in the throwaway test DB; the plugin only reads when present)
    await sql(`CREATE TABLE IF NOT EXISTS teacher.homework (
                 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                 tenant_id uuid NOT NULL, class_grade text, subject text, teacher_id uuid,
                 title text, detail text, attachments jsonb DEFAULT '[]'::jsonb,
                 due_at timestamptz, status text NOT NULL DEFAULT 'open', created_by uuid)`);
    await sql(`CREATE TABLE IF NOT EXISTS teacher.submission (
                 homework_id uuid NOT NULL, student_id uuid NOT NULL,
                 content_type text, content_ref text, submitted_at timestamptz,
                 status text NOT NULL DEFAULT 'submitted', grade numeric, feedback text,
                 reviewed_by uuid, reviewed_at timestamptz)`);
    await sql(`CREATE TABLE IF NOT EXISTS teacher.concern (
                 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
                 teacher_id uuid, student_id uuid, category text, urgency text,
                 detail text, status text NOT NULL DEFAULT 'open', routed_to uuid, outcome text)`);
    const tid = (await sql(`SELECT id FROM app.users WHERE role='teacher' LIMIT 1`)).rows[0].id;
    await sql(`INSERT INTO teacher.homework (tenant_id, teacher_id, title, status)
               SELECT tenant_id, $2, 'Fractions worksheet', 'open' FROM app.users WHERE id=$2`, [tid, tid]);
    await sql(`INSERT INTO teacher.homework (tenant_id, teacher_id, title, status)
               SELECT tenant_id, $2, 'Decimals quiz', 'open' FROM app.users WHERE id=$2`, [tid, tid]);
    const hw1 = (await sql(`SELECT id FROM teacher.homework LIMIT 1`)).rows[0].id;
    await sql(`INSERT INTO teacher.submission (homework_id, student_id, status) VALUES ($1,$2,'submitted'), ($1,$2,'late'), ($1,$2,'reviewed')`,
      [hw1, studentId]);
    await sql(`INSERT INTO teacher.concern (tenant_id, teacher_id, student_id, category, urgency, status)
               SELECT tenant_id, $2, $3, 'academic', 'high', 'open' FROM app.users WHERE id=$2`, [tid, tid, studentId]);
    const r = await app.inject({ method: 'GET', url: '/teacher/brief?when=week', headers: H(teacherToken) });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.equal(b.homework.available, true, 'sibling presence upgrades the brief');
    assert.equal(b.homework.openHomework, 2);
    assert.equal(b.homework.pendingSubmissions, 2, 'submitted+late count as pending');
    assert.equal(b.homework.reviewedSubmissions, 1);
    assert.equal(b.concerns.available, true);
    assert.equal(b.concerns.open, 1);
    assert.ok(b.sentences.some((s) => /2 submissions? (are|is) waiting/i.test(s)) || b.sentences.some((s) => /waiting for your review/i.test(s)), 'plain sentence reflects the count');
    const wk = await app.inject({ method: 'GET', url: '/teacher/brief?when=week', headers: H(teacherToken) });
    assert.equal(wk.json().when, 'week');
  });
});

describe('teacher.copilot v0 — copilot doors (A2 budgeted, deterministic, labelled)', () => {
  test('draft returns a labelled ai_draft template; budget row written; unknown kind rejected', async () => {
    const r = await app.inject({ method: 'POST', url: '/copilot/draft',
      payload: { kind: 'lesson', params: { nodeId: mathTopic8, minutes: 40 } }, headers: H(teacherToken) });
    assert.equal(r.statusCode, 200, r.body);
    const d = r.json();
    assert.equal(d.label, 'ai_draft', 'clear labelling (AI-draft invariant)');
    assert.equal(d.deterministic, true);
    assert.match(d.draft, /ai_draft/);
    assert.match(d.draft, /no AI model involved/);
    assert.ok(d.builtFrom.includes('curriculum.node'), 'grounded in curriculum');
    assert.ok(d.budget && d.budget.cap > 0, 'A2 budget echo');
    const calls = await sql(`SELECT count(*)::int n FROM copilot.call WHERE verb='draft' AND budget_class='teacher_tier'`);
    assert.ok(calls.rows[0].n >= 1, 'draft writes the budget row');
    const wk = await app.inject({ method: 'POST', url: '/copilot/draft',
      payload: { kind: 'worksheet', params: { nodeId: mathTopic8 } }, headers: H(teacherToken) });
    assert.match(wk.json().draft, /WORKSHEET/);
    const bad = await app.inject({ method: 'POST', url: '/copilot/draft',
      payload: { kind: 'term_paper' }, headers: H(teacherToken) });
    assert.equal(bad.statusCode, 400);
  });

  test('ask routes by keyword to curriculum/mastery/timetable/homework data with sources[]', async () => {
    const pace = await app.inject({ method: 'POST', url: '/copilot/ask',
      payload: { question: 'How is the curriculum pace for Mathematics class 8?' }, headers: H(teacherToken) });
    assert.equal(pace.statusCode, 200, pace.body);
    assert.match(pace.json().answer, /Mathematics class 8/);
    assert.ok(pace.json().sources.some((s) => s.kind === 'curriculum'));
    assert.equal(pace.json().label, 'deterministic_answer');

    const mastery = await app.inject({ method: 'POST', url: '/copilot/ask',
      payload: { question: 'Who needs support in class 8 Mathematics?' }, headers: H(teacherToken) });
    assert.match(mastery.json().answer, /needs support|currently marked/i);
    assert.ok(mastery.json().sources.some((s) => s.kind === 'mastery'));

    const today = await app.inject({ method: 'POST', url: '/copilot/ask',
      payload: { question: 'What do I teach today?' }, headers: H(teacherToken) });
    assert.ok(today.json().sources.some((s) => s.kind === 'timetable'));
    assert.match(today.json().answer, /teach|timetable|period|scheduled/i);

    const hw = await app.inject({ method: 'POST', url: '/copilot/ask',
      payload: { question: 'How many submissions are pending in my inbox?' }, headers: H(teacherToken) });
    assert.ok(hw.json().sources.some((s) => s.kind === 'homework'));
    assert.match(hw.json().answer, /waiting for review|isn't connected/i);

    const fallback = await app.inject({ method: 'POST', url: '/copilot/ask',
      payload: { question: 'What is the meaning of teaching?' }, headers: H(teacherToken) });
    assert.ok(fallback.json().sources.some((s) => s.kind === 'brief'));
    const empty = await app.inject({ method: 'POST', url: '/copilot/ask',
      payload: { question: '' }, headers: H(teacherToken) });
    assert.equal(empty.statusCode, 400);
    // every ask landed on the budget ledger
    const calls = await sql(`SELECT count(*)::int n FROM copilot.call WHERE verb='ask'`);
    assert.ok(calls.rows[0].n >= 5);
    const usage = await app.inject({ method: 'GET', url: '/teacher/usage', headers: H(teacherToken) });
    assert.equal(usage.statusCode, 200);
    assert.equal(usage.json().budgetClass, 'teacher_tier');
    assert.ok(usage.json().used >= 5);
  });
});

describe('teacher.copilot v0 — governance: role gates, lifecycle gate, RLS', () => {
  test('brief/ask/draft are teacher-only (coordinator/parent refused); insight doors stay staff-wide', async () => {
    const co = await loginAs(app, 'coordinator@meridian.edu');
    assert.equal((await app.inject({ method: 'GET', url: '/teacher/brief?when=eod', headers: H(co.token) })).statusCode, 403, 'brief is teacher-only');
    assert.equal((await app.inject({ method: 'POST', url: '/copilot/ask', payload: { question: 'hi' }, headers: H(co.token) })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/copilot/draft', payload: { kind: 'lesson' }, headers: H(co.token) })).statusCode, 403);
    const par = await loginAs(app, 'parent@meridian.edu');
    assert.equal((await app.inject({ method: 'GET', url: '/teacher/brief', headers: H(par.token) })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: '/mastery/class/8?subject=Mathematics', headers: H(par.token) })).statusCode, 403, 'mastery is staff-lane');
    // coordinators/principals keep the INSIGHT doors (approvals/oversight tier)
    assert.equal((await app.inject({ method: 'GET', url: '/curriculum/tree?subject=Science&grade=6', headers: H(co.token) })).statusCode, 200);
    const pr = await loginAs(app, 'principal@meridian.edu');
    assert.equal((await app.inject({ method: 'GET', url: `/mastery/student/${studentId}?subject=Mathematics`, headers: H(pr.token) })).statusCode, 200);
  });

  test('lifecycle gate: disabled plugin → 409 on every door', async () => {
    const o = await loginAs(app, 'owner@meridian.edu');
    const off = await app.inject({ method: 'POST', url: '/plugins/teacher.copilot/disable', payload: {}, headers: H(o.token) });
    assert.equal(off.statusCode, 200);
    const t = await loginAs(app, 'teacher@meridian.edu');
    const brief = await app.inject({ method: 'GET', url: '/teacher/brief?when=eod', headers: H(t.token) });
    assert.equal(brief.statusCode, 409, 'uniform lifecycle gate (P2-1)');
    assert.match(brief.json().error, /switched off/);
    const tree = await app.inject({ method: 'GET', url: '/curriculum/tree?subject=Mathematics&grade=8', headers: H(t.token) });
    assert.equal(tree.statusCode, 409);
    await app.inject({ method: 'POST', url: '/plugins/teacher.copilot/enable', payload: { version: '0.1.0', class: 'C' }, headers: H(o.token) });
    assert.equal((await app.inject({ method: 'GET', url: '/teacher/brief?when=eod', headers: H(t.token) })).statusCode, 200, 're-enabled');
  });

  test('RLS: app role under another tenant GUC sees zero rows and cannot write; non-uuid :id → 400', async () => {
    const other = (await sql(
      `INSERT INTO app.tenants (id, slug, name, config)
       VALUES (gen_random_uuid(), 'ts3-rival-' || floor(random()*1e6)::text, 'TS3 Rival School', '{}'::jsonb)
       RETURNING id`)).rows[0];
    const mine = (await sql(`SELECT n.id FROM curriculum.node n WHERE n.kind='topic' LIMIT 1`)).rows[0];
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    await c.query('BEGIN');
    await c.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [other.id]);
    await c.query(`SET LOCAL ROLE schoolos_app`);
    const seen = {};
    for (const t of ['curriculum.node', 'curriculum.progress', 'mastery.evidence', 'mastery.state', 'copilot.call']) {
      seen[t] = (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
    }
    let insertBlocked = false;
    try { await c.query(`INSERT INTO curriculum.progress (tenant_id, node_id, class_grade, covered_pct) VALUES ($1,$2,'8',50)`, [other.id, mine.id]); }
    catch { insertBlocked = true; }
    await c.query('ROLLBACK');
    await c.end();
    for (const [t, n] of Object.entries(seen)) assert.equal(n, 0, `RLS: ${t} invisible across tenants`);
    assert.equal(insertBlocked, true, 'RLS WITH CHECK: cross-tenant coverage write rejected');
    // cross-tenant write through the door → tenant-scoped miss (404), no data crosses
    const t2 = await loginAs(app, 'teacher@meridian.edu');
    const x = await app.inject({ method: 'POST', url: '/curriculum/progress',
      payload: { node_id: mine.id, class_grade: '8', pct: 100 }, headers: H(t2.token) });
    assert.equal(x.statusCode, 200, 'own-tenant coverage still writes (the node is tenant-scoped)');
    // non-uuid :id on the mastery door → 400 BEFORE any uuid cast (22P02 → 500 guard)
    const bad = await app.inject({ method: 'GET', url: '/mastery/student/not-a-uuid?subject=Mathematics', headers: H(t2.token) });
    assert.equal(bad.statusCode, 400);
  });
});
