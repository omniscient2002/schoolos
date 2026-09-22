import { Suspense, lazy, useEffect, useState, createContext, useContext } from 'react';
import { setSessionIdentity } from './services/sessionIdentity';
import { KernelProvider, KernelGate } from './plugins/useKernel';
import './plugins/registerWidgets';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { StoreProvider, useStore } from './state/store';
import { ToastProvider } from './components/ui';
import { Sidebar, Topbar, CommandPalette } from './components/Shell';
import { MobileTabbar } from './components/DemoBar';
import { apiMe, apiMeEffective, setToken, getToken, LIVE_BASE } from './services/liveApi';
import type { EffectiveAccess } from './lib/effective';
import { ensureDataset } from './data/dataset';
import { sessionMustChange } from './screens/account/ChangePassword';
import { useLiveEventBridge } from './components/Maint';
import { SkeletonCard } from './components/ui';
import { Icon } from './components/Icon';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TeacherProvider } from './state/teacherContext';
import { mapAccountRole, isLightRole, homeForRole } from './lib/roles';
import { canSurface } from './lib/effective';

/* ---------- lazy screens ---------- */
const F = (loader: () => Promise<{ default: React.ComponentType }>) => lazy(loader);

const Login = lazy(() => import('./screens/Login'));
/* L5-2.1: self-service password change — forced flow (restricted mustChange
   session) and the voluntary /account/password page. plain lazy(), not F():
   this screen takes props (mode/onAuthed) and F() erases them. */
const ChangePassword = lazy(() => import('./screens/account/ChangePassword'));
/* L4-2.1's finance invoicing surface — routed on L4's blocks.md request
   (L5-2.2). The component is L4-owned; App.tsx only registers the route. */
