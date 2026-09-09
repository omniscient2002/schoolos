import { Suspense, lazy, useEffect, useState, createContext, useContext } from 'react';
import { KernelProvider, KernelGate, useKernel } from './plugins/useKernel';
import './plugins/registerWidgets';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { StoreProvider, useStore } from './state/store';
import { ToastProvider, Empty } from './components/ui';
import { Sidebar, Topbar, CommandPalette } from './components/Shell';
import { MobileTabbar } from './components/DemoBar';
import { apiMe, setToken } from './services/liveApi';
import { ensureDataset } from './data/dataset';
import type { RoleId } from './types/domain';
import { useLiveEventBridge } from './components/Maint';
import { AiDock } from './components/AiDock';
import { SkeletonCard } from './components/ui';
import { Icon } from './components/Icon';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TeacherProvider } from './state/teacherContext';

/* P0 fix 2a: demo gating. This file reads the flag INLINE (not via
   lib/demoMode, which is the canonical gate for Shell/Login) on purpose:
   Vite replaces `import.meta.env.VITE_DEMO_MODE` per-file at build time,
   so in a production build this folds to `false` BEFORE Rollup's
   tree-shaking — the /demo* + /live lazy chunks are then eliminated from
   dist entirely, not merely gated at runtime. Dev keeps the flag via
   app/.env.development. */
const DEMO_BUILD = import.meta.env.VITE_DEMO_MODE === '1';

/* ---------- lazy screens ---------- */
const F = (loader: () => Promise<{ default: React.ComponentType }>) => lazy(loader);

