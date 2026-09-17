// files.store — runtime module (migration 048, Wave B unit 3). Class B: private
// file storage. docs/DATA-FLOW §14: "NOT IMPLEMENTED as storage — no upload endpoint,
// no object storage, no multipart parser, no size/type controls". This unit closes it.
//
// Design invariants:
//   · BYTES ARE NEVER WEB-SERVED — files land under FILES_DIR (default
//     <repo>/server/storage/<tenant_id>/) with a SERVER-SIDE uuid name; the original
//     client filename rides the metadata row only. There is no static route: every
//     read goes through the download door's access check. storage_path is stored
//     RELATIVE to the base, so the tree can move without rewriting rows.
//   · UPLOAD CONTRACT (decision, per the Wave B brief's escape hatch): the primary
//     payload lane is JSON base64 — {filename, mime, dataBase64, scope?, refId?}.
//     It is simpler and fully covered by the existing JSON pipeline + route-level
//     bodyLimit (no streaming parser on the root instance), and the Wave B test
//     contract exercises exactly this lane. Multipart/form-data is ALSO accepted on
//     the same door (parser mounted from people.admin's register(), guarded by the
//     shared process symbol so it can never double-mount) for API parity. Both lanes
//     run through the identical validation + storage path.
//   · VALIDATION — 5MB cap; mime whitelist (pdf, png, jpeg, webp, csv, docx) AND
//     extension agreement (a .exe dressed as mime application/pdf, or a .pdf whose
//     mime is application/x-msdownload, is refused 415); sha256 over the exact bytes.
//   · ACCESS — uploader + owner/principal/itadmin always; scope=student additionally
//     admits that child's guardians (family.child_link, 034 bridge) and the student
//     themself (036 name-match identity pin); everything else is 403, fail-closed.
//     Downloads are audited (risk low). Metadata list carries no bytes.
//   · metadata is append-only through the app role (migration 048 grants).
//   · every write emits an event + requestAudit inside the withUser transaction;
//     uniform lifecycle gate on every door (P2-1 posture). All preHandlers async.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uuidParams } from '../_shared/uuid-param.js';
import multipart from '@fastify/multipart';
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { canReach } from '../../custom-roles.js';

const ID = 'files.store';
// shared mount guard with people.admin (both Wave B plugins want the multipart
// parser on the root instance; exactly one registration per instance, no matter
// the loader's directory order). files.store loads first (alphabetical) so its
// 5MB limit is the one that lands; the CSV lane's smaller cap is enforced in code.
const MULTIPART_MOUNTED = Symbol.for('schoolos.multipart.mounted');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
// ext → mime agreement table: BOTH the extension and the mime must be whitelisted
// AND they must agree (extension dressing is the classic upload-bypass).
const ALLOWED = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const SCOPES = ['general', 'homework', 'student'];
const DOWNLOAD_ADMINS = ['owner', 'principal', 'itadmin'];
// upload staff per the Wave B brief (no parent/student on uploads — the school office
// and teachers publish; families and students only ever read what is granted to them)
const UPLOAD_STAFF = ['owner', 'principal', 'coordinator', 'teacher', 'itadmin', 'facilities'];

// <repo>/server — the default storage base lives beside the code that owns it
const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const storageBase = () => process.env.FILES_DIR ?? join(SERVER_DIR, 'storage');

const safeFilename = (raw) => {
  const base = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f"\\]/g, '').trim();
  return cleaned.slice(0, 200);
};
const extOf = (name) => {
  const m = /\.([a-z0-9]+)$/i.exec(String(name ?? ''));
  return m ? m[1].toLowerCase() : '';
};

