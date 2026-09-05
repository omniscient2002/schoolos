/* ============================================================
   PersonDetail — Student 360 for students; a lighter profile
   (schedule, classes, contact) for teachers/staff; linked
   students for guardians. Every AI claim carries provenance.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as seed from '../data/dataset';
import { aiService, feeService } from '../services';
import { useStore } from '../state/store';
import {
  Avatar, Badge, Button, Card, DataTable, Drawer, Empty, ErrorState, KeyValue, PageHead, Section, SkeletonCard, Stat, Tabs, useToast,
} from '../components/ui';
import { Sparkline } from '../components/Chart';
import { AiHeader, AiTraceCard, EvidenceChain } from '../components/Ai';
import { Icon } from '../components/Icon';
import { fmtDate, fmtDateShort, fmtMoney, fmtMoneyShort, fmtPct } from '../lib/format';
import type { AiEvidenceStep, AiResponse, AttendanceRecord, FeeObligation, Person, TimeSlot } from '../types/domain';

const campusShort = (id: string) => seed.campuses.find(c => c.id === id)?.shortName ?? id;
const sectionLabel = (sectionId: string) => {
  const s = seed.sections.find(x => x.id === sectionId);
  return s ? `${s.grade}-${s.name} · ${campusShort(s.campus)}` : sectionId;
};

export default function PersonDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const person: Person | undefined = id ? seed.findPerson(id) : undefined;

  if (!person) {
    return (
      <>
        <PageHead title="Person" back={{ to: '/people', label: 'Directory' }} />
        <Empty
          icon={<Icon.User size={26} />}
          title="Record not found"
          sub={id ? `No person with id “${id}” exists in the directory.` : 'Open someone from the Directory to see their profile.'}
          action={<Button variant="secondary" icon={<Icon.People size={14} />} onClick={() => navigate('/people')}>Back to Directory</Button>}
        />
      </>
    );
  }

  return (
    <>
      <PageHead title={person.type === 'student' ? 'Student 360' : person.type === 'guardian' ? 'Guardian profile' : 'Staff profile'} back={{ to: '/people', label: 'Directory' }} />
      {person.type === 'student' ? <StudentDetail person={person} />
        : person.type === 'guardian' ? <GuardianDetail person={person} />
        : <StaffDetail person={person} />}
    </>
  );
}

/* ============================================================
   Student 360
   ============================================================ */
