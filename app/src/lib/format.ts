/* Formatting helpers — money (INR-first), dates, relative time, initials, percentages. */

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrPrecise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

/* A date the server did not send. `new Date(undefined).toLocaleDateString()`
   does not throw — it returns the literal string "Invalid Date", which then
   renders in front of parents and staff as if it were data. Every date
   formatter routes through this guard and falls back to the em-dash the rest
   of the UI already uses for "no value". One place, so no screen can leak the
   string again. */
const NO_DATE = '—';
const asDate = (d: Date | string | null | undefined): Date | null => {
  if (d === null || d === undefined || d === '') return null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? null : t;
};

export const fmtMoney = (n: number, precise = false) => (precise ? inrPrecise : inr).format(n);

export const fmtMoneyShort = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${n}`;
};

export const fmtNum = new Intl.NumberFormat('en-IN').format;

export const fmtPct = (n: number, digits = 0) => `${n.toFixed(digits)}%`;

export const fmtDate = (d: Date | string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  const t = asDate(d);
  return t ? t.toLocaleDateString('en-IN', opts) : NO_DATE;
};

export const fmtDateShort = (d: Date | string) => fmtDate(d, { day: 'numeric', month: 'short' });

export const fmtTime = (d: Date | string) => {
  const t = asDate(d);
  return t ? t.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : NO_DATE;
};

/* Compact 24h clock for dense operational chips (SLA deadlines, intake times).
   Same guard as the others: `wo.sla.resolveBy.toLocaleTimeString(...)` throws
   outright when the server sends no deadline, and `new Date(null)` silently
   formats as 1970 — both worse than an em-dash. */
export const fmtHM = (d: Date | string) => {
  const t = asDate(d);
  return t ? t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : NO_DATE;
};

export const fmtWeekday = (d: Date | string) => {
  const t = asDate(d);
  return t ? t.toLocaleDateString('en-IN', { weekday: 'short' }) : NO_DATE;
};

export const fmtDateTime = (d: Date | string) => `${fmtDate(d)} · ${fmtTime(d)}`;

export function fmtRelative(d: Date | string): string {
  const parsed = asDate(d);
  if (!parsed) return NO_DATE;
  const diff = Date.now() - parsed.getTime();
  const mins = Math.round(diff / 60000);
  const future = mins < 0;
  const m = Math.abs(mins);
  const fmt = (v: number, unit: string) => future ? `in ${v}${unit}` : `${v}${unit} ago`;
  if (m < 1) return 'just now';
  if (m < 60) return fmt(m, 'm');
  const h = Math.round(m / 60);
  if (h < 24) return fmt(h, 'h');
  const days = Math.round(h / 24);
  if (days < 7) return fmt(days, 'd');
  return fmtDateShort(d);
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

const AVATAR_HUES = ['#0F766E', '#5D53B8', '#B87A2E', '#2563EB', '#8A4A6B', '#15803D', '#B45309', '#476C8A'];
export function avatarHue(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function fmtDuration(mins: number) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

export const weekday = (d: Date | string) => new Date(d).toLocaleDateString('en-IN', { weekday: 'long' });