const Login = lazy(() => import('./screens/Login'));
/* self-serve school signup — public door (Platform §1.1, migration 053) */
const Onboard = lazy(() => import('./screens/Onboard'));
const Today = F(() => import('./screens/Today'));
const Attention = F(() => import('./screens/Attention'));
const Ask = F(() => import('./screens/Ask'));
const Next = F(() => import('./screens/Next'));
const People = F(() => import('./screens/People'));
const PersonDetail = F(() => import('./screens/PersonDetail'));
const Learning = F(() => import('./screens/Learning'));
const Attendance = F(() => import('./screens/Attendance'));
const Operations = F(() => import('./screens/Operations'));
const Fees = F(() => import('./screens/Fees'));
const Admissions = F(() => import('./screens/Admissions'));
const FunnelBoard = F(() => import('./screens/FunnelBoard'));
const VisitorsBoard = F(() => import('./screens/VisitorsBoard'));
const Transport = F(() => import('./screens/Transport'));
const Documents = F(() => import('./screens/Documents'));
const Maintenance = F(() => import('./screens/Maintenance'));
const WorkOrders = F(() => import('./screens/WorkOrders'));
const WorkOrderDetail = F(() => import('./screens/WorkOrderDetail'));
const TechnicianWorkspace = F(() => import('./screens/TechnicianWorkspace'));
const Assets = F(() => import('./screens/Assets'));
const AssetDetail = F(() => import('./screens/AssetDetail'));
const Preventive = F(() => import('./screens/Preventive'));
const Inspections = F(() => import('./screens/Inspections'));
const MaintInventory = F(() => import('./screens/MaintInventory'));
const MaintVendors = F(() => import('./screens/MaintVendors'));
const MaintIntelligence = F(() => import('./screens/MaintIntelligence'));
const MaintMap = F(() => import('./screens/MaintMap'));
const Reception = F(() => import('./screens/Reception'));
const Migration = F(() => import('./screens/Migration'));
const PluginsScreen = F(() => import('./screens/Plugins'));
const ReportIssue = F(() => import('./screens/ReportIssue'));
const HR = F(() => import('./screens/HR'));
const CalendarScreen = F(() => import('./screens/CalendarScreen'));
const Cases = F(() => import('./screens/Cases'));
const CaseDetail = F(() => import('./screens/CaseDetail'));
const Incidents = F(() => import('./screens/Incidents'));
const Insights = F(() => import('./screens/Insights'));
const Automation = F(() => import('./screens/Automation'));
const Constitution = F(() => import('./screens/Constitution'));
const Memory = F(() => import('./screens/Memory'));
const DataHealth = F(() => import('./screens/DataHealth'));
const ActionCenter = F(() => import('./screens/ActionCenter'));
const Audit = F(() => import('./screens/Audit'));
const AiGovernance = F(() => import('./screens/AiGovernance'));
const AiUsage = F(() => import('./screens/AiUsage'));
const Settings = F(() => import('./screens/Settings'));
const Group = F(() => import('./screens/Group'));
const ItAdmin = F(() => import('./screens/ItAdmin'));
const PeopleAdmin = F(() => import('./screens/PeopleAdmin'));
const LibraryLive = F(() => import('./screens/LibraryLive'));
const RailsBoard = F(() => import('./screens/RailsBoard'));
const ParentHome = F(() => import('./screens/ParentHome'));
const ParentComplaints = F(() => import('./screens/ParentComplaints'));
const ParentChat = F(() => import('./screens/ParentChat'));
const ParentFees = F(() => import('./screens/ParentFees'));
const ParentAsk = F(() => import('./screens/ParentAsk'));
const FamilyHome = F(() => import('./screens/parent/FamilyHome'));
const ParentConsents = F(() => import('./screens/parent/Consents'));
const ParentRequests = F(() => import('./screens/parent/Requests'));
const ParentCopilot = F(() => import('./screens/parent/Copilot'));
const StudentHome = F(() => import('./screens/StudentHome'));
const StudentLearning = F(() => import('./screens/StudentLearning'));
const StudentPortfolio = F(() => import('./screens/StudentPortfolio'));
const StudentAsk = F(() => import('./screens/StudentAsk'));
const StudentHome2 = F(() => import('./screens/student/StudentHome2'));
/* StudentOS staff desks (SU-3): print center + wellbeing + noticeboard */
const PrintQueue = F(() => import('./screens/student/PrintQueue'));
const WellbeingQueue = F(() => import('./screens/student/WellbeingQueue'));
const Noticeboard = F(() => import('./screens/student/Noticeboard'));
/* TeacherOS: home command center + classroom P6 doors (TU lanes) */
const TeacherHome = F(() => import('./screens/TeacherHome'));
const TeacherHomework = F(() => import('./screens/teacher/Homework'));
const SubmissionsInbox = F(() => import('./screens/teacher/SubmissionsInbox'));
/* CU-1 coordinator lane (CoordinatorOS) */
const CoordHome = F(() => import('./screens/coord/CoordHome'));
const CoordSubstitutions = F(() => import('./screens/coord/SubstitutionReview'));
const CoordWorkload = F(() => import('./screens/coord/WorkloadBoard'));
const CoordCurriculum = F(() => import('./screens/coord/CurriculumMonitor'));
const CoordEscalations = F(() => import('./screens/coord/EscalationsQueue'));
const CoordApprovals = F(() => import('./screens/coord/ApprovalCenter'));
const NotFound = F(() => import('./screens/NotFound'));
/* Demo screens (P0 fix 2a): under a production build (no VITE_DEMO_MODE)
   DEMO_BUILD folds to false at build time, so these ternaries collapse and
   Rollup tree-shakes the Demo/LiveMode chunks out of dist entirely — no
   demo screen code ships at all. The /demo* + /live routes are also
   unregistered below, so this is belt-and-braces. */
const Demo = DEMO_BUILD ? lazy(() => import('./screens/Demo')) : NotFound;
const DemoDay = DEMO_BUILD ? lazy(() => import('./screens/DemoDay')) : NotFound;
const DemoParent = DEMO_BUILD ? lazy(() => import('./screens/DemoParent')) : NotFound;
const DemoSummary = DEMO_BUILD ? lazy(() => import('./screens/DemoSummary')) : NotFound;
const LiveMode = DEMO_BUILD ? lazy(() => import('./screens/LiveMode')) : NotFound;

/* ---------- shared page frame ---------- */
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      {children}
      <div style={{ height: 40 }} />
    </div>
  );
}

