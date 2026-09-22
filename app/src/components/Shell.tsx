import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { LIVE_API, redirectToLoginWithReturn } from '../services/liveApi';
import { Avatar, Dropdown, Empty } from './ui';
import { useStore } from '../state/store';
import * as seed from '../data/dataset';
import { fmtRelative } from '../lib/format';
import { t, useLang } from '../i18n';
import { listTenants, switchTenant, readTenantId, type TenantMembership } from '../screens/account/tenantSwitch';
import { storedTheme, setTheme, type ThemeChoice } from '../lib/theme';
import { useKernelNav } from '../plugins/useKernel';
import { useSession, sessionSchoolName } from '../App';
import { canSurface, type EffectiveAccess } from '../lib/effective';
import { mapAccountRole, isLightRole } from '../lib/roles';

/* P0 fix 2c: chrome identity comes from the authenticated session
   (useSession — the live /me user). */
const roleTitle = (r: string): string => r.charAt(0).toUpperCase() + r.slice(1);

function useChromeIdentity(): { name: string; title: string; email: string } {
  const live = useSession();
  return { name: live.name, title: roleTitle(live.role), email: live.email };
}

/* ================= Role-aware navigation ================= */
export interface NavItem { to: string; label: string; icon: keyof typeof Icon; badge?: number; plugin?: string; end?: boolean; }

