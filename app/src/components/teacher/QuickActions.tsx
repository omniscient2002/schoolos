/* ============================================================
   teacher/QuickActions.tsx — the §P1 quick-action system.

   ONE floating menu available on every teacher screen (mounted
   by TeacherProvider). 14 actions, context-inferred: when the
   teacher has a live class context (NOW card / NEXT row), the
   menu header names that class and every action deep-links to
   its TU-2 flow route with class · subject · teacher prefill in
   route state — the teacher fills only what is missing.

   Keyboard-complete: the menu is a listbox-pattern popover with
   roving focus, ArrowUp/Down/Home/End, Escape returns focus to
   the trigger, Enter/Space activates. Trigger carries
   aria-expanded/aria-haspopup and an aria-label that names the
   inferred context.
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { useTeacher } from '../../state/teacherContext';
import type { QuickActionPrefill } from '../../state/teacherContext';

export type QuickActionId =
  | 'attendance' | 'homework' | 'assessment' | 'marks' | 'lesson' | 'announce'
  | 'message' | 'concern' | 'leave' | 'substitute' | 'observation' | 'ptm'
  | 'incident' | 'copilot';

interface QuickActionDef {
  id: QuickActionId;
  label: string;
  icon: keyof typeof Icon;
  to: string;
  /** extra prefill keys the flow expects */
  kind?: QuickActionPrefill['kind'];
  group: 'Teaching' | 'Students' | 'Communication' | 'Me';
}

/* T508: FAB entries whose destination route was never registered 404'd —
   they are removed until their screens/doors exist. Kept: every entry whose
   `to` is a registered route (/teacher/homework, /teacher/leave — MyLeave is
   now routed; both its doors are live at teacher.classroom:239/271).
   Removed (no route, no screen): /teacher/attendance, /teacher/announce,
   /teacher/messages, /teacher/concerns (GET door exists at teacher.support:140
   but no screen — rebuilding it was not "cheap"), /teacher/ptm,
   /teacher/copilot. Re-add each with its route in the same change. */
export const QUICK_ACTIONS: QuickActionDef[] = [
  { id: 'homework',    label: 'Assign homework',    icon: 'Book',      to: '/teacher/homework',     group: 'Teaching' },
  { id: 'assessment',  label: 'Create assessment',  icon: 'File',      to: '/teacher/homework',     group: 'Teaching' },
  { id: 'marks',       label: 'Record marks',       icon: 'Award',     to: '/teacher/homework',     group: 'Teaching' },
  { id: 'lesson',      label: 'Create lesson',      icon: 'Learning',  to: '/teacher/homework',     group: 'Teaching' },
  { id: 'leave',       label: 'Request leave',      icon: 'Calendar',  to: '/teacher/leave',        group: 'Me', kind: 'substitute' },
  { id: 'substitute',  label: 'Request substitute', icon: 'Users',     to: '/teacher/leave',        group: 'Me', kind: 'substitute' },
];

export function QuickActions() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { classContext, openAction } = useTeacher();

  /* close on outside click; return focus to trigger on Esc (APG) */
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()); }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  /* reset + focus the filter on open */
  useEffect(() => {
    if (open) { setQ(''); setSel(0); requestAnimationFrame(() => inputRef.current?.focus()); }
  }, [open]);

  const filtered = QUICK_ACTIONS.filter(a => a.label.toLowerCase().includes(q.trim().toLowerCase()));
  const groups = [...new Set(filtered.map(a => a.group))];

  const run = (a: QuickActionDef) => {
    setOpen(false);
    openAction(a.to, {
      actionId: a.id,
      kind: a.kind,
      classGrade: classContext?.classGrade,
      subject: classContext?.subject,
      room: classContext?.room,
      period: classContext?.period,
      sectionId: classContext?.sectionId,
      teacher: classContext?.teacher,
    });
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); setSel(0); }
    else if (e.key === 'End') { e.preventDefault(); setSel(filtered.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const a = filtered[sel]; if (a) run(a); }
  };

  const ctxLabel = classContext?.classGrade
    ? ` for ${classContext.classGrade}${classContext.subject ? ` ${classContext.subject}` : ''}`
    : '';
  let flat = -1;

  return (
    <div className="t-qa-root" ref={rootRef}>
      {open && <div className="t-qa-scrim" aria-hidden="true" onClick={() => setOpen(false)} />}
      <button
        ref={triggerRef}
        className="btn btn-primary t-qa-fab"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Quick actions${ctxLabel}`}
        onClick={() => setOpen(o => !o)}
      >
        <Icon.Zap size={15} />
        <span className="u-hide-mobile">Quick actions</span>
      </button>

      {open && (
        <div className="t-qa-menu" role="menu" aria-label="Quick actions menu" onKeyDown={onMenuKey}>
          <div className="t-qa-head">
            <div style={{ fontWeight: 630 }}>Quick actions</div>
            <div className="u-xs u-muted">
              {ctxLabel ? `Ready-filled for ${classContext?.classGrade}${classContext?.subject ? ` · ${classContext.subject}` : ''}` : 'Opens without a class — pick one inside'}
            </div>
          </div>
          <div className="searchbox" style={{ padding: '8px 10px 4px' }}>
            <Icon.Search size={14} />
            <input
              ref={inputRef}
              className="input"
              style={{ height: 34, fontSize: 'var(--text-sm)' }}
              placeholder="Filter actions…"
              aria-label="Filter quick actions"
              value={q}
              onChange={e => { setQ(e.target.value); setSel(0); }}
            />
          </div>
          <div className="scroll-thin" style={{ maxHeight: 330, overflowY: 'auto', padding: 4 }}>
            {!filtered.length && <div className="u-small u-muted" style={{ padding: '12px 10px' }}>No action matches “{q.trim()}”.</div>}
            {groups.map(g => (
              <div key={g}>
                <div role="none" className="dropdown-label">{g}</div>
                {filtered.filter(a => a.group === g).map(a => {
                  flat++;
                  const idx = flat;
                  const I = Icon[a.icon];
                  return (
                    <button
                      key={a.id}
                      role="menuitem"
                      className="dropdown-item"
                      style={idx === sel ? { background: 'var(--surface-3)' } : undefined}
                      onMouseEnter={() => setSel(idx)}
                      onClick={() => run(a)}
                    >
                      <I size={15} />
                      <span style={{ flex: 1 }}>{a.label}</span>
                      {idx === sel && <kbd aria-hidden="true">↵</kbd>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="u-between u-xs u-faint" style={{ padding: '6px 12px', borderTop: '1px solid var(--border-subtle)' }}>
            <span>↑↓ choose · ↵ open · esc close</span>
            <span>Your class is filled in automatically</span>
          </div>
        </div>
      )}
    </div>
  );
}
