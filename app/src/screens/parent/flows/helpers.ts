/* ============================================================
   flows/helpers.ts — tolerant readers for the ParentOS flow doors.
   The server DTOs are looser than the frozen types (snake_case vs
   camelCase, renamed fields), so every screen reads defensively
   rather than trusting a single spelling. Never invents a value.
   ============================================================ */

export interface FlowChild { child_id: string; name: string }

export function str(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === 'string' && v.trim() !== '') return v;
  return null;
}

export function text(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim() !== '') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

export function num(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

export function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function list<T = Record<string, unknown>>(...vals: unknown[]): T[] {
  for (const v of vals) if (Array.isArray(v)) return v as T[];
  return [];
}

const PAD = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;

/* Inclusive YYYY-MM-DD dates between two date-input values, capped at 60. */
export function datesInRange(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const out: string[] = [];
  for (let d = start, i = 0; d <= end && i < 60; d = new Date(d.getTime() + 864e5), i++) out.push(ymd(d));
  return out;
}

export const ATT_WORD: Record<string, string> = {
  present: 'Present', late: 'Arrived late', absent: 'Absent',
  excused: 'Excused — leave approved', leave: 'Approved leave',
};

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'outline';

export function attTone(s: string | null): Tone {
  if (s === 'present') return 'success';
  if (s === 'late') return 'warning';
  if (s === 'absent') return 'danger';
  if (s === 'excused' || s === 'leave') return 'info';
  return 'neutral';
}

export function clock(t: string | null): string {
  if (!t) return '';
  return t.length >= 5 ? t.slice(0, 5) : t;
}
