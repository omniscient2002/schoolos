// E.164 normalisation for an India-first product — ONE definition.
//
// The rule below is not invented here: `pack.dpdp` and `admissions.funnel` each contained an identical
// private copy of it ("spaced vs compact phone must be ONE data principal"), and `scripts/
// comms-dispatcher.js` contained a third, weaker variant. Three copies of a normaliser is how the same
// number becomes two different people in one table and one person in another — the exact class of
// defect the DPDP pack was fixed for.
//
// Why it matters beyond tidiness: the rails REFUSE anything that is not strict E.164, and the seeded
// guardian phones are stored the way a school office actually types them — `+91 9720000243`, with a
// space. Handing that straight to `sendSms` fails, so a message that looks configured can never be
// delivered, while every door that displays the number shows something perfectly plausible. The pickup
// OTP had this latent underneath its larger defect.
//
// Returns null (not '') when nothing usable can be produced, so callers can distinguish "no number"
// from "an empty one" and fail loudly instead of sending into the void.

/** The project's established rule, kept verbatim from the two copies it was extracted from:
 *    · 10 digits            → a bare Indian subscriber number      9876500099   → +919876500099
 *    · 12 digits starting 91 → already carries the country code    919720000243 → +919720000243
 *    · 13 digits starting 091→ trunk-prefixed                       0919720000243 → +919720000243
 *    · anything else         → trusted as-is if it survives E.164
 */
export function toE164(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  if (!d) return null;
  let e;
  if (d.length === 10) e = `+91${d}`;
  // Indian trunk prefix: `0` + the subscriber number is how the number is written on a form or a signboard.
  else if (d.length === 11 && d.startsWith('0')) e = `+91${d.slice(1)}`;
  else if (d.length === 12 && d.startsWith('91')) e = `+${d}`;
  else if (d.length === 13 && d.startsWith('091')) e = `+${d.slice(1)}`;
  else e = `+${d}`;
  // 8–15 digits total (ITU-T E.164): a shorter tail cannot be an international number, and the rails
  // reject it anyway — better to refuse here, where the caller can say why, than at the carrier.
  return /^\+[1-9]\d{7,14}$/.test(e) ? e : null;
}

/** True when the stored value is already exactly what a rail would accept. Useful for reporting, not
 *  for deciding: doors should normalise, never merely validate. */
export const isE164 = (v) => /^\+[1-9]\d{7,14}$/.test(String(v ?? ''));
