/* ============================================================
   friendlyErrors.ts — plain-language rewrites for server strings
   that would otherwise reach staff, parents or the desk verbatim
   (unit 18 plain-language pass; rule 4 of the dispatch).

   Display-only: never mutates the error, only the copy a human
   sees. First matching needle wins; unmatched messages pass
   through unchanged (numbers, ids and money stay as-is).

   Server strings covered here — for the plugin lane to reword at
   source eventually:
   - "plugin ops.visitors is not enabled for this tenant"
     (lifecycle-gate.js, all gated doors)
   - "no primary guardian phone on file — manual verification
     (photo ID at desk) required" (ops.visitors pickup 409)
   - invariant ids: pickup_requires_guardian_otp,
     no_release_without_verification (409 detail fields)
   ============================================================ */
const MAP: [string, string][] = [
  ['is not enabled for this tenant', 'This feature is switched off for your school. Ask the school owner to switch it on.'],
  ['no primary guardian phone on file', 'This student has no guardian phone number on file. Please verify in person — check a photo ID at the desk.'],
  ['manual verification', 'This student has no guardian phone number on file. Please verify in person — check a photo ID at the desk.'],
  ['no_release_without_verification', 'A student can only leave once the guardian confirms the code. Nothing was released.'],
  ['pickup_requires_guardian_otp', 'A student can only leave once the guardian confirms the code.'],
  ['Failed to fetch', "Can't reach the school server right now. Check the connection and try again."],
  ['timeout', 'The server took too long to answer. Please try again.'],
];

export const friendly = (raw: unknown): string => {
  const s = String(raw);
  const hit = MAP.find(([needle]) => s.toLowerCase().includes(needle.toLowerCase()));
  return hit ? hit[1] : s.replace(/^Error:\s*/, '');
};
