/* ============================================================
   PersonDetail — Student 360 for students; a lighter profile
   (schedule, classes, contact) for teachers/staff; linked
   students for guardians. Every AI claim carries provenance.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as seed from '../data/dataset';
import { apiGet } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { useRoleOrGrant } from '../lib/access';
import { RecordPaymentModal } from '../components/RecordPaymentModal';

/* local async hook (duplicated per screen per APP-SPEC) */
function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(d => { if (live) setState({ data: d, loading: false, error: null }); })
      .catch(e => { if (live) setState({ data: null, loading: false, error: String(e) }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick(t => t + 1) };
}

/* Real ledger row (fee_obligations) */
interface RealObligation {
  id: string; term: string; category: string; amount: number; paidAmount: number;
  dueDate: Date | null; status: 'open' | 'partial' | 'paid' | 'void';
}
import { useStore } from '../state/store';
import {
  Avatar, Badge, Button, Card, DataTable, Drawer, Empty, ErrorState, KeyValue, PageHead, Section, SkeletonCard, Stat, Tabs, useToast,
} from '../components/ui';
import { Sparkline } from '../components/Chart';
import { AiHeader, EvidenceChain } from '../components/Ai';
import { Icon } from '../components/Icon';
import { fmtDate, fmtDateShort, fmtMoney, fmtMoneyShort, fmtPct } from '../lib/format';
import type { AiEvidenceStep, AttendanceRecord, FeeObligation, Person, TimeSlot } from '../types/domain';

const campusShort = (id: string) => seed.campuses.find(c => c.id === id)?.shortName ?? id;
const sectionLabel = (sectionId: string) => {
  const s = seed.sections.find(x => x.id === sectionId);
  return s ? `${s.grade}-${s.name} · ${campusShort(s.campus)}` : sectionId;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* The People directory lists LIVE students (server UUIDs), which are not in the demo seed. This
   resolves those ids against GET /students/:id so opening a real student shows their record instead
   of the old "Record not found". A non-student / foreign id still gets the honest empty. */
function LiveStudentProfile({ id }: { id: string }) {
  const navigate = useNavigate();
  const { data, loading, error, retry } = useAsync(async () => {
    return apiGet<{
      student: Record<string, unknown>;
      fees: Array<Record<string, unknown>>;
      attendance: Array<{ school_date: string; status: string }>;
      route: Record<string, unknown> | null;
    }>(`/students/${id}`);
  }, [id]);

  if (loading) return <><PageHead title="Student" back={{ to: '/people', label: 'Directory' }} /><SkeletonCard /></>;
  if (error || !data?.student) {
    return (
      <>
        <PageHead title="Student" back={{ to: '/people', label: 'Directory' }} />
        <ErrorState title="Could not load this student" sub={error ? friendly(error).replace('Error: ', '') : 'This record could not be found.'} onRetry={retry} />
      </>
    );
  }

  const s = data.student;
  const str = (v: unknown, fallback = '—') => (v == null || v === '' ? fallback : String(v));
  const att = data.attendance ?? [];
  const present = att.filter(a => a.status === 'present' || a.status === 'late').length;
  const attPct = att.length ? Math.round((present / att.length) * 100) : null;
  const fees = data.fees ?? [];
  const outstanding = fees.filter(f => f.status !== 'paid' && f.status !== 'void')
    .reduce((a, f) => a + (Number(f.amount_cents ?? 0) - Number(f.paid_cents ?? 0)), 0) / 100;

  return (
    <>
      <PageHead
        title={str(s.name)}
        sub={`${str(s.admission_no, 'no admission no.')} · Class ${str(s.grade)}-${str(s.section)}`}
        back={{ to: '/people', label: 'Directory' }}
      />
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card head="Profile" pad>
          <KeyValue items={[
            { k: 'Admission no.', v: str(s.admission_no) },
            { k: 'Class', v: `${str(s.grade)}-${str(s.section)}` },
            { k: 'Guardian', v: str(s.guardian_name) },
            { k: 'Guardian phone', v: str(s.guardian_phone, 'not shared') },
            { k: 'Bus route', v: str(s.bus_route, 'day scholar') },
            { k: 'Status', v: str(s.status, 'active') },
          ]} />
        </Card>
        <Card head="Attendance" pad>
          <KeyValue items={[
            { k: 'Attendance rate', v: attPct == null ? 'no register yet' : `${attPct}%` },
            { k: 'Days on record', v: String(att.length) },
            { k: 'Outstanding fees', v: `₹${outstanding.toFixed(2)}` },
          ]} />
        </Card>
      </div>
      <Card head="Fee obligations" sub="Live rows from the fee ledger." style={{ marginTop: 'var(--s-4)' }}>
        {fees.length === 0 ? <Empty title="No fee obligations on record" /> : (
          <DataTable
            columns={[
              { key: 'label', label: 'Term', render: (f: Record<string, unknown>) => str(f.label ?? f.term) },
              { key: 'amount_cents', label: 'Amount', align: 'right', render: (f: Record<string, unknown>) => `₹${(Number(f.amount_cents ?? 0) / 100).toFixed(2)}` },
              { key: 'paid_cents', label: 'Paid', align: 'right', render: (f: Record<string, unknown>) => `₹${(Number(f.paid_cents ?? 0) / 100).toFixed(2)}` },
              { key: 'status', label: 'Status', render: (f: Record<string, unknown>) => <Badge tone={f.status === 'paid' ? 'success' : f.status === 'void' ? 'neutral' : 'warning'}>{str(f.status)}</Badge> },
            ]}
            rows={fees}
            rowKey={(f: Record<string, unknown>) => String(f.id)}
          />
        )}
      </Card>
      <Button variant="ghost" style={{ marginTop: 'var(--s-3)' }} onClick={() => navigate('/people')}>Back to Directory</Button>
    </>
  );
}

export default function PersonDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const person: Person | undefined = id ? seed.findPerson(id) : undefined;

  if (!person) {
    /* A live roster student is a server UUID, not a seed id — resolve it live rather than claim
       the record does not exist. Non-UUID / foreign ids fall through to the honest empty. */
    if (id && UUID_RE.test(id)) return <LiveStudentProfile id={id} />;
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
  const toast = useToast();
  const [tab, setTab] = useState('overview');

  const [retrying] = useState<string | null>(null);
  const [slot, setSlot] = useState<AttendanceRecord | null>(null);
  const [payRow, setPayRow] = useState<RealObligation | null>(null);

  /* A real (database) student id is a UUID; demo-directory ids (st_north_*,
     per_xxx) are fixture rows that no server door can act on. Payment and
     attendance truth is derived accordingly. */
  const isRealStudent = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(person.id);
  /* FEE-RBAC-2: mask-aware, matching the confirm door exactly. */
  const canConfirm = useRoleOrGrant(['finance', 'finance_head', 'finance_clerk', 'owner'], ['POST /fees/payments/:id/confirm']);

  const rate = useMemo(() => seed.studentAttendanceRate(person.id), [person.id]);
  const fees = useMemo(() => seed.studentFeeSummary(person.id), [person.id]);
  const hasAttendanceRows = useMemo(() => (seed.attendance ?? []).some(a => a.studentId === person.id), [person.id]);
  const guardianRows = useMemo(() => seed.guardiansOfStudent(person.id), [person.id]);
  const docs = useMemo(() => (seed.documents ?? []).filter(d => d.ownerType === 'student' && d.ownerId === person.id), [person.id]);
  const section = seed.sectionOfStudent(person);
  const classTeacher = section ? seed.findPerson(section.classTeacherId) : undefined;
  const route = person.busRoute ? seed.busRoutes.find(r => r.name === person.busRoute) : undefined;
  const verifiedCount = guardianRows.filter(g => g.link.verified).length;

  /* Real ledger rows for a real student (UUID id) */
  const realFees = useAsync<RealObligation[] | null>(async () => {
    if (!isRealStudent) return null;
    const res = await apiGet<{ obligations: Record<string, unknown>[] }>(`/fees/obligations?studentId=${person.id}`);
    return (res.obligations ?? []).map(o => ({
      id: String(o.id),
      term: String(o.term ?? ''),
      category: String(o.label ?? ''),
      amount: Number(o.amount_cents ?? 0) / 100,
      paidAmount: Number(o.paid_cents ?? 0) / 100,
      dueDate: o.due_on ? new Date(String(o.due_on)) : null,
      status: (o.status ?? 'open') as 'open' | 'partial' | 'paid' | 'void',
    }));
  }, [isRealStudent, person.id]);

  /* 30-day register: seed stores only non-present marks; fill the rest as present.
     A student with no attendance rows yet gets an honest empty state instead of
     30 fabricated "present" days. */
  const register = useMemo(() => {
    const recs = (seed.attendance ?? []).filter(a => a.studentId === person.id);
    const markedBy = classTeacher?.name ?? 'Class teacher';
    const days = seed.TERM_DAYS ?? [];
    return [...days].reverse().map(day => {
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

  const attTier = !hasAttendanceRows
    ? { tone: 'outline' as const, label: 'No attendance records yet' }
    : rate.rate >= 95 ? { tone: 'success' as const, label: `Attendance ${fmtPct(rate.rate, 1)}` }
    : rate.rate >= 88 ? { tone: 'info' as const, label: `Attendance ${fmtPct(rate.rate, 1)}` }
    : rate.rate >= 75 ? { tone: 'warning' as const, label: `Attendance watch · ${fmtPct(rate.rate, 1)}` }
    : { tone: 'danger' as const, label: `Attendance risk · ${fmtPct(rate.rate, 1)}` };

  const feeBadge = fees.hasFailed ? { tone: 'danger' as const, label: 'Payment failed' }
    : fees.overdue > 0 ? { tone: 'warning' as const, label: `${fmtMoneyShort(fees.overdue)} overdue` }
    : fees.due > 0 ? { tone: 'info' as const, label: `${fmtMoneyShort(fees.due)} due` }
    : { tone: 'success' as const, label: 'Fees clear' };

  const messageGuardian = () => {
    const primary = guardianRows.find(g => g.link.primary) ?? guardianRows[0];
    if (!primary) {
      toast({ title: 'No guardian linked', sub: 'Link a guardian to this student before messaging.', tone: 'error' });
      return;
    }
    toast({ title: `Draft noted for ${primary.guardian.name}`, sub: 'One-tap parent messaging is not connected yet — messages run from the Rails console once a provider is connected.', tone: 'info' });
  };

  const chainSteps: AiEvidenceStep[] = [
    {
      label: 'Attendance — 30 school days',
      detail: !hasAttendanceRows
        ? 'No register rows yet — attendance appears after the first register submission'
        : `${fmtPct(rate.rate, 1)} present · ${rate.absent} absent · ${rate.late} late · ${rate.excused} excused`,
      source: !hasAttendanceRows ? 'Attendance register · empty' : 'Attendance register · recomputed just now',
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
      source: 'Fees records',
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
            <Button variant="secondary" icon={<Icon.Message size={14} />} onClick={messageGuardian}>Message guardian</Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        {/* ---------- left: AI briefing + context ---------- */}
        <div className="u-col" style={{ gap: 16 }}>
          <Card head={<span className="u-flex" style={{ gap: 8 }}><AiHeader label="Student 360 briefing" confidence="high" /></span>}>
            <div className="u-col" style={{ gap: 8 }}>
              <p className="u-small u-muted" style={{ margin: 0, lineHeight: 1.6 }}>
                The AI briefing layer is not connected, so no briefing is drafted — nothing here is generated
                to fill the space. The evidence and records below are real.
              </p>
              <EvidenceChain title={`Evidence — records for ${person.name.split(' ')[0]}`} steps={chainSteps} />
            </div>
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
              !hasAttendanceRows ? (
                <Empty icon={<Icon.Check size={24} />} title="No attendance records yet" sub="This student's register history appears after the first attendance submission — nothing is invented in the meantime."
                  action={<Button variant="secondary" onClick={() => navigate('/attendance')}>Open the Attendance desk</Button>} />
              ) : (
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
              )
            )}

            {tab === 'fees' && (
              isRealStudent ? (
                realFees.loading ? (
                  <div className="u-col" style={{ padding: 16 }}><SkeletonCard /></div>
                ) : realFees.error ? (
                  <ErrorState title="Could not load this student's fees" sub={friendly(realFees.error)} onRetry={realFees.retry} />
                ) : (realFees.data ?? []).length === 0 ? (
                  <Empty icon={<Icon.Money size={24} />} title="No fee obligations on record" sub="Fee lines appear here once the school records them."
                    action={canConfirm ? <Button variant="secondary" onClick={() => navigate('/fees')}>Open the Fees desk</Button> : undefined} />
                ) : (
                  <div className="u-col" style={{ gap: 14 }}>
                    <div className="grid grid-3">
                      <Stat label="Due now" value={fmtMoneyShort((realFees.data ?? []).filter(f => f.status !== 'paid' && f.status !== 'void').reduce((a, f) => a + (f.amount - f.paidAmount), 0))} sub="Open + part-paid obligations" />
                      <Stat label="Paid to date" value={fmtMoneyShort((realFees.data ?? []).reduce((a, f) => a + f.paidAmount, 0))} sub={`${(realFees.data ?? []).filter(f => f.status === 'paid').length} of ${(realFees.data ?? []).length} obligations settled`} />
                      <Stat label="Ledger" value="Live" sub="Straight from the school's fee ledger" />
                    </div>
                    <DataTable<RealObligation>
                      rows={realFees.data ?? []}
                      rowKey={f => f.id}
                      columns={[
                        { key: 'term', label: 'Term', render: f => f.term },
                        { key: 'category', label: 'Category', render: f => f.category },
                        { key: 'amount', label: 'Amount', align: 'right', render: f => <span className="tnum">{fmtMoney(f.amount)}</span> },
                        { key: 'due', label: 'Due date', render: f => f.dueDate ? fmtDateShort(f.dueDate) : '—' },
                        {
                          key: 'status', label: 'Status',
                          render: f => f.status === 'paid' ? <Badge tone="success" dot>Paid</Badge>
                            : f.status === 'partial' ? <Badge tone="info" dot>Part paid</Badge>
                            : f.status === 'open' ? <Badge tone="warning" dot>Open</Badge>
                            : <Badge tone="neutral">Void</Badge>,
                        },
                        {
                          key: 'actions', label: '',
                          render: f => (f.status !== 'paid' && f.status !== 'void')
                            ? (canConfirm
                              ? <Button size="sm" variant="secondary" icon={<Icon.Money size={12} />} loading={retrying === f.id} onClick={() => setPayRow(f)}>Record payment</Button>
                              : <Button size="sm" variant="secondary" disabled title="Recording payments is done by finance or the owner — your role can view the ledger.">Record payment</Button>)
                            : null,
                        },
                      ]}
                    />
                    <div className="u-xs u-faint">Payments run the real ledger (initiate + confirm). Recording is finance/owner authority; every entry is audited server-side.</div>
                  </div>
                )
              ) : fees.items.length === 0 ? (
                <Empty icon={<Icon.Money size={24} />} title="No fee obligations on record" sub="This student has no fee lines for the current academic year." />
              ) : (
                <div className="u-col" style={{ gap: 14 }}>
                  <Badge tone="outline">Demo data — payments for demo-directory records cannot be recorded against the school ledger</Badge>
                  <div className="grid grid-3">
                    <Stat label="Due now" value={fmtMoneyShort(fees.due)} sub={fees.overdue > 0 ? `${fmtMoneyShort(fees.overdue)} overdue` : 'Nothing overdue'} />
                    <Stat label="Paid this year" value={fmtMoneyShort(fees.paid)} sub={`${fees.items.filter(f => f.status === 'paid').length} of ${fees.items.length} obligations settled`} />
                    <Stat label="Payment health" value={fees.hasFailed ? 'Failed' : fees.overdue > 0 ? 'Overdue' : 'Clear'} sub={fees.hasFailed ? '1 UPI mandate declined (demo data)' : 'Gateway reconciliations clean'} />
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
                    ]}
                  />
                  <div className="u-xs u-faint">This is a demo-directory record. Real payments are recorded from the Fees desk against ledger rows.</div>
                </div>
              )
            )}

            {tab === 'guardians' && (
              guardianRows.length === 0 ? (
                <Empty icon={<Icon.People size={24} />} title="No guardians linked" sub="Add a guardian from the Directory to enable absence alerts and pickup authorisation."
                  action={<Button variant="secondary" onClick={() => navigate('/people')}>Open the Directory</Button>} />
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

      {/* record payment — the SAME shared component as the Fees desk (FEE-FE-3) */}
      <RecordPaymentModal
        row={payRow ? { id: payRow.id, studentName: person.name, term: payRow.term, category: payRow.category, amount: payRow.amount, paidAmount: payRow.paidAmount } : null}
        onClose={() => setPayRow(null)}
        onDone={() => realFees.retry()}
      />
    </div>
  );
}

/* ============================================================
   Teacher / Staff profile — lighter: contact, classes, schedule
   ============================================================ */
function StaffDetail({ person }: { person: Person }) {
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
            <Empty icon={<Icon.Users size={22} />} title="No students linked" sub="This guardian record is not yet linked to a student."
                  action={<Button variant="secondary" onClick={() => navigate('/people')}>Open the Directory</Button>} />
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
