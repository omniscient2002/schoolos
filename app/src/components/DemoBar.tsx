import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon } from './Icon';
import { useStore } from '../state/store';
import { useSession } from '../App';

export function MobileTabbar() {
  const { pathname } = useLocation();
  const { session } = useStore();
  const live = useSession();
  const [moreOpen, setMoreOpen] = useState(false);
  /* close the More sheet whenever the route changes */
  useEffect(() => { setMoreOpen(false); }, [pathname]);
  /* The tabbar follows the AUTHENTICATED role first (a parent sign-in must
     never be offered staff destinations); the demo view switcher overrides
     for staff previews. Mirrors the Guard derivation in App.tsx. */
  const isParent = live.role === 'parent' || session.roleId === 'parent';
  const isStudent = live.role === 'student' || session.roleId === 'student';
  const items = isParent
    ? [{ to: '/parent/family', label: 'Family', icon: 'Home' }, { to: '/parent/requests', label: 'Requests', icon: 'File' }, { to: '/parent/copilot', label: 'Ask', icon: 'Sparkle' }, { to: '/parent/consents', label: 'Consents', icon: 'Check' }]
    : isStudent
      ? [{ to: '/student/home2', label: 'My Day', icon: 'Today' }, { to: '/student/learning', label: 'Learn', icon: 'Learning' }, { to: '/student/portfolio', label: 'Work', icon: 'Award' }]
      : [{ to: '/today', label: 'Today', icon: 'Today' }, { to: '/attention', label: 'Attention', icon: 'Attention' }, { to: '/operations', label: 'Ops', icon: 'Operations' }, { to: '/people', label: 'People', icon: 'People' }];
  /* B3 (≤768px): Homework / Submissions / Maintenance / Fees are routed but had
     no mobile reach. Staff get a fifth "More" tab opening a small sheet with
     them; server gates stay the authority. */
  const moreItems = [
    { to: '/teacher/homework', label: 'Homework', icon: 'Book' },
    { to: '/teacher/submissions', label: 'To review', icon: 'Clipboard' },
    { to: '/maintenance', label: 'Maintenance', icon: 'Wrench' },
    { to: '/fees', label: 'Fees', icon: 'Wallet' },
  ];
  return (
    <nav className="mobile-tabbar" aria-label="Mobile navigation">
      {!isParent && !isStudent && moreOpen && (
        <div role="menu" aria-label="More destinations" style={{ position: 'fixed', bottom: 64, left: 10, right: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg, 14px)', boxShadow: '0 -6px 24px rgba(0,0,0,0.14)', padding: 8, zIndex: 60 }}>
          {moreItems.map(i => {
            const I = Icon[i.icon as keyof typeof Icon];
            return (
              <Link key={i.to} to={i.to} role="menuitem" className="mtab" style={{ display: 'flex', flex: 'none', flexDirection: 'row', gap: 10, padding: '12px 12px', borderRadius: 10 }}>
                <I size={17} /><span>{i.label}</span>
              </Link>
            );
          })}
        </div>
      )}
      {items.map(i => {
        const I = Icon[i.icon as keyof typeof Icon];
        const active = pathname === i.to || (i.to !== '/' && pathname.startsWith(i.to + '/'));
        return <Link key={i.to} to={i.to} className={`mtab ${active ? 'active' : ''}`}><I size={18} /><span>{i.label}</span></Link>;
      })}
      {!isParent && !isStudent && (
        <button type="button" className={`mtab ${moreOpen ? 'active' : ''}`} aria-expanded={moreOpen} aria-label="More destinations" onClick={() => setMoreOpen(o => !o)} style={{ border: 'none', background: 'none', font: 'inherit', color: 'inherit' }}>
          <Icon.Grid size={18} /><span>More</span>
        </button>
      )}
    </nav>
  );
}
