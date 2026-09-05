/* Deterministic seeded RNG — same demo data on every load. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed: number) {
  const r = mulberry32(seed);
  return {
    next: r,
    int(min: number, max: number) { return Math.floor(r() * (max - min + 1)) + min; },
    float(min: number, max: number) { return r() * (max - min) + min; },
    pick<T>(arr: readonly T[]): T { return arr[Math.floor(r() * arr.length)]; },
    picks<T>(arr: readonly T[], n: number): T[] {
      const copy = [...arr]; const out: T[] = [];
      for (let i = 0; i < n && copy.length; i++) out.push(copy.splice(Math.floor(r() * copy.length), 1)[0]);
      return out;
    },
    chance(p: number) { return r() < p; },
    /* Date offset in days from today, at given hour:minute */
    date(daysOffset: number, hour = 9, minute = 0) {
      const d = new Date();
      d.setDate(d.getDate() + daysOffset);
      d.setHours(hour, minute, 0, 0);
      return d;
    },
    pastDays(daysBack: number, hour = 9, minute = 0) {
      return this.date(-daysOffset(daysBack), hour, minute);
    },
  };
}
function daysOffset(n: number) { return n; }

export const uid = (() => {
  let counter = 1000;
  return (prefix: string) => `${prefix}_${(counter++).toString(36)}`;
})();
