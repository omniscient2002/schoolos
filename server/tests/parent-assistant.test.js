// ParentOS lane PS-2 — parent.assistant pins.
// The assistant is deterministic-only: every answer is composed from the family's OWN
// records, labelled, and budgeted. These tests pin: brief shape with banned-words scan
// over the whole payload · ask hits real data (a family.request filed through the real
// door is found and quoted back) · honest unknown · P-copilot budget 100/calendar month
// → 429 · cross-guardian child → 403 · teacher refused on the brief door.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { setupTestDb } from './helpers.js';

let app;
before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  // enable parent.assistant through the real lifecycle door (registry row from migration 035)
  const owner = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@meridian.edu', password: 'schoolos-demo' }, headers: { 'content-type': 'application/json' } });
  assert.equal(owner.statusCode, 200, owner.body);
  const en = await app.inject({ method: 'POST', url: '/plugins/parent.assistant/enable', headers: { authorization: `Bearer ${owner.json().token}`, 'content-type': 'application/json' }, payload: { version: '1.0.0', class: 'C' } });
  assert.ok([200, 201, 204].includes(en.statusCode), `enable parent.assistant: ${en.statusCode} ${en.body}`);
  // family.view is enabled through its owner door too — the request fixture below is
  // filed through the REAL PS-1 door (POST /parent/requests), never a direct INSERT.
  const ef = await app.inject({ method: 'POST', url: '/plugins/family.view/enable', headers: { authorization: `Bearer ${owner.json().token}`, 'content-type': 'application/json' }, payload: { version: '1.0.0', class: 'C' } });
  assert.ok([200, 201, 204].includes(ef.statusCode), `enable family.view: ${ef.statusCode} ${ef.body}`);
});
after(async () => { await app?.close(); });

const login = async (email) => {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'schoolos-demo' }, headers: { 'content-type': 'application/json' } });
  assert.equal(r.statusCode, 200, `login ${email}: ${r.body}`);
  return r.json();
};
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const BANNED = /failing|disengaged|\brisk\b|at-risk|weak/i;

test('parent brief: shape (when/children/sentences with evidence) + banned-words scan over the whole payload', async () => {
  const p = await login('parent@meridian.edu');
  for (const when of ['morning', 'evening', 'week']) {
    const r = await app.inject({ method: 'GET', url: `/parent/brief?when=${when}`, headers: H(p.token) });
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    assert.equal(body.when, when);
    assert.ok(Array.isArray(body.children), 'children array present');
    assert.ok(Array.isArray(body.sentences) && body.sentences.length > 0, 'factual sentences present');
    assert.equal(body.label, 'deterministic_summary');
    assert.equal(body.deterministic, true);
    for (const ch of body.children) {
      // shape pins: every section the brief promises
      assert.ok(/^[0-9a-f-]{36}$/.test(ch.child_id), 'child_id uuid');
      assert.ok(typeof ch.name === 'string' && ch.name.length > 0);
      assert.ok('attendance_today' in ch, 'attendance today present');
      assert.ok(ch.attendance_last30_days === null || typeof ch.attendance_last30_days === 'object');
      assert.ok('consents_pending' in ch && Number.isInteger(ch.consents_pending), 'consents pending count');
      if (ch.attendance_last30_days && ch.attendance_last30_days.total > 0) {
        assert.ok(Number.isInteger(ch.attendance_last30_days.pct), 'attendance pct is a number');
      }
      // numbers, not adjectives: homework section is an array or an explicit null
      assert.ok(Array.isArray(ch.homework_due_24h) || ch.homework_due_24h === null, 'homework section or null');
      assert.ok(Array.isArray(ch.exams_last7d) || ch.exams_last7d === null, 'exams section or null');
    }
    // banned interpretive words NEVER appear — scan the WHOLE payload including sentences
    const flat = JSON.stringify(body);
    assert.ok(!BANNED.test(flat), `banned interpretive word in brief payload: ${flat.match(BANNED)?.[0]}`);
    // every sentence ends as a factual statement and the honesty note is present
    assert.ok(body.sentences.some((s) => /deterministic summary/i.test(s)), 'deterministic label sentence');
  }
});

test('brief refuses a bad ?when=', async () => {
  const p = await login('parent@meridian.edu');
  const r = await app.inject({ method: 'GET', url: '/parent/brief?when=noon', headers: H(p.token) });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /morning|evening|week/i);
});

