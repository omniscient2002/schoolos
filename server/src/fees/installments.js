/* Installment schedule math — pure, integer paise only (FEE-DAT-5b).
 *
 * A plan template may carry an `installments` jsonb: an ordered list of `{ amount_cents?, due_on? }`. At
 * generation the obligation's net amount is split across those parts: an explicit `amount_cents` is honoured,
 * and every part that omits one shares the remainder evenly, with the leftover paise landing on the LAST
 * unspecified part so the parts always sum to exactly the total (no rounding loss, no floats).
 */

export function splitInstallments(parts, totalCents) {
  if (!Array.isArray(parts) || parts.length === 0) return { error: 'no installment parts' };
  const total = BigInt(totalCents);
  if (total <= 0n) return { error: 'nothing to split' };
  const explicit = parts.map((p) => (p?.amount_cents != null ? BigInt(p.amount_cents) : null));
  const explicitSum = explicit.reduce((a, x) => a + (x ?? 0n), 0n);
  if (explicitSum > total) return { error: 'installment amounts exceed the obligation amount' };
  const unspecified = explicit.filter((x) => x === null).length;
  const remaining = total - explicitSum;
  const base = unspecified > 0 ? remaining / BigInt(unspecified) : 0n;
  let seen = 0;
  const amounts = parts.map((_, i) => {
    if (explicit[i] !== null) return explicit[i];
    seen += 1;
    return seen === unspecified ? remaining - base * BigInt(unspecified - 1) : base;
  });
  return { amounts };
}