/* ---------- boot gate: simulated first-load fetch ---------- */
function BootGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 420); return () => clearTimeout(t); }, []);
  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div className="u-col" style={{ gap: 14, alignItems: 'center', animation: 'fadeIn 300ms var(--ease-out)' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent)', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 20 }}>M</div>
          <div style={{ fontWeight: 650, letterSpacing: '-0.01em' }}>Opening your school…</div>
          <div className="u-flex u-small u-faint" style={{ gap: 8 }}><span className="spinner" style={{ width: 12, height: 12 }} /> {sessionSchoolName(null)}</div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

/* ---------- offline / sync banner ---------- */
function SyncBanner() {
  const { domain } = useStore();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  /* P0 fix 5: offlineQueue starts at 0 — no fabricated "12 queued".
     The banner shows only the honest offline notice, or a real queue
     built up by actual offline/queue dispatches this session. */
  if (!online || domain.offlineQueue > 0) {
    return (
      <div className="u-flex" style={{ gap: 8, padding: '7px 20px', background: 'var(--warning-weak)', borderBottom: '1px solid var(--warning-weak-2)', fontSize: 'var(--text-sm)' }}>
        <Icon.Offline size={14} style={{ color: 'var(--warning)' }} />
        <span style={{ flex: 1 }}>
          {online
            ? `${domain.offlineQueue} offline change${domain.offlineQueue === 1 ? '' : 's'} queued (attendance, notes, messages) — syncing…`
            : 'You are offline. Attendance and messages are queued on this device and will sync automatically.'}
        </span>
        {online && <button className="btn btn-secondary btn-sm" onClick={() => dispatchFlush()}>Sync now</button>}
      </div>
    );
  }
  return null;
}
function dispatchFlush() { window.dispatchEvent(new CustomEvent('schoolos:flush-sync')); }

/* ---------- role screen guard ---------- */
const mapAccountRole = (r: string): RoleId =>
  (['owner','principal','teacher','coordinator','finance','admissions','transport','parent','student','itadmin','facilities','technician'] as RoleId[]).includes(r as RoleId)
    ? (r as RoleId) : 'principal';

function Guard({ children }: { children: React.ReactNode }) {
  const { session } = useStore();
  const live = useSession();
  const { pathname } = useLocation();
  /* Light-role check uses BOTH the live authenticated role (a parent
     sign-in must land on the calm surface) and the demo view switcher
     (staff previewing a light role sees the same gates). */
  const light = ['parent', 'student'].includes(live.role) || ['parent', 'student'].includes(session.roleId);
  /* staffOnly drift fix (P0): /plugins, /settings, /library were missing and
     every parent/student route probe answered with the real screen; /live is
     staff-only regardless (its route additionally only exists in demo mode). */
  const staffOnly = ['/fees', '/admissions', '/visitors', '/reception', '/migration', '/transport', '/insights', '/automation', '/constitution', '/memory', '/data-health', '/ai-governance', '/ai-usage', '/it', '/maintenance', '/group', '/audit', '/action-center', '/cases', '/incidents', '/operations', '/learning', '/attendance', '/calendar', '/documents', '/operations/hr', '/today', '/attention', '/ask', '/next', '/people', '/coord', '/teacher', '/print-queue', '/wellbeing-queue', '/noticeboard', '/plugins', '/settings', '/library', '/live'];
  if (light && staffOnly.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    /* Re-scan P3 fix: an AUTHENTICATED parent/student who deep-links (or lands
       post-login — the default returnTo is /today) on a staff surface is
       redirected to their own home instead of meeting a dead-end "Not
       available" screen whose guidance pointed at the demo role switcher
       (which exists only under VITE_DEMO_MODE=1). The demo-preview path
       (staff member previewing a light role via the switcher) keeps the
       informative locked screen below — it needs the "switch back" copy. */
    const liveIsLight = ['parent', 'student'].includes(live.role);
    if (liveIsLight) {
      return <Navigate to={live.role === 'student' ? '/student/home2' : '/parent/family'} replace />;
    }
    return (
      <PageShell>
        <div className="empty" style={{ padding: '80px 0' }}>
          <Icon.Lock size={28} />
          <h3>Not available on this account</h3>
          <p>This page is for school staff. Parents and students see their own pages only.</p>
          <p style={{ marginTop: 8 }}>Want to explore everything? Sign out and sign in again as <strong>principal@meridian.edu</strong> — or use the role switcher in the menu (top right).</p>
        </div>
      </PageShell>
    );
  }
  return <>{children}</>;
}

function S({ children }: { children: React.ReactNode }) {
  return (
    <Guard>
      <PageShell>
        <Suspense fallback={<div className="grid grid-2"><SkeletonCard /><SkeletonCard /></div>}>
          {children}
        </Suspense>
      </PageShell>
    </Guard>
  );
}

/** Session gate — the front door. No valid session → the Login screen,
 * whatever the URL. Session persists in localStorage; sign-out clears it. */
export interface SessionUser { name: string; role: string; email: string; school?: { name: string | null; slug: string | null } }
const SessionCtx = createContext<SessionUser | null>(null);
export function useSession(): SessionUser { const v = useContext(SessionCtx); if (!v) throw new Error('useSession outside AuthGate'); return v; }
/* The school brand for the signed-in session: the tenant's own name from /me.
   Meridian is the demo tenant's seeded brand — kept as fallback so the demo
   build keeps its title; a self-signup school sees ITS name everywhere. */
export const DEMO_SCHOOL_NAME = 'Meridian International Academy';
export function sessionSchoolName(s: SessionUser | null): string {
  return s?.school?.name || DEMO_SCHOOL_NAME;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { setRole } = useStore();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [booting, setBooting] = useState(true);

  /* The front door validates against the server on every cold open.
     A stored session alone is NEVER trusted — only a live /me answer is. */
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const token = localStorage.getItem('schoolos_token');
        if (!token) { setBooting(false); return; }
        const me = await apiMe();
        await ensureDataset();
        /* unit 16 (A1): the restore path mirrors the login path's setRole call —
           without it the store's roleId stayed at its default and drifted from
           the authenticated identity (unit-14 finding). Auth validation itself
           is unchanged: only a live /me answer establishes a session, and token
           handling (setToken/call) is untouched. */
        if (!dead) { setRole(mapAccountRole(me.role)); setSession({ name: me.name, role: me.role, email: me.email, school: me.school }); }
      } catch {
        localStorage.removeItem('schoolos.session');
        localStorage.removeItem('schoolos_token');
        setToken(null);
      } finally {
        if (!dead) setBooting(false);
      }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot-once effect; setRole is a stable setter, mounting must not re-run auth restore
  }, []);

  if (booting) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} aria-busy="true" aria-label="Restoring session">
        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--accent-weak)', display: 'grid', placeItems: 'center', color: 'var(--accent-text)' }}><Icon.Sparkle size={17} /></div>
      </div>
    );
  }
  if (!session) return <Login onAuthed={async (s: SessionUser) => { localStorage.setItem('schoolos.session', JSON.stringify(s)); await ensureDataset(); setRole(mapAccountRole(s.role)); setSession(s); }} />;
  return (
    <SessionCtx.Provider value={session}>
      {children}
    </SessionCtx.Provider>
  );
}

