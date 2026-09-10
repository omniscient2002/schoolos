/* ============================================================
   Session + domain state (frontend-only).
   Replaces: auth context, tenant context, server cache.
   When the backend arrives, repositories in /services swap to
   API implementations and this store thins out.
   ============================================================ */
import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import { sessionUserName } from '../services/sessionIdentity';
import type { ActionRecord, CampusId, ChatMsg, LiveEvent, Notification, RoleId, SchoolCase, WorkOrderRecord, WOStatus } from '../types/domain';
import * as seed from '../data/dataset';
import { datasetReady, campuses, ensureDataset } from '../data/dataset';

export interface Session {
  roleId: RoleId;
  campusScope: CampusId | 'all';
  activeCampus: CampusId;
}

interface DomainState {
  workOrders: WorkOrderRecord[];
  actions: ActionRecord[];
  cases: SchoolCase[];
  notifications: Notification[];
  chat: ChatMsg[];
  audit: { id: string; on: Date; actor: string; actorRole: RoleId; action: string; recordType: string; recordRef: string; reason?: string; policyRef?: string; aiInvolved: boolean; risk: 'low'|'medium'|'high'; outcome: string }[];
  events: LiveEvent[];
  offlineQueue: number;
  syncing: boolean;
}

type DomainAction =
  | { type: 'wo/create'; wo: WorkOrderRecord }
  | { type: 'wo/patch'; id: string; patch: Partial<WorkOrderRecord>; actor: string; note?: string }
  | { type: 'wo/advance'; id: string; to: WOStatus; actor: string; note?: string; actorRole?: RoleId }
  | { type: 'action/decide'; id: string; decision: 'approved' | 'dismissed'; actor: string; role: RoleId; note?: string }
  | { type: 'case/advance'; id: string; status: SchoolCase['status']; note?: string; actor?: string }
  | { type: 'case/add'; c: SchoolCase }
  | { type: 'notification/read'; id?: string; all?: boolean }
  | { type: 'chat/add'; msg: ChatMsg }
  | { type: 'chat/updateStatus'; id: string; status: ChatMsg['status'] }
  | { type: 'audit/add'; entry: Omit<DomainState['audit'][number], 'id' | 'on'> }
  | { type: 'event/add'; e: LiveEvent }
  | { type: 'offline/queue'; n: number }
  | { type: 'sync/flush' }
  | { type: 'domain/hydrate' }
  | { type: 'reset' };

/* T301 (§9.1): domain slices start EMPTY. They used to be snapshotted here at
   module-eval — before /dataset hydration — so workOrders/actions/cases/
   notifications/chat/audit were empty arrays forever and the whole layer was
   dead in every session. The provider now dispatches 'domain/hydrate' once
   ensureDataset() resolves; the reducer then reads the live dataset bindings. */
const initialState: DomainState = {
  workOrders: [],
  actions: [],
  cases: [],
  notifications: [],
  chat: [],
  audit: [],
  events: [],
  /* P0 fix 5: the queue starts EMPTY. A seeded 12 fabricated "12 offline
     changes queued" for every fresh session; only real offline/queue
     dispatches grow it, and SyncBanner renders only when it is non-zero. */
  offlineQueue: 0,
  syncing: false,
};

