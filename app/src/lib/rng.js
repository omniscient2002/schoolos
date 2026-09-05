"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uid = void 0;
exports.mulberry32 = mulberry32;
exports.makeRng = makeRng;
/* Deterministic seeded RNG — same demo data on every load. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function makeRng(seed) {
    const r = mulberry32(seed);
    return {
        next: r,
        int(min, max) { return Math.floor(r() * (max - min + 1)) + min; },
        float(min, max) { return r() * (max - min) + min; },
        pick(arr) { return arr[Math.floor(r() * arr.length)]; },
        picks(arr, n) {
            const copy = [...arr];
            const out = [];
            for (let i = 0; i < n && copy.length; i++)
                out.push(copy.splice(Math.floor(r() * copy.length), 1)[0]);
            return out;
        },
        chance(p) { return r() < p; },
        /* Date offset in days from today, at given hour:minute */
        date(daysOffset, hour = 9, minute = 0) {
            const d = new Date();
            d.setDate(d.getDate() + daysOffset);
            d.setHours(hour, minute, 0, 0);
            return d;
        },
        pastDays(daysBack, hour = 9, minute = 0) {
            return this.date(-daysOffset(daysBack), hour, minute);
        },
    };
}
function daysOffset(n) { return n; }
exports.uid = (() => {
    let counter = 1000;
    return (prefix) => `${prefix}_${(counter++).toString(36)}`;
})();