/* unit 14: server flag wins on enablement — while admissions.funnel is
   enabled (kernel resyncs from the server registry), /admissions shows the
   live funnel board; otherwise the demo kanban stays. */
function AdmissionsHost() {
  const { isEnabled } = useKernel();
  return isEnabled('admissions.funnel') ? <FunnelBoard /> : <Admissions />;
}

/* unit 15: server flag wins — ops.visitors gate pass appears at /visitors while
   the server flag is on; when off the route answers with an honest empty state. */
function VisitorsHost() {
  const { isEnabled } = useKernel();
  return isEnabled('ops.visitors') ? <VisitorsBoard /> : (
    <PageShell>
      <Empty icon={<Icon.Shield size={22} />} title="Visitors gate pass is switched off" sub="Ask the school owner to switch it on in Modules. Your visitor records are saved and will be here when it is on." />
    </PageShell>
  );
}

function AppRoutes() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/today" replace />} />
      <Route path="/login" element={<Navigate to="/today" replace />} />
      <Route path="/today" element={<S><Today /></S>} />
      <Route path="/attention" element={<S><Attention /></S>} />
      <Route path="/ask" element={<S><Ask /></S>} />
      <Route path="/next" element={<S><Next /></S>} />
      <Route path="/people" element={<S><People /></S>} />
      <Route path="/people/:id" element={<S><PersonDetail /></S>} />
      <Route path="/learning" element={<S><Learning /></S>} />
      <Route path="/attendance" element={<S><Attendance /></S>} />
      <Route path="/operations" element={<S><Operations /></S>} />
      <Route path="/fees" element={<S><Fees /></S>} />
      <Route path="/admissions" element={<S><AdmissionsHost /></S>} />
      <Route path="/visitors" element={<S><VisitorsHost /></S>} />
      <Route path="/transport" element={<S><Transport /></S>} />
      <Route path="/documents" element={<S><Documents /></S>} />
      <Route path="/maintenance" element={<S><Maintenance /></S>} />
      <Route path="/maintenance/work-orders" element={<S><WorkOrders /></S>} />
      <Route path="/facilities" element={<Navigate to="/maintenance" replace />} />
      <Route path="/maintenance/work-orders/:id" element={<S><WorkOrderDetail /></S>} />
      <Route path="/maintenance/technician" element={<S><TechnicianWorkspace /></S>} />
      <Route path="/maintenance/assets" element={<S><Assets /></S>} />
      <Route path="/maintenance/assets/:id" element={<S><AssetDetail /></S>} />
      <Route path="/maintenance/preventive" element={<S><Preventive /></S>} />
      <Route path="/maintenance/inspections" element={<S><Inspections /></S>} />
      <Route path="/maintenance/inventory" element={<S><MaintInventory /></S>} />
      <Route path="/maintenance/vendors" element={<S><MaintVendors /></S>} />
      <Route path="/maintenance/intelligence" element={<S><MaintIntelligence /></S>} />
      <Route path="/maintenance/map" element={<S><MaintMap /></S>} />
      <Route path="/reception" element={<S><Reception /></S>} />
      <Route path="/migration" element={<S><Migration /></S>} />
      {/* Demo surfaces (P0 fix 2a): /demo* + /live render ONLY under the
          explicit VITE_DEMO_MODE=1 runtime flag — a production build gets
          no demo routes (unknown path falls through to NotFound). /live
          additionally sits behind the Guard (staffOnly '/live'). */}
      {DEMO_BUILD && <Route path="/demo" element={<S><Demo /></S>} />}
      {DEMO_BUILD && <Route path="/demo/day" element={<S><DemoDay /></S>} />}
      {DEMO_BUILD && <Route path="/demo/parent" element={<S><DemoParent /></S>} />}
      {DEMO_BUILD && <Route path="/demo/summary" element={<S><DemoSummary /></S>} />}
      {DEMO_BUILD && <Route path="/live" element={<S><LiveMode /></S>} />}
      <Route path="/plugins" element={<S><PluginsScreen /></S>} />
      {/* live admin/ops surfaces (build-out wave D): real doors behind the
          plugin gates — the demo Library remains the fallback when off */}
      <Route path="/people-admin" element={<S><KernelGate plugin="people.admin"><PeopleAdmin /></KernelGate></S>} />
      <Route path="/library" element={<S><KernelGate plugin="library"><LibraryLive /></KernelGate></S>} />
      <Route path="/rails" element={<S><RailsBoard /></S>} />
      <Route path="/maintenance/report" element={<S><ReportIssue /></S>} />
      <Route path="/operations/hr" element={<S><HR /></S>} />
      <Route path="/calendar" element={<S><CalendarScreen /></S>} />
      <Route path="/cases" element={<S><Cases /></S>} />
      <Route path="/cases/:id" element={<S><CaseDetail /></S>} />
      <Route path="/incidents" element={<S><Incidents /></S>} />
      <Route path="/insights" element={<S><Insights /></S>} />
      <Route path="/automation" element={<S><Automation /></S>} />
      <Route path="/constitution" element={<S><Constitution /></S>} />
      <Route path="/memory" element={<S><Memory /></S>} />
      <Route path="/data-health" element={<S><DataHealth /></S>} />
      <Route path="/action-center" element={<S><ActionCenter /></S>} />
      <Route path="/audit" element={<S><Audit /></S>} />
      <Route path="/ai-governance" element={<S><AiGovernance /></S>} />
      <Route path="/ai-usage" element={<S><AiUsage /></S>} />
      <Route path="/group" element={<S><Group /></S>} />
      <Route path="/it" element={<S><ItAdmin /></S>} />
      <Route path="/settings" element={<S><Settings /></S>} />
      <Route path="/parent" element={<S><ParentHome /></S>} />
      <Route path="/parent/complaints" element={<S><ParentComplaints /></S>} />
      <Route path="/parent/chat" element={<S><ParentChat /></S>} />
      <Route path="/parent/fees" element={<S><ParentFees /></S>} />
      <Route path="/parent/ask" element={<S><ParentAsk /></S>} />
      <Route path="/parent/family" element={<S><FamilyHome /></S>} />
      <Route path="/parent/consents" element={<S><ParentConsents /></S>} />
      <Route path="/parent/requests" element={<S><ParentRequests /></S>} />
      <Route path="/parent/copilot" element={<S><ParentCopilot /></S>} />
      <Route path="/student" element={<S><StudentHome /></S>} />
      <Route path="/student/home2" element={<S><StudentHome2 /></S>} />
      <Route path="/student/learning" element={<S><StudentLearning /></S>} />
      <Route path="/student/portfolio" element={<S><StudentPortfolio /></S>} />
      <Route path="/student/ask" element={<S><StudentAsk /></S>} />
      {/* TeacherOS: command center + P6 classroom doors (staff-gated) */}
      <Route path="/teacher" element={<S><TeacherHome /></S>} />
      <Route path="/teacher/homework" element={<S><TeacherHomework /></S>} />
      <Route path="/teacher/submissions" element={<S><SubmissionsInbox /></S>} />
      {/* StudentOS staff desks — paper-first ops behind the student surface (staff-gated) */}
      <Route path="/print-queue" element={<S><PrintQueue /></S>} />
      <Route path="/wellbeing-queue" element={<S><WellbeingQueue /></S>} />
      <Route path="/noticeboard" element={<S><Noticeboard /></S>} />
      {/* CU-1 coordinator lane — /coord/* is staff-gated via staffOnly '/coord' above */}
      <Route path="/coord/home" element={<S><CoordHome /></S>} />
      <Route path="/coord/substitutions" element={<S><CoordSubstitutions /></S>} />
      <Route path="/coord/workload" element={<S><CoordWorkload /></S>} />
      <Route path="/coord/curriculum" element={<S><CoordCurriculum /></S>} />
      <Route path="/coord/escalations" element={<S><CoordEscalations /></S>} />
      <Route path="/coord/approvals" element={<S><CoordApprovals /></S>} />
      <Route path="*" element={<S><NotFound /></S>} />
    </Routes>
  );
}

