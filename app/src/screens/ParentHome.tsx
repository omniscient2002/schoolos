/* ============================================================
   Parent home — Kavita Sharma, guardian of Aarav Sharma (8-B).
   Warm, WhatsApp-first surface: today, learning, fees, school
   messages and quick actions. No admin jargon, no dense tables.
   ============================================================ */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as seed from '../data/dataset';
import { useStore } from '../state/store';
import { Avatar, Badge, Button, Card, Modal, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtDate, fmtDateShort, fmtMoney, fmtTime, weekday } from '../lib/format';

/* ---------- data anchors (per brief) ----------
   seed.DEMO_STUDENT — Aarav Sharma, Grade 8-B, North Campus — and
   seed.DEMO_GUARDIAN (Kavita Sharma) are the fixed demo pair. All
   guardian/fee/attendance data flows from these, never a hard-coded id. */

export default function ParentHome() {
  const { domain, dispatch } = useStore();
  const toast = useToast();
  const navigate = useNavigate();

  const child = seed.DEMO_STUDENT;
  const childId = child.id;
  /* seed.DEMO_GUARDIAN is the fixed demo guardian; fall back to the child's
     primary guardian link so the type's defensive `| undefined` never surfaces. */
  const guardianName = seed.DEMO_GUARDIAN?.name ?? seed.guardiansOfStudent(childId)[0]?.guardian.name ?? 'Kavita Sharma';

  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState('UPI');
  const [payState, setPayState] = useState<'form' | 'processing' | 'done'>('form');
  const [absenceOpen, setAbsenceOpen] = useState(false);
  const [absenceForm, setAbsenceForm] = useState({ date: new Date().toISOString().slice(0, 10), reason: '' });

  /* ---- attendance today ----
     The seed may record Aarav absent during the Bus 14 week — show it
     plainly with the leniency context, never with alarm. */
  /* Empty-world guard: the dataset blanked TERM_DAYS — no "last school day"
     exists, so attendance-today lookups honestly miss instead of crashing. */
  const lastTermDay = seed.TERM_DAYS[seed.TERM_DAYS.length - 1];
  const todayKey = lastTermDay ? lastTermDay.getTime() : -1;
  const attToday = seed.attendance.find(a => a.studentId === childId && a.date.getTime() === todayKey);
  const rate = seed.studentAttendanceRate(childId).rate;
  const attendanceView = !attToday
    ? { label: 'Marked at 08:40 by class teacher', tone: 'neutral' as const }
    : attToday.status === 'present' ? { label: 'Marked present', tone: 'success' as const }
    : attToday.status === 'late' ? { label: 'Marked late — arrived safely', tone: 'warning' as const }
    : attToday.status === 'excused' ? { label: 'Excused (pre-approved leave)', tone: 'neutral' as const }
    : { label: 'Not in class this morning', tone: 'warning' as const };

  /* ---- bus ----
     The child may or may not hold a route seat. seed.DEMO_STUDENT has no
     busRoute, so the bus card degrades to a "Day scholar" chip. */
  const route = child.busRoute ? seed.busRoutes.find(r => r.name === child.busRoute) : undefined;

  /* ---- next school event (north campus or all) ---- */
  const nextEvent = useMemo(() =>
    seed.calendarEvents
      .filter(e => (e.campus === child.campus || e.campus === 'all') && e.on.getTime() >= Date.now() - 3600000)
      .sort((a, b) => a.on.getTime() - b.on.getTime())[0],
  [child.campus]);

  /* ---- timetable periods 1-3 today ---- */
  const section = seed.sectionOfStudent(child);
  const dow = new Date().getDay();
  const periods = useMemo(() =>
    seed.timetable
      .filter(t => t.sectionId === (section?.id ?? '') && t.day === (dow === 0 ? 6 : dow) && t.period <= 3)
      .sort((a, b) => a.period - b.period),
  [section?.id, dow]);

  /* ---- fees ----
     Data-driven from seed.studentFeeSummary: an open obligation leads
     (the demo child's Term 2 is seeded failed — the Route 7 fee-dip
     narrative — so Pay now and the retry path both demonstrate). */
  const fee = seed.studentFeeSummary(childId);
  const nextDue = (() => {
    const open = fee.items.find(f => f.status === 'due' || f.status === 'overdue' || f.status === 'failed');
    if (open) return open;
    const term2 = fee.items.find(f => f.term.startsWith('Term 2'));
    return term2;
  })();
  const dueIn = nextDue ? Math.max(0, Math.round((nextDue.dueDate.getTime() - Date.now()) / 86400000)) : undefined;

  /* ---- messages ---- */
  const schoolMsgs = useMemo(() => {
    const lastReply = [...domain.chat].reverse().find(m => m.from === 'guardian');
    return domain.chat
      .filter(m => m.from === 'school' && (!lastReply || m.on.getTime() > lastReply.on.getTime()))
      .slice(-2)
      .reverse();
  }, [domain.chat]);

  /* ---- family ---- */
  const family = seed.guardiansOfStudent(childId);

  const pay = () => {
    if (payState !== 'form') return;
    setPayState('processing');
    setTimeout(() => {
      setPayState('done');
      /* D-6 honesty: no payment door is called here — never claim a receipt
         or a school-record write. */
      toast({ title: 'Demo payment simulated', sub: 'Nothing was sent to the school. Live fee payments are under Family → Fees.', tone: 'info' });
    }, 1200);
  };
  const resetPay = () => { setPayOpen(false); setPayState('form'); };

  const reportAbsence = () => {
    setAbsenceOpen(false);
    toast({ title: 'Absence request sent to class teacher', sub: 'Ms. Priya Iyer usually replies before 9:00.', tone: 'success' });
    dispatch({ type: 'audit/add', entry: { actor: guardianName, actorRole: 'parent', action: 'Requested absence', recordType: 'Attendance', recordRef: `${child.name} · ${fmtDateShort(new Date(absenceForm.date))}`, reason: absenceForm.reason || 'Not specified', aiInvolved: false, risk: 'low', outcome: 'Queued for class teacher review' } });
  };

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      {/* T504 honesty banner: this surface is a demo walkthrough; the live
          family data lives under /parent/family. */}
      <div style={{ background: 'var(--warn-weak, var(--surface-2, #FFF8E6))', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 14px', marginBottom: 14 }}>
        <span className="u-small" style={{ fontWeight: 550 }}>Demo view</span>
        <span className="u-small u-muted"> — this page walks through a sample family. Your family's live data is under </span>
        <Link to="/parent/family" style={{ fontWeight: 550 }}>Family</Link>
        <span className="u-small u-muted"> (attendance, homework, fees and requests operate on school records there).</span>
      </div>
      {/* ---------- greeting ---------- */}
      <div className="u-flex" style={{ gap: 14, marginBottom: 22, flexWrap: 'wrap' }}>
        <Avatar name={child.name} size="lg" />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {guardianName.split(' ')[0]}</h1>
          <div className="u-muted">{child.name.split(' ')[0]} · Grade {child.grade}-{child.section} · North Campus</div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <Badge tone="outline" dot>WhatsApp first — we message, you reply</Badge>
        </div>
      </div>

      <div className="u-col" style={{ gap: 16 }}>
        {/* ---------- today ---------- */}
        <Card headAs="h2" head={<>Today <span className="u-xs u-faint" style={{ marginLeft: 8 }}>{weekday(new Date())}, {fmtDate(new Date())}</span></>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: 12 }}>
              <div className="u-upper" style={{ marginBottom: 6 }}>Attendance</div>
              <Badge tone={attendanceView.tone} dot={attendanceView.tone !== 'neutral'}>{attendanceView.label}</Badge>
              <div className="u-small u-muted" style={{ marginTop: 8 }}>
                {attToday && attToday.status === 'absent'
                  ? 'Aarav was not in class at first bell. Bus 14 was delayed, so attendance leniency applies until 09:30 and the register self-corrects — you can also reply here to explain.'
                  : `Attendance this term is steady at ${rate}%.`}
              </div>
            </div>
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: 12 }}>
              <div className="u-upper" style={{ marginBottom: 6 }}>Bus</div>
              {route ? (
                <>
                  <Badge tone={route.status === 'on-time' ? 'success' : 'warning'} dot>{route.status === 'on-time' ? 'On time' : `Delayed ${route.delayMins ?? 13} min`}</Badge>
                  <div className="u-small u-muted" style={{ marginTop: 8 }}>
                    {route.id === 'route_7'
                      ? 'Bus 14 is running about 13 minutes late today — the evening drop is unaffected.'
                      : `${route.name} · ${route.driver}`}
                  </div>
                </>
              ) : (
                <>
                  <Badge tone="neutral" dot>Day scholar</Badge>
                  <div className="u-small u-muted" style={{ marginTop: 8 }}>
                    Drop-off and pickup are with family — no school bus seat this year.
                  </div>
                </>
              )}
            </div>
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: 12 }}>
              <div className="u-upper" style={{ marginBottom: 6 }}>Next at school</div>
              {nextEvent ? (
                <>
                  <div style={{ fontWeight: 580 }}>{nextEvent.title}</div>
                  <div className="u-small u-muted">{fmtDateShort(nextEvent.on)} · {fmtTime(nextEvent.on)}{nextEvent.location ? ` · ${nextEvent.location}` : ''}</div>
                </>
              ) : <div className="u-small u-muted">Nothing on the calendar right now.</div>}
            </div>
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: 12 }}>
              <div className="u-upper" style={{ marginBottom: 6 }}>First three periods</div>
              {periods.length === 0
                ? <div className="u-small u-muted">Timetable for today appears here by 7:30.</div>
                : (
                  <div className="u-col" style={{ gap: 4 }}>
                    {periods.map(p => (
                      <div key={p.id} className="u-flex u-small" style={{ gap: 8 }}>
                        <span className="u-faint tnum" style={{ width: 40 }}>{p.start}</span>
                        <span className="u-truncate">{p.subject}</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </div>
        </Card>

        {/* ---------- learning ---------- */}
        <Card headAs="h2" head="Learning this week">
          <div className="u-col" style={{ gap: 10 }}>
            <DueRow subject="Mathematics" color="var(--accent)" title="Equivalent fractions — practice set 3" due="Due Friday" />
            <DueRow subject="Science" color="var(--info)" title="Photosynthesis lab write-up" due="Due Thursday" />
            <div className="u-flex" style={{ gap: 10, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 'var(--r-md)' }}>
              <Icon.Learning size={15} style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div className="u-small" style={{ fontWeight: 570 }}>Mathematics — equivalent fractions: developing</div>
                <div className="u-small u-muted">Ms. Priya Iyer has shared 4 gentle practice problems. No test pressure this week.</div>
              </div>
            </div>
          </div>
        </Card>

        {/* ---------- fees ---------- */}
        <Card headAs="h2" head="Fees">
          <div className="u-between" style={{ gap: 14, flexWrap: 'wrap' }}>
            <div>
              <div className="u-upper">Next payment</div>
              <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 650, letterSpacing: '-0.02em' }}>{nextDue ? fmtMoney(nextDue.amount) : 'All settled'}</div>
              <div className="u-small u-muted">
                {nextDue ? `${nextDue.term} · due ${fmtDate(nextDue.dueDate)} — in ${dueIn} days` : 'Thank you — nothing pending for this term.'}
              </div>
            </div>
            <div className="u-flex" style={{ gap: 8 }}>
              {nextDue && <Button variant="primary" icon={<Icon.Wallet size={14} />} onClick={() => setPayOpen(true)}>Pay now</Button>}
              <Link to="/parent/fees" className="btn btn-secondary" style={{ textDecoration: 'none' }}>Fee details</Link>
            </div>
          </div>
        </Card>

        {/* ---------- messages ---------- */}
        <Card
          head="Messages from school"
          actions={<Link to="/parent/chat" className="u-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, minHeight: 32, padding: '0 4px' }}>Open chat <Icon.ArrowRight size={12} /></Link>}
        >
          {schoolMsgs.length === 0
            ? <div className="u-small u-muted">No school messages yet — the office usually writes in the morning.</div>
            : (
              <div className="u-col" style={{ gap: 8 }}>
                {schoolMsgs.map(m => (
                  <Link key={m.id} to="/parent/chat" className="u-flex" style={{ gap: 10, padding: '9px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', textDecoration: 'none', color: 'inherit' }}>
                    {schoolMsgs.length > 1 && <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--accent)', flexShrink: 0, marginTop: 5 }} aria-hidden="true" />}
                    <span style={{ minWidth: 0 }}>
                      <span className="u-small u-truncate" style={{ display: 'block', fontWeight: 550 }}>{m.text}</span>
                      <span className="u-xs u-faint">{fmtTime(m.on)} · School office{m.template ? ' · message from school' : ''}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
        </Card>

        {/* ---------- quick actions ---------- */}
        <div className="grid grid-3">
          <Card pad onClick={() => navigate('/parent/chat')}>
            <Icon.Message size={17} style={{ color: 'var(--accent-text)' }} />
            <div style={{ fontWeight: 590 }}>Message class teacher</div>
            <div className="u-small u-muted">Ms. Priya Iyer · usually replies within an hour.</div>
          </Card>
          <Card pad onClick={() => setAbsenceOpen(true)}>
            <Icon.Sunrise size={17} style={{ color: 'var(--warning)' }} />
            <div style={{ fontWeight: 590 }}>Report an absence</div>
            <div className="u-small u-muted">Tell the class teacher why {child.name.split(' ')[0]} will be away.</div>
          </Card>
          <Card pad onClick={() => {
            toast({ title: 'Bus change request noted', sub: 'Case created for the transport supervisor — expect a call today.', tone: 'success' });
            dispatch({ type: 'case/add', c: { id: `case_bus_${Date.now()}`, kind: 'transport', title: 'Bus change request — parent WhatsApp', openedOn: new Date(), openedBy: 'guardian', origin: 'parent-whatsapp', owner: 'Transport Supervisor', priority: 'normal', slaHours: 72, status: 'open', campus: child.campus, messages: [{ on: new Date(), from: `${guardianName} (guardian, ${child.grade}-${child.section})`, text: 'Requesting a bus route change from the parent home screen.' }] } });
          }}>
            <Icon.Bus size={17} style={{ color: 'var(--info)' }} />
            <div style={{ fontWeight: 590 }}>Request a bus change</div>
            <div className="u-small u-muted">Pickup point or route change — noted as a case, not lost in chat.</div>
          </Card>
        </div>

        {/* ---------- family links ---------- */}
        <Card headAs="h2" head="Family links">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            {family.map(({ link, guardian }) => (
              <div key={link.guardianId} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', padding: 12 }}>
                <div className="u-flex" style={{ gap: 10 }}>
                  <Avatar name={guardian.name} size="sm" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 580 }}>{guardian.name}</div>
                    <div className="u-xs u-faint">{guardian.role ?? link.relation} · {link.verified ? 'verified' : 'verification pending'}</div>
                  </div>
                </div>
                <div className="u-small u-muted" style={{ marginTop: 8 }}>
                  {link.pickupAuthorized ? 'Can pick up from school' : 'Not authorized for pickup'}
                </div>
                <div className="u-small tnum u-muted">{guardian.phone}</div>
              </div>
            ))}
            <div style={{ border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-md)', padding: 12 }}>
              <div className="u-upper" style={{ marginBottom: 4 }}>Pickup card</div>
              <div className="u-small u-muted">
                Authorized: {family.filter(f => f.link.pickupAuthorized).map(f => f.guardian.name).join(', ') || 'No one yet'}.
                Changes take effect the next school day after the front office verifies them.
              </div>
            </div>
          </div>
        </Card>

        <div className="u-xs u-faint" style={{ textAlign: 'center', paddingBottom: 6 }}>
          This surface shows only {child.name.split(' ')[0]}&apos;s records. School office: +91 80 4711 2200 · Meridian International Academy, North Campus.
        </div>
      </div>

      {/* ---------- payment modal ---------- */}
      <Modal
        open={payOpen}
        onClose={resetPay}
        title={`Pay ${nextDue?.term ?? 'fees'}`}
        sub={nextDue ? `${fmtMoney(nextDue.amount)} · due ${fmtDate(nextDue.dueDate)}` : 'No payment due'}
        footer={
          payState === 'done'
            ? <Button variant="primary" onClick={resetPay}>Close</Button>
            : (
              <>
                <Button variant="ghost" onClick={resetPay}>Cancel</Button>
                <Button variant="primary" loading={payState === 'processing'} disabled={payState !== 'form'} onClick={pay}>
                  Pay {nextDue ? fmtMoney(nextDue.amount) : ''}
                </Button>
              </>
            )
        }
      >
        {payState === 'done' ? (
          <div className="u-col" style={{ alignItems: 'center', gap: 10, padding: '14px 0', textAlign: 'center' }}>
            <span style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--success-weak)', color: 'var(--success)', display: 'grid', placeItems: 'center' }}>
              <Icon.Check size={22} />
            </span>
            <div style={{ fontWeight: 620 }}>Payment successful</div>
            <div className="u-small u-muted">
              Receipt sent on WhatsApp to {guardianName}. The fees record updates instantly — no late fee applies (Fees §4.3).
            </div>
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="pay-method">Pay with</label>
              <select id="pay-method" className="select" value={payMethod} onChange={e => setPayMethod(e.target.value)} disabled={payState !== 'form'}>
                <option>UPI</option>
                <option>Net Banking</option>
                <option>Card</option>
              </select>
            </div>
            <div className="u-small u-muted">
              {payMethod === 'UPI' ? 'You will confirm the amount in your UPI app. In this demo the payment completes instantly.' : 'Secure page — card details are never stored by the school.'}
            </div>
          </>
        )}
      </Modal>

      {/* ---------- absence modal ---------- */}
      <Modal
        open={absenceOpen}
        onClose={() => setAbsenceOpen(false)}
        title="Report an absence"
        sub="Goes straight to the class teacher — no forms, no phone queue."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAbsenceOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={reportAbsence}>Send request</Button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="abs-date">Date</label>
          <input id="abs-date" className="input" type="date" value={absenceForm.date} onChange={e => setAbsenceForm(f => ({ ...f, date: e.target.value }))} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="abs-reason">Reason</label>
          <textarea id="abs-reason" className="textarea" placeholder="e.g. Fever since last night, will see the doctor at 10." value={absenceForm.reason} onChange={e => setAbsenceForm(f => ({ ...f, reason: e.target.value }))} />
        </div>
      </Modal>
    </div>
  );
}

/* ---------- small pieces ---------- */
function DueRow({ subject, color, title, due }: { subject: string; color: string; title: string; due: string }) {
  return (
    <div className="u-flex" style={{ gap: 10, padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
      <span className="u-xs" style={{ padding: '2px 8px', borderRadius: 999, background: `color-mix(in srgb, ${color} 12%, transparent)`, color, fontWeight: 600, flexShrink: 0 }}>{subject}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 550 }}>{title}</span>
      </span>
      <span className="u-small u-faint" style={{ flexShrink: 0 }}>{due}</span>
    </div>
  );
}
