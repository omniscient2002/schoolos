/* ============================================================
   MyLeave — P8 · teacher SELF-leave.

   Contract (§4, frozen):
     POST /teacher/leave       (self) {kind, from_date, to_date, reason}
     GET  /teacher/leave/mine  → requests + balances
   Flow: apply → policy validation → coordinator approval →
   auto substitution → handover packet (substitute, classes
   covered). The status timeline shows where a request stands;
   after approval the handover packet appears on the card.
   Balances stay visible — no surprises mid-term.
   ============================================================ */
import { useMemo, useState } from 'react';
import {
  Badge, Button, Card, Empty, KeyValue, PageHead, Section, SkeletonCard, Stat, Timeline, useToast,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useStore } from '../../state/store';
import {
  createLeave, listMyLeave,
  type LeaveKind, type TeacherLeaveRequest,
} from '../../services/teacherFixtures';
import { AsyncGate, DeniedState, onEnter, TEACHER_STAFF_ROLES, useAsync } from './teacherKit';

const KINDS: { id: LeaveKind; label: string; hint: string }[] = [
  { id: 'casual', label: 'Casual leave', hint: 'A day here or there — functions, errands.' },
  { id: 'sick', label: 'Sick leave', hint: 'You are unwell. Rest; the roster adjusts itself.' },
  { id: 'earned', label: 'Earned leave', hint: 'Planned longer leave from your earned balance.' },
  { id: 'duty', label: 'Duty leave', hint: 'Official duty outside class — exam, training, visit.' },
];

const STATUS_TONE = { requested: 'warning', approved: 'success', rejected: 'danger' } as const;
const STATUS_LABEL = { requested: 'Waiting for approval', approved: 'Approved', rejected: 'Not approved' };

function timelineFor(r: TeacherLeaveRequest) {
  const items: { time: React.ReactNode; title: React.ReactNode; body?: React.ReactNode; dot?: 'accent' | 'ai' | 'danger' }[] = [
    {
      time: fmtDate(r.from_date),
      title: 'You asked for leave',
      body: `${r.kind === 'casual' ? 'Casual' : r.kind === 'sick' ? 'Sick' : r.kind === 'earned' ? 'Earned' : 'Duty'} leave · ${r.from_date === r.to_date ? fmtDate(r.to_date) : `${fmtDate(r.from_date)} to ${fmtDate(r.to_date)}`}`,
    },
    {
      time: r.decided_at ? fmtDateTime(r.decided_at) : '—',
      title: r.status === 'requested' ? 'With the coordinator now' : r.status === 'approved' ? `Approved by ${r.approver_name ?? 'the coordinator'}` : `Not approved by ${r.approver_name ?? 'the coordinator'}`,
      body: r.status === 'requested'
        ? 'A substitute proposal is prepared automatically once it is approved.'
        : r.note ?? undefined,
      dot: r.status === 'rejected' ? 'danger' : r.status === 'approved' ? 'accent' : undefined,
    },
  ];
  if (r.status === 'approved' && r.handover) {
    items.push({
      time: fmtDateTime(r.handover.packet_at),
      title: `Handover ready — ${r.handover.substitute_name} covers your classes`,
      body: `${r.handover.classes.length} class${r.handover.classes.length === 1 ? '' : 'es'} with topic notes · everyone involved was notified.`,
      dot: 'accent',
    });
  }
  return items;
}

