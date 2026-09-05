"use strict";
/* Formatting helpers — money (INR-first), dates, relative time, initials, percentages. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.weekday = exports.clamp = exports.initials = exports.fmtDateTime = exports.fmtTime = exports.fmtDateShort = exports.fmtDate = exports.fmtPct = exports.fmtNum = exports.fmtMoneyShort = exports.fmtMoney = void 0;
exports.fmtRelative = fmtRelative;
exports.avatarHue = avatarHue;
exports.fmtDuration = fmtDuration;
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrPrecise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const fmtMoney = (n, precise = false) => (precise ? inrPrecise : inr).format(n);
exports.fmtMoney = fmtMoney;
const fmtMoneyShort = (n) => {
    const abs = Math.abs(n);
    if (abs >= 1e7)
        return `₹${(n / 1e7).toFixed(2)} Cr`;
    if (abs >= 1e5)
        return `₹${(n / 1e5).toFixed(2)} L`;
    if (abs >= 1e3)
        return `₹${(n / 1e3).toFixed(1)}k`;
    return `₹${n}`;
};
exports.fmtMoneyShort = fmtMoneyShort;
exports.fmtNum = new Intl.NumberFormat('en-IN').format;
const fmtPct = (n, digits = 0) => `${n.toFixed(digits)}%`;
exports.fmtPct = fmtPct;
const fmtDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => new Date(d).toLocaleDateString('en-IN', opts);
exports.fmtDate = fmtDate;
const fmtDateShort = (d) => (0, exports.fmtDate)(d, { day: 'numeric', month: 'short' });
exports.fmtDateShort = fmtDateShort;
const fmtTime = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
exports.fmtTime = fmtTime;
const fmtDateTime = (d) => `${(0, exports.fmtDate)(d)} · ${(0, exports.fmtTime)(d)}`;
exports.fmtDateTime = fmtDateTime;
function fmtRelative(d) {
    const t = new Date(d).getTime();
    const diff = Date.now() - t;
    const mins = Math.round(diff / 60000);
    const future = mins < 0;
    const m = Math.abs(mins);
    const fmt = (v, unit) => future ? `in ${v}${unit}` : `${v}${unit} ago`;
    if (m < 1)
        return 'just now';
    if (m < 60)
        return fmt(m, 'm');
    const h = Math.round(m / 60);
    if (h < 24)
        return fmt(h, 'h');
    const days = Math.round(h / 24);
    if (days < 7)
        return fmt(days, 'd');
    return (0, exports.fmtDateShort)(d);
}
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
exports.initials = initials;
const AVATAR_HUES = ['#0E7568', '#5D53B8', '#B87A2E', '#2E5E9E', '#8A4A6B', '#4A7A3C', '#9A4526', '#476C8A'];
function avatarHue(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++)
        h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_HUES[h % AVATAR_HUES.length];
}
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
exports.clamp = clamp;
function fmtDuration(mins) {
    if (mins < 60)
        return `${mins}m`;
    const h = Math.floor(mins / 60);
    return `${h}h ${mins % 60}m`;
}
const weekday = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'long' });
exports.weekday = weekday;