test('ask hits REAL data: a request filed via POST /parent/requests is found, sources include Requests, answer mentions the title', async () => {
  const p = await login('parent@meridian.edu');
  // create real own data through the real PS-1 door first
  const title = `Bonafide certificate for school transfer ${Date.now()}`;
  const filed = await app.inject({ method: 'POST', url: '/parent/requests', headers: H(p.token), payload: { category: 'certificate', title } });
  assert.equal(filed.statusCode, 200, filed.body);
  // now ask the assistant about it
  const r = await app.inject({ method: 'POST', url: '/parent/copilot/ask', headers: H(p.token), payload: { question: 'what is the status of my certificate request?' } });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.ok, true);
  assert.equal(body.intent, 'request');
  assert.equal(body.deterministic, true);
  assert.ok(Array.isArray(body.sources) && body.sources.length > 0, 'sources listed');
  assert.ok(body.sources.some((s) => /request/i.test(s.kind)), 'sources include Requests');
  assert.ok(body.answer.includes(title), 'answer quotes the real request title');
  assert.ok(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(JSON.stringify(body)), 'payload carries the evidence');
  assert.ok(!BANNED.test(JSON.stringify(body)), 'banned words never in ask payload');
  // budget ledger row was written
  const { pool } = await import('../src/db.js');
  const led = await pool.query(`SELECT count(*)::int AS n FROM parent.copilot_call WHERE verb='ask' AND question IS NOT NULL`);
  assert.ok(led.rows[0].n >= 1, 'ask wrote a parent.copilot_call row');
});

