// _shared/exam-report.js — the ONE exam read model (F1).
//
// The audit found the parent doors served the FROZEN snapshot while the staff report door served the
// latest APPROVED moderation overlay, so a moderated result (90 · A2) read as the pre-moderation
// 57 · C1 to the family. Moderation is meant to supersede the frozen snapshot, so both planes must
// serve the same thing. This module is that single implementation: `gradeOf` is the deterministic
// scale function and `servedReport` applies the overlay with the read-path defense (an absurd stored
// pct is never served — the grade is re-derived and bounds are checked on the way out).

// deterministic CBSE 10-point scale (pure function, no Date/random anywhere)
export const CBSE_10 = [
  [91, 'A1', 10], [81, 'A2', 9], [71, 'B1', 8], [61, 'B2', 7],
  [51, 'C1', 6], [41, 'C2', 5], [33, 'D', 4], [0, 'E', 0],
];

export const gradeOf = (pct, scale) => {
  if (scale === 'percent') return { grade: null, points: null, pct };
  if (scale === 'gpa_4') {
    const g = pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'F';
    return { grade: g, points: null, pct };
  }
  const row = CBSE_10.find(([min]) => pct >= min);
  return { grade: row[1], points: row[2], pct };
};

/**
 * The one read model: an approved moderation overlay supersedes the frozen snapshot.
 *
 * `report`     — the plugin_exams.report row (needs `.snapshot` and `.digest`).
 * `moderation` — the latest approved moderation row, or null (needs `.adjusted_snapshot`).
 * `scale`      — the tenant/exam grade scale used to re-derive the grade.
 *
 * Returns `{ report, digest, moderated }`. A poisoned/legacy overlay whose pct is not a finite
 * number in [0,100] is NOT served as moderation — the frozen snapshot is returned instead, so a
 * pre-hardening row can never surface an absurd grade.
 */
export function servedReport(report, moderation, scale) {
  const adj = moderation?.adjusted_snapshot;
  if (adj?.digest) {
    const snap = adj.snapshot ?? {};
    const pct = Number(snap.pct);
    if (Number.isFinite(pct) && pct >= 0 && pct <= 100) {
      return { report: { ...snap, ...gradeOf(pct, scale) }, digest: adj.digest, moderated: true };
    }
  }
  return { report: report?.snapshot ?? null, digest: report?.digest ?? null, moderated: false };
}
