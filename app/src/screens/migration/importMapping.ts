/* ============================================================
   Import mapping — pure helpers, no React and no fetch, so the
   server suite can pin them (node strips the types natively; the
   precedent is server/tests/frontend-grants.test.js importing
   app/src/lib/grants.ts).

   WHAT THIS IS. The kernel's migration commit doors are the only
   authority that creates records. Before a file reaches them it has
   to be understood: which spreadsheet column is the admission
   number, which is the class, and what would happen if it committed.
   `ops.import` owns that understanding server-side (mappingSchema /
   validateMapping / shadowReport); this module is the browser half —
   parse the file, guess the mapping, and hand the rows over in the
   canonical staged shape the commit door already accepts.
   ============================================================ */

/** One parsed file: the header row's column names, and rows keyed BY THOSE NAMES.
 *  The server's validateRow looks a row up by source column, so the keys here
 *  must stay the file's own spelling — the mapping, not the parser, translates. */
export interface ParsedFile {
  columns: string[];
  rows: Record<string, string>[];
  /** Lines the parser refused (unterminated quote, ragged row). Surfaced, never hidden. */
  skipped: number;
}

/** RFC4180-ish: quoted fields, "" escapes, CRLF or LF. A short file, parsed in the
 *  browser so the raw text never has to be pasted into a JSON box by hand. */
export function parseCsv(text: string): ParsedFile {
  const src = String(text ?? '').replace(/^﻿/, '');
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  let i = 0;
  const pushField = () => { record.push(field); field = ''; };
  const pushRecord = () => { pushField(); if (record.length > 1 || record[0] !== '') records.push(record); record = []; };

  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i += 1; continue; }
    if (ch === ',') { pushField(); i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { pushRecord(); i += 1; continue; }
    field += ch; i += 1;
  }
  if (field !== '' || record.length) pushRecord();

  const header = (records.shift() ?? []).map(h => h.trim());
  const columns: string[] = [];
  header.forEach((h, idx) => { columns.push(h || `column_${idx + 1}`); });
  const seen = new Map<string, number>();
  for (const c of columns) seen.set(c, (seen.get(c) ?? 0) + 1);
  const dupe = (c: string) => (seen.get(c) ?? 0) > 1;

  const rows: Record<string, string>[] = [];
  let skipped = 0;
  for (const r of records) {
    if (r.length === 1 && r[0].trim() === '') continue;
    /* A short row is padded and a long row is cut: the server reports the real
       per-field problems, and a ragged file must not silently lose its tail. */
    if (r.length !== columns.length) skipped += 1;
    const o: Record<string, string> = {};
    columns.forEach((c, idx) => {
      if (dupe(c)) return;   // ambiguous header — the server rejects a doubled source column
      o[c] = (r[idx] ?? '').trim();
    });
    rows.push(o);
  }
  return { columns, rows, skipped };
}

/** Header text reduced to something comparable: "Admission No." ≡ "admission_no" ≡ "admissionno". */
export function normalizeHeader(h: string): string {
  return String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** What a real school spreadsheet actually calls each field. A GUESS, and only a guess: the server's
 *  validateMapping is the authority, and the operator can change every one of these in the picker.
 *  Deliberately absent — anything about money. A header called "Amount" is never mapped to
 *  `amount_cents` on the client's initiative, because the file's unit (rupees vs paisa) is exactly the
 *  thing a guess would get wrong and a school would not notice. */
const SYNONYMS: Record<string, string[]> = {
  admission_no: ['admno', 'admnumber', 'admissionno', 'admissionnumber', 'rollno', 'rollnumber', 'regno', 'registrationno', 'srno', 'serialnumber', 'studentid', 'uid'],
  name: ['name', 'studentname', 'fullname', 'pupilname', 'childname', 'nameofstudent', 'nameofpupil'],
  grade: ['grade', 'class', 'classname', 'standard', 'std', 'classgrade'],
  section: ['section', 'sec', 'sect', 'classsection', 'division', 'div'],
  guardian_name: ['guardianname', 'guardian', 'fathername', 'father', 'mothername', 'mother', 'parentname', 'parent'],
  guardian_phone: ['guardianphone', 'phone', 'phoneno', 'mobile', 'mobileno', 'mobilenumber', 'contactno', 'contactnumber', 'fathermobile', 'whatsapp'],
  bus_route: ['busroute', 'route', 'routeno', 'busno', 'busnumber', 'transport'],
  student_admission_no: ['admno', 'admnumber', 'admissionno', 'admissionnumber', 'rollno', 'rollnumber', 'studentid', 'uid'],
  term: ['term', 'termno', 'instalment', 'installment', 'instalmentno'],
  label: ['label', 'feehead', 'feename', 'particulars', 'particular', 'description', 'feetype'],
  due_on: ['dueon', 'duedate', 'due'],
};

/** Guess {sourceColumn: targetField} from the header. Exact normalized match wins, then a synonym,
 *  then a contains-either-way match, then a shared first letter — in that order, and never two sources
 *  onto one target (the server refuses that, so the guess must not propose it). */
export function guessMapping(columns: string[], fields: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const taken = new Set<string>();
  const score = (col: string, field: string): number => {
    const c = normalizeHeader(col);
    const f = normalizeHeader(field);
    if (!c || !f) return 0;
    if (c === f) return 100;
    if ((SYNONYMS[field] ?? []).includes(c)) return 90;
    if (c.includes(f) || f.includes(c)) return 60;
    return c[0] === f[0] ? 30 : 0;
  };
  for (const exact of [true, false]) {
    for (const field of fields) {
      if (taken.has(field)) continue;
      let best: { col: string; s: number } | null = null;
      for (const col of columns) {
        if (col in mapping) continue;
        const s = score(col, field);
        if (!s) continue;
        if (exact && s < 90) continue;
        if (!best || s > best.s) best = { col, s };
      }
      if (best) { mapping[best.col] = field; taken.add(field); }
    }
  }
  return mapping;
}

/* The kernel's staged row shape (routes.js migValidateRow). ops.import validates in the
   file's own snake_case vocabulary, so the translation happens exactly here, once. */
const STAGED_KEYS: Record<string, string> = {
  admission_no: 'admissionNo',
  name: 'name',
  grade: 'grade',
  section: 'section',
  guardian_name: 'guardianName',
  guardian_phone: 'guardianPhone',
  bus_route: 'busRoute',
};

/** Mapped file rows → the staged payload the commit door validates and writes.
 *  Values the file did not supply are omitted, never sent as "" — the server treats a
 *  blank required value as an error and a blank optional one as absent. */
export function toStagedRows(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
): { rowNo: number; data: Record<string, unknown> }[] {
  const byTarget = new Map<string, string>();
  for (const [src, tgt] of Object.entries(mapping)) if (tgt) byTarget.set(tgt, src);
  return rows.map((row, i) => {
    const data: Record<string, unknown> = {};
    for (const [field, stagedKey] of Object.entries(STAGED_KEYS)) {
      const src = byTarget.get(field);
      if (src === undefined) continue;
      const v = String(row[src] ?? '').trim();
      if (v) data[stagedKey] = v;
    }
    return { rowNo: i + 1, data };
  });
}

/** A one-line description of a field, for the mapping table: what it wants and what it is for. */
export function describeField(def: { type?: string; description?: string; examples?: string[]; enum?: string[] }): string {
  if (def.description) return def.description;
  if (def.enum) return `one of: ${def.enum.join(', ')}`;
  if (def.examples?.length) return `e.g. ${def.examples.join(', ')}`;
  return def.type ?? '';
}