function StudentDetail({ person }: { person: Person }) {
  const navigate = useNavigate();
  const { actorName, dispatch } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState('overview');
  const [feeTick, setFeeTick] = useState(0);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [slot, setSlot] = useState<AttendanceRecord | null>(null);

  const rate = useMemo(() => seed.studentAttendanceRate(person.id), [person.id]);
  const fees = useMemo(() => seed.studentFeeSummary(person.id), [person.id, feeTick]);
  const guardianRows = useMemo(() => seed.guardiansOfStudent(person.id), [person.id]);
  const docs = useMemo(() => seed.documents.filter(d => d.ownerType === 'student' && d.ownerId === person.id), [person.id]);
  const section = seed.sectionOfStudent(person);
  const classTeacher = section ? seed.findPerson(section.classTeacherId) : undefined;
  const route = person.busRoute ? seed.busRoutes.find(r => r.name === person.busRoute) : undefined;
  const verifiedCount = guardianRows.filter(g => g.link.verified).length;

  /* 30-day register: seed stores only non-present marks; fill the rest as present */
  const register = useMemo(() => {
    const recs = seed.attendance.filter(a => a.studentId === person.id);
    const markedBy = classTeacher?.name ?? 'Class teacher';
    return [...seed.TERM_DAYS].reverse().map(day => {
      const rec = recs.find(r => r.date.getTime() === day.getTime());
      return {
        date: day,
        status: rec?.status ?? ('present' as const),
        markedBy,
        note: rec?.note ?? '—',
        offline: rec?.offline ?? false,
      };
    });
  }, [person.id, classTeacher]);

  const briefing = useBriefing(person.id, actorName);

  const attTier = rate.rate >= 95 ? { tone: 'success' as const, label: `Attendance ${fmtPct(rate.rate, 1)}` }
    : rate.rate >= 88 ? { tone: 'info' as const, label: `Attendance ${fmtPct(rate.rate, 1)}` }
    : rate.rate >= 75 ? { tone: 'warning' as const, label: `Attendance watch · ${fmtPct(rate.rate, 1)}` }
    : { tone: 'danger' as const, label: `Attendance risk · ${fmtPct(rate.rate, 1)}` };

  const feeBadge = fees.hasFailed ? { tone: 'danger' as const, label: 'Payment failed' }
    : fees.overdue > 0 ? { tone: 'warning' as const, label: `${fmtMoneyShort(fees.overdue)} overdue` }
    : fees.due > 0 ? { tone: 'info' as const, label: `${fmtMoneyShort(fees.due)} due` }
    : { tone: 'success' as const, label: 'Fees clear' };

  const retryPayment = async (obligationId: string) => {
    setRetrying(obligationId);
    try {
      await feeService.recordRetry(obligationId);
      setFeeTick(t => t + 1);
      toast({ title: 'Retry accepted by gateway', sub: 'Obligation marked paid · no late fee within the 5-day retry window (Fees §4.3).', tone: 'success' });
      dispatch({
        type: 'audit/add',
        entry: {
          actor: actorName, actorRole: 'finance', action: 'Retried failed UPI mandate', recordType: 'Fee obligation',
          recordRef: obligationId, policyRef: 'Fees §4.3', aiInvolved: false, risk: 'low', outcome: 'Payment succeeded on retry',
        },
      });
    } catch {
      toast({ title: 'Retry failed', sub: 'The gateway declined the mandate again. A reconciliation case will open automatically.', tone: 'error' });
    } finally {
      setRetrying(null);
    }
  };

  const messageGuardian = () => {
    const primary = guardianRows.find(g => g.link.primary) ?? guardianRows[0];
    if (!primary) {
      toast({ title: 'No guardian linked', sub: 'Link a guardian to this student before messaging.', tone: 'error' });
      return;
    }
    toast({ title: `Message queued to ${primary.guardian.name}`, sub: 'WhatsApp template · quiet hours 20:30–07:30 (Communication §1.1).', tone: 'success' });
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: 'coordinator', action: 'Sent guardian message', recordType: 'Message',
        recordRef: `${primary.guardian.name} · ${person.name}`, aiInvolved: false, risk: 'low', outcome: 'Queued via WhatsApp template',
      },
    });
  };

  const chainSteps: AiEvidenceStep[] = [
    {
      label: 'Attendance — 30 school days',
      detail: `${fmtPct(rate.rate, 1)} present · ${rate.absent} absent · ${rate.late} late · ${rate.excused} excused`,
      source: 'Attendance register · recomputed just now',
      refType: 'attendance',
    },
    route
      ? {
          label: `Transport — ${route.name}`,
          detail: route.status === 'delayed'
            ? `Bus delayed ${route.delayMins ?? 0} min this week; late arrivals marked lenient until 09:30 (Attendance §1.4)`
            : 'Route running on time this week',
          source: 'Transport GPS · Route 7 watch',
          refType: 'transport',
        }
      : { label: 'Transport', detail: 'No school-bus dependency — commute is parent-managed', source: 'Transport roster', refType: 'transport' },
    {
      label: 'Fees',
      detail: fees.hasFailed
        ? `${fmtMoneyShort(fees.due)} due · ${fmtMoneyShort(fees.overdue)} overdue · 1 failed mandate (retry window open, Fees §4.3)`
        : fees.due > 0
          ? `${fmtMoneyShort(fees.due)} due across ${fees.items.length} obligations${fees.overdue > 0 ? ` · ${fmtMoneyShort(fees.overdue)} overdue` : ''}`
          : `All ${fees.items.length} obligations settled · ${fmtMoneyShort(fees.paid)} paid this year`,
      source: 'Fee ledger',
      refType: 'fees',
    },
    {
      label: 'Guardians',
      detail: `${verifiedCount} of ${guardianRows.length} contacts WhatsApp-verified · pickup authorised for ${guardianRows.filter(g => g.link.pickupAuthorized).length}`,
      source: 'Guardian registry',
      refType: 'record',
    },
  ];

  return (
    <div className="u-col" style={{ gap: 18 }}>
      {/* ---------- header ---------- */}
      <Card pad>
        <div className="u-flex" style={{ gap: 16, flexWrap: 'wrap' }}>
          <Avatar name={person.name} size="lg" />
          <div className="u-grow" style={{ minWidth: 220 }}>
            <h2 style={{ fontSize: 'var(--text-xl)' }}>{person.name}</h2>
            <div className="u-small u-muted" style={{ marginTop: 2 }}>
              Grade {person.grade} · Section {person.section} · Roll {person.rollNo} · {campusShort(person.campus)} Campus
            </div>
            <div className="u-flex u-wrap" style={{ gap: 6, marginTop: 10 }}>
              <Badge tone={attTier.tone} dot>{attTier.label}</Badge>
              <Badge tone={feeBadge.tone}>{feeBadge.label}</Badge>
              {route && (
                <Badge tone={route.status === 'delayed' ? 'warning' : 'neutral'}>
                  <Icon.Bus size={11} /> {route.name.split('—')[0].trim()}{route.delayMins ? ` · +${route.delayMins} min` : ''}
                </Badge>
              )}
              <Badge tone="outline">Class teacher · {classTeacher?.name ?? '—'}</Badge>
            </div>
          </div>
          <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button variant="ai" icon={<Icon.Sparkle size={14} />} onClick={() => navigate('/ask')}>Ask about this student</Button>
            <Button variant="secondary" icon={<Icon.Message size={14} />} onClick={messageGuardian}>Message guardian</Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        {/* ---------- left: AI briefing + context ---------- */}
        <div className="u-col" style={{ gap: 16 }}>
          <Card
            head={<span className="u-flex" style={{ gap: 8 }}><AiHeader label="Student 360 briefing" confidence="high" /></span>}
            actions={<Button size="sm" variant="ghost" icon={<Icon.Refresh size={13} />} aria-label="Regenerate briefing" onClick={briefing.refresh}>Regenerate</Button>}
          >
            {briefing.loading ? (
              <SkeletonCard lines={4} />
            ) : briefing.error ? (
              <ErrorState title="Briefing unavailable" sub="The briefing service did not respond. Evidence below is computed locally from records." onRetry={briefing.refresh} />
            ) : (
              <div className="u-col" style={{ gap: 14 }}>
                <p style={{ fontSize: 'var(--text-md)', lineHeight: 1.6, margin: 0 }}>{briefing.data?.answer}</p>
                <EvidenceChain title={`Evidence — what should I know about ${person.name.split(' ')[0]}?`} steps={chainSteps} />
                {briefing.data && <AiTraceCard trace={briefing.data.trace} compact />}
                <div className="u-xs u-faint">Briefing is read-only. AI access follows your role scope (Privacy §1.3).</div>
              </div>
            )}
          </Card>

          <Card head="Class & transport context">
            <KeyValue
              cols={2}
              items={[
                { k: 'Section', v: section ? `Grade ${section.grade}-${section.name} · Room ${section.room}` : '—' },
                {
                  k: 'Section attendance today',
                  v: section ? (() => { const t = seed.sectionAttendanceToday(section.id); return `${t.pct}% present · ${t.absent} absent${t.unmarked ? ` · ${t.unmarked} unmarked` : ''}`; })() : '—',
                },
                { k: 'Class teacher', v: classTeacher ? `${classTeacher.name} · ${classTeacher.phone}` : '—' },
                {
                  k: 'Transport',
                  v: route
                    ? `${route.name} · ${route.driver} · ${route.status === 'delayed' ? `delayed ${route.delayMins} min` : route.status}`
                    : 'No bus route',
                },
              ]}
            />
            <div className="u-flex" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <Button size="sm" variant="ghost" iconRight={<Icon.ArrowRight size={12} />} onClick={() => navigate('/attendance')}>Open class register</Button>
              {route && <Button size="sm" variant="ghost" iconRight={<Icon.ArrowRight size={12} />} onClick={() => navigate('/transport')}>Open transport</Button>}
            </div>
          </Card>
        </div>

        {/* ---------- right: tabs ---------- */}
        <Card pad={false}>
          <div style={{ padding: '12px 20px 0' }}>
            <Tabs
              active={tab}
              onChange={setTab}
              tabs={[
                { id: 'overview', label: 'Overview' },
                { id: 'attendance', label: 'Attendance', count: 30 },
                { id: 'fees', label: 'Fees', count: fees.items.length },
                { id: 'guardians', label: 'Guardians', count: guardianRows.length },
                { id: 'documents', label: 'Documents', count: docs.length },
              ]}
            />
          </div>
          <div style={{ padding: 18 }}>
            {tab === 'overview' && (
              <div className="u-col" style={{ gap: 16 }}>
                <KeyValue
                  cols={2}
                  items={[
                    { k: 'Admission no', v: <span className="mono">{person.admissionNo ?? '—'}</span> },
                    { k: 'Date of birth', v: person.dob ? fmtDate(person.dob) : '—' },
                    { k: 'Roll no', v: person.rollNo ?? '—' },
                    { k: 'Section', v: section ? `${section.grade}-${section.name} · ${campusShort(section.campus)}` : '—' },
                    { k: 'Campus', v: campusShort(person.campus) },
                    { k: 'Bus route', v: person.busRoute ?? 'Parent-managed commute' },
                    { k: 'Guardians linked', v: `${guardianRows.length} · ${verifiedCount} verified` },
                    { k: 'Status', v: <Badge tone={person.status === 'active' ? 'success' : 'neutral'} dot>{person.status ?? 'active'}</Badge> },
                  ]}
                />
                <div>
                  <div className="u-upper" style={{ marginBottom: 6 }}>Presence — last 30 school days</div>
                  <Sparkline points={rate.series} width={460} height={46} color="var(--accent)" />
                  <div className="u-xs u-faint" style={{ marginTop: 4 }}>1 = present · 0 = absent or late · {fmtPct(rate.rate, 1)} overall</div>
                </div>
              </div>
            )}

            {tab === 'attendance' && (
              <DataTable
                rows={register}
                rowKey={r => r.date.toISOString()}
                onRowClick={r => setSlot(r as AttendanceRecord)}
                columns={[
                  { key: 'date', label: 'Date', render: r => <span className="tnum">{fmtDateShort(r.date)} · {new Date(r.date).toLocaleDateString('en-IN', { weekday: 'short' })}</span> },
                  {
                    key: 'status', label: 'Status',
                    render: r => r.status === 'present' ? <Badge tone="success">Present</Badge>
                      : r.status === 'absent' ? <Badge tone="danger">Absent</Badge>
                      : r.status === 'late' ? <Badge tone="warning">Late</Badge>
                      : <Badge tone="info">Excused</Badge>,
                  },
                  { key: 'markedBy', label: 'Marked by', render: r => r.markedBy },
                  { key: 'note', label: 'Note', render: r => <span className="u-muted">{r.note}</span> },
                ]}
              />
            )}

            {tab === 'fees' && (
              fees.items.length === 0 ? (
                <Empty icon={<Icon.Money size={24} />} title="No fee obligations on record" sub="This student has no fee lines for the current academic year." />
              ) : (
                <div className="u-col" style={{ gap: 14 }}>
                  <div className="grid grid-3">
                    <Stat label="Due now" value={fmtMoneyShort(fees.due)} sub={fees.overdue > 0 ? `${fmtMoneyShort(fees.overdue)} overdue` : 'Nothing overdue'} />
                    <Stat label="Paid this year" value={fmtMoneyShort(fees.paid)} sub={`${fees.items.filter(f => f.status === 'paid').length} of ${fees.items.length} obligations settled`} />
                    <Stat label="Payment health" value={fees.hasFailed ? 'Failed' : fees.overdue > 0 ? 'Overdue' : 'Clear'} sub={fees.hasFailed ? '1 UPI mandate declined — retry available' : 'Gateway reconciliations clean'} />
                  </div>
                  <DataTable<FeeObligation>
                    rows={fees.items}
                    rowKey={f => f.id}
                    columns={[
                      { key: 'term', label: 'Term', render: f => f.term },
                      { key: 'category', label: 'Category', render: f => f.category },
                      { key: 'amount', label: 'Amount', align: 'right', render: f => <span className="tnum">{fmtMoney(f.amount)}</span> },
                      { key: 'due', label: 'Due date', render: f => fmtDateShort(f.dueDate) },
                      {
                        key: 'status', label: 'Status',
                        render: f => f.status === 'paid' ? <Badge tone="success" dot>Paid</Badge>
                          : f.status === 'due' ? <Badge tone="info">Due</Badge>
                          : f.status === 'overdue' ? <Badge tone="warning">Overdue</Badge>
                          : f.status === 'failed' ? <Badge tone="danger">Failed</Badge>
                          : <Badge tone="neutral">Waived</Badge>,
                      },
                      { key: 'paid', label: 'Paid on', render: f => f.paidOn ? <span className="u-small u-muted">{fmtDateShort(f.paidOn)} · {f.method}</span> : '—' },
                      {
                        key: 'actions', label: '',
                        render: f => f.status === 'failed' ? (
                          <Button size="sm" variant="secondary" icon={<Icon.Refresh size={12} />} loading={retrying === f.id} onClick={() => retryPayment(f.id)}>Retry UPI</Button>
                        ) : null,
                      },
                    ]}
                  />
                  {fees.hasFailed && <div className="u-xs u-faint">Retries within 5 days of failure carry no late fee (Fees §4.3). The last failure reason was recorded by the gateway.</div>}
                </div>
              )
            )}

            {tab === 'guardians' && (
              guardianRows.length === 0 ? (
                <Empty icon={<Icon.People size={24} />} title="No guardians linked" sub="Add a guardian from the Directory to enable absence alerts and pickup authorisation." />
              ) : (
                <div className="u-col" style={{ gap: 10 }}>
                  {guardianRows.map(({ link, guardian }) => (
                    <Card key={guardian.id} onClick={() => navigate(`/people/${guardian.id}`)} className="card-click">
                      <div className="u-flex" style={{ gap: 12 }}>
                        <Avatar name={guardian.name} />
                        <div className="u-grow" style={{ minWidth: 0 }}>
                          <div className="u-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600 }}>{guardian.name}</span>
                            <Badge tone="neutral">{link.relation}</Badge>
                            {link.primary && <Badge tone="accent">Primary contact</Badge>}
                          </div>
                          <div className="u-small u-muted" style={{ marginTop: 2 }}><span className="mono">{guardian.phone}</span> · {guardian.email}</div>
                        </div>
                        <div className="u-col" style={{ gap: 5, alignItems: 'flex-end' }}>
                          {link.verified ? <Badge tone="success" dot>Verified</Badge> : <Badge tone="warning" dot>Unverified</Badge>}
                          {link.pickupAuthorized
                            ? <Badge tone="info">Pickup authorised</Badge>
                            : <Badge tone="outline">No pickup</Badge>}
                        </div>
                      </div>
                    </Card>
                  ))}
                  <div className="u-xs u-faint">Verified numbers receive absence notifications within 15 minutes (Attendance §1.1).</div>
                </div>
              )
            )}

            {tab === 'documents' && (
              docs.length === 0 ? (
                <Empty
                  icon={<Icon.Document size={24} />}
                  title="No documents on file"
                  sub="Uploads from the admissions pack and front office will appear here with expiry tracking."
                  action={<Button size="sm" variant="secondary" onClick={() => navigate('/documents')}>Open document store</Button>}
                />
              ) : (
                <div className="u-col" style={{ gap: 8 }}>
                  {docs.map(d => (
                    <div key={d.id} className="u-flex" style={{ gap: 12, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface)' }}>
                      <Icon.File size={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                      <div className="u-grow" style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 560 }}>{d.title}</div>
                        <div className="u-xs u-faint">{d.category} · {d.size}</div>
                      </div>
                      {d.status === 'expired' ? <Badge tone="danger">Expired {d.expiresOn ? fmtDateShort(d.expiresOn) : ''}</Badge>
                        : d.status === 'expiring' ? <Badge tone="warning">Expires {d.expiresOn ? fmtDateShort(d.expiresOn) : ''}</Badge>
                        : <Badge tone="success">Valid</Badge>}
                    </div>
                  ))}
                  <div className="u-xs u-faint">Expiring documents create renewal tasks for the class teacher automatically (workflow wf_5).</div>
                </div>
              )
            )}
          </div>
        </Card>
      </div>

      <Drawer
        open={slot !== null}
        onClose={() => setSlot(null)}
        title={slot ? `Register entry · ${fmtDate(slot.date)}` : ''}
        sub={slot ? `${person.name} · Grade ${person.grade}-${person.section}` : undefined}
        footer={<Button variant="secondary" onClick={() => setSlot(null)}>Close</Button>}
      >
        {slot && (
          <KeyValue
            cols={1}
            items={[
              { k: 'Status', v: slot.status === 'present' ? 'Present' : slot.status === 'absent' ? 'Absent' : slot.status === 'late' ? 'Late' : 'Excused' },
              { k: 'Marked by', v: classTeacher?.name ?? 'Class teacher' },
              { k: 'Note', v: slot.note ?? '—' },
              { k: 'Policy', v: 'Absences notify the primary guardian within 15 min (Attendance §1.1)' },
            ]}
          />
        )}
      </Drawer>
    </div>
  );
}