const FeePlans = F(() => import('./screens/finance/FeePlans'));
/* L5-5.1: custom roles over L3-4.2's doors (owner/IT admin) */
const RolesAdmin = F(() => import('./screens/RolesAdmin'));
/* L5-5.2: generic plugin-settings form on L3-5.1's schema contract */
const PluginSettings = F(() => import('./screens/PluginSettings'));
/* self-serve school signup — public door (Platform §1.1, migration 053) */
const Onboard = lazy(() => import('./screens/Onboard'));
const Today = F(() => import('./screens/Today'));
const Attention = F(() => import('./screens/Attention'));
const Next = F(() => import('./screens/Next'));
const People = F(() => import('./screens/People'));
const PersonDetail = F(() => import('./screens/PersonDetail'));
const Learning = F(() => import('./screens/Learning'));
const Attendance = F(() => import('./screens/Attendance'));
/* school structure — configurable classes & sections (owner/principal/itadmin) */
const Classes = F(() => import('./screens/Classes'));
const Timetable = F(() => import('./screens/Timetable'));
const Operations = F(() => import('./screens/Operations'));
const Fees = F(() => import('./screens/Fees'));
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
const Reports = F(() => import('./screens/Reports'));
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
/* OPP: owner/principal oversight product (docs/OWNER-PRINCIPAL-PERFECT-100.md) */
const BoardPack = F(() => import('./screens/BoardPack'));
const PrincipalBrief = F(() => import('./screens/PrincipalBrief'));
const OversightHome = F(() => import('./screens/OversightHome')); /* OPP-API-1 */
const Announcements = F(() => import('./screens/Announcements'));
const Compliance = F(() => import('./screens/Compliance'));
const Certificates = F(() => import('./screens/Certificates'));
const Delegations = F(() => import('./screens/Delegations'));
const PeopleAdmin = F(() => import('./screens/PeopleAdmin'));
const LibraryHome = F(() => import('./screens/library/LibraryHome'));
const LibraryDesk = F(() => import('./screens/library/LibraryDesk'));
const LibraryDeskDashboard = F(() => import('./screens/library/desk/Dashboard'));
const LibraryDeskCatalog = F(() => import('./screens/library/desk/Catalog'));
const LibraryDeskAddBook = F(() => import('./screens/library/desk/AddBook'));
const LibraryDeskBook = F(() => import('./screens/library/desk/BookDetail'));
const LibraryDeskIssue = F(() => import('./screens/library/desk/Issue'));
const LibraryDeskReturn = F(() => import('./screens/library/desk/Return'));
const LibraryDeskHolds = F(() => import('./screens/library/desk/Holds'));
const LibraryDeskFines = F(() => import('./screens/library/desk/Fines'));
const LibraryDeskRequests = F(() => import('./screens/library/desk/Requests'));
const LibraryDeskMembers = F(() => import('./screens/library/desk/Members'));
const LibraryDeskReports = F(() => import('./screens/library/desk/Reports'));
const LibraryDeskSettings = F(() => import('./screens/library/desk/Settings'));
const LibraryInsights = F(() => import('./screens/library/LibraryInsights'));
const LibrarySetup = F(() => import('./screens/library/LibrarySetup'));
const RailsBoard = F(() => import('./screens/RailsBoard'));
const ParentHome = F(() => import('./screens/ParentHome'));
const ParentComplaints = F(() => import('./screens/ParentComplaints'));
const ParentChat = F(() => import('./screens/ParentChat'));
const ParentFees = F(() => import('./screens/ParentFees'));
const FamilyHome = F(() => import('./screens/parent/FamilyHome'));
const ParentConsents = F(() => import('./screens/parent/Consents'));
const ParentRequests = F(() => import('./screens/parent/Requests'));
const ParentCopilot = F(() => import('./screens/parent/Copilot'));
const StudentHome = F(() => import('./screens/StudentHome'));
const StudentFees = F(() => import('./screens/StudentFees'));
const StudentLearning = F(() => import('./screens/StudentLearning'));
const StudentPortfolio = F(() => import('./screens/StudentPortfolio'));
const StudentHome2 = F(() => import('./screens/student/StudentHome2'));
/* StudentOS staff desks (SU-3): print center + wellbeing + noticeboard */
const PrintQueue = F(() => import('./screens/student/PrintQueue'));
const WellbeingQueue = F(() => import('./screens/student/WellbeingQueue'));
const Noticeboard = F(() => import('./screens/student/Noticeboard'));
/* TeacherOS: home command center + classroom P6 doors (TU lanes) */
const TeacherHome = F(() => import('./screens/TeacherHome'));
const TeacherHomework = F(() => import('./screens/teacher/Homework'));
const SubmissionsInbox = F(() => import('./screens/teacher/SubmissionsInbox'));
const MyLeave = F(() => import('./screens/teacher/MyLeave'));
const TeacherCopilot = F(() => import('./screens/teacher/Copilot'));
const TeacherSupport = F(() => import('./screens/teacher/Support'));
const TeacherConcerns = F(() => import('./screens/teacher/Concerns'));
const TeacherDoubts = F(() => import('./screens/teacher/Doubts'));
const TeacherInterventions = F(() => import('./screens/teacher/Interventions'));
const TeacherPtm = F(() => import('./screens/teacher/Ptm'));
const TeacherSafetyBox = F(() => import('./screens/teacher/SafetyBox'));
const CounselorConcerns = F(() => import('./screens/CounselorConcerns')); /* OPP-PRD-8 */
const Appraisals = F(() => import('./screens/Appraisals')); /* OPP-PRD-11 */
const TeacherLessons = F(() => import('./screens/teacher/Lessons'));
const TeacherDutyWorkload = F(() => import('./screens/teacher/DutyWorkload'));
const MasteryMap = F(() => import('./screens/teacher/MasteryMap'));
const CurriculumProgress = F(() => import('./screens/teacher/CurriculumProgress'));
const ProgressStory = F(() => import('./screens/teacher/ProgressStory'));
const ExamMarks = F(() => import('./screens/teacher/ExamMarks'));
const ClassAnalytics = F(() => import('./screens/teacher/ClassAnalytics'));
const StudentHomework = F(() => import('./screens/student/learn/Homework'));
const StudentMistakes = F(() => import('./screens/student/learn/Mistakes'));
const StudentFlashcards = F(() => import('./screens/student/learn/Flashcards'));
const StudentStudyTasks = F(() => import('./screens/student/learn/StudyTasks'));
const StudentResults = F(() => import('./screens/student/learn/Results'));
const ParentChildFlows = F(() => import('./screens/parent/ChildFlowPage'));
/* CU-1 coordinator lane (CoordinatorOS) */
const CoordHome = F(() => import('./screens/coord/CoordHome'));
const CoordSubstitutions = F(() => import('./screens/coord/SubstitutionReview'));
const CoordWorkload = F(() => import('./screens/coord/WorkloadBoard'));
const CoordCurriculum = F(() => import('./screens/coord/CurriculumMonitor'));
const CoordEscalations = F(() => import('./screens/coord/EscalationsQueue'));
const CoordApprovals = F(() => import('./screens/coord/ApprovalCenter'));
const NotFound = F(() => import('./screens/NotFound'));

