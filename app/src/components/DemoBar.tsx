import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon } from './Icon';
import { useStore } from '../state/store';
import { useSession } from '../App';
import { canSurface } from '../lib/effective';

export function MobileTabbar() {
  const { pathname } = useLocation();
  const { session } = useStore();
  const live = useSession();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  /* close the More sheet whenever the route changes */
  useEffect(() => { setMoreOpen(false); }, [pathname]);
  /* The More sheet is a real menu: Escape closes it, a tap outside closes it,
     and focus returns to the More button that opened it. Without this, on a
     phone there is no way back to the tab bar except a blind tap. */
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [moreOpen]);

  /* The tabbar follows the AUTHENTICATED role first (a parent sign-in must
     never be offered staff destinations); the demo view switcher overrides
     for staff previews. Mirrors the Guard derivation in App.tsx. */
  const isParent = live.role === 'parent' || session.roleId === 'parent';
  const isStudent = live.role === 'student' || session.roleId === 'student';
  /* UX-01: the parent bar leads with the #1 family task — Fees. UX-03 sibling: the
     student bar says "My work" and its More sheet reaches the live Results screen.
     Each role keeps a real "More" sheet so less-frequent routes stay reachable. */
  const items = isParent
    ? [{ to: '/parent/family', label: 'Family', icon: 'Home' }, { to: '/parent/fees', label: 'Fees', icon: 'Wallet' }, { to: '/parent/copilot', label: 'Ask school', icon: 'Sparkle' }]
    : isStudent
      ? [{ to: '/student/home2', label: 'My Day', icon: 'Today' }, { to: '/student/learning', label: 'Learn', icon: 'Learning' }, { to: '/student/portfolio', label: 'My work', icon: 'Award' }]
      : [{ to: '/today', label: 'Today', icon: 'Today' }, { to: '/attention', label: 'Attention', icon: 'Attention' }, { to: '/operations', label: 'Ops', icon: 'Operations' }, { to: '/people', label: 'People', icon: 'People' }];
  /* B3 (≤768px): the less-frequent routes stay reachable through a real More sheet.
     RBAC-2: each destination is filtered by the server's capability answer, so a
     role that cannot reach a door is never offered its tab (a missing payload still
     shows them — the server enforces every door regardless). */
  const moreItems = (isParent
    ? [
        { to: '/parent/requests', label: 'Requests', icon: 'File' },
        { to: '/parent/consents', label: 'Consents', icon: 'Check' },
        { to: '/parent/complaints', label: 'My complaints', icon: 'Flag' },
        { to: '/parent/chat', label: 'Messages', icon: 'Message' },
      ]
    : isStudent
      ? [
          { to: '/student/homework', label: 'Homework', icon: 'Clipboard' },
          { to: '/student/results', label: 'Results', icon: 'Insights' },
          { to: '/student/tasks', label: 'My tasks', icon: 'Check' },
          { to: '/student/fees', label: 'My fees', icon: 'Wallet' },
          { to: '/noticeboard', label: 'Noticeboard', icon: 'Message' },
        ]
      : [
          { to: '/teacher/homework', label: 'Homework', icon: 'Book' },
          { to: '/teacher/submissions', label: 'To review', icon: 'Clipboard' },
          { to: '/maintenance', label: 'Maintenance', icon: 'Wrench' },
          { to: '/fees', label: 'Fees', icon: 'Wallet' },
          /* FIX-10: the phone tab bar hides the sidebar, so the highest-value setup/record
             destinations get explicit More-sheet entries (still role-filtered below) instead of
             living only behind the search palette. */
          { to: '/classes', label: 'Classes', icon: 'Grid' },
          { to: '/timetable', label: 'Timetable', icon: 'Calendar' },
          { to: '/library', label: 'Library', icon: 'Book' },
          { to: '/insights', label: 'Insights', icon: 'Insights' },
        ]
  ).filter(i => canSurface(live.effective, i.to));
  return (
    <>
      {moreOpen && <div className="mt-scrim" aria-hidden="true" onClick={() => setMoreOpen(false)} />}
      <nav className="mobile-tabbar" aria-label="Mobile navigation">
        {moreOpen && (
          <div ref={moreRef} id="mt-more-sheet" role="menu" aria-label="More destinations" className="mt-sheet">
            <div role="none" className="mt-sheet-label">More destinations</div>
            {moreItems.map(i => {
              const I = Icon[i.icon as keyof typeof Icon];
              return (
                <Link key={i.to} to={i.to} role="menuitem" className="mt-sheet-item">
                  <I size={18} /><span>{i.label}</span>
                  <Icon.ChevronRight size={16} className="mt-sheet-go" aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        )}
        {items.map(i => {
          const I = Icon[i.icon as keyof typeof Icon];
          const active = pathname === i.to || (i.to !== '/' && pathname.startsWith(i.to + '/'));
          return <Link key={i.to} to={i.to} className={`mtab ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}><I size={19} /><span>{i.label}</span></Link>;
        })}
        {moreItems.length > 0 && (
          <button
            type="button"
            className={`mtab ${moreOpen ? 'active' : ''}`}
            aria-expanded={moreOpen}
            aria-controls="mt-more-sheet"
            aria-label={moreOpen ? 'Close more destinations' : 'More destinations'}
            onClick={() => setMoreOpen(o => !o)}
          >
            <Icon.Grid size={19} /><span>More</span>
          </button>
        )}
      </nav>
    </>
  );
}