let auditCounter = 100;
function reducer(state: DomainState, a: DomainAction): DomainState {
  switch (a.type) {
    case 'wo/create':
      return {
        ...state,
        workOrders: [a.wo, ...state.workOrders],
        events: [{ id: `ev_${Date.now()}`, on: new Date(), type: 'maintenance', label: `New ${a.wo.priority} report — ${a.wo.id} · ${a.wo.category}`, severity: (a.wo.priority === 'emergency' ? 'critical' : a.wo.priority === 'critical' ? 'warn' : 'info') as LiveEvent['severity'], ref: a.wo.id }, ...state.events].slice(0, 40),
        audit: [{ id: `aud_${auditCounter++}`, on: new Date(), actor: a.wo.reportedBy, actorRole: a.wo.reportedRole, action: 'Reported maintenance issue', recordType: 'Work order', recordRef: `${a.wo.id} — ${a.wo.title}`, reason: 'Reported via report flow', policyRef: a.wo.priority === 'emergency' ? 'Facilities §1.2 (safety auto-escalation)' : 'Facilities §1.1 (intake)', aiInvolved: true, risk: a.wo.priority === 'emergency' ? 'high' : 'low', outcome: `Work order created · priority ${a.wo.priority}` }, ...state.audit],
      };
    case 'wo/patch':
      return {
        ...state,
        workOrders: state.workOrders.map(w => w.id === a.id ? { ...w, ...a.patch } : w),
        audit: [{ id: `aud_${auditCounter++}`, on: new Date(), actor: a.actor, actorRole: 'facilities' as RoleId, action: a.note ?? 'Updated work order', recordType: 'Work order', recordRef: a.id, aiInvolved: false, risk: 'low', outcome: 'Updated' }, ...state.audit],
      };
    case 'wo/advance': {
      const wo = state.workOrders.find(w => w.id === a.id);
      const now = new Date();
      const patch: Partial<WorkOrderRecord> = { status: a.to };
      if (a.to === 'assigned' && !wo?.assignedOn) patch.assignedOn = now;
      if (a.to === 'accepted' && !wo?.acceptedOn) { patch.acceptedOn = now; if (!wo?.respondedOn) patch.respondedOn = now; }
      if ((a.to === 'on-site' || a.to === 'repairing') && !wo?.startedOn) patch.startedOn = now;
      if (a.to === 'verification' && !wo?.completedOn) { patch.completedOn = now; patch.slaBreached = wo ? now.getTime() > wo.sla.resolveBy.getTime() : false; }
      return {
        ...state,
        workOrders: state.workOrders.map(w => w.id === a.id ? { ...w, ...patch, timeline: [...w.timeline, { on: now, actor: a.actor, note: a.note ?? `Status → ${a.to}`, kind: 'status' as const }] } : w),
        events: [{ id: `ev_${Date.now()}`, on: now, type: 'maintenance', label: `${wo?.id ?? a.id} → ${a.to.replace('-', ' ')}`, severity: (a.to === 'resolved' ? 'info' : a.to === 'on-site' || a.to === 'repairing' ? 'warn' : 'info') as LiveEvent['severity'], ref: a.id }, ...state.events].slice(0, 40),
        audit: [{ id: `aud_${auditCounter++}`, on: now, actor: a.actor, actorRole: a.actorRole ?? ('facilities' as RoleId), action: `Work order → ${a.to}`, recordType: 'Work order', recordRef: `${a.id} — ${wo?.title ?? ''}`, reason: a.note, policyRef: 'Facilities §2.1 (lifecycle)', aiInvolved: false, risk: a.to === 'verification' ? 'low' : 'low', outcome: `Status → ${a.to}` }, ...state.audit],
      };
    }
    case 'action/decide': {
      const act = state.actions.find(x => x.id === a.id);
      const suggested = act?.actions[0];
      return {
        ...state,
        actions: state.actions.map(x => x.id === a.id ? { ...x, status: a.decision } : x),
        audit: [{
          id: `aud_${auditCounter++}`,
          on: new Date(),
          actor: a.actor,
          actorRole: a.role,
          action: a.decision === 'approved' ? `Approved: ${suggested?.label ?? act?.title}` : 'Dismissed recommendation',
          recordType: act?.kind === 'approval' ? 'Approval' : act?.kind === 'case' ? 'Case' : 'Recommendation',
          recordRef: act?.title ?? a.id,
          reason: a.note ?? (a.decision === 'approved' ? 'Approved from Action Center' : 'Not required now'),
          policyRef: suggested?.posture ? `Posture: ${suggested.posture}` : undefined,
          aiInvolved: act?.aiInvolved ?? false,
          risk: act?.priority === 'critical' ? 'high' : act?.priority === 'high' ? 'medium' : 'low',
          outcome: a.decision === 'approved' ? 'Executed · verification pending' : 'Closed without action',
        }, ...state.audit],
      };
    }
    case 'case/advance': {
      const tc = state.cases.find(c => c.id === a.id);
      return {
        ...state,
        cases: state.cases.map(c => c.id === a.id ? { ...c, status: a.status, messages: a.note ? [...c.messages, { on: new Date(), from: a.actor ?? 'You', text: a.note, internal: true }] : c.messages } : c),
        audit: [{ id: `aud_${auditCounter++}`, on: new Date(), actor: a.actor ?? 'You', actorRole: tc?.campus === 'north' ? 'coordinator' : 'coordinator', action: `Case ${a.status}`, recordType: 'Case', recordRef: tc?.title ?? a.id, reason: a.note, aiInvolved: false, risk: 'low', outcome: `Status → ${a.status}` }, ...state.audit],
      };
    }
    case 'case/add':
      return { ...state, cases: [a.c, ...state.cases] };
    case 'notification/read':
      return { ...state, notifications: state.notifications.map(n => (a.all || n.id === a.id) ? { ...n, read: true } : n) };
    case 'chat/add': {
      const withNew = [...state.chat, a.msg];
      /* simulate delivery progression */
      if (a.msg.from === 'guardian') {
        setTimeout(() => storeDispatchRef.current?.({ type: 'chat/updateStatus', id: a.msg.id, status: 'delivered' }), 900);
        setTimeout(() => storeDispatchRef.current?.({ type: 'chat/updateStatus', id: a.msg.id, status: 'read' }), 2200);
      }
      return { ...state, chat: withNew };
    }
    case 'chat/updateStatus':
      return { ...state, chat: state.chat.map(m => m.id === a.id ? { ...m, status: a.status } : m) };
    case 'audit/add':
      return { ...state, audit: [{ id: `aud_${auditCounter++}`, on: new Date(), ...a.entry }, ...state.audit] };
    case 'event/add':
      return { ...state, events: [a.e, ...state.events].slice(0, 40) };
    case 'offline/queue':
      return { ...state, offlineQueue: Math.max(0, state.offlineQueue + a.n) };
    case 'sync/flush':
      return { ...state, offlineQueue: 0, syncing: true };
    case 'domain/hydrate':
      /* T301: the seed arrays are read HERE — at dispatch time, i.e. strictly
         after ensureDataset() resolved — then copied, so in-flight dataset
         rebinds can never mutate state underneath the reducer. */
      return {
        ...state,
        workOrders: [...seed.workOrders],
        actions: [...seed.actionItems],
        cases: [...seed.cases],
        notifications: [...seed.notifications],
        chat: [...seed.guardianChat],
        audit: [...seed.auditEntries],
      };
    case 'reset':
      return { ...initialState };
    default:
      return state;
  }
}

