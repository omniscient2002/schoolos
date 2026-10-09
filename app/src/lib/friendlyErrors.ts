/* ============================================================
   friendlyErrors.ts — plain-language rewrites for server strings
   that would otherwise reach staff, parents or the desk verbatim
   (unit 18 plain-language pass; UX-08 in the Sol review).

   Display-only: never mutates the error, only the copy a human
   sees. A stable server `code` (server/src/error-codes.js) wins
   when present; otherwise the first matching needle wins.
   Unmatched messages pass through unchanged (numbers, ids and
   money stay as-is).
   ============================================================ */
const MAP: [string, string][] = [
  ['is not enabled for this tenant', 'This feature is switched off for your school. Ask the school owner to switch it on.'],
  ['no primary guardian phone on file', 'This student has no guardian phone number on file. Please verify in person — check a photo ID at the desk.'],
  ['manual verification', 'This student has no guardian phone number on file. Please verify in person — check a photo ID at the desk.'],
  ['no_release_without_verification', 'A student can only leave once the guardian confirms the code. Nothing was released.'],
  ['pickup_requires_guardian_otp', 'A student can only leave once the guardian confirms the code.'],
  ['Failed to fetch', "Can't reach the school server right now. Check the connection and try again."],
  ['NetworkError', "Can't reach the school server right now. Check the connection and try again."],
  ['timeout', 'The server took too long to answer. Please try again.'],
  ['session expired', 'Your session ended. Please sign in again.'],
  ['unauthorized', 'You need to sign in again to continue.'],
  ['forbidden', "You don't have permission to do that."],
];

/* The server sends a stable `code` alongside the human message
   (server/src/error-codes.js). Mapping on the CODE gives a plain-language
   rewrite that cannot drift with wording. A screen that passes the Error
   (not just its message) gets this map. */
const CODE_MAP: Record<string, string> = {
  VALIDATION_FAILED: 'Please check the details and try again.',
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "We couldn't find that record.",
  CONFLICT: 'That clashes with the current state — refresh and try again.',
  OBLIGATION_SETTLED: 'This fee is already settled — nothing more is due.',
  PAYMENT_IN_PROGRESS: 'A payment for this fee is already in progress. Finish or cancel it first.',
  PAYMENT_NOT_CONFIRMED: 'Confirm the payment first.',
  LEDGER_INCONSISTENT: "The fee records don't add up — the office needs to check this payment.",
  GATEWAY_REFUSED: 'The payment gateway refused this. Try another method or contact the office.',
  SOD_REQUIRED: 'A second person must approve this — you cannot approve your own action.',
  QUIET_HOURS: 'Reminders are paused during quiet hours. Try again after 8 am.',
  NOT_ENTITLED: "Your school's plan doesn't include this feature.",
  PLUGIN_OFF: 'This feature is switched off for your school.',
  RATE_LIMITED: 'Too many requests just now — wait a minute and try again.',
  GATEWAY_UNCONFIGURED: 'Online payments are not set up yet — pay at the office, or ask the owner to add keys.',
  RECEIPT_NOT_FOUND: "We couldn't find that receipt.",
  CONCESSION_DECIDED: 'This discount has already been decided.',
};

export const friendly = (raw: unknown): string => {
  // Prefer the stable money code when the caller passed the Error itself.
  const code = raw && typeof raw === 'object' && 'code' in raw ? String((raw as { code?: unknown }).code ?? '') : '';
  if (code && CODE_MAP[code]) return CODE_MAP[code];
  const s = String(raw);
  const hit = MAP.find(([needle]) => s.toLowerCase().includes(needle.toLowerCase()));
  return hit ? hit[1] : s.replace(/^Error:\s*/, '');
};
