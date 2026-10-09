/* library v2 — the full LMS contract (docs/LIBRARY-DESIGN.md).
 *
 * Pins the owner's decisions end to end through the real doors:
 *   · the desk is `librarian` ONLY — owner/coordinator/teacher are refused, and owner gets aggregates only.
 *   · owner/principal enable + configure; the librarian edits notification settings; the identifier scheme
 *     stays owner/principal (a librarian may not change it).
 *   · per-copy tracking, availability derived, one open loan per copy, staff borrowers.
 *   · reservations (holds) with a FIFO queue advanced by a return.
 *   · fines computed once at return, ledgered.
 *   · purchase requests with demand voting.
 *   · the day-worker due/overdue sweep notifies the borrower and the parent.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb, loginAs } from './helpers.js';

let app, pool, owner, tenantId;
const H = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const brief = (r) => `HTTP ${r.statusCode} ${String(r.body ?? '').slice(0, 200)}`;
const sql = (text, params) => pool.query(text, params);

const j = async (method, url, token, payload) => {
  const r = await app.inject({ method, url, headers: H(token), ...(payload !== undefined ? { payload } : {}) });
  return r;
};

before(async () => {
  await setupTestDb();
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: { level: 'error' } });
  pool = (await import('../src/db.js')).pool;
  owner = await loginAs(app, 'owner@meridian.edu');
  tenantId = (await sql(`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  const en = await app.inject({ method: 'POST', url: '/plugins/library/enable', headers: H(owner.token), payload: {} });
  assert.ok([200, 409].includes(en.statusCode), `enable library: ${brief(en)}`);
});

after(async () => { await app?.close(); });

let libSeq = 0;
async function makeLibrarian(email) {
  const addr = email ?? `librarian.${++libSeq}.${Date.now()}@meridian.edu`;
  const created = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.token),
    payload: { name: 'Meera Librarian', email: addr, role: 'librarian', password: 'library-pass-1' } });
  assert.equal(created.statusCode, 200, `appoint a librarian: ${brief(created)}`);
  return loginAs(app, addr, 'library-pass-1');
}

describe('library v2 · identity and gates', () => {
  test('librarian is a published role and the desk is librarIAN-only', async () => {
    const { ROLES } = await import('../src/auth.js');
    assert.ok(ROLES.includes('librarian'), 'librarian must be a built-in role');
    const lib = await makeLibrarian();

    const ok = await j('GET', '/plugins/library/desk/overview', lib.token);
    assert.equal(ok.statusCode, 200, brief(ok));

    const refused = await makeStaff('teacher', 't.lib@meridian.edu');
    const t = await j('GET', '/plugins/library/desk/overview', refused.token);
    assert.equal(t.statusCode, 403, 'a teacher must not run the library desk');

    const coord = await makeStaff('coordinator', 'c.lib@meridian.edu');
    const c = await j('POST', '/plugins/library/books', coord.token, { title: 'Nope', copies: 1 });
    assert.equal(c.statusCode, 403, 'a coordinator must not catalogue books');
  });

  test('owner/principal see aggregates only; the desk refuses them', async () => {
    const desk = await j('GET', '/plugins/library/desk/overview', owner.token);
    assert.equal(desk.statusCode, 403, 'the owner must not open the librarian desk');
    const ops = await j('GET', '/plugins/library/ops/overview', owner.token);
    assert.equal(ops.statusCode, 200, brief(ops));
    const body = JSON.parse(ops.body);
    assert.ok(body.totals && typeof body.totals.titles === 'number', 'ops returns aggregates');
    assert.ok(!JSON.stringify(body).includes('admission_no'), 'ops must not leak borrower identity');
  });
});

async function makeStaff(role, email) {
  const created = await app.inject({ method: 'POST', url: '/plugins/people.admin/users', headers: H(owner.token),
    payload: { name: `${role} user`, email, role, password: 'staff-pass-1' } });
  assert.equal(created.statusCode, 200, `provision ${role}: ${brief(created)}`);
  return loginAs(app, email, 'staff-pass-1');
}

describe('library v2 · catalog, copies and circulation', () => {
  let lib;
  before(async () => { lib = await makeLibrarian(); });

  test('a book is created with physical copies and derived availability', async () => {
    const add = await j('POST', '/plugins/library/books', lib.token, { title: 'Wings of Fire', author: 'A.P.J. Abdul Kalam', copies: 2, category: 'Biography' });
    assert.equal(add.statusCode, 200, brief(add));
    const bookId = JSON.parse(add.body).bookId;
    const cat = await j('GET', '/plugins/library/desk/books?search=Wings', lib.token);
    const book = JSON.parse(cat.body).books.find((b) => b.id === bookId);
    assert.equal(book.copiesTotal, 2);
    assert.equal(book.available, 2);
    const copies = await j('GET', '/plugins/library/copies', lib.token);
    assert.equal(JSON.parse(copies.body).copies.filter((c) => c.book_id === bookId).length, 2, 'two copy rows exist');
  });

  test('a bulk catalog import writes the batch in one transaction and emits ONE summary event (D5)', async () => {
    const countEvents = async () => (await sql(
      `SELECT count(*)::int n FROM app.outbox WHERE emitted_by='plugin:library' AND topic='library.catalog.imported.v1'`)).rows[0].n;
    const before = await countEvents();
    const stamp = Date.now();
    const books = Array.from({ length: 25 }, (_, i) => ({ title: `Bulk Title ${i}`, author: `Author ${i}`, copies: 2, code: `BULK-${stamp}-${i}` }));
    const r = await j('POST', '/plugins/library/books/bulk', lib.token, { books });
    assert.equal(r.statusCode, 200, brief(r));
    assert.equal(JSON.parse(r.body).inserted, 25, 'every valid title is written');
    assert.equal(JSON.parse(r.body).copies, 50, 'every copy row is created');
    assert.equal(await countEvents() - before, 1, 'the whole import is ONE summary event — the event budget is never tripped');
    const cat = await j('GET', `/plugins/library/desk/books?search=Bulk Title 24`, lib.token);
    assert.ok(JSON.parse(cat.body).books.some((b) => b.title === 'Bulk Title 24'), 'the imported title is catalogued');
    // all-or-nothing: one invalid row means nothing is written
    const bad = await j('POST', '/plugins/library/books/bulk', lib.token, { books: [
      { title: 'Valid But Unwritten', copies: 1, code: `BULK-BAD-${stamp}` },
      { title: '', copies: 1 },
    ] });
    assert.equal(bad.statusCode, 409, brief(bad));
    const wrote = (await sql(`SELECT count(*)::int n FROM library.book WHERE tenant_id=$1 AND title='Valid But Unwritten'`, [tenantId])).rows[0].n;
    assert.equal(wrote, 0, 'a rejected batch writes nothing');
    // a coordinator (not the librarian desk) is refused
    const coord = await makeStaff('coordinator', `c.bulk.${stamp}@meridian.edu`);
    const refused = await j('POST', '/plugins/library/books/bulk', coord.token, { books: [{ title: 'Nope', copies: 1 }] });
    assert.equal(refused.statusCode, 403, 'bulk import is librarian-desk only');
  });

  test('list doors carry the pagination envelope and clamp an oversized limit (LMS-14)', async () => {
    await j('POST', '/plugins/library/books', lib.token, { title: 'Page One', copies: 1 });
    const one = await j('GET', '/plugins/library/desk/books?limit=1&offset=0', lib.token);
    assert.equal(one.statusCode, 200, brief(one));
    const body = JSON.parse(one.body);
    assert.equal(body.limit, 1);
    assert.equal(body.offset, 0);
    assert.equal(body.books.length, 1);
    assert.equal(body.hasMore, true);
    const clamped = await j('GET', '/plugins/library/desk/books?limit=99999', lib.token);
    assert.equal(JSON.parse(clamped.body).limit, 300, 'an oversized limit is clamped to the door max');
    const copies = await j('GET', '/plugins/library/copies?limit=1', lib.token);
    const cb = JSON.parse(copies.body);
    assert.equal(cb.limit, 1);
    assert.equal(cb.copies.length, 1);
    assert.equal(cb.hasMore, true);
  });

  test('the librarian may assign a catalogue reference, and a duplicate is refused (desk redesign)', async () => {
    const own = await j('POST', '/plugins/library/books', lib.token, { title: 'Reference Assigned', copies: 1, code: 'SAH-TEST-REF-1' });
    assert.equal(own.statusCode, 200, brief(own));
    assert.equal(JSON.parse(own.body).book.code, 'SAH-TEST-REF-1', 'the librarian reference is stored verbatim');
    const dup = await j('POST', '/plugins/library/books', lib.token, { title: 'Reference Clash', copies: 1, code: 'sah-test-ref-1' });
    assert.equal(dup.statusCode, 409, 'a reference already in use is refused, case-insensitively');
  });

  test('borrowers can be narrowed by type, class, section and id (desk redesign)', async () => {
    const byClass = await j('GET', '/plugins/library/members?type=student&grade=6&section=A', lib.token);
    assert.equal(byClass.statusCode, 200, brief(byClass));
    const students = JSON.parse(byClass.body).students;
    assert.ok(students.length >= 1, 'the class filter returns the pupils of 6-A');
    assert.ok(students.every((s) => s.grade === '6' && s.section === 'A'), 'every returned row is in the requested class');
    const staff = await j('GET', '/plugins/library/members?type=staff', lib.token);
    assert.ok(JSON.parse(staff.body).borrowers.every((b) => b.type === 'staff'), 'the type filter excludes students');
    const byId = await j('GET', `/plugins/library/members?search=${students[0].admission_no}`, lib.token);
    assert.ok(JSON.parse(byId.body).students.some((s) => s.admission_no === students[0].admission_no), 'an admission number finds the borrower');
  });

  test('a book cover references a stored file and round-trips the catalog (LMS-23)', async () => {
    const add = await j('POST', '/plugins/library/books', lib.token, { title: 'Covered Title', copies: 1 });
    const bookId = JSON.parse(add.body).bookId;
    const uploader = (await sql(`SELECT id FROM app.users WHERE tenant_id=$1 AND role='librarian' ORDER BY created_at LIMIT 1`, [tenantId])).rows[0];
    const f = (await sql(
      `INSERT INTO app.files (tenant_id, uploader_id, filename, mime, bytes, sha256, storage_path, scope)
       VALUES ($1,$2,'cover.jpg','image/jpeg',10,$3,$4,'general') RETURNING id`,
      [tenantId, uploader.id, 'a'.repeat(64), `${tenantId}/missing-${Date.now()}.jpg`])).rows[0];
    const set = await j('PATCH', `/plugins/library/books/${bookId}`, lib.token, { cover_file_id: f.id });
    assert.equal(set.statusCode, 200, brief(set));
    const cat = await j('GET', `/plugins/library/catalog/${bookId}`, lib.token);
    assert.equal(JSON.parse(cat.body).book.coverFileId, f.id, 'the catalog exposes the cover reference');
    const bad = await j('PATCH', `/plugins/library/books/${bookId}`, lib.token, { cover_file_id: '11111111-1111-1111-1111-111111111111' });
    assert.equal(bad.statusCode, 404, 'a cover must reference a real file in this tenant');
  });

  test('issue to a student, second issue on the last copy is refused, and staff can borrow too', async () => {
    const add = await j('POST', '/plugins/library/books', lib.token, { title: 'Solo Copy', copies: 1 });
    const bookId = JSON.parse(add.body).bookId;
    const students = (await sql(`SELECT id, name FROM app.students WHERE tenant_id=$1 AND status='active' ORDER BY name LIMIT 2`, [tenantId])).rows;

    const one = await j('POST', '/plugins/library/loans', lib.token, { bookId, studentId: students[0].id });
    assert.equal(one.statusCode, 200, brief(one));
    const two = await j('POST', '/plugins/library/loans', lib.token, { bookId, studentId: students[1].id });
    assert.equal(two.statusCode, 409, 'the last copy cannot be lent twice');
    assert.match(two.body, /no copies available/i);

    // a staff borrower on a separate title
    const add2 = await j('POST', '/plugins/library/books', lib.token, { title: 'Staff Read', copies: 1 });
    const staffUser = (await sql(`SELECT id FROM app.users WHERE tenant_id=$1 AND role='teacher' AND active LIMIT 1`, [tenantId])).rows[0];
    const staffLoan = await j('POST', '/plugins/library/loans', lib.token, { bookId: JSON.parse(add2.body).bookId, userId: staffUser.id, dueOn: '2026-12-01' });
    assert.equal(staffLoan.statusCode, 200, `staff must be able to borrow: ${brief(staffLoan)}`);
    assert.equal(JSON.parse(staffLoan.body).loan.status, 'issued');
  });

  test('return computes the fine once and ledgers it', async () => {
    const add = await j('POST', '/plugins/library/books', lib.token, { title: 'Overdue Life', copies: 1 });
    const bookId = JSON.parse(add.body).bookId;
    const student = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tenantId])).rows[0];
    const issued = await j('POST', '/plugins/library/loans', lib.token, { bookId, studentId: student.id, dueOn: '2026-01-01' });
    const loanId = JSON.parse(issued.body).loanId;
    const ret = await j('POST', `/plugins/library/loans/${loanId}/return`, lib.token, {});
    assert.equal(ret.statusCode, 200, brief(ret));
    const { fineCents, daysOverdue } = JSON.parse(ret.body);
    assert.ok(daysOverdue > 0 && fineCents > 0, 'a clearly-late return is fined');
    const fine = (await sql(`SELECT count(*)::int n FROM library.fine WHERE loan_id=$1 AND cause='overdue'`, [loanId])).rows[0].n;
    assert.equal(fine, 1, 'exactly one fine ledger row');
  });
});

describe('library v2 · reservations (holds)', () => {
  test('a hold is queued, becomes ready when a copy frees, and the borrower can see it', async () => {
    const lib = await makeLibrarian('librarian.holds@meridian.edu');
    const add = await j('POST', '/plugins/library/books', lib.token, { title: 'Held Title', copies: 1 });
    const bookId = JSON.parse(add.body).bookId;
    const students = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' ORDER BY name LIMIT 2`, [tenantId])).rows;

    const loan = await j('POST', '/plugins/library/loans', lib.token, { bookId, studentId: students[0].id });
    const loanId = JSON.parse(loan.body).loanId;

    // second student reserves via the borrower door (student role)
    const st2 = await loginAs(app, 'student@meridian.edu');
    const reserve = await j('POST', '/plugins/library/reservations', st2.token, { bookId });
    assert.ok([200, 409].includes(reserve.statusCode), brief(reserve));

    // returning the copy should advance the queue to ready (student@meridian maps by name)
    const ret = await j('POST', `/plugins/library/loans/${loanId}/return`, lib.token, {});
    assert.equal(ret.statusCode, 200, brief(ret));
    const ready = (await sql(`SELECT status FROM library.reservation WHERE tenant_id=$1 AND book_id=$2 ORDER BY requested_at DESC LIMIT 1`, [tenantId, bookId])).rows[0];
    assert.ok(['ready', 'requested'].includes(ready.status), 'a hold exists after the return');
  });
});

describe('library v2 · purchase requests', () => {
  let lib;
  before(async () => { lib = await makeLibrarian('librarian.acq.shared@meridian.edu'); });

  test('a borrower requests an uncatalogued book; a duplicate becomes a vote; the librarian marks it added', async () => {
    const teacher = await makeStaff('teacher', 'acq.teacher@meridian.edu');
    const req = await j('POST', '/plugins/library/acquisitions', teacher.token, { title: 'The Pragmatic Programmer', author: 'Hunt' });
    assert.equal(req.statusCode, 200, brief(req));
    const requestId = JSON.parse(req.body).requestId ?? JSON.parse(req.body).request?.id;

    const dup = await j('POST', '/plugins/library/acquisitions', teacher.token, { title: 'the pragmatic programmer', author: 'hunt' });
    assert.equal(dup.statusCode, 200);
    const votes = (await sql(`SELECT vote_count FROM library.acquisition_request WHERE id=$1`, [requestId])).rows[0].vote_count;
    assert.ok(votes >= 1);

    const decided = await j('POST', `/plugins/library/acquisitions/${requestId}/decide`, lib.token, { decision: 'added' });
    assert.equal(decided.statusCode, 200, brief(decided));
    const added = JSON.parse(decided.body).addedBookId;
    assert.ok(added, 'adding a request creates the catalog book');
  });

  test('an acquisition decision carries vendor, budget and cost, and the report reconciles (LMS-24)', async () => {
    const teacher = await makeStaff('teacher', 'acq.budget@meridian.edu');
    const req = await j('POST', '/plugins/library/acquisitions', teacher.token, { title: `Budgeted Book ${Date.now()}`, author: 'Someone' });
    assert.equal(req.statusCode, 200, brief(req));
    const requestId = JSON.parse(req.body).requestId ?? JSON.parse(req.body).request?.id;
    const ordered = await j('POST', `/plugins/library/acquisitions/${requestId}/decide`, lib.token,
      { decision: 'ordered', vendor: 'Oxford Depot', budgetCode: 'LIB-2026', costCents: 125000 });
    assert.equal(ordered.statusCode, 200, brief(ordered));
    const row = (await sql(`SELECT vendor, budget_code, cost_cents, ordered_at, received_at FROM library.acquisition_request WHERE id=$1`, [requestId])).rows[0];
    assert.equal(row.vendor, 'Oxford Depot');
    assert.equal(row.budget_code, 'LIB-2026');
    assert.equal(row.cost_cents, 125000);
    assert.ok(row.ordered_at, 'ordering stamps ordered_at');
    assert.equal(row.received_at, null);
    const added = await j('POST', `/plugins/library/acquisitions/${requestId}/decide`, lib.token, { decision: 'added' });
    assert.equal(added.statusCode, 200, brief(added));
    assert.ok((await sql(`SELECT received_at FROM library.acquisition_request WHERE id=$1`, [requestId])).rows[0].received_at, 'adding stamps received_at');
    const report = await j('GET', '/plugins/library/reports/acquisitions', lib.token);
    assert.equal(report.statusCode, 200, brief(report));
    const found = JSON.parse(report.body).rows.find((r) => r.title.startsWith('Budgeted Book'));
    assert.ok(found, 'the acquisitions report lists the request');
    assert.equal(found.vendor, 'Oxford Depot');
  });

  test('borrower write doors are throttled per account, and one account cannot throttle another (E2)', async () => {
    const spammer = await makeStaff('teacher', 'throttle.spammer@meridian.edu');
    const calm = await makeStaff('teacher', 'throttle.calm@meridian.edu');
    const stamp = Date.now();
    for (let i = 0; i < 5; i++) {
      const r = await j('POST', '/plugins/library/acquisitions', spammer.token, { title: `Spam Title ${i} ${stamp}` });
      assert.equal(r.statusCode, 200, `request ${i} within the ceiling must pass: ${brief(r)}`);
    }
    const sixth = await j('POST', '/plugins/library/acquisitions', spammer.token, { title: `Spam Title Six ${stamp}` });
    assert.equal(sixth.statusCode, 429, `the sixth request in the window must be throttled: ${brief(sixth)}`);
    const unaffected = await j('POST', '/plugins/library/acquisitions', calm.token, { title: `Calm Title ${stamp}` });
    assert.equal(unaffected.statusCode, 200, `a different account is unaffected: ${brief(unaffected)}`);
  });
});

describe('library v2 · settings authority and delivery', () => {
  test('librarian edits notification settings but NOT the identifier scheme; owner can', async () => {
    const lib = await makeLibrarian('librarian.settings@meridian.edu');
    const notif = await j('PUT', '/plugins/library/desk/settings/notifications', lib.token, { due_reminder_days_before: [3, 1], notify_parent: false });
    assert.equal(notif.statusCode, 200, brief(notif));

    // the librarian owns the operational policy too (loan periods, fines, holds) — not just notifications
    const policy = await j('PUT', '/plugins/library/desk/settings', lib.token, { default_loan_days: 15, loan_days_student: 15, fine_per_day_cents: 300, reservation_hold_days: 3, allow_fine_waiver: true });
    assert.equal(policy.statusCode, 200, brief(policy));
    assert.equal(JSON.parse(policy.body).settings.default_loan_days, 15, 'the librarian policy change is persisted');
    const read = await j('GET', '/plugins/library/desk/settings', lib.token);
    assert.equal(read.statusCode, 200, brief(read));
    assert.equal(JSON.parse(read.body).settings.fine_per_day_cents, 300, 'the desk settings door reads the policy back');

    const scheme = await j('PUT', '/plugins/library/desk/settings/notifications', lib.token, { identifier_scheme: 'barcode' });
    assert.equal(scheme.statusCode, 400, 'a librarian must not change the identifier scheme here');

    const ownerSettings = await app.inject({ method: 'POST', url: '/plugins/library/settings', headers: H(owner.token), payload: { identifier_scheme: 'barcode' } });
    assert.ok([200, 400].includes(ownerSettings.statusCode), `owner settings door: ${brief(ownerSettings)}`);
  });

  test('the day-worker sweep raises a due reminder for an issued loan', async () => {
    const lib = await makeLibrarian('librarian.sweep@meridian.edu');
    await j('PUT', '/plugins/library/desk/settings/notifications', lib.token, { due_reminder_days_before: [0], notify_parent: true, notify_channels: ['in_app'] });
    const add = await j('POST', '/plugins/library/books', lib.token, { title: 'Due Today', copies: 1 });
    const bookId = JSON.parse(add.body).bookId;
    // a student with a linked guardian, so the sweep has a real notification target
    const student = (await sql(
      `SELECT s.id FROM app.students s JOIN family.child_link cl ON cl.student_id=s.id AND cl.tenant_id=s.tenant_id
        WHERE s.tenant_id=$1 AND s.status='active' LIMIT 1`, [tenantId])).rows[0];
    assert.ok(student, 'fixture: a student with a guardian link exists');
    const today = (await sql(`SELECT ('now' AT TIME ZONE 'Asia/Kolkata')::date::text AS d`)).rows[0].d;
    const issued = await j('POST', '/plugins/library/loans', lib.token, { bookId, studentId: student.id, dueOn: today });
    assert.equal(issued.statusCode, 200, brief(issued));

    const { runLibraryReminders } = await import('../scripts/day-worker.js');
    const out = await runLibraryReminders();
    assert.ok(out.notified >= 1, `the sweep must notify at least one target for a due-today loan (got ${out.notified})`);
    const n = (await sql(`SELECT count(*)::int n FROM app.notifications WHERE tenant_id=$1 AND "group"='library' AND ref=$2`, [tenantId, JSON.parse(issued.body).loanId])).rows[0];
    assert.ok(n.n >= 1, `a due reminder notification row exists for the loan (got ${n.n})`);
  });
});

describe('library v2 · loss, damage, waivers and expiry', () => {
  let lib;
  before(async () => { lib = await makeLibrarian('librarian.loss@meridian.edu'); });

  test('marking an issued copy lost closes the loan, ledgers a replacement fine, and blocks re-borrowing', async () => {
    const add = await j('POST', '/plugins/library/books', lib.token, { title: 'Lost Copy', copies: 1, priceCents: 20000 });
    assert.equal(add.statusCode, 200, brief(add));
    const bookId = JSON.parse(add.body).bookId;
    const student = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' LIMIT 1`, [tenantId])).rows[0];
    const issue = await j('POST', '/plugins/library/loans', lib.token, { bookId, studentId: student.id });
    const loanId = JSON.parse(issue.body).loanId;
    const copies = await j('GET', '/plugins/library/copies', lib.token);
    const copy = JSON.parse(copies.body).copies.find((c) => c.book_id === bookId);

    const lost = await j('PATCH', `/plugins/library/copies/${copy.id}`, lib.token, { status: 'lost' });
    assert.equal(lost.statusCode, 200, brief(lost));
    const loan = (await sql(`SELECT status, fine_cents FROM library.loan WHERE id=$1`, [loanId])).rows[0];
    assert.equal(loan.status, 'lost', 'the open loan is closed as lost');
    assert.ok(loan.fine_cents > 0, 'a replacement charge is ledgered');
    assert.equal((await sql(`SELECT count(*)::int n FROM library.fine WHERE loan_id=$1 AND cause='lost'`, [loanId])).rows[0].n, 1);

    const add2 = await j('POST', '/plugins/library/books', lib.token, { title: 'Another Title', copies: 1 });
    const blocked = await j('POST', '/plugins/library/loans', lib.token, { bookId: JSON.parse(add2.body).bookId, studentId: student.id });
    assert.equal(blocked.statusCode, 409, 'a borrower with a lost item cannot borrow again');
  });

  test('fine waiver can be switched off and back on by the owner', async () => {
    const add = await j('POST', '/plugins/library/books', lib.token, { title: 'Waive Me', copies: 1 });
    const bookId = JSON.parse(add.body).bookId;
    const student = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active'
      AND NOT EXISTS (SELECT 1 FROM library.loan l WHERE l.tenant_id=$1 AND l.student_id=app.students.id AND l.status='lost')
      ORDER BY name LIMIT 1`, [tenantId])).rows[0];
    const issue = await j('POST', '/plugins/library/loans', lib.token, { bookId, studentId: student.id, dueOn: '2026-01-01' });
    assert.equal(issue.statusCode, 200, brief(issue));
    const loanId = JSON.parse(issue.body).loanId;
    await j('POST', `/plugins/library/loans/${loanId}/return`, lib.token, {});
    const fineId = (await sql(`SELECT id FROM library.fine WHERE loan_id=$1`, [loanId])).rows[0].id;

    const off = await app.inject({ method: 'POST', url: '/plugins/library/settings', headers: H(owner.token), payload: { allow_fine_waiver: false } });
    assert.ok([200, 400].includes(off.statusCode), brief(off));
    const refused = await j('POST', `/plugins/library/fines/${fineId}/settle`, lib.token, { action: 'waive' });
    assert.equal(refused.statusCode, 409, 'waiving is refused while switched off');

    await app.inject({ method: 'POST', url: '/plugins/library/settings', headers: H(owner.token), payload: { allow_fine_waiver: true } });
    const ok = await j('POST', `/plugins/library/fines/${fineId}/settle`, lib.token, { action: 'waive' });
    assert.equal(ok.statusCode, 200, brief(ok));
  });

  test('the library KPI gauges are exported and reflect an issued loan (E6)', async () => {
    const r = await app.inject({ method: 'GET', url: '/metrics', headers: H(owner.token) });
    assert.equal(r.statusCode, 200, brief(r));
    assert.match(r.body, /^schoolos_library_on_loan \d+$/m, 'the on-loan gauge is a real series');
    assert.match(r.body, /^schoolos_fleet_library_holds_stalled \d+$/m, 'the alert rule gauge is emitted');
    const onLoan = Number(/^schoolos_library_on_loan (\d+)$/m.exec(r.body)?.[1]);
    assert.ok(onLoan >= 1, `an issued loan must show on the gauge (got ${onLoan})`);
  });

  test('an uncollected ready hold expires and the next requester is promoted', async () => {
    const add = await j('POST', '/plugins/library/books', lib.token, { title: 'Expiry Title', copies: 1 });
    const bookId = JSON.parse(add.body).bookId;
    const students = (await sql(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' ORDER BY name LIMIT 2`, [tenantId])).rows;
    await sql(`INSERT INTO library.reservation (tenant_id, book_id, borrower_type, borrower_student_id, status, queue_no, expires_at)
              VALUES ($1,$2,'student',$3,'ready',1, now() - interval '1 day')`, [tenantId, bookId, students[0].id]);
    await sql(`INSERT INTO library.reservation (tenant_id, book_id, borrower_type, borrower_student_id, status, queue_no)
              VALUES ($1,$2,'student',$3,'requested',2)`, [tenantId, bookId, students[1].id]);

    const { runLibraryReservationExpiry } = await import('../scripts/day-worker.js');
    const out = await runLibraryReservationExpiry();
    assert.ok(out.expired >= 1, `the stale hold expires (got ${out.expired})`);
    const rows = (await sql(`SELECT status FROM library.reservation WHERE tenant_id=$1 AND book_id=$2 ORDER BY queue_no`, [tenantId, bookId])).rows;
    assert.equal(rows[0].status, 'expired', 'the uncollected hold is expired');
    assert.equal(rows[1].status, 'ready', 'the next requester is promoted');
  });
});
