/* ============================================================
   i18n foundation — L5-3.3. Hand-rolled dictionary + t() (no
   i18next — no new heavy deps). en-IN is complete for the proof
   surfaces; hi-IN is an HONEST partial scaffold — missing keys
   fall back to English and the switcher says so.

   Coverage numbers are computed from the dictionaries themselves
   so the "partial" label can never drift from reality.
   ============================================================ */
import { useEffect, useState } from 'react';
import { enIN } from './en-IN';
import { hiIN } from './hi-IN';

export type Lang = 'en-IN' | 'hi-IN';

/* Coverage = how many of the REFERENCE (en-IN) keys the language actually
   translates — hi-IN-only keys cannot count (review MINOR: dictionary drift
   could otherwise push coverage >1 and silently flip isPartial() off). */
const hiCoverage = Object.keys(enIN).filter(k => hiIN[k] !== undefined).length / Math.max(1, Object.keys(enIN).length);

export const LANGS: { id: Lang; label: string; native: string; coverage: number }[] = [
  { id: 'en-IN', label: 'English (India)', native: 'English', coverage: 1 },
  { id: 'hi-IN', label: 'Hindi (India)', native: 'हिन्दी', coverage: hiCoverage },
];

const LANG_KEY = 'schoolos.lang';

function isLang(v: string | null): v is Lang {
  return v === 'en-IN' || v === 'hi-IN';
}

let current: Lang = 'en-IN';
try {
  if (typeof window !== 'undefined' && isLang(window.localStorage.getItem(LANG_KEY))) {
    current = window.localStorage.getItem(LANG_KEY) as Lang;
  }
} catch { /* privacy/sandboxed storage — session-only default (review MINOR: the
             import-time read must never white-screen the import chain) */ }

const subs = new Set<() => void>();

export function getLang(): Lang { return current; }

export function setLang(l: Lang): void {
  current = l;
  try { window.localStorage.setItem(LANG_KEY, l); } catch { /* private mode — session-only */ }
  subs.forEach(f => f());
}

export function useLang(): Lang {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force(x => x + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return current;
}

export interface TVars {
  fallback?: string;
  [k: string]: string | number | undefined;
}

/** Translate `key` in the active language; falls back to en-IN, then to
 *  `vars.fallback` (or the key itself — a visible "missing translation").
 *  Interpolates `{name}`-style vars. */
export function t(key: string, vars?: TVars): string {
  let s = (current === 'hi-IN' ? hiIN[key] : undefined) ?? enIN[key] ?? vars?.fallback ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined || k === 'fallback') continue;
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

/** True when the ACTIVE language is not fully covered — surfaces drive an
 *  honest "partial translation" note instead of pretending. */
export function isPartial(lang: Lang = current): boolean {
  const l = LANGS.find(x => x.id === lang);
  return !!l && l.coverage < 1;
}
