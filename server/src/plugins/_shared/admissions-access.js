// admissions.funnel — shared access tiers + stage lattice, ONE definition.
//
// Before this module the FULL_PII/ADMIN role lists were duplicated between the plugin
// (`admissions.funnel/index.js`) and the kernel follow-up queue (`routes.js`), and the
// stage lattice existed only inside the plugin. Three readers of one vocabulary is how a
// PII list drifts (a leak) and how a stage reader silently goes stale (the follow-up and
// BI defects). The plugin, the kernel route and ops.bi all import from here now.
//
// India-first lattice: enquiry → form → interaction → offer → enrolled, with a
// `waitlisted` holding state off `offer` (a real admissions need: offer made, seat
// pending) and terminal side exits `rejected` / `withdrawn`.
export const NEXT = {
  enquiry: ['form', 'rejected', 'withdrawn'],
  form: ['interaction', 'rejected', 'withdrawn'],
  interaction: ['offer', 'rejected', 'withdrawn'],
  offer: ['enrolled', 'waitlisted', 'rejected', 'withdrawn'],
  waitlisted: ['enrolled', 'rejected', 'withdrawn'],
};
export const TERMINAL = new Set(['enrolled', 'rejected', 'withdrawn']);
export const STAGES = [...Object.keys(NEXT), ...TERMINAL];

// Display/forward order (waitlisted sits between offer and enrolled for the cumulative
// funnel); terminal exits are rendered separately.
export const FORWARD = ['enquiry', 'form', 'interaction', 'offer', 'waitlisted', 'enrolled'];
export const EXITS = ['rejected', 'withdrawn'];

// Admissions office + governance see guardian contacts. Finance captures/moves leads but
// has no admissions need for the raw contact, so it stays masked (DPDP minimisation).
// The `admissions` role is the named desk for this domain and is included.
export const FULL_PII = ['owner', 'principal', 'itadmin', 'coordinator', 'admissions'];
// Roles that may capture, move, read history and read the summary.
export const ADMIN = ['owner', 'principal', 'itadmin', 'finance', 'coordinator', 'admissions'];

// Deterministic follow-up ranking (no model, pol_14): score = days-in-stage × weight.
// Later stages are closer to enrollment and more expensive to lose.
export const FOLLOWUP_WEIGHTS = { enquiry: 1, form: 1.2, interaction: 1.5, offer: 2.5, waitlisted: 2 };

// Class-applied normalisation (B-4): free text ("Grade 6", "Class 6", "6", "6-B")
// becomes a bare grade + section so a pupil never lands in grade "Grade 6".
// Shared by the kernel executor and the funnel capacity guard — one definition.
export function parseGradeApplied(s) {
  const raw = String(s ?? '').trim();
  const m = /^(\S+)-([A-Za-z0-9]+)$/.exec(raw);
  if (m) return { grade: m[1], section: m[2].toUpperCase() };
  const g = raw.replace(/^(grade|class)\s+/i, '').trim();
  return { grade: g || 'unassigned', section: 'A' };
}

// Stages that never rank / are never "open".
export const CLOSED_STAGES = ['enrolled', 'rejected', 'withdrawn'];
