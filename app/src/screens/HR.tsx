/* ============================================================
   HR — staff operations (route /operations/hr). Leave requests
   with approve/reject and audit, the attendance strip, the
   Ms. Sarita Mishra substitution case with ranked candidates,
   and staff certificate expiry watch.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import * as seed from '../data/dataset';
import { actionService } from '../demo/seedServices';
import {
  PageHead, Section, Card, Stat, Badge, Avatar, DataTable, Button, useToast,
  Empty, ErrorState, SkeletonCard, KeyValue, Timeline, SampleNote} from '../components/ui';
import { AiTraceCard } from '../components/Ai';
import { Icon } from '../components/Icon';
import { fmtDate, fmtDateShort, fmtRelative } from '../lib/format';
import { makeRng } from '../lib/rng';

/* ---------- standard async hook (APP-SPEC pattern, local copy) ---------- */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => live && setState({ data: d, loading: false, error: null }))
      .catch(e => live && setState({ data: null, loading: false, error: String(e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

/* ============================================================
   Leave requests — local demo data (makeRng 6060), teacher
   names pulled from seed.teachers so the roster stays canonical.
   ============================================================ */
type LeaveType = 'sick' | 'casual' | 'on-duty';

interface LeaveRequest {
  id: string; teacherId: string; teacherName: string; type: LeaveType;
  from: Date; to: Date; status: 'pending' | 'approved' | 'rejected';
  substituteNeeded: boolean; reason: string; appliedOn: Date;
}

function buildLeaveRequests(): LeaveRequest[] {
  const rng = makeRng(6060);
  const pool = seed.teachers.slice(10, 18);
  const defs: { type: LeaveType; daysAhead: number; span: number; status: LeaveRequest['status']; sub: boolean; reason: string }[] = [
    { type: 'casual', daysAhead: 1, span: 2, status: 'pending', sub: true, reason: 'Family function out of town' },
    { type: 'sick', daysAhead: 0, span: 1, status: 'approved', sub: false, reason: 'Fever — reported at 07:10' },
    { type: 'on-duty', daysAhead: 3, span: 1, status: 'approved', sub: false, reason: 'CBSE workshop — district office' },
    { type: 'casual', daysAhead: 6, span: 1, status: 'pending', sub: false, reason: 'Bank + property paperwork' },
    { type: 'sick', daysAhead: -2, span: 2, status: 'approved', sub: true, reason: 'Viral — recovered, back tomorrow' },
    { type: 'on-duty', daysAhead: 8, span: 2, status: 'pending', sub: true, reason: 'Science exhibition procurement' },
    { type: 'casual', daysAhead: 11, span: 3, status: 'pending', sub: true, reason: 'Sister\'s wedding' },
    { type: 'sick', daysAhead: -9, span: 1, status: 'rejected', sub: false, reason: 'Requested during exam duty — moved to next week' }];
  /* Empty-world law: no teachers → no synthetic leave rows. */
  if (!pool.length) return [];
  return defs.map((d, i) => {
    const t = pool[i % pool.length];
    return {
      id: `lv_${i + 1}`,
      teacherId: t.id,
      teacherName: t.name,
      type: d.type,
      from: rng.date(d.daysAhead, 8, 0),
      to: rng.date(d.daysAhead + d.span - 1, 16, 0),
      status: d.status,
      substituteNeeded: d.sub,
      reason: d.reason,
      appliedOn: rng.date(d.daysAhead - 2, 9, 30)};
  });
}

const INITIAL_LEAVES = buildLeaveRequests();

/* staff certificates — seed.documents has no staff owner records,
   so the demo carries four local certs with expiry badges */
interface StaffDoc { id: string; title: string; owner: string; expiresOn: Date; }
function buildStaffDocs(): StaffDoc[] {
  const rng = makeRng(6161);
  return [
    { id: 'sdoc_1', title: 'First-aid certification — Nurse', owner: seed.staff.find(s => s.designation === 'Nurse')?.name ?? 'Staff', expiresOn: rng.date(9, 9) },
    { id: 'sdoc_2', title: 'Bus driver licences (batch)', owner: 'Transport — 10 drivers', expiresOn: rng.date(48, 9) },
    { id: 'sdoc_3', title: 'Lab chemical handling cert', owner: seed.staff.find(s => s.designation === 'Lab Assistant')?.name ?? 'Staff', expiresOn: rng.date(21, 9) },
    { id: 'sdoc_4', title: 'Fire-warden training', owner: seed.staff.find(s => s.designation === 'Admin Officer')?.name ?? 'Staff', expiresOn: rng.date(120, 9) }];
}
const STAFF_DOCS = buildStaffDocs();

const SUB_TRACE = {
  trigger: 'Leave approval created an uncovered-period alert (act_3)',
  policy: 'Approvals §1.2 · AI ranks logistics only; the assignment is the coordinator\'s decision',
  dataUsed: ['approved leave records', 'timetable free periods', 'subject roster'],
  reasoningRole: 'Proposer (ranks candidates; assigns nothing)',
  action: 'Ranked two candidates by free periods and subject match — awaiting approval',
  approvalStatus: 'APPROVAL REQUIRED — Academic Coordinator',
  verification: 'Free periods recomputed against tomorrow\'s timetable after ranking'};

function leaveTypeBadge(t: LeaveType) {
  if (t === 'sick') return <Badge tone="warning" dot>Sick</Badge>;
  if (t === 'on-duty') return <Badge tone="info" dot>On duty</Badge>;
  return <Badge tone="outline">Casual</Badge>;
}

/* ============================================================ */

export default function HR() {
  const { session, domain, dispatch, actorName } = useStore();
  const toast = useToast();
  const isPrincipal = session.roleId === 'principal';
  const isCoordinator = session.roleId === 'coordinator';
  const canDecide = isPrincipal || isCoordinator;

  const [leaves, setLeaves] = useState(INITIAL_LEAVES);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [assignedSub, setAssignedSub] = useState<string | null>(null);

  const actionItems = useAsync(() => actionService.list(), []);
  const act3 = useMemo(() => actionItems.data?.find(a => a.id === 'act_3'), [actionItems.data]);

  const pendingCount = leaves.filter(l => l.status === 'pending').length;
  /* FE-5: this HR board is seed data — the leave list, the substitution action (`act_3`) and the audit
     rows it writes live in this session only. There is no HR write door yet, so a decision here does NOT
     reach the server Action Center or the immutable ledger; the copy says so rather than claiming shared
     state. */
  const act3Open = domain.actions.find(a => a.id === 'act_3')?.status === 'open';
  const subsPending = leaves.filter(l => l.status === 'pending' && l.substituteNeeded).length + (act3Open ? 1 : 0);

  const decide = (leave: LeaveRequest, decision: 'approved' | 'rejected') => {
    setBusyId(leave.id);
    setTimeout(() => {
      setLeaves(prev => prev.map(l => l.id === leave.id ? { ...l, status: decision } : l));
      setBusyId(null);
      const createsTask = decision === 'approved' && leave.substituteNeeded;
      dispatch({
        type: 'audit/add',
        entry: {
          actor: actorName, actorRole: session.roleId,
          action: `${decision === 'approved' ? 'Approved' : 'Rejected'} leave — ${leave.teacherName}`,
          recordType: 'Leave request', recordRef: `${leave.id} · ${leave.type} · ${fmtDateShort(leave.from)}–${fmtDateShort(leave.to)}`,
          reason: leave.reason,
          policyRef: 'HR policy §2.1',
          aiInvolved: false,
          risk: leave.substituteNeeded && decision === 'approved' ? 'medium' : 'low',
          outcome: createsTask
            ? 'Approved · cover task created for Academic Coordinator (timetable uncovered periods)'
            : decision === 'approved' ? 'Approved · no cover required' : 'Rejected · applicant notified with reason'}});
      if (createsTask) {
        dispatch({
          type: 'event/add',
          e: { id: `ev_${Date.now()}`, on: new Date(), type: 'hr.cover.task', label: `Cover task created — ${leave.teacherName} out ${fmtDateShort(leave.from)}–${fmtDateShort(leave.to)}`, severity: 'info', ref: '/operations/hr' }});
        toast({
          title: 'Leave approved — cover task created',
          sub: `${leave.teacherName} needs a substitute. Task assigned to the Academic Coordinator with the uncovered periods.`,
          tone: 'success'});
      } else {
        toast({
          title: decision === 'approved' ? 'Leave approved' : 'Leave rejected',
          sub: decision === 'approved'
            ? `${leave.teacherName} — ${fmtDateShort(leave.from)} to ${fmtDateShort(leave.to)}.`
            : `${leave.teacherName} notified with the recorded reason.`,
          tone: decision === 'approved' ? 'success' : 'info'});
      }
    }, 300);
  };

  const assignSubstitute = (candidate: string) => {
    setAssignedSub(candidate);
    dispatch({
      type: 'action/decide',
      id: 'act_3',
      decision: 'approved',
      actor: actorName,
      role: session.roleId,
      note: `Substitute assigned: ${candidate}`});
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: session.roleId,
        action: 'Assigned substitute', recordType: 'Substitution', recordRef: `Ms. Sarita Mishra (7-A) → ${candidate}`,
        reason: 'Ranked best fit by free periods and subject match (AI-ranked, human-approved)',
        policyRef: 'Approvals §1.2',
        aiInvolved: true,
        risk: 'low',
        outcome: 'Substitute pack generated — timetable, seating, medical notes'}});
    dispatch({
      type: 'event/add',
      e: { id: `ev_${Date.now()}`, on: new Date(), type: 'hr.substitute.assigned', label: `Substitute assigned for 7-A — ${candidate}`, severity: 'info', ref: '/operations/hr' }});
    toast({ title: 'Substitute pack generated', sub: 'Timetable, seating, medical notes', tone: 'success' });
  };

  /* attendance strip */
  const present = 69, onLeave = 3, onDuty = 2;

  const candidates = [
    { name: 'Mr. Naveen Kaul', subject: 'Mathematics', freePeriods: 3, why: 'Teaches 8-C tomorrow; Mathematics aligns with Ms. Mishra\'s 7-A load.' },
    { name: 'Ms. Swati Rao', subject: 'Science', freePeriods: 4, why: 'Widest availability; Science covers two of the five affected periods.' }];

  return (
    <div>
      <SampleNote>Sample HR data — leave requests, staff documents and attendance figures are illustrative in this build, not read from your school’s records.</SampleNote>
      <PageHead
        title="HR — Staff"
        sub={canDecide
          ? 'Leave, substitutions and staff certificates. Decisions here are workspace-local in this build — the shared approval ledger is not connected yet.'
          : 'Leave, substitutions and staff certificates. Decisions belong to the coordinator and principal roles.'}
        back={{ to: '/operations', label: 'Operations' }}
      />

      {/* ---- Stats ---- */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <Stat label="Total staff" value={72} sub="52 teachers · 20 admin staff" />
        <Stat label="Present today" value={69} sub={`${onDuty} of them out on duty`} />
        <Stat label="On leave" value={onLeave} sub="1 sick · 2 pre-approved" />
        <Stat label="Substitutions pending" value={subsPending} sub={act3Open ? 'Ms. Sarita Mishra (7-A) — awaiting assignment' : 'All covers assigned'} />
      </div>

      {/* ---- Attendance strip ---- */}
      <Card pad style={{ marginBottom: 28 }}>
        <div className="u-between" style={{ gap: 14, flexWrap: 'wrap' }}>
          <div className="u-flex" style={{ gap: 18, flexWrap: 'wrap' }}>
            <span className="u-flex" style={{ gap: 7 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--success)' }} /> <span className="u-small"><strong className="tnum">{present}</strong> present</span></span>
            <span className="u-flex" style={{ gap: 7 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--warning)' }} /> <span className="u-small"><strong className="tnum">{onLeave}</strong> on leave</span></span>
            <span className="u-flex" style={{ gap: 7 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--info)' }} /> <span className="u-small"><strong className="tnum">{onDuty}</strong> on duty (OD)</span></span>
            <span className="u-flex" style={{ gap: 7 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--border-strong)' }} /> <span className="u-small"><strong className="tnum">0</strong> unmarked</span></span>
          </div>
          <span className="u-xs u-faint">{fmtDate(new Date())} · staff register auto-closes at 09:00</span>
        </div>
      </Card>

      {/* ---- Leave requests ---- */}
      <Section
        title="Leave requests"
        sub={`${leaves.length} requests this cycle · ${pendingCount} pending decision. Approving a request that needs cover creates a coordinator task automatically.`}
        style={{ marginBottom: 28 }}
      >
        <Card>
          <DataTable
            rows={leaves}
            rowKey={l => l.id}
            empty={<Empty icon={<Icon.People size={22} />} title="No leave requests" />}
            columns={[
              {
                key: 'teacher', label: 'Staff', render: l => (
                  <div className="u-flex" style={{ gap: 9 }}>
                    <Avatar name={l.teacherName} size="sm" />
                    <div>
                      <div style={{ fontWeight: 580 }}>{l.teacherName}</div>
                      <div className="u-xs u-faint">applied {fmtRelative(l.appliedOn)}</div>
                    </div>
                  </div>
                )},
              { key: 'type', label: 'Type', render: l => leaveTypeBadge(l.type) },
              {
                key: 'dates', label: 'Dates', render: l => (
                  <span className="u-small">{fmtDateShort(l.from)} → {fmtDateShort(l.to)} <span className="u-faint">({Math.max(1, Math.round((l.to.getTime() - l.from.getTime()) / 86400000) + 1)}d)</span></span>
                )},
              { key: 'reason', label: 'Reason', render: l => <span className="u-small u-muted">{l.reason}</span> },
              {
                key: 'sub', label: 'Cover', render: l => l.substituteNeeded
                  ? <Badge tone="ai" dot>Substitute needed</Badge>
                  : <span className="u-xs u-faint">No cover</span>},
              {
                key: 'status', label: 'Status', align: 'right', render: l => l.status === 'approved'
                  ? <Badge tone="success" dot>Approved</Badge>
                  : l.status === 'rejected'
                    ? <Badge tone="danger" dot>Rejected</Badge>
                    : <Badge tone="warning" dot>Pending</Badge>},
              {
                key: 'actions', label: '', align: 'right', render: l => l.status !== 'pending' ? (
                  <span className="u-xs u-faint">—</span>
                ) : (
                  <span className="u-flex" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="primary" icon={<Icon.Check size={12} />} loading={busyId === l.id} disabled={!canDecide} onClick={() => decide(l, 'approved')}>Approve</Button>
                    <Button size="sm" variant="danger-ghost" icon={<Icon.X size={12} />} loading={busyId === l.id} disabled={!canDecide} onClick={() => decide(l, 'rejected')}>Reject</Button>
                  </span>
                )}]}
          />
        </Card>
      </Section>

      {/* ---- Substitutions ---- */}
      <Section
        title="Substitutions"
        sub="AI ranks candidates by free periods and subject match; the assignment is always a human decision (Approvals §1.2)."
        style={{ marginBottom: 28 }}
      >
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          <Card pad>
            {actionItems.loading ? (
              <SkeletonCard lines={4} />
            ) : actionItems.error ? (
              <ErrorState title="Could not load the substitution case" sub={actionItems.error} onRetry={actionItems.retry} />
            ) : !act3 ? (
              <Empty icon={<Icon.Clipboard size={20} />} title="No open substitution case" sub="The approval queue has no pending substitution right now." />
            ) : (
              <div className="u-col" style={{ gap: 12 }}>
                <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <Badge tone="warning" dot>act_3 · approval</Badge>
                  <Badge tone="danger">{act3.priority} priority</Badge>
                  {act3.deadline && <span className="u-xs u-faint">needed by {fmtRelative(act3.deadline)}</span>}
                </div>
                <div style={{ fontWeight: 630, fontSize: 'var(--text-lg)' }}>{act3.title}</div>
                <div className="u-small u-muted" style={{ lineHeight: 1.6 }}>{act3.detail}</div>
                <KeyValue
                  cols={1}
                  items={[
                    { k: 'Leave', v: <span className="u-small">Family function · approved per HR policy §2.1 · 2 days from {fmtDateShort(new Date(Date.now() + 86400000))}</span> },
                    { k: 'Impact', v: <span className="u-small">5 periods across 7-A and 8-C tomorrow morning</span> },
                    { k: 'Evidence', v: act3.evidence.map(e => e.detail).join(' · ') }]}
                />
                {assignedSub && (
                  <div className="u-flex" style={{ gap: 8, padding: '9px 12px', background: 'var(--success-weak)', borderRadius: 'var(--r-md)' }}>
                    <Icon.Check size={14} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
                    <span className="u-small"><strong>{assignedSub}</strong> assigned. Substitute pack generated — timetable, seating, medical notes. Approval act_3 closed and audited.</span>
                  </div>
                )}
                <AiTraceCard trace={SUB_TRACE} />
              </div>
            )}
          </Card>

          <Card pad>
            <div className="u-col" style={{ gap: 12 }}>
              <div className="u-upper">Ranked candidates — tomorrow</div>
              {candidates.map((c, i) => (
                <div key={c.name} className="u-between" style={{ gap: 10, padding: '11px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: i === 0 ? 'var(--accent-weak)' : 'var(--surface)' }}>
                  <div className="u-flex" style={{ gap: 10, minWidth: 0 }}>
                    <Avatar name={c.name} />
                    <div style={{ minWidth: 0 }}>
                      <div className="u-flex" style={{ gap: 7, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 590 }}>{c.name}</span>
                        {i === 0 && <Badge tone="accent">Best fit</Badge>}
                      </div>
                      <div className="u-xs u-muted" style={{ marginTop: 2 }}>{c.subject} · {c.freePeriods} free periods tomorrow</div>
                      <div className="u-xs u-faint" style={{ marginTop: 2 }}>{c.why}</div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={i === 0 ? 'primary' : 'secondary'}
                    disabled={!canDecide || !!assignedSub}
                    onClick={() => assignSubstitute(c.name)}
                  >
                    Assign
                  </Button>
                </div>
              ))}
              {!canDecide && (
                <div className="u-small u-muted">
                  Assignments are made by the Academic Coordinator or Principal. Sign in as them to decide.
                </div>
              )}
              <Timeline
                items={[
                  { time: '09:05', title: 'AI ranked candidates', body: 'Free periods recomputed against tomorrow\'s timetable; subject match weighted first.', dot: 'ai' },
                  { time: '09:05', title: 'Coordinator notified', body: 'Approval created with a 16:00 deadline today.', dot: 'accent' },
                  ...(assignedSub ? [{ time: fmtTime(), title: `Substitute assigned — ${assignedSub}`, body: 'Pack generated: timetable, seating, medical notes. Guardians of 7-A informed via class group.', dot: 'accent' as const }] : [])]}
              />
            </div>
          </Card>
        </div>
      </Section>

      {/* ---- Staff certificates ---- */}
      <Section
        title="Staff certificate expiry"
        sub="Staff certifications on the compliance register. The registry (Documents) holds no staff-owned records yet — these four are tracked here until they move across."
        style={{ marginBottom: 28 }}
      >
        <div className="grid grid-4">
          {STAFF_DOCS.map(d => {
            const days = Math.round((d.expiresOn.getTime() - Date.now()) / 86400000);
            return (
              <Card key={d.id} pad>
                <div className="u-col" style={{ gap: 7 }}>
                  <span style={{ fontWeight: 590 }}>{d.title}</span>
                  <span className="u-xs u-muted">{d.owner}</span>
                  <span className="u-xs u-faint">expires {fmtDate(d.expiresOn)}</span>
                  <div>
                    {days < 0
                      ? <Badge tone="danger" dot>Expired</Badge>
                      : days <= 30
                        ? <Badge tone="warning" dot>{days} days left</Badge>
                        : <Badge tone="success" dot>{days} days left</Badge>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </Section>

      <div style={{ height: 12 }} />
      <div className="u-small u-muted">
        This HR board is sample data in this build: decisions update this session only and are not written to
        the server Action Center or the audit ledger (no HR write door exists yet).
      </div>
    </div>
  );
}

function fmtTime() {
  return new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}