export function useNavItems(): NavItem[] {
  const { session, domain } = useStore();
  const live = useSession();
  const role = session.roleId;
  /* PERFECT-100 §6.2 item 14: nav is filtered by the SERVER's effective-access answer, not by the role
     switch alone. The filter is applied only when the store's role matches the authenticated identity,
     so the demo preview switcher (which changes session.roleId without a server session) still shows the
     previewed role's nav. A missing payload means "no opinion" and changes nothing. */
  const effective: EffectiveAccess | undefined = role === mapAccountRole(live.role) ? live.effective : undefined;
  useLang(); // L5-3.3: nav labels re-render when the language changes
  /* L5-3.3: labels pass through t() — translated keys render in the active
     language, everything else falls back to the English label (honest
     partial coverage; see i18n/hi-IN.ts). Applied to the parent case and
     the finance case as the proof surfaces. */
  const L = (label: string, key: string) => t(key, { fallback: label });
  const kernel = { to: '/plugins', label: 'Modules', icon: 'Layers' as const };
  /* library v2 (docs/LIBRARY-DESIGN.md): the librarian gets the desk; borrowers get the catalog; owner and
     principal get the aggregate operations view. All three are plugin-gated. */
  const library = { to: '/library', label: 'Library', icon: 'Book' as const, plugin: 'library' };
  const libraryOps = { to: '/library/insights', label: 'Library', icon: 'Book' as const, plugin: 'library' };
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
        { to: '/principal/home', label: 'Home', icon: 'Today' }, /* OPP-API-1 */
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/principal-brief', label: 'Morning brief', icon: 'Clipboard' }, /* OPP-PRD-2 */
        { to: '/attention', label: 'Needs your attention', icon: 'Attention', badge: openActions },
        { to: '/next', label: 'Next', icon: 'Next' },
        { to: '/action-center', label: 'Approvals', icon: 'Clipboard' }, /* OPP-FE-12: the principal's own decision queue was reachable but not in nav */
        { to: '/announcements', label: 'Announcements', icon: 'Message' }, /* OPP-PRD-3 */
        { to: '/people', label: 'People', icon: 'People' },
        { to: '/appraisals', label: 'Appraisals', icon: 'Award' }, /* OPP-PRD-11 */
        { to: '/classes', label: 'Classes & sections', icon: 'Grid' },
        { to: '/timetable', label: 'Timetable', icon: 'Grid' },
        { to: '/learning', label: 'Learning', icon: 'Learning' },
        { to: '/operations', label: 'Operations', icon: 'Operations' },
        { to: '/maintenance', label: 'Maintenance', icon: 'Wrench', badge: openWOs },
        { to: '/reception', label: 'Front desk', icon: 'Phone' },
        { to: '/visitors', label: 'Visitors', icon: 'Shield' },
        { to: '/insights', label: 'Insights', icon: 'Insights' },
        { to: '/reports', label: 'Reports', icon: 'Insights' },
        { to: '/board-pack', label: 'Board pack', icon: 'Insights' }, /* OPP-PRD-20: reachable but not in nav */
        { to: '/group', label: 'Group', icon: 'Building' }, /* OPP-PRD-20 */
        { to: '/coord/workload', label: 'Duty fairness', icon: 'Scale' }, /* OPP-PRD-17 */
        { to: '/fees', label: 'Fees', icon: 'Wallet' }, /* OPP-FE-12: principal fee-health view was route-only */
        { to: '/fees/plans', label: 'Fee plans', icon: 'Layers' }, /* L5-2.2: L4-2.1 invoicing surface */
        { to: '/automation', label: 'Automation', icon: 'Automation' },
        { to: '/ai-usage', label: 'AI usage', icon: 'Sparkle' }, /* OPP-RBAC: principal oversees AI use */
        { to: '/memory', label: 'AI memory', icon: 'Memory' },
        { to: '/audit', label: 'Audit trail', icon: 'Clipboard' },
        { to: '/compliance', label: 'Compliance', icon: 'Calendar' }, /* OPP-PRD-5 */
        { to: '/certificates', label: 'Certificates', icon: 'File' }, /* OPP-PRD-7 */
        { to: '/delegations', label: 'Delegations', icon: 'Shield' }, /* OPP-OVR-2 */
        libraryOps,
        kernel,
      ];
    case 'teacher':
      return [
        { to: '/teacher', label: 'Command center', icon: 'Compass' },
        { to: '/teacher/lessons', label: 'Lessons', icon: 'Book' },
        { to: '/teacher/homework', label: 'Homework', icon: 'Clipboard' },
        { to: '/teacher/submissions', label: 'Submissions', icon: 'File' },
        { to: '/teacher/support', label: 'Student support', icon: 'Heart' },
        { to: '/teacher/duties', label: 'Duties & workload', icon: 'Scale' },
        { to: '/teacher/leave', label: 'My leave', icon: 'Calendar' },
        { to: '/teacher/copilot', label: 'Teaching copilot', icon: 'Sparkle' },
        { to: '/teacher/mastery', label: 'Mastery map', icon: 'Grid' },
        { to: '/teacher/progress-story', label: 'Progress story', icon: 'Insights' },
        { to: '/teacher/curriculum', label: 'Curriculum', icon: 'Learning' },
        { to: '/teacher/analytics', label: 'Class analytics', icon: 'Insights' },
        { to: '/teacher/exam-marks', label: 'Exam marks', icon: 'Clipboard' },
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/attention', label: 'Needs your attention', icon: 'Attention' },
        { to: '/next', label: 'Next', icon: 'Next' },
        { to: '/people', label: 'People', icon: 'People' },
        { to: '/maintenance/report', label: 'Report issue', icon: 'Zap' },
        library,
      ];
    case 'coordinator':
      return [
        /* CU-1 CoordinatorOS lane — Command Center first, then the desk surfaces */
        { to: '/coord/home', label: 'Command Center', icon: 'Compass' },
        { to: '/coord/substitutions', label: 'Substitutions', icon: 'Refresh' },
        { to: '/timetable', label: 'Timetable', icon: 'Grid' },
        { to: '/coord/workload', label: 'Workload fairness', icon: 'Scale' },
        { to: '/coord/curriculum', label: 'Curriculum monitor', icon: 'Learning' },
        { to: '/coord/escalations', label: 'Escalations', icon: 'Flag' },
        { to: '/coord/approvals', label: 'Approvals', icon: 'Clipboard' },
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/attention', label: 'Needs your attention', icon: 'Attention', badge: openActions },
        { to: '/next', label: 'Next', icon: 'Next' },
        { to: '/people', label: 'People', icon: 'People' },
        { to: '/operations', label: 'Operations', icon: 'Operations' },
        { to: '/maintenance', label: 'Maintenance', icon: 'Wrench', badge: openWOs },
        { to: '/reception', label: 'Front desk', icon: 'Phone' },
        { to: '/visitors', label: 'Visitors', icon: 'Shield' },
        { to: '/maintenance/report', label: 'Report issue', icon: 'Zap' },
      ];
    case 'finance':
    case 'finance_head':
    case 'finance_clerk':
      return [
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/attention', label: 'Needs your attention', icon: 'Attention', badge: openActions },
        { to: '/next', label: 'Next', icon: 'Next' },
        { to: '/fees', label: L('Fees', 'nav.fees'), icon: 'Wallet' }, /* T509: finance's core surface was routed but never in the nav */
        { to: '/fees/plans', label: L('Fee plans', 'nav.feePlans'), icon: 'Layers' }, /* L5-2.2: L4-2.1 invoicing surface (blocks.md request) */
        { to: '/people', label: L('People', 'nav.people'), icon: 'People' },
        { to: '/operations', label: 'Operations', icon: 'Operations' },
        { to: '/maintenance', label: 'Maintenance', icon: 'Wrench', badge: openWOs },
        { to: '/reception', label: 'Front desk', icon: 'Phone' },
        { to: '/migration', label: 'Data import', icon: 'Database' },
        { to: '/insights', label: 'Insights', icon: 'Insights' },
        { to: '/reports', label: 'Reports', icon: 'Insights' },
      ];
    case 'admissions':
    case 'transport':
      return [
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/attention', label: 'Needs your attention', icon: 'Attention' },
        { to: '/next', label: 'Next', icon: 'Next' },
        { to: '/people', label: 'People', icon: 'People' },
        { to: '/operations', label: 'Operations', icon: 'Operations' },
      ];
    case 'owner':
      return [
        { to: '/owner/home', label: 'Home', icon: 'Today' }, /* OPP-API-1 */
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/attention', label: 'Needs your attention', icon: 'Attention', badge: openActions }, /* OPP-PRD-19 */
        { to: '/action-center', label: 'Approvals', icon: 'Clipboard' }, /* OPP-FE-12: owner decides every action; the queue was route-only */
        { to: '/group', label: 'Group', icon: 'Building' },
        { to: '/board-pack', label: 'Board pack', icon: 'Insights' }, /* OPP-PRD-1 */
        { to: '/principal-brief', label: 'Morning brief', icon: 'Clipboard' }, /* OPP-PRD-2 */
        { to: '/announcements', label: 'Announcements', icon: 'Message' }, /* OPP-PRD-3 */
        { to: '/classes', label: 'Classes & sections', icon: 'Grid' },
        { to: '/timetable', label: 'Timetable', icon: 'Grid' },
        libraryOps,
        peopleAdmin,
        kernel,
        rails,
        { to: '/people', label: 'People', icon: 'People' },
        { to: '/appraisals', label: 'Appraisals', icon: 'Award' }, /* OPP-PRD-11 */
        { to: '/operations', label: 'Operations', icon: 'Operations' },
        { to: '/maintenance', label: 'Maintenance', icon: 'Wrench', badge: openWOs },
        { to: '/reception', label: 'Front desk', icon: 'Phone' },
        { to: '/visitors', label: 'Visitors', icon: 'Shield' },
        { to: '/migration', label: 'Data import', icon: 'Database' },
        { to: '/insights', label: 'Insights', icon: 'Insights' },
        { to: '/reports', label: 'Reports', icon: 'Insights' },
        { to: '/fees', label: 'Fees', icon: 'Wallet' }, /* FEE-RBAC-3: the strongest fee role had no fee desk entry */
        { to: '/fees/plans', label: 'Fee plans', icon: 'Layers' }, /* L5-2.2: L4-2.1 invoicing surface */
        { to: '/audit', label: 'Audit trail', icon: 'Clipboard' }, /* OPP-FE-12: owner verifies the chain; route-only before */
        { to: '/compliance', label: 'Compliance', icon: 'Calendar' }, /* OPP-PRD-5 */
        { to: '/certificates', label: 'Certificates', icon: 'File' }, /* OPP-PRD-7 */
        { to: '/delegations', label: 'Delegations', icon: 'Shield' }, /* OPP-OVR-2 */
        { to: '/memory', label: 'AI memory', icon: 'Memory' },
        { to: '/automation', label: 'Automation', icon: 'Automation' },
        { to: '/ai-usage', label: 'AI usage', icon: 'Sparkle' },
        { to: '/ai-governance', label: 'AI governance', icon: 'Shield' }, /* OPP-PRD-19 */
        { to: '/it', label: 'Platform', icon: 'Shield' }, /* OPP-PRD-19 */
        { to: '/roles', label: 'Roles & permissions', icon: 'Key' }, /* L5-5.1: custom roles (owner + IT admin) */
        { to: '/plugins/settings', label: 'Plugin settings', icon: 'Settings' }, /* L5-5.2 */
      ];
    case 'itadmin':
      return [
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/attention', label: 'Needs your attention', icon: 'Attention' },
        { to: '/operations', label: 'Operations', icon: 'Operations' },
        { to: '/classes', label: 'Classes & sections', icon: 'Grid' },
        { to: '/timetable', label: 'Timetable', icon: 'Grid' },
        { to: '/visitors', label: 'Visitors', icon: 'Shield' },
        { to: '/it', label: 'Platform', icon: 'Shield' },
        { to: '/memory', label: 'AI memory', icon: 'Memory' },
        { to: '/roles', label: 'Roles & permissions', icon: 'Key' }, /* L5-5.1 */
        { to: '/plugins/settings', label: 'Plugin settings', icon: 'Settings' }, /* L5-5.2 */
        peopleAdmin,
        kernel,
        rails,
      ];
    case 'counselor':
      /* RBAC-2: the 13th role. Before this existed a counsellor signed in as `coordinator` or `itadmin`
         (the server could not issue `counselor` at all) and inherited the fee ledger and the audit ledger to
         read a child's wellbeing note. This nav is the counsellor's actual remit and nothing else: the
         wellbeing plane, the student roll for context, and the calm day surfaces. No fees, no audit, no
         infrastructure. (RBAC-6 tracks replacing this switch with permission-driven nav generally.) */
      return [
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/wellbeing-queue', label: 'Wellbeing queue', icon: 'Heart' },
        { to: '/counselor/concerns', label: 'Referral queue', icon: 'Flag' }, /* OPP-PRD-8 */
        { to: '/teacher/safety', label: 'Safety box', icon: 'Shield' }, /* OPP-PRD-9: designated-authority read */
        { to: '/attention', label: 'Needs your attention', icon: 'Attention' },
      ];
    case 'facilities':
      return [
        { to: '/today', label: 'Today', icon: 'Today' },
        { to: '/attention', label: 'Needs your attention', icon: 'Attention', badge: openWOs },
        { to: '/maintenance', label: 'Maintenance', icon: 'Wrench', badge: openWOs },
        { to: '/reception', label: 'Front desk', icon: 'Phone' },
        { to: '/maintenance/report', label: 'Report issue', icon: 'Zap' },
        { to: '/operations', label: 'Operations', icon: 'Operations' },
        { to: '/insights', label: 'Insights', icon: 'Insights' },
      ];
    case 'technician':
      return [
        { to: '/maintenance/technician', label: 'My Jobs', icon: 'Wrench' },
        { to: '/maintenance/assets', label: 'Assets', icon: 'Grid' },
        { to: '/maintenance/report', label: 'Report issue', icon: 'Zap' },
      ];
    case 'librarian':
      /* The whole desk lives in the sidebar: one section, every job. `end` keeps the dashboard and the
         browse-catalog link from lighting up on their sub-routes. */
      return [
        { to: '/library/desk', label: 'Desk dashboard', icon: 'Grid', end: true },
        { to: '/library/desk/issue', label: 'Issue a book', icon: 'ArrowRight' },
        { to: '/library/desk/return', label: 'Return a book', icon: 'Refresh' },
        { to: '/library/desk/catalog', label: 'Catalog', icon: 'Book' },
        { to: '/library/desk/holds', label: 'Holds', icon: 'Clock' },
        { to: '/library/desk/fines', label: 'Fines', icon: 'Wallet' },
        { to: '/library/desk/requests', label: 'Purchase requests', icon: 'Clipboard' },
        { to: '/library/desk/members', label: 'Members', icon: 'Users' },
        { to: '/library/desk/reports', label: 'Reports', icon: 'Insights' },
        { to: '/library/desk/settings', label: 'Library settings', icon: 'Settings' },
        { to: '/library', label: 'Browse catalog', icon: 'Search', end: true },
      ];
    case 'parent':
      return [
        { to: '/parent/family', label: L('Family', 'nav.family'), icon: 'Home' },
        { to: '/parent/consents', label: L('Consents', 'nav.consents'), icon: 'Check' },
        { to: '/parent/requests', label: L('Requests', 'nav.requests'), icon: 'File' },
        { to: '/parent/copilot', label: 'AI Assistant', icon: 'Sparkle' },
        { to: '/parent/complaints', label: 'My complaints', icon: 'Flag' },
        { to: '/parent/fees', label: L('Fees', 'nav.fees'), icon: 'Wallet' },
      ];
    case 'student':
      return [
        { to: '/student/home2', label: 'My Day', icon: 'Today' },
        { to: '/student/homework', label: 'Homework', icon: 'Clipboard' },
        { to: '/student/tasks', label: 'My tasks', icon: 'Check' },
        { to: '/student/mistakes', label: 'Mistakes', icon: 'Book' },
        { to: '/student/flashcards', label: 'Flashcards', icon: 'Layers' },
        { to: '/student/results', label: 'Results', icon: 'Insights' },
        { to: '/student/fees', label: 'My fees', icon: 'Wallet' },
        { to: '/student/learning', label: 'Practice', icon: 'Learning' },
        { to: '/student/portfolio', label: 'Portfolio', icon: 'Award' },
        library,
      ];
  }
  })();
  return useKernelNav(items.filter(i => canSurface(effective, i.to)));
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
  /* review MINOR: grouping keys on the ROUTE, not the (now translatable)
     English label — translated items must keep their group in every
     language instead of collapsing into 'More'. */
  const groups: { label: string; items: NavItem[] }[] = [
    { label: 'Daily operations', items: items.filter(i => ['/today', '/principal-brief', '/attention', '/next', '/action-center', '/group', '/board-pack', '/announcements', '/visitors'].includes(i.to)) },
    /* CU-1: coordinator desk surfaces (nav items pointing at /coord/*) */
    { label: 'Coordination', items: items.filter(i => i.to.startsWith('/coord')) },
    { label: 'Records', items: items.filter(i => ['/people', '/learning', '/operations', '/fees', '/fees/plans', '/people-admin'].includes(i.to)) },
    /* the library desk's sections are their own group (librarian nav) */
    { label: 'Library', items: items.filter(i => i.to === '/library' || i.to.startsWith('/library/')) },
    { label: 'Intelligence', items: items.filter(i => ['/insights', '/reports', '/automation', '/memory', '/ai-usage', '/ai-governance', '/audit', '/compliance', '/certificates', '/delegations', '/it'].includes(i.to)) },
    { label: 'Your space', items: items.filter(i => ['/parent', '/parent/family', '/parent/fees', '/parent/chat', '/student', '/student/home2', '/student/fees', '/student/portfolio'].includes(i.to)) },
  ];
  /* T509: the label whitelist silently DROPPED every assigned item it didn't
     name (Maintenance, Front desk, Data import, Library, People console,
     System services, Modules, …) — routed, role-assigned, invisible. Any
     remainder renders under 'More' so nothing assigned can vanish. */
  const claimed = new Set(groups.flatMap(g => g.items.map(i => i.to)));
  const rest = items.filter(i => !claimed.has(i.to));
  if (rest.length) groups.push({ label: t('nav.more', { fallback: 'More' }), items: rest });
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
  const active = item.end
    ? pathname === item.to
    : pathname === item.to || (item.to !== '/' && pathname.startsWith(item.to + '/'));
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
/* L5-4.1: multi-school memberships for the signed-in email (L2-4.2 doors).
   Renders nothing for single-school accounts — the menu stays clean. */
