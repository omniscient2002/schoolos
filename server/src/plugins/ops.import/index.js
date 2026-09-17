// ops.import — migration import engine (L3-4.1).
//
// WHAT LIVES HERE (engine, no domain writes):
//   · mappingSchema(kind)        — the canonical target column set per import kind
//   · validateMapping(kind, map) — source→target mapping validator
//   · validateRow(kind, map, row)— row-level coercion + per-field error collection
//   · shadowReport(c, tenantId, kind, map, rows) — shadow-load: validates every row,
//     computes aggregates and a DRY-RUN DIFF against real records; writes NOTHING.
//
// The kernel migration section (routes.js — L1-4.1) imports these functions for its
// staged-load/commit doors; the commit itself is kernel authority, never this plugin.
import { makeLifecycleGate } from '../_shared/lifecycle-gate.js';
import { registerSettingsFormDoors } from '../../settings-contract.js';

const ID = 'ops.import';
import manifestDef from './manifest.js';
export { default as manifest } from './manifest.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^[0-9+\-\s()]{6,24}$/;

/* ── the canonical target columns per import kind ─────────────────────────────── */
export function mappingSchema(kind) {
  switch (kind) {
    case 'students':
      return {
        kind,
        fields: {
          admission_no: { required: true, type: 'string', maxLen: 40, description: 'Unique in the file AND against school records (UNIQUE tenant+admission_no)' },
          name: { required: true, type: 'string', maxLen: 120 },
          grade: { required: true, type: 'string', maxLen: 16, examples: ['1', '8', 'LKG', 'UKG'] },
          section: { required: true, type: 'string', maxLen: 16, normalize: 'uppercase' },
          guardian_name: { required: false, type: 'string', maxLen: 120 },
          guardian_phone: { required: false, type: 'phone', maxLen: 24 },
          bus_route: { required: false, type: 'string', maxLen: 40 },
        },
        identity: 'admission_no',
        notes: ['status is fixed to active on import — lifecycle changes go through the lifecycle doors afterwards'],
      };
    case 'guardians':
      return {
        kind,
        fields: {
          student_admission_no: { required: true, type: 'string', maxLen: 40, description: 'Must resolve to a student imported in this run or already on record' },
          name: { required: true, type: 'string', maxLen: 120 },
          phone: { required: true, type: 'phone', maxLen: 24 },
          relation: { required: false, type: 'enum', enum: ['mother', 'father', 'guardian'], default: 'guardian' },
          is_primary: { required: false, type: 'boolean', default: false },
        },
        identity: 'student_admission_no + name + phone',
        notes: ['at most one primary guardian per student is enforced by the commit path, not here'],
      };
    case 'fees':
      return {
        kind,
        fields: {
          student_admission_no: { required: true, type: 'string', maxLen: 40 },
          term: { required: true, type: 'string', maxLen: 40, examples: ['term-1', 'term-2'] },
          label: { required: true, type: 'string', maxLen: 80 },
          due_on: { required: false, type: 'date' },
          amount_cents: { required: true, type: 'integer', min: 1, description: 'bigint paisa — ₹100.00 imports as 10000 (kernel money unit)' },
        },
        identity: 'student_admission_no + term + label',
        notes: ['the kernel enforces one open payment per obligation; amounts are clamped there'],
      };
    default:
      return null;
  }
}
export const IMPORT_KINDS = ['students', 'guardians', 'fees'];

/* ── mapping validator: source columns → canonical target fields ───────────────── */
export function validateMapping(kind, mapping) {
  const schema = mappingSchema(kind);
  if (!schema) return { ok: false, errors: [{ field: null, error: `unknown import kind "${kind}" — use one of: ${IMPORT_KINDS.join(', ')}` }] };
  const errors = [];
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    return { ok: false, errors: [{ field: null, error: 'mapping must be an object {sourceColumn: targetField}' }] };
  }
  const targetBySource = new Map();
  const seenTargets = new Map();
  for (const [src, target] of Object.entries(mapping)) {
    const s = String(src).trim();
    const t = String(target ?? '').trim();
    if (!s) { errors.push({ field: t || null, error: 'a mapping entry has an empty source column' }); continue; }
    if (targetBySource.has(s)) errors.push({ field: t, error: `source column "${s}" is mapped twice` });
    targetBySource.set(s, t);
    if (t && !schema.fields[t]) errors.push({ field: t, error: `"${t}" is not a ${kind} field — valid: ${Object.keys(schema.fields).join(', ')}` });
    if (t && seenTargets.has(t)) errors.push({ field: t, error: `target field "${t}" is mapped from two sources (${seenTargets.get(t)} and "${s}")` });
    if (t) seenTargets.set(t, s);
  }
  for (const [field, def] of Object.entries(schema.fields)) {
    if (def.required && !seenTargets.has(field)) errors.push({ field, error: `required field "${field}" has no source column mapped` });
  }
  return { ok: errors.length === 0, errors, schema: Object.keys(schema.fields) };
}