/* ---------- app frame ---------- */
function Frame() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { session, dispatch } = useStore();
  const live = useSession();
  const light = ['parent', 'student'].includes(live.role) || ['parent', 'student'].includes(session.roleId);
  useLiveEventBridge(dispatch);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o); }
      if (e.key === '?' && e.shiftKey && !/input|textarea/i.test((e.target as HTMLElement)?.tagName ?? '')) {
        window.alert('SchoolOS keyboard shortcuts\n\n⌘K / Ctrl+K — search & command menu\n? — this help\nEsc — close panels');
      }
    };
    const onFlush = () => dispatch({ type: 'sync/flush' });
    const onOpenPalette = () => setPaletteOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('schoolos:flush-sync', onFlush);
    window.addEventListener('schoolos:open-palette', onOpenPalette);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('schoolos:flush-sync', onFlush); window.removeEventListener('schoolos:open-palette', onOpenPalette); };
  }, [dispatch]);

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* skip link: first focusable in the DOM — jumps past all chrome (unit 7 batch 3) */}
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div style={{ display: light ? 'block' : 'flex' }}>
        {!light && <Sidebar />}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Topbar onOpenPalette={() => setPaletteOpen(true)} />
          <SyncBanner />
          <div style={{ display: 'flex', flex: 1, minWidth: 0 }}>
            <main id="main-content" tabIndex={-1} style={{ flex: 1, minWidth: 0 }}>
              <AppRoutes />
            </main>
            {!light && <AiDock />}
          </div>
        </div>
      </div>
      <MobileTabbar />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