/* bridge for async dispatch inside reducer-created timeouts */
const storeDispatchRef: { current: React.Dispatch<DomainAction> | null } = { current: null };

interface Ctx {
  session: Session;
  setRole: (r: RoleId) => void;
  setActiveCampus: (c: CampusId) => void;
  domain: DomainState;
  dispatch: React.Dispatch<DomainAction>;
  actorName: string;
  permissionError: (feature: string) => boolean;
}
const StoreCtx = createContext<Ctx | null>(null);

const ROLE_CAMPUS: Record<RoleId, CampusId | 'all'> = {
  principal: 'all', teacher: 'north', coordinator: 'north', finance: 'all', admissions: 'all',
  transport: 'north', parent: 'north', student: 'north', owner: 'all', itadmin: 'all',
  facilities: 'north', technician: 'north',
};

export const demoAccounts: { id: RoleId; name: string; title: string; email: string }[] = [
  { id: 'principal', name: 'Dr. Meera Krishnan', title: 'Principal — Group', email: 'meera.k@meridian.edu' },
  { id: 'teacher', name: 'Priya Iyer', title: 'Class Teacher 8-B · Mathematics', email: 'priya.iyer@meridian.edu' },
  { id: 'coordinator', name: 'Arjun Bhat', title: 'Admin Coordinator — North', email: 'arjun.bhat@meridian.edu' },
  { id: 'finance', name: 'Deepa Rao', title: 'Finance Lead — Group', email: 'deepa.rao@meridian.edu' },
  { id: 'admissions', name: 'Anita Deshpande', title: 'Admissions Head', email: 'anita.d@meridian.edu' },
  { id: 'transport', name: 'Rajeev Nair', title: 'Transport Supervisor — North', email: 'rajeev.nair@meridian.edu' },
  { id: 'parent', name: 'Kavita Sharma', title: 'Guardian — Aarav (8-B)', email: 'kavita.s@gmail.com' },
  { id: 'student', name: 'Aarav Sharma', title: 'Grade 8-B · Roll 14', email: 'st.north.aarav@student.meridian.edu' },
  { id: 'owner', name: 'Vikram Mehta', title: 'Trustee / Group Owner', email: 'vikram.mehta@meridian.edu' },
  { id: 'itadmin', name: 'Sanjay Kulkarni', title: 'IT Administrator', email: 'sanjay.k@meridian.edu' },
  { id: 'facilities', name: 'Vikram Joshi', title: 'Facility Manager — North', email: 'vikram.joshi@meridian.edu' },
  { id: 'technician', name: 'Arif Shaikh', title: 'AV & Electrical Technician — North', email: 'arif.s@meridian.edu' },
];

