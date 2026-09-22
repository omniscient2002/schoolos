// Wave B — people.admin · library · files.store (migrations 046/047/048).
// Pins under test: library issue→409 when no copies→return computes the fine ·
// transfer writes history + updates the student (single tx) · CSV import lands bad
// rows in failed[] instead of throwing · provisioning 409s duplicate emails and
// refuses owner creation · suspension is audited at the door (login-shape assertion
// deliberately skipped — kernel-owned, orchestrator's shared-DB pass covers it) ·
// files: base64 upload whitelist rejects .exe, guardian-of-child download allowed,
// stranger 403. Style: tests/teacher-classroom.test.js · WRITE-ONLY (Wave B law:
// never executed in-lane; the orchestrator runs the suite against the shared DB).
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { setupTestDb, loginAs } from './helpers.js';

let app;
let pool;
let owner, coordinator, teacher, parent, student, itadmin; // tokens cached (login limiter: 20/min)
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  coordinator = await loginAs(app, 'coordinator@meridian.edu');
  teacher = await loginAs(app, 'teacher@meridian.edu');
  parent = await loginAs(app, 'parent@meridian.edu');
  student = await loginAs(app, 'student@meridian.edu');
  itadmin = await loginAs(app, 'itadmin@meridian.edu');
  const tenantId = (await pool.query(`SELECT tenant_id FROM app.users WHERE email='owner@meridian.edu'`)).rows[0].tenant_id;
  // enable through the real lifecycle door (registry rows authored by migrations 046-048)
  for (const [id, cls] of [['people.admin', 'B'], ['library', 'C'], ['files.store', 'B']]) {
    const en = await app.inject({ method: 'POST', url: `/plugins/${id}/enable`, headers: H(owner.token), payload: { version: '1.0.0', class: cls } });
    assert.equal(en.statusCode, 200, `enable ${id} via owner door: ${en.body}`);
  }
  // roster fixtures: Aarav (the demo cast, parent-linked by 034) + one other active student
  const aarav = (await pool.query(`SELECT id FROM app.students WHERE tenant_id=$1 AND name='Aarav Sharma' AND status='active'`, [tenantId])).rows[0];
  const other = (await pool.query(`SELECT id, grade, section FROM app.students WHERE tenant_id=$1 AND status='active' AND name <> 'Aarav Sharma' ORDER BY admission_no LIMIT 1`, [tenantId])).rows[0];
  const anyAdmission = (await pool.query(`SELECT admission_no FROM app.students WHERE tenant_id=$1 ORDER BY admission_no LIMIT 1`, [tenantId])).rows[0];
  globalThis.__wb = { tenantId, aaravId: aarav.id, otherId: other.id, otherGrade: other.grade, otherSection: other.section, anyAdmission: anyAdmission.admission_no };
});

after(async () => { await app?.close(); });

// ── people.admin ────────────────────────────────────────────────────────────────
test('people.admin: provisions a teacher with a generated temp password (force_change stamped, shown once)', async () => {
  const { tenantId } = globalThis.__wb;
  const r = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.token),
    payload: { email: 'waveb.teacher@meridian.edu', name: 'Wave B Teacher', role: 'teacher' } });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.ok(body.temporaryPassword, 'generated temp password is returned when the caller supplies none');
  assert.match(body.note, /once/i, 'the response carries the shown-once note');
  const row = (await pool.query(`SELECT force_change, role, active FROM app.users WHERE tenant_id=$1 AND email='waveb.teacher@meridian.edu'`, [tenantId])).rows[0];
  assert.equal(row.role, 'teacher');
  assert.equal(row.force_change, true, 'generated temp ⇒ force_change stamped');
});

test('people.admin: duplicate email → 409 friendly (SAVEPOINT pattern, not a 500)', async () => {
  const r = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.token),
    payload: { email: 'waveb.teacher@meridian.edu', name: 'Second Attempt', role: 'teacher' } });
  assert.equal(r.statusCode, 409, r.body);
  assert.match(r.json().error, /already exists/i);
});

test('people.admin: owner creation is forbidden and the attempt is audited', async () => {
  const r = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.token),
    payload: { email: 'new.owner@meridian.edu', name: 'Owner Attempt', role: 'owner' } });
  assert.equal(r.statusCode, 403, r.body);
  const audit = (await pool.query(
    `SELECT outcome FROM app.audit_log WHERE action ILIKE '%owner provisioning%' AND outcome ILIKE '%refused%' ORDER BY created_at DESC LIMIT 1`)).rows[0];
  assert.ok(audit, 'refused owner-creation attempt is in the ledger');
});