/* Briefing fetch — small local hook so the card owns its own loading/error */
function useBriefing(studentId: string, viewer: string) {
  const [state, setState] = useState<{ id: string; data: AiResponse | null; loading: boolean; error: string | null }>({ id: '', data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    aiService.draftStudentBriefing(studentId, viewer)
      .then(d => { if (live) setState({ id: studentId, data: d, loading: false, error: null }); })
      .catch(e => { if (live) setState({ id: studentId, data: null, loading: false, error: String(e) }); });
    return () => { live = false; };
  }, [studentId, viewer, tick]);
  const stale = state.id !== studentId;
  return { data: stale ? null : state.data, loading: stale || state.loading, error: stale ? null : state.error, refresh: () => setTick(t => t + 1) };
}

/* ============================================================
   Teacher / Staff profile — lighter: contact, classes, schedule
   ============================================================ */
function StaffDetail({ person }: { person: Person }) {
  const navigate = useNavigate();
  const { actorName, dispatch } = useStore();
  const toast = useToast();
  const [slot, setSlot] = useState<TimeSlot | null>(null);

  const slots = useMemo(
    () => seed.timetable.filter(t => t.teacherId === person.id).sort((a, b) => a.day - b.day || a.period - b.period),
    [person.id],
  );
  const teachesSection = seed.sections.find(s => s.classTeacherId === person.id);
  const todayDow = new Date().getDay(); // 1 = Monday … 6 = Saturday

  const message = () => {
    toast({ title: `Message queued to ${person.name}`, sub: 'Staff channel · delivered on next sync.', tone: 'success' });
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: 'coordinator', action: 'Sent staff message', recordType: 'Message',
        recordRef: person.name, aiInvolved: false, risk: 'low', outcome: 'Queued via staff channel',
      },
    });
  };

  return (
    <div className="u-col" style={{ gap: 18 }}>
      <Card pad>
        <div className="u-flex" style={{ gap: 16, flexWrap: 'wrap' }}>
          <Avatar name={person.name} size="lg" />
          <div className="u-grow" style={{ minWidth: 220 }}>
            <h2 style={{ fontSize: 'var(--text-xl)' }}>{person.name}</h2>
            <div className="u-small u-muted" style={{ marginTop: 2 }}>{person.role ?? 'Staff'} · {campusShort(person.campus)} Campus · joined {person.joinedOn ? fmtDate(person.joinedOn) : '—'}</div>
            <div className="u-flex u-wrap" style={{ gap: 6, marginTop: 10 }}>
              <Badge tone="accent">{person.role ?? 'Staff'}</Badge>
              {person.subjects?.map(s => <Badge key={s} tone="neutral">{s}</Badge>)}
              {teachesSection && <Badge tone="outline">Class teacher · {teachesSection.grade}-{teachesSection.name}</Badge>}
            </div>
          </div>
          <div className="u-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" icon={<Icon.Message size={14} />} onClick={message}>Message</Button>
            <Button variant="secondary" icon={<Icon.Sparkle size={14} />} onClick={() => navigate('/ask')}>Ask about this person</Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card head="Contact & record">
          <KeyValue
            cols={1}
            items={[
              { k: 'Email', v: <span className="mono">{person.email}</span> },
              { k: 'Phone', v: <span className="mono">{person.phone}</span> },
              { k: 'Campus', v: campusShort(person.campus) },
              { k: 'Record ref', v: <span className="mono">{person.id}</span> },
              { k: 'Subjects', v: person.subjects?.length ? person.subjects.join(' · ') : '—' },
              { k: 'Classes', v: person.classes?.length ? person.classes.join(', ') : '—' },
            ]}
          />
        </Card>
        <Card head="Weekly schedule">
          {slots.length === 0 ? (
            <Empty icon={<Icon.Calendar size={22} />} title="No timetable slots" sub="This role has no teaching periods on the timetable." />
          ) : (
            <>
              <div className="u-small u-muted" style={{ marginBottom: 10 }}>{slots.length} periods across 6 days</div>
              <DataTable
              rows={slots}
              rowKey={s => s.id}
              onRowClick={s => setSlot(s)}
              columns={[
                { key: 'when', label: 'When', render: s => <span className="tnum">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.day - 1]} · P{s.period}</span> },
                { key: 'time', label: 'Time', render: s => <span className="tnum u-small">{s.start}–{s.end}</span> },
                { key: 'subject', label: 'Subject', render: s => s.subject },
                { key: 'section', label: 'Section', render: s => sectionLabel(s.sectionId) },
                { key: 'room', label: 'Room', render: s => s.room },
                { key: 'today', label: '', render: s => s.day === todayDow ? <Badge tone="accent">Today</Badge> : null },
              ]}
            />
            </>
          )}
        </Card>
      </div>

      <Drawer
        open={slot !== null}
        onClose={() => setSlot(null)}
        title={slot ? `${slot.subject} · P${slot.period}` : ''}
        sub={slot ? `${slot.start}–${slot.end} · Room ${slot.room}` : undefined}
        footer={<Button variant="secondary" onClick={() => setSlot(null)}>Close</Button>}
      >
        {slot && (
          <KeyValue
            cols={1}
            items={[
              { k: 'Section', v: sectionLabel(slot.sectionId) },
              { k: 'Teacher', v: person.name },
              { k: 'Time', v: `${slot.start}–${slot.end}` },
              { k: 'Room', v: slot.room },
              { k: 'Substitution', v: 'Requests route to the Academic Coordinator (Approvals §1.2)' },
            ]}
          />
        )}
      </Drawer>
    </div>
  );
}

