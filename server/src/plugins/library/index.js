// library — runtime module (migration 047, Wave B unit 2). Class C: the school
// library desk. docs/DATA-FLOW §3.13: "library is NOT IMPLEMENTED (a Library screen
// exists in the demo store only — no library tables)". This unit closes it.
//
// Design invariants:
//   · AVAILABILITY IS DERIVED, NEVER STORED — open loans (status='issued' AND
//     returned_at IS NULL) < copies_total ⇒ issuable. The issue door re-checks under
//     the book's FOR UPDATE lock, so two desks racing the last copy cannot both win
//     (the second gets a plain-language 409 'no copies available'). No denormalized
//     "copies_available" column to desync.
//   · STUDENT MUST BE ACTIVE — soft-deactivated students (§24) cannot borrow.
//   · FINES ARE COMPUTED ONCE, AT RETURN — fine_cents = max(0, days_overdue) ×
//     fine_per_day_cents (plugin settings, default 500 paise = ₹5/day). Never edited
//     afterwards; the returned row IS the fine ledger.
//   · STAFFING PER SCHOOL-OFFICE NORMS — owner/principal/coordinator/facilities.
//     No teacher door (issue/return is an office function, not a classroom one).
//   · STUDENTS SEE ONLY THEIR OWN LOANS — the kernel has role 'student' but no
//     user↔student FK; identity rides the 034/036 name-match pin (student.world
//     ownStudent precedent, teacher.classroom class-gate precedent).
//   · every write emits an event + requestAudit inside the withUser transaction;
//     uniform lifecycle gate on every door (P2-1 posture). All preHandlers async.
import { randomBytes } from 'node:crypto';
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js';