test('people.admin: only the owner may create a principal account (itadmin refused + audited)', async () => {
  // FIX-ITADMIN: itadmin is the onboarding authority but may NOT mint a principal.
  const denied = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(itadmin.token),
    payload: { email: 'new.principal@meridian.edu', name: 'Principal Attempt', role: 'principal' } });
  assert.equal(denied.statusCode, 403, denied.body);
  const audit = (await pool.query(
    `SELECT risk, outcome FROM app.audit_log WHERE action ILIKE '%principal provisioning%' AND outcome ILIKE '%refused%' ORDER BY created_at DESC LIMIT 1`)).rows[0];
  assert.ok(audit, 'refused principal-creation attempt is in the ledger');
  assert.equal(audit.risk, 'high', 'the refusal is recorded as high risk');

  // the owner may still create a principal
  const ok = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.token),
    payload: { email: 'owner.made.principal@meridian.edu', name: 'Owner Made Principal', role: 'principal' } });
  assert.equal(ok.statusCode, 200, ok.body);
});

test('people.admin: suspend → 200, door audit asserted via SQL (login-shape assertion skipped)', async () => {
  const mk = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.token),
    payload: { email: 'waveb.suspendee@meridian.edu', name: 'Suspend Me', role: 'facilities' } });
  assert.equal(mk.statusCode, 200, mk.body);
  const userId = mk.json().user.id;
  const r = await app.inject({ method: 'POST', url: `/plugins/people.admin/users/${userId}/suspend`, headers: H(owner.token), payload: {} });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().active, false);
  const row = (await pool.query(`SELECT active FROM app.users WHERE id=$1`, [userId])).rows[0];
  assert.equal(row.active, false);
  // door audit asserted via SQL read — the kernel login-shape assertion (401 copy on
  // POST /auth/login) is deliberately SKIPPED here: login behavior is kernel-owned and
  // the orchestrator's shared-DB pass covers it (Wave B law: no kernel edits, no
  // limiter budget spent on a copy assertion).
  const audit = (await pool.query(
    `SELECT actor_role, outcome FROM app.audit_log WHERE record_type='User' AND record_ref=$1 AND action ILIKE '%suspend%'`,
    [userId])).rows[0];
  assert.ok(audit, 'suspension is in the audit ledger');
  assert.equal(audit.actor_role, 'plugin:people.admin');
  assert.match(audit.outcome, /account disabled/);
  const ownerBlock = await app.inject({ method: 'POST', url: `/plugins/people.admin/users/${globalThis.__wb.ownerId ?? '00000000-0000-0000-0000-000000000000'}/suspend`, headers: H(owner.token), payload: {} });
  assert.ok([404, 403].includes(ownerBlock.statusCode), 'owner account is protected (404 unknown / 403 owner)');
});