/* The fixed demo student/guardian pair for parent & student experiences */
export const DEMO_STUDENT_ID = seed.DEMO_STUDENT.id;
export const DEMO_GUARDIAN_ID = seed.DEMO_GUARDIAN?.id ?? '';

export function StoreProvider({ children }: { children: ReactNode }) {
  // activeCampus starts at the demo's 'north' but snaps to the tenant's own
  // first campus as soon as the (tenant-scoped) dataset is hydrated.
  const [session, setSession] = useState<Session>({ roleId: 'principal', campusScope: 'all', activeCampus: 'north' });
  useEffect(() => {
    if (!datasetReady()) return;
    setSession((s: Session) => (campuses.length && !campuses.some(c => c.id === s.activeCampus)
      ? { ...s, activeCampus: campuses[0].id as CampusId }
      : s));
  }, [datasetReady()]);
  const [domain, dispatch] = useReducer(reducer, initialState);
  storeDispatchRef.current = dispatch;

  /* T301 (§9.1): fill the domain slices exactly once, after /dataset
     hydration. ensureDataset() is idempotent and shared — when AuthGate's
     boot path has already hydrated, this resolves immediately; when it has
     not (login screen, token still polling), this waits for the same
     promise. A failed hydration is surfaced by AuthGate; slices stay
     honestly empty rather than throwing at boot. */
  useEffect(() => {
    let dead = false;
    ensureDataset()
      .then(() => { if (!dead) dispatch({ type: 'domain/hydrate' }); })
      .catch(() => { /* hydration failure handled by AuthGate — nothing to fake here */ });
    return () => { dead = true; };
  }, []);

  const value = useMemo<Ctx>(() => {
    /* T304 (D-5): no `!`-asserts — an unrecognised role falls back to the
       first demo account instead of crashing on `account.name`. */
    const account = demoAccounts.find(a => a.id === session.roleId) ?? demoAccounts[0];
    return {
      session,
      actorName: sessionUserName() ?? account.name,
      setRole: r => setSession((s: Session) => ({ ...s, roleId: r, campusScope: ROLE_CAMPUS[r], activeCampus: ROLE_CAMPUS[r] === 'all' ? s.activeCampus : ROLE_CAMPUS[r] as CampusId })),
      setActiveCampus: c => setSession((s: Session) => ({ ...s, activeCampus: c })),
      domain,
      dispatch,
      permissionError: (feature: string) => {
        const p = session.roleId;
        if (feature === 'fees') return !['finance', 'principal', 'owner', 'coordinator', 'itadmin'].includes(p);
        if (feature === 'admissions') return !['admissions', 'principal', 'owner', 'coordinator'].includes(p);
        if (feature === 'transport') return !['transport', 'principal', 'owner', 'coordinator'].includes(p);
        if (feature === 'ai-governance') return !['itadmin', 'principal', 'owner'].includes(p);
        if (feature === 'group') return !['owner', 'principal', 'finance'].includes(p);
        if (feature === 'maintenance') return !['principal', 'owner', 'coordinator', 'facilities', 'technician', 'itadmin', 'finance', 'transport', 'admissions'].includes(p);
        if (feature === 'maintenance-manage') return !['facilities', 'principal', 'owner'].includes(p);
        if (feature === 'report-issue') return ['parent', 'student'].includes(p);
        if (feature === 'people-detail') return !['parent', 'student'].includes(p) ? false : true;
        return false;
      },
    };
  }, [session, domain]);

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore outside provider');
  return ctx;
}
