import { Link, useLocation } from 'react-router-dom';
import { Icon } from './Icon';
import { useStore } from '../state/store';

export function MobileTabbar() {
  const { pathname } = useLocation();
  const { session } = useStore();
  const items = session.roleId === 'parent'
    ? [{ to: '/parent', label: 'Home', icon: 'Home' }, { to: '/parent/chat', label: 'Chats', icon: 'Message' }, { to: '/parent/fees', label: 'Fees', icon: 'Wallet' }, { to: '/parent/ask', label: 'Ask', icon: 'Sparkle' }]
    : session.roleId === 'student'
      ? [{ to: '/student', label: 'My Day', icon: 'Today' }, { to: '/student/learning', label: 'Learn', icon: 'Learning' }, { to: '/student/portfolio', label: 'Work', icon: 'Award' }, { to: '/student/ask', label: 'Ask', icon: 'Sparkle' }]
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