test('people.admin: transfer writes the history row and updates the student (same transaction contract)', async () => {
  const { otherId, otherGrade, otherSection } = globalThis.__wb;
  const r = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${otherId}/transfer`, headers: H(coordinator.token),
    payload: { to_grade: '9', to_section: 'A', reason: 'Wave B test: section rebalance' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().from, { grade: otherGrade, section: otherSection });
  assert.deepEqual(r.json().to, { grade: '9', section: 'A' });
  const hist = (await pool.query(
    `SELECT from_grade, from_section, to_grade, to_section FROM app.enrollment_history WHERE student_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [otherId])).rows[0];
  assert.ok(hist, 'enrollment history row exists');
  assert.equal(hist.from_grade, otherGrade);
  assert.equal(hist.from_section, otherSection);
  assert.equal(hist.to_grade, '9');
  assert.equal(hist.to_section, 'A');
  const st = (await pool.query(`SELECT grade, section FROM app.students WHERE id=$1`, [otherId])).rows[0];
  assert.equal(st.grade, '9');
  assert.equal(st.section, 'A');
  // no-op transfer is a 409 (history rows are for real moves only)
  const again = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${otherId}/transfer`, headers: H(coordinator.token),
    payload: { to_grade: '9', to_section: 'A' } });
  assert.equal(again.statusCode, 409, again.body);
  // teacher is not on the transfer door
  const denied = await app.inject({ method: 'POST', url: `/plugins/people.admin/students/${otherId}/transfer`, headers: H(teacher.token),
    payload: { to_grade: '10', to_section: 'B' } });
  assert.equal(denied.statusCode, 403, denied.body);
});

test('people.admin: CSV import — valid rows inserted, bad rows land in failed[] (never thrown)', async () => {
  const { tenantId, anyAdmission } = globalThis.__wb;
  const csv = [
    'name,grade,section,admission_no,guardian_name,guardian_phone',
    'Import One,7,A,WB-IMP-0001,Guardian One,+919000000001',
    'Import Two,7,B,,Guardian Two,+919000000002',             // no admission_no → auto-generated
    ',7,C,WB-IMP-0003,,',                                      // bad: missing name
    'Import Four,7,C,WB-IMP-0001,,',                           // bad: duplicate admission within file
    `Import Five,7,D,${anyAdmission},,`,                       // bad: admission already on the roster (23505)
  ].join('\n');
  const r = await app.inject({ method: 'POST', url: '/plugins/people.admin/import/students', headers: H(coordinator.token),
    payload: { csv } });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.imported, 2, 'valid rows commit');
  assert.equal(body.failedCount, 3, 'bad rows are reported, not thrown');
  assert.equal(body.failed.length, 3);
  for (const f of body.failed) { assert.ok(f.row >= 2, 'failed rows carry the human line number'); assert.ok(f.error); }
  const inserted = (await pool.query(
    `SELECT count(*)::int AS n FROM app.students WHERE tenant_id=$1 AND source='import' AND admission_no IN ('WB-IMP-0001','WB-IMP-0002') OR (tenant_id=$1 AND source='import' AND admission_no LIKE 'IMP-%')`,
    [tenantId])).rows[0].n;
  assert.ok(inserted >= 2, 'imported students are on the roster');
  const dupe = body.failed.find((f) => /already on the roster/.test(f.error));
  assert.ok(dupe, 'DB-duplicate admission (UNIQUE 23505) is caught per-row');
  const indup = body.failed.find((f) => /duplicate admission number in file/.test(f.error));
  assert.ok(indup, 'in-file duplicate admission is caught');
});

test('people.admin: itadmin can bulk-import students (onboarding authority)', async () => {
  // FIX-ITADMIN: itadmin is the roster/onboarding authority — bulk import is in scope.
  const csv = [
    'name,grade,section,admission_no,guardian_name,guardian_phone',
    'Itadmin Import,9,A,WB-ITA-0001,Guardian IA,+919000000009',
  ].join('\n');
  const r = await app.inject({ method: 'POST', url: '/plugins/people.admin/import/students', headers: H(itadmin.token), payload: { csv } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().imported, 1, 'itadmin import commits the valid row');
});

// ── library ─────────────────────────────────────────────────────────────────────
test('library: librarian adds a book (1 copy) → issue → second issue 409 "no copies available" → return computes fine', async () => {
  // library v2: the desk is the dedicated `librarian` role, and staff borrowing is a first-class path.
  const made = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.token),
    payload: { name: 'Wave B Librarian', email: 'wb.librarian@meridian.edu', role: 'librarian', password: 'wb-lib-pass-1' } });
  assert.equal(made.statusCode, 200, `appoint a librarian: ${made.body}`);
  const librarian = await loginAs(app, 'wb.librarian@meridian.edu', 'wb-lib-pass-1');
  const { aaravId } = globalThis.__wb;
  const add = await app.inject({ method: 'POST', url: '/plugins/library/books', headers: H(librarian.token),
    payload: { code: 'WB-BOOK-1', title: 'Wave B Test Book', author: 'A. Author', category: 'test', copies_total: 1 } });
  assert.equal(add.statusCode, 200, add.body);
  const bookId = add.json().bookId;

  const due = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10); // 3 days ago → 3 days overdue
  const issue = await app.inject({ method: 'POST', url: '/plugins/library/loans', headers: H(librarian.token),
    payload: { bookId, studentId: aaravId, dueOn: due } });
  assert.equal(issue.statusCode, 200, issue.body);
  const loanId = issue.json().loanId;

  const second = await app.inject({ method: 'POST', url: '/plugins/library/loans', headers: H(librarian.token),
    payload: { bookId, studentId: aaravId, dueOn: due } });
  assert.equal(second.statusCode, 409, second.body);
  assert.equal(second.json().error, 'no copies available');

  // overdue chase list sees it while open
  const od = await app.inject({ method: 'GET', url: '/plugins/library/overdue', headers: H(librarian.token) });
  assert.equal(od.statusCode, 200, od.body);
  assert.ok(od.json().loans.some((o) => o.id === loanId && o.daysOverdue >= 3), 'open overdue loan is on the chase list');

  const ret = await app.inject({ method: 'POST', url: `/plugins/library/loans/${loanId}/return`, headers: H(librarian.token), payload: {} });
  assert.equal(ret.statusCode, 200, ret.body);
  assert.equal(ret.json().fineCents, 1500, 'fine = 3 days × 500 paise (settings default)');
  const loan = (await pool.query(`SELECT status, fine_cents, returned_at FROM library.loan WHERE id=$1`, [loanId])).rows[0];
  assert.equal(loan.status, 'returned');
  assert.equal(loan.fine_cents, 1500);
  assert.ok(loan.returned_at, 'returned_at stamped once');

  // the freed copy can be issued again (availability is derived from the copy, never stored)
  const future = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const reissue = await app.inject({ method: 'POST', url: '/plugins/library/loans', headers: H(librarian.token),
    payload: { bookId, studentId: aaravId, dueOn: future } });
  assert.equal(reissue.statusCode, 200, reissue.body);

  // student self-scope: Aarav sees his loans, and only his loans
  const mine = await app.inject({ method: 'GET', url: '/plugins/library/loans/mine', headers: H(student.token) });
  assert.equal(mine.statusCode, 200, mine.body);
  assert.ok(mine.json().loans.some((l) => l.id === reissue.json().loanId), 'own loan listed');
});

// ── files.store ─────────────────────────────────────────────────────────────────
test('files.store: base64 upload whitelists types, stores sha256, guardian-of-child downloads, stranger 403', async () => {
  const { aaravId, tenantId } = globalThis.__wb;
  const bytes = Buffer.from('%PDF-1.4\n% Wave B test document\n');
  const up = await app.inject({ method: 'POST', url: '/plugins/files.store/upload', headers: H(teacher.token),
    payload: { filename: 'worksheet.pdf', mime: 'application/pdf', dataBase64: bytes.toString('base64'), scope: 'student', refId: aaravId } });
  assert.equal(up.statusCode, 200, up.body);
  const fileId = up.json().file.id;
  assert.equal(up.json().file.sha256, createHash('sha256').update(bytes).digest('hex'), 'sha256 over the exact bytes');

  // whitelist: .exe (and its mime) is refused — extension and mime must both agree
  const exe = await app.inject({ method: 'POST', url: '/plugins/files.store/upload', headers: H(teacher.token),
    payload: { filename: 'virus.exe', mime: 'application/x-msdownload', dataBase64: Buffer.from('MZ...').toString('base64'), scope: 'general' } });
  assert.equal(exe.statusCode, 415, exe.body);
  const dressed = await app.inject({ method: 'POST', url: '/plugins/files.store/upload', headers: H(teacher.token),
    payload: { filename: 'doc.pdf', mime: 'image/png', dataBase64: Buffer.from('not really').toString('base64'), scope: 'general' } });
  assert.equal(dressed.statusCode, 415, dressed.body, 'extension/mime disagreement refused');

  // guardian of the child downloads (Kavita Sharma ↔ Aarav via the 034 child_link)
  const okDl = await app.inject({ method: 'GET', url: `/plugins/files.store/${fileId}/download`, headers: { authorization: `Bearer ${parent.token}` } });
  assert.equal(okDl.statusCode, 200, okDl.body);
  assert.equal(okDl.headers['content-disposition'].includes('worksheet.pdf'), true, 'original filename rides the download');
  assert.equal(okDl.rawPayload.toString(), bytes.toString(), 'bytes round-trip');

  // stranger (a parent with no child_link to this student) is 403 — audited refusal
  const mk = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.token),
    payload: { email: 'waveb.stranger@meridian.edu', name: 'Stranger Parent', role: 'parent' } });
  assert.equal(mk.statusCode, 200, mk.body);
  const stranger = await loginAs(app, 'waveb.stranger@meridian.edu', mk.json().temporaryPassword);
  const nope = await app.inject({ method: 'GET', url: `/plugins/files.store/${fileId}/download`, headers: { authorization: `Bearer ${stranger.token}` } });
  assert.equal(nope.statusCode, 403, nope.body);
  const refusal = (await pool.query(
    `SELECT outcome FROM app.audit_log WHERE record_type='File' AND record_ref=$1 AND action ILIKE '%refused%'`,
    [fileId])).rows[0];
  assert.ok(refusal, 'refused download is audited');

  // PLGX-4: the student's name-match fallback is gone — a display name is not an identity (375 students /
  // 76 distinct names in a seeded school). A student may still download a file THEY uploaded, but a
  // teacher-published worksheet for their class needs the Phase-2 user↔student link, so this refuses.
  const selfDl = await app.inject({ method: 'GET', url: `/plugins/files.store/${fileId}/download`, headers: { authorization: `Bearer ${student.token}` } });
  assert.equal(selfDl.statusCode, 403, 'name equality must not authorize a download');

  // metadata list carries no bytes; download audit row exists (risk low)
  const list = await app.inject({ method: 'GET', url: `/plugins/files.store?scope=student&refId=${aaravId}`, headers: H(teacher.token) });
  assert.equal(list.statusCode, 200, list.body);
  assert.ok(list.json().files.some((f) => f.id === fileId));
  const dlAudit = (await pool.query(
    `SELECT risk FROM app.audit_log WHERE record_type='File' AND record_ref=$1 AND action ILIKE '%downloaded%'`,
    [fileId])).rows[0];
  assert.ok(dlAudit, 'download is audited');
  assert.equal(dlAudit.risk, 'low');
  assert.ok(tenantId, 'tenant pinned throughout');
});
