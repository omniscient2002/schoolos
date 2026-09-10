import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { LIVE_API, redirectToLoginWithReturn } from '../services/liveApi';
import { Avatar, Dropdown, Empty } from './ui';
import { useStore, demoAccounts } from '../state/store';
import * as seed from '../data/dataset';
import { fmtRelative } from '../lib/format';
import { useKernelNav } from '../plugins/useKernel';
import { useSession, sessionSchoolName } from '../App';
import { DEMO_MODE } from '../lib/demoMode';

/* P0 fix 2c: chrome identity comes from the authenticated session
   (useSession — the live /me user); demoAccounts personas render only
   under VITE_DEMO_MODE=1. */
const roleTitle = (r: string): string => r.charAt(0).toUpperCase() + r.slice(1);

function useChromeIdentity(): { name: string; title: string; email: string } {
  const { session } = useStore();
  const live = useSession();
  const demoPersona = DEMO_MODE ? demoAccounts.find(a => a.id === session.roleId) : null;
  return demoPersona
    ? { name: demoPersona.name, title: demoPersona.title, email: demoPersona.email }
    : { name: live.name, title: roleTitle(live.role), email: live.email };
}

/* ================= Role-aware navigation ================= */
export interface NavItem { to: string; label: string; icon: keyof typeof Icon; badge?: number; plugin?: string; }