const ID = 'library';

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, q } = kernel;

  const STAFF = ['owner', 'principal', 'coordinator', 'facilities'];
  const STUDENT = ['student'];
  const lifecycleGate = makeLifecycleGate(q, ID);
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

  // plugin settings via the kernel owner path (ops.visitors settings() precedent)
  const settings = async (tenantId) =>
    (await q(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, ID])).rows[0]?.settings ?? {};

  // IDENTITY PIN: student role → own app.students row (034/036 name-match; the kernel
  // has no user↔student FK). Fail-closed: no match ⇒ no data, never a guess.
  const ownStudent = async (c, user) =>
    (await c.query(
      `SELECT id, name, grade, section, admission_no
       FROM app.students
       WHERE tenant_id=$1 AND status='active' AND lower(name)=lower($2)
       ORDER BY created_at LIMIT 1`, [user.tenant_id, user.name])).rows[0] ?? null;

  // Open-loan availability for one book (derived; used by catalog + issue gate).
  const openLoans = async (c, bookId) =>
    (await c.query(
      `SELECT count(*)::int AS n FROM library.loan WHERE book_id=$1 AND status='issued' AND returned_at IS NULL`,
      [bookId])).rows[0].n;

  // ── add a book (staff) — code is optional: absent codes get a server-generated
  // LIB-… spine label so the desk never has to invent one (UNIQUE(tenant,code) holds).
  app.post(`/plugins/${ID}/books`, { preHandler: [require(...STAFF), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    const author = b.author ? String(b.author).trim().slice(0, 200) : null;
    const category = b.category ? String(b.category).trim().slice(0, 60) : null;
    const copies = Number(b.copies_total ?? b.copiesTotal ?? 1);
    const code = (typeof b.code === 'string' && b.code.trim()) ? b.code.trim() : `LIB-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
    if (code.length > 40) return bad(reply, 'That code is too long (max 40 characters)');
    if (!title) return bad(reply, 'Give the book its title');
    if (!Number.isInteger(copies) || copies < 1) return bad(reply, 'Copies must be a whole number of at least 1');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const ins = await c.query(
        `INSERT INTO library.book (tenant_id, code, title, author, category, copies_total, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, code, title, copies_total`,
        [req.user.tenant_id, code.slice(0, 40), title.slice(0, 300), author, category, copies, req.user.id]);
      const book = ins.rows[0];
      await emitEvent(c, req.user.tenant_id,
        { type: 'library', label: `Book added: ${book.title} (${book.code} · ${copies} ${copies === 1 ? 'copy' : 'copies'})`, ref: book.id },
        'library.book.added.v1', { bookId: book.id, code: book.code, title: book.title, copiesTotal: copies });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Book added to catalog', recordType: 'LibraryBook', recordRef: book.id,
        reason: `${book.code} · ${book.title.slice(0, 60)}`, policyRef: 'Library desk norms', risk: 'low',
        outcome: `${copies} copies on the shelf` });
      return { ok: true, bookId: book.id, book };
    });
  });

  // ── catalog (staff) — search by title/author/code (?search= | ?q=) + derived ──
  app.get(`/plugins/${ID}/books`, { preHandler: [require(...STAFF), lifecycleGate] }, async (req, reply) => {
    const raw = typeof req.query?.search === 'string' && req.query.search.trim() ? req.query.search
      : (typeof req.query?.q === 'string' && req.query.q.trim() ? req.query.q : null);
    const search = raw ? raw.trim() : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // P3-5 precedent (ops.visitors): escape ILIKE wildcards — q is a substring, not a pattern
      const esc = search ? search.replace(/([%_\\])/g, '\\$1') : null;
      const rows = (await c.query(
        `SELECT b.id, b.code, b.title, b.author, b.category, b.copies_total, b.status, b.created_at,
           (SELECT count(*)::int FROM library.loan l WHERE l.book_id = b.id AND l.status='issued' AND l.returned_at IS NULL) AS open_loans
         FROM library.book b
         WHERE b.tenant_id=$1 AND ($2::text IS NULL OR b.title ILIKE '%' || $2 || '%' ESCAPE '\\' OR b.author ILIKE '%' || $2 || '%' ESCAPE '\\' OR b.code ILIKE '%' || $2 || '%' ESCAPE '\\')
         ORDER BY b.title LIMIT 300`,
        [req.user.tenant_id, esc])).rows;
      return { books: rows.map((r) => ({
        id: r.id, code: r.code, title: r.title, author: r.author, category: r.category,
        copiesTotal: r.copies_total, copiesOut: r.open_loans, status: r.status,
        openLoans: r.open_loans, available: Math.max(0, r.copies_total - r.open_loans),
        retired: r.status === 'retired', createdAt: r.created_at,
      })) };
    });
  });

  // ── retire a book (staff) — catalog lifecycle: history kept, issues stopped ─
  app.post(`/plugins/${ID}/books/:id/retire`, { preHandler: [require(...STAFF), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const b = (await c.query(`SELECT id, code, title, status FROM library.book WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!b) return bad(reply, 'We couldn\'t find that book', 404);
      if (b.status === 'retired') return bad(reply, 'That book is already retired', 409);
      const open = await openLoans(c, b.id);
      if (open > 0) return bad(reply, `${open} ${open === 1 ? 'copy is' : 'copies are'} still out — bring them back before retiring this title`, 409);
      await c.query(`UPDATE library.book SET status='retired' WHERE id=$1`, [b.id]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'library', label: `Book retired: ${b.title} (${b.code})`, ref: b.id },
        'library.book.retired.v1', { bookId: b.id, code: b.code });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Book retired', recordType: 'LibraryBook', recordRef: b.id,
        reason: `${b.code} · ${b.title.slice(0, 60)}`, policyRef: 'Library desk norms', risk: 'low',
        outcome: 'no future issues · loan history kept' });
      return { ok: true, bookId: b.id, status: 'retired' };
    });
  });

  // ── issue a loan (staff) — availability + active-student gates ─────────────
  app.post(`/plugins/${ID}/loans`, { preHandler: [require(...STAFF), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const bookId = b.bookId ?? b.book_id;
    const studentId = b.studentId ?? b.student_id;
    const dueOn = b.dueOn ?? b.due_on;
    if (!bookId) return bad(reply, 'Which book is being issued? (bookId is missing)');
    if (!studentId) return bad(reply, 'Which student is borrowing it? (studentId is missing)');
    if (!isDate(String(dueOn ?? ''))) return bad(reply, 'Pick the return-by date (dueOn, YYYY-MM-DD)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // lock the book row: two desks racing the last copy resolve serially
      const book = (await c.query(`SELECT id, code, title, copies_total, status FROM library.book WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [bookId, req.user.tenant_id])).rows[0];
      if (!book) return bad(reply, 'We couldn\'t find that book', 404);
      if (book.status !== 'available') return bad(reply, 'That title has been retired — it can\'t be issued', 409);
      const st = (await c.query(`SELECT id, name, grade, section, status FROM app.students WHERE id=$1 AND tenant_id=$2`,
        [studentId, req.user.tenant_id])).rows[0];
      if (!st) return bad(reply, 'We couldn\'t find that student', 404);
      if (st.status !== 'active') return bad(reply, 'Only an active student can borrow from the library', 409);
      if (await openLoans(c, book.id) >= book.copies_total)
        return bad(reply, 'no copies available', 409);
      const loan = (await c.query(
        `INSERT INTO library.loan (tenant_id, book_id, student_id, issued_by, due_on, status)
         VALUES ($1,$2,$3,$4,$5,'issued') RETURNING id, due_on, issued_at`,
        [req.user.tenant_id, book.id, st.id, req.user.id, String(dueOn)])).rows[0];
      await emitEvent(c, req.user.tenant_id,
        { type: 'library', label: `Book issued: ${book.title} (${book.code}) → ${st.name}`, ref: loan.id },
        'library.loan.issued.v1', { loanId: loan.id, bookId: book.id, studentId: st.id, dueOn: loan.due_on });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Book issued', recordType: 'LibraryLoan', recordRef: loan.id,
        reason: `${book.code} · ${book.title.slice(0, 60)} → ${st.name} (${st.grade}-${st.section})`,
        policyRef: 'Library desk norms', risk: 'low', outcome: `due ${loan.due_on}` });
      // flat loan object = the client LibraryLoan shape; ids ride alongside
      return { ok: true, loanId: loan.id, dueOn: loan.due_on, issuedAt: loan.issued_at,
        book: { id: book.id, code: book.code, title: book.title }, student: { id: st.id, name: st.name },
        loan: {
          id: loan.id, bookTitle: book.title, bookCode: book.code, studentName: st.name,
          studentGrade: st.grade, studentSection: st.section, issuedAt: loan.issued_at,
          dueOn: loan.due_on, returnedAt: null, fineCents: 0, status: 'issued',
        } };
    });
  });

  // ── return a loan (staff) — fine computed ONCE, here ───────────────────────
  app.post(`/plugins/${ID}/loans/:id/return`, { preHandler: [require(...STAFF), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const l = (await c.query(
        `SELECT l.id, l.status, l.due_on, l.returned_at, l.fine_cents, l.book_id, l.student_id,
                b.code AS book_code, b.title AS book_title, s.name AS student_name
         FROM library.loan l JOIN library.book b ON b.id = l.book_id JOIN app.students s ON s.id = l.student_id
         WHERE l.id=$1 AND l.tenant_id=$2 FOR UPDATE OF l`,
        [req.params.id, req.user.tenant_id])).rows[0];
      if (!l) return bad(reply, 'We couldn\'t find that loan', 404);
      if (l.status !== 'issued') return bad(reply, `This loan is already ${l.status}`, 409);
      const s = await settings(req.user.tenant_id);
      const perDay = Math.max(0, Number.isFinite(Number(s.fine_per_day_cents)) ? Number(s.fine_per_day_cents) : 500);
      // deterministic: WHOLE DAYS LATE = (return date − due date) on the UTC
      // calendar, floored at zero — an early return is never fined, and the due
      // day itself is never charged. The UTC frame is deliberate: the door's day
      // unit must not depend on the process/session timezone (node-pg parses
      // `date` columns as local midnight; with an IST session a due-3-days-ago
      // loan read as 4 days late whenever the suite ran before 05:30 IST — the
      // fixture frame in tests/wave-b is UTC, and fine must agree with it at any
      // wall-clock hour). Mirrored in /overdue below.
      const daysOverdue = Math.max(0, Number((await c.query(
        `SELECT GREATEST(0, ((now() AT TIME ZONE 'UTC')::date - $1::date))::int AS d`, [l.due_on])).rows[0]?.d ?? 0));
      const fine = daysOverdue * perDay;
      const upd = await c.query(
        `UPDATE library.loan SET status='returned', returned_at=now(), fine_cents=$2 WHERE id=$1 RETURNING returned_at, fine_cents`,
        [l.id, fine]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'library', label: `Book returned: ${l.book_title} (${l.book_code}) ← ${l.student_name}${fine > 0 ? ` · fine ₹${(fine / 100).toFixed(2)}` : ''}`, ref: l.id },
        'library.loan.returned.v1', { loanId: l.id, bookId: l.book_id, studentId: l.student_id, fineCents: fine, daysOverdue });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Book returned', recordType: 'LibraryLoan', recordRef: l.id,
        reason: `${l.book_code} · ${l.book_title.slice(0, 60)} ← ${l.student_name}`,
        policyRef: 'Library desk norms · fine computed at return', risk: 'low',
        outcome: `${daysOverdue} day(s) overdue · fine ₹${(fine / 100).toFixed(2)} (${perDay}/day)` });
      return { ok: true, loanId: l.id, returnedAt: upd.rows[0].returned_at,
        fineCents: upd.rows[0].fine_cents, daysOverdue,
        loan: {
          id: l.id, bookTitle: l.book_title, bookCode: l.book_code, studentName: l.student_name,
          status: 'returned', returnedAt: upd.rows[0].returned_at, fineCents: upd.rows[0].fine_cents,
        } };
    });
  });

  // ── loan list (staff) — state=open|all, optional studentId ─────────────────
  app.get(`/plugins/${ID}/loans`, { preHandler: [require(...STAFF), lifecycleGate] }, async (req, reply) => {
    const state = req.query?.state === 'all' ? 'all' : 'open';
    const studentId = typeof req.query?.studentId === 'string' && req.query.studentId ? req.query.studentId : null;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT l.id, l.status, l.issued_at, l.due_on, l.returned_at, l.fine_cents,
                b.id AS book_id, b.code AS book_code, b.title AS book_title,
                s.id AS student_id, s.name AS student_name, s.grade, s.section
         FROM library.loan l JOIN library.book b ON b.id = l.book_id JOIN app.students s ON s.id = l.student_id
         WHERE l.tenant_id=$1 AND ($2 OR l.status='issued')
           AND ($3::uuid IS NULL OR l.student_id=$3::uuid)
         ORDER BY l.due_on ASC LIMIT 300`,
        [req.user.tenant_id, state === 'all', studentId])).rows;
      return { state, loans: rows.map((r) => ({
        id: r.id, status: r.status, issuedAt: r.issued_at, dueOn: r.due_on,
        returnedAt: r.returned_at, fineCents: r.fine_cents,
        bookTitle: r.book_title, bookCode: r.book_code,
        studentName: r.student_name, studentGrade: r.grade, studentSection: r.section,
        book: { id: r.book_id, code: r.book_code, title: r.book_title },
        student: { id: r.student_id, name: r.student_name, class: `${r.grade}-${r.section}` },
        overdue: r.status === 'issued' && new Date(r.due_on).getTime() < Date.now(),
      })) };
    });
  });

  // ── overdue chase list (staff) ─────────────────────────────────────────────
  app.get(`/plugins/${ID}/overdue`, { preHandler: [require(...STAFF), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT l.id, l.due_on, ((now() AT TIME ZONE 'UTC')::date - l.due_on) AS days_overdue,
                b.code AS book_code, b.title AS book_title,
                s.id AS student_id, s.name AS student_name, s.grade, s.section,
                g.phone AS guardian_phone
         FROM library.loan l JOIN library.book b ON b.id = l.book_id JOIN app.students s ON s.id = l.student_id
         LEFT JOIN app.guardians g ON g.student_id = s.id AND g.is_primary
         WHERE l.tenant_id=$1 AND l.status='issued' AND l.due_on < (now() AT TIME ZONE 'UTC')::date
         ORDER BY l.due_on ASC LIMIT 200`, [req.user.tenant_id])).rows;
      // overdue chase rows flattened to the client Loan shape + nested aliases
      return { loans: rows.map((r) => ({
        id: r.id, dueOn: r.due_on, daysOverdue: Number(r.days_overdue ?? 0),
        bookTitle: r.book_title, bookCode: r.book_code,
        studentName: r.student_name, studentGrade: r.grade, studentSection: r.section,
        guardianPhone: r.guardian_phone ?? null,
        book: { code: r.book_code, title: r.book_title },
        student: { id: r.student_id, name: r.student_name, class: `${r.grade}-${r.section}` },
      })) };
    });
  });

  // ── my loans (STUDENT role) — identity via the name-match pin, fail-closed ──
  app.get(`/plugins/${ID}/loans/mine`, { preHandler: [require(...STUDENT), lifecycleGate] }, async (req, reply) => {
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const me = await ownStudent(c, req.user);
      if (!me) return { loans: [], student: null, note: 'Your library card isn\'t linked yet — ask at the school office.' };
      const rows = (await c.query(
        `SELECT l.id, l.status, l.issued_at, l.due_on, l.returned_at, l.fine_cents,
                b.code AS book_code, b.title AS book_title, b.author AS book_author
         FROM library.loan l JOIN library.book b ON b.id = l.book_id
         WHERE l.student_id=$1
         ORDER BY (l.status='issued') DESC, l.due_on ASC LIMIT 100`, [me.id])).rows;
      return { student: { id: me.id, name: me.name, class: `${me.grade}-${me.section}` },
        loans: rows.map((r) => ({
          id: r.id, status: r.status, issuedAt: r.issued_at, dueOn: r.due_on,
          returnedAt: r.returned_at, fineCents: r.fine_cents,
          bookTitle: r.book_title, bookCode: r.book_code, bookAuthor: r.book_author,
          book: { code: r.book_code, title: r.book_title, author: r.book_author },
          overdue: r.status === 'issued' && new Date(r.due_on).getTime() < Date.now(),
        })) };
    });
  });
}
