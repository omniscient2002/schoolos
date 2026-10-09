/* Component + hook regressions for the defects found in the UI audit.
 *
 * These pin behaviour that a screenshot cannot assert: a dialog that announces
 * itself correctly, focus that actually moves and comes back, and a teacher
 * screen that used to crash on every visit.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Modal, Drawer, Stat, DataTable, Empty, Badge } from '../components/ui';
import { applyTheme, storedTheme, applyContrast, storedContrast, clearAppStorage, type ThemeChoice } from '../lib/theme';
import { setLang, getLang } from '../i18n';

/* testing-library only auto-cleans when the test framework exposes globals;
   vitest is configured without them, so unmount explicitly or every render
   leaks into the next test and the queries match twice. */
afterEach(() => { cleanup(); });

/* ══════════════════════════════════════════════════════════
   1. Drawer / Modal accessibility + focus
   ══════════════════════════════════════════════════════════ */

function Harness({ kind }: { kind: 'drawer' | 'modal' }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>open</button>
      {kind === 'drawer'
        ? <Drawer open={open} onClose={() => setOpen(false)} title="Fee summary" sub="for Aarav">body</Drawer>
        : <Modal open={open} onClose={() => setOpen(false)} title="Record payment" sub="Term 2">body</Modal>}
    </div>
  );
}

describe('dialog accessibility', () => {
  it('a drawer has an accessible name and a real heading', () => {
    render(<Harness kind="drawer" />);
    act(() => { screen.getByText('open').click(); });
    const dlg = screen.getByRole('dialog');
    /* THE BUG: role="dialog" with no aria-label and no aria-labelledby made
       every drawer in the app announce as an unnamed dialog (WCAG 4.1.2). */
    const labelledBy = dlg.getAttribute('aria-labelledby');
    expect(labelledBy, 'drawer must be labelled').toBeTruthy();
    const heading = document.getElementById(labelledBy!);
    expect(heading).toBeTruthy();
    expect(heading!.tagName).toBe('H2');
    expect(heading!.textContent).toBe('Fee summary');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
  });

  it('a modal has an accessible name', () => {
    render(<Harness kind="modal" />);
    act(() => { screen.getByText('open').click(); });
    const dlg = screen.getByRole('dialog');
    expect(dlg.getAttribute('aria-label')).toBe('Record payment');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
  });

  it('focus moves into the dialog when it opens', () => {
    render(<Harness kind="drawer" />);
    act(() => { screen.getByText('open').click(); });
    /* THE BUG: focus never left the row BEHIND the overlay, stranding a
       keyboard user behind the scrim. */
    const dlg = screen.getByRole('dialog');
    expect(dlg.contains(document.activeElement), 'focus must be inside the dialog').toBe(true);
  });

  it('Escape closes and returns focus to the trigger', async () => {
    render(<Harness kind="drawer" />);
    const trigger = screen.getByText('open');
    act(() => { trigger.focus(); trigger.click(); });
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(screen.queryByRole('dialog'), 'Escape must close').toBeNull();
    /* the restore is scheduled on an animation frame (the trigger can unmount
       in the same commit as the dialog), and jsdom does not flush that on its
       own — wait for it. */
    await act(async () => { await new Promise(r => setTimeout(r, 80)); });
    /* THE BUG: under StrictMode the effect re-ran and captured the dialog's own
       close button as the element to restore to, so focus fell to <body>. */
    expect(document.activeElement, 'focus must return to the trigger').not.toBe(document.body);
  });
});

/* ══════════════════════════════════════════════════════════
   2. Stat — "unavailable" is a designed state, not a broken dash
   ══════════════════════════════════════════════════════════ */