export function useNavItems(): NavItem[] {
  const { session, domain } = useStore();
  const role = session.roleId;
  const kernel = { to: '/plugins', label: 'Modules', icon: 'Layers' as const };
  const library = { to: '/library', label: 'Library', icon: 'Book' as const, plugin: 'library' };
  /* build-out wave D: People console (people.admin plugin) + System services
     (owner/itadmin core surface for rails/plugins/queues) — plugin-gated so
     disabled modules never appear in the menu. */
  const peopleAdmin = { to: '/people-admin', label: 'People console', icon: 'Users' as const, plugin: 'people.admin' };
  const rails = { to: '/rails', label: 'System services', icon: 'Shield' as const };
  const openActions = domain.actions.filter(a => a.status === 'open').length;
  const openWOs = domain.workOrders.filter(w => !['resolved', 'closed', 'cancelled'].includes(w.status)).length;

  const items: NavItem[] = (() => { switch (role) {
    case 'principal':
      return [
        { to: '/demo', label: 'Demo', icon: 'Play' },
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/attention', label: 'Needs your attention', icon: 'Attention', badge: openActions },
        { to: '/ask', label: 'Ask', icon: 'Ask' },
        { to: '/next', label: 'Next', icon: 'Next' },
        { to: '/people', label: 'People', icon: 'People' },
        { to: '/learning', label: 'Learning', icon: 'Learning' },
        { to: '/operations', label: 'Operations', icon: 'Operations' },
        { to: '/maintenance', label: 'Maintenance', icon: 'Wrench', badge: openWOs },
        { to: '/reception', label: 'Front desk', icon: 'Phone' },
        { to: '/visitors', label: 'Visitors', icon: 'Shield' },
        { to: '/insights', label: 'Insights', icon: 'Insights' },
        { to: '/automation', label: 'Automation', icon: 'Automation' },
        { to: '/memory', label: 'AI memory', icon: 'Memory' },
        library,
        kernel,
      ];
    case 'teacher':
      return [
        { to: '/demo', label: 'Demo', icon: 'Play' },
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/attention', label: 'Needs your attention', icon: 'Attention' },
        { to: '/ask', label: 'Ask', icon: 'Ask' },
        { to: '/next', label: 'Next', icon: 'Next' },
        { to: '/people', label: 'People', icon: 'People' },
        { to: '/learning', label: 'Learning', icon: 'Learning' },
        { to: '/maintenance/report', label: 'Report issue', icon: 'Zap' },
        library,
      ];
    case 'coordinator':
      return [
        /* CU-1 CoordinatorOS lane — Command Center first, then the desk surfaces */
        { to: '/coord/home', label: 'Command Center', icon: 'Compass' },
        { to: '/coord/substitutions', label: 'Substitutions', icon: 'Refresh' },
        { to: '/coord/workload', label: 'Workload fairness', icon: 'Scale' },
        { to: '/coord/curriculum', label: 'Curriculum monitor', icon: 'Learning' },
        { to: '/coord/escalations', label: 'Escalations', icon: 'Flag' },
        { to: '/coord/approvals', label: 'Approvals', icon: 'Clipboard' },
        { to: '/demo', label: 'Demo', icon: 'Play' },
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/attention', label: 'Needs your attention', icon: 'Attention', badge: openActions },
        { to: '/ask', label: 'Ask', icon: 'Ask' },
        { to: '/next', label: 'Next', icon: 'Next' },
        { to: '/people', label: 'People', icon: 'People' },
        { to: '/operations', label: 'Operations', icon: 'Operations' },
        { to: '/maintenance', label: 'Maintenance', icon: 'Wrench', badge: openWOs },
        { to: '/reception', label: 'Front desk', icon: 'Phone' },
        { to: '/visitors', label: 'Visitors', icon: 'Shield' },
        { to: '/maintenance/report', label: 'Report issue', icon: 'Zap' },
      ];
    case 'finance':
      return [
        { to: '/demo', label: 'Demo', icon: 'Play' },
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/attention', label: 'Needs your attention', icon: 'Attention', badge: openActions },
        { to: '/ask', label: 'Ask', icon: 'Ask' },
        { to: '/next', label: 'Next', icon: 'Next' },
        { to: '/fees', label: 'Fees', icon: 'Wallet' }, /* T509: finance's core surface was routed but never in the nav */
        { to: '/people', label: 'People', icon: 'People' },
        { to: '/operations', label: 'Operations', icon: 'Operations' },
        { to: '/maintenance', label: 'Maintenance', icon: 'Wrench', badge: openWOs },
        { to: '/reception', label: 'Front desk', icon: 'Phone' },
        { to: '/migration', label: 'Data import', icon: 'Database' },
        { to: '/insights', label: 'Insights', icon: 'Insights' },
      ];
    case 'admissions':
    case 'transport':
      return [
        { to: '/demo', label: 'Demo', icon: 'Play' },
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/attention', label: 'Needs your attention', icon: 'Attention' },
        { to: '/ask', label: 'Ask', icon: 'Ask' },
        { to: '/next', label: 'Next', icon: 'Next' },
        { to: '/people', label: 'People', icon: 'People' },
        { to: '/operations', label: 'Operations', icon: 'Operations' },
      ];
    case 'owner':
      return [
        { to: '/demo', label: 'Demo', icon: 'Play' },
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/group', label: 'Group', icon: 'Building' },
        library,
        peopleAdmin,
        kernel,
        rails,
        { to: '/ask', label: 'Ask', icon: 'Ask' },
        { to: '/people', label: 'People', icon: 'People' },
        { to: '/operations', label: 'Operations', icon: 'Operations' },
        { to: '/maintenance', label: 'Maintenance', icon: 'Wrench', badge: openWOs },
        { to: '/reception', label: 'Front desk', icon: 'Phone' },
        { to: '/visitors', label: 'Visitors', icon: 'Shield' },
        { to: '/migration', label: 'Data import', icon: 'Database' },
        { to: '/insights', label: 'Insights', icon: 'Insights' },
      ];
    case 'itadmin':
      return [
        { to: '/demo', label: 'Demo', icon: 'Play' },
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/attention', label: 'Needs your attention', icon: 'Attention' },
        { to: '/ask', label: 'Ask', icon: 'Ask' },
        { to: '/operations', label: 'Operations', icon: 'Operations' },
        { to: '/visitors', label: 'Visitors', icon: 'Shield' },
        { to: '/it', label: 'Platform', icon: 'Shield' },
        { to: '/memory', label: 'AI memory', icon: 'Memory' },
        peopleAdmin,
        kernel,
        rails,
      ];
    case 'facilities':
      return [
        { to: '/demo', label: 'Demo', icon: 'Play' },
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/attention', label: 'Needs your attention', icon: 'Attention', badge: openWOs },
        { to: '/maintenance', label: 'Maintenance', icon: 'Wrench', badge: openWOs },
        { to: '/reception', label: 'Front desk', icon: 'Phone' },
        { to: '/maintenance/report', label: 'Report issue', icon: 'Zap' },
        { to: '/operations', label: 'Operations', icon: 'Operations' },
        { to: '/insights', label: 'Insights', icon: 'Insights' },
        { to: '/ask', label: 'Ask', icon: 'Ask' },
      ];
    case 'technician':
      return [
        { to: '/maintenance/technician', label: 'My Jobs', icon: 'Wrench' },
        { to: '/maintenance/assets', label: 'Assets', icon: 'Grid' },
        { to: '/maintenance/report', label: 'Report issue', icon: 'Zap' },
        { to: '/ask', label: 'Ask', icon: 'Ask' },
      ];
    case 'parent':
      return [
        { to: '/parent/family', label: 'Family', icon: 'Home' },
        { to: '/parent/consents', label: 'Consents', icon: 'Check' },
        { to: '/parent/requests', label: 'Requests', icon: 'File' },
        { to: '/parent/copilot', label: 'AI Assistant', icon: 'Sparkle' },
        { to: '/parent', label: 'Home', icon: 'Home' },
        { to: '/parent/complaints', label: 'My complaints', icon: 'Flag' },
        { to: '/parent/chat', label: 'Messages', icon: 'Message' },
        { to: '/parent/fees', label: 'Fees', icon: 'Wallet' },
        { to: '/parent/ask', label: 'Ask', icon: 'Ask' },
      ];
    case 'student':
      return [
        { to: '/student/home2', label: 'My Day', icon: 'Today' },
        { to: '/student', label: 'Home', icon: 'Today' },
        { to: '/student/learning', label: 'Learning', icon: 'Learning' },
        { to: '/student/portfolio', label: 'Portfolio', icon: 'Award' },
        library,
        { to: '/student/ask', label: 'Ask', icon: 'Ask' },
      ];
  }
  })();
  /* P0 fix 2a: the Demo nav entry is a demo affordance — outside
     VITE_DEMO_MODE=1 the /demo routes don't exist, so never offer the link. */
  return useKernelNav(items.filter(i => DEMO_MODE || i.to !== '/demo'));
}