/* ── row-level validation + coercion (collects every field's problems per row) ─── */
export function validateRow(kind, mapping, row) {
  const schema = mappingSchema(kind);
  const out = { values: {}, errors: [] };
  if (!row || typeof row !== 'object') { out.errors.push({ field: null, error: 'row must be an object' }); return out; }
  const byTarget = new Map(Object.entries(mapping).map(([src, tgt]) => [String(tgt), String(src)]));
  for (const [field, def] of Object.entries(schema.fields)) {
    const src = byTarget.get(field);
    if (src === undefined) {
      if (def.required) out.errors.push({ field, error: 'required (no source column mapped)' });
      else if (def.default !== undefined) out.values[field] = def.default;
      continue;
    }
    let v = row[src];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      if (def.required) out.errors.push({ field, error: 'required (value missing)' });
      else if (def.default !== undefined) out.values[field] = def.default;
      continue;
    }
    v = String(v).trim();
    if (def.normalize === 'uppercase') v = v.toUpperCase();
    if (def.maxLen && v.length > def.maxLen) { out.errors.push({ field, error: `keep it under ${def.maxLen} characters` }); continue; }
    if (def.type === 'phone' && !PHONE_RE.test(v)) { out.errors.push({ field, error: 'not a readable phone number (digits, spaces, + - ( ))' }); continue; }
    if (def.type === 'enum' && !def.enum.includes(v)) { out.errors.push({ field, error: `must be one of: ${def.enum.join(', ')}` }); continue; }
    if (def.type === 'date' && !DATE_RE.test(v)) { out.errors.push({ field, error: 'date must look like 2026-04-01' }); continue; }
    if (def.type === 'integer') {
      const n = Number(v);
      if (!Number.isInteger(n) || (def.min != null && n < def.min)) { out.errors.push({ field, error: `must be a whole number${def.min != null ? ` of at least ${def.min}` : ''}` }); continue; }
      out.values[field] = n;
      continue;
    }
    out.values[field] = v;
  }
  return out;
}

/* ── shadow-load: validate everything, diff against real records, write NOTHING ── */
export async function shadowReport(c, tenantId, kind, mapping, rows, caps = {}) {
  const maxRows = Math.max(100, Math.min(20000, Number(caps.maxRows ?? 5000)));
  const report = {
    kind, totalRows: rows.length, analyzed: Math.min(rows.length, maxRows), truncated: rows.length > maxRows,
    validRows: 0, errorRows: 0, fieldErrors: 0, topErrors: [],
    diff: null,
  };
  const errCount = new Map();
  const valid = [];
  for (let i = 0; i < report.analyzed; i++) {
    const r = validateRow(kind, mapping, rows[i]);
    if (r.errors.length) {
      report.errorRows++;
      report.fieldErrors += r.errors.length;
      for (const e of r.errors) errCount.set(e.error, (errCount.get(e.error) ?? 0) + 1);
      continue;
    }
    report.validRows++;
    valid.push({ row: i, ...r.values });
  }
  report.topErrors = [...errCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([error, n]) => ({ error, rows: n }));

  if (kind === 'students' && valid.length) {
    const nos = valid.map((v) => v.admission_no);
    const dupInFile = nos.filter((n, i) => nos.indexOf(n) !== i);
    const existing = (await c.query(
      `SELECT admission_no FROM app.students WHERE tenant_id=$1 AND admission_no = ANY($2::text[])`,
      [tenantId, nos])).rows.map((r) => r.admission_no);
    const grades = {};
    for (const v of valid) {
      const key = `${v.grade}-${v.section}`;
      grades[key] = (grades[key] ?? 0) + 1;
    }
    report.diff = {
      newStudents: valid.filter((v) => !existing.includes(v.admission_no)).length,
      collisionsWithRecords: existing.length,
      duplicatesInFile: [...new Set(dupInFile)],
      classDistribution: Object.fromEntries(Object.entries(grades).sort(([a], [b]) => (a.length - b.length) || (a < b ? -1 : 1))),
      wouldWrite: 'app.students (+ app.guardians when guardian_name/phone present)',
    };
  } else if (kind === 'guardians' && valid.length) {
    const nos = valid.map((v) => v.student_admission_no);
    const resolved = (await c.query(
      `SELECT admission_no FROM app.students WHERE tenant_id=$1 AND admission_no = ANY($2::text[])`,
      [tenantId, nos])).rows.map((r) => r.admission_no);
    const unresolved = valid.filter((v) => !resolved.includes(v.student_admission_no));
    report.diff = {
      studentsResolved: new Set(resolved).size,
      rowsWithUnresolvedStudent: unresolved.length,
      primaryGuardiansRequested: valid.filter((v) => v.is_primary === true).length,
      wouldWrite: 'app.guardians',
    };
  } else if (kind === 'fees' && valid.length) {
    const nos = valid.map((v) => v.student_admission_no);
    const resolved = new Set((await c.query(
      `SELECT admission_no FROM app.students WHERE tenant_id=$1 AND admission_no = ANY($2::text[])`,
      [tenantId, nos])).rows.map((r) => r.admission_no));
    const totalCents = valid.reduce((a, v) => a + v.amount_cents, 0);
    const byTerm = {};
    for (const v of valid) byTerm[v.term] = (byTerm[v.term] ?? 0) + v.amount_cents;
    const unresolved = valid.filter((v) => !resolved.has(v.student_admission_no));
    const unresolvedCents = unresolved.reduce((a, v) => a + v.amount_cents, 0);
    report.diff = {
      rowsResolved: valid.length - unresolved.length,
      rowsWithUnresolvedStudent: unresolved.length,
      unresolvedAmountCents: unresolvedCents,
      totalAmountCents: totalCents,
      byTermCents: byTerm,
      wouldWrite: 'app.fee_obligations (status draft — the kernel fee engine owns the rest)',
    };
  } else if (!valid.length) {
    report.diff = { note: 'no valid rows to diff' };
  }
  return report;
}