export default function MyLeave() {
  const toast = useToast();
  const { session } = useStore();

  const [kind, setKind] = useState<LeaveKind>('casual');
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); });
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPacket, setShowPacket] = useState<string | null>(null);

  const mine = useAsync(() => listMyLeave(), []);

  const apply = async () => {
    setSubmitting(true);
    try {
      const r = await createLeave({ kind, from_date: from, to_date: to, reason });
      toast({
        title: 'Leave request sent',
        sub: `The coordinator sees it now. If it is approved, a substitute is proposed automatically and your handover packet builds itself.`,
        tone: 'success',
      });
      setReason('');
      mine.retry();
      setShowPacket(r.request.id); /* scroll target = the fresh timeline */
    } catch (e) {
      toast({ title: 'Request did not go through', sub: String(e).replace('Error: ', ''), tone: 'error' });
    } finally { setSubmitting(false); }
  };

  const balances = mine.data?.balances ?? [];
  const upcoming = useMemo(() => (mine.data?.requests ?? [])
    .filter(r => r.status !== 'rejected' && new Date(r.to_date).getTime() >= Date.now() - 86400000)
    .sort((a, b) => a.from_date.localeCompare(b.from_date)), [mine.data]);

  if (!TEACHER_STAFF_ROLES.includes(session.roleId)) return <DeniedState role={session.roleId} />;

  return (
    <div>
      <PageHead
        title="My leave"
        sub="Ask for leave in under a minute. Approval, substitute and handover happen without follow-up messages."
      />

      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        {(['casual', 'sick', 'earned', 'duty'] as LeaveKind[]).map(k => {
          const b = balances.find(x => x.kind === k);
          const left = b ? Math.max(0, b.entitled + b.carried - b.used) : null;
          return (
            <Stat
              key={k}
              label={KINDS.find(x => x.id === k)!.label}
              value={left != null ? String(left) : '—'}
              sub={b ? `of ${b.entitled + b.carried} days · ${b.used} used this year` : 'Loading…'}
            />
          );
        })}
      </div>

      <span id="apply-leave" aria-hidden="true" />
      <Section title="Ask for leave" sub="Pick the kind, the dates, one line why.">
        <Card pad>
          <div className="field">
            <label>Kind of leave</label>
            <div className="u-flex u-wrap" style={{ gap: 8 }}>
              {KINDS.map(k => (
                <button
                  key={k.id}
                  className={`tab ${kind === k.id ? 'active' : ''}`}
                  aria-pressed={kind === k.id}
                  title={k.hint}
                  onClick={() => setKind(k.id)}
                >{k.label}</button>
              ))}
            </div>
            <span className="hint">{KINDS.find(k => k.id === kind)!.hint}</span>
          </div>

          <div className="grid grid-2" style={{ gap: '0 16px' }}>
            <div className="field">
              <label htmlFor="lv-from">From</label>
              <input id="lv-from" className="input" type="date" value={from} onChange={e => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} />
            </div>
            <div className="field">
              <label htmlFor="lv-to">To (same day is fine)</label>
              <input id="lv-to" className="input" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="lv-reason">Reason (one line is enough)</label>
            <textarea
              id="lv-reason"
              className="textarea"
              rows={2}
              placeholder="Only the coordinator reads this."
              value={reason}
              onChange={e => setReason(e.target.value)}
              onKeyDown={onEnter(apply)}
            />
          </div>

          <div className="u-between u-wrap" style={{ gap: 10 }}>
            <span className="u-small u-muted">
              After approval: substitute proposed from free periods and subject match, classes notified, handover packet ready here.
            </span>
            <Button variant="primary" icon={<Icon.Send size={14} />} loading={submitting} onClick={apply} disabled={!reason.trim()}>
              Send request
            </Button>
          </div>
        </Card>
      </Section>

      <Section title="My requests" sub="Where each one stands — newest first.">
        <AsyncGate
          state={mine}
          skeleton={<SkeletonCard lines={8} />}
          empty={
            <Empty
              icon={<Icon.Calendar size={22} />}
              title="No leave taken"
              sub="Your requests and their outcomes will be listed here, with balances above always up to date."
              action={<a href="#apply-leave" className="btn btn-secondary btn-sm" style={{ minHeight: 40 }}>Request leave</a>}
            />
          }
        >
          {data => (
            <div className="u-col" style={{ gap: 14 }}>
              {data.requests.map(r => (
                <Card
                  key={r.id}
                  pad
                  className={showPacket === r.id ? 'u-gap-2' : ''}
                  style={showPacket === r.id ? { borderColor: 'var(--accent-weak-2)' } : undefined}
                >
                  <div className="u-between u-wrap" style={{ gap: 8 }}>
                    <div className="u-flex u-wrap" style={{ gap: 10 }}>
                      <Badge tone={STATUS_TONE[r.status]} dot={r.status === 'requested'}>{STATUS_LABEL[r.status]}</Badge>
                      <span style={{ fontWeight: 600 }}>
                        {KINDS.find(k => k.id === r.kind)?.label ?? r.kind} · {r.from_date === r.to_date ? fmtDate(r.from_date) : `${fmtDate(r.from_date)} – ${fmtDate(r.to_date)}`}
                      </span>
                    </div>
                    <span className="u-xs u-faint">Asked {fmtDateTime(r.from_date)}</span>
                  </div>
                  <div className="u-small u-muted" style={{ margin: '6px 0 10px' }}>{r.reason}</div>
                  <Timeline items={timelineFor(r)} />

                  {r.status === 'approved' && r.handover && (
                    <div style={{ marginTop: 8 }}>
                      <Button
                        variant="secondary" size="sm"
                        icon={<Icon.Document size={13} />}
                        aria-expanded={showPacket === r.id}
                        onClick={() => setShowPacket(showPacket === r.id ? null : r.id)}
                      >
                        {showPacket === r.id ? 'Hide handover packet' : 'Show handover packet'}
                      </Button>
                      {showPacket === r.id && (
                        <Card pad style={{ marginTop: 10, background: 'var(--surface-2)' }}>
                          <div className="u-small" style={{ fontWeight: 650, marginBottom: 8 }}>
                            Handover — {r.handover.substitute_name} takes your classes
                          </div>
                          <div className="u-col" style={{ gap: 8 }}>
                            {r.handover.classes.map(c => (
                              <div key={`${c.class_grade}-${c.period}`} className="u-small" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
                                <strong>{c.class_grade}</strong> · {c.period} · {c.subject} · Room {c.room}
                                <div className="u-muted" style={{ marginTop: 2 }}>{c.note}</div>
                              </div>
                            ))}
                          </div>
                          <div className="u-xs u-faint" style={{ marginTop: 8 }}>
                            The substitute, your classes and the office all received this. Nothing to forward.
                          </div>
                        </Card>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </AsyncGate>
      </Section>

      {upcoming.length > 0 && (
        <Section title="Coming up" sub="Approved leave ahead, so plans stay visible.">
          <Card pad>
            <KeyValue
              cols={2}
              items={upcoming.map(r => ({
                k: `${KINDS.find(k => k.id === r.kind)?.label ?? r.kind} · ${fmtDate(r.from_date)}`,
                v: r.status === 'approved'
                  ? `${r.handover?.substitute_name ?? 'Substitute'} covers your classes`
                  : 'Waiting for the coordinator',
              }))}
            />
          </Card>
        </Section>
      )}

      <div className="u-small u-muted" style={{ marginTop: 14 }}>
        Leave history stays in your record (Me → My activity). Balances refresh the moment a request is decided.
      </div>
    </div>
  );
}
