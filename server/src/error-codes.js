/* Money-path error catalogue (FEE-API-5 / FEES-DESIGN §5.4).
 *
 * Error bodies were ad-hoc `{ error }` with no machine-readable branch, so an integrator had to
 * string-match prose to tell "already settled" from "already in progress". Every money refusal now carries
 * one of these stable codes, and the HTTP status is derived from the catalogue so the two cannot drift.
 */
export const ERROR_CODES = Object.freeze({
  VALIDATION_FAILED: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  OBLIGATION_SETTLED: 409,
  PAYMENT_IN_PROGRESS: 409,
  PAYMENT_NOT_CONFIRMED: 409,
  LEDGER_INCONSISTENT: 409,
  GATEWAY_REFUSED: 409,
  SOD_REQUIRED: 403,
  QUIET_HOURS: 409,
  NOT_ENTITLED: 402,
  PLUGIN_OFF: 409,
  RATE_LIMITED: 429,
  GATEWAY_UNCONFIGURED: 503,
  RECEIPT_NOT_FOUND: 404,
  CONCESSION_DECIDED: 409,
});

/** HTTP status for a code, defaulting to 400 for an unknown code rather than throwing on the error path. */
export const statusFor = (code) => ERROR_CODES[code] ?? 400;

/** The refusal shape every money door uses. */
export function moneyError(reply, code, message, http) {
  return reply.code(http ?? statusFor(code)).send({ error: message, code });
}