export function register(app, kernel) {
  const { withUser, requestAudit, emitEvent, require, sysq } = kernel;

  const lifecycleGate = makeLifecycleGate(sysq, ID);
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  // root-instance multipart registration (payments.upi content-parser precedent),
  // mount-guarded so people.admin's own attempt (if it loaded first) is a no-op.
  if (!app[MULTIPART_MOUNTED]) {
    app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 }, attachFieldsToBody: false });
    app[MULTIPART_MOUNTED] = true;
  }

  // ── shared validation + storage (both payload lanes land here) ─────────────
  const store = async (c, tenantId, user, { filename, mime, buf, scope, refId }) => {
    const clean = safeFilename(filename);
    const ext = extOf(clean);
    if (!clean || !ext) return { error: ['Name the file with its extension (e.g. worksheet.pdf)', 400] };
    const allowedMime = ALLOWED[ext];
    if (!allowedMime) return { error: ['That file type isn\'t allowed — accepted: PDF, PNG, JPEG, WebP, CSV, DOCX', 415] };
    if (!mime || !Object.values(ALLOWED).includes(String(mime).toLowerCase()))
      return { error: ['That file type isn\'t allowed — accepted: PDF, PNG, JPEG, WebP, CSV, DOCX', 415] };
    if (allowedMime !== String(mime).toLowerCase())
      return { error: ['The file\'s extension and content type don\'t match — rename it or re-export it', 415] };
    if (!buf?.length) return { error: ['That file is empty', 400] };
    if (buf.length > MAX_BYTES) return { error: ['That file is too large — the limit is 5MB', 413] };
    if (!SCOPES.includes(scope)) return { error: ['Scope must be general, homework or student', 400] };

    if (refId && !UUID_RE.test(String(refId))) return { error: ['That reference id is not a valid id', 400] };
    let resolvedRef = null;
    if (scope === 'student') {
      if (!refId) return { error: ['A student file needs the student it belongs to (refId)', 400] };
      const st = (await c.query(`SELECT id FROM app.students WHERE id=$1 AND tenant_id=$2`, [refId, tenantId])).rows[0];
      if (!st) return { error: ['That student is not in this school\'s roster', 404] };
      resolvedRef = st.id;
    } else if (scope === 'homework' && refId) {
      // homework plane (031) may be absent — probe before trusting the ref (student.world degrade pattern)
      const hw = (await c.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='teacher' AND table_name='homework'`)).rows[0]
        ? (await c.query(`SELECT id FROM teacher.homework WHERE id=$1 AND tenant_id=$2`, [refId, tenantId])).rows[0]
        : null;
      if (!hw) return { error: ['That homework reference doesn\'t exist', 404] };
      resolvedRef = refId;
    }

    // server-side uuid name; RELATIVE path (<tenant>/<uuid>.<ext>) under the base
    const dir = join(storageBase(), tenantId);
    const diskName = `${randomUUID()}.${ext}`;
    const relPath = `${tenantId}/${diskName}`;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, diskName), buf);
    const sha256 = createHash('sha256').update(buf).digest('hex');

    const row = (await c.query(
      `INSERT INTO app.files (tenant_id, uploader_id, filename, mime, bytes, sha256, storage_path, scope, ref_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, filename, mime, bytes, sha256, storage_path, scope, ref_id, created_at`,
      [tenantId, user.id, clean, String(mime).toLowerCase(), buf.length, sha256, relPath, scope, resolvedRef])).rows[0];
    return { row };
  };

  // ── upload (staff) — multipart/form-data OR JSON base64 on one door ─────────
  app.post(`/plugins/${ID}/upload`, { bodyLimit: 8 * 1024 * 1024, preHandler: [require(...UPLOAD_STAFF), lifecycleGate] }, async (req, reply) => {
    const isMultipart = String(req.headers['content-type'] ?? '').toLowerCase().startsWith('multipart/form-data');
    if (isMultipart) {
      if (typeof req.file !== 'function') {
        return bad(reply, 'Multipart uploads aren\'t available on this server — send JSON {filename, mime, dataBase64} instead', 415);
      }
      const fields = {};
      let filePart = null;
      for await (const part of req.parts({ limits: { fileSize: MAX_BYTES, files: 1 } })) {
        if (part.type === 'file') { if (!filePart) filePart = part; continue; }
        fields[part.fieldname] = part.value;
      }
      if (!filePart) return bad(reply, 'No file was attached');
      if (filePart.file?.truncated) return bad(reply, 'That file is too large — the limit is 5MB', 413);
      const chunks = []; let total = 0;
      for await (const chunk of filePart.file) {
        total += chunk.length;
        if (total > MAX_BYTES) return bad(reply, 'That file is too large — the limit is 5MB', 413);
        chunks.push(chunk);
      }
      if (filePart.file?.truncated) return bad(reply, 'That file is too large — the limit is 5MB', 413);
      const buf = Buffer.concat(chunks);
      return withUser(req.user.tenant_id, req.user.role, async (c) => {
        const r = await store(c, req.user.tenant_id, req.user, {
          filename: filePart.filename ?? fields.filename, mime: filePart.mimetype ?? fields.mime, buf,
          scope: fields.scope ?? 'general', refId: fields.refId || null });
        if (r.error) return bad(reply, r.error[0], r.error[1]);
        await emitEvent(c, req.user.tenant_id,
          { type: 'files', label: `File stored: ${r.row.filename} (${r.row.scope})`, ref: r.row.id },
          'files.stored.v1', { fileId: r.row.id, scope: r.row.scope, refId: r.row.ref_id, bytes: r.row.bytes });
        await requestAudit(c, req.user.tenant_id, ID, {
          actor: req.user.name, action: 'File uploaded', recordType: 'File', recordRef: r.row.id,
          reason: `scope ${r.row.scope}${r.row.ref_id ? ' · ref ' + r.row.ref_id : ''}`,
          policyRef: 'Platform §2.4 · DPDP data minimisation', risk: 'low',
          outcome: `${r.row.bytes} bytes · sha256 ${r.row.sha256.slice(0, 12)}… · stored off the web path` });
        return { ok: true, file: { id: r.row.id, filename: r.row.filename, mime: r.row.mime, bytes: r.row.bytes, sha256: r.row.sha256, scope: r.row.scope, refId: r.row.ref_id, createdAt: r.row.created_at } };
      });
    }

    // JSON base64 lane (primary — see header decision note)
    const b = req.body ?? {};
    if (!b.filename || !b.mime || !b.dataBase64) return bad(reply, 'Send {filename, mime, dataBase64} (optionally scope and refId)');
    if (b.scope != null && !SCOPES.includes(b.scope)) return bad(reply, 'Scope must be general, homework or student');
    let buf;
    try { buf = Buffer.from(String(b.dataBase64), 'base64'); } catch { return bad(reply, 'The file data isn\'t valid base64'); }
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const r = await store(c, req.user.tenant_id, req.user, {
        filename: b.filename, mime: b.mime, buf,
        scope: SCOPES.includes(b.scope) ? b.scope : 'general', refId: b.refId || null });
      if (r.error) return bad(reply, r.error[0], r.error[1]);
      await emitEvent(c, req.user.tenant_id,
        { type: 'files', label: `File stored: ${r.row.filename} (${r.row.scope})`, ref: r.row.id },
        'files.stored.v1', { fileId: r.row.id, scope: r.row.scope, refId: r.row.ref_id, bytes: r.row.bytes });
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'File uploaded', recordType: 'File', recordRef: r.row.id,
        reason: `scope ${r.row.scope}${r.row.ref_id ? ' · ref ' + r.row.ref_id : ''}`,
        policyRef: 'Platform §2.4 · DPDP data minimisation', risk: 'low',
        outcome: `${r.row.bytes} bytes · sha256 ${r.row.sha256.slice(0, 12)}… · stored off the web path` });
      return { ok: true, file: { id: r.row.id, filename: r.row.filename, mime: r.row.mime, bytes: r.row.bytes, sha256: r.row.sha256, scope: r.row.scope, refId: r.row.ref_id, createdAt: r.row.created_at } };
    });
  });

  // ── download (uploader / admin / scope=student guardians & the student) ─────
  app.get(`/plugins/${ID}/:id/download`,
    { preHandler: [require(...UPLOAD_STAFF, 'parent', 'student'), uuidParams('id'), lifecycleGate] },
    async (req, reply) => {
      // audit-before-send contract: the ledger row (downloaded OR refused) must
      // COMMIT before the response is transmitted. The previous shape returned
      // bad() from inside the withUser transaction — Fastify sends at the first
      // await, so the 403 raced (and beat) its own COMMIT and an immediate ledger
      // read could not see the refusal row.
      const verdict = await withUser(req.user.tenant_id, req.user.role, async (c) => {
        const row = (await c.query(`SELECT id, filename, mime, bytes, storage_path, scope, ref_id, uploader_id FROM app.files WHERE id=$1`,
          [req.params.id])).rows[0];
        if (!row) return { refused: 404, msg: 'We couldn\'t find that file' };
        // ── scoped access decision (fail-closed) ────────────────────────────
        const isUploader = row.uploader_id === req.user.id;
        // RBAC-1: a custom role granted this download door is an admin FOR THIS DOOR (permission, not
        // scope). The `scoped` decision further down is deliberately NOT lifted — see 270.
        const isAdmin = canReach(req, [...DOWNLOAD_ADMINS]);
        let allowed = isUploader || isAdmin;
        if (!allowed && row.scope === 'student') {
          if (req.user.role === 'parent') {
            // Guardian access is structural only. A display-name match is not
            // an identity proof and can collide with another family.
            allowed = !!(await c.query(
              `SELECT 1 FROM family.child_link cl WHERE cl.tenant_id=$1 AND cl.user_id=$2 AND cl.student_id=$3 LIMIT 1`,
              [req.user.tenant_id, req.user.id, row.ref_id])).rows[0];
          }
          // PLGX-4: the `student` name-match fallback is DELETED. A display-name equality is not an
          // identity proof (375 students / 76 distinct names in a seeded school), and it is exactly the
          // DOT-22 anti-pattern. A student may still download a file they uploaded themselves (isUploader
          // above); a structural user↔student link is Phase 2. Refusing is the honest position until then.
        }
        if (!allowed) {
          await requestAudit(c, req.user.tenant_id, ID, {
            actor: req.user.name, action: 'File download refused', recordType: 'File', recordRef: row.id,
            reason: `scope ${row.scope}`, policyRef: 'Platform §2.4 · DPDP data minimisation', risk: 'medium',
            outcome: 'access denied — outside the scope policy (audited refusal)' });
          return { refused: 403, msg: 'You don\'t have access to this file' };
        }
        await requestAudit(c, req.user.tenant_id, ID, {
          actor: req.user.name, action: 'File downloaded', recordType: 'File', recordRef: row.id,
          reason: `scope ${row.scope}${row.ref_id ? ' · ref ' + row.ref_id : ''}`,
          policyRef: 'Platform §2.4 · DPDP data minimisation', risk: 'low',
          outcome: `${row.filename} (${row.bytes} bytes) served through the door` });
        return { ok: true, row };
      });
      if (verdict.ok !== true) return bad(reply, verdict.msg, verdict.refused); // sent AFTER the audit tx commits
      const row = verdict.row;
      // stream AFTER the audit transaction commits; bytes never ride a web path
      if (row.storage_path.includes('..') || row.storage_path.startsWith('/')) return bad(reply, 'That file reference is invalid', 400);
      const path = join(storageBase(), row.storage_path);
      const st = await stat(path).catch(() => null);
      if (!st) return bad(reply, 'The file is no longer available on this server', 410);
      const safe = safeFilename(row.filename);
      reply.header('content-type', row.mime);
      reply.header('content-length', String(st.size));
      reply.header('content-disposition', `attachment; filename="${safe.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(safe)}`);
      reply.header('cache-control', 'no-store');
      return reply.send(createReadStream(path));
    });

  // ── list metadata (staff) — no bytes, ever ─────────────────────────────────
  app.get(`/plugins/${ID}`, { preHandler: [require(...UPLOAD_STAFF), lifecycleGate] }, async (req, reply) => {
    const scope = typeof req.query?.scope === 'string' && SCOPES.includes(req.query.scope) ? req.query.scope : null;
    // PLGX: refId was interpolated into `$2::uuid` raw, so `?refId=abc` was a 22P02 → 500. Validate.
    const refId = typeof req.query?.refId === 'string' && req.query.refId ? req.query.refId : null;
    if (refId && !UUID_RE.test(refId)) return bad(reply, 'refId must be a uuid');
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      // privacy pin: non-admin staff see only what they uploaded; admins see the tenant
      const scoped = DOWNLOAD_ADMINS.includes(req.user.role);
      const rows = (await c.query(
        `SELECT id, filename, mime, bytes, sha256, scope, ref_id, created_at
         FROM app.files
         WHERE ($1::text IS NULL OR scope=$1::text)
           AND ($2::uuid IS NULL OR ref_id=$2::uuid)
           AND ($3 OR uploader_id=$4)
         ORDER BY created_at DESC LIMIT 300`,
        [scope, refId, scoped, req.user.id])).rows;
      return { files: rows.map((r) => ({
        id: r.id, filename: r.filename, mime: r.mime, bytes: r.bytes, sha256: r.sha256,
        scope: r.scope, refId: r.ref_id, createdAt: r.created_at,
      })) };
    });
  });
}
