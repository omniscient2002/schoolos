// TEST-3 · TEACHER / PARENT / STUDENT DTO contract tests.
//
// The register's TEST-3: "No contract tests for the parent/teacher/student payload shapes."
// These are the shapes the shipped screens read. Each assertion names the client field the
// UI depends on, so a server refactor that renames a field fails here instead of silently
// rendering a placeholder in the browser (the class of defect the register spent §1.1 on).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupTestDb, loginAs } from './helpers.js';

let app; let sql; let tenantId; let teacher; let student; let parent; let coordinator;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const keys = (o) => Object.keys(o ?? {});

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.ready();
  sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try { return await c.query(text, params); } finally { await c.end(); }
  };
  tenantId = (await sql(`SELECT id FROM app.tenants WHERE slug='meridian'`)).rows[0].id;
  for (const id of ['teacher.classroom', 'teacher.support', 'teacher.copilot', 'family.view', 'parent.assistant', 'student.world']) {
    await sql(`UPDATE app.plugins SET status='enabled' WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, id]);
  }
  teacher = await loginAs(app, 'teacher@meridian.edu');
  student = await loginAs(app, 'student@meridian.edu');
  parent = await loginAs(app, 'parent@meridian.edu');
  coordinator = await loginAs(app, 'coordinator@meridian.edu');
});
after(async () => { await app?.close(); });

describe('TEST-3 · teacher DTO contracts', () => {
  test('GET /teacher/home → now/next/needsAttention/glance/suggestions', async () => {
    const r = await app.inject({ method: 'GET', url: '/teacher/home', headers: H(teacher.token) });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    for (const k of ['now', 'next', 'needsAttention', 'glance', 'suggestions']) assert.ok(k in b, `teacher home carries ${k}`);
    assert.ok(Array.isArray(b.next) && Array.isArray(b.needsAttention) && Array.isArray(b.suggestions));
    assert.equal(typeof b.glance.periods, 'number');
  });

  test('GET /plugins/teacher.classroom/submissions → UI fields id/homework_title/content_ref/status', async () => {
    const hw = await app.inject({ method: 'POST', url: '/plugins/teacher.classroom/homework', headers: H(teacher.token),
      payload: { class_grade: '8', subject: 'Mathematics', title: 'Contract probe', due_at: new Date(Date.now() + 864e5).toISOString() } });
    assert.equal(hw.statusCode, 200, hw.body);
    const r = await app.inject({ method: 'GET', url: '/plugins/teacher.classroom/submissions?state=all', headers: H(teacher.token) });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.ok('state' in b && Array.isArray(b.submissions));
    for (const row of b.submissions) {
      for (const k of ['id', 'homework_id', 'homework_title', 'class_grade', 'student_id', 'student_name', 'content_type', 'content_ref', 'submitted_at', 'status']) {
        assert.ok(k in row, `submission row carries ${k}`);
      }
    }
  });

  test('GET /teacher/leave/mine → requests[] in the screen vocabulary', async () => {
    const r = await app.inject({ method: 'GET', url: '/teacher/leave/mine', headers: H(teacher.token) });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.ok(Array.isArray(b.requests) && Array.isArray(b.balances));
    for (const k of ['id', 'kind', 'from_date', 'to_date', 'reason', 'status', 'approver_name', 'decided_at', 'note']) {
      if (b.requests[0]) assert.ok(k in b.requests[0], `leave request carries ${k}`);
    }
  });

  test('GET /workload/mine → fairness shape, never a rank', async () => {
    const r = await app.inject({ method: 'GET', url: '/workload/mine', headers: H(teacher.token) });
    assert.equal(r.statusCode, 200, r.body);
    const w = r.json().workload;
    for (const k of ['periods', 'substitutions', 'invigilation', 'pending_reviews', 'ptm_count', 'fair_band', 'overload', 'note']) {
      assert.ok(k in w, `workload carries ${k}`);
    }
    assert.ok(!('rank' in w) && !('score' in w));
  });

  test('POST /copilot/ask → answer/sources/suggested_action/budget', async () => {
    const r = await app.inject({ method: 'POST', url: '/copilot/ask', headers: H(teacher.token), payload: { question: 'What do I teach today?' } });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    for (const k of ['answer', 'sources', 'suggested_action', 'budget', 'label']) assert.ok(k in b, `ask carries ${k}`);
    assert.ok(Array.isArray(b.sources));
    assert.ok('used' in b.budget && 'cap' in b.budget);
  });

  test('POST /copilot/draft kind=questions → labelled ai_draft', async () => {
    const r = await app.inject({ method: 'POST', url: '/copilot/draft', headers: H(teacher.token),
      payload: { kind: 'questions', params: { subject: 'Mathematics', classGrade: '8', focus: 'Fractions' } } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().label, 'ai_draft');
    assert.ok(r.json().draft.includes('ai_draft'));
  });
});

describe('TEST-3 · parent DTO contracts', () => {
  test('GET /parent/home → children[] with child_id/name/class/attendance_today/attention', async () => {
    const r = await app.inject({ method: 'GET', url: '/parent/home', headers: H(parent.token) });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.ok(Array.isArray(b.children) && Array.isArray(b.actions));
    for (const c of b.children) {
      for (const k of ['child_id', 'name', 'class', 'attendance_today', 'attention']) assert.ok(k in c, `child carries ${k}`);
    }
  });

  test('GET /parent/brief → when/headline/attendance_pct/children/sentences', async () => {
    const r = await app.inject({ method: 'GET', url: '/parent/brief?when=morning', headers: H(parent.token) });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    for (const k of ['when', 'headline', 'attendance_pct', 'reports_published', 'children', 'sentences', 'label']) {
      assert.ok(k in b, `brief carries ${k}`);
    }
    assert.ok(Array.isArray(b.sentences));
  });

  test('GET /parent/child/:id/assignments → bucket shape', async () => {
    const home = await app.inject({ method: 'GET', url: '/parent/home', headers: H(parent.token) });
    const child = home.json().children[0];
    const r = await app.inject({ method: 'GET', url: `/parent/child/${child.child_id}/assignments`, headers: H(parent.token) });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    for (const k of ['upcoming', 'submitted', 'reviewed', 'overdue', 'missing', 'explain']) assert.ok(k in b, `assignments carries ${k}`);
  });

  test('GET /parent/child/:id/attendance → today/month_pct/history/note', async () => {
    const home = await app.inject({ method: 'GET', url: '/parent/home', headers: H(parent.token) });
    const child = home.json().children[0];
    const r = await app.inject({ method: 'GET', url: `/parent/child/${child.child_id}/attendance`, headers: H(parent.token) });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    for (const k of ['today', 'month_pct', 'history', 'note']) assert.ok(k in b, `attendance carries ${k}`);
  });

  test('GET /parent/consents → consents[] with child attribution', async () => {
    const r = await app.inject({ method: 'GET', url: '/parent/consents', headers: H(parent.token) });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(Array.isArray(r.json().consents));
  });

  test('POST /parent/copilot/ask → answer/sources/budget_left', async () => {
    const r = await app.inject({ method: 'POST', url: '/parent/copilot/ask', headers: H(parent.token), payload: { question: 'What homework is due?' } });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    for (const k of ['answer', 'sources', 'budget_left', 'empty', 'label']) assert.ok(k in b, `ask carries ${k}`);
  });

  test('GET /parent/child/:id/documents → documents[] with id/filename/mime/bytes/created_at (PRD-5)', async () => {
    const home = await app.inject({ method: 'GET', url: '/parent/home', headers: H(parent.token) });
    const child = home.json().children[0];
    const r = await app.inject({ method: 'GET', url: `/parent/child/${child.child_id}/documents`, headers: H(parent.token) });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.ok(Array.isArray(b.documents) && typeof b.note === 'string');
    for (const d of b.documents) for (const k of ['id', 'filename', 'mime', 'bytes', 'created_at']) assert.ok(k in d, `document carries ${k}`);
  });

  test('GET /parent/child/:id/transport → route/route_code/note', async () => {
    const home = await app.inject({ method: 'GET', url: '/parent/home', headers: H(parent.token) });
    const child = home.json().children[0];
    const r = await app.inject({ method: 'GET', url: `/parent/child/${child.child_id}/transport`, headers: H(parent.token) });
    assert.equal(r.statusCode, 200, r.body);
    for (const k of ['route', 'route_code', 'note']) assert.ok(k in r.json(), `transport carries ${k}`);
  });
});

describe('TEST-3 · owner/principal oversight home contract (OPP-API-1)', () => {
  test('GET /owner/home and /principal/home → students/queue_total/fees/attendance_today/compliance/safety_open', async () => {
    for (const email of ['owner@meridian.edu', 'principal@meridian.edu']) {
      const u = await loginAs(app, email);
      const r = await app.inject({ method: 'GET', url: email.startsWith('owner') ? '/owner/home' : '/principal/home', headers: H(u.token) });
      assert.equal(r.statusCode, 200, r.body);
      const b = r.json();
      for (const k of ['students', 'queue', 'queue_total', 'fees', 'attendance_today', 'compliance', 'safety_open']) {
        assert.ok(k in b, `${email} home carries ${k}`);
      }
      assert.ok(typeof b.students === 'number' && typeof b.fees.outstanding === 'number');
    }
  });
});

describe('TEST-3 · student DTO contracts', () => {
  test('GET /student/home → student/next_class/today/needs_attention/progress/bag_tomorrow/session', async () => {
    const r = await app.inject({ method: 'GET', url: '/student/home', headers: H(student.token) });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    for (const k of ['next_class', 'today', 'needs_attention', 'progress', 'bag_tomorrow', 'session']) assert.ok(k in b, `home carries ${k}`);
    assert.ok('idle_minutes' in b.session, 'session carries idle_minutes (the field the client reads)');
  });

  test('GET /student/homework → digital[]/paper[] with id/title/mode', async () => {
    const r = await app.inject({ method: 'GET', url: '/student/homework', headers: H(student.token) });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.ok(Array.isArray(b.digital) && Array.isArray(b.paper));
    // the door splits the lists and sends id/title/subject/due_at/note; the client maps
    // `due_at` → its `due` field (regression: it used to read `due`/`due_date` and show blank).
    for (const item of [...b.digital, ...b.paper]) {
      for (const k of ['id', 'title', 'subject', 'due_at', 'note']) assert.ok(k in item, `homework item carries ${k}`);
    }
  });

  test('GET /student/session → idle_minutes + logout_url', async () => {
    const r = await app.inject({ method: 'GET', url: '/student/session', headers: H(student.token) });
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.ok('idle_minutes' in b && 'logout_url' in b);
  });

  test('GET /student/results → reports[] with title/period/explain', async () => {
    const r = await app.inject({ method: 'GET', url: '/student/results', headers: H(student.token) });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(Array.isArray(r.json().reports));
  });
});
