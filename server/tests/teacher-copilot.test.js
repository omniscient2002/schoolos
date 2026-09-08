// teacher.copilot (TeacherOS lane TS-3, migration 033) — unit suite (v0, deterministic).
// Pins: A1 seeded curriculum + audited teacher check-off · A3 mastery decay (expired
// evidence downgrades ONE step, exactly once, recovery on fresh evidence) · brief
// shape with graceful degradation when sibling lanes have no data · drafts are
// labelled ai_draft templates (no model calls) · RLS tenant isolation on every table ·
// brief/ask/draft are teacher-role-only · lifecycle gate.
// NOTE: 031/032 ship the teacher.homework/teacher.concern tables (real schemas), so
// the degradation pin is data-driven — sibling sources with ZERO rows must degrade
// exactly like absent tables (same door, same honest copy), and seeded sibling rows
// must upgrade the brief. One suite per process (shared schoolos_test): DROP first.
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
  teacherToken = await tok('teacher@meridian.edu');
  // enable the plugin (lifecycle gate requires an enabled registry row)
  const o = await tok('owner@meridian.edu');
  const en = await app.inject({ method: 'POST', url: '/plugins/teacher.copilot/enable',
    payload: { version: '0.1.0', class: 'C' }, headers: H(o) });
  assert.equal(en.statusCode, 200, `enable failed: ${en.body}`);
  // fixtures: student, curriculum nodes (033 seed ships the 90-node tree)
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
                 SELECT tenant_id, $1, 'Mathematics', $2, 'assessment', 'seed-test', $3, now(), now() + interval '30 days'
                 FROM app.students WHERE id=$1`, [studentId, mathTopic8, v]);
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

    // fresh evidence arrives → deterministic recovery: fresh evidence ALONE governs
    // (the expired rows stop counting entirely), so [70] → secure — the decayed
    // 'developing' label did not freeze the cell
    await sql(`INSERT INTO mastery.evidence (tenant_id, student_id, subject, node_id, kind, ref, value)
               SELECT tenant_id, $1, 'Mathematics', $2, 'homework', 'recovery', 70 FROM app.students WHERE id=$1`, [studentId, mathTopic8]);
    const recovered = await app.inject({ method: 'GET', url: `/mastery/student/${studentId}?subject=Mathematics`, headers: H(teacherToken) });
    const cellRecovered = recovered.json().map.find((m) => m.nodeId === mathTopic8);
    assert.equal(cellRecovered.level, 'secure', 'fresh evidence alone governs after expiry: [70] → secure');
    assert.equal(cellRecovered.decayed, false, 'recovery clears the decayed read-flag');
  });

  test('floor: needs_support + expiry stays floored; no evidence anywhere → no label, no state row', async () => {
    // a second topic: weak evidence → needs_support already; expiry must FLOOR there
    const t2 = (await sql(`SELECT id FROM curriculum.node WHERE parent_id=$1 AND kind='topic' ORDER BY order_no OFFSET 1 LIMIT 1`, [unit8])).rows[0].id;
    await sql(`INSERT INTO mastery.evidence (tenant_id, student_id, subject, node_id, kind, ref, value, observed_at, expires_at)
               SELECT tenant_id, $1, 'Mathematics', $2, 'quiz', 'weak', 20, now(), now() + interval '7 days' FROM app.students WHERE id=$1`, [studentId, t2]);
    const first = await app.inject({ method: 'GET', url: `/mastery/student/${studentId}?subject=Mathematics`, headers: H(teacherToken) });
    const c1 = first.json().map.find((m) => m.nodeId === t2);
    assert.equal(c1.level, 'needs_support', 'weak evidence → needs support (never "failing")');
    await sql(`UPDATE mastery.evidence SET expires_at = now() - interval '1 hour' WHERE student_id=$1 AND node_id=$2`, [studentId, t2]);
    const second = await app.inject({ method: 'GET', url: `/mastery/student/${studentId}?subject=Mathematics`, headers: H(teacherToken) });
    const c2 = second.json().map.find((m) => m.nodeId === t2);
    assert.equal(c2.level, 'needs_support', 'decay floors at needs_support');
    assert.equal(c2.confidence, 'low');
    // a subject with NO evidence anywhere → no labels at all (A3: no negative labels on minors)
    const bare = await app.inject({ method: 'GET', url: `/mastery/student/${studentId}?subject=Science`, headers: H(teacherToken) });
    assert.equal(bare.statusCode, 200);
    assert.equal(bare.json().map.length, 0, 'Science has no evidence — the map is empty, never negative');
  });

  test('class map returns evidence-bearing cells with decayed labels; guards reject bad subject', async () => {
    const cls = await app.inject({ method: 'GET', url: '/mastery/class/8?subject=Mathematics', headers: H(teacherToken) });
    assert.equal(cls.statusCode, 200, cls.body);
    const body = cls.json();
    assert.equal(body.grade, '8');
    assert.ok(body.students > 0);
    assert.ok(body.cells.length >= 2, 'the cells we seeded appear on the class map');
    const mine = body.cells.filter((c) => c.studentId === studentId);
    // mathTopic8 recovered to secure (fresh evidence governs); t2 decayed to needs_support
    assert.ok(mine.some((c) => c.topicId === mathTopic8 && c.level === 'secure'), 'recovered cell reads secure on the class map');
    assert.ok(mine.some((c) => c.level === 'needs_support'), 'decayed cell reads needs_support on the class map');
    const bad = await app.inject({ method: 'GET', url: '/mastery/class/8?subject=History', headers: H(teacherToken) });
    assert.equal(bad.statusCode, 400);
  });
});

describe('teacher.copilot v0 — brief (graceful degradation with zero-row sibling lanes)', () => {
  test('sibling lanes present but EMPTY → brief degrades with plain sentences + sources; own tables answer', async () => {
    // precondition: the sibling tables exist (031/032) but hold no rows for this teacher
    const hw = await sql(`SELECT count(*)::int n FROM teacher.homework`);
    assert.equal(hw.rows[0].n, 0, 'precondition: teacher.homework has no demo rows');
    const con = await sql(`SELECT count(*)::int n FROM teacher.concern`);
    assert.equal(con.rows[0].n, 0, 'precondition: teacher.concern has no demo rows');
    const r = await app.inject({ method: 'GET', url: '/teacher/brief?when=eod', headers: H(teacherToken) });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.equal(b.when, 'eod');
    assert.equal(b.label, 'deterministic_summary');
    assert.ok(Array.isArray(b.sentences) && b.sentences.length >= 4, 'plain sentences present');
    assert.ok(b.sentences.some((s) => /no submissions are waiting/i.test(s)), 'empty homework inbox is said plainly');
    assert.ok(b.sentences.some((s) => /no concerns are open/i.test(s)), 'empty concern queue is said plainly');
    assert.ok(b.sentences.some((s) => /nothing was invented/i.test(s)), 'the brief states it is deterministic');
    assert.equal(b.homework.available, true, '031 tables exist — source is available');
    assert.equal(b.homework.openHomework, 0, '…and honestly empty');
    assert.equal(b.homework.pendingSubmissions, 0);
    assert.equal(b.concerns.available, true);
    assert.equal(b.concerns.open, 0);
    assert.equal(b.curriculumPace.available, true, 'own tables always answer');
    const paceRow = b.curriculumPace.rows.find((p) => p.subject === 'Mathematics' && p.grade === '8');
    assert.ok(paceRow && paceRow.total >= 12, 'the 033 seed tree feeds the pace read');
    // A2: the brief wrote its budget row
    const calls = await sql(`SELECT count(*)::int n FROM copilot.call WHERE verb='brief'`);
    assert.ok(calls.rows[0].n >= 1, 'briefs land on the A2 budget ledger');
  });

  test('brief with sibling rows PRESENT aggregates homework+concern counts (graceful upgrade)', async () => {
    // seed EXACTLY the real 031/032 shapes (created_by / filed_by are the owner columns;
    // 031 pins UNIQUE(homework_id, student_id) — one submission per student per homework)
    const tid = (await sql(`SELECT id FROM app.users WHERE role='teacher' AND email='teacher@meridian.edu'`)).rows[0].id;
    const T = (await sql(`SELECT tenant_id FROM app.users WHERE id=$1`, [tid])).rows[0].tenant_id;
    const peers = (await sql(`SELECT id FROM app.students WHERE grade='8' ORDER BY created_at LIMIT 3`)).rows.map((r) => r.id);
    const hw1 = (await sql(`INSERT INTO teacher.homework (tenant_id, class_grade, subject, title, detail, due_at, created_by)
                            VALUES ($1,'8','Mathematics','Fractions worksheet','practice set', now() + interval '2 days', $2) RETURNING id`,
      [T, tid])).rows[0].id;
    await sql(`INSERT INTO teacher.homework (tenant_id, class_grade, subject, title, detail, due_at, created_by)
               VALUES ($1,'8','Mathematics','Decimals quiz','quick quiz', now() + interval '3 days', $2)`, [T, tid]);
    await sql(`INSERT INTO teacher.submission (tenant_id, homework_id, student_id, content_type, content, status)
               VALUES ($1,$2,$3,'text','my answer','submitted')`, [T, hw1, peers[0]]);
    await sql(`INSERT INTO teacher.submission (tenant_id, homework_id, student_id, content_type, content, status)
               VALUES ($1,$2,$3,'text','my answer','late')`, [T, hw1, peers[1]]);
    await sql(`INSERT INTO teacher.submission (tenant_id, homework_id, student_id, content_type, content, status, reviewed_by, reviewed_at)
               VALUES ($1,$2,$3,'text','done','reviewed',$4, now())`, [T, hw1, peers[2], tid]);
    await sql(`INSERT INTO teacher.concern (tenant_id, student_id, filed_by, category, urgency, detail, status)
               VALUES ($1,$2,$3,'academic','high','struggling with word problems','open')`, [T, studentId, tid]);
    const eod = await app.inject({ method: 'GET', url: '/teacher/brief?when=eod', headers: H(teacherToken) });
    assert.equal(eod.statusCode, 200, eod.body);
    const eb = eod.json();
    assert.equal(eb.homework.pendingSubmissions, 2, 'submitted+late count as pending');
    assert.equal(eb.homework.reviewedSubmissions, 1);
    assert.equal(eb.homework.openHomework, 2);
    assert.equal(eb.concerns.open, 1);
    assert.ok(eb.sentences.some((s) => /waiting for your review/.test(s)), 'eod sentence reflects the count');
    assert.ok(eb.sentences.some((s) => /at least one is urgent/.test(s)), 'urgent concern surfaces in plain language');
    const wk = await app.inject({ method: 'GET', url: '/teacher/brief?when=week', headers: H(teacherToken) });
    assert.equal(wk.statusCode, 200);
    const b = wk.json();
    assert.equal(b.when, 'week');
    assert.equal(b.homework.available, true, 'sibling presence upgrades the brief');
    assert.ok(b.sentences.some((s) => /2 still need review/.test(s)), 'week sentence reflects the count');
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
    assert.ok(today.json().sources.some((s) => s.kind === 'timetable'), today.json().answer);
    assert.match(today.json().answer, /teach|timetable|period|scheduled/i);

    const hw = await app.inject({ method: 'POST', url: '/copilot/ask',
      payload: { question: 'How many submissions are pending in my inbox?' }, headers: H(teacherToken) });
    assert.ok(hw.json().sources.some((s) => s.kind === 'homework'));
    assert.match(hw.json().answer, /waiting for review|isn't connected/i);

    const fallback = await app.inject({ method: 'POST', url: '/copilot/ask',
      payload: { question: 'What is the meaning of teaching?' }, headers: H(teacherToken) });
    assert.ok(fallback.json().sources.some((s) => s.kind === 'brief'),
      'abstract questions get the honest brief fallback, not a hijacked branch');
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

  test('brief param handling is deterministic (?when=bogus → eod); ask guards 500-char limit', async () => {
    const bogus = await app.inject({ method: 'GET', url: '/teacher/brief?when=bogus', headers: H(teacherToken) });
    assert.equal(bogus.statusCode, 200, 'unknown when falls back, never 500');
    assert.equal(bogus.json().when, 'eod', 'deterministic default: eod');
    const missing = await app.inject({ method: 'GET', url: '/teacher/brief', headers: H(teacherToken) });
    assert.equal(missing.json().when, 'eod', 'missing when defaults to eod');
    const long = await app.inject({ method: 'POST', url: '/copilot/ask',
      payload: { question: 'x'.repeat(501) }, headers: H(teacherToken) });
    assert.equal(long.statusCode, 400, 'ask length guard (plain-language refusal)');
    assert.match(long.json().error, /500 characters/);
  });
});

describe('teacher.copilot v0 — governance: role gates, lifecycle gate, RLS', () => {
  test('brief/ask/draft are teacher-only (coordinator/parent refused); insight doors stay staff-wide', async () => {
    const co = await tok('coordinator@meridian.edu');
    assert.equal((await app.inject({ method: 'GET', url: '/teacher/brief?when=eod', headers: H(co) })).statusCode, 403, 'brief is teacher-only');
    assert.equal((await app.inject({ method: 'POST', url: '/copilot/ask', payload: { question: 'hi' }, headers: H(co) })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/copilot/draft', payload: { kind: 'lesson' }, headers: H(co) })).statusCode, 403);
    const par = await tok('parent@meridian.edu');
    assert.equal((await app.inject({ method: 'GET', url: '/teacher/brief', headers: H(par) })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: '/mastery/class/8?subject=Mathematics', headers: H(par) })).statusCode, 403, 'mastery is staff-lane');
    // coordinators/principals keep the INSIGHT doors (approvals/oversight tier)
    assert.equal((await app.inject({ method: 'GET', url: '/curriculum/tree?subject=Science&grade=6', headers: H(co) })).statusCode, 200);
    const pr = await tok('principal@meridian.edu');
    assert.equal((await app.inject({ method: 'GET', url: `/mastery/student/${studentId}?subject=Mathematics`, headers: H(pr) })).statusCode, 200);
  });

  test('lifecycle gate: disabled plugin → 409 on every door', async () => {
    const o = await tok('owner@meridian.edu');
    const off = await app.inject({ method: 'POST', url: '/plugins/teacher.copilot/disable', payload: {}, headers: H(o) });
    assert.equal(off.statusCode, 200);
    const brief = await app.inject({ method: 'GET', url: '/teacher/brief?when=eod', headers: H(teacherToken) });
    assert.equal(brief.statusCode, 409, 'uniform lifecycle gate (P2-1)');
    assert.match(brief.json().error, /switched off/);
    const tree = await app.inject({ method: 'GET', url: '/curriculum/tree?subject=Mathematics&grade=8', headers: H(teacherToken) });
    assert.equal(tree.statusCode, 409);
    await app.inject({ method: 'POST', url: '/plugins/teacher.copilot/enable', payload: { version: '0.1.0', class: 'C' }, headers: H(o) });
    assert.equal((await app.inject({ method: 'GET', url: '/teacher/brief?when=eod', headers: H(teacherToken) })).statusCode, 200, 're-enabled');
  });

  test('RLS: app role under another tenant GUC sees zero rows and cannot write; non-uuid :id → 400', async () => {
    const other = (await sql(
      `INSERT INTO app.tenants (id, slug, name, config)
       VALUES (gen_random_uuid(), 'ts3-rival-' || floor(random()*1e6)::text, 'TS3 Rival School', '{}'::jsonb)
       RETURNING id`)).rows[0];
    const mine = (await sql(`SELECT n.id, n.grade FROM curriculum.node n WHERE n.kind='topic' LIMIT 1`)).rows[0];
    const meridianT = (await sql(`SELECT tenant_id FROM app.users WHERE email='teacher@meridian.edu'`)).rows[0].tenant_id;
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    await c.query('BEGIN');
    await c.query(`SELECT set_config('schoolos.tenant_id', $1, true)`, [other.id]);
    await c.query(`SET LOCAL ROLE schoolos_app`);
    const seen = {};
    for (const t of ['curriculum.node', 'curriculum.progress', 'mastery.evidence', 'mastery.state', 'copilot.call']) {
      seen[t] = (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
    }
    // WITH CHECK pin: write OUR tenant_id while the session GUC is the rival's → policy rejects
    let insertBlocked = false;
    try { await c.query(`INSERT INTO curriculum.progress (tenant_id, node_id, class_grade, covered_pct) VALUES ($1,$2,'8',50)`, [meridianT, mine.id]); }
    catch { insertBlocked = true; }
    // A1 pin: curriculum.node is SELECT-only for the app role (authoring rides migrations)
    let nodeInsertBlocked = false;
    try { await c.query(`INSERT INTO curriculum.node (tenant_id, subject, grade, kind, name) VALUES ($1,'Mathematics','6','unit','Rival Unit')`, [other.id]); }
    catch { nodeInsertBlocked = true; }
    await c.query('ROLLBACK');
    await c.end();
    for (const [t, n] of Object.entries(seen)) assert.equal(n, 0, `RLS: ${t} invisible across tenants`);
    assert.equal(insertBlocked, true, 'RLS WITH CHECK: cross-tenant coverage write rejected (tenant_id/GUC mismatch)');
    assert.equal(nodeInsertBlocked, true, 'A1: curriculum.node is SELECT-only for the app role');
    // own-tenant coverage still writes through the door (class_grade matches the node's grade)
    const x = await app.inject({ method: 'POST', url: '/curriculum/progress',
      payload: { node_id: mine.id, class_grade: mine.grade, pct: 100 }, headers: H(teacherToken) });
    assert.equal(x.statusCode, 200, x.body);
    // non-uuid :id on the mastery door → 400 BEFORE any uuid cast (22P02 → 500 guard)
    const bad = await app.inject({ method: 'GET', url: '/mastery/student/not-a-uuid?subject=Mathematics', headers: H(teacherToken) });
    assert.equal(bad.statusCode, 400);
  });
});
