/* unit 12: theme resolution — user choice wins over the OS media query.
   system → tokens.css + dark.css media query decide
   light  → tokens.css only (data-theme="light" excludes the dark media block)
   dark   → tokens.css + dark.css attribute block                      */
export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'schoolos.theme';

export function storedTheme(): ThemeChoice {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function applyTheme(t: ThemeChoice): void {
  const root = document.documentElement;
  if (t === 'system') {
    root.removeAttribute('data-theme');
    localStorage.removeItem(KEY);
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