export function register(app, kernel) {
  registerSettingsFormDoors(app, kernel, ID, manifestDef);
  const { withUser, requestAudit, require, sysq } = kernel;
  const lifecycleGate = makeLifecycleGate(sysq, ID);
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  // canonical mapping schema per kind (drives the mapping UI)
  app.get('/plugins/ops.import/schema/:kind', { preHandler: [require('owner', 'principal', 'coordinator', 'itadmin', 'admissions'), lifecycleGate] }, async (req, reply) => {
    const schema = mappingSchema(req.params.kind);
    if (!schema) return bad(reply, `unknown import kind "${req.params.kind}" — use one of: ${IMPORT_KINDS.join(', ')}`, 404);
    return { schema, kinds: IMPORT_KINDS };
  });

  // validate a proposed mapping before any row is read
  app.post('/plugins/ops.import/validate-mapping', { preHandler: [require('owner', 'principal', 'coordinator', 'itadmin', 'admissions'), lifecycleGate] }, async (req, reply) => {
    const { kind, mapping } = req.body ?? {};
    const result = validateMapping(kind, mapping);
    return result.ok ? { ok: true, schema: result.schema } : reply.code(400).send({ ok: false, errors: result.errors });
  });

  // shadow-load: staged analysis, zero domain writes (Migration §1.1)
  app.post('/plugins/ops.import/shadow', { preHandler: [require('owner', 'principal', 'coordinator', 'itadmin'), lifecycleGate] }, async (req, reply) => {
    const { kind, mapping, rows } = req.body ?? {};
    if (!Array.isArray(rows)) return bad(reply, 'rows must be an array of objects');
    const mapCheck = validateMapping(kind, mapping);
    if (!mapCheck.ok) return reply.code(400).send({ ok: false, errors: mapCheck.errors });
    return withUser(req.user.tenant_id, req.user.role, async (c) => {
      const report = await shadowReport(c, req.user.tenant_id, kind, mapping, rows);
      await emitEventSafe(kernel, c, req.user.tenant_id, report);
      await requestAudit(c, req.user.tenant_id, ID, {
        actor: req.user.name, action: 'Import shadow-run analyzed', recordType: 'Migration', recordRef: kind,
        reason: 'dry-run before commit', policyRef: 'Migration §1.1 (staged before committed)', risk: 'low',
        outcome: `${report.validRows}/${report.totalRows} rows valid · ${report.errorRows} error rows · diff: ${report.diff ? JSON.stringify(report.diff).slice(0, 120) : 'n/a'}` });
      return { ok: true, ...report };
    });
  });
}

async function emitEventSafe(kernel, c, tenantId, report) {
  try {
    const { emitEvent } = kernel;
    if (emitEvent) await emitEvent(c, tenantId,
      { type: 'ops', label: `Import shadow-run: ${report.validRows}/${report.totalRows} valid (${report.kind})` },
      'ops.import.shadow.completed', { kind: report.kind, valid: report.validRows, errors: report.errorRows });
  } catch { /* event spine is best-effort for read-only previews */ }
}
