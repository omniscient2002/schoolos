// _shared/enrolment.js — the pupil-record rules three doors must answer identically.
//
// WHY A SHARED MODULE. Date of birth and gender are collected by three lanes: the manual admission
// form (POST /students), the roster spreadsheet (POST /plugins/people.admin/import/students) and the
// record edit (PATCH /plugins/people.admin/students/:id). They each validate inline, which is how
// they drift apart — a spreadsheet that imports a date the form would refuse is exactly the kind of
// split this product's own audits keep finding. One parser, three call sites.
//
// It lives in `_shared/` rather than in `routes.js` because a plugin importing the kernel's route
// module is a cycle (routes.js → plugin loader → this plugin), and a cycle is not worth one regex.
// The database constraints in migration 140 are the backstop; these are the friendly 400 in front.

/** A date of birth that a school can actually record. Optional, but never nonsense. */
export const parseDob = (v) => {
  if (v == null || v === '') return { ok: true, value: null };
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, error: 'Date of birth must be written as YYYY-MM-DD' };
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'That date of birth is not a real date' };
  if (d >= new Date()) return { ok: false, error: 'Date of birth must be in the past' };
  if (d < new Date('1900-01-01T00:00:00Z')) return { ok: false, error: 'Date of birth looks wrong — please check it' };
  return { ok: true, value: s };
};

/** The register's own vocabulary — the same three values migration 140's CHECK accepts. */
export const ENROLMENT_GENDERS = ['female', 'male', 'other'];

export const parseGender = (v) => {
  if (v == null || v === '') return { ok: true, value: null };
  const g = String(v).trim().toLowerCase();
  return ENROLMENT_GENDERS.includes(g)
    ? { ok: true, value: g }
    : { ok: false, error: `Gender must be one of: ${ENROLMENT_GENDERS.join(', ')}` };
};