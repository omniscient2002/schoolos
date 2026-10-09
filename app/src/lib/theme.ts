/* Appearance resolution — two independent axes, both applied before first
   paint so a cold open never flashes the wrong canvas.

   THEME (system | light | dark) decides which token set is in force:
     system → tokens.css + the dark media query decide
     light  → tokens.css only (data-theme="light" excludes the dark block)
     dark   → tokens.css + the dark attribute block

   CONTRAST (standard | high) is a separate preference, because someone who
   needs high contrast should not have to also be a dark-mode user. It
   layers on top of whichever theme is active, so high-contrast-light and
   high-contrast-dark both exist and both are first-class. */
export type ThemeChoice = 'system' | 'light' | 'dark'
export type ContrastChoice = 'standard' | 'high'

const KEY = 'schoolos.theme'
const CONTRAST_KEY = 'schoolos.contrast'

export function storedTheme(): ThemeChoice {
  const v = localStorage.getItem(KEY)
  /* D17: light is the product default. `system` remains an explicit choice a
     user can pick, but an unset preference must not inherit a dark OS — the
     first paint is always the warm-paper light theme. */
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'light'
}

export function applyTheme(t: ThemeChoice): void {
  const root = document.documentElement
  if (t === 'system') {
    /* Remove the attribute so the media query decides, but REMEMBER the choice —
       otherwise a reload cannot tell "chose system" from "never chose" and falls
       back to the light default. */
    root.removeAttribute('data-theme')
    localStorage.setItem(KEY, 'system')
  } else {
    root.setAttribute('data-theme', t)
    localStorage.setItem(KEY, t)
  }
}

export function setTheme(t: ThemeChoice): void {
  applyTheme(t)
  window.dispatchEvent(new CustomEvent('schoolos:theme', { detail: t }))
}

export function storedContrast(): ContrastChoice {
  return localStorage.getItem(CONTRAST_KEY) === 'high' ? 'high' : 'standard'
}

export function applyContrast(c: ContrastChoice): void {
  const root = document.documentElement
  if (c === 'high') root.setAttribute('data-contrast', '1')
  else root.removeAttribute('data-contrast')
  localStorage.setItem(CONTRAST_KEY, c)
}

export function setContrast(c: ContrastChoice): void {
  applyContrast(c)
  window.dispatchEvent(new CustomEvent('schoolos:contrast', { detail: c }))
}

/* early init so first paint already carries the stored choice (no flash) */
applyTheme(storedTheme())
applyContrast(storedContrast())

/* Wipe every key this app owns.
 *
 * The server puts `Clear-Site-Data: "cache", "storage"` on /student/* and on
 * logout, intending to leave nothing behind on a shared kiosk. That header is
 * REFUSED by the browser on a cross-origin fetch whose credentials mode
 * prohibits modifying local data — which is exactly how this client calls the
 * API — so the control is inert and a wiped kiosk still carries the previous
   student's preferences into the next session. (Its own test only asserts the
 * header string is present, so CI stays green either way.)
 *
 * This is the client-side half of that guarantee, and it is deliberately
 * scoped to the shared-device sign-out: a normal staff or parent device should
 * NOT lose its dark-mode and language choices just because someone signed out.
 * Callers decide; this only knows how to clean up.
 *
 * P2-16: this also has to cover the CACHE half. `"cache", "storage"` names two
 * things, and the original version only did storage — nothing anywhere in the app
 * called `caches.delete`, so a kiosk could carry the previous student's cached
 * responses into the next session even though localStorage was clean. The
 * returned promise resolves once the caches are gone; callers that do not care
 * (a staff sign-out) may ignore it, and callers that must not race (the kiosk)
 * should await it before handing the device on. */
export function clearAppStorage(opts: { keepPreferences?: boolean } = {}): Promise<void> {
  try {
    const keep = new Set(
      opts.keepPreferences
        ? [KEY, CONTRAST_KEY, 'schoolos.lang', 'schoolos.sidebarCollapsed']
        : [],
    );
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('schoolos') && !keep.has(k)) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch { /* private mode / storage blocked — the token is memory-only anyway */ }
  try { sessionStorage.clear(); } catch { /* ditto */ }
  return clearCaches();
}

/** Drop every Cache API bucket. Resolves even when the Cache API is absent. */
async function clearCaches(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const names = await caches.keys();
    await Promise.all(names.map((n) => caches.delete(n)));
  } catch { /* storage blocked, or a bucket refuses to delete — storage wipe is best-effort */ }
}