function SwitchSchoolSection() {
  const [tenants, setTenants] = useState<TenantMembership[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  /* S0 fix A4: /me/switch demands the current password for password-carrying
     accounts — the switcher prompts inline for the target that asked. */
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const activeTenantId = useMemo(() => readTenantId(), []);

  useEffect(() => {
    let live = true;
    listTenants()
      .then(list => { if (live) setTenants(list); })
      .catch(() => { if (live) setTenants([]); /* listing failure: section just hides */ });
    return () => { live = false; };
  }, []);

  if (!tenants || tenants.length < 2) return null;

  const switchTo = async (m: TenantMembership, passPw?: string) => {
    setSwitching(m.tenantId); setError(null);
    try {
      const r = await switchTenant(m.tenantId, passPw || undefined);
      (await import('../services/liveApi')).setToken(r.token);
      localStorage.setItem('schoolos.session', JSON.stringify({ name: r.user.name, role: r.user.role, email: r.user.email }));
      window.location.reload();
    } catch (e) {
      const err = e as Error & { passwordRequired?: boolean };
      setSwitching(null);
      if (err.passwordRequired) { setPwFor(m.tenantId); setError('Enter your password to switch schools.'); }
      else setError((e as Error).message || 'could not switch');
    }
  };

  return (
    <>
      <div role="none" className="dropdown-sep" />
      <div role="none" className="dropdown-label">{t('nav.switchSchool', { fallback: 'Switch school' })}</div>
      {error && <div role="alert" className="u-xs" style={{ padding: '2px 10px 6px', color: 'var(--danger)' }}>{error}</div>}
      <div className="scroll-thin" style={{ maxHeight: 220, overflowY: 'auto' }}>
        {tenants.map(m => (
          <div key={m.tenantId}>
            <button role="menuitem" className="dropdown-item" disabled={switching !== null}
              onClick={() => void switchTo(m, pwFor === m.tenantId ? pw : undefined)}>
              <span className="u-truncate" style={{ flex: 1 }}>
                {m.name} <span className="u-xs u-faint">— {m.role}</span>
              </span>
              {m.tenantId === activeTenantId && <Icon.Check size={13} />}
            </button>
            {pwFor === m.tenantId && (
              <div style={{ padding: '2px 10px 8px' }}>
                <input type="password" autoComplete="current-password" value={pw} autoFocus
                  onChange={e => setPw(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && pw) void switchTo(m, pw); }}
                  placeholder="Current password" aria-label={`Password for ${m.name}`}
                  style={{ width: '100%', fontSize: 'var(--text-sm)' }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* D17: theme is per browser and every role may set it, so it lives in the
   account menu (always reachable) as well as in Settings → Appearance, which
   is owner/itadmin-only. Light is the default; System follows the OS. */
function AppearanceMenu() {
  const [theme, setThemeState] = useState<ThemeChoice>(storedTheme());
  useEffect(() => {
    const onTheme = (e: Event) => setThemeState((e as CustomEvent<ThemeChoice>).detail ?? storedTheme());
    window.addEventListener('schoolos:theme', onTheme);
    return () => window.removeEventListener('schoolos:theme', onTheme);
  }, []);
  const opts: { id: ThemeChoice; label: string; icon: keyof typeof Icon }[] = [
    { id: 'light', label: 'Light', icon: 'Sun' },
    { id: 'dark', label: 'Dark', icon: 'Moon' },
    { id: 'system', label: 'System', icon: 'Monitor' },
  ];
  return (
    <>
      <div role="none" className="dropdown-label">Appearance</div>
      {opts.map(o => {
        const Ico = Icon[o.icon];
        return (
          <button key={o.id} role="menuitemradio" aria-checked={theme === o.id} className="dropdown-item" onClick={() => setTheme(o.id)}>
            <Ico size={14} /> {o.label}
            {theme === o.id && <Icon.Check size={14} style={{ marginLeft: 'auto', color: 'var(--accent-text)' }} />}
          </button>
        );
      })}
    </>
  );
}

export function ProfileMenu() {
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
          <div role="none" className="dropdown-sep" />
          <AppearanceMenu />
          <div role="none" className="dropdown-sep" />
          {/* L5-4.1: multi-school switch — lists this email's memberships and
              re-issues the session against the chosen school (audited server
              door). A full reload is the honest reset: every store, cache and
              dataset refetches under the new tenant (role is per-tenant). If
              the target account still has a temporary password, the server's
              mustChange token routes the reload into the forced gate. */}
          <SwitchSchoolSection />
          <button role="menuitem" className="dropdown-item" style={{ color: 'var(--danger-text)' }} onClick={async () => {
            try { if (LIVE_API) await (await import('../services/liveApi')).apiLogoutAudit(); } catch { /* ledger best-effort */ }
            localStorage.removeItem('schoolos.session');
            (await import('../services/liveApi')).apiLogout();
            /* same login-door convention as the 401 path: the next sign-in
               returns the user to the screen they signed out of. */
            redirectToLoginWithReturn();
          }}><Icon.Shield size={14} /> Sign out</button>
          <button role="menuitem" className="dropdown-item" onClick={() => { navigate('/audit'); close(); }}><Icon.Clipboard size={14} /> Audit trail</button>
        </>
      )}
    </Dropdown>
  );
}

/* ================= Command palette ================= */
interface PaletteItem { id: string; label: string; hint?: string; group: string; icon: keyof typeof Icon; action: () => void; path?: string; }

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const live = useSession();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  const items: PaletteItem[] = useMemo(() => {
    const go = (to: string) => () => { navigate(to); onClose(); };
    const isLight = live.role === 'parent' || live.role === 'student';
    /* PERFECT-100 §6.2 item 14 / FE-2: every palette destination is gated by the SERVER's
       effective-access answer, and parent/student accounts only ever see their own destinations. */
    const list: PaletteItem[] = [
      { id: 'n1', label: 'Go to Today', group: 'Navigate', icon: 'Today', action: go('/today'), path: '/today' },
      { id: 'n2', label: 'Go to Needs your attention', group: 'Navigate', icon: 'Attention', action: go('/attention'), path: '/attention' },
      { id: 'n3', label: 'Go to Action Center', group: 'Navigate', icon: 'Zap', action: go('/action-center'), path: '/action-center' },
      { id: 'n4', label: 'Go to People', group: 'Navigate', icon: 'People', action: go('/people'), path: '/people' },
      { id: 'n5', label: 'Go to Learning', group: 'Navigate', icon: 'Learning', action: go('/learning'), path: '/learning' },
      { id: 'n6', label: 'Go to Attendance', group: 'Navigate', icon: 'Clipboard', action: go('/attendance'), path: '/attendance' },
      { id: 'n7', label: 'Go to Operations', group: 'Navigate', icon: 'Operations', action: go('/operations'), path: '/operations' },
      { id: 'n8', label: 'Go to Fees', group: 'Navigate', icon: 'Money', action: go('/fees'), path: '/fees' },
      { id: 'n9', label: 'Go to Admissions funnel', group: 'Navigate', icon: 'Graduation', action: go('/admissions'), path: '/admissions' },
      { id: 'n10', label: 'Go to Transport', group: 'Navigate', icon: 'Bus', action: go('/transport'), path: '/transport' },
      { id: 'n11', label: 'Go to Calendar', group: 'Navigate', icon: 'Calendar', action: go('/calendar'), path: '/calendar' },
      { id: 'n12', label: 'Go to Insights', group: 'Navigate', icon: 'Insights', action: go('/insights'), path: '/insights' },
      { id: 'n13', label: 'Go to Automation builder', group: 'Navigate', icon: 'Workflow', action: go('/automation'), path: '/automation' },
      { id: 'n14', label: 'Go to AI memory', group: 'Navigate', icon: 'Memory', action: go('/memory'), path: '/memory' },
      { id: 'n15', label: 'Go to School policies', group: 'Navigate', icon: 'Scale', action: go('/constitution'), path: '/constitution' },
      { id: 'n16', label: 'Go to Cases', group: 'Navigate', icon: 'Wrench', action: go('/cases'), path: '/cases' },
      { id: 'n17', label: 'Go to Incidents', group: 'Navigate', icon: 'Alert', action: go('/incidents'), path: '/incidents' },
      { id: 'n18', label: 'Go to Data quality', group: 'Navigate', icon: 'Database', action: go('/data-health'), path: '/data-health' },
      { id: 'n19', label: 'Go to Audit trail', group: 'Navigate', icon: 'Clipboard', action: go('/audit'), path: '/audit' },
      { id: 'n20', label: 'Go to AI rules & control', group: 'Navigate', icon: 'Shield', action: go('/ai-governance'), path: '/ai-governance' },
      { id: 'n21', label: 'Go to Settings', group: 'Navigate', icon: 'Settings', action: go('/settings'), path: '/settings' },
      /* light-role destinations (parent/student) — filtered to their own paths below */
      { id: 'lp1', label: 'Go to Family', group: 'Navigate', icon: 'Home', action: go('/parent/family'), path: '/parent/family' },
      { id: 'lp3', label: 'Go to Fees', group: 'Navigate', icon: 'Wallet', action: go('/parent/fees'), path: '/parent/fees' },
      { id: 'lp4', label: 'Go to AI Assistant', group: 'Navigate', icon: 'Sparkle', action: go('/parent/copilot'), path: '/parent/copilot' },
      { id: 'ls1', label: 'Go to My Day', group: 'Navigate', icon: 'Today', action: go('/student/home2'), path: '/student/home2' },
      { id: 'ls2', label: 'Go to Learning', group: 'Navigate', icon: 'Learning', action: go('/student/learning'), path: '/student/learning' },
      { id: 'ls3', label: 'Go to Portfolio', group: 'Navigate', icon: 'Award', action: go('/student/portfolio'), path: '/student/portfolio' },
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
    /* item 14: a parent/student sees only their own destinations; every staff destination the server
       says the caller may not reach is dropped. No payload → the light guard still applies. */
    return list.filter((it) => {
      if (isLight && !(it.path?.startsWith('/parent') || it.path?.startsWith('/student'))) return false;
      return it.path ? canSurface(live.effective, it.path) : true;
    });
  }, [q, navigate, onClose, live]);

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
  const live = useSession();
  /* FEX-7 one role notion: the authenticated server role, not the demo-preview store role. */
  const light = isLightRole(live.role);
  return (
    <header className="topbar">
      <button className="btn btn-secondary btn-sm topbar-search" style={{ gap: 8, color: 'var(--text-3)', justifyContent: 'flex-start' }} onClick={onOpenPalette} aria-label="Open search and command menu">
        <Icon.Search size={14} />
        <span className="u-hide-mobile" style={{ flex: 1, textAlign: 'left' }}>Search or ask…</span>
        <kbd className="u-hide-mobile">⌘K</kbd>
      </button>
      {!light && <CampusSwitcher />}
      <NotificationsBell />
      <ProfileMenu />
    </header>
  );
}
