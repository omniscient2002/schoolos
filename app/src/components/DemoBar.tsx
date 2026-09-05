import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { Dropdown, Modal, useToast } from './ui';
import { useStore } from '../state/store';
import { SCENARIOS } from '../data/dataset';
import type { Scenario } from '../types/domain';
import * as seed from '../data/dataset';
import { assets as mAssets } from '../data/dataset';
import type { WOCategory, MaintPriority } from '../types/domain';
import { fmtDateShort, fmtMoneyShort } from '../lib/format';
import { LIVE_API } from '../services/liveApi';

/* Map scenario screens to routes */
function screenRoute(screen: string): string {
  const s = screen.toLowerCase();
  if (s.includes('transport') || s.includes('event stream')) return '/transport';
  if (s.includes('attention')) return '/attention';
  if (s.includes('parent messages') || s.includes('cases')) return '/cases';
  if (s.includes('today')) return '/today';
  if (s.includes('ask')) return '/ask';
  if (s.includes('action center') || s.includes('action detail')) return '/action-center';
  if (s.includes('incident')) return '/incidents';
  if (s.includes('audit')) return '/audit';
  if (s.includes('memory')) return '/memory';
  if (s.includes('fee') || s.includes('what changed')) return '/fees';
  if (s.includes('insights')) return '/insights';
  if (s.includes('data health')) return '/data-health';
  if (s.includes('workflow')) return '/automation';
  if (s.includes('admissions') || s.includes('lead')) return '/admissions';
  if (s.includes('calendar')) return '/calendar';
  if (s.includes('documents')) return '/documents';
  if (s.includes('constitution')) return '/constitution';
  if (s.includes('people')) return '/people';
  if (s.includes('obligations')) return '/today';
  if (s.includes('reception') || s.includes('front desk')) return '/reception';
  if (s.includes('migration') || s.includes('switch')) return '/migration';
  if (s.includes('report')) return '/maintenance/report';
  if (s.includes('work order')) return '/maintenance/work-orders';
  if (s.includes('maintenance board') || s.includes('maintenance overview')) return '/maintenance';
  if (s.includes('technician')) return '/maintenance/technician';
  if (s.includes('asset')) return '/maintenance/assets';
  if (s.includes('facilities map') || s.includes('map')) return '/maintenance/map';
  if (s.includes('inventory')) return '/maintenance/inventory';
  if (s.includes('intelligence') || s.includes('replacement')) return '/maintenance/intelligence';
  if (s.includes('notifications')) return '/attention';
  return '/today';
}