/* ============================================================
   Guardian profile — linked students + contact
   ============================================================ */
function GuardianDetail({ person }: { person: Person }) {
  const navigate = useNavigate();
  const { actorName, dispatch } = useStore();
  const toast = useToast();
  const links = useMemo(() => seed.guardianLinks.filter(l => l.guardianId === person.id), [person.id]);
  const wards = links.map(l => ({ link: l, student: seed.findPerson(l.studentId) })).filter(w => w.student);

  const message = () => {
    toast({ title: `Message queued to ${person.name}`, sub: 'WhatsApp template · quiet hours 20:30–07:30 (Communication §1.1).', tone: 'success' });
    dispatch({
      type: 'audit/add',
      entry: {
        actor: actorName, actorRole: 'coordinator', action: 'Sent guardian message', recordType: 'Message',
        recordRef: person.name, aiInvolved: false, risk: 'low', outcome: 'Queued via WhatsApp template',
      },
    });
  };

  return (
    <div className="u-col" style={{ gap: 18 }}>
      <Card pad>
        <div className="u-flex" style={{ gap: 16, flexWrap: 'wrap' }}>
          <Avatar name={person.name} size="lg" />
          <div className="u-grow" style={{ minWidth: 220 }}>
            <h2 style={{ fontSize: 'var(--text-xl)' }}>{person.name}</h2>
            <div className="u-small u-muted" style={{ marginTop: 2 }}>{person.role ?? 'Guardian'} · {campusShort(person.campus)} Campus</div>
            <div className="u-flex u-wrap" style={{ gap: 6, marginTop: 10 }}>
              {links.every(l => l.verified) ? <Badge tone="success" dot>WhatsApp verified</Badge> : <Badge tone="warning" dot>Verification pending</Badge>}
              <Badge tone="outline">{wards.length} linked {wards.length === 1 ? 'student' : 'students'}</Badge>
            </div>
          </div>
          <Button variant="secondary" icon={<Icon.Message size={14} />} onClick={message}>Message</Button>
        </div>
      </Card>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card head="Contact">
          <KeyValue
            cols={1}
            items={[
              { k: 'Phone', v: <span className="mono">{person.phone}</span> },
              { k: 'Email', v: <span className="mono">{person.email}</span> },
              { k: 'Campus', v: campusShort(person.campus) },
              { k: 'Record ref', v: <span className="mono">{person.id}</span> },
            ]}
          />
        </Card>
        <Section title="Linked students" sub="Open a student for the full 360 view">
          {wards.length === 0 ? (
            <Empty icon={<Icon.Users size={22} />} title="No students linked" sub="This guardian record is not yet linked to a student." />
          ) : (
            <div className="u-col" style={{ gap: 10 }}>
              {wards.map(({ link, student }) => student && (
                <Card key={student.id} onClick={() => navigate(`/people/${student.id}`)} className="card-click">
                  <div className="u-flex" style={{ gap: 12 }}>
                    <Avatar name={student.name} />
                    <div className="u-grow" style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{student.name}</div>
                      <div className="u-small u-muted">Grade {student.grade}-{student.section} · Roll {student.rollNo}</div>
                    </div>
                    <div className="u-col" style={{ gap: 5, alignItems: 'flex-end' }}>
                      <Badge tone="neutral">{link.relation}</Badge>
                      {link.pickupAuthorized ? <Badge tone="info">Pickup authorised</Badge> : <Badge tone="outline">No pickup</Badge>}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
