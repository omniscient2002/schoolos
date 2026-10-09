/* Date formatting guards.
 *
 * THE BUG: `new Date(undefined).toLocaleDateString()` does not throw — it
 * returns the literal string "Invalid Date". FamilyHome rendered that in front
 * of a parent because the server sends exam rows with no `date` field. Ten
 * other call sites bypassed the formatter entirely; two of them
 * (`wo.sla.resolveBy.toLocaleTimeString(...)`) would have thrown outright, and
 * several would have silently formatted as 1970 via `new Date(null)`.
 *
 * These pin the contract so a missing or malformed date can never reach a
 * user as a raw JS string again.
 */
import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDateShort, fmtDateTime, fmtTime, fmtHM, fmtWeekday, fmtRelative } from '../lib/format';

const NO_DATE = '—';

describe('date formatters never leak a raw JS string', () => {
  it('renders an em-dash for undefined / null / empty', () => {
    for (const bad of [undefined, null, ''] as const) {
      expect(fmtDate(bad as unknown as string)).toBe(NO_DATE);
      expect(fmtDateShort(bad as unknown as string)).toBe(NO_DATE);
      expect(fmtTime(bad as unknown as string)).toBe(NO_DATE);
      expect(fmtHM(bad as unknown as string)).toBe(NO_DATE);
      expect(fmtWeekday(bad as unknown as string)).toBe(NO_DATE);
      expect(fmtRelative(bad as unknown as string)).toBe(NO_DATE);
    }
  });

  it('renders an em-dash for a value that is not a parseable date', () => {
    const garbage = ['not-a-date', 'TBD', '0000-00-00', NaN as unknown as string, {} as unknown as string];
    for (const bad of garbage) {
      const out = fmtDateShort(bad);
      expect(out).toBe(NO_DATE);
      /* the specific regression: the literal "Invalid Date" reaching a parent */
      expect(out).not.toMatch(/Invalid/i);
    }
  });

  it('never emits "Invalid Date" from any formatter, for any input', () => {
    const inputs = [undefined, null, '', 'nonsense', NaN, {}, [], new Date('nope')] as unknown[];
    for (const i of inputs) {
      for (const fn of [fmtDate, fmtDateShort, fmtTime, fmtHM, fmtWeekday, fmtRelative]) {
        expect(String(fn(i as string))).not.toMatch(/Invalid/i);
      }
      expect(String(fmtDateTime(i as string))).not.toMatch(/Invalid/i);
    }
  });

  it('still formats real dates correctly', () => {
    const d = new Date('2026-09-29T10:30:00Z');
    expect(fmtDateShort(d)).toMatch(/\d/);
    expect(fmtDateShort(d)).not.toBe(NO_DATE);
    expect(fmtDate(d)).toMatch(/2026/);
    expect(fmtRelative(new Date())).toBe('just now');
  });
});