/* ================= Sidebar ================= */
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('schoolos.sidebarCollapsed') === '1');
  const live = useSession();
  useEffect(() => { localStorage.setItem('schoolos.sidebarCollapsed', collapsed ? '1' : '0'); }, [collapsed]);
  const items = useNavItems();
  /* T509: the label whitelist silently DROPPED every assigned item it didn't
     name (Maintenance, Front desk, Data import, Library, People console,
     System services, Modules, …) — routed, role-assigned, invisible. Group
     what is named, then render the remainder under 'More' so nothing
     assigned to the role can vanish from the sidebar. */
  const groups: { label: string; items: NavItem[] }[] = [
    { label: 'Daily operations', items: items.filter(i => ['Today', 'Needs your attention', 'Next', 'Ask', 'Group', 'Visitors'].includes(i.label)) },
    /* CU-1: coordinator desk surfaces (nav items pointing at /coord/*) */
    { label: 'Coordination', items: items.filter(i => i.to.startsWith('/coord')) },
    { label: 'Records', items: items.filter(i => ['People', 'Learning', 'Operations'].includes(i.label)) },
    { label: 'Intelligence', items: items.filter(i => ['Insights', 'Automation', 'AI memory', 'Platform'].includes(i.label)) },
    { label: 'Your space', items: items.filter(i => ['Home', 'Messages', 'Fees', 'My Day', 'Portfolio'].includes(i.label)) },
  ];
  /* T509: the label whitelist silently DROPPED every assigned item it didn't
     name (Maintenance, Front desk, Data import, Library, People console,
     System services, Modules, …) — routed, role-assigned, invisible. Any
     remainder renders under 'More' so nothing assigned can vanish. */
  const claimed = new Set(groups.flatMap(g => g.items.map(i => i.to)));
  const rest = items.filter(i => !claimed.has(i.to));
  if (rest.length) groups.push({ label: 'More', items: rest });
  const visible = groups.filter(g => g.items.length);

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <Link to="/today" style={{ display: 'flex', padding: '14px 16px 10px', gap: 10, borderBottom: '1px solid var(--border-subtle)', alignItems: 'center' }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>M</div>
        <div style={{ minWidth: 0 }} className="sidebar-label">
          <div style={{ fontWeight: 650, fontSize: 'var(--text-md)', letterSpacing: '-0.01em' }}>SchoolOS</div>
          <div className="u-xs u-faint u-truncate">{sessionSchoolName(live)}</div>
        </div>
        <button className="btn btn-ghost btn-sm sidebar-collapse" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={collapsed} onClick={() => setCollapsed(c => !c)} style={{ marginLeft: 'auto', flexShrink: 0 }}>
          <Icon.PanelLeft size={15} />
        </button>
      </Link>
      <nav className="sidebar-nav" aria-label="Primary">
        {visible.map(g => (
          <div className="nav-section" key={g.label}>
            <span className="sidebar-label">{g.label}</span>
            {g.items.map(item => <SideLink key={item.to} item={item} collapsed={collapsed} />)}
          </div>
        ))}
      </nav>
      <SidebarFooter />
    </aside>
  );
}