/* Public self-serve signup door (Platform §1.1): /onboard renders OUTSIDE the
   session tree — a brand-new school owner has no session yet. Everything else
   renders the normal gated app. */
function OnboardOrApp() {
  const { pathname } = useLocation();
  if (pathname === '/onboard') {
    return (
      <KernelProvider>
        <StoreProvider>
          <ToastProvider>
            <Routes>
              <Route path="/onboard" element={<Suspense fallback={<div style={{ minHeight: '100vh' }} />}><Onboard /></Suspense>} />
              <Route path="*" element={<Navigate to="/onboard" replace />} />
            </Routes>
          </ToastProvider>
        </StoreProvider>
      </KernelProvider>
    );
  }
  return <SessionApp />;
}

/* The normal gated app tree (was the direct body of App before the /onboard
   public door was added — same providers, unchanged). */
function SessionApp() {
  return (
    <KernelProvider>
      <StoreProvider>
        <ToastProvider>
          <BootGate>
            <AuthGate>
              {/* P0 fix 1: TeacherProvider is mounted once, around the whole
                  session frame — every /teacher screen's useTeacher() has a
                  provider and the white-screen throw never fires. */}
              <TeacherProvider>
                <Frame />
              </TeacherProvider>
            </AuthGate>
          </BootGate>
        </ToastProvider>
      </StoreProvider>
    </KernelProvider>
  );
}

export default function App() {
  return (
    /* P0 fix 1: the root ErrorBoundary wraps the WHOLE router so any
       render crash keeps the tree mounted and shows the calm fallback
       instead of unmounting to a white screen. */
    <ErrorBoundary>
      <BrowserRouter>
        <OnboardOrApp />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