/* ================= Scenario player modal ================= */
export function ScenarioPlayer({ scenario, onClose }: { scenario: Scenario | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  useEffect(() => { setStep(0); }, [scenario]);
  if (!scenario) return null;
  const s = scenario.steps[step];
  return (
    <Modal open={!!scenario} onClose={onClose} title={scenario.title} sub={scenario.blurb} size="lg"
      footer={
        <div className="u-between" style={{ width: '100%' }}>
          <span className="u-small u-faint">Step {step + 1} of {scenario.steps.length}</span>
          <div className="u-flex" style={{ gap: 8 }}>
            {step > 0 && <button className="btn btn-ghost" onClick={() => setStep(x => x - 1)}>Back</button>}
            <button className="btn btn-secondary" onClick={() => navigate(screenRoute(s.screen))}>Show me this screen</button>
            {step < scenario.steps.length - 1
              ? <button className="btn btn-primary" onClick={() => setStep(x => x + 1)}>Next step</button>
              : <button className="btn btn-primary" onClick={onClose}>Finish</button>}
          </div>
        </div>
      }>
      <div className="u-col" style={{ gap: 14 }}>
        <div className="progress" style={{ height: 5 }}><div style={{ width: `${((step + 1) / scenario.steps.length) * 100}%` }} /></div>
        <div className="ai-surface" style={{ padding: 16, borderRadius: 'var(--r-lg)' }}>
          <div className="u-flex" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span className="badge badge-accent">{s.label}</span>
            <span className="u-xs u-faint">appears on: {s.screen}</span>
          </div>
          <div style={{ fontSize: 'var(--text-lg)', fontWeight: 570, lineHeight: 1.5 }}>{s.detail}</div>
        </div>
        <div className="u-flex" style={{ gap: 4, flexWrap: 'wrap' }}>
          {scenario.steps.map((x, i) => (
            <button key={i} onClick={() => setStep(i)} title={x.label} aria-label={`Step ${i + 1}: ${x.label}`}
              style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid ' + (i === step ? 'var(--accent)' : i < step ? 'var(--accent-weak-2)' : 'var(--border)'), background: i === step ? 'var(--accent)' : i < step ? 'var(--accent-weak)' : 'var(--surface)', color: i === step ? '#fff' : 'var(--text-3)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              {i + 1}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/* ================= Demo bar ================= */
const SIM_EVENTS: { type: string; label: string; severity: 'info' | 'warn' | 'critical' }[] = [
  { type: 'attendance', label: 'Attendance marked — 7-A complete · 2 absent', severity: 'info' },
  { type: 'payment', label: 'Fee payment received · ₹46,000 · UPI', severity: 'info' },
  { type: 'transport', label: 'Route 4 — Green Park running 6 min early', severity: 'info' },
  { type: 'workflow', label: 'Workflow wf_1 completed — guardian notified of absence', severity: 'info' },
  { type: 'case', label: 'New case via parent WhatsApp — fee installment request', severity: 'warn' },
  { type: 'transport', label: 'Route 9 — Market stopped 11 min at Market Stop 2', severity: 'warn' },
  { type: 'system', label: 'Reconciliation worker matched 18 gateway payments', severity: 'info' },
  { type: 'attendance', label: 'Attendance anomaly watch — 9-B presence 71%', severity: 'warn' },
  { type: 'message', label: 'Bulk message approved and sent — Grade 6 excursion', severity: 'info' },
  { type: 'maintenance', label: 'Technician Ravi started WO-1044 — water cooler, Block B', severity: 'info' },
  { type: 'maintenance', label: 'New maintenance report — Block B · QR scan NOR-WC-07', severity: 'info' },
  { type: 'maintenance', label: 'Generator inspection overdue — compliance window closed 5d ago', severity: 'warn' },
  { type: 'maintenance', label: 'WO-1042 SLA note — resolution due in 6h (AC-04, 4th failure)', severity: 'warn' },
  { type: 'maintenance', label: 'Classroom 7-A lights repaired — verified by facilities desk', severity: 'info' },
];

export function DemoBar() {
  const { domain, dispatch, setRole, session, actorName } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [simOn, setSimOn] = useState(true);
  const [scenariosOpen, setScenariosOpen] = useState(false);
  const simIdx = useRef(0);
  const isLight = ['parent', 'student'].includes(session.roleId);

  /* live simulated event stream */
  useEffect(() => {
    if (!simOn) return;
    const iv = setInterval(() => {
      const e = SIM_EVENTS[simIdx.current % SIM_EVENTS.length];
      simIdx.current++;
      dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), ...e } });
    }, 7000);
    return () => clearInterval(iv);
  }, [simOn, dispatch]);

  const simulateBusDelay = () => {
    dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'transport', label: 'Bus 14 (Route 7) delayed +13 min — Sector 12 bridge · 38 students affected', severity: 'warn' } });
    toast({ title: 'Bus 14 delay simulated', sub: 'Guardians of 38 students will be notified within 15 min (Transport §3.1)', tone: 'info' });
  };
  const simulatePayment = () => {
    const demoFee = seed.feeObligations.find(f => f.studentId === seed.DEMO_STUDENT.id && f.term.startsWith('Term 2'));
    dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'payment', label: `Fee payment received · ${fmtMoneyShort(demoFee?.amount ?? 63500)} · UPI · Term 2`, severity: 'info' } });
    toast({ title: 'Payment received', sub: `${fmtMoneyShort(demoFee?.amount ?? 63500)} · UPI · receipt queued for WhatsApp delivery`, tone: 'success' });
  };
  const generateIncident = () => {
    dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'incident', label: 'Incident detected — chemistry lab double-booking (Grade 10, 6 periods)', severity: 'critical' } });
    toast({ title: 'Incident generated', sub: 'Timetable engine flagged 6 clashes · case opened for coordinator', tone: 'error' });
    navigate('/incidents');
  };
  /* ---------- maintenance simulations — each mutates real state ---------- */
  const simWO = (title: string, category: WOCategory, assetId: string, priority: MaintPriority, text: string) => {
    const asset = mAssets.find(a => a.id === assetId);
    const now = new Date();
    const wo = {
      id: `WO-${1046 + Math.floor(Math.random() * 40)}`,
      title, description: text, source: 'staff' as const, category,
      assetId, campus: (asset?.campus ?? 'north'), building: asset?.building ?? '—', room: asset?.room,
      priority, status: 'reported' as const,
      reportedBy: actorName, reportedRole: session.roleId, reportedOn: now,
      sla: { responseMins: 30, resolveMins: 480, responseBy: new Date(now.getTime() + 30 * 60000), resolveBy: new Date(now.getTime() + 480 * 60000) },
      timeline: [
        { on: now, actor: actorName, note: `Simulated: ${text}`, kind: 'note' as const },
        { on: now, actor: 'SchoolOS', note: `Classified ${category} · asset ${assetId} · priority ${priority.toUpperCase()} (safety/impact rules)`, kind: 'ai' as const },
      ],
    };
    dispatch({ type: 'wo/create', wo });
    return wo;
  };
  const simulateACFailure = () => {
    const wo = simWO('Science Lab AC trips breaker again — 5th failure', 'HVAC', 'NOR-AC-04', 'high', 'AC in room 204 running then tripping. Same as last week.');
    toast({ title: 'AC failure simulated', sub: `${wo.id} filed on NOR-AC-04 · recurrence flagged (5th in 63 days) · health drops`, tone: 'error' });
    navigate('/maintenance');
  };
  const simulateElevator = () => {
    const wo = simWO('Lift stopped between floors — 2 people inside', 'Safety', 'NOR-EL-02', 'emergency', 'Lift halted between 1st and 2nd. Two people inside, calm, intercom working.');
    dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'maintenance', label: 'EMERGENCY — lift entrapment, Block A. Emergency protocol Facilities §1.2 active', severity: 'critical' } });
    toast({ title: 'Elevator emergency simulated', sub: `${wo.id} · auto-escalated to facilities desk + principal · vendor AMC notified`, tone: 'error' });
    navigate('/maintenance/work-orders');
  };
  const simulatePlumbing = () => {
    const wo = simWO('Washroom supply line leak — Block B floor 2', 'Plumbing', 'NOR-WC-07', 'critical', 'Water spreading from the supply line near the washroom. Mops down, valve closing.');
    toast({ title: 'Plumbing emergency simulated', sub: `${wo.id} · critical · Ravi Kumar recommended (plumbing, 0.3 km)`, tone: 'error' });
    navigate('/maintenance');
  };
  const simulateSLABreach = () => {
    const wo = domain.workOrders.find(w => w.id === 'WO-1044');
    if (wo) dispatch({ type: 'wo/patch', id: 'WO-1044', patch: { slaBreached: true, escalation: 'supervisor' }, actor: 'Simulation', note: 'SLA breached — escalated to facilities supervisor' });
    dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'maintenance', label: 'SLA breach — WO-1044 water cooler (Block B) · escalated to supervisor', severity: 'critical' } });
    toast({ title: 'SLA breach simulated', sub: 'WO-1044 crossed its resolution window · escalation recorded in audit ledger', tone: 'error' });
    navigate('/maintenance/work-orders');
  };
  const simulatePartsShortage = () => {
    dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'maintenance', label: 'Parts shortage — R32 refrigerant stock 0 · WO-1042 blocked', severity: 'warn' } });
    dispatch({ type: 'wo/patch', id: 'WO-1042', patch: { holdReason: 'Waiting on part: R32 refrigerant kit — purchase request raised' }, actor: 'Simulation', note: 'Blocked on parts' });
    toast({ title: 'Parts shortage simulated', sub: 'WO-1042 blocked on refrigerant · purchase request auto-raised · vendor notified', tone: 'error' });
    navigate('/maintenance/inventory');
  };

  const simulateTeacherAbsence = () => {
    dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'attendance', label: 'Teacher absence — Ms. Fernandes (6-C) reported sick · substitution drafted from availability grid', severity: 'warn' } });
    toast({ title: 'Teacher absence simulated', sub: 'Substitution proposed → coordinator approval · guardian notice suppressed (not parent-relevant)', tone: 'info' });
  };
  const simulateFeeFailure = () => {
    dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'fees', label: 'UPI timeout cluster — 3 more Route 7 households unsettled (Oct morning pattern)', severity: 'warn' } });
    toast({ title: 'Fee failure simulated', sub: 'Cluster logic links it to Route 7 disruption · no auto-reminder until pattern confirms', tone: 'error' });
    navigate('/fees');
  };
  const simulateParentMessage = () => {
    dispatch({ type: 'chat/add', msg: { id: `c_${Date.now()}`, from: 'guardian', text: 'Hello, is the Bus 14 route running late today? My daughter waits at Sector 12.', on: new Date(), status: 'sent' } });
    dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'comms', label: 'Parent message received — intent: transport (Bus 14) · verification pending', severity: 'info' } });
    toast({ title: 'Parent message simulated', sub: 'Orchestrator classifies → verified answer drafts from GPS. Open the demo parent loop to see the full flow.', tone: 'info' });
    navigate('/demo/parent');
  };
  const simulateDeskCall = () => {
    dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'reception', label: 'Front desk — call from Route 7 parent answered in 3s (Bus 14 tracking sent on WhatsApp)', severity: 'info' } });
    toast({ title: 'Front-desk call simulated', sub: 'AI answered from transport GPS + calendar — grounded, consented, logged', tone: 'info' });
    navigate('/reception');
  };
  const simulateMigration = () => {
    dispatch({ type: 'event/add', e: { id: `ev_${Date.now()}`, on: new Date(), type: 'migration', label: 'Migration — dry-run re-import finished: 5,099 rows, 85 flags, 0 overwrites', severity: 'info' } });
    toast({ title: 'Migration dry-run simulated', sub: 'Nothing goes live without the coordinator’s verification pass', tone: 'info' });
    navigate('/migration');
  };

  const resetDemo = () => {
    dispatch({ type: 'reset' });
    setRole('principal');
    navigate('/today');
    toast({ title: 'Demo reset', sub: 'Role: Principal · scenario state cleared', tone: 'info' });
  };

  return (
    <>
      <div className={`demo-bar ${isLight ? 'demo-bar-light' : ''}`} role="toolbar" aria-label="Demo controls">
        <span className="demo-title"><span className="dot" /> DEMO · Simulation Mode</span>
        <button className={simOn ? 'on' : ''} onClick={() => { setSimOn(s => !s); toast({ title: simOn ? 'Simulation paused' : 'Simulation running', sub: simOn ? 'Live event stream stopped' : 'Events will arrive every few seconds', tone: 'info' }); }}>
          <Icon.Zap size={12} /> {simOn ? 'Live' : 'Paused'}
        </button>
        <button onClick={() => setScenariosOpen(true)}><Icon.Play size={12} /> Scenarios</button>
        <button onClick={simulateBusDelay}><Icon.Bus size={12} /> Simulate Bus 14 delay</button>
        <button onClick={simulatePayment}><Icon.Money size={12} /> Simulate payment</button>
        <button onClick={simulateParentMessage}><Icon.Message size={12} /> Parent message</button>
        <button onClick={simulateFeeFailure}><Icon.Alert size={12} /> Fee failure</button>
        <button onClick={simulateTeacherAbsence}><Icon.Users size={12} /> Teacher absence</button>
        <button onClick={() => navigate('/demo/day')}><Icon.Play size={12} /> Simulate school day</button>
        <button onClick={() => navigate('/demo')}><Icon.Sparkle size={12} /> Golden loops</button>
        {LIVE_API && <button onClick={() => navigate('/live')}><Icon.Database size={12} /> Live API</button>}
        <button onClick={generateIncident}><Icon.Alert size={12} /> Generate incident</button>
        <Dropdown trigger={() => (<><Icon.Wrench size={12} /> Maintenance sims</>)} align="left">
          <button onClick={simulateACFailure}><Icon.Zap size={13} /> AC failure (repeat)</button>
          <button onClick={simulateElevator}><Icon.Alert size={13} /> Elevator entrapment</button>
          <button onClick={simulatePlumbing}><Icon.Grid size={13} /> Plumbing emergency</button>
          <button onClick={simulateSLABreach}><Icon.Clock size={13} /> SLA breach</button>
          <button onClick={simulatePartsShortage}><Icon.Layers size={13} /> Parts shortage</button>
          <button onClick={simulateDeskCall}><Icon.Phone size={13} /> Front-desk call</button>
          <button onClick={simulateMigration}><Icon.Database size={13} /> Migration dry-run</button>
        </Dropdown>
        {!!domain.events.length && (
          <span className="u-xs" style={{ color: 'rgba(255,255,255,.55)', marginLeft: 4 }}>
            {domain.events.length} event{domain.events.length > 1 ? 's' : ''} · last: {fmtDateShort(domain.events[0].on)}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={resetDemo}><Icon.Refresh size={12} /> Reset demo</button>
      </div>
      <ScenarioPlayer scenario={scenario} onClose={() => setScenario(null)} />
      <Modal open={scenariosOpen} onClose={() => setScenariosOpen(false)} title="Demo scenarios" sub="End-to-end journeys through the operating loop. Each walks you screen by screen." size="lg">
        <div className="grid grid-2">
          {SCENARIOS.map((sc, i) => (
            <div key={sc.id} className="card card-pad card-click" style={i === 0 ? { borderColor: 'var(--accent)', borderWidth: 1.5 } : undefined}
              onClick={() => { setScenariosOpen(false); setScenario(sc); }}>
              {i === 0 && <span className="badge badge-accent" style={{ marginBottom: 8 }}>Flagship</span>}
              <div style={{ fontWeight: 640, fontSize: 'var(--text-lg)' }}>{sc.title}</div>
              <div className="u-small u-muted" style={{ margin: '6px 0 10px', lineHeight: 1.55 }}>{sc.blurb}</div>
              <div className="u-xs u-faint">{sc.steps.length} steps · guided walkthrough</div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
/* ================= Mobile tabbar ================= */
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
