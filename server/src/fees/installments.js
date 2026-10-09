/* Installment schedule math — pure, integer paise only (FEE-DAT-5b).
 *
 * A plan template may carry an `installments` jsonb: an ordered list of
 * `{ amount_cents?, percent?, due_on? }`. At generation the obligation's net
 * amount is split across those parts:
 *   · an explicit `amount_cents` is honoured verbatim;
 *   · a `percent` (0-100) resolves to floor(total * percent / 100);
 *   · every part that omits both shares the remainder evenly, with the leftover
 *     paise landing on the LAST unspecified part so the parts always sum to
 *     exactly the total (no rounding loss, no floats).
 * Percent parts that would overshoot are rejected before any write.
 */

export function splitInstallments(parts, totalCents) {
  if (!Array.isArray(parts) || parts.length === 0) return { error: 'no installment parts' };
  const total = BigInt(totalCents);
  if (total <= 0n) return { error: 'nothing to split' };
  const resolved = parts.map((p) => {
    if (p?.amount_cents != null) return BigInt(p.amount_cents);
    if (p?.percent != null) {
      const pct = Number(p.percent);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return 'BAD';
      return (total * BigInt(Math.round(pct * 100))) / 10000n;
    }
    return null;
  });
  if (resolved.includes('BAD')) return { error: 'installment percent must be 0..100' };
  const explicit = resolved;
  const explicitSum = explicit.reduce((a, x) => a + (x ?? 0n), 0n);
  if (explicitSum > total) return { error: 'installment amounts exceed the obligation amount' };
  const unspecified = explicit.filter((x) => x === null).length;
  // F-13: all-explicit parts that cover LESS than the total used to silently drop
  // the remainder (under-scheduled installments). Loud error instead — the author
  // adds one open part {} to take the rest. Generation skips such obligations.
  if (unspecified === 0 && explicitSum < total) return { error: 'installment parts do not cover the obligation total — add one open part for the remainder' };
  const remaining = total - explicitSum;
  const base = unspecified > 0 ? remaining / BigInt(unspecified) : 0n;
  let seen = 0;
  const amounts = parts.map((_, i) => {
    if (explicit[i] !== null) return explicit[i];
    seen += 1;
    return seen === unspecified ? remaining - base * BigInt(unspecified - 1) : base;
  });
  // The installments table carries CHECK (amount_cents > 0): a zero part (e.g. more parts
  // than paise) must surface as a clean split error the generator skips, never a 500.
  if (amounts.some((a) => a <= 0n)) return { error: 'an installment part resolves to zero — use fewer parts' };
  return { amounts };
}
