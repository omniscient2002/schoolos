// library v2 — the school library management system (docs/LIBRARY-DESIGN.md).
//
// Access model (server-enforced, not just UI):
//   · DESK     = librarian            — catalog, copies, issue, return, renew, holds, fines, acquisitions, settings
//   · BORROWER = every non-parent role — catalog search, reserve, my loans, my fines, request/suggest a book
//   · OPS      = librarian|owner|principal — aggregate-only operations dashboard (no borrower identity)
//
// INVARIANTS
//   · availability is DERIVED from library.copy status, never stored.
//   · one open loan per physical copy (partial unique index); copy row locked on issue/return.
//   · exactly one borrower identity per loan/reservation (student XOR staff user).
//   · holds are FIFO per title; a freed copy advances the oldest hold to `ready`.
//   · fines are computed ONCE at return (whole UTC days late × per-day, capped); damage/loss are separate rows.
//   · every write emits an event + one audit row inside the withUser transaction.
//   · a plugin never hard-deletes (D-35); retire/withdraw are status updates.
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { uuidParams } from '../_shared/uuid-param.js';
import { storageBase } from '../../file-artifacts.js';

const ID = 'library';
const DESK = ['librarian'];
const OPS = ['librarian', 'owner', 'principal'];
const BORROWER = ['owner', 'principal', 'coordinator', 'counselor', 'finance', 'admissions',
  'transport', 'facilities', 'technician', 'teacher', 'itadmin', 'student', 'librarian'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The keys a LIBRARIAN may edit on the desk (design §C3): operational loan policy, fines, holds and every
// notification setting. The identifier/catalog scheme (identifier_scheme, prefix, accession_*, scan_accepts,
// barcode_symbology, custom_identifier_label) stays owner/principal — it is the school's catalog standard.
const DESK_SETTINGS = {
  default_loan_days: { t: 'int', min: 1, max: 365 },
  loan_days_student: { t: 'int', min: 1, max: 365 },
  loan_days_teacher: { t: 'int', min: 1, max: 365 },
  loan_days_staff: { t: 'int', min: 1, max: 365 },
  max_loans_student: { t: 'int', min: 0, max: 50 },
  max_loans_teacher: { t: 'int', min: 0, max: 50 },
  max_loans_staff: { t: 'int', min: 0, max: 50 },
  renewal_limit: { t: 'int', min: 0, max: 10 },
  renewal_days: { t: 'int', min: 1, max: 90 },
  allow_self_reserve: { t: 'bool' },
  max_reservations: { t: 'int', min: 0, max: 20 },
  reservation_hold_days: { t: 'int', min: 1, max: 30 },
  allow_acquisition_requests: { t: 'bool' },
  acquisition_votes: { t: 'bool' },
  max_open_acquisition_requests: { t: 'int', min: 0, max: 50 },
  grace_days: { t: 'int', min: 0, max: 60 },
  fine_per_day_cents: { t: 'int', min: 0, max: 100000 },
  fine_cap_cents: { t: 'int', min: 0, max: 10000000 },
  lost_charge_percent: { t: 'int', min: 0, max: 500 },
  damage_charge_cents: { t: 'int', min: 0, max: 10000000 },
  allow_fine_waiver: { t: 'bool' },
  notify_channels: { t: 'channels' },
  notify_parent: { t: 'bool' },
  due_reminder_days_before: { t: 'intArray', min: 0, max: 90 },
  overdue_repeat_days: { t: 'int', min: 1, max: 90 },
  quiet_hours_ist: { t: 'hours' },
};
const DESK_KEYS = new Set(Object.keys(DESK_SETTINGS));
const IDENTIFIER_KEYS = new Set(['identifier_scheme', 'identifier_prefix', 'accession_start', 'accession_padding',
  'custom_identifier_label', 'barcode_symbology', 'scan_accepts']);
const CHANNELS = ['in_app', 'sms', 'whatsapp', 'email'];
// Returns an honest error string for the first bad key, or null when the payload is valid.
const validateDeskSettings = (b) => {
  for (const [k, v] of Object.entries(b)) {
    const spec = DESK_SETTINGS[k];
    if (!spec) continue;
    if (spec.t === 'int') {
      if (!Number.isInteger(v) || v < spec.min || v > spec.max) return `${k} must be a whole number between ${spec.min} and ${spec.max}`;
    } else if (spec.t === 'bool') {
      if (typeof v !== 'boolean') return `${k} must be true or false`;
    } else if (spec.t === 'intArray') {
      if (!Array.isArray(v) || v.some((x) => !Number.isInteger(x) || x < spec.min || x > spec.max)) return `${k} must be a list of day counts (${spec.min}–${spec.max})`;
    } else if (spec.t === 'channels') {
      if (!Array.isArray(v) || v.some((x) => !CHANNELS.includes(x))) return `${k} must be a list drawn from ${CHANNELS.join(', ')}`;
    } else if (spec.t === 'hours') {
      if (!Array.isArray(v) || v.length !== 2 || v.some((h) => !Number.isInteger(h) || h < 0 || h > 23)) return `${k} must be [startHour, endHour] (0–23)`;
    }
  }
  return null;
};
// LMS-14: the platform pagination envelope (routes.js pageParams), local so the plugin owns its list
// contract. An oversized limit is clamped; a bad limit/offset falls back to the default.
const pageParams = (query = {}, { defaultLimit = 100, maxLimit = 500 } = {}) => {
  const rawLimit = query.limit == null || query.limit === '' ? defaultLimit : Number(query.limit);
  const rawOffset = query.offset == null || query.offset === '' ? 0 : Number(query.offset);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit;
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  return { limit, offset };
};
const ISBN_RE = /^[0-9Xx-]{10,17}$/;
// LMS-15: proper ISBN-10/13 checksum, not just a shape. Returns true only for a valid check digit.
const isbnValid = (v, len) => {
  const s = String(v ?? '').replace(/[^0-9Xx]/g, '');
  if (len === 13) {
    if (!/^\d{13}$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += (i % 2 ? 3 : 1) * Number(s[i]);
    return (10 - (sum % 10)) % 10 === Number(s[12]);
  }
  if (!/^\d{9}[\dXx]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(s[i]);
  sum += s[9].toUpperCase() === 'X' ? 10 : Number(s[9]);
  return sum % 11 === 0;
};

/* Shared input contract for the single add and the bulk catalog import. Returns either { error } or
   the normalised { title, copies, manualCode }. `seenCodes`, when given, is the caller's lowercased
   set of references already used in the batch — the bulk door's in-batch duplicate guard. */
const validateBookInput = (b, seenCodes = null) => {
  const title = typeof b?.title === 'string' ? b.title.trim() : '';
  if (!title) return { error: 'Give the book its title' };
  const copies = Number(b.copies ?? b.copies_total ?? b.copiesTotal ?? 1);
  if (!Number.isInteger(copies) || copies < 0 || copies > 1000) return { error: 'Copies must be a whole number between 0 and 1000' };
  if (b.isbn13 && !isbnValid(b.isbn13, 13)) return { error: 'That ISBN-13 check digit doesn\'t match' };
  if (b.isbn10 && !isbnValid(b.isbn10, 10)) return { error: 'That ISBN-10 check digit doesn\'t match' };
  const manualCode = typeof b.code === 'string' && b.code.trim() ? b.code.trim().slice(0, 40) : null;
  if (manualCode && seenCodes) {
    const key = manualCode.toLowerCase();
    if (seenCodes.has(key)) return { error: `Duplicate catalogue reference "${manualCode}" within this import` };
    seenCodes.add(key);
  }
  return { title, copies, manualCode };
};

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, sysq } = kernel;
  const lifecycleGate = makeLifecycleGate(sysq, ID);
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  // ── settings + policy (read on the owner path; validated by the settings contract at the door) ──
  const settings = async (tenantId) =>
    (await sysq(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [tenantId, ID])).rows[0]?.settings ?? {};
  const policy = (s, type) => {
    const byType = (k) => (s[k] && typeof s[k] === 'object' ? Number(s[k][type]) : NaN);
    const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    return {
      days: num(s[`loan_days_${type}`], num(byType('default_loan_days_by_type'), num(s.default_loan_days, 14))),
      max: num(s[`max_loans_${type}`], num(byType('max_open_loans_by_type'), 3)),
      renewalLimit: num(s.renewal_limit, 1),
      renewalDays: num(s.renewal_days, 7),
      holdDays: num(s.reservation_hold_days, 2),
      grace: num(s.grace_days, 0),
      perDay: num(s.fine_per_day_cents, 500),
      cap: num(s.fine_cap_cents, 20000),
      allowReserve: s.allow_self_reserve !== false,
      allowAcq: s.allow_acquisition_requests !== false,
      acqVotes: s.acquisition_votes !== false,
      maxAcq: num(s.max_open_acquisition_requests, 5),
      maxReservations: num(s.max_reservations, 3),
    };
  };

  // ── identity helpers ───────────────────────────────────────────────────────────
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const normKey = (title, author) => `${String(title ?? '').trim().toLowerCase()}|${String(author ?? '').trim().toLowerCase()}`;

  // The signed-in borrower. Students resolve via the stable student_accounts link first and fall back to the
  // 034/036 name-match pin; staff are their own user id. Fail-closed: an unlinked student gets no loans.
  const selfBorrower = async (c, user) => {
    if (user.role === 'student') {
      const linked = (await c.query(`SELECT student_id FROM app.student_accounts WHERE tenant_id=$1 AND user_id=$2 LIMIT 1`,
        [user.tenant_id, user.id])).rows[0]?.student_id;
      let sid = linked;
      if (!sid) {
        sid = (await c.query(`SELECT id FROM app.students WHERE tenant_id=$1 AND status='active' AND lower(name)=lower($2) ORDER BY created_at LIMIT 1`,
          [user.tenant_id, user.name])).rows[0]?.id;
      }
      if (!sid) return null;
      const st = (await c.query(`SELECT id, name FROM app.students WHERE id=$1 AND tenant_id=$2`, [sid, user.tenant_id])).rows[0];
      return st ? { type: 'student', studentId: st.id, userId: null, name: st.name } : null;
    }
    return { type: 'staff', studentId: null, userId: user.id, name: user.name };
  };

  // A librarian issuing/acting on behalf of a borrower named in the request.
  const borrowerFromBody = async (c, tenantId, body) => {
    const studentId = body.studentId ?? body.student_id ?? null;
    const userId = body.userId ?? body.user_id ?? null;
    if (studentId && userId) return { error: 'Name either a student or a staff member, not both' };
    if (studentId) {
      if (!UUID.test(String(studentId))) return { error: 'studentId must be a uuid' };
      const st = (await c.query(`SELECT id, name, status FROM app.students WHERE id=$1 AND tenant_id=$2`, [studentId, tenantId])).rows[0];
      if (!st) return { error: 'We couldn\'t find that student', code: 404 };
      if (st.status !== 'active') return { error: 'Only an active student can borrow from the library', code: 409 };
      return { borrower: { type: 'student', studentId: st.id, userId: null, name: st.name } };
    }
    if (userId) {
      if (!UUID.test(String(userId))) return { error: 'userId must be a uuid' };
      const u = (await c.query(`SELECT id, name, role, active FROM app.users WHERE id=$1 AND tenant_id=$2`, [userId, tenantId])).rows[0];
      if (!u) return { error: 'We couldn\'t find that account', code: 404 };
      if (!u.active) return { error: 'That account is not active', code: 409 };
      return { borrower: { type: 'staff', studentId: null, userId: u.id, name: u.name } };
    }
    return { error: 'Say who is borrowing it (studentId or userId)' };
  };

  // ── notification helpers (in-app rows; outbound rails ride the day-worker sweep) ──
  const notifyUsers = async (c, tenantId, userIds, { group = 'library', title, body, ref }) => {
    const ids = [...new Set((userIds ?? []).filter(Boolean))];
    for (const uid of ids) {
      await c.query(`INSERT INTO app.notifications (tenant_id, user_id, "group", title, body, ref) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, uid, group, title, body, ref ?? null]);
    }
  };
  const notifyBorrower = async (c, tenantId, borrower, msg) => {
    const ids = [];
    if (borrower.type === 'staff') ids.push(borrower.userId);
    else {
      const su = (await c.query(`SELECT user_id FROM app.student_accounts WHERE tenant_id=$1 AND student_id=$2 LIMIT 1`, [tenantId, borrower.studentId])).rows[0]?.user_id;
      if (su) ids.push(su);
      const parents = (await c.query(`SELECT user_id FROM family.child_link WHERE tenant_id=$1 AND student_id=$2`, [tenantId, borrower.studentId])).rows;
      for (const p of parents) ids.push(p.user_id);
    }
    await notifyUsers(c, tenantId, ids, msg);
  };

  // ── borrower write throttle (LIB-E2) ─────────────────────────────────────────────
  // One row per (tenant, actor, kind); a fixed-length window. The check runs BEFORE the write so a
  // throttled request never reaches the queue, and the upsert commits with the door's transaction.
  const THROTTLE = { reserve: { max: 10, seconds: 60 }, suggest: { max: 5, seconds: 60 }, vote: { max: 20, seconds: 60 } };
  const throttleOk = async (c, tenantId, actorId, kind) => {
    const cfg = THROTTLE[kind];
    if (!cfg) return true;
    const r = await c.query(
      `INSERT INTO library.request_throttles (tenant_id, actor_id, kind, attempts, window_started_at, last_attempt_at)
       VALUES ($1,$2,$3,1,now(),now())
       ON CONFLICT (tenant_id, actor_id, kind) DO UPDATE SET
         attempts = CASE WHEN library.request_throttles.window_started_at < now() - ($4 || ' seconds')::interval
                         THEN 1 ELSE library.request_throttles.attempts + 1 END,
         window_started_at = CASE WHEN library.request_throttles.window_started_at < now() - ($4 || ' seconds')::interval
                         THEN now() ELSE library.request_throttles.window_started_at END,
         last_attempt_at = now()
       RETURNING attempts`, [tenantId, actorId, kind, String(cfg.seconds)]);
    return Number(r.rows[0].attempts) <= cfg.max;
  };

  // ── copy + availability helpers ─────────────────────────────────────────────────
  const copyCounts = async (c, tenantId, bookId) => (await c.query(
    `SELECT
       count(*) FILTER (WHERE status='available')::int AS available,
       count(*) FILTER (WHERE status='issued')::int    AS issued,
       count(*) FILTER (WHERE status IN ('lost','damaged','withdrawn'))::int AS unavailable,
       count(*)::int AS total
     FROM library.copy WHERE tenant_id=$1 AND book_id=$2`, [tenantId, bookId])).rows[0];

  const openLoanCount = async (c, tenantId, borrower) => (await c.query(
    `SELECT count(*)::int AS n FROM library.loan
     WHERE tenant_id=$1 AND status='issued' AND (
       ($2::uuid IS NOT NULL AND student_id=$2::uuid) OR
       ($3::uuid IS NOT NULL AND borrower_user_id=$3::uuid))`,
    [tenantId, borrower.studentId, borrower.userId])).rows[0].n;

  const hasLostOutstanding = async (c, tenantId, borrower) => (await c.query(
    `SELECT 1 FROM library.loan
     WHERE tenant_id=$1 AND status='lost' AND (
       ($2::uuid IS NOT NULL AND student_id=$2::uuid) OR
       ($3::uuid IS NOT NULL AND borrower_user_id=$3::uuid)) LIMIT 1`,
    [tenantId, borrower.studentId, borrower.userId])).rows.length > 0;

  const fineFor = async (c, tenantId, loan) => {
    const s = policy(await settings(tenantId), loan.borrower_type);
    const d = Number((await c.query(`SELECT GREATEST(0, (('now'::timestamptz AT TIME ZONE 'UTC')::date - $1::date) - $2::int)::int AS d`, [loan.due_on, s.grace])).rows[0]?.d ?? 0);
    return { daysOverdue: d, fineCents: Math.min(s.cap, d * s.perDay), perDay: s.perDay };
  };

  // Oldest queued hold for a title becomes `ready` when a copy is free; called after a return or a copy add.
  const advanceQueue = async (c, tenantId, bookId) => {
    const s = policy(await settings(tenantId), 'student');
    const free = (await copyCounts(c, tenantId, bookId)).available;
    if (free <= 0) return null;
    const hold = (await c.query(
      `SELECT id, borrower_type, borrower_student_id, borrower_user_id FROM library.reservation
       WHERE tenant_id=$1 AND book_id=$2 AND status='requested'
       ORDER BY queue_no ASC NULLS LAST, requested_at ASC LIMIT 1 FOR UPDATE`, [tenantId, bookId])).rows[0];
    if (!hold) return null;
    const expiry = new Date(Date.now() + s.holdDays * 86400000).toISOString();
    await c.query(`UPDATE library.reservation SET status='ready', ready_at=now(), expires_at=$2 WHERE id=$1`, [hold.id, expiry]);
    await notifyBorrower(c, tenantId,
      { type: hold.borrower_type, studentId: hold.borrower_student_id, userId: hold.borrower_user_id },
      { title: 'Your library book is ready', body: `A copy is waiting at the library — collect it within ${s.holdDays} day(s).`, ref: hold.id, group: 'library' });
    await emitEvent(c, tenantId, { type: 'library', label: 'Library hold ready', ref: hold.id },
      'library.reservation.ready.v1', { reservationId: hold.id, bookId });
    return hold.id;
  };

  // ═══════════════════════════════ DESK (librarian) ═══════════════════════════════

  app.get(`/plugins/${ID}/desk/overview`, { preHandler: [require(...DESK), lifecycleGate] }, async (req) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const [loans, overdue, holds, copies, acq, fines, today, members, recent, demand] = await Promise.all([
        c.query(`SELECT count(*)::int n FROM library.loan WHERE tenant_id=$1 AND status='issued'`, [t]),
        c.query(`SELECT count(*)::int n FROM library.loan WHERE tenant_id=$1 AND status='issued' AND due_on < ('now'::timestamptz AT TIME ZONE 'UTC')::date`, [t]),
        c.query(`SELECT count(*) FILTER (WHERE status='ready')::int ready, count(*) FILTER (WHERE status='requested')::int waiting FROM library.reservation WHERE tenant_id=$1`, [t]),
        c.query(`SELECT count(*) FILTER (WHERE status='available')::int a, count(*)::int total,
                        count(*) FILTER (WHERE status IN ('lost','damaged','withdrawn'))::int unavailable FROM library.copy WHERE tenant_id=$1`, [t]),
        c.query(`SELECT count(*)::int n FROM library.acquisition_request WHERE tenant_id=$1 AND status='requested'`, [t]),
        c.query(`SELECT count(*) FILTER (WHERE status='outstanding')::int n,
                        COALESCE(sum(amount_cents) FILTER (WHERE status='outstanding'),0)::int outstanding,
                        COALESCE(sum(amount_cents) FILTER (WHERE status='paid'),0)::int collected,
                        COALESCE(sum(amount_cents) FILTER (WHERE status='waived'),0)::int waived FROM library.fine WHERE tenant_id=$1`, [t]),
        c.query(`SELECT
                    (SELECT count(*)::int FROM library.loan WHERE tenant_id=$1 AND issued_at::date = ('now'::timestamptz AT TIME ZONE 'UTC')::date) AS issued_today,
                    (SELECT count(*)::int FROM library.loan WHERE tenant_id=$1 AND returned_at::date = ('now'::timestamptz AT TIME ZONE 'UTC')::date) AS returned_today`, [t]),
        c.query(`SELECT
                    (SELECT count(*)::int FROM app.students WHERE tenant_id=$1 AND status='active') AS students,
                    (SELECT count(*)::int FROM app.users WHERE tenant_id=$1 AND active AND role <> 'parent') AS staff`, [t]),
        c.query(`SELECT l.id, l.status, l.due_on, l.issued_at, l.returned_at, l.fine_cents, l.borrower_type,
                        b.title AS book_title, b.code AS book_code, COALESCE(s.name, u.name) AS borrower
                   FROM library.loan l JOIN library.book b ON b.id=l.book_id
                   LEFT JOIN app.students s ON s.id=l.student_id LEFT JOIN app.users u ON u.id=l.borrower_user_id
                  WHERE l.tenant_id=$1 ORDER BY GREATEST(l.issued_at, COALESCE(l.returned_at, l.issued_at)) DESC LIMIT 8`, [t]),
        c.query(`SELECT count(*) FILTER (WHERE status='requested')::int open_requests,
                        COALESCE(sum(vote_count) FILTER (WHERE status IN ('requested','approved','ordered')),0)::int votes
                   FROM library.acquisition_request WHERE tenant_id=$1`, [t]),
      ]);
      return {
        onLoan: loans.rows[0].n, overdue: overdue.rows[0].n,
        holdsReady: holds.rows[0].ready, holdsWaiting: holds.rows[0].waiting,
        available: copies.rows[0].a, copies: copies.rows[0].total, unavailable: copies.rows[0].unavailable,
        purchaseRequests: acq.rows[0].n, acquisitionVotes: demand.rows[0].votes,
        outstandingFines: fines.rows[0].n, outstandingCents: fines.rows[0].outstanding,
        collectedCents: fines.rows[0].collected, waivedCents: fines.rows[0].waived,
        issuedToday: today.rows[0].issued_today, returnedToday: today.rows[0].returned_today,
        members: members.rows[0], recent: recent.rows,
      };
    }));

  // Add a title — creates `copies` physical copy rows using the tenant's identifier scheme.
  app.post(`/plugins/${ID}/books`, { preHandler: [require(...DESK), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    // The librarian may assign the catalogue reference (an accession/register number); otherwise one is
    // generated. It is the stable id the desk reads and writes on the book.
    const v = validateBookInput(b);
    if (v.error) return bad(reply, v.error);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const s = await settings(t);
      if (v.manualCode) {
        const clash = (await c.query(`SELECT 1 FROM library.book WHERE tenant_id=$1 AND lower(code)=lower($2)`, [t, v.manualCode])).rows[0];
        if (clash) return bad(reply, `The catalogue already uses the reference "${v.manualCode}" — pick another`, 409);
      }
      const book = await insertBookRow(c, t, b, v, s, req.user.id);
      await emitEvent(c, t, { type: 'library', label: `Book added: ${book.title} (${book.code})`, ref: book.id },
        'library.book.added.v1', { bookId: book.id, code: book.code, copies: v.copies });
      await requestAudit(c, t, ID, { actor: req.user.name, action: 'Book added to catalog', recordType: 'LibraryBook',
        recordRef: book.id, reason: `${book.code} · ${book.title.slice(0, 60)}`, policyRef: 'Library desk norms',
        risk: 'low', outcome: `${v.copies} copies on the shelf` });
      return { ok: true, bookId: book.id, book: { id: book.id, code: book.code, title: book.title, copies: v.copies } };
    });
  });

  /* D5/E1: BULK catalog import — the operator path for loading a whole catalogue. A per-title emit
     tripped the plugin event budget on a large import (the same wall B2 fixed for timetable slots), so
     this validates the whole batch, writes it in ONE transaction, and emits a SINGLE summary
     `library.catalog.imported.v1` event — all-or-nothing, like the timetable bulk load. */
  app.post(`/plugins/${ID}/books/bulk`, { preHandler: [require(...DESK), lifecycleGate] }, async (req, reply) => {
    const list = Array.isArray(req.body?.books) ? req.body.books : null;
    if (!list || !list.length) return bad(reply, 'books[] is required (an array of title rows)');
    if (list.length > 500) return reply.code(413).send({ error: 'A bulk catalog load is limited to 500 titles per call — split the import.' });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const s = await settings(t);
      const seenCodes = new Set();
      const errors = [];
      const prepared = [];
      for (let i = 0; i < list.length; i++) {
        const v = validateBookInput(list[i] ?? {}, seenCodes);
        if (v.error) { errors.push({ row: i, error: v.error }); continue; }
        prepared.push({ i, b: list[i] ?? {}, v });
      }
      // A reference already in the catalogue is rejected too — same rule as the single add door.
      for (const p of prepared) {
        if (!p.v.manualCode) continue;
        const clash = (await c.query(`SELECT 1 FROM library.book WHERE tenant_id=$1 AND lower(code)=lower($2)`, [t, p.v.manualCode])).rows[0];
        if (clash) errors.push({ row: p.i, error: `The catalogue already uses the reference "${p.v.manualCode}"` });
      }
      if (errors.length) return reply.code(409).send({ error: `${errors.length} row(s) could not be imported — nothing was written.`, errors: errors.slice(0, 50) });
      let inserted = 0;
      let copies = 0;
      for (const p of prepared) {
        await insertBookRow(c, t, p.b, p.v, s, req.user.id);
        inserted += 1;
        copies += p.v.copies;
      }
      // ONE summary event for the whole import — the fix for the event-budget wall.
      await emitEvent(c, t, { type: 'library', label: `Catalog imported — ${inserted} titles` },
        'library.catalog.imported.v1', { titles: inserted, copies });
      await requestAudit(c, t, ID, { actor: req.user.name, action: 'Catalog bulk-imported', recordType: 'Plugin',
        recordRef: t, reason: `bulk catalog load · ${inserted} titles`, policyRef: 'Library desk norms', risk: 'low',
        outcome: `${inserted} titles · ${copies} copies · 1 summary event (budget-safe)` });
      return { ok: true, inserted, copies };
    });
  });

  // Generate the next copy code for the tenant's scheme.
  const makeCopy = async (c, tenantId, bookId, s) => {
    // LMS-6: the next copy code is derived from the tenant's max sequence, so two concurrent adds would
    // compute the same code and collide on UNIQUE(tenant_id, copy_code). A transaction-scoped advisory lock
    // keyed on the tenant serialises copy creation for the duration of the transaction (released on commit).
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`library-copy:${tenantId}`]);
    const scheme = String(s.identifier_scheme ?? 'accession');
    const prefix = String(s.identifier_prefix ?? 'LIB');
    const pad = Math.max(1, Number(s.accession_padding) || 5);
    const start = Number(s.accession_start) || 1;
    const isBarcode = scheme === 'barcode' || scheme === 'qr';
    const isAccession = scheme === 'accession';
    // The next code is computed INSIDE the INSERT so a multi-copy add within one transaction cannot
    // compute the same sequence twice (the aggregate sees the rows this transaction already inserted).
    const r = await c.query(
      `WITH next AS (
         SELECT $3 || '-' || lpad((COALESCE(max(substring(copy_code from '[0-9]+$')::int), $4 - 1) + 1)::text, $5, '0') AS code
           FROM library.copy WHERE tenant_id=$1 AND copy_code LIKE $3 || '-%')
       INSERT INTO library.copy (tenant_id, book_id, copy_code, barcode, accession_no, status)
       SELECT $1, $2, next.code, CASE WHEN $6 THEN next.code END, CASE WHEN $7 THEN next.code END, 'available'
         FROM next RETURNING id, copy_code`,
      [tenantId, bookId, prefix, start, pad, isBarcode, isAccession]);
    return r.rows[0];
  };

  /* One title INSERT shared by the single add and the bulk catalog import, so the column list and the
     copy-creation loop can never drift between the two doors. `s` is the tenant settings snapshot. */
  const insertBookRow = async (c, t, b, v, s, userId) => {
    const ins = await c.query(
      `INSERT INTO library.book (tenant_id, code, copies_total, title, subtitle, author, publisher, edition, pub_year, language,
          isbn10, isbn13, subject, category, dewey_code, description, shelf_location, price_cents, acquired_on,
          vendor, bill_ref, book_type, created_by)
       VALUES ($1,$2,$23,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING id, code, title`,
      [t, v.manualCode ?? `LIB-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`,
        v.title.slice(0, 300), b.subtitle ?? null, b.author ?? null, b.publisher ?? null, b.edition ?? null,
        Number.isInteger(Number(b.pubYear ?? b.pub_year)) ? Number(b.pubYear ?? b.pub_year) : null, b.language ?? null,
        b.isbn10 ?? null, b.isbn13 ?? null, b.subject ?? null, b.category ?? null, b.deweyCode ?? b.dewey_code ?? null,
        b.description ?? null, b.shelfLocation ?? b.shelf_location ?? null,
        Number.isFinite(Number(b.priceCents ?? b.price_cents)) ? Number(b.priceCents ?? b.price_cents) : null,
        isDate(b.acquiredOn ?? b.acquired_on) ? (b.acquiredOn ?? b.acquired_on) : null,
        b.vendor ?? null, b.billRef ?? b.bill_ref ?? null,
        ['book', 'reference', 'magazine', 'journal', 'other'].includes(b.bookType ?? b.book_type) ? (b.bookType ?? b.book_type) : 'book',
        userId, v.copies]);
    const book = ins.rows[0];
    for (let i = 0; i < v.copies; i++) await makeCopy(c, t, book.id, s);
    return book;
  };

  app.patch(`/plugins/${ID}/books/:id`, { preHandler: [require(...DESK), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = { ...(req.body ?? {}) };
    if (b.coverFileId !== undefined && b.cover_file_id === undefined) b.cover_file_id = b.coverFileId;
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      // LMS-23: a cover is an uploaded file (files.store) referenced by id; it must exist in THIS tenant.
      if ('cover_file_id' in b && b.cover_file_id !== null) {
        if (!UUID.test(String(b.cover_file_id))) return bad(reply, 'cover_file_id must be the id of an uploaded file');
        const f = (await c.query(`SELECT id FROM app.files WHERE id=$1 AND tenant_id=$2`, [b.cover_file_id, t])).rows[0];
        if (!f) return bad(reply, 'We couldn\'t find that uploaded cover image', 404);
      }
      const fields = {
        title: 'title', subtitle: 'subtitle', author: 'author', publisher: 'publisher', edition: 'edition',
        pub_year: 'pub_year', language: 'language', isbn10: 'isbn10', isbn13: 'isbn13', subject: 'subject',
        category: 'category', dewey_code: 'dewey_code', description: 'description', shelf_location: 'shelf_location',
        price_cents: 'price_cents', vendor: 'vendor', bill_ref: 'bill_ref', cover_file_id: 'cover_file_id',
      };
      const sets = []; const vals = [req.params.id, t];
      for (const [k, col] of Object.entries(fields)) {
        if (k in b) { vals.push(b[k]); sets.push(`${col} = $${vals.length}`); }
      }
      if (!sets.length) return bad(reply, 'Nothing to change');
      const r = await c.query(`UPDATE library.book SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING id, title`, vals);
      if (!r.rows[0]) return bad(reply, 'We couldn\'t find that book', 404);
      await emitEvent(c, t, { type: 'library', label: `Book updated: ${r.rows[0].title}`, ref: r.rows[0].id }, 'library.book.updated.v1', { bookId: r.rows[0].id });
      await requestAudit(c, t, ID, { actor: req.user.name, action: 'Book updated', recordType: 'LibraryBook', recordRef: r.rows[0].id,
        reason: Object.keys(b).join(', ').slice(0, 120), policyRef: 'Library desk norms', risk: 'low', outcome: 'metadata edited' });
      return { ok: true, bookId: r.rows[0].id };
    });
  });

  app.post(`/plugins/${ID}/books/:id/retire`, { preHandler: [require(...DESK), uuidParams('id'), lifecycleGate] }, async (req, reply) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const b = (await c.query(`SELECT id, code, title, status FROM library.book WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [req.params.id, t])).rows[0];
      if (!b) return bad(reply, 'We couldn\'t find that book', 404);
      if (b.status === 'retired') return bad(reply, 'That book is already retired', 409);
      const issued = (await c.query(`SELECT count(*)::int n FROM library.copy WHERE tenant_id=$1 AND book_id=$2 AND status='issued'`, [t, b.id])).rows[0].n;
      if (issued > 0) return bad(reply, `${issued} ${issued === 1 ? 'copy is' : 'copies are'} still out — bring them back before retiring this title`, 409);
      await c.query(`UPDATE library.book SET status='retired', updated_at=now() WHERE id=$1`, [b.id]);
      await c.query(`UPDATE library.copy SET status='withdrawn' WHERE tenant_id=$1 AND book_id=$2 AND status='available'`, [t, b.id]);
      await emitEvent(c, t, { type: 'library', label: `Book retired: ${b.title} (${b.code})`, ref: b.id }, 'library.book.retired.v1', { bookId: b.id, code: b.code });
      await requestAudit(c, t, ID, { actor: req.user.name, action: 'Book retired', recordType: 'LibraryBook', recordRef: b.id,
        reason: `${b.code} · ${b.title.slice(0, 60)}`, policyRef: 'Library desk norms', risk: 'low', outcome: 'no future issues · history kept' });
      return { ok: true, bookId: b.id, status: 'retired' };
    }));

  app.post(`/plugins/${ID}/books/:id/copies`, { preHandler: [require(...DESK), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const n = Number(req.body?.copies ?? 1);
    if (!Number.isInteger(n) || n < 1 || n > 1000) return bad(reply, 'Copies must be a whole number between 1 and 1000');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const b = (await c.query(`SELECT id, title, status FROM library.book WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [req.params.id, t])).rows[0];
      if (!b) return bad(reply, 'We couldn\'t find that book', 404);
      if (b.status === 'retired') return bad(reply, 'That title is retired', 409);
      const s = await settings(t);
      const codes = [];
      for (let i = 0; i < n; i++) codes.push((await makeCopy(c, t, b.id, s)).copy_code);
      await advanceQueue(c, t, b.id);
      await emitEvent(c, t, { type: 'library', label: `Copies added: ${b.title} (+${n})`, ref: b.id }, 'library.copy.added.v1', { bookId: b.id, copies: n });
      await requestAudit(c, t, ID, { actor: req.user.name, action: 'Copies added', recordType: 'LibraryBook', recordRef: b.id,
        reason: `${b.title.slice(0, 60)}`, policyRef: 'Library desk norms', risk: 'low', outcome: `+${n} copies · ${codes.length} codes` });
      return { ok: true, bookId: b.id, added: n, codes };
    });
  });

  // Listing/search. `desk=1` includes retired titles; borrower catalog shows only active.
  const listBooks = (desk) => async (req, reply) => {
    const raw = typeof req.query?.search === 'string' && req.query.search.trim() ? req.query.search
      : (typeof req.query?.q === 'string' && req.query.q.trim() ? req.query.q : null);
    const search = raw ? raw.trim() : null;
    const esc = search ? search.replace(/([%_\\])/g, '\\$1') : null;
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 300 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT b.id, b.code, b.title, b.subtitle, b.author, b.publisher, b.edition, b.pub_year, b.isbn13,
                b.category, b.subject, b.language, b.shelf_location, b.book_type, b.status, b.price_cents, b.cover_file_id,
                count(k.id) FILTER (WHERE k.status='available')::int AS available,
                count(k.id) FILTER (WHERE k.status='issued')::int AS issued,
                count(k.id)::int AS total
           FROM library.book b LEFT JOIN library.copy k ON k.book_id = b.id AND k.tenant_id = b.tenant_id
          WHERE b.tenant_id=$1 ${desk ? '' : "AND b.status <> 'retired'"}
            AND ($2::text IS NULL OR b.title ILIKE '%'||$2||'%' ESCAPE '\\' OR b.author ILIKE '%'||$2||'%' ESCAPE '\\'
                 OR b.code ILIKE '%'||$2||'%' ESCAPE '\\' OR b.isbn13 ILIKE '%'||$2||'%' ESCAPE '\\')
          GROUP BY b.id ORDER BY b.title LIMIT $3 OFFSET $4`, [req.user.tenant_id, esc, limit, offset])).rows;
      return { books: rows.map((r) => ({
        id: r.id, code: r.code, title: r.title, subtitle: r.subtitle, author: r.author, publisher: r.publisher,
        edition: r.edition, pubYear: r.pub_year, isbn13: r.isbn13, category: r.category, subject: r.subject,
        language: r.language, shelfLocation: r.shelf_location, bookType: r.book_type, status: r.status,
        priceCents: r.price_cents, available: r.available, issued: r.issued, copiesTotal: r.total,
        copiesOut: r.issued, retired: r.status === 'retired', coverFileId: r.cover_file_id ?? null,
      })), limit, offset, hasMore: rows.length === limit };
    });
  };
  app.get(`/plugins/${ID}/desk/books`, { preHandler: [require(...DESK), lifecycleGate] }, listBooks(true));

  // Full desk view of one title: metadata, every physical copy with its current borrower, and open loans.
  app.get(`/plugins/${ID}/desk/books/:id`, { preHandler: [require(...DESK), uuidParams('id'), lifecycleGate] }, async (req, reply) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const b = (await c.query(
        `SELECT id, code, title, subtitle, author, publisher, edition, pub_year, language, isbn10, isbn13,
                subject, category, dewey_code, description, shelf_location, price_cents, acquired_on, vendor,
                bill_ref, book_type, status, cover_file_id
           FROM library.book WHERE id=$1 AND tenant_id=$2`, [req.params.id, t])).rows[0];
      if (!b) return bad(reply, 'We couldn\'t find that book', 404);
      const copies = (await c.query(
        `SELECT k.id, k.copy_code, k.barcode, k.accession_no, k.status, k.condition,
                (SELECT COALESCE(s.name, u.name) FROM library.loan l
                   LEFT JOIN app.students s ON s.id=l.student_id LEFT JOIN app.users u ON u.id=l.borrower_user_id
                  WHERE l.copy_id=k.id AND l.status='issued' LIMIT 1) AS borrower,
                (SELECT l.due_on FROM library.loan l WHERE l.copy_id=k.id AND l.status='issued' LIMIT 1) AS due_on
           FROM library.copy k WHERE k.tenant_id=$1 AND k.book_id=$2 ORDER BY k.copy_code`, [t, b.id])).rows;
      const counts = await copyCounts(c, t, b.id);
      const holds = (await c.query(`SELECT count(*)::int n FROM library.reservation WHERE tenant_id=$1 AND book_id=$2 AND status IN ('requested','ready')`, [t, b.id])).rows[0].n;
      const openLoans = (await c.query(
        `SELECT l.id, l.due_on, l.borrower_type, COALESCE(s.name, u.name) AS borrower, k.copy_code
           FROM library.loan l LEFT JOIN app.students s ON s.id=l.student_id LEFT JOIN app.users u ON u.id=l.borrower_user_id
           LEFT JOIN library.copy k ON k.id=l.copy_id
          WHERE l.tenant_id=$1 AND l.book_id=$2 AND l.status='issued' ORDER BY l.due_on`, [t, b.id])).rows;
      return { book: { ...b, available: counts.available, copiesTotal: counts.total, issued: counts.issued, unavailable: counts.unavailable, holds }, copies, openLoans };
    }));

  app.get(`/plugins/${ID}/copies`, { preHandler: [require(...DESK), lifecycleGate] }, async (req) => {
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 500 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const s = await settings(req.user.tenant_id);
      const rows = (await c.query(
        `SELECT k.id, k.copy_code, k.barcode, k.accession_no, k.status, k.condition, k.book_id,
                b.title, b.author, b.code AS book_code
           FROM library.copy k JOIN library.book b ON b.id=k.book_id
          WHERE k.tenant_id=$1 ORDER BY b.title, k.copy_code LIMIT $2 OFFSET $3`, [req.user.tenant_id, limit, offset])).rows;
      return { copies: rows, symbology: s.barcode_symbology ?? 'code128', identifierLabel: s.custom_identifier_label ?? 'Accession No', limit, offset, hasMore: rows.length === limit };
    });
  });

  app.patch(`/plugins/${ID}/copies/:id`, { preHandler: [require(...DESK), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const status = b.status;
    const allowed = ['available', 'lost', 'damaged', 'withdrawn'];
    if (status && !allowed.includes(status)) return bad(reply, 'Status must be available, lost, damaged or withdrawn');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const k = (await c.query(
        `SELECT k.id, k.book_id, k.status, k.copy_code, b.title, b.price_cents
           FROM library.copy k JOIN library.book b ON b.id=k.book_id
          WHERE k.id=$1 AND k.tenant_id=$2 FOR UPDATE OF k`, [req.params.id, t])).rows[0];
      if (!k) return bad(reply, 'We couldn\'t find that copy', 404);
      // An issued copy may only become lost or damaged (that closes the loan); it cannot be returned by
      // this door — the return door computes the overdue fine — nor withdrawn while it is out.
      if (k.status === 'issued' && !['lost', 'damaged'].includes(status)) return bad(reply, 'That copy is out on loan — return it first', 409);

      let closed = null;
      if (['lost', 'damaged'].includes(status) && k.status === 'issued') {
        const s = await settings(t);
        const loan = (await c.query(
          `SELECT id, due_on, borrower_type, student_id, borrower_user_id FROM library.loan
            WHERE tenant_id=$1 AND copy_id=$2 AND status='issued' FOR UPDATE`, [t, k.id])).rows[0];
        if (loan) {
          const pct = Number.isFinite(Number(s.lost_charge_percent)) ? Number(s.lost_charge_percent) : 100;
          const charge = status === 'lost'
            ? Math.max(0, Math.round((Number(k.price_cents) || 0) * pct / 100))
            : Math.max(0, Number(s.damage_charge_cents) || 0);
          const cause = status === 'lost' ? 'lost' : 'damage';
          await c.query(
            `UPDATE library.loan SET status='lost', returned_at=now(), returned_by=$2, return_condition=$3, fine_cents=$4 WHERE id=$1`,
            [loan.id, req.user.id, status === 'lost' ? 'lost' : 'damaged', charge]);
          if (charge > 0) await c.query(
            `INSERT INTO library.fine (tenant_id, loan_id, borrower_type, borrower_student_id, borrower_user_id, cause, amount_cents)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`, [t, loan.id, loan.borrower_type, loan.student_id, loan.borrower_user_id, cause, charge]);
          await notifyBorrower(c, t, { type: loan.borrower_type, studentId: loan.student_id, userId: loan.borrower_user_id },
            { title: `Library copy ${status}`, body: `"${k.title}" was marked ${status}${charge > 0 ? ` · charge ₹${(charge / 100).toFixed(2)}` : ''}.`, ref: loan.id });
          await emitEvent(c, t, { type: 'library', label: `Copy ${k.copy_code} ${status}: ${k.title}`, ref: loan.id },
            'library.loan.lost.v1', { loanId: loan.id, copyId: k.id, cause, chargeCents: charge });
          closed = { loanId: loan.id, charge };
        }
      }

      await c.query(`UPDATE library.copy SET status=COALESCE($2,status), condition=COALESCE($3,condition) WHERE id=$1`,
        [k.id, status ?? null, b.condition ?? null]);
      if (status === 'available') await advanceQueue(c, t, k.book_id);
      await emitEvent(c, t, { type: 'library', label: `Copy ${k.copy_code} → ${status ?? 'updated'}`, ref: k.id }, 'library.copy.status.v1', { copyId: k.id, status });
      await requestAudit(c, t, ID, { actor: req.user.name, action: 'Copy status changed', recordType: 'LibraryCopy', recordRef: k.id,
        reason: k.copy_code, policyRef: 'Library desk norms', risk: ['lost', 'damaged'].includes(status) ? 'medium' : 'low',
        outcome: `${status ?? 'condition updated'}${closed ? ` · loan closed · charge ₹${(closed.charge / 100).toFixed(2)}` : ''}` });
      return { ok: true, copyId: k.id, status: status ?? k.status, closedLoanId: closed?.loanId ?? null, chargeCents: closed?.charge ?? 0 };
    });
  });

  app.get(`/plugins/${ID}/scan`, { preHandler: [require(...DESK), lifecycleGate] }, async (req, reply) => {
    const code = String(req.query?.code ?? '').trim();
    if (!code) return bad(reply, 'Scan a copy code, barcode, accession or ISBN');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const s = await settings(req.user.tenant_id);
      const accepts = Array.isArray(s.scan_accepts) ? s.scan_accepts
        : (typeof s.scan_accepts === 'string' && s.scan_accepts ? s.scan_accepts.split(',').map((x) => x.trim()) : ['copy_code', 'barcode', 'accession', 'isbn']);
      const copyConds = [];
      if (accepts.includes('copy_code')) copyConds.push('k.copy_code=$2');
      if (accepts.includes('barcode')) copyConds.push('k.barcode=$2');
      if (accepts.includes('accession')) copyConds.push('k.accession_no=$2');
      if (copyConds.length) {
        const k = (await c.query(
          `SELECT k.id, k.copy_code, k.barcode, k.accession_no, k.status, k.condition, b.id AS book_id, b.title, b.author, b.code AS book_code
             FROM library.copy k JOIN library.book b ON b.id=k.book_id
            WHERE k.tenant_id=$1 AND (${copyConds.join(' OR ')}) LIMIT 1`, [req.user.tenant_id, code])).rows[0];
        if (k) return { kind: 'copy', copy: k };
      }
      if (accepts.includes('isbn')) {
        const b = (await c.query(`SELECT id, code, title, author, status FROM library.book WHERE tenant_id=$1 AND (isbn13=$2 OR isbn10=$2 OR code=$2) LIMIT 1`, [req.user.tenant_id, code])).rows[0];
        if (b) return { kind: 'book', book: b };
      }
      return { kind: 'none', code };
    });
  });

  // Issue: lock the title, pick+lock an available copy, enforce policy, create the loan.
  app.post(`/plugins/${ID}/loans`, { preHandler: [require(...DESK), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const bookId = b.bookId ?? b.book_id;
    const copyId = b.copyId ?? b.copy_id ?? null;
    const dueOn = b.dueOn ?? b.due_on;
    if (!bookId || !UUID.test(String(bookId))) return bad(reply, 'Which book is being issued? (bookId is missing)');
    if (dueOn != null && !isDate(String(dueOn))) return bad(reply, 'Pick the return-by date (dueOn, YYYY-MM-DD)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const found = await borrowerFromBody(c, t, b);
      if (found.error) return bad(reply, found.error, found.code ?? 400);
      const borrower = found.borrower;
      const book = (await c.query(`SELECT id, code, title, status FROM library.book WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [bookId, t])).rows[0];
      if (!book) return bad(reply, 'We couldn\'t find that book', 404);
      if (book.status === 'retired') return bad(reply, 'That title has been retired — it can\'t be issued', 409);
      const s = policy(await settings(t), borrower.type);
      if (await hasLostOutstanding(c, t, borrower)) return bad(reply, 'This borrower has a book marked lost — clear it before lending again', 409);
      const open = await openLoanCount(c, t, borrower);
      if (open >= s.max) return bad(reply, `This borrower already has ${open} book(s) out (limit ${s.max})`, 409);
      const copy = copyId
        ? (await c.query(`SELECT id, copy_code FROM library.copy WHERE id=$1 AND tenant_id=$2 AND book_id=$3 FOR UPDATE`, [copyId, t, book.id])).rows[0]
        : (await c.query(`SELECT id, copy_code FROM library.copy WHERE tenant_id=$1 AND book_id=$2 AND status='available' ORDER BY copy_code LIMIT 1 FOR UPDATE`, [t, book.id])).rows[0];
      if (!copy) return bad(reply, 'no copies available', 409);
      const due = dueOn ?? (await c.query(`SELECT (('now'::timestamptz AT TIME ZONE 'UTC')::date + $1::int)::text AS d`, [s.days])).rows[0].d;
      const loan = (await c.query(
        `INSERT INTO library.loan (tenant_id, book_id, copy_id, student_id, borrower_user_id, borrower_type, issued_by, due_on, status, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'issued',COALESCE($9,'walk_in')) RETURNING id, due_on, issued_at`,
        [t, book.id, copy.id, borrower.studentId, borrower.userId, borrower.type, req.user.id, due, b.source ?? null])).rows[0];
      await c.query(`UPDATE library.copy SET status='issued' WHERE id=$1`, [copy.id]);
      // fulfil this borrower's own active hold on this title, if any
      await c.query(
        `UPDATE library.reservation SET status='fulfilled', fulfilled_loan_id=$3
          WHERE tenant_id=$1 AND book_id=$2 AND status IN ('requested','ready')
            AND (($4::uuid IS NOT NULL AND borrower_student_id=$4::uuid) OR ($5::uuid IS NOT NULL AND borrower_user_id=$5::uuid))`,
        [t, book.id, loan.id, borrower.studentId, borrower.userId]);
      if (borrower.type === 'student') await notifyUsers(c, t, [(await c.query(`SELECT user_id FROM app.student_accounts WHERE tenant_id=$1 AND student_id=$2 LIMIT 1`, [t, borrower.studentId])).rows[0]?.user_id],
        { title: 'Library book issued', body: `"${book.title}" is due back on ${loan.due_on}.`, ref: loan.id });
      else await notifyUsers(c, t, [borrower.userId], { title: 'Library book issued', body: `"${book.title}" is due back on ${loan.due_on}.`, ref: loan.id });
      await emitEvent(c, t, { type: 'library', label: `Book issued: ${book.title} (${book.code}) → ${borrower.name}`, ref: loan.id },
        'library.loan.issued.v1', { loanId: loan.id, bookId: book.id, copyId: copy.id, dueOn: loan.due_on });
      await requestAudit(c, t, ID, { actor: req.user.name, action: 'Book issued', recordType: 'LibraryLoan', recordRef: loan.id,
        reason: `${book.code} · ${book.title.slice(0, 60)} → ${borrower.name}`, policyRef: 'Library desk norms', risk: 'low', outcome: `due ${loan.due_on}` });
      return { ok: true, loanId: loan.id, dueOn: loan.due_on, issuedAt: loan.issued_at, copy: copy.copy_code,
        loan: { id: loan.id, bookTitle: book.title, bookCode: book.code, borrowerName: borrower.name, dueOn: loan.due_on, status: 'issued', fineCents: 0 } };
    });
  });

  app.post(`/plugins/${ID}/loans/:id/return`, { preHandler: [require(...DESK), uuidParams('id'), lifecycleGate] }, async (req, reply) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const l = (await c.query(
        `SELECT l.id, l.status, l.due_on, l.borrower_type, l.student_id, l.borrower_user_id, l.copy_id, l.book_id,
                b.code AS book_code, b.title AS book_title,
                COALESCE(s.name, u.name) AS borrower_name
           FROM library.loan l
           JOIN library.book b ON b.id=l.book_id
           LEFT JOIN app.students s ON s.id=l.student_id
           LEFT JOIN app.users u ON u.id=l.borrower_user_id
          WHERE l.id=$1 AND l.tenant_id=$2 FOR UPDATE OF l`, [req.params.id, t])).rows[0];
      if (!l) return bad(reply, 'We couldn\'t find that loan', 404);
      if (l.status !== 'issued') return bad(reply, `This loan is already ${l.status}`, 409);
      const damaged = req.body?.condition === 'damaged';
      const { daysOverdue, fineCents } = await fineFor(c, t, l);
      await c.query(`UPDATE library.loan SET status='returned', returned_at=now(), returned_by=$2, return_condition=$3, fine_cents=$4 WHERE id=$1`,
        [l.id, req.user.id, damaged ? 'damaged' : 'ok', fineCents]);
      if (l.copy_id) await c.query(`UPDATE library.copy SET status=$2 WHERE id=$1`, [l.copy_id, damaged ? 'damaged' : 'available']);
      if (fineCents > 0) await c.query(
        `INSERT INTO library.fine (tenant_id, loan_id, borrower_type, borrower_student_id, borrower_user_id, cause, amount_cents)
         VALUES ($1,$2,$3,$4,$5,'overdue',$6)`, [t, l.id, l.borrower_type, l.student_id, l.borrower_user_id, fineCents]);
      await advanceQueue(c, t, l.book_id);
      await notifyBorrower(c, t, { type: l.borrower_type, studentId: l.student_id, userId: l.borrower_user_id },
        { title: 'Library book returned', body: `"${l.book_title}" was returned${fineCents > 0 ? ` · fine ₹${(fineCents / 100).toFixed(2)}` : ''}.`, ref: l.id });
      await emitEvent(c, t, { type: 'library', label: `Book returned: ${l.book_title} (${l.book_code}) ← ${l.borrower_name}${fineCents > 0 ? ` · fine ₹${(fineCents / 100).toFixed(2)}` : ''}`, ref: l.id },
        'library.loan.returned.v1', { loanId: l.id, bookId: l.book_id, fineCents, daysOverdue });
      await requestAudit(c, t, ID, { actor: req.user.name, action: 'Book returned', recordType: 'LibraryLoan', recordRef: l.id,
        reason: `${l.book_code} · ${l.book_title.slice(0, 60)} ← ${l.borrower_name}`, policyRef: 'Library desk norms · fine at return',
        risk: 'low', outcome: `${daysOverdue} day(s) overdue · fine ₹${(fineCents / 100).toFixed(2)}${damaged ? ' · damaged' : ''}` });
      return { ok: true, loanId: l.id, fineCents, daysOverdue, damaged, loan: { id: l.id, status: 'returned', fineCents } };
    }));

  app.post(`/plugins/${ID}/loans/:id/renew`, { preHandler: [require(...DESK), uuidParams('id'), lifecycleGate] }, async (req, reply) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await renewLoan(c, req.user.tenant_id, req.params.id, req.user, { byDesk: true });
      if (r.error) return bad(reply, r.error, r.code ?? 400);
      return r;
    }));

  const renewLoan = async (c, t, loanId, user, { byDesk } = {}) => {
    const l = (await c.query(
      `SELECT l.id, l.due_on, l.renewal_count, l.borrower_type, l.student_id, l.borrower_user_id, l.book_id,
              b.title AS book_title
         FROM library.loan l JOIN library.book b ON b.id=l.book_id
        WHERE l.id=$1 AND l.tenant_id=$2 FOR UPDATE OF l`, [loanId, t])).rows[0];
    if (!l) return { error: 'We couldn\'t find that loan', code: 404 };
    if (l.status !== 'issued') return { error: `This loan is already ${l.status}`, code: 409 };
    const s = policy(await settings(t), l.borrower_type);
    if (l.renewal_count >= s.renewalLimit) return { error: `This loan has already been renewed ${l.renewal_count} time(s) (limit ${s.renewalLimit})`, code: 409 };
    const hold = (await c.query(`SELECT 1 FROM library.reservation WHERE tenant_id=$1 AND book_id=$2 AND status IN ('requested','ready') LIMIT 1`, [t, l.book_id])).rows.length > 0;
    if (hold) return { error: 'Someone is waiting for this title — it cannot be renewed', code: 409 };
    const upd = await c.query(`UPDATE library.loan SET due_on = due_on + $2::int, renewal_count = renewal_count + 1, last_renewed_at = now() WHERE id=$1 RETURNING due_on, renewal_count`, [l.id, s.renewalDays]);
    await emitEvent(c, t, { type: 'library', label: `Loan renewed: ${l.book_title} → ${upd.rows[0].due_on}`, ref: l.id }, 'library.loan.renewed.v1', { loanId: l.id, dueOn: upd.rows[0].due_on });
    await requestAudit(c, t, ID, { actor: user.name, action: 'Loan renewed', recordType: 'LibraryLoan', recordRef: l.id,
      reason: l.book_title.slice(0, 60), policyRef: 'Library desk norms', risk: 'low', outcome: `+${s.renewalDays}d → ${upd.rows[0].due_on}` });
    return { ok: true, loanId: l.id, dueOn: upd.rows[0].due_on, renewalCount: upd.rows[0].renewal_count };
  };

  app.get(`/plugins/${ID}/loans`, { preHandler: [require(...DESK), lifecycleGate] }, async (req, reply) => {
    const state = req.query?.state === 'all' ? 'all' : 'open';
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 300 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT l.id, l.status, l.issued_at, l.due_on, l.returned_at, l.fine_cents, l.renewal_count, l.borrower_type,
                b.id AS book_id, b.code AS book_code, b.title AS book_title,
                COALESCE(s.name, u.name) AS borrower_name,
                s.grade, s.section
           FROM library.loan l JOIN library.book b ON b.id=l.book_id
           LEFT JOIN app.students s ON s.id=l.student_id
           LEFT JOIN app.users u ON u.id=l.borrower_user_id
          WHERE l.tenant_id=$1 AND ($2 OR l.status='issued')
          ORDER BY l.due_on ASC LIMIT $3 OFFSET $4`, [req.user.tenant_id, state === 'all', limit, offset])).rows;
      return { state, loans: rows.map(loanRow), limit, offset, hasMore: rows.length === limit };
    });
  });

  const loanRow = (r) => ({
    id: r.id, status: r.status, issuedAt: r.issued_at, dueOn: r.due_on, returnedAt: r.returned_at,
    fineCents: r.fine_cents, renewalCount: r.renewal_count, borrowerType: r.borrower_type,
    bookTitle: r.book_title, bookCode: r.book_code, borrowerName: r.borrower_name,
    studentName: r.borrower_name, studentGrade: r.grade, studentSection: r.section,
    book: { id: r.book_id, code: r.book_code, title: r.book_title },
    overdue: r.status === 'issued' && new Date(r.due_on) < new Date(new Date().toISOString().slice(0, 10)),
  });

  app.get(`/plugins/${ID}/overdue`, { preHandler: [require(...DESK), lifecycleGate] }, async (req) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT l.id, l.due_on, (('now'::timestamptz AT TIME ZONE 'UTC')::date - l.due_on) AS days_overdue,
                l.borrower_type, b.code AS book_code, b.title AS book_title,
                COALESCE(s.name, u.name) AS borrower_name, s.grade, s.section,
                g.phone AS guardian_phone
           FROM library.loan l JOIN library.book b ON b.id=l.book_id
           LEFT JOIN app.students s ON s.id=l.student_id
           LEFT JOIN app.users u ON u.id=l.borrower_user_id
           LEFT JOIN app.guardians g ON g.student_id=s.id AND g.is_primary
          WHERE l.tenant_id=$1 AND l.status='issued' AND l.due_on < ('now'::timestamptz AT TIME ZONE 'UTC')::date
          ORDER BY l.due_on ASC LIMIT 300`, [req.user.tenant_id])).rows;
      return { loans: rows.map((r) => ({
        id: r.id, dueOn: r.due_on, daysOverdue: Number(r.days_overdue ?? 0), borrowerType: r.borrower_type,
        bookTitle: r.book_title, bookCode: r.book_code, borrowerName: r.borrower_name,
        studentName: r.borrower_name, studentGrade: r.grade, studentSection: r.section,
        guardianPhone: r.borrower_type === 'student' ? (r.guardian_phone ?? null) : null,
        book: { code: r.book_code, title: r.book_title },
      })) };
    }));

  // ── holds ──
  app.get(`/plugins/${ID}/reservations`, { preHandler: [require(...DESK), lifecycleGate] }, async (req) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT r.id, r.status, r.queue_no, r.requested_at, r.ready_at, r.expires_at, r.borrower_type,
                b.id AS book_id, b.title, b.author, b.code AS book_code,
                COALESCE(s.name, u.name) AS borrower_name
           FROM library.reservation r JOIN library.book b ON b.id=r.book_id
           LEFT JOIN app.students s ON s.id=r.borrower_student_id
           LEFT JOIN app.users u ON u.id=r.borrower_user_id
          WHERE r.tenant_id=$1 AND r.status IN ('requested','ready')
          ORDER BY r.book_id, r.queue_no ASC NULLS LAST LIMIT 300`, [req.user.tenant_id])).rows;
      return { reservations: rows };
    }));

  app.post(`/plugins/${ID}/reservations/:id/fulfil`, { preHandler: [require(...DESK), uuidParams('id'), lifecycleGate] }, async (req, reply) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const r = (await c.query(`SELECT id, book_id, status FROM library.reservation WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [req.params.id, t])).rows[0];
      if (!r) return bad(reply, 'We couldn\'t find that hold', 404);
      if (!['requested', 'ready'].includes(r.status)) return bad(reply, `That hold is already ${r.status}`, 409);
      await c.query(`UPDATE library.reservation SET status='cancelled' WHERE id=$1`, [r.id]);
      return { ok: true, hint: 'Now issue the copy to this borrower — the hold is cleared.' };
    }));

  app.post(`/plugins/${ID}/reservations/:id/cancel`, { preHandler: [require(...DESK), uuidParams('id'), lifecycleGate] }, async (req, reply) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = (await c.query(`UPDATE library.reservation SET status='cancelled' WHERE id=$1 AND tenant_id=$2 AND status IN ('requested','ready') RETURNING id`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!r) return bad(reply, 'We couldn\'t find an open hold with that id', 404);
      await requestAudit(c, req.user.tenant_id, ID, { actor: req.user.name, action: 'Hold cancelled', recordType: 'LibraryReservation', recordRef: r.id, reason: 'desk cancellation', policyRef: 'Library desk norms', risk: 'low', outcome: 'cancelled' });
      return { ok: true, reservationId: r.id };
    }));

  // ── members (students + staff) with loan counts ──
  // Borrower lookup for the issue desk. A school has hundreds of borrowers, so a plain dropdown is
  // unusable: the caller narrows by type (student|staff), class and section, or types a name / admission
  // number / email. Every row carries a stable identifier the librarian can read aloud at the counter.
  app.get(`/plugins/${ID}/members`, { preHandler: [require(...DESK), lifecycleGate] }, async (req) => {
    const q = typeof req.query?.search === 'string' && req.query.search.trim() ? req.query.search.trim() : null;
    const esc = q ? q.replace(/([%_\\])/g, '\\$1') : null;
    const type = req.query?.type === 'student' || req.query?.type === 'staff' ? req.query.type : 'all';
    const grade = typeof req.query?.grade === 'string' && req.query.grade.trim() ? req.query.grade.trim() : null;
    const section = typeof req.query?.section === 'string' && req.query.section.trim() ? req.query.section.trim().toUpperCase() : null;
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 300 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const students = type === 'staff' ? [] : (await c.query(
        `SELECT s.id, s.name, s.admission_no, s.grade, s.section,
                count(l.id) FILTER (WHERE l.status='issued')::int AS open_loans,
                COALESCE(sum(f.amount_cents) FILTER (WHERE f.status='outstanding'),0)::int AS dues_cents
           FROM app.students s
           LEFT JOIN library.loan l ON l.student_id=s.id AND l.tenant_id=s.tenant_id
           LEFT JOIN library.fine f ON f.borrower_student_id=s.id AND f.tenant_id=s.tenant_id
          /* LIB-1: only ACTIVE students are borrowable — the issue door below refuses
             anything else with 409 "Only an active student can borrow". This picker used to
             list withdrawn/transferred pupils as if they could borrow, so a librarian could
             select one, fill in every field, press Issue, and get a 409 naming nothing about
             which row was the problem. */
          WHERE s.tenant_id=$1 AND s.status='active'
            AND ($2::text IS NULL OR s.name ILIKE '%'||$2||'%' ESCAPE '\' OR s.admission_no ILIKE '%'||$2||'%' ESCAPE '\')
            AND ($5::text IS NULL OR s.grade=$5) AND ($6::text IS NULL OR s.section=$6)
          GROUP BY s.id
          /* GRADE-1: app.students.grade is FREE TEXT - the school authors it on the
             Classes & sections screen ("e.g. 6, LKG, Nursery") and PUT /school/classes
             stores it verbatim. This used to be ORDER BY s.grade::int, which raises
             "invalid input syntax for type integer: Grade 8" (SQLSTATE 22P02) for any
             school whose grades are not bare integers - a 500 that emptied the borrower
             picker and made it impossible to issue a book to anybody. Sort naturally
             instead: the integer the label carries, when it carries one, then the label. */
          ORDER BY NULLIF(regexp_replace(s.grade, '\\D', '', 'g'), '')::int NULLS LAST,
                   s.grade, s.section, s.name
          LIMIT $3 OFFSET $4`,
        [req.user.tenant_id, esc, limit, offset, grade, section])).rows;
      const staff = type === 'student' ? [] : (await c.query(
        `SELECT u.id, u.name, u.role, u.email,
                count(l.id) FILTER (WHERE l.status='issued')::int AS open_loans,
                COALESCE(sum(f.amount_cents) FILTER (WHERE f.status='outstanding'),0)::int AS dues_cents
           FROM app.users u
           LEFT JOIN library.loan l ON l.borrower_user_id=u.id AND l.tenant_id=u.tenant_id
           LEFT JOIN library.fine f ON f.borrower_user_id=u.id AND f.tenant_id=u.tenant_id
          WHERE u.tenant_id=$1 AND u.active AND u.role <> 'parent'
            AND ($2::text IS NULL OR u.name ILIKE '%'||$2||'%' ESCAPE '\\' OR u.email ILIKE '%'||$2||'%' ESCAPE '\\')
          GROUP BY u.id ORDER BY u.name LIMIT $3 OFFSET $4`, [req.user.tenant_id, esc, limit, offset])).rows;
      // One unified, typed list for the desk pickers (the members page still uses students/staff separately).
      const borrowers = [
        ...students.map((s) => ({ id: s.id, type: 'student', name: s.name, identifier: s.admission_no, grade: s.grade, section: s.section, openLoans: s.open_loans, duesCents: s.dues_cents })),
        ...staff.map((u) => ({ id: u.id, type: 'staff', name: u.name, identifier: u.email, role: u.role, openLoans: u.open_loans, duesCents: u.dues_cents })),
      ];
      return { students, staff, borrowers, filters: { type, grade, section }, limit, offset, hasMore: students.length === limit || staff.length === limit };
    });
  });

  // ── fines ──
  app.get(`/plugins/${ID}/fines`, { preHandler: [require(...DESK), lifecycleGate] }, async (req) => {
    const status = ['outstanding', 'paid', 'waived'].includes(req.query?.status) ? req.query.status : null;
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 300 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT f.id, f.cause, f.amount_cents, f.status, f.assessed_at, f.settled_at,
                b.title AS book_title,
                COALESCE(s.name, u.name) AS borrower_name
           FROM library.fine f
           LEFT JOIN library.loan l ON l.id=f.loan_id
           LEFT JOIN library.book b ON b.id=l.book_id
           LEFT JOIN app.students s ON s.id=f.borrower_student_id
           LEFT JOIN app.users u ON u.id=f.borrower_user_id
          WHERE f.tenant_id=$1 AND ($2::text IS NULL OR f.status=$2)
          ORDER BY f.assessed_at DESC LIMIT $3 OFFSET $4`, [req.user.tenant_id, status, limit, offset])).rows;
      return { fines: rows, limit, offset, hasMore: rows.length === limit };
    });
  });

  app.post(`/plugins/${ID}/fines/:id/settle`, { preHandler: [require(...DESK), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const action = req.body?.action;
    if (!['pay', 'waive'].includes(action)) return bad(reply, 'Action must be pay or waive');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const f = (await c.query(`SELECT id, amount_cents, status FROM library.fine WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!f) return bad(reply, 'We couldn\'t find that fine', 404);
      if (f.status !== 'outstanding') return bad(reply, `That fine is already ${f.status}`, 409);
      if (action === 'waive') {
        const s = await settings(req.user.tenant_id);
        if (s.allow_fine_waiver === false) return bad(reply, 'Waiving fines is switched off for this library — ask the owner to enable it', 409);
      }
      await c.query(`UPDATE library.fine SET status=$2, settled_at=now(), settled_by=$3, notes=COALESCE($4,notes) WHERE id=$1`,
        [f.id, action === 'pay' ? 'paid' : 'waived', req.user.id, req.body?.note ?? null]);
      await emitEvent(c, req.user.tenant_id, { type: 'library', label: `Fine ${action === 'pay' ? 'paid' : 'waived'} ₹${(f.amount_cents / 100).toFixed(2)}`, ref: f.id }, 'library.fine.settled.v1', { fineId: f.id, action });
      await requestAudit(c, req.user.tenant_id, ID, { actor: req.user.name, action: action === 'pay' ? 'Fine paid' : 'Fine waived', recordType: 'LibraryFine', recordRef: f.id, reason: `₹${(f.amount_cents / 100).toFixed(2)}`, policyRef: 'Library desk norms', risk: action === 'waive' ? 'medium' : 'low', outcome: action });
      return { ok: true, fineId: f.id, status: action === 'pay' ? 'paid' : 'waived' };
    });
  });

  // ── acquisitions (purchase suggestions) ──
  app.get(`/plugins/${ID}/acquisitions`, { preHandler: [require(...DESK), lifecycleGate] }, async (req) => {
    const status = ['requested', 'approved', 'rejected', 'ordered', 'added', 'cancelled'].includes(req.query?.status) ? req.query.status : null;
    const { limit, offset } = pageParams(req.query, { defaultLimit: 100, maxLimit: 300 });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const rows = (await c.query(
        `SELECT r.id, r.title, r.author, r.isbn, r.note, r.status, r.vote_count, r.created_at,
                r.decided_at, r.decision_note, r.added_book_id,
                r.vendor, r.budget_code, r.cost_cents, r.ordered_at, r.received_at
           FROM library.acquisition_request r
          WHERE r.tenant_id=$1 AND ($2::text IS NULL OR r.status=$2)
          ORDER BY (r.status='requested') DESC, r.vote_count DESC, r.created_at ASC LIMIT $3 OFFSET $4`, [req.user.tenant_id, status, limit, offset])).rows;
      return { requests: rows, limit, offset, hasMore: rows.length === limit };
    });
  });

  app.post(`/plugins/${ID}/acquisitions/:id/decide`, { preHandler: [require(...DESK), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const b = req.body ?? {};
    const decision = b.decision;
    if (!['approve', 'reject', 'ordered', 'added'].includes(decision)) return bad(reply, 'Decision must be approve, reject, ordered or added');
    if (decision === 'reject' && !String(b.note ?? '').trim()) return bad(reply, 'Add a short reason for the borrower');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const r = (await c.query(`SELECT id, title, status FROM library.acquisition_request WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [req.params.id, t])).rows[0];
      if (!r) return bad(reply, 'We couldn\'t find that request', 404);
      const status = decision === 'approve' ? 'approved' : decision === 'ordered' ? 'ordered' : decision === 'added' ? 'added' : 'rejected';
      // LMS-24: procurement detail travels with the decision so the report can reconcile vendor + budget.
      const vendor = String(b.vendor ?? '').trim() || null;
      const budgetCode = String(b.budgetCode ?? b.budget_code ?? '').trim() || null;
      const rawCost = b.costCents ?? b.cost_cents;
      const costCents = rawCost == null || rawCost === '' ? null
        : (Number.isFinite(Number(rawCost)) ? Math.max(0, Math.round(Number(rawCost))) : null);
      if (costCents === null && rawCost != null && rawCost !== '') return bad(reply, 'costCents must be a whole number of paise');
      let addedBookId = null;
      if (decision === 'added') {
        const ins = await c.query(`INSERT INTO library.book (tenant_id, code, copies_total, title, author, isbn13, price_cents, vendor, created_by)
          VALUES ($1,$2,0,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [t, `LIB-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`, r.title, b.author ?? null, b.isbn13 ?? null, costCents, vendor, req.user.id]);
        addedBookId = ins.rows[0].id;
      }
      await c.query(
        `UPDATE library.acquisition_request
            SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4,
                added_book_id=COALESCE($5,added_book_id), vendor=COALESCE($6,vendor), budget_code=COALESCE($7,budget_code),
                cost_cents=COALESCE($8,cost_cents),
                ordered_at=CASE WHEN $9 THEN now() ELSE ordered_at END,
                received_at=CASE WHEN $10 THEN now() ELSE received_at END,
                updated_at=now()
          WHERE id=$1`,
        [r.id, status, req.user.id, b.note ?? null, addedBookId, vendor, budgetCode, costCents,
          status === 'ordered' || status === 'added', status === 'added']);
      // tell every requester + voter
      const people = (await c.query(
        `SELECT requested_by_user_id AS uid, requested_by_student_id AS sid FROM library.acquisition_request WHERE id=$1
         UNION SELECT voter_user_id, voter_student_id FROM library.acquisition_vote WHERE request_id=$1`, [r.id])).rows;
      for (const p of people) await notifyBorrower(c, t, { type: p.sid ? 'student' : 'staff', studentId: p.sid, userId: p.uid },
        { title: `Book request ${status}`, body: `"${r.title}" is ${status}${b.note ? ` — ${b.note}` : ''}.`, ref: r.id, group: 'library' });
      // LMS-21: when a requested title lands in the catalog, queue every requester/voter for it so the
      // offer is actionable (the librarian adds copies, then the normal hold→ready flow takes over).
      if (decision === 'added' && addedBookId) {
        let qn = 0;
        for (const p of people) {
          qn++;
          await c.query(
            `INSERT INTO library.reservation (tenant_id, book_id, borrower_type, borrower_student_id, borrower_user_id, queue_no, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`, [t, addedBookId, p.sid ? 'student' : 'staff', p.sid, p.uid, qn, req.user.id]);
        }
      }
      await emitEvent(c, t, { type: 'library', label: `Purchase request ${status}: ${r.title}`, ref: r.id }, 'library.acquisition.decided.v1', { requestId: r.id, status, addedBookId });
      await requestAudit(c, t, ID, { actor: req.user.name, action: `Purchase request ${status}`, recordType: 'LibraryAcquisition', recordRef: r.id, reason: r.title.slice(0, 60), policyRef: 'Library desk norms', risk: 'low', outcome: status });
      return { ok: true, requestId: r.id, status, addedBookId };
    });
  });

  // The librarian owns the desk policy (loan periods, fines, holds) and every notification setting; the
  // identifier/catalog scheme stays owner/principal (design §C3). Both doors share one handler so the old
  // `/desk/settings/notifications` path keeps working for existing clients.
  const saveDeskSettings = async (req, reply) => {
    const b = req.body ?? {};
    const unknown = Object.keys(b).filter((k) => !DESK_KEYS.has(k));
    if (unknown.length) {
      const idKeys = unknown.filter((k) => IDENTIFIER_KEYS.has(k));
      if (idKeys.length) return bad(reply, `The identifier/catalog scheme (${idKeys.join(', ')}) is the school standard — ask the owner or principal to change it.`);
      return bad(reply, `Unknown library setting(s): ${unknown.join(', ')}`);
    }
    const invalid = validateDeskSettings(b);
    if (invalid) return bad(reply, invalid);
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const prev = (await sysq(`SELECT settings FROM app.plugins WHERE tenant_id=$1 AND plugin_id=$2`, [t, ID])).rows[0]?.settings ?? {};
      const next = { ...prev };
      for (const k of DESK_KEYS) if (k in b) next[k] = b[k];
      await sysq(`UPDATE app.plugins SET settings=$3::jsonb WHERE tenant_id=$1 AND plugin_id=$2`, [t, ID, JSON.stringify(next)]);
      await requestAudit(c, t, ID, { actor: req.user.name, action: 'Library desk settings updated', recordType: 'Plugin', recordRef: ID,
        reason: Object.keys(b).join(', ').slice(0, 120), policyRef: 'Library desk norms', risk: 'low', outcome: 'desk policy / notification preferences changed' });
      return { ok: true, settings: Object.fromEntries([...DESK_KEYS].filter((k) => k in next).map((k) => [k, next[k]])) };
    });
  };
  app.get(`/plugins/${ID}/desk/settings`, { preHandler: [require(...DESK), lifecycleGate] }, async (req) =>
    withUser(req.user.tenant_id, req.user.role, async () => {
      const s = await settings(req.user.tenant_id);
      return { settings: Object.fromEntries([...DESK_KEYS].filter((k) => k in s).map((k) => [k, s[k]])) };
    }));
  app.put(`/plugins/${ID}/desk/settings`, { preHandler: [require(...DESK), lifecycleGate] }, saveDeskSettings);
  app.put(`/plugins/${ID}/desk/settings/notifications`, { preHandler: [require(...DESK), lifecycleGate] }, saveDeskSettings);

  // ══════════════════════════════ BORROWER (non-parent) ══════════════════════════
  app.get(`/plugins/${ID}/catalog`, { preHandler: [require(...BORROWER), lifecycleGate] }, listBooks(false));

  app.get(`/plugins/${ID}/catalog/:id`, { preHandler: [require(...BORROWER), uuidParams('id'), lifecycleGate] }, async (req, reply) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const b = (await c.query(`SELECT id, code, title, subtitle, author, publisher, edition, pub_year, isbn13, category, subject, language, shelf_location, description, status, cover_file_id FROM library.book WHERE id=$1 AND tenant_id=$2`, [req.params.id, t])).rows[0];
      if (!b) return bad(reply, 'We couldn\'t find that book', 404);
      const counts = await copyCounts(c, t, b.id);
      const queue = (await c.query(`SELECT count(*)::int n FROM library.reservation WHERE tenant_id=$1 AND book_id=$2 AND status IN ('requested','ready')`, [t, b.id])).rows[0].n;
      return { book: { ...b, coverFileId: b.cover_file_id ?? null, available: counts.available, copiesTotal: counts.total, queue } };
    }));

  // LMS-23: serve a title's cover to any borrower. files.store's own download door is uploader/admin
  // scoped, so a student could not load a librarian-uploaded cover through it; the library owns the
  // cover reference and serving it is a catalog read. Bytes stream off the private store, never a URL.
  app.get(`/plugins/${ID}/books/:id/cover`, { preHandler: [require(...BORROWER), uuidParams('id'), lifecycleGate] }, async (req, reply) => {
    const meta = await withUser(req.user.tenant_id, req.user.role, async (c) => {
      const b = (await c.query(`SELECT cover_file_id FROM library.book WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.user.tenant_id])).rows[0];
      if (!b) return { code: 404, error: 'We couldn\'t find that book' };
      if (!b.cover_file_id) return { code: 404, error: 'That title has no cover' };
      const f = (await c.query(`SELECT storage_path, mime FROM app.files WHERE id=$1 AND tenant_id=$2`, [b.cover_file_id, req.user.tenant_id])).rows[0];
      if (!f) return { code: 410, error: 'The cover image is no longer available' };
      return { f };
    });
    if (meta.error) return bad(reply, meta.error, meta.code);
    const f = meta.f;
    if (f.storage_path.includes('..') || f.storage_path.startsWith('/')) return bad(reply, 'That file reference is invalid', 400);
    const path = join(storageBase(), f.storage_path);
    const st = await stat(path).catch(() => null);
    if (!st) return bad(reply, 'The cover image is no longer available', 410);
    reply.header('content-type', f.mime || 'application/octet-stream');
    reply.header('content-length', String(st.size));
    reply.header('cache-control', 'private, max-age=300');
    return reply.send(createReadStream(path));
  });

  app.post(`/plugins/${ID}/reservations`, { preHandler: [require(...BORROWER), lifecycleGate] }, async (req, reply) => {
    const bookId = req.body?.bookId ?? req.body?.book_id;
    if (!bookId || !UUID.test(String(bookId))) return bad(reply, 'Which book? (bookId is missing)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const s = policy(await settings(t), 'student');
      if (!s.allowReserve) return bad(reply, 'Reservations are switched off for this library', 409);
      const me = await selfBorrower(c, req.user);
      if (!me) return bad(reply, 'Your library account isn\'t linked yet — ask the librarian to link it', 409);
      if (!(await throttleOk(c, t, req.user.id, 'reserve'))) return bad(reply, 'Too many reservation requests just now — please wait a minute and try again.', 429);
      const book = (await c.query(`SELECT id, title, status FROM library.book WHERE id=$1 AND tenant_id=$2`, [bookId, t])).rows[0];
      if (!book || book.status === 'retired') return bad(reply, 'We couldn\'t find that book', 404);
      const active = (await c.query(`SELECT count(*)::int n FROM library.reservation WHERE tenant_id=$1 AND status IN ('requested','ready') AND (($2::uuid IS NOT NULL AND borrower_student_id=$2::uuid) OR ($3::uuid IS NOT NULL AND borrower_user_id=$3::uuid))`, [t, me.studentId, me.userId])).rows[0].n;
      if (active >= s.maxReservations) return bad(reply, `You already have ${active} open reservation(s) (limit ${s.maxReservations})`, 409);
      const qn = (await c.query(`SELECT COALESCE(max(queue_no),0)+1 AS n FROM library.reservation WHERE tenant_id=$1 AND book_id=$2`, [t, bookId])).rows[0].n;
      const ins = await c.query(
        `INSERT INTO library.reservation (tenant_id, book_id, borrower_type, borrower_student_id, borrower_user_id, queue_no, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status, queue_no`,
        [t, bookId, me.type, me.studentId, me.userId, qn, req.user.id]);
      await advanceQueue(c, t, bookId);
      await emitEvent(c, t, { type: 'library', label: `Hold placed: ${book.title}`, ref: ins.rows[0].id }, 'library.reservation.created.v1', { reservationId: ins.rows[0].id, bookId });
      await requestAudit(c, t, ID, { actor: req.user.name, action: 'Hold placed', recordType: 'LibraryReservation', recordRef: ins.rows[0].id, reason: book.title.slice(0, 60), policyRef: 'Library desk norms', risk: 'low', outcome: `queue ${qn}` });
      return { ok: true, reservation: ins.rows[0] };
    });
  });

  app.get(`/plugins/${ID}/reservations/mine`, { preHandler: [require(...BORROWER), lifecycleGate] }, async (req) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const me = await selfBorrower(c, req.user);
      if (!me) return { reservations: [], note: 'Your library account isn\'t linked yet — ask the librarian.' };
      const rows = (await c.query(
        `SELECT r.id, r.status, r.queue_no, r.requested_at, r.ready_at, r.expires_at, b.title, b.author, b.code AS book_code
           FROM library.reservation r JOIN library.book b ON b.id=r.book_id
          WHERE r.tenant_id=$1 AND (($2::uuid IS NOT NULL AND r.borrower_student_id=$2::uuid) OR ($3::uuid IS NOT NULL AND r.borrower_user_id=$3::uuid))
          ORDER BY r.requested_at DESC LIMIT 100`, [req.user.tenant_id, me.studentId, me.userId])).rows;
      return { reservations: rows };
    }));

  app.delete(`/plugins/${ID}/reservations/:id`, { preHandler: [require(...BORROWER), uuidParams('id'), lifecycleGate] }, async (req, reply) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const me = await selfBorrower(c, req.user);
      if (!me) return bad(reply, 'Your library account isn\'t linked yet', 409);
      const r = (await c.query(
        `UPDATE library.reservation SET status='cancelled'
          WHERE id=$1 AND tenant_id=$2 AND status IN ('requested','ready')
            AND (($3::uuid IS NOT NULL AND borrower_student_id=$3::uuid) OR ($4::uuid IS NOT NULL AND borrower_user_id=$4::uuid))
          RETURNING id`, [req.params.id, req.user.tenant_id, me.studentId, me.userId])).rows[0];
      if (!r) return bad(reply, 'We couldn\'t find that hold', 404);
      return { ok: true, reservationId: r.id };
    }));

  app.get(`/plugins/${ID}/loans/mine`, { preHandler: [require(...BORROWER), lifecycleGate] }, async (req) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const me = await selfBorrower(c, req.user);
      if (!me) return { loans: [], note: 'Your library account isn\'t linked yet — ask the librarian.' };
      const rows = (await c.query(
        `SELECT l.id, l.status, l.issued_at, l.due_on, l.returned_at, l.fine_cents, l.renewal_count,
                b.code AS book_code, b.title AS book_title, b.author AS book_author
           FROM library.loan l JOIN library.book b ON b.id=l.book_id
          WHERE l.tenant_id=$1 AND (($2::uuid IS NOT NULL AND l.student_id=$2::uuid) OR ($3::uuid IS NOT NULL AND l.borrower_user_id=$3::uuid))
          ORDER BY (l.status='issued') DESC, l.due_on ASC LIMIT 100`, [req.user.tenant_id, me.studentId, me.userId])).rows;
      return { loans: rows.map((r) => ({
        id: r.id, status: r.status, issuedAt: r.issued_at, dueOn: r.due_on, returnedAt: r.returned_at,
        fineCents: r.fine_cents, renewalCount: r.renewal_count, bookTitle: r.book_title, bookCode: r.book_code, bookAuthor: r.book_author,
        book: { code: r.book_code, title: r.book_title, author: r.book_author },
        overdue: r.status === 'issued' && new Date(r.due_on) < new Date(new Date().toISOString().slice(0, 10)),
      })) };
    }));

  app.post(`/plugins/${ID}/loans/:id/renew-request`, { preHandler: [require(...BORROWER), uuidParams('id'), lifecycleGate] }, async (req, reply) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const me = await selfBorrower(c, req.user);
      if (!me) return bad(reply, 'Your library account isn\'t linked yet', 409);
      const owns = (await c.query(`SELECT 1 FROM library.loan WHERE id=$1 AND tenant_id=$2 AND (($3::uuid IS NOT NULL AND student_id=$3::uuid) OR ($4::uuid IS NOT NULL AND borrower_user_id=$4::uuid))`, [req.params.id, req.user.tenant_id, me.studentId, me.userId])).rows.length > 0;
      if (!owns) return bad(reply, 'We couldn\'t find that loan', 404);
      const r = await renewLoan(c, req.user.tenant_id, req.params.id, req.user, { byDesk: false });
      if (r.error) return bad(reply, r.error, r.code ?? 400);
      return r;
    }));

  app.get(`/plugins/${ID}/fines/mine`, { preHandler: [require(...BORROWER), lifecycleGate] }, async (req) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const me = await selfBorrower(c, req.user);
      if (!me) return { fines: [] };
      const rows = (await c.query(
        `SELECT id, cause, amount_cents, status, assessed_at FROM library.fine
          WHERE tenant_id=$1 AND (($2::uuid IS NOT NULL AND borrower_student_id=$2::uuid) OR ($3::uuid IS NOT NULL AND borrower_user_id=$3::uuid))
          ORDER BY assessed_at DESC LIMIT 100`, [req.user.tenant_id, me.studentId, me.userId])).rows;
      return { fines: rows };
    }));

  // ── acquisitions (borrower side) ──
  app.post(`/plugins/${ID}/acquisitions`, { preHandler: [require(...BORROWER), lifecycleGate] }, async (req, reply) => {
    const title = String(req.body?.title ?? '').trim();
    if (title.length < 2) return bad(reply, 'What book would you like? (give a title)');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const s = policy(await settings(t), 'student');
      if (!s.allowAcq) return bad(reply, 'Purchase requests are switched off for this library', 409);
      const me = await selfBorrower(c, req.user);
      if (!me) return bad(reply, 'Your library account isn\'t linked yet — ask the librarian', 409);
      if (!(await throttleOk(c, t, req.user.id, 'suggest'))) return bad(reply, 'Too many book requests just now — please wait a minute and try again.', 429);
      const key = normKey(title, req.body?.author);
      const existing = (await c.query(`SELECT id, vote_count FROM library.acquisition_request WHERE tenant_id=$1 AND normalized_key=$2 AND status IN ('requested','approved','ordered') FOR UPDATE`, [t, key])).rows[0];
      if (existing) {
        if (s.acqVotes) {
          const v = await c.query(
            `INSERT INTO library.acquisition_vote (tenant_id, request_id, voter_user_id, voter_student_id)
             VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`, [t, existing.id, me.userId, me.studentId]);
          if (v.rows[0]) await c.query(`UPDATE library.acquisition_request SET vote_count=vote_count+1, updated_at=now() WHERE id=$1`, [existing.id]);
        }
        await emitEvent(c, t, { type: 'library', label: `Book request voted: ${title}`, ref: existing.id }, 'library.acquisition.voted.v1', { requestId: existing.id });
        return { ok: true, requestId: existing.id, voted: true };
      }
      const open = (await c.query(`SELECT count(*)::int n FROM library.acquisition_request WHERE tenant_id=$1 AND status='requested' AND (($2::uuid IS NOT NULL AND requested_by_student_id=$2::uuid) OR ($3::uuid IS NOT NULL AND requested_by_user_id=$3::uuid))`, [t, me.studentId, me.userId])).rows[0].n;
      if (open >= s.maxAcq) return bad(reply, `You already have ${open} open book request(s) (limit ${s.maxAcq})`, 409);
      const ins = await c.query(
        `INSERT INTO library.acquisition_request (tenant_id, title, author, isbn, note, requested_by_user_id, requested_by_student_id, normalized_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, status, vote_count`,
        [t, title.slice(0, 300), req.body?.author ?? null, req.body?.isbn ?? null, req.body?.note ?? null, me.userId, me.studentId, key]);
      await emitEvent(c, t, { type: 'library', label: `Book requested: ${title}`, ref: ins.rows[0].id }, 'library.acquisition.requested.v1', { requestId: ins.rows[0].id, title });
      await requestAudit(c, t, ID, { actor: req.user.name, action: 'Book purchase requested', recordType: 'LibraryAcquisition', recordRef: ins.rows[0].id, reason: title.slice(0, 60), policyRef: 'Library desk norms', risk: 'low', outcome: 'requested' });
      return { ok: true, request: ins.rows[0] };
    });
  });

  app.get(`/plugins/${ID}/acquisitions/mine`, { preHandler: [require(...BORROWER), lifecycleGate] }, async (req) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const me = await selfBorrower(c, req.user);
      if (!me) return { requests: [] };
      const rows = (await c.query(
        `SELECT id, title, author, status, vote_count, created_at, decision_note FROM library.acquisition_request
          WHERE tenant_id=$1 AND (($2::uuid IS NOT NULL AND requested_by_student_id=$2::uuid) OR ($3::uuid IS NOT NULL AND requested_by_user_id=$3::uuid))
          ORDER BY created_at DESC LIMIT 100`, [req.user.tenant_id, me.studentId, me.userId])).rows;
      return { requests: rows };
    }));

  app.post(`/plugins/${ID}/acquisitions/:id/vote`, { preHandler: [require(...BORROWER), uuidParams('id'), lifecycleGate] }, async (req, reply) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const me = await selfBorrower(c, req.user);
      if (!me) return bad(reply, 'Your library account isn\'t linked yet', 409);
      if (!(await throttleOk(c, t, req.user.id, 'vote'))) return bad(reply, 'Too many votes just now — please wait a minute and try again.', 429);
      const r = (await c.query(`SELECT id, status FROM library.acquisition_request WHERE id=$1 AND tenant_id=$2 AND status IN ('requested','approved','ordered')`, [req.params.id, t])).rows[0];
      if (!r) return bad(reply, 'That request is no longer open', 404);
      const v = await c.query(`INSERT INTO library.acquisition_vote (tenant_id, request_id, voter_user_id, voter_student_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`, [t, r.id, me.userId, me.studentId]);
      if (!v.rows[0]) return { ok: true, voted: false, note: 'You already voted for this book.' };
      await c.query(`UPDATE library.acquisition_request SET vote_count=vote_count+1, updated_at=now() WHERE id=$1`, [r.id]);
      await emitEvent(c, t, { type: 'library', label: 'Book request voted', ref: r.id }, 'library.acquisition.voted.v1', { requestId: r.id });
      return { ok: true, voted: true };
    }));

  // ══════════════════════════════ OPS (aggregate only) ════════════════════════════
  app.get(`/plugins/${ID}/ops/overview`, { preHandler: [require(...OPS), lifecycleGate] }, async (req) =>
    withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      const days = Math.min(365, Math.max(7, Number(req.query?.days) || 30));
      const [totals, trend, topTitles, aging, holds, acq, health] = await Promise.all([
        c.query(`SELECT
            (SELECT count(*)::int FROM library.copy WHERE tenant_id=$1) AS copies,
            (SELECT count(*)::int FROM library.copy WHERE tenant_id=$1 AND status='available') AS available,
            (SELECT count(*)::int FROM library.copy WHERE tenant_id=$1 AND status='issued') AS on_loan,
            (SELECT count(*)::int FROM library.book WHERE tenant_id=$1 AND status <> 'retired') AS titles,
            (SELECT count(*)::int FROM library.loan WHERE tenant_id=$1 AND issued_at >= now() - ($2||' days')::interval) AS loans_period,
            (SELECT count(*)::int FROM library.loan WHERE tenant_id=$1 AND status='issued' AND due_on < ('now'::timestamptz AT TIME ZONE 'UTC')::date) AS overdue,
            (SELECT COALESCE(sum(amount_cents) FILTER (WHERE status='outstanding'),0)::int FROM library.fine WHERE tenant_id=$1) AS fines_out,
            (SELECT COALESCE(sum(amount_cents) FILTER (WHERE status='paid'),0)::int FROM library.fine WHERE tenant_id=$1) AS fines_paid,
            (SELECT COALESCE(sum(amount_cents) FILTER (WHERE status='waived'),0)::int FROM library.fine WHERE tenant_id=$1) AS fines_waived,
            (SELECT count(DISTINCT COALESCE(l.student_id::text, l.borrower_user_id::text))::int FROM library.loan l
              WHERE l.tenant_id=$1 AND l.issued_at >= now() - ($2||' days')::interval) AS borrowers_period,
            ((SELECT count(*)::int FROM app.students WHERE tenant_id=$1 AND status='active')
             + (SELECT count(*)::int FROM app.users WHERE tenant_id=$1 AND active AND role <> 'parent')) AS population,
            (SELECT count(*)::int FROM library.book b WHERE b.tenant_id=$1 AND b.status <> 'retired'
              AND NOT EXISTS (SELECT 1 FROM library.loan l WHERE l.tenant_id=b.tenant_id AND l.book_id=b.id AND l.issued_at >= now() - interval '180 days')) AS dead_stock,
            (SELECT COALESCE(sum(b.price_cents * (SELECT count(*) FROM library.copy k WHERE k.tenant_id=b.tenant_id AND k.book_id=b.id)),0)::bigint
              FROM library.book b WHERE b.tenant_id=$1) AS collection_value_cents`, [t, String(days)]),
        c.query(`SELECT to_char(d::date,'YYYY-MM-DD') AS day, COALESCE(n,0)::int AS loans
                 FROM generate_series((('now'::timestamptz AT TIME ZONE 'UTC')::date - ($2::int - 1)), ('now'::timestamptz AT TIME ZONE 'UTC')::date, interval '1 day') d
                 LEFT JOIN (SELECT issued_at::date AS dd, count(*)::int n FROM library.loan WHERE tenant_id=$1 AND issued_at >= now() - ($2||' days')::interval GROUP BY 1) x ON x.dd=d::date
                 ORDER BY d`, [t, days]),
        c.query(`SELECT b.title, count(l.id)::int AS loans FROM library.loan l JOIN library.book b ON b.id=l.book_id
                 WHERE l.tenant_id=$1 AND l.issued_at >= now() - ($2||' days')::interval GROUP BY b.title ORDER BY loans DESC LIMIT 10`, [t, String(days)]),
        c.query(`SELECT CASE WHEN d<=7 THEN '1-7' WHEN d<=30 THEN '8-30' ELSE '30+' END AS bucket, count(*)::int n
                 FROM (SELECT (('now'::timestamptz AT TIME ZONE 'UTC')::date - due_on) AS d FROM library.loan
                        WHERE tenant_id=$1 AND status='issued' AND due_on < ('now'::timestamptz AT TIME ZONE 'UTC')::date) o GROUP BY 1`, [t]),
        c.query(`SELECT count(*) FILTER (WHERE status='requested')::int waiting, count(*) FILTER (WHERE status='ready')::int ready FROM library.reservation WHERE tenant_id=$1`, [t]),
        c.query(`SELECT count(*) FILTER (WHERE status='requested')::int open_requests, COALESCE(sum(vote_count) FILTER (WHERE status IN ('requested','approved','ordered')),0)::int votes FROM library.acquisition_request WHERE tenant_id=$1`, [t]),
        c.query(`SELECT count(*) FILTER (WHERE status='lost')::int lost, count(*) FILTER (WHERE status='damaged')::int damaged, count(*) FILTER (WHERE status='withdrawn')::int withdrawn FROM library.copy WHERE tenant_id=$1`, [t]),
      ]);
      const tt = totals.rows[0];
      return {
        period: { days },
        totals: {
          titles: tt.titles, copies: tt.copies, available: tt.available, onLoan: tt.on_loan,
          loansPeriod: tt.loans_period, overdue: tt.overdue,
          utilizationPct: tt.copies ? Math.round((tt.on_loan / tt.copies) * 100) : 0,
          readerPenetrationPct: tt.population ? Math.round((tt.borrowers_period / tt.population) * 100) : 0,
          deadStock: tt.dead_stock,
          costPerCirculationCents: tt.loans_period ? Math.round(Number(tt.collection_value_cents) / tt.loans_period) : 0,
          collectionValueCents: Number(tt.collection_value_cents),
          fines: { outstanding: tt.fines_out, collected: tt.fines_paid, waived: tt.fines_waived },
        },
        trend: trend.rows,
        topTitles: topTitles.rows,
        overdueAging: aging.rows,
        holds: holds.rows[0],
        acquisition: acq.rows[0],
        collectionHealth: health.rows[0],
      };
    }));

  // ── reports / CSV export (librarian) ──
  app.get(`/plugins/${ID}/reports/:kind`, { preHandler: [require(...DESK), lifecycleGate] }, async (req, reply) => {
    const kind = String(req.params.kind);
    const csv = String(req.query?.format ?? '').toLowerCase() === 'csv';
    const days = Math.min(365, Math.max(7, Number(req.query?.days) || 30));
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const t = req.user.tenant_id;
      let rows = [];
      if (kind === 'circulation') {
        rows = (await c.query(
          `SELECT b.title AS title, b.code AS book_code, COALESCE(s.name, u.name) AS borrower,
                  l.borrower_type AS borrower_type, l.issued_at::date AS issued, l.due_on AS due,
                  l.returned_at::date AS returned, l.fine_cents AS fine_cents, l.status AS status
             FROM library.loan l JOIN library.book b ON b.id=l.book_id
             LEFT JOIN app.students s ON s.id=l.student_id LEFT JOIN app.users u ON u.id=l.borrower_user_id
            WHERE l.tenant_id=$1 AND l.issued_at >= now() - ($2||' days')::interval
            ORDER BY l.issued_at DESC LIMIT 5000`, [t, String(days)])).rows;
      } else if (kind === 'overdue') {
        rows = (await c.query(
          `SELECT b.title AS title, b.code AS book_code, COALESCE(s.name, u.name) AS borrower,
                  l.due_on AS due, (('now'::timestamptz AT TIME ZONE 'UTC')::date - l.due_on) AS days_late
             FROM library.loan l JOIN library.book b ON b.id=l.book_id
             LEFT JOIN app.students s ON s.id=l.student_id LEFT JOIN app.users u ON u.id=l.borrower_user_id
            WHERE l.tenant_id=$1 AND l.status='issued' AND l.due_on < ('now'::timestamptz AT TIME ZONE 'UTC')::date
            ORDER BY l.due_on ASC LIMIT 5000`, [t])).rows;
      } else if (kind === 'most-borrowed') {
        rows = (await c.query(
          `SELECT b.title AS title, b.author AS author, count(l.id)::int AS loans
             FROM library.loan l JOIN library.book b ON b.id=l.book_id
            WHERE l.tenant_id=$1 AND l.issued_at >= now() - ($2||' days')::interval
            GROUP BY b.title, b.author ORDER BY loans DESC LIMIT 500`, [t, String(days)])).rows;
      } else if (kind === 'dead-stock') {
        rows = (await c.query(
          `SELECT b.title AS title, b.author AS author, b.code AS book_code,
                  (SELECT count(*)::int FROM library.copy k WHERE k.tenant_id=b.tenant_id AND k.book_id=b.id) AS copies
             FROM library.book b WHERE b.tenant_id=$1 AND b.status <> 'retired'
              AND NOT EXISTS (SELECT 1 FROM library.loan l WHERE l.tenant_id=b.tenant_id AND l.book_id=b.id AND l.issued_at >= now() - interval '180 days')
            ORDER BY b.title LIMIT 5000`, [t])).rows;
      } else if (kind === 'inventory') {
        rows = (await c.query(
          `SELECT b.title AS title, k.copy_code AS copy_code, k.barcode AS barcode, k.accession_no AS accession_no,
                  k.status AS status, k.condition AS condition, k.acquired_on AS acquired_on
             FROM library.copy k JOIN library.book b ON b.id=k.book_id
            WHERE k.tenant_id=$1 ORDER BY b.title, k.copy_code LIMIT 5000`, [t])).rows;
      } else if (kind === 'acquisitions') {
        rows = (await c.query(
          `SELECT r.title AS title, r.author AS author, r.status AS status, r.vote_count AS votes,
                  r.vendor AS vendor, r.budget_code AS budget_code, r.cost_cents AS cost_cents,
                  r.created_at::date AS requested, r.decided_at::date AS decided,
                  r.ordered_at::date AS ordered, r.received_at::date AS received
             FROM library.acquisition_request r
            WHERE r.tenant_id=$1 ORDER BY r.created_at DESC LIMIT 5000`, [t])).rows;
      } else {
        return bad(reply, 'Report must be circulation, overdue, most-borrowed, dead-stock, inventory or acquisitions', 404);
      }
      if (!csv) return { kind, days, rows };
      const cols = rows.length ? Object.keys(rows[0]) : [];
      const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const body = [cols.join(','), ...rows.map((r) => cols.map((col) => esc(r[col])).join(','))].join('\n');
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="library-${kind}.csv"`);
      return reply.send(body);
    });
  });
}