/* ---------- shared page frame ---------- */
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      {children}
      <div style={{ height: 40 }} />
    </div>
  );
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
/* RBAC-3b: an unrecognised role now fails CLOSED to the lightest surface. It used to become 'principal'
   — the broadest role — so any role string this client did not know rendered the management shell and
   passed the staff-only guard: a guess in the direction of maximum privilege. See app/src/lib/roles.ts. */

function Guard({ children }: { children: React.ReactNode }) {
  const { session } = useStore();
  const live = useSession();
  const { pathname } = useLocation();
  /* The live authenticated role is governed by `GET /me/effective`. The
     legacy list remains only for the explicit demo-role preview, which has no
     server session and therefore no effective-access payload. */
  /* PERFECT-100 §6.2 item 14: a route the SERVER says this caller may not reach is not rendered,
     whichever role they hold — a teacher deep-linking /roles now meets an honest screen instead of one
     that loads and then fails every request. Applied only when the store's role matches the authenticated
     identity, so the demo preview switcher (no server session) is unaffected; a surface the server has no
     opinion about is allowed, because the server still enforces every door. */
  if (mapAccountRole(live.role) === session.roleId && live.effective && !canSurface(live.effective, pathname)) {
    return (
      <PageShell>
        <div className="empty" style={{ padding: '80px 0' }}>
          <Icon.Lock size={28} />
          <h3>Not available for your role</h3>
          <p>This page is not part of what your account can reach. If you think that is wrong, ask your school owner or IT admin.</p>
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
export interface SessionUser {
  name: string; role: string; email: string;
  school?: { name: string | null; slug: string | null };
  /* RBAC-3/RBAC-6: the caller's OWN custom-role binding + mask, straight from /me. A display hint for
     choosing which controls to render — never an authorization decision (the server re-decides on every
     door). Without it a teacher-based custom role such as the shipped "Librarian" preset sees a module's
     title and none of its controls, because screens could only compare the built-in role string. */
  role_key?: string | null;
  custom?: { allow: string[]; deny: string[] } | null;
  /* PERFECT-100 §6.2 item 14: the server's effective-access answer (which surfaces this caller may
     render). A display hint from GET /me/effective — never an authorization decision. */
  effective?: EffectiveAccess;
}
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
  const { pathname } = useLocation();
  const navigate = useNavigate();

  /* L5-2.1: the forced-change flow. A force_change account's login answers
     403 + mustChange + a RESTRICTED token (limited to /me/password, /me,
     /auth/logout by the authenticate hook). The claim is read from our own
     just-issued token — no verification needed client-side — and every
     route other than /account/password bounces here until the change
     completes. */
  const completeSignIn = async (s: SessionUser) => {
    /* RBAC-3: /me is the authority for the session AND for the caller's own custom-role mask. The login
       response carries only {name, role, email}, so after a fresh sign-in a teacher-based custom role
       (the shipped "Librarian" preset) had no mask in the session and screens fell back to comparing the
       built-in role — the module rendered with its title and none of its controls until a manual reload.
       One extra request, and a failure must never block sign-in: the mask is a rendering hint, not a
       session requirement, so the login response stays the fallback. */
    let full = s;
    try {
      const me = await apiMe();
      full = { name: me.name, role: me.role, email: me.email, school: me.school, role_key: me.role_key ?? null, custom: me.custom ?? null };
      /* item 14: the effective-access answer rides the session the same way the mask does — one extra
         request, and a failure must never block sign-in (the server still enforces every door). */
      try { full = { ...full, effective: await apiMeEffective() }; } catch { /* render hint only */ }
    } catch { /* keep what login returned */ }
    localStorage.setItem('schoolos.session', JSON.stringify(full));
    await ensureDataset();
    setRole(mapAccountRole(full.role));
    setSession(full);
    setSessionIdentity(full);
  };
  const accountScreens = (
    <ChangePassword
      mode="gate"
      onAuthed={completeSignIn}
      onCancel={() => setSession(null)}
    />
  );

  /* The front door validates against the server on every cold open.
     A stored session alone is NEVER trusted — only a live /me answer is. */
  useEffect(() => {
    let dead = false;
    (async () => {
      /* L5-3.2 silent renew: no local token, but a same-origin HttpOnly
         cookie session may still be alive (page reload, closed-tab return).
         POST /auth/renew exchanges it for a fresh bearer token. The door
         does not exist yet (review-verified; L2 owns it) — the probe is
         flag-gated OFF so logged-out cold opens don't fire a guaranteed
         404, and it can be flipped on the moment L2 ships the door. */
      const RENEW_DOOR_LIVE = true // /auth/renew LANDED (D-37(e));
      if (RENEW_DOOR_LIVE && !getToken()) {
        try {
          const res = await fetch(`${LIVE_BASE}/auth/renew`, { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(3000) });
          if (res.ok) {
            const b = (await res.json().catch(() => ({}))) as { token?: string };
            if (typeof b.token === 'string' && b.token) setToken(b.token);
          }
        } catch { /* no cookie session — fall through to login */ }
      }
      if (!getToken()) { setBooting(false); return; }
      /* /me is the only call whose failure means "no session" — and call()
         has already wiped + redirected on its 401 by the time it throws. */
      let me: Awaited<ReturnType<typeof apiMe>> | null = null;
      try {
        me = await apiMe();
      } catch {
        if (!dead) setBooting(false);
        return;
      }
      /* unit 16 (A1): the restore path mirrors the login path's setRole call —
         without it the store's roleId stayed at its default and drifted from
         the authenticated identity (unit-14 finding). Auth validation itself
         is unchanged: only a live /me answer establishes a session, and token
         handling (setToken/call) is untouched. */
      let effective: EffectiveAccess | undefined;
      try { effective = await apiMeEffective(); } catch { /* render hint only; server still enforces */ }
      if (!dead) {
        setRole(mapAccountRole(me.role));
        setSession({ name: me.name, role: me.role, email: me.email, school: me.school, role_key: me.role_key ?? null, custom: me.custom ?? null, effective });
        setSessionIdentity({ name: me.name, email: me.email });
      }
      /* L5-2.1 (review BLOCKER-2 fix): a restored RESTRICTED session must not
         hydrate the dataset at all — GET /dataset 403s for mustChange tokens
         and the old code treated that as a dead session, wiping the token on
         a mere reload. Land on the password-change screen instead and skip
         hydration; it runs after the forced change completes a full session. */
      if (sessionMustChange()) {
        if (!dead && pathname !== '/account/password') {
          navigate('/account/password?reason=forced', { replace: true });
        }
        setBooting(false);
        return;
      }
      /* Workspace hydration failure is NOT an auth failure — the person is
         still signed in; screens render their own error/empty states from
         the failed dataset rather than the user being logged out (review
         MINOR-11: a flaky connection must not wipe credentials). */
      try {
        await ensureDataset();
      } catch { /* dataset errors surface per-screen; session stands */ }
      if (!dead) setBooting(false);
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
  /* Restricted (mustChange) session: the password-change screen is the ONLY
     render, wherever the user was headed — including straight from the login
     403, where the restricted token exists but no session has been set yet. */
  if (sessionMustChange()) return accountScreens;
  if (!session) return <Login onAuthed={completeSignIn} />;
  return (
    <SessionCtx.Provider value={session}>
      {children}
    </SessionCtx.Provider>
  );
}

/* I2: admissions and visitors now use the SAME KernelGate as every other module surface, so
   "switched off" looks and behaves identically everywhere (with the owner's one-click turn-on).
   The old bespoke hosts kept a labelled demo screen alive as the off-state; that mock plane is
   retired here — the honest off-state is the module gate. */


/* Each role lands on its own main page, not the generic Today: the server gates /today behind GET /actions,
   which parent, student and librarian do not hold, so the generic landing showed them "Not available for
   your role" on sign-in. Any navigation to /today self-corrects here, whatever sign-in method produced it.
   homeForRole returns '/today' for every role that can render it, so this only redirects the roles that
   cannot (see app/src/lib/roles.ts). */
function RoleHome({ children }: { children: React.ReactNode }) {
  const { role } = useSession();
  const home = homeForRole(role);
  return home === '/today' ? <S>{children}</S> : <Navigate to={home} replace />;
}

function AppRoutes() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/today" replace />} />
      <Route path="/login" element={<Navigate to="/today" replace />} />
      <Route path="/today" element={<RoleHome><Today /></RoleHome>} />
      <Route path="/attention" element={<S><Attention /></S>} />
      <Route path="/next" element={<S><Next /></S>} />
      <Route path="/people" element={<S><People /></S>} />
      <Route path="/people/:id" element={<S><PersonDetail /></S>} />
      <Route path="/learning" element={<S><Learning /></S>} />
      <Route path="/attendance" element={<S><Attendance /></S>} />
      {/* school structure: owner/principal/IT admin define the classes & sections every picker uses */}
      <Route path="/classes" element={<S><Classes /></S>} />
      {/* M3/M4: the timetable write surface — gated on the ops.timetable plugin like every module */}
      <Route path="/timetable" element={<S><KernelGate plugin="ops.timetable"><Timetable /></KernelGate></S>} />
      <Route path="/operations" element={<S><Operations /></S>} />
      <Route path="/fees" element={<S><Fees /></S>} />
      {/* L5-2.2 (L4-2.1 request): dedicated fee-plans door for finance/owner/principal */}
      <Route path="/fees/plans" element={<S><FeePlans /></S>} />
      <Route path="/admissions" element={<S><KernelGate plugin="admissions.funnel"><FunnelBoard /></KernelGate></S>} />
      <Route path="/visitors" element={<S><KernelGate plugin="ops.visitors"><VisitorsBoard /></KernelGate></S>} />
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
      <Route path="/plugins" element={<S><PluginsScreen /></S>} />
      {/* live admin/ops surfaces (build-out wave D): real doors behind the
          plugin gates — the demo Library remains the fallback when off */}
      <Route path="/people-admin" element={<S><KernelGate plugin="people.admin"><PeopleAdmin /></KernelGate></S>} />
      {/* library v2 (docs/LIBRARY-DESIGN.md): borrower catalog, librarian desk, owner/principal ops,
          and the setup wizard. Each surface names its real door; the server enforces the role. */}
      <Route path="/library" element={<S><KernelGate plugin="library"><LibraryHome /></KernelGate></S>} />
      {/* the desk is a sectioned workspace: one persistent nav, one page per job */}
      <Route path="/library/desk" element={<S><KernelGate plugin="library"><LibraryDesk /></KernelGate></S>}>
        <Route index element={<LibraryDeskDashboard />} />
        <Route path="issue" element={<LibraryDeskIssue />} />
        <Route path="return" element={<LibraryDeskReturn />} />
        <Route path="catalog" element={<LibraryDeskCatalog />} />
        <Route path="catalog/new" element={<LibraryDeskAddBook />} />
        <Route path="catalog/:id" element={<LibraryDeskBook />} />
        <Route path="holds" element={<LibraryDeskHolds />} />
        <Route path="fines" element={<LibraryDeskFines />} />
        <Route path="requests" element={<LibraryDeskRequests />} />
        <Route path="members" element={<LibraryDeskMembers />} />
        <Route path="reports" element={<LibraryDeskReports />} />
        <Route path="settings" element={<LibraryDeskSettings />} />
      </Route>
      <Route path="/library/insights" element={<S><KernelGate plugin="library"><LibraryInsights /></KernelGate></S>} />
      <Route path="/library/setup" element={<S><KernelGate plugin="library"><LibrarySetup /></KernelGate></S>} />
      <Route path="/rails" element={<S><RailsBoard /></S>} />
      <Route path="/maintenance/report" element={<S><ReportIssue /></S>} />
      <Route path="/operations/hr" element={<S><HR /></S>} />
      <Route path="/calendar" element={<S><CalendarScreen /></S>} />
      <Route path="/cases" element={<S><Cases /></S>} />
      <Route path="/cases/:id" element={<S><CaseDetail /></S>} />
      <Route path="/incidents" element={<S><Incidents /></S>} />
      <Route path="/insights" element={<S><Insights /></S>} />
      <Route path="/reports" element={<S><Reports /></S>} />
      <Route path="/automation" element={<S><Automation /></S>} />
      <Route path="/constitution" element={<S><Constitution /></S>} />
      <Route path="/memory" element={<S><Memory /></S>} />
      <Route path="/data-health" element={<S><DataHealth /></S>} />
      <Route path="/action-center" element={<S><ActionCenter /></S>} />
      <Route path="/audit" element={<S><Audit /></S>} />
      <Route path="/ai-governance" element={<S><AiGovernance /></S>} />
      <Route path="/ai-usage" element={<S><AiUsage /></S>} />
      <Route path="/group" element={<S><Group /></S>} />
      <Route path="/board-pack" element={<S><BoardPack /></S>} />
      <Route path="/principal-brief" element={<S><PrincipalBrief /></S>} />
      <Route path="/owner/home" element={<S><OversightHome /></S>} />
      <Route path="/principal/home" element={<S><OversightHome /></S>} />
      <Route path="/announcements" element={<S><Announcements /></S>} />
      <Route path="/compliance" element={<S><Compliance /></S>} />
      <Route path="/certificates" element={<S><Certificates /></S>} />
      <Route path="/delegations" element={<S><Delegations /></S>} />
      <Route path="/it" element={<S><ItAdmin /></S>} />
      <Route path="/settings" element={<S><Settings /></S>} />
      {/* L5-5.1: custom-roles console — owner + IT admin (server ROLES_ADMIN) */}
      <Route path="/roles" element={<S><RolesAdmin /></S>} />
      {/* L5-5.2: plugin settings — list + per-plugin form (owner + IT admin) */}
      <Route path="/plugins/settings" element={<S><PluginSettings /></S>} />
      <Route path="/plugins/settings/:id" element={<S><PluginSettings /></S>} />
      {/* L5-2.1: voluntary self-service password change (any signed-in role;
          deliberately NOT in the staffOnly list — parents/students change
          their own passwords here too). The forced flow renders the same
          screen from AuthGate before any route exists. */}
      <Route path="/account/password" element={<S><ChangePassword mode="page" /></S>} />
      <Route path="/parent" element={<S><ParentHome /></S>} />
      <Route path="/parent/complaints" element={<S><ParentComplaints /></S>} />
      <Route path="/parent/chat" element={<S><ParentChat /></S>} />
      <Route path="/parent/fees" element={<S><ParentFees /></S>} />
      <Route path="/parent/family" element={<S><FamilyHome /></S>} />
      <Route path="/parent/consents" element={<S><ParentConsents /></S>} />
      <Route path="/parent/requests" element={<S><ParentRequests /></S>} />
      <Route path="/parent/copilot" element={<S><ParentCopilot /></S>} />
      {/* PRD-5: per-child flow hub */}
      <Route path="/parent/child/:id" element={<S><ParentChildFlows /></S>} />
      <Route path="/student" element={<S><StudentHome /></S>} />
      <Route path="/student/home2" element={<S><StudentHome2 /></S>} />
      <Route path="/student/fees" element={<S><StudentFees /></S>} />
      <Route path="/student/learning" element={<S><StudentLearning /></S>} />
      <Route path="/student/portfolio" element={<S><StudentPortfolio /></S>} />
      {/* PRD-6: the student learn lane */}
      <Route path="/student/homework" element={<S><StudentHomework /></S>} />
      <Route path="/student/mistakes" element={<S><StudentMistakes /></S>} />
      <Route path="/student/flashcards" element={<S><StudentFlashcards /></S>} />
      <Route path="/student/tasks" element={<S><StudentStudyTasks /></S>} />
      <Route path="/student/results" element={<S><StudentResults /></S>} />
      {/* TeacherOS: command center + P6 classroom doors (staff-gated) */}
      <Route path="/teacher" element={<S><TeacherHome /></S>} />
      <Route path="/teacher/homework" element={<S><TeacherHomework /></S>} />
      <Route path="/teacher/submissions" element={<S><SubmissionsInbox /></S>} />
      {/* T508: P8 teacher self-leave — screen existed unrouted; both doors are
          live (teacher.classroom:239 POST /teacher/leave, :271 GET /mine) */}
      <Route path="/teacher/leave" element={<S><MyLeave /></S>} />
      {/* PRD-4: the teaching copilot (ask + draft) — previously unregistered */}
      <Route path="/teacher/copilot" element={<S><TeacherCopilot /></S>} />
      {/* PRD-1: the student-support desk (concerns/doubts/interventions/PTM/safety) */}
      <Route path="/teacher/support" element={<S><TeacherSupport /></S>} />
      <Route path="/teacher/concerns" element={<S><TeacherConcerns /></S>} />
      <Route path="/teacher/doubts" element={<S><TeacherDoubts /></S>} />
      <Route path="/teacher/interventions" element={<S><TeacherInterventions /></S>} />
      <Route path="/teacher/ptm" element={<S><TeacherPtm /></S>} />
      <Route path="/teacher/safety" element={<S><TeacherSafetyBox /></S>} />
      {/* PRD-2: lessons lifecycle */}
      <Route path="/teacher/lessons" element={<S><TeacherLessons /></S>} />
      {/* PRD-3: duty roster + workload */}
      <Route path="/teacher/duties" element={<S><TeacherDutyWorkload /></S>} />
      {/* PRD-9: previously orphaned insight screens are now routed */}
      <Route path="/teacher/mastery" element={<S><MasteryMap /></S>} />
      <Route path="/teacher/curriculum" element={<S><CurriculumProgress /></S>} />
      <Route path="/teacher/progress-story" element={<S><ProgressStory /></S>} />
      <Route path="/teacher/exam-marks" element={<S><ExamMarks /></S>} />
      <Route path="/teacher/analytics" element={<S><ClassAnalytics /></S>} />
      {/* StudentOS staff desks — paper-first ops behind the student surface (staff-gated) */}
      <Route path="/print-queue" element={<S><PrintQueue /></S>} />
      <Route path="/wellbeing-queue" element={<S><WellbeingQueue /></S>} />
      <Route path="/counselor/concerns" element={<S><CounselorConcerns /></S>} />
      <Route path="/appraisals" element={<S><Appraisals /></S>} />
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
  const { dispatch } = useStore();
  const live = useSession();
  /* FEX-7 one role notion: the authenticated server role decides light/staff chrome. */
  const light = isLightRole(live.role);
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
          {/* T303 (§9.13): BootGate — a pure 420 ms setTimeout that showed a
              "Meridian" splash before the session loaded — is gone. The only
              boot indicator is AuthGate's spinner, which renders while real
              work happens (live /me validation + /dataset hydration). */}
          <AuthGate>
              {/* P0 fix 1: TeacherProvider is mounted once, around the whole
                  session frame — every /teacher screen's useTeacher() has a
                  provider and the white-screen throw never fires. */}
              <TeacherProvider>
                <Frame />
              </TeacherProvider>
            </AuthGate>
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