function SidebarFooter() {
  const identity = useChromeIdentity();
  return (
    <div style={{ padding: 10, borderTop: '1px solid var(--border-subtle)' }}>
      <Link to="/settings" className="nav-item" style={{ width: '100%' }}>
        <Avatar name={identity.name} size="sm" />
        <span className="u-truncate" style={{ textAlign: 'left', flex: 1 }}>
          <span className="u-truncate" style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 570 }}>{identity.name}</span>
          <span className="u-truncate u-xs u-faint" style={{ display: 'block' }}>{identity.title}</span>
        </span>
        <Icon.Settings size={14} />
      </Link>
    </div>
  );
}

function SideLink({ item, collapsed }: { item: NavItem; collapsed?: boolean }) {
  const { pathname } = useLocation();
  const active = pathname === item.to || (item.to !== '/' && pathname.startsWith(item.to + '/'));
  const I = Icon[item.icon];
  return (
    <Link to={item.to} className={`nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} title={collapsed ? item.label : undefined}>
      <I size={16} />
      <span className="sidebar-label">{item.label}</span>
      {!!item.badge && <span className="badge badge-danger nav-badge" style={{ minWidth: 18, justifyContent: 'center', height: 17 }}>{item.badge}</span>}
    </Link>
  );
}

/* ================= Campus switcher ================= */
export function CampusSwitcher() {
  const { session, setActiveCampus } = useStore();
  const navigate = useNavigate();
  /* Own-campus world: the dataset hydrates AFTER first render, so the active
     campus may be missing for a few frames (and 'north' never exists in a
     self-signup school). Guard instead of `!` — a brand-new school must never
     white-screen the topbar. */
  const campus = seed.campuses.find(c => c.id === session.activeCampus) ?? seed.campuses[0];
  const scopedToAll = session.campusScope === 'all';
  if (!campus) return null;
  return (
    <Dropdown width={250} label="Campus switcher" trigger={() => (
      <button className="btn btn-ghost btn-sm" style={{ gap: 7 }}>
        <span className="campus-dot" style={{ width: 8, height: 8, borderRadius: 3, ['--campus-hue' as string]: campus.hue ?? 'var(--campus-a)' }} />
        <span className="u-truncate" style={{ maxWidth: 100 }}>{campus.name}</span>
        <Icon.ChevronDown size={13} />
      </button>
    )}>
      {close => (
        <>
          <div role="none" className="dropdown-label">Campuses</div>
          {seed.campuses.map(c => (
            <button key={c.id} role="menuitem" className="dropdown-item" disabled={!scopedToAll && c.id !== session.campusScope}
              onClick={() => { setActiveCampus(c.id); close(); }}>
              <span className="campus-dot" style={{ width: 8, height: 8, borderRadius: 3, ['--campus-hue' as string]: c.hue ?? 'var(--campus-a)' }} />
              <span>{c.name}</span>
              <span className="dd-right u-xs mono">{c.students ?? 0}</span>
            </button>
          ))}
          {!scopedToAll && <div role="none" className="dropdown-label" style={{ color: 'var(--text-3)' }}>Your access is scoped to one campus</div>}
          <div role="none" className="dropdown-sep" />
          <button role="menuitem" className="dropdown-item" disabled={!scopedToAll} onClick={() => { navigate('/group'); close(); }}>
            <Icon.Grid size={14} /> Group overview
            <span className="dd-right badge badge-accent">3 campuses</span>
          </button>
        </>
      )}
    </Dropdown>
  );
}

/* ================= Notifications ================= */
export function NotificationsBell() {
  const { domain, dispatch } = useStore();
  const navigate = useNavigate();
  const unread = domain.notifications.filter(n => !n.read).length;
  return (
    <Dropdown width={350} label="Notifications" trigger={() => (
      <button className="iconbtn" aria-label={`Notifications, ${unread} unread`}>
        <Icon.Bell size={16} />
        {!!unread && <span style={{ position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: 5, background: 'var(--danger)', border: '2px solid var(--surface)' }} />}
      </button>
    )}>
      {close => (
        <>
          <div className="u-between" style={{ padding: '8px 10px 6px' }}>
            <div role="none" className="dropdown-label" style={{ padding: 0 }}>Notifications</div>
            <button className="u-xs u-muted" onClick={() => dispatch({ type: 'notification/read', all: true })}>Mark all read</button>
          </div>
          {domain.notifications.slice(0, 7).map(n => (
            <button key={n.id} role="menuitem" className="dropdown-item" style={{ alignItems: 'flex-start', gap: 10 }} onClick={() => { dispatch({ type: 'notification/read', id: n.id }); close(); navigate(n.ref ?? '/today'); }}>
              <span style={{ marginTop: 5, width: 7, height: 7, borderRadius: 4, background: n.read ? 'var(--border-strong)' : n.group === 'needs-you' ? 'var(--danger)' : n.group === 'approvals' ? 'var(--warning)' : 'var(--accent)', flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: n.read ? 480 : 600, fontSize: 'var(--text-md)' }}>{n.title}</span>
                <span className="u-small u-muted" style={{ display: 'block', marginTop: 1 }}>{n.body}</span>
                <span className="u-xs u-faint">{fmtRelative(n.on)} · {n.group === 'needs-you' ? 'Needs you' : n.group === 'approvals' ? 'Approvals' : n.group}</span>
              </span>
            </button>
          ))}
        </>
      )}
    </Dropdown>
  );
}

/* ================= Profile ================= */
export function ProfileMenu() {
  const { session, setRole } = useStore();
  const navigate = useNavigate();
  const identity = useChromeIdentity();
  return (
    <Dropdown width={300} label="Account menu" trigger={() => (
      <button className="u-flex iconbtn" style={{ gap: 8, padding: '3px 6px' }} aria-label="Account menu">
        <Avatar name={identity.name} size="sm" />
        <Icon.ChevronDown size={13} />
      </button>
    )}>
      {close => (
        <>
          <div style={{ padding: '8px 10px' }}>
            <div style={{ fontWeight: 620 }}>{identity.name}</div>
            <div className="u-xs u-muted">{identity.title}</div>
            <div className="u-xs u-faint">{identity.email}</div>
          </div>
          <div role="none" className="dropdown-sep" />
          <button role="menuitem" className="dropdown-item" onClick={() => { navigate('/settings'); close(); }}><Icon.Settings size={14} /> Settings</button>
          <button role="menuitem" className="dropdown-item" style={{ color: 'var(--danger-text)' }} onClick={async () => {
            try { if (LIVE_API) await (await import('../services/liveApi')).apiLogoutAudit(); } catch { /* ledger best-effort */ }
            localStorage.removeItem('schoolos.session');
            (await import('../services/liveApi')).apiLogout();
            /* same login-door convention as the 401 path: the next sign-in
               returns the user to the screen they signed out of. */
            redirectToLoginWithReturn();
          }}><Icon.Shield size={14} /> Sign out</button>
          <button role="menuitem" className="dropdown-item" onClick={() => { navigate('/audit'); close(); }}><Icon.Clipboard size={14} /> Audit trail</button>
          {/* P0 fix 2d: the "Switch demo role" persona switcher exists only
              under VITE_DEMO_MODE=1 — an authenticated production session
              has nothing to switch to. */}
          {DEMO_MODE && (
            <>
              <div role="none" className="dropdown-sep" />
              <div role="none" className="dropdown-label">Switch demo role</div>
              <div className="scroll-thin" style={{ maxHeight: 260, overflowY: 'auto' }}>
                {demoAccounts.map(a => (
                  <button key={a.id} role="menuitem" className="dropdown-item" style={a.id === session.roleId ? { background: 'var(--accent-weak)' } : undefined} onClick={() => { setRole(a.id); close(); }}>
                    <Avatar name={a.name} size="sm" />
                    <span className="u-truncate" style={{ flex: 1 }}>{a.title}</span>
                    {a.id === session.roleId && <Icon.Check size={13} />}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Dropdown>
  );
}

/* ================= Command palette ================= */
interface PaletteItem { id: string; label: string; hint?: string; group: string; icon: keyof typeof Icon; action: () => void; }

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  const items: PaletteItem[] = useMemo(() => {
    const go = (to: string) => () => { navigate(to); onClose(); };
    const list: PaletteItem[] = [
      { id: 'a1', label: 'Ask SchoolOS…', hint: 'Open the AI panel', group: 'AI', icon: 'Sparkle', action: go('/ask') },
      { id: 'n1', label: 'Go to Today', group: 'Navigate', icon: 'Today', action: go('/today') },
      { id: 'n2', label: 'Go to Needs your attention', group: 'Navigate', icon: 'Attention', action: go('/attention') },
      { id: 'n3', label: 'Go to Action Center', group: 'Navigate', icon: 'Zap', action: go('/action-center') },
      { id: 'n4', label: 'Go to People', group: 'Navigate', icon: 'People', action: go('/people') },
      { id: 'n5', label: 'Go to Learning', group: 'Navigate', icon: 'Learning', action: go('/learning') },
      { id: 'n6', label: 'Go to Attendance', group: 'Navigate', icon: 'Clipboard', action: go('/attendance') },
      { id: 'n7', label: 'Go to Operations', group: 'Navigate', icon: 'Operations', action: go('/operations') },
      { id: 'n8', label: 'Go to Fees', group: 'Navigate', icon: 'Money', action: go('/fees') },
      { id: 'n9', label: 'Go to Admissions funnel', group: 'Navigate', icon: 'Graduation', action: go('/admissions') },
      { id: 'n10', label: 'Go to Transport', group: 'Navigate', icon: 'Bus', action: go('/transport') },
      { id: 'n11', label: 'Go to Calendar', group: 'Navigate', icon: 'Calendar', action: go('/calendar') },
      { id: 'n12', label: 'Go to Insights', group: 'Navigate', icon: 'Insights', action: go('/insights') },
      { id: 'n13', label: 'Go to Automation builder', group: 'Navigate', icon: 'Workflow', action: go('/automation') },
      { id: 'n14', label: 'Go to AI memory', group: 'Navigate', icon: 'Memory', action: go('/memory') },
      { id: 'n15', label: 'Go to School policies', group: 'Navigate', icon: 'Scale', action: go('/constitution') },
      { id: 'n16', label: 'Go to Cases', group: 'Navigate', icon: 'Wrench', action: go('/cases') },
      { id: 'n17', label: 'Go to Incidents', group: 'Navigate', icon: 'Alert', action: go('/incidents') },
      { id: 'n18', label: 'Go to Data quality', group: 'Navigate', icon: 'Database', action: go('/data-health') },
      { id: 'n19', label: 'Go to Audit trail', group: 'Navigate', icon: 'Clipboard', action: go('/audit') },
      { id: 'n20', label: 'Go to AI rules & control', group: 'Navigate', icon: 'Shield', action: go('/ai-governance') },
      { id: 'n21', label: 'Go to Settings', group: 'Navigate', icon: 'Settings', action: go('/settings') },
    ];
    const qw = q.trim().toLowerCase();
    if (qw.length >= 2) {
      const people = [...seed.students, ...seed.teachers, ...seed.staff].filter(p => p.name.toLowerCase().includes(qw)).slice(0, 5);
      people.forEach((p, i) => list.unshift({
        id: `p${i}`, label: p.name, hint: p.type === 'student' ? `Student · Grade ${p.grade}-${p.section} · ${seed.campuses.find(c => c.id === p.campus)?.shortName}` : `${p.role ?? 'Staff'}${p.subjects?.length ? ' · ' + p.subjects.join(', ') : ''}`,
        group: 'People', icon: 'User', action: go(p.type === 'student' ? `/people/${p.id}` : '/people'),
      }));
      seed.memoryDocs.filter(d => d.title.toLowerCase().includes(qw)).slice(0, 2).forEach((d, i) =>
        list.unshift({ id: `d${i}`, label: d.title, hint: `Memory · ${d.type}`, group: 'Memory', icon: 'Document', action: go('/memory') }));
      seed.decisions.filter(d => d.title.toLowerCase().includes(qw)).slice(0, 2).forEach((d, i) =>
        list.unshift({ id: `dc${i}`, label: d.title, hint: 'Decision record', group: 'Memory', icon: 'Scale', action: go('/memory') }));
    }
    return list;
  }, [q, navigate, onClose]);

  const filtered = q.trim() ? items.filter(i => `${i.label} ${i.hint ?? ''} ${i.group}`.toLowerCase().includes(q.toLowerCase())) : items;
  const groups = [...new Set(filtered.map(i => i.group))];
  let flatIdx = -1;

  if (!open) return null;
  return (
    /* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- scrim: pointer convenience only; the dialog itself traps keys (unit 16) */
    <div className="modal-overlay" style={{ alignItems: 'flex-start', paddingTop: '12vh', zIndex: 600 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 620, padding: 0 }} role="dialog" aria-modal="true" aria-label="Command menu">
        <div className="searchbox" style={{ padding: '4px 6px 0' }}>
          <Icon.Search size={16} />
          <input ref={inputRef} aria-label="Search people, records, actions — or type a command" className="input" style={{ height: 44, border: 'none', fontSize: 'var(--text-lg)', boxShadow: 'none' }}
            placeholder="Search people, records, actions — or type a command…" value={q}
            onChange={e => { setQ(e.target.value); setSel(0); }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, filtered.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); filtered[sel]?.action(); }
              else if (e.key === 'Escape') onClose();
            }} />
        </div>
        <div className="scroll-thin" style={{ maxHeight: 380, overflowY: 'auto', padding: 6 }}>
          {!filtered.length && <Empty title="No matches" sub="Try a name, “fees”, “bus 14”, or “attendance”." style={{ border: 'none', padding: '18px 8px' }} />}
          {groups.map(g => (
            <div key={g}>
              <div role="none" className="dropdown-label">{g}</div>
              {filtered.filter(i => i.group === g).map(item => {
                flatIdx++;
                const idx = flatIdx;
                const I = Icon[item.icon];
                return (
                  <button key={item.id} className="dropdown-item" style={idx === sel ? { background: 'var(--surface-3)' } : undefined}
                    onMouseEnter={() => setSel(idx)} onClick={item.action}>
                    <I size={15} />
                    <span className="u-truncate" style={{ flex: 1 }}>{item.label}{item.hint && <span className="u-faint u-small"> · {item.hint}</span>}</span>
                    {idx === sel && <kbd>↵</kbd>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="u-between u-xs u-faint" style={{ padding: '7px 14px', borderTop: '1px solid var(--border-subtle)' }}>
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span>SchoolOS command menu</span>
        </div>
      </div>
    </div>
  );
}

/* ================= Topbar ================= */
export function Topbar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { session } = useStore();
  const light = ['parent', 'student'].includes(session.roleId);
  const [askOpen, setAskOpen] = useState(() => localStorage.getItem('schoolos.askOpen') === '1');
  useEffect(() => {
    const onToggle = () => setAskOpen(localStorage.getItem('schoolos.askOpen') === '1');
    window.addEventListener('schoolos:ask-toggle', onToggle);
    window.addEventListener('storage', onToggle);
    return () => { window.removeEventListener('schoolos:ask-toggle', onToggle); window.removeEventListener('storage', onToggle); };
  }, []);
  const navigate = useNavigate();
  return (
    <header className="topbar">
      <button className="btn btn-secondary btn-sm topbar-search" style={{ gap: 8, color: 'var(--text-3)', justifyContent: 'flex-start' }} onClick={onOpenPalette} aria-label="Open search and command menu">
        <Icon.Search size={14} />
        <span className="u-hide-mobile" style={{ flex: 1, textAlign: 'left' }}>Search or ask…</span>
        <kbd className="u-hide-mobile">⌘K</kbd>
      </button>
      {!light && <CampusSwitcher />}
      {light
        ? <button className="btn btn-ai btn-sm" onClick={() => navigate(session.roleId === 'parent' ? '/parent/ask' : '/student/ask')}><Icon.Sparkle size={14} /> Ask</button>
        : <button className={`btn btn-ai btn-sm ${askOpen ? 'btn-ai-active' : ''}`} aria-pressed={askOpen} aria-label={askOpen ? 'Close Ask panel' : 'Open Ask panel'} title="Ask SchoolOS (opens the assistant drawer)" onClick={() => { window.dispatchEvent(new Event('schoolos:ask-toggle')); }}>
            <Icon.Sparkle size={14} /> Ask
          </button>}
      <NotificationsBell />
      <ProfileMenu />
    </header>
  );
}
