/* unit 12: theme resolution — user choice wins over the OS media query.
   system → tokens.css + dark.css media query decide
   light  → tokens.css only (data-theme="light" excludes the dark media block)
   dark   → tokens.css + dark.css attribute block                      */
export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'schoolos.theme';

export function storedTheme(): ThemeChoice {
  const v = localStorage.getItem(KEY);
  /* D17: light is the product default. `system` remains an explicit choice a
     user can pick, but an unset preference must not inherit a dark OS — the
     first paint is always the warm-paper light theme. */
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'light';
}

export function applyTheme(t: ThemeChoice): void {
  const root = document.documentElement;
  if (t === 'system') {
    /* Remove the attribute so the media query decides, but REMEMBER the choice —
       otherwise a reload cannot tell "chose system" from "never chose" and falls
       back to the light default. */
    root.removeAttribute('data-theme');
    localStorage.setItem(KEY, 'system');
  } else {
    root.setAttribute('data-theme', t);
    localStorage.setItem(KEY, t);
  }
}

export function setTheme(t: ThemeChoice): void {
  applyTheme(t);
  window.dispatchEvent(new CustomEvent('schoolos:theme', { detail: t }));
}

/* early init so first paint already carries the stored choice (no flash) */
applyTheme(storedTheme());