test('ask: every known intent answers from data; unknown keyword gets the honest answer', async () => {
  const p = await login('parent@meridian.edu');
  for (const [question, intent] of [
    ['what homework is due?', 'homework'],
    ['any exams coming up?', 'exam'],
    ['how is the attendance?', 'attendance'],
    ['what fees are open?', 'fees'],
    ['any consent pending?', 'consent'],
    ['what about my leave request?', 'leave'],
    ['show me the report', 'report'],
  ]) {
    const r = await app.inject({ method: 'POST', url: '/parent/copilot/ask', headers: H(p.token), payload: { question } });
    assert.equal(r.statusCode, 200, `${question}: ${r.body}`);
    const body = r.json();
    assert.equal(body.intent, intent, `${question} → ${intent}`);
    assert.ok(typeof body.answer === 'string' && body.answer.length > 10, 'an answer was composed');
    assert.ok(!BANNED.test(JSON.stringify(body)), 'no banned words');
  }
  const u = await app.inject({ method: 'POST', url: '/parent/copilot/ask', headers: H(p.token), payload: { question: 'what is the weather on Mars?' } });
  assert.equal(u.statusCode, 200);
  assert.equal(u.json().intent, null);
  assert.match(u.json().answer, /don't have that information yet/i, 'honest unknown');
  assert.match(u.json().answer, /ask the class teacher/i, 'points to the class teacher');
});

test('copilot draft: labelled ai_draft template (both kinds), edited-before-send note', async () => {
  const p = await login('parent@meridian.edu');
  const home = await app.inject({ method: 'GET', url: '/parent/home', headers: H(p.token) });
  const child = home.json().children[0];
  const q = await app.inject({ method: 'POST', url: '/parent/copilot/draft', headers: H(p.token), payload: { kind: 'question_to_teacher', params: { childId: child?.child_id, subject: 'Mathematics', focus: 'why did the fractions test feel harder than homework' } } });
  assert.equal(q.statusCode, 200, q.body);
  assert.equal(q.json().label, 'ai_draft');
  assert.match(q.json().draft, /edit/i, 'asks the parent to edit');
  const l = await app.inject({ method: 'POST', url: '/parent/copilot/draft', headers: H(p.token), payload: { kind: 'leave_note', params: { dates: '2026-09-10', reason: 'family function' } } });
  assert.equal(l.statusCode, 200, l.body);
  assert.equal(l.json().label, 'ai_draft');
  const badKind = await app.inject({ method: 'POST', url: '/parent/copilot/draft', headers: H(p.token), payload: { kind: 'poem' } });
  assert.equal(badKind.statusCode, 400);
});

test('explain/:topic returns meaning/why/what_you_can_do built from real numbers', async () => {
  const p = await login('parent@meridian.edu');
  for (const topic of ['attendance', 'report', 'fees']) {
    const r = await app.inject({ method: 'GET', url: `/parent/explain/${topic}`, headers: H(p.token) });
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    assert.ok(body.meaning.length > 20 && body.why.length > 20 && body.what_you_can_do.length > 20);
    assert.equal(body.deterministic, true);
    assert.ok(!BANNED.test(JSON.stringify(body)), `no banned words in explain/${topic}`);
  }
  const badTopic = await app.inject({ method: 'GET', url: '/parent/explain/marks', headers: H(p.token) });
  assert.equal(badTopic.statusCode, 400);
});

test('P-copilot budget: 100 copilot_call rows this calendar month → ask answers 429', async () => {
  const p = await login('parent@meridian.edu');
  const { pool } = await import('../src/db.js');
  const uid = (await pool.query(`SELECT id FROM app.users WHERE email='parent@meridian.edu'`)).rows[0].id;
  const tenant = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='parent@meridian.edu'`)).rows[0].tenant_id;
  // how many ask rows does this user already have this month? fill up to exactly the cap.
  const used = (await pool.query(
    `SELECT count(*)::int AS n FROM parent.copilot_call WHERE user_id=$1 AND verb='ask'
     AND at >= date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')::timestamp AT TIME ZONE 'Asia/Kolkata')`, [uid])).rows[0].n;
  const need = 100 - used;
  assert.ok(need >= 0, 'budget count consistent');
  if (need > 0) {
    await pool.query(
      `INSERT INTO parent.copilot_call (tenant_id, user_id, verb, question, sources, budget_class, at)
       SELECT $1,$2,'ask','budget probe', '[]'::jsonb, 'P-copilot', now() - ((g || ' seconds')::interval)
       FROM generate_series(1, $3) AS g`,
      [tenant, uid, need]);
  }
  const r = await app.inject({ method: 'POST', url: '/parent/copilot/ask', headers: H(p.token), payload: { question: 'what homework is due?' } });
  assert.equal(r.statusCode, 429, `expected 429 at ${used}+${need} rows: ${r.body}`);
  assert.match(r.json().error, /limit|month/i, 'plain-language budget message');
  assert.equal(r.json().budget.cap, 100);
  // the draft door shares the same ledger (P-copilot class)
  const d = await app.inject({ method: 'POST', url: '/parent/copilot/draft', headers: H(p.token), payload: { kind: 'leave_note', params: { dates: '2026-09-10', reason: 'fever' } } });
  assert.equal(d.statusCode, 429, 'draft shares the monthly budget');
  // cleanup the probe rows so later tests are not walled by the budget
  await pool.query(`DELETE FROM parent.copilot_call WHERE question='budget probe'`);
});

test('cross-guardian 403: draft for an unlinked child refuses without data', async () => {
  const p = await login('parent@meridian.edu');
  const { pool } = await import('../src/db.js');
  const foreign = await pool.query(
    `SELECT s.id FROM app.students s
     WHERE NOT EXISTS (SELECT 1 FROM family.child_link l WHERE l.student_id=s.id AND l.user_id=(SELECT id FROM app.users WHERE email='parent@meridian.edu'))
     LIMIT 1`);
  if (!foreign.rows[0]) return; // demo env fully linked — skip
  const r = await app.inject({ method: 'POST', url: '/parent/copilot/draft', headers: H(p.token), payload: { kind: 'question_to_teacher', params: { childId: foreign.rows[0].id, focus: 'how is my child doing' } } });
  assert.equal(r.statusCode, 403);
  assert.ok(!/attendance|homework|report/i.test(r.body), 'error must not leak data shape');
});

test('teacher role is refused on the assistant doors', async () => {
  const t = await login('teacher@meridian.edu');
  const brief = await app.inject({ method: 'GET', url: '/parent/brief?when=morning', headers: H(t.token) });
  assert.equal(brief.statusCode, 403, '/parent/brief → 403 for teacher');
  const ask = await app.inject({ method: 'POST', url: '/parent/copilot/ask', headers: H(t.token), payload: { question: 'what homework is due?' } });
  assert.equal(ask.statusCode, 403, '/parent/copilot/ask → 403 for teacher');
  const explain = await app.inject({ method: 'GET', url: '/parent/explain/attendance', headers: H(t.token) });
  assert.equal(explain.statusCode, 403, '/parent/explain → 403 for teacher');
});
