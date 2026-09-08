import { Link, useLocation } from 'react-router-dom';
import { Icon } from './Icon';
import { useStore } from '../state/store';
import { useSession } from '../App';

export function MobileTabbar() {
  const { pathname } = useLocation();
  const { session } = useStore();
  const live = useSession();
  /* The tabbar follows the AUTHENTICATED role first (a parent sign-in must
     never be offered staff destinations); the demo view switcher overrides
     for staff previews. Mirrors the Guard derivation in App.tsx. */
  const isParent = live.role === 'parent' || session.roleId === 'parent';
  const isStudent = live.role === 'student' || session.roleId === 'student';
  const items = isParent
    ? [{ to: '/parent', label: 'Home', icon: 'Home' }, { to: '/parent/chat', label: 'Chats', icon: 'Message' }, { to: '/parent/fees', label: 'Fees', icon: 'Wallet' }, { to: '/parent/ask', label: 'Ask', icon: 'Sparkle' }]
    : isStudent
      ? [{ to: '/student/home2', label: 'My Day', icon: 'Today' }, { to: '/student/learning', label: 'Learn', icon: 'Learning' }, { to: '/student/portfolio', label: 'Work', icon: 'Award' }, { to: '/student/ask', label: 'Ask', icon: 'Sparkle' }]
      : [{ to: '/today', label: 'Today', icon: 'Today' }, { to: '/attention', label: 'Attention', icon: 'Attention' }, { to: '/ask', label: 'Ask', icon: 'Sparkle' }, { to: '/operations', label: 'Ops', icon: 'Operations' }, { to: '/people', label: 'People', icon: 'People' }];
  return (
    <nav className="mobile-tabbar" aria-label="Mobile navigation">
      {items.map(i => {
        const I = Icon[i.icon as keyof typeof Icon];
        const active = pathname === i.to || (i.to !== '/' && pathname.startsWith(i.to + '/'));
        return <Link key={i.to} to={i.to} className={`mtab ${active ? 'active' : ''}`}><I size={18} /><span>{i.label}</span></Link>;
      })}
    </nav>
  );
}