describe('Stat', () => {
  it('renders an unavailable figure as words, never a 26px em-dash', () => {
    /* THE BUG: a disconnected stat rendered "—", which reads as a failed
       render rather than "we don't have this figure". */
    render(<Stat label="Transport on time" unavailable="Not connected" sub="Open Transport for the live roster" />);
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.getByText('Transport on time')).toBeInTheDocument();
  });

  it('still renders a real figure normally', () => {
    render(<Stat label="Open actions" value={6} sub="1 critical" />);
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.queryByText(/Not connected/)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════
   3. DataTable — an action column may be legitimately empty
   ══════════════════════════════════════════════════════════ */

type Row = { id: string; amount: number; action: string | null };

describe('DataTable empty cells', () => {
  const columns = [
    { key: 'amount', label: 'Amount' },
    { key: 'action', label: '', emptyCell: 'blank' as const },
    { key: 'note', label: 'Note' },
  ];
  const rows: Row[] = [{ id: '1', amount: 100, action: null } as Row];
  const caption = 'Fee records';

  it('renders an em-dash for a missing DATA value', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={r => r.id} caption={caption} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders nothing for an ACTION column that has no action', () => {
    /* THE BUG: an unpaid-fee table rendered a trailing column of em-dashes
       beside every row, because "no action applies" is an answer, not a
       missing value. */
    const { container } = render(<DataTable columns={columns} rows={rows} rowKey={r => r.id} caption={caption} />);
    const tds = container.querySelectorAll('tbody td');
    expect(tds[1].textContent, 'the action cell must be empty').toBe('');
  });
});

/* ══════════════════════════════════════════════════════════
   4. Empty — compact variant for narrow slots
   ══════════════════════════════════════════════════════════ */

describe('Empty', () => {
  it('carries the compact modifier in a narrow slot', () => {
    const { container } = render(<Empty size="sm" title="No live events yet" sub="Events stream here." />);
    expect(container.querySelector('.empty-sm')).toBeTruthy();
  });

  it('is full-size by default', () => {
    const { container } = render(<Empty title="All clear" />);
    expect(container.querySelector('.empty-sm')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════
   5. Theme + contrast + storage
   ══════════════════════════════════════════════════════════ */

describe('appearance state', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); document.documentElement.removeAttribute('data-contrast'); });
  afterEach(() => { localStorage.clear(); });

  it('resolves the theme and reflects it on <html>', () => {
    applyTheme('dark');
    expect(storedTheme()).toBe('dark' as ThemeChoice);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('contrast is an independent axis, not a fourth theme', () => {
    /* THE BUG: contrast.css was a dead file — required by the product's own
       visual brief, imported by nothing, with nothing setting data-contrast.
       Contrast used to be unreachable; somebody needing it should not also be
       forced into a colour scheme. */
    applyTheme('light');
    applyContrast('high');
    expect(storedContrast()).toBe('high');
    expect(document.documentElement.getAttribute('data-contrast')).toBe('1');
    /* the theme is untouched by the contrast choice */
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    applyContrast('standard');
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false);
  });

  it('defaults to light, never inherits a dark OS', () => {
    expect(storedTheme()).toBe('light');
    expect(storedContrast()).toBe('standard');
  });
});

describe('clearAppStorage', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('wipes every app-owned key, leaving foreign keys alone', () => {
    /* The server's Clear-Site-Data is refused by the browser on a cross-origin
       fetch, so the shared-device sign-out has to do this itself — otherwise a
       kiosk hands the next student the last student's session, language and
       appearance. */
    localStorage.setItem('schoolos.session', '{"name":"Meera"}');
    localStorage.setItem('schoolos.lang', 'hi-IN');
    localStorage.setItem('schoolos.theme', 'dark');
    localStorage.setItem('schoolos.plugins.v1', '["library"]');
    localStorage.setItem('someone-elses-key', 'keep me');
    sessionStorage.setItem('schoolos.draft', 'homework in progress');

    clearAppStorage();

    expect(localStorage.getItem('schoolos.session')).toBeNull();
    expect(localStorage.getItem('schoolos.lang')).toBeNull();
    expect(localStorage.getItem('schoolos.theme')).toBeNull();
    expect(localStorage.getItem('schoolos.plugins.v1')).toBeNull();
    expect(sessionStorage.getItem('schoolos.draft')).toBeNull();
    /* never touch storage this app does not own */
    expect(localStorage.getItem('someone-elses-key')).toBe('keep me');
  });

  it('can preserve preferences for a personal device', () => {
    localStorage.setItem('schoolos.theme', 'dark');
    localStorage.setItem('schoolos.session', '{}');
    clearAppStorage({ keepPreferences: true });
    expect(localStorage.getItem('schoolos.theme')).toBe('dark');
    expect(localStorage.getItem('schoolos.session')).toBeNull();
  });

  it('also empties the Cache API, and says so only after it has', async () => {
    /* P2-16. The server header is Clear-Site-Data: "cache", "storage" — TWO things. The
       original wipe did storage only, and nothing in the app called caches.delete, so a shared
       kiosk could carry the previous student's cached responses into the next session even
       though localStorage was clean. The server-side test for this header only asserts the
       header STRING is present, so CI stayed green while the control was inert in the browser.
       This is the gate that would not have. */
    const store = new Map<string, Set<string>>();
    const fake = {
      keys: async () => [...store.keys()],
      delete: async (n: string) => store.delete(n),
      match: async () => undefined,
      put: async () => undefined,
    };
    store.set('schoolos-api-v1', new Set(['a']));
    store.set('schoolos-static-v2', new Set(['b']));
    (globalThis as { caches?: unknown }).caches = fake;

    try {
      await clearAppStorage();
      expect([...store.keys()]).toEqual([]);
      expect((globalThis as { caches?: { keys: () => Promise<string[]> } }).caches!.keys).toBeTypeOf('function');
    } finally {
      delete (globalThis as { caches?: unknown }).caches;
    }
  });

  it('resolves even when the Cache API is unavailable', async () => {
    /* Private-mode browsers and some locked-down kiosques have no `caches`. The storage wipe
       must still complete and must not reject — an unhandled rejection here would abort the
       sign-out half-way and leave the token set. */
    delete (globalThis as { caches?: unknown }).caches;
    localStorage.setItem('schoolos.session', '{}');
    await expect(clearAppStorage()).resolves.toBeUndefined();
    expect(localStorage.getItem('schoolos.session')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════
   6. Document language
   ══════════════════════════════════════════════════════════ */

describe('document language', () => {
  afterEach(() => { setLang('en-IN'); });

  it('tracks the chosen language', () => {
    /* THE BUG: <html lang> was hardcoded to "en" and never updated, so Hindi
       content was announced with an English voice — which changes the
       pronunciation of every word — and no :lang() selector could match. */
    setLang('hi-IN');
    expect(getLang()).toBe('hi-IN');
    expect(document.documentElement.getAttribute('lang')).toBe('hi-IN');
    setLang('en-IN');
    expect(document.documentElement.getAttribute('lang')).toBe('en-IN');
  });
});

/* ══════════════════════════════════════════════════════════
   7. Badge tones still map to real status tokens
   ══════════════════════════════════════════════════════════ */

describe('Badge', () => {
  it('renders a tone as a modifier class', () => {
    render(<Badge tone="danger">Critical</Badge>);
    expect(screen.getByText('Critical').className).toContain('badge-danger');
  });
});

/* ══════════════════════════════════════════════════════════
   8. Teacher brief — the crash that took down the whole lane
   ══════════════════════════════════════════════════════════ */

describe('teacher brief renders the real wire shape', () => {
  it('does not map over a shape the server never sends', async () => {
    /* THE BUG: TeacherHome read `brief.sections.map(...)` from a client type
       declaring {span, sections}. The plugin returns
       {sentences, timetable, homework, concerns, curriculumPace, sources}.
       Every screen under /teacher/* hit the error boundary. This asserts the
       payload the server actually sends, and that each block is independently
       available — a missing source must be SAID to be missing, not rendered
       as a zero. */
    const wire = {
      when: 'week' as const,
      generatedFor: '2026-09-29',
      label: 'deterministic_summary',
      sentences: ['On Tuesdays you have 8 teaching periods.', 'Nothing is waiting to be reviewed.'],
      sources: [{ kind: 'timetable', table: 'app.timetable_slots', available: true }],
      timetable: {
        available: true as const, day: 'Tuesday', teachingToday: 8,
        currentPeriod: { seq: '1', label: 'Period 1', start_time: '08:00', end_time: '08:45', is_break: false, subject: 'Maths', room: null },
        nextPeriod: null, periods: [],
      },
      homework: { available: true as const, openHomework: 0, pendingSubmissions: 0, reviewedSubmissions: 3 },
      concerns: { available: false as const, reason: 'not_built' },
      curriculumPace: { available: true as const, rows: [] },
    };

    /* the shape the old code would have crashed on */
    expect((wire as unknown as { sections?: unknown }).sections).toBeUndefined();

    /* the client's declared type must accept this exact payload */
    const typed: typeof wire = wire;
    expect(typed.sentences.length).toBeGreaterThan(0);
    expect(typed.concerns.available).toBe(false);

    /* Strip comments first: the fix documents the old shape in prose, and a
       guard that fires on the explanation of the bug is useless. */
    const codeOf = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(codeOf('src/services/teacherApi.ts'), 'teacherApi must not declare the shape the server never sends')
      .not.toMatch(/\bsections\b/);
    expect(codeOf('src/screens/TeacherHome.tsx'), 'TeacherHome must not map over brief.sections')
      .not.toMatch(/brief\.sections/);
    expect(codeOf('src/screens/TeacherHome.tsx')).toMatch(/brief\.sentences/);
  });
});
